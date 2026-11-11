---
description: Open the Fallow code health dashboard for this project
argument-hint: "[changed] [path]"
---

# Fallow dashboard

Arguments: `$ARGUMENTS`

Show the Fallow code health dashboard for the project of this session.

1. Call the `fallow_analyze` tool of the Fallow app. When the arguments contain
   `changed`, pass `scope: "changed"`. When they contain a folder, pass it as
   `path`. Pass nothing else.
2. When the result has `needsProject`, ask the user which folder to analyze.
   Offer the `recentProjects` of the result.
3. When the result reports `fallow_not_found`, tell the user both fixes: install
   fallow with `npm install --global fallow`, or let the app download the
   pinned fallow release with npx. Only after the user agrees to npx, call
   `fallow_settings_update` with `{ "set": { "source": "npx" } }`, then call
   `fallow_analyze` again.
4. Summarize the score, the grade and the three findings to fix first. Each
   finding has a `verify` command: run it before you change code.

When the `fallow_analyze` tool is not available in this session, say that the
Fallow app is not loaded here, and use the `fallow` skill instead.
