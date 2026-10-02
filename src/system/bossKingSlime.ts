import { type Enemy, type GameState, pushSfx } from "../core/state";
import { type Vec, add, clamp, dist, fromAngle, scale, sub } from "../core/vec";
import { type EnemyDef, depthDamage, enemyDef } from "../data/enemies";
import { BOSS, FEEL } from "../data/tuning";
import { TILE_SIZE, rectCenterPx } from "../map/grid";
import { damagePlayer } from "./combat";
import { addFloatingText, shake, spawnBurst } from "./effects";
import { type EnemyTelegraph, createEnemy, moveEnemy, scaledWindup } from "./enemies";
import { seedTerrain } from "./enemyTerrain";
import { spawnSpot } from "./enemyTraits";
import { spawnLanding, spawnShockwave } from "./hazards";
import { circlesOverlap, overlapsWall } from "./physics";
import { inflictOnPlayer } from "./statusEffects";
import {
  type BossAnswerHit,
  type BossHooks,
  type PlayerRead,
  advanceBossStage,
  bossDown,
  bossDownCount,
  oweBossDown,
  readPlayer,
  runBossCycle,
  signatureOf,
  toPlayer,
} from "./bossKit";

/**
 * ボス: スライム王（章 1。docs/ideas/boss-reading-impl.md）。「動きを読めば勝て、読まなければ削られる」3 つの動詞の試験。
 * 段階 1（跳躍）= 下絵のうちに、跳んだ王を打つ（墜落）。予備動作そのものが空中（上昇 + 滞空が下絵、落下が墨入れ）。
 * 段階 2（分裂）= 分裂体のうち最も遠い 1 体が冠を被り、王の陰に隠れる。冠を割れば冠落ち（大きなダウン）、
 * 冠を呑まれると回復して段階 3 へ進む（失敗の道）。呑みは最初から墨入れで、消化中も王は動く。
 * 段階 3（膨張）= 近くへは噛み（着地を受け流すと呑み損ね = 最終段階の答え）、遠くへは跳躍、中間では中央へ跳んで膨張。
 * 答えのない技（呑み・噛み・膨張・続け跳び）は予備動作の最初から墨入れ。答えのダウンは bossDown の tag で数える
 */

const STAGE_JUMP = 1;
const STAGE_SPLIT = 2;
const STAGE_INFLATE = 3;
/** ai.move: 技 */
export const KS_JUMP = 0;
export const KS_SWALLOW = 1;
/** 部屋の中央へ跳ぶ（膨張の前段。続けて KS_INFLATE） */
export const KS_CENTER = 2;
export const KS_INFLATE = 3;
/** 噛み: 近くのプレイヤーへ低く跳ぶ。着地の瞬間を受け流すと呑み損ね */
export const KS_BITE = 4;
/** ai.progress の意味: 段階 1 では墜落の数、段階 2 では冠の状態 */
export const CROWN_ALIVE = 0;
export const CROWN_BROKEN = 1;
export const CROWN_EATEN = 2;
const FULL_CIRCLE = Math.PI * 2;
const SPLIT_TEXT = "分裂！";
const INFLATE_TEXT = "膨張";
const SWALLOW_TEXT = "呑み込み";
const SPIT_TEXT = "吐き出し";
const DROP_TEXT = "墜落";
const CROWN_FALL_TEXT = "冠落ち";
const CROWN_EAT_TEXT = "冠呑み";
const BITE_MISS_TEXT = "呑み損ね";
const SPLIT_TEXT_COLOR = "#80ff80";
const SWALLOW_TEXT_COLOR = "#c0ffb0";
const ANSWER_TEXT_COLOR = "#ffe880";
const HEAL_COLOR = "#60ff90";
const MINION_KEY = "slime";
const CROWN_KEY = "crownSlime";
/** 着地直下でのダメージ判定半径（衝撃波の半径に対する割合） */
const SLAM_CORE_RATIO = 0.4;
const SPLIT_OFFSET = 18;
/** 中央に着いたとみなす距離（px） */
const CENTER_TOLERANCE = TILE_SIZE;
/** 浮き文字の持ち上げ（px） */
const TEXT_LIFT = 18;
/** 衝撃波の時刻の比較の余裕（浮動小数の積み上げで最後の 1 重を落とさない） */
const WAVE_EPSILON = 1e-6;
/** 噛み・呑みの低い跳びの高さ（描画。高い跳躍を 1 とした割合） */
const LOW_HOP_LIFT = 0.4;
/** 冠が王の陰へ着いたとみなす距離（px。着いたら止まる） */
const CROWN_ARRIVE = 3;

const HOOKS: BossHooks = {
  approach,
  beginWindup,
  beginStrike,
  tickStrike,
  tickWindup,
  openTime,
  pickMove,
  followUp,
  chainWindupMul: (_e, next) => (next === KS_INFLATE ? 1 : BOSS.rules.chainWindupMul),
  recoverTime,
};

export function updateKingSlime(state: GameState, e: Enemy, def: EnemyDef, dt: number): void {
  const ai = e.ai;
  if (!ai) return;
  // 前の呑み（か分裂）からの秒。第 2 段階の技の枝が読む
  ai.timer += dt;
  tickDigest(state, e);
  tickCrown(state, e, dt);
  // 冠落ちでダウンさせたら、同じ更新で段階を進めない（起き上がった後に進む）
  if (checkCrown(state, e)) return;
  advanceStage(state, e);
  runBossCycle(state, e, def, dt, HOOKS);
}

function speedMul(e: Enemy): number {
  return (e.ai?.stage ?? STAGE_JUMP) >= STAGE_SPLIT ? BOSS.kingSlime.phase2SpeedMul : 1;
}

function kingColor(): string {
  return enemyDef("kingSlime").color;
}

/** 高い跳躍（予備動作が空中で、下絵 → 墨入れ。答えは墜落）。中央へ戻る跳躍も同じ */
function isHighJump(move: number | undefined): boolean {
  return move === KS_JUMP || move === KS_CENTER;
}

// -----------------------------------------------------------------------------
// 段階
// -----------------------------------------------------------------------------

function advanceStage(state: GameState, e: Enemy): void {
  const ai = e.ai;
  if (!ai) return;
  const ks = BOSS.kingSlime;
  if (ai.stage === STAGE_JUMP) {
    // 墜落が溜まった（行為）か、生命が減った（保険）。ダウンの途中では更新が止まるので、起き上がった後に進む
    const byAct = (ai.progress ?? 0) >= ks.dropsToSplit;
    if (byAct || e.hp <= e.maxHp * ks.phase2Ratio) splitKingSlime(state, e, byAct);
    return;
  }
  if (ai.stage !== STAGE_SPLIT) return;
  if (ai.progress === CROWN_BROKEN) {
    advanceBossStage(state, e, INFLATE_TEXT, kingColor(), STAGE_INFLATE, true);
    return;
  }
  if (e.hp <= e.maxHp * ks.phase3Ratio) {
    dissolveSplits(state, e);
    advanceBossStage(state, e, INFLATE_TEXT, kingColor(), STAGE_INFLATE, false);
  }
}

function splitKingSlime(state: GameState, e: Enemy, byAct: boolean): void {
  advanceBossStage(state, e, SPLIT_TEXT, SPLIT_TEXT_COLOR, STAGE_SPLIT, byAct);
  const ai = e.ai;
  if (!ai) return;
  ai.timer = 0;
  ai.progress = CROWN_ALIVE;
  const ks = BOSS.kingSlime;
  const slots = Array.from({ length: ks.splitCount }, (_, i) => {
    const pos = add(e.body.pos, scale(fromAngle((i / ks.splitCount) * FULL_CIRCLE), SPLIT_OFFSET));
    return overlapsWall(state, pos.x, pos.y, enemyDef(MINION_KEY).radius) ? { ...e.body.pos } : pos;
  });
  const crownSlot = farthestSlot(slots, state.player.body.pos);
  slots.forEach((pos, i) => {
    const isCrown = i === crownSlot;
    const minion = createEnemy(state, enemyDef(isCrown ? CROWN_KEY : MINION_KEY), pos, e.roomIndex, true);
    minion.leaderId = e.id;
    if (isCrown) {
      // 冠の生命は王の最大生命から決める（王を深度で伸ばしても冠が脆すぎ・硬すぎにならない）
      const hp = Math.max(1, Math.round(e.maxHp * ks.crownHpRatio));
      minion.maxHp = hp;
      minion.hp = hp;
      minion.lastHp = hp;
    }
    state.enemies.push(minion);
  });
}

/** プレイヤーから最も遠い位置の添字（同じ距離は添字の小さい方。乱数なし） */
function farthestSlot(slots: readonly Vec[], from: Vec): number {
  let best = 0;
  let bestD = -1;
  slots.forEach((pos, i) => {
    const d = dist(pos, from);
    if (d <= bestD) return;
    best = i;
    bestD = d;
  });
  return best;
}

/** 生きている分裂体（冠を含む） */
export function splitsOf(state: GameState, e: Enemy): Enemy[] {
  return state.enemies.filter((o) => o.hp > 0 && o.leaderId === e.id && (o.defKey === MINION_KEY || o.defKey === CROWN_KEY));
}

/** 生きている冠スライム */
export function crownOf(state: GameState, e: Enemy): Enemy | undefined {
  return state.enemies.find((o) => o.hp > 0 && o.leaderId === e.id && o.defKey === CROWN_KEY);
}

/** 冠でない分裂体 */
function plainSplits(state: GameState, e: Enemy): Enemy[] {
  return splitsOf(state, e).filter((o) => o.defKey !== CROWN_KEY);
}

/** 分裂体と冠を溶かす（撃破に数えない） */
function dissolveSplits(state: GameState, e: Enemy): void {
  for (const o of splitsOf(state, e)) {
    o.hp = 0;
    o.vanished = true;
  }
}

/** 部屋の後始末（boss.ts の onBossDeath が呼ぶ）: 王が倒れたら冠と分裂体も溶けて、部屋に何も残さない */
export function settleKingSlimeRoom(state: GameState, e: Enemy): void {
  dissolveSplits(state, e);
}

// -----------------------------------------------------------------------------
// 冠
// -----------------------------------------------------------------------------

/**
 * 冠スライムは王の陰（王から見てプレイヤーの反対側）へ歩く。王が跳んでいる間（予備動作・攻撃中）は動かない
 * = 王が跳ぶと冠が晒される。怯み中は王の更新が止まるので、陰を追わない。
 * 冠自身は動かない敵（Stationary）なので、位置はここで運ぶ（状態は書かない）
 */
function tickCrown(state: GameState, e: Enemy, dt: number): void {
  const crown = crownOf(state, e);
  if (!crown || crown.phase !== "chase") return;
  if (e.phase === "windup" || e.phase === "strike") return;
  const away = toPlayer(state, e);
  const shade = add(e.body.pos, scale(away, -BOSS.kingSlime.crownShade));
  const to = sub(shade, crown.body.pos);
  const d = Math.hypot(to.x, to.y);
  if (d <= CROWN_ARRIVE) return;
  const def = enemyDef(CROWN_KEY);
  const step = Math.min(d, def.speed * dt);
  moveEnemy(state, crown, def, (to.x / d) * step, (to.y / d) * step);
}

/** 冠スライムを倒した: 冠落ち（王が大きなダウン。分裂体は溶ける）。起き上がった後に段階 3 */
function checkCrown(state: GameState, e: Enemy): boolean {
  const ai = e.ai;
  if (!ai || ai.stage !== STAGE_SPLIT || ai.progress !== CROWN_ALIVE) return false;
  if (crownOf(state, e)) return false;
  ai.progress = CROWN_BROKEN;
  dissolveSplits(state, e);
  bossDown(state, e, BOSS.kingSlime.crownDown, CROWN_FALL_TEXT, ANSWER_TEXT_COLOR, "answer");
  return true;
}

// -----------------------------------------------------------------------------
// 消化（呑んだ後に回復が入るまで。王は普通に動く）
// -----------------------------------------------------------------------------

function tickDigest(state: GameState, e: Enemy): void {
  const ai = e.ai;
  if (!ai || (ai.digest ?? 0) <= 0) return;
  const ks = BOSS.kingSlime;
  // 消化中にダウンした（墜落・怯み・冠落ち）: 吐き出して回復しない
  if (bossDownCount(state, e) > (ai.digestMark ?? 0)) {
    ai.digest = 0;
    addFloatingText(state, { x: e.body.pos.x, y: e.body.pos.y - TEXT_LIFT }, SPIT_TEXT, SWALLOW_TEXT_COLOR, 1.5, 1.1, "notice");
    spawnBurst(state, e.body.pos, kingColor(), 14, 120, 0.4, 2);
    return;
  }
  if (ai.timer < ks.swallowHopTime + ks.digestTime) return;
  const heal = Math.round((ai.digest ?? 0) * ks.swallowHealRatio * e.maxHp);
  ai.digest = 0;
  e.hp = Math.min(e.maxHp, e.hp + heal);
  spawnBurst(state, e.body.pos, HEAL_COLOR, 16, 80, 0.5, 2);
  pushSfx(state, "heal");
}

// -----------------------------------------------------------------------------
// 技の選び（乱数なし）
// -----------------------------------------------------------------------------

function pickMove(state: GameState, e: Enemy, read: PlayerRead): number {
  const ai = e.ai;
  const stage = ai?.stage ?? STAGE_JUMP;
  if (stage === STAGE_SPLIT) {
    const due = (ai?.timer ?? 0) >= BOSS.kingSlime.swallowEvery;
    return due && splitsOf(state, e).length > 0 ? KS_SWALLOW : KS_JUMP;
  }
  if (stage !== STAGE_INFLATE) return KS_JUMP;
  if (read.band === "near") return KS_BITE;
  // 遠くで様子を見ている相手には跳んで詰める（その後また中央へ戻る）
  if (read.band === "far") return KS_JUMP;
  return atCenter(state, e) ? KS_INFLATE : KS_CENTER;
}

/** 連撃: 第 1 段階は止まっている相手へもう 1 度跳ぶ（最初から墨入れ）。中央に着いたら膨張 */
function followUp(state: GameState, e: Enemy, done: number): number | null {
  const ai = e.ai;
  if (!ai) return null;
  if (done === KS_CENTER) return KS_INFLATE;
  if (done !== KS_JUMP || ai.stage !== STAGE_JUMP) return null;
  if ((ai.chain ?? 0) >= BOSS.kingSlime.stillJumpChain) return null;
  return readPlayer(state, e).stillSec >= BOSS.rules.stillSec ? KS_JUMP : null;
}

function recoverTime(_state: GameState, e: Enemy, def: EnemyDef): number {
  if (e.ai?.move === KS_INFLATE) return BOSS.kingSlime.inflateRecover;
  return def.recover / speedMul(e);
}

// -----------------------------------------------------------------------------
// 状態機械のフック
// -----------------------------------------------------------------------------

function approach(state: GameState, e: Enemy, def: EnemyDef, dt: number): void {
  const dir = toPlayer(state, e);
  if (dir.x !== 0) e.facing = dir;
  // 膨張は中央で待つ（歩くと四隅の安全が崩れる）
  if (e.ai?.move === KS_INFLATE) return;
  const speed = def.speed * speedMul(e) * dt;
  moveEnemy(state, e, def, dir.x * speed, dir.y * speed);
}

/** 高い跳躍の滞空の秒（段階で変わる。深度で縮む） */
function hoverSec(e: Enemy, depth: number): number {
  const ks = BOSS.kingSlime;
  return scaledWindup((e.ai?.stage ?? STAGE_JUMP) >= STAGE_SPLIT ? ks.phase2Hover : ks.jumpHover, depth);
}

/** 高い跳躍の予備動作のうち上昇が占める割合（連撃で予備動作が縮んでも比で進む） */
function riseShare(e: Enemy, depth: number): number {
  const rise = BOSS.kingSlime.jumpRise;
  return rise / (rise + hoverSec(e, depth));
}

function beginWindup(state: GameState, e: Enemy, def: EnemyDef): void {
  const ai = e.ai;
  if (!ai) return;
  const ks = BOSS.kingSlime;
  e.strikeDir = toPlayer(state, e);
  switch (ai.move) {
    case KS_INFLATE:
      e.phaseTimer = scaledWindup(ks.inflateWindup, state.depth);
      // 衝撃波の届く範囲を影で見せる（部屋で半径が変わるので、形の予告ではなく影で出す）
      spawnLanding(state, e.body.pos, inflateRadius(state, e), e.phaseTimer, e.id);
      return;
    case KS_BITE:
      // 噛みの屈み: 最初から墨入れ（答えは着地の受け流し）
      e.phaseTimer = scaledWindup(ks.biteWindup, state.depth);
      return;
    case KS_JUMP:
    case KS_CENTER:
      beginHighJump(state, e);
      return;
    default:
      // 第 2 段階の速さと深度の短縮を掛けても、基準の 60% は残す（scaledWindup の下限）
      e.phaseTimer = scaledWindup(def.windup, state.depth, 1 / speedMul(e));
      return;
  }
}

/** 高い跳躍: 予備動作の始まりに跳び上がる。着地点と影を決め、上昇 + 滞空の間（下絵）影が縮む */
function beginHighJump(state: GameState, e: Enemy): void {
  const ai = e.ai;
  if (!ai) return;
  const ks = BOSS.kingSlime;
  const isCenter = ai.move === KS_CENTER;
  const want = isCenter ? roomCenter(state, e) : { ...state.player.body.pos };
  // 空中なので壁は越えるが、着地点は王の体が入る所に寄せる
  ai.target = spawnSpot(state, want, want, e.body.radius);
  ai.points = [{ ...e.body.pos }];
  e.phaseTimer = ks.jumpRise + hoverSec(e, state.depth);
  const shadow = spawnLanding(state, ai.target, isCenter ? ks.swallowRingRadius : ks.shockRadius, e.phaseTimer + ks.jumpFall, e.id);
  shadow.airTime = ks.jumpFall;
  spawnBurst(state, e.body.pos, enemyDef("kingSlime").color, 10, 90, 0.3, 2);
}

/** 高い跳躍は予備動作の全部が下絵（落下は攻撃中 = 墨入れ）。他の技は最初から墨入れ */
function openTime(_state: GameState, e: Enemy): number {
  return isHighJump(e.ai?.move) ? e.phaseTimer : 0;
}

/** 上昇の間に体を影の真上へ運ぶ（空中なので moveEnemy を通さず壁を越える）。絵と当たりをずらさない */
function tickWindup(state: GameState, e: Enemy, _def: EnemyDef, _dt: number): void {
  const ai = e.ai;
  const start = ai?.points?.[0];
  if (!ai || !start || !isHighJump(ai.move) || e.windupTotal <= 0) return;
  const riseSec = e.windupTotal * riseShare(e, state.depth);
  const f = clamp((e.windupTotal - e.phaseTimer) / riseSec, 0, 1);
  const eased = 1 - (1 - f) * (1 - f);
  e.body.pos = { x: start.x + (ai.target.x - start.x) * eased, y: start.y + (ai.target.y - start.y) * eased };
}

function beginStrike(state: GameState, e: Enemy, def: EnemyDef): void {
  const ai = e.ai;
  if (!ai) return;
  const ks = BOSS.kingSlime;
  switch (ai.move) {
    case KS_INFLATE:
      ai.counter = 0;
      e.phaseTimer = Math.max(0, ks.waveCount - 1) * ks.waveGap;
      fireInflateWaves(state, e);
      return;
    case KS_SWALLOW: {
      ai.timer = 0;
      const prey = nearest(swallowCandidates(state, e), e.body.pos);
      leap(state, e, def, prey ? prey.body.pos : e.body.pos, ks.swallowHopTime, ks.swallowRingRadius);
      return;
    }
    case KS_BITE:
      leap(state, e, def, state.player.body.pos, ks.biteHopTime, ks.biteRadius);
      return;
    default:
      // 高い跳躍: 影の真上から落ちる（墨入れ）。影は予備動作から続く
      e.phaseTimer = ks.jumpFall;
      return;
  }
}

/** 低い跳び（呑み・噛み）: 着地点を決めて影を出す（影の間は空中で無害） */
function leap(state: GameState, e: Enemy, def: EnemyDef, to: Vec, time: number, shadow: number): void {
  const ai = e.ai;
  if (!ai) return;
  ai.target = { ...to };
  e.phaseTimer = time;
  const landing = spawnLanding(state, ai.target, shadow, time, e.id);
  landing.airTime = time;
  spawnBurst(state, e.body.pos, def.color, 10, 90, 0.3, 2);
}

function tickStrike(state: GameState, e: Enemy, def: EnemyDef, dt: number): boolean {
  const ai = e.ai;
  if (!ai) return false;
  if (ai.move === KS_INFLATE) {
    fireInflateWaves(state, e);
    return false;
  }
  if (isHighJump(ai.move)) {
    // 真上から落ちるだけ（移動は上昇で済んでいる）
    if (e.phaseTimer > 0) return false;
    land(state, e, def);
    return true;
  }
  // 低い跳び: 着地点へ向かって移動する（壁は無視しない）。phaseTimer は runBossCycle が減らした後
  const remaining = Math.max(dt, e.phaseTimer + dt);
  const step = scale(sub(ai.target, e.body.pos), Math.min(1, dt / remaining));
  moveEnemy(state, e, def, step.x, step.y);
  if (e.phaseTimer > 0) return false;
  land(state, e, def);
  return true;
}

function land(state: GameState, e: Enemy, def: EnemyDef): void {
  // 着地した影は次の予備動作（連撃）に引きずられて蘇らないよう済みにする（hazards.syncLanding）
  for (const h of state.hazards) if (h.kind === "landing" && h.sourceId === e.id && h.airTime !== undefined) h.spent = true;
  switch (e.ai?.move) {
    case KS_SWALLOW:
      swallow(state, e);
      return;
    case KS_BITE:
      bite(state, e, def);
      return;
    case KS_CENTER:
      spawnBurst(state, e.body.pos, def.color, 16, 120, 0.4, 2);
      shake(state, FEEL.shakeHeavy);
      pushSfx(state, "wallHit");
      return;
    default:
      slam(state, e, def);
      return;
  }
}

/** 跳躍の着地: 衝撃波 + 真下の潰し。第 2 段階は着地点に毒沼（床が減る） */
function slam(state: GameState, e: Enemy, def: EnemyDef): void {
  const ks = BOSS.kingSlime;
  const dmg = depthDamage(ks.shockDamage, state.depth);
  spawnShockwave(state, e.body.pos, ks.shockRadius, dmg, e.id);
  spawnBurst(state, e.body.pos, def.color, 24, 160, 0.5, 3);
  shake(state, FEEL.shakeSpecial);
  pushSfx(state, "wallHit");
  const p = state.player.body;
  if (circlesOverlap(e.body.pos.x, e.body.pos.y, ks.shockRadius * SLAM_CORE_RATIO, p.pos.x, p.pos.y, p.radius)) {
    if (damagePlayer(state, dmg, e.body.pos, e) === "hit") inflictOnPlayer(state, e, "shockwave");
  }
  if (e.ai?.stage === STAGE_SPLIT) {
    seedTerrain(state, e.body.pos, "bog", ks.acidRadius, { delay: 0, duration: ks.acidTime, quiet: true });
  }
}

/**
 * 噛みの着地: 小さな当たりに入っていれば噛まれる（潰しより重い = 返す理由）。王を攻撃者に渡すので受け流せる
 * （受け流すと kingSlimeAnswer が呑み損ね）
 */
function bite(state: GameState, e: Enemy, def: EnemyDef): void {
  const ks = BOSS.kingSlime;
  spawnBurst(state, e.body.pos, def.color, 16, 120, 0.4, 2);
  shake(state, FEEL.shakeHeavy);
  pushSfx(state, "wallHit");
  const p = state.player.body;
  if (!circlesOverlap(e.body.pos.x, e.body.pos.y, ks.biteRadius, p.pos.x, p.pos.y, p.radius)) return;
  const result = damagePlayer(state, depthDamage(ks.biteDamage, state.depth), e.body.pos, e);
  if (result === "hit") inflictOnPlayer(state, e, "contact");
}

/** 呑める獲物: 冠でない分裂体。尽きていれば冠（呑まれると冠呑み = 失敗の道） */
function swallowCandidates(state: GameState, e: Enemy): Enemy[] {
  const plain = plainSplits(state, e);
  if (plain.length > 0) return plain;
  const crown = crownOf(state, e);
  return crown ? [crown] : [];
}

/** 呑み: 着地点の近くの獲物を 1 体消す（撃破に数えない）。冠を呑んだら回復して段階 3、他は消化（回復が入るまで） */
function swallow(state: GameState, e: Enemy): void {
  const ai = e.ai;
  if (!ai) return;
  const ks = BOSS.kingSlime;
  const reach = ks.swallowRingRadius;
  const prey = nearest(
    swallowCandidates(state, e).filter((o) => dist(o.body.pos, e.body.pos) <= reach + o.body.radius),
    e.body.pos,
  );
  if (!prey) return;
  prey.hp = 0;
  prey.vanished = true;
  addFloatingText(state, { x: e.body.pos.x, y: e.body.pos.y - TEXT_LIFT }, SWALLOW_TEXT, SWALLOW_TEXT_COLOR, 1.5, 1.1, "notice");
  spawnBurst(state, prey.body.pos, kingColor(), 14, 90, 0.4, 2);
  pushSfx(state, "wallHit");
  if (prey.defKey === CROWN_KEY) {
    eatCrown(state, e);
    return;
  }
  ai.digest = (ai.digest ?? 0) + 1;
  ai.digestMark = bossDownCount(state, e);
}

/** 冠呑み: 失敗の道。回復して冠が王へ戻り、そのまま段階 3 */
function eatCrown(state: GameState, e: Enemy): void {
  const ai = e.ai;
  if (!ai) return;
  ai.progress = CROWN_EATEN;
  e.hp = Math.min(e.maxHp, e.hp + Math.round(e.maxHp * BOSS.kingSlime.crownHealRatio));
  spawnBurst(state, e.body.pos, HEAL_COLOR, 16, 80, 0.5, 2);
  pushSfx(state, "heal");
  addFloatingText(state, { x: e.body.pos.x, y: e.body.pos.y - TEXT_LIFT * 2 }, CROWN_EAT_TEXT, SWALLOW_TEXT_COLOR, 1.5, 1.1, "notice");
  advanceBossStage(state, e, INFLATE_TEXT, kingColor(), STAGE_INFLATE, false);
}

/** 膨張: 攻撃の始まりから waveGap 秒ごとに衝撃波を waveCount 重（ai.counter = 出した数） */
function fireInflateWaves(state: GameState, e: Enemy): void {
  const ai = e.ai;
  if (!ai) return;
  const ks = BOSS.kingSlime;
  const total = Math.max(0, ks.waveCount - 1) * ks.waveGap;
  const elapsed = total - e.phaseTimer;
  const radius = inflateRadius(state, e);
  const dmg = depthDamage(ks.waveDamage, state.depth);
  while (ai.counter < ks.waveCount && elapsed + WAVE_EPSILON >= ai.counter * ks.waveGap) {
    spawnShockwave(state, e.body.pos, radius, dmg, e.id);
    ai.counter += 1;
    shake(state, FEEL.shakeSpecial);
  }
}

/** 膨張の衝撃波の半径: 部屋の最も近い角までの距離 × cornerSafeRatio（四隅だけ届かない） */
export function inflateRadius(state: GameState, e: Enemy): number {
  const room = state.rooms[e.roomIndex];
  if (!room) return BOSS.kingSlime.shockRadius;
  const r = room.rect;
  const xs = [r.x * TILE_SIZE, (r.x + r.w) * TILE_SIZE];
  const ys = [r.y * TILE_SIZE, (r.y + r.h) * TILE_SIZE];
  let nearestCorner = Number.POSITIVE_INFINITY;
  for (const x of xs) for (const y of ys) nearestCorner = Math.min(nearestCorner, dist(e.body.pos, { x, y }));
  return nearestCorner * BOSS.kingSlime.cornerSafeRatio;
}

function roomCenter(state: GameState, e: Enemy): Vec {
  const room = state.rooms[e.roomIndex];
  return room ? rectCenterPx(room.rect) : { ...e.body.pos };
}

function atCenter(state: GameState, e: Enemy): boolean {
  return dist(e.body.pos, roomCenter(state, e)) <= CENTER_TOLERANCE;
}

function nearest(list: readonly Enemy[], from: Vec): Enemy | undefined {
  let best: Enemy | undefined;
  let bestD = Number.POSITIVE_INFINITY;
  for (const o of list) {
    const d = dist(o.body.pos, from);
    if (d < bestD) {
      best = o;
      bestD = d;
    }
  }
  return best;
}

// -----------------------------------------------------------------------------
// 答え（出端・受け流し）
// -----------------------------------------------------------------------------

/**
 * プレイヤーの答えを受け取る（boss.ts の bossOnAnswer から）。
 * - 出端 × 高い跳躍（連撃でない）: 下絵のうちに当たれば墜落（技を取り消してダウン）。墨入れに入ってから当たった
 *   遅れた出端は、技は止めず着地の後に同じダウンを払う（出端は振り始めの色で決まる）。段階 1 では墜落を数える
 * - 受け流し × 噛み: 呑み損ね（最終段階の答え。引導の窓が開く）
 */
export function kingSlimeAnswer(state: GameState, e: Enemy, _def: EnemyDef, hit: BossAnswerHit): void {
  const ai = e.ai;
  if (!ai) return;
  const ks = BOSS.kingSlime;
  if (hit.kind === "debana" && isHighJump(ai.move) && (ai.chain ?? 0) === 0 && (e.phase === "windup" || e.phase === "strike")) {
    // 遅れた出端の墜落は 1 跳びに 1 つ（多段・連打・散弾の出端が重なっても墜落の数を 2 つ以上進めない）
    if (!hit.landedYellow && ai.owedDown !== undefined) return;
    if (ai.stage === STAGE_JUMP) ai.progress = (ai.progress ?? 0) + 1;
    if (hit.landedYellow) bossDown(state, e, ks.dropDown, DROP_TEXT, ANSWER_TEXT_COLOR, "answer");
    else oweBossDown(e, { time: ks.dropDown, text: DROP_TEXT, color: ANSWER_TEXT_COLOR, tag: "answer" });
    return;
  }
  if (hit.kind === "parry" && ai.move === KS_BITE && e.phase === "strike") {
    bossDown(state, e, ks.biteMissDown, BITE_MISS_TEXT, ANSWER_TEXT_COLOR, "final");
  }
}

// -----------------------------------------------------------------------------
// 描画への読み出し（render は state を読むだけ）
// -----------------------------------------------------------------------------

export type KingSlimePose = "idle" | "crouch" | "air" | "fall" | "land";

/** 絵の姿勢。高い跳躍の予備動作は空中（屈みを予告にしない） */
export function kingSlimePose(e: Enemy): KingSlimePose {
  const move = e.ai?.move;
  if (e.phase === "recover") return "land";
  if (e.phase === "windup") return isHighJump(move) ? "air" : "crouch";
  if (e.phase !== "strike") return "idle";
  if (move === KS_INFLATE) return "idle";
  return isHighJump(move) ? "fall" : "air";
}

/** 跳躍の持ち上がり（0..1）。上昇は 0 → 1、滞空は 1、落下は 1 → 0、低い跳びは弧 × LOW_HOP_LIFT。depth は予備動作の滞空の秒を引くのに要る */
export function kingSlimeLift(e: Enemy, depth: number): number {
  const ks = BOSS.kingSlime;
  const move = e.ai?.move;
  if (e.phase === "windup" && isHighJump(move)) {
    if (e.windupTotal <= 0) return 0;
    const riseSec = e.windupTotal * riseShare(e, depth);
    return clamp((e.windupTotal - e.phaseTimer) / riseSec, 0, 1);
  }
  if (e.phase !== "strike") return 0;
  if (isHighJump(move)) return clamp(e.phaseTimer / ks.jumpFall, 0, 1);
  if (move === KS_INFLATE) return 0;
  const hop = move === KS_BITE ? ks.biteHopTime : ks.swallowHopTime;
  const t = clamp(1 - e.phaseTimer / hop, 0, 1);
  return Math.sin(t * Math.PI) * LOW_HOP_LIFT;
}

/**
 * 空中の総秒（旧: 描画の跳ねの高さ用）。描画が kingSlimeLift に移るまでの互換。
 * 高い跳躍の落下は kingSlimeLift が持つので、ここでは低い跳び（呑み・噛み）だけ返す
 */
export function kingSlimeAirTime(e: Enemy): number | null {
  if (e.phase !== "strike") return null;
  switch (e.ai?.move) {
    case KS_SWALLOW:
      return BOSS.kingSlime.swallowHopTime;
    case KS_BITE:
      return BOSS.kingSlime.biteHopTime;
    default:
      return null;
  }
}

/** 予告の形: 呑みは小さな輪（跳躍・噛み・膨張は影か、予告なしの墨入れ） */
export function kingSlimeTelegraph(e: Enemy): EnemyTelegraph {
  if (e.ai?.move === KS_SWALLOW) return { kind: "ring", radius: BOSS.kingSlime.swallowRingRadius };
  return null;
}

/** 署名の技（最深の主の第三の顔が借りる）: 第 1 段階の跳躍 */
export const KING_SLIME_SIGNATURE = signatureOf("kingSlime", KS_JUMP, HOOKS);
