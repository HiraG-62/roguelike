import type { Enemy, GameState } from "../core/state";
import { VIEW_H, VIEW_W } from "../core/view";
import { enemyDef } from "../data/enemies";
import { TELEGRAPH } from "../data/tuning";
import { behaviorOf } from "../system/behaviors/registry";
import { enemyActiveArea, enemyTelegraph } from "../system/enemies";
import { isStaggered, poiseRatio } from "../system/poise";
import { hash01, pulse } from "./renderMath";
import { doubleChargeLegs } from "./chargeLineUi";
import { type CutCircle, type InkStage, type Seg, drawHeadMark, drawStop, sketchGap, sketchSpans, strokeInk, strokeSketch, strokeStaged, telegraphStage } from "./telegraphInk";
import { drawLeadMark, telegraphLineDir } from "./telegraphLineUi";

/**
 * 予告を描く 1 回の描き込み（docs/ideas/ink-telegraph-impl.md 段 1）。全部の敵・自分・弾・粒の後、浮き文字の前に呼ぶ。
 * 敵の体の中で描くと、後に描かれた敵の体が前の敵の線を隠すので、ここへ集めた。線は自分の体の上だけ切る。
 * 下絵 → 墨入れの順に重ね、墨入れ同士は早く当たる物が上。state を読むだけで書かない（欠けの並びは座標ハッシュ）。
 * 下絵を怯みで潰した（擦れて散る）・墨入れを受け流した（筆先が逸れる）演出は、前のフレームの線をここで覚えておいて、
 * 敵が怯みに入ったのを見たときに足す（結果に効かない見た目だけの記憶）
 */

/** 画面の外の敵の線は描かない余白（線の最長 + 輪・扇の半径） */
const CULL_MARGIN = 260;
/** 折れ線の曲がり角の点の一辺（論理 px） */
const CORNER_DOT = 2;
/** 光線の目標点の光の半径と脈の速さ */
const LASER_GLOW_R = 8;
const LASER_PULSE_SPEED = 25;
/** 弧の欠けのセルを大きくし始める弧長（px）と、大きくする倍率の上限 */
const ARC_CELL_BASE_LEN = 90;
const ARC_CELL_MAX_SCALE = 4;
/** 前の状態が長く残らないよう、演出の最大数 */
const MAX_EFFECTS = 24;

interface StrokeSeg {
  seg: Seg;
  /** 折れ線の 2 本目など、薄く描く倍率 */
  alpha: number;
  /** 先端に止めを置く */
  stop: boolean;
}

interface RingShape {
  kind: "ring";
  x: number;
  y: number;
  r: number;
}

interface ConeShape {
  kind: "cone";
  x: number;
  y: number;
  range: number;
  base: number;
  half: number;
  /** 攻撃中（扇が残る間）の面の濃さ */
  active: boolean;
}

type Area = RingShape | ConeShape;

interface Item {
  e: Enemy;
  stage: InkStage;
  gap: number;
  strokes: StrokeSeg[];
  areas: Area[];
  /** 光線の目標点 */
  laserTarget: { x: number; y: number } | null;
  /** 星読みの眼の目盛りを付ける線（line の予告だけ） */
  lead: { dir: { x: number; y: number }; length: number } | null;
}

/** 前のフレームの線の覚え */
interface Remembered {
  segs: Seg[];
  stage: InkStage;
  gap: number;
}

interface Effect {
  kind: "erase" | "veer";
  id: number;
  segs: Seg[];
  gap: number;
  /** state.time（ヒットストップの間は進まないので、擦れは止めが明けてから散る） */
  start: number;
}

export interface TelegraphHelpers {
  /** 敵の頭の上の y（体の 2px 上）。頭上の印の席 */
  headTop(e: Enemy): number;
  /** 事前生成の光を借りる（線ごとの光は使わない） */
  glow(x: number, y: number, color: string, radius: number, alpha: number): void;
}

function onScreen(state: GameState, e: Enemy): boolean {
  const cam = state.camera.pos;
  return Math.abs(e.body.pos.x - cam.x) <= VIEW_W / 2 + CULL_MARGIN && Math.abs(e.body.pos.y - cam.y) <= VIEW_H / 2 + CULL_MARGIN;
}

function seg(x0: number, y0: number, x1: number, y1: number): Seg {
  return { x0, y0, x1, y1 };
}

/** 敵 1 体の予告の材料。描くものが無ければ null */
function collect(state: GameState, e: Enemy): Item | null {
  if (e.hidden || e.hp <= 0) return null;
  if (e.phase !== "windup" && e.phase !== "strike") return null;
  const def = enemyDef(e.defKey);
  const stage = e.phase === "strike" ? "ink" : telegraphStage(e);
  const item: Item = { e, stage, gap: sketchGap(poiseRatio(e)), strokes: [], areas: [], laserTarget: null, lead: null };
  const { x, y } = e.body.pos;

  if (e.phase === "windup") {
    const tele = enemyTelegraph(e, def);
    if (tele?.kind === "line") {
      const length = tele.length ?? TELEGRAPH.fallbackLength;
      const dir = telegraphLineDir(e, behaviorOf(def).aimFixedAtWindup(e, def), state.player.body.pos);
      item.strokes.push({ seg: seg(x, y, x + dir.x * length, y + dir.y * length), alpha: 1, stop: true });
      item.lead = { dir, length };
    } else if (tele?.kind === "laser" && e.ai?.target) {
      const t = e.ai.target;
      item.strokes.push({ seg: seg(x, y, t.x, t.y), alpha: 1, stop: false });
      item.laserTarget = { x: t.x, y: t.y };
    } else if (tele?.kind === "cross") {
      for (const p of e.ai?.points ?? []) item.strokes.push({ seg: seg(x, y, p.x, p.y), alpha: 1, stop: true });
    } else if (tele?.kind === "ring") {
      item.areas.push({ kind: "ring", x, y, r: tele.radius });
    } else if (tele?.kind === "cone") {
      item.areas.push({ kind: "cone", x, y, range: tele.range, base: Math.atan2(e.strikeDir.y, e.strikeDir.x), half: (tele.halfDeg * Math.PI) / 180, active: false });
    }
  }
  const active = enemyActiveArea(e, def);
  if (active?.kind === "cone") {
    item.areas.push({ kind: "cone", x, y, range: active.range, base: Math.atan2(e.strikeDir.y, e.strikeDir.x), half: (active.halfDeg * Math.PI) / 180, active: true });
  }
  for (const leg of doubleChargeLegs(e)) item.strokes.push(leg);
  if (item.strokes.length === 0 && item.areas.length === 0 && e.phase !== "windup") return null;
  return item;
}

function stageColor(stage: InkStage): string {
  return stage === "ink" ? TELEGRAPH.commitColor : TELEGRAPH.readyColor;
}

function drawArea(ctx: CanvasRenderingContext2D, a: Area, stage: InkStage, id: number, gap: number): void {
  const fill = a.kind === "cone" && a.active ? TELEGRAPH.rangeActiveFillAlpha : stage === "ink" ? TELEGRAPH.rangeInkFillAlpha : TELEGRAPH.rangeSketchFillAlpha;
  // 面は縁を助ける程度。大きな面を半透明で塗るのは重いので、濃さが 0 なら塗らない（下絵の間は面を持たない）
  if (fill > 0) {
    ctx.fillStyle = stageColor(stage);
    ctx.globalAlpha = fill;
    ctx.beginPath();
    if (a.kind === "ring") ctx.arc(a.x, a.y, a.r, 0, Math.PI * 2);
    else {
      ctx.moveTo(a.x, a.y);
      ctx.arc(a.x, a.y, a.range, a.base - a.half, a.base + a.half);
      ctx.closePath();
    }
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  // 縁は線と同じ筆。判定の内側に描く（外へ太らせると嘘になる）。面だけで読ませない（面は縮小で消える）
  const inset = TELEGRAPH.rangeBandWidth / 2;
  if (a.kind === "ring") {
    strokeArc(ctx, a.x, a.y, Math.max(1, a.r - inset), 0, Math.PI * 2, stage, id, gap);
    return;
  }
  const r = Math.max(1, a.range - inset);
  strokeArc(ctx, a.x, a.y, r, a.base - a.half, a.base + a.half, stage, id, gap);
  for (const sign of [-1, 1]) {
    const ang = a.base + sign * a.half;
    const edge = seg(a.x, a.y, a.x + Math.cos(ang) * r, a.y + Math.sin(ang) * r);
    if (stage === "ink") strokeInk(ctx, edge, null);
    else strokeSketch(ctx, edge, id * 2 + (sign > 0 ? 1 : 0), gap, null);
  }
}

/** 弧の縁。下絵は欠けのセルを円周に沿って描き、墨入れは途切れない 1 本 */
function strokeArc(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, a0: number, a1: number, stage: InkStage, id: number, gap: number): void {
  ctx.beginPath();
  if (stage === "ink") {
    ctx.arc(x, y, r, a0, a1);
    strokeStaged(ctx, "ink");
    return;
  }
  const len = Math.abs(a1 - a0) * r;
  // 大きな輪は欠けのセルも大きくする（弧の部分ごとに path を足すと、大きな円で数が増えて重い）
  const k = Math.max(1, Math.min(ARC_CELL_MAX_SCALE, len / ARC_CELL_BASE_LEN));
  for (const sp of sketchSpans(id, len / k, gap)) {
    const from = a0 + ((sp.from * k) / len) * (a1 - a0);
    const to = a0 + ((sp.to * k) / len) * (a1 - a0);
    ctx.moveTo(x + Math.cos(from) * r, y + Math.sin(from) * r);
    ctx.arc(x, y, r, from, to);
  }
  strokeStaged(ctx, "sketch");
}

export class TelegraphLayer {
  private remembered = new Map<number, Remembered>();
  private effects: Effect[] = [];

  draw(ctx: CanvasRenderingContext2D, state: GameState, helpers: TelegraphHelpers): void {
    const items: Item[] = [];
    for (const e of state.enemies) {
      if (!onScreen(state, e)) continue;
      const it = collect(state, e);
      if (it) items.push(it);
    }
    this.track(state, items);
    const p = state.player.body;
    const cut: CutCircle = { x: p.pos.x, y: p.pos.y, r: p.radius + TELEGRAPH.playerGapPad };

    for (const it of items) for (const a of it.areas) drawArea(ctx, a, it.stage, it.e.id, it.gap);
    for (const it of items) {
      if (it.stage === "ink") continue;
      it.strokes.forEach((s, i) => strokeSketch(ctx, s.seg, it.e.id * 4 + i, it.gap, cut, s.alpha));
    }
    // 墨入れ同士は早く当たる物（残りの短い物）が上
    const inks = items.filter((it) => it.stage === "ink").sort((a, b) => b.e.phaseTimer - a.e.phaseTimer);
    for (const it of inks) for (const s of it.strokes) strokeInk(ctx, s.seg, cut, s.alpha);
    for (const it of items) this.drawMarks(ctx, state, it, helpers);
    this.drawEffects(ctx, state, cut);
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1;
  }

  /** 止め・目盛り・光線の目標・頭上の印（線の上に重ねる小さな物） */
  private drawMarks(ctx: CanvasRenderingContext2D, state: GameState, it: Item, helpers: TelegraphHelpers): void {
    const { e, stage } = it;
    if (stage === "ink") for (const s of it.strokes) if (s.stop) drawStop(ctx, s.seg.x1, s.seg.y1, s.alpha);
    if (it.strokes.length > 1 && e.doubleCharge) {
      const t = e.doubleCharge.turn;
      ctx.fillStyle = stageColor(stage);
      ctx.fillRect(t.x - CORNER_DOT / 2, t.y - CORNER_DOT / 2, CORNER_DOT, CORNER_DOT);
    }
    if (it.lead) drawLeadMark(ctx, state, e, it.lead.dir, it.lead.length);
    const laser = it.laserTarget;
    if (laser) {
      if (stage === "ink") helpers.glow(laser.x, laser.y, TELEGRAPH.commitColor, LASER_GLOW_R, pulse(state.time, LASER_PULSE_SPEED, 0.5, 1));
      drawHeadMark(ctx, laser.x, laser.y, stage);
    }
    if (e.phase === "windup") drawHeadMark(ctx, e.body.pos.x, helpers.headTop(e) - TELEGRAPH.headMarkRise, stage);
  }

  /** 前のフレームにあった線が消え、その敵が怯みに入っていれば、擦れ（下絵）・筆先の逸れ（墨入れ）を足す */
  private track(state: GameState, items: readonly Item[]): void {
    const next = new Map<number, Remembered>();
    for (const it of items) {
      if (it.strokes.length === 0) continue;
      next.set(it.e.id, { segs: it.strokes.map((s) => s.seg), stage: it.stage, gap: it.gap });
    }
    this.effects = this.effects.filter((f) => f.start <= state.time && state.time - f.start < effectSec(f.kind));
    if (this.remembered.size > 0) {
      for (const [id, m] of this.remembered) {
        if (next.has(id)) continue;
        const e = state.enemies.find((o) => o.id === id);
        if (!e || e.hp <= 0 || !isStaggered(e)) continue;
        if (this.effects.length >= MAX_EFFECTS) this.effects.shift();
        this.effects.push({ kind: m.stage === "sketch" ? "erase" : "veer", id, segs: m.segs, gap: m.gap, start: state.time });
      }
    }
    this.remembered = next;
  }

  private drawEffects(ctx: CanvasRenderingContext2D, state: GameState, cut: CutCircle): void {
    for (const f of this.effects) {
      const p = Math.min(1, (state.time - f.start) / effectSec(f.kind));
      const fade = 1 - p;
      if (f.kind === "erase") {
        // 横へずれて散る。ずれの向きはセルごとの座標ハッシュ（rng は使わない）
        const drift = (i: number): number => (hash01(f.id, i + 11) < 0.5 ? -1 : 1) * TELEGRAPH.eraseDriftPx * p;
        f.segs.forEach((s, i) => strokeSketch(ctx, s, f.id * 4 + i, f.gap, cut, fade, drift));
        continue;
      }
      const sign = hash01(f.id, 5) < 0.5 ? -1 : 1;
      for (const s of f.segs) strokeInk(ctx, veered(s, sign * ((TELEGRAPH.veerAngleDeg * Math.PI) / 180) * p), cut, fade);
    }
  }
}

function effectSec(kind: Effect["kind"]): number {
  return kind === "erase" ? TELEGRAPH.eraseSec : TELEGRAPH.veerSec;
}

/** 根元を支点に先端を曲げた線（筆先が逸れる） */
export function veered(s: Seg, angle: number): Seg {
  const dx = s.x1 - s.x0;
  const dy = s.y1 - s.y0;
  const c = Math.cos(angle);
  const sn = Math.sin(angle);
  return { x0: s.x0, y0: s.y0, x1: s.x0 + dx * c - dy * sn, y1: s.y0 + dx * sn + dy * c };
}

