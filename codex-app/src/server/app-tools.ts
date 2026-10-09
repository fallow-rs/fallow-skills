import { randomBytes } from "node:crypto";
import { open, realpath, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { parse, printParseErrorCode, type ParseError } from "jsonc-parser";
import { z } from "zod";
import { CATEGORY_ORDER } from "../shared/categories.ts";
import type { ConfigPreview, LocatedFile } from "../shared/contracts.ts";
import { dataResult, READ_ONLY, type Extra, type ServerContext } from "./context.ts";
import { runFallow } from "./fallow-cli.ts";
import { record, string } from "./json.ts";
import {
  describeProject,
  detectProjectRoot,
  resourcePathFromMeta,
  toLocalPath,
} from "./project.ts";
import { openAudit, openDashboard, uiMeta } from "./tools.ts";

const APP_ONLY = { ui: { visibility: ["app"] } };
const MAX_SOURCE_BYTES = 2 * 1024 * 1024;
const RULE_ID = /^[a-z0-9][a-z0-9-]{0,80}$/;

export const isWithin = (base: string, candidate: string): boolean => {
  const path = relative(base, candidate);
  return path === "" || (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path));
};

const fileExists = async (path: string): Promise<boolean> => {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
};

/** Resolves a path from a report or a SARIF file to an absolute file inside an allowed base folder. */
export const locate = async (bases: string[], target: string): Promise<LocatedFile | null> => {
  const absolute = toLocalPath(target);
  for (const base of bases) {
    const candidate = absolute ?? resolve(base, target.replace(/^\.\//, ""));
    if (!isWithin(base, candidate)) continue;
    if (await fileExists(candidate)) return { path: candidate, exists: true };
  }
  return null;
};

/** Base folders for an app call: the project root it names, or the folder of the file entrypoint. */
const basesFor = async (extra: Extra, root: string | undefined): Promise<string[]> => {
  const bases: string[] = [];
  if (root !== undefined && isAbsolute(root)) bases.push(resolve(root));
  const opened = resourcePathFromMeta(extra._meta);
  if (opened !== null) {
    bases.push(dirname(opened));
    bases.push(await detectProjectRoot(dirname(opened)));
  }
  return [...new Set(bases)];
};

const readLines = async (path: string, line: number, context: number) => {
  const handle = await open(path, "r");
  try {
    const { size } = await handle.stat();
    if (size > MAX_SOURCE_BYTES) return null;
    const text = (await handle.readFile()).toString("utf8");
    const all = text.split(/\r?\n/);
    const start = Math.max(1, line - context);
    const end = Math.min(all.length, line + context);
    return {
      startLine: start,
      lines: all
        .slice(start - 1, end)
        .map((value) => (value.length > 400 ? `${value.slice(0, 400)}…` : value)),
    };
  } finally {
    await handle.close();
  }
};

const explainCache = new Map<string, Record<string, unknown>>();
let schemaCache: Record<string, unknown> | null = null;

export const registerAppTools = (context: ServerContext): void => {
  const { server } = context;

  server.registerTool(
    "fallow_app_run",
    {
      title: "Refresh analysis",
      inputSchema: z.object({
        root: z.string(),
        scope: z.enum(["full", "changed"]).optional(),
        production: z.boolean().optional(),
        force: z.boolean().optional(),
      }),
      annotations: READ_ONLY,
      _meta: uiMeta(context, { visibility: ["app"] }),
    },
    async ({ root, scope, production, force }, extra) =>
      openDashboard(context, extra, { root, scope, production, force }),
  );

  server.registerTool(
    "fallow_app_audit",
    {
      title: "Audit branch",
      inputSchema: z.object({ root: z.string(), base: z.string().optional() }),
      annotations: READ_ONLY,
      _meta: uiMeta(context, { visibility: ["app"] }),
    },
    async ({ root, base }, extra) => openAudit(context, extra, { root, base }),
  );

  server.registerTool(
    "fallow_app_locate",
    {
      title: "Locate a file",
      inputSchema: z.object({ path: z.string().min(1).max(4096), root: z.string().optional() }),
      annotations: READ_ONLY,
      _meta: APP_ONLY,
    },
    async ({ path, root }, extra) => {
      const located = await locate(await basesFor(extra, root), path);
      return dataResult(located === null ? { path: null, exists: false } : { ...located });
    },
  );

  server.registerTool(
    "fallow_app_source",
    {
      title: "Read source lines",
      inputSchema: z.object({
        root: z.string(),
        path: z.string().min(1).max(4096),
        line: z.number().int().min(1),
        context: z.number().int().min(0).max(40).default(6),
      }),
      annotations: READ_ONLY,
      _meta: APP_ONLY,
    },
    async ({ root, path, line, context: around }, extra) => {
      const located = await locate(await basesFor(extra, root), path);
      if (located === null) return dataResult({ found: false });
      const real = await realpath(located.path);
      const base = await realpath(resolve(root)).catch(() => null);
      if (base !== null && !isWithin(base, real)) return dataResult({ found: false });
      const snippet = await readLines(real, line, around).catch(() => null);
      return dataResult(
        snippet === null
          ? { found: false }
          : { found: true, ...snippet, language: extname(real).slice(1) },
      );
    },
  );

  server.registerTool(
    "fallow_app_explain",
    {
      title: "Explain a rule",
      inputSchema: z.object({ rule: z.string().regex(RULE_ID), root: z.string() }),
      annotations: READ_ONLY,
      _meta: APP_ONLY,
    },
    async ({ rule, root }) => {
      const cached = explainCache.get(rule);
      if (cached !== undefined) return dataResult(cached);
      const settings = await context.store.settings();
      const result = await runFallow({
        root: resolve(root),
        args: ["explain", rule, "--format", "json"],
        source: settings.source,
        sandbox: null,
        timeoutMs: 30_000,
      });
      if (!result.ok) return dataResult({ found: false });
      const json = result.json;
      const explained = {
        found: true,
        name: string(json["name"]) ?? rule,
        summary: string(json["summary"]),
        rationale: string(json["rationale"]),
        example: string(json["example"]),
        howToFix: string(json["how_to_fix"]),
        docs: string(json["docs"]),
      };
      explainCache.set(rule, explained);
      return dataResult(explained);
    },
  );

  server.registerTool(
    "fallow_app_config_schema",
    {
      title: "Read the config schema",
      inputSchema: z.object({}),
      annotations: READ_ONLY,
      _meta: APP_ONLY,
    },
    async (_args, extra) => {
      if (schemaCache !== null) return dataResult(schemaCache);
      const opened = resourcePathFromMeta(extra._meta);
      const root = opened === null ? process.cwd() : dirname(opened);
      const settings = await context.store.settings();
      const result = await runFallow({
        root,
        args: ["config-schema"],
        source: settings.source,
        sandbox: null,
        timeoutMs: 30_000,
      });
      if (!result.ok) return dataResult({ rules: [], error: result.problem.detail });
      const definitions = record(result.json["$defs"] ?? result.json["definitions"]);
      const ruleProperties = record(record(definitions["RulesConfig"])["properties"]);
      const properties = record(result.json["properties"]);
      const describe = (key: string) => string(record(properties[key])["description"]);
      schemaCache = {
        rules: Object.entries(ruleProperties).map(([key, value]) => ({
          key,
          description: string(record(value)["description"]) ?? "",
          default: string(record(value)["default"]) ?? "error",
        })),
        fields: {
          entry: describe("entry"),
          ignorePatterns: describe("ignorePatterns"),
          ignoreDependencies: describe("ignoreDependencies"),
          production: describe("production"),
        },
      };
      return dataResult(schemaCache);
    },
  );

  server.registerTool(
    "fallow_app_preview_config",
    {
      title: "Preview a config change",
      description: "Run fallow with the saved config and with a draft, and compare the findings.",
      inputSchema: z.object({ text: z.string().max(512 * 1024) }),
      annotations: READ_ONLY,
      _meta: APP_ONLY,
    },
    async ({ text }, extra) => {
      const opened = resourcePathFromMeta(extra._meta);
      const fail = (error: string): ReturnType<typeof dataResult> =>
        dataResult({
          ok: false,
          before: null,
          after: null,
          error,
          byCategory: [],
        } satisfies ConfigPreview);
      if (opened === null) return fail("Open the config file in Codex to preview a change.");

      const errors: ParseError[] = [];
      parse(text, errors, { allowTrailingComma: true });
      const firstError = errors[0];
      if (firstError !== undefined)
        return fail(
          `The draft is not valid JSON: ${printParseErrorCode(firstError.error)} at offset ${firstError.offset}.`,
        );

      const folder = dirname(opened);
      const root = await detectProjectRoot(folder);
      const project = await describeProject(root);
      const settings = await context.store.settings();
      // The draft sits next to the real file, so relative `extends` and plugin paths resolve the same way.
      const draft = join(
        folder,
        `.fallowrc.preview-${randomBytes(4).toString("hex")}${extname(opened) || ".json"}`,
      );
      try {
        await writeFile(draft, text, { encoding: "utf8", flag: "wx" });
        const [saved, changed] = await Promise.all([
          context.analyzer.analyze({
            project,
            settings,
            sandbox: null,
            scope: "full",
            extraArgs: ["--config", opened],
          }),
          context.analyzer.analyze({
            project,
            settings,
            sandbox: null,
            scope: "full",
            extraArgs: ["--config", draft],
          }),
        ]);
        if (!saved.ok) return fail(saved.problem.detail);
        if (!changed.ok)
          return fail(changed.problem.detail.replaceAll(basename(draft), basename(opened)));
        return dataResult({
          ok: true,
          before: saved.report.counts.total,
          after: changed.report.counts.total,
          error: null,
          byCategory: CATEGORY_ORDER.map((category) => ({
            category,
            before: saved.report.counts.byCategory[category],
            after: changed.report.counts.byCategory[category],
          })).filter((row) => row.before !== row.after || row.before > 0),
        } satisfies ConfigPreview);
      } catch (error) {
        return fail(error instanceof Error ? error.message : "The preview failed.");
      } finally {
        await rm(draft, { force: true });
      }
    },
  );
};

