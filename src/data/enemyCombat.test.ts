import { describe, expect, it } from "vitest";
// system/biomes の循環 import を game 経由の順で解決する（genre.test.ts と同じ）
import "../core/game";
import { type Element, ELEMENTS } from "../core/element";
import type { FloorKind } from "../core/state";
import { BIOMES } from "../system/biomes";
import { ENEMIES } from "./enemies";
import { ENEMY_COMBAT, enemyGuard } from "./enemyCombat";
import { ENEMY_DEFENSE, enemyResistTable, enemyWeaknesses } from "./enemyDefense";
import { ELEMENT, GENRE } from "./tuning";

/** 段階の最大（src/system/boss*.ts の STAGE_*。双子・霜の巨人・蔵書の主などは 3 段階） */
const MAX_BOSS_STAGE = 3;

/** 土地の属性（data/enemyDefense.ts の BIOME_* の強い属性） */
const LAND_ELEMENT: Readonly<Partial<Record<FloorKind, Element>>> = {
  forge: "fire",
  glacier: "ice",
  swamp: "poison",
  ossuary: "dark",
  dark: "dark",
  mine: "lightning",
  meadow: "poison",
};

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

  it("3 段階のボスは段階 3 でも弱点を持ち、表より先の段階は最後の段階の表を使う", () => {
    for (const def of ENEMIES) {
      const g = enemyGuard(def.key);
      const stages = g.stages;
      if (!stages) continue;
      for (let stage = 1; stage <= MAX_BOSS_STAGE; stage++) {
        expect(enemyWeaknesses(g, stage).length, `敵 ${def.key} 段階 ${stage}`).toBeGreaterThan(0);
      }
      expect(enemyResistTable(g, stages.length + 1), `敵 ${def.key}`).toEqual(enemyResistTable(g, stages.length));
    }
  });

  it("バイオームのファミリーの敵は、その土地の属性を弱点にしない", () => {
    for (const [kind, element] of Object.entries(LAND_ELEMENT) as [FloorKind, Element][]) {
      for (const key of BIOMES[kind].family) {
        expect(enemyResistTable(enemyGuard(key))[element], `${kind} の ${key} が ${element} を弱点にしている`).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("表に無い敵は無防備・無属性の物理に落ちる", () => {
    const g = enemyGuard("__unknown__");
    expect(g.defense).toBe(0);
    expect(g.attack.element).toBe("none");
  });
});
