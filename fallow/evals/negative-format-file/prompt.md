---
description: Negative activation prompt. The task is formatting, lint-rule or type-error work.
expected_outcome: Claude does not select the fallow-setup skill.
tags: [trigger, negative]
max_turns: 6
timeout_seconds: 180
allowed_tools: [Read, Glob, Grep, Skill]
---

Format this file:

```ts
export const add=(a:number,b:number)=>{return a+b}
```
