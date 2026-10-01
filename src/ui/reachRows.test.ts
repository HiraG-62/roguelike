import { describe, expect, it } from "vitest";
import { createGame } from "../core/game";
import { REACH } from "../data/tuning";
import { REACH_DEFS } from "../loot/reach";
import { DEFAULT_STATS, type PlayerStats } from "../loot/types";
import { reachRows } from "./reachRows";
import { bodyReachRows } from "./sheetBody";

/** 書付「体」に出る到達の行（装備だけの stats.reach から組む） */

function statsWithReach(reach: Partial<Record<"chain" | "burn" | "morale", number>>): PlayerStats {
  return { ...DEFAULT_STATS, reach: { ...DEFAULT_STATS.reach, ...reach } };
}

describe("到達の行", () => {
  it("測る量が 0 の到達は出さない", () => {
    expect(reachRows(DEFAULT_STATS), "何も無ければ空").toHaveLength(0);
    const rows = reachRows(statsWithReach({ burn: 3 }));
    expect(rows.map((r) => r.key), "燃焼の軸だけ").toEqual(["reach:burn"]);
  });

  it("届けば info が「到達」、届かなければ 今 / 閾値", () => {
    const reached = reachRows(statsWithReach({ morale: REACH.morale }))[0];
    expect(reached?.info, "届いた").toBe("到達");
    const partial = reachRows(statsWithReach({ morale: REACH.morale - 10 }))[0];
    expect(partial?.info, "届いていない").toBe(`+${REACH.morale - 10}/+${REACH.morale}`);
    expect(partial?.detail, "測る量・閾値・効果を載せる").toBe(
      `${REACH_DEFS.morale.measureLabel} +${REACH.morale - 10} / +${REACH.morale}: ${REACH_DEFS.morale.effect}`,
    );
  });

  it("連鎖係数は % で出し、軸の並びは無尽 → 燎原 → 常在", () => {
    const rows = reachRows(statsWithReach({ chain: 0.5, burn: 1, morale: 1 }));
    expect(rows.map((r) => r.name)).toEqual([REACH_DEFS.chain.name, REACH_DEFS.burn.name, REACH_DEFS.morale.name]);
    expect(rows[0]?.info, "+50% / +80%").toBe(`+50%/+${Math.round(REACH.chain * 100)}%`);
  });

  it("拠点（sandbox）の state でも書付「体」に出る", () => {
    const state = createGame(1);
    state.sandbox = true;
    expect(bodyReachRows(state), "装備が無ければ空").toHaveLength(0);
    state.stats = statsWithReach({ chain: REACH.chain });
    const rows = bodyReachRows(state);
    expect(rows[0]?.key, "先頭が到達").toBe("reach:chain");
    expect(rows[0]?.info).toBe("到達");
  });
});
