import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ReadResourceResult } from "@modelcontextprotocol/sdk/types.js";
import { createMentions, type OpenAIMentionItem } from "@openai/mcp-extensions/server";
import { CATEGORY_TITLES } from "../shared/categories.ts";
import type { Finding, ProjectRef } from "../shared/contracts.ts";
import type { Analysis } from "./analysis.ts";
import type { Extra, ServerContext } from "./context.ts";
import { categoryThumbnail } from "./icons.ts";
import { describeProject, resolveProject, sandboxFor } from "./project.ts";
import { findingMarkdown, reportText } from "./summary.ts";
import {
  FINDING_TEMPLATE,
  findingUri,
  REPORT_TEMPLATE,
  rootFromKey,
  RULE_TEMPLATE,
  ruleUri,
} from "./uris.ts";

const MAX_ITEMS = 25;
const MENTION_WAIT_MS = 8000;
const MARKDOWN = "text/markdown";

const location = (finding: Finding): string =>
  finding.line === null ? finding.path : `${finding.path}:${finding.line}`;

const haystack = (finding: Finding): string =>
  [
    finding.title,
    finding.message,
    finding.path,
    finding.symbol ?? "",
    finding.rule,
    CATEGORY_TITLES[finding.category],
  ]
    .join(" ")
    .toLowerCase();

/** Ranks a finding for a typeahead query. Higher is better; null drops it. */
const rank = (finding: Finding, terms: string[]): number | null => {
  const text = haystack(finding);
  if (!terms.every((term) => text.includes(term))) return null;
  const symbol = (finding.symbol ?? "").toLowerCase();
  const file = finding.path.toLowerCase().split("/").pop() ?? "";
  let score = finding.level === "error" ? 2 : 1;
  for (const term of terms) {
    if (symbol === term) score += 8;
    else if (symbol.startsWith(term)) score += 5;
    if (file.startsWith(term)) score += 3;
  }
  return score;
};

const findingItem = (project: ProjectRef, finding: Finding): OpenAIMentionItem => ({
  type: "resource",
  resourceUri: findingUri(project.root, finding.id),
  title: finding.symbol === null ? finding.title : `${finding.title}: ${finding.symbol}`,
  subtitle: location(finding),
  icons: [categoryThumbnail(finding.category)],
});

const ruleItems = (
  project: ProjectRef,
  findings: Finding[],
  terms: string[],
): OpenAIMentionItem[] => {
  const rules = new Map<string, Finding[]>();
  for (const finding of findings)
    rules.set(finding.rule, [...(rules.get(finding.rule) ?? []), finding]);
  return [...rules.values()]
    .filter((group) => {
      const first = group[0];
      if (first === undefined) return false;
      const text = `${first.title} ${first.rule} ${CATEGORY_TITLES[first.category]}`.toLowerCase();
      return terms.every((term) => text.includes(term));
    })
    .sort((left, right) => right.length - left.length)
    .flatMap((group): OpenAIMentionItem[] => {
      const first = group[0];
      if (first === undefined) return [];
      return [
        {
          type: "resource",
          resourceUri: ruleUri(project.root, first.rule),
          title: `All: ${first.title.toLowerCase()} (${group.length})`,
          subtitle: `${CATEGORY_TITLES[first.category]} in ${project.name}`,
          icons: [categoryThumbnail(first.category)],
        },
      ];
    });
};

const withDeadline = <T>(promise: Promise<T>, ms: number): Promise<T | null> =>
  Promise.race([
    promise,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms).unref()),
  ]);

/** The findings of a project: the cached report, else a new run that the caller may wait for. */
const projectFindings = async (
  context: ServerContext,
  project: ProjectRef,
  extra: Extra | null,
  waitMs: number | null,
): Promise<Finding[] | null> => {
  const cached = context.analyzer.latest(project.root);
  if (cached !== null) return cached.findings;
  const run: Promise<Analysis> = context.analyzer.analyze({
    project,
    settings: await context.store.settings(),
    sandbox: extra === null ? null : sandboxFor(extra._meta),
  });
  const analysis = waitMs === null ? await run : await withDeadline(run, waitMs);
  return analysis !== null && analysis.ok ? analysis.findings : null;
};

/** Only a project the user opened before may be read through a `fallow://` URI. */
const knownProject = async (context: ServerContext, key: string): Promise<ProjectRef | null> => {
  const root = rootFromKey(key);
  if (root === null) return null;
  const known =
    context.analyzer.latest(root) !== null ||
    (await context.store.recents()).some((recent) => recent.root === root);
  return known ? describeProject(root) : null;
};

const markdown = (uri: URL, text: string): ReadResourceResult => ({
  contents: [{ uri: uri.href, mimeType: MARKDOWN, text }],
});

const variable = (value: string | string[] | undefined): string =>
  decodeURIComponent(Array.isArray(value) ? (value[0] ?? "") : (value ?? ""));

export const registerMentions = (context: ServerContext): void => {
  const { server } = context;

  createMentions(server).setHandler(async ({ query }, extra) => {
    const resolved = await resolveProject(context.store, extra._meta, undefined);
    if (resolved === null) return { items: [] };
    const findings = await projectFindings(context, resolved.project, extra, MENTION_WAIT_MS);
    if (findings === null) return { items: [] };
    const terms = query
      .toLowerCase()
      .split(/\s+/)
      .filter((term) => term.length > 0);
    const ranked = findings
      .map((finding) => ({ finding, score: rank(finding, terms) }))
      .filter((entry): entry is { finding: Finding; score: number } => entry.score !== null)
      .sort((left, right) => right.score - left.score)
      .map((entry) => findingItem(resolved.project, entry.finding));
    const groups = ruleItems(resolved.project, findings, terms).slice(
      0,
      terms.length === 0 ? 4 : 2,
    );
    return { items: [...groups, ...ranked].slice(0, MAX_ITEMS) };
  });

  server.registerResource(
    "fallow-finding",
    new ResourceTemplate(FINDING_TEMPLATE, { list: undefined }),
    { title: "Fallow finding", mimeType: MARKDOWN },
    async (uri, variables) => {
      const project = await knownProject(context, variable(variables["key"]));
      if (project === null) throw new Error("Unknown Fallow project. Open it in Fallow first.");
      const id = variable(variables["id"]);
      const finding = (await projectFindings(context, project, null, null))?.find(
        (candidate) => candidate.id === id,
      );
      return markdown(
        uri,
        finding === undefined
          ? `# Finding no longer reported\n\nFallow no longer reports \`${id}\` in ${project.name}. The code may have changed. Run the Fallow analysis again.`
          : findingMarkdown(finding, project),
      );
    },
  );

  server.registerResource(
    "fallow-rule",
    new ResourceTemplate(RULE_TEMPLATE, { list: undefined }),
    { title: "Fallow findings of one rule", mimeType: MARKDOWN },
    async (uri, variables) => {
      const project = await knownProject(context, variable(variables["key"]));
      if (project === null) throw new Error("Unknown Fallow project. Open it in Fallow first.");
      const rule = variable(variables["rule"]);
      const findings = ((await projectFindings(context, project, null, null)) ?? []).filter(
        (finding) => finding.rule === rule,
      );
      const title = findings[0]?.title ?? rule;
      const lines = [
        `# ${title} in ${project.name}`,
        "",
        `${findings.length} findings. Verify each one before you change code.`,
        "",
        ...findings
          .slice(0, 200)
          .map(
            (finding) =>
              `- \`${location(finding)}\`: ${finding.message}${finding.verify === null ? "" : ` Verify: \`${finding.verify}\``}`,
          ),
      ];
      if (findings.length > 200) lines.push("", `${findings.length - 200} more are not listed.`);
      lines.push("", `Learn more: \`fallow explain ${rule}\``);
      return markdown(uri, lines.join("\n"));
    },
  );

  server.registerResource(
    "fallow-report",
    new ResourceTemplate(REPORT_TEMPLATE, { list: undefined }),
    { title: "Fallow report", mimeType: MARKDOWN },
    async (uri, variables) => {
      const project = await knownProject(context, variable(variables["key"]));
      if (project === null) throw new Error("Unknown Fallow project. Open it in Fallow first.");
      const cached = context.analyzer.latest(project.root);
      if (cached === null)
        return markdown(uri, `# ${project.name}\n\nNo Fallow report yet. Run the analysis first.`);
      return markdown(uri, reportText(cached.report, cached.findings, 50));
    },
  );
};

