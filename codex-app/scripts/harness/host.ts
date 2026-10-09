/**
 * A stand-in for the Codex host, for local development only. It embeds the built app in an iframe,
 * forwards tool calls and resource reads to the real server, and logs what the app sends to Codex.
 */
import { AppBridge, PostMessageTransport } from "@modelcontextprotocol/ext-apps/app-bridge";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

type Scenario = {
  id: string;
  label: string;
  tool: string;
  args: Record<string, unknown>;
  mode: "inline" | "fullscreen";
  width: number;
  file?: string;
  model?: boolean;
};

declare const SCENARIOS: Scenario[];
declare const PROJECT: string;

const $ = <T extends HTMLElement>(selector: string): T => {
  const element = document.querySelector<T>(selector);
  if (element === null) throw new Error(`Missing ${selector}`);
  return element;
};

const log = (kind: string, value: unknown): void => {
  const entry = document.createElement("details");
  entry.open = kind !== "tool";
  const summary = document.createElement("summary");
  summary.textContent = `${new Date().toLocaleTimeString()} ${kind}`;
  const body = document.createElement("pre");
  body.textContent = JSON.stringify(value, null, 2).slice(0, 6000);
  entry.append(summary, body);
  $("#log").prepend(entry);
};

const rpc = async (method: string, params: unknown): Promise<unknown> => {
  const response = await fetch("/rpc", {
    method: "POST",
    body: JSON.stringify({ method, params }),
  });
  const json = (await response.json()) as { result?: unknown; error?: string };
  if (json.error !== undefined) throw new Error(json.error);
  return json.result;
};

const LIGHT = {
  "--color-background-primary": "#ffffff",
  "--color-background-secondary": "rgba(255,255,255,0.96)",
  "--color-text-primary": "#0d0d0d",
  "--color-text-secondary": "#5d5d5d",
  "--color-border-primary": "rgba(13,13,13,0.12)",
  "--color-border-secondary": "rgba(13,13,13,0.08)",
  "--font-sans": "ui-sans-serif, -apple-system, system-ui, 'Segoe UI', sans-serif",
};
const DARK = {
  "--color-background-primary": "#181818",
  "--color-background-secondary": "rgba(40,40,40,0.96)",
  "--color-text-primary": "#f3f3f3",
  "--color-text-secondary": "#afafaf",
  "--color-border-primary": "rgba(255,255,255,0.14)",
  "--color-border-secondary": "rgba(255,255,255,0.08)",
  "--font-sans": "ui-sans-serif, -apple-system, system-ui, 'Segoe UI', sans-serif",
};

let bridge: AppBridge | null = null;
let current: Scenario | null = null;
let theme: "light" | "dark" = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
let modelContext: unknown = null;

const hostContext = (scenario: Scenario) => ({
  theme,
  displayMode: scenario.mode,
  availableDisplayModes: ["inline", "fullscreen"],
  platform: "desktop" as const,
  styles: { variables: theme === "dark" ? DARK : LIGHT },
  containerDimensions: { width: scenario.width, maxHeight: 4000 },
  toolInfo: { tool: { name: scenario.tool, inputSchema: { type: "object" as const } } },
  "openai/modelContext": modelContext,
});

const fileUri = (scenario: Scenario): string =>
  `host-resource://${encodeURIComponent(scenario.file ?? "")}`;

const mount = async (scenario: Scenario): Promise<void> => {
  current = scenario;
  modelContext = null;
  const stage = $("#stage");
  stage.replaceChildren();
  stage.style.width = `${scenario.width}px`;
  stage.dataset["mode"] = scenario.mode;
  document.documentElement.dataset["theme"] = theme;
  const frame = document.createElement("iframe");
  frame.title = scenario.label;
  frame.style.height = scenario.mode === "fullscreen" ? "100%" : "200px";
  stage.append(frame);

  const view = frame.contentWindow;
  if (view === null) return;
  bridge?.close().catch(() => undefined);
  const host = new AppBridge(null, { name: "fallow-harness", version: "1.0.0" }, {
    openLinks: {},
    serverTools: {},
    serverResources: {},
    updateModelContext: {
      text: {},
      image: {},
      resourceLink: {},
      resource: {},
      structuredContent: {},
    },
    message: { text: {} },
    experimental: {
      "openai/modelContext": {},
      "openai/message": {},
      "openai/files": {},
      ...(scenario.file === undefined ? {} : { "openai/resource": {} }),
    },
  } as never);
  bridge = host;

  host.oncalltool = async (params) => {
    const meta: Record<string, unknown> = {
      ...(params._meta ?? {}),
      threadId: "00000000-0000-4000-8000-000000000001",
    };
    if (scenario.file !== undefined) meta["openai/resource"] = { path: scenario.file };
    const result = (await rpc("tools/call", { ...params, _meta: meta })) as CallToolResult;
    log("tool", {
      name: params.name,
      arguments: params.arguments,
      structuredContent: result.structuredContent,
    });
    return result;
  };
  host.onreadresource = async (params) => {
    if (params.uri === fileUri(scenario)) {
      const file = (await rpc("harness/readFile", { path: scenario.file })) as {
        text: string;
        etag: string;
      };
      return {
        contents: [
          {
            uri: params.uri,
            text: file.text,
            _meta: { "openai/resource": { etag: file.etag, writable: true } },
          },
        ],
      };
    }
    return (await rpc("resources/read", params)) as never;
  };
  host.onupdatemodelcontext = async (params) => {
    const updateId = `update-${Date.now()}`;
    modelContext = { ...params, updateId };
    log("composer attachments", params);
    // Codex echoes the new attachments back as host context; do the same.
    setTimeout(() => void host.sendHostContextChange({ "openai/modelContext": modelContext } as never), 50);
    return { _meta: { "openai/modelContext": { updateId } } } as never;
  };
  host.onmessage = async (params) => {
    log("message to Codex", params);
    return {};
  };
  host.onopenlink = async (params) => {
    log("open link", params);
    return {};
  };
  host.onrequestdisplaymode = async (params) => {
    log("display mode", params);
    const next = {
      ...scenario,
      mode: params.mode === "fullscreen" ? "fullscreen" : "inline",
      width: params.mode === "fullscreen" ? 1180 : scenario.width,
    } as Scenario;
    current = next;
    stage.style.width = `${next.width}px`;
    stage.dataset["mode"] = next.mode;
    frame.style.height = next.mode === "fullscreen" ? "100%" : frame.style.height;
    await host.sendHostContextChange({
      displayMode: next.mode,
      containerDimensions: { width: next.width, maxHeight: 4000 },
    } as never);
    return { mode: next.mode };
  };
  host.onsizechange = ({ height }) => {
    if (current?.mode !== "fullscreen" && height !== undefined)
      frame.style.height = `${Math.ceil(height)}px`;
  };
  host.fallbackRequestHandler = async (request) => {
    log(request.method, request.params);
    if (request.method === "openai/files/open") return {};
    if (request.method === "openai/resources/write") {
      const params = request.params as { text: string; ifMatch?: string };
      return (await rpc("harness/writeFile", {
        path: scenario.file,
        text: params.text,
        ifMatch: params.ifMatch,
      })) as never;
    }
    if (request.method === "resources/subscribe" || request.method === "resources/unsubscribe")
      return {};
    throw new Error(`Unsupported ${request.method}`);
  };

  host.oninitialized = async () => {
    await host.sendToolInput({ arguments: scenario.args });
    const meta: Record<string, unknown> = { threadId: "00000000-0000-4000-8000-000000000001" };
    if (scenario.model === true)
      meta["codex/sandbox-state-meta"] = { sandboxCwd: `file://${PROJECT}` };
    const args =
      scenario.file === undefined
        ? scenario.args
        : { file: { name: scenario.file.split("/").pop(), resourceUri: fileUri(scenario) } };
    const result = (await rpc("tools/call", {
      name: scenario.tool,
      arguments: args,
      _meta: meta,
    })) as CallToolResult;
    log("tool result", { name: scenario.tool, structuredContent: result.structuredContent });
    await host.sendToolResult(result as never);
  };
  await host.connect(new PostMessageTransport(view, view));
  host.setHostContext(hostContext(scenario) as never);
  frame.src = "/app.html";
};

const nav = $("#scenarios");
for (const scenario of SCENARIOS) {
  const button = document.createElement("button");
  button.textContent = scenario.label;
  button.onclick = () => void mount(scenario);
  nav.append(button);
}
$<HTMLButtonElement>("#theme").onclick = () => {
  theme = theme === "dark" ? "light" : "dark";
  if (current !== null) void mount(current);
};
const elicitations = new EventSource("/elicitations");
elicitations.onmessage = (event) => {
  const request = JSON.parse(event.data) as {
    id: number;
    params: { message: string; requestedSchema: unknown };
  };
  const dialog = $<HTMLDialogElement>("#form");
  $("#form-message").textContent = request.params.message;
  $("#form-schema").textContent = JSON.stringify(request.params.requestedSchema, null, 2);
  const answer = (action: string): void => {
    void fetch("/elicitations", {
      method: "POST",
      body: JSON.stringify({
        id: request.id,
        action,
        content: (window as unknown as { formContent?: unknown }).formContent,
      }),
    });
    dialog.close();
  };
  $<HTMLButtonElement>("#form-accept").onclick = () => answer("accept");
  $<HTMLButtonElement>("#form-decline").onclick = () => answer("decline");
  dialog.showModal();
};
const initial = SCENARIOS.find(
  (scenario) => scenario.id === new URLSearchParams(location.search).get("scenario"),
);
if (initial !== undefined) void mount(initial);
