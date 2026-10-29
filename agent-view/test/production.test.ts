import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { parseCompact } from "../src/compact.ts";
import {
  functionText,
  productionFromProblem,
  productionLines,
  readInspect,
  statusSentence,
  type ProductionView,
} from "../src/production.ts";

const json = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url), "utf8"));
const text = (name: string): string =>
  readFileSync(new URL(`../fixtures/${name}.txt`, import.meta.url), "utf8");

const production = (name: string): ProductionView => readInspect(json(name)).production;

describe("readInspect", () => {
  it("reads the file, the static sections and an ok cloud section", () => {
    const view = readInspect(json("ok"));
    assert.equal(view.path, "src/services/user.ts");
    assert.deepEqual(
      view.sections.map((section) => `${section.name}:${section.status}`),
      ["trace_file:ok", "dead_code:ok", "complexity:ok"],
    );
    const cloud = view.production;
    assert.equal(cloud.status, "ok");
    if (cloud.status !== "ok") return;
    assert.equal(cloud.repo, "fallow-cloud");
    assert.equal(cloud.periodDays, 30);
    assert.equal(cloud.summary?.calls, 4120);
    assert.deepEqual(
      cloud.functions.map((fn) => [fn.name, fn.line, fn.match, fn.state]),
      [
        ["loadUser", 14, "stable_id", "called"],
        ["parseRow", 60, "name_ordinal", "never_called"],
        ["formatUser", 42, "stable_id", "untracked"],
      ],
    );
  });

  it("keeps a value that the cloud did not measure as null, never as zero", () => {
    const cloud = production("ok");
    assert.equal(cloud.status, "ok");
    if (cloud.status !== "ok") return;
    const untracked = cloud.functions.find((fn) => fn.name === "formatUser");
    assert.ok(untracked !== undefined);
    assert.equal(untracked.calls, null);
    assert.equal(untracked.errors, null);
    assert.equal(untracked.cpuMsPerHour, null);
    assert.equal(untracked.neverRunRanges, null);
    assert.doesNotMatch(functionText(untracked, cloud.periodDays), /\b0\b/);
  });

  it("lists a local function that has no production pair, with its note", () => {
    const cloud = production("unpaired");
    assert.equal(cloud.status, "ok");
    if (cloud.status !== "ok") return;
    assert.deepEqual(cloud.unpaired, [
      { name: "newHelper", line: 80, note: "no production data (new or moved since deploy)" },
    ]);
  });

  for (const [name, status] of [
    ["no-key", "no_key"],
    ["untracked", "untracked"],
    ["plan-required", "plan_required"],
  ] as const) {
    it(`reads the ${status} status and its message, with no numbers`, () => {
      const cloud = production(name);
      assert.equal(cloud.status, status);
      assert.ok(cloud.message.length > 0);
      assert.deepEqual(productionLines(cloud), [`cloud ${status}: ${cloud.message}`]);
    });
  }

  it("reports a run without the cloud section as not requested", () => {
    const envelope = json("ok") as { evidence: Record<string, unknown> };
    delete envelope.evidence["cloud"];
    const cloud = readInspect(envelope).production;
    assert.equal(cloud.status, "not_requested");
  });

  it("accepts a cloud section that wraps its fields in data", () => {
    const envelope = json("ok") as { evidence: Record<string, unknown> };
    const { status, ...rest } = envelope.evidence["cloud"] as Record<string, unknown>;
    envelope.evidence["cloud"] = { status, scope: "file", data: rest };
    const cloud = readInspect(envelope).production;
    assert.equal(cloud.status, "ok");
    if (cloud.status === "ok") assert.equal(cloud.functions.length, 3);
  });

  it("turns an unknown status into unavailable, and never trusts a non-object", () => {
    const envelope = json("ok") as { evidence: Record<string, unknown> };
    envelope.evidence["cloud"] = { status: "exploded", message: null };
    assert.equal(readInspect(envelope).production.status, "unavailable");
    assert.equal(readInspect("nonsense").production.status, "not_requested");
    assert.equal(readInspect(null).path, null);
  });
});

describe("productionLines", () => {
  for (const name of ["ok", "unpaired", "no-key", "untracked", "plan-required"]) {
    it(`gives the same production lines as the compact text of the ${name} fixture`, () => {
      const expected = parseCompact(text(name))
        .lines.filter((line) => line.kind === "prod" || line.kind === "cloud")
        .map((line) => line.raw);
      assert.deepEqual(productionLines(production(name)), expected);
    });
  }
});

describe("productionFromProblem", () => {
  it("names a fallow release without --cloud, and asks for an update", () => {
    const view = productionFromProblem({
      code: "fallow_error",
      title: "Fallow stopped with an error",
      detail:
        "error: unexpected argument '--cloud' found\n\nUsage: fallow inspect --file <PATH>\n\nFor more information, try '--help'.",
      fix: "fallow doctor",
    });
    assert.equal(view.status, "cli_unsupported");
    assert.match(statusSentence(view), /^This fallow version has no --cloud option/);
  });

  it("keeps another failure as cli_failed with its first line", () => {
    const view = productionFromProblem({
      code: "fallow_error",
      title: "Fallow stopped with an error",
      detail: "file 'src/x.ts' not found in module graph\nmore",
      fix: null,
    });
    assert.equal(view.status, "cli_failed");
    assert.equal(
      statusSentence(view),
      "Fallow inspect failed: file 'src/x.ts' not found in module graph.",
    );
  });
});
