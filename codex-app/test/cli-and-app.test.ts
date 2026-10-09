import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { ruleCategory } from "../src/app/config-rules.ts";
import { parseRoute } from "../src/app/route.ts";
import { parseSarif } from "../src/app/sarif.ts";
import { ignoredBase, resolveFallow, runFallow } from "../src/server/fallow-cli.ts";

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

/**
 * A stand-in for `codex sandbox --sandbox-state-json <state> -- <command...>`: it records its
 * arguments and runs the command. The project binary only runs inside a sandbox.
 */
const fakeSandbox = (root: string) => {
  const codex = join(root, "codex");
  const log = join(root, "sandbox-args.txt");
  writeFileSync(codex, `#!/bin/sh\nprintf '%s\\n' "$@" > '${log}'\nshift 4\nexec "$@"\n`);
  chmodSync(codex, 0o755);
  return { log, sandbox: { codexExecutable: codex, raw: { codexExecutable: codex, future: { keep: true } } } };
};

const run = (root: string) => {
  const { sandbox } = fakeSandbox(root);
  return (args: string[] = ["--format", "json"], timeoutMs?: number) =>
    runFallow({ root, args, source: "project", sandbox, ...(timeoutMs === undefined ? {} : { timeoutMs }) });
};

describe("runFallow", { skip: IS_WINDOWS ? "uses POSIX shell scripts as fake binaries" : false }, () => {
  it("accepts JSON on stdout even when fallow exits 1 for findings", async () => {
    const result = await run(projectWithFallow(`echo '{"kind":"combined","version":"9.9.9"}'; exit 1`))();
    assert.ok(result.ok);
    assert.equal(result.json["version"], "9.9.9");
  });

  it("turns fallow's error object into a problem, never into an empty report", async () => {
    const root = projectWithFallow(`echo '{"error":true,"message":"unknown revision nope","exit_code":2}'; exit 2`);
    const result = await run(root)();
    assert.ok(!result.ok);
    assert.equal(result.problem.code, "fallow_error");
    assert.match(result.problem.detail, /unknown revision/);
  });

  it("fails on exit code 2 even with JSON on stdout", async () => {
    const result = await run(projectWithFallow(`echo '{"kind":"combined"}'; echo 'panic' >&2; exit 2`))();
    assert.ok(!result.ok);
    assert.equal(result.problem.code, "fallow_failed");
  });

  it("reports stderr when fallow prints no JSON", async () => {
    const result = await run(projectWithFallow(`echo 'error: invalid config at .fallowrc.json' >&2; exit 2`))([]);
    assert.ok(!result.ok);
    assert.match(result.problem.detail, /invalid config/);
  });

  it("returns warnings, and recognizes an ignored base", async () => {
    const root = projectWithFallow(
      `echo "Warning: --changed-since 'nope' was ignored because fatal" >&2; echo '{"kind":"combined"}'`,
    );
    const result = await run(root)();
    assert.ok(result.ok);
    assert.ok(ignoredBase(result.warnings));
    assert.ok(!ignoredBase(["Warning: something else"]));
  });

  it("stops a run that takes too long, even when it ignores SIGTERM", async () => {
    const root = projectWithFallow("trap '' TERM; sleep 30");
    const started = Date.now();
    const result = await run(root)([], 200);
    assert.ok(!result.ok);
    assert.equal(result.problem.code, "timeout");
    assert.ok(Date.now() - started < 10_000);
  });

  it("passes only allowlisted environment variables to fallow", async () => {
    process.env["SECRET_API_TOKEN"] = "do-not-leak";
    process.env["npm_config_//registry.npmjs.org/:_authToken"] = "do-not-leak";
    process.env["FALLOW_TEST_FLAG"] = "kept";
    try {
      const root = projectWithFallow(
        `printf '{"kind":"combined","secret":"%s","npm":"%s","flag":"%s"}' "$SECRET_API_TOKEN" "$(env | grep -ci authtoken)" "$FALLOW_TEST_FLAG"`,
      );
      const result = await run(root)();
      assert.ok(result.ok);
      assert.equal(result.json["secret"], "");
      assert.equal(result.json["npm"], "0");
      assert.equal(result.json["flag"], "kept");
    } finally {
      delete process.env["SECRET_API_TOKEN"];
      delete process.env["npm_config_//registry.npmjs.org/:_authToken"];
      delete process.env["FALLOW_TEST_FLAG"];
    }
  });

  it("forwards the sandbox state unchanged and runs the project binary inside it", async () => {
    const root = projectWithFallow(`echo '{"kind":"combined"}'`);
    const { log, sandbox } = fakeSandbox(root);
    const result = await runFallow({ root, args: ["--format", "json"], source: "project", sandbox });
    assert.ok(result.ok);
    const args = readFileSync(log, "utf8").trim().split("\n");
    assert.deepEqual(args.slice(0, 2), ["sandbox", "--sandbox-state-json"]);
    assert.deepEqual(JSON.parse(args[2] ?? ""), sandbox.raw);
    assert.equal(args[3], "--");
    assert.match(args[4] ?? "", /node_modules\/\.bin\/fallow$/);
    assert.deepEqual(args.slice(5), ["--format", "json"]);
  });

  it("never runs a project's own fallow outside the sandbox", async () => {
    const root = projectWithFallow(`echo '{"kind":"combined","version":"from-project"}'`);
    for (const source of ["auto", "project", "npx"] as const) {
      const executable = await resolveFallow(root, source, false);
      assert.ok(executable === null || !executable.command.startsWith(root), `${source}: ${executable?.command}`);
      assert.ok(executable === null || executable.label === "fallow on PATH", source);
    }
    const sandboxed = await resolveFallow(root, "auto", true);
    assert.ok(sandboxed?.command.startsWith(root));
  });

  it("says how to install fallow when PATH has none outside the sandbox", async () => {
    const root = projectWithFallow("exit 0");
    const path = process.env["PATH"];
    process.env["PATH"] = join(root, "missing");
    try {
      const result = await runFallow({ root, args: [], source: "auto", sandbox: null });
      assert.ok(!result.ok);
      assert.equal(result.problem.code, "fallow_not_found");
      assert.match(result.problem.detail, /outside the Codex sandbox/i);
    } finally {
      process.env["PATH"] = path;
    }
  });
});

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
