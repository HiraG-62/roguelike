import { describe, expect, it } from "vitest";
import { hashSeed } from "../../core/rng";
import { ENEMIES } from "../enemies";
import combatJson from "./combat.json";
import enemiesJson from "./enemies.json";
import { BALANCE, BALANCE_HASH } from "./index";
import { diffKeySets, validateBalanceShape } from "./validate";

describe("BALANCE", () => {
  it("_note を剥がして readonly の値を返す", () => {
    expect(BALANCE.combat.MANA.baseMax).toBe(80);
    expect(Object.keys(BALANCE.combat.MANA)).not.toContain("_note");
  });

  it("_ で始まるキーは型からも消える", () => {
    // @ts-expect-error _note は Clean<T> でキーごと消えている
    const note: unknown = BALANCE.combat._note;
    expect(note).toBeUndefined();
  });

  it("BALANCE_HASH は 8 桁 hex で、同じ内容なら同じ値", () => {
    expect(BALANCE_HASH).toMatch(/^[0-9a-f]{8}$/);
    expect(BALANCE_HASH).toBe(hashSeed(JSON.stringify(BALANCE)).toString(16).padStart(8, "0"));
  });
});

const JSON_FILES: readonly [string, unknown][] = [
  ["combat.json", combatJson],
  ["enemies.json", enemiesJson],
];

describe("各 JSON の形", () => {
  it.each(JSON_FILES)("%s が汎用検査を通る(有限数・null 無し・_note は文字列)", (file, json) => {
    expect(validateBalanceShape(json, file)).toEqual([]);
  });
});

describe("敵のキー集合(段 1)", () => {
  const enemyKeys = ENEMIES.map((e) => e.key);

  it("enemies.json の stats / combat / defense.enemies のキー集合が ENEMIES の key と一致する", () => {
    expect(diffKeySets("enemies.stats", Object.keys(enemiesJson.stats), enemyKeys)).toEqual([]);
    expect(diffKeySets("enemies.combat", Object.keys(enemiesJson.combat), enemyKeys)).toEqual([]);
    expect(diffKeySets("enemies.defense.enemies", Object.keys(enemiesJson.defense.enemies), enemyKeys)).toEqual([]);
  });

  it("defense.enemies の body / biome が bodies / biomes に存在する", () => {
    const bodies: Record<string, unknown> = enemiesJson.defense.bodies;
    const biomes: Record<string, unknown> = enemiesJson.defense.biomes;
    // JSON はエントリごとに違う形に推論される(resist の有無などでキー集合が変わる)ので、
    // ここでは body / biome? だけを持つ表として読む
    const entries: Record<string, { body: string; biome?: string }> = enemiesJson.defense.enemies;
    for (const [key, entry] of Object.entries(entries)) {
      expect(bodies[entry.body], `${key} の body`).toBeDefined();
      if (entry.biome) expect(biomes[entry.biome], `${key} の biome`).toBeDefined();
    }
  });
});
