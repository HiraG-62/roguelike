import { describe, expect, it } from "vitest";
import { type GameMap, Tile, rectCenter } from "../grid";
import { finalizeLayout } from "./finalize";
import { layoutFrameFor } from "./index";
import { disc, line, makeGrid } from "./shapes";
import { Cell, type LayoutDraft, type LayoutFrame, type LayoutNode } from "./types";
import { type ValidateOptions, validateLayout } from "./validate";

const W = 60;
const H = 36;
const FRAME: LayoutFrame = layoutFrameFor(W, H, 1);

/** 小さな地図向けの検査の閾値（本番の既定は 200x115 向け） */
const SMALL: ValidateOptions = {
  minRooms: 3,
  roomMinTiles: 20,
  minFloorRatio: 0.1,
  maxFloorRatio: 0.9,
  mainPathWidth: 2,
  lordFill: 0.6,
  lordRadius: 3,
};

const tileAt = (x: number, y: number): number => y * W + x;

/**
 * 手で作った下書き: 開始 A(10,12) — B(26,12) — D(42,12)、D の下に主の間 L(42,27)。穴の池が (26,27) に 1 つ。
 * nodes の並びはわざと「主の間・遠い部屋・近い部屋」の順にして、finalize が並べ直すことを見る
 */
function buildDraft(over: { narrow?: boolean; nodes?: LayoutNode[] } = {}): LayoutDraft {
  const g = makeGrid(W, H, Cell.Wall);
  disc(g, 10, 12, 5, Cell.Floor);
  disc(g, 26, 12, 5, Cell.Floor);
  disc(g, 42, 12, 5, Cell.Floor);
  disc(g, 42, 27, 5, Cell.Floor);
  if (over.narrow) {
    // マスの中心（.5）を通る半径 0.6 の線は幅 1 の廊下になる
    line(g, 10.5, 12.5, 42.5, 12.5, 0.6, Cell.Floor);
    line(g, 42.5, 12.5, 42.5, 27.5, 0.6, Cell.Floor);
  } else {
    line(g, 10, 12, 42, 12, 1.6, Cell.Floor);
    line(g, 42, 12, 42, 27, 1.6, Cell.Floor);
  }
  disc(g, 26, 27, 3, Cell.Pit);
  const nodes: LayoutNode[] = over.nodes ?? [
    { x: 10.5, y: 12.5, role: "start", grow: 6 },
    { x: 42.5, y: 27.5, role: "lord", grow: 8 },
    { x: 42.5, y: 12.5, role: "room", grow: 6 },
    { x: 26.5, y: 12.5, role: "room", grow: 6 },
  ];
  return { cells: g.cells, shallow: new Uint8Array(W * H), nodes };
}

function finalize(draft: LayoutDraft = buildDraft(), minNodeTiles = 6): GameMap {
  const map = finalizeLayout("cavern", draft, FRAME, minNodeTiles);
  if (!map) throw new Error("下書きから地図が作れなかった");
  return map;
}

describe("finalizeLayout", () => {
  it("下書きを GameMap にする: タイルの種類・部屋・型の記録", () => {
    const map = finalize();
    expect(map.width).toBe(W);
    expect(map.height).toBe(H);
    expect(map.layout).toBe("cavern");
    expect(map.tiles[tileAt(10, 12)]).toBe(Tile.Floor);
    expect(map.tiles[tileAt(26, 27)], "穴は Tile.Pit").toBe(Tile.Pit);
    expect(map.tiles[tileAt(1, 1)]).toBe(Tile.Wall);
    expect(map.rooms.length).toBe(4);
    expect(map.roomTiles?.length).toBe(4);
  });

  it("部屋 0 = 開始、最後 = 主の間、間は開始から歩いて近い順（ノードの並びに依らない）", () => {
    const map = finalize();
    const centers = map.rooms.map((r) => rectCenter(r));
    expect(centers[0]?.x, "開始").toBeLessThan(16);
    expect(Math.abs((centers[1]?.x ?? 0) - 26), "近い部屋が先").toBeLessThan(4);
    expect(Math.abs((centers[2]?.x ?? 0) - 42), "遠い部屋が次").toBeLessThan(4);
    expect(centers[2]?.y).toBeLessThan(20);
    expect(centers[3]?.y, "主の間は最後").toBeGreaterThan(22);
  });

  it("階段は主の間の核（rect の中心）の 1 つだけで、そのタイルは主の間の所属", () => {
    const map = finalize();
    const lordRect = map.rooms[map.rooms.length - 1];
    if (!lordRect) throw new Error("主の間が無い");
    const c = rectCenter(lordRect);
    const stairs = c.y * W + c.x;
    expect(map.tiles[stairs]).toBe(Tile.StairsDown);
    expect(map.roomTiles?.[map.rooms.length - 1]).toContain(stairs);
    expect(Array.from(map.tiles).filter((t) => t === Tile.StairsDown).length).toBe(1);
  });

  it("部屋の所属タイルは昇順で、すべて床か階段（穴・壁に部屋は無い）", () => {
    const map = finalize();
    for (const tiles of map.roomTiles ?? []) {
      expect(tiles).toEqual([...tiles].sort((a, b) => a - b));
      for (const t of tiles) expect([Tile.Floor, Tile.StairsDown]).toContain(map.tiles[t]);
    }
  });

  it("部屋どうしは 8 近傍で接しない", () => {
    const map = finalize();
    const owner = new Int16Array(W * H).fill(-1);
    map.roomTiles?.forEach((tiles, id) => {
      for (const t of tiles) owner[t] = id;
    });
    for (let i = 0; i < owner.length; i++) {
      const id = owner[i] ?? -1;
      if (id < 0) continue;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const o = owner[i + dy * W + dx] ?? -1;
          expect(o === -1 || o === id, `タイル ${i} と隣`).toBe(true);
        }
      }
    }
  });

  it("所属タイルを持つノードは育てず、その領域のまま部屋になる。隣り合う 2 つの領域は境目を空ける", () => {
    const g = makeGrid(W, H, Cell.Floor);
    const left: number[] = [];
    const right: number[] = [];
    const lord: number[] = [];
    for (let y = 5; y < 10; y++) {
      for (let x = 5; x < 10; x++) left.push(tileAt(x, y));
      for (let x = 10; x < 15; x++) right.push(tileAt(x, y));
      for (let x = 40; x < 45; x++) lord.push(tileAt(x, y + 15));
    }
    const nodes: LayoutNode[] = [
      { x: 7, y: 7, role: "start", grow: 9, tiles: left },
      { x: 12, y: 7, role: "room", grow: 9, tiles: right },
      { x: 42, y: 22, role: "lord", grow: 9, tiles: lord },
    ];
    const map = finalize({ cells: g.cells, shallow: new Uint8Array(W * H), nodes }, 1);
    const [a, b, c] = map.roomTiles ?? [];
    expect(c?.length, "主の間は渡した 25 マスのまま").toBe(25);
    expect(a?.length, "接する列は両方から外れる").toBeLessThan(25);
    expect(b?.length).toBeLessThan(25);
    expect((a?.length ?? 0) + (b?.length ?? 0)).toBe(25 * 2 - 10);
    expect(a).not.toContain(tileAt(9, 5));
    expect(b).not.toContain(tileAt(10, 5));
  });

  it("部屋に育たなかったノード（minNodeTiles 未満・床でない所）は捨て、開始と主の間は残す", () => {
    const small: LayoutNode = { x: 26.5, y: 12.5, role: "room", grow: 1 };
    const onPit: LayoutNode = { x: 26.5, y: 27.5, role: "room", grow: 6 };
    const nodes: LayoutNode[] = [
      { x: 10.5, y: 12.5, role: "start", grow: 6 },
      { x: 42.5, y: 27.5, role: "lord", grow: 8 },
      small,
      onPit,
    ];
    expect(finalize(buildDraft({ nodes }), 6).rooms.length, "小さい部屋は 6 マス未満で捨てる・穴の上のノードも捨てる").toBe(2);
    expect(finalize(buildDraft({ nodes }), 1).rooms.length, "下限を下げれば小さい部屋は残る（穴の上は残らない）").toBe(3);
  });

  it("開始か主の間が欠ける・重複する・床に置けないときは null", () => {
    const base: LayoutNode[] = [
      { x: 10.5, y: 12.5, role: "start", grow: 6 },
      { x: 42.5, y: 27.5, role: "lord", grow: 8 },
    ];
    const first = base[0];
    const second = base[1];
    if (!first || !second) throw new Error("ノードが無い");
    const cases: Record<string, LayoutNode[]> = {
      "開始なし": [second],
      "主の間なし": [first],
      "開始が 2 つ": [first, { ...first, x: 26.5 }, second],
      "主の間が壁の上": [first, { ...second, x: 55.5, y: 3.5 }],
    };
    for (const [name, nodes] of Object.entries(cases)) {
      expect(finalizeLayout("cavern", buildDraft({ nodes }), FRAME), name).toBeNull();
    }
  });

  it("下書きの大きさが枠と違えば null", () => {
    const draft = buildDraft();
    expect(finalizeLayout("cavern", { ...draft, cells: new Uint8Array(10) }, FRAME)).toBeNull();
  });

  it("外周は必ず壁にする（下書きが外周を床にしていても）", () => {
    const g = makeGrid(W, H, Cell.Floor);
    const nodes: LayoutNode[] = [
      { x: 10.5, y: 12.5, role: "start", grow: 3 },
      { x: 42.5, y: 27.5, role: "lord", grow: 3 },
    ];
    const map = finalize({ cells: g.cells, shallow: new Uint8Array(W * H), nodes }, 1);
    expect(map.tiles[tileAt(0, 0)]).toBe(Tile.Wall);
    expect(map.tiles[tileAt(W - 1, 10)]).toBe(Tile.Wall);
    expect(map.tiles[tileAt(10, H - 1)]).toBe(Tile.Wall);
  });

  it("浅い地形（shallow）は床の上のものだけを写す。無ければ shallow は持たない", () => {
    const draft = buildDraft();
    expect(finalize(draft).shallow, "浅い地形が無ければ undefined").toBeUndefined();
    draft.shallow[tileAt(26, 12)] = 3;
    draft.shallow[tileAt(1, 1)] = 3; // 壁の上
    draft.shallow[tileAt(26, 27)] = 3; // 穴の上
    const map = finalize(draft);
    expect(map.shallow?.[tileAt(26, 12)]).toBe(3);
    expect(map.shallow?.[tileAt(1, 1)]).toBe(0);
    expect(map.shallow?.[tileAt(26, 27)]).toBe(0);
  });

  it("下書きを書き換えない・同じ下書きなら同じ地図", () => {
    const draft = buildDraft();
    const before = Array.from(draft.cells);
    const a = finalize(draft);
    const b = finalize(draft);
    expect(Array.from(draft.cells)).toEqual(before);
    expect(Array.from(a.tiles)).toEqual(Array.from(b.tiles));
    expect(a.roomTiles).toEqual(b.roomTiles);
    expect(a.rooms).toEqual(b.rooms);
  });
});

describe("validateLayout", () => {
  it("手で作った地図は 8 項目に通る", () => {
    expect(validateLayout(finalize(), SMALL)).toBeNull();
  });

  it("1. 通れる床が 1 つにつながっていなければ落ちる", () => {
    const map = finalize();
    map.tiles[tileAt(56, 33)] = Tile.Floor;
    expect(validateLayout(map, SMALL)).not.toBeNull();
  });

  it("1. 穴は通れないので、穴で切れた床も落ちる", () => {
    const map = finalize();
    // 開始と近い部屋の間の廊下を穴にする（幅 4 の廊下の全部）
    for (let y = 9; y <= 15; y++) for (let x = 15; x <= 21; x++) if (map.tiles[tileAt(x, y)] === Tile.Floor && !map.roomTiles?.some((t) => t.includes(tileAt(x, y)))) map.tiles[tileAt(x, y)] = Tile.Pit;
    expect(validateLayout(map, SMALL)).not.toBeNull();
  });

  it("2. 階段が主の間の核に無い・2 つある・部屋が 1 つだけのとき落ちる", () => {
    const missing = finalize();
    const lordRect = missing.rooms[missing.rooms.length - 1];
    if (!lordRect) throw new Error("主の間が無い");
    const c = rectCenter(lordRect);
    missing.tiles[c.y * W + c.x] = Tile.Floor;
    expect(validateLayout(missing, SMALL), "階段が無い").not.toBeNull();

    const extra = finalize();
    extra.tiles[tileAt(10, 12)] = Tile.StairsDown;
    expect(validateLayout(extra, SMALL), "階段が 2 つ").not.toBeNull();

    const single = finalize();
    single.rooms = single.rooms.slice(-1);
    single.roomTiles = single.roomTiles?.slice(-1);
    expect(validateLayout(single, SMALL), "部屋が 1 つ").not.toBeNull();
  });

  it("3. 部屋どうしが 8 近傍で接していれば落ちる", () => {
    const map = finalize();
    const [first, second] = map.roomTiles ?? [];
    if (!first || !second) throw new Error("部屋が無い");
    // 2 番目の部屋のタイルの隣の床を、1 番目の部屋に入れる
    const t = second[0] ?? 0;
    const next = [t + 1, t - 1, t + W, t - W].find((n) => map.tiles[n] === Tile.Floor && !second.includes(n));
    if (next === undefined) throw new Error("隣の床が無い");
    first.push(next);
    expect(validateLayout(map, SMALL)).not.toBeNull();
  });

  it("4. 開始から主の間まで幅 2 の道が無ければ落ちる（幅 1 の廊下）。幅 1 でよければ通る", () => {
    const narrow = finalize(buildDraft({ narrow: true }));
    expect(validateLayout(narrow, SMALL)).not.toBeNull();
    expect(validateLayout(narrow, { ...SMALL, mainPathWidth: 1 })).toBeNull();
  });

  it("5. 主の間が狭ければ落ちる", () => {
    expect(validateLayout(finalize(), { ...SMALL, lordRadius: 20 })).not.toBeNull();
  });

  it("6. 部屋の数が minRooms に満たなければ落ちる", () => {
    expect(validateLayout(finalize(), { ...SMALL, minRooms: 5 })).not.toBeNull();
    expect(validateLayout(finalize(), { ...SMALL, roomMinTiles: 10000 }), "大きい部屋だけ数える").not.toBeNull();
  });

  it("7. 床の割合が範囲外なら落ちる", () => {
    expect(validateLayout(finalize(), { ...SMALL, minFloorRatio: 0.99 })).not.toBeNull();
    expect(validateLayout(finalize(), { ...SMALL, maxFloorRatio: 0.01 })).not.toBeNull();
  });

  it("8. 穴の上に部屋のタイルがあれば落ちる", () => {
    const map = finalize();
    const tiles = map.roomTiles?.[1];
    const t = tiles?.[0];
    if (t === undefined) throw new Error("部屋が無い");
    map.tiles[t] = Tile.Pit;
    expect(validateLayout(map, SMALL)).not.toBeNull();
  });
});
