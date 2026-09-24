import { type GameState, pushLog, pushSfx } from "../core/state";
import { addFloatingText } from "../system/effects";
import { SKILL_DEFS, wearBonusLinks, wearBudCount } from "./data";
import { saveSkillProfile, stoneInSlot } from "./persistence";
import { WEAR_TUNING as W } from "./tuning2";
import type { SkillStone, StoneWear, WearBud } from "./types";

/**
 * スキル石の使い込み（docs/ideas/skills-expansion.md 5 章。装備の来歴と同じ「積み重ね → 節目 → 芽」）。
 * 手動の発動回数の節目で芽が 1 つ出る。どちらの芽かは使い方で決まる:
 * 1 発で多くに当てた石は「威力」、撃ち続けた石（命中が少ない・強化）は「枠」（刻印符のリンク +1）。
 * 芽は石に残り、次のランにも持ち越す。乱数は使わない（決定性とリプレイを崩さない）
 */

const PERCENT = 100;
const TEXT_SCALE = 1;
const TEXT_LIFE = 1.4;

export const WEAR_BUD_LABEL: Readonly<Record<WearBud, string>> = {
  link: "枠",
  power: "威力",
};

/** 石の使い込み（無ければ作る） */
export function stoneWear(stone: SkillStone): StoneWear {
  if (!stone.wear) stone.wear = { casts: 0, hits: 0, buds: [] };
  return stone.wear;
}

/** スキルの命中 1 回（skills/hit.ts の skillHit が呼ぶ）。slot は発動したスロット */
export function noteWearHit(state: GameState, slot: number): void {
  if (slot < 0) return;
  const stone = stoneInSlot(state.skills.profile, slot);
  if (stone) stoneWear(stone).hits += 1;
}

/** 手動の発動 1 回（system/skills.ts の castSlot が呼ぶ）。節目に届いたら芽を出し、出た芽を返す */
export function noteWearCast(state: GameState, slot: number): WearBud | null {
  const stone = stoneInSlot(state.skills.profile, slot);
  if (!stone) return null;
  const wear = stoneWear(stone);
  wear.casts += 1;
  const next = W.milestones[wear.buds.length];
  if (next === undefined || wear.casts < next) return null;
  const bud = chooseBud(stone, wear);
  wear.buds.push(bud);
  if (bud === "link") stone.links += 1;
  announceBud(state, stone, bud);
  saveSkillProfile(state.skills.profile);
  return bud;
}

/** 使い方で芽を決める。枠の芽が上限なら威力に替える */
export function chooseBud(stone: Readonly<SkillStone>, wear: Readonly<StoneWear>): WearBud {
  const spread = wear.casts > 0 ? wear.hits / wear.casts : 0;
  if (spread >= W.spreadHitsPerCast) return "power";
  return wearBonusLinks(stone) < W.maxBonusLinks ? "link" : "power";
}

function announceBud(state: GameState, stone: Readonly<SkillStone>, bud: WearBud): void {
  const name = SKILL_DEFS[stone.skillKey].name;
  const text = bud === "link" ? "芽: 刻印符の枠 +1" : `芽: 威力 +${Math.round(W.powerPerBud * PERCENT)}%`;
  addFloatingText(state, state.player.body.pos, text, W.color, TEXT_SCALE, TEXT_LIFE);
  pushLog(state, `「${name}」の石が使い込まれた。${text}`, W.color);
  pushSfx(state, "runeAttach");
}

/** 装備画面の 1 行: 発動・命中の数、出た芽、次の節目までの回数 */
export function wearSummary(stone: Readonly<SkillStone>): string {
  const wear = stone.wear ?? { casts: 0, hits: 0, buds: [] };
  const buds = budText(stone);
  const next = W.milestones[wear.buds.length];
  const tail = next === undefined ? "芽は出尽くした" : `次の芽まで ${Math.max(0, next - wear.casts)} 回`;
  return `使い込み 発動 ${wear.casts} / 命中 ${wear.hits}${buds ? `  ${buds}` : ""}  ${tail}`;
}

function budText(stone: Readonly<SkillStone>): string {
  const parts: string[] = [];
  const links = wearBudCount(stone, "link");
  const power = wearBudCount(stone, "power");
  if (links > 0) parts.push(`${WEAR_BUD_LABEL.link} +${links}`);
  if (power > 0) parts.push(`${WEAR_BUD_LABEL.power} +${Math.round(power * W.powerPerBud * PERCENT)}%`);
  return parts.length > 0 ? `芽: ${parts.join("・")}` : "";
}
