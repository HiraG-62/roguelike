import { type Enemy, type GameState, type Jin, type JinzuState, type JinzuStroke, ROAMING_ROOM, pushSfx } from "../core/state";
import { type Vec, dist } from "../core/vec";
import { formationDef } from "../data/formations";
import { gradeOf } from "../data/enemyRoles";
import { enemyDef } from "../data/enemies";
import { ENEMY_TEMPO, HONJIN, JIN, JINZU, PLAYER } from "../data/tuning";
import { lineOfSight } from "../map/pathing";
import { type StrokeSpec, safeSpotExists, strokeFrame, strokePoints, squadSide } from "../map/jinzuShape";
import { chapterOf, isChapterBossDepth, isChapterRest, isFinalDepth } from "./chapters";
import { initJinMorale, jinMembers, routJin } from "./jin";
import { makeStrong } from "./jinSpawn";
import { pickHonjinLeader, squadCentroid, squadPoolOf, takeSquad } from "./jinzuSquads";
import { isStaggered } from "./poise";
import { chillFactor, isFeared, isHalted } from "./statusEffects";

/**
 * 本陣と陣図（docs/ideas/jinzu-impl.md）。階に数個だけ立つ「本陣」の大将が、床に突撃の道筋（陣図）を 1 画ずつ書き、
 * 墨の入った画の隊だけが総掛かりで走る。書き終える前に大将を怯ませれば筆が折れ、まだ書かれていない画の隊は来ない。
 * 大将を討つと旗が倒れ、近くの交戦中の素の陣の群勢が落ちる（onHonjinLeaderFell）。
 * 乱数は 1 つも引かない: 本陣の選び方・大将の格上げ・隊の割り振り・画の形・筆順・走りはすべて、陣形の data・陣の向き・
 * メンバーの位置と id・掲げた瞬間のプレイヤーの位置で決まる（同じ seed で本陣あり / なしの盤が同じになる）
 * 段（待ち → 掲げ → 筆 → 構え → 総掛かり → 立て直し）の遷移は updateJinzu（updateEnemies の最後）が毎ステップ見張る。
 * 割り込み（statusEffects の怯み・恐怖）は状態の見張りで取る（statusEffects から呼ばない = 循環 import を作らない）
 */

/** 隊が足りず書けなかったとき、次に調べるまでの秒（毎ステップ計画し直さない） */
const PLAN_RETRY_SEC = 0.5;
/** 本陣の試し陣が置く塊の下限（最初の戦いの塊 1 より奥） */
const TRIAL_MIN_ROOM = 2;
/** 開始の塊と最初の戦いの塊（floor.ts の START_ROOM / FIRST_FIGHT_ROOM）。ここの陣は本陣にしない */
const NON_HONJIN_ROOMS: ReadonlySet<number> = new Set([0, 1]);

// -----------------------------------------------------------------------------
// 本陣の選び方（階の生成の最後。乱数なし）
// -----------------------------------------------------------------------------

/** その深度の 1 階あたりの本陣の数。休符の階・ボス階・最深の間は 0。深度の指定が章の値より優先 */
export function honjinCount(depth: number): number {
  if (isChapterBossDepth(depth) || isChapterRest(depth) || isFinalDepth(depth)) return 0;
  const byDepth: Readonly<Record<string, number>> = HONJIN.countByDepth;
  const exact = byDepth[String(depth)];
  const table = HONJIN.countByChapter;
  const raw = exact ?? table[chapterOf(depth) - 1] ?? table[table.length - 1] ?? 0;
  return Math.min(HONJIN.max, raw);
}

/** その深度で本陣になれる陣形の key */
function honjinFormations(depth: number): readonly string[] {
  const table = HONJIN.formationsByChapter;
  return table[chapterOf(depth) - 1] ?? table[table.length - 1] ?? [];
}

/** 試し陣の塊（HONJIN.trial.depth の階で、最初の戦いの塊のすぐ奥の塊）。jinSpawn.ts の planJins がこの塊を鶴翼にする */
export function isTrialDepth(depth: number): boolean {
  return HONJIN.trial.depth !== 0 && HONJIN.trial.depth === depth;
}

/** 試し陣にする塊（候補の塊のうち TRIAL_MIN_ROOM 以上で最も手前）。無ければ undefined */
export function trialRoomOf(rooms: readonly number[]): number | undefined {
  return rooms.find((i) => i >= TRIAL_MIN_ROOM);
}

function trialJin(state: GameState): Jin | undefined {
  if (!isTrialDepth(state.depth)) return undefined;
  return state.jins
    .filter((j) => j.roomIndex >= TRIAL_MIN_ROOM && j.formation === "craneWing" && j.leaderId === null)
    .sort((a, b) => a.roomIndex - b.roomIndex)[0];
}

/** 本陣になれる陣か: 塊に乗り・まだ大将がいず・その章で開いた陣形で陣図を持ち・開始と最初の戦いの塊でなく・奥寄り・格上げできる 1 人がいる */
function honjinCandidate(state: GameState, jin: Jin): boolean {
  if (jin.roomIndex === ROAMING_ROOM || jin.leaderId !== null || jin.honjin === true) return false;
  if (NON_HONJIN_ROOMS.has(jin.roomIndex) || !honjinFormations(state.depth).includes(jin.formation)) return false;
  const jinzu = formationDef(jin.formation)?.jinzu;
  if (!jinzu) return false;
  const order = state.rooms.length > 1 ? jin.roomIndex / (state.rooms.length - 1) : 0;
  return order >= HONJIN.minRoomOrder && pickHonjinLeader(state, jin, jinzu.leaderSeat) !== null;
}

/** 陣の人数（点数。多いほど山） */
function memberCount(state: GameState, jin: Jin): number {
  return jinMembers(state, jin).length;
}

/**
 * 階の生成の最後（planJins の後）に呼ぶ。数は honjinCount、候補は人数の多い順（同数は奥の塊）で、
 * すでに選んだ本陣から minSpacing 未満のものは飛ばす。試し陣（HONJIN.trial）はその数の先頭に 1 つ入る
 */
export function planHonjin(state: GameState): void {
  const trial = trialJin(state);
  const want = Math.min(HONJIN.max, Math.max(honjinCount(state.depth), trial ? 1 : 0));
  if (want <= 0) return;
  const chosen: Jin[] = [];
  if (trial && makeHonjin(state, trial)) chosen.push(trial);
  const ranked = state.jins
    .filter((j) => !chosen.includes(j) && honjinCandidate(state, j))
    .sort((a, b) => memberCount(state, b) - memberCount(state, a) || b.roomIndex - a.roomIndex);
  for (const jin of ranked) {
    if (chosen.length >= want) break;
    if (chosen.some((c) => dist(c.center, jin.center) < HONJIN.minSpacing)) continue;
    if (makeHonjin(state, jin)) chosen.push(jin);
  }
}

/** 大将を格上げして本陣にする。座に最も近い 1 人を大将にし、並なら猛にする（精鋭の修飾子は付けない）。群勢は数え直す。できなければ false */
export function makeHonjin(state: GameState, jin: Jin): boolean {
  const seat = formationDef(jin.formation)?.jinzu?.leaderSeat;
  if (!seat) return false;
  const leader = pickHonjinLeader(state, jin, seat);
  if (!leader) return false;
  if (gradeOf(leader) === "normal") makeStrong(leader);
  jin.leaderId = leader.id;
  jin.honjin = true;
  jin.jinzu = newJinzu();
  initJinMorale(state, jin);
  return true;
}

function newJinzu(): JinzuState {
  return { phase: "ready", t: 0, strokeSec: JINZU.strokeSec, target: { x: 0, y: 0 }, origin: { x: 0, y: 0 }, strokes: [], surges: 0, readyAt: 0 };
}

// -----------------------------------------------------------------------------
// 毎ステップ
// -----------------------------------------------------------------------------

/** 本陣の大将（生きていれば） */
function honjinLeader(state: GameState, jin: Jin): Enemy | undefined {
  if (jin.leaderId === null) return undefined;
  return state.enemies.find((e) => e.id === jin.leaderId && e.hp > 0);
}

/** 毎ステップ（updateEnemies の最後）: 本陣の陣図の段を進める。本陣が無い階では何もしない */
export function updateJinzu(state: GameState, dt: number): void {
  for (const jin of state.jins) {
    if (jin.jinzu) stepJin(state, jin, jin.jinzu, dt);
  }
}

function stepJin(state: GameState, jin: Jin, jz: JinzuState, dt: number): void {
  if (jz.phase === "spent") return;
  const leader = honjinLeader(state, jin);
  if (jin.phase === "settled" || !leader) {
    foldJinzu(state, jin);
    return;
  }
  switch (jz.phase) {
    case "ready":
      tryRaise(state, jin, jz, leader);
      return;
    case "raise":
    case "brush":
      stepWriting(state, jin, jz, leader, dt);
      return;
    case "hold":
      stepHold(state, jin, jz, dt);
      return;
    case "charge":
      stepCharge(state, jin, jz, leader, dt);
      return;
    case "regroup":
      stepRegroup(state, jz, leader, dt);
      return;
  }
}

// -----------------------------------------------------------------------------
// 待ち → 掲げ（発生条件 R4）
// -----------------------------------------------------------------------------

/** 掲げ〜総掛かりの段にいるか */
function surging(jz: JinzuState): boolean {
  return jz.phase === "raise" || jz.phase === "brush" || jz.phase === "hold" || jz.phase === "charge";
}

function otherSurging(state: GameState, jin: Jin): boolean {
  return state.jins.some((j) => j !== jin && j.jinzu !== undefined && surging(j.jinzu));
}

/** 大将が今の攻撃を終えていて、止められていない（chase のまま。怯み・恐怖・凍結・麻痺でない） */
function leaderFree(leader: Enemy): boolean {
  return leader.phase === "chase" && !leader.jinzuRun && !leader.rout && !isHalted(leader) && !isFeared(leader);
}

function tryRaise(state: GameState, jin: Jin, jz: JinzuState, leader: Enemy): void {
  if (jin.phase !== "engaged" || !leaderFree(leader) || state.time < jz.readyAt) return;
  if (jz.surges >= JINZU.maxSurges) {
    jz.phase = "spent";
    return;
  }
  if (jin.moraleMax <= 0 || jin.morale < jin.moraleMax * JINZU.minMoraleRatio) return;
  if (state.time - (jin.engagedAt ?? state.time) < JINZU.firstDelay) return;
  const player = state.player.body.pos;
  if (dist(leader.body.pos, player) > JINZU.triggerRange || !lineOfSight(state.map, leader.body.pos, player)) return;
  if (otherSurging(state, jin) || state.rooms.some((r) => r.locked)) return;
  const planned = planStrokes(state, jin, leader, { ...player });
  if (planned.length < JINZU.minStrokes) {
    jz.readyAt = state.time + PLAN_RETRY_SEC;
    return;
  }
  beginRaise(state, jin, jz, leader, planned);
}

/** 計画した画 1 本（隊の id と点列） */
interface PlannedStroke {
  kind: JinzuStroke["kind"];
  points: Vec[];
  squad: number[];
}

/**
 * 掲げの瞬間に、全部の画の隊と形を決める（以後入れ替えない）。大将の座標系で、陣形の筆順どおりに隊を取り、
 * 隊が足りない画・壁で潰れた画は飛ばす。最後に「安全地帯が 1 つはある」まで後ろの画を削る
 */
export function planStrokes(state: GameState, jin: Jin, leader: Enemy, target: Vec): PlannedStroke[] {
  const def = formationDef(jin.formation)?.jinzu;
  if (!def) return [];
  const frame = strokeFrame(leader.body.pos, target, jin.facing);
  const pool = squadPoolOf(state, jin, leader, frame);
  const out: PlannedStroke[] = [];
  for (const sd of def.strokes) {
    if (out.length >= JINZU.maxStrokes) break;
    const squad = takeSquad(pool, sd.squad);
    if (squad.length < (sd.path === "volley" ? 1 : JINZU.squadMin)) continue;
    const spec: StrokeSpec = { kind: sd.path, side: squadSide(sd.squad), pass: sd.pass, beyond: sd.beyond };
    const points = strokePoints(spec, squadCentroid(squad), frame, state.map);
    if (points.length > 0) out.push({ kind: sd.path, points, squad: squad.map((e) => e.id) });
  }
  return fitSafeSpot(out, target, def.strokeSec ?? JINZU.strokeSec);
}

/** 安全地帯（どの画の帯にも入らない点）が、構え + 最後の画の秒の間に歩いて届く所に無ければ、後ろの画を削る */
function fitSafeSpot(strokes: PlannedStroke[], target: Vec, strokeSec: number): PlannedStroke[] {
  const reach = PLAYER.speed * (JINZU.holdSec + strokeSec);
  const out = [...strokes];
  while (out.length >= JINZU.minStrokes && !safeSpotExists(out.map((s) => s.points), target, reach, JINZU.bandHalf)) out.pop();
  return out.length >= JINZU.minStrokes ? out : [];
}

function beginRaise(state: GameState, jin: Jin, jz: JinzuState, leader: Enemy, planned: PlannedStroke[]): void {
  const strokeSec = formationDef(jin.formation)?.jinzu?.strokeSec ?? JINZU.strokeSec;
  jz.phase = "raise";
  jz.t = 0;
  jz.strokeSec = strokeSec;
  jz.target = { ...state.player.body.pos };
  jz.origin = { ...leader.body.pos };
  jz.surges += 1;
  jz.chargedAt = undefined;
  jz.strokes = planned.map((p) => ({
    kind: p.kind,
    points: p.points,
    squad: p.squad,
    state: "pending",
    appearAt: 0,
    progress: 0,
    hit: false,
    jammed: false,
    finished: [],
  }));
  leader.jinzuRun = standRun(jin, -1, "brush");
  jz.strokes.forEach((s, i) => {
    for (const e of squadOf(state, s)) e.jinzuRun = standRun(jin, i, "stand");
  });
  pushSfx(state, "jinzuRaise");
}

function standRun(jin: Jin, stroke: number, mode: "brush" | "stand"): NonNullable<Enemy["jinzuRun"]> {
  return { jin: jin.id, mode, stroke, next: 1, delay: 0, time: 0, stuck: 0 };
}

/** 画の隊の生きている敵 */
function squadOf(state: GameState, stroke: JinzuStroke): Enemy[] {
  const out: Enemy[] = [];
  for (const id of stroke.squad) {
    const e = state.enemies.find((o) => o.id === id && o.hp > 0);
    if (e) out.push(e);
  }
  return out;
}

// -----------------------------------------------------------------------------
// 掲げ・筆（R3-a 筆折れ / R3-b 筆の一時停止）
// -----------------------------------------------------------------------------

function stepWriting(state: GameState, jin: Jin, jz: JinzuState, leader: Enemy, dt: number): void {
  if (isStaggered(leader) || isFeared(leader)) {
    breakBrush(state, jin, jz, leader);
    return;
  }
  // 凍結・麻痺の間は筆が止まり、解けたら続きから書く。冷気の遅さは予備動作と同じく筆を遅くする
  if (isHalted(leader)) return;
  jz.t += dt * chillFactor(leader);
  if (jz.phase === "raise") {
    if (jz.t < JINZU.raiseSec) return;
    jz.t -= JINZU.raiseSec;
    jz.phase = "brush";
  }
  advanceBrush(state, jin, jz, leader);
}

/** 筆を進める: 今の画が strokeSec 経てば墨を入れ、次の画を出す。全部に墨が入れば構えへ */
function advanceBrush(state: GameState, jin: Jin, jz: JinzuState, leader: Enemy): void {
  const guard = jz.strokes.length * 2 + 2;
  for (let n = 0; n < guard; n++) {
    const current = jz.strokes.find((s) => s.state === "sketch");
    if (!current) {
      if (!showNext(state, jz)) {
        enterHold(jz, leader);
        return;
      }
      continue;
    }
    if (jz.t - current.appearAt < jz.strokeSec) return;
    inkStroke(state, jin, current);
  }
}

/** 次の画を出す（出た瞬間に全長の下絵）。もう無ければ false */
function showNext(state: GameState, jz: JinzuState): boolean {
  const next = jz.strokes.find((s) => s.state === "pending");
  if (!next) return false;
  const prev = [...jz.strokes].reverse().find((s) => s.state !== "pending");
  next.state = "sketch";
  next.appearAt = prev ? prev.appearAt + jz.strokeSec : 0;
  pushSfx(state, "jinzuStroke");
  return true;
}

/** 下絵に墨を入れる。墨入れの時点で隊が 0 人なら画ごと消える */
function inkStroke(state: GameState, jin: Jin, stroke: JinzuStroke): void {
  const alive = squadOf(state, stroke).filter((e) => e.jinzuRun?.jin === jin.id);
  if (alive.length === 0) {
    stroke.state = "erased";
    stroke.endedAt = state.time;
    return;
  }
  stroke.state = "ink";
  stroke.inkedAt = state.time;
  pushSfx(state, "jinzuInk");
}

/** 筆折れ: 下絵の画（今の画とまだ出ていない画）を消し、その隊を解く。墨の入った画が 1 本以上あれば構えへ、無ければ立て直しへ */
function breakBrush(state: GameState, jin: Jin, jz: JinzuState, leader: Enemy): void {
  for (const s of jz.strokes) {
    if (s.state !== "sketch" && s.state !== "pending") continue;
    s.state = "erased";
    s.endedAt = state.time;
    releaseSquad(state, jin, s);
  }
  pushSfx(state, "jinzuBreak");
  if (loseMorale(state, jin, JINZU.breakMoraleLoss)) return;
  if (jz.strokes.some((s) => s.state === "ink")) enterHold(jz, leader);
  else enterRegroup(state, jz, leader);
}

/** 画の隊を解く（持ち場の止まりを外す）。走っている兵は止めない（呼ぶのは走る前だけ） */
function releaseSquad(state: GameState, jin: Jin, stroke: JinzuStroke): void {
  for (const e of squadOf(state, stroke)) {
    if (e.jinzuRun?.jin === jin.id && e.jinzuRun.mode === "stand") e.jinzuRun = undefined;
  }
}

/** 群勢を最大の割合だけ減らす。敗走の線を切れば陣を敗走させて true（陣図は routJin が畳む） */
function loseMorale(state: GameState, jin: Jin, ratio: number): boolean {
  jin.morale = Math.max(0, jin.morale - jin.moraleMax * ratio);
  if (jin.morale > jin.moraleMax * JIN.morale.routRatio) return false;
  routJin(state, jin);
  return true;
}

// -----------------------------------------------------------------------------
// 構え → 総掛かり
// -----------------------------------------------------------------------------

function enterHold(jz: JinzuState, leader: Enemy): void {
  jz.phase = "hold";
  jz.t = 0;
  // 構えの間も大将は軍配を掲げたまま動かない。筆は終わったので怯みやすさの倍率は外す（brush → stand）
  if (leader.jinzuRun) leader.jinzuRun.mode = "stand";
}

/** 構えは大将の状態に関わらず進む（墨の入った画は必ず来る） */
function stepHold(state: GameState, jin: Jin, jz: JinzuState, dt: number): void {
  jz.t += dt;
  if (jz.t < JINZU.holdSec) return;
  beginCharge(state, jin, jz);
}

/** 総掛かり: 墨の入った画の隊を走らせる。走れない兵（構えの間に怯んだ・倒れた）は外し、残りの先頭が隊頭になる */
function beginCharge(state: GameState, jin: Jin, jz: JinzuState): void {
  jz.phase = "charge";
  jz.t = 0;
  jz.chargedAt = state.time;
  jz.strokes.forEach((s, i) => {
    if (s.state !== "ink") return;
    const able = squadOf(state, s).filter((e) => e.jinzuRun?.jin === jin.id && !isStaggered(e) && !isFeared(e));
    s.squad = able.map((e) => e.id);
    able.forEach((e, rank) => {
      e.jinzuRun = { jin: jin.id, mode: "run", stroke: i, next: 1, delay: rank * JINZU.runnerGapSec, time: 0, stuck: 0 };
    });
  });
  pushSfx(state, "jinzuCharge");
}

/** 走っている最中の 1 ステップ: 画ごとに隊頭の詰まり・止まった兵・走り終えを見る */
function stepCharge(state: GameState, jin: Jin, jz: JinzuState, leader: Enemy, dt: number): void {
  jz.t += dt;
  for (const s of jz.strokes) {
    if (s.state !== "ink") continue;
    if (resolveStroke(state, jin, s)) return;
  }
  if (!jz.strokes.some((s) => s.state === "ink")) enterRegroup(state, jz, leader);
}

/** 走っている兵（この画の run のまま生きている）。怯み・恐怖で止まった兵は走りを外してここに数えない */
function runnersOf(state: GameState, jin: Jin, stroke: JinzuStroke, index: number): Enemy[] {
  const out: Enemy[] = [];
  for (const e of squadOf(state, stroke)) {
    const run = e.jinzuRun;
    if (!run || run.jin !== jin.id || run.stroke !== index || run.mode !== "run") continue;
    if (isStaggered(e) || isFeared(e) || e.rout) {
      e.jinzuRun = undefined;
      continue;
    }
    out.push(e);
  }
  return out;
}

/**
 * 画 1 本の経過。隊頭が怯む・倒れる（走り終えていない）と隊は先頭で詰まる（R3-c）。全員が走り終えたら画は終わり、
 * 誰にも当たらずに走り終えた隊は群勢が減る。陣を敗走させたら true
 */
function resolveStroke(state: GameState, jin: Jin, stroke: JinzuStroke): boolean {
  const index = jinzuStrokes(jin).indexOf(stroke);
  const headId = stroke.squad[0];
  const head = headId === undefined ? undefined : state.enemies.find((e) => e.id === headId && e.hp > 0);
  const headDown = headId !== undefined && !stroke.finished.includes(headId) && (!head || isStaggered(head) || isFeared(head) || head.rout !== undefined);
  if (headDown && stroke.kind !== "volley") {
    stroke.jammed = true;
    for (const e of runnersOf(state, jin, stroke, index)) stopRunner(e);
    return endStroke(state, jin, stroke);
  }
  if (runnersOf(state, jin, stroke, index).length > 0) return false;
  return endStroke(state, jin, stroke);
}

function jinzuStrokes(jin: Jin): readonly JinzuStroke[] {
  return jin.jinzu?.strokes ?? [];
}

/** 詰まった隊の兵を止める: 走りを外し、攻撃中なら通常（chase）へ戻す */
function stopRunner(e: Enemy): void {
  e.jinzuRun = undefined;
  if (e.phase !== "strike") return;
  e.phase = "chase";
  e.attackCooldown = enemyDef(e.defKey).attackInterval;
}

function endStroke(state: GameState, jin: Jin, stroke: JinzuStroke): boolean {
  stroke.state = "done";
  stroke.endedAt = state.time;
  stroke.progress = 1;
  const missed = stroke.kind !== "volley" && !stroke.hit && !stroke.jammed && stroke.finished.length > 0;
  return missed ? loseMorale(state, jin, JINZU.missMoraleLoss) : false;
}

// -----------------------------------------------------------------------------
// 立て直し
// -----------------------------------------------------------------------------

function enterRegroup(state: GameState, jz: JinzuState, leader: Enemy): void {
  jz.phase = "regroup";
  jz.t = 0;
  jz.readyAt = state.time + JINZU.regroupSec + JINZU.surgeCooldown;
  leader.jinzuRun = undefined;
}

function stepRegroup(_state: GameState, jz: JinzuState, leader: Enemy, dt: number): void {
  jz.t += dt;
  if (jz.t < JINZU.regroupSec) return;
  leader.jinzuRun = undefined;
  jz.phase = jz.surges >= JINZU.maxSurges ? "spent" : "ready";
}

// -----------------------------------------------------------------------------
// 畳む（敗走・決着・大将の撃破）と旗倒れ
// -----------------------------------------------------------------------------

/**
 * 陣図を畳む: 全部の画を消し、この本陣に動かされていた兵（敗走で陣から外れた兵も）を元に戻す。
 * 走っていた兵は通常（chase）へ。routJin・大将の撃破・決着の見張りから呼ぶ（何度呼んでもよい）
 */
export function foldJinzu(state: GameState, jin: Jin): void {
  const jz = jin.jinzu;
  if (!jz) return;
  for (const e of state.enemies) {
    if (e.jinzuRun?.jin !== jin.id) continue;
    const running = e.jinzuRun.mode === "run" && e.phase === "strike";
    e.jinzuRun = undefined;
    if (!running) continue;
    e.phase = "chase";
    e.attackCooldown = enemyDef(e.defKey).attackInterval;
  }
  jz.strokes = [];
  jz.phase = "spent";
}

/**
 * 本陣の大将の撃破（jin.ts の breakLeader から）。陣図を畳み、馬印が倒れた印を残し、
 * 近くで交戦中の素の陣（眠っている陣・他の本陣は除く）の群勢を落とす。敗走の線を切った陣はその場で背を向ける
 */
export function onHonjinLeaderFell(state: GameState, jin: Jin, at: Vec): void {
  foldJinzu(state, jin);
  jin.flagFall = { pos: { ...at }, at: state.time };
  pushSfx(state, "flagFall");
  for (const other of state.jins) {
    if (other === jin || other.honjin === true || other.phase !== "engaged" || other.moraleMax <= 0) continue;
    const members = jinMembers(state, other);
    const center = centerOf(members);
    if (!center || dist(center, at) > JINZU.flagFall.radius) continue;
    other.morale = Math.max(0, other.morale - other.moraleMax * JINZU.flagFall.moraleLoss);
    if (other.morale <= other.moraleMax * JIN.morale.routRatio) routJin(state, other);
  }
}

function centerOf(list: readonly Enemy[]): Vec | null {
  if (list.length === 0) return null;
  let x = 0;
  let y = 0;
  for (const e of list) {
    x += e.body.pos.x;
    y += e.body.pos.y;
  }
  return { x: x / list.length, y: y / list.length };
}

// -----------------------------------------------------------------------------
// 同時攻撃・予告の上限との通し（R5）
// -----------------------------------------------------------------------------

/** 本陣が総掛かりの構え・走りの間か。周りの敵の攻撃開始を 1 拍延ばす（jinzuHoldsAttack） */
function surgeActive(state: GameState): boolean {
  return state.jins.some((j) => j.jinzu?.phase === "hold" || j.jinzu?.phase === "charge");
}

/** プレイヤーの近く（同時攻撃の数える範囲）か */
function nearPlayer(state: GameState, e: Enemy): boolean {
  return dist(e.body.pos, state.player.body.pos) <= ENEMY_TEMPO.strikerCountRadius;
}

/**
 * 構え・総掛かりの間、走る兵・隊の兵以外の敵（プレイヤーの strikerCountRadius 以内）は新しい予備動作に入らない。
 * 既に予備動作の敵はそのまま出す（フェイントにしない）。true なら chase が attackCooldown を延ばして待つ
 */
export function jinzuHoldsAttack(state: GameState, e: Enemy): boolean {
  return !e.jinzuRun && surgeActive(state) && nearPlayer(state, e);
}

/** 予告の上限に数える「出たばかりの予告」: 画が出てから telegraphWindow の間は、その画を予告 1 つと数える */
export function freshStrokeCount(state: GameState): number {
  let n = 0;
  for (const jin of state.jins) {
    const jz = jin.jinzu;
    if (jz?.phase !== "brush") continue;
    const fresh = jz.strokes.some((s) => s.state === "sketch" && jz.t - s.appearAt < ENEMY_TEMPO.telegraphWindow);
    if (fresh) n++;
  }
  return n;
}

/** 同時攻撃の上限に数える走る兵: 総掛かり 1 つを 1 枠（プレイヤーの近くで走っている兵がいれば 1、いなければ 0） */
export function surgeStrikerSlot(state: GameState): number {
  for (const e of state.enemies) {
    if (e.hp > 0 && e.jinzuRun?.mode === "run" && e.phase === "strike" && nearPlayer(state, e)) return 1;
  }
  return 0;
}
