import { describe, expect, it } from "vitest";
import type { GameEvent } from "../core/events";
import { step } from "../core/game";
import type { FrameInput } from "../core/input";
import { FIXED_DT } from "../core/loop";
import type { Enemy, GameState } from "../core/state";
import type { StatusApply } from "../core/status";
import type { Vec } from "../core/vec";
import { FORM, MANA, STATUS, WEAPON } from "../data/tuning";
import { MOVESETS } from "../data/weapons";
import { DEFAULT_STATS, type PlayerStats } from "../loot/types";
import { skillHit } from "../skills/hit";
import { placeMine } from "../skills/placed";
import { placeKeg, tollSummons } from "../skills/summons";
import { stoneFromSeed } from "../skills/generator";
import type { CastParams, SkillKey, SkillStone } from "../skills/types";
import { inkReadRadius } from "./inkMark";
import { gainMorale } from "./morale";
import { updatePlayer } from "./player";
import { createSkillRunState, resolveSlot, updateSkills } from "./skills";
import { applyStatus, findStatus, hasStatus, statusStacks, updateStatusEffects } from "./statusEffects";
import { scaled } from "./attributes";
import { attackHitManaMul } from "./manaSources";
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

function tough(state: GameState, dx: number, dy = 0): Enemy {
  const e = placeEnemy(state, "golem", dx, dy);
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

/** 発動 1 回ぶんの params（戦意を溜められる回数を発動ごとに作り直す。castSlot と同じ） */
function freshCast(params: CastParams): CastParams {
  return { ...params, moraleGain: { left: 1 } };
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
    for (let i = 0; i < FORM.tome.releaseMin; i++) hit(state, e, freshCast(params), false);
    expect(state.player.morale.value, "スキルの発動の数だけ術").toBeCloseTo(FORM.tome.releaseMin * FORM.tome.gain.skillHit);

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

  it("多段・複数の敵に当たっても、術はスキルの発動 1 回につき 1 度だけ溜まる", () => {
    const state = skillArena({ moveset: "book" }, ["mines"]);
    const a = tough(state, 200);
    const b = tough(state, 200, 40);
    const params = freshCast(paramsOf(state));
    hit(state, a, params, false);
    hit(state, a, params, false);
    hit(state, b, params, false);
    expect(state.player.morale.value, "1 回の発動で 1 度").toBeCloseTo(FORM.tome.gain.skillHit);
    const echo = { ...params };
    hit(state, b, echo, false);
    expect(state.player.morale.value, "反響などの写しは元の発動と回数を共有").toBeCloseTo(FORM.tome.gain.skillHit);
    hit(state, a, freshCast(params), false);
    expect(state.player.morale.value, "次の発動でまた 1 度").toBeCloseTo(FORM.tome.gain.skillHit * 2);
  });

  it("無詠唱で撃ったスキルの命中では術が溜まらない", () => {
    const state = skillArena({ moveset: "book" }, ["mines"]);
    run(state, { skill1Pressed: true });
    expect(state.skills.mines.at(-1)?.params.moraleGain, "ふつうに撃った発動は溜められる").not.toBeNull();
    settle(state);
    state.player.mana = state.stats.maxMana;
    state.skills.freeCast = true;
    for (let i = 0; i < 120 && state.skills.freeCast; i++) run(state, { skill1Pressed: true });
    expect(state.skills.freeCast, "無詠唱を使った").toBe(false);
    const params = state.skills.mines.at(-1)?.params;
    if (!params) throw new Error("地雷を置いていない");
    expect(params.moraleGain, "無詠唱の発動は溜めない印").toBeNull();
    hit(state, tough(state, 200), params, false);
    expect(state.player.morale.value).toBe(0);
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
    expect(state.player.morale.value, "放出で動かした地雷の命中では鈴音が溜まらない").toBe(0);
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

// ---------------------------------------------------------------------------
// 書の専用の印「墨印」（docs/ideas/tome-rework.md 7 章。system/inkMark.ts）
// ---------------------------------------------------------------------------

/** 書の左の字（cast inkGlyph）が記す墨印（movesets/book.json の cast の applies と同じ） */
function inkApply(): StatusApply {
  const apply = MOVESETS.book.steps[0]?.cast?.throw.applies?.find((a) => a.kind === "inkMark");
  if (!apply) throw new Error("書の左 1 段目の字が墨印を記さない");
  return apply;
}

function ink(state: GameState, e: Enemy, stacks: number): void {
  applyStatus(state, { kind: "enemy", enemy: e }, { ...inkApply(), stacks }, "player");
}

/** 小さな敵（硬く、攻めてこない）。左の字は約 10m（100px）まで飛ぶので、その内側に置く */
function near(state: GameState, dx: number, dy = 0): Enemy {
  // 動かない的（訓練人形）: 振りが遅くなって連撃が長くなっても、的が寄ってきて距離が変わらない
  const e = placeEnemy(state, "trainingDummy", dx, dy);
  e.hp = TOUGH_HP;
  e.maxHp = TOUGH_HP;
  e.attackCooldown = NO_ATTACK_COOLDOWN;
  e.phase = "idle";
  return e;
}

/** 自分の弾（左の字）が飛んでいる数 */
function glyphsInFlight(state: GameState): number {
  return state.projectiles.filter((pr) => pr.owner === "player" && pr.life > 0).length;
}

/** 弾も動かす 1 ステップ（左の字は弾なので、updatePlayer だけでは飛ばない） */
function tick(state: GameState, input: Partial<FrameInput> = {}): void {
  step(state, withInput(input), FIXED_DT);
}

/** 振りが終わり、飛んだ字が当たるか消えるまで進める */
function settleFull(state: GameState): void {
  for (let i = 0; i < 180 && (state.player.attack.phase !== "none" || glyphsInFlight(state) > 0); i++) tick(state);
}

/** 左を 1 回押して振り終え、字が当たるか消えるまで進める */
function swingLeft(state: GameState): void {
  tick(state, { attackPressed: true });
  settleFull(state);
}

/**
 * 左を count 回、段を進めて続けて押す（振りの recover に次を押す）。字が消えるまで進め、
 * target の墨印が増えたフレームの気力の増えを順に返す
 */
function chainLeft(state: GameState, count: number, target?: Enemy, onTick?: () => void): number[] {
  const gains: number[] = [];
  let pressed = 0;
  let armed = false;
  for (let i = 0; i < 600; i++) {
    const phase = state.player.attack.phase;
    if (phase === "active") armed = true;
    const press = pressed === 0 || (pressed < count && phase === "recover" && armed);
    if (press) {
      pressed += 1;
      armed = false;
    } else if (pressed >= count && phase === "none" && glyphsInFlight(state) === 0) {
      break;
    }
    const mana = state.player.mana;
    const stacks = target ? statusStacks(target.status, "inkMark") : 0;
    tick(state, press ? { attackPressed: true } : {});
    onTick?.();
    if (target && statusStacks(target.status, "inkMark") > stacks) gains.push(state.player.mana - mana);
  }
  return gains;
}

/** on-hit の最中に回した反応のダメージを流す */
function flush(state: GameState): void {
  updateStatusEffects(state, FIXED_DT);
}

function recited(events: readonly GameEvent[]): boolean {
  return events.some((ev) => ev.kind === "onReaction" && ev.tag === "recite");
}

describe("書（墨印）", () => {
  it("左 3 段の字の命中で墨印が 3 重なり、上限で止まる", () => {
    const state = arena(5, { moveset: "book" });
    const e = near(state, 30);
    const gains = chainLeft(state, 3, e);
    expect(gains, "3 段が 1 回ずつ記す").toHaveLength(3);
    expect(statusStacks(e.status, "inkMark"), "3 段で 3 重ね").toBe(3);
    expect(STATUS.inkMark.maxStacks, "左 3 段で満ちる").toBe(3);
    chainLeft(state, 1);
    expect(statusStacks(e.status, "inkMark"), "上限").toBe(STATUS.inkMark.maxStacks);
  });

  it("右の 3 段とダッシュ攻撃では墨印が付かない", () => {
    const state = arena(5, { moveset: "book" });
    const e = near(state, 12);
    pressRightFirst(state);
    settle(state);
    for (let i = 1; i < MOVESETS.book.steps2.length; i++) {
      run(state, { shootHeld: true });
      settle(state);
    }
    expect(TOUGH_HP - e.hp, "右の段は当たっている").toBeGreaterThan(0);
    expect(statusStacks(e.status, "inkMark"), "右").toBe(0);

    const dashed = arena(5, { moveset: "book" });
    const d = near(dashed, MOVESETS.book.dashAttack.size / 2);
    const p = dashed.player;
    p.dashStrike = false;
    p.dashTimer = FIXED_DT / 2;
    p.dashAttackQueued = true;
    run(dashed, {});
    expect(p.dashStrike, "ダッシュ攻撃が出た").toBe(true);
    settle(dashed);
    expect(TOUGH_HP - d.hp, "ダッシュ攻撃は当たっている").toBeGreaterThan(0);
    expect(statusStacks(d.status, "inkMark"), "ダッシュ攻撃").toBe(0);
  });

  it("墨印の付いた敵にスキルを当てると読まれ、重ねの数で広がる円の中の敵すべてに威力と怯み値、気力が戻る", () => {
    const stacks = STATUS.inkMark.maxStacks;
    const radius = inkReadRadius(stacks);
    const state = skillArena({ moveset: "book" }, ["mines"]);
    const marked = tough(state, 200);
    const inside = tough(state, 200, radius - 4);
    const outside = tough(state, 200, radius + 60);
    ink(state, marked, stacks);
    const potency = findStatus(marked.status, "inkMark")?.potency ?? 0;
    expect(potency, "墨印の威力").toBeGreaterThan(0);
    const control = skillArena({ moveset: "book" }, ["mines"]);
    const plain = tough(control, 200);
    state.player.mana = 0;
    control.player.mana = 0;
    state.events.length = 0;

    hit(state, marked, paramsOf(state), false);
    const events = [...state.events];
    hit(control, plain, paramsOf(control), false);
    flush(state);
    flush(control);

    expect(statusStacks(marked.status, "inkMark"), "読んだら消える").toBe(0);
    expect(recited(events), "反応「読誦」").toBe(true);
    const extra = Math.round(potency * stacks);
    expect(TOUGH_HP - marked.hp - (TOUGH_HP - plain.hp), "印の敵への上乗せ").toBe(extra);
    expect(TOUGH_HP - inside.hp, "円の中の敵").toBe(extra);
    expect(outside.hp, "円の外の敵").toBe(TOUGH_HP);
    expect(inside.poise.damage, "円の中の敵に怯み値").toBeGreaterThan(0);
    expect(state.player.mana - control.player.mana, "重ねの数だけ気力").toBeCloseTo(STATUS.inkMark.manaPerStack * stacks * state.stats.manaGainMul);
  });

  it("重ねが少ないほど円が狭い", () => {
    expect(inkReadRadius(1)).toBeLessThan(inkReadRadius(STATUS.inkMark.maxStacks));
    const state = skillArena({ moveset: "book" }, ["mines"]);
    const marked = tough(state, 200);
    const between = near(state, 200);
    // 体の縁が 1 重ねの円のすぐ外、3 重ねの円の内
    between.body.pos.y += inkReadRadius(1) + between.body.radius + 2;
    expect(inkReadRadius(1) + between.body.radius * 2 + 2, "3 重ねなら届く位置").toBeLessThan(inkReadRadius(STATUS.inkMark.maxStacks));
    ink(state, marked, 1);
    hit(state, marked, paramsOf(state), false);
    flush(state);
    expect(statusStacks(marked.status, "inkMark"), "読まれた").toBe(0);
    expect(between.hp, "1 重ねの円の外").toBe(TOUGH_HP);
  });

  it("左の字（射撃）の命中では読まれない（記すだけ）", () => {
    const state = arena(5, { moveset: "book" });
    const e = near(state, 30);
    ink(state, e, 2);
    chainLeft(state, 1);
    expect(statusStacks(e.status, "inkMark"), "左の命中は重ねる").toBe(3);
    expect(e.status.lastReaction?.key, "読誦が起きない").not.toBe("recite");
  });

  it("左の 3 段は当たり判定を持たず、cast「墨文字」の字だけが当たる（墨印は字が記す）", () => {
    for (const s of MOVESETS.book.steps) {
      expect(s.cast?.key, "左の段は字を撃つ").toBe("inkGlyph");
      expect(s.cast?.name, "字の名前").toBe("墨文字");
      expect(s.size, "近接の当たり判定は無い").toBe(0);
      expect(s.applies ?? [], "墨印は字が記す").toHaveLength(0);
      expect(s.cast?.throw.applies?.some((a) => a.kind === "inkMark"), "字が墨印を記す").toBe(true);
      expect(s.cast?.throw.bullet.radius, "字の絵の基準の半径").toBe(3);
      expect(s.cast?.throw.attack.element, "属性を付けない（朱墨の配色のまま）").toBe("none");
    }
    // 体に重なる距離の敵にも、近接の判定では当たらない（字が当たって初めて傷が付く）
    const state = arena(5, { moveset: "book" });
    near(state, 10);
    tick(state, { attackPressed: true });
    for (let i = 0; i < 60 && state.player.attack.phase !== "recover"; i++) tick(state);
    expect(state.player.attack.hitIds.size, "振りの当たり判定には誰も入らない").toBe(0);
  });

  it("左の字の威力は、近接だった段の威力（係数 × meleeDamageScale）と同じ（火力は据え置き）", () => {
    for (const s of MOVESETS.book.steps) {
      const cast = s.cast;
      if (!cast) throw new Error("左の段が字を撃たない");
      const melee = scaled(DEFAULT_STATS, s.scaling);
      expect(scaled(DEFAULT_STATS, cast.throw.scaling), "段の基礎威力と字の基礎威力").toBeCloseTo(melee, 5);
    }
  });

  it("左 3 段目の字は貫通 +2 で、並ぶ敵に墨印を記す", () => {
    const state = arena(5, { moveset: "book" });
    // 発射時の貫通の数を、段ごとに弾から読む（1・2 段目は 0、3 段目は 2）
    const pierce: number[] = [];
    const seen = new Set<number>();
    chainLeft(state, 3, undefined, () => {
      for (const pr of state.projectiles) {
        if (pr.owner !== "player" || seen.has(pr.id)) continue;
        seen.add(pr.id);
        pierce.push(pr.pierceLeft);
      }
    });
    expect(pierce, "字は段ごとに 1 発").toEqual([0, 0, 2]);

    // 3 段目の字は、前後に並ぶ 2 体の両方に墨印を記す
    const duo = arena(5, { moveset: "book" });
    const front = near(duo, 30);
    const back = near(duo, 46);
    duo.player.attack.step = 2;
    duo.player.attack.inputTimer = WEAPON.chainWindow;
    chainLeft(duo, 1);
    expect([front, back].map((e) => statusStacks(e.status, "inkMark")), "3 段目は並ぶ敵を貫く").toEqual([1, 1]);
  });

  it("左の字の命中で段の気力（movesets/book.json の字の mana に武器の回収の素の倍率を掛けた量）が戻る", () => {
    const state = arena(5, { moveset: "book" });
    const e = near(state, 30);
    const unit = attackHitManaMul(state) * state.stats.manaGainMul * MANA.attackGainScale;
    expect(unit, "通常攻撃の気力の倍率が立っている").toBeGreaterThan(0);
    state.player.mana = 0;
    const gains = chainLeft(state, 3, e);
    expect(gains, "3 段が 1 回ずつ命中").toHaveLength(3);
    MOVESETS.book.steps.map((st) => st.cast?.throw.mana ?? st.mana).forEach((mana, i) => {
      expect(gains[i] ?? 0, `${i + 1} 段目の気力`).toBeGreaterThan(mana * unit - 0.01);
      expect(gains[i] ?? 0, `${i + 1} 段目の気力（自然回復の 1 フレームぶんを超えない）`).toBeLessThan(mana * unit + 0.3);
    });
  });

  it("左の字は約 10m（100px）で消える", () => {
    const state = arena(5, { moveset: "book" });
    tick(state, { attackPressed: true });
    let far = 0;
    const origin = { ...state.player.body.pos };
    for (let i = 0; i < 180 && glyphsInFlight(state) + (state.player.attack.phase === "windup" ? 1 : 0) > 0; i++) {
      for (const pr of state.projectiles) {
        if (pr.owner === "player" && pr.life > 0) far = Math.max(far, Math.hypot(pr.pos.x - origin.x, pr.pos.y - origin.y));
      }
      tick(state);
    }
    expect(far, "100px の手前では消えない").toBeGreaterThan(90);
    expect(far, "100px を大きく超えて飛ばない").toBeLessThan(115);
  });

  it("派生「頁飛ばし」（左右左）の頁の命中で読まれる", () => {
    const state = arena(5, { moveset: "book" });
    const e = near(state, 60);
    ink(state, e, STATUS.inkMark.maxStacks);
    tick(state, { attackPressed: true });
    settleFull(state);
    tick(state, { shootHeld: true });
    settleFull(state);
    tick(state, { attackPressed: true });
    expect(MOVESETS.book.branches[state.player.attack.branch]?.key, "頁飛ばしの派生").toBe("pageVolley");
    const hpBefore = e.hp;
    // 出来事はステップの終わりに捨てられるので、反応は敵の袋の lastReaction で見る
    for (let i = 0; i < 60 && hasStatus(e.status, "inkMark"); i++) step(state, withInput({}), FIXED_DT);
    expect(statusStacks(e.status, "inkMark"), "頁の命中で読まれた").toBe(0);
    expect(e.status.lastReaction?.key, "反応「読誦」").toBe("recite");
    expect(e.hp, "頁が当たった").toBeLessThan(hpBefore);
  });

  it("決定性: 同じ seed と同じ入力なら記して読んだ結果が同じ", () => {
    const play = (): { hp: number[]; mana: number; stacks: number[] } => {
      const state = skillArena({ moveset: "book" }, ["mines"]);
      const a = near(state, 30);
      const b = near(state, 30, 10);
      for (let i = 0; i < 3; i++) swingLeft(state);
      hit(state, a, paramsOf(state), false);
      for (let i = 0; i < 10; i++) step(state, withInput({}), FIXED_DT);
      return { hp: [a.hp, b.hp], mana: state.player.mana, stacks: [a, b].map((e) => statusStacks(e.status, "inkMark")) };
    };
    // スキル石の seed もそろえる
    const stoneSeed = seed;
    const first = play();
    seed = stoneSeed;
    expect(play()).toEqual(first);
  });
});
