---
description: Negative activation prompt. One requested unit test for one function is not a request for better tests of a change.
expected_outcome: Claude does not select the fallow-mutation skill or the fallow-setup skill.
tags: [trigger, negative]
max_turns: 6
timeout_seconds: 180
allowed_tools: [Read, Glob, Grep, Skill]
---

Write one Vitest unit test for this function. Reply with the test code only.

```ts
export const formatTotal = (total: number): string => `Total: ${total.toFixed(2)}`;
```
