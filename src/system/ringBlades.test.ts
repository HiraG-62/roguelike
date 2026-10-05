import { describe, expect, it } from "vitest";
import { step } from "../core/game";
import { FIXED_DT } from "../core/loop";
import type { Enemy, GameState, Projectile } from "../core/state";
import { dist } from "../core/vec";
import { FORM, PLAYER, ULTIMATE } from "../data/tuning";
import { ultimateDef } from "../data/ultimates";
import { formOf } from "../data/weaponForms";
import { type CastDef, MOVESETS, type ThrowArtDef } from "../data/weapons";
import { bulletDef } from "../loot/bullets";
import { moraleMax, moraleReleaseMin } from "./morale";
import { canStartParry } from "./parry";
import { emitVolley, isDashing } from "./player";
import { ringsInFlight } from "./projectiles";
import { emitArtVolley, emitCast } from "./weaponArts";
import { weaponHitName } from "../audio/weaponHitNames";
import { arena as baseArena, placeEnemy, withInput } from "./testHelpers";
import { TILE_SIZE, Tile, setTile } from "../map/grid";
import { tryUltimate, ultimateMoveset } from "./ultimates";

/** 戦輪の技の一式（docs/ideas/gun-bases-review.md 0-5・2-9）: 実際の弾・段・型の数値で、輪の飛び方・戻るまでの待ち・往復の戦意・大輪・奥義を確かめる */

const TOUGH_HP = 99999;
const NO_ATTACK_COOLDOWN = 99;
const MAX_STEPS = 600;
const RING_STATS = { moveset: "ringBlades", bullet: "ringBlades" } as const;
const FANG_STATS = { moveset: "ringBlades", bullet: "fangRings" } as const;

function arena(seed = 5, stats: Parameters<typeof baseArena>[1] = {}): GameState {
  const state = baseArena(seed, stats);
  const px = Math.floor(state.player.body.pos.x / TILE_SIZE);
  const py = Math.floor(state.player.body.pos.y / TILE_SIZE);
  for (let ty = py - 7; ty <= py + 7; ty++) {
    for (let tx = px - 13; tx <= px + 13; tx++) setTile(state.map, tx, ty, Tile.Floor);
  }
  return state;
}

function tough(e: Enemy): Enemy {
  e.attackCooldown = NO_ATTACK_COOLDOWN;
  e.hp = TOUGH_HP;
  e.maxHp = TOUGH_HP;
  return e;
}

function playerShots(state: GameState): Projectile[] {
  return state.projectiles.filter((p) => p.owner === "player" && p.life > 0);
}

/** 器の弾の最大射程（px）= 速さ × 寿命 */
function maxRangeOf(key: string): number {
  const b = bulletDef(key);
  return PLAYER.shoot.speed * b.speedMul * PLAYER.shoot.life * b.lifeMul;
}

/** 戦意あり用の弾の半径（テストで差し替える値） */
const RELEASE_RADIUS = 9;

/** 右の連撃の投げの cast（movesets/ringBlades.json の steps2） */
function comboCast(key: string): CastDef {
  for (const s of MOVESETS.ringBlades.steps2) {
    if (s.kind === "swing" && s.step.cast?.key === key) return s.step.cast;
  }
  throw new Error(`${key} の投げが無い`);
}

/** 右の連撃の投げの段の普段の弾 */
function comboThrow(key: string): ThrowArtDef {
  return comboCast(key).throw;
}

/** 左の射撃と同じ弾の出し方（レーンは左）。aim は照準の距離 */
function throwRings(state: GameState, key: string, aim?: number): Projectile[] {
  emitVolley(state, bulletDef(key), 0, aim, { damage: 1, recoil: false, lane: "primary" });
  return playerShots(state);
}

function runUntil(state: GameState, done: () => boolean): void {
  for (let i = 0; i < MAX_STEPS && !done(); i++) step(state, withInput({}), FIXED_DT);
  expect(done(), "条件に届いた").toBe(true);
}

function pressRight(state: GameState): void {
  step(state, withInput({ shootHeld: true }), FIXED_DT);
  step(state, withInput({}), FIXED_DT);
}

describe("輪刃: 上下 2 枚の弧", () => {
  it("1 回で上下 2 枚が出て、カーソルで交差し、弧で手元へ戻って消える", () => {
    const state = arena(5, RING_STATS);
    const origin = { ...state.player.body.pos };
    const aim = 50;
    const [up, down] = throwRings(state, "ringBlades", aim);
    expect(playerShots(state).length, "2 枚").toBe(2);
    if (!up?.shot?.arc || !down?.shot?.arc) throw new Error("弧の輪が出ていない");
    expect(up.shot.arc.to.x - origin.x, "カーソルの距離まで飛ぶ").toBeCloseTo(aim, 0);
    expect(up.shot.arc.side, "上下で弧の向きが逆").toBe(-down.shot.arc.side);
    expect(Math.abs(up.pos.y - down.pos.y), "口元が上下へずれる").toBeCloseTo(2 * (bulletDef("ringBlades").pair?.offset ?? 0));
    let crossed = false;
    for (let i = 0; i < MAX_STEPS && playerShots(state).length > 0; i++) {
      step(state, withInput({}), FIXED_DT);
      if (up.shot.arc.back && !crossed) {
        crossed = true;
        expect(dist(up.pos, down.pos), "折り返しはカーソルで交わる").toBeLessThan(3);
      }
    }
    expect(crossed, "帰りに入った").toBe(true);
    expect(playerShots(state).length, "手元へ戻って消えた").toBe(0);
  });

  it("カーソルが遠くても最大射程で折り返す。牙輪は輪刃より射程が短い", () => {
    const state = arena(5, RING_STATS);
    const origin = { ...state.player.body.pos };
    const [ring] = throwRings(state, "ringBlades", 5000);
    expect(ring?.shot?.arc?.to.x ?? 0, "輪刃の最大射程").toBeCloseTo(origin.x + maxRangeOf("ringBlades"), 0);
    const fangState = arena(5, FANG_STATS);
    const [fang] = throwRings(fangState, "fangRings", 5000);
    expect(fang?.shot?.arc?.to.x ?? 0, "牙輪の最大射程").toBeCloseTo(fangState.player.body.pos.x + maxRangeOf("fangRings"), 0);
    expect(maxRangeOf("fangRings")).toBeLessThan(maxRangeOf("ringBlades"));
  });

  it("投げは風を切る音、輪の命中は斬撃の命中音（弾の命中音ではない）", () => {
    const state = arena(5, RING_STATS);
    // 2 枚はカーソルで交わるので、カーソルの上の敵に当たる
    const foe = tough(placeEnemy(state, "boar", 60));
    const foePos = { ...foe.body.pos };
    throwRings(state, "ringBlades", 60);
    expect(state.sfx, "投げの音").toContain("shotWarRing");
    let heard: string[] = [];
    for (let i = 0; i < MAX_STEPS && foe.hp === TOUGH_HP; i++) {
      state.sfx.length = 0;
      step(state, withInput({}), FIXED_DT);
      foe.body.pos = { ...foePos };
      heard = [...state.sfx];
    }
    expect(foe.hp, "当たった").toBeLessThan(TOUGH_HP);
    expect(heard, "斬撃の命中音").toContain(weaponHitName("ringBlades", "light"));
    expect(heard, "弾の命中音は鳴らさない").not.toContain("bulletHit");
  });

  it("左の押しっぱなしで 2 枚投げる（反動で押されない）", () => {
    const state = arena(5, RING_STATS);
    const before = { ...state.player.body.pos };
    step(state, withInput({ attackHeld: true, attackPressed: true }), FIXED_DT);
    expect(playerShots(state).length, "2 枚").toBe(2);
    expect(dist(state.player.body.pos, before), "輪を投げても体は動かない").toBeLessThan(1);
  });
});

describe("牙輪: 食い込んで 4 回", () => {
  it("当てた最初の敵に食い込み 0.4 秒回って 4 回当たってから、弧で戻る", () => {
    const state = arena(5, FANG_STATS);
    const foe = tough(placeEnemy(state, "boar", 40));
    // 2 枚はカーソル（敵の位置）で交わるので、どちらも敵に届く
    const rings = throwRings(state, "fangRings", 40);
    const { sec, hits } = bulletDef("fangRings").grind ?? { sec: 0, hits: 0 };
    expect(sec, "食い込みの時間がある").toBeGreaterThan(0);
    expect(hits, "食い込みが複数回当たる").toBeGreaterThan(1);
    let grinding = 0;
    let wentBack = false;
    for (let i = 0; i < MAX_STEPS && playerShots(state).length > 0; i++) {
      step(state, withInput({}), FIXED_DT);
      if (rings.some((r) => r.shot?.grind?.targetId === foe.id)) grinding += 1;
      if (rings.some((r) => r.shot?.arc?.back)) wentBack = true;
    }
    const done = rings.map((r) => r.shot?.grind?.done ?? 0);
    expect(Math.max(...done), "食い込んだ輪は 4 回当たった").toBe(hits);
    expect(grinding * FIXED_DT, "食い込んでいる間は止まっている").toBeGreaterThan(sec * 0.8);
    expect(foe.hp, "当たっている").toBeLessThan(TOUGH_HP);
    expect(wentBack, "当て終えたら戻る").toBe(true);
    expect(playerShots(state).length, "手元へ戻って消えた").toBe(0);
  });

  it("連撃の投げ（近投げ・強化投げ）も牙輪なら食い込み、輪刃なら食い込まない", () => {
    for (const key of ["ringToss", "ringHurl"]) {
      const fang = arena(5, FANG_STATS);
      expect(emitArtVolley(fang, comboThrow(key)), key).toBe(true);
      const fangRings = playerShots(fang);
      expect(fangRings.length, key).toBeGreaterThan(0);
      for (const r of fangRings) expect(r.shot?.grind?.hits, `${key} は牙輪の食い込み`).toBe(bulletDef("fangRings").grind?.hits);
      const ring = arena(5, RING_STATS);
      emitArtVolley(ring, comboThrow(key));
      for (const r of playerShots(ring)) expect(r.shot?.grind, `${key} は輪刃では食い込まない`).toBeUndefined();
    }
  });

  it("食い込みを当て切った敵 1 体を往復に数える（帰りに同じ敵へ当て直せない代わり）", () => {
    const state = arena(5, FANG_STATS);
    tough(placeEnemy(state, "boar", 40));
    throwRings(state, "fangRings", 40);
    runUntil(state, () => playerShots(state).length === 0);
    expect(state.player.morale.value, "2 枚とも同じ敵に食い込んでも 1 体で 1").toBe(1);
  });

  it("輪刃は食い込まず、貫いて通り抜ける", () => {
    expect(bulletDef("ringBlades").grind).toBeUndefined();
    expect(bulletDef("ringBlades").pierceBonus, "輪刃は貫く").toBeGreaterThan(0);
  });
});

describe("戻るまで投げられず、右も出ない", () => {
  it("輪が飛んでいる間は左を押しても投げられず、戻ったら投げられる", () => {
    const state = arena(5, RING_STATS);
    step(state, withInput({ attackHeld: true, attackPressed: true }), FIXED_DT);
    expect(ringsInFlight(state), "飛んでいる").toBe(true);
    const thrown = playerShots(state).length;
    for (let i = 0; i < 20; i++) step(state, withInput({ attackHeld: true }), FIXED_DT);
    expect(playerShots(state).length, "押しっぱなしでも増えない").toBeLessThanOrEqual(thrown);
    runUntil(state, () => !ringsInFlight(state));
    step(state, withInput({ attackHeld: true }), FIXED_DT);
    expect(playerShots(state).length, "戻ったら投げられる").toBe(thrown);
  });

  it("輪が飛んでいる間は右の輪払いも出ないが、受け流しとダッシュは出せる", () => {
    const state = arena(5, RING_STATS);
    step(state, withInput({ attackHeld: true, attackPressed: true }), FIXED_DT);
    expect(ringsInFlight(state)).toBe(true);
    pressRight(state);
    expect(state.player.attack.phase, "右を押しても振らない").toBe("none");
    expect(canStartParry(state), "受け流しは出せる").toBe(true);
    step(state, withInput({ dashPressed: true, move: { x: 0, y: 1 } }), FIXED_DT);
    expect(isDashing(state.player), "ダッシュは出せる").toBe(true);
  });

  it("戻ったら右の連撃が出る", () => {
    const state = arena(5, RING_STATS);
    throwRings(state, "ringBlades", 40);
    runUntil(state, () => !ringsInFlight(state));
    pressRight(state);
    expect(state.player.attack.phase, "戻ってから振る").not.toBe("none");
  });
});

describe("近投げの戻り待ち", () => {
  /** 右の連撃の 2 段目（近投げ）を出して、輪が飛んでいる間に振りが終わるまで進める */
  function tossAndFinish(state: GameState): void {
    pressRight(state);
    // 輪払いの振りの最中に次を押して先行入力を残す（先行入力は振りの active / recover の間だけ受ける）
    runUntil(state, () => state.player.attack.phase === "active");
    pressRight(state);
    runUntil(state, () => ringsInFlight(state));
    runUntil(state, () => state.player.attack.phase === "none");
  }

  it("近投げは短い固定の射程で 1 枚を投げ、輪が戻るまで次の段（輪払い）へ進まない", () => {
    const state = arena(5, RING_STATS);
    tossAndFinish(state);
    const a = state.player.attack;
    expect(ringsInFlight(state), "輪はまだ飛んでいる").toBe(true);
    expect(playerShots(state).length, "近投げは 1 枚").toBe(1);
    expect(a.step, "次の段（輪払い）を覚えて待つ").toBe(2);
    pressRight(state);
    expect(a.phase, "戻るまで右を押しても振らない").toBe("none");
    runUntil(state, () => !ringsInFlight(state));
    expect(a.step, "戻るまで窓は減らない").toBe(2);
    pressRight(state);
    expect(a.phase, "戻ってから輪払い").not.toBe("none");
    expect(a.step, "2 段目の輪払い").toBe(2);
  });

  it("近投げの輪は固定の射程で、カーソルが遠くても近い所で折り返す", () => {
    const state = arena(5, RING_STATS);
    state.player.aimDistance = 5000;
    tossAndFinish(state);
    const [ring] = playerShots(state);
    const range = MOVESETS.ringBlades.steps2.flatMap((s) => (s.kind === "swing" && s.key === "ringToss" ? [s.step.cast?.throw.bullet.arc?.range ?? 0] : []))[0] ?? 0;
    expect(range, "固定の射程がある").toBeGreaterThan(0);
    expect(ring?.shot?.arc ? dist(ring.shot.arc.to, state.player.body.pos) : 0, "折り返しは固定の射程").toBeLessThan(range + 20);
  });
});

describe("往復の戦意", () => {
  it("行きと帰りの両方で当てた敵 1 体につき +1（1 体に何度当たっても 1）", () => {
    const state = arena(5, RING_STATS);
    // 上下の弧の両側に 1 体ずつ（行きは片方の輪が、帰りは反対側を通るもう片方の輪が通る）
    tough(placeEnemy(state, "boar", 34, 9));
    tough(placeEnemy(state, "boar", 34, -9));
    // 弧から遠い敵は往復にならない
    tough(placeEnemy(state, "boar", 34, 80));
    throwRings(state, "ringBlades", 60);
    runUntil(state, () => playerShots(state).length === 0);
    expect(state.player.morale.value, "往復で当てた 2 体").toBe(2);
  });

  it("行きだけで当てた敵は数えない（輪の届かない奥の敵）", () => {
    const state = arena(5, RING_STATS);
    const near = tough(placeEnemy(state, "boar", 34, 9));
    // 片側の弧だけに敵がいても、帰りに反対側の輪が同じ側を通るので往復になる。弧の外側の敵は数えない
    tough(placeEnemy(state, "boar", 34, 70));
    throwRings(state, "ringBlades", 60);
    // 敵が歩いて帰りの弧から外れないよう、位置を固定する
    const foePos = { ...near.body.pos };
    for (let i = 0; i < MAX_STEPS && playerShots(state).length > 0; i++) {
      step(state, withInput({}), FIXED_DT);
      near.body.pos = { ...foePos };
      near.knock = { x: 0, y: 0 };
    }
    expect(state.player.morale.value, "弧の上の 1 体だけ").toBe(1);
  });

  it("戦意は 4 で満ち、満ちた後の強化投げが放出になる", () => {
    const state = arena(5, RING_STATS);
    expect(moraleMax(state), "上限").toBe(4);
    expect(formOf(MOVESETS.ringBlades).morale.release, "放出は右の強化投げ").toEqual({ kind: "laneStep", keys: ["ringHurl"] });
    expect(moraleReleaseMin(state), "満ちるのは 4").toBe(4);
  });
});

describe("放出の投げの手応え（releaseHit）", () => {
  const STOP = 20;
  const SHAKE = 15;

  /** 強化投げの弾の手応えを差し替えて、カーソルの上の敵へ投げる。release を渡すと放出の投げ */
  function hitWith(release: boolean): GameState {
    const state = arena(5, RING_STATS);
    const foe = tough(placeEnemy(state, "boar", 60));
    const pin = { ...foe.body.pos };
    const t = comboCast("ringHurl").releaseThrow ?? comboThrow("ringHurl");
    const throwDef: ThrowArtDef = { ...t, bullet: { ...t.bullet, releaseHit: { hitstop: STOP, shake: SHAKE } } };
    emitArtVolley(state, throwDef, release ? { release: { finisher: true, crit: false } } : {});
    for (let i = 0; i < MAX_STEPS && foe.hp === TOUGH_HP; i++) {
      state.hitstop = 0;
      state.camera.shake = 0;
      step(state, withInput({}), FIXED_DT);
      foe.body.pos = { ...pin };
    }
    expect(foe.hp, "当たった").toBeLessThan(TOUGH_HP);
    return state;
  }

  it("放出の投げの命中は releaseHit のヒットストップと画面揺れまで底上げする", () => {
    const state = hitWith(true);
    expect(state.hitstop, "ヒットストップ").toBe(STOP);
    expect(state.camera.shake, "画面揺れ").toBeGreaterThanOrEqual(SHAKE - 1);
  });

  it("放出でない投げには効かない", () => {
    const state = hitWith(false);
    expect(state.hitstop, "ヒットストップ").toBeLessThan(STOP);
    expect(state.camera.shake, "画面揺れ").toBeLessThan(SHAKE - 1);
  });

});

describe("戦意あり用の投げ（releaseThrow）", () => {
  /** 強化投げの cast の戦意あり用の弾だけ、枚数（2 枚投げを外して 1 枚）と半径を変える */
  function testCast(): CastDef {
    const c = comboCast("ringHurl");
    const rt = c.releaseThrow ?? c.throw;
    const { pair: _pair, ...single } = rt.bullet;
    return { ...c, releaseThrow: { ...rt, bullet: { ...single, radius: RELEASE_RADIUS } } };
  }

  it("放出の振りは戦意あり用の弾を投げ、放出でない振りは普段の弾を投げる", () => {
    const released = arena(5, RING_STATS);
    emitCast(released, testCast(), { release: { finisher: true, crit: false } });
    const big = playerShots(released);
    expect(big.length, "戦意あり用は 1 枚").toBe(1);
    expect(big[0]?.radius, "戦意あり用の半径").toBe(RELEASE_RADIUS);
    const plain = arena(5, RING_STATS);
    emitCast(plain, testCast(), {});
    expect(playerShots(plain).length, "普段は 2 枚").toBe(2);
  });

  it("強化投げの cast は戦意あり用の弾を持ち、弾の表にも別の key で載る", () => {
    const c = comboCast("ringHurl");
    expect(c.releaseThrow, "戦意あり用").toBeDefined();
    expect(bulletDef("cast.ringHurl.release").key).toBe("cast.ringHurl.release");
  });
});

describe("大輪（強化投げの放出）", () => {
  /** 戦意が満ちた状態で、右の連撃の 4 段目（強化投げ）を出す */
  function hurl(state: GameState, full: boolean): Projectile[] {
    if (full) state.player.morale.value = 4;
    state.player.attack.step = 3;
    state.player.attack.inputTimer = 1;
    pressRight(state);
    runUntil(state, () => playerShots(state).length > 0);
    return playerShots(state);
  }

  it("満ちていない強化投げは 2 枚の普通の輪、満ちていれば大輪が貫いて威力が増す", () => {
    const plain = arena(5, RING_STATS);
    const normal = hurl(plain, false);
    const full = arena(5, RING_STATS);
    const big = hurl(full, true);
    expect(normal.length, "強化投げは 2 枚").toBe(2);
    expect(big.length, "大輪も 2 枚").toBe(2);
    expect(normal[0]?.release, "普通の輪は放出でない").toBeUndefined();
    expect(big[0]?.release, "大輪は放出").toBeDefined();
    expect(big[0]?.pierceLeft ?? 0, "大輪は貫く").toBeGreaterThan((normal[0]?.pierceLeft ?? 0) + 50);
    expect(big[0]?.damage ?? 0, "大輪は威力が増す").toBeGreaterThan((normal[0]?.damage ?? 0) * 1.5);
    expect(full.player.morale.value, "戦意は使い切る").toBe(0);
  });

  it("大輪は放出の倍率（reachMul）のぶん半径が大きく、満ちていない輪は器の半径のまま", () => {
    const normal = hurl(arena(5, RING_STATS), false);
    const big = hurl(arena(5, RING_STATS), true);
    const base = normal[0]?.radius ?? 0;
    expect(base, "普通の輪は器の半径").toBeGreaterThan(0);
    expect(big[0]?.radius ?? 0, "大輪は半径が増える").toBeCloseTo(base * (1 + FORM.thrower.perUnit.reachMul * 4), 5);
    expect(big[0]?.radius ?? 0, "大輪は普通の輪より大きい").toBeGreaterThan(base);
  });

  it("大輪は敵の群れを貫いて全員に当たり、普通の輪は貫通が尽きると折り返す", () => {
    // 最初に傷を負わせたステップで何体に当たったか（折り返した後の帰りで残りに当たるので、そこまでは進めない）
    const hitCount = (full: boolean): number => {
      const state = arena(5, RING_STATS);
      // 弧の上に重ねた 6 体（同じステップに全員に当たる並び）
      const crowd = Array.from({ length: 6 }, () => tough(placeEnemy(state, "slime", 36, 9)));
      hurl(state, full);
      for (let i = 0; i < MAX_STEPS && crowd.every((e) => e.hp === TOUGH_HP); i++) step(state, withInput({}), FIXED_DT);
      return crowd.filter((e) => e.hp < TOUGH_HP).length;
    };
    expect(hitCount(true), "大輪は全員").toBe(6);
    expect(hitCount(false), "普通の輪は貫通の回数（2）+ 1 体で折り返す").toBe(3);
  });
});

describe("奥義（戦輪の 3 本）", () => {
  function ready(key: string): GameState {
    const state = arena(5, RING_STATS);
    state.profile.ultimates = { ringBlades: key };
    state.player.energy = ULTIMATE.common.cost;
    return state;
  }

  it("断頭輪: 巨大な輪を 1 本ゆっくり投げ、すべて貫き、戻りでも当たる", () => {
    const state = ready("ringBlades.headsman");
    const near = tough(placeEnemy(state, "boar", 60));
    expect(tryUltimate(state), "発動").toBe(true);
    const rings = playerShots(state);
    expect(rings.length, "1 本").toBe(1);
    const ring = rings[0];
    expect(ring?.radius ?? 0, "巨大").toBeGreaterThanOrEqual(10);
    expect(ring?.pierceLeft ?? 0, "すべて貫く").toBeGreaterThanOrEqual(99);
    expect(Math.hypot(ring?.vel.x ?? 0, ring?.vel.y ?? 0), "ゆっくり").toBeLessThan(PLAYER.shoot.speed * 0.8);
    let hitsOut = 0;
    let after = 0;
    const foePos = { ...near.body.pos };
    for (let i = 0; i < MAX_STEPS * 2 && playerShots(state).length > 0; i++) {
      step(state, withInput({}), FIXED_DT);
      // 当てた押しで敵が輪の道筋から外れないよう、位置を固定する
      near.body.pos = { ...foePos };
      near.knock = { x: 0, y: 0 };
      if (ring?.shot?.arc?.back !== true) hitsOut = TOUGH_HP - near.hp;
      after = TOUGH_HP - near.hp;
    }
    expect(hitsOut, "行きで当たる").toBeGreaterThan(0);
    expect(after, "戻りでも当たる").toBeGreaterThan(hitsOut);
    expect(playerShots(state).length, "手元へ戻って消える").toBe(0);
    expect(ringsInFlight(state), "奥義の輪は手を塞がない").toBe(false);
  });

  it("輪舞: 全周へ輪を 4 本。固定の距離まで飛んで弧で戻る", () => {
    const state = ready("ringBlades.ringDance");
    expect(tryUltimate(state)).toBe(true);
    const rings = playerShots(state);
    expect(rings.length, "4 本").toBe(4);
    const origin = state.player.body.pos;
    const angles = rings.map((r) => Math.round((Math.atan2((r.shot?.arc?.to.y ?? 0) - origin.y, (r.shot?.arc?.to.x ?? 0) - origin.x) * 180) / Math.PI));
    expect(new Set(angles).size, "向きがばらける").toBe(4);
    const ranges = rings.map((r) => (r.shot?.arc ? dist(r.shot.arc.to, origin) : 0));
    for (const range of ranges) expect(range, "固定の距離").toBeCloseTo(ranges[0] ?? 0, 0);
    runUntil(state, () => playerShots(state).length === 0);
  });

  it("輪の舞: 持続。振りが速く広くなり、1 回多く当たる", () => {
    const def = ultimateDef("ringBlades.ringWaltz");
    expect(def?.kind, "持続").toBe("sustain");
    const state = ready("ringBlades.ringWaltz");
    const base = MOVESETS.ringBlades;
    const sweep = (m: typeof base) => {
      const s = m.steps2.find((x) => x.key === "ringSweep");
      return s?.kind === "swing" ? s.step : undefined;
    };
    expect(tryUltimate(state)).toBe(true);
    const patched = ultimateMoveset(state, base);
    expect(patched.steps2.length, "段は変わらない").toBe(base.steps2.length);
    expect(sweep(patched)?.size ?? 0, "広い").toBeGreaterThan(sweep(base)?.size ?? 0);
    expect(sweep(patched)?.windup ?? 1, "速い").toBeLessThan(sweep(base)?.windup ?? 0);
    expect(sweep(patched)?.hits ?? 0, "1 回多く当たる").toBeGreaterThan(sweep(base)?.hits ?? 1);
  });
});
