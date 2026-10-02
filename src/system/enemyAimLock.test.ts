import { describe, expect, it } from "vitest";
import { FIXED_DT } from "../core/loop";
import type { Enemy, GameState } from "../core/state";
import { ENEMY_TEMPO } from "../data/tuning";
import { enemyDef } from "../data/enemies";
import { telegraphLineDir } from "../render/telegraphLineUi";
import { aimStillTracking, updateEnemies } from "./enemies";
import { aimLockSec } from "./poise";
import { arena, placeEnemy } from "./testHelpers";

/** 予備動作の長さ。固まる残り秒（aimLockSec 0.22 / 割合 0.35 → 0.35）より十分長くする */
const WINDUP_TOTAL = 1;
/** 固まる残り秒（WINDUP_TOTAL × aimLockRatio が aimLockSec を上回る前提） */
const LOCK = Math.max(ENEMY_TEMPO.aimLockSec, WINDUP_TOTAL * ENEMY_TEMPO.aimLockRatio);
const TICK_LIMIT = 200;

/** 予備動作の途中の敵を置く。プレイヤーは原点側、敵は右（向きは左へ向くはず） */
function windingUp(state: GameState, key: string, dx = 100, dy = 0): Enemy {
  const e = placeEnemy(state, key, dx, dy);
  e.phase = "windup";
  e.windupTotal = WINDUP_TOTAL;
  e.phaseTimer = WINDUP_TOTAL;
  e.attackCooldown = 0;
  e.strikeDir = { x: -1, y: 0 };
  return e;
}

function tick(state: GameState): void {
  updateEnemies(state, FIXED_DT);
}

/** 残りが固まる秒を少し切るまで回す */
function tickUntilLocked(state: GameState, e: Enemy): void {
  for (let i = 0; i < TICK_LIMIT && e.phaseTimer > LOCK - FIXED_DT * 2; i++) tick(state);
}

describe("固まる残り秒 aimLockSec", () => {
  it("長い予備動作は割合、短い予備動作は下限、極端に短ければ全体", () => {
    const e = placeEnemy(arena(), "slime", 100);
    e.windupTotal = 1;
    expect(aimLockSec(e), "長い予備動作は全体 × 割合").toBeCloseTo(ENEMY_TEMPO.aimLockRatio, 5);
    e.windupTotal = 0.4;
    expect(aimLockSec(e), "短い予備動作は下限").toBeCloseTo(Math.max(ENEMY_TEMPO.aimLockSec, 0.4 * ENEMY_TEMPO.aimLockRatio), 5);
    e.windupTotal = 0.1;
    expect(aimLockSec(e), "全体より長くは固まらない").toBeCloseTo(0.1, 5);
  });
});

describe("狙いの固まり（普通の敵）", () => {
  it("固まる前はプレイヤーの動きを追い、向きと顔が変わる", () => {
    const state = arena();
    const e = windingUp(state, "slime");
    state.player.body.pos.y += 60;
    tick(state);
    expect(e.phase, "まだ予備動作").toBe("windup");
    expect(e.strikeDir.y, "プレイヤーの方（下）へ向く").toBeGreaterThan(0.2);
    expect(e.facing.x, "顔は左").toBeLessThan(0);
  });

  it("固まった後に横へ動いても向きが変わらない", () => {
    const state = arena();
    const e = windingUp(state, "slime");
    tickUntilLocked(state, e);
    expect(aimStillTracking(e, enemyDef("slime")), "固まっている").toBe(false);
    const locked = { ...e.strikeDir };
    state.player.body.pos.y += 80;
    for (let i = 0; i < 3; i++) tick(state);
    expect(e.strikeDir, "向きは固まったまま").toEqual(locked);
  });

  it("予告の線は strikeDir を指し、追尾 → 停止 → その向きの攻撃と一致する", () => {
    const state = arena();
    const e = windingUp(state, "slime");
    const def = enemyDef("slime");
    state.player.body.pos.y += 40;
    tick(state);
    expect(telegraphLineDir(e, def, state.player.body.pos), "追尾中の線は strikeDir").toEqual(e.strikeDir);
    tickUntilLocked(state, e);
    const locked = { ...e.strikeDir };
    state.player.body.pos.y -= 100;
    expect(telegraphLineDir(e, def, state.player.body.pos), "固まった後の線は動かない").toEqual(locked);
    for (let i = 0; i < TICK_LIMIT && e.phase === "windup"; i++) tick(state);
    expect(e.phase).toBe("strike");
    expect(e.strikeDir, "攻撃も固まった向き").toEqual(locked);
  });

  it("攻撃（射撃の弾）は固まった向きに出る", () => {
    const state = arena();
    const e = windingUp(state, "eye", 100, 0);
    tickUntilLocked(state, e);
    const locked = { ...e.strikeDir };
    // 固まった後にプレイヤーが真下へ回り込んでも、弾は固まった向きへ
    state.player.body.pos.x = e.body.pos.x;
    state.player.body.pos.y = e.body.pos.y + 100;
    state.projectiles.length = 0;
    for (let i = 0; i < TICK_LIMIT && state.projectiles.length === 0; i++) tick(state);
    const bullet = state.projectiles.find((p) => p.owner === "enemy");
    expect(bullet, "弾が出る").toBeDefined();
    if (!bullet) return;
    const speed = Math.hypot(bullet.vel.x, bullet.vel.y);
    expect(bullet.vel.x / speed, "弾の向き x").toBeCloseTo(locked.x, 3);
    expect(bullet.vel.y / speed, "弾の向き y").toBeCloseTo(locked.y, 3);
  });

  it("同時攻撃の上限で待たされて残りが短く戻っても、再び追わない", () => {
    const state = arena();
    const e = windingUp(state, "slime");
    tickUntilLocked(state, e);
    const locked = { ...e.strikeDir };
    e.phaseTimer = LOCK / 2;
    state.player.body.pos.y += 80;
    tick(state);
    expect(e.strikeDir, "固まったまま").toEqual(locked);
  });
});

describe("aimTracking の敵", () => {
  it("砲台は aimTracking を持ち、スライムは持たない", () => {
    expect(enemyDef("turret").aimTracking).toBe(true);
    expect(enemyDef("slime").aimTracking).toBeUndefined();
  });

  it("固まる残りを切っても攻撃の瞬間までプレイヤーを追う", () => {
    const state = arena();
    const e = windingUp(state, "turret");
    tickUntilLocked(state, e);
    expect(aimStillTracking(e, enemyDef("turret")), "追い続ける").toBe(true);
    state.player.body.pos.y += 80;
    tick(state);
    expect(e.strikeDir.y, "固まる残りの後でもプレイヤーの方（下）へ向き直る").toBeGreaterThan(0.2);
  });

  it("砲台の弾は攻撃の瞬間のプレイヤーの方向へ出る", () => {
    const state = arena();
    const e = windingUp(state, "turret");
    tickUntilLocked(state, e);
    state.player.body.pos.y += 80;
    state.projectiles.length = 0;
    for (let i = 0; i < TICK_LIMIT && state.projectiles.length === 0; i++) tick(state);
    const bullet = state.projectiles.find((p) => p.owner === "enemy");
    expect(bullet, "弾が出る").toBeDefined();
    expect(bullet ? bullet.vel.y : 0, "弾は下へ向かう").toBeGreaterThan(0);
  });
});

describe("狙いを予備動作の始まりで固定する敵", () => {
  it("レーザー眼は予備動作の途中でプレイヤーが動いても向きが変わらない", () => {
    const state = arena();
    const e = windingUp(state, "laserEye");
    const def = enemyDef("laserEye");
    expect(aimStillTracking(e, def), "追わない").toBe(false);
    const start = { ...e.strikeDir };
    state.player.body.pos.y += 80;
    for (let i = 0; i < 10; i++) tick(state);
    expect(e.strikeDir, "始まりの向きのまま").toEqual(start);
  });
});

describe("手で phase を置いた敵（windupTotal の記録なし）", () => {
  it("従来どおり攻撃の瞬間まで追う", () => {
    const state = arena();
    const e = placeEnemy(state, "slime", 100);
    e.phase = "windup";
    e.phaseTimer = 0.05;
    e.windupTotal = 0;
    e.strikeDir = { x: 0, y: -1 };
    for (let i = 0; i < 5 && e.phase === "windup"; i++) tick(state);
    expect(e.strikeDir.x, "プレイヤー（左）を向く").toBeLessThan(-0.5);
  });
});
