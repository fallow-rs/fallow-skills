import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const source = join(here, "..");
const repository = join(source, "..");
const DEFAULT_OUTPUT = join(repository, "fallow", "codex-app");

/** Bundles the app into one HTML file: the host loads it as a single MCP App resource. */
const buildApp = async () => {
  const result = await build({
    entryPoints: [join(source, "src", "app", "main.tsx")],
    bundle: true,
    write: false,
    format: "iife",
    target: "es2022",
    minify: true,
    legalComments: "none",
    jsx: "automatic",
    jsxImportSource: "preact",
    outdir: "out",
    loader: { ".svg": "text" },
    define: { "process.env.NODE_ENV": '"production"' },
    logLevel: "warning",
  });
  const script = result.outputFiles.find((file) => file.path.endsWith(".js"))?.text ?? "";
  const style = result.outputFiles.find((file) => file.path.endsWith(".css"))?.text ?? "";
  const template = await readFile(join(source, "src", "app", "index.html"), "utf8");
  return template
    .replace("/* APP_STYLE */", () => style.replace(/<\/style/gi, "<\\/style"))
    .replace("/* APP_SCRIPT */", () => script.replace(/<\/script/gi, "<\\/script"));
};

const buildServer = (output, version) =>
  build({
    entryPoints: [join(source, "src", "server", "index.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    // jsonc-parser ships a UMD `main` with dynamic requires; its ESM `module` build bundles cleanly.
    mainFields: ["module", "main"],
    target: "node20",
    outfile: join(output, "server.mjs"),
    // Smaller output, readable stack traces: identifiers keep their names.
    minifyWhitespace: true,
    minifySyntax: true,
    legalComments: "none",
    define: { __FALLOW_APP_VERSION__: JSON.stringify(version) },
    banner: {
      js: "// Built from codex-app/ in fallow-rs/fallow-skills. Do not edit; run `npm run build`.\nimport { createRequire as __fallowCreateRequire } from 'node:module';\nconst require = __fallowCreateRequire(import.meta.url);",
    },
    logLevel: "warning",
  });

/** Builds the server bundle, the single-file app and the MCP config into the plugin folder. */
export const buildPlugin = async (output = DEFAULT_OUTPUT) => {
  const manifest = JSON.parse(await readFile(join(repository, "fallow", ".codex-plugin", "plugin.json"), "utf8"));
  const version = String(manifest.version);
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  const [html] = await Promise.all([buildApp(), buildServer(output, version)]);
  await writeFile(join(output, "app.html"), html);
  await writeFile(
    join(output, "mcp.json"),
    `${JSON.stringify(
      { mcpServers: { "fallow-app": { command: "node", args: ["./codex-app/server.mjs"], cwd: "." } } },
      null,
      2,
    )}\n`,
  );
  console.log(`Built Fallow for Codex ${version} into ${output}`);
};

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values } = parseArgs({ options: { out: { type: "string" } } });
  await buildPlugin(values.out ?? DEFAULT_OUTPUT);
}
