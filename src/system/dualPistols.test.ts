import { describe, expect, it } from "vitest";
import { step } from "../core/game";
import type { FrameInput } from "../core/input";
import { FIXED_DT } from "../core/loop";
import type { GameState, Projectile } from "../core/state";
import { FORM, WEAPON } from "../data/tuning";
import { BULLETS } from "../loot/bullets";
import { handActionFor, handsView, nextHandAction } from "./dualPistols";
import { startReload, tickMagazine } from "./magazine";
import { moraleMax } from "./morale";
import { playerMoveset } from "./player";
import { arena, withInput } from "./testHelpers";

/**
 * 二丁拳銃の左右の手（docs/ideas/gun-bases-review.md 0-4・4-3 の 6）。左クリック = 左手・右クリック = 右手で 1 発ずつ、
 * 交互の拍・同じ手を続けた技・弾切れの手の銃把打ち・左右ほぼ同時の撃ち尽くし
 */

const BULLET = "twinPistols";
const H = WEAPON.movesets.gunner.hands;
/** 撃ち尽くしの猶予より長い、手と手の間（秒） */
const GAP_SEC = 0.35;

const stepsFor = (sec: number): number => Math.ceil(sec / FIXED_DT - 1e-9);

function run(state: GameState, input: Partial<FrameInput> = {}, n = 1): void {
  for (let i = 0; i < n; i++) step(state, withInput(input), FIXED_DT);
}

/** 弾倉を器の容量で作り直した二丁拳銃の稽古場 */
function gunnerArena(): GameState {
  const state = arena(5, { moveset: "gunner", bullet: BULLET });
  tickMagazine(state, withInput({}), 0);
  return state;
}

/** 左クリック（押した瞬間と押しっぱなし）の後、1 ステップ離す */
function left(state: GameState): void {
  run(state, { attackPressed: true, attackHeld: true });
  run(state);
}

/** 右クリック（前ステップとの差で押した瞬間を取るので、1 ステップ離す） */
function right(state: GameState): void {
  run(state, { shootHeld: true });
  run(state);
}

function gap(state: GameState, sec = GAP_SEC): void {
  run(state, {}, stepsFor(sec));
}

/** 振りが終わるまで進める */
function untilIdle(state: GameState): void {
  for (let i = 0; i < stepsFor(2) && state.player.attack.phase !== "none"; i++) run(state);
}

function playerShots(state: GameState): Projectile[] {
  return state.projectiles.filter((pr) => pr.owner === "player" && pr.life > 0);
}

function capacity(): number {
  const cap = BULLETS[BULLET]?.magazine?.capacity;
  if (cap === undefined) throw new Error(`${BULLET} に弾倉が無い`);
  return cap;
}

function rounds(state: GameState): [number, number] {
  const [l, r] = state.player.magazine.hands;
  return [l.rounds, r.rounds];
}

/** 今の振りの段の key（右レーンなら steps2 の key、左なら "steps.<添字>"） */
function swingKey(state: GameState): string | undefined {
  const a = state.player.attack;
  if (a.phase === "none") return undefined;
  if (a.lane === "primary") return `steps.${a.step}`;
  return playerMoveset(state).steps2[a.step]?.key;
}

describe("二丁拳銃の手（system/dualPistols.ts）", () => {
  it("左クリックは左手、右クリックは右手の弾倉で撃つ", () => {
    const state = gunnerArena();
    const cap = capacity();
    left(state);
    expect(rounds(state), "左手だけ 1 減る").toEqual([cap - 1, cap]);
    expect(playerShots(state)[0]?.lane, "左手の弾は左のレーン").toBe("primary");
    gap(state);
    right(state);
    expect(rounds(state), "右手も 1 減る").toEqual([cap - 1, cap - 1]);
    expect(playerShots(state).filter((pr) => pr.lane === "secondary").length, "右手の弾は右のレーン").toBeGreaterThan(0);
    expect(state.player.attack.phase, "射撃は振らない").toBe("none");
  });

  it("交互に撃つと拍が溜まり、同じ手で途切れる", () => {
    const state = gunnerArena();
    left(state);
    expect(state.player.morale.value, "最初の 1 発は交互に数えない").toBe(0);
    for (const press of [right, left, right]) {
      gap(state);
      press(state);
    }
    expect(state.player.morale.value, "左右を替えた 3 発で拍 3").toBe(3 * FORM.akimbo.gain.alternateShot);
    gap(state, 0.1);
    right(state);
    expect(state.player.morale.value, "同じ手が続くと拍は 0").toBe(0);
  });

  it("拍は上限 6 で頭打ち", () => {
    const state = gunnerArena();
    left(state);
    for (let i = 0; i < 10; i++) {
      gap(state);
      (i % 2 === 0 ? right : left)(state);
      // 弾倉が尽きて込めに入らないよう満たし直す
      for (const h of state.player.magazine.hands) {
        h.rounds = capacity();
        h.reloadLeft = 0;
      }
    }
    expect(moraleMax(state), "拍の上限").toBe(FORM.akimbo.max);
    expect(state.player.morale.value, "上限で止まる").toBe(FORM.akimbo.max);
  });

  it("同じ手の 2・3 回目は 左 = 蹴り → 回し蹴り、右 = 銃把打ち → 回転撃ち", () => {
    const l = gunnerArena();
    left(l);
    gap(l, 0.1);
    left(l);
    expect(swingKey(l), "左の 2 回目は蹴り（左の 1 段目）").toBe("steps.0");
    untilIdle(l);
    left(l);
    expect(swingKey(l), "左の 3 回目は回し蹴り（左の 2 段目）").toBe("steps.1");
    expect(l.player.attack.combo, "回し蹴りは終撃").toBe(2);

    const r = gunnerArena();
    right(r);
    gap(r, 0.1);
    right(r);
    expect(swingKey(r), "右の 2 回目は銃把打ち").toBe("gunnerButt");
    untilIdle(r);
    const before = playerShots(r).length;
    right(r);
    expect(playerShots(r).length, "右の 3 回目は回転撃ちで弾を撒く").toBeGreaterThan(before);
    expect(r.player.attack.phase, "回転撃ちは振らない").toBe("none");
  });

  it("回転撃ちは右手の残りを全周へ撒く", () => {
    const state = gunnerArena();
    const cap = capacity();
    right(state);
    gap(state, 0.1);
    right(state);
    untilIdle(state);
    right(state);
    const spin = playerShots(state).filter((pr) => pr.shot?.key === "art.spinShot");
    const perRound = playerMoveset(state).steps2.find((s) => s.key === "spinShot");
    const count = perRound?.kind === "volley" ? perRound.throw.count : 0;
    expect(spin.length, "右手の残り × 1 発あたりの弾数").toBe((cap - 1) * count);
    expect(rounds(state)[1], "右手の弾倉は空").toBe(0);
    expect(state.player.magazine.hands[1].reloadLeft, "右手は込めに入る").toBeGreaterThan(0);
    expect(rounds(state)[0], "左手はそのまま").toBe(cap);
    const quadrants = new Set(spin.map((pr) => `${Math.sign(Math.round(pr.vel.x))}:${Math.sign(Math.round(pr.vel.y))}`));
    expect(quadrants.size, "全周（四方）へ飛ぶ").toBeGreaterThanOrEqual(4);
  });

  it("空の手のクリックは銃把打ちで、込めは止まらない", () => {
    const state = gunnerArena();
    state.player.magazine.hands[0].rounds = 0;
    startReload(state, 0);
    const reloadBefore = state.player.magazine.hands[0].reloadLeft;
    expect(nextHandAction(state, 0), "空の左手は銃把打ち").toBe("empty");
    left(state);
    expect(swingKey(state), "弾切れの銃把打ちを振る").toBe("emptyHandStrike");
    expect(playerShots(state).length, "撃たない").toBe(0);
    untilIdle(state);
    const hand = state.player.magazine.hands[0];
    expect(hand.reloadLeft, "込めは振りの間も進む").toBeLessThan(reloadBefore);
    expect(hand.reloadLeft > 0 || hand.rounds === capacity(), "込めは止まらない").toBe(true);
  });

  it("猶予の中で左右を押すと両手の残りを扇に撃ち尽くし、両手とも込めに入る", () => {
    const state = gunnerArena();
    const cap = capacity();
    left(state);
    const perRound = playerShots(state).length;
    run(state, { shootHeld: true });
    expect(rounds(state), "両手とも空").toEqual([0, 0]);
    expect(state.player.magazine.hands.every((h) => h.reloadLeft > 0), "両手とも込める").toBe(true);
    expect(playerShots(state).length, "先の 1 発を含めて両手の弾倉ぶん").toBe(perRound * cap * 2);
    expect(handsView(state).lastHand, "撃ち尽くしで手の連続は切れる").toBeUndefined();
  });

  it("同じステップの左右も撃ち尽くし、猶予を過ぎた右はふつうの 1 発", () => {
    const same = gunnerArena();
    run(same, { attackPressed: true, attackHeld: true, shootHeld: true });
    expect(rounds(same), "同じステップの左右は撃ち尽くし").toEqual([0, 0]);

    const late = gunnerArena();
    const cap = capacity();
    left(late);
    run(late, {}, stepsFor(H.bothHandsSec) + 1);
    run(late, { shootHeld: true });
    expect(rounds(late), "猶予を過ぎたら右手の 1 発").toEqual([cap - 1, cap - 1]);
  });

  it("撃ち尽くしは拍の段ぶん強い（拍 0 でも撃てる）", () => {
    const plain = gunnerArena();
    left(plain);
    run(plain, { shootHeld: true });
    const plainShots = playerShots(plain);
    const base = Math.max(...plainShots.map((pr) => pr.damage));
    expect(plainShots.every((pr) => pr.release === undefined), "拍 0 は放出の弾にしない").toBe(true);

    const full = gunnerArena();
    full.player.morale.value = FORM.akimbo.max;
    left(full);
    run(full, { shootHeld: true });
    const strong = Math.max(...playerShots(full).map((pr) => pr.damage));
    expect(strong / base, "拍 6 の倍率").toBeCloseTo(1 + FORM.akimbo.perUnit.damageMul * FORM.akimbo.max, 5);
    expect(full.player.morale.value, "拍はすべて使う").toBe(0);
    expect(playerShots(full).some((pr) => pr.release !== undefined), "拍を使った撃ち尽くしは放出の弾").toBe(true);
  });

  it("連続の回数と弾の有無から出すものが決まる", () => {
    expect(handActionFor(0, 1, true)).toBe("shot");
    expect(handActionFor(1, 1, false)).toBe("empty");
    expect(handActionFor(0, 2, false), "蹴りは弾が無くても出る").toBe("kick");
    expect(handActionFor(0, 3, true)).toBe("roundKick");
    expect(handActionFor(1, 2, true)).toBe("butt");
    expect(handActionFor(1, 3, true)).toBe("spin");
    expect(handActionFor(1, 3, false), "右手が空なら回転撃ちの代わりに銃把打ち").toBe("empty");
  });
});
