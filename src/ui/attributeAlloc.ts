import type { FrameInput } from "../core/input";
import { type GameState, pushSfx } from "../core/state";
import type { Vec } from "../core/vec";
import { VIEW_H, VIEW_W } from "../core/view";
import { ATTR_GAIN } from "../data/tuning";
import { ATTR_LABEL } from "../loot/resonance";
import { ATTR_KEYS, type AttrKey } from "../loot/types";
import { applyBoonsToStats } from "../system/boons";
import { addFloatingText } from "../system/effects";

/**
 * ラン内のステータス振り分け（docs/COMBAT_DESIGN.md A-3）。
 * 階層到達・ボス撃破で得た点（runAttributes.unspent）を 5 択のパネルで 1 点ずつ振る。
 * 祝福と違いゲームを止めない（未消化のまま遊び続けられる）。代わりに戦闘中（封鎖中）は隠し、
 * 攻撃・スキルのキーを奪わない。受付中に押された選択キーは消費し、プレイヤーの行動には渡さない
 */

/** 振り分けの 5 枠。キーはスキル 1〜4 + 攻撃の順 */
export const ALLOC_ORDER: readonly AttrKey[] = ATTR_KEYS;

export const ALLOC_CARD = {
  w: 64,
  h: 40,
  gap: 6,
  /** 画面下端からの距離。下中央のスキル枠（render/skillHud.ts）とログ行の上に置く */
  bottom: 52,
  hoverLift: 2,
} as const;

export interface AllocRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** index 番目の枠（画面座標）。描画と当たり判定で共有する */
export function allocCardRect(index: number): AllocRect {
  const count = ALLOC_ORDER.length;
  const total = count * ALLOC_CARD.w + (count - 1) * ALLOC_CARD.gap;
  const x0 = Math.round((VIEW_W - total) / 2);
  const y = VIEW_H - ALLOC_CARD.bottom - ALLOC_CARD.h;
  return { x: x0 + index * (ALLOC_CARD.w + ALLOC_CARD.gap), y, w: ALLOC_CARD.w, h: ALLOC_CARD.h };
}

export function allocIndexAt(point: Vec): number {
  for (let i = 0; i < ALLOC_ORDER.length; i++) {
    const r = allocCardRect(i);
    if (point.x >= r.x && point.x < r.x + r.w && point.y >= r.y - ALLOC_CARD.hoverLift && point.y < r.y + r.h) return i;
  }
  return -1;
}

/** パネルを出すか。未振りの点があり、祝福の選択中でも戦闘中（封鎖中）でもないとき */
export function allocPanelVisible(state: GameState): boolean {
  if (state.runAttributes.unspent <= 0) return false;
  if (state.status !== "playing" || state.boonChoice !== null) return false;
  return !state.rooms.some((r) => r.locked);
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
/** 攻撃キーが担う枠（5 枠目） */
const ATTACK_INDEX = 4;

type PressedKey = "skill1Pressed" | "skill2Pressed" | "skill3Pressed" | "skill4Pressed";
const SKILL_KEYS: readonly PressedKey[] = ["skill1Pressed", "skill2Pressed", "skill3Pressed", "skill4Pressed"];
/** 消費しうる入力（すべて「今フレームに押された」boolean） */
type Consumable = PressedKey | "clickPressed" | "attackPressed";

interface Selection {
  index: number;
  /** 消費する入力（プレイヤーの行動に渡さない） */
  consumed: readonly Consumable[];
}

/**
 * 入力から選んだ枠。スキル 1〜4 → 1〜4 枠目、攻撃（E / RT）→ 5 枠目、クリックは枠の上だけ。
 * パッドの A は攻撃と決定を兼ねるので振り分けには使わない（探索中の素振りで誤って振らない）
 */
function selection(input: FrameInput, hover: number): Selection | null {
  for (let i = 0; i < SKILL_KEYS.length; i++) {
    const key = SKILL_KEYS[i];
    if (key && input[key]) return { index: i, consumed: [key] };
  }
  if (input.clickPressed) return hover >= 0 ? { index: hover, consumed: ["clickPressed", "attackPressed"] } : null;
  if (input.attackPressed && !input.padConfirmPressed) return { index: ATTACK_INDEX, consumed: ["attackPressed"] };
  return null;
}

function consume(input: FrameInput, keys: readonly Consumable[]): FrameInput {
  const out: FrameInput = { ...input };
  for (const key of keys) out[key] = false;
  return out;
}

/**
 * 毎ステップ（updatePlayer の前）に呼ぶ。パネルの受付中に選択キーが押されたら 1 点振り、
 * そのキーを消費した FrameInput を返す。受付外なら input をそのまま返す（決定的: 入力と state だけで決まる）
 */
export function updateAttributeAlloc(state: GameState, input: FrameInput, dt: number): FrameInput {
  const run = state.runAttributes;
  if (!allocPanelVisible(state)) {
    run.hover = -1;
    run.timer = 0;
    return input;
  }
  run.timer += dt;
  run.hover = input.aimScreen ? allocIndexAt(input.aimScreen) : -1;
  if (run.timer < ATTR_GAIN.allocInputDelay) return input;
  const picked = selection(input, run.hover);
  if (!picked) return input;
  const key = ALLOC_ORDER[picked.index];
  if (!key) return input;
  allocateAttribute(state, key);
  return consume(input, picked.consumed);
}
