import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  OpenAIFileEntrypointInputSchema,
  type OpenAIUiEntrypoint,
  type OpenAIUiToolMetadata,
} from "@openai/mcp-extensions/server";
import { z } from "zod";
import type { Finding, ProjectRef, Report } from "../shared/contracts.ts";
import type { Analysis } from "./analysis.ts";
import { appFacing, isKnownRoot, problemResult, READ_ONLY, viewResult, type Extra, type ServerContext } from "./context.ts";
import { fallowVersion } from "./fallow-cli.ts";
import { AUDIT_ICON } from "./icons.ts";
import { resolveProject, sandboxFor, sandboxFromMeta } from "./project.ts";
import { BASE_REF_PATTERN } from "./state.ts";
import { auditSummary, auditText, findingMarkdown, reportSummary, reportText } from "./summary.ts";

type Visibility = Array<"model" | "app">;

/** Tool `_meta` that links a tool to the app resource, and optionally adds entrypoints. */
export const uiMeta = (
  context: ServerContext,
  options: { entrypoints?: OpenAIUiEntrypoint[]; visibility?: Visibility } = {},
): Record<string, unknown> => ({
  ui: {
    resourceUri: context.uiUri,
    ...(options.visibility === undefined ? {} : { visibility: options.visibility }),
  },
  "openai/ui": {
    ...(options.entrypoints === undefined ? {} : { entrypoints: options.entrypoints }),
    preferredModelDisplayMode: "inline",
  } satisfies OpenAIUiToolMetadata,
  "openai/iconStyle": "monochrome",
});

const ENTRYPOINT_WAIT_MS = 1500;

const PATH_ARGUMENT = z
  .string()
  .max(4096)
  .optional()
  .describe(
    "Folder to analyze, absolute or relative to the thread working directory. Omit it to use the project of this thread.",
  );

const timeout = (ms: number): Promise<"timeout"> =>
  new Promise((resolve) => {
    setTimeout(() => resolve("timeout"), ms).unref();
  });

/** The folder policy for a tool call; see `resolveProject`. */
export const rootPolicy =
  (context: ServerContext, trusted: boolean | undefined) =>
  async (root: string): Promise<boolean> =>
    trusted === true || (await isKnownRoot(context, root));

export const pickerResult = async (
  context: ServerContext,
  reason: string,
): Promise<CallToolResult> => {
  const recents = await context.store.recents();
  return viewResult(
    { view: "picker", recents, reason },
    { needsProject: true, reason, recentProjects: recents.map((recent) => recent.root) },
    `${reason} Ask the user which folder to analyze, or pass a path.`,
  );
};

const recordRecent = async (context: ServerContext, report: Report): Promise<void> => {
  await context.store.touchRecent({
    root: report.project.root,
    name: report.project.name,
    lastOpenedAt: new Date().toISOString(),
    grade: report.score?.grade ?? null,
    score: report.score?.value ?? null,
  });
};

interface DashboardOptions {
  root?: string | undefined;
  route?: string | null | undefined;
  scope?: Report["scope"] | undefined;
  base?: string | undefined;
  production?: boolean | undefined;
  force?: boolean | undefined;
  /** Model-only tools may name any folder outside a thread; app-facing tools only known projects. */
  trusted?: boolean | undefined;
  /** Entrypoints return a loading view after this time, and the app finishes the run. */
  waitMs?: number | undefined;
}

/** Shared by the sidebar, the thread tab, the model tool and the app refresh. */
export const openDashboard = async (
  context: ServerContext,
  extra: Extra,
  options: DashboardOptions,
): Promise<CallToolResult> => {
  const resolved = await resolveProject(context.store, extra._meta, options.root, rootPolicy(context, options.trusted));
  if (resolved === null)
    return pickerResult(context, "Fallow does not know which project to analyze yet.");
  const { project } = resolved;
  const settings = await context.store.settings();
  const scope = options.scope ?? settings.scope;
  const pending = context.analyzer.analyze({
    project,
    settings,
    sandbox: sandboxFor(extra._meta),
    scope,
    ...(options.base === undefined ? {} : { base: options.base }),
    ...(options.production === undefined ? {} : { production: options.production }),
    ...(options.force === undefined ? {} : { force: options.force }),
  });
  const analysis: Analysis | "timeout" =
    options.waitMs === undefined
      ? await pending
      : await Promise.race([pending, timeout(options.waitMs)]);
  const route = options.route ?? null;
  if (analysis === "timeout") {
    return viewResult(
      { view: "loading", project, route, scope },
      { project, status: "analyzing" },
      `Fallow is analyzing ${project.name}.`,
    );
  }
  if (!analysis.ok) return problemResult(analysis.problem, project);
  await recordRecent(context, analysis.report);
  const limit = settings.findingsForCodex;
  return viewResult(
    { view: "dashboard", report: analysis.report, route },
    reportSummary(analysis.report, analysis.findings, limit),
    reportText(analysis.report, analysis.findings, limit),
  );
};

export const openAudit = async (
  context: ServerContext,
  extra: Extra,
  options: { root?: string | undefined; base?: string | undefined; trusted?: boolean },
): Promise<CallToolResult> => {
  const resolved = await resolveProject(context.store, extra._meta, options.root, rootPolicy(context, options.trusted));
  if (resolved === null)
    return pickerResult(context, "Fallow does not know which project to audit yet.");
  const settings = await context.store.settings();
  const outcome = await context.analyzer.audit({
    project: resolved.project,
    settings,
    sandbox: sandboxFor(extra._meta),
    ...(options.base === undefined ? {} : { base: options.base }),
  });
  if (!outcome.ok) return problemResult(outcome.problem, resolved.project);
  const limit = settings.findingsForCodex;
  return viewResult(
    { view: "audit", audit: outcome.audit },
    auditSummary(outcome.audit, limit),
    auditText(outcome.audit, limit),
  );
};

/** Finds one finding in the newest report of a project, and runs fallow when no report exists yet. */
const findFinding = async (
  context: ServerContext,
  extra: Extra,
  id: string,
  root: string | undefined,
): Promise<{ project: ProjectRef; finding: Finding } | null> => {
  const resolved = await resolveProject(context.store, extra._meta, root, rootPolicy(context, false));
  if (resolved === null) return null;
  const cached = context.analyzer.latest(resolved.project.root);
  const findings =
    cached?.findings ??
    (await (async () => {
      const analysis = await context.analyzer.analyze({
        project: resolved.project,
        settings: await context.store.settings(),
        sandbox: sandboxFor(extra._meta),
      });
      return analysis.ok ? analysis.findings : [];
    })());
  const finding = findings.find((candidate) => candidate.id === id);
  return finding === undefined ? null : { project: resolved.project, finding };
};

export const registerTools = (context: ServerContext): void => {
  const { server } = context;
  const app = appFacing(server);

  app.registerTool(
    "fallow_dashboard",
    {
      title: "Fallow",
      description: "Open the Fallow code health dashboard for a project.",
      inputSchema: z.object({ root: z.string().optional(), route: z.string().max(512).optional() }),
      annotations: READ_ONLY,
      _meta: uiMeta(context, {
        visibility: ["app"],
        entrypoints: [
          {
            type: "global",
            quickAction: {
              title: "Audit this branch",
              icons: [AUDIT_ICON],
              target: { type: "tool", name: "fallow_app_audit", arguments: {} },
            },
          },
        ],
      }),
    },
    async ({ root, route }, extra) =>
      openDashboard(context, extra, { root, route, waitMs: ENTRYPOINT_WAIT_MS }),
  );

  app.registerTool(
    "fallow_code_health",
    {
      title: "Code Health",
      description: "Show the code health of this thread's project beside the conversation.",
      inputSchema: z.object({ root: z.string().optional() }),
      annotations: READ_ONLY,
      _meta: uiMeta(context, { visibility: ["app"], entrypoints: [{ type: "thread" }] }),
    },
    async ({ root }, extra) => openDashboard(context, extra, { root, waitMs: ENTRYPOINT_WAIT_MS }),
  );

  app.registerTool(
    "fallow_open_config",
    {
      title: "Fallow Config",
      description: "Edit a Fallow config file with rule controls and a live impact preview.",
      inputSchema: OpenAIFileEntrypointInputSchema,
      annotations: READ_ONLY,
      _meta: uiMeta(context, {
        visibility: ["app"],
        entrypoints: [{ type: "file", extensions: [".fallowrc.json", ".fallowrc.jsonc"] }],
      }),
    },
    async ({ file }) =>
      viewResult(
        { view: "config", file },
        { opened: file.name },
        `Opened ${file.name} in the Fallow config editor.`,
      ),
  );

  app.registerTool(
    "fallow_open_sarif",
    {
      title: "SARIF Findings",
      description: "Browse a SARIF report from Fallow or any other analyzer.",
      inputSchema: OpenAIFileEntrypointInputSchema,
      annotations: READ_ONLY,
      _meta: uiMeta(context, {
        visibility: ["app"],
        entrypoints: [{ type: "file", extensions: [".sarif"] }],
      }),
    },
    async ({ file }) =>
      viewResult(
        { view: "sarif", file },
        { opened: file.name },
        `Opened ${file.name} in the SARIF viewer.`,
      ),
  );

  server.registerTool(
    "fallow_analyze",
    {
      title: "Analyze code health",
      description:
        "Run Fallow on the project: dead code, unused dependencies, duplication, complexity, circular dependencies and boundaries. Shows a dashboard to the user and returns the score and the top findings, each with a command that verifies it. Use it before cleanup or refactoring work, and to answer questions about code health.",
      inputSchema: z.object({
        path: PATH_ARGUMENT,
        scope: z
          .enum(["full", "changed"])
          .optional()
          .describe(
            "full analyzes every file. changed analyzes only files changed since `base`. Default: the user setting.",
          ),
        base: z
          .string()
          .regex(new RegExp(BASE_REF_PATTERN))
          .optional()
          .describe("Git ref for scope=changed, for example main."),
        production: z
          .boolean()
          .optional()
          .describe("Analyze production code only: no tests, stories or dev tooling."),
        refresh: z
          .boolean()
          .optional()
          .describe("Ignore a report from the last 10 minutes and run again."),
      }),
      annotations: READ_ONLY,
      _meta: uiMeta(context, { visibility: ["model"] }),
    },
    async ({ path, scope, base, production, refresh }, extra) =>
      openDashboard(context, extra, {
        root: path,
        scope,
        base,
        production,
        force: refresh,
        // Any folder only with a Codex sandbox; without one, a folder must be a known project.
        trusted: sandboxFromMeta(extra._meta) !== null,
      }),
  );

  server.registerTool(
    "fallow_audit",
    {
      title: "Audit this branch",
      description:
        "Gate the changes of the current branch before a commit or a pull request. Returns pass, warn or fail, and separates findings that the branch introduced from findings that existed before.",
      inputSchema: z.object({
        path: PATH_ARGUMENT,
        base: z
          .string()
          .regex(new RegExp(BASE_REF_PATTERN))
          .optional()
          .describe("Git ref to compare against. Omit it to let fallow detect the base branch."),
      }),
      annotations: READ_ONLY,
      _meta: uiMeta(context, { visibility: ["model"] }),
    },
    async ({ path, base }, extra) => openAudit(context, extra, { root: path, base, trusted: sandboxFromMeta(extra._meta) !== null }),
  );

  app.registerTool(
    "fallow_show_finding",
    {
      title: "Show a finding",
      description:
        "Show one Fallow finding with its code, evidence and fix options. Use the `id` from fallow_analyze.",
      inputSchema: z.object({ id: z.string().min(1).max(512), root: z.string().optional() }),
      annotations: READ_ONLY,
      _meta: uiMeta(context),
    },
    async ({ id, root }, extra) => {
      const found = await findFinding(context, extra, id, root);
      if (found === null) {
        return {
          content: [
            {
              type: "text",
              text: `No finding with id ${id}. Run fallow_analyze again; ids change when code changes.`,
            },
          ],
          structuredContent: { error: "finding_not_found", id },
          isError: true,
        };
      }
      return viewResult(
        { view: "finding", finding: found.finding, project: found.project },
        { project: found.project, finding: found.finding },
        findingMarkdown(found.finding, found.project),
      );
    },
  );

  app.registerTool(
    "fallow_check_install",
    {
      title: "Check Fallow installation",
      description: "Report which fallow binary the plugin uses and its version.",
      inputSchema: z.object({}),
      annotations: READ_ONLY,
    },
    async (_args, extra) => {
      const resolved = await resolveProject(context.store, extra._meta, undefined);
      const settings = await context.store.settings();
      const root = resolved?.project.root ?? process.cwd();
      const version = await fallowVersion(root, settings.source);
      const text = version.ok
        ? `fallow ${version.version} (${version.binary}).${resolved === null ? "" : ` Project: ${resolved.project.name}.`}`
        : `${version.problem.title}. Install it with: ${version.problem.fix ?? "npm install --save-dev fallow"}`;
      return {
        content: [{ type: "text", text }],
        structuredContent: version.ok
          ? { version: version.version, binary: version.binary }
          : { error: version.problem.code },
      };
    },
  );
};
