import { describe, expect, it } from "vitest";
import { createGame, step } from "../core/game";
import { FIXED_DT } from "../core/loop";
import type { Enemy, GameState, Jin } from "../core/state";
import { enemyDef } from "../data/enemies";
import { roleOf } from "../data/enemyRoles";
import { formationDef } from "../data/formations";
import { REACTION } from "../data/tuning";
import { rectCenterPx } from "../map/grid";
import { behaviorOf } from "./behaviors/registry";
import { buildFloor } from "./floor";
import { rotateYokeRow } from "./jinFormations";
import { spawnJin } from "./jinSpawn";
import { arena, placeEnemy, withInput } from "./testHelpers";

/** 衡軛の列の入れ替え（system/jinFormations.ts。behaviors/base.ts の onRecoverEnd から呼ばれる） */

const ROTATE = formationDef("yoke")?.rotate;

function jinOf(formation: Jin["formation"], id = 1): Jin {
  return {
    id,
    roomIndex: 0,
    formation,
    center: { x: 0, y: 0 },
    facing: { x: 1, y: 0 },
    leaderId: null,
    hpMul: 1,
    morale: 10,
    moraleMax: 10,
    phase: "engaged",
    secondWaveAt: null,
    deathsTick: -1,
    deathsInTick: 0,
  };
}

/** プレイヤーから dx の位置に、同じ陣・追跡中の敵を置く */
function member(state: GameState, key: string, dx: number, jinId = 1): Enemy {
  const e = placeEnemy(state, key, dx);
  e.jinId = jinId;
  e.phase = "chase";
  e.attackCooldown = 1.2;
  return e;
}

function yokeArena(): GameState {
  const state = arena();
  state.jins = [jinOf("yoke")];
  return state;
}

describe("衡軛の列の入れ替え", () => {
  it("陣形の JSON に入れ替えの数値がある（restMul は 1 より大きく、stepInCooldown は正）", () => {
    expect(ROTATE, "yoke.rotate").toBeDefined();
    expect(ROTATE?.restMul ?? 0).toBeGreaterThan(1);
    expect(ROTATE?.stepInCooldown ?? 0).toBeGreaterThan(0);
  });

  it("隙を終えた前列は次の攻撃まで間を置いて下がり、後ろの最も近い前衛が前へ出る", () => {
    const state = yokeArena();
    const front = member(state, "slime", 40);
    const near = member(state, "slime", 70);
    const far = member(state, "slime", 100);
    rotateYokeRow(state, front, enemyDef("slime"));
    expect(front.attackCooldown, "下がる側は間を置く").toBeGreaterThanOrEqual(enemyDef("slime").attackInterval * (ROTATE?.restMul ?? 0));
    expect(front.ai?.retreat, "下がる動きは間合い取りと同じ仕組み").toBe(REACTION.retreatSec);
    expect(near.attackCooldown, "前へ出る側は間を縮める").toBe(ROTATE?.stepInCooldown);
    expect(far.attackCooldown, "その後ろは動かさない").toBe(1.2);
  });

  it("後ろに前衛がいなければ何も変えない", () => {
    const state = yokeArena();
    const front = member(state, "slime", 40);
    front.attackCooldown = 0.7;
    rotateYokeRow(state, front, enemyDef("slime"));
    expect(front.attackCooldown).toBe(0.7);
    expect(front.ai?.retreat ?? 0).toBe(0);
  });

  it("前より手前にいる仲間・攻撃中の仲間・射手・別の陣の敵は入れ替えの相手にならない", () => {
    const state = yokeArena();
    const rear = member(state, "slime", 90);
    const ahead = member(state, "slime", 20);
    const striking = member(state, "slime", 100);
    striking.phase = "strike";
    const shooter = member(state, "eye", 110);
    const other = member(state, "slime", 120, 2);
    rotateYokeRow(state, rear, enemyDef("slime"));
    expect(ahead.attackCooldown).toBe(1.2);
    expect(striking.attackCooldown).toBe(1.2);
    expect(shooter.attackCooldown).toBe(1.2);
    expect(other.attackCooldown).toBe(1.2);
    expect(rear.attackCooldown, "相手がいないので変えない").toBe(1.2);
  });

  it("衡軛でない陣・陣に属さない敵・射手は入れ替えない", () => {
    const state = yokeArena();
    state.jins = [jinOf("fishScale")];
    const a = member(state, "slime", 40);
    const b = member(state, "slime", 80);
    rotateYokeRow(state, a, enemyDef("slime"));
    expect(b.attackCooldown, "魚鱗は入れ替えない").toBe(1.2);

    state.jins = [jinOf("yoke")];
    a.jinId = undefined;
    rotateYokeRow(state, a, enemyDef("slime"));
    expect(b.attackCooldown, "陣に属さない").toBe(1.2);

    const s = member(state, "eye", 30);
    rotateYokeRow(state, s, enemyDef("eye"));
    expect(b.attackCooldown, "射手は前列ではない").toBe(1.2);
  });

  it("陣が交戦中でなければ入れ替えない", () => {
    const state = yokeArena();
    const jin = state.jins[0];
    if (jin) jin.phase = "settled";
    const front = member(state, "slime", 40);
    const back = member(state, "slime", 80);
    rotateYokeRow(state, front, enemyDef("slime"));
    expect(back.attackCooldown).toBe(1.2);
  });

  it("既定の onRecoverEnd がフックになり、隙が明けた step で入れ替わる（toChase の再設定に上書きされない）", () => {
    const state = yokeArena();
    const front = member(state, "slime", 40);
    const back = member(state, "slime", 90);
    front.phase = "recover";
    front.phaseTimer = 0.001;
    step(state, withInput({}), FIXED_DT);
    expect(front.phase).toBe("chase");
    expect(front.attackCooldown, "toChase の間（攻撃間隔）より長い").toBeGreaterThan(enemyDef("slime").attackInterval);
    expect(back.attackCooldown, "後ろは短くなる").toBeLessThan(1.2);
    expect(behaviorOf(enemyDef("slime")).onRecoverEnd).toBeTypeOf("function");
  });

  it("同じ入力なら同じ結果（決定的）", () => {
    const run = (): number[] => {
      const state = yokeArena();
      const front = member(state, "slime", 40);
      const a = member(state, "slime", 70);
      const b = member(state, "slime", 100);
      rotateYokeRow(state, front, enemyDef("slime"));
      return [front.attackCooldown, a.attackCooldown, b.attackCooldown];
    };
    expect(run()).toEqual(run());
  });
});

describe("鋒矢の攻撃間隔のずらし", () => {
  const arrowhead = formationDef("arrowhead");
  const STAGGER = arrowhead?.cooldownStagger ?? 0;

  /** 開始の塊（敵のいない広い場所）に陣を置く */
  function placeJin(key: "arrowhead" | "fishScale", seed: number): { state: GameState; jin: Jin | null } {
    const state = createGame(seed);
    state.depth = 3;
    buildFloor(state);
    const def = formationDef(key);
    const room = state.rooms[0];
    if (!def || !room) throw new Error("陣形か開始の塊が無い");
    const jin = spawnJin(state, 0, def, 14, rectCenterPx(room.rect), { x: 1, y: 0 }, () => true, () => true);
    return { state, jin };
  }

  it("鋒矢は突撃だけの一列で、遅らせる秒が JSON にある", () => {
    expect(arrowhead?.layout).toBe("line");
    expect(STAGGER).toBeGreaterThan(0);
    expect(arrowhead?.slots.every((s) => s.role === "charge"), "突撃 1.0").toBe(true);
    expect(arrowhead?.slots.reduce((sum, s) => sum + s.share, 0)).toBeCloseTo(1, 6);
  });

  it("列の後ろのメンバーほど最初の攻撃間隔が cooldownStagger ずつ長い（基準は攻撃間隔）", () => {
    for (let seed = 1; seed <= 4; seed++) {
      const { state, jin } = placeJin("arrowhead", seed);
      const members = state.enemies.filter((e) => e.jinId === jin?.id).sort((a, b) => a.id - b.id);
      expect(members.length, `seed ${seed}`).toBeGreaterThanOrEqual(3);
      let prev = -1;
      for (const e of members) {
        const steps = (e.attackCooldown - enemyDef(e.defKey).attackInterval) / STAGGER;
        expect(Math.abs(steps - Math.round(steps)), `seed ${seed} 段数は整数`).toBeLessThan(1e-6);
        expect(Math.round(steps), `seed ${seed} 後ろほど大きい`).toBeGreaterThan(prev);
        prev = Math.round(steps);
      }
    }
  });

  it("ずらしの無い陣形（魚鱗）は乱数の基準のまま（攻撃間隔の 0.5〜1.5 倍）", () => {
    const { state, jin } = placeJin("fishScale", 1);
    const members = state.enemies.filter((e) => e.jinId === jin?.id);
    expect(members.length).toBeGreaterThan(0);
    for (const e of members) {
      const interval = enemyDef(e.defKey).attackInterval;
      expect(e.attackCooldown).toBeGreaterThanOrEqual(interval * 0.5 - 1e-9);
      expect(e.attackCooldown).toBeLessThanOrEqual(interval * 1.5 + 1e-9);
    }
  });

  it("同じ seed なら同じ配りになる（決定的）", () => {
    const snap = (): number[] => {
      const { state, jin } = placeJin("arrowhead", 2);
      return state.enemies.filter((e) => e.jinId === jin?.id).map((e) => e.attackCooldown);
    };
    expect(snap()).toEqual(snap());
  });
});

describe("鋒矢・衡軛の出現", () => {
  it("いくつかの seed で階を作ると鋒矢・衡軛の陣が出て、メンバーは陣形の役割に合う", () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 12; seed++) {
      const state = createGame(seed);
      state.depth = 4;
      buildFloor(state);
      for (const jin of state.jins) {
        if (jin.formation !== "arrowhead" && jin.formation !== "yoke") continue;
        seen.add(jin.formation);
        const roles = new Set(state.enemies.filter((e) => e.jinId === jin.id).map((e) => roleOf(enemyDef(e.defKey))));
        const allowed = jin.formation === "arrowhead" ? ["charge"] : ["vanguard", "shooter"];
        for (const r of roles) expect(allowed, `seed ${seed} ${jin.formation}`).toContain(r);
      }
    }
    expect([...seen].sort(), "12 seed で両方出る").toEqual(["arrowhead", "yoke"]);
  });
});
