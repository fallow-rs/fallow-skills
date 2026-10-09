import { execFile } from "node:child_process";
import type {
  AuditResult,
  FallowProblem,
  Finding,
  ProjectRef,
  Report,
} from "../shared/contracts.ts";
import { ignoredBase, runFallow, type RunResult, type SandboxState } from "./fallow-cli.ts";
import { BASE_REF_PATTERN } from "./state.ts";
import { allFindings, toAudit, toReport } from "./normalize.ts";
import type { AppSettings } from "./state.ts";

interface AnalyzeRequest {
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

type AuditOutcome = { ok: true; audit: AuditResult } | { ok: false; problem: FallowProblem };

interface CacheEntry {
  key: string;
  report: Report;
  findings: Finding[];
  /** When the run that produced this entry started, so an older run never replaces a newer one. */
  startedAt: number;
  storedAt: number;
}

interface AnalyzerMethods {
  analyze: (request: AnalyzeRequest) => Promise<Analysis>;
  audit: (request: Omit<AnalyzeRequest, "scope" | "force">) => Promise<AuditOutcome>;
  latest: (root?: string) => CacheEntry | null;
  hasSeen: (root: string) => boolean;
}

const unexpected = (error: unknown): FallowProblem => ({
  code: "internal_error",
  title: "The Fallow app failed",
  detail: error instanceof Error ? error.message : String(error),
  fix: null,
});

const VERDICTS = new Set(["pass", "warn", "fail"]);

const FRESH_FOR_MS = 10 * 60 * 1000;
const MAX_ENTRIES = 12;

const defaultBranch = (root: string): Promise<string> =>
  new Promise((resolve) => {
    execFile(
      "git",
      ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"],
      { cwd: root, timeout: 5000, windowsHide: true },
      (error, stdout) => {
        // The ref comes from the repository; it must still look like a ref, not a flag.
        const ref = stdout.trim();
        resolve(
          error === null && new RegExp(BASE_REF_PATTERN).test(ref) && ref.length > 0 ? ref : "main",
        );
      },
    );
  });

const keyOf = (root: string, scope: string, base: string | null, production: boolean): string =>
  JSON.stringify([root, scope, base, production]);

interface AnalysisRun {
  request: AnalyzeRequest;
  scope: Report["scope"];
  base: string | null;
  args: string[];
  key: string;
  cacheable: boolean;
  startedAt: number;
}

const analysisBase = (
  request: AnalyzeRequest,
  scope: Report["scope"],
): string | null | Promise<string> => {
  if (scope !== "changed") return null;
  return (
    request.base ??
    (request.settings.baseRef.length > 0
      ? request.settings.baseRef
      : defaultBranch(request.project.root))
  );
};

const analysisOptions = (
  request: AnalyzeRequest,
): {
  scope: Report["scope"];
  production: boolean;
  base: string | null | Promise<string>;
} => {
  const scope = request.scope ?? request.settings.scope;
  return {
    scope,
    production: request.production ?? request.settings.production,
    base: analysisBase(request, scope),
  };
};

const analysisArgs = (
  request: AnalyzeRequest,
  production: boolean,
  base: string | null,
): string[] => {
  const args = ["--score", "--format", "json", "--quiet"];
  if (production) args.push("--production");
  if (base !== null) args.push("--changed-since", base);
  if (request.extraArgs !== undefined) args.push(...request.extraArgs);
  return args;
};

const completedReport = (
  run: AnalysisRun,
  result: Extract<RunResult, { ok: true }>,
  fellBack: boolean,
  analyzedAt: string,
): Report => ({
  ...toReport(result.json, {
    project: run.request.project,
    scope: fellBack ? "full" : run.scope,
    base: fellBack ? null : run.base,
    analyzedAt,
  }),
  notices: fellBack
    ? [
        `Fallow could not find the base ${run.base}, so this report covers the whole project. Set the base branch in the plugin settings.`,
      ]
    : [],
});

/** Runs fallow, keeps the latest reports in memory, and joins concurrent runs for the same key. */
export const createAnalyzer = (): AnalyzerMethods => {
  const cache = new Map<string, CacheEntry>();
  const running = new Map<string, Promise<Analysis>>();
  /** Every root that a tool call resolved and analyzed in this process. */
  const seen = new Set<string>();

  const remember = (entry: CacheEntry): void => {
    const current = cache.get(entry.key);
    if (current !== undefined && current.startedAt > entry.startedAt) return;
    cache.delete(entry.key);
    cache.set(entry.key, entry);
    while (cache.size > MAX_ENTRIES) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
  };

  const cachedAnalysis = (key: string): Analysis | null => {
    const hit = cache.get(key);
    if (hit === undefined) return null;
    if (Date.now() - hit.storedAt < FRESH_FOR_MS) {
      return { ok: true, report: hit.report, findings: hit.findings };
    }
    return null;
  };

  const mayReuse = (request: AnalyzeRequest, cacheable: boolean): boolean =>
    cacheable && request.force !== true;

  const reusableAnalysis = (
    request: AnalyzeRequest,
    key: string,
    cacheable: boolean,
  ): Analysis | Promise<Analysis> | null => {
    if (!mayReuse(request, cacheable)) return null;
    return cachedAnalysis(key) ?? running.get(key) ?? null;
  };

  const finishAnalysis = (
    run: AnalysisRun,
    result: Extract<RunResult, { ok: true }>,
    analyzedAt: string,
  ): Analysis => {
    // fallow analyzes the whole project when it cannot resolve the base.
    // Say so, and do not label the full report as changed files.
    const fellBack = run.base !== null && ignoredBase(result.warnings);
    const report = completedReport(run, result, fellBack, analyzedAt);
    const findings = allFindings(run.request.project.root, result.json);
    if (run.cacheable && !fellBack) {
      remember({ key: run.key, report, findings, startedAt: run.startedAt, storedAt: Date.now() });
    }
    return { ok: true, report, findings };
  };

  const runAnalysis = async (run: AnalysisRun): Promise<Analysis> => {
    try {
      const analyzedAt = new Date(run.startedAt).toISOString();
      const { project, settings } = run.request;
      const result = await runFallow({
        root: project.root,
        args: run.args,
        source: settings.source,
        sandbox: settings.sandbox ? run.request.sandbox : null,
      });
      if (!result.ok) return result;
      return finishAnalysis(run, result, analyzedAt);
    } catch (error) {
      return { ok: false, problem: unexpected(error) };
    }
  };

  const trackAnalysis = async (key: string, work: Promise<Analysis>): Promise<Analysis> => {
    running.set(key, work);
    try {
      return await work;
    } finally {
      // A forced run can replace this entry while it runs; remove only our own.
      if (running.get(key) === work) running.delete(key);
    }
  };

  const startAnalysis = (
    request: AnalyzeRequest,
    scope: Report["scope"],
    production: boolean,
    base: string | null,
  ): Analysis | Promise<Analysis> => {
    const key = keyOf(request.project.root, scope, base, production);
    const cacheable = request.extraArgs === undefined;
    const reused = reusableAnalysis(request, key, cacheable);
    if (reused !== null) return reused;
    const args = analysisArgs(request, production, base);
    const work = runAnalysis({ request, scope, base, args, key, cacheable, startedAt: Date.now() });
    if (!cacheable) return work;
    return trackAnalysis(key, work);
  };

  const analyze = async (request: AnalyzeRequest): Promise<Analysis> => {
    seen.add(request.project.root);
    const options = analysisOptions(request);
    const base = options.base instanceof Promise ? await options.base : options.base;
    return startAnalysis(request, options.scope, options.production, base);
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
    if (!VERDICTS.has(String(result.json["verdict"]))) {
      return {
        ok: false,
        problem: {
          code: "audit_unreadable",
          title: "The audit result has no verdict",
          detail:
            "Fallow returned an audit without pass, warn or fail. Update fallow and try again.",
          fix: "fallow audit",
        },
      };
    }
    try {
      return { ok: true, audit: toAudit(result.json, project, analyzedAt) };
    } catch (error) {
      return { ok: false, problem: unexpected(error) };
    }
  };

  /** The newest full report of a root, at any age. Used by mention search and resource reads. */
  const latest = (root?: string): CacheEntry | null => {
    const entries = [...cache.values()].reverse();
    return (
      entries.find((entry) => root === undefined || entry.report.project.root === root) ?? null
    );
  };

  return { analyze, audit, latest, hasSeen: (root: string): boolean => seen.has(root) };
};

export type Analyzer = ReturnType<typeof createAnalyzer>;
