import { describe, expect, it } from "vitest";
import { step } from "../core/game";
import { FIXED_DT } from "../core/loop";
import type { Enemy, GameState } from "../core/state";
import { attack } from "../core/element";
import { PLAYER } from "../data/tuning";
import { FORMS, type FormDef, type FormKey } from "../data/weaponForms";
import { type BulletDef, type ButtonKey, type CastDef, type MeleeStepDef, MOVESETS, type MovesetDef, type MovesetKey } from "../data/weapons";
import { bulletDef } from "../loot/bullets";
import { timedAttackSpeedMul } from "./morale";
import { emitVolley } from "./player";
import { pinCount, stickPin } from "./pins";
import { ringsInFlight } from "./projectiles";
import { arena, placeEnemy, withInput } from "./testHelpers";
import { TILE_SIZE, Tile, setTile } from "../map/grid";

/** 投げ物の武器種の動き（system/player.ts）: 戻るまで投げられない・交互の連撃・抜け斬り・叩き込み・連ね投げ */

const TOUGH_HP = 99999;
const NO_ATTACK_COOLDOWN = 99;
const MAX_STEPS = 600;
const RING_RANGE = 30;
/** 近投げの弧の区間（傾き 30 度・速さと威力はそのまま） */
const NEAR_LEG = { angleDeg: 30, speedMul: 1, damageMul: 1, poiseMul: 1 } as const;

function tough(e: Enemy): Enemy {
  e.attackCooldown = NO_ATTACK_COOLDOWN;
  e.hp = TOUGH_HP;
  e.maxHp = TOUGH_HP;
  return e;
}

/** 武器種の定義を一時的に差し替えて body を回す（終わったら戻す） */
function withMoveset(key: MovesetKey, patch: (m: MovesetDef) => MovesetDef, body: () => void): void {
  const table = MOVESETS as Record<MovesetKey, MovesetDef>;
  const saved = table[key];
  table[key] = patch(saved);
  try {
    body();
  } finally {
    table[key] = saved;
  }
}

function withForm(key: FormKey, patch: (f: FormDef) => FormDef, body: () => void): void {
  const forms = FORMS as Record<FormKey, FormDef>;
  const saved = forms[key];
  forms[key] = patch(saved);
  try {
    body();
  } finally {
    forms[key] = saved;
  }
}

/** 弧で近くへ投げて戻る輪（連撃の近投げの形） */
function ringBullet(): BulletDef {
  return {
    ...bulletDef("pistol"),
    key: "test.nearRing",
    name: "試しの近投げ",
    // 振りが終わってもまだ飛んでいるよう遅く投げる
    speedMul: 0.2,
    lifeMul: 5,
    pierceBonus: 99,
    arc: { catchRadius: 6, range: RING_RANGE, out: NEAR_LEG, back: NEAR_LEG },
  };
}

function ringCast(): CastDef {
  return {
    key: "testRing",
    name: "試しの近投げ",
    throw: { bullet: ringBullet(), scaling: { base: 1 }, poise: 0, count: 1, spreadDeg: 0, attack: attack("ranged", "physical") },
  };
}

/** 1 ステップだけ押す（右は押しっぱなしの差で押した瞬間を取るので、次のステップで離す） */
function press(state: GameState, button: ButtonKey): void {
  step(state, withInput(button === "primary" ? { attackPressed: true, attackHeld: true } : { shootHeld: true }), FIXED_DT);
  step(state, withInput({}), FIXED_DT);
}

function runUntil(state: GameState, done: () => boolean): void {
  for (let i = 0; i < MAX_STEPS && !done(); i++) step(state, withInput({}), FIXED_DT);
  expect(done(), "条件に届いた").toBe(true);
}

describe("戻るまで投げられない（waitForReturn）", () => {
  it("近投げの輪が飛んでいる間は連撃が進まず、戻ってから押すと続きの段が出る", () => {
    withMoveset(
      "sword",
      (m) => ({ ...m, waitForReturn: true, branches: [], steps: m.steps.map((s, i): MeleeStepDef => (i === 0 ? { ...s, cast: ringCast() } : s)) }),
      () => {
        const state = arena();
        const a = state.player.attack;
        press(state, "primary");
        runUntil(state, () => ringsInFlight(state));
        runUntil(state, () => a.phase === "none");
        expect(ringsInFlight(state), "振り終えても輪はまだ飛んでいる").toBe(true);
        expect(a.step, "次の段を覚えて待つ").toBe(1);
        press(state, "primary");
        expect(a.phase, "左を押しても振らない").toBe("none");
        press(state, "secondary");
        expect(a.phase, "右を押しても振らない").toBe("none");
        runUntil(state, () => !ringsInFlight(state));
        expect(a.step, "戻るまで窓は減らない").toBe(1);
        press(state, "primary");
        expect(a.phase).not.toBe("none");
        expect(a.step, "戻ってから続きの段").toBe(1);
      },
    );
  });

  it("左で投げる武器種は輪が飛んでいる間は撃てない", () => {
    withMoveset(
      "sidearm",
      (m) => ({ ...m, waitForReturn: true }),
      () => {
        const state = arena(5, { bullet: "pistol", moveset: "sidearm" });
        emitVolley(state, ringBullet(), 0, undefined, { damage: 1, recoil: false, lane: "primary" });
        expect(ringsInFlight(state)).toBe(true);
        step(state, withInput({ attackPressed: true, attackHeld: true }), FIXED_DT);
        step(state, withInput({ attackHeld: true }), FIXED_DT);
        expect(state.projectiles.filter((p) => p.owner === "player").length, "輪だけ").toBe(1);
        runUntil(state, () => !ringsInFlight(state));
        state.player.shootCooldown = 0;
        step(state, withInput({ attackPressed: true, attackHeld: true }), FIXED_DT);
        expect(state.projectiles.filter((p) => p.owner === "player").length, "戻ったら撃てる").toBeGreaterThan(0);
      },
    );
  });

  it("戻るまで待たない武器種では輪が飛んでいても数えない", () => {
    const state = arena();
    emitVolley(state, ringBullet(), 0, undefined, { damage: 1, recoil: false, lane: "primary" });
    expect(ringsInFlight(state)).toBe(false);
  });
});

describe("交互の連撃（chainAdvance: alternate）", () => {
  /** 振りの active で次を押し、次の振りが始まるまで進める */
  function chain(state: GameState, button: ButtonKey): void {
    const a = state.player.attack;
    runUntil(state, () => a.phase === "active");
    press(state, button);
    runUntil(state, () => a.phase === "windup");
  }

  it("同じ手を続けても段はそのまま、左右を替えたときだけ段が進む", () => {
    withMoveset(
      "sword",
      (m) => ({ ...m, chainAdvance: "alternate", branches: [] }),
      () => {
        const state = arena();
        const a = state.player.attack;
        press(state, "primary");
        expect([a.step, a.lane]).toEqual([0, "primary"]);
        chain(state, "primary");
        expect([a.step, a.lane], "左 → 左").toEqual([0, "primary"]);
        chain(state, "secondary");
        expect([a.step, a.lane], "左 → 右").toEqual([1, "secondary"]);
        chain(state, "secondary");
        expect([a.step, a.lane], "右 → 右").toEqual([1, "secondary"]);
        chain(state, "primary");
        expect([a.step, a.lane], "右 → 左").toEqual([2, "primary"]);
      },
    );
  });

  it("指定の無い武器種は同じ手でも段が進む", () => {
    withMoveset(
      "sword",
      (m) => ({ ...m, branches: [] }),
      () => {
        const state = arena();
        press(state, "primary");
        chain(state, "primary");
        expect(state.player.attack.step).toBe(1);
      },
    );
  });
});

describe("抜け斬り（passThrough・manaPerTarget）", () => {
  const MANA_PER = 3;
  const LUNGE = 80;

  /** 道筋に count 体を並べてダッシュ攻撃を 1 回振る。戻った気力と敵を返す */
  function passCut(count: number): { mana: number; enemies: Enemy[] } {
    let out: { mana: number; enemies: Enemy[] } = { mana: 0, enemies: [] };
    withMoveset(
      "sword",
      (m) => ({
        ...m,
        branches: [],
        dashAttack: { ...m.dashAttack, lunge: LUNGE, reach: 6, size: 6, shape: { kind: "thrust" }, mana: 0, passThrough: true, manaPerTarget: MANA_PER, hits: 1 },
      }),
      () => {
        const state = arena();
        state.player.mana = 0;
        state.stats = { ...state.stats, maxMana: 1000 };
        const px = Math.floor(state.player.body.pos.x / TILE_SIZE);
        const py = Math.floor(state.player.body.pos.y / TILE_SIZE);
        for (let ty = py - 1; ty <= py + 1; ty++) {
          for (let tx = px; tx <= px + Math.ceil(LUNGE / TILE_SIZE) + 2; tx++) setTile(state.map, tx, ty, Tile.Floor);
        }
        const enemies = Array.from({ length: count }, (_, i) => tough(placeEnemy(state, "boar", 20 + i * 15, 0)));
        // ダッシュの後の攻撃（ダッシュ攻撃）を直に出す（ダッシュの移動を挟まない）
        state.player.dashAttackQueued = true;
        step(state, withInput({}), FIXED_DT);
        expect(state.player.dashStrike, "ダッシュ攻撃").toBe(true);
        runUntil(state, () => state.player.attack.phase === "none");
        out = { mana: state.player.mana, enemies };
      },
    );
    return out;
  }

  it("ダッシュ攻撃が道筋の敵をすべて斬り、前へ押さない", () => {
    const { enemies } = passCut(4);
    for (const e of enemies) expect(e.hp, `敵 ${e.id} を斬った`).toBeLessThan(TOUGH_HP);
    for (const e of enemies) expect(Math.abs(e.knock.x), "前へ押さない").toBeLessThan(1);
  });

  it("斬った敵の数だけ気力が戻る（MANA.meleeTargetCap で頭打ちしない）", () => {
    const two = passCut(2).mana;
    const four = passCut(4).mana;
    expect(two, "気力が戻る").toBeGreaterThan(0);
    expect(four, "4 体は 2 体より多く戻る").toBeGreaterThan(two * 1.5);
  });
});

describe("叩き込み（drivePins）", () => {
  it("刺さった敵を近接で打つと刺さりを全部叩き込む", () => {
    withMoveset(
      "sword",
      (m) => ({ ...m, branches: [], steps: m.steps.map((s): MeleeStepDef => ({ ...s, drivePins: true })) }),
      () => {
        const state = arena();
        const e = tough(placeEnemy(state, "boar", 16));
        const kunai = { kind: "kunai", max: 3, sec: 5, driveMul: 2 } as const;
        stickPin(state, e, kunai, 0, 50);
        stickPin(state, e, kunai, 0, 50);
        press(state, "primary");
        runUntil(state, () => state.player.attack.phase === "none");
        expect(pinCount(state, e), "刺さりが消える").toBe(0);
        expect(TOUGH_HP - e.hp, "2 本ぶんの追撃が乗る").toBeGreaterThan(2 * 50 * 2);
      },
    );
  });
});

describe("連ね投げ（MoraleRelease timed）", () => {
  it("満ちた後の次の投げで始まり、秒のあいだ振りの速さが上がる", () => {
    const sec = 2;
    withForm(
      "blade",
      (f) => ({ ...f, morale: { ...f.morale, gain: [{ kind: "meleeHit", amount: 1 }], derived: false, release: { kind: "timed", sec, attackSpeedMul: 2 } } }),
      () => {
        withMoveset(
          "sword",
          (m) => ({ ...m, branches: [] }),
          () => {
            const state = arena();
            state.player.morale.value = FORMS.blade.morale.numbers.max;
            expect(timedAttackSpeedMul(state)).toBe(1);
            step(state, withInput({ attackPressed: true, attackHeld: true }), FIXED_DT);
            expect(state.player.morale.value, "戦意を使う").toBe(0);
            expect(timedAttackSpeedMul(state), "窓の間は 2 倍").toBe(2);
            const windup = MOVESETS.sword.steps[0]?.windup ?? 0;
            expect(state.player.attack.timer, "振りの秒が半分").toBeLessThanOrEqual(windup / 2 + 1e-9);
            for (let t = 0; t < sec + PLAYER.shoot.cooldown; t += FIXED_DT) step(state, withInput({}), FIXED_DT);
            expect(timedAttackSpeedMul(state), "窓が閉じる").toBe(1);
          },
        );
      },
    );
  });
});
