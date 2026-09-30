import { describe, expect, it } from "vitest";
import { pushKillEvents } from "../core/events";
import { type Enemy, type GameState, allocId } from "../core/state";
import { BOON } from "../data/tuning";
import { stoneFromSeed } from "../skills/generator";
import { BOONS, BOON_KEYS, type BoonKey, onBoonDash, onBoonKill, onBoonSkillCast, rollBoonOptions } from "./boons";
import { equippedSlotCount, isRoamerTarget, slashBase, updateBoonRules } from "./boonRules";
import { damageEnemy, registerComboHit } from "./combat";
import { ROAMING_ROOM } from "./spawner";
import { applyStatus, enemiesInRadius } from "./statusEffects";
import { canAttach, SKILL_DEFS } from "../skills/data";
import { stoneInSlot } from "../skills/persistence";
import { boonGrantedModifiers, grantBoon } from "./boons";
import { effectiveSlotModifiers, syncSlotModifiers } from "./skills";
import { arena, increasedWith, placeEnemy, withInput } from "./testHelpers";
import { step } from "../core/game";
import { FIXED_DT } from "../core/loop";
import { coreGradeShift, coreKeepsCurses, ownedCore } from "./boonCores";

/**
 * 統一ルール文法で書けない祝福の効果（system/boonRules.ts）と、祝福が乗る本体の起点。
 * 系譜の札そのものの効き目は src/system/boonDefs/<系譜>.test.ts
 */

const BIG_HP = 100000;
const DT = 1 / 60;
const SEEDS = 30;

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

function dropEvents(state: GameState): void {
  state.events = [];
  state.pendingEvents = [];
}

/** スロット 0・1 に気力のスキル石を 2 つ装着する（四重奏の数え） */
function equipTwo(state: GameState, id: string): void {
  const stones = (["commonWhirl", "commonBomb"] as const).map((k, i) => ({
    ...stoneFromSeed(i + 1, { foundDepth: 1, now: 0, skillKey: k }),
    id: `${id}-${i}`,
  }));
  state.skills.profile = { ...state.skills.profile, stones, loadout: [stones[0]!.id, stones[1]!.id, null, null] };
}

describe("輪廻の四重奏（boonRules.ts の trackEclipse）", () => {
  it("装着中のスキルを重複なく全て撃つと、窓の間は払った気力が戻る", () => {
    const state = arena();
    give(state, "eclipse");
    equipTwo(state, "boon-eclipse");
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

  it("窓の中の発動は次の窓の条件に数えない（交互撃ちで無料発動が続かない）", () => {
    const state = arena();
    give(state, "eclipse");
    equipTwo(state, "boon-eclipse-loop");
    onBoonSkillCast(state, 0, "mana", 10);
    onBoonSkillCast(state, 1, "mana", 10);
    expect(state.boonRun.rules.eclipseTimer).toBe(BOON.eclipseWindow);
    onBoonSkillCast(state, 0, "mana", 10);
    onBoonSkillCast(state, 1, "mana", 10);
    updateBoonRules(state, BOON.eclipseWindow + 0.01);
    expect(state.boonRun.rules.eclipseTimer, "窓は開き直さず閉じる").toBe(0);
    state.player.mana = 0;
    onBoonSkillCast(state, 0, "mana", 10);
    expect(state.player.mana, "窓が閉じた後の発動は戻らない").toBe(0);
  });

  it("持っていなければ撃った順を数えない", () => {
    const state = arena();
    equipTwo(state, "boon-eclipse-none");
    onBoonSkillCast(state, 0, "mana", 10);
    onBoonSkillCast(state, 1, "mana", 10);
    expect(state.boonRun.rules.eclipseTimer).toBe(0);
    expect(state.boonRun.rules.castSeq).toEqual([]);
  });
});

describe("刃鳴の抜き胴（boonRules.ts の updateDashThrough）", () => {
  it("ダッシュですり抜けた敵を 1 回のダッシュで 1 度だけ斬る", () => {
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

  it("従魔はすり抜けても斬らない", () => {
    const state = arena();
    give(state, "passCut");
    const e = dummy(state, 0);
    e.allyUntil = state.time + 10;
    state.player.dashTimer = 0.2;
    onBoonDash(state);
    updateBoonRules(state, DT);
    expect(e.hp).toBe(BIG_HP);
  });
});

describe("祝福の威力は装備に比例する", () => {
  it("slashBase は近接の性質で伸びる", () => {
    const plain = arena();
    const strong = arena(5, { increased: increasedWith({ melee: 1 }) });
    expect(slashBase(strong)).toBeGreaterThan(slashBase(plain));
  });
});

describe("条件 targetRoamer の撃破の記録", () => {
  it("徘徊の敵を倒すと roamerKillMemory 秒だけ徘徊として覚えている", () => {
    const state = arena();
    const e = dummy(state);
    e.roomIndex = ROAMING_ROOM;
    e.hp = 0;
    onBoonKill(state, e);
    expect(isRoamerTarget(state, e.id)).toBe(true);
    updateBoonRules(state, BOON.roamerKillMemory + 0.01);
    expect(isRoamerTarget(state, e.id), "忘れる").toBe(false);
  });
});

describe("祝福の起点: 本体の経路でイベントが積まれる", () => {
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
    applyStatus(state, { kind: "enemy", enemy: e }, { kind: "freeze", stacks: 1, duration: 1, potency: 1 }, "player");
    dropEvents(state);
    damageEnemy(state, e, 5, { x: 1, y: 0 }, 0);
    const ev = state.events.find((x) => x.kind === "onShatter");
    expect(ev?.targetId, "砕かれた敵").toBe(e.id);
  });

  it("会心のイベントは与えたダメージを量に持つ", () => {
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
    applyStatus(state, { kind: "enemy", enemy: e }, { kind: "vulnerable", stacks: 1, duration: 2, potency: 1 }, "player");
    dropEvents(state);
    pushKillEvents(state, e);
    const ev = state.events.find((x) => x.kind === "onKill");
    expect(ev?.targetElite, "精鋭の写し").toBe(true);
    expect(ev?.targetStatus?.find((s) => s.kind === "vulnerable")?.time, "残り秒の写し").toBeCloseTo(2);
  });
});

describe("芯の祝福（boonCores.ts）", () => {
  it("芯は 4 種で格を持たず、ownedCore が持っている芯を返す", () => {
    const cores = BOON_KEYS.filter((k) => BOONS[k].core === true);
    expect(cores, "芯").toEqual(["coreCurseEater", "coreTempo", "coreBloodLoop", "coreMirage"]);
    for (const k of cores) expect(BOONS[k].graded, `${k} は格を持たない`).toBe(false);
    const state = arena();
    expect(ownedCore(state), "持っていなければ null").toBeNull();
    give(state, "coreMirage");
    expect(ownedCore(state)?.key).toBe("coreMirage");
  });

  it("血の巡りの間はハートを拾えない", () => {
    const state = arena();
    give(state, "coreBloodLoop");
    state.player.hp = 1;
    state.pickups.push({ id: allocId(state), kind: "heart", pos: { ...state.player.body.pos }, radius: 6, bobTime: 0 });
    step(state, withInput({}), FIXED_DT);
    expect(state.pickups.some((pk) => pk.kind === "heart"), "ハートは残る").toBe(true);
    expect(state.player.hp, "回復しない").toBe(1);
  });

  it("呪い喰いは 3 択に必ず呪い付きが 1 枚混ざり、呪い付きの数だけ格の確率が上がる", () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const state = arena(seed);
      give(state, "coreCurseEater");
      const options = rollBoonOptions(state);
      expect(options.some((k) => BOONS[k].cursed), `seed ${seed} に呪い付き`).toBe(true);
    }
    const state = arena();
    give(state, "coreCurseEater");
    expect(coreGradeShift(state), "呪い付きが無ければ加算なし").toBe(0);
    give(state, "bloodSoil");
    expect(coreGradeShift(state), "呪い付き 1 つ").toBeCloseTo(BOON.curseEaterGradeShiftPerCurse);
    give(state, "singleMind", "scorchBlade", "madBloom");
    expect(coreGradeShift(state), "上限で止まる").toBeCloseTo(BOON.curseEaterMaxShift);
    expect(coreKeepsCurses(state), "呪い付きを手放せない").toBe(true);
  });
});

describe("スキルの加護が全スロットへ足す刻印符（BoonDef.grantsModifier）", () => {
  it("木霊を持つと、付けられるスロットに反響の符が足され、手放すと消える", () => {
    const state = arena();
    equipTwo(state, "boon-echo");
    expect(boonGrantedModifiers(state), "持つ前").toEqual([]);
    grantBoon(state, "echoCall");
    expect(boonGrantedModifiers(state)).toEqual(["echo"]);
    for (const slot of [0, 1]) {
      const stone = stoneInSlot(state.skills.profile, slot);
      if (!stone) throw new Error("石が無い");
      const attachable = canAttach(SKILL_DEFS[stone.skillKey], "echo");
      const keys = effectiveSlotModifiers(state.skills, slot, boonGrantedModifiers(state));
      expect(keys.includes("echo"), `スロット ${slot}（付けられる: ${attachable}）`).toBe(attachable);
    }
    syncSlotModifiers(state.skills, boonGrantedModifiers(state));
    expect(state.skills.slots.some((s) => s.modifiers.includes("echo")), "スロットの符に入る").toBe(
      [0, 1].some((i) => {
        const stone = stoneInSlot(state.skills.profile, i);
        return stone !== null && stone !== undefined && canAttach(SKILL_DEFS[stone.skillKey], "echo");
      }),
    );
    state.boons = [];
    syncSlotModifiers(state.skills, boonGrantedModifiers(state));
    expect(state.skills.slots.some((s) => s.modifiers.includes("echo")), "手放すと消える").toBe(false);
  });

  it("石の無いスロットには足さない", () => {
    const state = arena();
    state.skills.profile = { ...state.skills.profile, loadout: [null, null, null, null] };
    expect(effectiveSlotModifiers(state.skills, 0, ["echo"])).toEqual([]);
  });
});

describe("従魔（眷属。Enemy.allyUntil）の除外", () => {
  it("従魔はプレイヤーの攻撃で傷つかず、範囲の列挙にも入らない。期限が切れれば敵に戻る", () => {
    const state = arena();
    const e = dummy(state);
    e.allyUntil = state.time + 10;
    damageEnemy(state, e, 50, { x: 1, y: 0 }, 0);
    expect(e.hp, "傷つかない").toBe(BIG_HP);
    expect(enemiesInRadius(state, e.body.pos, 10).includes(e), "範囲に入らない").toBe(false);
    e.allyUntil = state.time - 1;
    damageEnemy(state, e, 50, { x: 1, y: 0 }, 0);
    expect(e.hp, "期限切れは敵として傷つく").toBeLessThan(BIG_HP);
    expect(enemiesInRadius(state, e.body.pos, 10).includes(e)).toBe(true);
  });
});
