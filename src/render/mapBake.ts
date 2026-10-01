// チャンクの焼き付け（段 0 の仮実装: マスごとの平塗り）。
// 段 1 で中身（形・模様・縁・影・置物）が差し替わる。公開の形（createChunkBake / ChunkBakeJob）は変えない。
import { Tile } from "../map/grid";
import { pack } from "./mapNoise";
import {
  CHUNK_DOTS,
  CHUNK_TILES,
  TILE_DOTS,
  type BakeOutput,
  type ChunkBakeInput,
  type ChunkBakeJob,
  type MapPalette,
  type MapTheme,
} from "./mapTypes";

/** 仮の平塗りで穴に使う色。穴のテーマ色は段 1 で pitTex に置き換わる */
function flatColor(tile: number, palette: MapPalette): number {
  if (tile === Tile.Wall) return palette.tB;
  if (tile === Tile.Pit) return palette.vD;
  return palette.fB;
}

/** 地図の外は壁として扱う（1-2 節） */
function tileAt(input: ChunkBakeInput, tx: number, ty: number): number {
  const { map } = input;
  if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) return Tile.Wall;
  return map.tiles[ty * map.width + tx] ?? Tile.Wall;
}

/**
 * 1 ドット行ぶんを平塗りする。行は互いに独立なので、step の刻み方で結果は変わらない。
 */
function fillRow(ground: Uint32Array, input: ChunkBakeInput, row: number): void {
  const ty = input.cy * CHUNK_TILES + Math.floor(row / TILE_DOTS);
  const base = row * CHUNK_DOTS;
  for (let tx = 0; tx < CHUNK_TILES; tx++) {
    const color = flatColor(tileAt(input, input.cx * CHUNK_TILES + tx, ty), input.theme.palette);
    const start = base + tx * TILE_DOTS;
    ground.fill(color, start, start + TILE_DOTS);
  }
}

export function createChunkBake(input: ChunkBakeInput): ChunkBakeJob {
  const output: BakeOutput = {
    ground: new Uint32Array(CHUNK_DOTS * CHUNK_DOTS),
    // lip は全 0（透明）、lights は空。段 1・段 2 で中身が入る
    lip: new Uint32Array(CHUNK_DOTS * CHUNK_DOTS),
    lights: [],
  };
  let row = 0;
  return {
    get done(): boolean {
      return row >= CHUNK_DOTS;
    },
    step(rows: number): void {
      const end = Math.min(CHUNK_DOTS, row + Math.max(0, Math.floor(rows)));
      while (row < end) {
        fillRow(output.ground, input, row);
        row++;
      }
    },
    result(): BakeOutput {
      return output;
    },
  };
}

// ---------------------------------------------------------------------------
// 仮のテーマ（段 1 の `mapThemeFor` が入るまで結線側が使う）
// ---------------------------------------------------------------------------

function unpack(c: number): [number, number, number] {
  return [c & 255, (c >>> 8) & 255, (c >>> 16) & 255];
}

function mixColor(a: number, b: number, t: number): number {
  const [ar, ag, ab] = unpack(a);
  const [br, bg, bb] = unpack(b);
  return pack(
    Math.round(ar + (br - ar) * t),
    Math.round(ag + (bg - ag) * t),
    Math.round(ab + (bb - ab) * t),
  );
}

function hexColor(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return pack((n >> 16) & 255, (n >> 8) & 255, n & 255);
}

const WHITE = pack(255, 255, 255);
const BLACK = pack(0, 0, 0);

/** 章 1（苔の洞）の配色で作る仮のテーマ。派生色の計算は見本の derivePalette と同じ */
export function placeholderTheme(): MapTheme {
  const fD = hexColor("#2f3530");
  const fB = hexColor("#3d4540");
  const fL = hexColor("#4d5a4c");
  const top = hexColor("#56604a");
  const side = hexColor("#262b25");
  const light = hexColor("#c8e878");
  const accent = hexColor("#4a8cb0");
  const vD = mixColor(side, BLACK, 0.62);
  const palette: MapPalette = {
    fD,
    fB,
    fL,
    fH: mixColor(fL, WHITE, 0.07),
    fO: mixColor(fD, hexColor("#0c0b10"), 0.55),
    tB: top,
    tD: mixColor(top, side, 0.5),
    tL: mixColor(top, WHITE, 0.13),
    sB: side,
    sL: mixColor(side, top, 0.42),
    sD: mixColor(side, BLACK, 0.35),
    v1: mixColor(top, vD, 0.42),
    v2: mixColor(top, vD, 0.74),
    vD,
    light,
    lightDim: mixColor(light, vD, 0.5),
    accent,
    accL: mixColor(accent, WHITE, 0.25),
    accD: mixColor(accent, BLACK, 0.35),
    moss1: hexColor("#4a6238"),
    moss2: hexColor("#65823f"),
    wood: hexColor("#5a4632"),
    soot: hexColor("#150d0a"),
    snow: hexColor("#d4e2f0"),
    stoneL: mixColor(top, fL, 0.3),
    stoneB: mixColor(top, side, 0.25),
    stoneD: mixColor(top, side, 0.65),
  };
  return {
    key: "placeholder",
    style: "moss",
    floor: "cobble",
    top: "rock",
    side: "rockside",
    corner: "round",
    cornerR: 16,
    sideH: 16,
    edgeNoise: 3,
    voidBeyond: false,
    dark: 0,
    palette,
    pit: "water",
    props: [],
    decals: [],
    flags: {
      drips: false,
      soot: false,
      frost: false,
      sideMoss: false,
      shimenawa: false,
      redPillar: false,
      beams: false,
      banners: false,
      icicles: false,
      shafts: false,
    },
  };
}
