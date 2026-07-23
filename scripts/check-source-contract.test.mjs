import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  stripUnsupportedMetadata,
  validateSourceContract,
} from "./check-source-contract.mjs";

const COMMIT = "1234567890abcdef1234567890abcdef12345678";
const PUBLIC_FILES = [
  "fallow/skills/fallow/SKILL.md",
  "fallow/skills/fallow/agents/openai.yaml",
  "fallow/skills/fallow/references/cli-reference.md",
  "source-lock.json",
];

const write = async (root, path, content) => {
  await mkdir(join(root, path, ".."), { recursive: true });
  await writeFile(join(root, path), content);
};

const fixture = async (t) => {
  const root = await mkdtemp(join(tmpdir(), "fallow-skills-contract-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repositoryRoot = join(root, "skills");
  const sourceDir = join(root, "fallow");
  const sourceSkill = [
    "---",
    "name: fallow",
    "description: Public contract",
    "license: MIT",
    "metadata:",
    "  author: Fallow",
    "  version: 1.0.0",
    "---",
    "",
    "# Fallow",
    "",
  ].join("\n");
  await write(sourceDir, "npm/fallow/skills/fallow/SKILL.md", sourceSkill);
  await write(
    sourceDir,
    "npm/fallow/skills/fallow/agents/openai.yaml",
    "interface:\n  display_name: Fallow\n",
  );
  await write(
    sourceDir,
    "npm/fallow/skills/fallow/references/cli-reference.md",
    "# CLI\n",
  );
  await write(
    repositoryRoot,
    "fallow/skills/fallow/SKILL.md",
    stripUnsupportedMetadata(sourceSkill),
  );
  await write(
    repositoryRoot,
    "fallow/skills/fallow/agents/openai.yaml",
    "interface:\n  display_name: Fallow\n",
  );
  await write(
    repositoryRoot,
    "fallow/skills/fallow/references/cli-reference.md",
    "# CLI\n",
  );
  await write(
    repositoryRoot,
    "source-lock.json",
    `${JSON.stringify(
      {
        schemaVersion: 1,
        repository: "https://github.com/fallow-rs/fallow",
        commit: COMMIT,
        sourceRoot: "npm/fallow/skills/fallow",
        targetRoot: "fallow/skills/fallow",
        transforms: { "SKILL.md": "strip-unsupported-metadata" },
      },
      null,
      2,
    )}\n`,
  );
  return { repositoryRoot, sourceDir };
};

test("removes only the unsupported metadata frontmatter field", () => {
  const source = [
    "---",
    "name: fallow",
    "metadata:",
    "  version: 1.0.0",
    "license: MIT",
    "---",
    "# Fallow",
  ].join("\n");

  assert.equal(
    stripUnsupportedMetadata(source),
    ["---", "name: fallow", "license: MIT", "---", "# Fallow"].join("\n"),
  );
});

test("accepts an exact source contract plus the declared transform", async (t) => {
  const input = await fixture(t);
  const result = await validateSourceContract({
    ...input,
    verifyCommit: false,
    publicFiles: PUBLIC_FILES,
  });

  assert.deepEqual(result.files, [
    "agents/openai.yaml",
    "references/cli-reference.md",
    "SKILL.md",
  ]);
});

test("rejects public skill content drift", async (t) => {
  const input = await fixture(t);
  const target = join(input.repositoryRoot, "fallow/skills/fallow/references/cli-reference.md");
  await writeFile(target, `${await readFile(target, "utf8")}drift\n`);

  await assert.rejects(
    validateSourceContract({
      ...input,
      verifyCommit: false,
      publicFiles: PUBLIC_FILES,
    }),
    /content drift/u,
  );
});

test("rejects a private repository marker in tracked public content", async (t) => {
  const input = await fixture(t);
  await write(
    input.repositoryRoot,
    "README.md",
    `Clone ${"git@github.com:" + "fallow-rs/fallow-cloud.git"}`,
  );

  await assert.rejects(
    validateSourceContract({
      ...input,
      verifyCommit: false,
      publicFiles: [...PUBLIC_FILES, "README.md"],
    }),
    /private-data guard/u,
  );
});

test("rejects private decision and machine-local paths", async (t) => {
  const input = await fixture(t);
  await write(
    input.repositoryRoot,
    "README.md",
    `See \`${"deci" + "sions/private.md"}\`, \`${"inter" + "nal/runbook.md"}\`, ${"git:" + "/" + "/git" + "hub.com/fallow-rs/fallow-cloud.git"}, and \`${"~/" + "Sites/private-repository"}\`.\n`,
  );

  await assert.rejects(
    validateSourceContract({
      ...input,
      verifyCommit: false,
      publicFiles: [...PUBLIC_FILES, "README.md"],
    }),
    /private-data guard/u,
  );
});
