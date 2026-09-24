/** main プロセスを 1 ファイルの ESM に束ねる（root package.json が "type": "module" なので .js のまま ESM として読まれる） */
import { builtinModules } from "node:module";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

export default defineConfig({
  root: ROOT,
  publicDir: false,
  build: {
    outDir: "dist-electron",
    // preload のビルドと同じ出力先を共有するので消さない（掃除は scripts 側）
    emptyOutDir: false,
    target: "node24",
    minify: false,
    sourcemap: true,
    lib: { entry: "electron/main.ts", formats: ["es"], fileName: () => "main.js" },
    rolldownOptions: { external: ["electron", /^node:/, ...builtinModules] },
  },
});
