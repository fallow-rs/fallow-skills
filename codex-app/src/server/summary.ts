import { CATEGORY_ORDER, CATEGORY_TITLES } from "../shared/categories.ts";
import type { AuditResult, Finding, ProjectRef, Report } from "../shared/contracts.ts";

/**
 * Codex gives the model `structuredContent` and drops `content` when both exist.
 * So these summaries stay small, and the full payload for the app travels in `_meta`.
 */

const location = (finding: Finding): string =>
  finding.line === null ? finding.path : `${finding.path}:${finding.line}`;

const compactFinding = (finding: Finding) => ({
  id: finding.id,
  rule: finding.rule,
  level: finding.level,
  location: location(finding),
  message: finding.message,
  verify: finding.verify,
  fix: finding.actions.find(
    (action) => action.type !== "suppress-line" && action.type !== "suppress-file",
  )?.description,
  ...(finding.introduced === null ? {} : { introduced: finding.introduced }),
});

const GUIDANCE = [
  "Run the `verify` command of a finding before you delete code. Static analysis cannot see dynamic imports or runtime registration.",
  "For auto-fixable unused exports and dependencies, preview with `fallow fix --dry-run` before `fallow fix`.",
  "Do not suppress a finding to make it go away. Fix it, or explain why it is a false positive.",
];

const projectLine = (project: ProjectRef): string =>
  project.branch === null
    ? `${project.name} (${project.root})`
    : `${project.name} on ${project.branch} (${project.root})`;

export const reportSummary = (report: Report, findings: Finding[], limit: number) => {
  const shown = findings.slice(0, limit);
  return {
    project: report.project,
    scope: report.scope,
    ...(report.base === null ? {} : { base: report.base }),
    analyzedAt: report.analyzedAt,
    fallowVersion: report.fallowVersion,
    healthScore:
      report.score === null
        ? null
        : {
            score: report.score.value,
            grade: report.score.grade,
            largestPenalties: report.score.penalties.slice(0, 3),
          },
    totals: {
      findings: report.counts.total,
      errors: report.counts.byLevel.error,
      warnings: report.counts.byLevel.warn,
      byCategory: Object.fromEntries(
        CATEGORY_ORDER.filter((category) => report.counts.byCategory[category] > 0).map(
          (category) => [category, report.counts.byCategory[category]],
        ),
      ),
    },
    findings: shown.map(compactFinding),
    notShown: Math.max(0, findings.length - shown.length),
    topRefactoringTargets: report.targets.slice(0, 3).map((target) => ({
      path: target.path,
      recommendation: target.recommendation,
      effort: target.effort,
    })),
    ...(report.notices.length === 0 ? {} : { notices: report.notices }),
    guidance: GUIDANCE,
  };
};

export const reportText = (report: Report, findings: Finding[], limit: number): string => {
  const lines = [`Fallow analyzed ${projectLine(report.project)}.`, ...report.notices];
  if (report.score !== null)
    lines.push(`Health score ${report.score.value} (grade ${report.score.grade}).`);
  const categories = CATEGORY_ORDER.filter((category) => report.counts.byCategory[category] > 0)
    .map((category) => `${CATEGORY_TITLES[category]} ${report.counts.byCategory[category]}`)
    .join(", ");
  lines.push(
    report.counts.total === 0 ? "No findings." : `${report.counts.total} findings: ${categories}.`,
  );
  for (const finding of findings.slice(0, limit)) {
    lines.push(
      `- [${finding.level}] ${location(finding)}: ${finding.message}${finding.verify === null ? "" : ` Verify: \`${finding.verify}\``}`,
    );
  }
  if (findings.length > limit)
    lines.push(`${findings.length - limit} more findings are in the Fallow dashboard.`);
  return lines.join("\n");
};

export const auditSummary = (audit: AuditResult, limit: number) => ({
  project: audit.project,
  verdict: audit.verdict,
  base: audit.base,
  changedFiles: audit.changedFiles,
  introducedFindings: audit.introduced,
  inheritedFindings: audit.inherited,
  findings: audit.findings.slice(0, limit).map(compactFinding),
  notShown: Math.max(0, audit.findings.length + audit.omitted - limit),
  guidance: [
    "Fix introduced findings before you commit. Inherited findings existed before this branch.",
    ...GUIDANCE.slice(0, 1),
  ],
});

export const auditText = (audit: AuditResult, limit: number): string => {
  const lines = [
    `Fallow audit of ${projectLine(audit.project)} against ${audit.base}: ${audit.verdict.toUpperCase()}.`,
    `${audit.changedFiles} changed files, ${audit.introduced} introduced and ${audit.inherited} inherited findings.`,
  ];
  for (const finding of audit.findings.slice(0, limit)) {
    lines.push(
      `- [${finding.introduced === true ? "new" : "old"}] ${location(finding)}: ${finding.message}`,
    );
  }
  return lines.join("\n");
};

/** Markdown for one finding: the body of a mention resource and of the finding tool. */
export const findingMarkdown = (finding: Finding, project: ProjectRef): string => {
  const lines = [
    `# ${finding.title}: ${finding.symbol ?? finding.path}`,
    "",
    finding.message,
    "",
    `- Project: ${projectLine(project)}`,
    `- Location: \`${location(finding)}\``,
    `- Rule: \`${finding.rule}\` (${finding.level})`,
    `- Finding id: \`${finding.id}\``,
  ];
  if (finding.related.length > 0) {
    lines.push("- Related locations:");
    for (const related of finding.related) {
      lines.push(
        related.startLine > 0
          ? `  - \`${related.path}:${related.startLine}-${related.endLine}\``
          : `  - \`${related.path}\``,
      );
    }
  }
  if (finding.verify !== null)
    lines.push("", "Verify before you change code:", "", "```sh", finding.verify, "```");
  if (finding.actions.length > 0) {
    lines.push("", "Suggested actions:");
    for (const action of finding.actions) {
      const suffix = action.comment === null ? "" : ` (\`${action.comment}\`)`;
      lines.push(`- ${action.description}${action.autoFixable ? " (auto-fixable)" : ""}${suffix}`);
    }
  }
  lines.push("", `Learn more: \`fallow explain ${finding.rule}\``);
  return lines.join("\n");
};
