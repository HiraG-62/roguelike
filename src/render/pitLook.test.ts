import { describe, expect, it } from "vitest";
import type { FloorKind } from "../core/state";
import { PIT_OF_KIND } from "../data/mapThemes";
import { mapThemeFor } from "./mapTheme";
import { pitLook, pitLookAt, pitLookOf, pitTheme, pitThemeAt } from "./pitLook";

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

  it("深さつきの引きは MapTheme.pit と必ず一致する", () => {
    for (const depth of [1, 3, 5, 6, 10, 11, 15, 16, 20, 21, 22, 30]) {
      for (const kind of KINDS) {
        expect(pitThemeAt(depth, kind), `深度 ${depth} の ${kind}`).toBe(mapThemeFor(depth, kind).pit);
      }
    }
  });

  it("章 4・最深の間より先は奈落、章 1〜3 はバイオームの対応", () => {
    for (const kind of KINDS) {
      expect(pitThemeAt(16, kind), `${kind} 章 4`).toBe("abyss");
      expect(pitThemeAt(23, kind), `${kind} 深み`).toBe("abyss");
      expect(pitThemeAt(3, kind), `${kind} 章 1`).toBe(PIT_OF_KIND[kind]);
      expect(pitThemeAt(8, kind), `${kind} 章 2`).toBe(PIT_OF_KIND[kind]);
    }
  });

  it("色は PIT_COLORS の deep 色から作り、表の移行前と同じ色になる", () => {
    expect(pitLookOf("water").mini, "水").toEqual([30, 54, 73]);
    expect(pitLookAt(3, "swamp"), "深さつきでも同じ見た目").toBe(pitLookOf("water"));
    expect(pitLook("forge", false), "旧い呼び方でも同じ見た目").toBe(pitLookOf("lava"));
  });
});
