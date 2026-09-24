import { describe, expect, it } from "vitest";
import { hashSeed } from "../../core/rng";
import {
  BASE_MODIFIER_KEYS,
  BASE_SKILL_KEYS,
  EXTRA_MODIFIER_KEYS,
  MODIFIER_KEYS,
  SKILL_KEYS,
  WAVE2_MODIFIER_KEYS,
} from "../../skills/types";
import { ACTION_TEXT } from "../actionText";
import { ENEMIES } from "../enemies";
import { JOB_KEYS } from "../jobs";
import { ACTION, PLAYER } from "../tuning";
import { MOVESET_KEYS } from "../weapons";
import { AFFIXES, CONVERSION_AFFIXES } from "../../loot/affixes";
import { BASES, baseFamily } from "../../loot/bases";
import { BULLET_PROFILE_KEYS } from "../../loot/bullets";
import boonsJson from "./boons.json";
import combatJson from "./combat.json";
import enemiesJson from "./enemies.json";
import feelJson from "./feel.json";
import { BALANCE, BALANCE_HASH } from "./index";
import jobsJson from "./jobs.json";
import lootJson from "./loot.json";
import skillsJson from "./skills.json";
import { diffKeySets, undocumentedLeaves, validateBalanceShape, validateFieldDocs } from "./validate";
import weaponsJson from "./weapons.json";
import worldJson from "./world.json";

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
  ["skills.json", skillsJson],
  ["boons.json", boonsJson],
  ["jobs.json", jobsJson],
  ["weapons.json", weaponsJson],
  ["loot.json", lootJson],
  ["world.json", worldJson],
  ["feel.json", feelJson],
];

/** 表の行の key（_note / _fields は行ではない） */
function rowKeys(table: object): string[] {
  return Object.keys(table).filter((k) => !k.startsWith("_"));
}

describe("各 JSON の形", () => {
  it.each(JSON_FILES)("%s が汎用検査を通る(有限数・null 無し・_note は文字列)", (file, json) => {
    expect(validateBalanceShape(json, file)).toEqual([]);
  });
});

describe("敵のキー集合(段 1)", () => {
  const enemyKeys = ENEMIES.map((e) => e.key);

  it("enemies.json の stats / combat / defense.enemies のキー集合が ENEMIES の key と一致する", () => {
    expect(diffKeySets("enemies.stats", rowKeys(enemiesJson.stats), enemyKeys)).toEqual([]);
    expect(diffKeySets("enemies.combat", rowKeys(enemiesJson.combat), enemyKeys)).toEqual([]);
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

describe("ジョブのキー集合(段 2)", () => {
  const nonNoneKeys = JOB_KEYS.filter((k) => k !== "none");

  it("jobs.json の attributes / weakness のキー集合が「見習い」を除いた JOB_KEYS と一致する", () => {
    expect(diffKeySets("jobs.attributes", rowKeys(jobsJson.attributes), nonNoneKeys)).toEqual([]);
    expect(diffKeySets("jobs.weakness", rowKeys(jobsJson.weakness), nonNoneKeys)).toEqual([]);
  });
});

describe("武器種のキー集合(段 5)", () => {
  it("weapons.json の movesets のキー集合が MOVESET_KEYS と一致する", () => {
    expect(diffKeySets("weapons.movesets", Object.keys(weaponsJson.WEAPON.movesets), MOVESET_KEYS)).toEqual([]);
  });

  it("weapons.json の bullets のキー集合が銃のベース（弾の語と素性の表）と一致する", () => {
    const gunBases = BASES.filter((b) => baseFamily(b) === "gun").map((b) => b.key);
    expect(diffKeySets("weapons.bullets", Object.keys(weaponsJson.WEAPON.bullets), gunBases)).toEqual([]);
    expect(diffKeySets("BULLET_PROFILES", BULLET_PROFILE_KEYS, gunBases)).toEqual([]);
  });

  it("bullets.pistol の radius / spreadDeg は PLAYER.shoot.radius / PLAYER.projectileSpreadDeg と一致する(元は参照だった値)", () => {
    expect(weaponsJson.WEAPON.bullets.pistol.radius).toBe(PLAYER.shoot.radius);
    expect(weaponsJson.WEAPON.bullets.pistol.spreadDeg).toBe(PLAYER.projectileSpreadDeg);
  });
});

describe("PLAYER / ACTION（プレイヤーの移動・ダッシュ・生命・射撃の共通値）", () => {
  it("combat.json の PLAYER が数値をそのまま渡し、melee は weapons.json の PLAYER_MELEE と合流する", () => {
    expect(PLAYER.maxHp).toBe(combatJson.PLAYER.maxHp);
    expect(PLAYER.dash.speed).toBe(combatJson.PLAYER.dash.speed);
    expect(PLAYER.melee).toBe(BALANCE.weapons.PLAYER_MELEE);
  });

  it("ACTION は combat.json の数値と actionText.ts の文言を合流する", () => {
    expect(ACTION.counter.damageMul).toBe(combatJson.ACTION.counter.damageMul);
    expect(ACTION.counter.text).toBe(ACTION_TEXT.counter);
    expect(ACTION.lastKill.text).toBe(ACTION_TEXT.lastKill);
    expect(ACTION.justCounter.text).toBe(ACTION_TEXT.justCounter);
    expect(ACTION.reflect.text).toBe(ACTION_TEXT.reflect);
    expect(ACTION.dashAttack).toBe(BALANCE.weapons.ACTION_DASH_ATTACK);
  });
});

describe("スキル・祝福のキー集合(段 3)", () => {
  // JSON 直読みなので "_note" が混ざる。診断対象のキー集合からは除く
  const withoutNote = (keys: readonly string[]) => keys.filter((k) => k !== "_note");

  it("skills.json のスキルのキー集合が SKILL_KEYS と一致する", () => {
    const baseKeys = withoutNote(Object.keys(skillsJson.SKILL)).filter((k) => (BASE_SKILL_KEYS as readonly string[]).includes(k));
    const extraKeys = withoutNote(Object.keys(skillsJson.EXTRA_SKILL_TUNING));
    const wave2Keys = withoutNote(Object.keys(skillsJson.WAVE2_SKILL_TUNING));
    const wave3Keys = withoutNote(Object.keys(skillsJson.WAVE3_SKILL_TUNING));
    const allKeys = [...baseKeys, ...extraKeys, ...wave2Keys, ...wave3Keys];
    expect(diffKeySets("skills(base+extra+wave2+wave3)", allKeys, SKILL_KEYS)).toEqual([]);
  });

  it("skills.json の modifier のキー集合が MODIFIER_KEYS と一致する", () => {
    const baseKeys = withoutNote(Object.keys(skillsJson.SKILL.modifier)).filter((k) => (BASE_MODIFIER_KEYS as readonly string[]).includes(k));
    const extraKeys = withoutNote(Object.keys(skillsJson.EXTRA_MODIFIER_TUNING)).filter((k) => (EXTRA_MODIFIER_KEYS as readonly string[]).includes(k));
    const wave2Keys = withoutNote(Object.keys(skillsJson.WAVE2_MODIFIER_TUNING)).filter((k) => (WAVE2_MODIFIER_KEYS as readonly string[]).includes(k));
    const allKeys = [...baseKeys, ...extraKeys, ...wave2Keys];
    expect(diffKeySets("skills.modifier(base+extra+wave2)", allKeys, MODIFIER_KEYS)).toEqual([]);
  });

  it("満月の砲のコストと払い戻し基準は MANA.baseMax と一致する(数値をJSONへ展開したぶんの検査)", () => {
    expect(skillsJson.EXTRA_SKILL_TUNING.fullMoon.cost).toBe(BALANCE.combat.MANA.baseMax);
    expect(skillsJson.EXTRA_SKILL_TUNING.fullMoon.refMana).toBe(BALANCE.combat.MANA.baseMax);
  });

  it("狼化の遠吠え・業火の化身の燃焼秒は STATUS の値と一致する(数値をJSONへ展開したぶんの検査)", () => {
    expect(skillsJson.WAVE3_SKILL_TUNING.wolfForm.fearDuration).toBe(BALANCE.combat.STATUS.fear.duration);
    expect(skillsJson.WAVE3_SKILL_TUNING.pyreForm.burnDuration).toBe(BALANCE.combat.STATUS.burnDuration);
    expect(skillsJson.WAVE3_SKILL_TUNING.pyreForm.selfBurnDuration).toBe(BALANCE.combat.STATUS.burnDuration);
  });
});

describe("装備のキー集合(段 4)", () => {
  it("loot.json の affixCurves のキー集合が AFFIXES / CONVERSION_AFFIXES の key と一致する", () => {
    const affixKeys = [...AFFIXES, ...CONVERSION_AFFIXES].map((a) => a.key);
    expect(diffKeySets("loot.affixCurves", Object.keys(lootJson.affixCurves), affixKeys)).toEqual([]);
  });

  it("loot.json の bases のキー集合が BASES の key と一致する", () => {
    const baseKeys = BASES.map((b) => b.key);
    expect(diffKeySets("loot.bases", Object.keys(lootJson.bases), baseKeys)).toEqual([]);
  });
});

/**
 * 説明の無い数値・真偽の葉の数の基準値（docs/ideas/oop-migration.md 3.2）。
 * 書き足したら実測まで下げる。上げてはいけない（新しい項目を足したら _fields にも 1 行書く）
 */
const UNDOCUMENTED_BASELINE: Readonly<Record<string, number>> = {
  "combat.json": 380,
  "enemies.json": 451,
  "skills.json": 1250,
  "boons.json": 382,
  "jobs.json": 0,
  "weapons.json": 2715,
  "loot.json": 3155,
  "world.json": 309,
  "feel.json": 216,
};

describe("項目の説明（_fields）", () => {
  it.each(JSON_FILES)("各 JSON の _fields に stale な項目が無い（%s）", (file, json) => {
    expect(validateFieldDocs(json, file)).toEqual([]);
  });

  it.each(JSON_FILES)("説明の無い数値の葉の数がファイルごとの基準値以下（%s）", (file, json) => {
    const baseline = UNDOCUMENTED_BASELINE[file];
    expect(baseline, `${file} の基準値`).toBeDefined();
    const missing = undocumentedLeaves(json, file);
    expect(missing.length, `${file} の説明の無い葉: ${missing.slice(0, 5).join(", ")} …`).toBeLessThanOrEqual(baseline ?? 0);
  });

  it("enemies.json の stats / combat / defense はすべての項目に説明がある", () => {
    const blocks = ["stats", "combat", "defense"].map((b) => `enemies.json.${b}`);
    const missing = undocumentedLeaves(enemiesJson, "enemies.json").filter((p) => blocks.some((b) => p.startsWith(`${b}.`)));
    expect(missing, "説明の無い項目").toEqual([]);
  });
});
