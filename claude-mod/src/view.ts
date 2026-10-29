/**
 * The parts of the mod that do not touch `$`: the command, the reading of its result, and the status
 * line. The build bundles this file with the shared `agent-view/` core into `fallow-view.mjs`.
 */
import { compactStatusLine, parseCompact } from "../../agent-view/src/compact.ts";

/** The whole inspect run must fit in this budget, so a Read, Edit or Write never waits long. */
export const BUDGET_MS = 2000;

/** Only source files that fallow analyzes. A Read of a README runs nothing. */
const SOURCE_FILE = /\.(?:[cm]?[jt]sx?|vue|svelte|astro)$/i;

export interface RunResult {
  exitCode: number;
  stdout: string;
  isStdoutTruncated: boolean;
}

/** The two parts of `$` that the hook uses. */
export interface Host {
  process: { run: (argv: readonly string[], init: { timeoutMs: number }) => Promise<RunResult> };
  ui: { status: (text: string | undefined) => void };
}

/** The input of a Read, Edit or Write call, as far as the hook reads it. */
export interface FileCall {
  file_path: string;
}

/** What a tool call resolved to, as far as the hook reads it. */
export interface Ran {
  deny?: string | undefined;
  isError?: true | undefined;
  context?: readonly string[] | undefined;
}

/** True when the hook should run fallow for this call: the tool answered, and the file is source. */
export const wantsFileView = (ran: Ran, path: string): boolean =>
  ran.deny === undefined && ran.isError !== true && SOURCE_FILE.test(path) && !path.startsWith("-");

/** The command that the hook runs. The CLI joins the static findings and the production data. */
export const inspectArgv = (path: string): string[] => [
  "fallow",
  "inspect",
  "--file",
  path,
  "--cloud",
  "--format",
  "compact",
  "--quiet",
];

/** The compact text, or null for a failed start, a timeout, a non-zero exit or empty output. */
export const fileViewText = (result: RunResult | null): string | null => {
  if (result === null || result.exitCode !== 0 || result.isStdoutTruncated) return null;
  const text = result.stdout.trimEnd();
  return text.trim().length === 0 ? null : text;
};

/** The status line entry for the compact text, or null when the text has no `fallow <path>` header. */
export const statusLineOf = (text: string): string | null => compactStatusLine(parseCompact(text));

/** The tool result with the compact text added after the tool output, for the model to read. */
export const withFileView = <R extends Ran>(ran: R, text: string): R => ({
  ...ran,
  context: [...(ran.context ?? []), text],
});
