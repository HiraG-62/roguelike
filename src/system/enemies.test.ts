import { describe, expect, it } from "vitest";
import { step } from "../core/game";
import { FIXED_DT } from "../core/loop";
import { ENEMIES, enemiesForDepth } from "../data/enemies";
import { ENEMY_AI } from "../data/tuning";
import { damageEnemy } from "./combat";
import { updateEnemies } from "./enemies";
import { updateHazards } from "./hazards";
import { updateProjectiles } from "./projectiles";
import { interceptEnemyDamage } from "./elites";
import { arena, placeEnemy, withInput } from "./testHelpers";

const STEPS = 500;
const HUGE_HP = 1_000_000;

describe("追加敵の behavior", () => {
  for (const def of ENEMIES) {
    it(`${def.key} が 500 ステップ例外なく動く`, () => {
      const state = arena(11);
      state.player.maxHp = HUGE_HP;
      state.player.hp = HUGE_HP;
      state.depth = 4;
      placeEnemy(state, def.key, 50, 10);
      placeEnemy(state, def.key, -40, -20);
      expect(() => {
        for (let i = 0; i < STEPS; i++) {
          step(state, withInput({ move: { x: i % 80 < 40 ? 1 : -1, y: 0 }, attackPressed: i % 25 === 0 }), FIXED_DT);
        }
      }).not.toThrow();
      expect(state.status).toBe("playing");
    });
  }

  it("ボスは通常の抽選に出ない", () => {
    for (let d = 1; d <= 12; d++) expect(enemiesForDepth(d).some((e) => e.boss)).toBe(false);
  });
});

describe("knight", () => {
  it("正面からの近接は盾で無効、背後からは通る", () => {
    const state = arena();
    const k = placeEnemy(state, "knight", 14);
    k.facing = { x: -1, y: 0 };
    // プレイヤー(左) → knight(右) へ振る攻撃 = 正面
    expect(interceptEnemyDamage(state, k, 10, { x: 1, y: 0 }, "melee")).toBe(0);
    expect(state.texts.some((t) => t.text === "BLOCK")).toBe(true);
    // 背後から
    expect(interceptEnemyDamage(state, k, 10, { x: -1, y: 0 }, "melee")).toBe(10);
  });

  it("damageEnemy 経由の近接も正面は無効、背後は通る", () => {
    const state = arena();
    const k = placeEnemy(state, "knight", 14);
    k.facing = { x: -1, y: 0 };
    const hp = k.hp;
    damageEnemy(state, k, 10, { x: 1, y: 0 }, 0, { kind: "melee" });
    expect(k.hp).toBe(hp);
    damageEnemy(state, k, 10, { x: -1, y: 0 }, 0, { kind: "melee" });
    expect(k.hp).toBe(hp - 10);
  });

  it("guardBreak（カウンター相当）なら正面の盾を無視してダメージが通り、GUARD BREAK 表示 + スタガー", () => {
    const state = arena();
    const k = placeEnemy(state, "knight", 14);
    k.facing = { x: -1, y: 0 };
    const hp = k.hp;
    // 通常の正面攻撃は防がれる
    expect(interceptEnemyDamage(state, k, 10, { x: 1, y: 0 }, "melee")).toBe(0);
    // guardBreak なら通る
    expect(interceptEnemyDamage(state, k, 10, { x: 1, y: 0 }, "melee", true)).toBe(10);
    expect(state.texts.some((t) => t.text === "GUARD BREAK")).toBe(true);

    damageEnemy(state, k, 10, { x: 1, y: 0 }, 0, { kind: "melee", guardBreak: true });
    expect(k.hp).toBe(hp - 10);
    expect(k.phase).toBe("stagger");
  });

  it("正面から来た弾は消えてダメージを受けない", () => {
    const state = arena();
    const k = placeEnemy(state, "knight", 30);
    k.facing = { x: -1, y: 0 };
    const before = k.hp;
    const p = state.player.body.pos;
    state.projectiles.push({
      id: 999,
      owner: "player",
      pos: { x: p.x + 30 - k.body.radius - 1, y: p.y },
      vel: { x: 300, y: 0 },
      radius: 2,
      damage: 5,
      life: 1,
      color: "#fff",
      kind: "ranged",
      hitIds: new Set(),
      pierceLeft: 0,
    });
    updateProjectiles(state, FIXED_DT);
    expect(k.hp).toBe(before);
    expect(state.projectiles.length).toBe(0);
  });
});

describe("bomber", () => {
  it("置いた爆弾は fuse 後に爆発し、範囲内のプレイヤーにダメージ", () => {
    const state = arena();
    const b = placeEnemy(state, "bomber", 60);
    b.phase = "chase";
    b.attackCooldown = 0;
    // 投げる → fuse ぶん待つ
    let exploded = false;
    for (let i = 0; i < 400 && !exploded; i++) {
      // プレイヤーを爆弾の上に置き続ける
      const bomb = state.hazards.find((h) => h.kind === "bomb");
      if (bomb) state.player.body.pos = { ...bomb.pos };
      const hpBefore = state.player.hp;
      updateEnemies(state, FIXED_DT);
      updateHazards(state, FIXED_DT);
      if (state.player.hp < hpBefore) exploded = true;
    }
    expect(exploded).toBe(true);
  });

  it("倒すと持っていた爆弾が即爆発する", () => {
    const state = arena();
    const b = placeEnemy(state, "bomber", 20);
    const hp = state.player.hp;
    damageEnemy(state, b, 9999, { x: 1, y: 0 }, 0);
    updateEnemies(state, FIXED_DT);
    expect(state.player.hp).toBeLessThan(hp);
    expect(ENEMY_AI.bomber.radius).toBeGreaterThan(20);
  });
});

describe("wisp", () => {
  it("死亡直後は無ダメで、deathExplodeFuse 後にテレグラフの爆発で範囲内にダメージ", () => {
    const state = arena();
    const w = placeEnemy(state, "wisp", 20);
    const wispPos = { ...w.body.pos };
    state.player.body.pos = { ...wispPos };
    const hpBeforeDeath = state.player.hp;
    damageEnemy(state, w, 9999, { x: 1, y: 0 }, 0);
    updateEnemies(state, FIXED_DT);

    // 死亡直後: まだテレグラフ中でダメージなし
    expect(state.player.hp).toBe(hpBeforeDeath);
    expect(state.hazards.some((h) => h.kind === "bomb")).toBe(true);

    const fuseSteps = Math.floor(ENEMY_AI.wisp.deathExplodeFuse / FIXED_DT) - 2;
    for (let i = 0; i < fuseSteps; i++) updateHazards(state, FIXED_DT);
    expect(state.player.hp).toBe(hpBeforeDeath);

    for (let i = 0; i < 5; i++) updateHazards(state, FIXED_DT);
    expect(state.player.hp).toBeLessThan(hpBeforeDeath);
  });
});

describe("laserEye", () => {
  it("チャージ中は動かず、照射でプレイヤーに当たる", () => {
    const state = arena();
    const l = placeEnemy(state, "laserEye", 80);
    Object.assign(l, { phase: "chase", attackCooldown: 0 });
    updateEnemies(state, FIXED_DT);
    expect(l.phase).toBe("windup");
    const pos = { ...l.body.pos };
    const hp = state.player.hp;
    for (let i = 0; i < 100; i++) {
      updateEnemies(state, FIXED_DT);
      updateHazards(state, FIXED_DT);
      if (l.phase === "windup") expect(l.body.pos).toEqual(pos);
    }
    expect(state.player.hp).toBeLessThan(hp);
  });
});
