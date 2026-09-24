/** preload を 1 ファイルの CJS に束ねる。sandbox: true の preload は ESM 非対応で、"type": "module" の下では拡張子を .cjs にする必要がある */
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

export default defineConfig({
  root: ROOT,
  publicDir: false,
  build: {
    outDir: "dist-electron",
    emptyOutDir: false,
    target: "node24",
    minify: false,
    sourcemap: "inline",
    lib: { entry: "electron/preload.ts", formats: ["cjs"], fileName: () => "preload.cjs" },
    rolldownOptions: { external: ["electron"] },
  },
});
