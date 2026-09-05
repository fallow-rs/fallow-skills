# Trade-off elicitation (taste-ownership review)

`fallow review`'s decision surface is the DETERMINISTIC slice: it surfaces only the
trade-offs fallow can prove from the module graph, a changed public-API contract
consumed outside the diff, a new boundary or coupling crossing, a new dependency.
Real architectural trade-offs are broader: abstraction level, error-handling
strategy, data-model shape, eager-vs-lazy, state ownership, extensibility-vs-YAGNI,
testability, trust boundaries. None of those are deterministically detectable from
the graph, so they need a model reading the diff.

This prompt elicits that broader set. The governing principle is TASTE OWNERSHIP:
the model makes each choice legible to the human and frames the open question; the
human decides. The model never prescribes the answer, never blocks, never
auto-applies.

A scope note on honesty: fallow validates only the ANCHOR (a `signal_id` or a
`change_anchor` from the guide, see the human-in-the-loop section of SKILL.md).
The prose framing below (the `observed` / `tradeoff` / `question` discipline) is
enforced by the model checking its own output, not by fallow.

## The honesty contract (non-negotiable)

1. **Anchor to the diff.** Every item's `anchor` must be a line PRESENT in the
   provided diff: the changed line that is the LOCUS of the trade-off. If no changed
   line is the locus, drop it, with ONE exception: the cross-cutting slot in rule 7.
   The `tradeoff` and `question` text MAY name out-of-diff code as the affected
   party, an in-diff change whose consequence reaches an untouched file is exactly
   the kind of trade-off worth surfacing (anchor to the changed line, name the
   untouched file in the prose). What you may NOT do is anchor an item to a line
   that is not in the diff.
2. **Three layers, kept separate and neutral, per item:**
   - `observed` (FACT): what the change does, readable straight from the diff. State
     it neutrally. Do NOT use contrastive framing that implies a verdict ("returns
     the raw error INSTEAD OF mapping it" already judges; write "returns the raw
     error to the caller").
   - `tradeoff` (INFERENCE): what it gains and what it costs. Your reading, not
     ground truth. Name both sides; do not let the cost outweigh the gain
     rhetorically.
   - `question` (DECISION): the call the human owns. It must be GENUINELY OPEN. Ask
     an open "how / what / under what conditions" question, never "you should...",
     and never the leading form "..., or should you X?" (the "or should X" clause
     smuggles your preferred answer into the question). If the only question you can
     write names a specific fix, you are prescribing; reframe to the open decision
     instead. Example of the trap: "..., or should this map to a domain error?" is a
     prescription. The open form is "How should this surface a storage failure to
     its callers?"
3. **Fence everything.** Mark every item `deterministic: false`. These are model
   inferences. They never gate and never auto-post.
4. **Provenance, honestly.** Set `captured: true` ONLY if you are the same agent
   that wrote this code in this session and the rationale is what you actually had
   at write time. If you are reconstructing intent from a diff whose authorship you
   do not own, `captured` is `false`, always. `captured` is a provenance hint, not a
   trust score; do not raise it to look more authoritative. When in doubt, `false`.
   The "why" is usually not in the diff; do not pretend it is.
5. **Abstain freely.** A short, high-signal surface beats a checklist. Keep at most
   the top FIVE trade-offs ranked by `consequence` (impact if the call is wrong),
   then by `confidence`; the rest do not exist. If nothing rises to a real decision,
   return `abstained: true` with an empty `tradeoffs: []` (do not invent items to
   fill the slots).
6. **Do not duplicate fallow.** Read `digest.decisions.decisions[]` from the guide
   first; if fallow already framed it (public-API contract, boundary crossing, new
   dependency), do not re-raise it. You add the part fallow cannot see.
7. **One cross-cutting slot.** Use this ONLY when NO single changed line is the
   locus, when the trade-off emerges from the COMBINATION of several changes, or
   from something the diff does NOT do, so there is genuinely nothing to anchor to.
   If a changed line IS the cause and an untouched invariant is the consequence,
   that is NOT this slot: anchor to the changed line (rule 1) and name the
   interaction in `tradeoff`. For the truly anchorless case you MAY emit at most ONE
   item with `anchor: "cross-cutting"`, `confidence: "low"`, naming the spanned
   files/invariants in `observed`. If in doubt, anchor locally; this slot is rare.
8. **Options make the choice space legible; they never pick.** "This is complex"
   leaves the author guessing, so an item MAY carry an `options` array naming the
   moves available. When present it holds at least TWO entries, each with a real
   `gains` and a real `costs`, in no ranked order, with no "recommended" marker
   and no adjective that tips the scale. "Keep as is" is a REQUIRED entry whenever
   `options` is present, with its own real gain and cost; it is the guard that
   keeps the named-moves list from turning into a refactor backlog. If you can
   only formulate one option besides it, omit `options` entirely: a single move
   is a prescription wearing a list.

## Named moves

Use this vocabulary for `move` so two runs describe the same restructuring the
same way. It is a vocabulary, not a checklist; "keep as is" is always a legitimate
option and often the one with the lowest cost.

- Replace a conditional chain with a typed model or a dispatcher.
- Collapse duplicate branches into one flow.
- Separate orchestration from business logic.
- Move feature-specific logic to the module that owns the concept.
- Reuse the canonical helper instead of a near-duplicate.
- Make a type boundary explicit so downstream branching disappears.
- Delete a pass-through wrapper that adds indirection without clarifying the API.
- Extract a helper, or split a large file into focused modules.
- Keep as is.

## Inputs to gather

```bash
# fallow's deterministic grounding: decisions already framed, the snapshot pin,
# structural facts, and where fallow says attention belongs.
fallow review --base <ref> --walkthrough-guide --format json > /tmp/fallow-guide.json

# the raw change you are reasoning about:
git diff <ref>...HEAD          # or: git diff --cached   for staged work
```

Read the guide's `digest.decisions.decisions[]` (what fallow already owns) and
`digest.focus.review_here[]` (where fallow says attention is), then read the diff
itself for everything fallow cannot prove. Echo `graph_snapshot_hash` so the
surface can be checked for staleness if it is fed back.

## The lenses (where non-deterministic trade-offs hide)

Scan the diff through these. Each is a place a defensible choice was made that the
diff itself does not explain:

- **Abstraction & duplication**: extracted vs inlined; a new abstraction vs YAGNI;
  a generalization built for a single caller.
- **Coupling & cohesion**: two concerns now joined; a module reaching across a
  seam; new shared mutable state.
- **Data model**: type shape; optional vs required; an invariant enforced by the
  type vs checked at runtime; enum vs open string.
- **Error handling**: Result vs throw/panic; propagate vs swallow; a silent
  fallback; the granularity of the failure.
- **Control flow & complexity**: a new branch that hides a second responsibility;
  an implicit ordering dependency between statements.
- **Performance vs simplicity**: sync vs async; eager vs lazy; a cache introduced
  (and its invalidation cost); work added to a hot path.
- **Dependencies**: a new dependency vs a few lines of native code; the transitive
  surface taken on.
- **Naming & API ergonomics**: a name that encodes an assumption; a boolean or
  positional parameter; a leaky abstraction.
- **Compatibility & migration**: breaking vs additive; an implied data or config
  migration; a deprecation path not laid.
- **State & ownership**: where state lives; lifecycle and cleanup; global vs scoped.
- **Extensibility vs simplicity**: a seam built for a future that may not arrive; a
  hard-coded choice that will be costly to change later.
- **Testability**: hidden time, IO, or randomness; a seam that was not left for a
  test.
- **Trust boundaries**: where input is validated; a trust assumption; secret
  handling; an injection surface.

These are prompts for YOUR attention, not a checklist to fill. Most diffs touch two
or three of these meaningfully.

## Output shape

A single envelope: the echoed snapshot hash, an `abstained` flag, and the
`tradeoffs` array (empty when `abstained`). Sort `tradeoffs` by `anchor` then
`lens` so two runs are structurally diffable.

```json
{
  "graph_snapshot_hash": "<echoed from the guide>",
  "abstained": false,
  "tradeoffs": [
    {
      "id": "to:src/core/api.ts:42:error-handling",
      "anchor": "src/core/api.ts:42",
      "lens": "error-handling",
      "observed": "save() returns the raw DB error to the caller.",
      "tradeoff": "Callers see the full storage error with no translation layer. Callers depend on the storage layer's error shapes.",
      "options": [
        {
          "move": "Keep as is",
          "gains": "Callers keep the full error detail and can match on the exact storage failure.",
          "costs": "Callers depend on the storage layer's error shapes."
        },
        {
          "move": "Make a type boundary explicit",
          "gains": "Callers depend on one domain error shape.",
          "costs": "Callers lose the storage detail the mapping does not carry, and the mapping is a new surface to keep in sync."
        }
      ],
      "question": "How should save() surface a storage failure to its callers?",
      "consequence": "high",
      "confidence": "medium",
      "captured": false,
      "deterministic": false
    }
  ]
}
```

- `id`: stable per item, `to:<anchor>:<lens>`, so a consumer can dedupe across
  re-runs and keep a human's dismissal sticky. Two trade-offs may legitimately share
  one anchor line through different lenses (e.g. a new parameter that is both an
  api-ergonomics and a compatibility question); the `lens` segment keeps their ids
  distinct, and that is intended, not a duplicate to collapse.
- `anchor`: a real changed `file:line`, or the literal `cross-cutting` (rule 7 only).
- `consequence`: `low` / `medium` / `high`, how much it matters if the call is
  wrong (impact). This is what you rank and cap on.
- `confidence`: `low` / `medium` / `high`, how strongly the diff itself supports your
  reading (sureness). ORTHOGONAL to `consequence`. Anchors: `high` = the diff alone
  shows it; `medium` = the diff plus a reasonable assumption about intent; `low` =
  mostly reconstructed, or the cross-cutting slot.
- `captured`: provenance hint, see rule 4. Not a trust score.
- `options`: OPTIONAL, see rule 8. Two or more `{ move, gains, costs }` entries drawn
  from the named moves, unranked, always including "Keep as is". Omit rather than
  pad; omit when no move besides keeping exists. No review surface renders
  `options` yet; it is for the terminal report and the human reading the JSON, and
  a surface that does not render it loses nothing, the question stands alone.
- `abstained: true` with `tradeoffs: []` is the terminal "looked, found nothing"
  state; distinguish it from a parse failure (no envelope at all).
- Render for a human as the anchor, then `observed -> trade-off -> options ->
  question`, with the question LAST so the human lands on the decision they own.

## What good looks like

- Each item names a real changed line (or the single cross-cutting slot), a concrete
  cost, and a GENUINELY OPEN question the human can answer without being steered.
- The surface is short: the top five by `consequence`, or fewer, or an honest
  abstain. Never padded to fill slots.
- `observed` reads as a neutral fact; the `question` names no fix. If a reader can
  guess your preferred answer from the question, reframe it.
- When `options` is present, both entries carry a real cost. If a reader can guess
  the preferred option from how the entries are worded, drop `options`.
- It does not repeat fallow's deterministic decisions; it covers the part the graph
  cannot see.
- It never tells the human what to choose.
