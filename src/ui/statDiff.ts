import type { GameState } from "../core/state";
import { ELEMENTS, type Element } from "../core/element";
import { ATTR_TRAIT_PREFIX, RESIST_TRAIT_PREFIX } from "../loot/affixes";
import { INNATE_ARMOR_KEY } from "../loot/innate";
import { computeStats } from "../loot/stats";
import { ATTR_KEYS, type AttrKey, type Equipment, type Item, type PlayerStats } from "../loot/types";
import { deriveAttributes } from "../system/attributes";
import { foldBoonStats } from "../system/boons";
import { isDeepDepth } from "../system/chapters";
import { applyRunStats } from "../system/runSetup";
import { swapDiff } from "./swapDiff";

/**
 * 候補を付けたときのステータスの変わり方（「防御力 12 → 15」。今の値と付けた後の値）。
 * 値は遺物の地金どうしの差ではなく、装備・起点・祝福を畳んだ後の自分のステータス（装備画面の体の書付と同じ値）。
 * 項目の選び方・並べ方は swapDiff の地金の差と同じ（変わりの大きい順）。単一の総合指標にはまとめない。
 * state は読むだけ（applyStats の畳み込みの前半を、装備だけ差し替えて数え直す）
 */

/** 1 項目の変わり方。before / after は表示用の文字（単位つき） */
export interface StatChange {
  /** 地金の行の key（armorFlat / attr_str / res_fire） */
  key: string;
  label: string;
  before: string;
  after: string;
  /** 上がる（良くなる）か。下がるものは色を分ける */
  rises: boolean;
}

export interface StatChanges {
  /** innateDiffs 個まで */
  changes: StatChange[];
  /** 入りきらなかった数 */
  more: number;
}

/** 値の小数の桁（防御力の端数に合わせる）。末尾の 0 は落とす */
const VALUE_DIGITS = 1;
/** 値が同じとみなす幅 */
const VALUE_EPSILON = 1e-6;
const PERCENT = "%";

function isAttrKey(v: string): v is AttrKey {
  return (ATTR_KEYS as readonly string[]).includes(v);
}

function isElement(v: string): v is Element {
  return (ELEMENTS as readonly string[]).includes(v);
}

interface StatReading {
  value: number;
  unit: string;
}

/** 地金の行の key が指すステータスの値（地金に無い種類の key は null） */
export function readInnateStat(stats: Readonly<PlayerStats>, key: string): StatReading | null {
  if (key === INNATE_ARMOR_KEY) return { value: stats.armor, unit: "" };
  if (key.startsWith(ATTR_TRAIT_PREFIX)) {
    const attr = key.slice(ATTR_TRAIT_PREFIX.length);
    return isAttrKey(attr) ? { value: stats.attributes[attr], unit: "" } : null;
  }
  if (key.startsWith(RESIST_TRAIT_PREFIX)) {
    const element = key.slice(RESIST_TRAIT_PREFIX.length);
    return isElement(element) ? { value: stats.resist[element], unit: PERCENT } : null;
  }
  return null;
}

/** 表示する値（小数 1 桁。整数なら小数を出さない） */
export function formatStatValue(value: number, unit: string): string {
  return `${Number(value.toFixed(VALUE_DIGITS))}${unit}`;
}

/** 装備を差し替えたときの自分のステータス（applyStats の前半: 装備 → 起点・誓約 → 派生 → 祝福。共鳴は数えない） */
export function projectedStats(state: Readonly<GameState>, equipment: Readonly<Equipment>): PlayerStats {
  const base = applyRunStats(state as GameState, computeStats(equipment as Equipment, state.depth));
  const derived = deriveAttributes(base);
  return foldBoonStats(derived, state.boons, state.boonRun, isDeepDepth(state.depth));
}

/** 地金の行ごとの「今 → 後」。値が変わらない項目は出さない（装備が封じられている間など） */
function changeOf(key: string, label: string, before: Readonly<PlayerStats>, after: Readonly<PlayerStats>): StatChange | null {
  const a = readInnateStat(before, key);
  const b = readInnateStat(after, key);
  if (a === null || b === null) return null;
  const from = formatStatValue(a.value, a.unit);
  const to = formatStatValue(b.value, b.unit);
  if (from === to || Math.abs(b.value - a.value) < VALUE_EPSILON) return null;
  return { key, label, before: from, after: to, rises: b.value > a.value };
}

/** candidate を付けたときに変わる地金のステータス（current = 今の同じ部位の遺物。空きは null） */
export function statChangesOf(state: Readonly<GameState>, candidate: Readonly<Item>, current: Readonly<Item> | null): StatChanges {
  const diff = swapDiff(candidate, current, Math.max(1, state.depth));
  if (diff.innate.length === 0) return { changes: [], more: 0 };
  const worn = state.profile.equipment;
  const before = projectedStats(state, worn);
  const after = projectedStats(state, { ...worn, [candidate.slot]: candidate });
  const changes = diff.innate
    .map((d) => changeOf(d.key, d.label, before, after))
    .filter((c): c is StatChange => c !== null);
  return { changes, more: diff.innateMore };
}
