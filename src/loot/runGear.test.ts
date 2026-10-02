import { afterEach, describe, expect, it } from "vitest";
import { createGame } from "../core/game";
import { ReplayRecorder } from "../core/replay";
import { createRng } from "../core/rng";
import type { GameState } from "../core/state";
import { CARRY } from "../data/tuning";
import { withFixedLayout } from "../map/layout/select";
import { MemoryStorage } from "../meta/testStorage";
import { setSaveStorage } from "../save/backend";
import { withBaseAreaMul } from "../system/floor";
import { dropItem, updateDropInteract } from "../system/loot";
import { withInput } from "../system/testHelpers";
import { forgeOpBlock, forgePartners } from "../ui/forge";
import { generateItem } from "./generator";
import { PROFILE_KEY, isRunProfile, loadProfile, saveProfile } from "./profile";
import { recordProvenance } from "./provenance";
import {
  carriedSlots,
  carryBackCandidates,
  carryBackLimit,
  carryMarks,
  makeRunProfile,
  settleRun,
  toggleCarry,
} from "./runGear";
import { type Item, LOOT_SLOTS, type Profile, type Slot, createEmptyProfile } from "./types";

function makeItem(slot: Slot, seed: number): Item {
  return generateItem(createRng(seed), { slot, itemLevel: 1, foundDepth: 1, now: 0 });
}

/** 6 部位すべてを装備した拠点のプロフィール */
function fullHub(): Profile {
  const hub = createEmptyProfile();
  LOOT_SLOTS.forEach((slot, i) => {
    hub.equipment[slot] = makeItem(slot, 100 + i);
  });
  return hub;
}

function startRun(hub: Profile, seed = 5): GameState {
  const run = makeRunProfile(hub, carriedSlots(hub));
  return withFixedLayout("legacy", () => withBaseAreaMul(() => createGame(seed, "carry", run)));
}

/** 足元に遺物を 1 つ落として拾う */
function pickOne(state: GameState): Item {
  const item = dropItem(state, state.player.body.pos);
  const fi = state.floorItems[state.floorItems.length - 1];
  if (fi) fi.pos = { ...state.player.body.pos };
  updateDropInteract(state, withInput({ interactPressed: true, aimScreen: null }));
  return item;
}

/** CARRY の値を一時的に書き換える（テストの後で戻す） */
const carryTable = CARRY as { carrySlots: number; weaponFree: boolean };
const original = { carrySlots: carryTable.carrySlots, weaponFree: carryTable.weaponFree };

afterEach(() => {
  carryTable.carrySlots = original.carrySlots;
  carryTable.weaponFree = original.weaponFree;
  setSaveStorage(null);
});

describe("持ち込み（runGear）", () => {
  it("既定は右手 + 装備している部位の先頭から carrySlots 部位", () => {
    const hub = fullHub();
    const slots = carriedSlots(hub);
    expect(slots[0], "右手は常に").toBe("mainHand");
    expect(slots.length, "右手 + 枠の数").toBe(1 + CARRY.carrySlots);
  });

  it("持ち込み以外の部位は空で始まり、持ち込んだ遺物は拠点と同じ物", () => {
    const hub = fullHub();
    hub.carry = ["ring", "amulet"];
    const state = startRun(hub);
    for (const slot of LOOT_SLOTS) {
      const carried = slot === "mainHand" || slot === "ring" || slot === "amulet";
      if (carried) expect(state.profile.equipment[slot], `${slot} は持ち込み`).toBe(hub.equipment[slot]);
      else expect(state.profile.equipment[slot], `${slot} は空`).toBeNull();
    }
    expect(state.profile.stash, "袋は空").toEqual([]);
    expect(isRunProfile(state.profile), "ラン用のプロフィール").toBe(true);
    expect(state.profile.meta, "meta は共有").toBe(hub.meta);
  });

  it("weaponFree を切ると右手も印で選び、枠に数える", () => {
    const hub = fullHub();
    hub.carry = ["head", "armor"];
    carryTable.weaponFree = false;
    expect(carriedSlots(hub), "右手は印が無ければ持ち込まない").toEqual(["head", "armor"]);
    hub.carry = ["mainHand", "ring"];
    expect(carriedSlots(hub)).toEqual(["mainHand", "ring"]);
    carryTable.weaponFree = true;
    expect(carriedSlots(hub), "右手は印に関わらず").toEqual(["mainHand", "ring"]);
  });

  it("印は枠を超えて付けられず、右手は付け外しできない", () => {
    const hub = fullHub();
    hub.carry = [];
    expect(toggleCarry(hub, "head")).toBe("on");
    expect(toggleCarry(hub, "ring")).toBe("on");
    expect(toggleCarry(hub, "boots"), "枠が満杯").toBe("full");
    expect(carryMarks(hub)).toEqual(["head", "ring"]);
    expect(toggleCarry(hub, "mainHand"), "右手は常に持ち込み").toBe("fixed");
    expect(toggleCarry(hub, "head")).toBe("off");
    expect(carryMarks(hub)).toEqual(["ring"]);
  });

  it("印は保存して読み直しても残り、壊れた値は捨てる", () => {
    const storage = new MemoryStorage();
    const hub = fullHub();
    hub.carry = ["ring", "boots"];
    saveProfile(hub, storage);
    expect(loadProfile(storage).carry).toEqual(["ring", "boots"]);
    const raw = JSON.parse(storage.getItem(PROFILE_KEY) ?? "{}") as Record<string, unknown>;
    storage.setItem(PROFILE_KEY, JSON.stringify({ ...raw, carry: ["ring", "weapon", 3, "ring", "offHand"] }));
    expect(loadProfile(storage).carry, "装備できる部位だけ重ねずに").toEqual(["ring"]);
  });
});

describe("袋と保存", () => {
  it("ラン中に拾った遺物は袋に入り、拠点の倉庫は変わらない", () => {
    const hub = fullHub();
    const state = startRun(hub);
    const item = pickOne(state);
    expect(state.profile.stash.map((it) => it.id), "袋").toContain(item.id);
    expect(hub.stash, "拠点の倉庫").toEqual([]);
  });

  it("ラン中は拾得・芽・ラン記録で保存先へ書かれない（拠点のプロフィールは書ける）", () => {
    const storage = new MemoryStorage();
    setSaveStorage(storage);
    const hub = fullHub();
    const state = startRun(hub);
    pickOne(state);
    saveProfile(state.profile);
    expect(storage.getItem(PROFILE_KEY), "ラン用のプロフィールは保存しない").toBeNull();
    saveProfile(hub);
    expect(storage.getItem(PROFILE_KEY), "拠点のプロフィールは保存する").not.toBeNull();
  });
});

describe("持ち帰り（settleRun）", () => {
  it("選んだ遺物だけ拠点の倉庫へ入り、残りは消える", () => {
    const hub = fullHub();
    const state = startRun(hub);
    const a = pickOne(state);
    const b = pickOne(state);
    const kept = settleRun(hub, state.profile, [b.id]);
    expect(kept.map((it) => it.id)).toEqual([b.id]);
    expect(hub.stash.map((it) => it.id), "倉庫").toEqual([b.id]);
    expect(hub.stash.some((it) => it.id === a.id), "選ばなかった遺物").toBe(false);
    expect(settleRun(hub, state.profile, [b.id]), "2 度畳んでも二重に入らない").toEqual([]);
  });

  it("候補は装備中のラン内の遺物と袋で、持ち込んだ遺物と借り物は並ばない", () => {
    const hub = fullHub();
    hub.carry = ["ring", "amulet"];
    const state = startRun(hub);
    const worn = makeItem("head", 900);
    state.profile.equipment.head = worn;
    const bagged = pickOne(state);
    // 持ち込んだ遺物を外して袋へ入れても候補にしない
    const ring = state.profile.equipment.ring;
    if (ring) state.profile.stash.push(ring);
    state.profile.equipment.ring = null;
    const loaned: Item = { ...makeItem("boots", 901), loaned: true };
    state.profile.stash.push(loaned);
    expect(carryBackCandidates(state.profile).map((it) => it.id)).toEqual([worn.id, bagged.id]);
  });

  it("持ち込んだ遺物の来歴は拠点の側に積もり、作り替えた物は拠点の装備へ戻る", () => {
    const hub = fullHub();
    const state = startRun(hub);
    const weapon = hub.equipment.mainHand;
    expect(weapon).not.toBeNull();
    const before = weapon?.provenance?.roomsCleared ?? 0;
    recordProvenance(state, { kind: "roomClear" });
    expect(hub.equipment.mainHand?.provenance?.roomsCleared ?? 0, "同じ物なので拠点にも積もる").toBeGreaterThan(before);
    // 残響の作り替えは別の物に置き換わる。畳むときに拠点の装備を差し替える
    const remade: Item = { ...(weapon as Item), name: "作り替えた器" };
    state.profile.equipment.mainHand = remade;
    settleRun(hub, state.profile, []);
    expect(hub.equipment.mainHand, "作り替えた物").toBe(remade);
  });

  it("持ち帰れる数は死亡 keepOnDeath・踏破 keepOnClear", () => {
    expect(carryBackLimit("fallen")).toBe(CARRY.keepOnDeath);
    expect(carryBackLimit("cleared")).toBe(CARRY.keepOnClear);
    expect(carryBackLimit("cleared"), "踏破の方が広い").toBeGreaterThan(carryBackLimit("fallen"));
  });
});

describe("鍛冶（ラン中の持ち込んだ遺物）", () => {
  it("袋の遺物は砕けるが、持ち込んだ遺物は袋にあっても砕けず捧げる側にもならない", () => {
    const hub = fullHub();
    const state = startRun(hub);
    const bagged = pickOne(state);
    expect(forgeOpBlock(state.profile, bagged.id, "shatter"), "袋の遺物").toBeNull();
    const ring = state.profile.equipment.ring ?? state.profile.equipment.head;
    expect(ring).not.toBeNull();
    const carried = ring as Item;
    state.profile.equipment[carried.slot] = null;
    state.profile.stash.push(carried);
    expect(forgeOpBlock(state.profile, carried.id, "shatter"), "砕く").not.toBeNull();
    expect(forgeOpBlock(state.profile, carried.id, "pour"), "注ぐ（捧げる側）").not.toBeNull();
    const receiver = makeItem(carried.slot, 950);
    state.profile.equipment[carried.slot] = receiver;
    const partners = forgePartners(state.profile, { subjectId: receiver.id, op: "pour", partnerId: null, pick: null });
    expect(partners.some((it) => it.id === carried.id), "捧げる側の候補").toBe(false);
  });
});

describe("リプレイの開始時の装備", () => {
  it("記録の開始時の装備は持ち込んだ部位だけで、袋の件数は 0", () => {
    const hub = fullHub();
    hub.carry = ["boots"];
    const state = startRun(hub);
    const data = ReplayRecorder.fromStartedGame({ seedText: "carry", startedAt: 0, daily: false }, state).finish({ depth: 1, kills: 0, score: 0 }, 0);
    const worn = LOOT_SLOTS.filter((s) => data.snapshot.equipment[s] !== null);
    expect(worn).toEqual(["mainHand", "boots"]);
    expect(data.snapshot.stashCount).toBe(0);
  });
});
