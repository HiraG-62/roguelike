/**
 * 稽古帳の画面（DOM 非依存）。稽古の間の設定の行を縦に並べ、値の行は左右で巡回、動作の行は決定で実行する。
 * 状態と当たり判定と入力の解釈だけを持ち、設定を適用する・湧き直すのは main.ts が system/dojo.ts を呼んで行う。
 * 描画は src/render/dojoUi.ts（読むだけ）
 */
import type { Vec } from "../core/vec";
import { VIEW_H, VIEW_W } from "../core/view";
import {
  DOJO_ROWS,
  type DojoConfig,
  type DojoRowKey,
  type DojoValueRowKey,
  cycleDojoRow,
  dojoRowRespawns,
  isDojoActionRow,
} from "../system/dojoConfig";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** cursor: DOJO_ROWS の添字。scroll: 表示の先頭の行 */
export interface DojoBoardUi {
  cursor: number;
  scroll: number;
}

export function createDojoBoardUi(): DojoBoardUi {
  return { cursor: 0, scroll: 0 };
}

export const DOJO_BOARD_TITLE = "稽古帳";
export const DOJO_BOARD_HINT = "↑↓ 行を選ぶ　←→ 値を変える　Enter / クリック 決める　Esc 戻る";

/** 行の説明（今の行の下に 1 行。何ができるかを語る） */
export const DOJO_ROW_DESC: Readonly<Record<DojoRowKey, string>> = {
  enemy: "稽古の相手を選ぶ。木人のほか、ボスと商人・壺を除く敵と戦える",
  count: "相手の数を変える。数や種類を変えると湧き直す",
  depth: "相手の生命・威力・怯みを、地下の深さに合わせて伸ばす",
  elite: "相手にエリートの修飾を付ける。付けられるのは相手ごとに決まっている",
  behavior: "相手の動きを変える。その場で攻める・追うだけ・棒立ちで、攻めや追いを切り分けて試せる",
  tempo: "相手の攻撃間隔の速さを変える。大きいほど立て続けに攻めてくる",
  formation: "相手の並びを変える。横一列・自分を囲む・散らばるから選ぶ",
  distance: "自分から相手の並びまでの距離を変える",
  undying: "相手が倒れなくなる。傷は計測に入るので、与える傷を測り続けられる",
  respawn: "全滅したら、同じ設定で相手が湧き直す",
  invincible: "自分が傷を受けなくなる。受けた傷は計測の被弾に数える",
  infiniteMana: "気力が減らなくなる。技を撃ち続けて試せる",
  infiniteEnergy: "奥義ゲージが減らなくなる。奥義を撃ち続けて試せる",
  timeScale: "時間を遅くする。予告の読みや技の見え方を確かめられる",
  respawnNow: "相手を今すぐ湧き直す",
  resetMeter: "計測の欄を始めから数え直す",
  restore: "生命・気力・奥義ゲージを満たす",
};

const LIST_X = 40;
const LIST_W = VIEW_W - LIST_X * 2;
const LIST_TOP = 26;
/** 行の間隔の下限。字の行高がこれより大きければ main.ts が行高を渡す */
const ROW_MIN = 11;
const BOTTOM_MARGIN = 40;
const ARROW_W = 12;
/** 値の欄（行の右側。左右の矢印で挟む） */
const VALUE_W = 150;
const LABEL_PAD = 6;

const LIST_BOTTOM = VIEW_H - BOTTOM_MARGIN;

/** 行の間隔（字の行高と下限の大きいほう。行が重ならないように） */
export function dojoBoardRowGap(lineHeight: number): number {
  return Math.max(ROW_MIN, lineHeight);
}

/** 480x270 の論理座標での配置。描画と当たり判定が同じ寸法を使う */
export const DOJO_BOARD_LAYOUT = {
  titleY: 12,
  listX: LIST_X,
  listW: LIST_W,
  listTop: LIST_TOP,
  listBottom: LIST_BOTTOM,
  labelPad: LABEL_PAD,
  arrowW: ARROW_W,
  valueW: VALUE_W,
  /** 今の行の説明の上端 */
  descY: LIST_BOTTOM + 6,
  hintY: VIEW_H - 8,
} as const;

export function dojoBoardVisibleRows(rowGap: number): number {
  return Math.max(1, Math.floor((LIST_BOTTOM - LIST_TOP) / rowGap));
}

function maxScroll(rowGap: number): number {
  return Math.max(0, DOJO_ROWS.length - dojoBoardVisibleRows(rowGap));
}

function inside(r: Rect, x: number, y: number): boolean {
  return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
}

/** 行の矩形。表示範囲の外（スクロールで隠れている）なら null */
export function dojoRowRect(index: number, scroll: number, rowGap: number): Rect | null {
  const row = index - scroll;
  if (index < 0 || index >= DOJO_ROWS.length || row < 0 || row >= dojoBoardVisibleRows(rowGap)) return null;
  return { x: LIST_X, y: LIST_TOP + row * rowGap, w: LIST_W, h: rowGap };
}

/** 値の行の左（−1）/ 右（+1）の矢印の矩形。値の欄は行の右端に寄せる */
export function dojoArrowRect(index: number, scroll: number, side: -1 | 1, rowGap: number): Rect | null {
  const r = dojoRowRect(index, scroll, rowGap);
  if (r === null) return null;
  const right = r.x + r.w - LABEL_PAD;
  const x = side < 0 ? right - VALUE_W : right - ARROW_W;
  return { x, y: r.y, w: ARROW_W, h: r.h };
}

/** 値の文字を置く欄（左右の矢印の間） */
export function dojoValueRect(index: number, scroll: number, rowGap: number): Rect | null {
  const left = dojoArrowRect(index, scroll, -1, rowGap);
  const right = dojoArrowRect(index, scroll, 1, rowGap);
  if (left === null || right === null) return null;
  return { x: left.x + left.w, y: left.y, w: right.x - (left.x + left.w), h: left.h };
}

/** (x, y) にある行の添字。無ければ null */
export function dojoRowAt(x: number, y: number, scroll: number, rowGap: number): number | null {
  for (let i = scroll; i < Math.min(DOJO_ROWS.length, scroll + dojoBoardVisibleRows(rowGap)); i++) {
    const r = dojoRowRect(i, scroll, rowGap);
    if (r !== null && inside(r, x, y)) return i;
  }
  return null;
}

export interface DojoBoardInput {
  /** ←→。-1 / 0 / 1 */
  navX: number;
  /** ↑↓。-1 / 0 / 1 */
  navY: number;
  /** ホイールの符号（表示を送る） */
  wheel: number;
  aim: Vec | null;
  /** マウスが動いた（動いたときだけホバーでカーソルを奪う） */
  aimMoved: boolean;
  click: boolean;
  confirm: boolean;
}

export type DojoBoardAction =
  | { kind: "none" }
  | { kind: "moved" }
  | { kind: "change"; row: DojoValueRowKey; config: DojoConfig; respawn: boolean }
  | { kind: "action"; row: DojoRowKey };

const NONE: DojoBoardAction = { kind: "none" };
const MOVED: DojoBoardAction = { kind: "moved" };

/** カーソルが指す行 */
export function dojoCursorRow(ui: Readonly<DojoBoardUi>): DojoRowKey | null {
  return DOJO_ROWS[ui.cursor] ?? null;
}

function scrollToCursor(ui: DojoBoardUi, rowGap: number): void {
  const visible = dojoBoardVisibleRows(rowGap);
  if (ui.cursor < ui.scroll) ui.scroll = ui.cursor;
  else if (ui.cursor >= ui.scroll + visible) ui.scroll = ui.cursor - visible + 1;
  ui.scroll = Math.min(maxScroll(rowGap), Math.max(0, ui.scroll));
}

function setCursor(ui: DojoBoardUi, next: number): boolean {
  if (next === ui.cursor) return false;
  ui.cursor = next;
  return true;
}

function changeAction(config: DojoConfig, row: DojoRowKey, dir: number): DojoBoardAction {
  if (isDojoActionRow(row)) return NONE;
  return { kind: "change", row, config: cycleDojoRow(config, row, dir), respawn: dojoRowRespawns(row) };
}

/** 決定: 動作の行は実行、値の行は +1 巡回 */
function confirmAction(config: DojoConfig, row: DojoRowKey): DojoBoardAction {
  return isDojoActionRow(row) ? { kind: "action", row } : changeAction(config, row, 1);
}

function stepClick(ui: DojoBoardUi, config: DojoConfig, aim: Vec, rowGap: number): DojoBoardAction | null {
  const index = dojoRowAt(aim.x, aim.y, ui.scroll, rowGap);
  const row = index === null ? undefined : DOJO_ROWS[index];
  if (index === null || row === undefined) return null;
  setCursor(ui, index);
  if (isDojoActionRow(row)) return { kind: "action", row };
  const minus = dojoArrowRect(index, ui.scroll, -1, rowGap);
  const plus = dojoArrowRect(index, ui.scroll, 1, rowGap);
  if (minus !== null && inside(minus, aim.x, aim.y)) return changeAction(config, row, -1);
  if (plus !== null && inside(plus, aim.x, aim.y)) return changeAction(config, row, 1);
  return changeAction(config, row, 1);
}

/**
 * 1 フレームの入力を解釈する。↑↓ は端で止まる（武器掛けと同じ）。ホイールは表示を 1 行送るだけでカーソルは動かさない。
 * ホバーはマウスが動いたときだけカーソルを奪う（キー操作を上書きしないため）
 */
export function stepDojoBoard(ui: DojoBoardUi, config: DojoConfig, input: DojoBoardInput, rowGap: number): DojoBoardAction {
  if (input.wheel !== 0) ui.scroll = Math.min(maxScroll(rowGap), Math.max(0, ui.scroll + Math.sign(input.wheel)));
  let moved = false;
  if (input.aimMoved && input.aim !== null) {
    const hover = dojoRowAt(input.aim.x, input.aim.y, ui.scroll, rowGap);
    if (hover !== null) moved = setCursor(ui, hover);
  }
  const row = dojoCursorRow(ui);
  if (row !== null && input.navX !== 0) {
    const changed = changeAction(config, row, Math.sign(input.navX));
    if (changed.kind !== "none") return changed;
  }
  if (input.navY !== 0) {
    const next = Math.min(DOJO_ROWS.length - 1, Math.max(0, ui.cursor + Math.sign(input.navY)));
    if (setCursor(ui, next)) {
      scrollToCursor(ui, rowGap);
      moved = true;
    }
  }
  if (input.click && input.aim !== null) {
    const clicked = stepClick(ui, config, input.aim, rowGap);
    if (clicked !== null) return clicked;
  }
  const now = dojoCursorRow(ui);
  if (input.confirm && now !== null) return confirmAction(config, now);
  return moved ? MOVED : NONE;
}
