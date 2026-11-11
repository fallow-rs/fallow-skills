import { spawn } from "node:child_process";
import { access, constants, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, isAbsolute, join, relative } from "node:path";
import type { FallowProblem } from "../../../agent-view/src/contracts.ts";
import { isRecord, string, type Json } from "../../../agent-view/src/json.ts";

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
  /** npx runs in a new empty folder, so a repository `.npmrc` cannot change what it installs. */
  runsOutsideProject: boolean;
}

const DEFAULT_TIMEOUT_MS = 180_000;
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;
const IS_WINDOWS = process.platform === "win32";
const BIN_NAMES = IS_WINDOWS ? ["fallow.exe", "fallow.cmd", "fallow"] : ["fallow"];
const INSTALL_FIX = "npm install --global fallow";
/**
 * The exact fallow release that the npx source runs. A range would let a new release run without
 * review, and the Claude plugin directory refuses an unpinned launcher.
 */
export const FALLOW_NPX_VERSION = "3.42.0";
const NPX_PACKAGE = `fallow@${FALLOW_NPX_VERSION}`;
/** An absolute path to a fallow executable that the user chose, for hosts with a short PATH. */
const BIN_OVERRIDE = "FALLOW_BIN";

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
 * A command on PATH that the user installed. PATH entries that are relative, or that point into
 * the project (a tool such as direnv can add `node_modules/.bin`), do not count. A candidate that
 * resolves into the project through a symbolic link does not count either.
 */
const findUserCommand = async (
  root: string,
  names: readonly string[],
  chosen: readonly string[] = [],
): Promise<string | null> => {
  const project = await realpath(root).catch(() => root);
  const candidates = [
    ...chosen,
    ...(await userPathEntries(root)).flatMap((entry) => names.map((name) => join(entry, name))),
  ];
  for (const candidate of candidates) {
    if (!(await isExecutable(candidate))) continue;
    const target = await realpath(candidate).catch(() => candidate);
    if (!insideProject(project, target)) return candidate;
  }
  return null;
};

/** macOS and Windows compare paths without case, so a project path can hide behind other case. */
const foldCase = (path: string): string =>
  IS_WINDOWS || process.platform === "darwin" ? path.toLowerCase() : path;

const insideProject = (project: string, path: string): boolean =>
  isInside(foldCase(project), foldCase(path));

/** A `node_modules` folder belongs to some project, also when it is a parent workspace of the root. */
const inNodeModules = (path: string): boolean => path.split(/[\\/]/).includes("node_modules");

/**
 * The absolute PATH entries that the user controls: outside the project, also after symbolic
 * links resolve, and outside every `node_modules`. They serve the lookup and the PATH of the child.
 */
const userPathEntries = async (root: string): Promise<string[]> => {
  const project = await realpath(root).catch(() => root);
  const entries = (process.env["PATH"] ?? "").split(delimiter);
  const kept = await Promise.all(entries.map((entry) => isUserEntry(root, project, entry)));
  return entries.filter((_, index) => kept[index]);
};

const projectControlled = (project: string, path: string): boolean =>
  inNodeModules(path) || insideProject(project, path);

const isUserEntry = async (root: string, project: string, entry: string): Promise<boolean> => {
  if (!isAbsolute(entry) || projectControlled(root, entry)) return false;
  return !projectControlled(project, await realpath(entry).catch(() => entry));
};

const findUserBinary = (root: string): Promise<string | null> =>
  findUserCommand(root, BIN_NAMES, overrideBinary(root));

/** `FALLOW_BIN` counts only as an absolute path outside the project, like a PATH entry. */
const overrideBinary = (root: string): string[] => {
  const path = process.env[BIN_OVERRIDE] ?? "";
  return isAbsolute(path) && !isInside(root, path) ? [path] : [];
};

const NPX_NAMES = IS_WINDOWS ? ["npx.cmd", "npx"] : ["npx"];

const NPX: Executable = {
  command: IS_WINDOWS ? "npx.cmd" : "npx",
  prefix: ["--yes", "--package", NPX_PACKAGE, "--", "fallow"],
  label: `fallow ${FALLOW_NPX_VERSION} through npx`,
  runsOutsideProject: true,
};

/**
 * Finds the fallow binary for a project. Code that the opened repository controls (its own
 * `node_modules/.bin/fallow`) runs only inside the Codex sandbox. Outside it, fallow runs from the
 * user's PATH or `FALLOW_BIN`, or from npx when the user set the source to npx. npx starts in a
 * new empty folder, so a project `.npmrc` or `node_modules` cannot change what runs.
 */
export const resolveFallow = async (
  root: string,
  source: FallowSource,
  sandboxed: boolean,
): Promise<Executable | null> => {
  const order = (sandboxed ? SANDBOXED_ORDER : UNSANDBOXED_ORDER)[source];
  for (const step of order) {
    const found = await FINDERS[step](root);
    if (found !== null) return found;
  }
  return null;
};

type Finder = "project" | "user" | "npx" | "userNpx";

/** The lookup order for each source. Outside the sandbox, no step reaches a project binary. */
const SANDBOXED_ORDER: Record<FallowSource, readonly Finder[]> = {
  auto: ["project", "user", "npx"],
  project: ["project"],
  path: ["user"],
  npx: ["npx"],
};
const UNSANDBOXED_ORDER: Record<FallowSource, readonly Finder[]> = {
  auto: ["user"],
  project: ["user"],
  path: ["user"],
  npx: ["userNpx"],
};

const userFallow = async (root: string): Promise<Executable | null> => {
  const found = await findUserBinary(root);
  if (found === null) return null;
  const label = overrideBinary(root).includes(found) ? "fallow from FALLOW_BIN" : "fallow on PATH";
  return { command: found, prefix: [], label, runsOutsideProject: false };
};

const projectFallow = async (root: string): Promise<Executable | null> => {
  const local = await findProjectBinary(root);
  return local === null ? null : { command: local, prefix: [], label: "project fallow", runsOutsideProject: false };
};

const FINDERS: Record<Finder, (root: string) => Promise<Executable | null>> = {
  project: projectFallow,
  user: userFallow,
  npx: () => Promise.resolve(NPX),
  userNpx: (root) => userNpx(root),
};

/** Outside the sandbox, npx must come from the user's PATH too, never from a project folder. */
const userNpx = async (root: string): Promise<Executable | null> => {
  const command = await findUserCommand(root, NPX_NAMES);
  return command === null ? null : { ...NPX, command };
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

/** PATH keeps only the user's entries, so npx and fallow never find a project binary. */
const childEnvironment = async (root: string): Promise<NodeJS.ProcessEnv> => {
  const path = (await userPathEntries(root)).join(delimiter);
  return {
    ...Object.fromEntries(
      Object.entries(process.env)
        .filter(([name]) => ENV_ALLOWLIST.test(name) && !ENV_SECRET.test(name))
        .map(([name, value]) => [name, /^path$/i.test(name) ? path : value]),
    ),
    NO_COLOR: "1",
    FORCE_COLOR: "0",
  };
};

/** cmd.exe parses these characters even inside arguments, so a `.cmd` shim never gets them. */
const CMD_UNSAFE = /[&|<>^%"!`\r\n]/;

const tail = (text: string, lines: number): string =>
  text.trim().split("\n").slice(-lines).join("\n");

const notFound = (source: FallowSource, sandboxed: boolean): FallowProblem => ({
  code: "fallow_not_found",
  title: "Fallow is not installed",
  detail: !sandboxed
    ? `No fallow binary is on PATH. Outside the Codex sandbox of a thread, the app runs only a fallow that you chose, never one that the project ships. Install fallow, or set the Fallow binary setting to npx to download fallow ${FALLOW_NPX_VERSION}. Then try again.`
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
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
  signal: AbortSignal | undefined,
): Promise<Spawned> =>
  new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      env,
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

interface Execution {
  command: string;
  args: readonly string[];
  cwd: string;
  sandbox: SandboxState | null;
}

const fallowArguments = (request: RunRequest, executable: Executable): string[] => [
  ...executable.prefix,
  ...request.args,
  ...(executable.runsOutsideProject ? ["--root", request.root] : []),
];

/**
 * Runs `task` in the folder that the executable needs. npx gets a new empty folder for each run:
 * npm reads `.npmrc` and runs a matching `node_modules/fallow` from its working folder, so neither
 * the project folder nor the shared temporary folder is safe.
 */
const inWorkdir = async <T>(
  executable: Executable,
  root: string,
  task: (cwd: string) => Promise<T>,
): Promise<T> => {
  if (!executable.runsOutsideProject) return task(root);
  const folder = await mkdtemp(join(tmpdir(), "fallow-npx-"));
  try {
    return await task(folder);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
};

const executionFor = (request: RunRequest, executable: Executable, cwd: string): Execution => {
  const args = fallowArguments(request, executable);
  const sandbox = request.sandbox;
  if (sandbox === null) return { command: executable.command, args, cwd, sandbox };
  return {
    command: sandbox.codexExecutable,
    args: [
      "sandbox",
      "--sandbox-state-json",
      JSON.stringify(sandbox.raw),
      "--",
      executable.command,
      ...args,
    ],
    cwd,
    sandbox,
  };
};

const unsafeCommand = ({ command, args, cwd }: Execution): boolean =>
  IS_WINDOWS && command.endsWith(".cmd") && [cwd, ...args].some((value) => CMD_UNSAFE.test(value));

const unsafePathProblem = (): FallowProblem => ({
  code: "unsafe_path",
  title: "Fallow cannot run in this folder",
  detail:
    "The project path or an argument has a character that cmd.exe would read as a command, such as & or %. Install fallow.exe on PATH, or move the project.",
  fix: null,
});

const startProblem = (
  result: Spawned,
  request: RunRequest,
  sandbox: SandboxState | null,
): FallowProblem | null => {
  if (result.error?.code !== "ENOENT") return null;
  if (sandbox === null) return notFound(request.source, false);
  return {
    code: "sandbox_unavailable",
    title: "The Codex sandbox could not start",
    detail: `Codex sent ${sandbox.codexExecutable}, but it could not be started.`,
    fix: null,
  };
};

const requestTimeout = (request: RunRequest): number => request.timeoutMs ?? DEFAULT_TIMEOUT_MS;

const interruptionProblem = (
  result: Spawned,
  request: RunRequest,
  display: string,
): FallowProblem | null => {
  if (result.timedOut) {
    return {
      code: "timeout",
      title: "Fallow took too long",
      detail: `${display} did not finish in ${Math.round(requestTimeout(request) / 1000)} seconds. Scope the run to changed files, or add large generated folders to ignorePatterns.`,
      fix: "fallow audit",
    };
  }
  if (request.signal?.aborted === true) {
    return {
      code: "cancelled",
      title: "Analysis cancelled",
      detail: "The run was stopped.",
      fix: null,
    };
  }
  return null;
};

const overflowProblem = (result: Spawned, display: string): FallowProblem | null => {
  if (!result.overflowed) return null;
  return {
    code: "output_too_large",
    title: "Fallow printed too much output",
    detail: `${display} printed more than ${MAX_OUTPUT_BYTES / 1024 / 1024} MB. Add large generated folders to ignorePatterns.`,
    fix: null,
  };
};

const runProblem = (
  result: Spawned,
  request: RunRequest,
  sandbox: SandboxState | null,
  display: string,
): FallowProblem | null =>
  startProblem(result, request, sandbox) ??
  interruptionProblem(result, request, display) ??
  overflowProblem(result, display);

// Fallow reports a usage or git error as {"error": true, "message": ...} with exit code 2.
const jsonProblem = (json: Json | null, display: string): FallowProblem | null => {
  if (json === null || json["error"] !== true) return null;
  return {
    code: "fallow_error",
    title: "Fallow stopped with an error",
    detail: string(json["message"]) ?? `${display} failed.`,
    fix: "fallow doctor",
  };
};

const failedExit = (result: Spawned): boolean =>
  result.exitCode !== null && result.exitCode >= 2;

const failureCode = (sandboxed: boolean, stderr: string): FallowProblem["code"] =>
  sandboxed && /sandbox|seatbelt|landlock|denied/i.test(stderr) ? "sandbox_denied" : "fallow_failed";

const failureProblem = (result: Spawned, sandboxed: boolean, display: string): FallowProblem => {
  const stderr = tail(result.stderr, 12);
  return {
    code: failureCode(sandboxed, stderr),
    title: "Fallow could not analyze this project",
    detail: stderr.length > 0 ? stderr : `${display} exited with code ${result.exitCode ?? "unknown"}.`,
    fix: "fallow doctor",
  };
};

const outputWarnings = (stderr: string): string[] =>
  stderr
    .split("\n")
    .map((line) => line.trim())
    .filter((line, index, all) => line.startsWith("Warning:") && all.indexOf(line) === index);

const readRunOutput = (
  result: Spawned,
  sandboxed: boolean,
  command: string,
  display: string,
  durationMs: number,
): RunResult => {
  const json = parseJson(result.stdout);
  const problem = jsonProblem(json, display);
  if (problem !== null) return { ok: false, problem };
  if (json === null || failedExit(result)) return { ok: false, problem: failureProblem(result, sandboxed, display) };
  return { ok: true, json, command, durationMs, warnings: outputWarnings(result.stderr) };
};

/**
 * Runs fallow with JSON output and returns the parsed object.
 * Fallow exits 1 when it finds issues, so the exit code alone never decides success: valid JSON does.
 */
export const runFallow = async (request: RunRequest): Promise<RunResult> => {
  const executable = await resolveFallow(request.root, request.source, request.sandbox !== null);
  if (executable === null) return { ok: false, problem: notFound(request.source, request.sandbox !== null) };

  return inWorkdir(executable, request.root, (cwd) => runIn(request, executable, cwd));
};

const runIn = async (request: RunRequest, executable: Executable, cwd: string): Promise<RunResult> => {
  const execution = executionFor(request, executable, cwd);
  const display = `fallow ${request.args.join(" ")}`;
  if (unsafeCommand(execution)) return { ok: false, problem: unsafePathProblem() };

  const started = Date.now();
  const result = await run(
    execution.command,
    execution.args,
    execution.cwd,
    await childEnvironment(request.root),
    requestTimeout(request),
    request.signal,
  );
  const durationMs = Date.now() - started;
  const problem = runProblem(result, request, execution.sandbox, display);
  if (problem !== null) return { ok: false, problem };
  return readRunOutput(result, execution.sandbox !== null, `${executable.label}: ${display}`, display, durationMs);
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
  const env = await childEnvironment(root);
  const result = await inWorkdir(executable, root, (cwd) =>
    run(executable.command, [...executable.prefix, "--version"], cwd, env, 60_000, undefined),
  );
  const version = versionLine(result.stdout);
  if (result.exitCode !== 0 || version.length === 0)
    return { ok: false, problem: notFound(source, false) };
  return { ok: true, version, binary: binaryText(executable) };
};

/** A signed release prints a second `verified:` line after the version, so only the first counts. */
const versionLine = (stdout: string): string =>
  (stdout.trim().split("\n")[0] ?? "").replace(/^fallow\s+/, "").trim();

const binaryText = (executable: Executable): string =>
  executable.prefix.length > 0 ? `npx ${executable.prefix.join(" ")}` : executable.command;
