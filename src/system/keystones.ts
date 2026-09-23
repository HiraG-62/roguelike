import type { GameState, Player } from "../core/state";
import type { PlayerStats } from "../loot/types";
import { KEYSTONE, PLAYER } from "../data/tuning";
import { isEngaged } from "./engagement";

/**
 * キーストーン判定ヘルパー。key は src/loot/affixes.ts の KEYSTONES と揃える。
 * 数値だけのキーストーン（glassCannon / windWalker など）は computeStats 側で適用済み。
 */
export const KS = {
  berserker: "ks_berserker",
  blink: "ks_blink",
  pacifist: "ks_pacifist",
  bladeOath: "ks_bladeOath",
  juggernaut: "ks_juggernaut",
  gambler: "ks_gambler",
  vampire: "ks_vampire",
  overclock: "ks_overclock",
  overdraw: "ks_overdraw",
  silentVow: "ks_silentVow",
  thirst: "ks_thirst",
  // ---- 2026-09 追加（docs/ideas/loot-expansion.md 2 章）----
  pure: "ks_pure",
  blight: "ks_blight",
  contagion: "ks_contagion",
  wedgeOath: "ks_wedgeOath",
  unshaken: "ks_unshaken",
  chokehold: "ks_chokehold",
  readOath: "ks_readOath",
  backwater: "ks_backwater",
  reaperOath: "ks_reaperOath",
  chant: "ks_chant",
  monochrome: "ks_monochrome",
  colorless: "ks_colorless",
  mirror: "ks_mirror",
  discipline: "ks_discipline",
  oblivion: "ks_oblivion",
} as const;

export type KeystoneKey = (typeof KS)[keyof typeof KS];

/**
 * キーストーンの表示名（日本語）。key は src/loot/affixes.ts の KEYSTONES.key と揃える。
 * affixes.ts 側を import できないので、ここに小さな表として直接持つ
 * （ks_glassCannon / ks_windWalker は数値だけのキーストーンで KS には無いが、表示名はここで引く）
 */
export const KEYSTONE_NAME: Readonly<Record<string, string>> = {
  ks_glassCannon: "硝子の砲",
  ks_berserker: "狂戦士",
  ks_blink: "瞬歩",
  ks_pacifist: "不殺",
  ks_juggernaut: "不動",
  ks_gambler: "賭博師",
  ks_vampire: "吸血",
  ks_overclock: "過駆動",
  ks_bladeOath: "剣の誓い",
  ks_windWalker: "風走り",
  ks_overdraw: "過負荷",
  ks_silentVow: "静寂の誓い",
  ks_thirst: "渇きの誓約",
  ks_pure: "無垢の誓い",
  ks_blight: "蝕みの誓約",
  ks_contagion: "病みの誓い",
  ks_wedgeOath: "楔の誓い",
  ks_unshaken: "揺るがぬ誓い",
  ks_chokehold: "締め上げの誓い",
  ks_readOath: "読み勝ちの誓い",
  ks_backwater: "背水の誓い",
  ks_reaperOath: "死神の誓い",
  ks_chant: "詠唱の誓い",
  ks_monochrome: "単色の誓い",
  ks_colorless: "無色の誓い",
  ks_mirror: "鏡の誓い",
  ks_discipline: "修行の誓い",
  ks_oblivion: "忘却の誓い",
};

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

/** ks_berserker: 失った HP の割合ぶん与ダメが増える */
export function berserkerMul(state: GameState): number {
  if (!hasKeystone(state, KS.berserker)) return 1;
  const p = state.player;
  if (p.maxHp <= 0) return 1;
  return 1 + Math.max(0, 1 - p.hp / p.maxHp);
}

/** ks_gambler: 1 ヒットごとのランダム倍率 */
export function gamblerMul(state: GameState): number {
  if (!hasKeystone(state, KS.gambler)) return 1;
  return KEYSTONE.gamblerMin + state.rng.next() * (KEYSTONE.gamblerMax - KEYSTONE.gamblerMin);
}

/** 毎秒回復が有効か（berserker / vampire は無効） */
export function regenAllowed(state: GameState): boolean {
  return !hasKeystone(state, KS.berserker) && !hasKeystone(state, KS.vampire);
}

/** 回復量の倍率。狂戦士は半減、背水の誓いは交戦中の部屋で 0（制圧時の回復は部屋が開いた後に入る） */
export function healMul(state: GameState): number {
  if (hasKeystone(state, KS.backwater) && isEngaged(state)) return 0;
  return hasKeystone(state, KS.berserker) ? KEYSTONE.berserkerHealMul : 1;
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

/** ks_thirst: 自然回復を捨てた代わりの、通常攻撃の命中で戻るマナの倍率 */
const THIRST_ATTACK_MANA_MUL = 3;

/**
 * 通常攻撃（近接・ダッシュ攻撃・射撃）の命中で戻るマナに掛ける倍率。
 * ks_silentVow は 0、ks_thirst は THIRST_ATTACK_MANA_MUL、ks_chant は KEYSTONE.chantManaMul。
 * ジャスト回避と撃破の回収は通常攻撃ではないので対象外
 */
export function attackManaMul(state: KeystoneHolder): number {
  if (hasKeystone(state, KS.silentVow)) return 0;
  if (hasKeystone(state, KS.thirst)) return THIRST_ATTACK_MANA_MUL;
  // 詠唱の誓い: 通常攻撃はほとんど傷を付けない代わりにマナの蛇口になる
  if (hasKeystone(state, KS.chant)) return KEYSTONE.chantManaMul;
  return 1;
}

/**
 * マナの自然回復が有効か（ks_thirst は無効）。
 * 装備分は computeStats で 0 にしてあるが、精神の派生（attributes.ts）が後から足すので tickMana でも止める
 */
export function manaRegenAllowed(state: KeystoneHolder): boolean {
  return !hasKeystone(state, KS.thirst);
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
