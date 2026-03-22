# Fallow: Critical Gotchas

Common pitfalls and their correct solutions when working with fallow.

---

## `fix` Requires `--yes` in Non-TTY Environments

The `fix` command prompts for confirmation in interactive terminals. In agent subprocesses, CI pipelines, or piped input (non-TTY), the `--yes` flag is mandatory. Without it, `fix` exits with code 2 and an error.

```bash
# WRONG: fix exits with code 2 in non-TTY
fallow fix --format json --quiet

# CORRECT: always use --dry-run first, then --yes
fallow fix --dry-run --format json --quiet   # preview
fallow fix --yes --format json --quiet       # apply
```

Always preview with `--dry-run` before applying. This is a destructive operation that modifies source files.

---

## Don't Create Config Unless Needed

Fallow works with zero configuration for most projects thanks to 84 auto-detecting framework plugins. Creating an unnecessary config file can mask issues or override detection behavior.

```bash
# WRONG: creating config for a standard Next.js project
fallow init
# This may override auto-detected settings

# CORRECT: run analysis first with zero config
fallow check --format json --quiet
# Only create config if you need to customize rules, ignore patterns, or entry points
```

Only create a config when you need to:
- Change rule severity levels for incremental adoption
- Add custom ignore patterns or ignore dependencies
- Specify additional entry points not auto-detected
- Configure duplication detection settings

---

## Use `--format json` for Agent Consumption

Human-formatted output contains ANSI colors, progress bars, and timing info. Never parse it programmatically.

```bash
# WRONG: parsing human output
fallow check | grep "unused"

# CORRECT: use structured JSON
fallow check --format json --quiet
```

The `--quiet` flag suppresses progress bars on stderr. Without it, stderr output may interfere with stdout parsing.

---

## `--changed-since` Shows Only New Issues

The `--changed-since` flag limits analysis to files modified since a git ref. It only reports issues in those files, not all issues in the project. Works with both `check` and `dupes`.

```bash
# This only shows issues in files changed since main
fallow check --format json --quiet --changed-since main

# Same for duplication — only clone groups involving changed files
fallow dupes --format json --quiet --changed-since main

# This shows ALL issues in the project
fallow check --format json --quiet
```

Don't use `--changed-since` when auditing the full project. Use it for PR checks and incremental CI.

---

## Filter Flags Are Additive

Issue type filter flags (`--unused-exports`, `--unused-files`, etc.) are inclusive. They select which issue types to show. Using multiple flags shows the union.

```bash
# Shows only unused exports
fallow check --format json --quiet --unused-exports

# Shows unused exports AND unused files
fallow check --format json --quiet --unused-exports --unused-files

# Shows ALL issue types (default when no filter is specified)
fallow check --format json --quiet
```

---

## Syntactic Analysis: No TypeScript Compiler

Fallow uses Oxc for pure syntactic analysis. It does not run the TypeScript compiler. This means:

- **Fully dynamic imports** (`import(variable)`) are not resolved. Only static strings, template literals with static prefixes, `import.meta.glob`, and `require.context` patterns
- **Value-level type narrowing** is not performed. Fallow can't know that `if (x instanceof Foo)` means `Foo` is "used"
- **Conditional exports** based on runtime values are not analyzed
- **Function overload signatures are deduplicated**: TypeScript function overloads (multiple signatures for the same function name) are merged into a single export. They are not reported as separate unused exports

```typescript
// RESOLVED: static pattern with prefix
import(`./locales/${lang}.json`);

// RESOLVED: import.meta.glob
const modules = import.meta.glob('./modules/*.ts');

// NOT RESOLVED: fully dynamic
const mod = import(someVariable);
```

If fallow falsely flags something due to dynamic patterns, use inline suppression:

```typescript
// fallow-ignore-next-line unused-export
export const dynamicallyUsed = createHandler();
```

---

## Re-Export Chains Are Resolved

Fallow fully resolves `export *` and named re-export chains through barrel files. An export consumed through a chain of barrel files is NOT falsely flagged.

```typescript
// src/utils.ts
export const helper = () => {};  // NOT flagged, used via barrel chain

// src/index.ts (barrel)
export * from './utils';

// src/app.ts
import { helper } from './index';  // Resolves through the chain
```

If an export IS flagged as unused despite being in a barrel file, it means no downstream consumer actually imports it. The barrel file re-exports it, but nobody uses it from there.

---

## Exit Code 1 vs 2

| Code | Meaning | Action |
|------|---------|--------|
| 0 | No error-severity issues | Success |
| 1 | Error-severity issues found | Review findings |
| 2 | Runtime error (`fix` without `--yes` in non-TTY, invalid config) | Fix config or add `--yes` |

Exit code 1 is triggered by issues with `"error"` severity in the rules config. Without a rules section, all issue types default to `"error"`. Use the rules system to control which issues fail CI:

```jsonc
// Only fail on unused files and deps, warn on everything else
{
  "rules": {
    "unused-files": "error",
    "unused-dependencies": "error",
    "unused-exports": "warn",
    "unused-types": "warn"
  }
}
```

---

## `--fail-on-issues` Promotes Warn to Error

The `--fail-on-issues` flag promotes all `warn`-severity rules to `error` for that run. This means exit code 1 for ANY reported issue.

```bash
# With rules: { "unused-exports": "warn" }

# This exits 0 even with warn-level findings
fallow check --format json --quiet

# This exits 1 if ANY issue is found (warn promoted to error)
fallow check --format json --quiet --fail-on-issues
```

Use `--fail-on-issues` for strict CI gates. Use the rules system for gradual adoption.

---

## Baseline Comparison Tracks Issue Identity

Baselines track issues by identity (file + issue type + name), not by count. Adding a new unused export while fixing an old one doesn't cancel out.

```bash
# Save current state as baseline
fallow check --format json --quiet --save-baseline .fallow-baseline.json

# Later: only fail on NEW issues not in the baseline
fallow check --format json --quiet --baseline .fallow-baseline.json --fail-on-issues
```

Commit the baseline file to your repo. Update it periodically as you fix existing issues.

---

## Duplication Modes Affect What's Detected

The detection mode significantly affects results. Choose based on your needs:

```bash
# strict: exact token match only
fallow dupes --format json --quiet --mode strict
# Catches: copy-pasted code with zero changes

# mild (default): syntax normalized
fallow dupes --format json --quiet --mode mild
# Catches: whitespace and semicolon differences

# weak: literal values normalized
fallow dupes --format json --quiet --mode weak
# Catches: same structure with different strings/numbers

# semantic: identifier names normalized
fallow dupes --format json --quiet --mode semantic
# Catches: same logic with renamed variables
```

`semantic` mode produces the most findings but may include false positives where similar structure is coincidental.

---

## Workspace Flag Scopes Output, Not Analysis

The `--workspace` flag scopes **output** to a single package, but the full cross-workspace module graph is still built. This means:

- Imports from other workspace packages are still resolved
- Re-export chains crossing package boundaries are still tracked
- Only issues IN the specified package are reported

```bash
# Analyze everything, show only issues in "my-package"
fallow check --format json --quiet --workspace my-package
```

---

## Production Mode Excludes Test Files

`--production` excludes test/dev files and only analyzes production scripts. This changes what's reported:

- Test files (`*.test.*`, `*.spec.*`, `*.stories.*`, `__tests__/**`) are excluded
- Only `start`, `build`, `serve`, `preview`, `prepare` scripts are analyzed
- Unused devDependencies are NOT reported (forced to `off`)
- Type-only production dependencies ARE reported (should be devDependencies)

```bash
# WRONG: using --production for a full audit
fallow check --format json --quiet --production
# Misses test-file dead code and devDependency issues

# CORRECT: use --production only for production-focused CI
fallow check --format json --quiet --production --fail-on-issues
```

---

## Watch Mode Is Not for Agents

The `watch` command starts an interactive file watcher that never exits. Never use it in agent workflows.

```bash
# WRONG: this will hang forever
fallow watch

# CORRECT: run one-shot analysis
fallow check --format json --quiet
```

---

## Suppressing Duplication False Positives

Code duplication has its own suppression token: `code-duplication`. Use it for intentionally similar code (e.g., test helpers, generated patterns).

```typescript
// WRONG: using the wrong token
// fallow-ignore-file unused-export
// This suppresses dead code, not duplication

// CORRECT: suppress duplication for a specific line
// fallow-ignore-next-line code-duplication
const handler = createStandardHandler(config);

// CORRECT: suppress all duplication in a file
// fallow-ignore-file code-duplication
```

This is separate from the dead code suppression tokens. See the full list of valid tokens in the [CLI Reference](cli-reference.md#inline-suppression-comments).

---

## Decorated Members Are Skipped

Class members with decorators (NestJS `@Get()`, Angular `@Input()`, TypeORM `@Column()`, etc.) are automatically excluded from unused member detection. Decorator-driven frameworks consume these via reflection at runtime.

```typescript
class UserController {
  @Get('/users')
  getUsers() { ... }  // NOT flagged, has decorator
}
```

This is handled automatically. No suppression needed.
