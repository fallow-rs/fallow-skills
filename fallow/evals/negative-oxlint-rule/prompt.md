---
description: Negative activation prompt. The task is formatting, lint-rule or type-error work.
expected_outcome: Claude does not select the fallow-setup skill.
tags: [trigger, negative]
max_turns: 6
timeout_seconds: 180
allowed_tools: [Read, Glob, Grep, Skill]
---

Configure an Oxlint rule that forbids `console.log` in this project.
