import { describe, expect, it } from "vitest";
import { BOSS } from "../data/tuning";
import { runBossFight } from "./bossProbe";

/** スライム王の答えの定跡（最小形）。連打の bot と同じ seed で比べる（重い QA は probe の担当。ここは縮小版） */

const KING_DEPTH = BOSS.interval;
const SEEDS = [1, 2, 3] as const;
const MAX_SECONDS = 150;

function answersOf(mode: "mash" | "read"): { drops: number; crowns: number; wins: number } {
  let drops = 0;
  let crowns = 0;
  let wins = 0;
  for (const seed of SEEDS) {
    const fight = runBossFight("kingSlime", KING_DEPTH, seed, MAX_SECONDS, mode);
    drops += fight.answers?.["墜落"] ?? 0;
    crowns += fight.answers?.["冠落ち"] ?? 0;
    if (fight.outcome === "defeated") wins++;
  }
  return { drops, crowns, wins };
}

describe("ボスの答えの定跡（スライム王）", () => {
  it("読む bot は連打より墜落を多く取り、戦いは決着する", () => {
    const mash = answersOf("mash");
    const read = answersOf("read");
    expect(read.drops, "読めば墜落が取れる").toBeGreaterThan(mash.drops);
    expect(read.wins, "読む bot は勝てる").toBeGreaterThan(0);
  });

  it("同じ seed なら同じ結果（決定性）", () => {
    expect(answersOf("read")).toEqual(answersOf("read"));
  });
});
