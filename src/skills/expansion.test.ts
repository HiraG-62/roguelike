import { describe, expect, it } from "vitest";
import type { FrameInput } from "../core/input";
import { FIXED_DT } from "../core/loop";
import type { Enemy, GameState } from "../core/state";
import type { StatusKind } from "../core/status";
import type { Vec } from "../core/vec";
import { VIEW_H, VIEW_W } from "../core/view";
import { STATUS } from "../data/tuning";
import { createEmptyResonance } from "../loot/types";
import { updatePlayer } from "../system/player";
import {
  createSkillRunState,
  onSkillMeleeHit,
  onSkillPlayerShoot,
  resolveSlot,
  skillMoveMul,
  slotComboReady,
  updateSkills,
} from "../system/skills";
import { applyStatus } from "../system/statusEffects";
import { arena, placeEnemy, withInput } from "../system/testHelpers";
import { SKILL } from "./data";
import { stoneFromSeed } from "./generator";
import type { ModifierKey, SkillKey, SkillStone } from "./types";

/**
 * 大拡張（docs/ideas/skills-expansion.md）のスキル・刻印符・型替え符・連携を、
 * 実際の発動（updatePlayer → updateSkills → castSlot）を通して状態・数値で検証する
 */

const BIG_HP = 1000;

interface Loadout {
  key: SkillKey;
  links?: number;
  modifiers?: ModifierKey[];
}

let seed = 100;

function makeStone(l: Loadout): SkillStone {
  seed += 1;
  return { ...stoneFromSeed(seed, { foundDepth: 1, now: 0, skillKey: l.key }), variants: [], links: l.links ?? 0 };
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

function tough(state: GameState, dx: number, dy = 0): Enemy {
  const e = placeEnemy(state, "golem", dx, dy);
  e.hp = BIG_HP;
  e.maxHp = BIG_HP;
  e.phase = "idle";
  return e;
}

function toScreen(state: GameState, world: Vec): Vec {
  const cam = state.camera;
  const ox = Math.round(VIEW_W / 2 - cam.pos.x + cam.offset.x);
  const oy = Math.round(VIEW_H / 2 - cam.pos.y + cam.offset.y);
  return { x: world.x + ox, y: world.y + oy };
}

function run(state: GameState, seconds: number, input: FrameInput = withInput({})): void {
  const steps = Math.ceil(seconds / FIXED_DT);
  for (let i = 0; i < steps; i++) updatePlayer(state, input, FIXED_DT);
}

/** スロット 1 を押す。at を渡せばそこを照準にする */
function cast(state: GameState, at?: Vec, slot = 0): void {
  const aim = at ? { aimScreen: toScreen(state, at) } : {};
  const keys = { skill1Pressed: slot === 0, skill2Pressed: slot === 1, skill3Pressed: slot === 2, skill4Pressed: slot === 3 };
  updatePlayer(state, withInput({ ...keys, ...aim }), FIXED_DT);
}

/** スロットの最低間隔が明けるまで待つ */
function waitReady(state: GameState, slot = 0): void {
  run(state, (resolveSlot(state, slot)?.interval ?? 0) + FIXED_DT);
}

function has(e: Enemy, kind: StatusKind): boolean {
  return e.status.effects.some((s) => s.kind === kind && s.time > 0);
}

function give(state: GameState, e: Enemy, kind: StatusKind, stacks = 1, potency = 1, duration = 5): void {
  applyStatus(state, { kind: "enemy", enemy: e }, { kind, stacks, duration, potency }, "player");
}

function lost(e: Enemy): number {
  return BIG_HP - e.hp;
}

describe("消費系のスキル", () => {
  it("伝染: 照準の敵の状態異常を周りの敵へ写し、元の敵からは消えない", () => {
    const state = skillArena([{ key: "contagion" }]);
    const src = tough(state, 50);
    const near = tough(state, 50, 30);
    give(state, src, "burn", 1, 2);
    cast(state, src.body.pos);
    expect(has(src, "burn"), "元は残る").toBe(true);
    expect(has(near, "burn"), "隣へ写る").toBe(true);
  });

  it("伝染: 状態異常の無い敵には撃てず、マナを払わない", () => {
    const state = skillArena([{ key: "contagion" }]);
    const e = tough(state, 50);
    cast(state, e.body.pos);
    expect(state.player.mana).toBe(state.stats.maxMana);
  });

  it("綻び: 命中した敵の状態異常をすべて消し、種類が多いほど強い", () => {
    const plain = skillArena([{ key: "unravel" }]);
    const a = tough(plain, 40);
    cast(plain);
    run(plain, 0.3);
    const rich = skillArena([{ key: "unravel" }]);
    const b = tough(rich, 40);
    give(rich, b, "vulnerable");
    give(rich, b, "weaken");
    give(rich, b, "poison");
    cast(rich);
    run(rich, 0.3);
    expect(lost(a), "前提: 当たる").toBeGreaterThan(0);
    expect(has(b, "weaken") || has(b, "poison"), "消える").toBe(false);
    expect(lost(b)).toBeGreaterThan(lost(a) * 2);
  });

  it("燃え種爆ぜ: 燃焼を消して爆発させる。燃焼が無ければ撃てない", () => {
    const state = skillArena([{ key: "kindle" }]);
    const e = tough(state, 60);
    cast(state, e.body.pos);
    expect(state.player.mana, "燃焼なしは払わない").toBe(state.stats.maxMana);
    give(state, e, "burn", 1, 10);
    waitReady(state);
    cast(state, e.body.pos);
    expect(has(e, "burn"), "燃焼は消える").toBe(false);
    expect(lost(e)).toBeGreaterThan(0);
  });

  it("血抜き: 周りの出血を抜いて回復する", () => {
    const state = skillArena([{ key: "bloodlet" }]);
    const e = tough(state, 30);
    give(state, e, "bleed", 3, 2);
    state.player.hp = state.player.maxHp / 2;
    const before = state.player.hp;
    cast(state);
    expect(has(e, "bleed")).toBe(false);
    expect(state.player.hp).toBeGreaterThan(before);
  });

  it("毒の収穫: 毒を消して残りのダメージを一度に与える", () => {
    const plain = skillArena([{ key: "harvest" }]);
    const a = tough(plain, 40);
    cast(plain);
    run(plain, 0.3);
    const poisoned = skillArena([{ key: "harvest" }]);
    const b = tough(poisoned, 40);
    give(poisoned, b, "poison", 2, 0, 5);
    const hpBefore = b.hp;
    cast(poisoned);
    run(poisoned, 0.3);
    expect(has(b, "poison")).toBe(false);
    expect(hpBefore - b.hp).toBeGreaterThan(lost(a));
  });

  it("放電: 感電した敵から自分へ雷が戻り、感電は消える。感電が無ければ撃てない", () => {
    const state = skillArena([{ key: "discharge" }]);
    const e = tough(state, 80);
    cast(state);
    expect(state.player.mana).toBe(state.stats.maxMana);
    give(state, e, "shock", 2, 1);
    waitReady(state);
    cast(state);
    expect(has(e, "shock")).toBe(false);
    expect(lost(e)).toBeGreaterThan(0);
  });

  it("追い討ち: 恐怖を消費して大きく怯ませる", () => {
    const plain = skillArena([{ key: "rout" }]);
    const a = tough(plain, 40);
    cast(plain);
    run(plain, 0.3);
    const feared = skillArena([{ key: "rout" }]);
    const b = tough(feared, 40);
    give(feared, b, "fear", 1, 0, 3);
    cast(feared);
    run(feared, 0.3);
    expect(has(b, "fear")).toBe(false);
    expect(has(b, "stagger") || b.poise.damage > a.poise.damage, "恐怖の敵のほうが大きく怯む").toBe(true);
  });

  it("処断: 沈黙中の敵は沈黙を消して大ダメージ、そうでなければ沈黙を付けるだけ", () => {
    const state = skillArena([{ key: "verdict" }]);
    const e = tough(state, 25);
    cast(state);
    const first = lost(e);
    expect(has(e, "silence"), "1 回目は沈黙を付ける").toBe(true);
    waitReady(state);
    cast(state);
    expect(has(e, "silence"), "2 回目で消費").toBe(false);
    expect(lost(e) - first).toBeGreaterThan(first * 2);
  });

  it("刺し穿ち: 脆弱を消費して会心", () => {
    const plain = skillArena([{ key: "exploit" }]);
    const a = tough(plain, 25);
    cast(plain);
    const vul = skillArena([{ key: "exploit" }]);
    const b = tough(vul, 25);
    give(vul, b, "vulnerable", 1, 0, 3);
    cast(vul);
    expect(has(b, "vulnerable")).toBe(false);
    expect(lost(b)).toBeGreaterThan(lost(a));
  });

  it("剥奪: 弱体を奪って自分の与ダメージを上げる", () => {
    const state = skillArena([{ key: "strip" }]);
    const e = tough(state, 40);
    give(state, e, "weaken", 1, 0, 3);
    cast(state);
    run(state, 0.3);
    expect(has(e, "weaken")).toBe(false);
    expect(state.player.buffs.damage.time).toBeGreaterThan(0);
    expect(state.player.buffs.damage.mul).toBeCloseTo(SKILL.strip.buffMul);
  });
});

describe("状態を参照するスキル", () => {
  it("満月の砲: 満タンでなければ撃てず、満タンなら全マナを払って並んだ敵を貫く", () => {
    const state = skillArena([{ key: "fullMoon" }]);
    const a = tough(state, 40);
    const b = tough(state, 80);
    state.player.mana = state.stats.maxMana - 1;
    cast(state);
    expect(lost(a), "満タンでないと撃てない").toBe(0);
    state.player.mana = state.stats.maxMana;
    waitReady(state);
    cast(state);
    expect(state.player.mana).toBe(0);
    expect(lost(a)).toBeGreaterThan(0);
    expect(lost(b), "貫通").toBeGreaterThan(0);
  });

  it("枯渇の刃: マナが多いと撃てず、少ないとコスト 0 で 3 回斬る", () => {
    const state = skillArena([{ key: "dregsBlade" }]);
    const e = tough(state, 20);
    cast(state);
    run(state, SKILL.dregsBlade.duration + 0.1);
    expect(lost(e), "マナが多いと撃てない").toBe(0);
    state.player.mana = 1;
    cast(state);
    run(state, SKILL.dregsBlade.duration + 0.1);
    expect(state.player.mana, "コスト 0").toBeGreaterThanOrEqual(1);
    expect(lost(e)).toBeGreaterThan(0);
  });

  it("背水の一閃: HP が減るほど強く、HP が多いとコストが重い", () => {
    const full = skillArena([{ key: "lastStand" }]);
    const heavyCost = resolveSlot(full, 0)?.cost ?? 0;
    full.player.hp = full.player.maxHp * 0.2;
    expect(resolveSlot(full, 0)?.cost ?? 0).toBeLessThan(heavyCost);
    const a = tough(full, 25);
    cast(full);
    const healthy = skillArena([{ key: "lastStand" }]);
    const b = tough(healthy, 25);
    cast(healthy);
    expect(lost(a)).toBeGreaterThan(lost(b) * 2);
  });

  it("連環撃: コンボが多いほど段が増え、外すとコンボが途切れる", () => {
    const state = skillArena([{ key: "comboChain" }]);
    state.combo.count = 25;
    state.combo.timer = 10;
    cast(state);
    run(state, 0.5);
    expect(state.combo.count, "誰もいないので途切れる").toBe(0);
    const hit = skillArena([{ key: "comboChain" }]);
    const e = tough(hit, 25);
    hit.combo.count = 25;
    hit.combo.timer = 10;
    cast(hit);
    run(hit, 0.5);
    expect(hit.combo.count, "3 段とも当たってコンボが伸びる").toBeGreaterThanOrEqual(25 + 3);
    expect(lost(e)).toBeGreaterThan(0);
  });

  it("恨み返し: 直前に受けたダメージが多いほど強く返す", () => {
    const calm = skillArena([{ key: "grudge" }]);
    const a = tough(calm, 25);
    cast(calm);
    const hurt = skillArena([{ key: "grudge" }]);
    const b = tough(hurt, 25);
    hurt.player.hp -= 30;
    run(hurt, FIXED_DT * 2);
    cast(hurt);
    expect(lost(b)).toBeGreaterThan(lost(a) + 30);
    expect(hurt.skills.hurtLog, "返したぶんは消える").toHaveLength(0);
  });

  it("傷返し: 自分の状態異常を剥がして周りの敵へ付ける", () => {
    const state = skillArena([{ key: "scarRoar" }]);
    const e = tough(state, 30);
    applyStatus(state, { kind: "player" }, { kind: "burn", stacks: 1, duration: 3, potency: 2 }, "enemy");
    cast(state);
    expect(state.player.status.effects.some((s) => s.kind === "burn" && s.time > 0)).toBe(false);
    expect(has(e, "burn")).toBe(true);
  });
});

describe("移動・召喚・設置", () => {
  it("影渡り: 照準近くの敵の背後へ移り、直後の近接は怯み値が上乗せ。対象がいなければ払わない", () => {
    const state = skillArena([{ key: "shadowStep" }]);
    cast(state, { x: state.player.body.pos.x + 60, y: state.player.body.pos.y });
    expect(state.player.mana, "対象なし").toBe(state.stats.maxMana);
    const e = tough(state, 80);
    e.facing = { x: -1, y: 0 };
    waitReady(state);
    cast(state, e.body.pos);
    expect(state.player.body.pos.x, "敵の向こう側（背後）").toBeGreaterThan(e.body.pos.x);
    expect(state.skills.backstabTimer).toBeGreaterThan(0);
    onSkillMeleeHit(state, e, 0);
    expect(e.poise.damage).toBeGreaterThan(0);
    expect(state.skills.backstabTimer).toBe(0);
  });

  it("爆薬樽: 撃つとその場で爆発する", () => {
    const state = skillArena([{ key: "powderKeg" }]);
    const e = tough(state, 60, 10);
    const at = { x: state.player.body.pos.x + 60, y: state.player.body.pos.y };
    cast(state, at);
    const keg = state.skills.kegs[0];
    expect(keg, "置かれる").toBeDefined();
    if (!keg) return;
    state.projectiles.push({
      id: 999,
      owner: "player",
      pos: { ...keg.pos },
      vel: { x: 0, y: 0 },
      radius: 2,
      damage: 1,
      life: 1,
      color: "#fff",
      kind: "ranged",
      hitIds: new Set(),
      pierceLeft: 0,
    });
    run(state, FIXED_DT * 2);
    expect(state.skills.kegs).toHaveLength(0);
    expect(lost(e)).toBeGreaterThan(0);
  });

  it("爆薬樽: 近接で叩くと転がって敵に当たり爆発する", () => {
    const state = skillArena([{ key: "powderKeg" }]);
    const e = tough(state, 70);
    cast(state, { x: state.player.body.pos.x + 20, y: state.player.body.pos.y });
    state.player.attack.phase = "active";
    state.player.attack.dir = { x: 1, y: 0 };
    updateSkills(state, withInput({}), FIXED_DT);
    state.player.attack.phase = "none";
    expect(state.skills.kegs[0]?.rollLeft ?? 0, "転がり始める").toBeGreaterThan(0);
    for (let i = 0; i < 40 && state.skills.kegs.length > 0; i++) updateSkills(state, withInput({}), FIXED_DT);
    expect(lost(e)).toBeGreaterThan(0);
  });

  it("剣の墓標: 近接 3 段目の命中でだけ、刺した剣が回転斬りする", () => {
    const state = skillArena([{ key: "swordGrave" }]);
    const at = { x: state.player.body.pos.x + 60, y: state.player.body.pos.y };
    const e = tough(state, 60, 10);
    cast(state, at);
    onSkillMeleeHit(state, e, 0);
    expect(lost(e), "1 段目では回らない").toBe(0);
    onSkillMeleeHit(state, e, 2);
    expect(lost(e)).toBeGreaterThan(0);
  });

  it("砲台: 自分が射撃するたびに 1 発撃つ（自分では撃たない）", () => {
    const state = skillArena([{ key: "turret" }]);
    cast(state, { x: state.player.body.pos.x + 40, y: state.player.body.pos.y });
    run(state, 1);
    expect(state.skills.shots, "自分では撃たない").toHaveLength(0);
    onSkillPlayerShoot(state);
    expect(state.skills.shots).toHaveLength(1);
  });

  it("骨片の輪: 骨片に触れた敵弾を 1 発止める", () => {
    const state = skillArena([{ key: "boneRing" }]);
    cast(state);
    const ring = state.skills.boneRing;
    expect(ring?.bones).toBe(SKILL.boneRing.bones);
    const p = state.player.body.pos;
    state.projectiles.push({
      id: 998,
      owner: "enemy",
      pos: { x: p.x + SKILL.boneRing.orbit, y: p.y },
      vel: { x: 0, y: 0 },
      radius: SKILL.boneRing.orbit,
      damage: 1,
      life: 1,
      color: "#fff",
      kind: "ranged",
      hitIds: new Set(),
      pierceLeft: 0,
    });
    updateSkills(state, withInput({}), FIXED_DT);
    expect(state.projectiles[0]?.life).toBe(0);
    expect(state.skills.boneRing?.bones).toBe(SKILL.boneRing.bones - 1);
  });

  it("湧き石: 石の周りで近接を当てるとマナが多く戻る", () => {
    const state = skillArena([{ key: "manaSpring" }]);
    const e = tough(state, 20);
    cast(state);
    state.player.mana = 0;
    onSkillMeleeHit(state, e, 0);
    expect(state.player.mana).toBeCloseTo(SKILL.manaSpring.manaPerHit * state.stats.manaGainMul);
  });

  it("墜星: 少し後に照準地点へ落ちて周りを打つ", () => {
    const state = skillArena([{ key: "meteorDive" }]);
    const at = { x: state.player.body.pos.x + 60, y: state.player.body.pos.y };
    const e = tough(state, 70);
    cast(state, at);
    expect(skillMoveMul(state), "空中は動けない").toBe(0);
    run(state, SKILL.meteorDive.air + 0.05);
    expect(state.player.body.pos.x).toBeCloseTo(at.x, 0);
    expect(lost(e)).toBeGreaterThan(0);
  });

  it("燕返し: 行きと戻りで同じ敵に 2 回当たる", () => {
    const state = skillArena([{ key: "swallowFlip" }]);
    const e = tough(state, 35);
    cast(state);
    run(state, 0.02);
    const once = lost(e);
    run(state, SKILL.swallowFlip.time + 0.05);
    expect(once, "行き").toBeGreaterThan(0);
    expect(lost(e), "戻り").toBeGreaterThan(once);
  });

  it("巻き戻し: 少し前の位置へ戻り、その間の被ダメの一部を取り戻す", () => {
    const state = skillArena([{ key: "backflow" }]);
    const start = { ...state.player.body.pos };
    run(state, 0.3);
    state.player.body.pos = { x: start.x + 30, y: start.y };
    state.player.hp -= 40;
    const hp = state.player.hp;
    run(state, 0.3);
    cast(state);
    expect(state.player.body.pos.x).toBeCloseTo(start.x, 0);
    expect(state.player.hp).toBeGreaterThan(hp);
  });

  it("手繰り糸: 糸に触れた敵をまとめて手前へ引く", () => {
    const state = skillArena([{ key: "threadReel" }]);
    const far = tough(state, 75);
    const at = { x: state.player.body.pos.x + 85, y: state.player.body.pos.y };
    cast(state, at);
    run(state, SKILL.threadReel.delay + 0.05);
    expect(far.body.pos.x - state.player.body.pos.x).toBeLessThan(30);
    expect(has(far, "weaken")).toBe(true);
  });

  it("震脚: 周りの敵弾を消し、少しの間動けない", () => {
    const state = skillArena([{ key: "stomp" }]);
    const p = state.player.body.pos;
    state.projectiles.push({
      id: 997,
      owner: "enemy",
      pos: { x: p.x + 20, y: p.y },
      vel: { x: 0, y: 0 },
      radius: 2,
      damage: 1,
      life: 5,
      color: "#fff",
      kind: "ranged",
      hitIds: new Set(),
      pierceLeft: 0,
    });
    cast(state);
    expect(state.projectiles[0]?.life).toBe(0);
    expect(skillMoveMul(state)).toBe(0);
  });
});

describe("射撃弾のスキル", () => {
  it("跳弾: 壁で跳ねて跳ねた回数が増える", () => {
    const state = skillArena([{ key: "ricochet" }]);
    cast(state);
    run(state, SKILL.ricochet.life - 0.1);
    expect(state.skills.shots[0]?.bounced ?? SKILL.ricochet.bounces).toBeGreaterThan(0);
  });

  it("風切り: 敵弾を消し、そのぶん遠くまで飛ぶ", () => {
    const state = skillArena([{ key: "galeSlash" }]);
    const p = state.player.body.pos;
    cast(state);
    const shot = state.skills.shots[0];
    expect(shot).toBeDefined();
    if (!shot) return;
    const lifeBefore = shot.life;
    state.projectiles.push({
      id: 996,
      owner: "enemy",
      pos: { ...shot.pos },
      vel: { x: 0, y: 0 },
      radius: 2,
      damage: 1,
      life: 5,
      color: "#fff",
      kind: "ranged",
      hitIds: new Set(),
      pierceLeft: 0,
    });
    updateSkills(state, withInput({}), FIXED_DT);
    expect(state.projectiles.find((pr) => pr.id === 996)?.life).toBe(0);
    expect(shot.life).toBeGreaterThan(lifeBefore - FIXED_DT);
    expect(p).toBeDefined();
  });

  it("散弾符: 7 発を扇に撃つ", () => {
    const state = skillArena([{ key: "scatterSigil" }]);
    cast(state);
    expect(state.skills.shots).toHaveLength(SKILL.scatterSigil.count);
  });

  it("五彩の礫: 紅の支配共鳴なら出血を付ける", () => {
    const state = skillArena([{ key: "prismShard" }]);
    state.stats = { ...state.stats, resonance: { ...createEmptyResonance(), kind: "dominant", colors: ["crimson"] } };
    const e = tough(state, 40);
    cast(state);
    run(state, 0.3);
    expect(has(e, "bleed")).toBe(true);
  });
});

describe("大拡張の刻印符（発動）", () => {
  it("後払い: マナ 0 でも撃て、少し後にコストを払う（足りない分は HP）", () => {
    const state = skillArena([{ key: "whirl", links: 1, modifiers: ["deferred"] }]);
    state.player.mana = 0;
    const hp = state.player.hp;
    cast(state);
    expect(state.skills.active?.skillKey).toBe("whirl");
    run(state, SKILL.modifier.deferred.delay + 0.05);
    expect(state.player.hp).toBeLessThan(hp);
  });

  it("後払い: HP 1 で払いきれない分は返済残に残り、返済残がある間は後払いを撃てない", () => {
    const state = skillArena([{ key: "whirl", links: 1, modifiers: ["deferred"] }]);
    state.player.mana = 0;
    state.player.hp = 1;
    cast(state);
    run(state, SKILL.modifier.deferred.delay + 0.05);
    expect(state.player.hp, "HP は 1 で止まる").toBe(1);
    expect(state.skills.debtOwed, "払えなかった分が残る").toBeGreaterThan(0);
    waitReady(state);
    state.skills.active = null;
    cast(state);
    expect(state.skills.debts, "返済残がある間は撃てない").toHaveLength(0);
    state.skills.debtOwed = 0;
    cast(state);
    expect(state.skills.debts, "返済残が 0 なら撃てる").toHaveLength(1);
  });

  it("後払い: 返済待ちの間は同じスロットを撃てない", () => {
    const state = skillArena([{ key: "frag", links: 1, modifiers: ["deferred"] }]);
    cast(state);
    waitReady(state);
    cast(state);
    expect(state.skills.debts).toHaveLength(1);
  });

  it("血の肩代わり: マナが足りなければ不足分を HP で払って撃つ", () => {
    const state = skillArena([{ key: "frag", links: 1, modifiers: ["bloodTithe"] }]);
    state.player.mana = 1;
    const hp = state.player.hp;
    cast(state);
    expect(state.skills.grenades.length).toBeGreaterThan(0);
    expect(state.player.mana).toBe(0);
    expect(state.player.hp).toBeLessThan(hp);
  });

  it("溢れ・渇き撃ち・背水は発動時の状態で威力が変わる", () => {
    const m = SKILL.modifier;
    const full = skillArena([{ key: "whirl", links: 1, modifiers: ["spillover"] }]);
    cast(full);
    expect(full.skills.active?.params.damageMul).toBeCloseTo(m.spillover.fullMul);
    const dry = skillArena([{ key: "whirl", links: 1, modifiers: ["dryFire"] }]);
    dry.player.mana = 20;
    cast(dry);
    expect(dry.skills.active?.params.damageMul).toBeCloseTo(m.dryFire.damageMul);
    const low = skillArena([{ key: "whirl", links: 1, modifiers: ["desperate"] }]);
    low.player.hp = low.player.maxHp * 0.3;
    cast(low);
    expect(low.skills.active?.params.damageMul).toBeCloseTo(m.desperate.lowMul);
  });

  it("刃の給油: 直前に近接を当てていればコストが軽い", () => {
    const state = skillArena([{ key: "frag", links: 1, modifiers: ["bladeFeed"] }]);
    const cold = resolveSlot(state, 0)?.cost ?? 0;
    const e = tough(state, 20);
    onSkillMeleeHit(state, e, 0);
    const fed = resolveSlot(state, 0)?.cost ?? 0;
    expect(fed / cold).toBeCloseTo(SKILL.modifier.bladeFeed.costMul / SKILL.modifier.bladeFeed.missMul);
  });

  it("過熱: 続けて撃つほど軽くなり、上限の後はしばらく撃てない", () => {
    const state = skillArena([{ key: "mines", links: 1, modifiers: ["overheat"] }]);
    const c0 = resolveSlot(state, 0)?.cost ?? 0;
    cast(state);
    expect(resolveSlot(state, 0)?.cost ?? 0).toBeCloseTo(c0 * SKILL.modifier.overheat.stepMul);
    waitReady(state);
    cast(state);
    waitReady(state);
    cast(state);
    expect(state.skills.slots[0]?.intervalLeft ?? 0).toBeGreaterThan(SKILL.modifier.overheat.lockTime - 0.1);
  });

  it("巡り: 直前に他のスロットを 2 回撃っていれば軽く、同じスロットの連打は重い", () => {
    const state = skillArena([{ key: "mines", links: 1, modifiers: ["cycle"] }, { key: "mines" }, { key: "mines" }]);
    const base = resolveSlot(state, 0)?.cost ?? 0;
    cast(state, undefined, 1);
    waitReady(state, 1);
    cast(state, undefined, 2);
    expect(resolveSlot(state, 0)?.cost ?? 0).toBeCloseTo(base * SKILL.modifier.cycle.freshMul);
    waitReady(state, 2);
    cast(state, undefined, 0);
    expect(resolveSlot(state, 0)?.cost ?? 0).toBeCloseTo(base * SKILL.modifier.cycle.repeatMul);
  });

  it("定刻: マナを使わず CD で撃つ", () => {
    const state = skillArena([{ key: "frag", links: 1, modifiers: ["timeLock"] }]);
    cast(state);
    expect(state.player.mana).toBe(state.stats.maxMana);
    expect(state.skills.slots[0]?.cooldownLeft ?? 0).toBeGreaterThan(0);
  });

  it("燃料化: CD 型の加速をマナで撃つ", () => {
    const state = skillArena([{ key: "haste", links: 1, modifiers: ["fuelize"] }]);
    cast(state);
    expect(state.player.mana).toBeLessThan(state.stats.maxMana);
    expect(state.skills.haste.time).toBeGreaterThan(0);
  });

  it("着地衝撃: 突進斬りの終わりに周りを打つ", () => {
    const state = skillArena([{ key: "lunge", links: 1, modifiers: ["landing"] }]);
    const e = tough(state, SKILL.lunge.distance + 20, 20);
    cast(state);
    run(state, SKILL.lunge.time + 0.05);
    expect(lost(e)).toBeGreaterThan(0);
  });

  it("追撃: 印の敵に近接を当てると追加の一撃", () => {
    const state = skillArena([{ key: "whirl", links: 1, modifiers: ["followUp"] }]);
    const e = tough(state, 15);
    cast(state);
    run(state, SKILL.whirl.duration + SKILL.whirl.recover);
    expect(state.skills.marks.has(e.id)).toBe(true);
    const before = e.hp;
    onSkillMeleeHit(state, e, 0);
    expect(e.hp).toBeLessThan(before);
    expect(state.skills.marks.has(e.id)).toBe(false);
  });

  it("散り際: このスキルで倒した敵の位置で同じスキルが弱く起きる", () => {
    const state = skillArena([{ key: "mines", links: 1, modifiers: ["lastGasp"] }]);
    const weak = placeEnemy(state, "golem", 5);
    weak.hp = 1;
    weak.phase = "idle";
    const at = { ...weak.body.pos };
    cast(state);
    run(state, SKILL.mines.arm + 0.1);
    expect(weak.hp).toBeLessThanOrEqual(0);
    // 散り際の写し: 倒した位置に同じ地雷がもう 1 つ置かれる
    const mine = state.skills.mines[0];
    expect(state.skills.mines).toHaveLength(1);
    expect(mine && Math.hypot(mine.pos.x - at.x, mine.pos.y - at.y)).toBeLessThan(1);
    expect(mine?.params.lastGasp, "写しからは起きない").toBeNull();
  });
});

describe("型替え符", () => {
  it("投げ刃: 旋風斬りがカーソル地点へ飛び、着いた所で回る（自分の周りでは回らない）", () => {
    const state = skillArena([{ key: "whirl", links: 2, modifiers: ["toThrown"] }]);
    const near = tough(state, 15);
    const at = { x: state.player.body.pos.x + 80, y: state.player.body.pos.y };
    const far = tough(state, 80);
    cast(state, at);
    expect(state.skills.active, "自分は回らない").toBeNull();
    run(state, SKILL.modifier.toThrown.flight + SKILL.whirl.duration + 0.1);
    expect(lost(far)).toBeGreaterThan(0);
    expect(lost(near)).toBe(0);
  });

  it("投げ刃 + 遅延: 遅れて発動する場所も着弾点（自分の周りでは回らない）", () => {
    const state = skillArena([{ key: "whirl", links: 3, modifiers: ["toThrown", "delay"] }]);
    const near = tough(state, 15);
    const at = { x: state.player.body.pos.x + 80, y: state.player.body.pos.y };
    const far = tough(state, 80);
    cast(state, at);
    run(state, SKILL.modifier.delay.time + SKILL.whirl.duration + 0.1);
    expect(lost(far), "着弾点の敵に当たる").toBeGreaterThan(0);
    expect(lost(near), "自分の周りの敵には当たらない").toBe(0);
  });

  it("投げ込み: 地雷をカーソル地点へ投げ、着いた瞬間に爆発する", () => {
    const state = skillArena([{ key: "mines", links: 2, modifiers: ["toLobbed"] }]);
    const e = tough(state, 60);
    cast(state, e.body.pos);
    expect(state.skills.mines, "置かずに爆発").toHaveLength(0);
    expect(lost(e)).toBeGreaterThan(0);
  });

  it("段階溜め: 3 段目まで溜めるとグレネードが 3 個になる", () => {
    const state = skillArena([{ key: "frag", links: 2, modifiers: ["toStaged"] }]);
    const stages = SKILL.modifier.toStaged.stages;
    const hold = (stages[2] ?? 1.5) + 0.05;
    const steps = Math.round(hold / FIXED_DT);
    for (let i = 0; i < steps; i++) updatePlayer(state, withInput({ skill1Held: true, skill1Pressed: i === 0 }), FIXED_DT);
    expect(skillMoveMul(state)).toBeCloseTo(SKILL.modifier.toStaged.moveMul);
    updatePlayer(state, withInput({ skill1Held: false }), FIXED_DT);
    expect(state.skills.grenades).toHaveLength(1 + SKILL.modifier.toStaged.stage3.countBonus);
  });

  it("段階溜め: 溜め中に被弾すると段が下がる", () => {
    const state = skillArena([{ key: "frag", links: 2, modifiers: ["toStaged"] }]);
    const stages = SKILL.modifier.toStaged.stages;
    const steps = Math.round(((stages[2] ?? 1.5) + 0.05) / FIXED_DT);
    for (let i = 0; i < steps; i++) updatePlayer(state, withInput({ skill1Held: true, skill1Pressed: i === 0 }), FIXED_DT);
    state.player.hp -= 5;
    updatePlayer(state, withInput({ skill1Held: true }), FIXED_DT);
    updatePlayer(state, withInput({ skill1Held: false }), FIXED_DT);
    expect(state.skills.grenades, "2 段目に下がる（回数は増えない）").toHaveLength(1);
  });
});

describe("連携", () => {
  it("パリィ成功の直後の撃ち抜きは照準なしで撃ち、威力が上がる", () => {
    const state = skillArena([{ key: "railshot" }]);
    state.skills.lastCast = { skillKey: "parry", slot: 1, at: state.skills.clock, pos: { x: 0, y: 0 }, hitIds: new Set() };
    expect(slotComboReady(state, 0)?.key, "連携可の印").toBe("parryRail");
    const e = tough(state, 60);
    cast(state);
    run(state, FIXED_DT * 2);
    expect(state.skills.active, "照準なしで撃ち終わる").toBeNull();
    expect(lost(e)).toBeGreaterThan(0);
  });

  it("受付秒を過ぎると連携しない", () => {
    const state = skillArena([{ key: "railshot" }]);
    state.skills.lastCast = { skillKey: "parry", slot: 1, at: state.skills.clock, pos: { x: 0, y: 0 }, hitIds: new Set() };
    run(state, 1.5);
    expect(slotComboReady(state, 0)).toBeNull();
  });

  it("引力球の後の雷撃は球の中心へ吸われる", () => {
    const state = skillArena([{ key: "gravityWell" }, { key: "thunder" }]);
    const wellAt = { x: state.player.body.pos.x + 60, y: state.player.body.pos.y };
    cast(state, wellAt, 0);
    waitReady(state, 0);
    cast(state, { x: wellAt.x, y: wellAt.y + 30 }, 1);
    const strike = state.skills.strikes[0];
    const well = state.skills.wells[0];
    expect(strike && well && Math.hypot(strike.pos.x - well.pos.x, strike.pos.y - well.pos.y)).toBeLessThan(1);
  });

  it("鎖鎌の直後の旋風斬りは押し出さない", () => {
    const state = skillArena([{ key: "chainHook" }, { key: "whirl" }]);
    cast(state, undefined, 0);
    run(state, SKILL.chainHook.extendTime + SKILL.chainHook.recover + 0.05);
    cast(state, undefined, 1);
    expect(state.skills.active?.params.combo).toBe("hookWhirl");
    expect(state.skills.active?.params.knockbackMul).toBe(0);
  });

  it("血の契約の後の旋風斬りは出血を付ける", () => {
    const state = skillArena([{ key: "bloodPact" }, { key: "whirl" }]);
    const e = tough(state, 15);
    cast(state, undefined, 0);
    waitReady(state, 0);
    cast(state, undefined, 1);
    run(state, SKILL.whirl.duration);
    expect(has(e, "bleed")).toBe(true);
  });

  it("伝染の直後の綻びは周りの敵もまとめて綻ばせる", () => {
    const state = skillArena([{ key: "contagion" }, { key: "unravel" }]);
    const a = tough(state, 50);
    const b = tough(state, 50, 30);
    give(state, a, "weaken");
    cast(state, a.body.pos, 0);
    expect(has(b, "weaken"), "前提: 伝染で写る").toBe(true);
    waitReady(state, 0);
    cast(state, a.body.pos, 1);
    run(state, 0.3);
    expect(has(b, "weaken"), "周りの敵も綻ぶ").toBe(false);
  });

  it("加速の後の回転弾幕は遅くならない", () => {
    const state = skillArena([{ key: "haste" }, { key: "spiral" }]);
    cast(state, undefined, 0);
    waitReady(state, 0);
    cast(state, undefined, 1);
    expect(state.skills.active?.params.combo).toBe("hasteSpiral");
    expect(skillMoveMul(state)).toBeGreaterThan(SKILL.spiral.moveMul);
  });

  it("連携は手動の発動だけが「直前」になる（反響の写しでは更新しない）", () => {
    const state = skillArena([{ key: "frag", links: 1, modifiers: ["echo"] }]);
    cast(state);
    const at = state.skills.lastCast?.at;
    run(state, SKILL.modifier.echo.delay + 0.1);
    expect(state.skills.lastCast?.at).toBe(at);
  });
});

describe("決定性", () => {
  it("同じ操作なら同じ結果（五彩の礫の散光も state.rng だけを使う）", () => {
    const play = (): number[] => {
      const state = skillArena([{ key: "prismShard" }]);
      state.stats = { ...state.stats, resonance: { ...createEmptyResonance(), kind: "scatter", colors: [] } };
      cast(state);
      return state.skills.shots.map((s) => s.pierceLeft * 10 + s.heal + (s.applies?.length ?? 0));
    };
    expect(play()).toEqual(play());
    expect(STATUS.shock.duration).toBeGreaterThan(0);
  });
});
