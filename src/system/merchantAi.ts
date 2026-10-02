import { type DamageKind, type Enemy, type GameState, type Merchant, pushSfx } from "../core/state";
import { add, scale } from "../core/vec";
import { depthDamage, enemyDef } from "../data/enemies";
import { ECONOMY } from "../data/tuning";
import { addFloatingText } from "./effects";
import { fanDirections, fireEnemyBullet } from "./enemyTraits";

/**
 * 商人の体（Enemy）の振る舞い（behaviors/families.ts の Merchant から呼ぶ）。
 * 市の台座・品・倒れた後の処理は system/merchants.ts。ここは behaviors から import されるので、
 * loot / skills / contractors のような重いモジュールを読まない（registry の循環 import を増やさない）
 */

const PROVOKED_TEXT = "激怒";
const WARN_TEXT = "手出し無用";
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
 * 商人を狙う気のある敵が近くにいるか（交戦中）。生きていて、壺・木箱・商人・従魔でない敵が
 * ECONOMY.market.patience.shelterRange 以内にいる（眠っている敵も数える。陣の中の市を乱戦の巻き添えにしない）
 */
export function merchantSheltered(state: GameState, e: Enemy): boolean {
  if (merchantOf(state, e)?.provoked !== false) return false;
  const range = ECONOMY.market.patience.shelterRange;
  const p = e.body.pos;
  return state.enemies.some((o) => {
    if (o === e || o.hp <= 0) return false;
    if (o.allyUntil !== undefined && o.allyUntil > state.time) return false;
    const def = enemyDef(o.defKey);
    if (def.container !== undefined || def.merchant === true) return false;
    return Math.hypot(o.body.pos.x - p.x, o.body.pos.y - p.y) <= range;
  });
}

/**
 * 怒っていない商人への傷を受け止めるか（damageEnemy の頭から）。受け止めたら true（傷・怯み・反応を入れない）。
 * - 怒っていない商人は巻き添え（爆発・継続ダメージ・proc）では傷つかない
 * - プレイヤーの近接・弾・スキル（struck）でも、近くに敵がいる間（交戦中）は当たらない
 * - 敵がいなければ 1 発目は警告だけ。patience.grace 秒より後・patience.window 秒以内の次の一撃を通し、onStruck が怒らせる
 *   （grace は 1 振りの多段・散弾の続きを 2 発目に数えないため）
 * 誤って殴って敵対することが多かったため（2026-10-02 のプレイ所見）。襲う道は残す
 */
export function shieldsMerchant(state: GameState, e: Enemy, struck: boolean): boolean {
  const m = merchantOf(state, e);
  if (!m || m.provoked) return false;
  if (!struck || merchantSheltered(state, e)) return true;
  const t = ECONOMY.market.patience;
  const since = m.warnedAt === undefined ? Number.POSITIVE_INFINITY : state.time - m.warnedAt;
  if (since <= t.grace) return true;
  if (since <= t.window) return false;
  m.warnedAt = state.time;
  addFloatingText(state, { x: e.body.pos.x, y: e.body.pos.y - TEXT_LIFT }, WARN_TEXT, ECONOMY.market.color, TEXT_SCALE, TEXT_LIFE, "notice");
  return true;
}

/** damageEnemy の「殴った」（onStruck を呼ぶ一撃）か: 継続ダメージ・proc 以外 */
export function isStrike(kind: DamageKind, silent: boolean | undefined): boolean {
  return silent !== true && kind !== "proc";
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
  addFloatingText(state, { x: e.body.pos.x, y: e.body.pos.y - TEXT_LIFT }, PROVOKED_TEXT, ECONOMY.market.color, TEXT_SCALE, TEXT_LIFE, "notice");
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
