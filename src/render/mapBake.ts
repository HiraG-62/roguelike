// チャンクの焼き付け（docs/ideas/map-visual-impl.md 1-2・1-5・1-6 節）。
// 16x16 マス = 512x512 ドットを、地図とテーマだけから決まる画素列に焼く純関数。
// 絵は座標と theme.key だけで決まり、チャンクの割り方・step の刻み方で変わらない（継ぎ目が一致する）。
// 作業は 2 段: 準備（壁 S と穴 Q の形・列ごとの連なりを下から上へ）→ 塗り（上から下へ 1 行ずつ）。
// step(rows) の 1 単位は「塗り 1 行」か「準備 PREP_ROWS_PER_UNIT 行」で、どちらも時間ではなく行で区切る。
import type { GameMap } from "../map/grid";
import { Tile } from "../map/grid";
import { EDGE_PERIOD, buildVertexDepth, cornerShapeBits, sampleDepth, type VertexDepth } from "./dualGrid";
import { Lattice, cliffTex, createTexContext, floorTex, pitTex, sideTex, topTex, voidTex, type TexContext } from "./mapTextures";
import { mixColor } from "./mapTheme";
import {
  CHUNK_DOTS,
  LIP_DOTS,
  LIP_TOP_DOTS,
  TILE_DOTS,
  type BakeOutput,
  type ChunkBakeInput,
  type ChunkBakeJob,
  type MapTheme,
} from "./mapTypes";

// 焼く範囲の余白（ドット）。S / Q・連なり・影の参照が隣のチャンクへはみ出す分
const MARGIN_L = 8;
const MARGIN_R = 8;
/** 上: 穴の北の崖 24 ドットを数え始められる分 */
const MARGIN_T = 32;
/** 下: 側面の高さ + 縁の参照 */
const MARGIN_B_EXTRA = 8;

/** 準備 1 行ぶんの重さは塗り 1 行より軽いので、1 単位で進める準備の行数 */
const PREP_ROWS_PER_UNIT = 8;
/** 連なりの上限（側面の高さ 32 + 1、床から壁までの距離 7 を同じ配列に持つ） */
const RUN_CAP = 40;
/** 岩盤の闇の段（マス）。見本の 44 / 54 / 64 ドットを TILE_DOTS=32 で割った値 */
const TOP_DEPTH = 1.375;
const V1_DEPTH = 1.6875;
const V2_DEPTH = 2;
/** 章 4・深みは床から 1.5 マスまでが崖の上端、その奥が奈落 */
const VOID_BEYOND_DEPTH = 1.5;
/** 奈落の手前の天面の縁の柔らかい帯の始まり（マス） */
const VOID_SOFT_DEPTH = 1.25;
/** 北の縁の帯（液体の岸の切り口。論理 3px） */
const NORTH_BANK_DOTS = 6;
/** 奈落の北の崖の高さ */
const CLIFF_DOTS = 24;
/** 穴が深いほど vD へ寄せる量と、その始まり（ドット） */
const DEEPEN_FROM_DOTS = 6;
const DEEPEN_MID_DOTS = TILE_DOTS / 2;
const DEEPEN_FAR_DOTS = TILE_DOTS;
const DEEPEN_MID = 0.24;
const DEEPEN_FAR = 0.42;
/** 床の影: 上の壁から近い順の濃さと範囲 */
const SHADOW_NEAR_DOTS = 3;
const SHADOW_FAR_DOTS = 7;
const SHADOW_NEAR = 0.55;
const SHADOW_FAR = 0.3;
const SHADOW_DROP = 0.25;
const SHADOW_DROP_DX = 5;
const SHADOW_DROP_DY = 7;
const SHADOW_EDGE = 0.5;
/** 「まだ見つかっていない」行（Int16 の下限側） */
const NONE_ROW = -10000;

const KIND_FLOOR = 0;
const KIND_WALL = 1;
const KIND_PIT = 2;

/** 焼く長方形（ワールドのドット）。チャンクは 512x512 の特別な場合。継ぎ目の検査のため任意の大きさも焼ける */
export interface RectBakeInput {
  map: GameMap;
  theme: MapTheme;
  x: number;
  y: number;
  w: number;
  h: number;
  depth?: VertexDepth;
}

interface BakeState {
  map: GameMap;
  /** 出力の長方形の左上（ワールドのドット）と大きさ */
  outW: number;
  outH: number;
  theme: MapTheme;
  tc: TexContext;
  depth: VertexDepth;
  edge: Lattice;
  /** 範囲の左上（ワールドのドット）と大きさ */
  x0: number;
  y0: number;
  rw: number;
  rh: number;
  /** マスの分類（床 / 壁 / 穴）の範囲。範囲に掛かるマスの 1 周外まで持つ */
  kindX0: number;
  kindY0: number;
  kindW: number;
  kinds: Uint8Array;
  hasPit: boolean;
  buf: WorkBuffers;
  /** 壁の形 S と穴の形 Q（rw * rh） */
  wall: Uint8Array;
  pit: Uint8Array;
  /** 壁ドットは下へ続く壁のドット数、それ以外は下の壁までのドット数（上限 RUN_CAP） */
  run: Uint8Array;
  /** 準備の次の行（下から上へ。-1 で完了） */
  prepRow: number;
  /** 塗りの次の行（出力の行 0..outH） */
  paintRow: number;
  /** 列ごとに「上のいちばん近い壁 / 壁でない / 穴でない」ドットの範囲の行 */
  lastWall: Int16Array;
  lastOpen: Int16Array;
  lastNonPit: Int16Array;
}

/** 準備の作業用の配列。焼き終えたら返して次のチャンクで使い回す（毎回 1MiB 超を割り当てて GC に負けないため） */
interface WorkBuffers {
  wall: Uint8Array;
  pit: Uint8Array;
  run: Uint8Array;
  lastWall: Int16Array;
  lastOpen: Int16Array;
  lastNonPit: Int16Array;
}

/** 返された配列の置き場の上限（同時に焼くチャンクは数枚） */
const POOL_MAX = 4;
const bufferPool: WorkBuffers[] = [];

function acquireBuffers(size: number, rw: number): WorkBuffers {
  const index = bufferPool.findIndex((b) => b.wall.length === size && b.lastWall.length === rw);
  const found = index >= 0 ? bufferPool.splice(index, 1)[0] : undefined;
  const buf =
    found ??
    ({
      wall: new Uint8Array(size),
      pit: new Uint8Array(size),
      run: new Uint8Array(size),
      lastWall: new Int16Array(rw),
      lastOpen: new Int16Array(rw),
      lastNonPit: new Int16Array(rw),
    } satisfies WorkBuffers);
  // wall / run は準備が全行を書き直す。穴が無い地図では pit を書かないので、前の使用の残りを消す
  buf.pit.fill(0);
  buf.lastWall.fill(NONE_ROW);
  buf.lastOpen.fill(NONE_ROW);
  buf.lastNonPit.fill(NONE_ROW);
  return buf;
}

function releaseBuffers(buf: WorkBuffers): void {
  if (bufferPool.length < POOL_MAX) bufferPool.push(buf);
}

function floorDiv(a: number, b: number): number {
  return Math.floor(a / b);
}

function kindOfTile(map: GameMap, tx: number, ty: number): number {
  if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) return KIND_WALL;
  const tile = map.tiles[ty * map.width + tx];
  if (tile === Tile.Wall) return KIND_WALL;
  return tile === Tile.Pit ? KIND_PIT : KIND_FLOOR;
}

function createState(input: RectBakeInput): BakeState {
  const { map, theme } = input;
  const rw = input.w + MARGIN_L + MARGIN_R;
  const rh = MARGIN_T + input.h + theme.sideH + MARGIN_B_EXTRA;
  const x0 = input.x - MARGIN_L;
  const y0 = input.y - MARGIN_T;
  const tc = createTexContext(theme, x0, y0, rw, rh);
  const kindX0 = floorDiv(x0, TILE_DOTS) - 1;
  const kindY0 = floorDiv(y0, TILE_DOTS) - 1;
  const kindW = floorDiv(x0 + rw - 1, TILE_DOTS) + 1 - kindX0 + 1;
  const kindH = floorDiv(y0 + rh - 1, TILE_DOTS) + 1 - kindY0 + 1;
  const kinds = new Uint8Array(kindW * kindH);
  let hasPit = false;
  for (let j = 0; j < kindH; j++) {
    for (let i = 0; i < kindW; i++) {
      const kind = kindOfTile(map, kindX0 + i, kindY0 + j);
      kinds[j * kindW + i] = kind;
      if (kind === KIND_PIT) hasPit = true;
    }
  }
  const buf = acquireBuffers(rw * rh, rw);
  return {
    map,
    outW: input.w,
    outH: input.h,
    theme,
    tc,
    depth: input.depth ?? buildVertexDepth(map),
    edge: new Lattice(EDGE_PERIOD, tc.seed + 1, x0, y0, x0 + rw, y0 + rh),
    x0,
    y0,
    rw,
    rh,
    kindX0,
    kindY0,
    kindW,
    kinds,
    hasPit,
    buf,
    wall: buf.wall,
    pit: buf.pit,
    run: buf.run,
    prepRow: rh - 1,
    paintRow: 0,
    lastWall: buf.lastWall,
    lastOpen: buf.lastOpen,
    lastNonPit: buf.lastNonPit,
  };
}

function kindAt(st: BakeState, tx: number, ty: number): number {
  return st.kinds[(ty - st.kindY0) * st.kindW + (tx - st.kindX0)] ?? KIND_WALL;
}

// ---------------------------------------------------------------------------
// 準備: 形と連なり（下から上へ）
// ---------------------------------------------------------------------------

/**
 * 範囲の 1 行ぶんの壁 S と穴 Q を作る。
 * Q は「壁または穴」の合併の形から S を引いたもの。同じ半径・揺らぎ・種で作るので、壁と穴が接する所に隙間も食い込みも出ない
 * （穴どうし・床との境の形は壁と同じ規則で決まる）
 */
function computeMaskRow(st: BakeState, j: number): void {
  const { theme, rw } = st;
  const wy = st.y0 + j;
  const ty = floorDiv(wy, TILE_DOTS);
  const ly = wy - ty * TILE_DOTS;
  const sy = ly < TILE_DOTS / 2 ? -1 : 1;
  const chamfer = theme.corner === "chamfer";
  const R = theme.cornerR;
  const amp = theme.edgeNoise;
  const base = j * rw;
  let i = 0;
  while (i < rw) {
    const wx = st.x0 + i;
    const tx = floorDiv(wx, TILE_DOTS);
    const lx = wx - tx * TILE_DOTS;
    const sx = lx < TILE_DOTS / 2 ? -1 : 1;
    const count = Math.min(rw - i, (sx < 0 ? TILE_DOTS / 2 : TILE_DOTS) - lx);
    const own = kindAt(st, tx, ty);
    const hN = kindAt(st, tx + sx, ty);
    const vN = kindAt(st, tx, ty + sy);
    const wallOwn = own === KIND_WALL;
    const wallH = hN === KIND_WALL;
    const wallV = vN === KIND_WALL;
    const unionOwn = own !== KIND_FLOOR;
    const unionH = hN !== KIND_FLOOR;
    const unionV = vN !== KIND_FLOOR;
    const wallUniform = wallOwn === wallH && wallH === wallV;
    const unionUniform = !st.hasPit || (unionOwn === unionH && unionH === unionV);
    if (wallUniform && unionUniform) {
      const w = wallOwn ? 1 : 0;
      st.wall.fill(w, base + i, base + i + count);
      st.pit.fill(st.hasPit && unionOwn && !wallOwn ? 1 : 0, base + i, base + i + count);
      i += count;
      continue;
    }
    for (let m = 0; m < count; m++) {
      const dx = wx + m;
      const e = amp === 0 ? 0 : Math.round((st.edge.at(dx, wy) - 0.5) * 2 * amp);
      const s = wallUniform ? (wallOwn ? 1 : 0) : cornerShapeBits(wallOwn, wallH, wallV, lx + m, ly, R, chamfer, e);
      st.wall[base + i + m] = s;
      if (!st.hasPit) continue;
      const u = unionUniform ? (unionOwn ? 1 : 0) : cornerShapeBits(unionOwn, unionH, unionV, lx + m, ly, R, chamfer, e);
      st.pit[base + i + m] = u === 1 && s === 0 ? 1 : 0;
    }
    i += count;
  }
}

/** 1 行ぶんの連なり（run）。下の行が先にできている前提 */
function computeRunRow(st: BakeState, j: number): void {
  const { rw, rh, wall, run } = st;
  const base = j * rw;
  const hasBelow = j + 1 < rh;
  for (let i = 0; i < rw; i++) {
    const k = base + i;
    const below = hasBelow ? (run[k + rw] ?? 0) : 0;
    const belowWall = hasBelow && wall[k + rw] === 1;
    if (wall[k] === 1) run[k] = belowWall ? Math.min(RUN_CAP, below + 1) : 1;
    else run[k] = belowWall ? 1 : hasBelow ? Math.min(RUN_CAP, below + 1) : RUN_CAP;
  }
}

function prepareRow(st: BakeState): void {
  const j = st.prepRow;
  computeMaskRow(st, j);
  computeRunRow(st, j);
  st.prepRow = j - 1;
  if (st.prepRow < 0) warmUp(st);
}

/** 塗りの前に、チャンクの上の余白の行で「上の最寄り」を作っておく（上から下へ流す） */
function warmUp(st: BakeState): void {
  for (let j = 0; j < MARGIN_T; j++) trackRow(st, j);
}

/** 行 j の S / Q を「上の最寄り」の記録へ反映する（塗り終えた行を渡す） */
function trackRow(st: BakeState, j: number): void {
  const base = j * st.rw;
  for (let i = 0; i < st.rw; i++) {
    const k = base + i;
    if (st.wall[k] === 1) st.lastWall[i] = j;
    else st.lastOpen[i] = j;
    if (st.pit[k] === 0) st.lastNonPit[i] = j;
  }
}

// ---------------------------------------------------------------------------
// 塗り（上から下へ）
// ---------------------------------------------------------------------------

/** 8 近傍に壁でないドットがあるか（天面の縁の明るい 1 ドット） */
function hasOpenNeighbor8(st: BakeState, k: number): boolean {
  const { wall, rw } = st;
  return (
    wall[k - 1] === 0 ||
    wall[k + 1] === 0 ||
    wall[k - rw] === 0 ||
    wall[k + rw] === 0 ||
    wall[k - rw - 1] === 0 ||
    wall[k - rw + 1] === 0 ||
    wall[k + rw - 1] === 0 ||
    wall[k + rw + 1] === 0
  );
}

/** 4 近傍に壁があるか（床の輪郭） */
function hasWallNeighbor4(st: BakeState, k: number): boolean {
  const { wall, rw } = st;
  return wall[k - 1] === 1 || wall[k + 1] === 1 || wall[k - rw] === 1 || wall[k + rw] === 1;
}

/** 8 近傍に穴でないドットがあるか（穴の縁の 1 ドット） */
function hasNonPitNeighbor8(st: BakeState, k: number): boolean {
  const { pit, rw } = st;
  return (
    pit[k - 1] === 0 ||
    pit[k + 1] === 0 ||
    pit[k - rw] === 0 ||
    pit[k + rw] === 0 ||
    pit[k - rw - 1] === 0 ||
    pit[k - rw + 1] === 0 ||
    pit[k + rw - 1] === 0 ||
    pit[k + rw + 1] === 0
  );
}

function shallowAtDot(map: GameMap, wx: number, wy: number): boolean {
  if (!map.shallow) return false;
  const tx = floorDiv(wx, TILE_DOTS);
  const ty = floorDiv(wy, TILE_DOTS);
  if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) return false;
  return (map.shallow[ty * map.width + tx] ?? 0) > 0;
}

/**
 * 穴の縁の向こう（床側）に浅瀬のマスがあるか。縁の揺らぎで境がマスの内側へずれるので、
 * 縁のドットから揺らぎの幅 + 1 ドット離れた 4 方向のマスを見る。あればその辺の縁を描かない（水が続いて見える）
 */
function touchesShallow(st: BakeState, i: number, j: number): boolean {
  const map = st.map;
  if (!map.shallow) return false;
  const r = st.theme.edgeNoise + 1;
  const wx = st.x0 + i;
  const wy = st.y0 + j;
  return shallowAtDot(map, wx - r, wy) || shallowAtDot(map, wx + r, wy) || shallowAtDot(map, wx, wy - r) || shallowAtDot(map, wx, wy + r);
}

function paintWall(st: BakeState, out: BakeOutput, i: number, j: number, o: number): void {
  const { theme, tc, run } = st;
  const k = j * st.rw + i;
  const wx = st.x0 + i;
  const wy = st.y0 + j;
  const sideH = theme.sideH;
  const below = run[k] ?? 1;
  if (below <= sideH) {
    out.ground[o] = sideTex(tc, wx, wy, sideH - below, sideH);
    return;
  }
  const P = theme.palette;
  const rock = sampleDepth(st.depth, st.depth.rock, wx, wy);
  let c: number;
  if (theme.voidBeyond && rock >= VOID_BEYOND_DEPTH) c = voidTex(tc, wx, wy, (rock - VOID_BEYOND_DEPTH) * TILE_DOTS);
  else if (theme.voidBeyond && rock >= VOID_SOFT_DEPTH) c = P.v1;
  else if (rock < TOP_DEPTH) {
    c = topTex(tc, wx, wy);
    // 縁の明るい 1 ドットと、側面の直前の 2 行
    if (hasOpenNeighbor8(st, k) || below <= sideH + 2) c = P.tL;
  } else c = rock < V1_DEPTH ? P.v1 : rock < V2_DEPTH ? P.v2 : P.vD;
  out.ground[o] = c;
  // 北が床の壁（部屋の南の壁）の天面は体より手前: 縁の層にも積む
  if (j - (st.lastOpen[i] ?? NONE_ROW) <= LIP_TOP_DOTS && (st.lastOpen[i] ?? NONE_ROW) > NONE_ROW) out.lip[o] = c;
}

function paintFloor(st: BakeState, out: BakeOutput, i: number, j: number, o: number): void {
  const { theme, tc, wall, run } = st;
  const P = theme.palette;
  const k = j * st.rw + i;
  const wx = st.x0 + i;
  const wy = st.y0 + j;
  let c = floorTex(tc, wx, wy);
  // 上の壁が落とす影と、右下への落影
  let shade = 0;
  const lw = st.lastWall[i] ?? NONE_ROW;
  if (lw > NONE_ROW && j - lw <= SHADOW_FAR_DOTS) shade = j - lw <= SHADOW_NEAR_DOTS ? SHADOW_NEAR : SHADOW_FAR;
  else if (wall[k - SHADOW_DROP_DY * st.rw - SHADOW_DROP_DX] === 1) shade = SHADOW_DROP;
  if (hasWallNeighbor4(st, k)) shade = Math.max(shade, SHADOW_EDGE);
  if (shade > 0) c = mixColor(c, P.fO, shade);
  out.ground[o] = c;
  // 手前の縁: 下の壁まで LIP_DOTS 以内。最後の 1 ドットは暗い線
  const toWall = run[k] ?? RUN_CAP;
  if (toWall <= LIP_DOTS) out.lip[o] = toWall === LIP_DOTS ? P.fO : P.tL;
}

function paintPit(st: BakeState, out: BakeOutput, i: number, j: number, o: number): void {
  const { theme, tc } = st;
  const P = theme.palette;
  const k = j * st.rw + i;
  const wx = st.x0 + i;
  const wy = st.y0 + j;
  const shoreDots = sampleDepth(st.depth, st.depth.pit, wx, wy) * TILE_DOTS;
  const lastNonPit = st.lastNonPit[i] ?? NONE_ROW;
  // 真上に連なる穴のドット数。上が床なら床の切り口（北の縁）が見える
  const above = j - lastNonPit - 1;
  const floorAbove = lastNonPit > NONE_ROW && st.wall[lastNonPit * st.rw + i] === 0;
  const edge = hasNonPitNeighbor8(st, k);
  if (theme.pit === "abyss") {
    if (floorAbove && above < CLIFF_DOTS) out.ground[o] = cliffTex(tc, wx, above, CLIFF_DOTS);
    else if (edge) out.ground[o] = P.fO;
    else out.ground[o] = voidTex(tc, wx, wy, shoreDots);
    return;
  }
  const nearBank = floorAbove && above < NORTH_BANK_DOTS;
  const map = st.map;
  let shallow = false;
  if (map.shallow && (edge || nearBank)) shallow = (edge && touchesShallow(st, i, j)) || (nearBank && shallowAtDot(map, wx, st.y0 + lastNonPit - theme.edgeNoise - 1));
  const north = nearBank && !shallow;
  const d = edge && !shallow ? 1 : Math.max(2, shoreDots);
  let c = pitTex(tc, wx, wy, d, north);
  // 溶岩は暗くせず割れ目を残す
  if (theme.pit !== "lava" && shoreDots > DEEPEN_FROM_DOTS) {
    const t = shoreDots >= DEEPEN_FAR_DOTS ? DEEPEN_FAR : shoreDots >= DEEPEN_MID_DOTS ? DEEPEN_MID : 0;
    if (t > 0) c = mixColor(c, P.vD, t);
  }
  out.ground[o] = c;
}

function paintRow(st: BakeState, out: BakeOutput): void {
  const r = st.paintRow;
  const j = r + MARGIN_T;
  const base = j * st.rw;
  for (let col = 0; col < st.outW; col++) {
    const i = col + MARGIN_L;
    const o = r * st.outW + col;
    const k = base + i;
    if (st.wall[k] === 1) paintWall(st, out, i, j, o);
    else if (st.pit[k] === 1) paintPit(st, out, i, j, o);
    else paintFloor(st, out, i, j, o);
  }
  trackRow(st, j);
  st.paintRow = r + 1;
}

/** 長方形を焼く job（チャンクの焼き付けの本体）。output の ground / lip は w * h の行優先 */
export function createRectBake(input: RectBakeInput): ChunkBakeJob {
  const size = Math.max(0, input.w) * Math.max(0, input.h);
  const output: BakeOutput = {
    ground: new Uint32Array(size),
    lip: new Uint32Array(size),
    // 置物・側面の蛍苔の光は段 2 の置物のレーン（mapDecor）が足す
    lights: [],
  };
  let state: BakeState | null = null;
  let painted = 0;
  return {
    get done(): boolean {
      return painted >= input.h;
    },
    step(rows: number): void {
      let budget = Math.max(0, Math.floor(rows));
      if (budget === 0 || painted >= input.h) return;
      state ??= createState(input);
      while (budget > 0 && state.prepRow >= 0) {
        const n = Math.min(budget * PREP_ROWS_PER_UNIT, state.prepRow + 1);
        for (let q = 0; q < n; q++) prepareRow(state);
        budget -= Math.ceil(n / PREP_ROWS_PER_UNIT);
      }
      while (budget > 0 && state.prepRow < 0 && state.paintRow < state.outH) {
        paintRow(state, output);
        budget--;
      }
      painted = state.paintRow;
      if (painted >= input.h) {
        releaseBuffers(state.buf);
        state = null;
      }
    },
    result(): BakeOutput {
      return output;
    },
  };
}

/** 1 チャンク（16x16 マス = 512x512 ドット）を焼く job */
export function createChunkBake(input: ChunkBakeInput): ChunkBakeJob {
  return createRectBake({
    map: input.map,
    theme: input.theme,
    x: input.cx * CHUNK_DOTS,
    y: input.cy * CHUNK_DOTS,
    w: CHUNK_DOTS,
    h: CHUNK_DOTS,
    depth: input.depth,
  });
}

