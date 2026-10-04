import { describe, expect, it } from "vitest";
import { LOADING } from "../data/tuning";
import type { TipEntry } from "../meta/tips";
import { beginLoading, confirmLoading, loadingAlpha, loadingPromptVisible, loadingReleased, loadingTitle, pickLoadingTip, sealAge, stepLoading, verticalCells } from "./loadingScreen";

const FRAME = 1 / 60;

function tip(key: string, body: string): TipEntry {
  return { key, term: key, body, category: "controls" };
}

const TIPS: TipEntry[] = [tip("short", "短い本文。"), tip("long", "長".repeat(LOADING.tipMaxChars + 1)), tip("mid", "ほどほどの本文。")];

describe("読み込み画面の段取り", () => {
  it("地図を描いている間は進み具合へ追いつきながら開き、描き終えるまで朱印に進まない", () => {
    const ls = beginLoading({ kind: "floor", depth: 3, floorKind: "cave" }, 7, TIPS);
    for (let i = 0; i < 30; i++) stepLoading(ls, FRAME, 0.5, false);
    expect(ls.open, "半ばへ追いつく").toBeGreaterThan(0.4);
    expect(ls.open, "進み具合を越えない").toBeLessThanOrEqual(0.5);
    expect(ls.phase, "まだ開いている").toBe("open");
    expect(sealAge(ls), "朱印はまだ").toBeNull();
    expect(loadingAlpha(ls), "薄れていない").toBe(1);
  });

  it("描き終えたら広げきり → 朱印 → クリックを待つ → 薄れる → 解き放つの順に進む", () => {
    const ls = beginLoading({ kind: "floor", depth: 3, floorKind: "cave" }, 7, TIPS);
    const seen: string[] = [];
    let frames = 0;
    while (!loadingReleased(ls) && frames < 600) {
      stepLoading(ls, FRAME, 1, true);
      if (seen[seen.length - 1] !== ls.phase) seen.push(ls.phase);
      if (ls.phase === "wait" && ls.phaseTime > 1) confirmLoading(ls);
      frames++;
    }
    expect(seen).toEqual(["open", "seal", "wait", "fade", "done"]);
    expect(ls.open, "広げきった").toBe(1);
  });

  it("クリックされるまで待ち続け、押した直後（holdSec の間）のクリックは受け付けない", () => {
    const ls = beginLoading({ kind: "hub" }, 1, TIPS);
    while (ls.phase !== "wait") stepLoading(ls, FRAME, 1, true);
    expect(confirmLoading(ls), "押した直後は受け付けない").toBe(false);
    expect(loadingPromptVisible(ls), "案内もまだ").toBe(false);
    for (let i = 0; i < 60 * 10; i++) stepLoading(ls, FRAME, 1, true);
    expect(ls.phase, "10 秒たっても待つ").toBe("wait");
    expect(loadingAlpha(ls), "薄れない").toBe(1);
    expect(confirmLoading(ls), "受け付けた").toBe(true);
    expect(ls.phase).toBe("fade");
  });

  it("案内は待つ段の holdSec の後に明滅する（点いている間と消えている間がある）", () => {
    const ls = beginLoading({ kind: "hub" }, 1, TIPS);
    while (ls.phase !== "wait") stepLoading(ls, FRAME, 1, true);
    const shown = new Set<boolean>();
    for (let i = 0; i < 60 * 3; i++) {
      stepLoading(ls, FRAME, 1, true);
      if (ls.phaseTime > LOADING.holdSec) shown.add(loadingPromptVisible(ls));
    }
    expect(shown).toEqual(new Set([true, false]));
  });

  it("開いている間・朱印の間のクリックは何もしない", () => {
    const ls = beginLoading({ kind: "hub" }, 1, TIPS);
    expect(confirmLoading(ls)).toBe(false);
    expect(ls.phase).toBe("open");
  });

  it("薄れる間は不透明度が 1 から 0 へ下がる", () => {
    const ls = beginLoading({ kind: "hub" }, 1, TIPS);
    while (ls.phase !== "fade") {
      stepLoading(ls, FRAME, 1, true);
      if (ls.phase === "wait" && ls.phaseTime > LOADING.holdSec) confirmLoading(ls);
    }
    stepLoading(ls, FRAME, 1, true);
    const first = loadingAlpha(ls);
    for (let i = 0; i < 5; i++) stepLoading(ls, FRAME, 1, true);
    expect(loadingAlpha(ls)).toBeLessThan(first);
    while (!loadingReleased(ls)) stepLoading(ls, FRAME, 1, true);
    expect(loadingAlpha(ls)).toBe(0);
  });

  it("朱印の経過は朱印の段から数え、押す前は null", () => {
    const ls = beginLoading({ kind: "hub" }, 1, TIPS);
    expect(sealAge(ls)).toBeNull();
    while (ls.phase !== "seal") stepLoading(ls, FRAME, 1, true);
    expect(sealAge(ls), "朱印の段に入った直後は間を置く").toBeNull();
    while (ls.phase === "seal" && ls.phaseTime <= LOADING.sealDelaySec) stepLoading(ls, FRAME, 1, true);
    expect(sealAge(ls)).toBeGreaterThan(0);
  });
});

describe("読み込み画面の文字", () => {
  it("行き先の名: 階は「地下 n 階」と階の種類、拠点・稽古の間・御堂はその名", () => {
    expect(loadingTitle({ kind: "floor", depth: 12, floorKind: "cave" })).toEqual({ title: "地下 12 階", sub: "洞窟" });
    expect(loadingTitle({ kind: "hub" }).title).toBe("拠点");
    expect(loadingTitle({ kind: "dojo" }).title).toBe("稽古の間");
    expect(loadingTitle({ kind: "hall" }).title).toBe("御堂");
  });

  it("縦書きの升: 空白で区切り、数字の並びは 1 升にまとめる（縦中横）", () => {
    expect(verticalCells("地下 3 階")).toEqual(["地", "下", "3", "階"]);
    expect(verticalCells("地下 12 階")).toEqual(["地", "下", "12", "階"]);
    expect(verticalCells("稽古の間")).toEqual(["稽", "古", "の", "間"]);
  });

  it("Tips は字数の上限を超える項目を選ばず、seed で決まる（同じ seed なら同じ項目）", () => {
    for (let seed = 0; seed < 40; seed++) {
      const picked = pickLoadingTip(TIPS, seed);
      expect(picked?.key, `seed ${seed}`).not.toBe("long");
      expect(pickLoadingTip(TIPS, seed)?.key, "決定的").toBe(picked?.key);
    }
    const keys = new Set(Array.from({ length: 40 }, (_, s) => pickLoadingTip(TIPS, s)?.key));
    expect(keys.size, "seed が違えば別の項目も出る").toBeGreaterThan(1);
    expect(pickLoadingTip([tip("long", "長".repeat(LOADING.tipMaxChars + 1))], 1), "出せる項目が無ければ null").toBeNull();
  });
});
