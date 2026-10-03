import type { Enemy, GameState } from "../core/state";
import { type Vec, add, fromAngle, scale } from "../core/vec";
import type { PinKind } from "../data/weapons";
import { livePins } from "../system/pins";

/**
 * 敵に刺さった飛び物（Enemy.pins。system/pins.ts）を敵の上に小さく描く。state を読むだけ。
 * 刺さった絵がまだ無いので手続きの短い線（クナイ = 柄の点の付いた棒、手裏剣 = 小さな十字）で描く。
 * 飛んできた向き（angle）のまま、敵の体の飛んできた側の縁から外へ突き出す
 */

/** 刺さった先の深さ（体の半径に対する割合。中心から飛んできた側へこれだけ戻った所が先端） */
const TIP_DEPTH = 0.45;
/** クナイの見えている長さ（px） */
const KUNAI_LENGTH = 5;
/** 手裏剣の十字の半分の大きさ（px） */
const SHURIKEN_HALF = 1.5;
/** 同じ向きに重なる刺さりを横へずらす幅（px）と、ずらしの段数 */
const SPREAD_STEP = 1.5;
const SPREAD_SLOTS = 3;
const PIN_COLOR: Readonly<Record<PinKind, string>> = { kunai: "#c9ced8", shuriken: "#aab3c2" };
/** クナイの柄の輪の色 */
const KUNAI_RING_COLOR = "#7a5a3a";

/** 描く 1 本（論理座標）。from は刺さった先、to は外へ突き出た端 */
export interface PinMark {
  kind: PinKind;
  from: Vec;
  to: Vec;
}

/** 1 体の刺さりの描く位置（刺さった順。抜けたものは描かない） */
export function pinMarks(state: Readonly<GameState>, e: Readonly<Enemy>): PinMark[] {
  return livePins(state, e).map((pin, i) => {
    const dir = fromAngle(pin.angle);
    const across = { x: -dir.y, y: dir.x };
    const shift = ((i % SPREAD_SLOTS) - (SPREAD_SLOTS - 1) / 2) * SPREAD_STEP;
    const from = add(add(e.body.pos, scale(dir, -e.body.radius * TIP_DEPTH)), scale(across, shift));
    const length = pin.kind === "kunai" ? KUNAI_LENGTH : SHURIKEN_HALF;
    return { kind: pin.kind, from, to: add(from, scale(dir, -length)) };
  });
}

export function drawPins(ctx: CanvasRenderingContext2D, state: GameState): void {
  for (const e of state.enemies) {
    if (e.hp <= 0 || e.hidden || !e.pins) continue;
    for (const mark of pinMarks(state, e)) drawMark(ctx, mark);
  }
}

function drawMark(ctx: CanvasRenderingContext2D, mark: PinMark): void {
  ctx.strokeStyle = PIN_COLOR[mark.kind];
  ctx.lineWidth = 1;
  ctx.beginPath();
  if (mark.kind === "kunai") {
    ctx.moveTo(mark.from.x, mark.from.y);
    ctx.lineTo(mark.to.x, mark.to.y);
    ctx.stroke();
    ctx.fillStyle = KUNAI_RING_COLOR;
    ctx.fillRect(mark.to.x - 0.5, mark.to.y - 0.5, 1, 1);
    return;
  }
  // 手裏剣は刺さった所に小さな十字（飛んできた向きに 45 度傾ける）
  const c = mark.to;
  const d = { x: mark.to.x - mark.from.x, y: mark.to.y - mark.from.y };
  ctx.moveTo(c.x - d.x - d.y, c.y - d.y + d.x);
  ctx.lineTo(c.x + d.x + d.y, c.y + d.y - d.x);
  ctx.moveTo(c.x - d.x + d.y, c.y - d.y - d.x);
  ctx.lineTo(c.x + d.x - d.y, c.y + d.y + d.x);
  ctx.stroke();
}
