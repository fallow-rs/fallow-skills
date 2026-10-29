# agent-view

The shared core of the Fallow file views in the Codex app (`codex-app/`) and the
Claude Code mod (`claude-mod/`). It is a source folder, not a package: each host
bundles it with esbuild.

| File | Contents |
| --- | --- |
| `src/contracts.ts`, `src/categories.ts` | `Finding`, `Report`, `AuditResult`, `FallowProblem`, and the category metadata. |
| `src/json.ts`, `src/rules.ts`, `src/normalize.ts`, `src/summary.ts` | Static normalization of fallow JSON, and the text for the model. |
| `src/path.ts` | Pure path helpers, because a mod has no `node:` modules. |
| `src/production.ts` | The view model of `fallow inspect --file <path> --cloud --format json`. |
| `src/compact.ts` | A reader of `fallow inspect --format compact` for counts and a status line. |
| `fixtures/` | One inspect JSON and the matching compact text per case: `ok`, `unpaired`, `no-key`, `untracked`, `plan-required`. The fallow CLI wrote each pair (`fallow inspect --file src/services/user.ts --cloud --format json` and `--format compact`) on a small test project, against a fake Fallow Cloud. |

Rules:

- No `node:` import in `src/`. A test checks this.
- A value that Fallow Cloud did not measure stays `null`. No host shows it as zero.
- The fallow CLI joins the static findings and the production data. The hosts
  only run the CLI and read its output.
- The CLI owns the words of a `prod` line. `functionText` and `productionLines`
  copy them, and a test holds both to the fixtures.

Run the tests from `codex-app/`: `npm test`.
