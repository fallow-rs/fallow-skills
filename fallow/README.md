# Fallow Code Analysis

Fallow provides local-first codebase intelligence for TypeScript and
JavaScript.

## Included surfaces

- `fallow`: static analysis, changed-code risk, cleanup, architecture, styling,
  runtime evidence, and local Impact summaries.
- `fallow-review`: graph-grounded review of changed code and structural risk.
- `fallow-setup`: sets up code-quality tooling for a JavaScript or TypeScript project and adds Fallow, the agent integration, and a CI gate.
- `impact-statusline`: an optional Claude Code command that previews and manages
  a local statusline setting.
- Commit gate: a Claude Code `PreToolUse` hook that runs
  `fallow audit --format json --quiet --explain --gate-marker agent` before
  `git commit` and `git push`, and blocks the command on a `fail` verdict. It
  runs only in a project that chose fallow: a `.fallowrc.json`,
  `.fallowrc.jsonc`, `fallow.toml` or `.fallow.toml` file, or a `fallow`
  dependency in `package.json`. It audits the nearest such directory above
  the session directory. It does nothing when `fallow agent install` already
  registered its own gate for Claude Code or Codex. A
  missing fallow binary, a missing jq or a fallow version below 2.85.0 allows
  the command with a notice. Set `FALLOW_PLUGIN_GATE=off` in the environment
  of Claude Code to turn it off.

Codex receives the skills and their referenced assets. Codex also loads the
commit gate from `hooks/hooks.json` after you trust it. Claude Code also
discovers the optional statusline command. The plugin bundles no MCP server:
`fallow agent install`, which the `fallow-setup` skill runs, registers the
local fallow MCP server for each project. Fallow does not require a remote MCP
server.

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
