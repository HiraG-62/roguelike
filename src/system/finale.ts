import { type GameState, pushLog, pushSfx } from "../core/state";
import { ARC, BOSS } from "../data/tuning";
import { Tile, TILE_SIZE, getTile, rectCenter, rectContainsPx } from "../map/grid";
import { chapterAheadLines, isFinalDepth } from "./chapters";
import { recordRunOnce } from "./combat";
import { addFloatingText } from "./effects";
import { placeSurface } from "./specialRooms";

/**
 * 最深の間（深度 21）の終わり（docs/ideas/boss-impl.md 2-6）。最深の主を倒すと階段（深みへ）と地上への道が出て、
 * 地上への道に乗り続けると踏破（GameStatus "cleared"）でランが終わる。踏破の画面は死亡画面の見出し替え
 */

const SURFACE_TEXT_SCALE = 2;
const SURFACE_TEXT_LIFE = 1.6;
const SURFACE_TEXT_LIFT = 24;
const CLEAR_TEXT_LIFE = 2;

/** 地上への道の置き場所の候補（中央 = 階段から右 → 左 → 下 → 上の順。乱数を使わない） */
const SURFACE_DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

/** 踏破: ランを終える。死亡と同じく step は止まり、ラン記録を 1 回だけ書く */
export function clearRun(state: GameState): void {
  if (state.status !== "playing") return;
  state.status = "cleared";
  state.deathTimer = 0;
  state.slowmo = Math.max(state.slowmo, BOSS.defeatSlowmo);
  const p = state.player.body.pos;
  addFloatingText(state, { x: p.x, y: p.y - SURFACE_TEXT_LIFT }, "踏破", ARC.surfaceColor, SURFACE_TEXT_SCALE, CLEAR_TEXT_LIFE);
  pushLog(state, `踏破した（地下${state.depth}階）。地上へ戻った。`, ARC.surfaceColor);
  pushSfx(state, "bossDefeat");
  recordRunOnce(state);
}

/**
 * 最深の主を倒した部屋に地上への道を置く。中央（階段）から右へ ARC.surfaceOffset タイル、
 * 床でなければ左・下・上の順。どこも床でなければ置かない（false）
 */
export function placeSurfaceGate(state: GameState): boolean {
  const boss = state.boss;
  const room = boss ? state.rooms[boss.roomIndex] : undefined;
  if (!room) return false;
  const c = rectCenter(room.rect);
  for (const [dx, dy] of SURFACE_DIRS) {
    const tx = c.x + dx * ARC.surfaceOffset;
    const ty = c.y + dy * ARC.surfaceOffset;
    const pos = { x: (tx + 0.5) * TILE_SIZE, y: (ty + 0.5) * TILE_SIZE };
    if (getTile(state.map, tx, ty) !== Tile.Floor || !rectContainsPx(room.rect, pos.x, pos.y)) continue;
    placeSurface(room, pos);
    return true;
  }
  return false;
}

function hasSurfaceGate(state: GameState): boolean {
  return state.rooms.some((room) => room.special?.props.some((prop) => prop.kind === "surface"));
}

/** 毎ステップ（floor.ts の updateRooms の末尾）: 最深の主を倒したら地上への道を 1 度だけ出す */
export function updateFinale(state: GameState): void {
  if (!isFinalDepth(state.depth) || !state.boss?.defeated || hasSurfaceGate(state)) return;
  if (!placeSurfaceGate(state)) return;
  const p = state.player.body.pos;
  addFloatingText(state, { x: p.x, y: p.y - SURFACE_TEXT_LIFT }, "地上への道", ARC.surfaceColor, SURFACE_TEXT_SCALE, SURFACE_TEXT_LIFE);
  pushLog(state, "地上への道が開いた。乗り続けると踏破になる。", ARC.surfaceColor);
}

/** 章の休符と深度 16 の到着で、この章の主の階と名を出す（準備が効くように。descend の fresh の枝から） */
export function announceChapterAhead(state: GameState): void {
  for (const line of chapterAheadLines(state.depth)) pushLog(state, line, ARC.aheadColor);
}
