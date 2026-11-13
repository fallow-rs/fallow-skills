# Run control

Read this file when a run exits 2, when a run is `partial`, slow or stopped,
when the plan is large, when you record a verdict, or when the user asks
for a gate.

## Limits and long runs

| Situation | Flag |
| --- | --- |
| The plan has hundreds of mutants | `--max-mutants <N>` runs the N best-ranked mutants. `--time-budget <duration>` starts no mutant after that time. The other mutants are `pending`, and the run is `partial`. |
| A limit ended the run, or the run stopped | `--resume` with the same scope flags continues it. Leave out or raise the limit that ended it: with the same `--max-mutants`, the resume runs no new mutant. |
| Another run or another agent uses the same machine | `--concurrency 2`. The default is half the logical cores. |
| The runner does not start in time on a slow or busy host | `--setup-timeout 5m`. The default is `2m`. |
| You want the survivors without those that do not type-check | `--typecheck`. On `FALLOW_MUTATION_TYPECHECK_UNAVAILABLE`, run without it. |

A run does not end at its `--time-budget`. The runner setup, the baseline
run and the retries of the survivors come on top. Use a budget some minutes
shorter than the longest command timeout that you have. When the timeout
ends the command, continue with `--resume`.

Two runs in one project at the same time write one saved report. `tasks`
and `--recheck` then read the report of only one of them.

## Exit code 2

Read `code` and `message` of the JSON error. Some errors have no `code`.

| Error | Action |
| --- | --- |
| `FALLOW_MUTATION_DIRTY_WORKTREE` | The worktree has uncommitted changes. When the path is a report or a verdict document, move it as agent rule 3 says. For a change of the user, pass `--allow-dirty`. |
| `FALLOW_MUTATION_RUNNER_FAILED`, `FALLOW_MUTATION_RUNNER_UNSUPPORTED` | The project has no supported test runner, or its version is outside the supported range. Stop and give the user the `message`. Do not install or upgrade a runner. |
| `FALLOW_MUTATION_NON_TEST_CHANGE`, `FALLOW_MUTATION_SOURCE_CHANGED` | A recheck found a change to a source file. Run without `--recheck`. |
| `FALLOW_MUTATION_RESUME_MISMATCH` | The journal comes from a run with other inputs. Run without `--resume`. |
| The message has `unexpected argument` | The installed fallow is older than the flag. Tell the user to update fallow, and continue without the flag when the loop permits. |
| The message says that `--output-file` is outside the project root | Use a path in `.fallow/` or in the system temp directory. |

## A run that is not conclusive

- `completion.status: "partial"`: read `completion.reasons`. `mutant-limit`
  and `time-budget` mean that `pending` mutants did not run. An empty
  survivor list then proves nothing about them.
- `errors` has `test-files-not-discovered`: the runner did not run a test
  file that the plan maps. Select the Vitest config that includes the file
  with `--runner-config <path>`.
- Many `no_coverage` mutants in code that has tests: those tests did not
  run. Compare `test_files` of the plan with the test files of the project,
  and look for a second runner config. Do not write tests that exist.
- `baseline_failures`: a test fails on the original code, so its result
  decides no mutant. Fix that test, or tell the user, then run again.
- A mutant with the status `flaky` or `runtime_error` has no result. Run
  again, with `--concurrency 1` when the tests share a database or files.

## Verdict document

```json
{
  "schema_version": "1",
  "verdicts": [
    { "review_key": "<mutant_id>", "verdict": "equivalent", "note": "At 0 percent the formula also returns the full amount." }
  ]
}
```

- `review_key` is the `mutant_id`. It stays the same until the function of
  the mutant changes.
- Write the document to `.fallow/mutation-verdicts.json`, as agent rule 3
  says. Commit it in another location only when the user asks, for example
  for a `--min-score` gate in CI.
- Read `verdicts` in the report. `applied` lists the verdicts that took
  effect. `contradicted` lists the mutants that a test detects, so those
  verdicts are wrong. `unmatched` lists the ids that the run does not have.

## Gate and score

- `--min-score <0-100>` exits 1 when the score is below that percentage.
  Add it only when the user asks for a gate.
- `summary.score` is a fraction from 0 to 1. It counts only the mutants
  that ran: `no_coverage`, `pending` and `equivalent` mutants are not in
  it. Report `summary.coverage` and `completion.status` with each score.
- `fallow health --mutation-report <path>` shows the score of each complex
  function from a saved report. It runs no test.
