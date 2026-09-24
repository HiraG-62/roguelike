import type { SfxName } from "../audio/sfxNames";
import type { FrameInput } from "../core/input";
import { type GameState, pushSfx } from "../core/state";
import {
  ECHO_OPS,
  applyEchoResult,
  craftEcho,
  type EchoOp,
  type EchoRequest,
  type EchoResult,
  type TransferWhat,
} from "../loot/crafting";
import { loadCraft, saveCraft, type CraftSave } from "../loot/craftingStore";
import { saveProfile } from "../loot/profile";
import { TRAIT_COLORS, type Item, type TraitColor } from "../loot/types";
import {
  CONTENT_BOTTOM,
  CONTENT_Y,
  LEFT_W,
  PANEL_X,
  RIGHT_W,
  RIGHT_X,
  STASH_HEADER_H,
  STASH_ROW_H,
  type Point,
  type Rect,
  type StashListLayout,
  clamp,
  findRowAt,
  layoutStashList,
  pointInRect,
  sortStash,
} from "./inventoryLayout";

/**
 * 残響タブ（クラフト）の画面ロジック。docs/LOOT_DESIGN.md「クラフト（残響）」。
 * 状態機械: 対象（倉庫の遺物）→ 操作 → 性質（詳細の行をクリック。呼び戻しは過去の芽）→ 必要なら色 / 移し先・注ぎ先 → 実行ボタン。
 * 装備中の遺物は対象にしない（倉庫だけを並べる）。実行はボタンを押したときだけ（誤操作で砕かないため）
 */

/** 結果メッセージの表示秒数 */
export const ECHO_RESULT_SECONDS = 2;

/** 左列: 残響の所持数 → 操作ボタン（3 列 × 4 行。12 操作）→ 実行ボタン → 状態 */
export const ECHO_ROW_H = 10;
const ECHO_BLOCK_PAD = 4;
export const ECHO_BUTTON_COLUMNS = 3;
export const ECHO_BUTTON_H = 16;
export const ECHO_BUTTON_GAP = 3;
export const ECHO_EXECUTE_H = 18;
const ECHO_EXECUTE_GAP = 4;
const ECHO_STATUS_GAP = 4;

/** 右列: 倉庫（見出し + 行）→ 対象の詳細（名前・副題 → 性質の行 → 銘 → 色） */
export const ECHO_STASH_ROWS = 8;
const DETAIL_GAP = 3;
export const DETAIL_HEADER_H = 22;
export const TRAIT_ROW_H = 10;
const COLOR_ROW_GAP = 3;
export const COLOR_CHIP_H = 12;
const COLOR_CHIP_GAP = 3;

/** 操作ごとの効果音（既存の名前を読み替えて使う） */
const ECHO_SFX: Readonly<Record<EchoOp, SfxName>> = {
  shatter: "dismantle",
  dye: "craftReforge",
  calm: "craftAugment",
  stir: "craftCorrupt",
  pare: "craftAnnul",
  transfer: "craftFuse",
  modulate: "craftReforge",
  bleach: "craftAugment",
  recall: "craftReforge",
  pour: "craftFuse",
  reforge: "craftReforge",
  tension: "craftCorrupt",
};

/** 詳細で選んでいるもの。性質の行か、銘の行か、過去の芽の行（呼び戻し） */
export type EchoPick = { kind: "trait"; index: number } | { kind: "inscription" } | { kind: "bud"; index: number };

export type EchoStep = "target" | "op" | "trait" | "bud" | "color" | "destination" | "ready";

export interface EchoUi {
  /** 残響とクラフト回数（roguelike.craft.v1 に保存） */
  save: CraftSave;
  targetId: string | null;
  op: EchoOp | null;
  pick: EchoPick | null;
  color: TraitColor | null;
  /** 移し先（倉庫の item id） */
  destinationId: string | null;
  scroll: number;
  hoverOp: EchoOp | null;
  hoverId: string | null;
  /** 直前の結果（ECHO_RESULT_SECONDS だけ出す） */
  result: string;
  resultOk: boolean;
  resultTimer: number;
}

export function createEchoUi(save: CraftSave = loadCraft()): EchoUi {
  return {
    save,
    targetId: null,
    op: null,
    pick: null,
    color: null,
    destinationId: null,
    scroll: 0,
    hoverOp: null,
    hoverId: null,
    result: "",
    resultOk: true,
    resultTimer: 0,
  };
}

/** 次に何をすればよいか（状態の行に出す） */
export const ECHO_STEP_PROMPT: Readonly<Record<EchoStep, string>> = {
  target: "倉庫から対象の遺物を選ぶ（装備中は対象外）",
  op: "操作を選ぶ",
  trait: "下の一覧から性質を選ぶ",
  bud: "呼び戻す芽を下の一覧から選ぶ（選ばなかった方と入れ替わる）",
  color: "染める色を選ぶ",
  destination: "受け取る遺物（同じ部位）を倉庫から選ぶ",
  ready: "実行を押す",
};
export const TRANSFER_TRAIT_PROMPT = "移すもの（芽吹いた性質か銘）を選ぶ";

// ---------------------------------------------------------------------------
// レイアウト
// ---------------------------------------------------------------------------

export interface EchoWalletRow {
  color: TraitColor;
  rect: Rect;
}

export interface EchoButtonLayout {
  op: EchoOp;
  rect: Rect;
}

export interface TraitRowLayout {
  index: number;
  rect: Rect;
}

/** 呼び戻しで選ぶ過去の芽の行（item.buds の添字） */
export interface BudRowLayout {
  index: number;
  rect: Rect;
}

export interface ColorChipLayout {
  color: TraitColor;
  rect: Rect;
}

export interface EchoLayout {
  wallet: EchoWalletRow[];
  buttons: EchoButtonLayout[];
  execute: Rect;
  status: Rect;
  stashHeader: Rect;
  stash: StashListLayout;
  stashOrder: Item[];
  detail: Rect;
  traitRows: TraitRowLayout[];
  /** 呼び戻しの過去の芽の行（呼び戻し中は性質の行の代わりに出す） */
  budRows: BudRowLayout[];
  /** 移しで銘を選ぶ行（移し中で、対象に銘があるときだけ） */
  inscriptionRow: Rect | null;
  /** 染めの色（染めで性質を選んだときだけ） */
  colorChips: ColorChipLayout[];
}

function layoutLeftColumn(): Pick<EchoLayout, "wallet" | "buttons" | "execute" | "status"> {
  const wallet = TRAIT_COLORS.map((color, i) => ({
    color,
    rect: { x: PANEL_X, y: CONTENT_Y + i * ECHO_ROW_H, w: LEFT_W, h: ECHO_ROW_H },
  }));
  const buttonsTop = CONTENT_Y + TRAIT_COLORS.length * ECHO_ROW_H + ECHO_BLOCK_PAD;
  const buttonW = Math.floor((LEFT_W - ECHO_BUTTON_GAP * (ECHO_BUTTON_COLUMNS - 1)) / ECHO_BUTTON_COLUMNS);
  const buttons = ECHO_OPS.map((op, i) => {
    const col = i % ECHO_BUTTON_COLUMNS;
    const row = Math.floor(i / ECHO_BUTTON_COLUMNS);
    const rect = {
      x: PANEL_X + col * (buttonW + ECHO_BUTTON_GAP),
      y: buttonsTop + row * (ECHO_BUTTON_H + ECHO_BUTTON_GAP),
      w: buttonW,
      h: ECHO_BUTTON_H,
    };
    return { op, rect };
  });
  const rows = Math.ceil(ECHO_OPS.length / ECHO_BUTTON_COLUMNS);
  const executeY = buttonsTop + rows * (ECHO_BUTTON_H + ECHO_BUTTON_GAP) - ECHO_BUTTON_GAP + ECHO_EXECUTE_GAP;
  const execute = { x: PANEL_X, y: executeY, w: LEFT_W, h: ECHO_EXECUTE_H };
  const statusY = executeY + ECHO_EXECUTE_H + ECHO_STATUS_GAP;
  const status = { x: PANEL_X, y: statusY, w: LEFT_W, h: CONTENT_BOTTOM - statusY };
  return { wallet, buttons, execute, status };
}

function layoutDetailRows(
  ui: EchoUi,
  target: Item | null,
  detail: Rect,
): Pick<EchoLayout, "traitRows" | "budRows" | "inscriptionRow" | "colorChips"> {
  if (target === null) return { traitRows: [], budRows: [], inscriptionRow: null, colorChips: [] };
  const top = detail.y + DETAIL_HEADER_H;
  const rowRect = (i: number): Rect => ({ x: detail.x, y: top + i * TRAIT_ROW_H, w: detail.w, h: TRAIT_ROW_H });
  if (ui.op === "recall") {
    const budRows = (target.buds ?? []).map((_, index) => ({ index, rect: rowRect(index) }));
    return { traitRows: [], budRows, inscriptionRow: null, colorChips: [] };
  }
  const traitRows = target.affixes.map((_, index) => ({ index, rect: rowRect(index) }));
  let next = traitRows.length;
  let inscriptionRow: Rect | null = null;
  if (ui.op === "transfer" && target.inscription !== undefined) {
    inscriptionRow = rowRect(next);
    next += 1;
  }
  const colorChips: ColorChipLayout[] = [];
  if (ui.op === "dye" && ui.pick?.kind === "trait") {
    const y = top + next * TRAIT_ROW_H + COLOR_ROW_GAP;
    const w = Math.floor((detail.w - COLOR_CHIP_GAP * (TRAIT_COLORS.length - 1)) / TRAIT_COLORS.length);
    TRAIT_COLORS.forEach((color, i) => {
      colorChips.push({ color, rect: { x: detail.x + i * (w + COLOR_CHIP_GAP), y, w, h: COLOR_CHIP_H } });
    });
  }
  return { traitRows, budRows: [], inscriptionRow, colorChips };
}

export function layoutEcho(state: GameState, ui: EchoUi): EchoLayout {
  const stashHeader = { x: RIGHT_X, y: CONTENT_Y, w: RIGHT_W, h: STASH_HEADER_H };
  const stashArea = { x: RIGHT_X, y: CONTENT_Y + STASH_HEADER_H, w: RIGHT_W, h: ECHO_STASH_ROWS * STASH_ROW_H };
  const stashOrder = sortStash(state.profile.stash);
  const stash = layoutStashList(stashOrder, ui.scroll, stashArea);
  const detailY = stashArea.y + stashArea.h + DETAIL_GAP;
  const detail = { x: RIGHT_X, y: detailY, w: RIGHT_W, h: CONTENT_BOTTOM - detailY };
  const target = echoTarget(state, ui);
  return {
    ...layoutLeftColumn(),
    stashHeader,
    stash,
    stashOrder,
    detail,
    ...layoutDetailRows(ui, target, detail),
  };
}

// ---------------------------------------------------------------------------
// 状態機械
// ---------------------------------------------------------------------------

function stashItem(state: GameState, id: string | null): Item | null {
  if (id === null) return null;
  return state.profile.stash.find((it) => it.id === id) ?? null;
}

/** 対象（倉庫から消えていたら null） */
export function echoTarget(state: GameState, ui: EchoUi): Item | null {
  return stashItem(state, ui.targetId);
}

export function isTransferDestination(target: Item, candidate: Item): boolean {
  return candidate.id !== target.id && candidate.slot === target.slot;
}

/** 移し先（同じ部位の別の遺物でなければ null） */
export function echoDestination(state: GameState, ui: EchoUi): Item | null {
  const target = echoTarget(state, ui);
  const dest = stashItem(state, ui.destinationId);
  if (target === null || dest === null) return null;
  return isTransferDestination(target, dest) ? dest : null;
}

/** 移しで移すもの。芽吹いた性質か銘を選んでいなければ null */
export function transferWhatOf(target: Item, pick: EchoPick | null): TransferWhat | null {
  if (pick === null) return null;
  if (pick.kind === "inscription") return target.inscription === undefined ? null : { kind: "inscription" };
  return target.affixes[pick.index]?.origin === "bud" ? { kind: "bud", traitIndex: pick.index } : null;
}

function pickedTraitIndex(target: Item, pick: EchoPick | null): number | null {
  if (pick?.kind !== "trait") return null;
  return pick.index < target.affixes.length ? pick.index : null;
}

function pickedBudIndex(target: Item, pick: EchoPick | null): number | null {
  if (pick?.kind !== "bud") return null;
  return pick.index < (target.buds ?? []).length ? pick.index : null;
}

/** 移し先・注ぎ先を倉庫から選ぶ段階か */
function choosingDestination(target: Item | null, ui: EchoUi): target is Item {
  if (target === null) return false;
  if (ui.op === "pour") return true;
  return ui.op === "transfer" && transferWhatOf(target, ui.pick) !== null;
}

export function echoStep(state: GameState, ui: EchoUi): EchoStep {
  const target = echoTarget(state, ui);
  if (target === null) return "target";
  if (ui.op === null) return "op";
  if (ui.op === "shatter") return "ready";
  if (ui.op === "pour") return echoDestination(state, ui) === null ? "destination" : "ready";
  if (ui.op === "recall") return pickedBudIndex(target, ui.pick) === null ? "bud" : "ready";
  if (ui.op === "transfer") {
    if (transferWhatOf(target, ui.pick) === null) return "trait";
    return echoDestination(state, ui) === null ? "destination" : "ready";
  }
  if (pickedTraitIndex(target, ui.pick) === null) return "trait";
  if (ui.op === "dye" && ui.color === null) return "color";
  return "ready";
}

/** 実行できる形の依頼。足りない選択があれば null */
export function buildEchoRequest(state: GameState, ui: EchoUi): EchoRequest | null {
  if (echoStep(state, ui) !== "ready") return null;
  const item = echoTarget(state, ui);
  if (item === null || ui.op === null) return null;
  if (ui.op === "shatter") return { op: "shatter", item };
  if (ui.op === "transfer") {
    const target = echoDestination(state, ui);
    const what = transferWhatOf(item, ui.pick);
    return target === null || what === null ? null : { op: "transfer", item, target, what };
  }
  if (ui.op === "pour") {
    const target = echoDestination(state, ui);
    return target === null ? null : { op: "pour", item, target };
  }
  if (ui.op === "recall") {
    const budIndex = pickedBudIndex(item, ui.pick);
    return budIndex === null ? null : { op: "recall", item, budIndex };
  }
  const traitIndex = pickedTraitIndex(item, ui.pick);
  if (traitIndex === null) return null;
  if (ui.op === "dye") return ui.color === null ? null : { op: "dye", item, traitIndex, color: ui.color };
  return { op: ui.op, item, traitIndex };
}

function showResult(ui: EchoUi, text: string, ok: boolean): void {
  ui.result = text;
  ui.resultOk = ok;
  ui.resultTimer = ECHO_RESULT_SECONDS;
}

export function tickEchoUi(ui: EchoUi, dt: number): void {
  if (ui.resultTimer <= 0) return;
  ui.resultTimer = Math.max(0, ui.resultTimer - dt);
  if (ui.resultTimer === 0) ui.result = "";
}

function resetSelection(ui: EchoUi): void {
  ui.pick = null;
  ui.color = null;
  ui.destinationId = null;
}

/** 成功したクラフトを保存し、効果音を積む。profile と残響の両方を書き出す */
function commitEchoResult(state: GameState, ui: EchoUi, result: EchoResult): void {
  if (!result.ok) return;
  applyEchoResult(state.profile, result);
  saveProfile(state.profile);
  saveCraft(ui.save);
  pushSfx(state, ECHO_SFX[result.op]);
}

/**
 * 倉庫の遺物を砕く（装備タブの Shift+クリックと共用）。
 * 砕いたら残響を足して保存する。対象に選んでいたら選択を外す
 */
export function shatterStashItem(state: GameState, ui: EchoUi, item: Item): EchoResult {
  const result = craftEcho(ui.save, { op: "shatter", item });
  commitEchoResult(state, ui, result);
  if (result.ok && ui.targetId === item.id) {
    ui.targetId = null;
    resetSelection(ui);
  }
  return result;
}

/** 実行ボタン。選択が足りなければ次の手順を、残響が足りなければ拒否理由を出す（何も消費しない） */
export function executeEcho(state: GameState, ui: EchoUi): EchoResult | null {
  const req = buildEchoRequest(state, ui);
  if (req === null) {
    showResult(ui, ECHO_STEP_PROMPT[echoStep(state, ui)], false);
    return null;
  }
  const result = craftEcho(ui.save, req);
  showResult(ui, result.message, result.ok);
  if (!result.ok) return result;
  commitEchoResult(state, ui, result);
  // 砕くは対象が消え、移しは受け手が新しい対象になる
  if (result.consumedIds.includes(req.item.id)) {
    ui.targetId = result.item?.id ?? null;
    resetSelection(ui);
    return result;
  }
  ui.destinationId = null;
  // 削いだ性質・使い切った呼び戻しの芽は行ごと意味が変わるので、選び直してもらう
  if (req.op === "pare" || req.op === "recall") ui.pick = null;
  return result;
}

function clickOp(ui: EchoUi, op: EchoOp): void {
  ui.op = ui.op === op ? null : op;
  ui.color = null;
  ui.destinationId = null;
}

function clickStashRow(state: GameState, ui: EchoUi, item: Item): void {
  const target = echoTarget(state, ui);
  if (choosingDestination(target, ui)) {
    if (item.id === target.id) return;
    if (isTransferDestination(target, item)) {
      ui.destinationId = item.id;
      return;
    }
  }
  if (ui.targetId === item.id) return;
  ui.targetId = item.id;
  resetSelection(ui);
}

function clickDetail(ui: EchoUi, layout: EchoLayout, aim: Point): boolean {
  const chip = layout.colorChips.find((c) => pointInRect(aim, c.rect));
  if (chip) {
    ui.color = chip.color;
    return true;
  }
  const bud = layout.budRows.find((r) => pointInRect(aim, r.rect));
  if (bud) {
    ui.pick = { kind: "bud", index: bud.index };
    return true;
  }
  if (layout.inscriptionRow !== null && pointInRect(aim, layout.inscriptionRow)) {
    ui.pick = { kind: "inscription" };
    ui.destinationId = null;
    return true;
  }
  const row = layout.traitRows.find((r) => pointInRect(aim, r.rect));
  if (!row) return false;
  ui.pick = { kind: "trait", index: row.index };
  ui.color = null;
  ui.destinationId = null;
  return true;
}

/** 残響タブの 1 フレーム分の入力処理 */
export function updateEchoTab(state: GameState, ui: EchoUi, input: FrameInput): void {
  const layout = layoutEcho(state, ui);
  ui.scroll = clamp(ui.scroll + input.wheel, 0, layout.stash.maxScroll);
  const aim = input.aimScreen;
  const row = findRowAt(layout.stash.rows, aim);
  const button = aim ? (layout.buttons.find((b) => pointInRect(aim, b.rect)) ?? null) : null;
  ui.hoverId = row ? row.item.id : null;
  ui.hoverOp = button ? button.op : null;
  if (!input.clickPressed || aim === null) return;
  if (button) {
    clickOp(ui, button.op);
    return;
  }
  if (pointInRect(aim, layout.execute)) {
    executeEcho(state, ui);
    return;
  }
  if (row) {
    clickStashRow(state, ui, row.item);
    return;
  }
  clickDetail(ui, layout, aim);
}
