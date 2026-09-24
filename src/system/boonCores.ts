import type { GameState } from "../core/state";
import { BOON, FEEL } from "../data/tuning";
import type { PlayerStats } from "../loot/types";
import { BOONS, type BoonDef, type BoonKey } from "./boonDefs";

/**
 * 芯の祝福（docs/ideas/boon-power-up.md 3-4）の効果のうち、Rule で書けないもの。
 * 数値は foldCoreStats（foldBoonStats の末尾から呼ぶ。ソフトキャップの後の derived に掛かる）、
 * 抽選への割り込みは coreCursedForced / coreGradeShift（boons.ts）、
 * 呪いの除去・ハートの拾得の禁止は呼び出し側 system が coreKeepsCurses / coreBlocksHearts を見る。
 * boons.ts から呼ばれるので、ここから boons.ts は import しない（循環を作らない）
 */

/** 持っている芯（1 ランに 1 つ）。無ければ null */
export function ownedCore(state: GameState): BoonDef | null {
  for (const key of state.boons) {
    const def = BOONS[key];
    if (def.core === true) return def;
  }
  return null;
}

function holds(state: GameState, key: BoonKey): boolean {
  return state.boons.includes(key);
}

/** 最大生命に倍率を掛ける（0 にはしない） */
function scaleMaxHp(out: PlayerStats, mul: number): void {
  out.maxHp = Math.max(1, Math.round(out.maxHp * mul));
}

/** 硝子の心: 近接・射撃・スキルの威力 ×glassHeartDamageMul、最大生命 ×glassHeartHpMul */
function foldGlassHeart(out: PlayerStats): void {
  out.meleeDamageMul *= BOON.glassHeartDamageMul;
  out.rangedDamageMul *= BOON.glassHeartDamageMul;
  out.skillDamageMul *= BOON.glassHeartDamageMul;
  scaleMaxHp(out, BOON.glassHeartHpMul);
}

/**
 * 拍の刻: コンボ段ごとの倍率と上限を上書きし、猶予を ×tempoWindowMul。
 * comboWindowBonus は FEEL.comboWindow への加算なので、猶予全体（既定 + 加算）に倍率を掛けた値へ直す
 */
function foldTempo(out: PlayerStats): void {
  out.comboDamagePerStack = BOON.tempoPerStack;
  out.comboDamageCap = BOON.tempoCap;
  const window = FEEL.comboWindow + out.comboWindowBonus;
  out.comboWindowBonus = window * BOON.tempoWindowMul - FEEL.comboWindow;
}

/** 血の巡り: 命中の回収 +bloodLoopLifeOnHit %、自然回復 0（ハートは floor.ts が coreBlocksHearts で拾わせない） */
function foldBloodLoop(out: PlayerStats): void {
  out.lifeOnHit += BOON.bloodLoopLifeOnHit;
  out.hpRegen = 0;
}

/** 満ち潮の器: 最大気力 ×manaTideMaxMul、回収 ×manaTideGainMul、自然回復 0 */
function foldManaTide(out: PlayerStats): void {
  out.maxMana = Math.round(out.maxMana * BOON.manaTideMaxMul);
  out.manaGainMul *= BOON.manaTideGainMul;
  out.manaRegen = 0;
}

/** 逃げ水: ダッシュ回数 +mirageCharges、再使用 ×mirageCooldownMul、移動 ×mirageMoveMul（爆発は Rule） */
function foldMirage(out: PlayerStats): void {
  out.dashCharges += BOON.mirageCharges;
  out.dashCooldownMul *= BOON.mirageCooldownMul;
  out.moveSpeedMul *= BOON.mirageMoveMul;
}

/** 鉄の巨人: 怯み値・ノックバック・最大生命を上げ、攻撃速度と移動を落とす */
function foldIronGiant(out: PlayerStats): void {
  out.poiseDamageMul *= BOON.ironGiantPoiseMul;
  out.knockbackMul *= BOON.ironGiantKnockbackMul;
  scaleMaxHp(out, BOON.ironGiantHpMul);
  out.attackSpeedMul *= BOON.ironGiantAttackSpeedMul;
  out.moveSpeedMul *= BOON.ironGiantMoveMul;
}

/** 病み喰い: 付ける状態異常の強さ ×plagueEaterPotencyMul、最大生命 ×plagueEaterHpMul（必ず会心は boonRules.ts） */
function foldPlagueEater(out: PlayerStats): void {
  out.statusPotencyMul *= BOON.plagueEaterPotencyMul;
  scaleMaxHp(out, BOON.plagueEaterHpMul);
}

const CORE_FOLDS: ReadonlyArray<readonly [BoonKey, (out: PlayerStats) => void]> = [
  ["coreGlassHeart", foldGlassHeart],
  ["coreTempo", foldTempo],
  ["coreBloodLoop", foldBloodLoop],
  ["coreManaTide", foldManaTide],
  ["coreMirage", foldMirage],
  ["coreIronGiant", foldIronGiant],
  ["corePlagueEater", foldPlagueEater],
];

/** 芯の数値を stats に畳み込む（元の stats は変更しない）。foldBoonStats の末尾、気力の下限の前に呼ぶ */
export function foldCoreStats(stats: Readonly<PlayerStats>, boons: readonly BoonKey[]): PlayerStats {
  const out: PlayerStats = { ...stats };
  for (const [key, fold] of CORE_FOLDS) if (boons.includes(key)) fold(out);
  return out;
}

/** 呪い喰い: 3 択に必ず呪い付きを 1 枚混ぜる（rollBoonOptions が抽選の後に OR で読む。乱数列を変えない） */
export function coreCursedForced(state: GameState): boolean {
  return holds(state, "coreCurseEater");
}

/** 呪い喰い: 持つ呪い付き 1 つごとに大祝福・神威の確率へ加算（上限 curseEaterMaxShift） */
export function coreGradeShift(state: GameState): number {
  if (!holds(state, "coreCurseEater")) return 0;
  const curses = state.boons.filter((k) => BOONS[k].cursed).length;
  return Math.min(BOON.curseEaterMaxShift, curses * BOON.curseEaterGradeShiftPerCurse);
}

/** 呪い喰いの間は呪い付きを手放せない（契約の解呪・呪詛の声の達成が見る） */
export function coreKeepsCurses(state: GameState): boolean {
  return holds(state, "coreCurseEater");
}

/** 血の巡りの間はハートを拾えない（floor.ts の拾得が見る） */
export function coreBlocksHearts(state: GameState): boolean {
  return holds(state, "coreBloodLoop");
}
