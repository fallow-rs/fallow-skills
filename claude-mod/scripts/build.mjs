import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const source = join(here, "..");
// Not in fallow/hooks/ yet: Codex reads the same hooks.json and refuses the `modules` key.
const DEFAULT_OUTPUT = join(source, "dist", "hooks");

/**
 * Writes the mod into a hooks folder. Claude Code reads the hooks module as source: `register` and
 * each `$` call must stay as written. So `fallow-mod.ts` is copied with one import changed, and only
 * `view.ts` with the shared `agent-view/` core is bundled into `fallow-view.mjs`. A mod loads only
 * files of its own plugin folder, so the core cannot stay a separate import.
 */
export const buildMod = async (outdir = DEFAULT_OUTPUT) => {
  await mkdir(outdir, { recursive: true });
  await build({
    entryPoints: [join(source, "src", "view.ts")],
    bundle: true,
    platform: "neutral",
    format: "esm",
    target: "es2022",
    outfile: join(outdir, "fallow-view.mjs"),
    legalComments: "none",
    banner: { js: "// Built from claude-mod/ in fallow-rs/fallow-skills. Do not edit; run `npm run build`." },
    logLevel: "warning",
  });
  const mod = await readFile(join(source, "src", "fallow-mod.ts"), "utf8");
  if (!mod.includes('from "./view.ts"')) throw new Error("fallow-mod.ts must import ./view.ts");
  await writeFile(
    join(outdir, "fallow-mod.ts"),
    `// Built from claude-mod/ in fallow-rs/fallow-skills. Do not edit; run \`npm run build\`.\n${mod.replace('from "./view.ts"', 'from "./fallow-view.mjs"')}`,
  );
  console.log(`Built the Fallow mod into ${outdir}`);
};

/** Bundles one test file with its fixtures, for `claude plugin test` in a staging folder. */
export const buildTest = async (entry, outfile) => {
  await build({
    entryPoints: [entry],
    bundle: true,
    platform: "neutral",
    format: "esm",
    target: "es2022",
    outfile,
    external: ["claude-code", "claude-code/*"],
    loader: { ".txt": "text" },
    legalComments: "none",
    logLevel: "warning",
  });
};

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values } = parseArgs({ options: { out: { type: "string" } } });
  await buildMod(values.out ?? DEFAULT_OUTPUT);
}
