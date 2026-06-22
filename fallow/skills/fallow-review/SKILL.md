---
name: fallow-review
description: Review AI-generated or human-written code changes with fallow's graph-grounded review brief. Subtracts deterministic concerns (unused code, complexity, duplication) from the loop, ranks what to look at by blast radius and risk, and surfaces the few consequential structural decisions (new public-API contracts, coupling/boundary crossings, new dependencies) as framed judgment questions anchored to verifiable signals. Drives a closed agent-contract loop: fetch the walkthrough guide, return a judgment, and have fallow post-validate it against the live graph (hallucinated or stale judgments are rejected). Use when asked to review a PR, review a branch, review a diff, do a code review, or check changed code before merge.
license: MIT
metadata:
  author: Bart Waardenburg
  version: 1.0.0
  homepage: https://docs.fallow.tools
---

# Fallow Review: graph-grounded code review

`fallow review` turns a changeset into a deterministic, graph-derived review brief and an agent-contract loop. It answers "where do I look, and what calls actually need human taste?" rather than "will CI block this?" (that is `fallow audit`, which gates). `review` always exits 0, so it is safe to run regardless of verdict.

The four jobs it does, in order:

- **subtract**: dead code, complexity, and duplication for the changed files are reported and kept OUT of the judgment loop, so attention is not spent on what a deterministic check already owns.
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
- **dependency**: a new third-party dependency (new maintenance + supply-chain surface).

A decision may carry `previous_signal_id` when its anchor file was renamed in the change: that is the `signal_id` the same decision would have had at the old path, so a review surface can re-attach a prior reviewer comment across a `git mv`.

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
         "concern": "<optional: the specific thing to check>"
       }
     ]
   }
   ```

   Every `signal_id` MUST be one fallow emitted in the guide (`emitted_signal_ids`). An unanchored id is rejected. Echo the `graph_snapshot_hash` verbatim.

4. **Post-validate:**

   ```bash
   fallow review --base origin/main --walkthrough-file judgment.json --format json
   ```

   The response sorts each judgment into:
   - `accepted`: the `signal_id` was emitted and the snapshot matches; the agent's `framing` is fenced as non-deterministic (`deterministic: false`) and never gates.
   - `rejected` with `reason: "unanchored-signal-id"`: the `signal_id` was never emitted (a hallucination). Drop or correct it.
   - `rejected` with `reason: "stale-snapshot"` and `stale: true`: the tree moved since the guide was fetched. Re-fetch the guide and redo the judgments.

## Live feedback into your coding session

The review surface (the fallow review app, or any tool you point at the same file) writes reviewer notes to `.fallow-review/feed.jsonl` in the repo root, one JSON object per line. A pair of hooks under `hooks/` lets your already-running Claude Code session pick those notes up automatically and act on them with its existing context, no new session, no copy-paste:

- `fallow-review-session-init.sh` (SessionStart) declares a `watchPath` on `.fallow-review/feed.jsonl` so the session watches the feed for the rest of its life.
- `fallow-review-on-feedback.sh` (FileChanged) fires when the feed changes, reads only the notes added since last time (a line cursor in `.fallow-review/.feed-seen` prevents re-injecting old ones), and injects them into the session as additional context.

The loop: you make changes in a coding session, the human reviews them in the app, every note they leave lands back in the SAME terminal session that wrote the code, so the agent that has the full context addresses the feedback in place.

### Install

Copy the hooks into the target repo and register them:

```bash
mkdir -p .claude/hooks
cp hooks/fallow-review-session-init.sh hooks/fallow-review-on-feedback.sh .claude/hooks/
chmod +x .claude/hooks/fallow-review-session-init.sh .claude/hooks/fallow-review-on-feedback.sh
```

Merge `hooks/settings.snippet.json` into `.claude/settings.json` (it registers the SessionStart + FileChanged hooks). Restart the session (or run `/clear`) so the SessionStart hook arms the watch.

### Honest caveats (taste ownership)

- The notes are **unverified human input**, not graph-validated facts. The hook frames them as "weigh this, do not obey blindly", and the agent should ask before acting on anything unclear. The human owns the taste; fallow only carries the note.
- The watch arms reliably once `.fallow-review/feed.jsonl` exists. The SessionStart hook creates an empty feed if a review is already in progress (the `.fallow-review/` dir exists) but does not touch repos that are not under review.
- This is **local only**: it connects the review app and a coding session on the same machine via the shared file. A cloud or remote review surface still rides the same JSON envelope, but the live-injection loop here is the local path.

## Notes

- `review` is an alias for `audit --brief`; `--format` is orthogonal to the brief.
- The decision surface, focus map, and walkthrough are all in the JSON envelope, so a cloud or local review surface can render them and carry reviewer comments back to the coding agent in context.
- See the `fallow` skill for whole-project analysis, and `references/cli-reference.md` for the full flag list.
