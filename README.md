# fallow-skills

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![CI](https://github.com/fallow-rs/fallow-skills/actions/workflows/validate.yml/badge.svg)](https://github.com/fallow-rs/fallow-skills/actions/workflows/validate.yml)
[![Agent Skills](https://img.shields.io/badge/Agent_Skills-compatible-8A2BE2)](https://agentskills.io)
[![fallow](https://img.shields.io/badge/fallow-v0.3-orange)](https://github.com/fallow-rs/fallow)

Agent skills for finding and removing dead code, unused dependencies, and code duplication in JavaScript/TypeScript projects using [fallow](https://github.com/fallow-rs/fallow). Works with any agent that supports the [Agent Skills](https://agentskills.io) specification — Claude Code, Cursor, OpenAI Codex, Windsurf, GitHub Copilot, Gemini CLI, Amp, and [30+ more](https://agentskills.io).

> **Why skills?** AI agents can generate code but can't perform static analysis — building module graphs, tracing re-export chains, and exhaustively checking every import across thousands of files. Fallow does this in milliseconds. These skills teach agents *how* to use fallow effectively: which commands to run, what flags to use, how to interpret output, and how to avoid common pitfalls.

## Quick Start

### Claude Code

```bash
/install fallow-rs/fallow-skills
```

### Cursor

```bash
git clone https://github.com/fallow-rs/fallow-skills.git ~/.cursor/skills/fallow-skills
```

### OpenAI Codex

```bash
git clone https://github.com/fallow-rs/fallow-skills.git ~/.agents/skills/fallow-skills
```

### Windsurf

```bash
git clone https://github.com/fallow-rs/fallow-skills.git ~/.codeium/windsurf/skills/fallow-skills
```

### GitHub Copilot

```bash
git clone https://github.com/fallow-rs/fallow-skills.git .github/skills/fallow-skills
```

### Gemini CLI

```bash
gemini skills install https://github.com/fallow-rs/fallow-skills.git
```

### Amp

```bash
git clone https://github.com/fallow-rs/fallow-skills.git ~/.config/agents/skills/fallow-skills
```

<details>
<summary>Other agents</summary>

Clone or copy the skill directory into your agent's skills location. This skill follows the open [Agent Skills](https://agentskills.io) specification and works with any compatible agent.

</details>

## Prerequisites

Fallow must be installed in the target project:

```bash
npm install -g fallow    # prebuilt binaries
npx fallow check         # or run without installing
```

See the [installation guide](https://docs.fallow.tools/installation) for all options including `cargo install fallow-cli`.

## Available Skills

| Skill | Description | Trigger phrases |
|---|---|---|
| [fallow-analysis](fallow-analysis/) | Dead code and duplication analysis for JS/TS | "find dead code", "unused exports", "find duplicates", "clean up codebase" |

## What's Included

### fallow-analysis

| Category | What it does |
|---|---|
| **Dead Code** | Find unused files, exports, types, dependencies, enum/class members (10 issue types) |
| **Duplication** | Find code clones with 4 modes: strict, mild, weak, semantic |
| **Auto-Fix** | Remove unused exports and dependencies with dry-run preview |
| **CI** | GitHub Actions, SARIF upload, baseline comparison, PR-scoped checks |
| **Migration** | Auto-migrate from knip and jscpd configurations |
| **Monorepo** | Per-workspace analysis with cross-package resolution |
| **Debug** | Trace export usage chains, file edges, and dependency usage |

### Reference Documentation

- **[CLI Reference](fallow-analysis/references/cli-reference.md)** — all 9 commands, flags, JSON output structure, config format
- **[Gotchas](fallow-analysis/references/gotchas.md)** — 16 pitfalls with WRONG/CORRECT examples
- **[Patterns](fallow-analysis/references/patterns.md)** — 14 workflow recipes for CI, monorepos, migration, incremental adoption

## Example Prompts

Once installed, you can use natural language:

- "Find all dead code in this project"
- "Are there any unused dependencies?"
- "Find code duplication in the codebase"
- "Clean up unused exports"
- "Set up a CI check for dead code"
- "Migrate my knip config to fallow"
- "Why is this export flagged as unused?"
- "Check if this PR introduces dead code"
- "Find unused files in the payments package"
- "What's the duplication percentage?"

## How It Works

```
User: "Find all unused exports"
  ↓
Agent loads fallow-analysis skill
  ↓
Skill instructs: run `fallow check --format json --quiet --unused-exports`
  ↓
Agent executes command, parses JSON output
  ↓
Agent summarizes findings with file paths and line numbers
```

The skill provides agents with:
1. **Command knowledge** — which fallow command + flags to use for each task
2. **Output parsing** — how to interpret JSON results
3. **Guardrails** — always dry-run before fix, never run watch, use `--yes` in non-TTY
4. **Debugging** — how to trace false positives with `--trace`

## Contributing

See [CLAUDE.md](CLAUDE.md) for repository structure, skill creation guidelines, and quality standards.

## Related

- [fallow](https://github.com/fallow-rs/fallow) — The Rust-native dead code analyzer (3-36x faster than knip)
- [fallow-docs](https://docs.fallow.tools) — Official documentation
- [VS Code extension](https://marketplace.visualstudio.com/items?itemName=fallow-rs.fallow-vscode) — Real-time diagnostics in your editor
- [Agent Skills specification](https://agentskills.io) — The open standard this skill follows

## License

MIT — see [LICENSE](LICENSE) for details.
