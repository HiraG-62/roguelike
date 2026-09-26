import { type Enemy, type GameState, pushSfx } from "../core/state";
import { type Vec, add, dist, fromAngle, normalize, scale, sub } from "../core/vec";
import { type EnemyDef, depthDamageBonus } from "../data/enemies";
import { BOSS } from "../data/tuning";
import { TILE_SIZE } from "../map/grid";
import { addFloatingText, spawnBurst, spawnRing } from "./effects";
import { type EnemyTelegraph, scaledWindup } from "./enemies";
import { blastBoth } from "./enemyTerrain";
import { fanDirections, fireEnemyBullet } from "./enemyTraits";
import { spawnBoneWall, spawnLanding, spawnShockwave } from "./hazards";
import { overlapsWall } from "./physics";
import { applyStagger } from "./poise";
import { isSilenced } from "./statusEffects";
import { phaseShift } from "./boss";
import { type BossHooks, keepDistance, resetSequence, runBossCycle, toPlayer } from "./bossKit";

/**
 * ボス: 図書館の司書（docs/ideas/enemies.md B9。骨の墓所の書庫と結び付く）。
 * 第 1 段階 = 頁を扇に飛ばし、本棚（骨の壁と同じ一時的な壁）で部屋を区切る /
 * 第 2 段階 = 禁書を読む（雷の落下 / 引き寄せ）/ 第 3 段階 = 本棚を倒して押し潰す（倒れた本棚は壁として残る）。
 * 禁書を読む 1.2 秒の間に沈黙・怯みで止めると、本を落としてダウンする（沈黙の付与手段・怯み値ビルドの出番）。
 * 本棚は爆発・壁叩きつけ・弾で壊せる（H6 の骨の壁の耐久と共通）
 */

const STAGE_ONE = 1;
const STAGE_FORBIDDEN = 2;
const STAGE_TOPPLE = 3;
/** ai.move: 技 */
export const LIB_PAGES = 0;
export const LIB_SHELF = 1;
export const LIB_READ_THUNDER = 2;
export const LIB_READ_PULL = 3;
export const LIB_TOPPLE = 4;
const SEQUENCE: Readonly<Record<number, readonly number[]>> = {
  [STAGE_ONE]: [LIB_PAGES, LIB_SHELF],
  [STAGE_FORBIDDEN]: [LIB_READ_THUNDER, LIB_PAGES, LIB_SHELF, LIB_READ_PULL, LIB_PAGES],
  [STAGE_TOPPLE]: [LIB_TOPPLE, LIB_READ_THUNDER, LIB_PAGES, LIB_READ_PULL],
};
/** ai.timer: 禁書を読んでいる印（読みを止められたら本を落とす） */
const READING = 1;
const NOT_READING = 0;
const FULL_CIRCLE = Math.PI * 2;
const FORBIDDEN_TEXT = "禁書解放";
const TOPPLE_TEXT = "本棚倒し";
const DROP_TEXT = "読書中断";
/** 本棚の予告の影（1 マスの半分） */
const SHELF_MARK_RADIUS = TILE_SIZE / 2;
/** 引き寄せの後の衝撃波の半径 */
const PULL_RING_RADIUS = 40;

function sequenceOf(e: Enemy): readonly number[] {
  return SEQUENCE[e.ai?.stage ?? STAGE_ONE] ?? SEQUENCE[STAGE_ONE] ?? [];
}

function isRead(move: number | undefined): boolean {
  return move === LIB_READ_THUNDER || move === LIB_READ_PULL;
}

const HOOKS: BossHooks = {
  approach: (state, e, def, dt) => keepDistance(state, e, def, BOSS.librarian.keepAway, dt),
  beginWindup,
  beginStrike,
  sequence: sequenceOf,
};

export function updateLibrarian(state: GameState, e: Enemy, def: EnemyDef, dt: number): void {
  if (!e.ai) return;
  advanceStage(state, e);
  if (checkDroppedBook(state, e)) return;
  runBossCycle(state, e, def, dt, HOOKS);
}

function advanceStage(state: GameState, e: Enemy): void {
  const ai = e.ai;
  if (!ai) return;
  const l = BOSS.librarian;
  if (ai.stage === STAGE_ONE && e.hp <= e.maxHp * l.phase2Ratio) {
    phaseShift(state, e, FORBIDDEN_TEXT, l.color, STAGE_FORBIDDEN);
    resetSequence(e, sequenceOf(e));
    return;
  }
  if (ai.stage === STAGE_FORBIDDEN && e.hp <= e.maxHp * l.phase3Ratio) {
    phaseShift(state, e, TOPPLE_TEXT, l.color, STAGE_TOPPLE);
    resetSequence(e, sequenceOf(e));
  }
}

/**
 * 禁書を読む最中に沈黙した、または怯みで読みが途切れた（予備動作から外れた）ら、本を落としてダウンする。
 * 処理したら true（このステップは他の行動をしない）
 */
function checkDroppedBook(state: GameState, e: Enemy): boolean {
  const ai = e.ai;
  if (!ai || ai.timer !== READING) return false;
  const interrupted = (e.phase === "windup" && isSilenced(e)) || e.phase === "chase";
  if (!interrupted) return false;
  ai.timer = NOT_READING;
  e.phase = "chase";
  addFloatingText(state, { x: e.body.pos.x, y: e.body.pos.y - 16 }, DROP_TEXT, BOSS.librarian.color, 1.4, 1.1);
  spawnBurst(state, e.body.pos, "#e0d8c0", 16, 100, 0.4, 2);
  pushSfx(state, "guardBreak");
  applyStagger(state, e, BOSS.librarian.readDropStagger, { selfInflicted: true });
  return true;
}

function beginWindup(state: GameState, e: Enemy, def: EnemyDef): void {
  const ai = e.ai;
  if (!ai) return;
  const l = BOSS.librarian;
  e.strikeDir = toPlayer(state, e);
  ai.timer = isRead(ai.move) ? READING : NOT_READING;
  switch (ai.move) {
    case LIB_SHELF:
      e.phaseTimer = scaledWindup(l.shelfFall, state.depth);
      ai.points = shelfPoints(state, e);
      break;
    case LIB_READ_THUNDER:
      e.phaseTimer = scaledWindup(l.readTime, state.depth);
      ai.points = thunderPoints(state, e);
      for (const p of ai.points) spawnLanding(state, p, l.thunderRadius, e.phaseTimer, e.id);
      return;
    case LIB_READ_PULL:
      e.phaseTimer = scaledWindup(l.readTime, state.depth);
      return;
    case LIB_TOPPLE:
      e.phaseTimer = scaledWindup(l.toppleFall, state.depth);
      ai.points = topplePoints(state, e);
      for (const p of ai.points) spawnLanding(state, p, l.toppleRadius, e.phaseTimer, e.id);
      return;
    default:
      e.phaseTimer = scaledWindup(def.windup, state.depth);
      return;
  }
  for (const p of ai.points ?? []) spawnLanding(state, p, SHELF_MARK_RADIUS, e.phaseTimer, e.id);
}

/** 本棚: 司書とプレイヤーの間に、狙いと直交する列（骨の骸骨卿と同じ置き方） */
function shelfPoints(state: GameState, e: Enemy): Vec[] {
  const l = BOSS.librarian;
  const p = state.player.body.pos;
  const mid = add(e.body.pos, scale(sub(p, e.body.pos), 0.5));
  const dir = toPlayer(state, e);
  const perp = { x: -dir.y, y: dir.x };
  const half = Math.floor(l.shelfLength / 2);
  const points: Vec[] = [];
  for (let i = -half; i <= half; i++) {
    const q = add(mid, scale(perp, i * TILE_SIZE));
    const tile = { x: (Math.floor(q.x / TILE_SIZE) + 0.5) * TILE_SIZE, y: (Math.floor(q.y / TILE_SIZE) + 0.5) * TILE_SIZE };
    if (!overlapsWall(state, tile.x, tile.y, 1)) points.push(tile);
  }
  return points;
}

function thunderPoints(state: GameState, e: Enemy): Vec[] {
  const l = BOSS.librarian;
  const center = state.player.body.pos;
  const points: Vec[] = [{ ...center }];
  for (let i = 1; i < l.thunderCount; i++) {
    const q = add(center, scale(fromAngle((i / (l.thunderCount - 1)) * FULL_CIRCLE + e.id + state.tick), l.thunderSpread));
    if (!overlapsWall(state, q.x, q.y, 2)) points.push(q);
  }
  return points;
}

/** 倒れる本棚: プレイヤーを通る、司書からの向きと直交する長い列 */
function topplePoints(state: GameState, e: Enemy): Vec[] {
  const l = BOSS.librarian;
  const dir = toPlayer(state, e);
  const perp = { x: -dir.y, y: dir.x };
  const center = state.player.body.pos;
  const half = (l.toppleLength - 1) / 2;
  const points: Vec[] = [];
  for (let i = 0; i < l.toppleLength; i++) {
    const q = add(center, scale(perp, (i - half) * l.toppleSpacing));
    if (!overlapsWall(state, q.x, q.y, 2)) points.push(q);
  }
  return points;
}

function beginStrike(state: GameState, e: Enemy, def: EnemyDef): void {
  const ai = e.ai;
  if (!ai) return;
  const l = BOSS.librarian;
  const bonus = depthDamageBonus(state.depth);
  const source = { defKey: e.defKey, roomIndex: e.roomIndex };
  ai.timer = NOT_READING;
  e.phaseTimer = def.strikeTime;
  switch (ai.move) {
    case LIB_SHELF:
      for (const p of ai.points ?? []) spawnBoneWall(state, Math.floor(p.x / TILE_SIZE), Math.floor(p.y / TILE_SIZE));
      pushSfx(state, "wallHit");
      return;
    case LIB_READ_THUNDER:
      for (const p of ai.points ?? []) blastBoth(state, p, l.thunderRadius, l.thunderDamage + bonus, "#fff4a0", source, e.id);
      pushSfx(state, "shock");
      return;
    case LIB_READ_PULL:
      pullPlayer(state, e);
      return;
    case LIB_TOPPLE:
      for (const p of ai.points ?? []) {
        blastBoth(state, p, l.toppleRadius, l.toppleDamage + bonus, l.color, source, e.id);
        spawnBoneWall(state, Math.floor(p.x / TILE_SIZE), Math.floor(p.y / TILE_SIZE));
      }
      pushSfx(state, "wallHit");
      return;
    default:
      firePages(state, e);
      return;
  }
}

function firePages(state: GameState, e: Enemy): void {
  if (isSilenced(e)) return;
  const l = BOSS.librarian;
  const damage = l.pageDamage + depthDamageBonus(state.depth);
  for (const dir of fanDirections(e.strikeDir, l.pageCount, l.pageSpread)) {
    const pos = add(e.body.pos, scale(dir, e.body.radius + 2));
    fireEnemyBullet(state, { pos, dir, speed: l.pageSpeed, damage, color: "#f0f0f0", sourceId: e.id });
  }
  pushSfx(state, "enemyShoot");
}

/** 禁書（引力）: 半径内のプレイヤーを引き寄せ、足元に衝撃波（予告は輪） */
function pullPlayer(state: GameState, e: Enemy): void {
  const l = BOSS.librarian;
  const p = state.player;
  spawnRing(state, e.body.pos, l.pullRadius, l.color, 0.4);
  if (dist(p.body.pos, e.body.pos) <= l.pullRadius) p.knock = scale(normalize(sub(e.body.pos, p.body.pos)), l.pullForce);
  spawnShockwave(state, e.body.pos, PULL_RING_RADIUS, l.pullRingDamage + depthDamageBonus(state.depth), e.id);
}

/** 予告の形: 頁は線、引力は輪（本棚・雷・倒れる本棚は影） */
export function librarianTelegraph(e: Enemy): EnemyTelegraph {
  if (e.ai?.move === LIB_PAGES) return { kind: "line" };
  if (e.ai?.move === LIB_READ_PULL) return { kind: "ring", radius: BOSS.librarian.pullRadius };
  return null;
}
