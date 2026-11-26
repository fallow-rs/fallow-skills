# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Fixed

- The plugin commit gate audits more forms of a git commit or push. It reads `git` in any letter case (`GIT commit`), with the `.exe` suffix of Git for Windows (`git.exe push`) and as the last part of a path (`/usr/bin/git commit`).
- A git subcommand with an expansion, a brace or a glob (`git {commit,status}`, `git c{o,}mmit`, `git c?mmit`) counts as a possible commit or push. A command with an expansion, a brace, a glob or a backquote and a `commit` or `push` word (`G=git; $G commit`, `g?t push`) also counts. A command with an expansion and no such word (`echo $HOME`, `ls *.ts`) still skips the audit.
- The gate runs jq, tr and awk before it knows every write target, and grep before it knows every audited directory. It records the `PATH` directory of each of these helpers. When the tree of a target or an audited directory holds one, the gate blocks the command (exit 2) and names the target. The gate no longer runs `dirname`, and it runs `mktemp` and `rm` only after it knows every tree.
- The plugin commit gate runs the first `fallow` in an absolute `PATH` entry without a `node_modules` component. This rule applies in any letter case, before and after links. The entry and the physical path of that `fallow` are outside the session tree. They are also outside the tree of each write target and of each audited directory.
- The gate skips empty and relative `PATH` entries. It does not run `./node_modules/.bin/fallow`, `yarn exec fallow` or `npx --no-install fallow`.
- The gate skips a version-manager shim, because a shim can run the `fallow` that the project installs. A shim is a `fallow` in a directory named `shims`, in `.volta/bin` or in `volta/bin`. It is also a `fallow` in `$VOLTA_HOME/bin`, `$ASDF_DATA_DIR/shims` or `$MISE_DATA_DIR/shims` when the variable is set. These rules apply in any letter case, before and after links. A `fallow` whose physical name is `volta-shim` is also a shim.
- When no such `fallow` exists, the gate allows the command with a notice. The notice names a global install outside a version manager: `npm install -g fallow` or `cargo install fallow-cli`. When the gate skipped a shim, the notice also says so.
- The gate can now run a global `fallow` that has another version than the `fallow` that the project pins.
- The tree of a directory is the union of its git work tree top and the nearest directory with a `.git` entry. When git gives no answer for the session directory, the session tree is the nearest directory with a `.git` entry, or the session directory itself. When a tree is the home folder and the directory is below it, the tree is the directory, so tools under `~/.cargo/bin` stay in use. When the directory is `/`, or is the home folder outside git, the gate excludes only that one directory. When a command target or an audit root is the home folder, the gate excludes only the home folder itself. Path comparisons ignore letter case.
- The gate takes jq, git and its other helpers only from the `PATH` entries that the same rules keep. It filters `PATH` again before it runs a program for a new tree. It drops an entry whose physical path holds a colon.
- A command target can hold a `~`, `$HOME` or `${HOME}` component. Then the gate excludes and audits the literal path and also the path below the home folder.
- A relative `cwd` in the hook input is relative to the directory of the gate process.
- The tree of a write target or of an audited directory can hold the only `fallow` or `git` that the rules keep without that tree. Then the gate blocks the command (exit 2) before any audit, with a message that names the target.
- A command that is not a git commit or push exits after a check that uses only shell builtins.
- The hook command runs the gate with `/bin/bash` when it exists, else with `/usr/bin/env bash`.
- Every git call of the plugin gate sets `safe.bareRepository=explicit`, so git uses a bare repository only when the command names it.

## [1.4.46] - 2026-10-24

### Fixed

- A push from a linked worktree of the session repository audits only that worktree when git shows that the push cannot send the session branch. Before, the gate also audited the session tree, so untracked build output in the session blocked every push from a clean worktree.
- The narrow rule needs all of these: the options are only `-u`, `-q`, `--set-upstream`, `--force-with-lease` and `--force-if-includes`. Each refspec source is the branch of the worktree, and that branch is not the session branch. A push without a refspec needs `push.default` unset or `simple`, `current`, `upstream` or `nothing`, and no remote `push` or `mirror` setting.
- Any other push from a linked worktree, and any git error during the check, audits the session tree too.
- The push allowlist accepts `--set-upstream`, `--force-with-lease` and `--force-if-includes` as exact words.

## [1.4.6] - 2026-10-09

### Fixed

- The commit gate also audits the tree that a git commit or push targets. Before, it audited only the session directory, so a finding in one worktree blocked a commit in another worktree.
- A command on a short allowlist audits only its target: `git -C <dir> commit|push <args>`, or `cd <dir> && git commit|push <args>`. The directory is a literal word inside a git work tree. The arguments are literal words, the options `-m`, `--message`, `-S`, `-q`, `-a`, `--amend`, `--no-edit` and `-u`, and a quoted message without `$`, backtick or backslash. A target without fallow needs no audit.
- Every other git commit or push audits the session directory plus each target that resolves. A fail verdict in any of them blocks the command.
- Git decides where a write lands. The gate asks `git rev-parse` for the work tree top, the git directory and the common git directory of the target and of the session. The target audit replaces the session audit only when the target is another repository. A push also needs another common git directory, because linked worktrees share refs.
- The loose scan reads a long command in linear time, so a command with 100k words stays inside the hook timeout.
- A gate that `fallow agent install` registered only covers the session tree. The plugin still audits other targets.

## [1.4.0] - 2026-04-09

### Changed

- Updated for fallow v2.25.0 (was v2.24.0)
- Added `large_functions` JSON output documentation for health command (drill-down for unit size penalty)
- Version badge updated to v2.25.0
- All JSON example version strings updated to v2.25.0

## [1.3.1] - 2026-04-07

### Changed

- Updated for fallow v2.19.0 (was v2.18.3)
- Version badge updated to v2.19.0

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

[1.4.0]: https://github.com/fallow-rs/fallow-skills/releases/tag/v1.4.0
[1.3.1]: https://github.com/fallow-rs/fallow-skills/releases/tag/v1.3.1
[1.3.0]: https://github.com/fallow-rs/fallow-skills/releases/tag/v1.3.0
[1.2.0]: https://github.com/fallow-rs/fallow-skills/releases/tag/v1.2.0
[1.1.0]: https://github.com/fallow-rs/fallow-skills/releases/tag/v1.1.0
[1.0.0]: https://github.com/fallow-rs/fallow-skills/releases/tag/v1.0.0
