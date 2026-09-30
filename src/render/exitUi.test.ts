import { describe, expect, it } from "vitest";
import { createGame } from "../core/game";
import type { GameState } from "../core/state";
import { EXIT } from "../data/tuning";
import { TILE_SIZE } from "../map/grid";
import { exitHintAlpha, exitHints } from "./exitUi";

/** 階段 1 つだけの状態。プレイヤーは階段から dist px 離れる */
function stateWithStairs(reward: GameState["stairs"][number]["reward"], dist: number, explored = true): GameState {
  const state = createGame(1);
  const tile = 5 * state.map.width + 5;
  state.stairs = [{ tile, nextKind: "rooms", reward }];
  state.explored[tile] = explored ? 1 : 0;
  const x = (5 + 0.5) * TILE_SIZE;
  const y = (5 + 0.5) * TILE_SIZE;
  state.player.body.pos = { x: x + dist, y };
  return state;
}

describe("出口の予告の表示", () => {
  it("近いほど明るく、hintRange を超えたら出さない", () => {
    expect(exitHintAlpha(0), "真上").toBe(1);
    expect(exitHintAlpha(EXIT.nearRange), "近づいたら全開").toBe(1);
    expect(exitHintAlpha(EXIT.hintRange), "遠い端は dimAlpha").toBeCloseTo(EXIT.dimAlpha, 5);
    expect(exitHintAlpha(EXIT.hintRange + 1), "範囲外").toBe(0);
    const mid = exitHintAlpha((EXIT.nearRange + EXIT.hintRange) / 2);
    expect(mid, "途中は間").toBeLessThan(1);
    expect(mid).toBeGreaterThan(EXIT.dimAlpha);
  });

  it("祝福は「祝福 系譜名」を階段の上に出す", () => {
    const hints = exitHints(stateWithStairs({ kind: "boon", lineage: "ash" }, 10));
    expect(hints.length).toBe(1);
    expect(hints[0]?.text).toBe("祝福 灰燼");
    expect(hints[0]?.color).toBe(EXIT.colors.boon);
    expect(hints[0]?.alpha).toBe(1);
  });

  it("予告なし・未発見・遠い階段・ボス撃破待ち（tile < 0）は出さない", () => {
    expect(exitHints(stateWithStairs({ kind: "none" }, 10)), "予告なし").toEqual([]);
    expect(exitHints(stateWithStairs({ kind: "relic" }, 10, false)), "未発見").toEqual([]);
    expect(exitHints(stateWithStairs({ kind: "relic" }, EXIT.hintRange + 10)), "遠い").toEqual([]);
    const waiting = stateWithStairs({ kind: "relic" }, 10);
    const first = waiting.stairs[0];
    if (!first) throw new Error("階段が無い");
    first.tile = -1;
    expect(exitHints(waiting), "撃破待ち").toEqual([]);
  });
});
