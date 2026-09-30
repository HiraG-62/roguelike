import { describe, expect, it } from "vitest";
import { SKILL, slotLinks } from "./data";
import { stoneFromSeed } from "./generator";
import {
  SKILL_PROFILE_KEY,
  createDefaultSkillProfile,
  loadSkillProfile,
  loadSkillProfileWithNotice,
  salvageStone,
  saveSkillProfile,
} from "./persistence";
import type { SkillKey, SkillProfile, SkillStone } from "./types";

/** テスト用の最小 Storage */
class MemoryStorage implements Storage {
  private readonly data = new Map<string, string>();
  get length(): number {
    return this.data.size;
  }
  clear(): void {
    this.data.clear();
  }
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  key(index: number): string | null {
    return [...this.data.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

function stone(skillKey: SkillKey, id: string): SkillStone {
  return { ...stoneFromSeed(7, { foundDepth: 1, now: 0, skillKey }), id, variants: [] };
}

function profileWith(stones: SkillStone[]): SkillProfile {
  return { version: 1, loadout: [stones[0]?.id ?? null, null, null, null], stones };
}

/** 旧セーブの刻印符 1 枚（RuneItem の形） */
function oldRune(id: string, modifier: string): { id: string; modifier: string; foundAt: number } {
  return { id, modifier, foundAt: 0 };
}

describe("刻印符のラン内化（旧セーブの読み捨て）", () => {
  it("旧セーブの所持品と石に付けた符は読み捨てられ、件数が返る", () => {
    const storage = new MemoryStorage();
    const withRunes = { ...stone("frag", "s1"), links: 2, runes: [oldRune("a", "echo"), oldRune("b", "pierce")] };
    const plain = { ...stone("whirl", "s2"), links: 1 };
    storage.setItem(
      SKILL_PROFILE_KEY,
      JSON.stringify({ version: 1, loadout: ["s1", "s2"], stones: [withRunes, plain], runes: [oldRune("c", "delay"), oldRune("d", "echo"), oldRune("e", "pierce")] }),
    );
    const loaded = loadSkillProfileWithNotice(storage);
    expect(loaded.droppedRunes, "石の 2 枚 + 所持品の 3 枚").toBe(5);
    expect("runes" in loaded.profile, "プロフィールに runes を持たない").toBe(false);
    expect(loaded.profile.stones.some((s) => "runes" in s), "石にも runes を持たない").toBe(false);
    expect(loaded.profile.stones.map((s) => s.id), "石は残る").toEqual(["s1", "s2"]);
    expect(loaded.profile.loadout.slice(0, 2), "装着も残る").toEqual(["s1", "s2"]);
  });

  it("保存し直すと runes が消え、2 回目の読み込みでは件数が 0 になる（お知らせは 1 回だけ）", () => {
    const storage = new MemoryStorage();
    const s = { ...stone("frag", "s1"), runes: [oldRune("a", "echo")] };
    storage.setItem(SKILL_PROFILE_KEY, JSON.stringify({ version: 1, loadout: ["s1"], stones: [s], runes: [oldRune("b", "pierce")] }));
    const first = loadSkillProfileWithNotice(storage);
    expect(first.droppedRunes).toBe(2);
    saveSkillProfile(first.profile, storage);
    expect(storage.getItem(SKILL_PROFILE_KEY), "保存した文字列に runes が残らない").not.toContain("runes");
    expect(loadSkillProfileWithNotice(storage).droppedRunes, "2 回目").toBe(0);
  });

  it("新しいセーブ・初期プロフィール・壊れたセーブは 0 件（お知らせを出さない）", () => {
    const storage = new MemoryStorage();
    expect(loadSkillProfileWithNotice(storage).droppedRunes, "保存が無い").toBe(0);
    saveSkillProfile(createDefaultSkillProfile(), storage);
    expect(loadSkillProfileWithNotice(storage).droppedRunes, "新しいセーブ").toBe(0);
    storage.setItem(SKILL_PROFILE_KEY, "{oops");
    expect(loadSkillProfileWithNotice(storage).droppedRunes, "壊れた JSON").toBe(0);
    // 旧セーブの初期プロフィールは空の runes 配列を持っていた
    storage.setItem(SKILL_PROFILE_KEY, JSON.stringify({ version: 1, loadout: [], stones: [], runes: [] }));
    expect(loadSkillProfileWithNotice(storage).droppedRunes, "空の runes").toBe(0);
  });

  it("runes が配列でない・中身が壊れている場合は数えず、石は読める", () => {
    const storage = new MemoryStorage();
    const s = { ...stone("frag", "s1"), runes: "broken" };
    storage.setItem(SKILL_PROFILE_KEY, JSON.stringify({ version: 1, loadout: ["s1"], stones: [s], runes: [1, null, "x", oldRune("ok", "echo")] }));
    const loaded = loadSkillProfileWithNotice(storage);
    expect(loaded.droppedRunes, "オブジェクトの符だけ数える").toBe(1);
    expect(loaded.profile.stones).toHaveLength(1);
  });

  it("loadSkillProfile は件数を返さずプロフィールだけ返す", () => {
    const storage = new MemoryStorage();
    const profile = profileWith([stone("frag", "s1")]);
    saveSkillProfile(profile, storage);
    expect(loadSkillProfile(storage)).toEqual({ ...profile, stones: [{ ...stone("frag", "s1"), links: 0 }] });
  });

  it("初期プロフィールは刻印符を持たず、分解しても石が減るだけ", () => {
    const profile = createDefaultSkillProfile();
    expect("runes" in profile).toBe(false);
    const id = profile.stones[0]?.id ?? "";
    expect(salvageStone(profile, id)).toBe(true);
    expect(profile.stones.some((s) => s.id === id)).toBe(false);
    expect(profile.loadout.includes(id), "装着も外れる").toBe(false);
  });
});

describe("スロットのリンク固定", () => {
  it("リンクはスロットごとに [4, 3, 2, 2] で固定", () => {
    expect(SKILL.slotLinks).toEqual([4, 3, 2, 2]);
    expect(SKILL.slotLinks, "スロット数と揃う").toHaveLength(SKILL.slots);
    expect([0, 1, 2, 3].map(slotLinks)).toEqual([4, 3, 2, 2]);
    expect(slotLinks(SKILL.slots), "範囲外のスロットは 0").toBe(0);
  });

  it("石の links は読まない（旧セーブの値が何でも 0 で読む）", () => {
    const storage = new MemoryStorage();
    const stones = [{ ...stone("whirl", "l1"), links: 3 }, { ...stone("frag", "l2"), links: 99 }, { ...stone("lunge", "l3"), links: undefined }];
    storage.setItem(SKILL_PROFILE_KEY, JSON.stringify({ version: 1, loadout: ["l1", "l2", "l3"], stones }));
    const loaded = loadSkillProfile(storage).stones;
    expect(loaded.map((s) => s.links)).toEqual([0, 0, 0]);
  });

  it("生成する石の links は 0、初期の石も 0", () => {
    for (let seed = 1; seed <= 30; seed++) {
      expect(stoneFromSeed(seed, { foundDepth: 1, now: 0 }).links, `seed ${seed}`).toBe(0);
    }
    expect(createDefaultSkillProfile().stones.every((s) => s.links === 0)).toBe(true);
  });
});

describe("使い込みの互換（SkillStone.wear は省略可）", () => {
  it("使い込みを持つ石は round-trip で同じ内容が戻る", () => {
    const storage = new MemoryStorage();
    const s: SkillStone = { ...stone("whirl", "w1"), wear: { casts: 41, hits: 120, buds: ["power"] } };
    saveSkillProfile(profileWith([s]), storage);
    expect(loadSkillProfile(storage).stones).toEqual([s]);
  });

  it("旧セーブの石（wear 無し）は wear を足さずにそのまま読む", () => {
    const storage = new MemoryStorage();
    const s = stone("frag", "old");
    storage.setItem(SKILL_PROFILE_KEY, JSON.stringify({ version: 1, loadout: ["old"], stones: [s] }));
    const loaded = loadSkillProfile(storage).stones[0];
    expect(loaded).toEqual(s);
    expect(loaded && "wear" in loaded, "wear を足さない").toBe(false);
  });

  it("壊れた使い込みは直す（負の数は 0、知らない芽は捨て、芽は節目の数まで）", () => {
    const storage = new MemoryStorage();
    const s = { ...stone("frag", "b1"), wear: { casts: -5, hits: "x", buds: ["nope", "power", "power", "power"] } };
    storage.setItem(SKILL_PROFILE_KEY, JSON.stringify({ version: 1, loadout: ["b1"], stones: [s] }));
    const wear = loadSkillProfile(storage).stones[0]?.wear;
    expect(wear?.casts).toBe(0);
    expect(wear?.hits).toBe(0);
    expect(wear?.buds).toEqual(["power", "power"]);
  });

  it("旧セーブの枠の芽（link）は威力の芽へ写る", () => {
    const storage = new MemoryStorage();
    const s = { ...stone("whirl", "l1"), wear: { casts: 160, hits: 10, buds: ["link", "power"] } };
    storage.setItem(SKILL_PROFILE_KEY, JSON.stringify({ version: 1, loadout: ["l1"], stones: [s] }));
    const wear = loadSkillProfile(storage).stones[0]?.wear;
    expect(wear?.buds, "枠も威力の芽として数える").toEqual(["power", "power"]);
    expect(wear?.casts, "発動数はそのまま").toBe(160);
  });
});
