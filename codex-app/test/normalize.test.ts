import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { allFindings, repoPath, toAudit, toReport } from "../src/server/normalize.ts";
import { ruleForKey } from "../src/server/rules.ts";
import { auditSummary, findingMarkdown, reportSummary } from "../src/server/summary.ts";

const fixture = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));

const project = { root: "/project", name: "demo-shop", branch: "feature" };
const combined = fixture("combined.json");

describe("toReport", () => {
  const report = toReport(combined, {
    project,
    scope: "full",
    base: null,
    analyzedAt: "2026-10-09T09:00:00.000Z",
  });

  it("reads the health score and drops zero penalties", () => {
    assert.ok(report.score !== null);
    assert.match(report.score.grade, /^[A-F]$/);
    assert.ok(report.score.penalties.every((penalty) => penalty.points > 0));
    const points = report.score.penalties.map((penalty) => penalty.points);
    assert.deepEqual(
      points,
      [...points].sort((left, right) => right - left),
    );
  });

  it("covers every finding shape: files, exports, dependencies, clones, cycles and complexity", () => {
    const rules = new Set(report.findings.map((finding) => finding.rule));
    for (const rule of [
      "unused-file",
      "unused-export",
      "unused-dependency",
      "code-duplication",
      "circular-dependency",
    ]) {
      assert.ok(rules.has(rule), `missing ${rule}`);
    }
    assert.ok(report.findings.some((finding) => finding.category === "complexity"));
  });

  it("counts by level and by category over all findings", () => {
    const byCategory = Object.values(report.counts.byCategory).reduce(
      (sum, count) => sum + count,
      0,
    );
    const byLevel = Object.values(report.counts.byLevel).reduce((sum, count) => sum + count, 0);
    assert.equal(byCategory, report.counts.total);
    assert.equal(byLevel, report.counts.total);
    assert.equal(report.findings.length + report.omitted, report.counts.total);
  });

  it("sorts errors before warnings", () => {
    const ranks = report.findings.map((finding) => ({ error: 0, warn: 1, info: 2 })[finding.level]);
    assert.deepEqual(
      ranks,
      [...ranks].sort((left, right) => left - right),
    );
  });

  it("gives each finding a stable id, a repo-relative path and a read-only verify command", () => {
    const ids = new Set(report.findings.map((finding) => finding.id));
    assert.equal(ids.size, report.findings.length);
    for (const finding of report.findings) {
      assert.ok(!finding.path.startsWith("/"), finding.path);
      assert.ok(
        finding.verify === null || /^fallow (dead-code|dupes|inspect)\b/.test(finding.verify),
        String(finding.verify),
      );
    }
  });

  it("writes a trace command for an unused export", () => {
    const finding = report.findings.find((candidate) => candidate.rule === "unused-export");
    assert.ok(finding !== undefined && finding.symbol !== null);
    assert.equal(finding.verify, `fallow dead-code --trace ${finding.path}:${finding.symbol}`);
    assert.ok(finding.actions.some((action) => action.autoFixable));
  });

  it("keeps clone instances and cycle files as related locations", () => {
    const clone = report.findings.find((finding) => finding.rule === "code-duplication");
    assert.ok(clone !== undefined);
    assert.ok(clone.related.length >= 2);
    assert.ok(
      clone.related.every(
        (instance) => instance.startLine > 0 && instance.endLine >= instance.startLine,
      ),
    );
    assert.equal(clone.verify, `fallow dupes --trace ${clone.id}`);
    const cycle = report.findings.find((finding) => finding.rule === "circular-dependency");
    assert.ok(cycle !== undefined && cycle.related.length >= 2);
  });

  it("ignores sections it does not understand", () => {
    const sparse = toReport(
      { check: { surprise: [{ nope: true }], summary: {} } },
      {
        project,
        scope: "full",
        base: null,
        analyzedAt: "2026-10-09T09:00:00.000Z",
      },
    );
    assert.equal(sparse.counts.total, 0);
    assert.equal(sparse.score, null);
  });
});

describe("toAudit", () => {
  const audit = toAudit(fixture("audit.json"), project, "2026-10-09T09:00:00.000Z");

  it("reads the verdict and splits introduced from inherited findings", () => {
    assert.equal(audit.verdict, "fail");
    assert.ok(audit.introduced > 0);
    assert.equal(audit.introduced + audit.inherited, audit.findings.length + audit.omitted);
    const firstInherited = audit.findings.findIndex((finding) => finding.introduced !== true);
    assert.ok(
      firstInherited === -1 ||
        audit.findings.slice(firstInherited).every((finding) => finding.introduced !== true),
    );
  });

  it("summarizes for the model without the full payload", () => {
    const summary = auditSummary(audit, 2);
    assert.equal(summary.findings.length, Math.min(2, audit.findings.length));
    assert.equal(summary.introducedFindings, audit.introduced);
  });
});

describe("model summaries", () => {
  const findings = allFindings("/project", combined);
  const report = toReport(combined, {
    project,
    scope: "full",
    base: null,
    analyzedAt: "2026-10-09T09:00:00.000Z",
  });

  it("caps the findings that Codex reads", () => {
    const summary = reportSummary(report, findings, 3);
    assert.equal(summary.findings.length, 3);
    assert.equal(summary.notShown, findings.length - 3);
    assert.ok(JSON.stringify(summary).length < 6000);
  });

  it("renders a finding as markdown with its verify command", () => {
    const finding = findings.find((candidate) => candidate.verify !== null);
    assert.ok(finding !== undefined);
    const markdown = findingMarkdown(finding, project);
    assert.match(markdown, /^# /);
    assert.ok(markdown.includes(finding.verify ?? ""));
    assert.ok(markdown.includes(`fallow explain ${finding.rule}`));
  });
});

describe("rules and paths", () => {
  it("derives a rule for a check key that fallow adds later", () => {
    assert.deepEqual(ruleForKey("unused_widget_slots"), {
      rule: "unused-widget-slot",
      title: "Unused widget slot",
      category: "hygiene",
    });
    assert.equal(ruleForKey("unused_dependencies").rule, "unused-dependency");
  });

  it("makes paths repo-relative with forward slashes", () => {
    assert.equal(repoPath("/project", "/project/src/a.ts"), "src/a.ts");
    assert.equal(repoPath("/project", "src/a.ts"), "src/a.ts");
  });
});
