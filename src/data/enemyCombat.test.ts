import { describe, expect, it } from "vitest";
import { ELEMENTS } from "../core/element";
import { ENEMIES } from "./enemies";
import { ENEMY_COMBAT, enemyGuard } from "./enemyCombat";
import { ENEMY_DEFENSE, enemyWeaknesses } from "./enemyDefense";
import { ELEMENT, GENRE } from "./tuning";

describe("敵の防御・耐性（docs/COMBAT_DESIGN.md A-8）", () => {
  it("全敵が防御・魔防・耐性・攻撃の素性の表を明示で持つ", () => {
    for (const def of ENEMIES) {
      expect(ENEMY_DEFENSE[def.key], `敵 ${def.key} が enemyDefense.ts に無い`).toBeDefined();
      expect(ENEMY_COMBAT[def.key]?.guard, `敵 ${def.key} の戦闘表に畳み込まれていない`).toBeDefined();
    }
  });

  it("防御・魔防・耐性は範囲に収まる", () => {
    for (const [key, g] of Object.entries(ENEMY_DEFENSE)) {
      for (const v of [g.defense, g.warding]) {
        expect(v, `${key} の防御 / 魔防`).toBeGreaterThanOrEqual(GENRE.enemyDefenseMin);
        expect(v, `${key} の防御 / 魔防`).toBeLessThanOrEqual(GENRE.enemyDefenseMax);
      }
      for (const table of [g.resist, ...(g.stages ?? [])]) {
        for (const e of ELEMENTS) {
          const v = table[e] ?? 0;
          expect(v, `${key} の ${e} 耐性`).toBeGreaterThanOrEqual(ELEMENT.enemyResistMin);
          expect(v, `${key} の ${e} 耐性`).toBeLessThanOrEqual(ELEMENT.enemyResistMax);
        }
      }
    }
  });

  it("全敵が弱点を 1 つ以上持つ（ボスはどの段階でも）", () => {
    for (const def of ENEMIES) {
      const g = enemyGuard(def.key);
      const stages = g.stages ? g.stages.map((_, i) => i + 1) : [0];
      for (const stage of stages) {
        expect(enemyWeaknesses(g, stage).length, `敵 ${def.key} 段階 ${stage}`).toBeGreaterThan(0);
      }
    }
  });

  it("階層ボスは段階ごとに弱点が変わる", () => {
    for (const def of ENEMIES.filter((d) => d.boss === true)) {
      const g = enemyGuard(def.key);
      expect(g.stages?.length ?? 0, `ボス ${def.key}`).toBeGreaterThanOrEqual(2);
      expect(enemyWeaknesses(g, 1), `ボス ${def.key}`).not.toEqual(enemyWeaknesses(g, 2));
    }
  });

  it("表に無い敵は無防備・無属性の物理に落ちる", () => {
    const g = enemyGuard("__unknown__");
    expect(g.defense).toBe(0);
    expect(g.attack.element).toBe("none");
  });
});
