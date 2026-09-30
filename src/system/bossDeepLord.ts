import { type EliteKind, type Enemy, type GameState, pushSfx } from "../core/state";
import { type Vec, add, dist, fromAngle, scale } from "../core/vec";
import { type EnemyDef, depthDamage, enemyDef } from "../data/enemies";
import { ARC, BOSS, FEEL } from "../data/tuning";
import { type Rect, TILE_SIZE, rectContainsPx } from "../map/grid";
import { damagePlayer } from "./combat";
import { addFloatingText, shake, spawnBurst } from "./effects";
import { type EnemyTelegraph, createEnemy, scaledWindup } from "./enemies";
import { makeElite } from "./elites";
import { blastBoth, seedTerrain } from "./enemyTerrain";
import { fanDirections, spawnSpot } from "./enemyTraits";
import { inCone } from "./enemyWave3";
import { explodeHostile, laserEnd, spawnLanding, spawnLaser } from "./hazards";
import { overlapsWall } from "./physics";
import { applyStagger, isStaggered } from "./poise";
import { inflictOnPlayer } from "./statusEffects";
import { placeTerrain, terrainAt } from "./terrain";
import { phaseShift } from "./boss";
import { noteBossDown } from "./bossRecord";
import { type BossHooks, type BossSignature, type PlayerRead, bossDown, lungeStep, runBossCycle, toPlayer, walkToward } from "./bossKit";
import { KING_SLIME_SIGNATURE } from "./bossKingSlime";
import { THIEF_KING_SIGNATURE } from "./bossThiefKing";
import { OIL_KING_SIGNATURE } from "./bossOilKing";
import { MIRROR_KNIGHT_SIGNATURE } from "./bossMirrorKnight";

/**
 * ボス: 最深の主（最深の間 = 深度 21。docs/ideas/boss-impl.md 2-6）。
 * 第 1 段階（四門）= 部屋の四隅寄りに門柱 4 本。1 本でも立つ間は本体に通らず、1 本折るごとにダウン（門崩れ）。
 * 本体は中央から動かず、遠い相手に光線の扇、門柱の近くの相手（と他）に落石 /
 * 第 2 段階（陥没）= 門柱を全部折ると来る（HP では進まない）。外周から床が溶岩に崩れ、本体は残った内側を歩く。
 * 近い相手に 3 段の連撃（長い硬直 + 離脱）、遠い相手に踏み込み（壁か縁に当たるとダウン）、止まっている相手に落石 /
 * 第 3 段階（第三の顔）= HP で来る。奈落の手 → 借りた技 A → 連撃か踏み込み → 借りた技 B を巡る。
 * 借りるのはそのランで被弾の多かった章ボス 2 体の署名の技。借りた技の後は反動のダウン。
 * 技の選び・門柱の修飾子・崩れる床・借りる 2 体に乱数を使わない（2-8）
 */

const STAGE_GATES = 1;
const STAGE_COLLAPSE = 2;
const STAGE_FACE = 3;
/** ai.move: 技 */
export const DL_BEAM = 0;
export const DL_RAIN = 1;
export const DL_SLASH = 2;
export const DL_LUNGE = 3;
export const DL_HAND = 4;
/** 借りた技は DL_BORROW_BASE + ARC.chapters の添字（予告の形を state なしで引けるよう、技の番号に章を持たせる） */
export const DL_BORROW_BASE = 10;
/** 第三の顔の巡りの中の「近ければ連撃、でなければ踏み込み」の枠 */
const FACE_MELEE = -1;
/** 第三の顔の巡りの中の「借りた技の 1 体目 / 2 体目」の枠 */
const FACE_BORROW_FIRST = -2;
const FACE_BORROW_SECOND = -3;
const FACE_CYCLE: readonly number[] = [DL_HAND, FACE_BORROW_FIRST, FACE_MELEE, FACE_BORROW_SECOND];
/** 巡りの始まり（次の pickMove で添字 0 = 奈落の手） */
const FACE_CYCLE_START = -1;
const BORROW_COUNT = 2;

const PILLAR_KEY = "gatePillar";
/**
 * 門柱に 1 本ずつ付ける精鋭修飾子（置物で効くもの）。設計の候補のうち、堅牢の・報復のは
 * 怯んだ瞬間に発動するので、怯まない門柱（FIXTURE_IMMUNE）では何も起きず外した
 */
export const PILLAR_ELITES: readonly EliteKind[] = ["shielded", "reflective", "searing", "hexing"];
/** 門柱を置く四隅（0 = 左・上、1 = 右・下） */
const PILLAR_CORNERS: readonly (readonly [number, number])[] = [
  [0, 0],
  [1, 0],
  [0, 1],
  [1, 1],
];
const PILLAR_COUNT = PILLAR_CORNERS.length;

const GATES_TEXT = "四門";
const PILLAR_DOWN_TEXT = "門崩れ";
const COLLAPSE_TEXT = "陥没";
const FACE_TEXT = "第三の顔";
const RECOIL_TEXT = "反動";
const FULL_CIRCLE = Math.PI * 2;
/** 浮き文字の持ち上げ（px）・大きさ・秒 */
const TEXT_LIFT = 22;
const TEXT_SCALE = 1.6;
const TEXT_LIFE = 1.2;
/** 崩れる床 1 タイルの半径（タイルの中心だけに置く） */
const COLLAPSE_CELL_RADIUS = TILE_SIZE / 2;
/** 時刻の比較の余裕（浮動小数の積み上げで最後の奈落の手を落とさない） */
const TIME_EPSILON = 1e-6;
/** 落石の点が壁に掛かるかの判定の半径 */
const RAIN_WALL_RADIUS = 2;

const HOOKS: BossHooks = {
  approach,
  beginWindup,
  beginStrike,
  tickStrike,
  pickMove,
  followUp,
  recoverTime,
  recoverRetreatMul: (e) => (e.ai?.move === DL_SLASH ? BOSS.deepLord.retreatMul : 0),
};

export function updateDeepLord(state: GameState, e: Enemy, def: EnemyDef, dt: number): void {
  const ai = e.ai;
  if (!ai) return;
  checkPillars(state, e);
  advanceStage(state, e);
  tickCollapse(state, e, dt);
  // 門崩れ・反動のダウンが今入ったなら、このステップは動かない
  if (isStaggered(e)) return;
  runBossCycle(state, e, def, dt, HOOKS);
  keepInside(state, e);
}

function color(): string {
  return BOSS.deepLord.color;
}

function floatText(state: GameState, e: Enemy, text: string): void {
  addFloatingText(state, { x: e.body.pos.x, y: e.body.pos.y - TEXT_LIFT }, text, color(), TEXT_SCALE, TEXT_LIFE);
}

// -----------------------------------------------------------------------------
// 四門（門柱）
// -----------------------------------------------------------------------------

/** ボス部屋を作るとき（boss.ts の setupBossRoom）: 四隅寄りに門柱を 4 本、それぞれ別の修飾子で立てる */
export function setupDeepLordRoom(state: GameState, boss: Enemy): void {
  const room = state.rooms[boss.roomIndex];
  if (!room) return;
  const def = enemyDef(PILLAR_KEY);
  PILLAR_CORNERS.forEach(([sx, sy], i) => {
    const want = pillarSpot(room.rect, sx, sy);
    const pillar = createEnemy(state, def, spawnSpot(state, want, boss.body.pos, def.radius), boss.roomIndex, false);
    pillar.leaderId = boss.id;
    const kind = PILLAR_ELITES[i % PILLAR_ELITES.length];
    if (kind) makeElite(pillar, kind);
    state.enemies.push(pillar);
  });
}

/** 門柱の置き場所: 角から pillarInset タイル内側のタイルの中心（部屋が狭ければ中央寄りに詰める） */
function pillarSpot(r: Rect, sx: number, sy: number): Vec {
  const insetX = Math.min(BOSS.deepLord.pillarInset, Math.floor((r.w - 1) / 2));
  const insetY = Math.min(BOSS.deepLord.pillarInset, Math.floor((r.h - 1) / 2));
  const tx = sx === 0 ? r.x + insetX : r.x + r.w - 1 - insetX;
  const ty = sy === 0 ? r.y + insetY : r.y + r.h - 1 - insetY;
  return { x: (tx + 0.5) * TILE_SIZE, y: (ty + 0.5) * TILE_SIZE };
}

/** 立っている門柱 */
export function gatePillarsOf(state: GameState, e: Enemy): Enemy[] {
  return state.enemies.filter((o) => o.hp > 0 && o.defKey === PILLAR_KEY && o.leaderId === e.id);
}

/** 門柱が 1 本でも立つ間は本体に通らない（boss.ts の bossArmorBlocks が読む） */
export function deepLordGuarded(state: GameState, e: Enemy): boolean {
  return (e.ai?.stage ?? STAGE_GATES) === STAGE_GATES && gatePillarsOf(state, e).length > 0;
}

/**
 * 折れた門柱を数え、1 本ごとに門崩れのダウン（ai.progress = 折れた数）。
 * 初回は開戦の「四門」を出す。門柱の無い所（黄金テストの闘技場など）では折れた扱いから始める
 */
function checkPillars(state: GameState, e: Enemy): void {
  const ai = e.ai;
  if (!ai || ai.stage !== STAGE_GATES) return;
  const standing = gatePillarsOf(state, e).length;
  if (ai.progress === undefined) {
    ai.progress = PILLAR_COUNT - standing;
    if (standing > 0) floatText(state, e, GATES_TEXT);
    return;
  }
  while (ai.progress < PILLAR_COUNT - standing) {
    ai.progress += 1;
    bossDown(state, e, BOSS.deepLord.pillarDown, PILLAR_DOWN_TEXT, color());
  }
}

function advanceStage(state: GameState, e: Enemy): void {
  const ai = e.ai;
  if (!ai) return;
  // 規則 1: 第 2 段階は門柱を全部折ったときだけ（HP では進まない。そもそも門柱の間は通らない）
  if (ai.stage === STAGE_GATES && (ai.progress ?? 0) >= PILLAR_COUNT) {
    phaseShift(state, e, COLLAPSE_TEXT, color(), STAGE_COLLAPSE);
    ai.timer = 0;
    collapseStep(state, e, 1);
    return;
  }
  if (ai.stage === STAGE_COLLAPSE && e.hp <= e.maxHp * BOSS.deepLord.phase3Ratio) {
    phaseShift(state, e, FACE_TEXT, color(), STAGE_FACE);
    ai.counter = FACE_CYCLE_START;
    // 攻撃の合間なら次の技をすぐ奈落の手に（技の最中なら硬直の終わりの pickMove が巡りの頭から選ぶ）
    if (e.phase === "chase") ai.move = nextFaceMove(state, e, readNear(state, e));
  }
}

function readNear(state: GameState, e: Enemy): boolean {
  return dist(state.player.body.pos, e.body.pos) < BOSS.rules.nearDist;
}

// -----------------------------------------------------------------------------
// 陥没（外周から床が溶岩へ）
// -----------------------------------------------------------------------------

/** 陥没が始まってからの秒で、何回目まで崩れたか（1 回目は段階の始まり） */
function collapseStepsAt(state: GameState, e: Enemy, t: number): number {
  return Math.min(maxCollapseSteps(state, e), 1 + Math.floor(t / BOSS.deepLord.collapseEvery));
}

/** 崩れる回数の上限: collapseSteps のうち、内側が collapseMinInner タイル以上残る回まで */
function maxCollapseSteps(state: GameState, e: Enemy): number {
  const r = state.rooms[e.roomIndex]?.rect;
  if (!r) return 0;
  const k = BOSS.deepLord;
  let steps = 0;
  for (let s = 1; s <= k.collapseSteps; s++) {
    const inset = 2 * s * k.ringTiles;
    if (r.w - inset < k.collapseMinInner || r.h - inset < k.collapseMinInner) break;
    steps = s;
  }
  return steps;
}

/** 陥没の時計（ai.timer）を進め、区切りを越えたら次の外周を崩す */
function tickCollapse(state: GameState, e: Enemy, dt: number): void {
  const ai = e.ai;
  if (!ai || ai.stage < STAGE_COLLAPSE) return;
  const before = collapseStepsAt(state, e, ai.timer);
  ai.timer += dt;
  const after = collapseStepsAt(state, e, ai.timer);
  for (let s = before + 1; s <= after; s++) collapseStep(state, e, s);
}

/** step 回目の外周（縁からの距離が (step-1)×ringTiles 以上 step×ringTiles 未満のタイル）に影を出し、溶岩を予約する */
function collapseStep(state: GameState, e: Enemy, step: number): void {
  const r = state.rooms[e.roomIndex]?.rect;
  if (!r || step > maxCollapseSteps(state, e)) return;
  const k = BOSS.deepLord;
  for (const pos of ringCells(r, (step - 1) * k.ringTiles, step * k.ringTiles)) {
    seedTerrain(state, pos, "lava", COLLAPSE_CELL_RADIUS, { delay: k.collapseWarn, duration: 0 });
  }
  shake(state, FEEL.shakeHeavy);
  pushSfx(state, "rubbleFall");
}

/** 部屋の縁からの距離（タイル）が [from, to) のタイルの中心 */
function ringCells(r: Rect, from: number, to: number): Vec[] {
  const cells: Vec[] = [];
  for (let ty = r.y; ty < r.y + r.h; ty++) {
    for (let tx = r.x; tx < r.x + r.w; tx++) {
      const edge = Math.min(tx - r.x, r.x + r.w - 1 - tx, ty - r.y, r.y + r.h - 1 - ty);
      if (edge < from || edge >= to) continue;
      cells.push({ x: (tx + 0.5) * TILE_SIZE, y: (ty + 0.5) * TILE_SIZE });
    }
  }
  return cells;
}

/** 崩れた（崩れる予約の入った）外周の幅（タイル）。予約の影の間から歩く先に入れない */
export function deepLordCollapsedTiles(state: GameState, e: Enemy): number {
  const ai = e.ai;
  if (!ai || ai.stage < STAGE_COLLAPSE) return 0;
  return collapseStepsAt(state, e, ai.timer) * BOSS.deepLord.ringTiles;
}

/** 本体の中心が居てよい範囲（px）。崩れていない内側から体の半径ぶん内へ */
function safeBounds(state: GameState, e: Enemy): { minX: number; maxX: number; minY: number; maxY: number } | null {
  const r = state.rooms[e.roomIndex]?.rect;
  if (!r) return null;
  const inset = deepLordCollapsedTiles(state, e) * TILE_SIZE + e.body.radius;
  const minX = r.x * TILE_SIZE + inset;
  const maxX = (r.x + r.w) * TILE_SIZE - inset;
  const minY = r.y * TILE_SIZE + inset;
  const maxY = (r.y + r.h) * TILE_SIZE - inset;
  if (minX > maxX || minY > maxY) return null;
  return { minX, maxX, minY, maxY };
}

/** 陥没の間は残った内側に留める（溶岩の上へ歩かない・跳ばない）。縁で止めたら true */
function keepInside(state: GameState, e: Enemy): boolean {
  if (deepLordCollapsedTiles(state, e) <= 0) return false;
  const b = safeBounds(state, e);
  if (!b) return false;
  const p = e.body.pos;
  const x = Math.max(b.minX, Math.min(b.maxX, p.x));
  const y = Math.max(b.minY, Math.min(b.maxY, p.y));
  if (x === p.x && y === p.y) return false;
  e.body.pos = { x, y };
  return true;
}

/**
 * 最深の主が倒れた（boss.ts の onBossDeath）: 残った門柱を消し、崩れる予約を取り消し、陥没の溶岩を collapseFade 秒で消す。
 * 階段と地上への道へ歩いて行けるように（階を出れば地形の層と予約は階ごと捨てられる）
 */
export function settleDeepLordRoom(state: GameState, e: Enemy): void {
  for (const pillar of gatePillarsOf(state, e)) {
    pillar.vanished = true;
    pillar.hp = 0;
    spawnBurst(state, pillar.body.pos, color(), 10, 80, 0.4, 2);
  }
  const r = state.rooms[e.roomIndex]?.rect;
  if (!r) return;
  const inRoom = (pos: Vec): boolean => rectContainsPx(r, pos.x, pos.y);
  state.terrainSeeds = (state.terrainSeeds ?? []).filter((s) => !(s.kind === "lava" && s.depth === state.depth && inRoom(s.pos)));
  // 取り消した予約の影（sourceId の無い影）も消す
  for (const h of state.hazards) {
    if (h.kind === "landing" && h.sourceId === undefined && inRoom(h.pos)) h.time = 0;
  }
  // 崩れ終えた外周の溶岩だけを collapseFade 秒で消える溶岩に置き直す。まだ崩れていない外周（予約を取り消した所・
  // 部屋が狭くて崩れない所）へ溶岩を新しく置くと、撃破の瞬間に足元が溶岩になる
  for (const pos of ringCells(r, 0, deepLordCollapsedTiles(state, e))) {
    if (terrainAt(state, pos.x, pos.y) !== "lava") continue;
    placeTerrain(state, pos.x, pos.y, "lava", COLLAPSE_CELL_RADIUS, BOSS.deepLord.collapseFade);
  }
}

// -----------------------------------------------------------------------------
// 技の選び（乱数なし）
// -----------------------------------------------------------------------------

function pickMove(state: GameState, e: Enemy, read: PlayerRead): number {
  const stage = e.ai?.stage ?? STAGE_GATES;
  if (stage === STAGE_GATES) {
    // 門柱を殴りに行く相手と足元に来た相手には落石（門柱ごと巻き込む）。離れて様子を見る相手には光線。
    // ボス部屋（18×14 前後）では中央からの「遠い」は四隅しか無いので、中の間合いから光線にする
    if (nearPillar(state, e) || read.band === "near") return DL_RAIN;
    return DL_BEAM;
  }
  if (stage === STAGE_COLLAPSE) {
    if (read.stillSec >= BOSS.rules.stillSec) return DL_RAIN;
    return read.band === "near" ? DL_SLASH : DL_LUNGE;
  }
  return nextFaceMove(state, e, read.band === "near");
}

function nearPillar(state: GameState, e: Enemy): boolean {
  const p = state.player.body.pos;
  return gatePillarsOf(state, e).some((o) => dist(o.body.pos, p) <= BOSS.deepLord.pillarGuardDist);
}

/** 第三の顔の巡りの次（ai.counter = 巡りの添字） */
function nextFaceMove(state: GameState, e: Enemy, near: boolean): number {
  const ai = e.ai;
  if (!ai) return DL_HAND;
  ai.counter = (ai.counter + 1 + FACE_CYCLE.length) % FACE_CYCLE.length;
  const slot = FACE_CYCLE[ai.counter] ?? DL_HAND;
  const melee = near ? DL_SLASH : DL_LUNGE;
  if (slot === FACE_MELEE) return melee;
  if (slot === FACE_BORROW_FIRST || slot === FACE_BORROW_SECOND) {
    const key = borrowedBosses(state)[slot === FACE_BORROW_FIRST ? 0 : 1];
    const index = key === undefined ? -1 : ARC.chapters.findIndex((c) => c.boss === key);
    return index < 0 ? melee : DL_BORROW_BASE + index;
  }
  return slot;
}

/**
 * 借りる 2 体: そのランの記録（state.bossLog）にある章ボスを被弾の多い順（同数は章の順）、
 * 足りなければ記録の無い章ボスを章の順で。署名の技を持たない key は飛ばす
 */
export function borrowedBosses(state: GameState): string[] {
  const chapterKeys = ARC.chapters.map((c) => c.boss).filter((key) => signatureFor(key) !== null);
  const hitsOf = (key: string): number => state.bossLog.filter((r) => r.key === key).reduce((sum, r) => sum + r.hits, 0);
  const met = chapterKeys.filter((key) => state.bossLog.some((r) => r.key === key));
  // 並べ替えは安定なので、同数は章の順のまま
  const ranked = [...met].sort((a, b) => hitsOf(b) - hitsOf(a));
  const rest = chapterKeys.filter((key) => !met.includes(key));
  return [...ranked, ...rest].slice(0, BORROW_COUNT);
}

/** 章ボスの署名の技（循環 import の読み込み順に左右されないよう、表ではなく呼ぶたびに引く） */
function signatureFor(key: string): BossSignature | null {
  switch (key) {
    case "kingSlime":
      return KING_SLIME_SIGNATURE;
    case "thiefKing":
      return THIEF_KING_SIGNATURE;
    case "oilKing":
      return OIL_KING_SIGNATURE;
    case "mirrorKnight":
      return MIRROR_KNIGHT_SIGNATURE;
    default:
      return null;
  }
}

/** 技の番号が借りた技なら、その署名の技 */
function borrowedOf(move: number): BossSignature | null {
  if (move < DL_BORROW_BASE) return null;
  const key = ARC.chapters[move - DL_BORROW_BASE]?.boss;
  return key === undefined ? null : signatureFor(key);
}

/**
 * 借りた技を呼ぶ。数値と拍は章ボスの定義（def）で出す。借りた技が汎用の欄を書いても、
 * 最深の主の巡りの添字（counter）・陥没の時計（timer）・門柱の数（progress）は壊させない
 */
function borrow<T>(e: Enemy, fn: (def: EnemyDef) => T, sig: BossSignature): T {
  const ai = e.ai;
  const def = enemyDef(sig.key);
  if (!ai) return fn(def);
  const saved = { counter: ai.counter, timer: ai.timer, progress: ai.progress };
  try {
    return fn(def);
  } finally {
    ai.counter = saved.counter;
    ai.timer = saved.timer;
    ai.progress = saved.progress;
  }
}

/** 連撃は slashCount 段まで続ける。借りた技の後は反動のダウン */
function followUp(state: GameState, e: Enemy, done: number): number | null {
  const ai = e.ai;
  if (!ai) return null;
  if (done === DL_SLASH) return (ai.chain ?? 0) + 1 < BOSS.deepLord.slashCount ? DL_SLASH : null;
  if (borrowedOf(done)) bossDown(state, e, BOSS.deepLord.borrowRecoil, RECOIL_TEXT, color());
  return null;
}

function recoverTime(_state: GameState, e: Enemy, def: EnemyDef): number {
  return e.ai?.move === DL_SLASH ? def.recover * BOSS.deepLord.slashRecoverMul : def.recover;
}

// -----------------------------------------------------------------------------
// 状態機械のフック
// -----------------------------------------------------------------------------

function approach(state: GameState, e: Enemy, def: EnemyDef, dt: number): void {
  // 四門の間は中央から動かない（門柱を回る相手を光線と落石で追う）
  if ((e.ai?.stage ?? STAGE_GATES) === STAGE_GATES) {
    const dir = toPlayer(state, e);
    if (dir.x !== 0) e.facing = dir;
    return;
  }
  walkToward(state, e, def, dt);
}

function beginWindup(state: GameState, e: Enemy, def: EnemyDef): void {
  const ai = e.ai;
  if (!ai) return;
  const k = BOSS.deepLord;
  e.strikeDir = toPlayer(state, e);
  if (e.strikeDir.x !== 0) e.facing = e.strikeDir;
  const sig = borrowedOf(ai.move);
  if (sig) {
    borrow(e, (d) => sig.beginWindup(state, e, d), sig);
    return;
  }
  switch (ai.move) {
    case DL_BEAM:
      e.phaseTimer = scaledWindup(def.windup, state.depth);
      ai.points = beamEnds(state, e);
      pushSfx(state, "laserCharge");
      return;
    case DL_RAIN:
      e.phaseTimer = scaledWindup(k.rainFall, state.depth);
      ai.points = rainPoints(state, e);
      for (const p of ai.points) spawnLanding(state, p, k.rainRadius, e.phaseTimer, e.id);
      return;
    default:
      e.phaseTimer = scaledWindup(def.windup, state.depth);
      return;
  }
}

/** 光線の終点: プレイヤーへ向けた扇の各向きで、壁に当たるまで */
function beamEnds(state: GameState, e: Enemy): Vec[] {
  const k = BOSS.deepLord;
  return fanDirections(e.strikeDir, k.beamCount, k.beamSpreadDeg).map((dir) => laserEnd(state, e.body.pos, dir, k.beamLength));
}

/** 落石の点: プレイヤーの足元と、その周りに等間隔（向きは本体からプレイヤーへの向きを基準にする。乱数なし） */
function rainPoints(state: GameState, e: Enemy): Vec[] {
  const k = BOSS.deepLord;
  const center = { ...state.player.body.pos };
  const points: Vec[] = [center];
  const around = Math.max(0, k.rainCount - 1);
  const base = Math.atan2(e.strikeDir.y, e.strikeDir.x);
  for (let i = 0; i < around; i++) {
    const q = add(center, scale(fromAngle(base + (i / around) * FULL_CIRCLE), k.rainSpread));
    if (!overlapsWall(state, q.x, q.y, RAIN_WALL_RADIUS)) points.push(q);
  }
  return points;
}

function beginStrike(state: GameState, e: Enemy, def: EnemyDef): void {
  const ai = e.ai;
  if (!ai) return;
  const k = BOSS.deepLord;
  const sig = borrowedOf(ai.move);
  if (sig) {
    borrow(e, (d) => sig.beginStrike(state, e, d), sig);
    return;
  }
  switch (ai.move) {
    case DL_BEAM: {
      e.phaseTimer = k.beamTime;
      const damage = depthDamage(k.beamDamage, state.depth);
      for (const to of ai.points ?? []) spawnLaser(state, e.body.pos, to, k.beamTime, damage, e.id);
      ai.points = [];
      pushSfx(state, "laserFire");
      return;
    }
    case DL_RAIN: {
      e.phaseTimer = def.strikeTime;
      const damage = depthDamage(k.rainDamage, state.depth);
      const source = { defKey: e.defKey, roomIndex: e.roomIndex };
      // 敵にも当たる（門柱の近くへ誘えば門柱を砕ける）
      for (const p of ai.points ?? []) blastBoth(state, p, k.rainRadius, damage, color(), source, e.id);
      ai.points = [];
      return;
    }
    case DL_SLASH:
      e.phaseTimer = def.strikeTime;
      slash(state, e);
      return;
    case DL_LUNGE:
      // 予告の線のとおりに進む（向きは予備動作の始まりで決めたまま）
      e.phaseTimer = k.lungeTime;
      return;
    case DL_HAND:
      e.phaseTimer = handTotalTime();
      ai.points = [];
      dropHand(state, e);
      return;
    default:
      e.phaseTimer = def.strikeTime;
      return;
  }
}

function tickStrike(state: GameState, e: Enemy, def: EnemyDef, dt: number): boolean {
  const ai = e.ai;
  if (!ai) return false;
  const sig = borrowedOf(ai.move);
  if (sig) return borrow(e, (d) => sig.tickStrike?.(state, e, d, dt) ?? false, sig);
  if (ai.move === DL_LUNGE) return lungeTick(state, e, def, dt);
  if (ai.move === DL_HAND) tickHands(state, e, dt);
  return false;
}

/** 連撃 1 段: 扇の中のプレイヤーに当てる */
function slash(state: GameState, e: Enemy): void {
  const k = BOSS.deepLord;
  const tip = add(e.body.pos, scale(e.strikeDir, k.slashRange * 0.6));
  spawnBurst(state, tip, color(), 10, 140, 0.25, 2);
  pushSfx(state, "swingGreatsword");
  if (!inCone(e.body.pos, e.strikeDir, k.slashRange, k.slashHalfDeg, state.player.body.pos)) return;
  if (damagePlayer(state, depthDamage(k.slashDamage, state.depth), e.body.pos, e) === "hit") inflictOnPlayer(state, e, "contact");
}

/** 踏み込み: 壁か陥没の縁に当たるとダウン。触れたら終わる */
function lungeTick(state: GameState, e: Enemy, def: EnemyDef, dt: number): boolean {
  const step = lungeStep(state, e, def, BOSS.deepLord.lungeSpeedMul, dt);
  const edge = keepInside(state, e);
  if (!step.wall && !edge) return step.touched;
  shake(state, FEEL.shakeHeavy);
  pushSfx(state, "wallHit");
  if (applyStagger(state, e, BOSS.deepLord.wallStagger, { selfInflicted: true })) noteBossDown(state, e);
  return true;
}

/** 奈落の手の攻撃の総秒: 最後の手が落ちるまで */
function handTotalTime(): number {
  const k = BOSS.deepLord;
  return Math.max(0, k.handCount - 1) * k.handGap + k.handFall;
}

/** 奈落の手を 1 つ、プレイヤーの今の足元に（影 → handFall 秒後に落ちる。ai.points = 落とした順の位置） */
function dropHand(state: GameState, e: Enemy): void {
  const ai = e.ai;
  if (!ai) return;
  const pos = { ...state.player.body.pos };
  ai.points = [...(ai.points ?? []), pos];
  spawnLanding(state, pos, BOSS.deepLord.handRadius, BOSS.deepLord.handFall);
}

/** 攻撃の始まりからの秒で、handGap ごとに手を出し、出してから handFall 秒で落とす（止まっていると当たる） */
function tickHands(state: GameState, e: Enemy, dt: number): void {
  const ai = e.ai;
  if (!ai) return;
  const k = BOSS.deepLord;
  const elapsed = handTotalTime() - e.phaseTimer;
  const prev = elapsed - dt;
  const crossed = (t: number): boolean => prev + TIME_EPSILON < t && elapsed + TIME_EPSILON >= t;
  for (let i = 1; i < k.handCount; i++) if (crossed(i * k.handGap)) dropHand(state, e);
  const damage = depthDamage(k.handDamage, state.depth);
  const source = { defKey: e.defKey, roomIndex: e.roomIndex };
  (ai.points ?? []).forEach((pos, i) => {
    if (crossed(i * k.handGap + k.handFall)) explodeHostile(state, pos, k.handRadius, damage, color(), source);
  });
}

/** 予告の形: 光線は扇の線、連撃は扇、踏み込みは線、借りた技はその章ボスの形（落石・奈落の手は影） */
export function deepLordTelegraph(e: Enemy): EnemyTelegraph {
  const move = e.ai?.move;
  if (move === undefined) return null;
  const k = BOSS.deepLord;
  const sig = borrowedOf(move);
  if (sig) return sig.telegraph?.(e) ?? null;
  switch (move) {
    case DL_BEAM:
      return { kind: "cross" };
    case DL_SLASH:
      return { kind: "cone", range: k.slashRange, halfDeg: k.slashHalfDeg };
    case DL_LUNGE:
      return { kind: "line", length: enemyDef("deepLord").speed * k.lungeSpeedMul * k.lungeTime };
    default:
      return null;
  }
}
