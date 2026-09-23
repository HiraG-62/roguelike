import type { Enemy, GameState } from "../core/state";
import type { StatusApply } from "../core/status";
import { type TerrainKind, type TerrainLayer, terrainCode, terrainKindOf } from "../core/terrain";
import { type Vec, add, scale, sub } from "../core/vec";
import { STATUS, TERRAIN } from "../data/tuning";
import { TILE_SIZE, Tile, getTile, inBounds, toIndex } from "../map/grid";
import { planTerrain } from "../map/generator";
import { damageEnemy, damagePlayerDot } from "./combat";
import { type StatusTarget, applyStatus, hasStatus } from "./statusEffects";

/**
 * 地形の層（docs/ideas/status-and-terrain.md 3 章）。床タイルに重ねる層で、プレイヤーと敵の両方に効く。
 * 地形の効果は applyStatus(..., "env") で入れる（祝福のフックは起こさない）。
 * 状態は GameState.terrain だけに持ち、描画は render/terrainUi.ts が読むだけ
 */

const WATER = terrainCode("water");
const OIL = terrainCode("oil");
const LAVA = terrainCode("lava");
const BOG = terrainCode("bog");
const ICE = terrainCode("ice");
const GRASS = terrainCode("grass");
const FIRE = terrainCode("fire");
const NONE = terrainCode("none");
/** 燃え移りを済ませた炎のセル */
const SPREAD_DONE = -1;
const NEIGHBORS_4 = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;
/** 自然配置を置かない部屋: 開始部屋（0）と最後の部屋（階段 / ボス） */
const START_ROOM = 0;

// -----------------------------------------------------------------------------
// 層の用意
// -----------------------------------------------------------------------------

/** 今のマップに合った層を返す（フロアが変わっていたら空で作り直す）。自然配置はしない */
export function ensureTerrainLayer(state: GameState): TerrainLayer {
  const layer = state.terrain;
  if (layer.map === state.map) return layer;
  const size = state.map.width * state.map.height;
  layer.map = state.map;
  layer.planned = false;
  layer.kinds = new Uint8Array(size);
  layer.time = new Float64Array(size);
  layer.spread = new Float64Array(size);
  layer.active = new Set();
  layer.tickTimer = 0;
  layer.tickCount = 0;
  layer.version += 1;
  return layer;
}

/** フロアの自然配置を 1 回だけ入れる（スキルなどで先に置かれた地形は上書きしない） */
function planOnce(state: GameState, layer: TerrainLayer): void {
  if (layer.planned) return;
  layer.planned = true;
  const skip = new Set([START_ROOM, state.map.rooms.length - 1]);
  const planned = planTerrain(state.rng, state.map, state.depth, skip);
  for (let i = 0; i < planned.length; i++) {
    const code = planned[i] ?? NONE;
    if (code === NONE || layer.kinds[i] !== NONE) continue;
    layer.kinds[i] = code;
  }
  layer.version += 1;
}

// -----------------------------------------------------------------------------
// 読み出し
// -----------------------------------------------------------------------------

function tileIndexAt(state: GameState, x: number, y: number): number {
  const tx = Math.floor(x / TILE_SIZE);
  const ty = Math.floor(y / TILE_SIZE);
  if (!inBounds(state.map, tx, ty)) return -1;
  return toIndex(state.map, tx, ty);
}

/** ピクセル座標の地形。層が今のマップのものでなければ none */
export function terrainAt(state: GameState, x: number, y: number): TerrainKind {
  const layer = state.terrain;
  if (layer.map !== state.map) return "none";
  const i = tileIndexAt(state, x, y);
  if (i < 0) return "none";
  return terrainKindOf(layer.kinds[i] ?? NONE);
}

/** タイル index の地形（描画用） */
export function terrainAtIndex(state: GameState, index: number): TerrainKind {
  const layer = state.terrain;
  if (layer.map !== state.map) return "none";
  return terrainKindOf(layer.kinds[index] ?? NONE);
}

// -----------------------------------------------------------------------------
// 置く・燃やす（他レーンのスキル・敵の攻撃が使う API）
// -----------------------------------------------------------------------------

/**
 * (x, y) を中心に半径 radius（px）の床へ地形を置く。duration 省略時は TERRAIN.placedDuration（0 は消えない）。
 * 溶岩の上には置けない。炎を置くと油・草は燃え、氷は溶けて水になり、水の上では消える。置けたセル数を返す
 */
export function placeTerrain(state: GameState, x: number, y: number, kind: TerrainKind, radius: number, duration?: number): number {
  const layer = ensureTerrainLayer(state);
  const time = duration ?? TERRAIN.placedDuration[kind];
  let placed = 0;
  for (const i of cellsInRadius(state, x, y, radius)) {
    if (setCell(layer, i, kind, time)) placed += 1;
  }
  if (placed > 0) layer.version += 1;
  return placed;
}

/** 半径内の油・草に火をつけ、氷を溶かす（燃焼の付いた者・炎上の延焼が呼ぶ）。変わったセル数を返す */
export function igniteTerrainAt(state: GameState, x: number, y: number, radius: number): number {
  const layer = state.terrain;
  if (layer.map !== state.map) return 0;
  let changed = 0;
  for (const i of cellsInRadius(state, x, y, radius)) {
    if (igniteCell(layer, i)) changed += 1;
  }
  if (changed > 0) layer.version += 1;
  return changed;
}

/** 中心のタイルは必ず含め、あとはタイル中心が半径内の床タイル */
function cellsInRadius(state: GameState, x: number, y: number, radius: number): number[] {
  const map = state.map;
  const cells: number[] = [];
  const cx = Math.floor(x / TILE_SIZE);
  const cy = Math.floor(y / TILE_SIZE);
  const reach = Math.ceil(radius / TILE_SIZE);
  for (let ty = cy - reach; ty <= cy + reach; ty++) {
    for (let tx = cx - reach; tx <= cx + reach; tx++) {
      if (!inBounds(map, tx, ty) || getTile(map, tx, ty) === Tile.Wall) continue;
      const px = (tx + 0.5) * TILE_SIZE - x;
      const py = (ty + 0.5) * TILE_SIZE - y;
      const center = tx === cx && ty === cy;
      if (!center && px * px + py * py > radius * radius) continue;
      cells.push(toIndex(map, tx, ty));
    }
  }
  return cells;
}

/** 1 セルへ置く。置けたら true */
function setCell(layer: TerrainLayer, i: number, kind: TerrainKind, time: number): boolean {
  const current = layer.kinds[i] ?? NONE;
  if (current === LAVA && kind !== "lava") return false;
  if (kind === "fire") return igniteCell(layer, i) || placeFire(layer, i, time, current);
  writeCell(layer, i, terrainCode(kind), time);
  return true;
}

/** 燃えるものの無いセルへ炎を置く（水の上では消える） */
function placeFire(layer: TerrainLayer, i: number, time: number, current: number): boolean {
  if (current === WATER || current === FIRE) return false;
  writeCell(layer, i, FIRE, time);
  layer.spread[i] = TERRAIN.fire.spreadGrass;
  return true;
}

/** 油・草 → 炎、氷 → 水。変わったら true */
function igniteCell(layer: TerrainLayer, i: number): boolean {
  const current = layer.kinds[i] ?? NONE;
  if (current === OIL || current === GRASS) {
    const oil = current === OIL;
    writeCell(layer, i, FIRE, oil ? TERRAIN.fire.oilBurnTime : TERRAIN.fire.grassBurnTime);
    layer.spread[i] = oil ? TERRAIN.fire.spreadOil : TERRAIN.fire.spreadGrass;
    return true;
  }
  if (current === ICE) {
    writeCell(layer, i, WATER, TERRAIN.placedDuration.water);
    return true;
  }
  return false;
}

function writeCell(layer: TerrainLayer, i: number, code: number, time: number): void {
  layer.kinds[i] = code;
  layer.time[i] = time;
  layer.spread[i] = SPREAD_DONE;
  if (time > 0 || code === FIRE) layer.active.add(i);
  else layer.active.delete(i);
}

function clearCell(layer: TerrainLayer, i: number): void {
  layer.kinds[i] = NONE;
  layer.time[i] = 0;
  layer.spread[i] = SPREAD_DONE;
  layer.active.delete(i);
}

// -----------------------------------------------------------------------------
// 時間経過
// -----------------------------------------------------------------------------

/** 地形を進める: 自然配置（フロアごとに 1 回）→ 燃え広がり・時間切れ → 上に立つ者への効果 */
export function updateTerrain(state: GameState, dt: number): void {
  const layer = ensureTerrainLayer(state);
  planOnce(state, layer);
  if (layer.active.size > 0) tickCells(state, layer, dt);
  layer.tickTimer += dt;
  if (layer.tickTimer < TERRAIN.tickInterval) return;
  layer.tickTimer -= TERRAIN.tickInterval;
  layer.tickCount += 1;
  applyToBodies(state, layer);
}

/** 時間のあるセルだけを進める（Set の挿入順なので決定的） */
function tickCells(state: GameState, layer: TerrainLayer, dt: number): void {
  let changed = false;
  for (const i of [...layer.active]) {
    const code = layer.kinds[i] ?? NONE;
    if (code === FIRE && tickFireSpread(state, layer, i, dt)) changed = true;
    const left = (layer.time[i] ?? 0) - dt;
    layer.time[i] = left;
    if (left > 0) continue;
    clearCell(layer, i);
    changed = true;
  }
  if (changed) layer.version += 1;
}

/** 炎が隣の油・草に燃え移る（1 セルにつき 1 回）。燃え移ったら true */
function tickFireSpread(state: GameState, layer: TerrainLayer, i: number, dt: number): boolean {
  const wait = layer.spread[i] ?? SPREAD_DONE;
  if (wait === SPREAD_DONE) return false;
  const next = wait - dt;
  if (next > 0) {
    layer.spread[i] = next;
    return false;
  }
  layer.spread[i] = SPREAD_DONE;
  const map = state.map;
  const tx = i % map.width;
  const ty = Math.floor(i / map.width);
  let spread = false;
  for (const [dx, dy] of NEIGHBORS_4) {
    const nx = tx + dx;
    const ny = ty + dy;
    if (!inBounds(map, nx, ny)) continue;
    if (igniteCell(layer, toIndex(map, nx, ny))) spread = true;
  }
  return spread;
}

// -----------------------------------------------------------------------------
// 上に立つ者への効果（プレイヤーと敵の両方）
// -----------------------------------------------------------------------------

function applyToBodies(state: GameState, layer: TerrainLayer): void {
  if (state.status === "playing") applyAt(state, layer, { kind: "player" }, state.player.body.pos);
  for (const e of state.enemies) {
    if (e.hp <= 0 || e.phase === "spawning") continue;
    applyAt(state, layer, { kind: "enemy", enemy: e }, e.body.pos);
  }
}

function applyAt(state: GameState, layer: TerrainLayer, target: StatusTarget, pos: Vec): void {
  const i = tileIndexAt(state, pos.x, pos.y);
  if (i < 0) return;
  const code = layer.kinds[i] ?? NONE;
  if (code === NONE) return;
  switch (code) {
    case WATER:
      onWater(state, layer, target, i);
      return;
    case OIL:
      give(state, target, "oiled", TERRAIN.oil.oiledStacks, STATUS.oiled.duration, 0);
      return;
    case LAVA:
      onLava(state, target);
      return;
    case BOG:
      give(state, target, "poison", 1, TERRAIN.bog.poisonDuration, 0);
      if (layer.tickCount % TERRAIN.bog.corrodeEvery === 0) give(state, target, "corrode", 1, STATUS.corrode.duration, 0);
      return;
    case ICE:
      if (layer.tickCount % TERRAIN.ice.chillEvery === 0) give(state, target, "chill", 1, TERRAIN.ice.chillDuration, 0);
      return;
    case FIRE:
      give(state, target, "burn", 1, TERRAIN.fire.burnDuration, TERRAIN.fire.burnDps);
      return;
    default:
      return;
  }
}

function give(state: GameState, target: StatusTarget, kind: StatusApply["kind"], stacks: number, duration: number, potency: number): void {
  applyStatus(state, target, { kind, stacks, duration, potency }, "env");
}

/** 水たまり: 濡れ。冷えている者が立つと凍りついて氷床になる */
function onWater(state: GameState, layer: TerrainLayer, target: StatusTarget, i: number): void {
  give(state, target, "wet", TERRAIN.water.wetStacks, STATUS.wet.duration, 0);
  const bag = target.kind === "enemy" ? target.enemy.status : state.player.status;
  if (!hasStatus(bag, "chill") && !hasStatus(bag, "freeze")) return;
  writeCell(layer, i, ICE, TERRAIN.placedDuration.ice);
  layer.version += 1;
}

/** 溶岩: 燃焼 + 即時の小ダメージ。プレイヤーはダッシュ中なら無傷 */
function onLava(state: GameState, target: StatusTarget): void {
  if (target.kind === "player") {
    if (state.player.dashTimer > 0) return;
    give(state, target, "burn", 1, TERRAIN.lava.burnDuration, TERRAIN.lava.burnDps);
    damagePlayerDot(state, TERRAIN.lava.damage);
    return;
  }
  give(state, target, "burn", 1, TERRAIN.lava.burnDuration, TERRAIN.lava.burnDps);
  burnEnemy(state, target.enemy);
}

function burnEnemy(state: GameState, e: Enemy): void {
  if (e.hp <= 0) return;
  damageEnemy(state, e, TERRAIN.lava.enemyDamage, { x: 0, y: 0 }, 0, { silent: true });
}

// -----------------------------------------------------------------------------
// 氷床の滑り（player.ts の移動が呼ぶ）
// -----------------------------------------------------------------------------

/**
 * 氷床の上では入力にすぐ追従せず、前の速度から TERRAIN.ice.accel の速さで近づく（慣性で止まりにくい）。
 * 氷床でなければ desired をそのまま返す
 */
export function terrainSlide(state: GameState, pos: Vec, prevVel: Vec, desired: Vec, dt: number): Vec {
  if (terrainAt(state, pos.x, pos.y) !== "ice") return desired;
  const blend = 1 - Math.exp(-TERRAIN.ice.accel * dt);
  return add(prevVel, scale(sub(desired, prevVel), blend));
}
