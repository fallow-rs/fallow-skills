# Codex manual activation checklist

Codex has no plugin eval runner. Use this checklist to test the same prompt
matrix as the Claude suite in this directory by hand.

## Preparation

1. Install the Fallow plugin in Codex from this repository.
2. Make sure that the plugin contains the `fallow-setup` skill.
3. Start a new Codex session for each prompt. Do not name Fallow in the prompt.
4. For the outcome run, copy `fixtures/ts-app/` to a new directory, run
   `git init`, and commit the files. Put a `fallow` binary on `PATH`.

## Activation matrix

Record the skill that Codex loads for each prompt. A prompt passes when the
result agrees with the expected skill.

| Prompt | Expected skill | Must not load | Result |
| --- | --- | --- | --- |
| Set up quality tooling for this new TypeScript repo. | `fallow-setup` | | |
| Make this Next app agent-ready. | `fallow-setup` | | |
| Add a code-health gate to CI. | `fallow-setup` | | |
| Replace Knip and dependency-cruiser. | `fallow-setup` | | |
| Audit this PR. | `fallow-review` | `fallow-setup` | |
| Find dead code and architecture problems. | `fallow` | `fallow-setup` | |
| Format this file. | none | `fallow-setup` | |
| Fix this TS2345 error. | none | `fallow-setup` | |
| Configure an Oxlint rule. | none | `fallow-setup` | |
| Why did Oxfmt wrap this line? | none | `fallow-setup` | |

## Setup outcome run

Use this prompt in the fixture copy:

> Set up quality tooling for this TypeScript repo. I want it ready for coding
> agents and I want a code-health check in CI. Do not ask me questions, use
> sensible defaults.

Check each item after the run:

- [ ] Codex detects pnpm and uses it. It does not install with npm, yarn or bun.
- [ ] `package.json` keeps `oxlint` and `oxfmt`.
- [ ] `.oxlintrc.json` and `.oxfmtrc.json` keep their settings.
- [ ] Codex runs `fallow recommend` before it writes a config.
- [ ] Codex runs `fallow agent install` after `fallow recommend`.
- [ ] A new workflow under `.github/workflows/` runs fallow.
- [ ] Codex does not install Knip or dependency-cruiser, and `package.json`
      does not list them.

## Record the result

Write down the Codex version, the model, the date, and the plugin version.
Repeat each prompt three times, because one run gives a weak signal.
