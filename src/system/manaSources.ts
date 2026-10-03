import type { StatusEffect, StatusKind } from "../core/status";
import type { DamageKind, Enemy, GameState } from "../core/state";
import { JOBS, type ManaSource, type ManaSourceKind } from "../data/jobs";
import { MANA } from "../data/tuning";
import { attackManaMul } from "./keystones";
import { gainAttackMana, gainMana } from "./mana";
import { isBehind } from "./poise";
import type { StatusTarget } from "./statusEffects";

/**
 * 流儀の気力の源（docs/ideas/weapon-forms-impl.md 3-7）。定義は data/jobs.ts の JobDef.mana、数値は MANA_SOURCE。
 * 各フック（近接の命中・ダッシュ攻撃の命中、応手、終撃、背面の命中、受け止め、継続ダメージの刻み、反応、スキルの命中、加護の発火）から
 * 1 行で呼ばれ、今のジョブがその源を持っていれば気力を足す。持っていなければ何もしない。
 * 自分の弾（Projectile）の命中では湧かない（遠距離の攻撃は資源を戻さない。docs/ideas/gun-bases-review.md 0-2）
 */

type SourceOf<K extends ManaSourceKind> = Extract<ManaSource, { kind: K }>;

/** 時間で刻む継続ダメージ（出血は動いた距離で刻むので数えない） */
const TICKING_DOTS: ReadonlySet<StatusKind> = new Set<StatusKind>(["burn", "blaze", "poison", "hemorrhage"]);

const PERCENT = 100;
/** 説明文の小数の桁 */
const TEXT_DIGITS = 2;

/** 今のジョブのその種類の源（無ければ undefined） */
export function manaSourceOf<K extends ManaSourceKind>(state: Readonly<GameState>, kind: K): SourceOf<K> | undefined {
  return JOBS[state.job].mana.find((s): s is SourceOf<K> => s.kind === kind);
}

/** 通常攻撃（近接の振り）の命中の回収に掛ける流儀の倍率。見習いは 1、他は JOB.manaBaseMul の下地 */
export function attackHitManaMul(state: Readonly<GameState>): number {
  return manaSourceOf(state, "attackHit")?.mul ?? 0;
}

/** 源 1 回ぶんの量。value は種類ごとの量（コンボ数・受けたダメージ・秒。回数の源は倍数） */
function amountOf(source: ManaSource, value: number): number {
  switch (source.kind) {
    case "attackHit":
      // 通常攻撃は回収の倍率（attackHitManaMul）として掛けるので、ここでは足さない
      return 0;
    case "comboHit":
      return source.perCombo * Math.min(value, source.comboCap);
    case "guardBlock":
      return source.perDamage * value;
    case "statusTick":
      return source.perSec * value;
    default:
      return source.amount * value;
  }
}

/**
 * 源から気力を足す。attack は通常攻撃の命中から湧く源（静寂の誓い・通常攻撃の回収の倍率が効く）。
 * 実際に増えた量を返す
 */
export function onManaSource(state: GameState, kind: ManaSourceKind, value = 1, attack = false): number {
  const source = manaSourceOf(state, kind);
  if (!source) return 0;
  const base = amountOf(source, value);
  if (base <= 0) return 0;
  if (!attack) return gainMana(state, base);
  return gainAttackMana(state, base, attackManaMul(state));
}

/**
 * 近接の振りの命中が気力を数える敵の上限を越えたか（群れを薙いで一気に満たさない。MANA.meleeTargetCap）。
 * 抜け斬り（MeleeStepDef.manaPerTarget）の振りは斬った敵の数だけ戻すので頭打ちしない
 */
function overMeleeCap(state: Readonly<GameState>): boolean {
  if (state.player.attack.uncappedMana === true) return false;
  return state.player.attack.hitIds.size > MANA.meleeTargetCap;
}

/**
 * 自分の弾（Projectile）の命中か。自分の命中で kind が "ranged" になるのは弾だけ（近接の振りは武器のジャンルが ranged の銃剣でも
 * kind "melee"、スキルは skill が立つ）。遠距離の攻撃は気力の源を湧かせない
 */
function isShotHit(kind: DamageKind, skill: boolean): boolean {
  return kind === "ranged" && !skill;
}

/** 近接の振りの命中（player.ts の meleeHitEnemy）: コンボの命中・先端の命中・ダッシュ攻撃の命中 */
export function noteMeleeHitMana(state: GameState, tip: boolean, dashStrike = false): void {
  if (overMeleeCap(state)) return;
  onManaSource(state, "comboHit", state.combo.count, true);
  if (tip) onManaSource(state, "tipHit", 1, true);
  if (dashStrike) onManaSource(state, "dashHit", 1, true);
}

/** 命中（combat.ts の damageEnemy）: 背面の命中。継続ダメージ・素性なしの追撃・弾の命中は数えない */
export function noteHitMana(state: GameState, enemy: Enemy, kind: DamageKind, skill: boolean, silent: boolean): void {
  if (silent || kind === "proc" || isShotHit(kind, skill)) return;
  const capped = !skill && overMeleeCap(state);
  if (kind === "melee" && !capped && isBehind(state, enemy)) onManaSource(state, "backstab", 1, !skill);
}

/** 終撃の命中（moments.ts の noteHitMoments）。近接の振りは数える敵の上限まで、弾の終撃（長銃の満ちた 1 発など）では湧かない */
export function noteFinisherMana(state: GameState, kind: DamageKind, skill = false): void {
  if (isShotHit(kind, skill)) return;
  if (kind === "melee" && overMeleeCap(state)) return;
  onManaSource(state, "finisher");
}

/** 不退の構えの中の被弾（combat.ts の damagePlayer）。受けた量が受け止めの源になる */
export function noteBraceBlockMana(state: GameState, amount: number): void {
  if (state.boonRun.guardTimer <= 0) return;
  onManaSource(state, "guardBlock", amount);
}

/** 状態異常の 1 ステップの刻み（statusEffects.ts の tickBag）。自分が敵に付けた時間の継続ダメージだけ */
export function noteStatusTickMana(state: GameState, target: StatusTarget, effect: Readonly<StatusEffect>, dt: number): void {
  if (target.kind !== "enemy" || effect.source !== "player" || !TICKING_DOTS.has(effect.kind)) return;
  onManaSource(state, "statusTick", dt);
}

/** 反応（statusReactions.ts の fire）。敵の身に起きた反応だけ */
export function noteReactionMana(state: GameState, target: StatusTarget): void {
  if (target.kind !== "enemy") return;
  onManaSource(state, "reaction");
}

// -----------------------------------------------------------------------------
// 表示（起点画面の説明。何をすると気力が湧くか）
// -----------------------------------------------------------------------------

function num(v: number): string {
  return String(Number(v.toFixed(TEXT_DIGITS)));
}

/** 源 1 つの説明（「応手で +15」）。通常攻撃は回収の割合 */
export function manaSourceText(source: ManaSource): string {
  switch (source.kind) {
    case "attackHit":
      return `通常攻撃の命中で ${Math.round(source.mul * PERCENT)}%`;
    case "riposte":
      return `応手で +${num(source.amount)}`;
    case "finisher":
      return `終撃の命中で +${num(source.amount)}`;
    case "dashHit":
      return `ダッシュ攻撃の命中で +${num(source.amount)}`;
    case "comboHit":
      return `近接の命中でコンボ 1 につき +${num(source.perCombo)}、${source.comboCap} コンボまで`;
    case "guardBlock":
      return `構えで受けた被ダメージ 1 につき +${num(source.perDamage)}`;
    case "statusTick":
      return `自分の継続ダメージが敵を刻む 1 秒ごとに +${num(source.perSec)}`;
    case "tipHit":
      return `先端の命中で +${num(source.amount)}`;
    case "skillHit":
      return `スキルの命中で +${num(source.amount)}`;
    case "backstab":
      return `背面の命中で +${num(source.amount)}`;
    case "reaction":
      return `状態異常の反応で +${num(source.amount)}`;
    case "minionHit":
      return `設置物・連動体の命中で +${num(source.amount)}`;
    case "boonFired":
      return `祝福の発動で +${num(source.amount)}`;
  }
}

/** 流儀の源を並べた 1 行。流儀の源を先に、通常攻撃の下地を最後に */
export function manaSourcesText(sources: readonly ManaSource[]): string {
  const own = sources.filter((s) => s.kind !== "attackHit");
  const base = sources.filter((s) => s.kind === "attackHit");
  return [...own, ...base].map(manaSourceText).join("、");
}
