import type { GameState } from "../core/state";
import { type TerrainKind, terrainKindOf } from "../core/terrain";
import { VIEW_H, VIEW_W } from "../core/view";
import { TILE_SIZE, toIndex } from "../map/grid";
import { tileHash } from "./renderMath";

/**
 * 地形の層の描画（docs/ideas/status-and-terrain.md 3 章）。state.terrain を読むだけ。
 * 模様のばらつきは座標ハッシュ（tileHash）と state.time で作り、state.rng は使わない（不変条件 2）
 */

interface TerrainStyle {
  base: string;
  alpha: number;
  /** 模様の点の色 */
  detail: string;
  /** 模様の点の数（1 タイルあたり） */
  dots: number;
}

const STYLE: Readonly<Record<Exclude<TerrainKind, "none">, TerrainStyle>> = {
  water: { base: "#2a5ca8", alpha: 0.55, detail: "#9cc8ff", dots: 2 },
  oil: { base: "#2a2418", alpha: 0.7, detail: "#6a5a90", dots: 2 },
  lava: { base: "#c83810", alpha: 0.85, detail: "#ffd040", dots: 3 },
  bog: { base: "#3c5a20", alpha: 0.65, detail: "#a0e060", dots: 2 },
  ice: { base: "#b8e0f0", alpha: 0.5, detail: "#ffffff", dots: 2 },
  grass: { base: "#2c5a24", alpha: 0.55, detail: "#70c050", dots: 4 },
  fire: { base: "#ff6010", alpha: 0.6, detail: "#ffe060", dots: 3 },
};

/** 揺らぎの速さ（水面・炎・溶岩の明滅） */
const SHIMMER_SPEED = 3;
const FIRE_FLICKER_SPEED = 12;
const FLICKER_AMPLITUDE = 0.25;
/** 模様の点の大きさ（論理 px） */
const DOT_W = 2;
const DOT_H = 1;
/** 消えかけの地形を薄くする残り秒 */
const FADE_TIME = 1;
const HASH_BITS = 8;
const HASH_MASK = 0xff;

/** 画面内の地形タイルを描く。viewX / viewY はワールド座標での画面左上 */
export function drawTerrainLayer(ctx: CanvasRenderingContext2D, state: GameState, viewX: number, viewY: number): void {
  const layer = state.terrain;
  const map = state.map;
  if (layer.map !== map) return;
  const x0 = Math.max(0, Math.floor(viewX / TILE_SIZE));
  const y0 = Math.max(0, Math.floor(viewY / TILE_SIZE));
  const x1 = Math.min(map.width - 1, Math.ceil((viewX + VIEW_W) / TILE_SIZE));
  const y1 = Math.min(map.height - 1, Math.ceil((viewY + VIEW_H) / TILE_SIZE));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = toIndex(map, x, y);
      const kind = terrainKindOf(layer.kinds[i] ?? 0);
      if (kind === "none") continue;
      drawTile(ctx, state, kind, x, y, layer.time[i] ?? 0);
    }
  }
  ctx.globalAlpha = 1;
}

function drawTile(ctx: CanvasRenderingContext2D, state: GameState, kind: Exclude<TerrainKind, "none">, x: number, y: number, timeLeft: number): void {
  const style = STYLE[kind];
  const hash = tileHash(x, y);
  const fade = timeLeft > 0 && timeLeft < FADE_TIME ? timeLeft / FADE_TIME : 1;
  const px = x * TILE_SIZE;
  const py = y * TILE_SIZE;
  ctx.globalAlpha = style.alpha * fade * flicker(state, kind, hash);
  ctx.fillStyle = style.base;
  ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
  ctx.fillStyle = style.detail;
  for (let d = 0; d < style.dots; d++) {
    const h = hash >>> (d * HASH_BITS);
    const dx = (h & HASH_MASK) % (TILE_SIZE - DOT_W);
    const dy = ((h >>> (HASH_BITS / 2)) & HASH_MASK) % (TILE_SIZE - DOT_H);
    ctx.fillRect(px + dx, py + dy, DOT_W, DOT_H);
  }
}

/** 水・溶岩はゆっくり、炎は速く明滅する。タイルごとに位相をずらす */
function flicker(state: GameState, kind: TerrainKind, hash: number): number {
  const phase = (hash & HASH_MASK) / HASH_MASK;
  if (kind === "fire") return 1 - FLICKER_AMPLITUDE + FLICKER_AMPLITUDE * Math.sin((state.time + phase) * FIRE_FLICKER_SPEED);
  if (kind === "water" || kind === "lava") return 1 - FLICKER_AMPLITUDE / 2 + (FLICKER_AMPLITUDE / 2) * Math.sin((state.time + phase) * SHIMMER_SPEED);
  return 1;
}
