import { describe, expect, it } from "vitest";
import type { GameEvent } from "../core/events";
import type { FrameInput } from "../core/input";
import { FIXED_DT } from "../core/loop";
import type { Enemy, GameState } from "../core/state";
import { MOMENT, PARRY, POISE, WEAPON } from "../data/tuning";
import { MOVESETS, meleeChargeOf } from "../data/weapons";
import { damageEnemy, damagePlayer } from "./combat";
import { noteRiposte } from "./moments";
import { currentMeleeStep, updatePlayer } from "./player";
import { isStaggered } from "./poise";
import { arena, engageStartRoom, placeEnemy, withInput } from "./testHelpers";

/**
 * 共通の瞬間（docs/ideas/weapon-forms-impl.md 3-3。system/moments.ts）: 先制・終撃・双撃・応手と、
 * 重さの補償の副次（3-5: 終撃の押し・堅守崩し）
 */

const TOUGH_HP = 99999;
const NO_ATTACK_COOLDOWN = 99;
const HIT = 10;
const SETTLE_STEPS = 120;

const stepsFor = (sec: number): number => Math.ceil(sec / FIXED_DT);

function tough(e: Enemy): Enemy {
  e.attackCooldown = NO_ATTACK_COOLDOWN;
  e.hp = TOUGH_HP;
  e.maxHp = TOUGH_HP;
  return e;
}

/** プレイヤーだけを n ステップ進め、その間のイベントを返す */
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

function count(events: readonly GameEvent[], kind: GameEvent["kind"]): number {
  return events.filter((e) => e.kind === kind).length;
}

/** その場で積まれたイベントを取り出して空にする */
function drain(state: GameState): GameEvent[] {
  const out = [...state.events];
  state.events.length = 0;
  return out;
}

/** 左の連撃を最後まで振る（振りの最中に次を予約し続ける） */
function comboToEnd(state: GameState): GameEvent[] {
  const out = run(state, { attackPressed: true });
  for (let i = 0; i < SETTLE_STEPS * 3 && state.player.attack.phase !== "none"; i++) {
    const a = state.player.attack;
    const press = (a.phase === "active" || a.phase === "recover") && !a.buffered;
    out.push(...run(state, press ? { attackPressed: true } : {}));
  }
  return out;
}

/** 溜めて最大段で離し、振りが終わるまで */
function chargeRelease(state: GameState, button: "primary" | "secondary"): GameEvent[] {
  const levels = meleeChargeOf(MOVESETS[state.stats.moveset])?.levels ?? [];
  const last = levels[levels.length - 1];
  if (!last) throw new Error("溜めが無い");
  const held = button === "primary" ? { attackHeld: true } : { shootHeld: true };
  const first = button === "primary" ? { attackPressed: true, attackHeld: true } : { shootHeld: true };
  const out = run(state, first).concat(run(state, held, stepsFor(last.time) + 2), run(state, {}));
  for (let i = 0; i < SETTLE_STEPS && state.player.attack.phase !== "none"; i++) out.push(...run(state, {}));
  return out;
}

describe("先制", () => {
  it("交戦の外の最初の一撃だけが先制で、続く一撃は先制でない", () => {
    const state = arena(5);
    const e = tough(placeEnemy(state, "slime", 40));
    damageEnemy(state, e, 1, { x: 1, y: 0 }, 0, { kind: "melee" });
    expect(count(drain(state), "onFirstStrike"), "最初の一撃").toBe(1);
    damageEnemy(state, e, 1, { x: 1, y: 0 }, 0, { kind: "ranged" });
    expect(count(drain(state), "onFirstStrike"), "続く一撃").toBe(0);
  });

  it("交戦中は戻らず、交戦の外で待つと次の一撃がまた先制になる", () => {
    const state = arena(5);
    const e = tough(placeEnemy(state, "slime", 40));
    damageEnemy(state, e, 1, { x: 1, y: 0 }, 0, { kind: "melee" });
    const engaged = engageStartRoom(state);
    run(state, {}, stepsFor(MOMENT.firstStrikeIdleSec) + 2);
    expect(state.player.moment.firstStrikeArmed, "交戦中は戻らない").toBe(false);
    state.enemies = state.enemies.filter((x) => x !== engaged);
    const room = state.rooms[0];
    if (room) room.engaged = false;
    run(state, {}, stepsFor(MOMENT.firstStrikeIdleSec) - 2);
    expect(state.player.moment.firstStrikeArmed, "待つ秒に届くまでは戻らない").toBe(false);
    run(state, {}, 4);
    expect(state.player.moment.firstStrikeArmed, "交戦の外で待った").toBe(true);
    drain(state);
    damageEnemy(state, e, 1, { x: 1, y: 0 }, 0, { kind: "melee" });
    expect(count(drain(state), "onFirstStrike")).toBe(1);
  });

  it("継続ダメージと素性なしの追撃は先制を使わない", () => {
    const state = arena(5);
    const e = tough(placeEnemy(state, "slime", 40));
    damageEnemy(state, e, 1, { x: 1, y: 0 }, 0, { kind: "proc" });
    damageEnemy(state, e, 1, { x: 1, y: 0 }, 0, { kind: "melee", silent: true });
    expect(count(drain(state), "onFirstStrike")).toBe(0);
    expect(state.player.moment.firstStrikeArmed).toBe(true);
  });
});

describe("終撃", () => {
  it("剣の連撃は最終段の命中だけが終撃", () => {
    const state = arena(5);
    tough(placeEnemy(state, "slime", 12));
    const events = comboToEnd(state);
    const swings = events.filter((e) => e.kind === "onSwing").map((e) => e.tag);
    expect(swings, "3 段振った").toEqual(["normal", "normal", "finisher"]);
    const lastSwingAt = events.findIndex((e) => e.kind === "onSwing" && e.tag === "finisher");
    const finishers = events.flatMap((e, i) => (e.kind === "onFinisher" ? [i] : []));
    expect(finishers.length, "最終段の命中").toBeGreaterThan(0);
    expect(finishers.every((i) => i > lastSwingAt), "最終段より前に終撃は出ない").toBe(true);
  });

  it("終撃の印の無い命中は終撃にならず、印があれば放出の一撃は tag release", () => {
    const state = arena(5);
    const e = tough(placeEnemy(state, "slime", 40));
    damageEnemy(state, e, 1, { x: 1, y: 0 }, 0, { kind: "melee" });
    expect(count(drain(state), "onFinisher")).toBe(0);
    damageEnemy(state, e, 1, { x: 1, y: 0 }, 0, { kind: "ranged", finisher: true, release: true });
    const fin = drain(state).filter((ev) => ev.kind === "onFinisher");
    expect(fin.map((ev) => ev.tag)).toEqual(["release"]);
  });
});

describe("双撃", () => {
  it("左右の違うレーンの命中が窓の中で続けば双撃、同じ側の連続では出ない", () => {
    const state = arena(5);
    const e = tough(placeEnemy(state, "slime", 40));
    const hit = (lane: "primary" | "secondary"): number => {
      damageEnemy(state, e, 1, { x: 1, y: 0 }, 0, { kind: "melee", lane });
      return count(drain(state), "onTwinStrike");
    };
    expect(hit("primary"), "1 発目").toBe(0);
    expect(hit("primary"), "同じ側").toBe(0);
    expect(hit("secondary"), "左 → 右").toBe(1);
    expect(hit("primary"), "右 → 左").toBe(1);
    state.time += MOMENT.twinStrikeWindowSec + 0.1;
    expect(hit("secondary"), "窓の外").toBe(0);
  });

  it("スキルとレーンの無い命中は双撃に数えない", () => {
    const state = arena(5);
    const e = tough(placeEnemy(state, "slime", 40));
    damageEnemy(state, e, 1, { x: 1, y: 0 }, 0, { kind: "melee", lane: "primary" });
    damageEnemy(state, e, 1, { x: 1, y: 0 }, 0, { kind: "melee", skill: true, lane: "secondary" });
    damageEnemy(state, e, 1, { x: 1, y: 0 }, 0, { kind: "ranged" });
    expect(count(drain(state), "onTwinStrike")).toBe(0);
  });

  it("剣の左の後の右（受け流しの後の返し斬り）の命中は双撃", () => {
    const state = arena(5);
    tough(placeEnemy(state, "slime", 12));
    const left = run(state, { attackPressed: true });
    for (let i = 0; i < SETTLE_STEPS && state.player.attack.phase !== "none"; i++) left.push(...run(state, {}));
    const a = state.player.attack;
    a.step = 1;
    a.inputTimer = WEAPON.chainWindow;
    const right = run(state, { shootHeld: true });
    for (let i = 0; i < SETTLE_STEPS && state.player.attack.phase !== "none"; i++) right.push(...run(state, {}));
    expect(count(right, "onTwinStrike"), "右の命中で双撃").toBeGreaterThan(0);
  });
});

describe("応手", () => {
  it("剣は受け流しで onRiposte（parry）を出し、既存の onCounter も並べて出す", () => {
    const state = arena(5);
    const e = tough(placeEnemy(state, "boar", 14));
    e.phase = "windup";
    state.player.parry.window = PARRY.windowSec;
    damagePlayer(state, HIT, e.body.pos, e);
    const events = drain(state);
    expect(events.filter((ev) => ev.kind === "onRiposte").map((ev) => ev.tag)).toEqual(["parry"]);
    expect(count(events, "onCounter"), "従来のカウンター扱い").toBe(1);
  });

  it("応手の一覧に無い出来事は onRiposte を出さない（連刃の受け流し）", () => {
    const state = arena(5, { moveset: "twinBlades" });
    const e = tough(placeEnemy(state, "boar", 14));
    e.phase = "windup";
    state.player.parry.window = PARRY.windowSec;
    damagePlayer(state, HIT, e.body.pos, e);
    const events = drain(state);
    expect(count(events, "onRiposte")).toBe(0);
    expect(count(events, "onCounter"), "既存の onCounter は型によらず出る").toBe(1);
  });

  it("見切りは onJustDodge と onRiposte（justDodge）を両方出す", () => {
    const state = arena(5, { moveset: "twinBlades" });
    const e = tough(placeEnemy(state, "boar", 14));
    state.player.dashTimer = 0.1;
    state.player.invulnTimer = 0.1;
    expect(damagePlayer(state, HIT, e.body.pos, e)).toBe("dodged");
    const events = drain(state);
    expect(count(events, "onJustDodge")).toBe(1);
    expect(events.filter((ev) => ev.kind === "onRiposte").map((ev) => ev.tag)).toEqual(["justDodge"]);
  });

  it("振りの中のカウンターの応手は 1 振り 1 回（複数の敵に当てても重ねない）", () => {
    const state = arena(5);
    for (const dy of [-4, 4]) {
      const e = tough(placeEnemy(state, "slime", 12, dy));
      e.phase = "windup";
      e.phaseTimer = 5;
    }
    const events = run(state, { attackPressed: true });
    for (let i = 0; i < SETTLE_STEPS && state.player.attack.phase !== "none"; i++) events.push(...run(state, {}));
    expect(count(events, "onCounter"), "2 体にカウンター").toBe(2);
    expect(events.filter((ev) => ev.kind === "onRiposte").map((ev) => ev.tag), "応手は 1 回").toEqual(["counter"]);
    expect(state.player.morale.value, "返しも 1").toBe(1);
  });

  it("盾の型は受けの応手だけを持つ（剣の応手の出来事では出ない）", () => {
    const state = arena(5, { moveset: "shield" });
    noteRiposte(state, "parry");
    noteRiposte(state, "guardBlock");
    expect(drain(state).filter((ev) => ev.kind === "onRiposte").map((ev) => ev.tag)).toEqual(["guardBlock"]);
  });
});

describe("重さの補償の副次", () => {
  it("重い武器の終撃は堅守を崩し、ノックバックが重さの倍率で伸びる", () => {
    const state = arena(5, { moveset: "greatsword" });
    const knight = tough(placeEnemy(state, "knight", 16));
    knight.phase = "chase";
    knight.facing = { x: -1, y: 0 };
    const levels = meleeChargeOf(MOVESETS.greatsword)?.levels ?? [];
    const last = levels[levels.length - 1];
    if (!last) throw new Error("大剣は溜めを持つ");
    run(state, { attackPressed: true, attackHeld: true });
    run(state, { attackHeld: true }, stepsFor(last.time) + 2);
    run(state, {});
    const step = currentMeleeStep(state);
    for (let i = 0; i < SETTLE_STEPS && knight.hp === TOUGH_HP; i++) run(state, {});
    const knock = Math.hypot(knight.knock.x, knight.knock.y);
    expect(knight.hp, "盾を崩して通る").toBeLessThan(TOUGH_HP);
    if (!step) throw new Error("溜め攻撃の段が無い");
    const knockMul = isStaggered(knight) ? 1 : POISE.knockbackUnstaggered;
    expect(knock, "終撃のノックバック").toBeCloseTo(step.knockback * WEAPON.weightClass.heavy.finisherKnockbackMul * knockMul);
  });

  it("中の重さの終撃（刀の居合）は堅守を崩さない", () => {
    const state = arena(5, { moveset: "katana" });
    const knight = tough(placeEnemy(state, "knight", 16));
    knight.phase = "chase";
    knight.facing = { x: -1, y: 0 };
    const events = chargeRelease(state, "secondary");
    expect(WEAPON.weightClass.medium.finisherGuardBreak).toBe(false);
    expect(events.filter((ev) => ev.kind === "onSwing").map((ev) => ev.tag), "居合を振った").toEqual(["finisher"]);
    expect(knight.poise.damage, "当たって盾で受けた（受けた怯み値が溜まる）").toBeGreaterThan(0);
    expect(knight.hp, "正面の終撃は防がれる").toBe(TOUGH_HP);
  });
});
