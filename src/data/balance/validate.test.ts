import { describe, expect, it } from "vitest";
import { diffKeySets, validateBalanceShape } from "./validate";

describe("validateBalanceShape", () => {
  it("有限でない数値・null・文字列でない _note を path 付きで報告する", () => {
    const issues = validateBalanceShape({ a: Number.POSITIVE_INFINITY, b: null, _note: 1, c: { d: Number.NaN } }, "x.json");
    const paths = issues.map((i) => i.path);
    expect(paths).toContain("x.json.a");
    expect(paths).toContain("x.json.b");
    expect(paths).toContain("x.json._note");
    expect(paths).toContain("x.json.c.d");
  });

  it("識別子でないキー(英数と _ 以外)を報告する", () => {
    const issues = validateBalanceShape({ "bad-key": 1 }, "x.json");
    expect(issues.some((i) => i.path === "x.json.bad-key")).toBe(true);
  });

  it("空オブジェクトを報告する", () => {
    const issues = validateBalanceShape({ empty: {} }, "x.json");
    expect(issues.some((i) => i.path === "x.json.empty")).toBe(true);
  });

  it("文字列・真偽・配列はそのまま許可する", () => {
    const issues = validateBalanceShape({ color: "#ffffff", flag: true, list: [1, 2, 3] }, "x.json");
    expect(issues).toEqual([]);
  });

  it("問題が無ければ空配列を返す", () => {
    const issues = validateBalanceShape({ _note: "説明", a: { b: 1, c: [1, 2] } }, "x.json");
    expect(issues).toEqual([]);
  });
});

describe("diffKeySets", () => {
  it("JSON 側の余分と TS 側の余分を両方報告する", () => {
    const issues = diffKeySets("enemies", ["slime", "eye", "ghost"], ["slime", "eye", "boar"]);
    const messages = issues.map((i) => i.message);
    expect(messages.some((m) => m.includes("ghost"))).toBe(true);
    expect(messages.some((m) => m.includes("boar"))).toBe(true);
  });

  it("キー集合が一致すれば空配列を返す", () => {
    expect(diffKeySets("x", ["a", "b"], ["b", "a"])).toEqual([]);
  });
});
