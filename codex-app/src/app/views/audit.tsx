import type { JSX } from "preact";
import { useState } from "preact/hooks";
import type { AuditResult, Finding, ViewPayload } from "../../shared/contracts.ts";
import { Button, EmptyState, Icon, relativeTime } from "../components/ui.tsx";
import { viewOf, type Host } from "../host.ts";
import { useAttachmentSync } from "./dashboard.tsx";
import { FindingDetail, FindingList } from "./findings.tsx";

const VERDICT_COPY: Record<AuditResult["verdict"], { title: string; body: string }> = {
  pass: { title: "Ready to commit", body: "This branch adds no findings that fail the gate." },
  warn: { title: "Review before you commit", body: "This branch adds findings that only warn." },
  fail: { title: "Fix before you commit", body: "This branch adds findings that fail the gate." },
};

export const AuditView = ({
  host,
  audit,
  onView,
}: {
  host: Host;
  audit: AuditResult;
  onView: (view: ViewPayload | null) => void;
}): JSX.Element => {
  const [selected, setSelected] = useAttachmentSync(host, audit.project, audit.findings);
  const [detail, setDetail] = useState<Finding | null>(null);
  const [onlyNew, setOnlyNew] = useState(audit.introduced > 0);
  const [busy, setBusy] = useState(false);
  const copy = VERDICT_COPY[audit.verdict];
  const findings = onlyNew
    ? audit.findings.filter((finding) => finding.introduced === true)
    : audit.findings;
  const introduced = audit.findings.filter((finding) => finding.introduced === true);

  const rerun = async (): Promise<void> => {
    setBusy(true);
    try {
      onView(
        viewOf(await host.call("fallow_app_audit", { root: audit.project.root, base: audit.base })),
      );
    } finally {
      setBusy(false);
    }
  };

  const toggle = (finding: Finding): void =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(finding.id)) next.delete(finding.id);
      else next.add(finding.id);
      return next;
    });

  if (detail !== null) {
    return (
      <div class="f-audit">
        <FindingDetail
          host={host}
          project={audit.project}
          finding={detail}
          attached={selected.has(detail.id)}
          onBack={() => setDetail(null)}
          onAttach={() => toggle(detail)}
        />
      </div>
    );
  }

  return (
    <div class="f-audit">
      <section class={`f-verdict f-verdict-${audit.verdict}`}>
        <span class="f-verdict-icon">
          <Icon name={audit.verdict === "pass" ? "check" : "alert"} size={20} />
        </span>
        <div class="f-verdict-text">
          <p class="f-verdict-label">Audit {audit.verdict}</p>
          <h1>{copy.title}</h1>
          <p class="f-subtle">
            {audit.project.name}
            {audit.project.branch === null ? "" : ` on ${audit.project.branch}`} ·{" "}
            {audit.changedFiles === 0
              ? "no files changed since "
              : `${audit.changedFiles} changed files against `}
            <code>{audit.baseDescription ?? audit.base}</code> · {relativeTime(audit.analyzedAt)}
          </p>
          {audit.changedFiles === 0 ? null : <p class="f-subtle">{copy.body}</p>}
        </div>
        <Button
          size="sm"
          variant="ghost"
          icon="refresh"
          title="Audit again"
          busy={busy}
          onClick={() => void rerun()}
        />
      </section>

      <div class="f-audit-stats">
        <div class="f-stat">
          <dt>Introduced</dt>
          <dd>{audit.introduced}</dd>
        </div>
        <div class="f-stat">
          <dt>Inherited</dt>
          <dd>{audit.inherited}</dd>
        </div>
        <div class="f-stat">
          <dt>Changed files</dt>
          <dd>{audit.changedFiles}</dd>
        </div>
      </div>

      {audit.findings.length === 0 ? (
        <EmptyState icon="check" title="No findings in the changed files" />
      ) : (
        <>
          <div class="f-filters">
            <div class="f-segmented" role="group" aria-label="Findings">
              <button
                type="button"
                class="cursor-interaction"
                aria-pressed={onlyNew}
                onClick={() => setOnlyNew(true)}
              >
                New {audit.introduced}
              </button>
              <button
                type="button"
                class="cursor-interaction"
                aria-pressed={!onlyNew}
                onClick={() => setOnlyNew(false)}
              >
                All {audit.findings.length}
              </button>
            </div>
            {host.canMessage && introduced.length > 0 ? (
              <Button
                size="sm"
                variant="primary"
                icon="sparkle"
                onClick={() =>
                  void host.send(
                    `Fix the ${introduced.length} findings that this branch introduced, then run the Fallow audit again.`,
                    introduced,
                    audit.project,
                  )
                }
              >
                Fix new findings
              </Button>
            ) : null}
          </div>
          <FindingList
            host={host}
            project={audit.project}
            findings={findings}
            selected={selected}
            onToggle={toggle}
            onToggleMany={(items, select) =>
              setSelected((current) => {
                const next = new Set(current);
                for (const item of items) {
                  if (select) next.add(item.id);
                  else next.delete(item.id);
                }
                return next;
              })
            }
            onOpen={setDetail}
            groupBy="file"
            showIntroduced
          />
        </>
      )}
    </div>
  );
};
