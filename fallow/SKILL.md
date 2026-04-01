---
name: fallow
description: Analyze JavaScript/TypeScript projects with fallow. Finds unused code (files, exports, types, dependencies), code duplication, circular dependencies, complexity hotspots, and architecture boundary violations. Use when asked to find dead code, find unused exports, clean up the codebase, find duplicates, check code health, check architecture boundaries, audit unused code, auto-fix dead code, or run fallow.
license: MIT
metadata:
  author: Bart Waardenburg
  version: 1.0.0
  homepage: https://docs.fallow.tools
---

# Fallow: Codebase Analyzer

The codebase analyzer for JavaScript and TypeScript. Finds unused code, circular dependencies, code duplication, complexity hotspots, and architecture boundary violations. 84 framework plugins, zero configuration, sub-second performance.

## When to Use

- Finding dead code (unused files, exports, types, enum/class members)
- Finding unused or unlisted dependencies
- Detecting code duplication and clones
- Checking code health and complexity hotspots
- Cleaning up a codebase before a release or refactor
- Auditing a project for codebase hygiene
- Setting up CI checks for dead code or duplication thresholds
- Auto-fixing unused exports and dependencies
- Investigating why a specific export or file appears unused

## When NOT to Use

- Runtime error analysis or debugging
- Type checking (use `tsc` for that)
- Linting style or formatting issues (use ESLint, Biome, Prettier)
- Security vulnerability scanning
- Bundle size analysis
- Projects that are not JavaScript or TypeScript

## Prerequisites

Fallow must be installed. If not available, install it:

```bash
npm install -g fallow          # prebuilt binaries (fastest)
# or
npx fallow dead-code               # run without installing
# or
cargo install fallow-cli        # build from source
```

## Agent Rules

1. **Always use `--format json --quiet 2>/dev/null`** for machine-readable output. The `2>/dev/null` discards stderr so progress messages and threshold warnings don't corrupt the JSON on stdout. Never use `2>&1`
2. **Always append `|| true`** to every fallow command. Exit code 1 means "issues found" (normal), not a runtime error. Without `|| true`, the Bash tool treats exit 1 as failure and cancels parallel commands. Only exit code 2 is a real error (invalid config, parse failure)
3. **Use `--explain`** to include a `_meta` object in JSON output with metric definitions, ranges, and interpretation hints
4. **Use issue type filters** (`--unused-exports`, `--unused-files`, etc.) to limit output scope
5. **Always `--dry-run` before `fix`**, then `fix --yes` to apply
6. **All output paths are relative** to the project root
7. **Never run `fallow watch`**. It is interactive and never exits

## Commands

| Command | Purpose | Key Flags |
|---------|---------|-----------|
| `fallow` | Run all analyses: dead code + duplication + complexity (default) | `--only`, `--skip`, `--ci`, `--fail-on-issues`, `--fail-on-regression`, `--tolerance`, `--regression-baseline`, `--save-regression-baseline` |
| `dead-code` | Dead code analysis (`check` is an alias) | `--unused-exports`, `--changed-since`, `--production`, `--ci`, `--fail-on-regression`, `--tolerance`, `--regression-baseline`, `--save-regression-baseline` |
| `dupes` | Code duplication detection | `--mode`, `--threshold`, `--top`, `--changed-since`, `--skip-local`, `--cross-language`, `--fail-on-regression`, `--tolerance`, `--regression-baseline`, `--save-regression-baseline` |
| `fix` | Auto-remove unused exports/deps | `--dry-run`, `--yes` (required in non-TTY) |
| `init` | Generate config file or pre-commit hook | `--toml`, `--hooks`, `--base` |
| `migrate` | Convert knip/jscpd config | `--dry-run`, `--from PATH` |
| `list` | Inspect project structure | `--files`, `--entry-points`, `--plugins`, `--boundaries` |
| `health` | Function complexity analysis | `--complexity`, `--max-cyclomatic`, `--max-cognitive`, `--top`, `--sort`, `--file-scores`, `--hotspots`, `--targets`, `--score`, `--min-score`, `--since`, `--min-commits`, `--save-snapshot`, `--trend`, `--workspace`, `--baseline`, `--save-baseline` |
| `audit` | Combined dead-code + complexity + duplication for changed files | `--base`, `--production`, `--workspace`, `--ci`, `--fail-on-issues`, `--explain` |
| `schema` | Dump CLI definition as JSON | |

## Issue Types

| Type | Filter Flag | Description |
|------|-------------|-------------|
| Unused files | `--unused-files` | Files unreachable from entry points |
| Unused exports | `--unused-exports` | Symbols never imported elsewhere |
| Unused types | `--unused-types` | Type aliases and interfaces |
| Unused dependencies | `--unused-deps` | Packages in `dependencies`, `devDependencies`, `optionalDependencies`, type-only production deps, and test-only production deps |
| Unused enum members | `--unused-enum-members` | Enum values never referenced |
| Unused class members | `--unused-class-members` | Methods and properties |
| Unresolved imports | `--unresolved-imports` | Imports that can't be resolved |
| Unlisted dependencies | `--unlisted-deps` | Used packages missing from package.json |
| Duplicate exports | `--duplicate-exports` | Same symbol exported from multiple modules |
| Circular dependencies | `--circular-deps` | Import cycles in the module graph |
| Boundary violations | `--boundary-violations` | Imports crossing user-defined architecture zone boundaries |
| Test-only dependencies | — | Production deps only imported from test files (should be devDependencies) |

## References

- [CLI Reference](references/cli-reference.md): complete command and flag specifications
- [Gotchas](references/gotchas.md): common pitfalls, edge cases, and correct usage patterns
- [Patterns](references/patterns.md): workflow recipes for CI, monorepos, migration, and incremental adoption

## Common Workflows

### Audit a project for all dead code

```bash
fallow dead-code --format json --quiet
```

Parse the JSON output. It contains arrays for each issue type (`unused_files`, `unused_exports`, `unused_types`, `unused_dependencies`, etc.) plus `total_issues` and `elapsed_ms` metadata. Each issue object includes an `actions` array with structured fix suggestions (action type, `auto_fixable` flag, description, and optional suppression comment).

### Find only unused exports (smaller output)

```bash
fallow dead-code --format json --quiet --unused-exports
```

### Check if a PR introduces dead code

```bash
fallow dead-code --format json --quiet --changed-since main --fail-on-issues
```

Exit code 1 if new dead code is introduced. Only analyzes files changed since the `main` branch.

### Find code duplication

```bash
fallow dupes --format json --quiet
fallow dupes --format json --quiet --mode semantic
```

The `semantic` mode detects renamed variables. Other modes: `strict` (exact), `mild` (default, syntax normalized), `weak` (different literals).

### Safe auto-fix cycle

```bash
# 1. Preview what will be removed
fallow fix --dry-run --format json --quiet

# 2. Review the output, then apply
fallow fix --yes --format json --quiet

# 3. Verify the fix worked
fallow dead-code --format json --quiet
```

The `--yes` flag is required in non-TTY environments (agent subprocesses). Without it, `fix` exits with code 2.

### Discover project structure

```bash
fallow list --entry-points --format json --quiet
fallow list --plugins --format json --quiet
```

Shows detected entry points and active framework plugins (84 built-in: Next.js, Vite, Jest, Storybook, Tailwind, etc.).

### Production-only analysis

```bash
fallow dead-code --format json --quiet --production
```

Excludes test/dev files (`*.test.*`, `*.spec.*`, `*.stories.*`) and only analyzes production scripts.

### Analyze a single workspace package

```bash
fallow dead-code --format json --quiet --workspace my-package
```

Scopes output to one package while keeping the full cross-workspace graph.

### Debug why something is flagged

```bash
# Trace an export's usage chain
fallow dead-code --format json --quiet --trace src/utils.ts:myFunction

# Trace all edges for a file
fallow dead-code --format json --quiet --trace-file src/utils.ts

# Trace where a dependency is used
fallow dead-code --format json --quiet --trace-dependency lodash
```

### Migrate from knip or jscpd

```bash
# Preview migration
fallow migrate --dry-run

# Apply migration (creates .fallowrc.json)
fallow migrate

# Migrate to TOML (creates fallow.toml)
fallow migrate --toml
```

Auto-detects `knip.json`, `.knip.json`, `.jscpd.json`, and package.json embedded configs.

### Initialize a new config

```bash
fallow init              # creates .fallowrc.json, adds .fallow/ to .gitignore
fallow init --toml       # creates fallow.toml, adds .fallow/ to .gitignore
fallow init --hooks      # scaffold a pre-commit git hook
fallow init --hooks --base develop  # hook using custom base branch
```

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success, no error-severity issues |
| 1 | Error-severity issues found |
| 2 | Runtime error (invalid config, parse failure, or `fix` without `--yes` in non-TTY) |

When `--format json` is active and exit code is 2, errors are emitted as JSON on stdout:
```json
{"error": true, "message": "invalid config: ...", "exit_code": 2}
```

## Configuration

Fallow reads config from project root: `.fallowrc.json` > `fallow.toml` > `.fallow.toml`. Most projects work with zero configuration thanks to 84 auto-detecting framework plugins.

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/fallow-rs/fallow/main/schema.json",
  "entry": ["src/index.ts"],
  "ignorePatterns": ["**/*.generated.ts"],
  "ignoreDependencies": ["autoprefixer"],
  "rules": {
    "unused-files": "error",
    "unused-exports": "warn",
    "unused-types": "off"
  }
}
```

Rules: `"error"` (fail CI), `"warn"` (report only), `"off"` (skip detection).

### Inline suppression

```typescript
// fallow-ignore-next-line
export const keepThis = 1;

// fallow-ignore-next-line unused-export
export const keepThisToo = 2;

// fallow-ignore-file
// fallow-ignore-file unused-export
```

## Key Gotchas

- **`fix --yes` is required** in non-TTY (agent) environments. Without it, `fix` exits with code 2
- **Zero config by default.** 84 framework plugins auto-detect. Don't create config unless customization is needed
- **Syntactic analysis only.** No TypeScript compiler, so fully dynamic `import(variable)` is not resolved
- **Function overloads are deduplicated.** TypeScript function overload signatures are merged into a single export (not reported as separate unused exports)
- **Re-export chains are resolved.** Exports through barrel files are tracked, not falsely flagged
- **`--changed-since` is additive.** Only new issues in changed files, not all issues in the project

For the full list with examples, see [references/gotchas.md](references/gotchas.md).

## Instructions

1. **Identify the task** from the user's request (audit, fix, find dupes, set up CI, migrate, debug)
2. **Run the appropriate command** with `--format json --quiet`
3. **Use filter flags** to limit output when the user asks about specific issue types
4. **Always dry-run before fix.** Show the user what will change, then apply
5. **Report results clearly.** Summarize issue counts, list specific findings, suggest next steps
6. **For false positives,** suggest inline suppression comments or config rule adjustments

If `$ARGUMENTS` is provided, use it as the `--root` path or pass it as the target for the appropriate fallow command.
