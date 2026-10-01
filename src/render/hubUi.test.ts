import { describe, expect, it } from "vitest";
import { spotPrompt } from "./hubUi";

describe("拠点の台の案内文", () => {
  it("井戸は寄進の総額があれば「寄進 n」を添える", () => {
    expect(spotPrompt("well", 120), "寄進あり").toContain("寄進 120");
    expect(spotPrompt("well", 0), "0 なら出さない").not.toContain("寄進");
    expect(spotPrompt("well", undefined), "未設定なら出さない").not.toContain("寄進");
  });

  it("井戸以外の台には寄進を出さない", () => {
    expect(spotPrompt("board", 120)).not.toContain("寄進");
  });
});
