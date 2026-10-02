---
description: Routing prompt. A pull request review belongs to the fallow-review skill.
expected_outcome: Claude selects fallow-review and does not select fallow-setup.
tags: [trigger, routing]
max_turns: 6
timeout_seconds: 180
allowed_tools: [Read, Glob, Grep, Skill]
---

Review this PR.
