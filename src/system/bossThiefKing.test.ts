import { describe, expect, it } from "vitest";
import { createGame } from "../core/game";
import { FIXED_DT } from "../core/loop";
import type { Enemy, GameState } from "../core/state";
import { enemyCombat } from "../data/enemyCombat";
import { enemyDefense } from "../data/enemyDefense";
import { BOSS } from "../data/tuning";
import { Tile, getTile, rectCenter } from "../map/grid";
import { bossEnemy, bossKeyForDepth, bossTelegraph } from "./boss";
import { THIEF_DASH, THIEF_KNIFE, THIEF_MINE, THIEF_SMOKE, thiefKingCornered } from "./bossThiefKing";
import { damageEnemy } from "./combat";
import { updateEnemies } from "./enemies";
import { findFreeSpot } from "./enemyTraits";
import { buildFloor } from "./floor";
import { updateHazards } from "./hazards";
import { overlapsWall } from "./physics";
import { isStaggered } from "./poise";
import { updateStatusEffects } from "./statusEffects";
import { smokeAt } from "./terrain";
import { enemyDef } from "../data/enemies";

/** 盗賊王（docs/ideas/enemies.md B3。深度 27 のボス） */

const DEPTH = 27;
const HUGE_HP = 1_000_000;

function bossFloor(seed = 21): { state: GameState; boss: Enemy } {
  const state = createGame(seed);
  state.depth = DEPTH;
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

function inWindup(e: Enemy): boolean {
  return e.phase === "windup";
}

/** 技を指定して予備動作に入れる */
function startMove(state: GameState, boss: Enemy, move: number): void {
  boss.phase = "chase";
  boss.attackCooldown = 0;
  if (boss.ai) boss.ai.move = move;
  tick(state);
}

/** ボスの高さのまま左へ進み、左が壁になる手前の位置（壁際） */
function wallSide(state: GameState, boss: Enemy): { x: number; y: number } {
  const y = boss.body.pos.y;
  let x = boss.body.pos.x;
  while (!overlapsWall(state, x - 1, y, boss.body.radius)) x -= 1;
  return { x, y };
}

function thieves(state: GameState, boss: Enemy): Enemy[] {
  return state.enemies.filter((e) => e.defKey === "thief" && e.leaderId === boss.id && e.hp > 0);
}

describe("盗賊王: 全体", () => {
  it("深度 27 のボス階に出て、部屋には最初から手下の盗賊がいる", () => {
    expect(bossKeyForDepth(DEPTH)).toBe("thiefKing");
    const { state, boss } = bossFloor();
    expect(boss.defKey).toBe("thiefKing");
    expect(thieves(state, boss)).toHaveLength(BOSS.thiefKing.minions[0] ?? 0);
  });

  it("弱点と語を持つ（防御の表・戦闘の表に行がある）", () => {
    const guard = enemyDefense("thiefKing");
    expect(guard.stages?.[0]?.ice, "第 1 段階の弱点は冷気").toBeLessThan(0);
    expect(enemyCombat("thiefKing").keywords.consumes).toContain("chill");
    expect(enemyDef("thief").boss).toBeFalsy();
  });

  it("削られるごとに 3 段階まで進み、段階ごとに手下を呼び、倒すと階段が出る（1,200 ステップ例外なく動く）", () => {
    const { state, boss } = bossFloor();
    boss.phase = "chase";
    let maxStage = 1;
    let summoned = 0;
    expect(() => {
      for (let round = 0; round < 12; round++) {
        tick(state, 100);
        const before = thieves(state, boss).length;
        boss.hp = Math.max(1, boss.hp - Math.round(boss.maxHp * 0.1));
        tick(state);
        summoned += Math.max(0, thieves(state, boss).length - before);
        maxStage = Math.max(maxStage, boss.ai?.stage ?? 1);
      }
    }).not.toThrow();
    expect(maxStage, "第 3 段階まで").toBe(3);
    expect(summoned, "第 2・3 段階で手下が増える").toBeGreaterThanOrEqual((BOSS.thiefKing.minions[1] ?? 0) + (BOSS.thiefKing.minions[2] ?? 0));
    damageEnemy(state, boss, boss.hp + 1, { x: 1, y: 0 }, 0);
    tick(state);
    expect(state.boss?.defeated).toBe(true);
    const room = state.rooms[state.boss?.roomIndex ?? -1];
    if (!room) throw new Error("no room");
    const c = rectCenter(room.rect);
    expect(getTile(state.map, c.x, c.y)).toBe(Tile.StairsDown);
  });
});

describe("盗賊王: 逃げる・追い詰める", () => {
  it("第 1 段階は詰め寄られると離れる", () => {
    const { state, boss } = bossFloor();
    boss.phase = "chase";
    boss.attackCooldown = 99;
    state.player.body.pos = { x: boss.body.pos.x - 40, y: boss.body.pos.y };
    const x = boss.body.pos.x;
    tick(state, 30);
    expect(boss.body.pos.x, "プレイヤーと反対へ逃げる").toBeGreaterThan(x);
  });

  it("壁際で逃げ道を塞いで詰め寄り続けるとダウンする（汗が予告）", () => {
    const { state, boss } = bossFloor();
    boss.body.pos = wallSide(state, boss);
    boss.phase = "chase";
    boss.attackCooldown = 99;
    const steps = Math.ceil(BOSS.thiefKing.cornerTime / FIXED_DT) + 10;
    let pressed = 0;
    for (let i = 0; i < steps && !isStaggered(boss); i++) {
      // 壁と反対側（右）から詰め寄り続ける: 逃げる向き（左）は壁
      state.player.body.pos = { x: boss.body.pos.x + 30, y: boss.body.pos.y };
      boss.attackCooldown = 99;
      tick(state);
      pressed = Math.max(pressed, thiefKingCornered(boss));
    }
    expect(pressed, "追い詰められた秒が溜まる").toBeGreaterThan(0);
    expect(isStaggered(boss), "ダウン").toBe(true);
    expect(boss.ai?.timer).toBeCloseTo(BOSS.thiefKing.cornerCooldown, 0);
  });

  it("離れていれば壁際でも追い詰められない", () => {
    const { state, boss } = bossFloor();
    boss.body.pos = wallSide(state, boss);
    boss.phase = "chase";
    boss.attackCooldown = 99;
    state.player.body.pos = { x: boss.body.pos.x + BOSS.thiefKing.keepAway + 20, y: boss.body.pos.y };
    tick(state, Math.ceil(BOSS.thiefKing.cornerTime / FIXED_DT) + 10);
    expect(isStaggered(boss)).toBe(false);
  });

  it("第 3 段階は開き直って寄ってくる（逃げない）", () => {
    const { state, boss } = bossFloor();
    if (boss.ai) boss.ai.stage = 3;
    boss.phase = "chase";
    boss.attackCooldown = 99;
    state.player.body.pos = { x: boss.body.pos.x - 60, y: boss.body.pos.y };
    const x = boss.body.pos.x;
    tick(state, 30);
    expect(boss.body.pos.x).toBeLessThan(x);
  });
});

describe("盗賊王: 技と予告", () => {
  it("短剣は扇の予告のあとに扇状の弾", () => {
    const { state, boss } = bossFloor();
    startMove(state, boss, THIEF_KNIFE);
    expect(inWindup(boss)).toBe(true);
    expect(bossTelegraph(boss, enemyDef("thiefKing"))?.kind).toBe("cone");
    const before = state.projectiles.length;
    for (let i = 0; i < 200 && inWindup(boss); i++) tick(state);
    expect(state.projectiles.length - before).toBe(BOSS.thiefKing.knifeCount);
  });

  it("地雷は落下点の影のあとに置かれ、王自身は起爆させない", () => {
    const { state, boss } = bossFloor();
    startMove(state, boss, THIEF_MINE);
    const shadows = state.hazards.filter((h) => h.kind === "landing" && h.sourceId === boss.id).length;
    expect(shadows, "影の予告").toBeGreaterThan(0);
    for (let i = 0; i < 200 && inWindup(boss); i++) tick(state);
    const mines = state.enemies.filter((e) => e.defKey === "enemyMine" && e.leaderId === boss.id);
    expect(mines.length).toBe(shadows);
  });

  it("煙玉は足元の輪の予告のあとに煙を残す", () => {
    const { state, boss } = bossFloor();
    startMove(state, boss, THIEF_SMOKE);
    expect(state.hazards.some((h) => h.kind === "landing" && h.sourceId === boss.id && h.radius === BOSS.thiefKing.smokeRadius)).toBe(true);
    for (let i = 0; i < 200 && inWindup(boss); i++) tick(state);
    expect(smokeAt(state, boss.body.pos.x, boss.body.pos.y)).toBe(true);
  });

  it("第 3 段階の突進は線の予告", () => {
    const { state, boss } = bossFloor();
    if (boss.ai) boss.ai.stage = 3;
    startMove(state, boss, THIEF_DASH);
    expect(bossTelegraph(boss, enemyDef("thiefKing"))?.kind).toBe("line");
  });
});
