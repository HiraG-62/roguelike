import { describe, expect, it } from "vitest";
import { createGame } from "../core/game";
import { FIXED_DT } from "../core/loop";
import type { Enemy, EnemyPhase, GameState } from "../core/state";
import { enemyDef } from "../data/enemies";
import { ARC, BOSS } from "../data/tuning";
import { type Rect, TILE_SIZE, rectCenterPx } from "../map/grid";
import { bossArmorBlocks, bossEnemy } from "./boss";
import {
  DL_BEAM,
  DL_BORROW_BASE,
  DL_HAND,
  DL_LUNGE,
  DL_RAIN,
  DL_SLASH,
  PILLAR_ELITES,
  borrowedBosses,
  deepLordCollapsedTiles,
  gatePillarsOf,
} from "./bossDeepLord";
import { damageEnemy } from "./combat";
import { updateEnemies } from "./enemies";
import { findFreeSpot } from "./enemyTraits";
import { buildFloor } from "./floor";
import { updateHazards } from "./hazards";
import { isStaggered, windupCommitted } from "./poise";
import { findStatus, updateStatusEffects } from "./statusEffects";
import { terrainAt, updateTerrain } from "./terrain";

/** 最深の主（system/bossDeepLord.ts。docs/ideas/boss-impl.md 2-6） */

const FINAL_DEPTH = ARC.floorsPerChapter * ARC.maxChapter + 1;
const HUGE_HP = 1_000_000;
const MAX_STEPS = 2400;
const K = BOSS.deepLord;

function lordFloor(dx = -70, seed = 21): { state: GameState; boss: Enemy; rect: Rect } {
  const state = createGame(seed);
  state.depth = FINAL_DEPTH;
  buildFloor(state);
  const boss = bossEnemy(state);
  const room = state.rooms[state.boss?.roomIndex ?? -1];
  if (!boss || !room || boss.defKey !== "deepLord") throw new Error("最深の主がいない");
  room.locked = true;
  state.player.maxHp = HUGE_HP;
  state.player.hp = HUGE_HP;
  const want = { x: boss.body.pos.x + dx, y: boss.body.pos.y };
  state.player.body.pos = findFreeSpot(state, want, state.player.body.radius, 80) ?? want;
  return { state, boss, rect: room.rect };
}

function tick(state: GameState, n = 1, each?: (i: number) => void): void {
  for (let i = 0; i < n; i++) {
    each?.(i);
    updateStatusEffects(state, FIXED_DT);
    updateEnemies(state, FIXED_DT);
    updateHazards(state, FIXED_DT);
    updateTerrain(state, FIXED_DT);
    state.player.invulnTimer = 0;
  }
}

function tickUntil(state: GameState, done: () => boolean, each?: (i: number) => void): void {
  for (let i = 0; i < MAX_STEPS && !done(); i++) tick(state, 1, each);
}

function secs(s: number): number {
  return Math.ceil(s / FIXED_DT);
}

/** 代入で型が絞られた後も読み直せるよう関数にする */
function phaseOf(e: Enemy): EnemyPhase {
  return e.phase;
}

/** プレイヤーを左右に小刻みに動かす（静止とみなされない） */
function jiggle(state: GameState): (i: number) => void {
  return (i) => {
    const dx = i % 2 === 0 ? 2 : -2;
    state.player.body.pos = { x: state.player.body.pos.x + dx, y: state.player.body.pos.y };
  };
}

/** 開戦させる（技は出させない） */
function engage(state: GameState, boss: Enemy): void {
  boss.phase = "chase";
  boss.attackCooldown = 999;
  tick(state);
}

/** 門柱を全部折って第 2 段階へ。門崩れのダウンは外す（陥没の時計を止めない） */
function breakAllPillars(state: GameState, boss: Enemy): void {
  engage(state, boss);
  for (const p of gatePillarsOf(state, boss)) p.hp = 0;
  tick(state);
  boss.status.effects = [];
  boss.phase = "chase";
  boss.attackCooldown = 999;
}

/** 部屋の縁から margin タイル内側の、左の辺の中ほどのタイルの中心 */
function edgeTile(rect: Rect, margin: number): { x: number; y: number } {
  return { x: (rect.x + margin + 0.5) * TILE_SIZE, y: (rect.y + Math.floor(rect.h / 2) + 0.5) * TILE_SIZE };
}

function isLava(state: GameState, pos: { x: number; y: number }): boolean {
  return terrainAt(state, pos.x, pos.y) === "lava";
}

/** 第 3 段階に入れる（技の合間） */
function faceStage(state: GameState, boss: Enemy): void {
  breakAllPillars(state, boss);
  boss.hp = Math.floor(boss.maxHp * K.phase3Ratio);
  tick(state);
}

describe("最深の主: 四門", () => {
  it("部屋の四隅寄りに門柱が 4 本立ち、それぞれ別の精鋭修飾子を持つ", () => {
    const { state, boss, rect } = lordFloor();
    const pillars = gatePillarsOf(state, boss);
    expect(pillars).toHaveLength(4);
    const elites = new Set(pillars.map((p) => p.elite));
    expect(elites.size, "修飾子は 1 本ずつ別").toBe(4);
    for (const kind of elites) expect(PILLAR_ELITES).toContain(kind);
    const c = rectCenterPx(rect);
    const quadrants = new Set(pillars.map((p) => `${Math.sign(p.body.pos.x - c.x)},${Math.sign(p.body.pos.y - c.y)}`));
    expect(quadrants.size, "四隅に 1 本ずつ").toBe(4);
  });

  it("門柱が 1 本でも立つ間は本体にダメージが通らず、本体は中央から動かない", () => {
    const { state, boss } = lordFloor(-160);
    engage(state, boss);
    const start = { ...boss.body.pos };
    const hp = boss.hp;
    expect(bossArmorBlocks(state, boss)).toBe(true);
    damageEnemy(state, boss, 500, { x: 1, y: 0 }, 0, { kind: "melee" });
    expect(boss.hp, "無効").toBe(hp);
    const [first, ...rest] = gatePillarsOf(state, boss);
    if (first) first.hp = 0;
    tick(state);
    expect(rest.length, "3 本残る").toBe(3);
    expect(bossArmorBlocks(state, boss), "残りがある間は無効のまま").toBe(true);
    boss.status.effects = [];
    boss.attackCooldown = 0;
    tick(state, secs(3), jiggle(state));
    expect(boss.body.pos, "四門の間は動かない").toEqual(start);
  });

  it("離れた相手に光線の扇、門柱の近くの相手には落石（門柱にも当たる）", () => {
    const { state, boss } = lordFloor(-110);
    engage(state, boss);
    const ai = boss.ai;
    if (!ai) throw new Error("no ai");
    boss.phase = "recover";
    boss.phaseTimer = FIXED_DT / 2;
    tick(state, 1, jiggle(state));
    expect(ai.move, "離れた相手に光線").toBe(DL_BEAM);
    boss.attackCooldown = 0;
    tickUntil(state, () => phaseOf(boss) === "strike");
    expect(state.hazards.filter((h) => h.kind === "laser" && h.sourceId === boss.id)).toHaveLength(K.beamCount);

    const [pillar] = gatePillarsOf(state, boss);
    if (!pillar) throw new Error("no pillar");
    state.player.body.pos = { x: pillar.body.pos.x + 12, y: pillar.body.pos.y };
    boss.phase = "recover";
    boss.phaseTimer = FIXED_DT / 2;
    tick(state, 1, jiggle(state));
    expect(ai.move, "門柱の近くでは落石").toBe(DL_RAIN);
    const pillarHp = pillar.hp;
    boss.attackCooldown = 0;
    tickUntil(state, () => phaseOf(boss) === "strike");
    expect(pillar.hp, "落石は門柱にも当たる").toBeLessThan(pillarHp);
  });

  it("門柱を折るたびに本体が pillarDown 秒ダウンし、4 本で第 2 段階（HP では進まない）", () => {
    const { state, boss } = lordFloor();
    engage(state, boss);
    boss.hp = 1;
    tick(state);
    expect(boss.ai?.stage, "HP では進まない").toBe(1);
    boss.hp = boss.maxHp;
    for (let i = 1; i <= 4; i++) {
      const [pillar] = gatePillarsOf(state, boss);
      if (pillar) pillar.hp = 0;
      tick(state);
      expect(boss.ai?.progress, "折れた数").toBe(i);
      const stagger = findStatus(boss.status, "stagger");
      expect(stagger?.time ?? 0, "門崩れのダウン").toBeGreaterThan(K.pillarDown - 2 * FIXED_DT);
      tickUntil(state, () => !isStaggered(boss));
    }
    expect(boss.ai?.stage, "4 本で陥没").toBe(2);
    expect(bossArmorBlocks(state, boss), "門柱が無ければ通る").toBe(false);
  });
});

describe("最深の主: 陥没", () => {
  it("collapseEvery 秒ごとに外周から影の後に溶岩へ変わり、collapseSteps 回で止まる", () => {
    const { state, boss, rect } = lordFloor();
    breakAllPillars(state, boss);
    const ring = K.ringTiles;
    expect(state.hazards.some((h) => h.kind === "landing"), "崩れる床の影").toBe(true);
    expect(isLava(state, edgeTile(rect, 0)), "影の間はまだ床").toBe(false);
    tick(state, secs(K.collapseWarn) + 2);
    expect(isLava(state, edgeTile(rect, 0)), "1 回目の外周").toBe(true);
    expect(isLava(state, edgeTile(rect, ring - 1)), "1 回目の外周の内側の縁").toBe(true);
    expect(isLava(state, edgeTile(rect, ring)), "2 回目はまだ").toBe(false);
    tick(state, secs(K.collapseEvery));
    expect(isLava(state, edgeTile(rect, ring)), "2 回目の外周").toBe(true);
    tick(state, secs(K.collapseEvery * 3));
    expect(isLava(state, edgeTile(rect, ring * K.collapseSteps)), "collapseSteps 回で止まる").toBe(false);
    expect(deepLordCollapsedTiles(state, boss)).toBe(ring * K.collapseSteps);
  });

  it("陥没中の最深の主は溶岩の上へ歩かない", () => {
    const { state, boss, rect } = lordFloor();
    breakAllPillars(state, boss);
    tick(state, secs(K.collapseEvery * K.collapseSteps + K.collapseWarn));
    // プレイヤーを溶岩の角に置き、追わせる
    state.player.body.pos = edgeTile(rect, 0);
    const inset = K.ringTiles * K.collapseSteps * TILE_SIZE;
    let onLava = false;
    let outside = false;
    tick(state, secs(8), () => {
      if (isLava(state, boss.body.pos)) onLava = true;
      if (boss.body.pos.x < rect.x * TILE_SIZE + inset) outside = true;
    });
    expect(onLava, "溶岩の上に乗らない").toBe(false);
    expect(outside, "崩れた外周へ出ない").toBe(false);
  });

  it("近いと 3 段の連撃（2 段目からコミット）と長い硬直", () => {
    const { state, boss } = lordFloor(-30);
    breakAllPillars(state, boss);
    const ai = boss.ai;
    if (!ai) throw new Error("no ai");
    ai.move = DL_SLASH;
    boss.attackCooldown = 0;
    const move = jiggle(state);
    tickUntil(state, () => phaseOf(boss) === "strike", move);
    for (let chain = 1; chain < K.slashCount; chain++) {
      tickUntil(state, () => phaseOf(boss) !== "strike", move);
      expect(boss.phase, "硬直を挟まない").toBe("windup");
      expect(ai.chain).toBe(chain);
      expect(windupCommitted(boss), "続きは最初からコミット").toBe(true);
      tickUntil(state, () => phaseOf(boss) === "strike", move);
    }
    tickUntil(state, () => phaseOf(boss) !== "strike", move);
    expect(boss.phase, "3 段で終わる").toBe("recover");
    expect(boss.phaseTimer, "長い硬直").toBeGreaterThan(enemyDef("deepLord").recover * K.slashRecoverMul - 2 * FIXED_DT);
  });

  it("遠いと踏み込み、止まっていると落石", () => {
    const { state, boss } = lordFloor(-170);
    breakAllPillars(state, boss);
    const ai = boss.ai;
    if (!ai) throw new Error("no ai");
    boss.phase = "recover";
    boss.phaseTimer = FIXED_DT / 2;
    tick(state, 1, jiggle(state));
    expect(ai.move, "遠い相手に踏み込み").toBe(DL_LUNGE);
    boss.phase = "recover";
    boss.phaseTimer = secs(1) * FIXED_DT;
    tick(state, secs(1) + 1);
    expect(ai.move, "止まっている相手に落石").toBe(DL_RAIN);
  });
});

describe("最深の主: 第三の顔", () => {
  it("借りるのは bossLog の被弾の多い章ボス 2 体、記録が無ければ章の順", () => {
    const { state } = lordFloor();
    const chapterKeys = ARC.chapters.map((c) => c.boss);
    expect(borrowedBosses(state), "記録が無ければ章の順").toEqual(chapterKeys.slice(0, 2));
    const rec = (key: string, hits: number) => ({ key, depth: 5, seconds: 60, hits, downs: 2 });
    state.bossLog = [rec("kingSlime", 2), rec("thiefKing", 0), rec("oilKing", 5), rec("mirrorKnight", 5)];
    expect(borrowedBosses(state), "被弾の多い順（同数は章の順）").toEqual(["oilKing", "mirrorKnight"]);
    state.bossLog = [rec("mirrorKnight", 1)];
    expect(borrowedBosses(state), "足りなければ章の順で埋める").toEqual(["mirrorKnight", "kingSlime"]);
  });

  it("奈落の手 → 借りた技 A → 連撃か踏み込み → 借りた技 B を巡る", () => {
    const { state, boss } = lordFloor(-170);
    const rec = (key: string, hits: number) => ({ key, depth: 5, seconds: 60, hits, downs: 2 });
    state.bossLog = [rec("oilKing", 5), rec("mirrorKnight", 3)];
    faceStage(state, boss);
    const ai = boss.ai;
    if (!ai) throw new Error("no ai");
    expect(ai.stage).toBe(3);
    const seen = [ai.move];
    for (let i = 0; i < 4; i++) {
      boss.status.effects = [];
      boss.phase = "recover";
      boss.phaseTimer = FIXED_DT / 2;
      boss.attackCooldown = 999;
      tick(state, 1, jiggle(state));
      seen.push(ai.move);
    }
    const oil = DL_BORROW_BASE + ARC.chapters.findIndex((c) => c.boss === "oilKing");
    const mirror = DL_BORROW_BASE + ARC.chapters.findIndex((c) => c.boss === "mirrorKnight");
    expect(seen).toEqual([DL_HAND, oil, DL_LUNGE, mirror, DL_HAND]);
  });

  it("奈落の手はプレイヤーの足元へ影を順に落とし、止まっていると当たり、動き続ければ当たらない", () => {
    const still = lordFloor(-60);
    faceStage(still.state, still.boss);
    const hpBefore = still.state.player.hp;
    let shadows = 0;
    still.boss.attackCooldown = 0;
    tickUntil(still.state, () => phaseOf(still.boss) === "strike");
    tickUntil(
      still.state,
      () => phaseOf(still.boss) !== "strike",
      () => {
        shadows = Math.max(shadows, (still.boss.ai?.points ?? []).length);
      },
    );
    expect(shadows, "handCount 個の影").toBe(K.handCount);
    expect(still.state.player.hp, "止まっていると当たる").toBeLessThan(hpBefore);

    const moving = lordFloor(-60);
    faceStage(moving.state, moving.boss);
    const center = { ...moving.state.player.body.pos };
    const radius = 50;
    const omega = 2.4;
    let t = 0;
    const circle = (): void => {
      t += FIXED_DT;
      moving.state.player.body.pos = { x: center.x + Math.cos(omega * t) * radius, y: center.y + Math.sin(omega * t) * radius };
    };
    const hp = moving.state.player.hp;
    moving.boss.attackCooldown = 0;
    tickUntil(moving.state, () => phaseOf(moving.boss) === "strike", circle);
    tickUntil(moving.state, () => phaseOf(moving.boss) !== "strike", circle);
    expect(moving.state.player.hp, "動き続ければ当たらない").toBe(hp);
  });

  it("借りた技の後は反動のダウン", () => {
    const { state, boss } = lordFloor(-60);
    faceStage(state, boss);
    const ai = boss.ai;
    if (!ai) throw new Error("no ai");
    ai.move = DL_BORROW_BASE + ARC.chapters.findIndex((c) => c.boss === "kingSlime");
    boss.attackCooldown = 0;
    tickUntil(state, () => phaseOf(boss) === "strike");
    expect(state.hazards.some((h) => h.kind === "landing"), "借りた技の予告（跳躍の影）").toBe(true);
    tickUntil(state, () => phaseOf(boss) !== "strike");
    const stagger = findStatus(boss.status, "stagger");
    expect(stagger?.time ?? 0, "反動").toBeGreaterThan(K.borrowRecoil - 2 * FIXED_DT);
    expect(ai.stage, "借り手の段階は壊れない").toBe(3);
  });
});

describe("最深の主: 後始末と決定性", () => {
  it("倒れると残った門柱と崩れる予約が消え、陥没の溶岩も collapseFade 秒で消える。階段は溶岩にならない", () => {
    const { state, boss, rect } = lordFloor();
    breakAllPillars(state, boss);
    tick(state, secs(K.collapseWarn) + 2);
    expect(isLava(state, edgeTile(rect, 0))).toBe(true);
    boss.hp = 0;
    tick(state);
    expect(state.boss?.defeated).toBe(true);
    expect((state.terrainSeeds ?? []).some((s) => s.kind === "lava"), "崩れる予約は取り消す").toBe(false);
    tick(state, secs(K.collapseFade) + 2);
    expect(isLava(state, edgeTile(rect, 0)), "溶岩は消える").toBe(false);
    expect(isLava(state, rectCenterPx(rect)), "階段").toBe(false);
  });

  it("門柱が残ったまま倒れても門柱は残らない", () => {
    const { state, boss } = lordFloor();
    engage(state, boss);
    boss.hp = 0;
    tick(state);
    expect(gatePillarsOf(state, boss), "門柱は消える").toHaveLength(0);
    expect(state.enemies.some((e) => e.defKey === "gatePillar"), "撃破扱いにせず消す").toBe(false);
  });

  it("階を出ると門柱も崩れる予約も残らない", () => {
    const { state, boss } = lordFloor();
    breakAllPillars(state, boss);
    expect((state.terrainSeeds ?? []).length).toBeGreaterThan(0);
    state.depth = FINAL_DEPTH + 1;
    buildFloor(state);
    tick(state);
    expect(state.enemies.some((e) => e.defKey === "gatePillar")).toBe(false);
    expect((state.terrainSeeds ?? []).some((s) => s.depth === FINAL_DEPTH), "前の階の予約は捨てる").toBe(false);
  });

  it("同じ seed と入力なら同じ結果", () => {
    const run = (): string => {
      const { state, boss } = lordFloor(-100, 33);
      boss.phase = "chase";
      boss.attackCooldown = 0;
      const moves: number[] = [];
      tick(state, secs(40), (i) => {
        if (i === secs(3)) for (const p of gatePillarsOf(state, boss).slice(0, 2)) p.hp = 0;
        if (i === secs(8)) for (const p of gatePillarsOf(state, boss)) p.hp = 0;
        if (i === secs(20)) boss.hp = Math.floor(boss.maxHp * K.phase3Ratio);
        const dx = Math.sin(i / 30) * 2;
        state.player.body.pos = { x: state.player.body.pos.x + dx, y: state.player.body.pos.y };
        if (moves[moves.length - 1] !== boss.ai?.move) moves.push(boss.ai?.move ?? -1);
      });
      const b = boss.body.pos;
      return [boss.ai?.stage, moves.join(","), b.x.toFixed(3), b.y.toFixed(3), boss.hp, state.player.hp, state.hazards.length].join("|");
    };
    const a = run();
    expect(a.startsWith("3|"), "第三の顔まで進む").toBe(true);
    expect(run()).toBe(a);
  });
});
