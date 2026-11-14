# Run control

Read this file when one of these conditions is true:

- a command exits 2;
- a run is `partial`, or your command timeout stopped it;
- the plan has more than 100 mutants;
- you record a verdict;
- the user asks for a gate or a score.

## Limits and long runs

| Situation | Flag |
| --- | --- |
| The plan is large | `--max-mutants <N>` runs the N best-ranked mutants. `--mutants-per-line 1` keeps one mutant on each line. `--time-budget <duration>` starts no mutant after that time. The other mutants are `pending`, and the run is `partial`. |
| A limit ended the run, or the run stopped | `--resume` with the same scope flags continues it. Remove or raise the limit that ended it: with the same `--max-mutants`, the resume runs no new mutant. |
| The runner does not start in time on a slow or busy host | `--setup-timeout 5m`. The default is `2m`. |
| You want the survivors without those that do not type-check | `--typecheck`. On `FALLOW_MUTATION_TYPECHECK_UNAVAILABLE`, run without it. Report the `compile_error` count, because those mutants are not in the score. |

A run does not end at its `--time-budget`. The tests in progress at that
time finish first, and the retries of the survivors add more time.
`--max-mutants` limits the number of mutants, not the time.

Two runs in one project at the same time write one saved report. `tasks`
and `--recheck` then read the report of only one of them.

## Exit code 2

Read `code`, `message` and `help` of the JSON error. Some errors have no
`code`.

| Error | Action |
| --- | --- |
| `FALLOW_MUTATION_DIRTY_WORKTREE` | The worktree has an uncommitted file. When the file is a report or a verdict document, move it as agent rule 3 says. For an uncommitted source file or test file, pass `--allow-dirty`. |
| `FALLOW_MUTATION_RUNNER_FAILED`, `FALLOW_MUTATION_RUNNER_UNSUPPORTED` | When `help` names `--setup-timeout`, run again with `--setup-timeout 5m`. In each other case, the project has no supported test runner, or its version is outside the supported range. Stop and give the user the `message`. Do not install or upgrade a runner. |
| `FALLOW_MUTATION_BASELINE_FAILED` | The tests fail on the original code. Run the test command of the project. Fix the failing test, or tell the user, then run again. |
| `FALLOW_MUTATION_NON_TEST_CHANGE`, `FALLOW_MUTATION_SOURCE_CHANGED` | A recheck found a change to a file that is not a test file. Run without `--recheck`, and with `--allow-dirty` when the change is not committed. |
| `FALLOW_MUTATION_NOTHING_TO_RECHECK` | The saved report has no open mutant. Do the last run of step 2. |
| `FALLOW_MUTATION_RESUME_MISMATCH` | The journal comes from a run with other inputs. Run without `--resume`. |
| The message has `unexpected argument` or `invalid value` | The installed fallow is older than this skill. Run `fallow --version` and tell the user to update fallow. Continue without that argument when the loop permits. Do not try other spellings. |
| The message says that `--output-file` is outside the project root | Use a path in `.fallow/` or in the system temp directory. |

## A run that is not conclusive

- `completion.reasons` has `mutant-limit`, `time-budget` or `sampled-out`:
  the `pending` mutants did not run. An empty list of survivors then
  proves nothing about them.
- `errors` has `test-files-not-discovered`: the runner did not run a test
  file that the plan maps. Select the Vitest config that includes the file
  with `--runner-config <path>`.
- Many `no_coverage` mutants in code that has tests: read `errors` first.
  Then run the test command of the project, and compare the files that it
  runs with `test_files` of the plan. Do not write tests that exist.
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
- Write the document to the directory that agent rule 3 names, for example
  `.fallow/mutation-verdicts.json`. Commit it in another location only when
  the user asks, for example for a `--min-score` gate in CI.
- Read `verdicts` in the report. `applied` lists the verdicts that took
  effect. `contradicted` lists the mutants that a test detects, so those
  verdicts are wrong. `unmatched` lists the ids that the run does not have.

## Gate and score

- `--min-score <0-100>` exits 1 when the score is below that percentage.
  Add it only when the user asks for a gate.
- `summary.score` is a fraction from 0 to 1. It counts only the mutants
  that ran: `no_coverage`, `pending` and `equivalent` mutants are not in
  it. Report `summary.coverage` and `completion.status` with each score.
- Each run saves its report to `.fallow/mutation/last-report.json`, or to
  the directory of `FALLOW_CACHE_DIR` when that variable is set.
- `fallow health --mutation-report <path>` shows the score of each complex
  function from a saved report. It runs no test.
