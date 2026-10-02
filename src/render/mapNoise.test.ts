import { describe, expect, it } from "vitest";
import { createVorOut, h32, hashString, hf, pack, vnoise, vor } from "./mapNoise";

describe("mapNoise: 座標ハッシュと雑音", () => {
  it("h32 は同じ引数で同じ値を返し、符号なし 32bit に収まる", () => {
    expect(h32(3, -7, 11), "同じ引数で同じ値").toBe(h32(3, -7, 11));
    for (let i = -20; i < 20; i++) {
      const v = h32(i, i * 3, 5);
      expect(Number.isInteger(v) && v >= 0 && v <= 0xffffffff, `h32(${i}) が u32`).toBe(true);
    }
  });

  it("h32 は座標か種が違えば値が変わる", () => {
    expect(h32(1, 2, 3), "x の差").not.toBe(h32(2, 2, 3));
    expect(h32(1, 2, 3), "y の差").not.toBe(h32(1, 3, 3));
    expect(h32(1, 2, 3), "種の差").not.toBe(h32(1, 2, 4));
  });

  it("hf と vnoise は 0 以上 1 以下で、同じ引数で同じ値", () => {
    for (let i = 0; i < 400; i++) {
      const x = i * 3.7 - 500;
      const y = i * 1.3 + 17;
      const a = hf(i, -i, 9);
      const b = vnoise(x, y, 11, 9);
      expect(a >= 0 && a < 1, `hf(${i}) の範囲`).toBe(true);
      expect(b >= 0 && b <= 1, `vnoise(${i}) の範囲`).toBe(true);
      expect(vnoise(x, y, 11, 9), "vnoise は決定的").toBe(b);
    }
  });

  it("vnoise は格子点で hf と一致する", () => {
    expect(vnoise(22, 33, 11, 4), "p=11 の格子点 (2, 3)").toBeCloseTo(hf(2, 3, 4), 12);
  });

  it("hashString は同じ文字列で同じ値、違う文字列で別の値", () => {
    expect(hashString("moss:cave")).toBe(hashString("moss:cave"));
    expect(hashString("moss:cave")).not.toBe(hashString("temple:cave"));
  });
});

describe("mapNoise: vor", () => {
  it("渡した構造体を書き換えて、その同じ構造体を返す", () => {
    const out = createVorOut();
    const ret = vor(10.5, 20.25, 16, 3, out);
    expect(ret, "戻り値は渡したオブジェクトそのもの").toBe(out);
    expect(out.d1 >= 0 && out.d1 <= out.d2, "d1 <= d2").toBe(true);
    const keys = Object.keys(out).sort();
    expect(keys, "フィールドを増やさない").toEqual(["cx", "cy", "d1", "d2", "id"]);
  });

  it("同じ引数で同じ値、別の位置では値が更新される", () => {
    const a = createVorOut();
    const b = createVorOut();
    vor(40, 50, 16, 7, a);
    vor(40, 50, 16, 7, b);
    expect(a, "同じ引数で同じ結果").toEqual(b);
    vor(41, 90, 16, 7, a);
    expect(a, "別の位置で上書きされる").not.toEqual(b);
  });

  it("最も近い特徴点は同じセルの近傍にあり、距離がそこへの距離と一致する", () => {
    const out = createVorOut();
    vor(100, 100, 16, 1, out);
    expect(Math.hypot(100 - out.cx, 100 - out.cy)).toBeCloseTo(out.d1, 9);
  });
});

describe("mapNoise: pack", () => {
  it("ABGR（上位から A, B, G, R）の順に詰める", () => {
    expect(pack(0x11, 0x22, 0x33), "R=0x11 G=0x22 B=0x33").toBe(0xff332211);
    expect(pack(255, 255, 255)).toBe(0xffffffff);
    expect(pack(0, 0, 0), "不透明の黒は 0 ではない").toBe(0xff000000);
  });

  it("符号なしの数で返す", () => {
    expect(pack(0, 0, 0)).toBeGreaterThan(0);
  });

  it("Uint32Array に入れるとメモリ上で R, G, B, A の順に並ぶ", () => {
    const buf = new Uint32Array(1);
    buf[0] = pack(10, 20, 30);
    const bytes = new Uint8Array(buf.buffer);
    expect(Array.from(bytes), "リトルエンディアン前提").toEqual([10, 20, 30, 255]);
  });
});
