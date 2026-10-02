import { MENU_BUDGET } from "../data/tuning";
import { MODIFIERS, SKILL_DEFS, type VariantEffect, dwellLabel, modifierVerb, variantEffectText, variantEffects, wearBudCount } from "../skills/data";
import type { SkillStone } from "../skills/types";

/**
 * 候補の頁でスキル石を見比べる文（docs/ideas/skill-stone-hunt.md）。DOM・Canvas に依存しない純関数。
 * 書付を開かなくても、札の 2 段目で変異と宿り符が、下の差の欄で付けている石との違いが読めるようにする
 */

/** 札の 2 段目の 1 区切り。tone で色を分ける（宿り符 = 金・伸びる = 上・縮む = 下） */
export interface StoneCardChip {
  text: string;
  tone: "dwell" | "good" | "bad";
}

/** 差の欄の 1 行。info は得る・失うのどちらでもない行（label をそのまま頭に出す） */
export interface StoneDiffRow {
  tone: "gain" | "loss" | "info";
  label?: string;
  text: string;
}

export interface StoneDiffView {
  title: string;
  rows: StoneDiffRow[];
  /** 欄に入らなかった行の数（「ほか n」） */
  more: number;
}

const NAME_JOINT = " と ";
const SAME_SKILL_TITLE = "　付けている石との差";
const VARIANT_LABEL = "変異";
const GROUP_LABEL = "束";
const CHIP_SEP = "　";
const NO_DIFF = "変異も宿り符も同じ";

/** 札の 2 段目: 宿り符（あれば先頭）→ 変異の増減（伸びる側から） */
export function stoneCardChips(stone: Readonly<SkillStone>): StoneCardChip[] {
  const dwell = dwellLabel(stone);
  const chips: StoneCardChip[] = dwell === null ? [] : [{ text: dwell, tone: "dwell" }];
  for (const e of variantEffects(stone)) chips.push({ text: variantEffectText(e), tone: e.good ? "good" : "bad" });
  return chips;
}

/** 束の札の 2 段目: 束の中の宿り符の名前（無ければ空） */
export function groupCardChips(stones: readonly Readonly<SkillStone>[]): StoneCardChip[] {
  const names = new Set<string>();
  for (const s of stones) if (s.dwell !== undefined) names.add(MODIFIERS[s.dwell].name);
  return names.size === 0 ? [] : [{ text: `宿 ${[...names].join("・")}`, tone: "dwell" }];
}

/** 変異の 1 行（「範囲+24%　威力-18%　宿 連鎖」）。無ければ null */
function variantRow(stone: Readonly<SkillStone>): StoneDiffRow | null {
  const chips = stoneCardChips(stone);
  if (chips.length === 0) return null;
  return { tone: "info", label: VARIANT_LABEL, text: chips.map((c) => c.text).join(CHIP_SEP) };
}

/** 量 1 つの「上がると良いか」（+1 = 大きいほど良い・-1 = 小さいほど良い） */
function betterSign(e: Readonly<VariantEffect>): number {
  return e.good === e.amount > 0 ? 1 : -1;
}

function signed(n: number): string {
  return n >= 0 ? `+${n}` : String(n);
}

/** 同じスキルの 2 つの石の変異の差（量ごとに「今 → 候補」。良くなる量は得る、悪くなる量は失う） */
function effectRows(candidate: Readonly<SkillStone>, current: Readonly<SkillStone>): StoneDiffRow[] {
  const now = new Map(variantEffects(current).map((e) => [e.label, e] as const));
  const next = new Map(variantEffects(candidate).map((e) => [e.label, e] as const));
  const labels = [...new Set([...now.keys(), ...next.keys()])];
  const rows: { row: StoneDiffRow; size: number }[] = [];
  for (const label of labels) {
    const a = now.get(label);
    const b = next.get(label);
    const ref = b ?? a;
    if (ref === undefined) continue;
    const before = a?.amount ?? 0;
    const after = b?.amount ?? 0;
    if (before === after) continue;
    const better = (after - before) * betterSign(ref) > 0;
    rows.push({
      row: { tone: better ? "gain" : "loss", text: `${label} ${signed(before)}${ref.unit} → ${signed(after)}${ref.unit}` },
      size: Math.abs(after - before),
    });
  }
  return rows.sort((x, y) => y.size - x.size).map((r) => r.row);
}

/** 宿り符の差（候補にあって今に無い = 得る、今にあって候補に無い = 失う） */
function dwellRows(candidate: Readonly<SkillStone>, current: Readonly<SkillStone>): StoneDiffRow[] {
  if (candidate.dwell === current.dwell) return [];
  const def = SKILL_DEFS[candidate.skillKey];
  const rows: StoneDiffRow[] = [];
  if (candidate.dwell !== undefined) rows.push({ tone: "gain", text: `宿り符 ${MODIFIERS[candidate.dwell].name}: ${modifierVerb(candidate.dwell, def)}` });
  if (current.dwell !== undefined) rows.push({ tone: "loss", text: `宿り符 ${MODIFIERS[current.dwell].name}` });
  return rows;
}

/** 使い込みの芽の差（替えると付けている石の芽は付いてこない） */
function wearRows(candidate: Readonly<SkillStone>, current: Readonly<SkillStone>): StoneDiffRow[] {
  const before = wearBudCount(current);
  const after = wearBudCount(candidate);
  if (before === after) return [];
  return [{ tone: after > before ? "gain" : "loss", text: `使い込みの芽 ${before} → ${after}` }];
}

function capped(title: string, rows: readonly StoneDiffRow[]): StoneDiffView {
  const limit = MENU_BUDGET.diffRows;
  return { title, rows: rows.slice(0, limit), more: Math.max(0, rows.length - limit) };
}

/**
 * 候補の石と付けている石の差。同じスキルなら宿り符 → 変異の量 → 芽の差、
 * 違うスキル（か空き）なら得る動詞 → 候補の変異 → 失う動詞
 */
export function stoneSwapDiff(candidate: Readonly<SkillStone>, current: Readonly<SkillStone> | null): StoneDiffView {
  const next = SKILL_DEFS[candidate.skillKey];
  if (current !== null && current.skillKey === candidate.skillKey) {
    const rows = [...dwellRows(candidate, current), ...effectRows(candidate, current), ...wearRows(candidate, current)];
    return capped(`${next.name}${SAME_SKILL_TITLE}`, rows.length === 0 ? [{ tone: "info", text: NO_DIFF }] : rows);
  }
  const now = current === null ? null : SKILL_DEFS[current.skillKey];
  const rows: StoneDiffRow[] = [{ tone: "gain", text: next.verb }];
  const variants = variantRow(candidate);
  if (variants !== null) rows.push(variants);
  if (now !== null && now.verb !== next.verb) rows.push({ tone: "loss", text: now.verb });
  return capped(now === null ? next.name : `${next.name}${NAME_JOINT}${now.name}`, rows);
}

/** 束の札の差: 違うスキルなら得る・失うの動詞、束の数と開き方 */
export function groupSwapDiff(stones: readonly Readonly<SkillStone>[], current: Readonly<SkillStone> | null): StoneDiffView | null {
  const head = stones[0];
  if (head === undefined) return null;
  const next = SKILL_DEFS[head.skillKey];
  const same = current !== null && current.skillKey === head.skillKey;
  const rows: StoneDiffRow[] = [];
  if (!same) rows.push({ tone: "gain", text: next.verb });
  rows.push({ tone: "info", label: GROUP_LABEL, text: `${stones.length} 個。決定で 1 個ずつ見比べる` });
  if (current !== null && !same) rows.push({ tone: "loss", text: SKILL_DEFS[current.skillKey].verb });
  return capped(`${next.name} ×${stones.length}`, rows);
}
