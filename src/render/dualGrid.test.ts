import { describe, expect, it } from "vitest";
import { Tile, createMap, toIndex, type GameMap } from "../map/grid";
import {
  DEPTH_CAP,
  buildVertexDepth,
  cornerShape,
  cornerShapeBits,
  edgeJitter,
  isWallOrPitTile,
  isWallTile,
  quadrantSign,
  sampleDepth,
} from "./dualGrid";
import { TILE_DOTS } from "./mapTypes";

const ROUND_R = 16;
const CHAMFER_R = 12;
const LAST = TILE_DOTS - 1;
/** 象限の角（外側）と中心側のドット。右下の象限で見る */
const CORNER = LAST;
const INNER = TILE_DOTS / 2;

describe("dualGrid: 形（cornerShapeBits）", () => {
  // 自分・横の隣・縦の隣の 8 通り × 角の端 / 中心寄りの 2 点 = 16 通りを、丸め（R16）・揺らぎ 0 で網羅する
  const table: { name: string; own: boolean; hN: boolean; vN: boolean; corner: 0 | 1; inner: 0 | 1 }[] = [
    { name: "塗る側の中（隣も塗る）", own: true, hN: true, vN: true, corner: 1, inner: 1 },
    { name: "横だけ塗らない縁", own: true, hN: false, vN: true, corner: 1, inner: 1 },
    { name: "縦だけ塗らない縁", own: true, hN: true, vN: false, corner: 1, inner: 1 },
    { name: "孤立した角（外角。丸める）", own: true, hN: false, vN: false, corner: 0, inner: 1 },
    { name: "塗らない側の中", own: false, hN: false, vN: false, corner: 0, inner: 0 },
    { name: "横の隣だけ塗る（縁の外）", own: false, hN: true, vN: false, corner: 0, inner: 0 },
    { name: "縦の隣だけ塗る（縁の外）", own: false, hN: false, vN: true, corner: 0, inner: 0 },
    { name: "内角（隣が 2 つとも塗る。角を埋める）", own: false, hN: true, vN: true, corner: 1, inner: 0 },
  ];

  it.each(table)("$name", ({ own, hN, vN, corner, inner }) => {
    expect(cornerShapeBits(own, hN, vN, CORNER, CORNER, ROUND_R, false, 0), "角の端").toBe(corner);
    expect(cornerShapeBits(own, hN, vN, INNER, INNER, ROUND_R, false, 0), "中心寄り").toBe(inner);
  });

  it("面取り（45 度）でも外角は角を欠き、内角は角を埋める", () => {
    expect(cornerShapeBits(true, false, false, CORNER, CORNER, CHAMFER_R, true, 0), "外角の端").toBe(0);
    expect(cornerShapeBits(true, false, false, INNER, INNER, CHAMFER_R, true, 0), "外角の中心寄り").toBe(1);
    expect(cornerShapeBits(false, true, true, CORNER, CORNER, CHAMFER_R, true, 0), "内角の端").toBe(1);
    expect(cornerShapeBits(false, true, true, INNER, INNER, CHAMFER_R, true, 0), "内角の中心寄り").toBe(0);
  });

  it("揺らぎ e は縁を e ドット動かす（正で塗る側が縮み、負で広がる）", () => {
    // 塗る側のマスで横が塗らない縁: 端から e ドット内側までが外になる
    expect(cornerShapeBits(true, false, true, LAST, 16, ROUND_R, false, 3), "端の 1 ドットは外へ").toBe(0);
    expect(cornerShapeBits(true, false, true, 16, 16, ROUND_R, false, 3), "中心寄りは中").toBe(1);
    // 塗らない側のマスは、負の揺らぎで縁がはみ出す
    expect(cornerShapeBits(false, true, false, 0, 16, ROUND_R, false, -2), "隣の縁がはみ出す").toBe(1);
    expect(cornerShapeBits(false, true, false, 0, 16, ROUND_R, false, 0), "揺らぎ 0 ならはみ出さない").toBe(0);
  });

  it("quadrantSign はマスの前半で -1、後半で 1", () => {
    expect(quadrantSign(0)).toBe(-1);
    expect(quadrantSign(TILE_DOTS / 2 - 1)).toBe(-1);
    expect(quadrantSign(TILE_DOTS / 2)).toBe(1);
    expect(quadrantSign(LAST)).toBe(1);
  });

  it("edgeJitter は amp 0 で常に 0、amp があれば ±amp に収まり決定的", () => {
    for (let i = 0; i < 200; i++) {
      expect(edgeJitter(i * 3, i, 0, 7), "amp 0").toBe(0);
      const e = edgeJitter(i * 5 - 300, i * 2, 3, 7);
      expect(Math.abs(e) <= 3, `振幅 ${e}`).toBe(true);
      expect(edgeJitter(i * 5 - 300, i * 2, 3, 7), "決定的").toBe(e);
    }
  });
});

/** 壁の地図の中に、指定のマスだけ床を開ける */
function mapWithFloor(width: number, height: number, floors: readonly [number, number][]): GameMap {
  const map = createMap(width, height);
  for (const [x, y] of floors) map.tiles[toIndex(map, x, y)] = Tile.Floor;
  return map;
}

describe("dualGrid: 地図の上の形（cornerShape）", () => {
  it("頂点を囲む 4 マスの 16 通りすべてで、全部壁なら全ドット塗り・全部床なら全ドット抜け・それ以外は混ざる", () => {
    for (let pattern = 0; pattern < 16; pattern++) {
      // 左上・右上・左下・右下の 4 マス（ビットが立てば壁）。頂点は 4 マスの交点
      const wallAt = [pattern & 1, pattern & 2, pattern & 4, pattern & 8].map((v) => v !== 0);
      const map = createMap(4, 4);
      for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) map.tiles[toIndex(map, x, y)] = Tile.Wall;
      const slots: [number, number][] = [
        [1, 1],
        [2, 1],
        [1, 2],
        [2, 2],
      ];
      slots.forEach(([x, y], i) => {
        if (!wallAt[i]) map.tiles[toIndex(map, x, y)] = Tile.Floor;
      });
      let filled = 0;
      let total = 0;
      // 頂点（マス 2, 2 の左上）を中心に ±16 ドットを調べる
      for (let dy = -16; dy < 16; dy++) {
        for (let dx = -16; dx < 16; dx++) {
          filled += cornerShape(isWallTile, map, 2 * TILE_DOTS + dx, 2 * TILE_DOTS + dy, ROUND_R, false, 0, 1);
          total++;
        }
      }
      const walls = wallAt.filter(Boolean).length;
      if (walls === 4) expect(filled, `パターン ${pattern}: 全部壁`).toBe(total);
      else if (walls === 0) expect(filled, `パターン ${pattern}: 全部床`).toBeLessThan(total * 0.15);
      else {
        expect(filled, `パターン ${pattern}: 壁が混ざる（下限）`).toBeGreaterThan(0);
        expect(filled, `パターン ${pattern}: 壁が混ざる（上限）`).toBeLessThan(total);
      }
    }
  });

  it("地図の外は壁として扱われる", () => {
    const map = mapWithFloor(3, 3, [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1], [0, 2], [1, 2], [2, 2]]);
    expect(isWallTile(map, -1, 0), "左の外").toBe(true);
    expect(isWallTile(map, 0, -1), "上の外").toBe(true);
    expect(isWallTile(map, 3, 0), "右の外").toBe(true);
    expect(isWallTile(map, 0, 3), "下の外").toBe(true);
    expect(isWallTile(map, 1, 1), "中は床").toBe(false);
    expect(cornerShape(isWallTile, map, -5, 40, ROUND_R, false, 0, 1), "外のドットは塗る側").toBe(1);
    expect(cornerShape(isWallTile, map, 3 * TILE_DOTS + 4, 40, ROUND_R, false, 0, 1), "右の外").toBe(1);
  });

  it("isWallOrPitTile は壁と穴を数え、床・階段・泉は数えない", () => {
    const map = createMap(5, 1);
    map.tiles.set([Tile.Wall, Tile.Floor, Tile.Pit, Tile.StairsDown, Tile.Fountain]);
    expect([0, 1, 2, 3, 4].map((x) => isWallOrPitTile(map, x, 0))).toEqual([true, false, true, false, false]);
    expect(isWallOrPitTile(map, 9, 0), "外").toBe(true);
  });

  it.each([
    { name: "丸め", chamfer: false, R: ROUND_R },
    { name: "面取り", chamfer: true, R: CHAMFER_R },
  ])("左右反転した地図では形も左右反転する（$name・揺らぎ 0）", ({ chamfer, R }) => {
    const w = 9;
    const h = 7;
    const map = createMap(w, h);
    const mirror = createMap(w, h);
    // 偏った形（L 字と孤立マス）
    const floors: [number, number][] = [[1, 1], [2, 1], [3, 1], [3, 2], [3, 3], [5, 4], [6, 4], [6, 5], [7, 2]];
    for (const [x, y] of floors) {
      map.tiles[toIndex(map, x, y)] = Tile.Floor;
      mirror.tiles[toIndex(mirror, w - 1 - x, y)] = Tile.Floor;
    }
    let diff = 0;
    for (let wy = 0; wy < h * TILE_DOTS; wy += 3) {
      for (let wx = 0; wx < w * TILE_DOTS; wx++) {
        const a = cornerShape(isWallTile, map, wx, wy, R, chamfer, 0, 5);
        const b = cornerShape(isWallTile, mirror, w * TILE_DOTS - 1 - wx, wy, R, chamfer, 0, 5);
        if (a !== b) diff++;
      }
    }
    expect(diff, "鏡像で食い違うドット").toBe(0);
  });

  it("上下反転した地図でも形が反転する（丸め・揺らぎ 0）", () => {
    const w = 8;
    const h = 8;
    const map = createMap(w, h);
    const flipped = createMap(w, h);
    const floors: [number, number][] = [[1, 1], [2, 1], [2, 2], [2, 3], [5, 5], [6, 5], [4, 2]];
    for (const [x, y] of floors) {
      map.tiles[toIndex(map, x, y)] = Tile.Floor;
      flipped.tiles[toIndex(flipped, x, h - 1 - y)] = Tile.Floor;
    }
    let diff = 0;
    for (let wy = 0; wy < h * TILE_DOTS; wy++) {
      for (let wx = 0; wx < w * TILE_DOTS; wx += 3) {
        const a = cornerShape(isWallTile, map, wx, wy, ROUND_R, false, 0, 5);
        const b = cornerShape(isWallTile, flipped, wx, h * TILE_DOTS - 1 - wy, ROUND_R, false, 0, 5);
        if (a !== b) diff++;
      }
    }
    expect(diff, "上下反転で食い違うドット").toBe(0);
  });

  it("揺らぎがあっても同じ座標・種なら同じ形（決定的）で、縁だけが動く", () => {
    const map = mapWithFloor(6, 6, [[2, 2], [3, 2], [2, 3], [3, 3]]);
    let moved = 0;
    for (let wy = 0; wy < 6 * TILE_DOTS; wy += 2) {
      for (let wx = 0; wx < 6 * TILE_DOTS; wx += 2) {
        const a = cornerShape(isWallTile, map, wx, wy, ROUND_R, false, 3, 9);
        expect(cornerShape(isWallTile, map, wx, wy, ROUND_R, false, 3, 9), "決定的").toBe(a);
        if (a !== cornerShape(isWallTile, map, wx, wy, ROUND_R, false, 0, 9)) moved++;
      }
    }
    expect(moved, "揺らぎで形が変わるドットがある").toBeGreaterThan(0);
    // 縁から 8 ドット以上離れたドットは揺らぎで変わらない: 床の中心と壁の奥
    expect(cornerShape(isWallTile, map, 3 * TILE_DOTS, 3 * TILE_DOTS, ROUND_R, false, 3, 9), "床の中心").toBe(0);
    expect(cornerShape(isWallTile, map, 20, 20, ROUND_R, false, 3, 9), "壁の奥").toBe(1);
  });
});

describe("dualGrid: 頂点の深さ", () => {
  /** 壁の地図の中央に 3x3 の床 */
  function roomMap(): GameMap {
    const floors: [number, number][] = [];
    for (let y = 4; y < 7; y++) for (let x = 4; x < 7; x++) floors.push([x, y]);
    return mapWithFloor(11, 11, floors);
  }

  it("床に接する頂点は 0、壁の奥へ離れるほど増える", () => {
    const depth = buildVertexDepth(roomMap());
    const at = (vx: number, vy: number): number => depth.rock[vy * depth.width + vx] ?? -1;
    expect(depth.width, "頂点の幅は地図の幅 + 1").toBe(12);
    expect(depth.height, "頂点の高さは地図の高さ + 1").toBe(12);
    for (let vy = 4; vy <= 7; vy++) for (let vx = 4; vx <= 7; vx++) expect(at(vx, vy), `床に接する頂点 (${vx}, ${vy})`).toBe(0);
    // 床の西側へ 1・2・3 頂点離れる
    expect(at(3, 5), "1 つ外").toBeCloseTo(1, 5);
    expect(at(2, 5), "2 つ外").toBeCloseTo(2, 5);
    expect(at(1, 5), "3 つ外").toBeCloseTo(3, 5);
    // 斜めは面取りの 1.41
    expect(at(3, 3), "斜めに 1 つ外").toBeCloseTo(Math.SQRT2, 3);
    expect(at(2, 2), "斜めに 2 つ外").toBeCloseTo(2 * Math.SQRT2, 3);
  });

  it("値は DEPTH_CAP で頭打ちになる", () => {
    const big = mapWithFloor(40, 40, [[20, 20]]);
    const depth = buildVertexDepth(big);
    expect(Math.max(...depth.rock), "最大").toBe(DEPTH_CAP);
  });

  it("穴が無ければ pit は全部 0、穴があれば岸 0・奥ほど増える", () => {
    const none = buildVertexDepth(roomMap());
    expect(none.pit.every((v) => v === 0), "穴なし").toBe(true);

    const map = createMap(12, 12);
    map.tiles.fill(Tile.Floor);
    for (let y = 3; y < 9; y++) for (let x = 3; x < 9; x++) map.tiles[toIndex(map, x, y)] = Tile.Pit;
    const depth = buildVertexDepth(map);
    const at = (vx: number, vy: number): number => depth.pit[vy * depth.width + vx] ?? -1;
    expect(at(3, 5), "穴の縁の頂点").toBe(0);
    expect(at(4, 5), "1 つ奥").toBeCloseTo(1, 5);
    expect(at(5, 5), "2 つ奥").toBeCloseTo(2, 5);
    expect(at(6, 6), "中心").toBeGreaterThan(at(4, 4));
    expect(at(1, 1), "床の側は 0").toBe(0);
  });

  it("sampleDepth は頂点の値を双線形に補間し、地図の外を引いても範囲に収まる", () => {
    const depth = buildVertexDepth(roomMap());
    // 床のマスの中は 0
    expect(sampleDepth(depth, depth.rock, 5 * TILE_DOTS + 16, 5 * TILE_DOTS + 16), "床の中").toBe(0);
    // 床の西の壁の縁（x = 4 マスの左端）から 1 マス西は深さ 1 に近い
    const west = sampleDepth(depth, depth.rock, 3 * TILE_DOTS + 16, 5 * TILE_DOTS + 16);
    expect(west, "壁のマスの中ほど").toBeGreaterThan(0);
    expect(west, "壁のマスの中ほど").toBeLessThan(1.01);
    // 奥へ行くほど大きい
    const far = sampleDepth(depth, depth.rock, 1 * TILE_DOTS + 16, 5 * TILE_DOTS + 16);
    expect(far, "奥ほど深い").toBeGreaterThan(west);
    for (const [wx, wy] of [[-50, -50], [99999, 99999], [-1, 5 * TILE_DOTS]] as const) {
      const v = sampleDepth(depth, depth.rock, wx, wy);
      expect(v >= 0 && v <= DEPTH_CAP, `外 (${wx}, ${wy}) = ${v}`).toBe(true);
    }
  });

  it("ドットが 1 つ動くごとの深さの変化はなめらか（階段状にならない）", () => {
    const depth = buildVertexDepth(roomMap());
    let last = sampleDepth(depth, depth.rock, 0, 5 * TILE_DOTS + 16);
    for (let wx = 1; wx < 4 * TILE_DOTS; wx++) {
      const v = sampleDepth(depth, depth.rock, wx, 5 * TILE_DOTS + 16);
      expect(Math.abs(v - last), `x=${wx}`).toBeLessThan(1 / TILE_DOTS + 1e-6);
      last = v;
    }
  });
});
