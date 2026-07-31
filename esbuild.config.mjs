import esbuild from "esbuild";
import process from "process";
import path from "path";
import builtins from "builtin-modules";

const prod = process.argv[2] === "production";

/**
 * The CLI bundle swaps the Obsidian runtime for a Node stand-in, so the
 * converter, REST client and pusher are the same code in both front ends.
 */
const cliContext = await esbuild.context({
  entryPoints: ["src/cli.ts"],
  bundle: true,
  platform: "node",
  target: "node18",
  format: "cjs",
  outfile: "cli.js",
  banner: { js: "#!/usr/bin/env node" },
  alias: { obsidian: path.resolve("src/node/obsidian-shim.ts") },
  external: [...builtins],
  logLevel: "info",
  sourcemap: prod ? false : "inline",
});

const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: [
    "obsidian",
    "electron",
    "@codemirror/autocomplete",
    "@codemirror/collab",
    "@codemirror/commands",
    "@codemirror/language",
    "@codemirror/lint",
    "@codemirror/search",
    "@codemirror/state",
    "@codemirror/view",
    "@lezer/common",
    "@lezer/highlight",
    "@lezer/lr",
    ...builtins,
  ],
  format: "cjs",
  target: "es2018",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  outfile: "main.js",
  minify: prod,
});

if (prod) {
  await Promise.all([context.rebuild(), cliContext.rebuild()]);
  process.exit(0);
} else {
  await Promise.all([context.watch(), cliContext.watch()]);
}
