import { describe, expect, it } from "vitest";
import { MOVESET_KEYS } from "../data/weapons";
import { hitFamily } from "../system/effects";
import type { Layer } from "./layers";
import { SFX_NAMES } from "./sfxNames";
import { HIT_WEIGHT_KEYS, WEAPON_HIT_NAMES, weaponHitName } from "./weaponHitNames";
import { WEAPON_HIT_LAYERS, weaponHitFamily, weaponHitLayers } from "./weaponHits";

const kickPeak = (layers: readonly Layer[]): number => layers.filter((l) => l.k === "kick").reduce((m, l) => Math.max(m, l.peak), 0);
const longest = (layers: readonly Layer[]): number =>
  layers.reduce((m, l) => Math.max(m, (l.at ?? 0) + ("dur" in l ? l.dur : 0)), 0);
const ringPeak = (layers: readonly Layer[]): number => layers.filter((l) => l.k === "metal").reduce((m, l) => Math.max(m, l.peak), 0);

describe("武器種ごとの近接命中音", () => {
  it("全武器種 × 重さの名前が SFX_NAMES にあり、層が 1 つ以上ある", () => {
    const names: ReadonlySet<string> = new Set(SFX_NAMES);
    expect(WEAPON_HIT_NAMES.length).toBe(MOVESET_KEYS.length * HIT_WEIGHT_KEYS.length);
    for (const name of WEAPON_HIT_NAMES) {
      expect(names.has(name), name).toBe(true);
      expect(WEAPON_HIT_LAYERS[name].length, name).toBeGreaterThan(0);
    }
  });

  it("系統（刃・打撃・刺突・鞭打）は system/effects.ts の hitFamily と一致する", () => {
    for (const m of MOVESET_KEYS) expect(weaponHitFamily(m), m).toBe(hitFamily(m));
  });

  it("どの武器も重い命中ほど長い", () => {
    for (const m of MOVESET_KEYS) {
      expect(longest(weaponHitLayers(m, "heavy")), m).toBeGreaterThan(longest(weaponHitLayers(m, "light")));
    }
  });

  it("斬撃の武器で性格が違う: 大剣・斧は刀より低い芯が太く、刀と大鎌は鉈より余韻が長く、輪刃は刃鳴りがよく鳴る", () => {
    const mid = (m: (typeof MOVESET_KEYS)[number]): readonly Layer[] => WEAPON_HIT_LAYERS[weaponHitName(m, "mid")];
    expect(kickPeak(mid("greatsword"))).toBeGreaterThan(kickPeak(mid("katana")));
    expect(kickPeak(mid("axe"))).toBeGreaterThan(kickPeak(mid("katana")));
    expect(longest(mid("katana"))).toBeGreaterThan(longest(mid("cleaver")));
    expect(longest(mid("scythe"))).toBeGreaterThan(longest(mid("cleaver")));
    expect(ringPeak(mid("ringBlades"))).toBeGreaterThan(ringPeak(mid("sword")));
  });

  it("爪は 3 粒、双剣は 2 粒の「ザ」が時間をずらして重なる", () => {
    const clicks = (m: (typeof MOVESET_KEYS)[number]): number => weaponHitLayers(m, "mid").filter((l) => l.k === "click").length;
    expect(clicks("claws")).toBe(3);
    expect(clicks("twinBlades")).toBe(2);
    expect(clicks("sword")).toBe(1);
  });
});
