# Trade-off elicitation (taste-ownership review)

`fallow review`'s decision surface is the DETERMINISTIC slice: it surfaces only the
trade-offs fallow can prove from the module graph, a changed public-API contract
consumed outside the diff, a new boundary or coupling crossing, a new dependency.
Real architectural trade-offs are broader: abstraction level, error-handling
strategy, data-model shape, eager-vs-lazy, state ownership, extensibility-vs-YAGNI,
testability, trust boundaries. None of those are deterministically detectable from
the graph, so they need a model reading the diff.

This prompt elicits that broader set WITHOUT giving up fallow's honesty guarantees.
The governing principle is TASTE OWNERSHIP: the model makes each choice legible to
the human and frames the open question; the human decides. The model never
prescribes the answer, never blocks, never auto-applies.

## The honesty contract (non-negotiable)

1. **Anchor to the diff.** Ground every trade-off in a line PRESENT in the provided
   diff. If you cannot point at a changed `file:line`, drop it. No trade-offs about
   code that is not in the diff.
2. **Three layers, kept separate, per item:**
   - `observed` (FACT): what the change does, readable straight from the diff.
   - `tradeoff` (INFERENCE): what it gains and what it costs. Your reading, not
     ground truth.
   - `question` (DECISION): the call the human owns. Phrase it as a question, never
     as "you should...".
3. **Fence everything.** Mark every item `deterministic: false`. These are model
   inferences. They never gate and never auto-post.
4. **Capture beats reconstruction.** If you are the agent that wrote this code,
   state the actual rationale you had at write time (`captured: true`, high value).
   If you are reconstructing intent from someone else's diff, say so and lower the
   confidence. The "why" is usually not in the diff; do not pretend it is.
5. **Abstain freely.** A short, high-signal surface beats a checklist. Cap at about
   five trade-offs (the same working-memory bound as the decision surface). If
   nothing rises to a real decision, say "no consequential trade-offs beyond the
   deterministic surface" and stop.
6. **Do not duplicate fallow.** Read `digest.decisions.decisions[]` from the guide
   first; if fallow already framed it (public-API contract, boundary crossing, new
   dependency), do not re-raise it. You add the part fallow cannot see.

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

One object per surfaced trade-off, plus the echoed snapshot hash:

```json
{
  "graph_snapshot_hash": "<echoed from the guide>",
  "tradeoffs": [
    {
      "anchor": "src/core/api.ts:42",
      "lens": "error-handling",
      "observed": "save() returns the raw DB error to the caller instead of mapping it.",
      "tradeoff": "Keeps the call site thin, but leaks the storage layer into the public contract; every caller now couples to DB error shapes.",
      "question": "Is leaking the storage error intentional, or should this map to a domain error at the boundary?",
      "confidence": "medium",
      "captured": false,
      "deterministic": false
    }
  ]
}
```

- `captured: true` = you wrote this code and this is the actual rationale
  (capture-at-write-time). `false` = reconstructed from the diff (lower trust).
- `confidence`: `low` / `medium` / `high`, by how strongly the diff itself supports
  the reading.
- Render for a human as the anchor, then `observed -> trade-off -> question`, with
  the question LAST so the human lands on the decision they own.

## What good looks like

- Each item names a real changed line, a concrete cost, and a question the human
  can actually answer.
- The surface is short. If you wrote ten, you did not prioritize.
- It does not repeat fallow's deterministic decisions; it covers the part the graph
  cannot see.
- It never tells the human what to choose.
