import { describe, expect, it } from "vitest";
import type { FloorKind } from "../core/state";
import { SCROLL_H, SCROLL_W, inkCoverage, scrollPixels } from "./loadingScrollArt";
import type { MapStyle } from "./mapTypes";

const STYLES: readonly MapStyle[] = ["moss", "temple", "castleFire", "castleFrost", "deep", "final", "town"];
const KINDS: readonly (FloorKind | null)[] = ["rooms", "cave", "dark", "forge", "ossuary", "swamp", "glacier", "mine", "meadow", null];

function diff(a: Uint32Array, b: Uint32Array): number {
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
  return n / a.length;
}

describe("絵巻の紙と山水（loadingScrollArt）", () => {
  it("同じ入力なら同じ絵（決定的）で、大きさは紙の寸法", () => {
    const a = scrollPixels({ style: "moss", floorKind: "cave", seed: 5 });
    const b = scrollPixels({ style: "moss", floorKind: "cave", seed: 5 });
    expect(a.length).toBe(SCROLL_W * SCROLL_H);
    expect(diff(a, b)).toBe(0);
  });

  it("章の様式と階の種類で絵が変わる", () => {
    const base = scrollPixels({ style: "moss", floorKind: "rooms", seed: 5 });
    expect(diff(base, scrollPixels({ style: "temple", floorKind: "rooms", seed: 5 })), "様式").toBeGreaterThan(0.005);
    expect(diff(base, scrollPixels({ style: "moss", floorKind: "cave", seed: 5 })), "階の種類").toBeGreaterThan(0.005);
  });

  it("どの組み合わせでも真っ白にも真っ黒にもならない", () => {
    for (const style of STYLES) {
      for (const floorKind of KINDS) {
        const c = inkCoverage(scrollPixels({ style, floorKind, seed: 3 }));
        expect(c, `${style} / ${floorKind}`).toBeGreaterThan(0.08);
        expect(c, `${style} / ${floorKind}`).toBeLessThan(0.75);
      }
    }
  });
});
