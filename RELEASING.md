# Plugin releases

Fallow uses one explicit semantic version across its Claude marketplace entry,
Claude manifest, Codex manifest, and Cursor manifest. Keep those versions synchronized so the
same source commit identifies the same public plugin release everywhere.
Claude's `plugin.json` remains the runtime authority. The marketplace copy is
retained as matching directory metadata and is checked against that authority.

## Prepare a release

1. Start from an up-to-date `main`.
2. Set the next plugin version:

   ```bash
   python3 scripts/plugin_release.py set-version 1.2.0
   ```

3. Review the manifest diff and validate the package:

   ```bash
   python3 scripts/plugin_release.py check --expected-version 1.2.0
   python3 -m unittest discover -s scripts -p 'test_*.py'
   python3 scripts/plugin_release.py package --expected-version 1.2.0
   ```

4. Commit the version and content changes together. Merge them before tagging.
5. Create and push a signed tag on the merged commit:

   ```bash
   git tag -s v1.2.0 -m "v1.2.0"
   git push origin v1.2.0
   ```

The tag workflow refuses a tag that does not match every manifest version. A
plugin-content pull request also fails unless its version has higher semantic
precedence than the base branch. A valid tag must point to `main`. The workflow
then creates a GitHub release with
`fallow-plugin-1.2.0-openai.zip` attached. An existing asset is compared
byte-for-byte on workflow retries and is never silently replaced.
Prerelease versions such as `1.2.0-rc.1` create GitHub prereleases.

## Anthropic

The Claude marketplace reads the plugin directly from this Git repository.
Because Fallow declares an explicit version, installed copies update only after
the version changes. Third-party marketplaces do not enable auto-update by
default, so users can enable it in the marketplace settings or update manually:

```text
claude plugin marketplace update fallow-skills
claude plugin update fallow@fallow-skills
```

See Anthropic's
[marketplace versioning documentation](https://code.claude.com/docs/en/plugin-marketplaces)
for the cache and update rules.

### Claude plugin directory

The directory lists the `fallow` folder of this repository as a plugin bundle.
It follows `main`, so a merged version bump is a new directory version. The
directory does not take `.mcpb` desktop extensions. It reaches the Fallow app
through the plugin.

To submit or to check the listing:

1. Run `claude plugin validate ./fallow` from the repository root.
2. Open the [developer portal](https://claude.ai/directory/manage) in the Fallow
   organization, select **Submit new**, then **Plugin bundle**.
3. Enter `fallow-rs/fallow-skills` as the repository and `fallow` as the plugin
   path. Select **Validate**, and fix each finding that blocks.
4. Answer the data handling questions from the privacy section of
   `fallow/README.md`. The plugin reads no personal data, keeps no data, and
   sends data only when the user runs a Fallow Cloud command.
5. Select **Submit for review**, and keep the GitHub push webhook.

Expect a reviewer hold for `codex-app/server.mjs` and `codex-app/app.html`:
the directory holds every file over 256 KiB. The server bundle is not minified,
so the reviewer can read it.

### Claude Desktop extension

Each tag release also attaches `fallow-app-<version>.mcpb`, which
`plugin_release.py package-desktop` builds from the committed app bundle. It is
for people who install the app by hand in Claude Desktop. Users install a new
version by hand, so the README points to the release page, not a fixed file.
Desktop chat calls the extension through a bridge and shows the result as text.
It loads the dashboard view but does not send it the result, so the view shows a
note after 20 seconds.

### Pinned npx release

`FALLOW_NPX_VERSION` in `codex-app/src/server/fallow-cli.ts` is the exact fallow
release that the `npx` source downloads. The directory refuses an unpinned
launcher. Raise it to a tested fallow release, then rebuild the app.

## OpenAI

OpenAI public updates use the skills-only ZIP attached to the matching GitHub
release. Download that exact asset and upload it to the existing Fallow Code
Analysis plugin at https://platform.openai.com/plugins. Do not rebuild the ZIP
by hand. Select the Fallow organization first: an upload needs a verified
developer identity, and the personal organization has none.

The package intentionally contains the Codex manifest and only the skills and
visual assets referenced by it. OpenAI refuses a ZIP with lifecycle hooks or
app references. It excludes the Claude manifest,
MCP configuration, app configuration, screenshots, and unrelated repository
files. OpenAI requires the plugin name to remain stable and the manifest version
to change for a new release. See the
[skills-only archive validation rules](https://learn.chatgpt.com/docs/plugin-submission-errors)
for these update constraints.

The listing reads `websiteURL`, `supportURL`, `privacyPolicyURL` and
`termsOfServiceURL` from the `interface` of `fallow/.codex-plugin/plugin.json`.
A skills-only plugin needs no review test cases and no demo recording.

The directory cannot list the Fallow app. The portal connects only to a remote
MCP server by URL, and the app server runs locally. OpenAI also does not add an
MCP server to an existing skills-only plugin, so a hosted server needs a new
plugin. The app stays on the marketplace install.

Before submitting the update:

1. Summarize the changes since the previous submitted version in release notes.
2. Check the automated findings under Metadata & Skills. Copy them into an
   issue or a session when the package needs a fix.
3. Recheck the listing, policies, regional availability, and attestations.

In October 2026 the portal reported "We are not accepting more skills-only
submissions at this time." While that finding stays, keep the uploaded draft
and submit it when OpenAI accepts skills-only submissions again.

After approval and publication:

1. Open the Plugins Directory in ChatGPT or Codex.
2. Confirm the displayed Fallow version matches the release tag.
3. Add Fallow with the `+` picker and run one starter prompt.
4. Confirm the response uses the updated skill behavior.

See OpenAI's
[plugin submission documentation](https://learn.chatgpt.com/docs/submit-plugins)
for the current review and publication flow.
