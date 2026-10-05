import { describe, expect, it } from "vitest";
import { pushPlayerEvent } from "../core/events";
import type { FrameInput } from "../core/input";
import { FIXED_DT } from "../core/loop";
import type { Enemy, GameState } from "../core/state";
import type { StatusKind } from "../core/status";
import type { Vec } from "../core/vec";
import { VIEW_H, VIEW_W } from "../core/view";
import { updatePlayer } from "../system/player";
import {
  createSkillRunState,
  onSkillMeleeHit,
  onSkillPlayerShoot,
  resolveSlot,
  slotComboReady,
  updateSkills,
} from "../system/skills";
import { applyStatus } from "../system/statusEffects";
import { arena, placeEnemy, withInput } from "../system/testHelpers";
import { SKILL } from "./data";
import { stoneFromSeed } from "./generator";
import { syncTurretShots } from "./summons";
import { COMBO_TUNING } from "./tuning";
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

/**
 * 確率の抽選をすべて外す。属性の相性の抽選（ELEMENT.affinity、命中の 1 割で属性の状態異常を付ける）が
 * 消費系のスキルの命中で燃焼・毒・感電を付け直すと「消える」の検証が乱数の位置しだいになるため
 */
function missAllChances(state: GameState): void {
  state.rng = { ...state.rng, chance: () => false };
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
    missAllChances(state);
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
    missAllChances(poisoned);
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
    missAllChances(state);
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

  it("砲台は近接の振りに合わせて撃つ（銃を持たない近接ビルドでも沈黙しない）", () => {
    const state = skillArena([{ key: "turret" }]);
    cast(state, { x: state.player.body.pos.x + 40, y: state.player.body.pos.y });
    run(state, 1);
    state.events = [];
    syncTurretShots(state);
    expect(state.skills.shots, "振りが無ければ撃たない").toHaveLength(0);
    pushPlayerEvent(state, "onSwing", "swing", { tag: "combo", amount: 0 });
    syncTurretShots(state);
    expect(state.skills.shots).toHaveLength(1);
  });

  it("湧き石: 石の周りで近接を当てるとマナが多く戻る", () => {
    const state = skillArena([{ key: "manaSpring" }]);
    const e = tough(state, 20);
    cast(state);
    state.player.mana = 0;
    onSkillMeleeHit(state, e, 0);
    expect(state.player.mana).toBeCloseTo(SKILL.manaSpring.manaPerHit * state.stats.manaGainMul);
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

});

describe("刻印符の循環（発動）", () => {
  /** いちばん新しく置いた地雷の威力の倍率 */
  function lastMineMul(state: GameState): number {
    return state.skills.mines.at(-1)?.params.damageMul ?? 0;
  }

  /** スロットを撃ち、次に撃てるまで待つ（気力は満たす） */
  function castAndWait(state: GameState, slot = 0): void {
    state.player.mana = state.stats.maxMana;
    cast(state, undefined, slot);
    waitReady(state, slot);
  }

  it("血の代償: マナが足りなければ不足分を HP で払って撃つ", () => {
    const state = skillArena([{ key: "mines", links: 1, modifiers: ["bloodPrice"] }]);
    state.player.mana = 1;
    const hp = state.player.hp;
    cast(state);
    expect(state.skills.mines.length).toBeGreaterThan(0);
    expect(state.player.mana).toBe(0);
    expect(state.player.hp).toBeLessThan(hp);
  });

  it("溢れ撃ち: 気力満タンで撃つと強い", () => {
    const state = skillArena([{ key: "mines", links: 1, modifiers: ["spillover"] }]);
    cast(state);
    expect(lastMineMul(state)).toBeCloseTo(SKILL.modifier.spillover.fullMul);
  });

  it("刻み撃ち: 同じスロットを続けて撃つたび強く、他のスロットを撃つと途切れる", () => {
    const m = SKILL.modifier.streak;
    const state = skillArena([{ key: "mines", links: 1, modifiers: ["streak"] }, { key: "mines" }]);
    castAndWait(state);
    const first = lastMineMul(state);
    castAndWait(state);
    expect(lastMineMul(state) / first, "2 発目").toBeCloseTo(1 + m.stepMul);
    castAndWait(state);
    expect(lastMineMul(state) / first, "3 発目").toBeCloseTo(1 + m.stepMul * 2);
    castAndWait(state, 1);
    castAndWait(state);
    expect(lastMineMul(state) / first, "他のスロットの後は戻る").toBeCloseTo(1);
  });

  it("過熱: 続けて撃つほど強く、上限で暴発して生命を失いしばらく撃てない", () => {
    const o = SKILL.modifier.overheat;
    const state = skillArena([{ key: "mines", links: 1, modifiers: ["overheat"] }]);
    castAndWait(state);
    const first = lastMineMul(state);
    castAndWait(state);
    expect(lastMineMul(state) / first).toBeCloseTo(1 + o.stepMul);
    const hp = state.player.hp;
    for (let i = 2; i < o.maxStacks - 1; i++) castAndWait(state);
    state.player.mana = state.stats.maxMana;
    cast(state);
    expect(state.player.hp, "暴発").toBeLessThan(hp);
    expect(state.skills.slots[0]?.intervalLeft ?? 0).toBeGreaterThan(o.lockTime - 0.1);
  });

  it("蓄え: 撃たずに待つほど強い（上限まで）", () => {
    const p = SKILL.modifier.patience;
    const wait = 2;
    const state = skillArena([{ key: "mines", links: 1, modifiers: ["patience"] }]);
    run(state, wait);
    cast(state);
    expect(lastMineMul(state)).toBeCloseTo(1 + wait * p.perSec, 1);
    const long = skillArena([{ key: "mines", links: 1, modifiers: ["patience"] }]);
    run(long, p.cap / p.perSec + 1);
    cast(long);
    expect(lastMineMul(long), "上限").toBeCloseTo(1 + p.cap, 5);
  });

  it("呼応: 他のスキルの直後に撃つと強い", () => {
    const state = skillArena([{ key: "mines", links: 1, modifiers: ["sympathy"] }, { key: "mines" }]);
    castAndWait(state);
    const alone = lastMineMul(state);
    run(state, SKILL.modifier.sympathy.window + 0.1);
    cast(state, undefined, 1);
    cast(state);
    expect(lastMineMul(state) / alone).toBeCloseTo(SKILL.modifier.sympathy.damageMul);
  });

  it("背水: 生命が減るほど負担が軽い", () => {
    const state = skillArena([{ key: "mines", links: 1, modifiers: ["desperate"] }]);
    const full = resolveSlot(state, 0)?.cost ?? 0;
    state.player.hp = state.player.maxHp * 0.25;
    const low = resolveSlot(state, 0)?.cost ?? 0;
    expect(low / full).toBeCloseTo(1 - SKILL.modifier.desperate.maxCut * 0.75);
  });

  it("捧げ: 奥義ゲージを払えれば強く、足りなければ払わず等倍", () => {
    const o = SKILL.modifier.offering;
    const rich = skillArena([{ key: "mines", links: 1, modifiers: ["offering"] }]);
    rich.player.energy = o.energyCost;
    cast(rich);
    expect(lastMineMul(rich)).toBeCloseTo(o.damageMul);
    expect(rich.player.energy, "払った").toBeCloseTo(0);
    const poor = skillArena([{ key: "mines", links: 1, modifiers: ["offering"] }]);
    poor.player.energy = o.energyCost - 1;
    cast(poor);
    expect(lastMineMul(poor)).toBeCloseTo(1);
    expect(poor.player.energy, "払わない").toBe(o.energyCost - 1);
  });

  it("帳: every 発ごとに 1 発が無料", () => {
    const every = SKILL.modifier.ledger.every;
    const state = skillArena([{ key: "mines", links: 1, modifiers: ["ledger"] }]);
    const cost = resolveSlot(state, 0)?.cost ?? 0;
    expect(cost).toBeGreaterThan(0);
    for (let i = 0; i < every - 1; i++) castAndWait(state);
    expect(resolveSlot(state, 0)?.cost, "次が無料").toBe(0);
    state.player.mana = 0;
    cast(state);
    expect(state.skills.slots[0]?.ledger, "無料の 1 発で数えが戻る").toBe(0);
    expect(resolveSlot(state, 0)?.cost).toBeCloseTo(cost);
  });
});

describe("型替え符", () => {
  it("照準起点: 旋風斬り（技）がカーソル地点で回る（自分の周りでは回らない）", () => {
    const state = skillArena([{ key: "commonWhirl", links: 2, modifiers: ["toTarget"] }]);
    const near = tough(state, 15);
    const at = { x: state.player.body.pos.x - 70, y: state.player.body.pos.y };
    const far = tough(state, -70);
    cast(state, at);
    run(state, 0.5);
    expect(lost(far)).toBeGreaterThan(0);
    expect(lost(near)).toBe(0);
  });

  it("照準起点 + 遅延: 遅れて発動する場所も照準地点（自分の周りでは回らない）", () => {
    const state = skillArena([{ key: "commonWhirl", links: 3, modifiers: ["toTarget", "delay"] }]);
    const near = tough(state, 15);
    const at = { x: state.player.body.pos.x - 70, y: state.player.body.pos.y };
    const far = tough(state, -70);
    cast(state, at);
    run(state, SKILL.modifier.delay.time + 0.5);
    expect(lost(far), "照準地点の敵に当たる").toBeGreaterThan(0);
    expect(lost(near), "自分の周りの敵には当たらない").toBe(0);
  });

  it("照準起点: 地雷（手書きの置くもの）をカーソル地点へ投げ、着いた瞬間に爆発する", () => {
    const state = skillArena([{ key: "mines", links: 2, modifiers: ["toTarget"] }]);
    const e = tough(state, 60);
    cast(state, e.body.pos);
    expect(state.skills.mines, "置かずに爆発").toHaveLength(0);
    expect(lost(e)).toBeGreaterThan(0);
  });
});

describe("連携", () => {
  it("パリィ成功の直後の撃ち抜き（技）は連携で威力が上がる", () => {
    const damage = (combo: boolean): number => {
      const state = skillArena([{ key: "commonRailshot" }]);
      missAllChances(state);
      if (combo) state.skills.lastCast = { skillKey: "parry", slot: 1, at: state.skills.clock, pos: { x: 0, y: 0 }, hitIds: new Set() };
      expect(slotComboReady(state, 0)?.key ?? null, "連携可の印").toBe(combo ? "parryRail" : null);
      const e = tough(state, 60);
      cast(state);
      run(state, FIXED_DT * 2);
      return lost(e);
    };
    const plain = damage(false);
    expect(plain, "前提: 当たる").toBeGreaterThan(0);
    expect(damage(true) / plain).toBeCloseTo(COMBO_TUNING.parryRail.damageMul, 1);
  });

  it("受付秒を過ぎると連携しない", () => {
    const state = skillArena([{ key: "commonRailshot" }]);
    state.skills.lastCast = { skillKey: "parry", slot: 1, at: state.skills.clock, pos: { x: 0, y: 0 }, hitIds: new Set() };
    run(state, 1.5);
    expect(slotComboReady(state, 0)).toBeNull();
  });

  it("鎖鎌の直後の旋風斬り（技）は押し出さない", () => {
    const state = skillArena([{ key: "chainHook" }, { key: "commonWhirl" }]);
    cast(state, undefined, 0);
    run(state, SKILL.chainHook.extendTime + SKILL.chainHook.recover + 0.05);
    expect(slotComboReady(state, 1)?.key, "連携可の印").toBe("hookWhirl");
    const e = tough(state, 15);
    cast(state, undefined, 1);
    expect(state.skills.lastCast?.skillKey, "旋風斬りを撃った").toBe("commonWhirl");
    expect(lost(e), "当たる").toBeGreaterThan(0);
    expect(Math.hypot(e.knock.x, e.knock.y), "押し出さない").toBe(0);
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

  it("連携は手動の発動だけが「直前」になる（反響の写しでは更新しない）", () => {
    const state = skillArena([{ key: "mines", links: 1, modifiers: ["echo"] }]);
    cast(state);
    const at = state.skills.lastCast?.at;
    run(state, SKILL.modifier.echo.delay + 0.1);
    expect(state.skills.lastCast?.at).toBe(at);
  });
});

describe("決定性", () => {
  it("同じ操作なら同じ結果（追い討ちの短刀と命中）", () => {
    const play = (): number[] => {
      const state = skillArena([{ key: "rout" }]);
      const e = tough(state, 40);
      cast(state);
      run(state, 0.3);
      return [...state.skills.shots.map((s) => s.pos.x + s.pos.y), e.hp];
    };
    expect(play()).toEqual(play());
  });
});
