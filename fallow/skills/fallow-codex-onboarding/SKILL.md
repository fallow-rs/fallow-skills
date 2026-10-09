---
name: fallow-codex-onboarding
description: >-
  Set up the Fallow app in Codex after the plugin is installed: check the
  fallow installation, choose the default analysis scope, run the first
  analysis, and show the user where the dashboard, the Code Health tab,
  @Fallow mentions and the config editor are. Use when the user chooses Set
  up for Fallow in Codex, or asks to onboard or configure the Fallow app.
  Do not use for setting up lint, format or CI tooling; use fallow-setup for
  that.
---

# Set up Fallow in Codex

Use the Fallow app tools. Keep each step short. Ask one question at a time.

## 1. Check the installation

Call `fallow_check_install` with `{}`.

- If it reports a version, continue.
- If fallow is missing, explain that the app runs the fallow CLI locally and
  that no code leaves the machine. Offer to install it globally with
  `npm install --global fallow`. The sidebar dashboard needs a fallow on PATH,
  because the app runs a copy inside the project only within the Codex sandbox
  of a thread. Run the install only after the user agrees. Then call
  `fallow_check_install` again.

## 2. Choose the defaults

Call `fallow_settings_read` with `{}`. Ask these questions, one at a time.
Skip a question when the user already answered it.

1. "Analyze the whole project by default, or only the files your branch
   changed?" Map the whole project to `scope: "full"` and changed files to
   `scope: "changed"`.
2. "Leave tests, stories and dev tooling out of the analysis?" Map yes to
   `production: true`.

Call `fallow_settings_update` with a `set` object that holds only the changed
values, for example `{"set":{"scope":"changed"}}`. Skip the call when nothing
changed. Report the saved values from the tool result. Do not say that a value
was saved when the call failed.

## 3. Run the first analysis

Call `fallow_analyze` with `{}`. The user sees the dashboard. In two or three
sentences, give the health score, the largest category of findings, and one
finding to start with.

If the result says that no project is known, ask the user to open a project
folder in this thread, then call `fallow_analyze` again.

## 4. Show what the app adds

Tell the user, in a short list:

- **Fallow** in the sidebar opens the full dashboard.
- **Code Health** opens beside a thread and follows the project of that thread.
- Type **@Fallow** in the composer to attach a finding or all findings of a rule.
- Open `.fallowrc.json` or `.fallowrc.jsonc` to edit rules and preview their
  impact before saving. `.sarif` files open in a findings viewer.
- Before a commit, ask Codex to audit the branch.

## 5. Offer the next step

If the project has no fallow config file (`.fallowrc.json`, `.fallowrc.jsonc`,
`fallow.toml` or `.fallow.toml`), offer the `fallow-setup` skill to add one and
a CI gate. If the user installed the plugin during another task, continue that
task in this conversation.
