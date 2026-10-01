---
type: tool_order
before: { tool: Bash, input_match: '\bfallow\b[^"]*\brecommend\b' }
after: { tool: Bash, input_match: '\bfallow\b[^"]*\bagent install\b(?![^"]*--dry-run)' }
---
