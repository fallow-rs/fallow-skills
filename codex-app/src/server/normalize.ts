import { isAbsolute, relative, sep } from "node:path";
import { CATEGORY_ORDER, emptyCategoryCounts } from "../shared/categories.ts";
import type {
  AuditResult,
  CloneInstance,
  Finding,
  FindingAction,
  Hotspot,
  Level,
  ProjectRef,
  Report,
  Score,
  Target,
  Vitals,
} from "../shared/contracts.ts";
import { array, boolean, isRecord, number, record, string, type Json } from "./json.ts";
import { complexityRule, DUPLICATION_RULE, ruleForKey, type RuleInfo } from "./rules.ts";

/** The app renders at most this many findings; counts still cover every finding. */
export const REPORT_FINDINGS_LIMIT = 1500;

const SHELL_SAFE = /^[\w@%+=:,./-]+$/;

const quote = (value: string): string =>
  SHELL_SAFE.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`;

const toLevel = (value: unknown): Level => {
  if (value === "error" || value === "critical") return "error";
  if (value === "warn" || value === "warning" || value === "high" || value === "moderate")
    return "warn";
  return "info";
};

const LEVEL_RANK: Record<Level, number> = { error: 0, warn: 1, info: 2 };

/** Makes a fallow path repo-relative with forward slashes, whatever form fallow printed. */
export const repoPath = (root: string, path: string): string => {
  const local = isAbsolute(path) ? relative(root, path) : path;
  return local.split(sep).join("/");
};

const toActions = (value: unknown): FindingAction[] =>
  array(value)
    .filter(isRecord)
    .map((action) => ({
      type: string(action["type"]) ?? "action",
      description: string(action["description"]) ?? "",
      autoFixable: boolean(action["auto_fixable"]) ?? false,
      comment: string(action["comment"]),
    }))
    .filter((action) => action.description.length > 0);

const firstImporter = (item: Json): Json => record(array(item["imported_from"])[0]);

const symbolOf = (item: Json): string | null =>
  string(item["export_name"]) ??
  string(item["type_name"]) ??
  string(item["member_name"]) ??
  string(item["package_name"]) ??
  string(item["specifier"]) ??
  string(item["component_name"]) ??
  string(item["name"]);

const pathOf = (item: Json): string | null =>
  string(item["path"]) ??
  string(item["from_path"]) ??
  string(item["file"]) ??
  string(array(item["files"])[0]) ??
  string(firstImporter(item)["path"]);

const code = (value: string): string => `\`${value}\``;

const messageFor = (info: RuleInfo, item: Json, symbol: string | null): string => {
  const parent = string(item["parent_name"]);
  switch (info.rule) {
    case "unused-file":
      return "No entry point reaches this file.";
    case "unused-export":
    case "unused-type":
      return item["is_type_only"] === true || info.rule === "unused-type"
        ? `Type export ${code(symbol ?? "?")} is never imported.`
        : `Export ${code(symbol ?? "?")} is never imported.`;
    case "unused-enum-member":
    case "unused-class-member":
      return parent === null
        ? `Member ${code(symbol ?? "?")} is never used.`
        : `Member ${code(`${parent}.${symbol ?? "?"}`)} is never used.`;
    case "unused-dependency":
    case "unused-dev-dependency":
    case "unused-optional-dependency":
      return `${code(symbol ?? "?")} is listed in ${string(item["location"]) ?? "package.json"} but never imported.`;
    case "unlisted-dependency":
      return `${code(symbol ?? "?")} is imported but not listed in package.json.`;
    case "unresolved-import":
      return `Import ${code(symbol ?? "?")} does not resolve to a file or package.`;
    case "circular-dependency":
    case "re-export-cycle":
    case "package-cycle": {
      const files = array(item["files"]).length;
      return files > 0 ? `${info.title} through ${files} files.` : `${info.title}.`;
    }
    default:
      return symbol === null ? `${info.title}.` : `${info.title}: ${code(symbol)}.`;
  }
};

const verifyFor = (
  rule: string,
  path: string,
  symbol: string | null,
  id: string,
): string | null => {
  if ((rule === "unused-export" || rule === "unused-type") && symbol !== null) {
    return `fallow dead-code --trace ${quote(`${path}:${symbol}`)}`;
  }
  if (rule.endsWith("dependency") && symbol !== null && rule !== "circular-dependency") {
    return `fallow dead-code --trace-dependency ${quote(symbol)}`;
  }
  if (rule === "code-duplication") return `fallow dupes --trace ${quote(id)}`;
  return `fallow inspect --file ${quote(path)}`;
};

const relatedFiles = (root: string, item: Json): CloneInstance[] =>
  array(item["files"])
    .map((file) => string(file))
    .filter((file): file is string => file !== null)
    .map((file) => ({ path: repoPath(root, file), startLine: 0, endLine: 0 }));

const checkFindings = (root: string, section: Json): Finding[] =>
  Object.entries(section).flatMap(([key, value]) => {
    if (!Array.isArray(value) || key === "workspace_diagnostics") return [];
    const info = ruleForKey(key);
    return value.filter(isRecord).flatMap((item): Finding[] => {
      const rawPath = pathOf(item);
      if (rawPath === null) return [];
      const path = repoPath(root, rawPath);
      const symbol = symbolOf(item);
      const line = number(item["line"]) ?? number(firstImporter(item)["line"]);
      const id = string(item["finding_id"]) ?? `${info.rule}:${path}:${line ?? 0}:${symbol ?? ""}`;
      return [
        {
          id,
          rule: info.rule,
          title: info.title,
          category: info.category,
          level: toLevel(item["effective_severity"] ?? "error"),
          message: messageFor(info, item, symbol),
          path,
          line,
          symbol,
          introduced: boolean(item["introduced"]),
          verify: verifyFor(info.rule, path, symbol, id),
          actions: toActions(item["actions"]),
          related: relatedFiles(root, item),
        },
      ];
    });
  });

const complexityFindings = (root: string, section: Json): Finding[] =>
  array(section["findings"])
    .filter(isRecord)
    .flatMap((item): Finding[] => {
      const rawPath = string(item["path"]);
      if (rawPath === null) return [];
      const path = repoPath(root, rawPath);
      const name = string(item["name"]) ?? "<anonymous>";
      const line = number(item["line"]);
      const info = complexityRule(string(item["exceeded"]) ?? "");
      const parts = [
        `cyclomatic ${number(item["cyclomatic"]) ?? "?"}`,
        `cognitive ${number(item["cognitive"]) ?? "?"}`,
      ];
      const crap = number(item["crap"]);
      if (crap !== null) parts.push(`CRAP ${crap}`);
      const id = `complexity:${path}:${line ?? 0}:${name}`;
      return [
        {
          id,
          rule: info.rule,
          title: info.title,
          category: info.category,
          level: toLevel(item["effective_severity"] ?? item["severity"]),
          message: `${code(name)} is hard to change safely (${parts.join(", ")}).`,
          path,
          line,
          symbol: name,
          introduced: boolean(item["introduced"]),
          verify: verifyFor(info.rule, path, name, id),
          actions: toActions(item["actions"]),
          related: [],
        },
      ];
    });

const cloneFindings = (root: string, section: Json): Finding[] =>
  array(section["clone_groups"])
    .filter(isRecord)
    .flatMap((group): Finding[] => {
      const instances = array(group["instances"])
        .filter(isRecord)
        .flatMap((instance): CloneInstance[] => {
          const file = string(instance["file"]);
          if (file === null) return [];
          return [
            {
              path: repoPath(root, file),
              startLine: number(instance["start_line"]) ?? 0,
              endLine: number(instance["end_line"]) ?? 0,
            },
          ];
        });
      const first = instances[0];
      if (first === undefined) return [];
      const id = string(group["fingerprint"]) ?? `clone:${first.path}:${first.startLine}`;
      const lines = number(group["line_count"]) ?? first.endLine - first.startLine + 1;
      return [
        {
          id,
          rule: DUPLICATION_RULE.rule,
          title: DUPLICATION_RULE.title,
          category: DUPLICATION_RULE.category,
          level: "warn",
          message: `${lines} lines are duplicated in ${instances.length} places.`,
          path: first.path,
          line: first.startLine,
          symbol: string(group["suggested_name"]),
          introduced: boolean(group["introduced"]),
          verify: verifyFor(DUPLICATION_RULE.rule, first.path, null, id),
          actions: toActions(group["actions"]),
          related: instances,
        },
      ];
    });

/** Sorts errors first, then by category, file and line, so every surface shows the same order. */
export const sortFindings = (findings: Finding[]): Finding[] =>
  [...findings].sort(
    (left, right) =>
      LEVEL_RANK[left.level] - LEVEL_RANK[right.level] ||
      CATEGORY_ORDER.indexOf(left.category) - CATEGORY_ORDER.indexOf(right.category) ||
      left.path.localeCompare(right.path) ||
      (left.line ?? 0) - (right.line ?? 0),
  );

const toScore = (health: Json): Score | null => {
  const raw = record(health["health_score"]);
  const value = number(raw["score"]);
  const grade = string(raw["grade"]);
  if (value === null || grade === null) return null;
  const penalties = Object.entries(record(raw["penalties"]))
    .map(([dimension, points]) => ({
      dimension: dimension.replace(/_/g, " "),
      points: number(points) ?? 0,
    }))
    .filter((penalty) => penalty.points > 0)
    .sort((left, right) => right.points - left.points);
  return { value, grade, penalties };
};

const toVitals = (health: Json, dupes: Json): Vitals => {
  const vitals = record(health["vital_signs"]);
  const counts = record(vitals["counts"]);
  const summary = record(health["summary"]);
  return {
    files: number(counts["total_files"]) ?? number(summary["files_analyzed"]),
    functions: number(summary["functions_analyzed"]),
    lines: number(counts["total_lines"]) ?? number(vitals["total_loc"]),
    maintainability:
      number(vitals["maintainability_avg"]) ?? number(summary["average_maintainability"]),
    duplicationPct: number(record(dupes["stats"])["duplication_percentage"]),
    deadFilePct: number(vitals["dead_file_pct"]),
    deadExportPct: number(vitals["dead_export_pct"]),
    avgCyclomatic: number(vitals["avg_cyclomatic"]),
  };
};

const toHotspots = (root: string, health: Json): Hotspot[] =>
  array(health["hotspots"])
    .filter(isRecord)
    .flatMap((item): Hotspot[] => {
      const path = string(item["path"]);
      if (path === null) return [];
      return [
        {
          path: repoPath(root, path),
          score: number(item["score"]) ?? 0,
          commits: number(item["commits"]) ?? 0,
          trend: string(item["trend"]) ?? "stable",
          fanIn: number(item["fan_in"]),
        },
      ];
    })
    .slice(0, 12);

const toTargets = (root: string, health: Json): Target[] =>
  array(health["targets"])
    .filter(isRecord)
    .flatMap((item): Target[] => {
      const path = string(item["path"]);
      if (path === null) return [];
      return [
        {
          path: repoPath(root, path),
          recommendation: string(item["recommendation"]) ?? "",
          category: (string(item["category"]) ?? "").replace(/_/g, " "),
          effort: string(item["effort"]) ?? "",
          priority: number(item["priority"]) ?? 0,
        },
      ];
    })
    .slice(0, 8);

const toNextSteps = (raw: Json): Report["nextSteps"] =>
  array(raw["next_steps"])
    .filter(isRecord)
    .flatMap((step) => {
      const command = string(step["command"]);
      return command === null ? [] : [{ command, reason: string(step["reason"]) ?? "" }];
    })
    .slice(0, 4);

const countFindings = (findings: Finding[]): Report["counts"] => {
  const byLevel: Record<Level, number> = { error: 0, warn: 0, info: 0 };
  const byCategory = emptyCategoryCounts();
  for (const finding of findings) {
    byLevel[finding.level] += 1;
    byCategory[finding.category] += 1;
  }
  return { total: findings.length, byLevel, byCategory };
};

export interface ReportContext {
  project: ProjectRef;
  scope: Report["scope"];
  base: string | null;
  analyzedAt: string;
}

/** Every finding of a combined `fallow --format json` run, sorted. Used by the report, mentions and resources. */
export const allFindings = (root: string, raw: Json): Finding[] =>
  sortFindings([
    ...checkFindings(root, record(raw["check"])),
    ...cloneFindings(root, record(raw["dupes"])),
    ...complexityFindings(root, record(raw["health"])),
  ]);

/** Builds the dashboard report from a combined `fallow --score --format json` run. */
export const toReport = (raw: Json, context: ReportContext): Report => {
  const root = context.project.root;
  const health = record(raw["health"]);
  const dupes = record(raw["dupes"]);
  const findings = allFindings(root, raw);
  return {
    project: context.project,
    scope: context.scope,
    base: context.base,
    analyzedAt: context.analyzedAt,
    durationMs: number(raw["elapsed_ms"]) ?? 0,
    fallowVersion: string(raw["version"]) ?? "unknown",
    score: toScore(health),
    vitals: toVitals(health, dupes),
    counts: countFindings(findings),
    findings: findings.slice(0, REPORT_FINDINGS_LIMIT),
    omitted: Math.max(0, findings.length - REPORT_FINDINGS_LIMIT),
    hotspots: toHotspots(root, health),
    targets: toTargets(root, health),
    nextSteps: toNextSteps(raw),
  };
};

const toVerdict = (value: unknown): AuditResult["verdict"] =>
  value === "fail" ? "fail" : value === "warn" ? "warn" : "pass";

/** Builds the audit card from a `fallow audit --format json` run. */
export const toAudit = (raw: Json, project: ProjectRef, analyzedAt: string): AuditResult => {
  const root = project.root;
  const findings = sortFindings([
    ...checkFindings(root, record(raw["dead_code"])),
    ...cloneFindings(root, record(raw["duplication"])),
    ...complexityFindings(root, record(raw["complexity"])),
  ]);
  const introducedFirst = [...findings].sort(
    (left, right) => Number(right.introduced === true) - Number(left.introduced === true),
  );
  const introduced = findings.filter((finding) => finding.introduced === true).length;
  return {
    project,
    verdict: toVerdict(raw["verdict"]),
    base: string(raw["base_ref"]) ?? "HEAD",
    baseDescription: string(raw["base_description"]),
    changedFiles: number(raw["changed_files_count"]) ?? 0,
    analyzedAt,
    durationMs: number(raw["elapsed_ms"]) ?? 0,
    fallowVersion: string(raw["version"]) ?? "unknown",
    introduced,
    inherited: findings.length - introduced,
    findings: introducedFirst.slice(0, REPORT_FINDINGS_LIMIT),
    omitted: Math.max(0, findings.length - REPORT_FINDINGS_LIMIT),
  };
};
