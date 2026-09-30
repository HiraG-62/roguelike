import { describe, expect, it } from "vitest";
import { LEGACY_SKILL_MAP, mapSkillKey, migrateSkillKey } from "./legacyKeys";
import { SKILL_KEYS, type SkillKey } from "./types";

const TABLE: Readonly<Record<string, SkillKey | null>> = {
  oldWhirl: "whirl",
  gone: null,
};

describe("旧スキル key の写し表", () => {
  it("表に載せた key は新しい key へ写る", () => {
    expect(mapSkillKey(TABLE, "oldWhirl"), "旧 key が新 key へ写る").toBe("whirl");
  });

  it("null の行は null を返す（石を消す印）", () => {
    expect(mapSkillKey(TABLE, "gone"), "写し先が無い key は null").toBeNull();
  });

  it("載っていない key はそのまま返る", () => {
    expect(mapSkillKey(TABLE, "frag"), "表に無い key は素通し").toBe("frag");
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

  it("今ある key は写し表が触らない（表が空の間は全部素通し）", () => {
    for (const key of SKILL_KEYS) expect(migrateSkillKey(key), `${key} が写った`).toBe(key);
  });
});
