# Fallow Code Analysis

Fallow gives Claude codebase intelligence for TypeScript and JavaScript
projects. The skills teach Claude to find unused files, exports and
dependencies, duplicated code, complex functions, circular dependencies and
architecture boundary violations, to review a change before a commit or a pull
request, and to set up code-quality tooling and a CI gate.

## What the plugin contains

- `fallow`: static analysis, changed-code risk, cleanup, architecture, styling,
  runtime evidence and Impact summaries.
- `fallow-review`: graph-grounded review of changed code.
- `fallow-mutation`: improves the tests of a change with mutation testing.
- `fallow-setup`: sets up code-quality tooling, the agent integration and a CI
  gate for a project.
- `fallow-cloud-setup`: connects an app to Fallow Cloud runtime coverage.
- `cargo-fallow`: runs `cargo fallow` on a Rust workspace.

This listing holds only skills. The plugin runs no hooks, scripts or servers of
its own.

## What runs, and what leaves your machine

Claude runs the fallow command-line tool in your project. When fallow is not
installed, the skills run an exact fallow release with npx, which downloads
that release from your npm registry. The analysis runs on your machine, and
product telemetry is off unless you turn it on. Fallow Cloud commands send data
only after you ask for them and set up a Fallow Cloud account.

## The full plugin

The plugin in the fallow-rs/fallow-skills marketplace adds the interactive
Fallow dashboard, a commit gate and a statusline command:

```text
/plugin install fallow --marketplace fallow-rs/fallow-skills
```

See the [Fallow privacy policy](https://fallow.tools/privacy) and the
[plugin documentation](https://fallow.tools/plugins). The plugin is MIT
licensed.
