import { type GameState, pushLog, pushSfx } from "../core/state";
import { SKILL_DEFS, wearBudCount } from "./data";
import { saveSkillProfile, stoneInSlot } from "./persistence";
import { WEAR_TUNING as W } from "./tuning2";
import type { SkillStone, StoneWear, WearBud } from "./types";

/**
 * スキル石の使い込み（docs/ideas/skills-expansion.md 5 章。装備の来歴と同じ「積み重ね → 節目 → 芽」）。
 * 手動の発動回数の節目で芽が 1 つ出て、芽は威力・効果量を伸ばす（旧「枠」の芽は刻印符のラン内化で廃止し、威力へ写した）。
 * 芽は石に残り、次のランにも持ち越す。乱数は使わない（決定性とリプレイを崩さない）
 */

const PERCENT = 100;

export const WEAR_BUD_LABEL: Readonly<Record<WearBud, string>> = {
  power: "威力",
};

/** 石の使い込み（無ければ作る） */
export function stoneWear(stone: SkillStone): StoneWear {
  if (!stone.wear) stone.wear = { casts: 0, hits: 0, buds: [] };
  return stone.wear;
}

/** スキルの命中 1 回（skills/hit.ts の skillHit が呼ぶ）。slot は発動したスロット */
export function noteWearHit(state: GameState, slot: number): void {
  // 拠点での試し撃ちは使い込みに数えない
  if (state.sandbox || slot < 0) return;
  const stone = stoneInSlot(state.skills.profile, slot);
  if (stone) stoneWear(stone).hits += 1;
}

/** 手動の発動 1 回（system/skills.ts の castSlot が呼ぶ）。節目に届いたら芽を出し、出た芽を返す */
export function noteWearCast(state: GameState, slot: number): WearBud | null {
  if (state.sandbox) return null;
  const stone = stoneInSlot(state.skills.profile, slot);
  if (!stone) return null;
  const wear = stoneWear(stone);
  wear.casts += 1;
  const next = W.milestones[wear.buds.length];
  if (next === undefined || wear.casts < next) return null;
  const bud: WearBud = "power";
  wear.buds.push(bud);
  announceBud(state, stone);
  saveSkillProfile(state.skills.profile);
  return bud;
}

function announceBud(state: GameState, stone: Readonly<SkillStone>): void {
  const name = SKILL_DEFS[stone.skillKey].name;
  const text = `芽: 威力 +${Math.round(W.powerPerBud * PERCENT)}%`;
  pushLog(state, `「${name}」の石が使い込まれた。${text}`, W.color);
  pushSfx(state, "runeAttach");
}

/** 装備画面の 1 行: 発動・命中の数、出た芽、次の節目までの回数 */
export function wearSummary(stone: Readonly<SkillStone>): string {
  const wear = stone.wear ?? { casts: 0, hits: 0, buds: [] };
  const buds = budText(stone);
  const next = W.milestones[wear.buds.length];
  const tail = next === undefined ? "これ以上の芽なし" : `次の芽まで ${Math.max(0, next - wear.casts)} 回`;
  return `使い込み 発動 ${wear.casts} / 命中 ${wear.hits}${buds ? `  ${buds}` : ""}  ${tail}`;
}

function budText(stone: Readonly<SkillStone>): string {
  const power = wearBudCount(stone);
  if (power === 0) return "";
  return `芽: ${WEAR_BUD_LABEL.power} +${Math.round(power * W.powerPerBud * PERCENT)}%`;
}
