---
name: fallow-mutation
description: Mutation testing for TypeScript and JavaScript with `fallow mutation`. Use when asked to improve, strengthen or check the tests of a change, a PR, a branch or a file, to check whether a test can fail at all, to find behavior that the tests do not protect, to find redundant tests, to check that a change of the tests did not weaken them, to gate a mutation score, or to run fallow mutation. Do not use to raise line coverage, to write one requested test, or to fix a failing test. Do not use for Rust code; use cargo-fallow for that.
license: MIT
---

# Fallow Mutation: test the tests of TypeScript and JavaScript

`fallow mutation` makes small edits to the code (mutants) and runs the
project tests against each one. A mutant that no test detects survived: the
code can be wrong there while the tests pass. You write the tests.

To add tests, do the loop below. To remove, merge or refactor tests, read
[references/test-suite-changes.md](references/test-suite-changes.md).

## When not to use

- Rust code: use the `cargo-fallow` skill (`cargo fallow mutants`).
- A pass or fail verdict for a PR: use the `fallow` skill (`fallow audit`).
  `fallow audit` and `fallow review` never start a run.

## Agent rules

1. A run executes the project tests many times, and the tests can write
   files or call other systems. Start a run when the user asks for better
   tests, for a check of the tests, for a removal of tests, or for mutation
   testing. In each other task, show the plan of step 1 and ask. Only the
   CLI starts a run: the MCP tools `mutation_plan`, `mutation_inspect` and
   `mutation_tasks` run no test.
2. Use `--format json --quiet` and parse stdout as JSON. Exit code 0 means
   that the run finished, also with survivors. Exit code 1 means a score
   below `--min-score`. Exit code 2 means an error, with a `message` in the
   JSON. On exit code 2 and on a `partial` run, read
   [references/run-control.md](references/run-control.md). Read
   `fallow mutation --help` before you use a flag that these files do not
   name.
3. Keep each report and the verdict document out of the tracked tree, and
   do not commit them or the run journal. Use `.fallow/` when
   `.fallow/.gitignore` exists after the plan of step 1, else the system
   temp directory. A `>` redirect or a `-o` path in another project
   directory makes the worktree dirty, and a run then exits 2.
4. Start a run in the foreground and wait for the result. Do not end your
   turn while a run is in progress. When your shell has a command timeout,
   pass a `--time-budget` some minutes shorter than it, and continue with
   `--resume` until the run is `complete`.
5. When another run or another agent uses the same machine, pass
   `--concurrency 2`. Do not start two runs in one project at the same time.
6. Do not pass `--allow-side-effects`. Fallow skips the mutants in a
   function that writes to a file system, a process, a network or a
   database. Such a mutant can remove the guard of a real write. The check
   does not follow calls into helpers. Pass the flag only when the user
   asks for it and the tests cannot reach a real system.

## The loop

### 1. Plan

```bash
fallow mutation --plan --base main --format json --quiet
```

The plan runs no code. Replace `main` with the base branch of the change.
Read `counts`, then check these conditions:

| Condition | Action |
| --- | --- |
| The test script in `package.json` uses a runner other than Vitest, `node:test` or `bun test` (for example Jest or Mocha) | Start no run, and do not install a runner to make a run possible. Tell the user. Then write tests for the behavior of the change without mutation evidence, and say so in the report. |
| `counts.planned` is 0 or very low, and the change is a signature or a parameter | Add `--function-scope`. |
| `counts.planned` is 0, and `counts.pruned_dead_code` or `counts.pruned_side_effect_sink` is not 0 | Start no run. No test and no other code imports the change, or each changed function writes to a real system. Tell the user. |
| `counts.planned` is 0 for another reason | Replace `--base` with the changed files as paths: `fallow mutation src/cart.ts`. With a path, fallow mutates each line of the file. |
| The change is in one package of a monorepo | Run from the root with `--base`. With a package directory as a path, fallow mutates the whole package. `--workspace` exits 2. |
| `counts.planned` is above 100 | Tell the user the size. Read [references/run-control.md](references/run-control.md) and set a limit. |

Done when: you know the test runner, the number of planned mutants, and
the limits of the run.

### 2. Run

```bash
fallow mutation --base main --format json --quiet
```

A run exits 2 when the worktree has an uncommitted file, also a new test.
Do not commit for the user. Pass `--allow-dirty` when a source file or a
test file is not committed. When a source file is not committed, repeat
this step in place of step 5.

Read these fields before the open mutants:

- `completion.status`. Only `complete` makes an empty list of survivors
  conclusive. A `partial` run lists its `reasons`.
- `baseline_failures`. A test that fails on the original code decides no
  mutant. Fix that test first, then run again.
- `errors`, and `no_coverage` mutants in code that has tests. Both can mean
  that a test file did not run.

Done when: the run is `complete`, or you can name each reason why it is
`partial`.

### 3. Sort each open mutant

```bash
fallow mutation tasks --format json --quiet
fallow mutation inspect <mutant_id> --format json --quiet
```

`tasks` lists each open mutant, which is a `survived` or `no_coverage`
mutant, with the source line before and after the edit. `inspect` adds the
covering tests of one mutant. Both run no code. Put each open mutant in one
class:

| Class | How you know | Action |
| --- | --- | --- |
| Test gap | A valid input exists for which the original and the mutant give different results that a caller can see | Write a test in step 4. |
| Equivalent | No valid input can show a difference, also not through internals | Add the `mutant_id` to the verdict document, with a note that gives the reason. |
| Dead code | No caller can reach the mutated branch | Report it. Do not write a test for it. |
| Defect | The mutant gives the behavior that the docs, the names or the user specify, and the original does not | Report it with an input that shows the difference. Add the failing test and fix the code only when the user agrees. |

Fallow removes a mutant with a verdict from the score, so record a verdict
only for an equivalent mutant. Read the code before you trust an
`equivalence_hint`. [references/run-control.md](references/run-control.md)
has the shape of the verdict document. Pass `--verdicts <path>` to each
later run and recheck.

Done when: each open mutant has a class.

### 4. Write behavior tests

Write each test through the public interface. Use an input that gives
different results on the original and on the mutant, and assert the exact
result. For a boundary, test the value at the boundary and one value at
each side.

Do not write a test that only pins an implementation detail to kill a
mutant. Examples are a spy on an internal helper, an assertion on call
order and a snapshot of an internal value. When only such a test can kill
the mutant, leave the mutant open and report it.

Done when: each test gap has a test, and each test passes on the original
code.

### 5. Recheck

```bash
fallow mutation --recheck --format json --quiet
fallow mutation tasks --format json --quiet
```

`--recheck` runs only the open mutants of the saved report against the
current tests. You can commit the new tests or leave them uncommitted. A
recheck skips the mutants that a test killed before. After a change to a
source file or to an existing test, do step 2 again. Do step 3 again for
the mutants that are still open.

Done when: `tasks` lists no test gap. Then do step 2 again, because the
`summary` of a recheck does not give the score of the full scope. Report
these items:

- `summary.score`, `summary.coverage` and `completion.status`, before and
  after;
- the scope, the base ref and each limit flag of the runs;
- each mutant that you marked equivalent, with its note;
- each mutant that you left open, with its class and its reason.
