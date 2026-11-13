# Changes to the test suite

Read this file when the task is to remove, merge or refactor tests. The loop
in `SKILL.md` adds tests. These modes show which tests detect each mutant, so
that you can change tests without a loss of protection.

## Check named tests: `--kill-matrix-for`

```bash
fallow mutation src/cart.ts --kill-matrix-for "src/cart.test.ts::adds the lines" --format json --quiet
```

A target is a test file (each test in it) or a test id (`file::name`).
Repeat the flag for each target. Only the mutants that a target covers run,
so this mode is the fast one. Read `kill_matrix.targets` and
`kill_matrix.tests`:

- When a target selects no test, the command exits 2 with
  `FALLOW_MUTATION_TARGET_UNMATCHED`. Copy the test id from `covering_tests`
  of `fallow mutation inspect`.
- A target with `status: "incomplete"` gives no evidence. Read its
  `reasons`.
- A test with kills, an empty `unique_kills` and an empty
  `target_only_kills` is a candidate: tests outside the targets detect each
  mutant that it detects.
- `target_only_kills` lists the kills that only other targets share. Keep
  one of the targets that share a kill.
- A test without kills is not proof of a test without assertions.

## Find candidates in a scope: `--kill-matrix`

```bash
fallow mutation src/cart.ts --kill-matrix --format json --quiet
```

This mode runs each covering test of each mutant, so it takes longer than a
normal run. Use a path scope. Use `--all` only when the user asks for the
whole project. It is exclusive with `--kill-matrix-for`.

- Read `kill_matrix.status` first. Only `complete` gives candidates.
- `kill_matrix.candidates` lists the tests whose kills other tests cover.
  `kill_matrix.tests[].subsuming_tests` names those other tests.
- `kill_matrix.coverage_without_kills` lists the tests that reach code and
  kill no mutant.

## Rules for a removal

1. A candidate is evidence, not a verdict. The evidence covers the planned
   scope only: the test can protect code outside that scope.
2. Review each candidate separately. Two tests with equal kill sets are
   both candidates. Remove one, not both.
3. Read the test before you remove it. Keep a test that documents a
   requirement or a past defect, and say so in the report.
4. Show the candidates to the user. Remove a test only when the user agrees.
5. After the removal, prove the result with `--compare`.

## Prove that a change kept the protection: `--compare`

```bash
test -f .fallow/.gitignore && before=.fallow/before.json || before="${TMPDIR:-/tmp}/before.json"
fallow mutation src/cart.ts --format json --quiet -o "$before"
# change, move or remove tests, then commit
fallow mutation src/cart.ts --compare "$before" --format json --quiet
```

- Use the same paths for the two runs. Fallow matches the mutants by
  `mutant_id`, and an id stays the same until its function changes.
- The saved report and the run must both be `complete`. Otherwise the
  command exits 2 with `FALLOW_MUTATION_COMPARE_INCOMPLETE`.
- `compare.regressed` is the number of mutants that were detected before
  and are not detected now. Each one is in `compare.mutants[]` with
  `change: "regressed"`, and `previous_killing_tests` names the test that
  detected it. The exit code does not change on a regression.
- A saved report in a tracked project directory makes the worktree dirty,
  and the second run then exits 2.
