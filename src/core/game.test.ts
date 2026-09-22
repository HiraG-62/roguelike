import { describe, expect, it } from "vitest";
import { createGame, step } from "./game";
import { EMPTY_INPUT, type FrameInput } from "./input";
import { FIXED_DT } from "./loop";
import { PLAYER } from "../data/tuning";
import { enemyDef } from "../data/enemies";
import { createEnemy } from "../system/enemies";

function withInput(partial: Partial<FrameInput>): FrameInput {
  return { ...EMPTY_INPUT, move: { ...EMPTY_INPUT.move }, ...partial };
}

/** リプレイ検証用のざっくりしたハッシュ */
function fingerprint(state: ReturnType<typeof createGame>): string {
  const p = state.player.body.pos;
  return [
    state.tick,
    p.x.toFixed(3),
    p.y.toFixed(3),
    state.player.hp,
    state.enemies.length,
    state.enemies.map((e) => `${e.id}:${e.hp}:${e.body.pos.x.toFixed(2)}`).join(","),
    state.score,
  ].join("|");
}

describe("createGame", () => {
  it("同じ seed なら同じ初期状態", () => {
    const a = createGame(7);
    const b = createGame(7);
    expect(fingerprint(a)).toBe(fingerprint(b));
  });

  it("プレイヤーは開始部屋の中にいて、開始部屋には敵がいない", () => {
    const state = createGame(3);
    expect(state.rooms[0]?.cleared).toBe(true);
    expect(state.enemies.some((e) => e.roomIndex === 0)).toBe(false);
    expect(state.enemies.length).toBeGreaterThan(0);
  });
});

describe("step (決定性)", () => {
  it("同じ入力列なら同じ結果になる", () => {
    const run = (): string => {
      const state = createGame(99);
      for (let i = 0; i < 600; i++) {
        const input = withInput({
          move: { x: i % 120 < 60 ? 1 : -1, y: i % 200 < 100 ? 0 : 1 },
          attackPressed: i % 30 === 0,
          dashPressed: i % 90 === 0,
          shootHeld: i % 50 < 10,
        });
        step(state, input, FIXED_DT);
      }
      return fingerprint(state);
    };
    expect(run()).toBe(run());
  });
});

describe("player actions", () => {
  it("ダッシュ中は無敵で、クールダウンが付く", () => {
    const state = createGame(5);
    step(state, withInput({ dashPressed: true, move: { x: 1, y: 0 } }), FIXED_DT);
    expect(state.player.dashTimer).toBeGreaterThan(0);
    expect(state.player.invulnTimer).toBeGreaterThan(0);
    expect(state.player.dashCooldown).toBeGreaterThan(0);
  });

  it("攻撃ボタンでコンボ 1 段目が始まり、先行入力で 2 段目に繋がる", () => {
    const state = createGame(5);
    step(state, withInput({ attackPressed: true }), FIXED_DT);
    expect(state.player.attack.phase).toBe("windup");
    expect(state.player.attack.combo).toBe(0);
    const first = PLAYER.melee[0]!;
    const total = first.windup + first.active + first.recover;
    // recover の途中で押す
    const steps = Math.ceil((first.windup + first.active + first.recover * 0.8) / FIXED_DT);
    for (let i = 0; i < steps; i++) step(state, withInput({}), FIXED_DT);
    step(state, withInput({ attackPressed: true }), FIXED_DT);
    const rest = Math.ceil((total * 1.2) / FIXED_DT);
    let reachedSecond = false;
    for (let i = 0; i < rest; i++) {
      step(state, withInput({}), FIXED_DT);
      if (state.player.attack.combo === 1 && state.player.attack.phase !== "none") reachedSecond = true;
    }
    expect(reachedSecond).toBe(true);
  });

  it("目の前の敵を斬るとダメージが入りコンボが増える", () => {
    const state = createGame(5);
    const p = state.player;
    state.enemies = [createEnemy(state, enemyDef("slime"), { x: p.body.pos.x + 14, y: p.body.pos.y }, 0, false)];
    const enemy = state.enemies[0]!;
    const hpBefore = enemy.hp;
    p.facing = { x: 1, y: 0 };
    step(state, withInput({ attackPressed: true }), FIXED_DT);
    for (let i = 0; i < 20; i++) step(state, withInput({}), FIXED_DT);
    expect(enemy.hp).toBeLessThan(hpBefore);
    expect(state.combo.count).toBeGreaterThanOrEqual(1);
  });

  it("射撃で弾が出る", () => {
    const state = createGame(5);
    step(state, withInput({ shootHeld: true }), FIXED_DT);
    expect(state.projectiles.filter((pr) => pr.owner === "player")).toHaveLength(1);
  });
});

describe("floor / rooms", () => {
  it("部屋に入るとロックされ、敵を全滅させると解除される", async () => {
    const { rectCenterPx } = await import("../map/grid");
    const state = createGame(11);
    const room = state.rooms[1]!;
    state.player.body.pos = rectCenterPx(room.rect);
    step(state, withInput({}), FIXED_DT);
    expect(room.locked).toBe(true);
    expect(state.lockedTiles.size).toBeGreaterThan(0);
    for (const e of state.enemies) if (e.roomIndex === 1) e.hp = 0;
    step(state, withInput({}), FIXED_DT);
    expect(room.locked).toBe(false);
    expect(room.cleared).toBe(true);
    expect(state.lockedTiles.size).toBe(0);
  });

  it("階段に乗ると次の階へ進む", async () => {
    const { descend } = await import("../system/floor");
    const state = createGame(11);
    descend(state);
    expect(state.depth).toBe(2);
    expect(state.rooms[0]?.cleared).toBe(true);
  });

  it("ランダム入力で長時間回しても例外が出ない（スモーク）", async () => {
    const { createRng } = await import("./rng");
    const rng = createRng(2024);
    const state = createGame(2024);
    for (let i = 0; i < 4000; i++) {
      const input = withInput({
        move: { x: rng.int(-1, 1), y: rng.int(-1, 1) },
        attackPressed: rng.chance(0.1),
        dashPressed: rng.chance(0.05),
        shootHeld: rng.chance(0.3),
        specialPressed: rng.chance(0.02),
      });
      step(state, input, FIXED_DT);
      if (state.status === "dead") break;
    }
    expect(state.tick).toBeGreaterThan(0);
  });
});
