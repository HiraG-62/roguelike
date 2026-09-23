import { describe, expect, it } from "vitest";
import { FIXED_DT } from "../core/loop";
import type { EnemyPhase } from "../core/state";
import { enemyDef } from "../data/enemies";
import { ELITE, POISE } from "../data/tuning";
import { damageEnemy } from "./combat";
import {
  ELITE_COLOR,
  ELITE_KINDS,
  ELITE_PREFIX,
  eliteChance,
  eliteKindsFor,
  eliteSpeedMul,
  finalizeLinks,
  makeElite,
  rollElite,
  shieldLeft,
  updateElites,
} from "./elites";
import { applyStagger, isStaggered } from "./poise";
import { applyStatus, findStatus, hasStatus } from "./statusEffects";
import { updateEnemies } from "./enemies";
import { updateProjectiles } from "./projectiles";
import { arena, placeEnemy } from "./testHelpers";
import { overlapsWall } from "./physics";
import { TILE_SIZE } from "../map/grid";

describe("eliteChance", () => {
  it("depth < minDepth は 0、minDepth 以降は基準値から微増して上限で止まる", () => {
    expect(eliteChance(ELITE.minDepth - 1)).toBe(0);
    expect(eliteChance(ELITE.minDepth)).toBeCloseTo(ELITE.baseChance);
    expect(eliteChance(ELITE.minDepth + 3)).toBeGreaterThan(eliteChance(ELITE.minDepth));
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
    expect(isStaggered(e), "障壁が割れると怯む").toBe(true);
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

// -----------------------------------------------------------------------------
// 追加の修飾子（docs/ideas/enemies.md 4 章）
// -----------------------------------------------------------------------------

describe("追加の修飾子: 表示", () => {
  it("すべての修飾子に接頭辞と色がある", () => {
    expect(ELITE_KINDS.length).toBeGreaterThanOrEqual(15);
    for (const kind of ELITE_KINDS) {
      expect(ELITE_PREFIX[kind], kind).toMatch(/の$/);
      expect(ELITE_COLOR[kind], kind).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("抽選に出ない敵（付き物）はエリートにならない", () => {
    const state = arena();
    state.depth = 30;
    const sister = placeEnemy(state, "twinSister", 60);
    const pillar = placeEnemy(state, "icePillar", -60);
    for (let i = 0; i < 50; i++) {
      rollElite(state, sister);
      rollElite(state, pillar);
    }
    expect(sister.elite).toBeUndefined();
    expect(pillar.elite).toBeUndefined();
  });
});

describe("残響の", () => {
  it("攻撃を終えると、もう一度予備動作から同じ攻撃を繰り返し、その後は隙に戻る", () => {
    const state = arena();
    const e = placeEnemy(state, "slime", 20);
    makeElite(e, "echoing");
    e.phase = "chase";
    e.attackCooldown = 0;
    // phase は updateEnemies の中で変わるので、読み出しを関数にして型の絞り込みを切る
    const phaseOf = (): EnemyPhase => e.phase;
    let windups = 0;
    let prev = phaseOf();
    for (let i = 0; i < 300 && phaseOf() !== "recover"; i++) {
      updateEnemies(state, FIXED_DT);
      if (phaseOf() === "windup" && prev !== "windup") windups += 1;
      prev = phaseOf();
    }
    expect(windups, "予告が 2 回出る").toBe(2);
    expect(e.phase).toBe("recover");
  });
});

describe("伝染の", () => {
  it("倒れると一番近い敵に修飾子が移り、HP の割合は保たれる（全快しない）", () => {
    const state = arena();
    const a = placeEnemy(state, "slime", 60);
    const b = placeEnemy(state, "slime", 80);
    const far = placeEnemy(state, "slime", -120);
    makeElite(a, "contagious");
    damageEnemy(state, b, 10, { x: 1, y: 0 }, 0);
    const ratio = b.hp / b.maxHp;
    damageEnemy(state, a, 9999, { x: 1, y: 0 }, 0);
    updateEnemies(state, FIXED_DT);
    expect(b.elite).toBe("contagious");
    expect(far.elite).toBeUndefined();
    expect(b.hp / b.maxHp).toBeCloseTo(ratio, 1);
    expect(b.hp).toBeLessThan(b.maxHp);
  });
});

describe("堅牢の", () => {
  it("怯み耐性が高く、怯むと怯みが延び、脆弱になる", () => {
    const state = arena();
    const plain = placeEnemy(state, "slime", 60);
    const e = placeEnemy(state, "slime", -60);
    makeElite(e, "bulwark");
    expect(e.poise.max).toBeCloseTo(plain.poise.max * POISE.eliteMul * ELITE.bulwarkPoiseMul);
    applyStagger(state, e, 0.5);
    updateElites(state, FIXED_DT);
    expect(findStatus(e.status, "stagger")?.time ?? 0).toBeCloseTo(0.5 * ELITE.bulwarkStaggerMul);
    expect(hasStatus(e.status, "vulnerable")).toBe(true);
  });
});

describe("報復の", () => {
  it("怯んだ瞬間は無害で、retaliateDelay 後に衝撃波を返す", () => {
    const state = arena();
    const e = placeEnemy(state, "slime", 40);
    makeElite(e, "retaliating");
    applyStagger(state, e, 1);
    updateElites(state, FIXED_DT);
    expect(state.hazards.some((h) => h.kind === "shockwave"), "予告の間は出ない").toBe(false);
    for (let i = 0; i < Math.ceil(ELITE.retaliateDelay / FIXED_DT) + 1; i++) updateElites(state, FIXED_DT);
    expect(state.hazards.some((h) => h.kind === "shockwave")).toBe(true);
  });
});

describe("分光の", () => {
  it("付いた状態異常の種類に免疫を持ち、付け直せない", () => {
    const state = arena();
    const e = placeEnemy(state, "slime", 40);
    makeElite(e, "prismatic");
    const burn = { kind: "burn" as const, stacks: 1, duration: 1, potency: 3 };
    expect(applyStatus(state, { kind: "enemy", enemy: e }, burn, "player")).toBe(true);
    updateElites(state, FIXED_DT);
    expect(e.status.immune.burn ?? 0).toBeGreaterThan(0);
    expect(applyStatus(state, { kind: "enemy", enemy: e }, burn, "player"), "同じ種類は通らない").toBe(false);
    const poison = { kind: "poison" as const, stacks: 1, duration: 1, potency: 0 };
    expect(applyStatus(state, { kind: "enemy", enemy: e }, poison, "player"), "別の種類は通る").toBe(true);
  });
});

describe("刻限の", () => {
  it("時計が切れると迅速と同じ速さ・予備動作になる", () => {
    const state = arena();
    const e = placeEnemy(state, "slime", 40);
    makeElite(e, "timed");
    expect(eliteSpeedMul(e)).toBe(1);
    expect(e.eliteWork?.timer).toBe(ELITE.timedClock);
    const poise = e.poise.max;
    if (e.eliteWork) e.eliteWork.timer = FIXED_DT / 2;
    updateElites(state, FIXED_DT);
    expect(eliteSpeedMul(e)).toBe(ELITE.speedMul);
    expect(e.poise.max).toBeCloseTo(poise * ELITE.timedPoiseMul);
  });
});

describe("寄生の / 群長の", () => {
  it("寄生のは倒れると小さな蝙蝠を parasiteCount 体出す", () => {
    const state = arena();
    const e = placeEnemy(state, "slime", 40);
    makeElite(e, "parasitic");
    damageEnemy(state, e, 9999, { x: 1, y: 0 }, 0);
    updateEnemies(state, FIXED_DT);
    const bats = state.enemies.filter((o) => o.defKey === "bat");
    expect(bats.length).toBe(ELITE.parasiteCount);
    expect(bats.every((b) => b.maxHp === ELITE.parasiteHp)).toBe(true);
  });

  it("寄生のすり抜ける敵（鬼火）が壁の中で倒れても、蝙蝠は壁の外に湧く", () => {
    const state = arena();
    const room = state.map.rooms[0];
    if (!room) throw new Error("no room");
    const w = placeEnemy(state, "wisp", 0);
    // 部屋の左の壁の中（1.5 マス奥）
    w.body.pos = { x: room.x * TILE_SIZE - TILE_SIZE * 1.5, y: (room.y + room.h / 2) * TILE_SIZE };
    expect(overlapsWall(state, w.body.pos.x, w.body.pos.y, w.body.radius), "親は壁の中").toBe(true);
    makeElite(w, "parasitic");
    damageEnemy(state, w, 9999, { x: 1, y: 0 }, 0);
    updateEnemies(state, FIXED_DT);
    const bats = state.enemies.filter((o) => o.defKey === "bat");
    expect(bats.length).toBe(ELITE.parasiteCount);
    for (const b of bats) expect(overlapsWall(state, b.body.pos.x, b.body.pos.y, b.body.radius), `蝙蝠 ${b.id}`).toBe(false);
  });

  it("群長のは同じ種類の小型を packedCount 体連れる（小型はエリートではない）", () => {
    const state = arena();
    const e = placeEnemy(state, "eye", 60);
    makeElite(e, "packed");
    updateElites(state, FIXED_DT);
    const smalls = state.enemies.filter((o) => o !== e);
    expect(smalls.length).toBe(ELITE.packedCount);
    expect(smalls.every((s) => s.defKey === "eye" && !s.elite && s.maxHp < e.maxHp)).toBe(true);
    updateElites(state, FIXED_DT);
    expect(state.enemies.length, "2 回目は増えない").toBe(1 + ELITE.packedCount);
  });
});

describe("修飾子の抽選", () => {
  it("ドロップ確定の敵（部屋主・金色スライム）には群長の（同じ敵を連れて湧く）が付かない", () => {
    expect(eliteKindsFor(enemyDef("mimic"))).not.toContain("packed");
    expect(eliteKindsFor(enemyDef("goldSlime"))).not.toContain("packed");
    expect(eliteKindsFor(enemyDef("slime"))).toContain("packed");
    const state = arena();
    state.depth = 20;
    for (let i = 0; i < 200; i++) {
      const e = placeEnemy(state, "mimic", 40);
      rollElite(state, e);
      expect(e.elite, `${i} 回目`).not.toBe("packed");
    }
  });
});

describe("不動の / 貪食の", () => {
  it("不動のはノックバックで動かない", () => {
    const state = arena();
    const e = placeEnemy(state, "slime", 200);
    makeElite(e, "anchored");
    const pos = { ...e.body.pos };
    e.knock = { x: 400, y: 0 };
    updateEnemies(state, FIXED_DT);
    expect(e.body.pos).toEqual(pos);
    expect(eliteSpeedMul(e)).toBe(ELITE.anchoredSpeedMul);
  });

  it("貪食のは近くの死骸を吸って回復する", () => {
    const state = arena();
    const e = placeEnemy(state, "slime", 60);
    makeElite(e, "devouring");
    const victim = placeEnemy(state, "slime", 75);
    damageEnemy(state, victim, 9999, { x: 1, y: 0 }, 0);
    updateEnemies(state, FIXED_DT);
    expect(state.corpses.length).toBe(1);
    e.hp = Math.round(e.maxHp / 2);
    const hp = e.hp;
    updateElites(state, FIXED_DT);
    expect(e.hp).toBeGreaterThan(hp);
    expect(state.corpses.length).toBe(0);
  });
});

// -----------------------------------------------------------------------------
// 敵側から見たシナジーの穴（docs/ideas/enemies.md 7 章 H1 / H5）
// -----------------------------------------------------------------------------

describe("シナジーの穴: 反射と連結", () => {
  it("反射のに弾を返されても、弾が運ぶ燃焼は敵に残る（H1）", () => {
    const state = arena(5, { burnChance: 1, burnDps: 5 });
    const e = placeEnemy(state, "slime", 30);
    makeElite(e, "reflective");
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
    expect(state.projectiles[0]?.owner, "弾は返される").toBe("enemy");
    expect(hasStatus(e.status, "burn"), "燃焼は残る").toBe(true);
  });

  it("連結の紐は感電を伝え、1 体の感電が相方にも入る（H5）", () => {
    const state = arena();
    const a = placeEnemy(state, "slime", 60, -20);
    const b = placeEnemy(state, "slime", 60, 20);
    makeElite(a, "linked");
    makeElite(b, "linked");
    applyStatus(state, { kind: "enemy", enemy: a }, { kind: "shock", stacks: 1, duration: 2, potency: 4 }, "player");
    expect(hasStatus(b.status, "shock")).toBe(false);
    updateElites(state, FIXED_DT);
    expect(hasStatus(b.status, "shock")).toBe(true);
  });
});
