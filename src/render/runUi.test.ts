import { describe, expect, it } from "vitest";
import { createGame } from "../core/game";
import { FLOOR_KIND } from "../data/tuning";
import { buildFloor } from "../system/floor";
import { standContractor } from "../system/contractors";
import { nearestOffer, runSetupParts } from "./runUi";

describe("ラン構造の HUD", () => {
  it("欠片・反転層・帰還は右上の 1 行に並び、何も無ければ出さない", () => {
    const state = createGame(3);
    expect(runSetupParts(state), "放浪者・縛りなし・欠片なし").toEqual([]);
    state.shards = 4;
    expect(runSetupParts(state)).toEqual(["欠片 4"]);
    state.depth = FLOOR_KIND.invertedDepth;
    state.runEvents.strata.revisit = true;
    expect(runSetupParts(state)).toEqual(["欠片 4", "反転層", "帰還"]);
  });

  it("契約者の台座は、名前を読める距離でいちばん近いものだけ名前を出す", () => {
    for (const seed of [3, 5, 7, 11]) {
      const state = createGame(seed);
      state.depth = 4;
      buildFloor(state, "rooms");
      if (!standContractor(state, "peddler")) continue;
      const who = state.contracts.contractor;
      const second = who?.offers[1];
      if (!who || !second) continue;
      state.player.body.pos = { ...second.pos };
      expect(nearestOffer(state, who), "真上の台座").toBe(second);
      second.used = true;
      expect(nearestOffer(state, who), "使った台座は出さない").not.toBe(second);
      state.player.body.pos = { x: -1e4, y: -1e4 };
      expect(nearestOffer(state, who), "遠い").toBeNull();
      return;
    }
    throw new Error("行商を立てられる seed が無い");
  });
});
