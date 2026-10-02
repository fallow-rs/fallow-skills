# Fallow plugin evals

This directory holds the activation and outcome eval suite for the Claude Code
plugin. `claude plugin eval` reads it. Codex has no equivalent runner, so
[codex-manual-checklist.md](codex-manual-checklist.md) has the same prompt
matrix as a manual checklist.

The `fallow-setup` skill comes from the fallow repository through the normal
skill sync. Run the suite with `--ablation none` (one arm, plugin on), or read
the per-arm results: a `tool_used` grader without `arm: both` scores only in
the plugin arm. Each negative case also has a `task-answered` grader, so a run
that does not load the plugin cannot pass by doing nothing.

## Cases

| Group | Tag | Cases | Pass condition |
| --- | --- | --- | --- |
| Setup activation | `trigger`, `setup` | `setup-trigger-*` | Claude selects `fallow-setup`. |
| Routing | `trigger`, `routing` | `route-review-pr`, `route-audit-pr`, `route-dead-code-architecture` | Claude selects `fallow-review` for a review, `fallow` for an audit or an analysis, and never `fallow-setup`. |
| Negative | `trigger`, `negative` | `negative-*` | Claude does not select `fallow-setup`. |
| Setup outcome | `outcome`, `setup` | `setup-typescript-project` | The setup run on the fixture meets every outcome grader. |

The setup outcome graders check these results:

- The reply names pnpm, and no Bash command uses npm, yarn or bun to install.
- `package.json` keeps `oxlint` and `oxfmt`. `.oxlintrc.json` and
  `.oxfmtrc.json` keep their settings.
- A Bash command runs `fallow recommend` before `fallow agent install`. A
  `fallow agent install --dry-run` call does not count as the install.
- The run creates a file under `.github/workflows/`, and a `Write` call puts a
  fallow command in a workflow file. A workflow that Claude writes through Bash
  does not pass this grader.
- No Bash command installs or runs Knip or dependency-cruiser, and
  `package.json` does not list them.

`fixtures/ts-app/` is the fixture for the outcome case. It is a small pnpm
TypeScript package with Oxlint and Oxfmt, an unused export and an unused file.
The scaffold script copies it into the run workspace and makes a first commit.

## Run the suite

Run the commands from the `fallow/` plugin directory.

Activation cases use read-only tools only. `route-audit-pr` builds a git
repository with a feature branch through its scaffold script, so pass
`--scaffold`. A small trial:

```bash
claude plugin eval . --tag trigger --runs 1 --scaffold --no-publish
```

The outcome case needs Bash, Write and Edit, the scaffold script, and a
`fallow` binary on `PATH`. The eval sandbox blocks network access, so the run
cannot download fallow:

```bash
claude plugin eval . --tag outcome --runs 1 --scaffold \
  --allow-tools Bash Write Edit --no-publish
```

Results go to `evals/results/`, which git ignores.
