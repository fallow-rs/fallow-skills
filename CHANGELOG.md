# Changelog

All notable changes to this project will be documented in this file.

## [1.3.0] - 2026-03-27

### Changed

- Updated for fallow v2.4.0 (was v2.3.1)
- Issue types table now lists 14 types (was 13): added `test-only-dependencies`
- New suppression token: `test-only-dependency`
- New `test_only_dependencies` field in JSON output
- Added `test-only-dependencies` to rules config example (default severity: `warn`)
- New gotcha: test-only dependencies should be devDependencies
- Version badge updated to v2.4.0

## [1.2.0] - 2026-03-24

### Changed

- Updated for fallow v1.6.0 (was v1.4.0)
- JSON output `schema_version` bumped from 2 to 3
- `unlisted_dependencies[].imported_from` changed from `string[]` to `ImportSite[]` (`{path, line, col}` objects)
- `unused_dependencies` and `unused_dev_dependencies` now include a `line` field
- `type_only_dependencies` now includes a `line` field
- `circular_dependencies` now includes `line` and `col` fields

## [1.1.0] - 2026-03-23

### Changed

- Updated for fallow v1.4.0 (was v1.3.1)
- Issue types table now lists 13 types (was 12): added `type-only-dependencies`
- New suppression tokens: `unused-optional-dependency`, `type-only-dependency`
- New CLI filter flag: `--type-only-deps`
- New `type_only_dependencies` field in JSON output
- Added `type-only-dependencies` to rules config example
- 3 new gotchas: JSDoc `@public` tag, class instance member tracking, type-only dependencies

## [1.0.0] - 2026-03-20

### Added

- **fallow-analysis skill** with complete dead code and duplication analysis workflows
- CLI reference covering all 9 fallow commands with flags, output formats, and examples
- 16 gotchas with WRONG/CORRECT examples for common agent pitfalls
- 14 workflow recipes for CI, monorepos, migration, incremental adoption, and debugging
- Installation instructions for Claude Code, Cursor, Codex, Windsurf, Copilot, Gemini CLI, Amp
- CI validation pipeline (JSON, frontmatter, hardcoded paths, version sync)
- Plugin metadata for Claude Code marketplace (`.claude-plugin/`)

[1.3.0]: https://github.com/fallow-rs/fallow-skills/releases/tag/v1.3.0
[1.2.0]: https://github.com/fallow-rs/fallow-skills/releases/tag/v1.2.0
[1.1.0]: https://github.com/fallow-rs/fallow-skills/releases/tag/v1.1.0
[1.0.0]: https://github.com/fallow-rs/fallow-skills/releases/tag/v1.0.0
