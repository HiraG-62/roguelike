import { describe, expect, it } from "vitest";
import { createGame, step } from "../core/game";
import type { GameState } from "../core/state";
import { BOON, BOON_LINEAGE, BOSS, MANA, PLAYER } from "../data/tuning";
import { computeStats } from "../loot/stats";
import { DEFAULT_STATS } from "../loot/types";
import { TILE_SIZE, Tile } from "../map/grid";
import { SKILL_DEFS } from "../skills/data";
import { stoneFromSeed } from "../skills/generator";
import {
  BOONS,
  BOON_KEYS,
  type BoonKey,
  type BoonTag,
  boonCardRect,
  boonCurseRect,
  boonGivenTags,
  boonHeartsAllowed,
  boonWeight,
  buildTags,
  canTakeCurse,
  canTemper,
  choiceCardCount,
  choiceGrade,
  chooseBoon,
  graceSlotsOf,
  gracesOf,
  offerTemper,
  removeBoon,
  rollLineageOptions,
  temperCandidates,
  equipmentTags,
  grantBoon,
  hasBoon,
  isSiblingBoon,
  offerBoons,
  rollBoonOptions,
  skillStoneTags,
  takeCurse,
  updateBoonChoice,
} from "./boons";
import { VIEW_W } from "../core/view";
import { damagePlayer } from "./combat";
import { buildFloor } from "./floor";
import { applyStats } from "./player";
import { resolveRules } from "./rules";
import { createRng } from "../core/rng";
import { pushPlayerEvent } from "../core/events";
import {
  type BoonGrade,
  boonGradeOf,
  clampGrade,
  gradeChances,
  gradeIcdMul,
  gradeMagnitudeMul,
  gradedIcd,
  isGraded,
  rollGrade,
} from "./boonGrade";
import { clearSpecialRoom } from "./specialRooms";
import { effectiveManaCost } from "./skills";
import { arena, increasedWith, placeEnemy, slayFloorLord, withInput } from "./testHelpers";

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
  // 毎階の最後の部屋に出る「階の主」を倒して階段を出してから、他の敵は消す
  slayFloorLord(state);
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
  it("祝福は 9 系譜 × 11 + 融合 12 + 呪い付き 6 + 芯 4 = 121 種", () => {
    expect(BOON_KEYS).toHaveLength(121);
    expect(new Set(BOON_KEYS).size, "key は重複しない").toBe(BOON_KEYS.length);
    expect(BOON_KEYS.filter((k) => BOONS[k].fusion !== undefined)).toHaveLength(12);
    expect(BOON_KEYS.filter((k) => BOONS[k].cursed)).toHaveLength(6);
    expect(BOON_KEYS.filter((k) => BOONS[k].core === true)).toHaveLength(4);
  });

  it("3 枚は重複せず、取得済みは出ず、呪いは最大 1 枚。呪い枠はおよそ cursedChance で混ざる", () => {
    const state = arena(7);
    state.boons = ["emberSeed", "frostBreath"];
    const trials = 600;
    let withCursed = 0;
    for (let i = 0; i < trials; i++) {
      const options = rollBoonOptions(state);
      expect(options).toHaveLength(BOON.choiceCount);
      expect(new Set(options).size).toBe(options.length);
      expect(options).not.toContain("emberSeed");
      expect(options).not.toContain("frostBreath");
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
    // タグ一致で重みが上がる（基礎は札の種類の重み）
    expect(boonWeight(BOONS.wildfire, noTags, []), "摂理の基礎の重み").toBeCloseTo(BOON.cardWeight.law);
    expect(boonWeight(BOONS.wildfire, burnTags, [])).toBeGreaterThan(boonWeight(BOONS.wildfire, noTags, []));

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

  it("トリガー効果 inflict の状態異常もタグになる（毒を付けるトリガーだけで requires: poison を満たす）", () => {
    const tags = equipmentTags({
      ...DEFAULT_STATS,
      triggers: [{ trigger: "onMeleeHit", condition: "always", effect: "inflict", magnitude: 1, chance: 1, status: "poison" }],
    });
    expect(tags.has("poison"), "毒のタグ").toBe(true);
    expect(tags.has("bleed"), "付けない種類のタグは付かない").toBe(false);
  });
});

describe("残した旧フックと常時の stats", () => {
  it("専心（finisherOnly）: 斬撃が 3 段目から始まる", () => {
    const state = arena();
    grantBoon(state, "finisherOnly");
    step(state, withInput({ attackPressed: true }), FIXED_DT);
    expect(state.player.attack.phase).not.toBe("none");
    expect(state.player.attack.combo).toBe(PLAYER.melee.length - 1);
  });

  it("不断（comboKeeper）: 被弾でコンボが半分残る", () => {
    const state = arena();
    grantBoon(state, "comboKeeper");
    state.combo.count = 10;
    state.combo.timer = 1;
    damagePlayer(state, 1, { x: 0, y: 0 });
    expect(state.combo.count).toBe(5);
  });

  it("宝物庫の予約（Rule 効果 reserveVault）があれば次の階に宝物庫が確定する", () => {
    const state = arena();
    state.boonRun.vaultNext = true;
    buildFloor(state);
    expect(state.rooms.some((r) => r.kind === "treasure")).toBe(true);
    expect(state.boonRun.vaultNext).toBe(false);
  });

  it("常時の stats（BoonDef.addStats）は装備変更（applyStats）後も残る: 還雷の連鎖の戻り", () => {
    const state = arena();
    const base = state.stats.chainRevisits;
    grantBoon(state, "thunderReturn");
    const added = BOONS.thunderReturn.addStats?.chainRevisits ?? 0;
    expect(added, "還雷は戻りを足す").toBeGreaterThan(0);
    expect(state.stats.chainRevisits).toBe(base + added);
    applyStats(state, computeStats(state.profile.equipment));
    expect(state.stats.chainRevisits, "畳み直しても残る").toBe(base + added);
    removeBoon(state, "thunderReturn");
    expect(state.stats.chainRevisits, "手放すと戻る").toBe(base);
  });

  it("血の饗宴を持つとハートが出ない", () => {
    const state = arena();
    expect(boonHeartsAllowed(state)).toBe(true);
    grantBoon(state, "bloodFeast");
    expect(boonHeartsAllowed(state)).toBe(false);
  });
});

describe("気力の祝福（血の対価・気力の下限・タグ）", () => {
  const SAMPLE_COST = 20;

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

  it("最大気力は装備で 0 まで落ちても下限で止まり、スキルのコストも 0 にならない", () => {
    const state = arena();
    applyStats(state, { ...DEFAULT_STATS, maxMana: 0 });
    expect(state.stats.maxMana, "下限で止まる").toBe(MANA.maxMin);
    expect(effectiveManaCost(state, SAMPLE_COST).cost, "コストは 0 に切り詰められない").toBeGreaterThan(0);
  });

  it("気力の性質を持つ装備は mana タグになり、気力の札が出やすい", () => {
    expect(equipmentTags(DEFAULT_STATS).has("mana"), "基礎値では付かない").toBe(false);
    const tags = equipmentTags({ ...DEFAULT_STATS, manaRegen: DEFAULT_STATS.manaRegen + 1 });
    expect(tags.has("mana")).toBe(true);
    expect(boonWeight(BOONS.circulation, tags, [])).toBeGreaterThan(boonWeight(BOONS.circulation, new Set(), []));
  });
});

describe("真髄と融合の抽選の条件（系譜の前段・結びの後継）", () => {
  const none = new Set<BoonTag>();

  it("真髄はその系譜の札（融合を含む）が apexMinCards 枚に届くまで重み 0", () => {
    const three: BoonKey[] = ["emberSeed", "wildfire", "burnSpread"];
    expect(three.length).toBe(BOON.apexMinCards - 1);
    expect(boonWeight(BOONS.ashInferno, none, three), "3 枚").toBe(0);
    expect(boonWeight(BOONS.ashInferno, none, [...three, "embers"]), "4 枚").toBeGreaterThan(0);
    expect(boonWeight(BOONS.ashInferno, none, [...three, "thunderBlast"]), "融合も数える").toBeGreaterThan(0);
  });

  it("融合は組の 2 系譜の加護が同じ行動に乗るまで重み 0", () => {
    expect(boonWeight(BOONS.thunderBlast, none, ["fireWalk"]), "片方だけ").toBe(0);
    expect(boonWeight(BOONS.thunderBlast, none, ["fireWalk", "chargedBlade"]), "行動が違う").toBe(0);
    expect(boonWeight(BOONS.thunderBlast, none, ["fireWalk", "staticDash"]), "ダッシュに灰燼と雷鳴").toBeCloseTo(BOON.cardWeight.law * (1 + 0));
  });

  it("同じ系譜は 1 回の 3 択に 1 枚まで", () => {
    const state = arena(21, { burnChance: 0.3, burnDps: 5 });
    state.boonRun.baseStats = state.stats;
    state.boons = ["emberSeed", "wildfire", "frostBreath", "frostFeet", "staticDash", "moonRead"];
    for (let i = 0; i < 300; i++) {
      const lineages = rollBoonOptions(state)
        .map((k) => BOONS[k].lineage)
        .filter((l) => l !== undefined);
      expect(new Set(lineages).size, "系譜の重複なし").toBe(lineages.length);
    }
  });

  it("融合は 1 回の 3 択に 1 枚まで、揃えば出てくる", () => {
    const state = arena(23);
    state.boons = ["fireWalk", "staticDash", "frostBreath", "chargedBlade", "emberSeed"];
    let seen = 0;
    for (let i = 0; i < 300; i++) {
      const fusions = rollBoonOptions(state).filter((k) => BOONS[k].fusion !== undefined);
      expect(fusions.length, "融合は 1 枚まで").toBeLessThanOrEqual(1);
      seen += fusions.length;
    }
    expect(seen).toBeGreaterThan(0);
  });

  it("同じ 3 択に並べない組の判定（isSiblingBoon）", () => {
    expect(isSiblingBoon(BOONS.emberSeed, BOONS.wildfire), "同じ系譜").toBe(true);
    expect(isSiblingBoon(BOONS.thunderBlast, BOONS.winterNest), "融合同士").toBe(true);
    expect(isSiblingBoon(BOONS.emberSeed, BOONS.frostBreath)).toBe(false);
  });
});

describe("抽選の拡張: 出すタグとスキル石のタグ", () => {
  it("取得済み祝福が出すタグで、それを食う祝福の重みが上がる（装備の一致よりは小さい）", () => {
    const none = new Set<BoonTag>();
    const base = boonWeight(BOONS.embers, none, []);
    const fed = boonWeight(BOONS.embers, none, [], boonGivenTags(["emberSeed"]));
    const equipped = boonWeight(BOONS.embers, new Set<BoonTag>(["burn"]), []);
    expect(fed).toBeGreaterThan(base);
    expect(equipped).toBeGreaterThan(fed);
  });

  it("スキル石のタグ・資源・付ける状態異常を祝福タグとして読む", () => {
    const state = arena();
    const stone = { ...stoneFromSeed(3, { foundDepth: 1, now: 0, skillKey: "commonThunderclap" }), id: "boon-tag-thunder" };
    state.skills.profile = { ...state.skills.profile, stones: [stone], loadout: [stone.id, null, null, null] };
    const tags = skillStoneTags(state);
    expect(tags.has("skill")).toBe(true);
    expect(tags.has("shock"), "雷のスキルは shock").toBe(true);
    if (SKILL_DEFS.commonThunderclap.resource === "mana") expect(tags.has("mana")).toBe(true);
    expect(buildTags(state).owned.has("shock"), "抽選のタグに入る").toBe(true);
    state.skills.profile = { ...state.skills.profile, loadout: [null, null, null, null] };
    expect(skillStoneTags(state).size, "何も付けていなければ空").toBe(0);
  });

  it("スキル石のタグで対応する祝福が出やすくなる", () => {
    const count = (withStone: boolean): number => {
      const state = arena(31);
      // 銃の家系にしておく（射撃前提の祝福の loadout 判定で母集団が変わらないよう固定する）
      state.stats.moveset = "gunner";
      state.boonRun.baseStats = state.stats;
      const stone = { ...stoneFromSeed(3, { foundDepth: 1, now: 0, skillKey: "commonThunderclap" }), id: "boon-tag-thunder2" };
      const loadout = withStone ? [stone.id, null, null, null] : [null, null, null, null];
      state.skills.profile = { ...state.skills.profile, stones: [stone], loadout };
      let n = 0;
      for (let i = 0; i < 300; i++) if (rollBoonOptions(state).some((k) => BOONS[k].tags.includes("shock"))) n++;
      return n;
    };
    expect(count(true)).toBeGreaterThan(count(false));
  });
});

describe("弾を出せない武器種と ranged タグ（docs/ideas/weapon-redesign.md 6 章）", () => {
  it("指輪の射撃性質だけでは ranged タグが付かない", () => {
    const state = arena();
    state.stats.moveset = "sword";
    // 指輪・首飾りが乗せる射撃性質（弾を出せない武器種のまま）。遠距離スキル石は外して装備由来だけを見る
    state.stats.increased.ranged += 0.5;
    state.skills.profile = { ...state.skills.profile, loadout: [null, null, null, null] };
    state.boonRun.baseStats = state.stats;
    const tags = buildTags(state);
    expect(tags.owned.has("ranged"), "弾を出せない武器種では装備由来の ranged タグを外す").toBe(false);
  });

  it("遠距離スキル石を付けていれば、弾を出せない武器種でも ranged タグは残る", () => {
    const state = arena();
    state.stats.moveset = "sword";
    state.boonRun.baseStats = state.stats;
    const stone = { ...stoneFromSeed(7, { foundDepth: 1, now: 0, skillKey: "commonRailshot" }), id: "boon-tag-ranged-skill" };
    state.skills.profile = { ...state.skills.profile, stones: [stone], loadout: [stone.id, null, null, null] };
    const tags = buildTags(state);
    expect(SKILL_DEFS.commonRailshot.tags.includes("projectile"), "前提: 撃ち抜きは projectile タグ").toBe(true);
    expect(tags.owned.has("ranged"), "遠距離スキル石由来の ranged タグは剣でも残る").toBe(true);
  });
});

describe("呪いを受けて 4 択", () => {
  function offered(seed = 41): GameState {
    const state = arena(seed);
    // 深度 coreDepth の最初の提示は芯だけ（呪いの札なし）なので、その次の深度で見る
    state.depth = BOON.coreDepth + 1;
    offerBoons(state);
    const c = state.boonChoice;
    if (!c) throw new Error("3 択が出ていない");
    c.timer = BOON.inputDelay;
    return state;
  }

  it("呪いを 1 つ受けると 4 枚目が足され、受けた呪いは持ち物に入る。1 回の提示で 1 度だけ", () => {
    const state = offered();
    expect(canTakeCurse(state)).toBe(true);
    expect(takeCurse(state)).toBe(true);
    const c = state.boonChoice;
    expect(c?.options).toHaveLength(BOON.choiceCountWithCurse);
    expect(c?.curse && BOONS[c.curse].cursed).toBe(true);
    expect(c?.curse && state.boons.includes(c.curse)).toBe(true);
    expect(new Set(c?.options).size, "4 枚は重複しない").toBe(BOON.choiceCountWithCurse);
    expect(canTakeCurse(state)).toBe(false);
    expect(takeCurse(state)).toBe(false);
  });

  it("3 / X で呪いを受け、4 / Z で 4 枚目を選ぶ", () => {
    const state = offered(42);
    updateBoonChoice(state, withInput({ skill3Pressed: true }), 1 / 60);
    const fourth = state.boonChoice?.options[3];
    expect(fourth).toBeDefined();
    updateBoonChoice(state, withInput({ skill4Pressed: true }), 1 / 60);
    expect(state.boonChoice).toBeNull();
    expect(fourth && hasBoon(state, fourth)).toBe(true);
  });

  it("呪いの札のクリックでも受けられる。4 枚のカードは画面に収まる", () => {
    const state = offered(43);
    const r = boonCurseRect();
    const center = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
    updateBoonChoice(state, withInput({ aimScreen: center }), 1 / 60);
    expect(state.boonChoice?.curseHover).toBe(true);
    updateBoonChoice(state, withInput({ aimScreen: center, clickPressed: true, attackPressed: true }), 1 / 60);
    expect(state.boonChoice?.options).toHaveLength(BOON.choiceCountWithCurse);
    const last = boonCardRect(BOON.choiceCountWithCurse - 1, BOON.choiceCountWithCurse);
    expect(boonCardRect(0, BOON.choiceCountWithCurse).x).toBeGreaterThanOrEqual(0);
    expect(last.x + last.w).toBeLessThanOrEqual(VIEW_W);
  });

  it("提示直後（inputDelay 前）は呪いの札も押せない", () => {
    const state = arena(44);
    state.depth = BOON.coreDepth + 1;
    offerBoons(state);
    updateBoonChoice(state, withInput({ skill3Pressed: true }), 1 / 60);
    expect(state.boonChoice?.curseTaken).toBe(false);
  });
});

describe("祝福の格と芯（docs/ideas/boon-power-up.md）", () => {
  const ROLLS = 1000;
  const DEEP = 10;
  const MID_DEPTH = 5;
  const BIG_HP = 100000;
  const SEEDS = 30;
  const STRONG_MELEE = 50;
  /** 芯の見本にする件数（coreChoiceCount より多く） */
  const TEMP_CORE_COUNT = BOON.coreChoiceCount + 1;

  /** 格の分布（添字 = 格 − 1） */
  function gradeHistogram(depth: number, seed: number): number[] {
    const rng = createRng(seed);
    const counts = [0, 0, 0];
    for (let i = 0; i < ROLLS; i++) {
      const g = rollGrade(rng, depth);
      counts[g - 1] = (counts[g - 1] ?? 0) + 1;
    }
    return counts;
  }

  /** 芯の候補にできる素直な祝福（呪いなし・真髄や融合の条件なし） */
  function plainKeys(): BoonKey[] {
    return BOON_KEYS.filter((k) => {
      const d = BOONS[k];
      return !d.cursed && d.core !== true && d.card !== "apex" && d.fusion === undefined && !d.requires && !d.loadout;
    });
  }

  /** 既存の祝福を一時的に芯として扱う（Lane B の芯 8 種が入る前でも芯の抽選を検証する） */
  function withTempCores<T>(keys: readonly BoonKey[], body: () => T): T {
    const mutable = keys.map((k) => BOONS[k]).filter((d) => d.core !== true);
    for (const d of mutable) d.core = true;
    try {
      return body();
    } finally {
      for (const d of mutable) delete d.core;
    }
  }

  function gradedCards(state: GameState): BoonGrade[] {
    const c = state.boonChoice;
    if (!c) throw new Error("3 択が出ていない");
    return c.options.flatMap((k, i) => (isGraded(BOONS[k]) ? [choiceGrade(c, i)] : []));
  }

  it("格は深いほど高いものが出やすい（深度 2 と深度 10 で 1000 回引いた分布）", () => {
    const shallow = gradeHistogram(BOON.coreDepth, 1);
    const deep = gradeHistogram(DEEP, 1);
    const high = (h: number[]): number => (h[1] ?? 0) + (h[2] ?? 0);
    expect(high(deep), "大祝福 + 神威").toBeGreaterThan(high(shallow));
    expect(deep[2] ?? 0, "神威").toBeGreaterThan(shallow[2] ?? 0);
    const expected = gradeChances(DEEP);
    expect((deep[2] ?? 0) / ROLLS, "神威の率").toBeCloseTo(expected.divine, 1);
    expect((deep[1] ?? 0) / ROLLS, "大祝福の率").toBeCloseTo(expected.grand, 1);
    expect(clampGrade(3 + BOON.gradeBoostChallenge), "下駄を足しても 3 で止まる").toBe(3);
  });

  it("呪い付きの札は格を持たない", () => {
    for (const k of BOON_KEYS) {
      if (BOONS[k].cursed) expect(isGraded(BOONS[k]), k).toBe(false);
    }
    for (let seed = 1; seed <= SEEDS; seed++) {
      const state = arena(seed);
      state.depth = DEEP;
      offerBoons(state, BOON.gradeBoostChallenge + BOON.gradeBoostAfterBoss);
      const c = state.boonChoice;
      if (!c) throw new Error("3 択が出ていない");
      c.options.forEach((k, i) => {
        if (BOONS[k].cursed) expect(choiceGrade(c, i), `${k} の格`).toBe(1);
      });
    }
    const state = arena(3);
    const cursed = BOON_KEYS.find((k) => BOONS[k].cursed);
    if (!cursed) throw new Error("呪い付きが無い");
    grantBoon(state, cursed, 3);
    expect(boonGradeOf(state, cursed), "神威で渡しても並").toBe(1);
  });

  it("Rule の効果量は格で ×1.5 / ×2.2 になる（静電気の連鎖雷のダメージで確認）", () => {
    const blastDamage = (grade: BoonGrade): number => {
      // 威力を大きくして整数の丸めを比に効かせない
      const state = arena(5, { increased: increasedWith({ melee: STRONG_MELEE - 1 }) });
      state.boonRun.baseStats = state.stats;
      grantBoon(state, "staticDash", grade);
      const e = placeEnemy(state, "golem", 10);
      e.hp = BIG_HP;
      e.maxHp = BIG_HP;
      e.phase = "idle";
      state.events = [];
      state.pendingEvents = [];
      pushPlayerEvent(state, "onDashEnd", "dash");
      resolveRules(state, 0);
      return BIG_HP - e.hp;
    };
    const base = blastDamage(1);
    expect(base, "並でも爆発が当たる").toBeGreaterThan(0);
    const tolerance = 0.1;
    expect(blastDamage(2) / base).toBeGreaterThan(gradeMagnitudeMul(2) - tolerance);
    expect(blastDamage(2) / base).toBeLessThan(gradeMagnitudeMul(2) + tolerance);
    expect(blastDamage(3) / base).toBeGreaterThan(gradeMagnitudeMul(3) - tolerance);
    expect(blastDamage(3) / base).toBeLessThan(gradeMagnitudeMul(3) + tolerance);
  });

  it("神威の Rule は ICD が短くなるが ruleMinIcd を下回らない", () => {
    const icd = BOON_LINEAGE.wealth.pickpocket.icd;
    const icdAfter = (grade: BoonGrade): number | undefined => {
      const state = arena(5);
      grantBoon(state, "pickpocket", grade);
      state.events = [];
      state.pendingEvents = [];
      pushPlayerEvent(state, "onDashEnd", "dash");
      resolveRules(state, 0);
      return state.ruleIcd.get("boon:pickpocket:0");
    };
    expect(isGraded(BOONS.pickpocket), "掏りは格の対象").toBe(true);
    expect(icdAfter(1)).toBeCloseTo(icd);
    expect(icdAfter(2), "大祝福の ICD").toBeCloseTo(icd * gradeIcdMul(2));
    expect(icdAfter(3)).toBeCloseTo(icd * gradeIcdMul(3));
    expect(icdAfter(3) ?? 0).toBeLessThan(icd);
    const short = BOON.ruleMinIcd * 1.2;
    expect(gradedIcd(short, 3), "下限").toBe(BOON.ruleMinIcd);
    expect(gradedIcd(0, 3), "ICD 0 は 0 のまま").toBe(0);
  });

  it("試練の部屋の制圧で 3 択が開き、格の下駄が 1 回だけ効く", () => {
    let laterPlain = 0;
    for (let seed = 1; seed <= SEEDS; seed++) {
      const state = arena(seed);
      state.depth = MID_DEPTH;
      const room = state.rooms[0];
      if (!room) throw new Error("部屋が無い");
      room.kind = "challenge";
      clearSpecialRoom(state, room, { ...state.player.body.pos });
      expect(state.boonChoice, "試練の制圧で 3 択").not.toBeNull();
      for (const g of gradedCards(state)) expect(g, "試練の札は大祝福以上").toBeGreaterThanOrEqual(2);
      chooseBoon(state, 0);
      expect(state.boonRun.gradeBoost, "下駄は残らない").toBe(0);
      offerBoons(state);
      laterPlain += gradedCards(state).filter((g) => g === 1).length;
    }
    expect(laterPlain, "次の提示には下駄が乗らない（並が出る）").toBeGreaterThan(0);
  });

  it("ボス階の直後の提示は格の下駄が乗る", () => {
    const arrive = (fromDepth: number, seed: number): GameState => {
      const state = createGame(seed);
      slayFloorLord(state);
      state.enemies = [];
      state.player.invulnTimer = 999;
      state.depth = fromDepth;
      // 出口の予告で 3 択が出る階が絞られるので、どの階段も祝福の出口にしておく
      for (const s of state.stairs) s.reward = { kind: "boon", lineage: "ash" };
      state.player.body.pos = stairsPos(state);
      step(state, withInput({}), FIXED_DT);
      expect(state.depth).toBe(fromDepth + 1);
      return state;
    };
    let normalPlain = 0;
    for (let seed = 1; seed <= SEEDS; seed++) {
      const afterBoss = arrive(BOSS.interval, seed);
      for (const g of gradedCards(afterBoss)) expect(g, "ボス階の直後は大祝福以上").toBeGreaterThanOrEqual(2);
      const plain = arrive(BOSS.interval + 1, seed);
      normalPlain += gradedCards(plain).filter((g) => g === 1).length;
    }
    expect(normalPlain, "ボス階の直後でなければ並も出る").toBeGreaterThan(0);
  });

  it("呪いを受けて足した 4 枚目は格の下駄が乗る", () => {
    let checked = 0;
    for (let seed = 1; seed <= SEEDS; seed++) {
      const state = arena(seed);
      state.depth = BOON.coreDepth + 1;
      offerBoons(state);
      if (!takeCurse(state)) continue;
      const c = state.boonChoice;
      if (!c) throw new Error("3 択が閉じた");
      expect(c.grades, "格は札と同じ枚数").toHaveLength(c.options.length);
      const fourth = c.options[BOON.choiceCountWithCurse - 1];
      if (!fourth || !isGraded(BOONS[fourth])) continue;
      expect(choiceGrade(c, BOON.choiceCountWithCurse - 1)).toBeGreaterThanOrEqual(clampGrade(1 + BOON.gradeBoostCurseCard));
      checked++;
    }
    expect(checked, "格の対象の 4 枚目を確かめた").toBeGreaterThan(0);
  });

  it("深度 2 の最初の提示は芯だけの 3 択で呪いの札が出ない", () => {
    withTempCores(plainKeys().slice(0, TEMP_CORE_COUNT), () => {
      const state = arrivedAtDepth2();
      expect(state.depth).toBe(BOON.coreDepth);
      const c = state.boonChoice;
      if (!c) throw new Error("3 択が出ていない");
      expect(c.core, "芯の提示").toBe(true);
      expect(c.options).toHaveLength(BOON.coreChoiceCount);
      for (const k of c.options) expect(BOONS[k].core, `${k} は芯`).toBe(true);
      expect(canTakeCurse(state), "呪いの札なし").toBe(false);
      expect(takeCurse(state)).toBe(false);
      chooseBoon(state, 0);
      offerBoons(state);
      expect(state.boonChoice?.core, "芯を持てば同じ深度でも通常の 3 択").toBe(false);
    });
  });

  it("芯を持つと同じタグの祝福の重みが coreTagBonus 倍になる", () => {
    const keys = plainKeys();
    const coreKey = keys[0];
    if (!coreKey) throw new Error("候補が無い");
    const coreTags = BOONS[coreKey].tags;
    const partner = keys.find((k) => k !== coreKey && BOONS[k].tags.some((t) => coreTags.includes(t)));
    const stranger = keys.find((k) => k !== coreKey && !BOONS[k].tags.some((t) => coreTags.includes(t)));
    if (!partner || !stranger) throw new Error("比べる祝福が無い");
    withTempCores([coreKey], () => {
      const tags = new Set<BoonTag>();
      const withCore = boonWeight(BOONS[partner], tags, [coreKey]);
      const without = boonWeight(BOONS[partner], tags, []);
      expect(withCore / without).toBeCloseTo(BOON.coreTagBonus);
      expect(boonWeight(BOONS[stranger], tags, [coreKey]), "タグが重ならなければ等倍").toBeCloseTo(boonWeight(BOONS[stranger], tags, []));
    });
  });

  it("芯を持っていれば通常の 3 択に芯は出ない", () => {
    const cores = plainKeys().slice(0, TEMP_CORE_COUNT);
    const [owned] = cores;
    if (!owned) throw new Error("候補が無い");
    withTempCores(cores, () => {
      const state = arena(21);
      state.depth = BOON.coreDepth + 1;
      grantBoon(state, owned);
      for (let i = 0; i < 200; i++) {
        for (const k of rollBoonOptions(state)) expect(BOONS[k].core, `${k} は芯ではない`).not.toBe(true);
      }
      offerBoons(state);
      expect(state.boonChoice?.core).toBe(false);
    });
  });

  it("同じ seed なら格の列も同じ（決定性）", () => {
    const grades = (seed: number): BoonGrade[] | undefined => {
      const state = arena(seed);
      state.depth = DEEP;
      offerBoons(state);
      return state.boonChoice?.grades;
    };
    for (let seed = 1; seed <= SEEDS; seed++) expect(grades(seed)).toEqual(grades(seed));
    expect(gradeHistogram(DEEP, 7)).toEqual(gradeHistogram(DEEP, 7));
  });
});

describe("系譜の提示・加護の枠・融合・錬磨（段取り 7a、docs/ideas/boon-impl.md 2-2〜2-7）", () => {
  const SEEDS = 40;
  /** 系譜の提示を確かめられる深さ（芯の提示の深度を避ける） */
  const OFFER_DEPTH = BOON.coreDepth + 1;
  /** 灰燼の札 4 枚（真髄の条件を満たす）と 3 枚 */
  const ASH_FOUR: BoonKey[] = ["emberSeed", "wildfire", "embers", "burnSpread"];

  function offerState(seed: number): GameState {
    const state = arena(seed);
    state.depth = OFFER_DEPTH;
    return state;
  }

  function openWith(state: GameState, options: BoonKey[], grades: BoonGrade[]): void {
    state.boonChoice = { options, hover: -1, curseHover: false, timer: BOON.inputDelay, curseTaken: false, curse: null, grades };
  }

  it("出口で選んだ系譜の札だけが 3 枚並ぶ（呪い枠は据え置き）", () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const state = offerState(seed);
      offerBoons(state, 0, "frost");
      const c = state.boonChoice;
      if (!c) throw new Error("提示が開いていない");
      expect(c.lineage, "提示の系譜").toBe("frost");
      expect(c.options).toHaveLength(BOON.choiceCount);
      expect(new Set(c.options).size, "重複なし").toBe(c.options.length);
      for (const k of c.options) {
        if (BOONS[k].cursed) continue;
        expect(BOONS[k].lineage, `${k} は霜枷`).toBe("frost");
        expect(BOONS[k].card, `${k} は重みで出る札`).not.toBe("apex");
      }
      expect(c.options.filter((k) => BOONS[k].cursed).length, "呪いは 1 枚まで").toBeLessThanOrEqual(1);
    }
  });

  it("同じ札の種類 × 行動は 1 回の提示に 1 枚まで", () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const options = rollLineageOptions(offerState(seed), "ash").filter((k) => !BOONS[k].cursed);
      const slots = options.map((k) => `${BOONS[k].card}:${BOONS[k].action ?? "-"}`);
      expect(new Set(slots).size, `seed ${seed}: ${slots.join(", ")}`).toBe(slots.length);
    }
  });

  it("同じ seed なら系譜の提示の候補も同じ（state.rng で決定的）", () => {
    expect(rollLineageOptions(offerState(9), "thunder")).toEqual(rollLineageOptions(offerState(9), "thunder"));
  });

  it("系譜を渡さなければ今までの抽選のまま（系譜を問わない）", () => {
    const state = offerState(9);
    offerBoons(state);
    expect(state.boonChoice?.lineage, "系譜なしの提示").toBeUndefined();
    expect(state.boonChoice?.options).toEqual(rollBoonOptions(offerState(9)));
  });

  it("真髄はその系譜の札が apexMinCards 枚以上で 1 枚目に確定する", () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const three = offerState(seed);
      three.boons = ASH_FOUR.slice(0, BOON.apexMinCards - 1);
      expect(rollLineageOptions(three, "ash"), "3 枚では真髄は出ない").not.toContain("ashInferno");
      const four = offerState(seed);
      four.boons = [...ASH_FOUR];
      expect(four.boons.length).toBeGreaterThanOrEqual(BOON.apexMinCards);
      expect(rollLineageOptions(four, "ash")[0], "1 枚目に真髄").toBe("ashInferno");
    }
  });

  it("真髄を取るとその系譜の加護が宿っている行動の枠が 1 つ開く（上限 graceSlotsMax）", () => {
    const state = offerState(3);
    for (const k of ASH_FOUR) grantBoon(state, k);
    expect(graceSlotsOf(state, "primary")).toBe(BOON.graceSlots);
    grantBoon(state, "ashInferno");
    expect(graceSlotsOf(state, "primary"), "火種の宿る左").toBe(Math.min(BOON.graceSlotsMax, BOON.graceSlots + 1));
    expect(graceSlotsOf(state, "dash"), "灰燼の加護の無い行動は開かない").toBe(BOON.graceSlots);
  });

  it("違う 2 系譜の加護が同じ行動に乗ると、次の提示の 1 枚目に融合が確定し、真髄があればその次", () => {
    const state = offerState(5);
    grantBoon(state, "fireWalk");
    expect(state.boonRun.fusionDue, "1 系譜だけでは積まない").toEqual([]);
    grantBoon(state, "staticDash");
    expect(state.boonRun.fusionDue, "灰燼 × 雷鳴 がダッシュに乗った").toEqual(["thunderBlast"]);
    expect(rollLineageOptions(state, "frost")[0], "別の系譜の提示でも確定").toBe("thunderBlast");
    for (const k of ASH_FOUR) grantBoon(state, k);
    const options = rollLineageOptions(state, "ash");
    expect(options.slice(0, 2), "真髄 → 融合").toEqual(["ashInferno", "thunderBlast"]);
    grantBoon(state, "thunderBlast");
    expect(state.boonRun.fusionDue, "取ったら外れる").toEqual([]);
  });

  it("入れ替えで片方の加護が外れると融合の確定枠も消える", () => {
    const state = offerState(5);
    grantBoon(state, "fireWalk");
    grantBoon(state, "staticDash");
    removeBoon(state, "staticDash");
    expect(state.boonRun.fusionDue).toEqual([]);
  });

  it("加護は 1 行動に graceSlots 枠。満ちた行動の加護を選ぶと第 2 段が開き、見送りなら取らない", () => {
    const state = offerState(4);
    grantBoon(state, "emberSeed");
    grantBoon(state, "chargedBlade");
    expect(gracesOf(state, "primary")).toEqual(["emberSeed", "chargedBlade"]);
    openWith(state, ["frostBreath", "chillShatter"], [2, 1]);
    chooseBoon(state, 0);
    const c = state.boonChoice;
    if (!c) throw new Error("第 2 段が開いていない");
    expect(c.replace?.incoming).toBe("frostBreath");
    expect(c.replace?.action).toBe("primary");
    expect(c.options, "今の加護が並ぶ").toEqual(["emberSeed", "chargedBlade"]);
    expect(choiceCardCount(c), "見送りの札が 1 枚増える").toBe(BOON.graceSlots + 1);
    expect(canTakeCurse(state), "第 2 段では呪いを受けられない").toBe(false);
    chooseBoon(state, c.options.length);
    expect(state.boonChoice).toBeNull();
    expect(hasBoon(state, "frostBreath"), "見送り").toBe(false);
    expect(gracesOf(state, "primary")).toEqual(["emberSeed", "chargedBlade"]);
  });

  it("第 2 段で外す加護を選ぶと入れ替わり、外した札の格も消える", () => {
    const state = offerState(4);
    grantBoon(state, "chargedBlade", 3);
    grantBoon(state, "moonVerdict");
    expect(boonGradeOf(state, "chargedBlade")).toBe(3);
    openWith(state, ["frostBreath"], [2]);
    chooseBoon(state, 0);
    chooseBoon(state, 0);
    expect(state.boonChoice).toBeNull();
    expect(hasBoon(state, "chargedBlade"), "外した").toBe(false);
    expect(state.boonRun.grades.chargedBlade, "格も消える").toBeUndefined();
    expect(gracesOf(state, "primary")).toEqual(["moonVerdict", "frostBreath"]);
    expect(isGraded(BOONS.frostBreath)).toBe(true);
    expect(boonGradeOf(state, "frostBreath"), "新しい札は提示の格").toBe(2);
  });

  it("第 2 段の見送りはキー（3 枚目 = 攻撃）でも選べ、入力の待ちを数え直す", () => {
    const state = offerState(4);
    grantBoon(state, "emberSeed");
    grantBoon(state, "chargedBlade");
    openWith(state, ["frostBreath"], [1]);
    updateBoonChoice(state, withInput({ skill1Pressed: true }), FIXED_DT);
    expect(state.boonChoice?.replace, "第 2 段").toBeDefined();
    updateBoonChoice(state, withInput({ attackPressed: true }), FIXED_DT);
    expect(state.boonChoice, "待ちの間は押せない").not.toBeNull();
    for (let i = 0; i < WAIT_STEPS; i++) updateBoonChoice(state, withInput({}), FIXED_DT);
    updateBoonChoice(state, withInput({ attackPressed: true }), FIXED_DT);
    expect(state.boonChoice).toBeNull();
    expect(hasBoon(state, "frostBreath")).toBe(false);
  });

  it("錬磨: 格の対象の札から最大 temperOfferCount 枚を出し、選ぶと格が 1 段上がる。極致で止まる", () => {
    const state = offerState(6);
    expect(canTemper(state), "札が無ければ錬磨できない").toBe(false);
    expect(offerTemper(state)).toBe(false);
    for (const k of ["fireWalk", "emberSeed", "chargedBlade", "firePillar", "boltDrop"] as const) grantBoon(state, k);
    expect(canTemper(state)).toBe(true);
    expect(offerTemper(state)).toBe(true);
    const c = state.boonChoice;
    if (!c) throw new Error("錬磨が開いていない");
    expect(c.mode).toBe("temper");
    expect(c.options.length).toBe(Math.min(BOON.temperOfferCount, temperCandidates(state).length));
    for (const k of c.options) expect(temperCandidates(state)).toContain(k);
    expect(offerTemper(state), "提示が開いていれば開かない").toBe(false);
    const picked = c.options[0];
    if (!picked) throw new Error("札が無い");
    chooseBoon(state, 0);
    expect(boonGradeOf(state, picked)).toBe(2);
    for (let i = 0; i < 10; i++) {
      state.boons = [picked];
      if (!offerTemper(state)) break;
      chooseBoon(state, 0);
    }
    expect(boonGradeOf(state, picked), "極致で止まる").toBe(5);
    expect(canTemper(state), "極致の札しか無ければ錬磨できない").toBe(false);
  });

  it("系譜の提示で呪いを受けて足す 4 枚目も同じ系譜から出る", () => {
    let checked = 0;
    for (let seed = 1; seed <= SEEDS; seed++) {
      const state = offerState(seed);
      offerBoons(state, 0, "blade");
      if (!takeCurse(state)) continue;
      const fourth = state.boonChoice?.options[BOON.choiceCountWithCurse - 1];
      if (!fourth) continue;
      expect(BOONS[fourth].lineage, `seed ${seed}: ${fourth}`).toBe("blade");
      checked++;
    }
    expect(checked, "4 枚目を確かめた").toBeGreaterThan(0);
  });

  it("錬磨の候補は同じ seed なら同じ", () => {
    const options = (seed: number): BoonKey[] | undefined => {
      const state = offerState(seed);
      for (const k of ["fireWalk", "emberSeed", "chargedBlade", "firePillar", "boltDrop"] as const) grantBoon(state, k);
      offerTemper(state);
      return state.boonChoice?.options;
    };
    expect(options(11)).toEqual(options(11));
  });
});
