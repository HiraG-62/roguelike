import type { Pickup } from "../core/state";
import { COIN_SPRITE_KEYS } from "../data/sprites/economy";
import { ECONOMY } from "../data/tuning";
import { type SpriteAtlas, drawFrame, spriteFrame } from "./sprites";

/**
 * 床に落ちている銭・鍵・瓶の描画（docs/ideas/economy-impl.md 2-2）。state を読むだけで、乱数は使わない。
 * 絵は data/sprites/economy.ts（銭は額で 3 段・鍵・瓶）。アトラスが無い・絵が無いときは、銭は金色の小さな菱形、鍵は輪と軸、瓶は小さな壺で描く。
 * 心臓（heart）は従来どおり renderer.ts がスプライトで描く。
 */

/** 銭の額の段（大きさ 3 段）。額が大きいほど菱形が大きい */
export type CoinTier = 0 | 1 | 2;

/** 中・大の菱形になる額（見た目の閾値。ゲームの数値ではない） */
const COIN_MID_VALUE = 3;
const COIN_BIG_VALUE = 8;
/** 段ごとの菱形の半径（論理座標 px） */
const COIN_HALF_SIZE: Readonly<Record<CoinTier, number>> = { 0: 2, 1: 3, 2: 4 };
/** 点滅の半周期（秒）。消える直前の 2 秒を、この間隔で出たり消えたりする */
const BLINK_HALF_SEC = 0.12;

const BOB_SPEED = 4;
const BOB_AMOUNT = 2;
const SHADOW_ALPHA = 0.3;
const SHADOW_COLOR = "#000000";
const SHADOW_RX_RATIO = 0.9;
const SHADOW_RY_RATIO = 0.4;
const COIN_RIM_COLOR = "#7a5a10";
const COIN_LIGHT_COLOR = "#fff2b0";
const KEY_RING_R = 2;
const KEY_STEM_LEN = 4;
const KEY_TOOTH = 1;
const FLASK_W = 5;
const FLASK_H = 6;
const FLASK_NECK_W = 3;
const FLASK_NECK_H = 2;
/** 床の拾い物の絵の 1 フレームの秒数（銭が回る・照りが動く速さ） */
const PICKUP_FRAME_TIME = 0.14;
const KEY_SPRITE = "pickup.key";
const FLASK_SPRITE = "pickup.flask";

/** 額から大きさの段を決める */
export function coinTier(value: number): CoinTier {
  if (value >= COIN_BIG_VALUE) return 2;
  if (value >= COIN_MID_VALUE) return 1;
  return 0;
}

/** 菱形の半径（px） */
export function coinHalfSize(value: number): number {
  return COIN_HALF_SIZE[coinTier(value)];
}

/**
 * 点滅の「消えている側」か。残り秒 life が blinkSec 以下のあいだだけ、半周期ごとに交互に消える。
 * life（tick ごとに減る）だけで決まるので乱数も実時間も使わず、同じ state は同じ絵になる
 */
export function isBlinkHidden(life: number | undefined, blinkSec: number): boolean {
  if (life === undefined || life > blinkSec) return false;
  return Math.floor(Math.max(0, life) / BLINK_HALF_SEC) % 2 === 1;
}

/** 床の拾い物の絵のキー（銭は額の段で変える）。絵を持たない種類は null */
export function fieldPickupSpriteKey(pk: Pick<Pickup, "kind" | "value">): string | null {
  switch (pk.kind) {
    case "coin":
      return COIN_SPRITE_KEYS[coinTier(pk.value ?? 1)];
    case "key":
      return KEY_SPRITE;
    case "flask":
      return FLASK_SPRITE;
    default:
      return null;
  }
}

/** 床の銭・鍵・瓶を 1 つ描く（heart は呼び出し側が描く）。atlas に絵があれば絵で、無ければ図形で */
export function drawFieldPickup(ctx: CanvasRenderingContext2D, pk: Pickup, atlas?: SpriteAtlas): void {
  if (isBlinkHidden(pk.life, ECONOMY.coin.blinkSec)) return;
  const x = Math.round(pk.pos.x);
  const bob = Math.round(Math.sin(pk.bobTime * BOB_SPEED) * BOB_AMOUNT);
  const y = Math.round(pk.pos.y) + bob;
  if (drawPickupSprite(ctx, pk, atlas, x, y)) return;
  switch (pk.kind) {
    case "coin":
      drawCoin(ctx, x, y, pk.value ?? 1, Math.round(pk.pos.y));
      return;
    case "key":
      drawKey(ctx, x, y, Math.round(pk.pos.y));
      return;
    case "flask":
      drawFlask(ctx, x, y, Math.round(pk.pos.y));
      return;
    default:
      return;
  }
}

/** 絵で描く。中心を (x, y) に置き、影は揺れない足元に。絵が無ければ false */
function drawPickupSprite(ctx: CanvasRenderingContext2D, pk: Pickup, atlas: SpriteAtlas | undefined, x: number, y: number): boolean {
  const key = fieldPickupSpriteKey(pk);
  const sprite = key ? atlas?.[key] : undefined;
  if (!sprite) return false;
  const img = sprite.frames[spriteFrame(sprite, pk.bobTime, PICKUP_FRAME_TIME)];
  if (!img) return false;
  drawGroundShadow(ctx, x, Math.round(pk.pos.y), sprite.h / 2);
  drawFrame(ctx, sprite, img, x - sprite.w / 2, y - sprite.h / 2);
  return true;
}

function drawGroundShadow(ctx: CanvasRenderingContext2D, x: number, groundY: number, half: number): void {
  ctx.globalAlpha = SHADOW_ALPHA;
  ctx.fillStyle = SHADOW_COLOR;
  ctx.beginPath();
  ctx.ellipse(x, groundY + half, Math.max(1, half * SHADOW_RX_RATIO), Math.max(1, half * SHADOW_RY_RATIO), 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
}

function diamondPath(ctx: CanvasRenderingContext2D, x: number, y: number, half: number): void {
  ctx.beginPath();
  ctx.moveTo(x, y - half);
  ctx.lineTo(x + half, y);
  ctx.lineTo(x, y + half);
  ctx.lineTo(x - half, y);
  ctx.closePath();
}

/** 金色の菱形。縁を暗く、中心に小さな照りを置いて、小さくても銭と読める */
function drawCoin(ctx: CanvasRenderingContext2D, x: number, y: number, value: number, groundY: number): void {
  const half = coinHalfSize(value);
  drawGroundShadow(ctx, x, groundY, half);
  diamondPath(ctx, x, y, half + 1);
  ctx.fillStyle = COIN_RIM_COLOR;
  ctx.fill();
  diamondPath(ctx, x, y, half);
  ctx.fillStyle = ECONOMY.coin.color;
  ctx.fill();
  ctx.fillStyle = COIN_LIGHT_COLOR;
  ctx.fillRect(x - 1, y - 1, 1, 1);
}

/** 鍵: 輪と軸と歯 */
function drawKey(ctx: CanvasRenderingContext2D, x: number, y: number, groundY: number): void {
  drawGroundShadow(ctx, x, groundY, KEY_RING_R + KEY_STEM_LEN / 2);
  ctx.fillStyle = ECONOMY.key.color;
  ctx.beginPath();
  ctx.arc(x, y - KEY_STEM_LEN / 2, KEY_RING_R, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(x, y - KEY_STEM_LEN / 2, 1, KEY_STEM_LEN + KEY_RING_R);
  ctx.fillRect(x + 1, y + KEY_STEM_LEN / 2, KEY_TOOTH + 1, 1);
}

/** 瓶: 首と胴 */
function drawFlask(ctx: CanvasRenderingContext2D, x: number, y: number, groundY: number): void {
  drawGroundShadow(ctx, x, groundY, FLASK_H / 2);
  ctx.fillStyle = ECONOMY.flask.color;
  ctx.fillRect(x - Math.floor(FLASK_NECK_W / 2), y - FLASK_H / 2 - FLASK_NECK_H, FLASK_NECK_W, FLASK_NECK_H);
  ctx.fillRect(x - Math.floor(FLASK_W / 2), y - FLASK_H / 2, FLASK_W, FLASK_H);
}
