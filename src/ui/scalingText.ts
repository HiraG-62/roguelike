import { STATUS_LABEL } from "../core/status";
import { PLAYER } from "../data/tuning";
import { MOVESETS, type MeleeStepDef, type MovesetDef, SHOT_TYPES, type ShotKey, isGun } from "../data/weapons";
import { baseDef } from "../loot/bases";
import { ATTR_LABEL } from "../loot/resonance";
import { ATTR_KEYS, type AttrKey, type AttrRatio, type Item, type PlayerStats, type Scaling } from "../loot/types";
import { SKILL, SKILL_DEFS } from "../skills/data";
import type { SkillKey } from "../skills/types";
import { ratioToScaling, scaled, withRatio } from "../system/attributes";

/**
 * 行動ごとの係数（docs/COMBAT_DESIGN.md A-10）を「威力 18 = 10 ＋ 筋力×1.3 ＋ 技巧×0.2」の形に組み立てる。
 * DOM・Canvas に依存しない純関数だけを置き、色付けと折り返しは render 側（detailPane.ts）が行う。
 * ここで出す値は「係数による基礎の値」。装備の倍率・刻印符・祝福などは後から掛かるので含めない
 */

/** 計算式の量の種類。威力 / 怯み値 / 状態異常の効果量 / 強化の効果量 */
export type FormulaKind = "power" | "poise" | "potency" | "buff";

export interface ScalingTerm {
  attr: AttrKey;
  /** 実効値 1 点あたりの係数 */
  coef: number;
  /** 今の実効値での寄与（coef × 実効値。倍率 mul は掛けない） */
  contribution: number;
}

export interface ScalingFormula {
  kind: FormulaKind;
  /** 見出し（威力・怯み値・出血の効果量 など） */
  label: string;
  /** 今のステータスでの値（mul を掛けた後） */
  value: number;
  /** ステータス 0 のときの値（mul を掛ける前） */
  base: number;
  terms: ScalingTerm[];
  /** 係数の後に掛かる型の倍率（射撃の型の damageMul など）。1 なら式に出さない */
  mul: number;
}

/** 行動 1 つぶんの式（1 段目・ダッシュ攻撃・スキルの 1 つの量 など） */
export interface ActionFormulas {
  name: string;
  formulas: ScalingFormula[];
}

/** 表示の 1 片。attr はステータス名（色を付ける）、tone は見た目の強弱 */
export interface FormulaPiece {
  text: string;
  attr?: AttrKey;
  tone?: "name" | "dim";
}

/** 折り返さないひとかたまり。glue は直前のかたまりと空白を挟まずにつなぐ */
export interface FormulaChunk {
  pieces: FormulaPiece[];
  glue?: boolean;
}

/** 係数の小数の桁（末尾の 0 は落とす） */
const COEF_DIGITS = 2;
/** 値の小数の桁。強化の効果量は倍率なので 2 桁 */
const VALUE_DIGITS: Readonly<Record<FormulaKind, number>> = { power: 1, poise: 1, potency: 1, buff: 2 };
const PLUS = "+";
const MINUS = "-";
const TIMES = "×";
const EQUALS = "=";
const NAME_SEP = "・";
export const NO_SCALING_NOTE = "（ステータスで変わらない）";
export const NO_REFERENCE_TEXT = "ステータスで変わらない";
export const MAIN_REFERENCE_HEAD = "主に参照: ";
export const NOT_REFERENCED_TEXT = "今は参照されない";
const EPS = 1e-9;

// ---------------------------------------------------------------------------
// 数の書式
// ---------------------------------------------------------------------------

function trimDigits(n: number, digits: number): string {
  const v = Number(n.toFixed(digits));
  // -0 を「0」に揃える
  return String(Object.is(v, -0) ? 0 : v);
}

/** 係数の表記。小数 2 桁まで、末尾の 0 は落とす（1.30 → 1.3） */
export function formatCoef(n: number): string {
  return trimDigits(n, COEF_DIGITS);
}

export function formatValue(n: number, kind: FormulaKind): string {
  return trimDigits(n, VALUE_DIGITS[kind]);
}

// ---------------------------------------------------------------------------
// 式の組み立て
// ---------------------------------------------------------------------------

function termsOf(stats: Readonly<PlayerStats>, s: Readonly<Scaling>): ScalingTerm[] {
  const out: ScalingTerm[] = [];
  for (const attr of ATTR_KEYS) {
    const coef = s[attr] ?? 0;
    if (Math.abs(coef) < EPS) continue;
    out.push({ attr, coef, contribution: coef * stats.attributesEff[attr] });
  }
  return out;
}

/** Scaling（ステータス 0 のときの値 + 係数）から式を作る。mul は係数の後に掛かる型の倍率 */
export function scalingFormula(stats: Readonly<PlayerStats>, kind: FormulaKind, label: string, s: Readonly<Scaling>, mul = 1): ScalingFormula {
  return { kind, label, value: scaled(stats, s) * mul, base: s.base, terms: termsOf(stats, s), mul };
}

/**
 * 「基礎値での値 + AttrRatio」（怯み値・状態異常の効果量）から式を作る。表示は威力と揃えてステータス 0 のときの値に直す。
 * 値は withRatio と同じく負にしない
 */
export function ratioFormula(stats: Readonly<PlayerStats>, kind: FormulaKind, label: string, atBase: number, ratio: Readonly<AttrRatio> | undefined): ScalingFormula {
  const s = ratioToScaling(atBase, ratio);
  return { kind, label, value: withRatio(stats, atBase, ratio), base: s.base, terms: termsOf(stats, s), mul: 1 };
}

/** 強化の効果量（buffScaling。基礎値で 1 の倍率）。system/attributes.ts の buffMul と同じく負にしない */
export function buffFormula(stats: Readonly<PlayerStats>, label: string, s: Readonly<Scaling>): ScalingFormula {
  const f = scalingFormula(stats, "buff", label, s);
  return { ...f, value: Math.max(0, f.value) };
}

// ---------------------------------------------------------------------------
// 表示の片
// ---------------------------------------------------------------------------

function termChunk(term: ScalingTerm, first: boolean): FormulaChunk {
  const negative = term.coef < 0;
  // 詳細欄の幅（DETAIL_W）に 1 行で収めるため、項は記号と詰めて前の項に空白なしでつなぐ
  const sign = first ? (negative ? MINUS : "") : negative ? MINUS : PLUS;
  const pieces: FormulaPiece[] = [];
  if (sign !== "") pieces.push({ text: sign });
  pieces.push({ text: ATTR_LABEL[term.attr], attr: term.attr });
  pieces.push({ text: `${TIMES}${formatCoef(Math.abs(term.coef))}` });
  return { pieces };
}

/** 右辺（基礎値と各ステータスの項）。基礎値が 0 なら項から始める */
function rightHandChunks(f: Readonly<ScalingFormula>): FormulaChunk[] {
  const chunks: FormulaChunk[] = [];
  const hasBase = Math.abs(f.base) >= EPS;
  if (hasBase) chunks.push({ pieces: [{ text: formatValue(f.base, f.kind) }] });
  f.terms.forEach((t, i) => {
    const first = !hasBase && i === 0;
    chunks.push({ ...termChunk(t, first), glue: !first });
  });
  return chunks;
}

/** 片に括弧を足す（先頭の片の前・末尾の片の後） */
function wrapParen(chunks: FormulaChunk[]): FormulaChunk[] {
  const first = chunks[0];
  const last = chunks[chunks.length - 1];
  if (first === undefined || last === undefined) return chunks;
  first.pieces.unshift({ text: "(" });
  last.pieces.push({ text: ")" });
  return chunks;
}

/**
 * 式の片の列。例「威力 18 =」「10」「+筋力×1.3」「+技巧×0.2」（つなげると「威力 18 = 10+筋力×1.3+技巧×0.2」）。
 * ステータスを参照しなければ「威力 12」「（ステータスで変わらない）」
 */
export function formulaChunks(f: Readonly<ScalingFormula>): FormulaChunk[] {
  const value = formatValue(f.value, f.kind);
  if (f.terms.length === 0) {
    return [{ pieces: [{ text: `${f.label} ${value}` }] }, { pieces: [{ text: NO_SCALING_NOTE, tone: "dim" }], glue: true }];
  }
  const head: FormulaChunk = { pieces: [{ text: `${f.label} ${value} ${EQUALS}` }] };
  const rhs = rightHandChunks(f);
  if (Math.abs(f.mul - 1) < EPS) return [head, ...rhs];
  return [head, ...wrapParen(rhs), { pieces: [{ text: `${TIMES}${formatCoef(f.mul)}` }] }];
}

export function chunkText(chunk: Readonly<FormulaChunk>): string {
  return chunk.pieces.map((p) => p.text).join("");
}

/** 片の列を 1 行の文字列にする（テスト・読み上げ用。描画は片ごとに色を分ける） */
export function chunksText(chunks: readonly FormulaChunk[]): string {
  return chunks.map((c, i) => (i === 0 || c.glue === true ? "" : " ") + chunkText(c)).join("");
}

export function formulaText(f: Readonly<ScalingFormula>): string {
  return chunksText(formulaChunks(f));
}

/** 行動名を先頭に付けた片の列（「1 段目 威力 12 = …」） */
export function actionChunks(action: Readonly<ActionFormulas>, f: Readonly<ScalingFormula>): FormulaChunk[] {
  return [{ pieces: [{ text: action.name, tone: "name" }] }, ...formulaChunks(f)];
}

// ---------------------------------------------------------------------------
// 参照しているステータスの要約
// ---------------------------------------------------------------------------

/** 式の列が参照するステータスを係数の合計が大きい順に（同じなら ATTR_KEYS 順） */
export function referencedAttrs(formulas: readonly ScalingFormula[]): AttrKey[] {
  const weight: Partial<Record<AttrKey, number>> = {};
  for (const f of formulas) for (const t of f.terms) weight[t.attr] = (weight[t.attr] ?? 0) + Math.abs(t.coef);
  return ATTR_KEYS.filter((k) => (weight[k] ?? 0) > EPS).sort((a, b) => (weight[b] ?? 0) - (weight[a] ?? 0));
}

/** 威力の式があれば威力だけで、無ければ全部の式で「主に参照」を決める */
export function mainAttrs(formulas: readonly ScalingFormula[]): AttrKey[] {
  const power = formulas.filter((f) => f.kind === "power");
  return referencedAttrs(power.length > 0 ? power : formulas);
}

/** 「主に参照: 筋力・体力」。参照しなければ「ステータスで変わらない」 */
export function mainReferenceChunks(formulas: readonly ScalingFormula[]): FormulaChunk[] {
  const attrs = mainAttrs(formulas);
  if (attrs.length === 0) return [{ pieces: [{ text: NO_REFERENCE_TEXT, tone: "dim" }] }];
  const pieces: FormulaPiece[] = [{ text: MAIN_REFERENCE_HEAD, tone: "dim" }];
  attrs.forEach((attr, i) => {
    if (i > 0) pieces.push({ text: NAME_SEP, tone: "dim" });
    pieces.push({ text: ATTR_LABEL[attr], attr });
  });
  return [{ pieces }];
}

// ---------------------------------------------------------------------------
// 武器種・射撃の型
// ---------------------------------------------------------------------------

const POWER_LABEL = "威力";
const POISE_LABEL = "怯み値";
const SPECIAL_NAME = "バースト";
const DASH_ATTACK_NAME = "ダッシュ攻撃";
const CHARGE_NAME = "溜め";
const SHOT_PREFIX = "射撃";

/** 近接の 1 振り（段・ダッシュ攻撃・派生・溜め・固有技の振り）の威力と怯み値 */
export function stepFormulas(stats: Readonly<PlayerStats>, name: string, step: Readonly<MeleeStepDef>): ActionFormulas {
  return {
    name,
    formulas: [scalingFormula(stats, "power", POWER_LABEL, step.scaling), ratioFormula(stats, "poise", POISE_LABEL, step.poise, step.poiseRatio)],
  };
}

/** 射撃の型の係数（型が持たなければ共通の PLAYER.shoot.scaling）。system/player.ts の shotScaling と同じ引き方 */
function shotScalingOf(key: ShotKey): Scaling {
  return SHOT_TYPES[key].scaling ?? PLAYER.shoot.scaling;
}

/** 射撃 1 発の威力（型の damageMul は係数の後に掛かる）と怯み値。damageMul は狙い撃ちなどの上乗せ */
export function shotFormulas(stats: Readonly<PlayerStats>, key: ShotKey, name: string, damageMul = 1): ActionFormulas {
  const shot = SHOT_TYPES[key];
  return {
    name,
    formulas: [
      scalingFormula(stats, "power", POWER_LABEL, shotScalingOf(key), shot.damageMul * damageMul),
      ratioFormula(stats, "poise", POISE_LABEL, PLAYER.shoot.poise * shot.poiseMul, shot.poiseRatio),
    ],
  };
}

/** バースト（必殺ゲージで出す周囲攻撃） */
export function specialFormulas(stats: Readonly<PlayerStats>): ActionFormulas {
  const sp = PLAYER.special;
  const poiseRatio: AttrRatio | undefined = "poiseRatio" in sp ? sp.poiseRatio : undefined;
  return {
    name: SPECIAL_NAME,
    formulas: [scalingFormula(stats, "power", POWER_LABEL, sp.scaling), ratioFormula(stats, "poise", POISE_LABEL, sp.poise, poiseRatio)],
  };
}


function stepName(index: number): string {
  return `${index + 1} 段目`;
}

function stepRangeName(from: number, to: number): string {
  return from === to ? stepName(from) : `${from + 1}〜${to + 1} 段目`;
}

function sameFormulas(a: readonly ScalingFormula[], b: readonly ScalingFormula[]): boolean {
  return a.length === b.length && a.every((f, i) => formulaText(f) === formulaText(b[i] ?? f));
}

/** 連撃の段。式が同じ隣り合う段は「1〜3 段目」にまとめる（詳細欄の行を減らす） */
function comboStepFormulas(stats: Readonly<PlayerStats>, steps: readonly MeleeStepDef[]): ActionFormulas[] {
  const out: ActionFormulas[] = [];
  let from = 0;
  let current: ScalingFormula[] | null = null;
  steps.forEach((step, i) => {
    const formulas = stepFormulas(stats, "", step).formulas;
    if (current !== null && sameFormulas(current, formulas)) {
      const last = out[out.length - 1];
      if (last !== undefined) last.name = stepRangeName(from, i);
      return;
    }
    from = i;
    current = formulas;
    out.push({ name: stepName(i), formulas });
  });
  return out;
}

/** 固有技（右クリック）。構えの受け流し・手元返しは威力を持たないので出さない */
function artFormulas(stats: Readonly<PlayerStats>, moveset: Readonly<MovesetDef>, shot: ShotKey): ActionFormulas[] {
  const art = moveset.art;
  switch (art.kind) {
    case "strike":
      return [stepFormulas(stats, art.name, art.step)];
    case "hold": {
      const release = art.hold.release;
      if (release === undefined) return [];
      const branch = moveset.branches.find((b) => b.art === "release");
      return [stepFormulas(stats, branch?.name ?? art.name, release)];
    }
    case "throw": {
      const t = art.throw;
      return [{ name: art.name, formulas: [scalingFormula(stats, "power", POWER_LABEL, t.scaling), ratioFormula(stats, "poise", POISE_LABEL, t.poise, t.poiseRatio)] }];
    }
    case "charge":
      if (art.charge !== undefined) return [stepFormulas(stats, art.name, art.charge.step)];
      return [shotFormulas(stats, shot, art.name, art.aim.damageMul)];
    case "recall":
      return [];
  }
}

interface MovesetActions {
  actions: ActionFormulas[];
  /** actions のうち連撃の段（まとめた後） */
  steps: ActionFormulas[];
}

function movesetActions(stats: Readonly<PlayerStats>, moveset: Readonly<MovesetDef>, shot: ShotKey): MovesetActions {
  const steps = comboStepFormulas(stats, moveset.steps);
  const actions: ActionFormulas[] = [];
  if (isGun(moveset)) actions.push(shotFormulas(stats, shot, `${SHOT_PREFIX}（${SHOT_TYPES[shot].name}）`));
  actions.push(...steps);
  if (moveset.charge !== undefined) actions.push(stepFormulas(stats, CHARGE_NAME, moveset.charge.step));
  actions.push(stepFormulas(stats, DASH_ATTACK_NAME, moveset.dashAttack));
  actions.push(...artFormulas(stats, moveset, shot));
  for (const b of moveset.branches) {
    if (b.art !== undefined) continue;
    actions.push(stepFormulas(stats, b.name, b.step));
  }
  return { actions, steps };
}

/**
 * 武器種の行動ごとの式。並びは 射撃（銃の家系）→ 連撃の段 → 溜め → ダッシュ攻撃 → 固有技 → 派生。
 * 固有技から作った派生（strike / release）は固有技として 1 回だけ出す
 */
export function movesetFormulas(stats: Readonly<PlayerStats>, moveset: Readonly<MovesetDef>, shot: ShotKey): ActionFormulas[] {
  return movesetActions(stats, moveset, shot).actions;
}

/** 武器（右手）なら武器種と射撃の型。武器種を持たないベースは null */
export function itemMoveset(item: Readonly<Item>): { moveset: MovesetDef; shot: ShotKey } | null {
  const base = baseDef(item.baseKey);
  if (base?.moveset === undefined) return null;
  return { moveset: MOVESETS[base.moveset], shot: base.shot ?? DEFAULT_SHOT };
}

/** 射撃の型を持たない銃（二丁拳銃）は単発で撃つ（PlayerStats の既定と同じ） */
const DEFAULT_SHOT: ShotKey = "single";

/** 武器の行動ごとの式。武器でなければ空 */
export function itemFormulas(stats: Readonly<PlayerStats>, item: Readonly<Item>): ActionFormulas[] {
  const m = itemMoveset(item);
  return m === null ? [] : movesetFormulas(stats, m.moveset, m.shot);
}

// ---------------------------------------------------------------------------
// スキル
// ---------------------------------------------------------------------------

/**
 * スキルの数値ブロック（skills.json）の中の Scaling のキー → 見出し。
 * ここに無いキーが数値ブロックに現れたらテスト（scalingText.test.ts）で落とす
 */
export const SKILL_SCALING_LABEL: Readonly<Record<string, string>> = {
  damage: "威力",
  tickDamage: "継続の威力",
  burstDamage: "炸裂の威力",
  perKind: "状態異常 1 種ごとの追加の威力",
  shardDamage: "破片の威力",
  buff: "強化の効果量",
};

/** 数値ブロックの中の近接の振り（変身の噛みつき・振り）のキー → 見出しの頭 */
export const SKILL_STEP_LABEL: Readonly<Record<string, string>> = {
  bite: "噛みつき",
  swing: "重い振り",
};

/** 数値ブロックの中の Scaling のキーで、強化の効果量を表すもの（SkillDef.buffScaling と同じ値） */
const BUFF_KEY = "buff";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Scaling の形か（base が数で、残りのキーがステータスの数だけ） */
export function isScaling(v: unknown): v is Scaling {
  if (!isRecord(v) || typeof v.base !== "number") return false;
  return Object.entries(v).every(([k, x]) => k === "base" || ((ATTR_KEYS as readonly string[]).includes(k) && typeof x === "number"));
}

function isStep(v: unknown): v is MeleeStepDef {
  return isRecord(v) && isScaling(v.scaling) && typeof v.poise === "number";
}

/** スキルの数値ブロック（SKILL[key]）。無ければ undefined */
export function skillBlock(key: SkillKey): Record<string, unknown> | undefined {
  const block: unknown = (SKILL as Readonly<Record<string, unknown>>)[key];
  return isRecord(block) ? block : undefined;
}

/** 数値ブロックの直下にある Scaling / 近接の振りのキー（テストが見出しの表と突き合わせる） */
export function skillScalingKeys(block: Readonly<Record<string, unknown>>): { scalings: string[]; steps: string[] } {
  const scalings: string[] = [];
  const steps: string[] = [];
  for (const [k, v] of Object.entries(block)) {
    if (isScaling(v)) scalings.push(k);
    else if (isStep(v)) steps.push(k);
  }
  return { scalings, steps };
}

function blockFormulas(stats: Readonly<PlayerStats>, block: Readonly<Record<string, unknown>>): ScalingFormula[] {
  const out: ScalingFormula[] = [];
  for (const [k, v] of Object.entries(block)) {
    if (isScaling(v)) {
      const label = SKILL_SCALING_LABEL[k] ?? POWER_LABEL;
      out.push(k === BUFF_KEY ? buffFormula(stats, label, v) : scalingFormula(stats, "power", label, v));
      continue;
    }
    if (!isStep(v)) continue;
    const head = SKILL_STEP_LABEL[k] ?? "";
    out.push(scalingFormula(stats, "power", `${head}の${POWER_LABEL}`, v.scaling));
    out.push(ratioFormula(stats, "poise", `${head}の${POISE_LABEL}`, v.poise, v.poiseRatio));
  }
  return out;
}

/** 状態異常の効果量（係数 ratio を持つものだけ。持たないものは付与の強さがステータスで変わらない） */
function appliesFormulas(stats: Readonly<PlayerStats>, key: SkillKey): ScalingFormula[] {
  const out: ScalingFormula[] = [];
  for (const a of SKILL_DEFS[key].applies ?? []) {
    if (a.ratio === undefined) continue;
    out.push(ratioFormula(stats, "potency", `${STATUS_LABEL[a.kind]}の効果量`, a.potency, a.ratio));
  }
  return out;
}

/**
 * スキルの計算式: 数値ブロックの威力（と変身の振り）→ 怯み値 → 状態異常の効果量 → 強化の効果量。
 * 怯み値が 0 で係数も無いスキル（強化・移動）は怯み値を出さない
 */
export function skillFormulas(stats: Readonly<PlayerStats>, key: SkillKey): ScalingFormula[] {
  const def = SKILL_DEFS[key];
  const block = skillBlock(key);
  const out = block === undefined ? [] : blockFormulas(stats, block);
  if (def.poise > 0 || def.poiseRatio !== undefined) out.push(ratioFormula(stats, "poise", POISE_LABEL, def.poise, def.poiseRatio));
  out.push(...appliesFormulas(stats, key));
  const hasBuff = out.some((f) => f.kind === "buff");
  if (def.buffScaling !== undefined && !hasBuff) out.push(buffFormula(stats, SKILL_SCALING_LABEL[BUFF_KEY] ?? "", def.buffScaling));
  return out;
}

// ---------------------------------------------------------------------------
// ステータスごとの「参照している行動」
// ---------------------------------------------------------------------------

export interface AttributeReference {
  attr: AttrKey;
  /** その参照先を持つ行動の名前（今の武器種・射撃・スキル石・バーストの順） */
  names: string[];
}

export interface LoadoutSources {
  moveset: MovesetDef;
  shot: ShotKey;
  skills: readonly SkillKey[];
}

function referencesAttr(formulas: readonly ScalingFormula[], attr: AttrKey): boolean {
  return formulas.some((f) => f.terms.some((t) => t.attr === attr));
}

/** 武器種の行動のうち attr を参照するものの名前。連撃の段がすべて参照するなら「大剣の連撃」にまとめる */
function movesetReferenceNames(moveset: Readonly<MovesetDef>, actions: readonly ActionFormulas[], attr: AttrKey, steps: readonly ActionFormulas[]): string[] {
  const hits = actions.filter((a) => referencesAttr(a.formulas, attr));
  const allSteps = steps.length > 0 && steps.every((s) => hits.includes(s));
  const names: string[] = [];
  if (allSteps) names.push(`${moveset.name}の連撃`);
  for (const a of hits) {
    const isStepAction = steps.includes(a);
    if (isStepAction && allSteps) continue;
    names.push(isStepAction ? `${moveset.name} ${a.name}` : a.name);
  }
  return names;
}

/**
 * 今の装備・スキルで各ステータスを参照している行動（どのステータスを振ると何が伸びるか）。
 * 強さの指標にはしない（名前を並べるだけ）
 */
export function attributeReferences(stats: Readonly<PlayerStats>, src: Readonly<LoadoutSources>): AttributeReference[] {
  const { actions, steps } = movesetActions(stats, src.moveset, src.shot);
  const special = specialFormulas(stats);
  const skillActions = src.skills.map((k): ActionFormulas => ({ name: SKILL_DEFS[k].name, formulas: skillFormulas(stats, k) }));
  return ATTR_KEYS.map((attr) => {
    const names = movesetReferenceNames(src.moveset, actions, attr, steps);
    for (const s of skillActions) if (referencesAttr(s.formulas, attr) && !names.includes(s.name)) names.push(s.name);
    if (referencesAttr(special.formulas, attr)) names.push(special.name);
    return { attr, names };
  });
}

/** 「筋力: 大剣の連撃・地裂き」。参照が無ければ「筋力: 今は参照されない」 */
export function referenceChunks(ref: Readonly<AttributeReference>): FormulaChunk[] {
  const head: FormulaChunk = { pieces: [{ text: ATTR_LABEL[ref.attr], attr: ref.attr }, { text: ":" }] };
  if (ref.names.length === 0) return [head, { pieces: [{ text: NOT_REFERENCED_TEXT, tone: "dim" }] }];
  return [head, ...ref.names.map((name, i): FormulaChunk => ({ pieces: [{ text: i < ref.names.length - 1 ? `${name}${NAME_SEP}` : name }], glue: i > 0 }))];
}

