import type { JSX } from "preact";
import { useEffect, useState } from "preact/hooks";
import type {
  FallowProblem,
  ProjectRef,
  RecentProject,
  Report,
  ViewPayload,
} from "../../shared/contracts.ts";
import { Button, CommandLine, FallowMark, Icon, relativeTime, Spinner } from "../components/ui.tsx";
import { viewOf, type Host } from "../host.ts";

type OnView = (view: ViewPayload | null) => void;

export const Picker = ({
  host,
  recents,
  reason,
  onView,
}: {
  host: Host;
  recents: RecentProject[];
  reason: string;
  onView: OnView;
}): JSX.Element => {
  const [busy, setBusy] = useState<string | null>(null);

  const open = async (root: string): Promise<void> => {
    setBusy(root);
    try {
      onView(await host.callView("fallow_app_run", { root }));
    } finally {
      setBusy(null);
    }
  };

  const choose = async (): Promise<void> => {
    setBusy("choose");
    try {
      onView(await host.callView("fallow_app_choose_project"));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div class="f-picker">
      <header class="f-hero">
        <FallowMark size={32} />
        <h1>Code health for TypeScript and JavaScript</h1>
        <p class="f-subtle">{reason}</p>
      </header>
      <div class="f-picker-actions">
        <Button
          variant="primary"
          icon="folder"
          busy={busy === "choose"}
          onClick={() => void choose()}
        >
          Choose a project folder
        </Button>
      </div>
      {recents.length > 0 ? (
        <section class="f-card">
          <header class="f-card-header">
            <h2>Recent projects</h2>
          </header>
          <ul class="f-recents">
            {recents.map((recent) => (
              <li key={recent.root}>
                <button
                  type="button"
                  class="f-recent cursor-interaction"
                  disabled={busy !== null}
                  aria-busy={busy === recent.root}
                  onClick={() => void open(recent.root)}
                >
                  <span class={`f-grade f-grade-${(recent.grade ?? "none").toLowerCase()}`}>
                    {recent.grade ?? "?"}
                  </span>
                  <span class="f-recent-text">
                    <span class="f-recent-name">{recent.name}</span>
                    <span class="f-path">{recent.root}</span>
                  </span>
                  <span class="f-subtle">{relativeTime(recent.lastOpenedAt)}</span>
                  {busy === recent.root ? (
                    <Spinner />
                  ) : (
                    <Icon name="chevronRight" size={14} />
                  )}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <p class="f-footnote">
        Tip: open a project folder in a Codex thread, then open Code Health beside the chat.
      </p>
    </div>
  );
};

const STAGES = [
  "Discovering files",
  "Building the module graph",
  "Finding dead code",
  "Measuring complexity",
  "Looking for duplication",
];

export const Loading = ({
  host,
  project,
  scope,
  route,
  onView,
}: {
  host: Host;
  project: ProjectRef;
  scope: Report["scope"];
  route: string | null;
  onView: OnView;
}): JSX.Element => {
  const [stage, setStage] = useState(0);
  useEffect(() => {
    const timer = setInterval(
      () => setStage((current) => Math.min(current + 1, STAGES.length - 1)),
      900,
    );
    let live = true;
    // The entrypoint returned early; this call joins the run that is already going on the server.
    host
      .call("fallow_app_run", { root: project.root, scope })
      .then((result) => {
        if (!live) return;
        const view = viewOf(result);
        onView(view !== null && view.view === "dashboard" ? { ...view, route } : view);
      })
      .catch(
        (error: unknown) =>
          live &&
          onView({
            view: "problem",
            problem: {
              code: "call_failed",
              title: "The analysis did not finish",
              detail: error instanceof Error ? error.message : String(error),
              fix: null,
            },
            project,
          }),
      );
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [project.root]);

  return (
    <div class="f-loading" aria-busy="true">
      <FallowMark size={28} />
      <h1>{project.name}</h1>
      <p class="f-subtle" role="status">{STAGES[stage]}…</p>
      <div class="f-progress" />
      <div class="f-skeleton">
        <span />
        <span />
        <span />
      </div>
    </div>
  );
};

export const ProblemView = ({
  host,
  problem,
  project,
  onView,
}: {
  host: Host;
  problem: FallowProblem;
  project: ProjectRef | null;
  onView: OnView;
}): JSX.Element => {
  const [busy, setBusy] = useState(false);
  const retry = async (): Promise<void> => {
    if (project === null) return;
    setBusy(true);
    try {
      onView(await host.callView("fallow_app_run", { root: project.root, force: true }));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div class="f-problem" role="alert">
      <span class="f-problem-icon">
        <Icon name="alert" size={20} />
      </span>
      <h1>{problem.title}</h1>
      <pre class="f-problem-detail">{problem.detail}</pre>
      {problem.fix === null ? null : <CommandLine command={problem.fix} />}
      <div class="f-problem-actions">
        {project === null ? null : (
          <Button icon="refresh" busy={busy} onClick={() => void retry()}>
            Try again
          </Button>
        )}
        {host.canMessage && problem.fix !== null ? (
          <Button
            variant="primary"
            icon="sparkle"
            onClick={() =>
              void host.send(
                `Fallow could not run${project === null ? "" : ` in ${project.name}`}: ${problem.title}. Run \`${problem.fix}\` and fix the cause, then open Fallow again.`,
                [],
                project,
              )
            }
          >
            Ask Codex to fix it
          </Button>
        ) : null}
      </div>
    </div>
  );
};
