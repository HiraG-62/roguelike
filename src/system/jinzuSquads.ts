import type { Enemy, GameState, Jin } from "../core/state";
import { type Vec, sub } from "../core/vec";
import { type EnemyDef, enemyDef } from "../data/enemies";
import { roleOf } from "../data/enemyRoles";
import type { JinzuLeaderSeat, JinzuSquadKey } from "../data/formations";
import { HONJIN, JINZU } from "../data/tuning";
import type { StrokeFrame } from "../map/jinzuShape";
import { isBossDriven } from "./boss";
import { jinMembers } from "./jin";
import { isAllied } from "./rules";
import { isFeared, isHalted } from "./statusEffects";

/**
 * 本陣の大将の格上げ先と、陣図の画の隊の選び方（docs/ideas/jinzu-impl.md 2-2 R2・R3-f）。
 * どちらも乱数を引かず、位置と id だけで決める（同じ盤・同じ位置なら同じ隊）。メンバーを足さない・並べ替えない
 */

/** 座に近い順を比べるとき、同じ列とみなす差（px）。位置が空き地へ 1〜2 px ずれても列が割れない */
const SEAT_TOLERANCE = 4;

// -----------------------------------------------------------------------------
// 大将の格上げ
// -----------------------------------------------------------------------------

/** 大将にしてよい敵か: 部屋主・仇・潜る敵・臆病・群れの役割・止めにくい修飾子は不可 */
export function canLeadHonjin(e: Enemy, def: EnemyDef): boolean {
  if (e.hp <= 0 || e.nemesis || e.hidden) return false;
  if (def.lairMaster === true || def.timid !== undefined || isBossDriven(def)) return false;
  if (roleOf(def) === "swarm") return false;
  const excluded: readonly string[] = HONJIN.leaderExclude;
  return ![e.elite, e.eliteExtra].some((k) => k !== undefined && excluded.includes(k));
}

/** 陣の向き（facing）に対する前後・左右の座標。原点は陣の中心 */
function seatCoords(jin: Jin, e: Enemy): { along: number; lateral: number } {
  const d = sub(e.body.pos, jin.center);
  return { along: d.x * jin.facing.x + d.y * jin.facing.y, lateral: Math.abs(-d.x * jin.facing.y + d.y * jin.facing.x) };
}

/** 座への近さ（小さいほど近い）。rear は最も後ろ、front は最も前、center は中心 */
function seatPrimary(seat: JinzuLeaderSeat, jin: Jin, e: Enemy): number {
  const { along, lateral } = seatCoords(jin, e);
  if (seat === "rear") return along;
  if (seat === "front") return -along;
  return Math.hypot(along, lateral);
}

/** 座に最も近い、大将にできるメンバー 1 人（無ければ null）。同じ列なら中心線に近い方、さらに id が小さい方 */
export function pickHonjinLeader(state: GameState, jin: Jin, seat: JinzuLeaderSeat): Enemy | null {
  let best: Enemy | null = null;
  for (const e of jinMembers(state, jin)) {
    if (!canLeadHonjin(e, enemyDef(e.defKey))) continue;
    if (best === null || seatBetter(seat, jin, e, best)) best = e;
  }
  return best;
}

function seatBetter(seat: JinzuLeaderSeat, jin: Jin, a: Enemy, b: Enemy): boolean {
  const pa = seatPrimary(seat, jin, a);
  const pb = seatPrimary(seat, jin, b);
  if (Math.abs(pa - pb) > SEAT_TOLERANCE) return pa < pb;
  const la = seatCoords(jin, a).lateral;
  const lb = seatCoords(jin, b).lateral;
  if (la !== lb) return la < lb;
  return a.id < b.id;
}

// -----------------------------------------------------------------------------
// 画の隊
// -----------------------------------------------------------------------------

/** 隊の候補 1 人。u は大将から的への向きの前（的に近い方が大）、v は左（正が左） */
interface Candidate {
  e: Enemy;
  u: number;
  v: number;
  shooter: boolean;
}

/** 隊に入れてよい敵: 大将以外の生きた陣のメンバーで、chase か idle・潜らない・従魔でない・怯みなどで止まっていない */
function eligibleForSquad(state: GameState, jin: Jin, leader: Enemy, e: Enemy): boolean {
  if (e.id === leader.id || e.hp <= 0 || e.hidden || e.rout || e.jinzuRun) return false;
  if (e.phase !== "chase" && e.phase !== "idle") return false;
  if (isAllied(state, e) || isHalted(e) || isFeared(e)) return false;
  return !isBossDriven(enemyDef(e.defKey)) && e.jinId === jin.id;
}

function candidatesOf(state: GameState, jin: Jin, leader: Enemy, frame: StrokeFrame): Candidate[] {
  return jinMembers(state, jin)
    .filter((e) => eligibleForSquad(state, jin, leader, e))
    .map((e) => {
      const d = sub(e.body.pos, frame.origin);
      return {
        e,
        u: d.x * frame.u.x + d.y * frame.u.y,
        v: d.x * frame.v.x + d.y * frame.v.y,
        shooter: roleOf(enemyDef(e.defKey)) === "shooter",
      };
    });
}

/** 的に近い順（u の大きい順）。同じなら id */
function byFront(a: Candidate, b: Candidate): number {
  return b.u - a.u || a.e.id - b.e.id;
}

/** 左右に振る: v が正なら左、それ以外は右 */
function leftOf(c: Candidate): boolean {
  return c.v > 0;
}

/** 翼の内外: 中心線から遠い方を外に、近い方を内にして半々（外が多い側へ寄せる） */
function wingSplit(side: Candidate[]): { outer: Candidate[]; inner: Candidate[] } {
  const sorted = [...side].sort((a, b) => Math.abs(b.v) - Math.abs(a.v) || a.e.id - b.e.id);
  const cut = Math.ceil(sorted.length / 2);
  return { outer: sorted.slice(0, cut), inner: sorted.slice(cut) };
}

/** 前から n 人ずつの帯に割る（魚鱗: 先鋒 / 二列目 / 三列目） */
function bands(sorted: Candidate[]): { front: Candidate[]; mid: Candidate[]; back: Candidate[] } {
  const third = Math.ceil(sorted.length / 3);
  return { front: sorted.slice(0, third), mid: sorted.slice(third, third * 2), back: sorted.slice(third * 2) };
}

function pickSquad(key: JinzuSquadKey, pool: Candidate[]): Candidate[] {
  const runners = pool.filter((c) => !c.shooter);
  const wings = (left: boolean): { outer: Candidate[]; inner: Candidate[] } => wingSplit(runners.filter((c) => leftOf(c) === left));
  const sorted = [...pool].sort(byFront);
  const band = bands(sorted);
  switch (key) {
    case "outerLeft":
      return wings(true).outer;
    case "outerRight":
      return wings(false).outer;
    case "innerLeft":
      return wings(true).inner;
    case "innerRight":
      return wings(false).inner;
    case "center":
      return pool.filter((c) => c.shooter).sort(byFront);
    case "front":
      return band.front;
    case "midLeft":
      return band.mid.filter(leftOf);
    case "midRight":
      return band.mid.filter((c) => !leftOf(c));
    case "backLeft":
      return band.back.filter(leftOf);
    case "backRight":
      return band.back.filter((c) => !leftOf(c));
    case "head":
      return sorted.slice(0, Math.ceil(sorted.length / 2));
    case "tail":
      return sorted.slice(Math.ceil(sorted.length / 2));
  }
}

/** 隊を作るための状態: 候補の全員（帯・翼の割り方は全員で決める）と、これまでの画に使った敵 */
export interface SquadPool {
  all: Candidate[];
  used: Set<number>;
}

export function squadPoolOf(state: GameState, jin: Jin, leader: Enemy, frame: StrokeFrame): SquadPool {
  return { all: candidatesOf(state, jin, leader, frame), used: new Set() };
}

/**
 * 画 1 本の隊を取り出す（取り出した敵は使用済みにする = 画をまたいで重ならない）。
 * 帯・翼の割り方は最初の候補の全員で決めるので、前の画で人が出ても割りは動かない。
 * 隊は的に近い順（先頭が隊頭 = 走り出す順）で、最大 JINZU.squadMax 人
 */
export function takeSquad(pool: SquadPool, key: JinzuSquadKey): Enemy[] {
  const squad = pickSquad(key, pool.all)
    .filter((c) => !pool.used.has(c.e.id))
    .sort(byFront)
    .slice(0, JINZU.squadMax);
  for (const c of squad) pool.used.add(c.e.id);
  return squad.map((c) => c.e);
}

/** 隊の重心 */
export function squadCentroid(squad: readonly Enemy[]): Vec {
  let x = 0;
  let y = 0;
  for (const e of squad) {
    x += e.body.pos.x;
    y += e.body.pos.y;
  }
  return { x: x / squad.length, y: y / squad.length };
}
