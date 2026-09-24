import { describe, expect, it } from "vitest";
import {
  enemyTarget,
  pushEvent,
  pushKillEvents,
  pushPlayerEvent,
  pushShatterEvent,
  pushSwingEvent,
  pushSwingHitEvent,
} from "../core/events";
import type { Rule, RuleCondition } from "../core/rules";
import type { StatusKind } from "../core/status";
import { type Enemy, type GameState, type Projectile, type RoomState, allocId } from "../core/state";
import { ACTION, BOON, FEEL, PLAYER } from "../data/tuning";
import { DEFAULT_STATS } from "../loot/types";
import { TILE_SIZE } from "../map/grid";
import { stoneFromSeed } from "../skills/generator";
import {
  BOONS,
  BOON_KEYS,
  type BoonKey,
  boonAttackManaMul,
  boonManaCostMul,
  boonMoveMul,
  boonNormalAttackBonus,
  comboAfterHurt,
  createBoonRunState,
  foldBoonStats,
  onBoonBurstKills,
  onBoonComboHit,
  onBoonCrit,
  onBoonDash,
  onBoonDashEnd,
  onBoonJust,
  onBoonKill,
  onBoonMeleeHit,
  onBoonRoomClear,
  onBoonRoomLock,
  onBoonShatter,
  onBoonShoot,
  onBoonSkillCast,
  onBoonSkillHit,
  onBoonSwing,
  updateBoons,
} from "./boons";
import {
  boonBlocksShoot,
  boonChainExtension,
  boonCounterable,
  boonForcesCrit,
  boonPoise,
  boonReaperDelay,
  boonReaperHalted,
  boonReaperJust,
  boonSkipsGuarded,
  boonWindupMul,
  equippedSlotCount,
  onBoonProjectileHit,
  onBoonProjectileWall,
  onBoonReaperDodged,
  onBoonShootInput,
  onBoonStagger,
  onBoonStaggerEnd,
  slashBase,
  trailElement,
  updateBoonRules,
} from "./boonRules";
import { damageEnemy, registerComboHit } from "./combat";
import { reaperAppearAfter } from "./reaper";
import { ROAMING_ROOM } from "./spawner";
import { resolveRules } from "./rules";
import { applyBurn, applyStatus, findStatus, hasStatus, removeStatus, statusStacks } from "./statusEffects";
import { arena, engageStartRoom, placeEnemy } from "./testHelpers";

const BIG_HP = 100000;
const LAST = PLAYER.melee.length - 1;
const DT = 1 / 60;

/** 祝福を持たせる（applyStats を通さない。arena の stats をそのまま使う） */
function give(state: GameState, ...keys: BoonKey[]): void {
  for (const k of keys) if (!state.boons.includes(k)) state.boons.push(k);
}

/** 攻撃しない・倒れない敵 */
function dummy(state: GameState, dx = 20, dy = 0, key = "golem"): Enemy {
  const e = placeEnemy(state, key, dx, dy);
  e.hp = BIG_HP;
  e.maxHp = BIG_HP;
  e.phase = "idle";
  return e;
}

function put(state: GameState, e: Enemy, kind: Parameters<typeof applyStatus>[2]["kind"], duration = 3, stacks = 1, potency = 1): void {
  applyStatus(state, { kind: "enemy", enemy: e }, { kind, stacks, duration, potency }, "player");
}

function bullet(state: GameState, over: Partial<Projectile> = {}): Projectile {
  return {
    id: allocId(state),
    owner: "player",
    pos: { ...state.player.body.pos },
    vel: { x: 200, y: 0 },
    radius: 2,
    damage: 10,
    life: 1,
    color: "#ffffff",
    kind: "ranged",
    hitIds: new Set(),
    pierceLeft: 0,
    ...over,
  };
}

/** 近接の振りの状態を作る（onBoonMeleeHit / 撃破判定が読む） */
function swing(state: GameState, combo: number, hit?: Enemy): void {
  const a = state.player.attack;
  a.phase = "active";
  a.combo = combo;
  a.hitIds.clear();
  if (hit) a.hitIds.add(hit.id);
  state.player.dashStrike = false;
}

// -----------------------------------------------------------------------------
// 起点の再現: 本体（combat.ts / player.ts / poise.ts / floor.ts）と同じく、残ったフックを呼んでイベントを積み、
// ステップ末の照合（resolveRules。BoonDef.rules）まで通す。createGame の床組みで積まれたイベントは先に捨てる
// -----------------------------------------------------------------------------

function dropEvents(state: GameState): void {
  state.events = [];
  state.pendingEvents = [];
}

/** 撃破（killEnemy と同じ: 撃破のイベント + onBoonKill） */
function killed(state: GameState, e: Enemy): void {
  dropEvents(state);
  pushKillEvents(state, e);
  onBoonKill(state, e);
  resolveRules(state, 0);
}

/** 回避の見切り（justDodge と同じ: onBoonJust + 見切りのイベント。回避した攻撃の主は sourceId） */
function justDodged(state: GameState, attacker?: Enemy): void {
  dropEvents(state);
  onBoonJust(state);
  pushPlayerEvent(state, "onJustDodge", "just", { sourceId: attacker?.id });
  resolveRules(state, 0);
}

/** 怯み（applyStagger と同じ: onBoonStagger + 怯みのイベント） */
function staggered(state: GameState, e: Enemy): void {
  dropEvents(state);
  onBoonStagger(state, e);
  pushEvent(state, { kind: "onStagger", actor: "player", source: { kind: "player", key: "stagger" }, ...enemyTarget(e) });
  resolveRules(state, 0);
}

/** 被弾して生き残った（damagePlayer と同じ: 攻撃の主は targetId / sourceId） */
function hurtBy(state: GameState, attacker: Enemy): void {
  dropEvents(state);
  const pos = { ...state.player.body.pos };
  pushEvent(state, { kind: "onHurt", actor: "enemy", pos, targetId: attacker.id, sourceId: attacker.id, source: { kind: "enemy", key: attacker.defKey } });
  resolveRules(state, 0);
}

/** 振り始め（beginSwing と同じ: onBoonSwing + 振りのイベント） */
function swung(state: GameState, combo: number, dashStrike: boolean, damage: number): void {
  dropEvents(state);
  onBoonSwing(state, combo, dashStrike);
  pushSwingEvent(state, combo, dashStrike, damage);
  resolveRules(state, 0);
}

/** 通常の振りの命中（meleeHitEnemy と同じ: onBoonMeleeHit + カウンターと振りの命中のイベント） */
function meleeHit(state: GameState, e: Enemy, counter = false): void {
  dropEvents(state);
  if (counter) pushEvent(state, { kind: "onCounter", actor: "player", source: { kind: "player", key: "counter" }, ...enemyTarget(e) });
  onBoonMeleeHit(state, e, counter);
  pushSwingHitEvent(state, e, state.player.attack.combo, state.player.dashStrike);
  resolveRules(state, 0);
}

/** バースト（fireBurst と同じ: onBoonBurstKills + バーストのイベント。量 = 倒した数） */
function burst(state: GameState, kills: number): void {
  dropEvents(state);
  onBoonBurstKills(state, kills);
  pushPlayerEvent(state, "onBurst", "burst", { amount: kills });
  resolveRules(state, 0);
}

/** ダッシュ終了（onBoonDashEnd + ダッシュ終了のイベント） */
function dashEnded(state: GameState): void {
  dropEvents(state);
  onBoonDashEnd(state);
  pushPlayerEvent(state, "onDashEnd", "dash");
  resolveRules(state, 0);
}

/** 部屋の制圧（clearRoom と同じ: 制圧のイベント + onBoonRoomClear。部屋の種類は tag） */
function roomCleared(state: GameState, room?: RoomState): void {
  dropEvents(state);
  pushPlayerEvent(state, "onRoomClear", "room", { tag: room?.kind, source: { kind: "room", key: room?.kind ?? "" } });
  onBoonRoomClear(state, room);
  resolveRules(state, 0);
}

/** 部屋の封鎖（lockRoom と同じ: onBoonRoomLock + 封鎖のイベント） */
function roomLocked(state: GameState, index: number): void {
  dropEvents(state);
  onBoonRoomLock(state, index);
  const room = state.rooms[index];
  pushPlayerEvent(state, "onRoomLock", "room", { tag: room?.kind, room: index, source: { kind: "room", key: room?.kind ?? "" } });
  resolveRules(state, 0);
}

/** 会心（damageEnemy と同じ: onBoonCrit + 会心のイベント。量 = 与えたダメージ） */
function critHit(state: GameState, e: Enemy, amount: number): void {
  dropEvents(state);
  onBoonCrit(state, e, amount);
  pushEvent(state, { kind: "onCrit", actor: "player", source: { kind: "player", key: "melee" }, amount, ...enemyTarget(e) });
  resolveRules(state, 0);
}

/** damageEnemy をステップ末の照合まで通す（砕き・コンボ加算のイベントを rules が食う） */
function hitThrough(state: GameState, e: Enemy, amount: number): void {
  dropEvents(state);
  damageEnemy(state, e, amount, { x: 1, y: 0 }, 0);
  resolveRules(state, 0);
}

describe("祝福の定義（拡張）", () => {
  it("祝福は 84 種以上。アイコンは 1 文字で重複しない、名前も重複しない", () => {
    expect(BOON_KEYS.length).toBeGreaterThanOrEqual(84);
    const icons = BOON_KEYS.map((k) => BOONS[k].icon);
    expect(icons.every((i) => [...i].length === 1), "アイコンは 1 文字").toBe(true);
    expect(new Set(icons).size, "アイコンの重複なし").toBe(icons.length);
    const names = BOON_KEYS.map((k) => BOONS[k].name);
    expect(new Set(names).size, "名前の重複なし").toBe(names.length);
  });

  it("系譜の前段は同じ系譜、結びの 2 つは実在する別の祝福", () => {
    for (const k of BOON_KEYS) {
      const d = BOONS[k];
      if (d.after) expect(BOONS[d.after].lineage, `${k} の前段は同じ系譜`).toBe(d.lineage);
      if (d.duo) {
        expect(d.duo[0], `${k} の結びは別々の 2 つ`).not.toBe(d.duo[1]);
        expect(d.duo.includes(k), `${k} は自分を要求しない`).toBe(false);
        expect(d.cursed, "結びは呪いなし").toBe(false);
      }
    }
  });

  it("系譜は 4 つ × 4 段、結びは 5 種以上", () => {
    const lineages = new Map<string, number>();
    for (const k of BOON_KEYS) {
      const l = BOONS[k].lineage;
      if (l) lineages.set(l, (lineages.get(l) ?? 0) + 1);
    }
    expect(lineages.size).toBeGreaterThanOrEqual(3);
    for (const n of lineages.values()) expect(n).toBeGreaterThanOrEqual(3);
    expect(BOON_KEYS.filter((k) => BOONS[k].duo).length).toBeGreaterThanOrEqual(5);
  });
});

describe("系譜: 灰燼", () => {
  it("火種: 近接 3 段目は燃焼を付け、1 段目は付けない", () => {
    const state = arena();
    give(state, "emberSeed");
    const a = dummy(state);
    const b = dummy(state, 20, 30);
    swing(state, 0);
    meleeHit(state, a);
    expect(hasStatus(a.status, "burn"), "1 段目は付けない").toBe(false);
    swing(state, LAST);
    meleeHit(state, b);
    expect(hasStatus(b.status, "burn"), "3 段目は燃焼").toBe(true);
  });

  it("延焼: 燃焼中の敵に当てると周囲へ燃焼が移る。ICD の間は移らない", () => {
    const state = arena();
    give(state, "wildfire");
    const a = dummy(state);
    const b = dummy(state, 40);
    applyBurn(state, a, 5, 3);
    swing(state, 0);
    meleeHit(state, a);
    expect(hasStatus(b.status, "burn")).toBe(true);
    removeStatus(state, { kind: "enemy", enemy: b }, "burn");
    meleeHit(state, a);
    expect(hasStatus(b.status, "burn"), "ICD 中は移らない").toBe(false);
    updateBoonRules(state, BOON.wildfireIcd + 0.01);
    meleeHit(state, a);
    expect(hasStatus(b.status, "burn"), "ICD 明けで再び移る").toBe(true);
  });

  it("灰積もり: 燃える敵を倒すと灰が残り、踏むと次の近接 1 回が燃焼を付ける", () => {
    const state = arena();
    give(state, "ashBed");
    const dead = dummy(state, 30);
    applyBurn(state, dead, 5, 3);
    killed(state, dead);
    expect(state.boonRun.rules.ashes).toHaveLength(1);
    state.player.body.pos = { ...dead.body.pos };
    updateBoonRules(state, DT);
    expect(state.boonRun.rules.ashCharges, "灰を拾った").toBe(1);
    const target = dummy(state, 20, 20);
    swing(state, 0);
    meleeHit(state, target);
    expect(hasStatus(target.status, "burn")).toBe(true);
    expect(state.boonRun.rules.ashCharges, "1 回で消費").toBe(0);
  });

  it("焦土: バーストで燃焼を起爆し、残りの燃焼ダメージ × 1.5 を即時に与える", () => {
    const state = arena();
    give(state, "scorchedEarth");
    const e = dummy(state);
    applyBurn(state, e, 10, 2);
    const burn = findStatus(e.status, "burn");
    const expected = Math.round((burn?.potency ?? 0) * (burn?.time ?? 0) * BOON.scorchMul);
    burst(state, 0);
    expect(hasStatus(e.status, "burn"), "燃焼は消える").toBe(false);
    expect(BIG_HP - e.hp).toBe(expected);
  });
});

describe("系譜: 霜枷", () => {
  it("霜息: 射撃の命中で冷気が付く", () => {
    const state = arena();
    give(state, "frostBreath");
    const e = dummy(state);
    onBoonProjectileHit(state, bullet(state), e);
    expect(statusStacks(e.status, "chill")).toBe(1);
  });

  it("凍て足: 冷気 3 以上の敵は予備動作が 40% 長い", () => {
    const state = arena();
    give(state, "frostFeet");
    const e = dummy(state);
    put(state, e, "chill", 3, 2, 0);
    expect(boonWindupMul(state, e), "冷気 2 では伸びない").toBe(1);
    put(state, e, "chill", 3, 1, 0);
    expect(boonWindupMul(state, e)).toBeCloseTo(BOON.frostFeetMul);
  });

  it("砕氷の鐘: 砕きが近くの凍結中の敵へ連鎖する", () => {
    const state = arena();
    give(state, "shatterBell");
    const a = dummy(state);
    const b = dummy(state, 40);
    put(state, a, "freeze", 1);
    put(state, b, "freeze", 1);
    hitThrough(state, a, 5);
    expect(hasStatus(b.status, "freeze"), "連鎖して砕けた").toBe(false);
    expect(b.hp).toBeLessThan(BIG_HP);
  });

  it("永冬: ジャスト回避で周囲の敵が凍結する", () => {
    const state = arena();
    give(state, "eternalWinter");
    const e = dummy(state, 30);
    justDodged(state);
    expect(hasStatus(e.status, "freeze")).toBe(true);
  });
});

describe("系譜: 雷鳴", () => {
  it("静電気: ダッシュですり抜けた敵に感電。1 回のダッシュで 1 度だけ", () => {
    const state = arena();
    give(state, "staticDash");
    const e = dummy(state, 0);
    state.player.dashTimer = 0.2;
    onBoonDash(state);
    updateBoonRules(state, DT);
    expect(hasStatus(e.status, "shock")).toBe(true);
    removeStatus(state, { kind: "enemy", enemy: e }, "shock");
    updateBoonRules(state, DT);
    expect(hasStatus(e.status, "shock"), "同じダッシュでは 1 度だけ").toBe(false);
  });

  it("帯電の刃: 感電中の敵を殴ると連鎖雷が走る", () => {
    const state = arena();
    give(state, "chargedBlade");
    const a = dummy(state);
    const b = dummy(state, 50);
    put(state, a, "shock", 3, 1, 10);
    swing(state, 0);
    meleeHit(state, a);
    expect(b.hp).toBeLessThan(BIG_HP);
  });

  it("落雷予告: 麻痺した敵の足元に予告が出て、1 秒後に雷が落ちる", () => {
    const state = arena();
    give(state, "thunderMark");
    const e = dummy(state);
    put(state, e, "paralyze", 0.3);
    updateBoonRules(state, DT);
    expect(state.boonRun.rules.marks).toHaveLength(1);
    expect(e.hp, "予告中は無害").toBe(BIG_HP);
    updateBoonRules(state, BOON.markDelay);
    expect(e.hp).toBeLessThan(BIG_HP);
    expect(state.boonRun.rules.marks).toHaveLength(0);
  });

  it("雷神の鼓: コンボ 10 で感電中の敵から雷が連鎖する（連鎖のコンボでは再び鳴らない）", () => {
    const state = arena();
    give(state, "thunderDrum");
    const a = dummy(state);
    const b = dummy(state, 60);
    put(state, a, "shock", 3, 1, 10);
    state.combo.count = BOON.drumEvery - 1;
    registerComboHit(state);
    expect(b.hp).toBeLessThan(BIG_HP);
    expect(state.boonRun.rules.drumActive).toBe(false);
  });
});

describe("系譜: 月蝕", () => {
  it("月読: マナのスキルが当たると沈黙。クールダウンのスキルでは付かない", () => {
    const state = arena();
    give(state, "moonRead");
    const a = dummy(state);
    const b = dummy(state, 40);
    onBoonSkillCast(state, 0, "cooldown", 0);
    onBoonSkillHit(state, a);
    expect(hasStatus(a.status, "silence")).toBe(false);
    onBoonSkillCast(state, 0, "mana", 10);
    onBoonSkillHit(state, b);
    expect(hasStatus(b.status, "silence")).toBe(true);
  });

  it("満ち潮: マナ満タンの間だけ通常攻撃で必殺ゲージが余分に溜まる", () => {
    const state = arena();
    give(state, "highTide");
    const e = dummy(state);
    state.player.energy = 0;
    state.player.mana = 0;
    swing(state, 0);
    meleeHit(state, e);
    expect(state.player.energy).toBe(0);
    state.player.mana = state.stats.maxMana;
    meleeHit(state, e);
    expect(state.player.energy).toBeGreaterThan(0);
  });

  it("新月: マナが 0 になってから 2 秒以内の 1 回は払ったマナが戻る", () => {
    const state = arena();
    give(state, "newMoon");
    state.boonRun.rules.prevMana = 10;
    state.player.mana = 0;
    updateBoonRules(state, DT);
    expect(state.boonRun.rules.newMoonTimer).toBeGreaterThan(0);
    state.player.mana = 5;
    onBoonSkillCast(state, 0, "mana", 20);
    expect(state.player.mana).toBe(25);
    onBoonSkillCast(state, 0, "mana", 20);
    expect(state.player.mana, "2 回目は戻らない").toBe(25);
  });

  it("月蝕: 装着中のスキルを重複なく全て撃つと、2 秒間払ったマナが戻る", () => {
    const state = arena();
    give(state, "eclipse");
    const stones = ["whirl", "frag"].map((k, i) => ({
      ...stoneFromSeed(i + 1, { foundDepth: 1, now: 0, skillKey: k as "whirl" | "frag" }),
      id: `boon-eclipse-${i}`,
    }));
    state.skills.profile = { ...state.skills.profile, stones, loadout: [stones[0]!.id, stones[1]!.id, null, null] };
    expect(equippedSlotCount(state)).toBe(2);
    onBoonSkillCast(state, 0, "mana", 10);
    onBoonSkillCast(state, 0, "mana", 10);
    expect(state.boonRun.rules.eclipseTimer, "同じスロットの連打では開かない").toBe(0);
    onBoonSkillCast(state, 1, "mana", 10);
    expect(state.boonRun.rules.eclipseTimer).toBeGreaterThan(0);
    state.player.mana = 0;
    onBoonSkillCast(state, 0, "mana", 10);
    onBoonSkillCast(state, 1, "mana", 10);
    expect(state.player.mana, "窓の間は何度でも戻る").toBe(20);
  });

  it("月蝕: 窓の中の発動は次の窓の条件に数えない（交互撃ちで無料発動が続かない）", () => {
    const state = arena();
    give(state, "eclipse");
    const stones = ["whirl", "frag"].map((k, i) => ({
      ...stoneFromSeed(i + 1, { foundDepth: 1, now: 0, skillKey: k as "whirl" | "frag" }),
      id: `boon-eclipse-loop-${i}`,
    }));
    state.skills.profile = { ...state.skills.profile, stones, loadout: [stones[0]!.id, stones[1]!.id, null, null] };
    onBoonSkillCast(state, 0, "mana", 10);
    onBoonSkillCast(state, 1, "mana", 10);
    expect(state.boonRun.rules.eclipseTimer).toBe(BOON.eclipseWindow);
    // 窓の中で交互に撃つ
    onBoonSkillCast(state, 0, "mana", 10);
    onBoonSkillCast(state, 1, "mana", 10);
    updateBoonRules(state, BOON.eclipseWindow + 0.01);
    expect(state.boonRun.rules.eclipseTimer, "窓は開き直さず閉じる").toBe(0);
    state.player.mana = 0;
    onBoonSkillCast(state, 0, "mana", 10);
    expect(state.player.mana, "窓が閉じた後の発動は戻らない").toBe(0);
  });
});

describe("単体の祝福（ジャスト回避・カウンター）", () => {
  it("奪弾: ジャスト回避で周囲の敵弾が自分の弾になる", () => {
    const state = arena();
    give(state, "bulletSteal");
    const pr = bullet(state, { owner: "enemy", kind: "proc", pos: { x: state.player.body.pos.x + 20, y: state.player.body.pos.y } });
    state.projectiles.push(pr);
    justDodged(state);
    expect(pr.owner).toBe("player");
    expect(pr.kind).toBe("ranged");
  });

  it("睨み: ジャスト回避した攻撃の主が弱体になる", () => {
    const state = arena();
    give(state, "glare");
    const e = dummy(state);
    justDodged(state, e);
    expect(hasStatus(e.status, "weaken")).toBe(true);
  });

  it("見切り返し: ジャスト回避でダッシュの回数が 1 戻る", () => {
    const state = arena();
    give(state, "justReturn");
    state.player.dashChargesLeft = 0;
    justDodged(state);
    expect(state.player.dashChargesLeft).toBe(1);
  });

  it("起き上がり狙い: 怯みが解けた直後 0.4 秒だけカウンターになる", () => {
    const state = arena();
    give(state, "wakeupHunt");
    const e = dummy(state);
    expect(boonCounterable(state, e)).toBe(false);
    onBoonStaggerEnd(state, e);
    expect(boonCounterable(state, e)).toBe(true);
    updateBoonRules(state, BOON.wakeupWindow + 0.01);
    expect(boonCounterable(state, e)).toBe(false);
  });

  it("看破: カウンターを当てた敵が脆弱になる", () => {
    const state = arena();
    give(state, "insight");
    const a = dummy(state);
    const b = dummy(state, 40);
    swing(state, 0);
    meleeHit(state, a, false);
    meleeHit(state, b, true);
    expect(hasStatus(a.status, "vulnerable")).toBe(false);
    expect(hasStatus(b.status, "vulnerable")).toBe(true);
  });

  it("霜読み: 冷気の敵の予備動作中に当てた弾はカウンター（与ダメ・怯み値が増える）", () => {
    const state = arena();
    give(state, "frostRead");
    const e = dummy(state);
    e.phase = "windup";
    expect(onBoonProjectileHit(state, bullet(state), e), "冷気なしでは等倍").toBe(1);
    put(state, e, "chill", 3, 1, 0);
    expect(onBoonProjectileHit(state, bullet(state), e)).toBeCloseTo(ACTION.counter.damageMul);
    expect(boonPoise(state, e, "ranged", 10)).toBeCloseTo(10 * ACTION.counter.poiseMul);
  });

  it("口封じ: 射撃型の予備動作中に弾を当てると沈黙し、攻撃が取り消される", () => {
    const state = arena();
    give(state, "silenceShot");
    const e = dummy(state, 40, 0, "eye");
    e.phase = "windup";
    onBoonProjectileHit(state, bullet(state), e);
    expect(hasStatus(e.status, "silence")).toBe(true);
    expect(e.phase).not.toBe("windup");
  });

  it("死神遊び: 死神の接触でもジャスト回避が成立し、成立すると死神が止まる", () => {
    const state = arena();
    expect(boonReaperJust(state)).toBe(false);
    give(state, "reaperPlay");
    expect(boonReaperJust(state)).toBe(true);
    onBoonReaperDodged(state);
    expect(boonReaperHalted(state)).toBe(true);
    updateBoonRules(state, BOON.reaperStunTime + 0.01);
    expect(boonReaperHalted(state)).toBe(false);
  });
});

describe("単体の祝福（近接・射撃・ダッシュ）", () => {
  it("威圧: 3 段目で倒すと周囲の敵が恐怖する", () => {
    const state = arena();
    give(state, "intimidate");
    const dead = dummy(state);
    const near = dummy(state, 40);
    swing(state, LAST, dead);
    killed(state, dead);
    expect(hasStatus(near.status, "fear")).toBe(true);
  });

  it("狩り立て: 出血中の敵に近接を当てると恐怖", () => {
    const state = arena();
    give(state, "huntBleed");
    const e = dummy(state);
    swing(state, 0);
    meleeHit(state, e);
    expect(hasStatus(e.status, "fear"), "出血なしでは付かない").toBe(false);
    put(state, e, "bleed", 3, 1, 1);
    meleeHit(state, e);
    expect(hasStatus(e.status, "fear")).toBe(true);
  });

  it("見定め: 1・2 段目を同じ敵に当てると 3 段目は必ず会心", () => {
    const state = arena();
    give(state, "appraise");
    const e = dummy(state);
    const other = dummy(state, 40);
    swing(state, 0);
    meleeHit(state, e);
    swing(state, 1);
    meleeHit(state, e);
    swing(state, LAST);
    expect(boonForcesCrit(state, e, "melee")).toBe(true);
    expect(boonForcesCrit(state, other, "melee"), "別の敵には効かない").toBe(false);
  });

  it("背討ち: 恐怖の敵への攻撃は必ず会心（proc は対象外）", () => {
    const state = arena();
    give(state, "backstab");
    const e = dummy(state);
    expect(boonForcesCrit(state, e, "melee")).toBe(false);
    put(state, e, "fear", 2);
    expect(boonForcesCrit(state, e, "ranged")).toBe(true);
    expect(boonForcesCrit(state, e, "proc")).toBe(false);
  });

  it("燠火: 燃焼中の敵を殴ると燃焼の残りが 1 秒延びる（元の持続まで）", () => {
    const state = arena();
    give(state, "embers");
    const e = dummy(state);
    applyBurn(state, e, 5, 3);
    const burn = findStatus(e.status, "burn");
    if (!burn) throw new Error("燃焼が付いていない");
    burn.time = 1;
    swing(state, 0);
    meleeHit(state, e);
    expect(burn.time).toBeCloseTo(1 + BOON.embersExtend);
    burn.time = burn.maxTime - 0.1;
    meleeHit(state, e);
    expect(burn.time).toBeCloseTo(burn.maxTime);
  });

  it("片翼: 射撃できない代わりに 3 段目で弾が扇状に出る", () => {
    const state = arena();
    give(state, "oneWing");
    expect(boonBlocksShoot(state)).toBe(true);
    state.player.attack.dir = { x: 1, y: 0 };
    onBoonSwing(state, LAST, false);
    const shots = state.projectiles.filter((p) => p.owner === "player" && p.kind === "ranged");
    expect(shots.length).toBeGreaterThanOrEqual(BOON.oneWingMinShots);
  });

  it("飛燕: 誰にも当たらなかった斬撃は斬撃波になる", () => {
    const state = arena();
    give(state, "swallowFlight");
    swing(state, 0);
    updateBoonRules(state, DT);
    state.player.attack.phase = "recover";
    updateBoonRules(state, DT);
    expect(state.projectiles.some((p) => p.owner === "player" && p.kind === "melee")).toBe(true);
  });

  it("抜き胴: ダッシュですり抜けた敵を斬る", () => {
    const state = arena();
    give(state, "passCut");
    const e = dummy(state, 0);
    state.player.dashTimer = 0.2;
    onBoonDash(state);
    updateBoonRules(state, DT);
    expect(BIG_HP - e.hp).toBeGreaterThan(0);
    const after = e.hp;
    updateBoonRules(state, DT);
    expect(e.hp, "同じダッシュでは 1 度だけ").toBe(after);
  });

  it("属性の轍: ダッシュの軌跡が装備で最も強い元素を付ける", () => {
    const state = arena();
    give(state, "elementTrail");
    expect(trailElement(state), "元素なしは燃焼").toBe("burn");
    const chilly = arena(5, { chillChance: 0.3, chillSlow: 0.2 });
    expect(trailElement(chilly)).toBe("chill");
    const e = dummy(state, 0);
    state.player.dashTimer = 0.2;
    updateBoonRules(state, DT);
    expect(state.boonRun.rules.trail.length).toBeGreaterThan(0);
    expect(hasStatus(e.status, "burn")).toBe(true);
  });

  it("呼び戻し: 射撃ボタンを離すと飛んでいる弾が手元へ向かう", () => {
    const state = arena();
    give(state, "recall");
    const pr = bullet(state, { pos: { x: state.player.body.pos.x + 60, y: state.player.body.pos.y }, vel: { x: 200, y: 0 } });
    state.projectiles.push(pr);
    onBoonShootInput(state, true);
    onBoonShootInput(state, false);
    expect(pr.vel.x).toBeLessThan(0);
  });

  it("跳ね弾: 壁で 1 回だけ跳ね返り、威力 +30%", () => {
    const state = arena();
    give(state, "ricochet");
    const pr = bullet(state, { pos: { x: TILE_SIZE / 2, y: TILE_SIZE / 2 }, damage: 10 });
    expect(onBoonProjectileWall(state, pr, DT)).toBe(true);
    expect(pr.vel.x).toBeLessThan(0);
    expect(pr.damage).toBeCloseTo(10 * BOON.ricochetDamageMul);
    expect(onBoonProjectileWall(state, pr, DT), "2 回目は跳ねない").toBe(false);
  });

  it("炸裂弾頭: 壁に当たった弾が爆発する", () => {
    const state = arena();
    give(state, "warhead");
    const pos = { x: TILE_SIZE / 2, y: TILE_SIZE / 2 };
    const e = dummy(state);
    e.body.pos = { x: pos.x + 4, y: pos.y };
    expect(onBoonProjectileWall(state, bullet(state, { pos, damage: 40 }), DT)).toBe(false);
    expect(e.hp).toBeLessThan(BIG_HP);
  });

  it("狙い目: 脆弱の敵に当たった弾は貫通 +2（1 発につき 1 回）", () => {
    const state = arena();
    give(state, "weakSpot");
    const e = dummy(state);
    put(state, e, "vulnerable", 3);
    const pr = bullet(state);
    onBoonProjectileHit(state, pr, e);
    onBoonProjectileHit(state, pr, e);
    expect(pr.pierceLeft).toBe(BOON.weakSpotPierce);
  });

  it("火渡り: 燃える敵を通った弾は貫通 +1 して、次の敵へ燃焼を移す", () => {
    const state = arena();
    give(state, "fireWalk");
    const a = dummy(state);
    const b = dummy(state, 60);
    applyBurn(state, a, 5, 3);
    const pr = bullet(state);
    onBoonProjectileHit(state, pr, a);
    expect(pr.pierceLeft).toBe(1);
    onBoonProjectileHit(state, pr, b);
    expect(hasStatus(b.status, "burn")).toBe(true);
  });
});

describe("単体の祝福（状態異常・怯み）", () => {
  it("毒崩し: 毒の敵には怯み明けの堅守が付かない", () => {
    const state = arena();
    give(state, "venomBreak");
    const e = dummy(state);
    expect(boonSkipsGuarded(state, e)).toBe(false);
    put(state, e, "poison", 3);
    expect(boonSkipsGuarded(state, e)).toBe(true);
  });

  it("氷伝い: 冷気の敵を経由すると連鎖が 2 回延びる", () => {
    const state = arena();
    give(state, "iceRelay");
    const e = dummy(state);
    expect(boonChainExtension(state, e)).toBe(0);
    put(state, e, "chill", 3, 1, 0);
    expect(boonChainExtension(state, e)).toBe(BOON.iceRelayJumps);
  });

  it("神経断ち: 麻痺が解けた敵が弱体になる", () => {
    const state = arena();
    give(state, "nerveCut");
    const e = dummy(state);
    put(state, e, "paralyze", 0.3);
    updateBoonRules(state, DT);
    removeStatus(state, { kind: "enemy", enemy: e }, "paralyze");
    updateBoonRules(state, DT);
    expect(hasStatus(e.status, "weaken")).toBe(true);
  });

  it("返り血: 出血中の敵を倒すとダッシュの回数が全て戻る", () => {
    const state = arena();
    give(state, "bloodReturn");
    const e = dummy(state);
    put(state, e, "bleed", 3, 1, 1);
    state.player.dashChargesLeft = 0;
    killed(state, e);
    expect(state.player.dashChargesLeft).toBe(state.stats.dashCharges);
  });

  it("血裂き: 出血 3 の敵への会心で出血を消費し、その分を即時に与える", () => {
    const state = arena();
    give(state, "laceration");
    const e = dummy(state);
    put(state, e, "bleed", 4, 3, 1);
    const stacks = statusStacks(e.status, "bleed");
    const potency = findStatus(e.status, "bleed")?.potency ?? 0;
    critHit(state, e, 10);
    expect(hasStatus(e.status, "bleed")).toBe(false);
    expect(BIG_HP - e.hp).toBe(Math.round(stacks * potency * BOON.lacerationUnits));
  });

  it("綻び広げ: 脆弱の敵が死ぬと最も近い敵へ脆弱が移る", () => {
    const state = arena();
    give(state, "frayWiden");
    const dead = dummy(state);
    const near = dummy(state, 50);
    put(state, dead, "vulnerable", 3);
    killed(state, dead);
    expect(hasStatus(near.status, "vulnerable")).toBe(true);
  });

  it("見逃さぬ: 敵を怯ませるとマナが 8 戻る", () => {
    const state = arena();
    give(state, "keenEye");
    state.player.mana = 0;
    staggered(state, dummy(state));
    expect(state.player.mana).toBeCloseTo(BOON.keenEyeMana * state.stats.manaGainMul);
  });

  it("崩し連鎖: 怯ませると同じ部屋で怯み値が溜まっている敵にさらに溜まる", () => {
    const state = arena();
    give(state, "collapseChain");
    const a = dummy(state);
    const b = dummy(state, 40);
    b.roomIndex = a.roomIndex;
    b.poise.damage = 1;
    staggered(state, a);
    expect(b.poise.damage).toBeGreaterThan(1);
  });

  it("立て直し狩り: 堅守中の敵を倒すと必殺ゲージが 30% 溜まる", () => {
    const state = arena();
    give(state, "regroupHunt");
    const e = dummy(state);
    put(state, e, "guarded", 2);
    state.player.energy = 0;
    killed(state, e);
    expect(state.player.energy).toBeCloseTo(state.player.maxEnergy * BOON.regroupEnergyRatio);
  });

  it("力の簒奪: 弱体の敵を倒すと次の近接 1 回の怯み値が 2 倍", () => {
    const state = arena();
    give(state, "usurp");
    const dead = dummy(state);
    const e = dummy(state, 40);
    put(state, dead, "weaken", 3);
    killed(state, dead);
    expect(boonPoise(state, e, "melee", 10)).toBe(10 * BOON.usurpPoiseMul);
    expect(boonPoise(state, e, "melee", 10), "1 回で消費").toBe(10);
  });

  it("際打ち: コンボが切れる直前の攻撃は怯み値 2 倍", () => {
    const state = arena();
    give(state, "edgeStrike");
    const e = dummy(state);
    state.combo.count = 3;
    state.combo.timer = 1;
    expect(boonPoise(state, e, "melee", 10)).toBe(10);
    state.combo.timer = BOON.edgeStrikeWindow - 0.01;
    expect(boonPoise(state, e, "melee", 10)).toBe(10 * BOON.edgeStrikePoiseMul);
  });

  it("傷の記憶: 被弾すると攻撃の主が脆弱になる", () => {
    const state = arena();
    give(state, "woundMemory");
    const e = dummy(state);
    hurtBy(state, e);
    expect(hasStatus(e.status, "vulnerable")).toBe(true);
  });
});

describe("単体の祝福（マナ・スキル）", () => {
  it("両輪: クールダウンのスキルが当たると次のマナのスキルが半額、マナのスキルが当たるとクールダウンが縮む", () => {
    const state = arena();
    give(state, "twinWheels");
    const e = dummy(state);
    onBoonSkillCast(state, 0, "cooldown", 0);
    onBoonSkillHit(state, e);
    expect(boonManaCostMul(state)).toBeCloseTo(BOON.twinCostMul);
    onBoonSkillCast(state, 1, "mana", 10);
    expect(boonManaCostMul(state), "マナのスキルを撃つと割引は消える").toBe(1);
    const slot = state.skills.slots[0];
    if (!slot) throw new Error("スロットが無い");
    slot.cooldownLeft = 3;
    onBoonSkillHit(state, e);
    expect(slot.cooldownLeft).toBeCloseTo(3 - BOON.twinCdCut);
    onBoonSkillHit(state, e);
    expect(slot.cooldownLeft, "1 回の発動で 1 度だけ").toBeCloseTo(3 - BOON.twinCdCut);
  });

  it("静寂の間: 沈黙中の敵が近くにいるとコスト -30%", () => {
    const state = arena();
    give(state, "quietHall");
    const e = dummy(state);
    expect(boonManaCostMul(state)).toBe(1);
    put(state, e, "silence", 2);
    expect(boonManaCostMul(state)).toBeCloseTo(BOON.quietHallCostMul);
  });

  it("換金: バーストでコンボを 0 にしてコンボ数 × 2 のマナを得る", () => {
    const state = arena();
    give(state, "cashOut");
    state.player.mana = 0;
    state.combo.count = 10;
    burst(state, 0);
    expect(state.combo.count).toBe(0);
    expect(state.player.mana).toBeCloseTo(10 * BOON.cashOutManaPerCombo * state.stats.manaGainMul);
  });

  it("余韻: スキル発動後 0.6 秒だけ通常攻撃のマナが 2 倍", () => {
    const state = arena();
    give(state, "afterglow");
    expect(boonAttackManaMul(state)).toBe(1);
    onBoonSkillCast(state, 0, "mana", 10);
    expect(boonAttackManaMul(state)).toBe(BOON.afterglowManaMul);
    updateBoonRules(state, BOON.afterglowWindow + 0.01);
    expect(boonAttackManaMul(state)).toBe(1);
  });

  it("詠唱返し: 自分が沈黙している間は通常攻撃のマナが 3 倍", () => {
    const state = arena();
    give(state, "chantReturn");
    applyStatus(state, { kind: "player" }, { kind: "silence", stacks: 1, duration: 1, potency: 0 }, "enemy");
    expect(boonAttackManaMul(state)).toBe(BOON.chantReturnManaMul);
  });

  it("満月撃ち: マナ満タンで撃ったスキルが当たると脆弱", () => {
    const state = arena();
    give(state, "fullMoonShot");
    const e = dummy(state);
    state.player.mana = state.stats.maxMana - 10;
    onBoonSkillCast(state, 0, "mana", 10);
    onBoonSkillHit(state, e);
    expect(hasStatus(e.status, "vulnerable")).toBe(true);
  });
});

describe("単体の祝福（HP・部屋・死神・コンボ）", () => {
  it("取り返し: リゲイン中に倒すと取り戻せる分を全て回復", () => {
    const state = arena();
    give(state, "takeBack");
    const p = state.player;
    p.hp = p.maxHp - 30;
    p.regainTimer = 1;
    p.regainPool = 20;
    killed(state, dummy(state));
    expect(p.hp).toBeCloseTo(p.maxHp - 10);
    expect(p.regainPool).toBe(0);
  });

  it("死神の影: 死神が出ている間の撃破でマナと必殺ゲージ", () => {
    const state = arena();
    give(state, "reaperShadow");
    state.player.mana = 0;
    state.player.energy = 0;
    killed(state, dummy(state));
    expect(state.player.energy, "死神がいなければ何もない").toBe(0);
    state.reaper = { pos: { x: 0, y: 0 }, radius: 8, animTime: 0 };
    killed(state, dummy(state));
    expect(state.player.energy).toBe(BOON.reaperShadowEnergy);
    expect(state.player.mana).toBeGreaterThan(0);
  });

  it("時間稼ぎ: 制圧するたび死神の出現が 10 秒遅れ、階が変わると戻る", () => {
    const state = arena();
    give(state, "stallTime");
    const before = reaperAppearAfter(state);
    roomCleared(state);
    expect(boonReaperDelay(state)).toBe(BOON.stallTimeDelay);
    expect(reaperAppearAfter(state)).toBe(before + BOON.stallTimeDelay);
  });

  it("試練の徒: 試練の部屋を制圧すると 3 択がもう 1 回出る", () => {
    const state = arena();
    give(state, "trialSeeker");
    state.depth = 3;
    const room = state.rooms[0];
    if (!room) throw new Error("部屋が無い");
    room.kind = "normal";
    roomCleared(state, room);
    expect(state.boonChoice).toBeNull();
    room.kind = "challenge";
    roomCleared(state, room);
    expect(state.boonChoice?.options.length).toBeGreaterThan(0);
  });

  it("伏兵返し: 伏兵の部屋を制圧すると刻印符が落ちる", () => {
    const state = arena();
    give(state, "ambushReturn");
    const room = state.rooms[0];
    if (!room) throw new Error("部屋が無い");
    room.kind = "ambush";
    const before = state.skills.runes.length;
    roomCleared(state, room);
    expect(state.skills.runes.length).toBe(before + 1);
  });

  it("持ち越し: 制圧後は次の封鎖までコンボが時間切れしない", () => {
    const state = arena();
    give(state, "carryOver");
    state.combo.count = 5;
    roomCleared(state);
    state.combo.timer = 0.01;
    updateBoonRules(state, DT);
    expect(state.combo.timer).toBeCloseTo(FEEL.comboWindow + state.stats.comboWindowBonus);
    roomLocked(state, 0);
    state.combo.timer = 0.01;
    updateBoonRules(state, DT);
    expect(state.combo.timer, "封鎖で終わる").toBeCloseTo(0.01);
  });

  it("綱渡り: コンボは時間切れしない代わりに、被弾でコンボ数 / 5 の追加ダメージ", () => {
    const state = arena();
    give(state, "tightrope");
    state.combo.count = 10;
    state.combo.timer = 0.01;
    updateBoonRules(state, DT);
    expect(state.combo.timer).toBeGreaterThan(0.01);
    const hp = state.player.hp;
    comboAfterHurt(state);
    expect(hp - state.player.hp).toBe(10 / BOON.tightropeComboDiv);
  });
});

describe("呪い付き（拡張）", () => {
  const run = createBoonRunState();

  it("死に急ぎ: 最大 HP -50%、撃破で 0.5 秒無敵", () => {
    expect(foldBoonStats(DEFAULT_STATS, ["deathRush"], run).maxHp).toBe(Math.round(DEFAULT_STATS.maxHp * BOON.deathRushMaxHpMul));
    const state = arena();
    give(state, "deathRush");
    state.player.invulnTimer = 0;
    killed(state, dummy(state));
    expect(state.player.invulnTimer).toBeCloseTo(BOON.deathRushInvuln);
  });

  it("重荷: 移動 -25%、近接の怯み値 2 倍", () => {
    const state = arena();
    give(state, "burden");
    expect(boonMoveMul(state)).toBeCloseTo(BOON.burdenMoveMul);
    expect(boonPoise(state, dummy(state), "melee", 10)).toBe(10 * BOON.burdenPoiseMul);
    expect(boonPoise(state, dummy(state), "ranged", 10), "射撃は変わらない").toBe(10);
  });

  it("業の火: 燃焼 dps 2 倍、近くに燃える敵がいると自分も燃える", () => {
    expect(foldBoonStats({ ...DEFAULT_STATS, burnDps: 4 }, ["karmaFire"], run).burnDps).toBe(4 * BOON.karmaBurnMul);
    const state = arena();
    give(state, "karmaFire");
    const e = dummy(state, 10);
    applyBurn(state, e, 5, 3);
    updateBoonRules(state, DT);
    expect(hasStatus(state.player.status, "burn")).toBe(true);
  });

  it("乾坤: 自然回復と通常攻撃のマナが 0、ジャスト回避と撃破で満タン", () => {
    expect(foldBoonStats(DEFAULT_STATS, ["heavenEarth"], run).manaRegen).toBe(0);
    const state = arena();
    give(state, "heavenEarth");
    expect(boonAttackManaMul(state)).toBe(0);
    state.player.mana = 0;
    justDodged(state);
    expect(state.player.mana).toBe(state.stats.maxMana);
    state.player.mana = 0;
    killed(state, dummy(state));
    expect(state.player.mana).toBe(state.stats.maxMana);
  });
});

describe("結び祝福", () => {
  it("燕渡り: 消した敵弾の数だけ近い敵を斬り渡る", () => {
    const state = arena();
    give(state, "justSlash", "justWipe", "swallowReturn");
    const a = dummy(state, 30);
    const b = dummy(state, 60);
    for (let i = 0; i < 2; i++) state.projectiles.push(bullet(state, { owner: "enemy", kind: "proc" }));
    justDodged(state);
    expect(a.hp).toBeLessThan(BIG_HP);
    expect(b.hp).toBeLessThan(BIG_HP);
  });

  it("疫血: 毒と出血が両方付いた敵が死ぬと出血も引き継ぐ", () => {
    const state = arena();
    give(state, "plague", "bloodMist", "plagueBlood");
    const dead = dummy(state);
    const near = dummy(state, 30);
    put(state, dead, "poison", 3, 1, 0);
    put(state, dead, "bleed", 3, 2, 1);
    killed(state, dead);
    expect(hasStatus(near.status, "bleed")).toBe(true);
    expect(hasStatus(near.status, "poison")).toBe(true);
  });

  it("雷爆走: ダッシュ終わりの爆発に感電 2 が乗る", () => {
    const state = arena();
    give(state, "dashBlast", "dashShock", "thunderBlast");
    const e = dummy(state, 10);
    dashEnded(state);
    expect(statusStacks(e.status, "shock")).toBeGreaterThanOrEqual(BOON.thunderBlastStacks);
  });

  it("総崩れ: 崩しの脆弱が周囲の敵にも伝わる", () => {
    const state = arena();
    give(state, "crumble", "collapseChain", "totalCollapse");
    const a = dummy(state);
    const b = dummy(state, 40);
    put(state, a, "stagger", 0.5);
    updateBoons(state, DT);
    expect(hasStatus(a.status, "vulnerable")).toBe(true);
    expect(hasStatus(b.status, "vulnerable")).toBe(true);
  });

  it("饗宴の盃: HP 満タンで倒すと戻るマナが増える", () => {
    const withCup = (cup: boolean): number => {
      const state = arena();
      give(state, "bloodFeast", "reaperCup");
      if (cup) give(state, "feastCup");
      state.player.mana = 0;
      killed(state, dummy(state));
      return state.player.mana;
    };
    expect(withCup(true) - withCup(false)).toBeCloseTo(BOON.reaperCupKillMana);
  });

  it("臨界: バーストの後はゲージが空でも過充填の爆発が起きる", () => {
    const state = arena();
    give(state, "overcharge", "burstRefund", "criticalMass");
    const e = dummy(state);
    const near = dummy(state, 30);
    state.player.energy = 0;
    swing(state, 0);
    meleeHit(state, e);
    expect(near.hp, "ゲージが空なら爆発しない").toBe(BIG_HP);
    burst(state, 0);
    meleeHit(state, e);
    expect(near.hp).toBeLessThan(BIG_HP);
  });

  it("虚刃: マナが 0 の間は霊刃の上乗せが 2 倍", () => {
    const state = arena();
    give(state, "spiritBlade", "hollowVessel", "hollowBlade");
    state.player.mana = 10;
    const full = boonNormalAttackBonus(state);
    state.player.mana = 0;
    expect(boonNormalAttackBonus(state)).toBeCloseTo(full * BOON.hollowBladeMul);
  });

  it("冬籠り: 封鎖中の部屋の敵は予備動作が 20% 長い", () => {
    const state = arena();
    give(state, "frostLock", "clearShield", "winterNest");
    const e = dummy(state);
    const room = state.rooms[e.roomIndex];
    if (!room) throw new Error("部屋が無い");
    room.locked = false;
    expect(boonWindupMul(state, e)).toBe(1);
    room.locked = true;
    expect(boonWindupMul(state, e)).toBeCloseTo(BOON.winterNestMul);
  });

  it("冬籠り: 封鎖しない部屋でも交戦中ならその部屋の敵が伸びる。徘徊の敵は伸びない", () => {
    const state = arena();
    give(state, "frostLock", "clearShield", "winterNest");
    const e = engageStartRoom(state);
    expect(boonWindupMul(state, e), "交戦中の部屋の敵").toBeCloseTo(BOON.winterNestMul);
    const roamer = dummy(state);
    roamer.roomIndex = -1;
    expect(boonWindupMul(state, roamer), "徘徊").toBe(1);
  });

  it("明鏡: ジャスト回避の直後に撃ったスキル 1 回は払ったマナが戻る", () => {
    const state = arena();
    give(state, "keenBreath", "justReturn", "clearMirror");
    justDodged(state);
    state.player.mana = 5;
    onBoonSkillCast(state, 0, "mana", 10);
    expect(state.player.mana).toBe(15);
  });

  it("瞬停: ダッシュの終わり際に撃った弾も静止狙撃になる", () => {
    const state = arena();
    give(state, "standingSniper", "dashGun", "stillDash");
    state.player.body.vel = { x: 300, y: 0 };
    state.player.dashTimer = BOON.stillDashWindow / 2;
    const shot = bullet(state);
    onBoonShoot(state, [shot]);
    expect(shot.pierceLeft).toBe(BOON.standPierceBonus);
  });

  it("波返し: 衝撃波が壁で 1 回跳ね返る", () => {
    const state = arena();
    give(state, "comboWave", "finisherWave", "waveReturn");
    state.player.body.pos = { x: TILE_SIZE / 2, y: TILE_SIZE / 2 };
    state.player.attack.dir = { x: 1, y: 0 };
    swung(state, LAST, false, 10);
    const wave = state.projectiles.find((p) => p.kind === "melee");
    if (!wave) throw new Error("衝撃波が出ていない");
    expect(onBoonProjectileWall(state, wave, DT)).toBe(true);
    expect(onBoonProjectileWall(state, wave, DT), "2 回目は跳ねない").toBe(false);
  });
});

describe("祝福の威力は装備に比例する", () => {
  it("slashBase は近接の性質で伸びる", () => {
    const plain = arena();
    const strong = arena(5, { meleeDamageMul: 2 });
    expect(slashBase(strong)).toBeGreaterThan(slashBase(plain));
  });
});

describe("旧フックから移した祝福（BoonDef.rules）: イベント 1 回で効果 1 回、条件を欠けば 0 回", () => {
  /**
   * フックから rules へ移した祝福（フック側の実装は消した）。ここに足した key は rules を持ち、すべて direct であること。
   * 数値の畳み込みやフックに残る部分を持つもの（血の代償の最大生命・乾坤の自然回復・看破の射撃カウンター・
   * 満ち潮の射撃・精鋭の磁力の精鋭化など）も、移した「〜時: 〜」の部分をここで見る
   */
  const MIGRATED: readonly BoonKey[] = [
    // ---- 第 1 弾（0.0.11α） ----
    "comboWave",
    "finisherWave",
    "clearShield",
    "clearHeal",
    "burnSpread",
    "chillShatter",
    "dashShock",
    "bloodFeast",
    "plague",
    "reaperCup",
    "keenBreath",
    "glare",
    "justReturn",
    "bloodReturn",
    "keenEye",
    "woundMemory",
    "heavenEarth",
    "plagueBlood",
    // ---- 第 2 弾（起点 onComboHit / onShatter / onSwingHit と効果の追加で移したもの） ----
    "comboClock",
    "frostPierce",
    "shatterBell",
    "frostLock",
    "springWell",
    "ambushReturn",
    "trialSeeker",
    "huntLord",
    "dashBlast",
    "thunderBlast",
    "huntBleed",
    "insight",
    "embers",
    "chargedBlade",
    "highTide",
    "overcharge",
    "criticalMass",
    "regroupHunt",
    "deathRush",
    "reaperShadow",
    "intimidate",
    "eternalWinter",
    "critChain",
    "eliteMagnet",
    "eliteVault",
    "bloodMist",
    "burstRefund",
    "takeBack",
    "cashOut",
    "frayWiden",
    "scorchedEarth",
  ];
  /** フックが祝福ごとの内部 CD を持っていたもの（Rule の ICD も同じ秒） */
  const HOOK_ICD: Partial<Record<BoonKey, number>> = {
    chargedBlade: BOON.chargedBladeIcd,
    critChain: BOON.critChainIcd,
    overcharge: BOON.overchargeIcd,
    criticalMass: BOON.overchargeIcd,
  };
  const LOW_HP = 10;
  const DASH_CHARGES = 3;
  const SWING_DAMAGE = 10;
  const CRIT_AMOUNT = 10;
  const BURST_KILLS = 1;
  const SCENE_DEPTH = 3;
  const REGAIN_POOL = 5;
  const REGAIN_TIME = 1;
  const STATUS_TIME = 3;
  const STATUS_STACKS = 2;
  const STATUS_POTENCY = 2;
  const ELITE: Enemy["elite"] = "hasted";
  /** 状態異常のスタックを強さ・残り秒と混ぜずに数えるための重み */
  const STACK_WEIGHT = 1000;
  const NEIGHBOR = { dx: 30, dy: 20 };

  interface Scene {
    state: GameState;
    target: Enemy;
    neighbor: Enemy;
  }

  function statusWeight(effects: readonly { time: number; stacks: number; potency: number }[]): number {
    return effects.filter((x) => x.time > 0).reduce((t, x) => t + x.stacks * STACK_WEIGHT + x.potency + x.time, 0);
  }

  /**
   * 効果の副作用（気力・生命・ダッシュ・無敵・弾の数・生きた敵の生命の和・敵の状態異常の和・
   * 必殺ゲージ・回避の無敵・コンボ・3 択・宝物庫の予約・落ちた装備・落ちた刻印符・自分の状態異常）
   */
  function effectVector(state: GameState): number[] {
    const p = state.player;
    const hpSum = state.enemies.filter((e) => e.hp > 0).reduce((sum, e) => sum + e.hp, 0);
    const statusSum = state.enemies.reduce((sum, e) => sum + statusWeight(e.status.effects), 0);
    return [
      p.mana,
      p.hp,
      p.dashChargesLeft,
      p.buffs.invuln,
      state.projectiles.length,
      hpSum,
      statusSum,
      p.energy,
      p.invulnTimer,
      state.combo.count,
      state.boonChoice === null ? 0 : 1,
      state.boonRun.vaultNext ? 1 : 0,
      state.floorItems.length,
      state.skills.runes.length,
      statusWeight(p.status.effects),
    ];
  }

  function delta(before: readonly number[], after: readonly number[]): number[] {
    return after.map((v, i) => v - (before[i] ?? 0));
  }

  /** 対象に状態異常を付け、残りを半分にする（燠火の延長が上限で切れないように） */
  function afflictTarget(state: GameState, e: Enemy, kind: StatusKind): void {
    put(state, e, kind, STATUS_TIME, STATUS_STACKS, STATUS_POTENCY);
    const found = findStatus(e.status, kind);
    if (found) found.time = found.maxTime / 2;
  }

  /** 条件を満たす（met）/ 満たさないように場を整える。見切りの出どころ・振りの段・コンボ加算の量は起点の側で決める */
  function prepare(scene: Scene, rule: Rule, c: RuleCondition, met: boolean): void {
    const { state, target } = scene;
    const p = state.player;
    switch (c.kind) {
      case "targetHas":
        if (met) afflictTarget(state, target, c.status);
        return;
      case "comboAbove":
        state.combo.count = met ? c.count : 0;
        state.combo.timer = 1;
        return;
      case "manaFull":
        p.mana = met ? state.stats.maxMana : 0;
        return;
      case "energyFull":
        p.energy = met ? p.maxEnergy : 0;
        return;
      case "not":
        prepare(scene, rule, c.condition, !met);
        return;
      case "recent":
        if (met) state.recent[c.event] = { lastTime: state.time, count: 1 };
        else delete state.recent[c.event];
        return;
      case "reaperNear":
        state.floorTime = met ? reaperAppearAfter(state) : 0;
        return;
      case "swingStruck":
        p.attack.phase = met ? "active" : "none";
        p.attack.hitIds.clear();
        p.attack.hitIds.add(target.id);
        p.dashStrike = false;
        return;
      case "finisher":
        p.attack.combo = met ? LAST : 0;
        return;
      case "targetElite":
        target.elite = met ? ELITE : undefined;
        return;
      case "eventTag":
        if (rule.when === "onRoomClear") setRoomKind(state, met ? c.tag : "normal");
        return;
      case "eventTagIn":
        setRoomKind(state, met ? (c.tags[0] ?? "normal") : "normal");
        return;
      case "amountEvery":
        // コンボ加算の量は加算後のコンボ数（起点の側でこの数をイベントに載せる）
        state.combo.count = met ? c.every : c.every + 1;
        return;
      case "from":
        return;
      default:
        throw new Error(`テストが未対応の条件: ${c.kind}`);
    }
  }

  function setRoomKind(state: GameState, kind: string): void {
    const room = state.rooms[0];
    if (room) room.kind = kind as RoomState["kind"];
  }

  /** 効果が食う相手を場に置く（起爆・移す状態異常・凍結の敵だけ・徘徊の敵・リゲイン・自分の状態異常） */
  function prepareEffect(scene: Scene, rule: Rule): void {
    const { state, target, neighbor } = scene;
    const then = rule.then;
    if (then.kind === "detonate" && then.status) afflictTarget(state, target, then.status);
    if (then.onlyWith) put(state, neighbor, then.onlyWith, STATUS_TIME);
    if (then.room === "roaming") neighbor.roomIndex = ROAMING_ROOM;
    if (then.kind === "cleanse" && then.status) {
      applyStatus(state, { kind: "player" }, { kind: then.status, stacks: 1, duration: STATUS_TIME, potency: 1 }, "enemy");
    }
    if (then.kind === "reclaim") {
      state.player.regainPool = REGAIN_POOL;
      state.player.regainTimer = REGAIN_TIME;
    }
  }

  /** 生命・気力・ダッシュ・ゲージを減らし、対象と隣の敵を置いた場。unmet = 満たさない条件の添字（-1 = すべて満たす） */
  function makeScene(key: BoonKey, rule: Rule, unmet: number): Scene {
    const state = arena(5, { dashCharges: DASH_CHARGES });
    give(state, key);
    state.depth = SCENE_DEPTH;
    const p = state.player;
    p.hp = LOW_HP;
    p.mana = 0;
    p.energy = 0;
    p.dashChargesLeft = 0;
    p.attack.dir = { x: 1, y: 0 };
    const target = dummy(state);
    const neighbor = dummy(state, NEIGHBOR.dx, NEIGHBOR.dy);
    const scene = { state, target, neighbor };
    prepareEffect(scene, rule);
    rule.if.forEach((c, i) => prepare(scene, rule, c, i !== unmet));
    // 撃破は倒れた後の照合（対象はもう生きていない）
    if (rule.when === "onKill") target.hp = 0;
    dropEvents(state);
    return scene;
  }

  function conditionMetIn(rule: Rule, unmet: number, kind: RuleCondition["kind"]): boolean {
    const index = rule.if.findIndex((c) => c.kind === kind);
    return index < 0 || index !== unmet;
  }

  /** 起点を 1 回起こす。withHook = 本体と同じく残ったフックも呼ぶ（呼ばなければ Rule だけの効果） */
  function fire(scene: Scene, rule: Rule, unmet: number, withHook: boolean): void {
    const { state, target } = scene;
    const pos = { ...state.player.body.pos };
    switch (rule.when) {
      case "onKill":
        pushKillEvents(state, target);
        if (withHook) onBoonKill(state, target);
        return;
      case "onDash":
        if (withHook) onBoonDash(state);
        pushPlayerEvent(state, "onDash", "dash");
        return;
      case "onDashEnd":
        if (withHook) onBoonDashEnd(state);
        pushPlayerEvent(state, "onDashEnd", "dash");
        return;
      case "onJustDodge": {
        // 条件 from を欠く = 受け流しのスキルが積む見切り（フック onBoonJust は回避の見切りでしか呼ばれない）
        const dodged = conditionMetIn(rule, unmet, "from");
        if (withHook && dodged) onBoonJust(state);
        const source = dodged ? { kind: "player" as const, key: "just" } : { kind: "skill" as const, key: "parry" };
        pushPlayerEvent(state, "onJustDodge", "just", { sourceId: target.id, source });
        return;
      }
      case "onStagger":
        if (withHook) onBoonStagger(state, target);
        pushEvent(state, { kind: "onStagger", actor: "player", source: { kind: "player", key: "stagger" }, ...enemyTarget(target) });
        return;
      case "onHurt":
        pushEvent(state, { kind: "onHurt", actor: "enemy", pos, targetId: target.id, sourceId: target.id, source: { kind: "enemy", key: target.defKey } });
        return;
      default:
        fireMore(scene, rule, unmet, withHook);
    }
  }

  /** 第 2 弾で増えた起点（部屋・振り・コンボ・砕き・会心・バースト） */
  function fireMore(scene: Scene, rule: Rule, unmet: number, withHook: boolean): void {
    const { state, target } = scene;
    const room = state.rooms[0];
    const roomSource = { kind: "room" as const, key: room?.kind ?? "" };
    switch (rule.when) {
      case "onRoomClear":
        pushPlayerEvent(state, "onRoomClear", "room", { tag: room?.kind, source: roomSource });
        if (withHook) onBoonRoomClear(state, room);
        return;
      case "onRoomLock":
        if (withHook) onBoonRoomLock(state, 0);
        pushPlayerEvent(state, "onRoomLock", "room", { tag: room?.kind, room: 0, source: roomSource });
        return;
      case "onSwing": {
        const combo = conditionMetIn(rule, unmet, "eventTag") ? LAST : 0;
        if (withHook) onBoonSwing(state, combo, false);
        pushSwingEvent(state, combo, false, SWING_DAMAGE);
        return;
      }
      case "onSwingHit":
        if (withHook) onBoonMeleeHit(state, target, false);
        pushSwingHitEvent(state, target, state.player.attack.combo, state.player.dashStrike);
        return;
      case "onCounter":
        pushEvent(state, { kind: "onCounter", actor: "player", source: { kind: "player", key: "counter" }, ...enemyTarget(target) });
        if (withHook) onBoonMeleeHit(state, target, true);
        return;
      case "onComboHit":
        if (withHook) onBoonComboHit(state);
        pushPlayerEvent(state, "onComboHit", "combo", { amount: state.combo.count });
        return;
      case "onShatter":
        if (withHook) onBoonShatter(state, target);
        pushShatterEvent(state, target);
        return;
      case "onCrit":
        if (withHook) onBoonCrit(state, target, CRIT_AMOUNT);
        pushEvent(state, { kind: "onCrit", actor: "player", source: { kind: "player", key: "melee" }, amount: CRIT_AMOUNT, ...enemyTarget(target) });
        return;
      case "onBurst":
        if (withHook) onBoonBurstKills(state, BURST_KILLS);
        pushPlayerEvent(state, "onBurst", "burst", { amount: BURST_KILLS });
        return;
      default:
        throw new Error(`テストが未対応の起点: ${rule.when}`);
    }
  }

  /**
   * 起点 1 回の効果（照合前後の差）。withHook なら本体と同じ経路、そうでなければこの祝福の同じ起点の Rule だけを照合する
   * （回復と解呪・気力とゲージのように 1 つの起点を 2 つの Rule に分けた祝福は、合わせて 1 回ぶん）
   */
  function effectOf(key: BoonKey, rule: Rule, unmet: number, withHook: boolean): number[] {
    const scene = makeScene(key, rule, unmet);
    const before = effectVector(scene.state);
    fire(scene, rule, unmet, withHook);
    const siblings = (BOONS[key].rules ?? []).filter((r) => r.when === rule.when);
    resolveRules(scene.state, 0, withHook ? undefined : siblings);
    return delta(before, effectVector(scene.state));
  }

  const cases = MIGRATED.flatMap((key) => (BOONS[key].rules ?? []).map((rule) => ({ key, rule })));

  it("移した祝福はすべて rules を持ち、direct（連鎖に数えない）で組まれている", () => {
    for (const key of MIGRATED) {
      const rules = BOONS[key].rules ?? [];
      expect(rules.length, `${key} は rules を持つ`).toBeGreaterThan(0);
      for (const r of rules) {
        expect(r.direct, `${key} の ${r.id} は direct`).toBe(true);
        expect(r.chance, `${key} の ${r.id} は確定`).toBe(1);
        expect(r.icd, `${key} の ${r.id} の ICD はフックと同じ（無ければ 0）`).toBe(HOOK_ICD[key] ?? 0);
        expect(r.owner, `${key} の ${r.id} の持ち主`).toEqual({ kind: "boon", key });
      }
    }
  });

  it("移した祝福は第 1 弾 18 種 + 第 2 弾 30 種以上で、重複しない", () => {
    expect(new Set(MIGRATED).size).toBe(MIGRATED.length);
    expect(MIGRATED.length).toBeGreaterThanOrEqual(48);
  });

  it.each(cases.map((c) => [`${c.key}（${c.rule.id} / ${c.rule.when}）`, c] as const))(
    "%s: 本体の経路でイベント 1 回 → Rule 1 回ぶんの効果（フックと二重に起きない）",
    (_name, { key, rule }) => {
      const once = effectOf(key, rule, -1, false);
      const viaGame = effectOf(key, rule, -1, true);
      expect(once.some((v) => v !== 0), `${key}: Rule が何か効果を起こす`).toBe(true);
      expect(viaGame, `${key}: フックを通しても効果は 1 回ぶん`).toEqual(once);
    },
  );

  it.each(cases.filter((c) => c.rule.if.length > 0).map((c) => [`${c.key}（${c.rule.id}）`, c] as const))(
    "%s: 条件を 1 つでも欠くと効果は 0 回",
    (_name, { key, rule }) => {
      rule.if.forEach((c, unmet) => {
        const effect = effectOf(key, rule, unmet, true);
        expect(effect.every((v) => v === 0), `${key}: 条件 ${c.kind} を欠くと起きない`).toBe(true);
      });
    },
  );

  it.each(cases.filter((c) => c.rule.icd > 0).map((c) => [`${c.key}（${c.rule.id}）`, c] as const))(
    "%s: ICD の間は 2 回目が起きない（フックの内部 CD と同じ）",
    (_name, { key, rule }) => {
      const scene = makeScene(key, rule, -1);
      fire(scene, rule, -1, true);
      resolveRules(scene.state, 0);
      prepareEffect(scene, rule);
      rule.if.forEach((c) => prepare(scene, rule, c, true));
      const before = effectVector(scene.state);
      fire(scene, rule, -1, true);
      resolveRules(scene.state, 0);
      expect(delta(before, effectVector(scene.state)).every((v) => v === 0), `${key}: ICD の間は起きない`).toBe(true);
    },
  );
});

describe("移行 第 2 弾の起点: 本体の経路でイベントが積まれる", () => {
  it("コンボ加算は onComboHit を加算後のコンボ数つきで積む", () => {
    const state = arena();
    dropEvents(state);
    state.combo.count = 9;
    registerComboHit(state);
    const ev = state.events.find((e) => e.kind === "onComboHit");
    expect(ev?.amount, "加算後のコンボ数").toBe(10);
  });

  it("凍結の敵を砕くと onShatter を砕かれた敵を対象に積む", () => {
    const state = arena();
    const e = dummy(state);
    put(state, e, "freeze", 1);
    dropEvents(state);
    damageEnemy(state, e, 5, { x: 1, y: 0 }, 0);
    const ev = state.events.find((x) => x.kind === "onShatter");
    expect(ev?.targetId, "砕かれた敵").toBe(e.id);
  });

  it("会心のイベントは与えたダメージを量に持つ（会心雷撃の威力）", () => {
    const state = arena(5, { critChance: 1 });
    const e = dummy(state);
    dropEvents(state);
    damageEnemy(state, e, 7, { x: 1, y: 0 }, 0, { kind: "melee", crit: true });
    const ev = state.events.find((x) => x.kind === "onCrit");
    expect(ev?.amount, "与えたダメージ").toBe(BIG_HP - e.hp);
  });

  it("撃破のイベントは精鋭かどうかと状態異常の残り秒を写す", () => {
    const state = arena();
    const e = dummy(state);
    e.elite = "hasted";
    put(state, e, "vulnerable", 2);
    dropEvents(state);
    pushKillEvents(state, e);
    const ev = state.events.find((x) => x.kind === "onKill");
    expect(ev?.targetElite, "精鋭の写し").toBe(true);
    expect(ev?.targetStatus?.find((s) => s.kind === "vulnerable")?.time, "残り秒の写し").toBeCloseTo(2);
  });
});
