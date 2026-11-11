# File view hook for Claude Code (opt-in)

This hook gives Claude Code the Fallow view of a file each time it reads or edits a source file: the static findings and, with a Fallow Cloud key, the production data per function. The hook runs `fallow inspect --file <path> --cloud --format compact --quiet` and adds the text to the tool result.

The Fallow plugin does not install this hook. Codex reads the same `hooks/hooks.json` file, and the plugin cannot add a hook there for Claude Code only. The user installs the hook by hand. Ask the user first, because the hook runs fallow after each Read, Edit and Write.

## Requirements

- A fallow release with `fallow inspect --cloud`. Check with `fallow inspect --help`.
- `fallow` and `node` on the `PATH` of Claude Code. The hook does not use `npx`, because `npx` is too slow for a hook.
- For production data: a key from `fallow cloud login`, or `FALLOW_API_KEY` in the environment. Without a key, the hook gives the static findings and one `cloud no_key` line.
- The repository: `FALLOW_REPO`, else the `origin` git remote.

## Install

1. Save this script as `~/.claude/hooks/fallow-file-context.mjs`:

   ```js
   // Claude Code PostToolUse hook: adds the Fallow file view to a Read, Edit or Write result.
   import { spawnSync } from "node:child_process";
   import { readFileSync } from "node:fs";
   import { extname } from "node:path";

   const SOURCE_EXTENSIONS = new Set([
     ".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".vue", ".svelte", ".astro",
   ]);
   const TIMEOUT_MS = 2000;

   const readInput = () => {
     try {
       return JSON.parse(readFileSync(0, "utf8"));
     } catch {
       return null;
     }
   };

   const input = readInput();
   const file = input?.tool_input?.file_path;
   if (typeof file !== "string" || !SOURCE_EXTENSIONS.has(extname(file))) process.exit(0);

   const result = spawnSync(
     "fallow",
     ["inspect", "--file", file, "--cloud", "--format", "compact", "--quiet"],
     { cwd: typeof input.cwd === "string" ? input.cwd : process.cwd(), encoding: "utf8", timeout: TIMEOUT_MS },
   );
   const text = result.status === 0 ? result.stdout.trim() : "";
   if (text === "") process.exit(0);

   process.stdout.write(
     JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: text } }),
   );
   ```

2. Add the hook to `~/.claude/settings.json` (all projects) or to `.claude/settings.local.json` of one project. Merge it with the `hooks` that the file already has:

   ```json
   {
     "hooks": {
       "PostToolUse": [
         {
           "matcher": "Read|Edit|Write",
           "hooks": [
             {
               "type": "command",
               "command": "node \"$HOME/.claude/hooks/fallow-file-context.mjs\"",
               "timeout": 5
             }
           ]
         }
       ]
     }
   }
   ```

3. Start a new Claude Code session. Ask it to read a source file. The tool result then has the `fallow <path>` lines.

## Behavior

- The hook runs only for source files: `.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.vue`, `.svelte` and `.astro`.
- The time limit is 2 s. A timeout, a missing fallow, a non-zero exit or empty output adds nothing, and the tool result stays as it was.
- The hook never stops a tool call. It always exits 0.
- The production lines follow the rules of the `fallow` skill: `null` means "not measured", never zero.

## Remove

Delete the `PostToolUse` entry from the settings file and delete the script.
