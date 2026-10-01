import type { Element } from "../core/element";
import { type GameState, pushSfx } from "../core/state";
import { formatMeters } from "../core/units";
import { JOBS } from "../data/jobs";
import { PLAYER } from "../data/tuning";
import { ULTIMATES, type UltimateDef, type UltimateKind } from "../data/ultimates";
import { MOVESETS, MOVESET_KEYS, type MovesetKey } from "../data/weapons";
import { chooseUltimate, saveProfile, ultimateChoice } from "../loot/profile";
import { computeStats } from "../loot/stats";
import { ATTR_KEYS, LOOT_SLOTS, type AttrKey, type PlayerStats, createEmptyEquipment } from "../loot/types";
import { dashCooldownTime } from "../system/player";
import { formatCooldown } from "../system/skills";
import type { EffectRow } from "./effectsList";
import { SLOT_LABEL } from "./inventoryLayout";
import { reachRows } from "./reachRows";
import { type ActionFormulas, type FormulaChunk, actionChunks, actionRows, movesetFormulas } from "./scalingText";

/**
 * 書付「体」の中身（旧 ui/statusTab.ts の派生値・奥義の選択を移した。docs/ideas/inventory-v2/E-impl.md 4-3 E6）。
 * 頁 [体] = ステータスと出どころ・体の性能・到達・行動の計算式、[奥義] = 武器種の奥義 3 枚。純関数と奥義の選択だけ（画面の当たりは ui/sheet.ts）。
 * 奥義は拠点（state.sandbox）でだけ選べる。リプレイは開始時の奥義の写しを取るので、ラン中に変えると再生とずれる。
 * 単一の強さの指標（DPS・スコア）は出さない（docs/DESIGN_PRINCIPLES.md）
 */

// ---------------------------------------------------------------------------
// 体の性能（ステータスから伸びるもの）
// ---------------------------------------------------------------------------

export interface DerivedStatRow {
  label: string;
  value: string;
  /** 伸ばすステータス（色分け用。ステータスに依らなければ null） */
  attr: AttrKey | null;
}

const PERCENT = 100;
const PER_SECOND = "/秒";
const REGEN_DIGITS = 1;

function percent(mul: number): string {
  return `${Math.round(mul * PERCENT)}%`;
}

/** 「12/-5/0%」。3 属性の耐性 %（PlayerStats.resist）をまとめて 1 行に出す */
function resistTriple(stats: Readonly<PlayerStats>, a: Element, b: Element, c: Element): string {
  return `${Math.round(stats.resist[a])}/${Math.round(stats.resist[b])}/${Math.round(stats.resist[c])}%`;
}

/** 体の性能の行。値は今の stats（装備・共鳴・祝福を畳み込んだ後）から読む */
export function derivedStatRows(stats: Readonly<PlayerStats>): DerivedStatRow[] {
  return [
    { label: "最大生命", value: `${Math.round(stats.maxHp)}`, attr: "vit" },
    { label: "被る状態異常の持続", value: percent(stats.statusTakenMul), attr: "vit" },
    { label: "最大気力", value: `${Math.round(stats.maxMana)}`, attr: "mnd" },
    { label: "気力の自然回復", value: `${Number(stats.manaRegen.toFixed(REGEN_DIGITS))}${PER_SECOND}`, attr: "mnd" },
    { label: "移動速度", value: `${formatMeters(PLAYER.speed * stats.moveSpeedMul)}${PER_SECOND}`, attr: "dex" },
    { label: "ダッシュ再使用", value: formatCooldown(dashCooldownTime(stats)), attr: "dex" },
    { label: "防御力", value: `${Math.round(stats.armor)}`, attr: null },
    { label: "魔防", value: `${Math.round(stats.warding)}`, attr: null },
    { label: "耐性 炎/氷/雷", value: resistTriple(stats, "fire", "ice", "lightning"), attr: null },
    { label: "耐性 毒/闇/光", value: resistTriple(stats, "poison", "dark", "light"), attr: null },
  ];
}

/** 到達の行（装備だけの stats.reach から組む。拠点でも出す） */
export function bodyReachRows(state: Readonly<GameState>): EffectRow[] {
  return reachRows(state.stats);
}

// ---------------------------------------------------------------------------
// ステータスの出どころ（ジョブ・部位ごと・ほか）
// ---------------------------------------------------------------------------

export interface AttributeSource {
  label: string;
  value: number;
}

const OTHER_LABEL = "ほか";

/**
 * ステータス 1 つの出どころ。ジョブの偏り → 部位ごと（その遺物だけを着たときの差）→ ほか（起点・祝福・丸めの差）。
 * 0 の出どころは書かない。合計は state.stats.attributes と一致する（ほかで埋める）
 */
export function attributeSources(state: Readonly<GameState>): Record<AttrKey, AttributeSource[]> {
  const empty = computeStats(createEmptyEquipment(), state.depth).attributes;
  const perSlot = LOOT_SLOTS.flatMap((slot) => {
    const item = state.profile.equipment[slot];
    if (!item) return [];
    const one = { ...createEmptyEquipment(), [slot]: item };
    return [{ label: SLOT_LABEL[slot], attrs: computeStats(one, state.depth).attributes }];
  });
  const job = JOBS[state.job];
  const out = {} as Record<AttrKey, AttributeSource[]>;
  for (const key of ATTR_KEYS) {
    const list: AttributeSource[] = [];
    const jobValue = job.attributes[key] ?? 0;
    if (jobValue !== 0) list.push({ label: job.name, value: jobValue });
    for (const s of perSlot) {
      const v = s.attrs[key] - empty[key];
      if (v !== 0) list.push({ label: s.label, value: v });
    }
    const rest = state.stats.attributes[key] - empty[key] - list.reduce((sum, s) => sum + s.value, 0);
    if (rest !== 0) list.push({ label: OTHER_LABEL, value: rest });
    out[key] = list;
  }
  return out;
}

/** 「剣士 +10・右手 +6」 */
export function attributeSourceText(sources: readonly AttributeSource[]): string {
  return sources.map((s) => `${s.label} ${s.value > 0 ? "+" : ""}${s.value}`).join("・");
}

// ---------------------------------------------------------------------------
// 行動の行と計算式
// ---------------------------------------------------------------------------

/** 今の右手の武器種の行動（行動の行。並びは scalingText の movesetFormulas） */
export function bodyActions(state: Readonly<GameState>): ActionFormulas[] {
  return movesetFormulas(state.stats, MOVESETS[state.stats.moveset], state.stats.bullet);
}

/** 焦点の行動の計算式 1 本（行動名 + 最初の式。式の無い派生は値だけの行） */
export function bodyActionChunks(action: Readonly<ActionFormulas>): FormulaChunk[] {
  const first = action.formulas[0];
  if (first !== undefined) return actionChunks(action, first);
  return actionRows(action)[0] ?? [];
}

// ---------------------------------------------------------------------------
// 奥義
// ---------------------------------------------------------------------------

/** 奥義の種類の表示名（docs/GLOSSARY.md「一撃 / 持続」） */
export const ULTIMATE_KIND_LABEL: Readonly<Record<UltimateKind, string>> = { instant: "一撃", sustain: "持続" };

/** 奥義の必要ゲージ。定義に cost が無い版でも読めるよう、有るときだけ返す */
export function ultimateCostOf(def: UltimateDef): number | null {
  if (!("cost" in def)) return null;
  const cost: unknown = def.cost;
  return typeof cost === "number" ? cost : null;
}

/** 奥義を選べるのは拠点だけ */
export function canChooseUltimate(state: Readonly<GameState>): boolean {
  return state.sandbox === true;
}

/**
 * 奥義の頁に出す武器種。拠点では今の右手から steps だけ送った武器種（端は反対側へ回る）、ラン中は今の右手の武器種
 */
export function sheetMoveset(state: Readonly<GameState>, steps: number): MovesetKey {
  const current = state.stats.moveset;
  if (!canChooseUltimate(state)) return current;
  const n = MOVESET_KEYS.length;
  const index = (((MOVESET_KEYS.indexOf(current) + steps) % n) + n) % n;
  return MOVESET_KEYS[index] ?? current;
}

/** その武器種で選んでいる奥義の並びの位置 */
export function chosenUltimateIndex(state: Readonly<GameState>, moveset: MovesetKey): number {
  const chosen = ultimateChoice(state.profile, moveset).key;
  return Math.max(0, ULTIMATES[moveset].findIndex((d) => d.key === chosen));
}

const RUN_LOCKED_TEXT = "ラン中は奥義を変えられない";

/** 奥義を選んで保存する。知らせを返す（選べなければ理由、変わらなければ null） */
export function chooseUltimateAt(state: GameState, moveset: MovesetKey, index: number): string | null {
  const def = ULTIMATES[moveset][index];
  if (!def) return null;
  if (!canChooseUltimate(state)) return RUN_LOCKED_TEXT;
  if (ultimateChoice(state.profile, moveset).key === def.key) return null;
  if (!chooseUltimate(state.profile, moveset, def.key)) return null;
  // 拠点の state.profile は main.ts の profile と同じ物（createHub に渡している）なので、装備の付け替えと同じくここで保存する
  saveProfile(state.profile);
  pushSfx(state, "equipOn");
  return `${MOVESETS[moveset].name}の奥義 ${def.name}`;
}
