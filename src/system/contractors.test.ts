import { describe, expect, it } from "vitest";
import { createGame } from "../core/game";
import { FIXED_DT } from "../core/loop";
import type { GameState } from "../core/state";
import { BOSS, CONTRACT, ECONOMY, ROOM_KIND } from "../data/tuning";
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
  nextBossDepth,
  offerLabel,
  onContractsFloorReached,
  onContractsRoomCleared,
  placeContractor,
  standContractor,
  updateContractors,
} from "./contractors";
import { buildFloor, descend } from "./floor";
import { applyStatus, hasStatus } from "./statusEffects";
import { isBossDepth } from "./boss";
import { applyBoonsToStats } from "./boons";
import { endForm, updateForm } from "../skills/actions2";

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

  it("どの契約者も 2〜3 個の台座を並べる（賭場の主は賭け 4 つ + 生命を賭ける台）", () => {
    for (const key of CONTRACTOR_KEYS) {
      const state = withContractor(key);
      const n = state.contracts.contractor?.offers.length ?? 0;
      const max = key === "bookie" ? ECONOMY.bet.luckOffers + ECONOMY.bet.skillOffers + 1 : 3;
      expect(n, `${key} の台座`).toBeGreaterThanOrEqual(2);
      expect(n, `${key} の台座`).toBeLessThanOrEqual(max);
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
      state.depth = BOSS.interval + 1;
      expect(isBossDepth(BOSS.interval), "ボス階").toBe(true);
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
    state.economy.coins = 99;
    const offer = offerOf(state, "buyItem");
    state.player.body.pos = { ...offer.pos };
    updateContractors(state, DT);
    expect(offer.used, "出現直後").toBe(false);
    expect(state.economy.coins, "銭は減らない").toBe(99);
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

describe("銭と契約者", () => {
  it("台座で払うと持ち金が減り、契約者への支出に積まれる", () => {
    const state = withContractor("peddler");
    state.economy.coins = CONTRACT.peddlerItemCost + 5;
    touch(state, offerOf(state, "buyItem"));
    expect(state.economy.coins, "持ち金").toBe(5);
    expect(state.economy.spent.contract, "契約者への支出").toBe(CONTRACT.peddlerItemCost);
  });

  it("賭けの代価は賭けの支出に積まれる", () => {
    const state = withContractor("bookie");
    state.economy.coins = 100;
    const offer = offerOf(state, "bet");
    touch(state, offer);
    expect(offer.used, "張った").toBe(true);
    expect(state.economy.spent.bet, "賭けの支出").toBe(offer.cost);
    expect(offer.cost, "賭け金").toBeGreaterThan(0);
  });

  it("代価 0 の台座は支出に積まれない", () => {
    const state = withContractor("bard");
    state.economy.coins = 10;
    touch(state, offerOf(state, "witness"));
    expect(state.economy.coins, "持ち金は減らない").toBe(10);
    expect(state.economy.spent.contract, "支出").toBe(0);
  });

  it("制圧で契約者側は銭を出さない（制圧の銭は economy.ts）", () => {
    const state = createGame(3);
    const room = state.rooms[1];
    if (!room) throw new Error("room");
    onContractsRoomCleared(state, room);
    expect(state.economy.coins, "契約者側は銭を出さない").toBe(0);
  });
});

describe("契約者: 取引", () => {
  it("銭が足りなければ何も起きない", () => {
    const state = withContractor("peddler");
    state.economy.coins = 0;
    const items = state.floorItems.length;
    const offer = offerOf(state, "buyItem");
    touch(state, offer);
    expect(offer.used, "使われない").toBe(false);
    expect(state.floorItems.length, "遺物は出ない").toBe(items);
  });

  it("行商: 銭で遺物を買う", () => {
    const state = withContractor("peddler");
    state.economy.coins = CONTRACT.peddlerItemCost;
    const items = state.floorItems.length;
    touch(state, offerOf(state, "buyItem"));
    expect(state.floorItems.length, "遺物が 1 つ").toBe(items + 1);
    expect(state.economy.coins, "銭").toBe(0);
  });

  it("行商: 銭で残響を買う（main.ts が残響の保存へ移す）", () => {
    const state = withContractor("peddler");
    state.economy.coins = CONTRACT.peddlerEchoCost;
    touch(state, offerOf(state, "buyEchoes"));
    const total = Object.values(state.runEvents.pendingEchoes).reduce((s, v) => s + v, 0);
    expect(total, "残響").toBe(CONTRACT.peddlerEchoes);
  });

  it("修理屋: 清めで悪い状態異常が解け、呪いも晴れる", () => {
    const state = withContractor("mender");
    state.economy.coins = CONTRACT.menderCleanseCost;
    applyStatus(state, { kind: "player" }, { kind: "poison", stacks: 2, duration: 5, potency: 1 }, "env");
    state.cursed = true;
    expect(hasStatus(state.player.status, "poison"), "毒").toBe(true);
    touch(state, offerOf(state, "cleanse"));
    expect(hasStatus(state.player.status, "poison"), "毒が解けた").toBe(false);
    expect(state.cursed, "呪い").toBe(false);
  });

  it("修理屋: 呪いを抱えていなければ呪いを解けない（銭は払わない）", () => {
    const state = withContractor("mender");
    state.economy.coins = CONTRACT.menderUncurseCost;
    const offer = offerOf(state, "uncurse");
    touch(state, offer);
    expect(offer.used).toBe(false);
    expect(state.economy.coins).toBe(CONTRACT.menderUncurseCost);
  });

  it("修理屋: 呪い付きの祝福を 1 つ外す", () => {
    const state = withContractor("mender");
    const cursed = BOON_KEYS.find((k) => BOONS[k].cursed);
    if (!cursed) throw new Error("呪い付きの祝福が無い");
    grantBoon(state, cursed);
    state.economy.coins = CONTRACT.menderUncurseCost;
    touch(state, offerOf(state, "uncurse"));
    expect(state.boons.includes(cursed), "外れた").toBe(false);
  });

  it("占い: 次の階を読むと、次の階のイベントがその通りになる", () => {
    const state = withContractor("seer");
    state.economy.coins = CONTRACT.seerReadCost;
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
    state.economy.coins = CONTRACT.seerWardCost;
    touch(state, offerOf(state, "ward"));
    descend(state, "rooms");
    expect(state.runEvents.floor, "階の枠").toBeNull();
  });

  it("占い: 次のボス階は深度より深い最初のボス階", () => {
    const d = nextBossDepth(4);
    expect(d).toBeGreaterThan(4);
    expect(isBossDepth(d)).toBe(true);
  });

  it("賭場: 品書きは運の型 2 つと腕の型 2 つ（賭けの本体は bets.test.ts）", () => {
    const state = withContractor("bookie");
    const bets = state.contracts.contractor?.offers.filter((o) => o.kind === "bet") ?? [];
    const luck = bets.filter((o) => ["chohan", "longshot", "allIn", "doubleUp"].includes(o.key));
    expect(luck.length, "運の型").toBe(ECONOMY.bet.luckOffers);
    expect(bets.length - luck.length, "腕の型").toBe(ECONOMY.bet.skillOffers);
  });

  it("賭場: 生命を賭けると生命が減る", () => {
    const state = withContractor("bookie");
    const hp = state.player.hp;
    touch(state, offerOf(state, "betLife"));
    expect(state.player.hp, "生命").toBeCloseTo(hp - state.player.maxHp * CONTRACT.bookieLifeCost, 5);
  });

  it("生命で払う取引は、払った後に CONTRACT.lifeFloor を割るなら払えない（取引で死なない）", () => {
    for (const [key, kind, ratio] of [
      ["bookie", "betLife", CONTRACT.bookieLifeCost],
      ["ferryman", "ferryLife", CONTRACT.ferryLifeCost],
    ] as const) {
      const state = withContractor(key);
      const p = state.player;
      // 払うと残りが下限をわずかに割る
      p.hp = p.maxHp * ratio + CONTRACT.lifeFloor / 2;
      const hp = p.hp;
      const offer = offerOf(state, kind);
      touch(state, offer);
      expect(offer.used, `${kind} は払えない`).toBe(false);
      expect(p.hp, `${kind} の生命は減らない`).toBe(hp);
      // ちょうど下限が残るなら払える
      p.hp = p.maxHp * ratio + CONTRACT.lifeFloor;
      touch(state, offer);
      expect(offer.used, `${kind} は払える`).toBe(true);
      expect(p.hp, `${kind} の後も生命が残る`).toBeGreaterThanOrEqual(CONTRACT.lifeFloor - 1e-9);
    }
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
    state.economy.coins = CONTRACT.smithCost;
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
    state.economy.coins = CONTRACT.guideForkCost;
    const before = state.stairs.length;
    touch(state, offerOf(state, "fork"));
    const offer = offerOf(state, "fork");
    if (offer.used) {
      expect(state.stairs.length, "階段").toBe(before + 1);
      const kinds = state.stairs.map((s) => s.nextKind);
      expect(new Set(kinds).size, "行き先は重ならない").toBe(kinds.length);
    } else {
      expect(state.economy.coins, "足せなければ払わない").toBe(CONTRACT.guideForkCost);
    }
  });

  it("渡し守: 生命で時を買うと死神の猶予が延び、回数に上限がある", () => {
    const state = withContractor("ferryman");
    state.floorTime = 100;
    touch(state, offerOf(state, "ferryLife"));
    expect(state.floorTime, "経過時間が戻る").toBe(100 - CONTRACT.ferryTime);
    expect(state.contracts.ferried).toBe(1);
    state.contracts.ferried = CONTRACT.ferryMaxUses;
    state.economy.coins = CONTRACT.ferryCoinCost;
    const offer = offerOf(state, "ferryCoins");
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

  it("無傷の契約: 被弾せず次の階に着けば銭と祝福の 3 択", () => {
    const state = withContractor("notary");
    state.contracts.pacts = [{ key: "unscathed", signedAt: state.time, killsAt: 0, depth: state.depth, failed: false }];
    const before = state.economy.coins;
    onContractsFloorReached(state);
    expect(state.economy.coins, "銭").toBe(before + ECONOMY.income.pactUnscathed);
    updateContractors(state, DT);
    expect(state.boonChoice, "祝福の 3 択").not.toBeNull();
  });

  it("無傷の契約の 3 択は、階段の 3 択に上書きされず閉じた後に開く", () => {
    const state = withContractor("notary");
    state.contracts.pacts = [{ key: "unscathed", signedAt: state.time, killsAt: 0, depth: state.depth, failed: false }];
    onContractsFloorReached(state);
    // 階段で降りたときの 3 択が同じステップで開いている
    state.boonChoice = { options: [BOON_KEYS[0]!], hover: -1, curseHover: false, timer: 0, curseTaken: false, curse: null };
    updateContractors(state, DT);
    expect(state.contracts.boonsOwed, "開いている間は待つ").toBe(1);
    state.boonChoice = null;
    updateContractors(state, DT);
    expect(state.boonChoice, "閉じた後に契約の 3 択").not.toBeNull();
    expect(state.contracts.boonsOwed).toBe(0);
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

  it("疾走の契約: 果たすと次の階の到着時に錬磨の提示を積む", () => {
    const state = withContractor("notary");
    state.contracts.pacts = [{ key: "swift", signedAt: state.time, killsAt: 0, depth: state.depth, failed: false }];
    const queued = state.boonRun.temperQueued;
    onContractsFloorReached(state);
    expect(state.boonRun.temperQueued, "錬磨の予約").toBe(queued + CONTRACT.pactSwiftTempers);
  });

  it("沈黙の契約: スキルを使うと破れて銭を失う", () => {
    const state = withContractor("notary");
    state.economy.coins = ECONOMY.income.pactSilentPenalty + 5;
    state.contracts.pacts = [{ key: "silent", signedAt: state.time, killsAt: 0, depth: state.depth, failed: false }];
    state.time += 1;
    state.recent.onSkillCast = { lastTime: state.time, count: 1 };
    updateContractors(state, DT);
    expect(state.economy.coins, "違約の銭を失う").toBe(5);
  });

  it("沈黙の契約: 持ち金が違約の銭に足りなければ 0 まで（負にならない）", () => {
    const state = withContractor("notary");
    state.economy.coins = 1;
    state.contracts.pacts = [{ key: "silent", signedAt: state.time, killsAt: 0, depth: state.depth, failed: false }];
    state.time += 1;
    state.recent.onSkillCast = { lastTime: state.time, count: 1 };
    updateContractors(state, DT);
    expect(state.economy.coins, "持ち金").toBe(0);
  });
});

describe("契約者: 属性の上乗せと変身", () => {
  it("変身で武器種だけ差し替えても、鍛冶の属性が二重に乗らない", () => {
    const state = withContractor("smith");
    const before = state.stats.infuse.fire;
    state.contracts.smith = { element: "fire", share: CONTRACT.smithShare };
    ensureContractStats(state);
    const base = state.stats.moveset;
    const moveset = base === "greatsword" ? "spear" : "greatsword";
    state.skills.form = { skillKey: "titanForm", moveset, base, timer: 10, total: 10, recover: 0 };
    for (let i = 0; i < 3; i++) {
      updateForm(state, DT);
      ensureContractStats(state);
    }
    expect(state.stats.moveset, "変身の武器種").toBe(moveset);
    expect(state.stats.infuse.fire, "変身中も 1 回分").toBeCloseTo(before + CONTRACT.smithShare, 5);
    endForm(state);
    ensureContractStats(state);
    expect(state.stats.moveset, "戻る").toBe(base);
    expect(state.stats.infuse.fire, "解けた後も 1 回分").toBeCloseTo(before + CONTRACT.smithShare, 5);
  });
});
