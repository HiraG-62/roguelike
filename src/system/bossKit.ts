import { type BossReadMemory, type Enemy, type GameState, pushSfx } from "../core/state";
import type { TerrainKind } from "../core/terrain";
import { type Vec, add, dist, length, normalize, scale, sub } from "../core/vec";
import { type EnemyDef, depthDamage } from "../data/enemies";
import { BOSS, FEEL } from "../data/tuning";
import { noteBossDown } from "./bossRecord";
import { damagePlayer } from "./combat";
import { addFloatingText, shake } from "./effects";
import { type EnemyTelegraph, moveEnemy } from "./enemies";
import { applyStagger, settlePendingStagger } from "./poise";
import { circlesOverlap } from "./physics";
import { inflictOnPlayer } from "./statusEffects";
import { terrainAt } from "./terrain";

/**
 * ボスの共通の器（docs/ideas/boss-impl.md 2-1）。状態機械は chase → windup → strike → recover を回し、
 * 技の中身は各ボスのファイルが BossHooks で渡す。
 * ai.stage = 段階（1 始まり）/ ai.counter = 段階ごとの技の並びの添字 / ai.move = 今の技 / ai.chain = 連撃の何段目 /
 * ai.read = プレイヤーの読み（毎ステップ更新。技の枝の材料）
 */

/** 段階ごとの「危ない間合い」（3-10。隣り合う段階は違う） */
export type ThreatBand = "near" | "far" | "moving" | "still";
export type DistBand = "near" | "mid" | "far";

/** 技を選ぶときに見るプレイヤーの状態（乱数を使わない読み） */
export interface PlayerRead {
  dist: number;
  /** nearDist 未満は near、farDist を超えると far */
  band: DistBand;
  /** 止まっている秒（動くと 0） */
  stillSec: number;
  /** 前に技を選んでから遠い間合いにいた秒 */
  farSec: number;
  /** 最後にダッシュを見てから dashMemory 秒以内 */
  dashedRecently: boolean;
  /** ボスの向き（e.facing）の後ろにいる */
  behind: boolean;
  /** プレイヤーの足元の地形 */
  terrain: TerrainKind;
}

export interface BossHooks {
  /** 追跡中の動き */
  approach(state: GameState, e: Enemy, def: EnemyDef, dt: number): void;
  /** 予備動作に入る（phaseTimer を決め、影などの予告を置く） */
  beginWindup(state: GameState, e: Enemy, def: EnemyDef): void;
  /** 攻撃の出だし（phaseTimer を決める。隙へ直接移るなら phase を変えてよい） */
  beginStrike(state: GameState, e: Enemy, def: EnemyDef): void;
  /** 攻撃中の毎ステップ。true を返すと攻撃を打ち切る */
  tickStrike?(state: GameState, e: Enemy, def: EnemyDef, dt: number): boolean;
  /** 段階ごとの技の並び（pickMove が無いボスだけが使う） */
  sequence?(e: Enemy): readonly number[];
  /** 硬直の終わりに次の技を選ぶ（あれば並びより優先。乱数を使わない） */
  pickMove?(state: GameState, e: Enemy, read: PlayerRead): number;
  /** 攻撃の終わりに続ける技（連撃）。null なら硬直へ */
  followUp?(state: GameState, e: Enemy, done: number): number | null;
  /** 連撃の続きの予備動作の倍（既定 BOSS.rules.chainWindupMul） */
  chainWindupMul?(e: Enemy, next: number): number;
  /** 硬直の秒（既定 def.recover） */
  recoverTime?(state: GameState, e: Enemy, def: EnemyDef): number;
  /** 硬直の間にプレイヤーから離れる速さ（def.speed に掛ける。0・省略は動かない） */
  recoverRetreatMul?(e: Enemy): number;
  /** 硬直の終わり（次の技を選ぶ直前）。スライム王の消化の回復など */
  onRecoverEnd?(state: GameState, e: Enemy): void;
  /** 攻撃間隔の倍率（激昂など） */
  intervalMul?(e: Enemy): number;
}

/** 章ボスの署名の技（最深の主の第三の顔が借りる）。各章ボスのファイルが export する */
export interface BossSignature {
  /** 章ボスの敵 key */
  readonly key: string;
  beginWindup(state: GameState, e: Enemy, def: EnemyDef): void;
  beginStrike(state: GameState, e: Enemy, def: EnemyDef): void;
  tickStrike?(state: GameState, e: Enemy, def: EnemyDef, dt: number): boolean;
  telegraph?(e: Enemy): EnemyTelegraph;
}

/** 章ボス 4 と最深の主の段階 1〜3 の危ない間合い（QA が段階ごとの被弾の間合いと突き合わせる） */
export const BOSS_THREATS: Readonly<Record<string, readonly [ThreatBand, ThreatBand, ThreatBand]>> = {
  kingSlime: ["still", "moving", "near"],
  thiefKing: ["far", "moving", "near"],
  oilKing: ["far", "moving", "near"],
  mirrorKnight: ["far", "near", "moving"],
  deepLord: ["far", "moving", "still"],
};

/** ダッシュを一度も見ていない印（dashMemory より十分長い） */
const NEVER_DASHED = 1e9;
/** 署名の技は章ボスの第 1 段階の形で出す（段階で変わる数の分岐を借り手の段階に左右させない） */
const SIGNATURE_STAGE = 1;
/** 自傷のダウンの浮き文字の持ち上げ（px）・大きさ・秒 */
const DOWN_TEXT_LIFT = 20;
const DOWN_TEXT_SCALE = 1.5;
const DOWN_TEXT_LIFE = 1.1;

export function runBossCycle(state: GameState, e: Enemy, def: EnemyDef, dt: number, h: BossHooks): void {
  updateBossRead(state, e, dt);
  switch (e.phase) {
    case "chase":
      h.approach(state, e, def, dt);
      if (e.attackCooldown > 0) return;
      startWindup(state, e, def, h);
      return;
    case "windup":
      e.phaseTimer -= dt;
      if (e.phaseTimer > 0) return;
      e.phase = "strike";
      e.chainWindup = false;
      h.beginStrike(state, e, def);
      return;
    case "strike":
      e.phaseTimer -= dt;
      if (h.tickStrike?.(state, e, def, dt)) e.phaseTimer = 0;
      if (e.phaseTimer > 0 || e.phase !== "strike") return;
      // 攻撃中に先送りされた怯み（ダウン）は技を出し切ったここで払う
      if (settlePendingStagger(state, e)) return;
      if (chainFollowUp(state, e, def, h)) return;
      e.phase = "recover";
      e.phaseTimer = h.recoverTime?.(state, e, def) ?? def.recover;
      return;
    case "recover":
      e.phaseTimer -= dt;
      retreatDuringRecover(state, e, def, h, dt);
      if (e.phaseTimer > 0) return;
      h.onRecoverEnd?.(state, e);
      e.phase = "chase";
      e.attackCooldown = def.attackInterval * (h.intervalMul?.(e) ?? 1);
      chooseNextMove(state, e, h);
      return;
    default:
      return;
  }
}

/** 追跡から予備動作へ（連撃の始まり） */
function startWindup(state: GameState, e: Enemy, def: EnemyDef, h: BossHooks): void {
  e.phase = "windup";
  e.chainWindup = false;
  if (e.ai) e.ai.chain = 0;
  pushSfx(state, "enemyWindup");
  h.beginWindup(state, e, def);
  e.windupTotal = e.phaseTimer;
}

/**
 * 連撃: 攻撃の終わりに続きがあれば、硬直と追跡を挟まず次の予備動作へ。
 * 続きの予備動作は短く、最初からコミット（雑魚の連撃と同じ作法。読んで潰せるのは最初の 1 撃の前だけ）
 */
function chainFollowUp(state: GameState, e: Enemy, def: EnemyDef, h: BossHooks): boolean {
  const ai = e.ai;
  if (!ai || !h.followUp) return false;
  const next = h.followUp(state, e, ai.move);
  if (next === null) return false;
  ai.chain = (ai.chain ?? 0) + 1;
  ai.move = next;
  e.phase = "windup";
  pushSfx(state, "enemyWindup");
  h.beginWindup(state, e, def);
  e.phaseTimer *= h.chainWindupMul?.(e, next) ?? BOSS.rules.chainWindupMul;
  e.windupTotal = e.phaseTimer;
  e.chainWindup = true;
  return true;
}

/** 硬直の間の離脱（一撃離脱）: プレイヤーの反対へ動く */
function retreatDuringRecover(state: GameState, e: Enemy, def: EnemyDef, h: BossHooks, dt: number): void {
  const mul = h.recoverRetreatMul?.(e) ?? 0;
  if (mul <= 0) return;
  const away = normalize(sub(e.body.pos, state.player.body.pos));
  const speed = def.speed * mul * dt;
  moveEnemy(state, e, def, away.x * speed, away.y * speed);
}

/** 硬直の終わりに次の技を選ぶ: pickMove があれば読みで、無ければ並びの次 */
function chooseNextMove(state: GameState, e: Enemy, h: BossHooks): void {
  const ai = e.ai;
  if (!ai) return;
  if (h.pickMove) ai.move = h.pickMove(state, e, readPlayer(state, e));
  else advanceMove(e, h.sequence?.(e) ?? []);
  if (ai.read) ai.read.farSec = 0;
}

/** 並びの次の技へ */
function advanceMove(e: Enemy, seq: readonly number[]): void {
  const ai = e.ai;
  if (!ai || seq.length === 0) return;
  ai.counter = (ai.counter + 1) % seq.length;
  ai.move = seq[ai.counter] ?? ai.move;
}

/** 段階が変わったら並びの先頭から */
export function resetSequence(e: Enemy, seq: readonly number[]): void {
  const ai = e.ai;
  if (!ai) return;
  ai.counter = 0;
  ai.move = seq[0] ?? 0;
}

// -----------------------------------------------------------------------------
// 読み（規則 4: 状態で技を選ぶ）
// -----------------------------------------------------------------------------

export function distBand(d: number): DistBand {
  const r = BOSS.rules;
  if (d < r.nearDist) return "near";
  return d > r.farDist ? "far" : "mid";
}

/** 毎ステップ: プレイヤーの動きを見て静止・遠さ・ダッシュの秒を数える（runBossCycle の頭で呼ぶ） */
export function updateBossRead(state: GameState, e: Enemy, dt: number): void {
  const ai = e.ai;
  if (!ai) return;
  const p = state.player;
  const pos = p.body.pos;
  const mem: BossReadMemory = (ai.read ??= { lastPos: { ...pos }, stillSec: 0, farSec: 0, dashAgo: NEVER_DASHED });
  const moved = dist(pos, mem.lastPos);
  mem.stillSec = moved < BOSS.rules.stillSpeed * dt ? mem.stillSec + dt : 0;
  mem.lastPos = { ...pos };
  mem.dashAgo = p.dashTimer > 0 ? 0 : mem.dashAgo + dt;
  if (distBand(dist(pos, e.body.pos)) === "far") mem.farSec += dt;
}

export function readPlayer(state: GameState, e: Enemy): PlayerRead {
  const mem = e.ai?.read;
  const pos = state.player.body.pos;
  const d = dist(pos, e.body.pos);
  const to = normalize(sub(pos, e.body.pos));
  const f = normalize(e.facing);
  return {
    dist: d,
    band: distBand(d),
    stillSec: mem?.stillSec ?? 0,
    farSec: mem?.farSec ?? 0,
    dashedRecently: (mem?.dashAgo ?? NEVER_DASHED) <= BOSS.rules.dashMemory,
    behind: to.x * f.x + to.y * f.y < 0,
    terrain: terrainAt(state, pos.x, pos.y),
  };
}

// -----------------------------------------------------------------------------
// 見えるダウン（規則 3）・署名の技
// -----------------------------------------------------------------------------

/**
 * 自傷のダウン（壁激突・引火・追い詰め・消化の吐き出しなど）: 怯み（自傷の印つき。解除後に堅守を付けない）+
 * 浮き文字（体言止め）+ 揺れ + 音。記録のダウン回数にも数える。入らなければ false
 */
export function bossDown(state: GameState, e: Enemy, time: number, text: string, color: string): boolean {
  if (!applyStagger(state, e, time, { selfInflicted: true })) return false;
  addFloatingText(state, { x: e.body.pos.x, y: e.body.pos.y - DOWN_TEXT_LIFT }, text, color, DOWN_TEXT_SCALE, DOWN_TEXT_LIFE, "status");
  shake(state, FEEL.shakeHeavy);
  pushSfx(state, "wallHit");
  noteBossDown(state, e);
  return true;
}

/**
 * 章ボスの技 1 つを、別のボス（借り手）が出せる形にする。呼ぶ間だけ ai.move と ai.stage を
 * その技と第 1 段階に差し替える（借り手の技の選びと段階は壊さない）
 */
export function signatureOf(key: string, move: number, h: BossHooks, telegraph?: (e: Enemy) => EnemyTelegraph): BossSignature {
  const sig: BossSignature = {
    key,
    beginWindup: (state, e, def) => asMove(e, move, () => h.beginWindup(state, e, def)),
    beginStrike: (state, e, def) => asMove(e, move, () => h.beginStrike(state, e, def)),
    tickStrike: (state, e, def, dt) => asMove(e, move, () => h.tickStrike?.(state, e, def, dt) ?? false),
  };
  if (!telegraph) return sig;
  // 予告は描画（render/）が毎フレーム読むので、ai を書き換えず技と段階を差し替えた写しで引く（不変条件 1）
  return { ...sig, telegraph: (e) => telegraph(asMoveView(e, move)) };
}

/** asMove と同じ差し替えを、元の敵を書き換えずに写しで見せる（読むだけの予告用） */
function asMoveView(e: Enemy, move: number): Enemy {
  return e.ai ? { ...e, ai: { ...e.ai, move, stage: SIGNATURE_STAGE } } : e;
}

function asMove<T>(e: Enemy, move: number, fn: () => T): T {
  const ai = e.ai;
  if (!ai) return fn();
  const saved = { move: ai.move, stage: ai.stage };
  ai.move = move;
  ai.stage = SIGNATURE_STAGE;
  try {
    return fn();
  } finally {
    ai.move = saved.move;
    ai.stage = saved.stage;
  }
}

// -----------------------------------------------------------------------------
// 動きの部品
// -----------------------------------------------------------------------------

export function toPlayer(state: GameState, e: Enemy): Vec {
  return normalize(sub(state.player.body.pos, e.body.pos));
}

/** keep の距離を保ち、横へふらふら動く */
export function keepDistance(state: GameState, e: Enemy, def: EnemyDef, keep: number, dt: number): void {
  const to = sub(state.player.body.pos, e.body.pos);
  const d = length(to);
  const dir = normalize(to);
  if (dir.x !== 0) e.facing = dir;
  const radial = d < keep * 0.8 ? -1 : d > keep * 1.3 ? 1 : 0;
  const perp = { x: -dir.y, y: dir.x };
  const move = add(scale(dir, radial), scale(perp, Math.sin(e.animTime) * 0.6));
  moveEnemy(state, e, def, move.x * def.speed * dt, move.y * def.speed * dt);
}

/** 素直に寄る */
export function walkToward(state: GameState, e: Enemy, def: EnemyDef, dt: number): void {
  const dir = toPlayer(state, e);
  if (dir.x !== 0) e.facing = dir;
  moveEnemy(state, e, def, dir.x * def.speed * dt, dir.y * def.speed * dt);
}

/** 突進の 1 ステップ。壁に当たったか / 触れたか を返す */
export function lungeStep(state: GameState, e: Enemy, def: EnemyDef, speedMul: number, dt: number): { wall: boolean; touched: boolean } {
  const speed = def.speed * speedMul;
  const hit = moveEnemy(state, e, def, e.strikeDir.x * speed * dt, e.strikeDir.y * speed * dt);
  return { wall: hit.hitX || hit.hitY, touched: bossTouch(state, e, def) };
}

/** 体が触れたら当てる。当たった（または回避された）なら true */
export function bossTouch(state: GameState, e: Enemy, def: EnemyDef): boolean {
  // 霊体化（skills/forms.ts）はボスの体もすり抜ける（循環 import を避けて state を直に見る。enemies.ts の touchPlayer と同じ）
  if (state.skills.shape?.key === "wraithForm") return false;
  const p = state.player.body;
  if (!circlesOverlap(e.body.pos.x, e.body.pos.y, e.body.radius, p.pos.x, p.pos.y, p.radius)) return false;
  const result = damagePlayer(state, depthDamage(def.contactDamage, state.depth), e.body.pos, e);
  if (result === "hit") {
    inflictOnPlayer(state, e, "contact");
    shake(state, FEEL.shakeHeavy);
  }
  return result !== "ignored";
}
