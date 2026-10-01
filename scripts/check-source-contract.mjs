#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import {
  lstat,
  readFile,
  readdir,
  realpath,
} from "node:fs/promises";
import { dirname, isAbsolute, join, posix, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LOCK_PATH = "source-lock.json";
const COMMIT_PATTERN = /^[0-9a-f]{40}$/u;
const LOCK_SCHEMA_VERSION = 2;
const SKILL_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/u;
const SKILL_MARKER = "SKILL.md";
const SUPPORTED_TRANSFORMS = { "SKILL.md": "strip-unsupported-metadata" };
const PRIVATE_MARKERS = [
  /(?:^|[^\w-])\.internal\//u,
  /(?:^|[^\w@-])decisions\//u,
  /(?:^|[\s([{"'=`])internal\//u,
  /(?:(?:(?:https?|git):)?\/\/(?:www\.)?github\.com\/|ssh:\/\/git@github\.com\/|git@github\.com:)fallow-rs\/fallow-cloud(?:\.git)?(?=$|[/?#:\s`),.])/iu,
  /\/Users\/[^/\s]+\/[^/\s]+/u,
  /~\/Sites\/[^/\s]+/u,
  /[A-Za-z]:\\Users\\[^\\\s]+\\/u,
  /-----BEGIN (?:EC |OPENSSH |RSA )?PRIVATE KEY-----/u,
  /gh[pousr]_[A-Za-z0-9]{36,}/u,
  /AKIA[0-9A-Z]{16}/u,
  /sk_live_[A-Za-z0-9]{20,}/u,
];

const toPosixPath = (path) => path.split(sep).join("/");

const filesUnder = async (root, directory = "") => {
  const files = [];
  const entries = await readdir(join(root, directory), { withFileTypes: true });
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const path = toPosixPath(join(directory, entry.name));
    const metadata = await lstat(join(root, path));
    if (metadata.isSymbolicLink()) {
      throw new Error(`Contract content cannot contain symlinks: ${path}`);
    }
    if (metadata.isDirectory()) {
      files.push(...(await filesUnder(root, path)));
    } else if (metadata.isFile()) {
      files.push(path);
    }
  }
  return files;
};

const validateContainedRoot = async (repositoryRoot, relativeRoot) => {
  const segments = relativeRoot.split("/");
  if (isAbsolute(relativeRoot) || segments.some((segment) => ["", ".", ".."].includes(segment))) {
    throw new Error(`Contract root is unsafe: ${relativeRoot}`);
  }
  const realRepository = await realpath(repositoryRoot);
  const realContract = await realpath(join(repositoryRoot, relativeRoot));
  const pathFromRepository = relative(realRepository, realContract);
  if (pathFromRepository.startsWith("..") || isAbsolute(pathFromRepository)) {
    throw new Error(`Contract root escapes its repository: ${relativeRoot}`);
  }
  return realContract;
};

export const stripUnsupportedMetadata = (content) => {
  const lines = content.split("\n");
  if (lines[0] !== "---") {
    throw new Error("SKILL.md source is missing YAML frontmatter");
  }
  const closing = lines.indexOf("---", 1);
  if (closing === -1) {
    throw new Error("SKILL.md source has unterminated YAML frontmatter");
  }
  const metadata = lines.findIndex((line, index) => index < closing && line === "metadata:");
  if (metadata === -1) {
    return content;
  }

  let end = metadata + 1;
  while (end < closing && (lines[end].startsWith(" ") || lines[end].trim() === "")) {
    end += 1;
  }
  lines.splice(metadata, end - metadata);
  return lines.join("\n");
};

const expectedContent = (path, content, transforms) =>
  transforms[path] === undefined ? content : stripUnsupportedMetadata(content);

const isPlainObject = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const overlaps = (left, right) =>
  left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);

const assertDisjoint = (skills, field) => {
  for (const [index, skill] of skills.entries()) {
    for (const other of skills.slice(index + 1)) {
      if (overlaps(skill[field], other[field])) {
        throw new Error(
          `Public source lock ${field} entries overlap: ${skill[field]}, ${other[field]}`,
        );
      }
    }
  }
};

const validateTransforms = (skill) => {
  for (const [path, transform] of Object.entries(skill.transforms)) {
    if (SUPPORTED_TRANSFORMS[path] !== transform) {
      throw new Error(
        `Unsupported public contract transform for ${skill.name} ${path}: ${String(transform)}`,
      );
    }
  }
};

const isValidSkillEntry = (skill) =>
  isPlainObject(skill) &&
  typeof skill.name === "string" &&
  SKILL_NAME_PATTERN.test(skill.name) &&
  typeof skill.sourceRoot === "string" &&
  typeof skill.targetRoot === "string" &&
  isPlainObject(skill.transforms);

/**
 * Parse `source-lock.json`. Each entry in `skills` is one released Fallow
 * skill. Skills that the lock does not list belong to this repository.
 */
export const parseSourceLock = (lock) => {
  if (
    !isPlainObject(lock) ||
    lock.schemaVersion !== LOCK_SCHEMA_VERSION ||
    lock.repository !== "https://github.com/fallow-rs/fallow" ||
    !COMMIT_PATTERN.test(lock.commit ?? "") ||
    !Array.isArray(lock.skills) ||
    lock.skills.length === 0 ||
    !lock.skills.every(isValidSkillEntry)
  ) {
    throw new Error("Invalid public source lock");
  }
  const names = lock.skills.map((skill) => skill.name);
  const duplicate = names.find((name, index) => names.indexOf(name) !== index);
  if (duplicate !== undefined) {
    throw new Error(`Public source lock lists a skill twice: ${duplicate}`);
  }
  assertDisjoint(lock.skills, "sourceRoot");
  assertDisjoint(lock.skills, "targetRoot");
  lock.skills.forEach(validateTransforms);
  return lock;
};

/**
 * Return the released skills next to each listed source root. A released
 * skill is a directory with a SKILL.md whose name does not start with `_` or
 * `.`. This matches `releasedSkillNames` in the Fallow repository.
 */
const releasedSourceRoots = async (sourceDir, skills) => {
  const parents = [...new Set(skills.map((skill) => posix.dirname(skill.sourceRoot)))];
  const released = [];
  for (const parent of parents) {
    const root = await validateContainedRoot(sourceDir, parent);
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || /^[_.]/u.test(entry.name)) {
        continue;
      }
      const marker = await lstat(join(root, entry.name, SKILL_MARKER)).catch(() => null);
      if (marker?.isFile()) {
        released.push(posix.join(parent, entry.name));
      }
    }
  }
  return released.toSorted();
};

const assertEveryReleasedSkillListed = async (sourceDir, skills) => {
  const listed = new Set(skills.map((skill) => skill.sourceRoot));
  const unlisted = (await releasedSourceRoots(sourceDir, skills)).filter(
    (root) => !listed.has(root),
  );
  if (unlisted.length > 0) {
    throw new Error(
      `Released Fallow skills are not listed in ${LOCK_PATH}: ` +
        unlisted.map((root) => posix.basename(root)).join(", "),
    );
  }
};

const validateSkill = async (repositoryRoot, sourceDir, skill) => {
  const contained = (root, relativeRoot, side) =>
    validateContainedRoot(root, relativeRoot).catch((error) => {
      throw new Error(
        `${skill.name}: ${side} root is missing or unsafe: ${relativeRoot} ` +
          `(${error instanceof Error ? error.message : String(error)})`,
      );
    });
  const sourceRoot = await contained(sourceDir, skill.sourceRoot, "source");
  const targetRoot = await contained(repositoryRoot, skill.targetRoot, "target");
  const sourceFiles = await filesUnder(sourceRoot);
  const targetFiles = await filesUnder(targetRoot);
  if (sourceFiles.join("\0") !== targetFiles.join("\0")) {
    throw new Error(
      `${skill.name}: public skill inventory drift: source=[${sourceFiles.join(", ")}], ` +
        `target=[${targetFiles.join(", ")}]`,
    );
  }

  for (const path of sourceFiles) {
    const source = await readFile(join(sourceRoot, path), "utf8");
    const target = await readFile(join(targetRoot, path), "utf8");
    if (expectedContent(path, source, skill.transforms) !== target) {
      throw new Error(`${skill.name}: public skill content drift: ${path}`);
    }
  }
  return { name: skill.name, files: sourceFiles };
};

const sourceCommit = (sourceDir) =>
  execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: sourceDir,
    encoding: "utf8",
  }).trim();

const validatePublicFiles = async (root, publicFiles) => {
  const tracked =
    publicFiles ??
    execFileSync("git", ["ls-files", "-z"], {
      cwd: root,
      encoding: "utf8",
    })
      .split("\0")
      .filter(Boolean);

  for (const path of tracked) {
    const absolutePath = join(root, path);
    const metadata = await lstat(absolutePath);
    if (metadata.isSymbolicLink()) {
      throw new Error(`Public repository cannot contain symlinks: ${path}`);
    }
    if (!metadata.isFile() || /\.(?:png|jpg|jpeg|gif|webp|zip)$/iu.test(path)) {
      continue;
    }
    const content = await readFile(absolutePath, "utf8");
    if (PRIVATE_MARKERS.some((pattern) => pattern.test(content))) {
      throw new Error(`Public repository content failed the private-data guard: ${path}`);
    }
  }
};

export const validateSourceContract = async ({
  repositoryRoot = REPOSITORY_ROOT,
  sourceDir,
  verifyCommit = true,
  publicFiles,
}) => {
  const lock = parseSourceLock(
    JSON.parse(await readFile(join(repositoryRoot, LOCK_PATH), "utf8")),
  );
  if (verifyCommit && sourceCommit(sourceDir) !== lock.commit) {
    throw new Error(`Fallow source checkout does not match locked commit ${lock.commit}`);
  }

  await assertEveryReleasedSkillListed(sourceDir, lock.skills);
  const skills = [];
  for (const skill of lock.skills) {
    skills.push(await validateSkill(repositoryRoot, sourceDir, skill));
  }
  await validatePublicFiles(repositoryRoot, publicFiles);
  return { commit: lock.commit, skills };
};

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const configuredSource = process.env.FALLOW_SOURCE_DIR;
  if (!configuredSource) {
    process.stderr.write(
      "FALLOW_SOURCE_DIR must point to the exact public Fallow checkout in source-lock.json.\n",
    );
    process.exitCode = 2;
  } else {
    validateSourceContract({ sourceDir: resolve(configuredSource) })
      .then((result) => {
        const summary = result.skills
          .map((skill) => `${skill.name}: ${skill.files.length.toString()} files`)
          .join(", ");
        process.stdout.write(`Public skill contract matches ${result.commit} (${summary}).\n`);
      })
      .catch((error) => {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
      });
  }
}
