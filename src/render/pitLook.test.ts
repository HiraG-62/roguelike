import { describe, expect, it } from "vitest";
import type { FloorKind } from "../core/state";
import { pitLook, pitTheme } from "./pitLook";

const KINDS: readonly FloorKind[] = ["rooms", "cave", "dark", "forge", "ossuary", "swamp", "glacier", "mine", "meadow"];

const brightness = (c: readonly [number, number, number]): number => c[0] + c[1] + c[2];

describe("穴の見た目（pitLook）", () => {
  it("深みでは章に関わらず奈落になる", () => {
    for (const kind of KINDS) expect(pitTheme(kind, true), `${kind} の深み`).toBe("abyss");
  });

  it("深みでなければ章ごとの深い地形になる", () => {
    expect(pitTheme("swamp", false)).toBe("water");
    expect(pitTheme("ossuary", false)).toBe("oil");
    expect(pitTheme("forge", false)).toBe("lava");
    expect(pitTheme("glacier", false)).toBe("ice");
    expect(pitTheme("dark", false)).toBe("ink");
  });

  it("奈落のミニマップ色はほぼ黒", () => {
    expect(brightness(pitLook("rooms", true).mini), "奈落は暗い").toBeLessThan(100);
  });

  it("溶岩の穴は水・油・墨の穴より明るい", () => {
    const lava = brightness(pitLook("forge", false).mini);
    for (const kind of ["rooms", "ossuary", "dark"] as const) {
      expect(lava, `${kind} より溶岩が明るい`).toBeGreaterThan(brightness(pitLook(kind, false).mini));
    }
  });

  it("全章・深み有無で色が決まり、縁は本体と別の色になる", () => {
    for (const kind of KINDS) {
      for (const deep of [false, true]) {
        const look = pitLook(kind, deep);
        expect(look.body, `${kind}/${deep} 本体`).toMatch(/^rgb\(\d+,\d+,\d+\)$/);
        expect(look.edge, `${kind}/${deep} 縁`).not.toBe(look.body);
        expect(
          look.mini.every((v) => v >= 0 && v <= 255),
          `${kind}/${deep} ミニマップ`,
        ).toBe(true);
      }
    }
  });
});
