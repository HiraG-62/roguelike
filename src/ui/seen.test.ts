import { describe, expect, it } from "vitest";
import { createRng } from "../core/rng";
import { generateItem } from "../loot/generator";
import { PROFILE_KEY, addToStash, loadProfile, saveProfile } from "../loot/profile";
import { type Item, createEmptyProfile } from "../loot/types";
import { MemoryStorage } from "../meta/testStorage";
import { isUnseen, markSlotSeen, slotHasUnseen } from "./seen";

function itemAt(seed: number, foundAt: number): Item {
  const item = generateItem(createRng(seed), { itemLevel: 1, foundDepth: 1, now: foundAt });
  return { ...item, slot: "ring", foundAt };
}

describe("新着", () => {
  it("seenAt が無ければすべて新着", () => {
    const profile = createEmptyProfile();
    const item = itemAt(1, 100);
    addToStash(profile, item);
    expect(profile.meta.seenAt, "まだ見ていない").toBeUndefined();
    expect(isUnseen(item, profile.meta), "新着").toBe(true);
    expect(slotHasUnseen(profile, "ring"), "部位に新着").toBe(true);
    expect(slotHasUnseen(profile, "head"), "倉庫に無い部位は新着なし").toBe(false);
  });

  it("候補を見た後の部位は新着でなくなり、後から入った物だけ新着", () => {
    const profile = createEmptyProfile();
    const old = itemAt(1, 100);
    addToStash(profile, old);
    expect(markSlotSeen(profile, "ring"), "見たので変わる").toBe(true);
    expect(markSlotSeen(profile, "ring"), "2 度目は変わらない").toBe(false);
    expect(slotHasUnseen(profile, "ring"), "見た後は新着なし").toBe(false);
    const fresh = itemAt(2, 200);
    addToStash(profile, fresh);
    expect(isUnseen(old, profile.meta), "前からある物").toBe(false);
    expect(isUnseen(fresh, profile.meta), "後から入った物").toBe(true);
    expect(slotHasUnseen(profile, "ring"), "部位にまた新着").toBe(true);
  });

  it("壊れた seenAt は読み捨てる", () => {
    const storage = new MemoryStorage();
    const profile = createEmptyProfile();
    profile.meta.seenAt = { ring: 500 };
    saveProfile(profile, storage);
    expect(loadProfile(storage).meta.seenAt, "正しい値は残る").toEqual({ ring: 500 });

    const raw = JSON.parse(storage.getItem(PROFILE_KEY) ?? "{}") as { meta: Record<string, unknown> };
    raw.meta.seenAt = { ring: -1, head: "x", boots: Number.MAX_VALUE, offHand: 3, nope: 4, amulet: 7 };
    storage.setItem(PROFILE_KEY, JSON.stringify(raw));
    expect(loadProfile(storage).meta.seenAt, "負・文字・装備できない部位・知らない key を捨てる").toEqual({ boots: Number.MAX_VALUE, amulet: 7 });

    raw.meta.seenAt = "壊れた";
    storage.setItem(PROFILE_KEY, JSON.stringify(raw));
    expect(loadProfile(storage).meta.seenAt, "形が違えば無いものとする").toBeUndefined();
  });
});
