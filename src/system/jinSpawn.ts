import { type Enemy, type GameState, type Jin, ROAMING_ROOM, type RoomState } from "../core/state";
import { type Vec, add, clamp, dist, lerp, normalize, sub } from "../core/vec";
import { type EnemyDef, enemiesForDepth } from "../data/enemies";
import { type EnemyGrade, type EnemyRole, roleOf } from "../data/enemyRoles";
import { type FormationDef, type FormationSlot, formationDef, roomFormations } from "../data/formations";
import { ELITE, JIN } from "../data/tuning";
import { TILE_SIZE, Tile, inBounds, rectCenterPx, toIndex } from "../map/grid";
import { layoutOffsets, rotateToFacing } from "../map/formation";
import { nextWaypoint } from "../map/pathing";
import { biomeEnemyWeight } from "./biomes";
import { extraEliteRoll, onBoonEnemySpawned } from "./boons";
import { createEnemy } from "./enemies";
import { eliteKindsForRole, finalizeLinks, makeElite, rollElite } from "./elites";
import { circlesOverlap, overlapsWall } from "./physics";
import { roomLocks } from "./roomTypes";
import { onRunEnemySpawned } from "./runEvents";
import { canRoam, corridorTileList, pickRoamTarget } from "./spawner";

/**
 * 陣の配り（docs/ideas/jin-impl.md 2-5・2-6・2-9）。部屋を置き換えず、封鎖しない通常の塊の上に陣を乗せる。
 * メンバーの roomIndex は陣が占める塊のままなので、交戦・制圧・殲滅・祝福の部屋フックはそのまま効く。
 * 塊の選び方は最遠点の逐次選択（乱数なし）、予算は三角分布（state.rng）、陣形は重みで抽選。
 * 通路には長蛇（同じ種類の列）を置き、先頭の目的地を後ろが写して歩く（spawner.ts の retarget）。
 * 乱数は state.rng だけで、引く順は planJins の中で固定
 */

/** 開始の塊（floor.ts の START_ROOM） */
const START_ROOM = 0;
/** プレイヤーの近くに置かない距離（floor.ts の SPAWN_CLEARANCE と同じ考え方） */
const PLAYER_CLEARANCE = 40;
/** 並べたい点が塞がっているとき、空きを探す範囲（タイル） */
const SPOT_SEARCH_TILES = 6;
/** 陣形の向きが決まらないときの正面 */
const DEFAULT_FACING: Vec = { x: 1, y: 0 };

/** 1 人ぶんの配役 */
interface MemberPlan {
  def: EnemyDef;
  role: EnemyRole;
  grade: EnemyGrade;
}

/** 置いてよいタイルか（陣の塊・通路） */
type AreaTest = (tile: number) => boolean;

// -----------------------------------------------------------------------------
// 入口
// -----------------------------------------------------------------------------

/**
 * フロア生成時: 陣を配る。skip は開始とボスの塊（陣を置かない）。
 * 1. 候補の塊から最遠点で陣の塊を選ぶ → 2. 予算と陣形を引いて陣を置く → 3. 通路に長蛇を置く
 */
export function planJins(state: GameState, skip: ReadonlySet<number>): void {
  const rooms = spreadRooms(state, jinCandidateRooms(state, skip), jinCount(state));
  for (const index of rooms) {
    const room = state.rooms[index];
    if (!room) continue;
    const budget = jinBudget(state, index);
    const formation = pickFormation(state);
    if (!formation) continue;
    const center = rectCenterPx(room.rect);
    spawnJin(state, index, formation, budget, center, roomFacing(state, index), roomArea(state, room), () => true);
  }
  placeColumns(state);
}

/** 陣を起こす（3a: メンバーを全員 chase に。後詰は 3b） */
export function wakeJin(state: GameState, jin: Jin): void {
  if (jin.phase === "settled") return;
  jin.phase = "engaged";
  for (const e of state.enemies) {
    if (e.jinId === jin.id && e.hp > 0 && e.phase === "idle") e.phase = "chase";
  }
}

/**
 * 毎ステップ: 生き残りの無い陣を決着（全滅）にし、長蛇の誰かが気付いたら列ごと起こす。
 * 塊の陣は floor.ts の engageRoom が塊ごと起こす（部屋のフックを 1 回通すため）ので、ここでは起こさない
 */
export function updateJinPhases(state: GameState): void {
  if (state.jins.length === 0) return;
  const alive = new Set<number>();
  const awake = new Set<number>();
  for (const e of state.enemies) {
    if (e.jinId === undefined || e.hp <= 0) continue;
    alive.add(e.jinId);
    if (e.phase !== "idle" && e.phase !== "spawning") awake.add(e.jinId);
  }
  for (const jin of state.jins) {
    if (jin.phase === "settled") continue;
    if (!alive.has(jin.id)) {
      jin.phase = "settled";
      jin.settledBy = "wipe";
      continue;
    }
    if (jin.phase === "sleeping" && jin.roomIndex === ROAMING_ROOM && awake.has(jin.id)) wakeJin(state, jin);
  }
}

/** 格「猛」（強）にする: 生命と怯み耐性を上げる（接触ダメージの倍率は enemies.ts の contactDamageOf が JIN.strong.damageMul を掛ける） */
export function makeStrong(e: Enemy): void {
  e.grade = "strong";
  // 被弾していても満タンに戻さない（生成直後なら満タン）
  const ratio = e.maxHp > 0 ? Math.min(1, e.hp / e.maxHp) : 1;
  e.maxHp = Math.round(e.maxHp * JIN.strong.hpMul);
  e.hp = Math.max(1, Math.round(e.maxHp * ratio));
  e.lastHp = e.hp;
  e.poise.max *= JIN.strong.poiseMul;
}

// -----------------------------------------------------------------------------
// 数・場所・予算・陣形
// -----------------------------------------------------------------------------

/** 陣の数: 床タイル総数 / tilesPerJin を minJins〜maxJins に収める（面積の倍率は床タイル数に含まれる） */
export function jinCount(state: GameState): number {
  let floor = 0;
  for (const t of state.map.tiles) if (t === Tile.Floor) floor++;
  return clamp(Math.round(floor / JIN.tilesPerJin), JIN.minJins, JIN.maxJins);
}

/** 塊の床タイル数（矩形の部屋は幅 × 高さ） */
function roomTileCount(room: RoomState): number {
  return room.tiles ? room.tiles.size : room.rect.w * room.rect.h;
}

/** 陣を置ける塊: 通常の種類で封鎖しない・skip でない・十分に広い（index の昇順） */
export function jinCandidateRooms(state: GameState, skip: ReadonlySet<number>): number[] {
  return state.rooms
    .map((_, i) => i)
    .filter((i) => {
      const room = state.rooms[i];
      if (!room || skip.has(i) || room.kind !== "normal" || roomLocks(state, i)) return false;
      return roomTileCount(room) >= JIN.minRoomTiles;
    });
}

/**
 * 最遠点の逐次選択: 選んだ塊と開始の塊の中心からの最小距離が最大の候補を順に取る（同値は index が小さい方。乱数なし）。
 * 最小距離が minSpacing を切ったら止める
 */
export function spreadRooms(state: GameState, candidates: readonly number[], want: number): number[] {
  const start = state.rooms[START_ROOM];
  const anchors: Vec[] = start ? [rectCenterPx(start.rect)] : [];
  const left = [...candidates];
  const chosen: number[] = [];
  while (chosen.length < want && left.length > 0) {
    let best = -1;
    let bestD = -1;
    for (const i of left) {
      const room = state.rooms[i];
      if (!room) continue;
      const d = minDistTo(rectCenterPx(room.rect), anchors);
      if (d > bestD) {
        best = i;
        bestD = d;
      }
    }
    const room = state.rooms[best];
    if (!room || bestD < JIN.minSpacing) break;
    chosen.push(best);
    anchors.push(rectCenterPx(room.rect));
    left.splice(left.indexOf(best), 1);
  }
  return chosen;
}

function minDistTo(p: Vec, anchors: readonly Vec[]): number {
  let best = Number.POSITIVE_INFINITY;
  for (const a of anchors) best = Math.min(best, dist(p, a));
  return best;
}

/**
 * 陣の予算（並の敵の体数に換算した重さ）。平均 budgetBase + 深度 × budgetPerDepth を三角分布で ±budgetSpread 揺らし、
 * 塊の並び（開始からの歩数順）で densityNearStart → densityNearEnd を掛ける（奥ほど厚い）。rng を 2 回引く
 */
export function jinBudget(state: GameState, roomIndex: number): number {
  const mean = JIN.budgetBase + state.depth * JIN.budgetPerDepth;
  const tri = (state.rng.next() + state.rng.next() - 1) * JIN.budgetSpread;
  const t = state.rooms.length > 1 ? roomIndex / (state.rooms.length - 1) : 0;
  return Math.max(1, Math.round(mean * (1 + tri) * lerp(JIN.densityNearStart, JIN.densityNearEnd, t)));
}

/** その深度の部屋の陣形を重みで 1 つ引く（rng 1 回）。候補が無ければ null */
function pickFormation(state: GameState): FormationDef | null {
  const pool = roomFormations(state.depth);
  const total = pool.reduce((s, d) => s + d.weight, 0);
  if (total <= 0) return null;
  let roll = state.rng.next() * total;
  for (const d of pool) {
    roll -= d.weight;
    if (roll <= 0) return d;
  }
  return pool[pool.length - 1] ?? null;
}

/** 陣の正面: 開始側（index が小さい）の塊のうち最も近い中心へ向く。無ければ開始の塊へ */
function roomFacing(state: GameState, index: number): Vec {
  const room = state.rooms[index];
  if (!room) return DEFAULT_FACING;
  const center = rectCenterPx(room.rect);
  let target: Vec | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (let i = 0; i < index; i++) {
    const other = state.rooms[i];
    if (!other) continue;
    const c = rectCenterPx(other.rect);
    const d = dist(center, c);
    if (d < bestD) {
      bestD = d;
      target = c;
    }
  }
  return target ? normalize(sub(target, center), DEFAULT_FACING) : DEFAULT_FACING;
}

/** 塊の中に置けるタイル。矩形の部屋は外周 1 マスを除いた内側（floor.ts の randomPointIn と同じ） */
function roomArea(state: GameState, room: RoomState): AreaTest {
  const tiles = room.tiles;
  if (tiles) return (t) => tiles.has(t);
  const r = room.rect;
  const w = state.map.width;
  return (t) => {
    const x = t % w;
    const y = Math.floor(t / w);
    return x >= r.x + 1 && x <= r.x + r.w - 2 && y >= r.y + 1 && y <= r.y + r.h - 2;
  };
}

// -----------------------------------------------------------------------------
// 陣を置く
// -----------------------------------------------------------------------------

/**
 * 陣形のスロットを順に埋めて陣を置く。位置は layoutOffsets を facing で回して center に足し、塞がっていれば
 * 近くの空きへ寄せる（範囲の外なら見送る）。1 人も置けなければ陣を作らず null
 */
export function spawnJin(
  state: GameState,
  roomIndex: number,
  formation: FormationDef,
  budget: number,
  center: Vec,
  facing: Vec,
  inArea: AreaTest,
  canUse: (def: EnemyDef) => boolean,
): Jin | null {
  const plan = planMembers(state, formation, budget, canUse);
  const offsets = layoutOffsets(formation.layout, plan.length, formation.spacing);
  const jin: Jin = {
    id: state.jins.length + 1,
    roomIndex,
    formation: formation.key,
    center: { ...center },
    facing: { ...facing },
    leaderId: null,
    morale: 0,
    moraleMax: 0,
    phase: "sleeping",
    secondWaveAt: null,
    deathsTick: -1,
    deathsInTick: 0,
  };
  let weight = 0;
  plan.forEach((member, i) => {
    const offset = offsets[i] ?? { x: 0, y: 0 };
    const pos = freeSpotNear(state, add(center, rotateToFacing(offset, facing)), member.def.radius, inArea);
    if (!pos) return;
    spawnMember(state, jin, member, pos);
    weight += JIN.gradeWeight[member.grade];
  });
  if (weight === 0) return null;
  // 群勢の本実装（initJinMorale）は 3b。それまでは生成時の重さの合計で満たしておく
  jin.moraleMax = weight;
  jin.morale = weight;
  state.jins.push(jin);
  if (roomIndex !== ROAMING_ROOM) finalizeLinks(state, roomIndex);
  return jin;
}

/** スロットの人数: 予算 × share / 格の重さ を四捨五入して min〜max */
export function slotCount(slot: FormationSlot, budget: number): number {
  const raw = Math.round((budget * slot.share) / JIN.gradeWeight[slot.grade]);
  return clamp(raw, slot.min, slot.max ?? Number.POSITIVE_INFINITY);
}

/** 深度が格の解禁に足りなければ並に落とす（人数は保つ） */
export function gradeAtDepth(grade: EnemyGrade, depth: number): EnemyGrade {
  if (grade === "strong" && depth < JIN.strongMinDepth) return "normal";
  if (grade === "elite" && depth < ELITE.minDepth) return "normal";
  return grade;
}

/**
 * 配役。同じ役割のスロットは陣の中で同じ種類にする（3-15「同じ陣の中では揃っていて読める」）。
 * 役割に合う敵がその深度にいないスロットは見送る
 */
function planMembers(state: GameState, formation: FormationDef, budget: number, canUse: (def: EnemyDef) => boolean): MemberPlan[] {
  const species = new Map<EnemyRole, EnemyDef | null>();
  const out: MemberPlan[] = [];
  for (const slot of formation.slots) {
    const count = slotCount(slot, budget);
    if (count <= 0) continue;
    if (!species.has(slot.role)) species.set(slot.role, pickRoleDef(state, slot.role, canUse));
    const def = species.get(slot.role);
    if (!def) continue;
    const grade = gradeAtDepth(slot.grade, state.depth);
    for (let k = 0; k < count; k++) out.push({ def, role: slot.role, grade });
  }
  return out;
}

/** 陣の候補の敵（抽選に出る・臆病でない・部屋主でない。部屋主は大将のスロットだけ） */
export function jinPool(depth: number, role: EnemyRole): EnemyDef[] {
  return enemiesForDepth(depth).filter((d) => d.weight > 0 && !d.timid && !d.lairMaster && roleOf(d) === role);
}

/** 役割に合う敵を重み（バイオーム込み）で 1 種引く。候補が無ければ乱数を引かずに null */
function pickRoleDef(state: GameState, role: EnemyRole, canUse: (def: EnemyDef) => boolean): EnemyDef | null {
  const pool = jinPool(state.depth, role).filter(canUse);
  const weight = (d: EnemyDef): number => biomeEnemyWeight(d, state.floorKind);
  const total = pool.reduce((s, d) => s + weight(d), 0);
  if (total <= 0) return null;
  let roll = state.rng.next() * total;
  for (const def of pool) {
    roll -= weight(def);
    if (roll <= 0) return def;
  }
  return pool[pool.length - 1] ?? null;
}

/** 1 人置く: 生成 → 祝福・ランイベントのフック → 格 → 呪い・縛りの追加の精鋭 → push */
function spawnMember(state: GameState, jin: Jin, member: MemberPlan, pos: Vec): Enemy {
  const e = createEnemy(state, member.def, pos, jin.roomIndex, false);
  e.jinId = jin.id;
  onBoonEnemySpawned(state, e);
  onRunEnemySpawned(state, e);
  applyGrade(state, e, member);
  if (extraEliteRoll(state, e)) rollElite(state, e);
  state.enemies.push(e);
  return e;
}

function applyGrade(state: GameState, e: Enemy, member: MemberPlan): void {
  if (member.grade === "strong") makeStrong(e);
  // ランの縛り・反転層で既に精鋭になっていれば重ねない
  if (member.grade === "elite" && !e.elite) makeElite(e, state.rng.pick(eliteKindsForRole(member.def, member.role)));
}

// -----------------------------------------------------------------------------
// 空き地点
// -----------------------------------------------------------------------------

/** 半径 r の敵が (x, y) に立てるか: 四隅が範囲のタイル、壁・生きた敵・プレイヤーの近くに重ならない */
function spotFree(state: GameState, x: number, y: number, r: number, inArea: AreaTest): boolean {
  for (const [cx, cy] of [
    [x - r, y - r],
    [x + r, y - r],
    [x - r, y + r],
    [x + r, y + r],
  ] as const) {
    const tx = Math.floor(cx / TILE_SIZE);
    const ty = Math.floor(cy / TILE_SIZE);
    if (!inBounds(state.map, tx, ty) || !inArea(toIndex(state.map, tx, ty))) return false;
  }
  if (overlapsWall(state, x, y, r)) return false;
  const p = state.player.body.pos;
  if (circlesOverlap(x, y, r, p.x, p.y, PLAYER_CLEARANCE)) return false;
  return !state.enemies.some((e) => e.hp > 0 && circlesOverlap(x, y, r, e.body.pos.x, e.body.pos.y, e.body.radius));
}

/** want が空いていればそこ。塞がっていれば SPOT_SEARCH_TILES 以内のタイル中心から最も近い空き（乱数なし）。無ければ null */
function freeSpotNear(state: GameState, want: Vec, r: number, inArea: AreaTest): Vec | null {
  if (spotFree(state, want.x, want.y, r, inArea)) return { ...want };
  const wx = Math.floor(want.x / TILE_SIZE);
  const wy = Math.floor(want.y / TILE_SIZE);
  let best: Vec | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (let ty = wy - SPOT_SEARCH_TILES; ty <= wy + SPOT_SEARCH_TILES; ty++) {
    for (let tx = wx - SPOT_SEARCH_TILES; tx <= wx + SPOT_SEARCH_TILES; tx++) {
      if (!inBounds(state.map, tx, ty) || !inArea(toIndex(state.map, tx, ty))) continue;
      const q = { x: (tx + 0.5) * TILE_SIZE, y: (ty + 0.5) * TILE_SIZE };
      const d = dist(q, want);
      if (d >= bestD || !spotFree(state, q.x, q.y, r, inArea)) continue;
      best = q;
      bestD = d;
    }
  }
  return best;
}

// -----------------------------------------------------------------------------
// 長蛇（通路を歩く列）
// -----------------------------------------------------------------------------

/** 長蛇の本数: 切り捨て（base + 深度 × perDepth）、最大 max */
export function columnCount(depth: number): number {
  return Math.min(JIN.column.max, Math.floor(JIN.column.base + depth * JIN.column.perDepth));
}

/**
 * 通路タイルのうち、置いた陣・開始の塊・他の長蛇から最も遠い点を順に選んで長蛇を置く（乱数なし）。
 * 最遠でも minDistFromJin に届かなければ止める
 */
function placeColumns(state: GameState): void {
  const formation = formationDef("column");
  const tiles = corridorTileList(state);
  if (!formation || tiles.length === 0) return;
  const corridor = new Uint8Array(state.map.tiles.length);
  for (const t of tiles) corridor[t] = 1;
  const start = state.rooms[START_ROOM];
  const anchors: Vec[] = [...(start ? [rectCenterPx(start.rect)] : []), ...state.jins.map((j) => j.center)];
  const want = columnCount(state.depth);
  for (let n = 0; n < want; n++) {
    const at = farthestTile(state, tiles, anchors);
    if (!at) return;
    anchors.push(at);
    spawnColumn(state, formation, at, (t) => corridor[t] === 1);
  }
}

function farthestTile(state: GameState, tiles: readonly number[], anchors: readonly Vec[]): Vec | null {
  let best: Vec | null = null;
  let bestD = -1;
  for (const t of tiles) {
    const q = { x: ((t % state.map.width) + 0.5) * TILE_SIZE, y: (Math.floor(t / state.map.width) + 0.5) * TILE_SIZE };
    const d = minDistTo(q, anchors);
    if (d <= bestD) continue;
    best = q;
    bestD = d;
  }
  return bestD >= JIN.column.minDistFromJin ? best : null;
}

/** 長蛇 1 本: 先頭の目的地を引き（rng）、その道の向きへ列を伸ばす。全員が同じ目的地を持つ */
function spawnColumn(state: GameState, formation: FormationDef, at: Vec, inArea: AreaTest): void {
  const target = pickRoamTarget(state) ?? { ...at };
  const next = nextWaypoint(state.map, at, target) ?? target;
  const facing = normalize(sub(next, at), DEFAULT_FACING);
  const jin = spawnJin(state, ROAMING_ROOM, formation, JIN.column.members, at, facing, inArea, canRoam);
  if (!jin) return;
  for (const e of state.enemies) {
    if (e.jinId !== jin.id || !e.ai) continue;
    e.ai.roam = { ...target };
    e.ai.roamStuck = 0;
  }
}
