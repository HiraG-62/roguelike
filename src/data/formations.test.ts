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
