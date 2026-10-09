import {
  App,
  applyDocumentTheme,
  applyHostFonts,
  applyHostStyleVariables,
  type McpUiHostContext,
} from "@modelcontextprotocol/ext-apps";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { OpenAIExtensions } from "@openai/mcp-extensions/app";
import type { Finding, ProjectRef, ViewPayload } from "../shared/contracts.ts";
import { VIEW_META_KEY } from "../shared/view-meta.ts";

/** Composer block `_meta` key that ties an attachment back to its finding. The model does not see `_meta`. */
const FINDING_META_KEY = "fallow/findingId";
const MAX_CONTEXT_FINDINGS = 25;

export type TextBlock = {
  type: "text";
  text: string;
  annotations?: { audience?: Array<"user" | "assistant"> };
  _meta?: Record<string, unknown>;
};

const location = (finding: Finding): string =>
  finding.line === null ? finding.path : `${finding.path}:${finding.line}`;

/** One removable composer chip per finding, labeled with its symbol or file. */
export const findingBlock = (finding: Finding): TextBlock => ({
  type: "text",
  text: `Fallow finding ${finding.id} (${finding.rule}, ${finding.level}) at ${location(finding)}: ${finding.message.replace(/`/g, "")}${finding.verify === null ? "" : ` Verify with: ${finding.verify}`}`,
  _meta: {
    "openai/title": `${finding.title}: ${finding.symbol ?? location(finding)}`,
    [FINDING_META_KEY]: finding.id,
  },
});

/** Hidden context for the model: where the project lives and how to treat the findings. */
const backgroundBlock = (project: ProjectRef): TextBlock => ({
  type: "text",
  text: `The attached Fallow findings belong to ${project.name} at ${project.root}. Verify each one with its command before you change code. Prefer a fix over a suppression.`,
  annotations: { audience: ["assistant"] },
});

export const viewOf = (result: CallToolResult | undefined): ViewPayload | null => {
  const view = result?._meta?.[VIEW_META_KEY];
  return typeof view === "object" && view !== null && "view" in view ? (view as ViewPayload) : null;
};

type Listener = () => void;

/** The bridge between the views and the host. Every extension is optional; callers check the flags. */
export class Host {
  readonly app: App;
  readonly openai: OpenAIExtensions;
  private listeners = new Set<Listener>();
  private viewListeners = new Set<(view: ViewPayload) => void>();
  private inputListeners = new Set<(args: Record<string, unknown>) => void>();

  constructor() {
    this.app = new App(
      { name: "fallow", version: "1.0.0" },
      { availableDisplayModes: ["inline", "fullscreen"] },
    );
    this.openai = new OpenAIExtensions(this.app);
    this.app.ontoolresult = (result) => {
      const view = viewOf(result as CallToolResult);
      if (view !== null) for (const listener of this.viewListeners) listener(view);
    };
    this.app.ontoolinput = ({ arguments: args }) => {
      for (const listener of this.inputListeners) listener(args ?? {});
    };
    this.app.onhostcontextchanged = () => {
      this.applyTheme();
      this.emit();
    };
  }

  /** Registers listeners before `connect`, so the first tool result is not missed. */
  async connect(): Promise<void> {
    await this.app.connect();
    this.applyTheme();
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onView(listener: (view: ViewPayload) => void): () => void {
    this.viewListeners.add(listener);
    return () => this.viewListeners.delete(listener);
  }

  onToolInput(listener: (args: Record<string, unknown>) => void): () => void {
    this.inputListeners.add(listener);
    return () => this.inputListeners.delete(listener);
  }

  private applyTheme(): void {
    const context = this.context();
    if (context?.theme !== undefined) applyDocumentTheme(context.theme);
    if (context?.styles?.variables !== undefined) applyHostStyleVariables(context.styles.variables);
    if (context?.styles?.css?.fonts !== undefined) applyHostFonts(context.styles.css.fonts);
    document.documentElement.dataset["display"] = context?.displayMode ?? "inline";
    document.documentElement.dataset["platform"] = context?.platform ?? "desktop";
  }

  context(): McpUiHostContext | undefined {
    return this.app.getHostContext();
  }

  get displayMode(): "inline" | "fullscreen" | "pip" {
    return this.context()?.displayMode ?? "inline";
  }

  get canExpand(): boolean {
    const modes = this.context()?.availableDisplayModes;
    return this.displayMode === "inline" && (modes === undefined || modes.includes("fullscreen"));
  }

  async expand(): Promise<void> {
    await this.app.requestDisplayMode({ mode: "fullscreen" });
  }

  /** Deep link path inside the app, for example `/findings?category=dead-code`. */
  get deepLink(): string | null {
    return this.openai.deepLink.getCurrent()?.url ?? null;
  }

  async call(name: string, args: Record<string, unknown> = {}): Promise<CallToolResult> {
    return (await this.app.callServerTool({ name, arguments: args })) as CallToolResult;
  }

  async callData<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
    const result = await this.call(name, args);
    if (result.isError === true) {
      const text = result.content.find((item) => item.type === "text");
      throw new Error(text?.type === "text" ? text.text : `${name} failed`);
    }
    return result.structuredContent as T;
  }

  get canAttach(): boolean {
    return this.openai.modelContext !== undefined;
  }

  get canMessage(): boolean {
    return this.openai.message !== undefined;
  }

  get canOpenFiles(): boolean {
    return this.openai.files !== undefined;
  }

  get canStartNewThread(): boolean {
    return this.canMessage && this.context()?.platform === "desktop";
  }

  /** Replaces the composer attachments of this app with the given findings. */
  async attach(project: ProjectRef, findings: Finding[]): Promise<void> {
    const modelContext = this.openai.modelContext;
    if (modelContext === undefined) return;
    const shown = findings.slice(0, MAX_CONTEXT_FINDINGS);
    await modelContext.update({
      content: shown.length === 0 ? [] : [...shown.map(findingBlock), backgroundBlock(project)],
      structuredContent: { project: project.root, findingIds: shown.map((finding) => finding.id) },
    });
  }

  /** Finding ids that are still attached. The user can remove a chip in the composer. */
  attachedIds(): Set<string> | null {
    const current = this.openai.modelContext?.getCurrent();
    if (current === undefined) return null;
    if (current === null) return new Set();
    return new Set(
      (current.content ?? []).flatMap((block) => {
        const id = block._meta?.[FINDING_META_KEY];
        return typeof id === "string" ? [id] : [];
      }),
    );
  }

  async send(
    text: string,
    findings: Finding[],
    project: ProjectRef | null,
    target: "active" | "new" = "active",
  ): Promise<void> {
    const message = this.openai.message;
    if (message === undefined) return;
    await message.send({
      role: "user",
      content: [
        { type: "text", text },
        ...findings.slice(0, MAX_CONTEXT_FINDINGS).map(findingBlock),
        ...(project === null ? [] : [backgroundBlock(project)]),
      ],
      ...(target === "new" ? { _meta: { "openai/message": { target: "new" } } } : {}),
    });
  }

  async openFile(path: string): Promise<boolean> {
    const files = this.openai.files;
    if (files === undefined) return false;
    await files.open(path);
    return true;
  }

  async openLink(url: string): Promise<void> {
    await this.app.openLink({ url });
  }
}
