import { readFile } from "node:fs/promises";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SERVER_ICON } from "./icons.ts";
import { registerFallowApp } from "./register.ts";
import { createStateStore } from "./state.ts";

declare const __FALLOW_APP_VERSION__: string;

const html = await readFile(new URL("./app.html", import.meta.url), "utf8");

const server = new McpServer(
  {
    name: "fallow-app",
    title: "Fallow",
    version: typeof __FALLOW_APP_VERSION__ === "string" ? __FALLOW_APP_VERSION__ : "0.0.0-dev",
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
