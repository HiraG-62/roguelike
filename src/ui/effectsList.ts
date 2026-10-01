import type { GameState } from "../core/state";
import { BOONS, type BoonDef, type LineageKey } from "../system/boonDefs";
import { BOON_GRADE_LABEL, boonGradeOf } from "../system/boonGrade";
import { ownedCore } from "../system/boonCores";
import { isDeepDepth } from "../system/chapters";
import { countPer } from "../system/modifiers";

/**
 * 書付「系譜」「祝福」の祝福の行: 持っている祝福・芯の名前・格・研鑽の数え・効果の説明（読むだけ）。
 * 状態異常・一時強化の一覧は装備画面から外した（HUD のまま。docs/ideas/inventory-v2/E-impl.md 7 章の 17）。docs/GLOSSARY.md の表記に揃える
 */

export interface EffectRow {
  key: string;
  name: string;
  /** 右寄せの短い情報（残り秒・格など） */
  info: string;
  /** 効果の短い説明（状態異常・一時強化は空文字でよい） */
  detail: string;
}

/** 研鑽の札の今の数え（倒した数・燃やした数など）。数えを持たない札は null。小数は切り捨て */
export function temperCount(state: GameState, def: Readonly<BoonDef>): number | null {
  if (def.card !== "temper") return null;
  if (def.temperStat !== undefined) return Math.floor(state.boonRun.tallies[def.temperStat.tally] ?? 0);
  const per = def.modifiers?.find((m) => m.per !== undefined)?.per;
  return per === undefined ? null : Math.floor(countPer(state, per.count, null));
}

/** 札が上限（研鑽の cap か「〜につき」の cap）を持つか。深みではそれが外れる */
function hasCap(def: Readonly<BoonDef>): boolean {
  return def.temperStat?.cap !== undefined || (def.modifiers ?? []).some((m) => m.per?.cap !== undefined);
}

const DEEP_UNCAPPED_NOTE = "（深み: 最大なし）";

function boonRow(state: GameState, def: Readonly<BoonDef>): EffectRow {
  const grade = BOON_GRADE_LABEL[boonGradeOf(state, def.key)];
  const count = temperCount(state, def);
  const note = isDeepDepth(state.depth) && hasCap(def) ? DEEP_UNCAPPED_NOTE : "";
  return { key: `boon:${def.key}`, name: def.name, info: count === null ? grade : `${grade}・${count}`, detail: def.desc + note };
}

/** 持っている祝福（芯を除く）。名前・格（研鑽は今の数えも）・効果の短い説明 */
export function boonRows(state: GameState): EffectRow[] {
  return state.boons
    .map((key) => BOONS[key])
    .filter((def) => def.core !== true)
    .map((def) => boonRow(state, def));
}

const CORE_INFO = "芯";

/** 持っている芯（1 ランに 1 つ）。無ければ空配列 */
export function coreRows(state: GameState): EffectRow[] {
  const def = ownedCore(state);
  return def ? [{ key: `core:${def.key}`, name: def.name, info: CORE_INFO, detail: def.desc }] : [];
}

/** その系譜の札（融合の札は両方の系譜に入る）。持っている順 */
export function lineageBoonRows(state: GameState, lineage: LineageKey): EffectRow[] {
  return state.boons
    .map((key) => BOONS[key])
    .filter((def) => def.core !== true && (def.lineage === lineage || def.fusion?.includes(lineage) === true))
    .map((def) => boonRow(state, def));
}

/** 祝福 1 つの行（書付「祝福」） */
export function boonSheetRow(state: GameState, def: Readonly<BoonDef>): EffectRow {
  return boonRow(state, def);
}
