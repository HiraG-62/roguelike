import { rollSpread } from "../core/scale";
import { type Enemy, type GameState, type Jin, ROAMING_ROOM, type RoomState } from "../core/state";
import { type Vec, add, clamp, dist, lerp, normalize, sub } from "../core/vec";
import { type EnemyDef, enemiesForDepth } from "../data/enemies";
import { type EnemyGrade, type EnemyRole, roleOf } from "../data/enemyRoles";
import { type FormationDef, type FormationKey, type FormationLeader, type FormationSlot, formationDef, roomFormations } from "../data/formations";
import { ELITE, JIN } from "../data/tuning";
import { TILE_SIZE, Tile, inBounds, rectCenterPx, toIndex } from "../map/grid";
import { layoutOffsets, rotateToFacing } from "../map/formation";
import { lineOfSight, nextWaypoint } from "../map/pathing";
import { biomeEnemyWeight } from "./biomes";
import { extraEliteRoll, onBoonEnemySpawned } from "./boons";
import { NOTICE_RANGE, createEnemy } from "./enemies";
import { eliteKindsForRole, finalizeLinks, makeElite, rollElite } from "./elites";
import { lordCandidates } from "./floorLord";
import { circlesOverlap, overlapsWall } from "./physics";
import { roomLocks } from "./roomTypes";
import { onRunEnemySpawned } from "./runEvents";
import { canRoam, corridorTileList, pickRoamTarget } from "./spawner";
import { ringLookoutBell } from "./noise";
import { initJinMorale, updateJins, wakeJin as wakeJinMembers } from "./jin";

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
  /** 大将。格の重みは JIN.gradeWeight.leader、必ず精鋭の修飾子を付ける（深度が解禁に足りれば） */
  leader?: boolean;
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
  placeLookouts(state);
}

/** 陣を起こす（気付いた者の近くだけ起こし、残りは後詰。本体は jin.ts） */
export function wakeJin(state: GameState, jin: Jin): void {
  wakeJinMembers(state, jin);
}

/** 毎ステップ: 決着（全滅）・長蛇の起床・後詰・増援の代わり。本体は jin.ts の updateJins */
export function updateJinPhases(state: GameState): void {
  updateJins(state);
}

/** 陣の生命の揺らぎを掛ける。被弾していても満タンに戻さない（生成直後なら満タン） */
export function applyHpMul(e: Enemy, mul: number): void {
  if (mul === 1) return;
  const ratio = e.maxHp > 0 ? Math.min(1, e.hp / e.maxHp) : 1;
  e.maxHp = Math.max(1, Math.round(e.maxHp * mul));
  e.hp = Math.max(1, Math.round(e.maxHp * ratio));
  e.lastHp = e.hp;
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
  // 陣の生命の揺らぎ（newJin の中で rng を 1 回）は配役の後・メンバーを置く前。消費順は plan → hpMul → 各メンバー
  const jin = newJin(state, roomIndex, formation.key, center, facing);
  let weight = 0;
  plan.forEach((member, i) => {
    const offset = offsets[i] ?? { x: 0, y: 0 };
    const pos = freeSpotNear(state, add(center, rotateToFacing(offset, facing)), member.def.radius, inArea);
    if (!pos) return;
    const e = spawnMember(state, jin, member, pos);
    staggerCooldown(e, member.def, formation, i);
    if (member.leader) jin.leaderId = e.id;
    weight += member.leader ? JIN.gradeWeight.leader : JIN.gradeWeight[member.grade];
  });
  if (weight === 0) return null;
  initJinMorale(state, jin);
  state.jins.push(jin);
  if (roomIndex !== ROAMING_ROOM) finalizeLinks(state, roomIndex);
  return jin;
}

/**
 * 鋒矢: 列の後ろほど最初の攻撃を遅らせる（先頭から 1 人ごとに cooldownStagger 秒）。
 * 乱数の基準（攻撃間隔の 0.5〜1.5 倍）だとずれに埋もれるので、基準は攻撃間隔そのものにして、先頭から順に仕掛ける並びを読めるようにする
 */
function staggerCooldown(e: Enemy, def: EnemyDef, formation: FormationDef, rank: number): void {
  const stagger = formation.cooldownStagger;
  if (stagger === undefined || stagger <= 0) return;
  e.attackCooldown = def.attackInterval + rank * stagger;
}

/** 空の陣（メンバーは置く側が足す）。id は陣が消えないので通し番号 */
function newJin(state: GameState, roomIndex: number, formation: FormationKey, center: Vec, facing: Vec): Jin {
  return {
    hpMul: rollSpread(state.rng, 1, JIN.hpSpread),
    id: state.jins.length + 1,
    roomIndex,
    formation,
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
  // 大将は正面（先頭）に立ち、予算のうち大将の重さぶんを使う。残りをスロットに割る
  const leader = formation.leader ? planLeader(state, formation.leader, species, canUse) : null;
  if (leader) out.push(leader);
  const slotBudget = leader ? Math.max(0, budget - JIN.gradeWeight.leader) : budget;
  for (const slot of formation.slots) {
    const count = slotCount(slot, slotBudget);
    if (count <= 0) continue;
    if (!species.has(slot.role)) species.set(slot.role, pickRoleDef(state, slot.role, canUse));
    const def = species.get(slot.role);
    if (!def) continue;
    const grade = gradeAtDepth(slot.grade, state.depth);
    for (let k = 0; k < count; k++) out.push({ def, role: slot.role, grade });
  }
  return out;
}

/**
 * 大将の配役（rng: 部屋主の抽選 1 回 + 選んだ敵 1 回）。部屋主が候補にいれば lairChance でそれを大将にする
 * （階の主と同じ候補。深度 3 から）。外れたら role の敵を格 grade で。
 * 部屋主でない大将の種類は species に登録し、同じ役割のスロットが同じ種類で揃うようにする。候補がいなければ null
 */
function planLeader(state: GameState, leader: FormationLeader, species: Map<EnemyRole, EnemyDef | null>, canUse: (def: EnemyDef) => boolean): MemberPlan | null {
  const lairs = lordCandidates(state.depth).filter(canUse);
  if (lairs.length > 0 && state.rng.chance(leader.lairChance)) {
    const def = state.rng.pick(lairs);
    return { def, role: roleOf(def), grade: "normal", leader: true };
  }
  const def = pickRoleDef(state, leader.role, canUse);
  species.set(leader.role, def);
  if (!def) return null;
  return { def, role: leader.role, grade: gradeAtDepth(leader.grade, state.depth), leader: true };
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
  applyHpMul(e, jin.hpMul);
  onBoonEnemySpawned(state, e);
  onRunEnemySpawned(state, e);
  applyGrade(state, e, member);
  if (extraEliteRoll(state, e)) rollElite(state, e);
  state.enemies.push(e);
  return e;
}

function applyGrade(state: GameState, e: Enemy, member: MemberPlan): void {
  if (member.grade === "strong") makeStrong(e);
  // ランの縛り・反転層で既に精鋭になっていれば重ねない。大将は格に関わらず精鋭を 1 つ持つ（解禁前の深度では付かない）
  const elite = member.grade === "elite" || (member.leader === true && gradeAtDepth("elite", state.depth) === "elite");
  if (elite && !e.elite) makeElite(e, state.rng.pick(eliteKindsForRole(member.def, member.role)));
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

// -----------------------------------------------------------------------------
// 物見（2 つの陣の間の通路に立つ見張り）
// -----------------------------------------------------------------------------

/**
 * 物見を置く: 塊の陣を近い順の組にし、組の中点に最も近い通路タイルへ射手を 1 人置く（乱数は配役の分だけ）。
 * 中点から snapDist を超えて離れる・他の陣や物見に近すぎる組は見送り、count 人で止める。
 * 塊の陣が 2 つに満たない・深度が解禁に足りない（陣形の minDepth）ときは置かない
 */
function placeLookouts(state: GameState): void {
  const formation = formationDef("lookout");
  if (!formation || formation.minDepth > state.depth) return;
  const corridor = corridorTileList(state);
  if (corridor.length === 0) return;
  const area = new Uint8Array(state.map.tiles.length);
  for (const t of corridor) area[t] = 1;
  const start = state.rooms[START_ROOM];
  const anchors: Vec[] = [...(start ? [rectCenterPx(start.rect)] : []), ...state.jins.map((j) => j.center)];
  let placed = 0;
  for (const mid of jinPairMidpoints(state.jins.filter((j) => j.roomIndex !== ROAMING_ROOM))) {
    if (placed >= JIN.lookout.count) return;
    const at = nearestTile(state, corridor, mid);
    if (!at || dist(at, mid) > JIN.lookout.snapDist || minDistTo(at, anchors) < JIN.lookout.minDistFromJin) continue;
    const jin = spawnJin(state, ROAMING_ROOM, formation, 1, at, DEFAULT_FACING, (t) => area[t] === 1, canRoam);
    if (!jin) continue;
    anchors.push(at);
    placed++;
  }
}

/** 陣の組の中点を、組の距離が近い順に並べる（同距離は組の並び順。乱数なし） */
export function jinPairMidpoints(jins: readonly Jin[]): Vec[] {
  const pairs: { d: number; mid: Vec }[] = [];
  for (let a = 0; a < jins.length; a++) {
    for (let b = a + 1; b < jins.length; b++) {
      const ja = jins[a];
      const jb = jins[b];
      if (!ja || !jb) continue;
      pairs.push({ d: dist(ja.center, jb.center), mid: lerpVec(ja.center, jb.center, 0.5) });
    }
  }
  return pairs.sort((p, q) => p.d - q.d).map((p) => p.mid);
}

function lerpVec(a: Vec, b: Vec, t: number): Vec {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) };
}

/** 一覧のうち p に最も近いタイルの中心（同距離は index の小さい方）。空なら null */
function nearestTile(state: GameState, tiles: readonly number[], p: Vec): Vec | null {
  let best: Vec | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (const t of tiles) {
    const q = { x: ((t % state.map.width) + 0.5) * TILE_SIZE, y: (Math.floor(t / state.map.width) + 0.5) * TILE_SIZE };
    const d = dist(q, p);
    if (d >= bestD) continue;
    best = q;
    bestD = d;
  }
  return best;
}

/**
 * 毎ステップ: 眠っている物見が通常の 2 倍の距離（視線が通る間）でプレイヤーに気付いたら、
 * 物見の陣と、最も近い眠っている陣（物見どうしは除く）を起こす。起こすだけで決着・敗走は jin.ts の受け持ち
 */
export function updateLookouts(state: GameState): void {
  const p = state.player.body.pos;
  const range = NOTICE_RANGE * JIN.lookout.noticeMul;
  for (const jin of state.jins) {
    if (jin.formation !== "lookout" || jin.phase !== "sleeping") continue;
    const watcher = state.enemies.find((e) => e.jinId === jin.id && e.hp > 0 && e.phase === "idle");
    if (!watcher || dist(watcher.body.pos, p) > range || !lineOfSight(state.map, watcher.body.pos, p)) continue;
    wakeJin(state, jin);
    ringLookoutBell(state);
    const target = nearestSleepingJin(state, jin);
    if (target) wakeJin(state, target);
  }
}

/** from に最も近い眠っている陣（物見・from 自身を除く。同距離は id の小さい方）。無ければ null */
export function nearestSleepingJin(state: GameState, from: Jin): Jin | null {
  let best: Jin | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (const j of state.jins) {
    if (j === from || j.formation === "lookout" || j.phase !== "sleeping") continue;
    const d = dist(j.center, from.center);
    if (d >= bestD) continue;
    best = j;
    bestD = d;
  }
  return best;
}

// -----------------------------------------------------------------------------
// ボス陣（階の主と取り巻き）
// -----------------------------------------------------------------------------

/**
 * 階の主の部屋の封鎖で取り巻きが湧いた直後に呼ぶ: 主を大将、取り巻きをメンバーにした陣（陣形 偃月）を作る。
 * 配置は取り巻きの湧きのまま（陣形の並びにはしない）。封鎖中で全員が動いているので最初から交戦。
 * 主を倒すと群勢が崩れて取り巻きが敗走する（jin.ts）。主がいなければ null
 */
export function createBossJin(state: GameState, roomIndex: number, lordId: number, escorts: readonly Enemy[]): Jin | null {
  const lord = state.enemies.find((e) => e.id === lordId && e.hp > 0);
  const room = state.rooms[roomIndex];
  if (!lord || !room) return null;
  const jin = newJin(state, roomIndex, "crescent", rectCenterPx(room.rect), roomFacing(state, roomIndex));
  jin.leaderId = lord.id;
  jin.phase = "engaged";
  lord.jinId = jin.id;
  applyHpMul(lord, jin.hpMul);
  for (const e of escorts) {
    if (e.id === lord.id || e.hp <= 0 || e.jinId !== undefined) continue;
    e.jinId = jin.id;
    applyHpMul(e, jin.hpMul);
  }
  initJinMorale(state, jin);
  state.jins.push(jin);
  return jin;
}
