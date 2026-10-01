import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
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

const makeCase = ({ fallowJson = null, fallowExit = 0 } = {}) => {
  caseCounter += 1;
  const root = join(scratch, `case-${caseCounter}`);
  const bin = join(root, "bin");
  const project = join(root, "project");
  const home = join(root, "home");
  for (const dir of [bin, project, home]) mkdirSync(dir, { recursive: true });
  for (const name of HOST_TOOLS) symlinkSync(resolveTool(name), join(bin, name));

  const calls = join(root, "fallow-calls.log");
  if (fallowJson !== null) {
    const fake = join(bin, "fallow");
    writeFileSync(
      fake,
      [
        "#!/usr/bin/env bash",
        `echo "$*" >> '${calls}'`,
        'if [ "${1:-}" = "--version" ]; then echo "fallow 9.9.9"; exit 0; fi',
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

const runGate = (fixture, command, extraEnv = {}) =>
  spawnSync(join(fixture.bin, "bash"), [gate], {
    cwd: fixture.project,
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
  assert.match(auditCalls(fixture)[0], /^audit --format json --quiet --explain --gate-marker agent$/);
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

test("a gate registered by fallow agent install takes precedence", { skip }, () => {
  const fixture = makeCase({ fallowJson: { verdict: "fail" }, fallowExit: 1 });
  mkdirSync(join(fixture.project, ".claude"), { recursive: true });
  writeFileSync(
    join(fixture.project, ".claude", "settings.json"),
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
  const result = runGate(fixture, "git commit -m 'change'");
  assert.equal(result.status, 0);
  assert.deepEqual(auditCalls(fixture), []);
});

test("FALLOW_PLUGIN_GATE=off turns the gate off", { skip }, () => {
  const fixture = makeCase({ fallowJson: { verdict: "fail" }, fallowExit: 1 });
  const result = runGate(fixture, "git commit -m 'change'", { FALLOW_PLUGIN_GATE: "off" });
  assert.equal(result.status, 0);
  assert.deepEqual(auditCalls(fixture), []);
});
