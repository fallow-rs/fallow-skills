import type { On } from "claude-code";
import { expect, test } from "claude-code/testing";
import noKey from "../../agent-view/fixtures/no-key.txt";
import ok from "../../agent-view/fixtures/ok.txt";
import unpaired from "../../agent-view/fixtures/unpaired.txt";

/** What the fake fallow process answers: the fixture output, a failed exit, or a timeout. */
type Fake = { stdout: string; exitCode?: number } | "timeout";

const SURFACES = ["terminal", "desktop"] as const;
const FILE = "/repo/src/services/user.ts";

const setUp = (on: On, fake: Fake) => {
  const runs: Array<readonly string[]> = [];
  const statuses: Array<string | undefined> = [];
  on("session.start", (_$, e) => ({ cwd: e.cwd }));
  on("process.run", (_$, e) => {
    runs.push(e.argv);
    if (fake === "timeout") throw new Error("the command was still running after 2000 ms");
    return {
      value: {
        exitCode: fake.exitCode ?? 0,
        stdout: fake.stdout,
        stderr: "",
        isStdoutTruncated: false,
        isStderrTruncated: false,
      },
    };
  });
  on("ui.status", (_$, e) => {
    statuses.push(e.text);
    return { value: undefined };
  });
  on("tool.call", () => ({ result: { type: "text", file: { filePath: FILE } }, text: "file text" }));
  return { runs, statuses };
};

for (const surface of SURFACES) {
  test(`a Read appends the compact fallow text and sets the status line (${surface})`, async ($, on) => {
    const { runs, statuses } = setUp(on, { stdout: ok });
    await $.session.start({ cwd: "/repo", surface, isInteractive: true });
    const ran = await $.tool.call({ tool: "Read", file_path: FILE });
    expect(runs).toEqual([
      ["fallow", "inspect", "--file", FILE, "--cloud", "--format", "compact", "--quiet"],
    ]);
    expect(ran.context).toEqual([ok.trimEnd()]);
    expect(statuses).toEqual([
      "fallow user.ts: 2 findings | prod 1 called, 1 never_called, 1 untracked, 1 error group",
    ]);
  });

  test(`an Edit and a Write append the text too, with the note of an unpaired function (${surface})`, async ($, on) => {
    setUp(on, { stdout: unpaired });
    await $.session.start({ cwd: "/repo", surface, isInteractive: true });
    for (const call of [
      { tool: "Edit", file_path: FILE, old_string: "a", new_string: "b" },
      { tool: "Write", file_path: FILE, content: "export {}\n" },
    ] as const) {
      const ran = await $.tool.call(call);
      expect(ran.context?.[0]).toContain("prod newHelper:80 no production data (new or moved since deploy)");
    }
  });

  test(`a cloud status line passes through as the CLI wrote it (${surface})`, async ($, on) => {
    const { statuses } = setUp(on, { stdout: noKey });
    await $.session.start({ cwd: "/repo", surface, isInteractive: true });
    const ran = await $.tool.call({ tool: "Read", file_path: FILE });
    expect(ran.context?.[0]).toContain("cloud no_key: ");
    expect(statuses).toEqual(["fallow user.ts: 2 findings | cloud no_key"]);
  });

  for (const [name, fake] of [
    ["a non-zero exit", { stdout: "Error: inspect supports --format json or human", exitCode: 2 }],
    ["empty output", { stdout: "  \n" }],
    ["a timeout", "timeout"],
  ] as const) {
    test(`${name} adds nothing and does not block the tool call (${surface})`, async ($, on) => {
      const { statuses } = setUp(on, fake);
      await $.session.start({ cwd: "/repo", surface, isInteractive: true });
      const ran = await $.tool.call({ tool: "Read", file_path: FILE });
      expect(ran.text).toBe("file text");
      expect(ran.context ?? []).toEqual([]);
      expect(statuses).toEqual([]);
    });
  }

  test(`a file that fallow does not analyze runs nothing (${surface})`, async ($, on) => {
    const { runs } = setUp(on, { stdout: ok });
    await $.session.start({ cwd: "/repo", surface, isInteractive: true });
    const ran = await $.tool.call({ tool: "Read", file_path: "/repo/README.md" });
    expect(runs).toEqual([]);
    expect(ran.context ?? []).toEqual([]);
  });
}
