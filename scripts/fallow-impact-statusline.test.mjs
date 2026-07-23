import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  MINIMUM_FALLOW_VERSION,
  compactStatusline,
  compareVersions,
  parseFallowVersion,
  pathsFor,
  projectKey,
} from "../fallow/bin/fallow-impact-statusline.mjs";

const HELPER = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../fallow/bin/fallow-impact-statusline.mjs",
);
const FULL_LINE =
  "fallow impact  7 issues in last full scan · 5 fewer than prior · 4.9k cleared while tracking";

const writeJson = (path, value) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
};

const fixture = ({ version = MINIMUM_FALLOW_VERSION } = {}) => {
  const root = mkdtempSync(join(tmpdir(), "fallow-impact-statusline-"));
  const home = join(root, "home");
  const project = join(root, "project");
  const bin = join(root, "bin");
  mkdirSync(home, { recursive: true });
  mkdirSync(project, { recursive: true });
  mkdirSync(bin, { recursive: true });
  const fallow = join(bin, "fallow");
  writeFileSync(
    fallow,
    `#!/bin/sh
if [ "$1" = "--version" ]; then
  printf 'fallow ${version}\\n'
  exit 0
fi
printf '${FULL_LINE}\\n'
`,
  );
  chmodSync(fallow, 0o755);
  return {
    fallow,
    home,
    project,
    root,
    env: {
      ...process.env,
      HOME: home,
      PATH: `${bin}:${process.env.PATH ?? ""}`,
    },
  };
};

const runHelper = (current, args, extra = {}) =>
  spawnSync(process.execPath, [HELPER, ...args], {
    cwd: current.project,
    encoding: "utf8",
    env: { ...current.env, ...extra },
  });

const parseOutput = (run) => {
  assert.equal(run.status, 0, run.stderr);
  return JSON.parse(run.stdout);
};

test("version and compact rendering contracts stay stable", () => {
  assert.equal(parseFallowVersion("fallow 3.9.0"), "3.9.0");
  assert.equal(compareVersions("3.10.0", "3.9.9"), 1);
  assert.equal(compareVersions("3.9.0", "3.9.0"), 0);
  assert.equal(compareVersions("3.8.9", "3.9.0"), -1);
  assert.equal(compactStatusline(FULL_LINE), "fallow  7 issues · 4.9k cleared");
});

test("project state paths are stable and do not expose the project path", () => {
  const current = fixture();
  const paths = pathsFor({
    scope: "project",
    root: current.project,
    home: current.home,
  });
  assert.equal(projectKey(current.project).length, 24);
  assert.equal(paths.settings, join(current.project, ".claude", "settings.local.json"));
  assert.ok(paths.state.startsWith(join(current.home, ".claude")));
  assert.ok(!paths.state.includes(current.project));
});

test("inspect is read-only and previews the exact CLI output", () => {
  const current = fixture();
  const result = parseOutput(
    runHelper(current, ["inspect", "--scope", "user", "--root", current.project]),
  );
  assert.equal(result.status, "ready");
  assert.equal(result.preview, FULL_LINE);
  assert.equal(result.suggestedMode, "replace");
  assert.equal(result.fallowBinary, realpathSync(current.fallow));
  assert.equal(result.fallowVersion, MINIMUM_FALLOW_VERSION);
  assert.equal(existsSync(join(current.home, ".claude", "settings.json")), false);
});

test("setup skips an older PATH entry and pins the compatible binary", () => {
  const current = fixture();
  const oldBin = join(current.root, "old-bin");
  mkdirSync(oldBin, { recursive: true });
  const oldFallow = join(oldBin, "fallow");
  writeFileSync(oldFallow, "#!/bin/sh\nprintf 'fallow 2.87.0\\n'\n");
  chmodSync(oldFallow, 0o755);
  current.env.PATH = `${oldBin}:${current.env.PATH}`;

  const inspected = parseOutput(
    runHelper(current, ["inspect", "--scope", "user", "--root", current.project]),
  );
  assert.equal(inspected.fallowBinary, realpathSync(current.fallow));
  assert.equal(inspected.fallowVersion, MINIMUM_FALLOW_VERSION);

  parseOutput(
    runHelper(current, [
      "install",
      "--scope",
      "user",
      "--root",
      current.project,
      "--mode",
      "replace",
      "--confirm",
    ]),
  );
  const paths = pathsFor({ scope: "user", root: current.project, home: current.home });
  const state = JSON.parse(readFileSync(paths.state, "utf8"));
  assert.equal(state.fallowBinary, realpathSync(current.fallow));

  const settings = JSON.parse(readFileSync(paths.settings, "utf8"));
  const rendered = spawnSync(settings.statusLine.command, {
    cwd: current.project,
    encoding: "utf8",
    env: {
      ...current.env,
      PATH: oldBin,
      NO_COLOR: "1",
      FALLOW_STATUSLINE_DEBUG: "1",
    },
    input: JSON.stringify({ cwd: current.project }),
    shell: true,
  });
  assert.equal(rendered.status, 0, rendered.stderr);
  assert.equal(rendered.stdout, `${FULL_LINE}\n`);
});

test("replace setup installs a stable runtime and renders a compact plain line", () => {
  const current = fixture();
  const installed = parseOutput(
    runHelper(current, [
      "install",
      "--scope",
      "user",
      "--root",
      current.project,
      "--mode",
      "replace",
      "--confirm",
    ]),
  );
  assert.equal(installed.status, "installed");

  const settingsPath = join(current.home, ".claude", "settings.json");
  const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
  assert.equal(settings.statusLine.type, "command");
  assert.ok(settings.statusLine.command.includes("fallow-impact-statusline/user/statusline.mjs"));
  assert.ok(!settings.statusLine.command.includes("/fallow/bin/"));

  const rendered = spawnSync(settings.statusLine.command, {
    cwd: current.project,
    encoding: "utf8",
    env: {
      ...current.env,
      NO_COLOR: "1",
      COLUMNS: "80",
      FALLOW_STATUSLINE_DEBUG: "1",
    },
    input: JSON.stringify({
      cwd: current.project,
      workspace: { current_dir: current.project },
    }),
    shell: true,
  });
  assert.equal(rendered.status, 0, rendered.stderr);
  assert.equal(rendered.stderr, "");
  assert.equal(rendered.stdout, "fallow  7 issues · 4.9k cleared\n");
});

test("compose preserves multiline output and removal restores the exact prior setting", () => {
  const current = fixture();
  const previousScript = join(current.root, "previous-statusline.sh");
  writeFileSync(
    previousScript,
    "#!/bin/sh\ncat >/dev/null\nprintf 'model opus\\ncontext 42%%\\n'\n",
  );
  chmodSync(previousScript, 0o755);
  const settingsPath = join(current.home, ".claude", "settings.json");
  const previous = {
    type: "command",
    command: `"${previousScript}"`,
    padding: 2,
    refreshInterval: 5,
  };
  writeJson(settingsPath, { permissions: { allow: ["Read"] }, statusLine: previous });

  const installed = parseOutput(
    runHelper(current, [
      "install",
      "--scope",
      "user",
      "--root",
      current.project,
      "--mode",
      "compose",
      "--confirm",
    ]),
  );
  assert.equal(installed.mode, "compose");
  const managed = JSON.parse(readFileSync(settingsPath, "utf8")).statusLine;
  assert.equal(managed.padding, 2);
  assert.equal(managed.refreshInterval, 5);

  const rendered = spawnSync(managed.command, {
    cwd: current.project,
    encoding: "utf8",
    env: { ...current.env, NO_COLOR: "1", FALLOW_STATUSLINE_DEBUG: "1" },
    input: JSON.stringify({
      cwd: current.project,
      workspace: { current_dir: current.project },
    }),
    shell: true,
  });
  assert.equal(rendered.status, 0, rendered.stderr);
  assert.equal(rendered.stderr, "");
  assert.equal(rendered.stdout, `model opus\ncontext 42%\n${FULL_LINE}\n`);

  writeFileSync(current.fallow, "#!/bin/sh\nexit 1\n");
  const withoutFallow = spawnSync(managed.command, {
    cwd: current.project,
    encoding: "utf8",
    env: { ...current.env, NO_COLOR: "1", FALLOW_STATUSLINE_DEBUG: "1" },
    input: JSON.stringify({
      cwd: current.project,
      workspace: { current_dir: current.project },
    }),
    shell: true,
  });
  assert.equal(withoutFallow.status, 0, withoutFallow.stderr);
  assert.equal(withoutFallow.stderr, "");
  assert.equal(withoutFallow.stdout, "model opus\ncontext 42%\n");

  const reordered = JSON.parse(readFileSync(settingsPath, "utf8"));
  reordered.statusLine = {
    refreshInterval: managed.refreshInterval,
    padding: managed.padding,
    command: managed.command,
    type: managed.type,
  };
  writeJson(settingsPath, reordered);

  const removed = parseOutput(
    runHelper(current, ["remove", "--scope", "user", "--root", current.project, "--confirm"]),
  );
  assert.equal(removed.status, "removed");
  const restored = JSON.parse(readFileSync(settingsPath, "utf8"));
  assert.deepEqual(restored, {
    permissions: { allow: ["Read"] },
    statusLine: previous,
  });
});

test("removal refuses to overwrite a statusline changed after setup", () => {
  const current = fixture();
  parseOutput(
    runHelper(current, [
      "install",
      "--scope",
      "user",
      "--root",
      current.project,
      "--mode",
      "replace",
      "--confirm",
    ]),
  );
  const settingsPath = join(current.home, ".claude", "settings.json");
  const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
  settings.statusLine = { type: "command", command: "my-new-statusline" };
  writeJson(settingsPath, settings);

  const removal = runHelper(current, [
    "remove",
    "--scope",
    "user",
    "--root",
    current.project,
    "--confirm",
  ]);
  assert.notEqual(removal.status, 0);
  assert.match(removal.stderr, /changed after Fallow setup/u);
  assert.deepEqual(JSON.parse(readFileSync(settingsPath, "utf8")).statusLine, {
    type: "command",
    command: "my-new-statusline",
  });
});

test("compose setup requires an existing command statusline", () => {
  const current = fixture();
  const install = runHelper(current, [
    "install",
    "--scope",
    "user",
    "--root",
    current.project,
    "--mode",
    "compose",
    "--confirm",
  ]);
  assert.notEqual(install.status, 0);
  assert.match(install.stderr, /requires an existing command-based statusLine/u);
  assert.equal(existsSync(join(current.home, ".claude", "settings.json")), false);
});

test("an orphaned managed command can be repaired without composing itself", () => {
  const current = fixture();
  parseOutput(
    runHelper(current, [
      "install",
      "--scope",
      "user",
      "--root",
      current.project,
      "--mode",
      "replace",
      "--confirm",
    ]),
  );
  const paths = pathsFor({ scope: "user", root: current.project, home: current.home });
  unlinkSync(paths.state);

  const inspection = parseOutput(
    runHelper(current, ["inspect", "--scope", "user", "--root", current.project]),
  );
  assert.equal(inspection.status, "repair-required");
  assert.equal(inspection.suggestedMode, "replace");

  const compose = runHelper(current, [
    "install",
    "--scope",
    "user",
    "--root",
    current.project,
    "--mode",
    "compose",
    "--confirm",
  ]);
  assert.notEqual(compose.status, 0);
  assert.match(compose.stderr, /requires an existing command-based statusLine/u);

  const repaired = parseOutput(
    runHelper(current, [
      "install",
      "--scope",
      "user",
      "--root",
      current.project,
      "--mode",
      "replace",
      "--confirm",
    ]),
  );
  assert.equal(repaired.status, "installed");
});

test("setup refuses an older Fallow binary without changing settings", () => {
  const current = fixture({ version: "3.8.1" });
  current.env.PATH = dirname(current.fallow);
  const install = runHelper(current, [
    "install",
    "--scope",
    "user",
    "--root",
    current.project,
    "--mode",
    "replace",
    "--confirm",
  ]);
  assert.notEqual(install.status, 0);
  assert.match(install.stderr, /3\.9\.0 or newer/u);
  assert.equal(existsSync(join(current.home, ".claude", "settings.json")), false);
});
