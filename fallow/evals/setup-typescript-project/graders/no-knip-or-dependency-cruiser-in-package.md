---
type: regex
target: { source: file, path: package.json }
pattern: '"(knip|dependency-cruiser)"'
match: not_contains
---
