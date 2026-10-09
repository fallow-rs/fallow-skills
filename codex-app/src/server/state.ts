import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";
import type { RecentProject } from "../shared/contracts.ts";

/** A git ref that cannot be read as a flag. Empty means "detect the base branch". */
export const BASE_REF_PATTERN = "^$|^[A-Za-z0-9_][A-Za-z0-9._/@^~-]{0,99}$";

export const SettingsSchema = z.object({
  scope: z.enum(["full", "changed"]),
  baseRef: z.string().max(100).regex(new RegExp(BASE_REF_PATTERN)),
  production: z.boolean(),
  source: z.enum(["auto", "project", "path", "npx"]),
  sandbox: z.boolean(),
  findingsForCodex: z.number().int().min(5).max(200),
});

export type AppSettings = z.infer<typeof SettingsSchema>;

export const DEFAULT_SETTINGS: AppSettings = {
  scope: "full",
  baseRef: "",
  production: false,
  source: "auto",
  sandbox: true,
  findingsForCodex: 25,
};

const RecentSchema = z.object({
  root: z.string(),
  name: z.string(),
  lastOpenedAt: z.string(),
  grade: z.string().nullable(),
  score: z.number().nullable(),
});

const StateSchema = z.object({
  version: z.literal(1),
  settings: z.record(z.string(), z.unknown()).default({}),
  recents: z.array(RecentSchema).default([]),
  threads: z.record(z.string(), z.string()).default({}),
});

type State = z.infer<typeof StateSchema>;

const MAX_RECENTS = 8;
const MAX_THREADS = 200;

/** Picks the per-user state file of the host platform. `FALLOW_CODEX_APP_STATE` overrides it. */
export const stateFilePath = (): string => {
  const override = process.env["FALLOW_CODEX_APP_STATE"];
  if (override !== undefined && override.length > 0) return override;
  const home = homedir();
  if (process.platform === "darwin")
    return join(home, "Library", "Application Support", "fallow", "codex-app.json");
  if (process.platform === "win32") {
    return join(
      process.env["LOCALAPPDATA"] ?? join(home, "AppData", "Local"),
      "fallow",
      "codex-app.json",
    );
  }
  return join(
    process.env["XDG_STATE_HOME"] ?? join(home, ".local", "state"),
    "fallow",
    "codex-app.json",
  );
};

export interface StateStore {
  settings(): Promise<AppSettings>;
  updateSettings(patch: Partial<AppSettings>): Promise<AppSettings>;
  recents(): Promise<RecentProject[]>;
  touchRecent(project: RecentProject): Promise<void>;
  threadRoot(threadId: string): Promise<string | null>;
  rememberThread(threadId: string, root: string): Promise<void>;
}

/** A small JSON store. Writes go through a temp file and a rename, so a crash never leaves half a file. */
export const createStateStore = (path: string = stateFilePath()): StateStore => {
  let cache: State | null = null;
  let queue: Promise<unknown> = Promise.resolve();

  const load = async (): Promise<State> => {
    if (cache !== null) return cache;
    try {
      const parsed = StateSchema.safeParse(JSON.parse(await readFile(path, "utf8")));
      cache = parsed.success ? parsed.data : StateSchema.parse({ version: 1 });
    } catch {
      cache = StateSchema.parse({ version: 1 });
    }
    return cache;
  };

  const save = (mutate: (state: State) => State): Promise<State> => {
    const next = queue.then(async () => {
      const state = mutate(await load());
      cache = state;
      await mkdir(dirname(path), { recursive: true });
      const temporary = `${path}.${process.pid}.tmp`;
      await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf8");
      await rename(temporary, path);
      return state;
    });
    queue = next.catch(() => undefined);
    return next;
  };

  /** Validates each stored setting on its own, so one bad value never resets the others. */
  const effective = (state: State): AppSettings => {
    const fields = Object.keys(DEFAULT_SETTINGS) as Array<keyof AppSettings>;
    return Object.fromEntries(
      fields.map((field) => {
        const parsed = SettingsSchema.shape[field].safeParse(state.settings[field]);
        return [field, parsed.success ? parsed.data : DEFAULT_SETTINGS[field]];
      }),
    ) as AppSettings;
  };

  return {
    settings: async () => effective(await load()),
    updateSettings: async (patch) =>
      effective(await save((state) => ({ ...state, settings: { ...state.settings, ...patch } }))),
    recents: async () => (await load()).recents,
    touchRecent: async (project) => {
      await save((state) => ({
        ...state,
        recents: [project, ...state.recents.filter((recent) => recent.root !== project.root)].slice(
          0,
          MAX_RECENTS,
        ),
      }));
    },
    threadRoot: async (threadId) => (await load()).threads[threadId] ?? null,
    rememberThread: async (threadId, root) => {
      if ((await load()).threads[threadId] === root) return;
      await save((state) => {
        const entries = Object.entries({ ...state.threads, [threadId]: root });
        return { ...state, threads: Object.fromEntries(entries.slice(-MAX_THREADS)) };
      });
    },
  };
};
