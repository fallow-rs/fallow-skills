---
description: Negative activation prompt. A fix for one failing test is not a request for better tests of a change.
expected_outcome: Claude does not select the fallow-mutation skill or the fallow-setup skill.
tags: [trigger, negative]
max_turns: 6
timeout_seconds: 180
allowed_tools: [Read, Glob, Grep, Skill]
---

This test fails. Fix the function:

```text
AssertionError: expected 'Hello-World' to be 'hello-world'
```

```ts
export const slugify = (title: string): string => title.trim().replaceAll(" ", "-");

test("slugify gives a lowercase slug", () => {
  expect(slugify("Hello World")).toBe("hello-world");
});
```
