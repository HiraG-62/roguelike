import { describe, expect, it } from "vitest";
import { createGame } from "../core/game";
import type { GameState, Pickup } from "../core/state";
import { createEconomyRecorder, buildEconomySection, emptyEconomyTally } from "./economyMetrics";
import { TILE_SIZE, Tile, setTile } from "../map/grid";
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
  bought?: Record<string, number>;
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
    expect(md, "商人 2 人が立ち、襲われた").toMatch(/立った 2、買い物 0 の商人 \d+%、襲われた 1/);
    expect(md).toContain("- 無法者になったラン: 1 / 1");
    expect(md).toContain("- 賭け");
  });

  it("賭けの型ごとの記録（economy.betStats）をランの終わりに写し、ランをまたいで足し合わせる", () => {
    const tallies = [0, 1].map(() => {
      const state = createGame(11);
      const eco = withEconomy(state, fakeEconomy({ bet: null }));
      Object.assign(eco, {
        betStats: {
          chohan: { placed: 2, won: 1, staked: 40, paid: 40, tiers: {} },
          swift: { placed: 1, won: 1, staked: 30, paid: 60, tiers: { hard: { settled: 1, won: 1 } } },
        },
      });
      const rec = createEconomyRecorder(state);
      rec.afterStep(state, DT);
      rec.finish(state);
      return rec.tally;
    });
    expect(tallies[0]?.bets["swift"], "写し").toEqual({ placed: 1, won: 1, staked: 30, paid: 60, tiers: { hard: { settled: 1, won: 1 } } });
    const md = buildEconomySection(tallies).join("\n");
    expect(md, "丁半 4 回、勝率 50%、純益 0").toContain("丁半: 4 回、勝率 50%");
    expect(md, "速攻の難 2 回とも成功、純益 60").toMatch(/速攻: 2 回、勝率 100%（難 100%）、純益 60/);
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

describe("瓶と商人の計測（qa/economyMetrics.ts）", () => {
  function shopState(): { state: GameState; eco: FakeEconomy; merchant: { wares: { used: boolean }[] } } {
    const state = createGame(11);
    const merchant = { wares: [{ used: false }, { used: false }] };
    const eco = withEconomy(state, fakeEconomy({ keys: 0, bought: {}, merchants: [merchant] }));
    Object.assign(state.player, { flasks: 0 });
    return { state, eco, merchant };
  }

  it("買った瓶は economy.bought の増分を正とし、買って増えた本数を泉・拾いに数えない", () => {
    const { state, eco } = shopState();
    const rec = createEconomyRecorder(state);
    eco.bought = { flask: 1 };
    Object.assign(state.player, { flasks: 1 });
    rec.afterStep(state, DT);
    const band = rec.tally.bands["1-5"];
    expect(band.flasksBought, "買った 1").toBe(1);
    expect(band.flasksFountain + band.flasksPicked, "買った分は泉にも拾いにも入らない").toBe(0);
    expect(band.bought, "品別の買った回数").toEqual({ flask: 1 });
  });

  it("買った直後に飲むと、買った数と飲んだ数の両方に出る", () => {
    const { state, eco } = shopState();
    Object.assign(state.player, { flasks: 1 });
    const rec = createEconomyRecorder(state);
    eco.bought = { flask: 1 };
    // 買って +1、同じ step で飲んで -1: 差し引きは 0
    rec.afterStep(state, DT);
    const band = rec.tally.bands["1-5"];
    expect(band.flasksBought).toBe(1);
    expect(band.flasksDrunk, "net 0 でも買った分だけ飲んだと分かる").toBe(1);
  });

  it("買っていない増えは、泉のタイルの近くなら泉で満たした、離れていれば拾いに数える", () => {
    const { state } = shopState();
    const rec = createEconomyRecorder(state);
    // 泉から遠い場所（マップの外れ）に立たせて、まず拾い
    Object.assign(state.player, { flasks: 1 });
    rec.afterStep(state, DT);
    // 足元に泉のタイルを置いて満たす
    const pos = state.player.body.pos;
    const tx = Math.floor(pos.x / TILE_SIZE);
    const ty = Math.floor(pos.y / TILE_SIZE);
    setTile(state.map, tx, ty, Tile.Fountain);
    Object.assign(state.player, { flasks: 2 });
    rec.afterStep(state, DT);
    const band = rec.tally.bands["1-5"];
    expect(band.flasksPicked, "泉の無い所での増えは拾い").toBe(1);
    expect(band.flasksFountain, "泉のそばでの増えは泉").toBe(1);
  });

  it("階を離れるまで台座が 1 つも売れなかった商人を、買い物 0 に数える", () => {
    const { state } = shopState();
    const rec = createEconomyRecorder(state);
    rec.afterStep(state, DT);
    state.depth = 2;
    Object.assign(state.economy, { merchants: [{ wares: [{ used: false }] }, { wares: [{ used: false }] }] });
    rec.afterStep(state, DT);
    // 深度 2 の商人 2 人のうち 1 人は売れた
    const second = (state.economy as unknown as { merchants: { wares: { used: boolean }[] }[] }).merchants[0];
    if (second?.wares[0]) second.wares[0].used = true;
    rec.finish(state);
    const band = rec.tally.bands["1-5"];
    expect(band.merchants, "深度 1 の 1 人 + 深度 2 の 2 人").toBe(3);
    expect(band.merchantsUnshopped, "深度 1 の 1 人と深度 2 の 1 人が売れなかった").toBe(2);
  });

  it("台座の used にならない買い物（引き直しなど）も、商人が 1 人だけの階なら買い物ありに数える", () => {
    const { state, eco } = shopState();
    (state.economy as unknown as { merchants: unknown[] }).merchants = [{ wares: [{ used: false }] }];
    const rec = createEconomyRecorder(state);
    eco.bought = { reroll: 1 };
    rec.afterStep(state, DT);
    rec.finish(state);
    expect(rec.tally.bands["1-5"].merchantsUnshopped, "引き直しで買い物あり").toBe(0);
  });

  it("節に章別の瓶と買い物の表が出て、NaN を出さない", () => {
    const { state, eco } = shopState();
    // 商人 2 人（1 人だけの階は「引き直し」の救済が働くので、割合を見るには 2 人にする）
    eco.merchants = [{ wares: [{ used: false }] }, { wares: [{ used: false }] }];
    const rec = createEconomyRecorder(state);
    eco.bought = { flask: 2 };
    Object.assign(state.player, { flasks: 1 });
    rec.afterStep(state, DT);
    state.status = "dead";
    rec.finish(state);
    const md = buildEconomySection([rec.tally]).join("\n");
    expect(md, "章別の表").toContain("### 章別の瓶と買い物");
    expect(md, "買った瓶 2・飲んだ瓶 1").toContain("| 1-5 | 1 | 2 | 100% | 2 | 0 | 0 | 1 | flask 2 |");
    expect(md, "瓶の行に内訳").toContain("買った 2 / 泉で満たした 0 / 拾った 0 / 飲んだ 1 / 死亡時の残り 平均 1.0");
    expect(md, "買い物 0 の商人の割合").toContain("買い物 0 の商人 100%");
    expect(md).not.toMatch(/NaN|Infinity/);
  });

  it("瓶も商人も無い state では章別の表を出さない", () => {
    const state = createGame(11);
    withEconomy(state, fakeEconomy());
    Reflect.deleteProperty(state.player, "flasks");
    const rec = createEconomyRecorder(state);
    rec.afterStep(state, DT);
    rec.finish(state);
    expect(buildEconomySection([rec.tally]).join("\n")).not.toContain("章別の瓶と買い物");
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
