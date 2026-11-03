import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

const skillsRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "fallow", "skills");
const runtimeData = join(skillsRoot, "fallow-review", "references", "production-runtime-data.md");
const cloudSetup = join(skillsRoot, "fallow-cloud-setup", "SKILL.md");
const extraSignals = join(skillsRoot, "fallow-cloud-setup", "references", "extra-signals.md");
const hookDoc = join(skillsRoot, "fallow-cloud-setup", "references", "file-context-hook.md");

const scratch = realpathSync(mkdtempSync(join(tmpdir(), "cloud-docs-test-")));
after(() => rmSync(scratch, { recursive: true, force: true }));

const read = (path) => readFileSync(path, "utf8");

// Gives the body of each fenced block with the language tag, without the indent of a list item.
const codeBlocks = (markdown, language) =>
  [...markdown.matchAll(new RegExp("^( *)```" + language + "\\n([\\s\\S]*?)\\n\\1```", "gm"))].map(([, indent, body]) =>
    body
      .split("\n")
      .map((line) => (line.startsWith(indent) ? line.slice(indent.length) : line))
      .join("\n"),
  );

const backtickedNames = (text) => [...text.matchAll(/`([a-z_]+)`/g)].map((match) => match[1]);

// The sentence that names the tools of both servers, up to the first period after the colon.
const sharedTools = () => {
  const text = read(runtimeData);
  const match = text.match(/tools have the same names and arguments on both servers:([^.]*)\./);
  assert.ok(match, "the shared tool sentence is missing");
  return backtickedNames(match[1]);
};

const hostedOnlyTools = () => {
  const text = read(runtimeData);
  const start = text.indexOf("The hosted-only tools:");
  assert.notEqual(start, -1, "the hosted-only tool table is missing");
  const table = text.slice(start).split("\n\n")[1];
  return table
    .split("\n")
    .slice(2)
    .map((row) => row.split("|")[2].trim().replaceAll("`", ""));
};

test("list_repos is a hosted-only tool, because the local server has no list_repos", () => {
  assert.deepEqual(sharedTools(), ["get_cloud_runtime_context", "get_cloud_review_packet", "get_cloud_deployment_changes"]);
  assert.ok(hostedOnlyTools().includes("list_repos"));
});

test("the shared tools exist on the local fallow server", { skip: process.env.FALLOW_BIN ? false : "set FALLOW_BIN" }, () => {
  const requests = [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } } },
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { jsonrpc: "2.0", id: 2, method: "tools/list" },
  ];
  const result = spawnSync(process.env.FALLOW_BIN, ["mcp-server"], {
    input: requests.map((request) => JSON.stringify(request)).join("\n") + "\n",
    encoding: "utf8",
    timeout: 20_000,
  });
  const reply = result.stdout
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line))
    .find((message) => message.id === 2);
  assert.ok(reply, `no tools/list reply: ${result.stderr}`);
  const local = new Set(reply.result.tools.map((tool) => tool.name));
  for (const name of sharedTools()) assert.ok(local.has(name), `${name} is not a local tool`);
  for (const name of hostedOnlyTools()) assert.ok(!local.has(name), `${name} is a local tool`);
});

test("the cloud setup skill links the extra signals and the file view hook", () => {
  const skill = read(cloudSetup);
  assert.match(skill, /\(references\/extra-signals\.md\)/);
  assert.match(skill, /\(references\/file-context-hook\.md\)/);
});

test("each extra signal names its beacon entry and its key", () => {
  const text = read(extraSignals);
  for (const name of [
    "withErrorCapture",
    "@fallow-cli/beacon/errors",
    "createCpuProfiler",
    "@fallow-cli/beacon/profiler",
    "createBrowserPerformance",
    "@fallow-cli/beacon/performance",
    "captureBlocks",
    "withBlockCapture",
    "@fallow-cli/beacon/browser-blocks",
    "withScriptChunks",
    "@fallow-cli/beacon/script-chunks",
    "fallow_pub_k1_",
    "fallow_live_k1_",
  ]) {
    assert.ok(text.includes(name), `${name} is missing`);
  }
  // A browser bundle never gets a full key.
  for (const block of codeBlocks(text, "ts")) {
    if (block.includes("@fallow-cli/beacon/browser") || block.includes("@fallow-cli/beacon/performance")) {
      assert.ok(!block.includes("fallow_live_k1_"), block);
    }
  }
});

// The hook ---------------------------------------------------------------

const hookSource = () => {
  const blocks = codeBlocks(read(hookDoc), "js");
  assert.equal(blocks.length, 1, "the hook page has one js block");
  return blocks[0];
};

test("the settings snippet runs the hook after Read, Edit and Write", () => {
  const [settings] = codeBlocks(read(hookDoc), "json").map((block) => JSON.parse(block));
  const [group] = settings.hooks.PostToolUse;
  assert.equal(group.matcher, "Read|Edit|Write");
  assert.equal(group.hooks[0].type, "command");
  assert.match(group.hooks[0].command, /fallow-file-context\.mjs/);
  assert.ok(group.hooks[0].timeout >= 3);
});

let caseCounter = 0;

const makeCase = ({ output = "fallow src/a.ts\n", exit = 0, withFallow = true } = {}) => {
  caseCounter += 1;
  const root = join(scratch, `case-${caseCounter}`);
  const bin = join(root, "bin");
  mkdirSync(bin, { recursive: true });
  const hook = join(root, "fallow-file-context.mjs");
  writeFileSync(hook, hookSource());
  const calls = join(root, "calls.log");
  if (withFallow) {
    for (const tool of ["bash", "cat"]) {
      symlinkSync(spawnSync("bash", ["-c", `command -v ${tool}`], { encoding: "utf8" }).stdout.trim(), join(bin, tool));
    }
    const fake = join(bin, "fallow");
    writeFileSync(
      fake,
      ["#!/usr/bin/env bash", `printf '%s\\n' "$*" >> '${calls}'`, "cat <<'TEXT'", output, "TEXT", `exit ${exit}`, ""].join("\n"),
    );
    chmodSync(fake, 0o755);
  }
  return { root, bin, hook, calls };
};

const runHook = (fixture, input) =>
  spawnSync(process.execPath, [fixture.hook], {
    cwd: fixture.root,
    encoding: "utf8",
    input: typeof input === "string" ? input : JSON.stringify(input),
    env: { PATH: fixture.bin, HOME: fixture.root },
  });

const toolInput = (filePath) => ({
  hook_event_name: "PostToolUse",
  tool_name: "Read",
  tool_input: { file_path: filePath },
  cwd: scratch,
});

const fallowCalls = (fixture) => (existsSync(fixture.calls) ? read(fixture.calls).trim().split("\n") : []);

test("a source file gets the compact inspect text as additional context", () => {
  const text = "fallow src/a.ts\nprod main called 12 calls";
  const fixture = makeCase({ output: text });
  const result = runHook(fixture, toolInput("/repo/src/a.ts"));
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: text },
  });
  assert.deepEqual(fallowCalls(fixture), ["inspect --file /repo/src/a.ts --cloud --format compact --quiet"]);
});

test("a file that is not source code runs no fallow", () => {
  const fixture = makeCase();
  const result = runHook(fixture, toolInput("/repo/README.md"));
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "");
  assert.deepEqual(fallowCalls(fixture), []);
});

test("a failed fallow run adds nothing", () => {
  const fixture = makeCase({ exit: 2 });
  const result = runHook(fixture, toolInput("/repo/src/a.ts"));
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "");
});

test("empty fallow output adds nothing", () => {
  const fixture = makeCase({ output: "" });
  const result = runHook(fixture, toolInput("/repo/src/a.ts"));
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "");
});

test("a missing fallow binary adds nothing", () => {
  const fixture = makeCase({ withFallow: false });
  const result = runHook(fixture, toolInput("/repo/src/a.ts"));
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "");
});

test("input that is not JSON adds nothing", () => {
  const fixture = makeCase();
  const result = runHook(fixture, "not json");
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "");
  assert.deepEqual(fallowCalls(fixture), []);
});
