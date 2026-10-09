/**
 * Payloads that the server sends to the app as `structuredContent`.
 * The server builds them; the app only reads them. Keep both sides on these types.
 */

export type Level = "error" | "warn" | "info";

export type CategoryId =
  | "dead-code"
  | "dependencies"
  | "duplication"
  | "complexity"
  | "architecture"
  | "frameworks"
  | "hygiene";

export interface FindingAction {
  type: string;
  description: string;
  autoFixable: boolean;
  comment: string | null;
}

export interface CloneInstance {
  path: string;
  startLine: number;
  endLine: number;
}

export interface Finding {
  /** Stable id from fallow (`finding_id` or the clone fingerprint). */
  id: string;
  /** Kebab-case rule id, as `fallow explain <rule>` accepts it. */
  rule: string;
  /** Singular rule title, for example "Unused export". */
  title: string;
  category: CategoryId;
  level: Level;
  /** One sentence for people and for Codex. */
  message: string;
  /** Repo-relative POSIX path. */
  path: string;
  line: number | null;
  /** The export, dependency, function or member that the finding names. */
  symbol: string | null;
  /** `true` when an audit found the issue in changed code. `null` outside an audit. */
  introduced: boolean | null;
  /** A read-only fallow command that proves or explains the finding. */
  verify: string | null;
  actions: FindingAction[];
  /** Extra files of a cycle or a clone group. */
  related: CloneInstance[];
}

export interface Hotspot {
  path: string;
  score: number;
  commits: number;
  trend: string;
  fanIn: number | null;
}

export interface Target {
  path: string;
  recommendation: string;
  category: string;
  effort: string;
  priority: number;
}

export interface Vitals {
  files: number | null;
  functions: number | null;
  lines: number | null;
  maintainability: number | null;
  duplicationPct: number | null;
  deadFilePct: number | null;
  deadExportPct: number | null;
  avgCyclomatic: number | null;
}

export interface Score {
  value: number;
  grade: string;
  /** Points lost per dimension, largest first. Zero entries are dropped. */
  penalties: Array<{ dimension: string; points: number }>;
}

export interface ProjectRef {
  /** Absolute project root on the host. The app shows it and sends it back. */
  root: string;
  name: string;
  branch: string | null;
}

export interface Report {
  project: ProjectRef;
  /** `full` covers the project, `changed` covers files changed since `base`. */
  scope: "full" | "changed";
  base: string | null;
  analyzedAt: string;
  durationMs: number;
  fallowVersion: string;
  score: Score | null;
  vitals: Vitals;
  counts: {
    total: number;
    byLevel: Record<Level, number>;
    byCategory: Record<CategoryId, number>;
  };
  findings: Finding[];
  /** Number of findings that the report left out to stay small. */
  omitted: number;
  hotspots: Hotspot[];
  targets: Target[];
  nextSteps: Array<{ command: string; reason: string }>;
}

export interface AuditResult {
  project: ProjectRef;
  verdict: "pass" | "warn" | "fail";
  base: string;
  baseDescription: string | null;
  changedFiles: number;
  analyzedAt: string;
  durationMs: number;
  fallowVersion: string;
  introduced: number;
  inherited: number;
  findings: Finding[];
  omitted: number;
}

export interface RecentProject {
  root: string;
  name: string;
  lastOpenedAt: string;
  grade: string | null;
  score: number | null;
}

export interface FallowProblem {
  /** Machine-readable reason, for example `fallow_not_found`. */
  code: string;
  title: string;
  detail: string;
  /** A command that fixes the problem, when one exists. */
  fix: string | null;
}

export type ViewPayload =
  | { view: "dashboard"; report: Report; route: string | null }
  | { view: "loading"; project: ProjectRef; route: string | null; scope: Report["scope"] }
  | { view: "audit"; audit: AuditResult }
  | { view: "finding"; finding: Finding; project: ProjectRef }
  | { view: "picker"; recents: RecentProject[]; reason: string }
  | { view: "problem"; problem: FallowProblem; project: ProjectRef | null }
  | { view: "config"; file: { name: string; resourceUri: string } }
  | { view: "sarif"; file: { name: string; resourceUri: string } };

/** Result of the app-only `fallow.app.locate` tool: an absolute path the app may open. */
export interface LocatedFile {
  path: string;
  exists: boolean;
}

/** Result of the app-only `fallow.app.preview_config` tool. */
export interface ConfigPreview {
  ok: boolean;
  /** Findings with the saved config and with the draft. Null when a run failed. */
  before: number | null;
  after: number | null;
  error: string | null;
  byCategory: Array<{ category: CategoryId; before: number; after: number }>;
}
