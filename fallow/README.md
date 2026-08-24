# Fallow Code Analysis

Fallow provides local-first codebase intelligence for TypeScript and
JavaScript. It includes skills for whole-project analysis and graph-grounded
review, plus an optional Claude Code command for a compact Fallow Impact
statusline.

## Included surfaces

- `fallow`: static analysis, changed-code risk, cleanup, architecture, styling,
  runtime evidence, and local Impact summaries.
- `fallow-review`: graph-grounded review of changed code and structural risk.
- `impact-statusline`: an optional Claude Code command that previews and manages
  a local statusline setting.

Codex receives the two skills and their referenced assets. Claude Code also
discovers the optional statusline command. Fallow does not require a remote MCP
server.

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
