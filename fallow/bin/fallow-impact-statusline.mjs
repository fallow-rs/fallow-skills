#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCHEMA_VERSION = 1;
const MINIMUM_FALLOW_VERSION = "3.9.0";
const PROCESS_TIMEOUT_MS = 1_500;
const PREFLIGHT_TIMEOUT_MS = 3_000;
const MAX_INPUT_BYTES = 1024 * 1024;
const MAX_OUTPUT_BYTES = 64 * 1024;
const NARROW_COLUMNS = 100;
const RUNTIME_FILENAME = "statusline.mjs";
const STATE_FILENAME = "state.json";
const LOCK_FILENAME = "setup.lock";

const COLORS = {
  amber: "\u001B[38;2;218;165;32m",
  creamBackground: "\u001B[48;2;253;250;239m",
  dark: "\u001B[38;2;28;27;28m",
  green: "\u001B[38;2;95;175;105m",
  muted: "\u001B[38;2;145;142;136m",
  red: "\u001B[38;2;218;96;96m",
  reset: "\u001B[0m",
  bold: "\u001B[1m",
};

const fail = (message) => {
  throw new Error(message);
};

const parseArguments = (argv) => {
  const [command, ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index];
    if (!argument.startsWith("--")) {
      fail(`Unexpected argument: ${argument}`);
    }
    const name = argument.slice(2);
    if (name === "confirm") {
      options.confirm = true;
      continue;
    }
    const value = rest[index + 1];
    if (value === undefined || value.startsWith("--")) {
      fail(`Missing value for --${name}`);
    }
    options[name] = value;
    index += 1;
  }
  return { command, options };
};

const stableJson = (value) => `${JSON.stringify(value, null, 2)}\n`;

const readJsonObject = (path, { optional = false } = {}) => {
  if (optional && !existsSync(path)) {
    return null;
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(`Cannot read valid JSON from ${path}: ${error.message}`);
  }
  if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") {
    fail(`Expected a JSON object in ${path}`);
  }
  return parsed;
};

const writeFileAtomic = (path, contents, mode = null) => {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = join(
    dirname(path),
    `.${process.pid.toString()}.${Date.now().toString()}.${Math.random().toString(16).slice(2)}`,
  );
  try {
    writeFileSync(temporary, contents, { mode: mode ?? 0o600 });
    if (mode !== null) {
      chmodSync(temporary, mode);
    }
    renameSync(temporary, path);
  } finally {
    if (existsSync(temporary)) {
      unlinkSync(temporary);
    }
  }
};

const writeJsonAtomic = (path, value) => {
  const mode = existsSync(path) ? statSync(path).mode & 0o777 : 0o600;
  writeFileAtomic(path, stableJson(value), mode);
};

const deepEqual = (left, right) => {
  if (Object.is(left, right)) {
    return true;
  }
  if (
    left === null ||
    right === null ||
    typeof left !== "object" ||
    typeof right !== "object" ||
    Array.isArray(left) !== Array.isArray(right)
  ) {
    return false;
  }
  if (Array.isArray(left)) {
    return (
      left.length === right.length && left.every((value, index) => deepEqual(value, right[index]))
    );
  }
  const leftKeys = Object.keys(left).toSorted();
  const rightKeys = Object.keys(right).toSorted();
  return (
    deepEqual(leftKeys, rightKeys) && leftKeys.every((key) => deepEqual(left[key], right[key]))
  );
};

const compareVersions = (left, right) => {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) {
      return leftParts[index] > rightParts[index] ? 1 : -1;
    }
  }
  return 0;
};

const parseFallowVersion = (value) => {
  const match = value.match(/\b(\d+)\.(\d+)\.(\d+)\b/u);
  return match ? `${match[1]}.${match[2]}.${match[3]}` : null;
};

const normalizedScope = (value) => {
  if (value !== "user" && value !== "project") {
    fail("--scope must be user or project");
  }
  return value;
};

const normalizedRoot = (value) => {
  const candidate = resolve(value ?? process.cwd());
  if (!existsSync(candidate) || !statSync(candidate).isDirectory()) {
    fail(`Project root does not exist: ${candidate}`);
  }
  return realpathSync(candidate);
};

const projectKey = (root) => createHash("sha256").update(root).digest("hex").slice(0, 24);

const pathsFor = ({ scope, root, home = homedir() }) => {
  const claudeRoot = join(home, ".claude");
  const stateRoot =
    scope === "user"
      ? join(claudeRoot, "fallow-impact-statusline", "user")
      : join(claudeRoot, "fallow-impact-statusline", "projects", projectKey(root));
  return {
    lock: join(stateRoot, LOCK_FILENAME),
    runtime: join(stateRoot, RUNTIME_FILENAME),
    settings:
      scope === "user"
        ? join(claudeRoot, "settings.json")
        : join(root, ".claude", "settings.local.json"),
    state: join(stateRoot, STATE_FILENAME),
    stateRoot,
  };
};

const withLock = (path, operation) => {
  mkdirSync(dirname(path), { recursive: true });
  let handle;
  try {
    handle = openSync(path, "wx", 0o600);
  } catch (error) {
    if (error.code === "EEXIST") {
      fail("Another Fallow statusline setup is already running");
    }
    throw error;
  }
  try {
    return operation();
  } finally {
    closeSync(handle);
    unlinkSync(path);
  }
};

const commandArgument = (value) => {
  if (/[\r\n"$`]/u.test(value)) {
    fail(`Cannot safely install a command containing shell metacharacters: ${value}`);
  }
  return `"${value}"`;
};

const renderCommand = (runtime, state) =>
  `${commandArgument(process.execPath)} ${commandArgument(runtime)} render --state ${commandArgument(state)}`;

const managedSetting = ({ command, previous, mode }) => {
  const setting = { type: "command", command };
  if (mode === "compose" && previous && typeof previous === "object") {
    for (const field of ["padding", "refreshInterval", "hideVimModeIndicator"]) {
      if (Object.hasOwn(previous, field)) {
        setting[field] = previous[field];
      }
    }
  }
  return setting;
};

const readSettings = (path) => readJsonObject(path, { optional: true }) ?? {};

const looksLikeManagedSetting = (value) =>
  value !== null &&
  typeof value === "object" &&
  value.type === "command" &&
  typeof value.command === "string" &&
  value.command.includes("fallow-impact-statusline") &&
  value.command.includes(RUNTIME_FILENAME) &&
  value.command.includes(" render --state ");

const preflight = (root) => {
  const versionRun = spawnSync("fallow", ["--version"], {
    encoding: "utf8",
    timeout: PREFLIGHT_TIMEOUT_MS,
    windowsHide: true,
  });
  if (versionRun.error?.code === "ENOENT") {
    fail(`Fallow ${MINIMUM_FALLOW_VERSION} or newer is required, but fallow is not on PATH`);
  }
  if (versionRun.error || versionRun.status !== 0) {
    fail(`Could not run fallow --version`);
  }
  const version = parseFallowVersion(versionRun.stdout);
  if (version === null || compareVersions(version, MINIMUM_FALLOW_VERSION) < 0) {
    fail(
      `Fallow ${MINIMUM_FALLOW_VERSION} or newer is required, found ${version ?? "an unknown version"}`,
    );
  }

  const statuslineRun = spawnSync("fallow", ["--root", root, "impact", "statusline"], {
    encoding: "utf8",
    timeout: PREFLIGHT_TIMEOUT_MS,
    windowsHide: true,
  });
  const lines = statuslineRun.stdout?.trimEnd().split("\n") ?? [];
  if (
    statuslineRun.error ||
    statuslineRun.status !== 0 ||
    statuslineRun.stderr !== "" ||
    lines.length !== 1 ||
    !lines[0].startsWith("fallow impact  ")
  ) {
    fail("Installed Fallow does not provide a silent one-line Impact statusline");
  }
  return { preview: lines[0], version };
};

const loadManagedState = (path) => {
  const state = readJsonObject(path, { optional: true });
  if (state === null) {
    return null;
  }
  if (
    state.schemaVersion !== SCHEMA_VERSION ||
    (state.scope !== "user" && state.scope !== "project") ||
    typeof state.root !== "string" ||
    typeof state.managed !== "object" ||
    state.managed === null ||
    typeof state.previous !== "object" ||
    state.previous === null ||
    typeof state.previous.present !== "boolean"
  ) {
    fail(`Unsupported Fallow statusline state in ${path}`);
  }
  return state;
};

const inspect = ({ scope, root }) => {
  const paths = pathsFor({ scope, root });
  const settings = readSettings(paths.settings);
  const existing = Object.hasOwn(settings, "statusLine") ? settings.statusLine : null;
  const state = loadManagedState(paths.state);
  const managed = state !== null && deepEqual(existing, state.managed);
  const orphaned = state === null && looksLikeManagedSetting(existing);
  const existingCommand =
    existing !== null &&
    typeof existing === "object" &&
    existing.type === "command" &&
    typeof existing.command === "string";
  const check = preflight(root);
  return {
    status: managed
      ? "managed"
      : orphaned
        ? "repair-required"
        : existing === null
          ? "ready"
          : "choice-required",
    scope,
    settingsPath: paths.settings,
    existingStatusLine: existing,
    suggestedMode: managed
      ? state.mode
      : orphaned
        ? "replace"
        : existingCommand
          ? "compose"
          : "replace",
    minimumFallowVersion: MINIMUM_FALLOW_VERSION,
    fallowVersion: check.version,
    preview: check.preview,
  };
};

const install = ({ scope, root, mode, confirm }) => {
  if (!confirm) {
    fail("Installation requires --confirm after the user has reviewed the preview");
  }
  if (mode !== "replace" && mode !== "compose") {
    fail("--mode must be replace or compose");
  }
  const paths = pathsFor({ scope, root });
  return withLock(paths.lock, () => {
    const check = preflight(root);
    const settings = readSettings(paths.settings);
    const currentPresent = Object.hasOwn(settings, "statusLine");
    const current = currentPresent ? settings.statusLine : null;
    const oldState = loadManagedState(paths.state);

    const orphaned = oldState === null && looksLikeManagedSetting(current);
    let previous = orphaned
      ? { present: false, value: null }
      : { present: currentPresent, value: current };
    if (oldState !== null) {
      if (!deepEqual(current, oldState.managed)) {
        fail("The configured statusLine changed after Fallow setup; refusing to overwrite it");
      }
      previous = oldState.previous;
    }

    if (mode === "compose" && !previous.present) {
      fail("Compose mode requires an existing command-based statusLine");
    }
    if (
      mode === "compose" &&
      (previous.value === null ||
        typeof previous.value !== "object" ||
        previous.value.type !== "command" ||
        typeof previous.value.command !== "string")
    ) {
      fail("Compose mode requires an existing command-based statusLine");
    }

    const command = renderCommand(paths.runtime, paths.state);
    mkdirSync(paths.stateRoot, { recursive: true });
    writeFileAtomic(paths.runtime, readFileSync(fileURLToPath(import.meta.url)), 0o755);
    const managed = managedSetting({
      command,
      previous: previous.present ? previous.value : null,
      mode,
    });
    const state = {
      schemaVersion: SCHEMA_VERSION,
      scope,
      root,
      mode,
      previous,
      managed,
      installedFallowVersion: check.version,
    };
    const previousState = existsSync(paths.state) ? readFileSync(paths.state) : null;
    writeJsonAtomic(paths.state, state);
    try {
      writeJsonAtomic(paths.settings, { ...settings, statusLine: managed });
    } catch (error) {
      if (previousState === null) {
        unlinkSync(paths.state);
      } else {
        writeFileAtomic(paths.state, previousState, 0o600);
      }
      throw error;
    }
    return {
      status: oldState === null ? "installed" : "updated",
      scope,
      mode,
      settingsPath: paths.settings,
      preview: check.preview,
    };
  });
};

const remove = ({ scope, root, confirm }) => {
  if (!confirm) {
    fail("Removal requires --confirm");
  }
  const paths = pathsFor({ scope, root });
  return withLock(paths.lock, () => {
    const state = loadManagedState(paths.state);
    if (state === null) {
      return { status: "not-installed", scope, settingsPath: paths.settings };
    }
    const settings = readSettings(paths.settings);
    const current = Object.hasOwn(settings, "statusLine") ? settings.statusLine : null;
    if (!deepEqual(current, state.managed)) {
      fail("The configured statusLine changed after Fallow setup; refusing to overwrite it");
    }
    const restored = { ...settings };
    if (state.previous.present) {
      restored.statusLine = state.previous.value;
    } else {
      delete restored.statusLine;
    }
    writeJsonAtomic(paths.settings, restored);
    unlinkSync(paths.state);
    return {
      status: "removed",
      scope,
      restoredPreviousStatusLine: state.previous.present,
      settingsPath: paths.settings,
    };
  });
};

const readStdin = async () => {
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > MAX_INPUT_BYTES) {
      fail("Statusline input exceeds 1 MiB");
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
};

const runCaptured = ({ command, args = [], input, cwd, shell = false, noColor = false }) =>
  new Promise((resolveRun) => {
    let child;
    try {
      child = spawn(command, args, {
        cwd,
        shell,
        windowsHide: true,
        stdio: ["pipe", "pipe", "ignore"],
        env: noColor ? { ...process.env, NO_COLOR: "1" } : process.env,
      });
    } catch {
      resolveRun("");
      return;
    }
    const chunks = [];
    let size = 0;
    let settled = false;
    const finish = (value) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolveRun(value);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish("");
    }, PROCESS_TIMEOUT_MS);
    child.stdout.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_OUTPUT_BYTES) {
        child.kill();
        finish("");
        return;
      }
      chunks.push(chunk);
    });
    child.on("error", () => finish(""));
    child.on("close", (code) => {
      const output = Buffer.concat(chunks).toString("utf8").trimEnd();
      finish(code === 0 ? output : "");
    });
    child.stdin.on("error", () => {
      // A fast command may exit before consuming stdin. Its exit code remains authoritative.
    });
    child.stdin.end(input);
  });

const compactStatusline = (line) => {
  const payload = line.replace(/^fallow impact {2}/u, "");
  const segments = payload.split(" · ");
  const issueMatch = segments[0]?.match(/^(\S+) issues\b/u);
  const cleared = segments.find((segment) => segment.includes(" cleared"));
  if (issueMatch && cleared) {
    return `fallow  ${issueMatch[1]} issues · ${cleared.replace(" while tracking", "")}`;
  }
  return line.replace(/^fallow impact {2}/u, "fallow  ");
};

const colorizeStatusline = (line, columns = null) => {
  const plain =
    typeof columns === "number" && columns > 0 && columns < NARROW_COLUMNS
      ? compactStatusline(line)
      : line;
  if (Object.hasOwn(process.env, "NO_COLOR") || process.env.TERM === "dumb") {
    return plain;
  }
  const payload = plain.replace(/^fallow(?: impact)? {2}/u, "");
  const hasImpactLabel = plain.startsWith("fallow impact  ");
  const badge =
    `${COLORS.bold}${COLORS.creamBackground}${COLORS.dark} fallow ${COLORS.reset}` +
    (hasImpactLabel ? ` ${COLORS.muted}impact${COLORS.reset}` : "");
  const colored = payload
    .split(" · ")
    .map((segment) => {
      if (segment.includes(" more than prior")) {
        return `${COLORS.red}${segment}${COLORS.reset}`;
      }
      if (segment.includes(" fewer than prior") || segment.includes(" cleared")) {
        return `${COLORS.green}${segment}${COLORS.reset}`;
      }
      if (
        segment === "off" ||
        segment.includes("awaiting first scan") ||
        segment.includes("unchanged from prior") ||
        segment.includes("changed-file scan")
      ) {
        return `${COLORS.muted}${segment}${COLORS.reset}`;
      }
      if (segment.includes("unavailable")) {
        return `${COLORS.amber}${segment}${COLORS.reset}`;
      }
      return segment;
    })
    .join(` ${COLORS.muted}·${COLORS.reset} `);
  return `${badge}  ${colored}`;
};

const usableRoot = (candidate, fallback) => {
  try {
    return statSync(candidate).isDirectory() ? realpathSync(candidate) : fallback;
  } catch {
    return fallback;
  }
};

const render = async (statePath) => {
  const rawInput = await readStdin();
  let input = {};
  try {
    input = rawInput.trim() === "" ? {} : JSON.parse(rawInput);
  } catch {
    return "";
  }
  const state = loadManagedState(resolve(statePath));
  if (state === null) {
    return "";
  }
  const inputRoot =
    typeof input.workspace?.current_dir === "string"
      ? input.workspace.current_dir
      : typeof input.cwd === "string"
        ? input.cwd
        : state.root;
  const root = usableRoot(inputRoot, state.root);
  const previousCommand =
    state.mode === "compose" &&
    state.previous.present &&
    state.previous.value?.type === "command" &&
    typeof state.previous.value.command === "string"
      ? state.previous.value.command
      : null;

  const previousRun =
    previousCommand === null
      ? Promise.resolve("")
      : runCaptured({
          command: previousCommand,
          input: rawInput,
          cwd: root,
          shell: true,
        });
  const fallowRun = runCaptured({
    command: "fallow",
    args: ["--root", root, "impact", "statusline"],
    input: "",
    cwd: root,
    noColor: true,
  });
  const [previousOutput, fallowOutput] = await Promise.all([previousRun, fallowRun]);
  const validFallow =
    fallowOutput !== "" &&
    !fallowOutput.includes("\n") &&
    fallowOutput.startsWith("fallow impact  ")
      ? colorizeStatusline(
          fallowOutput,
          Number.isFinite(Number(process.env.COLUMNS)) ? Number(process.env.COLUMNS) : null,
        )
      : "";
  return [previousOutput, validFallow].filter(Boolean).join("\n");
};

const printJson = (value) => {
  process.stdout.write(stableJson(value));
};

const main = async () => {
  const { command, options } = parseArguments(process.argv.slice(2));
  if (command === "render") {
    if (typeof options.state !== "string") {
      fail("render requires --state");
    }
    const output = await render(options.state);
    if (output !== "") {
      process.stdout.write(`${output}\n`);
    }
    return;
  }

  const scope = normalizedScope(options.scope);
  const root = normalizedRoot(options.root);
  if (command === "inspect") {
    printJson(inspect({ scope, root }));
    return;
  }
  if (command === "install") {
    printJson(
      install({
        scope,
        root,
        mode: options.mode,
        confirm: options.confirm === true,
      }),
    );
    return;
  }
  if (command === "remove") {
    printJson(remove({ scope, root, confirm: options.confirm === true }));
    return;
  }
  fail("Usage: fallow-impact-statusline.mjs inspect|install|remove|render");
};

const isMain =
  process.argv[1] &&
  realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
  main().catch((error) => {
    if (process.argv[2] === "render" && process.env.FALLOW_STATUSLINE_DEBUG !== "1") {
      return;
    }
    process.stderr.write(`fallow-impact-statusline: ${error.message}\n`);
    process.exitCode = 1;
  });
}

export {
  MINIMUM_FALLOW_VERSION,
  colorizeStatusline,
  compactStatusline,
  compareVersions,
  managedSetting,
  parseFallowVersion,
  pathsFor,
  projectKey,
};
