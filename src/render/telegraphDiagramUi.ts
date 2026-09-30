import { VIEW_H, VIEW_W } from "../core/view";
import { formatMeters } from "../core/units";
import type { EnemyDef } from "../data/enemies";
import { TELEGRAPH } from "../data/tuning";
import { type DiagramShape, type TelegraphDiagram, THREAT_LABEL } from "../system/telegraphDiagram";
import { type Sprite, drawFrame } from "./sprites";
import { TEXT, drawText, textLineHeight, textWidth } from "./pixelText";

/**
 * 予告の図解の全画面の重ね描き（図鑑の敵の頁から開く）。形は右向きの「最初の技」。
 * 図解の中身は system/telegraphDiagram.ts が敵データから導いたもので、ここは読んで描くだけ（state は読まない）
 */

const COLOR_BG = "#08080c";
const COLOR_PANEL = "#101018";
const COLOR_TITLE = "#ffd75f";
const COLOR_TEXT = "#e0e0e0";
const COLOR_DIM = "#808090";
const COLOR_SAFE = "#60d880";
const COLOR_STRIKE = "#f0f0f0";
const SAFE_TINT_ALPHA = 0.1;
const DANGER_ALPHA = 0.32;

const TITLE_SUFFIX = "予告の図解";
const PARRY_NOTE = "赤の間は受け流しだけが止められる";
const HINT = "Esc / Enter 戻る";
const SAFE_LABEL = "安全な場所";
const NO_SHAPE_NOTE = "予告の形なし";

const MARGIN = 8;
const TITLE_Y = 10;
const STAGE = { x: MARGIN, y: 24, w: VIEW_W - MARGIN * 2, h: 140 } as const;
/** 敵を置く位置（舞台の左寄り。右へ伸びる形の余白を残す） */
const ENEMY_X = STAGE.x + 70;
const ENEMY_Y = STAGE.y + STAGE.h / 2;
/** 舞台に収める最大の前方・横の幅（px）。形がこれを超えたら縮めて描く */
const MAX_FORWARD = STAGE.w - 70 - MARGIN;
const MAX_SIDE = STAGE.h / 2 - 6;
const BAR_Y = STAGE.y + STAGE.h + 8;
const BAR_H = 8;
const LINE_H_MIN = 10;
const HINT_Y = VIEW_H - 10;
const STROKE_W = 1;
/** 線・弾の扇の描き方 */
const VOLLEY_LENGTH_RATIO = 1;
const VOLLEY_DOT = 2;
const LANDING_OFFSET_RATIO = 1.4;
const CROSS_LENGTH = 70;
const TOUCH_MARGIN = 6;
const FULL_CIRCLE = Math.PI * 2;
const DEG = Math.PI / 180;
/** 帯の細い区間でも見えるようにする最小幅（px） */
const SEG_MIN_W = 1;

interface Extent {
  forward: number;
  side: number;
}

function lineH(m: number): number {
  return Math.max(LINE_H_MIN, textLineHeight(m));
}

/** 形が舞台のどこまで届くか（縮尺を決める） */
function extentOf(shape: DiagramShape, radius: number): Extent {
  switch (shape.kind) {
    case "line":
      return { forward: shape.length, side: radius };
    case "laser":
      return { forward: TELEGRAPH.maxLength, side: TELEGRAPH.maxLength * Math.sin(Math.min(Math.PI / 2, (shape.spreadDeg / 2) * DEG)) };
    case "ring":
      return { forward: shape.radius, side: shape.radius };
    case "cone":
      return { forward: shape.range, side: shape.range * Math.sin(Math.min(Math.PI / 2, shape.halfDeg * DEG)) };
    case "cross":
      return { forward: CROSS_LENGTH, side: CROSS_LENGTH };
    case "volley":
      return { forward: TELEGRAPH.fallbackLength, side: TELEGRAPH.fallbackLength * Math.sin(Math.min(Math.PI / 2, (shape.spreadDeg / 2) * DEG)) };
    case "landing":
      return { forward: shape.radius * (1 + LANDING_OFFSET_RATIO), side: shape.radius };
    case "touch":
      return { forward: radius + TOUCH_MARGIN, side: radius + TOUCH_MARGIN };
    case "none":
      return { forward: 0, side: 0 };
  }
}

/** 0 を含む範囲で 1 以下の縮尺（形が舞台からはみ出さないように） */
function scaleFor(ext: Extent): number {
  const f = ext.forward > 0 ? MAX_FORWARD / ext.forward : 1;
  const s = ext.side > 0 ? MAX_SIDE / ext.side : 1;
  return Math.min(1, f, s);
}

function fillCircle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, FULL_CIRCLE);
  ctx.fill();
}

function strokeCircle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, FULL_CIRCLE);
  ctx.stroke();
}

/** 危ない範囲の輪郭の経路を作る（塗りと輪郭の両方が同じ形を通す） */
function traceDanger(ctx: CanvasRenderingContext2D, shape: DiagramShape, radius: number, k: number): void {
  ctx.beginPath();
  switch (shape.kind) {
    case "line": {
      const half = radius * k;
      ctx.rect(ENEMY_X, ENEMY_Y - half, shape.length * k, half * 2);
      return;
    }
    case "ring":
      ctx.arc(ENEMY_X, ENEMY_Y, shape.radius * k, 0, FULL_CIRCLE);
      return;
    case "cone": {
      const a = Math.min(Math.PI, shape.halfDeg * DEG);
      ctx.moveTo(ENEMY_X, ENEMY_Y);
      ctx.arc(ENEMY_X, ENEMY_Y, shape.range * k, -a, a);
      ctx.closePath();
      return;
    }
    case "landing":
      ctx.arc(ENEMY_X + shape.radius * LANDING_OFFSET_RATIO * k, ENEMY_Y, shape.radius * k, 0, FULL_CIRCLE);
      return;
    case "touch":
      ctx.arc(ENEMY_X, ENEMY_Y, (radius + TOUCH_MARGIN) * k, 0, FULL_CIRCLE);
      return;
    default:
      return;
  }
}

/** 扇状の線（レーザー・弾）の角度。1 本なら正面だけ */
function fanAngles(count: number, spreadDeg: number): number[] {
  if (count <= 1) return [0];
  return Array.from({ length: count }, (_, i) => (-spreadDeg / 2 + (spreadDeg * i) / (count - 1)) * DEG);
}

function strokeFan(ctx: CanvasRenderingContext2D, angles: readonly number[], length: number, dots: boolean): void {
  for (const a of angles) {
    const ex = ENEMY_X + Math.cos(a) * length;
    const ey = ENEMY_Y + Math.sin(a) * length;
    ctx.beginPath();
    ctx.moveTo(ENEMY_X, ENEMY_Y);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    if (dots) fillCircle(ctx, ex, ey, VOLLEY_DOT);
  }
}

function strokeCross(ctx: CanvasRenderingContext2D, k: number): void {
  const len = CROSS_LENGTH * k;
  ctx.beginPath();
  ctx.moveTo(ENEMY_X - len, ENEMY_Y);
  ctx.lineTo(ENEMY_X + len, ENEMY_Y);
  ctx.moveTo(ENEMY_X, ENEMY_Y - len);
  ctx.lineTo(ENEMY_X, ENEMY_Y + len);
  ctx.stroke();
}

/** 形を描く。面を持つ形は「舞台を安全の緑で薄く塗る → 危ない範囲を地の色で抜く → 赤で塗る → 黄で縁取る」の順 */
function drawShape(ctx: CanvasRenderingContext2D, shape: DiagramShape, radius: number, k: number): void {
  ctx.fillStyle = COLOR_SAFE;
  ctx.globalAlpha = SAFE_TINT_ALPHA;
  ctx.fillRect(STAGE.x, STAGE.y, STAGE.w, STAGE.h);
  ctx.globalAlpha = 1;
  traceDanger(ctx, shape, radius, k);
  ctx.fillStyle = COLOR_PANEL;
  ctx.fill();
  ctx.globalAlpha = DANGER_ALPHA;
  ctx.fillStyle = TELEGRAPH.commitColor;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.lineWidth = STROKE_W;
  ctx.strokeStyle = TELEGRAPH.readyColor;
  ctx.stroke();
  if (shape.kind === "laser") strokeFan(ctx, fanAngles(shape.count, shape.spreadDeg), TELEGRAPH.maxLength * k, false);
  if (shape.kind === "volley") strokeFan(ctx, fanAngles(shape.count, shape.spreadDeg), TELEGRAPH.fallbackLength * VOLLEY_LENGTH_RATIO * k, true);
  if (shape.kind === "cross") strokeCross(ctx, k);
  if (shape.kind === "ring") strokeCircle(ctx, ENEMY_X, ENEMY_Y, shape.radius * k);
}

function drawEnemy(ctx: CanvasRenderingContext2D, sprite: Sprite | undefined, radius: number, color: string): void {
  const img = sprite?.frames[0];
  if (sprite && img) {
    drawFrame(ctx, sprite, img, ENEMY_X - sprite.w / 2, ENEMY_Y - sprite.h / 2);
    return;
  }
  // 絵が無いとき（テスト・読み込み前）も位置が分かるよう当たりの円で代える
  ctx.fillStyle = color;
  fillCircle(ctx, ENEMY_X, ENEMY_Y, radius);
}

interface Segment {
  label: string;
  seconds: number;
  color: string;
}

/** 時間の帯の区間。黄 = 怯ませられる間、赤 = コミット（必ず出る）、白 = 攻撃、緑 = 隙 */
function segmentsOf(d: TelegraphDiagram): Segment[] {
  return [
    { label: "黄 怯ませられる", seconds: d.commitFrom, color: TELEGRAPH.readyColor },
    { label: "赤 コミット", seconds: Math.max(0, d.windup - d.commitFrom), color: TELEGRAPH.commitColor },
    { label: "白 攻撃", seconds: d.strike, color: COLOR_STRIKE },
    { label: "緑 隙", seconds: d.recover, color: COLOR_SAFE },
  ];
}

function secondsText(s: number): string {
  return `${s.toFixed(1)}秒`;
}

function drawTimeBar(ctx: CanvasRenderingContext2D, d: TelegraphDiagram): number {
  const segs = segmentsOf(d);
  const total = segs.reduce((sum, s) => sum + s.seconds, 0);
  const barW = STAGE.w;
  let x = STAGE.x;
  for (const s of segs) {
    const w = total > 0 ? Math.max(SEG_MIN_W, Math.round((s.seconds / total) * barW)) : 0;
    if (w > 0 && s.seconds > 0) {
      ctx.fillStyle = s.color;
      ctx.fillRect(x, BAR_Y, w, BAR_H);
      x += w;
    }
  }
  const m = TEXT.SMALL;
  const gap = 10;
  let lx = STAGE.x;
  const ly = BAR_Y + BAR_H + 3;
  for (const s of segs) {
    const text = `${s.label} ${secondsText(s.seconds)}`;
    drawText(ctx, text, lx, ly, m, s.color, "left", "top");
    lx += textWidth(text, m) + gap;
  }
  return ly + lineH(m);
}

/** 形の大きさの一言（距離は formatMeters）。形に大きさの無いものは null */
function sizeNote(shape: DiagramShape): string | null {
  switch (shape.kind) {
    case "line":
      return `届く距離 ${formatMeters(shape.length)}`;
    case "ring":
      return `半径 ${formatMeters(shape.radius)}`;
    case "cone":
      return `届く距離 ${formatMeters(shape.range)}`;
    case "landing":
      return `着弾の半径 ${formatMeters(shape.radius)}`;
    case "laser":
      return shape.count > 1 ? `${shape.count} 本` : null;
    case "volley":
      return `${shape.count} 発`;
    default:
      return null;
  }
}

function drawNotes(ctx: CanvasRenderingContext2D, d: TelegraphDiagram, top: number): void {
  const m = TEXT.SMALL;
  const lh = lineH(m);
  let y = top + 2;
  const note = sizeNote(d.shape);
  const safe = d.safe === "" ? NO_SHAPE_NOTE : `${SAFE_LABEL}: ${d.safe}${note === null ? "" : `　${note}`}`;
  drawText(ctx, safe, STAGE.x, y, m, COLOR_SAFE, "left", "top");
  y += lh;
  drawText(ctx, PARRY_NOTE, STAGE.x, y, m, COLOR_DIM, "left", "top");
  y += lh;
  d.threats?.forEach((band, i) => {
    drawText(ctx, `段階 ${i + 1}: ${THREAT_LABEL[band]}`, STAGE.x, y, m, COLOR_TEXT, "left", "top");
    y += lh;
  });
}

/**
 * 予告の図解を描く。sprite は敵の絵（無ければ当たりの円）。ctx は論理座標（480x270）
 */
export function drawTelegraphDiagram(ctx: CanvasRenderingContext2D, def: EnemyDef, diagram: TelegraphDiagram, sprite?: Sprite): void {
  ctx.fillStyle = COLOR_BG;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  drawText(ctx, `${def.name}　${TITLE_SUFFIX}`, VIEW_W / 2, TITLE_Y, TEXT.TITLE, COLOR_TITLE, "center", "middle");
  ctx.fillStyle = COLOR_PANEL;
  ctx.fillRect(STAGE.x, STAGE.y, STAGE.w, STAGE.h);
  const k = scaleFor(extentOf(diagram.shape, def.radius));
  drawShape(ctx, diagram.shape, def.radius, k);
  drawEnemy(ctx, sprite, def.radius, def.color);
  const below = drawTimeBar(ctx, diagram);
  drawNotes(ctx, diagram, below);
  drawText(ctx, HINT, VIEW_W / 2, HINT_Y, TEXT.SMALL, COLOR_DIM, "center", "middle");
}
