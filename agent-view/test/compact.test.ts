import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { compactStatusLine, parseCompact } from "../src/compact.ts";

const text = (name: string): string =>
  readFileSync(new URL(`../fixtures/${name}.txt`, import.meta.url), "utf8");

describe("parseCompact", () => {
  it("reads the header, findings and production lines", () => {
    const view = parseCompact(text("ok"));
    assert.equal(view.path, "src/services/user.ts");
    assert.deepEqual(
      view.lines.map((line) => line.kind),
      ["finding", "finding", "prod", "prod", "prod"],
    );
    assert.deepEqual(view.findings, 2);
    assert.deepEqual(view.prod, {
      called: 1,
      neverCalled: 1,
      untracked: 1,
      unpaired: 0,
      errorGroups: 1,
    });
    assert.equal(view.cloud, null);
    assert.equal(view.truncated, null);
  });

  it("reads a cloud status line and a truncation line", () => {
    const view = parseCompact(`${text("plan-required")}truncated 4 more\n`);
    assert.deepEqual(view.cloud, {
      status: "plan_required",
      text: "production data needs a Fallow Cloud plan",
    });
    assert.equal(view.truncated, 4);
  });

  it("gives an empty view for empty or foreign text", () => {
    assert.equal(parseCompact("").path, null);
    assert.equal(parseCompact("Error: inspect supports --format json or human").path, null);
  });
});

describe("compactStatusLine", () => {
  it("sums up the file in one short line", () => {
    assert.equal(
      compactStatusLine(parseCompact(text("ok"))),
      "fallow user.ts: 2 findings | prod 1 called, 1 never_called, 1 untracked, 1 error group",
    );
    assert.equal(
      compactStatusLine(parseCompact(text("unpaired"))),
      "fallow user.ts: 2 findings | prod 1 called, 1 never_called, 1 new, 1 error group",
    );
  });

  it("names a cloud status instead of production numbers", () => {
    assert.equal(
      compactStatusLine(parseCompact(text("no-key"))),
      "fallow user.ts: 2 findings | cloud no_key",
    );
  });

  it("gives nothing for text that is not compact output", () => {
    assert.equal(compactStatusLine(parseCompact("")), null);
  });
});
