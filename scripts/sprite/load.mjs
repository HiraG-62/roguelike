// src/data/sprites.ts（TypeScript）を Node のスクリプトから読む。
// TS の変換は vite の SSR 読み込みを借りる（tsx などの依存を増やさない）
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** `{ PALETTE, SPRITES, PALETTE_RAMPS, spriteDots }` を返す。呼ぶたびに vite を起動するので 1 回だけ呼ぶ */
export async function loadSprites() {
  const server = await createServer({
    root: REPO_ROOT,
    server: { middlewareMode: true, watch: null },
    logLevel: "silent",
    optimizeDeps: { noDiscovery: true },
  });
  try {
    const mod = await server.ssrLoadModule("/src/data/sprites.ts");
    const dots = await server.ssrLoadModule("/src/data/sprites/dots.ts");
    return { PALETTE: mod.PALETTE, SPRITES: mod.SPRITES, PALETTE_RAMPS: mod.PALETTE_RAMPS, spriteDots: dots.spriteDots };
  } finally {
    await server.close();
  }
}
