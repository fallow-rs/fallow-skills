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
- [`audit`: Changed-File Quality Gate](#audit-changed-file-quality-gate)
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
| `--boundary-violations` | Boundary violations (imports crossing architecture zone boundaries) |

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

Inspect discovered files, entry points, detected frameworks, and architecture boundary zones.

### Flags

| Flag | Type | Description |
|------|------|-------------|
| `--files` | bool | List all discovered files |
| `--entry-points` | bool | List detected entry points |
| `--plugins` | bool | List active framework plugins |
| `--boundaries` | bool | Show architecture boundary zones, rules, and per-zone file counts |
| `--format` | `human\|json` | Output format |
| `--quiet` | bool | Suppress progress bars |

### Examples

```bash
fallow list --files --format json --quiet
fallow list --entry-points --format json --quiet
fallow list --plugins --format json --quiet
fallow list --boundaries --format json --quiet
```

---

## `init`: Config Generation

Creates a config file in the project root.

### Flags

| Flag | Type | Description |
|------|------|-------------|
| `--toml` | bool | Create `fallow.toml` instead of `.fallowrc.json` |
| `--hooks` | bool | Scaffold a pre-commit git hook that runs `fallow dead-code --changed-since` on staged files |
| `--branch` | string | Base branch for the pre-commit hook (default: auto-detected or `main`). Only used with `--hooks` |

### Examples

```bash
fallow init              # creates .fallowrc.json with $schema
fallow init --toml       # creates fallow.toml
fallow init --hooks      # scaffold a pre-commit git hook (auto-detects base branch)
fallow init --hooks --branch develop  # hook using custom base branch
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
| `--format` | `human\|json\|sarif\|compact\|markdown\|codeclimate\|badge` | `human` | Output format |
| `--quiet` | bool | `false` | Suppress progress bars |
| `--max-cyclomatic` | number | `20` | Fail if any function exceeds this cyclomatic complexity |
| `--max-cognitive` | number | `15` | Fail if any function exceeds this cognitive complexity |
| `--top` | number | — | Only show the top N most complex functions (and file scores/hotspots/targets) |
| `--sort` | `cyclomatic\|cognitive\|lines` | `cyclomatic` | Sort order for complexity findings |
| `--complexity` | bool | `false` | Show only function complexity findings. When no section flags are set, all sections are shown by default. |
| `--file-scores` | bool | `false` | Show only per-file maintainability index (fan-in, fan-out, dead code ratio, complexity density). Runs the full analysis pipeline. When no section flags are set, all sections are shown by default. |
| `--hotspots` | bool | `false` | Show only hotspots: files that are both complex and frequently changing. Combines git churn history with complexity data. Requires a git repository. When no section flags are set, all sections are shown by default. |
| `--targets` | bool | `false` | Show only refactoring targets: ranked recommendations based on complexity, coupling, churn, and dead code signals. Categories: churn+complexity, circular dep, high impact, dead code, complexity, coupling. When no section flags are set, all sections are shown by default. |
| `--effort` | `low\|medium\|high` | — | Filter refactoring targets by effort level. Implies `--targets`. |
| `--score` | bool | `false` | Show only the project health score (0-100) with letter grade (A/B/C/D/F). The score is included by default when no section flags are set. JSON includes `health_score` object with `score`, `grade`, and `penalties` breakdown. |
| `--min-score` | number | — | Fail if health score is below this threshold (exit code 1). Implies `--score`. CI quality gate. |
| `--since` | string | `6m` | Git history window for hotspot analysis. Accepts durations (`6m`, `90d`, `1y`, `2w`) or ISO dates (`2025-06-01`). |
| `--min-commits` | number | `3` | Minimum number of commits for a file to be included in hotspot ranking. |
| `--changed-since` | string | — | Only analyze files changed since a git ref |
| `--workspace` | string | — | Scope to a single workspace package |
| `--baseline` | path | — | Compare against a saved baseline |
| `--save-baseline` | path | — | Save current results as a baseline |
| `--save-snapshot` | path (optional) | `.fallow/snapshots/<timestamp>.json` | Save vital signs snapshot for trend tracking. Forces file-scores + hotspot computation. |
| `--trend` | bool | `false` | Compare current metrics against the most recent saved snapshot. Reads from `.fallow/snapshots/` and shows per-metric deltas with directional indicators (improving/declining/stable). Implies `--score`. |
| `--coverage-gaps` | bool | `false` | Show runtime files and exports that no test dependency path reaches. Opt-in (default off). Configure severity via the `coverage-gaps` rule (`error`/`warn`/`off`). |
| `--coverage` | path | none | Path to Istanbul-format coverage data (`coverage-final.json`) for accurate per-function CRAP scores. Uses `CC^2 * (1-cov/100)^3 + CC` instead of static binary model. |

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

# Only low-effort refactoring targets (quick wins)
fallow health --format json --quiet --effort low

# Save a vital signs snapshot for trend tracking
fallow health --format json --quiet --save-snapshot

# Save snapshot to a custom path
fallow health --format json --quiet --save-snapshot .fallow/baseline-snapshot.json

# Compare current metrics against the most recent snapshot
fallow health --format json --quiet --trend
```

### JSON Output Structure

```json
{
  "schema_version": 3,
  "version": "2.20.0",
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
    "average_maintainability": 88.5,
    "coverage_model": "static_estimated"
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
      "lines": 190,
      "crap_max": 42.0,
      "crap_above_threshold": 2
    }
  ]
}
```

The `crap_max` field is the highest CRAP (Change Risk Anti-Patterns) score among functions in the file, using the canonical formula `CC^2 * (1 - cov/100)^3 + CC`. The default model (`static_estimated`) estimates per-function coverage from export references: directly test-referenced = 85%, indirectly test-reachable = 40%, untested = 0%. Provide `--coverage <path>` with Istanbul-format `coverage-final.json` for exact scores (`istanbul` model). The `crap_above_threshold` field counts functions with CRAP >= 30. When `--file-scores` is active, `summary.coverage_model` indicates the model used (`"static_estimated"` or `"istanbul"`).

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

Targets are sorted by `efficiency` (priority / effort_numeric) descending, surfacing quick wins first. The `target_thresholds` object exposes the adaptive percentile-based thresholds used for scoring. Priority formula: `min(complexity_density, 1) x 30 + hotspot_boost x 25 + dead_code_ratio x 20 + fan_in_norm x 15 + fan_out_norm x 10`, clamped to 0-100. Fan-in and fan-out normalization uses the project's p95 values (with floors). Categories: `urgent_churn_complexity`, `break_circular_dependency`, `split_high_impact`, `remove_dead_code`, `extract_complex_functions`, `extract_dependencies`, `add_test_coverage`. Each target includes `efficiency`, `effort` (low/medium/high), `confidence` (high/medium/low, data source reliability), and contributing `factors`.

The `add_test_coverage` category fires when a file has 2+ functions with CRAP scores >= 30 and complexity density > 0.3. The `crap_max` metric appears in contributing factors for these targets.

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

### Health Trend

With `--trend`, the JSON output includes a `health_trend` object comparing current metrics against the most recent saved snapshot:

```json
{
  "health_trend": {
    "compared_to": {
      "timestamp": "2026-03-25T14:30:00Z",
      "git_sha": "a1b2c3d",
      "score": 74.2,
      "grade": "B"
    },
    "metrics": [
      {
        "name": "score",
        "label": "Health Score",
        "previous": 74.2,
        "current": 76.9,
        "delta": 2.7,
        "direction": "improving",
        "unit": ""
      },
      {
        "name": "dead_file_pct",
        "label": "Dead Files",
        "previous": 5.1,
        "current": 4.2,
        "delta": -0.9,
        "direction": "improving",
        "unit": "%",
        "previous_count": { "value": 13, "total": 255 },
        "current_count": { "value": 11, "total": 262 }
      }
    ],
    "snapshots_loaded": 3,
    "overall_direction": "improving"
  }
}
```

Metrics tracked: `score`, `dead_file_pct`, `dead_export_pct`, `avg_cyclomatic`, `maintainability_avg`, `unused_dep_count`, `circular_dep_count`, `hotspot_count`. Each metric includes `direction` (`improving`, `declining`, `stable`). Percentage metrics include `previous_count`/`current_count` with raw numerator/denominator. `--trend` requires at least one saved snapshot in `.fallow/snapshots/`.

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

## `audit`: Changed-File Quality Gate

Audits changed files for dead code, complexity, and duplication. Returns a verdict (pass/warn/fail). Purpose-built for PR quality gates and reviewing AI-generated code. Auto-detects the base branch if `--base` is not set.

### Flags

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--base` | string | auto-detect | Git ref to compare against (alias for `--changed-since`) |
| `--production` | bool | false | Exclude test/story/dev files |
| `-w, --workspace` | string | — | Scope to a single workspace package |
| `--explain` | bool | false | Include metric definitions in JSON output |
| `--ci` | bool | false | Equivalent to `--format sarif --fail-on-issues --quiet` |
| `--fail-on-issues` | bool | false | Exit with code 1 if issues are found |
| `--sarif-file` | path | — | Write SARIF output to a file alongside primary format |
| `--baseline` | path | — | Compare against a saved baseline |
| `--save-baseline` | path | — | Save current results as a baseline file |
| `--fail-on-regression` | bool | false | Fail if issues increased beyond tolerance vs regression baseline |
| `--tolerance` | string | `0` | Allowed increase before regression fails (`N` or `N%`) |
| `--regression-baseline` | path | `.fallow/regression-baseline.json` | Path to the regression baseline file |
| `--save-regression-baseline` | path | — | Save current issue counts as a regression baseline |

### Verdicts

| Verdict | Exit code | When |
|---------|-----------|------|
| pass | 0 | No issues in changed files |
| warn | 0 | Issues found, all warn-severity |
| fail | 1 | Error-severity issues found |
| error | 2 | Runtime error (invalid ref, not a git repo) |

### Examples

```bash
# Auto-detect base branch
fallow audit --format json --quiet

# Explicit base ref
fallow audit --format json --quiet --base main

# Audit last 3 commits
fallow audit --format json --quiet --base HEAD~3

# Production code only in a monorepo workspace
fallow audit --format json --quiet --production --workspace @app/api

# CI mode (SARIF + fail on issues + quiet)
fallow audit --ci
```

### JSON Output Structure

```json
{
  "schema_version": 3,
  "version": "2.20.0",
  "command": "audit",
  "verdict": "fail",
  "changed_files_count": 12,
  "base_ref": "main",
  "head_sha": "d4a2f91",
  "elapsed_ms": 2140,
  "summary": {
    "dead_code_issues": 2,
    "dead_code_has_errors": true,
    "complexity_findings": 1,
    "max_cyclomatic": 28,
    "duplication_clone_groups": 0
  },
  "dead_code": {
    "schema_version": 3,
    "total_issues": 2,
    "unused_exports": [...]
  },
  "complexity": {
    "findings": [...]
  },
  "duplication": {
    "clone_groups": []
  }
}
```

The `verdict` field is always present and is the primary decision signal. Dead code, complexity, and duplication sections follow their respective schemas from the individual commands. Thresholds for complexity are inherited from `fallow health` config (defaults: cyclomatic 20, cognitive 15).

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
| `--changed-since` (alias: `--base`) | string | Git-aware incremental analysis |
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
| `--summary` | bool | Show only category counts without individual items. Useful for dashboards and quick overviews |
| `--group-by` | `owner\|directory\|package` | Group output by CODEOWNERS ownership (`owner`), first path component (`directory`), or workspace package (`package`, aliases: `workspace`, `pkg`). All output formats partition issues into labeled groups |
| `--score` | bool | Compute health score (0-100 with letter grade) in combined mode. Enables the health delta header in PR comments. JSON includes `health_score` object with `score`, `grade`, and `penalties` breakdown |
| `--trend` | bool | Compare current health metrics against saved snapshot. Implies `--score`. Shows per-metric deltas with directional indicators. Requires at least one saved snapshot in `.fallow/snapshots/` |
| `--save-snapshot` | path (optional) | Save vital signs snapshot for trend tracking. Default path: `.fallow/snapshots/<timestamp>.json`. Forces file-scores + hotspot computation |

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `FALLOW_FORMAT` | Default output format. CLI `--format` overrides. |
| `FALLOW_QUIET` | Set to `1` to suppress progress. CLI `--quiet` overrides. |
| `FALLOW_BIN` | Path to fallow binary (used by the MCP server). |
| `FALLOW_TIMEOUT_SECS` | MCP server subprocess timeout in seconds (default: `120`). Increase for very large codebases. |
| `FALLOW_EXTENDS_TIMEOUT_SECS` | Timeout for fetching remote `extends` URLs in seconds (default: `5`). |
| `FALLOW_COMMAND` | GitLab CI: command to run (default: `dead-code`). |
| `FALLOW_FAIL_ON_ISSUES` | GitLab CI: set to `true` to exit 1 if issues found. |
| `FALLOW_CHANGED_SINCE` | GitLab CI: git ref for incremental analysis. Auto-detected in MR pipelines. |
| `FALLOW_COMMENT` | GitLab CI: set to `true` to post MR summary comments. |
| `FALLOW_REVIEW` | GitLab CI: set to `true` to post inline code review comments on MR diffs. |
| `FALLOW_SCORE` | GitLab CI: set to `true` to compute health score in combined mode. Enables health delta header in MR comments. |
| `FALLOW_TREND` | GitLab CI: set to `true` to compare current health metrics against saved snapshot. Implies `FALLOW_SCORE`. |
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

- **GitHub Actions**: `uses: fallow-rs/fallow@v2` — supports SARIF upload to Code Scanning, inline PR annotations (`annotations: true`), PR comments, all commands. Annotations use workflow commands (no Advanced Security required); limit with `max-annotations` (default 50). Set `score: true` to compute health score and enable the health delta header in PR comments
- **GitLab CI**: include `ci/gitlab-ci.yml` template and extend `.fallow` — generates Code Quality reports via `--format codeclimate` (inline MR annotations), rich MR comments, code review comments, all commands. Variables use `FALLOW_` prefix (e.g., `FALLOW_COMMAND`, `FALLOW_FAIL_ON_ISSUES`). Set `FALLOW_SCORE: "true"` to compute health score; `FALLOW_TREND: "true"` to compare against saved snapshots
- **Any CI**: `npx fallow --ci` — equivalent to `--format sarif --fail-on-issues --quiet`

### GitLab CI Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `FALLOW_COMMAND` | `dead-code` | Command to run (`dead-code`, `dupes`, `health`, or default combined) |
| `FALLOW_FAIL_ON_ISSUES` | `false` | Exit 1 if issues found |
| `FALLOW_CHANGED_SINCE` | auto | Git ref for incremental analysis. Auto-detected in MR pipelines (`origin/$CI_MERGE_REQUEST_TARGET_BRANCH_NAME`) |
| `FALLOW_COMMENT` | `false` | Post a summary comment on the MR with findings |
| `FALLOW_REVIEW` | `false` | Post inline code review comments on MR diff lines where issues were found |
| `FALLOW_SCORE` | `false` | Compute health score (0-100 with letter grade) in combined mode. Enables the health delta header in MR comments |
| `FALLOW_TREND` | `false` | Compare current health metrics against saved snapshot. Implies `FALLOW_SCORE`. Shows per-metric deltas |
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
  "version": "2.20.0",
  "elapsed_ms": 45,
  "total_issues": 12,
  "entry_points": {
    "total": 5,
    "sources": { "package_json_scripts": 2, "next_js": 3 }
  },
  "summary": {
    "total_issues": 12,
    "unused_files": 1,
    "unused_exports": 1,
    "unused_types": 1,
    "unused_dependencies": 1,
    "unused_enum_members": 0,
    "unused_class_members": 0,
    "unresolved_imports": 0,
    "unlisted_dependencies": 0,
    "duplicate_exports": 0,
    "type_only_dependencies": 0,
    "test_only_dependencies": 0,
    "circular_dependencies": 0,
    "boundary_violations": 0
  },
  "unused_files": [{ "path": "src/old.ts" }],
  "unused_exports": [{ "path": "src/utils.ts", "name": "unusedFn", "line": 42, "actions": [{"type": "remove-export", "auto_fixable": true, "description": "Remove the `export` keyword from the declaration"}, {"type": "suppress-line", "auto_fixable": false, "description": "Suppress with an inline comment above the line", "comment": "// fallow-ignore-next-line unused-export"}] }],
  "unused_types": [{ "path": "src/types.ts", "name": "OldType", "line": 10 }],
  "unused_dependencies": [{ "name": "lodash", "line": 5 }],
  "unused_dev_dependencies": [{ "name": "jest", "line": 8 }],
  "unused_enum_members": [{ "path": "src/enums.ts", "enum_name": "Status", "member": "Archived", "line": 5 }],
  "unused_class_members": [{ "path": "src/service.ts", "class_name": "Service", "member": "oldMethod", "line": 20 }],
  "unresolved_imports": [{ "path": "src/index.ts", "specifier": "./missing", "line": 3 }],
  "unlisted_dependencies": [{ "name": "chalk", "imported_from": [{ "path": "src/cli.ts", "line": 1, "col": 0 }] }],
  "duplicate_exports": [{ "name": "Config", "locations": ["src/config.ts:5", "src/types.ts:12"] }],
  "circular_dependencies": [{ "cycle": ["src/a.ts", "src/b.ts", "src/a.ts"], "line": 3, "col": 0, "is_cross_package": false }],
  "boundary_violations": [{ "from_path": "src/ui/Button.ts", "to_path": "src/data/db.ts", "from_zone": "ui", "to_zone": "data", "import_specifier": "../data/db", "line": 5, "col": 0 }],
  "unused_optional_dependencies": [{ "name": "fsevents" }],
  "type_only_dependencies": [{ "name": "zod", "used_in": ["src/schema.ts"], "line": 12 }],
  "test_only_dependencies": [{ "name": "msw", "path": "package.json", "line": 15 }]
}
```

#### `actions` Array

Every issue in `dead-code` JSON output includes an `actions` array with structured fix suggestions. Each action has:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | yes | Action type in kebab-case (14 types, e.g., `remove-export`, `remove-file`, `remove-dependency`, `suppress-line`, `add-to-config`) |
| `auto_fixable` | bool | yes | `true` if `fallow fix` handles this action automatically |
| `description` | string | yes | Human-readable description of the action |
| `comment` | string | no | Suppression comment text (on `suppress-line` actions) |
| `note` | string | no | Additional context on non-auto-fixable items |
| `config_key` | string | no | Config field to update (on `add-to-config` actions) |
| `value` | string | no | Value to add to the config field (on `add-to-config` actions) |

Example:

```json
{
  "path": "src/utils.ts",
  "name": "helperFn",
  "line": 10,
  "actions": [
    {
      "type": "remove-export",
      "auto_fixable": true,
      "description": "Remove the `export` keyword from the declaration"
    },
    {
      "type": "suppress-line",
      "auto_fixable": false,
      "description": "Suppress with an inline comment above the line",
      "comment": "// fallow-ignore-next-line unused-export"
    }
  ]
}
```

Dependency issues use `add-to-config` with `config_key` and `value`:

```json
{
  "name": "autoprefixer",
  "line": 5,
  "actions": [
    {
      "type": "remove-dependency",
      "auto_fixable": true,
      "description": "Remove from package.json dependencies"
    },
    {
      "type": "add-to-config",
      "auto_fixable": false,
      "description": "Add to ignoreDependencies in fallow config",
      "config_key": "ignoreDependencies",
      "value": "autoprefixer"
    }
  ]
}
```

#### `baseline_deltas` Object

When `--baseline` is used in combined output, the JSON includes a `baseline_deltas` object showing per-category changes since the baseline:

```json
{
  "baseline_deltas": {
    "total_delta": -3,
    "per_category": {
      "unused_files": { "current": 5, "baseline": 7, "delta": -2 },
      "unused_exports": { "current": 10, "baseline": 11, "delta": -1 }
    }
  }
}
```

### `dupes` output

```json
{
  "schema_version": 3,
  "version": "2.20.0",
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
  ],
  "mirrored_directories": [
    { "dir_a": "src/components", "dir_b": "src/legacy/components", "shared_clones": 4 }
  ]
}
```

The `mirrored_directories` array identifies directory pairs that share many clone groups, suggesting structural duplication (e.g., a copy-pasted module that was never cleaned up).

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
    "version": "2.20.0",
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
    "boundary_violations": [],
    "unused_optional_dependencies": [],
    "type_only_dependencies": [],
    "test_only_dependencies": []
  },
  "dupes": {
    "schema_version": 3,
    "version": "2.20.0",
    "elapsed_ms": 82,
    "total_clones": 15,
    "total_lines_duplicated": 230,
    "duplication_percentage": 4.2,
    "clone_groups": []
  },
  "health": {
    "schema_version": 3,
    "version": "2.20.0",
    "elapsed_ms": 32,
    "summary": {},
    "findings": [],
    "vital_signs": {}
  }
}
```

Use `--only` or `--skip` to control which analyses are included in the combined output.

With `--score`, the combined output's `health` section includes a `health_score` object (same schema as `health --score`). With `--trend`, it includes a `health_trend` object comparing against the most recent saved snapshot. With `--save-snapshot`, a vital signs snapshot is persisted for future trend comparisons.

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
    "boundary-violation": "error",
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

  // Architecture boundaries (preset or custom zones/rules)
  // Presets: "layered", "hexagonal", "feature-sliced", "bulletproof"
  "boundaries": {
    "preset": "bulletproof"
  },

  // Production mode
  "production": false,

  // Workspace packages that are public libraries.
  // Exports from these packages are not flagged as unused.
  "publicPackages": ["@myorg/shared-lib", "@myorg/utils"],

  // Glob patterns for files that are dynamically loaded at runtime.
  // These files are treated as always-used and never flagged as unused.
  "dynamicallyLoaded": ["plugins/**/*.ts", "locales/**/*.json"],

  // Inherit from base config (relative paths, npm: packages, or https:// URLs)
  "extends": ["./base-config.json", "npm:@my-org/fallow-config", "https://example.com/shared-config.json"],

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
publicPackages = ["@myorg/shared-lib", "@myorg/utils"]
dynamicallyLoaded = ["plugins/**/*.ts", "locales/**/*.json"]

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

[boundaries]
preset = "bulletproof"
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

`unused-file`, `unused-export`, `unused-type`, `unused-dependency`, `unused-dev-dependency`, `unused-enum-member`, `unused-class-member`, `unresolved-import`, `unlisted-dependency`, `duplicate-export`, `circular-dependency`, `boundary-violation`, `unused-optional-dependency`, `type-only-dependency`, `test-only-dependency`, `code-duplication`
