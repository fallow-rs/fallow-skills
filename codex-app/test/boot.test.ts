import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BOOT_NOTE_AFTER_MS, bootNote } from "../src/app/boot.ts";

describe("boot note", () => {
  it("stays hidden while a normal analysis runs", () => {
    assert.equal(bootNote(0), null);
    assert.equal(bootNote(BOOT_NOTE_AFTER_MS - 1), null);
  });

  it("explains a long wait without saying that the result already arrived", () => {
    const note = bootNote(BOOT_NOTE_AFTER_MS);
    assert.ok(note !== null);
    assert.match(note, /Still waiting/);
    assert.match(note, /only in the conversation/);
  });
});
