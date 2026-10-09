# Fallow app for Codex

The Fallow app brings Fallow code health into the Codex desktop app. It is a
local MCP server with one MCP App, built on the
[OpenAI MCP extensions](https://github.com/openai/mcp-extensions). The `fallow`
plugin in this repository bundles it, so a marketplace install adds it with no
extra setup:

```bash
codex plugin marketplace add fallow-rs/fallow-skills
codex plugin add fallow@fallow-skills
```

The app runs the [fallow CLI](https://github.com/fallow-rs/fallow) on your
machine. It sends no code anywhere.

## What you get

| Surface                     | What it does                                                                                                                                         |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Fallow** in the sidebar   | A full-screen dashboard: health score and grade, findings per category, refactoring targets, hotspots and next steps. Remembers recent projects.     |
| **Code Health** thread tab  | The same dashboard beside a conversation, for the project of that thread.                                                                            |
| Inline results              | Ask "how healthy is this code?" and Codex shows a compact card that opens full screen.                                                              |
| Branch audit                | Pass, warn or fail for the changes of the branch, with the findings that the branch introduced separated from the ones it inherited.               |
| Finding detail              | The code around the finding, a read-only command that verifies it, fix options, and the rule explanation.                                          |
| Composer attachments        | Select findings to attach them to the composer as labeled chips. Remove a chip and the selection follows.                                          |
| **Fix with Codex**          | Sends the selected findings to the active thread, or to a new thread.                                                                               |
| **@Fallow** mentions        | Search findings while you type. A mention gives Codex the finding with its evidence and verify command, or all findings of one rule.               |
| Cleanup planner             | A form: pick a category from image tiles, then the findings (each with a preview), the approach and your constraints.                              |
| `.fallowrc.json` editor     | Opens `.fallowrc.json` and `.fallowrc.jsonc` with a severity control per rule, list editors, and the source. Keeps comments. Previews the impact.   |
| `.sarif` viewer             | Opens any SARIF 2.1.0 report, from fallow or another analyzer, with filters, file links and composer attachments.                                  |
| Settings                    | Native controls on the plugin page: default scope, base branch, production mode, fallow binary, sandbox, and how many findings Codex reads.        |
| Setup                       | The `fallow-codex-onboarding` skill checks the installation, asks for defaults and runs the first analysis.                                        |

## How it uses the OpenAI MCP extensions

| Extension                                                                                                  | Where                                                                                                                                                       |
| ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Global entrypoint](https://github.com/openai/mcp-extensions/blob/main/docs/spec.md#global-entrypoint)     | `fallow_dashboard`, with an **Audit this branch** quick action.                                                                                            |
| [Deep links](https://github.com/openai/mcp-extensions/blob/main/docs/spec.md#deep-links)                   | `codex://plugins/fallow@fallow-skills/app/fallow_dashboard?path=%2Ffindings%3Fcategory%3Ddead-code` opens the dead code findings. `/finding/<id>` and `/insights` work too. |
| [Thread entrypoint](https://github.com/openai/mcp-extensions/blob/main/docs/spec.md#thread-entrypoint)     | `fallow_code_health`, titled **Code Health**.                                                                                                              |
| [File entrypoints](https://github.com/openai/mcp-extensions/blob/main/docs/spec.md#file-extension-entrypoint) | `fallow_open_config` for `.fallowrc.json` and `.fallowrc.jsonc`, `fallow_open_sarif` for `.sarif`.                                                     |
| Resource reads, writes and subscriptions                                                                   | The config editor reads with `representation: "text"`, saves with `ifMatch` and handles `conflict` and `too-large`, and reloads when the file changes. |
| Trusted file paths                                                                                         | The config preview and the SARIF file links use `_meta["openai/resource"].path` to find the opened file on disk.                                         |
| [Structured settings](https://github.com/openai/mcp-extensions/blob/main/docs/spec.md#structured-settings) | Six native settings in three groups, plus an **Open Fallow** app button and a **Check installation** tool button.                                         |
| [Display modes](https://github.com/openai/mcp-extensions/blob/main/docs/spec.md#display-modes)             | Model results start inline; every view adapts to inline, the narrow thread tab and full screen.                                                          |
| [Plugin onboarding](https://github.com/openai/mcp-extensions/blob/main/docs/spec.md#plugin-onboarding)     | `extensions["com.openai"].onboardingSkill` points at `fallow-codex-onboarding`.                                                                            |
| [Model context](https://github.com/openai/mcp-extensions/blob/main/docs/spec.md#uiupdate-model-context-extensions) | Titled chips per finding, an assistant-only block with the project root, and two-way sync through `hostContext["openai/modelContext"]`.          |
| [Messages](https://github.com/openai/mcp-extensions/blob/main/docs/spec.md#uimessage-extensions)           | **Fix with Codex** sends titled items; **New chat** uses `target: "new"` on the desktop.                                                                 |
| [Opening local files](https://github.com/openai/mcp-extensions/blob/main/docs/spec.md#opening-local-files) | **Open file** on a finding, a file group or a SARIF result.                                                                                              |
| [Composer mentions](https://github.com/openai/mcp-extensions/blob/main/docs/spec.md#composer-at-mentions)  | Findings and rule groups as `fallow://` resources with category icons.                                                                                   |
| [Form elicitation](https://github.com/openai/mcp-extensions/blob/main/docs/spec.md#openai-form-elicitation) | Thumbnails, option descriptions, explicit multi-select of resources with previews, suggested values, and a directory picker for projects.              |
| Shared styles                                                                                              | `@openai/mcp-extensions/app/styles.css` and the host style variables, so the app follows the Codex theme.                                               |

Two Codex host features matter as much as the extensions:

- The server declares the `codex/sandbox-state-meta` capability. Codex then
  sends the sandbox state of the thread with each model tool call. The server
  reads the working directory from it, and runs fallow through
  `codex sandbox --sandbox-state-json <state> -- fallow ...`, with the state
  forwarded unchanged.
- Calls from the sidebar and the thread tab carry only a thread id. The server
  maps it to a project from an earlier model call in that thread, or from the
  first line of the Codex session log of the thread.

Codex gives the model the `structuredContent` of a tool result and drops
`content` when both exist. So `structuredContent` holds a compact summary for
the model (score, totals, the top findings with verify commands), and the full
view for the app travels in `_meta["fallow/view"]`, which the model does not
read.

## Known host behavior

These come from Codex itself, not from the app:

- **Forms in Full access.** When a thread runs in Full access mode, Codex declines MCP forms
  without showing them. The cleanup planner and the project picker detect the instant decline:
  the model hears that the form was not shown, and the app shows a notice. Use Default
  permissions for the forms.
- **`.fallowrc.json` opens in the built-in viewer.** Codex keeps its own JSON viewer as the
  default. Choose **Fallow Config** under Settings, File type handlers, for `.fallowrc.json` and
  `.fallowrc.jsonc`. `.sarif` files open in the Fallow viewer by default.
- **Mentions before the first message.** In a new thread, the composer has no thread yet, so
  **@Fallow** lists the findings of the last analyzed project and names it. After the first
  message, mentions follow the project of the thread.

## Layout

```text
codex-app/
  src/server/   MCP server: tools, forms, mentions, resources, settings, the fallow runner
  src/app/      MCP App: one Preact app that renders every view
  src/shared/   Contracts and category metadata used by both
  scripts/      build.mjs and the local harness
  test/         node:test suites, with fixtures from a small demo project
fallow/codex-app/   Build output: server.mjs, app.html, mcp.json (committed)
```

The plugin ships the build output because a plugin install runs no build step.
`fallow/codex-app/mcp.json` starts `node ./codex-app/server.mjs` from the
plugin root, so the app needs Node.js 20 or later on PATH.

## Develop

```bash
cd codex-app
npm ci
npm run check        # typecheck, build into ../fallow/codex-app, test
npm run harness -- /path/to/a/project --sarif report.sarif
```

The harness serves a stand-in host at http://localhost:4517. It embeds the
built app the way Codex does, forwards tool calls to the real server over
stdio, answers forms with their defaults, and logs every composer attachment
and message that the app sends. Use it for the sidebar, the narrow thread tab,
inline results, audits, the config editor and the SARIF viewer, in light and
dark themes.

To try a build in the Codex desktop app, add a local marketplace that points at
a copy of `fallow/` under another marketplace name, then install
`fallow@<that name>`. Codex caches a plugin by version, so reinstall after each
build.

Commit the build output with the source change. CI rebuilds it and fails when
the committed files differ.

## Security notes

The threat model: you open a repository you do not trust, its content can steer the model, and
the app iframe runs inside the Codex host.

- **Which fallow runs.** Code that the repository controls runs only inside the Codex sandbox of
  the thread: its own `node_modules/.bin/fallow`, or `npx` (pinned to `fallow@3`, run from a temp
  folder with `--root`, so a repository `.npmrc` cannot redirect the install). Outside the sandbox
  the app runs only a fallow on your PATH, and skips PATH entries inside the project.
- **Whose sandbox state counts.** Only the model-only tools (`fallow_analyze`, `fallow_audit`,
  `fallow_plan_cleanup`) read `codex/sandbox-state-meta` from the call, and only when
  `codexExecutable` is an absolute path to `codex`. Every tool that the app iframe can call goes
  through `appFacing`, which removes that state; those tools use the state that a model call in
  the same thread stored in memory.
- **Which folders.** In a thread, a folder argument from the model stays inside the working
  directory of the thread. App-facing tools accept only a project that a server call already
  resolved, or that you picked in the project form.
- **Which files.** `fallow_app_source` reads lines only from files that the newest report names,
  and checks the real path after it resolves symbolic links. `fallow_app_locate` only returns
  paths inside the project or the folder of the opened file.
- **What fallow gets.** The child process gets an allowlist of environment variables (`PATH`,
  `HOME`, locale, temp, proxy and certificate variables, `GIT_*`, `FALLOW_*`), so tokens in the
  Codex environment stay out of it. On Windows, a `.cmd` shim never receives an argument with a
  cmd.exe metacharacter.
- **What the model reads.** Names and paths from the repository are cleaned of control
  characters and backticks and capped in length before they reach the model.
- **Settings.** The base branch must not start with `-`, so it can never become a flag. The binary
  setting is a fixed choice (`auto`, `project`, `path`, `npx`), never a free-form command.
- **Links.** The app opens only `https:` and `http:` links, whatever a SARIF file contains.
- The config preview writes the draft next to the config file, so relative `extends` paths
  resolve the same way, and deletes it after the run.
