import { describe, expect, it, vi } from "vitest";
import { createGame } from "../core/game";
import { FIXED_DT } from "../core/loop";
import type { Enemy, GameState } from "../core/state";
import { enemyCombat } from "../data/enemyCombat";
import { enemyDefense } from "../data/enemyDefense";
import { BOSS } from "../data/tuning";
import { TILE_SIZE, Tile, getTile, rectCenter } from "../map/grid";
import { bossEnemy, bossKeyForDepth, bossTelegraph } from "./boss";
import { THIEF_DASH, THIEF_KNIFE, THIEF_MINE, THIEF_SMOKE, thiefKingCornered } from "./bossThiefKing";
import { readPlayer } from "./bossKit";
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

/** 盗賊王（docs/ideas/enemies.md B3。章 2 のボス = 深度 10） */

const DEPTH = BOSS.interval * 2;
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
  it("章 2 のボス階（BOSS.interval × 2）に出て、部屋には最初から手下の盗賊がいる", () => {
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

/** 硬直の終わりに技を選ばせ、選ばれた技を返す（プレイヤーの位置・読みは呼ぶ側が先に決める） */
function pickedMove(state: GameState, boss: Enemy): number {
  boss.phase = "recover";
  boss.phaseTimer = 0.001;
  tick(state);
  return boss.ai?.move ?? -1;
}

/** ボスと同じ高さで dx 離れた位置にプレイヤーを置く */
function placePlayer(state: GameState, boss: Enemy, dx: number): void {
  state.player.body.pos = { x: boss.body.pos.x - dx, y: boss.body.pos.y };
}

/** 手下・地雷を消してボスだけにする（技の選びだけを見るため） */
function soloBoss(state: GameState, boss: Enemy): void {
  state.enemies = state.enemies.filter((e) => e.id === boss.id);
}

function setStage(boss: Enemy, stage: number): void {
  if (boss.ai) boss.ai.stage = stage;
}

function fences(state: GameState): typeof state.hazards {
  return state.hazards.filter((h) => h.kind === "boneWall" && h.sourceKey === "thiefKing" && h.time > 0);
}

describe("盗賊王: 第 1 段階は読んで選ぶ", () => {
  it("遠いと短剣を選ぶ", () => {
    const { state, boss } = bossFloor();
    soloBoss(state, boss);
    placePlayer(state, boss, BOSS.rules.farDist + 20);
    expect(pickedMove(state, boss)).toBe(THIEF_KNIFE);
  });

  it("ダッシュで詰めてきた近い・中間合いの相手には煙玉を選ぶ", () => {
    const { state, boss } = bossFloor();
    soloBoss(state, boss);
    for (const dx of [BOSS.rules.nearDist - 20, (BOSS.rules.nearDist + BOSS.rules.farDist) / 2]) {
      placePlayer(state, boss, dx);
      state.player.dashTimer = 0.2;
      expect(readPlayer(state, boss).band, `間合い ${dx}`).not.toBe("far");
      expect(pickedMove(state, boss), `間合い ${dx}`).toBe(THIEF_SMOKE);
    }
  });

  it("止まっている相手には地雷を選ぶ", () => {
    const { state, boss } = bossFloor();
    soloBoss(state, boss);
    placePlayer(state, boss, 100);
    tick(state);
    if (boss.ai?.read) boss.ai.read.stillSec = BOSS.rules.stillSec + 1;
    expect(pickedMove(state, boss)).toBe(THIEF_MINE);
  });

  it("動いている中間合いの相手には短剣と地雷を交互に選ぶ", () => {
    const { state, boss } = bossFloor();
    soloBoss(state, boss);
    const picked: number[] = [];
    for (let i = 0; i < 4; i++) {
      placePlayer(state, boss, 100);
      // 静止の秒を溜めさせない（毎回動いた扱い）
      if (boss.ai?.read) boss.ai.read.stillSec = 0;
      state.player.body.pos.y += 3 * (i % 2 === 0 ? 1 : -1);
      picked.push(pickedMove(state, boss));
    }
    expect(picked.every((m) => m === THIEF_KNIFE || m === THIEF_MINE), "短剣か地雷だけ").toBe(true);
    expect(picked[0], "隣り合う選びは違う").not.toBe(picked[1]);
    expect(picked[0]).toBe(picked[2]);
    expect(picked[1]).toBe(picked[3]);
  });

  it("技の選びは乱数を引かない", () => {
    const { state, boss } = bossFloor();
    soloBoss(state, boss);
    const spy = vi.spyOn(state.rng, "next");
    for (const stage of [1, 2, 3]) {
      setStage(boss, stage);
      for (const dx of [30, 100, 200]) {
        placePlayer(state, boss, dx);
        pickedMove(state, boss);
      }
    }
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("盗賊王: 第 2・3 段階の技の選び", () => {
  it("第 2 段階: 遠いと地雷、近いと煙玉、中間は短剣と地雷を交互", () => {
    const { state, boss } = bossFloor();
    soloBoss(state, boss);
    setStage(boss, 2);
    placePlayer(state, boss, BOSS.rules.farDist + 20);
    expect(pickedMove(state, boss), "遠い").toBe(THIEF_MINE);
    placePlayer(state, boss, BOSS.rules.nearDist - 20);
    expect(pickedMove(state, boss), "近い").toBe(THIEF_SMOKE);
    placePlayer(state, boss, 100);
    const a = pickedMove(state, boss);
    const b = pickedMove(state, boss);
    expect([a, b].sort(), "中間は短剣と地雷").toEqual([THIEF_KNIFE, THIEF_MINE].sort());
  });

  it("第 3 段階: 近いと怒りの扇、それ以外は突進", () => {
    const { state, boss } = bossFloor();
    soloBoss(state, boss);
    setStage(boss, 3);
    placePlayer(state, boss, BOSS.rules.nearDist - 20);
    expect(pickedMove(state, boss), "近い").toBe(THIEF_KNIFE);
    placePlayer(state, boss, 100);
    expect(pickedMove(state, boss), "中間").toBe(THIEF_DASH);
    placePlayer(state, boss, BOSS.rules.farDist + 20);
    expect(pickedMove(state, boss), "遠い").toBe(THIEF_DASH);
  });
});

describe("盗賊王: 追い詰めで進む段階と柵", () => {
  it("追い詰めのダウンは数えられ、cornersToRage 回で生命に関わらず開き直る", () => {
    const { state, boss } = bossFloor();
    setStage(boss, 2);
    if (boss.ai) boss.ai.progress = BOSS.thiefKing.cornersToRage - 1;
    boss.body.pos = wallSide(state, boss);
    boss.phase = "chase";
    const steps = Math.ceil(BOSS.thiefKing.cornerTime / FIXED_DT) + 10;
    for (let i = 0; i < steps && !isStaggered(boss); i++) {
      state.player.body.pos = { x: boss.body.pos.x + 30, y: boss.body.pos.y };
      boss.attackCooldown = 99;
      tick(state);
    }
    expect(isStaggered(boss), "ダウン").toBe(true);
    expect(boss.ai?.progress).toBe(BOSS.thiefKing.cornersToRage);
    expect(boss.hp, "生命は減っていない").toBe(boss.maxHp);
    // 怯んでいる間は動かないので、解けてから段階が進む
    tick(state, Math.ceil(BOSS.thiefKing.cornerStagger / FIXED_DT) + 30);
    expect(boss.ai?.stage, "開き直り").toBe(3);
  });

  it("第 2 段階の始まりに、部屋の中へ柵が立つ（段階 2 の追い詰めの数は 0 から）", () => {
    const { state, boss } = bossFloor();
    boss.phase = "chase";
    if (boss.ai) boss.ai.progress = 5;
    boss.hp = Math.floor(boss.maxHp * BOSS.thiefKing.phase2Ratio) - 1;
    tick(state);
    expect(boss.ai?.stage).toBe(2);
    expect(boss.ai?.progress).toBe(0);
    const walls = fences(state);
    const most = 2 * (2 * BOSS.thiefKing.fenceLen - 1);
    expect(walls.length, "柵のマス").toBeGreaterThan(most / 2);
    expect(walls.length).toBeLessThanOrEqual(most);
    const room = state.rooms[boss.roomIndex];
    if (!room) throw new Error("no room");
    for (const w of walls) {
      const tx = Math.floor(w.pos.x / TILE_SIZE);
      const ty = Math.floor(w.pos.y / TILE_SIZE);
      expect(tx >= room.rect.x && tx < room.rect.x + room.rect.w && ty >= room.rect.y && ty < room.rect.y + room.rect.h, "部屋の中").toBe(true);
      expect(state.lockedTiles.has(ty * state.map.width + tx), "壁として歩けない").toBe(true);
      expect(w.hp).toBe(BOSS.thiefKing.fenceHp);
    }
  });

  it("開き直ると柵がすべて崩れて歩けるように戻る", () => {
    const { state, boss } = bossFloor();
    boss.phase = "chase";
    boss.hp = Math.floor(boss.maxHp * BOSS.thiefKing.phase2Ratio) - 1;
    tick(state);
    expect(fences(state).length).toBeGreaterThan(0);
    boss.hp = Math.floor(boss.maxHp * BOSS.thiefKing.phase3Ratio) - 1;
    tick(state);
    expect(boss.ai?.stage).toBe(3);
    tick(state);
    expect(fences(state), "柵は残らない").toHaveLength(0);
    expect(state.lockedTiles.size, "壁の予約も戻る").toBe(0);
  });
});

describe("盗賊王: 開き直りの連撃", () => {
  it("突進は壁に当たらなければもう 1 度、最初からコミットして続き、その後は続かない", () => {
    const { state, boss } = bossFloor();
    setStage(boss, 3);
    soloBoss(state, boss);
    placePlayer(state, boss, 60);
    startMove(state, boss, THIEF_DASH);
    let chained = false;
    for (let i = 0; i < 300 && !chained; i++) {
      tick(state);
      chained = boss.phase === "windup" && (boss.ai?.chain ?? 0) === 1;
    }
    expect(chained, "続きの予備動作へ").toBe(true);
    expect(boss.chainWindup, "最初からコミット").toBe(true);
    expect(boss.ai?.move).toBe(THIEF_DASH);
    for (let i = 0; i < 300 && boss.phase !== "recover"; i++) tick(state);
    expect(boss.phase, "2 度目の後は硬直").toBe("recover");
    expect(boss.ai?.chain, "続けるのは 1 回だけ").toBe(BOSS.thiefKing.dashChain);
  });

  it("壁に激突した突進は続かず、ダウンする", () => {
    const { state, boss } = bossFloor();
    setStage(boss, 3);
    soloBoss(state, boss);
    boss.body.pos = wallSide(state, boss);
    state.player.body.pos = { x: boss.body.pos.x - 20, y: boss.body.pos.y };
    startMove(state, boss, THIEF_DASH);
    for (let i = 0; i < 300 && boss.phase !== "strike"; i++) tick(state);
    for (let i = 0; i < 60 && boss.phase === "strike"; i++) tick(state);
    expect(isStaggered(boss), "壁激突のダウン").toBe(true);
    expect(boss.ai?.chain ?? 0, "続きの予備動作に入っていない").toBe(0);
    expect(boss.phase).not.toBe("windup");
  });

  it("怒りの扇は続けてもう 1 扇", () => {
    const { state, boss } = bossFloor();
    setStage(boss, 3);
    soloBoss(state, boss);
    placePlayer(state, boss, 40);
    startMove(state, boss, THIEF_KNIFE);
    const before = state.projectiles.length;
    for (let i = 0; i < 300 && !(boss.phase === "windup" && (boss.ai?.chain ?? 0) === 1); i++) tick(state);
    expect(boss.chainWindup, "続きはコミット済み").toBe(true);
    expect(state.projectiles.length - before, "最初の扇").toBe(BOSS.thiefKing.rageKnifeCount);
  });
});

describe("盗賊王: 一撃離脱", () => {
  it("第 1・2 段階は硬直の間にプレイヤーから離れる", () => {
    for (const stage of [1, 2]) {
      const { state, boss } = bossFloor();
      soloBoss(state, boss);
      setStage(boss, stage);
      placePlayer(state, boss, 40);
      boss.phase = "recover";
      boss.phaseTimer = 5;
      const x = boss.body.pos.x;
      tick(state, 20);
      expect(boss.body.pos.x, `第 ${stage} 段階`).toBeGreaterThan(x);
    }
  });

  it("第 3 段階（開き直り）は硬直の間に離れない", () => {
    const { state, boss } = bossFloor();
    soloBoss(state, boss);
    setStage(boss, 3);
    placePlayer(state, boss, 40);
    boss.phase = "recover";
    boss.phaseTimer = 5;
    const x = boss.body.pos.x;
    tick(state, 20);
    expect(boss.body.pos.x).toBe(x);
  });
});
