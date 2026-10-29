# Fallow public skills

This public repository owns portable end-user skills for the released Fallow
product. It does not own Fallow maintainer workflows, private cloud knowledge,
or public user documentation.

## Start here

- Skill content lives under `fallow/skills/`.
- Each skill listed in `source-lock.json` follows the pinned public product
  contract. The lock has one entry per released Fallow skill. Each entry has a
  source root, a target root, and transforms.
- Skills that the lock does not list, such as `fallow-review`, belong to this
  repository. The source contract check ignores them.
- Agent-specific interface files may wrap a skill, but must not fork its
  authored instructions.
- `codex-app/` holds the source of the Fallow app for Codex: an MCP server and
  an MCP App that use the OpenAI MCP extensions. `npm run build` there writes
  the bundled output to `fallow/codex-app/`, which is committed because a
  plugin install runs no build step. CI rebuilds it and fails on a difference.
  Never edit `fallow/codex-app/` by hand. See `codex-app/README.md`.
- `agent-view/` holds the TypeScript core that the Codex app and the Claude
  Code mod share: contracts, normalization, the view model of
  `fallow inspect --cloud`, and one fixture set. It imports no `node:` module.
  `npm test` in `codex-app/` runs its tests.
- `claude-mod/` holds the source of the Fallow mod for Claude Code. It does not
  ship in the plugin yet, because Codex refuses the `modules` key in
  `fallow/hooks/hooks.json`. `npm test` there needs Claude Code; it runs
  `claude plugin validate` and `claude plugin test` on a staged copy.
- The OpenAI directory submission stays skills-only.
  `fallow/.codex-plugin/skills-only.json` tells `scripts/plugin_release.py`
  which manifest fields and skills to leave out of that ZIP.
- Public user guidance belongs in
  [`fallow-rs/docs`](https://github.com/fallow-rs/docs).
- Open-source maintainer workflows belong in
  [`fallow-rs/fallow`](https://github.com/fallow-rs/fallow).

## Validation

Run:

```bash
node --test scripts/*.test.mjs
python3 -m unittest discover -s scripts -p 'test_*.py'
python3 scripts/validate_skill_frontmatter.py .
(cd codex-app && npm ci && npm run check)
(cd claude-mod && npm ci && npm run check && npm test)
FALLOW_SOURCE_DIR=/path/to/pinned/fallow node scripts/check-source-contract.mjs
```

The source contract check fails closed when the pinned source is absent,
incorrect, or has drifted. Never copy private content or machine-local paths
into this repository.

Keep skills concise, use progressive disclosure through direct references, and
require a dry run before destructive Fallow operations.
