import { describe, expect, it } from "vitest";
import { createGame } from "../core/game";
import { FIXED_DT } from "../core/loop";
import type { Enemy, GameState, Projectile } from "../core/state";
import { BOSS } from "../data/tuning";
import { Tile, getTile, rectCenter } from "../map/grid";
import { bossEnemy, bossKeyForDepth, bossTakenMul } from "./boss";
import { BROOD_LAY } from "./bossBroodMother";
import { LIB_READ_THUNDER } from "./bossLibrarian";
import { copiedStatuses } from "./bossMirrorKnight";
import { damageEnemy } from "./combat";
import { deflectProjectile } from "./elites";
import { updateEnemies } from "./enemies";
import { findFreeSpot } from "./enemyTraits";
import { updateHazards } from "./hazards";
import { isStaggered } from "./poise";
import { buildFloor } from "./floor";
import { applyStatus, updateStatusEffects } from "./statusEffects";
import { placeTerrain, terrainAt } from "./terrain";

const HUGE_HP = 1_000_000;
/** 新しいボスの深度（8 体の回転の 5〜8 番目） */
const WAVE3_BOSSES: readonly (readonly [string, number])[] = [
  ["oilKing", 15],
  ["broodMother", 18],
  ["librarian", 21],
  ["mirrorKnight", 24],
];

/** ボス階を作り、部屋を封鎖してプレイヤーをボスの横に置く */
function bossFloor(depth: number, seed = 21): { state: GameState; boss: Enemy } {
  const state = createGame(seed);
  state.depth = depth;
  buildFloor(state);
  const boss = bossEnemy(state);
  const room = state.rooms[state.boss?.roomIndex ?? -1];
  if (!boss || !room) throw new Error("no boss");
  room.locked = true;
  state.player.maxHp = HUGE_HP;
  state.player.hp = HUGE_HP;
  const want = { x: boss.body.pos.x - 70, y: boss.body.pos.y };
  state.player.body.pos = findFreeSpot(state, want, state.player.body.radius, 80) ?? want;
  return { state, boss };
}

function tick(state: GameState, n = 1): void {
  for (let i = 0; i < n; i++) {
    updateStatusEffects(state, FIXED_DT);
    updateEnemies(state, FIXED_DT);
    updateHazards(state, FIXED_DT);
    state.player.invulnTimer = 0;
  }
}

/** 予備動作中か（代入で型が絞られた後も読み直せるよう関数にする） */
function inWindup(e: Enemy): boolean {
  return e.phase === "windup";
}

function stairsTile(state: GameState): number {
  const room = state.rooms[state.boss?.roomIndex ?? -1];
  if (!room) throw new Error("no boss room");
  const c = rectCenter(room.rect);
  return getTile(state.map, c.x, c.y);
}

describe("Wave 3 のボス: 全体", () => {
  it.each(WAVE3_BOSSES)("%s は深度 %i のボス階に出る", (key, depth) => {
    expect(bossKeyForDepth(depth)).toBe(key);
    const { boss } = bossFloor(depth);
    expect(boss.defKey).toBe(key);
  });

  it.each(WAVE3_BOSSES)("%s は削られるごとに 3 段階まで進み、倒すと階段が出る（1,200 ステップ例外なく動く）", (_key, depth) => {
    const { state, boss } = bossFloor(depth);
    boss.phase = "chase";
    let maxStage = 1;
    expect(() => {
      for (let round = 0; round < 12; round++) {
        tick(state, 100);
        const a = boss.ai;
        if (a) maxStage = Math.max(maxStage, a.stage);
        if (boss.hp <= 0) break;
        boss.hidden = false;
        // 写し身の守りや氷の鎧に左右されないよう、HP を直接 1 割ずつ減らす
        boss.hp = Math.max(1, boss.hp - Math.round(boss.maxHp * 0.1));
      }
    }).not.toThrow();
    expect(maxStage, "第 3 段階まで").toBe(3);
    damageEnemy(state, boss, boss.hp + 1, { x: 1, y: 0 }, 0);
    tick(state);
    expect(state.boss?.defeated).toBe(true);
    expect(stairsTile(state)).toBe(Tile.StairsDown);
  });
});

describe("油壺の王", () => {
  it("ボス部屋には最初から油溜まりがある", () => {
    const { state } = bossFloor(15);
    tick(state);
    const room = state.rooms[state.boss?.roomIndex ?? -1];
    if (!room) throw new Error("no room");
    let oil = 0;
    for (let y = room.rect.y; y < room.rect.y + room.rect.h; y++) {
      for (let x = room.rect.x; x < room.rect.x + room.rect.w; x++) if (terrainAt(state, (x + 0.5) * 16, (y + 0.5) * 16) === "oil") oil += 1;
    }
    expect(oil).toBeGreaterThan(0);
  });

  it("燃える床に立つと引火して怯む（間隔の内は繰り返さない）", () => {
    const { state, boss } = bossFloor(15);
    boss.phase = "chase";
    boss.attackCooldown = 99;
    placeTerrain(state, boss.body.pos.x, boss.body.pos.y, "fire", 8);
    tick(state);
    expect(isStaggered(boss)).toBe(true);
    expect(boss.ai?.timer).toBeCloseTo(BOSS.oilKing.igniteCooldown, 1);
  });
});

describe("群れの母", () => {
  it("卵を産み、割られた卵は母に怯み値を入れ、放っておくと孵る", () => {
    const { state, boss } = bossFloor(18);
    boss.phase = "chase";
    boss.attackCooldown = 0;
    if (boss.ai) boss.ai.move = BROOD_LAY;
    tick(state);
    expect(boss.phase).toBe("windup");
    for (let i = 0; i < 200 && inWindup(boss); i++) tick(state);
    const eggs = state.enemies.filter((e) => e.defKey === "broodEgg" && e.leaderId === boss.id);
    expect(eggs.length).toBe(BOSS.broodMother.eggCount);
    const first = eggs[0];
    if (!first) return;
    const poise = boss.poise.damage;
    damageEnemy(state, first, 999_999, { x: 1, y: 0 }, 0);
    tick(state);
    expect(boss.poise.damage > poise || isStaggered(boss), "卵を割ると母が崩れる").toBe(true);
    tick(state, Math.ceil(BOSS.broodMother.eggHatch / FIXED_DT) + 60);
    expect(state.enemies.some((e) => e.defKey === "broodEgg")).toBe(false);
    expect(state.enemies.some((e) => e.defKey === "sproutSlime" || e.defKey === "spikeRat"), "孵った").toBe(true);
  });
});

describe("図書館の司書", () => {
  it("禁書を読む間に沈黙させると本を落としてダウンし、雷は落ちない", () => {
    const { state, boss } = bossFloor(21);
    boss.phase = "chase";
    boss.attackCooldown = 0;
    if (boss.ai) {
      boss.ai.stage = 2;
      boss.ai.move = LIB_READ_THUNDER;
    }
    tick(state);
    expect(boss.phase).toBe("windup");
    applyStatus(state, { kind: "enemy", enemy: boss }, { kind: "silence", stacks: 1, duration: 3, potency: 0 }, "player");
    tick(state);
    expect(isStaggered(boss)).toBe(true);
    expect(state.texts.some((t) => t.text === "本を落とした")).toBe(true);
    tick(state, 120);
    expect(state.hazards.some((h) => h.kind === "landing"), "予告は消えている").toBe(false);
  });
});

describe("鏡の騎士", () => {
  function shotAt(state: GameState, boss: Enemy, fromFront: boolean): Projectile {
    const side = fromFront ? 1 : -1;
    return {
      id: state.nextId++,
      owner: "player",
      pos: { x: boss.body.pos.x + boss.facing.x * 20 * side, y: boss.body.pos.y },
      vel: { x: -boss.facing.x * 200 * side, y: 0 },
      radius: 2,
      damage: 5,
      life: 1,
      color: "#ffffff",
      kind: "ranged",
      hitIds: new Set(),
      pierceLeft: 0,
    };
  }

  it("正面から来た弾を跳ね返し、背後からの弾は通す", () => {
    const { state, boss } = bossFloor(24);
    boss.facing = { x: -1, y: 0 };
    const front = shotAt(state, boss, true);
    expect(deflectProjectile(state, front, boss)).toBe(true);
    expect(front.owner).toBe("enemy");
    const back = shotAt(state, boss, false);
    expect(deflectProjectile(state, back, boss)).toBe(false);
  });

  it("第 3 段階で写し身を呼び、写し身が残っている間は本体が守られる", () => {
    const { state, boss } = bossFloor(24);
    boss.phase = "chase";
    boss.attackCooldown = 99;
    boss.hp = Math.floor(boss.maxHp * BOSS.mirrorKnight.phase2Ratio);
    tick(state);
    boss.hp = Math.floor(boss.maxHp * BOSS.mirrorKnight.phase3Ratio);
    tick(state);
    expect(boss.ai?.stage).toBe(3);
    const images = state.enemies.filter((e) => e.defKey === "mirrorImage");
    expect(images.length).toBe(BOSS.mirrorKnight.images);
    expect(bossTakenMul(state, boss)).toBe(BOSS.mirrorKnight.imageGuardMul);
    for (const img of images) damageEnemy(state, img, 999_999, { x: 1, y: 0 }, 0);
    tick(state);
    expect(bossTakenMul(state, boss)).toBe(1);
  });

  it("写す状態異常はプレイヤーの装備の付与（無ければ出血）", () => {
    const state = createGame(3);
    expect(copiedStatuses(state)).toEqual(["bleed"]);
    state.stats = {
      ...state.stats,
      statusProcs: [
        { kind: "burn", chance: 0.2, stacks: 1, duration: 2, potency: 3, on: "any" },
        { kind: "burn", chance: 0.2, stacks: 1, duration: 2, potency: 3, on: "melee" },
        { kind: "chill", chance: 0.2, stacks: 1, duration: 2, potency: 0, on: "any" },
      ],
    };
    expect(copiedStatuses(state)).toEqual(["burn", "chill"]);
  });
});
