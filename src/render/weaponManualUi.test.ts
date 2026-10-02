import { describe, expect, it } from "vitest";
import { capRuns } from "./weaponManualUi";

const L = { label: "左", long: false };
const R = { label: "右", long: false };
const LL = { label: "左", long: true };

describe("武器指南書の入力の札", () => {
  it("同じ札が 4 枚以上続くと 1 枚にまとめ、まとめた最初の添字を持つ", () => {
    const runs = capRuns([L, L, L, L, L, L, R]);
    expect(runs.map((r) => [r.token.label, r.count, r.start])).toEqual([
      ["左", 6, 0],
      ["右", 1, 6],
    ]);
  });

  it("3 枚までの繰り返しはまとめずに並べる", () => {
    expect(capRuns([L, L, L, R]).map((r) => r.count)).toEqual([1, 1, 1, 1]);
  });

  it("長押しと押すだけは別の札", () => {
    expect(capRuns([L, L, LL, LL, LL, LL]).map((r) => [r.token.long, r.count])).toEqual([
      [false, 1],
      [false, 1],
      [true, 4],
    ]);
  });
});
