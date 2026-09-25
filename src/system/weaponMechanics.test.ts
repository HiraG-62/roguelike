import { afterEach, describe, expect, it } from "vitest";
import { step } from "../core/game";
import { FIXED_DT } from "../core/loop";
import type { Enemy, GameState, Projectile } from "../core/state";
import type { StatusApply } from "../core/status";
import {
  type BulletDef,
  type BulletNumbers,
  type MeleeStepDef,
  type MovesetDef,
  type MovesetKey,
  type ThrowArtDef,
  MOVESETS,
  laneVolley,
  movesetCasts,
  reviveStep,
} from "../data/weapons";
import { bulletDef } from "../loot/bullets";
import { controlHint } from "../render/comboUi";
import { emitVolley } from "./player";
import { findStatus } from "./statusEffects";
import { terrainAt } from "./terrain";
import { emitArtVolley } from "./weaponArts";
import { arena, placeEnemy, withInput } from "./testHelpers";

/**
 * 武器 Wave 4 の共通の仕組み（docs/ideas/weapons-wave4.md 1 章）: 左の段の弾 cast / 弾の状態異常 applies / 弾の見た目 look /
 * 弾が残す地形 leaves / 周回の弾（既存の orbit を右レーンの弾で使う）/ 振りで敵弾を消す cutsBullets / 溜め中の回し spinning。
 * データ（新武器種）はまだ無いので、武器種の定義をテストの間だけ差し替えて確かめる
 */

const NO_ATTACK_COOLDOWN = 99;
const TOUGH_HP = 99999;
const BURN: StatusApply = { kind: "burn", stacks: 1, duration: 3, potency: 2 };
/** 回しを確かめる押しっぱなしのステップ数（1 秒） */
const SPIN_FRAMES = 60;
/** 振り 1 回を振り切るのに十分なステップ数 */
const SWING_STEPS = 40;

const MUTABLE = MOVESETS as Record<MovesetKey, MovesetDef>;
const originals = new Map<MovesetKey, MovesetDef>();

/** テストの間だけ武器種の定義を差し替える（afterEach で戻す） */
function patchMoveset(key: MovesetKey, patch: (m: MovesetDef) => MovesetDef): void {
  const base = originals.get(key) ?? MOVESETS[key];
  originals.set(key, base);
  MUTABLE[key] = patch(base);
}

afterEach(() => {
  for (const [key, def] of originals) MUTABLE[key] = def;
  originals.clear();
});

function tough(e: Enemy): Enemy {
  e.attackCooldown = NO_ATTACK_COOLDOWN;
  e.hp = TOUGH_HP;
  e.maxHp = TOUGH_HP;
  return e;
}

function playerShots(state: GameState): Projectile[] {
  return state.projectiles.filter((pr) => pr.owner === "player");
}

/** 既存の弾から数値だけを取り出す（JSON の throw.bullet と同じ形） */
function numbersOf(b: BulletDef): BulletNumbers {
  const { key: _key, name: _name, keywords: _keywords, attack: _attack, ...numbers } = b;
  return numbers;
}

/** 杖の魔弾の段（右レーンの最初の弾の段）を JSON の throw の形にしたもの */
function rawThrow(extra: Record<string, unknown> = {}, bullet: Record<string, unknown> = {}): Record<string, unknown> {
  const t = laneVolley(MOVESETS.wand);
  if (!t) throw new Error("杖に弾の段が無い");
  return { scaling: t.scaling, poise: t.poise, count: 1, spreadDeg: 0, bullet: { ...numbersOf(t.bullet), ...bullet }, ...extra };
}

/** 剣の 1 段目を JSON の段の形にし、cast などを足す */
function rawStep(extra: Record<string, unknown>): Record<string, unknown> {
  const s = MOVESETS.sword.steps[0];
  if (!s) throw new Error("剣の 1 段目が無い");
  return { ...s, ...extra };
}

function castStep(castKey: string, bullet: Record<string, unknown> = { look: { color: "#ff8030" } }): MeleeStepDef {
  return reviveStep(rawStep({ cast: { key: castKey, throw: rawThrow({}, bullet) } }));
}

describe("武器 Wave 4: 型の復元（JSON → 型）", () => {
  it("段の cast は弾の key が cast.<key> になり、弾の段の applies・弾の look / leaves を復元する", () => {
    const s = reviveStep(
      rawStep({
        cast: {
          key: "testFire",
          throw: rawThrow({ applies: [BURN] }, { look: { color: "#ff8030", trail: "#ffd060", particles: 6, glow: true }, leaves: { terrain: "fire", radius: 10, duration: 2 } }),
        },
        cutsBullets: true,
      }),
    );
    expect(s.cast?.key).toBe("testFire");
    expect(s.cast?.throw.bullet.key, "弾の key は cast.<key>").toBe("cast.testFire");
    expect(s.cast?.throw.applies?.[0]?.kind, "弾の状態異常").toBe("burn");
    expect(s.cast?.throw.bullet.look?.particles).toBe(6);
    expect(s.cast?.throw.bullet.leaves?.terrain).toBe("fire");
    expect(s.cutsBullets).toBe(true);
  });

  it("未知の地形・未知の状態異常・key の無い cast は読み込み時に落とす", () => {
    expect(() => castStep("bad", { leaves: { terrain: "sand", radius: 8, duration: 1 } })).toThrow();
    expect(() => reviveStep(rawStep({ cast: { key: "bad", throw: rawThrow({ applies: [{ ...BURN, kind: "sleepy" }] }) } }))).toThrow();
    expect(() => reviveStep(rawStep({ cast: { throw: rawThrow() } }))).toThrow();
  });

  it("溜めの spinning を復元し、振りの cast はすべての振りから拾える", () => {
    const cast = castStep("testSpin");
    patchMoveset("greatsword", (m) => {
      if (!m.charge) throw new Error("大剣に溜めが無い");
      return { ...m, dashAttack: cast, charge: { ...m.charge, spinning: { interval: 0.2, step: castStep("testSpin2") } } };
    });
    const keys = movesetCasts(MOVESETS.greatsword).map((c) => c.key);
    expect(keys, "ダッシュ攻撃と回しの cast").toEqual(expect.arrayContaining(["testSpin", "testSpin2"]));
    expect(movesetCasts(originals.get("sword") ?? MOVESETS.sword), "既存の剣は cast を持たない").toEqual([]);
  });

  it("杖以外の既存の武器種は cast を持たず、弾の段の弾は applies を持たない（挙動は不変）", () => {
    for (const m of Object.values(MOVESETS)) {
      // 杖は魔法の武器種に作り替えた（wandMagic.test.ts）
      if (m.key === "wand") continue;
      expect(movesetCasts(m), m.key).toEqual([]);
      for (const s of m.steps2) {
        if (s.kind === "volley") expect(s.throw.applies, `${m.key}.${s.key}`).toBeUndefined();
      }
    }
  });
});

describe("武器 Wave 4: 左の段の弾（cast）", () => {
  it("左の段に cast があれば active の瞬間に弾が出て、弾の key は cast.<key>", () => {
    const cast = castStep("testFire");
    patchMoveset("sword", (m) => ({ ...m, steps: [cast, ...m.steps.slice(1)] }));
    const state = arena();
    step(state, withInput({ attackPressed: true }), FIXED_DT);
    expect(state.player.attack.phase, "予備動作").toBe("windup");
    expect(playerShots(state).length, "予備動作の間は撃たない").toBe(0);
    while (state.player.attack.phase === "windup") step(state, withInput({}), FIXED_DT);
    const shots = playerShots(state);
    expect(shots.length, "active の瞬間に 1 回").toBe(1);
    expect(shots[0]?.shot?.key).toBe("cast.testFire");
    expect(shots[0]?.kind, "射撃として当たる").toBe("ranged");
    const seen = new Set(shots.map((pr) => pr.id));
    for (let i = 0; i < SWING_STEPS; i++) {
      step(state, withInput({}), FIXED_DT);
      for (const pr of playerShots(state)) seen.add(pr.id);
    }
    expect(seen.size, "1 振りで 2 回撃たない").toBe(1);
  });

  it("HUD の左の案内は cast の段なら魔法の名前を出す", () => {
    const cast = castStep("testFire");
    patchMoveset("sword", (m) => ({ ...m, steps: [cast, ...m.steps.slice(1)] }));
    const hint = controlHint(MOVESETS.sword, bulletDef("pistol"), 0);
    expect(hint.includes(cast.cast?.name ?? "?"), "cast の名前").toBe(true);
  });
});

describe("武器 Wave 4: 弾の状態異常（applies）と見た目（look）", () => {
  it("弾の applies は命中と炸裂で状態異常を付ける（付与元 player）", () => {
    const direct = arena();
    const e = tough(placeEnemy(direct, "boar", 40));
    emitVolley(direct, bulletDef("pistol"), 0, undefined, { applies: [BURN] });
    for (let i = 0; i < 30; i++) step(direct, withInput({}), FIXED_DT);
    expect(findStatus(e.status, "burn")?.source, "直撃で燃焼（付与元 player）").toBe("player");

    const blast = arena();
    const target = tough(placeEnemy(blast, "boar", 70));
    emitVolley(blast, bulletDef("mortar"), 0, 70, { applies: [BURN] });
    for (let i = 0; i < 90; i++) step(blast, withInput({}), FIXED_DT);
    expect(findStatus(target.status, "burn")?.source, "炸裂で燃焼").toBe("player");
  });

  it("弾の段の applies は弾へ写り、applies の無い弾は状態異常を付けない", () => {
    const base = laneVolley(MOVESETS.wand);
    if (!base) throw new Error("杖に弾の段が無い");
    const t: ThrowArtDef = { ...base, applies: [BURN] };
    const state = arena();
    emitArtVolley(state, t);
    expect(playerShots(state)[0]?.applies?.[0]?.kind).toBe("burn");

    const plain = arena();
    const e = tough(placeEnemy(plain, "boar", 40));
    emitArtVolley(plain, { ...base, applies: undefined });
    expect(playerShots(plain)[0]?.applies, "applies の無い弾は付けない").toBeUndefined();
    for (let i = 0; i < 30; i++) step(plain, withInput({}), FIXED_DT);
    expect(findStatus(e.status, "burn")).toBeUndefined();
  });

  it("look の色で弾が撃たれ、見た目は作業領域に写る（当たり方は変えない）", () => {
    const look = { color: "#ff8030", trail: "#ffd060", particles: 7 };
    const state = arena();
    const before = state.particles.length;
    emitVolley(state, { ...bulletDef("pistol"), look }, 0);
    const pr = playerShots(state)[0];
    expect(pr?.color).toBe("#ff8030");
    expect(pr?.shot?.look?.trail).toBe("#ffd060");
    expect(state.particles.length - before, "発射の粒の数").toBe(7);
    expect(pr?.damage, "威力は変わらない").toBeCloseTo(arenaShotDamage());
  });
});

function arenaShotDamage(): number {
  const state = arena();
  emitVolley(state, bulletDef("pistol"), 0);
  return playerShots(state)[0]?.damage ?? 0;
}

describe("武器 Wave 4: 弾が残す地形（leaves）", () => {
  const LEAVES = { terrain: "oil" as const, radius: 10, duration: 5 };

  it("leaves を持つ弾は消える位置に地形を置く", () => {
    const state = arena();
    tough(placeEnemy(state, "boar", 60));
    emitVolley(state, { ...bulletDef("pistol"), leaves: LEAVES }, 0);
    const pr = playerShots(state)[0];
    if (!pr) throw new Error("弾が出ていない");
    for (let i = 0; i < 40 && pr.life > 0; i++) step(state, withInput({}), FIXED_DT);
    expect(pr.life, "命中で消えた").toBeLessThanOrEqual(0);
    expect(terrainAt(state, pr.pos.x, pr.pos.y), "消えた位置に油").toBe("oil");
  });

  it("手元へ戻った弾は地形を置かない", () => {
    const state = arena();
    emitVolley(state, { ...bulletDef("pistol"), leaves: LEAVES }, 0);
    const pr = playerShots(state)[0];
    if (!pr?.shot) throw new Error("作業領域が無い");
    pr.shot.returning = true;
    pr.life = FIXED_DT / 2;
    step(state, withInput({}), FIXED_DT);
    expect(terrainAt(state, pr.pos.x, pr.pos.y)).toBe("none");
  });
});

describe("武器 Wave 4: 周回する弾（右レーンの弾の段の orbit）", () => {
  it("orbit の弾は自分の周りを回り rehit ごとに同じ敵にまた当たる", () => {
    const base = laneVolley(MOVESETS.wand);
    if (!base) throw new Error("杖に弾の段が無い");
    const radius = 30;
    const t: ThrowArtDef = { ...base, count: 1, bullet: { ...base.bullet, orbit: { radius, turnRate: Math.PI * 4, laps: 3 } } };
    const state = arena();
    const e = tough(placeEnemy(state, "boar", 0, radius));
    const spot = { ...e.body.pos };
    emitArtVolley(state, t);
    const pr = playerShots(state)[0];
    expect(pr?.shot?.orbit, "作業領域に周回が写る").toBeDefined();
    let hits = 0;
    let hp = e.hp;
    for (let i = 0; i < 120 && (pr?.life ?? 0) > 0; i++) {
      step(state, withInput({}), FIXED_DT);
      // 輪の上に据えた的（寄ってきたり押されたりしないように毎ステップ戻す）
      e.body.pos = { ...spot };
      e.knock = { x: 0, y: 0 };
      if (e.hp < hp) hits += 1;
      hp = e.hp;
    }
    expect(hits, "1 周ごとにまた当たる").toBeGreaterThanOrEqual(2);
  });
});

describe("武器 Wave 4: 振りで敵弾を消す（cutsBullets）", () => {
  function enemyBullet(state: GameState, dx: number): Projectile {
    const p = state.player.body.pos;
    const pr: Projectile = {
      id: state.nextId++,
      owner: "enemy",
      pos: { x: p.x + dx, y: p.y },
      vel: { x: -135, y: 0 },
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

  function swing(state: GameState): void {
    for (let i = 0; i < SWING_STEPS; i++) step(state, withInput({ attackPressed: i === 0 }), FIXED_DT);
  }

  it("cutsBullets の振りは弾返しなしでも敵弾を消す", () => {
    patchMoveset("sword", (m) => ({ ...m, steps: m.steps.map((s) => ({ ...s, cutsBullets: true })) }));
    const state = arena();
    const pr = enemyBullet(state, 22);
    swing(state);
    expect(pr.owner, "撃ち返さない").toBe("enemy");
    expect(state.projectiles.includes(pr) && pr.life > 0, "敵弾が消えている").toBe(false);
    expect(state.player.hp, "被弾しない").toBe(state.player.maxHp);
  });
});

describe("武器 Wave 4: 溜め中の回し（spinning）", () => {
  it("spinning の溜めは interval ごとに周りを打つ", () => {
    const spinStep = reviveStep({ ...rawStep({}), shape: { kind: "circle" }, reach: 0, size: 60, knockback: 0 });
    patchMoveset("greatsword", (m) => {
      if (!m.charge) throw new Error("大剣に溜めが無い");
      return { ...m, charge: { ...m.charge, spinning: { interval: 0.2, step: spinStep } } };
    });
    const state = arena(5, { moveset: "greatsword" });
    // 真後ろの敵（振りの向きに関係なく周りを打つ）
    const e = tough(placeEnemy(state, "boar", -20));
    let hits = 0;
    let hp = e.hp;
    step(state, withInput({ attackPressed: true, attackHeld: true }), FIXED_DT);
    for (let i = 0; i < SPIN_FRAMES; i++) {
      step(state, withInput({ attackHeld: true }), FIXED_DT);
      if (e.hp < hp) hits += 1;
      hp = e.hp;
    }
    expect(state.player.attack.phase, "溜めている間は振りに入らない").toBe("none");
    expect(state.player.attack.charging).toBe(true);
    // 1 秒押して 0.2 秒ごと（ヒットストップで時間が止まるぶん少し減る）
    expect(hits, "押している間に何度も打つ").toBeGreaterThanOrEqual(3);
    expect(hits, "区切りごとに 1 回まで").toBeLessThanOrEqual(5);
  });

  it("spinning の無い溜めは押している間に打たない（既存の大剣は不変）", () => {
    const state = arena(5, { moveset: "greatsword" });
    const e = tough(placeEnemy(state, "boar", 20));
    step(state, withInput({ attackPressed: true, attackHeld: true }), FIXED_DT);
    for (let i = 0; i < 40; i++) step(state, withInput({ attackHeld: true }), FIXED_DT);
    expect(e.hp).toBe(TOUGH_HP);
  });
});
