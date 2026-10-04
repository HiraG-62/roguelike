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
  chunkChecksum,
  chunkKey,
  chunkPlan,
  flatTileRange,
  tileClass,
} from "./mapChunks";
import { BAKE_ROWS_PER_FRAME, CHUNK_DOTS, CHUNK_TILES, PREPARE_ROWS_PER_FRAME } from "./mapTypes";

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
    cache.update(map, theme, view);
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
      cache.update(map, theme, view);
      frames++;
    }
    expect(frames, "予算の行数ずつ焼いて 2 フレーム以上かかる").toBeGreaterThan(1);
    expect(cache.bakedCount, "上限のフレーム数の中で 1 枚焼き上がる").toBe(1);
    const after = fakeCtx();
    cache.drawGround(after.ctx, view);
    expect(after.drawn.images, "blit 1 枚").toBe(1);
    expect(after.drawn.fills, "平塗りなし").toBe(0);
  });

  it("1 フレームに焼く行は予算まで（描画の中は BAKE_ROWS_PER_FRAME、先に焼き上げる間は PREPARE_ROWS_PER_FRAME）", () => {
    const map = openMap(64, 64);
    const cache = new MapChunkCache(fakeImages().make);
    cache.update(map, theme, VIEW);
    expect(cache.lastBakedRows, "描画の中").toBe(BAKE_ROWS_PER_FRAME);
    const preparing = new MapChunkCache(fakeImages().make);
    preparing.prepare(map, theme);
    expect(preparing.lastBakedRows, "先に焼き上げる間").toBe(PREPARE_ROWS_PER_FRAME);
  });

  it("prepare は地図の全チャンクを焼き上げるまで false、焼き上がったら true（初めて見せるときから欠けない）", () => {
    const map = openMap(64, 48);
    const cache = new MapChunkCache(fakeImages().make);
    const total = Math.ceil(64 / CHUNK_TILES) * Math.ceil(48 / CHUNK_TILES);
    expect(cache.ready(map, theme), "焼く前").toBe(false);
    let frames = 0;
    while (!cache.prepare(map, theme) && frames < 1000) frames++;
    expect(frames, "1 フレームでは終わらない").toBeGreaterThan(0);
    expect(cache.bakedCount, "全チャンク").toBe(total);
    expect(cache.ready(map, theme), "焼き上がり").toBe(true);
    expect(cache.ready(map, { ...theme, key: "other" }), "テーマが違えば未").toBe(false);
    const drawn = fakeCtx();
    cache.drawGround(drawn.ctx, { x: 500, y: 300, w: 480, h: 270 });
    expect(drawn.drawn.fills, "どこを映しても平塗りなし").toBe(0);
  });

  it("地図を替えたら前の地図のチャンクを持たず、新しい地図を焼き上げたら余った取り置きの canvas を手放す", () => {
    const cache = new MapChunkCache(fakeImages().make);
    cache.settle(openMap(64, 64), theme, VIEW);
    expect(cache.size, "広い地図は 16 枚").toBe(16);
    const small = openMap(16, 16);
    while (!cache.prepare(small, theme));
    expect(cache.size, "狭い地図の 1 枚だけ持つ").toBe(1);
    expect(cache.spareCount, "前の地図の canvas は手放した").toBe(0);
  });

  it("settle は地図の全チャンクを焼き、lip が空なら lip の canvas を作らない", () => {
    const map = openMap(64, 64);
    const images = fakeImages();
    const cache = new MapChunkCache(images.make);
    cache.settle(map, theme, VIEW);
    const want = (64 / CHUNK_TILES) * (64 / CHUNK_TILES);
    expect(cache.bakedCount, "欲しい数ぶん焼けた").toBe(want);
    // 一面の床でも地図の外は壁なので、南端に接するチャンクだけ lip を持つ。中のチャンクは ground だけ
    expect(images.count(), "lip を持たないチャンクがあるので ground + lip の 2 倍より少ない").toBeLessThan(want * 2);
    expect(images.count(), "ground は全部").toBeGreaterThanOrEqual(want);
    expect(cache.hasUnbakedInView(), "未焼きなし").toBe(false);
  });

  it("地図が変わったら canvas を取り置きに回し、新しい地図の焼きで使う", () => {
    const images: HTMLCanvasElement[] = [];
    const reused: HTMLCanvasElement[] = [];
    const make = (_pixels: Uint32Array, reuse: HTMLCanvasElement | null): HTMLCanvasElement => {
      if (reuse) {
        reused.push(reuse);
        return reuse;
      }
      const made = { id: images.length } as unknown as HTMLCanvasElement;
      images.push(made);
      return made;
    };
    const cache = new MapChunkCache(make);
    cache.settle(openMap(32, 32), theme, VIEW);
    const first = images.length;
    cache.settle(openMap(32, 32), theme, VIEW);
    expect(images.length, "新しく作らない").toBe(first);
    expect(reused.length, "前の地図の canvas を使った").toBeGreaterThan(0);
  });

  it("state.map の同一性が変わったら全部捨てる", () => {
    const a = openMap(32, 32);
    const images = fakeImages();
    const cache = new MapChunkCache(images.make);
    cache.settle(a, theme, VIEW);
    expect(cache.bakedCount, "焼けた").toBeGreaterThan(0);
    const b = openMap(32, 32);
    cache.update(b, theme, VIEW);
    expect(cache.bakedCount, "別の地図なら焼き直し（1 フレームでは上がらない）").toBe(0);
  });

  it("テーマの鍵が変わったら捨てる", () => {
    const map = openMap(32, 32);
    const cache = new MapChunkCache(fakeImages().make);
    cache.settle(map, theme, VIEW);
    cache.update(map, { ...theme, key: "other" }, VIEW);
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
    cache.update(map, theme, VIEW);
    expect(images.count(), "階段では作り直さない").toBe(baked);

    setTile(map, 0, 5, Tile.Floor);
    cache.update(map, theme, VIEW);
    expect(images.count(), "壁 → 床は同期で焼き直し（1 フレームで canvas が増える）").toBeGreaterThan(baked);
    expect(cache.hasUnbakedInView(), "画面内は焼き上がったまま").toBe(false);
  });

  it("先読みの内のチャンクが変わったら、画面外でも同期で焼き直す（全部持っているので欠けたままにしない）", () => {
    const map = openMap(80, 80);
    const cache = new MapChunkCache(fakeImages().make);
    const view: MapView = { x: 0, y: 0, w: 480, h: 270 };
    cache.settle(map, theme, view);
    const planned = chunkPlan(view, map.width, map.height);
    const far = planned.find((e) => !e.inView);
    expect(far, "先読みだけのチャンクがある").toBeDefined();
    if (!far) return;
    setTile(map, far.cx * CHUNK_TILES + 2, far.cy * CHUNK_TILES + 2, Tile.Wall);
    const before = cache.bakedCount;
    cache.update(map, theme, view);
    expect(cache.bakedCount, "焼き直し待ちを残さない").toBe(before);
  });

  it("lightsIn は画面に掛かる光だけ（置物の光が画面の外なら空）", () => {
    const map = openMap(32, 32);
    const cache = new MapChunkCache(fakeImages().make);
    cache.settle(map, theme, VIEW);
    for (const l of cache.lightsIn(VIEW)) {
      expect(l.x + l.r >= VIEW.x && l.x - l.r <= VIEW.x + VIEW.w && l.y + l.r >= VIEW.y && l.y - l.r <= VIEW.y + VIEW.h, "返った光は画面に掛かる").toBe(true);
    }
    const away: MapView = { x: 100000, y: 100000, w: 480, h: 270 };
    expect(cache.lightsIn(away).length, "画面の外の光は返さない").toBe(0);
  });

  it("drawLip は clip があればその範囲だけを元と先の矩形を切って描く（clip が無ければチャンク全体）", () => {
    const map = createMap(32, 32);
    for (let y = 1; y < 12; y++) for (let x = 1; x < 20; x++) setTile(map, x, y, Tile.Floor);
    const cache = new MapChunkCache(() => ({ width: CHUNK_DOTS }) as unknown as HTMLCanvasElement);
    cache.settle(map, theme, VIEW);
    const calls: number[][] = [];
    const ctx = { drawImage: (_i: unknown, ...a: number[]) => calls.push(a) } as unknown as CanvasRenderingContext2D;
    cache.drawLip(ctx, VIEW);
    expect(calls.every((a) => a.length === 4), "clip なしは 4 引数でチャンク全体").toBe(true);
    expect(calls.length, "画面に掛かるチャンクの分").toBeGreaterThan(0);
    calls.length = 0;
    const clip: MapView = { x: 40, y: 20, w: 30, h: 20 };
    cache.drawLip(ctx, VIEW, clip);
    expect(calls.length, "clip が掛かるチャンクは 1 枚").toBe(1);
    const [sx, sy, sw, sh, dx, dy, dw, dh] = calls[0] ?? [];
    expect([dx, dy, dw, dh], "先は clip と同じ").toEqual([40, 20, 30, 20]);
    expect([sx, sy, sw, sh], "元は密度 2 の画素").toEqual([80, 40, 60, 40]);
    calls.length = 0;
    cache.drawLip(ctx, VIEW, { x: 1000, y: 1000, w: 10, h: 10 });
    expect(calls.length, "別のチャンクの clip は（そのチャンクが焼けていなければ）描かない").toBe(0);
  });
});
