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

- Fallow app (Codex desktop): a local MCP server and MCP App in `codex-app/`.
  It adds the Fallow dashboard to the sidebar, a Code Health tab beside each
  thread, @Fallow mentions, a `.fallowrc.json` editor with an impact preview, a
  `.sarif` viewer, a branch audit, a cleanup form, and native settings. Its
  source is in [`codex-app/`](../codex-app/README.md) at the repository root.
- `fallow-codex-onboarding`: the setup skill that Codex runs after install.

Codex receives the skills, their referenced assets and the Fallow app. Codex
also loads the commit gate from `hooks/hooks.json` after you trust it. Claude
Code also discovers the optional statusline command; it does not load the
Fallow app, which only `.codex-plugin/plugin.json` declares. `fallow agent
install`, which the `fallow-setup` skill runs, registers the separate fallow MCP
server for each project. Fallow does not require a remote MCP server.

The OpenAI plugin directory takes skills-only plugins, so its ZIP leaves out the
Fallow app and the onboarding skill. `.codex-plugin/skills-only.json` sets the
listing text for that ZIP.

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
- The Fallow app runs the fallow CLI on the machine. It makes no network
  requests itself; only the `npx` fallback downloads the CLI. For a model tool
  call, and for the sidebar or thread tab after a model call in the same thread,
  it runs fallow inside the Codex sandbox of the thread. Outside the sandbox it
  never runs a fallow binary that the opened repository ships. It reads source
  lines only inside the project it analyzes. To open the right project in a
  thread tab, it reads the first line of that thread's Codex session log, which
  holds the working directory. It stores settings, recent projects and a
  thread-to-project map in the user state folder (`~/Library/Application
  Support/fallow` on macOS). The config impact preview writes a draft next to
  the config file for the length of two fallow runs, then deletes it.
- The statusline helper only writes after showing a preview and receiving
  explicit confirmation. It preserves the previous setting and refuses to
  overwrite later manual changes.

See the [Fallow privacy policy](https://fallow.tools/privacy) and
[plugin documentation](https://fallow.tools/plugins) for more information.
