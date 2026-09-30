import { describe, expect, it } from "vitest";
import type { GameState } from "../core/state";
import { BOONS } from "./boonDefs";
import { boonWeight, buildTags } from "./boons";
import { arena } from "./testHelpers";

/** 武器種・銃の弾・ジョブで出る札（BoonDef.loadout）の抽選 */

/** 抽選は祝福を畳む前の装備 stats を読むので、テストでは stats だけを見させる */
function bareArena(): GameState {
  const state = arena(7);
  state.boonRun.baseStats = null;
  return state;
}

describe("武器種で出る札（loadout）", () => {
  it("大剣でないと重き誓いは出ず、大剣なら出る", () => {
    const state = bareArena();
    state.stats.moveset = "sword";
    const sword = buildTags(state);
    expect(boonWeight(BOONS.heavyOath, sword.owned, [], sword.gives, sword.loadout), "剣では 0").toBe(0);
    state.stats.moveset = "greatsword";
    const great = buildTags(state);
    expect(boonWeight(BOONS.heavyOath, great.owned, [], great.gives, great.loadout), "大剣では出る").toBeGreaterThan(0);
  });

  it("loadout の無い札は武器種の影響を受けない", () => {
    const state = bareArena();
    state.stats.moveset = "sword";
    const t = buildTags(state);
    expect(boonWeight(BOONS.leyLine, t.owned, [], t.gives, t.loadout)).toBeGreaterThan(0);
  });
});
