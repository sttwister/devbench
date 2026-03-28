import { build } from "esbuild";
import { copyFileSync } from "fs";

await build({
  entryPoints: ["main.ts", "preload.ts", "toolbar-preload.ts"],
  bundle: true,
  platform: "node",
  outdir: "dist",
  external: ["electron"],
  format: "cjs",
  sourcemap: true,
});

// Copy static assets
copyFileSync("browser-toolbar.html", "dist/browser-toolbar.html");
