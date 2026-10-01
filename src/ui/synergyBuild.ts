import { type KeywordProfile, emptyProfile, kw, mergeProfiles } from "../core/keywords";
import type { GameState } from "../core/state";
import type { SynergyBuild, SynergyElement } from "../loot/describe";
import { itemKeywords } from "../loot/describe";
import { computeStats } from "../loot/stats";
import { SLOTS, type Equipment, type Slot } from "../loot/types";
import { SKILL, SKILL_DEFS } from "../skills/data";
import { stoneInSlot } from "../skills/persistence";
import { BOONS } from "../system/boonDefs";
import { skillKeywords, statsKeywords } from "../system/keywords";

/**
 * 今のビルドの要素（遺物・スキル石・祝福）と語の和（docs/ideas/synergy-web.md 4-a）。
 * 遺物の書付・石の相性の行が「これを外した / 入れ替えた場合」の穴を見るのに使う。
 * 旧「網」タブ（ui/synergyPanel.ts）から、タブを消しても残る部分だけを移した
 */

/** 外す要素（ツールチップで「これを外した / 入れ替えた場合」の穴を見るため） */
export interface SynergyExclude {
  slot?: Slot;
  skillSlot?: number;
}

/** 装備の組み合わせでだけ現れる語の要素名（源と糧の共鳴とは別。個々の遺物が持たない語） */
const GEAR_WHOLE_NAME = "装備全体";

function equipmentWithout(equipment: Readonly<Equipment>, slot: Slot | undefined): Equipment {
  const copy = { ...equipment };
  if (slot !== undefined) copy[slot] = null;
  return copy;
}

/** 全体の語から、個々の要素が既に持つ語を除いた残り（装備の組み合わせでだけ現れる語） */
function residual(whole: Readonly<KeywordProfile>, parts: readonly Readonly<KeywordProfile>[]): KeywordProfile {
  const merged = mergeProfiles(emptyProfile(), ...parts);
  return kw(
    whole.produces.filter((k) => !merged.produces.includes(k)),
    whole.consumes.filter((k) => !merged.consumes.includes(k)),
    whole.amplifies.filter((k) => !merged.amplifies.includes(k)),
  );
}

function isEmptyProfile(p: Readonly<KeywordProfile>): boolean {
  return p.produces.length + p.consumes.length + p.amplifies.length === 0;
}

function equipmentElements(state: GameState, exclude: SynergyExclude): SynergyElement[] {
  const equipment = equipmentWithout(state.profile.equipment, exclude.slot);
  const items: SynergyElement[] = [];
  for (const slot of SLOTS) {
    const item = equipment[slot];
    if (item) items.push({ kind: "item", name: item.name, keywords: itemKeywords(item) });
  }
  if (items.length === 0) return items;
  const rest = residual(statsKeywords(computeStats(equipment)), items.map((e) => e.keywords));
  if (!isEmptyProfile(rest)) items.push({ kind: "resonance", name: GEAR_WHOLE_NAME, keywords: rest });
  return items;
}

function skillElements(state: GameState, exclude: SynergyExclude): SynergyElement[] {
  const rs = state.skills;
  const list: SynergyElement[] = [];
  for (let i = 0; i < SKILL.slots; i++) {
    if (i === exclude.skillSlot) continue;
    const stone = stoneInSlot(rs.profile, i);
    if (!stone) continue;
    const def = SKILL_DEFS[stone.skillKey];
    list.push({ kind: "skill", name: def.name, keywords: skillKeywords(def, rs.slots[i]?.modifiers ?? []) });
  }
  return list;
}

/** 今のビルド = 装備中の遺物（+ 装備全体でだけ現れる語）+ 装着スキル石（刻印符込み）+ 取得済み祝福 */
export function synergyBuild(state: GameState, exclude: SynergyExclude = {}): SynergyBuild {
  const elements: SynergyElement[] = [
    ...equipmentElements(state, exclude),
    ...skillElements(state, exclude),
    ...state.boons.map((key): SynergyElement => ({ kind: "boon", name: BOONS[key].name, keywords: BOONS[key].keywords })),
  ];
  return { profile: mergeProfiles(emptyProfile(), ...elements.map((e) => e.keywords)), elements };
}
