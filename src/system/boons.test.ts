import { describe, expect, it } from "vitest";
import { createGame, step } from "../core/game";
import type { Enemy, GameState } from "../core/state";
import { BOON, BOSS, MANA, PLAYER } from "../data/tuning";
import { computeStats } from "../loot/stats";
import { DEFAULT_STATS } from "../loot/types";
import { TILE_SIZE, Tile, rectCenterPx } from "../map/grid";
import { SKILL_DEFS, resolveCast } from "../skills/data";
import { stoneFromSeed } from "../skills/generator";
import { skillHit } from "../skills/hit";
import type { CastParams, SkillKey } from "../skills/types";
import {
  BOONS,
  BOON_KEYS,
  type BoonKey,
  boonAttackManaMul,
  boonCardRect,
  boonWeight,
  equipmentTags,
  grantBoon,
  hasBoon,
  offerBoons,
  onBoonSkillCast,
  rollBoonOptions,
} from "./boons";
import { damageEnemy, damagePlayer } from "./combat";
import { buildFloor } from "./floor";
import { applyStats } from "./player";
import { castSlot, effectiveManaCost } from "./skills";
import { arena, placeEnemy, withInput } from "./testHelpers";

const FIXED_DT = 1 / 60;
/** 入力無視時間を確実に超えるステップ数 */
const WAIT_STEPS = Math.ceil(BOON.inputDelay / FIXED_DT) + 1;

function stairsPos(state: GameState): { x: number; y: number } {
  const i = state.map.tiles.findIndex((t) => t === Tile.StairsDown);
  if (i < 0) throw new Error("no stairs");
  const x = i % state.map.width;
  const y = Math.floor(i / state.map.width);
  return { x: (x + 0.5) * TILE_SIZE, y: (y + 0.5) * TILE_SIZE };
}

/** 階段に乗って depth 2 へ降り、3 択が出た状態 */
function arrivedAtDepth2(seed = 3): GameState {
  const state = createGame(seed);
  state.enemies = [];
  state.player.invulnTimer = 999;
  state.player.body.pos = stairsPos(state);
  step(state, withInput({}), FIXED_DT);
  return state;
}

function waitInputDelay(state: GameState): void {
  for (let i = 0; i < WAIT_STEPS; i++) step(state, withInput({}), FIXED_DT);
}

describe("祝福の提示タイミング", () => {
  it("階段で depth 2 に降りると 3 択が出て、選ぶまで他の更新が止まる", () => {
    const state = arrivedAtDepth2();
    expect(state.depth).toBe(2);
    expect(state.boonChoice?.options).toHaveLength(BOON.choiceCount);

    const pos = { ...state.player.body.pos };
    const time = state.time;
    for (let i = 0; i < 10; i++) step(state, withInput({ move: { x: 1, y: 0 } }), FIXED_DT);
    expect(state.player.body.pos).toEqual(pos);
    expect(state.time).toBe(time);
  });

  it("depth 1 では提示しない", () => {
    const state = createGame(1);
    offerBoons(state);
    expect(state.boonChoice).toBeNull();
  });

  it("提示直後の連打は無視し、inputDelay 後に 1/C で 1 枚目を取る", () => {
    const state = arrivedAtDepth2();
    const first = state.boonChoice?.options[0];
    step(state, withInput({ skill1Pressed: true }), FIXED_DT);
    expect(state.boonChoice).not.toBeNull();
    waitInputDelay(state);
    step(state, withInput({ skill1Pressed: true }), FIXED_DT);
    expect(state.boonChoice).toBeNull();
    expect(first && hasBoon(state, first)).toBe(true);
  });

  it("E は 3 枚目、カードのクリックはその札。カード外のクリックは無視", () => {
    const state = arrivedAtDepth2();
    waitInputDelay(state);
    step(state, withInput({ clickPressed: true, attackPressed: true, aimScreen: { x: 1, y: 1 } }), FIXED_DT);
    expect(state.boonChoice).not.toBeNull();

    const second = state.boonChoice?.options[1];
    const r = boonCardRect(1, BOON.choiceCount);
    const center = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
    step(state, withInput({ aimScreen: center }), FIXED_DT);
    expect(state.boonChoice?.hover).toBe(1);
    step(state, withInput({ clickPressed: true, attackPressed: true, aimScreen: center }), FIXED_DT);
    expect(second && hasBoon(state, second)).toBe(true);

    const other = arrivedAtDepth2(4);
    const third = other.boonChoice?.options[2];
    waitInputDelay(other);
    step(other, withInput({ attackPressed: true }), FIXED_DT);
    expect(third && hasBoon(other, third)).toBe(true);
  });

  it("パッド A（padConfirmPressed）は attackPressed も同時に立つが 1 枚目を選び、3 枚目にはならない", () => {
    const state = arrivedAtDepth2();
    const first = state.boonChoice?.options[0];
    waitInputDelay(state);
    // パッド A は GamepadFrame.attackPressed / confirmPressed の両方を justPressed(BTN_A) にする
    step(state, withInput({ attackPressed: true, padConfirmPressed: true }), FIXED_DT);
    expect(state.boonChoice).toBeNull();
    expect(first && hasBoon(state, first)).toBe(true);
  });
});

describe("抽選", () => {
  it("祝福は 24 種以上、呪い付きもある", () => {
    expect(BOON_KEYS.length).toBeGreaterThanOrEqual(24);
    expect(BOON_KEYS.some((k) => BOONS[k].cursed)).toBe(true);
  });

  it("3 枚は重複せず、取得済みは出ず、呪いは最大 1 枚。呪い枠はおよそ cursedChance で混ざる", () => {
    const state = arena(7);
    state.boons = ["dashGun", "secondWind"];
    const trials = 600;
    let withCursed = 0;
    for (let i = 0; i < trials; i++) {
      const options = rollBoonOptions(state);
      expect(options).toHaveLength(BOON.choiceCount);
      expect(new Set(options).size).toBe(options.length);
      expect(options).not.toContain("dashGun");
      expect(options).not.toContain("secondWind");
      const cursed = options.filter((k) => BOONS[k].cursed).length;
      expect(cursed).toBeLessThanOrEqual(1);
      if (cursed > 0) withCursed++;
    }
    const rate = withCursed / trials;
    expect(rate).toBeGreaterThan(BOON.cursedChance - 0.08);
    expect(rate).toBeLessThan(BOON.cursedChance + 0.08);
  });

  it("同じ seed なら同じ候補（state.rng で決定的）", () => {
    expect(rollBoonOptions(arena(9))).toEqual(rollBoonOptions(arena(9)));
  });

  it("装備タグで重みが変わる: burn 装備なら燃焼祝福が出る / 出やすい", () => {
    const plain = arena(11);
    const burn = arena(11, { burnChance: 0.3, burnDps: 5 });
    // createGame の applyStats が素の装備を baseStats に覚えるので、抽選が読む装備 stats も差し替える
    burn.boonRun.baseStats = burn.stats;
    expect(equipmentTags(plain.stats).has("burn")).toBe(false);
    expect(equipmentTags(burn.stats).has("burn")).toBe(true);

    const noTags = equipmentTags(plain.stats);
    const burnTags = equipmentTags(burn.stats);
    // requires: burn の祝福は burn 装備が無いと出ない
    expect(boonWeight(BOONS.burnSpread, noTags, [])).toBe(0);
    expect(boonWeight(BOONS.burnSpread, burnTags, [])).toBeGreaterThan(0);
    // タグ一致で重みが上がる
    expect(boonWeight(BOONS.heartBurn, burnTags, [])).toBeGreaterThan(BOON.rarityWeight.common);

    const count = (state: GameState): number => {
      let n = 0;
      for (let i = 0; i < 300; i++) {
        if (rollBoonOptions(state).some((k) => BOONS[k].tags.includes("burn"))) n++;
      }
      return n;
    };
    expect(count(burn)).toBeGreaterThan(count(plain));
  });

  it("dash 系キーストーン / トリガーでもタグが付く", () => {
    const tags = equipmentTags({
      ...DEFAULT_STATS,
      keystones: ["ks_blink"],
      triggers: [{ trigger: "onJustDodge", condition: "always", effect: "explode", magnitude: 10, chance: 1 }],
    });
    expect(tags.has("dash")).toBe(true);
    expect(tags.has("explode")).toBe(true);
    expect(tags.has("just")).toBe(true);
  });
});

describe("ルール変更の実効", () => {
  it("finisherOnly: 斬撃が 3 段目から始まる", () => {
    const state = arena();
    grantBoon(state, "finisherOnly");
    step(state, withInput({ attackPressed: true }), FIXED_DT);
    expect(state.player.attack.phase).not.toBe("none");
    expect(state.player.attack.combo).toBe(PLAYER.melee.length - 1);
  });

  it("dashGun: ダッシュ中に射撃できる（無ければ撃てない）", () => {
    const shoot = (boon: BoonKey | null): number => {
      const state = arena();
      if (boon) grantBoon(state, boon);
      step(state, withInput({ dashPressed: true, shootHeld: true }), FIXED_DT);
      expect(state.player.dashTimer).toBeGreaterThan(0);
      return state.projectiles.filter((p) => p.owner === "player").length;
    };
    expect(shoot(null)).toBe(0);
    expect(shoot("dashGun")).toBeGreaterThan(0);
  });

  it("secondWind: ランに 1 回だけ HP 30% で復活する", () => {
    const state = arena();
    grantBoon(state, "secondWind");
    damagePlayer(state, 9999, { x: 0, y: 0 });
    expect(state.status).toBe("playing");
    expect(state.player.hp).toBe(Math.round(state.player.maxHp * BOON.reviveHpRatio));

    state.player.invulnTimer = 0;
    damagePlayer(state, 9999, { x: 0, y: 0 });
    expect(state.status).toBe("dead");
  });

  it("glassJust: 最大 HP が 1、ダッシュ後も JUST が取れる窓が伸びる", () => {
    const state = arena();
    grantBoon(state, "glassJust");
    expect(state.player.maxHp).toBe(1);
    step(state, withInput({ dashPressed: true }), FIXED_DT);
    // ダッシュ時間が過ぎても延長窓の中なら JUST 回避になる
    state.player.dashTimer = 0;
    expect(damagePlayer(state, 10, { x: 0, y: 0 })).toBe("dodged");
  });

  it("comboKeeper: 被弾でコンボが半分残る", () => {
    const state = arena();
    grantBoon(state, "comboKeeper");
    state.combo.count = 10;
    state.combo.timer = 1;
    damagePlayer(state, 1, { x: 0, y: 0 });
    expect(state.combo.count).toBe(5);
  });

  it("justWipe: JUST 回避で敵弾が全部消える", () => {
    const state = arena();
    grantBoon(state, "justWipe");
    const p = state.player.body.pos;
    for (let i = 0; i < 3; i++) {
      state.projectiles.push({
        id: 100 + i,
        owner: "enemy",
        pos: { x: p.x + 80, y: p.y + i * 10 },
        vel: { x: 0, y: 0 },
        radius: 2,
        damage: 5,
        life: 5,
        color: "#fff",
        kind: "ranged",
        hitIds: new Set(),
        pierceLeft: 0,
      });
    }
    step(state, withInput({ dashPressed: true }), FIXED_DT);
    expect(damagePlayer(state, 5, { x: 0, y: 0 })).toBe("dodged");
    expect(state.projectiles.filter((pr) => pr.owner === "enemy" && pr.life > 0)).toHaveLength(0);
  });

  it("eliteVault: エリート撃破の次の階に宝物庫が確定する", () => {
    const state = arena();
    grantBoon(state, "eliteVault");
    state.boonRun.vaultNext = true;
    buildFloor(state);
    expect(state.rooms.some((r) => r.kind === "treasure")).toBe(true);
    expect(state.boonRun.vaultNext).toBe(false);
  });

  it("数値系は装備変更（applyStats）後も残る: clearHeal の最大 HP -30%", () => {
    const state = arena();
    grantBoon(state, "clearHeal");
    expect(state.player.maxHp).toBe(Math.round(DEFAULT_STATS.maxHp * BOON.clearHealMaxHpMul));
    applyStats(state, computeStats(state.profile.equipment));
    expect(state.player.maxHp).toBe(Math.round(DEFAULT_STATS.maxHp * BOON.clearHealMaxHpMul));
  });

  it("giantSlayer: 取った階に配置済みのボス / 通常敵にも遡って掛かる", () => {
    const state = createGame(11);
    state.depth = BOSS.interval;
    buildFloor(state);
    const bossId = state.boss?.enemyId;
    const boss = state.enemies.find((e) => e.id === bossId);
    const mob = state.enemies.find((e) => e.id !== bossId && e.hp > 0);
    if (!boss || !mob) throw new Error("boss floor without enemies");
    const bossHp = boss.maxHp;
    const mobHp = mob.maxHp;
    grantBoon(state, "giantSlayer");
    expect(boss.maxHp).toBe(Math.max(1, Math.round(bossHp * BOON.bossHpMul)));
    expect(mob.maxHp).toBe(Math.max(1, Math.round(mobHp * BOON.mobHpMul)));
  });

  it("triggerHappy: 近接できない代わりに連射 2 倍", () => {
    const state = arena();
    grantBoon(state, "triggerHappy");
    expect(state.stats.fireRateMul).toBe(DEFAULT_STATS.fireRateMul * BOON.triggerHappyFireMul);
    step(state, withInput({ attackPressed: true }), FIXED_DT);
    expect(state.player.attack.phase).toBe("none");
  });
});

describe("無効化手段の祝福化（docs/COMBAT_DESIGN.md C-1）", () => {
  it("弾返し・見切り斬りは呪いなしの祝福で、旧 parryCharge は無い", () => {
    expect(BOONS.reflect.cursed).toBe(false);
    expect(BOONS.justSlash.cursed).toBe(false);
    expect(BOONS.justSlash.rarity).toBe("rare");
    expect((BOON_KEYS as readonly string[]).includes("parryCharge"), "弾斬り充填は弾返しに置き換わった").toBe(false);
  });

  it("どちらも初期状態では持っていない", () => {
    const state = arena();
    expect(hasBoon(state, "reflect")).toBe(false);
    expect(hasBoon(state, "justSlash")).toBe(false);
  });
});

describe("マナ系の祝福（ルールでマナの回し方を変える）", () => {
  const BIG_HP = 100000;
  const KILL_DAMAGE = BIG_HP * 2;
  const SAMPLE_COST = 20;

  /** 攻撃しない動かない敵（HP を大きくして skillHit で倒さない） */
  function dummy(state: GameState, dx = 20, key = "golem"): Enemy {
    const e = placeEnemy(state, key, dx);
    e.hp = BIG_HP;
    e.maxHp = BIG_HP;
    e.phase = "idle";
    return e;
  }

  function paramsFor(key: SkillKey): CastParams {
    const stone = { ...stoneFromSeed(1, { foundDepth: 1, now: 0, skillKey: key }), variants: [], links: 0 };
    return resolveCast(SKILL_DEFS[key], stone, []);
  }

  const hitSpec = { base: 1, kind: "ranged" as const, dir: { x: 1, y: 0 }, knockback: 0, stagger: false };

  it("湧水: 部屋を制圧するとマナが満タンになる", () => {
    const clearWith = (boon: BoonKey | null): { mana: number; max: number } => {
      const state = createGame(11);
      if (boon) grantBoon(state, boon);
      const room = state.rooms[1]!;
      state.player.body.pos = rectCenterPx(room.rect);
      step(state, withInput({}), FIXED_DT);
      expect(room.locked, "入ると封鎖される").toBe(true);
      for (const e of state.enemies) if (e.roomIndex === 1) e.hp = 0;
      state.player.mana = 0;
      step(state, withInput({}), FIXED_DT);
      expect(room.cleared, "敵が全滅すれば制圧").toBe(true);
      return { mana: state.player.mana, max: state.stats.maxMana };
    };
    const withBoon = clearWith("springWell");
    expect(withBoon.mana, "制圧で満タン").toBe(withBoon.max);
    expect(clearWith(null).mana, "祝福が無ければ満タンにならない").toBeLessThan(withBoon.max);
  });

  it("血の対価: HP 50% 以下の間だけスキルのコストが -40%", () => {
    const state = arena();
    grantBoon(state, "bloodMana");
    const p = state.player;
    expect(effectiveManaCost(state, SAMPLE_COST).cost, "HP 満タンでは下がらない").toBeCloseTo(SAMPLE_COST);
    p.hp = Math.floor(p.maxHp * BOON.bloodManaHpRatio);
    expect(effectiveManaCost(state, SAMPLE_COST).cost, "HP 50% 以下で下がる").toBeCloseTo(SAMPLE_COST * BOON.bloodManaCostMul);
  });

  it("血の対価: 装備の軽減と掛け合わせても下限 MANA.costMulMin を割らない", () => {
    const state = arena();
    grantBoon(state, "bloodMana");
    applyStats(state, { ...DEFAULT_STATS, manaCostMul: 0.5 });
    state.player.hp = 1;
    expect(effectiveManaCost(state, SAMPLE_COST).cost).toBeCloseTo(SAMPLE_COST * MANA.costMulMin);
  });

  it("屠りの盃: 撃破でマナ +10、代わりに自然回復が半分", () => {
    const killGain = (boon: BoonKey | null): number => {
      const state = arena();
      if (boon) grantBoon(state, boon);
      const e = dummy(state, 20, "slime");
      state.player.mana = 0;
      expect(damageEnemy(state, e, KILL_DAMAGE, { x: 1, y: 0 }, 0), "倒せる").toBe(true);
      return state.player.mana;
    };
    expect(killGain("reaperCup") - killGain(null), "撃破で追加のマナ").toBeCloseTo(BOON.reaperCupKillMana);

    const state = arena();
    grantBoon(state, "reaperCup");
    expect(state.stats.manaRegen, "自然回復が半分").toBeCloseTo(DEFAULT_STATS.manaRegen * BOON.reaperCupRegenMul);
  });

  it("見切りの息: ジャスト回避でマナ +25（通常の回収に加算）", () => {
    const justGain = (boon: BoonKey | null): number => {
      const state = arena();
      if (boon) grantBoon(state, boon);
      const e = dummy(state, 60);
      const p = state.player;
      p.mana = 0;
      p.dashTimer = PLAYER.dash.time;
      p.invulnTimer = PLAYER.dash.time;
      p.dodgedThisDash = false;
      expect(damagePlayer(state, 10, e.body.pos, e), "ジャスト回避になる").toBe("dodged");
      return p.mana;
    };
    expect(justGain("keenBreath") - justGain(null)).toBeCloseTo(BOON.keenBreathJustMana);
  });

  it("循環: スキル命中ごとにマナ +2、1 回の発動で +8 まで。次の発動でまた戻る", () => {
    const state = arena();
    grantBoon(state, "circulation");
    const e = dummy(state);
    const params = paramsFor("railshot");
    state.player.mana = 0;
    onBoonSkillCast(state);
    skillHit(state, e, params, hitSpec);
    expect(state.player.mana, "1 ヒットで +2").toBeCloseTo(BOON.circulationPerHit);
    for (let i = 0; i < 10; i++) skillHit(state, e, params, hitSpec);
    expect(state.player.mana, "多段ヒットでも 1 発動の上限で止まる").toBeCloseTo(BOON.circulationCap);
    onBoonSkillCast(state);
    skillHit(state, e, params, hitSpec);
    expect(state.player.mana, "次の発動では上限が戻る").toBeCloseTo(BOON.circulationCap + BOON.circulationPerHit);
  });

  it("循環: 祝福が無ければスキル命中でマナは増えない", () => {
    const state = arena();
    const e = dummy(state);
    state.player.mana = 0;
    onBoonSkillCast(state);
    skillHit(state, e, paramsFor("railshot"), hitSpec);
    expect(state.player.mana).toBe(0);
  });

  it("循環: castSlot での発動が還元量を数え直す", () => {
    const state = arena();
    grantBoon(state, "circulation");
    state.boonRun.circulationGained = BOON.circulationCap;
    state.player.mana = state.stats.maxMana;
    const cast = castSlot(state, 0, withInput({}));
    expect(cast, "初期スロットのスキルが撃てる").toBe(true);
    expect(state.boonRun.circulationGained, "発動でリセット").toBeLessThan(BOON.circulationCap);
  });

  it("虚ろの器: コスト -35%・最大マナ -40%・通常攻撃のマナ回収が半分", () => {
    const state = arena();
    state.player.mana = DEFAULT_STATS.maxMana;
    grantBoon(state, "hollowVessel");
    expect(BOONS.hollowVessel.cursed, "呪い付き").toBe(true);
    expect(state.stats.maxMana).toBe(Math.round(DEFAULT_STATS.maxMana * BOON.hollowVesselMaxManaMul));
    expect(state.player.mana, "今のマナも新しい上限に収まる").toBeLessThanOrEqual(state.stats.maxMana);
    expect(effectiveManaCost(state, SAMPLE_COST).cost).toBeCloseTo(SAMPLE_COST * BOON.hollowVesselCostMul);
    expect(boonAttackManaMul(state)).toBeCloseTo(BOON.hollowVesselAttackManaMul);
  });

  it("最大マナは重ね掛けで 0 にならず、スキルのコストも 0 にならない", () => {
    const state = arena();
    grantBoon(state, "hollowVessel");
    // 涸れ井戸の性質の重ね掛け・精神低下で装備側が 0 まで落ちた状態
    applyStats(state, { ...DEFAULT_STATS, maxMana: 0 });
    expect(state.stats.maxMana, "下限で止まる").toBe(MANA.maxMin);
    expect(effectiveManaCost(state, SAMPLE_COST).cost, "コストは 0 に切り詰められない").toBeGreaterThan(0);
  });

  it("虚ろの器と霊刃の通常攻撃マナ倍率は掛け合わせる", () => {
    const state = arena();
    grantBoon(state, "hollowVessel");
    grantBoon(state, "spiritBlade");
    expect(boonAttackManaMul(state)).toBeCloseTo(BOON.hollowVesselAttackManaMul * BOON.spiritBladeManaMul);
  });

  it("マナの性質を持つ装備は mana タグになり、マナ系の祝福が出やすい", () => {
    expect(equipmentTags(DEFAULT_STATS).has("mana"), "基礎値では付かない").toBe(false);
    const tags = equipmentTags({ ...DEFAULT_STATS, manaRegen: DEFAULT_STATS.manaRegen + 1 });
    expect(tags.has("mana")).toBe(true);
    expect(boonWeight(BOONS.reaperCup, tags, [])).toBeGreaterThan(boonWeight(BOONS.reaperCup, new Set(), []));
  });

  it("追加した 6 つはすべて mana タグを持つ", () => {
    const keys: BoonKey[] = ["springWell", "bloodMana", "reaperCup", "keenBreath", "circulation", "hollowVessel"];
    for (const k of keys) expect(BOONS[k].tags, k).toContain("mana");
  });
});
