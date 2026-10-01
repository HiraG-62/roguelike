import { type Enemy, type GameState, pushSfx } from "../core/state";
import { type Vec, add, fromAngle, length, normalize, scale, sub } from "../core/vec";
import { type EnemyDef, depthDamage, enemyDef } from "../data/enemies";
import { BOSS } from "../data/tuning";
import { TILE_SIZE, isWalkable, rectCenterPx } from "../map/grid";
import { spawnBurst } from "./effects";
import { type EnemyTelegraph, createEnemy, moveEnemy, scaledWindup } from "./enemies";
import { blastBoth } from "./enemyTerrain";
import { fanDirections, fireEnemyBullet, spawnSpot } from "./enemyTraits";
import { spawnBoneWall, spawnLanding } from "./hazards";
import { overlapsWall } from "./physics";
import { isStaggered } from "./poise";
import { phaseShift } from "./boss";
import { type BossHooks, type PlayerRead, bossDown, lungeStep, readPlayer, runBossCycle, signatureOf, toPlayer, walkToward } from "./bossKit";
import { placeTerrain } from "./terrain";

/**
 * ボス: 盗賊王（docs/ideas/enemies.md B3「逃げるボス」。3 部屋が連なる形は見送り、1 部屋の中で逃げ回る）。
 * 第 1 段階（逃げ撃ち）= 距離を取って逃げながら、プレイヤーの間合い・静止・ダッシュを読んで短剣の扇・地雷・煙玉を選ぶ /
 * 第 2 段階（手下と地雷）= 取り巻きを呼び、地雷を多く撒く。始まりに部屋へ L 字の柵が立つ（角が増えて追い詰めやすい）/
 * 第 3 段階（開き直り）= 生命が減るか、追い詰めのダウンが cornersToRage 回で、柵が崩れて突進と短剣で全力で戦う（逃げない）。
 * 部屋のギミック: 逃げ道が壁で塞がれた（壁際・角・柵）ままプレイヤーに詰め寄られ続けると、追い詰められてダウンする。
 * 逃げ場の無い位置へ押し込むほど早く崩れる。第 1・2 段階は技のあと離れる（一撃離脱）。
 * 予告: 短剣 = 扇 / 地雷 = 落下点の影 / 煙玉 = 足元の輪 / 突進 = 線
 */

const STAGE_ONE = 1;
const STAGE_TRAPS = 2;
const STAGE_CORNERED = 3;
/** ai.move: 技 */
export const THIEF_KNIFE = 0;
export const THIEF_MINE = 1;
export const THIEF_SMOKE = 2;
export const THIEF_DASH = 3;
const FULL_CIRCLE = Math.PI * 2;
const TRAPS_TEXT = "手下ども、出番だ";
const CORNERED_TEXT = "開き直り";
const DOWN_TEXT = "ダウン";
const MINION_KEY = "thief";
/** 柵を立てる部屋の 4 分割の中心（矩形の端から幅の 1/4）と、立てる数 */
const QUARTER = 0.25;
const FENCE_CORNERS = 2;
const MINE_KEY = "enemyMine";
/** 投げる技の攻撃の長さ（strikeTime に対する割合。すぐ隙へ移る） */
const QUICK_STRIKE_RATIO = 0.3;
/** 地雷の落下点の影の半径（落ちるまでの予告。地雷そのものの炸裂は踏まれてから別に予告する） */
const MINE_MARK_RADIUS = 8;
/** 撃破の後始末で消える地雷の煙（粒の数・速さ・寿命・大きさ） */
const MINE_VANISH_PARTICLES = 6;
const MINE_VANISH_SPEED = 50;
const MINE_VANISH_LIFE = 0.3;
const MINE_VANISH_SIZE = 2;
/** 追い詰められかけている間の焦りの汗（予告）の間隔（ステップ）と色 */
const SWEAT_EVERY = 6;
const SWEAT_COLOR = "#c0e0ff";
const SWEAT_PARTICLES = 3;

const HOOKS: BossHooks = {
  approach,
  beginWindup,
  beginStrike,
  tickStrike,
  pickMove,
  followUp,
  recoverRetreatMul,
};

export function updateThiefKing(state: GameState, e: Enemy, def: EnemyDef, dt: number): void {
  const ai = e.ai;
  if (!ai) return;
  ai.timer = Math.max(0, ai.timer - dt);
  advanceStage(state, e);
  runBossCycle(state, e, def, dt, HOOKS);
}

function advanceStage(state: GameState, e: Enemy): void {
  const ai = e.ai;
  if (!ai) return;
  const k = BOSS.thiefKing;
  if (ai.stage === STAGE_ONE && e.hp <= e.maxHp * k.phase2Ratio) {
    phaseShift(state, e, TRAPS_TEXT, k.color, STAGE_TRAPS);
    enterStage(state, e);
    // 段階 2 の間の追い詰めだけを開き直りの数に入れる（段階 1 の分を持ち越すと入った直後に開き直る）
    ai.progress = 0;
    summonThieves(state, e, k.minions[1] ?? 0);
    raiseFence(state, e);
    return;
  }
  // 規則 1（行為で進む段階）: 追い詰めのダウンが cornersToRage 回で、生命に関わらず開き直る。生命は保険
  if (ai.stage === STAGE_TRAPS && (e.hp <= e.maxHp * k.phase3Ratio || (ai.progress ?? 0) >= k.cornersToRage)) {
    phaseShift(state, e, CORNERED_TEXT, k.color, STAGE_CORNERED);
    enterStage(state, e);
    summonThieves(state, e, k.minions[2] ?? 0);
    ai.cornered = 0;
    dropFence(state, e);
  }
}

/** 段階が変わった: 交互に選ぶ数えを戻し、追跡中なら新しい段階の技を選び直す（攻撃の最中なら今の技を出し切る） */
function enterStage(state: GameState, e: Enemy): void {
  const ai = e.ai;
  if (!ai) return;
  ai.counter = 0;
  if (e.phase === "chase") ai.move = pickMove(state, e, readPlayer(state, e));
}

// -----------------------------------------------------------------------------
// 技の選び（規則 4。乱数なし。交互は ai.counter の偶奇）
// -----------------------------------------------------------------------------

function pickMove(_state: GameState, e: Enemy, read: PlayerRead): number {
  const ai = e.ai;
  if (!ai) return THIEF_KNIFE;
  ai.counter += 1;
  const odd = ai.counter % 2 === 1;
  switch (ai.stage) {
    case STAGE_TRAPS:
      return pickTraps(read, odd);
    case STAGE_CORNERED:
      // 開き直り: 近ければ怒りの扇、それ以外は突進
      return read.band === "near" ? THIEF_KNIFE : THIEF_DASH;
    default:
      return pickOpening(read, odd);
  }
}

/** 逃げ撃ち: 遠ければ短剣、ダッシュで詰めてきた相手には煙玉、止まっていれば地雷、他は短剣と地雷を交互 */
function pickOpening(read: PlayerRead, odd: boolean): number {
  if (read.band === "far") return THIEF_KNIFE;
  if (read.dashedRecently) return THIEF_SMOKE;
  if (read.stillSec >= BOSS.rules.stillSec) return THIEF_MINE;
  return odd ? THIEF_MINE : THIEF_KNIFE;
}

/** 手下と地雷: 遠ければ地雷（追ってくる道を塞ぐ）、近ければ煙玉、中は短剣と地雷を交互（地雷を多く撒く） */
function pickTraps(read: PlayerRead, odd: boolean): number {
  if (read.band === "far") return THIEF_MINE;
  if (read.band === "near") return THIEF_SMOKE;
  return odd ? THIEF_MINE : THIEF_KNIFE;
}

/**
 * 連撃（開き直りだけ）: 怒りの扇はもう 1 扇、突進は壁に当たらなかったもう 1 度。
 * 壁激突で怯んだ突進は続けない（見えるダウンの隙を潰さない）
 */
function followUp(_state: GameState, e: Enemy, done: number): number | null {
  const ai = e.ai;
  if (!ai || ai.stage !== STAGE_CORNERED || isStaggered(e)) return null;
  const k = BOSS.thiefKing;
  const chain = ai.chain ?? 0;
  if (done === THIEF_KNIFE) return chain < k.rageKnifeChain ? THIEF_KNIFE : null;
  if (done === THIEF_DASH) return chain < k.dashChain ? THIEF_DASH : null;
  return null;
}

/** 第 1・2 段階は技のあと離れる（一撃離脱）。開き直りは離れない */
function recoverRetreatMul(e: Enemy): number {
  return e.ai?.stage === STAGE_CORNERED ? 0 : BOSS.thiefKing.retreatMul;
}

// -----------------------------------------------------------------------------
// 柵（第 2 段階の部屋の変化）
// -----------------------------------------------------------------------------

/**
 * 部屋を 4 分割した中心のうち王から遠い 2 か所に、部屋の中心へ向けた L 字の柵を立てる。
 * 角が増えるので追い詰めやすい。位置は部屋の矩形の幾何だけで決める（乱数なし）
 */
function raiseFence(state: GameState, e: Enemy): void {
  const room = state.rooms[e.roomIndex];
  if (!room) return;
  const r = room.rect;
  const centers = [
    { x: Math.floor(r.x + r.w * QUARTER), y: Math.floor(r.y + r.h * QUARTER) },
    { x: Math.floor(r.x + r.w * (1 - QUARTER)), y: Math.floor(r.y + r.h * QUARTER) },
    { x: Math.floor(r.x + r.w * QUARTER), y: Math.floor(r.y + r.h * (1 - QUARTER)) },
    { x: Math.floor(r.x + r.w * (1 - QUARTER)), y: Math.floor(r.y + r.h * (1 - QUARTER)) },
  ];
  const middle = rectCenterPx(r);
  const farFromKing = (c: { x: number; y: number }): number => Math.hypot((c.x + 0.5) * TILE_SIZE - e.body.pos.x, (c.y + 0.5) * TILE_SIZE - e.body.pos.y);
  const chosen = centers
    .map((c, i) => ({ c, i }))
    .sort((a, b) => farFromKing(b.c) - farFromKing(a.c) || a.i - b.i)
    .slice(0, FENCE_CORNERS);
  for (const { c } of chosen) {
    const dx = (c.x + 0.5) * TILE_SIZE < middle.x ? 1 : -1;
    const dy = (c.y + 0.5) * TILE_SIZE < middle.y ? 1 : -1;
    for (const tile of lShape(c.x, c.y, dx, dy, BOSS.thiefKing.fenceLen)) {
      if (!isWalkable(state.map, tile.x, tile.y)) continue;
      spawnBoneWall(state, tile.x, tile.y, { time: BOSS.thiefKing.fenceTime, hp: BOSS.thiefKing.fenceHp, sourceKey: e.defKey });
    }
  }
}

/** 角のタイル (x, y) から dx 向きと dy 向きへ len マスずつ伸びる L 字（角は 1 度だけ） */
function lShape(x: number, y: number, dx: number, dy: number, len: number): { x: number; y: number }[] {
  const tiles = [];
  for (let i = 0; i < len; i++) tiles.push({ x: x + dx * i, y });
  for (let i = 1; i < len; i++) tiles.push({ x, y: y + dy * i });
  return tiles;
}

/** 開き直りで柵はすべて崩れる（時間切れと同じ経路で lockedTiles を戻す） */
function dropFence(state: GameState, e: Enemy): void {
  for (const h of state.hazards) if (h.kind === "boneWall" && h.sourceKey === e.defKey) h.time = 0;
}

/**
 * 撃破の後始末（boss.ts の onBossDeath）: 柵を崩す。手下と地雷の段階から一撃で倒すと開き直りを経ないので、
 * 柵（寿命 fenceTime）が部屋に残り続ける
 */
export function settleThiefKingRoom(state: GameState, e: Enemy): void {
  dropFence(state, e);
  clearMinesOf(state, e);
}

/**
 * 本体（盗賊王・地雷を借りた最深の主）の置いた地雷を消す。残すと部屋の生存者に数えられて封鎖が解けない。
 * 撃破ではなく消滅（vanished）にして、ドロップ・撃破数・置き土産を出さない
 */
export function clearMinesOf(state: GameState, e: Enemy): void {
  for (const mine of state.enemies) {
    if (mine.hp <= 0 || mine.defKey !== MINE_KEY || mine.leaderId !== e.id) continue;
    mine.vanished = true;
    mine.hp = 0;
    spawnBurst(state, mine.body.pos, BOSS.thiefKing.color, MINE_VANISH_PARTICLES, MINE_VANISH_SPEED, MINE_VANISH_LIFE, MINE_VANISH_SIZE);
  }
}

/** ボス部屋に最初から手下を置く（部屋の封鎖と同時に動き出す） */
export function setupThiefKingRoom(state: GameState, boss: Enemy): void {
  summonThieves(state, boss, BOSS.thiefKing.minions[0] ?? 0, false);
}

/** 取り巻きの盗賊を王の周りに呼ぶ。戦いの最中は出現の魔法陣（spawning）がそのまま予告になる */
function summonThieves(state: GameState, e: Enemy, count: number, spawning = true): void {
  const def = enemyDef(MINION_KEY);
  const k = BOSS.thiefKing;
  for (let i = 0; i < count; i++) {
    const want = add(e.body.pos, scale(fromAngle((i / Math.max(1, count)) * FULL_CIRCLE + e.id), k.minionSpread));
    const minion = createEnemy(state, def, spawnSpot(state, want, e.body.pos, def.radius), e.roomIndex, spawning);
    minion.leaderId = e.id;
    // 蘇生と同じ扱い: ドロップ・撃破数を出さない（呼ばせ続けて稼がせない）
    minion.revived = true;
    state.enemies.push(minion);
  }
  if (spawning && count > 0) pushSfx(state, "ambush");
}

// -----------------------------------------------------------------------------
// 追跡中: 第 1・2 段階は逃げる（追い詰めるとダウン）、第 3 段階は寄る
// -----------------------------------------------------------------------------

function approach(state: GameState, e: Enemy, def: EnemyDef, dt: number): void {
  if (e.ai?.stage === STAGE_CORNERED) {
    walkToward(state, e, def, dt);
    return;
  }
  flee(state, e, def, dt);
}

/**
 * プレイヤーから keepAway まで離れる。逃げる向きへ進めなかった（壁際・角で塞がれた）まま詰め寄られていれば
 * 追い詰められた秒が溜まる。壁沿いに滑れても、逃げる向きへの進みで測るので壁際は塞がれた扱いになる
 */
function flee(state: GameState, e: Enemy, def: EnemyDef, dt: number): void {
  const k = BOSS.thiefKing;
  const to = sub(state.player.body.pos, e.body.pos);
  const d = length(to);
  const dir = normalize(to, e.facing);
  if (dir.x !== 0) e.facing = dir;
  if (d >= k.keepAway) {
    easeCornered(e, dt);
    return;
  }
  const away = scale(dir, -1);
  const want = def.speed * k.fleeSpeedMul * dt;
  const before = { ...e.body.pos };
  moveEnemy(state, e, def, away.x * want, away.y * want);
  const moved = sub(e.body.pos, before);
  const progress = moved.x * away.x + moved.y * away.y;
  const blocked = want > 0 && progress < want * k.stuckRatio;
  if (blocked && d <= k.cornerRadius) {
    pressCornered(state, e, dt);
    return;
  }
  easeCornered(e, dt);
}

function easeCornered(e: Enemy, dt: number): void {
  const ai = e.ai;
  if (!ai) return;
  ai.cornered = Math.max(0, (ai.cornered ?? 0) - dt);
}

/** 追い詰められている秒を溜める。焦りの汗が予告。溜まり切るとダウン（間隔つき。ai.timer） */
function pressCornered(state: GameState, e: Enemy, dt: number): void {
  const ai = e.ai;
  if (!ai) return;
  const k = BOSS.thiefKing;
  ai.cornered = (ai.cornered ?? 0) + dt;
  if (state.tick % SWEAT_EVERY === 0) {
    spawnBurst(state, { x: e.body.pos.x, y: e.body.pos.y - e.body.radius }, SWEAT_COLOR, SWEAT_PARTICLES, 40, 0.3, 1.5);
  }
  if (ai.cornered < k.cornerTime || ai.timer > 0) return;
  ai.cornered = 0;
  ai.timer = k.cornerCooldown;
  // 追い詰めのダウンの数が段階 2 → 3 の条件（開き直り）
  if (bossDown(state, e, k.cornerStagger, DOWN_TEXT, k.color)) ai.progress = (ai.progress ?? 0) + 1;
}

/** 追い詰められかけている割合（0..1。描画・テスト用） */
export function thiefKingCornered(e: Enemy): number {
  return Math.min(1, (e.ai?.cornered ?? 0) / BOSS.thiefKing.cornerTime);
}

// -----------------------------------------------------------------------------
// 技
// -----------------------------------------------------------------------------

function beginWindup(state: GameState, e: Enemy, def: EnemyDef): void {
  const ai = e.ai;
  if (!ai) return;
  const k = BOSS.thiefKing;
  e.strikeDir = toPlayer(state, e);
  switch (ai.move) {
    case THIEF_MINE:
      e.phaseTimer = scaledWindup(k.mineFall, state.depth);
      ai.points = minePoints(state, e);
      for (const p of ai.points) spawnLanding(state, p, MINE_MARK_RADIUS, e.phaseTimer, e.id);
      return;
    case THIEF_SMOKE:
      e.phaseTimer = scaledWindup(k.smokeFall, state.depth);
      // 煙玉は自分の足元に叩きつける。影は王に付いて動く（逃げながら投げる）
      spawnLanding(state, e.body.pos, k.smokeRadius, e.phaseTimer, e.id, true);
      return;
    default:
      e.phaseTimer = scaledWindup(def.windup, state.depth);
      return;
  }
}

/** 地雷の落下点: プレイヤーとの間に扇状に並べる（追ってくる道を塞ぐ）。壁に掛かる点は捨てる */
function minePoints(state: GameState, e: Enemy): Vec[] {
  const k = BOSS.thiefKing;
  const count = e.ai?.stage === STAGE_ONE ? k.mineCount : k.mineCountLate;
  const points: Vec[] = [];
  for (const dir of fanDirections(e.strikeDir, count, k.knifeSpreadDeg * 2)) {
    const q = add(e.body.pos, scale(dir, k.mineSpread));
    if (!overlapsWall(state, q.x, q.y, MINE_MARK_RADIUS)) points.push(q);
  }
  return points;
}

function beginStrike(state: GameState, e: Enemy, def: EnemyDef): void {
  const ai = e.ai;
  if (!ai) return;
  const k = BOSS.thiefKing;
  switch (ai.move) {
    case THIEF_KNIFE:
      e.phaseTimer = def.strikeTime * QUICK_STRIKE_RATIO;
      throwKnives(state, e);
      return;
    case THIEF_MINE:
      e.phaseTimer = def.strikeTime * QUICK_STRIKE_RATIO;
      for (const p of ai.points ?? []) dropMine(state, e, p);
      pushSfx(state, "bombFuse");
      return;
    case THIEF_SMOKE: {
      e.phaseTimer = def.strikeTime * QUICK_STRIKE_RATIO;
      const source = { defKey: e.defKey, roomIndex: e.roomIndex };
      blastBoth(state, e.body.pos, k.smokeRadius, depthDamage(k.smokeDamage, state.depth), k.color, source, e.id);
      placeTerrain(state, e.body.pos.x, e.body.pos.y, "smoke", k.smokeRadius, k.smokeTime);
      pushSfx(state, "smokeBomb");
      return;
    }
    default:
      e.phaseTimer = k.dashTime;
      e.strikeDir = toPlayer(state, e);
      if (e.strikeDir.x !== 0) e.facing = e.strikeDir;
      return;
  }
}

function throwKnives(state: GameState, e: Enemy): void {
  const k = BOSS.thiefKing;
  const count = e.ai?.stage === STAGE_CORNERED ? k.rageKnifeCount : k.knifeCount;
  const damage = depthDamage(k.knifeDamage, state.depth);
  for (const dir of fanDirections(e.strikeDir, count, k.knifeSpreadDeg)) {
    fireEnemyBullet(state, { pos: add(e.body.pos, scale(dir, e.body.radius + 2)), dir, speed: k.knifeSpeed, damage, color: k.color, sourceId: e.id });
  }
  pushSfx(state, "enemyShoot");
}

/** 地雷を置く（自分の地雷が上限なら置かない）。王自身は踏んでも起爆しない（leaderId） */
function dropMine(state: GameState, e: Enemy, pos: Vec): void {
  const alive = state.enemies.filter((o) => o.hp > 0 && o.defKey === MINE_KEY && o.leaderId === e.id).length;
  if (alive >= BOSS.thiefKing.mineMax) return;
  const def = enemyDef(MINE_KEY);
  const mine = createEnemy(state, def, spawnSpot(state, pos, e.body.pos, def.radius), e.roomIndex, false);
  mine.leaderId = e.id;
  mine.revived = true;
  mine.phase = "chase";
  state.enemies.push(mine);
}

/** 第 3 段階の突進: 壁に激突すると怯む */
function tickStrike(state: GameState, e: Enemy, def: EnemyDef, dt: number): boolean {
  if (e.ai?.move !== THIEF_DASH) return false;
  const k = BOSS.thiefKing;
  const step = lungeStep(state, e, def, k.dashSpeedMul, dt);
  if (step.wall) {
    bossDown(state, e, k.wallStagger, DOWN_TEXT, k.color);
    return true;
  }
  return step.touched;
}

/** 予告の形: 短剣は扇、突進は線（地雷と煙玉は影） */
export function thiefKingTelegraph(e: Enemy): EnemyTelegraph {
  const k = BOSS.thiefKing;
  if (e.ai?.move === THIEF_KNIFE) return { kind: "cone", range: k.knifeRange, halfDeg: k.knifeSpreadDeg / 2 };
  if (e.ai?.move === THIEF_DASH) return { kind: "line" };
  return null;
}

/** 署名の技（最深の主の第三の顔が借りる）: 地雷の扇（落下点の影 → 設置） */
export const THIEF_KING_SIGNATURE = signatureOf("thiefKing", THIEF_MINE, HOOKS);
