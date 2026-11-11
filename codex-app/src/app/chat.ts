import type { Finding, ProjectRef } from "../../../agent-view/src/contracts.ts";

/**
 * Claude accepts a `ui/message` of at most 8,000 characters, in text blocks only.
 * Other hosts accept more, so this is the smallest limit that every supported host accepts.
 */
export const MAX_PLAIN_MESSAGE = 8000;

export const location = (finding: Finding): string =>
  finding.line === null ? finding.path : `${finding.path}:${finding.line}`;

/** One line that names a finding, its place and the command that verifies it. */
export const findingText = (finding: Finding): string =>
  `Fallow finding ${finding.id} (${finding.rule}, ${finding.level}) at ${location(finding)}: ${finding.message.replace(/`/g, "")}${finding.verify === null ? "" : ` Verify with: ${finding.verify}`}`;

export const projectText = (project: ProjectRef): string =>
  `The attached Fallow findings belong to ${project.name} at ${project.root}. Verify each one with its command before you change code. Prefer a fix over a suppression.`;

const remainderText = (count: number): string => `And ${count} more findings: open Fallow to see them.`;

/**
 * The message as one text, for hosts that take only the standard `ui/message`: the instruction,
 * as many findings as fit, then the project. It never exceeds `MAX_PLAIN_MESSAGE`.
 */
export const plainMessage = (
  instruction: string,
  findings: readonly Finding[],
  project: ProjectRef | null,
): string => {
  const tail = project === null ? [] : [projectText(project)];
  const lines = [instruction];
  // The reserve keeps room for the remainder line and the project line.
  const reserve = [remainderText(findings.length), ...tail].join("\n").length + 2;
  let used = instruction.length;
  let shown = 0;
  for (const finding of findings) {
    const line = findingText(finding);
    if (used + line.length + 1 + reserve > MAX_PLAIN_MESSAGE) break;
    lines.push(line);
    used += line.length + 1;
    shown += 1;
  }
  if (shown < findings.length) lines.push(remainderText(findings.length - shown));
  return [...lines, ...tail].join("\n");
};

/** The assistant to name on a button, or null when the host is not known. */
export const assistantName = (
  hostName: string | undefined,
  hasOpenAIMessage: boolean,
): "Codex" | "Claude" | null => {
  if (hasOpenAIMessage) return "Codex";
  if (hostName !== undefined && /claude/i.test(hostName)) return "Claude";
  return null;
};
