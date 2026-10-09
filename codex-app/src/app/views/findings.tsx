import type { JSX } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import { CATEGORY_COLORS, CATEGORY_TITLES } from "../../shared/categories.ts";
import type { Finding, ProjectRef } from "../../shared/contracts.ts";
import {
  Button,
  CategoryLabel,
  CommandLine,
  EmptyState,
  Icon,
  LevelDot,
  LoadingStatus,
  PathLabel,
} from "../components/ui.tsx";
import type { Host } from "../host.ts";

const location = (finding: Finding): string =>
  finding.line === null ? finding.path : `${finding.path}:${finding.line}`;

/** Renders `code` spans of a fallow message. */
export const Message = ({ text }: { text: string }): JSX.Element => (
  <>
    {text
      .split(/(`[^`]+`)/)
      .map((part, index) =>
        part.startsWith("`") && part.endsWith("`") && part.length > 1 ? (
          <code key={index}>{part.slice(1, -1)}</code>
        ) : (
          <span key={index}>{part}</span>
        ),
      )}
  </>
);

const openFinding = async (
  host: Host,
  project: ProjectRef,
  path: string,
): Promise<void> => {
  const located = await host.callData<{ path: string | null }>("fallow_app_locate", {
    path,
    root: project.root,
  });
  if (located.path !== null) await host.openFile(located.path);
};

type FindingListProps = {
  host: Host;
  project: ProjectRef;
  findings: Finding[];
  selected: Set<string>;
  onToggle: (finding: Finding) => void;
  onToggleMany: (findings: Finding[], select: boolean) => void;
  onOpen: (finding: Finding) => void;
  groupBy: "file" | "rule";
  showIntroduced?: boolean;
};

const groupKey = (finding: Finding, groupBy: "file" | "rule"): string =>
  groupBy === "file" ? finding.path : finding.rule;

const PAGE = 120;

export const FindingList = ({
  host,
  project,
  findings,
  selected,
  onToggle,
  onToggleMany,
  onOpen,
  groupBy,
  showIntroduced = false,
}: FindingListProps): JSX.Element => {
  const [limit, setLimit] = useState(PAGE);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  useEffect(() => setLimit(PAGE), [findings]);

  const groups = useMemo(() => {
    const map = new Map<string, Finding[]>();
    for (const finding of findings.slice(0, limit)) {
      const key = groupKey(finding, groupBy);
      map.set(key, [...(map.get(key) ?? []), finding]);
    }
    return [...map];
  }, [findings, groupBy, limit]);

  if (findings.length === 0) {
    return (
      <EmptyState icon="check" title="Nothing to show">
        No findings match these filters.
      </EmptyState>
    );
  }

  return (
    <div class="f-list" role="list">
      {groups.map(([key, items]) => {
        const first = items[0];
        const isCollapsed = collapsed.has(key);
        const allSelected = items.every((finding) => selected.has(finding.id));
        return (
          <section class="f-group" key={key} role="listitem">
            <header class="f-group-header">
              <input
                type="checkbox"
                class="form-check-input"
                checked={allSelected}
                ref={(element) => {
                  // A partial selection shows as a dash, so the next click reads as "select the rest".
                  if (element !== null) element.indeterminate = !allSelected && items.some((finding) => selected.has(finding.id));
                }}
                aria-label={`Select all findings in ${key}`}
                onChange={() => onToggleMany(items, !allSelected)}
              />
              <button
                type="button"
                class="f-group-toggle cursor-interaction"
                aria-expanded={!isCollapsed}
                onClick={() =>
                  setCollapsed((current) => {
                    const next = new Set(current);
                    if (next.has(key)) next.delete(key);
                    else next.add(key);
                    return next;
                  })
                }
              >
                <span class={`f-chevron ${isCollapsed ? "" : "f-open"}`}>
                  <Icon name="chevronRight" size={14} />
                </span>
                {groupBy === "file" ? (
                  <PathLabel path={key} />
                ) : first === undefined ? null : (
                  <span class="f-group-rule">
                    <span
                      class="f-swatch"
                      style={{ background: CATEGORY_COLORS[first.category] }}
                    />
                    {first.title}
                  </span>
                )}
                <span class="f-count">{items.length}</span>
              </button>
              {groupBy === "file" && host.canOpenFiles ? (
                <Button
                  size="sm"
                  variant="ghost"
                  icon="file"
                  title={`Open ${key}`}
                  onClick={() => void openFinding(host, project, key)}
                />
              ) : null}
            </header>
            {isCollapsed ? null : (
              <ul class="f-rows">
                {items.map((finding) => (
                  <li
                    key={finding.id}
                    class={`f-row ${selected.has(finding.id) ? "f-selected" : ""}`}
                  >
                    <input
                      type="checkbox"
                      class="form-check-input"
                      checked={selected.has(finding.id)}
                      aria-label={`Select ${finding.title} at ${location(finding)}`}
                      onChange={() => onToggle(finding)}
                    />
                    <button
                      type="button"
                      class="f-row-main cursor-interaction"
                      onClick={() => onOpen(finding)}
                    >
                      <span class="f-row-title">
                        <LevelDot level={finding.level} />
                        <span class="f-row-rule">{finding.title}</span>
                        {showIntroduced && finding.introduced === true ? (
                          <span class="f-badge f-badge-new">New</span>
                        ) : null}
                        {finding.actions.some((action) => action.autoFixable) ? (
                          <span class="f-badge" title="fallow fix can apply this change">
                            Auto-fix
                          </span>
                        ) : null}
                      </span>
                      <span class="f-row-message">
                        <Message text={finding.message} />
                      </span>
                      <span class="f-row-location">
                        {groupBy === "file"
                          ? finding.line === null
                            ? "file"
                            : `line ${finding.line}`
                          : location(finding)}
                      </span>
                    </button>
                    <span class="f-row-chevron" aria-hidden="true">
                      <Icon name="chevronRight" size={14} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
      {findings.length > limit ? (
        <div class="f-more">
          <Button size="sm" onClick={() => setLimit((current) => current + PAGE * 2)}>
            Show more ({findings.length - limit} left)
          </Button>
        </div>
      ) : null}
      <p class="sr-only" role="status">
        {limit > PAGE ? `Showing ${Math.min(limit, findings.length)} of ${findings.length} findings.` : ""}
      </p>
    </div>
  );
};

interface Explanation {
  found: boolean;
  name?: string;
  summary?: string | null;
  rationale?: string | null;
  howToFix?: string | null;
  docs?: string | null;
}

interface Snippet {
  found: boolean;
  startLine?: number;
  lines?: string[];
}

const CodeSnippet = ({
  snippet,
  focus,
}: {
  snippet: Snippet;
  focus: number | null;
}): JSX.Element | null => {
  if (!snippet.found || snippet.lines === undefined || snippet.startLine === undefined) return null;
  const start = snippet.startLine;
  return (
    <pre class="f-code" aria-label="Source">
      {snippet.lines.map((line, index) => {
        const number = start + index;
        return (
          <div key={number} class={`f-code-line ${number === focus ? "f-code-focus" : ""}`}>
            <span class="f-code-number">{number}</span>
            <span class="f-code-text">{line.length === 0 ? " " : line}</span>
          </div>
        );
      })}
    </pre>
  );
};

type DetailProps = {
  host: Host;
  project: ProjectRef;
  finding: Finding;
  attached: boolean;
  onBack?: () => void;
  onAttach: () => void;
};

export const FindingDetail = ({
  host,
  project,
  finding,
  attached,
  onBack,
  onAttach,
}: DetailProps): JSX.Element => {
  const [snippet, setSnippet] = useState<Snippet | null>(null);
  const [explanation, setExplanation] = useState<Explanation | null>(null);

  useEffect(() => {
    let live = true;
    setSnippet(null);
    setExplanation(null);
    if (finding.line !== null) {
      host
        .callData<Snippet>("fallow_app_source", {
          root: project.root,
          path: finding.path,
          line: finding.line,
          context: 5,
        })
        .then((value) => live && setSnippet(value))
        .catch(() => live && setSnippet({ found: false }));
    }
    host
      .callData<Explanation>("fallow_app_explain", { rule: finding.rule, root: project.root })
      .then((value) => live && setExplanation(value))
      .catch(() => live && setExplanation({ found: false }));
    return () => {
      live = false;
    };
  }, [finding.id]);

  const fixes = finding.actions.filter((action) => !action.type.startsWith("suppress"));
  const suppressions = finding.actions.filter((action) => action.type.startsWith("suppress"));

  return (
    <article class="f-detail">
      <header class="f-detail-header">
        {onBack === undefined ? null : (
          <Button
            size="sm"
            variant="ghost"
            icon="chevronLeft"
            title="Back to the list"
            onClick={onBack}
          />
        )}
        <div class="f-detail-heading">
          <span class="f-detail-kicker">
            <CategoryLabel category={finding.category} />
            <LevelDot level={finding.level} />
            {finding.introduced === true ? (
              <span class="f-badge f-badge-new">New on this branch</span>
            ) : null}
          </span>
          <h2>
            {finding.title}
            {finding.symbol === null ? null : <code>{finding.symbol}</code>}
          </h2>
        </div>
      </header>

      <p class="f-detail-message">
        <Message text={finding.message} />
      </p>

      <div class="f-detail-actions">
        {host.canMessage ? (
          <Button
            variant="primary"
            icon="sparkle"
            onClick={() =>
              void host.send(
                `Fix this Fallow finding in ${project.name}. Run its verify command first, and keep the change small.`,
                [finding],
                project,
              )
            }
          >
            Fix with Codex
          </Button>
        ) : null}
        {host.canAttach ? (
          <Button icon={attached ? "check" : "attach"} pressed={attached} onClick={onAttach}>
            {attached ? "In chat" : "Add to chat"}
          </Button>
        ) : null}
        {host.canOpenFiles ? (
          <Button
            icon="file"
            onClick={() => void openFinding(host, project, finding.path)}
          >
            Open file
          </Button>
        ) : null}
      </div>

      <section class="f-detail-section">
        <h3>Location</h3>
        <p class="f-path f-path-block">{location(finding)}</p>
        {finding.line === null ? null : snippet === null ? (
          <div class="f-code f-code-loading">
            <LoadingStatus label="Loading the source" />
          </div>
        ) : (
          <CodeSnippet snippet={snippet} focus={finding.line} />
        )}
        {finding.related.length > 0 ? (
          <ul class="f-related">
            {finding.related.map((related) => (
              <li key={`${related.path}:${related.startLine}`}>
                <button
                  type="button"
                  class="f-link cursor-interaction"
                  disabled={!host.canOpenFiles}
                  onClick={() => void openFinding(host, project, related.path)}
                >
                  {related.startLine > 0
                    ? `${related.path}:${related.startLine}-${related.endLine}`
                    : related.path}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {finding.verify === null ? null : (
        <section class="f-detail-section">
          <h3>Verify first</h3>
          <p class="f-muted">
            Static analysis cannot see dynamic imports. This command shows the evidence.
          </p>
          <CommandLine command={finding.verify} />
        </section>
      )}

      {fixes.length > 0 || suppressions.length > 0 ? (
        <section class="f-detail-section">
          <h3>How to fix</h3>
          <ul class="f-actions-list">
            {fixes.map((action) => (
              <li key={action.type}>
                <Icon name={action.autoFixable ? "wand" : "chevronRight"} size={14} />
                <span>{action.description}</span>
                {action.autoFixable ? <span class="f-badge">Auto-fix</span> : null}
              </li>
            ))}
            {suppressions.map((action) => (
              <li key={action.type} class="f-muted">
                <Icon name="info" size={14} />
                <span>
                  {action.description}
                  {action.comment === null ? null : (
                    <>
                      {" "}
                      <code>{action.comment}</code>
                    </>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section class="f-detail-section">
        <h3>Why this matters</h3>
        {explanation === null ? (
          <LoadingStatus label="Loading the explanation" />
        ) : explanation.found ? (
          <div class="f-explain">
            {explanation.rationale === null || explanation.rationale === undefined ? null : (
              <p>{explanation.rationale}</p>
            )}
            {explanation.howToFix === null || explanation.howToFix === undefined ? null : (
              <p class="f-muted">{explanation.howToFix}</p>
            )}
            {explanation.docs === null || explanation.docs === undefined ? null : (
              <button
                type="button"
                class="f-link cursor-interaction"
                onClick={() => void host.openLink(explanation.docs ?? "")}
              >
                Read the {CATEGORY_TITLES[finding.category].toLowerCase()} docs{" "}
                <Icon name="external" size={12} />
              </button>
            )}
          </div>
        ) : (
          <CommandLine command={`fallow explain ${finding.rule}`} />
        )}
      </section>
    </article>
  );
};
