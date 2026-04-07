# Fallow: Common Workflow Patterns & Recipes

Step-by-step workflows for common fallow usage scenarios.

---

## Table of Contents

- [Full Project Audit](#full-project-audit)
- [PR Dead Code Check](#pr-dead-code-check)
- [CI Pipeline Setup](#ci-pipeline-setup)
- [Incremental Adoption with Baselines](#incremental-adoption-with-baselines)
- [Monorepo Analysis](#monorepo-analysis)
- [Duplication Threshold CI Gate](#duplication-threshold-ci-gate)
- [Migration from knip](#migration-from-knip)
- [Migration from jscpd](#migration-from-jscpd)
- [Safe Auto-Fix Workflow](#safe-auto-fix-workflow)
- [Production vs Full Audit](#production-vs-full-audit)
- [Debugging False Positives](#debugging-false-positives)
- [Combined Dead Code + Duplication](#combined-dead-code--duplication)
- [Custom Plugin Setup](#custom-plugin-setup)
- [GitHub Code Scanning Integration](#github-code-scanning-integration)

---

## Full Project Audit

Complete codebase hygiene audit.

### Step 1: Run full analysis

```bash
fallow dead-code --format json --quiet
```

### Step 2: Review issue counts

Parse `total_issues` and individual arrays (`unused_files`, `unused_exports`, etc.) to understand the scope.

### Step 3: Find duplication

```bash
fallow dupes --format json --quiet
```

### Step 4: Preview auto-fix

```bash
fallow fix --dry-run --format json --quiet
```

### Step 5: Apply fixes (after user confirmation)

```bash
fallow fix --yes --format json --quiet
```

### Step 6: Verify

```bash
fallow dead-code --format json --quiet
```

---

## PR Dead Code Check

Check if a pull request introduces new dead code.

### Step 1: Analyze changed files

```bash
fallow dead-code --format json --quiet --changed-since main --fail-on-issues
```

Exit code 1 if the PR introduces new dead code. Exit code 0 if clean.

### Step 2: If issues found, show specifics

```bash
fallow dead-code --format json --quiet --changed-since main
```

Parse the JSON to list specific files and exports that became unused.

---

## CI Pipeline Setup

### GitHub Actions: Basic

```yaml
- name: Dead code check
  run: npx fallow dead-code --fail-on-issues --quiet
```

### GitHub Actions: With SARIF Upload

```yaml
- name: Fallow analysis
  run: npx fallow dead-code --ci > fallow.sarif
  continue-on-error: true  # --ci sets --fail-on-issues; continue to upload SARIF even if issues found

- name: Upload SARIF
  uses: github/codeql-action/upload-sarif@v3
  with:
    sarif_file: fallow.sarif
```

### GitHub Actions: Using the Official Action

```yaml
- uses: fallow-rs/fallow@v2
  with:
    command: dead-code
    fail-on-issues: true
    changed-since: main
```

### GitHub Actions: With Health Score

```yaml
- uses: fallow-rs/fallow@v2
  with:
    score: true
    changed-since: main
```

Computes a health score (0-100 with letter grade) in combined mode and enables the health delta header in PR comments.

### GitHub Actions: Inline PR Annotations (No Advanced Security)

The official action supports inline PR annotations via GitHub workflow commands. This does not require Advanced Security (unlike SARIF upload) and works on any GitHub plan.

```yaml
- uses: fallow-rs/fallow@v2
  with:
    command: dead-code
    changed-since: main
    annotations: true
    max-annotations: 50   # default: 50, limits annotation count
```

Annotations appear as inline warnings on the PR diff. They work with all commands (`dead-code`, `dupes`, `health`, and the default combined mode). The `max-annotations` input prevents annotation flooding on large projects.

### GitHub Actions: PR-Scoped Check

```yaml
- name: Check for new dead code
  run: npx fallow dead-code --format json --quiet --changed-since ${{ github.event.pull_request.base.sha }} --fail-on-issues
```

### GitHub Actions: Duplication Gate

```yaml
- name: Duplication check
  run: npx fallow dupes --format json --quiet --threshold 5 --mode mild
```

Fails if overall duplication exceeds 5%.

### GitHub Actions: PR-Scoped Duplication Check

```yaml
- name: Check duplication in changed files
  run: npx fallow dupes --format json --quiet --changed-since ${{ github.event.pull_request.base.sha }}
```

Only reports duplication in files modified by the PR.

### GitLab CI: Using the Official Template

```yaml
include:
  - remote: 'https://raw.githubusercontent.com/fallow-rs/fallow/main/ci/gitlab-ci.yml'

fallow:
  extends: .fallow
  variables:
    FALLOW_COMMAND: "dead-code"
    FALLOW_FAIL_ON_ISSUES: "true"
```

Generates Code Quality reports (inline MR annotations) automatically. In MR pipelines, `--changed-since` is automatically set to the target branch — no manual configuration needed.

### GitLab CI: With MR Summary Comments

```yaml
include:
  - remote: 'https://raw.githubusercontent.com/fallow-rs/fallow/main/ci/gitlab-ci.yml'

fallow:
  extends: .fallow
  variables:
    FALLOW_COMMENT: "true"
```

Posts a summary comment on the MR with issue counts and findings. In MR pipelines, `--changed-since` is auto-detected from `$CI_MERGE_REQUEST_TARGET_BRANCH_NAME`, so only issues from changed files are reported. Requires `GITLAB_TOKEN` CI/CD variable (project access token with `api` scope) or enabling job token API access.

### GitLab CI: With Inline Code Review Comments

```yaml
include:
  - remote: 'https://raw.githubusercontent.com/fallow-rs/fallow/main/ci/gitlab-ci.yml'

fallow:
  extends: .fallow
  variables:
    FALLOW_REVIEW: "true"
```

Posts inline review comments directly on the MR diff lines where issues were found. This gives developers precise feedback without leaving the code review flow. Can be combined with `FALLOW_COMMENT: "true"` for both a summary and inline comments. Requires `GITLAB_TOKEN`.

### GitLab CI: Combined MR Comments + Review

```yaml
include:
  - remote: 'https://raw.githubusercontent.com/fallow-rs/fallow/main/ci/gitlab-ci.yml'

fallow:
  extends: .fallow
  variables:
    FALLOW_COMMENT: "true"
    FALLOW_REVIEW: "true"
    FALLOW_FAIL_ON_ISSUES: "true"
```

Posts both a summary comment and inline review comments on the MR. The template auto-detects the package manager (npm/pnpm/yarn) from lockfiles, so review comments show the correct commands for the project (e.g., `pnpm remove` instead of `npm uninstall`).

### GitLab CI: With Health Score and Trend

```yaml
include:
  - remote: 'https://raw.githubusercontent.com/fallow-rs/fallow/main/ci/gitlab-ci.yml'

fallow:
  extends: .fallow
  variables:
    FALLOW_SCORE: "true"
    FALLOW_TREND: "true"
    FALLOW_COMMENT: "true"
```

Computes the health score and compares against saved snapshots. The MR comment includes a health delta header showing score changes. `FALLOW_TREND` implies `FALLOW_SCORE`.

### GitLab CI: Manual (Without Template)

```yaml
fallow:
  image: node:20-slim
  script:
    - npx fallow dead-code --fail-on-issues --quiet --format json > fallow-results.json
  artifacts:
    paths:
      - fallow-results.json
```

---

## Incremental Adoption with Baselines

For large projects with existing dead code. Adopt gradually without fixing everything at once.

### Step 1: Save current state as baseline

```bash
fallow dead-code --format json --quiet --save-baseline .fallow-baseline.json
```

### Step 2: Commit the baseline

```bash
git add .fallow-baseline.json
git commit -m "chore: add fallow baseline"
```

### Step 3: CI only fails on NEW issues

```bash
fallow dead-code --format json --quiet --baseline .fallow-baseline.json --fail-on-issues
```

### Step 4: Gradually fix and update baseline

As you fix existing issues, regenerate the baseline:

```bash
fallow dead-code --format json --quiet --save-baseline .fallow-baseline.json
```

### Duplication baseline

Same pattern works for duplication:

```bash
fallow dupes --format json --quiet --save-baseline .fallow-dupes-baseline.json
fallow dupes --format json --quiet --baseline .fallow-dupes-baseline.json --threshold 5
```

---

## Monorepo Analysis

### Analyze the full monorepo

```bash
fallow dead-code --format json --quiet
```

Fallow auto-detects workspaces from `package.json` workspaces or `pnpm-workspace.yaml`.

### Analyze a single package

```bash
fallow dead-code --format json --quiet --workspace my-package
```

Full cross-workspace graph is built (so imports between packages are resolved), but only issues in `my-package` are reported.

### Per-package CI

Run analysis for each workspace package separately:

```bash
fallow dead-code --format json --quiet --workspace package-a --fail-on-issues
fallow dead-code --format json --quiet --workspace package-b --fail-on-issues
```

### List all discovered files across workspaces

```bash
fallow list --files --format json --quiet
```

---

## Duplication Threshold CI Gate

Enforce a maximum duplication percentage.

### Step 1: Measure current duplication

```bash
fallow dupes --format json --quiet
```

Check `duplication_percentage` in the JSON output.

### Step 2: Set threshold slightly above current

If current duplication is 3.8%, set threshold to 5%:

```bash
fallow dupes --format json --quiet --threshold 5
```

Exits with code 1 if duplication exceeds 5%.

### Step 3: Tighten over time

As you reduce duplication, lower the threshold.

### Cross-directory only

To ignore duplication within the same directory (local helpers, similar test files):

```bash
fallow dupes --format json --quiet --threshold 5 --skip-local
```

---

## Migration from knip

### Step 1: Preview migration

```bash
fallow migrate --dry-run
```

Shows what config would be generated. Auto-detects `knip.json`, `.knip.json`, `knip.jsonc`, `.knip.jsonc`, or `package.json#knip`.

### Step 2: Apply migration

```bash
fallow migrate
```

Creates `.fallowrc.json` with mapped settings:
- knip `rules`/`exclude`/`include` → fallow `rules` (error/warn/off)
- knip `ignore` → fallow `ignorePatterns`
- knip `ignoreDependencies` → fallow `ignoreDependencies`
- Unmappable fields generate warnings with suggestions

### Step 3: Compare results

```bash
# Run fallow
fallow dead-code --format json --quiet

# Compare with knip output
npx knip --reporter json
```

### Step 4: Remove knip config

Once satisfied, remove the old `knip.json` and uninstall knip.

---

## Migration from jscpd

### Step 1: Preview migration

```bash
fallow migrate --dry-run
```

Auto-detects `.jscpd.json` or `package.json#jscpd`.

### Step 2: Apply migration

```bash
fallow migrate
```

Maps jscpd settings:
- `minTokens` → `duplicates.minTokens`
- `minLines` → `duplicates.minLines`
- `threshold` → `duplicates.threshold`
- `mode` → `duplicates.mode`

### Step 3: Compare results

```bash
fallow dupes --format json --quiet
```

### Detection mode mapping

| jscpd | fallow |
|-------|--------|
| Default (exact tokens) | `strict` |
| — | `mild` (fallow default, syntax normalized) |
| — | `weak` (literal normalization) |
| — | `semantic` (variable rename detection) |

---

## Safe Auto-Fix Workflow

### Step 1: Dry-run first

```bash
fallow fix --dry-run --format json --quiet
```

### Step 2: Review each proposed change

Parse the JSON `changes` array. Each entry shows:
- `path`: file to be modified
- `action`: what will happen (`remove_export`, `remove_dependency`)
- `name`: the symbol or dependency being removed
- `line`: the line number

### Step 3: Confirm with user before applying

Show the proposed changes. Wait for user confirmation.

### Step 4: Apply

```bash
fallow fix --yes --format json --quiet
```

### Step 5: Verify

```bash
fallow dead-code --format json --quiet
```

### Step 6: Run project tests

After auto-fix, always run the project's test suite to verify nothing broke.

---

## Production vs Full Audit

### Full audit (default)

```bash
fallow dead-code --format json --quiet
```

Includes all files, all scripts, all dependencies (including devDependencies).

### Production audit

```bash
fallow dead-code --format json --quiet --production
```

Differences:
- Excludes: `*.test.*`, `*.spec.*`, `*.stories.*`, `__tests__/**`, `__mocks__/**`
- Only analyzes: `start`, `build`, `serve`, `preview`, `prepare` scripts
- Skips: unused devDependency detection
- Adds: type-only production dependency detection

Use production mode for:
- Checking what ships to users
- Finding dependencies that should be devDependencies
- CI pipelines focused on production bundle

Use full mode for:
- Complete codebase hygiene
- Finding unused test utilities
- Auditing devDependency usage

---

## Debugging False Positives

### Trace an export's usage chain

```bash
fallow dead-code --format json --quiet --trace src/utils.ts:myFunction
```

Shows where `myFunction` is imported (or not imported) and why it's flagged.

### Trace all edges for a file

```bash
fallow dead-code --format json --quiet --trace-file src/utils.ts
```

Shows all imports/exports for the file and their resolution status.

### Trace a dependency

```bash
fallow dead-code --format json --quiet --trace-dependency lodash
```

Shows all files that import lodash.

### If the trace shows it IS used

The export might be consumed through a pattern fallow can't resolve (fully dynamic import, reflection). Add a suppression:

```typescript
// fallow-ignore-next-line unused-export
export const dynamicallyUsed = createHandler();
```

### If the trace shows it's NOT used

The export is genuinely unused. Consider removing it or marking it as intentionally kept:

```typescript
// fallow-ignore-next-line unused-export
export const publicApi = createWidget();  // Used by external consumers
```

---

## Combined Dead Code + Duplication

Cross-reference dead code with duplication findings to find high-priority cleanup targets.

### Step 1: Run combined analysis

```bash
fallow dead-code --format json --quiet --include-dupes
```

This adds duplication context to dead code findings, identifying clone instances that exist in unused files or overlap with unused exports.

### Step 2: Prioritize cleanup

Focus on findings that are BOTH dead code and duplicated:
- Unused files containing duplicate code → delete the file entirely
- Unused exports that are clones of other exports → remove the duplicate

---

## Custom Plugin Setup

For frameworks not covered by the 84 built-in plugins.

### Option 1: Inline framework config

```jsonc
// .fallowrc.json
{
  "framework": [
    {
      "name": "my-framework",
      "enablers": ["my-framework"],
      "entryPoints": ["src/routes/**/*.ts", "src/middleware/**/*.ts"]
    }
  ]
}
```

### Option 2: External plugin file

Create `.fallow/plugins/my-framework.jsonc`:

```jsonc
{
  "name": "my-framework",
  "detection": { "dependency": "my-framework" },
  "entryPoints": ["src/routes/**/*.ts"],
  "alwaysUsedFiles": ["src/bootstrap.ts"],
  "usedExports": {
    "src/config.ts": ["default"]
  },
  "toolingDependencies": ["my-framework-cli"]
}
```

### Option 3: Plugin directory

```jsonc
// .fallowrc.json
{
  "plugins": ["tools/plugins/"]
}
```

Place `.jsonc`, `.json`, or `.toml` plugin files in that directory.

---

## GitHub Code Scanning Integration

Upload fallow results to GitHub's Code Scanning dashboard.

### Step 1: Generate SARIF output

```bash
fallow dead-code --format sarif --quiet > fallow.sarif
```

### Step 2: Upload via GitHub Action

```yaml
- name: Upload SARIF
  uses: github/codeql-action/upload-sarif@v3
  with:
    sarif_file: fallow.sarif
```

### All-in-one with `--ci`

```bash
fallow dead-code --ci > fallow.sarif
```

The `--ci` flag is equivalent to `--format sarif --fail-on-issues --quiet`. Note: `--fail-on-issues` means exit code 1 if issues exist — in CI scripts, use `continue-on-error: true` or `|| true` to ensure the SARIF upload step still runs.
