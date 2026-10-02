import { describe, expect, it } from "vitest";
import { ENEMIES } from "./enemies";
import { BLOOD_COLOR, COMMANDING_AURA_COLOR, GOFUN_COLOR, KNOWN_EXCEPTIONS, RESERVED_SIGNS } from "./signs";
import { SIGN_CHECK, TELEGRAPH } from "./tuning";
import { STATUS_COLOR } from "../render/statusUi";
import { ELITE_COLOR } from "../system/elites";

/** 符号表の検査（docs/ideas/ink-telegraph-impl.md 段 0-b・案 B）。予告の 4 色を世界の層の他の色が横取りしていないか */

function rgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function linear(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** 相対輝度 0..1 */
function luma(hex: string): number {
  const [r, g, b] = rgb(hex);
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** OKLab（Björn Ottosson の式） */
function oklab(hex: string): [number, number, number] {
  const [r, g, b] = rgb(hex).map(linear) as [number, number, number];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function distance(a: string, b: string): number {
  const [l1, a1, b1] = oklab(a);
  const [l2, a2, b2] = oklab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

/** 世界の層で予告の色と紛れうる色（名前つき）。重複する色は 1 つ目の名前だけ持つ */
function collectWorldColors(): Map<string, string> {
  const out = new Map<string, string>();
  for (const [kind, hex] of Object.entries(STATUS_COLOR)) out.set(`status.${kind}`, hex);
  for (const [kind, hex] of Object.entries(ELITE_COLOR)) out.set(`elite.${kind}`, hex);
  for (const def of ENEMIES) if (def.color) out.set(`enemy.${def.key}`, def.color);
  out.set("blood", BLOOD_COLOR);
  return out;
}

/** 予約色に近すぎて、明るさの差でも分けられない色の名前 */
function clashing(): string[] {
  const names: string[] = [];
  for (const [name, hex] of collectWorldColors()) {
    for (const sign of RESERVED_SIGNS) {
      if (!sign.exclusive) continue;
      const near = distance(hex, sign.color) < SIGN_CHECK.oklabMinDist;
      const sameLight = Math.abs(luma(hex) - luma(sign.color)) < SIGN_CHECK.lumaMinDelta;
      if (near && sameLight) names.push(`${name}~${sign.key}`);
    }
  }
  return names.sort();
}

function chroma(hex: string): number {
  const [, a, b] = oklab(hex);
  return Math.hypot(a, b);
}

describe("符号表: 予告の薄墨・濃墨・朱・胡粉", () => {
  it("薄墨と濃墨、胡粉と濃墨の相対輝度の差が下限以上（灰色にしても 2 段が明暗で分かれる）", () => {
    expect(luma(TELEGRAPH.usuzumiColor) - luma(TELEGRAPH.sumiColor), "薄墨と濃墨").toBeGreaterThanOrEqual(SIGN_CHECK.readyCommitLumaMin);
    expect(luma(TELEGRAPH.gofunColor) - luma(TELEGRAPH.sumiColor), "胡粉と濃墨").toBeGreaterThanOrEqual(SIGN_CHECK.readyCommitLumaMin);
  });

  it("予約色は予告の色そのもの（表と TELEGRAPH がずれない）", () => {
    expect(RESERVED_SIGNS.map((s) => s.color)).toEqual([TELEGRAPH.usuzumiColor, TELEGRAPH.sumiColor, TELEGRAPH.shuColor, TELEGRAPH.gofunColor]);
    expect(GOFUN_COLOR, "怯みの印の胡粉は予告の胡粉と同じ").toBe(TELEGRAPH.gofunColor);
  });

  it("下絵の薄墨（滲み・筋）は色味の無い灰で、朱から離れ、濃墨より明るい", () => {
    for (const hex of [TELEGRAPH.usuzumiColor, TELEGRAPH.usuzumiLightColor, TELEGRAPH.usuzumiDarkColor]) {
      expect(chroma(hex), `${hex} の彩度`).toBeLessThanOrEqual(SIGN_CHECK.usuzumiChromaMax);
      expect(distance(hex, TELEGRAPH.shuColor), `${hex} と朱`).toBeGreaterThanOrEqual(SIGN_CHECK.oklabMinDist);
      expect(luma(hex) - luma(TELEGRAPH.sumiColor), `${hex} と濃墨の明るさ`).toBeGreaterThanOrEqual(SIGN_CHECK.readyCommitLumaMin);
    }
  });

  it("朱は濃墨と明るさで分かれ、薄墨・胡粉とは色で分かれる（墨溜まりの点が黒に埋もれない）", () => {
    expect(luma(TELEGRAPH.shuColor) - luma(TELEGRAPH.sumiColor)).toBeGreaterThanOrEqual(SIGN_CHECK.lumaMinDelta);
    expect(chroma(TELEGRAPH.shuColor), "朱は色味がある").toBeGreaterThan(SIGN_CHECK.usuzumiChromaMax * 2);
  });

  it("世界の層で独占する予約色（濃墨・朱）に紛れる色は既知の例外だけ（増やさない。直したら例外から消す）", () => {
    const expected = KNOWN_EXCEPTIONS.map((x) => x.key).sort();
    expect(clashing()).toEqual(expected);
  });

  it("色替え済みの 2 つ（号令の気・血）は独占する予約色（濃墨・朱）から離れている", () => {
    for (const hex of [COMMANDING_AURA_COLOR, BLOOD_COLOR]) {
      for (const sign of RESERVED_SIGNS.filter((x) => x.exclusive)) {
        const far = distance(hex, sign.color) >= SIGN_CHECK.oklabMinDist || Math.abs(luma(hex) - luma(sign.color)) >= SIGN_CHECK.lumaMinDelta;
        expect(far, `${hex} と ${sign.key}`).toBe(true);
      }
    }
  });
});
