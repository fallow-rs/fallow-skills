# Fallow public skills

This public repository owns portable end-user skills for the released Fallow
product. It does not own Fallow maintainer workflows, private cloud knowledge,
or public user documentation.

## Start here

- Skill content lives under `fallow/skills/`.
- `fallow/skills/fallow/` follows the pinned public product contract in
  `source-lock.json`.
- Agent-specific interface files may wrap a skill, but must not fork its
  authored instructions.
- Public user guidance belongs in
  [`fallow-rs/docs`](https://github.com/fallow-rs/docs).
- Open-source maintainer workflows belong in
  [`fallow-rs/fallow`](https://github.com/fallow-rs/fallow).

## Validation

Run:

```bash
node --test scripts/*.test.mjs
FALLOW_SOURCE_DIR=/path/to/pinned/fallow node scripts/check-source-contract.mjs
```

The source contract check fails closed when the pinned source is absent,
incorrect, or has drifted. Never copy private content or machine-local paths
into this repository.

Keep skills concise, use progressive disclosure through direct references, and
require a dry run before destructive Fallow operations.
