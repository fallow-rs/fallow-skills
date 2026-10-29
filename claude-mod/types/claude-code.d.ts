/**
 * The small part of the Claude Code mod API that this mod uses, so CI can type-check it without
 * Claude Code. The full declarations come from Claude Code itself: a session that loads the mod
 * writes them to `.claude-plugin/types/`. `claude plugin validate` and `claude plugin test` check
 * the mod against the real engine.
 */
declare module "claude-code" {
  export interface ProcessRunResult {
    exitCode: number;
    stdout: string;
    stderr: string;
    isStdoutTruncated: boolean;
    isStderrTruncated: boolean;
  }

  export interface Engine {
    process: {
      run: (argv: readonly string[], init?: { cwd?: string; timeoutMs?: number }) => Promise<ProcessRunResult>;
    };
    ui: { status: (text: string | undefined) => void };
    session: { start: (input: { cwd: string; surface: string; isInteractive: boolean }) => Promise<unknown> };
    tool: { call: (input: { tool: string; [key: string]: unknown }) => Promise<ToolCallResult> };
  }

  export type ToolCallResult =
    | { deny: string; isError?: undefined; context?: undefined; text?: undefined }
    | { deny?: undefined; result: unknown; isError?: true; context?: readonly string[]; text?: string };

  export interface ToolCallInput {
    tool: string;
    file_path: string;
  }

  type Next<E, R> = ((e: E) => Promise<R>) & { called?: boolean };

  type Hook<E, R> = ($: Engine, e: E, next: Next<E, R>) => Promise<R> | R;

  export interface Registration<H> {
    catch: (handler: H) => void;
  }

  /** The events this mod and its tests hook. A test answers a call on `$` with `{ value }`. */
  interface Events {
    "tool.call": [ToolCallInput, ToolCallResult];
    "process.run": [{ argv: readonly string[]; init?: { timeoutMs?: number } }, { value: ProcessRunResult }];
    "ui.status": [{ text: string | undefined }, { value: undefined }];
    "session.start": [{ cwd: string }, { cwd: string }];
  }

  export type On = {
    <K extends keyof Events>(
      event: K,
      matcher: { tool: "Read" | "Edit" | "Write" },
      hook: Hook<Events[K][0], Events[K][1]>,
    ): Registration<Hook<Events[K][0], Events[K][1]>>;
    <K extends keyof Events>(event: K, hook: Hook<Events[K][0], Events[K][1]>): Registration<
      Hook<Events[K][0], Events[K][1]>
    >;
  };

  export type Register = (on: On, options: Record<string, unknown>) => unknown;
}

declare module "claude-code/testing" {
  import type { Engine, On } from "claude-code";

  export const test: (name: string, body: ($: Engine, on: On) => unknown) => void;
  export const expect: (value: unknown) => {
    toBe: (expected: unknown) => void;
    toEqual: (expected: unknown) => void;
    toContain: (expected: unknown) => void;
  };
}

declare module "*.txt" {
  const text: string;
  export default text;
}
