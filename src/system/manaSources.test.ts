import { describe, expect, it } from "vitest";
import { step } from "../core/game";
import type { FrameInput } from "../core/input";
import { FIXED_DT } from "../core/loop";
import type { Enemy, GameState } from "../core/state";
import { JOBS, type JobKey } from "../data/jobs";
import { JOB, MANA_SOURCE } from "../data/tuning";
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

function jobArena(job: JobKey): GameState {
  // 自然回復を止めて、源の量だけを数える
  const state = arena(undefined, { manaRegen: 0 });
  state.job = job;
  state.player.mana = 0;
  return state;
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
    expect(gained(state, () => noteFinisherMana(state, "ranged")), "終撃").toBeCloseTo(MANA_SOURCE.swordsman.finisher);
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

  it("狩人: 遠い射撃の命中ほど多く湧き、近い命中では湧かない", () => {
    const state = jobArena("hunter");
    const far = passive(placeEnemy(state, "golem", FAR));
    const near = passive(placeEnemy(state, "golem", NEAR));
    const src = MANA_SOURCE.hunter;
    const meters = (FAR - src.minDistance) / 10;
    expect(gained(state, () => damageEnemy(state, far, HIT, { x: 1, y: 0 }, 0, { kind: "ranged" })), "遠い命中").toBeCloseTo(src.perMeter * meters);
    expect(gained(state, () => damageEnemy(state, near, HIT, { x: 1, y: 0 }, 0, { kind: "ranged" })), "近い命中").toBe(0);
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

  it("陰陽師・巫女の源（式神の命中・加護の発火）は口だけで、今の流儀は持たない", () => {
    for (const job of ["none", "swordsman", "invoker"] as const) {
      const state = jobArena(job);
      expect(onManaSource(state, "minionHit"), `${job} の式神`).toBe(0);
      expect(onManaSource(state, "boonFired"), `${job} の加護`).toBe(0);
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
