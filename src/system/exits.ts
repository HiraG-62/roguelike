import type { LineageKey } from "./boonDefs";

/**
 * 出口の予告（docs/ideas/boon-impl.md 2-3、run-arc.md 3 章 A 案）。
 * 分岐路の階段ごとに「降りた先で何が手に入るか」を先に見せる。祝福の出口は系譜を添える
 */
export type ExitReward =
  | { kind: "boon"; lineage: LineageKey }
  | { kind: "relic" }
  | { kind: "coins" }
  | { kind: "key" }
  | { kind: "flask" }
  | { kind: "danger" }
  | { kind: "temper" }
  | { kind: "none" };
