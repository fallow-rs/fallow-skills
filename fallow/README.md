# Fallow Code Analysis

Fallow provides local-first codebase intelligence for TypeScript and
JavaScript.

## Included surfaces

- `fallow`: static analysis, changed-code risk, cleanup, architecture, styling,
  runtime evidence, and local Impact summaries.
- `fallow-review`: graph-grounded review of changed code and structural risk.
- `impact-statusline`: an optional Claude Code command that previews and manages
  a local statusline setting.
- Commit gate: a Claude Code `PreToolUse` hook that runs
  `fallow audit --format json --quiet --explain --gate-marker agent` before
  `git commit` and `git push`, and blocks the command on a `fail` verdict. It
  does nothing when `fallow agent install` already registered its own gate. A
  missing fallow binary or a missing jq allows the command with a notice. Set
  `FALLOW_PLUGIN_GATE=off` to turn it off.
- Local MCP server: Claude Code starts `fallow-mcp` from the project
  `node_modules/.bin`, from `PATH`, or as `fallow mcp-server`. When none of
  these exist, the server does not start and the skills continue to work.

Codex receives the skills and their referenced assets. Claude Code also
discovers the optional statusline command, the commit gate, and the local MCP
server. Fallow does not require a remote MCP server.

`evals/` holds the activation and setup eval suite. See
[evals/README.md](evals/README.md).

## Privacy and network behavior

- Analysis and Impact summaries run locally by default.
- Installing or invoking Fallow through `npm`, `npx`, or `cargo` may download
  the Fallow CLI.
- Product telemetry is off by default and never collects source code, paths,
  or project names. The plugin never enables it, only the user may opt in, and
  `fallow telemetry disable` turns it off again.
- Cloud commands make network requests only after the user explicitly requests
  them and configures the required credentials.
- The statusline helper only writes after showing a preview and receiving
  explicit confirmation. It preserves the previous setting and refuses to
  overwrite later manual changes.

See the [Fallow privacy policy](https://fallow.tools/privacy) and
[plugin documentation](https://fallow.tools/plugins) for more information.
