import { describe, expect, it } from "vitest";
import type { FrameInput } from "../core/input";
import { FIXED_DT } from "../core/loop";
import type { Enemy, GameState, Projectile } from "../core/state";
import type { StatusKind } from "../core/status";
import { damagePlayer, rollOutgoing } from "../system/combat";
import { ENEMIES } from "../data/enemies";
import { bossTouch } from "../system/bossKit";
import { createEnemy, updateEnemies } from "../system/enemies";
import { currentMeleeStep, isPlayerStaggered, playerMoveset, updatePlayer } from "../system/player";
import { updateProjectiles } from "../system/projectiles";
import { createSkillRunState, resolveSlot, skillMoveMul, slotBodyBlocked, updateSkills } from "../system/skills";
import { applyStatus } from "../system/statusEffects";
import { arena, placeEnemy, withInput } from "../system/testHelpers";
import { FORM_TUNING } from "./tuning2";
import { SKILL, SKILL_DEFS, canAttach } from "./data";
import { inAnyForm, shapeCastBlock } from "./forms";
import { stoneFromSeed } from "./generator";
import { SHAPE_TUNING } from "./tuning3";
import { type ModifierKey, type SkillKey, type SkillStone, type VariantRoll, WAVE3_SKILL_KEYS } from "./types";

/**
 * 変身（docs/ideas/skills-expansion.md 1-H #56〜#60）: 左右クリックの差し替え・排他・解けた後の反動・
 * 霊体化のすり抜け・砲身化の 1 発ごとの気力・業火の化身の気力切れ、と変身 8 種の共有の待ち（稼働率の上限）を
 * 実際の入力（updatePlayer → updateSkills → castSlot）を通して状態・数値で確かめる
 */

const BIG_HP = 1000;
/** 敵が勝手に攻撃してこないようにする */
const NO_ATTACK_COOLDOWN = 99;
/** 稼働率を測る長さ（秒） */
const UPTIME_SECONDS = 180;
/** 稼働率の測り方（フレーム単位）の誤差の許容 */
const UPTIME_SLACK = 0.02;

interface Loadout {
  key: SkillKey;
  links?: number;
  modifiers?: ModifierKey[];
  variants?: VariantRoll[];
}

let seed = 900;

function makeStone(l: Loadout): SkillStone {
  seed += 1;
  return { ...stoneFromSeed(seed, { foundDepth: 1, now: 0, skillKey: l.key }), variants: l.variants ?? [], links: l.links ?? 0 };
}

function skillArena(slots: Loadout[]): GameState {
  const state = arena(5);
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

/** 動かず殴り返さない的 */
function dummy(state: GameState, dx: number, dy = 0, key = "slime"): Enemy {
  const e = placeEnemy(state, key, dx, dy);
  e.hp = BIG_HP;
  e.maxHp = BIG_HP;
  e.phase = "idle";
  e.attackCooldown = NO_ATTACK_COOLDOWN;
  return e;
}

function run(state: GameState, seconds: number, input: FrameInput = withInput({})): void {
  const steps = Math.ceil(seconds / FIXED_DT);
  for (let i = 0; i < steps; i++) updatePlayer(state, input, FIXED_DT);
}

function cast(state: GameState, slot = 0): void {
  const keys = { skill1Pressed: slot === 0, skill2Pressed: slot === 1, skill3Pressed: slot === 2, skill4Pressed: slot === 3 };
  updatePlayer(state, withInput(keys), FIXED_DT);
}

function waitInterval(state: GameState, slot = 0): void {
  run(state, (resolveSlot(state, slot)?.interval ?? 0) + FIXED_DT);
}

/** 左クリックを 1 回押して離す */
function pressLeft(state: GameState): void {
  updatePlayer(state, withInput({ attackPressed: true, attackHeld: true }), FIXED_DT);
  updatePlayer(state, withInput({}), FIXED_DT);
}

/** 右クリックを 1 回押して離す（右は押しっぱなしの差で「押した瞬間」を取る） */
function pressRight(state: GameState): void {
  updatePlayer(state, withInput({ shootHeld: true }), FIXED_DT);
  updatePlayer(state, withInput({}), FIXED_DT);
}

function has(e: Enemy, kind: StatusKind): boolean {
  return e.status.effects.some((s) => s.kind === kind && s.time > 0);
}

function stacks(e: Enemy, kind: StatusKind): number {
  return e.status.effects.find((s) => s.kind === kind && s.time > 0)?.stacks ?? 0;
}

function playerShots(state: GameState): number {
  return state.projectiles.filter((p) => p.owner === "player").length;
}

function enemyBullet(state: GameState, dx: number): Projectile {
  const p = state.player.body.pos;
  const pr: Projectile = {
    id: state.nextId++,
    owner: "enemy",
    pos: { x: p.x + dx, y: p.y },
    vel: { x: -135, y: 0 },
    radius: 3,
    damage: 8,
    life: 3,
    color: "#e070ff",
    kind: "proc",
    hitIds: new Set(),
    pierceLeft: 0,
  };
  state.projectiles.push(pr);
  return pr;
}

describe("変身 第 3 弾: 定義", () => {
  it("5 種とも変身の印（form）を持ち、日本語名とアイコンがある", () => {
    const names = WAVE3_SKILL_KEYS.map((k) => SKILL_DEFS[k].name);
    expect(names).toEqual(["狼化", "霊体化", "砲身化", "鉄塊化", "業火の化身"]);
    for (const key of WAVE3_SKILL_KEYS) expect(SKILL_DEFS[key].tags, key).toContain("form");
  });

  it("深化は時間の変身（狼化・霊体化・鉄塊化）に付き、化身は変身そのものには付かない", () => {
    for (const key of ["wolfForm", "wraithForm", "ironForm"] as const) {
      expect(canAttach(SKILL_DEFS[key], "formLinger"), key).toBe(true);
      expect(canAttach(SKILL_DEFS[key], "sustain"), `${key} に延長`).toBe(true);
    }
    for (const key of WAVE3_SKILL_KEYS) expect(canAttach(SKILL_DEFS[key], "formSurge"), key).toBe(false);
    expect(canAttach(SKILL_DEFS.pyreForm, "deferred"), "業火の化身に後払いは付かない").toBe(false);
    expect(canAttach(SKILL_DEFS.pyreForm, "formLinger"), "業火の化身に深化は付かない").toBe(false);
    expect(canAttach(SKILL_DEFS.siegeForm, "heavy"), "砲身化に重撃").toBe(true);
    expect(canAttach(SKILL_DEFS.siegeForm, "longshot"), "砲身化に遠当て").toBe(true);
  });
});

describe("狼化", () => {
  it("左クリックが噛みつき（1 段・踏み込み・出血）に差し替わる", () => {
    const state = skillArena([{ key: "wolfForm" }]);
    const e = dummy(state, 40);
    cast(state);
    expect(state.skills.shape?.key).toBe("wolfForm");
    expect(playerMoveset(state).steps, "噛みつき 1 段").toHaveLength(1);
    const x = state.player.body.pos.x;
    pressLeft(state);
    run(state, 0.3);
    expect(state.player.body.pos.x - x, "突進で前へ出る").toBeGreaterThan(SKILL.wolfForm.bite.lunge / 2);
    expect(e.hp, "噛みついた").toBeLessThan(BIG_HP);
    expect(has(e, "bleed"), "出血").toBe(true);
  });

  it("右クリックが遠吠え（周りの敵に恐怖）に差し替わり、射撃は出ない", () => {
    const state = skillArena([{ key: "wolfForm" }]);
    const near = dummy(state, 30);
    const far = dummy(state, SKILL.wolfForm.howlRadius * 3);
    cast(state);
    pressRight(state);
    expect(has(near, "fear"), "近くの敵は恐怖").toBe(true);
    expect(has(far, "fear"), "遠くの敵は恐怖しない").toBe(false);
    run(state, 0.5, withInput({ shootHeld: true }));
    expect(playerShots(state), "右の押しっぱなしでも射撃しない").toBe(0);
  });

  it("変身中はほかのスキル石を使えず（何も払わない）、解けると 1 秒遅くなる", () => {
    const state = skillArena([{ key: "wolfForm" }, { key: "frag" }]);
    cast(state);
    const mana = state.player.mana;
    expect(slotBodyBlocked(state, 1), "HUD と bot は撃てないと分かる").toBe(true);
    cast(state, 1);
    expect(state.skills.grenades, "グレネードは出ない").toHaveLength(0);
    expect(state.player.mana, "気力も払わない").toBe(mana);
    run(state, SKILL.wolfForm.duration + FIXED_DT);
    expect(state.skills.shape, "解けた").toBeNull();
    expect(skillMoveMul(state), "反動で移動 −30%").toBeCloseTo(FORM_TUNING.recoverMoveMul);
    run(state, SKILL.wolfForm.recover + FIXED_DT);
    expect(skillMoveMul(state)).toBe(1);
    expect(playerMoveset(state).key, "装備の武器種に戻る").toBe(state.stats.moveset);
  });
});

describe("霊体化", () => {
  it("敵弾がすり抜け（弾は消えない）、生命が減らない", () => {
    const state = skillArena([{ key: "wraithForm" }]);
    cast(state);
    const hp = state.player.hp;
    const pr = enemyBullet(state, 0);
    updateProjectiles(state, FIXED_DT);
    expect(state.player.hp).toBe(hp);
    expect(pr.life, "弾は飛び続ける").toBeGreaterThan(0);
  });

  it("敵の近接（接触）もすり抜ける。変身していなければ当たる", () => {
    const hurt = (wraith: boolean): number => {
      const state = skillArena([{ key: "wraithForm" }]);
      if (wraith) cast(state);
      const e = placeEnemy(state, "slime", 12);
      e.phase = "chase";
      e.attackCooldown = 0;
      const hp = state.player.hp;
      for (let i = 0; i < 180; i++) {
        state.player.invulnTimer = 0;
        updateEnemies(state, FIXED_DT);
      }
      return hp - state.player.hp;
    };
    expect(hurt(false), "変身していなければ当たる").toBeGreaterThan(0);
    expect(hurt(true), "霊体化中は当たらない").toBe(0);
  });

  it("ボスの体当たり（bossTouch）もすり抜ける。変身していなければ当たる", () => {
    const hurt = (wraith: boolean): number => {
      const state = skillArena([{ key: "wraithForm" }]);
      if (wraith) cast(state);
      const boss = ENEMIES.find((d) => d.boss && d.contactDamage > 0);
      if (!boss) throw new Error("体当たりのあるボスが要る");
      const e = createEnemy(state, boss, { ...state.player.body.pos }, 0, false);
      state.enemies.push(e);
      state.player.invulnTimer = 0;
      const hp = state.player.hp;
      bossTouch(state, e, boss);
      return hp - state.player.hp;
    };
    expect(hurt(false), "変身していなければ当たる").toBeGreaterThan(0);
    expect(hurt(true), "霊体化中は当たらない").toBe(0);
  });

  it("与ダメは ×0.3", () => {
    const state = skillArena([{ key: "wraithForm" }]);
    const e = dummy(state, 60);
    const plain = rollOutgoing(state, e, 100, "melee").amount;
    cast(state);
    const ghost = rollOutgoing(state, e, 100, "melee").amount;
    expect(ghost / plain).toBeCloseTo(SKILL.wraithForm.outgoingMul, 1);
  });

  it("解けたとき、すり抜けた敵全員に出血 3（重ならなかった敵には付かない）", () => {
    const state = skillArena([{ key: "wraithForm" }]);
    const a = dummy(state, 0);
    const b = dummy(state, 4, 3);
    const far = dummy(state, 120);
    cast(state);
    run(state, SKILL.wraithForm.duration * 0.5);
    expect(has(a, "bleed"), "解けるまでは付かない").toBe(false);
    run(state, SKILL.wraithForm.duration);
    expect(state.skills.shape).toBeNull();
    expect(stacks(a, "bleed")).toBe(SKILL.wraithForm.bleedStacks);
    expect(stacks(b, "bleed")).toBe(SKILL.wraithForm.bleedStacks);
    expect(has(far, "bleed")).toBe(false);
  });
});

describe("砲身化", () => {
  it("構えた瞬間に 1 発撃ち（気力 8）、構え中は動けない", () => {
    const state = skillArena([{ key: "siegeForm" }]);
    const mana = state.player.mana;
    cast(state);
    expect(state.skills.shape?.key).toBe("siegeForm");
    expect(state.skills.shots, "構えた瞬間の 1 発").toHaveLength(1);
    expect(mana - state.player.mana).toBeCloseTo(SKILL.siegeForm.cost);
    expect(skillMoveMul(state), "動けない").toBe(0);
  });

  it("右クリックの砲撃は 1 発ごとに気力を払い、足りなければ撃てない（何も減らない）", () => {
    const state = skillArena([{ key: "siegeForm" }]);
    cast(state);
    run(state, SKILL.siegeForm.shellInterval + FIXED_DT);
    const mana = state.player.mana;
    const shots = state.skills.shots.length;
    pressRight(state);
    expect(state.skills.shots.length).toBe(shots + 1);
    expect(mana - state.player.mana).toBeCloseTo(SKILL.siegeForm.cost);
    expect(playerShots(state), "通常の射撃は出ない").toBe(0);
    pressRight(state);
    expect(state.skills.shots.length, "砲撃の間隔の中は撃てない").toBe(shots + 1);
    run(state, SKILL.siegeForm.shellInterval + FIXED_DT);
    state.player.mana = SKILL.siegeForm.cost / 2;
    const alive = state.skills.shots.length;
    pressRight(state);
    expect(state.skills.shots.length, "気力不足").toBeLessThanOrEqual(alive);
    expect(state.player.mana).toBeCloseTo(SKILL.siegeForm.cost / 2);
  });

  it("砲撃は重く怯ませる（1 発の怯み値 30）", () => {
    const state = skillArena([{ key: "siegeForm" }]);
    const e = dummy(state, 40, 0, "golem");
    cast(state);
    run(state, 0.3);
    expect(e.hp, "当たった").toBeLessThan(BIG_HP);
    const staggered = has(e, "stagger");
    expect(staggered ? e.poise.max : e.poise.damage, "怯み値が溜まる（溜まりきれば怯む）").toBeGreaterThanOrEqual(SKILL.siegeForm.poise / 2);
  });

  it("ダッシュで構えが解ける", () => {
    const state = skillArena([{ key: "siegeForm" }]);
    cast(state);
    updatePlayer(state, withInput({ dashPressed: true, move: { x: 1, y: 0 } }), FIXED_DT);
    expect(state.skills.shape).toBeNull();
    expect(inAnyForm(state)).toBe(false);
  });

  it("構え中にもう一度撃つと払わずに解ける", () => {
    const state = skillArena([{ key: "siegeForm" }]);
    cast(state);
    waitInterval(state);
    const mana = state.player.mana;
    cast(state);
    expect(state.skills.shape).toBeNull();
    expect(state.player.mana).toBe(mana);
  });
});

describe("鉄塊化", () => {
  it("近接が 1 段の重い振り（怯み値 40）になり、移動 ×0.7", () => {
    const state = skillArena([{ key: "ironForm" }]);
    cast(state);
    expect(skillMoveMul(state)).toBeCloseTo(SKILL.ironForm.moveMul);
    updatePlayer(state, withInput({ attackPressed: true, attackHeld: true }), FIXED_DT);
    const step = currentMeleeStep(state);
    expect(step?.poise).toBeCloseTo(SKILL.ironForm.swing.poise * state.stats.poiseDamageMul);
    expect(step?.heavy).toBe(true);
    expect(playerMoveset(state).steps).toHaveLength(1);
  });

  it("被弾しても怯まず、振りも止まらない", () => {
    const state = skillArena([{ key: "ironForm" }]);
    cast(state);
    updatePlayer(state, withInput({ attackPressed: true, attackHeld: true }), FIXED_DT);
    applyStatus(state, { kind: "player" }, { kind: "stagger", stacks: 1, duration: 1, potency: 0 }, "enemy");
    damagePlayer(state, 5, { x: state.player.body.pos.x + 10, y: state.player.body.pos.y });
    expect(state.player.attack.phase, "振りは止まらない").not.toBe("none");
    updatePlayer(state, withInput({}), FIXED_DT);
    expect(isPlayerStaggered(state.player), "怯みは外れる").toBe(false);
  });

  it("変身していなければ被弾で振りが止まる（比較）", () => {
    const state = skillArena([{ key: "ironForm" }]);
    updatePlayer(state, withInput({ attackPressed: true, attackHeld: true }), FIXED_DT);
    damagePlayer(state, 5, { x: state.player.body.pos.x + 10, y: state.player.body.pos.y });
    expect(state.player.attack.phase).toBe("none");
  });
});

describe("業火の化身", () => {
  it("維持中は近接の命中で燃焼を付け、気力が毎秒減る", () => {
    const state = skillArena([{ key: "pyreForm" }]);
    const e = dummy(state, 18);
    cast(state);
    const mana = state.player.mana;
    run(state, 1);
    expect(mana - state.player.mana).toBeCloseTo(SKILL.pyreForm.drainPerSec, 0);
    pressLeft(state);
    run(state, 0.4);
    expect(e.hp).toBeLessThan(BIG_HP);
    expect(has(e, "burn"), "燃焼").toBe(true);
  });

  it("気力が尽きると自分に燃焼が付いて解け、付与も外れる", () => {
    const state = skillArena([{ key: "pyreForm" }]);
    cast(state);
    expect(state.stats.statusProcs.some((p) => p.kind === "burn")).toBe(true);
    state.player.mana = SKILL.pyreForm.drainPerSec / 2;
    run(state, 1);
    expect(state.skills.shape).toBeNull();
    expect(state.player.status.effects.some((s) => s.kind === "burn" && s.time > 0), "自分が燃える").toBe(true);
    expect(state.stats.statusProcs.some((p) => p.kind === "burn"), "付与は外れる").toBe(false);
  });

  it("もう一度撃つと自分で解ける（自傷なし）", () => {
    const state = skillArena([{ key: "pyreForm" }]);
    cast(state);
    waitInterval(state);
    cast(state);
    expect(state.skills.shape).toBeNull();
    expect(state.player.status.effects.some((s) => s.kind === "burn" && s.time > 0)).toBe(false);
  });

  it("維持中もほかのスキル石は撃てる。化身は第 3 弾の変身中も強い", () => {
    const state = skillArena([{ key: "pyreForm" }, { key: "quake", links: 1, modifiers: ["formSurge"] }]);
    cast(state, 1);
    const before = state.skills.active?.params.damageMul ?? 0;
    run(state, SKILL.quake.windup + SKILL.quake.recover + 0.1);
    state.player.mana = state.stats.maxMana;
    cast(state, 0);
    waitInterval(state, 1);
    cast(state, 1);
    const after = state.skills.active?.params.damageMul ?? 0;
    const m = SKILL.modifier.formSurge;
    expect(after / before).toBeCloseTo(m.formMul / m.otherMul);
  });
});

describe("変身 8 種の排他と共有の待ち", () => {
  it("変身中は別の変身（第 2 弾の型も）を撃てない", () => {
    const state = skillArena([{ key: "titanForm" }, { key: "wolfForm" }]);
    cast(state, 0);
    expect(state.skills.form?.skillKey).toBe("titanForm");
    cast(state, 1);
    expect(state.skills.shape, "狼化にならない").toBeNull();
    expect(state.skills.slots[1]?.chargesLeft, "払っていない").toBe(1);
    expect(shapeCastBlock(state, SKILL_DEFS.swiftForm, 2)).toBe("変身中");
  });

  it("1 つ使うとほかの変身もその再使用時間だけ待つ", () => {
    const state = skillArena([{ key: "wolfForm" }, { key: "ironForm" }]);
    cast(state, 0);
    run(state, SKILL.wolfForm.duration + 0.5);
    expect(state.skills.shape).toBeNull();
    cast(state, 1);
    expect(state.skills.shape, "待ちの中").toBeNull();
    expect(state.skills.formWait).toBeGreaterThan(0);
    run(state, SKILL.wolfForm.cooldown - SKILL.wolfForm.duration);
    cast(state, 1);
    expect(state.skills.shape?.key, "待ちが明けたら撃てる").toBe("ironForm");
  });

  it("第 2 弾の 3 変身を回し続けても稼働率は 60% 以下（深化・持続の変異・得意の武器種を積んでも）", () => {
    const uptime = (loadout: Loadout[], job?: GameState["job"]): number => {
      const state = skillArena(loadout);
      if (job) state.job = job;
      const all = withInput({ skill1Pressed: true, skill2Pressed: true, skill3Pressed: true });
      const steps = Math.ceil(UPTIME_SECONDS / FIXED_DT);
      let inForm = 0;
      for (let i = 0; i < steps; i++) {
        updatePlayer(state, all, FIXED_DT);
        if (inAnyForm(state)) inForm += 1;
      }
      return inForm / steps;
    };
    const plain = uptime([{ key: "titanForm" }, { key: "swiftForm" }, { key: "spiritForm" }]);
    expect(plain, "変身はしている").toBeGreaterThan(0.25);
    expect(plain).toBeLessThanOrEqual(SHAPE_TUNING.uptimeCap + UPTIME_SLACK);
    const stacked: VariantRoll[] = [
      { axis: "durationVsPotency", value: 1 },
      { axis: "cooldownVsDamage", value: 1 },
    ];
    const heavy = uptime(
      (["titanForm", "swiftForm", "spiritForm"] as const).map((key) => ({ key, links: 1, modifiers: ["formLinger"], variants: stacked })),
      "swordsman",
    );
    expect(heavy, "積んでも上限を超えない").toBeLessThanOrEqual(SHAPE_TUNING.uptimeCap + UPTIME_SLACK);
  });
});
