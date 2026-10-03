import { describe, expect, it } from "vitest";
import { enemyDef } from "../data/enemies";
import { DOJO } from "../data/tuning";
import {
  DOJO_BEHAVIORS,
  DOJO_ROWS,
  type DojoConfig,
  cycleDojoRow,
  defaultDojoConfig,
  dojoEliteLabel,
  dojoEliteOptions,
  dojoEnemyKeys,
  dojoRowRespawns,
  dojoRowValueLabel,
  isDojoActionRow,
} from "./dojoConfig";
import { DUMMY_KEY } from "./specialRooms";

describe("稽古帳の設定", () => {
  it("既定値は候補の中にある", () => {
    const c = defaultDojoConfig();
    expect(DOJO.countOptions).toContain(c.count);
    expect(DOJO.depthOptions).toContain(c.depth);
    expect(DOJO.distanceOptions).toContain(c.distance);
    expect(DOJO.tempoOptions).toContain(c.tempo);
    expect(DOJO.timeScaleOptions).toContain(c.timeScale);
    expect(c.enemy).toBe(DUMMY_KEY);
  });

  it("値の行は端で一周する", () => {
    const c = defaultDojoConfig();
    const last = DOJO.countOptions[DOJO.countOptions.length - 1];
    expect(cycleDojoRow({ ...c, count: DOJO.countOptions[0] ?? 0 }, "count", -1).count).toBe(last);
    expect(cycleDojoRow({ ...c, count: last ?? 0 }, "count", 1).count).toBe(DOJO.countOptions[0]);
    const lastBehavior = DOJO_BEHAVIORS[DOJO_BEHAVIORS.length - 1];
    expect(cycleDojoRow({ ...c, behavior: lastBehavior ?? "normal" }, "behavior", 1).behavior).toBe(DOJO_BEHAVIORS[0]);
    expect(cycleDojoRow(c, "undying", 1).undying).toBe(!c.undying);
  });

  it("巡回は元の設定を書き換えない", () => {
    const c = defaultDojoConfig();
    const before: DojoConfig = { ...c };
    cycleDojoRow(c, "depth", 1);
    expect(c).toEqual(before);
  });

  it("相手を替えると付けられない修飾は外れ、付けられる修飾は残る", () => {
    const c: DojoConfig = { ...defaultDojoConfig(), enemy: "skeleton", elite: "hasted" };
    const keys = dojoEnemyKeys();
    const next = keys[keys.indexOf("skeleton") + 1] ?? DUMMY_KEY;
    const moved = cycleDojoRow(c, "enemy", 1);
    expect(moved.enemy).toBe(next);
    expect(moved.elite).toBe(dojoEliteOptions(next).includes("hasted") ? "hasted" : null);
    // 動けない敵には強欲のが付かない（eliteKindsFor）。そういう敵へ替えると外れる
    const still = keys.find((k) => enemyDef(k).speed <= 0 && k !== DUMMY_KEY);
    if (still === undefined) return;
    const prev = keys[keys.indexOf(still) - 1];
    if (prev === undefined) return;
    const greedy = cycleDojoRow({ ...c, enemy: prev, elite: "greedy" }, "enemy", 1);
    expect(greedy.enemy).toBe(still);
    expect(greedy.elite).toBeNull();
  });

  it("選べる敵は木人が先頭で、ボス・ボスの部位・商人・壺を含まない", () => {
    const keys = dojoEnemyKeys();
    expect(keys[0]).toBe(DUMMY_KEY);
    expect(new Set(keys).size, "重複なし").toBe(keys.length);
    for (const k of keys) {
      const def = enemyDef(k);
      expect(def.boss === true, k).toBe(false);
      expect(def.bossPart === true, k).toBe(false);
      expect(def.merchant === true, k).toBe(false);
      expect(def.container, k).toBeUndefined();
    }
  });

  it("修飾の候補は付けないが先頭", () => {
    expect(dojoEliteOptions("skeleton")[0]).toBeNull();
    expect(dojoEliteLabel(null)).toBe("なし");
    expect(dojoEliteLabel("hasted")).not.toMatch(/の$/);
  });

  it("湧き直す行と動作の行の区別", () => {
    expect(dojoRowRespawns("enemy")).toBe(true);
    expect(dojoRowRespawns("distance")).toBe(true);
    expect(dojoRowRespawns("behavior")).toBe(false);
    expect(dojoRowRespawns("timeScale")).toBe(false);
    expect(DOJO_ROWS.filter(isDojoActionRow)).toEqual(["respawnNow", "resetMeter", "restore"]);
  });

  it("値の行は表示があり、動作の行は空", () => {
    const c = defaultDojoConfig();
    for (const key of DOJO_ROWS) {
      const label = dojoRowValueLabel(c, key);
      if (isDojoActionRow(key)) expect(label, key).toBe("");
      else expect(label.length, key).toBeGreaterThan(0);
    }
    expect(dojoRowValueLabel({ ...c, undying: true }, "undying")).toBe("する");
    expect(dojoRowValueLabel({ ...c, undying: false }, "undying")).toBe("しない");
  });
});
