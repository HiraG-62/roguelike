import { describe, expect, it } from "vitest";
import { createGame, step } from "../core/game";
import { FIXED_DT } from "../core/loop";
import { type Enemy, type GameState, type Merchant, ROAMING_ROOM, type Ware, type WareKind } from "../core/state";
import { enemyDef } from "../data/enemies";
import { ARC, ECONOMY } from "../data/tuning";
import { TILE_SIZE, toIndex } from "../map/grid";
import { chapterScale } from "./economy";
import { damageEnemy } from "./combat";
import { isEngaged } from "./engagement";
import { buildFloor, withBaseAreaMul } from "./floor";
import { flaskCapacity } from "./flask";
import { MERCHANT_KEY, buyWare, dropFlask, frontRoomOrder, merchantKindFor, stockPlan, updateMerchants, wareLabel, warePrice } from "./merchants";
import { emitNoise } from "./noise";
import { withInput } from "./testHelpers";

/** 商人と市（system/merchants.ts。docs/ideas/economy-impl.md 2-5） */

const SEEDS = 8;
const RICH = 10_000;
const FAR = { x: -9999, y: -9999 };
/** ヒットストップが明けるのに十分なステップ数 */
const HITSTOP_STEPS = 20;

function game(seed = 3): GameState {
  return withBaseAreaMul(() => createGame(seed));
}

function merchantIn(state: GameState): Merchant {
  const m = state.economy.merchants[0];
  if (!m) throw new Error("商人がいない");
  return m;
}

function bodyOf(state: GameState, m: Merchant): Enemy {
  const e = state.enemies.find((x) => x.id === m.enemyId);
  if (!e) throw new Error("商人の体がない");
  return e;
}

function wareOf(m: Merchant, kind: WareKind): Ware {
  const w = m.wares.find((x) => x.kind === kind && !x.used);
  if (!w) throw new Error(`品がない: ${kind}`);
  return w;
}

/** 台座の真上に立って 1 ステップ（触れて買う経路） */
function touch(state: GameState, w: Ware): void {
  state.player.body.pos = { ...w.pos };
  updateMerchants(state);
}

function leave(state: GameState): void {
  state.player.body.pos = { ...FAR };
  updateMerchants(state);
}

function inRoom(state: GameState, index: number, pos: { x: number; y: number }): boolean {
  const room = state.rooms[index];
  if (!room) return false;
  const tx = Math.floor(pos.x / TILE_SIZE);
  const ty = Math.floor(pos.y / TILE_SIZE);
  if (room.tiles) return room.tiles.has(toIndex(state.map, tx, ty));
  const r = room.rect;
  return tx >= r.x && tx < r.x + r.w && ty >= r.y && ty < r.y + r.h;
}

describe("市を立てる", () => {
  it("毎階 1 人の商人が前室（最後の部屋に近い通常の部屋、取れなければ開始部屋）に立ち、部屋にも陣にも属さない", () => {
    for (let seed = 0; seed < SEEDS; seed++) {
      const state = game(seed);
      expect(state.economy.merchants, `seed=${seed}`).toHaveLength(1);
      const m = merchantIn(state);
      const body = bodyOf(state, m);
      expect(body.defKey, "体は商人").toBe(MERCHANT_KEY);
      expect(body.roomIndex, "部屋の制圧に数えない").toBe(ROAMING_ROOM);
      expect(body.jinId, "陣に属さない").toBeUndefined();
      const order = frontRoomOrder(state);
      const standsIn = [...order, 0].filter((i) => inRoom(state, i, m.pos));
      expect(standsIn.length, `seed=${seed} 前室の候補か開始部屋に立つ`).toBeGreaterThan(0);
      expect(m.wares.map((w) => w.kind), "市の品の並び").toEqual(stockPlan("market"));
    }
  });

  it("前室の候補は開始・最後の部屋を除く通常の部屋で、同じ seed なら同じ並び", () => {
    const a = game(4);
    const b = game(4);
    const order = frontRoomOrder(a);
    expect(order, "決定的").toEqual(frontRoomOrder(b));
    const last = a.rooms.length - 1;
    for (const i of order) {
      expect(i === 0 || i === last, "開始・最後は除く").toBe(false);
      expect(a.rooms[i]?.kind, "通常の部屋").toBe("normal");
    }
  });

  it("章ボスの階の前室は章の市（瓶が多い）", () => {
    const depth = ARC.floorsPerChapter;
    expect(merchantKindFor(depth)).toBe("chapterMarket");
    expect(merchantKindFor(depth - 1)).toBe("market");
    const state = game(2);
    state.depth = depth;
    buildFloor(state);
    const m = merchantIn(state);
    expect(m.kind).toBe("chapterMarket");
    const flasks = m.wares.filter((w) => w.kind === "flask").length;
    expect(flasks, "章の市の瓶").toBe(ECONOMY.market.stock.chapterMarket.flask);
  });

  it("値段は章の平均 × 揺らぎの範囲で、同じ seed なら同じ値段", () => {
    for (const depth of [1, ARC.floorsPerChapter + 2]) {
      const state = game(5);
      state.depth = depth;
      buildFloor(state);
      const again = game(5);
      again.depth = depth;
      buildFloor(again);
      const m = merchantIn(state);
      expect(m.wares.map((w) => w.price), "決定的").toEqual(merchantIn(again).wares.map((w) => w.price));
      for (const w of m.wares) {
        const mean = ECONOMY.price.base[w.kind] * chapterScale(depth);
        expect(w.base, `${w.kind} 下限`).toBeGreaterThanOrEqual(Math.round(mean * ECONOMY.price.spread.low) - 1);
        expect(w.base, `${w.kind} 上限`).toBeLessThanOrEqual(Math.round(mean * ECONOMY.price.spread.high) + 1);
        expect(w.price, "買う前は置いた値段").toBe(w.base);
      }
    }
  });

  it("品札は「瓶（40 銭）」の形", () => {
    const m = merchantIn(game());
    const w = wareOf(m, "flask");
    expect(wareLabel(w)).toBe(`瓶（${w.price} 銭）`);
  });
});

describe("台座に触れて買う", () => {
  it("瓶の台座に触れると銭を払って瓶が 1 本増え、台座は消える。触れっぱなしで 2 回は買わない", () => {
    const state = game();
    const m = merchantIn(state);
    const w = wareOf(m, "flask");
    state.player.flasks = 0;
    state.economy.coins = RICH;
    const price = w.price;
    leave(state);
    touch(state, w);
    touch(state, w);
    expect(w.used, "買った").toBe(true);
    expect(state.player.flasks).toBe(1);
    expect(state.economy.coins).toBe(RICH - price);
    expect(state.economy.spent.flask, "用途の集計").toBe(price);
    expect(state.economy.bought.flask, "買った回数").toBe(1);
  });

  it("銭が足りなければ買えず、台座も銭も残る", () => {
    const state = game();
    const m = merchantIn(state);
    const w = wareOf(m, "key");
    state.economy.coins = w.price - 1;
    leave(state);
    touch(state, w);
    expect(w.used).toBe(false);
    expect(state.economy.coins).toBe(w.price - 1);
    expect(state.economy.keys).toBe(0);
  });

  it("瓶が上限なら瓶は買えない", () => {
    const state = game();
    const m = merchantIn(state);
    const w = wareOf(m, "flask");
    state.player.flasks = flaskCapacity(state);
    state.economy.coins = RICH;
    expect(buyWare(state, m, w)).toBe(false);
    expect(state.economy.coins).toBe(RICH);
  });

  it("鍵・遺物・刻印符はそれぞれ鍵が増える・床に遺物・床に刻印符", () => {
    const state = game();
    const m = merchantIn(state);
    state.economy.coins = RICH;
    const items = state.floorItems.length;
    const runes = state.skills.runes.length;
    expect(buyWare(state, m, wareOf(m, "key"))).toBe(true);
    expect(buyWare(state, m, wareOf(m, "item"))).toBe(true);
    expect(buyWare(state, m, wareOf(m, "rune"))).toBe(true);
    expect(state.economy.keys).toBe(1);
    expect(state.floorItems.length).toBe(items + 1);
    expect(state.skills.runes.length).toBe(runes + 1);
  });

  it("同じ品は買うたびに repeatMul ずつ値上がりする（仕入れ直しで並べ直した瓶で確かめる）", () => {
    const state = game();
    const m = merchantIn(state);
    state.economy.coins = RICH;
    state.player.flasks = 0;
    const reroll = wareOf(m, "reroll");
    const rerollPrice = reroll.price;
    expect(buyWare(state, m, wareOf(m, "flask"))).toBe(true);
    expect(buyWare(state, m, reroll)).toBe(true);
    expect(reroll.used, "仕入れ直しは何度でも").toBe(false);
    expect(reroll.price, "仕入れ直しは回数ごとに rerollStep 上がる").toBe(Math.round(reroll.base + ECONOMY.price.rerollStep * chapterScale(state.depth)));
    expect(reroll.price).toBeGreaterThan(rerollPrice);
    const flask = wareOf(m, "flask");
    expect(flask.used, "並べ直した").toBe(false);
    expect(flask.price, "1 回買った瓶は 1 + repeatMul 倍").toBe(Math.round(flask.base * (1 + ECONOMY.price.repeatMul)));
  });
});

describe("商人を襲う", () => {
  it("殴られるまで気付かず、戦いの音でも起きない。近くにいても交戦に数えない", () => {
    const state = game();
    const m = merchantIn(state);
    const body = bodyOf(state, m);
    // 周りの陣は音で起きるので、商人だけを残す
    state.enemies = [body];
    state.jins = [];
    state.player.body.pos = { x: body.body.pos.x + 20, y: body.body.pos.y };
    for (let i = 0; i < 30; i++) {
      emitNoise(state, body.body.pos, "hit");
      step(state, withInput({}), FIXED_DT);
    }
    expect(body.phase, "気付かない").toBe("idle");
    expect(m.provoked).toBe(false);
    expect(isEngaged(state), "商人のそばは交戦ではない").toBe(false);
  });

  it("殴ると怒って品を投げ、売らなくなる", () => {
    const state = game();
    const m = merchantIn(state);
    const body = bodyOf(state, m);
    state.player.body.pos = { x: body.body.pos.x + 60, y: body.body.pos.y };
    state.player.invulnTimer = 1e9;
    damageEnemy(state, body, 1, { x: -1, y: 0 }, 0, { kind: "melee" });
    expect(m.provoked, "怒る").toBe(true);
    expect(body.phase).not.toBe("idle");
    let thrown = 0;
    for (let i = 0; i < 180 && thrown === 0; i++) {
      step(state, withInput({}), FIXED_DT);
      thrown = state.projectiles.filter((p) => p.owner === "enemy" && p.sourceId === body.id).length;
    }
    expect(thrown, "品を投げる").toBe(ECONOMY.market.throw.count);
    state.economy.coins = RICH;
    expect(buyWare(state, m, wareOf(m, "key")), "売らない").toBe(false);
  });

  it("怒らせて倒すと売れ残りが床に落ち、このランの値段が outlawPriceMul 倍になる", () => {
    const state = game();
    const m = merchantIn(state);
    const body = bodyOf(state, m);
    damageEnemy(state, body, 1, { x: -1, y: 0 }, 0, { kind: "melee" });
    const items = state.floorItems.length;
    const runes = state.skills.runes.length;
    body.hp = 0;
    // 殴った手応えのヒットストップが明けるまで進める
    for (let i = 0; i < HITSTOP_STEPS; i++) step(state, withInput({}), FIXED_DT);
    expect(state.economy.merchants, "商人は去る").toHaveLength(0);
    expect(state.economy.outlaw, "無法者").toBe(true);
    expect(state.floorItems.length, "遺物").toBe(items + 1);
    expect(state.skills.runes.length, "刻印符").toBe(runes + 1);
    expect(state.pickups.some((p) => p.kind === "flask"), "瓶").toBe(true);
    expect(state.pickups.some((p) => p.kind === "key"), "鍵").toBe(true);
    // 次の階の市
    buildFloor(state);
    const next = merchantIn(state);
    for (const w of next.wares) expect(w.price, `${w.kind} は 2 倍`).toBe(Math.round(w.base * ECONOMY.market.outlawPriceMul));
    expect(warePrice(state, next, wareOf(next, "flask"))).toBe(wareOf(next, "flask").price);
  });

  it("怒っていない商人の体が消えても（敵の爆発など）品は落ちず、無法者にならない", () => {
    const state = game();
    const m = merchantIn(state);
    bodyOf(state, m).hp = 0;
    const pickups = state.pickups.length;
    step(state, withInput({}), FIXED_DT);
    expect(state.economy.merchants).toHaveLength(0);
    expect(state.economy.outlaw).toBe(false);
    expect(state.pickups.length).toBe(pickups);
  });

  it("床の瓶は触れると 1 本増え、上限なら床に残る", () => {
    const state = game();
    state.player.body.pos = { ...FAR };
    dropFlask(state, state.player.body.pos);
    state.player.flasks = flaskCapacity(state);
    updateMerchants(state);
    expect(state.pickups.filter((p) => p.kind === "flask"), "上限なら残る").toHaveLength(1);
    state.player.flasks = 0;
    updateMerchants(state);
    expect(state.player.flasks).toBe(1);
    expect(state.pickups.filter((p) => p.kind === "flask")).toHaveLength(0);
  });
});

describe("図鑑・抽選", () => {
  it("商人は通常の抽選に出ない", () => {
    const def = enemyDef(MERCHANT_KEY);
    expect(def.merchant).toBe(true);
    expect(def.weight).toBe(0);
  });
});
