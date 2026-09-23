import { describe, expect, it } from "vitest";
import { STATUS_KINDS, createStatusBag } from "../core/status";
import { applyStatus } from "../system/statusEffects";
import { arena, placeEnemy } from "../system/testHelpers";
import { POISE_GAUGE_SHOW_RATIO, STATUS_COLOR, STATUS_GLYPH, poiseGaugeVisible, statusIcons } from "./statusUi";

describe("状態異常アイコン", () => {
  it("13 種すべてに 1 文字の表記と色がある", () => {
    for (const kind of STATUS_KINDS) {
      expect([...STATUS_GLYPH[kind]], `${kind} の表記`).toHaveLength(1);
      expect(STATUS_COLOR[kind], `${kind} の色`).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("付いている状態異常だけを STATUS_KINDS の順に、スタック数と残り時間の割合つきで並べる", () => {
    const state = arena();
    const target = { kind: "player" } as const;
    applyStatus(state, target, { kind: "weaken", stacks: 1, duration: 4, potency: 0 }, "enemy");
    applyStatus(state, target, { kind: "poison", stacks: 2, duration: 5, potency: 0 }, "enemy");
    const icons = statusIcons(state.player.status);
    expect(icons.map((i) => i.kind)).toEqual(["poison", "weaken"]);
    expect(icons[0]?.stacks).toBe(2);
    expect(icons[0]?.ratio).toBe(1);
    expect(statusIcons(createStatusBag())).toHaveLength(0);
  });
});

describe("怯みゲージ", () => {
  it("蓄積が耐性の半分を超えるまでは出さない", () => {
    const state = arena();
    const e = placeEnemy(state, "golem", 40);
    e.poise.damage = e.poise.max * POISE_GAUGE_SHOW_RATIO - 1;
    expect(poiseGaugeVisible(e)).toBe(false);
    e.poise.damage = e.poise.max * POISE_GAUGE_SHOW_RATIO;
    expect(poiseGaugeVisible(e)).toBe(true);
  });

  it("怯まない敵（鬼火）には出さない", () => {
    const state = arena();
    const e = placeEnemy(state, "wisp", 40);
    e.poise.damage = 100;
    expect(poiseGaugeVisible(e)).toBe(false);
  });
});
