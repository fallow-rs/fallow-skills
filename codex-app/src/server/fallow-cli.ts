import { spawn } from "node:child_process";
import { access, constants } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, isAbsolute, join, relative } from "node:path";
import type { FallowProblem } from "../shared/contracts.ts";
import { isRecord, string, type Json } from "./json.ts";

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
  | { ok: true; json: Json; command: string; durationMs: number; warnings: string[] }
  | { ok: false; problem: FallowProblem };

interface Executable {
  command: string;
  prefix: readonly string[];
  label: string;
  /** npx runs outside the project, so a repository `.npmrc` cannot change what it installs. */
  runsOutsideProject: boolean;
}

const DEFAULT_TIMEOUT_MS = 180_000;
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;
const IS_WINDOWS = process.platform === "win32";
const BIN_NAMES = IS_WINDOWS ? ["fallow.exe", "fallow.cmd", "fallow"] : ["fallow"];
const INSTALL_FIX = "npm install --global fallow";
/** The fallow major version that this plugin is built and tested against. */
const NPX_PACKAGE = "fallow@3";

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

const isInside = (base: string, candidate: string): boolean => {
  const path = relative(base, candidate);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
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

/**
 * A fallow on PATH that the user installed. PATH entries that are relative, or that point into
 * the project (a tool such as direnv can add `node_modules/.bin`), do not count.
 */
const findUserBinary = (root: string): Promise<string | null> =>
  firstExecutable(
    (process.env["PATH"] ?? "")
      .split(delimiter)
      .filter((entry) => isAbsolute(entry) && !isInside(root, entry))
      .flatMap((entry) => BIN_NAMES.map((name) => join(entry, name))),
  );

const NPX: Executable = {
  command: IS_WINDOWS ? "npx.cmd" : "npx",
  prefix: ["--yes", "--package", NPX_PACKAGE, "--", "fallow"],
  label: "npx fallow",
  runsOutsideProject: true,
};

/**
 * Finds the fallow binary for a project. Code that the opened repository controls (its own
 * `node_modules/.bin/fallow`, or an npx install that its `.npmrc` could redirect) runs only inside
 * the Codex sandbox. Outside it, only a fallow on the user's PATH runs.
 */
export const resolveFallow = async (
  root: string,
  source: FallowSource,
  sandboxed: boolean,
): Promise<Executable | null> => {
  const user = async (): Promise<Executable | null> => {
    const found = await findUserBinary(root);
    return found === null ? null : { command: found, prefix: [], label: "fallow on PATH", runsOutsideProject: false };
  };
  if (!sandboxed) return user();
  if (source === "npx") return NPX;
  if (source === "project" || source === "auto") {
    const local = await findProjectBinary(root);
    if (local !== null) return { command: local, prefix: [], label: "project fallow", runsOutsideProject: false };
    if (source === "project") return null;
  }
  return (await user()) ?? (source === "auto" ? NPX : null);
};

/**
 * Only these variables reach fallow, so tokens in the Codex environment stay out of a project binary.
 * Case-insensitive, because Windows keeps names such as `Path` and `SystemRoot`. The npm registry and
 * proxy settings keep npx working behind a proxy; npm and git credentials, `NODE_OPTIONS` (which can
 * load code) and git configuration overrides stay out.
 */
const ENV_ALLOWLIST =
  /^(PATH|PATHEXT|HOME|USERPROFILE|HOMEDRIVE|HOMEPATH|TMPDIR|TEMP|TMP|LANG|LANGUAGE|LC_[A-Z]+|TZ|SYSTEMROOT|SYSTEMDRIVE|COMSPEC|WINDIR|APPDATA|LOCALAPPDATA|PROGRAMDATA|XDG_[A-Z_]+|SHELL|USER|LOGNAME|TERM|SSL_CERT_FILE|SSL_CERT_DIR|NODE_EXTRA_CA_CERTS|HTTPS?_PROXY|NO_PROXY|ALL_PROXY|NPM_CONFIG_(REGISTRY|PROXY|HTTPS_PROXY|NOPROXY|STRICT_SSL|CAFILE)|FALLOW_[A-Z0-9_]+|GIT_(DIR|WORK_TREE|CEILING_DIRECTORIES))$/i;

/** A name that can hold a credential never passes, even when a prefix above would allow it. */
const ENV_SECRET = /TOKEN|SECRET|PASSWORD|PASSWD|AUTH|CREDENTIAL|_KEY$|APIKEY/i;

const childEnvironment = (): NodeJS.ProcessEnv => ({
  ...Object.fromEntries(
    Object.entries(process.env).filter(([name]) => ENV_ALLOWLIST.test(name) && !ENV_SECRET.test(name)),
  ),
  NO_COLOR: "1",
  FORCE_COLOR: "0",
});

/** cmd.exe parses these characters even inside arguments, so a `.cmd` shim never gets them. */
const CMD_UNSAFE = /[&|<>^%"!`\r\n]/;

const tail = (text: string, lines: number): string =>
  text.trim().split("\n").slice(-lines).join("\n");

const notFound = (source: FallowSource, sandboxed: boolean): FallowProblem => ({
  code: "fallow_not_found",
  title: "Fallow is not installed",
  detail: !sandboxed
    ? "No fallow binary is on PATH. Outside the Codex sandbox of a thread, the app only runs a fallow that you installed, never one that the project ships. Install fallow, or ask Codex about code health in a thread."
    : source === "project"
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
  overflowed: boolean;
}

/** Time between SIGTERM and SIGKILL, and the wait for pipes to close after the process exits. */
const KILL_GRACE_MS = 3000;

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
      env: childEnvironment(),
      stdio: ["ignore", "pipe", "pipe"],
      shell: IS_WINDOWS && command.endsWith(".cmd"),
      windowsHide: true,
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let size = 0;
    let timedOut = false;
    let overflowed = false;
    let settled = false;
    const timers: NodeJS.Timeout[] = [];
    const finish = (result: Pick<Spawned, "exitCode" | "error">): void => {
      if (settled) return;
      settled = true;
      for (const timer of timers) clearTimeout(timer);
      signal?.removeEventListener("abort", stop);
      resolve({
        ...result,
        timedOut,
        overflowed,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    };
    // SIGTERM first; SIGKILL when the process (or a wrapper such as npx or the sandbox) ignores it.
    const stop = (): void => {
      child.kill("SIGTERM");
      timers.push(setTimeout(() => child.kill("SIGKILL"), KILL_GRACE_MS));
    };
    timers.push(
      setTimeout(() => {
        timedOut = true;
        stop();
      }, timeoutMs),
    );
    if (signal?.aborted === true) stop();
    else signal?.addEventListener("abort", stop, { once: true });
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size <= MAX_OUTPUT_BYTES) stdout.push(chunk);
      else if (!overflowed) {
        overflowed = true;
        stop();
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < 256) stderr.push(chunk);
    });
    child.on("error", (error) => finish({ exitCode: null, error }));
    child.on("close", (exitCode) => finish({ exitCode, error: null }));
    // A grandchild can keep the pipes open after the process exits; do not wait for it forever.
    child.on("exit", (exitCode) => {
      timers.push(setTimeout(() => finish({ exitCode, error: null }), KILL_GRACE_MS));
    });
  });

/** Parses stdout as one JSON object. Falls back to the first line that starts with `{`. */
const parseJson = (text: string): Json | null => {
  const attempt = (candidate: string): Json | null => {
    try {
      const value: unknown = JSON.parse(candidate);
      return isRecord(value) ? value : null;
    } catch {
      return null;
    }
  };
  const whole = attempt(text.trim());
  if (whole !== null) return whole;
  const start = text.search(/^\{/m);
  return start === -1 ? null : attempt(text.slice(start).trim());
};

/** The warning fallow prints when it cannot resolve the base of `--changed-since`. */
const IGNORED_BASE = /--changed-since '[^']*' was ignored/;

/**
 * Runs fallow with JSON output and returns the parsed object.
 * Fallow exits 1 when it finds issues, so the exit code alone never decides success: valid JSON does.
 */
export const runFallow = async (request: RunRequest): Promise<RunResult> => {
  const executable = await resolveFallow(request.root, request.source, request.sandbox !== null);
  if (executable === null) return { ok: false, problem: notFound(request.source, request.sandbox !== null) };

  const fallowArgs = [
    ...executable.prefix,
    ...request.args,
    ...(executable.runsOutsideProject ? ["--root", request.root] : []),
  ];
  const cwd = executable.runsOutsideProject ? tmpdir() : request.root;
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

  if (IS_WINDOWS && command.endsWith(".cmd") && [cwd, ...args].some((value) => CMD_UNSAFE.test(value))) {
    return {
      ok: false,
      problem: {
        code: "unsafe_path",
        title: "Fallow cannot run in this folder",
        detail:
          "The project path or an argument has a character that cmd.exe would read as a command, such as & or %. Install fallow.exe on PATH, or move the project.",
        fix: null,
      },
    };
  }

  const started = Date.now();
  const result = await run(
    command,
    args,
    cwd,
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
      : { ok: false, problem: notFound(request.source, false) };
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

  if (result.overflowed) {
    return {
      ok: false,
      problem: {
        code: "output_too_large",
        title: "Fallow printed too much output",
        detail: `${display} printed more than ${MAX_OUTPUT_BYTES / 1024 / 1024} MB. Add large generated folders to ignorePatterns.`,
        fix: null,
      },
    };
  }

  const json = parseJson(result.stdout);
  // Fallow reports a usage or git error as {"error": true, "message": ...} with exit code 2.
  if (json !== null && json["error"] === true) {
    return {
      ok: false,
      problem: {
        code: "fallow_error",
        title: "Fallow stopped with an error",
        detail: string(json["message"]) ?? `${display} failed.`,
        fix: "fallow doctor",
      },
    };
  }
  if (json === null || (result.exitCode !== null && result.exitCode >= 2)) {
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
  const warnings = result.stderr
    .split("\n")
    .map((line) => line.trim())
    .filter((line, index, all) => line.startsWith("Warning:") && all.indexOf(line) === index);
  return { ok: true, json, command: `${executable.label}: ${display}`, durationMs, warnings };
};

/** True when fallow ignored `--changed-since` and analyzed the whole project instead. */
export const ignoredBase = (warnings: readonly string[]): boolean =>
  warnings.some((warning) => IGNORED_BASE.test(warning));

/** Reads `fallow --version` for the installation check. Never throws. */
export const fallowVersion = async (
  root: string,
  source: FallowSource,
): Promise<
  { ok: true; version: string; binary: string } | { ok: false; problem: FallowProblem }
> => {
  const executable = await resolveFallow(root, source, false);
  if (executable === null) return { ok: false, problem: notFound(source, false) };
  const result = await run(
    executable.command,
    [...executable.prefix, "--version"],
    root,
    60_000,
    undefined,
  );
  const version = result.stdout.trim().replace(/^fallow\s+/, "");
  if (result.exitCode !== 0 || version.length === 0)
    return { ok: false, problem: notFound(source, false) };
  return {
    ok: true,
    version,
    binary:
      executable.prefix.length > 0 ? `npx ${executable.prefix.join(" ")}` : executable.command,
  };
};
