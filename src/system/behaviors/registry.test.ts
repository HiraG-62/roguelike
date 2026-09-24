import { describe, expect, it } from "vitest";
import { ENEMIES, enemyDef } from "../../data/enemies";
import { ENEMY_AI } from "../../data/tuning";
import { arena, placeEnemy } from "../testHelpers";
import { EnemyBehaviorBase } from "./base";
import { BEHAVIORS, behaviorOf } from "./registry";

/** 旗持ちの「近距離」「遠距離」として十分に離れた距離（px） */
const NEAR = 10;
const FAR = 200;

describe("敵の振る舞いの登録表", () => {
  it("EnemyBehavior のすべての key に振る舞いが登録され、インスタンスの key と一致する", () => {
    for (const [key, b] of Object.entries(BEHAVIORS)) {
      expect(b, `${key} は EnemyBehaviorBase の子`).toBeInstanceOf(EnemyBehaviorBase);
      expect(b.key, `${key} の登録とインスタンスの key`).toBe(key);
    }
    for (const def of ENEMIES) {
      expect(behaviorOf(def), `${def.key} の behavior ${def.behavior} が登録されている`).toBeDefined();
    }
  });

  it("振る舞いのインスタンスは凍結されていて、フィールドを書き換えると例外になる", () => {
    expect(Object.isFrozen(BEHAVIORS), "登録表そのもの").toBe(true);
    for (const b of Object.values(BEHAVIORS)) {
      expect(Object.isFrozen(b), `${b.key} が凍結されている`).toBe(true);
    }
    // 型の上では readonly なので、書き換えを試すために可変の形へ見なす
    const chaser = BEHAVIORS.chaser as unknown as { strikeSpeedMul: number; extra?: number };
    expect(() => {
      chaser.strikeSpeedMul = 1;
    }).toThrow();
    expect(() => {
      chaser.extra = 1;
    }).toThrow();
    expect(BEHAVIORS.chaser.strikeSpeedMul).toBe(4.6);
  });

  it("基本パラメータは移行前の表と同じ（chaser 4.6、charger 7.5、bat の windupMoveMul 0.3、echoStriker の keepAway は ENEMY_AI.echoStriker.keepAway、graveBell は stationary、laser は silenceable）", () => {
    expect(BEHAVIORS.chaser.strikeSpeedMul).toBe(4.6);
    expect(BEHAVIORS.charger.strikeSpeedMul).toBe(7.5);
    expect(BEHAVIORS.bat.windupMoveMul).toBe(0.3);
    expect(BEHAVIORS.bat.strikeSpeedMul).toBe(3.2);
    expect(BEHAVIORS.wisp.strikeSpeedMul).toBe(3);
    expect(BEHAVIORS.knight.strikeSpeedMul).toBe(ENEMY_AI.knight.lungeSpeedMul);
    expect(BEHAVIORS.echoStriker.keepAway).toBe(ENEMY_AI.echoStriker.keepAway);
    expect(BEHAVIORS.chaser.keepAway, "保たない behavior は undefined").toBeUndefined();
    expect(BEHAVIORS.graveBell.stationary).toBe(true);
    expect(BEHAVIORS.graveBell.silenceable).toBe(true);
    expect(BEHAVIORS.laser.silenceable).toBe(true);
    expect(BEHAVIORS.laser.stationary).toBe(false);
    expect(BEHAVIORS.mineLayer.silenceable, "地雷撒きは沈黙で止まらない").toBe(false);
    expect(BEHAVIORS.forgeMaster.silenceable, "炎の鍛冶は沈黙で止まらない").toBe(false);
    expect(BEHAVIORS.forgeMaster.keepAway).toBe(ENEMY_AI.forgeMaster.keepAway);
  });

  it("地雷撒きは攻撃を始めず、旗持ちは旗が立っている間は近距離だけ攻撃を始める", () => {
    const state = arena();
    const layerDef = enemyDef("mineLayer");
    const layer = placeEnemy(state, "mineLayer", 30);
    expect(behaviorOf(layerDef).canBeginAttack(state, layer, layerDef, NEAR)).toBe(false);

    const bearerDef = enemyDef("bannerBearer");
    const bearer = placeEnemy(state, "bannerBearer", 30);
    const b = behaviorOf(bearerDef);
    expect(b.canBeginAttack(state, bearer, bearerDef, FAR), "旗が無ければ遠くても始める").toBe(true);
    const banner = placeEnemy(state, "banner", -30);
    banner.leaderId = bearer.id;
    expect(b.canBeginAttack(state, bearer, bearerDef, FAR), "旗があれば遠くからは始めない").toBe(false);
    expect(b.canBeginAttack(state, bearer, bearerDef, NEAR), "旗があっても近ければ始める").toBe(true);
  });
});
