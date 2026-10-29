import type { JSX } from "preact";
import { useEffect, useState } from "preact/hooks";
import type { Finding, ProjectRef } from "../../../../agent-view/src/contracts.ts";
import {
  functionText,
  statusSentence,
  type ProductionFunction,
  type ProductionView,
} from "../../../../agent-view/src/production.ts";
import type { ProductionResult } from "../../shared/contracts.ts";
import { CommandLine, LoadingStatus } from "../components/ui.tsx";
import type { Host } from "../host.ts";

type Loaded = ({ found: true } & ProductionResult) | { found: false };

/** A command that fixes a status, when one exists. */
const STATUS_COMMAND: Partial<Record<ProductionView["status"], string>> = {
  no_key: "fallow cloud login",
  cli_unsupported: "npm install --global fallow@latest",
};

const useProduction = (host: Host, project: ProjectRef, path: string): Loaded | null => {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  useEffect((): (() => void) => {
    let live = true;
    setLoaded(null);
    host
      .callData<Loaded>("fallow_app_production", { root: project.root, path })
      .then((value): void => {
        if (live) setLoaded(value);
      })
      .catch((): void => {
        if (live) setLoaded({ found: false });
      });
    return (): void => {
      live = false;
    };
  }, [project.root, path]);
  return loaded;
};

/** The function that the finding names comes first, so the reader sees it without a scroll. */
const ordered = (functions: ProductionFunction[], finding: Finding): ProductionFunction[] => {
  const named = (fn: ProductionFunction): boolean =>
    fn.name === finding.symbol || (finding.line !== null && fn.line === finding.line);
  return [...functions.filter(named), ...functions.filter((fn) => !named(fn))];
};

const label = (name: string, line: number | null): string =>
  line === null ? name : `${name}:${line}`;

const StatusText = ({ view }: { view: Exclude<ProductionView, { status: "ok" }> }): JSX.Element => {
  const command = STATUS_COMMAND[view.status];
  return (
    <div class="f-explain">
      <p class="f-muted">{statusSentence(view)}</p>
      {command === undefined ? null : <CommandLine command={command} />}
    </div>
  );
};

const FunctionRows = ({
  view,
  finding,
}: {
  view: Extract<ProductionView, { status: "ok" }>;
  finding: Finding;
}): JSX.Element => {
  const functions = ordered(view.functions, finding);
  return (
    <ul class="f-production">
      {functions.map((fn): JSX.Element => (
        <li
          key={`${fn.name}:${fn.line ?? ""}`}
          class={fn.name === finding.symbol ? "f-production-focus" : ""}
        >
          <span class="f-path">{label(fn.name, fn.line)}</span>
          <span>{functionText(fn, view.periodDays)}</span>
        </li>
      ))}
      {view.unpaired.map((fn): JSX.Element => (
        <li key={`unpaired:${fn.name}:${fn.line ?? ""}`}>
          <span class="f-path">{label(fn.name, fn.line)}</span>
          <span class="f-muted">{fn.note}</span>
        </li>
      ))}
    </ul>
  );
};

const ProductionData = ({
  view,
  finding,
}: {
  view: Extract<ProductionView, { status: "ok" }>;
  finding: Finding;
}): JSX.Element => {
  const summary = statusSentence(view);
  return (
    <div class="f-explain">
      {summary.length === 0 ? null : <p class="f-muted">{summary}</p>}
      <FunctionRows view={view} finding={finding} />
    </div>
  );
};

const ProductionBody = ({ loaded, finding }: { loaded: Loaded | null; finding: Finding }): JSX.Element => {
  if (loaded === null) return <LoadingStatus label="Loading production data" />;
  if (!loaded.found) return <p class="f-muted">Production data is not available for this file.</p>;
  return loaded.production.status === "ok" ? (
    <ProductionData view={loaded.production} finding={finding} />
  ) : (
    <StatusText view={loaded.production} />
  );
};

/**
 * Production data of the file of a finding, from `fallow inspect --cloud`: calls, errors and CPU
 * per function. Without a key, a plan or a fallow release with `--cloud`, it shows the status text.
 */
export const ProductionSection = ({
  host,
  project,
  finding,
}: {
  host: Host;
  project: ProjectRef;
  finding: Finding;
}): JSX.Element => {
  const loaded = useProduction(host, project, finding.path);
  return (
    <section class="f-detail-section">
      <h3>Production</h3>
      <ProductionBody loaded={loaded} finding={finding} />
    </section>
  );
};
