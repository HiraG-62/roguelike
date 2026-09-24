/**
 * 演出の描画（docs/ideas/meta-and-weapons.md 7 章）。state は読むだけ、state.rng は使わない。
 * ばらつきは renderMath.ts の座標ハッシュと state.time で作る。演出の状態は system/effects.ts が
 * state.effects（死に方・演出の印）に置いたものを読む
 */
import type { DeathFx, FxMark, GameState, RoomState } from "../core/state";
import { VIEW_H, VIEW_W } from "../core/view";
import { EFFECTS } from "../data/tuning";
import { TRAIT_COLORS, TRAIT_COLOR_HEX } from "../loot/types";
import { TILE_SIZE, Tile, getTile } from "../map/grid";
import { deathColor } from "../system/effects";
import { TEXT, drawTextShadow } from "./pixelText";
import {
  ashCrumble,
  clamp01,
  clearWaveAlpha,
  easeOutCubic,
  floorCardAlpha,
  hash01,
  meltScale,
  rayAngles,
  severGap,
  shardOffset,
} from "./renderMath";

/** レンダラーのスプライトを借りる窓口（アトラス・色付けのキャッシュはレンダラーが持つ） */
export interface FxSprites {
  /** 敵の 1 コマ目（色付け済み）。color が null なら元の色 */
  enemy(defKey: string, color: string | null): HTMLCanvasElement | undefined;
  /** プレイヤーの 1 コマ目の色付き */
  player(color: string): HTMLCanvasElement | undefined;
  /** 加算の丸い光 */
  glow(x: number, y: number, color: string, r: number, alpha: number): void;
}

const COLOR_BLACK = "#000000";
const COLOR_WHITE = "#ffffff";
const COLOR_CHAR = "#202020";
const SHARD_COUNT = 4;
const HOLY_RISE = 22;
const DISCHARGE_FLICKER = 30;
const DISCHARGE_BOLTS = 3;
const BLOOD_DROPS = 6;
const BLOOD_SPREAD = 18;
const VOID_RING = 20;
const PUDDLE_RY = 3;

function markT(m: Readonly<FxMark>): number {
  return m.life > 0 ? clamp01(m.age / m.life) : 1;
}

function deathT(d: Readonly<DeathFx>): number {
  return d.life > 0 ? clamp01(d.age / d.life) : 1;
}

/** 足元を基準にスプライトを置く（sx / sy は伸縮、flip は左右反転） */
function drawFoot(
  ctx: CanvasRenderingContext2D,
  img: HTMLCanvasElement,
  x: number,
  bottom: number,
  sx: number,
  sy: number,
  flip: boolean,
): void {
  ctx.save();
  ctx.translate(Math.round(x), Math.round(bottom));
  ctx.scale(flip ? -sx : sx, sy);
  ctx.drawImage(img, -img.width / 2, -img.height);
  ctx.restore();
}

// -----------------------------------------------------------------------------
// 死に方
// -----------------------------------------------------------------------------

function drawAsh(ctx: CanvasRenderingContext2D, d: DeathFx, img: HTMLCanvasElement, t: number): void {
  const gone = ashCrumble(t);
  const h = img.height;
  const keep = Math.max(0, Math.round(h * (1 - gone)));
  const bottom = d.pos.y + h / 2;
  if (keep > 0) {
    ctx.globalAlpha = 1 - gone * 0.4;
    ctx.save();
    ctx.translate(Math.round(d.pos.x), Math.round(bottom));
    ctx.scale(d.flip ? -1 : 1, 1);
    ctx.drawImage(img, 0, h - keep, img.width, keep, -img.width / 2, -keep, img.width, keep);
    ctx.restore();
  }
  // 崩れた灰が足元にこぼれる
  ctx.fillStyle = deathColor("ash");
  for (let i = 0; i < 4; i++) {
    const x = d.pos.x + (hash01(d.pos.x + i, d.pos.y) * 2 - 1) * (img.width / 2);
    const y = bottom - 1 - hash01(d.pos.y + i, d.pos.x) * 2 * t;
    ctx.globalAlpha = t;
    ctx.fillRect(Math.round(x), Math.round(y), 1, 1);
  }
}

function drawShatter(ctx: CanvasRenderingContext2D, d: DeathFx, img: HTMLCanvasElement, t: number): void {
  const hw = img.width / 2;
  const hh = img.height / 2;
  ctx.globalAlpha = 1 - t;
  for (let i = 0; i < SHARD_COUNT; i++) {
    const o = shardOffset(i, SHARD_COUNT, t, EFFECTS.death.shardSpeed * 0.15);
    const sx = i % 2 === 0 ? 0 : hw;
    const sy = i < 2 ? 0 : hh;
    ctx.drawImage(img, sx, sy, hw, hh, Math.round(d.pos.x - hw + sx + o.x), Math.round(d.pos.y - hh + sy + o.y), hw, hh);
  }
}

function drawDischarge(ctx: CanvasRenderingContext2D, d: DeathFx, img: HTMLCanvasElement, t: number, time: number): void {
  const hop = Math.sin(t * Math.PI * 2) * EFFECTS.death.dischargeHop * (1 - t);
  ctx.globalAlpha = 1 - t * t;
  drawFoot(ctx, img, d.pos.x, d.pos.y + img.height / 2 - Math.abs(hop), 1, 1, d.flip);
  // 放電の線（時間で位置が変わる）
  ctx.strokeStyle = deathColor("discharge");
  ctx.lineWidth = 1;
  const flicker = Math.floor(time * DISCHARGE_FLICKER);
  for (let i = 0; i < DISCHARGE_BOLTS; i++) {
    const a = hash01(flicker + i, d.pos.x) * Math.PI * 2;
    const r = img.width * 0.8;
    const mx = d.pos.x + Math.cos(a) * r * 0.5 + (hash01(flicker, i) - 0.5) * 4;
    const my = d.pos.y + Math.sin(a) * r * 0.5;
    ctx.beginPath();
    ctx.moveTo(d.pos.x, d.pos.y);
    ctx.lineTo(mx, my);
    ctx.lineTo(d.pos.x + Math.cos(a) * r, d.pos.y + Math.sin(a) * r);
    ctx.stroke();
  }
}

function drawMelt(ctx: CanvasRenderingContext2D, d: DeathFx, img: HTMLCanvasElement, t: number): void {
  const s = meltScale(t);
  const bottom = d.pos.y + img.height / 2;
  ctx.globalAlpha = 0.6 * (1 - t * 0.5);
  ctx.fillStyle = deathColor("melt");
  ctx.beginPath();
  ctx.ellipse(d.pos.x, bottom, (img.width / 2) * s.sx, PUDDLE_RY, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1 - t * 0.3;
  drawFoot(ctx, img, d.pos.x, bottom, s.sx, s.sy, d.flip);
}

function drawBlood(ctx: CanvasRenderingContext2D, d: DeathFx, img: HTMLCanvasElement, t: number): void {
  // 飛沫: 攻撃の向きに血の点が伸びる
  ctx.fillStyle = deathColor("blood");
  const spread = BLOOD_SPREAD * easeOutCubic(t);
  for (let i = 0; i < BLOOD_DROPS; i++) {
    const a = d.angle + (hash01(d.pos.x + i, d.pos.y) - 0.5) * 1.2;
    const r = spread * (0.4 + hash01(d.pos.y + i, d.pos.x) * 0.8);
    ctx.globalAlpha = 1 - t * 0.6;
    ctx.fillRect(Math.round(d.pos.x + Math.cos(a) * r), Math.round(d.pos.y + Math.sin(a) * r), 2, 2);
  }
  ctx.globalAlpha = Math.max(0, 1 - t * 2);
  drawFoot(ctx, img, d.pos.x, d.pos.y + img.height / 2, 1, 1, d.flip);
}

/** 両断: 攻撃の向きに垂直な切り口で上下に分かれて離れる */
function drawSever(ctx: CanvasRenderingContext2D, d: DeathFx, img: HTMLCanvasElement, t: number): void {
  const gap = severGap(t, EFFECTS.death.severGap);
  const cut = d.angle;
  const nx = Math.cos(cut + Math.PI / 2);
  const ny = Math.sin(cut + Math.PI / 2);
  const size = Math.max(img.width, img.height);
  ctx.globalAlpha = 1 - t * t;
  for (const side of [-1, 1] as const) {
    ctx.save();
    ctx.translate(Math.round(d.pos.x + nx * gap * side), Math.round(d.pos.y + ny * gap * side));
    ctx.rotate(cut);
    ctx.beginPath();
    ctx.rect(-size, side < 0 ? -size : 0, size * 2, size);
    ctx.clip();
    ctx.rotate(-cut);
    ctx.scale(d.flip ? -1 : 1, 1);
    ctx.drawImage(img, -img.width / 2, -img.height / 2);
    ctx.restore();
  }
  // 切り口の白い線（最初だけ）
  if (t < 0.3) {
    ctx.globalAlpha = 1 - t / 0.3;
    ctx.strokeStyle = COLOR_WHITE;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(d.pos.x - Math.cos(cut) * size, d.pos.y - Math.sin(cut) * size);
    ctx.lineTo(d.pos.x + Math.cos(cut) * size, d.pos.y + Math.sin(cut) * size);
    ctx.stroke();
  }
}

function drawVoid(ctx: CanvasRenderingContext2D, d: DeathFx, img: HTMLCanvasElement, t: number): void {
  const s = 1 - easeOutCubic(t);
  ctx.globalAlpha = 1 - t * 0.5;
  drawFoot(ctx, img, d.pos.x, d.pos.y + (img.height / 2) * s, s, s, d.flip);
  ctx.strokeStyle = deathColor("void");
  ctx.lineWidth = 1;
  ctx.globalAlpha = t;
  ctx.beginPath();
  ctx.arc(d.pos.x, d.pos.y, VOID_RING * (1 - t) + 1, 0, Math.PI * 2);
  ctx.stroke();
}

function drawHoly(ctx: CanvasRenderingContext2D, d: DeathFx, img: HTMLCanvasElement, t: number, sprites: FxSprites): void {
  ctx.globalAlpha = 1 - t;
  drawFoot(ctx, img, d.pos.x, d.pos.y + img.height / 2 - HOLY_RISE * easeOutCubic(t), 1, 1, d.flip);
  sprites.glow(d.pos.x, d.pos.y - HOLY_RISE * t, deathColor("holy"), img.width, 0.5 * (1 - t));
}

/** 死に方ごとのスプライトの色（灰は灰色、感電は黒焦げ …） */
function deathTint(d: DeathFx): string | null {
  switch (d.kind) {
    case "ash":
      return deathColor("ash");
    case "shatter":
      return deathColor("shatter");
    case "discharge":
      return COLOR_CHAR;
    case "melt":
      return deathColor("melt");
    case "void":
      return deathColor("void");
    case "holy":
      return COLOR_WHITE;
    default:
      return null;
  }
}

export function drawDeathFx(ctx: CanvasRenderingContext2D, state: GameState, sprites: FxSprites): void {
  const fx = state.effects;
  if (!fx || fx.deaths.length === 0) return;
  for (const d of fx.deaths) {
    const img = sprites.enemy(d.defKey, deathTint(d));
    if (!img) continue;
    const t = deathT(d);
    switch (d.kind) {
      case "ash":
        drawAsh(ctx, d, img, t);
        break;
      case "shatter":
        drawShatter(ctx, d, img, t);
        break;
      case "discharge":
        drawDischarge(ctx, d, img, t, state.time);
        break;
      case "melt":
        drawMelt(ctx, d, img, t);
        break;
      case "blood":
        drawBlood(ctx, d, img, t);
        break;
      case "sever":
        drawSever(ctx, d, img, t);
        break;
      case "void":
        drawVoid(ctx, d, img, t);
        break;
      case "holy":
        drawHoly(ctx, d, img, t, sprites);
        break;
      case "burst":
        break;
    }
  }
  ctx.globalAlpha = 1;
  ctx.lineWidth = 1;
}

// -----------------------------------------------------------------------------
// 演出の印（ワールド座標）
// -----------------------------------------------------------------------------

/** 部屋の床タイルの番号（矩形の部屋は矩形から、洞窟の塊は tiles から） */
function roomFloorTiles(state: GameState, room: RoomState): number[] {
  if (room.tiles) return [...room.tiles];
  const out: number[] = [];
  const { rect } = room;
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) out.push(y * state.map.width + x);
  }
  return out;
}

function isEdgeTile(state: GameState, x: number, y: number): boolean {
  return (
    getTile(state.map, x + 1, y) === Tile.Wall ||
    getTile(state.map, x - 1, y) === Tile.Wall ||
    getTile(state.map, x, y + 1) === Tile.Wall ||
    getTile(state.map, x, y - 1) === Tile.Wall
  );
}

/** 制圧の波: 最後の撃破地点から床が順に明るくなり、塊の縁（壁際）はより強く光る */
function drawClearWave(ctx: CanvasRenderingContext2D, state: GameState, m: FxMark): void {
  const room = state.rooms[m.value];
  if (!room) return;
  const c = EFFECTS.clearWave;
  const half = TILE_SIZE / 2;
  ctx.fillStyle = m.color;
  for (const index of roomFloorTiles(state, room)) {
    const x = index % state.map.width;
    const y = Math.floor(index / state.map.width);
    const dist = Math.hypot(x * TILE_SIZE + half - m.pos.x, y * TILE_SIZE + half - m.pos.y);
    const a = clearWaveAlpha(dist, m.age, m.life, c.speed, c.band);
    if (a <= 0) continue;
    ctx.globalAlpha = a * (isEdgeTile(state, x, y) ? c.edgeAlpha : c.alpha);
    ctx.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
  }
}

/** 封鎖の扉: 格子が上から落ちてきて止まる */
function drawDoorSlam(ctx: CanvasRenderingContext2D, state: GameState, m: FxMark): void {
  const room = state.rooms[m.value];
  if (!room) return;
  const t = markT(m);
  const drop = EFFECTS.doorSlam.drop * (1 - easeOutCubic(Math.min(1, t * 3)));
  ctx.strokeStyle = m.color;
  ctx.lineWidth = 1;
  ctx.globalAlpha = 1 - t;
  for (const index of room.doorTiles) {
    const px = (index % state.map.width) * TILE_SIZE;
    const py = Math.floor(index / state.map.width) * TILE_SIZE - drop;
    ctx.strokeRect(px + 0.5, py + 0.5, TILE_SIZE - 1, TILE_SIZE - 1);
    for (let bx = 4; bx < TILE_SIZE; bx += 4) {
      ctx.beginPath();
      ctx.moveTo(px + bx + 0.5, py);
      ctx.lineTo(px + bx + 0.5, py + TILE_SIZE);
      ctx.stroke();
    }
  }
}

function drawRing(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, alpha: number, width = 1): void {
  if (alpha <= 0 || r <= 0) return;
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
}

/** 見切り: 広がる輪と放射線 */
function drawJustRing(ctx: CanvasRenderingContext2D, m: FxMark): void {
  const c = EFFECTS.justRing;
  const t = markT(m);
  const r = c.radius * easeOutCubic(t);
  drawRing(ctx, m.pos.x, m.pos.y, r, m.color, 1 - t, 2);
  ctx.lineWidth = 1;
  for (let i = 0; i < c.lines; i++) {
    const a = (i / c.lines) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(m.pos.x + Math.cos(a) * r * 0.6, m.pos.y + Math.sin(a) * r * 0.6);
    ctx.lineTo(m.pos.x + Math.cos(a) * r * 1.2, m.pos.y + Math.sin(a) * r * 1.2);
    ctx.stroke();
  }
}

/** 弱点ヒットの割れ: 中心からギザギザのひびが走る */
function drawWeakCrack(ctx: CanvasRenderingContext2D, m: FxMark): void {
  const c = EFFECTS.weakCrack;
  const t = markT(m);
  const len = c.size * easeOutCubic(Math.min(1, t * 3));
  ctx.globalAlpha = 1 - t;
  ctx.strokeStyle = m.color;
  ctx.lineWidth = 1;
  for (let i = 0; i < c.lines; i++) {
    const a = hash01(m.pos.x + i, m.pos.y) * Math.PI * 2;
    const bend = (hash01(m.pos.y + i, m.pos.x) - 0.5) * 1.2;
    ctx.beginPath();
    ctx.moveTo(m.pos.x, m.pos.y);
    ctx.lineTo(m.pos.x + Math.cos(a) * len * 0.5, m.pos.y + Math.sin(a) * len * 0.5);
    ctx.lineTo(m.pos.x + Math.cos(a + bend) * len, m.pos.y + Math.sin(a + bend) * len);
    ctx.stroke();
  }
}

/** 遺物の光柱が空から落ちる（響きの色） */
function drawDropBeam(ctx: CanvasRenderingContext2D, m: FxMark, sprites: FxSprites): void {
  const c = EFFECTS.dropBeam;
  const t = markT(m);
  const color = TRAIT_COLOR_HEX[TRAIT_COLORS[m.value] ?? "gold"];
  const reach = c.height * easeOutCubic(Math.min(1, t * 2.5));
  const top = m.pos.y - c.height;
  ctx.globalAlpha = 1 - t;
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(m.pos.x - c.width / 2), Math.round(top), c.width, Math.round(reach));
  ctx.fillStyle = COLOR_WHITE;
  ctx.fillRect(Math.round(m.pos.x - 1), Math.round(top), 2, Math.round(reach));
  if (t > 0.35) sprites.glow(m.pos.x, m.pos.y, color, 14, 1 - t);
}

function drawDashGhost(ctx: CanvasRenderingContext2D, m: FxMark, sprites: FxSprites): void {
  const img = sprites.player(m.color);
  if (!img) return;
  ctx.globalAlpha = EFFECTS.dashGhost.alpha * (1 - markT(m));
  drawFoot(ctx, img, m.pos.x, m.pos.y + img.height / 2, 1, 1, m.value === 1);
}

function drawWorldMark(ctx: CanvasRenderingContext2D, state: GameState, m: FxMark, sprites: FxSprites): void {
  const t = markT(m);
  switch (m.kind) {
    case "clearWave":
      drawClearWave(ctx, state, m);
      return;
    case "doorSlam":
      drawDoorSlam(ctx, state, m);
      return;
    case "eliteBurst":
      drawRing(ctx, m.pos.x, m.pos.y, EFFECTS.eliteBurst.radius * easeOutCubic(t), m.color, 1 - t, 3);
      sprites.glow(m.pos.x, m.pos.y, m.color, EFFECTS.eliteBurst.radius / 2, 1 - t);
      return;
    case "justRing":
      drawJustRing(ctx, m);
      return;
    case "synergyGlow":
      sprites.glow(m.pos.x, m.pos.y, m.color, EFFECTS.synergyGlow.radius, 0.8 * (1 - t));
      drawRing(ctx, m.pos.x, m.pos.y, EFFECTS.synergyGlow.radius * (0.6 + 0.4 * t), m.color, 1 - t);
      return;
    case "weakCrack":
      drawWeakCrack(ctx, m);
      return;
    case "chargeUp":
      drawRing(ctx, m.pos.x, m.pos.y, EFFECTS.chargeUp.radius * easeOutCubic(t), m.color, 1 - t, 2);
      return;
    case "dropBeam":
      drawDropBeam(ctx, m, sprites);
      return;
    case "dashGhost":
      drawDashGhost(ctx, m, sprites);
      return;
    case "bossLight":
    case "critFlash":
      // 画面全体の光は drawScreenMarks、会心の反転は敵の描画側
      return;
  }
}

/** 足元に置く印（制圧の波・扉・残像）は敵より先に描く */
const GROUND_MARKS: ReadonlySet<FxMark["kind"]> = new Set(["clearWave", "doorSlam", "dashGhost"]);

export function drawGroundMarks(ctx: CanvasRenderingContext2D, state: GameState, sprites: FxSprites): void {
  const fx = state.effects;
  if (!fx) return;
  for (const m of fx.marks) if (GROUND_MARKS.has(m.kind)) drawWorldMark(ctx, state, m, sprites);
  ctx.globalAlpha = 1;
  ctx.lineWidth = 1;
}

export function drawAirMarks(ctx: CanvasRenderingContext2D, state: GameState, sprites: FxSprites): void {
  const fx = state.effects;
  if (!fx) return;
  for (const m of fx.marks) if (!GROUND_MARKS.has(m.kind)) drawWorldMark(ctx, state, m, sprites);
  ctx.globalAlpha = 1;
  ctx.lineWidth = 1;
}

/** 会心の反転中の敵か */
export function critFlashActive(state: GameState, enemyId: number): boolean {
  const fx = state.effects;
  if (!fx) return false;
  return fx.marks.some((m) => m.kind === "critFlash" && m.value === enemyId);
}

// -----------------------------------------------------------------------------
// 画面全体（スクリーン座標）
// -----------------------------------------------------------------------------

const RAY_SPEED = 0.6;
const RAY_LENGTH = Math.hypot(VIEW_W, VIEW_H);

/** ボス撃破の光条と画面全体の光、精鋭撃破の短い色づき。ox / oy はワールド → 画面のずらし */
export function drawScreenMarks(ctx: CanvasRenderingContext2D, state: GameState, ox: number, oy: number): void {
  const fx = state.effects;
  if (!fx) return;
  for (const m of fx.marks) {
    const t = markT(m);
    if (m.kind === "eliteBurst") {
      ctx.globalAlpha = EFFECTS.eliteBurst.tintAlpha * (1 - t);
      ctx.fillStyle = m.color;
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
      continue;
    }
    if (m.kind !== "bossLight") continue;
    const c = EFFECTS.bossLight;
    const x = m.pos.x + ox;
    const y = m.pos.y + oy;
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = m.color;
    ctx.globalAlpha = c.alpha * (1 - t);
    for (const a of rayAngles(c.rays, m.age, RAY_SPEED)) {
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(a - c.rayWidth) * RAY_LENGTH, y + Math.sin(a - c.rayWidth) * RAY_LENGTH);
      ctx.lineTo(x + Math.cos(a + c.rayWidth) * RAY_LENGTH, y + Math.sin(a + c.rayWidth) * RAY_LENGTH);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = c.alpha * (1 - t) * (1 - t);
    ctx.fillStyle = COLOR_WHITE;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
}

const FLOOR_CARD_Y = 70;
const FLOOR_CARD_SUB_GAP = 18;
const FLOOR_CARD_LINE_W = 120;
const FLOOR_CARD_COLOR = "#ffe8a0";
const FLOOR_CARD_SUB_COLOR = "#c0c0c0";

/** 階層到達の名札（地下 n 階 + フロア種別）。elapsed は到達からの秒 */
export function drawFloorCard(ctx: CanvasRenderingContext2D, title: string, sub: string, elapsed: number): void {
  const alpha = floorCardAlpha(elapsed, EFFECTS.floorCard);
  if (alpha <= 0) return;
  ctx.globalAlpha = alpha;
  const cx = VIEW_W / 2;
  drawTextShadow(ctx, title, cx, FLOOR_CARD_Y, TEXT.BIG, FLOOR_CARD_COLOR, COLOR_BLACK, "center");
  ctx.fillStyle = FLOOR_CARD_COLOR;
  const w = Math.round(FLOOR_CARD_LINE_W * easeOutCubic(clamp01(elapsed - EFFECTS.floorCard.delay) * 2));
  ctx.fillRect(Math.round(cx - w / 2), FLOOR_CARD_Y + 4, w, 1);
  drawTextShadow(ctx, sub, cx, FLOOR_CARD_Y + FLOOR_CARD_SUB_GAP, TEXT.BODY, FLOOR_CARD_SUB_COLOR, COLOR_BLACK, "center");
  ctx.globalAlpha = 1;
}
