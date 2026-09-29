# Production runtime data in a review

Fallow Cloud records which functions run in production. Use this data when a
change edits or deletes a function. The data is context for the review. It
never replaces the static brief, and it never gates the verdict.

Skip this file when the project has no Fallow Cloud connection. The CLI reads
the key from `--api-key` or `FALLOW_API_KEY`. The MCP tools read
`FALLOW_API_KEY` from the server environment only. Without a key, a cloud read
is refused before it sends a request.

## Pick the smallest read

| Question | CLI | MCP tool |
|---|---|---|
| Is a changed function hot, cold, or tested? | `fallow coverage review-packet --repo <owner/repo>` | `get_cloud_review_packet` |
| Did the last deploy change what runs? | `fallow coverage deployment-changes --repo <owner/repo>` | `get_cloud_deployment_changes` |
| Full runtime picture of the whole project | `fallow coverage analyze --cloud --repo <owner/repo> --format json --quiet` | `get_cloud_runtime_context` |

Prefer the two scoped reads. They return only the functions or the deploy that
you ask about. The full runtime-context pull downloads the evidence of every
function and runs a full local static analysis first. Use it only when a
question covers the whole project.

## Before you edit a function

Get the review packet for the changed files:

```bash
# Default scope: the source files changed against the base (same base rules as audit)
fallow coverage review-packet --repo <owner/repo> --base origin/main

# Narrow scope: one file, or one function
fallow coverage review-packet --repo <owner/repo> --file src/billing/invoice.ts
fallow coverage review-packet --repo <owner/repo> --function src/billing/invoice.ts:buildInvoice:42
```

Over MCP, call `get_cloud_review_packet` with `repo` and `files[]` or
`functions[{file, name, line?}]`.

Read these fields on each entry of `functions[]`:

- `hit_count`: the production call count. Use it to rank hot functions. Do not
  use `prod_hit_count` for this, because it counts only tagged traffic and is
  too low.
- `tracking_state`: `called`, `never_called`, or `untracked` in the current
  deployment.
- `covered_by_test`: `true` or `null`. `null` means "no test evidence". It does
  not mean "no test".
- `blast_radius.caller_count` and `blast_radius.caller_sites`: the callers,
  when the data exists. `null` means unknown, not zero.

A hot function with `covered_by_test: null` is a high-risk edit. Say so in the
review, and ask for the verification plan. `prod_hot_untested[]` lists the hot
functions with no test evidence over the whole window, not only in the diff.

An entry in `not_found` has no cloud data. Absence is not evidence that the
code is cold.

## Before you delete code as unused

A static "unused" finding plus a cold runtime signal is strong evidence. Both
parts must hold:

1. `period_tracking_state` is `never_called`. This field covers the full
   period. `tracking_state` covers only the current deployment. A function
   that ran last week and not since the last deploy shows `never_called` in
   `tracking_state`, but `called` in `period_tracking_state`.
2. `evidence_window.observed_hours` is large enough for the traffic of that
   code. A low value means that production ran for a short time only.

A function with `period_tracking_state: "called"` cannot get a `safe_to_delete`
verdict. Do not delete it.

"Never called" on a surface with low traffic means "not visited". It does not
mean "dead". Examples of such code: an admin page, a yearly job, an error
handler, a feature behind a flag. For this code, ask the owner before the
delete, or keep the code.

Confirm the static side with `fallow dead-code --trace <file>:<export>` before
the delete.

## After a deploy

Compare the new deployment with the previous one:

```bash
fallow coverage deployment-changes --repo <owner/repo>                  # HEAD against the previous deployment
fallow coverage deployment-changes --repo <owner/repo> --sha <sha> --base <sha>
fallow coverage deployment-changes --repo <owner/repo> --change stopped --limit 50
```

Over MCP, call `get_cloud_deployment_changes` with `repo` and optional `sha`,
`base`, `change`, `limit`, and `cursor`.

Each function gets one change kind: `stopped`, `new_not_called`, `heated_up`,
`cooled_down`, `new_called`, or `unchanged`. Use `--cursor` to get the next
page.

When `comparable` is `false`, read `reason` and report it. Do not claim a
regression or a stop from that report. Examples of reasons:

- `head_warming_up`, `head_short_window`, `head_insufficient_runtime`: the new
  deployment has too little runtime. Try again later.
- `no_base_deployment`: there is no previous deployment to compare.
- `runtime_surfaces_differ`, `runtime_surfaces_unknown`,
  `function_set_differs`: the two deployments do not measure the same code.

The change report is context. It never proves that a function is dead.

## Open the right file

Each function carries `repo_path` and `file_path`. Use `repo_path` to open or
edit the file. `file_path` is the path that the runtime reported, for example
`/app/src/x.ts` in a container. It often does not exist in the checkout.

## Rules

- Production data is context. It never changes the static findings and never
  gates the review.
- Cite numbers: `hit_count`, `caller_count`, `observed_hours`. "Hot" without a
  number is not a finding.
- Treat `null` as unknown. Never read `null` as zero, false, or cold.
