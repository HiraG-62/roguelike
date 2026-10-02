/**
 * 階の型「縦穴・段々」（terrace）。横長の段（平行。傾きとうねりは全部の段で共通）を上から順に、端の坂で折り返して降りる。
 * 段の間に細いはしご口（近道）。3 割強は中央に縦穴（穴）が開き、各段が橋で渡る。
 * 1 つの段は chunkWidth × unit 幅ごとの縦の線（1 列。ここが扉になる）で区切り、区切られた塊を部屋にする
 * （docs/ideas/map-gen-impl.md 2-1・4 章「terrace で部屋が足りるか」）。見本は docs/ideas/previews/map-preview.html の genTerrace。
 * 拡縮（2-4）: 段の数は 地図の高さ ÷ (previewHeight × unit) × 3〜5、長さは unit 倍、はしご口の本数は countMul 倍。
 * 道幅（坂・はしご・橋）は据え置き。数値は data/balance/world/MAP_LAYOUT/terrace.json
 */
import type { Rng } from "../../core/rng";
import { MAP_LAYOUT } from "../../data/tuning";
import { type Grid, clamp, connectAll, isInner, line, makeGrid, polyline, sealBorder, vnoise } from "./shapes";
import { Cell, type LayoutDraft, type LayoutFrame, type LayoutGenerator, type LayoutNode } from "./types";

const P = MAP_LAYOUT.terrace;

/** 雑音の種の足し方（frame.noiseSeed に足す。型の中で重ならないように） */
const SEED_TOP = 4;
const SEED_BOTTOM = 5;
const SEED_ROCK = 9;
const SEED_SHAFT_EDGE = 13;
const SEED_SHAFT_WOBBLE = 14;
const SEED_WAVE = 20;
/** 段の縁の雑音の格子の段ごとのずらし（段どうしで縁の揺れが同じにならないように） */
const BAND_NOISE_STRIDE = 7;
const BOTTOM_NOISE_SHIFT = 3;
/** 縦穴の縁の雑音の周期（タイル。細かい揺れなので unit 倍しない） */
const SHAFT_EDGE_PERIOD = 5;
/** 縦穴の曲がりの雑音の周期の基準（タイル。unit 倍） */
const SHAFT_WOBBLE_PERIOD = 12;
/** 縦穴の曲がりを引く雑音の行（x の代わりに固定） */
const SHAFT_WOBBLE_COLUMN = 17;
/** 坂の根元を段の縁から内側へ入れる深さ（タイル） */
const RAMP_DEPTH = 1.2;
/** はしご口を段の縁から内側へ入れる深さ（タイル） */
const LADDER_DEPTH = 1;
/** 段の間隔の計算で地図の上下に空ける縁（タイル） */
const FRAME_MARGIN = 4;
/** 段の振れ幅（うねり + 傾き）の上限 = 段の数 × この値 × unit。振れ幅の分だけ段が細くなる（見本の maxE） */
const SWING_PER_BAND = 1.3;
/** 段の数の下限 */
const MIN_BANDS = 3;

interface Band {
  index: number;
  y0: number;
  xs: number;
  xe: number;
}

interface BandPlan {
  bands: Band[];
  height: number;
  flipX: boolean;
  top(b: Band, x: number): number;
  bottom(b: Band, x: number): number;
}

/** 段を右の端で折り返して降りるか（i 番目の段から i + 1 番目へ）。flipX で全体を左右反転 */
function rampOnRight(index: number, flipX: boolean): boolean {
  return (index % 2 === 0) !== flipX;
}

/** 段の数。地図の高さ ÷ (previewHeight × unit) × (bandsMin + 乱数の整数 roll 0..1 による 0..bandsSpread-1)、3 以上 */
export function terraceBandCount(frame: LayoutFrame, roll: number): number {
  const ratio = frame.height / (MAP_LAYOUT.previewHeight * frame.unit);
  return Math.max(MIN_BANDS, Math.round(ratio * (P.bandsMin + Math.floor(roll * P.bandsSpread))));
}

/** 段の数・高さ・間隔・うねり・傾きを決める。段が細すぎる地図の大きさでは null */
function planBands(rng: Rng, frame: LayoutFrame): BandPlan | null {
  const { width: w, height: h, unit, noiseSeed } = frame;
  const n = terraceBandCount(frame, rng.next());
  const share = P.floorShare + (rng.next() - 0.5) * P.floorShareSpread;
  const amp = (P.waveAmp + rng.next() * P.waveAmpSpread) * unit;
  const waveLen = (P.waveLen + rng.next() * P.waveLenSpread) * unit;
  let slope = (rng.next() - 0.5) * 2 * P.slopeMax;
  const maxSwing = n * SWING_PER_BAND * unit;
  const span = w - 8;
  if (2 * amp + Math.abs(slope) * span > maxSwing) slope = Math.sign(slope) * Math.max(0, (maxSwing - 2 * amp) / span);
  const swing = 2 * amp + Math.abs(slope) * span;
  const flipX = rng.next() < 0.5;

  const usable = h - FRAME_MARGIN - swing;
  const gap = Math.max(P.gapMin, (usable - usable * share) / (n - 1));
  const height = (usable - (n - 1) * gap) / n;
  if (height < P.minBandHeight) return null;

  const bands: Band[] = [];
  for (let i = 0; i < n; i++) {
    const left = Math.round((P.endInset + Math.floor(rng.next() * P.endInsetSpread)) * unit);
    const right = Math.round((P.endInset + Math.floor(rng.next() * P.endInsetSpread)) * unit);
    bands.push({ index: i, y0: FRAME_MARGIN / 2 + swing / 2 + i * (height + gap), xs: left, xe: w - 1 - right });
  }
  // 乱数を使わない座標の関数（雑音で縁を揺らす）。sin は使わずエンジン差を避ける
  const edgePeriod = P.edgePeriod * unit;
  const wave = (x: number): number => amp * 2 * (vnoise(x, 0, waveLen, noiseSeed + SEED_WAVE) - 0.5) + slope * (x - w / 2);
  const top = (b: Band, x: number): number => b.y0 + wave(x) + (vnoise(x, b.index * BAND_NOISE_STRIDE, edgePeriod, noiseSeed + SEED_TOP) - 0.5) * P.edgeNoise;
  const bottom = (b: Band, x: number): number =>
    b.y0 + wave(x) + height + (vnoise(x, b.index * BAND_NOISE_STRIDE + BOTTOM_NOISE_SHIFT, edgePeriod, noiseSeed + SEED_BOTTOM) - 0.5) * P.edgeNoise;
  return { bands, height, flipX, top, bottom };
}

/** 段の床を彫る。端では上下が狭まる（坂の根元が段の端から離れているので通り道は残る） */
function carveBands(g: Grid, plan: BandPlan): void {
  for (const b of plan.bands) {
    for (let x = b.xs; x <= b.xe; x++) {
      const endD = Math.min(x - b.xs, b.xe - x);
      const shrink = endD < P.taperLen ? (P.taperLen - endD) * P.taperStep : 0;
      const yEnd = plan.bottom(b, x) - shrink;
      for (let y = Math.floor(plan.top(b, x) + shrink); y < yEnd; y++) if (isInner(g, x, y)) g.cells[y * g.w + x] = Cell.Floor;
    }
  }
}

/** 段の中の岩（遮蔽物）。段の上下に幅 2 以上の通り道を残す */
function scatterRocks(g: Grid, plan: BandPlan, frame: LayoutFrame): void {
  if (plan.height < P.rockMinBand) return;
  const period = P.rockPeriod * frame.unit;
  const endMargin = Math.round(P.rockEndMargin * frame.unit);
  for (const b of plan.bands) {
    for (let x = b.xs + endMargin; x <= b.xe - endMargin; x++) {
      const yEnd = plan.bottom(b, x) - P.rockMargin;
      for (let y = Math.ceil(plan.top(b, x) + P.rockMargin); y < yEnd; y++) {
        if (vnoise(x, y, period, frame.noiseSeed + SEED_ROCK) > P.rockThreshold) g.cells[y * g.w + x] = Cell.Wall;
      }
    }
  }
}

/** 段の端の坂（折り返して降りる）と、中ほどのはしご口（細い近道。本数は countMul 倍） */
function carveLinks(rng: Rng, g: Grid, plan: BandPlan, frame: LayoutFrame): void {
  const { unit, countMul, width: w } = frame;
  const lo = Math.max(...plan.bands.map((b) => b.xs)) + P.ladderMargin;
  const hi = Math.min(...plan.bands.map((b) => b.xe)) - P.ladderMargin;
  for (let i = 0; i + 1 < plan.bands.length; i++) {
    const a = plan.bands[i];
    const b = plan.bands[i + 1];
    if (!a || !b) continue;
    const right = rampOnRight(i, plan.flipX);
    const inset = (P.rampInset + rng.next() * P.rampInsetSpread) * unit;
    const x0 = right ? Math.min(a.xe, b.xe) - inset : Math.max(a.xs, b.xs) + inset;
    const x1 = x0 + (right ? -P.rampRun : P.rampRun) * unit;
    polyline(
      g,
      [
        { x: x0, y: plan.bottom(a, x0) - RAMP_DEPTH },
        { x: x1, y: plan.top(b, x1) + RAMP_DEPTH },
      ],
      P.rampRadius,
      Cell.Floor,
    );
    const base = rng.next() < P.ladderNoneChance ? 0 : rng.next() < P.ladderOneChance ? 1 : 2;
    const ladders = Math.round(base * countMul);
    for (let l = 0; l < ladders && lo < hi; l++) {
      const lx = clamp(w / 2 + (rng.next() - 0.5) * P.ladderSpan * w, lo, hi);
      line(g, lx, plan.bottom(a, lx) - LADDER_DEPTH, lx, plan.top(b, lx) + LADDER_DEPTH, P.ladderRadius, Cell.Floor);
    }
  }
}

/** 縦穴: 中ほどに上から下まで穴が開き、各段は橋で渡る。穴は縁を雑音で揺らし、上から下へ曲がる */
function carveShaft(rng: Rng, g: Grid, plan: BandPlan, frame: LayoutFrame): void {
  if (!(rng.next() < P.shaftChance)) return;
  const { unit, noiseSeed, width: w } = frame;
  const sx = w / 2 + (rng.next() - 0.5) * P.shaftSpan * w;
  const half = (P.shaftWidth + rng.next() * P.shaftWidthSpread) * unit;
  const wobble = P.shaftWobble * unit;
  const wobblePeriod = SHAFT_WOBBLE_PERIOD * unit;
  const margin = half + wobble + P.shaftEdgeNoise;
  for (let y = 1; y < g.h - 1; y++) {
    const shift = (vnoise(y, SHAFT_WOBBLE_COLUMN, wobblePeriod, noiseSeed + SEED_SHAFT_WOBBLE) - 0.5) * 2 * wobble;
    for (let x = Math.max(1, Math.floor(sx - margin)); x <= Math.min(g.w - 2, Math.ceil(sx + margin)); x++) {
      const reach = half + (vnoise(x, y, SHAFT_EDGE_PERIOD, noiseSeed + SEED_SHAFT_EDGE) - 0.5) * P.shaftEdgeNoise;
      if (Math.abs(x + 0.5 - sx - shift) < reach) g.cells[y * g.w + x] = Cell.Pit;
    }
  }
  const bridge = margin + P.bridgeReach;
  for (const b of plan.bands) {
    const yc = (plan.top(b, sx) + plan.bottom(b, sx)) / 2;
    line(g, sx - bridge, yc, sx + bridge, yc, P.bridgeRadius, Cell.Floor);
  }
}

/** 1 つの段を区切る縦の線の列（x）。chunkWidth × unit 幅ごと。区切りの列は部屋に入れず扉（段の高さぶんの線）にする */
function dividers(b: Band, unit: number): number[] {
  const chunks = Math.max(1, Math.round((b.xe - b.xs + 1) / (P.chunkWidth * unit)));
  const out: number[] = [];
  for (let j = 1; j < chunks; j++) out.push(Math.floor(b.xs + ((b.xe - b.xs) * j) / chunks));
  return out;
}

/** x の列が属する塊の番号（区切りの列そのものは -1） */
function chunkOf(cuts: readonly number[], x: number): number {
  let k = 0;
  for (const c of cuts) {
    if (x === c) return -1;
    if (x > c) k++;
  }
  return k;
}

/** 段の床を塊に分け、塊ごとの部屋のノード（所属タイル付き）を返す。開始 = 最初の段の端、主の間 = 最後の段の奥の端の塊 */
function chunkNodes(g: Grid, plan: BandPlan, frame: LayoutFrame): LayoutNode[] | null {
  const { unit } = frame;
  const claimed = new Uint8Array(g.cells.length);
  const first = plan.bands[0];
  const last = plan.bands[plan.bands.length - 1];
  if (!first || !last) return null;
  const startX = plan.flipX ? first.xe - P.startInset * unit : first.xs + P.startInset * unit;
  const lordX = rampOnRight(plan.bands.length - 2, plan.flipX) ? last.xs + P.lordInset * unit : last.xe - P.lordInset * unit;

  const nodes: LayoutNode[] = [];
  let startNode: LayoutNode | undefined;
  let lordNode: LayoutNode | undefined;
  for (const b of plan.bands) {
    const cuts = dividers(b, unit);
    const tiles: number[][] = Array.from({ length: cuts.length + 1 }, () => []);
    for (let x = b.xs; x <= b.xe; x++) {
      const k = chunkOf(cuts, x);
      if (k < 0) continue;
      const yEnd = plan.bottom(b, x);
      for (let y = Math.floor(plan.top(b, x)); y < yEnd; y++) {
        const i = y * g.w + x;
        if (!isInner(g, x, y) || g.cells[i] !== Cell.Floor || claimed[i]) continue;
        claimed[i] = 1;
        tiles[k]?.push(i);
      }
    }
    const startK = b === first ? chunkOf(cuts, Math.round(startX)) : -2;
    const lordK = b === last ? chunkOf(cuts, Math.round(lordX)) : -2;
    tiles.forEach((mine, k) => {
      if (mine.length === 0) return;
      const mid = ((cuts[k - 1] ?? b.xs) + (cuts[k] ?? b.xe)) / 2;
      const node: LayoutNode = { x: mid, y: (plan.top(b, mid) + plan.bottom(b, mid)) / 2, role: "room", grow: 0, tiles: mine };
      if (k === startK) startNode = node;
      if (k === lordK) lordNode = node;
      nodes.push(node);
    });
  }
  if (!startNode || !lordNode) return null;
  startNode.role = "start";
  lordNode.role = "lord";
  return nodes;
}

export const generateTerrace: LayoutGenerator = (rng, frame) => {
  const plan = planBands(rng, frame);
  if (!plan) return null;
  const g = makeGrid(frame.width, frame.height, Cell.Wall);
  carveBands(g, plan);
  scatterRocks(g, plan, frame);
  carveLinks(rng, g, plan, frame);
  carveShaft(rng, g, plan, frame);
  sealBorder(g);
  connectAll(g, P.minKeep);
  const nodes = chunkNodes(g, plan, frame);
  if (!nodes) return null;
  return { cells: g.cells, shallow: new Uint8Array(frame.width * frame.height), nodes } satisfies LayoutDraft;
};
