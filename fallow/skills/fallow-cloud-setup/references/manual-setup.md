# Manual setup without `--cloud`

Use these steps when `fallow coverage setup --help` does not list `--cloud`. They are the same five steps that the plan writes. Replace `OWNER/REPO` with the Fallow Cloud project id (`owner/repo`) before you apply them, and use that one value everywhere.

## 1. Install the beacon

Install `@fallow-cli/beacon` with the package manager of the project.

## 2. Start the beacon with the deployed commit SHA

Browser bundle (Vite), in the client entry, for example `src/main.ts`:

```ts
import { createBrowserBeacon } from "@fallow-cli/beacon/browser";

const fallowBeacon = createBrowserBeacon({
  apiKey: import.meta.env.VITE_FALLOW_API_KEY,
  projectId: "OWNER/REPO",
  endpoint: "https://api.fallow.cloud",
  commitSha: import.meta.env.VITE_FALLOW_COMMIT_SHA,
  coverageOrigin: "production",
  runtimeSurface: "browser",
});

fallowBeacon.start();
```

The build sets `VITE_FALLOW_COMMIT_SHA` to the commit it builds. `VITE_FALLOW_API_KEY` holds an ingest-only key (`fallow_pub_k1_`). The production build must be Istanbul-instrumented, for example with `oxc-coverage-instrument`.

Node server, in the server entry, before it handles traffic:

```ts
import { createNodeBeacon } from "@fallow-cli/beacon";

const fallowBeacon = createNodeBeacon({
  apiKey: process.env.FALLOW_API_KEY,
  projectId: "OWNER/REPO",
  endpoint: "https://api.fallow.cloud",
  commitSha:
    process.env.FALLOW_COMMIT_SHA ??
    process.env.VERCEL_GIT_COMMIT_SHA ??
    process.env.RENDER_GIT_COMMIT ??
    process.env.RAILWAY_GIT_COMMIT_SHA,
  coverageOrigin: "production",
  runtimeSurface: "server",
});

fallowBeacon.start();
```

Start the server process with `NODE_V8_COVERAGE` set to a writable directory, or instrument the build with Istanbul. In a container, pass the SHA as a build argument and set `FALLOW_COMMIT_SHA` from it.

## 3 to 5. CI steps

Add these steps to the GitHub Actions job that builds and deploys. Show them to the user first. The secret `FALLOW_API_KEY` holds a full key (`fallow_live_k1_`).

```yaml
- uses: actions/checkout@v4
  with:
    fetch-depth: 0 # the inventory reads git history
# After the build step:
- name: Upload the Fallow Cloud inventory and source maps
  env:
    FALLOW_API_KEY: ${{ secrets.FALLOW_API_KEY }}
  run: |
    npx --yes fallow coverage upload-inventory --project-id=OWNER/REPO --git-sha="$GITHUB_SHA"
    npx --yes fallow coverage upload-source-maps --dir=dist --repo=OWNER/REPO --git-sha="$GITHUB_SHA"
# After the deploy step:
- name: Register the deployment with Fallow Cloud
  env:
    FALLOW_API_KEY: ${{ secrets.FALLOW_API_KEY }}
  run: |
    curl -fsS -X POST "https://api.fallow.cloud/v1/deployments" \
      -H "Authorization: Bearer $FALLOW_API_KEY" \
      -H "Content-Type: application/json" \
      -d "{\"repo\":\"OWNER/REPO\",\"gitSha\":\"$GITHUB_SHA\"}"
```

Leave out the source map upload when the runtime runs the source files without a bundle. Set `--dir` to the build output, and make the build emit source maps.

## Check the setup

Without `--wait`, the user reads the setup state in the Fallow Cloud dashboard, or calls `GET https://api.fallow.cloud/v1/repos/<url-encoded owner/repo>/activation?sha=<sha>` with the header `Authorization: Bearer $FALLOW_API_KEY`. The response names each step, its state, and the next step.
