import { describe, expect, it } from "vitest";
import { MENU_BUDGET } from "../data/tuning";
import {
  budgetViolations,
  censusOfText,
  countBodyLines,
  countNumbers,
  countTextLines,
  type MenuCensus,
  type MenuTextRun,
} from "./menuBudget";

function run(text: string, y: number, opts: Partial<MenuTextRun> = {}): MenuTextRun {
  return { text, y, body: false, role: "sentence", ...opts };
}

describe("予算の上限（MENU_BUDGET）", () => {
  it("E 案の 4 章の数値どおり（文の行 4・比べるとき 6・数 4・候補 5・帯 4 + 2・珠 4 / 4 / 2）", () => {
    expect(MENU_BUDGET.textLines).toBe(4);
    expect(MENU_BUDGET.compareTextLines).toBe(6);
    expect(MENU_BUDGET.numbers).toBe(4);
    expect(MENU_BUDGET.compareNumbers, "比べる場面は替わる地金の「今 → 後」の数を足した上限").toBe(MENU_BUDGET.numbers + MENU_BUDGET.innateDiffs * 2);
    expect(MENU_BUDGET.candidates).toBe(5);
    expect(MENU_BUDGET.bands).toEqual({ stepped: 4, undercurrent: 2 });
    expect(MENU_BUDGET.beads).toEqual({ source: 4, sink: 4, amplifier: 2 });
  });
});

describe("文の行を数える", () => {
  it("同じ行（y がほぼ同じ）の文字は 1 行にまとめ、行が違えば別に数える", () => {
    const runs = [run("▶ 打刀", 224, { body: true }), run("筋力 ▲", 225), run("源 燃焼系", 238), run("移る", 256)];
    expect(countTextLines(runs)).toBe(3);
  });

  it("札の名前・丸印の 1 字・珠（ornament）と空の文字は数えない", () => {
    const runs = [run("刀", 40, { role: "ornament" }), run("炎", 52, { role: "ornament" }), run("  ", 70), run("見出し", 4)];
    expect(countTextLines(runs)).toBe(1);
  });

  it("y の順が前後していても同じ数になる", () => {
    const a = [run("a", 4), run("b", 224), run("c", 238), run("d", 256)];
    expect(countTextLines([...a].reverse())).toBe(countTextLines(a));
  });

  it("BODY を含む行だけ BODY の行に数える（同じ行の SMALL は足さない）", () => {
    const runs = [run("▶ 打刀", 224, { body: true }), run("筋力 ▲", 224), run("源 燃焼系", 238)];
    expect(countBodyLines(runs)).toBe(1);
  });
});

describe("UI が出す数を数える", () => {
  it("label の数字を 1 塊ずつ数える（「2/4」「地下 7 階」は 1 つずつ）", () => {
    const runs = [run("2/4", 4, { role: "label" }), run("地下 7 階", 4, { role: "label" }), run("残響 紅 6", 180, { role: "label" })];
    expect(countNumbers(runs)).toBe(3);
  });

  it("全角の数字・小数も 1 塊と数える", () => {
    expect(countNumbers([run("１２／３", 4, { role: "label" }), run("1.5m", 4, { role: "label" })])).toBe(2);
  });

  it("性質の文（sentence）と ornament の中の値は数えない", () => {
    const runs = [run("12%の確率で炎上（4ダメージ/秒）", 198), run("15", 40, { role: "ornament" })];
    expect(countNumbers(runs)).toBe(0);
  });
});

describe("予算との比較（budgetViolations）", () => {
  const within: MenuCensus = { lines: 4, bodyLines: 1, numbers: 4, candidates: 5, steppedBands: 4, undercurrentBands: 2, beads: { source: 4, sink: 4, amplifier: 2 } };

  it("上限ちょうどは予算内", () => {
    expect(budgetViolations(within)).toEqual([]);
  });

  it("1 つ超えるごとに項目・実数・上限を返す", () => {
    const v = budgetViolations({ ...within, lines: 5, candidates: 6, beads: { source: 5, sink: 4, amplifier: 3 } });
    expect(v.map((x) => x.item)).toEqual(["文の行", "候補", "源の珠", "強めの珠"]);
    expect(v[0]).toEqual({ item: "文の行", actual: 5, limit: MENU_BUDGET.textLines });
  });

  it("比べる場面だけ数が compareNumbers まで許される", () => {
    expect(budgetViolations({ ...within, numbers: MENU_BUDGET.compareNumbers }, "compare")).toEqual([]);
    expect(budgetViolations({ ...within, numbers: MENU_BUDGET.compareNumbers }, "plain").map((x) => x.item)).toEqual(["UI が出す数"]);
    expect(budgetViolations({ ...within, numbers: MENU_BUDGET.compareNumbers + 1 }, "compare").map((x) => x.item)).toEqual(["UI が出す数"]);
  });

  it("比べる場面だけ文の行が 6 まで許される", () => {
    expect(budgetViolations({ ...within, lines: 6 }, "compare")).toEqual([]);
    expect(budgetViolations({ ...within, lines: 6 }, "plain").map((x) => x.item)).toEqual(["文の行"]);
    expect(budgetViolations({ ...within, lines: 7 }, "compare").map((x) => x.item)).toEqual(["文の行"]);
  });

  it("BODY の行・数・帯の本数も縛る。省略した項目は見ない", () => {
    expect(budgetViolations({ lines: 1, bodyLines: 2, numbers: 5, steppedBands: 5, undercurrentBands: 3 }).map((x) => x.item)).toEqual([
      "BODY の行",
      "UI が出す数",
      "段の立った帯",
      "伏流の帯",
    ]);
    expect(budgetViolations({ lines: 1, bodyLines: 0, numbers: 0 })).toEqual([]);
  });

  it("描いた文字から数えた結果をそのまま比べられる（見本の「装束」画面は 4 行・数 1）", () => {
    const runs = [
      run("装束 剣士・連刃の型", 4, { role: "label" }),
      run("地下 7 階", 4, { role: "label" }),
      run("▶ 右手  打刀「王殺しの不屈」", 224, { body: true }),
      run("源 燃焼系　糧 瀕死系", 238),
      run("↑↓←→ 移る　Enter 選ぶ", 256),
      run("刀", 62, { role: "ornament" }),
    ];
    const census = censusOfText(runs);
    expect(census).toEqual({ lines: 4, bodyLines: 1, numbers: 1 });
    expect(budgetViolations(census)).toEqual([]);
  });
});
