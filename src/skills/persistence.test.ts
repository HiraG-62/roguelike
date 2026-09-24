import { describe, expect, it } from "vitest";
import { SKILL } from "./data";
import { stoneFromSeed } from "./generator";
import {
  SKILL_PROFILE_KEY,
  addRune,
  attachRuneToStone,
  createDefaultSkillProfile,
  detachRuneFromStone,
  discardRune,
  loadSkillProfile,
  ownedRunes,
  runeAttachBlock,
  salvageStone,
  saveSkillProfile,
} from "./persistence";
import type { ModifierKey, RuneItem, SkillKey, SkillProfile, SkillStone } from "./types";

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

function rune(id: string, modifier: ModifierKey, foundAt = 0): RuneItem {
  return { id, modifier, foundAt };
}

function stone(skillKey: SkillKey, links: number, id: string): SkillStone {
  return { ...stoneFromSeed(7, { foundDepth: 1, now: 0, skillKey }), id, variants: [], links };
}

function profileWith(stones: SkillStone[], runes: RuneItem[]): SkillProfile {
  return { version: 1, loadout: [stones[0]?.id ?? null, null, null, null], stones, runes };
}

describe("所持刻印符の付け外し", () => {
  it("付けると所持品から石へ移り、外すと戻る", () => {
    const s = stone("frag", 2, "s1");
    const profile = profileWith([s], [rune("r1", "echo"), rune("r2", "pierce")]);
    expect(attachRuneToStone(profile, "r1", "s1")).toBe("ok");
    expect(s.runes?.map((r) => r.id), "石に付く").toEqual(["r1"]);
    expect(ownedRunes(profile).map((r) => r.id), "所持品から消える").toEqual(["r2"]);
    expect(detachRuneFromStone(profile, "s1", "r1")).toBe(true);
    expect(s.runes, "付いた符が無ければ runes を持たない").toBeUndefined();
    expect(ownedRunes(profile).map((r) => r.id)).toEqual(["r2", "r1"]);
  });

  it("相性表・リンク数・重複・型替え符 1 枚・排他の制約は activeModifiers と同じ", () => {
    const parry = stone("parry", 3, "p");
    expect(runeAttachBlock(parry, "echo"), "パリィに反響は付かない").toBe("notFit");

    const frag = stone("frag", 1, "f");
    const profile = profileWith([frag], [rune("a", "echo"), rune("b", "comboFuel"), rune("c", "echo")]);
    expect(attachRuneToStone(profile, "a", "f")).toBe("ok");
    expect(attachRuneToStone(profile, "b", "f"), "リンク 1 本は埋まっている").toBe("noLinks");
    frag.links = 3;
    expect(attachRuneToStone(profile, "c", "f"), "同じ符は 2 枚付けない").toBe("duplicate");

    const whirl = stone("whirl", 3, "w");
    whirl.runes = [rune("t1", "toThrown")];
    expect(runeAttachBlock(whirl, "toLobbed"), "型替え符は 1 枚まで").not.toBeNull();
  });

  it("所持品の上限を超えては拾えないが、外す・分解で戻すときは上限を超えても失わない", () => {
    const s = stone("frag", 1, "s1");
    s.runes = [rune("on", "echo")];
    const full = Array.from({ length: SKILL.runeCapacity }, (_, i) => rune(`x${i}`, "pierce"));
    const profile = profileWith([s], full);
    expect(addRune(profile, rune("new", "echo")), "満杯なら入らない").toBe(false);
    expect(salvageStone(profile, "s1")).toBe(true);
    expect(ownedRunes(profile).some((r) => r.id === "on"), "分解した石の符は所持品へ戻る").toBe(true);
    expect(ownedRunes(profile)).toHaveLength(SKILL.runeCapacity + 1);
  });

  it("捨てられるのは所持品の符だけ", () => {
    const s = stone("frag", 1, "s1");
    s.runes = [rune("on", "echo")];
    const profile = profileWith([s], [rune("own", "pierce")]);
    expect(discardRune(profile, "on"), "付いている符は捨てない").toBe(false);
    expect(discardRune(profile, "own")).toBe(true);
    expect(ownedRunes(profile)).toEqual([]);
  });
});

describe("永続化と移行（roguelike.skills.v1）", () => {
  it("所持品と石に付いた符は保存して読み直せる", () => {
    const storage = new MemoryStorage();
    const s = stone("frag", 2, "s1");
    const profile = profileWith([s], [rune("r1", "echo", 5), rune("r2", "comboFuel", 6)]);
    expect(attachRuneToStone(profile, "r2", "s1")).toBe("ok");
    saveSkillProfile(profile, storage);
    expect(loadSkillProfile(storage)).toEqual(profile);
  });

  it("旧セーブ（runes 無し）は空の所持品で読み、石の中身は変えない", () => {
    const storage = new MemoryStorage();
    const s = stone("whirl", 1, "old");
    storage.setItem(SKILL_PROFILE_KEY, JSON.stringify({ version: 1, loadout: ["old"], stones: [s] }));
    const loaded = loadSkillProfile(storage);
    expect(loaded.runes, "所持品は空").toEqual([]);
    expect(loaded.stones, "石はそのまま（runes を足さない）").toEqual([s]);
    expect(createDefaultSkillProfile().runes, "初期プロフィールも空の所持品").toEqual([]);
  });

  it("石に付いた符のうち今の規則で付けられないものは所持品へ移す", () => {
    const storage = new MemoryStorage();
    const s = stone("frag", 1, "s1");
    const raw = { ...s, runes: [rune("keep", "echo"), rune("over", "comboFuel"), rune("bad", "nope" as ModifierKey)] };
    const parry = { ...stone("parry", 3, "p1"), runes: [rune("unfit", "echo")] };
    storage.setItem(SKILL_PROFILE_KEY, JSON.stringify({ version: 1, loadout: ["s1", "p1"], stones: [raw, parry], runes: [rune("own", "delay")] }));
    const loaded = loadSkillProfile(storage);
    const frag = loaded.stones.find((st) => st.id === "s1");
    const pa = loaded.stones.find((st) => st.id === "p1");
    expect(frag?.runes?.map((r) => r.id), "リンクに収まる古い方だけ残る").toEqual(["keep"]);
    expect(pa?.runes, "相性表で付かない符は外れる").toBeUndefined();
    expect(loaded.runes?.map((r) => r.id).sort(), "外れた符は所持品へ。壊れた符は捨てる").toEqual(["over", "own", "unfit"]);
  });

  it("同じ id の符が石と所持品に重複していたら石の方を残す", () => {
    const storage = new MemoryStorage();
    const s = { ...stone("frag", 1, "s1"), runes: [rune("dup", "echo")] };
    storage.setItem(SKILL_PROFILE_KEY, JSON.stringify({ version: 1, loadout: ["s1"], stones: [s], runes: [rune("dup", "echo")] }));
    const loaded = loadSkillProfile(storage);
    expect(loaded.stones[0]?.runes?.map((r) => r.id)).toEqual(["dup"]);
    expect(loaded.runes).toEqual([]);
  });
});

describe("使い込みの互換（SkillStone.wear は省略可）", () => {
  it("使い込みを持つ石は round-trip で同じ内容が戻る", () => {
    const storage = new MemoryStorage();
    const s: SkillStone = { ...stone("whirl", 2, "w1"), wear: { casts: 41, hits: 120, buds: ["power"] } };
    const profile = profileWith([s], []);
    saveSkillProfile(profile, storage);
    expect(loadSkillProfile(storage).stones).toEqual([s]);
  });

  it("旧セーブの石（wear 無し）は wear を足さずにそのまま読む", () => {
    const storage = new MemoryStorage();
    const s = stone("frag", 1, "old");
    storage.setItem(SKILL_PROFILE_KEY, JSON.stringify({ version: 1, loadout: ["old"], stones: [s] }));
    const loaded = loadSkillProfile(storage).stones[0];
    expect(loaded).toEqual(s);
    expect(loaded && "wear" in loaded, "wear を足さない").toBe(false);
  });

  it("壊れた使い込みは直す（負の数は 0、知らない芽は捨て、芽は節目の数まで）", () => {
    const storage = new MemoryStorage();
    const s = { ...stone("frag", 1, "b1"), wear: { casts: -5, hits: "x", buds: ["link", "nope", "power", "power"] } };
    storage.setItem(SKILL_PROFILE_KEY, JSON.stringify({ version: 1, loadout: ["b1"], stones: [s] }));
    const wear = loadSkillProfile(storage).stones[0]?.wear;
    expect(wear?.casts).toBe(0);
    expect(wear?.hits).toBe(0);
    expect(wear?.buds).toEqual(["link", "power"]);
  });

  it("リンクの上限は枠の芽のぶんだけ超えてよい（芽が無ければ基本の上限で切る）", () => {
    const storage = new MemoryStorage();
    const worn = { ...stone("whirl", SKILL.maxLinks + 1, "l1"), wear: { casts: 40, hits: 0, buds: ["link"] } };
    const plain = stone("whirl", SKILL.maxLinks + 1, "l2");
    storage.setItem(SKILL_PROFILE_KEY, JSON.stringify({ version: 1, loadout: ["l1", "l2"], stones: [worn, plain] }));
    const loaded = loadSkillProfile(storage).stones;
    expect(loaded[0]?.links).toBe(SKILL.maxLinks + 1);
    expect(loaded[1]?.links).toBe(SKILL.maxLinks);
  });
});
