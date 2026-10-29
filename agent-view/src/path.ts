/**
 * Pure path helpers. A Claude Code mod has no `node:` modules, so the shared core cannot use
 * `node:path`. These helpers read POSIX and Windows paths on any host.
 */

const WINDOWS_DRIVE = /^[A-Za-z]:\//;

const forward = (path: string): string => path.replace(/\\/g, "/");

const isAbsoluteForward = (path: string): boolean =>
  path.startsWith("/") || WINDOWS_DRIVE.test(path);

/** Splits a forward-slash path into segments and resolves `.` and `..`. */
const segments = (path: string): string[] => {
  const out: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === ".." && out.length > 0 && out[out.length - 1] !== "..") out.pop();
    else out.push(part);
  }
  return out;
};

/** A drive letter compares without case on Windows; other segments compare exactly. */
const sameSegment = (left: string, right: string, index: number): boolean =>
  index === 0 && /^[A-Za-z]:$/.test(left)
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;

/**
 * Makes `path` relative to `root` with forward slashes, like `node:path` `relative` does.
 * A relative `path` stays as it is, with forward slashes. A path on another drive stays absolute.
 */
export const relativePath = (root: string, path: string): string => {
  const target = forward(path);
  if (!isAbsoluteForward(target)) return target;
  const from = segments(forward(root));
  const to = segments(target);
  let shared = 0;
  while (
    shared < from.length &&
    shared < to.length &&
    sameSegment(from[shared] ?? "", to[shared] ?? "", shared)
  ) {
    shared += 1;
  }
  if (shared === 0 && WINDOWS_DRIVE.test(target)) return to.join("/");
  return [...from.slice(shared).map(() => ".."), ...to.slice(shared)].join("/");
};
