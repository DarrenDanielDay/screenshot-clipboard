// @ts-check
import esbuild from "esbuild";
import { readFile } from "fs/promises";
import path from "path";

const readFileAsText = async (p) => {
  const buf = await readFile(p);
  return buf.toString("utf-8");
};
/**
 * Convert JSON object to define object.
 * @param {Record<string, string | number | boolean>} obj JSON only object
 * @returns {Record<string, string>}
 */
const defineObject = (obj) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, JSON.stringify(v)]));

const __DEV__ = !process.argv.includes("--prod");
const watch = process.argv.includes("--watch");
const cwd = process.cwd();
const packageJSON = JSON.parse(await readFileAsText(path.join(cwd, "package.json")));
/** @type {string} */
const __EXTENSION__ = packageJSON.name;
const __ROOT__ = "out";
const __CONFIGURATION__ = `${__EXTENSION__}.configs`;

/** @type {esbuild.BuildOptions} */
const commonConfig = {
  absWorkingDir: cwd,
  allowOverwrite: true,
  bundle: true,
  define: defineObject({
    __DEV__,
    __PLATFORM__: "desktop",
    __EXTENSION__,
    __ROOT__,
    __CONFIGURATION__,
    __APP_BUNDLE__: "",
    "process.env.NODE_ENV": __DEV__ ? "development" : "production",
  }),
  minify: !__DEV__,
  outdir: __ROOT__,
  sourcemap: __DEV__,
  treeShaking: !__DEV__,
};
const fakeLog = () =>
  console.log(`[${new Date().toLocaleTimeString()}] - Found 0 errors. Watching for file changes.\n\n`);
// Build extension
/** @type {esbuild.BuildOptions} */
const extensionBuildOptions = {
  ...commonConfig,
  entryPoints: ["./src/extension.ts"],
  loader: {
    ".cts": "ts",
  },
  format: "cjs",
  platform: "node",
  external: ["vscode"],
  watch: watch && {
    onRebuild() {
      fakeLog();
    },
  },
};
const extensionBuild = esbuild.build(extensionBuildOptions);
// Build app
/** @type {esbuild.BuildOptions} */
const appBuildOptions = {
  ...commonConfig,
  entryPoints: ["./src/app.tsx"],
  platform: "browser",
  watch: watch && {
    onRebuild() {
      fakeLog();
    },
  },
};

const appBuild = esbuild.build(appBuildOptions);

if (__DEV__) {
  fakeLog();
} else {
  await appBuild;
  const appBundle = (await readFile(path.join(cwd, commonConfig.outdir, "app.js"))).toString("utf-8");
  // Build browser bundle
  /** @type {esbuild.BuildOptions} */
  const browserBuildOptions = {
    ...extensionBuildOptions,
    platform: "browser",
    define: {
      ...extensionBuildOptions.define,
      ...defineObject({
        __APP_BUNDLE__: appBundle,
        __PLATFORM__: "browser",
      }),
    },
    outdir: undefined,
    outfile: "./out/browser.js",
    plugins: [
      {
        name: "polyfill-node-for-browser",
        setup(build) {
          build.onResolve(
            {
              filter: /^path$/,
            },
            async () => {
              const polyfillPath = path.resolve("node_modules", "path-browserify", "index.js");
              return {
                path: polyfillPath,
              };
            }
          );
        },
      },
    ],
  };
  esbuild.build(browserBuildOptions);
}
