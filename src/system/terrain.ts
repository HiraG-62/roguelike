import { type Enemy, type GameState, type Projectile, pushSfx } from "../core/state";
import type { StatusApply } from "../core/status";
import { type TerrainKind, type TerrainLayer, terrainCode, terrainKindOf } from "../core/terrain";
import { type Vec, add, scale, sub } from "../core/vec";
import { STATUS, TERRAIN, TERRAIN_MUD_SMOKE } from "../data/tuning";
import { TILE_SIZE, Tile, getTile, inBounds, toIndex } from "../map/grid";
import { planTerrain } from "../map/generator";
import { setSightBlocker } from "../map/sightBlock";
import { damageEnemy, damagePlayerDot } from "./combat";
import { spawnBurst } from "./effects";
import { type StatusTarget, applyStatus, hasStatus } from "./statusEffects";
import { pushPlayerEvent } from "../core/events";

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
const MUD = terrainCode("mud");
const NONE = terrainCode("none");
/** 煙の残り秒で「晴れない」を表す値（duration 0 で置いた煙） */
const SMOKE_FOREVER = Number.POSITIVE_INFINITY;
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
  layer.smoke = new Float64Array(size);
  layer.smokeCells = new Set();
  layer.version += 1;
  // 煙は視線を遮る（map/pathing.ts の lineOfSight が読む）。層の配列はフロアごとに作り直すので毎回 layer から読む
  setSightBlocker(state.map, (i) => (layer.smoke[i] ?? 0) > 0);
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

/** ピクセル座標に煙が漂っているか（煙は床の地形と重なるので terrainAt とは別に引く） */
export function smokeAt(state: GameState, x: number, y: number): boolean {
  const layer = state.terrain;
  if (layer.map !== state.map) return false;
  const i = tileIndexAt(state, x, y);
  if (i < 0) return false;
  return (layer.smoke[i] ?? 0) > 0;
}

/** 地形による移動速度の倍率（泥の中は遅い）。プレイヤーの歩き（terrainSlide）と敵の歩き・突進（enemies.ts）が掛ける */
export function terrainMoveMul(state: GameState, pos: Vec): number {
  return terrainAt(state, pos.x, pos.y) === "mud" ? TERRAIN_MUD_SMOKE.mud.moveMul : 1;
}

/**
 * 弾が煙に入ったら消す（中が見えないので撃ち抜けない。近接とスキルの領域攻撃は通る）。消したら true。
 * projectiles.ts が壁の判定の直後に呼ぶ
 */
export function swallowedBySmoke(state: GameState, pr: Projectile): boolean {
  if (!smokeAt(state, pr.pos.x, pr.pos.y)) return false;
  pr.life = 0;
  const s = TERRAIN_MUD_SMOKE.smoke;
  spawnBurst(state, pr.pos, s.puffColor, s.puffParticles, 30, 0.3, 2);
  return true;
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
  if (kind === "smoke") return placeSmoke(layer, cellsInRadius(state, x, y, radius), time);
  const baked: number[] = [];
  let placed = 0;
  for (const i of cellsInRadius(state, x, y, radius)) {
    if (setCell(layer, i, kind, time, baked)) placed += 1;
  }
  if (placed > 0) layer.version += 1;
  bakeMud(state, baked);
  return placed;
}

/**
 * 半径内の油・草に火をつけ、氷を溶かし、泥を固め、煙を晴らす（燃焼の付いた者・炎上の延焼が呼ぶ）。変わったセル数を返す
 */
export function igniteTerrainAt(state: GameState, x: number, y: number, radius: number): number {
  const layer = state.terrain;
  if (layer.map !== state.map) return 0;
  const baked: number[] = [];
  let changed = 0;
  for (const i of cellsInRadius(state, x, y, radius)) {
    if (igniteCell(layer, i, baked)) changed += 1;
  }
  if (changed > 0) layer.version += 1;
  bakeMud(state, baked);
  return changed;
}

/**
 * 中心のタイルは必ず含め、あとはタイル中心が半径内の床タイル。
 * 階段・泉には置かない（自然配置の planTerrain と同じく Tile.Floor だけ。階段の上の溶岩で降りられなくしない）
 */
function cellsInRadius(state: GameState, x: number, y: number, radius: number): number[] {
  const map = state.map;
  const cells: number[] = [];
  const cx = Math.floor(x / TILE_SIZE);
  const cy = Math.floor(y / TILE_SIZE);
  const reach = Math.ceil(radius / TILE_SIZE);
  for (let ty = cy - reach; ty <= cy + reach; ty++) {
    for (let tx = cx - reach; tx <= cx + reach; tx++) {
      if (!inBounds(map, tx, ty) || getTile(map, tx, ty) !== Tile.Floor) continue;
      const px = (tx + 0.5) * TILE_SIZE - x;
      const py = (ty + 0.5) * TILE_SIZE - y;
      const center = tx === cx && ty === cy;
      if (!center && px * px + py * py > radius * radius) continue;
      cells.push(toIndex(map, tx, ty));
    }
  }
  return cells;
}

/** 1 セルへ置く。置けたら true。炎で固まった泥のセルは baked に積む */
function setCell(layer: TerrainLayer, i: number, kind: TerrainKind, time: number, baked: number[]): boolean {
  const current = layer.kinds[i] ?? NONE;
  if (current === LAVA && kind !== "lava") return false;
  if (kind === "fire") {
    // 煙を先に晴らしておく（晴れただけで「燃え移った」扱いにして炎を置き損ねないように）
    clearSmoke(layer, i);
    return igniteCell(layer, i, baked) || placeFire(layer, i, time, current);
  }
  writeCell(layer, i, terrainCode(kind), time);
  return true;
}

/** 煙を置く（床の地形は消さない）。炎・溶岩の上には漂わない（火で即座に晴れる）。置けたセル数を返す */
function placeSmoke(layer: TerrainLayer, cells: readonly number[], time: number): number {
  const left = time > 0 ? time : SMOKE_FOREVER;
  let placed = 0;
  for (const i of cells) {
    const ground = layer.kinds[i] ?? NONE;
    if (ground === FIRE || ground === LAVA) continue;
    layer.smoke[i] = Math.max(layer.smoke[i] ?? 0, left);
    layer.smokeCells.add(i);
    placed += 1;
  }
  if (placed > 0) layer.version += 1;
  return placed;
}

/** 煙を晴らす。晴れたら true */
function clearSmoke(layer: TerrainLayer, i: number): boolean {
  if ((layer.smoke[i] ?? 0) <= 0) return false;
  layer.smoke[i] = 0;
  layer.smokeCells.delete(i);
  return true;
}

/** 燃えるものの無いセルへ炎を置く（水の上では消える） */
function placeFire(layer: TerrainLayer, i: number, time: number, current: number): boolean {
  if (current === WATER || current === FIRE) return false;
  writeCell(layer, i, FIRE, time);
  layer.spread[i] = TERRAIN.fire.spreadGrass;
  return true;
}

/** 油・草 → 炎、氷 → 水、泥 → 固まって消える（baked に積む）、煙 → 晴れる。変わったら true */
function igniteCell(layer: TerrainLayer, i: number, baked: number[]): boolean {
  const cleared = clearSmoke(layer, i);
  const current = layer.kinds[i] ?? NONE;
  if (current === MUD) {
    clearCell(layer, i);
    baked.push(i);
    return true;
  }
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
  return cleared;
}

function writeCell(layer: TerrainLayer, i: number, code: number, time: number): void {
  // 炎・溶岩の上に煙は残らない
  if (code === FIRE || code === LAVA) clearSmoke(layer, i);
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
  if (layer.smokeCells.size > 0) tickSmoke(layer, dt);
  notePlayerTerrain(state);
  layer.tickTimer += dt;
  if (layer.tickTimer < TERRAIN.tickInterval) return;
  layer.tickTimer -= TERRAIN.tickInterval;
  layer.tickCount += 1;
  applyToBodies(state, layer);
}

/** プレイヤーが別の地形に踏み込んだ瞬間を統一ルールのイベントにする（地形の上に居続ける間は積まない） */
function notePlayerTerrain(state: GameState): void {
  const p = state.player.body.pos;
  const kind = terrainAt(state, p.x, p.y);
  if (kind === state.ruleRun.playerTerrain) return;
  state.ruleRun.playerTerrain = kind;
  if (kind !== "none") pushPlayerEvent(state, "onTerrainEnter", kind, { tag: kind, source: { kind: "terrain", key: kind } });
}

/** 煙の残り秒を進める（Set の挿入順なので決定的） */
function tickSmoke(layer: TerrainLayer, dt: number): void {
  let changed = false;
  for (const i of [...layer.smokeCells]) {
    const left = (layer.smoke[i] ?? 0) - dt;
    if (left > 0) {
      layer.smoke[i] = left;
      continue;
    }
    clearSmoke(layer, i);
    changed = true;
  }
  if (changed) layer.version += 1;
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
  const baked: number[] = [];
  let spread = false;
  for (const [dx, dy] of NEIGHBORS_4) {
    const nx = tx + dx;
    const ny = ty + dy;
    if (!inBounds(map, nx, ny)) continue;
    if (igniteCell(layer, toIndex(map, nx, ny), baked)) spread = true;
  }
  bakeMud(state, baked);
  return spread;
}

/**
 * 泥が火で固まった: そのセルに立っている敵を短く麻痺させる（固まった泥に足を取られる）。
 * プレイヤーは止めない（docs/ideas/enemies.md E2 の「中の敵に短い麻痺」。自分の火で自分が止まる理不尽を避ける）
 */
function bakeMud(state: GameState, cells: readonly number[]): void {
  if (cells.length === 0) return;
  const set = new Set(cells);
  const m = TERRAIN_MUD_SMOKE.mud;
  for (const e of state.enemies) {
    if (e.hp <= 0 || e.phase === "spawning" || e.hidden) continue;
    if (!set.has(tileIndexAt(state, e.body.pos.x, e.body.pos.y))) continue;
    give(state, { kind: "enemy", enemy: e }, "paralyze", 1, m.bakeParalyze, 0);
    spawnBurst(state, e.body.pos, m.bakeColor, m.bakeParticles, 50, 0.3, 1.5);
  }
  pushSfx(state, "mudHarden");
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
    case MUD:
      freezeIfChilled(state, layer, target, i);
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
  freezeIfChilled(state, layer, target, i);
}

/** 冷えている（冷気・凍結）者が立つと、そのセルが凍りついて氷床になる（水たまり・泥） */
function freezeIfChilled(state: GameState, layer: TerrainLayer, target: StatusTarget, i: number): void {
  const bag = target.kind === "enemy" ? target.enemy.status : state.player.status;
  if (!hasStatus(bag, "chill") && !hasStatus(bag, "freeze")) return;
  writeCell(layer, i, ICE, TERRAIN.placedDuration.ice);
  layer.version += 1;
}

/** 溶岩: 燃焼 + 即時の小ダメージ。プレイヤーはダッシュ中・無敵中なら無傷 */
function onLava(state: GameState, target: StatusTarget): void {
  if (target.kind === "player") {
    if (playerUntouchable(state)) return;
    give(state, target, "burn", 1, TERRAIN.lava.burnDuration, TERRAIN.lava.burnDps);
    damagePlayerDot(state, TERRAIN.lava.damage);
    return;
  }
  give(state, target, "burn", 1, TERRAIN.lava.burnDuration, TERRAIN.lava.burnDps);
  burnEnemy(state, target.enemy);
}

/**
 * 溶岩を踏んでも焼けない: ダッシュ中・被弾後や祝福・スキルの無敵中。
 * 溶岩の即時ダメージは被弾扱いにしない（damagePlayerDot）ので、無敵の判定をここで持つ
 */
function playerUntouchable(state: GameState): boolean {
  const p = state.player;
  return p.dashTimer > 0 || p.invulnTimer > 0 || p.buffs.invuln > 0;
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
 * 泥の上では歩きが TERRAIN_MUD_SMOKE.mud.moveMul 倍に落ちる（player.ts はダッシュ中はここを通らない）。
 * どちらでもなければ desired をそのまま返す
 */
export function terrainSlide(state: GameState, pos: Vec, prevVel: Vec, desired: Vec, dt: number): Vec {
  const kind = terrainAt(state, pos.x, pos.y);
  if (kind === "mud") return scale(desired, TERRAIN_MUD_SMOKE.mud.moveMul);
  if (kind !== "ice") return desired;
  const blend = 1 - Math.exp(-TERRAIN.ice.accel * dt);
  return add(prevVel, scale(sub(desired, prevVel), blend));
}
