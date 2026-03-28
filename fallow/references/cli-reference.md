# Fallow CLI Reference

Complete command and flag specifications for all fallow CLI commands.

---

## Table of Contents

- [`dead-code`: Dead Code Analysis](#dead-code-dead-code-analysis)
- [`dupes`: Duplication Detection](#dupes-duplication-detection)
- [`fix`: Auto-Remove Unused Code](#fix-auto-remove-unused-code)
- [`list`: Project Introspection](#list-project-introspection)
- [`init`: Config Generation](#init-config-generation)
- [`migrate`: Config Migration](#migrate-config-migration)
- [`health`: Function Complexity Analysis](#health-function-complexity-analysis)
- [`schema`: CLI Introspection](#schema-cli-introspection)
- [`config-schema`: Config JSON Schema](#config-schema-config-json-schema)
- [`plugin-schema`: Plugin JSON Schema](#plugin-schema-plugin-json-schema)
- [Global Flags](#global-flags)
- [Environment Variables](#environment-variables)
- [Output Formats](#output-formats)
- [JSON Output Structure](#json-output-structure)
- [Configuration File Format](#configuration-file-format)
- [Inline Suppression Comments](#inline-suppression-comments)

---

## `dead-code`: Dead Code Analysis

Analyzes the project for unused files, exports, dependencies, types, members, and more. Running `fallow` with no subcommand runs all analyses (dead code + duplication + complexity). Use `fallow dead-code` for dead code only.

### Flags

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--format` | `human\|json\|sarif\|compact\|markdown\|codeclimate` | `human` | Output format |
| `--quiet` | bool | `false` | Suppress progress bars and timing on stderr |
| `--changed-since` | string | — | Only analyze files changed since a git ref (e.g., `main`, `HEAD~3`) |
| `--production` | bool | `false` | Exclude test/dev files, only start/build scripts |
| `--baseline` | path | — | Compare against a saved baseline |
| `--save-baseline` | path | — | Save current results as a baseline |
| `--workspace` | string | — | Scope to a single workspace package |
| `--include-dupes` | bool | `false` | Cross-reference with duplication findings |
| `--trace` | `FILE:EXPORT` | — | Trace export usage chain |
| `--trace-file` | path | — | Show all edges for a file |
| `--trace-dependency` | string | — | Trace where a dependency is used |

### Issue Type Filters

| Flag | Issue Type |
|------|------------|
| `--unused-files` | Unused files |
| `--unused-exports` | Unused exports |
| `--unused-types` | Unused types |
| `--unused-deps` | Unused dependencies, devDependencies, optionalDependencies, type-only production deps, and test-only production deps |
| `--unused-enum-members` | Unused enum members |
| `--unused-class-members` | Unused class members |
| `--unresolved-imports` | Unresolved imports |
| `--unlisted-deps` | Unlisted dependencies |
| `--duplicate-exports` | Duplicate exports |
| `--circular-deps` | Circular dependencies |

### Examples

```bash
# Full analysis with JSON output
fallow dead-code --format json --quiet

# Only unused exports
fallow dead-code --format json --quiet --unused-exports

# PR check: only changed files
fallow dead-code --format json --quiet --changed-since main --fail-on-issues

# CI mode with SARIF upload
fallow dead-code --ci

# Production-only analysis
fallow dead-code --format json --quiet --production

# Single workspace package
fallow dead-code --format json --quiet --workspace my-package

# Debug: trace an export
fallow dead-code --format json --quiet --trace src/utils.ts:myFunction

# Incremental adoption with baseline
fallow dead-code --format json --quiet --save-baseline .fallow-baseline.json
fallow dead-code --format json --quiet --baseline .fallow-baseline.json --fail-on-issues

# Regression detection: save baseline on main, compare on PRs
fallow dead-code --format json --quiet --save-regression-baseline
fallow dead-code --format json --quiet --fail-on-regression --tolerance 2%
```

---

## `dupes`: Duplication Detection

Finds code duplication and clones across the project.

### Flags

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--format` | `human\|json\|sarif\|compact\|markdown\|codeclimate` | `human` | Output format |
| `--quiet` | bool | `false` | Suppress progress bars |
| `--top` | number | — | Show only the N largest clone groups (sorted by line count descending). Summary stats reflect the full project. |
| `--mode` | `strict\|mild\|weak\|semantic` | `mild` | Detection mode |
| `--min-tokens` | number | `50` | Minimum token count for a clone |
| `--min-lines` | number | `5` | Minimum line count for a clone |
| `--threshold` | number | `0` | Fail if duplication exceeds this percentage |
| `--skip-local` | bool | `false` | Only report cross-directory duplicates |
| `--cross-language` | bool | `false` | Strip type annotations for TS↔JS matching |
| `--trace` | `FILE:LINE` | — | Trace all clones at a specific location |
| `--changed-since` | string | — | Only report duplication in files changed since a git ref |
| `--baseline` | path | — | Compare against baseline |
| `--save-baseline` | path | — | Save results as baseline |
| `--workspace` | string | — | Scope to a single workspace package |

### Detection Modes

| Mode | Behavior |
|------|----------|
| `strict` | Exact token match (no normalization) |
| `mild` | Syntax normalized (whitespace, semicolons) |
| `weak` | Different literal values treated as equivalent |
| `semantic` | Renamed variables also treated as equivalent |

### Examples

```bash
# Default duplication scan
fallow dupes --format json --quiet

# Semantic mode (detects renames)
fallow dupes --format json --quiet --mode semantic

# Cross-directory only, fail at 5%
fallow dupes --format json --quiet --skip-local --threshold 5

# Trace clones at a specific location
fallow dupes --format json --quiet --trace src/utils.ts:42

# Only check duplication in changed files
fallow dupes --format json --quiet --changed-since main

# Incremental CI
fallow dupes --format json --quiet --save-baseline .fallow-dupes-baseline.json
fallow dupes --format json --quiet --baseline .fallow-dupes-baseline.json --threshold 5
```

---

## `fix`: Auto-Remove Unused Code

Auto-removes unused exports and dependencies.

### Flags

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--dry-run` | bool | `false` | Show what would be removed without modifying files |
| `--yes` | bool | `false` | Skip confirmation prompt (**required** in non-TTY) |
| `--force` | bool | `false` | Alias for `--yes` |
| `--format` | `human\|json` | `human` | Output format |
| `--quiet` | bool | `false` | Suppress progress bars |

### Examples

```bash
# Preview changes
fallow fix --dry-run --format json --quiet

# Apply changes (--yes required in agent/CI environments)
fallow fix --yes --format json --quiet
```

---

## `list`: Project Introspection

Inspect discovered files, entry points, and detected frameworks.

### Flags

| Flag | Type | Description |
|------|------|-------------|
| `--files` | bool | List all discovered files |
| `--entry-points` | bool | List detected entry points |
| `--plugins` | bool | List active framework plugins |
| `--format` | `human\|json` | Output format |
| `--quiet` | bool | Suppress progress bars |

### Examples

```bash
fallow list --files --format json --quiet
fallow list --entry-points --format json --quiet
fallow list --plugins --format json --quiet
```

---

## `init`: Config Generation

Creates a config file in the project root.

### Flags

| Flag | Type | Description |
|------|------|-------------|
| `--toml` | bool | Create `fallow.toml` instead of `.fallowrc.json` |

### Examples

```bash
fallow init          # creates .fallowrc.json with $schema
fallow init --toml   # creates fallow.toml
```

---

## `migrate`: Config Migration

Migrates configuration from knip and/or jscpd to fallow. Auto-detects config files.

### Flags

| Flag | Type | Description |
|------|------|-------------|
| `--toml` | bool | Output as TOML instead of JSON |
| `--dry-run` | bool | Preview without writing |
| `--from` | path | Specify source config file path |

### Detected Source Configs

- `knip.json`, `knip.jsonc`, `.knip.json`, `.knip.jsonc`
- `package.json` embedded `knip` field
- `.jscpd.json`
- `package.json` embedded `jscpd` field

### Examples

```bash
fallow migrate --dry-run    # preview
fallow migrate              # auto-detect and write .fallowrc.json
fallow migrate --toml       # output as TOML
fallow migrate --from knip.json
```

---

## `health`: Function Complexity & File Health Analysis

Analyzes function complexity across the project using cyclomatic and cognitive complexity metrics. By default all sections are included (health score, complexity findings, file scores, hotspots, and refactoring targets). Use `--complexity`, `--file-scores`, `--hotspots`, `--targets`, or `--score` to show only specific sections.

### Flags

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--format` | `human\|json\|sarif\|compact\|markdown\|codeclimate` | `human` | Output format |
| `--quiet` | bool | `false` | Suppress progress bars |
| `--max-cyclomatic` | number | `20` | Fail if any function exceeds this cyclomatic complexity |
| `--max-cognitive` | number | `15` | Fail if any function exceeds this cognitive complexity |
| `--top` | number | — | Only show the top N most complex functions (and file scores/hotspots/targets) |
| `--sort` | `cyclomatic\|cognitive\|lines` | `cyclomatic` | Sort order for complexity findings |
| `--complexity` | bool | `false` | Show only function complexity findings. When no section flags are set, all sections are shown by default. |
| `--file-scores` | bool | `false` | Show only per-file maintainability index (fan-in, fan-out, dead code ratio, complexity density). Runs the full analysis pipeline. When no section flags are set, all sections are shown by default. |
| `--hotspots` | bool | `false` | Show only hotspots: files that are both complex and frequently changing. Combines git churn history with complexity data. Requires a git repository. When no section flags are set, all sections are shown by default. |
| `--targets` | bool | `false` | Show only refactoring targets: ranked recommendations based on complexity, coupling, churn, and dead code signals. Categories: churn+complexity, circular dep, high impact, dead code, complexity, coupling. When no section flags are set, all sections are shown by default. |
| `--score` | bool | `false` | Show only the project health score (0-100) with letter grade (A/B/C/D/F). The score is included by default when no section flags are set. JSON includes `health_score` object with `score`, `grade`, and `penalties` breakdown. |
| `--min-score` | number | — | Fail if health score is below this threshold (exit code 1). Implies `--score`. CI quality gate. |
| `--since` | string | `6m` | Git history window for hotspot analysis. Accepts durations (`6m`, `90d`, `1y`, `2w`) or ISO dates (`2025-06-01`). |
| `--min-commits` | number | `3` | Minimum number of commits for a file to be included in hotspot ranking. |
| `--changed-since` | string | — | Only analyze files changed since a git ref |
| `--workspace` | string | — | Scope to a single workspace package |
| `--baseline` | path | — | Compare against a saved baseline |
| `--save-baseline` | path | — | Save current results as a baseline |
| `--save-snapshot` | path (optional) | `.fallow/snapshots/<timestamp>.json` | Save vital signs snapshot for trend tracking. Forces file-scores + hotspot computation. |

### Exit Codes

| Code | Meaning |
|------|---------|
| 0 | No functions exceed thresholds (and score above `--min-score` if set) |
| 1 | Functions exceed thresholds, or score below `--min-score` |

### Examples

```bash
# Full complexity analysis with JSON output
fallow health --format json --quiet

# Project health score with letter grade
fallow health --format json --quiet --score

# CI gate: fail if score below 70
fallow health --format json --quiet --min-score 70

# Top 10 most complex functions
fallow health --format json --quiet --top 10

# Sort by cognitive complexity
fallow health --format json --quiet --sort cognitive

# Custom thresholds
fallow health --format json --quiet --max-cyclomatic 15 --max-cognitive 10

# Per-file maintainability index
fallow health --format json --quiet --file-scores

# Worst 20 files by maintainability
fallow health --format json --quiet --file-scores --top 20

# Only analyze files changed since main
fallow health --format json --quiet --changed-since main

# Single workspace package
fallow health --format json --quiet --workspace my-package

# Incremental adoption with baseline
fallow health --format json --quiet --save-baseline .fallow-health-baseline.json
fallow health --format json --quiet --baseline .fallow-health-baseline.json

# CI: fail if any function is too complex
fallow health --max-cyclomatic 25 --max-cognitive 20 --quiet

# Hotspot analysis (complex + frequently changing files)
fallow health --format json --quiet --hotspots

# Hotspots from the last year
fallow health --format json --quiet --hotspots --since 1y

# Hotspots with at least 5 commits
fallow health --format json --quiet --hotspots --min-commits 5

# Top 10 hotspots from the last 90 days
fallow health --format json --quiet --hotspots --since 90d --top 10

# Ranked refactoring recommendations
fallow health --format json --quiet --targets

# Top 5 refactoring targets
fallow health --format json --quiet --targets --top 5

# Save a vital signs snapshot for trend tracking
fallow health --format json --quiet --save-snapshot

# Save snapshot to a custom path
fallow health --format json --quiet --save-snapshot .fallow/baseline-snapshot.json
```

### JSON Output Structure

```json
{
  "schema_version": 3,
  "version": "2.5.2",
  "elapsed_ms": 32,
  "summary": {
    "files_analyzed": 482,
    "functions_analyzed": 3200,
    "functions_above_threshold": 3,
    "max_cyclomatic_threshold": 20,
    "max_cognitive_threshold": 15
  },
  "findings": [
    {
      "path": "src/parser.ts",
      "name": "parseExpression",
      "line": 42,
      "col": 0,
      "cyclomatic": 28,
      "cognitive": 22,
      "line_count": 95,
      "exceeded": "both"
    }
  ]
}
```

With `--file-scores`, the JSON output also includes `file_scores` array and `summary.files_scored` / `summary.average_maintainability`:

```json
{
  "summary": {
    "files_scored": 482,
    "average_maintainability": 88.5
  },
  "file_scores": [
    {
      "path": "src/parser.ts",
      "fan_in": 8,
      "fan_out": 4,
      "dead_code_ratio": 0.25,
      "complexity_density": 0.22,
      "maintainability_index": 75.1,
      "total_cyclomatic": 42,
      "total_cognitive": 35,
      "function_count": 12,
      "lines": 190
    }
  ]
}
```

Maintainability index formula: `100 - (complexity_density × 30) - (dead_code_ratio × 20) - min(ln(fan_out+1) × 4, 15)`, clamped to 0–100. Higher is better. Type-only exports are excluded from dead_code_ratio. Zero-function files (barrels) are excluded by default.

With `--hotspots`, the JSON output includes a `hotspots` array and `hotspot_summary`:

```json
{
  "hotspot_summary": {
    "since": "6m",
    "min_commits": 3,
    "files_analyzed": 482,
    "files_excluded": 312,
    "shallow_clone": false
  },
  "hotspots": [
    {
      "path": "src/parser.ts",
      "score": 92,
      "commits": 28,
      "weighted_commits": 34.5,
      "lines_added": 410,
      "lines_deleted": 180,
      "complexity_density": 0.22,
      "fan_in": 8,
      "trend": "Accelerating"
    }
  ]
}
```

Hotspot score formula: `normalized_churn × normalized_complexity × 100`, scaled 0–100. Higher means more urgent to refactor. The `trend` field indicates recent change velocity: `Accelerating` (increasing churn), `Stable` (constant), or `Cooling` (decreasing). Files below `--min-commits` are excluded. The `shallow_clone` field warns when git history is truncated (shallow clone), which may undercount commits.

With `--targets`, the JSON output includes a `targets` array with ranked refactoring recommendations:

```json
{
  "targets": [
    {
      "path": "src/parser.ts",
      "priority": 82.5,
      "efficiency": 27.5,
      "recommendation": "Split high-impact file — 25 dependents amplify every change",
      "category": "split_high_impact",
      "effort": "high",
      "confidence": "medium",
      "factors": [
        {
          "metric": "complexity_density",
          "value": 0.75,
          "threshold": 0.3,
          "detail": "density 0.75 exceeds 0.3"
        },
        {
          "metric": "fan_in",
          "value": 25.0,
          "threshold": 10.0,
          "detail": "25 files depend on this"
        }
      ]
    }
  ],
  "target_thresholds": {
    "fan_in_p95": 12.0,
    "fan_in_p75": 5.0,
    "fan_out_p95": 15.0,
    "fan_out_p90": 8
  }
}
```

Targets are sorted by `efficiency` (priority / effort_numeric) descending, surfacing quick wins first. The `target_thresholds` object exposes the adaptive percentile-based thresholds used for scoring. Priority formula: `min(complexity_density, 1) × 30 + hotspot_boost × 25 + dead_code_ratio × 20 + fan_in_norm × 15 + fan_out_norm × 10`, clamped to 0–100. Fan-in and fan-out normalization uses the project's p95 values (with floors). Categories: `urgent_churn_complexity`, `break_circular_dependency`, `split_high_impact`, `remove_dead_code`, `extract_complex_functions`, `extract_dependencies`. Each target includes `efficiency`, `effort` (low/medium/high), `confidence` (high/medium/low — data source reliability), and contributing `factors`.

### Vital Signs

All `health` JSON output includes a `vital_signs` object with project-wide metrics:

```json
{
  "vital_signs": {
    "dead_file_pct": 3.2,
    "dead_export_pct": 8.1,
    "avg_cyclomatic": 4.5,
    "p90_cyclomatic": 12,
    "maintainability_avg": 88.5,
    "hotspot_count": 7,
    "circular_dep_count": 2,
    "unused_dep_count": 3
  }
}
```

Fields are `null` when the corresponding data source is not available (e.g., `hotspot_count` is null without `--hotspots` or when git is not available).

With `--score`, the JSON output includes a `health_score` object:

```json
{
  "health_score": {
    "score": 76.9,
    "grade": "B",
    "penalties": {
      "dead_files": 3.1,
      "dead_exports": 6.0,
      "complexity": 0.0,
      "p90_complexity": 0.0,
      "maintainability": 0.0,
      "hotspots": 0.0,
      "unused_deps": 10.0,
      "circular_deps": 4.0
    }
  }
}
```

Score is reproducible: `100 - sum(penalties) == score`. Penalty fields are absent when the pipeline didn't run. Grades: A (>= 85), B (70-84), C (55-69), D (40-54), F (< 40).

### Vital Signs Snapshots

`--save-snapshot` persists a `VitalSignsSnapshot` JSON file for trend tracking across runs. Snapshots automatically include the health score and grade. The snapshot contains more detail than the inline `vital_signs` object:

```json
{
  "schema_version": 1,
  "timestamp": "2025-12-01T10:30:00Z",
  "vital_signs": {
    "dead_file_pct": 3.2,
    "dead_export_pct": 8.1,
    "avg_cyclomatic": 4.5,
    "p90_cyclomatic": 12,
    "maintainability_avg": 88.5,
    "hotspot_count": 7,
    "circular_dep_count": 2,
    "unused_dep_count": 3
  },
  "counts": {
    "total_files": 482,
    "dead_files": 15,
    "total_exports": 1200,
    "dead_exports": 97,
    "total_dependencies": 42,
    "unused_dependencies": 3
  },
  "git_sha": "abc1234",
  "git_branch": "main",
  "shallow_clone": false
}
```

The snapshot `schema_version` is independent of the report `schema_version`. Default path: `.fallow/snapshots/<timestamp>.json`. The `--save-snapshot` flag forces file-scores and hotspot computation to populate all vital signs fields.

---

## `schema`: CLI Introspection

Dumps the full CLI interface definition as machine-readable JSON.

```bash
fallow schema
```

---

## `config-schema`: Config JSON Schema

Prints the JSON Schema for fallow configuration files.

```bash
fallow config-schema > schema.json
```

---

## `plugin-schema`: Plugin JSON Schema

Prints the JSON Schema for external plugin definition files.

```bash
fallow plugin-schema > plugin-schema.json
```

---

## Global Flags

Available on all commands:

| Flag | Type | Description |
|------|------|-------------|
| `-r, --root` | path | Project root directory |
| `-c, --config` | path | Config file path |
| `-f, --format` (alias: `--output`) | string | Output format |
| `-q, --quiet` | bool | Suppress progress output |
| `--no-cache` | bool | Disable incremental caching |
| `--threads` | number | Number of parser threads |
| `--changed-since` | string | Git-aware incremental analysis |
| `--baseline` | path | Compare to baseline |
| `--save-baseline` | path | Save results as baseline |
| `--fail-on-regression` | bool | Fail if issue count increased beyond tolerance vs a regression baseline |
| `--tolerance` | string | Allowed increase: `"2%"` (percentage) or `"5"` (absolute). Default: `"0"` |
| `--regression-baseline` | path | Path to regression baseline file (default: `.fallow/regression-baseline.json`) |
| `--save-regression-baseline` | path | Save current issue counts as a regression baseline |
| `--production` | bool | Exclude test/dev files, only start/build scripts |
| `--performance` | bool | Show pipeline timing breakdown |
| `-w, --workspace` | string | Scope to single workspace package |
| `--explain` | bool | Include metric definitions in JSON output (`_meta` object). Always on for MCP |
| `--only` | string | Run only specific analyses (e.g., `--only dead-code,dupes`). Values: `dead-code` (alias: `check`), `dupes`, `health` |
| `--skip` | string | Skip specific analyses (e.g., `--skip health`). Values: `dead-code` (alias: `check`), `dupes`, `health` |
| `--ci` | bool | CI mode: `--format sarif --fail-on-issues --quiet` |
| `--fail-on-issues` | bool | Exit 1 if any issues found (promotes `warn` to `error`) |
| `--sarif-file` | path | Write SARIF output to a file instead of stdout |

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `FALLOW_FORMAT` | Default output format. CLI `--format` overrides. |
| `FALLOW_QUIET` | Set to `1` to suppress progress. CLI `--quiet` overrides. |
| `FALLOW_BIN` | Path to fallow binary (used by the MCP server). |
| `FALLOW_COMMAND` | GitLab CI: command to run (default: `dead-code`). |
| `FALLOW_FAIL_ON_ISSUES` | GitLab CI: set to `true` to exit 1 if issues found. |
| `FALLOW_CHANGED_SINCE` | GitLab CI: git ref for incremental analysis. Auto-detected in MR pipelines. |
| `FALLOW_COMMENT` | GitLab CI: set to `true` to post MR summary comments. |
| `FALLOW_REVIEW` | GitLab CI: set to `true` to post inline code review comments on MR diffs. |
| `FALLOW_EXTRA_ARGS` | GitLab CI: additional CLI flags passed through to fallow. |
| `GITLAB_TOKEN` | GitLab CI: project access token with `api` scope (for MR comments/reviews). |

Set `FALLOW_FORMAT=json` and `FALLOW_QUIET=1` in your agent environment to avoid passing flags on every invocation.

---

## Output Formats

| Format | Description | Use Case |
|--------|-------------|----------|
| `human` | Colored terminal output | Interactive use |
| `json` | Machine-readable JSON | Agent integration, CI pipelines |
| `sarif` | Static Analysis Results Interchange Format | GitHub Code Scanning, SARIF-compatible tools |
| `compact` | Grep-friendly: `type:path:line:name` per line | Quick filtering |
| `markdown` | Markdown tables | Documentation, PR comments |
| `codeclimate` | CodeClimate JSON array | GitLab Code Quality, CodeClimate-compatible tools |

---

## CI Integration

- **GitHub Actions**: `uses: fallow-rs/fallow@v1` — supports SARIF upload to Code Scanning, inline PR annotations (`annotations: true`), PR comments, all commands. Annotations use workflow commands (no Advanced Security required); limit with `max-annotations` (default 50)
- **GitLab CI**: include `ci/gitlab-ci.yml` template and extend `.fallow` — generates Code Quality reports via `--format codeclimate` (inline MR annotations), rich MR comments, code review comments, all commands. Variables use `FALLOW_` prefix (e.g., `FALLOW_COMMAND`, `FALLOW_FAIL_ON_ISSUES`)
- **Any CI**: `npx fallow --ci` — equivalent to `--format sarif --fail-on-issues --quiet`

### GitLab CI Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `FALLOW_COMMAND` | `dead-code` | Command to run (`dead-code`, `dupes`, `health`, or default combined) |
| `FALLOW_FAIL_ON_ISSUES` | `false` | Exit 1 if issues found |
| `FALLOW_CHANGED_SINCE` | auto | Git ref for incremental analysis. Auto-detected in MR pipelines (`origin/$CI_MERGE_REQUEST_TARGET_BRANCH_NAME`) |
| `FALLOW_COMMENT` | `false` | Post a summary comment on the MR with findings |
| `FALLOW_REVIEW` | `false` | Post inline code review comments on MR diff lines where issues were found |
| `FALLOW_EXTRA_ARGS` | — | Additional CLI flags passed through to fallow |
| `GITLAB_TOKEN` | — | Project access token with `api` scope (required for `FALLOW_COMMENT` and `FALLOW_REVIEW`). Alternatively, enable job token API access |

**Package manager detection**: The GitLab template auto-detects the project's package manager (npm, pnpm, or yarn) from lockfiles. MR comments and review comments show the correct install/run commands for the detected manager (e.g., `pnpm add -D` vs `npm install --save-dev`).

**Auto `--changed-since` in MR pipelines**: When running in a merge request pipeline, the template automatically sets `--changed-since origin/$CI_MERGE_REQUEST_TARGET_BRANCH_NAME` unless `FALLOW_CHANGED_SINCE` is explicitly set. This scopes analysis to files changed in the MR without manual configuration.

---

## JSON Output Structure

### `dead-code` output

```json
{
  "schema_version": 3,
  "version": "2.5.2",
  "elapsed_ms": 45,
  "total_issues": 12,
  "unused_files": [{ "path": "src/old.ts" }],
  "unused_exports": [{ "path": "src/utils.ts", "name": "unusedFn", "line": 42 }],
  "unused_types": [{ "path": "src/types.ts", "name": "OldType", "line": 10 }],
  "unused_dependencies": [{ "name": "lodash", "line": 5 }],
  "unused_dev_dependencies": [{ "name": "jest", "line": 8 }],
  "unused_enum_members": [{ "path": "src/enums.ts", "enum_name": "Status", "member": "Archived", "line": 5 }],
  "unused_class_members": [{ "path": "src/service.ts", "class_name": "Service", "member": "oldMethod", "line": 20 }],
  "unresolved_imports": [{ "path": "src/index.ts", "specifier": "./missing", "line": 3 }],
  "unlisted_dependencies": [{ "name": "chalk", "imported_from": [{ "path": "src/cli.ts", "line": 1, "col": 0 }] }],
  "duplicate_exports": [{ "name": "Config", "locations": ["src/config.ts:5", "src/types.ts:12"] }],
  "circular_dependencies": [{ "cycle": ["src/a.ts", "src/b.ts", "src/a.ts"], "line": 3, "col": 0 }],
  "unused_optional_dependencies": [{ "name": "fsevents" }],
  "type_only_dependencies": [{ "name": "zod", "used_in": ["src/schema.ts"], "line": 12 }],
  "test_only_dependencies": [{ "name": "msw", "path": "package.json", "line": 15 }]
}
```

### `dupes` output

```json
{
  "schema_version": 3,
  "version": "2.5.2",
  "elapsed_ms": 82,
  "total_clones": 15,
  "total_lines_duplicated": 230,
  "duplication_percentage": 4.2,
  "clone_groups": [
    {
      "instances": [
        { "path": "src/a.ts", "start_line": 10, "end_line": 25 },
        { "path": "src/b.ts", "start_line": 40, "end_line": 55 }
      ],
      "tokens": 120,
      "lines": 16,
      "family": { "suggestion": "extract_function", "shared_files": ["src/a.ts", "src/b.ts"] }
    }
  ]
}
```

### `fix` output (dry-run)

```json
{
  "changes": [
    { "path": "src/utils.ts", "action": "remove_export", "name": "unusedFn", "line": 42 },
    { "path": "package.json", "action": "remove_dependency", "name": "lodash" }
  ],
  "total_changes": 2
}
```

### Combined output (`fallow` with no subcommand)

When running `fallow` with no subcommand (all analyses), the JSON output combines results from all enabled analyses:

```json
{
  "check": {
    "schema_version": 3,
    "version": "2.5.2",
    "elapsed_ms": 45,
    "total_issues": 12,
    "unused_files": [],
    "unused_exports": [],
    "unused_types": [],
    "unused_dependencies": [],
    "unused_dev_dependencies": [],
    "unused_enum_members": [],
    "unused_class_members": [],
    "unresolved_imports": [],
    "unlisted_dependencies": [],
    "duplicate_exports": [],
    "circular_dependencies": [],
    "unused_optional_dependencies": [],
    "type_only_dependencies": [],
    "test_only_dependencies": []
  },
  "dupes": {
    "schema_version": 3,
    "version": "2.5.2",
    "elapsed_ms": 82,
    "total_clones": 15,
    "total_lines_duplicated": 230,
    "duplication_percentage": 4.2,
    "clone_groups": []
  },
  "health": {
    "schema_version": 3,
    "version": "2.5.2",
    "elapsed_ms": 32,
    "summary": {},
    "findings": [],
    "vital_signs": {}
  }
}
```

Use `--only` or `--skip` to control which analyses are included in the combined output.

### Error output (exit code 2)

```json
{"error": true, "message": "invalid config: unknown field 'detect'", "exit_code": 2}
```

---

## Configuration File Format

Config files are searched in priority order: `.fallowrc.json` > `fallow.toml` > `.fallow.toml`

### JSON Format (`.fallowrc.json`)

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/fallow-rs/fallow/main/schema.json",

  // Entry points (glob patterns)
  "entry": ["src/index.ts", "scripts/*.ts"],

  // Files to ignore (glob patterns)
  "ignorePatterns": ["**/*.generated.ts", "**/*.d.ts"],

  // Dependencies to ignore
  "ignoreDependencies": ["autoprefixer"],

  // Per-issue-type severity
  "rules": {
    "unused-files": "error",
    "unused-exports": "warn",
    "unused-types": "off",
    "unused-dependencies": "error",
    "unused-dev-dependencies": "warn",
    "unused-enum-members": "error",
    "unused-class-members": "warn",
    "unresolved-imports": "error",
    "unlisted-dependencies": "error",
    "duplicate-exports": "warn",
    "circular-dependencies": "warn",
    "type-only-dependencies": "error",
    "test-only-dependencies": "warn"
  },

  // Per-path rule overrides
  "overrides": [
    {
      "files": ["*.test.ts", "*.spec.ts"],
      "rules": { "unused-exports": "off" }
    }
  ],

  // Duplication settings
  "duplicates": {
    "mode": "mild",
    "minTokens": 50,
    "minLines": 5,
    "threshold": 0,
    "skipLocal": false,
    "ignorePatterns": ["**/*.generated.ts"]
  },

  // Production mode
  "production": false,

  // Inherit from base config
  "extends": ["./base-config.json"],

  // Custom external plugins
  "plugins": ["tools/plugins/"],

  // Inline framework definitions
  "framework": [
    {
      "name": "my-framework",
      "enablers": ["my-framework"],
      "entryPoints": ["src/routes/**/*.ts"]
    }
  ]
}
```

### TOML Format (`fallow.toml`)

```toml
entry = ["src/index.ts", "scripts/*.ts"]
ignorePatterns = ["**/*.generated.ts"]
ignoreDependencies = ["autoprefixer"]
production = false

[rules]
unused-files = "error"
unused-exports = "warn"
unused-types = "off"

[duplicates]
mode = "mild"
minTokens = 50
minLines = 5

[[overrides]]
files = ["*.test.ts"]
[overrides.rules]
unused-exports = "off"
```

---

## Inline Suppression Comments

| Comment | Effect |
|---------|--------|
| `// fallow-ignore-next-line` | Suppress any issue on the next line |
| `// fallow-ignore-next-line unused-export` | Suppress specific issue type |
| `// fallow-ignore-file` | Suppress all issues in a file |
| `// fallow-ignore-file unused-export` | Suppress specific issue type file-wide |

### Valid Issue Type Tokens

`unused-file`, `unused-export`, `unused-type`, `unused-dependency`, `unused-dev-dependency`, `unused-enum-member`, `unused-class-member`, `unresolved-import`, `unlisted-dependency`, `duplicate-export`, `circular-dependency`, `unused-optional-dependency`, `type-only-dependency`, `test-only-dependency`, `code-duplication`
