import { describe, expect, it } from "vitest";
import { createGame } from "../core/game";
import { ROAMING_ROOM } from "../core/state";
import { buildFloorSpawnSection, emptyFloorSpawn, recordFloorSpawn } from "./jinMetrics";

/** 陣の配りの計測（qa/jinMetrics.ts） */
describe("陣の配りの計測", () => {
  it("生成直後の敵の総数・部屋の陣の数・長蛇の本数・陣あたり人数・陣形を数える", () => {
    const state = createGame(3);
    const t = emptyFloorSpawn();
    recordFloorSpawn(t, state);
    expect(t.enemiesByBand["1-2"], "深度 1 は 1-2 の帯").toEqual([state.enemies.length]);
    const roomJins = state.jins.filter((j) => j.roomIndex !== ROAMING_ROOM);
    expect(t.roomJins).toEqual([roomJins.length]);
    expect(t.columns).toEqual([state.jins.length - roomJins.length]);
    expect(t.jinMembers.reduce((s, n) => s + n, 0), "陣の人数の合計").toBe(
      state.enemies.filter((e) => e.jinId !== undefined && e.roomIndex !== ROAMING_ROOM).length,
    );
    const formations = Object.values(t.formations).reduce((s, n) => s + (n ?? 0), 0);
    expect(formations, "陣形の出現数の合計 = 陣の数").toBe(state.jins.length);
    expect(buildFloorSpawnSection([t]).length).toBeGreaterThan(0);
  });
});
