import { describe, expect, it } from "vitest";
import type { EventKind, GameEvent, StatusSnap } from "../../core/events";
import type { Enemy, GameState } from "../../core/state";
import { BOON_LINEAGE } from "../../data/tuning";
import { BOONS, type BoonDef } from "../boonDefs";
import { countPer } from "../modifiers";
import { applyStagger } from "../poise";
import { isAllied, resolveRules } from "../rules";
import { applyStatus, hasStatus } from "../statusEffects";
import { arena, placeEnemy } from "../testHelpers";
import { BOONS_FUSION, BOON_KEYS_FUSION } from "./fusion";

/** 融合 12（docs/ideas/boon-impl.md 2-4・2-6 末尾）の構成と、各札の効果が 1 本ずつ起きることの検査 */

const F = BOON_LINEAGE.fusion;
const CARDS: readonly BoonDef[] = BOON_KEYS_FUSION.map((k) => BOONS_FUSION[k]);
const NEAR = 20;
const BIG_HP = 10_000;
const STAGGER_TIME = 5;

function cleanArena(seed = 5): GameState {
  const state = arena(seed);
  for (const r of state.rooms) r.locked = false;
  state.events = [];
  state.pendingEvents = [];
  return state;
}

function sturdy(state: GameState, dx: number, dy = 0): Enemy {
  const e = placeEnemy(state, "slime", dx, dy);
  e.hp = BIG_HP;
  e.maxHp = BIG_HP;
  return e;
}

interface EventOpts {
  target?: Enemy;
  amount?: number;
  /** 倒れた敵の状態異常の写し（撃破の対象はもういない） */
  snap?: readonly StatusSnap[];
}

function eventOf(state: GameState, kind: EventKind, opts: EventOpts = {}): GameEvent {
  const { target, amount, snap } = opts;
  const pos = target === undefined ? { ...state.player.body.pos } : { ...target.body.pos };
  return {
    kind,
    actor: "player",
    pos,
    depth: 0,
    source: { kind: "player", key: "test" },
    ...(target ? { targetId: target.id } : {}),
    ...(amount !== undefined ? { amount } : {}),
    ...(snap !== undefined ? { targetStatus: snap } : {}),
  };
}

function fireCard(state: GameState, def: BoonDef, ev: GameEvent): void {
  state.events.push(ev);
  resolveRules(state, 0, def.rules ?? []);
}

describe("融合の札の構成", () => {
  it("12 枚。どれも違う 2 系譜を持ち、系譜は持たず摂理扱い、組は重ならない", () => {
    expect(CARDS.length).toBe(12);
    const pairs = new Set<string>();
    for (const d of CARDS) {
      const [a, b] = d.fusion ?? [];
      expect(a, `${d.key} の組`).toBeDefined();
      expect(a, `${d.key} の組`).not.toBe(b);
      expect(d.lineage, `${d.key}`).toBeUndefined();
      expect(d.card, `${d.key}`).toBe("law");
      expect(d.action, `${d.key}`).toBeUndefined();
      expect(d.changes, `${d.key}`).toBeDefined();
      expect((d.rules ?? []).length, `${d.key} の効果`).toBeGreaterThan(0);
      pairs.add([a, b].sort().join("+"));
    }
    expect(pairs.size, "組が重ならない").toBe(CARDS.length);
  });

  it("融合は 2 系譜のどちらの枚数にも数え、持っている系譜の数にも 2 つ数える", () => {
    const state = cleanArena();
    state.boons.push("thunderBlast");
    expect(countPer(state, { kind: "lineageCards", lineage: "ash" }, null)).toBe(1);
    expect(countPer(state, { kind: "lineageCards", lineage: "thunder" }, null)).toBe(1);
    expect(countPer(state, { kind: "lineageCards", lineage: "frost" }, null)).toBe(0);
    expect(countPer(state, { kind: "lineagesOwned" }, null)).toBe(2);
  });

  it("結びの中身を写した 3 枚は旧 key のまま、BOONS がこちらの定義を引く", () => {
    for (const key of ["thunderBlast", "winterNest", "clearMirror"] as const) {
      expect(BOONS[key], key).toBe(BOONS_FUSION[key]);
      expect(BOONS[key].fusion, `${key} は融合`).toBeDefined();
    }
  });
});

describe("融合の札の効果", () => {
  it("雷火: 燃えていた敵を倒すと連鎖雷。燃えていなければ出ない", () => {
    const state = cleanArena();
    const e = sturdy(state, NEAR);
    fireCard(state, BOONS_FUSION.thunderBlast, eventOf(state, "onKill", { snap: [] }));
    expect(e.hp, "燃えていない").toBe(BIG_HP);
    fireCard(state, BOONS_FUSION.thunderBlast, eventOf(state, "onKill", { snap: [{ kind: "burn", stacks: 1, potency: 1 }] }));
    expect(e.hp, "連鎖雷").toBeLessThan(BIG_HP);
  });

  it("鎖牧: 宣告の付いた敵を倒すと周りの敵が従う", () => {
    const state = cleanArena();
    const e = sturdy(state, NEAR);
    fireCard(state, BOONS_FUSION.chainHerd, eventOf(state, "onKill", { snap: [{ kind: "doom", stacks: 1, potency: 1 }] }));
    expect(isAllied(state, e)).toBe(true);
  });

  it("返し打ち: 応手の直後の命中に追撃が乗り、応手が無ければ乗らない", () => {
    const state = cleanArena();
    const e = sturdy(state, NEAR);
    fireCard(state, BOONS_FUSION.counterSlam, eventOf(state, "onSwingHit", { target: e }));
    expect(e.hp, "応手なし").toBe(BIG_HP);
    state.recent.onRiposte = { lastTime: state.time, count: 1 };
    fireCard(state, BOONS_FUSION.counterSlam, eventOf(state, "onSwingHit", { target: e }));
    expect(e.hp, "追撃").toBeLessThan(BIG_HP);
  });

  it("影群: コンボが足りれば終撃の敵を従える", () => {
    const state = cleanArena();
    const e = sturdy(state, NEAR);
    fireCard(state, BOONS_FUSION.shadowHorde, eventOf(state, "onFinisher", { target: e }));
    expect(isAllied(state, e), "コンボ不足").toBe(false);
    state.combo.count = F.shadowHorde.combo;
    fireCard(state, BOONS_FUSION.shadowHorde, eventOf(state, "onFinisher", { target: e }));
    expect(isAllied(state, e)).toBe(true);
  });

  it("使役: 処刑すると周りの怯んだ敵が従う", () => {
    const state = cleanArena();
    const e = sturdy(state, NEAR);
    const calm = sturdy(state, -NEAR);
    applyStagger(state, e, STAGGER_TIME);
    fireCard(state, BOONS_FUSION.bindExecuted, eventOf(state, "onExecute"));
    expect([isAllied(state, e), isAllied(state, calm)]).toEqual([true, false]);
  });

  it("玻璃: 冷えた敵への会心で凍らせる", () => {
    const state = cleanArena();
    const e = sturdy(state, NEAR);
    fireCard(state, BOONS_FUSION.winterNest, eventOf(state, "onCrit", { target: e }));
    expect(hasStatus(e.status, "freeze"), "冷えていない").toBe(false);
    applyStatus(state, { kind: "enemy", enemy: e }, { kind: "chill", stacks: 1, duration: STAGGER_TIME, potency: 0.1 }, "player");
    fireCard(state, BOONS_FUSION.winterNest, eventOf(state, "onCrit", { target: e }));
    expect(hasStatus(e.status, "freeze")).toBe(true);
  });

  it("磐石: 被弾の直後の壁叩きつけで最大生命の割合の追撃", () => {
    const state = cleanArena();
    const e = sturdy(state, NEAR);
    fireCard(state, BOONS_FUSION.bulwark, eventOf(state, "onWallSlam", { target: e }));
    expect(e.hp, "被弾なし").toBe(BIG_HP);
    state.recent.onHurt = { lastTime: state.time, count: 1 };
    fireCard(state, BOONS_FUSION.bulwark, eventOf(state, "onWallSlam", { target: e }));
    expect(e.hp, "追撃").toBeLessThan(BIG_HP);
  });

  it("迅雷: コンボが足りればダッシュの終わりに連鎖雷", () => {
    const state = cleanArena();
    const e = sturdy(state, NEAR);
    fireCard(state, BOONS_FUSION.galeStrike, eventOf(state, "onDashEnd"));
    expect(e.hp, "コンボ不足").toBe(BIG_HP);
    state.combo.count = F.galeStrike.combo;
    fireCard(state, BOONS_FUSION.galeStrike, eventOf(state, "onDashEnd"));
    expect(e.hp).toBeLessThan(BIG_HP);
  });

  it("寒熱: 反応の周りの敵に燃焼と冷気を付ける", () => {
    const state = cleanArena();
    const origin = sturdy(state, NEAR);
    const other = sturdy(state, NEAR, NEAR);
    fireCard(state, BOONS_FUSION.reactionChain, eventOf(state, "onReaction", { target: origin }));
    // 燃焼と冷気は出会うとその場で反応して消えるので、付いたまま残るか、周りの敵で次の反応が起きたかを見る
    const chained = [...state.events, ...state.pendingEvents].some((ev) => ev.kind === "onReaction" && ev.targetId === other.id);
    expect(chained || hasStatus(other.status, "burn") || hasStatus(other.status, "chill"), "周りに付く").toBe(true);
    expect(hasStatus(origin.status, "burn") || hasStatus(origin.status, "chill"), "反応の元には付けない").toBe(false);
  });

  it("両替: 銭を拾うと額に応じて気力が戻る", () => {
    const state = cleanArena();
    state.player.mana = 0;
    const amount = 10;
    fireCard(state, BOONS_FUSION.clearMirror, eventOf(state, "onCoinPickup", { amount }));
    expect(state.player.mana).toBeCloseTo(amount * F.clearMirror.manaPerCoin * state.stats.manaGainMul);
  });

  it("豪遊: 終撃で銭を得て、足りていれば先に払って銭の弾を投げる", () => {
    const state = cleanArena();
    const e = sturdy(state, NEAR);
    const before = state.projectiles.length;
    fireCard(state, BOONS_FUSION.lavishBlade, eventOf(state, "onFinisher", { target: e }));
    expect(state.projectiles.length, "足りないので投げない").toBe(before);
    const gained = state.economy.coins;
    expect(gained, "得る").toBeGreaterThan(0);
    state.economy.coins = F.lavishBlade.cost;
    state.ruleIcd.clear();
    fireCard(state, BOONS_FUSION.lavishBlade, eventOf(state, "onFinisher", { target: e }));
    expect(state.projectiles.length, "投げる").toBe(before + 1);
    expect(state.economy.coins, "払ってから得る").toBe(gained);
  });

  it("買収: 怯んだ敵を銭で従え、銭が足りなければ従えない", () => {
    const state = cleanArena();
    const e = sturdy(state, NEAR);
    fireCard(state, BOONS_FUSION.bribe, eventOf(state, "onStagger", { target: e }));
    expect(isAllied(state, e), "銭なし").toBe(false);
    state.economy.coins = F.bribe.cost;
    state.time += F.bribe.icd;
    fireCard(state, BOONS_FUSION.bribe, eventOf(state, "onStagger", { target: e }));
    expect(isAllied(state, e)).toBe(true);
    expect(state.economy.coins).toBe(0);
  });
});

describe("融合の決定性", () => {
  it("同じ seed で同じ札を同じ順に流すと同じ結果", () => {
    const run = (): { hp: number[]; allied: boolean[]; rng: number } => {
      const state = cleanArena(9);
      const list = [sturdy(state, NEAR), sturdy(state, -NEAR), sturdy(state, 0, NEAR)];
      for (const e of list) applyStagger(state, e, STAGGER_TIME);
      state.combo.count = F.shadowHorde.combo;
      state.economy.coins = 100;
      const target = list[0];
      for (const key of BOON_KEYS_FUSION) {
        for (const kind of ["onKill", "onSwingHit", "onFinisher", "onExecute", "onDashEnd", "onStagger"] as const) {
          fireCard(state, BOONS_FUSION[key], eventOf(state, kind, { target, snap: [{ kind: "burn", stacks: 1, potency: 1 }] }));
        }
      }
      return { hp: list.map((e) => e.hp), allied: list.map((e) => isAllied(state, e)), rng: state.rng.next() };
    };
    expect(run()).toEqual(run());
  });
});
