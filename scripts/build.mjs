// @ts-check
import esbuild from "esbuild";
import { readFile } from "fs/promises";
import path from "path";

const __DEV__ = !process.argv.includes("--prod");
const watch = process.argv.includes("--watch");
const cwd = process.cwd();
const buf = await readFile(path.join(cwd, "package.json"));
const packageJSON = JSON.parse(buf.toString("utf-8"));
/** @type {string} */
const __EXTENSION__ = packageJSON.name;
const __ROOT__ = "out";
const __CONFIGURATION__ = `${__EXTENSION__}.configs`;
/** @type {esbuild.BuildOptions} */
const commonConfig = {
  absWorkingDir: cwd,
  allowOverwrite: true,
  bundle: true,
  define: Object.fromEntries(
    Object.entries({
      __DEV__,
      __EXTENSION__,
      __ROOT__,
      __CONFIGURATION__,
    }).map(([k, v]) => [k, JSON.stringify(v)])
  ),
  minify: !__DEV__,
  outdir: __ROOT__,
  sourcemap: __DEV__,
  treeShaking: !__DEV__,
};
const fakeLog = () =>
  console.log(`[${new Date().toLocaleTimeString()}] - Found 0 errors. Watching for file changes.\n\n`);
// Build extension
esbuild.build({
  ...commonConfig,
  entryPoints: ["./src/extension.cts"],
  loader: {
    ".cts": "ts",
  },
  platform: "node",
  external: ["vscode"],
  watch: watch && {
    onRebuild() {
      fakeLog();
    },
  },
});
// Build app
esbuild.build({
  ...commonConfig,
  entryPoints: ["./src/app.tsx"],
  platform: "browser",
  watch: watch && {
    onRebuild() {
      fakeLog();
    },
  },
});
fakeLog();
