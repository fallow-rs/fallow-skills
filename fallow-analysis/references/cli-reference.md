# Fallow CLI Reference

Complete command and flag specifications for all fallow CLI commands.

---

## Table of Contents

- [`check` — Dead Code Analysis](#check--dead-code-analysis)
- [`dupes` — Duplication Detection](#dupes--duplication-detection)
- [`fix` — Auto-Remove Unused Code](#fix--auto-remove-unused-code)
- [`list` — Project Introspection](#list--project-introspection)
- [`init` — Config Generation](#init--config-generation)
- [`migrate` — Config Migration](#migrate--config-migration)
- [`schema` — CLI Introspection](#schema--cli-introspection)
- [`config-schema` — Config JSON Schema](#config-schema--config-json-schema)
- [`plugin-schema` — Plugin JSON Schema](#plugin-schema--plugin-json-schema)
- [Global Flags](#global-flags)
- [Environment Variables](#environment-variables)
- [Output Formats](#output-formats)
- [JSON Output Structure](#json-output-structure)
- [Configuration File Format](#configuration-file-format)
- [Inline Suppression Comments](#inline-suppression-comments)

---

## `check` — Dead Code Analysis

Analyzes the project for unused files, exports, dependencies, types, members, and more. This is the default command — running `fallow` with no subcommand is equivalent to `fallow check`.

### Flags

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--format` | `human\|json\|sarif\|compact` | `human` | Output format |
| `--quiet` | bool | `false` | Suppress progress bars and timing on stderr |
| `--fail-on-issues` | bool | `false` | Exit 1 if any issues found (promotes `warn` to `error`) |
| `--changed-since` | string | — | Only analyze files changed since a git ref (e.g., `main`, `HEAD~3`) |
| `--production` | bool | `false` | Exclude test/dev files, only start/build scripts |
| `--ci` | bool | `false` | CI mode: `--format sarif --fail-on-issues --quiet` |
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
| `--unused-deps` | Unused dependencies and devDependencies |
| `--unused-enum-members` | Unused enum members |
| `--unused-class-members` | Unused class members |
| `--unresolved-imports` | Unresolved imports |
| `--unlisted-deps` | Unlisted dependencies |
| `--duplicate-exports` | Duplicate exports |
| `--circular-deps` | Circular dependencies |

### Examples

```bash
# Full analysis with JSON output
fallow check --format json --quiet

# Only unused exports
fallow check --format json --quiet --unused-exports

# PR check — only changed files
fallow check --format json --quiet --changed-since main --fail-on-issues

# CI mode with SARIF upload
fallow check --ci

# Production-only analysis
fallow check --format json --quiet --production

# Single workspace package
fallow check --format json --quiet --workspace my-package

# Debug: trace an export
fallow check --format json --quiet --trace src/utils.ts:myFunction

# Incremental adoption with baseline
fallow check --format json --quiet --save-baseline .fallow-baseline.json
fallow check --format json --quiet --baseline .fallow-baseline.json --fail-on-issues
```

---

## `dupes` — Duplication Detection

Finds code duplication and clones across the project.

### Flags

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--format` | `human\|json\|sarif\|compact` | `human` | Output format |
| `--quiet` | bool | `false` | Suppress progress bars |
| `--mode` | `strict\|mild\|weak\|semantic` | `mild` | Detection mode |
| `--min-tokens` | number | `50` | Minimum token count for a clone |
| `--min-lines` | number | `5` | Minimum line count for a clone |
| `--threshold` | number | `0` | Fail if duplication exceeds this percentage |
| `--skip-local` | bool | `false` | Only report cross-directory duplicates |
| `--cross-language` | bool | `false` | Strip type annotations for TS↔JS matching |
| `--trace` | `FILE:LINE` | — | Trace all clones at a specific location |
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

# Incremental CI
fallow dupes --format json --quiet --save-baseline .fallow-dupes-baseline.json
fallow dupes --format json --quiet --baseline .fallow-dupes-baseline.json --threshold 5
```

---

## `fix` — Auto-Remove Unused Code

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

## `list` — Project Introspection

Inspect discovered files, entry points, and detected frameworks.

### Flags

| Flag | Type | Description |
|------|------|-------------|
| `--files` | bool | List all discovered files |
| `--entry-points` | bool | List detected entry points |
| `--frameworks` | bool | List active framework plugins |
| `--plugins` | bool | List all available plugins |
| `--format` | `human\|json` | Output format |
| `--quiet` | bool | Suppress progress bars |

### Examples

```bash
fallow list --files --format json --quiet
fallow list --entry-points --format json --quiet
fallow list --frameworks --format json --quiet
```

---

## `init` — Config Generation

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

## `migrate` — Config Migration

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

## `schema` — CLI Introspection

Dumps the full CLI interface definition as machine-readable JSON.

```bash
fallow schema
```

---

## `config-schema` — Config JSON Schema

Prints the JSON Schema for fallow configuration files.

```bash
fallow config-schema > schema.json
```

---

## `plugin-schema` — Plugin JSON Schema

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
| `-f, --format` | string | Output format |
| `-q, --quiet` | bool | Suppress progress output |
| `--no-cache` | bool | Disable incremental caching |
| `--threads` | number | Number of parser threads |
| `--changed-since` | string | Git-aware incremental analysis |
| `--baseline` | path | Compare to baseline |
| `--save-baseline` | path | Save results as baseline |
| `--performance` | bool | Show pipeline timing breakdown |
| `-w, --workspace` | string | Scope to single workspace package |

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `FALLOW_FORMAT` | Default output format. CLI `--format` overrides. |
| `FALLOW_QUIET` | Set to `1` to suppress progress. CLI `--quiet` overrides. |
| `FALLOW_BIN` | Path to fallow binary (used by the MCP server). |

Set `FALLOW_FORMAT=json` and `FALLOW_QUIET=1` in your agent environment to avoid passing flags on every invocation.

---

## Output Formats

| Format | Description | Use Case |
|--------|-------------|----------|
| `human` | Colored terminal output | Interactive use |
| `json` | Machine-readable JSON | Agent integration, CI pipelines |
| `sarif` | Static Analysis Results Interchange Format | GitHub Code Scanning |
| `compact` | Grep-friendly: `type:path:line:name` per line | Quick filtering |

---

## JSON Output Structure

### `check` output

```json
{
  "schema_version": 1,
  "version": "0.3.0",
  "elapsed_ms": 45,
  "total_issues": 12,
  "unused_files": [{ "path": "src/old.ts" }],
  "unused_exports": [{ "path": "src/utils.ts", "name": "unusedFn", "line": 42 }],
  "unused_types": [{ "path": "src/types.ts", "name": "OldType", "line": 10 }],
  "unused_dependencies": [{ "name": "lodash" }],
  "unused_dev_dependencies": [{ "name": "jest" }],
  "unused_enum_members": [{ "path": "src/enums.ts", "enum_name": "Status", "member": "Archived", "line": 5 }],
  "unused_class_members": [{ "path": "src/service.ts", "class_name": "Service", "member": "oldMethod", "line": 20 }],
  "unresolved_imports": [{ "path": "src/index.ts", "specifier": "./missing", "line": 3 }],
  "unlisted_dependencies": [{ "name": "chalk", "used_in": ["src/cli.ts"] }],
  "duplicate_exports": [{ "name": "Config", "locations": ["src/config.ts:5", "src/types.ts:12"] }],
  "circular_dependencies": [{ "cycle": ["src/a.ts", "src/b.ts", "src/a.ts"] }]
}
```

### `dupes` output

```json
{
  "schema_version": 1,
  "version": "0.3.0",
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
    "circular-dependencies": "warn"
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

`unused-file`, `unused-export`, `unused-type`, `unused-dependency`, `unused-dev-dependency`, `unused-enum-member`, `unused-class-member`, `unresolved-import`, `unlisted-dependency`, `duplicate-export`, `circular-dependency`, `code-duplication`
