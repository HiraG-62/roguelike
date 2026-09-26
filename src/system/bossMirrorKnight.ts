import { type Enemy, type GameState, type Projectile, pushSfx } from "../core/state";
import type { StatusKind } from "../core/status";
import { type Vec, add, fromAngle, length, normalize, scale } from "../core/vec";
import { type EnemyDef, depthDamageBonus, enemyDef } from "../data/enemies";
import { BOSS, FEEL } from "../data/tuning";
import { shake, spawnBurst } from "./effects";
import { type EnemyTelegraph, createEnemy, scaledWindup } from "./enemies";
import { fanDirections, fireEnemyBullet, followersOf, spawnSpot } from "./enemyTraits";
import { applyStagger, isStaggered } from "./poise";
import { applyStatus } from "./statusEffects";
import { phaseShift } from "./boss";
import { type BossHooks, lungeStep, resetSequence, runBossCycle, toPlayer, walkToward } from "./bossKit";

/**
 * ボス: 鏡の騎士（docs/ideas/enemies.md B4「写し身」の騎士版。鏡の部屋と結び付く）。
 * 第 1 段階 = 突進と、正面から来た弾を跳ね返す盾（射撃ビルドは回り込むか近接へ）/
 * 第 2 段階 = プレイヤーの装備が付ける状態異常（statusProcs）を写して、突進に乗せる。剣の波（扇の弾）が増える /
 * 第 3 段階 = 写し身を呼ぶ。写し身が残っている間、本体は守られる（受けるダメージが減る）。
 * 突進で壁に激突すると怯む（ダウンの窓）。自分のビルドの長所と穴がそのまま相手になる
 */

const STAGE_ONE = 1;
const STAGE_COPY = 2;
const STAGE_IMAGES = 3;
/** ai.move: 技 */
export const MIRROR_LUNGE = 0;
export const MIRROR_WAVE = 1;
const SEQUENCE: Readonly<Record<number, readonly number[]>> = {
  [STAGE_ONE]: [MIRROR_LUNGE],
  [STAGE_COPY]: [MIRROR_LUNGE, MIRROR_WAVE],
  [STAGE_IMAGES]: [MIRROR_WAVE, MIRROR_LUNGE, MIRROR_LUNGE],
};
const COPY_TEXT = "模写";
const IMAGES_TEXT = "写し身";
/** 写すものが無いときに乗せる状態異常 */
const FALLBACK_COPY: StatusKind = "bleed";
/** 正面の判定（盾で跳ね返す角度の半分の余弦。約 60°） */
const FRONT_COS = 0.5;
const FULL_CIRCLE = Math.PI * 2;
/** 写し身を置く距離 */
const IMAGE_OFFSET = 36;

function sequenceOf(e: Enemy): readonly number[] {
  return SEQUENCE[e.ai?.stage ?? STAGE_ONE] ?? SEQUENCE[STAGE_ONE] ?? [];
}

const HOOKS: BossHooks = {
  approach: (state, e, def, dt) => walkToward(state, e, def, dt),
  beginWindup: (state, e, def) => {
    e.strikeDir = toPlayer(state, e);
    e.phaseTimer = scaledWindup(def.windup, state.depth);
  },
  beginStrike,
  tickStrike,
  sequence: sequenceOf,
};

export function updateMirrorKnight(state: GameState, e: Enemy, def: EnemyDef, dt: number): void {
  if (!e.ai) return;
  advanceStage(state, e);
  runBossCycle(state, e, def, dt, HOOKS);
}

function advanceStage(state: GameState, e: Enemy): void {
  const ai = e.ai;
  if (!ai) return;
  const m = BOSS.mirrorKnight;
  if (ai.stage === STAGE_ONE && e.hp <= e.maxHp * m.phase2Ratio) {
    phaseShift(state, e, COPY_TEXT, m.color, STAGE_COPY);
    resetSequence(e, sequenceOf(e));
    return;
  }
  if (ai.stage === STAGE_COPY && e.hp <= e.maxHp * m.phase3Ratio) {
    phaseShift(state, e, IMAGES_TEXT, m.color, STAGE_IMAGES);
    resetSequence(e, sequenceOf(e));
    summonImages(state, e);
  }
}

/** 写し身: 本体の HP の一部を持つ小さな騎士。残っている間は本体が守られる */
function summonImages(state: GameState, e: Enemy): void {
  const m = BOSS.mirrorKnight;
  const def = enemyDef("mirrorImage");
  for (let i = 0; i < m.images; i++) {
    const want = add(e.body.pos, scale(fromAngle((i / m.images) * FULL_CIRCLE), IMAGE_OFFSET));
    const image = createEnemy(state, def, spawnSpot(state, want, e.body.pos, def.radius), e.roomIndex, true);
    image.maxHp = Math.max(1, Math.round(e.maxHp * m.imageHpRatio));
    image.hp = image.maxHp;
    image.lastHp = image.hp;
    image.leaderId = e.id;
    image.revived = true;
    state.enemies.push(image);
  }
}

function beginStrike(state: GameState, e: Enemy, def: EnemyDef): void {
  const ai = e.ai;
  if (!ai) return;
  const m = BOSS.mirrorKnight;
  if (ai.move === MIRROR_WAVE) {
    e.phaseTimer = def.strikeTime;
    const damage = m.waveDamage + depthDamageBonus(state.depth);
    for (const dir of fanDirections(e.strikeDir, m.waveCount, m.waveSpread)) {
      fireEnemyBullet(state, { pos: add(e.body.pos, scale(dir, e.body.radius + 2)), dir, speed: m.waveSpeed, damage, color: m.color, sourceId: e.id });
    }
    pushSfx(state, "enemyShoot");
    return;
  }
  e.phaseTimer = m.lungeTime;
  e.strikeDir = toPlayer(state, e);
  if (e.strikeDir.x !== 0) e.facing = e.strikeDir;
}

/** 突進: 触れたら写した状態異常も乗せる。壁に激突すると怯む */
function tickStrike(state: GameState, e: Enemy, def: EnemyDef, dt: number): boolean {
  if (e.ai?.move !== MIRROR_LUNGE) return false;
  const m = BOSS.mirrorKnight;
  const hpBefore = state.player.hp;
  const step = lungeStep(state, e, def, m.lungeSpeedMul, dt);
  if (step.touched && state.player.hp < hpBefore) applyCopiedStatus(state, e);
  if (!step.wall) return step.touched;
  shake(state, FEEL.shakeHeavy);
  pushSfx(state, "wallHit");
  applyStagger(state, e, m.wallStagger, { selfInflicted: true });
  return true;
}

/** 第 2 段階から: プレイヤーの装備が付ける状態異常を、同じ形でプレイヤーに返す */
function applyCopiedStatus(state: GameState, e: Enemy): void {
  if ((e.ai?.stage ?? STAGE_ONE) < STAGE_COPY) return;
  const m = BOSS.mirrorKnight;
  for (const kind of copiedStatuses(state)) {
    applyStatus(state, { kind: "player" }, { kind, stacks: 1, duration: m.procDuration, potency: 0 }, "enemy");
  }
}

/** 写す状態異常: 装備の statusProcs の種類（重複なし・上限つき）。無ければ出血 */
export function copiedStatuses(state: GameState): StatusKind[] {
  const kinds: StatusKind[] = [];
  for (const proc of state.stats.statusProcs) {
    if (kinds.includes(proc.kind)) continue;
    kinds.push(proc.kind);
    if (kinds.length >= BOSS.mirrorKnight.procMax) break;
  }
  return kinds.length > 0 ? kinds : [FALLBACK_COPY];
}

/** 写し身が残っている間に本体が受けるダメージの倍率 */
export function mirrorKnightTakenMul(state: GameState, e: Enemy): number {
  return followersOf(state, e).some((o) => o.defKey === "mirrorImage") ? BOSS.mirrorKnight.imageGuardMul : 1;
}

/** 正面から来たプレイヤーの弾を跳ね返すか（怯み中は盾が下がる） */
export function mirrorKnightReflects(state: GameState, e: Enemy, pr: Projectile): boolean {
  if (isStaggered(e) || length(pr.vel) === 0) return false;
  const incoming: Vec = scale(normalize(pr.vel), -1);
  const f = normalize(e.facing);
  if (incoming.x * f.x + incoming.y * f.y < FRONT_COS) return false;
  spawnBurst(state, e.body.pos, BOSS.mirrorKnight.color, 4, 60, 0.2, 1.5);
  return true;
}

/** 予告の形: 突進は線、剣の波も線（扇の中心） */
export function mirrorKnightTelegraph(e: Enemy): EnemyTelegraph {
  return e.ai ? { kind: "line" } : null;
}

