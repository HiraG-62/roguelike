import { describe, expect, it } from "vitest";
import { type Enemy, type GameState, type Projectile, allocId } from "../core/state";
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
  onBoonCrit,
  onBoonDash,
  onBoonDashEnd,
  onBoonJust,
  onBoonKill,
  onBoonMeleeHit,
  onBoonRoomClear,
  onBoonRoomLock,
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
  onBoonHurt,
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
    onBoonMeleeHit(state, a);
    expect(hasStatus(a.status, "burn"), "1 段目は付けない").toBe(false);
    swing(state, LAST);
    onBoonMeleeHit(state, b);
    expect(hasStatus(b.status, "burn"), "3 段目は燃焼").toBe(true);
  });

  it("延焼: 燃焼中の敵に当てると周囲へ燃焼が移る。ICD の間は移らない", () => {
    const state = arena();
    give(state, "wildfire");
    const a = dummy(state);
    const b = dummy(state, 40);
    applyBurn(state, a, 5, 3);
    swing(state, 0);
    onBoonMeleeHit(state, a);
    expect(hasStatus(b.status, "burn")).toBe(true);
    removeStatus(state, { kind: "enemy", enemy: b }, "burn");
    onBoonMeleeHit(state, a);
    expect(hasStatus(b.status, "burn"), "ICD 中は移らない").toBe(false);
    updateBoonRules(state, BOON.wildfireIcd + 0.01);
    onBoonMeleeHit(state, a);
    expect(hasStatus(b.status, "burn"), "ICD 明けで再び移る").toBe(true);
  });

  it("灰積もり: 燃える敵を倒すと灰が残り、踏むと次の近接 1 回が燃焼を付ける", () => {
    const state = arena();
    give(state, "ashBed");
    const dead = dummy(state, 30);
    applyBurn(state, dead, 5, 3);
    onBoonKill(state, dead);
    expect(state.boonRun.rules.ashes).toHaveLength(1);
    state.player.body.pos = { ...dead.body.pos };
    updateBoonRules(state, DT);
    expect(state.boonRun.rules.ashCharges, "灰を拾った").toBe(1);
    const target = dummy(state, 20, 20);
    swing(state, 0);
    onBoonMeleeHit(state, target);
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
    onBoonBurstKills(state, 0);
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
    damageEnemy(state, a, 5, { x: 1, y: 0 }, 0);
    expect(hasStatus(b.status, "freeze"), "連鎖して砕けた").toBe(false);
    expect(b.hp).toBeLessThan(BIG_HP);
  });

  it("永冬: ジャスト回避で周囲の敵が凍結する", () => {
    const state = arena();
    give(state, "eternalWinter");
    const e = dummy(state, 30);
    onBoonJust(state);
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
    onBoonMeleeHit(state, a);
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
    onBoonMeleeHit(state, e);
    expect(state.player.energy).toBe(0);
    state.player.mana = state.stats.maxMana;
    onBoonMeleeHit(state, e);
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
    onBoonJust(state);
    expect(pr.owner).toBe("player");
    expect(pr.kind).toBe("ranged");
  });

  it("睨み: ジャスト回避した攻撃の主が弱体になる", () => {
    const state = arena();
    give(state, "glare");
    const e = dummy(state);
    onBoonJust(state, e);
    expect(hasStatus(e.status, "weaken")).toBe(true);
  });

  it("見切り返し: ジャスト回避でダッシュの回数が 1 戻る", () => {
    const state = arena();
    give(state, "justReturn");
    state.player.dashChargesLeft = 0;
    onBoonJust(state);
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
    onBoonMeleeHit(state, a, false);
    onBoonMeleeHit(state, b, true);
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
    onBoonKill(state, dead);
    expect(hasStatus(near.status, "fear")).toBe(true);
  });

  it("狩り立て: 出血中の敵に近接を当てると恐怖", () => {
    const state = arena();
    give(state, "huntBleed");
    const e = dummy(state);
    swing(state, 0);
    onBoonMeleeHit(state, e);
    expect(hasStatus(e.status, "fear"), "出血なしでは付かない").toBe(false);
    put(state, e, "bleed", 3, 1, 1);
    onBoonMeleeHit(state, e);
    expect(hasStatus(e.status, "fear")).toBe(true);
  });

  it("見定め: 1・2 段目を同じ敵に当てると 3 段目は必ず会心", () => {
    const state = arena();
    give(state, "appraise");
    const e = dummy(state);
    const other = dummy(state, 40);
    swing(state, 0);
    onBoonMeleeHit(state, e);
    swing(state, 1);
    onBoonMeleeHit(state, e);
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
    onBoonMeleeHit(state, e);
    expect(burn.time).toBeCloseTo(1 + BOON.embersExtend);
    burn.time = burn.maxTime - 0.1;
    onBoonMeleeHit(state, e);
    expect(burn.time).toBeCloseTo(burn.maxTime);
  });

  it("片翼: 射撃できない代わりに 3 段目で弾が扇状に出る", () => {
    const state = arena();
    give(state, "oneWing");
    expect(boonBlocksShoot(state)).toBe(true);
    state.player.attack.dir = { x: 1, y: 0 };
    onBoonSwing(state, LAST, false, 10);
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
    onBoonKill(state, e);
    expect(state.player.dashChargesLeft).toBe(state.stats.dashCharges);
  });

  it("血裂き: 出血 3 の敵への会心で出血を消費し、その分を即時に与える", () => {
    const state = arena();
    give(state, "laceration");
    const e = dummy(state);
    put(state, e, "bleed", 4, 3, 1);
    const stacks = statusStacks(e.status, "bleed");
    const potency = findStatus(e.status, "bleed")?.potency ?? 0;
    onBoonCrit(state, e, 10);
    expect(hasStatus(e.status, "bleed")).toBe(false);
    expect(BIG_HP - e.hp).toBe(Math.round(stacks * potency * BOON.lacerationUnits));
  });

  it("綻び広げ: 脆弱の敵が死ぬと最も近い敵へ脆弱が移る", () => {
    const state = arena();
    give(state, "frayWiden");
    const dead = dummy(state);
    const near = dummy(state, 50);
    put(state, dead, "vulnerable", 3);
    onBoonKill(state, dead);
    expect(hasStatus(near.status, "vulnerable")).toBe(true);
  });

  it("見逃さぬ: 敵を怯ませるとマナが 8 戻る", () => {
    const state = arena();
    give(state, "keenEye");
    state.player.mana = 0;
    onBoonStagger(state, dummy(state));
    expect(state.player.mana).toBeCloseTo(BOON.keenEyeMana * state.stats.manaGainMul);
  });

  it("崩し連鎖: 怯ませると同じ部屋で怯み値が溜まっている敵にさらに溜まる", () => {
    const state = arena();
    give(state, "collapseChain");
    const a = dummy(state);
    const b = dummy(state, 40);
    b.roomIndex = a.roomIndex;
    b.poise.damage = 1;
    onBoonStagger(state, a);
    expect(b.poise.damage).toBeGreaterThan(1);
  });

  it("立て直し狩り: 堅守中の敵を倒すと必殺ゲージが 30% 溜まる", () => {
    const state = arena();
    give(state, "regroupHunt");
    const e = dummy(state);
    put(state, e, "guarded", 2);
    state.player.energy = 0;
    onBoonKill(state, e);
    expect(state.player.energy).toBeCloseTo(state.player.maxEnergy * BOON.regroupEnergyRatio);
  });

  it("力の簒奪: 弱体の敵を倒すと次の近接 1 回の怯み値が 2 倍", () => {
    const state = arena();
    give(state, "usurp");
    const dead = dummy(state);
    const e = dummy(state, 40);
    put(state, dead, "weaken", 3);
    onBoonKill(state, dead);
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
    onBoonHurt(state, e);
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
    onBoonBurstKills(state, 0);
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
    onBoonKill(state, dummy(state));
    expect(p.hp).toBeCloseTo(p.maxHp - 10);
    expect(p.regainPool).toBe(0);
  });

  it("死神の影: 死神が出ている間の撃破でマナと必殺ゲージ", () => {
    const state = arena();
    give(state, "reaperShadow");
    state.player.mana = 0;
    state.player.energy = 0;
    onBoonKill(state, dummy(state));
    expect(state.player.energy, "死神がいなければ何もない").toBe(0);
    state.reaper = { pos: { x: 0, y: 0 }, radius: 8, animTime: 0 };
    onBoonKill(state, dummy(state));
    expect(state.player.energy).toBe(BOON.reaperShadowEnergy);
    expect(state.player.mana).toBeGreaterThan(0);
  });

  it("時間稼ぎ: 制圧するたび死神の出現が 10 秒遅れ、階が変わると戻る", () => {
    const state = arena();
    give(state, "stallTime");
    const before = reaperAppearAfter(state);
    onBoonRoomClear(state);
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
    onBoonRoomClear(state, room);
    expect(state.boonChoice).toBeNull();
    room.kind = "challenge";
    onBoonRoomClear(state, room);
    expect(state.boonChoice?.options.length).toBeGreaterThan(0);
  });

  it("伏兵返し: 伏兵の部屋を制圧すると刻印符が落ちる", () => {
    const state = arena();
    give(state, "ambushReturn");
    const room = state.rooms[0];
    if (!room) throw new Error("部屋が無い");
    room.kind = "ambush";
    const before = state.skills.runes.length;
    onBoonRoomClear(state, room);
    expect(state.skills.runes.length).toBe(before + 1);
  });

  it("持ち越し: 制圧後は次の封鎖までコンボが時間切れしない", () => {
    const state = arena();
    give(state, "carryOver");
    state.combo.count = 5;
    onBoonRoomClear(state);
    state.combo.timer = 0.01;
    updateBoonRules(state, DT);
    expect(state.combo.timer).toBeCloseTo(FEEL.comboWindow + state.stats.comboWindowBonus);
    onBoonRoomLock(state, 0);
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
    onBoonKill(state, dummy(state));
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
    onBoonJust(state);
    expect(state.player.mana).toBe(state.stats.maxMana);
    state.player.mana = 0;
    onBoonKill(state, dummy(state));
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
    onBoonJust(state);
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
    onBoonKill(state, dead);
    expect(hasStatus(near.status, "bleed")).toBe(true);
    expect(hasStatus(near.status, "poison")).toBe(true);
  });

  it("雷爆走: ダッシュ終わりの爆発に感電 2 が乗る", () => {
    const state = arena();
    give(state, "dashBlast", "dashShock", "thunderBlast");
    const e = dummy(state, 10);
    onBoonDashEnd(state);
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
      onBoonKill(state, dummy(state));
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
    onBoonMeleeHit(state, e);
    expect(near.hp, "ゲージが空なら爆発しない").toBe(BIG_HP);
    onBoonBurstKills(state, 0);
    onBoonMeleeHit(state, e);
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
    onBoonJust(state);
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
    onBoonSwing(state, LAST, false, 10);
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
