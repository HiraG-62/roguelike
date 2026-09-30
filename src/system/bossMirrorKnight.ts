import { type Enemy, type GameState, type Projectile, pushSfx } from "../core/state";
import type { StatusKind } from "../core/status";
import { type Vec, add, fromAngle, length, normalize, scale } from "../core/vec";
import { type EnemyDef, depthDamage, enemyDef } from "../data/enemies";
import { BOSS, ENEMY_AI, FEEL } from "../data/tuning";
import { rectCenterPx } from "../map/grid";
import { ART_DEFS, isArtKey } from "../skills/arts";
import type { ArtActKind } from "../skills/arts/types";
import { damagePlayer } from "./combat";
import { shake, spawnBurst } from "./effects";
import { type EnemyTelegraph, createEnemy, scaledWindup } from "./enemies";
import { inCone } from "./enemyWave3";
import { fanDirections, fireEnemyBullet, followersOf, spawnSpot } from "./enemyTraits";
import { laserEnd, spawnLaser, spawnShockwave } from "./hazards";
import { isStaggered } from "./poise";
import { applyStatus, inflictOnPlayer } from "./statusEffects";
import { phaseShift } from "./boss";
import { type BossHooks, type PlayerRead, bossDown, lungeStep, readPlayer, runBossCycle, signatureOf, toPlayer, walkToward } from "./bossKit";

/**
 * ボス: 鏡の騎士（章 4。docs/ideas/boss-impl.md 2-5）。
 * 第 1 段階（盾）= 近ければ盾打ち（扇）、他は突進。正面から来た弾は跳ね返す。突進が壁に激突するとダウンし、
 * 激突が slamsToCrack 回に達すると HP に関わらず盾が割れて第 2 段階へ /
 * 第 2 段階（模写）= 2 回に 1 回、直前に撃ったスキルの最初の行為の形（輪・線・扇・突進）を写す。
 * 写した後は反動でダウン。突進と盾打ちには装備の状態異常を乗せる /
 * 第 3 段階（写し身）= 姿見を立て、写し身を呼ぶ。写し身が残る間は本体が守られ、倒しても姿見が立っていれば
 * 少しして姿見から戻る。姿見を割ると騎士がダウンする。
 * 乱数は使わない（技の選びは読みと ai.counter、姿見の位置は部屋の幾何）。
 * ai の使い方: progress = 壁激突の数（第 1 段階）/ counter = 第 2 段階は選んだ数、第 3 段階は立っている姿見の数の記憶 /
 * timer = 第 2 段階は模写の形（COPY_FORMS の添字）、第 3 段階は写し身が戻るまでの残り秒（0 = 待っていない）
 */

const STAGE_ONE = 1;
const STAGE_COPY = 2;
const STAGE_IMAGES = 3;
/** ai.move: 技 */
export const MIRROR_LUNGE = 0;
export const MIRROR_WAVE = 1;
export const MIRROR_BASH = 2;
export const MIRROR_COPY = 3;

/** 模写の形 */
export type MirrorCopyForm = "ring" | "line" | "fan" | "lunge";
/** ai.timer に添字で持つ（数値しか置けないため） */
const COPY_FORMS: readonly MirrorCopyForm[] = ["ring", "line", "fan", "lunge"];
const FALLBACK_FORM: MirrorCopyForm = "fan";
const FORM_OF_ACT: Readonly<Record<ArtActKind, MirrorCopyForm>> = {
  ring: "ring",
  detonate: "ring",
  buff: "ring",
  line: "line",
  chain: "line",
  shot: "fan",
  arc: "fan",
  pull: "fan",
  dash: "lunge",
  blink: "lunge",
};
/** 何回に 1 回模写するか（第 2 段階の技の選び） */
const COPY_EVERY = 2;

const CRACK_TEXT = "盾割れ";
const SLAM_TEXT = "激突";
const RECOIL_TEXT = "反動";
const PANE_TEXT = "鏡割れ";
const COPY_STAGE_TEXT = "模写";
const IMAGES_TEXT = "写し身";
/** 写すものが無いときに乗せる状態異常 */
const FALLBACK_COPY: StatusKind = "bleed";
/** 正面の判定（盾で跳ね返す角度の半分の余弦。約 60°） */
const FRONT_COS = 0.5;
const FULL_CIRCLE = Math.PI * 2;
/** 最初の写し身を置く距離 */
const IMAGE_OFFSET = 36;
/** 剣の波の予告の扇が届く距離を、弾が飛ぶ秒で決める（弾は消えるまで飛ぶので予告は目安） */
const WAVE_TELEGRAPH_SEC = 0.5;

/** 技が実際に出す形 */
type StrikeKind = "lunge" | "wave" | "bash" | "ring" | "line";

const HOOKS: BossHooks = {
  approach: (state, e, def, dt) => walkToward(state, e, def, dt),
  beginWindup,
  beginStrike,
  tickStrike,
  pickMove,
  followUp,
};

export function updateMirrorKnight(state: GameState, e: Enemy, def: EnemyDef, dt: number): void {
  if (!e.ai) return;
  advanceStage(state, e);
  tickImages(state, e, dt);
  runBossCycle(state, e, def, dt, HOOKS);
}

// -----------------------------------------------------------------------------
// 段階
// -----------------------------------------------------------------------------

function advanceStage(state: GameState, e: Enemy): void {
  const ai = e.ai;
  if (!ai) return;
  const m = BOSS.mirrorKnight;
  if (ai.stage === STAGE_ONE && (e.hp <= e.maxHp * m.phase2Ratio || (ai.progress ?? 0) >= m.slamsToCrack)) {
    enterStage(state, e, COPY_STAGE_TEXT, STAGE_COPY);
    return;
  }
  if (ai.stage === STAGE_COPY && e.hp <= e.maxHp * m.phase3Ratio) {
    enterStage(state, e, IMAGES_TEXT, STAGE_IMAGES);
    summonImages(state, e);
    raisePanes(state, e);
  }
}

/** 段階に入る: 技の選びの記憶を空にして、その段階の最初の技を選び直す */
function enterStage(state: GameState, e: Enemy, text: string, stage: number): void {
  const ai = e.ai;
  if (!ai) return;
  phaseShift(state, e, text, BOSS.mirrorKnight.color, stage);
  ai.counter = 0;
  ai.chain = 0;
  ai.timer = 0;
  repick(state, e);
}

/** 自傷のダウンの後は、同じ技を繰り返さず選び直す */
function repick(state: GameState, e: Enemy): void {
  const ai = e.ai;
  if (!ai) return;
  ai.move = pickMove(state, e, readPlayer(state, e));
}

// -----------------------------------------------------------------------------
// 技の選び（乱数なし）
// -----------------------------------------------------------------------------

function pickMove(_state: GameState, e: Enemy, read: PlayerRead): number {
  const ai = e.ai;
  if (!ai) return MIRROR_LUNGE;
  if (ai.stage === STAGE_COPY) {
    ai.counter += 1;
    if (ai.counter % COPY_EVERY === 0) return MIRROR_COPY;
    if (read.band === "near") return MIRROR_BASH;
    return read.band === "far" ? MIRROR_WAVE : MIRROR_LUNGE;
  }
  if (ai.stage === STAGE_IMAGES) {
    if (read.band === "near") return MIRROR_BASH;
    return read.band === "far" ? MIRROR_WAVE : MIRROR_LUNGE;
  }
  return read.band === "near" ? MIRROR_BASH : MIRROR_LUNGE;
}

/** 連撃: 第 3 段階は盾打ちの後に突進を続ける */
function followUp(_state: GameState, e: Enemy, done: number): number | null {
  const ai = e.ai;
  if (!ai || ai.stage !== STAGE_IMAGES || done !== MIRROR_BASH) return null;
  return (ai.chain ?? 0) === 0 ? MIRROR_LUNGE : null;
}

// -----------------------------------------------------------------------------
// 模写
// -----------------------------------------------------------------------------

/** 模写の形: 直前に撃ったスキル（技）の最初の行為の種類で決める。技でない・撃っていなければ扇 */
export function mirrorCopyForm(state: GameState): MirrorCopyForm {
  const key = state.skills.lastCast?.skillKey;
  if (key === undefined || !isArtKey(key)) return FALLBACK_FORM;
  const kind = ART_DEFS[key].acts[0]?.kind;
  return kind === undefined ? FALLBACK_FORM : FORM_OF_ACT[kind];
}

/** 予備動作の間に固定した模写の形 */
export function mirrorCopyFormOf(e: Enemy): MirrorCopyForm {
  return COPY_FORMS[e.ai?.timer ?? 0] ?? FALLBACK_FORM;
}

function strikeKind(e: Enemy): StrikeKind {
  switch (e.ai?.move) {
    case MIRROR_WAVE:
      return "wave";
    case MIRROR_BASH:
      return "bash";
    case MIRROR_COPY:
      return copyStrikeKind(mirrorCopyFormOf(e));
    default:
      return "lunge";
  }
}

function copyStrikeKind(form: MirrorCopyForm): StrikeKind {
  if (form === "fan") return "wave";
  return form;
}

// -----------------------------------------------------------------------------
// 状態機械のフック
// -----------------------------------------------------------------------------

function beginWindup(state: GameState, e: Enemy, def: EnemyDef): void {
  const ai = e.ai;
  e.strikeDir = toPlayer(state, e);
  e.phaseTimer = scaledWindup(def.windup, state.depth);
  if (ai?.move !== MIRROR_COPY) return;
  const form = mirrorCopyForm(state);
  ai.timer = COPY_FORMS.indexOf(form);
  // 光線は予備動作の終わりの向きで撃つ（予告の線と同じ場所）
  if (form === "line") ai.target = laserEnd(state, e.body.pos, e.strikeDir, ENEMY_AI.laser.length);
}

function beginStrike(state: GameState, e: Enemy, def: EnemyDef): void {
  const m = BOSS.mirrorKnight;
  switch (strikeKind(e)) {
    case "wave":
      e.phaseTimer = def.strikeTime;
      fireWave(state, e);
      return;
    case "bash":
      e.phaseTimer = def.strikeTime;
      bash(state, e);
      return;
    case "ring":
      e.phaseTimer = def.strikeTime;
      spawnShockwave(state, e.body.pos, m.copyRingRadius, depthDamage(m.copyDamage, state.depth), e.id);
      shake(state, FEEL.shakeSpecial);
      return;
    case "line":
      e.phaseTimer = def.strikeTime;
      spawnLaser(state, e.body.pos, e.ai?.target ?? e.body.pos, m.copyLaserTime, depthDamage(m.copyDamage, state.depth), e.id);
      pushSfx(state, "enemyShoot");
      pushSfx(state, "laserFire");
      return;
    default:
      e.phaseTimer = m.lungeTime;
      e.strikeDir = toPlayer(state, e);
      if (e.strikeDir.x !== 0) e.facing = e.strikeDir;
  }
}

function fireWave(state: GameState, e: Enemy): void {
  const m = BOSS.mirrorKnight;
  const damage = depthDamage(m.waveDamage, state.depth);
  for (const dir of fanDirections(e.strikeDir, m.waveCount, m.waveSpread)) {
    fireEnemyBullet(state, { pos: add(e.body.pos, scale(dir, e.body.radius + 2)), dir, speed: m.waveSpeed, damage, color: m.color, sourceId: e.id });
  }
  pushSfx(state, "enemyShoot");
}

/** 盾打ち: 扇の中にいれば当たる（出だしの 1 回。突進より短く広い） */
function bash(state: GameState, e: Enemy): void {
  const m = BOSS.mirrorKnight;
  if (e.strikeDir.x !== 0) e.facing = e.strikeDir;
  spawnBurst(state, add(e.body.pos, scale(e.strikeDir, e.body.radius + 6)), m.color, 8, 80, 0.25, 1.5);
  pushSfx(state, "wallHit");
  const p = state.player.body;
  if (!inCone(e.body.pos, e.strikeDir, m.bashRange + p.radius, m.bashHalfDeg, p.pos)) return;
  if (damagePlayer(state, depthDamage(m.bashDamage, state.depth), e.body.pos, e) !== "hit") return;
  inflictOnPlayer(state, e, "contact");
  applyCopiedStatus(state, e);
  shake(state, FEEL.shakeHeavy);
}

function tickStrike(state: GameState, e: Enemy, def: EnemyDef, dt: number): boolean {
  if (strikeKind(e) === "lunge") return tickLunge(state, e, def, dt);
  // 突進でない模写は出した次のステップで反動（効果そのものは危険物として残る）
  if (e.ai?.move !== MIRROR_COPY) return false;
  copyRecoil(state, e);
  return true;
}

/** 突進: 触れたら写した状態異常も乗せる。壁に激突するとダウン。模写の突進は終わりに反動 */
function tickLunge(state: GameState, e: Enemy, def: EnemyDef, dt: number): boolean {
  const hpBefore = state.player.hp;
  const step = lungeStep(state, e, def, BOSS.mirrorKnight.lungeSpeedMul, dt);
  if (step.touched && state.player.hp < hpBefore) applyCopiedStatus(state, e);
  if (step.wall) {
    wallSlam(state, e);
    return true;
  }
  if (e.ai?.move === MIRROR_COPY && (step.touched || e.phaseTimer <= 0)) {
    copyRecoil(state, e);
    return true;
  }
  return step.touched;
}

/** 壁激突: ダウン。第 1 段階では数えて、slamsToCrack 回目は「盾割れ」（段階は騎士が起きたときに進む） */
function wallSlam(state: GameState, e: Enemy): void {
  const ai = e.ai;
  if (!ai) return;
  const m = BOSS.mirrorKnight;
  const counted = ai.stage === STAGE_ONE;
  const cracks = counted && (ai.progress ?? 0) + 1 >= m.slamsToCrack;
  if (!bossDown(state, e, m.wallStagger, cracks ? CRACK_TEXT : SLAM_TEXT, m.color)) return;
  if (counted) ai.progress = (ai.progress ?? 0) + 1;
  repick(state, e);
}

function copyRecoil(state: GameState, e: Enemy): void {
  const m = BOSS.mirrorKnight;
  if (!bossDown(state, e, m.copyRecoil, RECOIL_TEXT, m.color)) return;
  repick(state, e);
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

// -----------------------------------------------------------------------------
// 写し身と姿見（第 3 段階）
// -----------------------------------------------------------------------------

/** 写し身: 本体の HP の一部を持つ小さな騎士。残っている間は本体が守られる */
function spawnImage(state: GameState, e: Enemy, want: Vec): void {
  const def = enemyDef("mirrorImage");
  const image = createEnemy(state, def, spawnSpot(state, want, e.body.pos, def.radius), e.roomIndex, true);
  image.maxHp = Math.max(1, Math.round(e.maxHp * BOSS.mirrorKnight.imageHpRatio));
  image.hp = image.maxHp;
  image.lastHp = image.hp;
  image.leaderId = e.id;
  image.revived = true;
  state.enemies.push(image);
}

function summonImages(state: GameState, e: Enemy): void {
  const n = BOSS.mirrorKnight.images;
  for (let i = 0; i < n; i++) {
    spawnImage(state, e, add(e.body.pos, scale(fromAngle((i / n) * FULL_CIRCLE), IMAGE_OFFSET)));
  }
}

/** 姿見: 部屋の中央から左右に立てる置物。割ると騎士がダウンし、立っている間は写し身が戻る */
function raisePanes(state: GameState, e: Enemy): void {
  const m = BOSS.mirrorKnight;
  const room = state.rooms[e.roomIndex];
  const center = room ? rectCenterPx(room.rect) : { ...e.body.pos };
  const def = enemyDef("mirrorPane");
  for (let i = 0; i < m.panes; i++) {
    // 左右へ交互（0 = 右、1 = 左、2 = さらに右へ…）
    const side = i % 2 === 0 ? 1 : -1;
    const reach = m.paneOffset * (1 + Math.floor(i / 2));
    const want = { x: center.x + side * reach, y: center.y };
    const pane = createEnemy(state, def, spawnSpot(state, want, center, def.radius), e.roomIndex, true);
    pane.leaderId = e.id;
    state.enemies.push(pane);
  }
  if (e.ai) e.ai.counter = m.panes;
}

function panesOf(state: GameState, e: Enemy): Enemy[] {
  return followersOf(state, e).filter((o) => o.defKey === "mirrorPane");
}

function imagesOf(state: GameState, e: Enemy): Enemy[] {
  return followersOf(state, e).filter((o) => o.defKey === "mirrorImage");
}

/** 第 3 段階の毎ステップ: 姿見が割れたらダウン、姿見が残っていれば倒された写し身を戻す */
function tickImages(state: GameState, e: Enemy, dt: number): void {
  const ai = e.ai;
  if (!ai || ai.stage !== STAGE_IMAGES) return;
  const panes = panesOf(state, e);
  if (panes.length < ai.counter) {
    ai.counter = panes.length;
    const m = BOSS.mirrorKnight;
    if (bossDown(state, e, m.paneDown, PANE_TEXT, m.color)) repick(state, e);
  }
  reformImages(state, e, panes, dt);
}

function reformImages(state: GameState, e: Enemy, panes: readonly Enemy[], dt: number): void {
  const ai = e.ai;
  if (!ai) return;
  const alive = imagesOf(state, e).length;
  const pane = panes[alive % Math.max(1, panes.length)];
  if (!pane || alive >= BOSS.mirrorKnight.images) {
    ai.timer = 0;
    return;
  }
  if (ai.timer <= 0) {
    ai.timer = BOSS.mirrorKnight.imageReform;
    return;
  }
  ai.timer -= dt;
  if (ai.timer > 0) return;
  ai.timer = 0;
  spawnImage(state, e, pane.body.pos);
  spawnBurst(state, pane.body.pos, BOSS.mirrorKnight.color, 10, 80, 0.4, 1.5);
}

/** 写し身が残っている間に本体が受けるダメージの倍率 */
export function mirrorKnightTakenMul(state: GameState, e: Enemy): number {
  return imagesOf(state, e).length > 0 ? BOSS.mirrorKnight.imageGuardMul : 1;
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

/** 予告の形: 突進は線、剣の波と盾打ちは扇、模写は写す形（輪・光線・扇・線） */
export function mirrorKnightTelegraph(e: Enemy): EnemyTelegraph {
  if (!e.ai) return null;
  const m = BOSS.mirrorKnight;
  switch (strikeKind(e)) {
    case "wave":
      return { kind: "cone", range: m.waveSpeed * WAVE_TELEGRAPH_SEC, halfDeg: m.waveSpread / 2 };
    case "bash":
      return { kind: "cone", range: m.bashRange, halfDeg: m.bashHalfDeg };
    case "ring":
      return { kind: "ring", radius: m.copyRingRadius };
    case "line":
      return { kind: "laser" };
    default:
      return { kind: "line" };
  }
}

/** 署名の技（最深の主の第三の顔が借りる）: 剣の波 */
export const MIRROR_KNIGHT_SIGNATURE = signatureOf("mirrorKnight", MIRROR_WAVE, HOOKS, mirrorKnightTelegraph);
