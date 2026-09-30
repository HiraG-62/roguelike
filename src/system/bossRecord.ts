import type { Enemy, GameState } from "../core/state";
import { type EnemyBehavior, enemyDef, isBossClass } from "../data/enemies";
import { BOSS } from "../data/tuning";
import { addPoise } from "./poise";

/**
 * ボス戦の記録と取り巻きの怯み値（docs/ideas/boss-impl.md 2-1 の規則 5 と記録）。
 * combat.ts / enemyTraits.ts / boss.ts から 1 行ずつ呼ばれるので、import の輪を作らないよう
 * core/state・data/enemies・data/tuning・poise だけを読む
 */

/** 倒してもボスに怯み値を入れない取り巻き（卵は群れの母の crackEgg が別に入れる。地雷・置物・入れ物は戦いの相手でない） */
const NO_MINION_POISE: ReadonlySet<EnemyBehavior> = new Set<EnemyBehavior>(["egg", "mine", "inert", "container"]);

/** 封鎖中の被弾を数える（combat.ts の damagePlayer が "hit" のとき） */
export function noteBossFightHit(state: GameState): void {
  const b = state.boss;
  if (!b || b.defeated || b.lockedAt === undefined) return;
  b.hits = (b.hits ?? 0) + 1;
}

/** 自傷のダウンを数える（bossKit.ts の bossDown）。ボス本人のときだけ */
export function noteBossDown(state: GameState, e: Enemy): void {
  const b = state.boss;
  if (!b || b.enemyId !== e.id) return;
  b.selfDowns = (b.selfDowns ?? 0) + 1;
}

/**
 * 規則 5: ボス部屋の取り巻きを倒すと、ボスに怯み値（耐性 × minionPoiseRatio）。
 * 雑魚を処理する理由を作る。ボス本人・ボスの片割れ・消えた敵・部屋の外・従魔・卵や置物は数えない
 */
export function noteBossMinionDeath(state: GameState, e: Enemy): void {
  const b = state.boss;
  if (!b || !b.major || b.defeated) return;
  if (e.id === b.enemyId || e.vanished || e.roomIndex !== b.roomIndex) return;
  if (e.allyUntil !== undefined && e.allyUntil > state.time) return;
  const def = enemyDef(e.defKey);
  if (isBossClass(def) || NO_MINION_POISE.has(def.behavior)) return;
  const boss = state.enemies.find((o) => o.id === b.enemyId && o.hp > 0);
  if (!boss) return;
  addPoise(state, boss, boss.poise.max * BOSS.rules.minionPoiseRatio, { fromBehind: false });
}

/** 撃破の記録を 1 件積む（boss.ts の onBossDeath）。階の主（major でない）は積まない */
export function pushBossRecord(state: GameState, e: Enemy): void {
  const b = state.boss;
  if (!b || !b.major) return;
  state.bossLog.push({
    key: e.defKey,
    depth: state.depth,
    seconds: b.lockedAt === undefined ? 0 : Math.max(0, state.time - b.lockedAt),
    hits: b.hits ?? 0,
    downs: e.poise.downs + (b.selfDowns ?? 0),
  });
}
