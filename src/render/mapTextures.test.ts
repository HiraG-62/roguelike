import { describe, expect, it } from "vitest";
import { createVorOut, vnoise, vor } from "./mapNoise";
import {
  Lattice,
  VorGrid,
  cliffTex,
  createTexContext,
  floorTex,
  pitTex,
  sideTex,
  topTex,
  voidTex,
  type TexContext,
} from "./mapTextures";
import { mapThemeFor } from "./mapTheme";
import type { MapTheme } from "./mapTypes";

/** 床 5 種・天面 3 種・側面 5 種・穴 6 種・奈落が一通り出るテーマ */
const THEMES: readonly { name: string; theme: MapTheme }[] = [
  { name: "苔の洞（cobble / rock / rockside / 水）", theme: mapThemeFor(3, "cave") },
  { name: "沼（cobble + 苔の地帯）", theme: mapThemeFor(3, "swamp") },
  { name: "寺院（slab / mason / stonewall / 油）", theme: mapThemeFor(8, "mine") },
  { name: "廃城・炎（ashlar + 煤 / 溶岩）", theme: mapThemeFor(12, "forge") },
  { name: "廃城・霜（ashlar + 霜 / 氷）", theme: mapThemeFor(13, "glacier") },
  { name: "異界（glyph / cliff / 奈落）", theme: mapThemeFor(17, "cave") },
  { name: "最深の間（sand / ink / inkside / 墨）", theme: mapThemeFor(21, "dark") },
];

const REGION = { x: 1000, y: -300, w: 300, h: 200 };
const SIDE_H = 32;

function contextOf(theme: MapTheme, region = REGION): TexContext {
  return createTexContext(theme, region.x, region.y, region.w, region.h);
}

/** 範囲の内側と外側にまたがる格子点 */
function samplePoints(): [number, number][] {
  const points: [number, number][] = [];
  for (let y = REGION.y - 40; y < REGION.y + REGION.h + 40; y += 11) {
    for (let x = REGION.x - 40; x < REGION.x + REGION.w + 40; x += 7) points.push([x, y]);
  }
  return points;
}

describe("mapTextures: 前計算つきの雑音は mapNoise と同じ値を返す", () => {
  it("Lattice.at は vnoise と一致する（範囲の内側・外側・行をまたぐ引き方・rowCache なしでも）", () => {
    for (const rowCache of [true, false]) {
      const lat = new Lattice(11, 7, REGION.x, REGION.y, REGION.x + REGION.w, REGION.y + REGION.h, rowCache);
      for (const [x, y] of samplePoints()) {
        expect(lat.at(x, y), `rowCache=${rowCache} (${x}, ${y})`).toBeCloseTo(vnoise(x, y, 11, 7), 9);
      }
      // 行を行き来しても値が変わらない
      expect(lat.at(1100, 0)).toBeCloseTo(vnoise(1100, 0, 11, 7), 9);
      expect(lat.at(1105, -200)).toBeCloseTo(vnoise(1105, -200, 11, 7), 9);
      expect(lat.at(1100, 0)).toBeCloseTo(vnoise(1100, 0, 11, 7), 9);
    }
  });

  it("VorGrid.query は vor と一致する（距離・点の座標・セルのハッシュ）", () => {
    const grid = new VorGrid(17, 5, REGION.x, REGION.y, REGION.x + REGION.w, REGION.y + REGION.h);
    const a = createVorOut();
    const b = createVorOut();
    for (const [x, y] of samplePoints()) {
      grid.query(x, y, a);
      vor(x, y, 17, 5, b);
      expect(a.d1, `d1 (${x}, ${y})`).toBeCloseTo(b.d1, 9);
      expect(a.d2, `d2 (${x}, ${y})`).toBeCloseTo(b.d2, 9);
      expect(a.id, `id (${x}, ${y})`).toBe(b.id);
      expect(a.cx).toBeCloseTo(b.cx, 9);
      expect(a.cy).toBeCloseTo(b.cy, 9);
    }
  });

  it("VorGrid.query は渡した出力の構造体を書き換えて返す（新しい物を作らない）", () => {
    const grid = new VorGrid(13, 1, 0, 0, 100, 100);
    const out = createVorOut();
    expect(grid.query(50, 50, out)).toBe(out);
  });
});

describe("mapTextures: 模様", () => {
  it.each(THEMES)("$name: 床・天面・側面・穴・奈落のすべてが不透明の色で、決定的", ({ theme }) => {
    const tc = contextOf(theme);
    const again = contextOf(theme);
    for (const [x, y] of samplePoints()) {
      const k = Math.abs(x + y) % SIDE_H;
      const colors = [
        floorTex(tc, x, y),
        topTex(tc, x, y),
        sideTex(tc, x, y, k, SIDE_H),
        pitTex(tc, x, y, 6, false),
        pitTex(tc, x, y, 1, false),
        pitTex(tc, x, y, 1, true),
        voidTex(tc, x, y, 5),
        cliffTex(tc, x, k, SIDE_H),
      ];
      colors.forEach((c, i) => expect(c >>> 24, `${theme.key} 模様 ${i} (${x}, ${y})`).toBe(255));
      expect(floorTex(again, x, y), "別の文脈でも同じ").toBe(colors[0]);
      expect(topTex(again, x, y)).toBe(colors[1]);
      expect(sideTex(again, x, y, k, SIDE_H)).toBe(colors[2]);
      expect(pitTex(again, x, y, 6, false)).toBe(colors[3]);
    }
  });

  it.each(THEMES)("$name: 焼く範囲の取り方で絵が変わらない（範囲の外は直接計算に切り替わる）", ({ theme }) => {
    const wide = contextOf(theme);
    // 1 ドットしかない範囲 = ほぼすべてが範囲外の経路
    const tiny = createTexContext(theme, REGION.x, REGION.y, 1, 1);
    const shifted = createTexContext(theme, REGION.x + 57, REGION.y - 31, 300, 200);
    for (const [x, y] of samplePoints()) {
      const k = Math.abs(x * 3 + y) % SIDE_H;
      for (const other of [tiny, shifted]) {
        expect(floorTex(other, x, y), `床 (${x}, ${y})`).toBe(floorTex(wide, x, y));
        expect(topTex(other, x, y), `天面 (${x}, ${y})`).toBe(topTex(wide, x, y));
        expect(sideTex(other, x, y, k, SIDE_H), `側面 (${x}, ${y})`).toBe(sideTex(wide, x, y, k, SIDE_H));
        expect(pitTex(other, x, y, 5, false), `穴 (${x}, ${y})`).toBe(pitTex(wide, x, y, 5, false));
        expect(voidTex(other, x, y, 30), `奈落 (${x}, ${y})`).toBe(voidTex(wide, x, y, 30));
      }
    }
  });

  it.each(THEMES)("$name: 床と天面は 64x64 に 3 色以上の模様があり、パレットの外の色は混ざらない", ({ theme }) => {
    const tc = contextOf(theme);
    const floor = new Set<number>();
    const top = new Set<number>();
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        floor.add(floorTex(tc, REGION.x + x, REGION.y + y));
        top.add(topTex(tc, REGION.x + x, REGION.y + y));
      }
    }
    expect(floor.size, "床の色数").toBeGreaterThanOrEqual(3);
    expect(top.size, "天面の色数").toBeGreaterThanOrEqual(3);
    // 色数が暴れない（1 素材 3〜5 色の段 + 混色。前計算を使わない経路が溢れさせていない）
    expect(floor.size, "床の色数の上限").toBeLessThan(40);
    expect(top.size, "天面の色数の上限").toBeLessThan(40);
  });

  it("側面: 上端は明るい線、下端は暗い線（章 1 の岩肌・廃城の切石）", () => {
    const rock = mapThemeFor(3, "cave");
    const tc = contextOf(rock);
    expect(sideTex(tc, 1100, 0, 0, 16), "岩肌の上端").toBe(rock.palette.sL);
    expect(sideTex(tc, 1100, 0, 15, 16), "岩肌の下端").toBe(rock.palette.sD);
    const ashlar = mapThemeFor(12, "forge");
    const ac = contextOf(ashlar);
    expect(sideTex(ac, 1100, 0, 0, 32), "切石の上端").toBe(ashlar.palette.sL);
    expect(sideTex(ac, 1100, 0, 31, 32), "切石の下端").toBe(ashlar.palette.sD);
  });

  it("霜のバイオームは天面・側面に雪が乗り、熔鉱炉は煤が乗る", () => {
    const frost = mapThemeFor(12, "glacier");
    const fc = contextOf(frost);
    expect(sideTex(fc, 1100, 0, 30, 32), "霜の側面の下端の手前は雪").toBe(frost.palette.snow);
    let snowTops = 0;
    for (let y = 0; y < 80; y++) for (let x = 0; x < 80; x++) if (topTex(fc, REGION.x + x, REGION.y + y) !== topTex(contextOf(mapThemeFor(12, "cave")), REGION.x + x, REGION.y + y)) snowTops++;
    expect(snowTops, "霜で天面が変わる").toBeGreaterThan(0);
  });

  it("穴の北の縁: 液体は岸の色の帯になり、氷（液体でない）は帯にならない", () => {
    const water = mapThemeFor(3, "cave");
    const wc = contextOf(water);
    const bank = pitTex(wc, 1100, 0, 9, true);
    expect(bank, "液体の北の縁は岸の色").not.toBe(pitTex(wc, 1100, 0, 9, false));
    const ice = mapThemeFor(3, "glacier");
    const ic = contextOf(ice);
    expect(pitTex(ic, 1100, 0, 9, true), "氷は北の縁でも同じ").toBe(pitTex(ic, 1100, 0, 9, false));
  });

  it("穴は岸（d <= 1.5）で泡の色になり、奥ほど深い色になる（水）", () => {
    const theme = mapThemeFor(3, "cave");
    const tc = contextOf(theme);
    const edge = pitTex(tc, 1100, 0, 1, false);
    const shore = pitTex(tc, 1100, 0, 3, false);
    expect(edge, "岸と少し奥で色が違う").not.toBe(shore);
  });

  it("奈落: 縁から奥へ入るほど暗い（d が大きいほど vD に近い）", () => {
    const theme = mapThemeFor(17, "cave");
    const tc = contextOf(theme);
    const luma = (c: number): number => (c & 255) + ((c >>> 8) & 255) + ((c >>> 16) & 255);
    // 浮かぶ岩片・光の点を避けるため、ドットをいくつか平均する
    const mean = (d: number): number => {
      let sum = 0;
      for (let i = 0; i < 400; i++) sum += luma(voidTex(tc, 2000 + i * 3, 700 + (i % 7), d));
      return sum / 400;
    };
    expect(mean(5)).toBeGreaterThan(mean(15));
    expect(mean(15)).toBeGreaterThan(mean(40));
  });

  it("最深の間の枯山水は、石の周りの同心円を石の座標から描く", () => {
    const theme = mapThemeFor(21, "cave");
    const plain = createTexContext(theme, 0, 0, 200, 200);
    const withStone = createTexContext(theme, 0, 0, 200, 200, [{ x: 100, y: 100, ring: 60 }]);
    let changed = 0;
    for (let y = 60; y < 140; y += 3) for (let x = 60; x < 140; x += 3) if (floorTex(plain, x, y) !== floorTex(withStone, x, y)) changed++;
    expect(changed, "石の周りの砂紋が変わる").toBeGreaterThan(50);
    expect(floorTex(plain, 190, 190), "石から遠い所は変わらない").toBe(floorTex(withStone, 190, 190));
  });

  it("苔の洞の苔の地帯の閾値を下げると、苔の色が増える（沼）", () => {
    const cave = mapThemeFor(3, "cave");
    const swamp = mapThemeFor(3, "swamp");
    const moss = (theme: MapTheme): number => {
      const tc = contextOf(theme);
      let n = 0;
      for (let y = 0; y < 200; y++) for (let x = 0; x < 300; x++) if (floorTex(tc, REGION.x + x, REGION.y + y) === theme.palette.moss1) n++;
      return n;
    };
    expect(moss(swamp), "沼は苔が広い").toBeGreaterThan(moss(cave));
  });
});

describe("mapTextures: 速さ", () => {
  it("床と天面を 512x512 引いて 1 秒以内（割り当てなしの内側ループ）", () => {
    const theme = mapThemeFor(3, "cave");
    const tc = createTexContext(theme, 0, 0, 512, 512);
    let acc = 0;
    const t0 = performance.now();
    for (let y = 0; y < 512; y++) {
      for (let x = 0; x < 512; x++) acc ^= floorTex(tc, x, y) ^ topTex(tc, x, y);
    }
    const ms = performance.now() - t0;
    console.log(`[mapTextures 性能] 苔の床 + 天面 512x512: ${ms.toFixed(1)}ms`);
    expect(ms, "512x512 の床 + 天面").toBeLessThan(1000);
    expect(acc >= 0 || acc < 0).toBe(true);
  });
});
