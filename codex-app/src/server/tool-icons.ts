import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  ListToolsRequestSchema,
  type Icon,
  type ListToolsResult,
} from "@modelcontextprotocol/sdk/types.js";

type Handler = (request: unknown, extra: unknown) => Promise<unknown>;

/**
 * Adds `icons` to entries of `tools/list`. The MCP spec allows tool icons, and the host shows them
 * on entrypoints, but `McpServer.registerTool` has no `icons` option yet. Call this after the last
 * `registerTool`. If the SDK internals change, tools keep working and fall back to the server icon.
 */
export const decorateToolIcons = (server: McpServer, icons: Record<string, Icon[]>): void => {
  const handlers = (server.server as unknown as { _requestHandlers?: Map<string, Handler> })
    ._requestHandlers;
  const original = handlers?.get(ListToolsRequestSchema.shape.method.value);
  if (original === undefined) return;
  server.server.setRequestHandler(ListToolsRequestSchema, async (request, extra) => {
    const result = (await original(request, extra)) as ListToolsResult;
    return {
      ...result,
      tools: result.tools.map((tool) => {
        const toolIcons = icons[tool.name];
        return toolIcons === undefined ? tool : { ...tool, icons: toolIcons };
      }),
    };
  });
};
