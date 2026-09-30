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
  it("1 万未満はそのまま、1 万以上は K・M・B・T（小数 1 桁、100 以上は整数、末尾の .0 は落とす）", () => {
    expect(formatAmount(0), "0").toBe("0");
    expect(formatAmount(9_999), "1 万未満").toBe("9999");
    expect(formatAmount(12.6), "四捨五入").toBe("13");
    expect(formatAmount(10_000), "1 万ちょうど").toBe("10K");
    expect(formatAmount(12_345), "12.3K").toBe("12.3K");
    expect(formatAmount(123_456), "100 以上は整数").toBe("123K");
    expect(formatAmount(999_950), "丸めて 1000K に届く値は M").toBe("1M");
    expect(formatAmount(1_234_567), "1.2M").toBe("1.2M");
    expect(formatAmount(2_500_000_000), "2.5B").toBe("2.5B");
    expect(formatAmount(3_000_000_000_000), "3T").toBe("3T");
    expect(formatAmount(-12_345), "負の数").toBe("-12.3K");
  });
});
