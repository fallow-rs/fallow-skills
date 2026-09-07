<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/fallow-rs/fallow/main/assets/logo-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/fallow-rs/fallow/main/assets/logo.svg">
    <img src="https://raw.githubusercontent.com/fallow-rs/fallow/main/assets/logo.svg" alt="fallow" width="290">
  </picture><br>
  <strong>Agent skills for the fallow codebase intelligence layer for TypeScript and JavaScript.</strong><br><br>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="MIT License"></a>
  <a href="https://github.com/fallow-rs/fallow-skills/actions/workflows/validate.yml"><img src="https://github.com/fallow-rs/fallow-skills/actions/workflows/validate.yml/badge.svg" alt="CI"></a>
  <a href="https://agentskills.io"><img src="https://img.shields.io/badge/Agent_Skills-compatible-8A2BE2" alt="Agent Skills"></a>
  <a href="https://github.com/fallow-rs/fallow"><img src="https://img.shields.io/badge/fallow-v3.23.0-orange" alt="fallow v3.23.0"></a>
</p>

Agent skills for [fallow](https://github.com/fallow-rs/fallow), codebase intelligence for TypeScript and JavaScript. The static layer reports quality, changed-code risk, cleanup opportunities, circular dependencies, code duplication, complexity hotspots, architecture boundary violations, and design-system styling drift in milliseconds. Optional runtime intelligence adds production execution evidence so agents can delete cold code, flag hot-path changes, and retire stale flags with proof. Broad framework plugin coverage, zero configuration. Works with any agent that supports the [Agent Skills](https://agentskills.io) specification: Claude Code, Cursor, OpenAI Codex, Windsurf, GitHub Copilot, Gemini CLI, Amp, and [30+ more](https://agentskills.io). See [Fallow for coding agents](https://fallow.tools/plugins) for the visual overview and store links.

> **Linters enforce style. Formatters enforce consistency. Fallow enforces relevance.** Linters work file by file. TypeScript works type by type. Neither builds the full module graph, so neither can see what nothing depends on. Fallow does, in milliseconds. These skills teach agents *how* to use fallow effectively: which commands to run, what flags to use, how to interpret output, and how to avoid common pitfalls.

## Quick Start

### Agent Skills CLI

```bash
npx skills add fallow-rs/fallow-skills
```

### Claude Code

```bash
/plugin marketplace add fallow-rs/fallow-skills
/plugin install fallow@fallow-skills
```

### OpenAI Codex

```bash
codex plugin marketplace add fallow-rs/fallow-skills
codex plugin add fallow@fallow-skills
```

### Fallow Impact statusline

Claude Code users can add the compact Fallow Impact segment to their statusline:

```text
/fallow:impact-statusline setup user compose
```

The [command doc](fallow/commands/impact-statusline.md) covers `status`,
`remove`, and the `project` scope. Other agents render the same line with
`fallow impact statusline`.

### Agent-specific CLI shortcuts

```bash
npx skills add fallow-rs/fallow-skills --agent windsurf
npx skills add fallow-rs/fallow-skills --agent amp
gemini skills install https://github.com/fallow-rs/fallow-skills.git
```

<details>
<summary>Other agents</summary>

Use `npx skills add fallow-rs/fallow-skills --all` for installer-managed discovery, or copy the directories under `fallow/skills/` into your agent's skills location.

</details>

## Prerequisites

Fallow must be installed in the target project:

```bash
npm install -g fallow    # prebuilt binaries
npx fallow                   # or run without installing
```

See the [installation guide](https://docs.fallow.tools/installation) for all options including `cargo install fallow-cli`.

## Privacy and network behavior

Analysis runs locally by default and telemetry is off unless the user opts in.
The plugin [README](fallow/README.md) lists the exact network, telemetry, and
statusline behavior for the Claude Code and Codex surfaces.

## Available Skills

| Skill | Description | Trigger phrases |
|---|---|---|
| [fallow](fallow/skills/fallow/) | Codebase intelligence for JS and TS, code and styles: quality, changed-code risk, cleanup opportunities, circular deps, duplication, complexity, design-system drift, and runtime evidence | "check code health", "audit this PR", "find cleanup opportunities", "find duplicates", "what code actually runs" |
| [fallow-review](fallow/skills/fallow-review/) | Graph-grounded review of changed-code risk, blast radius, and consequential structural decisions | "review this branch", "review this PR", "check changed code before merge" |

## Reference Documentation

- **[CLI Reference](fallow/skills/fallow/references/cli-reference.md)**: all commands, flags, JSON output structure, config format
- **[Gotchas](fallow/skills/fallow/references/gotchas.md)**: common pitfalls with WRONG/CORRECT examples
- **[Patterns](fallow/skills/fallow/references/patterns.md)**: workflow recipes for CI, monorepos, migration, and incremental adoption

## Contributing

See [AGENTS.md](AGENTS.md) for repository structure and quality standards.
The `fallow` skill is vendored byte-for-byte from the fallow source repository
at the commit pinned in `source-lock.json`; CI checks that pin against a clean
source checkout and rejects contract or privacy-boundary drift.
Maintainers can find the versioning, packaging, and store update procedure in
[RELEASING.md](RELEASING.md).

### Enable the commit hook

A fresh clone runs no hooks. Turn them on once per clone:

```bash
git config core.hooksPath .githooks
```

The hook only checks manifest version agreement and the bump rule; see
[.githooks/pre-commit](.githooks/pre-commit) for why it stops there.

## Related

- [fallow](https://github.com/fallow-rs/fallow): codebase intelligence for TypeScript and JavaScript, a single pass over code and styles
- [fallow-docs](https://docs.fallow.tools): Official documentation
- [VS Code extension](https://marketplace.visualstudio.com/items?itemName=fallow-rs.fallow-vscode): Real-time diagnostics in your editor
- [Agent Skills specification](https://agentskills.io): The open standard this skill follows

## License

MIT. See [LICENSE](LICENSE) for details.
