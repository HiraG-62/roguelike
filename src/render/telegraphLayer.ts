import type { Enemy, GameState } from "../core/state";
import { VIEW_H, VIEW_W } from "../core/view";
import { FLOOR_KIND, TELEGRAPH } from "../data/tuning";
import { isStaggered, poiseRatio } from "../system/poise";
import { type ThreatArea, threatShapes, threatensPlayer } from "../system/threat";
import { warmFillTables } from "./inkFill";
import { warmInkStroke } from "./inkStroke";
import { type InkSurface, sharedInkSurface } from "./inkSurface";
import { hash01, pulse } from "./renderMath";
import { ThreatCues } from "./threatCueUi";
import { type CutCircle, type InkStage, type Seg, drawCorner, drawHeadMark, drawStop, placeArea, placeInk, placeSketch, sketchGap, telegraphStage } from "./telegraphInk";
import { drawLeadMark } from "./telegraphLineUi";

/**
 * 予告を描く 1 回の描き込み（docs/ideas/ink-telegraph-impl.md 段 1・5 章）。全部の敵・自分・弾・粒の後、浮き文字の前に呼ぶ。
 * 敵の体の中で描くと、後に描かれた敵の体が前の敵の線を隠すので、ここへ集めた。
 * 線・範囲・印を作業面（inkSurface.ts）のドットへラスタライズし、最後に 1 回だけ画面へ置く。層の順は作業面のドットの印が決める
 * （下絵 → 範囲のむら → 胡粉 → 墨 → 朱と頭上の印）。自分の体の上は、印を置く前に作業面ごと 1 回だけ円で抜く。
 * 線は敵の体の縁から書き始める（体の上を黒い筆で塗りつぶさない）。
 * state を読むだけで書かない（欠けの並びは座標ハッシュ）。
 * 下絵を怯みで潰した（擦れて散る）・墨入れを受け流した（筆先が逸れる）演出は、前のフレームの線をここで覚えておいて、
 * 敵が怯みに入ったのを見たときに足す（結果に効かない見た目だけの記憶）
 */

/** 画面の外の敵の線は描かない余白（線の最長 + 輪・扇の半径） */
const CULL_MARGIN = 260;
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

/** 範囲を置く（墨入れの胡粉は攻撃の直前で濃い） */
function placeItemArea(surf: InkSurface, it: Item, a: Area): void {
  placeArea(surf, a, it.stage, it.e.id, it.gap, it.stage === "ink" ? it.haloMul : 1, it.e.body.radius);
}

export class TelegraphLayer {
  private remembered = new Map<number, Remembered>();
  private effects: Effect[] = [];
  private readonly cues = new ThreatCues();

  constructor(private readonly surface: InkSurface = sharedInkSurface()) {
    // 面のむらの表は描画の準備（起動時）に焼く。初めての範囲の予告のフレームで固まらないように
    warmFillTables();
    warmInkStroke();
  }

  draw(ctx: CanvasRenderingContext2D, state: GameState, helpers: TelegraphHelpers): void {
    const items: Item[] = [];
    for (const e of state.enemies) {
      if (!onScreen(state, e)) continue;
      const it = collect(state, e);
      if (it) items.push(it);
    }
    this.track(state, items);
    this.cues.update(state);
    const surf = this.surface;
    surf.begin(ctx);
    // 被弾筋は予告と同じ墨の層（作業面の印で重なりが決まる）
    this.cues.drawTraces(surf, state);
    for (const it of items) for (const a of it.areas) placeItemArea(surf, it, a);
    for (const it of items) {
      if (it.stage === "ink") continue;
      it.strokes.forEach((s, i) => placeSketch(surf, s.seg, it.e.id * 4 + i, it.gap, s.alpha));
    }
    // 墨入れ同士は早く当たる物（残りの短い物）が上（後から置いた朱が勝つ）
    const inks = items.filter((it) => it.stage === "ink").sort((a, b) => b.e.phaseTimer - a.e.phaseTimer);
    for (const it of inks) it.strokes.forEach((s, i) => placeInk(surf, s.seg, it.e.id * 4 + i, s.alpha, it.haloMul));
    this.placeEffects(surf, state);
    cutPlayer(surf, state);
    for (const it of items) this.placeMarks(surf, it, helpers);
    this.cues.drawEdges(surf, state);
    surf.flush(ctx);
    for (const it of items) this.drawOverlay(ctx, state, it, helpers);
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
    ctx.save();
    ctx.translate(ox, oy);
    const surf = this.surface;
    surf.begin(ctx);
    for (const it of items) for (const a of it.areas) placeItemArea(surf, it, a);
    for (const it of items) it.strokes.forEach((s, i) => placeInk(surf, s.seg, it.e.id * 4 + i, s.alpha, it.haloMul));
    cutPlayer(surf, state);
    for (const it of items) for (const s of it.strokes) if (s.stop) drawStop(surf, s.seg.x1, s.seg.y1, s.alpha);
    surf.flush(ctx);
    ctx.restore();
  }

  /** 先端の朱・折れ線の曲がり角・光線の目標と頭上の印（作業面の印の層。線の上） */
  private placeMarks(surf: InkSurface, it: Item, helpers: TelegraphHelpers): void {
    const { e, stage } = it;
    if (stage === "ink") for (const s of it.strokes) if (s.stop) drawStop(surf, s.seg.x1, s.seg.y1, s.alpha);
    if (it.strokes.length > 1 && e.doubleCharge) drawCorner(surf, e.doubleCharge.turn.x, e.doubleCharge.turn.y, stage);
    if (it.laserTarget) drawHeadMark(surf, it.laserTarget.x, it.laserTarget.y, stage);
    if (e.phase === "windup") drawHeadMark(surf, e.body.pos.x, helpers.headTop(e) - TELEGRAPH.headMarkRise, stage);
  }

  /** 作業面を置いた後に ctx へ直接描く物: 星読みの眼の目盛り・光線の目標の光 */
  private drawOverlay(ctx: CanvasRenderingContext2D, state: GameState, it: Item, helpers: TelegraphHelpers): void {
    if (it.lead) drawLeadMark(ctx, state, it.e, it.lead.dir, it.lead.length);
    const laser = it.laserTarget;
    if (laser && it.stage === "ink") helpers.glow(laser.x, laser.y, TELEGRAPH.shuColor, LASER_GLOW_R, pulse(state.time, LASER_PULSE_SPEED, 0.5, 1));
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

  private placeEffects(surf: InkSurface, state: GameState): void {
    for (const f of this.effects) {
      const p = Math.min(1, (state.time - f.start) / effectSec(f.kind));
      const fade = 1 - p;
      if (f.kind === "erase") {
        // 左右へ割れて散る（筆の筋がばらける）
        const drift = TELEGRAPH.eraseDriftPx * p;
        f.segs.forEach((s, i) => {
          placeSketch(surf, s, f.id * 4 + i, f.gap, fade * ERASE_HALF, -drift);
          placeSketch(surf, s, f.id * 4 + i, f.gap, fade * ERASE_HALF, drift);
        });
        continue;
      }
      const sign = hash01(f.id, 5) < 0.5 ? -1 : 1;
      f.segs.forEach((s, i) => placeInk(surf, veered(s, sign * ((TELEGRAPH.veerAngleDeg * Math.PI) / 180) * p), f.id * 4 + i, fade));
    }
  }
}

/** 自分の体の上を作業面ごと抜く（線・範囲・被弾筋。印を置く前に 1 回だけ） */
function cutPlayer(surf: InkSurface, state: GameState): void {
  const p = state.player.body;
  const cut: CutCircle = { x: p.pos.x, y: p.pos.y, r: p.radius + TELEGRAPH.playerGapPad };
  surf.cutCircle(cut.x, cut.y, cut.r);
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

