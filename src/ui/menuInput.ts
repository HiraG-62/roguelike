import { type FrameInput, keyLabel } from "../core/input";
import type { GuideVerb, MenuFace } from "./menuState";

/**
 * 装備画面の入力の小道具（docs/ideas/inventory-v2/E-impl.md 1-2・7 章）。
 * 方向は押した瞬間に 1 マス、押し続けると 0.35 秒後から 0.1 秒ごとに繰り返す（候補の送り用）。
 * 長押しは壊す操作（砕く・石の分解・符を外す）だけで 0.6 秒。UI の操作感なのでバランスの JSON に置かない
 */

export const MENU_HOLD_SECONDS = 0.6;
export const NAV_REPEAT_DELAY = 0.35;
export const NAV_REPEAT_EVERY = 0.1;

/** スティック・移動キーを方向として読む閾値 */
const MOVE_THRESHOLD = 0.5;

export interface MenuNav {
  x: number;
  y: number;
  held: number;
}

/** 移動入力を 1 方向に丸める（斜めは大きい軸。同じなら縦） */
function directionOf(input: Readonly<FrameInput>): { dx: number; dy: number } {
  const { x, y } = input.move;
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  if (ax < MOVE_THRESHOLD && ay < MOVE_THRESHOLD) return { dx: 0, dy: 0 };
  if (ax > ay) return { dx: Math.sign(x), dy: 0 };
  return { dx: 0, dy: Math.sign(y) };
}

const NONE = { dx: 0, dy: 0 } as const;

/** 秒の足し算の丸め誤差（0.05 × 7 が 0.35 にわずかに届かない）を吸う幅 */
const TIME_EPSILON = 1e-9;

/** 繰り返しの何回目まで出したか（押し始め = -1） */
function repeatIndex(held: number): number {
  if (held + TIME_EPSILON < NAV_REPEAT_DELAY) return -1;
  return Math.floor((held - NAV_REPEAT_DELAY) / NAV_REPEAT_EVERY + TIME_EPSILON);
}

/** このフレームの移動（押した瞬間と繰り返しの瞬間だけ 0 でない） */
export function readMenuNav(nav: MenuNav, input: Readonly<FrameInput>, dt: number): { dx: number; dy: number } {
  const { dx, dy } = directionOf(input);
  const same = dx === nav.x && dy === nav.y;
  nav.x = dx;
  nav.y = dy;
  if (dx === 0 && dy === 0) {
    nav.held = 0;
    return NONE;
  }
  if (!same) {
    nav.held = 0;
    return { dx, dy };
  }
  const before = repeatIndex(nav.held);
  nav.held += dt;
  return repeatIndex(nav.held) > before ? { dx, dy } : NONE;
}

/** 開いた瞬間に押していた方向を、押した瞬間と数えない（開いた直後に焦点が飛ばないように） */
export function primeMenuNav(nav: MenuNav, input: Readonly<FrameInput>): void {
  const { dx, dy } = directionOf(input);
  nav.x = dx;
  nav.y = dy;
  nav.held = 0;
}

/** 長押しの 1 フレーム。wait = 押し続けている / fire = 0.6 秒に届いた / release = 先に離した（決定として扱う） */
export type HoldStep = "wait" | "fire" | "release";

export function stepHold(hold: { t: number }, held: boolean, dt: number): HoldStep {
  if (!held) return "release";
  hold.t += dt;
  return hold.t + TIME_EPSILON >= MENU_HOLD_SECONDS ? "fire" : "wait";
}

/** 方向の案内（移動キーの名ではなく絵記号。E-impl 7 章の 22） */
const MOVE_GLYPHS = "↑↓←→";
/** 戻るは固定の Esc（キー設定で変えられない） */
const BACK_KEY = "Esc";
const GUIDE_SEP = "　";

function guidePart(verb: GuideVerb, face: MenuFace): string {
  const ok = keyLabel("confirm", { first: true });
  switch (verb) {
    case "move":
      return `${MOVE_GLYPHS} 移る`;
    case "open":
      return `${ok} 選ぶ`;
    case "jump":
      return `${ok} 跳ぶ`;
    case "equip":
      return `${ok} 付ける`;
    case "place":
      return `${ok} 置く`;
    case "decide":
      return `${ok} 決める`;
    case "hold":
      return `${ok} 長押し`;
    case "dispose":
      return `${ok} 長押し 処分`;
    case "carry":
      return `${ok} 長押し 持ち込み`;
    case "sheet":
      return `${keyLabel("interact", { first: true })} 書付`;
    case "sort":
      return `${keyLabel("parry", { first: true })} 並び`;
    case "face":
      return `${keyLabel("inventory", { first: true })} ${face === "attire" ? "紋へ" : "装束へ"}`;
    case "back":
      return `${BACK_KEY} 戻る`;
    case "close":
      return `${BACK_KEY} 閉じる`;
    case "cancel":
      return `${BACK_KEY} やめる`;
  }
}

/** 操作案内の 1 行。face = 今の面（面替えの行き先を書く。省略は装束） */
export function menuGuideText(verbs: readonly GuideVerb[], face: MenuFace = "attire"): string {
  return verbs.map((v) => guidePart(v, face)).join(GUIDE_SEP);
}
