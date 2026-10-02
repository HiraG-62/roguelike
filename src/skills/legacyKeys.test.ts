import { describe, expect, it } from "vitest";
import { LEGACY_SKILL_MAP, mapSkillKey, migrateSkillKey } from "./legacyKeys";
import { SKILL_KEYS, type SkillKey } from "./types";

const TABLE: Readonly<Record<string, SkillKey | null>> = {
  oldWhirl: "commonWhirl",
  gone: null,
};

/** 段取り 7c のレーン G で消した手書きのスキル 31（docs/ideas/skills-7c-plan.md 2-1） */
const REMOVED_HANDWRITTEN = [
  "whirl",
  "lunge",
  "frag",
  "railshot",
  "quake",
  "thunder",
  "spiral",
  "meteorDive",
  "prismShard",
  "fullMoon",
  "dregsBlade",
  "shadowStep",
  "guillotine",
  "ricochet",
  "galeSlash",
  "scatterSigil",
  "stomp",
  "threadReel",
  "swallowFlip",
  "boneRing",
  "scorchLine",
  "iceSlide",
  "bogCall",
  "breakKick",
  "collapseHammer",
  "tideSlash",
  "siphonMark",
  "weaponArt",
  "titanForm",
  "swiftForm",
  "spiritForm",
] as const;

describe("旧スキル key の写し表", () => {
  it("表に載せた key は新しい key へ写る", () => {
    expect(mapSkillKey(TABLE, "oldWhirl"), "旧 key が新 key へ写る").toBe("commonWhirl");
  });

  it("null の行は null を返す（石を消す印）", () => {
    expect(mapSkillKey(TABLE, "gone"), "写し先が無い key は null").toBeNull();
  });

  it("載っていない key はそのまま返る", () => {
    expect(mapSkillKey(TABLE, "parry"), "表に無い key は素通し").toBe("parry");
    expect(mapSkillKey(TABLE, "notASkill"), "知らない key も素通し（有効かは isSkillKey が決める）").toBe("notASkill");
  });

  it("継承されたプロパティ名を旧 key と取り違えない", () => {
    expect(mapSkillKey(TABLE, "toString"), "toString は表の行ではない").toBe("toString");
    expect(mapSkillKey(TABLE, "constructor"), "constructor は表の行ではない").toBe("constructor");
  });

  it("実際の表の写し先はすべて今の SKILL_KEYS にある", () => {
    for (const [from, to] of Object.entries(LEGACY_SKILL_MAP)) {
      if (to === null) continue;
      expect((SKILL_KEYS as readonly string[]).includes(to), `${from} の写し先 ${to} が SKILL_KEYS に無い`).toBe(true);
    }
  });

  it("今ある key は写し表が触らない", () => {
    for (const key of SKILL_KEYS) expect(migrateSkillKey(key), `${key} が写った`).toBe(key);
  });

  it("消した手書き 31 はすべて表にあり、今の SKILL_KEYS にある key へ写る（消える石は 0）", () => {
    expect(REMOVED_HANDWRITTEN.length, "手書きの写しは 31 行").toBe(31);
    for (const key of REMOVED_HANDWRITTEN) {
      expect((SKILL_KEYS as readonly string[]).includes(key), `${key} はもう SKILL_KEYS に無い`).toBe(false);
      const to = migrateSkillKey(key);
      expect(to, `${key} の写し先`).not.toBeNull();
      expect((SKILL_KEYS as readonly string[]).includes(to ?? ""), `${key} → ${to} が SKILL_KEYS にある`).toBe(true);
    }
  });

  it("第 2 弾の変身 3 種は名の近い第 3 弾の変身へ写る", () => {
    expect(migrateSkillKey("titanForm"), "剛の型 → 鉄塊化").toBe("ironForm");
    expect(migrateSkillKey("swiftForm"), "迅の型 → 狼化").toBe("wolfForm");
    expect(migrateSkillKey("spiritForm"), "霊の型 → 霊体化").toBe("wraithForm");
  });
});
