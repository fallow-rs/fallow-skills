import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { after, before, describe, it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ViewPayload } from "../src/shared/contracts.ts";

const plugin = new URL("../../fallow/", import.meta.url);
const server = new URL("codex-app/server.mjs", plugin);
const hasFallow = (() => {
  try {
    execFileSync("fallow", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

/** A small project with one unused file, one unused export and one unused dependency. */
const createProject = (): string => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "fallow-app-e2e-")));
  mkdirSync(join(root, "src"));
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({
      name: "e2e-shop",
      type: "module",
      main: "src/index.ts",
      dependencies: { "left-pad": "1.3.0" },
    }),
  );
  writeFileSync(
    join(root, "src", "index.ts"),
    'import { formatPrice } from "./money";\nconsole.log(formatPrice(1));\n',
  );
  writeFileSync(
    join(root, "src", "money.ts"),
    "export const formatPrice = (value: number): string => `$${value}`;\nexport const parsePrice = (text: string): number => Number(text);\n",
  );
  writeFileSync(join(root, "src", "legacy.ts"), "export const old = 1;\n");
  return root;
};

const view = (result: CallToolResult): ViewPayload => result._meta?.["fallow/view"] as ViewPayload;

describe(
  "fallow-app MCP server",
  { skip: existsSync(server) ? false : "run npm run build first" },
  () => {
    const client = new Client({ name: "e2e", version: "1.0.0" });
    const project = createProject();
    const thread = { threadId: "00000000-0000-4000-8000-000000000042" };

    before(async () => {
      await client.connect(
        new StdioClientTransport({
          command: process.execPath,
          args: [server.pathname],
          cwd: plugin.pathname,
          env: { ...process.env, FALLOW_CODEX_APP_STATE: join(project, ".state.json") } as Record<
            string,
            string
          >,
          stderr: "inherit",
        }),
      );
    });

    after(async () => {
      await client.close();
    });

    it("advertises the sandbox capability and the settings extension", () => {
      const capabilities = client.getServerCapabilities() as
        | Record<string, Record<string, unknown>>
        | undefined;
      assert.ok(capabilities?.["experimental"]?.["codex/sandbox-state-meta"] !== undefined);
      assert.deepEqual(capabilities?.["extensions"]?.["openai/settings"], {
        readTool: "fallow_settings_read",
        updateTool: "fallow_settings_update",
      });
    });

    it("registers each entrypoint once, app-only, with a monochrome icon", async () => {
      const { tools } = await client.listTools();
      const entrypoints = tools.flatMap((tool) => {
        const ui = (tool._meta?.["openai/ui"] ?? {}) as { entrypoints?: Array<{ type: string }> };
        return (ui.entrypoints ?? []).map((entrypoint) => ({ tool, type: entrypoint.type }));
      });
      assert.deepEqual(entrypoints.map((entry) => entry.type).sort(), [
        "file",
        "file",
        "global",
        "thread",
      ]);
      for (const { tool } of entrypoints) {
        assert.deepEqual((tool._meta?.["ui"] as { visibility?: string[] }).visibility, ["app"]);
        assert.ok(
          tool.icons?.[0]?.src.startsWith("data:image/svg+xml"),
          `${tool.name} has no icon`,
        );
        assert.ok(tool.title !== undefined && tool.title.length > 0);
      }
      const appOnly = tools.filter((tool) => tool.name.startsWith("fallow_app_"));
      assert.ok(
        appOnly.every(
          (tool) => (tool._meta?.["ui"] as { visibility?: string[] }).visibility?.join() === "app",
        ),
      );
    });

    it("shows the picker when no project is known", async () => {
      const result = (await client.callTool({
        name: "fallow_dashboard",
        arguments: {},
      })) as CallToolResult;
      assert.equal(view(result).view, "picker");
    });

    it(
      "analyzes the thread project for a model call",
      { skip: hasFallow ? false : "fallow is not installed" },
      async () => {
        const result = (await client.callTool({
          name: "fallow_analyze",
          arguments: {},
          _meta: {
            ...thread,
            "codex/sandbox-state-meta": { sandboxCwd: pathToFileURL(project).href },
          },
        })) as CallToolResult;
        const payload = view(result);
        assert.equal(payload.view, "dashboard");
        if (payload.view !== "dashboard") return;
        assert.equal(payload.report.project.name, "e2e-shop");
        const rules = new Set(payload.report.findings.map((finding) => finding.rule));
        assert.ok(
          rules.has("unused-file") && rules.has("unused-export") && rules.has("unused-dependency"),
        );

        const summary = result.structuredContent as {
          findings: unknown[];
          totals: { findings: number };
        };
        assert.equal(summary.totals.findings, payload.report.counts.total);
        assert.ok(
          JSON.stringify(summary).length < JSON.stringify(payload).length,
          "the model reads less than the app",
        );
      },
    );

    it(
      "opens the thread tab on the same project",
      { skip: hasFallow ? false : "fallow is not installed" },
      async () => {
        const result = (await client.callTool({
          name: "fallow_code_health",
          arguments: {},
          _meta: thread,
        })) as CallToolResult;
        const payload = view(result);
        assert.ok(payload.view === "dashboard" || payload.view === "loading");
        if (payload.view === "dashboard") assert.equal(payload.report.project.root, project);
      },
    );

    it(
      "finds findings for @ mentions and reads them as resources",
      { skip: hasFallow ? false : "fallow is not installed" },
      async () => {
        const search = (await client.callTool({
          name: "search_mentions",
          arguments: { query: "parse" },
          _meta: thread,
        })) as CallToolResult;
        const items = (
          search.structuredContent as { items: Array<{ resourceUri?: string; title: string }> }
        ).items;
        const item = items.find((candidate) => candidate.resourceUri?.includes("/finding/"));
        assert.ok(item?.resourceUri !== undefined, JSON.stringify(items));
        assert.match(item.title, /parsePrice/);
        const resource = await client.readResource({ uri: item.resourceUri });
        const text = (resource.contents[0] as { text: string }).text;
        assert.match(text, /fallow dead-code --trace src\/money\.ts:parsePrice/);
      },
    );

    it("refuses resource reads for a project the user never opened", async () => {
      const stranger = Buffer.from("/etc", "utf8").toString("base64url");
      await assert.rejects(client.readResource({ uri: `fallow://project/${stranger}/report` }));
    });

    it("refuses app reads and runs for a folder that no server call resolved", async () => {
    const source = (await client.callTool({
      name: "fallow_app_source",
      arguments: { root: "/etc", path: "hosts", line: 1 },
    })) as CallToolResult;
    assert.deepEqual(source.structuredContent, { found: false });
    const run = (await client.callTool({ name: "fallow_app_run", arguments: { root: "/etc" } })) as CallToolResult;
    assert.equal(view(run).view, "picker");
  });

  it("ignores sandbox state that an app-facing call carries", async () => {
    const marker = join(project, "forged-codex-ran");
    const forged = join(project, "codex");
    writeFileSync(forged, `#!/bin/sh\ntouch '${marker}'\n`);
    chmodSync(forged, 0o755);
    await client.callTool({
      name: "fallow_app_run",
      arguments: { root: project, force: true },
      _meta: { ...thread, "codex/sandbox-state-meta": { codexExecutable: forged, sandboxCwd: "file:///" } },
    });
    assert.equal(existsSync(marker), false);
  });

  it("keeps a model path inside the thread directory", async () => {
    const result = (await client.callTool({
      name: "fallow_analyze",
      arguments: { path: "/" },
      _meta: { ...thread, "codex/sandbox-state-meta": { sandboxCwd: pathToFileURL(project).href } },
    })) as CallToolResult;
    assert.equal(view(result).view, "picker");
  });

  it("reads source lines only for files in the report", { skip: hasFallow ? false : "fallow is not installed" }, async () => {
    const listed = (await client.callTool({
      name: "fallow_app_source",
      arguments: { root: project, path: "src/money.ts", line: 2 },
    })) as CallToolResult;
    assert.equal((listed.structuredContent as { found: boolean }).found, true);
    const unlisted = (await client.callTool({
      name: "fallow_app_source",
      arguments: { root: project, path: "src/index.ts", line: 1 },
    })) as CallToolResult;
    assert.deepEqual(unlisted.structuredContent, { found: false });
  });

  it("stores settings and validates them", async () => {
      const updated = (await client.callTool({
        name: "fallow_settings_update",
        arguments: { set: { scope: "changed" } },
      })) as CallToolResult;
      assert.equal(
        (updated.structuredContent as { values: { scope: string } }).values.scope,
        "changed",
      );
      const rejected = (await client.callTool({
        name: "fallow_settings_update",
        arguments: { set: { baseRef: "--evil" } },
      })) as CallToolResult;
      assert.equal(rejected.isError, true);
    });

    it("tells the model when Codex declines a form without showing it", { skip: hasFallow ? false : "fallow is not installed" }, async () => {
      const declining = new Client(
        { name: "full-access-host", version: "1.0.0" },
        { capabilities: { extensions: { "openai/elicitation": { form: {} } } } as never },
      );
      declining.fallbackRequestHandler = async () => ({ action: "decline" });
      await declining.connect(
        new StdioClientTransport({
          command: process.execPath,
          args: [server.pathname],
          cwd: plugin.pathname,
          env: { ...process.env, FALLOW_CODEX_APP_STATE: join(project, ".state-2.json") } as Record<string, string>,
          stderr: "inherit",
        }),
      );
      try {
        const result = (await declining.callTool({
          name: "fallow_plan_cleanup",
          arguments: {},
          _meta: { "codex/sandbox-state-meta": { sandboxCwd: pathToFileURL(project).href } },
        })) as CallToolResult;
        const summary = result.structuredContent as { status: string; categories: Record<string, number> };
        assert.equal(summary.status, "form_not_shown");
        assert.ok((summary.categories["dead-code"] ?? 0) > 0);
      } finally {
        await declining.close();
      }
    });
  },
);
