# Shared agent view for the Codex app and the Claude Code mod

Status: shared core and the Codex Production section are built. The Claude Code
hook and status line are built and tested, but do not ship in the plugin yet:
Codex reads the same `hooks/hooks.json` and refuses the `modules` key (see
"Compatibility of the `modules` key"). The pane comes in a later release.

## Goal

Give the coding agent and the person the same file view in two hosts:

- the Fallow app for Codex (in `codex-app/`),
- the Fallow mod for Claude Code (in `claude-mod/`, not shipped yet).

A file view joins two kinds of data:

- **Static findings** from the local fallow CLI. This part is free and works with no account.
- **Production data** from Fallow Cloud: calls, errors, CPU time and never-run ranges per
  function. This part needs a Fallow Cloud key. Without a key, the view shows the static part and
  a status line.

## Decisions

1. **The fallow CLI joins the data. The hosts only run the CLI.** The CLI reads Fallow Cloud
   (`GET /v1/coverage/:repo/file-context`), pairs the local functions with the deployed ones and
   writes one result. The key rules, the repo rules and the network code stay in one place, and
   the terminal, CI and MCP get the same output. A host never calls Fallow Cloud itself.
2. **The join is an evidence section of `fallow inspect`.** `fallow inspect --file <path> --cloud`
   adds the `cloud` section. A missing key, a plan gate or a network failure is a section status
   (`no_key`, `plan_required`, `unavailable`, `untracked`), never a failed run.
3. **One agent text.** `fallow inspect --file <path> --format compact` gives about 1 KB of plain
   text per file: one line per finding and one line per function with production data. The CLI
   writes it. The hosts give it to the agent as it is, so the agent reads the same words in Codex
   and in Claude Code.
4. **Pairing.** A local function pairs with a deployed one by `stable_id`, then by name plus
   ordinal. An unpaired function shows `no production data (new or moved since deploy)`.
5. **The key comes from `fallow cloud login`.** The device login mints a read-only key
   (`fallow_read_k1_`) for one user, org and machine. The CLI keeps it in the OS keychain, or in
   `~/.config/fallow/credentials` (mode 0600). `--api-key` and `FALLOW_API_KEY` still win. No host
   stores a key, so the hosts have no key setting.
6. **No pane in this release.** The Claude Code mod has the hook and a status line entry. The
   pane comes later.

The cross-repo contract (cloud device flow, CLI flags, JSON and text shapes) is in the session
notes of this work, part A to C.

## Why the UI is not shared

- The Codex app draws an MCP App: a web view with Preact and the OpenAI MCP extensions.
- A Claude Code mod has no DOM. It draws with the elements that each surface supplies.

So a component cannot run in both hosts. A view model can.

## Layers

| Layer | Shared | Contents |
|---|---|---|
| 1. Core (`agent-view/`) | Yes | Pure TypeScript. Contracts, static normalization, the view model of the inspect JSON and the reader of the compact text. No `node:` import. |
| 2. Run the CLI | No | Each host runs `fallow inspect` its own way. |
| 3. Host | No | UI, events, install and settings of each host. |

### 1. Core: `agent-view/`

- `contracts.ts`, `categories.ts`: `Finding`, `Report`, `AuditResult`, `FallowProblem`, the
  category order, titles, colors and glyphs. Codex-only payloads (`ViewPayload` and the app tool
  results) stay in `codex-app/src/shared/contracts.ts`.
- `json.ts`, `rules.ts`, `normalize.ts`, `summary.ts`: the static normalization that the Codex app
  had. `path.ts` replaces `node:path`, because a mod has no `node:` modules.
- `production.ts`: reads the inspect JSON. `readInspect` gives the file, the static section
  statuses and a `ProductionView`. A value that the cloud did not measure stays `null`, and no
  host shows it as zero. A non-ok status gives a status sentence and no numbers.
  `productionFromProblem` turns a failed run into `cli_unsupported` (a fallow release without
  `--cloud`) or `cli_failed`. `productionLines` gives the `prod` and `cloud` lines with the words
  of the compact format.
- `compact.ts`: reads the compact text for counts. `compactStatusLine` gives one short line for a
  status bar.
- `fixtures/`: one inspect JSON and the matching compact text per case: `ok`, `unpaired`,
  `no-key`, `untracked`, `plan-required`. The core tests hold `productionLines` of each JSON
  equal to the `prod` and `cloud` lines of its text. The Codex app tests and the mod tests read
  the same files.

### 2. Run the CLI

| Host | How it runs `fallow inspect` |
|---|---|
| Codex app | `runFallow` in `fallow-cli.ts`, with `--format json`. App calls run the fallow on PATH outside the sandbox, like `fallow explain`. |
| Claude Code mod | `$.process.run` with `--format compact` and a 2 s timeout. |

### 3. Hosts

**Codex app.**

- Imports the core from `agent-view/`. esbuild bundles it into `fallow/codex-app/`.
- The app-only tool `fallow_app_production` runs
  `fallow inspect --file <path> --cloud --format json --quiet` for a file of the newest report and
  keeps the answer for 60 s.
- The finding detail has a **Production** section, in the dashboard, the Code Health tab, the
  audit and the single finding view. It lists each function of the file with its production
  line, the function of the finding first. A non-ok status shows its sentence and, where one
  exists, the command that fixes it (`fallow cloud login`, or an update of fallow).

**Claude Code mod.**

- `claude-mod/src/fallow-mod.ts` is the hooks module. `npm run build` copies it to
  `claude-mod/dist/hooks/fallow-mod.ts` and bundles `claude-mod/src/view.ts` with the core into
  `claude-mod/dist/hooks/fallow-view.mjs`. Claude Code reads a hooks module as source, so the
  module is copied, not bundled.
- The plan was to name the module under `modules` in `fallow/hooks/hooks.json`, next to the
  commit gate. Codex refuses that key, so `fallow/hooks/hooks.json` keeps only `hooks`, and the
  mod waits for a decision on where it ships.
- A `tool.call` hook on `Read`, `Edit` and `Write` of a source file runs
  `fallow inspect --file <path> --cloud --format compact --quiet` after the tool and adds the
  output to the tool result. The budget is 2 s. A failed start, a timeout, a non-zero exit or
  empty output adds nothing, and the tool result stays as it was.
- The same hook sets a status line entry, for example
  `fallow user.ts: 2 findings | prod 1 called, 1 never_called`.

## Compatibility of the `modules` key

Checked in a temporary HOME (Claude Code) and a temporary CODEX_HOME (Codex), with a probe plugin
and with the `fallow` plugin:

| Host | `modules` in `hooks/hooks.json` |
|---|---|
| Claude Code 2.0.77, 2.1.100, 2.1.200 | Ignored. The commit gate loads. |
| Claude Code 2.1.250 | Ignored by a rollout flag. The commit gate loads. |
| Claude Code 2.1.280, 2.1.290, 2.1.312 | The module loads next to the commit gate. |
| Codex 0.164.0 | Refused: `unknown field 'modules', expected 'description' or 'hooks'`. Codex then loads no hook of the plugin, so the commit gate is lost. |

A second hooks file that only the Claude manifest names (`"hooks": "./hooks/mod-hooks.json"` in
`.claude-plugin/plugin.json`) keeps Codex safe, but Claude Code 2.1.200 then fails to load the
plugin (`hook-load-failed`). A separate Claude-only plugin avoids both problems.

Claude Code 2.0.77 and 2.1.100 also refuse the `displayName` key of the `fallow` plugin manifest.
That is older than this work and does not come from `modules`.

## Tests

- `agent-view/test/`: the view model, the compact reader, the path helper, and a check that no
  core source imports a `node:` module. They run in `npm test` of `codex-app/`.
- `codex-app/test/production.test.ts`: the production loader with a fake runner and the fixtures.
  `server.test.ts` calls `fallow_app_production` on the built server with the real fallow: a
  release without `--cloud` gives `cli_unsupported`.
- `claude-mod/test/mod.test.ts`: `claude plugin test` over the `terminal` and `desktop` surfaces
  with a fake `process.run` that gives the fixture text, a non-zero exit, empty output or a
  timeout. `npm test` in `claude-mod/` stages the plugin with `modules` added to a copy of
  `hooks.json`, and runs `claude plugin validate` and `claude plugin test`. It needs Claude Code, so CI runs only the typecheck and the build check.

## Open questions

1. **Where the mod ships.** Options: a separate Claude-only plugin in the same marketplace, a
   second hooks file named only in `.claude-plugin/plugin.json` (breaks Claude Code 2.1.200), or
   `hooks/hooks.json` after Codex accepts unknown keys.
2. **Hook script.** The hand-written PostToolUse script of Fallow Cloud
   (`scripts/agent-hooks/fallow-file-context.ts`) does the same job for users without mods.
   Decide when to retire it.
3. **The pane.** A pane with the file view of the last file that the agent read or edited, in a
   later release.
4. **Sandbox and keychain in Codex.** App calls run outside the Codex sandbox, so the CLI can read
   the keychain and reach Fallow Cloud. A model call inside the sandbox would give `unavailable`
   when the sandbox blocks the network.
