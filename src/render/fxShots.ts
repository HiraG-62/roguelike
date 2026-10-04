/**
 * 弾のスプライト（docs/ideas/fx-sprites.md 9 章）。弾の key（と奥義の行為が出した弾）から絵の表を引き、
 * 飛んでいる弾・炸裂の輪を描く。銃口・着弾・尽きたときの絵は fxAttack.ts の出来事に載せて流す。
 * state は読むだけ。読み込み前・表の無い弾は false を返し、呼び出し側が今までの手続きの描画を使う
 */
import type { GameState, Projectile, ShapeFx } from "../core/state";
import { blastShotOf, hitElement, shotBulletOf, ultimateShotOf } from "../system/effects";
import { ultimateDef } from "../data/ultimates";
import { FX_ATTACK } from "../data/tuning";
import { type FxRampKey, type FxSpriteBank, fitScale, lifeFrame, loopFrame, rampGlow, sheetDef } from "./fxSprites";
import { BULLET_FX, type BulletFx, ULTIMATE_FX, rampOfElement } from "./fxMotions";
import { bulletArtKey } from "../data/weapons";
import type { GlowFn } from "./fxAttack";

/** 弾ごとに繰り返しの位相をずらす（同時に撃った弾が同じコマで揃って見えないように） */
const PHASE_PER_ID = 0.137;

/** 弾の絵。奥義の行為が出した弾はその奥義の絵、それ以外は弾の key の絵。敵の弾・表の無い弾は undefined */
export function shotFx(pr: Projectile): BulletFx | undefined {
  if (pr.owner !== "player") return undefined;
  const ult = ultimateShotOf(pr);
  if (ult) {
    const own = ULTIMATE_FX[ult.key]?.shots[ult.index];
    if (own) return own;
  }
  const key = shotBulletOf(pr);
  return key === undefined ? undefined : BULLET_FX.get(bulletArtKey(key));
}

/**
 * 弾の配色: 弾そのものの属性（魔法の弾・奥義の素性）→ 射撃の属性（装備）。どれも無ければ無属性の墨（steel）。
 * 表の既定の配色（真鍮・炎など）は使わない（墨の主題: 無属性は墨の濃淡で描く。docs/ideas/fx-sprites.md 3.6）
 */
export function shotRamp(state: GameState, pr: Projectile): FxRampKey {
  const ult = ultimateShotOf(pr);
  if (ult) {
    const element = ultimateDef(ult.key)?.attack.element ?? "none";
    return rampOfElement(element);
  }
  const own = pr.attack?.element ?? "none";
  if (own !== "none") return rampOfElement(own);
  const gear = hitElement(state, "ranged", false);
  return rampOfElement(gear);
}

/** 飛んでいる弾を描く（x, y は描く位置。曲射は持ち上げた位置）。描けたら true */
export function drawShotSprite(ctx: CanvasRenderingContext2D, state: GameState, pr: Projectile, x: number, y: number, bank: FxSpriteBank, glow: GlowFn): boolean {
  const fx = shotFx(pr);
  if (!fx || !bank.has(fx.fly)) return false;
  const sheet = sheetDef(fx.fly);
  const frame = loopFrame(sheet.frames, state.time + pr.id * PHASE_PER_ID, fx.period);
  const angle = Math.atan2(pr.vel.y, pr.vel.x);
  const c = FX_ATTACK.sprite;
  const ramp = shotRamp(state, pr);
  if (c.bulletGlow > 0) glow(x, y, rampColor(ramp), Math.round(c.bulletGlowR + pr.radius), c.bulletGlow);
  return bank.draw(ctx, fx.fly, frame, x, y, angle, { ramp, scale: fitScale(pr.radius, fx.base, c.scaleTolerance) });
}

/** 光の色（配色の滲みの色。加算の光は絵より淡く、弾の色の見当だけを付ける。墨の配色は明部が暗いので段からは取らない） */
function rampColor(ramp: FxRampKey): string {
  return rampGlow(ramp);
}

/**
 * 炸裂の輪（設置弾・曲射の爆発）を弾の絵で描く。描けたら true（手続きの爆発を描かない）。
 * 輪の寿命で全フレームを流し、絵の炸裂の半径と今の半径が違えば拡縮する
 */
export function drawBlastSprite(ctx: CanvasRenderingContext2D, state: GameState, s: ShapeFx, bank: FxSpriteBank): boolean {
  const pr = blastShotOf(s);
  const fx = pr ? shotFx(pr) : undefined;
  if (!pr || !fx?.blast || !bank.has(fx.blast)) return false;
  const frame = lifeFrame(sheetDef(fx.blast).frames, s.maxLife - s.life, s.maxLife);
  if (frame === null) return true;
  const scale = fitScale(s.radius, fx.blastBase, FX_ATTACK.sprite.scaleTolerance);
  return bank.draw(ctx, fx.blast, frame, s.pos.x, s.pos.y, 0, { ramp: shotRamp(state, pr), scale });
}
