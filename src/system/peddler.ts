import { type Enemy, type GameState, type Merchant, pushLog } from "../core/state";
import { type Vec, dist, normalize, sub } from "../core/vec";
import { depthDamage, enemyDef } from "../data/enemies";
import { ECONOMY, ROAM } from "../data/tuning";
import { TILE_SIZE } from "../map/grid";
import { lineOfSight, nextWaypoint } from "../map/pathing";
import { addFloatingText } from "./effects";
import { moveEnemy } from "./enemies";
import { overlapsWall } from "./physics";
import { corridorTileList, pickRoamTarget } from "./spawner";
import { isHalted } from "./statusEffects";
import { isAllied } from "./rules";

/**
 * 旅商人（MerchantKind "peddler"。docs/ideas/economy-impl.md 2-5）の体の動き。台座・値段・倒れた後は system/merchants.ts。
 * - 階の通路に出て、徘徊と同じ行き先の選び方（spawner.ts の pickRoamTarget）で塊から塊へ歩く
 * - プレイヤーが近づくと足を止めて店を広げる（以後は動かない）。広げるまでは台座を出さず売らない
 * - 気付いている敵のそばにいると傷を負う（敵は商人を狙わないので、戦いに巻き込まれたときだけ）。倒れると品が床に落ちる
 * - 近くで敵を倒すと「助けた」ことになり、このランの値段が下がる
 * 乱数は state.rng だけ（出る位置と歩く先）。呼び出し順は updateMerchants で固定
 */

const HELP_LINE = "助けてくれ";
const HELP_LOG = "旅商人が敵に襲われている。";
const TEXT_LIFT = 10;
const TEXT_SCALE = 1;
const TEXT_LIFE = 1.4;
/** 襲われたときの白い点滅（秒）。combat.ts の ENEMY_HIT_FLASH と同じ長さ */
const HURT_FLASH = 0.09;
/** 1 ステップで期待する移動量のこの割合より進めていなければ詰まりとみなす（spawner.ts の徘徊と同じ） */
const STUCK_PROGRESS_RATIO = 0.3;
/** 台座を置く点が壁に掛からないか見る半径（px） */
const SPOT_CLEARANCE = 4;

// -----------------------------------------------------------------------------
// 出る位置・歩く
// -----------------------------------------------------------------------------

function tileCenter(state: GameState, index: number): Vec {
  return { x: ((index % state.map.width) + 0.5) * TILE_SIZE, y: (Math.floor(index / state.map.width) + 0.5) * TILE_SIZE };
}

/**
 * 旅商人の出る位置: プレイヤーから minStartDist 以上離れた通路タイルの中心（rng 1 回）。
 * そういう通路が無ければ塊の中心（pickRoamTarget）。壁に掛かるなら出さない（null）
 */
export function peddlerStart(state: GameState, radius: number): Vec | null {
  const p = state.player.body.pos;
  const far = corridorTileList(state)
    .map((t) => tileCenter(state, t))
    .filter((pos) => dist(pos, p) >= ECONOMY.market.peddler.minStartDist && !overlapsWall(state, pos.x, pos.y, radius));
  const pos = far.length > 0 ? far[state.rng.int(0, far.length - 1)] : pickRoamTarget(state);
  if (!pos || overlapsWall(state, pos.x, pos.y, radius)) return null;
  return pos;
}

/** 歩く先を選び直す（rng 1 回） */
export function retargetPeddler(state: GameState, m: Merchant, e: Enemy): void {
  m.roam = pickRoamTarget(state) ?? { ...e.body.pos };
  m.roamStuck = 0;
}

/** 歩く先へ距離場を下る（spawner.ts の徘徊と同じ歩き方。速さだけ ECONOMY.market.peddler.speed） */
function walk(state: GameState, m: Merchant, e: Enemy, dt: number): void {
  const goal = m.roam;
  if (!goal || isHalted(e)) return;
  const next = dist(e.body.pos, goal) <= ROAM.reach ? null : nextWaypoint(state.map, e.body.pos, goal);
  if (!next) {
    retargetPeddler(state, m, e);
    return;
  }
  const dir = normalize(sub(next, e.body.pos));
  const speed = ECONOMY.market.peddler.speed;
  const before = { ...e.body.pos };
  moveEnemy(state, e, enemyDef(e.defKey), dir.x * speed * dt, dir.y * speed * dt);
  if (dir.x !== 0) e.facing = dir;
  const moved = dist(before, e.body.pos);
  m.roamStuck = moved < speed * dt * STUCK_PROGRESS_RATIO ? (m.roamStuck ?? 0) + dt : 0;
  if (m.roamStuck >= ROAM.stuckTime) retargetPeddler(state, m, e);
}

/** 名札・台座・倒れた後の品の位置を体に合わせる（店を広げるまで） */
function follow(m: Merchant, e: Enemy): void {
  m.pos = { ...e.body.pos };
  for (const w of m.wares) w.pos = { ...e.body.pos };
}

// -----------------------------------------------------------------------------
// 店を広げる
// -----------------------------------------------------------------------------

/**
 * 立ち位置のまわりに n 個の台座を置ける点（下の行 → 上の行 → 右の列 → 左の列の順。間隔は offerSpacing タイル）。
 * どの並びも壁に掛かる・見通せないなら null（通路の途中では広げず、歩き続ける）
 */
export function stallAround(state: GameState, center: Vec, n: number): Vec[] | null {
  const s = ECONOMY.market.offerSpacing;
  const along = Array.from({ length: n }, (_, i) => (i - (n - 1) / 2) * s);
  const patterns: Vec[][] = [
    along.map((o) => ({ x: o, y: 1 })),
    along.map((o) => ({ x: o, y: -1 })),
    along.map((o) => ({ x: 1, y: o })),
    along.map((o) => ({ x: -1, y: o })),
  ];
  for (const pattern of patterns) {
    const spots = pattern.map((o) => ({ x: center.x + o.x * TILE_SIZE, y: center.y + o.y * TILE_SIZE }));
    if (spots.every((p) => !overlapsWall(state, p.x, p.y, SPOT_CLEARANCE) && lineOfSight(state.map, center, p))) return spots;
  }
  return null;
}

/** プレイヤーが openRange まで近づいたら足を止めて台座を並べる。広げたら true */
function tryOpen(state: GameState, m: Merchant, e: Enemy): boolean {
  if (dist(state.player.body.pos, e.body.pos) > ECONOMY.market.peddler.openRange) return false;
  const spots = stallAround(state, e.body.pos, m.wares.length);
  if (!spots) return false;
  m.wares.forEach((w, i) => {
    w.pos = spots[i] ?? { ...e.body.pos };
    w.armed = false;
  });
  m.pos = { ...e.body.pos };
  m.open = true;
  delete m.roam;
  delete m.roamStuck;
  return true;
}

// -----------------------------------------------------------------------------
// 襲われる・助けられる
// -----------------------------------------------------------------------------

/** 旅商人を襲う敵か: 気付いている（idle・出現中でない）敵。商人・壺・木箱は襲わない */
function hostile(state: GameState, o: Enemy): boolean {
  // 従魔（眷属）は商人を襲わない（従魔の狙いからも商人は外している）
  if (isAllied(state, o)) return false;
  const def = enemyDef(o.defKey);
  return def.merchant !== true && def.container === undefined && o.phase !== "idle" && o.phase !== "spawning";
}

/**
 * 気付いている敵の体が threatPad まで近いと、1 体あたり hurtDps（深度で伸びる）の傷を負う。
 * 敵の撃破にはしない（プレイヤーの撃破数・得点・起点に数えない）。生命が 0 になった体は updateEnemies が片付け、
 * 次の updateMerchants が倒れた旅商人として品を床に落とす
 */
function mauled(state: GameState, m: Merchant, e: Enemy, dt: number): void {
  if (dt <= 0) return;
  const pad = ECONOMY.market.peddler.threatPad;
  let attackers = 0;
  for (const o of state.enemies) {
    if (o === e || o.hp <= 0 || !hostile(state, o)) continue;
    if (dist(o.body.pos, e.body.pos) <= o.body.radius + e.body.radius + pad) attackers += 1;
  }
  if (attackers === 0) return;
  e.hp = Math.max(0, e.hp - depthDamage(ECONOMY.market.peddler.hurtDps, state.depth) * attackers * dt);
  e.hitFlash = HURT_FLASH;
  if (m.alarmed) return;
  m.alarmed = true;
  addFloatingText(state, { x: e.body.pos.x, y: e.body.pos.y - TEXT_LIFT }, HELP_LINE, ECONOMY.market.color, TEXT_SCALE, TEXT_LIFE);
  pushLog(state, HELP_LOG, ECONOMY.market.color);
}

/** このステップに、旅商人から saveRadius 以内でプレイヤーが敵を倒したか（state.events の onKill。商人の撃破は数えない） */
export function killedNear(state: GameState, e: Enemy): boolean {
  const r = ECONOMY.market.peddler.saveRadius;
  return state.events.some((ev) => {
    if (ev.kind !== "onKill" || ev.actor !== "player" || ev.targetId === e.id) return false;
    if (ev.targetKey !== undefined && enemyDef(ev.targetKey).merchant === true) return false;
    return dist(ev.pos, e.body.pos) <= r;
  });
}

/**
 * 怒っていない旅商人の 1 ステップ: 襲われる → 店を広げていなければ歩いて体に品を合わせ、近づかれたら広げる。
 * 助けたかどうかの判定（killedNear）は値段を書き直す merchants.ts が行う
 */
export function updatePeddler(state: GameState, m: Merchant, e: Enemy, dt: number): void {
  mauled(state, m, e, dt);
  if (m.open !== false || e.hp <= 0) return;
  walk(state, m, e, dt);
  follow(m, e);
  tryOpen(state, m, e);
}
