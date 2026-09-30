import { describe, expect, it, vi } from "vitest";
import { createGame } from "../core/game";
import { FIXED_DT } from "../core/loop";
import type { Enemy, GameState } from "../core/state";
import { dist } from "../core/vec";
import { enemyDef } from "../data/enemies";
import { BOSS } from "../data/tuning";
import { announceBoss, bossEnemy } from "./boss";
import { KING_SLIME_SIGNATURE } from "./bossKingSlime";
import { type BossHooks, type BossSignature, BOSS_THREATS, distBand, readPlayer, runBossCycle, updateBossRead } from "./bossKit";
import { MIRROR_KNIGHT_SIGNATURE } from "./bossMirrorKnight";
import { OIL_KING_SIGNATURE } from "./bossOilKing";
import { THIEF_KING_SIGNATURE } from "./bossThiefKing";
import { damageEnemy, damagePlayer } from "./combat";
import { createEnemy, updateEnemies } from "./enemies";
import { findFreeSpot, onEnemyDeath } from "./enemyTraits";
import { buildFloor } from "./floor";
import { addPoise, windupCommitted } from "./poise";
import { slayFloorLord } from "./testHelpers";

const HUGE_HP = 1_000_000;
/** 深みの回転の最初のボス（骸骨卿）の深度。署名の技を借りる側に使う */
const BORROWER_DEPTH = BOSS.interval * 5;
const MAX_STEPS = 600;

/** ボス階を作り、部屋を封鎖してプレイヤーをボスの横（dx）に置く */
function bossFloor(depth: number, dx = -70, seed = 21): { state: GameState; boss: Enemy } {
  const state = createGame(seed);
  state.depth = depth;
  buildFloor(state);
  const boss = bossEnemy(state);
  const room = state.rooms[state.boss?.roomIndex ?? -1];
  if (!boss || !room) throw new Error("no boss");
  room.locked = true;
  state.player.maxHp = HUGE_HP;
  state.player.hp = HUGE_HP;
  const want = { x: boss.body.pos.x + dx, y: boss.body.pos.y };
  state.player.body.pos = findFreeSpot(state, want, state.player.body.radius, 80) ?? want;
  return { state, boss };
}

/** 試験用の器: 技の中身は時間だけ決める */
function testHooks(extra: Partial<BossHooks>): BossHooks {
  return {
    approach: () => {},
    beginWindup: (_s, e) => {
      e.phaseTimer = 0.5;
    },
    beginStrike: (_s, e) => {
      e.phaseTimer = 0.1;
    },
    ...extra,
  };
}

describe("ボスの器: 読み", () => {
  it("プレイヤーが止まっていると静止の秒が溜まり、動くと 0 に戻る", () => {
    const { state, boss } = bossFloor(BOSS.interval);
    const steps = 30;
    for (let i = 0; i < steps; i++) updateBossRead(state, boss, FIXED_DT);
    expect(readPlayer(state, boss).stillSec, "止まっていた秒").toBeCloseTo(steps * FIXED_DT, 5);
    state.player.body.pos = { x: state.player.body.pos.x + BOSS.rules.stillSpeed, y: state.player.body.pos.y };
    updateBossRead(state, boss, FIXED_DT);
    expect(readPlayer(state, boss).stillSec, "動いたら 0").toBe(0);
  });

  it("距離で近い / 中 / 遠いに分かれる", () => {
    const r = BOSS.rules;
    expect(distBand(r.nearDist - 1)).toBe("near");
    expect(distBand((r.nearDist + r.farDist) / 2)).toBe("mid");
    expect(distBand(r.farDist + 1)).toBe("far");
    const { state, boss } = bossFloor(BOSS.interval);
    const d = dist(state.player.body.pos, boss.body.pos);
    expect(readPlayer(state, boss).band).toBe(distBand(d));
  });

  it("ダッシュを見てから dashMemory 秒は直近のダッシュとして覚える", () => {
    const { state, boss } = bossFloor(BOSS.interval);
    expect(readPlayer(state, boss).dashedRecently, "見ていない").toBe(false);
    state.player.dashTimer = 0.1;
    updateBossRead(state, boss, FIXED_DT);
    state.player.dashTimer = 0;
    const within = Math.floor(BOSS.rules.dashMemory / FIXED_DT) - 1;
    for (let i = 0; i < within; i++) updateBossRead(state, boss, FIXED_DT);
    expect(readPlayer(state, boss).dashedRecently, "dashMemory 秒以内").toBe(true);
    for (let i = 0; i < 3; i++) updateBossRead(state, boss, FIXED_DT);
    expect(readPlayer(state, boss).dashedRecently, "dashMemory 秒を過ぎた").toBe(false);
  });
});

describe("ボスの器: 技の選びと動きの語彙", () => {
  it("pickMove があれば並びより優先し、乱数を引かない", () => {
    const { state, boss } = bossFloor(BOSS.interval);
    const def = enemyDef(boss.defKey);
    const picked = 7;
    const hooks = testHooks({ sequence: () => [3, 4], pickMove: () => picked });
    boss.phase = "recover";
    boss.phaseTimer = FIXED_DT / 2;
    const spies = [vi.spyOn(state.rng, "next"), vi.spyOn(state.rng, "int"), vi.spyOn(state.rng, "chance"), vi.spyOn(state.rng, "pick")];
    runBossCycle(state, boss, def, FIXED_DT, hooks);
    expect(boss.ai?.move, "pickMove の技").toBe(picked);
    expect(boss.phase).toBe("chase");
    for (const spy of spies) expect(spy, "乱数を引かない").not.toHaveBeenCalled();
    for (const spy of spies) spy.mockRestore();
  });

  it("pickMove が無ければ並びの次", () => {
    const { state, boss } = bossFloor(BOSS.interval);
    const hooks = testHooks({ sequence: () => [3, 4] });
    boss.phase = "recover";
    boss.phaseTimer = FIXED_DT / 2;
    if (boss.ai) boss.ai.counter = 0;
    runBossCycle(state, boss, enemyDef(boss.defKey), FIXED_DT, hooks);
    expect(boss.ai?.move).toBe(4);
  });

  it("followUp の続きは硬直を挟まず、予備動作は最初からコミット（怯み値が溜まらない）", () => {
    const { state, boss } = bossFloor(BOSS.interval);
    const hooks = testHooks({ followUp: (_s, e) => ((e.ai?.chain ?? 0) === 0 ? 1 : null) });
    boss.phase = "chase";
    boss.attackCooldown = 0;
    runBossCycle(state, boss, enemyDef(boss.defKey), FIXED_DT, hooks);
    expect(boss.phase).toBe("windup");
    expect(boss.chainWindup, "最初の予備動作はコミットしていない").toBe(false);
    boss.phase = "strike";
    boss.phaseTimer = FIXED_DT / 2;
    runBossCycle(state, boss, enemyDef(boss.defKey), FIXED_DT, hooks);
    expect(boss.phase, "硬直を挟まない").toBe("windup");
    expect(boss.ai?.move).toBe(1);
    expect(boss.ai?.chain).toBe(1);
    expect(boss.phaseTimer, "続きの予備動作は短い").toBeCloseTo(0.5 * BOSS.rules.chainWindupMul, 5);
    expect(windupCommitted(boss), "最初からコミット").toBe(true);
    const before = boss.poise.damage;
    addPoise(state, boss, boss.poise.max * 0.5, { fromBehind: false });
    expect(boss.poise.damage, "怯み値が溜まらない").toBe(before);
    // 2 段目の終わりは続かず硬直へ
    boss.phase = "strike";
    boss.phaseTimer = FIXED_DT / 2;
    runBossCycle(state, boss, enemyDef(boss.defKey), FIXED_DT, hooks);
    expect(boss.phase).toBe("recover");
  });

  it("recoverRetreatMul があると硬直の間にプレイヤーから離れる", () => {
    const { state, boss } = bossFloor(BOSS.interval, 40);
    const def = enemyDef(boss.defKey);
    const d0 = dist(state.player.body.pos, boss.body.pos);
    boss.phase = "recover";
    boss.phaseTimer = 10;
    for (let i = 0; i < 20; i++) runBossCycle(state, boss, def, FIXED_DT, testHooks({ recoverRetreatMul: () => 1 }));
    expect(dist(state.player.body.pos, boss.body.pos)).toBeGreaterThan(d0);
    const still = { ...boss.body.pos };
    for (let i = 0; i < 20; i++) runBossCycle(state, boss, def, FIXED_DT, testHooks({}));
    expect(boss.body.pos, "省略なら動かない").toEqual(still);
  });

  it("BOSS_THREATS: 章ボス 4 と最深の主は段階が 3 つで、隣り合う段階の危ない間合いが違う", () => {
    for (const key of ["kingSlime", "thiefKing", "oilKing", "mirrorKnight", "deepLord"]) {
      const bands = BOSS_THREATS[key];
      expect(bands, key).toBeDefined();
      if (!bands) continue;
      expect(bands.length, key).toBe(3);
      expect(bands[0], `${key} 1→2`).not.toBe(bands[1]);
      expect(bands[1], `${key} 2→3`).not.toBe(bands[2]);
    }
  });
});

describe("ボスの器: 取り巻きの怯み値と記録", () => {
  /** ボス部屋（または部屋 roomIndex）に敵を置いて倒す */
  function killIn(state: GameState, key: string, roomIndex: number): void {
    const def = enemyDef(key);
    const at = state.player.body.pos;
    const e = createEnemy(state, def, { ...at }, roomIndex, false);
    state.enemies.push(e);
    e.hp = 0;
    onEnemyDeath(state, e, def);
  }

  it("ボス部屋の取り巻きを倒すとボスに怯み値が入り、卵・地雷・置物・ボス部屋の外の敵では入らない", () => {
    const { state, boss } = bossFloor(BOSS.interval);
    const roomIndex = state.boss?.roomIndex ?? -1;
    boss.phase = "chase";
    for (const key of ["broodEgg", "enemyMine", "icePillar"]) {
      killIn(state, key, roomIndex);
      expect(boss.poise.damage, key).toBe(0);
    }
    killIn(state, "slime", roomIndex === 0 ? 1 : 0);
    expect(boss.poise.damage, "部屋の外").toBe(0);
    killIn(state, "slime", roomIndex);
    expect(boss.poise.damage, "ボス部屋の取り巻き").toBeGreaterThan(0);
  });

  it("封鎖中の被弾を数え、撃破で bossLog に key・深度・秒・被弾・ダウンが 1 件積まれる", () => {
    const { state, boss } = bossFloor(BOSS.interval);
    announceBoss(state);
    const fight = 12;
    state.floorTime += fight;
    for (let i = 0; i < 2; i++) {
      state.player.invulnTimer = 0;
      damagePlayer(state, 1, boss.body.pos, boss);
    }
    boss.poise.downs = 1;
    damageEnemy(state, boss, boss.hp + 1, { x: 1, y: 0 }, 0);
    updateEnemies(state, FIXED_DT);
    expect(state.bossLog).toEqual([{ key: "kingSlime", depth: BOSS.interval, seconds: fight, hits: 2, downs: 1 }]);
  });

  it("階の主（major でない）は bossLog に積まない", () => {
    const state = createGame(21);
    state.depth = 3;
    buildFloor(state);
    expect(state.boss?.major, "階の主がいる階").toBe(false);
    slayFloorLord(state);
    expect(state.boss?.defeated).toBe(true);
    expect(state.bossLog).toEqual([]);
  });
});

describe("章ボスの署名の技", () => {
  const SIGNATURES: readonly BossSignature[] = [KING_SLIME_SIGNATURE, THIEF_KING_SIGNATURE, OIL_KING_SIGNATURE, MIRROR_KNIGHT_SIGNATURE];

  it("章ボス 4 体の key を持つ", () => {
    expect(SIGNATURES.map((s) => s.key)).toEqual(["kingSlime", "thiefKing", "oilKing", "mirrorKnight"]);
  });

  it.each(SIGNATURES.map((s) => [s.key, s] as const))("%s: 予備動作で予告を出し、攻撃で当たる（借り手の技と段階は壊さない）", (_key, sig) => {
    const { state, boss: host } = bossFloor(BORROWER_DEPTH, -50);
    const def = enemyDef(host.defKey);
    const ai = host.ai;
    if (!ai) throw new Error("no ai");
    ai.move = 5;
    ai.stage = 3;
    host.phase = "windup";
    const landings = (): number => state.hazards.filter((h) => h.kind === "landing").length;
    const before = landings();
    sig.beginWindup(state, host, def);
    const warned = landings() > before || (sig.telegraph?.(host) ?? null) !== null;
    expect(host.phaseTimer, "予備動作の長さ").toBeGreaterThan(0);

    const hp = state.player.hp;
    const shots = state.projectiles.filter((p) => p.owner === "enemy").length;
    const minions = state.enemies.length;
    host.phase = "strike";
    sig.beginStrike(state, host, def);
    // 跳躍は跳んだ瞬間の着地点の影が予告（空中の間は無害）
    const airborneShadow = landings() > before && state.player.hp === hp;
    expect(warned || airborneShadow, "当たる前に影か予告の形").toBe(true);
    for (let i = 0; i < MAX_STEPS && host.phaseTimer > 0; i++) {
      host.phaseTimer -= FIXED_DT;
      if (sig.tickStrike?.(state, host, def, FIXED_DT)) break;
    }
    const hurt = state.player.hp < hp;
    const fired = state.projectiles.filter((p) => p.owner === "enemy").length > shots;
    const placed = state.enemies.length > minions;
    expect(hurt || fired || placed, "当たる（被弾・弾・地雷のどれか）").toBe(true);
    expect(ai.move, "借り手の技").toBe(5);
    expect(ai.stage, "借り手の段階").toBe(3);
  });
});
