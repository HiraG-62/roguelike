import { describe, expect, it } from "vitest";
import { createGame } from "../core/game";
import { FIXED_DT } from "../core/loop";
import type { GameState } from "../core/state";
import { length } from "../core/vec";
import { ELITE } from "../data/tuning";
import { updateEnemies } from "./enemies";
import { ELITE_PAIRS, chainPartners, eliteDisplayName, eliteSpeedMul, makeElite, makeElitePair, rollElite, updateElites } from "./elites";
import { tickMana } from "./mana";
import { applyStatus, hasStatus } from "./statusEffects";
import { terrainAt } from "./terrain";
import { arena, placeEnemy } from "./testHelpers";

function pushSkillCast(state: GameState): void {
  state.events.push({ kind: "onSkillCast", actor: "player", pos: { ...state.player.body.pos }, depth: 0, source: { kind: "skill", key: "frag" } });
}

describe("Wave 3 のエリート修飾子", () => {
  it("灼熱のは通った跡（背後）に炎を置き、自分の炎では焼けない", () => {
    const state = arena();
    const e = placeEnemy(state, "golem", 60);
    e.phase = "chase";
    makeElite(e, "searing");
    e.facing = { x: 1, y: 0 };
    updateElites(state, FIXED_DT);
    const back = { x: e.body.pos.x - e.body.radius * 2, y: e.body.pos.y };
    expect(terrainAt(state, back.x, back.y)).toBe("fire");
    applyStatus(state, { kind: "enemy", enemy: e }, { kind: "burn", stacks: 1, duration: 2, potency: 3 }, "env");
    expect(hasStatus(e.status, "burn")).toBe(false);
  });

  it("封魔のの輪の中ではマナが自然回復しない（輪の外では回復する）", () => {
    for (const inside of [true, false]) {
      const state = arena();
      const e = placeEnemy(state, "golem", inside ? 30 : 200);
      e.phase = "chase";
      makeElite(e, "hexing");
      state.player.mana = 10;
      for (let i = 0; i < 60; i++) {
        tickMana(state, FIXED_DT);
        updateElites(state, FIXED_DT);
      }
      if (inside) expect(state.player.mana, "輪の中").toBeCloseTo(10, 5);
      else expect(state.player.mana, "輪の外").toBeGreaterThan(10);
    }
  });

  it("号令のが予備動作に入ると、周りで攻撃を待つ敵も一斉に予備動作へ入る", () => {
    const state = arena();
    const leader = placeEnemy(state, "slime", 30);
    makeElite(leader, "commanding");
    leader.phase = "chase";
    leader.attackCooldown = 0;
    const ally = placeEnemy(state, "golem", 90, 20);
    ally.phase = "chase";
    ally.attackCooldown = ELITE.commandCooldownMax / 2;
    updateEnemies(state, FIXED_DT);
    expect(leader.phase).toBe("windup");
    expect(ally.phase, "号令で揃う").toBe("windup");
  });

  it("見切りのはスキルの発動に反応して横へ跳ぶ（間隔の内は跳ばない）", () => {
    const state = arena();
    const e = placeEnemy(state, "golem", 60);
    e.phase = "chase";
    makeElite(e, "evasive");
    pushSkillCast(state);
    updateElites(state, FIXED_DT);
    expect(length(e.knock)).toBeGreaterThan(0);
    e.knock = { x: 0, y: 0 };
    updateElites(state, FIXED_DT);
    expect(length(e.knock), "間隔の内").toBe(0);
  });

  it("鎖縛のは近くの敵と鎖でつながり、鎖に触れると冷え、鎖は感電を伝える", () => {
    const state = arena();
    const c = placeEnemy(state, "golem", -30);
    c.phase = "chase";
    makeElite(c, "chaining");
    const o = placeEnemy(state, "golem", 30);
    o.phase = "chase";
    expect(chainPartners(state, c)).toContain(o);
    updateElites(state, FIXED_DT);
    expect(hasStatus(state.player.status, "chill"), "鎖に触れた").toBe(true);
    applyStatus(state, { kind: "enemy", enemy: o }, { kind: "shock", stacks: 1, duration: 3, potency: 3 }, "player");
    updateElites(state, FIXED_DT);
    expect(hasStatus(c.status, "shock"), "鎖を伝う").toBe(true);
  });
});

describe("修飾子の相乗（深層で 2 つ重なる）", () => {
  it("炎の柱（灼熱の + 不動の）はその場に根を張り、足元に炎の輪を予告してから置く", () => {
    const state = arena();
    const e = placeEnemy(state, "golem", 60);
    e.phase = "chase";
    makeElitePair(e, "searing", "anchored");
    expect(eliteSpeedMul(e)).toBe(0);
    expect(eliteDisplayName(e)).toContain("灼熱の不動の");
    updateElites(state, FIXED_DT);
    expect(state.terrainSeeds?.some((s) => s.kind === "fire" && s.radius === ELITE.pyreRadius)).toBe(true);
  });

  it("封魔の + 障壁の: 障壁がある間は輪の中のマナが減っていく", () => {
    const state = arena();
    const e = placeEnemy(state, "golem", 30);
    e.phase = "chase";
    makeElitePair(e, "hexing", "shielded");
    expect(e.shieldMax ?? 0).toBeGreaterThan(0);
    state.player.mana = 50;
    updateElites(state, 1);
    expect(state.player.mana).toBeLessThanOrEqual(50 - ELITE.hexDrain + 1e-6);
  });

  it("見切りの + 迅速の: 跳ぶ距離が伸びる", () => {
    const hop = (pair: boolean): number => {
      const state = arena();
      const e = placeEnemy(state, "golem", 60);
      e.phase = "chase";
      if (pair) makeElitePair(e, "evasive", "hasted");
      else makeElite(e, "evasive");
      pushSkillCast(state);
      updateElites(state, FIXED_DT);
      return length(e.knock);
    };
    expect(hop(true)).toBeGreaterThan(hop(false));
  });

  it("深層では一部のエリートが相乗の組で湧く（浅い階では重ならない）", () => {
    const count = (depth: number): number => {
      const state = createGame(7);
      state.depth = depth;
      state.enemies = [];
      let pairs = 0;
      for (let i = 0; i < 400; i++) {
        const e = placeEnemy(state, "golem", 1000 + i, 0);
        rollElite(state, e);
        if (e.eliteExtra === undefined) continue;
        pairs += 1;
        expect(ELITE_PAIRS.some(([a, b]) => a === e.elite && b === e.eliteExtra)).toBe(true);
      }
      return pairs;
    };
    expect(count(ELITE.pairMinDepth - 1)).toBe(0);
    expect(count(20)).toBeGreaterThan(0);
  });

  it("被弾していた敵がエリートになっても HP の割合を保つ", () => {
    const state = arena();
    const e = placeEnemy(state, "golem", 60);
    e.hp = Math.round(e.maxHp * 0.5);
    makeElite(e, "linked");
    expect(e.hp / e.maxHp).toBeCloseTo(0.5, 1);
  });
});
