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
const HOST_TOOLS = ["bash", "jq", "cat", "tr", "sed", "sort", "head", "mktemp", "rm", "grep", "dirname"];

const scratch = mkdtempSync(join(tmpdir(), "fallow-gate-test-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

const resolveTool = (name) => {
  const result = spawnSync("bash", ["-c", `command -v ${name}`], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : null;
};

const missingTools = HOST_TOOLS.filter((name) => resolveTool(name) === null);
const skip = missingTools.length > 0 ? `missing host tools: ${missingTools.join(", ")}` : false;

let caseCounter = 0;

const makeCase = ({
  fallowJson = null,
  fallowExit = 0,
  version = "9.9.9",
  tools = HOST_TOOLS,
  optIn = true,
} = {}) => {
  caseCounter += 1;
  const root = join(scratch, `case-${caseCounter}`);
  const bin = join(root, "bin");
  const project = join(root, "project");
  const home = join(root, "home");
  for (const dir of [bin, project, home]) mkdirSync(dir, { recursive: true });
  for (const name of tools) symlinkSync(resolveTool(name), join(bin, name));
  mkdirSync(join(project, ".git"));
  if (optIn) writeFileSync(join(project, ".fallowrc.json"), "{}\n");

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
  return { root, bin, project, home, calls };
};

const runGate = (fixture, command, extraEnv = {}, cwd = fixture.project, inputCwd = undefined) =>
  spawnSync(join(fixture.bin, "bash"), [gate], {
    cwd,
    encoding: "utf8",
    input: JSON.stringify({ tool_name: "Bash", tool_input: { command }, ...(inputCwd ? { cwd: inputCwd } : {}) }),
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

test("the audit runs in the opted-in project root from a subdirectory", { skip }, () => {
  const fixture = makeCase({ fallowJson: { verdict: "pass" } });
  const sub = join(fixture.project, "packages", "app");
  mkdirSync(sub, { recursive: true });
  const result = runGate(fixture, "git commit -m 'change'", {}, sub);
  assert.equal(result.status, 0);
  assert.equal(auditCalls(fixture).length, 1);
  assert.ok(auditCalls(fixture)[0].endsWith(" @ " + realpathSync(fixture.project)), auditCalls(fixture)[0]);
});

test("a project without a fallow config or dependency is not gated", { skip }, () => {
  const fixture = makeCase({ fallowJson: { verdict: "fail" }, fallowExit: 1, optIn: false });
  writeFileSync(join(fixture.project, "package.json"), JSON.stringify({ devDependencies: { knip: "1" } }));
  const result = runGate(fixture, "git commit -m 'change'");
  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
  assert.deepEqual(auditCalls(fixture), []);
});

test("a fallow dependency in package.json opts the project in", { skip }, () => {
  const fixture = makeCase({ fallowJson: { verdict: "fail" }, fallowExit: 1, optIn: false });
  writeFileSync(join(fixture.project, "package.json"), JSON.stringify({ devDependencies: { fallow: "^2.90.0" } }));
  const result = runGate(fixture, "git commit -m 'change'");
  assert.equal(result.status, 2);
  assert.equal(auditCalls(fixture).length, 1);
});

test("the opt-in walk stops at a nested worktree", { skip }, () => {
  const fixture = makeCase({ fallowJson: { verdict: "fail" }, fallowExit: 1 });
  const worktree = join(fixture.project, ".claude", "worktrees", "feature");
  mkdirSync(worktree, { recursive: true });
  writeFileSync(join(worktree, ".git"), "gitdir: elsewhere\n");
  const result = runGate(fixture, "git commit -m 'change'", {}, worktree);
  assert.equal(result.status, 0);
  assert.deepEqual(auditCalls(fixture), []);
});

test("the walk starts at the cwd of the hook input", { skip }, () => {
  const fixture = makeCase({ fallowJson: { verdict: "fail" }, fallowExit: 1 });
  const elsewhere = join(fixture.project, "..", "plain");
  mkdirSync(join(elsewhere, ".git"), { recursive: true });
  const result = runGate(fixture, "git commit -m 'change'", {}, elsewhere, fixture.project);
  assert.equal(result.status, 2);
  const auditDir = auditCalls(fixture)[0].split(" @ ")[1];
  assert.equal(realpathSync(auditDir), realpathSync(fixture.project));
});

const makeRepo = (fixture, name, { optIn }) => {
  const dir = join(fixture.root, name);
  mkdirSync(join(dir, ".git"), { recursive: true });
  if (optIn) writeFileSync(join(dir, ".fallowrc.json"), "{}\n");
  return dir;
};

// Each case names the directories the gate must audit. "project" is the
// session directory. "optout" is a repository without fallow, and "optin" and
// "my optin" are repositories with fallow.
const auditedNames = (fixture) =>
  auditCalls(fixture)
    .map((line) => realpathSync(line.split(" @ ")[1]))
    .map((dir) => dir.slice(realpathSync(fixture.root).length + 1))
    .sort();

const runCase = (command, verdict = "pass", setup = () => {}) => {
  const fixture = makeCase({ fallowJson: { verdict }, fallowExit: verdict === "fail" ? 1 : 0 });
  const dirs = {
    o: makeRepo(fixture, "optout", { optIn: false }),
    i: makeRepo(fixture, "optin", { optIn: true }),
    s: makeRepo(fixture, "my optin", { optIn: true }),
    r: fixture.root,
    p: fixture.project,
    h: fixture.home,
  };
  writeFileSync(join(fixture.root, "note.txt"), "text\n");
  mkdirSync(join(fixture.project, "nested", ".git"), { recursive: true });
  setup(dirs);
  const result = runGate(fixture, command(dirs), {}, fixture.project, fixture.project);
  return { fixture, result };
};

// The allowlist: the whole command is one git commit or push with a certain
// target. The gate audits only that target, and nothing when the target does
// not opt in to fallow.
for (const [name, command, expected] of [
  ["a plain commit audits the session directory", () => "git commit -m 'change'", ["project"]],
  ["a plain push audits the session directory", () => "git push", ["project"]],
  ["git -C with an absolute path audits only that directory", ({ o }) => `git -C ${o} commit -m x`, []],
  ["git -C push with arguments audits only that directory", ({ o }) => `git -C ${o} push origin HEAD`, []],
  ["a relative git -C path resolves from the session directory", () => "git -C ../optin commit -m x", ["optin"]],
  ["repeated git -C paths join", () => "git -C .. -C optin commit -m x", ["optin"]],
  ["git -C with an opted-in target audits it", ({ i }) => `git -C ${i} commit -m x`, ["optin"]],
  ["a quoted path with spaces is one target", ({ r }) => `git -C "${r}/my optin" commit -m 'a; b'`, ["my optin"]],
  ["a single-quoted message can hold shell text", ({ o }) => `git -C '${o}' commit -m 'a; b $(x)'`, []],
  ["a double-quoted message can span lines", ({ o }) => `git -C "${o}" commit -m "line one\n\nline two"`, []],
  ["cd && git commit audits only the cd directory", ({ o }) => `cd ${o} && git commit -m "fix: thing"`, []],
  ["cd && git push with arguments audits the cd directory", ({ i }) => `cd ${i} && git push -u origin feat/x:feat/x`, ["optin"]],
  ["inert commit options keep the target", ({ o }) => `git -C ${o} commit --amend --no-edit -S -q -a`, []],
  ["a tab can separate words", ({ o }) => `git -C ${o} commit -m x\tfile.txt`, []],
  ["a relative cd that starts with ./ keeps the target", () => "cd ./nested && git commit -m x", []],
]) {
  test(`allowlist: ${name}`, { skip }, () => {
    const { fixture, result } = runCase(command);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(auditedNames(fixture), expected);
  });
}

const LONG_PREFIX = `echo ${"x ".repeat(9000)}`;

// Every other form audits the session directory, plus each target that the
// loose scan finds and that opts in to fallow.
for (const [name, command, expected] of [
  ["a target that is not a directory", ({ o }) => `git -C ${o}/missing commit -m x`, ["project"]],
  ["a file as target", () => "git -C ../note.txt commit -m x", ["project"]],
  ["cd ; git push", ({ i }) => `cd ${i}; git push`, ["optin", "project"]],
  ["--work-tree and --git-dir", () => "git --work-tree=../optin --git-dir=../optin/.git commit -m x", ["optin", "project"]],
  ["--git-dir alone", () => "git --git-dir ../optin/.git push", ["optin", "project"]],
  ["a second write without a target", ({ i }) => `git -C ${i} commit -m x && git push`, ["optin", "project"]],
  ["a git -c option", ({ o }) => `git -c user.name=x -C ${o} commit -m x`, ["project"]],
  ["ANSI-C quoting", ({ o }) => `git -C ${o} commit -m $'a\\'; git push'`, ["project"]],
  ["escaped quotes inside double quotes", ({ o }) => `git -C ${o} commit -m "say \\"x\\"; git push"`, ["project"]],
  ["a line continuation", ({ o }) => `git -C ${o} \\\ncommit -m x`, ["project"]],
  ["a line continuation without a target", () => "git commit \\\n  -m x", ["project"]],
  ["bash -c", () => "bash -c 'git commit -m x'", ["project"]],
  ["sh -c with a cd inside", ({ o }) => `sh -c 'cd ${o}; git commit -m x'`, ["project"]],
  ["eval", () => 'eval "git commit -m x"', ["project"]],
  ["eval next to a targeted push", ({ o }) => `eval 'git commit -m x' && git -C ${o} push`, ["project"]],
  ["env git commit", () => "env git commit -m x", ["project"]],
  ["env git -C", ({ o }) => `env git -C ${o} commit -m x`, ["project"]],
  ["command git commit", () => "command git commit -m x", ["project"]],
  ["a command substitution as target", () => 'git -C "$(pwd)" commit -m x', ["project"]],
  ["a backtick substitution as target", () => 'git -C "`pwd`" commit -m x', ["project"]],
  ["a substitution after the message", ({ o }) => `git -C ${o} commit -m "a"$(id)`, ["project"]],
  ["a tilde target", () => "git -C ~/x commit -m x", ["project"]],
  ["a glob target", ({ o }) => `git -C ${o}* commit -m x`, ["project"]],
  ["cd && git -C", ({ o }) => `cd ${o} && git -C . commit -m x`, ["project"]],
  ["cd into a missing directory then &&", ({ o }) => `cd ${o}/missing && git commit -m x`, ["project"]],
  ["cd into a missing directory then ;", ({ o }) => `cd ${o}/missing; git commit -m x`, ["project"]],
  ["cd then ||", ({ o }) => `cd ${o} || git commit -m x`, ["project"]],
  ["cd then a pipe", ({ o }) => `cd ${o} | git commit -m x`, ["project"]],
  ["cd in the background", ({ o }) => `cd ${o} & git commit -m x`, ["project"]],
  ["a cd and a write in one subshell", ({ o }) => `( cd ${o} && git commit -m x )`, ["project"]],
  ["a cd in a closed subshell", ({ o }) => `( cd ${o} ) && git commit -m x`, ["project"]],
  ["a cd in a closed subshell before ;", ({ o }) => `(cd ${o}); git commit -m x`, ["project"]],
  ["a GIT_DIR prefix", ({ o }) => `GIT_DIR=.git git -C ${o} commit -m x`, ["project"]],
  ["a GIT_WORK_TREE prefix", ({ o }) => `GIT_WORK_TREE=. git -C ${o} commit -m x`, ["project"]],
  ["an exported GIT_DIR", ({ o }) => `export GIT_DIR=$PWD/.git; git -C ${o} commit -m x`, ["project"]],
  ["env with GIT_DIR", ({ o }) => `env GIT_DIR=.git git -C ${o} push`, ["project"]],
  ["--git-dir with an opted-out --work-tree", ({ o }) => `git --git-dir=.git --work-tree=${o} commit -m x`, ["project"]],
  ["quoted git text alone", () => 'echo "git commit"', ["project"]],
  ["quoted git text next to a real commit", () => 'echo "git commit" && git commit -m x', ["project"]],
  ["quoted git text next to a targeted push", ({ o }) => `echo "git commit" && git -C ${o} push`, ["project"]],
  ["quoted text with an operator", () => 'echo "x; git commit -m y"', ["project"]],
  ["cd - before a later push", ({ o }) => `cd ${o} && git commit -m x && cd - && git push`, ["project"]],
  ["pushd", ({ o }) => `cd ${o} && pushd /tmp && git push`, ["project"]],
  ["a cd in a here-document body", ({ o }) => `cat <<EOF\ncd ${o}\nEOF\ngit commit -m x`, ["project"]],
  ["a here-document commit message", ({ o }) => `git -C ${o} commit -F - <<'EOF'\nfix: x; it's (fine)\nEOF`, ["project"]],
  ["a here-document in a command substitution", ({ o }) => `git -C ${o} commit -m "$(cat <<'EOF'\nfix: thing\n\nbody\nEOF\n)"`, ["project"]],
  ["redirections after cd", ({ o }) => `cd ${o} >/dev/null 2>&1 && git commit -m x`, ["project"]],
  ["a pipe after the write", ({ o }) => `git -C ${o} commit -m x 2>&1 | tail -3`, ["project"]],
  ["a backslash inside git", () => "g\\it push", ["project"]],
  ["a very long command", ({ o }) => `${LONG_PREFIX} && git -C ${o} commit -m x`, ["project"]],
  ["a substitution inside a double-quoted message", ({ o }) => `git -C ${o} commit -m "$(cd .. && git push)"`, ["project"]],
  ["a backtick inside a double-quoted message", ({ o }) => `git -C ${o} commit -m "\`git push\`"`, ["project"]],
  ["a substitution in --message=", ({ o }) => `git -C ${o} commit --message="$(git push)"`, ["project"]],
  ["git -c core.hooksPath before -C", ({ o }) => `git -c core.hooksPath=/tmp -C ${o} commit -m x`, ["project"]],
  ["git -c core.hooksPath after -C", ({ o }) => `git -C ${o} -c core.hooksPath=/tmp commit -m x`, ["project"]],
  ["commit -F", ({ o }) => `git -C ${o} commit -F /etc/hosts`, ["project"]],
  ["commit --template", ({ o }) => `git -C ${o} commit --template=/tmp/t -m x`, ["project"]],
  ["an attached -m value", ({ o }) => `git -C ${o} commit -mx`, ["project"]],
  ["push --exec", ({ o }) => `git -C ${o} push --exec=/tmp/x origin`, ["project"]],
  ["push --receive-pack", ({ o }) => `git -C ${o} push --receive-pack=/tmp/x origin`, ["project"]],
  ["a push option", ({ o }) => `git -C ${o} push -o ci.skip origin`, ["project"]],
  ["push --force-with-lease", ({ o }) => `git -C ${o} push --force-with-lease origin HEAD`, ["project"]],
  ["a -- separator", ({ o }) => `git -C ${o} commit -m x -- file`, ["project"]],
  ["a carriage return before another command", ({ o }) => `git -C ${o} commit -m x\r; git push`, ["project"]],
  ["a no-break space before another command", ({ o }) => `git -C ${o} commit -m x\u00a0; git push`, ["project"]],
  ["a caret in a word", ({ o }) => `git -C ${o} commit -m x HEAD^`, ["project"]],
  ["a brace expansion", ({ o }) => `git -C ${o} commit -m x {a,b}`, ["project"]],
  ["a comment sign", ({ o }) => `git -C ${o} commit -m x #; git push`, ["project"]],
  ["a redirection", ({ o }) => `git -C ${o} commit -m x >/dev/null`, ["project"]],
  ["a target outside a git work tree", ({ r }) => `git -C ${r} commit -m x`, ["project"]],
  ["a target inside a .git directory", ({ o }) => `git -C ${o}/.git commit -m x`, ["project"]],
  ["a relative cd that CDPATH can move", () => "cd nested && git commit -m x", ["project"]],
  ["a backslash before git", ({ o }) => `\\git -C ${o} commit -m x; git push`, ["project"]],
]) {
  test(`session audit: ${name}`, { skip }, () => {
    const { fixture, result } = runCase(command);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(auditedNames(fixture), expected);
  });
}

// A gate that `fallow agent install` registered runs from the session
// directory and audits only the session tree. The plugin defers to it only
// for that tree, and still audits every other target.
for (const [name, setup, command, expected] of [
  ["a session gate leaves an allowlisted target to the plugin", ({ p }) => registerInstalledGate(p, { withScript: true }), ({ i }) => `git -C ${i} commit -m x`, ["optin"]],
  ["a session gate covers the session but not the target", ({ p }) => registerInstalledGate(p, { withScript: true }), ({ i }) => `git -C ${i} commit -m x && git push`, ["optin"]],
  ["a user-level gate covers the session but not the target", ({ h }) => registerInstalledGate(h, { withScript: true }), ({ i }) => `git -C ${i} commit -m x && git push`, ["optin"]],
  ["a session gate covers a target inside the session tree", ({ p }) => { mkdirSync(join(p, "sub")); registerInstalledGate(p, { withScript: true }); }, ({ p }) => `git -C ${p}/sub commit -m x`, []],
  ["a gate registered only in the target does not run, so the plugin audits the target", ({ i }) => registerInstalledGate(i, { withScript: true }), ({ i }) => `git -C ${i} commit -m x`, ["optin"]],
  ["without any registered gate the plugin audits the target and the session", () => {}, ({ i }) => `git -C ${i} commit -m x && git push`, ["optin", "project"]],
]) {
  test(`deferral: ${name}`, { skip }, () => {
    const { fixture, result } = runCase(command, "pass", setup);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(auditedNames(fixture), expected);
  });
}

test("a fail verdict in the session blocks a command outside the allowlist", { skip }, () => {
  const { fixture, result } = runCase(({ o }) => `git -C ${o} commit -m x && git push`, "fail");
  assert.equal(result.status, 2);
  assert.match(result.stderr, /blocked by fallow 9\.9\.9/);
  assert.deepEqual(auditedNames(fixture), ["project"]);
});

test("an allowlisted target without fallow skips the gate", { skip }, () => {
  const { fixture, result } = runCase(({ o }) => `git -C ${o} commit -m x`, "fail");
  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
  assert.deepEqual(auditCalls(fixture), []);
});

test("an opted-in target blocks on a fail verdict from an unopted session", { skip }, () => {
  const fixture = makeCase({ fallowJson: { verdict: "fail" }, fallowExit: 1, optIn: false });
  const other = makeRepo(fixture, "other", { optIn: true });
  const result = runGate(fixture, `cd '${other}' && git commit -m x`, {}, fixture.project, fixture.project);
  assert.equal(result.status, 2);
  assert.equal(auditCalls(fixture).length, 1);
});

test("a fail verdict in any audited root blocks", { skip }, () => {
  const fixture = makeCase({ fallowJson: { verdict: "fail" }, fallowExit: 1, optIn: false });
  const optout = makeRepo(fixture, "optout", { optIn: false });
  const optin = makeRepo(fixture, "optin", { optIn: true });
  const result = runGate(fixture, `git -C ${optout} commit -m x && git -C ${optin} push`, {}, fixture.project, fixture.project);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /blocked by fallow 9\.9\.9/);
  assert.deepEqual(auditedNames(fixture), ["optin"]);
});

test("a package.json script named fallow does not opt the project in", { skip }, () => {
  const fixture = makeCase({ fallowJson: { verdict: "fail" }, fallowExit: 1, optIn: false });
  writeFileSync(join(fixture.project, "package.json"), JSON.stringify({ scripts: { fallow: "fallow audit" } }));
  const result = runGate(fixture, "git commit -m 'change'");
  assert.equal(result.status, 0);
  assert.deepEqual(auditCalls(fixture), []);
});

test("a Codex gate registered by fallow agent install takes precedence", { skip }, () => {
  const fixture = makeCase({ fallowJson: { verdict: "fail" }, fallowExit: 1 });
  mkdirSync(join(fixture.project, ".codex", "hooks"), { recursive: true });
  writeFileSync(
    join(fixture.project, ".codex", "hooks.json"),
    JSON.stringify({ hooks: { PreToolUse: [{ matcher: "^Bash$", hooks: [{ type: "command", command: "./.codex/hooks/fallow-gate.sh" }] }] } }),
  );
  writeFileSync(join(fixture.project, ".codex", "hooks", "fallow-gate.sh"), "#!/usr/bin/env bash\n");
  const result = runGate(fixture, "git commit -m 'change'");
  assert.equal(result.status, 0);
  assert.deepEqual(auditCalls(fixture), []);
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
