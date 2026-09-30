import { describe, expect, it, vi } from "vitest";
import type { GameState } from "../core/state";
import { arena, placeEnemy } from "./testHelpers";
import { damagePlayer, damagePlayerDot, tickDelayedDamage } from "./combat";
import { grudgeOf, killerOf, nemesisEligible, noteHurt } from "./deathCause";
import { makeElitePair } from "./elites";
import { fireEnemyBullet } from "./enemyTraits";
import { updateProjectiles } from "./projectiles";
import { placeTerrain, updateTerrain } from "./terrain";
import { updateReaper } from "./reaper";
import { REAPER } from "../data/tuning";
import { FIXED_DT } from "../core/loop";
import { applyStatus, updateStatusEffects } from "./statusEffects";

/** 1 回の被弾で倒れる状態（無敵なし） */
function fragile(state: GameState): GameState {
  state.player.hp = 1;
  state.player.invulnTimer = 0;
  return state;
}

describe("被弾の記録と死因", () => {
  it("敵の近接で倒れると死因はその敵の一撃で、精鋭の修飾子も残る", () => {
    const state = fragile(arena());
    const e = placeEnemy(state, "slime", 20);
    makeElitePair(e, "hasted", "shielded");
    damagePlayer(state, 50, e.body.pos, e);
    expect(state.status, "倒れる").toBe("dead");
    expect(killerOf(state)).toEqual({ kind: "strike", key: "slime", elites: ["hasted", "shielded"], nemesis: false });
  });

  it("敵弾で倒れると死因は射撃で撃った敵の key を持ち、撃ち手が消えていれば key は空", () => {
    const state = fragile(arena());
    const shooter = placeEnemy(state, "slime", 60);
    const p = state.player.body.pos;
    fireEnemyBullet(state, { pos: { ...p }, dir: { x: 1, y: 0 }, speed: 0, damage: 50, color: "#fff", sourceId: shooter.id });
    updateProjectiles(state, FIXED_DT);
    expect(killerOf(state), "撃ち手の key").toEqual({ kind: "shot", key: "slime", elites: [], nemesis: false });

    const lone = fragile(arena());
    fireEnemyBullet(lone, { pos: { ...lone.player.body.pos }, dir: { x: 1, y: 0 }, speed: 0, damage: 50, color: "#fff", sourceId: 9999 });
    updateProjectiles(lone, FIXED_DT);
    expect(killerOf(lone)?.kind).toBe("shot");
    expect(killerOf(lone)?.key, "撃ち手が消えた弾は key が空（流れ弾）").toBe("");
  });

  it("燃焼の継続ダメージで倒れると死因は燃焼で、最後に殴った敵は lastEnemy に残る", () => {
    const state = arena();
    state.player.invulnTimer = 0;
    const e = placeEnemy(state, "wolf", 20);
    damagePlayer(state, 1, e.body.pos, e);
    expect(state.status).toBe("playing");
    state.player.hp = 1;
    applyStatus(state, { kind: "player" }, { kind: "burn", stacks: 5, duration: 5, potency: 50 }, "enemy");
    for (let i = 0; i < 120 && state.status === "playing"; i++) updateStatusEffects(state, FIXED_DT);
    expect(state.status, "燃焼で倒れる").toBe("dead");
    expect(killerOf(state)).toMatchObject({ kind: "status", key: "burn" });
    expect(state.hurt.lastEnemy?.key, "最後に殴った敵").toBe("wolf");
    expect(grudgeOf(state), "仇の種は最後に殴った敵").toEqual({ key: "wolf", elites: [] });
  });

  it("溶岩・死神・遅れて来る傷の死因の種類", () => {
    const lava = fragile(arena());
    const p = lava.player.body.pos;
    placeTerrain(lava, p.x, p.y, "lava", 24);
    for (let i = 0; i < 60 && lava.status === "playing"; i++) updateTerrain(lava, FIXED_DT);
    expect(killerOf(lava), "溶岩").toMatchObject({ kind: "terrain", key: "lava" });

    const reaper = fragile(arena());
    reaper.reaper = { pos: { ...reaper.player.body.pos }, radius: REAPER.radius, animTime: 0 };
    updateReaper(reaper, FIXED_DT);
    expect(killerOf(reaper), "死神").toMatchObject({ kind: "reaper", key: "reaper" });

    const deferred = fragile(arena());
    deferred.player.deferredDamage = [{ amount: 99, due: 0 }];
    tickDelayedDamage(deferred);
    expect(killerOf(deferred), "遅れて来る傷").toMatchObject({ kind: "deferred", key: "" });
  });

  it("潮・長居の影・落雷は呼び元が渡す出どころで記録する", () => {
    const tide = fragile(arena());
    damagePlayerDot(tide, 99, { kind: "terrain", key: "water" });
    expect(killerOf(tide)).toMatchObject({ kind: "terrain", key: "water" });

    const shadow = fragile(arena());
    damagePlayer(shadow, 99, shadow.player.body.pos, undefined, { noJust: true, cause: { kind: "linger", key: "shadow" } });
    expect(killerOf(shadow)).toMatchObject({ kind: "linger", key: "shadow" });

    const storm = fragile(arena());
    damagePlayer(storm, 99, storm.player.body.pos, undefined, { cause: { kind: "event", key: "thunderstorm" } });
    expect(killerOf(storm)).toMatchObject({ kind: "event", key: "thunderstorm" });
  });

  it("出どころの無い被弾は余波、力尽きていなければ死因は null", () => {
    const state = arena();
    state.player.invulnTimer = 0;
    damagePlayer(state, 1, state.player.body.pos);
    expect(state.hurt.last, "attacker も cause も無ければ余波").toMatchObject({ kind: "hazard", key: "" });
    expect(killerOf(state), "生きている間は null").toBeNull();
  });

  it("ボスに倒されると仇の種は lastEnemy の並の敵、それも無ければ null", () => {
    const state = fragile(arena());
    const goblin = placeEnemy(state, "wolf", 20);
    state.player.hp = 100;
    damagePlayer(state, 1, goblin.body.pos, goblin);
    const boss = placeEnemy(state, "kingSlime", 40);
    state.player.hp = 1;
    state.player.invulnTimer = 0;
    damagePlayer(state, 99, boss.body.pos, boss);
    expect(killerOf(state)?.key, "死因はボス").toBe("kingSlime");
    expect(grudgeOf(state), "仇の種はボスでなく並の敵").toEqual({ key: "wolf", elites: [] });

    const bossOnly = fragile(arena());
    const b = placeEnemy(bossOnly, "kingSlime", 40);
    damagePlayer(bossOnly, 99, b.body.pos, b);
    expect(grudgeOf(bossOnly), "並の敵がいなければ null").toBeNull();
  });

  it("仇になれない敵: ボス・片割れ・部屋主・商人・入れ物・設置物・未知の key", () => {
    expect(nemesisEligible("wolf")).toBe(true);
    for (const key of ["kingSlime", "twinSister", "mimic", "merchant", "nope", ""]) expect(nemesisEligible(key), key).toBe(false);
  });

  it("被弾の記録は乱数を引かない", () => {
    const state = arena();
    const e = placeEnemy(state, "slime", 20);
    const spy = vi.spyOn(state.rng, "next");
    noteHurt(state, e, undefined);
    noteHurt(state, undefined, { kind: "status", key: "burn" });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
