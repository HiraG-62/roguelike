import { describe, expect, it } from "vitest";
import { STATUS_LABEL } from "../core/status";
import { enemyDef } from "../data/enemies";
import type { ProfileMeta, RunHistoryEntry } from "../loot/types";
import { ELITE_PREFIX, NEMESIS_PREFIX } from "../system/elites";
import { createCodexSave } from "./codex";
import { DEATH_REPORT_MAX_LINES, deathReportLines, historyExtras, hurtLabel, previousComparable } from "./deathReport";
import { arena, placeEnemy } from "../system/testHelpers";
import { damagePlayer } from "../system/combat";

const META: ProfileMeta = { runs: 3, bestDepth: 9, totalKills: 0, bestScore: 0, history: [] };

function row(partial: Partial<RunHistoryEntry>): RunHistoryEntry {
  return { date: 0, seedText: "abc", depth: 6, kills: 0, score: 0, bestCombo: 0, durationSec: 0, cause: "defeated", hurts: 0, ...partial };
}

describe("死亡画面の死因 / 次の山 / 前回比", () => {
  it("死因の行: 敵なら名前・種類・倒された回数、敵でなければ名前だけ", () => {
    const codex = createCodexSave();
    codex.enemyDeaths.wolf = 3;
    const [enemyLine] = deathReportLines(row({ killer: { kind: "strike", key: "wolf", elites: ["hasted"], nemesis: true } }), null, codex, META);
    expect(enemyLine).toContain(enemyDef("wolf").name);
    expect(enemyLine).toContain(`${NEMESIS_PREFIX}${ELITE_PREFIX.hasted}`);
    expect(enemyLine).toContain("3");
    const [statusLine] = deathReportLines(row({ killer: { kind: "status", key: "burn" } }), null, codex, META);
    expect(statusLine).toContain(STATUS_LABEL.burn);
    expect(statusLine, "敵でなければ回数を出さない").not.toContain("3");
  });

  it("死因の短い名: 撃ち手の消えた敵弾・出どころの無い余波も名前を持つ", () => {
    expect(hurtLabel({ kind: "shot", key: "wolf" })).toContain(enemyDef("wolf").name);
    for (const kind of ["shot", "hazard", "blast", "fall", "reaper", "linger", "deferred"] as const) {
      expect(hurtLabel({ kind, key: "" }).length, kind).toBeGreaterThan(0);
    }
    expect(hurtLabel({ kind: "event", key: "thunderstorm" }).length).toBeGreaterThan(0);
    expect(hurtLabel({ kind: "terrain", key: "lava" }).length).toBeGreaterThan(0);
  });

  it("次の山は死んだ深度以上の最初の章ボスか最深の間、深みでは出さない", () => {
    const codex = createCodexSave();
    const at7 = deathReportLines(row({ depth: 7 }), null, codex, META);
    expect(at7.some((l) => l.includes("10") && l.includes(enemyDef("thiefKing").name)), "地下 10 階の章の主").toBe(true);
    const deep = deathReportLines(row({ depth: 25 }), null, codex, META);
    expect(deep, "深みでは次の山も死因も無い").toHaveLength(0);
  });

  it("前回比は到達・被弾・見切りの差を符号つきで、比べる履歴が無ければ出さない", () => {
    const codex = createCodexSave();
    const current = row({ depth: 8, hurts: 5, justDodges: 4 });
    const previous = row({ depth: 6, hurts: 9, justDodges: 4 });
    const lines = deathReportLines(current, previous, codex, META);
    const compare = lines[lines.length - 1] ?? "";
    expect(compare).toContain("+2");
    expect(compare).toContain("-4");
    expect(compare).toContain("±0");
    expect(deathReportLines(current, null, codex, META).some((l) => l.includes("±0")), "比べる相手が無い").toBe(false);
  });

  it("比べる履歴: 今回より古く、離脱でなく、被弾の回数を持つ、デイリーと混ぜない最初の 1 件", () => {
    const current = row({ depth: 8 });
    const old = row({ depth: 3, hurts: undefined });
    const abandoned = row({ cause: "abandoned" });
    const daily = row({ seedText: "2026-09-29" });
    const target = row({ depth: 5 });
    const history = [current, abandoned, old, daily, target];
    expect(previousComparable(history, current)).toBe(target);
    expect(previousComparable([current], current)).toBeNull();
  });

  it("踏破の行は位階と回数、離脱は行なし", () => {
    const lines = deathReportLines(row({ cause: "cleared", tier: 4 }), null, createCodexSave(), { ...META, clears: 2 });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("4");
    expect(lines[0]).toContain("2");
    expect(deathReportLines(row({ cause: "abandoned" }), row({}), createCodexSave(), META)).toEqual([]);
  });

  it("行は 3 行まで", () => {
    const lines = deathReportLines(row({ depth: 3, killer: { kind: "strike", key: "wolf" } }), row({}), createCodexSave(), META);
    expect(lines.length).toBeLessThanOrEqual(DEATH_REPORT_MAX_LINES);
    expect(lines).toHaveLength(3);
  });

  it("履歴の任意項目: 力尽きると死因と仇の種、被弾の回数は 0 でも書く", () => {
    const state = arena();
    state.player.hp = 1;
    state.player.invulnTimer = 0;
    const alive = historyExtras(state);
    expect(alive.killer, "生きている間は死因なし").toBeUndefined();
    expect(alive.hurts, "被弾 0 も書く").toBe(0);
    const e = placeEnemy(state, "wolf", 20);
    damagePlayer(state, 50, e.body.pos, e);
    const dead = historyExtras(state);
    expect(dead.killer).toEqual({ kind: "strike", key: "wolf" });
    expect(dead.grudge).toEqual({ key: "wolf", elites: [] });
    expect(dead.tier, "縛りなしは書かない").toBeUndefined();
    expect(dead.job, "見習いは書かない").toBeUndefined();
  });
});
