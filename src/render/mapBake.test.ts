import { afterEach, describe, expect, it, vi } from "vitest";
import { createGame } from "../core/game";
import { createRng } from "../core/rng";
import { Tile, createMap, toIndex, type GameMap } from "../map/grid";
import { colorB, colorR, mapThemeFor, packedPitColors } from "./mapTheme";
import { buildVertexDepth } from "./dualGrid";
import { createChunkBake, createRectBake } from "./mapBake";
import { CHUNK_DOTS, TILE_DOTS, type BakeOutput, type ChunkBakeInput, type MapTheme } from "./mapTypes";

/** 部屋・柱・穴・浅瀬が混じる 40x40 の地図（乱数は固定の種。本体の生成器には依存しない） */
function sampleMap(seed = 3, pits = true): GameMap {
  const map = createMap(40, 40);
  const rng = createRng(seed);
  const carve = (x: number, y: number, w: number, h: number): void => {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) map.tiles[toIndex(map, i, j)] = Tile.Floor;
  };
  carve(2, 2, 16, 14);
  carve(14, 10, 22, 12);
  carve(6, 20, 14, 16);
  carve(24, 24, 12, 12);
  for (let n = 0; n < 40; n++) map.tiles[toIndex(map, 3 + Math.floor(rng.next() * 32), 3 + Math.floor(rng.next() * 32))] = Tile.Wall;
  if (pits) {
    for (let j = 12; j < 18; j++) for (let i = 22; i < 30; i++) map.tiles[toIndex(map, i, j)] = Tile.Pit;
    for (let j = 28; j < 31; j++) for (let i = 8; i < 12; i++) map.tiles[toIndex(map, i, j)] = Tile.Pit;
  }
  map.tiles[toIndex(map, 9, 9)] = Tile.StairsDown;
  map.tiles[toIndex(map, 10, 9)] = Tile.Fountain;
  return map;
}

const THEMES: readonly { name: string; theme: MapTheme }[] = [
  { name: "章 1 苔の洞", theme: mapThemeFor(1, "cave") },
  { name: "章 1 沼", theme: mapThemeFor(3, "swamp") },
  { name: "章 2 寺院", theme: mapThemeFor(7, "rooms") },
  { name: "章 3 廃城（炎）", theme: mapThemeFor(12, "forge") },
  { name: "章 3 廃城（霜）", theme: mapThemeFor(13, "glacier") },
  { name: "章 4 異界", theme: mapThemeFor(17, "cave") },
  { name: "最深の間", theme: mapThemeFor(21, "rooms") },
  { name: "深み（血の月）", theme: mapThemeFor(22, "cave") },
];

function bake(input: ChunkBakeInput, rows: number): BakeOutput {
  const job = createChunkBake(input);
  while (!job.done) job.step(rows);
  return job.result();
}

function inputOf(map: GameMap, theme: MapTheme, cx = 0, cy = 0): ChunkBakeInput {
  return { map, cx, cy, theme };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("mapBake: 決定性と分割", () => {
  it("step の行数が 1 / 7 / 64 / 全部 のどれでも ground と lip が同じ画素になる", () => {
    const input = inputOf(sampleMap(), mapThemeFor(1, "cave"), 0, 0);
    const all = bake(input, 100000);
    for (const rows of [1, 7, 64]) {
      const out = bake(input, rows);
      expect(out.ground, `${rows} 行ずつの ground`).toEqual(all.ground);
      expect(out.lip, `${rows} 行ずつの lip`).toEqual(all.lip);
    }
  });

  it("done は焼き終えるまで false で、焼き終えたら true のまま変わらない", () => {
    const job = createChunkBake(inputOf(sampleMap(), mapThemeFor(1, "cave")));
    expect(job.done, "最初は未完了").toBe(false);
    job.step(1);
    expect(job.done, "1 単位では終わらない").toBe(false);
    let guard = 0;
    while (!job.done && guard++ < 5000) job.step(1);
    expect(job.done, "刻んでも終わる").toBe(true);
    job.step(100);
    expect(job.done, "余分に進めても完了のまま").toBe(true);
  });

  it("step に 0 や負の行数を渡しても何も焼かない", () => {
    const job = createChunkBake(inputOf(sampleMap(), mapThemeFor(1, "cave")));
    job.step(0);
    job.step(-5);
    expect(job.done).toBe(false);
    expect(job.result().ground.every((v) => v === 0), "何も焼いていない").toBe(true);
  });

  it("同じ地図を 2 回焼くと同じ画素になる（作業用配列を使い回しても残りが出ない）", () => {
    const input = inputOf(sampleMap(), mapThemeFor(12, "forge"), 0, 0);
    const first = bake(input, 64);
    // 別の地図・別の様式を挟んで、返された作業用配列に前の結果が残っている状況を作る
    bake(inputOf(sampleMap(9, false), mapThemeFor(17, "cave"), 1, 1), 64);
    const second = bake(input, 64);
    expect(second.ground, "ground").toEqual(first.ground);
    expect(second.lip, "lip").toEqual(first.lip);
  });

  it("同じ seed で別に作った 2 つの state の地図から、同じ画素が焼ける", () => {
    const a = createGame(11);
    const b = createGame(11);
    const themeA = mapThemeFor(a.depth, a.floorKind);
    const themeB = mapThemeFor(b.depth, b.floorKind);
    const outA = bake(inputOf(a.map, themeA, 0, 0), 128);
    const outB = bake(inputOf(b.map, themeB, 0, 0), 128);
    expect(outB.ground, "ground").toEqual(outA.ground);
    expect(outB.lip, "lip").toEqual(outA.lip);
  });

  it("焼いても state.rng と Math.random を一度も呼ばない", () => {
    const state = createGame(5);
    let draws = 0;
    const spy = (): number => {
      draws++;
      return 0;
    };
    state.rng = { next: spy, int: spy, chance: () => (spy(), false), pick: <T>(arr: readonly T[]) => (spy(), arr[0] as T) };
    const random = vi.spyOn(Math, "random");
    bake(inputOf(state.map, mapThemeFor(state.depth, state.floorKind), 0, 0), 128);
    expect(draws, "state.rng を引かない").toBe(0);
    expect(random, "Math.random を呼ばない").not.toHaveBeenCalled();
  });

  it("呼び出し側が渡した頂点の深さと、焼き付けの中で作った深さで同じ画素になる", () => {
    const map = sampleMap();
    const theme = mapThemeFor(17, "cave");
    const own = bake(inputOf(map, theme, 1, 0), 128);
    const shared = bake({ ...inputOf(map, theme, 1, 0), depth: buildVertexDepth(map) }, 128);
    expect(shared.ground).toEqual(own.ground);
  });
});

describe("mapBake: チャンクの継ぎ目", () => {
  it.each(THEMES)("$name: 隣り合う 2 チャンクは、同じ範囲を 1 枚で焼いた結果と一致する", ({ theme }) => {
    const map = sampleMap();
    const w = CHUNK_DOTS * 2;
    const wide = createRectBake({ map, theme, x: 0, y: CHUNK_DOTS, w, h: CHUNK_DOTS });
    while (!wide.done) wide.step(256);
    const left = bake(inputOf(map, theme, 0, 1), 256);
    const right = bake(inputOf(map, theme, 1, 1), 256);
    const { ground: g, lip: l } = wide.result();
    let groundDiff = 0;
    let lipDiff = 0;
    for (let y = 0; y < CHUNK_DOTS; y++) {
      for (let x = 0; x < CHUNK_DOTS; x++) {
        if (g[y * w + x] !== left.ground[y * CHUNK_DOTS + x]) groundDiff++;
        if (g[y * w + CHUNK_DOTS + x] !== right.ground[y * CHUNK_DOTS + x]) groundDiff++;
        if (l[y * w + x] !== left.lip[y * CHUNK_DOTS + x]) lipDiff++;
        if (l[y * w + CHUNK_DOTS + x] !== right.lip[y * CHUNK_DOTS + x]) lipDiff++;
      }
    }
    expect(groundDiff, "ground の食い違うドット数").toBe(0);
    expect(lipDiff, "lip の食い違うドット数").toBe(0);
  });

  it("縦に隣り合うチャンクも、1 枚で焼いた結果と一致する（崖・影・縁の余白が足りている）", () => {
    const map = sampleMap();
    const theme = mapThemeFor(17, "cave");
    const tall = createRectBake({ map, theme, x: CHUNK_DOTS, y: 0, w: CHUNK_DOTS, h: CHUNK_DOTS * 2 });
    while (!tall.done) tall.step(256);
    const top = bake(inputOf(map, theme, 1, 0), 256);
    const bottom = bake(inputOf(map, theme, 1, 1), 256);
    const { ground: g, lip: l } = tall.result();
    const half = CHUNK_DOTS * CHUNK_DOTS;
    expect(g.subarray(0, half), "上の ground").toEqual(top.ground);
    expect(g.subarray(half), "下の ground").toEqual(bottom.ground);
    expect(l.subarray(0, half), "上の lip").toEqual(top.lip);
    expect(l.subarray(half), "下の lip").toEqual(bottom.lip);
  });
});

describe("mapBake: 絵の中身", () => {
  it.each(THEMES)("$name: 全ドットが不透明の色で塗られ、地図の外のチャンクも埋まる", ({ theme }) => {
    const map = sampleMap();
    for (const [cx, cy] of [
      [0, 0],
      [1, 1],
      [2, 2],
      [-1, 0],
    ] as const) {
      const out = bake(inputOf(map, theme, cx, cy), 256);
      let unpainted = 0;
      for (const v of out.ground) if (v >>> 24 !== 255) unpainted++;
      expect(unpainted, `チャンク (${cx}, ${cy}) の未塗りのドット`).toBe(0);
    }
  });

  /** 床が 2..13、南の壁が 14・15 の地図（チャンク (0, 0) の中に南の壁がある） */
  function roomMap(): GameMap {
    const map = createMap(24, 24);
    for (let y = 2; y < 14; y++) for (let x = 2; x < 14; x++) map.tiles[toIndex(map, x, y)] = Tile.Floor;
    return map;
  }

  it("lip は南の壁の手前（床へ 6 ドット + 壁の天面 14 ドット）にだけ出る", () => {
    // 縁の揺らぎが無い様式（寺院）で数える。洞窟は揺らぎで角に 1 ドットの床が残り、その下に縁が出る
    const theme = mapThemeFor(7, "rooms");
    const out = bake(inputOf(roomMap(), theme, 0, 0), 256);
    const southEdge = 14 * TILE_DOTS;
    // 角の面取りの分だけ、角では縁が床の奥から始まる
    const bandStart = southEdge - 6 - theme.cornerR;
    let inBand = 0;
    let outside: string[] = [];
    for (let y = 0; y < CHUNK_DOTS; y++) {
      for (let x = 0; x < CHUNK_DOTS; x++) {
        if (!out.lip[y * CHUNK_DOTS + x]) continue;
        if (y >= bandStart && y < southEdge + 14) inBand++;
        else if (outside.length < 5) outside = [...outside, `(${x}, ${y})`];
      }
    }
    expect(inBand, "南の壁の手前に lip がある").toBeGreaterThan(CHUNK_DOTS / 2);
    expect(outside, "それ以外の行に lip は出ない").toEqual([]);
  });

  it("北の壁・床の中ほどには lip が出ない", () => {
    const out = bake(inputOf(roomMap(), mapThemeFor(7, "rooms"), 0, 0), 256);
    const rows = (from: number, to: number): number => {
      let n = 0;
      for (let y = from; y < to; y++) for (let x = 0; x < CHUNK_DOTS; x++) if (out.lip[y * CHUNK_DOTS + x]) n++;
      return n;
    };
    expect(rows(0, 2 * TILE_DOTS + 40), "北の壁").toBe(0);
    expect(rows(3 * TILE_DOTS, 12 * TILE_DOTS), "床の中ほど").toBe(0);
  });

  it("穴の中は穴の色（水は青系）で、穴の北の縁は岸の色の帯になる", () => {
    const map = createMap(24, 24);
    for (let y = 2; y < 20; y++) for (let x = 2; x < 20; x++) map.tiles[toIndex(map, x, y)] = Tile.Floor;
    for (let y = 8; y < 13; y++) for (let x = 8; x < 14; x++) map.tiles[toIndex(map, x, y)] = Tile.Pit;
    const theme = mapThemeFor(3, "rooms");
    const bank = packedPitColors(theme.pit)?.bank;
    const out = bake(inputOf(map, theme, 0, 0), 256);
    const at = (tx: number, ty: number, dx: number, dy: number): number => out.ground[(ty * TILE_DOTS + dy) * CHUNK_DOTS + tx * TILE_DOTS + dx] ?? 0;
    const center = at(10, 10, 16, 16);
    expect(colorB(center) > colorR(center), "水の中は青い").toBe(true);
    expect(at(10, 8, 16, 3), "北の縁（床の切り口）は岸の色").toBe(bank);
    expect(at(10, 12, 16, 28), "南の縁は岸の帯にならない").not.toBe(bank);
  });

  it("穴の北の隣が浅瀬なら、その辺の縁を描かず水が続く", () => {
    const map = createMap(24, 24);
    for (let y = 2; y < 20; y++) for (let x = 2; x < 20; x++) map.tiles[toIndex(map, x, y)] = Tile.Floor;
    for (let y = 8; y < 13; y++) for (let x = 8; x < 14; x++) map.tiles[toIndex(map, x, y)] = Tile.Pit;
    const theme = mapThemeFor(3, "rooms");
    const bank = packedPitColors(theme.pit)?.bank;
    const plain = bake(inputOf(map, theme, 0, 0), 256);
    const shallow = new Uint8Array(map.width * map.height);
    shallow[toIndex(map, 10, 7)] = 1;
    const withShallow = bake(inputOf({ ...map, shallow }, theme, 0, 0), 256);
    const index = (8 * TILE_DOTS + 3) * CHUNK_DOTS + 10 * TILE_DOTS + 16;
    expect(plain.ground[index], "浅瀬が無ければ岸の帯").toBe(bank);
    expect(withShallow.ground[index], "浅瀬があれば岸の帯にならない").not.toBe(bank);
  });

  it("奈落の穴の中は暗く、北の縁には崖が下がる（床の色より暗い）", () => {
    const map = createMap(24, 24);
    for (let y = 2; y < 20; y++) for (let x = 2; x < 20; x++) map.tiles[toIndex(map, x, y)] = Tile.Floor;
    for (let y = 8; y < 14; y++) for (let x = 8; x < 14; x++) map.tiles[toIndex(map, x, y)] = Tile.Pit;
    const theme = mapThemeFor(17, "cave");
    expect(theme.pit).toBe("abyss");
    const out = bake(inputOf(map, theme, 0, 0), 256);
    const luma = (c: number): number => (c & 255) + ((c >>> 8) & 255) + ((c >>> 16) & 255);
    const at = (tx: number, ty: number, dx: number, dy: number): number => out.ground[(ty * TILE_DOTS + dy) * CHUNK_DOTS + tx * TILE_DOTS + dx] ?? 0;
    const floor = luma(at(5, 5, 4, 4));
    expect(luma(at(11, 11, 16, 16)), "奈落の底は床より暗い").toBeLessThan(floor);
    expect(luma(at(11, 8, 16, 2)), "北の縁の崖").toBeGreaterThan(luma(at(11, 11, 16, 16)));
  });

  it("壁の天面は床から離れるほど暗くなる（岩盤の闇）", () => {
    const map = createMap(24, 24);
    for (let y = 8; y < 16; y++) for (let x = 8; x < 16; x++) map.tiles[toIndex(map, x, y)] = Tile.Floor;
    const theme = mapThemeFor(1, "cave");
    const out = bake(inputOf(map, theme, 0, 0), 256);
    const luma = (c: number): number => (c & 255) + ((c >>> 8) & 255) + ((c >>> 16) & 255);
    // 部屋の西の壁の天面（行の中ほど）を、床の縁から遠ざかる向きに平均する
    const rowY = 11 * TILE_DOTS;
    const band = (fromTile: number): number => {
      let sum = 0;
      for (let dx = 0; dx < TILE_DOTS; dx++) for (let dy = 0; dy < 8; dy++) sum += luma(out.ground[(rowY + dy) * CHUNK_DOTS + fromTile * TILE_DOTS + dx] ?? 0);
      return sum / (TILE_DOTS * 8);
    };
    expect(band(2), "3 マス奥は縁より暗い").toBeLessThan(band(7));
  });
});

describe("mapBake: 性能", () => {
  it("全テーマで 1 チャンクが 250ms 以内（目標は 25ms。値は統合役が見る）", () => {
    const map = sampleMap();
    const lines: string[] = [];
    for (const { name, theme } of THEMES) {
      // 初回の JIT を除くため 1 枚捨ててから測る
      bake(inputOf(map, theme, 0, 0), 256);
      const t0 = performance.now();
      bake(inputOf(map, theme, 1, 1), 256);
      const ms = performance.now() - t0;
      lines.push(`${name} ${ms.toFixed(1)}ms`);
      expect(ms, `${name} の 1 チャンク`).toBeLessThan(250);
    }
    console.log(`[mapBake 性能] ${lines.join(" / ")}`);
  });

  it("step 1 回あたりの重さが偏らない（準備の 1 単位が塗り 1 行の数倍を超えない）", () => {
    const map = sampleMap();
    const job = createChunkBake(inputOf(map, mapThemeFor(1, "cave"), 1, 1));
    const costs: number[] = [];
    while (!job.done) {
      const t0 = performance.now();
      job.step(8);
      costs.push(performance.now() - t0);
    }
    expect(Math.max(...costs), "8 単位の最大").toBeLessThan(250);
  });
});

describe("mapBake: テーマの色", () => {
  it("焼いた色が章の様式の色と合っている（章 4 の異界は紫、章 3 の炎は赤茶）", () => {
    const map = sampleMap(3, false);
    const deep = bake(inputOf(map, mapThemeFor(17, "cave"), 0, 0), 256);
    const fire = bake(inputOf(map, mapThemeFor(12, "forge"), 0, 0), 256);
    const mean = (ground: Uint32Array): [number, number, number] => {
      let r = 0;
      let g = 0;
      let b = 0;
      for (const c of ground) {
        r += c & 255;
        g += (c >>> 8) & 255;
        b += (c >>> 16) & 255;
      }
      return [r / ground.length, g / ground.length, b / ground.length];
    };
    const [dr, , db] = mean(deep.ground);
    const [fr, , fb] = mean(fire.ground);
    expect(db, "異界は青みが赤より強い").toBeGreaterThan(dr);
    expect(fr, "炎は赤みが青より強い").toBeGreaterThan(fb);
  });
});
