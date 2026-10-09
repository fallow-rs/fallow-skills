import { readFile } from "node:fs/promises";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { SERVER_ICON } from "./icons.ts";
import { registerFallowApp } from "./register.ts";
import { createStateStore } from "./state.ts";

const DEV_VERSION = "0.0.0-dev";

const PluginManifest = z.object({ version: z.string() });

/**
 * Reads the plugin version from the manifest next to the built server.
 * The build does not embed the version, so a version bump does not change the built files.
 */
const pluginVersion = async (): Promise<string> => {
  const manifest = await readFile(new URL("../.codex-plugin/plugin.json", import.meta.url), "utf8")
    .then((text): unknown => JSON.parse(text))
    .catch(() => null);
  const parsed = PluginManifest.safeParse(manifest);
  return parsed.success ? parsed.data.version : DEV_VERSION;
};

const [html, version] = await Promise.all([
  readFile(new URL("./app.html", import.meta.url), "utf8"),
  pluginVersion(),
]);

const server = new McpServer(
  {
    name: "fallow-app",
    title: "Fallow",
    version,
    icons: [SERVER_ICON],
    websiteUrl: "https://fallow.tools",
  },
  {
    capabilities: {
      // Codex then sends the sandbox state and the working directory of the thread on model tool calls.
      experimental: { "codex/sandbox-state-meta": {} },
    },
    instructions:
      "Fallow analyzes TypeScript and JavaScript projects for dead code, unused dependencies, duplication, complexity and architecture problems. Use fallow_analyze for code health questions, fallow_audit before a commit or pull request, and fallow_plan_cleanup when the user wants to clean up. Verify a finding with its verify command before you delete code.",
  },
);

registerFallowApp(server, createStateStore(), html);
await server.connect(new StdioServerTransport());
