import { describe, expect, it } from "vitest";
import type { GameState, Projectile } from "../core/state";
import { ELEMENT_FX_COLOR, spawnBlast } from "../system/effects";
import { arena, placeEnemy } from "../system/testHelpers";
import { attackFxCounts, bulletStyleOf, isBoltColor, particleLook, syncAttackFx } from "./fxAttack";

const TICK = 1 / 60;

/** ゲームを 1 tick 進めたことにする（描画側の記録は tick の変わり目でしか働かない） */
function advance(state: GameState): void {
  state.tick += 1;
  state.time += TICK;
}

function playerShot(state: GameState, id: number, life = 1): Projectile {
  const p = state.player.body.pos;
  return {
    id,
    owner: "player",
    pos: { x: p.x + 8, y: p.y },
    vel: { x: 300, y: 0 },
    radius: 2,
    damage: 1,
    life,
    color: "#a0e0ff",
    kind: "ranged",
    hitIds: new Set(),
    pierceLeft: 0,
  };
}

describe("syncAttackFx（前の tick からの変化で演出を作る）", () => {
  it("最初の 1 回は記録だけで、演出を出さない", () => {
    const state = arena();
    const e = placeEnemy(state, "boar", 20);
    e.hitFlash = 0.1;
    syncAttackFx(state);
    expect(attackFxCounts(state).events.impact, "既に光っている敵は命中にしない").toBe(0);
  });

  it("敵の hitFlash が立ち上がると命中の火花が出る（振っていなければ着弾の形）", () => {
    const state = arena();
    const e = placeEnemy(state, "boar", 20);
    syncAttackFx(state);
    advance(state);
    e.hitFlash = 0.1;
    syncAttackFx(state);
    expect(attackFxCounts(state).events.impact).toBe(1);
  });

  it("同じ tick に何度呼んでも 1 回しか数えない", () => {
    const state = arena();
    const e = placeEnemy(state, "boar", 20);
    syncAttackFx(state);
    advance(state);
    e.hitFlash = 0.1;
    syncAttackFx(state);
    syncAttackFx(state);
    expect(attackFxCounts(state).events.impact).toBe(1);
  });

  it("プレイヤーの弾が出ると銃口の閃光、消えると着弾（寿命が尽きたら小さな煙）", () => {
    const state = arena();
    syncAttackFx(state);
    advance(state);
    state.projectiles.push(playerShot(state, 9001), playerShot(state, 9002, TICK / 2));
    syncAttackFx(state);
    expect(attackFxCounts(state).events.muzzle, "同じ位置から出た弾は 1 つにまとめる").toBe(1);
    advance(state);
    state.projectiles = [];
    syncAttackFx(state);
    const counts = attackFxCounts(state).events;
    expect(counts.impact, "当たって消えた弾").toBe(1);
    expect(counts.fizzle, "寿命が尽きた弾").toBe(1);
  });

  it("爆発（spawnBlast）の輪を見つけると焦げ跡を残す", () => {
    const state = arena();
    syncAttackFx(state);
    advance(state);
    spawnBlast(state, state.player.body.pos, 30, "#ffb040");
    syncAttackFx(state);
    expect(attackFxCounts(state).scorches).toBe(1);
  });

  it("階が変わったら記録を捨て、その tick は演出を出さない", () => {
    const state = arena();
    const e = placeEnemy(state, "boar", 20);
    syncAttackFx(state);
    advance(state);
    state.map = { ...state.map };
    e.hitFlash = 0.1;
    syncAttackFx(state);
    expect(attackFxCounts(state).events.impact).toBe(0);
  });

  it("state の乱数・粒・形を変えない（描画側の記録だけ）", () => {
    const make = (): GameState => {
      const state = arena();
      placeEnemy(state, "boar", 20);
      return state;
    };
    const a = make();
    const b = make();
    syncAttackFx(a);
    advance(a);
    const e = a.enemies[0];
    if (e) e.hitFlash = 0.1;
    syncAttackFx(a);
    expect(attackFxCounts(a).events.impact, "演出は出ている").toBe(1);
    expect(a.particles.length).toBe(b.particles.length);
    expect(a.shapes.length).toBe(b.shapes.length);
    expect(a.rng.next(), "乱数列は同じ seed の別の state と揃ったまま").toBe(b.rng.next());
  });
});

describe("見た目の系統", () => {
  it("弾の性質から系統を 1 つ選ぶ（爆発 > 溜め > 貫通 > 散弾）", () => {
    expect(bulletStyleOf([])).toBe("plain");
    expect(bulletStyleOf(["spread"])).toBe("spread");
    expect(bulletStyleOf(["spread", "pierce"])).toBe("pierce");
    expect(bulletStyleOf(["charge", "pierce"])).toBe("charge");
    expect(bulletStyleOf(["lob"])).toBe("lob");
    expect(bulletStyleOf(["mine", "lob"])).toBe("mine");
  });

  it("属性の色の粒は属性ごとの形、知らない色は四角", () => {
    expect(particleLook(ELEMENT_FX_COLOR.fire)).toBe("ember");
    expect(particleLook(ELEMENT_FX_COLOR.ice)).toBe("shard");
    expect(particleLook(ELEMENT_FX_COLOR.lightning)).toBe("spark");
    expect(particleLook(ELEMENT_FX_COLOR.poison)).toBe("bubble");
    expect(particleLook(ELEMENT_FX_COLOR.dark)).toBe("mote");
    expect(particleLook(ELEMENT_FX_COLOR.light)).toBe("glint");
    expect(particleLook("#123456")).toBe("square");
  });

  it("雷の色の線だけ枝分かれの稲妻にする", () => {
    expect(isBoltColor(ELEMENT_FX_COLOR.lightning)).toBe(true);
    expect(isBoltColor(ELEMENT_FX_COLOR.lightning.toUpperCase()), "大文字でも同じ").toBe(true);
    expect(isBoltColor("#ffffff"), "斬撃の残像の線は稲妻にしない").toBe(false);
  });
});
