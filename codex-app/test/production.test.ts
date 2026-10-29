import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import type { RunRequest, RunResult } from "../src/server/fallow-cli.ts";
import { createProductionLoader, inspectArguments } from "../src/server/production.ts";

const fixture = (name: string): Record<string, unknown> =>
  JSON.parse(
    readFileSync(new URL(`../../agent-view/fixtures/${name}.json`, import.meta.url), "utf8"),
  );

const fakeRunner = (result: RunResult) => {
  const calls: RunRequest[] = [];
  const run = async (request: RunRequest): Promise<RunResult> => {
    calls.push(request);
    return result;
  };
  return { calls, run };
};

const ok = (name: string): RunResult => ({
  ok: true,
  json: fixture(name),
  command: "fallow on PATH: fallow inspect",
  durationMs: 12,
  warnings: [],
});

describe("production loader", () => {
  it("runs fallow inspect with --cloud and JSON output for one file", async () => {
    const runner = fakeRunner(ok("ok"));
    const load = createProductionLoader(runner.run);
    const result = await load({ root: "/project", path: "src/services/user.ts", source: "auto" });
    assert.equal(runner.calls.length, 1);
    assert.deepEqual(runner.calls[0]?.args, inspectArguments("src/services/user.ts"));
    assert.ok(runner.calls[0]?.args.includes("--cloud"));
    assert.equal(runner.calls[0]?.sandbox, null);
    assert.equal(result.path, "src/services/user.ts");
    assert.equal(result.production.status, "ok");
    if (result.production.status === "ok") assert.equal(result.production.functions.length, 3);
  });

  for (const [name, status] of [
    ["no-key", "no_key"],
    ["plan-required", "plan_required"],
    ["untracked", "untracked"],
  ] as const) {
    it(`passes the ${status} status through, with no numbers`, async () => {
      const load = createProductionLoader(fakeRunner(ok(name)).run);
      const result = await load({ root: "/project", path: "src/services/user.ts", source: "auto" });
      assert.equal(result.production.status, status);
      assert.equal("functions" in result.production, false);
    });
  }

  it("names a fallow release without --cloud instead of failing", async () => {
    const load = createProductionLoader(
      fakeRunner({
        ok: false,
        problem: {
          code: "fallow_error",
          title: "Fallow stopped with an error",
          detail:
            "error: unexpected argument '--cloud' found\n\nUsage: fallow inspect --file <PATH>",
          fix: "fallow doctor",
        },
      }).run,
    );
    const result = await load({ root: "/project", path: "src/a.ts", source: "auto" });
    assert.equal(result.production.status, "cli_unsupported");
  });

  it("reuses a recent result for the same file", async () => {
    const runner = fakeRunner(ok("ok"));
    let now = 1_000;
    const load = createProductionLoader(runner.run, { ttlMs: 60_000, now: () => now });
    const request = { root: "/project", path: "src/services/user.ts", source: "auto" } as const;
    await load(request);
    await load(request);
    assert.equal(runner.calls.length, 1);
    now += 60_001;
    await load(request);
    assert.equal(runner.calls.length, 2);
  });

  it("does not keep a failed run, so the next try runs the CLI again", async () => {
    const runner = fakeRunner({
      ok: false,
      problem: { code: "fallow_error", title: "Fallow stopped with an error", detail: "boom", fix: "fallow doctor" },
    });
    const load = createProductionLoader(runner.run, { ttlMs: 60_000, now: () => 1_000 });
    const request = { root: "/project", path: "src/services/user.ts", source: "auto" } as const;
    assert.equal((await load(request)).production.status, "cli_failed");
    await load(request);
    assert.equal(runner.calls.length, 2);
  });

  it("refuses a path that fallow would read as an option", async () => {
    const runner = fakeRunner(ok("ok"));
    const load = createProductionLoader(runner.run);
    const result = await load({ root: "/project", path: "--cloud-url=evil", source: "auto" });
    assert.equal(runner.calls.length, 0);
    assert.equal(result.production.status, "cli_failed");
  });
});
