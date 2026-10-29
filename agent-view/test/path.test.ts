import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { relativePath } from "../src/path.ts";

describe("relativePath", () => {
  it("makes a POSIX path relative to the root", () => {
    assert.equal(relativePath("/project", "/project/src/a.ts"), "src/a.ts");
    assert.equal(relativePath("/project/", "/project/src/./b/../a.ts"), "src/a.ts");
    assert.equal(relativePath("/project", "/project"), "");
    assert.equal(relativePath("/project", "/other/a.ts"), "../other/a.ts");
  });

  it("keeps a relative path and uses forward slashes", () => {
    assert.equal(relativePath("/project", "src/a.ts"), "src/a.ts");
    assert.equal(relativePath("C:\\project", "src\\a.ts"), "src/a.ts");
  });

  it("makes a Windows path relative, with the drive letter in any case", () => {
    assert.equal(relativePath("C:\\project", "c:\\project\\src\\a.ts"), "src/a.ts");
    assert.equal(relativePath("C:\\project", "D:\\other\\a.ts"), "D:/other/a.ts");
  });
});

describe("agent-view sources", () => {
  it("import no node: module, so both hosts can bundle them", () => {
    const folder = new URL("../src/", import.meta.url);
    for (const name of readdirSync(folder)) {
      const source = readFileSync(new URL(name, folder), "utf8");
      assert.doesNotMatch(source, /from "node:/, `${name} imports a node: module`);
    }
  });
});
