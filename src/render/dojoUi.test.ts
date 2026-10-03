import { describe, expect, it } from "vitest";
import { DOJO_DAMAGE_KINDS, defaultDojoConfig, type DojoMeterView } from "../system/dojoConfig";
import { dojoMeterRows, dojoSpotPrompt, dojoSummaryLine } from "./dojoUi";

const meter = (over: Partial<DojoMeterView> = {}): DojoMeterView => ({
  elapsed: 12.34,
  total: 5000,
  dps: 405,
  recentDps: 500,
  hits: 10,
  crits: 2,
  maxHit: 900,
  byKind: { melee: 3000, ranged: 0, skill: 2000, dot: 0, other: 0 },
  taken: 40,
  takenHits: 2,
  kills: 3,
  ...over,
});

describe("計測の欄の行", () => {
  it("内訳は 0 の出どころを出さない", () => {
    const labels = dojoMeterRows(meter()).map((r) => r.label);
    expect(labels).toContain("近接");
    expect(labels).toContain("スキル");
    expect(labels).not.toContain("射撃");
    expect(labels).not.toContain("継続");
  });

  it("内訳がすべて 0 なら内訳の行は無い", () => {
    const zero = Object.fromEntries(DOJO_DAMAGE_KINDS.map((k) => [k, 0])) as DojoMeterView["byKind"];
    expect(dojoMeterRows(meter({ byKind: zero })).length).toBe(dojoMeterRows(meter()).length - 2);
  });

  it("経過は小数 1 桁の秒、被弾は回数と傷", () => {
    const rows = dojoMeterRows(meter());
    expect(rows.find((r) => r.label === "経過")?.value).toBe("12.3 秒");
    expect(rows.find((r) => r.label === "被弾")?.value).toBe("40（2 回）");
  });
});

describe("設定の要約", () => {
  it("既定では相手・数・深さ・動きだけ", () => {
    expect(dojoSummaryLine(defaultDojoConfig()).split("　").length).toBe(4);
  });

  it("攻めの速さ・時の流れが既定から外れると添える", () => {
    const line = dojoSummaryLine({ ...defaultDojoConfig(), tempo: 2, timeScale: 0.5 });
    expect(line).toContain("攻めの速さ 2 倍");
    expect(line).toContain("時の流れ 0.5 倍");
  });
});

describe("台の案内", () => {
  it("開ける台ごとに案内文が出る", () => {
    for (const k of ["rack", "board", "exit"] as const) expect(dojoSpotPrompt(k).length).toBeGreaterThan(0);
  });
});
