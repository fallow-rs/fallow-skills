---
name: fallow-mutation
description: Mutation testing for TypeScript and JavaScript with `fallow mutation`. Use when asked to improve, strengthen or check the tests of a change, a PR, a branch or a file, to find out whether a test can fail at all, to find behavior that the tests do not protect, to find redundant tests, to check that a change of the tests did not weaken them, to gate a mutation score, or to run fallow mutation. Do not use for Rust code; use cargo-fallow for that.
license: MIT
---

# Fallow Mutation: test the tests of TypeScript and JavaScript

`fallow mutation` makes small changes to the code (mutants) and runs the
project tests against each one. A mutant that no test fails on survived: the
code can be wrong there while the tests pass. Fallow writes no test and
changes no project file. You write the tests.

To add tests, do the loop below. To remove, merge or refactor tests, read
[references/test-suite-changes.md](references/test-suite-changes.md).

## When not to use

- Rust code: use the `cargo-fallow` skill (`cargo fallow mutants`).
- A pass or fail verdict for a PR: use the `fallow` skill (`fallow audit`).
  `fallow audit` and `fallow review` never start a mutation run.
- Code that no test reaches at all: use the `fallow` skill
  (`fallow health --coverage-gaps`).

## Agent rules

1. A run executes the project tests many times, and the tests can write
   files or call other systems. Start a run when the user asks for better
   tests, for a check of the tests, or for mutation testing. In each other
   task, show the plan of step 1 and ask.
2. Use `--format json --quiet` and parse stdout as JSON. Exit code 0 means
   that the run finished, also with survivors. Exit code 1 means a score
   below `--min-score`. Exit code 2 means invalid input or an execution
   error, and stdout then holds a JSON error with a `message`. When the
   message is `unexpected argument`, the installed fallow is older than the
   flag: tell the user to update fallow.
3. Keep each report and the verdict document out of the tracked tree, and
   do not commit them. Each run saves its report to
   `.fallow/mutation/last-report.json`. Use `.fallow/` when
   `.fallow/.gitignore` exists, else the system temp directory. A `>`
   redirect or a `-o` path in another project directory makes the worktree
   dirty, and a run then exits 2.
4. Start a run in the foreground and wait for the result. Do not end your
   turn while a run is in progress. Setup and retries come on top of
   `--time-budget`, so use a budget some minutes shorter than the longest
   command timeout that you have, and continue with `--resume`.
5. Do not pass `--allow-side-effects`. Fallow skips the mutants in a
   function that writes to a file system, a process, a network or a
   database, because such a mutant can remove the guard of a real write.
   The check does not follow calls into helpers. Pass the flag only when
   the user asks for it and the tests cannot reach a real system.

## The loop

### 1. Plan

```bash
fallow mutation --plan --base main --format json --quiet
```

The plan runs no code. Without `--base`, fallow finds the base ref as
`fallow audit` does. Read `counts` for the size of the run, then check
these conditions:

| Condition | Action |
| --- | --- |
| The test script in `package.json` uses a runner other than Vitest, `node:test` or `bun test` (for example Jest or Mocha) | Start no run, and do not install a runner to make a run possible. Tell the user. Then write tests for the behavior of the change without mutation evidence, and say so in the report. |
| `counts.planned` is 0 and the change is a signature or a parameter | Add `--function-scope`. |
| `counts.planned` is 0 for another reason | Replace `--base` with the changed files as paths: `fallow mutation src/cart.ts`. A path mutates each line of the file. |
| The change is in one package of a monorepo | Run from the root with `--base`. A package directory as a path mutates the whole package, and `--workspace` exits 2. |
| `counts.planned` is in the hundreds | Add `--max-mutants <N>` or `--time-budget 5m`. |

Done when: you know the test runner, the number of planned mutants, and
the limits of the run.

### 2. Run

```bash
fallow mutation --base main --format json --quiet
```

A run exits 2 on a worktree with uncommitted changes. Do not commit for
the user. When the change is not committed, pass `--allow-dirty`, and then
repeat this step in place of step 5: a recheck refuses an uncommitted
change to a source file.

| Situation | Flag |
| --- | --- |
| Another run or another agent uses the same machine | `--concurrency 2` (the default is half the logical cores). Do not start two runs in one project at the same time: they share one saved report. |
| The runner does not start in time on a slow or busy host | `--setup-timeout 5m` |
| The run stopped, or a limit ended it | `--resume` with the same scope flags continues it. Leave out or raise the limit that ended it. |
| You want the survivors without those that do not type-check | `--typecheck`. On `FALLOW_MUTATION_TYPECHECK_UNAVAILABLE`, run without it. |

Read these fields before the survivors:

- An error with the code `FALLOW_MUTATION_RUNNER_FAILED` or
  `FALLOW_MUTATION_RUNNER_UNSUPPORTED`. Stop and give the user the
  `message`. Do not install or upgrade a runner.
- `completion.status`. Only `complete` makes an empty survivor list
  conclusive. A `partial` run lists its `reasons`.
- `baseline_failures`. A test that fails on the original code decides no
  mutant. Fix that test first, then run again.
- `errors`. The entry `test-files-not-discovered` means that a test file did
  not run. Select its Vitest config with `--runner-config <path>`.
- Many `no_coverage` mutants in code that has tests. Those tests did not
  run: compare the `test_files` of the plan with the test files of the
  project, and look for a second runner config.

Done when: the run is `complete`, or you can name each reason why it is
`partial`.

### 3. Sort each open mutant

```bash
fallow mutation tasks --format json --quiet
fallow mutation inspect <mutant_id> --format json --quiet
```

`tasks` lists each `survived` and `no_coverage` mutant with the source line
before and after the change. `inspect` adds the covering tests of one
mutant. Both run no code. Put each mutant in one class:

| Class | How you know | Action |
| --- | --- | --- |
| Test gap | A valid input exists for which the original and the mutant give different results that a caller can see | Write a test in step 4. |
| Equivalent | No valid input can show a difference, also not through internals | Add the `mutant_id` to the verdict document, with a note that gives the reason. |
| Dead code | No caller can reach the mutated branch | Report it. Do not write a test for it. |
| Defect | The mutant gives the behavior that the docs, the names or the user specify, and the original does not | Report it with an input that shows the difference. Add the failing test and fix the code only when the user agrees. |

An `equivalence_hint` on a mutant is advisory: read the code before you
record a verdict. A verdict takes the mutant out of the score, so record
one only for a mutant that is equivalent. Pass `--verdicts <path>` to each
later run and recheck:

```json
{ "schema_version": "1", "verdicts": [
  { "review_key": "<mutant_id>", "verdict": "equivalent", "note": "At 0 percent the formula also returns the full amount." }
] }
```

Done when: each open mutant has a class.

### 4. Write behavior tests

Write each test through the public interface, with an input that gives
different results on the original and on the mutant. Assert the exact
result. For a boundary, test the value at the boundary and one value at
each side.

Do not write a test that only pins an implementation detail to kill a
mutant: a spy on an internal helper, an assertion on call order, or a
snapshot of an internal value. When only such a test can kill the mutant,
leave the mutant open and report it. Do not record a verdict for it.

Done when: each test gap has a test, and each test passes on the original
code.

### 5. Recheck

```bash
fallow mutation --recheck --format json --quiet
fallow mutation tasks --format json --quiet
```

`--recheck` runs only the open mutants of the last report against the
current tests. The new tests can be committed or not. It takes no scope
flag, no `--allow-dirty` and no `--max-mutants`. It does not run the
mutants that were killed before, so do step 2 again after a change to a
source file or to a test that existed before. Go back to step 3 with the
mutants that are still open.

The `summary` of a recheck does not give the score of the full scope. For
that score, do step 2 again when `tasks` lists no test gap.

Done when: `tasks` lists no test gap. Report `summary.score` (a fraction
from 0 to 1) before and after, and each mutant that you left open with its
class and its reason.

## Other surfaces

- `--min-score <0-100>` (a percentage) exits 1 when the score is lower. Add
  it only when the user asks for a gate. The score counts only the mutants
  that ran, so read `summary.coverage` and `completion` with it.
- The fallow MCP server has `mutation_plan`, `mutation_inspect` and
  `mutation_tasks`. They run no test. Only the CLI starts a run.
- `fallow health --mutation-report <path>` shows the score of each complex
  function from a saved report. It runs no test.
- `fallow mutation --help` has each flag. Read it before you use a flag
  that this file does not name.
