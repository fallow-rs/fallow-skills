---
type: tool_used
tool: Bash
input_match: '\bpnpm\s+(add|install|i|dlx|exec)\b'
---

A Bash command uses pnpm, the package manager of the fixture: an install, or
`pnpm dlx` or `pnpm exec` to run fallow. The eval sandbox has no network, so a
run can use `pnpm dlx` without an install. A reply that only names pnpm does
not pass.
