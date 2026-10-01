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
const RELEASED = ["fallow", "fallow-setup"];

const write = async (root, path, content) => {
  await mkdir(join(root, path, ".."), { recursive: true });
  await writeFile(join(root, path), content);
};

const skillSource = (name) =>
  [
    "---",
    `name: ${name}`,
    "description: Public contract",
    "license: MIT",
    "metadata:",
    "  author: Fallow",
    "  version: 1.0.0",
    "---",
    "",
    `# ${name}`,
    "",
  ].join("\n");

const skillEntry = (name) => ({
  name,
  sourceRoot: `npm/fallow/skills/${name}`,
  targetRoot: `fallow/skills/${name}`,
  transforms: { "SKILL.md": "strip-unsupported-metadata" },
});

const writeLock = (repositoryRoot, lock) =>
  write(repositoryRoot, "source-lock.json", `${JSON.stringify(lock, null, 2)}\n`);

const lockFor = (names) => ({
  schemaVersion: 2,
  repository: "https://github.com/fallow-rs/fallow",
  commit: COMMIT,
  skills: names.map(skillEntry),
});

const publicFilesFor = (names) => [
  ...names.flatMap((name) => [
    `fallow/skills/${name}/SKILL.md`,
    `fallow/skills/${name}/agents/openai.yaml`,
    `fallow/skills/${name}/references/guide.md`,
  ]),
  "fallow/skills/fallow-review/SKILL.md",
  "fallow/skills/fallow-review/hooks/on-feedback.sh",
  "source-lock.json",
];

const PUBLIC_FILES = publicFilesFor(RELEASED);

/**
 * Build a source checkout that releases `fallow` and `fallow-setup`, and a
 * skills repository that vendors both plus its own `fallow-review` skill.
 */
const fixture = async (t) => {
  const root = await mkdtemp(join(tmpdir(), "fallow-skills-contract-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repositoryRoot = join(root, "skills");
  const sourceDir = join(root, "fallow");
  for (const name of RELEASED) {
    const source = skillSource(name);
    const openai = `interface:\n  display_name: ${name}\n`;
    const guide = `# ${name} guide\n`;
    await write(sourceDir, `npm/fallow/skills/${name}/SKILL.md`, source);
    await write(sourceDir, `npm/fallow/skills/${name}/agents/openai.yaml`, openai);
    await write(sourceDir, `npm/fallow/skills/${name}/references/guide.md`, guide);
    await write(
      repositoryRoot,
      `fallow/skills/${name}/SKILL.md`,
      stripUnsupportedMetadata(source),
    );
    await write(repositoryRoot, `fallow/skills/${name}/agents/openai.yaml`, openai);
    await write(repositoryRoot, `fallow/skills/${name}/references/guide.md`, guide);
  }
  // Build output and directories without a SKILL.md are not released skills.
  await write(sourceDir, "npm/fallow/skills/_build/notes.md", "# build\n");
  await write(sourceDir, "npm/fallow/skills/drafts/notes.md", "# draft\n");
  await write(
    repositoryRoot,
    "fallow/skills/fallow-review/SKILL.md",
    "---\nname: fallow-review\ndescription: Repository-owned skill\n---\n",
  );
  await write(repositoryRoot, "fallow/skills/fallow-review/hooks/on-feedback.sh", "#!/bin/sh\n");
  await writeLock(repositoryRoot, lockFor(RELEASED));
  return { repositoryRoot, sourceDir };
};

const validate = (input, publicFiles = PUBLIC_FILES) =>
  validateSourceContract({ ...input, verifyCommit: false, publicFiles });

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

test("accepts every listed skill root and ignores skills the lock does not list", async (t) => {
  const result = await validate(await fixture(t));

  assert.equal(result.commit, COMMIT);
  assert.deepEqual(
    result.skills.map((skill) => [skill.name, skill.files]),
    RELEASED.map((name) => [
      name,
      ["agents/openai.yaml", "references/guide.md", "SKILL.md"],
    ]),
  );
});

test("rejects content drift in any listed skill root", async (t) => {
  const input = await fixture(t);
  const target = join(input.repositoryRoot, "fallow/skills/fallow-setup/references/guide.md");
  await writeFile(target, `${await readFile(target, "utf8")}drift\n`);

  await assert.rejects(validate(input), /fallow-setup.*content drift: references\/guide\.md/u);
});

test("rejects an extra file in a listed skill root", async (t) => {
  const input = await fixture(t);
  await write(input.repositoryRoot, "fallow/skills/fallow-setup/hooks/extra.sh", "#!/bin/sh\n");

  await assert.rejects(
    validate(input, [...PUBLIC_FILES, "fallow/skills/fallow-setup/hooks/extra.sh"]),
    /fallow-setup.*inventory drift/u,
  );
});

test("rejects a listed skill that the skills repository does not vendor", async (t) => {
  const input = await fixture(t);
  await rm(join(input.repositoryRoot, "fallow/skills/fallow-setup"), {
    recursive: true,
  });

  await assert.rejects(
    validate(input, publicFilesFor(["fallow"])),
    /fallow-setup: target root is missing/u,
  );
});

test("rejects a released source skill that the lock does not list", async (t) => {
  const input = await fixture(t);
  await writeLock(input.repositoryRoot, lockFor(["fallow"]));

  await assert.rejects(validate(input), /not listed in source-lock\.json: fallow-setup/u);
});

test("rejects the old single-root lock shape", async (t) => {
  const input = await fixture(t);
  await writeLock(input.repositoryRoot, {
    schemaVersion: 1,
    repository: "https://github.com/fallow-rs/fallow",
    commit: COMMIT,
    sourceRoot: "npm/fallow/skills/fallow",
    targetRoot: "fallow/skills/fallow",
    transforms: { "SKILL.md": "strip-unsupported-metadata" },
  });

  await assert.rejects(validate(input), /Invalid public source lock/u);
});

test("rejects skill entries that share or nest a target root", async (t) => {
  const input = await fixture(t);
  const lock = lockFor(RELEASED);
  lock.skills[1].targetRoot = "fallow/skills/fallow/references";
  await writeLock(input.repositoryRoot, lock);

  await assert.rejects(validate(input), /overlap/u);
});

test("rejects an unsupported transform", async (t) => {
  const input = await fixture(t);
  const lock = lockFor(RELEASED);
  lock.skills[0].transforms = { "references/guide.md": "strip-unsupported-metadata" };
  await writeLock(input.repositoryRoot, lock);

  await assert.rejects(validate(input), /Unsupported public contract transform/u);
});

test("rejects private repository markers and machine-local paths", async (t) => {
  const input = await fixture(t);
  await write(
    input.repositoryRoot,
    "README.md",
    `See \`${"deci" + "sions/private.md"}\`, \`${"inter" + "nal/runbook.md"}\`, ${"git:" + "/" + "/git" + "hub.com/fallow-rs/fallow-cloud.git"}, ${"git@github.com:" + "fallow-rs/fallow-cloud.git"}, and \`${"~/" + "Sites/private-repository"}\`.\n`,
  );

  await assert.rejects(validate(input, [...PUBLIC_FILES, "README.md"]), /private-data guard/u);
});
