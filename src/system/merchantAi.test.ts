import { describe, expect, it } from "vitest";
import { createGame } from "../core/game";
import { FIXED_DT } from "../core/loop";
import { type Enemy, type GameState, type Merchant, ROAMING_ROOM } from "../core/state";
import { enemyDef } from "../data/enemies";
import { ECONOMY } from "../data/tuning";
import { damageEnemy } from "./combat";
import { createEnemy } from "./enemies";
import { withBaseAreaMul } from "./floor";
import { merchantSheltered } from "./merchantAi";
import { updateProjectiles } from "./projectiles";

/** 怒っていない商人を誤って怒らせない仕組み（system/merchantAi.ts の shieldsMerchant） */

const LEFT = { x: -1, y: 0 };
const HIT = 1;

function game(): GameState {
  return withBaseAreaMul(() => createGame(3));
}

/** 市の商人だけを残した階（周りの陣を外す） */
function lonelyMerchant(): { state: GameState; m: Merchant; body: Enemy } {
  const state = game();
  const m = state.economy.merchants[0];
  if (!m) throw new Error("商人がいない");
  const body = state.enemies.find((e) => e.id === m.enemyId);
  if (!body) throw new Error("商人の体がない");
  state.enemies = [body];
  state.jins = [];
  return { state, m, body };
}

function strike(state: GameState, body: Enemy): void {
  damageEnemy(state, body, HIT, LEFT, 0, { kind: "melee" });
}

/** 商人のそばに敵を 1 体置く */
function addFoe(state: GameState, body: Enemy, dx: number): Enemy {
  const def = enemyDef("slime");
  const foe = createEnemy(state, def, { x: body.body.pos.x + dx, y: body.body.pos.y }, ROAMING_ROOM, false);
  state.enemies.push(foe);
  return foe;
}

describe("商人を誤って怒らせない", () => {
  it("平時の 1 発目は警告だけで、傷つかず怒らない", () => {
    const { state, m, body } = lonelyMerchant();
    const hp = body.hp;
    strike(state, body);
    expect(m.provoked, "怒らない").toBe(false);
    expect(body.hp, "傷つかない").toBe(hp);
    expect(m.warnedAt, "警告した時刻").toBe(state.time);
    expect(state.texts.some((t) => t.text === "手出し無用"), "警告の浮き文字").toBe(true);
  });

  it("警告の直後（同じ一振りの続き）は数えず、grace より後・window 以内の 2 発目で怒る", () => {
    const { state, m, body } = lonelyMerchant();
    strike(state, body);
    strike(state, body);
    expect(m.provoked, "続きの一撃では怒らない").toBe(false);
    state.time += ECONOMY.market.patience.grace + FIXED_DT;
    const hp = body.hp;
    strike(state, body);
    expect(m.provoked, "2 発目で怒る").toBe(true);
    expect(body.hp, "2 発目は傷が入る").toBeLessThan(hp);
  });

  it("window を過ぎると警告からやり直す", () => {
    const { state, m, body } = lonelyMerchant();
    strike(state, body);
    state.time += ECONOMY.market.patience.window + FIXED_DT;
    strike(state, body);
    expect(m.provoked).toBe(false);
    expect(m.warnedAt, "警告し直す").toBe(state.time);
  });

  it("近くに敵がいる間は何度殴っても当たらず、警告もしない", () => {
    const { state, m, body } = lonelyMerchant();
    addFoe(state, body, ECONOMY.market.patience.shelterRange - 10);
    const hp = body.hp;
    for (let i = 0; i < 5; i++) {
      strike(state, body);
      state.time += 1;
    }
    expect(merchantSheltered(state, body)).toBe(true);
    expect(m.provoked).toBe(false);
    expect(body.hp).toBe(hp);
    expect(m.warnedAt, "警告もしない").toBeUndefined();
  });

  it("遠くの敵・壺は交戦に数えない", () => {
    const { state, body } = lonelyMerchant();
    addFoe(state, body, ECONOMY.market.patience.shelterRange + 20);
    const pot = createEnemy(state, enemyDef("pot"), { x: body.body.pos.x + 10, y: body.body.pos.y }, ROAMING_ROOM, false);
    state.enemies.push(pot);
    expect(merchantSheltered(state, body)).toBe(false);
  });

  it("巻き添え（proc・継続ダメージ）では傷つかず怒らない", () => {
    const { state, m, body } = lonelyMerchant();
    const hp = body.hp;
    damageEnemy(state, body, HIT, LEFT, 0, { kind: "proc" });
    damageEnemy(state, body, HIT, LEFT, 0, { kind: "melee", silent: true });
    expect(body.hp).toBe(hp);
    expect(m.provoked).toBe(false);
    expect(m.warnedAt).toBeUndefined();
  });

  it("交戦中はプレイヤーの弾が商人を撃ち抜く（弾が消えない）", () => {
    const { state, body } = lonelyMerchant();
    addFoe(state, body, ECONOMY.market.patience.shelterRange - 10);
    const from = { x: body.body.pos.x - 6, y: body.body.pos.y };
    state.projectiles.push({
      id: 999_001,
      owner: "player",
      pos: from,
      vel: { x: 1, y: 0 },
      radius: 3,
      damage: HIT,
      life: 1,
      color: "#ffffff",
      kind: "ranged",
      hitIds: new Set(),
      pierceLeft: 0,
    });
    updateProjectiles(state, FIXED_DT);
    const pr = state.projectiles.find((p) => p.id === 999_001);
    expect(pr, "弾が残る").toBeDefined();
    expect(pr?.hitIds.has(body.id), "当てたことにしない").toBe(false);
  });

  it("怒った商人には普通に当たる", () => {
    const { state, m, body } = lonelyMerchant();
    m.provoked = true;
    addFoe(state, body, 10);
    const hp = body.hp;
    strike(state, body);
    expect(body.hp).toBeLessThan(hp);
  });
});
