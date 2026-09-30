import { describe, expect, it } from "vitest";
import type { GameState } from "../core/state";
import { TRIGGER } from "../data/tuning";

/** 旧 色の共鳴（拮抗・鏡像）が入れていた量。欄の読み取り（traitHooks.ts）だけを確かめる */
const ALTERNATE_STEP = 0.08;
const ALTERNATE_CAP = 0.32;
const ICD_CUT = 0.25;
import { applyRoll } from "../loot/affixes";
import { DEFAULT_STATS, createLootRuntime, type TraitStats } from "../loot/types";
import type { OutgoingElement } from "./elementCombat";
import { buildContext } from "./damageMods";
import { applyModifiers } from "./modifiers";
import { applyStatus, hasStatus } from "./statusEffects";
import { placeTerrain, terrainAt } from "./terrain";
import { arena, engageStartRoom, placeEnemy } from "./testHelpers";
import {
  attackMode,
  onTraitHit,
  onTraitKill,
  onTraitStagger,
  tickTraitClocks,
  traitElementMul,
  traitIncomingMul,
  traitOutgoingMul,
  traitPoiseMul,
  traitTriggerIcdMul,
} from "./traitHooks";

/** 装備の第 2 弾が持ち込むルール変更（system/traitHooks.ts）の検査。数値は stats.traits に直接入れる */

const FAR = 200;
const NEAR = 20;
const DT = 1 / 60;
/** 開始部屋の中に収まる距離（壁の上には地形を置けない） */
const ROOM_SPOT = 32;
/** 地形を置く半径（足元の 1 タイルを確実に覆う） */
const PATCH = 12;

function withTraits(partial: Partial<TraitStats>, keystones: string[] = []): GameState {
  const state = arena(5, { traits: { ...DEFAULT_STATS.traits, ...partial }, keystones, resist: { ...DEFAULT_STATS.resist }, infuse: { ...DEFAULT_STATS.infuse } });
  for (const r of state.rooms) r.locked = false;
  return state;
}

/** 足元に地形を置く（置けたことを確かめる） */
function groundUnderPlayer(state: GameState, kind: "water" | "ice" | "grass" | "oil"): void {
  const p = state.player.body.pos;
  placeTerrain(state, p.x, p.y, kind, PATCH, 0);
  expect(terrainAt(state, p.x, p.y), "足元に地形が置けた").toBe(kind);
}

function affinityOut(affinity: OutgoingElement["affinity"], element: OutgoingElement["shares"][number]["element"] = "fire"): OutgoingElement {
  return { mul: 1, affinity, shares: [{ element, share: 1 }] };
}

describe("属性の性質（traitElementMul）", () => {
  it("弱点刺し: 弱点へ +、弱点でない相手へは等倍（罰は無い）。proc には掛けない", () => {
    const state = withTraits({ weakDamageMul: 0.4 });
    const e = placeEnemy(state, "slime", FAR);
    expect(traitElementMul(state, e, affinityOut("weak"), "melee")).toBeCloseTo(1.4);
    expect(traitElementMul(state, e, affinityOut("neutral"), "melee")).toBeCloseTo(1);
    expect(traitElementMul(state, e, affinityOut("weak"), "proc")).toBe(1);
  });

  it("弱点読み: 弱点の命中で気力が戻り、来歴に数える", () => {
    const state = withTraits({ weakHitMana: 3 });
    state.player.mana = 0;
    const e = placeEnemy(state, "slime", FAR);
    traitElementMul(state, e, affinityOut("weak"), "ranged");
    expect(state.player.mana).toBeGreaterThan(0);
  });

  it("逆撫で: 耐性に阻まれた命中で、その属性の状態異常を付ける", () => {
    const state = withTraits({ resistedInflict: 3 });
    const e = placeEnemy(state, "eye", FAR);
    traitElementMul(state, e, { mul: 0.5, affinity: "resist", shares: [{ element: "light", share: 1 }] }, "melee");
    expect(hasStatus(e.status, "vulnerable"), "光は脆弱").toBe(true);
  });

  it("通電: 濡れの敵へ。雷の割合でさらに伸びる", () => {
    const state = withTraits({ wetConductMul: 0.2 });
    const e = placeEnemy(state, "slime", FAR);
    expect(traitElementMul(state, e, affinityOut("neutral", "lightning"), "melee")).toBeCloseTo(1);
    applyStatus(state, { kind: "enemy", enemy: e }, { kind: "wet", stacks: 1, duration: 5, potency: 0 }, "env");
    expect(traitElementMul(state, e, affinityOut("neutral", "none"), "melee")).toBeCloseTo(1.2);
    expect(traitElementMul(state, e, affinityOut("neutral", "lightning"), "melee")).toBeCloseTo(1.4);
  });

});

describe("武器種・銃の弾・ジョブ（traitOutgoingMul / traitPoiseMul）", () => {
  it("溜めの芯: 段 1 つにつき近接 +、溜めずに振っても減らない（スキルには掛けない）", () => {
    const state = withTraits({ chargedMeleeMul: 0.2 });
    state.stats = { ...state.stats, moveset: "greatsword" };
    expect(traitOutgoingMul(state, null, "melee", false)).toBeCloseTo(1);
    state.player.attack.chargeLevel = 2;
    expect(traitOutgoingMul(state, null, "melee", false)).toBeCloseTo(1.4);
    expect(traitOutgoingMul(state, null, "melee", true), "スキルには掛けない").toBeCloseTo(1);
    state.stats = { ...state.stats, moveset: "sword" };
    state.player.attack.chargeLevel = 0;
    expect(traitOutgoingMul(state, null, "melee", false), "溜めを持たない武器は減らない").toBeCloseTo(1);
  });

  it("派生の冴え: 派生の振りだけ", () => {
    const state = withTraits({ branchDamageMul: 0.3 });
    expect(traitOutgoingMul(state, null, "melee", false)).toBeCloseTo(1);
    state.player.attack.branch = 0;
    expect(traitOutgoingMul(state, null, "melee", false)).toBeCloseTo(1.3);
  });

  it("ラッパ銃（ベース）: 散弾の射撃で近い敵へ +、遠い敵へは等倍", () => {
    const state = withTraits({ spreadCloseMul: 0.5 });
    state.stats = { ...state.stats, bullet: "shotgun" };
    const near = placeEnemy(state, "slime", NEAR);
    const far = placeEnemy(state, "slime", FAR);
    expect(traitOutgoingMul(state, near, "ranged", false)).toBeCloseTo(1.5);
    expect(traitOutgoingMul(state, far, "ranged", false)).toBeCloseTo(1);
    expect(traitOutgoingMul(state, near, "melee", false), "近接には掛けない").toBeCloseTo(1);
  });

  it("大連接棍（ベース）: 溜めの段 1 つにつき近接の怯み値 +", () => {
    const state = withTraits({ chargedPoiseMul: 0.2 });
    const e = placeEnemy(state, "slime", FAR);
    state.player.attack.chargeLevel = 2;
    expect(traitPoiseMul(state, e, "melee", false)).toBeCloseTo(1.4);
    expect(traitPoiseMul(state, e, "ranged", false), "射撃には掛けない").toBeCloseTo(1);
  });

});

describe("地形（足元・敵の足元）", () => {
  it("地の利（Modifier）: 地形の上に立つ間だけ与ダメージ +", () => {
    const state = withTraits({});
    applyRoll(state.stats, { key: "groundRooted", value: 30 });
    expect(applyModifiers(state, buildContext(null, "melee"), null).increased).toBeCloseTo(0);
    groundUnderPlayer(state, "grass");
    expect(applyModifiers(state, buildContext(null, "melee"), null).increased).toBeCloseTo(0.3);
  });

  it("蓑（ベース）: 地形の上で被ダメージ −", () => {
    const state = withTraits({ terrainGuard: 0.2 });
    expect(traitIncomingMul(state, undefined)).toBeCloseTo(1);
    groundUnderPlayer(state, "water");
    expect(traitIncomingMul(state, undefined)).toBeCloseTo(0.8);
  });

  it("地脈の炸裂: 地形の上の敵を倒すと周囲に地形の状態異常（内部クールダウンで連鎖しない）", () => {
    const state = withTraits({ terrainKillBlast: 5 });
    const victim = placeEnemy(state, "slime", ROOM_SPOT);
    const other = placeEnemy(state, "slime", ROOM_SPOT + 16);
    placeTerrain(state, victim.body.pos.x, victim.body.pos.y, "water", PATCH, 0);
    expect(terrainAt(state, victim.body.pos.x, victim.body.pos.y)).toBe("water");
    onTraitKill(state, victim);
    expect(hasStatus(other.status, "chill"), "水の上は冷気").toBe(true);
    expect(state.player.loot.terrainBlastIcd).toBeCloseTo(TRIGGER.trait.terrainBlastIcd);
  });

  it("残り火: 燃えている敵を倒すと足元に炎を置く", () => {
    const state = withTraits({ burningKillFire: 4 });
    const e = placeEnemy(state, "slime", ROOM_SPOT);
    applyStatus(state, { kind: "enemy", enemy: e }, { kind: "burn", stacks: 1, duration: 5, potency: 3 }, "player");
    onTraitKill(state, e);
    expect(terrainAt(state, e.body.pos.x, e.body.pos.y)).toBe("fire");
  });

  it("土の息: 地形の上に立つ間だけ回復する / 霜の轍: ダッシュ中に氷床を置く", () => {
    const state = withTraits({ terrainRegen: 60, dashIceTrail: 3 });
    state.player.hp = state.player.maxHp / 2;
    tickTraitClocks(state, DT);
    expect(state.player.hp).toBe(state.player.maxHp / 2);
    groundUnderPlayer(state, "grass");
    tickTraitClocks(state, DT);
    expect(state.player.hp).toBeGreaterThan(state.player.maxHp / 2);
    const dash = withTraits({ dashIceTrail: 3 });
    dash.player.dashTimer = 0.1;
    tickTraitClocks(dash, DT);
    const p = dash.player.body.pos;
    expect(terrainAt(dash, p.x, p.y)).toBe("ice");
  });
});

describe("交戦・被ダメージの属性・構え", () => {
  it("籠城: 交戦中は −、交戦外は等倍（罰は無い）", () => {
    const state = withTraits({ engagedGuard: 0.2 });
    expect(traitIncomingMul(state, undefined)).toBeCloseTo(1);
    engageStartRoom(state);
    expect(traitIncomingMul(state, undefined)).toBeCloseTo(0.8);
  });

  it("構え: 振っている間は被ダメージ −、それ以外は等倍", () => {
    const state = withTraits({ stanceGuard: 0.4 });
    expect(traitIncomingMul(state, undefined)).toBeCloseTo(1);
    state.player.attack.phase = "active";
    expect(traitIncomingMul(state, undefined)).toBeCloseTo(0.6);
  });
});

describe("持ち替え（近接 / 射撃 / スキル）", () => {
  it("攻撃手段の判定", () => {
    expect(attackMode("melee", false)).toBe("melee");
    expect(attackMode("ranged", true)).toBe("skill");
    expect(attackMode("proc", false)).toBeNull();
  });

  it("手替えの呼吸: 違う手段で当てるたびに気力", () => {
    const state = withTraits({ switchMana: 2 });
    const e = placeEnemy(state, "slime", FAR);
    state.player.mana = 0;
    onTraitHit(state, e, "melee");
    expect(state.player.mana, "最初の命中は持ち替えではない").toBe(0);
    onTraitHit(state, e, "melee");
    expect(state.player.mana).toBe(0);
    onTraitHit(state, e, "ranged");
    expect(state.player.mana).toBeGreaterThan(0);
    expect(state.player.loot.lastMode).toBe("ranged");
  });

  it("持ち替え（怯み値）: 違う手段なら + / 同じ手段なら −", () => {
    const state = withTraits({ alternatePoiseMul: 0.4, repeatPoisePenalty: 0.1 });
    const e = placeEnemy(state, "slime", FAR);
    expect(traitPoiseMul(state, e, "melee", false), "直前が無い").toBeCloseTo(1);
    onTraitHit(state, e, "melee");
    expect(traitPoiseMul(state, e, "melee", false)).toBeCloseTo(0.9);
    expect(traitPoiseMul(state, e, "ranged", false)).toBeCloseTo(1.4);
  });

  it("天秤: 近接と射撃を交互に当てると重なり、途切れると消える", () => {
    const state = withTraits({ alternateDamageStep: ALTERNATE_STEP, alternateDamageCap: ALTERNATE_CAP });
    const e = placeEnemy(state, "slime", FAR);
    onTraitHit(state, e, "melee");
    onTraitHit(state, e, "ranged");
    onTraitHit(state, e, "melee");
    expect(state.player.loot.alternateStacks).toBe(2);
    expect(traitOutgoingMul(state, null, "ranged", false)).toBeCloseTo(1 + ALTERNATE_STEP * 2);
    for (let i = 0; i < 10; i++) {
      onTraitHit(state, e, i % 2 === 0 ? "ranged" : "melee");
    }
    expect(traitOutgoingMul(state, null, "ranged", false), "上限").toBeCloseTo(1 + ALTERNATE_CAP);
    tickTraitClocks(state, TRIGGER.trait.alternateWindow + DT);
    expect(state.player.loot.alternateStacks).toBe(0);
  });

  it("作業領域は createLootRuntime の形で始まる", () => {
    expect(withTraits({}).player.loot).toEqual(createLootRuntime());
  });
});

describe("怯ませた・命中ごと・時間", () => {
  it("崩れの属性: 怯ませた敵に武器の属性の状態異常（無属性の武器は付かない）", () => {
    const state = withTraits({ elementBreak: 3 });
    const e = placeEnemy(state, "slime", FAR);
    onTraitStagger(state, e);
    expect(hasStatus(e.status, "burn") || hasStatus(e.status, "weaken"), "剣は無属性").toBe(false);
    state.stats = { ...state.stats, moveset: "scythe" };
    onTraitStagger(state, e);
    expect(hasStatus(e.status, "weaken"), "大鎌は闇 = 弱体").toBe(true);
  });

  it("連射の烙印", () => {
    const state = withTraits({ rapidBrandChance: 1 });
    const e = placeEnemy(state, "slime", FAR);
    state.stats = { ...state.stats, bullet: "smg" };
    onTraitHit(state, e, "ranged");
    expect(hasStatus(e.status, "brand")).toBe(true);
  });

  it("派生の冴え: 派生の命中で気力", () => {
    const state = withTraits({ branchHitMana: 2 });
    const e = placeEnemy(state, "slime", FAR);
    state.player.mana = 0;
    state.player.attack.branch = 1;
    onTraitHit(state, e, "melee");
    expect(state.player.mana).toBeGreaterThan(0);
  });

  it("鏡像: トリガーの内部クールダウンを縮める（上限つき）", () => {
    expect(traitTriggerIcdMul(withTraits({}))).toBe(1);
    expect(traitTriggerIcdMul(withTraits({ triggerIcdCut: ICD_CUT }))).toBeCloseTo(1 - ICD_CUT);
    expect(traitTriggerIcdMul(withTraits({ triggerIcdCut: 5 }))).toBeGreaterThan(0);
  });

  it("表裏: 生命が半分以上なら与ダメージ +、未満なら被ダメージ −", () => {
    const state = withTraits({ highHpDamageMul: 0.1, lowHpGuard: 0.15 });
    expect(traitOutgoingMul(state, null, "melee", false)).toBeCloseTo(1.1);
    state.player.hp = 1;
    expect(traitOutgoingMul(state, null, "melee", false)).toBeCloseTo(1);
    expect(traitIncomingMul(state, undefined)).toBeCloseTo(0.85);
  });
});
