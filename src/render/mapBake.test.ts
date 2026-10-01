import { describe, expect, it } from "vitest";
import { Tile, createMap, toIndex } from "../map/grid";
import { createChunkBake, placeholderTheme } from "./mapBake";
import { CHUNK_DOTS, CHUNK_TILES, TILE_DOTS, type ChunkBakeInput } from "./mapTypes";

/** 床・壁・穴が混じる 20x20 の地図 */
function sampleInput(cx = 0, cy = 0): ChunkBakeInput {
  const map = createMap(20, 20);
  for (let y = 2; y < 18; y++) {
    for (let x = 2; x < 18; x++) map.tiles[toIndex(map, x, y)] = Tile.Floor;
  }
  map.tiles[toIndex(map, 5, 5)] = Tile.Pit;
  map.tiles[toIndex(map, 6, 5)] = Tile.Pit;
  map.tiles[toIndex(map, 9, 9)] = Tile.StairsDown;
  map.tiles[toIndex(map, 10, 9)] = Tile.Fountain;
  return { map, cx, cy, theme: placeholderTheme() };
}

function bakeWithSteps(input: ChunkBakeInput, rows: number): Uint32Array {
  const job = createChunkBake(input);
  while (!job.done) job.step(rows);
  return job.result().ground;
}

describe("mapBake: 仮の平塗り", () => {
  it("step の行数が 1 / 7 / 全部 のどれでも同じ画素になる", () => {
    const input = sampleInput();
    const all = bakeWithSteps(input, CHUNK_DOTS);
    expect(bakeWithSteps(input, 7), "7 行ずつ").toEqual(all);
    // 1 行ずつは 512 回の呼び出しで足りる
    expect(bakeWithSteps(input, 1), "1 行ずつ").toEqual(all);
  });

  it("done は全行を焼くまで false で、焼き終わると true のまま変わらない", () => {
    const job = createChunkBake(sampleInput());
    expect(job.done, "最初は未完了").toBe(false);
    job.step(CHUNK_DOTS - 1);
    expect(job.done, "あと 1 行").toBe(false);
    job.step(1);
    expect(job.done, "全行を焼いた").toBe(true);
    job.step(100);
    expect(job.done, "余分に進めても完了のまま").toBe(true);
  });

  it("step に 0 や負の行数を渡しても進まない", () => {
    const job = createChunkBake(sampleInput());
    job.step(0);
    job.step(-5);
    expect(job.done).toBe(false);
    const ground = job.result().ground;
    expect(ground.every((v) => v === 0), "何も焼いていない").toBe(true);
  });

  it("床 / 壁 / 穴 がパレットの色で平塗りされ、階段と泉は床の色になる", () => {
    const input = sampleInput();
    const { palette } = input.theme;
    const ground = bakeWithSteps(input, CHUNK_DOTS);
    const at = (tx: number, ty: number): number | undefined =>
      ground[(ty * TILE_DOTS + 3) * CHUNK_DOTS + tx * TILE_DOTS + 5];
    expect(at(0, 0), "地図の隅は壁").toBe(palette.tB);
    expect(at(3, 3), "床").toBe(palette.fB);
    expect(at(5, 5), "穴").toBe(palette.vD);
    expect(at(9, 9), "階段").toBe(palette.fB);
    expect(at(10, 9), "泉").toBe(palette.fB);
  });

  it("1 マスの中は全ドットが同じ色で、マスの境目で色が切り替わる", () => {
    const input = sampleInput();
    const ground = bakeWithSteps(input, CHUNK_DOTS);
    const { palette } = input.theme;
    // x = 1 と x = 2 の境目（壁 → 床）
    const row = 5 * TILE_DOTS + 11;
    expect(ground[row * CHUNK_DOTS + 2 * TILE_DOTS - 1], "壁の最後のドット").toBe(palette.tB);
    expect(ground[row * CHUNK_DOTS + 2 * TILE_DOTS], "床の最初のドット").toBe(palette.fB);
  });

  it("地図の外のチャンクは壁で埋まり、lip は全 0・lights は空", () => {
    const input = sampleInput(1, 1);
    const job = createChunkBake(input);
    job.step(CHUNK_DOTS);
    const out = job.result();
    // チャンク (1, 1) は x, y とも 16 以上。地図の 20x20 のうち内側の 16..17 が床
    const at = (tx: number, ty: number): number | undefined =>
      out.ground[(ty * TILE_DOTS) * CHUNK_DOTS + tx * TILE_DOTS];
    expect(at(0, 0), "地図の中の床").toBe(input.theme.palette.fB);
    expect(at(CHUNK_TILES - 1, CHUNK_TILES - 1), "地図の外は壁").toBe(input.theme.palette.tB);
    expect(out.lip.every((v) => v === 0), "lip は透明").toBe(true);
    expect(out.lights.length, "lights は空").toBe(0);
  });

  it("同じ入力で 2 回焼くと同じ画素になる", () => {
    const input = sampleInput();
    expect(bakeWithSteps(input, 32)).toEqual(bakeWithSteps(input, 32));
  });
});

describe("mapBake: placeholderTheme", () => {
  it("パレットの全色が不透明の 32bit で、key が空でない", () => {
    const theme = placeholderTheme();
    expect(theme.key.length).toBeGreaterThan(0);
    for (const [name, color] of Object.entries(theme.palette)) {
      expect(Number.isInteger(color) && color >>> 24 === 255, `${name} が不透明の ABGR`).toBe(true);
    }
  });
});
