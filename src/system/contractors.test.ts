import { describe, expect, it } from "vitest";
import { createGame } from "../core/game";
import { FIXED_DT } from "../core/loop";
import type { GameState } from "../core/state";
import { CONTRACT, ROOM_KIND } from "../data/tuning";
import { BOONS, BOON_KEYS, grantBoon } from "./boons";
import {
  CONTRACTORS,
  CONTRACTOR_KEYS,
  type ContractOffer,
  type ContractorKey,
  PACTS,
  PACT_KEYS,
  activeInfusions,
  ensureContractStats,
  gainShards,
  nextBossDepth,
  offerLabel,
  onContractsFloorReached,
  onContractsRoomCleared,
  placeContractor,
  spendShards,
  standContractor,
  updateContractors,
} from "./contractors";
import { buildFloor, descend } from "./floor";
import { applyStatus, hasStatus } from "./statusEffects";
import { isBossDepth } from "./boss";
import { applyBoonsToStats } from "./boons";

/** 1 ステップ */
const DT = FIXED_DT;
const SEEDS = [3, 5, 7, 11, 13, 17, 19, 23, 29, 31];

/** 回廊の階に、決まった契約者を立たせた状態（立てられる seed を探す）。自然に起きるイベントは止める */
function withContractor(key: ContractorKey, depth = 4): GameState {
  for (const seed of SEEDS) {
    const state = createGame(seed);
    state.depth = depth;
    buildFloor(state, "rooms");
    quiet(state);
    if (standContractor(state, key)) return state;
  }
  throw new Error(`契約者 ${key} を立てられる seed が無い`);
}

function quiet(state: GameState): void {
  state.runEvents.room = null;
  state.runEvents.floor = null;
  state.runEvents.cooldown = 1e9;
  state.runEvents.timedCheck = 1e9;
  state.runEvents.linger.kind = null;
  state.player.invulnTimer = 1e9;
}

function offerOf(state: GameState, kind: ContractOffer["kind"], key?: string): ContractOffer {
  const offer = state.contracts.contractor?.offers.find((o) => o.kind === kind && (key === undefined || o.key === key));
  if (!offer) throw new Error(`台座 ${kind} が無い`);
  return offer;
}

/** 台座から離れて（台座が再び使えるようになってから）触れる */
function touch(state: GameState, offer: ContractOffer): void {
  const who = state.contracts.contractor;
  if (!who) throw new Error("契約者がいない");
  state.player.body.pos = { x: who.pos.x, y: who.pos.y - CONTRACT.standOffset * 16 };
  updateContractors(state, DT);
  state.player.body.pos = { ...offer.pos };
  updateContractors(state, DT);
}

describe("契約者: 定義", () => {
  it("契約者は 8 種以上で、名前・一言・色を持つ", () => {
    expect(CONTRACTOR_KEYS.length, "契約者の数").toBeGreaterThanOrEqual(8);
    for (const key of CONTRACTOR_KEYS) {
      const def = CONTRACTORS[key];
      expect(def.name.length, `${key} の名前`).toBeGreaterThan(0);
      expect(def.line.length, `${key} の一言`).toBeGreaterThan(0);
      expect(CONTRACT.weights[key], `${key} の重み`).toBeGreaterThan(0);
    }
  });

  it("どの契約者も 2〜3 個の台座を並べる", () => {
    for (const key of CONTRACTOR_KEYS) {
      const state = withContractor(key);
      const n = state.contracts.contractor?.offers.length ?? 0;
      expect(n, `${key} の台座`).toBeGreaterThanOrEqual(2);
      expect(n, `${key} の台座`).toBeLessThanOrEqual(3);
      for (const o of state.contracts.contractor?.offers ?? []) expect(offerLabel(o).length, `${key} の台座の名前`).toBeGreaterThan(0);
    }
  });

  it("契約は 4 種で、条件と結果を語る", () => {
    for (const key of PACT_KEYS) expect(PACTS[key].desc.length, key).toBeGreaterThan(0);
  });
});

describe("契約者: 出現", () => {
  it("浅い階（深度 1）には立たない", () => {
    const state = createGame(3);
    state.depth = 1;
    buildFloor(state, "rooms");
    expect(state.contracts.contractor, "深度 1").toBeNull();
  });

  it("ボスを倒した次の階は必ず抽選される（場所が取れれば立つ）", () => {
    let stood = 0;
    for (const seed of SEEDS) {
      const state = createGame(seed);
      state.depth = 4;
      expect(isBossDepth(3), "深度 3 はボス階").toBe(true);
      buildFloor(state, "rooms");
      if (state.contracts.contractor) stood++;
    }
    expect(stood, "ボスの次の階に立った数").toBeGreaterThan(SEEDS.length / 2);
  });

  it("同じ seed なら同じ契約者が同じ台座で立つ（決定的）", () => {
    const a = createGame(11);
    const b = createGame(11);
    for (const s of [a, b]) {
      s.depth = 4;
      buildFloor(s, "rooms");
    }
    expect(JSON.stringify(a.contracts.contractor), "同じ契約者").toBe(JSON.stringify(b.contracts.contractor));
  });

  it("立った直後は触れていても台座が動かない（出現直後の誤爆を防ぐ）", () => {
    const state = withContractor("peddler");
    state.shards = 99;
    const offer = offerOf(state, "buyItem");
    state.player.body.pos = { ...offer.pos };
    updateContractors(state, DT);
    expect(offer.used, "出現直後").toBe(false);
    expect(state.shards, "欠片は減らない").toBe(99);
  });

  it("階を移ると前の階の契約者は消え、祭壇の属性（この階だけ）も消える", () => {
    const state = withContractor("smith");
    state.contracts.altar = { element: "fire", share: ROOM_KIND.elementAltarShare };
    state.depth = 1;
    placeContractor(state);
    expect(state.contracts.contractor, "深度 1 では立たない").toBeNull();
    expect(state.contracts.altar, "祭壇の属性").toBeNull();
  });
});

describe("欠片", () => {
  it("得る・払う。足りなければ払えない", () => {
    const state = createGame(3);
    gainShards(state, 3);
    expect(state.shards).toBe(3);
    expect(spendShards(state, 5), "足りない").toBe(false);
    expect(state.shards).toBe(3);
    expect(spendShards(state, 2), "足りる").toBe(true);
    expect(state.shards).toBe(1);
  });

  it("制圧で欠片が入り、波の部屋は多い", () => {
    const state = createGame(3);
    const room = state.rooms[1];
    if (!room) throw new Error("room");
    room.kind = "normal";
    onContractsRoomCleared(state, room);
    expect(state.shards, "通常の部屋").toBe(CONTRACT.shardsPerClear);
    room.kind = "challenge";
    onContractsRoomCleared(state, room);
    expect(state.shards, "試練").toBe(CONTRACT.shardsPerClear * 2 + CONTRACT.shardsBonusRoom);
  });

  it("初めて着いた階で欠片が入る", () => {
    const state = createGame(3);
    const before = state.shards;
    descend(state, "rooms");
    expect(state.shards - before, "階層到達").toBeGreaterThanOrEqual(CONTRACT.shardsPerFloor);
  });
});

describe("契約者: 取引", () => {
  it("欠片が足りなければ何も起きない", () => {
    const state = withContractor("peddler");
    state.shards = 0;
    const items = state.floorItems.length;
    const offer = offerOf(state, "buyItem");
    touch(state, offer);
    expect(offer.used, "使われない").toBe(false);
    expect(state.floorItems.length, "遺物は出ない").toBe(items);
  });

  it("行商: 欠片で遺物を買う", () => {
    const state = withContractor("peddler");
    state.shards = CONTRACT.peddlerItemCost;
    const items = state.floorItems.length;
    touch(state, offerOf(state, "buyItem"));
    expect(state.floorItems.length, "遺物が 1 つ").toBe(items + 1);
    expect(state.shards, "欠片").toBe(0);
  });

  it("行商: 欠片で残響を買う（main.ts が残響の保存へ移す）", () => {
    const state = withContractor("peddler");
    state.shards = CONTRACT.peddlerEchoCost;
    touch(state, offerOf(state, "buyEchoes"));
    const total = Object.values(state.runEvents.pendingEchoes).reduce((s, v) => s + v, 0);
    expect(total, "残響").toBe(CONTRACT.peddlerEchoes);
  });

  it("修理屋: 清めで悪い状態異常が解け、呪いも晴れる", () => {
    const state = withContractor("mender");
    state.shards = CONTRACT.menderCleanseCost;
    applyStatus(state, { kind: "player" }, { kind: "poison", stacks: 2, duration: 5, potency: 1 }, "env");
    state.cursed = true;
    expect(hasStatus(state.player.status, "poison"), "毒").toBe(true);
    touch(state, offerOf(state, "cleanse"));
    expect(hasStatus(state.player.status, "poison"), "毒が解けた").toBe(false);
    expect(state.cursed, "呪い").toBe(false);
  });

  it("修理屋: 呪いを抱えていなければ呪いを解けない（欠片は払わない）", () => {
    const state = withContractor("mender");
    state.shards = CONTRACT.menderUncurseCost;
    const offer = offerOf(state, "uncurse");
    touch(state, offer);
    expect(offer.used).toBe(false);
    expect(state.shards).toBe(CONTRACT.menderUncurseCost);
  });

  it("修理屋: 呪い付きの祝福を 1 つ外す", () => {
    const state = withContractor("mender");
    const cursed = BOON_KEYS.find((k) => BOONS[k].cursed && !BOONS[k].after && !BOONS[k].duo);
    if (!cursed) throw new Error("呪い付きの祝福が無い");
    grantBoon(state, cursed);
    state.shards = CONTRACT.menderUncurseCost;
    touch(state, offerOf(state, "uncurse"));
    expect(state.boons.includes(cursed), "外れた").toBe(false);
  });

  it("占い: 次の階を読むと、次の階のイベントがその通りになる", () => {
    const state = withContractor("seer");
    state.shards = CONTRACT.seerReadCost;
    touch(state, offerOf(state, "foretell"));
    const foretold = state.contracts.foretold;
    expect(foretold, "読んだ").not.toBeNull();
    descend(state, "rooms");
    const floorEvent = state.runEvents.floor?.key ?? "calm";
    expect(floorEvent, "予言どおり").toBe(foretold);
    expect(state.contracts.foretold, "使ったら消える").toBeNull();
  });

  it("占い: 凶兆を払うと次の階の階のイベントは起きない", () => {
    const state = withContractor("seer");
    state.shards = CONTRACT.seerWardCost;
    touch(state, offerOf(state, "ward"));
    descend(state, "rooms");
    expect(state.runEvents.floor, "階の枠").toBeNull();
  });

  it("占い: 次のボス階は深度より深い最初のボス階", () => {
    const d = nextBossDepth(4);
    expect(d).toBeGreaterThan(4);
    expect(isBossDepth(d)).toBe(true);
  });

  it("賭場: 欠片を賭けると倍になるか失う", () => {
    const state = withContractor("bookie");
    state.shards = CONTRACT.bookieBet;
    touch(state, offerOf(state, "betShards"));
    expect([0, CONTRACT.bookieBet * 2], "倍か無").toContain(state.shards);
  });

  it("賭場: 生命を賭けると生命が減る", () => {
    const state = withContractor("bookie");
    const hp = state.player.hp;
    touch(state, offerOf(state, "betLife"));
    expect(state.player.hp, "生命").toBeCloseTo(hp - state.player.maxHp * CONTRACT.bookieLifeCost, 5);
  });

  it("語り部: 見届けてもらうと目撃の時間が始まり、時間で減る", () => {
    const state = withContractor("bard");
    touch(state, offerOf(state, "witness"));
    expect(state.contracts.witness, "目撃").toBeGreaterThan(CONTRACT.bardWitnessTime - 1);
    updateContractors(state, 1);
    expect(state.contracts.witness, "減る").toBeLessThan(CONTRACT.bardWitnessTime);
  });

  it("鍛冶: 焼き付けた属性が通常攻撃の属性の割合に足され、装備を付け替えても残る", () => {
    const state = withContractor("smith");
    state.shards = CONTRACT.smithCost;
    const offer = state.contracts.contractor?.offers[0];
    if (!offer) throw new Error("台座");
    const element = offer.key as keyof typeof state.stats.infuse;
    const before = state.stats.infuse[element];
    touch(state, offer);
    expect(state.stats.infuse[element], "焼き付け").toBeCloseTo(before + CONTRACT.smithShare, 5);
    // 装備画面などで stats が畳み直されても、次のステップで足し直す
    applyBoonsToStats(state);
    ensureContractStats(state);
    expect(state.stats.infuse[element], "畳み直した後").toBeCloseTo(before + CONTRACT.smithShare, 5);
    expect(state.contracts.contractor?.offers.every((o) => o.used), "他の属性は選べない").toBe(true);
  });

  it("属性の上乗せが外れたら、前の上乗せを残さない", () => {
    const state = withContractor("smith");
    const before = state.stats.infuse.fire;
    state.contracts.altar = { element: "fire", share: 0.5 };
    ensureContractStats(state);
    expect(state.stats.infuse.fire).toBeCloseTo(before + 0.5, 5);
    state.contracts.altar = null;
    ensureContractStats(state);
    expect(state.stats.infuse.fire, "戻る").toBeCloseTo(before, 5);
    expect(activeInfusions(state)).toEqual([]);
  });

  it("案内人: 分岐路に階段を 1 つ足す", () => {
    const state = withContractor("guide");
    state.shards = CONTRACT.guideForkCost;
    const before = state.stairs.length;
    touch(state, offerOf(state, "fork"));
    const offer = offerOf(state, "fork");
    if (offer.used) {
      expect(state.stairs.length, "階段").toBe(before + 1);
      const kinds = state.stairs.map((s) => s.nextKind);
      expect(new Set(kinds).size, "行き先は重ならない").toBe(kinds.length);
    } else {
      expect(state.shards, "足せなければ払わない").toBe(CONTRACT.guideForkCost);
    }
  });

  it("渡し守: 生命で時を買うと死神の猶予が延び、回数に上限がある", () => {
    const state = withContractor("ferryman");
    state.floorTime = 100;
    touch(state, offerOf(state, "ferryLife"));
    expect(state.floorTime, "経過時間が戻る").toBe(100 - CONTRACT.ferryTime);
    expect(state.contracts.ferried).toBe(1);
    state.contracts.ferried = CONTRACT.ferryMaxUses;
    state.shards = CONTRACT.ferryShardCost;
    const offer = offerOf(state, "ferryShards");
    touch(state, offer);
    expect(offer.used, "上限").toBe(false);
  });
});

describe("灰の公証人: 契約", () => {
  it("契約を 1 つ結ぶと、他の契約の台座は消える", () => {
    const state = withContractor("notary");
    const offer = state.contracts.contractor?.offers[0];
    if (!offer) throw new Error("台座");
    touch(state, offer);
    expect(state.contracts.pacts.map((p) => p.key)).toEqual([offer.key]);
    expect(state.contracts.contractor?.offers.every((o) => o.used)).toBe(true);
  });

  it("無傷の契約: 被弾したら破れて呪いを受ける", () => {
    const state = withContractor("notary");
    state.contracts.pacts = [{ key: "unscathed", signedAt: state.time, killsAt: 0, depth: state.depth, failed: false }];
    const cursedBefore = state.boons.filter((k) => BOONS[k].cursed).length;
    state.time += 1;
    state.recent.onHurt = { lastTime: state.time, count: 1 };
    updateContractors(state, DT);
    expect(state.contracts.pacts, "破れた").toEqual([]);
    expect(state.boons.filter((k) => BOONS[k].cursed).length, "呪い").toBe(cursedBefore + 1);
  });

  it("無傷の契約: 被弾せず次の階に着けば欠片と祝福の 3 択", () => {
    const state = withContractor("notary");
    state.contracts.pacts = [{ key: "unscathed", signedAt: state.time, killsAt: 0, depth: state.depth, failed: false }];
    const shards = state.shards;
    onContractsFloorReached(state);
    expect(state.shards, "欠片").toBe(shards + CONTRACT.pactUnscathedShards);
    expect(state.boonChoice, "祝福の 3 択").not.toBeNull();
  });

  it("狩りの契約: 数が足りずに次の階へ着くと呪い、足りれば遺物", () => {
    const fail = withContractor("notary");
    fail.contracts.pacts = [{ key: "slayer", signedAt: fail.time, killsAt: fail.kills, depth: fail.depth, failed: false }];
    const cursed = fail.boons.filter((k) => BOONS[k].cursed).length;
    onContractsFloorReached(fail);
    expect(fail.boons.filter((k) => BOONS[k].cursed).length, "呪い").toBe(cursed + 1);

    const ok = withContractor("notary");
    ok.contracts.pacts = [{ key: "slayer", signedAt: ok.time, killsAt: ok.kills, depth: ok.depth, failed: false }];
    ok.kills += CONTRACT.pactSlayerKills;
    const items = ok.floorItems.length;
    onContractsFloorReached(ok);
    expect(ok.floorItems.length, "遺物").toBe(items + 1);
  });

  it("疾走の契約: 時間切れで破れ、次の階の死神が早まる", () => {
    const state = withContractor("notary");
    state.contracts.pacts = [{ key: "swift", signedAt: state.time, killsAt: 0, depth: state.depth, failed: false }];
    state.time += CONTRACT.pactSwiftTime + 1;
    updateContractors(state, DT);
    expect(state.contracts.pacts).toEqual([]);
    state.floorTime = 0;
    onContractsFloorReached(state);
    expect(state.floorTime, "死神の前倒し").toBe(CONTRACT.pactSwiftPenalty);
  });

  it("沈黙の契約: スキルを使うと破れて欠片を失う", () => {
    const state = withContractor("notary");
    state.shards = 5;
    state.contracts.pacts = [{ key: "silent", signedAt: state.time, killsAt: 0, depth: state.depth, failed: false }];
    state.time += 1;
    state.recent.onSkillCast = { lastTime: state.time, count: 1 };
    updateContractors(state, DT);
    expect(state.shards).toBe(5 - CONTRACT.pactSilentPenaltyShards);
  });
});
