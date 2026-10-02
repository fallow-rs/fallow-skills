---
description: Routing prompt. A pull request audit runs fallow audit, which the fallow skill owns.
expected_outcome: Claude selects the fallow skill and does not select fallow-setup.
tags: [trigger, routing]
max_turns: 6
timeout_seconds: 180
allowed_tools: [Read, Glob, Grep, Skill]
---

Audit this PR.
