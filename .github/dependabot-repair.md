# Dependabot repair notes for fallow-skills

The org-wide Dependabot workflow in `fallow-rs/.github` reads the `main` copy
of this file when it repairs a failed Dependabot pull request in this
repository. Its generic rules are in `dependabot/instructions.md` there. This
file adds what is specific to fallow-skills.

## Rules

1. Add no sign-off or co-author lines. The App is the author of the commit,
   and the DCO check does not run on Dependabot pull requests.
2. Use a conventional commit subject of at most 100 characters.

## Codex app

The source of the Codex app is in `codex-app/`. Its build is committed in
`fallow/codex-app/`, and CI fails when that build is out of date. A change in
`fallow/` also needs a new plugin version.

After a change in `codex-app/`:

1. In `codex-app/`, run `npm ci --ignore-scripts`, then `npm run check`.
   This runs the type check, the build and the tests.
2. Commit the new files in `fallow/codex-app/`.
3. Raise the patch version by one in all four places:
   `fallow/.claude-plugin/plugin.json`, `fallow/.codex-plugin/plugin.json`
   and the two `version` fields in `.claude-plugin/marketplace.json`. The four
   values must be equal.

In the three manifest files, change only `version` lines. Any other change in
them needs a review.
