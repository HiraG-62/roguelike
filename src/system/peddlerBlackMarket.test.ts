import { describe, expect, it } from "vitest";
import { FIXED_DT } from "../core/loop";
import type { Enemy, GameState, HiddenRoom, Merchant, Ware, WareKind } from "../core/state";
import { dist } from "../core/vec";
import { BOSS, ECONOMY, HIDDEN_ROOM } from "../data/tuning";
import { TILE_SIZE } from "../map/grid";
import { tileOf } from "../map/pathing";
import { unownedSkillKeys } from "./blackMarket";
import { damageEnemy } from "./combat";
import { chapterScale } from "./economy";
import { buildFloor } from "./floor";
import { planHidden, updateHiddenRoom } from "./hiddenRoom";
import { buyWare, kindPriceMul, merchantOpen, spawnPeddler, stockPlan, updateMerchants } from "./merchants";
import { overlapsWall } from "./physics";
import { altarKeystoneCandidates } from "./runSetup";
import { arena, placeEnemy } from "./testHelpers";

/** 旅商人と闇市（system/merchants.ts・system/peddler.ts・system/blackMarket.ts。docs/ideas/economy-impl.md 2-5） */

const SEEDS = 16;
const RICH = 10_000;
const FAR = { x: -9999, y: -9999 };

/** 前室の市を外して旅商人を 1 人だけ出す */
function withPeddler(seed = 3): { state: GameState; m: Merchant; body: Enemy } {
  const state = arena(seed);
  state.economy.merchants = [];
  const m = spawnPeddler(state);
  if (!m) throw new Error("旅商人を置けなかった（テストの前提が崩れている）");
  const body = state.enemies.find((e) => e.id === m.enemyId);
  if (!body) throw new Error("旅商人の体がない");
  return { state, m, body };
}

function wareOf(m: Merchant, kind: WareKind): Ware {
  const w = m.wares.find((x) => x.kind === kind && !x.used);
  if (!w) throw new Error(`品がない: ${kind}`);
  return w;
}

/** 旅商人の体をプレイヤーのすぐ横（開始部屋の中）へ移して店を広げさせる */
function openNearPlayer(state: GameState, m: Merchant, body: Enemy): void {
  const p = state.player.body.pos;
  body.body.pos = { x: p.x + TILE_SIZE, y: p.y };
  updateMerchants(state, FIXED_DT);
  if (!merchantOpen(m)) throw new Error("店を広げなかった（テストの前提が崩れている）");
}

describe("旅商人を出す", () => {
  it("peddler.chance で市の後ろに並び、プレイヤーから minStartDist 以上離れて出る。店はまだ広げていない", () => {
    let seen = 0;
    for (let seed = 0; seed < SEEDS; seed++) {
      const state = arena(seed);
      const peddlers = state.economy.merchants.filter((m) => m.kind === "peddler");
      expect(peddlers.length, `seed=${seed} 1 階に 1 人まで`).toBeLessThanOrEqual(1);
      const m = peddlers[0];
      if (!m) continue;
      seen += 1;
      expect(state.economy.merchants[0]?.kind, "先頭は前室の市").not.toBe("peddler");
      expect(merchantOpen(m), "店はまだ広げていない").toBe(false);
      expect(m.wares.map((w) => w.kind), "旅商人の品").toEqual(stockPlan("peddler"));
      expect(m.roam, "歩く先がある").toBeDefined();
    }
    expect(seen, "どこかの seed で出る").toBeGreaterThan(0);
    expect(seen, "出ない seed もある").toBeLessThan(SEEDS);
  });

  it("出る位置はプレイヤーから minStartDist 以上離れ、同じ seed なら同じ", () => {
    const a = withPeddler(4);
    const b = withPeddler(4);
    expect(a.body.body.pos).toEqual(b.body.body.pos);
    expect(dist(a.body.body.pos, a.state.player.body.pos)).toBeGreaterThanOrEqual(ECONOMY.market.peddler.minStartDist);
  });

  it("旅商人の瓶は kindPriceMul 倍の平均から引く", () => {
    const { state, m } = withPeddler(5);
    const w = wareOf(m, "flask");
    const mul = kindPriceMul("peddler", "flask");
    expect(mul, "JSON の倍率").toBe(ECONOMY.market.kindPriceMul.peddler.flask);
    expect(kindPriceMul("market", "flask"), "書いていない種類は 1").toBe(1);
    const mean = ECONOMY.price.base.flask * chapterScale(state.depth) * mul;
    expect(w.base).toBeGreaterThanOrEqual(Math.round(mean * ECONOMY.price.spread.low) - 1);
    expect(w.base).toBeLessThanOrEqual(Math.round(mean * ECONOMY.price.spread.high) + 1);
  });
});

describe("旅商人が歩く・店を広げる", () => {
  it("プレイヤーが遠いと歩き、名札と品が体についていく", () => {
    const { state, m, body } = withPeddler(6);
    state.player.body.pos = { ...FAR };
    const start = { ...body.body.pos };
    for (let i = 0; i < 240; i++) updateMerchants(state, FIXED_DT);
    expect(dist(start, body.body.pos), "歩いた").toBeGreaterThan(TILE_SIZE);
    expect(m.pos).toEqual(body.body.pos);
    for (const w of m.wares) expect(w.pos, "品は体と一緒").toEqual(body.body.pos);
  });

  it("近づくと足を止めて台座を並べ、以後は動かない", () => {
    const { state, m, body } = withPeddler(7);
    openNearPlayer(state, m, body);
    const spacing = ECONOMY.market.offerSpacing * TILE_SIZE;
    for (const w of m.wares) expect(overlapsWall(state, w.pos.x, w.pos.y, 1), "台座は床の上").toBe(false);
    for (let i = 1; i < m.wares.length; i++) {
      const a = m.wares[i - 1];
      const b = m.wares[i];
      if (!a || !b) continue;
      expect(dist(a.pos, b.pos), "台座の間隔").toBeCloseTo(spacing, 5);
    }
    expect(m.roam, "歩く先を捨てた").toBeUndefined();
    const stand = { ...body.body.pos };
    state.player.body.pos = { ...FAR };
    for (let i = 0; i < 120; i++) updateMerchants(state, FIXED_DT);
    expect(body.body.pos, "動かない").toEqual(stand);
  });

  it("店を広げるまでは品に触れても買えない", () => {
    const { state, m, body } = withPeddler(8);
    // 壁の中（マップの隅）に立たせると台座を並べられず、店を広げない
    body.body.pos = { x: TILE_SIZE / 2, y: TILE_SIZE / 2 };
    state.player.body.pos = { ...body.body.pos };
    state.economy.coins = RICH;
    state.player.flasks = 0;
    for (let i = 0; i < 3; i++) updateMerchants(state, FIXED_DT);
    expect(merchantOpen(m)).toBe(false);
    expect(m.wares.every((w) => !w.used), "買っていない").toBe(true);
    expect(state.economy.coins).toBe(RICH);
  });

  it("店を広げたら台座に触れて買える", () => {
    const { state, m, body } = withPeddler(9);
    openNearPlayer(state, m, body);
    state.economy.coins = RICH;
    expect(buyWare(state, m, wareOf(m, "rune"))).toBe(true);
    expect(state.economy.spent.rune).toBeGreaterThan(0);
  });
});

describe("旅商人が襲われる・助ける", () => {
  it("気付いている敵のそばで傷を負い、倒れると品が床に落ちる（無法者にならない）", () => {
    const { state, m, body } = withPeddler(10);
    state.player.body.pos = { ...FAR };
    state.player.invulnTimer = 1e9;
    const foe = placeEnemy(state, "slime", 0);
    foe.body.pos = { x: body.body.pos.x + body.body.radius + foe.body.radius, y: body.body.pos.y };
    foe.phase = "chase";
    const items = state.floorItems.length;
    const runes = state.skills.runes.length;
    const hp = body.hp;
    // 歩いて離れないよう、店を広げたことにして立ち止まらせる
    m.open = true;
    updateMerchants(state, FIXED_DT);
    expect(body.hp, "傷を負う").toBeLessThan(hp);
    expect(m.alarmed, "助けを求める").toBe(true);
    for (let i = 0; i < 60 * 600 && body.hp > 0; i++) updateMerchants(state, FIXED_DT);
    expect(body.hp).toBe(0);
    state.enemies = state.enemies.filter((e) => e.hp > 0);
    updateMerchants(state, FIXED_DT);
    expect(state.economy.merchants, "去る").not.toContain(m);
    expect(state.economy.outlaw, "襲っていないので無法者でない").toBe(false);
    expect(state.floorItems.length, "遺物").toBe(items + 1);
    expect(state.skills.runes.length, "刻印符").toBe(runes + 1);
    expect(state.pickups.some((p) => p.kind === "flask"), "瓶").toBe(true);
  });

  it("気付いていない敵のそばでは傷を負わない", () => {
    const { state, m, body } = withPeddler(11);
    state.player.body.pos = { ...FAR };
    const foe = placeEnemy(state, "slime", 0);
    foe.body.pos = { ...body.body.pos };
    foe.phase = "idle";
    m.open = true;
    const hp = body.hp;
    for (let i = 0; i < 60; i++) updateMerchants(state, FIXED_DT);
    expect(body.hp).toBe(hp);
  });

  it("saveRadius 以内で敵を倒すと助けたことになり、このランの値段が discount 引きになる。遠い撃破は数えない", () => {
    const { state, m, body } = withPeddler(12);
    state.player.invulnTimer = 1e9;
    const r = ECONOMY.market.peddler.saveRadius;
    const far = placeEnemy(state, "slime", 0);
    far.body.pos = { x: body.body.pos.x + r * 2, y: body.body.pos.y };
    damageEnemy(state, far, 1e6, { x: 1, y: 0 }, 0, { kind: "melee" });
    updateMerchants(state, FIXED_DT);
    expect(state.economy.peddlerSaved, "遠い撃破").toBe(false);
    state.events = [];
    const near = placeEnemy(state, "slime", 0);
    near.body.pos = { x: body.body.pos.x + r / 2, y: body.body.pos.y };
    damageEnemy(state, near, 1e6, { x: 1, y: 0 }, 0, { kind: "melee" });
    updateMerchants(state, FIXED_DT);
    expect(state.economy.peddlerSaved, "近くの撃破").toBe(true);
    const w = wareOf(m, "item");
    expect(w.price).toBe(Math.max(1, Math.round(w.base * (1 - ECONOMY.market.peddler.discount))));
  });
});

// -----------------------------------------------------------------------------
// 闇市
// -----------------------------------------------------------------------------

/** 隠し部屋のある階（rng.chance を強制して計画させる。hiddenRoom.test.ts と同じ手） */
function withHidden(seed: number, depth = 3): { state: GameState; hr: HiddenRoom } {
  const state = arena(seed);
  state.depth = depth;
  buildFloor(state, "rooms");
  state.hiddenRoom = null;
  const rng = state.rng;
  state.rng = { ...rng, chance: () => true };
  planHidden(state);
  state.rng = rng;
  const hr = state.hiddenRoom;
  if (!hr) throw new Error("隠し部屋が計画されなかった（テストの前提が崩れている）");
  return { state, hr };
}

function openHidden(state: GameState, hr: HiddenRoom): void {
  state.player.body.pos = { x: ((hr.doorTile % state.map.width) + 0.5) * TILE_SIZE, y: (Math.floor(hr.doorTile / state.map.width) + 0.5) * TILE_SIZE };
  const steps = Math.ceil(HIDDEN_ROOM.openHold / FIXED_DT) + 2;
  for (let i = 0; i < steps; i++) updateHiddenRoom(state, FIXED_DT);
}

function blackMarketOf(state: GameState): Merchant {
  const m = state.economy.merchants.find((x) => x.kind === "blackMarket");
  if (!m) throw new Error("闇市が立たなかった");
  return m;
}

describe("闇市", () => {
  it("隠し部屋が開くまで立たず、開いた瞬間にポケットの中に立つ。台座は通り道と入口を避け、offerSpacing 以上離れる", () => {
    for (const seed of [9, 21, 33]) {
      const { state, hr } = withHidden(seed);
      expect(state.economy.merchants.some((x) => x.kind === "blackMarket"), "開く前").toBe(false);
      openHidden(state, hr);
      const m = blackMarketOf(state);
      const pocket = new Set(hr.tiles);
      expect(pocket.has(tileOf(state.map, m.pos)), `seed=${seed} 商人はポケットの中`).toBe(true);
      expect(state.enemies.some((e) => e.id === m.enemyId), "体がある").toBe(true);
      for (const w of m.wares) {
        const t = tileOf(state.map, w.pos);
        expect(pocket.has(t), "台座はポケットの中").toBe(true);
        expect(t, "階段には置かない").not.toBe(hr.stairsTile);
      }
      for (let i = 0; i < m.wares.length; i++) {
        for (let j = i + 1; j < m.wares.length; j++) {
          const a = m.wares[i];
          const b = m.wares[j];
          if (!a || !b) continue;
          expect(dist(a.pos, b.pos), "台座の間隔").toBeGreaterThanOrEqual(ECONOMY.market.offerSpacing * TILE_SIZE - 1e-6);
        }
      }
      const kinds = stockPlan("blackMarket");
      for (const w of m.wares) expect(kinds, "闇市の品").toContain(w.kind);
      // 新しいプロフィールなら未所持の石も立てられる誓約もあるので、3 品とも並ぶ
      expect(m.wares.length, "品の数").toBe(kinds.length);
    }
  });

  it("スキル石は未所持の種類、誓約は祭壇と同じ候補から選ぶ", () => {
    const { state, hr } = withHidden(9);
    openHidden(state, hr);
    const m = blackMarketOf(state);
    const skill = m.wares.find((w) => w.kind === "skill");
    if (skill) {
      expect(unownedSkillKeys(state), "未所持").toContain(skill.key);
      expect(state.skills.profile.stones.some((st) => st.skillKey === skill.key), "倉庫に無い").toBe(false);
    }
    const keystone = m.wares.find((w) => w.kind === "keystone");
    if (keystone) expect(altarKeystoneCandidates(state)).toContain(keystone.key);
  });

  it("買うとスキル石・反転の遺物が床に、誓約はこの探索の誓約に加わる。同じ誓約は二度立てられない", () => {
    const { state, hr } = withHidden(21);
    openHidden(state, hr);
    const m = blackMarketOf(state);
    state.economy.coins = RICH;
    const stones = state.skills.floorStones.length;
    const items = state.floorItems.length;
    const skill = m.wares.find((w) => w.kind === "skill");
    if (skill) {
      const price = skill.price;
      expect(buyWare(state, m, skill)).toBe(true);
      expect(state.skills.floorStones.length).toBe(stones + 1);
      expect(state.skills.floorStones.at(-1)?.stone.skillKey, "決めた種類の石").toBe(skill.key);
      expect(state.economy.spent.skill, "用途の集計").toBe(price);
    }
    const cursed = wareOf(m, "cursedItem");
    expect(buyWare(state, m, cursed)).toBe(true);
    expect(state.floorItems.length).toBe(items + 1);
    const item = state.floorItems.at(-1)?.item;
    const inverted = item?.affixes.some((r) => r.inverted === true) === true;
    expect(inverted || item?.namedKey !== undefined || item?.affixes.length === 0, "反転した性質を持つ").toBe(true);
    const keystone = m.wares.find((w) => w.kind === "keystone");
    if (keystone) {
      expect(buyWare(state, m, keystone)).toBe(true);
      expect(state.runKeystones).toContain(keystone.key);
      const again: Ware = { ...keystone, used: false };
      expect(buyWare(state, m, again), "同じ誓約は立てられない").toBe(false);
    }
  });

  it("5 の倍数の階には隠し部屋が無いので闇市も立たない", () => {
    for (let seed = 0; seed < 4; seed++) {
      const state = arena(seed);
      state.depth = BOSS.interval;
      buildFloor(state, "rooms");
      expect(state.hiddenRoom ?? null).toBeNull();
      expect(state.economy.merchants.some((x) => x.kind === "blackMarket")).toBe(false);
    }
  });
});
