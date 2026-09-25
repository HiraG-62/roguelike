import { SKILL_ACTIONS, actionKeyLabel, keyLabel } from "../core/input";
import { VIEW_H, VIEW_W } from "../core/view";
import type { InventoryTab } from "../ui/inventory";
import { ECHO_HELP } from "./echoTabUi";
import { COLOR_BORDER, COLOR_DIM, COLOR_SELECTED, COLOR_TEXT, type TipLine, drawTipLine, fillRectPx, strokeRectPx, wrapTipLines } from "./lootUiParts";
import { WEB_HELP } from "./synergyUi";
import { TEXT, textLineHeight } from "./pixelText";

/**
 * 装備画面の ？ のヘルプ。操作だけを集める（用語・仕組みの説明は meta/tips.ts の Tips ノートへ）。
 * 開いている間は画面の中央に重ねて出す（どこかをクリックで閉じる）
 */

const HELP_W = 300;
const HELP_PAD = 6;
const COLOR_HELP_BG = "#101018";
const MIN_LINE_H = 9;

function head(text: string): TipLine {
  return { text, color: COLOR_SELECTED };
}

function body(text: string): TipLine {
  return { text, color: COLOR_TEXT };
}

function dim(text: string): TipLine {
  return { text, color: COLOR_DIM };
}

/** スキルスロット 1〜4 の主キー（"1・2・3・4"）。振り分け・スロット選択の案内に使う */
function slotKeysText(): string {
  return SKILL_ACTIONS.map((a) => keyLabel(a, { keyboardOnly: true, first: true })).join("・");
}

function detailPageLine(): TipLine {
  return body(`${keyLabel("interact")}: 詳細欄を 要点 → 詳しく → 計算式 の順に切り替える`);
}

function allocLine(): TipLine {
  return body(`+ / ${slotKeysText()}・${keyLabel("attack", { keyboardOnly: true })}: ステータスを 1 点振る`);
}

/** 仕組みの説明の置き場（？ のヘルプは操作だけ） */
const TIPS_POINTER = "用語と仕組み: タイトル / ポーズの「Tips ノート」";

function equipmentHelp(): TipLine[] {
  return [
    head("操作"),
    body("倉庫の行 クリック: 装備 / Shift+クリック: 砕く"),
    body("部位の枠 クリック: 一覧をその部位に絞る / Shift+クリック: 外す"),
    body("並び クリック: 次の軸 / Shift+クリック: 向きを反転"),
    body("絞り込み クリック: 次の候補 / Shift+クリック: 前へ"),
    detailPageLine(),
    allocLine(),
    dim(TIPS_POINTER),
  ];
}

function skillsHelp(): TipLine[] {
  const slotKeys = SKILL_ACTIONS.map((a) => actionKeyLabel(a)).join("、");
  return [
    head("操作"),
    body(`スロット クリック / ${slotKeysText()} / ←→: 選ぶ  Shift+クリック: 外す`),
    body("スキル石 クリック: 空きスロット（無ければ選択中）へ装着  Shift+クリック: 分解"),
    body("刻印符 クリック / ↑↓+決定: 選択中のスロットの石に付け外し  Shift+クリック: 捨てる"),
    detailPageLine(),
    head("スキルのキー"),
    dim(`${slotKeys}  パッド: LB を押しながら A X Y B`),
    dim(TIPS_POINTER),
  ];
}

function statusHelp(): TipLine[] {
  return [
    head("操作"),
    allocLine(),
    body("奥義のカード クリック / ↑↓+決定: 選ぶ（拠点のみ）"),
    body("< > / ←→: 武器種を送る（拠点のみ）"),
    dim(TIPS_POINTER),
  ];
}

export function helpLines(tab: InventoryTab): TipLine[] {
  switch (tab) {
    case "equipment":
      return equipmentHelp();
    case "status":
      return statusHelp();
    case "skills":
      return skillsHelp();
    case "echo":
      return [head("操作"), ...ECHO_HELP.map(body), dim(TIPS_POINTER)];
    case "web":
      return [head("流れ"), ...WEB_HELP.map((l) => ({ ...l }))];
  }
}

export function drawInventoryHelp(ctx: CanvasRenderingContext2D, tab: InventoryTab): void {
  const m = TEXT.SMALL;
  const maxWidth = HELP_W - HELP_PAD * 2;
  const lines = wrapTipLines(helpLines(tab), maxWidth, m);
  const lineH = Math.max(MIN_LINE_H, textLineHeight(m));
  const h = lines.length * lineH + HELP_PAD * 2;
  const box = { x: Math.round((VIEW_W - HELP_W) / 2), y: Math.round((VIEW_H - h) / 2), w: HELP_W, h };
  fillRectPx(ctx, box, COLOR_HELP_BG);
  strokeRectPx(ctx, box, COLOR_BORDER);
  lines.forEach((line, i) => drawTipLine(ctx, line, box.x + HELP_PAD, box.y + HELP_PAD + (i + 1) * lineH - 1, maxWidth, m));
}
