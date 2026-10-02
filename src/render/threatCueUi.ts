import type { Enemy, GameState } from "../core/state";
import { VIEW_H, VIEW_W } from "../core/view";
import { THREAT_CUE } from "../data/tuning";
import { attackCommitted } from "../system/poise";
import { threatensPlayer } from "../system/threat";
import { BrushPen, placeBrushLine } from "./inkBrush";

/**
 * 殺気と被弾筋（docs/ideas/ink-telegraph-impl.md 段 2）。見た目だけで、ゲームの結果には効かない。state を読み、前のフレームの様子は
 * この記憶だけに持つ（state には書かない）。描画で state.rng を使わず、筆のゆらぎは座標ハッシュ
 *
 * - 殺気: 画面の外の敵の攻撃が、自分に掛かる形で墨入れに入った瞬間、その方向の画面の縁に墨の払いを短く出す。
 *   画面の中の敵は線そのものが見えるので出さない（自分の周りに印を足すと、一番大事な所が汚れる）
 * - 被弾筋: 被弾した瞬間、当てた相手から自分へ、太い所から細る墨の一筆。朱は持たず（これから来る物と取り違えない）、乾いて消える。
 *   被弾の検知は state.hurt.last が新しい記録に替わったことで行う（sim の記録は読むだけ）
 */

/** 被弾の瞬間の出どころを探す距離（論理 px）: 近接の一撃で当てた敵 */
const STRIKE_REACH = 56;
/** 被弾筋の最短の長さ（出どころが自分に重なっているとき、筆が点にならないように） */
const TRACE_MIN_LEN = 10;
/** 被弾筋が同時に残る最大の数 */
const TRACE_MAX = 6;
/** 筆の変種を決める鍵の足し（殺気・被弾筋で同じ形が重ならないように） */
const EDGE_ID_BASE = 90001;
const TRACE_ID_BASE = 91001;

interface EdgeCue {
  /** 画面の縁の根元（世界座標）と、内側へ向かう向き */
  x: number;
  y: number;
  dirX: number;
  dirY: number;
  start: number;
  id: number;
}

interface TraceCue {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  start: number;
  sec: number;
  id: number;
}

/** 前のフレームの敵弾の位置（当たった弾は次のフレームに消えるので、被弾の出どころに使う） */
interface Near {
  x: number;
  y: number;
}

function outsideView(state: GameState, e: Enemy): boolean {
  const cam = state.camera.pos;
  return Math.abs(e.body.pos.x - cam.x) > VIEW_W / 2 || Math.abs(e.body.pos.y - cam.y) > VIEW_H / 2;
}

/** 画面の中心から (dx, dy) の向きに伸ばして、縁から inset 内側の矩形に当たる点までの倍率 */
function edgeScale(dx: number, dy: number, inset: number): number {
  const hx = VIEW_W / 2 - inset;
  const hy = VIEW_H / 2 - inset;
  const tx = dx !== 0 ? hx / Math.abs(dx) : Number.POSITIVE_INFINITY;
  const ty = dy !== 0 ? hy / Math.abs(dy) : Number.POSITIVE_INFINITY;
  return Math.min(tx, ty);
}

/** 敵 1 体が「墨入れに入った」状態か（予備動作でコミット窓の中）。攻撃中は立ち上がりの後なので数えない */
function committedWindup(e: Enemy): boolean {
  return e.phase === "windup" && attackCommitted(e);
}

export class ThreatCues {
  private committed = new Set<number>();
  private edges: EdgeCue[] = [];
  private traces: TraceCue[] = [];
  private lastHurt: unknown = null;
  private hurtOwner: unknown = null;
  private prevNear: Near[] = [];
  private seq = 0;

  /** 1 フレームに 1 回、描く前に呼ぶ: 墨入れへの立ち上がり（殺気）と被弾（被弾筋）を拾う */
  update(state: GameState): void {
    this.expire(state.time);
    this.noteEdges(state);
    this.noteHurt(state);
    this.prevNear = this.nearShots(state);
  }

  private expire(time: number): void {
    this.edges = this.edges.filter((f) => f.start <= time && time - f.start < THREAT_CUE.edgeSec);
    this.traces = this.traces.filter((f) => f.start <= time && time - f.start < f.sec);
  }

  private noteEdges(state: GameState): void {
    const next = new Set<number>();
    for (const e of state.enemies) {
      if (e.hp <= 0 || e.hidden || !committedWindup(e)) continue;
      next.add(e.id);
      if (this.committed.has(e.id) || !outsideView(state, e) || !threatensPlayer(state, e)) continue;
      this.pushEdge(state, e);
    }
    this.committed = next;
  }

  private pushEdge(state: GameState, e: Enemy): void {
    const cam = state.camera.pos;
    const dx = e.body.pos.x - cam.x;
    const dy = e.body.pos.y - cam.y;
    const len = Math.hypot(dx, dy);
    if (len <= 0) return;
    const k = edgeScale(dx, dy, THREAT_CUE.edgeInset);
    if (this.edges.length >= THREAT_CUE.edgeMax) this.edges.shift();
    this.edges.push({ x: cam.x + dx * k, y: cam.y + dy * k, dirX: -dx / len, dirY: -dy / len, start: state.time, id: EDGE_ID_BASE + (this.seq++ % 97) });
  }

  private nearShots(state: GameState): Near[] {
    const p = state.player.body.pos;
    const reach = THREAT_CUE.traceSourceReach;
    const out: Near[] = [];
    for (const pr of state.projectiles) {
      if (pr.owner !== "enemy") continue;
      if (Math.hypot(pr.pos.x - p.x, pr.pos.y - p.y) <= reach) out.push({ x: pr.pos.x, y: pr.pos.y });
    }
    return out;
  }

  /** 被弾の記録が新しくなった瞬間に、出どころから自分へ筆を引く（state.hurt が別の物に替わったら基準を取り直す） */
  private noteHurt(state: GameState): void {
    if (this.hurtOwner !== state.hurt) {
      this.hurtOwner = state.hurt;
      this.lastHurt = state.hurt.last;
      this.traces = [];
      return;
    }
    const rec = state.hurt.last;
    if (rec === this.lastHurt) return;
    this.lastHurt = rec;
    if (!rec) return;
    const from = this.sourceOf(state, rec.kind, rec.key);
    if (!from) return;
    const p = state.player.body.pos;
    const low = state.player.hp <= state.player.maxHp * THREAT_CUE.traceLowHpRatio;
    const sec = low ? THREAT_CUE.traceSecLow : THREAT_CUE.traceSec;
    if (this.traces.length >= TRACE_MAX) this.traces.shift();
    this.traces.push({ x0: from.x, y0: from.y, x1: p.x, y1: p.y, start: state.time, sec, id: TRACE_ID_BASE + (this.seq++ % 97) });
  }

  /** 当てた相手の位置。近接・射撃は同じ key の敵 → 前のフレームの敵弾、爆発や状態異常など出どころの位置が無い物は引かない */
  private sourceOf(state: GameState, kind: string, key: string): Near | null {
    const p = state.player.body.pos;
    if (kind !== "strike" && kind !== "shot") return null;
    let best: Enemy | null = null;
    let bestD = Number.POSITIVE_INFINITY;
    for (const e of state.enemies) {
      if (e.hp <= 0 || (key !== "" && e.defKey !== key)) continue;
      if (kind === "strike" && e.phase !== "strike" && e.phase !== "recover") continue;
      const d = Math.hypot(e.body.pos.x - p.x, e.body.pos.y - p.y);
      if (kind === "strike" && d > STRIKE_REACH) continue;
      if (d < bestD) {
        best = e;
        bestD = d;
      }
    }
    if (kind === "strike") return best ? { x: best.body.pos.x, y: best.body.pos.y } : null;
    // 射撃は撃ち手が遠いので、当たった弾の位置（前のフレームのもの）を出どころにする。弾が無ければ撃ち手
    const shot = this.nearestShot(p.x, p.y);
    if (shot) return shot;
    return best ? { x: best.body.pos.x, y: best.body.pos.y } : null;
  }

  private nearestShot(px: number, py: number): Near | null {
    let best: Near | null = null;
    let bestD = Number.POSITIVE_INFINITY;
    for (const s of this.prevNear) {
      const d = Math.hypot(s.x - px, s.y - py);
      if (d < bestD) {
        best = s;
        bestD = d;
      }
    }
    return best;
  }

  /** 被弾筋（予告より下の層に描くので、予告の描き込みの前に呼ぶ） */
  drawTraces(ctx: CanvasRenderingContext2D, state: GameState): void {
    if (this.traces.length === 0) return;
    const pen = new BrushPen(ctx);
    for (const f of this.traces) {
      const fade = 1 - (state.time - f.start) / f.sec;
      // 出どころが自分に重なって短すぎるときは、自分から出どころの向きへ最短の長さを確保する
      const len = Math.hypot(f.x1 - f.x0, f.y1 - f.y0);
      const x0 = len >= TRACE_MIN_LEN || len <= 0 ? f.x0 : f.x1 + ((f.x0 - f.x1) / len) * TRACE_MIN_LEN;
      const y0 = len >= TRACE_MIN_LEN || len <= 0 ? f.y0 : f.y1 + ((f.y0 - f.y1) / len) * TRACE_MIN_LEN;
      placeBrushLine(pen, x0, y0, f.x1, f.y1, "trace", f.id, 0, null, THREAT_CUE.traceAlpha * Math.max(0, fade));
    }
    pen.end();
  }

  /** 殺気（画面の縁の墨の払い）。予告の描き込みの後に呼ぶ */
  drawEdges(ctx: CanvasRenderingContext2D, state: GameState): void {
    if (this.edges.length === 0) return;
    const pen = new BrushPen(ctx);
    for (const f of this.edges) {
      const fade = 1 - (state.time - f.start) / THREAT_CUE.edgeSec;
      const len = THREAT_CUE.edgeLength;
      placeBrushLine(pen, f.x, f.y, f.x + f.dirX * len, f.y + f.dirY * len, "ink", f.id, 0, null, Math.max(0, fade));
    }
    pen.end();
  }
}
