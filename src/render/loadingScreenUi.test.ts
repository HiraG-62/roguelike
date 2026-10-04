import { describe, expect, it } from "vitest";
import { RENDER_SCALE } from "../core/view";
import { SEAL_DOTS, sealPixels } from "./loadingScreenUi";

describe("読み込み画面の朱印", () => {
  it("画面の実際の細かさ（論理 1px = RENDER_SCALE ドット）で作り、朱の地に字を白く刻み、縁が欠ける", () => {
    expect(SEAL_DOTS % RENDER_SCALE, "論理 px の整数倍").toBe(0);
    const px = sealPixels(SEAL_DOTS);
    const counts = new Map<string, number>();
    for (const c of px) {
      const kind = c === 0 ? "欠け" : (c & 255) > 220 && ((c >>> 8) & 255) > 200 ? "刻み" : "朱";
      counts.set(kind, (counts.get(kind) ?? 0) + 1);
    }
    const total = px.length;
    expect((counts.get("朱") ?? 0) / total, "朱が地").toBeGreaterThan(0.5);
    expect((counts.get("刻み") ?? 0) / total, "字の線が読める太さ").toBeGreaterThan(0.12);
    expect((counts.get("欠け") ?? 0) / total, "欠けは少し").toBeGreaterThan(0.005);
    expect(sealPixels(SEAL_DOTS), "決定的").toEqual(px);
  });
});
