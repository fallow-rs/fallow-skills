import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const plugin = new URL("../fallow/", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL(".claude-plugin/plugin.json", plugin), "utf8"));

test("the plugin has no top-level bin directory, which claude.ai and Cowork refuse to install", () => {
  assert.equal(existsSync(new URL("bin", plugin)), false);
});

test("the Claude manifest starts the bundled Fallow app from the plugin root", () => {
  const server = manifest.mcpServers?.["fallow-app"];
  assert.ok(server, "mcpServers.fallow-app is missing");
  assert.equal(server.command, "node");
  const [entry] = server.args;
  assert.match(entry, /^\$\{CLAUDE_PLUGIN_ROOT\}\//);
  const relative = entry.replace("${CLAUDE_PLUGIN_ROOT}/", "");
  assert.ok(existsSync(new URL(relative, plugin)), `${relative} is not in the plugin`);
});

const RUNNER = String.raw`(?:npx|pnpx|bunx|pnpm\s+dlx|yarn\s+dlx|npm\s+(?:exec|x))`;
const FLAGS = String.raw`((?:\s+-{1,2}[\w-]+(?:=\S+)?)*)`;
/** A runner that can download fallow, followed by fallow with no exact version. */
const UNPINNED = new RegExp(
  String.raw`\b${RUNNER}${FLAGS}\s+(?:(?:--package|-p)[=\s]+)?fallow(?:@(?!\d+\.\d+\.\d+(?![\w.-]))\S*)?(?![@\w./-])`,
  "gu",
);
/** These flags run an installed copy and download nothing. */
const NO_DOWNLOAD = /\s--no(?:-install)?(?![\w-])/u;
const PINNED = /\bfallow@(\d+\.\d+\.\d+)\b/gu;
const IMAGE = /\.(png|jpe?g|gif|webp|ico)$/u;
const pluginRoot = fileURLToPath(plugin);
const pluginFiles = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return pluginFiles(path);
    return IMAGE.test(entry.name) ? [] : [path];
  });

const unpinnedLaunchers = (text) =>
  [...text.matchAll(UNPINNED)].filter((match) => !NO_DOWNLOAD.test(match[1] ?? "")).map((match) => match[0]);

test("the launcher guard catches each form that can download fallow", () => {
  for (const form of [
    "npx fallow audit", "npx fallow@latest audit", "npx fallow@3 audit", "npx --yes fallow",
    "npx --prefer-offline fallow", "npx --package fallow fallow-mcp", "npx -p fallow fallow-mcp",
    "npx --package=fallow fallow-mcp", "pnpx fallow", "npm exec fallow", "npm x fallow",
    "bunx --bun fallow", "pnpm dlx fallow", "yarn dlx fallow", "npx  fallow",
  ]) {
    assert.equal(unpinnedLaunchers(form).length, 1, form);
  }
  for (const form of [
    "npx fallow@3.42.0 audit", "npx --no-install fallow", "npx --no fallow-mcp",
    "npx -p fallow@3.42.0 fallow-mcp", "node fallow.js", "npx fallow-mcp@3.42.0",
  ]) {
    assert.deepEqual(unpinnedLaunchers(form), [], form);
  }
});

test("no file in the plugin runs the fallow package without an exact version", () => {
  const found = pluginFiles(pluginRoot).flatMap((path) =>
    readFileSync(path, "utf8")
      .split("\n")
      .flatMap((line, index) =>
        unpinnedLaunchers(line).map((hit) => `${relative(pluginRoot, path)}:${index + 1}: ${hit}`),
      ),
  );
  assert.deepEqual(found, [], "the Claude plugin directory refuses an unpinned launcher");
});

test("the companion's own pins name the fallow release that the app runs through npx", () => {
  const source = readFileSync(new URL("../codex-app/src/server/fallow-cli.ts", import.meta.url), "utf8");
  const [, npxVersion] = /FALLOW_NPX_VERSION = "(\d+\.\d+\.\d+)"/u.exec(source) ?? [];
  assert.ok(npxVersion, "FALLOW_NPX_VERSION is missing");
  const companionOwned = [".cursor-plugin/plugin.json", ...pluginFiles(join(pluginRoot, "skills", "fallow-cloud-setup"))
    .map((path) => relative(pluginRoot, path))];
  for (const file of companionOwned) {
    const pins = [...readFileSync(join(pluginRoot, file), "utf8").matchAll(PINNED)].map((match) => match[1]);
    assert.ok(pins.every((pin) => pin === npxVersion), `${file} pins ${pins.join(", ")}, not ${npxVersion}`);
  }
});

const directory = new URL("../claude-directory/fallow/", import.meta.url);
const DIRECTORY_TYPES = /\.(md|json|ya?ml|txt|png)$|^LICENSE$/u;

test("the directory bundle holds only skills, text and images, and runs nothing", () => {
  const root = fileURLToPath(directory);
  const files = pluginFiles(root).map((path) => relative(root, path));
  assert.ok(files.includes(".claude-plugin/plugin.json"));
  for (const file of files) {
    assert.match(file.split("/").at(-1) ?? "", DIRECTORY_TYPES, `${file} is not a type the directory accepts`);
    assert.ok(!readFileSync(join(root, file), "utf8").startsWith("#!"), `${file} starts with #!`);
    assert.deepEqual(unpinnedLaunchers(readFileSync(join(root, file), "utf8")), [], file);
  }
  const listed = JSON.parse(readFileSync(join(root, ".claude-plugin/plugin.json"), "utf8"));
  for (const field of ["mcpServers", "hooks", "commands", "agents", "lspServers", "bin"]) {
    assert.equal(listed[field], undefined, `the bundle manifest sets ${field}`);
  }
  assert.ok(!files.some((file) => /^(hooks|commands|scripts|bin)\//u.test(file)));
});
