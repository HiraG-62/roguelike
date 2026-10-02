import type { Enemy, GameState } from "../core/state";
import { type Vec, normalize, sub } from "../core/vec";
import { type EnemyDef, enemyDef } from "../data/enemies";
import { TELEGRAPH, THREAT_CUE } from "../data/tuning";
import { behaviorOf } from "./behaviors/registry";
import { enemyActiveArea, enemyTelegraph } from "./enemies";

/**
 * 敵の攻撃の形（線・光線・十字・輪・扇・折れ線）と「自分に掛かるか」（docs/ideas/ink-telegraph-impl.md 段 2）。
 * 予告の描画（render/telegraphLayer.ts）・暗闇の描き直し・殺気・柝頭（audio/cues.ts）が同じ形と同じ判定を読む
 * （判定がばらけると「音は鳴ったのに縁は出ない」が起きる）。state を読むだけで書かず、rng も使わない
 */

export interface ThreatSeg {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** 線 1 本。second は折れ線の 2 本目（薄く描く）、stop は先端に止めを置く */
export interface ThreatStroke {
  seg: ThreatSeg;
  stop: boolean;
  second: boolean;
}

export interface RingArea {
  kind: "ring";
  x: number;
  y: number;
  r: number;
}

export interface ConeArea {
  kind: "cone";
  x: number;
  y: number;
  range: number;
  base: number;
  half: number;
  /** 攻撃中（扇が残る間） */
  active: boolean;
}

export type ThreatArea = RingArea | ConeArea;

export interface ThreatShapes {
  strokes: ThreatStroke[];
  areas: ThreatArea[];
  /** 光線の目標点 */
  laserTarget: Vec | null;
  /** 星読みの眼の目盛りを付ける線（line の予告だけ） */
  lead: { dir: Vec; length: number } | null;
}

/**
 * 線の向き。狙いを予備動作の終わりで更新する敵（beginStrike が player 方向へ向け直す）は、今のプレイヤー方向を向く。
 * 予備動作の始まりで狙いを固定する敵は strikeDir のまま
 */
export function telegraphAimDir(e: Enemy, aimFixed: boolean, playerPos: Vec): Vec {
  if (aimFixed) return e.strikeDir;
  return normalize(sub(playerPos, e.body.pos), e.strikeDir);
}

/** 二度突きの猪の折れ線（予備動作中は 2 本とも、突進の 1 本目を走っている間は曲がった先の 2 本目だけ） */
function doubleChargeStrokes(e: Enemy): ThreatStroke[] {
  const path = e.doubleCharge;
  if (!path) return [];
  const winding = e.phase === "windup";
  const firstLeg = e.phase === "strike" && path.leg === 1;
  if (!winding && !firstLeg) return [];
  const out: ThreatStroke[] = [];
  if (winding) out.push({ seg: { x0: e.body.pos.x, y0: e.body.pos.y, x1: path.turn.x, y1: path.turn.y }, stop: false, second: false });
  out.push({ seg: { x0: path.turn.x, y0: path.turn.y, x1: path.end.x, y1: path.end.y }, stop: true, second: true });
  return out;
}

function windupShapes(state: GameState, e: Enemy, def: EnemyDef, out: ThreatShapes): void {
  const { x, y } = e.body.pos;
  const tele = enemyTelegraph(e, def);
  if (tele?.kind === "line") {
    const length = tele.length ?? TELEGRAPH.fallbackLength;
    const dir = telegraphAimDir(e, behaviorOf(def).aimFixedAtWindup(e, def), state.player.body.pos);
    out.strokes.push({ seg: { x0: x, y0: y, x1: x + dir.x * length, y1: y + dir.y * length }, stop: true, second: false });
    out.lead = { dir, length };
    return;
  }
  if (tele?.kind === "laser" && e.ai?.target) {
    const t = e.ai.target;
    out.strokes.push({ seg: { x0: x, y0: y, x1: t.x, y1: t.y }, stop: false, second: false });
    out.laserTarget = { x: t.x, y: t.y };
    return;
  }
  if (tele?.kind === "cross") {
    for (const p of e.ai?.points ?? []) out.strokes.push({ seg: { x0: x, y0: y, x1: p.x, y1: p.y }, stop: true, second: false });
    return;
  }
  if (tele?.kind === "ring") {
    out.areas.push({ kind: "ring", x, y, r: tele.radius });
    return;
  }
  if (tele?.kind === "cone") {
    out.areas.push({ kind: "cone", x, y, range: tele.range, base: Math.atan2(e.strikeDir.y, e.strikeDir.x), half: (tele.halfDeg * Math.PI) / 180, active: false });
  }
}

/** 敵 1 体の予告の形。予備動作 / 攻撃中の敵だけ。描くものが無ければ null（予備動作で形の無い敵は空の形を返す） */
export function threatShapes(state: GameState, e: Enemy): ThreatShapes | null {
  if (e.hidden || e.hp <= 0) return null;
  if (e.phase !== "windup" && e.phase !== "strike") return null;
  const def = enemyDef(e.defKey);
  const out: ThreatShapes = { strokes: [], areas: [], laserTarget: null, lead: null };
  if (e.phase === "windup") windupShapes(state, e, def, out);
  const active = enemyActiveArea(e, def);
  if (active?.kind === "cone") {
    const { x, y } = e.body.pos;
    out.areas.push({ kind: "cone", x, y, range: active.range, base: Math.atan2(e.strikeDir.y, e.strikeDir.x), half: (active.halfDeg * Math.PI) / 180, active: true });
  }
  out.strokes.push(...doubleChargeStrokes(e));
  if (out.strokes.length === 0 && out.areas.length === 0 && e.phase !== "windup") return null;
  return out;
}

// -----------------------------------------------------------------------------
// 自分に掛かるか
// -----------------------------------------------------------------------------

function distToSeg(px: number, py: number, s: ThreatSeg): number {
  const dx = s.x1 - s.x0;
  const dy = s.y1 - s.y0;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - s.x0) * dx + (py - s.y0) * dy) / len2)) : 0;
  return Math.hypot(px - (s.x0 + dx * t), py - (s.y0 + dy * t));
}

/** 角度の差の絶対値 0..π */
function angleDiff(a: number, b: number): number {
  const d = Math.abs(a - b) % (Math.PI * 2);
  return d > Math.PI ? Math.PI * 2 - d : d;
}

function areaReaches(a: ThreatArea, p: Vec, reach: number): boolean {
  const d = Math.hypot(p.x - a.x, p.y - a.y);
  if (a.kind === "ring") return d <= a.r + reach;
  if (d > a.range + reach) return false;
  if (d <= reach) return true;
  // 近いほど体の大きさが角度に効く
  const margin = Math.asin(Math.min(1, reach / d));
  return angleDiff(Math.atan2(p.y - a.y, p.x - a.x), a.base) <= a.half + margin;
}

/** 線も範囲も持たない敵（射手など）が自分を狙っているか（狙いの向きと自分の方向の差） */
function aimsAtPlayer(e: Enemy, p: Vec): boolean {
  const to = Math.atan2(p.y - e.body.pos.y, p.x - e.body.pos.x);
  const aim = Math.atan2(e.strikeDir.y, e.strikeDir.x);
  return angleDiff(to, aim) <= (THREAT_CUE.shotAimDeg * Math.PI) / 180;
}

/**
 * その敵の今の予告が自分の体に掛かるか（段・赤か黄かは見ない。呼び側が attackCommitted と組む）。
 * 線は敵の体の大きさも足した距離、光線は目標までの線、輪と扇は縁の内側（体の半径と余裕を足す）、形の無い敵は狙いの角で判定する
 */
export function threatensPlayer(state: GameState, e: Enemy): boolean {
  const shapes = threatShapes(state, e);
  if (!shapes) return false;
  const p = state.player.body;
  const reach = p.radius + THREAT_CUE.hitPad;
  for (const s of shapes.strokes) {
    const width = shapes.laserTarget ? reach : reach + e.body.radius;
    if (distToSeg(p.pos.x, p.pos.y, s.seg) <= width) return true;
  }
  for (const a of shapes.areas) if (areaReaches(a, p.pos, reach)) return true;
  if (shapes.strokes.length === 0 && shapes.areas.length === 0 && e.phase === "windup") return aimsAtPlayer(e, p.pos);
  return false;
}
