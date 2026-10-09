import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { ruleCategory } from "../src/app/config-rules.ts";
import { parseRoute } from "../src/app/route.ts";
import { parseSarif } from "../src/app/sarif.ts";
import { runFallow } from "../src/server/fallow-cli.ts";

const IS_WINDOWS = process.platform === "win32";

/** A project with a fake `node_modules/.bin/fallow` that runs the given shell body. */
const projectWithFallow = (body: string): string => {
  const root = mkdtempSync(join(tmpdir(), "fallow-cli-test-"));
  const bin = join(root, "node_modules", ".bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "fallow"), `#!/bin/sh\n${body}\n`);
  chmodSync(join(bin, "fallow"), 0o755);
  return root;
};

describe(
  "runFallow",
  { skip: IS_WINDOWS ? "uses a POSIX shell script as the fake binary" : false },
  () => {
    it("accepts JSON on stdout even when fallow exits 1 for findings", async () => {
      const root = projectWithFallow(`echo '{"kind":"combined","version":"9.9.9"}'; exit 1`);
      const result = await runFallow({
        root,
        args: ["--format", "json"],
        source: "project",
        sandbox: null,
      });
      assert.ok(result.ok);
      assert.equal(result.json["version"], "9.9.9");
    });

    it("reports stderr when fallow prints no JSON", async () => {
      const root = projectWithFallow(`echo 'error: invalid config at .fallowrc.json' >&2; exit 2`);
      const result = await runFallow({ root, args: [], source: "project", sandbox: null });
      assert.ok(!result.ok);
      assert.equal(result.problem.code, "fallow_failed");
      assert.match(result.problem.detail, /invalid config/);
    });

    it("stops a run that takes too long", async () => {
      const root = projectWithFallow("sleep 5");
      const result = await runFallow({
        root,
        args: [],
        source: "project",
        sandbox: null,
        timeoutMs: 200,
      });
      assert.ok(!result.ok);
      assert.equal(result.problem.code, "timeout");
    });

    it("says how to install fallow when the project has no binary", async () => {
      const root = mkdtempSync(join(tmpdir(), "fallow-cli-empty-"));
      const result = await runFallow({ root, args: [], source: "project", sandbox: null });
      assert.ok(!result.ok);
      assert.equal(result.problem.code, "fallow_not_found");
      assert.match(result.problem.fix ?? "", /install/);
    });

    it("runs fallow through the Codex sandbox and forwards the state unchanged", async () => {
      const root = projectWithFallow("exit 0");
      const log = join(root, "sandbox-args.txt");
      const codex = join(root, "fake-codex");
      writeFileSync(
        codex,
        `#!/bin/sh\nprintf '%s\\n' "$@" > '${log}'\necho '{"kind":"combined"}'\n`,
      );
      chmodSync(codex, 0o755);
      const raw = { codexExecutable: codex, sandboxCwd: "file:///x", future: { keep: true } };
      const result = await runFallow({
        root,
        args: ["--format", "json"],
        source: "project",
        sandbox: { codexExecutable: codex, raw },
      });
      assert.ok(result.ok);
      const args = readFileSync(log, "utf8").trim().split("\n");
      assert.deepEqual(args.slice(0, 2), ["sandbox", "--sandbox-state-json"]);
      assert.deepEqual(JSON.parse(args[2] ?? ""), raw);
      assert.equal(args[3], "--");
      assert.match(args[4] ?? "", /node_modules\/\.bin\/fallow$/);
      assert.deepEqual(args.slice(5), ["--format", "json"]);
    });
  },
);

describe("parseSarif", () => {
  it("reads fallow SARIF with rules, levels and locations", () => {
    const outcome = parseSarif(
      readFileSync(new URL("./fixtures/report.sarif", import.meta.url), "utf8"),
    );
    assert.ok(outcome.ok);
    assert.ok(outcome.report.results.length > 0);
    assert.ok(outcome.report.tools.some((tool) => tool.name === "fallow"));
    const located = outcome.report.results.find((result) => result.uri !== null);
    assert.ok(located !== undefined && !located.uri?.startsWith("/"));
    assert.equal(outcome.report.rules.get("fallow/unused-file")?.name, "unused-file");
  });

  it("fills message arguments, base URIs and rule indexes of other analyzers", () => {
    const sarif = {
      runs: [
        {
          tool: {
            driver: {
              name: "lint",
              rules: [{ id: "L1", messageStrings: { default: { text: "Bad {0}" } } }],
            },
          },
          originalUriBaseIds: { SRC: { uri: "file:///repo/" } },
          results: [
            {
              ruleIndex: 0,
              message: { id: "default", arguments: ["thing"] },
              locations: [
                {
                  physicalLocation: {
                    artifactLocation: { uri: "a%20b.ts", uriBaseId: "SRC" },
                    region: { startLine: 4 },
                  },
                },
              ],
            },
          ],
        },
      ],
    };
    const outcome = parseSarif(JSON.stringify(sarif));
    assert.ok(outcome.ok);
    const [result] = outcome.report.results;
    assert.equal(result?.ruleId, "L1");
    assert.equal(result?.message, "Bad thing");
    assert.equal(result?.uri, "file:///repo/a b.ts");
    assert.equal(result?.line, 4);
    assert.equal(result?.level, "warning");
  });

  it("explains invalid input instead of throwing", () => {
    assert.deepEqual(parseSarif("{"), { ok: false, error: "The file is not valid JSON." });
    assert.deepEqual(parseSarif("{}"), { ok: false, error: "The file has no SARIF runs." });
  });
});

describe("deep links", () => {
  it("routes to tabs, filters and single findings", () => {
    assert.equal(parseRoute(null).tab, "overview");
    assert.deepEqual(parseRoute("/findings?category=dead-code&q=money"), {
      tab: "findings",
      category: "dead-code",
      query: "money",
      findingId: null,
    });
    assert.equal(parseRoute("/findings?category=nonsense").category, null);
    assert.equal(
      parseRoute("/finding/dc1%3Aunused-export%3Aabc").findingId,
      "dc1:unused-export:abc",
    );
    assert.equal(parseRoute("/insights").tab, "insights");
  });
});

describe("config rule groups", () => {
  it("groups config rule keys like the dashboard categories", () => {
    assert.equal(ruleCategory("unused-exports"), "dead-code");
    assert.equal(ruleCategory("unused-dev-dependencies"), "dependencies");
    assert.equal(ruleCategory("circular-dependencies"), "architecture");
    assert.equal(ruleCategory("unused-component-props"), "frameworks");
    assert.equal(ruleCategory("stale-suppressions"), "hygiene");
  });
});
