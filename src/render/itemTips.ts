import { currentForm } from "../system/morale";
import type { GameState } from "../core/state";
import { isKeystoneKey, keystoneConflicts } from "../loot/affixes";
import { type SynergyDescription, describeItem, describeSynergy, itemKindName } from "../loot/describe";
import { SLOTS, type Item } from "../loot/types";
import { MODIFIERS, SKILL, SKILL_DEFS, castBurden, castInterval, formatVariant, modifierVerb, resolveCast, slotLinks, stoneLabel, transformLabel } from "../skills/data";
import { WEAR_TUNING } from "../skills/tuning2";
import { wearSummary } from "../skills/wear";
import { COMBOS, comboAfter } from "../skills/combos";
import { stoneInSlot } from "../skills/persistence";
import { weaponArtLabel } from "../skills/arts";
import type { CastParams, ModifierKey, SkillDef, SkillKey, SkillStone } from "../skills/types";
import { itemColor } from "../system/loot";
import { affinity, skillKeywords } from "../system/keywords";
import { effectiveManaCost, effectiveSlotModifiers, formatCooldown, slotModifierView, usedLinks } from "../system/skills";
import { boonGrantedModifiers } from "../system/boons";
import { KEYWORD_DEFS, type Keyword } from "../core/keywords";
import { synergyBuild } from "../ui/synergyBuild";
import type { Rect } from "../ui/inventoryLayout";
import { DETAIL_GAP_LINE, type DetailLine, ultimateTipLine } from "./detailPane";
import { chosenUltimate } from "../system/ultimates";
import { MOVESETS } from "../data/weapons";
import {
  type ActionFormulas,
  type LoadoutSources,
  type ScalingFormula,
  actionListRows,
  itemModifierRows,
  attributeReferences,
  formulaChunks,
  itemFormulas,
  referenceChunks,
} from "../ui/scalingText";
import { itemAttackLine, skillAttackLine } from "./elementUi";
import { COLOR_DIM, COLOR_EMPTY, COLOR_GROWN, COLOR_INSCRIPTION, COLOR_TEXT, COLOR_WARN, GROWN_MARK, type TipLine, traitTipLine } from "./lootUiParts";

/**
 * 遺物・スキル石の説明の行（旧 render/inventoryUi.ts の詳細欄の部品を中身を変えずに移した。docs/ideas/inventory-v2/E-impl.md 2-2）。
 * 床の遺物のツールチップ（render/dropTooltip.ts）と、段 6 の書付（render/sheetUi.ts）が読む
 */

const COLOR_SKILL = SKILL.drop.stoneColor;
/** 武器技の「〇〇専用」（今の武器種で撃てる / 撃てない） */
const COLOR_WEAPON_ART = "#ffd080";
const COLOR_WEAPON_ART_OFF = "#ff7060";
/** 地金の行（性質の色と混ざらない地金の色） */
export const COLOR_INNATE = "#c8b48a";
/** 地金の行の見出しと区切り */
export const INNATE_HEAD = "地金: ";
const INNATE_JOINER = "、";
/** コストが最大気力を超えて切り詰められたときの注記 */
const COST_CLAMPED_NOTE = "（上限で切り詰め）";
/** 旧装備タブの要約の見出し（ジョブ）の高さ（ui/equipmentLayout.ts の SUMMARY_HEAD_H を移した） */
const SUMMARY_HEAD_H = 12;
const SECTION_GAP = 3;

function keystoneKeysOf(item: Item): string[] {
  const keys = item.affixes.filter((r) => isKeystoneKey(r.key)).map((r) => r.key);
  if (item.implicit && isKeystoneKey(item.implicit.key)) keys.push(item.implicit.key);
  return keys;
}

function conflictText(names: readonly string[]): string {
  return `誓約が競合: ${names.join(" と ")}`;
}

/**
 * item を装備した場合（装備中ならそのまま）の誓約の排他衝突のうち、item の誓約が絡むもの。
 * 同じスロットの現装備は置き換わる前提で除外する。
 */
function conflictLinesFor(state: GameState, item: Item): string[] {
  const own = keystoneKeysOf(item);
  if (own.length === 0) return [];
  const keys = [...own];
  for (const slot of SLOTS) {
    const eq = state.profile.equipment[slot];
    if (!eq || slot === item.slot) continue;
    keys.push(...keystoneKeysOf(eq));
  }
  return keystoneConflicts(keys)
    .filter((group) => group.some((d) => own.includes(d.key)))
    .map((group) => conflictText(group.map((d) => d.name)));
}

/** 装備中の排他衝突（要約の先頭に出す） */
export function equippedConflictLines(state: GameState): string[] {
  const keys: string[] = [];
  for (const slot of SLOTS) {
    const eq = state.profile.equipment[slot];
    if (eq) keys.push(...keystoneKeysOf(eq));
  }
  return keystoneConflicts(keys).map((group) => conflictText(group.map((d) => d.name)));
}

// ---------------------------------------------------------------------------
// 計算式の頁（docs/COMBAT_DESIGN.md A-10）。式の組み立ては ui/scalingText.ts
// ---------------------------------------------------------------------------

const FORMULA_CAPTION = "計算式（今のステータスでの基礎の値）";
const REFERENCE_CAPTION = "ステータスを参照している行動（今の装備・スキル）";
const NO_FORMULA_TEXT = "ステータスで変わらない";

/** 今の武器種・銃の弾・装着中のスキル石 */
function loadoutSources(state: GameState): LoadoutSources {
  const skills: SkillKey[] = [];
  for (let i = 0; i < SKILL.slots; i++) {
    const stone = stoneInSlot(state.skills.profile, i);
    if (stone && !skills.includes(stone.skillKey)) skills.push(stone.skillKey);
  }
  return { moveset: MOVESETS[state.stats.moveset], bullet: state.stats.bullet, skills, ultimate: chosenUltimate(state) };
}

/** ステータスごとに参照している行動の行（「筋力: 大剣の連撃・地裂き」） */
function referenceLines(state: GameState): DetailLine[] {
  return attributeReferences(state.stats, loadoutSources(state)).map((ref) => ({ chunks: referenceChunks(ref) }));
}

/** 行動ごとの式。先頭の式の頭に行動名を付け、残り（怯み値など）は行動名なしで続ける。値だけの派生は 1 段落にまとめる */
function actionFormulaLines(actions: readonly ActionFormulas[]): DetailLine[] {
  return actionListRows(actions).map((chunks): DetailLine => ({ chunks }));
}

function captionLine(text: string): TipLine {
  return { text, color: COLOR_DIM };
}

/** 武器なら行動ごとの式、武器でなければステータスを参照している行動（テストが欄に収まるかを見る） */
export function itemFormulaLines(state: GameState, item: Item): DetailLine[] {
  const head: TipLine = { text: item.name, color: itemColor(item) };
  const actions = itemFormulas(state.stats, item);
  if (actions.length === 0) return [head, captionLine(REFERENCE_CAPTION), ...referenceLines(state)];
  const modifiers = itemModifierRows(state.stats, item).map((chunks): DetailLine => ({ chunks }));
  return [head, captionLine(FORMULA_CAPTION), ...actionFormulaLines(actions), ...modifiers];
}

/** 床の遺物のツールチップ（render/dropTooltip.ts）用に、要点と詳しくを全部並べた行 */
export function itemTipLines(state: GameState, item: Item): TipLine[] {
  const d = itemDetailLines(state, item);
  return [...d.lines, ...d.more];
}

/** 要点: 名前・銘・種類・性質・誓約の競合。詳しく: 攻撃の素性・一言・固有・余白・来歴・語 */
export function itemDetailLines(state: GameState, item: Item): { lines: TipLine[]; more: TipLine[] } {
  const d = describeItem(item, state.depth);
  const lines: TipLine[] = [{ text: d.name, color: itemColor(item) }];
  if (d.inscription !== undefined && d.inscription !== d.name) lines.push({ text: `銘「${d.inscription}」`, color: COLOR_INSCRIPTION });
  lines.push({ text: d.subtitle, color: COLOR_DIM });
  const ult = ultimateTipLine(state.profile, item);
  if (ult) lines.push(ult);
  lines.push(DETAIL_GAP_LINE);
  // 地金（ベースの既定のステータス）は性質の前に 1 行へまとめる（折り返しは wrapTipLines）
  if (d.innate.length > 0) lines.push({ text: `${INNATE_HEAD}${d.innate.join(INNATE_JOINER)}`, color: COLOR_INNATE });
  for (const line of d.lines) lines.push(traitTipLine(line));
  for (const text of conflictLinesFor(state, item)) lines.push({ text, color: COLOR_WARN });

  const more: TipLine[] = [];
  const attackLine = itemAttackLine(item);
  if (attackLine !== null) more.push({ text: attackLine, color: COLOR_DIM });
  more.push({ text: d.summary, color: COLOR_TEXT });
  // 種類の行は武器種名なので、ベース名（打刀・太刀）はここで見せる
  if (d.baseName !== itemKindName(item)) more.push({ text: `ベース: ${d.baseName}`, color: COLOR_DIM });
  if (d.implicit !== undefined) more.push({ text: `固有: ${d.implicit}`, color: COLOR_DIM });
  more.push({ text: d.marginText, color: COLOR_GROWN });
  for (const text of d.provenanceLines) more.push({ text: `・${text}`, color: COLOR_DIM });
  // 同じ部位は入れ替わる前提で外したビルドと比べる（装備中なら「これが抜けたら何が欠けるか」）
  more.push(...synergyTipLines(describeSynergy(item, synergyBuild(state, { slot: item.slot }))));
  return { lines, more };
}

/** 何も乗せていないときの計算式の頁: ステータスごとに参照している行動（テストが欄に収まるかを見る） */
export function summaryFormulaLines(state: GameState): DetailLine[] {
  return [captionLine(REFERENCE_CAPTION), ...referenceLines(state)];
}

/** 要約の詳細欄: 見出し（ジョブ）の下から詳細欄の部品で流し込む */
export function summaryBelowRect(rect: Rect): Rect {
  const top = rect.y + SUMMARY_HEAD_H + SECTION_GAP;
  return { x: rect.x, y: top, w: rect.w, h: rect.y + rect.h - top };
}

// ---------------------------------------------------------------------------
// 「ここに噛む」（docs/ideas/synergy-web.md 4-b / 4-d）。語と相手の名前だけで、優劣は出さない
// ---------------------------------------------------------------------------

/** 噛み合う語があるときの色 / 無いときは COLOR_DIM */
const COLOR_SYNERGY = "#a8e0ff";
const WORD_SEP = "・";

function glyphs(words: readonly Keyword[]): string {
  return words.map((k) => KEYWORD_DEFS[k].glyph).join("");
}

function labels(words: readonly Keyword[]): string {
  return words.map((k) => KEYWORD_DEFS[k].label).join(WORD_SEP);
}

/** 1 行目: 出す / 食う語の字形。2 行目: 噛む相手と、埋める穴 / 食う余り */
export function synergyTipLines(d: SynergyDescription): TipLine[] {
  if (d.produces.length + d.consumes.length === 0) return [];
  const meshes = d.fills.length + d.feeds.length + d.partners.length > 0;
  const head: string[] = [];
  if (d.produces.length > 0) head.push(`源 ${glyphs(d.produces)}`);
  if (d.consumes.length > 0) head.push(`糧 ${glyphs(d.consumes)}`);
  const lines: TipLine[] = [{ text: `系統: ${head.join("  ")}`, color: meshes ? COLOR_SYNERGY : COLOR_DIM }];
  const detail: string[] = [];
  if (d.partners.length > 0) detail.push(`相性: ${d.partners.join(WORD_SEP)}`);
  if (d.fills.length > 0) detail.push(`潤い: ${labels(d.fills)}`);
  if (d.feeds.length > 0) detail.push(`受け皿: ${labels(d.feeds)}`);
  if (detail.length > 0) lines.push({ text: detail.join("  "), color: COLOR_SYNERGY });
  return lines;
}

/** スキル石: ビルドの穴を埋める / 余りを食うなら 1 行、連携の相手が装着済みなら 1 行ずつ */
function stoneSynergyLines(state: GameState, stone: SkillStone, slot: number, modifiers: readonly ModifierKey[]): TipLine[] {
  const def = SKILL_DEFS[stone.skillKey];
  const build = synergyBuild(state, slot >= 0 ? { skillSlot: slot } : {});
  const aff = affinity(skillKeywords(def, modifiers), build.profile);
  const words = [...aff.fills, ...aff.feeds];
  const lines: TipLine[] = [];
  if (words.length > 0) lines.push({ text: `${GROWN_MARK} 今のビルドと相性がよい（${labels(words)}）`, color: COLOR_SYNERGY });
  for (const key of def.combos ?? []) {
    const combo = COMBOS[key];
    // 先のスキルが複数ある連携（変身 → 奥義）は、装着済みの最初の 1 つを出す
    const after = comboAfter(combo).find((k) => partnerEquipped(state, k, slot));
    if (after === undefined) continue;
    lines.push({ text: `連携「${combo.name}」: ${SKILL_DEFS[after].name} の直後に使う`, color: COLOR_SYNERGY });
  }
  return lines;
}

/** 連携の「先」のスキル石が、この石以外のスロットに装着されているか */
function partnerEquipped(state: GameState, after: SkillKey, ownSlot: number): boolean {
  for (let i = 0; i < SKILL.slots; i++) {
    if (i === ownSlot) continue;
    if (stoneInSlot(state.skills.profile, i)?.skillKey === after) return true;
  }
  return false;
}

/**
 * 気力型は「コスト n / 間隔 s」、再使用型は「再使用 s」（docs/COMBAT_DESIGN.md B-6: 負担の表示を資源で出し分ける）。
 * コストは最大気力で切り詰めた実際の値を出し、切り詰めたときはそう書く
 */
function burdenText(state: GameState, def: SkillDef, params: Readonly<CastParams>): string {
  const interval = formatCooldown(castInterval(def, params));
  const burden = castBurden(def, params);
  // 定刻・燃料化で資源が差し替わるので def.resource ではなく params.resource で出し分ける
  if (params.resource !== "mana") return `再使用 ${formatCooldown(burden.cooldown)}`;
  const capped = effectiveManaCost(state, burden.cost);
  const note = capped.clamped ? COST_CLAMPED_NOTE : "";
  return `コスト ${Math.round(capped.cost)}${note}  間隔 ${interval}`;
}

/** 武器技なら「〇〇専用」。今の武器種と違えば撃てないことを赤で出す */
function weaponArtLines(state: GameState, def: Readonly<SkillDef>): TipLine[] {
  // 共通技は今の武器の型で形が変わる（skills/arts/transform.ts）。変わらない型・技では出さない
  const transform = transformLabel(currentForm(state).key, def.key);
  if (def.moveset === undefined) return transform === null ? [] : [{ text: transform, color: COLOR_WEAPON_ART }];
  const label = weaponArtLabel(def.moveset);
  if (def.moveset === state.stats.moveset) return [{ text: label, color: COLOR_WEAPON_ART }];
  return [{ text: `${label}（今の武器種では撃てない）`, color: COLOR_WEAPON_ART_OFF }];
}

/** 石の要点: 名前・動詞・負担・変異・付いている刻印符。詳しく: 攻撃の素性・リンク・使い込み・噛む */
export function stoneDetailLines(state: GameState, stone: SkillStone): { lines: TipLine[]; more: TipLine[] } {
  const def = SKILL_DEFS[stone.skillKey];
  const slot = state.skills.profile.loadout.indexOf(stone.id);
  // 装備画面での移す / 外すは次のステップまで slot.modifiers に入らないので、runModifiers から直接読む。符はスロットの物なので、装着していない石には付かない
  const modifiers = slot >= 0 ? effectiveSlotModifiers(state.skills, slot, boonGrantedModifiers(state)) : [];
  const params = resolveCast(def, stone, modifiers, Math.max(0, slot));
  const lines: TipLine[] = [
    { text: stoneLabel(stone), color: COLOR_SKILL },
    ...weaponArtLines(state, def),
    { text: burdenText(state, def, params), color: COLOR_DIM },
    DETAIL_GAP_LINE,
    { text: def.verb, color: COLOR_TEXT },
  ];
  for (const v of stone.variants) lines.push({ text: formatVariant(v, def, params.resource), color: COLOR_TEXT });
  if (slot >= 0) {
    for (const m of slotModifierView(state, slot)) {
      const d = MODIFIERS[m.key];
      lines.push({ text: `${m.active ? "+" : "x"} ${d.name}: ${modifierVerb(m.key, def, params.resource)}`, color: m.active ? d.color : COLOR_EMPTY });
    }
  }
  const linkLine: TipLine[] = slot >= 0 ? [{ text: `リンク ${usedLinks(state.skills, slot)}/${slotLinks(slot)}`, color: COLOR_DIM }] : [];
  const attackLine = skillAttackLine(def.key);
  const more: TipLine[] = [
    ...(attackLine === null ? [] : [{ text: attackLine, color: COLOR_DIM }]),
    ...linkLine,
    { text: wearSummary(stone), color: WEAR_TUNING.color },
    ...stoneSynergyLines(state, stone, slot, modifiers),
  ];
  return { lines, more };
}

/** スキル石の計算式の頁。ステータスを参照する量が無ければそう書く（テストが欄に収まるかを見る） */
export function stoneFormulaLines(stone: SkillStone, formulas: readonly ScalingFormula[]): DetailLine[] {
  const head: TipLine = { text: stoneLabel(stone), color: COLOR_SKILL };
  if (formulas.length === 0) return [head, captionLine(NO_FORMULA_TEXT)];
  return [head, captionLine(FORMULA_CAPTION), ...formulas.map((f): DetailLine => ({ chunks: formulaChunks(f) }))];
}
