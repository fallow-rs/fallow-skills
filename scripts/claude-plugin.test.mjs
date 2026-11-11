import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

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
