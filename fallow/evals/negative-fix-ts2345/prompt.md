---
description: Negative activation prompt. The task is formatting, lint-rule or type-error work.
expected_outcome: Claude does not select the fallow-setup skill.
tags: [trigger, negative]
max_turns: 6
timeout_seconds: 180
allowed_tools: [Read, Glob, Grep, Skill]
---

Fix this TS2345 error:

```text
src/user.ts:12:18 - error TS2345: Argument of type 'string' is not assignable to parameter of type 'number'.
```

```ts
const parseAge = (age: number): number => age;
const input = "42";
parseAge(input);
```
