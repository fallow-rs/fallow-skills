import { execFile } from "node:child_process";
import type { AuditResult, FallowProblem, Finding, ProjectRef, Report } from "../shared/contracts.ts";
import { runFallow, type RunResult, type SandboxState } from "./fallow-cli.ts";
import { allFindings, toAudit, toReport } from "./normalize.ts";
import type { AppSettings } from "./state.ts";

export interface AnalyzeRequest {
  project: ProjectRef;
  settings: AppSettings;
  sandbox: SandboxState | null;
  scope?: Report["scope"];
  base?: string;
  production?: boolean;
  force?: boolean;
  /** Extra fallow arguments, for example `--config <draft>` for a config preview. Never cached. */
  extraArgs?: readonly string[];
}

export type Analysis =
  | { ok: true; report: Report; findings: Finding[] }
  | { ok: false; problem: FallowProblem };

export type AuditOutcome =
  | { ok: true; audit: AuditResult }
  | { ok: false; problem: FallowProblem };

interface CacheEntry {
  key: string;
  report: Report;
  findings: Finding[];
  storedAt: number;
}

const FRESH_FOR_MS = 10 * 60 * 1000;
const MAX_ENTRIES = 12;

const defaultBranch = (root: string): Promise<string> =>
  new Promise((resolve) => {
    execFile(
      "git",
      ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"],
      { cwd: root, timeout: 5000, windowsHide: true },
      (error, stdout) =>
        resolve(error === null && stdout.trim().length > 0 ? stdout.trim() : "main"),
    );
  });

const keyOf = (root: string, scope: string, base: string | null, production: boolean): string =>
  JSON.stringify([root, scope, base, production]);

/** Runs fallow, keeps the latest reports in memory, and joins concurrent runs for the same key. */
export const createAnalyzer = () => {
  const cache = new Map<string, CacheEntry>();
  const running = new Map<string, Promise<Analysis>>();

  const remember = (entry: CacheEntry): void => {
    cache.delete(entry.key);
    cache.set(entry.key, entry);
    while (cache.size > MAX_ENTRIES) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
  };

  const analyze = async (request: AnalyzeRequest): Promise<Analysis> => {
    const { project, settings } = request;
    const scope = request.scope ?? settings.scope;
    const production = request.production ?? settings.production;
    const base =
      scope === "changed"
        ? (request.base ??
          (settings.baseRef.length > 0 ? settings.baseRef : await defaultBranch(project.root)))
        : null;
    const key = keyOf(project.root, scope, base, production);
    const cacheable = request.extraArgs === undefined;

    if (cacheable && request.force !== true) {
      const hit = cache.get(key);
      if (hit !== undefined && Date.now() - hit.storedAt < FRESH_FOR_MS) {
        return { ok: true, report: hit.report, findings: hit.findings };
      }
      const pending = running.get(key);
      if (pending !== undefined) return pending;
    }

    const args = ["--score", "--format", "json", "--quiet"];
    if (production) args.push("--production");
    if (base !== null) args.push("--changed-since", base);
    if (request.extraArgs !== undefined) args.push(...request.extraArgs);

    const work = (async (): Promise<Analysis> => {
      const analyzedAt = new Date().toISOString();
      const result: RunResult = await runFallow({
        root: project.root,
        args,
        source: settings.source,
        sandbox: settings.sandbox ? request.sandbox : null,
      });
      if (!result.ok) return result;
      const report = toReport(result.json, { project, scope, base, analyzedAt });
      const findings = allFindings(project.root, result.json);
      if (cacheable) remember({ key, report, findings, storedAt: Date.now() });
      return { ok: true, report, findings };
    })();

    if (!cacheable) return work;
    running.set(key, work);
    try {
      return await work;
    } finally {
      running.delete(key);
    }
  };

  const audit = async (request: Omit<AnalyzeRequest, "scope" | "force">): Promise<AuditOutcome> => {
    const { project, settings } = request;
    const base = request.base ?? (settings.baseRef.length > 0 ? settings.baseRef : null);
    const args = ["audit", "--format", "json", "--quiet"];
    if (base !== null) args.push("--base", base);
    if (request.production ?? settings.production) args.push("--production");
    const analyzedAt = new Date().toISOString();
    const result = await runFallow({
      root: project.root,
      args,
      source: settings.source,
      sandbox: settings.sandbox ? request.sandbox : null,
    });
    if (!result.ok) return result;
    return { ok: true, audit: toAudit(result.json, project, analyzedAt) };
  };

  /** The newest full report of a root, at any age. Used by mention search and resource reads. */
  const latest = (root?: string): CacheEntry | null => {
    const entries = [...cache.values()].reverse();
    return (
      entries.find((entry) => root === undefined || entry.report.project.root === root) ?? null
    );
  };

  return { analyze, audit, latest };
};

export type Analyzer = ReturnType<typeof createAnalyzer>;
