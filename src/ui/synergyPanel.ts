import type { FrameInput } from "../core/input";
import { KEYWORDS, type Keyword, type KeywordProfile, emptyProfile, kw, mergeProfiles } from "../core/keywords";
import type { GameState } from "../core/state";
import type { Vec } from "../core/vec";
import type { SynergyBuild, SynergyElement } from "../loot/describe";
import { itemKeywords } from "../loot/describe";
import { computeStats } from "../loot/stats";
import { SLOTS, type Equipment, type Slot } from "../loot/types";
import { SKILL, SKILL_DEFS } from "../skills/data";
import { stoneInSlot } from "../skills/persistence";
import { BOONS } from "../system/boonDefs";
import { skillKeywords, statsKeywords } from "../system/keywords";
import { CONTENT_BOTTOM, CONTENT_Y, PANEL_W, PANEL_X, type Rect, pointInRect } from "./inventoryLayout";

/**
 * 装備画面の「網」タブ（docs/ideas/synergy-web.md 4-a）。40 語を 5 列に並べ、今のビルドの要素が
 * どの語を出し / 食うかを見せる。数値のスコアは作らず、要素の数と余り / 飢えの区別だけを返す。
 * レイアウトと当たり判定は render/synergyUi.ts と共有する
 */

export const SYNERGY_COLS = 5;
export const SYNERGY_ROWS = Math.ceil(KEYWORDS.length / SYNERGY_COLS);
export const SYNERGY_CELL_W = 56;
export const SYNERGY_CELL_H = 18;
export const SYNERGY_CELL_GAP = 2;
/** グリッドの左上（パネルの内側に少し余白） */
const GRID_PAD = 2;
const GRID_X = PANEL_X + GRID_PAD;
const GRID_Y = CONTENT_Y + GRID_PAD;
/** 右側の詳細欄とグリッドの間 */
const DETAIL_GAP = 6;
/** スティック・移動キーを方向として読む閾値 */
const MOVE_THRESHOLD = 0.5;

/** 語の状態。surplus = 余り（出すのに食う側なし）/ hunger = 飢え（食うのに出す側なし）/ linked = つながっている */
export type SynergyWordState = "surplus" | "hunger" | "linked" | "none";

export interface SynergyWordView {
  key: Keyword;
  producers: SynergyElement[];
  consumers: SynergyElement[];
  state: SynergyWordState;
}

export interface SynergyPanelUi {
  /** 選んでいる語の添字（KEYWORDS の順） */
  cursor: number;
  /** 前フレームの移動方向（押した瞬間だけ動かす） */
  prevDir: string;
  /** 前フレームのマウス位置（マウスが動いたときだけホバーでカーソルを奪う） */
  lastAim: Vec | null;
  /** 開いている間の経過秒（飢えの点滅用。装備画面の間は state.time が止まるので UI 側で持つ） */
  time: number;
}

export function createSynergyPanelUi(): SynergyPanelUi {
  return { cursor: 0, prevDir: "", lastAim: null, time: 0 };
}

// -----------------------------------------------------------------------------
// ビルドの組み立て
// -----------------------------------------------------------------------------

/** 外す要素（ツールチップで「これを外した / 入れ替えた場合」の穴を見るため） */
export interface SynergyExclude {
  slot?: Slot;
  skillSlot?: number;
}

const RESONANCE_NAME = "共鳴";

function equipmentWithout(equipment: Readonly<Equipment>, slot: Slot | undefined): Equipment {
  const copy = { ...equipment };
  if (slot !== undefined) copy[slot] = null;
  return copy;
}

/** 全体の語から、個々の要素が既に持つ語を除いた残り（装備の組み合わせでだけ現れる語） */
function residual(whole: Readonly<KeywordProfile>, parts: readonly Readonly<KeywordProfile>[]): KeywordProfile {
  const merged = mergeProfiles(emptyProfile(), ...parts);
  return kw(
    whole.produces.filter((k) => !merged.produces.includes(k)),
    whole.consumes.filter((k) => !merged.consumes.includes(k)),
    whole.amplifies.filter((k) => !merged.amplifies.includes(k)),
  );
}

function isEmptyProfile(p: Readonly<KeywordProfile>): boolean {
  return p.produces.length + p.consumes.length + p.amplifies.length === 0;
}

function equipmentElements(state: GameState, exclude: SynergyExclude): SynergyElement[] {
  const equipment = equipmentWithout(state.profile.equipment, exclude.slot);
  const items: SynergyElement[] = [];
  for (const slot of SLOTS) {
    const item = equipment[slot];
    if (item) items.push({ kind: "item", name: item.name, keywords: itemKeywords(item) });
  }
  if (items.length === 0) return items;
  const rest = residual(statsKeywords(computeStats(equipment)), items.map((e) => e.keywords));
  if (!isEmptyProfile(rest)) items.push({ kind: "resonance", name: RESONANCE_NAME, keywords: rest });
  return items;
}

function skillElements(state: GameState, exclude: SynergyExclude): SynergyElement[] {
  const rs = state.skills;
  const list: SynergyElement[] = [];
  for (let i = 0; i < SKILL.slots; i++) {
    if (i === exclude.skillSlot) continue;
    const stone = stoneInSlot(rs.profile, i);
    if (!stone) continue;
    const def = SKILL_DEFS[stone.skillKey];
    list.push({ kind: "skill", name: def.name, keywords: skillKeywords(def, rs.slots[i]?.modifiers ?? []) });
  }
  return list;
}

/** 今のビルド = 装備中の遺物（+ 共鳴）+ 装着スキル石（刻印符込み）+ 取得済み祝福 */
export function synergyBuild(state: GameState, exclude: SynergyExclude = {}): SynergyBuild {
  const elements: SynergyElement[] = [
    ...equipmentElements(state, exclude),
    ...skillElements(state, exclude),
    ...state.boons.map((key): SynergyElement => ({ kind: "boon", name: BOONS[key].name, keywords: BOONS[key].keywords })),
  ];
  return { profile: mergeProfiles(emptyProfile(), ...elements.map((e) => e.keywords)), elements };
}

function wordState(producers: number, consumers: number): SynergyWordState {
  if (producers > 0 && consumers > 0) return "linked";
  if (producers > 0) return "surplus";
  if (consumers > 0) return "hunger";
  return "none";
}

/** 40 語それぞれの出す / 食う要素（KEYWORDS 順で固定） */
export function synergyWords(build: Readonly<SynergyBuild>): SynergyWordView[] {
  return KEYWORDS.map((key) => {
    const producers = build.elements.filter((e) => e.keywords.produces.includes(key));
    const consumers = build.elements.filter((e) => e.keywords.consumes.includes(key));
    return { key, producers, consumers, state: wordState(producers.length, consumers.length) };
  });
}

// -----------------------------------------------------------------------------
// レイアウトと当たり判定
// -----------------------------------------------------------------------------

export function synergyCellRect(index: number): Rect {
  const col = index % SYNERGY_COLS;
  const row = Math.floor(index / SYNERGY_COLS);
  return {
    x: GRID_X + col * (SYNERGY_CELL_W + SYNERGY_CELL_GAP),
    y: GRID_Y + row * (SYNERGY_CELL_H + SYNERGY_CELL_GAP),
    w: SYNERGY_CELL_W,
    h: SYNERGY_CELL_H,
  };
}

/** グリッド全体の矩形 */
export function synergyGridRect(): Rect {
  return {
    x: GRID_X,
    y: GRID_Y,
    w: SYNERGY_COLS * (SYNERGY_CELL_W + SYNERGY_CELL_GAP) - SYNERGY_CELL_GAP,
    h: SYNERGY_ROWS * (SYNERGY_CELL_H + SYNERGY_CELL_GAP) - SYNERGY_CELL_GAP,
  };
}

/** 右側: 選んだ語を出す / 食う要素の一覧 */
export function synergyDetailRect(): Rect {
  const grid = synergyGridRect();
  const x = grid.x + grid.w + DETAIL_GAP;
  return { x, y: CONTENT_Y, w: PANEL_X + PANEL_W - x, h: CONTENT_BOTTOM - CONTENT_Y };
}

/** グリッドの下: 凡例 */
export function synergyLegendRect(): Rect {
  const grid = synergyGridRect();
  const y = grid.y + grid.h + DETAIL_GAP;
  return { x: grid.x, y, w: grid.w, h: CONTENT_BOTTOM - y };
}

export function synergyCellAt(p: Vec | null): number {
  if (p === null) return -1;
  for (let i = 0; i < KEYWORDS.length; i++) {
    if (pointInRect(p, synergyCellRect(i))) return i;
  }
  return -1;
}

// -----------------------------------------------------------------------------
// 入力
// -----------------------------------------------------------------------------

function moveDir(move: Vec): { dx: number; dy: number } {
  const dx = move.x > MOVE_THRESHOLD ? 1 : move.x < -MOVE_THRESHOLD ? -1 : 0;
  const dy = move.y > MOVE_THRESHOLD ? 1 : move.y < -MOVE_THRESHOLD ? -1 : 0;
  return { dx, dy };
}

/** 端では反対側へ回り込む（パッドで 40 語を一周しやすく） */
export function moveCursor(cursor: number, dx: number, dy: number): number {
  const count = KEYWORDS.length;
  const col = cursor % SYNERGY_COLS;
  const row = Math.floor(cursor / SYNERGY_COLS);
  const nextCol = (col + dx + SYNERGY_COLS) % SYNERGY_COLS;
  const nextRow = (row + dy + SYNERGY_ROWS) % SYNERGY_ROWS;
  // 最後の行が欠けていても範囲外へ出さない
  return Math.min(count - 1, nextRow * SYNERGY_COLS + nextCol);
}

function sameAim(a: Vec | null, b: Vec | null): boolean {
  if (a === null || b === null) return a === b;
  return a.x === b.x && a.y === b.y;
}

/** 移動入力は押した瞬間に 1 マス。マウスは動いたときだけホバーの語へ */
export function updateSynergyPanel(ui: SynergyPanelUi, input: FrameInput, dt: number): void {
  ui.time += dt;
  const { dx, dy } = moveDir(input.move);
  const dir = `${dx},${dy}`;
  if ((dx !== 0 || dy !== 0) && dir !== ui.prevDir) ui.cursor = moveCursor(ui.cursor, dx, dy);
  ui.prevDir = dx === 0 && dy === 0 ? "" : dir;

  const aim = input.aimScreen;
  const moved = !sameAim(aim, ui.lastAim);
  ui.lastAim = aim === null ? null : { x: aim.x, y: aim.y };
  if (!moved) return;
  const hit = synergyCellAt(aim);
  if (hit >= 0) ui.cursor = hit;
}
