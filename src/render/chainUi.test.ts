import { describe, expect, it } from "vitest";
import type { ChainRecord } from "../core/events";
import { boonHudTop } from "./boonUi";
import { hudLayout } from "./renderMath";
import { DISCOVERY } from "../data/tuning";
import { createLinkRun } from "../meta/links";
import { CHAIN_MAX_LINES, CHAIN_SHOW_SECONDS, chainAlpha, chainBaselines, chainLines, chainWord, discoveryNotes } from "./chainUi";

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
  it("新しい行ほど下、最下行は渡した基準線", () => {
    const ys = chainBaselines([10, 12, 10], 200);
    const [a, b, c] = ys;
    expect(c, "最下行").toBe(200);
    expect(b, "2 行目").toBe((c ?? 0) - 10);
    expect(a, "1 行目").toBe((b ?? 0) - 12);
  });

  it("祝福が増えて段が増えると連鎖の表示も上がり、スキル枠の上に収まる", () => {
    const few = hudLayout(boonHudTop(1), 10, 4);
    const many = hudLayout(boonHudTop(40), 10, 4);
    expect(many.chainBottom, "段が増えた分だけ上").toBeLessThan(few.chainBottom);
    expect(few.chainBottom, "スキル枠より上").toBeLessThan(few.skills.y);
  });

  it("消える直前に薄くなり、表示時間を過ぎたら 0", () => {
    expect(chainAlpha(0), "出た直後").toBe(1);
    expect(chainAlpha(CHAIN_SHOW_SECONDS - 0.25), "消える直前").toBeLessThan(1);
    expect(chainAlpha(CHAIN_SHOW_SECONDS + 0.1), "過ぎた").toBe(0);
  });
});

describe("連鎖の表示: 連携名と発見の知らせ", () => {
  it("名のある連鎖は行に名前を添え、名の無い並びは null", () => {
    const named = chainLines([rec("burn", 0, 1), rec("burn", 1, 1.1)], 1.5);
    expect(named[0]?.name, "炎→炎は延焼").toBe("延焼");
    const plain = chainLines([rec("melee", 0, 1), rec("heal", 1, 1.1)], 1.5);
    expect(plain[0]?.name, "名の無い並び").toBeNull();
  });

  it("初めて見つけた連携と手がかりは、それぞれの表示秒の間だけ出る", () => {
    const links = createLinkRun();
    links.fresh = { id: "reaction:vaporize", time: 10 };
    links.hint = { id: "reaction:steam", shown: "first", depth: 1, since: 10 };
    const now = discoveryNotes(links, 10.5);
    expect(now.map((n) => n.kind), "手がかりが上、初発見が下").toEqual(["hint", "fresh"]);
    const later = discoveryNotes(links, 10 + DISCOVERY.freshShowSeconds + 0.1);
    expect(later.map((n) => n.kind), "初発見は先に消える").toEqual(DISCOVERY.hintShowSeconds > DISCOVERY.freshShowSeconds ? ["hint"] : []);
    expect(discoveryNotes(links, 10 + DISCOVERY.hintShowSeconds + 0.1), "どちらも消える").toEqual([]);
  });

  it("知らせの薄れ方は各自の表示秒で決まる", () => {
    expect(chainAlpha(0, DISCOVERY.hintShowSeconds), "出た直後").toBe(1);
    expect(chainAlpha(DISCOVERY.hintShowSeconds + 0.1, DISCOVERY.hintShowSeconds), "過ぎた").toBe(0);
  });
});
