import { describe, expect, it } from "vitest";
import { step } from "../core/game";
import type { FrameInput } from "../core/input";
import { FIXED_DT } from "../core/loop";
import type { GameState, Projectile } from "../core/state";
import { WEAPON } from "../data/tuning";
import { BULLETS } from "../loot/bullets";
import type { PlayerStats } from "../loot/types";
import {
  canFireAny,
  canFireHand,
  gunNumbersOf,
  magazineView,
  packLevel,
  reloadMoveMul,
  startReload,
  tickMagazine,
  tryQuickReload,
} from "./magazine";
import { playerMoveset } from "./player";
import { arena, withInput } from "./testHelpers";

/**
 * 銃の弾倉（docs/ideas/gun-bases-review.md 0-3・2-8・4-3）。引き金の回数で数え、撃ち切ると込める。
 * 込めの最中は撃てず足が遅いが、近接は出せて込めは止まらない。短銃の早込め・砲の 1 発ずつと詰め・二丁拳銃の左右別の弾倉
 */

const stepsFor = (sec: number): number => Math.ceil(sec / FIXED_DT - 1e-9);

function press(state: GameState, input: Partial<FrameInput> = {}, n = 1): void {
  for (let i = 0; i < n; i++) step(state, withInput(input), FIXED_DT);
}

function playerShots(state: GameState): Projectile[] {
  return state.projectiles.filter((pr) => pr.owner === "player" && pr.life > 0);
}

/** 弾倉を作り直させた稽古場（arena は stats を直接書くので、1 回進めて器の弾倉にする） */
function gunArena(stats: Partial<PlayerStats>): GameState {
  const state = arena(5, stats);
  tickMagazine(state, withInput({}), 0);
  return state;
}

/** 再使用を空けて引き金を 1 回引く（押した瞬間 + 押しっぱなし） */
function fire(state: GameState): void {
  state.player.shootCooldown = 0;
  press(state, { attackPressed: true, attackHeld: true });
}

function capacityOf(bullet: string): number {
  const cap = BULLETS[bullet]?.magazine?.capacity;
  if (cap === undefined) throw new Error(`${bullet} に弾倉が無い`);
  return cap;
}

function reloadSecOf(bullet: string): number {
  const sec = BULLETS[bullet]?.magazine?.reloadSec;
  if (sec === undefined) throw new Error(`${bullet} に弾倉が無い`);
  return sec;
}

function hand0(state: GameState): GameState["player"]["magazine"]["hands"][0] {
  return state.player.magazine.hands[0];
}

describe("弾倉の数え方", () => {
  it("撃つと 1 減り、散弾の粒・三点の 3 本も引き金 1 回で 1 減る", () => {
    for (const bullet of ["pistol", "shotgun", "burstRifle"]) {
      const moveset = bullet === "shotgun" ? "cannon" : "sidearm";
      const state = gunArena({ moveset, bullet });
      fire(state);
      press(state, {}, stepsFor(0.3));
      expect(hand0(state).rounds, `${bullet}: 引き金 1 回で 1 減る`).toBe(capacityOf(bullet) - 1);
      expect(playerShots(state).length, `${bullet}: 弾は 1 発以上`).toBeGreaterThanOrEqual(1);
    }
    const spread = gunArena({ moveset: "cannon", bullet: "shotgun" });
    fire(spread);
    expect(playerShots(spread).length, "散弾は粒の数だけ").toBe(1 + (BULLETS.shotgun?.pellets ?? 0));
    const burst = gunArena({ moveset: "sidearm", bullet: "burstRifle" });
    fire(burst);
    press(burst, {}, stepsFor(0.3));
    expect(playerShots(burst).length, "三点は 3 本").toBe(BULLETS.burstRifle?.burst?.count);
  });

  it("銃でない武器種は弾倉が働かない（HUD も出さない）", () => {
    const state = gunArena({ moveset: "sword" });
    expect(magazineView(state).active, "剣は弾倉なし").toBe(false);
    expect(canFireAny(state), "数えない").toBe(true);
    expect(reloadMoveMul(state), "足も変わらない").toBe(1);
  });
});

describe("撃ち切りと込め", () => {
  it("撃ち切ると自動で込め、込めの秒の後に満タンになる。込めの最中は撃てない", () => {
    // 短銃の込めの最中の左は早込めなので、空撃ちは長銃で見る
    const state = gunArena({ moveset: "longarm", bullet: "crossbow" });
    const cap = capacityOf("crossbow");
    for (let i = 0; i < cap; i++) fire(state);
    expect(hand0(state).rounds, "撃ち切った").toBe(0);
    expect(hand0(state).reloadLeft, "自動で込め始める").toBeGreaterThan(0);
    expect(state.sfx, "込め始めの音").toContain("reloadStart");

    const shots = playerShots(state).length;
    fire(state);
    expect(playerShots(state).length, "込めの最中は撃てない").toBe(shots);
    expect(state.sfx, "空撃ちの音").toContain("dryFire");

    press(state, {}, stepsFor(reloadSecOf("crossbow")));
    expect(hand0(state).rounds, "満タン").toBe(cap);
    expect(hand0(state).reloadLeft, "込め終わり").toBe(0);
    expect(state.player.magazine.fresh, "込め終えてからの 1 発目").toBe(true);
    fire(state);
    expect(hand0(state).rounds, "また撃てる").toBe(cap - 1);
    expect(state.player.magazine.fresh, "撃ったら 1 発目ではない").toBe(false);
  });

  it("リロードを押すと満ちていない弾倉を込める（満ちていれば何もしない）", () => {
    const state = gunArena({ moveset: "longarm", bullet: "rifle" });
    press(state, { reloadPressed: true });
    expect(hand0(state).reloadLeft, "満ちていれば込めない").toBe(0);
    fire(state);
    press(state, { reloadPressed: true });
    expect(hand0(state).reloadLeft, "1 発撃てば込められる").toBeGreaterThan(0);
  });

  it("込めの最中は足が武器種の reloadMoveMul 倍", () => {
    const distance = (reloading: boolean): number => {
      const state = gunArena({ moveset: "longarm", bullet: "rifle" });
      if (reloading) {
        hand0(state).rounds = 0;
        startReload(state, 0);
      }
      const from = state.player.body.pos.x;
      press(state, { move: { x: 1, y: 0 } }, 10);
      return state.player.body.pos.x - from;
    };
    const mul = gunNumbersOf("longarm")?.reloadMoveMul;
    if (mul === undefined) throw new Error("長銃の reloadMoveMul が無い");
    expect(mul, "1 より遅い").toBeLessThan(1);
    expect(distance(true) / distance(false), "込めの最中の足").toBeCloseTo(mul, 2);
  });

  it("込めの最中も右の近接が出て、込めは止まらない", () => {
    const state = gunArena({ moveset: "longarm", bullet: "rifle" });
    hand0(state).rounds = 0;
    startReload(state, 0);
    const before = hand0(state).reloadLeft;
    press(state, { shootHeld: true });
    expect(state.player.attack.phase, "銃剣の振りが出る").not.toBe("none");
    expect(state.player.attack.lane, "右レーン").toBe("secondary");
    press(state, {}, 3);
    expect(hand0(state).reloadLeft, "込めは進む").toBeLessThan(before);
    press(state, {}, stepsFor(reloadSecOf("rifle")));
    expect(hand0(state).rounds, "振りながらでも込め終わる").toBe(capacityOf("rifle"));
  });

  it("弾が替わると新しい容量で満タンに作り直す（武器掛けの試用・持ち替え）", () => {
    const state = gunArena({ moveset: "sidearm", bullet: "pistol" });
    hand0(state).rounds = 1;
    state.stats = { ...state.stats, bullet: "smg" };
    expect(magazineView(state).hands[0]?.rounds, "HUD は作り直した後の満タンを見せる（state は書かない）").toBe(capacityOf("smg"));
    expect(hand0(state).rounds, "読むだけでは作り直さない").toBe(1);
    tickMagazine(state, withInput({}), FIXED_DT);
    expect(state.player.magazine.bulletKey, "新しい弾").toBe("smg");
    expect(hand0(state).rounds, "新しい容量で満タン").toBe(capacityOf("smg"));
  });

  it("銃でない武器種から同じ器の key の銃へ持ち替えても満タンで作り直す", () => {
    const state = gunArena({ moveset: "sidearm", bullet: "pistol" });
    hand0(state).rounds = 0;
    state.stats = { ...state.stats, moveset: "sword" };
    tickMagazine(state, withInput({}), FIXED_DT);
    state.stats = { ...state.stats, moveset: "sidearm" };
    tickMagazine(state, withInput({}), FIXED_DT);
    expect(hand0(state).rounds, "満タン").toBe(capacityOf("pistol"));
  });
});

describe("派生の弾と弾倉", () => {
  /** 左左右（三連射）。左の押下は撃たずに列へ積み、右で派生を出す */
  function tripleShot(rounds: number): GameState {
    const state = gunArena({ moveset: "sidearm", bullet: "pistol" });
    hand0(state).rounds = rounds;
    press(state, { attackPressed: true });
    press(state, { attackPressed: true });
    state.projectiles.length = 0;
    press(state, { shootHeld: true });
    const a = state.player.attack;
    expect(playerMoveset(state).branches[a.branch]?.key, "左左右の三連射").toBe("tripleShot");
    return state;
  }

  it("派生の弾は撃つ回数ぶん弾倉を減らす", () => {
    const count = WEAPON.movesets.sidearm.branches.tripleShot.shots.count;
    const state = tripleShot(capacityOf("pistol"));
    expect(hand0(state).rounds, "回数ぶん減る").toBe(capacityOf("pistol") - count);
    expect(playerShots(state).length, "回数ぶん撃つ").toBe(count);
  });

  it("足りなければ残りの分だけ撃ち、振りは出て弾倉は 0 になる", () => {
    const state = tripleShot(2);
    expect(playerShots(state).length, "残り 2 回だけ").toBe(2);
    expect(hand0(state).rounds, "弾倉は 0").toBe(0);
    expect(state.player.attack.phase, "振りは出る").not.toBe("none");
    expect(hand0(state).reloadLeft, "空になったので込める").toBeGreaterThan(0);
  });

  it("込めの最中の派生は弾を出さず、振りだけ出る", () => {
    const state = gunArena({ moveset: "sidearm", bullet: "pistol" });
    hand0(state).rounds = 0;
    startReload(state, 0);
    // 早込めを使い終えた込め（左が早込めに取られず、連撃の列に入る）
    state.player.magazine.quickTried = true;
    press(state, { attackPressed: true });
    press(state, { attackPressed: true });
    state.projectiles.length = 0;
    press(state, { shootHeld: true });
    expect(playerShots(state), "弾は出ない").toHaveLength(0);
    expect(state.player.attack.branch, "派生の振りは出る").toBeGreaterThanOrEqual(0);
  });
});

describe("砲: 1 発ずつ込めと詰め", () => {
  const cannon = { moveset: "cannon" as const, bullet: "shotgun" };
  const perRound = (): number => {
    const sec = BULLETS.shotgun?.magazine?.perRoundSec;
    if (sec === undefined) throw new Error("散弾銃に 1 発の秒が無い");
    return sec;
  };

  it("撃ち切ると 1 発ずつ込め、1 発込めた後なら込めを止めて撃てる", () => {
    const state = gunArena(cannon);
    hand0(state).rounds = 0;
    startReload(state, 0);
    expect(canFireHand(state, 0), "0 発のうちは撃てない").toBe(false);
    press(state, {}, stepsFor(perRound()));
    expect(hand0(state).rounds, "1 発込めた").toBe(1);
    expect(hand0(state).reloadLeft, "まだ込めている").toBeGreaterThan(0);
    expect(canFireHand(state, 0), "込めの最中でも撃てる").toBe(true);
    press(state, {}, stepsFor(perRound()));
    expect(hand0(state).rounds, "2 発目").toBe(2);
    fire(state);
    expect(playerShots(state).length, "撃てた").toBeGreaterThan(0);
    expect(hand0(state).rounds, "1 減る").toBe(1);
    expect(hand0(state).reloadLeft, "込めは止まる").toBe(0);
  });

  it("満ちた後もリロードを押し続けると 0.5 秒ごとに詰めが 1 段（最大 3）。詰めている間は撃てず足が遅い", () => {
    const pack = gunNumbersOf("cannon")?.pack;
    if (!pack) throw new Error("砲に詰めが無い");
    const state = gunArena(cannon);
    press(state, { reloadPressed: true, reloadHeld: true });
    press(state, { reloadHeld: true }, stepsFor(pack.levelSec));
    expect(packLevel(state), "1 段").toBe(1);
    expect(canFireAny(state), "詰めている間は撃てない").toBe(false);
    expect(reloadMoveMul(state), "足が遅い").toBe(gunNumbersOf("cannon")?.reloadMoveMul);
    expect(state.sfx, "詰めの音").toContain("packLevel");
    press(state, { reloadHeld: true }, stepsFor(pack.levelSec * (pack.max + 2)));
    expect(packLevel(state), "最大で止まる").toBe(pack.max);
    expect(canFireAny(state), "最大に届いたら撃てる").toBe(true);
    press(state, {});
    expect(packLevel(state), "離しても段は残る").toBe(pack.max);
    fire(state);
    expect(packLevel(state), "撃つと段は消える").toBe(0);
  });

  it("離すと詰めは止まり、撃てる", () => {
    const pack = gunNumbersOf("cannon")?.pack;
    if (!pack) throw new Error("砲に詰めが無い");
    const state = gunArena(cannon);
    press(state, { reloadPressed: true, reloadHeld: true }, stepsFor(pack.levelSec / 2));
    expect(canFireAny(state), "詰めている間").toBe(false);
    press(state, {});
    expect(canFireAny(state), "離したら撃てる").toBe(true);
    expect(packLevel(state), "段に届く前なら 0").toBe(0);
  });
});

describe("短銃: 早込め", () => {
  const sidearm = { moveset: "sidearm" as const, bullet: "pistol" };
  const quick = (): NonNullable<ReturnType<typeof gunNumbersOf>>["quickReload"] & object => {
    const q = gunNumbersOf("sidearm")?.quickReload;
    if (!q) throw new Error("短銃に早込めが無い");
    return q;
  };

  /** 撃ち切って込め始めてから sec 秒進める */
  function reloadFor(sec: number): GameState {
    const state = gunArena(sidearm);
    hand0(state).rounds = 0;
    startReload(state, 0);
    press(state, {}, stepsFor(sec));
    return state;
  }

  it("窓の中でリロードを押すと即込め終わり、決まった出来事が返る", () => {
    const q = quick();
    const state = reloadFor(reloadSecOf("pistol") * q.from + q.sec / 2);
    press(state, { reloadPressed: true });
    expect(hand0(state).rounds, "満タン").toBe(capacityOf("pistol"));
    expect(hand0(state).reloadLeft, "込め終わり").toBe(0);
    expect(state.sfx, "早込めの音").toContain("quickReload");
  });

  it("窓の中で左を押しても早込めで、その左は撃ちも連撃の列にも入らない", () => {
    const q = quick();
    const state = reloadFor(reloadSecOf("pistol") * q.from + q.sec / 2);
    state.player.attack.inputs.length = 0;
    press(state, { attackPressed: true });
    expect(hand0(state).rounds, "満タン").toBe(capacityOf("pistol"));
    expect(state.player.attack.inputs, "列に入らない").toHaveLength(0);
  });

  it("窓の外で押すと込めが missSec 延び、1 回の込めに 1 回だけ", () => {
    const q = quick();
    const state = reloadFor(0.1);
    const before = hand0(state).reloadLeft;
    expect(tryQuickReload(state), "外した").toBe("miss");
    expect(hand0(state).reloadLeft - before, "延びる").toBeCloseTo(q.missSec);
    expect(state.sfx, "外した音").toContain("quickMiss");
    expect(tryQuickReload(state), "2 回目は効かない").toBe("none");
    expect(magazineView(state).quickWindow, "押した後は窓の印を出さない").toBeNull();
  });

  it("込めていなければ早込めにならない。早込めは短銃だけ", () => {
    const state = gunArena(sidearm);
    expect(tryQuickReload(state), "込めていない").toBe("none");
    const rifle = gunArena({ moveset: "longarm", bullet: "rifle" });
    hand0(rifle).rounds = 0;
    startReload(rifle, 0);
    expect(tryQuickReload(rifle), "長銃は早込めなし").toBe("none");
  });

  it("HUD の窓の印は進みの from から sec 秒ぶん", () => {
    const q = quick();
    const state = reloadFor(0.1);
    const w = magazineView(state).quickWindow;
    expect(w?.from, "始まり").toBe(q.from);
    expect(w?.to, "終わり").toBeCloseTo(q.from + q.sec / reloadSecOf("pistol"));
  });
});

describe("二丁拳銃: 左右別の弾倉", () => {
  const gunner = { moveset: "gunner" as const, bullet: "twinPistols" };

  /** 右クリックで右手を 1 回撃つ（左とは撃ち尽くしの猶予より空けてから） */
  function fireRight(state: GameState): void {
    press(state, {}, stepsFor(0.1));
    press(state, { shootHeld: true });
    press(state);
  }

  it("左クリックは左手、右クリックは右手の弾倉を減らす", () => {
    const state = gunArena(gunner);
    const cap = capacityOf("twinPistols");
    fire(state);
    fireRight(state);
    const [left, right] = state.player.magazine.hands;
    expect(left.rounds, "手 0").toBe(cap - 1);
    expect(right.rounds, "手 1").toBe(cap - 1);
    expect(magazineView(state).hands, "HUD は 2 本").toHaveLength(2);
  });

  it("片手が込めている間ももう片手で撃てる", () => {
    const state = gunArena(gunner);
    hand0(state).rounds = 0;
    startReload(state, 0);
    expect(canFireHand(state, 0), "込めている手は撃てない").toBe(false);
    expect(canFireHand(state, 1), "もう片手は撃てる").toBe(true);
    const right = state.player.magazine.hands[1].rounds;
    fireRight(state);
    expect(playerShots(state).length, "撃てた").toBeGreaterThan(0);
    expect(state.player.magazine.hands[1].rounds, "撃ったのは手 1").toBe(right - 1);
  });

  it("リロードは満ちていない両手を込める", () => {
    const state = gunArena(gunner);
    fire(state);
    fireRight(state);
    press(state, { reloadPressed: true });
    expect(state.player.magazine.hands.every((h) => h.reloadLeft > 0), "両手とも込める").toBe(true);
  });
});
