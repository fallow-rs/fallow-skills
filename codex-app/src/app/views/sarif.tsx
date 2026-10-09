import type { JSX } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { Button, EmptyState, FallowMark, Icon, PathLabel, Spinner } from "../components/ui.tsx";
import type { Host, TextBlock } from "../host.ts";
import { parseSarif, type SarifLevel, type SarifReport, type SarifResult } from "../sarif.ts";

type FileRef = { name: string; resourceUri: string };

const LEVEL_TO_DOT: Record<SarifLevel, "error" | "warn" | "info"> = {
  error: "error",
  warning: "warn",
  note: "info",
  none: "info",
};

const location = (result: SarifResult): string =>
  result.uri === null
    ? "No location"
    : result.line === null
      ? result.uri
      : `${result.uri}:${result.line}`;

const resultBlock = (result: SarifResult, ruleName: string): TextBlock => ({
  type: "text",
  text: `${result.tool} ${result.level} ${result.ruleId} at ${location(result)}: ${result.message}`,
  _meta: { "openai/title": `${ruleName}: ${location(result).split("/").pop() ?? ""}` },
});

export const SarifViewer = ({ host, file }: { host: Host; file: FileRef }): JSX.Element => {
  const [report, setReport] = useState<SarifReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [level, setLevel] = useState<SarifLevel | "all">("all");
  const [rule, setRule] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const resources = host.openai.resources;

  const load = async (): Promise<void> => {
    if (resources === undefined) {
      setError("This Codex surface cannot open files in apps. Use Codex on the desktop.");
      return;
    }
    try {
      const read = await resources.read({ uri: file.resourceUri, representation: "text" });
      const content = read.contents[0];
      const text =
        content !== undefined && "text" in content && typeof content.text === "string"
          ? content.text
          : "";
      const outcome = parseSarif(text);
      if (outcome.ok) {
        setReport(outcome.report);
        setError(null);
      } else setError(outcome.error);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The file could not be read.");
    }
  };

  useEffect(() => {
    void load();
    if (resources === undefined) return;
    const dispose = resources.addUpdateHandler(async ({ params }) => {
      if (params.uri === file.resourceUri) await load();
    });
    void resources.subscribe({ uri: file.resourceUri }).catch(() => undefined);
    return () => {
      dispose();
      void resources.unsubscribe({ uri: file.resourceUri }).catch(() => undefined);
    };
  }, [file.resourceUri]);

  const results = useMemo(() => {
    if (report === null) return [];
    const terms = query
      .toLowerCase()
      .split(/\s+/)
      .filter((term) => term.length > 0);
    return report.results.filter(
      (result) =>
        (level === "all" || result.level === level) &&
        (rule === null || result.ruleId === rule) &&
        terms.every((term) =>
          `${result.ruleId} ${result.message} ${result.uri ?? ""}`.toLowerCase().includes(term),
        ),
    );
  }, [report, level, rule, query]);

  const ruleCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const result of report?.results ?? [])
      counts.set(result.ruleId, (counts.get(result.ruleId) ?? 0) + 1);
    return [...counts].sort((left, right) => right[1] - left[1]);
  }, [report]);

  const ruleName = (id: string): string => report?.rules.get(id)?.name ?? id.replace(/^[^/]+\//, "");
  const attachedOnce = useRef(false);

  useEffect(() => {
    const modelContext = host.openai.modelContext;
    if (modelContext === undefined || report === null) return;
    if (selected.size === 0 && !attachedOnce.current) return;
    attachedOnce.current = true;
    const chosen = report.results.filter((result) => selected.has(result.key)).slice(0, 25);
    const timer = setTimeout(() => {
      void modelContext.update({
        content: chosen.map((result) => resultBlock(result, ruleName(result.ruleId))),
        structuredContent: { sarif: file.name, results: chosen.length },
      });
    }, 250);
    return () => clearTimeout(timer);
  }, [selected, report]);

  const open = async (result: SarifResult): Promise<void> => {
    if (result.uri === null) return;
    const located = await host.callData<{ path: string | null }>("fallow_app_locate", {
      path: result.uri,
    });
    if (located.path !== null) await host.openFile(located.path);
  };

  if (error !== null) {
    return (
      <div class="f-sarif">
        <EmptyState icon="alert" title={`Cannot read ${file.name}`}>
          {error}
        </EmptyState>
      </div>
    );
  }
  if (report === null) {
    return (
      <div class="f-loading">
        <Spinner size={20} />
      </div>
    );
  }

  const counts = { error: 0, warning: 0, note: 0, none: 0 };
  for (const result of report.results) counts[result.level] += 1;
  const activeRule = rule === null ? null : report.rules.get(rule);

  return (
    <div class="f-sarif">
      <header class="f-topbar">
        <div class="f-topbar-title">
          <FallowMark />
          <div class="f-title-text">
            <h1>{file.name}</h1>
            <p class="f-subtle">
              {report.tools
                .map((tool) => `${tool.name}${tool.version === null ? "" : ` ${tool.version}`}`)
                .join(", ")}{" "}
              · {report.results.length} results
            </p>
          </div>
        </div>
        <div class="f-topbar-actions">
          {host.canMessage && selected.size > 0 ? (
            <Button
              size="sm"
              variant="primary"
              icon="sparkle"
              onClick={() => {
                const chosen = report.results
                  .filter((result) => selected.has(result.key))
                  .slice(0, 25);
                void host.openai.message
                  ?.send({
                    role: "user",
                    content: [
                      {
                        type: "text",
                        text: `Fix these ${chosen.length} results from ${file.name}. Check each one against the code first.`,
                      },
                      ...chosen.map((result) => resultBlock(result, ruleName(result.ruleId))),
                    ],
                  })
                  .then(() => setSelected(new Set()));
              }}
            >
              Fix {selected.size} with Codex
            </Button>
          ) : null}
        </div>
      </header>

      <div class="f-filters">
        <label class="f-search">
          <Icon name="search" size={14} />
          <input
            class="form-control"
            type="search"
            placeholder="Search results"
            value={query}
            onInput={(event) => setQuery(event.currentTarget.value)}
          />
        </label>
        <div class="f-segmented" role="group" aria-label="Level">
          {(["all", "error", "warning", "note"] as const).filter((value) => value === "all" || counts[value] > 0).map((value) => (
            <button
              key={value}
              type="button"
              class="cursor-interaction"
              aria-pressed={level === value}
              onClick={() => setLevel(value)}
            >
              {value === "all"
                ? `All ${report.results.length}`
                : `${value.charAt(0).toUpperCase()}${value.slice(1)}s ${counts[value]}`}
            </button>
          ))}
        </div>
      </div>
      <div class="f-chips" role="group" aria-label="Rule">
        <button
          type="button"
          class="f-filter-chip cursor-interaction"
          aria-pressed={rule === null}
          onClick={() => setRule(null)}
        >
          All rules
        </button>
        {ruleCounts.slice(0, 16).map(([id, count]) => (
          <button
            key={id}
            type="button"
            class="f-filter-chip cursor-interaction"
            aria-pressed={rule === id}
            onClick={() => setRule(rule === id ? null : id)}
          >
            {ruleName(id)} {count}
          </button>
        ))}
      </div>
      {activeRule === undefined || activeRule === null ? null : (
        <section class="f-card f-rule-card">
          <h2>{activeRule.name}</h2>
          {activeRule.description === null ? null : (
            <p class="f-subtle">{activeRule.description}</p>
          )}
          {activeRule.helpUri === null ? null : (
            <button
              type="button"
              class="f-link cursor-interaction"
              onClick={() => void host.openLink(activeRule.helpUri ?? "")}
            >
              Rule documentation <Icon name="external" size={12} />
            </button>
          )}
        </section>
      )}

      <main class="f-main">
        {results.length === 0 ? (
          <EmptyState icon="check" title="No results match" />
        ) : (
          <ul class="f-rows f-sarif-rows">
            {results.slice(0, 500).map((result) => (
              <li key={result.key} class={`f-row ${selected.has(result.key) ? "f-selected" : ""}`}>
                <input
                  type="checkbox"
                  class="form-check-input"
                  checked={selected.has(result.key)}
                  aria-label={`Select ${result.ruleId} at ${location(result)}`}
                  onChange={() =>
                    setSelected((current) => {
                      const next = new Set(current);
                      if (next.has(result.key)) next.delete(result.key);
                      else next.add(result.key);
                      return next;
                    })
                  }
                />
                <button
                  type="button"
                  class="f-row-main cursor-interaction"
                  disabled={result.uri === null || !host.canOpenFiles}
                  onClick={() => void open(result)}
                >
                  <span class="f-row-title">
                    <span class={`f-level f-level-${LEVEL_TO_DOT[result.level]}`} />
                    <span class="f-row-rule">{result.message || ruleName(result.ruleId)}</span>
                    {result.baselineState === "new" ? (
                      <span class="f-badge f-badge-new">New</span>
                    ) : null}
                  </span>
                  <span class="f-row-message">
                    {ruleName(result.ruleId)}
                    {result.tool === report.tools[0]?.name ? "" : ` · ${result.tool}`}
                  </span>
                  <span class="f-row-location">
                    {result.uri === null ? "No location" : <PathLabel path={result.uri} line={result.line} />}
                  </span>
                </button>
                {result.uri === null || !host.canOpenFiles ? null : (
                  <span class="f-row-chevron" aria-hidden="true">
                    <Icon name="file" size={14} />
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        {results.length > 500 ? (
          <p class="f-note">
            Showing 500 of {results.length} results. Use a filter to narrow the list.
          </p>
        ) : null}
      </main>
    </div>
  );
};
