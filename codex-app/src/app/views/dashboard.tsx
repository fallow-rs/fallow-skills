import type { JSX } from "preact";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type StateUpdater,
} from "preact/hooks";
import { CATEGORY_ORDER, CATEGORY_TITLES } from "../../shared/categories.ts";
import type { CategoryId, Finding, Level, ProjectRef, Report } from "../../shared/contracts.ts";
import {
  Button,
  CategoryBar,
  CategoryGlyph,
  CommandLine,
  EmptyState,
  FallowMark,
  formatNumber,
  Icon,
  PathLabel,
  relativeTime,
  ScoreRing,
} from "../components/ui.tsx";
import { viewOf, type Host } from "../host.ts";
import { setIds, toggleId } from "../selection.ts";
import { FindingDetail, FindingList, Message } from "./findings.tsx";
import { parseRoute, type Tab } from "../route.ts";

const categoryCounts = (report: Report): Array<{ category: CategoryId; count: number }> =>
  CATEGORY_ORDER.map((category) => ({
    category,
    count: report.counts.byCategory[category],
  })).filter((entry) => entry.count > 0);

const matches = (finding: Finding, terms: string[]): boolean => {
  if (terms.length === 0) return true;
  const text =
    `${finding.title} ${finding.message} ${finding.path} ${finding.symbol ?? ""}`.toLowerCase();
  return terms.every((term) => text.includes(term));
};

const keyOf = (ids: Iterable<string>): string => [...ids].sort().join("|");

/**
 * Keeps the composer attachments equal to the selection, in both directions. The host echoes every
 * update back as host context; the hook skips its own echoes by update id, ignores host state while
 * an update is in flight, and pushes again after a failed update.
 */
export const useAttachmentSync = (host: Host, project: ProjectRef, findings: Finding[]) => {
  const byId = useMemo(() => new Map(findings.map((finding) => [finding.id, finding])), [findings]);
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set([...(host.attachedIds() ?? [])].filter((id) => byId.has(id))),
  );
  const pushed = useRef<string>(keyOf(selected));
  const ownUpdates = useRef(new Set<string>());
  const inFlight = useRef(0);
  const sequence = useRef(0);
  const lastHostUpdate = useRef<string | null>(host.attachedState()?.updateId ?? null);

  /**
   * Takes the host's attachments as the selection when the host reports a new update that is not
   * ours, for example after the user removed a chip. Other host context changes (theme, size) keep
   * the same update id and change nothing.
   */
  const syncFromHost = (): void => {
    if (inFlight.current > 0) return;
    const state = host.attachedState();
    if (state === null || state.updateId === lastHostUpdate.current) return;
    lastHostUpdate.current = state.updateId;
    if (state.updateId !== null && ownUpdates.current.has(state.updateId)) return;
    const ids = [...state.ids].filter((id) => byId.has(id));
    const key = keyOf(ids);
    if (key === pushed.current) return;
    pushed.current = key;
    setSelected(new Set(ids));
  };

  useEffect(() => host.subscribe(syncFromHost), [host, byId]);

  // A refresh can remove findings; drop their ids from the selection.
  useEffect(() => {
    setSelected((current) => {
      const kept = new Set([...current].filter((id) => byId.has(id)));
      return kept.size === current.size ? current : kept;
    });
  }, [byId]);

  useEffect(() => {
    if (!host.canAttach) return;
    const key = keyOf(selected);
    if (key === pushed.current) return;
    const timer = setTimeout(() => {
      inFlight.current += 1;
      sequence.current += 1;
      const call = sequence.current;
      const chosen = [...selected].flatMap((id) => {
        const finding = byId.get(id);
        return finding === undefined ? [] : [finding];
      });
      host
        .attach(project, chosen)
        .then((updateId) => {
          if (updateId !== null) ownUpdates.current.add(updateId);
          // An older call that finishes last must not overwrite the newest selection.
          if (call === sequence.current) pushed.current = key;
        })
        .catch(() => {
          // Leave `pushed` as it was, so the next change pushes the full selection again.
        })
        .finally(() => {
          inFlight.current -= 1;
          // The user may have removed a chip while the update was in flight.
          if (inFlight.current === 0) syncFromHost();
        });
    }, 250);
    return () => clearTimeout(timer);
  }, [selected, host, project, byId]);

  return [selected, setSelected] as const;
};

type DashboardProps = {
  host: Host;
  report: Report;
  route: string | null;
  onView: (view: ReturnType<typeof viewOf>) => void;
};

type Setter<T> = Dispatch<StateUpdater<T>>;
type DashboardState = {
  tab: Tab;
  setTab: Setter<Tab>;
  category: CategoryId | null;
  setCategory: Setter<CategoryId | null>;
  level: "all" | Level;
  setLevel: Setter<"all" | Level>;
  query: string;
  setQuery: Setter<string>;
  groupBy: "file" | "rule";
  setGroupBy: Setter<"file" | "rule">;
  setDetailId: Setter<string | null>;
  formNotice: boolean;
  setFormNotice: Setter<boolean>;
  busy: "refresh" | "scope" | "cleanup" | null;
  selected: Set<string>;
  setSelected: Setter<Set<string>>;
  inline: boolean;
  filtered: Finding[];
  detail: Finding | null;
  selectedFindings: Finding[];
  toggle: (finding: Finding) => void;
  toggleMany: (findings: Finding[], select: boolean) => void;
  rerun: (kind: "refresh" | "scope", scope: Report["scope"]) => Promise<void>;
  planCleanup: () => Promise<void>;
  openFindings: (next: CategoryId | null) => void;
};
type DashboardSectionProps = { host: Host; report: Report; state: DashboardState };
type CleanupPlan = {
  status?: string;
  instructions?: string;
  constraints?: string[];
  findings?: Array<{ id: string }>;
};
const findingDetail = (findings: Finding[], id: string | null): Finding | null => {
  if (id === null) return null;
  return findings.find((finding) => finding.id === id) ?? null;
};
const cleanupInstruction = (plan: CleanupPlan, instructions: string): string => {
  const constraints = plan.constraints ?? [];
  return [
    instructions,
    ...(constraints.length > 0 ? [`Constraints: ${constraints.join("; ")}.`] : []),
  ].join(" ");
};
const cleanupIds = (plan: CleanupPlan | undefined): Set<string> =>
  new Set((plan?.findings ?? []).map((finding) => finding.id));
const cleanupCategory = (category: CategoryId | null): { category?: CategoryId } =>
  category === null ? {} : { category };
const cleanupFormNotShown = (plan: CleanupPlan | undefined): boolean =>
  plan?.status === "form_not_shown";
const cleanupProblem = (error: unknown, project: ProjectRef): ReturnType<typeof viewOf> => ({
  view: "problem",
  problem: {
    code: "cleanup_failed",
    title: "The cleanup form could not open",
    detail: error instanceof Error ? error.message : String(error),
    fix: null,
  },
  project,
});
const matchesCategory = (finding: Finding, category: CategoryId | null): boolean =>
  category === null || finding.category === category;
const matchesLevel = (finding: Finding, level: "all" | Level): boolean =>
  level === "all" || finding.level === level;
const sendCleanupPlan = async (
  host: Host,
  report: Report,
  plan: CleanupPlan | undefined,
): Promise<void> => {
  const ids = cleanupIds(plan);
  if (plan === undefined) return;
  if (plan.instructions === undefined) return;
  if (ids.size === 0) return;
  await host.send(
    cleanupInstruction(plan, plan.instructions),
    report.findings.filter((finding) => ids.has(finding.id)),
    report.project,
  );
};

const useDashboard = ({ host, report, route, onView }: DashboardProps): DashboardState => {
  const initial = useMemo(() => parseRoute(route ?? host.deepLink), [route]);
  const [tab, setTab] = useState<Tab>(initial.tab);
  const [category, setCategory] = useState<CategoryId | null>(initial.category);
  const [level, setLevel] = useState<"all" | Level>("all");
  const [query, setQuery] = useState(initial.query);
  const [groupBy, setGroupBy] = useState<"file" | "rule">("file");
  const [detailId, setDetailId] = useState<string | null>(initial.findingId);
  const [formNotice, setFormNotice] = useState(false);
  const [busy, setBusy] = useState<"refresh" | "scope" | "cleanup" | null>(null);
  const [selected, setSelected] = useAttachmentSync(host, report.project, report.findings);
  const inline = host.displayMode === "inline";

  useEffect(() => {
    const next = parseRoute(host.deepLink);
    if (host.deepLink === null) return;
    setTab(next.tab);
    setCategory(next.category);
    setQuery(next.query);
    setDetailId(next.findingId);
  }, [host.deepLink]);

  const filtered = useMemo(() => {
    const terms = query
      .toLowerCase()
      .split(/\s+/)
      .filter((term) => term.length > 0);
    return report.findings.filter(
      (finding) =>
        matchesCategory(finding, category) &&
        matchesLevel(finding, level) &&
        matches(finding, terms),
    );
  }, [report.findings, category, level, query]);

  const detail = findingDetail(report.findings, detailId);
  const selectedFindings = report.findings.filter((finding) => selected.has(finding.id));

  const toggle = (finding: Finding): void =>
    setSelected((current) => toggleId(current, finding.id));

  const toggleMany = (findings: Finding[], select: boolean): void =>
    setSelected((current) =>
      setIds(
        current,
        findings.map((finding) => finding.id),
        select,
      ),
    );

  const rerun = async (kind: "refresh" | "scope", scope: Report["scope"]): Promise<void> => {
    setBusy(kind);
    try {
      onView(
        await host.callView("fallow_app_run", { root: report.project.root, scope, force: true }),
      );
    } finally {
      setBusy(null);
    }
  };

  const planCleanup = async (): Promise<void> => {
    setBusy("cleanup");
    try {
      const result = await host.call("fallow_app_plan_cleanup", {
        path: report.project.root,
        ...cleanupCategory(category),
      });
      const plan = result.structuredContent as CleanupPlan | undefined;
      if (cleanupFormNotShown(plan)) {
        setFormNotice(true);
        return;
      }
      await sendCleanupPlan(host, report, plan);
    } catch (error) {
      onView(cleanupProblem(error, report.project));
    } finally {
      setBusy(null);
    }
  };

  const openFindings = (next: CategoryId | null): void => {
    setCategory(next);
    setDetailId(null);
    setTab("findings");
    if (inline && host.canExpand) void host.expand();
  };

  return {
    tab,
    setTab,
    category,
    setCategory,
    level,
    setLevel,
    query,
    setQuery,
    groupBy,
    setGroupBy,
    setDetailId,
    formNotice,
    setFormNotice,
    busy,
    selected,
    setSelected,
    inline,
    filtered,
    detail,
    selectedFindings,
    toggle,
    toggleMany,
    rerun,
    planCleanup,
    openFindings,
  };
};

export const Dashboard = (props: DashboardProps): JSX.Element => {
  const state = useDashboard(props);
  const { host, report } = props;
  const { inline, tab } = state;
  return (
    <div class={`f-dashboard ${inline ? "f-inline" : "f-full"}`}>
      <DashboardHeader host={host} report={report} state={state} />
      <CleanupFormNotice state={state} />
      {report.notices.map((notice) => (
        <div key={notice} class="f-banner f-banner-warn" role="status">
          <Icon name="alert" size={14} />
          <span>{notice}</span>
        </div>
      ))}
      <DashboardTabs host={host} report={report} state={state} />
      <div
        class="f-main"
        {...(inline ? {} : { role: "tabpanel", id: "f-panel", "aria-labelledby": `f-tab-${tab}` })}
      >
        <DashboardPanel host={host} report={report} state={state} />
      </div>
      <DashboardSelection host={host} report={report} state={state} />
    </div>
  );
};

const DashboardHeader = (props: DashboardSectionProps): JSX.Element => (
  <header class="f-topbar">
    <DashboardTitle report={props.report} />
    <DashboardActions {...props} />
  </header>
);
const DashboardTitle = ({ report }: { report: Report }): JSX.Element => (
  <div class="f-topbar-title">
    <FallowMark />
    <div class="f-title-text">
      <h1>{report.project.name}</h1>
      <p class="f-subtle">
        {report.project.branch === null ? null : (
          <span class="f-chip">
            <Icon name="branch" size={12} />
            {report.project.branch}
          </span>
        )}
        <span title={new Date(report.analyzedAt).toLocaleString()}>
          {report.scope === "changed" ? `Changed since ${report.base ?? "base"}` : "Whole project"}{" "}
          · {relativeTime(report.analyzedAt)}
        </span>
      </p>
    </div>
  </div>
);
const DashboardActions = ({ host, report, state }: DashboardSectionProps): JSX.Element => {
  const { busy, rerun } = state;
  return (
    <div class="f-topbar-actions">
      <DashboardScope host={host} report={report} state={state} />
      <Button
        size="sm"
        variant="ghost"
        icon="refresh"
        title="Run fallow again"
        busy={busy === "refresh" || busy === "scope"}
        onClick={() => void rerun("refresh", report.scope)}
      />
      {host.canExpand ? (
        <Button
          size="sm"
          variant="ghost"
          icon="expand"
          title="Open full screen"
          onClick={() => void host.expand()}
        />
      ) : null}
    </div>
  );
};
const DashboardScope = ({ report, state }: DashboardSectionProps): JSX.Element | null => {
  const { inline, busy, rerun } = state;
  if (inline) return null;
  return (
    <div class="f-segmented" role="group" aria-label="Scope">
      <button
        type="button"
        class="cursor-interaction"
        aria-pressed={report.scope === "full"}
        disabled={busy !== null}
        onClick={() => report.scope === "full" || void rerun("scope", "full")}
      >
        Project
      </button>
      <button
        type="button"
        class="cursor-interaction"
        aria-pressed={report.scope === "changed"}
        disabled={busy !== null}
        onClick={() => report.scope === "changed" || void rerun("scope", "changed")}
      >
        Changed
      </button>
    </div>
  );
};
const CleanupFormNotice = ({ state }: { state: DashboardState }): JSX.Element | null => {
  const { formNotice, setFormNotice } = state;
  if (!formNotice) return null;
  return (
    <div class="f-banner f-banner-warn" role="status">
      <Icon name="info" size={14} />
      <span>
        Codex did not show the cleanup form. It declines forms when the thread runs in Full access
        mode. Switch the thread to Default permissions, or select findings and use Fix with Codex.
      </span>
      <Button
        size="sm"
        variant="ghost"
        icon="close"
        title="Dismiss"
        onClick={() => setFormNotice(false)}
      />
    </div>
  );
};
const DashboardTabs = ({ report, state }: DashboardSectionProps): JSX.Element | null => {
  const { inline, tab, setTab, setDetailId } = state;
  if (inline) return null;
  const labels: Record<Tab, string> = {
    overview: "Overview",
    findings: `Findings ${report.counts.total}`,
    insights: "Insights",
  };
  return (
    <div class="f-tabs" role="tablist" aria-label="Sections">
      {(["overview", "findings", "insights"] as const).map((name) => (
        <button
          type="button"
          key={name}
          role="tab"
          id={`f-tab-${name}`}
          aria-selected={tab === name}
          aria-controls="f-panel"
          class="cursor-interaction"
          onClick={() => {
            setTab(name);
            setDetailId(null);
          }}
        >
          {labels[name]}
        </button>
      ))}
    </div>
  );
};
const DashboardPanel = (props: DashboardSectionProps): JSX.Element => {
  if (props.state.inline) return <DashboardOverview {...props} />;
  const Panel = DASHBOARD_PANELS[props.state.tab];
  return <Panel {...props} />;
};
const DashboardOverview = ({ host, report, state }: DashboardSectionProps): JSX.Element => {
  const { inline, openFindings, setDetailId, setTab, planCleanup, busy } = state;
  return (
    <Overview
      report={report}
      inline={inline}
      onCategory={openFindings}
      onFinding={(finding) => {
        setDetailId(finding.id);
        setTab("findings");
        if (inline && host.canExpand) void host.expand();
      }}
      onCleanup={() => void planCleanup()}
      cleanupBusy={busy === "cleanup"}
      host={host}
    />
  );
};
const DashboardInsights = ({ report }: DashboardSectionProps): JSX.Element => (
  <Insights report={report} />
);
const DashboardFindings = ({ host, report, state }: DashboardSectionProps): JSX.Element => {
  const { detail, selected, setDetailId, toggle } = state;
  if (detail === null) return <DashboardFindingList host={host} report={report} state={state} />;
  return (
    <FindingDetail
      host={host}
      project={report.project}
      finding={detail}
      attached={selected.has(detail.id)}
      onBack={() => setDetailId(null)}
      onAttach={() => toggle(detail)}
    />
  );
};
const DashboardFindingList = ({ host, report, state }: DashboardSectionProps): JSX.Element => {
  const { filtered, selected, toggle, toggleMany, setDetailId, groupBy } = state;
  return (
    <div class="f-findings">
      <DashboardFilters host={host} report={report} state={state} />
      <DashboardCategories host={host} report={report} state={state} />
      {report.omitted > 0 ? (
        <p class="f-note">
          <Icon name="info" size={14} /> Showing the first {report.findings.length} of{" "}
          {report.counts.total} findings. Codex reads all of them through @Fallow mentions.
        </p>
      ) : null}
      <FindingList
        host={host}
        project={report.project}
        findings={filtered}
        selected={selected}
        onToggle={toggle}
        onToggleMany={toggleMany}
        onOpen={(finding) => setDetailId(finding.id)}
        groupBy={groupBy}
      />
    </div>
  );
};
const DashboardFilters = ({ report, state }: DashboardSectionProps): JSX.Element => {
  const { query, setQuery, level, setLevel, groupBy, setGroupBy } = state;
  const labels: Record<"all" | "error" | "warn", string> = {
    all: "All",
    error: `Errors ${report.counts.byLevel.error}`,
    warn: `Warnings ${report.counts.byLevel.warn}`,
  };
  return (
    <div class="f-filters">
      <label class="f-search">
        <Icon name="search" size={14} />
        <input
          class="form-control"
          type="search"
          placeholder="Search findings, files, symbols"
          aria-label="Search findings"
          value={query}
          onInput={(event) => setQuery(event.currentTarget.value)}
        />
      </label>
      <div class="f-segmented" role="group" aria-label="Severity">
        {(["all", "error", "warn"] as const).map((value) => (
          <button
            key={value}
            type="button"
            class="cursor-interaction"
            aria-pressed={level === value}
            onClick={() => setLevel(value)}
          >
            {labels[value]}
          </button>
        ))}
      </div>
      <div class="f-segmented" role="group" aria-label="Group by">
        <button
          type="button"
          class="cursor-interaction"
          aria-pressed={groupBy === "file"}
          onClick={() => setGroupBy("file")}
        >
          By file
        </button>
        <button
          type="button"
          class="cursor-interaction"
          aria-pressed={groupBy === "rule"}
          onClick={() => setGroupBy("rule")}
        >
          By rule
        </button>
      </div>
    </div>
  );
};
const DashboardCategories = ({ report, state }: DashboardSectionProps): JSX.Element => {
  const { category, setCategory } = state;
  return (
    <div class="f-chips" role="group" aria-label="Category">
      <button
        type="button"
        class="f-filter-chip cursor-interaction"
        aria-pressed={category === null}
        onClick={() => setCategory(null)}
      >
        All {report.counts.total}
      </button>
      {categoryCounts(report).map((entry) => (
        <button
          key={entry.category}
          type="button"
          class="f-filter-chip cursor-interaction"
          aria-pressed={category === entry.category}
          onClick={() => setCategory(category === entry.category ? null : entry.category)}
        >
          <CategoryGlyph category={entry.category} size={12} />
          {CATEGORY_TITLES[entry.category]} {entry.count}
        </button>
      ))}
    </div>
  );
};
const DashboardSelection = ({ host, report, state }: DashboardSectionProps): JSX.Element | null => {
  const { selected, inline, selectedFindings, setSelected } = state;
  if (selected.size === 0 || inline) return null;
  return (
    <SelectionBar
      host={host}
      project={report.project}
      findings={selectedFindings}
      onClear={() => setSelected(new Set())}
    />
  );
};
const DASHBOARD_PANELS: Record<Tab, (props: DashboardSectionProps) => JSX.Element> = {
  overview: DashboardOverview,
  findings: DashboardFindings,
  insights: DashboardInsights,
};

const SelectionBar = ({
  host,
  project,
  findings,
  onClear,
}: {
  host: Host;
  project: ProjectRef;
  findings: Finding[];
  onClear: () => void;
}): JSX.Element => {
  const instruction = `Fix these ${findings.length} Fallow findings in ${project.name}. Verify each one first, and keep each change small.`;
  return (
    <div class="f-selection" role="region" aria-label="Selected findings">
      <span class="f-selection-count">
        {findings.length} selected
        {host.canAttach ? <span class="f-subtle"> · attached to the composer</span> : null}
      </span>
      <div class="f-selection-actions">
        {host.canMessage ? (
          <Button
            variant="primary"
            icon="sparkle"
            onClick={() => void host.send(instruction, findings, project).then(onClear)}
          >
            Fix with Codex
          </Button>
        ) : null}
        {host.canStartNewThread ? (
          <Button
            icon="newChat"
            title="Start a new chat with these findings"
            onClick={() => void host.send(instruction, findings, project, "new").then(onClear)}
          >
            New chat
          </Button>
        ) : null}
        <Button variant="ghost" icon="close" title="Clear the selection" onClick={onClear} />
      </div>
    </div>
  );
};

type OverviewProps = {
  host: Host;
  report: Report;
  inline: boolean;
  onCategory: (category: CategoryId | null) => void;
  onFinding: (finding: Finding) => void;
  onCleanup: () => void;
  cleanupBusy: boolean;
};

const Overview = ({
  host,
  report,
  inline,
  onCategory,
  onFinding,
  onCleanup,
  cleanupBusy,
}: OverviewProps): JSX.Element => {
  const counts = categoryCounts(report);
  const top = startHere(report.findings, inline ? 3 : 6);
  if (report.counts.total === 0) {
    return (
      <div class="f-overview">
        <ScoreCard report={report} />
        <EmptyState icon="check" title="No findings">
          Fallow found no dead code, duplication or complexity problems in this scope.
        </EmptyState>
      </div>
    );
  }
  return (
    <div class="f-overview">
      <div class="f-overview-top">
        <ScoreCard report={report} />
        <section class="f-card f-summary-card">
          <div class="f-summary-head">
            <p class="f-big-number">
              {formatNumber(report.counts.total)}
              <span>findings</span>
            </p>
            <p class="f-subtle">
              {report.counts.byLevel.error} errors · {report.counts.byLevel.warn} warnings
            </p>
          </div>
          <CategoryBar counts={counts} onSelect={(category) => onCategory(category)} />
        </section>
      </div>

      {inline ? null : (
        <div class="f-tiles">
          {counts.map((entry) => (
            <button
              key={entry.category}
              type="button"
              class="f-tile cursor-interaction"
              onClick={() => onCategory(entry.category)}
            >
              <CategoryGlyph category={entry.category} />
              <span class="f-tile-count">{entry.count}</span>
              <span class="f-tile-label">{CATEGORY_TITLES[entry.category]}</span>
            </button>
          ))}
        </div>
      )}

      <section class="f-card">
        <header class="f-card-header">
          <h2>Start here</h2>
          <div class="f-card-actions">
            <Button
              size="sm"
              variant="primary"
              icon="sparkle"
              busy={cleanupBusy}
              onClick={onCleanup}
            >
              Plan cleanup
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onCategory(null)}>
              All findings <Icon name="chevronRight" size={12} />
            </Button>
          </div>
        </header>
        <ul class="f-top-list">
          {top.map((finding) => (
            <li key={finding.id}>
              <button
                type="button"
                class="f-top-item cursor-interaction"
                onClick={() => onFinding(finding)}
              >
                <CategoryGlyph category={finding.category} size={12} />
                <span class="f-top-text">
                  <span class="f-top-message">
                    <Message text={finding.message} />
                  </span>
                  <PathLabel path={finding.path} line={finding.line} />
                </span>
                <Icon name="chevronRight" size={14} />
              </button>
            </li>
          ))}
        </ul>
      </section>
      {inline && host.canExpand ? (
        <p class="f-inline-hint">
          <button
            type="button"
            class="f-link cursor-interaction"
            onClick={() => void host.expand()}
          >
            Open the full dashboard <Icon name="expand" size={12} />
          </button>
        </p>
      ) : null}
    </div>
  );
};

/**
 * Picks a varied first list: one finding per category in turn, errors first, at most two per file.
 * The report order alone would show six findings of the same file.
 */
const startHere = (findings: Finding[], count: number): Finding[] => {
  const queues = CATEGORY_ORDER.map((category) =>
    findings.filter((finding) => finding.category === category),
  );
  const perFile = new Map<string, number>();
  const picked: Finding[] = [];
  while (picked.length < count && queues.some((queue) => queue.length > 0)) {
    for (const queue of queues) {
      while (queue.length > 0) {
        const next = queue.shift();
        if (next === undefined) break;
        const used = perFile.get(next.path) ?? 0;
        if (used >= 2) continue;
        perFile.set(next.path, used + 1);
        picked.push(next);
        break;
      }
      if (picked.length >= count) break;
    }
  }
  return picked;
};

const ScoreCard = ({ report }: { report: Report }): JSX.Element => (
  <section class="f-card f-score-card">
    {report.score === null ? (
      <EmptyState icon="info" title="No health score">
        Update fallow to see a score.
      </EmptyState>
    ) : (
      <>
        <ScoreRing score={report.score.value} grade={report.score.grade} />
        <div class="f-score-text">
          <h2>Health {Math.round(report.score.value)}</h2>
          {report.score.penalties.length === 0 ? (
            <p class="f-subtle">No penalties.</p>
          ) : (
            <ul class="f-penalties">
              {report.score.penalties.slice(0, 3).map((penalty) => (
                <li key={penalty.dimension}>
                  <span>{penalty.dimension}</span>
                  <span class="f-penalty">−{formatNumber(penalty.points)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </>
    )}
  </section>
);

const Insights = ({ report }: { report: Report }): JSX.Element => {
  const vitals = report.vitals;
  const stats: Array<[string, string]> = [
    ["Files", formatNumber(vitals.files)],
    ["Functions", formatNumber(vitals.functions)],
    ["Lines", formatNumber(vitals.lines)],
    ["Maintainability", formatNumber(vitals.maintainability)],
    [
      "Duplication",
      vitals.duplicationPct === null ? "–" : `${formatNumber(vitals.duplicationPct)}%`,
    ],
    ["Avg. cyclomatic", formatNumber(vitals.avgCyclomatic)],
  ];
  return (
    <div class="f-insights">
      <dl class="f-stats">
        {stats.map(([label, value]) => (
          <div key={label} class="f-stat">
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>

      <section class="f-card">
        <header class="f-card-header">
          <h2>Refactoring targets</h2>
        </header>
        {report.targets.length === 0 ? (
          <p class="f-subtle">No targets. The code has no file that stands out.</p>
        ) : (
          <ol class="f-ranked">
            {report.targets.map((target) => (
              <li key={target.path}>
                <PathLabel path={target.path} />
                <span class="f-ranked-text">{target.recommendation}</span>
                <span class="f-badge">{target.effort} effort</span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section class="f-card">
        <header class="f-card-header">
          <h2>Hotspots</h2>
          <span class="f-subtle">Complex files that change often</span>
        </header>
        {report.hotspots.length === 0 ? (
          <p class="f-subtle">No hotspots in the git history window.</p>
        ) : (
          <ol class="f-ranked">
            {report.hotspots.map((hotspot) => (
              <li key={hotspot.path}>
                <PathLabel path={hotspot.path} />
                <span class="f-ranked-text">
                  {hotspot.commits} commits · {hotspot.trend}
                  {hotspot.fanIn === null ? "" : ` · ${hotspot.fanIn} dependents`}
                </span>
                <span
                  class="f-heat"
                  style={{ "--f-heat": `${Math.min(100, hotspot.score)}%` }}
                  aria-label={`Score ${hotspot.score}`}
                />
              </li>
            ))}
          </ol>
        )}
      </section>

      {report.nextSteps.length > 0 ? (
        <section class="f-card">
          <header class="f-card-header">
            <h2>Next steps</h2>
          </header>
          <ul class="f-steps">
            {report.nextSteps.map((step) => (
              <li key={step.command}>
                <p>{step.reason}</p>
                <CommandLine command={step.command} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <p class="f-footnote">
        fallow {report.fallowVersion} · {Math.round(report.durationMs)} ms
      </p>
    </div>
  );
};
