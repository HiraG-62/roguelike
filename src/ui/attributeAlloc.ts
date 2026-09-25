import type { FrameInput } from "../core/input";
import { type GameState, pushSfx } from "../core/state";
import type { Vec } from "../core/vec";
import { ATTR_LABEL } from "../loot/resonance";
import { ATTR_KEYS, type AttrKey } from "../loot/types";
import { applyBoonsToStats } from "../system/boons";
import { addFloatingText } from "../system/effects";
import type { Rect } from "./inventoryLayout";

/**
 * ラン内のステータス振り分け（docs/COMBAT_DESIGN.md A-3）。
 * 階層到達・ボス撃破で得た点（runAttributes.unspent）を、装備画面（ステータスタブ）のステータス行の「+」で 1 点ずつ振る。
 * 装備画面はゲームを止めるので、探索中・戦闘中の攻撃やスキルのキーを奪わない。
 * 装備画面での操作は step の外なので、リプレイは装備変更と同じイベント（core/replay.ts）で再現する
 */

/** 行の並び。キーはスキル 1〜4 + 攻撃の順 */
export const ALLOC_ORDER: readonly AttrKey[] = ATTR_KEYS;

/** ステータスタブのステータス行と「+」ボタン。描画（render/attributeUi.ts）と当たり判定で共有する */
export const ALLOC_BUTTON = {
  /** 行の間隔（ボタンの当たり判定と揃えるため、描画もこの間隔で並べる）。押しやすいよう文字の行より広く取る */
  rowH: 12,
  w: 11,
  /** 行の上端からボタンまで */
  inset: 1,
  /** パネルの左右の余白 */
  pad: 4,
} as const;

/** index 行目の「+」ボタン（画面座標）。panel はステータスタブのステータス一覧の枠 */
export function allocButtonRect(panel: Rect, index: number): Rect {
  const h = ALLOC_BUTTON.rowH - ALLOC_BUTTON.inset;
  return {
    x: panel.x + panel.w - ALLOC_BUTTON.pad - ALLOC_BUTTON.w,
    y: panel.y + index * ALLOC_BUTTON.rowH + ALLOC_BUTTON.inset,
    w: ALLOC_BUTTON.w,
    h,
  };
}

/** 点の下にあるボタンの行番号。無ければ -1。枠に収まらない行は押せない */
export function allocButtonAt(panel: Rect, point: Vec): number {
  for (let i = 0; i < ALLOC_ORDER.length; i++) {
    const r = allocButtonRect(panel, i);
    if (r.y + r.h > panel.y + panel.h) return -1;
    if (point.x >= r.x && point.x < r.x + r.w && point.y >= r.y && point.y < r.y + r.h) return i;
  }
  return -1;
}

/** 振り分け点を得る（階層到達・ボス撃破） */
export function grantAttributePoints(state: GameState, points: number): void {
  if (points <= 0) return;
  state.runAttributes.unspent += points;
}

/** 1 点振って stats を畳み込み直す。点が無ければ false */
export function allocateAttribute(state: GameState, key: AttrKey): boolean {
  const run = state.runAttributes;
  if (run.unspent <= 0) return false;
  run.unspent -= 1;
  run.alloc[key] += 1;
  // 祝福の畳み込み（boonRun.baseStats）を保ったまま addRunAttributes → deriveAttributes をやり直す
  applyBoonsToStats(state);
  addFloatingText(state, state.player.body.pos, `${ATTR_LABEL[key]} +1`, ALLOC_TEXT_COLOR, ALLOC_TEXT_SCALE, ALLOC_TEXT_LIFE);
  pushSfx(state, "boonSelect");
  return true;
}

const ALLOC_TEXT_COLOR = "#ffd75f";
const ALLOC_TEXT_SCALE = 1.2;
const ALLOC_TEXT_LIFE = 1;
/** 攻撃キーが担う行（5 行目） */
const ATTACK_INDEX = 4;

type PressedKey = "skill1Pressed" | "skill2Pressed" | "skill3Pressed" | "skill4Pressed";
const SKILL_KEYS: readonly PressedKey[] = ["skill1Pressed", "skill2Pressed", "skill3Pressed", "skill4Pressed"];

/**
 * キーボードで選んだ行。スキル 1〜4 → 1〜4 行目、攻撃（E / RT）→ 5 行目。
 * 左クリックも攻撃に束縛されているのでクリックのフレームは除く（ボタン以外のクリックで振らない）。
 * パッドの A は攻撃と決定を兼ねるので使わない
 */
export function allocKeyIndex(input: FrameInput): number {
  for (let i = 0; i < SKILL_KEYS.length; i++) {
    const key = SKILL_KEYS[i];
    if (key && input[key]) return i;
  }
  if (input.attackPressed && !input.clickPressed && !input.padConfirmPressed) return ATTACK_INDEX;
  return -1;
}

export interface AllocUiResult {
  /** マウスが乗っている「+」の行（-1 = なし） */
  hover: number;
  /** 入力をこの操作で使ったか（呼び出し側は同じクリックで他の操作をしない） */
  used: boolean;
}

/**
 * ステータスタブで毎フレーム呼ぶ。「+」のクリックかキーで 1 点振る。
 * 点が無ければ押しても何もしない（入力は使ったことにしてクリックを他へ流さない）
 */
export function updateAllocButtons(state: GameState, input: FrameInput, panel: Rect): AllocUiResult {
  const hover = input.aimScreen ? allocButtonAt(panel, input.aimScreen) : -1;
  const clicked = input.clickPressed && hover >= 0;
  const index = clicked ? hover : allocKeyIndex(input);
  const key = ALLOC_ORDER[index];
  if (index < 0 || !key) return { hover, used: false };
  allocateAttribute(state, key);
  return { hover, used: true };
}
