import type { Register } from "claude-code";
import {
  BUDGET_MS,
  fileViewText,
  inspectArgv,
  statusLineOf,
  wantsFileView,
  withFileView,
  type FileCall,
  type Host,
  type Ran,
} from "./view.ts";

/** One hook for the three tools: run the tool, then add the fallow file view to its result. */
const fileView = async <E extends FileCall, R extends Ran>($: Host, e: E, next: (e: E) => Promise<R>): Promise<R> => {
  const ran = await next(e);
  if (!wantsFileView(ran, e.file_path)) return ran;
  const run = await $.process.run(inspectArgv(e.file_path), { timeoutMs: BUDGET_MS }).catch(() => null);
  const text = fileViewText(run);
  if (text === null) return ran;
  const status = statusLineOf(text);
  if (status !== null) $.ui.status(status);
  return withFileView(ran, text);
};

/**
 * The Fallow mod for Claude Code. After a Read, Edit or Write of a source file, it runs
 * `fallow inspect --file <path> --cloud --format compact` and adds the output to the tool result:
 * the static findings of the file and, with a Fallow Cloud key, its production data. It also sets
 * a status line entry. Any failure adds nothing, and the tool result stays as it was.
 */
export const register: Register = (on) => {
  on("tool.call", { tool: "Read" }, fileView).catch((_$, e, next) => next(e));
  on("tool.call", { tool: "Edit" }, fileView).catch((_$, e, next) => next(e));
  on("tool.call", { tool: "Write" }, fileView).catch((_$, e, next) => next(e));
};
