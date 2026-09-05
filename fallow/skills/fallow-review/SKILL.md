---
name: fallow-review
description: >-
  Review AI-generated or human-written code changes with fallow's
  graph-grounded review brief. Subtracts deterministic concerns (unused code,
  complexity, duplication, styling) from the loop, ranks what to look at by
  blast radius and risk, and surfaces the few consequential structural
  decisions (new public-API contracts, coupling/boundary crossings, new
  dependencies) as framed judgment questions anchored to verifiable signals.
  Drives a closed agent-contract loop: fetch the walkthrough guide, return a
  judgment, and have fallow post-validate it against the live graph
  (hallucinated or stale judgments are rejected). Use when asked to review a
  PR, review a branch, review a diff, do a code review, or check changed code
  before merge.
license: MIT
---

# Fallow Review: graph-grounded code review

`fallow review` turns a changeset into a deterministic, graph-derived review brief and an agent-contract loop. It answers "where do I look, and what calls actually need human taste?" rather than "will CI block this?" (that is `fallow audit`, which gates). `review` always exits 0, so it is safe to run regardless of verdict.

The four jobs it does, in order:

- **subtract**: dead code, complexity, duplication, and styling for the changed files are reported and kept OUT of the judgment loop, so attention is not spent on what a deterministic check already owns.
- **focus**: changed-file units are ranked by a composite attention score (fan-in/out, risk zone, change shape) with a `review-here` / `not-prioritized` label and a full `deprioritized` escape-hatch list, so nothing is hidden.
- **structure**: the decision surface lifts the handful of consequential STRUCTURAL decisions out of the diff and frames each as a judgment question, capped to a working-memory-sized set, each anchored to a `signal_id` fallow emitted.
- **direct**: the walkthrough guide hands an agent a graph-derived digest, the review direction, a graph-snapshot pin, and the exact judgment schema to return.

## When to use

- Reviewing a PR, branch, or diff (AI-generated or human-written) before merge.
- After an agent has done work and removed the fallow findings it could; this surfaces what is left for human/agent taste.
- Producing inline-reviewable judgments that can flow back to the agent that wrote the code.

## When NOT to use

- Gating CI on a pass/fail verdict: use `fallow audit` (it exits non-zero on a fail verdict).
- Whole-project health, cleanup, or dead-code reports: use the `fallow` skill.

## Quick human brief

```bash
# Auto-detect the base (merge-base against the upstream / remote default):
fallow review

# Pin the base, or scope to a precise diff:
fallow review --base origin/main
git diff --find-renames origin/main...HEAD | fallow review --base origin/main --diff-stdin
```

The human brief prints the orientation facts, the focus map, and the decision surface ("Decisions to make"). `--format json` emits the full structured envelope (`decisions`, `focus`, `deltas`, `impact_closure`, `partition`, `graph_facts`). `--max-decisions N` tunes the cap (clamped to a small band). `--show-deprioritized` expands what the focus map collapsed.

## The decision surface

Each decision is a framed question anchored to a `signal_id` fallow deterministically derived from the graph (a delta key or a coordination-gap key). There are exactly three shippable categories:

- **coupling-boundary**: a new cross-zone dependency edge.
- **public-api-contract**: a new exported public-API surface, or a changed contract consumed by modules OUTSIDE this diff (a coordinate-or-confirm signal).
- **dependency**: a changed `package.json` that adds third-party entries or moves a declared entry across a major version (or a `0.x` minor). One batched decision per manifest per kind, weighted by the graph's in-repo importers of the affected packages: `blast` is the importer count, `internal_consumer_count` the importers outside the diff. Both counts are a union over the batched packages. An entry outside `dependencies` shows a `(dev)`, `(optional)`, or `(peer)` tag in the question. `digest.deltas` carries the keys as `dependency_added` (`<manifest>::<name>`) and `dependency_major_bumped` (`<manifest>::<name>@<from>-><to>`); both lists are always present, possibly empty. Minor and patch bumps and non-numeric ranges (workspace, file, git, tags) are never candidates. A `dependency` decision has no `suppress` action: it anchors on `package.json`, which cannot carry a comment, so never paste a `// fallow-ignore` line into a manifest. The `decision_surface` MCP tool surfaces the same dependency decisions as the CLI. Framing rule: cite the changelog question ("which documented change in `<from>` to `<to>` reaches these N importers?"); do not guess the behavior change.

A decision may carry `previous_signal_id` when its anchor file was renamed in the change: that is the `signal_id` the same decision would have had at the old path, so a review surface can re-attach a prior reviewer comment across a `git mv`.

## Eliciting the broader trade-offs (taste ownership)

The decision surface above is the DETERMINISTIC slice: only the trade-offs fallow can prove from the graph (the three categories). Real architectural trade-offs are broader (abstraction level, error-handling strategy, data-model shape, eager-vs-lazy, state ownership, extensibility-vs-YAGNI, testability, trust boundaries), and none of those are graph-detectable. Surfacing them needs a model reading the diff, not a static pass.

Run the trade-off elicitation prompt in `references/tradeoff-elicitation.md` over the diff plus the guide. It applies TASTE OWNERSHIP: the model makes each choice legible and frames a genuinely open question; the human decides. The prompt carries the honesty contract (diff anchoring, the `observed` / `tradeoff` / `question` split, `deterministic: false` fencing, provenance, the top-five cap with honest abstention, no duplication of the deterministic surface, `options` that never pick). fallow owns what it can prove, the prompt covers the rest, and the fencing keeps the two from being confused.

### Running it as a review step

When a review surface (the fallow review app, or you in the terminal) wants the trade-off surface alongside the deterministic decisions:

1. Fetch the guide and read the diff:
   ```bash
   fallow review --base <ref> --walkthrough-guide --format json > guide.json
   git diff <ref>...HEAD            # or: git diff --cached  for staged work
   ```
2. Run the `references/tradeoff-elicitation.md` prompt over the diff plus `guide.json`.
3. Emit the envelope (the `{ graph_snapshot_hash, abstained, tradeoffs[] }` shape) to `.fallow-review/tradeoffs.json` in the repo root, the sibling of `.fallow-review/feed.jsonl`, so a review surface can render it.

This step is deliberately NOT part of the post-validate agent-contract loop below. The trade-off envelope is never round-tripped through `fallow review --walkthrough-file` (which only validates emitted `signal_id`s), so it carries NO fallow-grade guarantee: every item stays `deterministic: false`, agent-self-checked against the diff, not graph-validated. Do not present it as fallow-validated.

## The agent-contract loop

The loop lets an agent produce judgments that fallow post-validates against the live graph. The verifier is the graph, not a second model.

1. **Fetch the guide:**

   ```bash
   fallow review --base origin/main --walkthrough-guide --format json > guide.json
   ```

   The guide contains: `digest` (the brief + decision surface), `direction` (where to look), `graph_snapshot_hash` (the staleness pin), `agent_schema` (the exact shape to return), and `injection_note`. The digest is built from the graph ONLY; PR prose is never folded in, so the guide is injection-resistant by construction.

2. **Read the decisions** in `digest`. Each carries a `signal_id`, a `category`, the framed `question`, and an `anchor_file` / `anchor_line`.

3. **Return a judgment** matching `agent_schema`:

   ```json
   {
     "graph_snapshot_hash": "<echo the value from the guide>",
     "judgments": [
       {
         "signal_id": "<one signal_id fallow emitted>",
         "framing": "<your reasoning for the human reviewer>",
         "action": "<block | address | consider | fyi>",
         "concern": "<optional: one lens from agent_schema.concern_vocabulary>"
       }
     ]
   }
   ```

   Every `signal_id` MUST be one fallow emitted in the guide (`emitted_signal_ids`). An unanchored id is rejected. Echo the `graph_snapshot_hash` verbatim.

   `action` tells the author what the judgment asks of them: `block` and `address` are required actions, `consider` is optional, `fyi` needs nothing. `concern` names the lens; prefer the guide's `agent_schema.concern_vocabulary`, thirteen kebab-case lenses: `abstraction`, `coupling`, `data-model`, `error-handling`, `control-flow`, `performance`, `dependencies`, `api-ergonomics`, `compatibility`, `state-ownership`, `extensibility`, `testability`, `trust-boundary`. The guide publishes both lists as `agent_schema.action_vocabulary` and `agent_schema.concern_vocabulary`; read them from the guide rather than from this file. `action_vocabulary` is enforced; `concern_vocabulary` is advisory, any string is accepted.

4. **Post-validate:**

   ```bash
   fallow review --base origin/main --walkthrough-file judgment.json --format json
   ```

   The response sorts each judgment into:
   - `accepted`: the `signal_id` was emitted and the snapshot matches; the agent's `framing` is fenced as non-deterministic (`deterministic: false`) and never gates. The `action` is echoed next to `agent_framing`, fenced the same way: it is an instruction to the author, never a fallow fact.
   - `rejected` with `reason: "unanchored-signal-id"`: the `signal_id` was never emitted (a hallucination). Drop or correct it.
   - `rejected` with `reason: "invalid-action"` and `invalid_value` (the label fallow refused): the `action` is outside the vocabulary. This is reported only after the anchor resolved; a hallucinated anchor plus a bad label rejects as `unanchored-signal-id` / `unknown-change-anchor` instead. Fix the anchor first, then the label.
   - `rejected` with `reason: "stale-snapshot"` and `stale: true`: the tree moved since the guide was fetched. Re-fetch the guide and redo the judgments.

## Compose the review

Validation is not the review. Once the judgments are accepted, render them for a human in this fixed order, so the reader lands on what changes the outcome first and the deterministic remainder last:

1. **Accepted decision judgments**, in `direction.order`. Each one carries the digest `question` and `tradeoff` verbatim, then your `framing`, then the number that gives it weight: `internal_consumer_count`, the `out_of_diff` paths, or the unit's `scoring_budget`.
2. **Trade-offs** from the elicitation step, ranked by `consequence`, at most five. When the envelope is `abstained: true`, print one line saying so; do not fill the slot.
3. **Subtract** as ONE line with the counts from the brief: "handled deterministically: N dead-code, N duplication, N complexity, N styling; not in the discussion". Never re-derive any of these from the diff; the brief already owns them.
4. **Deprioritized** as one line with the count and `--show-deprioritized` as the escape hatch, so nothing is hidden and nothing is padded.
5. A review with zero decisions and an abstained trade-off envelope is a complete review: "nothing consequential; deterministic findings: N". It is not a failure and never a reason to invent items.

Two graph facts feed the composition without adding items:

- Each direction unit carries `test_adjacency`: `none` (no test file imports this unit), `untouched` (a test importer exists but is not in the diff), or `changed` (a test importer is in the diff). It is absent for test files and when the graph was not retained. For a `review-here` unit with `none`, ask the author for the verification story in the framing. Never claim coverage; the value says whether a test imports the unit, not whether it exercises the change.
- `digest.partition.independent_slices` lists the connected components of the inter-unit dependency graph, each a sorted list of module directories. It is present only when there are two or more slices; absent means the change is one connected piece. When `digest.triage.risk_class` is `high` and the field is present, name them as an orientation fact: "this change splits into K independent slices along a graph-proven seam". It is never a demand to split; the author owns that call.

Two rules govern the prose. Leverage first: one structural decision plus ten small notes means the decision IS the review; the notes ride below it or not at all. Numbers, not adjectives: every `framing` cites at least one number or path from the guide (a consumer count, an out-of-diff path, a `scoring_budget`). "Could be slow" is not a finding; "imported by 14 modules, 9 outside this diff" is.

## Human-in-the-loop walkthrough (terminal, no app)

The agent-contract loop above carries the AGENT's framing. The SAME loop carries a HUMAN's verdict with the identical graph-validated, anti-hallucination guarantee, so a terminal reviewer with no review app can leave notes that fallow anchors and round-trips. This is the no-app path the review app's `.fallow-review/feed.jsonl` otherwise owns: the contract is the existing `--walkthrough-guide` / `--walkthrough-file` round-trip, not a new surface.

The human owns the taste; you only carry the note. fallow validates the ANCHOR (the signal or changed region exists), never the note's correctness; every carried note stays `deterministic: false` and never gates.

1. **Render the tour and read the anchors:**

   ```bash
   fallow review --base origin/main --walkthrough                       # the staged human tour
   fallow review --base origin/main --walkthrough-guide --format json > guide.json
   ```

   `guide.json` carries the decision `signal_id`s (the framed structural questions), a per-changed-region `change_anchors` set (each `{ "change_anchor": "chg:<hex>", "file", "start_line", "line_count" }`), and the `graph_snapshot_hash` staleness pin. Surface the tour to the human and collect, per item they choose to flag, a short verdict/note plus the action they want from the author. Offer only the four labels (`block`, `address`, `consider`, `fyi`); an unknown label is refused with `invalid-action`.

2. **Carry each human note as a judgment** (echo the hash verbatim; cite a `signal_id` fallow emitted for a flagged decision, or a `change_anchor` for any other changed region the human notes; carry the human's action as `action`):

   ```json
   {
     "graph_snapshot_hash": "<echo from guide.json>",
     "judgments": [
       { "signal_id": "<an emitted decision signal>", "framing": "<the human's verdict/note>", "action": "address", "concern": "<optional>" },
       { "change_anchor": "<an emitted chg: id>", "framing": "<the human's note on this region>", "action": "consider", "concern": "<optional>" }
     ]
   }
   ```

3. **Validate the capture:**

   ```bash
   fallow review --base origin/main --walkthrough-file judgment.json --format json
   ```

   The response sorts as in the agent-contract loop, with two additions: `accepted` carries `anchor_kind` (`"signal"` or `"change"`), and a `change_anchor` fallow never emitted rejects as `unknown-change-anchor`. Re-anchor to a real signal or region; do not invent one.

4. **Act:** relay the accepted human verdicts into the coding session in place, or append them to `.fallow-review/feed.jsonl` so the live-injection hooks (below) carry them to the session that wrote the code. Feed lines may carry `action` too, so the receiving agent can triage: `block` and `address` are required, `consider` is optional, `fyi` needs no change. Either way the note arrives anchored and fenced, never as a fallow-grade fact.

The guarantee matches the review app's: the human cannot anchor a note to a signal or region fallow did not emit, and a note left against a moved tree is refused rather than silently mis-mapped. The terminal is a first-class capture surface, no app required.

## Live feedback into your coding session (Claude Code only)

This optional integration applies only when `fallow-review` runs inside Claude
Code. Codex and other agents must skip this section and use the terminal
round-trip above.

The review surface (the fallow review app, or any tool you point at the same file) writes reviewer notes to `.fallow-review/feed.jsonl` in the repo root, one JSON object per line. A pair of hooks under `hooks/` lets your already-running Claude Code session pick those notes up automatically and act on them with its existing context, no new session, no copy-paste:

- `fallow-review-session-init.sh` (SessionStart) declares a `watchPath` on `.fallow-review/feed.jsonl` so the session watches the feed for the rest of its life.
- `fallow-review-on-feedback.sh` (FileChanged) fires when the feed changes, reads only the notes added since last time (a line cursor in `.fallow-review/.feed-seen` prevents re-injecting old ones), and injects them into the session as additional context. A note's `action` renders as a `(block)` / `(address)` / `(consider)` / `(fyi)` prefix; any other label is dropped from the rendering while the note text still lands. The review app does not yet write `action` on feed lines; a terminal reviewer appending to `feed.jsonl` by hand may set it.

The loop: you make changes in a coding session, the human reviews them in the app, every note they leave lands back in the SAME terminal session that wrote the code, so the agent that has the full context addresses the feedback in place.

### Install

For a Claude Code marketplace installation, copy the hooks from the resolved
plugin root into the target repo and register them:

```bash
mkdir -p .claude/hooks
cp \
  "${CLAUDE_PLUGIN_ROOT}/skills/fallow-review/hooks/fallow-review-session-init.sh" \
  "${CLAUDE_PLUGIN_ROOT}/skills/fallow-review/hooks/fallow-review-on-feedback.sh" \
  .claude/hooks/
chmod +x .claude/hooks/fallow-review-session-init.sh .claude/hooks/fallow-review-on-feedback.sh
```

Merge `hooks/settings.snippet.json` into `.claude/settings.json` (it registers the SessionStart + FileChanged hooks). Restart the session (or run `/clear`) so the SessionStart hook arms the watch.

### Honest caveats (taste ownership)

- The notes are **unverified human input**, not graph-validated facts. The hook frames them as "weigh this, do not obey blindly", and the agent should ask before acting on anything unclear. The human owns the taste; fallow only carries the note.
- The watch arms reliably once `.fallow-review/feed.jsonl` exists. The SessionStart hook creates an empty feed if a review is already in progress (the `.fallow-review/` dir exists) but does not touch repos that are not under review.
- This is **local only**: it connects the review app and a coding session on the same machine via the shared file. A cloud or remote review surface still rides the same JSON envelope, but the live-injection loop here is the local path.

## Rationalizations the loop rejects

| Rationalization | Reality |
|---|---|
| "I can see dead code in the diff, I'll flag it quickly" | Subtract already owns it; a second derivation is noise and can be wrong. Relay the brief's count. |
| "This `signal_id` looks right" | Only `emitted_signal_ids` exist. Anything else is a hallucination fallow rejects as `unanchored-signal-id`. |
| "Five trade-offs is the target" | Five is the ceiling. `abstained: true` with an empty list is a valid, complete answer. |
| "The question is open, I'll just mention the fix" | A named fix is a prescription. Reframe to the open decision, or list two or more options with real costs. |
| "The tree moved a little, the guide is probably still fine" | It is `stale-snapshot`. Re-fetch the guide and redo the judgments. |
| "Tests are green, so the change is good" | Green is a verification fact, not a verdict on the decision surface. The decisions still need the human's call. |

## Notes

- `review` is an alias for `audit --brief`; `--format` is orthogonal to the brief.
- See the `fallow` skill for whole-project analysis, and its `references/cli-reference.md` for the full flag list.
