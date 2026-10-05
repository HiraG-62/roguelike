import { describe, expect, it } from "vitest";
import { FIXED_DT } from "../core/loop";
import type { Enemy, GameState } from "../core/state";
import { damageEnemy } from "../system/combat";
import { noteRiposte } from "../system/moments";
import { updatePlayer } from "../system/player";
import { autoCastSlots, castSlotAt, createSkillRunState, updateSkills } from "../system/skills";
import { arena, placeEnemy, withInput } from "../system/testHelpers";
import { SKILL, canAttach, SKILL_DEFS } from "./data";
import { stoneFromSeed } from "./generator";
import type { ModifierKey, SkillKey, SkillStone } from "./types";

/**
 * 刻印符「終撃連動」「応手連動」（段取り 7c。docs/ideas/skills-7c-plan.md 4 章・8 章の 3）。
 * 終撃の命中・応手の瞬間に予約し、次の updateSkills で手動と同じ経路（castSlotAt）で撃つことを、状態で検証する
 */

const BIG_HP = 1000;
/** 引力球の置き場所の許容（照準は壁の手前で castWallProbe 刻みに止まる） */
const POS_SLACK = 3;

interface Loadout {
  key: SkillKey;
  modifiers?: ModifierKey[];
}

let seed = 1300;

function makeStone(l: Loadout): SkillStone {
  seed += 1;
  return { ...stoneFromSeed(seed, { foundDepth: 1, now: 0, skillKey: l.key }), variants: [], links: 0 };
}

function skillArena(slots: Loadout[], stateSeed = 5): GameState {
  const state = arena(stateSeed);
  const stones = slots.map(makeStone);
  state.skills = createSkillRunState({ version: 1, loadout: stones.map((s) => s.id), stones });
  slots.forEach((l, i) => {
    const slot = state.skills.slots[i];
    if (slot) slot.runModifiers = [...(l.modifiers ?? [])];
  });
  updateSkills(state, withInput({}), 0);
  state.player.mana = state.stats.maxMana;
  return state;
}

function tough(state: GameState, dx: number, dy = 0): Enemy {
  const e = placeEnemy(state, "golem", dx, dy);
  e.hp = BIG_HP;
  e.maxHp = BIG_HP;
  e.phase = "idle";
  return e;
}

/** 武器の終撃が e に当たった（combat.ts の damageEnemy → moments.ts の noteHitMoments → tryAutoCast） */
function finisherHit(state: GameState, e: Enemy): void {
  damageEnemy(state, e, 1, { x: 1, y: 0 }, 0, { kind: "melee", finisher: true });
}

/** 1 ステップ進める（予約した連動はここで撃たれる） */
function step(state: GameState): void {
  updatePlayer(state, withInput({}), FIXED_DT);
}

describe("終撃連動", () => {
  it("終撃の命中で、その符を付けたスロットを照準 = 敵の位置で撃つ", () => {
    const state = skillArena([{ key: "gravityWell", modifiers: ["autoFinisher"] }]);
    const e = tough(state, 30);
    const mana = state.player.mana;
    finisherHit(state, e);
    expect(state.skills.wells, "命中の処理の中では撃たない").toHaveLength(0);
    step(state);
    expect(state.skills.wells).toHaveLength(1);
    const well = state.skills.wells[0];
    expect(Math.abs((well?.pos.x ?? 0) - e.body.pos.x), "敵の位置へ").toBeLessThan(POS_SLACK);
    expect(state.player.mana, "気力は払う").toBeLessThan(mana);
  });

  it("1 回の終撃が何体に当たっても 1 回だけ撃つ", () => {
    const state = skillArena([{ key: "gravityWell", modifiers: ["autoFinisher"] }]);
    const a = tough(state, 40);
    const b = tough(state, 50, 10);
    finisherHit(state, a);
    finisherHit(state, b);
    expect(state.skills.autoCasts, "予約は 1 つ").toHaveLength(1);
    step(state);
    step(state);
    expect(state.skills.wells).toHaveLength(1);
  });

  it("dedupe 秒を過ぎた次の終撃ではもう一度撃つ", () => {
    const state = skillArena([{ key: "gravityWell", modifiers: ["autoFinisher"] }]);
    const e = tough(state, 60);
    finisherHit(state, e);
    step(state);
    const wait = Math.max(SKILL.modifier.autoFinisher.dedupe, SKILL_DEFS.gravityWell.minInterval) + FIXED_DT;
    for (let t = 0; t < wait; t += FIXED_DT) step(state);
    state.player.mana = state.stats.maxMana;
    finisherHit(state, e);
    step(state);
    expect(state.skills.wells.length).toBe(2);
  });

  it("気力が無ければ撃たず、不発の浮き文字も先行入力の破棄も出さない", () => {
    const state = skillArena([{ key: "gravityWell", modifiers: ["autoFinisher"] }]);
    const e = tough(state, 60);
    state.player.mana = 0;
    finisherHit(state, e);
    step(state);
    expect(state.skills.wells).toHaveLength(0);
    expect(state.skills.manaFlash, "気力の点滅なし").toBe(0);
    expect(state.texts.some((t) => t.text === "気力不足"), "浮き文字なし").toBe(false);
    state.skills.pendingSlot = 2;
    expect(castSlotAt(state, 0, e.body.pos), "撃てない").toBe(false);
    expect(state.skills.pendingSlot, "先行入力は残る").toBe(2);
  });

  it("連動が連動を呼ばない（スキルの命中は終撃にならない）", () => {
    const state = skillArena([{ key: "gravityWell", modifiers: ["autoFinisher"] }]);
    const e = tough(state, 60);
    finisherHit(state, e);
    for (let t = 0; t < SKILL.gravityWell.duration + 0.5; t += FIXED_DT) {
      step(state);
      state.player.mana = state.stats.maxMana;
    }
    expect(e.hp, "引力球が当たっている").toBeLessThan(BIG_HP);
    expect(state.skills.autoCasts ?? [], "新しい予約は無い").toHaveLength(0);
    expect(state.skills.wells.length + (state.skills.echoes.length > 0 ? 1 : 0), "撃ったのは 1 回だけ").toBeLessThanOrEqual(1);
  });

  it("振っている最中の近接を取り消さない（手動の発動は取り消す）", () => {
    const state = skillArena([{ key: "gravityWell", modifiers: ["autoFinisher"] }]);
    const e = tough(state, 60);
    state.player.attack.phase = "active";
    expect(castSlotAt(state, 0, e.body.pos)).toBe(true);
    expect(state.player.attack.phase).toBe("active");
  });

  it("連動の符が付いていないスロットは撃たない", () => {
    const state = skillArena([{ key: "gravityWell" }]);
    const e = tough(state, 60);
    finisherHit(state, e);
    step(state);
    expect(state.skills.wells).toHaveLength(0);
    expect(autoCastSlots(state, "finisher")).toEqual([]);
  });
});

describe("応手連動", () => {
  it("応手（剣の型の見切り）で撃つ。終撃では撃たない", () => {
    const state = skillArena([{ key: "gravityWell", modifiers: ["autoRiposte"] }]);
    const e = tough(state, 60);
    finisherHit(state, e);
    step(state);
    expect(state.skills.wells, "終撃では撃たない").toHaveLength(0);
    noteRiposte(state, "justDodge", e);
    step(state);
    expect(state.skills.wells).toHaveLength(1);
  });

  it("変身には付かない（もう一度撃つと解ける変身を勝手に撃たない）", () => {
    expect(canAttach(SKILL_DEFS.pyreForm, "autoRiposte")).toBe(false);
    expect(canAttach(SKILL_DEFS.siegeForm, "autoFinisher")).toBe(false);
  });
});

describe("同じ key の石を 2 スロットに入れる", () => {
  it("連動は符を付けたスロットだけが撃ち、両方に付ければ両方が撃つ", () => {
    const one = skillArena([{ key: "gravityWell", modifiers: ["autoFinisher"] }, { key: "gravityWell" }]);
    const e = tough(one, 60);
    finisherHit(one, e);
    step(one);
    expect(one.skills.wells).toHaveLength(1);
    expect(one.skills.lastCast?.slot, "撃ったのはスロット 1").toBe(0);
    expect(one.skills.slots[1]?.lastCastAt, "スロット 2 は撃っていない").toBeUndefined();

    const both = skillArena([
      { key: "gravityWell", modifiers: ["autoFinisher"] },
      { key: "gravityWell", modifiers: ["autoFinisher"] },
    ]);
    const f = tough(both, 60);
    finisherHit(both, f);
    step(both);
    expect(both.skills.wells).toHaveLength(2);
  });

  it("刻み撃ちの数えはスロットごと（同じ key の別スロットを挟むと途切れる）", () => {
    const state = skillArena([{ key: "mines", modifiers: ["streak"] }, { key: "mines", modifiers: ["streak"] }]);
    const press = (slot: number): void => {
      state.player.mana = state.stats.maxMana;
      updatePlayer(state, withInput({ skill1Pressed: slot === 0, skill2Pressed: slot === 1 }), FIXED_DT);
      for (let t = 0; t < SKILL.mines.minInterval + FIXED_DT; t += FIXED_DT) step(state);
    };
    press(0);
    press(0);
    expect(state.skills.slots[0]?.streak).toBe(2);
    press(1);
    expect(state.skills.slots[1]?.streak, "別スロットは 1 から").toBe(1);
    press(0);
    expect(state.skills.slots[0]?.streak, "間に別スロットを挟むと戻る").toBe(1);
  });
});

describe("決定性", () => {
  it("同じ seed・同じ操作なら同じ結果", () => {
    const play = (): number[] => {
      const state = skillArena([{ key: "gravityWell", modifiers: ["autoFinisher"] }, { key: "mines", modifiers: ["autoRiposte"] }], 11);
      const e = tough(state, 60);
      finisherHit(state, e);
      noteRiposte(state, "justDodge", e);
      for (let t = 0; t < 1.5; t += FIXED_DT) step(state);
      return [e.hp, state.player.mana, state.skills.wells.length, state.skills.mines.length, state.rng.next()];
    };
    expect(play()).toEqual(play());
  });
});
