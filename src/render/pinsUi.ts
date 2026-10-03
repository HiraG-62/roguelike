import type { Enemy, GameState } from "../core/state";
import { type Vec, add, fromAngle, scale } from "../core/vec";
import { pinSpriteKey } from "../data/sprites/weapons";
import type { PinKind } from "../data/weapons";
import { livePins } from "../system/pins";
import type { SpriteAtlas } from "./sprites";

/**
 * 敵に刺さった飛び物（Enemy.pins。system/pins.ts）を敵の上に小さく描く。state を読むだけ（rng も使わない）。
 * 刺さった絵（data/sprites/weapons.ts の pin.kunai / pin.shuriken）を飛んできた向き（angle）へ回し、
 * 敵の体の飛んできた側の縁から外へ突き出す。絵が読めていない間は手続きの短い線（クナイ = 柄の点の付いた棒、手裏剣 = 小さな十字）
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
/** 刺さったクナイの絵の右端（埋まった刃の根元）を、刺さった先からさらに奥へ入れる量（px） */
const KUNAI_SINK = 1.5;
/** 手裏剣の絵は尖りを斜めにして、飛んできた向きへ 1 本が刺さって見えるように回す */
const SHURIKEN_TURN = Math.PI / 4;

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

export function drawPins(ctx: CanvasRenderingContext2D, state: GameState, atlas: SpriteAtlas): void {
  for (const e of state.enemies) {
    if (e.hp <= 0 || e.hidden || !e.pins) continue;
    for (const mark of pinMarks(state, e)) {
      if (!drawPinSprite(ctx, atlas, mark)) drawMark(ctx, mark);
    }
  }
}

/** 刺さった絵を回して置く。クナイは絵の右端を刺さった先へ、手裏剣は絵の中心を外の端へ合わせる。絵が無ければ false */
function drawPinSprite(ctx: CanvasRenderingContext2D, atlas: SpriteAtlas, mark: PinMark): boolean {
  const sprite = atlas[pinSpriteKey(mark.kind)];
  const img = sprite?.frames[0];
  if (!sprite || !img) return false;
  const angle = Math.atan2(mark.from.y - mark.to.y, mark.from.x - mark.to.x);
  const kunai = mark.kind === "kunai";
  const at = kunai ? mark.from : mark.to;
  ctx.save();
  ctx.translate(at.x, at.y);
  ctx.rotate(kunai ? angle : angle + SHURIKEN_TURN);
  const x = kunai ? KUNAI_SINK - sprite.w : -sprite.w / 2;
  ctx.drawImage(img, x, -sprite.h / 2, sprite.w, sprite.h);
  ctx.restore();
  return true;
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
