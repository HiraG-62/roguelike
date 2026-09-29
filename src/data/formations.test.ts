import { describe, expect, it } from "vitest";
import { ENEMY_ROLES } from "./enemyRoles";
import { FORMATION_DEFS, FORMATION_KEYS, FORMATION_LABEL, FORMATION_LAYOUTS, formationDef, roomFormations } from "./formations";
import { FORMATION } from "./tuning";

/** 陣形の定義（data/formations.ts が JSON の FORMATION を検査して読む） */
describe("陣形の定義", () => {
  it("JSON の陣形はすべて FORMATION_KEYS にあり、1 つずつ定義になる", () => {
    const jsonKeys = Object.keys(FORMATION);
    expect(FORMATION_DEFS.map((d) => d.key)).toEqual(jsonKeys);
    for (const key of jsonKeys) expect(FORMATION_KEYS as readonly string[]).toContain(key);
  });

  it("3a の 4 陣形（魚鱗・鶴翼・雁行・長蛇）がある", () => {
    for (const key of ["fishScale", "craneWing", "geese", "column"] as const) expect(formationDef(key), key).toBeDefined();
  });

  it("3b の 3 陣形（偃月・方円・物見）があり、大将を持つのは偃月だけ", () => {
    for (const key of ["crescent", "circle", "lookout"] as const) expect(formationDef(key), key).toBeDefined();
    expect(formationDef("crescent")?.leader?.role, "偃月の大将は前衛").toBe("vanguard");
    expect(formationDef("crescent")?.leader?.lairChance).toBeGreaterThan(0);
    expect(formationDef("circle")?.leader).toBeUndefined();
    expect(formationDef("lookout")?.leader).toBeUndefined();
  });

  it("方円は支援を 1 人だけ中心に置き、物見は射手 1 人で抽選に出ない", () => {
    const circle = formationDef("circle");
    expect(circle?.layout).toBe("ring");
    expect(circle?.slots[0]).toMatchObject({ role: "support", min: 1, max: 1 });
    const lookout = formationDef("lookout");
    expect(lookout?.weight, "物見は部屋の抽選に出ない").toBe(0);
    expect(lookout?.slots).toHaveLength(1);
    expect(lookout?.slots[0]).toMatchObject({ role: "shooter", min: 1, max: 1 });
  });

  it("偃月・方円は解禁の深度から部屋の抽選に出る（物見は出ない）", () => {
    const keys = (depth: number): string[] => roomFormations(depth).map((d) => d.key);
    expect(keys(1)).not.toContain("crescent");
    expect(keys(formationDef("crescent")?.minDepth ?? 99)).toContain("crescent");
    expect(keys(formationDef("circle")?.minDepth ?? 99)).toContain("circle");
    expect(keys(99)).not.toContain("lookout");
  });

  it("3c の 2 陣形（鋒矢・衡軛）は列の後ろほど遅らせる・列を入れ替える数値を持ち、大将はいない", () => {
    const arrowhead = formationDef("arrowhead");
    expect(arrowhead?.layout).toBe("line");
    expect(arrowhead?.cooldownStagger ?? 0, "鋒矢は攻撃間隔をずらす").toBeGreaterThan(0);
    expect(arrowhead?.rotate).toBeUndefined();
    const yoke = formationDef("yoke");
    expect(yoke?.layout).toBe("twoRows");
    expect(yoke?.rotate?.restMul ?? 0, "衡軛は入れ替わって下がる間を置く").toBeGreaterThan(1);
    expect(yoke?.rotate?.stepInCooldown ?? 0).toBeGreaterThan(0);
    expect(yoke?.cooldownStagger).toBeUndefined();
    expect(yoke?.slots.map((s) => s.role), "前衛の列 + 射手").toEqual(["vanguard", "shooter"]);
    for (const key of ["arrowhead", "yoke"] as const) expect(formationDef(key)?.leader, key).toBeUndefined();
  });

  it("鋒矢・衡軛は解禁の深度から部屋の抽選に出る", () => {
    const keys = (depth: number): string[] => roomFormations(depth).map((d) => d.key);
    for (const key of ["arrowhead", "yoke"] as const) {
      const min = formationDef(key)?.minDepth ?? 99;
      expect(keys(min - 1), key).not.toContain(key);
      expect(keys(min), key).toContain(key);
    }
  });

  it("全陣形に表示名があり、役割・格・並べ方は定義済みの値", () => {
    for (const key of FORMATION_KEYS) expect(FORMATION_LABEL[key].length, key).toBeGreaterThan(0);
    for (const def of FORMATION_DEFS) {
      expect(FORMATION_LAYOUTS, def.key).toContain(def.layout);
      expect(def.spacing, def.key).toBeGreaterThan(0);
      for (const slot of def.slots) {
        expect(ENEMY_ROLES, def.key).toContain(slot.role);
        expect(["normal", "strong", "elite"], def.key).toContain(slot.grade);
        expect(slot.share, def.key).toBeGreaterThan(0);
        expect(slot.min, def.key).toBeGreaterThanOrEqual(0);
        if (slot.max !== undefined) expect(slot.max, def.key).toBeGreaterThanOrEqual(slot.min);
      }
    }
  });

  it("部屋の陣形の候補は重みが正で解禁済みのもの（長蛇は部屋の抽選に出ない）", () => {
    const pool = roomFormations(1);
    expect(pool.length).toBeGreaterThan(0);
    expect(pool.map((d) => d.key)).not.toContain("column");
    for (const d of pool) {
      expect(d.weight).toBeGreaterThan(0);
      expect(d.minDepth).toBeLessThanOrEqual(1);
    }
  });
});
