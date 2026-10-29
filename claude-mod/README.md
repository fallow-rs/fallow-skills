# Fallow mod for Claude Code

A hooks module for Claude Code. After a `Read`, `Edit` or `Write` of a source
file, it runs `fallow inspect --file <path> --cloud --format compact` and adds
the output to the tool result: the static findings of the file and, with a
Fallow Cloud key from `fallow cloud login`, the production data of each
function. It also sets a status line entry, for example
`fallow user.ts: 2 findings | prod 1 called, 1 never_called`.

The run has a budget of 2 seconds. A failed start, a timeout, a non-zero exit or
empty output adds nothing, and the tool result stays as it was.

The mod does not ship in the `fallow` plugin yet. Codex reads the same
`fallow/hooks/hooks.json` and refuses the `modules` key. Codex then loads no
hook of the plugin, and the commit gate does not run there.

## Layout

```text
src/fallow-mod.ts   The hooks module. The build copies it, because Claude Code reads it as source.
src/view.ts         The command, the reading of its result and the status line. Bundled with agent-view/.
test/mod.test.ts    claude plugin test, over the terminal and desktop surfaces, with a fake process.
types/              The small part of the mod API that CI type-checks against.
scripts/            build.mjs and plugin-test.mjs.
```

## Develop

```bash
npm ci
npm run check   # typecheck and build into dist/hooks/
npm test        # needs Claude Code: stages the plugin, runs claude plugin validate and test
```

`CLAUDE_BIN=/path/to/claude npm test` tests another Claude Code build.
