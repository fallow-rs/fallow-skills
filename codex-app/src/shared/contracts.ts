import type {
  AuditResult,
  CategoryId,
  FallowProblem,
  Finding,
  ProjectRef,
  Report,
} from "../../../agent-view/src/contracts.ts";
import type { ProductionView } from "../../../agent-view/src/production.ts";

/**
 * Payloads that the server sends to the app as `structuredContent`.
 * The server builds them; the app only reads them. Keep both sides on these types.
 * The shared finding and report types live in `agent-view/`.
 */

export interface RecentProject {
  root: string;
  name: string;
  lastOpenedAt: string;
  grade: string | null;
  score: number | null;
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

/** Result of the app-only `fallow_app_production` tool: the production data of one file. */
export interface ProductionResult {
  /** Repo-relative path of the file. */
  path: string;
  production: ProductionView;
}
