import { describe, expect, it } from "vitest";
import { STATUS_KINDS, createStatusBag } from "../core/status";
import { TRAIT_COLORS, TRAIT_COLOR_HEX } from "../loot/types";
import { applyStatus } from "../system/statusEffects";
import { arena, placeEnemy } from "../system/testHelpers";
import { POISE_GAUGE_SHOW_RATIO, STATUS_COLOR, STATUS_GLYPH, poiseGaugeVisible, statusIcons } from "./statusUi";

describe("状態異常アイコン", () => {
  it("すべての状態異常に 1 文字の表記と色があり、表記は重ならない", () => {
    for (const kind of STATUS_KINDS) {
      expect([...STATUS_GLYPH[kind]], `${kind} の表記`).toHaveLength(1);
      expect(STATUS_COLOR[kind], `${kind} の色`).toMatch(/^#[0-9a-f]{6}$/);
    }
    const glyphs = STATUS_KINDS.map((kind) => STATUS_GLYPH[kind]);
    expect(new Set(glyphs).size, "表記の重複").toBe(glyphs.length);
  });

  it("良い状態は good、彩痕は付いている色で出す", () => {
    const state = arena();
    const target = { kind: "player" } as const;
    applyStatus(state, target, { kind: "haste", stacks: 1, duration: 3, potency: 0 }, "player");
    expect(statusIcons(state.player.status)[0]?.good).toBe(true);
    const e = placeEnemy(state, "golem", 40);
    applyStatus(state, { kind: "enemy", enemy: e }, { kind: "hue", stacks: 1, duration: 3, potency: TRAIT_COLORS.indexOf("gold") }, "player");
    expect(statusIcons(e.status)[0]?.color).toBe(TRAIT_COLOR_HEX.gold);
    expect(statusIcons(e.status)[0]?.good).toBe(false);
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

describe("状態異常の世代表示（synergy-web 2-b）", () => {
  it("直接当てたものは inherited でなく、延焼・引き継ぎ（source env）は inherited", () => {
    const state = arena();
    const direct = placeEnemy(state, "golem", 40);
    const spread = placeEnemy(state, "golem", -40);
    applyStatus(state, { kind: "enemy", enemy: direct }, { kind: "burn", stacks: 1, duration: 3, potency: 2 }, "player");
    applyStatus(state, { kind: "enemy", enemy: spread }, { kind: "burn", stacks: 1, duration: 3, potency: 2 }, "env");
    expect(statusIcons(direct.status)[0]?.inherited, "直接").toBe(false);
    expect(statusIcons(spread.status)[0]?.inherited, "移ってきた").toBe(true);
  });
});
