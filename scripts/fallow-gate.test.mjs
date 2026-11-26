import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
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
const HOST_TOOLS = ["bash", "jq", "cat", "tr", "sed", "sort", "head", "mktemp", "rm", "grep", "dirname", "awk", "git", "readlink"];

const scratch = realpathSync(mkdtempSync(join(tmpdir(), "fallow-gate-test-")));
after(() => rmSync(scratch, { recursive: true, force: true }));

const resolveTool = (name) => {
  const result = spawnSync("bash", ["-c", `command -v ${name}`], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : null;
};

const missingTools = HOST_TOOLS.filter((name) => resolveTool(name) === null);
const skip = missingTools.length > 0 ? `missing host tools: ${missingTools.join(", ")}` : false;

let caseCounter = 0;

// Creates a real git repository, so git rev-parse in the gate sees it.
const gitInit = (dir) => {
  mkdirSync(dir, { recursive: true });
  const result = spawnSync("git", ["init", "-q", dir], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return dir;
};

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
  gitInit(project);
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

const runGate = (fixture, command, extraEnv = {}, cwd = fixture.project, inputCwd = undefined, gatePath = gate) =>
  spawnSync(join(fixture.bin, "bash"), [gatePath], {
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
  assert.match(group.hooks[0].command, /\/bin\/bash "\$\{CLAUDE_PLUGIN_ROOT\}\/hooks\/fallow-gate\.sh"/);
});

test("hooks.json has only the hooks key, because Codex refuses any other key", () => {
  // Codex reads this file too. Codex 0.164.0 refuses an unknown key such as `modules` and then
  // loads no hook of the plugin, the commit gate included.
  const config = JSON.parse(readFileSync(hooksConfig, "utf8"));
  assert.deepEqual(Object.keys(config), ["hooks"]);
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
  assert.match(result.stderr, /npm install -g fallow or cargo install fallow-cli/);
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
  const dir = gitInit(join(fixture.root, name));
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

const runCase = (command, verdict = "pass", setup = () => {}, gatePath = gate) => {
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
  gitInit(join(fixture.project, "nested"));
  // An empty .git directory is not a repository, so git uses the session one.
  mkdirSync(join(fixture.project, "emptygit", ".git"), { recursive: true });
  setup(dirs);
  const result = runGate(fixture, command(dirs), {}, fixture.project, fixture.project, gatePath);
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
  ["a relative cd into a nested repository keeps the target", () => "cd ./nested && git commit -m x", []],
  ["a relative git -C into a nested repository keeps the target", () => "git -C nested commit -m x", []],
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
const SESSION_CASES = [
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
  ["push --force-with-lease=<ref>", ({ o }) => `git -C ${o} push --force-with-lease=main origin HEAD`, ["project"]],
  ["push --force-with-lease in a commit", ({ o }) => `git -C ${o} commit --force-with-lease -m x`, ["project"]],
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
  ["an option after a message read as a message", ({ o }) => `git -C ${o} commit -m -m --no-verify`, ["project"]],
  ["a git -C into an empty .git directory", () => "git -C emptygit commit -m x", ["project"]],
  ["a cd into an empty .git directory", () => "cd ./emptygit && git commit -m x", ["project"]],
  ["git in upper case", () => "GIT commit -m x", ["project"]],
  ["git in mixed case before push", () => "Git push", ["project"]],
  ["git named by an absolute path", () => "/usr/bin/git commit -m x", ["project"]],
  ["git named by a relative path", () => "./bin/git push", ["project"]],
  ["git with the .exe suffix", () => "git.exe commit -m x", ["project"]],
  ["git with the .exe suffix in upper case", () => "GIT.EXE push", ["project"]],
  ["a brace that lists the subcommand", () => "git {commit,status} -m x", ["project"]],
  ["a brace inside the subcommand", () => "git c{o,}mmit -m x", ["project"]],
  ["a glob in the subcommand", () => "git c?mmit -m x", ["project"]],
  ["a bracket glob in the subcommand", () => "git p[u]sh", ["project"]],
  ["a variable in the subcommand", () => "git co${x}mmit -m x", ["project"]],
  ["a variable as the program", () => "G=git; $G commit -m x", ["project"]],
  ["a glob as the program", () => "g?t push", ["project"]],
  ["a backtick as the program", () => "`echo git` commit -m x", ["project"]],
];
for (const [name, command, expected] of SESSION_CASES) {
  test(`session audit: ${name}`, { skip }, () => {
    const { fixture, result } = runCase(command);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(auditedNames(fixture), expected);
  });
}

// Cases where git picks a different repository than a path walk would.
// Each builder returns the fixture, the session directory and the command.
const BLOCKER_CASES = [
  [
    "a target above the opted-in session package audits the session",
    (gatePath) => {
      const fixture = makeCase({ fallowJson: { verdict: "pass" }, optIn: false });
      const mono = gitInit(join(fixture.root, "mono"));
      const app = join(mono, "packages", "app");
      mkdirSync(app, { recursive: true });
      writeFileSync(join(app, ".fallowrc.json"), "{}\n");
      return { fixture, cwd: app, command: "git -C ../.. commit -m x", gatePath };
    },
    ["mono/packages/app"],
  ],
  [
    "a cd to the top above the opted-in session package audits the session",
    (gatePath) => {
      const fixture = makeCase({ fallowJson: { verdict: "pass" }, optIn: false });
      const mono = gitInit(join(fixture.root, "mono"));
      const app = join(mono, "packages", "app");
      mkdirSync(app, { recursive: true });
      writeFileSync(join(app, ".fallowrc.json"), "{}\n");
      return { fixture, cwd: app, command: `cd ${mono} && git push`, gatePath };
    },
    ["mono/packages/app"],
  ],
  [
    "a gitfile that points at the session repository audits the session",
    (gatePath) => {
      const fixture = makeCase({ fallowJson: { verdict: "pass" } });
      const linked = join(fixture.project, "linked");
      mkdirSync(linked);
      writeFileSync(join(linked, ".git"), `gitdir: ${join(fixture.project, ".git")}\n`);
      return { fixture, cwd: fixture.project, command: "git -C linked commit -m x", gatePath };
    },
    ["project"],
  ],
  [
    "git -C resolves .. physically from a symlinked session directory",
    (gatePath) => {
      const fixture = makeCase({ fallowJson: { verdict: "pass" } });
      const holder = join(fixture.root, "l");
      gitInit(join(holder, "project"));
      symlinkSync(fixture.project, join(holder, "link"));
      return { fixture, cwd: join(holder, "link"), command: "git -C ../project commit -m x", gatePath };
    },
    ["project"],
  ],
];

// Runs git on the host, outside the gate.
const hostGit = (args) => {
  const result = spawnSync(
    "git",
    ["-c", "user.name=test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", ...args],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
};

// Adds a linked worktree B of the session repository on branch feat-b. The
// commit holds the fallow config, so B opts in to fallow too. Linked
// worktrees share the refs of the session repository, which this check
// confirms with git. `branch` is the session branch.
const addLinkedWorktree = (fixture) => {
  hostGit(["-C", fixture.project, "add", ".fallowrc.json"]);
  hostGit(["-C", fixture.project, "commit", "-q", "-m", "init"]);
  const linked = join(fixture.root, "B");
  hostGit(["-C", fixture.project, "worktree", "add", "-q", "-b", "feat-b", linked]);
  const common = (dir) => realpathSync(hostGit(["-C", dir, "rev-parse", "--path-format=absolute", "--git-common-dir"]));
  assert.equal(common(linked), common(fixture.project));
  assert.ok(existsSync(join(linked, ".fallowrc.json")));
  return {
    linked,
    branch: hostGit(["-C", fixture.project, "branch", "--show-current"]),
    linkedBranch: "feat-b",
    sha: hostGit(["-C", fixture.project, "rev-parse", "HEAD"]),
  };
};

BLOCKER_CASES.push(
  [
    "a push from a linked worktree of the session repository audits the session",
    (gatePath) => {
      const fixture = makeCase({ fallowJson: { verdict: "pass" } });
      const { branch } = addLinkedWorktree(fixture);
      return { fixture, cwd: fixture.project, command: `git -C ../B push origin ${branch}`, gatePath };
    },
    ["B", "project"],
  ],
  [
    "push --tags from a linked worktree of the session repository audits the session",
    (gatePath) => {
      const fixture = makeCase({ fallowJson: { verdict: "pass" } });
      addLinkedWorktree(fixture);
      return { fixture, cwd: fixture.project, command: "git -C ../B push --tags", gatePath };
    },
    ["B", "project"],
  ],
);

// A git that fails for the calls that contain $1, and runs the host git for
// every other call.
const failingGit = (pattern) => ({ fixture }) => {
  const wrapper = join(fixture.bin, "git");
  rmSync(wrapper);
  writeFileSync(wrapper, `#!/bin/sh\ncase " $* " in *"${pattern}"*) exit 128 ;; esac\nexec '${resolveTool("git")}' "$@"\n`);
  chmodSync(wrapper, 0o755);
};

// Builds a push from the linked worktree B, with untracked build output in
// the session tree. `setup` gets the fixture and the worktree facts.
const linkedPush = (command, setup = () => {}) => (gatePath) => {
  const fixture = makeCase({ fallowJson: { verdict: "pass" } });
  const facts = addLinkedWorktree(fixture);
  writeFileSync(join(fixture.project, "build-output.js"), "export const x = 1;\n");
  setup({ fixture, ...facts });
  return { fixture, cwd: fixture.project, command: command(facts), gatePath };
};
const setConfig = (key, value) => ({ fixture }) => hostGit(["-C", fixture.project, "config", key, value]);

// Reviewed cases where this gate audits less than the main gate did before
// the change. Each one has its own exact expectation, and the comparison with
// main skips them. After the merge, main audits the same trees, so a case can
// stay here as a regression test.
const NARROWED_CASES = [
  [
    "push --force-with-lease to another repository audits only that repository",
    (gatePath) => {
      const fixture = makeCase({ fallowJson: { verdict: "pass" } });
      const o = makeRepo(fixture, "optout", { optIn: false });
      return { fixture, cwd: fixture.project, command: `git -C ${o} push --force-with-lease origin HEAD`, gatePath };
    },
    [],
  ],
  ["linked push of the worktree branch", linkedPush(({ linkedBranch }) => `git -C ../B push origin ${linkedBranch}`), ["B"]],
  ["linked push -u of the worktree branch", linkedPush(({ linkedBranch }) => `git -C ../B push -u origin ${linkedBranch}`), ["B"]],
  ["linked push --set-upstream -q", linkedPush(({ linkedBranch }) => `git -C ../B push --set-upstream -q origin ${linkedBranch}`), ["B"]],
  ["linked push of HEAD", linkedPush(() => "git -C ../B push origin HEAD"), ["B"]],
  ["linked push of HEAD to the worktree branch", linkedPush(({ linkedBranch }) => `git -C ../B push origin HEAD:refs/heads/${linkedBranch}`), ["B"]],
  ["linked push --force-with-lease", linkedPush(({ linkedBranch }) => `git -C ../B push --force-with-lease origin ${linkedBranch}`), ["B"]],
  ["linked push --force-with-lease --force-if-includes", linkedPush(({ linkedBranch }) => `git -C ../B push --force-with-lease --force-if-includes origin +${linkedBranch}`), ["B"]],
  ["linked push without a refspec and push.default simple", linkedPush(() => "git -C ../B push", setConfig("push.default", "simple")), ["B"]],
  ["linked push without a refspec and push.default unset", linkedPush(() => "git -C ../B push origin"), ["B"]],
  ["linked push through cd", linkedPush(({ linkedBranch }) => `cd ../B && git push origin ${linkedBranch}`), ["B"]],
  ["linked push through a git wrapper that passes every call", linkedPush(({ linkedBranch }) => `git -C ../B push origin ${linkedBranch}`, failingGit("no-such-word")), ["B"]],
];

// A push from the linked worktree B that can send the session branch, or
// that the gate cannot prove safe, still audits the session.
const LINKED_SESSION_CASES = [
  ["the session branch by name", linkedPush(({ branch }) => `git -C ../B push origin ${branch}`)],
  ["the session branch as a full ref", linkedPush(({ branch }) => `git -C ../B push origin refs/heads/${branch}`)],
  ["the session branch with +", linkedPush(({ branch }) => `git -C ../B push origin +${branch}`)],
  ["the session branch to another name", linkedPush(({ branch }) => `git -C ../B push origin ${branch}:x`)],
  ["HEAD and the session branch", linkedPush(({ branch }) => `git -C ../B push origin HEAD ${branch}`)],
  ["the session commit", linkedPush(({ sha }) => `git -C ../B push origin ${sha}:refs/heads/x`)],
  ["an empty source", linkedPush(() => "git -C ../B push origin :x")],
  ["a source that reads as an option", linkedPush(() => "git -C ../B push origin +--all")],
  ["push.default matching without a refspec", linkedPush(() => "git -C ../B push", setConfig("push.default", "matching"))],
  ["a remote push setting without a refspec", linkedPush(() => "git -C ../B push origin", setConfig("remote.origin.push", "refs/heads/*:refs/heads/*"))],
  ["a remote mirror setting without a refspec", linkedPush(() => "git -C ../B push", setConfig("remote.origin.mirror", "true"))],
  ["push --all", linkedPush(() => "git -C ../B push --all origin")],
  ["push --mirror", linkedPush(() => "git -C ../B push --mirror origin")],
  ["push --tags", linkedPush(() => "git -C ../B push --tags origin")],
  ["push --force-with-lease=<ref>", linkedPush(({ linkedBranch }) => `git -C ../B push --force-with-lease=x origin ${linkedBranch}`)],
  ["a commit option in a push", linkedPush(({ linkedBranch }) => `git -C ../B push -a origin ${linkedBranch}`)],
  ["cd and the session branch", linkedPush(({ branch }) => `cd ../B && git push origin ${branch}`)],
  ["a git that fails for symbolic-ref", linkedPush(({ linkedBranch }) => `git -C ../B push origin ${linkedBranch}`, failingGit(" symbolic-ref "))],
  ["a git that fails for --symbolic-full-name", linkedPush(({ linkedBranch }) => `git -C ../B push origin ${linkedBranch}`, failingGit(" --symbolic-full-name "))],
  ["a git that fails for config", linkedPush(() => "git -C ../B push", failingGit(" config "))],
  ["a git that fails for config --get-regexp", linkedPush(() => "git -C ../B push", failingGit(" --get-regexp "))],
];
for (const [name, build] of LINKED_SESSION_CASES) {
  BLOCKER_CASES.push([`a linked push audits the session: ${name}`, build, ["B", "project"]]);
}

test("a commit in a linked worktree audits only that worktree", { skip }, () => {
  const fixture = makeCase({ fallowJson: { verdict: "pass" } });
  addLinkedWorktree(fixture);
  const result = runGate(fixture, "git -C ../B commit -m x", {}, fixture.project, fixture.project);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(auditedNames(fixture), ["B"]);
});

const runBlocker = (build, gatePath = gate) => {
  const { fixture, cwd, command } = build(gatePath);
  const result = runGate(fixture, command, {}, cwd, cwd, gatePath);
  return { fixture, result };
};

for (const [name, build, expected] of BLOCKER_CASES) {
  test(`git location: ${name}`, { skip }, () => {
    const { fixture, result } = runBlocker(build);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(auditedNames(fixture), expected);
  });
}

for (const [name, build, expected] of NARROWED_CASES) {
  test(`narrowed: ${name}`, { skip }, () => {
    const { fixture, result } = runBlocker(build);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(auditedNames(fixture), expected);
  });
}


// A very long command must stay well inside the hook timeout, also on the
// bash 3.2 that macOS ships.
const BASH_BINARIES = [...new Set([resolveTool("bash"), existsSync("/bin/bash") ? "/bin/bash" : null].filter(Boolean))];
for (const bash of BASH_BINARIES) {
  test(`a command with 100k words takes less than 5 seconds (${bash})`, { skip }, () => {
    const fixture = makeCase({ fallowJson: { verdict: "pass" } });
    rmSync(join(fixture.bin, "bash"));
    symlinkSync(bash, join(fixture.bin, "bash"));
    const paths = Array.from({ length: 100000 }, (_, i) => `"src/file${i}.ts"`).join(" ");
    const started = process.hrtime.bigint();
    const result = runGate(fixture, `git add ${paths} && git commit -m "x"`);
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(auditedNames(fixture), ["project"]);
    // The hook timeout is far longer. The limit leaves room for a busy runner.
    assert.ok(elapsedMs < 5000, `took ${Math.round(elapsedMs)} ms`);
  });
}

// The gate must never audit fewer trees than the gate on main, except for the
// reviewed NARROWED_CASES. The main gate comes from origin/main (or main).
const repoRoot = join(pluginRoot, "..");
const mainGateSource = ["origin/main", "main"]
  .map((ref) => spawnSync("git", ["show", `${ref}:fallow/hooks/fallow-gate.sh`], { cwd: repoRoot, encoding: "utf8" }))
  .find((result) => result.status === 0)?.stdout;
const mainGate = join(scratch, "main-gate.sh");
if (mainGateSource) writeFileSync(mainGate, mainGateSource);
// In CI the main branch must be available, so the test fails instead of
// skipping. A local checkout without main skips it.
const differentialSkip = skip || (mainGateSource || process.env.CI ? false : "the main branch is not available");

test("the gate audits at least every tree that the main gate audits", { skip: differentialSkip }, () => {
  assert.ok(mainGateSource, "git show origin/main:fallow/hooks/fallow-gate.sh failed");
  const narrowed = new Set(NARROWED_CASES.map(([name]) => name));
  const missing = [];
  for (const [name, command] of SESSION_CASES) {
    if (narrowed.has(name)) continue;
    const before = auditedNames(runCase(command, "pass", () => {}, mainGate).fixture);
    const after = auditedNames(runCase(command, "pass", () => {}, gate).fixture);
    const lost = before.filter((dir) => !after.includes(dir));
    if (lost.length > 0) missing.push(`${name}: ${lost.join(", ")}`);
  }
  for (const [name, build] of BLOCKER_CASES) {
    if (narrowed.has(name)) continue;
    const before = auditedNames(runBlocker(build, mainGate).fixture);
    const after = auditedNames(runBlocker(build, gate).fixture);
    const lost = before.filter((dir) => !after.includes(dir));
    if (lost.length > 0) missing.push(`${name}: ${lost.join(", ")}`);
  }
  assert.deepEqual(missing, []);
});

// The loose scan runs in awk. When awk is missing, fails or returns no result
// line, the gate must still count the command as a write.
for (const [name, awkScript] of [
  ["fails", "#!/bin/sh\nexit 2\n"],
  ["prints nothing", "#!/bin/sh\ncat >/dev/null\nexit 0\n"],
]) {
  test(`an awk that ${name} still audits the session`, { skip }, () => {
    const fixture = makeCase({ fallowJson: { verdict: "pass" } });
    rmSync(join(fixture.bin, "awk"));
    writeFileSync(join(fixture.bin, "awk"), awkScript);
    chmodSync(join(fixture.bin, "awk"), 0o755);
    const result = runGate(fixture, "git add . && git commit -m x");
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(auditedNames(fixture), ["project"]);
  });
}

test("a missing awk still audits the session", { skip }, () => {
  const fixture = makeCase({ fallowJson: { verdict: "pass" }, tools: HOST_TOOLS.filter((name) => name !== "awk") });
  const result = runGate(fixture, "git add . && git commit -m x");
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(auditedNames(fixture), ["project"]);
});

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

// Writes a fake fallow at `dir/fallow` that logs its calls with the given
// label and returns the given verdict.
const writeFakeFallow = (fixture, dir, label, verdict) => {
  mkdirSync(dir, { recursive: true });
  const fake = join(dir, "fallow");
  writeFileSync(
    fake,
    [
      "#!/usr/bin/env bash",
      `echo "${label} $* @ $PWD" >> '${fixture.calls}'`,
      'if [ "${1:-}" = "--version" ]; then echo "fallow 9.9.8"; exit 0; fi',
      `echo '${JSON.stringify({ verdict })}'`,
      `exit ${verdict === "fail" ? 1 : 0}`,
      "",
    ].join("\n"),
  );
  chmodSync(fake, 0o755);
  return fake;
};

const allCalls = (fixture) =>
  existsSync(fixture.calls) ? readFileSync(fixture.calls, "utf8").split("\n").filter(Boolean) : [];

// The plugin is installed for the user, so the gate runs only a fallow that
// the user installed: an absolute PATH entry outside node_modules and outside
// the session tree.
test("a project-local launcher does not run, and the fallow on PATH audits", { skip }, () => {
  const fixture = makeCase({ fallowJson: { verdict: "pass" } });
  writeFakeFallow(fixture, join(fixture.project, "node_modules", ".bin"), "local", "fail");
  const result = runGate(fixture, "git commit -m 'change'");
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(allCalls(fixture).filter((line) => line.startsWith("local")), []);
  assert.equal(auditCalls(fixture).length, 1);
});

test("a project-local launcher without a fallow on PATH gives the install notice", { skip }, () => {
  const fixture = makeCase();
  writeFakeFallow(fixture, join(fixture.project, "node_modules", ".bin"), "local", "fail");
  const result = runGate(fixture, "git commit -m 'change'");
  assert.equal(result.status, 0);
  assert.deepEqual(allCalls(fixture), []);
  assert.match(result.stderr, /fallow binary is not installed/);
  assert.match(result.stderr, /npm install -g fallow/);
});

for (const [name, entry] of [
  ["a relative PATH entry", "tools"],
  ["an empty PATH entry", ""],
]) {
  test(`a fallow in ${name} does not run`, { skip }, () => {
    const fixture = makeCase();
    writeFakeFallow(fixture, entry === "" ? fixture.project : join(fixture.project, entry), "relative", "fail");
    const result = runGate(fixture, "git commit -m 'change'", { PATH: `${entry}:${fixture.bin}` });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(allCalls(fixture), []);
    assert.match(result.stderr, /fallow binary is not installed/);
  });
}

test("a fallow in an absolute node_modules PATH entry does not run", { skip }, () => {
  const fixture = makeCase();
  const dir = join(fixture.root, "elsewhere", "node_modules", ".bin");
  writeFakeFallow(fixture, dir, "modules", "fail");
  const result = runGate(fixture, "git commit -m 'change'", { PATH: `${dir}:${fixture.bin}` });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(allCalls(fixture), []);
});

test("a fallow in a PATH entry that links into node_modules does not run", { skip }, () => {
  const fixture = makeCase();
  const dir = join(fixture.root, "elsewhere", "node_modules", ".bin");
  writeFakeFallow(fixture, dir, "modules", "fail");
  const link = join(fixture.root, "linked-bin");
  symlinkSync(dir, link);
  const result = runGate(fixture, "git commit -m 'change'", { PATH: `${link}:${fixture.bin}` });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(allCalls(fixture), []);
});

test("a fallow in an absolute PATH entry inside the session tree does not run", { skip }, () => {
  const fixture = makeCase({ fallowJson: { verdict: "pass" } });
  const dir = join(fixture.project, "tools", "bin");
  writeFakeFallow(fixture, dir, "session", "fail");
  const sub = join(fixture.project, "packages", "app");
  mkdirSync(sub, { recursive: true });
  const result = runGate(fixture, "git commit -m 'change'", { PATH: `${dir}:${fixture.bin}` }, sub, sub);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(allCalls(fixture).filter((line) => line.startsWith("session")), []);
  assert.equal(auditCalls(fixture).length, 1);
});

test("a fallow in a PATH entry inside the session directory outside git does not run", { skip }, () => {
  const fixture = makeCase();
  const plain = join(fixture.root, "plain");
  mkdirSync(plain, { recursive: true });
  writeFileSync(join(plain, ".fallowrc.json"), "{}\n");
  const dir = join(plain, "bin");
  writeFakeFallow(fixture, dir, "session", "fail");
  const result = runGate(fixture, "git commit -m 'change'", { PATH: `${dir}:${fixture.bin}` }, plain, plain);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(allCalls(fixture), []);
});

test("a trusted absolute fallow runs after a skipped PATH entry", { skip }, () => {
  const fixture = makeCase({ fallowJson: { verdict: "fail", summary: {} }, fallowExit: 1 });
  writeFakeFallow(fixture, join(fixture.project, "tools"), "relative", "pass");
  const result = runGate(fixture, "git commit -m 'change'", { PATH: `tools:${fixture.bin}` });
  assert.equal(result.status, 2);
  assert.ok(result.stderr.includes(`blocked by fallow 9.9.9 at ${join(fixture.bin, "fallow")} in `), result.stderr);
  assert.deepEqual(allCalls(fixture).filter((line) => line.startsWith("relative")), []);
});

test("a fallow on PATH runs when the project has no local install", { skip }, () => {
  const fixture = makeCase({ fallowJson: { verdict: "fail", summary: {} }, fallowExit: 1 });
  const result = runGate(fixture, "git commit -m 'change'");
  assert.equal(result.status, 2);
  assert.ok(result.stderr.includes(`blocked by fallow 9.9.9 at ${join(fixture.bin, "fallow")} in `), result.stderr);
  assert.equal(auditCalls(fixture).length, 1);
});

// An expansion, a brace or a glob without a `commit` or `push` word, and a
// git subcommand without one, is not a git write.
for (const command of ["echo $HOME", "ls *.ts", "ls src/[ab]*.ts && echo ${HOME}", "git add src/*.ts", "echo `pwd`", "cat {a,b}.txt"]) {
  test(`an expansion without a write word starts no fallow: ${command}`, { skip }, () => {
    const fixture = makeCase({ fallowJson: { verdict: "fail" } });
    const result = runGate(fixture, command);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.deepEqual(allCalls(fixture), []);
  });
}

test("a command that is not a git commit or push starts no fallow", { skip }, () => {
  const fixture = makeCase({ fallowJson: { verdict: "fail" } });
  const result = runGate(fixture, "git status && git log commit-message.txt");
  assert.equal(result.status, 0);
  assert.deepEqual(allCalls(fixture), []);
});

// Writes helper programs with the names of the tools that the gate calls.
// Each one logs its name and exits 0, so a test sees every call.
const addHelpers = (fixture, dir) => {
  mkdirSync(dir, { recursive: true });
  const log = join(fixture.root, "helper-calls.log");
  for (const name of ["jq", "git", "cat", "sed", "awk", "tr", "grep", "mktemp", "sort", "dirname", "head", "rm"]) {
    writeFileSync(join(dir, name), `#!/bin/sh\necho "${name} ${dir}" >> '${log}'\nexit 0\n`);
    chmodSync(join(dir, name), 0o755);
  }
  return log;
};

test("helpers in relative, node_modules and session-tree PATH entries do not run", { skip }, () => {
  const fixture = makeCase({ fallowJson: { verdict: "pass" } });
  const log = addHelpers(fixture, join(fixture.project, "node_modules", ".bin"));
  addHelpers(fixture, join(fixture.project, "tools"));
  const path = ["node_modules/.bin", "tools", "", join(fixture.project, "node_modules", ".bin"), join(fixture.project, "tools"), fixture.bin].join(":");
  const result = runGate(fixture, "git commit -m 'change'", { PATH: path });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(log) ? readFileSync(log, "utf8") : "", "");
  assert.equal(auditCalls(fixture).length, 1);
});

test("a PATH entry that reaches the session tree through a link and .. does not run", { skip }, () => {
  const fixture = makeCase();
  mkdirSync(join(fixture.project, "sub"));
  writeFakeFallow(fixture, fixture.project, "session", "fail");
  mkdirSync(join(fixture.root, "out"));
  symlinkSync(join(fixture.project, "sub"), join(fixture.root, "out", "link"));
  const result = runGate(fixture, "git commit -m 'change'", { PATH: `${join(fixture.root, "out", "link")}/..:${fixture.bin}` });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(allCalls(fixture), []);
  assert.match(result.stderr, /fallow binary is not installed/);
});

test("a node_modules component in another letter case does not run", { skip }, () => {
  const fixture = makeCase();
  const dir = join(fixture.root, "elsewhere", "Node_Modules", ".bin");
  writeFakeFallow(fixture, dir, "modules", "fail");
  const result = runGate(fixture, "git commit -m 'change'", { PATH: `${dir}:${fixture.bin}` });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(allCalls(fixture), []);
});

test("a session-tree PATH entry in another letter case does not run", { skip: skip || (process.platform === "darwin" ? false : "case-insensitive file system only") }, () => {
  const fixture = makeCase();
  writeFakeFallow(fixture, join(fixture.project, "bin"), "session", "fail");
  const upper = join(fixture.root, "PROJECT", "BIN");
  const result = runGate(fixture, "git commit -m 'change'", { PATH: `${upper}:${fixture.bin}` });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(allCalls(fixture), []);
});

test("without a git answer the session tree is the nearest directory with .git", { skip }, () => {
  const fixture = makeCase({ optIn: false });
  const top = join(fixture.root, "broken");
  const app = join(top, "packages", "app");
  mkdirSync(app, { recursive: true });
  writeFileSync(join(top, ".git"), "gitdir: nowhere\n");
  writeFileSync(join(app, ".fallowrc.json"), "{}\n");
  const dir = join(top, "bin");
  writeFakeFallow(fixture, dir, "session", "fail");
  const result = runGate(fixture, "git commit -m 'change'", { PATH: `${dir}:${fixture.bin}` }, app, app);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(allCalls(fixture), []);
});

test("a PATH entry in the session top does not run for an opt-in in a subdirectory", { skip }, () => {
  const fixture = makeCase({ fallowJson: { verdict: "pass" }, optIn: false });
  const app = join(fixture.project, "packages", "app");
  mkdirSync(app, { recursive: true });
  writeFileSync(join(app, ".fallowrc.json"), "{}\n");
  const dir = join(fixture.project, "bin");
  writeFakeFallow(fixture, dir, "session", "fail");
  const result = runGate(fixture, "git commit -m 'change'", { PATH: `${dir}:${fixture.bin}` }, app, app);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(allCalls(fixture).filter((line) => line.startsWith("session")), []);
  assert.equal(auditCalls(fixture).length, 1);
});

test("a PATH entry in the work tree of a git -C target does not run", { skip }, () => {
  const fixture = makeCase({ fallowJson: { verdict: "pass" } });
  const other = gitInit(join(fixture.root, "other"));
  const pkg = join(other, "pkg");
  mkdirSync(pkg);
  writeFileSync(join(pkg, ".fallowrc.json"), "{}\n");
  const dir = join(other, "bin");
  writeFakeFallow(fixture, dir, "target", "fail");
  const result = runGate(fixture, `git -C ${pkg} commit -m x`, { PATH: `${dir}:${fixture.bin}` });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(allCalls(fixture).filter((line) => line.startsWith("target")), []);
  assert.equal(auditCalls(fixture).length, 1);
});

// A command target can hold the only trusted fallow or git, for example
// `git -C /opt/homebrew commit`. The gate does not run a program from a tree
// that it audits, so it blocks the command instead of a commit with no audit.
test("a fallow only in the tree of an audited git -C target blocks and names the target", { skip }, () => {
  const fixture = makeCase();
  const other = gitInit(join(fixture.root, "other"));
  writeFileSync(join(other, ".fallowrc.json"), "{}\n");
  writeFakeFallow(fixture, join(other, "bin"), "target", "pass");
  const result = runGate(fixture, `git -C ${other} commit -m x`, { PATH: `${join(other, "bin")}:${fixture.bin}` });
  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stderr, /blocked/);
  assert.ok(result.stderr.includes(`the tree of the command target ${other}`), result.stderr);
  assert.deepEqual(allCalls(fixture), []);
});

test("a git only in the tree of a git -C target blocks and names the target", { skip }, () => {
  const fixture = makeCase({ fallowJson: { verdict: "pass" }, tools: HOST_TOOLS.filter((name) => name !== "git") });
  const other = gitInit(join(fixture.root, "other"));
  writeFileSync(join(other, ".fallowrc.json"), "{}\n");
  mkdirSync(join(other, "bin"));
  symlinkSync(resolveTool("git"), join(other, "bin", "git"));
  const result = runGate(fixture, `git -C ${other} commit -m x`, { PATH: `${join(other, "bin")}:${fixture.bin}` });
  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stderr, /blocked/);
  assert.ok(result.stderr.includes(`the tree of the command target ${other}`), result.stderr);
  assert.deepEqual(auditCalls(fixture), []);
});

test("a git only in the tree of a target allows the commit when no tree opts in", { skip }, () => {
  const fixture = makeCase({ fallowJson: { verdict: "fail" }, tools: HOST_TOOLS.filter((name) => name !== "git"), optIn: false });
  const other = gitInit(join(fixture.root, "other"));
  mkdirSync(join(other, "bin"));
  symlinkSync(resolveTool("git"), join(other, "bin", "git"));
  const result = runGate(fixture, `git -C ${other} commit -m x`, { PATH: `${join(other, "bin")}:${fixture.bin}` });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
});

test("a fallow only in the tree of a target blocks before the session audit", { skip }, () => {
  const fixture = makeCase();
  const other = gitInit(join(fixture.root, "other"));
  writeFakeFallow(fixture, join(other, "bin"), "target", "pass");
  const result = runGate(fixture, `git -C ${other} commit -m x; true`, { PATH: `${join(other, "bin")}:${fixture.bin}` });
  assert.equal(result.status, 2, result.stderr);
  assert.ok(result.stderr.includes(`the tree of the command target ${other}`), result.stderr);
  assert.deepEqual(allCalls(fixture), []);
});

test("a fallow and helpers in the tree of root B do not run while root A is audited", { skip }, () => {
  const fixture = makeCase({ fallowJson: { verdict: "pass" } });
  const other = gitInit(join(fixture.root, "other"));
  writeFileSync(join(other, ".fallowrc.json"), "{}\n");
  const dir = join(other, "bin");
  writeFakeFallow(fixture, dir, "rootb", "fail");
  const log = join(fixture.root, "target-helpers.log");
  for (const helper of TARGET_HELPERS) {
    writeFileSync(join(dir, helper), `#!/bin/sh\necho "${helper}" >> '${log}'\nexit 0\n`);
    chmodSync(join(dir, helper), 0o755);
  }
  const result = runGate(fixture, `git -C ${other} commit -m x; true`, { PATH: `${dir}:${fixture.bin}` });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(log) ? readFileSync(log, "utf8") : "", "");
  assert.deepEqual(allCalls(fixture).filter((line) => line.startsWith("rootb")), []);
  assert.deepEqual(
    auditCalls(fixture).map((line) => line.split(" @ ")[1]).sort(),
    [fixture.project, other].sort(),
  );
});

test("a git repository at HOME does not hide the user tools under HOME", { skip }, () => {
  const fixture = makeCase({ optIn: false });
  gitInit(fixture.home);
  const session = join(fixture.home, "proj");
  mkdirSync(session);
  writeFileSync(join(session, ".fallowrc.json"), "{}\n");
  writeFakeFallow(fixture, join(session, "bin"), "session", "pass");
  writeFakeFallow(fixture, join(fixture.home, ".cargo", "bin"), "user", "fail");
  const path = [join(session, "bin"), join(fixture.home, ".cargo", "bin"), fixture.bin].join(":");
  const result = runGate(fixture, "git commit -m 'change'", { PATH: path }, session, session);
  assert.equal(result.status, 2, result.stderr);
  assert.deepEqual(allCalls(fixture).filter((line) => line.startsWith("session")), []);
  assert.ok(allCalls(fixture).some((line) => line.startsWith("user audit")), allCalls(fixture).join("\n"));
});

test("a command that is not a git commit or push needs no helper on PATH", { skip }, () => {
  const fixture = makeCase({ tools: ["bash"] });
  const result = runGate(fixture, "ls -la && npm test");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
});

test("a git commit written with a JSON unicode escape still audits", { skip }, () => {
  const fixture = makeCase({ fallowJson: { verdict: "fail" }, fallowExit: 1 });
  const input = '{"tool_name":"Bash","tool_input":{"command":"\\u0067it commit -m x"}}';
  const result = spawnSync(join(fixture.bin, "bash"), [gate], {
    cwd: fixture.project,
    encoding: "utf8",
    input,
    env: { PATH: fixture.bin, HOME: fixture.home, CLAUDE_PROJECT_DIR: fixture.project },
  });
  assert.equal(result.status, 2, result.stderr);
  assert.equal(auditCalls(fixture).length, 1);
});

const TARGET_HELPERS = ["git", "sed", "grep", "mktemp", "sort", "head", "rm", "dirname", "readlink"];

test("helpers in a PATH entry inside a git -C target do not run", { skip }, () => {
  const fixture = makeCase({ fallowJson: { verdict: "pass" } });
  const other = gitInit(join(fixture.root, "other"));
  writeFileSync(join(other, ".fallowrc.json"), "{}\n");
  const dir = join(other, "bin");
  mkdirSync(dir);
  const log = join(fixture.root, "target-helpers.log");
  for (const name of TARGET_HELPERS) {
    writeFileSync(join(dir, name), `#!/bin/sh\necho "${name}" >> '${log}'\nexit 0\n`);
    chmodSync(join(dir, name), 0o755);
  }
  const result = runGate(fixture, `git -C ${other} commit -m x`, { PATH: `${dir}:${fixture.bin}` });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(log) ? readFileSync(log, "utf8") : "", "");
  assert.equal(auditCalls(fixture).length, 1);
});

// A command outside the allowlist reaches git through the loose scan. The
// gate must exclude each target before its first git call.
for (const [name, command] of [
  ["git -C followed by another command", (other) => `git -C ${other} commit -m x; true`],
  ["cd && git commit || true", (other) => `cd ${other} && git commit -m x || true`],
]) {
  test(`helpers in a PATH entry inside a loose-scan target do not run: ${name}`, { skip }, () => {
    const fixture = makeCase({ fallowJson: { verdict: "pass" } });
    const other = gitInit(join(fixture.root, "other"));
    writeFileSync(join(other, ".fallowrc.json"), "{}\n");
    const dir = join(other, "bin");
    mkdirSync(dir);
    const log = join(fixture.root, "target-helpers.log");
    for (const helper of TARGET_HELPERS) {
      writeFileSync(join(dir, helper), `#!/bin/sh\necho "${helper}" >> '${log}'\nexit 0\n`);
      chmodSync(join(dir, helper), 0o755);
    }
    const result = runGate(fixture, command(other), { PATH: `${dir}:${fixture.bin}` });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(existsSync(log) ? readFileSync(log, "utf8") : "", "");
    assert.equal(auditCalls(fixture).length, 2);
  });
}

test("a NUL byte in the hook input does not stop the audit", { skip }, () => {
  const fixture = makeCase({ fallowJson: { verdict: "fail" }, fallowExit: 1 });
  const input = `{"x":"a\u0000b","tool_name":"Bash","tool_input":{"command":"git commit -m x"}}`;
  const result = spawnSync(join(fixture.bin, "bash"), [gate], {
    cwd: fixture.project,
    encoding: "utf8",
    input,
    env: { PATH: fixture.bin, HOME: fixture.home, CLAUDE_PROJECT_DIR: fixture.project },
  });
  assert.equal(result.status, 2, result.stderr);
  assert.equal(auditCalls(fixture).length, 1);
});

test("a session directory at HOME outside git keeps the user tools under HOME", { skip }, () => {
  const fixture = makeCase({ optIn: false });
  writeFileSync(join(fixture.home, ".fallowrc.json"), "{}\n");
  writeFakeFallow(fixture, fixture.home, "home", "pass");
  writeFakeFallow(fixture, join(fixture.home, ".cargo", "bin"), "user", "fail");
  const path = [fixture.home, join(fixture.home, ".cargo", "bin"), fixture.bin].join(":");
  const result = runGate(fixture, "git commit -m x", { PATH: path }, fixture.home, fixture.home);
  assert.equal(result.status, 2, result.stderr);
  assert.deepEqual(allCalls(fixture).filter((line) => line.startsWith("home")), []);
  assert.ok(allCalls(fixture).some((line) => line.startsWith("user audit")), allCalls(fixture).join("\n"));
});

test("a session directory at / does not hide every fallow on PATH", { skip }, () => {
  const fixture = makeCase({ fallowJson: { verdict: "fail" }, fallowExit: 1 });
  const other = makeRepo(fixture, "optin", { optIn: true });
  const result = runGate(fixture, `git -C ${other} commit -m x && git push`, {}, "/", "/");
  assert.equal(result.status, 2, result.stderr);
  assert.deepEqual(auditedNames(fixture), ["optin"]);
});

test("a git top below the directory with .git does not narrow the session tree", { skip }, () => {
  const fixture = makeCase({ optIn: false });
  const sub = join(fixture.project, "sub");
  mkdirSync(sub);
  writeFileSync(join(sub, ".fallowrc.json"), "{}\n");
  const config = spawnSync("git", ["-C", fixture.project, "config", "core.worktree", sub], { encoding: "utf8" });
  assert.equal(config.status, 0, config.stderr);
  const top = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd: sub, encoding: "utf8" });
  assert.equal(realpathSync(top.stdout.trim()), realpathSync(sub));
  const dir = join(fixture.project, "bin");
  writeFakeFallow(fixture, dir, "session", "fail");
  const result = runGate(fixture, "git commit -m x", { PATH: `${dir}:${fixture.bin}` }, sub, sub);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(allCalls(fixture), []);
});

test("a fallow that links into the session tree does not run", { skip }, () => {
  const fixture = makeCase();
  const real = writeFakeFallow(fixture, join(fixture.project, "tools"), "session", "fail");
  const dir = join(fixture.root, "ubin");
  mkdirSync(dir);
  symlinkSync(real, join(dir, "fallow"));
  const result = runGate(fixture, "git commit -m x", { PATH: `${dir}:${fixture.bin}` });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(allCalls(fixture), []);
});

test("a fallow that links into a global node_modules runs", { skip }, () => {
  const fixture = makeCase();
  const real = writeFakeFallow(fixture, join(fixture.root, "glib", "node_modules", "fallow", "bin"), "global", "fail");
  const dir = join(fixture.root, "gbin");
  mkdirSync(dir);
  symlinkSync(real, join(dir, "fallow"));
  const result = runGate(fixture, "git commit -m x", { PATH: `${dir}:${fixture.bin}` });
  assert.equal(result.status, 2, result.stderr);
  assert.ok(allCalls(fixture).some((line) => line.startsWith("global audit")), allCalls(fixture).join("\n"));
});

test("the hook command runs /bin/bash, not a bash from a relative PATH entry", { skip: skip || (existsSync("/bin/bash") && existsSync("/bin/sh") ? false : "needs /bin/bash and /bin/sh") }, () => {
  const fixture = makeCase();
  const tools = join(fixture.project, "tools");
  mkdirSync(tools);
  const log = join(fixture.root, "bash.log");
  writeFileSync(join(tools, "bash"), `#!/bin/sh\necho helper-ran >> '${log}'\nexit 0\n`);
  chmodSync(join(tools, "bash"), 0o755);
  const config = JSON.parse(readFileSync(hooksConfig, "utf8"));
  const command = config.hooks.PreToolUse[0].hooks[0].command;
  const result = spawnSync("/bin/sh", ["-c", command], {
    cwd: fixture.project,
    encoding: "utf8",
    input: JSON.stringify({ tool_name: "Bash", tool_input: { command: "ls" } }),
    env: { PATH: `tools:${fixture.bin}`, HOME: fixture.home, CLAUDE_PLUGIN_ROOT: pluginRoot },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(log) ? readFileSync(log, "utf8") : "", "");
});

// A version-manager shim can run the fallow that the project installs, so the
// gate skips it and tries the next PATH entry.
for (const [name, parts] of [
  ["a Volta bin directory", [".volta", "bin"]],
  ["a Volta bin directory in another letter case", [".Volta", "BIN"]],
  ["a mise shims directory", [".local", "share", "mise", "shims"]],
  ["an asdf shims directory", [".asdf", "shims"]],
  ["any directory named shims in another letter case", ["tools", "Shims"]],
  ["a Volta bin directory without a leading dot", ["AppData", "Local", "Volta", "bin"]],
]) {
  test(`a fallow in ${name} does not run`, { skip }, () => {
    const fixture = makeCase({ fallowJson: { verdict: "fail", summary: {} }, fallowExit: 1 });
    const dir = join(fixture.home, ...parts);
    writeFakeFallow(fixture, dir, "shim", "pass");
    const result = runGate(fixture, "git commit -m x", { PATH: `${dir}:${fixture.bin}` });
    assert.equal(result.status, 2, result.stderr);
    assert.deepEqual(allCalls(fixture).filter((line) => line.startsWith("shim")), []);
    assert.equal(auditCalls(fixture).length, 1);
  });
}

// The data directory of a version manager can have any name. The PATH entry
// can also be the target of a link that the data directory holds.
for (const [name, variable, sub, linked] of [
  ["the bin directory of VOLTA_HOME", "VOLTA_HOME", "bin", false],
  ["a link target of the bin directory of VOLTA_HOME", "VOLTA_HOME", "bin", true],
  ["a link target of the shims directory of ASDF_DATA_DIR", "ASDF_DATA_DIR", "shims", true],
  ["a link target of the shims directory of MISE_DATA_DIR", "MISE_DATA_DIR", "shims", true],
]) {
  test(`a fallow in ${name} does not run`, { skip }, () => {
    const fixture = makeCase({ fallowJson: { verdict: "fail", summary: {} }, fallowExit: 1 });
    const data = join(fixture.home, "vmdata");
    mkdirSync(data);
    let dir = join(data, sub);
    if (linked) {
      dir = join(fixture.home, "vmreal");
      symlinkSync(dir, join(data, sub));
    }
    writeFakeFallow(fixture, dir, "shim", "pass");
    const result = runGate(fixture, "git commit -m x", { PATH: `${dir}:${fixture.bin}`, [variable]: data });
    assert.equal(result.status, 2, result.stderr);
    assert.deepEqual(allCalls(fixture).filter((line) => line.startsWith("shim")), []);
    assert.equal(auditCalls(fixture).length, 1);
  });
}

test("a fallow that links to a file in a shims directory does not run", { skip }, () => {
  const fixture = makeCase({ fallowJson: { verdict: "fail", summary: {} }, fallowExit: 1 });
  const shims = join(fixture.home, "vm", "shims");
  const shim = writeFakeFallow(fixture, shims, "shim", "pass");
  const dir = join(fixture.home, "ubin");
  mkdirSync(dir);
  symlinkSync(shim, join(dir, "fallow"));
  const result = runGate(fixture, "git commit -m x", { PATH: `${dir}:${fixture.bin}` });
  assert.equal(result.status, 2, result.stderr);
  assert.deepEqual(allCalls(fixture).filter((line) => line.startsWith("shim")), []);
  assert.equal(auditCalls(fixture).length, 1);
});

test("a fallow that links to a volta-shim program does not run", { skip }, () => {
  const fixture = makeCase();
  const shim = join(fixture.root, "vm", "volta-shim");
  renameSync(writeFakeFallow(fixture, join(fixture.root, "vm"), "shim", "fail"), shim);
  const dir = join(fixture.root, "ubin");
  mkdirSync(dir);
  symlinkSync(shim, join(dir, "fallow"));
  const result = runGate(fixture, "git commit -m x", { PATH: `${dir}:${fixture.bin}` });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(allCalls(fixture), []);
  assert.match(result.stderr, /fallow binary is not installed/);
  assert.match(result.stderr, /outside a version manager/);
});

test("a relative cwd in the hook input ends within the time limit", { skip }, () => {
  const fixture = makeCase({ fallowJson: { verdict: "pass" } });
  mkdirSync(join(fixture.project, "sub"));
  const result = spawnSync(join(fixture.bin, "bash"), [gate], {
    cwd: fixture.project,
    encoding: "utf8",
    timeout: 10000,
    input: JSON.stringify({ tool_name: "Bash", tool_input: { command: "git commit -m x" }, cwd: "sub" }),
    env: { PATH: fixture.bin, HOME: fixture.home, CLAUDE_PROJECT_DIR: fixture.project },
  });
  assert.equal(result.signal, null, "the gate did not end within 10 s");
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(auditCalls(fixture).map((line) => line.split(" @ ")[1]), [fixture.project]);
});

// The shell expands ~, $HOME and ${HOME} in a -C word, and a later -C with an
// absolute path replaces the earlier one. The gate also excludes and audits
// that HOME form.
for (const command of [
  "git -C ~/other commit -m x; true",
  "git -C $HOME/other commit -m x; true",
  "git -C ${HOME}/other commit -m x; true",
  "git -C /tmp -C ~/other commit -m x; true",
]) {
  test(`the HOME form of the target in ${command} is excluded and audited`, { skip }, () => {
    const fixture = makeCase({ fallowJson: { verdict: "pass" } });
    const other = gitInit(join(fixture.home, "other"));
    writeFileSync(join(other, ".fallowrc.json"), "{}\n");
    writeFakeFallow(fixture, join(other, "bin"), "other", "fail");
    const path = [join(other, "bin"), fixture.bin].join(":");
    const result = runGate(fixture, command, { PATH: path });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(allCalls(fixture).filter((line) => line.startsWith("other")), []);
    assert.deepEqual(auditCalls(fixture).map((line) => line.split(" @ ")[1]).sort(), [fixture.project, other].sort());
  });
}

// The shell does not expand ~ after --git-dir= or in a --work-tree word, so a
// directory named ~ in the session directory stays a target.
test("a literal ~ target in --git-dir= and --work-tree stays excluded", { skip }, () => {
  const fixture = makeCase({ fallowJson: { verdict: "pass" } });
  const clone = gitInit(join(fixture.root, "clone"));
  writeFakeFallow(fixture, join(clone, "bin"), "clone", "fail");
  symlinkSync(clone, join(fixture.project, "~"));
  const path = [join(clone, "bin"), fixture.bin].join(":");
  const result = runGate(fixture, "git --git-dir=~/.git --work-tree=~ commit -m x", { PATH: path });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(allCalls(fixture).filter((line) => line.startsWith("clone")), []);
  assert.ok(auditCalls(fixture).length >= 1, result.stderr);
});

test("a relative cwd that links out of the process directory without git is excluded", { skip }, () => {
  const fixture = makeCase({ fallowJson: { verdict: "pass" } });
  const outside = join(fixture.root, "outside");
  writeFakeFallow(fixture, join(outside, "bin"), "outside", "fail");
  symlinkSync(outside, join(fixture.project, "out"));
  const path = [join(outside, "bin"), fixture.bin].join(":");
  const result = runGate(fixture, "git commit -m x", { PATH: path }, fixture.project, "out");
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(allCalls(fixture).filter((line) => line.startsWith("outside")), []);
  assert.deepEqual(auditCalls(fixture).map((line) => line.split(" @ ")[1]), [fixture.project]);
});

// A git repository at HOME as a command target or an audit root excludes only
// HOME itself, so the user tools below HOME stay in use.
for (const [name, homeOptIn] of [
  ["a command target", false],
  ["an audit root", true],
]) {
  test(`a git repository at HOME as ${name} keeps the user tools under HOME`, { skip }, () => {
    const fixture = makeCase();
    gitInit(fixture.home);
    if (homeOptIn) writeFileSync(join(fixture.home, ".fallowrc.json"), "{}\n");
    writeFakeFallow(fixture, join(fixture.home, ".cargo", "bin"), "user", "pass");
    const path = [join(fixture.home, ".cargo", "bin"), fixture.bin].join(":");
    const result = runGate(fixture, `git -C ${fixture.home} commit -m x; true`, { PATH: path });
    assert.equal(result.status, 0, result.stderr);
    const audited = allCalls(fixture)
      .filter((line) => line.startsWith("user audit"))
      .map((line) => line.split(" @ ")[1])
      .sort();
    assert.deepEqual(audited, (homeOptIn ? [fixture.project, fixture.home] : [fixture.project]).sort());
  });
}

test("the install notice says when the gate skipped a version-manager shim", { skip }, () => {
  const fixture = makeCase();
  const shims = join(fixture.home, ".asdf", "shims");
  writeFakeFallow(fixture, shims, "shim", "pass");
  const withShim = runGate(fixture, "git commit -m x", { PATH: `${shims}:${fixture.bin}` });
  assert.equal(withShim.status, 0, withShim.stderr);
  assert.deepEqual(allCalls(fixture), []);
  assert.match(withShim.stderr, /a fallow in a version-manager shim directory is not used/);
  const withoutShim = runGate(fixture, "git commit -m x");
  assert.equal(withoutShim.status, 0, withoutShim.stderr);
  assert.match(withoutShim.stderr, /fallow binary is not installed/);
  assert.doesNotMatch(withoutShim.stderr, /shim directory is not used/);
});

test("a PATH entry that links to a directory with a colon in its name does not run", { skip }, () => {
  const fixture = makeCase({ fallowJson: { verdict: "pass" } });
  mkdirSync(join(fixture.root, "a:b"));
  writeFakeFallow(fixture, join(fixture.root, "a"), "colon", "fail");
  const link = join(fixture.root, "colonlink");
  symlinkSync(join(fixture.root, "a:b"), link);
  const result = runGate(fixture, "git commit -m x", { PATH: `${link}:${fixture.bin}` });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(allCalls(fixture).filter((line) => line.startsWith("colon")), []);
  assert.equal(auditCalls(fixture).length, 1);
});
