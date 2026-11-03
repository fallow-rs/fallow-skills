# Extra signals

The plan of `fallow coverage setup --cloud` sets up function coverage only. Fallow Cloud can also show errors, CPU time, browser frame time, branch use and loaded packages per function. Each signal needs its own opt-in in the beacon. Without it, Fallow Cloud reports the signal as `untracked`, and `untracked` never means zero.

Ask the user which signals they want. Add only those. Each opt-in is a separate entry of `@fallow-cli/beacon`, so a signal that the user does not add costs no bundle size.

## Pick the signals

| Signal | Add it when | Runtime | Entry and API |
|---|---|---|---|
| Errors | The user wants the errors of each function, or wants to check a deploy for new errors. | Node, Bun, browser | `withErrorCapture` of `@fallow-cli/beacon/errors` |
| CPU time | The user wants the server functions that use the most CPU, or a CPU change after a deploy. | Node, Bun | `createCpuProfiler` of `@fallow-cli/beacon/profiler` |
| Browser frame time | The user wants the functions that make the page slow (long animation frames). | Chromium browsers | `createBrowserPerformance` of `@fallow-cli/beacon/performance` |
| Branch use, server | The user wants to know which branches of a function never run, before a change to a condition. | Node, Bun | `captureBlocks: true` in the beacon config |
| Branch use, browser | The same, for browser code. | Browser | `withBlockCapture` of `@fallow-cli/beacon/browser-blocks` |
| Loaded packages, browser | The user wants the npm packages that production pages load. | Browser | `withScriptChunks` of `@fallow-cli/beacon/script-chunks` |

## Use the correct key

- A browser bundle gets only an ingest-only key (`fallow_pub_k1_`). This applies to every browser entry: the browser beacon, `@fallow-cli/beacon/performance`, `@fallow-cli/beacon/browser-blocks` and `@fallow-cli/beacon/script-chunks`.
- The CPU profiler needs a full key (`fallow_live_k1_`) in the server environment. Fallow Cloud drops the CPU profile of a payload that an ingest-only key sends, because anyone can read a key in browser code.
- The Node beacon also sends the npm packages that ran on the server. Fallow Cloud keeps them only for a full key.
- Errors, branch use, browser frame time and loaded packages work with both key types.

Rule 1 of the skill applies: use the environment variable names of the plan. Never write a key value into a file.

## Errors

Wrap the beacon config with `withErrorCapture`. Keep the `projectId`, `commitSha`, `coverageOrigin` and `runtimeSurface` values of the plan snippet.

```ts
import { createNodeBeacon } from "@fallow-cli/beacon";
import { withErrorCapture } from "@fallow-cli/beacon/errors";

const fallowBeacon = createNodeBeacon(
  withErrorCapture({
    // the config of the plan snippet
  }),
);
fallowBeacon.start();
```

- The same wrapper works with `createBrowserBeacon`.
- The beacon records uncaught exceptions and unhandled rejections. It only observes them, so the app crashes or continues as before.
- For an error that the code catches, call `captureError(error, { route })`. In the error handler of a server framework, call `captureRequestError(error, { route })`.
- For Next.js, add `export { onRequestError } from "@fallow-cli/beacon/errors";` to `instrumentation.ts`.
- Errors go out with the coverage requests. A beacon that sends no coverage sends no errors.
- The beacon removes credentials, e-mail addresses and tokens from the message. Tell the user not to put secrets in error messages.
- For events per route, put `withErrorBreakdown` of `@fallow-cli/beacon/errors-breakdown` inside `withErrorCapture`. The other order sends no breakdown.

## CPU time

Start the profiler next to the Node beacon, in the server entry:

```ts
import { createCpuProfiler } from "@fallow-cli/beacon/profiler";

const fallowProfiler = createCpuProfiler({
  apiKey: process.env.FALLOW_API_KEY, // a full key (fallow_live_k1_)
  projectId: "OWNER/REPO",
  endpoint: "https://api.fallow.cloud",
  commitSha: process.env.FALLOW_COMMIT_SHA,
  coverageOrigin: "production",
});
fallowProfiler.start();
```

- Use the same `projectId`, `endpoint` and `commitSha` expression as the beacon. Without `commitSha`, Fallow Cloud does not store the profile.
- The profiler samples 10 s every 5 minutes. It does not need `NODE_V8_COVERAGE`.
- It does not start when a debugger is attached or the process runs with `--inspect` or `--cpu-prof`. Then `onRuntimeMismatch` gets `inspector-in-use`.

## Browser frame time

Start the performance entry in the client entry, next to the browser beacon:

```ts
import { createBrowserPerformance } from "@fallow-cli/beacon/performance";

createBrowserPerformance({
  apiKey: import.meta.env.VITE_FALLOW_API_KEY, // an ingest-only key (fallow_pub_k1_)
  projectId: "OWNER/REPO",
  endpoint: "https://api.fallow.cloud",
  commitSha: import.meta.env.VITE_FALLOW_COMMIT_SHA,
  coverageOrigin: "production",
}).start();
```

- Only Chromium browsers have the Long Animation Frames API. Firefox and Safari send nothing.
- The CI must upload the source maps of the bundle, because Fallow Cloud maps each script position through them.
- `sampleRate` selects sessions as in the browser beacon.

## Branch use

Server: add `captureBlocks: true` to the config of `createNodeBeacon`. With V8 coverage, the beacon reads the block ranges of `NODE_V8_COVERAGE`. With Istanbul, it reads the branch arms and statements of the instrumented build.

Browser: wrap the config with `withBlockCapture`. The core browser entry ignores `captureBlocks`.

```ts
import { createBrowserBeacon } from "@fallow-cli/beacon/browser";
import { withBlockCapture } from "@fallow-cli/beacon/browser-blocks";

const fallowBeacon = createBrowserBeacon(
  withBlockCapture({
    // the config of the plan snippet
  }),
);
fallowBeacon.start();
```

Branch data goes out with the interval flushes, not with the page unload.

## Loaded packages in the browser

Wrap the browser config with `withScriptChunks`:

```ts
import { createBrowserBeacon } from "@fallow-cli/beacon/browser";
import { withScriptChunks } from "@fallow-cli/beacon/script-chunks";

const fallowBeacon = createBrowserBeacon(
  withScriptChunks({
    // the config of the plan snippet
  }),
);
fallowBeacon.start();
```

The beacon sends the paths of the same-origin script chunks that the page loaded. Fallow Cloud finds the npm packages through the uploaded source maps, so the CI must upload them. To use more than one browser wrapper, nest them: `withScriptChunks(withBlockCapture(withErrorCapture(config)))`.
