import { describe, expect, it } from "vitest";
import { ENEMIES, enemyDef, type EnemyBehavior } from "./enemies";
import { ENEMY_ROLES, GRADE_LABEL, ROLE_BY_BEHAVIOR, ROLE_ELITE_EXCLUDE, ROLE_LABEL, gradeOf, roleOf } from "./enemyRoles";

describe("敵の役割", () => {
  it("全 behavior に役割があり、役割の一覧と表示名に含まれる", () => {
    const behaviors = new Set<EnemyBehavior>(ENEMIES.map((d) => d.behavior));
    for (const b of behaviors) {
      const role = ROLE_BY_BEHAVIOR[b];
      expect(ENEMY_ROLES, `${b} の役割 ${String(role)}`).toContain(role);
    }
    for (const role of ENEMY_ROLES) {
      expect(ROLE_LABEL[role], `${role} の表示名`).not.toBe("");
    }
  });

  it("全ての敵定義が役割を持つ（roleOf が一覧のどれかを返す）", () => {
    for (const def of ENEMIES) {
      expect(ENEMY_ROLES, `${def.key} の役割`).toContain(roleOf(def));
    }
  });

  it("swarm を持つ敵は群れ、explode / deathBomb を持つ敵は爆発になる", () => {
    const swarms = ENEMIES.filter((d) => d.swarm !== undefined && d.role === undefined);
    expect(swarms.length, "swarm を持つ敵がいる").toBeGreaterThan(0);
    for (const def of swarms) expect(roleOf(def), `${def.key} は群れ`).toBe("swarm");

    const blasts = ENEMIES.filter((d) => (d.explode !== undefined || d.deathBomb !== undefined) && d.swarm === undefined && d.role === undefined);
    expect(blasts.length, "爆発の敵がいる").toBeGreaterThan(0);
    for (const def of blasts) expect(roleOf(def), `${def.key} は爆発`).toBe("blast");
  });

  it("swarm は explode より先に決まる（群れで湧く自爆の導火鼠は群れ）", () => {
    const def = enemyDef("fuseRat");
    expect(def.swarm, "導火鼠は群れで湧く").toBeDefined();
    expect(def.explode, "導火鼠は自爆する").toBeDefined();
    expect(roleOf(def), "swarm と explode の両方").toBe("swarm");
  });

  it("明示の role は規則より優先される", () => {
    const def = { ...enemyDef("bat"), role: "support" as const };
    expect(roleOf(def), "role 指定").toBe("support");
  });

  it("例外の 2 件: 投網兵は妨害、群れの長は支援", () => {
    expect(ROLE_BY_BEHAVIOR.shooter, "投網兵の behavior の表は射手").toBe("shooter");
    expect(roleOf(enemyDef("netter")), "投網兵").toBe("disruptor");
    expect(ROLE_BY_BEHAVIOR.packLeader, "群れの長の behavior の表は前衛").toBe("vanguard");
    expect(roleOf(enemyDef("packLeader")), "群れの長").toBe("support");
  });

  it("代表的な敵は表どおりの役割になる", () => {
    expect(roleOf(enemyDef("slime")), "スライム").toBe("vanguard");
    expect(roleOf(enemyDef("boar")), "猪").toBe("charge");
    expect(roleOf(enemyDef("eye")), "浮遊眼").toBe("shooter");
    expect(roleOf(enemyDef("bomber")), "爆弾ゴブリン").toBe("blast");
    expect(roleOf(enemyDef("bat")), "蝙蝠").toBe("swarm");
  });
});

describe("敵の格", () => {
  it("精鋭は elite、強は grade、それ以外は並", () => {
    expect(gradeOf({}), "無印").toBe("normal");
    expect(gradeOf({ grade: "strong" }), "強").toBe("strong");
    expect(gradeOf({ elite: "hasted" }), "精鋭").toBe("elite");
  });

  it("精鋭で強の敵は精鋭として数える", () => {
    expect(gradeOf({ elite: "hasted", grade: "strong" }), "精鋭が優先").toBe("elite");
  });

  it("格の表示名（並・猛・精鋭）", () => {
    expect(GRADE_LABEL, "格の表示名").toEqual({ normal: "並", strong: "猛", elite: "精鋭" });
  });
});

describe("役割ごとの精鋭の除外", () => {
  it("全役割に表があり、同じ修飾子を重ねて書いていない", () => {
    for (const role of ENEMY_ROLES) {
      const kinds = ROLE_ELITE_EXCLUDE[role];
      expect(new Set(kinds).size, `${role} の重複`).toBe(kinds.length);
    }
  });

  it("射手は動けなくなる・反射する精鋭を外す", () => {
    expect(ROLE_ELITE_EXCLUDE.shooter, "射手").toEqual(expect.arrayContaining(["reflective", "retaliating", "bulwark", "anchored"]));
  });
});
