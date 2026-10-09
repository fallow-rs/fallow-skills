import "@openai/mcp-extensions/app/styles.css";
import "./app.css";
import { OpenAIFileEntrypointInputSchema } from "@openai/mcp-extensions/app";
import type { JSX } from "preact";
import { render } from "preact";
import { useEffect, useReducer, useState } from "preact/hooks";
import type { ViewPayload } from "../shared/contracts.ts";
import { FallowMark } from "./components/ui.tsx";
import { Host } from "./host.ts";
import { AuditView } from "./views/audit.tsx";
import { ConfigEditor } from "./views/config.tsx";
import { Dashboard } from "./views/dashboard.tsx";
import { FindingDetail } from "./views/findings.tsx";
import { SarifViewer } from "./views/sarif.tsx";
import { Loading, Picker, ProblemView } from "./views/states.tsx";

const host = new Host();
let latest: ViewPayload | null = null;
const viewListeners = new Set<(view: ViewPayload) => void>();

const show = (view: ViewPayload): void => {
  latest = view;
  for (const listener of viewListeners) listener(view);
};

host.onView(show);

// A file entrypoint always sends its input. Use it when the tool result is late or missing.
host.onToolInput((args) => {
  const input = OpenAIFileEntrypointInputSchema.safeParse(args);
  if (!input.success || latest !== null) return;
  const toolName = host.context()?.toolInfo?.tool.name ?? "";
  const sarif =
    toolName === "fallow_open_sarif" || input.data.file.name.toLowerCase().endsWith(".sarif");
  show({ view: sarif ? "sarif" : "config", file: input.data.file });
});

const PENDING_LABELS: Record<string, string> = {
  fallow_analyze: "Analyzing code health",
  fallow_audit: "Auditing this branch",
  fallow_plan_cleanup: "Preparing the cleanup form",
  fallow_show_finding: "Loading the finding",
};

/** Shown while the tool call runs. The host already sent the tool name, so say what is going on. */
const Boot = (): JSX.Element => {
  const label = PENDING_LABELS[host.context()?.toolInfo?.tool.name ?? ""];
  return (
    <div class="f-loading f-boot" role="status" aria-busy="true">
      <FallowMark size={24} />
      {label === undefined ? null : (
        <>
          <p class="f-subtle">{label}…</p>
          <div class="f-progress" />
        </>
      )}
    </div>
  );
};

const Root = (): JSX.Element => {
  const [view, setView] = useState<ViewPayload | null>(latest);
  const [, bump] = useReducer((count: number) => count + 1, 0);
  const refresh = (): void => bump(undefined);

  useEffect(() => {
    const listener = (next: ViewPayload): void => setView(next);
    viewListeners.add(listener);
    if (latest !== null) setView(latest);
    const unsubscribe = host.subscribe(refresh);
    return () => {
      viewListeners.delete(listener);
      unsubscribe();
    };
  }, []);

  const onView = (next: ViewPayload | null): void => {
    if (next !== null) show(next);
  };

  if (view === null) return <Boot />;
  switch (view.view) {
    case "dashboard":
      return (
        <Dashboard
          key={`${view.report.project.root}:${view.report.analyzedAt}`}
          host={host}
          report={view.report}
          route={view.route}
          onView={onView}
        />
      );
    case "loading":
      return (
        <Loading
          host={host}
          project={view.project}
          scope={view.scope}
          route={view.route}
          onView={onView}
        />
      );
    case "audit":
      return (
        <AuditView key={view.audit.analyzedAt} host={host} audit={view.audit} onView={onView} />
      );
    case "finding":
      return (
        <div class="f-standalone">
          <FindingDetail
            host={host}
            project={view.project}
            finding={view.finding}
            attached={host.attachedIds()?.has(view.finding.id) ?? false}
            onAttach={() => void host.attach(view.project, [view.finding]).catch(() => undefined)}
          />
        </div>
      );
    case "picker":
      return <Picker host={host} recents={view.recents} reason={view.reason} onView={onView} />;
    case "problem":
      return (
        <ProblemView host={host} problem={view.problem} project={view.project} onView={onView} />
      );
    case "config":
      return <ConfigEditor host={host} file={view.file} />;
    case "sarif":
      return <SarifViewer host={host} file={view.file} />;
  }
};

const mount = document.getElementById("app");
if (mount !== null) render(<Root />, mount);
host.connect().catch((error: unknown) => {
  show({
    view: "problem",
    problem: {
      code: "connect_failed",
      title: "The app could not connect to Codex",
      detail: error instanceof Error ? error.message : String(error),
      fix: null,
    },
    project: null,
  });
});
