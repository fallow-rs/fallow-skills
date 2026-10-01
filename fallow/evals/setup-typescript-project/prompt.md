---
description: Setup outcome run on a small pnpm TypeScript project with Oxlint and Oxfmt.
expected_outcome: >-
  Claude uses fallow-setup, keeps pnpm, Oxlint and Oxfmt, runs fallow recommend
  before fallow agent install, adds a CI workflow that runs fallow, and does not
  add Knip or dependency-cruiser.
tags: [outcome, setup]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Bash, Write, Edit]
---

Set up quality tooling for this TypeScript repo. I want it ready for coding agents and I want a code-health check in CI. Do not ask me questions, use sensible defaults.
