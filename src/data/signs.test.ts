import { describe, expect, it } from "vitest";
import { ENEMIES } from "./enemies";
import { BLOOD_COLOR, COMMANDING_AURA_COLOR, GOFUN_COLOR, KNOWN_EXCEPTIONS, RESERVED_SIGNS } from "./signs";
import { SIGN_CHECK, TELEGRAPH } from "./tuning";
import { STATUS_COLOR } from "../render/statusUi";
import { ELITE_COLOR } from "../system/elites";

/** 符号表の検査（docs/ideas/ink-telegraph-impl.md 段 0-b）。予告の黄・赤を世界の層の他の色が横取りしていないか */

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
  out.set("gofun", GOFUN_COLOR);
  return out;
}

/** 予約色に近すぎて、明るさの差でも分けられない色の名前 */
function clashing(): string[] {
  const names: string[] = [];
  for (const [name, hex] of collectWorldColors()) {
    for (const sign of RESERVED_SIGNS) {
      const near = distance(hex, sign.color) < SIGN_CHECK.oklabMinDist;
      const sameLight = Math.abs(luma(hex) - luma(sign.color)) < SIGN_CHECK.lumaMinDelta;
      if (near && sameLight) names.push(`${name}~${sign.key}`);
    }
  }
  return names.sort();
}

describe("符号表: 予告の黄と赤", () => {
  it("黄と赤の相対輝度の差が下限以上（色が見えにくくても明るさで分かれる）", () => {
    const delta = Math.abs(luma(TELEGRAPH.readyColor) - luma(TELEGRAPH.commitColor));
    expect(delta).toBeGreaterThanOrEqual(SIGN_CHECK.readyCommitLumaMin);
  });

  it("予約色は予告の色そのもの（表と TELEGRAPH がずれない）", () => {
    expect(RESERVED_SIGNS.map((s) => s.color)).toEqual([TELEGRAPH.readyColor, TELEGRAPH.commitColor]);
  });

  it("下絵の淡墨の筋の色は黄の帯の中（色相が黄から離れず、赤とは別）", () => {
    const hue = (hex: string): number => {
      const [, a, b] = oklab(hex);
      return (Math.atan2(b, a) * 180) / Math.PI;
    };
    const diff = Math.abs(hue(TELEGRAPH.sketchDullColor) - hue(TELEGRAPH.readyColor));
    expect(diff, "黄との色相差").toBeLessThanOrEqual(SIGN_CHECK.sketchHueMaxDeg);
    expect(distance(TELEGRAPH.sketchDullColor, TELEGRAPH.commitColor), "赤から離れている").toBeGreaterThanOrEqual(SIGN_CHECK.oklabMinDist);
  });

  it("世界の層で予約色に紛れる色は既知の例外だけ（増やさない。直したら例外から消す）", () => {
    const expected = KNOWN_EXCEPTIONS.map((x) => x.key).sort();
    expect(clashing()).toEqual(expected);
  });

  it("色替え済みの 4 つ（怯みの星・怯みゲージ・号令の気・血）は予約色から離れている", () => {
    for (const hex of [GOFUN_COLOR, COMMANDING_AURA_COLOR, BLOOD_COLOR, STATUS_COLOR.stagger]) {
      for (const sign of RESERVED_SIGNS) {
        const far = distance(hex, sign.color) >= SIGN_CHECK.oklabMinDist || Math.abs(luma(hex) - luma(sign.color)) >= SIGN_CHECK.lumaMinDelta;
        expect(far, `${hex} と ${sign.key}`).toBe(true);
      }
    }
  });
});
