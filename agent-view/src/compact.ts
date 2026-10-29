/**
 * Reads the compact agent text of `fallow inspect --file <path> --format compact` (contract B.5):
 * plain text, one item per line. The hosts give the text to the coding agent as it is. This reader
 * only counts the lines, for a status line or a badge.
 */

export type CompactLine =
  | { kind: "finding"; raw: string; rule: string; location: string; text: string }
  | { kind: "prod"; raw: string; target: string; text: string }
  | { kind: "cloud"; raw: string; status: string; text: string }
  | { kind: "truncated"; raw: string; more: number };

export interface CompactView {
  /** The file of the `fallow <path>` header. Null when the text has no header. */
  path: string | null;
  lines: CompactLine[];
  findings: number;
  prod: {
    called: number;
    neverCalled: number;
    untracked: number;
    unpaired: number;
    errorGroups: number;
  };
  cloud: { status: string; text: string } | null;
  truncated: number | null;
}

const HEADER = /^fallow (\S.*)$/;
const FINDING = /^finding (\S+) (\S+) (.*)$/;
const PROD = /^prod (\S+) (.*)$/;
const CLOUD = /^cloud ([a-z_]+): (.*)$/;
const TRUNCATED = /^truncated (\d+) more$/;
const ERROR_GROUPS = /(\d+) error groups? \(/;

const group = (match: RegExpExecArray, index: number): string => match[index] ?? "";

/** One reader per line kind; each gives null when its pattern does not match. */
const READERS: ReadonlyArray<(raw: string) => CompactLine | null> = [
  (raw) => {
    const match = FINDING.exec(raw);
    return match === null
      ? null
      : { kind: "finding", raw, rule: group(match, 1), location: group(match, 2), text: group(match, 3) };
  },
  (raw) => {
    const match = PROD.exec(raw);
    return match === null ? null : { kind: "prod", raw, target: group(match, 1), text: group(match, 2) };
  },
  (raw) => {
    const match = CLOUD.exec(raw);
    return match === null ? null : { kind: "cloud", raw, status: group(match, 1), text: group(match, 2) };
  },
  (raw) => {
    const match = TRUNCATED.exec(raw);
    return match === null ? null : { kind: "truncated", raw, more: Number(group(match, 1)) };
  },
];

const readLine = (raw: string): CompactLine | null => {
  for (const read of READERS) {
    const line = read(raw);
    if (line !== null) return line;
  }
  return null;
};

const countProd = (lines: CompactLine[]): CompactView["prod"] => {
  const prod = { called: 0, neverCalled: 0, untracked: 0, unpaired: 0, errorGroups: 0 };
  for (const line of lines) {
    if (line.kind !== "prod") continue;
    if (line.text.startsWith("called")) prod.called += 1;
    else if (line.text.startsWith("never_called")) prod.neverCalled += 1;
    else if (line.text.startsWith("untracked")) prod.untracked += 1;
    else prod.unpaired += 1;
    prod.errorGroups += Number(ERROR_GROUPS.exec(line.text)?.[1] ?? 0);
  }
  return prod;
};

/** Parses compact text. Text without the `fallow <path>` header gives a view with no lines. */
export const parseCompact = (text: string): CompactView => {
  const rows = text.split(/\r?\n/).map((row) => row.trimEnd());
  const header = HEADER.exec(rows[0] ?? "");
  const lines =
    header === null
      ? []
      : rows
          .slice(1)
          .map(readLine)
          .filter((line) => line !== null);
  const cloud = lines.find((line) => line.kind === "cloud");
  const truncated = lines.find((line) => line.kind === "truncated");
  return {
    path: header?.[1] ?? null,
    lines,
    findings: lines.filter((line) => line.kind === "finding").length,
    prod: countProd(lines),
    cloud: cloud === undefined ? null : { status: cloud.status, text: cloud.text },
    truncated: truncated === undefined ? null : truncated.more,
  };
};

const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? "" : "s"}`;

const prodSummary = (prod: CompactView["prod"]): string | null => {
  const parts = [
    prod.called > 0 ? `${prod.called} called` : null,
    prod.neverCalled > 0 ? `${prod.neverCalled} never_called` : null,
    prod.untracked > 0 ? `${prod.untracked} untracked` : null,
    prod.unpaired > 0 ? `${prod.unpaired} new` : null,
    prod.errorGroups > 0 ? plural(prod.errorGroups, "error group") : null,
  ].filter((part) => part !== null);
  return parts.length === 0 ? null : `prod ${parts.join(", ")}`;
};

/** One short line for a status bar, for example `fallow user.ts: 2 findings | prod 3 called`. Null without a header. */
export const compactStatusLine = (view: CompactView): string | null => {
  if (view.path === null) return null;
  const file = view.path.split("/").pop() ?? view.path;
  const parts = [`fallow ${file}: ${plural(view.findings, "finding")}`];
  const production = view.cloud === null ? prodSummary(view.prod) : `cloud ${view.cloud.status}`;
  if (production !== null) parts.push(production);
  return parts.join(" | ");
};
