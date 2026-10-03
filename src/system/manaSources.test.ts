import { describe, expect, it } from "vitest";
import { step } from "../core/game";
import type { FrameInput } from "../core/input";
import { FIXED_DT } from "../core/loop";
import type { Enemy, GameState } from "../core/state";
import { JOBS, type JobKey } from "../data/jobs";
import { JOB, MANA_SOURCE } from "../data/tuning";
import { enemyTarget, pushPlayerEvent } from "../core/events";
import { SKILL, SKILL_DEFS, resolveCast } from "../skills/data";
import { stoneFromSeed } from "../skills/generator";
import { placeMine, spawnWell, updatePlacedSkills } from "../skills/placed";
import type { CastParams, SkillKey } from "../skills/types";
import { grantBoon } from "./boons";
import { damageEnemy, damagePlayer } from "./combat";
import { isDashing } from "./player";
import {
  attackHitManaMul,
  manaSourcesText,
  noteFinisherMana,
  noteMeleeHitMana,
  noteReactionMana,
  noteStatusTickMana,
  onManaSource,
} from "./manaSources";
import { noteRiposte } from "./moments";
import { resolveRules } from "./rules";
import { applyStatus, updateStatusEffects } from "./statusEffects";
import { arena, placeEnemy, withInput } from "./testHelpers";

/** 流儀の気力の源（src/system/manaSources.ts）の検査 */

const NEAR = 20;
const FAR = 140;
const HIT = 10;
const HURT = 20;
const MANY_COMBO = 99;
const ONE_SEC = 1;
/** 敵が勝手に攻撃してこないようにする */
const NO_ATTACK_COOLDOWN = 99;
/** 振りが当たり終わるまで回すステップ数 */
const SWING_STEPS = 20;
/** ダッシュが終わるまで回す上限のステップ数 */
const MAX_DASH_STEPS = 120;
/** 地雷が起爆するまで回す上限のステップ数 */
const MAX_MINE_STEPS = 200;
/** 敵を 1 発で倒さない体力（撃破の気力を混ぜない） */
const TOUGH_HP = 100000;

function jobArena(job: JobKey): GameState {
  // 自然回復を止めて、源の量だけを数える
  const state = arena(undefined, { manaRegen: 0 });
  state.job = job;
  state.player.mana = 0;
  return state;
}

function paramsFor(key: SkillKey): CastParams {
  const stone = { ...stoneFromSeed(1, { foundDepth: 1, now: 0, skillKey: key }), variants: [], links: 0 };
  return resolveCast(SKILL_DEFS[key], stone, []);
}

function toughEnemy(state: GameState): Enemy {
  const e = passive(placeEnemy(state, "golem", NEAR));
  e.hp = TOUGH_HP;
  e.maxHp = TOUGH_HP;
  return e;
}

function passive(e: Enemy): Enemy {
  e.attackCooldown = NO_ATTACK_COOLDOWN;
  return e;
}

function press(state: GameState, input: Partial<FrameInput>): void {
  step(state, withInput(input), FIXED_DT);
}

/** fn の前後で増えた気力 */
function gained(state: GameState, fn: () => void): number {
  const before = state.player.mana;
  fn();
  return state.player.mana - before;
}

/** 1 段目を 1 回振って目の前の敵に当て、増えた気力を返す */
function swingMana(job: JobKey): number {
  const state = jobArena(job);
  passive(placeEnemy(state, "golem", NEAR));
  return gained(state, () => {
    for (let i = 0; i < SWING_STEPS; i++) press(state, { attackPressed: i === 0 });
  });
}

describe("通常攻撃の命中の下地", () => {
  it("見習いは等倍、他の流儀は JOB.manaBaseMul（35%）", () => {
    expect(attackHitManaMul(jobArena("none"))).toBe(1);
    expect(attackHitManaMul(jobArena("swordsman"))).toBe(JOB.manaBaseMul);
    const plain = swingMana("none");
    expect(plain, "見習いは近接の命中で気力が湧く").toBeGreaterThan(0);
    expect(swingMana("lancer") / plain, "槍兵は下地だけ（先端でない命中）").toBeCloseTo(JOB.manaBaseMul, 2);
  });
});

describe("流儀ごとの源", () => {
  it("剣士: 応手と終撃で湧く。見習いは湧かない", () => {
    const state = jobArena("swordsman");
    expect(gained(state, () => noteRiposte(state, "justDodge")), "応手").toBeCloseTo(MANA_SOURCE.swordsman.riposte);
    expect(gained(state, () => noteFinisherMana(state, "melee")), "終撃").toBeCloseTo(MANA_SOURCE.swordsman.finisher);
    // 遠距離の攻撃は資源を戻さない（docs/ideas/gun-bases-review.md 0-2）: 長銃の満ちた 1 発などの弾の終撃では湧かない
    expect(gained(state, () => noteFinisherMana(state, "ranged")), "弾の終撃").toBe(0);
    const plain = jobArena("none");
    expect(gained(plain, () => noteRiposte(plain, "justDodge")), "見習いの応手").toBe(0);
  });

  it("剣士: ダッシュ中の見切り（応手）で湧く", () => {
    const state = jobArena("swordsman");
    const e = passive(placeEnemy(state, "golem", NEAR));
    press(state, { dashPressed: true, move: { x: 0, y: 1 } });
    expect(isDashing(state.player)).toBe(true);
    const got = gained(state, () => damagePlayer(state, HURT, e.body.pos, e));
    expect(got, "応手の分が乗る").toBeGreaterThanOrEqual(MANA_SOURCE.swordsman.riposte);
  });

  it("狩人: ダッシュ攻撃の命中で湧き、遠い弾の命中・普通の振りの命中では湧かない", () => {
    const state = jobArena("hunter");
    const far = passive(placeEnemy(state, "golem", FAR));
    expect(gained(state, () => noteMeleeHitMana(state, false, true)), "ダッシュ攻撃の命中").toBeCloseTo(MANA_SOURCE.hunter.dashHit);
    expect(gained(state, () => noteMeleeHitMana(state, false, false)), "普通の振りの命中").toBe(0);
    expect(gained(state, () => damageEnemy(state, far, HIT, { x: 1, y: 0 }, 0, { kind: "ranged" })), "遠い弾の命中").toBe(0);
  });

  it("狩人の気力はダッシュ攻撃の命中で戻る（弩のダッシュ中の左 → 終わりの反転撃ち）", () => {
    const state = jobArena("hunter");
    state.stats = { ...state.stats, moveset: "longarm" };
    const p = state.player;
    press(state, { dashPressed: true, move: { x: 1, y: 0 } });
    press(state, { attackPressed: true });
    expect(p.dashAttackQueued, "ダッシュ中の左はダッシュ攻撃の予約").toBe(true);
    for (let i = 0; i < MAX_DASH_STEPS && isDashing(p); i++) press(state, {});
    // ダッシュを終えた位置の正面に的を置く（ダッシュの距離に依らない）
    const e = toughEnemy(state);
    e.body.pos = { x: p.body.pos.x + p.facing.x * NEAR, y: p.body.pos.y + p.facing.y * NEAR };
    const got = gained(state, () => {
      for (let i = 0; i < SWING_STEPS && !p.attack.hitIds.has(e.id); i++) press(state, {});
    });
    expect(p.dashStrike, "ダッシュ攻撃の振り").toBe(true);
    expect(p.attack.hitIds.has(e.id), "ダッシュ攻撃が当たった").toBe(true);
    expect(got, "ダッシュ攻撃の命中の源").toBeGreaterThanOrEqual(MANA_SOURCE.hunter.dashHit);
  });

  it("拳闘士: 近接の命中でコンボ数に比例し、上限で頭打ち", () => {
    const state = jobArena("brawler");
    const src = MANA_SOURCE.brawler;
    state.combo.count = 2;
    expect(gained(state, () => noteMeleeHitMana(state, false)), "コンボ 2").toBeCloseTo(src.perCombo * 2);
    state.combo.count = MANY_COMBO;
    expect(gained(state, () => noteMeleeHitMana(state, false)), "上限").toBeCloseTo(src.perCombo * src.comboCap);
  });

  it("盾持ち: 不退の構えで受けた量で湧く", () => {
    const state = jobArena("shieldBearer");
    press(state, { dashPressed: true });
    expect(state.boonRun.guardTimer, "構えている").toBeGreaterThan(0);
    const got = gained(state, () => damagePlayer(state, HURT, { x: state.player.body.pos.x + 10, y: state.player.body.pos.y }));
    expect(got, "受けた量 × perDamage 以上").toBeGreaterThanOrEqual(MANA_SOURCE.shieldBearer.perDamage * HURT);
  });

  it("呪術師: 自分が付けた継続ダメージが敵を刻む間に湧く（敵が付けた・プレイヤーの身の継続ダメージは数えない）", () => {
    const state = jobArena("hexer");
    const e = passive(placeEnemy(state, "golem", NEAR));
    applyStatus(state, { kind: "enemy", enemy: e }, { kind: "poison", stacks: 1, duration: 5, potency: 0.001 }, "player");
    const poison = e.status.effects.find((s) => s.kind === "poison");
    if (!poison) throw new Error("毒が付かない");
    expect(gained(state, () => noteStatusTickMana(state, { kind: "enemy", enemy: e }, poison, ONE_SEC)), "1 秒").toBeCloseTo(MANA_SOURCE.hexer.perSec);
    expect(gained(state, () => noteStatusTickMana(state, { kind: "enemy", enemy: e }, { ...poison, source: "enemy" }, ONE_SEC)), "敵が付けた").toBe(0);
    expect(gained(state, () => noteStatusTickMana(state, { kind: "player" }, poison, ONE_SEC)), "プレイヤーの身").toBe(0);
    expect(gained(state, () => updateStatusEffects(state, FIXED_DT)), "状態異常の刻みから湧く").toBeCloseTo(MANA_SOURCE.hexer.perSec * FIXED_DT);
  });

  it("槍兵: 先端の命中で湧く", () => {
    const state = jobArena("lancer");
    expect(gained(state, () => noteMeleeHitMana(state, true)), "先端").toBeCloseTo(MANA_SOURCE.lancer.tipHit);
    expect(gained(state, () => noteMeleeHitMana(state, false)), "先端でない").toBe(0);
  });

  it("術士: スキルの命中で湧く", () => {
    const state = jobArena("invoker");
    expect(gained(state, () => onManaSource(state, "skillHit")), "スキルの命中").toBeCloseTo(MANA_SOURCE.invoker.skillHit);
  });

  it("影: 背面の命中で湧く（影潜りの直後）", () => {
    const front = jobArena("shadow");
    const f = passive(placeEnemy(front, "golem", NEAR));
    expect(gained(front, () => damageEnemy(front, f, HIT, { x: 1, y: 0 }, 0, { kind: "melee" })), "正面").toBe(0);
    const state = jobArena("shadow");
    const e = passive(placeEnemy(state, "golem", NEAR));
    press(state, { dashPressed: true, move: { x: 0, y: 1 } });
    for (let i = 0; i < MAX_DASH_STEPS && isDashing(state.player); i++) press(state, {});
    expect(gained(state, () => damageEnemy(state, e, HIT, { x: 1, y: 0 }, 0, { kind: "melee" })), "影潜りの直後").toBeCloseTo(MANA_SOURCE.shadow.backstab);
  });

  it("錬金術師: 敵の身に起こした反応で湧く", () => {
    const state = jobArena("alchemist");
    const e = passive(placeEnemy(state, "golem", NEAR));
    expect(gained(state, () => noteReactionMana(state, { kind: "player" })), "プレイヤーの身の反応").toBe(0);
    applyStatus(state, { kind: "enemy", enemy: e }, { kind: "chill", stacks: 1, duration: 3, potency: 0.3 }, "player");
    const got = gained(state, () => applyStatus(state, { kind: "enemy", enemy: e }, { kind: "burn", stacks: 1, duration: 3, potency: 5 }, "player"));
    expect(got, "蒸発").toBeCloseTo(MANA_SOURCE.alchemist.reaction);
  });

  it("陰陽師: 設置物が爆ぜて敵に当たると湧く。引力球・氷結地帯の刻みは数えない", () => {
    const state = jobArena("onmyoji");
    const e = toughEnemy(state);
    placeMine(state, { ...e.body.pos }, paramsFor("mines"));
    const got = gained(state, () => {
      for (let i = 0; i < MAX_MINE_STEPS && state.skills.mines.length > 0; i++) updatePlacedSkills(state, FIXED_DT);
    });
    expect(state.skills.mines, "起爆した").toHaveLength(0);
    expect(got, "地雷の命中").toBeCloseTo(MANA_SOURCE.onmyoji.minionHit);
    const well = jobArena("onmyoji");
    toughEnemy(well);
    spawnWell(well, { x: well.player.body.pos.x + NEAR, y: well.player.body.pos.y }, paramsFor("gravityWell"));
    expect(gained(well, () => updatePlacedSkills(well, FIXED_DT)), "引力球の刻みは湧かない").toBe(0);
    expect(SKILL.gravityWell.tickEvery, "前提: 刻みで当たっている").toBeGreaterThan(0);
  });

  it("陰陽師: 直接の口（onManaSource）でも湧き、他の流儀は湧かない", () => {
    const state = jobArena("onmyoji");
    expect(gained(state, () => onManaSource(state, "minionHit")), "式神の命中").toBeCloseTo(MANA_SOURCE.onmyoji.minionHit);
    expect(gained(state, () => onManaSource(state, "skillHit")), "スキルの命中の源は持たない").toBe(0);
    for (const job of ["none", "swordsman", "invoker", "miko"] as const) {
      const other = jobArena(job);
      expect(onManaSource(other, "minionHit"), `${job} の式神`).toBe(0);
    }
  });

  it("巫女: 祝福の加護が発動すると湧く。祝福でないルール（ジョブ自身）は数えない", () => {
    const state = jobArena("miko");
    grantBoon(state, "bloodFeast");
    const e = toughEnemy(state);
    e.hp = 0;
    pushPlayerEvent(state, "onKill", "kill", enemyTarget(e, true));
    resolveRules(state, 0);
    expect(state.player.mana, "加護の発火").toBeCloseTo(MANA_SOURCE.miko.boonFired);
    const own = jobArena("miko");
    pushPlayerEvent(own, "onRoomClear", "clear");
    resolveRules(own, 0);
    expect(own.player.mana, "ジョブ自身のルールは数えない").toBe(0);
    for (const job of ["none", "swordsman", "onmyoji"] as const) {
      const other = jobArena(job);
      expect(onManaSource(other, "boonFired"), `${job} の加護`).toBe(0);
    }
  });
});

describe("説明", () => {
  it("流儀の源を先に、通常攻撃の下地を最後に並べる", () => {
    const text = manaSourcesText(JOBS.swordsman.mana);
    expect(text.startsWith("応手"), text).toBe(true);
    expect(text.endsWith(`${Math.round(JOB.manaBaseMul * 100)}%`), text).toBe(true);
  });
});
