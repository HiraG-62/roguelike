import type { Enemy, GameState, Jin, JinzuStroke } from "../core/state";
import { type Vec, normalize, sub } from "../core/vec";
import { JINZU, TELEGRAPH } from "../data/tuning";
import { TILE_SIZE } from "../map/grid";
import { pointAtFraction } from "../map/jinzuShape";
import { poiseRatio } from "../system/poise";
import { type InkSurface, sharedInkSurface } from "./inkSurface";
import { hash01 } from "./renderMath";
import { drawHeadMark, placePoly, sketchGap } from "./telegraphInk";

/**
 * 本陣の陣図の描画（docs/ideas/jinzu-impl.md 2-4）。state を読むだけで、乱数は使わない（擦れの散りは座標ハッシュ）。
 * 予告と同じ文法で描く: 書きかけの画 = 薄墨の下絵（明るく淡い掠れた帯。大将の怯み値が溜まるほど掠れる）、
 * 墨の入った画 = 濃墨の一筆（外に胡粉・入りに朱）、構え = 太く矢じり付き + 隊の頭上に ●（濃墨に朱）。
 * 画と頭上の印は予告と同じ作業面（inkSurface.ts）のドットの墨で、全部の本陣の分をまとめて 1 回だけ画面へ置く。
 * 的はその下、筆先・矢じり・軍配はその上に ctx で描く。world 層の床の印の後・敵の下に描く
 */

const FLAG_POLE_H = 14;
const FLAG_W = 9;
const FLAG_H = 7;
const FLAG_POLE_W = 1;
const GUNBAI_RADIUS = 3.5;
const GUNBAI_RISE = 9;
const TIP_CASING = 1;
const ARROW_LEN = 7;
const ARROW_HALF = 4;
const HEAD_MARK_RISE = 6;
/** 擦れて散る下絵の横ずれの大きさ（px）。座標ハッシュで決める */
const DRIFT_PX = 3;
const MINI_POLE_H = 4;
const MINI_FLAG = 2;

const COLOR_SHADOW = "#000000";
/** 的の墨の点・旗倒れの墨の波紋の濃さ */
const TARGET_ALPHA = 0.8;
const RIPPLE_ALPHA = 0.8;

function leaderOf(state: GameState, jin: Jin): Enemy | undefined {
  if (jin.leaderId === null) return undefined;
  return state.enemies.find((e) => e.id === jin.leaderId && e.hp > 0);
}

/** 墨の画: 画 1 本を折れ角でも途切れない濃墨の一筆で引く（入りに朱・外に胡粉）。widthMul は構えで太らせる倍率、id は筆の変種の鍵 */
function strokeInkPolyline(surf: InkSurface, points: readonly Vec[], id: number, widthMul: number, alpha: number): void {
  placePoly(surf, points, "ink", id, 0, alpha, widthMul);
}

/** 終点の矢じり（走る向きを見せる）。胡粉の縁 + 濃墨 */
function drawArrowhead(ctx: CanvasRenderingContext2D, points: readonly Vec[], alpha: number): void {
  const end = points[points.length - 1];
  const before = points[points.length - 2];
  if (!end || !before) return;
  const dir = normalize(sub(end, before));
  const nx = -dir.y;
  const ny = dir.x;
  const tip = { x: end.x + dir.x * ARROW_LEN, y: end.y + dir.y * ARROW_LEN };
  const fill = (grow: number, color: string, a: number): void => {
    ctx.fillStyle = color;
    ctx.globalAlpha = a;
    ctx.beginPath();
    ctx.moveTo(tip.x + dir.x * grow, tip.y + dir.y * grow);
    ctx.lineTo(end.x + nx * (ARROW_HALF + grow), end.y + ny * (ARROW_HALF + grow));
    ctx.lineTo(end.x - nx * (ARROW_HALF + grow), end.y - ny * (ARROW_HALF + grow));
    ctx.closePath();
    ctx.fill();
  };
  fill(TIP_CASING, TELEGRAPH.gofunColor, alpha);
  fill(0, TELEGRAPH.sumiColor, alpha);
  ctx.globalAlpha = 1;
}

/** 的（掲げた瞬間のプレイヤーの位置）: 墨の点に薄墨の輪。構えに入ると朱の輪になる */
function drawTarget(ctx: CanvasRenderingContext2D, at: Vec, inked: boolean): void {
  const r = JINZU.draw.targetRadius;
  ctx.fillStyle = TELEGRAPH.sumiColor;
  ctx.globalAlpha = TARGET_ALPHA;
  ctx.beginPath();
  ctx.arc(at.x, at.y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = inked ? TELEGRAPH.shuColor : TELEGRAPH.usuzumiLightColor;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(at.x, at.y, r - 1, 0, Math.PI * 2);
  ctx.stroke();
}

/** 筆先の点: 下絵の上を strokeSec で進む（墨が入るまでの残りを見せる）。墨の縁に薄墨 */
function drawBrushTip(ctx: CanvasRenderingContext2D, points: readonly Vec[], f: number): void {
  const p = pointAtFraction(points, f);
  const size = JINZU.draw.tipSize;
  const half = size / 2;
  ctx.fillStyle = TELEGRAPH.sumiColor;
  ctx.fillRect(p.x - half - TIP_CASING, p.y - half - TIP_CASING, size + TIP_CASING * 2, size + TIP_CASING * 2);
  ctx.fillStyle = TELEGRAPH.usuzumiLightColor;
  ctx.fillRect(p.x - half, p.y - half, size, size);
}

/** 下絵の画（薄墨の掠れた帯。画 1 本を折れ角で途切れない 1 筆で引く）。alpha と drift は筆折れの擦れ（散って消える）で使う */
function drawSketch(surf: InkSurface, jinId: number, index: number, stroke: JinzuStroke, gap: number, alpha: number, drift: number): void {
  const id = jinId * 1000 + index;
  const dx = (hash01(id * 7 + 1, 3) - 0.5) * 2 * DRIFT_PX * drift;
  const dy = (hash01(id * 7 + 2, 3) - 0.5) * 2 * DRIFT_PX * drift;
  placePoly(surf, stroke.points, "sketch", id, gap, alpha, 1, dx, dy);
}

function isHeld(jin: Jin): boolean {
  const phase = jin.jinzu?.phase;
  return phase === "hold" || phase === "charge";
}

/** 画 1 本の墨（作業面へ） */
function placeStroke(surf: InkSurface, state: GameState, jin: Jin, index: number, stroke: JinzuStroke, gap: number): void {
  const now = state.time;
  switch (stroke.state) {
    case "sketch":
      drawSketch(surf, jin.id, index, stroke, gap, 1, 0);
      return;
    case "erased": {
      const f = (now - (stroke.endedAt ?? now)) / JINZU.draw.breakFadeSec;
      if (f < 1) drawSketch(surf, jin.id, index, stroke, gap, 1 - f, f);
      return;
    }
    case "ink":
      // 走り出した後は隊頭が走り抜けた所から後ろが掠れて消える（trimRun）
      strokeInkPolyline(surf, stroke.points, jin.id * 1000 + index, isHeld(jin) ? JINZU.draw.holdWidthMul : 1, 1);
      return;
    case "done": {
      const f = (now - (stroke.endedAt ?? now)) / JINZU.draw.fadeSec;
      if (f >= 1 || stroke.kind === "volley") return;
      strokeInkPolyline(surf, stroke.points, jin.id * 1000 + index, 1, 1 - f);
      return;
    }
    case "pending":
      return;
  }
}

/** 画 1 本の上に ctx で重ねる物: 下絵の筆先・構えの矢じり */
function drawStrokeTop(ctx: CanvasRenderingContext2D, jin: Jin, stroke: JinzuStroke): void {
  const jz = jin.jinzu;
  if (!jz) return;
  if (stroke.state === "sketch") drawBrushTip(ctx, stroke.points, (jz.t - stroke.appearAt) / jz.strokeSec);
  if (stroke.state === "ink" && isHeld(jin)) drawArrowhead(ctx, stroke.points, 1);
}

/** 走っている画は、隊頭が走り抜けた点から先だけを濃く残す（走った後ろから画が掠れて消える） */
function trimRun(stroke: JinzuStroke): JinzuStroke {
  if (stroke.state !== "ink" || stroke.progress <= 0) return stroke;
  const from = Math.floor(stroke.progress * (stroke.points.length - 1));
  return { ...stroke, points: stroke.points.slice(Math.max(0, from)) };
}

/** 構えの間、墨の画の隊の頭上に ●（濃墨に朱。総掛かりへ入る合図）。隊の兵 1 人ずつに出す */
function drawHoldMarks(surf: InkSurface, state: GameState, jin: Jin): void {
  const jz = jin.jinzu;
  if (!jz || jz.phase !== "hold") return;
  const ids = new Set<number>();
  for (const s of jz.strokes) if (s.state === "ink") for (const id of s.squad) ids.add(id);
  for (const e of state.enemies) {
    if (e.hp <= 0 || !ids.has(e.id) || e.jinzuRun?.jin !== jin.id) continue;
    drawHeadMark(surf, e.body.pos.x, e.body.pos.y - e.body.radius - HEAD_MARK_RISE, "ink");
  }
}

/** 軍配（団扇）: 筆を持つ・構える大将の頭上に小さな扇と竿 */
function drawGunbai(ctx: CanvasRenderingContext2D, leader: Enemy): void {
  const x = Math.round(leader.body.pos.x);
  const y = Math.round(leader.body.pos.y - leader.body.radius - GUNBAI_RISE);
  ctx.fillStyle = COLOR_SHADOW;
  ctx.fillRect(x - 1, y, 3, GUNBAI_RISE - 2);
  ctx.beginPath();
  ctx.arc(x, y, GUNBAI_RADIUS + 1, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = JINZU.draw.flagColor;
  ctx.beginPath();
  ctx.arc(x, y, GUNBAI_RADIUS, 0, Math.PI * 2);
  ctx.fill();
}

function jinzuActive(jin: Jin): boolean {
  const phase = jin.jinzu?.phase;
  return phase === "raise" || phase === "brush" || phase === "hold" || phase === "charge";
}

/** 描く陣図を持つ本陣 */
function drawnJins(state: GameState): Jin[] {
  return state.jins.filter((jin) => (jin.jinzu?.strokes.length ?? 0) > 0);
}

/** 1 つの本陣の画と頭上の印を作業面へ */
function placeJin(surf: InkSurface, state: GameState, jin: Jin): void {
  const jz = jin.jinzu;
  if (!jz) return;
  const leader = leaderOf(state, jin);
  const gap = sketchGap(leader ? poiseRatio(leader) : 0);
  jz.strokes.forEach((s, i) => placeStroke(surf, state, jin, i, trimRun(s), gap));
  drawHoldMarks(surf, state, jin);
}

/** 本陣の陣図すべて（world 層。renderer.ts が drawGroundMarks の後に呼ぶ）。的 → 墨の画（作業面 1 回）→ 筆先・矢じり・軍配の順 */
export function drawJinzu(ctx: CanvasRenderingContext2D, state: GameState): void {
  const jins = drawnJins(state);
  for (const jin of jins) {
    const jz = jin.jinzu;
    if (jz && jinzuActive(jin)) drawTarget(ctx, jz.target, isHeld(jin));
  }
  if (jins.length > 0) {
    const surf = sharedInkSurface();
    surf.begin(ctx);
    for (const jin of jins) placeJin(surf, state, jin);
    surf.flush(ctx);
  }
  for (const jin of jins) {
    for (const s of jin.jinzu?.strokes ?? []) drawStrokeTop(ctx, jin, trimRun(s));
    const leader = leaderOf(state, jin);
    if (leader?.jinzuRun && jinzuActive(jin)) drawGunbai(ctx, leader);
  }
  for (const jin of state.jins) if (jin.flagFall) drawFlagFall(ctx, state, jin);
}

// -----------------------------------------------------------------------------
// 馬印（本陣の大将の頭上の旗）と旗倒れ
// -----------------------------------------------------------------------------

/** 馬印: 長い竿の先に大きな三角の旗（仮の絵。正式な絵は後）。pole の根元 (x, baseY) */
export function drawHonjinBanner(ctx: CanvasRenderingContext2D, x: number, baseY: number, tilt = 0): void {
  ctx.save();
  ctx.translate(x, baseY);
  ctx.rotate(tilt);
  const poleX = -Math.floor(FLAG_POLE_W / 2);
  ctx.fillStyle = COLOR_SHADOW;
  ctx.fillRect(poleX - 1, -FLAG_POLE_H - 1, FLAG_POLE_W + 2, FLAG_POLE_H + 2);
  ctx.fillRect(poleX, -FLAG_POLE_H - 1, FLAG_W + 2, FLAG_H + 2);
  ctx.fillStyle = JINZU.draw.flagColor;
  ctx.fillRect(poleX, -FLAG_POLE_H, FLAG_POLE_W, FLAG_POLE_H);
  for (let row = 0; row < FLAG_H; row++) {
    const w = Math.max(1, Math.round(FLAG_W * (1 - row / FLAG_H)));
    ctx.fillRect(poleX + FLAG_POLE_W, -FLAG_POLE_H + row, w, 1);
  }
  ctx.restore();
}

/** 旗倒れ: 馬印が傾いて倒れ（flagFallSec）、倒れた所から墨の波紋が広がる（rippleSec）。時刻は jin.flagFall.at からの経過 */
function drawFlagFall(ctx: CanvasRenderingContext2D, state: GameState, jin: Jin): void {
  const fall = jin.flagFall;
  if (!fall) return;
  const t = state.time - fall.at;
  if (t < 0) return;
  const fallT = Math.min(1, t / JINZU.draw.flagFallSec);
  if (t <= JINZU.draw.flagFallSec * 2) drawHonjinBanner(ctx, fall.pos.x, fall.pos.y, (fallT * Math.PI) / 2);
  const rt = t / JINZU.draw.rippleSec;
  if (rt >= 1) return;
  const radius = JINZU.draw.rippleRadius * (1 - (1 - rt) * (1 - rt));
  ctx.strokeStyle = TELEGRAPH.sumiColor;
  ctx.globalAlpha = (1 - rt) * RIPPLE_ALPHA;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(fall.pos.x, fall.pos.y, radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = JINZU.draw.flagColor;
  ctx.globalAlpha = 1 - rt;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.globalAlpha = 1;
}

// -----------------------------------------------------------------------------
// ミニマップの印（探索の前から出す。どの山とどこから戦うかを地図で選ぶ）
// -----------------------------------------------------------------------------

/** 決着していない本陣の中心に小さな旗の印を打つ。x0 / y0 は地図の左上、scale は 1 タイルあたりの画素 */
export function drawMinimapHonjin(target: CanvasRenderingContext2D, state: GameState, x0: number, y0: number, scale: number): void {
  for (const jin of state.jins) {
    if (!jin.honjin || jin.phase === "settled") continue;
    const mx = x0 + Math.floor((jin.center.x / TILE_SIZE) * scale);
    const my = y0 + Math.floor((jin.center.y / TILE_SIZE) * scale);
    target.fillStyle = COLOR_SHADOW;
    target.fillRect(mx - 1, my - MINI_POLE_H - 1, MINI_FLAG + 3, MINI_POLE_H + 3);
    target.fillStyle = JINZU.draw.flagColor;
    target.fillRect(mx, my - MINI_POLE_H, 1, MINI_POLE_H + 1);
    for (let row = 0; row < MINI_FLAG; row++) target.fillRect(mx + 1, my - MINI_POLE_H + row, MINI_FLAG - row, 1);
  }
}
