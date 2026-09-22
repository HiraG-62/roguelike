import { describe, expect, it } from "vitest";
import { FIXED_DT } from "../core/loop";
import { enemyDef } from "../data/enemies";
import { ELITE } from "../data/tuning";
import { damageEnemy } from "./combat";
import { eliteChance, finalizeLinks, makeElite, shieldLeft, updateElites } from "./elites";
import { updateEnemies } from "./enemies";
import { updateProjectiles } from "./projectiles";
import { arena, placeEnemy } from "./testHelpers";

describe("eliteChance", () => {
  it("depth 1 は 0、depth 2 以降は基準値から微増して上限で止まる", () => {
    expect(eliteChance(1)).toBe(0);
    expect(eliteChance(2)).toBeCloseTo(ELITE.baseChance);
    expect(eliteChance(5)).toBeGreaterThan(eliteChance(2));
    expect(eliteChance(1000)).toBe(ELITE.maxChance);
  });
});

describe("Linked", () => {
  it("片方が受けたダメージの割合がもう片方にも伝わる", () => {
    const state = arena();
    const a = placeEnemy(state, "slime", 60, -20);
    const b = placeEnemy(state, "slime", 60, 20);
    makeElite(a, "linked");
    makeElite(b, "linked");
    damageEnemy(state, a, 10, { x: 1, y: 0 }, 0);
    updateElites(state);
    expect(a.hp).toBe(a.maxHp - 10);
    expect(b.hp).toBe(b.maxHp - 10);
  });

  it("片方を倒すともう片方も倒れる", () => {
    const state = arena();
    const a = placeEnemy(state, "slime", 60, -20);
    const b = placeEnemy(state, "slime", 60, 20);
    makeElite(a, "linked");
    makeElite(b, "linked");
    damageEnemy(state, a, a.hp, { x: 1, y: 0 }, 0);
    updateEnemies(state, FIXED_DT);
    expect(state.enemies.length).toBe(0);
  });

  it("部屋に 1 体しかいなければ通常敵を相方にする", () => {
    const state = arena();
    const a = placeEnemy(state, "slime", 60, -20);
    const b = placeEnemy(state, "eye", 60, 20);
    makeElite(a, "linked");
    finalizeLinks(state, 0);
    expect(b.elite).toBe("linked");
  });
});

describe("Shielded", () => {
  it("シールドを削り切るまで通常 HP は減らず、割れると怯んで通常 HP になる", () => {
    const state = arena();
    const e = placeEnemy(state, "slime", 60);
    makeElite(e, "shielded");
    const shield = e.shieldMax ?? 0;
    const base = e.maxHp - shield;
    expect(shield).toBeGreaterThan(0);
    expect(shieldLeft(e)).toBe(shield);

    damageEnemy(state, e, shield - 1, { x: 1, y: 0 }, 0);
    updateElites(state);
    expect(shieldLeft(e)).toBe(1);
    expect(e.hp).toBe(base + 1);

    damageEnemy(state, e, 3, { x: 1, y: 0 }, 0);
    updateElites(state);
    expect(e.shieldMax).toBe(0);
    expect(e.maxHp).toBe(base);
    expect(e.hp).toBe(base - 2);
    expect(e.phase).toBe("stagger");
  });
});

describe("Reflective", () => {
  it("プレイヤーの弾を跳ね返して敵弾にする", () => {
    const state = arena();
    const e = placeEnemy(state, "slime", 30);
    makeElite(e, "reflective");
    const hp = e.hp;
    const p = state.player.body.pos;
    state.projectiles.push({
      id: 999,
      owner: "player",
      pos: { x: p.x + 30 - e.body.radius - 1, y: p.y },
      vel: { x: 300, y: 0 },
      radius: 2,
      damage: 5,
      life: 1,
      color: "#fff",
      kind: "ranged",
      hitIds: new Set(),
      pierceLeft: 0,
    });
    updateProjectiles(state, FIXED_DT);
    expect(e.hp).toBe(hp);
    const pr = state.projectiles[0];
    expect(pr?.owner).toBe("enemy");
    expect(pr?.vel.x).toBeLessThan(0);
  });
});

describe("Hasted / 撃破報酬", () => {
  it("Hasted は予備動作が短い", () => {
    const state = arena();
    const e = placeEnemy(state, "slime", 20);
    makeElite(e, "hasted");
    e.phase = "chase";
    e.attackCooldown = 0;
    updateEnemies(state, FIXED_DT);
    expect(e.phase).toBe("windup");
    expect(e.phaseTimer).toBeCloseTo(enemyDef("slime").windup * ELITE.windupMul);
  });

  it("エリート撃破はスコア 3 倍", () => {
    const normal = arena();
    const n = placeEnemy(normal, "slime", 60);
    damageEnemy(normal, n, 9999, { x: 1, y: 0 }, 0);
    updateEnemies(normal, FIXED_DT);

    const elite = arena();
    const e = placeEnemy(elite, "slime", 60);
    makeElite(e, "hasted");
    damageEnemy(elite, e, 9999, { x: 1, y: 0 }, 0);
    updateEnemies(elite, FIXED_DT);
    expect(elite.score).toBe(normal.score * ELITE.scoreMul);
  });

  it("Explosive は死亡後しばらくして爆発する", () => {
    const state = arena();
    const e = placeEnemy(state, "slime", 20);
    makeElite(e, "explosive");
    damageEnemy(state, e, 9999, { x: 1, y: 0 }, 0);
    updateEnemies(state, FIXED_DT);
    expect(state.hazards.some((h) => h.kind === "bomb")).toBe(true);
  });
});
