/**
 * The view model of `fallow inspect --file <path> --cloud --format json`.
 *
 * The fallow CLI joins the static findings of a file with Fallow Cloud production data. This module
 * only reads that JSON. A value that the cloud did not measure stays `null`, and no host shows it as
 * zero. A non-ok cloud status gives a status sentence and no numbers.
 */

import type { FallowProblem } from "./contracts.ts";
import { array, isRecord, number, record, string, type Json } from "./json.ts";

/** Section statuses that the CLI reports (contract B.2). */
export type CloudStatus = "ok" | "no_key" | "plan_required" | "unavailable" | "untracked";

/** Statuses that a host adds when the CLI gave no cloud section. */
export type HostStatus = "not_requested" | "cli_unsupported" | "cli_failed";

/** The states that the cloud reports. The CLI prints any other state as it is. */
export type ProductionState = "called" | "never_called" | "untracked";

export interface ProductionFunction {
  name: string;
  line: number | null;
  stableId: string | null;
  /** How the CLI paired the local function with the deployed one. */
  match: "stable_id" | "name_ordinal" | null;
  /** The state in this deployment: one of {@link ProductionState}, or another state of the cloud. */
  state: string | null;
  /** The state over the whole period, over every deployment (`called` when an earlier one ran it). */
  periodState: string | null;
  calls: number | null;
  errors: { groups: number; events: number } | null;
  cpuMsPerHour: number | null;
  neverRunRanges: number | null;
  /** The summary sentence of the cloud for this function. */
  summary: string | null;
}

export interface UnpairedFunction {
  name: string;
  line: number | null;
  note: string;
}

export interface ProductionSummary {
  functions: number | null;
  called: number | null;
  neverCalled: number | null;
  untracked: number | null;
  calls: number | null;
  errorGroups: number | null;
  errorEvents: number | null;
  text: string | null;
}

export type ProductionView =
  | {
      status: "ok";
      repo: string | null;
      latestSha: string | null;
      periodDays: number | null;
      /** A note of the CLI on an ok section, for example that the cloud left out functions. */
      message: string | null;
      summary: ProductionSummary | null;
      functions: ProductionFunction[];
      unpaired: UnpairedFunction[];
    }
  | { status: Exclude<CloudStatus, "ok"> | HostStatus; message: string };

export interface InspectView {
  /** The repo-relative file that fallow inspected. */
  path: string | null;
  /** The static evidence sections and their statuses, in CLI order. The cloud section is not here. */
  sections: Array<{ name: string; status: string }>;
  production: ProductionView;
}

const NAME_MAX = 160;
const TEXT_MAX = 400;
const CLOUD_SECTION = "cloud";

/** Values come from the analyzed repository and from the cloud, and reach a coding agent: keep them on one line. */
const oneLine = (text: string, max: number): string => {
  const flat = text.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

const text = (value: unknown, max: number): string | null => {
  const found = string(value);
  return found === null ? null : oneLine(found, max);
};

/** Default status texts. They start in lower case, so they fit after `cloud <status>: `. */
const STATUS_TEXT: Record<Exclude<ProductionView["status"], "ok">, string> = {
  no_key: "no Fallow Cloud key, run fallow cloud login to add one",
  plan_required: "production data needs a Fallow Cloud plan",
  unavailable: "Fallow Cloud did not answer, production data is not available now",
  untracked: "production has no data for this file yet",
  not_requested: "this run did not ask for production data",
  cli_unsupported: "this fallow version has no --cloud option, update fallow to see production data",
  cli_failed: "fallow inspect failed",
};

const CLOUD_STATUSES = new Set<string>(["ok", "no_key", "plan_required", "unavailable", "untracked"]);

const toState = (value: unknown): string | null => text(value, NAME_MAX);

const toMatch = (value: unknown): ProductionFunction["match"] =>
  value === "stable_id" || value === "name_ordinal" ? value : null;

const toErrors = (value: unknown): ProductionFunction["errors"] => {
  if (!isRecord(value)) return null;
  const groups = number(value["groups"]);
  const events = number(value["events"]);
  return groups === null || events === null ? null : { groups, events };
};

const toFunction = (item: Json): ProductionFunction | null => {
  const name = text(item["name"], NAME_MAX);
  if (name === null) return null;
  return {
    name,
    line: number(item["line"]),
    stableId: text(item["stable_id"], 64),
    match: toMatch(item["match"]),
    state: toState(item["state"]),
    periodState: toState(item["period_state"]),
    calls: number(item["calls"]),
    errors: toErrors(item["errors"]),
    cpuMsPerHour: number(item["cpu_ms_per_hour"]),
    neverRunRanges: number(item["never_run_ranges"]),
    summary: text(item["summary"], TEXT_MAX),
  };
};

const toUnpaired = (item: Json): UnpairedFunction | null => {
  const name = text(item["name"], NAME_MAX);
  if (name === null) return null;
  return {
    name,
    line: number(item["line"]),
    note: text(item["note"], TEXT_MAX) ?? "no production data (new or moved since deploy)",
  };
};

const toSummary = (value: unknown): ProductionSummary | null => {
  if (!isRecord(value)) return null;
  return {
    functions: number(value["functions"]),
    called: number(value["called"]),
    neverCalled: number(value["never_called"]),
    untracked: number(value["untracked"]),
    calls: number(value["calls"]),
    errorGroups: number(value["error_groups"]),
    errorEvents: number(value["error_events"]),
    text: text(value["text"], TEXT_MAX),
  };
};

const present = <T>(value: T | null): value is T => value !== null;

/**
 * Reads the cloud section. The CLI writes the fields next to `status` (contract B.4). A section in
 * the shape of the other inspect sections (`{ status, scope, data }`) is read too.
 */
export const readCloudSection = (section: unknown): ProductionView => {
  if (!isRecord(section)) return { status: "not_requested", message: STATUS_TEXT.not_requested };
  const fields = isRecord(section["data"]) ? { ...section["data"], status: section["status"] } : section;
  const status = string(fields["status"]);
  const message = text(fields["message"], TEXT_MAX);
  if (status === null || !CLOUD_STATUSES.has(status)) {
    return { status: "unavailable", message: message ?? STATUS_TEXT.unavailable };
  }
  if (status !== "ok") {
    const known = status as Exclude<CloudStatus, "ok">;
    return { status: known, message: message ?? STATUS_TEXT[known] };
  }
  return {
    status: "ok",
    repo: text(fields["repo"], NAME_MAX),
    latestSha: text(fields["latest_sha"], 64),
    periodDays: number(fields["period_days"]),
    message,
    summary: toSummary(fields["summary"]),
    functions: array(fields["functions"]).filter(isRecord).map(toFunction).filter(present),
    unpaired: array(fields["unpaired_local"]).filter(isRecord).map(toUnpaired).filter(present),
  };
};

/** Reads the inspect envelope: the file, the static section statuses and the production view. */
export const readInspect = (json: unknown): InspectView => {
  const root = record(json);
  const evidence = record(root["evidence"]);
  const sections = Object.entries(evidence)
    .filter(([name]) => name !== CLOUD_SECTION)
    .map(([name, value]) => ({ name, status: string(record(value)["status"]) ?? "unknown" }));
  return {
    path: text(record(root["target"])["file"], TEXT_MAX) ?? text(record(root["identity"])["file"], TEXT_MAX),
    sections,
    production: readCloudSection(evidence[CLOUD_SECTION] ?? root[CLOUD_SECTION]),
  };
};

const UNSUPPORTED_FLAG = /unexpected argument '--cloud'|unrecognized (?:argument|option) '?--cloud/;

/** The production view when `fallow inspect --cloud` itself failed. */
export const productionFromProblem = (problem: FallowProblem): ProductionView => {
  if (UNSUPPORTED_FLAG.test(problem.detail)) {
    return { status: "cli_unsupported", message: STATUS_TEXT.cli_unsupported };
  }
  const first = problem.detail.split("\n").find((line) => line.trim().length > 0);
  return {
    status: "cli_failed",
    message: first === undefined ? STATUS_TEXT.cli_failed : `${STATUS_TEXT.cli_failed}: ${oneLine(first, TEXT_MAX)}`,
  };
};

/** The period of the cloud read when the answer names none, as in the CLI. */
const DEFAULT_PERIOD_DAYS = 30;

/** The plural of the CLI: `branch` gives `branches`. */
const plural = (count: number, word: string): string => {
  if (count === 1) return `${count} ${word}`;
  return `${count} ${word}${word.endsWith("ch") ? "es" : "s"}`;
};

const stateText = (fn: ProductionFunction, periodDays: number | null): string => {
  if (fn.state === "called") return fn.calls === null ? "called" : `called ${plural(fn.calls, "call")}`;
  const days = periodDays ?? DEFAULT_PERIOD_DAYS;
  if (fn.state === "never_called" && fn.periodState === "called") {
    return `not called in this deployment, called earlier in ${days} days`;
  }
  if (fn.state === "never_called") return `never_called in ${days} days`;
  if (fn.state === "untracked" || fn.state === null) return "untracked (no runtime data)";
  return fn.state;
};

/**
 * One function as text, with the words of a `prod` line of `fallow inspect --format compact`
 * (contract B.5, `prod_text` in the CLI). A value that the cloud did not measure is left out,
 * never written as zero.
 */
export const functionText = (fn: ProductionFunction, periodDays: number | null): string => {
  const parts = [stateText(fn, periodDays)];
  if (fn.errors !== null && fn.errors.groups > 0) {
    parts.push(`${plural(fn.errors.groups, "error group")} (${plural(fn.errors.events, "event")})`);
  }
  if (fn.cpuMsPerHour !== null) parts.push(`${fn.cpuMsPerHour.toFixed(1)} ms CPU/h`);
  if (fn.neverRunRanges !== null && fn.neverRunRanges > 0) {
    parts.push(plural(fn.neverRunRanges, "never-run branch"));
  }
  return parts.join(", ");
};

const label = (name: string, line: number | null): string => (line === null ? name : `${name}:${line}`);

/** The rank of a `prod` line in the CLI: most signal first, so its byte cap cuts the least useful lines. */
const RANK = { errors: 0, neverCalled: 1, unpaired: 2, other: 3 } as const;

const functionRank = (fn: ProductionFunction): number => {
  if (fn.errors !== null && fn.errors.groups > 0) return RANK.errors;
  return fn.state === "never_called" ? RANK.neverCalled : RANK.other;
};

/**
 * The production part of the compact text: `prod` lines in the order of the CLI (functions with
 * errors, never_called functions, unpaired functions, the rest; each group in line order), or one
 * `cloud <status>: <text>` line.
 */
export const productionLines = (view: ProductionView): string[] => {
  if (view.status !== "ok") return [`cloud ${view.status}: ${view.message}`];
  const entries = [
    ...view.functions.map((fn) => ({
      rank: functionRank(fn),
      line: fn.line ?? 0,
      text: `prod ${label(fn.name, fn.line)} ${functionText(fn, view.periodDays)}`,
    })),
    ...view.unpaired.map((fn) => ({
      rank: RANK.unpaired,
      line: fn.line ?? 0,
      text: `prod ${label(fn.name, fn.line)} ${fn.note}`,
    })),
  ];
  return entries.sort((a, b) => a.rank - b.rank || a.line - b.line).map((entry) => entry.text);
};

/** The status as one sentence for a person: a capital letter and a full stop. Ok gives the summary. */
export const statusSentence = (view: ProductionView): string => {
  const raw = view.status === "ok" ? (view.summary?.text ?? "") : view.message;
  if (raw.length === 0) return "";
  const sentence = `${raw.charAt(0).toUpperCase()}${raw.slice(1)}`;
  return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
};
