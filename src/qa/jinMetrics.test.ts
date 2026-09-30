import { describe, expect, it } from "vitest";
import { createGame } from "../core/game";
import { ROAMING_ROOM } from "../core/state";
import { enemyDef } from "../data/enemies";
import { buildFloorSpawnSection, buildHpMulSection, emptyFloorSpawn, recordFloorSpawn } from "./jinMetrics";

/** 陣の配りの計測（qa/jinMetrics.ts） */
describe("陣の配りの計測", () => {
  it("生成直後の敵の総数・部屋の陣の数・長蛇の本数・陣あたり人数・陣形を数える", () => {
    const state = createGame(3);
    const t = emptyFloorSpawn();
    recordFloorSpawn(t, state);
    // 市の商人（def.merchant）と壺・木箱（def.container）は戦う相手に数えない
    const isFixture = (key: string): boolean => enemyDef(key).merchant === true || enemyDef(key).container !== undefined;
    const combatants = state.enemies.filter((e) => !isFixture(e.defKey));
    // 前室の市は毎階 1 人、旅商人は peddler.chance で 0〜1 人（体はどちらも商人）
    const merchants = state.enemies.filter((e) => enemyDef(e.defKey).merchant === true).length;
    expect(merchants, "体の数 = 商人の数").toBe(state.economy.merchants.length);
    expect(merchants, "商人が 1〜2 人立つ").toBeGreaterThanOrEqual(1);
    expect(combatants.length, "壺・木箱と商人は数えない").toBeLessThan(state.enemies.length - merchants);
    expect(t.enemiesByBand["1-5"], "深度 1 は 1-5 の帯").toEqual([combatants.length]);
    const roomJins = state.jins.filter((j) => j.roomIndex !== ROAMING_ROOM);
    expect(t.roomJins).toEqual([roomJins.length]);
    expect(t.columns).toEqual([state.jins.length - roomJins.length]);
    expect(t.jinMembers.reduce((s, n) => s + n, 0), "陣の人数の合計").toBe(
      state.enemies.filter((e) => e.jinId !== undefined && e.roomIndex !== ROAMING_ROOM).length,
    );
    const formations = Object.values(t.formations).reduce((s, n) => s + (n ?? 0), 0);
    expect(formations, "陣形の出現数の合計 = 陣の数").toBe(state.jins.length);
    expect(buildFloorSpawnSection([t]).length).toBeGreaterThan(0);
    expect(t.hpMuls, "陣ごとに hpMul を 1 つ控える").toEqual(state.jins.map((j) => j.hpMul));
  });

  it("陣の生命の揺らぎは刻みごとに数え、観測が無くても NaN を出さない", () => {
    const md = buildHpMulSection([0.91, 0.95, 0.951, 1.0, 1.09]).join("\n");
    expect(md).toContain("陣 5 個");
    expect(md).toContain("| ×0.94〜0.96 | 2 | 40% |");
    expect(md).not.toMatch(/NaN|Infinity/);
    expect(buildHpMulSection([]).join("\n")).not.toMatch(/NaN|Infinity/);
  });
});
