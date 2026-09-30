import { describe, expect, it } from "vitest";
import type { GameEvent } from "../core/events";
import type { FrameInput } from "../core/input";
import { FIXED_DT } from "../core/loop";
import type { Enemy, GameState } from "../core/state";
import type { Vec } from "../core/vec";
import { FORM, WEAPON } from "../data/tuning";
import type { PlayerStats } from "../loot/types";
import { skillHit } from "../skills/hit";
import { placeMine } from "../skills/placed";
import { placeKeg, tollSummons } from "../skills/summons";
import { stoneFromSeed } from "../skills/generator";
import type { CastParams, SkillKey, SkillStone } from "../skills/types";
import { gainMorale } from "./morale";
import { updatePlayer } from "./player";
import { createSkillRunState, resolveSlot, updateSkills } from "./skills";
import { arena, placeEnemy, withInput } from "./testHelpers";
import { minionDamageMul } from "./tomeBell";

/**
 * 書・鈴の型（docs/ideas/weapon-forms-impl.md 3-4 の書・鈴の行、3-8。system/tomeBell.ts）。
 * 書: スキルの命中で術が溜まり、無詠唱（右 1 段目の放出）で次の気力のスキル 1 回の気力が 0。持つ間は CD 型の再使用が短い。
 * 鈴: 設置物・従魔の命中で鈴音が溜まり、打ち鳴らし（右 1 段目の放出）で半径内の設置物が動き、設置物・従魔の命中が強まる
 */

const TOUGH_HP = 99999;
const NO_ATTACK_COOLDOWN = 99;
const EPS = 1e-6;
/** 打ち鳴らしの半径の外に置く距離（px） */
const FAR = FORM.bell.toll.radius + 80;
const NEAR = 24;

let seed = 300;

function stone(key: SkillKey): SkillStone {
  seed += 1;
  return { ...stoneFromSeed(seed, { foundDepth: 1, now: 0, skillKey: key }), variants: [], links: 0 };
}

/** 武器種とスキル石を持たせた部屋（気力は満タン） */
function skillArena(stats: Partial<PlayerStats>, keys: readonly SkillKey[]): GameState {
  const state = arena(5, stats);
  const stones = keys.map(stone);
  state.skills = createSkillRunState({ version: 1, loadout: stones.map((s) => s.id), stones });
  updateSkills(state, withInput({}), 0);
  state.player.mana = state.stats.maxMana;
  return state;
}

function tough(state: GameState, dx: number): Enemy {
  const e = placeEnemy(state, "golem", dx);
  e.hp = TOUGH_HP;
  e.maxHp = TOUGH_HP;
  e.attackCooldown = NO_ATTACK_COOLDOWN;
  e.phase = "idle";
  return e;
}

function paramsOf(state: GameState, slot = 0): CastParams {
  const r = resolveSlot(state, slot);
  if (!r) throw new Error(`スロット ${slot} に石が無い`);
  return r.params;
}

/** プレイヤーを n ステップ進め、その間のイベントを返す */
function run(state: GameState, input: Partial<FrameInput>, n = 1): GameEvent[] {
  const out: GameEvent[] = [];
  for (let i = 0; i < n; i++) {
    updatePlayer(state, withInput(input), FIXED_DT);
    state.time += FIXED_DT;
    out.push(...state.events);
    state.events.length = 0;
  }
  return out;
}

/** 右レーンの 1 段目を押す（段カウンタを 0 に戻して窓を開け、前ステップは離していた扱い） */
function pressRightFirst(state: GameState): GameEvent[] {
  const a = state.player.attack;
  a.step = 0;
  a.inputTimer = WEAPON.chainWindow;
  state.player.secondaryWasHeld = false;
  return run(state, { shootHeld: true });
}

/** 振りが終わるまで進める */
function settle(state: GameState): void {
  for (let i = 0; i < 120 && state.player.attack.phase !== "none"; i++) run(state, {});
}

function hit(state: GameState, e: Enemy, params: CastParams, minion: boolean): void {
  const dir: Vec = { x: 1, y: 0 };
  skillHit(state, e, params, { base: 1, kind: "ranged", dir, knockback: 0, stagger: false, minion });
}

describe("書（無詠唱・再使用）", () => {
  it("スキルの命中で術が溜まり、無詠唱で使い切ると次の気力のスキル 1 回の気力が 0 になる", () => {
    const state = skillArena({ moveset: "book" }, ["mines"]);
    const e = tough(state, 200);
    const params = paramsOf(state);
    for (let i = 0; i < FORM.tome.releaseMin; i++) hit(state, e, params, false);
    expect(state.player.morale.value, "スキルの命中の数だけ術").toBeCloseTo(FORM.tome.releaseMin * FORM.tome.gain.skillHit);

    const cost = resolveSlot(state, 0)?.cost ?? 0;
    expect(cost, "地雷は気力を使う").toBeGreaterThan(0);
    const release = pressRightFirst(state).filter((ev) => ev.kind === "onRelease");
    expect(release, "無詠唱の振り始めで放出").toHaveLength(1);
    expect(state.player.morale.value, "術を使い切る").toBe(0);
    expect(state.skills.freeCast, "無詠唱が立つ").toBe(true);
    expect(resolveSlot(state, 0)?.cost, "表示と支払いの気力が 0").toBe(0);

    settle(state);
    const before = state.player.mana;
    run(state, { skill1Pressed: true });
    expect(state.skills.mines.length, "地雷を置いた").toBeGreaterThan(0);
    expect(state.player.mana, "気力は減らない").toBeGreaterThanOrEqual(before - EPS);
    expect(state.skills.freeCast, "1 回で使い切る").toBe(false);
    expect(resolveSlot(state, 0)?.cost, "次からは元の気力").toBeCloseTo(cost);
  });

  it("術が足りないと無詠唱はただの振りで、次のスキルの気力はそのまま", () => {
    const state = skillArena({ moveset: "book" }, ["mines"]);
    const release = pressRightFirst(state).filter((ev) => ev.kind === "onRelease");
    expect(release, "放出にならない").toHaveLength(0);
    expect(state.skills.freeCast ?? false, "無詠唱は立たない").toBe(false);
    expect(resolveSlot(state, 0)?.cost ?? 0, "気力はそのまま").toBeGreaterThan(0);
  });

  it("設置物・従魔の命中では書の術は溜まらない（鈴の分）", () => {
    const state = skillArena({ moveset: "book" }, ["mines"]);
    const e = tough(state, 200);
    hit(state, e, paramsOf(state), true);
    expect(state.player.morale.value).toBe(0);
  });

  it("書を持つ間は CD 型のスキルの再使用が skillCooldownMul 倍になる", () => {
    const withBook = skillArena({ moveset: "book" }, ["commonLunge"]);
    const withSword = skillArena({ moveset: "sword" }, ["commonLunge"]);
    const book = resolveSlot(withBook, 0)?.cooldown ?? 0;
    const sword = resolveSlot(withSword, 0)?.cooldown ?? 0;
    expect(sword, "突進は CD 型").toBeGreaterThan(0);
    expect(book / sword, "再使用の倍率").toBeCloseTo(FORM.tome.skillCooldownMul);
  });
});

describe("鈴（打ち鳴らし）", () => {
  it("設置物・従魔の命中で鈴音が溜まり、スキルの直撃では溜まらない", () => {
    const state = skillArena({ moveset: "handbell" }, ["mines"]);
    const e = tough(state, 200);
    const params = paramsOf(state);
    hit(state, e, params, false);
    expect(state.player.morale.value, "直撃では溜まらない").toBe(0);
    hit(state, e, params, true);
    expect(state.player.morale.value, "設置物の命中で溜まる").toBeCloseTo(FORM.bell.gain.minionHit);
  });

  it("打ち鳴らしの放出で半径内の地雷が起爆し、外の地雷は残り、設置物・従魔の強化が立つ", () => {
    const state = skillArena({ moveset: "handbell" }, ["mines"]);
    const e = tough(state, NEAR + 20);
    const params = paramsOf(state);
    const p = state.player.body.pos;
    placeMine(state, { x: p.x + NEAR, y: p.y }, params);
    placeMine(state, { x: p.x - FAR, y: p.y }, params);
    for (let i = 0; i < FORM.bell.max; i++) gainMorale(state, "minionHit");
    const hpBefore = e.hp;

    const release = pressRightFirst(state).filter((ev) => ev.kind === "onRelease");
    expect(release, "打ち鳴らしの振り始めで放出").toHaveLength(1);
    expect(state.skills.mines, "近くの地雷だけ起爆").toHaveLength(1);
    expect(state.skills.mines[0]?.pos.x, "遠くの地雷は残る").toBeCloseTo(p.x - FAR);
    expect(e.hp, "起爆が当たる").toBeLessThan(hpBefore);
    expect(state.skills.bellBuff?.mul, "強化の倍率").toBe(FORM.bell.toll.buffMul);
    expect(state.skills.bellBuff?.time ?? 0, "強化の秒").toBeGreaterThan(FORM.bell.toll.buffSec - FIXED_DT * 2);
  });

  it("強化は設置物・従魔の命中だけに乗り、切れたら等倍", () => {
    const state = skillArena({ moveset: "handbell" }, []);
    state.skills.bellBuff = { time: 1, mul: FORM.bell.toll.buffMul };
    expect(minionDamageMul(state, true), "設置物・従魔").toBe(FORM.bell.toll.buffMul);
    expect(minionDamageMul(state, false), "スキルの直撃").toBe(1);
    run(state, {}, Math.ceil(1 / FIXED_DT) + 1);
    expect(minionDamageMul(state, true), "切れた").toBe(1);
  });

  it("強化の間の左の振りで残りが延び、上限 maxSec で止まる。強化が無ければ振りでは立たない", () => {
    const state = skillArena({ moveset: "handbell" }, []);
    run(state, { attackPressed: true });
    expect(state.skills.bellBuff, "振りだけでは立たない").toBeUndefined();
    settle(state);

    const t = FORM.bell.toll;
    state.skills.bellBuff = { time: 1, mul: t.buffMul };
    run(state, { attackPressed: true });
    expect(state.skills.bellBuff.time, "左の振りで延びる").toBeCloseTo(1 + t.extendSec - FIXED_DT, 5);
    settle(state);

    state.skills.bellBuff = { time: t.maxSec, mul: t.buffMul };
    run(state, { attackPressed: true });
    expect(state.skills.bellBuff.time, "上限で止まる").toBeLessThanOrEqual(t.maxSec);
  });

  it("連動体への命令: 半径内の爆薬樽は起爆し、外の樽は残る", () => {
    const state = skillArena({ moveset: "handbell" }, ["powderKeg"]);
    const e = tough(state, NEAR + 10);
    const params = paramsOf(state);
    const p = state.player.body.pos;
    placeKeg(state, { x: p.x + NEAR, y: p.y }, params);
    placeKeg(state, { x: p.x - FAR, y: p.y }, params);
    const hpBefore = e.hp;
    const moved = tollSummons(state, p, FORM.bell.toll.radius);
    expect(moved, "動いた連動体の数").toBe(1);
    expect(state.skills.kegs, "外の樽は残る").toHaveLength(1);
    expect(e.hp, "樽の爆風が当たる").toBeLessThan(hpBefore);
  });
});
