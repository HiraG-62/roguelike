import { describe, expect, it } from "vitest";
import type { ChainRecord } from "../core/events";
import { boonHudTop } from "./boonUi";
import { CHAIN_MAX_LINES, CHAIN_SHOW_SECONDS, chainAlpha, chainBaselines, chainLines, chainWord } from "./chainUi";

function rec(keyword: string, depth: number, time: number): ChainRecord {
  return { keyword, depth, time };
}

describe("連鎖の表示: 行の組み立て", () => {
  it("深さが増える間は 1 本の連鎖、深さが戻ったら新しい連鎖", () => {
    const lines = chainLines([rec("burn", 0, 1), rec("explode", 1, 1.1), rec("shock", 0, 1.2)], 1.5);
    expect(lines.map((l) => l.words)).toEqual([["burn", "explode"], ["shock"]]);
    expect(lines[0]?.maxDepth, "最深").toBe(1);
  });

  it("同じ並びが続いたら ×n にまとめる", () => {
    const lines = chainLines([rec("burn", 0, 1), rec("burn", 1, 1.1), rec("burn", 0, 1.2), rec("burn", 1, 1.3)], 1.5);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.words).toEqual(["burn", "burn"]);
    expect(lines[0]?.count, "2 回").toBe(2);
  });

  it("CHAIN_SHOW_SECONDS を過ぎたものは出さず、最大 CHAIN_MAX_LINES 行（新しい方を残す）", () => {
    const old = rec("burn", 0, 0);
    const fresh = ["chill", "shock", "poison", "bleed"].map((k, i) => rec(k, 0, 10 + i * 0.1));
    const lines = chainLines([old, ...fresh], 10 + CHAIN_SHOW_SECONDS - 0.5);
    expect(lines.map((l) => l.words[0]), "古いものは消え、新しい 3 行").toEqual(["shock", "poison", "bleed"]);
    expect(lines.length).toBe(CHAIN_MAX_LINES);
  });

  it("状態異常の種類は語へ寄せ、語にならない効果は出さない", () => {
    expect(chainWord("burn"), "語はそのまま").toBe("burn");
    expect(chainWord("freeze"), "凍結は冷気").toBe("chill");
    expect(chainWord("damageBuff"), "語にならない効果").toBeNull();
    expect(chainLines([rec("damageBuff", 0, 1)], 1.2), "表示なし").toHaveLength(0);
  });
});

describe("連鎖の表示: 位置と薄れ方", () => {
  it("新しい行ほど下、最下行は祝福アイコン列の上", () => {
    const ys = chainBaselines([10, 12, 10], 5);
    const [a, b, c] = ys;
    expect(c, "最下行").toBeLessThan(boonHudTop(5));
    expect(b, "2 行目").toBe((c ?? 0) - 10);
    expect(a, "1 行目").toBe((b ?? 0) - 12);
  });

  it("祝福が増えて段が増えると連鎖の表示も上がる", () => {
    const few = chainBaselines([10], 1)[0] ?? 0;
    const many = chainBaselines([10], 40)[0] ?? 0;
    expect(many, "段が増えた分だけ上").toBeLessThan(few);
  });

  it("消える直前に薄くなり、表示時間を過ぎたら 0", () => {
    expect(chainAlpha(0), "出た直後").toBe(1);
    expect(chainAlpha(CHAIN_SHOW_SECONDS - 0.25), "消える直前").toBeLessThan(1);
    expect(chainAlpha(CHAIN_SHOW_SECONDS + 0.1), "過ぎた").toBe(0);
  });
});
