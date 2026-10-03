import { describe, expect, it } from "vitest";
import type { Enemy, GameState, Projectile } from "../core/state";
import { dist } from "../core/vec";
import { PLAYER } from "../data/tuning";
import { FORMS, type FormDef, type FormKey } from "../data/weaponForms";
import type { BulletDef } from "../data/weapons";
import { bulletDef } from "../loot/bullets";
import { overlapsWall } from "./physics";
import { emitVolley } from "./player";
import { updateProjectiles } from "./projectiles";
import { arena, placeEnemy } from "./testHelpers";

/** 投げ物の飛び方（system/projectiles.ts）: 弧と 2 枚投げ・食い込み・投げの組（往復） */

const TOUGH_HP = 99999;
const NO_ATTACK_COOLDOWN = 99;
const STEP = 1 / 60;
/** 弧の最大射程（px）。寿命の倍率で決める（開始の部屋の壁に届かない長さ） */
const MAX_RANGE = 60;
const BULGE = 14;
const PAIR_OFFSET = 4;
const CATCH_RADIUS = 6;
const SAFETY_SEC = 5;
/** 壁を探す上限（px） */
const WALL_SEARCH = 2000;

function tough(e: Enemy): Enemy {
  e.attackCooldown = NO_ATTACK_COOLDOWN;
  e.hp = TOUGH_HP;
  e.maxHp = TOUGH_HP;
  return e;
}

function withFormGain(key: FormKey, gain: FormDef["morale"]["gain"], body: () => void): void {
  const forms = FORMS as Record<FormKey, FormDef>;
  const saved = forms[key];
  forms[key] = { ...saved, morale: { ...saved.morale, gain, derived: false } };
  try {
    body();
  } finally {
    forms[key] = saved;
  }
}

/** 輪刃の形: 上下 2 枚・弧で飛ぶ（最大射程 MAX_RANGE） */
function ringShot(over: Partial<BulletDef> = {}): BulletDef {
  return {
    ...bulletDef("pistol"),
    key: "test.ring",
    name: "試しの輪",
    speedMul: 1,
    lifeMul: MAX_RANGE / (PLAYER.shoot.speed * PLAYER.shoot.life),
    pierceBonus: 0,
    arc: { bulge: BULGE, catchRadius: CATCH_RADIUS },
    pair: { offset: PAIR_OFFSET },
    ...over,
  };
}

function rings(state: GameState): Projectile[] {
  return state.projectiles.filter((p) => p.owner === "player");
}

function throwAt(state: GameState, shot: BulletDef, aim: number | undefined): Projectile[] {
  emitVolley(state, shot, 0, aim, { damage: 1, recoil: false, lane: "primary" });
  return rings(state);
}

describe("弧で飛ぶ 2 枚投げ", () => {
  it("1 回で上下 2 枚が出て、カーソルで交差し、反対側の弧で手元へ戻って消える", () => {
    const state = arena();
    const origin = { ...state.player.body.pos };
    const aim = 40;
    const [up, down] = throwAt(state, ringShot(), aim);
    expect(up && down, "2 枚").toBeTruthy();
    if (!up || !down) return;
    expect(up.pos.y - down.pos.y, "口元が上下へずれる").toBeCloseTo(2 * PAIR_OFFSET);
    // 行きの半ばは別々の側を飛ぶ
    let outMid = false;
    let crossed = false;
    let backMid = false;
    for (let t = 0; t < SAFETY_SEC && rings(state).length > 0; t += STEP) {
      updateProjectiles(state, STEP);
      const a = up.shot?.arc;
      if (!a) break;
      if (!a.back && a.t > 0.45 && a.t < 0.55 && !outMid) {
        outMid = true;
        // 二次ベジエの半ばは頂点のふくらみの半分
        expect(up.pos.y, "side +1 の行きは下側").toBeGreaterThan(origin.y + BULGE / 4);
        expect(down.pos.y, "side -1 の行きは上側").toBeLessThan(origin.y - BULGE / 4);
      }
      if (a.back && !crossed) {
        crossed = true;
        expect(dist(up.pos, down.pos), "カーソルで交差").toBeLessThan(1);
        expect(up.pos.x - origin.x, "カーソルの距離").toBeCloseTo(aim, 0);
      }
      if (a.back && a.t > 0.45 && a.t < 0.55 && !backMid) {
        backMid = true;
        expect(up.pos.y, "帰りは反対側（上側）").toBeLessThan(origin.y - BULGE / 4);
      }
    }
    expect(outMid && crossed && backMid, "行き・交差・帰りを通った").toBe(true);
    expect(rings(state).length, "手元に戻って消える").toBe(0);
  });

  it("カーソルが最大射程より遠ければ最大射程で折り返す", () => {
    const state = arena();
    const origin = { ...state.player.body.pos };
    const [ring] = throwAt(state, ringShot({ pair: undefined }), 1000);
    expect(ring?.shot?.arc?.to.x ?? 0, "最大射程で頭打ち").toBeCloseTo(origin.x + MAX_RANGE, 0);
  });

  it("固定の射程があればカーソルに依らずその距離（連撃の近投げ）", () => {
    const state = arena();
    const origin = { ...state.player.body.pos };
    const [ring] = throwAt(state, ringShot({ pair: undefined, arc: { bulge: BULGE, catchRadius: CATCH_RADIUS, range: 25 } }), 55);
    expect(ring?.shot?.arc?.to.x ?? 0).toBeCloseTo(origin.x + 25, 0);
  });

  it("帰りの輪は動いた自分の位置へ戻る", () => {
    const state = arena();
    const [ring] = throwAt(state, ringShot({ pair: undefined }), 40);
    for (let t = 0; t < SAFETY_SEC && !ring?.shot?.arc?.back; t += STEP) updateProjectiles(state, STEP);
    state.player.body.pos = { x: state.player.body.pos.x, y: state.player.body.pos.y + 30 };
    let last = ring?.pos;
    for (let t = 0; t < SAFETY_SEC && rings(state).length > 0; t += STEP) {
      last = { ...(ring?.pos ?? { x: 0, y: 0 }) };
      updateProjectiles(state, STEP);
    }
    expect(rings(state).length).toBe(0);
    expect(last && dist(last, state.player.body.pos), "収まったのは今の自分の手元").toBeLessThan(CATCH_RADIUS + 10);
  });

  it.each([
    ["行き", false],
    ["帰り", true],
  ])("跳ね返されて敵の弾になった輪は、%sの弧の途中でも壁で消える（壁際に止まって残らず、壁も抜けない）", (_label, back) => {
    const state = arena();
    const [ring] = throwAt(state, ringShot({ pair: undefined }), 40);
    const arc = ring?.shot?.arc;
    expect(ring && arc, "弧の輪").toBeTruthy();
    if (!ring || !arc) return;
    // 反射（elites.ts の deflectProjectile）で敵の弾になり、自分から +x の最初の壁へ向かっている
    const p = state.player.body.pos;
    let x = p.x;
    while (!overlapsWall(state, x, p.y, ring.radius) && x < p.x + WALL_SEARCH) x += 1;
    ring.owner = "enemy";
    ring.pos = { x: x - 4, y: p.y };
    ring.vel = { x: 300, y: 0 };
    arc.back = back;
    for (let i = 0; i < 3; i++) updateProjectiles(state, STEP);
    expect(ring.life, "壁で消える").toBeLessThanOrEqual(0);
  });
});

describe("食い込む弾", () => {
  it("最初に当たった敵の位置で止まり、秒のあいだに回数ぶん当ててから弧で戻る（牙輪）", () => {
    const state = arena();
    const first = tough(placeEnemy(state, "boar", 30));
    const behind = tough(placeEnemy(state, "boar", 55));
    const hits = 4;
    const sec = 0.4;
    const [ring] = throwAt(state, ringShot({ pair: undefined, grind: { sec, hits } }), MAX_RANGE);
    const hp = first.hp;
    let grindSec = 0;
    let wentBack = false;
    for (let t = 0; t < SAFETY_SEC && rings(state).length > 0; t += STEP) {
      updateProjectiles(state, STEP);
      if (ring?.shot?.grind?.targetId !== undefined) {
        grindSec += STEP;
        expect(dist(ring.pos, first.body.pos), "敵の位置で止まる").toBeLessThan(0.01);
      }
      if (ring?.shot?.arc?.back) wentBack = true;
    }
    expect(ring?.shot?.grind?.targetId, "食い込みが終わった").toBeUndefined();
    expect(grindSec, "sec のあいだ止まる").toBeCloseTo(sec, 1);
    const perHit = hp - first.hp;
    expect(perHit, "当たっている").toBeGreaterThan(0);
    expect(behind.hp, "奥の敵には届かない").toBe(TOUGH_HP);
    expect(wentBack, "当て終えたら戻る").toBe(true);
    expect(rings(state).length, "手元へ戻って消える").toBe(0);
  });

  it("回数ぶん当てる（大手裏剣の 6 回）。戻らない弾は当て終えたら消える", () => {
    const state = arena();
    const e = tough(placeEnemy(state, "boar", 30));
    const shot: BulletDef = { ...bulletDef("pistol"), key: "test.bigStar", name: "試しの大手裏剣", pierceBonus: 0, grind: { sec: 0.6, hits: 6 } };
    emitVolley(state, shot, 0, undefined, { damage: 5, recoil: false, lane: "secondary" });
    let damaged = 0;
    let last = e.hp;
    for (let t = 0; t < SAFETY_SEC && rings(state).length > 0; t += STEP) {
      updateProjectiles(state, STEP);
      if (e.hp < last) damaged += 1;
      last = e.hp;
    }
    expect(damaged, "6 回当たる").toBe(6);
    expect(rings(state).length, "消える").toBe(0);
  });
});

describe("投げの組（往復）", () => {
  it("行きと帰りの両方で当てた敵 1 体につき 1 回だけ戦意が溜まる", () => {
    withFormGain("blade", [{ kind: "roundTrip", amount: 1 }], () => {
      const state = arena();
      // 上下 2 枚の弧の両側に 1 体ずつ。行きで片方の輪が、帰りでもう片方の輪が通る（2 枚は同じ組）
      tough(placeEnemy(state, "boar", 20, BULGE / 2));
      tough(placeEnemy(state, "boar", 20, -BULGE / 2));
      // 弧から外れた敵は数えない
      tough(placeEnemy(state, "boar", 20, 60));
      // 貫く輪（貫通が尽きると行きの途中で折り返すので、ここでは貫通を多く持たせる）
      throwAt(state, ringShot({ pierceBonus: 99 }), 40);
      for (let t = 0; t < SAFETY_SEC && rings(state).length > 0; t += STEP) updateProjectiles(state, STEP);
      expect(state.player.morale.value, "両側の 2 体").toBe(2);
    });
  });

  it("行きだけで当てた敵は数えない", () => {
    withFormGain("blade", [{ kind: "roundTrip", amount: 1 }], () => {
      const state = arena();
      tough(placeEnemy(state, "boar", 20, BULGE / 2));
      throwAt(state, ringShot({ pair: undefined, pierceBonus: 99 }), 40);
      for (let t = 0; t < SAFETY_SEC && rings(state).length > 0; t += STEP) updateProjectiles(state, STEP);
      expect(state.player.morale.value).toBe(0);
    });
  });
});
