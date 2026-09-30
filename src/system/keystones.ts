import type { DamageTag, MoreMul } from "../core/damage";
import type { EventKind, EventSource } from "../core/events";
import { type Modifier, type Rule, type RuleCondition, type RuleEffect, SCOPE_ANY, ruleId } from "../core/rules";
import type { DamageKind, Enemy, GameState, Player } from "../core/state";
import { dist } from "../core/vec";
import type { PlayerStats } from "../loot/types";
import { KEYSTONE, PLAYER, STATUS } from "../data/tuning";

/**
 * 誓約の判定ヘルパー。key は src/loot/affixes.ts の KEYSTONES と揃える（誓約 20。docs/ideas/relics-7d-plan.md 2-2）。
 * 数値だけの誓約（硝子の砲・吸血など）は computeStats 側で適用済み。
 */
export const KS = {
  glassCannon: "ks_glassCannon",
  vampire: "ks_vampire",
  overclock: "ks_overclock",
  gambler: "ks_gambler",
  readOath: "ks_readOath",
  mushin: "ks_mushin",
  instant: "ks_instant",
  blink: "ks_blink",
  pacifist: "ks_pacifist",
  bladeOath: "ks_bladeOath",
  farOath: "ks_farOath",
  overdraw: "ks_overdraw",
  silentVow: "ks_silentVow",
  chant: "ks_chant",
  pure: "ks_pure",
  contagion: "ks_contagion",
  unshaken: "ks_unshaken",
  poverty: "ks_poverty",
  goldCage: "ks_goldCage",
  alms: "ks_alms",
} as const;

export type KeystoneKey = (typeof KS)[keyof typeof KS];

/**
 * 誓約の表示名（日本語）。key は src/loot/affixes.ts の KEYSTONES.key と揃える。
 * affixes.ts 側を import できないので、ここに小さな表として直接持つ
 */
export const KEYSTONE_NAME: Readonly<Record<string, string>> = {
  ks_glassCannon: "硝子の砲",
  ks_vampire: "吸血",
  ks_overclock: "過駆動",
  ks_gambler: "賭博師",
  ks_readOath: "読み勝ちの誓い",
  ks_mushin: "虚心",
  ks_instant: "刹那",
  ks_blink: "瞬歩",
  ks_pacifist: "不殺",
  ks_bladeOath: "近間の誓い",
  ks_farOath: "遠間の誓い",
  ks_overdraw: "過負荷",
  ks_silentVow: "静寂の誓い",
  ks_chant: "詠唱の誓い",
  ks_pure: "無垢の誓い",
  ks_contagion: "病みの誓い",
  ks_unshaken: "揺るがぬ誓い",
  ks_poverty: "清貧",
  ks_goldCage: "黄金の檻",
  ks_alms: "喜捨",
};

// -----------------------------------------------------------------------------
// 誓約の常時の倍（Modifier。system/modifiers.ts の collectModifiers が持っている誓約の順に集める）
// -----------------------------------------------------------------------------

/** 近接・射撃の 1 撃（proc〈燃焼・トリガーの衝撃波など〉には掛けない誓約の対象） */
const STRIKE_TAGS: readonly DamageTag[] = ["melee", "ranged"];
/** 遠間の誓いの境目の内側の相手 */
const TARGET_NEAR: RuleCondition = { kind: "targetWithin", radius: KEYSTONE.farOathRangePx };

/** 誓約の表示名（表に無ければ key） */
function keystoneName(key: KeystoneKey): string {
  return KEYSTONE_NAME[key] ?? key;
}

/** 誓約の Modifier の持ち主 */
function keystoneOwner(key: KeystoneKey): EventSource {
  return { kind: "keystone", key };
}

/**
 * 誓約の倍を、proc 以外の 1 撃のタグごとに 1 つずつ（1 撃のタグは 1 つなので 2 重には掛からない）。
 * first は id の添字の始まり（1 つの誓約が条件違いの倍を 2 つ持つとき id を分ける）
 */
function oathModifiers(key: KeystoneKey, amount: number, conditions: readonly RuleCondition[], first = 0): readonly Modifier[] {
  const owner = keystoneOwner(key);
  const label = keystoneName(key);
  return STRIKE_TAGS.map((tag, i) => ({ id: ruleId(owner, first + i), kind: "more", tag, amount, if: conditions, owner, label }));
}

const KEYSTONE_MODIFIERS: Readonly<Partial<Record<string, readonly Modifier[]>>> = {
  // 遠間: 近い敵へは下がり、遠い敵へは上がる（近間の誓いの裏返し）
  [KS.farOath]: [
    ...oathModifiers(KS.farOath, KEYSTONE.farOathNearMul, [TARGET_NEAR]),
    ...oathModifiers(KS.farOath, KEYSTONE.farOathFarMul, [{ kind: "not", condition: TARGET_NEAR }], STRIKE_TAGS.length),
  ],
  // 清貧: 銭を持てない代わりの与ダメの増
  [KS.poverty]: [
    { id: ruleId(keystoneOwner(KS.poverty), 0), kind: "increased", tag: "all", amount: KEYSTONE.povertyIncreased, if: [], owner: keystoneOwner(KS.poverty), label: keystoneName(KS.poverty) },
  ],
  // 黄金の檻: 持ち金 N につき倍が 1 段（段は足し合わせ）
  [KS.goldCage]: [
    {
      id: ruleId(keystoneOwner(KS.goldCage), 0),
      kind: "more",
      tag: "all",
      amount: KEYSTONE.goldCageMul - 1,
      per: { count: { kind: "coins" }, every: KEYSTONE.goldCageEvery },
      if: [],
      owner: keystoneOwner(KS.goldCage),
      label: keystoneName(KS.goldCage),
    },
  ],
};

/** 持っている誓約の Modifier（持っている順） */
export function keystoneModifiers(keys: readonly string[]): Modifier[] {
  const out: Modifier[] = [];
  for (const key of keys) out.push(...(KEYSTONE_MODIFIERS[key] ?? []));
  return out;
}

/** 誓約の Rule を 1 つ作る（持ち主 + 添字で id を決める。確率 1・内部 CD なし） */
function keystoneRule(key: KeystoneKey, index: number, when: EventKind, then: RuleEffect): Rule {
  const owner = keystoneOwner(key);
  return { id: ruleId(owner, index), when, if: [], then, chance: 1, icd: 0, scope: SCOPE_ANY, owner };
}

/** 誓約の Rule（「〜時: 〜」で書ける誓約。collectRules が装備の直後に集める） */
const KEYSTONE_RULES: Readonly<Partial<Record<string, readonly Rule[]>>> = {
  // 刹那: 見切りの瞬間、周りの敵を凍らせる（ボスは凍らせない）
  [KS.instant]: [
    keystoneRule(KS.instant, 0, "onJustDodge", {
      kind: "nearbyEnemies",
      status: "freeze",
      magnitude: 0,
      duration: KEYSTONE.instantSec,
      radius: KEYSTONE.instantRadius,
      skipBoss: true,
      color: STATUS.chillColor,
    }),
  ],
  // 喜捨: 払った額に応じて癒え、しばらく与ダメが上がる
  [KS.alms]: [
    keystoneRule(KS.alms, 0, "onCoinSpend", { kind: "heal", magnitude: KEYSTONE.almsHealPerCoin, scaleBy: "eventAmount" }),
    keystoneRule(KS.alms, 1, "onCoinSpend", { kind: "damageBuff", magnitude: KEYSTONE.almsBuffPct, duration: KEYSTONE.almsBuffSec }),
  ],
};

/** 持っている誓約の Rule（持っている順） */
export function keystoneRules(keys: readonly string[]): Rule[] {
  const out: Rule[] = [];
  for (const key of keys) out.push(...(KEYSTONE_RULES[key] ?? []));
  return out;
}

/** 誓約の判定に要る state の部分（テストで GameState 全体を作らずに済むよう絞る） */
export interface KeystoneHolder {
  stats: Pick<PlayerStats, "keystones">;
}

/** スキルのコストの支払いに要る state の部分 */
export interface ManaPayer extends KeystoneHolder {
  player: Pick<Player, "mana" | "hp">;
}

export function hasKeystone(state: KeystoneHolder, key: KeystoneKey): boolean {
  return state.stats.keystones.includes(key);
}

/** 誓約の与ダメの倍（1 つの誓約につき 1 要素。source は "keystone:<key>"） */
export function oathMore(key: KeystoneKey, mul: number): MoreMul {
  return { source: `keystone:${key}`, label: KEYSTONE_NAME[key] ?? key, mul };
}

/** ks_gambler: 1 ヒットごとのランダム倍率 */
export function gamblerMul(state: GameState): number {
  if (!hasKeystone(state, KS.gambler)) return 1;
  return KEYSTONE.gamblerMin + state.rng.next() * (KEYSTONE.gamblerMax - KEYSTONE.gamblerMin);
}

/**
 * ks_bladeOath（近間の誓い）: 対象との距離で与ダメージが変わる（近接・射撃・スキル共通）。
 * 対象がいない proc ダメージは距離を測れないので等倍のまま
 */
export function bladeOathMul(state: GameState, enemy: Enemy | null): number {
  if (!hasKeystone(state, KS.bladeOath) || !enemy) return 1;
  const d = dist(state.player.body.pos, enemy.body.pos);
  return d <= KEYSTONE.bladeOathRangePx ? KEYSTONE.bladeOathNearMul : KEYSTONE.bladeOathFarMul;
}

/**
 * ks_mushin（虚心）: 攻撃を当てずに mushinIdleSec 秒たった後の、近接・射撃の 1 撃の倍。
 * 当てた瞬間に Player.moment.lastHitAt が進む（system/moments.ts）ので、倍が乗るのは溜めた後の 1 撃だけ。
 * スキルは lastHitAt を進めないので対象外（進めない命中で倍が乗り続けないように）
 */
export function mushinMul(state: GameState, kind: DamageKind, skill: boolean): number {
  if (!hasKeystone(state, KS.mushin) || skill || (kind !== "melee" && kind !== "ranged")) return 1;
  return state.time - state.player.moment.lastHitAt >= KEYSTONE.mushinIdleSec ? KEYSTONE.mushinMul : 1;
}

/**
 * ks_poverty（清貧）: 銭を持てない。拾った銭 amount が換わる気力（清貧でなければ undefined = 銭のまま）。
 * 気力を足すのは呼び出し側（system/economy.ts）。ここから mana.ts を読むと keywords.ts との循環で KS が未初期化になる
 */
export function povertyMana(state: KeystoneHolder, amount: number): number | undefined {
  if (!hasKeystone(state, KS.poverty)) return undefined;
  return amount * KEYSTONE.povertyManaPerCoin;
}

/** 毎秒回復が有効か（吸血は無効） */
export function regenAllowed(state: GameState): boolean {
  return !hasKeystone(state, KS.vampire);
}

/**
 * 回復量の倍率。今は回復を削る誓約が無い（狂戦士・背水は段取り 7d で性質へ移した）。
 * combat.ts の呼び出しは口として残す（誓約で戻すときにここへ足す）
 */
export function healMul(_state: GameState): number {
  return 1;
}

/** ks_vampire: ハートを拾えない */
export function heartsAllowed(state: GameState): boolean {
  return !hasKeystone(state, KS.vampire);
}

/** ks_overclock: 行動ごとに HP を払う（1 未満にはしない） */
export function payOverclock(state: GameState, cost: number): void {
  if (!hasKeystone(state, KS.overclock)) return;
  const p = state.player;
  p.hp = Math.max(1, p.hp - cost);
}

/** ks_overclock: 射撃は overclockShootInterval 発ごとに 1 回だけ HP を払う（近接は毎振り payOverclock） */
export function payOverclockShoot(state: GameState): void {
  if (!hasKeystone(state, KS.overclock)) return;
  const p = state.player;
  p.overclockShotCount += 1;
  if (p.overclockShotCount < PLAYER.overclockShootInterval) return;
  p.overclockShotCount = 0;
  p.hp = Math.max(1, p.hp - PLAYER.overclockHpCost);
}

// ---------------------------------------------------------------------------
// マナの誓約（排他グループ mana）。数値効果（スキル威力・自然回復）は affixes.ts の apply で適用済み
// ---------------------------------------------------------------------------

/**
 * 通常攻撃（近接・ダッシュ攻撃・射撃）の命中で戻るマナに掛ける倍率。
 * ks_silentVow は 0、ks_chant は KEYSTONE.chantManaMul。
 * ジャスト回避と撃破の回収は通常攻撃ではないので対象外
 */
export function attackManaMul(state: KeystoneHolder): number {
  if (hasKeystone(state, KS.silentVow)) return 0;
  // 詠唱の誓い: 通常攻撃はほとんど傷を付けない代わりにマナの蛇口になる
  if (hasKeystone(state, KS.chant)) return KEYSTONE.chantManaMul;
  return 1;
}

/**
 * マナの自然回復が有効か。今は止める誓約が無い（渇きの誓約は段取り 7d で消えた）。
 * mana.ts / elites.ts の呼び出しは口として残す
 */
export function manaRegenAllowed(_state: KeystoneHolder): boolean {
  return true;
}

/** ks_overdraw: マナの不足分を払うのに要る HP（不足が無ければ 0） */
export function overdrawHpCost(state: ManaPayer, cost: number): number {
  const shortfall = Math.max(0, cost - state.player.mana);
  return shortfall * KEYSTONE.overdrawHpPerMana;
}

/**
 * スキルのコストを払えるか。マナで足りれば true。
 * ks_overdraw なら不足分を HP で払えるか（払った後に KEYSTONE.overdrawMinHp 以上残るか）も見る
 */
export function canAffordSkill(state: ManaPayer, cost: number): boolean {
  if (cost <= 0 || state.player.mana >= cost) return true;
  if (!hasKeystone(state, KS.overdraw)) return false;
  return state.player.hp - overdrawHpCost(state, cost) >= KEYSTONE.overdrawMinHp;
}

/**
 * スキルのコストを払う。足りなければ何も減らさず false（不発）。
 * ks_overdraw ならマナを 0 まで使い、不足分を HP で払う（自傷で死なないよう canAffordSkill で下限を見る）
 */
export function paySkillCost(state: ManaPayer, cost: number): boolean {
  if (cost <= 0) return true;
  if (!canAffordSkill(state, cost)) return false;
  const p = state.player;
  const hpCost = overdrawHpCost(state, cost);
  p.mana = Math.max(0, p.mana - cost);
  p.hp -= hpCost;
  return true;
}
