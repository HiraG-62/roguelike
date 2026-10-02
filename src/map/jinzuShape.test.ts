import { describe, expect, it } from "vitest";
import type { Vec } from "../core/vec";
import { JINZU } from "../data/tuning";
import { Tile, TILE_SIZE, createMap, setTile } from "./grid";
import {
  STROKE_POINTS,
  distToPolyline,
  distToSegment,
  findSafeSpot,
  pointAtFraction,
  polylineLength,
  safeSpotExists,
  squadSide,
  strokeFrame,
  strokePoints,
} from "./jinzuShape";

/** 陣図の画の形（map/jinzuShape.ts。docs/ideas/jinzu-impl.md 2-2 R8） */

const L: Vec = { x: 0, y: 0 };
const P: Vec = { x: 150, y: 0 };
const FRAME = strokeFrame(L, P, { x: 1, y: 0 });

/** 鶴翼の筆順（data の FORMATION/craneWing.json と同じ形）。始点は大将から見て (u, v) の隊の重心 */
function craneStrokes(frame = FRAME, map = null as ReturnType<typeof createMap> | null): Vec[][] {
  const at = (u: number, v: number): Vec => ({ x: frame.origin.x + frame.u.x * u + frame.v.x * v, y: frame.origin.y + frame.u.y * u + frame.v.y * v });
  return [
    strokePoints({ kind: "hook", side: 1, pass: 30, beyond: 40 }, at(40, 50), frame, map),
    strokePoints({ kind: "hook", side: -1, pass: 30, beyond: 40 }, at(40, -50), frame, map),
    strokePoints({ kind: "flank", side: 1, pass: 34, beyond: 20 }, at(40, 25), frame, map),
    strokePoints({ kind: "flank", side: -1, pass: 34, beyond: 20 }, at(40, -25), frame, map),
    strokePoints({ kind: "volley", side: 0, pass: 0, beyond: 30 }, at(0, 10), frame, map),
  ];
}

describe("画の点列", () => {
  it("同じ入力から同じ点列を返し、壁が無ければ 12 点", () => {
    const a = craneStrokes();
    const b = craneStrokes();
    expect(a, "決定的").toEqual(b);
    for (const points of a) expect(points.length, "画は 12 点").toBe(STROKE_POINTS);
  });

  it("鉤は的の脇（左右に pass）を通り、的の後ろ（u の向きに beyond）で閉じる", () => {
    const hook = craneStrokes()[0]!;
    const end = hook[hook.length - 1]!;
    expect(end.x, "終点は的の後ろ").toBeCloseTo(P.x + 40, 6);
    expect(end.y, "終点は軸の上").toBeCloseTo(0, 6);
    expect(distToPolyline({ x: P.x, y: -30 }, hook), "左の鉤は的の脇 30 を通る（画面の上が左）").toBeLessThan(1);
  });

  it("壁に当たった所で切れる（描く線 = 走る道）。切って 2 点に満たなければ画は無い", () => {
    const map = createMap(40, 40);
    for (let y = 0; y < 40; y++) for (let x = 0; x < 40; x++) setTile(map, x, y, Tile.Floor);
    const open = strokePoints({ kind: "thrust", side: 0, pass: 0, beyond: 60 }, { x: 40, y: 320 }, strokeFrame({ x: 40, y: 320 }, { x: 400, y: 320 }, { x: 1, y: 0 }), map);
    expect(open.length, "壁が無ければ全長").toBe(STROKE_POINTS);
    // x = 20 タイルの列を壁にする
    for (let y = 0; y < 40; y++) setTile(map, 20, y, Tile.Wall);
    const cut = strokePoints({ kind: "thrust", side: 0, pass: 0, beyond: 60 }, { x: 40, y: 320 }, strokeFrame({ x: 40, y: 320 }, { x: 400, y: 320 }, { x: 1, y: 0 }), map);
    expect(cut.length, "壁の手前で切れる").toBeLessThan(STROKE_POINTS);
    for (const p of cut) expect(p.x, "壁の中へ入らない").toBeLessThan(20 * TILE_SIZE);
    const blocked = strokePoints({ kind: "thrust", side: 0, pass: 0, beyond: 60 }, { x: 20 * TILE_SIZE - 2, y: 320 }, strokeFrame({ x: 20 * TILE_SIZE - 2, y: 320 }, { x: 400, y: 320 }, { x: 1, y: 0 }), map);
    expect(blocked, "始点のすぐ先が壁なら画は無い").toEqual([]);
  });
});

describe("鶴翼の安全な帯", () => {
  it("5 画目（射線）より前の画は、大将と的を結ぶ帯（幅 safeGapMin）に入らない", () => {
    const strokes = craneStrokes();
    const half = JINZU.safeGapMin / 2;
    for (let i = 0; i < 4; i++) {
      for (const p of strokes[i]!) expect(distToSegment(p, L, P), `${i + 1} 画目の点は帯の外`).toBeGreaterThan(half);
    }
  });

  it("5 画目（射線）は大将と的を結ぶ帯を通る（そこを塞ぐ）", () => {
    const volley = craneStrokes()[4]!;
    expect(distToPolyline(P, volley), "射線は的を貫く").toBeLessThan(1);
    expect(distToPolyline({ x: 75, y: 5 }, volley), "帯の途中も通る").toBeLessThan(JINZU.safeGapMin);
  });

  it("向きを回しても、画は画の座標系で同じ形（回転で壊れない）", () => {
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const target = { x: Math.cos(a) * 150, y: Math.sin(a) * 150 };
      const frame = strokeFrame(L, target, { x: 1, y: 0 });
      const strokes = craneStrokes(frame);
      const half = JINZU.safeGapMin / 2;
      for (let i = 0; i < 4; i++) for (const p of strokes[i]!) expect(distToSegment(p, L, target), `向き ${k} の ${i + 1} 画目`).toBeGreaterThan(half);
    }
  });
});

describe("安全地帯", () => {
  it("的の距離 3 通り × 向き 8 通りで、構え + 最後の画の間に歩いて届く所に画の帯に入らない点が 1 つ以上ある", () => {
    const reach = 120 * (JINZU.holdSec + JINZU.strokeSec);
    for (const d of [60, 150, 220]) {
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        const target = { x: Math.cos(a) * d, y: Math.sin(a) * d };
        const strokes = craneStrokes(strokeFrame(L, target, { x: 1, y: 0 }));
        expect(safeSpotExists(strokes, target, reach, JINZU.bandHalf), `距離 ${d} 向き ${k}`).toBe(true);
      }
    }
  });

  it("見つけた点は帯の外で、通れる点だけに絞れる", () => {
    const strokes = craneStrokes();
    const spot = findSafeSpot(strokes, P, 200, JINZU.bandHalf);
    expect(spot, "見つかる").not.toBeNull();
    for (const s of strokes) expect(distToPolyline(spot!, s), "帯の外").toBeGreaterThan(JINZU.bandHalf);
    const onlyLeft = findSafeSpot(strokes, P, 200, JINZU.bandHalf, (p) => p.x > P.x + 100);
    expect(onlyLeft?.x ?? 0, "条件を渡すとその点だけ").toBeGreaterThan(P.x + 100);
  });

  it("全部の方角を画で塞いだ（届く範囲が帯だらけ）なら見つからない", () => {
    const wall: Vec[] = [];
    for (let y = -400; y <= 400; y += 4) wall.push({ x: 10, y });
    const ring = [wall, wall.map((p) => ({ x: -10, y: p.y })), wall.map((p) => ({ x: p.y, y: 10 })), wall.map((p) => ({ x: p.y, y: -10 }))];
    expect(findSafeSpot(ring, { x: 0, y: 0 }, 12, JINZU.bandHalf), "囲まれた中は逃げ場が無い").toBeNull();
  });
});

describe("折れ線の測り", () => {
  it("長さと途中の点を返す", () => {
    const line: Vec[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ];
    expect(polylineLength(line)).toBe(20);
    expect(pointAtFraction(line, 0.5)).toEqual({ x: 10, y: 0 });
    expect(pointAtFraction(line, 0.75)).toEqual({ x: 10, y: 5 });
    expect(pointAtFraction(line, 2), "1 を超えたら終点").toEqual({ x: 10, y: 10 });
  });

  it("隊の名の左右", () => {
    expect(squadSide("outerLeft")).toBe(1);
    expect(squadSide("backRight")).toBe(-1);
    expect(squadSide("center")).toBe(0);
  });
});
