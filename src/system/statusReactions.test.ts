import { describe, expect, it } from "vitest";
import { FIXED_DT } from "../core/loop";
import type { Enemy, GameState } from "../core/state";
import type { StatusApply } from "../core/status";
import { STATUS } from "../data/tuning";
import { damageEnemy } from "./combat";
import { isStaggered } from "./poise";
import {
  type StatusTarget,
  applyBurn,
  applyChill,
  applyStatus,
  findStatus,
  hasStatus,
  statusStacks,
  updateStatusEffects,
} from "./statusEffects";
import { terrainAt } from "./terrain";
import { arena, placeEnemy } from "./testHelpers";

/** 反応と昇華（docs/ideas/status-and-terrain.md 2・5 章） */

const BIG_HP = 100000;
const PLAYER: StatusTarget = { kind: "player" };

function sturdy(state: GameState, key: string, dx = 30, dy = 0): Enemy {
  const e = placeEnemy(state, key, dx, dy);
  e.hp = BIG_HP;
  e.maxHp = BIG_HP;
  return e;
}

function on(e: Enemy): StatusTarget {
  return { kind: "enemy", enemy: e };
}

function apply(kind: StatusApply["kind"], duration: number, stacks = 1, potency = 0): StatusApply {
  return { kind, stacks, duration, potency };
}

describe("反応: 水と火", () => {
  it("蒸気: 濡れていると燃焼は付かず、濡れが 1 減る。プレイヤー由来なら周囲の敵に弱体", () => {
    const state = arena();
    const e = sturdy(state, "golem");
    const near = sturdy(state, "golem", 30, 20);
    applyStatus(state, on(e), apply("wet", 5, 2), "env");
    applyBurn(state, e, 5, 3);
    expect(hasStatus(e.status, "burn")).toBe(false);
    expect(statusStacks(e.status, "wet")).toBe(1);
    expect(hasStatus(near.status, "weaken"), "湯気で周囲が弱体").toBe(true);
  });

  it("浸水中は燃焼が一切付かない（濡れも減らない）", () => {
    const state = arena();
    const e = sturdy(state, "golem");
    applyStatus(state, on(e), apply("wet", 5, 3), "env");
    expect(hasStatus(e.status, "soaked")).toBe(true);
    expect(applyStatus(state, on(e), apply("burn", 3, 1, 5), "player")).toBe(false);
    expect(statusStacks(e.status, "wet")).toBe(3);
  });

  it("燃えている敵が濡れると火が消える", () => {
    const state = arena();
    const e = sturdy(state, "golem");
    applyBurn(state, e, 5, 3);
    applyStatus(state, on(e), apply("wet", 5), "env");
    expect(hasStatus(e.status, "burn")).toBe(false);
  });

  it("急冷: 濡れた敵に冷気 → 濡れを消費して冷気 +2。濡れ 3 なら即凍結", () => {
    const state = arena();
    const a = sturdy(state, "golem");
    const b = sturdy(state, "golem", 30, 50);
    applyStatus(state, on(a), apply("wet", 5, 1), "env");
    applyChill(state, a, 0, 2);
    expect(hasStatus(a.status, "wet")).toBe(false);
    expect(statusStacks(a.status, "chill")).toBe(1 + STATUS.quench.chillBonus);
    applyStatus(state, on(b), apply("wet", 5, 3), "env");
    applyChill(state, b, 0, 2);
    expect(hasStatus(b.status, "freeze"), "濡れ 3 なら凍結").toBe(true);
  });

  it("拡散: 濡れた敵に感電が入ると、広い半径で連鎖雷が飛ぶ（ICD 中は起きない）", () => {
    const state = arena();
    const a = sturdy(state, "golem");
    // 通常の連鎖半径の外、拡散の半径の内
    const far = sturdy(state, "golem", 30 + STATUS.shockRadius * 1.5, 0);
    applyStatus(state, on(a), apply("wet", 5, 2), "env");
    applyStatus(state, on(far), apply("wet", 5, 1), "env");
    applyStatus(state, on(a), apply("shock", 2, 1, 7), "player");
    expect(BIG_HP - far.hp).toBeGreaterThan(0);
    expect(statusStacks(a.status, "wet")).toBe(1);
    const hp = far.hp;
    applyStatus(state, on(a), apply("shock", 2, 1, 7), "player");
    expect(far.hp, "ICD 中は拡散しない").toBe(hp);
  });

  it("感電 + 濡れ: 感電の周期の連鎖半径が広がる", () => {
    const state = arena();
    const a = sturdy(state, "golem");
    const far = sturdy(state, "golem", 30 + STATUS.shock.radius * 1.3, 0);
    applyStatus(state, on(a), apply("shock", 3, 1, 5), "env");
    updateStatusEffects(state, STATUS.shock.interval);
    expect(far.hp, "濡れていなければ届かない").toBe(BIG_HP);
    applyStatus(state, on(a), apply("wet", 5, 1), "env");
    updateStatusEffects(state, STATUS.shock.interval);
    expect(far.hp).toBeLessThan(BIG_HP);
  });

  it("浸水中の感電は即麻痺", () => {
    const state = arena();
    const e = sturdy(state, "golem");
    applyStatus(state, on(e), apply("wet", 5, 3), "env");
    applyStatus(state, on(e), apply("shock", 2, 1, 1), "player");
    expect(hasStatus(e.status, "paralyze")).toBe(true);
  });
});

describe("反応: 油と火", () => {
  it("炎上: 油膜の敵に燃焼 → 油膜が消えて炎上（dps × 2、下限あり）", () => {
    const state = arena();
    const e = sturdy(state, "golem");
    applyStatus(state, on(e), apply("oiled", 6), "env");
    applyBurn(state, e, 3, 3);
    expect(hasStatus(e.status, "oiled")).toBe(false);
    expect(findStatus(e.status, "blaze")?.potency).toBe(Math.max(STATUS.blaze.minDps, 3 * STATUS.blaze.dpsMul));
    expect(hasStatus(e.status, "burn")).toBe(true);
  });

  it("燃えている敵に油膜 → 炎上。炎上は周期ごとに周囲の油膜の敵へ燃え移る（油膜の無い敵には移らない）", () => {
    const state = arena();
    const a = sturdy(state, "golem");
    const oiled = sturdy(state, "golem", 30, 25);
    const dry = sturdy(state, "golem", 30, -25);
    applyBurn(state, a, 3, 5);
    applyStatus(state, on(a), apply("oiled", 6), "env");
    expect(hasStatus(a.status, "blaze")).toBe(true);
    applyStatus(state, on(oiled), apply("oiled", 6), "env");
    updateStatusEffects(state, STATUS.blaze.spreadInterval);
    expect(hasStatus(oiled.status, "blaze"), "油膜の敵は炎上").toBe(true);
    expect(hasStatus(dry.status, "burn")).toBe(false);
  });

  it("引火: 油膜の敵に感電 → 燃焼が入り、そのまま炎上へつながる", () => {
    const state = arena();
    const e = sturdy(state, "golem");
    applyStatus(state, on(e), apply("oiled", 6), "env");
    applyStatus(state, on(e), apply("shock", 2, 1, 1), "player");
    expect(hasStatus(e.status, "blaze")).toBe(true);
  });

  it("プレイヤーは炎上しない（油膜が消えて燃焼だけ）", () => {
    const state = arena();
    applyStatus(state, PLAYER, apply("oiled", 6), "env");
    applyStatus(state, PLAYER, apply("burn", 2, 1, 3), "env");
    expect(hasStatus(state.player.status, "blaze")).toBe(false);
    expect(hasStatus(state.player.status, "oiled")).toBe(false);
    expect(hasStatus(state.player.status, "burn")).toBe(true);
  });
});

describe("反応: 毒・出血・凍結", () => {
  it("毒霧: 毒の敵に燃焼 → 毒が消え、足元に毒沼、周囲の敵に毒 1", () => {
    const state = arena();
    const e = sturdy(state, "golem");
    const near = sturdy(state, "golem", 30, 30);
    applyStatus(state, on(e), apply("poison", 5, 3), "player");
    applyBurn(state, e, 3, 3);
    expect(hasStatus(e.status, "poison")).toBe(false);
    expect(statusStacks(near.status, "poison")).toBe(1);
    expect(terrainAt(state, e.body.pos.x, e.body.pos.y)).toBe("bog");
  });

  it("焼灼: 出血中に燃焼 → 出血が消え、残りを即時ダメージ。プレイヤーは小さく", () => {
    const state = arena();
    const e = sturdy(state, "golem");
    applyStatus(state, on(e), apply("bleed", 2, 2, 1), "player");
    applyBurn(state, e, 3, 3);
    expect(hasStatus(e.status, "bleed")).toBe(false);
    expect(BIG_HP - e.hp).toBe(Math.round(2 * 1 * 2 * STATUS.cauterize.perStackSec));
    const hp = state.player.hp;
    applyStatus(state, PLAYER, apply("bleed", 2, 2, 1), "enemy");
    applyStatus(state, PLAYER, apply("burn", 2, 1, 1), "env");
    expect(hasStatus(state.player.status, "bleed")).toBe(false);
    expect(hp - state.player.hp).toBe(Math.round(2 * 1 * 2 * STATUS.cauterize.perStackSec * STATUS.cauterize.playerMul));
  });

  it("砕血: 出血中の凍結を砕くと出血の残りを即時ダメージ（次のステップ）にし、近くの敵に出血 1", () => {
    const state = arena();
    const e = sturdy(state, "golem");
    const near = sturdy(state, "golem", 30, 40);
    applyStatus(state, on(e), apply("bleed", 2, 2, 1), "player");
    applyStatus(state, on(e), apply("freeze", STATUS.freeze.duration), "player");
    damageEnemy(state, e, 10, { x: 1, y: 0 }, 0, { kind: "melee" });
    expect(hasStatus(e.status, "bleed")).toBe(false);
    const afterShatter = e.hp;
    updateStatusEffects(state, FIXED_DT);
    expect(afterShatter - e.hp).toBe(Math.round(2 * 1 * 2 * STATUS.shatterBleed.perStackSec));
    expect(hasStatus(near.status, "bleed")).toBe(true);
  });

  it("凍毒: 冷気がある間は毒の残り時間が減らない", () => {
    const state = arena();
    const e = sturdy(state, "golem");
    applyStatus(state, on(e), apply("poison", 3), "player");
    applyChill(state, e, 0, 2);
    updateStatusEffects(state, 1);
    expect(findStatus(e.status, "poison")?.time).toBe(3);
  });

  it("恐慌: 恐怖中は出血ダメージ × 2", () => {
    const state = arena();
    const e = sturdy(state, "golem");
    applyStatus(state, on(e), apply("bleed", 4, 1, 1), "player");
    applyStatus(state, on(e), apply("fear", 2), "player");
    e.body.pos.x += 100;
    updateStatusEffects(state, FIXED_DT);
    expect(BIG_HP - e.hp).toBe((100 / STATUS.bleed.distance) * STATUS.panic.bleedMul);
  });
});

describe("反応: 怯み", () => {
  it("崩勢は堅守を食う（付いた瞬間に堅守が外れる）", () => {
    const state = arena();
    const e = sturdy(state, "slime");
    applyStatus(state, on(e), apply("guarded", 2), "env");
    applyStatus(state, on(e), apply("broken", STATUS.broken.duration), "player");
    expect(hasStatus(e.status, "guarded")).toBe(false);
  });

  it("崩落: 崩勢中に怯むと怯みが × 1.5、解けても堅守が付かず崩勢は消える", () => {
    const state = arena();
    const e = sturdy(state, "slime");
    applyStatus(state, on(e), apply("broken", STATUS.broken.duration), "player");
    applyStatus(state, on(e), apply("stagger", 0.6), "player");
    expect(findStatus(e.status, "stagger")?.time).toBeCloseTo(0.6 * STATUS.broken.staggerMul, 5);
    updateStatusEffects(state, 0.6 * STATUS.broken.staggerMul + 0.01);
    expect(isStaggered(e)).toBe(false);
    expect(hasStatus(e.status, "guarded")).toBe(false);
    expect(hasStatus(e.status, "broken")).toBe(false);
  });
});

describe("昇華", () => {
  it("燃焼 5 → 灼熱（燃焼 dps × 2、周期ごとに周囲の敵へ燃焼）", () => {
    const state = arena();
    const e = sturdy(state, "golem");
    const near = sturdy(state, "golem", 30, 30);
    for (let i = 0; i < STATUS.burnMaxStacks; i++) applyBurn(state, e, 4, 5);
    expect(hasStatus(e.status, "scorch")).toBe(true);
    updateStatusEffects(state, STATUS.scorch.spreadInterval);
    expect(BIG_HP - e.hp).toBe(4 * STATUS.scorch.dpsMul * STATUS.scorch.spreadInterval);
    expect(hasStatus(near.status, "burn")).toBe(true);
  });

  it("灼熱は濡れで消えない", () => {
    const state = arena();
    const e = sturdy(state, "golem");
    for (let i = 0; i < STATUS.burnMaxStacks; i++) applyBurn(state, e, 4, 5);
    applyStatus(state, on(e), apply("wet", 5), "env");
    expect(hasStatus(e.status, "burn")).toBe(true);
  });

  it("毒 5 → 猛毒（毒 × 1.5）。猛毒の敵が死ぬと毒沼が残る", () => {
    const state = arena();
    const e = sturdy(state, "golem");
    for (let i = 0; i < STATUS.poison.maxStacks; i++) applyStatus(state, on(e), apply("poison", 5), "player");
    expect(hasStatus(e.status, "venom")).toBe(true);
    updateStatusEffects(state, 1);
    expect(BIG_HP - e.hp).toBe(BIG_HP * STATUS.poison.hpRatioPerSec * STATUS.poison.maxStacks * STATUS.venom.damageMul);
    e.hp = 0;
    updateStatusEffects(state, FIXED_DT);
    expect(terrainAt(state, e.body.pos.x, e.body.pos.y)).toBe("bog");
  });

  it("出血 3 → 大出血（止まっていても毎秒ダメージ）", () => {
    const state = arena();
    const e = sturdy(state, "golem");
    for (let i = 0; i < STATUS.bleed.maxStacks; i++) applyStatus(state, on(e), apply("bleed", 4, 1, 1), "player");
    expect(hasStatus(e.status, "hemorrhage")).toBe(true);
    updateStatusEffects(state, 1);
    expect(BIG_HP - e.hp).toBe(STATUS.bleed.maxStacks * STATUS.hemorrhage.perSec);
  });

  it("脆弱を付いている間に 3 回付け直すと露呈、弱体なら無力", () => {
    const state = arena();
    const e = sturdy(state, "golem");
    for (let i = 0; i <= STATUS.exposed.threshold; i++) {
      applyStatus(state, on(e), apply("vulnerable", 4), "player");
      applyStatus(state, on(e), apply("weaken", 4), "player");
    }
    expect(hasStatus(e.status, "exposed")).toBe(true);
    expect(hasStatus(e.status, "enfeeble")).toBe(true);
  });

  it("露呈した敵は怯みが解けても堅守が付かない", () => {
    const state = arena();
    const e = sturdy(state, "slime");
    applyStatus(state, on(e), apply("exposed", 4), "player");
    applyStatus(state, on(e), apply("stagger", 0.5), "player");
    updateStatusEffects(state, 0.51);
    expect(hasStatus(e.status, "guarded")).toBe(false);
  });

  it("氷棺: 凍結中に冷気が 3 回入ると氷棺（凍結は延びない）。砕くと周囲に破片", () => {
    const state = arena();
    const e = sturdy(state, "golem");
    const near = sturdy(state, "golem", 30, 30);
    applyStatus(state, on(e), apply("freeze", STATUS.freeze.duration), "player");
    for (let i = 0; i < STATUS.encase.threshold; i++) applyChill(state, e, 0, 2);
    expect(hasStatus(e.status, "encase")).toBe(true);
    expect(findStatus(e.status, "freeze")?.time, "凍結は延びない").toBe(STATUS.freeze.duration);
    damageEnemy(state, e, 10, { x: 1, y: 0 }, 0, { kind: "melee" });
    expect(hasStatus(e.status, "encase")).toBe(false);
    expect(BIG_HP - near.hp).toBe(Math.round(Math.min(STATUS.encase.shardMax, BIG_HP * STATUS.encase.shardHpRatio)));
  });

  it("融解: 氷棺に燃焼が入ると凍結が解け、足元に水たまりが残る（破片は出ない）", () => {
    const state = arena();
    const e = sturdy(state, "golem");
    const near = sturdy(state, "golem", 30, 30);
    applyStatus(state, on(e), apply("freeze", STATUS.freeze.duration), "player");
    for (let i = 0; i < STATUS.encase.threshold; i++) applyChill(state, e, 0, 2);
    applyBurn(state, e, 3, 3);
    expect(hasStatus(e.status, "freeze")).toBe(false);
    expect(near.hp).toBe(BIG_HP);
    expect(terrainAt(state, e.body.pos.x, e.body.pos.y)).toBe("water");
  });

  it("ボスは昇華しない", () => {
    const state = arena();
    const boss = sturdy(state, "boneLord", 80);
    for (let i = 0; i < STATUS.burnMaxStacks; i++) applyBurn(state, boss, 4, 5);
    for (let i = 0; i < STATUS.poison.maxStacks; i++) applyStatus(state, on(boss), apply("poison", 5), "player");
    expect(hasStatus(boss.status, "scorch")).toBe(false);
    expect(hasStatus(boss.status, "venom")).toBe(false);
  });

  it("奮起: 加速中のプレイヤーに冷気が入ると、冷気は付かず加速が延びる", () => {
    const state = arena();
    applyStatus(state, PLAYER, apply("haste", 2), "player");
    applyStatus(state, PLAYER, apply("chill", 2), "enemy");
    expect(hasStatus(state.player.status, "chill")).toBe(false);
    expect(findStatus(state.player.status, "haste")?.time).toBe(2 + STATUS.haste.chillExtend);
  });
});

describe("反応の記録", () => {
  it("反応が起きると lastReaction に種類が残る", () => {
    const state = arena();
    const e = sturdy(state, "golem");
    applyStatus(state, on(e), apply("oiled", 6), "env");
    applyBurn(state, e, 3, 3);
    expect(e.status.lastReaction?.key).toBe("ignite");
  });
});
