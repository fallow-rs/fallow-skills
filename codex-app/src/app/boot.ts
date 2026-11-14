/**
 * How long the boot view waits for a result before it adds a note. A full analysis of a large
 * project can take longer, so the note only explains the wait and the view keeps listening.
 */
export const BOOT_NOTE_AFTER_MS = 20_000;

/**
 * The note for a boot view that still has no result. Some hosts, such as a Claude chat that runs
 * in the cloud, call the tool through a bridge and never send the result to the view.
 */
export const bootNote = (elapsedMs: number): string | null =>
  elapsedMs < BOOT_NOTE_AFTER_MS
    ? null
    : "Still waiting for the result. A large project can take a few minutes. Some hosts do not send the result to this view: then the summary appears only in the conversation.";
