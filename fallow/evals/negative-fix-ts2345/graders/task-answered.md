---
type: regex
target: last_message
pattern: '(Number\(|parseInt\(|parseFloat\(|\+input|= 42\b)'
flags: i
arm: both
---

The reply answers the task itself. Without this grader, a run where the
plugin skills do not load would also pass the negative check.
