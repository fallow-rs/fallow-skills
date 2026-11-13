---
description: Routing prompt. Better tests for a change need mutation evidence, which the fallow-mutation skill owns.
expected_outcome: Claude selects the fallow-mutation skill and does not select fallow-setup.
tags: [trigger, routing]
max_turns: 6
timeout_seconds: 180
allowed_tools: [Read, Glob, Grep, Skill]
---

Improve the tests of this change.
