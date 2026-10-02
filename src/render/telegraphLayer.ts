import type { Enemy, GameState } from "../core/state";
import { VIEW_H, VIEW_W } from "../core/view";
import { FLOOR_KIND, TELEGRAPH } from "../data/tuning";
import { isStaggered, poiseRatio } from "../system/poise";
import { type ThreatArea, threatShapes, threatensPlayer } from "../system/threat";
import { hash01, pulse } from "./renderMath";
import { BrushPen, RING_SWEEP, placeBrushArc, placeBrushFan, ringStartAngle } from "./inkBrush";
import { ThreatCues } from "./threatCueUi";
import { type CutCircle, type InkStage, type Seg, drawHeadMark, drawStop, placeInk, placeSketch, sketchGap, telegraphStage } from "./telegraphInk";
import { drawLeadMark } from "./telegraphLineUi";

/**
 * 予告を描く 1 回の描き込み（docs/ideas/ink-telegraph-impl.md 段 1・案 B）。全部の敵・自分・弾・粒の後、浮き文字の前に呼ぶ。
 * 敵の体の中で描くと、後に描かれた敵の体が前の敵の線を隠すので、ここへ集めた。線・輪・扇は自分の体の上だけ切る
 * （描き込み全体に 1 回だけ「自分の体の円を抜いた」切り抜きを掛ける。線ごとに切ると形をキャッシュできず、輪・扇も切れない）。
 * 線は敵の体の縁から書き始める（体の上を黒い筆で塗りつぶさない）。
 * 線は筆の形をキャッシュして回して置く（inkBrush.ts の BrushPen）。層の順は下絵の滲み → 下絵の筋 → 墨入れの胡粉 → 墨 → 朱。
 * state を読むだけで書かない（欠けの並びは座標ハッシュ）。
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
/** 擦れて散る 2 枚の筆跡それぞれの濃さ（合わせて元と同じ濃さに近づく） */
const ERASE_HALF = 0.7;
/** 光の円の縁より内側（この割合の半径）にいる敵は、幕の上へ描き直さない */
const DARK_LIGHT_EDGE = 0.9;
/** 前の状態が長く残らないよう、演出の最大数 */
const MAX_EFFECTS = 24;

interface StrokeSeg {
  seg: Seg;
  /** 折れ線の 2 本目など、薄く描く倍率 */
  alpha: number;
  /** 先端に止めを置く */
  stop: boolean;
}

type Area = ThreatArea;

interface Item {
  e: Enemy;
  stage: InkStage;
  gap: number;
  /** 胡粉の滲みの濃さの倍率（攻撃の直前と攻撃中は濃い） */
  haloMul: number;
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

/** 敵の体から出る線は、体の縁から書き始める（線の長さの割合で上限を付け、短い線が消えないように） */
function fromBodyEdge(s: Seg, e: Enemy): Seg {
  if (s.x0 !== e.body.pos.x || s.y0 !== e.body.pos.y) return s;
  const len = Math.hypot(s.x1 - s.x0, s.y1 - s.y0);
  if (len <= 0) return s;
  const inset = Math.min(e.body.radius, len * TELEGRAPH.brushStartInsetRatio);
  return { ...s, x0: s.x0 + ((s.x1 - s.x0) / len) * inset, y0: s.y0 + ((s.y1 - s.y0) / len) * inset };
}

/** 攻撃の直前（残りが imminentSec 以下）と攻撃中は胡粉の滲みを濃くする */
function haloMulOf(e: Enemy): number {
  const imminent = e.phase === "strike" || e.phaseTimer <= TELEGRAPH.imminentSec;
  return imminent ? TELEGRAPH.inkHaloImminentAlpha / TELEGRAPH.inkHaloAlpha : 1;
}

/** 敵 1 体の予告の材料（形は system/threat.ts。ここで段と欠けを足す）。描くものが無ければ null */
function collect(state: GameState, e: Enemy): Item | null {
  const shapes = threatShapes(state, e);
  if (!shapes) return null;
  const stage = e.phase === "strike" ? "ink" : telegraphStage(e);
  const strokes: StrokeSeg[] = shapes.strokes.map((s) => ({ seg: fromBodyEdge(s.seg, e), alpha: s.second ? TELEGRAPH.sketchSecondAlpha : 1, stop: s.stop }));
  return { e, stage, gap: sketchGap(poiseRatio(e)), haloMul: haloMulOf(e), strokes, areas: shapes.areas, laserTarget: shapes.laserTarget, lead: shapes.lead };
}

function placeArea(pen: BrushPen, it: Item, a: Area): void {
  // 範囲は中を塗らず、縁を筆で引く。帯は判定の内側に広がる（外へ太らせると嘘になる）
  const { stage, gap, e } = it;
  const haloMul = stage === "ink" ? it.haloMul : 1;
  if (a.kind === "ring") {
    placeBrushArc(pen, a.x, a.y, a.r, ringStartAngle(e.id), RING_SWEEP, stage, e.id, gap, 1, haloMul);
    return;
  }
  // 扇は要（敵の体の縁）→ 左の辺 → 弧 → 右の辺の 1 筆
  placeBrushFan(pen, a.x, a.y, a.range, a.base, a.half, e.body.radius, stage, e.id, gap, 1, haloMul);
}

export class TelegraphLayer {
  private remembered = new Map<number, Remembered>();
  private effects: Effect[] = [];
  private readonly cues = new ThreatCues();

  draw(ctx: CanvasRenderingContext2D, state: GameState, helpers: TelegraphHelpers): void {
    const items: Item[] = [];
    for (const e of state.enemies) {
      if (!onScreen(state, e)) continue;
      const it = collect(state, e);
      if (it) items.push(it);
    }
    this.track(state, items);
    this.cues.update(state);
    // 被弾筋は予告より下の層
    this.cues.drawTraces(ctx, state);

    const p = state.player.body;
    const cut: CutCircle = { x: p.pos.x, y: p.pos.y, r: p.radius + TELEGRAPH.playerGapPad };
    const pen = new BrushPen(ctx);
    for (const it of items) for (const a of it.areas) placeArea(pen, it, a);
    for (const it of items) {
      if (it.stage === "ink") continue;
      it.strokes.forEach((s, i) => placeSketch(pen, s.seg, it.e.id * 4 + i, it.gap, null, s.alpha));
    }
    // 墨入れ同士は早く当たる物（残りの短い物）が上
    const inks = items.filter((it) => it.stage === "ink").sort((a, b) => b.e.phaseTimer - a.e.phaseTimer);
    for (const it of inks) it.strokes.forEach((s, i) => placeInk(pen, s.seg, it.e.id * 4 + i, null, s.alpha, 0, it.haloMul));
    this.placeEffects(pen, state);
    endOutside(ctx, pen, cut);

    for (const it of items) this.drawMarks(ctx, state, it, helpers);
    this.cues.drawEdges(ctx, state);
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1;
  }

  /**
   * 暗闇の階: 光の外にいる敵の「自分に掛かる墨入れ」だけを幕の上に描き直す（下絵は描かない。暗闇の怖さは残し、避けられない攻撃を作らない）。
   * ox, oy はワールド → 画面の平行移動量（幕と同じ座標）
   */
  drawDark(ctx: CanvasRenderingContext2D, state: GameState, ox: number, oy: number): void {
    const p = state.player.body;
    const lightSq = (FLOOR_KIND.darkLightRadius * DARK_LIGHT_EDGE) ** 2;
    const items: Item[] = [];
    for (const e of state.enemies) {
      if (!onScreen(state, e)) continue;
      const dx = e.body.pos.x - p.pos.x;
      const dy = e.body.pos.y - p.pos.y;
      if (dx * dx + dy * dy <= lightSq) continue;
      const it = collect(state, e);
      if (!it || it.stage !== "ink" || !threatensPlayer(state, e)) continue;
      items.push(it);
    }
    if (items.length === 0) return;
    const cut: CutCircle = { x: p.pos.x, y: p.pos.y, r: p.radius + TELEGRAPH.playerGapPad };
    ctx.save();
    ctx.translate(ox, oy);
    const pen = new BrushPen(ctx);
    for (const it of items) for (const a of it.areas) placeArea(pen, it, a);
    for (const it of items) it.strokes.forEach((s, i) => placeInk(pen, s.seg, it.e.id * 4 + i, null, s.alpha, 0, it.haloMul));
    endOutside(ctx, pen, cut);
    for (const it of items) for (const s of it.strokes) if (s.stop) drawStop(ctx, s.seg.x1, s.seg.y1, s.alpha);
    ctx.restore();
  }

  /** 先端の朱・目盛り・光線の目標・頭上の印（線の上に重ねる小さな物） */
  private drawMarks(ctx: CanvasRenderingContext2D, state: GameState, it: Item, helpers: TelegraphHelpers): void {
    const { e, stage } = it;
    if (stage === "ink") for (const s of it.strokes) if (s.stop) drawStop(ctx, s.seg.x1, s.seg.y1, s.alpha);
    if (it.strokes.length > 1 && e.doubleCharge) {
      const t = e.doubleCharge.turn;
      ctx.fillStyle = stage === "ink" ? TELEGRAPH.shuColor : TELEGRAPH.usuzumiLightColor;
      ctx.fillRect(t.x - CORNER_DOT / 2, t.y - CORNER_DOT / 2, CORNER_DOT, CORNER_DOT);
    }
    if (it.lead) drawLeadMark(ctx, state, e, it.lead.dir, it.lead.length);
    const laser = it.laserTarget;
    if (laser) {
      if (stage === "ink") helpers.glow(laser.x, laser.y, TELEGRAPH.shuColor, LASER_GLOW_R, pulse(state.time, LASER_PULSE_SPEED, 0.5, 1));
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

  private placeEffects(pen: BrushPen, state: GameState): void {
    for (const f of this.effects) {
      const p = Math.min(1, (state.time - f.start) / effectSec(f.kind));
      const fade = 1 - p;
      if (f.kind === "erase") {
        // 左右へ割れて散る（筆の筋がばらける）
        const drift = TELEGRAPH.eraseDriftPx * p;
        f.segs.forEach((s, i) => {
          placeSketch(pen, s, f.id * 4 + i, f.gap, null, fade * ERASE_HALF, -drift);
          placeSketch(pen, s, f.id * 4 + i, f.gap, null, fade * ERASE_HALF, drift);
        });
        continue;
      }
      const sign = hash01(f.id, 5) < 0.5 ? -1 : 1;
      f.segs.forEach((s, i) => placeInk(pen, veered(s, sign * ((TELEGRAPH.veerAngleDeg * Math.PI) / 180) * p), f.id * 4 + i, null, fade));
    }
  }
}

/** 切り抜きの外枠の半幅（論理 px）。画面より十分広ければよい */
const CLIP_HALF = 4096;

/** 置いた筆を、自分の体の円を抜いた切り抜きの中で描く（save / clip は描き込み全体で 1 回だけ） */
function endOutside(ctx: CanvasRenderingContext2D, pen: BrushPen, cut: CutCircle): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(cut.x - CLIP_HALF, cut.y - CLIP_HALF, CLIP_HALF * 2, CLIP_HALF * 2);
  ctx.moveTo(cut.x + cut.r, cut.y);
  ctx.arc(cut.x, cut.y, cut.r, 0, Math.PI * 2);
  ctx.clip("evenodd");
  pen.end();
  ctx.restore();
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

