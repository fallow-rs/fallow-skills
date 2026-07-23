# Plugin releases

Fallow uses one explicit semantic version across its Claude marketplace entry,
Claude manifest, and Codex manifest. Keep those versions synchronized so the
same source commit identifies the same public plugin release everywhere.

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
plugin-content pull request also fails validation when its version still
matches the base branch. A valid tag must point to `main` and creates a GitHub release with
`fallow-plugin-1.2.0-openai.zip` attached. An existing asset is compared
byte-for-byte on workflow retries and is never silently replaced.

## Anthropic

The Claude marketplace reads the plugin directly from this Git repository.
Because Fallow declares an explicit version, installed copies update only after
the version changes. Third-party marketplaces do not enable auto-update by
default, so users can enable it in the marketplace settings or update manually:

```text
/plugin marketplace update fallow-skills
/plugin update fallow@fallow-skills
```

See Anthropic's
[marketplace versioning documentation](https://code.claude.com/docs/en/plugin-marketplaces)
for the cache and update rules.

## OpenAI

OpenAI public updates use the skills-only ZIP attached to the matching GitHub
release. Download that exact asset and upload it to the existing Fallow draft
or listing in the plugin submission portal. Do not rebuild the ZIP by hand.

The package intentionally contains the Codex manifest and only the skills,
hooks, and visual assets referenced by it. It excludes the Claude manifest,
MCP configuration, app configuration, screenshots, and unrelated repository
files. OpenAI requires the plugin name to remain stable and the manifest version
to change for a new release.

After approval and publication:

1. Open the Plugins Directory in ChatGPT or Codex.
2. Confirm the displayed Fallow version matches the release tag.
3. Add Fallow with the `+` picker and run one starter prompt.
4. Confirm the response uses the updated skill behavior.

See OpenAI's
[plugin submission documentation](https://learn.chatgpt.com/docs/submit-plugins)
for the current review and publication flow.
