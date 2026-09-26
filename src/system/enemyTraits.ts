import { type Corpse, type Enemy, type GameState, allocId, pushSfx } from "../core/state";
import { type Vec, add, dist, fromAngle, normalize, scale, sub } from "../core/vec";
import { type EnemyDef, depthDamageBonus, enemyDef } from "../data/enemies";
import { BOSS, ENEMY_AI } from "../data/tuning";
import { addFloatingText, spawnBurst, spawnLine } from "./effects";
import { createEnemy, moveEnemy } from "./enemies";
import { spawnBomb } from "./hazards";
import { gainMana } from "./mana";
import { overlapsWall } from "./physics";
import { applyStatus, hasStatus } from "./statusEffects";
import { dropDeathTerrain, onRallyDeath } from "./enemyTerrain";
import { addPoise } from "./poise";

/**
 * 敵の性質（EnemyDef の任意フィールド）の処理: 死に際の置き土産・死骸・取り巻き・逃げ回り・マナの奪い合い。
 * behavior に依らない「足すだけで効く」性質をここに集め、enemies.ts の状態機械を太らせない
 */

const FULL_CIRCLE = Math.PI * 2;
/** 取り巻きを置く輪の半径 */
const PACK_RING = 20;
/** ai.stage: 取り巻きをまだ呼んでいない / 呼び終えた */
export const PACK_PENDING = 1;
export const PACK_DONE = 2;
const MANA_TEXT_COLOR = "#60a0ff";
const VANISH_TEXT = "逃走";

// -----------------------------------------------------------------------------
// 置き場所（壁に埋めない）
// -----------------------------------------------------------------------------

/** 空きを探す向きの数と、1 周ごとに広げる距離（px） */
const FREE_SPOT_DIRECTIONS = 16;
const FREE_SPOT_STEP = 2;
/** 空きを探す最大距離（px）。これより遠くへは動かさない */
export const FREE_SPOT_MAX_DIST = 48;

/**
 * pos から一番近い、半径 radius が壁に掛からない地点（決まった順に探すので決定的）。
 * pos がそのまま空いていれば pos。見つからなければ null。
 * すり抜ける敵（壁の中にいられる）の位置を代わりに使うと、取り巻き・寄生虫・蘇生体が壁に埋まるため、湧きの位置は必ずこれを通す
 */
export function findFreeSpot(
  state: GameState,
  pos: Vec,
  radius: number,
  maxDist = FREE_SPOT_MAX_DIST,
  step = FREE_SPOT_STEP,
): Vec | null {
  if (!overlapsWall(state, pos.x, pos.y, radius)) return { ...pos };
  for (let d = step; d <= maxDist; d += step) {
    for (let k = 0; k < FREE_SPOT_DIRECTIONS; k++) {
      const q = add(pos, scale(fromAngle((k / FREE_SPOT_DIRECTIONS) * FULL_CIRCLE), d));
      if (!overlapsWall(state, q.x, q.y, radius)) return q;
    }
  }
  return null;
}

/** 湧きの位置: want が空いていればそこ、だめなら fallback の近くの空き、それも無ければ fallback のまま */
export function spawnSpot(state: GameState, want: Vec, fallback: Vec, radius: number): Vec {
  if (!overlapsWall(state, want.x, want.y, radius)) return { ...want };
  return findFreeSpot(state, fallback, radius) ?? { ...fallback };
}

// -----------------------------------------------------------------------------
// 敵の弾
// -----------------------------------------------------------------------------

export interface EnemyBulletSpec {
  pos: Vec;
  dir: Vec;
  speed: number;
  damage: number;
  color: string;
  radius?: number;
  life?: number;
  /** 撃った敵（状態異常の付与元）。死に際の弾は付与元なし */
  sourceId?: number;
}

/** 敵弾を 1 発出す（射撃・扇・死に際の弾の共通） */
export function fireEnemyBullet(state: GameState, spec: EnemyBulletSpec): void {
  state.projectiles.push({
    id: allocId(state),
    owner: "enemy",
    pos: { ...spec.pos },
    vel: scale(spec.dir, spec.speed),
    radius: spec.radius ?? ENEMY_AI.volley.bulletRadius,
    damage: spec.damage,
    life: spec.life ?? ENEMY_AI.volley.bulletLife,
    color: spec.color,
    kind: "proc",
    hitIds: new Set(),
    pierceLeft: 0,
    sourceId: spec.sourceId,
  });
}

/** dir を中心に spreadDeg の扇で count 本の向きを返す（1 本なら dir そのもの） */
export function fanDirections(dir: Vec, count: number, spreadDeg: number): Vec[] {
  if (count <= 1) return [dir];
  const base = Math.atan2(dir.y, dir.x);
  const spread = (spreadDeg * Math.PI) / 180;
  const out: Vec[] = [];
  for (let i = 0; i < count; i++) out.push(fromAngle(base - spread / 2 + (spread * i) / (count - 1)));
  return out;
}

// -----------------------------------------------------------------------------
// 死に際
// -----------------------------------------------------------------------------

/** 配列から消す直前に 1 回。自爆・時間切れ（vanished）は置き土産を出さない */
export function onEnemyDeath(state: GameState, e: Enemy, def: EnemyDef): void {
  if (e.vanished) return;
  if (def.deathBurst) burstOnDeath(state, e, def);
  if (def.deathBomb) {
    const b = def.deathBomb;
    spawnBomb(state, e.body.pos, b.damage + depthDamageBonus(state.depth), e.id, b.fuse, b.radius);
  }
  returnMana(state, e, def);
  scatterFollowers(state, e, def);
  scheduleTwinRevive(state, e, def);
  leaveCorpse(state, e, def);
  dropDeathTerrain(state, e, def);
  onRallyDeath(state, e, def);
  crackEgg(state, e, def);
}

/** 群れの母の卵を割られると、母に怯み値が入る（範囲攻撃で卵を割りながら母を崩す） */
function crackEgg(state: GameState, e: Enemy, def: EnemyDef): void {
  if (def.behavior !== "egg") return;
  const mother = state.enemies.find((o) => o.id === e.leaderId && o.hp > 0);
  if (!mother) return;
  addPoise(state, mother, BOSS.broodMother.eggBreakPoise);
}

function burstOnDeath(state: GameState, e: Enemy, def: EnemyDef): void {
  const b = def.deathBurst;
  if (!b) return;
  const damage = b.damage + depthDamageBonus(state.depth);
  for (let i = 0; i < b.count; i++) {
    const dir = fromAngle((i / b.count) * FULL_CIRCLE + e.id);
    fireEnemyBullet(state, { pos: e.body.pos, dir, speed: b.speed, damage, color: b.color, life: ENEMY_AI.deathBurst.life });
  }
  pushSfx(state, "enemyShoot");
}

/** 奪われたマナ（マナ喰い）と結晶（結晶ダニ・結晶ゴーレム）をプレイヤーへ返す */
function returnMana(state: GameState, e: Enemy, def: EnemyDef): void {
  const stolen = (e.stolenMana ?? 0) * ENEMY_AI.manaLeech.returnMul;
  const amount = stolen + (def.deathMana ?? 0);
  if (amount <= 0) return;
  const gained = gainMana(state, amount);
  spawnLine(state, e.body.pos, state.player.body.pos, MANA_TEXT_COLOR, 0.3);
  spawnBurst(state, e.body.pos, MANA_TEXT_COLOR, 8, 80, 0.4, 1.5);
  if (gained > 0) addFloatingText(state, e.body.pos, `気力 +${Math.round(gained)}`, MANA_TEXT_COLOR, 1, 0.8);
}

/** 群れの長・楽団長が倒れると、取り巻きは怯えて逃げる */
function scatterFollowers(state: GameState, e: Enemy, def: EnemyDef): void {
  if (def.behavior !== "packLeader" && def.behavior !== "conductor") return;
  const fear = { kind: "fear" as const, stacks: 1, duration: ENEMY_AI.packLeader.fearTime, potency: 0 };
  for (const f of followersOf(state, e)) applyStatus(state, { kind: "enemy", enemy: f }, fear, "env");
}

// -----------------------------------------------------------------------------
// 死骸（骨拾い・墓守の鐘・貪食の）
// -----------------------------------------------------------------------------

function leaveCorpse(state: GameState, e: Enemy, def: EnemyDef): void {
  // 鐘の蘇生体は死骸を残さない（同じ死骸で蘇生を繰り返させない）
  if (def.boss || def.noCorpse || e.revived) return;
  state.corpses.push({
    id: allocId(state),
    defKey: def.key,
    pos: { ...e.body.pos },
    roomIndex: e.roomIndex,
    time: ENEMY_AI.corpse.lifetime,
    depth: state.depth,
  });
  // 古いものから捨てる（群れを大量に倒しても配列を膨らませない）
  if (state.corpses.length > ENEMY_AI.corpse.max) state.corpses.shift();
}

/** 死骸を古くする。階が変わったものは捨てる（floor.ts を触らずに片付くよう depth で見分ける） */
export function updateCorpses(state: GameState, dt: number): void {
  if (state.corpses.length === 0) return;
  for (const c of state.corpses) c.time -= dt;
  state.corpses = state.corpses.filter((c) => c.time > 0 && c.depth === state.depth);
}

/** 半径内で一番近い死骸（roomIndex を渡すとその部屋のものだけ） */
export function nearestCorpse(state: GameState, pos: Vec, radius: number, roomIndex?: number): Corpse | undefined {
  let best: Corpse | undefined;
  let bestD = radius;
  for (const c of state.corpses) {
    if (roomIndex !== undefined && c.roomIndex !== roomIndex) continue;
    const d = dist(pos, c.pos);
    if (d > bestD) continue;
    best = c;
    bestD = d;
  }
  return best;
}

export function consumeCorpse(state: GameState, corpse: Corpse): void {
  state.corpses = state.corpses.filter((c) => c.id !== corpse.id);
  spawnBurst(state, corpse.pos, "#a09080", 8, 60, 0.3, 1.5);
}

/** 死骸を蘇らせる（出現演出つき）。墓守の鐘が使う */
export function reviveCorpse(state: GameState, corpse: Corpse): Enemy {
  consumeCorpse(state, corpse);
  const def = enemyDef(corpse.defKey);
  const pos = findFreeSpot(state, corpse.pos, def.radius) ?? corpse.pos;
  const revived = createEnemy(state, def, pos, corpse.roomIndex, true);
  revived.revived = true;
  state.enemies.push(revived);
  return revived;
}

// -----------------------------------------------------------------------------
// 取り巻き（群れの長・楽団長・双子の影）
// -----------------------------------------------------------------------------

export function followersOf(state: GameState, leader: Enemy): Enemy[] {
  return state.enemies.filter((o) => o !== leader && o.hp > 0 && o.leaderId === leader.id);
}

/** 目を覚ましたときに 1 回だけ取り巻きを呼ぶ。取り巻き自身は呼ばない（双子の影の相方） */
export function spawnPackOnce(state: GameState, e: Enemy, def: EnemyDef): void {
  const ai = e.ai;
  const pack = def.pack;
  if (!ai || !pack || ai.stage !== PACK_PENDING) return;
  ai.stage = PACK_DONE;
  const minionDef = enemyDef(pack.minion);
  for (let i = 0; i < pack.count; i++) {
    const offset = scale(fromAngle((i / pack.count) * FULL_CIRCLE + e.id), PACK_RING);
    const want = add(e.body.pos, offset);
    const pos = spawnSpot(state, want, e.body.pos, minionDef.radius);
    const minion = createEnemy(state, minionDef, pos, e.roomIndex, true);
    minion.leaderId = e.id;
    // 蘇生体が連れた取り巻きも蘇生体と同じ扱い（取り巻き経由で稼がせない）
    if (e.revived) minion.revived = true;
    if (minion.ai) minion.ai.stage = PACK_DONE;
    state.enemies.push(minion);
    // 双子は互いを相方として持つ（どちらが倒れても残った方が蘇生の時計を持つ）
    if (def.behavior === "twinShade") e.leaderId = minion.id;
  }
}

// -----------------------------------------------------------------------------
// 双子の影: 片方が倒れて猶予内にもう片方を倒さないと蘇る
// -----------------------------------------------------------------------------

/** ai.move: 相方の蘇生待ち */
export const TWIN_REVIVE_PENDING = 1;
const TWIN_IDLE = 0;

function scheduleTwinRevive(state: GameState, e: Enemy, def: EnemyDef): void {
  if (def.behavior !== "twinShade" || e.leaderId === undefined) return;
  const partner = state.enemies.find((o) => o.id === e.leaderId && o.hp > 0);
  const ai = partner?.ai;
  if (!partner || !ai) return;
  const t = ENEMY_AI.twinShade;
  ai.move = TWIN_REVIVE_PENDING;
  ai.timer = t.reviveTime;
  ai.target = { ...e.body.pos };
  addFloatingText(state, partner.body.pos, `${t.reviveTime} 秒で蘇る`, t.color, 1, 1);
}

/** 生き残った方が蘇生の時計を進める。時間切れで相方が蘇る */
export function tickTwinRevive(state: GameState, e: Enemy, dt: number): void {
  const ai = e.ai;
  if (!ai || ai.move !== TWIN_REVIVE_PENDING) return;
  ai.timer -= dt;
  if (ai.timer > 0) return;
  ai.move = TWIN_IDLE;
  const def = enemyDef(e.defKey);
  const twin = createEnemy(state, def, findFreeSpot(state, ai.target, def.radius) ?? ai.target, e.roomIndex, true);
  twin.hp = Math.max(1, Math.round(twin.maxHp * ENEMY_AI.twinShade.reviveHpRatio));
  twin.lastHp = twin.hp;
  twin.leaderId = e.id;
  if (twin.ai) twin.ai.stage = PACK_DONE;
  e.leaderId = twin.id;
  state.enemies.push(twin);
  spawnBurst(state, ai.target, ENEMY_AI.twinShade.color, 14, 100, 0.4, 2);
}

// -----------------------------------------------------------------------------
// 逃げ回る（金色スライム）・群がる（腐肉蝿）
// -----------------------------------------------------------------------------

/** 逃げ回り、寿命が来たら消える。処理したら true（通常の AI を回さない） */
export function updateTimid(state: GameState, e: Enemy, def: EnemyDef, dt: number): boolean {
  const timid = def.timid;
  const ai = e.ai;
  // 出現中・未発見のうちは通常の状態機械に任せる（idle → chase の遷移は enemies.ts が行う）
  if (!timid || !ai || e.phase === "spawning" || e.phase === "idle") return false;
  ai.timer += dt;
  if (ai.timer >= timid.lifetime) {
    vanish(state, e);
    return true;
  }
  const away = normalize(sub(e.body.pos, state.player.body.pos), { x: 1, y: 0 });
  // 壁に沿って逃げ続けられるよう、少し横へ逸らす
  const side = e.id % 2 === 0 ? 1 : -1;
  const move = normalize(add(away, scale({ x: -away.y, y: away.x }, side * 0.6)));
  const speed = def.speed * ENEMY_AI.timid.fleeMul;
  moveEnemy(state, e, def, move.x * speed * dt, move.y * speed * dt);
  if (move.x !== 0) e.facing = move;
  return true;
}

/** 消える（撃破ではない）。報酬も死骸も出さない */
export function vanish(state: GameState, e: Enemy): void {
  e.vanished = true;
  e.hp = 0;
  spawnBurst(state, e.body.pos, ENEMY_AI.timid.color, 12, 90, 0.4, 2);
  addFloatingText(state, e.body.pos, VANISH_TEXT, ENEMY_AI.timid.color, 1, 0.8);
}

/** プレイヤーが特定の状態異常のとき足が速くなる */
export function frenzyMul(state: GameState, def: EnemyDef): number {
  const f = def.frenzy;
  if (!f) return 1;
  return f.vs.some((k) => hasStatus(state.player.status, k)) ? f.speedMul : 1;
}

// -----------------------------------------------------------------------------
// マナ喰い
// -----------------------------------------------------------------------------

/** 噛みついた相手のマナを奪って体に溜める（倒せば returnMul 倍で戻る） */
export function stealMana(state: GameState, e: Enemy): void {
  const p = state.player;
  const amount = Math.min(p.mana, ENEMY_AI.manaLeech.steal);
  if (amount <= 0) return;
  p.mana -= amount;
  e.stolenMana = (e.stolenMana ?? 0) + amount;
  addFloatingText(state, p.body.pos, `気力 -${Math.round(amount)}`, MANA_TEXT_COLOR, 1, 0.8);
  spawnLine(state, p.body.pos, e.body.pos, MANA_TEXT_COLOR, 0.3);
}

