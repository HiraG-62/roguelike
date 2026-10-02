import type { GameState } from "../core/state";
import { BOON, FEEL } from "../data/tuning";
import type { PlayerStats } from "../loot/types";
import { BOONS, type BoonDef, type BoonKey } from "./boonDefs";

/**
 * 芯の祝福（呪い喰い・拍の刻・血の巡り・逃げ水・硝子の刃・重心・気の泉・銭の亡者。定義は src/system/boonDefs/cursed.ts）の効果のうち、Rule で書けないもの。
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

/** 逃げ水: ダッシュ回数 +mirageCharges、再使用 ×mirageCooldownMul、移動 ×mirageMoveMul（爆発は Rule） */
function foldMirage(out: PlayerStats): void {
  out.dashCharges += BOON.mirageCharges;
  out.dashCooldownMul *= BOON.mirageCooldownMul;
  out.moveSpeedMul *= BOON.mirageMoveMul;
}

/** 硝子の刃の代償: 被ダメージ ×glassDamageTakenMul（与ダメの倍は BoonDef.modifiers） */
function foldGlass(out: PlayerStats): void {
  out.damageTakenMul *= BOON.glassDamageTakenMul;
}

/** 重心: 怯み値 ×heavyPoiseMul・ノックバック ×heavyKnockbackMul、攻撃速度 ×heavyAttackSpeedMul */
function foldHeavy(out: PlayerStats): void {
  out.poiseDamageMul *= BOON.heavyPoiseMul;
  out.knockbackMul *= BOON.heavyKnockbackMul;
  out.attackSpeedMul *= BOON.heavyAttackSpeedMul;
}

/** 気の泉: 最大気力 +wellspringMana・獲得 ×wellspringManaGainMul、最大生命 ×wellspringHpMul（1 未満にはしない） */
function foldWellspring(out: PlayerStats): void {
  out.maxMana += BOON.wellspringMana;
  out.manaGainMul *= BOON.wellspringManaGainMul;
  out.maxHp = Math.max(1, Math.round(out.maxHp * BOON.wellspringHpMul));
}

/** 銭の亡者: 獲得 ×greedCoinGainMul・引き寄せ ×greedMagnetMul、被弾でこぼれる銭 ×greedSpillMul */
function foldGreed(out: PlayerStats): void {
  out.coinGainMul *= BOON.greedCoinGainMul;
  out.coinMagnetMul *= BOON.greedMagnetMul;
  out.coinSpillMul *= BOON.greedSpillMul;
}

const CORE_FOLDS: ReadonlyArray<readonly [BoonKey, (out: PlayerStats) => void]> = [
  ["coreTempo", foldTempo],
  ["coreBloodLoop", foldBloodLoop],
  ["coreMirage", foldMirage],
  ["coreGlass", foldGlass],
  ["coreHeavy", foldHeavy],
  ["coreWellspring", foldWellspring],
  ["coreGreed", foldGreed],
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
