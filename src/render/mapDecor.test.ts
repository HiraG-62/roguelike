import { afterEach, describe, expect, it, vi } from "vitest";
// system の循環参照は core/game を先に読むと解ける（他の描画のテストと同じ順）
import { createGame } from "../core/game";
import { createRng } from "../core/rng";
import { createEmptyProfile } from "../loot/types";
import { Tile, createMap, toIndex, type GameMap } from "../map/grid";
import { withFixedLayout } from "../map/layout/select";
import type { FloorLayout } from "../map/layout/types";
import { createDefaultSkillProfile } from "../skills/persistence";
import { buildFloor } from "../system/floor";
import { defaultRunSetup } from "../system/runSetup";
import type { FloorKind } from "../core/state";
import { createChunkBake, createRectBake } from "./mapBake";
import {
  DOT_FLOOR,
  DOT_PIT,
  DOT_WALL,
  TALL_PROPS,
  WA_PROPS,
  buildDecorExclude,
  classifyPlace,
  decorateChunk,
  placementsIn,
  texStonesFor,
  type DecorPlacement,
  type DecorSurface,
} from "./mapDecor";
import { mapThemeFor } from "./mapTheme";
import { CHUNK_DOTS, CHUNK_TILES, TILE_DOTS, type BakeOutput, type MapTheme } from "./mapTypes";

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// 道具
// ---------------------------------------------------------------------------

function carve(map: GameMap, x: number, y: number, w: number, h: number): void {
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) map.tiles[toIndex(map, i, j)] = Tile.Floor;
}

function tileAt(map: GameMap, tx: number, ty: number): number {
  if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) return Tile.Wall;
  return map.tiles[ty * map.width + tx] ?? Tile.Wall;
}

/** 丸めを入れない（マスの境で形が切り替わる）ドットの読み出し。側面の判定は「壁の列の下端までのドット数」 */
function tileSurface(map: GameMap): DecorSurface {
  return {
    kindAt: (wx, wy) => {
      const t = tileAt(map, Math.floor(wx / TILE_DOTS), Math.floor(wy / TILE_DOTS));
      return t === Tile.Wall ? DOT_WALL : t === Tile.Pit ? DOT_PIT : DOT_FLOOR;
    },
    wallRun: (wx, wy) => {
      const tx = Math.floor(wx / TILE_DOTS);
      let ty = Math.floor(wy / TILE_DOTS);
      let run = TILE_DOTS - (wy - ty * TILE_DOTS);
      // 地図の外は壁なので、地図の下端で打ち切る（岩盤の底まで数えると終わらない）
      while (ty + 1 < map.height && tileAt(map, tx, ty + 1) === Tile.Wall) {
        run += TILE_DOTS;
        ty++;
      }
      return run;
    },
  };
}

const SENTINEL = 0xff010203;

/** 全ドットを印の色で埋めた ground に decorateChunk だけを掛け、塗られたドットの座標を返す */
function paintedDots(map: GameMap, theme: MapTheme, x: number, y: number, w: number, h: number): { dots: [number, number][]; surface: DecorSurface } {
  const ground = new Uint32Array(w * h).fill(SENTINEL);
  const surface = tileSurface(map);
  decorateChunk({ map, theme, x, y, w, h, ground, surface });
  const dots: [number, number][] = [];
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (ground[j * w + i] !== SENTINEL) dots.push([x + i, y + j]);
  return { dots, surface };
}

interface Floor {
  map: GameMap;
  theme: MapTheme;
}

const FLOOR_CACHE = new Map<string, Floor>();

/**
 * 本物の生成器で作った階（階の型を固定）。同じ引数なら使い回す。
 * createGame が 1 階目を作る時に敵（陣）の配りで rng を進めるので、そのまま buildFloor すると
 * 地図が敵の配り方に左右される。置物の規則を見るテストなので、rng を seed から引き直して地図だけを決める
 */
function floorOf(depth: number, kind: FloorKind, layout?: FloorLayout, seed = 1): Floor {
  const key = `${depth}:${kind}:${layout ?? ""}:${seed}`;
  const cached = FLOOR_CACHE.get(key);
  if (cached) return cached;
  const state = createGame(seed, String(seed), createEmptyProfile(), createDefaultSkillProfile(), { ...defaultRunSetup(), startDepth: depth });
  state.rng = createRng(seed);
  if (layout) withFixedLayout(layout, () => buildFloor(state, kind));
  else buildFloor(state, kind);
  const floor = { map: state.map, theme: mapThemeFor(state.depth, state.floorKind) };
  FLOOR_CACHE.set(key, floor);
  return floor;
}

function allPlacements(map: GameMap, theme: MapTheme): DecorPlacement[] {
  return placementsIn(map, theme, buildDecorExclude(map), 0, 0, map.width - 1, map.height - 1);
}

function bake(map: GameMap, theme: MapTheme, cx: number, cy: number, exclude?: Uint8Array): BakeOutput {
  const job = createChunkBake({ map, cx, cy, theme, ...(exclude ? { exclude } : {}) });
  while (!job.done) job.step(100000);
  return job.result();
}

const THEMES: readonly { name: string; theme: MapTheme }[] = [
  { name: "章 1 苔の洞", theme: mapThemeFor(1, "cave") },
  { name: "章 1 沼", theme: mapThemeFor(3, "swamp") },
  { name: "章 2 寺院", theme: mapThemeFor(7, "rooms") },
  { name: "章 2 坑道", theme: mapThemeFor(8, "mine") },
  { name: "章 3 廃城（炎）", theme: mapThemeFor(12, "forge") },
  { name: "章 3 廃城（霜）", theme: mapThemeFor(13, "glacier") },
  { name: "章 4 異界", theme: mapThemeFor(17, "cave") },
  { name: "最深の間", theme: mapThemeFor(21, "rooms") },
];

/** 20x20 の壁の中に部屋 (3..16) を 1 つ掘り、行き止まりの廊下を 1 本足した地図 */
function roomMap(): GameMap {
  const map = createMap(20, 20);
  carve(map, 3, 3, 14, 14);
  carve(map, 10, 17, 1, 2);
  return map;
}

// ---------------------------------------------------------------------------
// 置き場所の分類
// ---------------------------------------------------------------------------

describe("mapDecor: 置き場所の分類（2-3 節の表）", () => {
  const map = roomMap();

  it("北が壁の床は壁際、北と東か西が壁の床は隅", () => {
    expect(classifyPlace(map, 8, 3), "北の壁の下").toBe("wallFoot");
    expect(classifyPlace(map, 3, 3), "北西の角").toBe("corner");
    expect(classifyPlace(map, 16, 3), "北東の角").toBe("corner");
  });

  it("3 方が壁の床は行き止まり", () => {
    expect(classifyPlace(map, 10, 18), "廊下の突き当たり").toBe("deadEnd");
  });

  it("南が床の壁は側面、周り 2 マスがすべて壁の壁は奈落", () => {
    expect(classifyPlace(map, 8, 2), "部屋の北の壁").toBe("sideFace");
    expect(classifyPlace(map, 0, 0), "岩盤の奥").toBe("void");
    expect(classifyPlace(map, 1, 1), "岩盤の手前（床まで 2 マス）").toBe("none");
  });

  it("周り 2 マスがすべて床なら広い床、壁際でも広間の端でもなければ none", () => {
    expect(classifyPlace(map, 9, 9), "広間の真ん中").toBe("open");
    expect(classifyPlace(map, 8, 4), "壁から 1 マス離れた所（周り 2 マスに壁が掛かる）").toBe("none");
  });

  it("階段・穴は置き場所にならない", () => {
    const m = roomMap();
    m.tiles[toIndex(m, 9, 9)] = Tile.StairsDown;
    m.tiles[toIndex(m, 8, 9)] = Tile.Pit;
    expect(classifyPlace(m, 9, 9)).toBe("none");
    expect(classifyPlace(m, 8, 9)).toBe("none");
  });
});

// ---------------------------------------------------------------------------
// 除外のマス
// ---------------------------------------------------------------------------

describe("mapDecor: 除外のマス", () => {
  /** 部屋 2 つ（5x5）を幅 4 の通路でつないだ地図。泉と階段は別の小部屋 */
  function twoRooms(): GameMap {
    const map = createMap(40, 20);
    carve(map, 3, 3, 5, 5);
    carve(map, 20, 3, 5, 5);
    carve(map, 8, 5, 12, 1);
    carve(map, 3, 12, 5, 5);
    map.rooms = [
      { x: 3, y: 3, w: 5, h: 5 },
      { x: 20, y: 3, w: 5, h: 5 },
      { x: 3, y: 12, w: 5, h: 5 },
    ];
    return map;
  }
  const at = (map: GameMap, mask: Uint8Array, x: number, y: number): number => mask[toIndex(map, x, y)] ?? 0;

  it("部屋の中心とその周り 1 マスは除外、その外は除外しない", () => {
    const map = twoRooms();
    const mask = buildDecorExclude(map);
    for (const [cx, cy] of [
      [5, 5],
      [22, 5],
    ] as const) {
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) expect(at(map, mask, cx + dx, cy + dy), `中心 (${cx},${cy}) の周り (${dx},${dy})`).toBe(1);
    }
    expect(at(map, mask, 3, 3), "部屋の隅は除外しない").toBe(0);
  });

  it("扉（部屋に接する部屋の外の床）とその 4 近傍は除外", () => {
    const map = twoRooms();
    const mask = buildDecorExclude(map);
    // 通路の x = 8 は部屋 0 の右隣、x = 19 は部屋 1 の左隣 = 扉
    expect(at(map, mask, 8, 5), "扉").toBe(1);
    expect(at(map, mask, 9, 5), "扉の隣").toBe(1);
    expect(at(map, mask, 19, 5), "もう一方の扉").toBe(1);
    expect(at(map, mask, 18, 5), "もう一方の扉の隣").toBe(1);
    expect(at(map, mask, 13, 5), "通路の真ん中は除外しない").toBe(0);
  });

  it("階段と泉とその 8 近傍は除外", () => {
    const map = twoRooms();
    map.tiles[toIndex(map, 5, 14)] = Tile.StairsDown;
    map.tiles[toIndex(map, 22, 6)] = Tile.Fountain;
    const mask = buildDecorExclude(map);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        expect(at(map, mask, 5 + dx, 14 + dy), `階段の周り (${dx},${dy})`).toBe(1);
        expect(at(map, mask, 22 + dx, 6 + dy), `泉の周り (${dx},${dy})`).toBe(1);
      }
    }
  });

  it("本物の階でも、除外のマスに置物の根元が無い（型 4 種 × 2 つの seed）", () => {
    const layouts: readonly FloorLayout[] = ["court", "river", "prefab", "cavern"];
    for (const layout of layouts) {
      for (const seed of [1, 2]) {
        const { map, theme } = floorOf(7, "rooms", layout, seed);
        const mask = buildDecorExclude(map);
        for (const p of allPlacements(map, theme)) {
          expect(mask[toIndex(map, p.tx, p.ty)], `${layout} seed ${seed} の ${p.kind}@${p.tx},${p.ty}`).toBe(0);
        }
      }
    }
  });

  it("本物の階で、部屋の中心の 3x3 と階段の 8 近傍に置物が出ない", () => {
    const { map, theme } = floorOf(7, "rooms", "court", 1);
    const placed = allPlacements(map, theme);
    expect(placed.length, "置物は出る").toBeGreaterThan(0);
    for (const rect of map.rooms) {
      const cx = Math.floor(rect.x + rect.w / 2);
      const cy = Math.floor(rect.y + rect.h / 2);
      for (const p of placed) {
        expect(Math.abs(p.tx - cx) <= 1 && Math.abs(p.ty - cy) <= 1, `部屋の中心 (${cx},${cy}) に ${p.kind}`).toBe(false);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 置物の置き方
// ---------------------------------------------------------------------------

describe("mapDecor: 置物の置き方", () => {
  it("章 1 の様式には和の置物が出ない（型 4 種・バイオーム 9 種）", () => {
    const kinds: readonly FloorKind[] = ["cave", "rooms", "dark", "forge", "ossuary", "swamp", "glacier", "mine", "meadow"];
    const layouts: readonly FloorLayout[] = ["cavern", "court", "river", "prefab"];
    for (const layout of layouts) {
      const { map } = floorOf(3, "cave", layout, 1);
      for (const kind of kinds) {
        const theme = mapThemeFor(3, kind);
        expect(theme.style, `${kind} は章 1`).toBe("moss");
        for (const p of allPlacements(map, theme)) {
          expect(WA_PROPS.has(p.kind), `${layout} × ${kind} に和の置物 ${p.kind}`).toBe(false);
        }
      }
    }
  });

  it("章 1 の側面の飾りに和の物（注連縄・朱の柱）が出ない: 蛍苔以外のフラグが立たない", () => {
    for (const kind of ["cave", "rooms", "swamp", "meadow", "mine"] as const) {
      const flags = mapThemeFor(3, kind).flags;
      expect(flags.shimenawa, `${kind} の注連縄`).toBe(false);
      expect(flags.redPillar, `${kind} の朱の柱`).toBe(false);
    }
  });

  it("背の高い置物は壁際だけ（北が壁）。river / isle は北が穴でもよい", () => {
    const cases: { depth: number; kind: FloorKind; layout: FloorLayout }[] = [
      { depth: 7, kind: "rooms", layout: "court" },
      { depth: 7, kind: "rooms", layout: "prefab" },
      { depth: 12, kind: "forge", layout: "cavern" },
      { depth: 13, kind: "glacier", layout: "drunk" },
      { depth: 17, kind: "cave", layout: "drunk" },
      { depth: 21, kind: "rooms", layout: "court" },
      { depth: 7, kind: "rooms", layout: "river" },
      { depth: 17, kind: "cave", layout: "isle" },
    ];
    let tall = 0;
    for (const c of cases) {
      const { map, theme } = floorOf(c.depth, c.kind, c.layout, 1);
      const northPitOk = c.layout === "river" || c.layout === "isle";
      for (const p of allPlacements(map, theme)) {
        if (!TALL_PROPS.has(p.kind)) continue;
        tall++;
        const north = tileAt(map, p.tx, p.ty - 1);
        const ok = north === Tile.Wall || (northPitOk && north === Tile.Pit);
        expect(ok, `${c.layout} d${c.depth} の ${p.kind}@${p.tx},${p.ty} の北が壁でない`).toBe(true);
        expect(p.place, `${p.kind} は壁際`).toBe("wallFoot");
      }
    }
    expect(tall, "背の高い置物が実際に出ている").toBeGreaterThan(10);
  });

  it("置物どうしは間隔（小物 4・背の高いもの 6）を空ける。ただし強制の石灯籠の列は 4 マスおき", () => {
    for (const c of [
      { depth: 7, kind: "rooms", layout: "prefab" },
      { depth: 3, kind: "cave", layout: "cavern" },
    ] as const) {
      const { map, theme } = floorOf(c.depth, c.kind, c.layout, 1);
      const list = allPlacements(map, theme).filter((p) => p.place !== "void");
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const a = list[i]!;
          const b = list[j]!;
          expect(Math.hypot(a.tx - b.tx, a.ty - b.ty), `${a.kind}@${a.tx},${a.ty} と ${b.kind}@${b.tx},${b.ty}`).toBeGreaterThanOrEqual(4);
        }
      }
    }
  });

  it("ボス階（lordHall）の置物は壁際だけ", () => {
    for (const [depth, kind] of [
      [5, "cave"],
      [10, "rooms"],
      [15, "forge"],
    ] as const) {
      const { map, theme } = floorOf(depth, kind, "lordHall", 1);
      expect(map.layout, "ボス階の型").toBe("lordHall");
      for (const p of allPlacements(map, theme)) expect(p.place, `d${depth} の ${p.kind}`).toBe("wallFoot");
    }
  });

  it("置物の種類は様式の置物の表（と行き止まり・奈落の専用）から出る", () => {
    const { map, theme } = floorOf(12, "forge", "cavern", 1);
    const allowed = new Set<string>([...theme.props.map((p) => p.kind), "skull", "bonePile"]);
    for (const p of allPlacements(map, theme)) expect(allowed.has(p.kind), `${p.kind} は炎の廃城の置物でない`).toBe(true);
  });
});

describe("mapDecor: 階の型ごとの寄せ", () => {
  /** 横に長い参道（北が壁、部屋に属さない）で 2 つの部屋をつないだ court の地図 */
  function courtMap(): GameMap {
    const map = createMap(60, 20);
    carve(map, 2, 5, 11, 11);
    carve(map, 46, 5, 11, 11);
    carve(map, 13, 9, 33, 4);
    map.rooms = [
      { x: 2, y: 5, w: 11, h: 11 },
      { x: 46, y: 5, w: 11, h: 11 },
    ];
    map.layout = "court";
    return map;
  }

  it("court（章 2）: 参道の壁際に 4 マスおきの石灯籠が出る（扉の周りは除く）", () => {
    const map = courtMap();
    const lanterns = placementsIn(map, mapThemeFor(7, "rooms"), undefined, 0, 0, map.width - 1, map.height - 1).filter((p) => p.kind === "lantern" && p.ty === 9);
    const xs = lanterns.map((p) => p.tx).sort((a, b) => a - b);
    // 4 の倍数のうち、扉（13 と 45）とその 4 近傍（14 と 44）を除いた参道
    expect(xs, "石灯籠の x").toEqual([16, 20, 24, 28, 32, 36, 40]);
    for (const p of lanterns) expect(p.place, "壁際").toBe("wallFoot");
  });

  it("court でも章 1 の様式には石灯籠の列を出さない", () => {
    const map = courtMap();
    const list = placementsIn(map, mapThemeFor(3, "cave"), undefined, 0, 0, map.width - 1, map.height - 1);
    expect(list.some((p) => p.kind === "lantern"), "章 1 に石灯籠").toBe(false);
  });

  it("prefab の行き止まりは、他の型より置物が付きやすい（祠・地蔵）", () => {
    const build = (layout: FloorLayout): GameMap => {
      const map = createMap(80, 12);
      for (let i = 0; i < 20; i++) carve(map, 2 + i * 4, 2, 1, 6);
      map.layout = layout;
      return map;
    };
    const theme = mapThemeFor(7, "rooms");
    const count = (layout: FloorLayout): number => {
      const map = build(layout);
      return placementsIn(map, theme, undefined, 0, 0, map.width - 1, map.height - 1).filter((p) => p.place === "deadEnd").length;
    };
    const prefab = count("prefab");
    expect(prefab, "prefab は多くの行き止まりに置く").toBeGreaterThanOrEqual(14);
    expect(prefab, "prefab のほうが多い").toBeGreaterThan(count("cavern"));
  });

  it("isle（章 4）に燐光の珠と奈落の逆さの鳥居が出る", () => {
    const { map, theme } = floorOf(17, "cave", "isle", 1);
    const list = allPlacements(map, theme);
    expect(list.filter((p) => p.kind === "orb").length, "燐光の珠").toBeGreaterThan(0);
    const torii = list.filter((p) => p.kind === "torii");
    expect(torii.length, "逆さの鳥居").toBeGreaterThan(0);
    for (let i = 0; i < torii.length; i++) {
      for (let j = i + 1; j < torii.length; j++) {
        expect(Math.hypot(torii[i]!.tx - torii[j]!.tx, torii[i]!.ty - torii[j]!.ty), "鳥居は 10 マスに 1 つまで").toBeGreaterThanOrEqual(10);
      }
    }
  });

  it("river（章 2）: 岸の石灯籠が 5 マスおきに立つ", () => {
    const { map, theme } = floorOf(7, "rooms", "river", 1);
    const lanterns = allPlacements(map, theme).filter((p) => p.kind === "lantern");
    expect(lanterns.length, "石灯籠が出る").toBeGreaterThan(0);
    const bank = lanterns.filter((p) => tileAt(map, p.tx, p.ty - 1) === Tile.Pit || tileAt(map, p.tx + 1, p.ty) === Tile.Pit || tileAt(map, p.tx - 1, p.ty) === Tile.Pit);
    expect(bank.length, "岸に立つものがある").toBeGreaterThan(0);
    for (const p of bank) expect(p.tx % 5, `岸の石灯籠 ${p.tx},${p.ty} の x`).toBe(0);
  });

  it("奈落の置物（鳥居・岩片）は章 4・深みだけ", () => {
    const { map } = floorOf(17, "cave", "drunk", 2);
    for (const { name, theme } of THEMES) {
      const kinds = new Set(allPlacements(map, theme).map((p) => p.kind));
      const hasVoid = kinds.has("torii") || kinds.has("floatRock");
      expect(hasVoid, `${name} の奈落の置物`).toBe(theme.voidBeyond);
    }
  });
});

// ---------------------------------------------------------------------------
// 決定性
// ---------------------------------------------------------------------------

describe("mapDecor: 決定性", () => {
  it("同じ地図・テーマなら、どの範囲で呼んでも範囲内の置物は同じ（チャンクの割り方に依らない）", () => {
    const { map, theme } = floorOf(7, "rooms", "court", 1);
    const all = allPlacements(map, theme);
    const mask = buildDecorExclude(map);
    const key = (p: DecorPlacement): string => `${p.kind}@${p.tx},${p.ty}`;
    const part = placementsIn(map, theme, mask, 40, 60, 90, 110);
    const expected = all.filter((p) => p.tx >= 40 && p.tx <= 90 && p.ty >= 60 && p.ty <= 110).map(key).sort();
    expect(part.map(key).sort(), "部分の範囲").toEqual(expected);
    expect(expected.length, "範囲に置物がある").toBeGreaterThan(0);
  });

  it("同じチャンクを 2 回焼いて同じ画素と光源になる（state.rng・Math.random を使わない）", () => {
    const random = vi.spyOn(Math, "random");
    const { map, theme } = floorOf(7, "rooms", "court", 1);
    const a = bake(map, theme, 5, 6);
    const b = bake(map, theme, 5, 6);
    expect(b.ground, "ground").toEqual(a.ground);
    expect(b.lights, "lights").toEqual(a.lights);
    expect(random, "Math.random").not.toHaveBeenCalled();
  });

  it("同じ seed で別に作った 2 つの階から、同じ置物が決まる", () => {
    const a = floorOf(7, "rooms", "court", 1);
    const state = createGame(1, "1", createEmptyProfile(), createDefaultSkillProfile(), { ...defaultRunSetup(), startDepth: 7 });
    state.rng = createRng(1);
    withFixedLayout("court", () => buildFloor(state, "rooms"));
    const key = (p: DecorPlacement): string => `${p.kind}@${p.tx},${p.ty}`;
    expect(allPlacements(state.map, mapThemeFor(state.depth, state.floorKind)).map(key)).toEqual(allPlacements(a.map, a.theme).map(key));
  });

  it("テーマが違えば置物の散り方も変わる（theme.key を種に混ぜている）", () => {
    const { map } = floorOf(7, "rooms", "cavern", 1);
    const key = (p: DecorPlacement): string => `${p.tx},${p.ty}`;
    const a = allPlacements(map, mapThemeFor(7, "rooms")).map(key).join("|");
    const b = allPlacements(map, mapThemeFor(8, "mine")).map(key).join("|");
    expect(a === b, "散り方が同じ").toBe(false);
  });
});

// ---------------------------------------------------------------------------
// チャンクの境目
// ---------------------------------------------------------------------------

/** 境のすぐ両側（マス）に根元がある置物を探す */
function findSeam(map: GameMap, theme: MapTheme, axis: "x" | "y"): { cx: number; cy: number; p: DecorPlacement } | null {
  const mask = buildDecorExclude(map);
  const list = placementsIn(map, theme, mask, 0, 0, map.width - 1, map.height - 1);
  for (const p of list) {
    if (p.place === "void") continue;
    const t = axis === "x" ? p.tx : p.ty;
    const inChunk = t % CHUNK_TILES;
    // 右の / 下のチャンクの先頭の 2 マス = 隣へはみ出す（背の高い・横に広い物）、または左 / 上のチャンクの最後のマス
    if (inChunk > 1) continue;
    const cx = Math.floor(p.tx / CHUNK_TILES);
    const cy = Math.floor(p.ty / CHUNK_TILES);
    if (axis === "x" ? cx < 1 : cy < 1) continue;
    return { cx, cy, p };
  }
  return null;
}

/** 置物の位置は seed で変わるので、条件に合う置物がある階が出るまで seed を進めて探す（見つからなければ null） */
const SEARCH_SEEDS = 12;
function floorWith(depth: number, kind: FloorKind, layout: FloorLayout, has: (map: GameMap, theme: MapTheme) => boolean): Floor | null {
  for (let seed = 1; seed <= SEARCH_SEEDS; seed++) {
    const floor = floorOf(depth, kind, layout, seed);
    if (has(floor.map, floor.theme)) return floor;
  }
  return null;
}

function sameSeamPixels(map: GameMap, theme: MapTheme, cx: number, cy: number, axis: "x" | "y"): { diff: number; first: number } {
  const w = axis === "x" ? CHUNK_DOTS * 2 : CHUNK_DOTS;
  const h = axis === "x" ? CHUNK_DOTS : CHUNK_DOTS * 2;
  // x: (cx - 1, cy) と (cx, cy)、y: (cx, cy - 1) と (cx, cy)
  const x0 = (axis === "x" ? cx - 1 : cx) * CHUNK_DOTS;
  const y0 = (axis === "y" ? cy - 1 : cy) * CHUNK_DOTS;
  const mask = buildDecorExclude(map);
  const wide = createRectBake({ map, theme, x: x0, y: y0, w, h, exclude: mask });
  while (!wide.done) wide.step(512);
  const first = bake(map, theme, axis === "x" ? cx - 1 : cx, axis === "y" ? cy - 1 : cy, mask);
  const second = bake(map, theme, cx, cy, mask);
  const g = wide.result().ground;
  let diff = 0;
  let firstDiff = -1;
  for (let j = 0; j < CHUNK_DOTS; j++) {
    for (let i = 0; i < CHUNK_DOTS; i++) {
      const o = j * CHUNK_DOTS + i;
      const idxA = axis === "x" ? j * w + i : j * w + i;
      const idxB = axis === "x" ? j * w + CHUNK_DOTS + i : (j + CHUNK_DOTS) * w + i;
      if (g[idxA] !== first.ground[o] || g[idxB] !== second.ground[o]) {
        diff++;
        if (firstDiff < 0) firstDiff = o;
      }
    }
  }
  return { diff, first: firstDiff };
}

describe("mapDecor: チャンクの境目", () => {
  it.each([
    { name: "章 2 寺院（court）", depth: 7, kind: "rooms", layout: "court" },
    { name: "章 1 苔の洞（cavern）", depth: 3, kind: "cave", layout: "cavern" },
    { name: "章 3 廃城（炎・cavern）", depth: 12, kind: "forge", layout: "cavern" },
    { name: "章 4 異界（drunk）", depth: 17, kind: "cave", layout: "drunk" },
  ] as const)("$name: 隣り合う 2 チャンクは、同じ範囲を 1 枚で焼いた結果と一致する（左右・上下）", ({ depth, kind, layout }) => {
    for (const axis of ["x", "y"] as const) {
      const floor = floorWith(depth, kind, layout, (m, t) => findSeam(m, t, axis) !== null);
      expect(floor, `${axis} 方向の境に根元がある置物がある階`).not.toBeNull();
      if (!floor) continue;
      const { map, theme } = floor;
      const seam = findSeam(map, theme, axis);
      if (!seam) continue;
      const r = sameSeamPixels(map, theme, seam.cx, seam.cy, axis);
      expect(r.diff, `${axis} 方向の継ぎ目の不一致ドット数`).toBe(0);
    }
  });

  it("チャンクの外に根元がある背の高い置物も、はみ出す分は描かれる（根元の下のチャンクの上端に出る）", () => {
    // 下のチャンクの先頭のマス行に根元がある、背の高い置物（絵の上端が上のチャンクに入る）
    const findTall = (map: GameMap, theme: MapTheme): DecorPlacement | undefined =>
      allPlacements(map, theme).find((p) => TALL_PROPS.has(p.kind) && p.ty % CHUNK_TILES === 0 && p.ty >= CHUNK_TILES);
    const floor = floorWith(7, "rooms", "court", (m, t) => findTall(m, t) !== undefined);
    expect(floor, "背の高い置物が先頭の行に立つ階がある").not.toBeNull();
    if (!floor) return;
    const { map, theme } = floor;
    const mask = buildDecorExclude(map);
    const tall = findTall(map, theme);
    expect(tall, "チャンクの先頭の行に根元がある背の高い置物").toBeDefined();
    if (!tall) return;
    const cx = Math.floor(tall.tx / CHUNK_TILES);
    const upper = Math.floor(tall.ty / CHUNK_TILES) - 1;
    const withProp = bake(map, theme, cx, upper, mask);
    // その置物のマスだけ除外した地図で焼き直すと、上のチャンクの画素が変わる = はみ出しが描かれていた
    const without = mask.slice();
    without[toIndex(map, tall.tx, tall.ty)] = 1;
    const baseline = bake(map, theme, cx, upper, without);
    let diff = 0;
    for (let i = 0; i < withProp.ground.length; i++) if (withProp.ground[i] !== baseline.ground[i]) diff++;
    expect(diff, `${tall.kind}@${tall.tx},${tall.ty} のはみ出し`).toBeGreaterThan(0);
  });

  it("光源は根元のあるチャンクだけが返し、隣り合う 2 チャンクの合計は 1 枚で焼いた結果と一致する（二重にならない）", () => {
    const { map, theme } = floorOf(7, "rooms", "court", 1);
    const mask = buildDecorExclude(map);
    const sum = (o: BakeOutput): string => o.lights.map((l) => `${l.x},${l.y},${l.r},${l.color}`).sort().join("|");
    let checked = 0;
    for (let cx = 1; cx * CHUNK_TILES < map.width && checked < 1; cx++) {
      for (let cy = 0; cy * CHUNK_TILES < map.height && checked < 1; cy++) {
        const left = bake(map, theme, cx - 1, cy, mask);
        const right = bake(map, theme, cx, cy, mask);
        if (left.lights.length === 0 && right.lights.length === 0) continue;
        const wide = createRectBake({ map, theme, x: (cx - 1) * CHUNK_DOTS, y: cy * CHUNK_DOTS, w: CHUNK_DOTS * 2, h: CHUNK_DOTS, exclude: mask });
        while (!wide.done) wide.step(512);
        const merged = [...left.lights, ...right.lights].map((l) => `${l.x},${l.y},${l.r},${l.color}`).sort().join("|");
        expect(merged, "光源の合計").toBe(sum(wide.result()));
        checked++;
      }
    }
    expect(checked, "光源のある隣り合うチャンクがある").toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 描き込み
// ---------------------------------------------------------------------------

describe("mapDecor: 描き込み", () => {
  /** 汚し・置物・側面の飾りを個別に調べるための地図（部屋 + 柱 + 行き止まり） */
  function bigRoom(): GameMap {
    const map = createMap(30, 30);
    carve(map, 3, 5, 24, 20);
    carve(map, 14, 25, 1, 4);
    for (let i = 0; i < 6; i++) map.tiles[toIndex(map, 6 + i * 3, 12)] = Tile.Wall;
    return map;
  }
  const FULL = { x: 0, y: 0, w: 30 * TILE_DOTS, h: 30 * TILE_DOTS };
  /** 置物・汚し・側面の飾りを 1 種類ずつ有効にした、同じ配色のテーマ */
  function only(theme: MapTheme, part: "decals" | "side" | "props"): MapTheme {
    const flags = { ...theme.flags, drips: false, soot: false, frost: false, shafts: false };
    // 異界の金の経文は様式で決まる側面の飾りなので、汚しだけを見るときは様式を最深の間（飾りなし）にする
    if (part === "decals") return { ...theme, style: "final", props: [], flags: { ...flags, sideMoss: false, shimenawa: false, redPillar: false, beams: false, banners: false, icicles: false } };
    if (part === "side") return { ...theme, props: [], decals: [], flags: { ...flags, sideMoss: true, shimenawa: true, redPillar: true, beams: true, banners: true, icicles: true } };
    return { ...theme, decals: [], flags: { ...flags, sideMoss: false, shimenawa: false, redPillar: false, beams: false, banners: false, icicles: false } };
  }

  it.each(THEMES)("$name: 床の汚しは床のドットだけに描く", ({ theme }) => {
    const map = bigRoom();
    const { dots, surface } = paintedDots(map, only(theme, "decals"), FULL.x, FULL.y, FULL.w, FULL.h);
    for (const [wx, wy] of dots) expect(surface.kindAt(wx, wy), `汚しのドット (${wx},${wy})`).toBe(DOT_FLOOR);
    if (theme.decals.length > 0) expect(dots.length, "汚しが描かれる").toBeGreaterThan(0);
  });

  it("側面の飾り（注連縄・朱の柱・坑木・旗・氷柱・蛍苔・金の経文）は側面の高さの中だけに描く", () => {
    for (const style of [mapThemeFor(3, "cave"), mapThemeFor(7, "rooms"), mapThemeFor(12, "forge"), mapThemeFor(13, "glacier"), mapThemeFor(17, "cave")]) {
      const map = bigRoom();
      const theme = only(style, "side");
      const { dots, surface } = paintedDots(map, theme, FULL.x, FULL.y, FULL.w, FULL.h);
      expect(dots.length, `${theme.style} の側面の飾りが描かれる`).toBeGreaterThan(0);
      for (const [wx, wy] of dots) {
        expect(surface.kindAt(wx, wy), `${theme.style} の側面の飾り (${wx},${wy}) は壁`).toBe(DOT_WALL);
        expect(surface.wallRun(wx, wy), `${theme.style} の側面の飾り (${wx},${wy}) は側面の高さ ${theme.sideH} 以内`).toBeLessThanOrEqual(theme.sideH);
      }
    }
  });

  it("線路は壁に挟まれた 4 マス以上のまっすぐな通路にだけ敷く（坑道）", () => {
    const mine = mapThemeFor(8, "mine");
    const flags = { ...mine.flags, beams: false, banners: false, shimenawa: false, redPillar: false, icicles: false, sideMoss: false };
    const theme: MapTheme = { ...mine, props: [], decals: ["rail"], flags };
    const map = createMap(40, 20);
    carve(map, 2, 5, 8, 8);
    carve(map, 10, 8, 20, 1);
    carve(map, 30, 5, 8, 8);
    carve(map, 20, 14, 2, 1);
    const { dots } = paintedDots(map, theme, 0, 0, 40 * TILE_DOTS, 20 * TILE_DOTS);
    expect(dots.length, "通路に線路が敷かれる").toBeGreaterThan(0);
    for (const [wx, wy] of dots) {
      const ty = Math.floor(wy / TILE_DOTS);
      const tx = Math.floor(wx / TILE_DOTS);
      expect(ty === 8 && tx >= 10 && tx < 30, `線路のドット (${tx},${ty}) は通路の中`).toBe(true);
    }
  });

  it("墨の石（最深の間）: 砂紋が避ける石の一覧が返り、砂紋でない様式では空", () => {
    const final = mapThemeFor(21, "rooms");
    const map = bigRoom();
    const stones = texStonesFor(map, final, undefined, 0, 0, FULL.w, FULL.h);
    const placed = placementsIn(map, final, undefined, -3, -3, 33, 33).filter((p) => p.kind === "stone");
    expect(stones.length, "石の数が一致").toBe(placed.length);
    for (const s of stones) expect(s.ring, "同心円の半径").toBeGreaterThan(0);
    expect(texStonesFor(map, mapThemeFor(7, "rooms"), undefined, 0, 0, FULL.w, FULL.h), "砂紋でない様式").toEqual([]);
  });

  it("光源: 石灯籠は 46px・篝火は 52px・氷晶は 29px。色はテーマの光の色で、位置は根元のあるチャンクの中", () => {
    const radiusOf: Record<string, number> = { lantern: 46, brazier: 52, crystal: 29, andon: 43, orb: 35 };
    for (const [depth, kind, prop] of [
      [7, "rooms", "lantern"],
      [12, "forge", "brazier"],
      [13, "glacier", "crystal"],
    ] as const) {
      const { map, theme } = floorOf(depth, kind, "court", 1);
      const found = allPlacements(map, theme).find((p) => p.kind === prop);
      if (!found) continue;
      const cx = Math.floor(found.tx / CHUNK_TILES);
      const cy = Math.floor(found.ty / CHUNK_TILES);
      const out = bake(map, theme, cx, cy);
      const near = out.lights.filter((l) => l.r === radiusOf[prop]);
      expect(near.length, `${prop} の光（半径 ${radiusOf[prop]}）`).toBeGreaterThan(0);
      for (const l of near) {
        expect(l.x >= cx * CHUNK_DOTS / 2 && l.x < (cx + 1) * CHUNK_DOTS / 2, "光の x がチャンクの中").toBe(true);
        expect(l.y >= cy * CHUNK_DOTS / 2 - 40 && l.y < (cy + 1) * CHUNK_DOTS / 2, "光の y がチャンクの中（絵の光の芯は根元より上）").toBe(true);
      }
    }
  });

  it("全テーマで 1 チャンクの描き込みが 100ms 以下（緩い上限。ms は出力）", () => {
    const { map } = floorOf(7, "rooms", "court", 1);
    const mask = buildDecorExclude(map);
    const ground = new Uint32Array(CHUNK_DOTS * CHUNK_DOTS);
    const surface = tileSurface(map);
    const rows: string[] = [];
    for (const { name, theme } of THEMES) {
      const t0 = performance.now();
      decorateChunk({ map, theme, exclude: mask, x: 5 * CHUNK_DOTS, y: 6 * CHUNK_DOTS, w: CHUNK_DOTS, h: CHUNK_DOTS, ground, surface });
      const ms = performance.now() - t0;
      rows.push(`${name} ${ms.toFixed(1)}ms`);
      expect(ms, `${name} の描き込み`).toBeLessThan(100);
    }
    console.log(`mapDecor 描き込み: ${rows.join(" / ")}`);
  });
});

describe("mapDecor: 手前の縁と汚し", () => {
  /** lip の画素のうち、ground と違う画素の数（縁を描き直す矩形の端で、汚しや飾りが切れて見える所） */
  function lipMismatch(out: BakeOutput): { diff: number; lip: number } {
    let diff = 0;
    let lip = 0;
    for (let i = 0; i < out.lip.length; i++) {
      const c = out.lip[i] ?? 0;
      if (c === 0) continue;
      lip++;
      if (c !== out.ground[i]) diff++;
    }
    return { diff, lip };
  }

  it("縁の画素は焼いた ground と同じ（汚し・飾り・置物を描き込んだ後の色。描き直す矩形の端で切れない）", () => {
    const cases: readonly [number, FloorKind, FloorLayout][] = [
      [3, "cave", "cavern"],
      [7, "rooms", "court"],
      [8, "mine", "prefab"],
      [12, "forge", "terrace"],
      [13, "glacier", "drunk"],
      [17, "cave", "isle"],
      [21, "rooms", "ring"],
    ];
    const report: string[] = [];
    for (const [depth, kind, layout] of cases) {
      const { map, theme } = floorOf(depth, kind, layout, 2);
      const exclude = buildDecorExclude(map);
      let lip = 0;
      let diff = 0;
      for (let cy = 0; cy * CHUNK_TILES < map.height && cy < 3; cy++) {
        for (let cx = 0; cx * CHUNK_TILES < map.width && cx < 3; cx++) {
          const m = lipMismatch(bake(map, theme, cx, cy, exclude));
          lip += m.lip;
          diff += m.diff;
        }
      }
      report.push(`${depth}/${kind}/${layout} ${diff}/${lip}`);
      expect(lip, `深度 ${depth} ${kind} ${layout} に縁がある`).toBeGreaterThan(0);
      expect(diff, `深度 ${depth} ${kind} ${layout} で縁と ground が違う画素（縁 ${lip}）`).toBe(0);
    }
    console.log(`縁と ground の差: ${report.join(" / ")}`);
  });
});
