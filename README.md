<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/fallow-rs/fallow/main/assets/logo-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/fallow-rs/fallow/main/assets/logo.svg">
    <img src="https://raw.githubusercontent.com/fallow-rs/fallow/main/assets/logo.svg" alt="fallow" width="290">
  </picture><br>
  <strong>Agent skills for the JavaScript and TypeScript codebase analyzer.</strong><br><br>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="MIT License"></a>
  <a href="https://github.com/fallow-rs/fallow-skills/actions/workflows/validate.yml"><img src="https://github.com/fallow-rs/fallow-skills/actions/workflows/validate.yml/badge.svg" alt="CI"></a>
  <a href="https://agentskills.io"><img src="https://img.shields.io/badge/Agent_Skills-compatible-8A2BE2" alt="Agent Skills"></a>
  <a href="https://github.com/fallow-rs/fallow"><img src="https://img.shields.io/badge/fallow-v2.27.6-orange" alt="fallow v2.27.6"></a>
</p>

Agent skills for [fallow](https://github.com/fallow-rs/fallow), the Rust-native codebase analyzer for JavaScript and TypeScript. Fallow finds unused code, circular dependencies, code duplication, complexity hotspots, and architecture boundary violations. 85 framework plugins, zero configuration, sub-second performance. Works with any agent that supports the [Agent Skills](https://agentskills.io) specification: Claude Code, Cursor, OpenAI Codex, Windsurf, GitHub Copilot, Gemini CLI, Amp, and [30+ more](https://agentskills.io).

> **Linters enforce style. Formatters enforce consistency. Fallow enforces relevance.** Linters work file by file. TypeScript works type by type. Neither builds the full module graph, so neither can see what nothing depends on. Fallow does, in milliseconds. These skills teach agents *how* to use fallow effectively: which commands to run, what flags to use, how to interpret output, and how to avoid common pitfalls.

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
npx fallow dead-code         # or run without installing
```

See the [installation guide](https://docs.fallow.tools/installation) for all options including `cargo install fallow-cli`.

## Available Skills

| Skill | Description | Trigger phrases |
|---|---|---|
| [fallow](fallow/) | Codebase analysis for JS/TS: unused code, circular deps, duplication, complexity | "find dead code", "unused exports", "find duplicates", "check code health" |

## What's Included

### fallow

| Category | What it does |
|---|---|
| **Dead Code** | Find unused files, exports, types, dependencies, enum/class members (15 issue types) |
| **Duplication** | Find code clones with 4 modes: strict, mild, weak, semantic |
| **Complexity** | Function complexity analysis, hotspot detection, health scores |
| **Auto-Fix** | Remove unused exports and dependencies with dry-run preview |
| **CI** | GitHub Actions, SARIF upload, baseline comparison, PR-scoped checks |
| **Monorepo** | Per-workspace analysis with cross-package resolution |
| **Debug** | Trace export usage chains, file edges, and dependency usage |

### Reference Documentation

- **[CLI Reference](fallow/references/cli-reference.md)**: all 10 commands, flags, JSON output structure, config format
- **[Gotchas](fallow/references/gotchas.md)**: 19 pitfalls with WRONG/CORRECT examples
- **[Patterns](fallow/references/patterns.md)**: 14 workflow recipes for CI, monorepos, migration, incremental adoption

## Example Prompts

Once installed, you can use natural language:

- "Find all dead code in this project"
- "Are there any unused dependencies?"
- "Find code duplication in the codebase"
- "Clean up unused exports"
- "Set up a CI check for dead code"
- "Check the complexity of this codebase"
- "Why is this export flagged as unused?"
- "Check if this PR introduces dead code"
- "Find unused files in the payments package"
- "What's the duplication percentage?"

## How It Works

```
User: "Find all unused exports"
  ↓
Agent loads fallow skill
  ↓
Skill instructs: run `fallow dead-code --format json --quiet --unused-exports`
  ↓
Agent executes command, parses JSON output
  ↓
Agent summarizes findings with file paths and line numbers
```

The skill provides agents with:
1. **Command knowledge**: which fallow command + flags to use for each task
2. **Output parsing**: how to interpret JSON results
3. **Guardrails**: always dry-run before fix, never run watch, use `--yes` in non-TTY
4. **Debugging**: how to trace false positives with `--trace`

## Contributing

See [CLAUDE.md](CLAUDE.md) for repository structure, skill creation guidelines, and quality standards.

## Related

- [fallow](https://github.com/fallow-rs/fallow): The Rust-native codebase analyzer for JavaScript (3-36x faster than knip)
- [fallow-docs](https://docs.fallow.tools): Official documentation
- [VS Code extension](https://marketplace.visualstudio.com/items?itemName=fallow-rs.fallow-vscode): Real-time diagnostics in your editor
- [Agent Skills specification](https://agentskills.io): The open standard this skill follows

## License

MIT. See [LICENSE](LICENSE) for details.
