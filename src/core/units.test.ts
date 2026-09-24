import { describe, expect, it } from "vitest";
import { PX_PER_METER, formatMeters, pxToMeters } from "./units";

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
