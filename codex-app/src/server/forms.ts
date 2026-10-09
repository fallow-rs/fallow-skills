import { pathToFileURL } from "node:url";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  createElicitInput,
  type OpenAIFormRequestParams,
  type OpenAIFormResult,
} from "@openai/mcp-extensions/server";
import { z } from "zod";
import { CATEGORY_ORDER, CATEGORY_TITLES } from "../shared/categories.ts";
import type { CategoryId, Finding, ProjectRef } from "../shared/contracts.ts";
import { problemResult, READ_ONLY, type Extra, type ServerContext } from "./context.ts";
import { categoryThumbnail } from "./icons.ts";
import { resolveProject, sandboxFor, toLocalPath } from "./project.ts";
import { findingUri } from "./uris.ts";
import { openDashboard, pickerResult, uiMeta } from "./tools.ts";

const FORM_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_FINDING_OPTIONS = 40;
const DEFAULT_SELECTED = 8;

type Requested = OpenAIFormRequestParams["requestedSchema"];

const supportsForms = (context: ServerContext): boolean => {
  const capabilities = context.server.server.getClientCapabilities() as
    | { extensions?: Record<string, unknown> }
    | undefined;
  return capabilities?.extensions?.["openai/elicitation"] !== undefined;
};

const elicit = (
  context: ServerContext,
  message: string,
  requestedSchema: Requested,
): Promise<OpenAIFormResult> =>
  createElicitInput(context.server)(
    { mode: "form", message, requestedSchema },
    { timeout: FORM_TIMEOUT_MS, resetTimeoutOnProgress: true },
  );

const plain = (text: string): string => text.replace(/`/g, "");

const location = (finding: Finding): string =>
  finding.line === null ? finding.path : `${finding.path}:${finding.line}`;

/** Step 1: one tile per category, with counts. */
const categoryForm = (counts: Map<CategoryId, Finding[]>): Requested => ({
  type: "object",
  required: ["focus"],
  properties: {
    focus: {
      type: "string",
      title: "Focus",
      oneOf: CATEGORY_ORDER.filter((category) => (counts.get(category)?.length ?? 0) > 0).map(
        (category) => {
          const findings = counts.get(category) ?? [];
          const fixable = findings.filter((finding) =>
            finding.actions.some((action) => action.autoFixable),
          ).length;
          return {
            const: category,
            title: `${CATEGORY_TITLES[category]} (${findings.length})`,
            description:
              fixable > 0
                ? `${fixable} of ${findings.length} can be fixed with fallow fix.`
                : `${findings.length} ${findings.length === 1 ? "finding" : "findings"} to review.`,
            "x-openai-thumbnail": categoryThumbnail(category),
          };
        },
      ),
    },
  },
});

/** Step 2: the findings of the chosen category, with a preview card for each one. */
const findingsForm = (project: ProjectRef, findings: Finding[]): Requested => {
  const options = findings.slice(0, MAX_FINDING_OPTIONS).map((finding) => ({
    uri: findingUri(project.root, finding.id),
    name: location(finding),
    title: plain(finding.message),
    _meta: {
      "openai/thumbnail": categoryThumbnail(finding.category),
      "openai/preview": {
        target: {
          type: "mcp_app_tool",
          name: "fallow_show_finding",
          arguments: { id: finding.id, root: project.root },
        },
      },
    },
  }));
  const preferred = options
    .filter((_option, index) => findings[index]?.level === "error")
    .slice(0, DEFAULT_SELECTED)
    .map((option) => option.uri);
  return {
    type: "object",
    required: ["findings", "approach"],
    properties: {
      findings: {
        type: "array",
        title: "Findings",
        items: { type: "string", format: "uri" },
        minItems: 1,
        maxItems: MAX_FINDING_OPTIONS,
        "x-openai-input": { type: "resource", selection: "explicit", options },
        default:
          preferred.length > 0
            ? preferred
            : options.slice(0, DEFAULT_SELECTED).map((option) => option.uri),
      },
      approach: {
        type: "string",
        title: "Approach",
        default: "fix",
        oneOf: [
          {
            const: "fix",
            title: "Fix them now",
            description: "Codex verifies each finding with fallow, then changes the code.",
          },
          {
            const: "plan",
            title: "Write a plan first",
            description: "Codex groups the work into small steps and waits for your go-ahead.",
          },
          {
            const: "triage",
            title: "Triage false positives",
            description:
              "Codex checks which findings are real and proposes config or suppressions for the rest.",
          },
        ],
      },
      constraints: {
        type: "array",
        title: "Constraints",
        items: {
          type: "string",
          minLength: 1,
          maxLength: 200,
          "x-openai-suggestions": [
            { const: "Keep exported public API", title: "Keep exported public API" },
            { const: "Skip test files", title: "Skip test files" },
            { const: "Do not edit generated code", title: "Do not edit generated code" },
            { const: "Run the tests after each change", title: "Run the tests after each change" },
            { const: "One commit per category", title: "One commit per category" },
          ],
        },
      },
    },
  } as Requested;
};

const declined = (action: string): CallToolResult => ({
  content: [
    { type: "text", text: `The user closed the form (${action}). Do not start a cleanup.` },
  ],
  structuredContent: { status: action },
});

const APPROACH_INSTRUCTIONS: Record<string, string> = {
  fix: "Fix the selected findings. Run each `verify` command first and skip a finding that the evidence does not confirm. Keep each change small.",
  plan: "Write a short, numbered plan for the selected findings, grouped by file. Wait for the user to approve it before you edit code.",
  triage:
    "Check each selected finding with its `verify` command. Report which are real and which are false positives. For a false positive, propose a config change (entry, ignoreDependencies, ignoreExports) instead of an inline suppression.",
};

export const registerForms = (context: ServerContext): void => {
  const { server } = context;

  server.registerTool(
    "fallow_plan_cleanup",
    {
      title: "Plan a cleanup",
      description:
        "Let the user pick which Fallow findings to clean up in a form: a category, then the findings, the approach and constraints. Returns the selection with a verify command per finding. Use it when the user asks to clean up, remove dead code or reduce findings.",
      inputSchema: z.object({
        path: z
          .string()
          .max(4096)
          .optional()
          .describe("Folder to analyze. Omit it to use the project of this thread."),
        category: z
          .enum([
            "dead-code",
            "dependencies",
            "duplication",
            "complexity",
            "architecture",
            "frameworks",
            "hygiene",
          ])
          .optional()
          .describe("Skip the category step and go to the findings of this category."),
      }),
      annotations: READ_ONLY,
    },
    async ({ path, category }, extra: Extra) => {
      const resolved = await resolveProject(context.store, extra._meta, path);
      if (resolved === null)
        return pickerResult(context, "Fallow does not know which project to clean up yet.");
      const { project } = resolved;
      const settings = await context.store.settings();
      const analysis = await context.analyzer.analyze({
        project,
        settings,
        sandbox: sandboxFor(extra._meta),
      });
      if (!analysis.ok) return problemResult(analysis.problem, project);

      const byCategory = new Map<CategoryId, Finding[]>();
      for (const finding of analysis.findings) {
        byCategory.set(finding.category, [...(byCategory.get(finding.category) ?? []), finding]);
      }
      if (byCategory.size === 0) {
        return {
          content: [
            { type: "text", text: `${project.name} has no Fallow findings. Nothing to clean up.` },
          ],
          structuredContent: { project, findings: [] },
        };
      }
      if (!supportsForms(context)) {
        return {
          content: [
            {
              type: "text",
              text: "This client cannot show forms. Ask the user which findings to clean up.",
            },
          ],
          structuredContent: {
            project,
            formsSupported: false,
            categories: Object.fromEntries(
              [...byCategory].map(([id, findings]) => [id, findings.length]),
            ),
          },
        };
      }

      let focus: CategoryId | undefined = category;
      if (focus === undefined) {
        const first = await elicit(
          context,
          `What should Codex clean up first in ${project.name}?`,
          categoryForm(byCategory),
        );
        if (first.action !== "accept") return declined(first.action);
        focus = String(first.content["focus"]) as CategoryId;
      }
      const candidates = byCategory.get(focus) ?? [];
      if (candidates.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `${project.name} has no ${CATEGORY_TITLES[focus].toLowerCase()} findings.`,
            },
          ],
          structuredContent: { project, category: focus, findings: [] },
        };
      }

      const second = await elicit(
        context,
        `Choose the ${CATEGORY_TITLES[focus].toLowerCase()} findings to clean up. Open a finding to see its code.`,
        findingsForm(project, candidates),
      );
      if (second.action !== "accept") return declined(second.action);

      const chosen = new Set(
        (Array.isArray(second.content["findings"])
          ? second.content["findings"]
          : [second.content["findings"]]
        ).map(String),
      );
      const selected = candidates.filter((finding) =>
        chosen.has(findingUri(project.root, finding.id)),
      );
      const approach = String(second.content["approach"] ?? "fix");
      const constraints = Array.isArray(second.content["constraints"])
        ? second.content["constraints"].map(String)
        : [];
      return {
        content: [
          {
            type: "text",
            text: `${APPROACH_INSTRUCTIONS[approach] ?? APPROACH_INSTRUCTIONS["fix"]}`,
          },
        ],
        structuredContent: {
          project,
          category: focus,
          approach,
          instructions: APPROACH_INSTRUCTIONS[approach] ?? APPROACH_INSTRUCTIONS["fix"],
          constraints,
          findings: selected.map((finding) => ({
            id: finding.id,
            rule: finding.rule,
            location: location(finding),
            message: finding.message,
            verify: finding.verify,
            actions: finding.actions.map((action) => action.description),
          })),
        },
      };
    },
  );

  server.registerTool(
    "fallow_app_choose_project",
    {
      title: "Choose a project",
      description: "Ask the user for a project folder, then open its dashboard.",
      inputSchema: z.object({}),
      annotations: READ_ONLY,
      _meta: uiMeta(context, { visibility: ["app"] }),
    },
    async (_args, extra) => {
      if (!supportsForms(context))
        return pickerResult(context, "Pick a recent project, or open a folder in a Codex thread.");
      const recents = await context.store.recents();
      const options = recents.map((recent) => ({
        uri: pathToFileURL(recent.root).href,
        name: recent.name,
        title: recent.grade === null ? recent.name : `${recent.name} (grade ${recent.grade})`,
        description: recent.root,
      }));
      const form = await elicit(context, "Choose a JavaScript or TypeScript project for Fallow.", {
        type: "object",
        required: ["project"],
        properties: {
          project: {
            type: "string",
            title: "Project folder",
            format: "uri",
            "x-openai-input": { type: "resource", options, userOptions: { kind: "directory" } },
            ...(options[0] === undefined ? {} : { default: options[0].uri }),
          },
        },
      } as Requested);
      if (form.action !== "accept") return pickerResult(context, "No project was chosen.");
      const root = toLocalPath(String(form.content["project"]));
      if (root === null)
        return pickerResult(
          context,
          "Codex returned a folder that Fallow cannot read. Open the folder in a Codex thread instead.",
        );
      return openDashboard(context, extra, { root, waitMs: 1500 });
    },
  );
};
