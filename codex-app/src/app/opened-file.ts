import type { Host } from "./host.ts";

export interface OpenedFile {
  text: string;
  etag: string | undefined;
  writable: boolean;
}

export type ReadOutcome = { ok: true; file: OpenedFile } | { ok: false; error: string };

const UNSUPPORTED = "This Codex surface cannot open files in apps. Use Codex on the desktop.";

/** Reads the file that a file entrypoint opened, as text, through the host. */
export const readOpenedFile = async (host: Host, uri: string): Promise<ReadOutcome> => {
  const resources = host.openai.resources;
  if (resources === undefined) return { ok: false, error: UNSUPPORTED };
  try {
    const result = await resources.read({ uri, representation: "text" });
    const content = result.contents[0];
    const text = content !== undefined && "text" in content && typeof content.text === "string" ? content.text : "";
    return {
      ok: true,
      file: { text, etag: content?.openaiMetadata?.etag, writable: content?.openaiMetadata?.writable === true },
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "The file could not be read." };
  }
};

/** Calls `onChange` when the opened file changes on disk. Returns the cleanup for an effect. */
export const watchOpenedFile = (host: Host, uri: string, onChange: () => void | Promise<void>): (() => void) => {
  const resources = host.openai.resources;
  if (resources === undefined) return () => undefined;
  const dispose = resources.addUpdateHandler(async ({ params }) => {
    if (params.uri === uri) await onChange();
  });
  void resources.subscribe({ uri }).catch(() => undefined);
  return () => {
    dispose();
    void resources.unsubscribe({ uri }).catch(() => undefined);
  };
};
