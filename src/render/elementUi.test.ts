import { describe, expect, it } from "vitest";
import { ELEMENT_COLOR } from "../core/element";
import type { Item } from "../loot/types";
import { arena, placeEnemy } from "../system/testHelpers";
import { itemAttackLine, loadoutAttackLines, skillAttackLine, weaknessMark } from "./elementUi";

function item(baseKey: string, slot: Item["slot"]): Item {
  return { id: "i", seed: 1, baseKey, slot, rarity: "normal", itemLevel: 1, name: "t", implicit: null, affixes: [], foundDepth: 1, foundAt: 0 };
}

describe("攻撃ジャンル・属性の表示（A-8）", () => {
  it("武器のツールチップに武器種のジャンルと属性、防具には出さない", () => {
    expect(itemAttackLine(item("longsword", "mainHand"))).toBe("剣: 近接・物理 / 無属性");
    expect(itemAttackLine(item("ironRing", "ring"))).toBeNull();
  });

  it("スキルは与ダメを持つものだけ素性を出す", () => {
    expect(skillAttackLine("thunder")).toBe("範囲・魔法 / 雷属性");
    expect(skillAttackLine("haste")).toBeNull();
  });

  it("ステータスの箱の先頭はいまの近接の素性。弾を出せない武器種では射撃の代わりに右の 1 段目の名前を出す", () => {
    const state = arena();
    state.stats.moveset = "sword";
    expect(loadoutAttackLines(state.stats), "剣は撃てないので射撃の代わりに右の技").toEqual(["剣: 近接・物理 / 無属性", "受け流し: 右の技"]);
  });

  it("銃の家系ではこれまで通り射撃の素性を出す", () => {
    const state = arena();
    state.stats.moveset = "gunner";
    expect(loadoutAttackLines(state.stats)).toEqual(["二丁拳銃: 遠距離・物理 / 無属性", "射撃: 遠距離・物理 / 無属性"]);
  });

  it("銃以外でも右の 1 段目が弾を出す型（斧の投擲）なら射撃扱いの素性を出す", () => {
    const state = arena();
    state.stats.moveset = "axe";
    expect(loadoutAttackLines(state.stats)).toEqual(["斧: 近接・物理 / 無属性", "投擲: 遠距離・物理 / 無属性"]);
  });

  it("弱点の印は倒すまで「？」、倒した種類は弱点の色", () => {
    const state = arena();
    const e = placeEnemy(state, "frostGolem", 40);
    expect(weaknessMark(state, e)).toEqual({ known: false, colors: [] });
    state.codexRun.killed.set("frostGolem", 1);
    expect(weaknessMark(state, e)).toEqual({ known: true, colors: [ELEMENT_COLOR.fire] });
  });
});
