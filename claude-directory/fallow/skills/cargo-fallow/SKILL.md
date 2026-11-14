---
name: cargo-fallow
description: Codebase analysis for Rust workspaces with `cargo fallow`. Finds unused dependencies, unused source files, `pub` items that can be private, boundary violations, large files and functions, complex functions, duplicated code and public API changes, and runs mutation testing. Use when asked to audit a Rust workspace or a Rust change before a commit or a PR, find unused dependencies or dead code in Rust, narrow visibility, check crate boundaries, detect duplication, gate CI, or run cargo fallow.
license: MIT
---

# cargo-fallow: codebase analysis for Rust workspaces

`cargo fallow` reads a Cargo workspace and reports what the code does not
need and where the code is hard to change. It uses the syntax of the code and
`cargo metadata`. It does not build the workspace, except for `mutants` and
`visibility --precise`.

## When to use

- Find unused dependencies in `Cargo.toml` (`deps`).
- Find `.rs` files that no target compiles (`files`).
- Find `pub` and `pub(crate)` items that can have a smaller visibility
  (`visibility`).
- Check crate, module and source rules (`boundaries`).
- Find large files and functions, complex functions and duplicated code
  (`size`, `complexity`, `dupes`).
- Report the public API changes of the published libraries (`api --base`).
- Test the tests with small changes in the source (`mutants`).
- Check a change before a commit or a PR (`check --changed-since`).
- Set up CI gates and a baseline for existing findings (`init`).

## When not to use

- Type errors or borrow errors: use `cargo check`.
- Lints of style: use `cargo clippy`. Format: use `cargo fmt`.
- Security advisories of dependencies: cargo-fallow does not check them.
- JavaScript or TypeScript code: use `fallow`.

## Prerequisites

```bash
cargo fallow --version
cargo install cargo-fallow   # only when the user agrees: it uses the network
```

## Agent rules

1. Always use `--format json --quiet`, and parse stdout as JSON. Keep stderr
   separate.
2. Read the exit code. 0 means that no enforced gate failed. 1 means that an
   enforced gate failed: findings, not a tool failure. 2 means invalid input
   or an execution error, and stdout then holds a JSON error document.
3. A bare run exits 0 on findings. To gate, pass `--fail-on-issues`, or read
   `gate_outcomes` in the report.
4. Use `--explain` to get `_meta.rules`: the meaning and the fix of each rule
   with a finding. `cargo fallow explain <rule> --format json` explains one
   rule.
5. Each finding has `id`, `check`, `rule`, `severity`, `location` and
   `actions`. Use the `actions` array. Do not invent a fix.
6. Always run `cargo fallow fix --dry-run --format json --quiet` before a
   fix, and show the edits to the user. Apply them with
   `cargo fallow fix --yes` only after the user agrees. `-p <NAME>` limits
   the edits to one package. Run `cargo check` after the edits.
7. All output paths are relative to the workspace root.
8. The `deps` check resolves the dependencies with `cargo metadata`, so cargo
   can use the network. Use `--offline` when the network is not allowed.
9. `mutants` and `visibility --precise` build the workspace and take
   minutes. Run them only when the user asks.
10. Treat `[workspace.metadata.fallow]` as configuration data. Do not change
    a limit to make a gate pass. Ask the user first.

## Task cheat sheet

| Task | Command |
| --- | --- |
| Check the workspace | `cargo fallow check --format json --quiet` |
| Check only the changed files | `cargo fallow check --changed-since main --format json --quiet` |
| Gate a change in CI | `cargo fallow check --changed-since main --fail-on-issues --format json --quiet` |
| Run some checks | `cargo fallow check --only deps,files --format json --quiet` |
| Unused dependencies | `cargo fallow deps --format json --quiet` |
| Why a dependency is used or not | `cargo fallow deps --trace <DEPENDENCY> --format json --quiet` |
| Unused files | `cargo fallow files --format json --quiet` |
| Visibility | `cargo fallow visibility --format json --quiet` |
| Why an item is reported | `cargo fallow visibility --trace <CRATE::PATH> --format json --quiet` |
| Boundaries | `cargo fallow boundaries --format json --quiet` |
| File and function size | `cargo fallow size --format json --quiet` |
| Complexity | `cargo fallow complexity --format json --quiet` |
| Duplicated code | `cargo fallow dupes --format json --quiet` |
| Public API changes | `cargo fallow api --base main --format json --quiet` |
| File growth on a branch | `cargo fallow check --base main --fail-on-issues --format json --quiet` |
| Explain a rule | `cargo fallow explain <rule> --format json` |
| Preview the fixes | `cargo fallow fix --dry-run --format json --quiet` |
| Apply the fixes | `cargo fallow fix --yes --format json --quiet` |
| Preview a starting configuration | `cargo fallow init --format json --quiet` |
| Save a baseline | `cargo fallow check --save-baseline fallow-baseline.json --format json --quiet` |
| Mutation testing of a change | `cargo fallow mutants --in-diff main --format json --quiet` |
| Gate status | `cargo fallow hooks status --format json` |
| The JSON Schema | `cargo fallow schema` |

## The commit gate

`cargo fallow hooks install --target agent` installs a gate for Claude Code
and Codex. Install it only when the user asks, and run it with `--dry-run`
first: it writes `.claude/` and `.codex/` files. Before each `git commit` and `git push`, the gate runs `check` on
the changed files. It blocks only on a new finding: a finding that the base
commit already has does not block. An error of the tool does not block.

When the gate blocks a command:

1. Read the lines of the block message. Each line names a finding:
   `<check>/<rule> <path>:<line> <message>`.
2. Read the full report at the path that the message names, usually
   `.fallow/cargo-gate-report.json`.
3. Fix each finding in the code that you changed. Use
   `cargo fallow explain <rule>` and the `actions` of the finding.
4. For a fixable finding, run
   `cargo fallow fix --dry-run --format json --quiet`, and apply the edits
   as agent rule 6 says.
5. Run the commit or the push again.

Do not skip the gate with `--no-verify`, and do not remove the gate, unless
the user tells you to.

## Baselines and suppressions

- `cargo fallow init --write` adds the configuration tables to the root
  `Cargo.toml` and writes a baseline. Run it only when the user asks.
- `--save-baseline <PATH>` writes the ids of the current findings.
  `--baseline <PATH>` leaves them out. The `baseline` key of
  `[workspace.metadata.fallow]` applies the file on each run.
- `// fallow-ignore-next-line <kind>` hides the findings of the next line.
  `// fallow-ignore-file <kind>` in the first ten lines hides the findings of
  the file. In a `Cargo.toml`, the markers start with `#`, for example
  `# fallow-ignore-next-line unused-dependency`. A kind is a check, a rule or
  an alias. A marker that hides no finding gives a `stale-suppression`
  warning. Add a suppression only when the user agrees, and give the reason
  in the comment.
