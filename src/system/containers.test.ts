import { describe, expect, it } from "vitest";
import { createGame, step } from "../core/game";
import { FIXED_DT } from "../core/loop";
import type { Rng } from "../core/rng";
import { type Enemy, type GameState, ROAMING_ROOM } from "../core/state";
import type { Vec } from "../core/vec";
import { ENEMIES, enemyDef } from "../data/enemies";
import { ECONOMY, ROOM_KIND } from "../data/tuning";
import { CODEX_ENEMIES } from "../meta/codex";
import { TILE_SIZE, isWalkable } from "../map/grid";
import { countCombatants } from "../qa/jinMetrics";
import { CRATE_KEY, POT_KEY, containerBroken, createContainer, placeContainers } from "./containers";
import { damageEnemy, enemyNearPlayer } from "./combat";
import { chapterScale, updateCoinPickups } from "./economy";
import { emitNoise } from "./noise";
import { overlapsWall } from "./physics";
import { openTreasure } from "./roomTypes";
import { setupSpecialRoom } from "./specialRooms";
import { arena, interactAt, withInput } from "./testHelpers";

/** 壺・木箱と鍵の使い道（system/containers.ts、specialRooms.ts の鍵付きの宝箱・封印庫。docs/ideas/economy-impl.md 2-4・2-7） */

const IDLE = withInput({});
const KILL_DAMAGE = 1e6;
const RIGHT: Vec = { x: 1, y: 0 };
const SEEDS = [1, 2, 3, 4, 5, 6];

function containersOf(state: GameState): Enemy[] {
  return state.enemies.filter((e) => enemyDef(e.defKey).container !== undefined);
}

/** いつも同じ値を返す乱数。int は最大値、chance は flask の当たり外れを固定する */
function rigged(opts: { max: boolean; hit: boolean }): Rng {
  return {
    next: () => 0.5,
    int: (min, max) => (opts.max ? max : min),
    chance: () => opts.hit,
    pick: <T>(arr: readonly T[]) => arr[0] as T,
  };
}

function breakOne(state: GameState, key: string): Enemy {
  const p = state.player.body.pos;
  const pot = createContainer(state, key, { x: p.x + 40, y: p.y });
  state.enemies.push(pot);
  damageEnemy(state, pot, KILL_DAMAGE, RIGHT, 0, { kind: "melee" });
  return pot;
}

describe("壺・木箱の定義", () => {
  it("2 種とも生命 1・抽選に出ない・気付かない behavior で、図鑑に載せない", () => {
    for (const key of [POT_KEY, CRATE_KEY]) {
      const def = enemyDef(key);
      expect(def.container, `${key} の container`).toBe(key);
      expect(def.hp, `${key} の生命`).toBe(1);
      expect(def.weight, `${key} は抽選に出ない`).toBe(0);
      expect(def.behavior, key).toBe("container");
      expect(CODEX_ENEMIES.some((d) => d.key === key), `${key} は図鑑に載らない`).toBe(false);
    }
    expect(ENEMIES.filter((d) => d.container !== undefined).length, "壺と木箱").toBe(2);
  });

  it("階が深くても生命 1 のまま（createContainer が深さの伸びを戻す）", () => {
    const state = arena(3);
    state.depth = 20;
    const pot = createContainer(state, POT_KEY, state.player.body.pos);
    expect(pot.hp).toBe(1);
    expect(pot.maxHp).toBe(1);
    expect(pot.roomIndex, "部屋の制圧・陣に数えない").toBe(ROAMING_ROOM);
  });
});

describe("割る", () => {
  it("撃破数・得点・コンボに数えず、破片だけが出る", () => {
    const state = arena(3);
    state.rng = rigged({ max: true, hit: false });
    const before = { kills: state.kills, score: state.score, combo: state.combo.count };
    const pot = breakOne(state, POT_KEY);
    expect(pot.hp, "1 撃で割れる").toBeLessThanOrEqual(0);
    expect(state.kills, "撃破数").toBe(before.kills);
    expect(state.score, "得点").toBe(before.score);
    expect(state.combo.count, "コンボ").toBe(before.combo);
  });

  it("銭は 0〜coinsMax（章の倍率込み）で、拾うと稼ぎの源 container に積まれる", () => {
    const state = arena(3);
    state.rng = rigged({ max: true, hit: false });
    breakOne(state, POT_KEY);
    const coins = state.pickups.filter((pk) => pk.kind === "coin");
    expect(coins, "実体は 1 つ").toHaveLength(1);
    expect(coins[0]?.value, "最大の額").toBe(Math.round(ECONOMY.container.coinsMax * chapterScale(state.depth)));
    expect(coins[0]?.source).toBe("container");
    state.player.body.pos = { ...(coins[0]?.pos ?? state.player.body.pos) };
    updateCoinPickups(state, FIXED_DT);
    expect(state.economy.earned.container, "container の稼ぎ").toBe(coins[0]?.value);
    expect(state.economy.earned.kill, "撃破の稼ぎには数えない").toBe(0);
  });

  it("額が 0 なら銭を落とさず、当たれば瓶が床に出る", () => {
    const state = arena(3);
    state.rng = rigged({ max: false, hit: true });
    breakOne(state, CRATE_KEY);
    expect(state.pickups.filter((pk) => pk.kind === "coin"), "額 0 は落とさない").toHaveLength(0);
    expect(state.pickups.filter((pk) => pk.kind === "flask"), "瓶").toHaveLength(1);
  });

  it("当たればハートが床に出て、外れれば出ない（序盤の回復の足し）", () => {
    const hit = arena(3);
    hit.rng = rigged({ max: false, hit: true });
    breakOne(hit, POT_KEY);
    expect(hit.pickups.filter((pk) => pk.kind === "heart"), "ハート").toHaveLength(1);
    const miss = arena(3);
    miss.rng = rigged({ max: false, hit: false });
    breakOne(miss, POT_KEY);
    expect(miss.pickups.filter((pk) => pk.kind === "heart"), "外れ").toHaveLength(0);
  });

  it("ハートの確率は章が進むほど絞る（瓶より高い）", () => {
    const table = ECONOMY.container.heartChanceByChapter;
    expect(table.length, "章ごと").toBeGreaterThanOrEqual(4);
    for (let i = 1; i < table.length; i++) expect(table[i] ?? 0, `章 ${i + 1}`).toBeLessThanOrEqual(table[i - 1] ?? 0);
    expect(table[0] ?? 0, "1 章は瓶より出やすい").toBeGreaterThan(ECONOMY.container.flaskChance);
  });

  it("銭が 0 でも瓶が外れても乱数は同じ回数だけ引く（後の抽選を揺らさない）", () => {
    const draws: number[] = [];
    for (const opts of [
      { max: true, hit: true },
      { max: false, hit: false },
    ]) {
      const state = arena(3);
      let n = 0;
      const base = rigged(opts);
      state.rng = {
        next: () => (n++, base.next()),
        int: (a, b) => (n++, base.int(a, b)),
        chance: (p) => (n++, base.chance(p)),
        pick: <T>(arr: readonly T[]) => (n++, base.pick(arr)),
      };
      const pot = createContainer(state, POT_KEY, state.player.body.pos);
      const start = n;
      containerBroken(state, pot);
      draws.push(n - start);
    }
    expect(draws[0], "当たりと外れで引く回数が同じ").toBe(draws[1]);
  });

  it("殴っただけではコンボが伸びない", () => {
    const state = arena(3);
    state.rng = rigged({ max: false, hit: false });
    const p = state.player.body.pos;
    const pot = createContainer(state, POT_KEY, { x: p.x + 20, y: p.y });
    state.enemies.push(pot);
    damageEnemy(state, pot, 1, RIGHT, 0, { kind: "melee" });
    expect(state.combo.count).toBe(0);
  });

  it("試し場（sandbox）では銭も瓶も出ない", () => {
    const state = arena(3);
    state.sandbox = true;
    state.rng = rigged({ max: true, hit: true });
    breakOne(state, POT_KEY);
    expect(state.pickups.filter((pk) => pk.kind === "coin" || pk.kind === "flask")).toHaveLength(0);
  });
});

describe("気付かない・戦いに数えない", () => {
  it("そばで戦いの音が鳴っても起きず、攻撃もしない", () => {
    const state = arena(3);
    const p = state.player.body.pos;
    const pot = createContainer(state, POT_KEY, { x: p.x + 24, y: p.y });
    state.enemies.push(pot);
    emitNoise(state, p, "hit");
    for (let i = 0; i < 120; i++) step(state, IDLE, FIXED_DT);
    expect(pot.phase, "idle のまま").toBe("idle");
    expect(pot.hp, "壊れない").toBe(1);
    expect(state.player.hp, "攻撃してこない").toBe(state.player.maxHp);
  });

  it("そばにいても自然回復を止めず、陣の計測の総数にも数えない", () => {
    const state = arena(3);
    const p = state.player.body.pos;
    state.enemies.push(createContainer(state, POT_KEY, { x: p.x + 20, y: p.y }));
    expect(enemyNearPlayer(state, 200), "壺は戦いの相手ではない").toBe(false);
    expect(countCombatants(state.enemies), "総数から除く").toBe(0);
  });
});

describe("置き方（placeContainers）", () => {
  it("階ごとに塊の隅か行き止まりへ、間隔を空けて生命 1 で置く", () => {
    let total = 0;
    for (const seed of SEEDS) {
      const state = createGame(seed);
      const list = containersOf(state);
      total += list.length;
      const cap = Math.round(ECONOMY.container.perFloorMax * (state.floorAreaMul ?? 1));
      expect(list.length, `seed ${seed}: 上限以内`).toBeLessThanOrEqual(cap);
      for (const e of list) {
        expect(e.roomIndex, "どの部屋にも属さない").toBe(ROAMING_ROOM);
        expect(e.hp).toBe(1);
        expect(overlapsWall(state, e.body.pos.x, e.body.pos.y, e.body.radius), "壁に埋まらない").toBe(false);
        const tx = Math.floor(e.body.pos.x / TILE_SIZE);
        const ty = Math.floor(e.body.pos.y / TILE_SIZE);
        const walls = [
          [0, -1],
          [0, 1],
          [-1, 0],
          [1, 0],
        ].filter(([dx, dy]) => !isWalkable(state.map, tx + (dx ?? 0), ty + (dy ?? 0))).length;
        expect(walls, "壁に 2 面以上接する（隅か行き止まり）").toBeGreaterThanOrEqual(ECONOMY.container.cornerWalls);
        const p = state.player.body.pos;
        expect(Math.hypot(e.body.pos.x - p.x, e.body.pos.y - p.y), "開始位置を空ける").toBeGreaterThanOrEqual(ECONOMY.container.keepClear);
      }
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const a = list[i]?.body.pos;
          const b = list[j]?.body.pos;
          if (!a || !b) continue;
          expect(Math.hypot(a.x - b.x, a.y - b.y), `seed ${seed}: 間隔`).toBeGreaterThanOrEqual(ECONOMY.container.spacing);
        }
      }
    }
    expect(total, "複数の階には置かれる").toBeGreaterThan(0);
  });

  it("同じ seed なら同じ場所・同じ種類（決定的）", () => {
    const summary = (seed: number): string =>
      containersOf(createGame(seed))
        .map((e) => `${e.defKey}@${e.body.pos.x},${e.body.pos.y}`)
        .join("|");
    expect(summary(4)).toBe(summary(4));
  });

  it("試し場（sandbox）には置かない", () => {
    const state = arena(3);
    state.sandbox = true;
    state.enemies = [];
    placeContainers(state);
    expect(state.enemies).toHaveLength(0);
  });

  it("壺と木箱の両方が置かれ、通路の行き止まりは deadEndMax を超えない", () => {
    const keys = new Set<string>();
    for (const seed of SEEDS) for (const e of containersOf(createGame(seed))) keys.add(e.defKey);
    expect(keys, "どちらも出る").toEqual(new Set([POT_KEY, CRATE_KEY]));
  });
});

describe("鍵付きの宝箱（宝物庫）", () => {
  function treasure(seed = 3): { state: GameState; chest: { pos: Vec; used: boolean } } {
    const state = arena(seed);
    state.depth = 1;
    const room = state.rooms[1];
    if (!room) throw new Error("room");
    room.kind = "treasure";
    openTreasure(state, room);
    const chest = room.special?.props.find((p) => p.kind === "lockedChest");
    if (!chest) throw new Error("鍵付きの宝箱が無い");
    return { state, chest };
  }

  it("入ると遺物の 1 つが鍵付きの宝箱に置き換わる（遺物は 1〜2 個 + 宝箱）", () => {
    const { state } = treasure();
    expect(state.floorItems.length, "遺物").toBeGreaterThanOrEqual(ROOM_KIND.treasureItemsMin - 1);
    expect(state.floorItems.length).toBeLessThanOrEqual(ROOM_KIND.treasureItemsMax - 1);
  });

  it("鍵が無ければ開かず、鍵 1 本で遺物 1 つと銭 15〜25 が出る", () => {
    const { state, chest } = treasure();
    const items = state.floorItems.length;
    interactAt(state, chest.pos);
    expect(chest.used, "鍵なしでは開かない").toBe(false);
    state.economy.keys = 1;
    interactAt(state, chest.pos);
    expect(chest.used, "開いた").toBe(true);
    expect(state.economy.keys, "鍵を 1 本払う").toBe(0);
    expect(state.floorItems.length, "遺物").toBe(items + 1);
    expect(state.economy.coins).toBeGreaterThanOrEqual(ECONOMY.container.lockedChestCoinsMin);
    expect(state.economy.coins).toBeLessThanOrEqual(ECONOMY.container.lockedChestCoinsMax);
    expect(state.economy.earned.container, "稼ぎの源 container").toBe(state.economy.coins);
  });
});

describe("封印庫は鍵 2 か銭 80", () => {
  function vault(seed = 3): { state: GameState; seal: { pos: Vec; used: boolean } } {
    const state = arena(seed);
    const room = state.rooms[1];
    if (!room) throw new Error("room");
    room.kind = "vault";
    setupSpecialRoom(state, room);
    const seal = room.special?.props.find((p) => p.kind === "seal");
    if (!seal) throw new Error("封印が無い");
    return { state, seal };
  }

  /** 封印に照準を合わせてインタラクトで使う */
  function touch(state: GameState, pos: Vec): void {
    interactAt(state, pos);
  }

  it("鍵 2 本で開き、銭は減らない", () => {
    const { state, seal } = vault();
    state.economy.keys = ECONOMY.container.vaultKeys;
    state.economy.coins = 10;
    touch(state, seal.pos);
    expect(seal.used).toBe(true);
    expect(state.economy.keys, "鍵を払う").toBe(0);
    expect(state.economy.coins, "銭は払わない").toBe(10);
    expect(state.floorItems.length).toBe(ROOM_KIND.vaultDrops);
  });

  it("鍵が足りなければ銭 80 で開き、鍵は減らない", () => {
    const { state, seal } = vault();
    state.economy.keys = ECONOMY.container.vaultKeys - 1;
    state.economy.coins = ROOM_KIND.vaultCoinCost;
    touch(state, seal.pos);
    expect(seal.used).toBe(true);
    expect(state.economy.coins).toBe(0);
    expect(state.economy.keys, "鍵は使わない").toBe(ECONOMY.container.vaultKeys - 1);
  });

  it("どちらも足りなければ開かない", () => {
    const { state, seal } = vault();
    state.economy.keys = ECONOMY.container.vaultKeys - 1;
    state.economy.coins = ROOM_KIND.vaultCoinCost - 1;
    touch(state, seal.pos);
    expect(seal.used).toBe(false);
    expect(state.floorItems.length).toBe(0);
  });
});
