import { type Enemy, type GameState, type Merchant, pushSfx } from "../core/state";
import { add, scale } from "../core/vec";
import { depthDamage } from "../data/enemies";
import { ECONOMY } from "../data/tuning";
import { addFloatingText } from "./effects";
import { fanDirections, fireEnemyBullet } from "./enemyTraits";

/**
 * 商人の体（Enemy）の振る舞い（behaviors/families.ts の Merchant から呼ぶ）。
 * 市の台座・品・倒れた後の処理は system/merchants.ts。ここは behaviors から import されるので、
 * loot / skills / contractors のような重いモジュールを読まない（registry の循環 import を増やさない）
 */

const PROVOKED_TEXT = "激怒";
const TEXT_LIFT = 12;
const TEXT_SCALE = 1;
const TEXT_LIFE = 1.2;

/** その Enemy が立っている商人（いなければ undefined） */
export function merchantOf(state: GameState, e: Enemy): Merchant | undefined {
  return state.economy.merchants.find((m) => m.enemyId === e.id);
}

/** 怒っているか（攻撃を始めてよいか） */
export function merchantProvoked(state: GameState, e: Enemy): boolean {
  return merchantOf(state, e)?.provoked === true;
}

/**
 * 殴られて怒る（damageEnemy の onStruck。プレイヤーの近接・弾・スキルだけが呼ぶ。敵の爆発・継続ダメージでは怒らない）。
 * 気付かない敵なので、ここで直接追跡に入れる
 */
export function provokeMerchant(state: GameState, e: Enemy): void {
  const m = merchantOf(state, e);
  if (!m || m.provoked) return;
  m.provoked = true;
  pushSfx(state, "merchantProvoked");
  if (e.phase === "idle") e.phase = "chase";
  addFloatingText(state, { x: e.body.pos.x, y: e.body.pos.y - TEXT_LIFT }, PROVOKED_TEXT, ECONOMY.market.color, TEXT_SCALE, TEXT_LIFE);
}

/** 品を扇に投げる（strike の終わりに 1 回） */
export function throwWares(state: GameState, e: Enemy): void {
  const t = ECONOMY.market.throw;
  for (const dir of fanDirections(e.strikeDir, t.count, t.spreadDeg)) {
    fireEnemyBullet(state, {
      pos: add(e.body.pos, scale(dir, e.body.radius + 2)),
      dir,
      speed: t.speed,
      damage: depthDamage(t.damage, state.depth),
      color: t.color,
      sourceId: e.id,
    });
  }
}
