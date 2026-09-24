import { actionKeyLabel } from "../core/input";
import { VIEW_H, VIEW_W } from "../core/view";
import { ATTR_LABEL } from "../loot/resonance";
import { ATTR_KEYS } from "../loot/types";
import type { InventoryTab } from "../ui/inventory";
import { ATTR_HINT } from "./attributeUi";
import { ECHO_HELP } from "./echoTabUi";
import { COLOR_BORDER, COLOR_DIM, COLOR_SELECTED, COLOR_TEXT, type TipLine, drawTipLine, fillRectPx, strokeRectPx, wrapTipLines } from "./lootUiParts";
import { WEB_HELP } from "./synergyUi";
import { TEXT, textLineHeight } from "./pixelText";

/**
 * 装備画面の ？ のヘルプ。画面に常時出していた操作説明・仕組みの説明・凡例をここへ集める。
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

function equipmentHelp(): TipLine[] {
  const detailKey = actionKeyLabel("interact");
  return [
    head("操作"),
    body("倉庫の行 クリック: 装備 / Shift+クリック: 砕く（残響を得る）"),
    body("部位の枠 クリック: 一覧をその部位に絞る / Shift+クリック: 外す"),
    body("並び クリック: 次の軸 / Shift+クリック: 向きを反転"),
    body("絞り込み クリック: 次の候補 / Shift+クリック: 前へ（先頭は すべて）"),
    body(`${detailKey}: 詳細欄の 要点 / 詳しく を切り替える`),
    body("未振り点があれば、詳細欄の + か 1〜4・攻撃キーでステータスを振る"),
    head("ステータス"),
    ...ATTR_KEYS.map((k) => ({ text: `${ATTR_LABEL[k]}: ${ATTR_HINT[k]}`, color: COLOR_DIM })),
  ];
}

function skillsHelp(): TipLine[] {
  const detailKey = actionKeyLabel("interact");
  return [
    head("操作"),
    body("スロット クリック / 1〜4 / ←→: 選ぶ  Shift+クリック: 外す"),
    body("スキル石 クリック: 空きスロット（無ければ選択中）へ装着  Shift+クリック: 分解"),
    body("刻印符 クリック / ↑↓+決定: 選択中のスロットの石に付け外し  Shift+クリック: 捨てる"),
    body(`${detailKey}: 詳細欄の 要点 / 詳しく を切り替える`),
    head("刻印符とリンク"),
    { text: "刻印符は拾うと所持品に入り、石に付け外しできる。石と一緒に持ち越す", color: COLOR_DIM },
    { text: "リンク数が多いほど負担（コスト / 再使用時間）が重くなる", color: COLOR_DIM },
    { text: "キー: 1〜4 / C V X Z / マウス戻る・進む  パッド: LB を押しながら A X Y B", color: COLOR_DIM },
  ];
}

export function helpLines(tab: InventoryTab): TipLine[] {
  switch (tab) {
    case "equipment":
      return equipmentHelp();
    case "skills":
      return skillsHelp();
    case "echo":
      return [head("残響"), ...ECHO_HELP.map(body)];
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
