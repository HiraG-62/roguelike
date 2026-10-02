import { type Enemy, type GameState, type Jin, type JinRoutTally, ROAMING_ROOM } from "../core/state";
import { type Vec, add, dist, normalize, scale, sub } from "../core/vec";
import type { EnemyDef } from "../data/enemies";
import { gradeOf } from "../data/enemyRoles";
import { JIN_TEXT } from "../data/actionText";
import { JIN } from "../data/tuning";
import { nextWaypoint } from "../map/pathing";
import { onBetJinSettled, onJinEngaged } from "./bets";
import { addFloatingText } from "./effects";
import { onJinSettled } from "./economy";
import { farFromPlayer, moveEnemy } from "./enemies";
import { vanish } from "./enemyTraits";
import { foldJinzu, onHonjinLeaderFell } from "./jinzu";
import { roomHooks } from "./specialRooms";
import { placeTerrain } from "./terrain";

/**
 * 陣の群勢と敗走（docs/ideas/jin-impl.md 2-7）と、起床の後詰・増援の代わり（2-5）。
 * - 群勢: 生成時のメンバーの格の重さの合計で満ち、仲間が倒れるたびに減る。routRatio を切ると生き残りが 1 体ずつ
 *   逃げるか踏みとどまるかを決める（格ごとの fleeChance。並は逃げやすく精鋭は踏みとどまる）。踏みとどまった者は背水で攻めが速くなる
 * - 逃げる敵は追い詰められると振り向いて自分の攻撃を 1 回返し（窮鼠）、逃げながら足元に泥を撒く（置き土産）。
 *   倒すと銭を多く落とす（追う得）。眠っている陣に合流するとその陣を起こしてこちらへ向かわせる（急報。逃がす損）
 * - 敗走した敵は陣から外れ roomIndex を ROAMING_ROOM にする。部屋の生存者が 0 になるので、決着の報酬は
 *   部屋の制圧（floor.ts の clearRoom）がそのまま出す（全滅・大将撃破・敗走が同じ 1 本の判定に落ちる）
 * - 起床: 気付いた者の近くだけ起こし、残りは後詰として少し遅れて動く
 * - 増援の代わり: 長居すると眠っている陣を長蛇に変えてプレイヤーの方へ歩かせる（湧かせないので総数は増えない）
 * 乱数は塊に乗らない陣の決着のハートだけ（state.rng）。他は位置と id で決まる
 */

const TEXT_LIFT = 10;
const ROUT_TEXT_SCALE = 1.3;
const ROUT_TEXT_LIFE = 1;
const LEADER_TEXT_SCALE = 1.4;
const LEADER_TEXT_LIFE = 1.2;
const SECOND_WAVE_TEXT_SCALE = 1.2;
const SECOND_WAVE_TEXT_LIFE = 1;
const HOLD_TEXT_SCALE = 1.2;
const HOLD_TEXT_LIFE = 1;
const ALARM_TEXT_SCALE = 1.2;
const ALARM_TEXT_LIFE = 1.2;
/** 行き先の無い敗走で、壁に沿って逃げ続けられるよう横へ逸らす割合（enemyTraits.ts の臆病と同じ考え方） */
const FLEE_SIDE = 0.6;

/** 群勢の強化が掛かる値の種類 */
export type JinBonusKind = "attackInterval" | "poiseTaken";

// -----------------------------------------------------------------------------
// 群勢
// -----------------------------------------------------------------------------

/** メンバー 1 人の重さ（大将は leader、他は格） */
export function memberWeight(jin: Jin, e: Enemy): number {
  if (e.id === jin.leaderId) return JIN.gradeWeight.leader;
  return JIN.gradeWeight[gradeOf(e)];
}

export function jinById(state: GameState, id: number | undefined): Jin | undefined {
  if (id === undefined) return undefined;
  return state.jins.find((j) => j.id === id);
}

/** 陣の生きているメンバー（敗走中の敵は陣から外れているので含まない） */
export function jinMembers(state: GameState, jin: Jin): Enemy[] {
  return state.enemies.filter((e) => e.jinId === jin.id && e.hp > 0);
}

/** 生成の最後に 1 回（system/jinSpawn.ts の spawnJin が呼ぶ）: 群勢をメンバーの重さの合計で満たす */
export function initJinMorale(state: GameState, jin: Jin): void {
  let total = 0;
  for (const e of jinMembers(state, jin)) total += memberWeight(jin, e);
  jin.moraleMax = total;
  jin.morale = total;
}

/**
 * 撃破のたびに 1 回（enemyTraits.ts の onEnemyDeath。消えた敵は呼ばない）。
 * 群勢を減らし、routRatio を切ったら生き残りを敗走させる。敗走中の敵なら討伐として数えるだけ
 */
export function noteJinDeath(state: GameState, e: Enemy): void {
  if (e.rout) {
    routTallyOf(state, e.rout.fromJin).killed++;
    return;
  }
  const jin = jinById(state, e.jinId);
  if (!jin || jin.phase === "settled") return;
  const loss = deathLoss(state, jin, e);
  if (e.id === jin.leaderId) breakLeader(state, jin, e, loss);
  else jin.morale = Math.max(0, jin.morale - loss);
  // 一度崩れた陣（背水で踏みとどまった者だけ）はもう崩れない
  if (!jin.broken && jin.morale <= jin.moraleMax * JIN.morale.routRatio) routJin(state, jin);
}

/** 減る量: 重さ + 処刑 + 同じ tick の 2 体目以降（一網打尽） */
function deathLoss(state: GameState, jin: Jin, e: Enemy): number {
  let loss = memberWeight(jin, e);
  if (e.executed) loss += JIN.morale.executeBonus;
  if (jin.deathsTick === state.tick) {
    jin.deathsInTick++;
    loss += JIN.morale.multiKillBonus;
  } else {
    jin.deathsTick = state.tick;
    jin.deathsInTick = 1;
  }
  return loss;
}

/** 大将の撃破: 群勢を leaderBreakRatio まで落とす（routRatio より低いので必ず敗走になる） */
function breakLeader(state: GameState, jin: Jin, leader: Enemy, loss: number): void {
  jin.morale = Math.max(0, Math.min(jin.morale - loss, jin.moraleMax * JIN.morale.leaderBreakRatio));
  jin.leaderFell = true;
  addFloatingText(state, lifted(leader.body.pos), JIN_TEXT.leaderDown, JIN.rout.leaderColor, LEADER_TEXT_SCALE, LEADER_TEXT_LIFE, "notice");
  // 本陣の旗倒れ: 陣図を畳み、近くの交戦中の素の陣の群勢を落とす（system/jinzu.ts）
  if (jin.honjin) onHonjinLeaderFell(state, jin, leader.body.pos);
}

/**
 * 集まっている間の強化: 群勢が highRatio 以上の交戦中の陣のメンバーは、攻撃間隔が短く・怯みにくくなる。
 * 陣に属さない敵・眠っている陣・崩れかけの陣は 1
 */
export function jinBonusMul(state: GameState, e: Enemy, kind: JinBonusKind): number {
  if (e.jinId === undefined) return 1;
  const jin = jinById(state, e.jinId);
  if (!jin || jin.phase !== "engaged" || jin.moraleMax <= 0) return 1;
  // 背水: 群勢が崩れても踏みとどまった者は攻めが速い（怯みやすさはそのまま）
  if (jin.broken) return kind === "attackInterval" ? JIN.morale.holdAttackIntervalMul : 1;
  if (jin.morale < jin.moraleMax * JIN.morale.highRatio) return 1;
  // 筆を持つ大将は怯みやすさの強化が掛からない（陣図を止められる量をいつもの怯みゲージのままにする）
  if (e.jinzuRun?.mode === "brush") return 1;
  return kind === "attackInterval" ? JIN.morale.highAttackIntervalMul : JIN.morale.highPoiseTakenMul;
}

// -----------------------------------------------------------------------------
// 敗走
// -----------------------------------------------------------------------------

/**
 * 群勢が崩れた: 生き残りが 1 体ずつ逃げるか踏みとどまるかを決める（格ごとの fleeChance。大将を倒して崩れたら逃げやすい）。
 * 逃げる者は陣から外して ROAMING_ROOM にし、最も近い他の陣へ逃がす。全員が逃げれば敗走で決着し、塊に乗った陣は
 * 部屋の生存者が 0 になって同じステップの updateRooms が clearRoom（文字は「敗走」）を出す。
 * 踏みとどまる者がいれば陣は決着せず「背水」になり（broken。もう崩れない）、倒し切れば全滅（制圧）で決着する
 */
export function routJin(state: GameState, jin: Jin): void {
  if (jin.broken || jin.phase === "settled") return;
  // 走りの途中で敗走の線を切れば走りも止める（陣図を畳む。兵が陣から外れる前に）
  foldJinzu(state, jin);
  const members = jinMembers(state, jin);
  if (members.length === 0) return;
  const at = centroid(members);
  // 仇は逃げ切ると消えて仇討ちができなくなるので、敗走せず部屋に残す（部屋は仇を倒すまで制圧されない）。
  // 階の主（ボス陣の大将）も残す: 逃がすと部屋が「敗走」で制圧され、主が倒れないので階段が出ず階が詰む。
  // 乱数は逃げられる者だけが id 順に 1 回ずつ引く（決定的）
  const fleeing = members.filter((e) => canFlee(state, e) && state.rng.chance(fleeChance(jin, e)));
  const holding = members.filter((e) => !fleeing.includes(e));
  const target = fleeing.length > 0 ? nearestRefuge(state, at, jin.id) : null;
  routTallyOf(state, jin.id).fled += fleeing.length;
  for (const e of fleeing) startRout(e, jin, target);
  if (holding.length > 0) {
    jin.broken = true;
    if (fleeing.length > 0) addFloatingText(state, lifted(centroid(fleeing)), JIN_TEXT.rout, JIN.rout.color, ROUT_TEXT_SCALE, ROUT_TEXT_LIFE, "notice");
    addFloatingText(state, lifted(centroid(holding)), JIN_TEXT.hold, JIN.morale.holdColor, HOLD_TEXT_SCALE, HOLD_TEXT_LIFE, "notice");
    return;
  }
  settleJin(state, jin, "rout");
  // 塊に乗った陣の「敗走」は clearRoom が出す（二重に出さない）
  if (jin.roomIndex === ROAMING_ROOM) addFloatingText(state, lifted(at), JIN_TEXT.rout, JIN.rout.color, ROUT_TEXT_SCALE, ROUT_TEXT_LIFE, "notice");
}

/** 逃げてよい者: 仇と階の主は逃がさない */
function canFlee(state: GameState, e: Enemy): boolean {
  return !e.nemesis && e.id !== state.boss?.enemyId;
}

/** 1 体が逃げ出す確率: 格ごとの fleeChance（大将は精鋭と同じ）+ 大将を倒して崩れたなら leaderFleeBonus */
function fleeChance(jin: Jin, e: Enemy): number {
  const grade = e.id === jin.leaderId ? "elite" : gradeOf(e);
  const base = JIN.morale.fleeChance[grade];
  return Math.min(1, base + (jin.leaderFell ? JIN.morale.leaderFleeBonus : 0));
}

function startRout(e: Enemy, from: Jin, target: Refuge | null): void {
  e.rout = {
    fromJin: from.id,
    toJin: target ? target.jin.id : null,
    dest: target ? { ...target.at } : null,
    time: JIN.rout.maxTime,
    recheck: JIN.rout.retargetSec,
    turnCd: JIN.rout.turnFirstDelay,
    dropCd: JIN.rout.mudInterval,
  };
  e.jinId = undefined;
  e.roomIndex = ROAMING_ROOM;
  // 予備動作・攻撃は取り消す（逃げる敵は攻撃しない）。phase は chase のまま殴れる・倒せる
  e.phase = "chase";
  e.phaseTimer = 0;
  if (e.ai) {
    e.ai.roam = undefined;
    e.ai.retreat = 0;
  }
}

/** 逃げ込み先: 陣と、合流する点（陣の id が最小の生きているメンバーの位置） */
interface Refuge {
  jin: Jin;
  at: Vec;
}

/** 敗走した敵を受け入れる陣か: 決着していない・塊に乗っている・封鎖されていない（扉が閉じた部屋へは入れない） */
function canTakeRouters(state: GameState, jin: Jin): boolean {
  if (jin.phase === "settled" || jin.roomIndex === ROAMING_ROOM) return false;
  return state.rooms[jin.roomIndex]?.locked !== true;
}

/** 陣ごとの合流する点（id が最小の生きているメンバー）。メンバーがいない陣は入らない */
function refugeAnchors(state: GameState): Map<number, Enemy> {
  const out = new Map<number, Enemy>();
  for (const e of state.enemies) {
    if (e.jinId === undefined || e.hp <= 0) continue;
    const cur = out.get(e.jinId);
    if (!cur || e.id < cur.id) out.set(e.jinId, e);
  }
  return out;
}

/** from に最も近い受け入れ先（同じ距離なら id が小さい陣）。無ければ null */
function nearestRefuge(state: GameState, from: Vec, excludeId: number): Refuge | null {
  const anchors = refugeAnchors(state);
  let best: Refuge | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (const jin of state.jins) {
    if (jin.id === excludeId || !canTakeRouters(state, jin)) continue;
    const anchor = anchors.get(jin.id);
    if (!anchor) continue;
    const d = dist(from, anchor.body.pos);
    if (d >= bestD) continue;
    best = { jin, at: anchor.body.pos };
    bestD = d;
  }
  return best;
}

/** 行き先の陣の受け入れ先（合流する点を取り直す）。受け入れられなくなっていれば null */
function refugeOf(state: GameState, jinId: number): Refuge | null {
  const jin = jinById(state, jinId);
  if (!jin || !canTakeRouters(state, jin)) return null;
  const anchor = refugeAnchors(state).get(jin.id);
  return anchor ? { jin, at: anchor.body.pos } : null;
}

/**
 * 敗走中の 1 ステップ（enemies.ts の updateEnemies が恐怖の直後に呼び、通常の AI を回さない）。
 * speed は enemySpeed（足の倍率込み）。行き先の陣へ距離場を下り、着いたら合流。行き先が無ければプレイヤーの反対へ逃げ、
 * 時計が尽きてプレイヤーから十分離れていれば消える（逃げ切り）
 */
export function stepRout(state: GameState, e: Enemy, def: EnemyDef, dt: number, speed: number): void {
  const rout = e.rout;
  if (!rout) return;
  rout.time -= dt;
  rout.recheck -= dt;
  rout.turnCd = Math.max(0, rout.turnCd - dt);
  dropMud(state, e, dt);
  if (rout.recheck <= 0) refreshRout(state, e);
  if (rout.toJin !== null && rout.time <= 0) {
    // 合流が間に合わなかった: 行き先を捨てて逃げ切りを狙う
    rout.toJin = null;
    rout.dest = null;
  }
  if (rout.toJin !== null && rout.dest && dist(e.body.pos, rout.dest) <= JIN.rout.mergeDist) {
    mergeInto(state, e, rout.toJin);
    return;
  }
  if (rout.toJin === null && rout.time <= 0 && farFromPlayer(state, e)) {
    routTallyOf(state, rout.fromJin).escaped++;
    vanish(state, e);
    return;
  }
  const dir = routHeading(state, e);
  const step = speed * JIN.rout.speedMul * dt;
  moveEnemy(state, e, def, dir.x * step, dir.y * step);
  if (dir.x !== 0) e.facing = dir;
}

/** 置き土産: mudInterval ごとに足元へ泥を撒く（追う側の足を取る。泥は敵の足も取るが、撒いた者はもう先へ進んでいる） */
function dropMud(state: GameState, e: Enemy, dt: number): void {
  const rout = e.rout;
  if (!rout) return;
  rout.dropCd -= dt;
  if (rout.dropCd > 0) return;
  rout.dropCd = JIN.rout.mudInterval;
  placeTerrain(state, e.body.pos.x, e.body.pos.y, "mud", JIN.rout.mudRadius, JIN.rout.mudSec);
}

/**
 * 窮鼠: 逃げている敵にプレイヤーが turnRadius まで詰めたら、振り向いて反撃してよいか（enemies.ts が予備動作に入れる）。
 * 振り向いたら turnCooldown を入れ直す（markRoutTurn）。反撃の予備動作・攻撃・隙の間は stepRout を回さない
 */
export function routTurnReady(state: GameState, e: Enemy): boolean {
  const rout = e.rout;
  if (!rout || rout.turnCd > 0) return false;
  const p = state.player.body;
  return dist(e.body.pos, p.pos) <= e.body.radius + p.radius + JIN.rout.turnRadius;
}

export function markRoutTurn(e: Enemy): void {
  if (e.rout) e.rout.turnCd = JIN.rout.turnCooldown;
}

/** retargetSec ごと: 行き先の陣がまだ受け入れるなら合流する点を取り直し、だめなら最も近い別の陣へ（時計が残っている間） */
function refreshRout(state: GameState, e: Enemy): void {
  const rout = e.rout;
  if (!rout) return;
  rout.recheck = JIN.rout.retargetSec;
  if (rout.time <= 0) return;
  const refuge = (rout.toJin !== null ? refugeOf(state, rout.toJin) : null) ?? nearestRefuge(state, e.body.pos, rout.fromJin);
  rout.toJin = refuge ? refuge.jin.id : null;
  rout.dest = refuge ? { ...refuge.at } : null;
}

/** 逃げる向き: 行き先があれば距離場の次の点へ。行けない・行き先が無ければプレイヤーの反対（少し横へ逸らす） */
function routHeading(state: GameState, e: Enemy): Vec {
  const dest = e.rout?.dest;
  const next = dest ? nextWaypoint(state.map, e.body.pos, dest) : null;
  if (next) return normalize(sub(next, e.body.pos));
  const away = normalize(sub(e.body.pos, state.player.body.pos), { x: 1, y: 0 });
  const side = e.id % 2 === 0 ? 1 : -1;
  return normalize(add(away, scale({ x: -away.y, y: away.x }, side * FLEE_SIDE)));
}

/** 合流: 行き先の陣のメンバーに戻り、その陣の群勢を足す（上限 moraleMax × mergeCapRatio） */
function mergeInto(state: GameState, e: Enemy, jinId: number): void {
  const rout = e.rout;
  const jin = jinById(state, jinId);
  if (!rout || !jin || !canTakeRouters(state, jin)) {
    if (rout) rout.recheck = 0;
    return;
  }
  routTallyOf(state, rout.fromJin).merged++;
  e.rout = undefined;
  e.jinId = jin.id;
  e.roomIndex = jin.roomIndex;
  // 眠っている陣に混ざれば一緒に眠り、交戦中の陣ならそのまま加わる
  e.phase = jin.phase === "engaged" ? "chase" : "idle";
  jin.morale = Math.min(jin.morale + memberWeight(jin, e), jin.moraleMax * JIN.morale.mergeCapRatio);
  if (jin.phase === "sleeping") alarmJin(state, jin, e.body.pos);
}

/**
 * 急報: 逃げた敵が眠っている陣に合流すると、その陣はプレイヤーの今いる点へ歩き出す（歩きは spawner.ts の updateRoamers。
 * 気付けば部屋ごと起きる）。逃がした損。本陣は山として動かない。長居の歩き出し（stirSleepingJin）の数には数えない
 */
function alarmJin(state: GameState, jin: Jin, at: Vec): void {
  if (jin.alarmed || jin.honjin) return;
  jin.alarmed = true;
  const goal = { ...state.player.body.pos };
  for (const m of jinMembers(state, jin)) {
    if (!m.ai || m.phase !== "idle") continue;
    m.ai.roam = { ...goal };
    m.ai.roamStuck = 0;
  }
  addFloatingText(state, lifted(at), JIN_TEXT.alarm, JIN.rout.alarmColor, ALARM_TEXT_SCALE, ALARM_TEXT_LIFE, "notice");
}

/** 陣の敗走の内訳（無ければ作る）。陣が見つからなければ捨てる入れ物 */
function routTallyOf(state: GameState, jinId: number): JinRoutTally {
  const jin = jinById(state, jinId);
  const blank: JinRoutTally = { fled: 0, merged: 0, killed: 0, escaped: 0 };
  if (!jin) return blank;
  jin.routTally ??= blank;
  return jin.routTally;
}

/** 部屋の制圧の浮き文字: その塊の陣が敗走で決着していれば「敗走」、他は「制圧」（floor.ts の clearRoom） */
export function roomClearText(state: GameState, roomIndex: number): string {
  const routed = state.jins.some((j) => j.roomIndex === roomIndex && j.settledBy === "rout");
  return routed ? JIN_TEXT.rout : JIN_TEXT.wipe;
}

// -----------------------------------------------------------------------------
// 起床（後詰）
// -----------------------------------------------------------------------------

/**
 * 陣を起こす: 気付いた者（いなければプレイヤーに最も近いメンバー）から wake.radius 以内だけ起こし、
 * 残りは secondWaveDelay 秒後に後詰として updateJins が起こす。封鎖した部屋の陣は全員起こす
 */
export function wakeJin(state: GameState, jin: Jin): void {
  if (jin.phase === "settled") return;
  jin.phase = "engaged";
  jin.engagedAt ??= state.time;
  onJinEngaged(state, jin);
  const members = jinMembers(state, jin);
  if (state.rooms[jin.roomIndex]?.locked === true) {
    for (const e of members) if (e.phase === "idle") e.phase = "chase";
    jin.secondWaveAt = null;
    return;
  }
  const seeds = wakeSeeds(state, members);
  let left = 0;
  for (const e of members) {
    if (e.phase !== "idle") continue;
    if (seeds.some((s) => dist(s, e.body.pos) <= JIN.wake.radius)) e.phase = "chase";
    else left++;
  }
  if (left > 0 && jin.secondWaveAt === null) jin.secondWaveAt = state.floorTime + JIN.wake.secondWaveDelay;
}

/** 起こす輪の中心: 既に気付いたメンバー。誰も気付いていなければプレイヤーに最も近いメンバー（同じ距離なら id が小さい方） */
function wakeSeeds(state: GameState, members: readonly Enemy[]): Vec[] {
  const awake = members.filter((e) => e.phase !== "idle" && e.phase !== "spawning").map((e) => e.body.pos);
  if (awake.length > 0) return awake;
  const p = state.player.body.pos;
  let best: Enemy | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (const e of members) {
    const d = dist(e.body.pos, p);
    if (d < bestD || (d === bestD && best !== null && e.id < best.id)) {
      best = e;
      bestD = d;
    }
  }
  return best ? [best.body.pos] : [];
}

/** 後詰: 残りの眠っているメンバーを全員起こす */
function callSecondWave(state: GameState, jin: Jin): void {
  jin.secondWaveAt = null;
  const woken = jinMembers(state, jin).filter((e) => e.phase === "idle");
  if (woken.length === 0) return;
  for (const e of woken) e.phase = "chase";
  addFloatingText(state, lifted(centroid(woken)), JIN_TEXT.secondWave, JIN.wake.color, SECOND_WAVE_TEXT_SCALE, SECOND_WAVE_TEXT_LIFE, "notice");
}

// -----------------------------------------------------------------------------
// 毎ステップ
// -----------------------------------------------------------------------------

/**
 * 毎ステップ（floor.ts の updateRooms から jinSpawn.ts の updateJinPhases 経由）:
 * 生き残りの無い陣を全滅で決着、長蛇の誰かが気付いたら列ごと起こす、後詰の時刻が来たら残りを起こす、長居なら陣を歩かせる。
 * 塊の陣は floor.ts の engageRoom が塊ごと起こす（部屋のフックを 1 回通すため）ので、ここでは起こさない
 */
export function updateJins(state: GameState): void {
  if (state.jins.length === 0) return;
  const alive = new Set<number>();
  const awake = new Set<number>();
  for (const e of state.enemies) {
    if (e.jinId === undefined || e.hp <= 0) continue;
    alive.add(e.jinId);
    if (e.phase !== "idle" && e.phase !== "spawning") awake.add(e.jinId);
  }
  for (const jin of state.jins) {
    if (jin.phase === "settled") continue;
    if (!alive.has(jin.id)) {
      settleJin(state, jin, "wipe");
      continue;
    }
    if (jin.phase === "sleeping" && jin.roomIndex === ROAMING_ROOM && awake.has(jin.id)) wakeJin(state, jin);
    if (jin.secondWaveAt !== null && state.floorTime >= jin.secondWaveAt) callSecondWave(state, jin);
  }
  stirSleepingJin(state);
}

/**
 * 決着。塊に乗らない陣（長蛇・物見）は部屋の制圧の報酬が無いので、交戦した陣なら小さな確率でハートを落とす
 * （眠ったまま居なくなった陣は戦っていないので報酬も乱数も無し）
 */
function settleJin(state: GameState, jin: Jin, by: "wipe" | "rout"): void {
  const fought = jin.phase === "engaged";
  jin.phase = "settled";
  jin.settledBy = by;
  jin.secondWaveAt = null;
  if (fought) onJinSettled(state, jin);
  if (fought) onBetJinSettled(state, jin);
  if (jin.roomIndex !== ROAMING_ROOM || !fought) return;
  if (state.rng.chance(JIN.roamHeartChance)) roomHooks.dropHeart(state, { ...state.player.body.pos });
}

// -----------------------------------------------------------------------------
// 増援の代わり（長居すると眠っている陣が歩き出す）
// -----------------------------------------------------------------------------

/** 今の floorTime までに歩き出させておく陣の数（stir.delay を過ぎたら 1、以後 stir.interval ごとに 1 つ増える） */
export function stirsDue(floorTime: number): number {
  if (floorTime <= JIN.stir.delay) return 0;
  return Math.floor((floorTime - JIN.stir.delay) / JIN.stir.interval) + 1;
}

/**
 * 歩き出させた数が stirsDue に届いていなければ、プレイヤーに最も近い眠っている塊の陣を長蛇に変え、
 * プレイヤーの今いる点へ歩かせる（歩きは spawner.ts の updateRoamers）。
 * メンバーの roomIndex は塊のまま（気付けば engageRoom が部屋ごと起こし、倒し切れば制圧の報酬が出る）。歩かせたら true
 */
export function stirSleepingJin(state: GameState): boolean {
  const due = stirsDue(state.floorTime);
  if (due === 0) return false;
  const done = state.jins.reduce((n, j) => n + (j.stirred ? 1 : 0), 0);
  if (done >= due) return false;
  const jin = nearestStirrable(state);
  if (!jin) return false;
  jin.stirred = true;
  jin.formation = "column";
  const goal = { ...state.player.body.pos };
  for (const e of jinMembers(state, jin)) {
    if (!e.ai || e.phase !== "idle") continue;
    e.ai.roam = { ...goal };
    e.ai.roamStuck = 0;
  }
  return true;
}

/** 歩かせてよい陣: 眠っている・まだ歩かせていない・塊に乗り、その塊が交戦も制圧も封鎖もしていない */
function stirrable(state: GameState, jin: Jin): boolean {
  // 本陣は山として動かない（歩き出して長蛇にならない）
  if (jin.phase !== "sleeping" || jin.stirred || jin.alarmed || jin.honjin || jin.roomIndex === ROAMING_ROOM) return false;
  const room = state.rooms[jin.roomIndex];
  return room !== undefined && !room.engaged && !room.cleared && !room.locked;
}

/** プレイヤーに最も近い歩かせてよい陣（中心で比べる。同じ距離なら先に置かれた陣） */
function nearestStirrable(state: GameState): Jin | null {
  const p = state.player.body.pos;
  const alive = new Set<number>();
  for (const e of state.enemies) if (e.jinId !== undefined && e.hp > 0) alive.add(e.jinId);
  let best: Jin | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (const jin of state.jins) {
    if (!alive.has(jin.id) || !stirrable(state, jin)) continue;
    const d = dist(jin.center, p);
    if (d >= bestD) continue;
    best = jin;
    bestD = d;
  }
  return best;
}

// -----------------------------------------------------------------------------
// 小物
// -----------------------------------------------------------------------------

function centroid(list: readonly Enemy[]): Vec {
  if (list.length === 0) return { x: 0, y: 0 };
  let x = 0;
  let y = 0;
  for (const e of list) {
    x += e.body.pos.x;
    y += e.body.pos.y;
  }
  return { x: x / list.length, y: y / list.length };
}

function lifted(p: Vec): Vec {
  return { x: p.x, y: p.y - TEXT_LIFT };
}
