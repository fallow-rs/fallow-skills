import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "fallow");
const gate = join(pluginRoot, "hooks", "fallow-gate.sh");
const hooksConfig = join(pluginRoot, "hooks", "hooks.json");

// Only these tools reach the gate, so a fallow, npx or yarn on the host PATH
// cannot change the result.
const HOST_TOOLS = ["bash", "jq", "cat", "tr", "sed", "sort", "head", "mktemp", "rm", "grep"];

const scratch = mkdtempSync(join(tmpdir(), "fallow-gate-test-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

const resolveTool = (name) => {
  const result = spawnSync("bash", ["-c", `command -v ${name}`], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : null;
};

const missingTools = HOST_TOOLS.filter((name) => resolveTool(name) === null);
const skip = missingTools.length > 0 ? `missing host tools: ${missingTools.join(", ")}` : false;

let caseCounter = 0;

const makeCase = ({ fallowJson = null, fallowExit = 0, version = "9.9.9", tools = HOST_TOOLS } = {}) => {
  caseCounter += 1;
  const root = join(scratch, `case-${caseCounter}`);
  const bin = join(root, "bin");
  const project = join(root, "project");
  const home = join(root, "home");
  for (const dir of [bin, project, home]) mkdirSync(dir, { recursive: true });
  for (const name of tools) symlinkSync(resolveTool(name), join(bin, name));

  const calls = join(root, "fallow-calls.log");
  if (fallowJson !== null) {
    const fake = join(bin, "fallow");
    writeFileSync(
      fake,
      [
        "#!/usr/bin/env bash",
        `echo "$* @ $PWD" >> '${calls}'`,
        `if [ "\${1:-}" = "--version" ]; then echo "fallow ${version}"; exit 0; fi`,
        `cat <<'JSON'`,
        JSON.stringify(fallowJson),
        "JSON",
        `exit ${fallowExit}`,
        "",
      ].join("\n"),
    );
    chmodSync(fake, 0o755);
  }
  return { bin, project, home, calls };
};

const runGate = (fixture, command, extraEnv = {}, cwd = fixture.project) =>
  spawnSync(join(fixture.bin, "bash"), [gate], {
    cwd,
    encoding: "utf8",
    input: JSON.stringify({ tool_name: "Bash", tool_input: { command } }),
    env: {
      PATH: fixture.bin,
      HOME: fixture.home,
      CLAUDE_PROJECT_DIR: fixture.project,
      ...extraEnv,
    },
  });

const auditCalls = (fixture) =>
  existsSync(fixture.calls)
    ? readFileSync(fixture.calls, "utf8")
        .split("\n")
        .filter((line) => line.startsWith("audit"))
    : [];

test("hooks.json registers the gate as a PreToolUse Bash hook", () => {
  const config = JSON.parse(readFileSync(hooksConfig, "utf8"));
  const [group] = config.hooks.PreToolUse;
  assert.equal(group.matcher, "Bash");
  assert.equal(group.hooks[0].type, "command");
  assert.match(group.hooks[0].command, /\$\{CLAUDE_PLUGIN_ROOT\}"?\/hooks\/fallow-gate\.sh$/);
});

test("a command that is not a git commit or push passes without an audit", { skip }, () => {
  const fixture = makeCase({ fallowJson: { verdict: "fail" } });
  const result = runGate(fixture, "git status && ls");
  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
  assert.deepEqual(auditCalls(fixture), []);
});

test("a missing fallow binary allows the commit with a clear notice", { skip }, () => {
  const fixture = makeCase();
  const result = runGate(fixture, "git commit -m 'change'");
  assert.equal(result.status, 0);
  assert.match(result.stderr, /fallow binary is not installed/);
  assert.match(result.stderr, /continues without a fallow audit/);
});

test("a fail verdict blocks git push with exit code 2", { skip }, () => {
  const fixture = makeCase({ fallowJson: { verdict: "fail", summary: {} }, fallowExit: 1 });
  const result = runGate(fixture, "git -C . push origin HEAD");
  assert.equal(result.status, 2);
  assert.match(result.stderr, /blocked by fallow 9\.9\.9/);
  assert.equal(auditCalls(fixture).length, 1);
  assert.match(auditCalls(fixture)[0], /^audit --format json --quiet --explain --gate-marker agent @ /);
});

test("a pass verdict allows the commit", { skip }, () => {
  const fixture = makeCase({ fallowJson: { verdict: "pass" } });
  const result = runGate(fixture, "git commit -m 'change'");
  assert.equal(result.status, 0);
  assert.equal(auditCalls(fixture).length, 1);
});

test("a runtime error fails open", { skip }, () => {
  const fixture = makeCase({ fallowJson: { error: true, message: "boom" }, fallowExit: 2 });
  const result = runGate(fixture, "git commit -m 'change'");
  assert.equal(result.status, 0);
  assert.match(result.stderr, /runtime error \(boom\)/);
});

const registerInstalledGate = (dir, { withScript }) => {
  mkdirSync(join(dir, ".claude", "hooks"), { recursive: true });
  writeFileSync(
    join(dir, ".claude", "settings.json"),
    JSON.stringify({
      hooks: {
        PreToolUse: [
          {
            matcher: "Bash",
            hooks: [{ type: "command", command: '"$CLAUDE_PROJECT_DIR"/.claude/hooks/fallow-gate.sh' }],
          },
        ],
      },
    }),
  );
  if (withScript) writeFileSync(join(dir, ".claude", "hooks", "fallow-gate.sh"), "#!/usr/bin/env bash\n");
};

test("a gate registered by fallow agent install takes precedence", { skip }, () => {
  const fixture = makeCase({ fallowJson: { verdict: "fail" }, fallowExit: 1 });
  registerInstalledGate(fixture.project, { withScript: true });
  const result = runGate(fixture, "git commit -m 'change'");
  assert.equal(result.status, 0);
  assert.deepEqual(auditCalls(fixture), []);
});

test("a user-level gate registered by fallow agent install takes precedence", { skip }, () => {
  const fixture = makeCase({ fallowJson: { verdict: "fail" }, fallowExit: 1 });
  registerInstalledGate(fixture.home, { withScript: true });
  const result = runGate(fixture, "git push");
  assert.equal(result.status, 0);
  assert.deepEqual(auditCalls(fixture), []);
});

test("a stale settings entry without the gate script does not turn the gate off", { skip }, () => {
  const fixture = makeCase({ fallowJson: { verdict: "fail" }, fallowExit: 1 });
  registerInstalledGate(fixture.project, { withScript: false });
  const result = runGate(fixture, "git commit -m 'change'");
  assert.equal(result.status, 2);
  assert.equal(auditCalls(fixture).length, 1);
});

test("the audit runs in the hook working directory", { skip }, () => {
  const fixture = makeCase({ fallowJson: { verdict: "pass" } });
  const other = join(fixture.project, "..", "elsewhere");
  mkdirSync(other);
  const result = runGate(fixture, "git commit -m 'change'", {}, other);
  assert.equal(result.status, 0);
  assert.equal(auditCalls(fixture).length, 1);
  assert.ok(auditCalls(fixture)[0].endsWith(" @ " + realpathSync(other)), auditCalls(fixture)[0]);
});

test("a fallow binary below the version floor allows the commit with a notice", { skip }, () => {
  const fixture = makeCase({ fallowJson: { verdict: "fail" }, fallowExit: 1, version: "2.84.0" });
  const result = runGate(fixture, "git commit -m 'change'");
  assert.equal(result.status, 0);
  assert.match(result.stderr, /below the required 2\.85\.0/);
  assert.match(result.stderr, /continues without a fallow audit/);
  assert.deepEqual(auditCalls(fixture), []);
});

test("a missing jq gives a notice only for a git commit or push", { skip }, () => {
  const fixture = makeCase({
    fallowJson: { verdict: "fail" },
    fallowExit: 1,
    tools: HOST_TOOLS.filter((name) => name !== "jq"),
  });
  const other = runGate(fixture, "ls -la");
  assert.equal(other.status, 0);
  assert.equal(other.stderr, "");
  const commit = runGate(fixture, "git commit -m 'change'");
  assert.equal(commit.status, 0);
  assert.match(commit.stderr, /jq is not on PATH/);
  assert.deepEqual(auditCalls(fixture), []);
});

test("FALLOW_PLUGIN_GATE=off turns the gate off", { skip }, () => {
  const fixture = makeCase({ fallowJson: { verdict: "fail" }, fallowExit: 1 });
  const result = runGate(fixture, "git commit -m 'change'", { FALLOW_PLUGIN_GATE: "off" });
  assert.equal(result.status, 0);
  assert.deepEqual(auditCalls(fixture), []);
});
