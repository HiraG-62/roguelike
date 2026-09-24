import { describe, expect, it } from "vitest";
import { diffKeySets, fieldDescription, undocumentedLeaves, validateBalanceShape, validateFieldDocs } from "./validate";

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

describe("項目の説明（_fields）", () => {
  it("_fields は文字列値のオブジェクトで、兄弟にも子の行にも無い項目は stale として path 付きで報告する", () => {
    const table = {
      stats: {
        _fields: { hp: "生命", speed: "", ghost: "もう無い項目", "bad-key": "形が違う" },
        slime: { hp: 20, speed: 55 },
      },
      broken: { _fields: "文字列ではだめ", a: 1 },
    };
    const paths = validateFieldDocs(table, "x.json").map((i) => i.path);
    expect(paths, "空の説明").toContain("x.json.stats._fields.speed");
    expect(paths, "stale").toContain("x.json.stats._fields.ghost");
    expect(paths, "key の形").toContain("x.json.stats._fields.bad-key");
    expect(paths, "オブジェクトでない _fields").toContain("x.json.broken._fields");
    expect(paths, "生きている項目は報告しない").not.toContain("x.json.stats._fields.hp");
  });

  it("子の行は親の _fields を引き継ぎ、行に置けば上書きできる", () => {
    const table = {
      stats: {
        _fields: { hp: "生命", lifetime: "親の説明" },
        slime: { hp: 20 },
        goldSlime: { _fields: { lifetime: "行の説明" }, hp: 30, lifetime: 10 },
      },
    };
    expect(validateFieldDocs(table, "x.json")).toEqual([]);
    expect(undocumentedLeaves(table, "x.json")).toEqual([]);
    expect(fieldDescription(table, ["stats", "slime", "hp"])).toBe("生命");
    expect(fieldDescription(table, ["stats", "goldSlime", "lifetime"]), "行の _fields が優先").toBe("行の説明");
  });

  it("ドット表記でネストした項目を説明できる", () => {
    const table = {
      stats: {
        _fields: { "swarm.min": "下限", resist: "属性ごとの耐性" },
        bat: { swarm: { min: 3, max: 5 }, resist: { fire: 50 }, stages: [{ ice: -50 }] },
      },
    };
    expect(validateFieldDocs(table, "x.json")).toEqual([]);
    expect(fieldDescription(table, ["stats", "bat", "swarm", "min"])).toBe("下限");
    expect(fieldDescription(table, ["stats", "bat", "resist", "fire"]), "途中のオブジェクト名の説明が下の葉に効く").toBe("属性ごとの耐性");
    expect(undocumentedLeaves(table, "x.json")).toEqual(["x.json.stats.bat.swarm.max", "x.json.stats.bat.stages[0].ice"]);
  });

  it("色文字列は説明の対象に数えない", () => {
    const table = { fx: { color: "#ff4040", size: 3, on: true } };
    expect(undocumentedLeaves(table, "x.json")).toEqual(["x.json.fx.size", "x.json.fx.on"]);
  });

  it("validateBalanceShape は _fields のドット表記の key を識別子の違反にしない", () => {
    expect(validateBalanceShape({ a: { _fields: { "swarm.min": "下限" }, swarm: { min: 1 } } }, "x.json")).toEqual([]);
  });
});
