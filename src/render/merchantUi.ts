import type { GameState, Merchant } from "../core/state";
import type { Vec } from "../core/vec";
import { ECONOMY, ROOM_KIND } from "../data/tuning";
import { MERCHANT_LABEL, wareLabel } from "../system/merchants";
import { TEXT, drawTextShadow } from "./pixelText";
import { pulse } from "./renderMath";

/**
 * 商人の名札・台座・品札（system/merchants.ts）。体は敵の絵として renderer が描くので、ここは名札と台座だけ。
 * 台座の四角と「いちばん近い台座の名前だけ出す」規則は契約者（runUi.ts の drawContractor）と共用する。state を読むだけ
 */

/** 触れて選ぶ台座（契約者の台座・商人の品）の共通の形 */
export interface StallSpot {
  pos: Vec;
  used: boolean;
}

const COLOR_SHADOW = "#000000";
const COLOR_DIM = "#909090";
const SPOT_SIZE = 5;
const SPOT_PULSE_SPEED = 3;
const LABEL_LIFT = 10;
const NAME_LIFT = 16;

/** 使っていない台座を明滅する四角で描く */
export function drawStallSpots(ctx: CanvasRenderingContext2D, state: GameState, spots: readonly StallSpot[], color: string): void {
  for (const spot of spots) {
    if (spot.used) continue;
    ctx.globalAlpha = pulse(state.time, SPOT_PULSE_SPEED, 0.5, 1);
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(spot.pos.x - SPOT_SIZE / 2), Math.round(spot.pos.y - SPOT_SIZE / 2), SPOT_SIZE, SPOT_SIZE);
    ctx.globalAlpha = 1;
  }
}

/** 名前を読める距離（ROOM_KIND.propLabelRange）にある、まだ使っていない台座のうち最も近いもの */
export function nearestStallSpot<T extends StallSpot>(state: GameState, spots: readonly T[]): T | null {
  const p = state.player.body.pos;
  let best: T | null = null;
  let bestDist: number = ROOM_KIND.propLabelRange;
  for (const spot of spots) {
    if (spot.used) continue;
    const d = Math.hypot(p.x - spot.pos.x, p.y - spot.pos.y);
    if (d > bestDist) continue;
    best = spot;
    bestDist = d;
  }
  return best;
}

/** 台座の上に出す品札の色: 払えるなら商人の色、払えなければ暗く */
export function wareLabelColor(state: GameState, price: number): string {
  return state.economy.coins >= price ? ECONOMY.market.color : COLOR_DIM;
}

/** この階の商人の名札・台座・いちばん近い品札（ワールド座標） */
export function drawMerchants(ctx: CanvasRenderingContext2D, state: GameState): void {
  for (const m of state.economy.merchants) drawMerchant(ctx, state, m);
}

function drawMerchant(ctx: CanvasRenderingContext2D, state: GameState, m: Merchant): void {
  const p = state.player.body.pos;
  const color = ECONOMY.market.color;
  const near = Math.hypot(p.x - m.pos.x, p.y - m.pos.y) <= ECONOMY.market.greetRange * 2;
  if (near) drawTextShadow(ctx, MERCHANT_LABEL[m.kind], m.pos.x, m.pos.y - NAME_LIFT, TEXT.SMALL, color, COLOR_SHADOW, "center");
  // 怒った商人は売らないので台座を出さない
  if (m.provoked) return;
  drawStallSpots(ctx, state, m.wares, color);
  // 台座どうしが近く名前が重なるので、いちばん近い台座の名前だけを出す
  const ware = nearestStallSpot(state, m.wares);
  if (!ware) return;
  drawTextShadow(ctx, wareLabel(ware), ware.pos.x, ware.pos.y - LABEL_LIFT, TEXT.SMALL, wareLabelColor(state, ware.price), COLOR_SHADOW, "center");
}
