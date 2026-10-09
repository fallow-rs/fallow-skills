import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, it } from "node:test";
import { isWithin, locate } from "../src/server/app-tools.ts";
import {
  detectProjectRoot,
  resolveProject,
  sandboxFromMeta,
  threadCwdFromCodexSessions,
  threadFromMeta,
  toLocalPath,
} from "../src/server/project.ts";
import { createStateStore } from "../src/server/state.ts";
import { projectKey, rootFromKey } from "../src/server/uris.ts";

const THREAD = "01a1104d-2967-7ec0-8834-e7fd0d35f2f5";
const scratch = (): string => realpathSync(mkdtempSync(join(tmpdir(), "fallow-app-test-")));

describe("meta parsing", () => {
  it("reads the Codex sandbox state only when it names an executable", () => {
    assert.equal(sandboxFromMeta({}), null);
    assert.equal(
      sandboxFromMeta({ "codex/sandbox-state-meta": { sandboxCwd: "file:///x" } }),
      null,
    );
    const raw = { codexExecutable: "/bin/codex", sandboxCwd: "file:///x", future: 1 };
    assert.deepEqual(sandboxFromMeta({ "codex/sandbox-state-meta": raw }), {
      codexExecutable: "/bin/codex",
      raw,
    });
  });

  it("accepts only UUID thread ids", () => {
    assert.equal(threadFromMeta({ threadId: THREAD }), THREAD);
    assert.equal(threadFromMeta({ threadId: "../../etc" }), null);
    assert.equal(threadFromMeta({ threadId: 42 }), null);
  });

  it("turns file URIs and absolute paths into local paths, and nothing else", () => {
    assert.equal(toLocalPath("file:///tmp/a%20b"), "/tmp/a b");
    assert.equal(toLocalPath("/tmp/a"), "/tmp/a");
    assert.equal(toLocalPath("relative/a"), null);
    assert.equal(toLocalPath("host-resource://opaque"), null);
  });
});

describe("project roots", () => {
  it("prefers the nearest folder with a fallow config", async () => {
    const root = scratch();
    mkdirSync(join(root, "packages", "api", "src"), { recursive: true });
    writeFileSync(join(root, "package.json"), "{}");
    writeFileSync(join(root, "packages", "api", ".fallowrc.json"), "{}");
    assert.equal(
      await detectProjectRoot(join(root, "packages", "api", "src")),
      join(root, "packages", "api"),
    );
  });

  it("falls back to the nearest package.json outside git", async () => {
    const root = scratch();
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "package.json"), "{}");
    assert.equal(await detectProjectRoot(join(root, "src")), root);
  });

  it("resolves the thread working directory from the Codex session log", async () => {
    const home = scratch();
    const project = scratch();
    const day = join(home, "sessions", "2026", "10", "06");
    mkdirSync(day, { recursive: true });
    writeFileSync(
      join(day, `rollout-2026-10-06T10-20-54-${THREAD}.jsonl`),
      `${JSON.stringify({ type: "session_meta", payload: { cwd: project } })}\n{"type":"turn"}\n`,
    );
    process.env["CODEX_HOME"] = home;
    try {
      assert.equal(await threadCwdFromCodexSessions(THREAD), project);
      assert.equal(await threadCwdFromCodexSessions("00000000-0000-4000-8000-000000000000"), null);
    } finally {
      delete process.env["CODEX_HOME"];
    }
  });

  it("uses the sandbox cwd of a model call and remembers it for the thread tab", async () => {
    const project = scratch();
    writeFileSync(join(project, "package.json"), JSON.stringify({ name: "shop" }));
    const store = createStateStore(join(scratch(), "state.json"));
    const fromModel = await resolveProject(
      store,
      { threadId: THREAD, "codex/sandbox-state-meta": { sandboxCwd: pathToFileURL(project).href } },
      undefined,
    );
    assert.equal(fromModel?.project.name, "shop");
    assert.equal(fromModel?.source, "thread");
    const fromTab = await resolveProject(store, { threadId: THREAD }, undefined);
    assert.equal(fromTab?.project.root, project);
  });

  it("resolves a relative path argument against the thread directory", async () => {
    const project = scratch();
    mkdirSync(join(project, "packages", "web"), { recursive: true });
    const store = createStateStore(join(scratch(), "state.json"));
    const resolved = await resolveProject(
      store,
      { "codex/sandbox-state-meta": { sandboxCwd: pathToFileURL(project).href } },
      "packages/web",
    );
    assert.equal(resolved?.project.root, join(project, "packages", "web"));
  });

  it("returns null when nothing names a project", async () => {
    const store = createStateStore(join(scratch(), "state.json"));
    assert.equal(await resolveProject(store, {}, undefined), null);
  });
});

describe("file access for the app", () => {
  it("never leaves the base folder", async () => {
    const base = scratch();
    mkdirSync(join(base, "src"));
    writeFileSync(join(base, "src", "a.ts"), "export {}");
    assert.equal(isWithin(base, join(base, "src", "a.ts")), true);
    assert.equal(isWithin(base, join(base, "..", "etc")), false);
    assert.deepEqual(await locate([base], "src/a.ts"), {
      path: join(base, "src", "a.ts"),
      exists: true,
    });
    assert.equal(await locate([base], "../../etc/passwd"), null);
    assert.equal(await locate([base], "/etc/passwd"), null);
  });
});

describe("resource keys", () => {
  it("round-trips a root and rejects anything that is not an absolute path", () => {
    assert.equal(rootFromKey(projectKey("/Users/me/shop")), "/Users/me/shop");
    assert.equal(rootFromKey(projectKey("relative")), null);
    assert.equal(rootFromKey("not base64!"), null);
  });
});

describe("state", () => {
  it("persists settings and rejects a base ref that reads as a flag", async () => {
    const file = join(scratch(), "nested", "state.json");
    const store = createStateStore(file);
    assert.equal((await store.settings()).scope, "full");
    await store.updateSettings({ scope: "changed", baseRef: "origin/main" });
    assert.equal((await createStateStore(file).settings()).baseRef, "origin/main");
    await store.updateSettings({ baseRef: "--upload-pack=evil" });
    const reloaded = await createStateStore(file).settings();
    assert.equal(reloaded.baseRef, "", "an invalid value falls back to its default");
    assert.equal(reloaded.scope, "changed", "the other settings keep their values");
  });

  it("keeps the newest recent projects first, without duplicates", async () => {
    const store = createStateStore(join(scratch(), "state.json"));
    for (const name of ["a", "b", "a"]) {
      await store.touchRecent({
        root: `/${name}`,
        name,
        lastOpenedAt: "2026-10-09T00:00:00Z",
        grade: null,
        score: null,
      });
    }
    assert.deepEqual(
      (await store.recents()).map((recent) => recent.name),
      ["a", "b"],
    );
  });
});
