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
    expect(itemAttackLine(item("longsword", "weapon"))).toBe("剣: 近接・物理 / 無属性");
    expect(itemAttackLine(item("ironRing", "ring"))).toBeNull();
  });

  it("スキルは与ダメを持つものだけ素性を出す", () => {
    expect(skillAttackLine("thunder")).toBe("範囲・魔法 / 雷属性");
    expect(skillAttackLine("haste")).toBeNull();
  });

  it("ステータスの箱の先頭はいまの近接と射撃の素性", () => {
    const state = arena();
    expect(loadoutAttackLines(state.stats)).toEqual(["剣: 近接・物理 / 無属性", "単発: 遠距離・物理 / 無属性"]);
  });

  it("弱点の印は倒すまで「？」、倒した種類は弱点の色", () => {
    const state = arena();
    const e = placeEnemy(state, "frostGolem", 40);
    expect(weaknessMark(state, e)).toEqual({ known: false, colors: [] });
    state.codexRun.killed.set("frostGolem", 1);
    expect(weaknessMark(state, e)).toEqual({ known: true, colors: [ELEMENT_COLOR.fire] });
  });
});
