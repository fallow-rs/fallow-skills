import { spawn } from "node:child_process";
import { access, constants } from "node:fs/promises";
import { delimiter, dirname, join } from "node:path";
import type { FallowProblem } from "../shared/contracts.ts";
import { isRecord, type Json } from "./json.ts";

export type FallowSource = "auto" | "project" | "path" | "npx";

/**
 * The opaque `codex/sandbox-state-meta` object that Codex sends on model tool calls.
 * Only `codexExecutable` is read. The object is forwarded unchanged, as the Codex contract requires.
 */
export interface SandboxState {
  codexExecutable: string;
  raw: Json;
}

export interface RunRequest {
  root: string;
  args: readonly string[];
  source: FallowSource;
  sandbox: SandboxState | null;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export type RunResult =
  | { ok: true; json: Json; command: string; durationMs: number }
  | { ok: false; problem: FallowProblem };

interface Executable {
  command: string;
  prefix: readonly string[];
  label: string;
}

const DEFAULT_TIMEOUT_MS = 180_000;
const MAX_OUTPUT_BYTES = 256 * 1024 * 1024;
const IS_WINDOWS = process.platform === "win32";
const BIN_NAMES = IS_WINDOWS ? ["fallow.cmd", "fallow.exe", "fallow"] : ["fallow"];
const INSTALL_FIX = "npm install --save-dev fallow";

const isExecutable = async (path: string): Promise<boolean> => {
  try {
    await access(path, IS_WINDOWS ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

const firstExecutable = async (candidates: string[]): Promise<string | null> => {
  for (const candidate of candidates) {
    if (await isExecutable(candidate)) return candidate;
  }
  return null;
};

/** Walks up from the project root, so a monorepo package finds the fallow of its workspace root. */
const findProjectBinary = async (root: string): Promise<string | null> => {
  let directory = root;
  for (;;) {
    const found = await firstExecutable(
      BIN_NAMES.map((name) => join(directory, "node_modules", ".bin", name)),
    );
    if (found !== null) return found;
    const parent = dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
};

const findPathBinary = (): Promise<string | null> =>
  firstExecutable(
    (process.env["PATH"] ?? "")
      .split(delimiter)
      .filter((entry) => entry.length > 0)
      .flatMap((entry) => BIN_NAMES.map((name) => join(entry, name))),
  );

const NPX: Executable = {
  command: IS_WINDOWS ? "npx.cmd" : "npx",
  prefix: ["--yes", "fallow@latest"],
  label: "npx fallow",
};

/** Finds the fallow binary for a project. Returns null when the chosen source has none. */
export const resolveFallow = async (
  root: string,
  source: FallowSource,
  sandboxed: boolean,
): Promise<Executable | null> => {
  if (source === "npx") return NPX;
  // A repository can ship its own node_modules/.bin/fallow. Outside the Codex sandbox, `auto`
  // runs only a fallow that the user installed, never one that the opened project brings.
  if (source === "project" || (source === "auto" && sandboxed)) {
    const local = await findProjectBinary(root);
    if (local !== null) return { command: local, prefix: [], label: "project fallow" };
    if (source === "project") return null;
  }
  const global = await findPathBinary();
  if (global !== null) return { command: global, prefix: [], label: "fallow on PATH" };
  return source === "auto" ? NPX : null;
};

const tail = (text: string, lines: number): string =>
  text.trim().split("\n").slice(-lines).join("\n");

const notFound = (source: FallowSource): FallowProblem => ({
  code: "fallow_not_found",
  title: "Fallow is not installed",
  detail:
    source === "project"
      ? "The settings say to use the project copy of fallow, but node_modules/.bin has no fallow binary."
      : "No fallow binary was found in the project or on PATH.",
  fix: INSTALL_FIX,
});

interface Spawned {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  error: NodeJS.ErrnoException | null;
  timedOut: boolean;
}

const run = (
  command: string,
  args: readonly string[],
  cwd: string,
  timeoutMs: number,
  signal: AbortSignal | undefined,
): Promise<Spawned> =>
  new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
      stdio: ["ignore", "pipe", "pipe"],
      shell: IS_WINDOWS && command.endsWith(".cmd"),
      windowsHide: true,
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let size = 0;
    let timedOut = false;
    let settled = false;
    const finish = (result: Omit<Spawned, "stdout" | "stderr" | "timedOut">): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      resolve({
        ...result,
        timedOut,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    };
    const abort = (): void => {
      child.kill("SIGTERM");
    };
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);
    signal?.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_OUTPUT_BYTES) child.kill("SIGTERM");
      else stdout.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < 256) stderr.push(chunk);
    });
    child.on("error", (error) => finish({ exitCode: null, error }));
    child.on("close", (exitCode) => finish({ exitCode, error: null }));
  });

const parseJson = (text: string): Json | null => {
  const start = text.indexOf("{");
  if (start === -1) return null;
  try {
    const value: unknown = JSON.parse(text.slice(start));
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
};

/**
 * Runs fallow with JSON output and returns the parsed object.
 * Fallow exits 1 when it finds issues, so the exit code alone never decides success: valid JSON does.
 */
export const runFallow = async (request: RunRequest): Promise<RunResult> => {
  const executable = await resolveFallow(request.root, request.source, request.sandbox !== null);
  if (executable === null) return { ok: false, problem: notFound(request.source) };

  const fallowArgs = [...executable.prefix, ...request.args];
  const sandbox = request.sandbox;
  const sandboxed = sandbox !== null;
  const command = sandboxed ? sandbox.codexExecutable : executable.command;
  const args = sandboxed
    ? [
        "sandbox",
        "--sandbox-state-json",
        JSON.stringify(sandbox.raw),
        "--",
        executable.command,
        ...fallowArgs,
      ]
    : fallowArgs;
  const display = `fallow ${request.args.join(" ")}`;

  const started = Date.now();
  const result = await run(
    command,
    args,
    request.root,
    request.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    request.signal,
  );
  const durationMs = Date.now() - started;

  if (result.error?.code === "ENOENT") {
    return sandboxed
      ? {
          ok: false,
          problem: {
            code: "sandbox_unavailable",
            title: "The Codex sandbox could not start",
            detail: `Codex sent ${sandbox.codexExecutable}, but it could not be started.`,
            fix: null,
          },
        }
      : { ok: false, problem: notFound(request.source) };
  }
  if (result.timedOut) {
    return {
      ok: false,
      problem: {
        code: "timeout",
        title: "Fallow took too long",
        detail: `${display} did not finish in ${Math.round((request.timeoutMs ?? DEFAULT_TIMEOUT_MS) / 1000)} seconds. Scope the run to changed files, or add large generated folders to ignorePatterns.`,
        fix: "fallow audit",
      },
    };
  }
  if (request.signal?.aborted === true) {
    return {
      ok: false,
      problem: {
        code: "cancelled",
        title: "Analysis cancelled",
        detail: "The run was stopped.",
        fix: null,
      },
    };
  }

  const json = parseJson(result.stdout);
  if (json === null) {
    const stderr = tail(result.stderr, 12);
    return {
      ok: false,
      problem: {
        code:
          sandboxed && /sandbox|seatbelt|landlock|denied/i.test(stderr)
            ? "sandbox_denied"
            : "fallow_failed",
        title: "Fallow could not analyze this project",
        detail:
          stderr.length > 0
            ? stderr
            : `${display} exited with code ${result.exitCode ?? "unknown"}.`,
        fix: "fallow doctor",
      },
    };
  }
  return { ok: true, json, command: `${executable.label}: ${display}`, durationMs };
};

/** Reads `fallow --version` for the installation check. Never throws. */
export const fallowVersion = async (
  root: string,
  source: FallowSource,
): Promise<
  { ok: true; version: string; binary: string } | { ok: false; problem: FallowProblem }
> => {
  const executable = await resolveFallow(root, source, false);
  if (executable === null) return { ok: false, problem: notFound(source) };
  const result = await run(
    executable.command,
    [...executable.prefix, "--version"],
    root,
    60_000,
    undefined,
  );
  const version = result.stdout.trim().replace(/^fallow\s+/, "");
  if (result.exitCode !== 0 || version.length === 0)
    return { ok: false, problem: notFound(source) };
  return {
    ok: true,
    version,
    binary:
      executable.prefix.length > 0 ? `npx ${executable.prefix.join(" ")}` : executable.command,
  };
};
