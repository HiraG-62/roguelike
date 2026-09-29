import { describe, expect, it } from "vitest";
import { enemyDef } from "../data/enemies";
import { ENEMY_TEMPO, TELEGRAPH } from "../data/tuning";
import { telegraphColor, telegraphLineDir } from "../render/telegraphLineUi";
import { behaviorOf } from "./behaviors/registry";
import { enemyTelegraph } from "./enemies";
import { arena, placeEnemy } from "./testHelpers";

/** 線の長さの期待値: 攻撃中に届く距離を最短〜最長に丸める */
function expectedLength(key: string): number {
  const def = enemyDef(key);
  const reach = def.speed * behaviorOf(def).strikeSpeedMul * def.strikeTime;
  return Math.max(TELEGRAPH.minLength, Math.min(TELEGRAPH.maxLength, reach));
}

describe("予告の線の長さ", () => {
  it("スライム・狼・猪・蝙蝠は線を返し、長さは届く距離（speed × 倍率 × strikeTime）を丸めた値", () => {
    const state = arena();
    for (const key of ["slime", "wolf", "boar", "shadowBat"]) {
      const tele = enemyTelegraph(placeEnemy(state, key, 100), enemyDef(key));
      expect(tele?.kind, `${key} は線`).toBe("line");
      if (tele?.kind !== "line") continue;
      expect(tele.length, `${key} の長さ`).toBeCloseTo(expectedLength(key), 5);
    }
  });

  it("突進の猪の線は最長で頭打ちになり、近接の雑魚は最短以上", () => {
    const state = arena();
    const boar = enemyTelegraph(placeEnemy(state, "boar", 100), enemyDef("boar"));
    expect(boar?.kind === "line" ? boar.length : 0).toBeLessThanOrEqual(TELEGRAPH.maxLength);
    const slime = enemyTelegraph(placeEnemy(state, "slime", 100), enemyDef("slime"));
    expect(slime?.kind === "line" ? slime.length : 0).toBeGreaterThanOrEqual(TELEGRAPH.minLength);
  });

  it("射撃の敵（eye）は従来どおり線を出さない", () => {
    const state = arena();
    expect(enemyTelegraph(placeEnemy(state, "eye", 100), enemyDef("eye"))).toBeNull();
  });

  it("届く距離を持たない技の線（ボス）は fallbackLength", () => {
    const state = arena();
    const e = placeEnemy(state, "oilKing", 100);
    if (!e.ai) throw new Error("ai が無い");
    e.ai.move = 1;
    const tele = enemyTelegraph(e, enemyDef("oilKing"));
    if (tele?.kind !== "line") return;
    expect(tele.length).toBe(TELEGRAPH.fallbackLength);
  });
});

describe("予告の向きと色", () => {
  it("狙いを固定しない敵の線は今のプレイヤー方向、固定する敵は strikeDir のまま", () => {
    const state = arena();
    const e = placeEnemy(state, "slime", 100);
    e.strikeDir = { x: 0, y: 1 };
    const toPlayer = telegraphLineDir(e, false, state.player.body.pos);
    expect(toPlayer.x, "プレイヤーは左").toBeCloseTo(-1, 5);
    expect(toPlayer.y).toBeCloseTo(0, 5);
    expect(telegraphLineDir(e, true, state.player.body.pos)).toEqual({ x: 0, y: 1 });
  });

  it("色は予備動作の前半が readyColor、コミット窓と攻撃中が commitColor", () => {
    const state = arena();
    const e = placeEnemy(state, "slime", 100);
    e.phase = "windup";
    e.windupTotal = 1;
    e.phaseTimer = 1;
    expect(telegraphColor(e)).toBe(TELEGRAPH.readyColor);
    e.phaseTimer = ENEMY_TEMPO.commitRatio - 0.05;
    expect(telegraphColor(e)).toBe(TELEGRAPH.commitColor);
    e.phase = "strike";
    expect(telegraphColor(e)).toBe(TELEGRAPH.commitColor);
  });
});
