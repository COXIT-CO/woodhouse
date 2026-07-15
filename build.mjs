import * as esbuild from "esbuild";
import { cpSync, mkdirSync } from "node:fs";

const testsOnly = process.argv.includes("--tests");

const common = {
  bundle: true,
  format: "iife",
  target: ["chrome111"],
  sourcemap: false,
  logLevel: "info",
};

if (!testsOnly) {
  mkdirSync("dist", { recursive: true });

  await esbuild.build({
    ...common,
    entryPoints: {
      sw: "src/sw.ts",
      bridge: "src/bridge.ts",
      injected: "src/injected.ts",
      devtools: "src/devtools.ts",
      panel: "src/panel/main.ts",
      worker: "src/analysis/worker.ts",
    },
    outdir: "dist",
  });

  for (const f of ["manifest.json", "devtools.html", "panel.html", "styles.css"]) {
    cpSync(`src/${f}`, `dist/${f}`);
  }
  console.log("Built to dist/ — load it via chrome://extensions → Load unpacked");
} else {
  await esbuild.build({
    ...common,
    format: "esm",
    platform: "node",
    target: ["node18"],
    entryPoints: { "analysis.test": "tests/analysis.test.ts" },
    outdir: "dist-tests",
  });
}
