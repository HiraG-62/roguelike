import { describe, expect, it } from "vitest";
import { createGame } from "../core/game";
import type { GameState, Pickup } from "../core/state";
import { createEconomyRecorder, buildEconomySection, emptyEconomyTally } from "./economyMetrics";
import { countCombatants } from "./jinMetrics";

const DT = 1 / 60;

interface FakeEconomy {
  coins: number;
  keys?: number;
  earned: Record<string, number>;
  spent: Record<string, number>;
  spilled: number;
  recovered: number;
  outlaw?: boolean;
  merchants?: unknown[];
  bet?: null;
}

function fakeEconomy(extra: Partial<FakeEconomy> = {}): FakeEconomy {
  return { coins: 0, earned: {}, spent: {}, spilled: 0, recovered: 0, ...extra };
}

/** state.economy はレーン A の欄なので、型に依らず差し込む（欄の有無で列が変わることも検証したい） */
function withEconomy(state: GameState, eco: FakeEconomy): FakeEconomy {
  Object.assign(state, { economy: eco });
  return eco;
}

function coinPickup(id: number, extra: { value?: number; life?: number; spilled?: boolean } = {}): Pickup {
  return { id, kind: "coin", pos: { x: 0, y: 0 }, radius: 4, bobTime: 0, value: 1, ...extra } as unknown as Pickup;
}

describe("経済の計測（qa/economyMetrics.ts）", () => {
  it("step ごとの差分を、その時点の深度帯へ源別・用途別に入れる", () => {
    const state = createGame(11);
    const eco = withEconomy(state, fakeEconomy());
    const rec = createEconomyRecorder(state);
    eco.earned = { kill: 5, jin: 4 };
    eco.coins = 9;
    rec.afterStep(state, DT);
    eco.earned = { kill: 7, jin: 4 };
    eco.spent = { flask: 3 };
    rec.afterStep(state, DT);
    const band = rec.tally.bands["1-5"];
    expect(band.earned, "撃破 7 と陣 4 が源別に積まれる").toEqual({ kill: 7, jin: 4 });
    expect(band.spent, "瓶の支出 3").toEqual({ flask: 3 });
    expect(band.floors, "初期の階を 1 階に数える").toBe(1);
  });

  it("深度が変わったら別の帯に入り、同じ深度を二度数えない", () => {
    const state = createGame(11);
    const eco = withEconomy(state, fakeEconomy());
    const rec = createEconomyRecorder(state);
    state.depth = 6;
    eco.earned = { floor: 3 };
    rec.afterStep(state, DT);
    state.depth = 5;
    rec.afterStep(state, DT);
    state.depth = 6;
    rec.afterStep(state, DT);
    expect(rec.tally.bands["6-10"].earned, "階の到着の稼ぎは新しい帯へ").toEqual({ floor: 3 });
    expect(rec.tally.bands["1-5"].floors, "深度 1 と 5 の 2 階").toBe(2);
    expect(rec.tally.bands["6-10"].floors, "深度 6 は上り下りしても 1 階").toBe(1);
  });

  it("落ちた銭・寿命切れで消えた銭・拾われた銭を区別する", () => {
    const state = createGame(11);
    withEconomy(state, fakeEconomy());
    const rec = createEconomyRecorder(state);
    state.pickups.push(coinPickup(1, { value: 2, life: 8 }), coinPickup(2, { value: 3, life: DT }), coinPickup(3, { value: 4, life: 5 }));
    rec.afterStep(state, DT);
    expect(rec.tally.bands["1-5"].dropped, "落ちた額の合計").toBe(9);
    // 2 は寿命切れ、3 は拾われて消える
    state.pickups = state.pickups.filter((p) => (p as unknown as { id: number }).id === 1);
    rec.afterStep(state, DT);
    const band = rec.tally.bands["1-5"];
    expect(band.vanished, "寿命切れの 3 だけが消えた銭").toBe(3);
    expect(rec.tally.maxCoinPickups, "同時にあった実体の最大").toBe(3);
  });

  it("こぼれた銭は落ちた・消えたに数えず、こぼれた回数と拾い直しを差分で数える", () => {
    const state = createGame(11);
    const eco = withEconomy(state, fakeEconomy({ coins: 100 }));
    const rec = createEconomyRecorder(state);
    eco.spilled = 5;
    state.pickups.push(coinPickup(7, { value: 5, life: DT, spilled: true }));
    rec.afterStep(state, DT);
    state.pickups = [];
    eco.recovered = 2;
    rec.afterStep(state, DT);
    const band = rec.tally.bands["1-5"];
    expect(band.dropped, "こぼれた銭は落ちた銭に入れない").toBe(0);
    expect(band.vanished, "こぼれた銭は消えた銭に入れない").toBe(0);
    expect(band.spilled).toBe(5);
    expect(band.spillEvents).toBe(1);
    expect(band.recovered).toBe(2);
  });

  it("economy が落ちた額・消えた額を数えていれば、床の実体から推さずその差分を使う", () => {
    const state = createGame(11);
    const eco = withEconomy(state, Object.assign(fakeEconomy(), { dropped: 0, expired: 0 }));
    const rec = createEconomyRecorder(state);
    // 実体は寿命切れに見えるが、economy の数え方が正なので二重に数えない
    state.pickups.push(coinPickup(1, { value: 9, life: DT }));
    Object.assign(eco, { dropped: 9 });
    rec.afterStep(state, DT);
    state.pickups = [];
    Object.assign(eco, { expired: 4 });
    rec.afterStep(state, DT);
    const band = rec.tally.bands["1-5"];
    expect(band.dropped, "economy.dropped の増分").toBe(9);
    expect(band.vanished, "economy.expired の増分（実体の消失は数えない）").toBe(4);
  });

  it("階を離れて置き去りにした銭は消えた銭に数える", () => {
    const state = createGame(11);
    withEconomy(state, fakeEconomy());
    const rec = createEconomyRecorder(state);
    state.pickups.push(coinPickup(1, { value: 6, life: 7 }));
    rec.afterStep(state, DT);
    state.depth = 2;
    state.pickups = [];
    rec.afterStep(state, DT);
    expect(rec.tally.bands["1-5"].vanished, "置き去りの 6").toBe(6);
  });

  it("最大数を超えて額が足された分も落ちた額に数える", () => {
    const state = createGame(11);
    withEconomy(state, fakeEconomy());
    const rec = createEconomyRecorder(state);
    state.pickups.push(coinPickup(1, { value: 2, life: 8 }));
    rec.afterStep(state, DT);
    state.pickups = [coinPickup(1, { value: 5, life: 8 })];
    rec.afterStep(state, DT);
    expect(rec.tally.bands["1-5"].dropped, "2 + 増えた 3").toBe(5);
  });

  it("死亡時の持ち金を控え、節に平均が出る", () => {
    const state = createGame(11);
    const eco = withEconomy(state, fakeEconomy());
    const rec = createEconomyRecorder(state);
    eco.earned = { kill: 100 };
    eco.coins = 150;
    rec.afterStep(state, DT);
    state.status = "dead";
    rec.finish(state);
    expect(rec.tally.died).toBe(true);
    expect(rec.tally.finalCoins).toBe(150);
    const md = buildEconomySection([rec.tally]).join("\n");
    expect(md, "死亡 1 run の持ち金 150").toContain("死亡 1 / 1 run: 持ち金 平均 150.0");
    expect(md, "1 階の稼ぎ 100 に対する比").toContain("×1.50");
    expect(md).not.toMatch(/NaN|Infinity/);
  });

  it("鍵・瓶・商人・無法者・賭けの欄は、state に現れたときだけ節に出る", () => {
    const plain = createGame(11);
    withEconomy(plain, fakeEconomy());
    const plainRec = createEconomyRecorder(plain);
    plainRec.afterStep(plain, DT);
    plainRec.finish(plain);
    const plainMd = buildEconomySection([plainRec.tally]).join("\n");
    expect(plainMd, "欄が無ければ鍵の行を出さない").not.toContain("- 鍵");
    expect(plainMd, "欄が無ければ商人の行を出さない").not.toContain("- 商人");
    expect(plainMd, "欄が無ければ賭けの行を出さない").not.toContain("- 賭け");

    const full = createGame(11);
    const eco = withEconomy(full, fakeEconomy({ keys: 1, outlaw: false, merchants: [{}, {}], bet: null }));
    Object.assign(full.player, { flasks: 2 });
    const fullRec = createEconomyRecorder(full);
    eco.keys = 0;
    eco.outlaw = true;
    Object.assign(full.player, { flasks: 1 });
    fullRec.afterStep(full, DT);
    fullRec.finish(full);
    const md = buildEconomySection([fullRec.tally]).join("\n");
    expect(md, "鍵を 1 本使った").toContain("使った 1");
    expect(md, "瓶を 1 本飲んだ").toContain("飲んだ 1");
    expect(md, "商人 2 人が立ち、襲われた").toContain("立った 2、襲われた 1");
    expect(md).toContain("- 無法者になったラン: 1 / 1");
    expect(md).toContain("- 賭け");
  });

  it("state.economy が無ければ計測なしと出し、落ちない", () => {
    const state = createGame(11);
    Reflect.deleteProperty(state, "economy");
    const rec = createEconomyRecorder(state);
    rec.afterStep(state, DT);
    rec.finish(state);
    expect(rec.tally.seen.economy).toBe(false);
    expect(buildEconomySection([rec.tally]).join("\n")).toContain("計測なし");
    expect(buildEconomySection([]).join("\n"), "run が 0 件でも落ちない").toContain("計測なし");
  });

  it("未知の源・用途は key のまま列に出る", () => {
    const state = createGame(11);
    const eco = withEconomy(state, fakeEconomy());
    const rec = createEconomyRecorder(state);
    eco.earned = { kill: 1, mystery: 4 };
    eco.spent = { oddity: 2 };
    rec.afterStep(state, DT);
    const md = buildEconomySection([rec.tally]).join("\n");
    expect(md).toContain("mystery");
    expect(md).toContain("oddity");
  });

  it("空の集計から節を作っても NaN を出さない", () => {
    const t = emptyEconomyTally();
    t.seen.economy = true;
    expect(buildEconomySection([t]).join("\n")).not.toMatch(/NaN|Infinity/);
  });
});

describe("敵の総数から商人・壺を除く（qa/jinMetrics.ts）", () => {
  it("def.merchant / def.container を持つ敵を数えず、欄が無い定義は数える", () => {
    const state = createGame(3);
    const total = state.enemies.length;
    expect(total, "生成直後の敵がいる前提").toBeGreaterThan(2);
    expect(countCombatants(state.enemies, () => ({})), "欄が無ければ全員数える").toBe(total);
    const firstKey = state.enemies[0]?.defKey;
    const defOf = (key: string): object => (key === firstKey ? { merchant: "market" } : { container: undefined });
    const fixtures = state.enemies.filter((e) => e.defKey === firstKey).length;
    expect(countCombatants(state.enemies, defOf), "商人の定義を持つ敵だけが除かれる").toBe(total - fixtures);
    expect(countCombatants(state.enemies, () => ({ container: "pot" })), "壺だけなら 0").toBe(0);
  });
});
