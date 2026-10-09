/** A small SARIF 2.1.0 reader for the file viewer. It accepts output from any analyzer, not only fallow. */

export type SarifLevel = "error" | "warning" | "note" | "none";

export interface SarifRule {
  id: string;
  name: string;
  description: string | null;
  helpUri: string | null;
}

export interface SarifResult {
  key: string;
  tool: string;
  ruleId: string;
  level: SarifLevel;
  message: string;
  /** Artifact URI as the report wrote it. The server resolves it against the report folder. */
  uri: string | null;
  line: number | null;
  column: number | null;
  baselineState: string | null;
}

export interface SarifReport {
  tools: Array<{ name: string; version: string | null; informationUri: string | null }>;
  rules: Map<string, SarifRule>;
  results: SarifResult[];
}

type Json = Record<string, unknown>;

const isRecord = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const rec = (value: unknown): Json => (isRecord(value) ? value : {});
const arr = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const str = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;
const num = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const text = (value: unknown): string | null =>
  str(rec(value)["text"]) ?? str(rec(value)["markdown"]);

const LEVELS: readonly SarifLevel[] = ["error", "warning", "note", "none"];

const levelOf = (result: Json, rule: Json | undefined): SarifLevel => {
  const raw =
    str(result["level"]) ?? str(rec(rule?.["defaultConfiguration"])["level"]) ?? "warning";
  return (LEVELS as readonly string[]).includes(raw) ? (raw as SarifLevel) : "warning";
};

/** Fills `{0}` placeholders of a SARIF message from its `arguments`. */
const formatMessage = (message: Json, rule: Json | undefined): string => {
  const own = str(message["text"]);
  const id = str(message["id"]);
  const template = own ?? (id === null ? null : text(rec(rec(rule?.["messageStrings"])[id])));
  const args = arr(message["arguments"]).map((value) => String(value));
  return (template ?? "").replace(
    /\{(\d+)\}/g,
    (match, index: string) => args[Number(index)] ?? match,
  );
};

const resolveUri = (location: Json, baseIds: Json): string | null => {
  const artifact = rec(location["artifactLocation"]);
  const uri = str(artifact["uri"]);
  if (uri === null) return null;
  const base = str(rec(baseIds[str(artifact["uriBaseId"]) ?? ""])["uri"]);
  if (base === null || /^[a-z]+:/i.test(uri)) return decodeURIComponent(uri);
  return decodeURIComponent(`${base.replace(/\/?$/, "/")}${uri}`);
};

export type ParseOutcome = { ok: true; report: SarifReport } | { ok: false; error: string };

export const parseSarif = (source: string): ParseOutcome => {
  let json: unknown;
  try {
    json = JSON.parse(source);
  } catch {
    return { ok: false, error: "The file is not valid JSON." };
  }
  const runs = arr(rec(json)["runs"]).filter(isRecord);
  if (runs.length === 0) return { ok: false, error: "The file has no SARIF runs." };

  const tools: SarifReport["tools"] = [];
  const rules = new Map<string, SarifRule>();
  const results: SarifResult[] = [];

  runs.forEach((run, runIndex) => {
    const driver = rec(rec(run["tool"])["driver"]);
    const toolName = str(driver["name"]) ?? "Unknown tool";
    if (!tools.some((tool) => tool.name === toolName)) {
      tools.push({
        name: toolName,
        version: str(driver["version"]) ?? str(driver["semanticVersion"]),
        informationUri: str(driver["informationUri"]),
      });
    }
    const runRules = arr(driver["rules"]).filter(isRecord);
    for (const rule of runRules) {
      const id = str(rule["id"]);
      if (id === null || rules.has(id)) continue;
      rules.set(id, {
        id,
        // A rule id such as `fallow/unused-file` reads better than a sentence-long description.
        name: str(rule["name"]) ?? id.replace(/^[^/]+\//, ""),
        description: text(rule["fullDescription"]) ?? text(rule["shortDescription"]),
        helpUri: str(rule["helpUri"]),
      });
    }
    const baseIds = rec(run["originalUriBaseIds"]);
    arr(run["results"])
      .filter(isRecord)
      .forEach((result, resultIndex) => {
        const ruleIndex = num(result["ruleIndex"]);
        const ruleJson = ruleIndex === null ? undefined : runRules[ruleIndex];
        const ruleId = str(result["ruleId"]) ?? str(ruleJson?.["id"]) ?? "unknown";
        const location = rec(arr(result["locations"]).filter(isRecord)[0]);
        const physical = rec(location["physicalLocation"]);
        const region = rec(physical["region"]);
        results.push({
          key: `${runIndex}:${resultIndex}`,
          tool: toolName,
          ruleId,
          level: levelOf(result, ruleJson ?? runRules.find((rule) => rule["id"] === ruleId)),
          message: formatMessage(rec(result["message"]), ruleJson),
          uri: resolveUri(physical, baseIds),
          line: num(region["startLine"]),
          column: num(region["startColumn"]),
          baselineState: str(result["baselineState"]),
        });
      });
  });
  return { ok: true, report: { tools, rules, results } };
};
