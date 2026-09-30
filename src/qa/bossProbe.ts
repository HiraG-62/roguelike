import { createGame, step } from "../core/game";
import { FIXED_DT } from "../core/loop";
import type { Enemy, GameState } from "../core/state";
import { ARC, BOSS } from "../data/tuning";
import { rectCenterPx } from "../map/grid";
import { computeStats } from "../loot/stats";
import { bossEnemy, bossKeyForDepth } from "../system/boss";
import { findFreeSpot } from "../system/enemyTraits";
import { buildFloor } from "../system/floor";
import { applyStats } from "../system/player";
import { botInput, createBotState } from "./bot";
import {
  BOSS_STAGE_COUNT,
  type BossFight,
  type BossOutcome,
  buildBossProbeLines,
  emptyStageHits,
  isIndirectHurt,
  noteStageHit,
  stageAdvancedByAct,
} from "./bossMetrics";
import { fittedEquipment } from "./gearPower";

/**
 * ボスの 1 体ずつの計測（docs/ideas/boss-impl.md 5 章。`npm run qa:probe -- --bosses`）。
 * 深度相応の装備のプレイヤー（qa/bot.ts）をボス部屋へ置き、封鎖から撃破 / 死亡 / 打ち切りまでの実際の step を回して数える。
 * ゲームのロジックは変えない。同じ seed なら同じ結果（bot の乱数は seed から作る専用のもの）
 */

/** 部屋に置いたプレイヤーがボスとの封鎖（announceBoss）を起こすまで待つ秒。これを過ぎても封鎖しなければ測れなかった戦いにする */
const LOCK_WAIT_SECONDS = 5;
/** プレイヤーを置く位置: ボスの左へ（px）。ボスの近い間合い（nearDist）の外・遠い間合い（farDist）の内 */
const START_OFFSET = -110;
/** bot の乱数の seed の混ぜ値（simulation.test.ts の runOnce と同じ式の定数） */
const BOT_SEED_MUL = 2654435761;
const BOT_SEED_ADD = 12345;
/** 取り巻きの撃破に数えない、ボス本人の 1 体 */
const BOSS_OWN_KILLS = 1;
/** 段階を書き出す 1 始まりの番号の下限と上限 */
const FIRST_STAGE = 1;

export interface BossProbeTarget {
  key: string;
  depth: number;
}

export interface BossProbeConfig {
  bosses: readonly BossProbeTarget[];
  seeds: readonly number[];
  /** 封鎖から数える制限時間（秒） */
  maxSeconds: number;
  /** 表の見出しの下に出す 1 行（測り方の説明） */
  caption: string;
}

/** 章ボス 4（各章の最後の階）と最深の主（最深の間）。key は bossKeyForDepth で確かめる */
function probeTargets(): BossProbeTarget[] {
  const depths = ARC.chapters.map((_, i) => ARC.floorsPerChapter * (i + 1));
  depths.push(ARC.floorsPerChapter * ARC.maxChapter + 1);
  return depths.map((depth) => ({ key: bossKeyForDepth(depth), depth }));
}

const FULL_SEED_COUNT = 5;
const FULL_MAX_SECONDS = 300;
const SMOKE_MAX_SECONDS = 30;

export const FULL_BOSS_PROBE_CONFIG: BossProbeConfig = {
  bosses: probeTargets(),
  seeds: Array.from({ length: FULL_SEED_COUNT }, (_, i) => i + 1),
  maxSeconds: FULL_MAX_SECONDS,
  caption: `章ボス 4 と最深の主 × seed ${FULL_SEED_COUNT}。封鎖から最長 ${FULL_MAX_SECONDS} 秒。装備は深度相応（itemLevel = 深度の並の遺物 6 部位）`,
};

/** 縮小版: 5 体 × 1 seed を 30 秒だけ（`npm run check:fast` の中で数秒） */
export const SMOKE_BOSS_PROBE_CONFIG: BossProbeConfig = {
  bosses: probeTargets(),
  seeds: [1],
  maxSeconds: SMOKE_MAX_SECONDS,
  caption: `縮小版: 5 体 × seed 1。封鎖から最長 ${SMOKE_MAX_SECONDS} 秒`,
};

/** ボス階を作り、深度相応の装備のプレイヤーをボスの左に置く（部屋に入った形。封鎖は step が起こす） */
function makeBossArena(seed: number, depth: number, key: string): { state: GameState; boss: Enemy } {
  const state = createGame(seed);
  state.depth = depth;
  buildFloor(state);
  applyStats(state, computeStats(fittedEquipment(seed, depth), depth));
  state.player.hp = state.player.maxHp;
  state.player.dashChargesLeft = state.stats.dashCharges;
  const boss = bossEnemy(state);
  const room = state.rooms[state.boss?.roomIndex ?? -1];
  if (!boss || !room || boss.defKey !== key) throw new Error(`深度 ${depth} のボス部屋に ${key} がいない`);
  const want = { x: rectCenterPx(room.rect).x + START_OFFSET, y: rectCenterPx(room.rect).y };
  state.player.body.pos = findFreeSpot(state, want, state.player.body.radius, 80) ?? want;
  return { state, boss };
}

/** 段階（1 始まり）を段階配列の添字に直す（3 段階に収まらない値は端に寄せる） */
function stageIndex(stage: number): number {
  return Math.min(BOSS_STAGE_COUNT, Math.max(FIRST_STAGE, stage)) - FIRST_STAGE;
}

function emptyFight(key: string, depth: number, seed: number): BossFight {
  return {
    key,
    depth,
    seed,
    outcome: "unlocked",
    seconds: 0,
    hits: 0,
    downs: 0,
    stageSeconds: Array<number>(BOSS_STAGE_COUNT).fill(0),
    stageHits: Array.from({ length: BOSS_STAGE_COUNT }, emptyStageHits),
    transitions: [],
    minionKills: 0,
  };
}

/** step をまたいで持つ直前の値 */
interface StepMemory {
  hits: number;
  stage: number;
  time: number;
}

/** 1 step ぶんの観測（ボスが生きていて封鎖中のときだけ）。step の後の state を読む */
function observeStep(state: GameState, fight: BossFight, prev: StepMemory): void {
  // 秒は state.time の進み（ヒットストップ中は進まない。bossLog の秒と同じ時計）で数える
  const elapsed = state.time - prev.time;
  prev.time = state.time;
  const b = state.boss;
  const e = bossEnemy(state);
  if (!b || !e) return;
  const stage = e.ai?.stage ?? FIRST_STAGE;
  const idx = stageIndex(stage);
  fight.stageSeconds[idx] = (fight.stageSeconds[idx] ?? 0) + elapsed;
  const hits = b.hits ?? 0;
  const tally = fight.stageHits[idx];
  if (tally && hits > prev.hits) {
    const read = e.ai?.read;
    const dist = Math.hypot(state.player.body.pos.x - e.body.pos.x, state.player.body.pos.y - e.body.pos.y);
    for (let n = prev.hits; n < hits; n++) noteStageHit(tally, dist, read?.stillSec ?? 0, isIndirectHurt(state.hurt.last?.kind));
  }
  for (let from = prev.stage; from < stage; from++) {
    const byAct = stageAdvancedByAct(fight.key, from, e.hp / e.maxHp);
    if (byAct !== null) fight.transitions.push({ from, byAct });
  }
  prev.hits = hits;
  prev.stage = stage;
}

/** 決着した戦いを fight に書く。撃破は bossLog の 1 件、死亡・打ち切りは数えていた値から */
function settle(state: GameState, fight: BossFight, outcome: BossOutcome): void {
  fight.outcome = outcome;
  const b = state.boss;
  const record = state.bossLog[state.bossLog.length - 1];
  if (outcome === "defeated" && record) {
    fight.seconds = record.seconds;
    fight.hits = record.hits;
    fight.downs = record.downs;
    return;
  }
  if (!b || b.lockedAt === undefined) return;
  const e = state.enemies.find((o) => o.id === b.enemyId);
  fight.seconds = Math.max(0, state.time - b.lockedAt);
  fight.hits = b.hits ?? 0;
  fight.downs = (e?.poise.downs ?? 0) + (b.selfDowns ?? 0);
}

/** ボス 1 体との 1 戦。封鎖から maxSeconds 秒で打ち切る */
export function runBossFight(key: string, depth: number, seed: number, maxSeconds: number): BossFight {
  const { state } = makeBossArena(seed, depth, key);
  const bot = createBotState((seed * BOT_SEED_MUL + BOT_SEED_ADD) >>> 0);
  const fight = emptyFight(key, depth, seed);
  const prev: StepMemory = { hits: 0, stage: FIRST_STAGE, time: state.time };
  const killsAtLock = { value: -1 };
  const maxSteps = Math.round((LOCK_WAIT_SECONDS + maxSeconds + BOSS.introTime) / FIXED_DT);
  let waited = 0;

  for (let i = 0; i < maxSteps; i++) {
    step(state, botInput(state, bot, FIXED_DT), FIXED_DT);
    // 撃破の step で bot がすぐ階段へ降りると state.boss は消える。記録を先に見る
    if (killsAtLock.value >= 0 && state.bossLog.length > 0) {
      fight.minionKills = Math.max(0, state.kills - killsAtLock.value - BOSS_OWN_KILLS);
      settle(state, fight, "defeated");
      return fight;
    }
    const b = state.boss;
    if (!b || b.lockedAt === undefined) {
      waited += FIXED_DT;
      if (waited > LOCK_WAIT_SECONDS) return fight;
      continue;
    }
    if (killsAtLock.value < 0) killsAtLock.value = state.kills;
    fight.minionKills = state.kills - killsAtLock.value;
    observeStep(state, fight, prev);
    if (state.status === "dead") {
      settle(state, fight, "died");
      return fight;
    }
    if (state.time - b.lockedAt >= maxSeconds) {
      settle(state, fight, "timeout");
      return fight;
    }
  }
  settle(state, fight, "timeout");
  return fight;
}

/** 設定の全部（ボス × seed）を回す。並びはボスの指定順 → seed 順 */
export function runBossProbe(cfg: BossProbeConfig): BossFight[] {
  const fights: BossFight[] = [];
  for (const target of cfg.bosses) {
    for (const seed of cfg.seeds) fights.push(runBossFight(target.key, target.depth, seed, cfg.maxSeconds));
  }
  return fights;
}

/** probe.md の「## ボス」節（`--bosses` が差し替える）。末尾の空行まで含む行の並び */
export function buildBossSection(cfg: BossProbeConfig, fights: readonly BossFight[]): string[] {
  return buildBossProbeLines(fights, cfg.caption);
}
