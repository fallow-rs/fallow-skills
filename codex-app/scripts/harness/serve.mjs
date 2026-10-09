/**
 * Local development host for the Fallow Codex app:
 *
 *   npm run harness -- <project folder> [--config <.fallowrc.json>] [--sarif <file.sarif>]
 *
 * Builds the plugin, starts its MCP server over stdio, and serves a page at http://localhost:4517
 * that hosts the app like Codex does. Forms are answered with their defaults after you click Accept.
 */
import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const plugin = resolve(here, "..", "..", "..", "fallow");
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { config: { type: "string" }, sarif: { type: "string" }, port: { type: "string", default: "4517" } },
});
const project = resolve(positionals[0] ?? process.cwd());
const configFile = values.config === undefined ? join(project, ".fallowrc.json") : resolve(values.config);
const sarifFile = values.sarif === undefined ? null : resolve(values.sarif);

const { buildPlugin } = await import("../build.mjs");
await buildPlugin();

const pending = new Map();
const streams = new Set();
let nextId = 1;

const defaults = (schema) =>
  Object.fromEntries(
    Object.entries(schema.properties ?? {}).flatMap(([name, field]) => {
      if (field.default !== undefined) return [[name, field.default]];
      const option = field.oneOf?.[0]?.const ?? field["x-openai-input"]?.options?.[0]?.uri;
      if (option === undefined) return [];
      return [[name, field.type === "array" ? [option] : option]];
    }),
  );

const client = new Client(
  { name: "fallow-harness", version: "1.0.0" },
  { capabilities: { elicitation: { form: {} }, extensions: { "openai/elicitation": { form: {} } } } },
);
client.fallbackRequestHandler = async (request) => {
  if (request.method !== "openai/elicitation/create") throw new Error(`Unsupported ${request.method}`);
  const id = nextId++;
  const answer = new Promise((resolveAnswer) => pending.set(id, resolveAnswer));
  for (const stream of streams) stream.write(`data: ${JSON.stringify({ id, params: request.params })}\n\n`);
  const { action } = await answer;
  return action === "accept" ? { action, content: defaults(request.params.requestedSchema) } : { action };
};
await client.connect(
  new StdioClientTransport({
    command: "node",
    args: [join(plugin, "codex-app", "server.mjs")],
    cwd: plugin,
    env: { ...process.env, FALLOW_CODEX_APP_STATE: join(mkdtempSync(join(tmpdir(), "fallow-harness-")), "state.json") },
    stderr: "inherit",
  }),
);

const scenarios = [
  { id: "sidebar", label: "Sidebar (fullscreen)", tool: "fallow_dashboard", args: { root: project }, mode: "fullscreen", width: 1180 },
  { id: "tab", label: "Thread tab (narrow)", tool: "fallow_code_health", args: { root: project }, mode: "fullscreen", width: 420 },
  { id: "inline", label: "Model result (inline)", tool: "fallow_analyze", args: {}, mode: "inline", width: 720, model: true },
  { id: "audit", label: "Audit (inline)", tool: "fallow_audit", args: {}, mode: "inline", width: 720, model: true },
  { id: "picker", label: "No project", tool: "fallow_dashboard", args: {}, mode: "fullscreen", width: 900 },
  { id: "config", label: "Config file", tool: "fallow_open_config", args: {}, mode: "fullscreen", width: 980, file: configFile },
  ...(sarifFile === null ? [] : [{ id: "sarif", label: "SARIF file", tool: "fallow_open_sarif", args: {}, mode: "fullscreen", width: 980, file: sarifFile }]),
];

const hostScript = await build({
  entryPoints: [join(here, "host.ts")],
  bundle: true,
  write: false,
  format: "iife",
  target: "es2022",
  define: { SCENARIOS: JSON.stringify(scenarios), PROJECT: JSON.stringify(project) },
  logLevel: "warning",
});

const page = `<!doctype html><html><head><meta charset="utf-8"><title>Fallow harness</title><style>
:root{color-scheme:light dark;font:13px ui-sans-serif,system-ui;background:light-dark(#f4f4f4,#0f0f0f);color:light-dark(#111,#eee)}
:root[data-theme=light]{color-scheme:light}:root[data-theme=dark]{color-scheme:dark}
body{margin:0;display:grid;grid-template-columns:220px 1fr 360px;height:100vh}
nav{display:flex;flex-direction:column;gap:6px;padding:12px;border-right:1px solid #8884}
nav button,#theme{all:unset;padding:6px 8px;border-radius:6px;cursor:pointer}nav button:hover,#theme:hover{background:#8882}
main{overflow:auto;padding:24px}#stage{margin:0 auto;background:light-dark(#fff,#181818);border-radius:14px;box-shadow:0 0 0 1px #8883;overflow:hidden}
#stage[data-mode=fullscreen]{height:calc(100vh - 48px)}#stage iframe{display:block;width:100%;border:0}
aside{overflow:auto;border-left:1px solid #8884;padding:8px}pre{white-space:pre-wrap;font-size:11px;margin:4px 0}
dialog{max-width:640px;max-height:80vh}</style></head><body>
<nav id="scenarios"><strong>Scenarios</strong><button id="theme">Toggle theme</button></nav>
<main><div id="stage"></div></main><aside><strong>Host log</strong><div id="log"></div></aside>
<dialog id="form"><p id="form-message"></p><pre id="form-schema"></pre><button id="form-accept">Accept defaults</button> <button id="form-decline">Decline</button></dialog>
<script>${hostScript.outputFiles[0].text}</script></body></html>`;

const etag = (text) => createHash("sha256").update(text).digest("hex").slice(0, 16);
const body = (request) =>
  new Promise((resolveBody) => {
    let data = "";
    request.on("data", (chunk) => (data += chunk));
    request.on("end", () => resolveBody(JSON.parse(data || "{}")));
  });

const rpc = async ({ method, params }) => {
  if (method === "tools/call") return client.callTool(params, undefined, { timeout: 600_000 });
  if (method === "resources/read") return client.readResource(params);
  if (method === "harness/readFile") {
    const text = await readFile(params.path, "utf8").catch(() => "{\n}\n");
    return { text, etag: etag(text) };
  }
  if (method === "harness/writeFile") {
    const existing = await readFile(params.path, "utf8").catch(() => "");
    if (params.ifMatch !== undefined && params.ifMatch !== etag(existing)) return { outcome: "conflict", etag: etag(existing) };
    await writeFile(params.path, params.text);
    return { outcome: "saved", etag: etag(params.text) };
  }
  throw new Error(`Unknown method ${method}`);
};

createServer(async (request, response) => {
  try {
    if (request.url === "/" || request.url?.startsWith("/?")) {
      response.writeHead(200, { "content-type": "text/html" }).end(page);
    } else if (request.url === "/app.html") {
      response.writeHead(200, { "content-type": "text/html" }).end(await readFile(join(plugin, "codex-app", "app.html")));
    } else if (request.url === "/rpc") {
      const result = await rpc(await body(request));
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ result }));
    } else if (request.url === "/elicitations" && request.method === "GET") {
      response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      streams.add(response);
      request.on("close", () => streams.delete(response));
    } else if (request.url === "/elicitations") {
      const answer = await body(request);
      pending.get(answer.id)?.(answer);
      pending.delete(answer.id);
      response.writeHead(204).end();
    } else {
      response.writeHead(404).end();
    }
  } catch (error) {
    response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ error: String(error?.message ?? error) }));
  }
}).listen(Number(values.port), "127.0.0.1", () => {
  console.log(`Fallow harness for ${project}: http://localhost:${values.port}`);
});
