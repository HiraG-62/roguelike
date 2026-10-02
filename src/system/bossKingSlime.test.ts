import { describe, expect, it } from "vitest";
import { createGame, step } from "../core/game";
import { EMPTY_INPUT } from "../core/input";
import { FIXED_DT } from "../core/loop";
import type { Enemy, EnemyPhase, GameState } from "../core/state";
import { dist, normalize, sub } from "../core/vec";
import { BOSS, PARRY, PLAYER, POISE } from "../data/tuning";
import { TILE_SIZE, rectCenterPx } from "../map/grid";
import { bossEnemy, bossOnAnswer } from "./boss";
import {
  CROWN_EATEN,
  KS_BITE,
  KS_CENTER,
  KS_INFLATE,
  KS_JUMP,
  KS_SWALLOW,
  crownOf,
  inflateRadius,
  kingSlimeLift,
  kingSlimePose,
  splitsOf,
} from "./bossKingSlime";
import { bossDown, readPlayer } from "./bossKit";
import { damageEnemy } from "./combat";
import { updateEnemies } from "./enemies";
import { findFreeSpot } from "./enemyTraits";
import { buildFloor } from "./floor";
import { withFixedLayout } from "../map/layout/select";
import { updateHazards } from "./hazards";
import { attackCommitted, isStaggered, windupCommitted } from "./poise";
import { yellowAt } from "./readTiming";
import { applyStatus, findStatus, updateStatusEffects } from "./statusEffects";
import { arena, placeEnemy } from "./testHelpers";
import { terrainAt } from "./terrain";

const HUGE_HP = 1_000_000;
const MAX_STEPS = 1200;
const KS = BOSS.kingSlime;
/** 黄の途中（上昇を終えて滞空に入ったあたり）までの歩数 */
const MID_WINDUP_STEPS = 10;
/** 上昇を終えるまでの歩数 */
const RISE_STEPS = Math.ceil(BOSS.kingSlime.jumpRise / FIXED_DT) + 2;

/** スライム王の階を作り、部屋を封鎖してプレイヤーを王の横（dx）に置く */
function kingFloor(dx = -70, seed = 21): { state: GameState; boss: Enemy } {
  // 1 階を旧生成に固定して型の抽選で乱数を引かせない（ボス階の形と他の敵の配置を seed のまま保つ）
  const state = withFixedLayout("legacy", () => createGame(seed));
  state.depth = BOSS.interval;
  buildFloor(state);
  const boss = bossEnemy(state);
  const room = state.rooms[state.boss?.roomIndex ?? -1];
  if (!boss || !room || boss.defKey !== "kingSlime") throw new Error("no king slime");
  room.locked = true;
  state.player.maxHp = HUGE_HP;
  state.player.hp = HUGE_HP;
  const want = { x: boss.body.pos.x + dx, y: boss.body.pos.y };
  state.player.body.pos = findFreeSpot(state, want, state.player.body.radius, 80) ?? want;
  return { state, boss };
}

function tick(state: GameState, n = 1, each?: (i: number) => void): void {
  for (let i = 0; i < n; i++) {
    each?.(i);
    // 出端の判定は時刻で比べる（yellowAt）ので、時刻も進める
    state.time += FIXED_DT;
    updateStatusEffects(state, FIXED_DT);
    updateEnemies(state, FIXED_DT);
    updateHazards(state, FIXED_DT);
    state.player.invulnTimer = 0;
  }
}

/** 代入で型が絞られた後も読み直せるよう関数にする */
function phaseOf(e: Enemy): EnemyPhase {
  return e.phase;
}

function tickUntil(state: GameState, done: () => boolean, each?: (i: number) => void): void {
  for (let i = 0; i < MAX_STEPS && !done(); i++) tick(state, 1, each);
}

/** プレイヤーを左右に小刻みに動かす（静止とみなされない） */
function jiggle(state: GameState): (i: number) => void {
  return (i) => {
    const dx = i % 2 === 0 ? 2 : -2;
    state.player.body.pos = { x: state.player.body.pos.x + dx, y: state.player.body.pos.y };
  };
}

function aiOf(boss: Enemy): NonNullable<Enemy["ai"]> {
  if (!boss.ai) throw new Error("no ai");
  return boss.ai;
}

/** 追跡中のボスに技を出させる（次の予備動作から） */
function arm(boss: Enemy, move: number): void {
  boss.phase = "chase";
  boss.attackCooldown = 0;
  aiOf(boss).move = move;
}

/** 分裂させ、分裂体をその場に留める（出現の魔法陣のまま） */
function split(state: GameState, boss: Enemy): Enemy[] {
  boss.phase = "chase";
  boss.attackCooldown = 999;
  boss.hp = Math.floor(boss.maxHp * KS.phase2Ratio);
  tick(state);
  const splits = splitsOf(state, boss);
  for (const s of splits) s.phaseTimer = 999;
  return splits;
}

/** 第 2 段階で呑みの予備動作から着地まで進める（冠でない分裂体が相手） */
function swallowOnce(state: GameState, boss: Enemy): void {
  const ai = aiOf(boss);
  boss.phase = "recover";
  boss.phaseTimer = FIXED_DT / 2;
  ai.timer = KS.swallowEvery;
  tick(state);
  expect(ai.move, "間隔が来たら呑む").toBe(KS_SWALLOW);
  boss.attackCooldown = 0;
  tickUntil(state, () => (ai.digest ?? 0) > 0);
}

/** 段階 3 の階（分裂を飛ばして段階だけ進める） */
function stage3Floor(dx = -70): { state: GameState; boss: Enemy } {
  const { state, boss } = kingFloor(dx);
  aiOf(boss).stage = 3;
  boss.phase = "chase";
  boss.attackCooldown = 999;
  return { state, boss };
}

function shockwaves(state: GameState, boss: Enemy): number {
  return state.hazards.filter((h) => h.kind === "shockwave" && h.sourceId === boss.id).length;
}

describe("スライム王: 第 1 段階（跳躍）", () => {
  it("高い跳躍の予備動作の間は黄で、上昇の後に王の体が影の真上にいる。落下は赤", () => {
    const { state, boss } = kingFloor();
    arm(boss, KS_JUMP);
    tickUntil(state, () => phaseOf(boss) === "windup", jiggle(state));
    expect(boss.phase).toBe("windup");
    const shadow = state.hazards.find((h) => h.kind === "landing" && h.sourceId === boss.id);
    expect(shadow, "影が出る").toBeDefined();
    expect(shadow?.radius).toBe(KS.shockRadius);
    expect(boss.windupTotal, "上昇と滞空").toBeGreaterThan(KS.jumpRise);
    let yellowSteps = 0;
    tickUntil(
      state,
      () => phaseOf(boss) === "strike",
      (i) => {
        jiggle(state)(i);
        if (phaseOf(boss) !== "windup") return;
        expect(windupCommitted(boss), "予備動作の間はずっと黄").toBe(false);
        yellowSteps++;
      },
    );
    expect(yellowSteps, "黄が続いた").toBeGreaterThan(MID_WINDUP_STEPS);
    expect(boss.phase).toBe("strike");
    expect(dist(boss.body.pos, aiOf(boss).target), "影の真上に着いている").toBeLessThan(1);
    expect(attackCommitted(boss), "落下は赤").toBe(true);
    expect(boss.phaseTimer, "落ちる秒").toBeLessThanOrEqual(KS.jumpFall);
  });

  it("空中の絵: 予備動作は空中の姿勢で上昇、攻撃は落下の姿勢で降りる", () => {
    const { state, boss } = kingFloor();
    arm(boss, KS_JUMP);
    tickUntil(state, () => phaseOf(boss) === "windup", jiggle(state));
    expect(kingSlimePose(boss)).toBe("air");
    tick(state, RISE_STEPS, jiggle(state));
    expect(kingSlimeLift(boss, state.depth), "滞空は持ち上がっている").toBe(1);
    tickUntil(state, () => phaseOf(boss) === "strike", jiggle(state));
    expect(kingSlimePose(boss)).toBe("fall");
    expect(kingSlimeLift(boss, state.depth), "落ち始めは高い").toBeGreaterThan(0.5);
    tickUntil(state, () => phaseOf(boss) !== "strike", jiggle(state));
    expect(kingSlimeLift(boss, state.depth), "着地").toBe(0);
  });

  it("黄のうちに出端を入れると墜落: 攻撃が取り消され、影が消え、衝撃波が出ず、ダウンは dropDown 秒", () => {
    const { state, boss } = kingFloor();
    arm(boss, KS_JUMP);
    tickUntil(state, () => phaseOf(boss) === "windup", jiggle(state));
    tick(state, MID_WINDUP_STEPS, jiggle(state));
    expect(yellowAt(boss, state.time), "黄のうち").toBe(true);
    const hp = state.player.hp;
    bossOnAnswer(state, boss, "debana");
    expect(isStaggered(boss), "墜落でダウン").toBe(true);
    expect(boss.phase, "攻撃は取り消された").toBe("chase");
    expect(findStatus(boss.status, "stagger")?.time ?? 0, "ダウンの秒").toBeGreaterThan(KS.dropDown - 2 * FIXED_DT);
    expect(state.boss?.answers?.["墜落"], "答えとして数える").toBe(1);
    expect(aiOf(boss).progress, "段階 1 の墜落は数える").toBe(1);
    tick(state, 2);
    expect(state.hazards.some((h) => h.kind === "landing" && h.sourceId === boss.id), "影が消える").toBe(false);
    tick(state, Math.ceil((KS.dropDown + 0.5) / FIXED_DT));
    expect(shockwaves(state, boss), "衝撃波は出ない").toBe(0);
    expect(state.player.hp, "潰されない").toBe(hp);
  });

  it("黄で振り始めて落下（赤）で当たった遅れた出端は、着地の衝撃波は出て、その後に墜落のダウン", () => {
    const { state, boss } = kingFloor();
    arm(boss, KS_JUMP);
    tickUntil(state, () => phaseOf(boss) === "strike", jiggle(state));
    tick(state, 1, jiggle(state));
    expect(yellowAt(boss, state.time), "落下は赤").toBe(false);
    bossOnAnswer(state, boss, "debana");
    expect(boss.phase, "攻撃は止まらない").toBe("strike");
    expect(isStaggered(boss), "まだダウンしていない").toBe(false);
    tickUntil(state, () => phaseOf(boss) !== "strike", jiggle(state));
    expect(shockwaves(state, boss), "着地の衝撃波は出る").toBeGreaterThan(0);
    expect(isStaggered(boss), "着地の直後に墜落のダウン").toBe(true);
    expect(state.boss?.answers?.["墜落"]).toBe(1);
    expect(aiOf(boss).progress, "段階 1 の墜落は数える").toBe(1);
  });

  it("遅れた出端が 1 つの跳びに何度入っても、墜落は 1 つだけ数える", () => {
    const { state, boss } = kingFloor();
    arm(boss, KS_JUMP);
    tickUntil(state, () => phaseOf(boss) === "strike", jiggle(state));
    tick(state, 1, jiggle(state));
    bossOnAnswer(state, boss, "debana");
    bossOnAnswer(state, boss, "debana");
    bossOnAnswer(state, boss, "debana");
    expect(aiOf(boss).progress, "1 跳びに 1 つ").toBe(1);
    tickUntil(state, () => phaseOf(boss) !== "strike", jiggle(state));
    expect(state.boss?.answers?.["墜落"], "答えの記録も 1 つ").toBe(1);
  });

  it("継続ダメージ（燃焼）が黄の間に入っても墜落しない", () => {
    const { state, boss } = kingFloor();
    arm(boss, KS_JUMP);
    tickUntil(state, () => phaseOf(boss) === "windup", jiggle(state));
    applyStatus(state, { kind: "enemy", enemy: boss }, { kind: "burn", stacks: 1, duration: 5, potency: 4 }, "player");
    const hp = boss.hp;
    tickUntil(state, () => phaseOf(boss) === "strike", jiggle(state));
    expect(boss.hp, "燃焼は入っている").toBeLessThan(hp);
    expect(isStaggered(boss), "墜落しない").toBe(false);
    expect(aiOf(boss).progress ?? 0).toBe(0);
    expect(state.boss?.answers).toBeUndefined();
  });

  it("実際の一振り: 黄のうちに振り始めると墜落。赤になってから振り始めると墜落せず着地する", () => {
    const run = (waitForRed: boolean): { staggered: boolean; waves: number; answers: number } => {
      const state = arena(7);
      state.player.maxHp = HUGE_HP;
      state.player.hp = HUGE_HP;
      const boss = placeEnemy(state, "kingSlime", 40);
      boss.hp = HUGE_HP;
      boss.maxHp = HUGE_HP;
      state.boss = { enemyId: boss.id, name: "スライム王", roomIndex: 0, introTimer: 0, defeated: false, major: true, lockedAt: 0 };
      const ai = aiOf(boss);
      ai.stage = 1;
      arm(boss, KS_JUMP);
      let waves = 0;
      let pressed = false;
      let staggered = false;
      for (let i = 0; i < 200; i++) {
        const ready = waitForRed ? boss.phase === "strike" : boss.phase === "windup";
        const press: boolean = Boolean(ready) && !pressed;
        pressed ||= press;
        step(state, { ...EMPTY_INPUT, move: { ...EMPTY_INPUT.move }, attackPressed: press }, FIXED_DT);
        state.player.invulnTimer = 0;
        if (isStaggered(boss)) staggered = true;
        waves = Math.max(waves, shockwaves(state, boss));
      }
      return { staggered, waves, answers: state.boss?.answers?.["墜落"] ?? 0 };
    };
    const yellow = run(false);
    expect(yellow.answers, "黄で振って墜落").toBe(1);
    expect(yellow.staggered).toBe(true);
    expect(yellow.waves, "衝撃波は出ない").toBe(0);
    const red = run(true);
    expect(red.answers, "赤で振っても墜落しない").toBe(0);
    expect(red.waves, "着地した").toBeGreaterThan(0);
  });

  it("静止していると着地の直後にもう 1 度跳ぶ（続け跳びは最初から赤で、墜落しない）", () => {
    const { state, boss } = kingFloor();
    arm(boss, KS_JUMP);
    tickUntil(state, () => phaseOf(boss) === "strike");
    tickUntil(state, () => phaseOf(boss) !== "strike");
    expect(boss.phase, "硬直を挟まない").toBe("windup");
    expect(boss.ai?.move).toBe(KS_JUMP);
    expect(boss.ai?.chain).toBe(1);
    expect(windupCommitted(boss), "最初からコミット").toBe(true);
    expect(yellowAt(boss, state.time + FIXED_DT), "黄でない").toBe(false);
    bossOnAnswer(state, boss, "debana");
    expect(isStaggered(boss), "続け跳びは墜落しない").toBe(false);
    expect(state.boss?.answers).toBeUndefined();
    tickUntil(state, () => phaseOf(boss) === "strike");
    tickUntil(state, () => phaseOf(boss) !== "strike");
    expect(boss.phase, `stillJumpChain（${KS.stillJumpChain}）回で打ち止め`).toBe("recover");
  });

  it("動いている相手には続けて跳ばない", () => {
    const { state, boss } = kingFloor();
    arm(boss, KS_JUMP);
    tickUntil(state, () => phaseOf(boss) === "strike", jiggle(state));
    tickUntil(state, () => phaseOf(boss) !== "strike", jiggle(state));
    expect(boss.phase).toBe("recover");
  });

  it("墜落 2 回で、生命が phase2Ratio より上でも、起き上がった後に分裂する。ダウンの途中では分裂しない", () => {
    const { state, boss } = kingFloor();
    const ai = aiOf(boss);
    const drop = (): void => {
      arm(boss, KS_JUMP);
      tickUntil(state, () => phaseOf(boss) === "windup", jiggle(state));
      tick(state, MID_WINDUP_STEPS, jiggle(state));
      bossOnAnswer(state, boss, "debana");
    };
    drop();
    tickUntil(state, () => !isStaggered(boss), jiggle(state));
    expect(ai.stage, "1 回では分裂しない").toBe(1);
    drop();
    tick(state, 5, jiggle(state));
    expect(isStaggered(boss), "ダウン中").toBe(true);
    expect(ai.stage, "ダウンの途中では分裂しない").toBe(1);
    expect(boss.hp, "生命は保険の閾値より上").toBeGreaterThan(boss.maxHp * KS.phase2Ratio);
    tickUntil(state, () => !isStaggered(boss), jiggle(state));
    tick(state, 2, jiggle(state));
    expect(ai.stage, "起き上がった後に分裂").toBe(2);
    expect(splitsOf(state, boss).length).toBe(KS.splitCount);
    expect(state.boss?.actStages, "行為で進んだ").toEqual([true]);
  });
});

describe("スライム王: 第 2 段階（分裂）", () => {
  it("生命が phase2Ratio を切ると splitCount 体に分裂し（保険 = 行為でない）、第 2 段階の着地は毒沼を残す", () => {
    const { state, boss } = kingFloor();
    const splits = split(state, boss);
    expect(splits.length).toBe(KS.splitCount);
    expect(boss.ai?.stage).toBe(2);
    expect(state.boss?.actStages).toEqual([false]);
    const ai = aiOf(boss);
    arm(boss, KS_JUMP);
    ai.timer = 0;
    tickUntil(state, () => phaseOf(boss) === "strike", jiggle(state));
    tickUntil(state, () => phaseOf(boss) !== "strike", jiggle(state));
    tick(state, 2);
    expect(terrainAt(state, boss.body.pos.x, boss.body.pos.y), "着地点の毒沼").toBe("bog");
  });

  it("分裂で冠はプレイヤーから最も遠い分裂体に付き、同じ配置なら毎回同じ", () => {
    const place = (): { crown: { x: number; y: number }; farthest: boolean } => {
      const { state, boss } = kingFloor(-70, 33);
      const splits = split(state, boss);
      const crown = crownOf(state, boss);
      if (!crown) throw new Error("冠がいない");
      const dCrown = dist(crown.body.pos, state.player.body.pos);
      const farthest = splits.every((s) => dist(s.body.pos, state.player.body.pos) <= dCrown + 1e-9);
      expect(splits.filter((s) => s.defKey === "crownSlime").length, "冠は 1 体").toBe(1);
      expect(crown.maxHp, "冠の生命は王の最大生命から決まる").toBe(Math.round(boss.maxHp * KS.crownHpRatio));
      return { crown: { ...crown.body.pos }, farthest };
    };
    const a = place();
    expect(a.farthest, "最も遠い").toBe(true);
    expect(place().crown, "毎回同じ").toEqual(a.crown);
  });

  it("王が空中の間、冠スライムは動かない。王が地上にいれば王の陰（プレイヤーの反対側）へ歩く", () => {
    const { state, boss } = kingFloor(-120);
    split(state, boss);
    const crown = crownOf(state, boss);
    if (!crown) throw new Error("冠がいない");
    crown.phase = "chase";
    crown.phaseTimer = 0;
    const shade = (): number => {
      const away = normalize(sub(boss.body.pos, state.player.body.pos));
      return dist(crown.body.pos, { x: boss.body.pos.x + away.x * KS.crownShade, y: boss.body.pos.y + away.y * KS.crownShade });
    };
    // 王は動かさず（膨張の待ち）、冠だけが陰へ歩く
    aiOf(boss).move = KS_INFLATE;
    const before = shade();
    tick(state, 30);
    expect(shade(), "陰へ近づく").toBeLessThan(before);
    arm(boss, KS_JUMP);
    tickUntil(state, () => phaseOf(boss) === "windup", jiggle(state));
    const still = { ...crown.body.pos };
    tickUntil(state, () => phaseOf(boss) !== "strike" && phaseOf(boss) !== "windup", jiggle(state));
    expect(crown.body.pos, "王が跳んでいる間は動かない").toEqual(still);
  });

  it("冠スライムを倒すと冠落ち: 王が crownDown 秒ダウン、残りの分裂体は溶けて撃破に数えず、起き上がった後に段階 3", () => {
    const { state, boss } = kingFloor();
    const splits = split(state, boss);
    const crown = crownOf(state, boss);
    if (!crown) throw new Error("冠がいない");
    const poise = boss.poise.damage;
    damageEnemy(state, crown, HUGE_HP, { x: 1, y: 0 }, 0, { kind: "melee" });
    const kills = state.kills;
    tick(state);
    expect(state.boss?.answers?.["冠落ち"], "答えとして数える").toBe(1);
    expect(isStaggered(boss), "冠落ちのダウン").toBe(true);
    expect(findStatus(boss.status, "stagger")?.time ?? 0).toBeGreaterThan(KS.crownDown - 3 * FIXED_DT);
    expect(splitsOf(state, boss).length, "残りは溶ける").toBe(0);
    expect(splits.filter((o) => o !== crown && o.vanished && o.hp <= 0).length, "溶けた = 撃破に数えない").toBe(KS.splitCount - 1);
    expect(state.kills, "溶けても撃破は増えない").toBe(kills);
    expect(boss.poise.damage, "取り巻きの怯み値は入らない").toBe(poise);
    expect(boss.ai?.stage, "ダウンの途中では進まない").toBe(2);
    tickUntil(state, () => !isStaggered(boss));
    tick(state, 2);
    expect(boss.ai?.stage, "起き上がった後に段階 3").toBe(3);
    expect(state.boss?.actStages?.at(-1), "行為で進んだ").toBe(true);
  });

  it("呑みは冠でない分裂体を先に狙い、尽きると冠を呑んで crownHealRatio 回復し、その場で段階 3（失敗の道）", () => {
    const { state, boss } = kingFloor();
    split(state, boss);
    const crown = crownOf(state, boss);
    if (!crown) throw new Error("冠がいない");
    swallowOnce(state, boss);
    expect(crownOf(state, boss), "冠は残る").toBeDefined();
    expect(splitsOf(state, boss).length, "冠でない分裂体を 1 体呑んだ").toBe(KS.splitCount - 1);
    for (const o of splitsOf(state, boss)) if (o.defKey !== "crownSlime") o.hp = 0;
    boss.hp = Math.floor(boss.maxHp * 0.4);
    const hp = boss.hp;
    const ai = aiOf(boss);
    ai.digest = 0;
    boss.phase = "recover";
    boss.phaseTimer = FIXED_DT / 2;
    ai.timer = KS.swallowEvery;
    tick(state);
    boss.attackCooldown = 0;
    tickUntil(state, () => ai.stage === 3);
    expect(ai.stage, "冠呑みで段階 3").toBe(3);
    expect(ai.progress).toBe(CROWN_EATEN);
    expect(crownOf(state, boss), "冠は王へ戻る").toBeUndefined();
    expect(boss.hp, "冠呑みの回復").toBe(hp + Math.round(boss.maxHp * KS.crownHealRatio));
    expect(state.boss?.actStages?.at(-1), "失敗の道").toBe(false);
  });

  it("消化中も王は動き、digestTime 後に回復する（呑みは撃破に数えない）", () => {
    const { state, boss } = kingFloor();
    split(state, boss);
    const kills = state.kills;
    swallowOnce(state, boss);
    expect(splitsOf(state, boss).length, "1 体呑んだ").toBe(KS.splitCount - 1);
    expect(state.kills, "撃破に数えない").toBe(kills);
    boss.hp = Math.floor(boss.maxHp * 0.4);
    const hp = boss.hp;
    const start = { ...boss.body.pos };
    const ai = aiOf(boss);
    let moved = false;
    tickUntil(
      state,
      () => (ai.digest ?? 0) === 0,
      (i) => {
        jiggle(state)(i);
        if (dist(boss.body.pos, start) > 1) moved = true;
      },
    );
    expect(moved, "消化の間も王は動く").toBe(true);
    expect(boss.hp, "消化し終えると回復").toBe(hp + Math.round(KS.swallowHealRatio * boss.maxHp));
  });

  it("消化中にダウンすれば吐き出して回復しない", () => {
    const { state, boss } = kingFloor();
    split(state, boss);
    swallowOnce(state, boss);
    boss.hp = Math.floor(boss.maxHp * 0.4);
    const hp = boss.hp;
    bossDown(state, boss, 0.5, "墜落", "#fff", "answer");
    tick(state, Math.ceil((0.5 + KS.digestTime) / FIXED_DT) + 5);
    expect(boss.ai?.digest ?? 0, "吐き出した").toBe(0);
    expect(boss.hp, "回復しない").toBe(hp);
  });

  it("分裂体を全部倒しただけでは段階 3 に進まない（冠を割るか、冠を呑まれるかで進む）", () => {
    const { state, boss } = kingFloor();
    const splits = split(state, boss);
    for (const s of splits) if (s.defKey !== "crownSlime") s.hp = 0;
    tick(state, 5);
    expect(boss.ai?.stage, "冠が残っている").toBe(2);
    expect(boss.ai?.progress).toBe(0);
  });

  it("生命が phase3Ratio を切ると、冠が残っていても段階 3（保険。冠と分裂体は溶ける）", () => {
    const { state, boss } = kingFloor();
    split(state, boss);
    boss.hp = Math.floor(boss.maxHp * KS.phase3Ratio);
    tick(state);
    expect(boss.ai?.stage).toBe(3);
    expect(splitsOf(state, boss).length, "溶ける").toBe(0);
    expect(state.boss?.actStages?.at(-1), "保険は行為でない").toBe(false);
  });
});

describe("スライム王: 第 3 段階（噛み・膨張）", () => {
  /** 次の技を選ばせる（硬直の終わり） */
  function pick(state: GameState, boss: Enemy): number {
    boss.phase = "recover";
    boss.phaseTimer = FIXED_DT / 2;
    tick(state);
    return aiOf(boss).move;
  }

  function placePlayer(state: GameState, boss: Enemy, dx: number): void {
    const want = { x: boss.body.pos.x + dx, y: boss.body.pos.y };
    state.player.body.pos = findFreeSpot(state, want, state.player.body.radius, 8) ?? want;
  }

  it("近ければ噛み、遠ければ跳躍、中間では中央へ跳んでから膨張（中央にいれば膨張）", () => {
    const { state, boss } = stage3Floor();
    const room0 = state.rooms[boss.roomIndex];
    if (!room0) throw new Error("no room");
    // 中央から離れた所に立たせる（中間で中央へ戻る技の確認）
    const away = rectCenterPx(room0.rect);
    boss.body.pos = findFreeSpot(state, { x: away.x + 4 * TILE_SIZE, y: away.y }, boss.body.radius, 8) ?? away;
    placePlayer(state, boss, 40);
    expect(readPlayer(state, boss).band).toBe("near");
    expect(pick(state, boss), "近い = 噛み").toBe(KS_BITE);
    placePlayer(state, boss, 200);
    expect(readPlayer(state, boss).band).toBe("far");
    expect(pick(state, boss), "遠い = 跳躍").toBe(KS_JUMP);
    placePlayer(state, boss, 100);
    expect(readPlayer(state, boss).band).toBe("mid");
    expect(pick(state, boss), "中間・中央の外 = 中央へ").toBe(KS_CENTER);
    const room = state.rooms[boss.roomIndex];
    if (!room) throw new Error("no room");
    boss.body.pos = rectCenterPx(room.rect);
    placePlayer(state, boss, 100);
    expect(pick(state, boss), "中央にいる = 膨張").toBe(KS_INFLATE);
  });

  it("中央への跳躍は高い跳躍（黄のうちに打てば墜落。膨張が出ない）", () => {
    const { state, boss } = stage3Floor();
    placePlayer(state, boss, 100);
    arm(boss, KS_CENTER);
    tickUntil(state, () => phaseOf(boss) === "windup");
    expect(windupCommitted(boss), "黄").toBe(false);
    tick(state, MID_WINDUP_STEPS);
    bossOnAnswer(state, boss, "debana");
    expect(isStaggered(boss)).toBe(true);
    tickUntil(state, () => !isStaggered(boss));
    expect(state.hazards.some((h) => h.kind === "shockwave" && h.sourceId === boss.id), "膨張は出ない").toBe(false);
    expect(aiOf(boss).progress ?? 0, "段階 3 の墜落は数えない").toBe(0);
  });

  it.each([
    ["噛み", KS_BITE],
    ["膨張", KS_INFLATE],
  ])("%s の予備動作は最初から赤", (_name, move) => {
    const { state, boss } = stage3Floor();
    arm(boss, move);
    tickUntil(state, () => phaseOf(boss) === "windup");
    expect(boss.phase).toBe("windup");
    expect(windupCommitted(boss), "最初から赤").toBe(true);
    expect(yellowAt(boss, state.time + FIXED_DT), "黄でない").toBe(false);
  });

  it("呑みの予備動作は最初から赤", () => {
    const { state, boss } = kingFloor();
    split(state, boss);
    const ai = aiOf(boss);
    boss.phase = "recover";
    boss.phaseTimer = FIXED_DT / 2;
    ai.timer = KS.swallowEvery;
    tick(state);
    boss.attackCooldown = 0;
    tickUntil(state, () => phaseOf(boss) === "windup");
    expect(ai.move).toBe(KS_SWALLOW);
    expect(windupCommitted(boss), "最初から赤").toBe(true);
  });

  /** 噛みの着地までプレイヤーを動かさず、王の方を向けておく */
  function biteLanding(parry: boolean): { state: GameState; boss: Enemy; hp: number } {
    const { state, boss } = stage3Floor(-40);
    arm(boss, KS_BITE);
    const hp = state.player.hp;
    tick(state);
    tickUntil(
      state,
      () => phaseOf(boss) === "recover" || phaseOf(boss) === "chase",
      () => {
        state.player.facing = normalize(sub(boss.body.pos, state.player.body.pos), { x: 1, y: 0 });
        if (parry) state.player.parry.window = PARRY.windowSec;
      },
    );
    return { state, boss, hp };
  }

  it("噛みの着地を受け流すと呑み損ね: 最終段階の答えのダウン（引導の窓）", () => {
    const { state, boss, hp } = biteLanding(true);
    expect(state.player.hp, "噛まれない").toBe(hp);
    expect(isStaggered(boss), "呑み損ねのダウン").toBe(true);
    expect(findStatus(boss.status, "stagger")?.time ?? 0).toBeGreaterThan(KS.biteMissDown - 3 * FIXED_DT);
    expect(boss.ai?.finale, "引導の窓").toBe(true);
    expect(state.boss?.answers?.["呑み損ね"]).toBe(1);
  });

  it("受け流さなければ噛まれて biteDamage の被弾（ダウンしない）", () => {
    const { state, boss, hp } = biteLanding(false);
    expect(hp - state.player.hp, "噛みの被ダメージ").toBeGreaterThanOrEqual(KS.biteDamage);
    expect(isStaggered(boss)).toBe(false);
    expect(state.boss?.answers).toBeUndefined();
  });

  it("引導: 呑み損ねのダウン中に生命 25% 以下へ怯み値 20 以上の一撃で撃破（処刑の出来事は出さない）。他のダウン・生命が多いときは討てない", () => {
    const state = arena(9);
    const make = (): Enemy => {
      const e = placeEnemy(state, "kingSlime", 30);
      e.maxHp = HUGE_HP;
      e.hp = HUGE_HP;
      aiOf(e).stage = 3;
      return e;
    };
    const hit = (e: Enemy, poise: number): void => {
      damageEnemy(state, e, 1, { x: 1, y: 0 }, 0, { kind: "melee", poise });
    };
    const finale = make();
    bossDown(state, finale, 2, "呑み損ね", "#fff", "final");
    finale.hp = Math.floor(finale.maxHp * POISE.executeHpRatioMax);
    hit(finale, POISE.executeMinPoise);
    expect(finale.hp, "引導で撃破").toBe(0);
    expect(state.recent.onExecute, "処刑の出来事は出さない").toBeUndefined();

    const healthy = make();
    bossDown(state, healthy, 2, "呑み損ね", "#fff", "final");
    healthy.hp = Math.floor(healthy.maxHp * 0.3);
    hit(healthy, POISE.executeMinPoise);
    expect(healthy.hp, "生命 30% では討てない").toBeGreaterThan(0);

    const drop = make();
    bossDown(state, drop, 2, "墜落", "#fff", "answer");
    drop.hp = Math.floor(drop.maxHp * 0.1);
    hit(drop, POISE.executeMinPoise);
    expect(drop.hp, "墜落のダウンでは討てない").toBeGreaterThan(0);

    const light = make();
    bossDown(state, light, 2, "呑み損ね", "#fff", "final");
    light.hp = Math.floor(light.maxHp * 0.1);
    hit(light, POISE.executeMinPoise - 1);
    expect(light.hp, "軽い一撃では討てない").toBeGreaterThan(0);
  });

  it("最終段階の答えで怯めなかった（怯みの免疫の間）ときは引導の窓を開かない", () => {
    const state = arena(9);
    const e = placeEnemy(state, "kingSlime", 30);
    aiOf(e).stage = 3;
    // 怯みの直後の免疫（起き上がった直後の噛みを受け流した）
    e.status.immune.stagger = 5;
    expect(bossDown(state, e, 2, "呑み損ね", "#fff", "final"), "怯めない").toBe(false);
    expect(isStaggered(e)).toBe(false);
    expect(aiOf(e).finale, "窓は開かない").toBeUndefined();
  });

  function inflateFloor(): { state: GameState; boss: Enemy; corner: { x: number; y: number } } {
    const { state, boss } = stage3Floor();
    const room = state.rooms[boss.roomIndex];
    if (!room || !boss.ai) throw new Error("no room");
    boss.body.pos = rectCenterPx(room.rect);
    const corner = { x: (room.rect.x + 0.5) * TILE_SIZE, y: (room.rect.y + 0.5) * TILE_SIZE };
    state.player.body.pos = findFreeSpot(state, corner, state.player.body.radius, TILE_SIZE) ?? corner;
    arm(boss, KS_INFLATE);
    return { state, boss, corner };
  }

  it("膨張の衝撃波は waveCount 重で、半径は部屋の四隅に届かない", () => {
    const { state, boss } = inflateFloor();
    const room = state.rooms[boss.roomIndex];
    if (!room) throw new Error("no room");
    const radius = inflateRadius(state, boss);
    const r = room.rect;
    for (const x of [r.x, r.x + r.w]) {
      for (const y of [r.y, r.y + r.h]) {
        expect(radius, "角まで届かない").toBeLessThan(dist(boss.body.pos, { x: x * TILE_SIZE, y: y * TILE_SIZE }));
      }
    }
    const hp = state.player.hp;
    tickUntil(state, () => phaseOf(boss) === "strike");
    expect(kingSlimeLift(boss, state.depth), "膨張は跳ねない").toBe(0);
    const waves = new Set<number>();
    tickUntil(
      state,
      () => phaseOf(boss) === "recover",
      () => {
        for (const h of state.hazards) if (h.kind === "shockwave" && h.sourceId === boss.id) waves.add(h.id);
      },
    );
    tick(state, 1);
    for (const h of state.hazards) if (h.kind === "shockwave" && h.sourceId === boss.id) waves.add(h.id);
    expect(waves.size).toBe(KS.waveCount);
    tick(state, Math.ceil(1 / FIXED_DT));
    expect(state.player.hp, "四隅は安全").toBe(hp);
  });

  it("膨張の後の硬直は inflateRecover 秒（棒立ちの 2.5 秒は無い）", () => {
    const { state, boss } = inflateFloor();
    tickUntil(state, () => phaseOf(boss) === "recover");
    expect(boss.phaseTimer).toBeCloseTo(KS.inflateRecover, 1);
  });
});

describe("スライム王: 決定性", () => {
  it("同じ seed と入力なら同じ技の順", () => {
    const run = (): number[] => {
      const { state, boss } = kingFloor(-90, 33);
      boss.phase = "chase";
      boss.hp = Math.floor(boss.maxHp * KS.phase2Ratio);
      const moves: number[] = [];
      let last: EnemyPhase = phaseOf(boss);
      // 分裂体の攻撃の向きが固まる仕様（aimLock）で呑み込みの進みが少し遅れるので、膨張へ届く余裕を持たせる
      for (let i = 0; i < 3600; i++) {
        // 円を描いて歩く（決まった入力）
        const a = (i / 120) * Math.PI * 2;
        const step = PLAYER.speed * FIXED_DT * 0.5;
        const p = state.player.body.pos;
        const next = { x: p.x + Math.cos(a) * step, y: p.y + Math.sin(a) * step };
        if (!findFreeSpot(state, next, state.player.body.radius, 0)) continue;
        state.player.body.pos = next;
        tick(state);
        const now = phaseOf(boss);
        if (now === "windup" && last !== "windup") moves.push(boss.ai?.move ?? -1);
        last = now;
        if (boss.hp <= 0) break;
        // 呑みが外れ続けても段階 3 を見られるよう、決まった時刻に保険の閾値まで削る
        if (i === 1800) boss.hp = Math.min(boss.hp, Math.floor(boss.maxHp * KS.phase3Ratio));
      }
      return moves;
    };
    const a = run();
    expect(a.length, "技を出している").toBeGreaterThan(3);
    expect(a, "呑みまで進む").toContain(KS_SWALLOW);
    expect(a, "段階 3（噛み）まで進む").toContain(KS_BITE);
    expect(run()).toEqual(a);
  });
});
