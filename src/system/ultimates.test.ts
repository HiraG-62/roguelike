import { describe, expect, it } from "vitest";
import { step } from "../core/game";
import { FIXED_DT } from "../core/loop";
import type { Enemy, GameState, Projectile } from "../core/state";
import { ULTIMATE } from "../data/tuning";
import { ULTIMATES, type UltimateDef, defaultUltimate, ultimateDef } from "../data/ultimates";
import { MOVESET_KEYS } from "../data/weapons";
import type { PlayerStats } from "../loot/types";
import { stoneFromSeed } from "../skills/generator";
import { pushPlayerEvent } from "../core/events";
import { type Rule, SCOPE_ANY, ruleId } from "../core/rules";
import { collectRules, resolveRules, ruleConditionsMet } from "./rules";
import { createSkillRunState, updateSkills } from "./skills";
import { arena, placeEnemy, withInput } from "./testHelpers";
import {
  chosenUltimate,
  endUltimate,
  noteUltimateKill,
  tryUltimate,
  ultimateIncomingMul,
  ultimateMoveset,
  ultimateOutgoingMul,
  ultimateShot,
  updateUltimate,
} from "./ultimates";
import { currentShot, playerMoveset, updatePlayer } from "./player";
import { damageEnemy, rollOutgoing } from "./combat";
import { applyStatus } from "./statusEffects";

/**
 * 奥義（docs/ideas/ougi-and-dual-actions.md 3 章）: 発動・ゲージ・一撃の行為・持続の倍率と差し替え・終わり方を
 * 状態と数値で確かめる。数値は ULTIMATE（ultimates.json）から読む
 */

const BIG_HP = 5000;
const NO_ATTACK_COOLDOWN = 99;
const NEAR = 20;

function def(key: string): UltimateDef {
  const d = ultimateDef(key);
  if (!d) throw new Error(`奥義 ${key} が無い`);
  return d;
}

/** 武器種と奥義を選び、ゲージを満タンにした場 */
function ready(key: string, stats: Partial<PlayerStats> = {}): GameState {
  const d = def(key);
  const state = arena(5, { moveset: d.moveset, ...stats });
  state.profile.ultimates = { [d.moveset]: key };
  state.player.energy = ULTIMATE.common.cost;
  return state;
}

/** 動かず殴り返さない的 */
function dummy(state: GameState, dx: number, dy = 0): Enemy {
  const e = placeEnemy(state, "slime", dx, dy);
  e.hp = BIG_HP;
  e.maxHp = BIG_HP;
  e.phase = "idle";
  e.attackCooldown = NO_ATTACK_COOLDOWN;
  return e;
}

function lost(e: Enemy): number {
  return BIG_HP - e.hp;
}

function burstEvents(state: GameState): readonly number[] {
  return state.events.filter((ev) => ev.kind === "onBurst").map((ev) => ev.amount ?? 0);
}

function enemyBullet(state: GameState, dx: number): Projectile {
  const p = state.player.body.pos;
  const pr: Projectile = {
    id: state.nextId++,
    owner: "enemy",
    pos: { x: p.x + dx, y: p.y },
    vel: { x: 0, y: 0 },
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

function runPlayer(state: GameState, seconds: number): void {
  const n = Math.ceil(seconds / FIXED_DT);
  for (let i = 0; i < n; i++) updatePlayer(state, withInput({}), FIXED_DT);
}

describe("奥義の発動", () => {
  it("奥義ゲージが満タンでなければ出ず、未充填の文字が出る", () => {
    const state = arena();
    state.player.energy = ULTIMATE.common.cost - 1;
    const texts = state.texts.length;
    expect(tryUltimate(state), "出ない").toBe(false);
    expect(state.player.energy, "ゲージは減らない").toBe(ULTIMATE.common.cost - 1);
    expect(state.texts.length, "未充填の浮き文字").toBe(texts + 1);
    expect(burstEvents(state), "onBurst は積まない").toHaveLength(0);
  });

  it("一撃の奥義はゲージを 0 にし、行為の列を順に出す（円月は周囲に当てて敵弾を消す）", () => {
    const state = ready("sword.fullMoon");
    const e = dummy(state, NEAR);
    const near = enemyBullet(state, NEAR);
    step(state, withInput({ specialPressed: true }), FIXED_DT);
    expect(state.player.energy, "ゲージを使い切る").toBe(0);
    expect(lost(e), "周囲の敵に当たる").toBeGreaterThan(0);
    expect(near.life, "近くの敵弾を消す").toBe(0);
    expect(state.player.invulnTimer, "発動後の無敵").toBeGreaterThan(0);
  });

  it("一撃の奥義の威力と範囲に burstDamageMul / burstRadiusMul が掛かる", () => {
    const radius = ULTIMATE.defs.sword.fullMoon.nova.radius;
    const base = ready("sword.fullMoon");
    const e1 = dummy(base, NEAR);
    const far1 = dummy(base, radius + 10);
    tryUltimate(base);
    const doubled = ready("sword.fullMoon", { burstDamageMul: 2, burstRadiusMul: 1.5 });
    const e2 = dummy(doubled, NEAR);
    const far2 = dummy(doubled, radius + 10);
    tryUltimate(doubled);
    expect(lost(e2) / lost(e1), "威力が 2 倍").toBeCloseTo(2, 1);
    expect(lost(far1), "等倍の範囲の外").toBe(0);
    expect(lost(far2), "範囲 1.5 倍なら届く").toBeGreaterThan(0);
  });

  it("一撃の奥義は発動時に onBurst（量 = 倒した数）を積む", () => {
    const state = ready("sword.fullMoon");
    placeEnemy(state, "slime", NEAR).hp = 1;
    placeEnemy(state, "slime", -NEAR).hp = 1;
    dummy(state, 0, NEAR);
    tryUltimate(state);
    expect(burstEvents(state), "倒した 2 体").toEqual([2]);
  });

  it("選んだ奥義が無い・未知・武器種違いなら武器種の 1 本目を使う", () => {
    const state = arena(5, { moveset: "spear" });
    expect(chosenUltimate(state).key, "選択なし").toBe(defaultUltimate("spear").key);
    state.profile.ultimates = { spear: "nope" };
    expect(chosenUltimate(state).key, "未知の key").toBe(defaultUltimate("spear").key);
    state.profile.ultimates = { spear: defaultUltimate("sword").key };
    expect(chosenUltimate(state).key, "武器種違い").toBe(defaultUltimate("spear").key);
  });
});

describe("一撃の奥義の行為", () => {
  it("突進（瞬閃）は照準方向へ進み、通り道の敵を斬る", () => {
    const state = ready("sword.flashCut");
    const x = state.player.body.pos.x;
    const onPath = dummy(state, 60);
    const beside = dummy(state, 60, 60);
    tryUltimate(state);
    expect(state.player.body.pos.x - x, "前へ進む").toBeGreaterThan(0);
    expect(lost(onPath), "通り道の敵").toBeGreaterThan(0);
    expect(lost(beside), "通り道の外").toBe(0);
    expect(state.player.invulnTimer, "踏み込みの無敵").toBeGreaterThan(ULTIMATE.common.invuln);
  });

  it("引き寄せ（魂刈り）は周囲の敵を寄せてから一周薙ぐ", () => {
    const state = ready("scythe.soulReap");
    const pull = ULTIMATE.defs.scythe.soulReap.pull;
    const e = dummy(state, pull.radius - 5);
    tryUltimate(state);
    expect(e.body.pos.x - state.player.body.pos.x, "寄せた距離").toBeLessThanOrEqual(pull.toDistance + 1);
    expect(lost(e), "寄せた敵に当たる").toBeGreaterThan(0);
  });

  it("弾の奥義（死の輪舞）は全周へ弾を出し、弾の威力に burstDamageMul が掛かる", () => {
    const n = ULTIMATE.defs.gunner.deathRondo.volley.count;
    const a = ready("gunner.deathRondo");
    tryUltimate(a);
    const shotsA = a.projectiles.filter((p) => p.owner === "player");
    expect(shotsA, "弾の数").toHaveLength(n);
    const b = ready("gunner.deathRondo", { burstDamageMul: 2 });
    tryUltimate(b);
    const shotB = b.projectiles.find((p) => p.owner === "player");
    expect(shotB?.damage, "弾の威力 2 倍").toBeCloseTo((shotsA[0]?.damage ?? 0) * 2, 5);
  });

  it("首落としは生命の少ない敵（ボスを除く）を倒す", () => {
    const state = ready("cleaver.beheading");
    const e = dummy(state, NEAR);
    e.hp = Math.floor(BIG_HP * ULTIMATE.defs.cleaver.beheading.nova.execute * 0.5);
    tryUltimate(state);
    expect(e.hp, "倒れる").toBeLessThanOrEqual(0);
  });

  it("全弾発射は床の自分の設置弾を強めて起爆させる", () => {
    const state = ready("trapper.minefield");
    tryUltimate(state);
    const mines = state.projectiles.filter((p) => p.owner === "player");
    expect(mines.length, "設置弾を撒く").toBe(ULTIMATE.defs.trapper.minefield.volley.count);
    state.profile.ultimates = { trapper: "trapper.chainBlast" };
    state.player.energy = ULTIMATE.common.cost;
    const before = mines.map((m) => m.damage);
    tryUltimate(state);
    mines.forEach((m, i) => expect(m.damage, "起爆の威力").toBeCloseTo((before[i] ?? 0) * ULTIMATE.defs.trapper.chainBlast.detonate.damageMul, 5));
    expect(Math.max(...mines.map((m) => m.life)), "信管を切る").toBeLessThan(ULTIMATE.defs.trapper.minefield.volley.lifeMul);
  });

  it("69 本すべてが周りに敵のいる場で出せ、数秒進めても落ちない", () => {
    for (const k of MOVESET_KEYS) {
      for (const u of ULTIMATES[k]) {
        const state = ready(u.key);
        dummy(state, NEAR);
        dummy(state, -NEAR, NEAR);
        placeEnemy(state, "slime", 40).hp = 1;
        step(state, withInput({ specialPressed: true }), FIXED_DT);
        for (let i = 0; i < 60; i++) step(state, withInput({ attackPressed: i % 6 === 0, attackHeld: true }), FIXED_DT);
        expect(state.status, `${u.key}`).toBe("playing");
      }
    }
  });
});

describe("持続の奥義", () => {
  it("持続の奥義はゲージが毎秒減り、0 で終わる", () => {
    const state = ready("sword.swordAura");
    const sustain = ULTIMATE.defs.sword.swordAura;
    expect(tryUltimate(state), "出る").toBe(true);
    expect(state.player.ultimate.active, "持続中").toBe("sword.swordAura");
    for (let i = 0; i < Math.round(1 / FIXED_DT); i++) updateUltimate(state, FIXED_DT);
    expect(state.player.energy, "1 秒で drainPerSec 減る").toBeCloseTo(ULTIMATE.common.cost - sustain.drainPerSec, 0);
    const rest = ULTIMATE.common.cost / sustain.drainPerSec;
    for (let i = 0; i < Math.ceil(rest / FIXED_DT); i++) updateUltimate(state, FIXED_DT);
    expect(state.player.energy, "尽きる").toBe(0);
    expect(state.player.ultimate.active, "終わる").toBeNull();
  });

  it("持続中にもう一度押すと終わり、残りのゲージは保つ", () => {
    const state = ready("sword.swordAura");
    tryUltimate(state);
    for (let i = 0; i < 30; i++) updateUltimate(state, FIXED_DT);
    const left = state.player.energy;
    expect(tryUltimate(state), "押すと終える").toBe(true);
    expect(state.player.ultimate.active, "終わる").toBeNull();
    expect(state.player.energy, "残りを保つ").toBe(left);
    expect(left, "満タンより少ない").toBeLessThan(ULTIMATE.common.cost);
  });

  it("持続中は奥義ゲージが貯まらない", () => {
    const state = ready("sword.swordAura");
    tryUltimate(state);
    updateUltimate(state, FIXED_DT);
    const before = state.player.energy;
    const e = dummy(state, NEAR);
    damageEnemy(state, e, 1, { x: 1, y: 0 }, 0, { buildsEnergy: true, kind: "melee" });
    expect(state.player.energy, "命中でも増えない").toBe(before);
  });

  it("持続中は Rule の満タン補充・直接加算（刻限コンボ・残響爆発など）でもゲージが増えない", () => {
    const state = ready("sword.swordAura");
    tryUltimate(state);
    updateUltimate(state, FIXED_DT);
    const before = state.player.energy;
    const owner = { kind: "boon" as const, key: "comboClock" };
    const fill: Rule = { id: ruleId(owner, 0), when: "onSwing", if: [], then: { kind: "energy", magnitude: 0, fill: true }, chance: 1, icd: 0, scope: SCOPE_ANY, owner };
    const raw: Rule = { id: ruleId(owner, 1), when: "onSwing", if: [], then: { kind: "energy", magnitude: 50, raw: true }, chance: 1, icd: 0, scope: SCOPE_ANY, owner };
    pushPlayerEvent(state, "onSwing", "swing");
    resolveRules(state, 0, [fill, raw]);
    expect(state.player.energy, "持続中は補充されない").toBe(before);
    endUltimate(state, "manual");
    pushPlayerEvent(state, "onSwing", "swing");
    resolveRules(state, 0, [fill]);
    expect(state.player.energy, "終われば満タン補充が効く").toBe(state.player.maxEnergy);
  });

  it("持続中は段が差し替わり、終わると装備の型に戻って振りが止まる（剣気解放）", () => {
    const state = ready("sword.swordAura");
    const base = playerMoveset(state);
    const reachMul = ULTIMATE.defs.sword.swordAura.patch.reachMul;
    tryUltimate(state);
    const patched = playerMoveset(state);
    expect(patched.steps[0]?.reach, "届く距離が伸びる").toBeCloseTo((base.steps[0]?.reach ?? 0) * reachMul, 5);
    expect(ultimateMoveset(state, base), "同じ入力なら同じ型（毎回作らない）").toBe(ultimateMoveset(state, base));
    updatePlayer(state, withInput({ attackPressed: true, attackHeld: true }), FIXED_DT);
    expect(state.player.attack.phase, "振っている").not.toBe("none");
    endUltimate(state, "manual");
    expect(state.player.attack.phase, "振りが止まる").toBe("none");
    expect(playerMoveset(state).steps[0]?.reach, "装備の型に戻る").toBe(base.steps[0]?.reach);
  });

  it("持続中の倍率は通常攻撃に burstDamageMul を二重に掛けない", () => {
    const state = arena(5, { moveset: "wand", burstDamageMul: 3 });
    const plain = rollOutgoing(state, null, 100, "melee").amount;
    state.player.ultimate.active = "wand.incantation";
    const mul = ULTIMATE.defs.wand.incantation.mul.damage;
    expect(ultimateOutgoingMul(state, null), "持続の倍率だけ").toBe(mul);
    expect(rollOutgoing(state, null, 100, "melee").amount, "近接に倍率").toBe(Math.round(plain * mul));
    expect(rollOutgoing(state, null, 100, "proc").amount, "奥義の行為（proc）には掛けない").toBe(100);
  });

  it("持続の奥義は終了時に onBurst（量 = 持続中の撃破数）を積む", () => {
    const state = ready("sword.swordAura");
    tryUltimate(state);
    expect(burstEvents(state), "始めでは積まない").toHaveLength(0);
    const e = placeEnemy(state, "slime", NEAR);
    damageEnemy(state, e, e.hp + 1, { x: 1, y: 0 }, 0);
    endUltimate(state, "manual");
    expect(burstEvents(state), "持続中に倒した 1 体").toEqual([1]);
  });

  it("持続中に変身を撃つと奥義が終わり、奥義を撃つと変身が解ける", () => {
    const state = ready("sword.swordAura");
    const stone = stoneFromSeed(901, { foundDepth: 1, now: 0, skillKey: "wolfForm" });
    state.skills = createSkillRunState({ version: 1, loadout: [stone.id], stones: [{ ...stone, variants: [], links: 0 }] });
    updateSkills(state, withInput({}), 0);
    state.player.mana = state.stats.maxMana;
    tryUltimate(state);
    expect(state.player.ultimate.active, "持続中").not.toBeNull();
    updatePlayer(state, withInput({ skill1Pressed: true }), FIXED_DT);
    expect(state.skills.shape?.key, "変身した").toBe("wolfForm");
    expect(state.player.ultimate.active, "変身で奥義が終わる").toBeNull();
    state.player.energy = ULTIMATE.common.cost;
    tryUltimate(state);
    expect(state.skills.shape, "奥義で変身が解ける").toBeNull();
    expect(state.player.ultimate.active, "奥義は持続中").toBe("sword.swordAura");
  });

  it("持続の rules は active のときだけ collectRules に入る", () => {
    const state = ready("sword.swordAura");
    const ids = (s: GameState): string[] => collectRules(s).map((r) => r.id);
    const own = def("sword.swordAura");
    const ruleIds = own.kind === "sustain" ? (own.sustain.rules ?? []).map((r) => r.id) : [];
    expect(ruleIds.length, "剣気解放は Rule を持つ").toBeGreaterThan(0);
    for (const id of ruleIds) expect(ids(state), "持続前").not.toContain(id);
    tryUltimate(state);
    for (const id of ruleIds) expect(ids(state), "持続中").toContain(id);
    endUltimate(state, "manual");
    for (const id of ruleIds) expect(ids(state), "終わった後").not.toContain(id);
  });

  it("剣気解放は振るたびに剣気の波を出す", () => {
    const state = ready("sword.swordAura");
    tryUltimate(state);
    // 発動のヒットストップ中は入力を読まないので明けてから振る
    state.hitstop = 0;
    const before = state.projectiles.length;
    step(state, withInput({ attackPressed: true, attackHeld: true }), FIXED_DT);
    expect(state.projectiles.length, "波が出る").toBeGreaterThan(before);
  });

  it("弾の差し替え（弾幕）は弾数を足し、終われば元の弾に戻る", () => {
    const state = ready("gunner.barrage");
    const shot = currentShot(state.stats);
    tryUltimate(state);
    expect(ultimateShot(state, shot).pellets, "弾数").toBe(shot.pellets + ULTIMATE.defs.gunner.barrage.shot.pelletsAdd);
    expect(ultimateShot(state, shot).key, "弾の key はそのまま").toBe(shot.key);
    endUltimate(state, "manual");
    expect(ultimateShot(state, shot), "元の弾").toBe(shot);
  });

  it("鉄壁は正面からの被弾だけを軽くし、修羅は被ダメを増やして終わると弱る", () => {
    const state = ready("shield.ironWall");
    tryUltimate(state);
    const front = { x: state.player.body.pos.x + 30, y: state.player.body.pos.y };
    const back = { x: state.player.body.pos.x - 30, y: state.player.body.pos.y };
    expect(ultimateIncomingMul(state, front), "正面").toBe(ULTIMATE.defs.shield.ironWall.guardMul);
    expect(ultimateIncomingMul(state, back), "背後").toBe(1);
    const asura = ready("cleaver.asura");
    tryUltimate(asura);
    expect(ultimateIncomingMul(asura, front), "修羅の被ダメ").toBe(ULTIMATE.defs.cleaver.asura.mul.incoming);
    endUltimate(asura, "manual");
    expect(asura.player.buffs.damage.mul, "終わった後の弱り").toBe(ULTIMATE.defs.cleaver.asura.onEnd.damageMul);
    expect(asura.player.buffs.damage.time, "弱りの秒").toBeGreaterThan(0);
  });

  it("雷鞭の纏いは周りの敵へ一定の間隔で当たり、狂斧は出血した敵に強い", () => {
    const state = ready("whip.thunderWhip");
    const e = dummy(state, NEAR);
    tryUltimate(state);
    runPlayer(state, ULTIMATE.defs.whip.thunderWhip.aura.interval * 2);
    expect(lost(e), "纏いが当たる").toBeGreaterThan(0);
    const axe = ready("axe.madAxe");
    const bleeding = dummy(axe, NEAR);
    tryUltimate(axe);
    const plain = ultimateOutgoingMul(axe, bleeding);
    applyStatus(axe, { kind: "enemy", enemy: bleeding }, { kind: "bleed", stacks: 1, duration: 3, potency: 1 }, "player");
    expect(ultimateOutgoingMul(axe, bleeding) / plain, "出血の敵への倍率").toBeCloseTo(ULTIMATE.defs.axe.madAxe.vsStatus, 5);
  });
});

describe("奥義の Rule 条件", () => {
  it("ultimateActive は持続の奥義の最中だけ、lane は今の振りのレーンで真", () => {
    const state = arena();
    const subject = { pos: { ...state.player.body.pos } };
    expect(ruleConditionsMet(state, [{ kind: "ultimateActive" }], subject), "持続中でない").toBe(false);
    state.player.ultimate.active = "x";
    expect(ruleConditionsMet(state, [{ kind: "ultimateActive" }], subject), "持続中").toBe(true);
    expect(ruleConditionsMet(state, [{ kind: "lane", lane: "primary" }], subject), "既定は左").toBe(true);
    state.player.attack.lane = "secondary";
    expect(ruleConditionsMet(state, [{ kind: "lane", lane: "primary" }], subject), "右の振り").toBe(false);
    expect(ruleConditionsMet(state, [{ kind: "lane", lane: "secondary" }], subject), "右の振り").toBe(true);
  });

  it("持続の奥義が無い間は型を差し替えず、撃破も数えない", () => {
    const state = arena();
    const base = playerMoveset(state);
    expect(ultimateMoveset(state, base), "型はそのまま").toBe(base);
    noteUltimateKill(state);
    expect(state.player.ultimate.kills, "持続中でなければ数えない").toBe(0);
  });
});
