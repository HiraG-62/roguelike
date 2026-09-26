import { type FloorKind, type GameState, type HiddenRoom, pushLog, pushSfx } from "../core/state";
import { normalize, sub } from "../core/vec";
import { HIDDEN_ROOM } from "../data/tuning";
import { TILE_SIZE, Tile, setTile, toIndex } from "../map/grid";
import { type HiddenRoomPlan, planHiddenRoom } from "../map/hidden";
import { invalidatePathing, tileOf } from "../map/pathing";
import { isBossDepth } from "./boss";
import { pickFloorKinds } from "./biomes";
import { spawnBurst, spawnDirectional } from "./effects";
import { dropItem } from "./loot";
import { overlapsTiles } from "./physics";

/**
 * 隠し部屋（docs/ideas/run-expansion.md 相当の設計書 3.2 節）。壁の中に埋めたポケットとして計画し、
 * 開くまで GameMap.tiles は書き換えない（state.hiddenRoom だけが覚えている）。5 の倍数の階（isBossDepth）では計画しない
 */

/** タイル添字 → タイルのピクセル中心 */
function tileCenterPx(map: { width: number }, index: number): { x: number; y: number } {
  return { x: ((index % map.width) + 0.5) * TILE_SIZE, y: (Math.floor(index / map.width) + 0.5) * TILE_SIZE };
}

/** state.rooms の所属タイル（rect / tiles どちらも）をまとめた集合。隠し部屋の扉は通路（この集合の外）にだけ置く */
function roomOwnedTiles(state: GameState): Set<number> {
  const out = new Set<number>();
  for (const room of state.rooms) {
    if (room.tiles) {
      for (const t of room.tiles) out.add(t);
      continue;
    }
    const r = room.rect;
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) out.add(toIndex(state.map, x, y));
    }
  }
  return out;
}

/**
 * この階の隠し部屋を計画する。buildFloor の末尾（placeAscend の後）で呼ぶ:
 * それより前の部屋・敵・特別部屋の乱数消費を変えないため
 */
export function planHidden(state: GameState): void {
  if (isBossDepth(state.depth) || state.depth < HIDDEN_ROOM.minDepth) return;
  if (!state.rng.chance(HIDDEN_ROOM.chance)) return;
  const plan = planHiddenRoom(state.map, state.rng, {
    w: HIDDEN_ROOM.w,
    h: HIDDEN_ROOM.h,
    minSteps: HIDDEN_ROOM.minSteps,
    avoidTiles: roomOwnedTiles(state),
    startTile: tileOf(state.map, state.player.body.pos),
  });
  if (!plan) return;
  const nextKind = pickFloorKinds(state.depth + 1, state.rng, 1)[0] ?? "rooms";
  state.hiddenRoom = toHiddenRoom(plan, nextKind);
}

function toHiddenRoom(plan: HiddenRoomPlan, nextKind: FloorKind): HiddenRoom {
  return {
    doorTile: plan.doorTile,
    tiles: plan.tiles,
    stairsTile: plan.stairsTile,
    nextKind,
    opened: false,
    hold: 0,
    hinted: false,
    windTimer: HIDDEN_ROOM.hintInterval,
  };
}

/** 扉タイルに体を押し当てているか（厳密な重なりでなく touchMargin ぶんの余裕を持たせる） */
function touchingDoor(state: GameState, hr: HiddenRoom): boolean {
  const p = state.player.body;
  return overlapsTiles(state, p.pos.x, p.pos.y, p.radius + HIDDEN_ROOM.touchMargin, [hr.doorTile]);
}

/**
 * 部屋のロック/解除の更新（floor.ts の updateRooms）の中、checkStairs の直前で呼ぶ。
 * 手がかり（一度きりのログ・音・定期的な風の粒子）→ 扉に押し当てて openHold 秒で開く、の順
 */
export function updateHiddenRoom(state: GameState, dt: number): void {
  const hr = state.hiddenRoom;
  if (!hr || hr.opened) return;
  const doorPos = tileCenterPx(state.map, hr.doorTile);
  const p = state.player.body.pos;
  const dist = Math.hypot(doorPos.x - p.x, doorPos.y - p.y);
  const inHintRange = dist <= HIDDEN_ROOM.hintRadius;
  if (!hr.hinted && inHintRange) {
    hr.hinted = true;
    pushSfx(state, "hiddenHint");
    pushLog(state, "壁の向こうから風が抜けている。", HIDDEN_ROOM.color);
  }
  if (hr.hinted && inHintRange) {
    hr.windTimer -= dt;
    if (hr.windTimer <= 0) {
      hr.windTimer = HIDDEN_ROOM.hintInterval;
      spawnDirectional(state, doorPos, normalize(sub(p, doorPos)), HIDDEN_ROOM.color, 3, 20, 0.5, 0.6);
    }
  }
  if (touchingDoor(state, hr)) {
    hr.hold += dt;
    if (hr.hold >= HIDDEN_ROOM.openHold) openHiddenRoom(state, hr);
  } else {
    hr.hold = 0;
  }
}

function setTileAt(state: GameState, index: number, tile: Tile): void {
  setTile(state.map, index % state.map.width, Math.floor(index / state.map.width), tile);
}

/** タイルを Floor / StairsDown に書き換え、経路のキャッシュを捨て、遺物を落とす */
function openHiddenRoom(state: GameState, hr: HiddenRoom): void {
  hr.opened = true;
  setTileAt(state, hr.doorTile, Tile.Floor);
  for (const t of hr.tiles) setTileAt(state, t, Tile.Floor);
  setTileAt(state, hr.stairsTile, Tile.StairsDown);
  invalidatePathing(state.map);
  state.stairs.push({ tile: hr.stairsTile, nextKind: hr.nextKind });
  const treasurePos = tileCenterPx(state.map, hr.stairsTile);
  for (let i = 0; i < HIDDEN_ROOM.items; i++) dropItem(state, treasurePos, HIDDEN_ROOM.rarityBoost);
  spawnBurst(state, tileCenterPx(state.map, hr.doorTile), HIDDEN_ROOM.color, 16, 60, 0.5, 2);
  pushSfx(state, "hiddenOpen");
  pushLog(state, "隠し部屋が開いた。", HIDDEN_ROOM.color);
}
