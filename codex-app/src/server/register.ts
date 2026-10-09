import { createHash } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createSettings, type OpenAIUiResourceMetadata } from "@openai/mcp-extensions/server";
import { RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { createAnalyzer } from "./analysis.ts";
import { registerAppTools } from "./app-tools.ts";
import type { ServerContext } from "./context.ts";
import { registerForms } from "./forms.ts";
import { registerMentions } from "./mentions.ts";
import { SettingsSchema, type StateStore } from "./state.ts";
import { decorateToolIcons } from "./tool-icons.ts";
import { registerTools } from "./tools.ts";
import { AUDIT_ICON, SIDEBAR_ICON } from "./icons.ts";

const registerSettings = (context: ServerContext): void => {
  const shape = SettingsSchema.shape;
  createSettings(context.server).register({
    readTool: "fallow_settings_read",
    updateTool: "fallow_settings_update",
    fields: {
      scope: {
        schema: shape.scope,
        title: "Default scope",
        description:
          "full analyzes the whole project. changed analyzes files changed since the base branch.",
      },
      baseRef: {
        schema: shape.baseRef,
        title: "Base branch",
        description:
          "Git ref for changed-file runs and audits. Leave it empty to detect the default branch.",
      },
      production: {
        schema: shape.production,
        title: "Production code only",
        description: "Leave out tests, stories and dev tooling.",
      },
      source: {
        schema: shape.source,
        title: "Fallow binary",
        description:
          "auto uses fallow on PATH. In a Codex sandbox it prefers the project copy and falls back to npx, which needs network access.",
      },
      sandbox: {
        schema: shape.sandbox,
        title: "Use the Codex sandbox",
        description: "Run fallow inside the sandbox of the thread when Codex provides one.",
      },
      findingsForCodex: {
        schema: shape.findingsForCodex,
        title: "Findings sent to Codex",
        description:
          "How many findings a result gives the model. The dashboard always shows them all.",
      },
    },
    layout: [
      {
        kind: "group",
        title: "Analysis",
        items: [
          { kind: "property", property: "scope" },
          { kind: "property", property: "baseRef" },
          { kind: "property", property: "production" },
        ],
      },
      {
        kind: "group",
        title: "Codex",
        items: [
          { kind: "property", property: "findingsForCodex" },
          {
            kind: "tool",
            tool: "fallow_dashboard",
            title: "Open Fallow",
            description: "Open the dashboard.",
          },
        ],
      },
      {
        kind: "group",
        title: "Installation",
        items: [
          { kind: "property", property: "source" },
          { kind: "property", property: "sandbox" },
          {
            kind: "tool",
            tool: "fallow_check_install",
            title: "Check installation",
            description: "Show the fallow version that the plugin uses.",
          },
        ],
      },
    ],
    read: () => context.store.settings(),
    update: (set) => context.store.updateSettings(set),
  });
};

/** Registers every tool, form, mention handler, resource and setting on one server. */
export const registerFallowApp = (
  server: McpServer,
  store: StateStore,
  html: string,
): ServerContext => {
  // A content hash in the URI makes the host fetch the app again after a plugin update.
  const uiUri = `ui://fallow/app-${createHash("sha256").update(html).digest("hex").slice(0, 12)}.html`;
  const context: ServerContext = { server, store, analyzer: createAnalyzer(), uiUri };

  server.registerResource(
    "fallow-app",
    uiUri,
    { title: "Fallow", mimeType: RESOURCE_MIME_TYPE },
    async () => ({
      contents: [
        {
          uri: uiUri,
          mimeType: RESOURCE_MIME_TYPE,
          text: html,
          _meta: {
            "openai/ui": {
              preferredDisplayMode: "inline",
              availableDisplayModes: ["inline", "fullscreen"],
            } satisfies OpenAIUiResourceMetadata,
            ui: { prefersBorder: true, csp: { connectDomains: [], resourceDomains: [] } },
          },
        },
      ],
    }),
  );

  registerTools(context);
  registerAppTools(context);
  registerForms(context);
  registerMentions(context);
  registerSettings(context);
  decorateToolIcons(server, {
    fallow_dashboard: [SIDEBAR_ICON],
    fallow_code_health: [SIDEBAR_ICON],
    fallow_open_config: [SIDEBAR_ICON],
    fallow_open_sarif: [SIDEBAR_ICON],
    fallow_audit: [AUDIT_ICON],
  });
  return context;
};
