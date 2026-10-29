import {
  productionFromProblem,
  readInspect,
  type ProductionView,
} from "../../../agent-view/src/production.ts";
import type { ProductionResult } from "../shared/contracts.ts";
import type { FallowSource, RunRequest, RunResult } from "./fallow-cli.ts";

/** The CLI joins the static findings with Fallow Cloud; the app only runs it and reads the JSON. */
export const inspectArguments = (path: string): string[] => [
  "inspect",
  "--file",
  path,
  "--cloud",
  "--format",
  "json",
  "--quiet",
];

export interface ProductionRequest {
  root: string;
  /** Repo-relative path of a file in the newest report. */
  path: string;
  source: FallowSource;
}

interface LoaderOptions {
  ttlMs?: number;
  now?: () => number;
}

/** The cloud read has its own short timeout in the CLI; this bounds the whole inspect run. */
const INSPECT_TIMEOUT_MS = 30_000;
const DEFAULT_TTL_MS = 60_000;
const CACHE_LIMIT = 64;

const refused = (path: string): ProductionResult => ({
  path,
  production: {
    status: "cli_failed",
    message: "fallow inspect failed: the path is not a project file",
  },
});

const toResult = (path: string, result: RunResult): ProductionResult => {
  const production: ProductionView = result.ok
    ? readInspect(result.json).production
    : productionFromProblem(result.problem);
  return { path, production };
};

/** A small cache of recent answers with a time limit. The oldest entry goes first when it is full. */
interface Cache {
  get: (key: string) => ProductionResult | null;
  set: (key: string, result: ProductionResult) => void;
}

const createCache = (ttlMs: number, now: () => number): Cache => {
  const entries = new Map<string, { at: number; result: ProductionResult }>();
  const fresh = (entry: { at: number }): boolean => now() - entry.at <= ttlMs;
  return {
    get: (key: string): ProductionResult | null => {
      const entry = entries.get(key);
      return entry !== undefined && fresh(entry) ? entry.result : null;
    },
    set: (key: string, result: ProductionResult): void => {
      entries.delete(key);
      entries.set(key, { at: now(), result });
      const oldest = entries.keys().next().value;
      if (entries.size > CACHE_LIMIT && oldest !== undefined) entries.delete(oldest);
    },
  };
};

/** Answers that can change on the next try. They are not kept, so a short failure does not stay. */
const TRANSIENT = new Set<string>(["cli_failed", "unavailable"]);

/** A path that fallow would read as an option, or no path, never reaches the CLI. */
const isSafePath = (path: string): boolean => path.length > 0 && !path.startsWith("-");

/**
 * Runs `fallow inspect --file <path> --cloud --format json` and keeps each answer for a short time,
 * so moving between the findings of one file runs the CLI once.
 */
export const createProductionLoader = (
  run: (request: RunRequest) => Promise<RunResult>,
  options: LoaderOptions = {},
): ((request: ProductionRequest) => Promise<ProductionResult>) => {
  const cache = createCache(options.ttlMs ?? DEFAULT_TTL_MS, options.now ?? Date.now);
  return async ({ root, path, source }) => {
    if (!isSafePath(path)) return refused(path);
    const key = `${root}\u0000${path}\u0000${JSON.stringify(source)}`;
    const cached = cache.get(key);
    if (cached !== null) return cached;
    const ran = await run({ root, args: inspectArguments(path), source, sandbox: null, timeoutMs: INSPECT_TIMEOUT_MS });
    const result = toResult(path, ran);
    if (!TRANSIENT.has(result.production.status)) cache.set(key, result);
    return result;
  };
};
