import type { GameState } from "../core/state";
import { type TerrainKind, terrainKindOf } from "../core/terrain";
import { VIEW_H, VIEW_W } from "../core/view";
import { TILE_SIZE, toIndex } from "../map/grid";
import { tileHash } from "./renderMath";
import { TERRAIN_RUBBLE } from "../data/tuning";

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

/** 床に塗る地形（煙は床ではなく上に漂うので drawSmokeLayer が別に描く） */
type GroundKind = Exclude<TerrainKind, "none" | "smoke">;

const STYLE: Readonly<Record<GroundKind, TerrainStyle>> = {
  water: { base: "#2a5ca8", alpha: 0.55, detail: "#9cc8ff", dots: 2 },
  oil: { base: "#2a2418", alpha: 0.7, detail: "#6a5a90", dots: 2 },
  lava: { base: "#c83810", alpha: 0.85, detail: "#ffd040", dots: 3 },
  bog: { base: "#3c5a20", alpha: 0.65, detail: "#a0e060", dots: 2 },
  ice: { base: "#b8e0f0", alpha: 0.5, detail: "#ffffff", dots: 2 },
  grass: { base: "#2c5a24", alpha: 0.55, detail: "#70c050", dots: 4 },
  fire: { base: "#ff6010", alpha: 0.6, detail: "#ffe060", dots: 3 },
  mud: { base: "#5a4028", alpha: 0.75, detail: "#8a6a40", dots: 3 },
  rubble: { base: "#4a4036", alpha: 0.8, detail: "#1e1a16", dots: 4 },
};

/** 揺らぎの速さ（水面・炎・溶岩の明滅） */
const SHIMMER_SPEED = 3;
const FIRE_FLICKER_SPEED = 12;
const FLICKER_AMPLITUDE = 0.25;
/** 崩れる床の揺れ（予告）: 乗られている割合に比例して最大 RUBBLE_SHAKE px、速さ RUBBLE_SHAKE_SPEED */
const RUBBLE_SHAKE = 1.5;
const RUBBLE_SHAKE_SPEED = 40;
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
      if (kind === "none" || kind === "smoke") continue;
      drawTile(ctx, state, kind, x, y, layer.time[i] ?? 0, kind === "rubble" ? (layer.rubbleLoad[i] ?? 0) : 0);
    }
  }
  ctx.globalAlpha = 1;
}

function drawTile(ctx: CanvasRenderingContext2D, state: GameState, kind: GroundKind, x: number, y: number, timeLeft: number, load: number): void {
  const style = STYLE[kind];
  const hash = tileHash(x, y);
  const fade = timeLeft > 0 && timeLeft < FADE_TIME ? timeLeft / FADE_TIME : 1;
  const shake = rubbleShake(state, load, hash);
  const px = x * TILE_SIZE + shake;
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

/** 崩れる床に敵が乗っている間は横に揺れる（抜けるまでの残りが短いほど大きい）。乗っていなければ 0 */
function rubbleShake(state: GameState, load: number, hash: number): number {
  if (load <= 0) return 0;
  const ratio = Math.min(1, load / TERRAIN_RUBBLE.fallDelay);
  const phase = (hash & HASH_MASK) / HASH_MASK;
  return Math.round(Math.sin((state.time + phase) * RUBBLE_SHAKE_SPEED) * RUBBLE_SHAKE * ratio);
}

/** 水・溶岩はゆっくり、炎は速く明滅する。タイルごとに位相をずらす */
function flicker(state: GameState, kind: TerrainKind, hash: number): number {
  const phase = (hash & HASH_MASK) / HASH_MASK;
  if (kind === "fire") return 1 - FLICKER_AMPLITUDE + FLICKER_AMPLITUDE * Math.sin((state.time + phase) * FIRE_FLICKER_SPEED);
  if (kind === "water" || kind === "lava") return 1 - FLICKER_AMPLITUDE / 2 + (FLICKER_AMPLITUDE / 2) * Math.sin((state.time + phase) * SHIMMER_SPEED);
  return 1;
}

// -----------------------------------------------------------------------------
// 煙（docs/ideas/enemies.md V10）: 敵・プレイヤーより上に描いて「中が見えない」を見せる
// -----------------------------------------------------------------------------

const SMOKE_BASE = "#6e6e78";
const SMOKE_PUFF = "#a8a8b4";
const SMOKE_BASE_ALPHA = 0.45;
const SMOKE_PUFF_ALPHA = 0.35;
/** 1 タイルに浮かべるもやの塊の数と大きさ（論理 px） */
const SMOKE_PUFFS = 3;
const SMOKE_PUFF_MIN = 6;
const SMOKE_PUFF_RANGE = 5;
/** もやの揺れの速さと幅（px） */
const SMOKE_DRIFT_SPEED = 1.3;
const SMOKE_DRIFT = 2.5;

/**
 * 画面内の煙を半透明の灰色のもやで描く。揺れは座標ハッシュ（tileHash）と state.time で作る（state.rng は使わない）。
 * renderer がプレイヤー・敵を描いた後に呼ぶ
 */
export function drawSmokeLayer(ctx: CanvasRenderingContext2D, state: GameState, viewX: number, viewY: number): void {
  const layer = state.terrain;
  const map = state.map;
  if (layer.map !== map || layer.smokeCells.size === 0) return;
  const x0 = Math.max(0, Math.floor(viewX / TILE_SIZE));
  const y0 = Math.max(0, Math.floor(viewY / TILE_SIZE));
  const x1 = Math.min(map.width - 1, Math.ceil((viewX + VIEW_W) / TILE_SIZE));
  const y1 = Math.min(map.height - 1, Math.ceil((viewY + VIEW_H) / TILE_SIZE));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const left = layer.smoke[toIndex(map, x, y)] ?? 0;
      if (left <= 0) continue;
      drawSmokeTile(ctx, state, x, y, left);
    }
  }
  ctx.globalAlpha = 1;
}

function drawSmokeTile(ctx: CanvasRenderingContext2D, state: GameState, x: number, y: number, timeLeft: number): void {
  const hash = tileHash(x, y);
  const fade = timeLeft < FADE_TIME ? timeLeft / FADE_TIME : 1;
  const px = x * TILE_SIZE;
  const py = y * TILE_SIZE;
  ctx.globalAlpha = SMOKE_BASE_ALPHA * fade;
  ctx.fillStyle = SMOKE_BASE;
  ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
  ctx.globalAlpha = SMOKE_PUFF_ALPHA * fade;
  ctx.fillStyle = SMOKE_PUFF;
  for (let d = 0; d < SMOKE_PUFFS; d++) {
    const h = hash >>> (d * HASH_BITS);
    const phase = ((h & HASH_MASK) / HASH_MASK) * Math.PI * 2;
    const size = SMOKE_PUFF_MIN + (h % SMOKE_PUFF_RANGE);
    const ox = ((h >>> (HASH_BITS / 2)) & HASH_MASK) % TILE_SIZE;
    const oy = (h & HASH_MASK) % TILE_SIZE;
    const dx = Math.sin(state.time * SMOKE_DRIFT_SPEED + phase) * SMOKE_DRIFT;
    const dy = Math.cos(state.time * SMOKE_DRIFT_SPEED * 0.7 + phase) * SMOKE_DRIFT;
    ctx.fillRect(Math.round(px + ox - size / 2 + dx), Math.round(py + oy - size / 2 + dy), size, size);
  }
}
