import { affixDef } from "../loot/affixes";
import { describeTrait } from "../loot/describe";
import { innateAt } from "../loot/innate";
import type { AffixRoll, Item } from "../loot/types";
import { MENU_BUDGET } from "../data/tuning";

/**
 * 候補を今の遺物と比べる「差」（docs/ideas/inventory-v2/E-merged.md 5 章の 3）。
 * 共通の性質は書かず、得る / 失うの行（合わせて diffRows 行 + 「ほか n」）と、地金の差（▲▼ を innateDiffs 個まで）だけを返す。
 * 文は loot/describe.ts の describeTrait の既存の文をそのまま使う（新しい文を作らない）
 */

export type SwapDiffKind = "gain" | "lose";

export interface SwapDiffRow {
  kind: SwapDiffKind;
  /** describeTrait の表示行（芽・反転の印つき） */
  text: string;
  /** 性質の key */
  key: string;
}

/** 地金の差 1 つ。数値は並べ替えの鍵で、画面には ▲▼ だけ出す（UI が出す数の予算） */
export interface InnateDelta {
  /** 地金の行の key（attr_str / armorFlat など） */
  key: string;
  /** 「筋力」「防御力」など、値を除いた名前 */
  label: string;
  direction: "up" | "down";
  delta: number;
}

export interface SwapDiff {
  rows: SwapDiffRow[];
  /** 行に入りきらなかった得る・失うの数（「ほか n」） */
  more: number;
  innate: InnateDelta[];
}

/** 得るを先に最大この行数まで見せる（失うを必ず 1 行は残すため）。失うが無いときは全行を使う */
const GAIN_ROWS_WHEN_LOSING = 2;
/** 値の違いは同じ性質として畳むので、反転だけを別の性質として扱う */
const INVERTED_MARK = "!";
/** 地金の差とみなさない値の幅（丸めの誤差） */
const INNATE_EPSILON = 1e-9;
/** 地金の行の表示名から値の部分（「 +{v}」以降）を除く */
const LABEL_VALUE_TAIL = /\s*\+\{v\}.*$/;

function identityOf(roll: Readonly<AffixRoll>): string {
  return `${roll.key}${roll.inverted === true ? INVERTED_MARK : ""}`;
}

/** a の性質のうち b に無いもの（key と反転で同じとみなす。値の違いは畳む） */
function onlyIn(a: readonly AffixRoll[], b: readonly AffixRoll[]): AffixRoll[] {
  const other = new Set(b.map(identityOf));
  return a.filter((roll) => !other.has(identityOf(roll)));
}

function rowOf(kind: SwapDiffKind, roll: Readonly<AffixRoll>): SwapDiffRow {
  return { kind, text: describeTrait(roll).text, key: roll.key };
}

/** 得る / 失うの行。得るを先に（失うがあれば最大 2 行）、残りを失うに回す。溢れは more */
function pickRows(gain: readonly AffixRoll[], lose: readonly AffixRoll[]): { rows: SwapDiffRow[]; more: number } {
  const max = MENU_BUDGET.diffRows;
  const gainCap = lose.length === 0 ? max : Math.min(max, GAIN_ROWS_WHEN_LOSING);
  const gains = gain.slice(0, gainCap).map((r) => rowOf("gain", r));
  const loses = lose.slice(0, max - gains.length).map((r) => rowOf("lose", r));
  const rows = [...gains, ...loses];
  return { rows, more: gain.length + lose.length - rows.length };
}

function labelOfInnate(key: string): string {
  const label = affixDef(key)?.label;
  return label === undefined ? key : label.replace(LABEL_VALUE_TAIL, "");
}

function innateValues(item: Readonly<Item> | null, depth: number): Map<string, number> {
  const out = new Map<string, number>();
  if (item === null) return out;
  for (const roll of innateAt(item, depth)) out.set(roll.key, (out.get(roll.key) ?? 0) + roll.value);
  return out;
}

/** 地金の差。変わりの大きい順（同じ大きさは出た順）に innateDiffs 個まで。depth は今の深度（地金は深度で決め直す。拠点・倉庫は 1） */
function innateDeltas(candidate: Readonly<Item>, current: Readonly<Item> | null, depth: number): InnateDelta[] {
  const after = innateValues(candidate, depth);
  const before = innateValues(current, depth);
  const keys = [...new Set([...before.keys(), ...after.keys()])];
  return keys
    .map((key) => ({ key, delta: (after.get(key) ?? 0) - (before.get(key) ?? 0) }))
    .filter((d) => Math.abs(d.delta) > INNATE_EPSILON)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, MENU_BUDGET.innateDiffs)
    .map((d): InnateDelta => ({ key: d.key, label: labelOfInnate(d.key), direction: d.delta > 0 ? "up" : "down", delta: d.delta }));
}

/** candidate に替えたときの差（current = 今の遺物。空きの部位は null） */
export function swapDiff(candidate: Readonly<Item>, current: Readonly<Item> | null, depth = 1): SwapDiff {
  const gain = onlyIn(candidate.affixes, current?.affixes ?? []);
  const lose = onlyIn(current?.affixes ?? [], candidate.affixes);
  const { rows, more } = pickRows(gain, lose);
  return { rows, more, innate: innateDeltas(candidate, current, depth) };
}
