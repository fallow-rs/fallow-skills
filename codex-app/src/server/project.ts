import { execFile } from "node:child_process";
import { open, readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ProjectRef } from "../shared/contracts.ts";
import type { SandboxState } from "./fallow-cli.ts";
import { isRecord, record, string } from "./json.ts";
import type { StateStore } from "./state.ts";

const SANDBOX_META_KEY = "codex/sandbox-state-meta";
const THREAD_META_KEY = "threadId";
const RESOURCE_META_KEY = "openai/resource";
const CONFIG_FILES = [".fallowrc.json", ".fallowrc.jsonc", "fallow.toml", ".fallow.toml"];
const THREAD_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isDirectory = async (path: string): Promise<boolean> => {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
};

const exists = async (path: string): Promise<boolean> => {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
};

const git = (cwd: string, args: string[]): Promise<string | null> =>
  new Promise((resolvePromise) => {
    execFile("git", args, { cwd, timeout: 5000, windowsHide: true }, (error, stdout) => {
      resolvePromise(error === null ? stdout.trim() : null);
    });
  });

/** Accepts a `file://` URI or an absolute path. Returns null for anything else. */
export const toLocalPath = (value: string): string | null => {
  if (value.startsWith("file://")) {
    try {
      return fileURLToPath(value);
    } catch {
      return null;
    }
  }
  return isAbsolute(value) ? resolve(value) : null;
};

/**
 * Picks the project root for a directory: the nearest folder with a fallow config, else the git
 * top level when it has a package.json, else the nearest folder with a package.json, else the folder itself.
 */
export const detectProjectRoot = async (start: string): Promise<string> => {
  const top = await git(start, ["rev-parse", "--show-toplevel"]);
  const stop = top === null ? null : resolve(top);
  let nearestPackage: string | null = null;
  let directory = resolve(start);
  for (;;) {
    for (const name of CONFIG_FILES) {
      if (await exists(join(directory, name))) return directory;
    }
    if (nearestPackage === null && (await exists(join(directory, "package.json"))))
      nearestPackage = directory;
    const parent = dirname(directory);
    if (directory === stop || parent === directory) break;
    directory = parent;
  }
  if (stop !== null && (await exists(join(stop, "package.json")))) return stop;
  return nearestPackage ?? resolve(start);
};

export const describeProject = async (root: string): Promise<ProjectRef> => {
  let name = basename(root);
  try {
    const manifest: unknown = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
    name = string(record(manifest)["name"]) ?? name;
  } catch {
    // A folder without a package.json keeps its directory name.
  }
  const branch = await git(root, ["rev-parse", "--abbrev-ref", "HEAD"]);
  return { root, name, branch: branch === "HEAD" ? null : branch };
};

/** Reads the sandbox state of a model tool call. App and entrypoint calls carry none. */
export const sandboxFromMeta = (meta: unknown): SandboxState | null => {
  const raw = record(meta)[SANDBOX_META_KEY];
  if (!isRecord(raw)) return null;
  const codexExecutable = string(raw["codexExecutable"]);
  return codexExecutable === null ? null : { codexExecutable, raw };
};

/** The sandbox state of the last model call per thread, in memory only. */
const threadSandboxes = new Map<string, SandboxState>();

/**
 * The sandbox for a tool call. A model call carries its own state. A call from the sidebar or the
 * thread tab carries only the thread id; it gets the state of the last model call in that thread,
 * because it acts for the same user in the same thread. Without one, the caller runs unsandboxed
 * and `resolveFallow` then refuses a binary from the project itself.
 */
export const sandboxFor = (meta: unknown): SandboxState | null => {
  const own = sandboxFromMeta(meta);
  const threadId = threadFromMeta(meta);
  if (own !== null) {
    if (threadId !== null) threadSandboxes.set(threadId, own);
    return own;
  }
  return threadId === null ? null : (threadSandboxes.get(threadId) ?? null);
};

export const threadFromMeta = (meta: unknown): string | null => {
  const id = string(record(meta)[THREAD_META_KEY]);
  return id !== null && THREAD_ID_PATTERN.test(id) ? id : null;
};

const sandboxCwd = (meta: unknown): string | null => {
  const raw = record(record(meta)[SANDBOX_META_KEY]);
  const cwd = string(raw["sandboxCwd"]);
  return cwd === null ? null : toLocalPath(cwd);
};

/** The trusted path that the host adds when the app runs inside a file entrypoint. */
export const resourcePathFromMeta = (meta: unknown): string | null => {
  const path = string(record(record(meta)[RESOURCE_META_KEY])["path"]);
  return path === null ? null : toLocalPath(path);
};

const sortedDescending = async (directory: string): Promise<string[]> => {
  try {
    return (await readdir(directory))
      .filter((name) => !name.startsWith("."))
      .sort()
      .reverse();
  } catch {
    return [];
  }
};

const MAX_DAYS_SCANNED = 120;

/**
 * Best effort: finds the working directory of a Codex thread in its session log.
 * Codex names each log `rollout-<time>-<thread id>.jsonl`, and the first line holds `payload.cwd`.
 */
export const threadCwdFromCodexSessions = async (threadId: string): Promise<string | null> => {
  if (!THREAD_ID_PATTERN.test(threadId)) return null;
  const sessions = join(process.env["CODEX_HOME"] ?? join(homedir(), ".codex"), "sessions");
  let scanned = 0;
  for (const year of await sortedDescending(sessions)) {
    for (const month of await sortedDescending(join(sessions, year))) {
      for (const day of await sortedDescending(join(sessions, year, month))) {
        scanned += 1;
        if (scanned > MAX_DAYS_SCANNED) return null;
        const directory = join(sessions, year, month, day);
        const match = (await sortedDescending(directory)).find((name) =>
          name.endsWith(`${threadId}.jsonl`),
        );
        if (match !== undefined) return readSessionCwd(join(directory, match));
      }
    }
  }
  return null;
};

const readSessionCwd = async (file: string): Promise<string | null> => {
  const handle = await open(file, "r").catch(() => null);
  if (handle === null) return null;
  try {
    const buffer = Buffer.alloc(64 * 1024);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const firstLine = buffer.subarray(0, bytesRead).toString("utf8").split("\n")[0] ?? "";
    const cwd = string(record(record(JSON.parse(firstLine))["payload"])["cwd"]);
    return cwd !== null && isAbsolute(cwd) ? cwd : null;
  } catch {
    return null;
  } finally {
    await handle.close();
  }
};

export type ProjectSource = "argument" | "thread" | "file" | "recent";

export interface ResolvedProject {
  project: ProjectRef;
  source: ProjectSource;
}

/**
 * Finds the project for a tool call, most specific first:
 * an explicit `root` argument, the thread working directory, the file the app opened, then the last project.
 */
export const resolveProject = async (
  store: StateStore,
  meta: unknown,
  explicitRoot: string | undefined,
): Promise<ResolvedProject | null> => {
  const threadId = threadFromMeta(meta);
  const remember = async (root: string, source: ProjectSource): Promise<ResolvedProject> => {
    if (threadId !== null && source !== "recent") await store.rememberThread(threadId, root);
    return { project: await describeProject(root), source };
  };

  const cwd = sandboxCwd(meta);
  if (explicitRoot !== undefined && explicitRoot.length > 0) {
    const absolute = toLocalPath(explicitRoot);
    const base = cwd ?? (await store.threadRoot(threadId ?? "")) ?? (await store.recents())[0]?.root ?? null;
    const local = absolute ?? (base === null ? null : resolve(base, explicitRoot));
    if (local !== null && (await isDirectory(local))) return remember(local, "argument");
  }
  if (cwd !== null && (await isDirectory(cwd)))
    return remember(await detectProjectRoot(cwd), "thread");

  const opened = resourcePathFromMeta(meta);
  if (opened !== null) return remember(await detectProjectRoot(dirname(opened)), "file");

  if (threadId !== null) {
    const known = await store.threadRoot(threadId);
    if (known !== null && (await isDirectory(known))) return remember(known, "thread");
    const sessionCwd = await threadCwdFromCodexSessions(threadId);
    if (sessionCwd !== null && (await isDirectory(sessionCwd))) {
      return remember(await detectProjectRoot(sessionCwd), "thread");
    }
  }
  const recent = (await store.recents())[0];
  if (recent !== undefined && (await isDirectory(recent.root)))
    return remember(recent.root, "recent");
  return null;
};
