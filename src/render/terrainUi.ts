import type { GameState } from "../core/state";
import { type TerrainKind, terrainCode } from "../core/terrain";
import { VIEW_H, VIEW_W } from "../core/view";
import { type GameMap, TILE_SIZE, Tile, toIndex } from "../map/grid";
import { tileHash } from "./renderMath";
import { TERRAIN_RUBBLE } from "../data/tuning";
import { type PitTheme, pitThemeAt } from "./pitLook";
import type { SpriteAtlas } from "./sprites";
import {
  PIT_NONE,
  PIT_OTHER,
  PIT_SAME,
  type TexKind,
  drawOf,
  shapeOf,
  terrainCellImage,
  terrainVariantAt,
  texKindOfCode,
  vertexMasks,
} from "./terrainTex";

/**
 * 地形の層の描画（docs/ideas/status-and-terrain.md 3 章、docs/ideas/map-visual-impl.md 1-7 節）。state.terrain を読むだけ。
 * 水・油・溶岩・毒沼・氷・草・炎・泥は dual-grid（画面の頂点ごとに周りの 4 マスで形を選ぶ 1 枚。terrainTex.ts）で描く。
 * 崩れる床（rubble）は揺れの予告があるのでマスごとに描く。
 * 揺らぎはマスの座標ハッシュ（tileHash）と state.time で作り、state.rng は使わない（不変条件 2）
 */

/** 崩れる床だけマスごとに描く（単色 + 点）。ほかの地形は terrainTex.ts のアトラス */
const RUBBLE_STYLE = { base: "#4a4036", alpha: 0.8, detail: "#1e1a16", dots: 4 } as const;

/** 地形ごとの不透明度（絵は不透明。氷・草・炎は下の床がうっすら見える） */
const DRAW_ALPHA: Readonly<Record<TexKind, number>> = {
  water: 1,
  oil: 1,
  lava: 1,
  bog: 0.92,
  ice: 0.85,
  grass: 0.85,
  fire: 0.9,
  mud: 0.95,
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
/** 明滅の波の 1 頂点あたりの位相（秒）と縦方向の傾き */
const WAVE_STEP = 0.05;
const WAVE_SKEW = 0.7;
const HASH_BITS = 8;
const HASH_MASK = 0xff;
/** 1 枚（頂点を中心にした 16x16 論理 px）の左上へのずれ */
const CELL_OFFSET = TILE_SIZE / 2;
const NONE = terrainCode("none");
const RUBBLE = terrainCode("rubble");

/** 頂点を囲む 4 マス（左上・右上・左下・右下）の作業用。毎フレームの割り当てを避ける */
const quadCodes = new Uint8Array(4);
const quadPits = new Uint8Array(4);
const quadTime = new Float64Array(4);
const quadIsPit = new Uint8Array(4);

/** 水の章の穴など、同じ液体の穴を水と数えるための対応（穴のテーマ名 = 地形の種類名） */
function pitMarkFor(kind: TexKind, theme: PitTheme, isPit: number): number {
  if (isPit === 0) return PIT_NONE;
  return theme === kind ? PIT_SAME : PIT_OTHER;
}

/**
 * 画面内の地形を描く。viewX / viewY はワールド座標での画面左上。
 * atlas は PNG 素材の時代の引数で、今は使わない（呼び出し側の形を変えないため残す）
 */
export function drawTerrainLayer(ctx: CanvasRenderingContext2D, state: GameState, viewX: number, viewY: number, _atlas?: SpriteAtlas): void {
  const layer = state.terrain;
  const map = state.map;
  if (layer.map !== map) return;
  const x0 = Math.max(0, Math.floor(viewX / TILE_SIZE));
  const y0 = Math.max(0, Math.floor(viewY / TILE_SIZE));
  const x1 = Math.min(map.width - 1, Math.ceil((viewX + VIEW_W) / TILE_SIZE));
  const y1 = Math.min(map.height - 1, Math.ceil((viewY + VIEW_H) / TILE_SIZE));
  const theme = pitThemeAt(state.depth, state.floorKind);
  // 頂点 (vx, vy) は 4 マス (vx-1, vy-1) (vx, vy-1) (vx-1, vy) (vx, vy) の角。表示するマス x0..x1 は頂点 x0..x1+1 で覆える
  for (let vy = y0; vy <= y1 + 1; vy++) {
    for (let vx = x0; vx <= x1 + 1; vx++) {
      drawVertex(ctx, state, map, theme, vx, vy);
    }
  }
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = toIndex(map, x, y);
      if ((layer.kinds[i] ?? NONE) !== RUBBLE) continue;
      drawRubble(ctx, state, x, y, layer.time[i] ?? 0, layer.rubbleLoad[i] ?? 0);
    }
  }
  ctx.globalAlpha = 1;
}

/** 頂点を囲む 4 マスの地形・穴・残り秒を作業用の配列に読む（地図の外は地形なし・穴なし） */
function readQuad(state: GameState, map: GameMap, vx: number, vy: number): boolean {
  const layer = state.terrain;
  let any = false;
  for (let q = 0; q < 4; q++) {
    const x = vx - 1 + (q & 1);
    const y = vy - 1 + (q >> 1);
    const inside = x >= 0 && y >= 0 && x < map.width && y < map.height;
    const i = inside ? toIndex(map, x, y) : -1;
    const code = i >= 0 ? (layer.kinds[i] ?? NONE) : NONE;
    quadCodes[q] = code;
    quadTime[q] = i >= 0 ? (layer.time[i] ?? 0) : 0;
    quadIsPit[q] = i >= 0 && map.tiles[i] === Tile.Pit ? 1 : 0;
    if (code !== NONE || quadIsPit[q] === 1) any = true;
  }
  return any;
}

function drawVertex(ctx: CanvasRenderingContext2D, state: GameState, map: GameMap, theme: PitTheme, vx: number, vy: number): void {
  if (!readQuad(state, map, vx, vy)) return;
  for (let q = 0; q < 4; q++) {
    const code = quadCodes[q] ?? NONE;
    const kind = texKindOfCode(code);
    if (kind === undefined) continue;
    // 同じ種類は最初の象限で 1 回だけ描く
    let first = true;
    for (let j = 0; j < q; j++) if (quadCodes[j] === code) first = false;
    if (!first) continue;
    drawVertexKind(ctx, state, theme, kind, code, vx, vy);
  }
}

function drawVertexKind(ctx: CanvasRenderingContext2D, state: GameState, theme: PitTheme, kind: TexKind, code: number, vx: number, vy: number): void {
  for (let q = 0; q < 4; q++) quadPits[q] = pitMarkFor(kind, theme, quadIsPit[q] ?? 0);
  const packed = vertexMasks(code, quadCodes, quadPits);
  const draw = drawOf(packed);
  if (draw === 0) return;
  const image = terrainCellImage(kind, shapeOf(packed), terrainVariantAt(vx, vy), draw);
  ctx.globalAlpha = DRAW_ALPHA[kind] * vertexFade(code) * flicker(state, kind, wavePhase(vx, vy));
  ctx.drawImage(image, vx * TILE_SIZE - CELL_OFFSET, vy * TILE_SIZE - CELL_OFFSET, TILE_SIZE, TILE_SIZE);
}

/**
 * 消えかけ（残り FADE_TIME 秒未満）の地形のマスを、頂点の 4 マスの平均で薄くする。
 * 最小にすると 1 マスの薄れが隣の象限まで広がって四角く目立つので、平均で和らげる
 */
function vertexFade(code: number): number {
  let sum = 0;
  let count = 0;
  for (let q = 0; q < 4; q++) {
    if (quadCodes[q] !== code) continue;
    const left = quadTime[q] ?? 0;
    sum += left > 0 && left < FADE_TIME ? left / FADE_TIME : 1;
    count++;
  }
  return count === 0 ? 1 : sum / count;
}

function drawRubble(ctx: CanvasRenderingContext2D, state: GameState, x: number, y: number, timeLeft: number, load: number): void {
  const hash = tileHash(x, y);
  const fade = timeLeft > 0 && timeLeft < FADE_TIME ? timeLeft / FADE_TIME : 1;
  const px = x * TILE_SIZE + rubbleShake(state, load, hash);
  const py = y * TILE_SIZE;
  ctx.globalAlpha = RUBBLE_STYLE.alpha * fade;
  ctx.fillStyle = RUBBLE_STYLE.base;
  ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
  ctx.fillStyle = RUBBLE_STYLE.detail;
  for (let d = 0; d < RUBBLE_STYLE.dots; d++) {
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

/**
 * 水・溶岩はゆっくり、炎は速く明滅する。位相は呼び出し側が渡す。
 * 1 枚の中は同じ明るさなので、隣の頂点と位相を無関係にすると 16px の市松に見える
 */
function flicker(state: GameState, kind: TerrainKind, phase: number): number {
  if (kind === "fire") return 1 - FLICKER_AMPLITUDE + FLICKER_AMPLITUDE * Math.sin((state.time + phase) * FIRE_FLICKER_SPEED);
  if (kind === "water" || kind === "lava") return 1 - FLICKER_AMPLITUDE / 2 + (FLICKER_AMPLITUDE / 2) * Math.sin((state.time + phase) * SHIMMER_SPEED);
  return 1;
}

/** 隣の頂点とゆるく繋がる位相（秒）。斜めに流れる波になり、頂点ごとのばらつき（市松）を避ける */
function wavePhase(vx: number, vy: number): number {
  return (vx + vy * WAVE_SKEW) * WAVE_STEP;
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
