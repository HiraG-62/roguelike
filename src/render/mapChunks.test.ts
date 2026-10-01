import { describe, expect, it } from "vitest";
import { Tile, createMap, setTile } from "../map/grid";
import type { GameMap } from "../map/grid";
import { mapThemeFor } from "./mapTheme";
import {
  CHECKSUM_MARGIN,
  CHUNK_PREFETCH_PX,
  CHUNK_PX,
  MapChunkCache,
  type MapView,
  bakeBudget,
  chunkChecksum,
  chunkKey,
  chunkPlan,
  flatTileRange,
  lruVictims,
  tileClass,
} from "./mapChunks";
import { BAKE_ROWS_BOOST, BAKE_ROWS_PER_FRAME, CHUNK_CACHE_MAX, CHUNK_DOTS, CHUNK_TILES } from "./mapTypes";

const VIEW: MapView = { x: 0, y: 0, w: 480, h: 270 };

/** 全部を床にした地図 */
function openMap(w: number, h: number): GameMap {
  const map = createMap(w, h);
  map.tiles.fill(Tile.Floor);
  return map;
}

describe("chunkPlan（欲しいチャンクの算出）", () => {
  it("画面 + 周り 128px のチャンクだけを返し、最大でも 16 枚", () => {
    const map = openMap(200, 200);
    for (const x of [0, 100, 777, 1500]) {
      for (const y of [0, 60, 999]) {
        const plan = chunkPlan({ ...VIEW, x, y }, map.width, map.height);
        expect(plan.length, `(${x},${y}) の枚数`).toBeLessThanOrEqual(16);
        for (const e of plan) {
          const left = e.cx * CHUNK_PX;
          const top = e.cy * CHUNK_PX;
          expect(left < x + VIEW.w + CHUNK_PREFETCH_PX && left + CHUNK_PX > x - CHUNK_PREFETCH_PX, "横が先読み範囲").toBe(true);
          expect(top < y + VIEW.h + CHUNK_PREFETCH_PX && top + CHUNK_PX > y - CHUNK_PREFETCH_PX, "縦が先読み範囲").toBe(true);
        }
      }
    }
  });

  it("地図の外のチャンクは欲しがらない", () => {
    const map = openMap(20, 20);
    const plan = chunkPlan({ ...VIEW, x: -500, y: -500 }, map.width, map.height);
    expect(plan.length, "画面が地図の外").toBe(0);
    const near = chunkPlan(VIEW, map.width, map.height);
    for (const e of near) {
      expect(e.cx, "地図の横").toBeLessThan(Math.ceil(map.width / CHUNK_TILES));
      expect(e.cy, "地図の縦").toBeLessThan(Math.ceil(map.height / CHUNK_TILES));
      expect(e.cx >= 0 && e.cy >= 0, "負にならない").toBe(true);
    }
  });

  it("画面内を先に、その中では画面の中心に近い順", () => {
    const plan = chunkPlan({ x: 200, y: 100, w: 480, h: 270 }, 200, 200);
    const firstOut = plan.findIndex((e) => !e.inView);
    expect(firstOut, "先読みだけのチャンクがある").toBeGreaterThan(0);
    expect(plan.slice(firstOut).every((e) => !e.inView), "画面内は前に固まる").toBe(true);
    const ins = plan.filter((e) => e.inView);
    for (let i = 1; i < ins.length; i++) {
      expect(ins[i]?.dist2 ?? 0, "中心に近い順").toBeGreaterThanOrEqual(ins[i - 1]?.dist2 ?? 0);
    }
  });

  it("マージン 0 なら画面に掛かるチャンクだけ（全部 inView）", () => {
    const plan = chunkPlan({ x: 100, y: 50, w: 480, h: 270 }, 200, 200, 0);
    expect(plan.length, "掛かる枚数").toBeGreaterThan(0);
    expect(plan.every((e) => e.inView), "すべて画面内").toBe(true);
  });
});

describe("chunkChecksum（分類のハッシュ）", () => {
  it("壁 → 床で変わる", () => {
    const map = createMap(40, 40);
    const before = chunkChecksum(map, 0, 0);
    setTile(map, 5, 5, Tile.Floor);
    expect(chunkChecksum(map, 0, 0), "隠し部屋が開く").not.toBe(before);
  });

  it("床 → 穴でも変わる", () => {
    const map = openMap(40, 40);
    const before = chunkChecksum(map, 0, 0);
    setTile(map, 3, 3, Tile.Pit);
    expect(chunkChecksum(map, 0, 0), "穴").not.toBe(before);
  });

  it("階段・泉の出現（通れるのまま）では変わらない", () => {
    const map = openMap(40, 40);
    const before = chunkChecksum(map, 0, 0);
    setTile(map, 4, 4, Tile.StairsDown);
    setTile(map, 6, 6, Tile.Fountain);
    expect(chunkChecksum(map, 0, 0), "階段と泉").toBe(before);
    expect(tileClass(Tile.StairsDown), "階段は通れる").toBe(tileClass(Tile.Floor));
    expect(tileClass(Tile.Fountain), "泉は通れる").toBe(tileClass(Tile.Floor));
  });

  it("周り 2 マスの変化では変わり、3 マス先では変わらない", () => {
    const map = openMap(80, 80);
    const before = chunkChecksum(map, 1, 1);
    setTile(map, CHUNK_TILES - CHECKSUM_MARGIN, CHUNK_TILES + 2, Tile.Wall);
    expect(chunkChecksum(map, 1, 1), "左の余白 2 マス内").not.toBe(before);
    const map2 = openMap(80, 80);
    setTile(map2, CHUNK_TILES - CHECKSUM_MARGIN - 1, CHUNK_TILES + 2, Tile.Wall);
    expect(chunkChecksum(map2, 1, 1), "余白の外").toBe(before);
  });

  it("地図の外は壁として数える（端のチャンクでも決まる）", () => {
    const map = createMap(10, 10);
    expect(chunkChecksum(map, 0, 0), "同じ入力で同じ値").toBe(chunkChecksum(map, 0, 0));
    const open = openMap(10, 10);
    expect(chunkChecksum(open, 0, 0), "床と壁で違う").not.toBe(chunkChecksum(map, 0, 0));
  });
});

describe("平塗り・LRU・予算の純関数", () => {
  it("平塗りの範囲はチャンクと画面の重なりで、最大 16x16 マス", () => {
    const r = flatTileRange(0, 0, VIEW, 100, 100);
    expect(r, "掛かる").not.toBeNull();
    if (!r) return;
    expect((r.tx1 - r.tx0 + 1) * (r.ty1 - r.ty0 + 1), "256 マス以下").toBeLessThanOrEqual(256);
    expect(r.tx1, "チャンクの右端まで").toBe(CHUNK_TILES - 1);
    expect(flatTileRange(5, 5, VIEW, 100, 100), "画面に掛からない").toBeNull();
    expect(flatTileRange(0, 0, { ...VIEW, x: -300 }, 100, 100)?.tx0, "負の画面でも 0 から").toBe(0);
  });

  it("lruVictims は上限を超えた数だけ、古い順に返し、今のフレームのものは捨てない", () => {
    const entries = Array.from({ length: 6 }, (_, i) => ({ key: i, lastUsed: i + 1 }));
    expect(lruVictims(entries, 4, 100), "2 つ超過").toEqual([0, 1]);
    expect(lruVictims(entries, 6, 100), "超えていない").toEqual([]);
    expect(lruVictims(entries, 2, 3), "今のフレーム（3 以上）は残す").toEqual([0, 1]);
  });

  it("焼きの予算は黒帯中で画面内に未焼きがあるときだけ BOOST 倍", () => {
    expect(bakeBudget(false, false), "通常").toBe(BAKE_ROWS_PER_FRAME);
    expect(bakeBudget(false, true), "黒帯でない").toBe(BAKE_ROWS_PER_FRAME);
    expect(bakeBudget(true, false), "全部焼けている").toBe(BAKE_ROWS_PER_FRAME);
    expect(bakeBudget(true, true), "黒帯中の未焼き").toBe(BAKE_ROWS_PER_FRAME * BAKE_ROWS_BOOST);
  });

  it("chunkKey はチャンクごとに一意", () => {
    const keys = new Set<number>();
    for (let cy = 0; cy < 30; cy++) for (let cx = 0; cx < 30; cx++) keys.add(chunkKey(cx, cy));
    expect(keys.size, "30x30").toBe(900);
  });
});

/** canvas の代わりに数えるだけの偽物 */
function fakeImages(): { make: (pixels: Uint32Array) => HTMLCanvasElement; count: () => number } {
  let n = 0;
  return {
    make: () => {
      n++;
      return { id: n } as unknown as HTMLCanvasElement;
    },
    count: () => n,
  };
}

interface Drawn {
  images: number;
  fills: number;
}

function fakeCtx(): { ctx: CanvasRenderingContext2D; drawn: Drawn } {
  const drawn: Drawn = { images: 0, fills: 0 };
  const ctx = {
    fillStyle: "",
    drawImage: () => {
      drawn.images++;
    },
    fillRect: () => {
      drawn.fills++;
    },
  } as unknown as CanvasRenderingContext2D;
  return { ctx, drawn };
}

describe("MapChunkCache（チャンクのキャッシュ）", () => {
  const theme = mapThemeFor(1, "cave");

  it("未焼きの間はマスごとの平塗り、焼けたら blit に替わる", () => {
    const map = openMap(16, 16);
    const view: MapView = { x: 0, y: 0, w: 256, h: 256 };
    const images = fakeImages();
    const cache = new MapChunkCache(images.make);
    cache.update(map, theme, view, false);
    expect(cache.bakedCount, "最初の 1 フレームでは焼き上がらない").toBe(0);
    expect(cache.hasUnbakedInView(), "画面内に未焼き").toBe(true);
    const before = fakeCtx();
    cache.drawGround(before.ctx, view);
    expect(before.drawn.images, "blit なし").toBe(0);
    expect(before.drawn.fills, "256 マスの平塗り").toBe(256);

    // 焼きの 1 単位はチャンクの行数と一致しない（準備の段がある）ので、上限のフレーム数の中で焼き上がることを見る
    const maxFrames = (CHUNK_DOTS / BAKE_ROWS_PER_FRAME) * 4;
    let frames = 1;
    while (cache.bakedCount === 0 && frames < maxFrames) {
      cache.update(map, theme, view, false);
      frames++;
    }
    expect(frames, "予算の行数ずつ焼いて 2 フレーム以上かかる").toBeGreaterThan(1);
    expect(cache.bakedCount, "上限のフレーム数の中で 1 枚焼き上がる").toBe(1);
    const after = fakeCtx();
    cache.drawGround(after.ctx, view);
    expect(after.drawn.images, "blit 1 枚").toBe(1);
    expect(after.drawn.fills, "平塗りなし").toBe(0);
  });

  it("1 フレームに焼く行は予算まで（黒帯中の未焼きは BOOST 倍）", () => {
    const map = openMap(64, 64);
    const cache = new MapChunkCache(fakeImages().make);
    cache.update(map, theme, VIEW, false);
    expect(cache.lastBakedRows, "通常").toBe(BAKE_ROWS_PER_FRAME);
    const boosted = new MapChunkCache(fakeImages().make);
    boosted.update(map, theme, VIEW, true);
    expect(boosted.lastBakedRows, "黒帯中").toBe(BAKE_ROWS_PER_FRAME * BAKE_ROWS_BOOST);
  });

  it("settle は欲しいチャンクを全部焼き、lip が空なら lip の canvas を作らない", () => {
    const map = openMap(64, 64);
    const images = fakeImages();
    const cache = new MapChunkCache(images.make);
    cache.settle(map, theme, VIEW);
    const want = chunkPlan(VIEW, map.width, map.height).length;
    expect(cache.bakedCount, "欲しい数ぶん焼けた").toBe(want);
    // 一面の床でも地図の外は壁なので、南端に接するチャンクだけ lip を持つ。中のチャンクは ground だけ
    expect(images.count(), "lip を持たないチャンクがあるので ground + lip の 2 倍より少ない").toBeLessThan(want * 2);
    expect(images.count(), "ground は全部").toBeGreaterThanOrEqual(want);
    expect(cache.hasUnbakedInView(), "未焼きなし").toBe(false);
  });

  it("持つチャンクは CHUNK_CACHE_MAX を超えない（広い地図を横切っても）", () => {
    const map = openMap(320, 160);
    const cache = new MapChunkCache(fakeImages().make);
    let peak = 0;
    for (let x = 0; x < 320 * 16 - 480; x += 200) {
      cache.settle(map, theme, { ...VIEW, x, y: (x % 1200) + 100 });
      peak = Math.max(peak, cache.size);
    }
    expect(peak, "上限").toBeLessThanOrEqual(CHUNK_CACHE_MAX);
    expect(peak, "ある程度は持つ").toBeGreaterThan(6);
  });

  it("state.map の同一性が変わったら全部捨てる", () => {
    const a = openMap(32, 32);
    const images = fakeImages();
    const cache = new MapChunkCache(images.make);
    cache.settle(a, theme, VIEW);
    expect(cache.bakedCount, "焼けた").toBeGreaterThan(0);
    const b = openMap(32, 32);
    cache.update(b, theme, VIEW, false);
    expect(cache.bakedCount, "別の地図なら焼き直し（1 フレームでは上がらない）").toBe(0);
  });

  it("テーマの鍵が変わったら捨てる", () => {
    const map = openMap(32, 32);
    const cache = new MapChunkCache(fakeImages().make);
    cache.settle(map, theme, VIEW);
    cache.update(map, { ...theme, key: "other" }, VIEW, false);
    expect(cache.bakedCount, "鍵が違えば別のチャンク").toBe(0);
  });

  it("画面内の分類が変わったら同期で焼き直し、階段の出現では焼き直さない", () => {
    const map = createMap(32, 32);
    for (let y = 1; y < 20; y++) for (let x = 1; x < 20; x++) setTile(map, x, y, Tile.Floor);
    const images = fakeImages();
    const cache = new MapChunkCache(images.make);
    cache.settle(map, theme, VIEW);
    const baked = images.count();

    setTile(map, 5, 5, Tile.StairsDown);
    cache.update(map, theme, VIEW, false);
    expect(images.count(), "階段では作り直さない").toBe(baked);

    setTile(map, 0, 5, Tile.Floor);
    cache.update(map, theme, VIEW, false);
    expect(images.count(), "壁 → 床は同期で焼き直し（1 フレームで canvas が増える）").toBeGreaterThan(baked);
    expect(cache.hasUnbakedInView(), "画面内は焼き上がったまま").toBe(false);
  });

  it("画面外のチャンクが変わったら捨てて予算で焼き直す（同期で焼かない）", () => {
    const map = openMap(80, 80);
    const cache = new MapChunkCache(fakeImages().make);
    const view: MapView = { x: 0, y: 0, w: 480, h: 270 };
    cache.settle(map, theme, view);
    const planned = chunkPlan(view, map.width, map.height);
    const far = planned.find((e) => !e.inView);
    expect(far, "先読みだけのチャンクがある").toBeDefined();
    if (!far) return;
    setTile(map, far.cx * CHUNK_TILES + 2, far.cy * CHUNK_TILES + 2, Tile.Wall);
    cache.update(map, theme, view, false);
    expect(cache.bakedCount, "1 枚は焼き直し待ち").toBeLessThan(planned.length);
  });

  it("lightsIn は画面に掛かる光だけ（焼いた光源が無ければ空）", () => {
    const map = openMap(32, 32);
    const cache = new MapChunkCache(fakeImages().make);
    cache.settle(map, theme, VIEW);
    expect(cache.lightsIn(VIEW).length, "仮の焼き付けは光源なし").toBe(0);
  });
});
