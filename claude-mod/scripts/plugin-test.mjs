import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildMod, buildTest } from "./build.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const source = join(here, "..");
const plugin = join(source, "..", "fallow");

/**
 * `claude plugin test` runs the `*.test.ts` files of a plugin folder. The tests do not ship with
 * the plugin, so this script stages the manifest, the README, hooks.json with the module, the built
 * mod and the bundled tests in a temporary folder and runs Claude Code there. Set CLAUDE_BIN to test
 * another Claude Code build.
 */
const stage = mkdtempSync(join(tmpdir(), "fallow-mod-test-"));
try {
  mkdirSync(join(stage, ".claude-plugin"), { recursive: true });
  mkdirSync(join(stage, "hooks"), { recursive: true });
  cpSync(join(plugin, ".claude-plugin", "plugin.json"), join(stage, ".claude-plugin", "plugin.json"));
  // The staged hooks.json adds the module next to the commit gate of the plugin.
  const hooks = JSON.parse(readFileSync(join(plugin, "hooks", "hooks.json"), "utf8"));
  writeFileSync(join(stage, "hooks", "hooks.json"), `${JSON.stringify({ ...hooks, modules: ["./fallow-mod.ts"] }, null, 2)}\n`);
  cpSync(join(plugin, "hooks", "fallow-gate.sh"), join(stage, "hooks", "fallow-gate.sh"));
  cpSync(join(plugin, "README.md"), join(stage, "README.md"));
  await buildMod(join(stage, "hooks"));
  for (const name of readdirSync(join(source, "test")).filter((file) => file.endsWith(".test.ts"))) {
    await buildTest(join(source, "test", name), join(stage, "test", name));
  }
  const claude = process.env.CLAUDE_BIN ?? "claude";
  for (const args of [["plugin", "validate", stage], ["plugin", "test", stage]]) {
    const result = spawnSync(claude, args, { stdio: "inherit" });
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
} finally {
  rmSync(stage, { recursive: true, force: true });
}
