import { describe, expect, it } from "vitest";
import { type EventKind, enemyTarget, pushEvent, pushPlayerEvent } from "../core/events";
import type { Enemy, GameState } from "../core/state";
import { RELIC } from "../data/tuning";
import { baseDef } from "../loot/bases";
import { DICE_TALLY, DRAGON_SCALE_TALLY, STRIDE_TALLY, applyNamedRelics, relicTallyKey, uniqueDef } from "../loot/named";
import { computeStats } from "../loot/stats";
import { type Item, createEmptyEquipment } from "../loot/types";
import { damageEnemy, damagePlayer } from "./combat";
import { applyModifiers } from "./modifiers";
import { noteHitMoments } from "./moments";
import {
  hasNamedRelic,
  onRelicFloorStart,
  relicBlocksSwing,
  relicIncomingMul,
  relicPayWithCoins,
  relicStride,
  relicTelegraphLeadSec,
  tickNamedRelics,
} from "./namedRelics";
import { isAllied, resolveRules } from "./rules";
import { applyStatus, findStatus, statusStacks } from "./statusEffects";
import { arena, placeEnemy } from "./testHelpers";

/** 名のある遺物を装備させ、固有（rules / modifiers / apply）を stats に畳む */
function equip(state: GameState, key: string): Item {
  const def = uniqueDef(key);
  if (def === undefined) throw new Error(`遺物 ${key} が無い`);
  const slot = baseDef(def.baseKey)?.slot;
  if (slot === undefined) throw new Error(`${key} のベースが無い`);
  const item: Item = {
    id: `relic-${key}`,
    seed: 1,
    baseKey: def.baseKey,
    slot,
    rarity: "unique",
    itemLevel: def.minLevel,
    name: def.name,
    implicit: null,
    affixes: [],
    foundDepth: def.minLevel,
    foundAt: 0,
    namedKey: key,
    margin: 0,
  };
  state.profile.equipment = { ...createEmptyEquipment(), ...state.profile.equipment, [slot]: item };
  state.stats = { ...state.stats, rules: [], modifiers: [], graceSlotBonus: {} };
  applyNamedRelics(state.stats, state.profile.equipment);
  return item;
}

function fire(state: GameState, kind: EventKind, target?: Enemy): void {
  if (target === undefined) pushPlayerEvent(state, kind, "test");
  else pushEvent(state, { kind, actor: "player", source: { kind: "player", key: "test" }, ...enemyTarget(target) });
  resolveRules(state, 0);
}

function moreMuls(state: GameState, tag: "melee" | "ranged", enemy: Enemy | null, owner: string): number[] {
  return applyModifiers(state, { tags: new Set([tag]) }, enemy)
    .more.filter((m) => m.source.startsWith(`mod:item:${owner}:`))
    .map((m) => m.mul);
}

const FAR = 400;

describe("双頭の蛇", () => {
  it("双撃のたびに倍が積もり、同じ側の命中で 0 に戻る", () => {
    const state = arena();
    equip(state, "twinSerpent");
    const e = placeEnemy(state, "slime", 20);
    fire(state, "onTwinStrike", e);
    fire(state, "onTwinStrike", e);
    const key = relicTallyKey("twinSerpent");
    expect(state.boonRun.tallies[key], "2 回").toBe(2);
    expect(moreMuls(state, "melee", e, "twinSerpent")[0]).toBeCloseTo(1 + 2 * RELIC.twinSerpent.step);
    noteHitMoments(state, e, { kind: "melee", lane: "primary" });
    state.time += 0.1;
    noteHitMoments(state, e, { kind: "melee", lane: "primary" });
    expect(state.boonRun.tallies[key], "同じ側を続けると 0").toBe(0);
  });

  it("同じ振りが複数の敵に当たった（同じ時刻）ぶんは途切れに数えない", () => {
    const state = arena();
    equip(state, "twinSerpent");
    const a = placeEnemy(state, "slime", 20);
    const b = placeEnemy(state, "slime", 24);
    const key = relicTallyKey("twinSerpent");
    state.time += 1;
    noteHitMoments(state, a, { kind: "melee", lane: "primary" });
    state.time += 0.1;
    noteHitMoments(state, a, { kind: "melee", lane: "secondary" });
    state.boonRun.tallies[key] = 3;
    noteHitMoments(state, b, { kind: "melee", lane: "secondary" });
    expect(state.boonRun.tallies[key], "同じ時刻の 2 体目").toBe(3);
  });
});

describe("逆さ砂時計", () => {
  it("受けた傷は遅れて来て、その間の撃破で古い 1 つが帳消し", () => {
    const state = arena();
    equip(state, "reverseHourglass");
    const hp = state.player.hp;
    const attacker = placeEnemy(state, "slime", FAR);
    damagePlayer(state, 10, attacker.body.pos, attacker);
    expect(state.player.hp, "今は減らない").toBe(hp);
    expect(state.player.deferredDamage?.length).toBe(1);
    expect(state.player.deferredDamage?.[0]?.due).toBeCloseTo(state.time + RELIC.reverseHourglass.delay);
    const victim = placeEnemy(state, "slime", 20);
    damageEnemy(state, victim, victim.hp + 100, { x: 1, y: 0 }, 0);
    expect(state.player.deferredDamage?.length, "撃破で帳消し").toBe(0);
  });
});

describe("群れ呼びの笛", () => {
  it("処刑で、近くの怯んだ敵だけが従う", () => {
    const state = arena();
    equip(state, "herdFlute");
    const executed = placeEnemy(state, "slime", 30);
    const staggered = placeEnemy(state, "slime", 40);
    const calm = placeEnemy(state, "slime", 50);
    applyStatus(state, { kind: "enemy", enemy: staggered }, { kind: "stagger", stacks: 1, duration: 2, potency: 0 }, "player");
    executed.hp = 0;
    fire(state, "onExecute", executed);
    expect(isAllied(state, staggered), "怯んだ敵は従う").toBe(true);
    expect(isAllied(state, calm), "怯んでいない敵は従わない").toBe(false);
  });
});

describe("空の鞘", () => {
  it("左右の振りは出ず、ダッシュで周りの敵に武器の威力が乗る", () => {
    const state = arena();
    equip(state, "emptyScabbard");
    expect(relicBlocksSwing(state, false), "振りは出ない").toBe(true);
    expect(relicBlocksSwing(state, true), "ダッシュ攻撃は出る").toBe(false);
    const e = placeEnemy(state, "slime", RELIC.emptyScabbard.radius / 2);
    const hp = e.hp;
    fire(state, "onDash");
    expect(e.hp).toBeLessThan(hp);
  });
});

describe("重ねの首飾り", () => {
  it("自分が付ける毒は 1 回で 3 重ね。敵の付与・冷気は変えない", () => {
    const state = arena();
    equip(state, "layeredNecklace");
    const e = placeEnemy(state, "slime", 20);
    applyStatus(state, { kind: "enemy", enemy: e }, { kind: "poison", stacks: 1, duration: 3, potency: 1 }, "player");
    expect(statusStacks(e.status, "poison")).toBe(RELIC.layeredNecklace.stacks);
    applyStatus(state, { kind: "enemy", enemy: e }, { kind: "chill", stacks: 1, duration: 3, potency: 0.1 }, "player");
    expect(statusStacks(e.status, "chill"), "冷気は重ねを増やさない").toBe(1);
  });

  it("命中で付ける状態異常の確率が下がる（装備の集計）", () => {
    const eq = createEmptyEquipment();
    const state = arena();
    const item = equip(state, "layeredNecklace");
    const affixes = [{ key: "procPoison", value: 20, value2: 3 }];
    const plain = computeStats({ ...eq, amulet: { ...item, namedKey: undefined, affixes } });
    const named = computeStats({ ...eq, amulet: { ...item, affixes } });
    const chance = (s: typeof plain): number => s.statusProcs.reduce((sum, p) => sum + p.chance, 0);
    expect(chance(plain)).toBeGreaterThan(0);
    expect(chance(named)).toBeCloseTo(chance(plain) * RELIC.layeredNecklace.chanceMul);
  });
});

describe("星読みの眼", () => {
  it("予備動作中の敵にだけ倍が乗り、予告の線に目盛りを描く", () => {
    const state = arena();
    expect(relicTelegraphLeadSec(state), "着けていなければ 0").toBe(0);
    equip(state, "starReader");
    const e = placeEnemy(state, "slime", 20);
    expect(moreMuls(state, "melee", e, "starReader"), "予備動作でなければ無し").toEqual([]);
    e.phase = "windup";
    expect(moreMuls(state, "melee", e, "starReader")).toEqual([RELIC.starReader.more]);
    expect(relicTelegraphLeadSec(state)).toBe(RELIC.starReader.leadSec);
  });
});

describe("鐘の舌", () => {
  it("終撃の every 回目で周囲を一掃し、数え直す", () => {
    const state = arena();
    equip(state, "bellTongue");
    const target = placeEnemy(state, "slime", 20);
    const around = placeEnemy(state, "slime", 40);
    const hp = around.hp;
    for (let i = 1; i < RELIC.bellTongue.every; i++) fire(state, "onFinisher", target);
    expect(around.hp, "every − 1 回ではまだ").toBe(hp);
    expect(state.boonRun.tallies[relicTallyKey("bellTongue")]).toBe(RELIC.bellTongue.every - 1);
    fire(state, "onFinisher", target);
    expect(around.hp, "every 回目で一掃").toBeLessThan(hp);
    expect(state.boonRun.tallies[relicTallyKey("bellTongue")], "数え直す").toBe(0);
  });
});

describe("起死の鱗", () => {
  it("生命が 3 割を切った被弾で周りを凍らせて無敵になり、1 階に 1 回", () => {
    const state = arena();
    equip(state, "dragonScale");
    const attacker = placeEnemy(state, "slime", 20);
    const near = placeEnemy(state, "slime", 60);
    state.player.hp = Math.floor(state.player.maxHp * 0.25);
    damagePlayer(state, 1, attacker.body.pos, attacker);
    resolveRules(state, 0);
    expect(findStatus(near.status, "freeze"), "周りが凍る").toBeDefined();
    expect(findStatus(attacker.status, "freeze"), "殴ってきた敵も凍る").toBeDefined();
    expect(state.boonRun.tallies[DRAGON_SCALE_TALLY]).toBe(1);
    onRelicFloorStart(state);
    expect(state.boonRun.tallies[DRAGON_SCALE_TALLY], "階の到着で戻る").toBe(0);
  });

  it("生命に余裕があれば起きない", () => {
    const state = arena();
    equip(state, "dragonScale");
    const attacker = placeEnemy(state, "slime", 20);
    damagePlayer(state, 1, attacker.body.pos, attacker);
    resolveRules(state, 0);
    expect(findStatus(attacker.status, "freeze")).toBeUndefined();
  });
});

describe("打ち出の小槌", () => {
  it("終撃が当たるたび銭が出る", () => {
    const state = arena();
    equip(state, "mallet");
    const e = placeEnemy(state, "slime", 20);
    const before = state.economy.coins;
    fire(state, "onFinisher", e);
    expect(state.economy.coins).toBeGreaterThan(before);
  });
});

describe("六文銭", () => {
  it("倒れるとき持ち金を全部払って 1 回だけ蘇る", () => {
    const state = arena();
    equip(state, "sixCoins");
    state.economy.coins = 30;
    const attacker = placeEnemy(state, "slime", FAR);
    state.player.hp = 1;
    damagePlayer(state, 50, attacker.body.pos, attacker);
    expect(state.status, "蘇る").toBe("playing");
    expect(state.economy.coins, "持ち金は全部払う").toBe(0);
    expect(state.player.hp).toBe(Math.round(state.player.maxHp * RELIC.sixCoins.hpRatio));
    state.economy.coins = 30;
    state.player.hp = 1;
    state.player.invulnTimer = 0;
    damagePlayer(state, 50, attacker.body.pos, attacker);
    expect(state.status, "2 回目は倒れる").toBe("dead");
  });

  it("持ち金が無ければ蘇らない", () => {
    const state = arena();
    equip(state, "sixCoins");
    state.economy.coins = 0;
    state.player.hp = 1;
    const attacker = placeEnemy(state, "slime", FAR);
    damagePlayer(state, 50, attacker.body.pos, attacker);
    expect(state.status).toBe("dead");
  });
});

describe("欲の皮・身代わり地蔵", () => {
  it("欲の皮: 持ち金 10 につき被ダメージ −1%、上限あり", () => {
    const state = arena();
    equip(state, "greedHide");
    state.economy.coins = 100;
    expect(relicIncomingMul(state)).toBeCloseTo(1 - 10 * RELIC.greedHide.perStep);
    state.economy.coins = 100000;
    expect(relicIncomingMul(state)).toBeCloseTo(1 - RELIC.greedHide.cap);
  });

  it("身代わり地蔵: 被弾の半分を銭で受け、払えない分は生命", () => {
    const state = arena();
    equip(state, "jizo");
    state.economy.coins = 100;
    const half = 10;
    expect(relicPayWithCoins(state, half * 2), "半分を銭で受ける").toBe(half);
    expect(state.economy.coins, "銭 1 で生命 hpPerCoin").toBe(100 - Math.ceil(half / RELIC.jizo.hpPerCoin));
    state.economy.coins = 1;
    expect(relicPayWithCoins(state, half * 2), "払えない分は生命").toBe(half * 2 - RELIC.jizo.hpPerCoin);
    expect(state.economy.coins).toBe(0);
    expect(relicPayWithCoins(state, half * 2), "銭が無ければ全部生命").toBe(half * 2);
  });

  it("身代わり地蔵: 被弾の流れで銭が減り、生命の減りが小さくなる", () => {
    const plain = arena();
    const saved = arena();
    equip(saved, "jizo");
    saved.economy.coins = 100;
    for (const s of [plain, saved]) {
      const attacker = placeEnemy(s, "slime", FAR);
      damagePlayer(s, 30, attacker.body.pos, attacker);
    }
    expect(saved.economy.coins).toBeLessThan(100);
    expect(saved.player.maxHp - saved.player.hp).toBeLessThan(plain.player.maxHp - plain.player.hp);
  });
});

describe("賽の目の指輪", () => {
  it("階の到着で目を振り（決定的）、出た目の種類だけ倍が乗る", () => {
    const a = arena(7);
    const b = arena(7);
    equip(a, "diceRing");
    equip(b, "diceRing");
    onRelicFloorStart(a);
    onRelicFloorStart(b);
    const face = a.boonRun.tallies[DICE_TALLY] ?? 0;
    expect(face).toBeGreaterThanOrEqual(1);
    expect(face).toBeLessThanOrEqual(RELIC.diceRing.faces);
    expect(b.boonRun.tallies[DICE_TALLY], "同じ seed なら同じ目").toBe(face);
    a.boonRun.tallies[DICE_TALLY] = 1;
    expect(moreMuls(a, "melee", null, "diceRing"), "1 は近接").toEqual([RELIC.diceRing.tagMul]);
    expect(moreMuls(a, "ranged", null, "diceRing"), "射撃には乗らない").toEqual([]);
  });

  it("装備していなければ乱数を引かない", () => {
    const state = arena(7);
    const before = state.rng.next();
    const again = arena(7);
    onRelicFloorStart(again);
    expect(again.rng.next()).toBe(before);
  });
});

describe("旅人の靴", () => {
  it("歩いた距離が溜まって倍になり（上限あり）、当てると使い切る", () => {
    const state = arena();
    equip(state, "wanderShoes");
    state.player.body.vel = { x: 100, y: 0 };
    relicStride(state, 1);
    expect(state.boonRun.tallies[STRIDE_TALLY]).toBe(100);
    relicStride(state, 100);
    expect(state.boonRun.tallies[STRIDE_TALLY], "上限").toBe(RELIC.wanderShoes.cap);
    const steps = Math.floor(RELIC.wanderShoes.cap / RELIC.wanderShoes.every);
    expect(moreMuls(state, "melee", null, "wanderShoes")[0]).toBeCloseTo(1 + steps * RELIC.wanderShoes.step);
    const e = placeEnemy(state, "slime", 20);
    fire(state, "onSwingHit", e);
    expect(state.boonRun.tallies[STRIDE_TALLY], "使い切る").toBe(0);
  });
});

describe("骸の冠", () => {
  it("踏んだ死骸が爆ぜて周りの敵を傷つけ、死骸は消える", () => {
    const state = arena();
    equip(state, "boneCrown");
    const e = placeEnemy(state, "slime", 20);
    const hp = e.hp;
    state.corpses.push({ id: 9999, defKey: "slime", pos: { ...state.player.body.pos }, roomIndex: 0, time: 10, depth: state.depth });
    const playerHp = state.player.hp;
    tickNamedRelics(state);
    expect(state.corpses.length).toBe(0);
    expect(e.hp).toBeLessThan(hp);
    expect(state.player.hp, "自分は傷つかない").toBe(playerHp);
  });
});

describe("装備の判定", () => {
  it("装備していない遺物の分岐は何もしない", () => {
    const state = arena();
    expect(hasNamedRelic(state, "twinSerpent")).toBe(false);
    expect(relicBlocksSwing(state, false)).toBe(false);
    expect(relicIncomingMul(state)).toBe(1);
  });
});
