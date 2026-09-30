import { describe, expect, it } from "vitest";
import { PX_PER_METER, formatAmount, formatMeters, pxToMeters } from "./units";

describe("距離の単位", () => {
  it("10px を 1m として換算する", () => {
    expect(PX_PER_METER, "1m あたりの px").toBe(10);
    expect(pxToMeters(40), "40px").toBe(4);
  });

  it("表示は小数 1 桁で、末尾の .0 を落とす", () => {
    expect(formatMeters(40), "整数").toBe("4m");
    expect(formatMeters(25), "小数").toBe("2.5m");
    expect(formatMeters(12.34), "丸め").toBe("1.2m");
  });
});

describe("大きな数の表示（formatAmount）", () => {
  it("10 万未満はそのまま、10 万以上は万、1 億以上は億（小数 1 桁、末尾の .0 は落とす）", () => {
    expect(formatAmount(0), "0").toBe("0");
    expect(formatAmount(99_999), "10 万未満").toBe("99999");
    expect(formatAmount(12.6), "四捨五入").toBe("13");
    expect(formatAmount(100_000), "10 万ちょうど").toBe("10万");
    expect(formatAmount(123_456), "12.3 万").toBe("12.3万");
    expect(formatAmount(99_990_000), "丸めても 1 億に届かない").toBe("9999万");
    expect(formatAmount(99_999_999), "丸めて 1 億に届く値は億").toBe("1億");
    expect(formatAmount(120_000_000), "1.2 億").toBe("1.2億");
    expect(formatAmount(1_000_000_000), "10 億").toBe("10億");
  });
});
