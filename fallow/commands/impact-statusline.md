---
description: Show or configure the compact Fallow Impact statusline in Claude Code
argument-hint: status|setup|remove [user|project] [replace|compose]
allowed-tools: Bash(node:*)
---

# Fallow Impact statusline

Arguments: `$ARGUMENTS`

Manage Fallow's branded, compact Impact segment for Claude Code. Never enable
Impact on the user's behalf.

## Parse the request

- Action: `status`, `setup`, or `remove`. Default to `status`.
- Scope: `user` or `project`. Default to `user`.
- Mode for setup: `replace` or `compose`.
- `project` means the private, gitignored `.claude/settings.local.json` in
  `${CLAUDE_PROJECT_DIR}`. Never edit the shared `.claude/settings.json`.

Use this helper:

```text
node "${CLAUDE_PLUGIN_ROOT}/bin/fallow-impact-statusline.mjs"
```

Always pass `--root "${CLAUDE_PROJECT_DIR}"` and the selected `--scope`.

## Status

Run `inspect` and report:

- the exact preview;
- whether a statusline already exists;
- whether Fallow already manages it;
- the settings scope and path.

Do not modify files.

## Setup

1. Run `inspect` first and show the exact preview.
2. If no statusline exists, use `replace`.
3. If a command-based statusline exists and no mode was supplied, ask whether
   to `compose` with it or `replace` it. Recommend `compose`.
4. If a non-command statusline exists and no mode was supplied, explain that it
   cannot be composed and ask whether to `replace` it.
5. Only after that decision, run `install` with `--mode <mode> --confirm`.
6. Report the settings path and tell the user the statusline appears on the
   next Claude interaction.

The helper preserves the previous setting and refuses to overwrite later
manual changes. If the preview says `fallow impact  off`, tell the user they may
run `fallow impact enable` themselves. Do not run it.

## Remove

Run `remove --confirm`. The helper restores the exact previous statusline when
Fallow still owns the configured value. If the setting changed after setup, it
refuses the removal instead of overwriting the user's newer configuration.

## Command forms

```text
node "${CLAUDE_PLUGIN_ROOT}/bin/fallow-impact-statusline.mjs" inspect --scope user --root "${CLAUDE_PROJECT_DIR}"
node "${CLAUDE_PLUGIN_ROOT}/bin/fallow-impact-statusline.mjs" install --scope user --root "${CLAUDE_PROJECT_DIR}" --mode compose --confirm
node "${CLAUDE_PLUGIN_ROOT}/bin/fallow-impact-statusline.mjs" remove --scope user --root "${CLAUDE_PROJECT_DIR}" --confirm
```
