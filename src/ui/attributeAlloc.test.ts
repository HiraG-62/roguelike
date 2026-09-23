import { describe, expect, it } from "vitest";
import { createGame, step } from "../core/game";
import { EMPTY_INPUT, type FrameInput } from "../core/input";
import { FIXED_DT } from "../core/loop";
import { decodeInputs, encodeInputs } from "../core/replay";
import type { GameState } from "../core/state";
import { ATTR, ATTR_GAIN, BOON } from "../data/tuning";
import { computeStats } from "../loot/stats";
import { createEmptyProfile, uniformAttributes, type AffixRoll, type Item, type Slot } from "../loot/types";
import { grantBoon, offerBoons } from "../system/boons";
import { descend, floorAttributePoints } from "../system/floor";
import { ALLOC_ORDER, allocCardRect, allocPanelVisible, allocateAttribute, updateAttributeAlloc } from "./attributeAlloc";

function withInput(partial: Partial<FrameInput>): FrameInput {
  return { ...EMPTY_INPUT, move: { ...EMPTY_INPUT.move }, ...partial };
}

/** 受付待ち（allocInputDelay）を越えるまで空入力で進める */
const WAIT_FRAMES = Math.ceil(ATTR_GAIN.allocInputDelay / FIXED_DT) + 1;

function waitReady(state: GameState): void {
  for (let i = 0; i < WAIT_FRAMES; i++) step(state, withInput({}), FIXED_DT);
}

/** 階段で降りた直後の状態（祝福の提示は無し）。点が 1 ある */
function arrived(seed = 3): GameState {
  const state = createGame(seed);
  descend(state);
  return state;
}

describe("振り分け点の付与", () => {
  it("階層到達で +1", () => {
    const state = createGame(1);
    descend(state);
    expect(state.runAttributes.unspent).toBe(ATTR_GAIN.perFloor);
    descend(state);
    expect(state.runAttributes.unspent, "未振りの点は持ち越す").toBe(ATTR_GAIN.perFloor * 2);
  });

  it("ボスを倒した階から降りるとさらに +2", () => {
    const state = createGame(1);
    state.boss = { enemyId: 0, name: "test", roomIndex: 0, introTimer: 0, defeated: true };
    expect(floorAttributePoints(state)).toBe(ATTR_GAIN.perFloor + ATTR_GAIN.perBoss);
    descend(state);
    expect(state.runAttributes.unspent).toBe(ATTR_GAIN.perFloor + ATTR_GAIN.perBoss);
    expect(state.boss, "新しい階ではボス状態が消えている").toBeNull();
  });

  it("倒していないボスでは +2 しない", () => {
    const state = createGame(1);
    state.boss = { enemyId: 0, name: "test", roomIndex: 0, introTimer: 0, defeated: false };
    expect(floorAttributePoints(state)).toBe(ATTR_GAIN.perFloor);
  });
});

describe("振り分けパネルの入力", () => {
  it("スキル 1〜4 と攻撃が 5 枠に対応し、stats が変わる", () => {
    const keys = ["skill1Pressed", "skill2Pressed", "skill3Pressed", "skill4Pressed", "attackPressed"] as const;
    keys.forEach((key, i) => {
      const state = arrived();
      waitReady(state);
      step(state, withInput({ [key]: true }), FIXED_DT);
      const attr = ALLOC_ORDER[i];
      if (!attr) throw new Error("枠が足りない");
      expect(state.runAttributes.alloc[attr], `${key} → ${attr}`).toBe(1);
      expect(state.runAttributes.unspent, `${key} で点を使う`).toBe(0);
      expect(state.stats.attributes[attr], `${key} で生値が増える`).toBe(ATTR.base + 1);
    });
  });

  it("振り分けは派生に入る（体力で最大 HP が増える）", () => {
    const state = arrived();
    const before = state.stats.maxHp;
    allocateAttribute(state, "vit");
    expect(state.stats.maxHp).toBe(before + ATTR.vitMaxHp);
    expect(state.player.maxHp, "プレイヤーにも反映").toBe(before + ATTR.vitMaxHp);
  });

  it("選択に使ったキーは消費され、攻撃が出ない", () => {
    const state = arrived();
    waitReady(state);
    step(state, withInput({ attackPressed: true }), FIXED_DT);
    expect(state.runAttributes.alloc.spi).toBe(1);
    expect(state.player.attack.phase, "攻撃キーは振り分けに使われた").toBe("none");
  });

  it("出た直後（受付待ち）は振らず、キーはそのまま行動に渡る", () => {
    const state = arrived();
    step(state, withInput({ attackPressed: true }), FIXED_DT);
    expect(state.runAttributes.unspent).toBe(1);
    expect(state.player.attack.phase, "攻撃が出る").not.toBe("none");
  });

  it("祝福 3 択を選んだ直後も受付待ちからやり直す（選択キーの連打で振らない）", () => {
    const state = arrived();
    waitReady(state);
    offerBoons(state);
    expect(state.boonChoice).not.toBeNull();
    const boonWait = Math.ceil(BOON.inputDelay / FIXED_DT) + 1;
    for (let i = 0; i < boonWait; i++) step(state, withInput({}), FIXED_DT);
    step(state, withInput({ skill1Pressed: true }), FIXED_DT);
    expect(state.boonChoice, "祝福を選んだ").toBeNull();
    step(state, withInput({ skill1Pressed: true }), FIXED_DT);
    expect(state.runAttributes.unspent, "直後の同じキーでは振らない").toBe(1);
    waitReady(state);
    step(state, withInput({ skill1Pressed: true }), FIXED_DT);
    expect(state.runAttributes.unspent, "受付待ちの後は振れる").toBe(0);
  });

  it("パッドの A（攻撃と決定を兼ねる）では振らない", () => {
    const state = arrived();
    waitReady(state);
    step(state, withInput({ attackPressed: true, padConfirmPressed: true }), FIXED_DT);
    expect(state.runAttributes.unspent).toBe(1);
  });

  it("クリックは枠の上だけ。枠の外なら通常の攻撃", () => {
    const state = arrived();
    waitReady(state);
    const r = allocCardRect(2);
    const onCard = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
    step(state, withInput({ aimScreen: { x: 4, y: 4 }, clickPressed: true, attackPressed: true }), FIXED_DT);
    expect(state.runAttributes.unspent, "枠の外は振らない").toBe(1);
    const second = arrived();
    waitReady(second);
    step(second, withInput({ aimScreen: onCard, clickPressed: true, attackPressed: true }), FIXED_DT);
    expect(second.runAttributes.alloc.vit, "3 枠目 = 体力").toBe(1);
  });

  it("封鎖中（戦闘中）はパネルを隠し、キーを奪わない", () => {
    const state = arrived();
    waitReady(state);
    const room = state.rooms[1];
    if (!room) throw new Error("部屋が無い");
    room.locked = true;
    expect(allocPanelVisible(state)).toBe(false);
    const input = withInput({ skill1Pressed: true });
    expect(updateAttributeAlloc(state, input, FIXED_DT), "入力をそのまま返す").toBe(input);
    expect(state.runAttributes.unspent).toBe(1);
  });

  it("未振りの点が残っていてもゲームは進む", () => {
    const state = arrived();
    const tick = state.tick;
    step(state, withInput({ move: { x: 1, y: 0 } }), FIXED_DT);
    expect(state.tick, "step が止まらない").toBe(tick + 1);
  });

  it("点が無ければパネルは出ず、振れない", () => {
    const state = createGame(1);
    expect(allocPanelVisible(state)).toBe(false);
    expect(allocateAttribute(state, "str")).toBe(false);
    expect(state.runAttributes.alloc).toEqual(uniformAttributes(0));
  });
});

describe("振り分けはラン内に限られる", () => {
  it("profile に残らず、次のランは基礎値から始まる", () => {
    const profile = createEmptyProfile();
    const state = createGame(1, "1", profile);
    descend(state);
    allocateAttribute(state, "str");
    expect(state.stats.attributes.str).toBe(ATTR.base + 1);
    const json = JSON.stringify(profile);
    expect(json.includes("alloc"), "profile に振り分けが入っていない").toBe(false);
    const next = createGame(2, "2", profile);
    expect(next.runAttributes.alloc).toEqual(uniformAttributes(0));
    expect(next.runAttributes.unspent).toBe(0);
    expect(next.stats.attributes).toEqual(uniformAttributes(ATTR.base));
  });

  it("祝福を取っても振り分けは消えず、二重にも掛からない", () => {
    const state = arrived();
    allocateAttribute(state, "str");
    const poise = state.stats.poiseDamageMul;
    grantBoon(state, "triggerHappy");
    expect(state.stats.attributes.str).toBe(ATTR.base + 1);
    expect(state.stats.poiseDamageMul).toBeCloseTo(poise, 9);
    expect(state.boonRun.baseStats?.attributes.str, "祝福の基準は振り分け前").toBe(ATTR.base);
  });

  it("開始時も派生を通り、祝福の基準 stats が装備由来になる", () => {
    const state = createGame(1);
    expect(state.boonRun.baseStats, "createGame で applyStats を通る").toEqual(computeStats(state.profile.equipment));
    expect(state.player.mana, "マナは満タン").toBe(state.stats.maxMana);
  });

  it("開始時の装備の共鳴（翠の支配 = 体力 +3）が最大 HP に入る", () => {
    const profile = createEmptyProfile();
    const life: AffixRoll = { key: "maxLife", value: 20, nominal: 20, flux: 0 };
    profile.equipment.armor = testItem("armor", [life, { key: "hpRegen", value: 1, nominal: 1, flux: 0 }]);
    profile.equipment.ring = testItem("ring", [life]);
    const equip = computeStats(profile.equipment);
    expect(equip.resonance.kind, "翠の支配が成立する").toBe("dominant");
    const state = createGame(1, "1", profile);
    const vitDelta = equip.attributes.vit - ATTR.base;
    expect(vitDelta, "体力が上がっている").toBeGreaterThan(0);
    expect(state.stats.maxHp).toBe(equip.maxHp + ATTR.vitMaxHp * vitDelta);
    expect(state.player.hp, "満タンで始まる").toBe(state.stats.maxHp);
  });
});

describe("決定性（振り分け入力を含むリプレイ）", () => {
  /** 振り分けの入力を含む入力列。リプレイの符号化を往復させてから使う */
  function allocInputs(): FrameInput[] {
    const frames: FrameInput[] = [];
    for (let i = 0; i < WAIT_FRAMES; i++) frames.push(withInput({}));
    frames.push(withInput({ skill2Pressed: true }));
    frames.push(withInput({ move: { x: 0, y: 1 } }));
    frames.push(withInput({ attackPressed: true }));
    for (let i = 0; i < 120; i++) frames.push(withInput({ move: { x: -1, y: 0 }, attackPressed: i % 20 === 0 }));
    return decodeInputs(encodeInputs(frames));
  }

  function run(inputs: readonly FrameInput[]): GameState {
    const state = createGame(77, "77", createEmptyProfile());
    descend(state);
    descend(state);
    for (const input of inputs) step(state, input, FIXED_DT);
    return state;
  }

  it("同じ seed と入力列なら同じ振り分け・同じ stats・同じ位置になる", () => {
    const inputs = allocInputs();
    const a = run(inputs);
    const b = run(inputs);
    expect(a.runAttributes.alloc, "2 点とも振れている").toEqual({ ...uniformAttributes(0), dex: 1, spi: 1 });
    expect(b.runAttributes).toEqual(a.runAttributes);
    expect(b.stats).toEqual(a.stats);
    expect(b.player.body.pos).toEqual(a.player.body.pos);
    expect(b.tick).toBe(a.tick);
  });
});

function testItem(slot: Slot, affixes: AffixRoll[]): Item {
  return {
    id: `aa-${slot}`,
    seed: 1,
    baseKey: "test",
    slot,
    rarity: "magic",
    itemLevel: 10,
    name: "test",
    implicit: null,
    affixes,
    foundDepth: 10,
    foundAt: 0,
  };
}
