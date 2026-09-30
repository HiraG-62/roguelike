import { createGame, step } from "../core/game";
import type { FrameInput } from "../core/input";
import { captureLoadout, createReplayProfiles } from "../core/replay";
import { hashSeed } from "../core/rng";
import { type GameState, runOver } from "../core/state";
import type { JobKey } from "../data/jobs";
import { BOSS_HALL } from "../data/tuning";
import type { Profile } from "../loot/types";
import { TILE_SIZE, Tile, getTile, rectCenter, rectContainsPx } from "../map/grid";
import type { SkillProfile } from "../skills/types";
import { bossEnemy } from "./boss";
import { hallDepthOf, hallSeedText } from "./bossHallKeys";
import { snapCamera } from "./camera";
import { defaultRunSetup } from "./runSetup";

/**
 * ボスの間（docs/ideas/meta-impl.md 2-7）。拠点の台から、倒した章ボスと最深の主に今の装備の写しで挑み直す。
 * 拠点の sandbox（stepHub）ではボス部屋の準備・封鎖・記録が動かないので、createGame で本物のボス階を作り、
 * プレイヤーをボス部屋の入口へ置く。装備は一時プロフィール（リプレイ再生と同じ写し）なので本物は書き換えない。
 * 保存の抑止・結果の記録は呼び出し側（main.ts）が持つ
 */

export { hallBossKeys, hallDepthOf, hallSeedText } from "./bossHallKeys";

/**
 * ボスの間の GameState を作る。装備は profile / skillProfile の写し（武器掛けの借り物を含む）、祝福なし。
 * 候補でない key・作った階のボスが違う・入口に立てない、のどれかなら null
 */
export function createHallGame(
  key: string,
  profile: Profile,
  skillProfile: SkillProfile,
  job: JobKey | undefined,
  hitstopScale: number,
): GameState | null {
  const depth = hallDepthOf(key);
  if (depth === null) return null;
  const copy = createReplayProfiles(captureLoadout(profile, skillProfile));
  const seedText = hallSeedText(key);
  const setup = { ...defaultRunSetup(), startDepth: depth, ...(job === undefined ? {} : { job }) };
  const state = createGame(hashSeed(seedText), seedText, copy.profile, copy.skillProfile, setup, hitstopScale);
  if (bossEnemy(state)?.defKey !== key) return null;
  return enterHallArena(state) ? state : null;
}

/** 扉タイルから部屋の内側へ向かう 1 タイルぶんの向き。扉が矩形の外周の外にある前提（findDoorTiles） */
function inwardStep(tx: number, ty: number, rect: { x: number; y: number; w: number; h: number }): { dx: number; dy: number } {
  if (tx < rect.x) return { dx: 1, dy: 0 };
  if (tx >= rect.x + rect.w) return { dx: -1, dy: 0 };
  if (ty < rect.y) return { dx: 0, dy: 1 };
  if (ty >= rect.y + rect.h) return { dx: 0, dy: -1 };
  // 洞窟の塊など扉が矩形の内側にあるときは、中心へ寄る長い方の軸
  const c = rectCenter(rect);
  const ox = c.x - tx;
  const oy = c.y - ty;
  return Math.abs(ox) >= Math.abs(oy) ? { dx: Math.sign(ox), dy: 0 } : { dx: 0, dy: Math.sign(oy) };
}

/**
 * プレイヤーをボス部屋の扉寄りの内側（扉タイルから中心へ BOSS_HALL.doorInset タイル）へ置く。
 * 扉タイルは index の小さい順に試す（乱数を使わない）。置けたら true。次の step で部屋が封鎖される
 */
export function enterHallArena(state: GameState): boolean {
  const room = state.boss ? state.rooms[state.boss.roomIndex] : undefined;
  if (!room) return false;
  const width = state.map.width;
  const doors = [...room.doorTiles].sort((a, b) => a - b);
  const doorSet = new Set(doors);
  for (const door of doors) {
    const tx = door % width;
    const ty = Math.floor(door / width);
    const { dx, dy } = inwardStep(tx, ty, room.rect);
    const x = tx + dx * BOSS_HALL.doorInset;
    const y = ty + dy * BOSS_HALL.doorInset;
    const px = (x + 0.5) * TILE_SIZE;
    const py = (y + 0.5) * TILE_SIZE;
    if (getTile(state.map, x, y) !== Tile.Floor || doorSet.has(y * width + x)) continue;
    if (!rectContainsPx(room.rect, px, py)) continue;
    placePlayer(state, px, py);
    return true;
  }
  return false;
}

function placePlayer(state: GameState, x: number, y: number): void {
  const p = state.player;
  p.body.pos = { x, y };
  p.body.vel = { x: 0, y: 0 };
  // 出血は前ステップからの移動距離で削る。入口への瞬間移動を移動として数えない
  if (p.status.bleedFrom) p.status.bleedFrom = { ...p.body.pos };
  snapCamera(state);
}

/**
 * 1 回の挑戦。封鎖した時点の state.time を別に持つ: floorTime は封鎖中に止まる（reaper.ts の updateReaper が
 * ボス部屋の封鎖中は進めない）ので、boss.lockedAt（floorTime）からは戦った秒が数えられない
 */
export interface HallRun {
  key: string;
  state: GameState;
  /** 封鎖を見た step の終わりの state.time。封鎖前は null */
  lockedTime: number | null;
}

/** createHallGame を挑戦の形に包む。作れなければ null */
export function createHallRun(
  key: string,
  profile: Profile,
  skillProfile: SkillProfile,
  job: JobKey | undefined,
  hitstopScale: number,
): HallRun | null {
  const state = createHallGame(key, profile, skillProfile, job, hitstopScale);
  return state ? { key, state, lockedTime: null } : null;
}

/** 1 step 進め、封鎖を見たらその時刻を覚える */
export function stepHall(run: HallRun, input: FrameInput, dt: number): void {
  step(run.state, input, dt);
  if (run.lockedTime === null && run.state.boss?.lockedAt !== undefined) run.lockedTime = run.state.time;
}

/** 挑戦の結果。seconds は封鎖から（state.time）、hits・downs は封鎖中の被弾とダウン（撃破なら bossLog の記録と同じ値） */
export interface HallOutcome {
  /** 撃破したか、力尽きたか。ここで step を止める */
  done: boolean;
  won: boolean;
  /** 部屋が封鎖されたか。封鎖前にやめた挑戦は数えない */
  locked: boolean;
  seconds: number;
  hits: number;
  downs: number;
}

/** 今の挑戦の結果を読む（書き換えない）。撃破は bossLog の最後の被弾・ダウン、途中・力尽きたらボスの状態から */
export function hallOutcome(run: HallRun): HallOutcome {
  const state = run.state;
  const b = state.boss;
  const seconds = run.lockedTime === null ? 0 : Math.max(0, state.time - run.lockedTime);
  const record = state.bossLog[state.bossLog.length - 1];
  if (b?.defeated === true && record) {
    return { done: true, won: true, locked: true, seconds, hits: record.hits, downs: record.downs };
  }
  const foe = bossEnemy(state);
  return {
    done: runOver(state),
    won: false,
    locked: b?.lockedAt !== undefined,
    seconds,
    hits: b?.hits ?? 0,
    downs: (foe?.poise.downs ?? 0) + (b?.selfDowns ?? 0),
  };
}
