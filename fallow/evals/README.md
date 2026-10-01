# Fallow plugin evals

This directory holds the activation and outcome eval suite for the Claude Code
plugin. `claude plugin eval` reads it. Codex has no equivalent runner, so
[codex-manual-checklist.md](codex-manual-checklist.md) has the same prompt
matrix as a manual checklist.

The `fallow-setup` skill comes from the fallow repository through the normal
skill sync. The setup cases fail until that skill is in `fallow/skills/`.

## Cases

| Group | Tag | Cases | Pass condition |
| --- | --- | --- | --- |
| Setup activation | `trigger`, `setup` | `setup-trigger-*` | Claude selects `fallow-setup`. |
| Routing | `trigger`, `routing` | `route-audit-pr`, `route-dead-code-architecture` | Claude selects `fallow-review` or `fallow`, and not `fallow-setup`. |
| Negative | `trigger`, `negative` | `negative-*` | Claude does not select `fallow-setup`. |
| Setup outcome | `outcome`, `setup` | `setup-typescript-project` | The setup run on the fixture meets every outcome grader. |

The setup outcome graders check these results:

- The reply names pnpm, and no Bash command uses npm, yarn or bun to install.
- `package.json` keeps `oxlint` and `oxfmt`. `.oxlintrc.json` and
  `.oxfmtrc.json` keep their settings.
- A Bash command runs `fallow recommend` before `fallow agent install`.
- The run creates a file under `.github/workflows/` that runs fallow.
- No Bash command installs Knip or dependency-cruiser, and `package.json` does
  not list them.

`fixtures/ts-app/` is the fixture for the outcome case. It is a small pnpm
TypeScript package with Oxlint and Oxfmt, an unused export and an unused file.
The scaffold script copies it into the run workspace and makes a first commit.

## Run the suite

Run the commands from the `fallow/` plugin directory.

Activation cases use read-only tools only. A small trial:

```bash
claude plugin eval . --tag trigger --runs 1 --no-publish
```

The outcome case needs Bash, Write and Edit, the scaffold script, and a
`fallow` binary on `PATH`. The eval sandbox blocks network access, so the run
cannot download fallow:

```bash
claude plugin eval . --tag outcome --runs 1 --scaffold \
  --allow-tools Bash Write Edit --no-publish
```

Results go to `evals/results/`, which git ignores.
