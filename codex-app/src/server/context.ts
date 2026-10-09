import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type {
  CallToolResult,
  ServerNotification,
  ServerRequest,
} from "@modelcontextprotocol/sdk/types.js";
import type { FallowProblem, ProjectRef, ViewPayload } from "../shared/contracts.ts";
import { VIEW_META_KEY } from "../shared/view-meta.ts";
import type { Analyzer } from "./analysis.ts";
import type { StateStore } from "./state.ts";

export type Extra = RequestHandlerExtra<ServerRequest, ServerNotification>;

export interface ServerContext {
  server: McpServer;
  store: StateStore;
  analyzer: Analyzer;
  /** The `ui://` URI of the one app resource that renders every view. */
  uiUri: string;
}

/**
 * A tool result with three audiences: `structuredContent` for Codex (the model reads it),
 * `content` for MCP clients that only read text, and `_meta` with the full view for the app.
 */
export const viewResult = (
  view: ViewPayload,
  summary: Record<string, unknown>,
  text: string,
): CallToolResult => ({
  content: [{ type: "text", text }],
  structuredContent: summary,
  _meta: { [VIEW_META_KEY]: view },
});

export const problemResult = (problem: FallowProblem, project: ProjectRef | null): CallToolResult =>
  viewResult(
    { view: "problem", problem, project },
    {
      error: problem.code,
      title: problem.title,
      detail: problem.detail,
      ...(problem.fix === null ? {} : { fix: problem.fix }),
    },
    `${problem.title}. ${problem.detail}${problem.fix === null ? "" : ` Fix: ${problem.fix}`}`,
  );

/** A plain result for app-only tools. The app reads `structuredContent`. */
export const dataResult = (data: Record<string, unknown>): CallToolResult => ({
  content: [],
  structuredContent: data,
});

export const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: false,
} as const;
