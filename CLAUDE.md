# fallow-skills

Agent skills for finding and removing dead code, unused dependencies, and code duplication in JavaScript/TypeScript projects using [fallow](https://github.com/fallow-rs/fallow).

## Repository Structure

```
.claude-plugin/
  marketplace.json          # Marketplace metadata
  plugin.json               # Plugin metadata
fallow/                     # Codebase analysis skill (dead code, duplication, complexity)
  SKILL.md                  # Skill entry point
  references/
    cli-reference.md        # Complete CLI specs and output formats
    gotchas.md              # Common pitfalls and edge cases
    patterns.md             # Workflow recipes for CI, monorepos, migration
.github/
  workflows/
    validate.yml            # CI validation
```

## Creating a New Skill

1. Create a directory with a kebab-case name (e.g. `fallow-ci/`)
2. Add a `SKILL.md` with YAML frontmatter:
   - `name` (required): kebab-case skill name
   - `description` (required): Third-person, includes trigger phrases, 1-2 sentences
3. Add a `references/` directory for supplementary documentation
4. Update `.claude-plugin/plugin.json` if adding to the plugin

### SKILL.md Requirements

- Under 500 lines — keep focused, put details in references
- Include "When to Use" and "When NOT to Use" sections
- Include step-by-step workflows for common tasks
- Use progressive disclosure: SKILL.md links to reference files, references don't chain
- No hardcoded file paths

### Reference Files

- `cli-reference.md` — command specs, flags, output formats
- `gotchas.md` — common pitfalls with WRONG/CORRECT examples
- `patterns.md` — recipes and common workflows

### Naming Conventions

- Directories: kebab-case (`fallow`)
- Skill names: kebab-case (`fallow`)
- Reference files: kebab-case (`cli-reference.md`)

## Quality Standards

- Description must include trigger phrases ("Use when asked to...")
- Every gotcha must include correct vs incorrect example
- Workflows must be numbered step-by-step
- Destructive operations (auto-fix) must note dry-run requirement
- All commands tested against the actual fallow CLI before documenting

## PR Checklist

- [ ] SKILL.md has valid YAML frontmatter with `name` and `description`
- [ ] No hardcoded file paths
- [ ] Skill is under 500 lines
- [ ] "When to Use" and "When NOT to Use" sections present
- [ ] All JSON files are valid
- [ ] marketplace.json and plugin.json versions are in sync
