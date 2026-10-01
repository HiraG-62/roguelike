/**
 * 階の型「中庭・寺院」（court）。軸に沿って 門（開始）→ 参道 → 中庭（列柱の回廊）→ 本堂（主の間）を並べ、
 * 中庭の外に脇の間（8 割は左右が鏡写し）、外回りの廊下と本堂への裏道でループを作る。
 * 見本（docs/ideas/previews/map-preview.html の genCourtyard）の移植で、拡縮は docs/ideas/map-gen-impl.md 2-4:
 * 軸方向の長さは unit 倍、横方向の幅は unit と「地図の幅に見本を合わせる倍率」の中間、個数は countMul 倍。
 * 部屋（門・中庭・脇の間・本堂）は出来上がりの床から所属タイルを集めて渡す（柱・池・岩は部屋のタイルに入らない）。
 * 雑音は使わないので noiseSeed は読まない。乱数は引数の rng だけ
 */
import type { Rng } from "../../core/rng";
import { MAP_LAYOUT } from "../../data/tuning";
import { type Grid, connectAll, isInner, makeGrid } from "./shapes";
import { Cell, type LayoutDraft, type LayoutFrame, type LayoutGenerator, type LayoutNode } from "./types";

const P = MAP_LAYOUT.court;

/** 見本（64x40）での横方向の半幅。軸が横なら H / 2 - 1 = 19、縦なら W / 2 - 1 = 31 */
const SAMPLE_HALF_HORIZONTAL = 19;
const SAMPLE_HALF_VERTICAL = 31;
/** 軸の向きを反転する確率（開始が軸のどちら端か） */
const FLIP_CHANCE = 0.5;
/** 回廊の柱の列が、中庭の端から内側へ何マスの所にあるか */
const COLONNADE_INSET = 2;
/** 中庭の半幅 w の外側にある回廊の床の幅（w + これ までが床。柱は w の位置） */
const CLOISTER_OUTER = 3;
/** 回廊の柱の間隔（体の大きさで決まるので拡縮しない。2 = 1 つおき） */
const COLONNADE_STEP = 2;
/** 柱が置かれない入口の幅（軸から片側。参道の幅と同じにして必ず通れる） */
const COLONNADE_GAP = 2;
/** 池の縁の余裕（楕円の式の右辺） */
const POND_EDGE = 1.05;
/** 岩の半径 */
const ROCK_RADIUS = 1.3;
/** 脇の間と回廊・外回りの廊下をつなぐ戸口の幅（タイル） */
const DOOR_WIDTH = 2;
/** 外回りの廊下の幅（タイル） */
const OUTER_CORRIDOR_WIDTH = 2;
/** 本堂の手前の参道の長さ（中庭の終わりからのタイル） */
const HALL_APPROACH = 2;
/** 本堂の柱の間隔（軸方向） */
const HALL_PILLAR_STEP = 3;
/** 中庭どうしをつなぐ首の長さ */
const NECK_LENGTH = 1;
/** 中庭 1 つの軸方向の長さの下限（これ未満しか取れないなら作らない） */
const MIN_COURT_LENGTH = 24;
/** 脇の間の最小の寸法（軸方向）。これ未満は作らない */
const MIN_SIDE_ROOM_LENGTH = 4;
/** 脇の間の奥行きの下限。これ未満しか取れないなら脇の間は作らない */
const MIN_SIDE_ROOM_DEPTH = 6;
/** 脇の間の奥行きが 1 小さくなる確率（外壁をそろえすぎない） */
const SIDE_ROOM_SHORT_CHANCE = 0.3;
/** 脇の間の奥行きから引く乱数の幅（地図の端との余裕。0 以上これ未満） */
const SIDE_ROOM_MARGIN_SPAN = 4;
/** 横方向の半幅の下限（これ未満の地図は作らない） */
const MIN_HALF = 14;
/** 軸の長さの下限 */
const MIN_AXIS = 50;
/** 中庭の半幅の下限（これ未満になる狭い地図は作らない） */
const MIN_COURT_HALF = 3;
/** 中庭の半幅の上限 = 横方向の半幅 - これ（脇の間と外回りの廊下の分を残す） */
const COURT_HALF_RESERVE = 9;
/** 本堂の半幅の上限 = 横方向の半幅 - これ */
const HALL_HALF_RESERVE = 2;
/** 裏道の幅 */
const BACK_ROAD_WIDTH = 2;

/** 軸座標（u = 軸方向、v = 横方向。v は -half..half-1 で、v と -1-v が鏡写し）の矩形。v は半開区間 */
interface AxisRect {
  u0: number;
  u1: number;
  v0: number;
  v1: number;
}

/** 脇の間（片側分）。外回りの廊下と裏道が使う */
interface SideRoom {
  r0: number;
  r1: number;
  /** 奥行きの範囲（片側の正の v。半開区間） */
  v0: number;
  v1: number;
}

interface AxisGrid {
  grid: Grid;
  /** 軸の長さ（タイル） */
  length: number;
  /** 横方向の半幅（タイル） */
  half: number;
  set(u: number, v: number, cell: Cell): void;
  fill(u0: number, u1: number, v0: number, v1: number, cell: Cell, mirror?: boolean): void;
  floorTiles(rect: AxisRect): number[];
  centerOf(rect: AxisRect): { x: number; y: number };
}

/** 軸座標 (u, v) を地図のマスへ写す格子。vert = 軸が縦、flip = 軸を反転（開始が反対の端） */
function createAxisGrid(width: number, height: number, vert: boolean, flip: boolean): AxisGrid {
  const grid = makeGrid(width, height, Cell.Wall);
  const cx = Math.floor(width / 2);
  const cy = Math.floor(height / 2);
  const length = (vert ? height : width) - 2;
  const half = Math.floor((vert ? width : height) / 2) - 1;
  const point = (u: number, v: number): { x: number; y: number } => {
    const uu = flip ? length - 1 - u : u;
    return vert ? { x: cx + v, y: height - 2 - uu } : { x: 1 + uu, y: cy + v };
  };
  const tileOf = (u: number, v: number): number => {
    const p = point(u, v);
    return isInner(grid, p.x, p.y) ? p.y * width + p.x : -1;
  };
  const set = (u: number, v: number, cell: Cell): void => {
    const t = tileOf(u, v);
    if (t >= 0) grid.cells[t] = cell;
  };
  const fill = (u0: number, u1: number, v0: number, v1: number, cell: Cell, mirror = false): void => {
    for (let u = Math.floor(u0); u < u1; u++) {
      for (let v = Math.floor(v0); v < v1; v++) {
        set(u, v, cell);
        if (mirror) set(u, -1 - v, cell);
      }
    }
  };
  const floorTiles = (r: AxisRect): number[] => {
    const out: number[] = [];
    for (let u = r.u0; u < r.u1; u++) {
      for (let v = r.v0; v < r.v1; v++) {
        const t = tileOf(u, v);
        if (t >= 0 && grid.cells[t] === Cell.Floor) out.push(t);
      }
    }
    return out;
  };
  const centerOf = (r: AxisRect): { x: number; y: number } => {
    const p = point((r.u0 + r.u1) / 2, (r.v0 + r.v1) / 2);
    return { x: p.x + 0.5, y: p.y + 0.5 };
  };
  return { grid, length, half, set, fill, floorTiles, centerOf };
}

/** 片側（side > 0 なら +v、< 0 なら鏡の側 -1-v）の奥行き [v0, v1) を、符号つきの半開区間にする */
function signedRange(side: number, v0: number, v1: number): [number, number] {
  return side < 0 ? [-v1, -v0] : [v0, v1];
}

/** 倍率と共通の道具を持った作業台 */
interface Bench {
  rng: Rng;
  ax: AxisGrid;
  frame: LayoutFrame;
  vert: boolean;
  /** 軸方向の長さを拡縮する */
  sa: (n: number) => number;
  /** 横方向の幅を拡縮する */
  sl: (n: number) => number;
  rooms: { role: LayoutNode["role"]; rect: AxisRect }[];
}

export const generateCourt: LayoutGenerator = (rng, frame) => {
  const vert = rng.chance(P.verticalChance);
  const flip = rng.chance(FLIP_CHANCE);
  const ax = createAxisGrid(frame.width, frame.height, vert, flip);
  if (ax.half < MIN_HALF || ax.length < MIN_AXIS) return null;

  const sampleHalf = vert ? SAMPLE_HALF_VERTICAL : SAMPLE_HALF_HORIZONTAL;
  const lateral = frame.unit ** (1 - P.lateralBlend) * (ax.half / sampleHalf) ** P.lateralBlend;
  const bench: Bench = {
    rng,
    ax,
    frame,
    vert,
    sa: (n) => Math.max(1, Math.round(n * frame.unit)),
    sl: (n) => Math.max(1, Math.round(n * lateral)),
    rooms: [],
  };

  const gateEnd = carveGate(bench);
  const approachEnd = carveApproach(bench, gateEnd);
  const hallLength = bench.sa(vert ? P.hallLengthV + rng.int(0, P.hallLengthSpanV - 1) : P.hallLengthH + rng.int(0, P.hallLengthSpanH - 1));
  const courts = courtCount(bench);
  const avail = ax.length - approachEnd - hallLength - HALL_APPROACH;
  if (avail < courts * MIN_COURT_LENGTH) return null;

  let u = approachEnd;
  let lastHalf = 0;
  let lastSideRooms: SideRoom[] = [];
  for (let c = 0; c < courts; c++) {
    const len = Math.floor(avail / courts) - (c < courts - 1 ? NECK_LENGTH : 0);
    const built = carveCourtyard(bench, u, u + len);
    if (!built) return null;
    lastHalf = built.half;
    lastSideRooms = built.sideRooms;
    u += len;
    if (c < courts - 1) {
      ax.fill(u - 1, u + 1, 0, P.roadHalf, Cell.Floor, true);
      u += NECK_LENGTH;
    }
  }
  const hall = carveHall(bench, u, lastHalf);
  if (rng.chance(P.backRoadChance)) carveBackRoad(bench, lastSideRooms, hall);

  connectAll(ax.grid, P.minKeep);
  return draftOf(bench);
};

/** 門（開始の間）。u = 1 から。戻り値は門の終わりの u */
function carveGate(b: Bench): number {
  const length = b.sa(P.gateLength);
  const half = Math.min(b.sl(P.gateHalfMin + b.rng.int(0, P.gateHalfSpan - 1)), b.ax.half - 2);
  b.ax.fill(1, 1 + length, 0, half, Cell.Floor, true);
  b.rooms.push({ role: "start", rect: { u0: 1, u1: 1 + length, v0: -half, v1: half } });
  return 1 + length;
}

/** 門から中庭への参道（幅は据え置き） */
function carveApproach(b: Bench, from: number): number {
  const length = b.sa(P.approachMin + b.rng.int(0, P.approachSpan - 1));
  b.ax.fill(from, from + length, 0, P.roadHalf, Cell.Floor, true);
  return from + length;
}

/** 中庭の数: 軸の長さ ÷ (axisPerCourt × unit)。小数部は確率で切り上げ */
function courtCount(b: Bench): number {
  const ratio = b.ax.length / (P.axisPerCourt * b.frame.unit);
  const base = Math.floor(ratio);
  return Math.max(1, base + (b.rng.next() < ratio - base ? 1 : 0));
}

interface BuiltCourt {
  half: number;
  sideRooms: SideRoom[];
}

/** 中庭 1 つ（軸方向 [a, b)）: 回廊 → 列柱 → 飾り → 脇の間と外回りの廊下 */
function carveCourtyard(b: Bench, a: number, end: number): BuiltCourt | null {
  const { rng, ax } = b;
  const len = end - a;
  const maxHalf = ax.half - COURT_HALF_RESERVE;
  const baseHalf = b.vert ? P.courtHalfV + rng.int(0, P.courtHalfSpanV - 1) : P.courtHalfH + rng.int(0, P.courtHalfSpanH - 1);
  const w = Math.min(maxHalf, b.sl(baseHalf));
  if (w < MIN_COURT_HALF) return null;

  ax.fill(a, end, 0, w + CLOISTER_OUTER, Cell.Floor, true);
  placeColonnade(ax, a, end, w);
  placeFeature(b, a, end, w);
  b.rooms.push({ role: "room", rect: { u0: a, u1: end, v0: -(w + CLOISTER_OUTER), v1: w + CLOISTER_OUTER } });
  return { half: w, sideRooms: carveSideRooms(b, a, end, w, len) };
}

/** 回廊の柱: 中庭の縁（手前・奥・横）を 1 つおきに。入口（軸の近く）は柱を置かない */
function placeColonnade(ax: AxisGrid, a: number, end: number, w: number): void {
  for (let u = a + COLONNADE_INSET; u < end - COLONNADE_INSET; u++) {
    for (let v = 0; v < w + 1; v++) {
      const onEnd = u === a + COLONNADE_INSET || u === end - COLONNADE_INSET - 1;
      if (!onEnd && v !== w) continue;
      const k = onEnd ? v : u - a;
      if (k % COLONNADE_STEP !== 0) continue;
      if (onEnd && v < COLONNADE_GAP) continue;
      ax.set(u, v, Cell.Wall);
      ax.set(u, -1 - v, Cell.Wall);
    }
  }
}

/** 中庭の飾り: 池（穴 + 石橋）/ 石庭（岩）/ 四本柱 */
function placeFeature(b: Bench, a: number, end: number, w: number): void {
  const { rng, ax } = b;
  const len = end - a;
  const mu = (a + end) / 2;
  const feat = rng.next();
  if (feat < P.pondChance) {
    placePond(b, a, end, w);
    return;
  }
  if (feat < P.pondChance + P.rockChance) {
    const rocks = Math.max(1, Math.round(P.rockCount * b.frame.countMul));
    for (let k = 0; k < rocks; k++) {
      const ru = mu + (rng.next() - 0.5) * (len - 10);
      const rv = 1.5 + rng.next() * (w - 3);
      placeRock(ax, ru, rv);
    }
    return;
  }
  for (const du of [-1, 1]) {
    const pu = Math.floor(mu + (du * (len - 8)) / 4);
    ax.fill(pu, pu + 1, Math.floor(w / 2), Math.floor(w / 2) + 1, Cell.Wall, true);
  }
}

function placePond(b: Bench, a: number, end: number, w: number): void {
  const { rng, ax } = b;
  const len = end - a;
  const mu = (a + end) / 2;
  const ph = Math.max(1.5, ((len - 8) / 2 - rng.next() * 1.5) * P.pondFill);
  const pw = Math.max(2, Math.floor((w - 3 - rng.int(0, 1)) * P.pondFill));
  for (let u = Math.ceil(mu - ph); u < mu + ph; u++) {
    for (let v = 0; v < pw; v++) {
      const cu = (u + 0.5 - mu) / ph;
      const cv = (v + 0.5) / pw;
      if (cu * cu + cv * cv >= POND_EDGE) continue;
      ax.set(u, v, Cell.Pit);
      ax.set(u, -1 - v, Cell.Pit);
    }
  }
  // 池を渡る石橋
  if (rng.chance(P.bridgeChance)) ax.fill(Math.floor(mu) - 1, Math.floor(mu) + 1, 0, w, Cell.Floor, true);
}

function placeRock(ax: AxisGrid, ru: number, rv: number): void {
  for (let u = Math.floor(ru - 1); u <= ru + 1; u++) {
    for (let v = Math.floor(rv - 1); v <= rv + 1; v++) {
      const dx = u + 0.5 - ru;
      const dy = v + 0.5 - rv;
      if (Math.sqrt(dx * dx + dy * dy) >= ROCK_RADIUS) continue;
      ax.set(u, v, Cell.Wall);
      ax.set(u, -1 - v, Cell.Wall);
    }
  }
}

/** 回廊の外の脇の間。8 割は左右が鏡写し、残りは左右別々に作る。戻り値は +側（裏道の起点）の脇の間 */
function carveSideRooms(b: Bench, a: number, end: number, w: number, len: number): SideRoom[] {
  const mirrored = b.rng.chance(P.mirrorChance);
  const plus: SideRoom[] = [];
  for (const side of mirrored ? [1] : [1, -1]) {
    const rooms = carveSideRow(b, a, end, w, len, side, mirrored);
    if (side > 0) plus.push(...rooms);
  }
  return plus;
}

/**
 * 片側の脇の間の列。横に余裕があれば外回りの廊下をはさんで外側にもう 1 列（sideRowsMax まで）。
 * 戻り値は最も内側の列（裏道の起点）
 */
function carveSideRow(b: Bench, a: number, end: number, w: number, len: number, side: number, mirrored: boolean): SideRoom[] {
  const { rng, ax } = b;
  const target = (P.sideRoomLength + rng.next() * P.sideRoomLengthSpan) * b.frame.unit;
  const n = Math.max(P.sideRoomsMin, Math.round(len / target));
  let base = w + CLOISTER_OUTER;
  let innermost: SideRoom[] = [];
  for (let row = 0; row < P.sideRowsMax; row++) {
    const v0 = base + 1;
    const depth = Math.min(b.sl(P.sideRoomDepth), ax.half - v0 - 2 - rng.int(0, SIDE_ROOM_MARGIN_SPAN - 1));
    if (depth < MIN_SIDE_ROOM_DEPTH) break;
    const rooms = carveRoomsAt(b, { a, end, n, v0, depth, base, side, mirrored });
    if (row === 0) innermost = rooms;
    if (rooms.length < 2) break;
    const nextBase = Math.max(...rooms.map((r) => r.v1)) + 1 + OUTER_CORRIDOR_WIDTH;
    const another = row + 1 < P.sideRowsMax && ax.half - (nextBase + 1) - 2 >= MIN_SIDE_ROOM_DEPTH;
    if (!another && !rng.chance(P.outerCorridorChance)) break;
    if (!carveOuterCorridor(b, rooms, side, mirrored) || !another) break;
    base = nextBase;
  }
  return innermost;
}

interface RowPlan {
  a: number;
  end: number;
  /** 軸方向の分割数 */
  n: number;
  v0: number;
  depth: number;
  /** 戸口が内側へ向かう先（半開区間の終わり。回廊の縁か、内側の列の外回りの廊下の縁） */
  base: number;
  side: number;
  mirrored: boolean;
}

/** 1 列分の脇の間を掘る。軸方向を n 等分し、端でない部屋は確率で間引く */
function carveRoomsAt(b: Bench, plan: RowPlan): SideRoom[] {
  const { rng } = b;
  const seg = (plan.end - plan.a) / plan.n;
  const rooms: SideRoom[] = [];
  for (let j = 0; j < plan.n; j++) {
    if (plan.n >= 3 && j > 0 && j < plan.n - 1 && rng.chance(P.sideRoomSkipChance)) continue;
    const r0 = Math.floor(plan.a + j * seg) + (j > 0 ? 1 : 0);
    const r1 = j === plan.n - 1 ? plan.end : Math.floor(plan.a + (j + 1) * seg);
    if (r1 - r0 < MIN_SIDE_ROOM_LENGTH) continue;
    const v1 = plan.v0 + plan.depth - (rng.chance(SIDE_ROOM_SHORT_CHANCE) ? 1 : 0);
    const room: SideRoom = { r0, r1, v0: plan.v0, v1 };
    carveSideRoom(b, room, plan.base, plan.side, plan.mirrored);
    rooms.push(room);
  }
  return rooms;
}

/** 脇の間 1 つ（side 側。mirrored ならもう片側にも）と、内側（回廊か内の列の廊下）への戸口。部屋は所属タイルを後で集めるので矩形だけ控える */
function carveSideRoom(b: Bench, room: SideRoom, base: number, side: number, mirrored: boolean): void {
  const { ax } = b;
  const door = Math.floor((room.r0 + room.r1) / 2);
  for (const s of mirrored ? [side, -side] : [side]) {
    const [lo, hi] = signedRange(s, room.v0, room.v1);
    ax.fill(room.r0, room.r1, lo, hi, Cell.Floor);
    const [dlo, dhi] = signedRange(s, base, room.v0);
    ax.fill(door - DOOR_WIDTH + 1, door + 1, dlo, dhi, Cell.Floor);
    b.rooms.push({ role: "room", rect: { u0: room.r0, u1: room.r1, v0: lo, v1: hi } });
  }
}

/** 外回りの廊下: 脇の間の外側を通って隣の部屋どうしをつなぐ（回廊を通らずに行き来できるループ）。掘れたら true */
function carveOuterCorridor(b: Bench, rooms: SideRoom[], side: number, mirrored: boolean): boolean {
  const { ax } = b;
  const first = rooms[0];
  const last = rooms[rooms.length - 1];
  if (!first || !last) return false;
  const row = Math.max(...rooms.map((r) => r.v1)) + 1;
  if (row + OUTER_CORRIDOR_WIDTH >= ax.half) return false;
  const from = Math.floor((first.r0 + first.r1) / 2) - DOOR_WIDTH + 1;
  const to = Math.floor((last.r0 + last.r1) / 2) + 1;
  for (const s of mirrored ? [side, -side] : [side]) {
    const [lo, hi] = signedRange(s, row, row + OUTER_CORRIDOR_WIDTH);
    ax.fill(from, to, lo, hi, Cell.Floor);
    for (const r of rooms) {
      const door = Math.floor((r.r0 + r.r1) / 2);
      const [rlo, rhi] = signedRange(s, r.v1, row);
      ax.fill(door - DOOR_WIDTH + 1, door + 1, rlo, rhi, Cell.Floor);
    }
  }
  return true;
}

/** 本堂（主の間）への参道と本堂。戻り値は本堂の矩形 */
function carveHall(b: Bench, from: number, lastHalf: number): AxisRect {
  const { rng, ax } = b;
  ax.fill(from - 1, from + HALL_APPROACH, 0, P.roadHalf, Cell.Floor, true);
  const start = from + HALL_APPROACH;
  const half = Math.min(ax.half - HALL_HALF_RESERVE, lastHalf + P.hallExtraMin + rng.int(0, P.hallExtraSpan - 1));
  ax.fill(start, ax.length - 1, 0, half, Cell.Floor, true);
  const pillarV = Math.max(2, half - 3);
  for (let u = start + 2; u < ax.length - 3; u += HALL_PILLAR_STEP) ax.fill(u, u + 1, pillarV, pillarV + 1, Cell.Wall, true);
  const rect = { u0: start, u1: ax.length - 1, v0: -half, v1: half };
  b.rooms.push({ role: "lord", rect });
  return rect;
}

/** 裏道: 最後の中庭の脇の間（+側の末尾）から本堂の脇へ抜ける細い道。中庭の回廊を通らずに本堂へ行ける近道 */
function carveBackRoad(b: Bench, sideRooms: SideRoom[], hall: AxisRect): void {
  const room = sideRooms[sideRooms.length - 1];
  if (!room) return;
  const { ax } = b;
  const mid = Math.floor((room.v0 + room.v1) / 2);
  const end = hall.u0 + HALL_APPROACH + BACK_ROAD_WIDTH;
  ax.fill(room.r1 - 1, end + 1, mid - BACK_ROAD_WIDTH + 1, mid + 1, Cell.Floor);
  // 本堂の幅より外を通ってきたら、本堂の側へ折れて入る
  const target = Math.min(mid, hall.v1 - 2);
  ax.fill(end - BACK_ROAD_WIDTH + 1, end + 1, target, mid + 1, Cell.Floor);
}

/** 出来上がりの床から部屋の所属タイルを集めて下書きにする */
function draftOf(b: Bench): LayoutDraft | null {
  const nodes: LayoutNode[] = [];
  for (const room of b.rooms) {
    const tiles = b.ax.floorTiles(room.rect);
    if (tiles.length === 0) {
      if (room.role !== "room") return null;
      continue;
    }
    const c = b.ax.centerOf(room.rect);
    nodes.push({ x: c.x, y: c.y, role: room.role, grow: 0, tiles });
  }
  const { grid } = b.ax;
  return { cells: grid.cells, shallow: new Uint8Array(grid.cells.length), nodes };
}
