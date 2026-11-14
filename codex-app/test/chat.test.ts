import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Finding, ProjectRef } from "../../agent-view/src/contracts.ts";
import { assistantName, MAX_PLAIN_MESSAGE, plainMessage } from "../src/app/chat.ts";

const project = { name: "shop", root: "/work/shop" } as ProjectRef;

const finding = (index: number, message = "Export is never imported"): Finding =>
  ({
    id: `f${index}`,
    rule: "unused-export",
    level: "warn",
    path: `src/file-${index}.ts`,
    line: 3,
    message,
    verify: `fallow dead-code --file src/file-${index}.ts`,
  }) as Finding;

describe("plain chat message", () => {
  it("puts the instruction, each finding and the project in one text", () => {
    const text = plainMessage("Fix these findings.", [finding(1), finding(2)], project);
    assert.match(text, /^Fix these findings\./);
    assert.match(text, /f1 \(unused-export, warn\) at src\/file-1\.ts:3/);
    assert.match(text, /Verify with: fallow dead-code --file src\/file-2\.ts/);
    assert.match(text, /shop at \/work\/shop/);
  });

  it("stays inside the host limits for length and blank lines", () => {
    const long = Array.from({ length: 200 }, (_, index) => finding(index, "x".repeat(200)));
    const text = plainMessage("Fix these findings.", long, project);
    assert.ok(text.length <= MAX_PLAIN_MESSAGE, `length ${text.length}`);
    assert.doesNotMatch(text, /\n{4,}/);
    assert.match(text, /And \d+ more findings/);
    assert.match(text, /shop at \/work\/shop/);
  });
});

describe("assistant name", () => {
  it("names Codex when the OpenAI message extension is present", () => {
    assert.equal(assistantName(undefined, true), "Codex");
  });

  it("names Claude from the host name", () => {
    assert.equal(assistantName("Claude Desktop", false), "Claude");
  });

  it("names no assistant for an unknown host", () => {
    assert.equal(assistantName("some-host", false), null);
  });
});
