import { describe, expect, it } from "vitest";
import { type EventInput, type EventKind, enemyTarget, pushEvent } from "../../core/events";
import { step } from "../../core/game";
import { FIXED_DT } from "../../core/loop";
import type { Enemy, GameState } from "../../core/state";
import { BOON_LINEAGE, STATUS } from "../../data/tuning";
import { BOON_ACTIONS, BOONS, type BoonKey } from "../boonDefs";
import { damagePlayer, tickDelayedDamage } from "../combat";
import { applyModifiers } from "../modifiers";
import { resolveRules } from "../rules";
import { applyStatus, findStatus, hasStatus, removeStatus, updateStatusEffects } from "../statusEffects";
import { arena, placeEnemy, withInput } from "../testHelpers";
import { BOON_KEYS_MOON, BOONS_MOON } from "./moon";

/** 月蝕の札（docs/ideas/boon-impl.md 2-6）: 構成・各札の発火・遅れて来る傷・宣告の溜め・決定性 */

const M = BOON_LINEAGE.moon;
const BIG_HP = 10_000;
const NEAR = 20;
const FAR = 400;
/** 出血の代償を確かめるために歩く距離（px） */
const WALK = 60;
const ONE_SECOND_STEPS = Math.round(1 / FIXED_DT);

function cleanArena(seed = 5): GameState {
  const state = arena(seed);
  for (const r of state.rooms) r.locked = false;
  state.events = [];
  state.pendingEvents = [];
  return state;
}

/** 攻撃しない・倒れない敵 */
function dummy(state: GameState, dx = NEAR, dy = 0): Enemy {
  const e = placeEnemy(state, "golem", dx, dy);
  e.hp = BIG_HP;
  e.maxHp = BIG_HP;
  e.phase = "idle";
  return e;
}

function give(state: GameState, key: BoonKey): void {
  if (!state.boons.includes(key)) state.boons.push(key);
}

/** イベントを 1 つ積んで照合する（対象があれば対象の位置、無ければ自分の位置） */
function fire(state: GameState, kind: EventKind, target?: Enemy, extra: Partial<EventInput> = {}): void {
  const where = target === undefined ? { pos: { ...state.player.body.pos } } : enemyTarget(target, true);
  pushEvent(state, { kind, actor: "player", source: { kind: "player", key: "test" }, ...where, ...extra });
  resolveRules(state, 0);
}

/** 自分の状態異常を 1 秒進める */
function tickOneSecond(state: GameState): void {
  for (let i = 0; i < ONE_SECOND_STEPS; i++) updateStatusEffects(state, FIXED_DT);
}

describe("月蝕の札の構成", () => {
  const defs = BOON_KEYS_MOON.map((k) => BOONS_MOON[k]);

  it("11 枚: 加護 5（行動ごとに 1 枚）・摂理 3・研鑽 2・真髄 1", () => {
    expect(defs.length).toBe(11);
    const count = (card: string): number => defs.filter((d) => d.card === card).length;
    expect(count("grace"), "加護").toBe(5);
    expect(count("law"), "摂理").toBe(3);
    expect(count("temper"), "研鑽").toBe(2);
    expect(count("apex"), "真髄").toBe(1);
    const actions = defs.filter((d) => d.card === "grace").map((d) => d.action);
    expect([...actions].sort(), "加護は行動 5 つに 1 枚ずつ").toEqual([...BOON_ACTIONS].sort());
  });

  it("全札が系譜 moon・何が変わるか・語を持ち、呪い付きではなく、BOONS に載っている", () => {
    for (const d of defs) {
      expect(d.lineage, d.key).toBe("moon");
      expect(d.changes, `${d.key} の変わるもの`).toBeDefined();
      expect(d.cursed, d.key).toBe(false);
      expect(d.icon.length, `${d.key} のアイコンは 1 文字`).toBe(1);
      expect(BOONS[d.key], `${d.key} は集約の表で上書きされている`).toBe(d);
      if (d.card !== "grace") expect(d.action, `${d.key} は加護ではない`).toBeUndefined();
    }
  });

  it("旧 月蝕 4 種の key（輪廻へ写す）を使わない", () => {
    for (const k of ["moonRead", "highTide", "newMoon", "eclipse"]) expect(BOON_KEYS_MOON as readonly string[]).not.toContain(k);
  });

  it("研鑽は数えの Rule と「〜につき」の Modifier を持つ", () => {
    for (const d of defs.filter((x) => x.card === "temper")) {
      expect(d.rules?.some((r) => r.then.kind === "tally"), `${d.key} の数え`).toBe(true);
      expect(d.modifiers?.some((m) => m.per?.count.kind === "tally"), `${d.key} の〜につき`).toBe(true);
    }
  });
});

describe("月蝕の加護", () => {
  it("宣告の刃: 左の終撃で宣告、右の終撃では付かない", () => {
    const state = cleanArena();
    give(state, "moonVerdict");
    const e = dummy(state);
    state.player.attack.lane = "secondary";
    fire(state, "onFinisher", e);
    expect(hasStatus(e.status, "doom"), "右").toBe(false);
    state.player.attack.lane = "primary";
    fire(state, "onFinisher", e);
    expect(hasStatus(e.status, "doom"), "左").toBe(true);
  });

  it("血閃: 放出で衝撃波が出て、自分も出血する（動くと生命が減る）", () => {
    const state = cleanArena();
    give(state, "bloodMist");
    const before = state.projectiles.length;
    const hp = state.player.hp;
    fire(state, "onRelease");
    expect(state.projectiles.length, "衝撃波").toBe(before + 1);
    expect(hasStatus(state.player.status, "bleed"), "代償の出血").toBe(true);
    state.player.body.pos.x += WALK;
    tickOneSecond(state);
    expect(state.player.hp, "動いた分だけ減る").toBeLessThan(hp);
  });

  it("血霧: ダッシュの起点の周りの敵が出血し、遠い敵は出血しない", () => {
    const state = cleanArena();
    give(state, "moonBloodFog");
    const near = dummy(state, NEAR);
    const far = dummy(state, FAR);
    fire(state, "onDash");
    expect(hasStatus(near.status, "bleed"), "近い敵").toBe(true);
    expect(hasStatus(far.status, "bleed"), "遠い敵").toBe(false);
    expect(hasStatus(state.player.status, "bleed"), "代償").toBe(true);
  });

  it("血払い: スキルを撃つと気力が戻り、生命を払う", () => {
    const state = cleanArena();
    give(state, "moonBloodRite");
    state.player.mana = 0;
    fire(state, "onSkillCast");
    expect(state.player.mana, "気力").toBeGreaterThan(0);
    expect(hasStatus(state.player.status, "bleed"), "代償").toBe(true);
  });

  it("落月: 奥義で周りの敵すべてに宣告", () => {
    const state = cleanArena();
    give(state, "moonNightfall");
    const a = dummy(state, NEAR);
    const b = dummy(state, -NEAR);
    const far = dummy(state, FAR);
    fire(state, "onBurst");
    expect(hasStatus(a.status, "doom")).toBe(true);
    expect(hasStatus(b.status, "doom")).toBe(true);
    expect(hasStatus(far.status, "doom"), "半径の外").toBe(false);
  });
});

describe("月蝕の摂理", () => {
  it("血の饗宴: 撃破で生命が回復する", () => {
    const state = cleanArena();
    give(state, "bloodFeast");
    state.player.hp = state.player.maxHp - 10;
    const e = dummy(state);
    fire(state, "onKill", e);
    expect(state.player.hp).toBe(state.player.maxHp - 10 + M.bloodFeast.heal);
  });

  it("傷の記憶: 被弾すると攻撃してきた敵が脆弱になる", () => {
    const state = cleanArena();
    give(state, "woundMemory");
    const e = dummy(state);
    damagePlayer(state, 5, e.body.pos, e);
    resolveRules(state, 0);
    expect(hasStatus(e.status, "vulnerable")).toBe(true);
  });

  it("執行猶予: 受けた傷は delay 秒後にまとめて来る（被弾の無敵はその場で付く）", () => {
    const state = cleanArena();
    give(state, "moonReprieve");
    const e = dummy(state);
    const hp = state.player.hp;
    expect(damagePlayer(state, 10, e.body.pos, e)).toBe("hit");
    expect(state.player.hp, "今は減らない").toBe(hp);
    expect(state.player.invulnTimer, "被弾の無敵").toBeGreaterThan(0);
    const owed = state.player.deferredDamage?.[0]?.amount ?? 0;
    expect(owed, "遅れて来る傷").toBeGreaterThan(0);
    state.time += M.moonReprieve.delay - FIXED_DT;
    tickDelayedDamage(state);
    expect(state.player.hp, "期限の前").toBe(hp);
    state.time += FIXED_DT;
    tickDelayedDamage(state);
    expect(state.player.hp, "期限で払う").toBe(hp - owed);
    expect(state.player.deferredDamage?.length, "払った傷は消える").toBe(0);
  });

  it("執行猶予: 遅れて来る傷は毎ステップ（updatePlayer）で払われる", () => {
    const state = cleanArena();
    give(state, "moonReprieve");
    const hp = state.player.hp;
    damagePlayer(state, 10, { x: state.player.body.pos.x + NEAR, y: state.player.body.pos.y });
    const owed = state.player.deferredDamage?.[0]?.amount ?? 0;
    // 被弾のヒットストップで止まる分を見込んで 1 秒多く回す
    const steps = Math.ceil((M.moonReprieve.delay + 1) / FIXED_DT);
    for (let i = 0; i < steps; i++) step(state, withInput({}), FIXED_DT);
    expect(owed).toBeGreaterThan(0);
    expect(state.player.hp, "期限が来て減る").toBeLessThanOrEqual(hp - owed);
  });

  it("執行猶予なしの被弾はその場で減る", () => {
    const state = cleanArena();
    const e = dummy(state);
    const hp = state.player.hp;
    damagePlayer(state, 10, e.body.pos, e);
    expect(state.player.hp).toBeLessThan(hp);
    expect(state.player.deferredDamage ?? []).toEqual([]);
  });

  it("執行猶予: 遅れて来た傷で生命が尽きれば倒れる", () => {
    const state = cleanArena();
    give(state, "moonReprieve");
    const e = dummy(state);
    state.player.hp = 1;
    damagePlayer(state, 50, e.body.pos, e);
    expect(state.status, "まだ立っている").toBe("playing");
    state.time += M.moonReprieve.delay;
    tickDelayedDamage(state);
    expect(state.player.hp).toBe(0);
    expect(state.status).toBe("dead");
  });
});

describe("月蝕の研鑽", () => {
  it("怨恨: 受けた傷の量を数え、every ごとに放出の一撃の倍が上がる", () => {
    const state = cleanArena();
    give(state, "moonGrudge");
    const e = dummy(state);
    const hp = state.player.hp;
    damagePlayer(state, 30, e.body.pos, e);
    resolveRules(state, 0);
    const taken = hp - state.player.hp;
    expect(state.boonRun.tallies.moonGrudge, "受けた傷の量").toBe(taken);
    state.boonRun.tallies.moonGrudge = M.moonGrudge.every * 2;
    const out = applyModifiers(state, { tags: new Set(["release"]) }, e);
    const mul = out.more.reduce((m, x) => m * x.mul, 1);
    expect(mul, "2 段").toBeCloseTo(1 + M.moonGrudge.amount * 2);
    const plain = applyModifiers(state, { tags: new Set(["melee"]) }, e).more.reduce((m, x) => m * x.mul, 1);
    expect(plain, "放出でない一撃には効かない").toBe(1);
  });

  it("判決: 宣告の敵の撃破を数え、宣告の敵にだけ倍が掛かる", () => {
    const state = cleanArena();
    give(state, "moonJudgment");
    const doomed = dummy(state);
    const plain = dummy(state, -NEAR);
    fire(state, "onKill", plain);
    expect(state.boonRun.tallies.moonJudgment ?? 0, "宣告なしは数えない").toBe(0);
    applyStatus(state, { kind: "enemy", enemy: doomed }, { kind: "doom", stacks: 1, duration: STATUS.doom.duration, potency: 0 }, "player");
    for (let i = 0; i < M.moonJudgment.every; i++) fire(state, "onKill", doomed);
    expect(state.boonRun.tallies.moonJudgment).toBe(M.moonJudgment.every);
    const more = (e: Enemy): number => applyModifiers(state, { tags: new Set(["melee"]) }, e).more.reduce((m, x) => m * x.mul, 1);
    expect(more(doomed), "宣告の敵").toBeCloseTo(1 + M.moonJudgment.amount);
    expect(more(plain), "宣告のない敵").toBe(1);
  });
});

describe("月蝕の真髄: 皆既", () => {
  it("命中で宣告が付き、明けるとその間の傷の echoRatio 倍がもう一度来る", () => {
    const state = cleanArena();
    give(state, "moonTotality");
    const e = dummy(state);
    fire(state, "onMeleeHit", e);
    expect(hasStatus(e.status, "doom"), "命中で宣告").toBe(true);
    const dealt = 200;
    e.hp -= dealt;
    tickDelayedDamage(state);
    expect(e.vault, "宣告の間の傷を写す").toEqual({ kind: "doom", amount: dealt });
    removeStatus(state, { kind: "enemy", enemy: e }, "doom");
    const before = e.hp;
    tickDelayedDamage(state);
    expect(before - e.hp, "明けた時に出る").toBe(Math.round(dealt * M.moonTotality.echoRatio));
    expect(e.vault, "溜めは空に").toBeUndefined();
  });

  it("宣告が付け直されたら、前の溜めを出してから数え直す", () => {
    const state = cleanArena();
    give(state, "moonTotality");
    const e = dummy(state);
    fire(state, "onMeleeHit", e);
    e.hp -= 100;
    tickDelayedDamage(state);
    removeStatus(state, { kind: "enemy", enemy: e }, "doom");
    fire(state, "onMeleeHit", e);
    const mark = findStatus(e.status, "doom")?.hpMark;
    expect(mark, "新しい宣告").toBe(e.hp);
    const before = e.hp;
    tickDelayedDamage(state);
    expect(before - e.hp, "前の溜めが出る").toBe(Math.round(100 * M.moonTotality.echoRatio));
  });

  it("皆既を持たなければ宣告の傷を写さない", () => {
    const state = cleanArena();
    const e = dummy(state);
    applyStatus(state, { kind: "enemy", enemy: e }, { kind: "doom", stacks: 1, duration: STATUS.doom.duration, potency: 0 }, "player");
    e.hp -= 100;
    tickDelayedDamage(state);
    expect(e.vault).toBeUndefined();
  });

  it("別の種類の溜め（氷獄）がある敵には写さない", () => {
    const state = cleanArena();
    give(state, "moonTotality");
    const e = dummy(state);
    e.vault = { kind: "ice", amount: 7 };
    fire(state, "onMeleeHit", e);
    e.hp -= 100;
    tickDelayedDamage(state);
    expect(e.vault).toEqual({ kind: "ice", amount: 7 });
  });
});

describe("月蝕の決定性", () => {
  /** 被弾・命中・放出を同じ順で流し、生命・溜め・乱数の続きを返す */
  function run(seed: number): { hp: number; enemyHp: number; tally: number | undefined; rng: number } {
    const state = cleanArena(seed);
    for (const k of ["moonReprieve", "moonGrudge", "moonTotality", "bloodMist"] as const) give(state, k);
    const e = dummy(state);
    damagePlayer(state, 12, e.body.pos, e);
    fire(state, "onMeleeHit", e);
    fire(state, "onRelease");
    e.hp -= 50;
    for (let i = 0; i < ONE_SECOND_STEPS * 4; i++) {
      state.time += FIXED_DT;
      updateStatusEffects(state, FIXED_DT);
      tickDelayedDamage(state);
    }
    return { hp: state.player.hp, enemyHp: e.hp, tally: state.boonRun.tallies.moonGrudge, rng: state.rng.next() };
  }

  it("同じ seed なら同じ生命・溜め・数え・乱数列", () => {
    const a = run(9);
    expect(a.tally, "被弾を数える").toBeGreaterThan(0);
    expect(a).toEqual(run(9));
  });
});
