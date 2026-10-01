---
description: Routing prompt. Codebase analysis belongs to the fallow skill.
expected_outcome: Claude selects the fallow skill and does not select fallow-setup.
tags: [trigger, routing]
max_turns: 6
timeout_seconds: 180
allowed_tools: [Read, Glob, Grep, Skill]
---

Find dead code and architecture problems.
