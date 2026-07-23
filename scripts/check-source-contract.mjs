#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import {
  lstat,
  readFile,
  readdir,
  realpath,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LOCK_PATH = "source-lock.json";
const COMMIT_PATTERN = /^[0-9a-f]{40}$/u;
const PRIVATE_MARKERS = [
  /(?:^|[^\w-])\.internal\//u,
  /(?:^|[^A-Za-z0-9-])github\.com\.?(?::\d+)?(?::|\/)+fallow-rs\/fallow-cloud(?:\.git)?(?=$|[^A-Za-z0-9._-])/iu,
  /\/Users\/[^/\s]+\/[^/\s]+/u,
  /[A-Za-z]:\\Users\\[^\\\s]+\\/u,
  /-----BEGIN (?:EC |OPENSSH |RSA )?PRIVATE KEY-----/u,
  /gh[pousr]_[A-Za-z0-9]{36,}/u,
  /AKIA[0-9A-Z]{16}/u,
  /sk_live_[A-Za-z0-9]{20,}/u,
];

const toPosixPath = (path) => path.split(sep).join("/");
const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));

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
  if (isAbsolute(relativeRoot) || relativeRoot.split("/").includes("..")) {
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

const expectedContent = (path, content, transforms) => {
  const transform = transforms[path];
  if (transform === undefined) {
    return content;
  }
  if (transform === "strip-unsupported-metadata" && path === "SKILL.md") {
    return stripUnsupportedMetadata(content);
  }
  throw new Error(`Unsupported public contract transform for ${path}: ${transform}`);
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
  const lock = await readJson(join(repositoryRoot, LOCK_PATH));
  if (
    lock.schemaVersion !== 1 ||
    lock.repository !== "https://github.com/fallow-rs/fallow" ||
    !COMMIT_PATTERN.test(lock.commit ?? "") ||
    typeof lock.sourceRoot !== "string" ||
    typeof lock.targetRoot !== "string" ||
    typeof lock.transforms !== "object"
  ) {
    throw new Error("Invalid public source lock");
  }
  if (verifyCommit && sourceCommit(sourceDir) !== lock.commit) {
    throw new Error(`Fallow source checkout does not match locked commit ${lock.commit}`);
  }

  const sourceRoot = await validateContainedRoot(sourceDir, lock.sourceRoot);
  const targetRoot = await validateContainedRoot(repositoryRoot, lock.targetRoot);
  const sourceFiles = await filesUnder(sourceRoot);
  const targetContractFiles = (await filesUnder(targetRoot)).filter(
    (path) => path === "SKILL.md" || path.startsWith("references/"),
  );
  if (sourceFiles.join("\0") !== targetContractFiles.join("\0")) {
    throw new Error(
      `Public skill inventory drift: source=[${sourceFiles.join(", ")}], ` +
        `target=[${targetContractFiles.join(", ")}]`,
    );
  }

  for (const path of sourceFiles) {
    const source = await readFile(join(sourceRoot, path), "utf8");
    const target = await readFile(join(targetRoot, path), "utf8");
    if (expectedContent(path, source, lock.transforms) !== target) {
      throw new Error(`Public skill content drift: ${path}`);
    }
  }
  await validatePublicFiles(repositoryRoot, publicFiles);
  return { commit: lock.commit, files: sourceFiles };
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
        process.stdout.write(
          `Public skill contract matches ${result.commit} (${result.files.length.toString()} files).\n`,
        );
      })
      .catch((error) => {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
      });
  }
}
