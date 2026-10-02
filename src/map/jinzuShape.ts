import type { Vec } from "../core/vec";
import { add, dist, normalize, scale, sub } from "../core/vec";
import type { JinzuPathKind } from "../data/formations";
import type { GameMap } from "./grid";
import { walkLine } from "./pathing";

/**
 * 陣図の画の形（docs/ideas/jinzu-impl.md 2-2 R8）。大将 L から的 P への向き u と、その左の垂線 v の座標で、
 * 隊の重心を始点に 12 点へ刻んだ折れ線を返す純関数（乱数なし）。描く線 = 実際に走る道なので、壁に当たった所で切る。
 * 「陣図には必ず安全地帯を 1 つ」の判定（findSafeSpot）もここに置く（テストと作図の両方が使う）
 */

/** 画 1 本の点の数（始点と終点を含む） */
export const STROKE_POINTS = 12;
/** 左右の無い隊の符号 */
const NO_SIDE = 0;
/** 安全地帯を探す刻み（px）と、1 周の方角の数 */
const SAFE_RADIUS_STEP = 6;
const SAFE_ANGLES = 24;

/** 大将から的を見た座標系。u は L → P の単位ベクトル、v は u の左（画面で見て左）の単位ベクトル */
export interface StrokeFrame {
  origin: Vec;
  target: Vec;
  u: Vec;
  v: Vec;
  /** |LP| */
  d: number;
}

/** 画の形のつまみ（陣形 JSON の pass / beyond と隊の左右） */
export interface StrokeSpec {
  kind: JinzuPathKind;
  /** 左 +1 / 右 −1 / 無し 0。pass に掛ける */
  side: -1 | 0 | 1;
  pass: number;
  beyond: number;
}

/** 大将と的が重なって向きが決まらないときは fallback（陣の向き）を使う */
export function strokeFrame(origin: Vec, target: Vec, fallback: Vec): StrokeFrame {
  const u = normalize(sub(target, origin), fallback);
  return { origin, target, u, v: { x: u.y, y: -u.x }, d: dist(origin, target) };
}

/** 隊の名の左右（Left で +1、Right で −1、他は 0） */
export function squadSide(key: string): -1 | 0 | 1 {
  if (key.endsWith("Left")) return 1;
  if (key.endsWith("Right")) return -1;
  return NO_SIDE;
}

/** フレームの座標 (u, v) を世界の点へ */
function at(frame: StrokeFrame, u: number, v: number): Vec {
  return add(frame.origin, add(scale(frame.u, u), scale(frame.v, v)));
}

/** 的の脇の通る点: 左右のある隊は side × pass、無い隊は符号つきの pass そのまま */
function passPoint(frame: StrokeFrame, spec: StrokeSpec): Vec {
  const lateral = spec.side === NO_SIDE ? spec.pass : spec.pass * spec.side;
  return at(frame, frame.d, lateral);
}

/** 2 次ベジエを STROKE_POINTS 点に刻む */
function bezier(a: Vec, c: Vec, b: Vec): Vec[] {
  const out: Vec[] = [];
  for (let i = 0; i < STROKE_POINTS; i++) {
    const t = i / (STROKE_POINTS - 1);
    const s = 1 - t;
    out.push({ x: s * s * a.x + 2 * s * t * c.x + t * t * b.x, y: s * s * a.y + 2 * s * t * c.y + t * t * b.y });
  }
  return out;
}

/** 始点から通る点を貫いて beyond だけ先へ走る真っすぐな線 */
function straight(start: Vec, through: Vec, beyond: number): Vec[] {
  const dir = normalize(sub(through, start));
  const end = add(through, scale(dir, beyond));
  return bezier(start, scale(add(start, end), 0.5), end);
}

/** 鉤: 的の脇 M を通り、的の後ろ（的から u の向きへ beyond）で閉じる。M が曲線の中ほどを通るよう制御点を取る */
function hook(start: Vec, frame: StrokeFrame, spec: StrokeSpec): Vec[] {
  const through = passPoint(frame, spec);
  const end = add(frame.target, scale(frame.u, spec.beyond));
  const control = sub(scale(through, 2), scale(add(start, end), 0.5));
  return bezier(start, control, end);
}

/** 壁・穴に当たった所で切る（描く線 = 走る道）。始点の次から順に、通れない区間の手前まで残す */
function cutAtWalls(points: Vec[], map: GameMap | null): Vec[] {
  if (!map) return points;
  const out: Vec[] = points.slice(0, 1);
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const p = points[i];
    if (!prev || !p || !walkLine(map, prev, p)) break;
    out.push(p);
  }
  return out;
}

/** 隊の重心 start を始点とする画の点列。切って 2 点に満たなければ空（その画は無し） */
export function strokePoints(spec: StrokeSpec, start: Vec, frame: StrokeFrame, map: GameMap | null = null): Vec[] {
  const raw = spec.kind === "hook" ? hook(start, frame, spec) : straight(start, passPoint(frame, spec), spec.beyond);
  const cut = cutAtWalls(raw, map);
  return cut.length >= 2 ? cut : [];
}

// -----------------------------------------------------------------------------
// 折れ線の測り
// -----------------------------------------------------------------------------

/** 点 p から線分 ab までの距離 */
export function distToSegment(p: Vec, a: Vec, b: Vec): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const len2 = abx * abx + aby * aby;
  const t = len2 <= 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2));
  return Math.hypot(p.x - (a.x + abx * t), p.y - (a.y + aby * t));
}

/** 点 p から折れ線までの距離 */
export function distToPolyline(p: Vec, points: readonly Vec[]): number {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (a && b) best = Math.min(best, distToSegment(p, a, b));
  }
  return best;
}

/** 折れ線の長さ */
export function polylineLength(points: readonly Vec[]): number {
  let sum = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (a && b) sum += dist(a, b);
  }
  return sum;
}

/** 折れ線の始点から割合 f（0..1）進んだ点（筆先・走り終えた所の描画が使う） */
export function pointAtFraction(points: readonly Vec[], f: number): Vec {
  const first = points[0] ?? { x: 0, y: 0 };
  const total = polylineLength(points);
  if (total <= 0 || f <= 0) return { ...first };
  let left = Math.min(1, f) * total;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (!a || !b) continue;
    const seg = dist(a, b);
    if (left <= seg && seg > 0) {
      const t = left / seg;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    left -= seg;
  }
  const last = points[points.length - 1] ?? first;
  return { ...last };
}

// -----------------------------------------------------------------------------
// 安全地帯
// -----------------------------------------------------------------------------

/**
 * 的の近くで、どの画の帯（半幅 bandHalf）にも入らない点を、近い順に探す。reach は構え + 最後の画の秒の間に歩ける距離。
 * ok は通れる点だけに絞る口（bot は walkLine を渡す）。見つからなければ null
 */
export function findSafeSpot(
  strokes: readonly (readonly Vec[])[],
  center: Vec,
  reach: number,
  bandHalf: number,
  ok: (p: Vec) => boolean = () => true,
): Vec | null {
  const clear = (p: Vec): boolean => strokes.every((points) => distToPolyline(p, points) > bandHalf);
  if (clear(center) && ok(center)) return { ...center };
  for (let r = SAFE_RADIUS_STEP; r <= reach; r += SAFE_RADIUS_STEP) {
    for (let k = 0; k < SAFE_ANGLES; k++) {
      const a = (k / SAFE_ANGLES) * Math.PI * 2;
      const p = { x: center.x + Math.cos(a) * r, y: center.y + Math.sin(a) * r };
      if (clear(p) && ok(p)) return p;
    }
  }
  return null;
}

/** 安全地帯が 1 つ以上あるか（作図とテストの共通の判定） */
export function safeSpotExists(strokes: readonly (readonly Vec[])[], center: Vec, reach: number, bandHalf: number): boolean {
  return findSafeSpot(strokes, center, reach, bandHalf) !== null;
}
