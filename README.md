# fallow-skills

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![CI](https://github.com/fallow-rs/fallow-skills/actions/workflows/validate.yml/badge.svg)](https://github.com/fallow-rs/fallow-skills/actions/workflows/validate.yml)

Agent skills for finding and removing dead code, unused dependencies, and code duplication in JavaScript/TypeScript projects using [fallow](https://github.com/fallow-rs/fallow). Works with any agent that supports the [Agent Skills](https://agentskills.io) specification — Claude Code, Cursor, OpenAI Codex, Windsurf, GitHub Copilot, Gemini CLI, Amp, and more.

## Features

- **11 dead code issue types** — unused files, exports, dependencies, types, enum/class members, and more
- **4 duplication detection modes** — strict, mild, weak, and semantic clone detection
- **Step-by-step workflows** for CI setup, monorepo analysis, migration, and incremental adoption
- **Gotcha documentation** covering agent-specific pitfalls and correct usage patterns
- **Companion skill** to the [fallow](https://github.com/fallow-rs/fallow) CLI and [fallow-docs](https://docs.fallow.tools)

## Prerequisites

Fallow must be installed in the target project. The fastest way:

```bash
npm install -g fallow
```

Or run without installing:

```bash
npx fallow check
```

See the [fallow installation guide](https://docs.fallow.tools/installation) for all options.

## Installation

### Claude Code

```bash
/install fallow-rs/fallow-skills
```

### Cursor

Clone into Cursor's skills directory:

```bash
git clone https://github.com/fallow-rs/fallow-skills.git ~/.cursor/skills/fallow-skills
```

### OpenAI Codex

Clone into the Codex skills directory:

```bash
git clone https://github.com/fallow-rs/fallow-skills.git ~/.agents/skills/fallow-skills
```

### Windsurf

Clone into the Windsurf skills directory:

```bash
git clone https://github.com/fallow-rs/fallow-skills.git ~/.codeium/windsurf/skills/fallow-skills
```

### GitHub Copilot / VS Code

Clone into your project or user skills directory:

```bash
git clone https://github.com/fallow-rs/fallow-skills.git ~/.agents/skills/fallow-skills
```

### Gemini CLI

```bash
gemini skills install https://github.com/fallow-rs/fallow-skills.git
```

### Amp

Clone into the Amp skills directory:

```bash
git clone https://github.com/fallow-rs/fallow-skills.git ~/.config/agents/skills/fallow-skills
```

### Other Agents

Clone or copy the skill directory into your agent's skills location. This skill follows the open [Agent Skills](https://agentskills.io) specification and works with any compatible agent.

## Available Skills

| Skill | Description |
|---|---|
| [fallow-analysis](fallow-analysis/) | Find dead code, unused dependencies, and code duplication in JS/TS projects |

## What's Included

### fallow-analysis

Covers all fallow CLI commands for dead code and duplication analysis:

| Category | Key Operations |
|---|---|
| Dead Code Detection | Find unused files, exports, types, dependencies, enum/class members |
| Duplication Detection | Find code clones with 4 detection modes (strict, mild, weak, semantic) |
| Auto-Fix | Remove unused exports and dependencies with dry-run preview |
| CI Integration | GitHub Actions, SARIF upload, baseline comparison, PR-scoped checks |
| Migration | Auto-migrate from knip and jscpd configurations |
| Monorepo Support | Per-workspace analysis with cross-package resolution |
| Debugging | Trace export usage chains, file edges, and dependency usage |

### Reference Documentation

Each skill includes structured reference files:

- **[CLI Reference](fallow-analysis/references/cli-reference.md)** — complete command and flag specifications, output formats, config file format
- **[Gotchas](fallow-analysis/references/gotchas.md)** — common pitfalls, edge cases, and correct usage patterns
- **[Patterns](fallow-analysis/references/patterns.md)** — workflow recipes for CI, monorepos, migration, incremental adoption, and more

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

## Contributing

See [CLAUDE.md](CLAUDE.md) for repository structure, skill creation guidelines, and quality standards.

## Related

- [fallow](https://github.com/fallow-rs/fallow) — The Rust-native dead code analyzer
- [fallow-docs](https://docs.fallow.tools) — Official documentation
- [fallow VS Code extension](https://marketplace.visualstudio.com/items?itemName=fallow.fallow-vscode) — Real-time dead code diagnostics in your editor

## License

MIT — see [LICENSE](LICENSE) for details.
