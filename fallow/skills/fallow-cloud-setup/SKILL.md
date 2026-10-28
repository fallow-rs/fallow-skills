---
name: fallow-cloud-setup
description: Connect a JavaScript or TypeScript app to Fallow Cloud production runtime coverage. Use when asked to set up Fallow Cloud, add the Fallow beacon, send runtime coverage to Fallow Cloud, or find out why Fallow Cloud shows no data for a repository. Do not use for local code-quality tooling; use fallow-setup for that. Do not use to read runtime data of a repository that is already set up; use the fallow skill for that.
license: MIT
---

# Fallow Cloud setup: runtime coverage with one commit SHA

Fallow Cloud joins production runtime coverage to the code only when five things name the same commit SHA:

1. The beacon in the app sends `commitSha`.
2. CI uploads the static inventory for that SHA.
3. CI uploads the source maps for that SHA, when the build bundles the code.
4. CI registers the deployment of that SHA.
5. The first production data for that SHA arrives.

`fallow coverage setup --cloud --json` writes a plan for all five steps. This skill applies the plan.

## When to Use
- Add the Fallow beacon to an app and send production coverage to Fallow Cloud.
- Wire the CI steps that upload the inventory and the source maps and register the deployment.
- Find the missing step when Fallow Cloud shows no data or no matched functions for a repository.

## When NOT to Use
- Local code-quality tooling, CI quality gates, or agent wiring. Use `fallow-setup`.
- Reading runtime data of a repository that is already set up. Use `fallow`.

## Rules
1. Never write an API key value into a file, a command, or a message. Use the environment variable names that the plan gives (`cloud.api_key_env`, `cloud.browser_key_env`). The user stores the values as CI secrets and server environment variables. Never use the `--api-key` flag and never put a key before a command (`FALLOW_API_KEY=... npx ...`). The user exports the key in the shell.
2. A browser bundle gets only an ingest-only key (prefix `fallow_pub_k1_`). A full key (prefix `fallow_live_k1_`) stays in CI and on the server.
3. Use the same commit SHA for every step. Do not replace `$GITHUB_SHA` or the `commitSha` expression in the plan with another value.
4. Resolve flags from `fallow coverage setup --help`. Do not use flags from memory.
5. Show the edits to the user before you change a CI workflow. A deploy workflow can hold secrets and production access.

## Sequence

1. **Check the flag.** Run `npx fallow coverage setup --help`. When it does not list `--cloud`, use [Manual setup](references/manual-setup.md) instead of steps 2 to 8. It has the same five steps.
2. **Get the plan.** Run `npx fallow coverage setup --cloud --json` at the repository root. When `cloud.project_id` is null, ask the user for the Fallow Cloud project id (`owner/repo`) and run the command again with `--project-id <owner/repo>`, so no snippet keeps the `OWNER/REPO` placeholder. When the command exits 2 and prints no JSON, read the error on stderr: an input such as the project id, `--git-sha`, or `--api-endpoint` is not valid.
3. **Read the plan.**
   - `members[]` has one entry for each workspace member that runs code. Each entry has its own `snippets`, `files_to_edit`, `dockerfile_snippet`, and `warnings`. Apply the snippets from `members[]` only: the top-level `snippets` and `files_to_edit` repeat the first member.
   - `commands` installs the beacon.
   - `cloud.ci.steps` holds the GitHub Actions steps (`cloud.ci.provider` is `github_actions`). `cloud.ci.workflows_detected` names the workflow files that look like a deploy.
   - `cloud.source_maps.dirs` names the build output of each bundled member. `cloud.source_maps.reason` says what the build must do, for example emit source maps.
   - `warnings` names what the plan cannot do for you, for example the coverage source of a Node server.
4. **Install the beacon.** Run the commands in `commands` with the package manager of the project.
5. **Add the snippets.** For each member, add each snippet to the file in its `path`. Keep the `projectId`, `commitSha`, `coverageOrigin`, and `runtimeSurface` values of the snippet. When the file exists, add the snippet at the start of the entry module. Do not replace the file.
6. **Pass the commit SHA to the runtime.**
   - Browser bundle: set `VITE_FALLOW_COMMIT_SHA` on the build step (the CI steps show it).
   - Server in a container: add the `dockerfile_snippet` lines to the Dockerfile, and build with `--build-arg FALLOW_COMMIT_SHA=$GITHUB_SHA`.
   - Server on a platform: the snippet reads the SHA that Vercel, Render, or Railway sets. On another platform, set `FALLOW_COMMIT_SHA` in the runtime environment.
7. **Add the CI steps.** Add `cloud.ci.steps` to the job that builds and deploys, in the workflow from `cloud.ci.workflows_detected`. When that list is empty, or the project does not use GitHub Actions, ask the user which job deploys and adapt the steps to it. The checkout needs `fetch-depth: 0`. The upload step goes after the build step, and the build must emit source maps for the upload to send anything. The registration step goes after the deploy step. Follow `cloud.ci.instructions`.
8. **Tell the user what to do by hand.** The user creates the keys in the Fallow Cloud dashboard, stores them as the secrets that the plan names, and deploys.
9. **Check the setup after the deploy.** Ask the user to export `FALLOW_API_KEY` (a full key) in the shell. Run `cloud.wait_command` from the plan with `--json` added and `$DEPLOYED_SHA` set to the deployed commit SHA. It holds the project id. Then read the exit code:
   - 0: every step is done.
   - 1: a timeout. Read `cloud.wait.activation.next`. It names the step to do now and, where one exists, a command. `activation` is null when no read succeeded, and `next.command` can be null.
   - 2: an error. Read `cloud.wait.message`, or stderr when stdout has no JSON.

   The activation body can have step ids and states that this skill does not name. Report them as they are.

## Common problems
- `beacon` is `problem`: the beacon sends no commit SHA. Check step 5.
- `runtime` stays `waiting`: the app has no production traffic yet, or the beacon `commitSha` is not the full SHA that CI used.
- `deployment` is `waiting`: an older deployment still receives runtime. The new one becomes current on its first runtime data.
- `overlap` is `waiting`: too few functions ran so far. Send more traffic.
- `source_maps` is `missing` for an app that runs its source files without a bundle: it changes to `not_needed` when runtime joins the inventory.
- `overlap` is `problem`: runtime paths do not match the inventory paths. A container that runs the code under another root, for example `/app`, needs `--path-prefix` on `upload-inventory`. A bundled app needs the source maps.
- `inventory` fails in CI: the checkout is shallow. Set `fetch-depth: 0`.

## References
- [Manual setup](references/manual-setup.md): the five steps by hand, for a fallow version without `--cloud`.
