import { type EliteKind, type EliteWork, type Enemy, type GameState, type Projectile, pushSfx } from "../core/state";
import type { StatusKind } from "../core/status";
import { type Vec, add, dist, fromAngle, length, normalize, scale, sub } from "../core/vec";
import { type EnemyDef, enemyDef } from "../data/enemies";
import { ELITE, ENEMY_AI, POISE } from "../data/tuning";
import { comboMultiplier, damageEnemy } from "./combat";
import { addPoise, applyStagger, elitePoiseMul, isStaggered } from "./poise";
import { addFloatingText, spawnBurst, spawnRing } from "./effects";
import { segmentCircleHit, spawnBomb, spawnShockwave } from "./hazards";
import { dropItem, enemyDropChance } from "./loot";
import { applyOnHitStatus, applyStatus, findStatus } from "./statusEffects";
import { createEnemy } from "./enemies";
import { consumeCorpse, nearestCorpse, spawnSpot } from "./enemyTraits";
import { bossArmorBlocks, bossReflects, bossTakenMul } from "./boss";
import { rallyTakenMul, seedTerrain } from "./enemyTerrain";
import { placeTerrain } from "./terrain";
import { manaRegenAllowed } from "./keystones";

/** エリート修飾子と、盾・反射など「被弾の前に割り込む」処理 */

export const ELITE_KINDS: readonly EliteKind[] = [
  "explosive",
  "reflective",
  "shielded",
  "hasted",
  "linked",
  "echoing",
  "contagious",
  "bulwark",
  "retaliating",
  "prismatic",
  "timed",
  "parasitic",
  "anchored",
  "devouring",
  "packed",
  "searing",
  "hexing",
  "commanding",
  "evasive",
  "chaining",
];

export const ELITE_COLOR: Readonly<Record<EliteKind, string>> = {
  explosive: "#ff8030",
  reflective: "#e0e0ff",
  shielded: "#60a0ff",
  hasted: "#ffe040",
  linked: "#ff80ff",
  echoing: "#b090ff",
  contagious: "#80ff60",
  bulwark: "#c0a070",
  retaliating: "#ff5050",
  prismatic: "#ff90d0",
  timed: "#ffffff",
  parasitic: "#a0c040",
  anchored: "#8090a0",
  devouring: "#c04060",
  packed: "#f0a040",
  searing: "#ff6020",
  hexing: "#a060ff",
  commanding: "#ffd040",
  evasive: "#80ffe0",
  chaining: "#a0e0ff",
};

export const ELITE_PREFIX: Readonly<Record<EliteKind, string>> = {
  explosive: "爆裂の",
  reflective: "反射の",
  shielded: "障壁の",
  hasted: "迅速の",
  linked: "連結の",
  echoing: "残響の",
  contagious: "伝染の",
  bulwark: "堅牢の",
  retaliating: "報復の",
  prismatic: "分光の",
  timed: "刻限の",
  parasitic: "寄生の",
  anchored: "不動の",
  devouring: "貪食の",
  packed: "群長の",
  searing: "灼熱の",
  hexing: "封魔の",
  commanding: "号令の",
  evasive: "見切りの",
  chaining: "鎖縛の",
};

/**
 * 深層で 2 つ重なる修飾子の組（docs/ideas/enemies.md 4-A の相乗）。1 つ目が主（動きを持つ側）、2 つ目が添え。
 * 炎の柱（灼熱の + 不動の）: 動かず、足元に炎の輪を置き続ける地形になる（S9）
 * 封魔の障壁（封魔の + 障壁の）: 障壁がある間、輪の中のマナが減っていく
 * 逃げ足（見切りの + 迅速の）: 大技への反応が倍の頻度・遠くへ跳ぶ（S6 の簡略）
 */
export const ELITE_PAIRS: readonly (readonly [EliteKind, EliteKind])[] = [
  ["searing", "anchored"],
  ["hexing", "shielded"],
  ["evasive", "hasted"],
];

/** 主の修飾子か、深層で重なった 2 つ目か */
export function hasElite(e: Enemy, kind: EliteKind): boolean {
  return e.elite === kind || e.eliteExtra === kind;
}

/** 見切りの跳びで出す速さ（px あたり。enemies.ts のノックバックの減衰 12/秒に合わせる） */
const EVADE_KNOCK_PER_PX = 12;
/** 灼熱のが自分の炎で焼けないよう、燃焼の免疫を毎ステップ掛け直す秒 */
const SEARING_SELF_IMMUNE = 0.5;
/** 鎖縛のの鎖に触れたときの冷気 */
const CHAIN_CHILL_STACKS = 1;

const DEG_TO_RAD = Math.PI / 180;
const BLOCK_TEXT = "ブロック";
const BREAK_TEXT = "破壊";
const GUARD_BREAK_TEXT = "ガードブレイク";
const ROUT_TEXT = "敗走";
const NULLIFY_TEXT = "無効";
const TIMED_OUT_TEXT = "刻限";
const DEVOUR_TEXT = "貪った";
const BLOCK_PARTICLES = 6;
const GUARD_BREAK_PARTICLES = 10;
const REFLECT_PARTICLES = 5;
const LINK_MIN_MEMBERS = 2;
const FULL_CIRCLE = Math.PI * 2;
/** 分光のが免疫を持たない種類（怯みと堅守は怯みの仕組みの一部なので） */
const PRISM_EXEMPT: ReadonlySet<StatusKind> = new Set<StatusKind>(["stagger", "guarded"]);
/** 黒鉄騎士が盾を割られたときの脆弱と恐怖の秒 */
const ROUT_TIME = 5;

export function eliteChance(depth: number): number {
  if (depth < ELITE.minDepth) return 0;
  return Math.min(ELITE.maxChance, ELITE.baseChance + (depth - ELITE.minDepth) * ELITE.chancePerDepth);
}

/** 生成直後の敵に確率でエリート修飾子を付ける。取り巻き・部屋主の付き物（抽選に出ない敵）は付けない */
export function rollElite(state: GameState, e: Enemy): void {
  const def = enemyDef(e.defKey);
  if (def.boss || def.weight <= 0) return;
  if (!state.rng.chance(eliteChance(state.depth))) return;
  const allowed = eliteKindsFor(def);
  if (state.depth >= ELITE.pairMinDepth && state.rng.chance(ELITE.pairChance)) {
    const pairs = ELITE_PAIRS.filter(([a, b]) => allowed.includes(a) && allowed.includes(b));
    if (pairs.length > 0) {
      const [main, extra] = state.rng.pick(pairs);
      makeElitePair(e, main, extra);
      return;
    }
  }
  makeElite(e, state.rng.pick(allowed));
}

/** 2 つ重ねる（主を付けてから、添えの下ごしらえだけを足す。HP の倍率は 1 回だけ） */
export function makeElitePair(e: Enemy, main: EliteKind, extra: EliteKind): void {
  makeElite(e, main);
  e.eliteExtra = extra;
  prepareElite(e, extra);
}

/** 群長のが複製すると報酬が増えすぎる敵（部屋主・金色スライムはドロップ確定） */
const NO_PACKED_CLONE: readonly EliteKind[] = ELITE_KINDS.filter((k) => k !== "packed");

/** その敵に付けられる修飾子。確定ドロップの敵は群長の（同じ敵を連れて湧く）を外す */
export function eliteKindsFor(def: EnemyDef): readonly EliteKind[] {
  return def.lairMaster || def.timid ? NO_PACKED_CLONE : ELITE_KINDS;
}

function createWork(): EliteWork {
  return { timer: 0, count: 0, wasStaggered: false, initialized: false };
}

/** 修飾子の作業領域（無ければ作る） */
function workOf(e: Enemy): EliteWork {
  if (!e.eliteWork) e.eliteWork = createWork();
  return e.eliteWork;
}

export function makeElite(e: Enemy, kind: EliteKind): void {
  e.elite = kind;
  e.eliteWork = createWork();
  e.poise.max *= elitePoiseMul(kind);
  // 被弾していた敵がエリートになっても満タンに戻さない（連結の相方・呪いの追加抽選。HP の割合を保つ）
  const ratio = e.maxHp > 0 ? Math.min(1, e.hp / e.maxHp) : 1;
  const hp = Math.round(e.maxHp * ELITE.hpMul);
  e.maxHp = hp;
  e.hp = Math.max(1, Math.round(hp * ratio));
  prepareElite(e, kind);
}

/** 修飾子ごとの下ごしらえ（主でも添えでも同じ） */
function prepareElite(e: Enemy, kind: EliteKind): void {
  // 堅牢の: 怯みにくい代わりに、怯むと長く脆い（updateElites）
  if (kind === "bulwark") e.poise.max *= ELITE.bulwarkPoiseMul;
  if (kind === "timed" && e.eliteWork) e.eliteWork.timer = ELITE.timedClock;
  if (kind === "shielded") {
    // シールドは hp に上乗せして持つ（被ダメ処理を変えずに 2 段階にできる）
    const shield = Math.round((e.maxHp - (e.shieldMax ?? 0)) * ELITE.shieldRatio);
    e.shieldMax = shield;
    e.maxHp += shield;
    e.hp += shield;
  }
  e.lastHp = e.hp;
}

/** Linked が部屋に 1 体しかいなければ、同じ部屋の通常敵を 1 体相方にする */
export function finalizeLinks(state: GameState, roomIndex: number): void {
  const inRoom = state.enemies.filter((e) => e.roomIndex === roomIndex && e.hp > 0);
  const linked = inRoom.filter((e) => e.elite === "linked");
  if (linked.length !== 1) return;
  const partner = inRoom.find((e) => !e.elite && !enemyDef(e.defKey).boss);
  if (partner) {
    makeElite(partner, "linked");
    return;
  }
  // 相方がいないなら意味がないので Hasted に差し替える
  const solo = linked[0];
  if (!solo) return;
  // 迅速は耐性据え置きなので、連結で掛けた倍率を戻す
  solo.poise.max /= elitePoiseMul("linked");
  solo.elite = "hasted";
}

/** 刻限の時計が切れた（迅速と同じ速さになる） */
function timedOut(e: Enemy): boolean {
  return e.elite === "timed" && (e.eliteWork?.timer ?? 1) <= 0;
}

export function eliteSpeedMul(e: Enemy): number {
  // 炎の柱（灼熱の + 不動の）はその場に根を張る
  if (hasElite(e, "searing") && hasElite(e, "anchored")) return 0;
  if (hasElite(e, "hasted") || timedOut(e)) return ELITE.speedMul;
  if (hasElite(e, "anchored")) return ELITE.anchoredSpeedMul;
  return 1;
}

export function eliteWindupMul(e: Enemy): number {
  return hasElite(e, "hasted") || timedOut(e) ? ELITE.windupMul : 1;
}

/** 不動の: ノックバック・引き寄せ・壁叩きつけが効かない */
export function eliteKnockImmune(e: Enemy): boolean {
  return hasElite(e, "anchored");
}

/**
 * 残響の: 攻撃を終えたら 1 回だけ同じ攻撃を繰り返す。繰り返すなら true。
 * count を「繰り返し済み」の印に使い、繰り返しの後は通常の隙へ戻す
 */
export function takeEliteEcho(e: Enemy): boolean {
  if (e.elite !== "echoing") return false;
  const w = workOf(e);
  if (w.count > 0) {
    w.count = 0;
    return false;
  }
  w.count = 1;
  return true;
}

/** 残りシールド量（Shielded 以外は 0） */
export function shieldLeft(e: Enemy): number {
  const max = e.shieldMax ?? 0;
  if (max <= 0) return 0;
  return Math.max(0, e.hp - (e.maxHp - max));
}

export function eliteDisplayName(e: Enemy): string {
  const name = enemyDef(e.defKey).name;
  if (!e.elite) return name;
  // 刻限の は残り秒を名前に添える（時計が頭上に見える）
  const timer = e.elite === "timed" && !timedOut(e) ? ` ${Math.ceil(e.eliteWork?.timer ?? 0)}` : "";
  const extra = e.eliteExtra ? ELITE_PREFIX[e.eliteExtra] : "";
  return `${ELITE_PREFIX[e.elite]}${extra}${name}${timer}`;
}

/** 毎ステップ、敵の行動より前に呼ぶ: シールド破壊と Linked の HP 共有、追加の修飾子の時間経過 */
export function updateElites(state: GameState, dt = 0): void {
  for (const e of state.enemies) {
    if (e.shieldMax && e.shieldMax > 0 && e.hp <= e.maxHp - e.shieldMax) breakShield(state, e);
  }
  shareLinkedDamage(state);
  shareLinkedStatus(state);
  for (const e of state.enemies) e.lastHp = e.hp;
  // 群長のが取り巻きを足すので、走査は開始時点の配列で行う
  for (const e of [...state.enemies]) {
    if (e.hp <= 0 || !e.elite || e.phase === "spawning") continue;
    tickEliteWork(state, e, dt);
  }
}

function tickEliteWork(state: GameState, e: Enemy, dt: number): void {
  const w = workOf(e);
  const staggered = isStaggered(e);
  const justStaggered = staggered && !w.wasStaggered;
  w.wasStaggered = staggered;
  switch (e.elite) {
    case "bulwark":
      if (justStaggered) bulwarkBreak(state, e);
      return;
    case "retaliating":
      tickRetaliate(state, e, w, justStaggered, dt);
      return;
    case "prismatic":
      prismGuard(e);
      return;
    case "timed":
      tickTimed(state, e, w, dt);
      return;
    case "packed":
      if (!w.initialized) spawnPacked(state, e, w);
      return;
    case "devouring":
      devourNearby(state, e);
      return;
    case "searing":
      tickSearing(state, e, w, dt);
      return;
    case "hexing":
      tickHexing(state, e, dt);
      return;
    case "evasive":
      tickEvasive(state, e, w, dt);
      return;
    case "chaining":
      tickChaining(state, e, w, dt);
      return;
    default:
      return;
  }
}

// -----------------------------------------------------------------------------
// Wave 3 の修飾子（灼熱の / 封魔の / 号令の / 見切りの / 鎖縛の）
// -----------------------------------------------------------------------------

/** 灼熱の: 通った跡が燃える（自分の炎では焼けない）。不動のと重なると足元に炎の輪を置き続ける */
function tickSearing(state: GameState, e: Enemy, w: EliteWork, dt: number): void {
  e.status.immune.burn = Math.max(e.status.immune.burn ?? 0, SEARING_SELF_IMMUNE);
  w.timer -= dt;
  if (w.timer > 0) return;
  if (hasElite(e, "anchored")) {
    w.timer = ELITE.pyreInterval;
    seedTerrain(state, e.body.pos, "fire", ELITE.pyreRadius);
    return;
  }
  w.timer = ELITE.searingInterval;
  // 足元ではなく少し後ろに置く（跡が燃える。正面から殴る人は焼けない）
  const back = { x: e.body.pos.x - e.facing.x * e.body.radius * 2, y: e.body.pos.y - e.facing.y * e.body.radius * 2 };
  placeTerrain(state, back.x, back.y, "fire", ELITE.searingRadius, ELITE.searingDuration);
}

/** 封魔の: 輪の中ではマナの自然回復が止まる（回復した分を打ち消す）。障壁のと重なると障壁がある間は減っていく */
function tickHexing(state: GameState, e: Enemy, dt: number): void {
  const p = state.player;
  if (dist(p.body.pos, e.body.pos) > ELITE.hexRadius) return;
  const regen = manaRegenAllowed(state) && p.mana < state.stats.maxMana ? state.stats.manaRegen * dt : 0;
  const drain = hasElite(e, "shielded") && shieldLeft(e) > 0 ? ELITE.hexDrain * dt : 0;
  p.mana = Math.max(0, p.mana - regen - drain);
}

/** 見切りの: 溜め攻撃・スキルの発動に反応して横へ跳ぶ（間隔つき）。迅速のと重なると頻度も距離も増える */
function tickEvasive(state: GameState, e: Enemy, w: EliteWork, dt: number): void {
  w.timer = Math.max(0, w.timer - dt);
  if (w.timer > 0 || e.phase === "windup" || e.phase === "strike") return;
  const cast = state.events.some((ev) => ev.kind === "onSkillCast" && ev.actor === "player");
  if (!cast && !state.player.attack.charging) return;
  const fast = hasElite(e, "hasted");
  w.timer = ELITE.evadeCooldown * (fast ? ELITE.evadeHasteCooldownMul : 1);
  const to = normalize(sub(state.player.body.pos, e.body.pos));
  const side = e.id % 2 === 0 ? 1 : -1;
  const perp = { x: -to.y * side, y: to.x * side };
  const distPx = ELITE.evadeDist * (fast ? ELITE.evadeHasteDistMul : 1);
  e.knock = scale(perp, distPx * EVADE_KNOCK_PER_PX);
  spawnBurst(state, e.body.pos, ELITE_COLOR.evasive, 6, 60, 0.25, 1.5);
}

/**
 * 鎖縛の: 近くの敵と光の鎖で結ばれる（chainPartners）。鎖に触れると冷気。
 * 鎖は感電を伝える（感電の付いた鎖の端から、つながった全員へ。連結のと同じ作り）
 */
function tickChaining(state: GameState, e: Enemy, w: EliteWork, dt: number): void {
  const partners = chainPartners(state, e);
  w.timer = Math.max(0, w.timer - dt);
  const p = state.player.body;
  for (const o of partners) {
    if (w.timer <= 0 && segmentCircleHit(e.body.pos, o.body.pos, ELITE.chainWidth, p.pos, p.radius)) {
      w.timer = ELITE.chainTouchIcd;
      const chill = { kind: "chill" as const, stacks: CHAIN_CHILL_STACKS, duration: ELITE.chainChillTime, potency: 0 };
      applyStatus(state, { kind: "player" }, chill, "enemy");
    }
  }
  const members = [e, ...partners];
  const shocked = members.map((m) => findStatus(m.status, "shock")).find((s) => s !== undefined);
  if (!shocked) return;
  for (const m of members) {
    if (findStatus(m.status, "shock")) continue;
    const apply = { kind: "shock" as const, stacks: shocked.stacks, duration: shocked.time, potency: shocked.potency };
    applyStatus(state, { kind: "enemy", enemy: m }, apply, "env");
  }
}

/** 鎖縛のの鎖でつながった敵（近い順、同じ部屋のボス以外。描画もこれを読む） */
export function chainPartners(state: GameState, e: Enemy): Enemy[] {
  if (!hasElite(e, "chaining")) return [];
  return state.enemies
    .filter((o) => o !== e && o.hp > 0 && o.phase !== "spawning" && !o.hidden && o.roomIndex === e.roomIndex && !enemyDef(o.defKey).boss)
    .map((o) => ({ o, d: dist(o.body.pos, e.body.pos) }))
    .filter((x) => x.d <= ELITE.chainRadius)
    .sort((a, b) => a.d - b.d || a.o.id - b.o.id)
    .slice(0, ELITE.chainCount)
    .map((x) => x.o);
}

/**
 * 号令の: 自分が予備動作に入った瞬間、周りで攻撃を待っている敵も一斉に予備動作へ入れる。
 * begin は enemies.ts の予備動作の入口（循環 import を避けて引数で受ける）
 */
export function commandNearby(state: GameState, e: Enemy, begin: (o: Enemy, def: EnemyDef) => void): void {
  if (!hasElite(e, "commanding")) return;
  let count = 0;
  for (const o of state.enemies) {
    if (o === e || o.hp <= 0 || o.phase !== "chase" || o.hidden) continue;
    if (o.attackCooldown > ELITE.commandCooldownMax || dist(o.body.pos, e.body.pos) > ELITE.commandRadius) continue;
    const def = enemyDef(o.defKey);
    if (def.boss || def.speed <= 0) continue;
    o.attackCooldown = 0;
    begin(o, def);
    count += 1;
  }
  if (count > 0) spawnRing(state, e.body.pos, ELITE.commandRadius, ELITE_COLOR.commanding, 0.35);
}

/** 堅牢の: 怯んだ瞬間、怯みを延ばして脆弱を付ける（溜め切った見返り） */
function bulwarkBreak(state: GameState, e: Enemy): void {
  const stagger = findStatus(e.status, "stagger");
  if (stagger) stagger.time *= ELITE.bulwarkStaggerMul;
  const vulnerable = { kind: "vulnerable" as const, stacks: 1, duration: ELITE.bulwarkVulnerableTime, potency: 0 };
  applyStatus(state, { kind: "enemy", enemy: e }, vulnerable, "env");
  addFloatingText(state, e.body.pos, GUARD_BREAK_TEXT, ELITE_COLOR.bulwark, 1.2, 0.8);
}

/** 報復の: 怯んだ瞬間に輪の予告を出し、少し後に衝撃波を返す */
function tickRetaliate(state: GameState, e: Enemy, w: EliteWork, justStaggered: boolean, dt: number): void {
  if (justStaggered) {
    w.timer = ELITE.retaliateDelay;
    spawnRing(state, e.body.pos, ELITE.retaliateRadius, ELITE_COLOR.retaliating, ELITE.retaliateDelay);
    return;
  }
  if (w.timer <= 0) return;
  w.timer -= dt;
  if (w.timer > 0) return;
  spawnShockwave(state, e.body.pos, ELITE.retaliateRadius, ELITE.retaliateDamage, e.id);
  spawnBurst(state, e.body.pos, ELITE_COLOR.retaliating, 12, 110, 0.35, 2);
}

/** 分光の: 付いている状態異常の種類に、しばらく付け直せない免疫を持つ */
function prismGuard(e: Enemy): void {
  const immune = e.status.immune;
  for (const effect of e.status.effects) {
    if (effect.time <= 0 || PRISM_EXEMPT.has(effect.kind)) continue;
    if ((immune[effect.kind] ?? 0) > 0) continue;
    immune[effect.kind] = ELITE.prismaticImmune;
  }
}

/** 刻限の: 時計が切れたら迅速と同じ速さになり、怯みにくくなる */
function tickTimed(state: GameState, e: Enemy, w: EliteWork, dt: number): void {
  if (w.timer <= 0) return;
  w.timer -= dt;
  if (w.timer > 0) return;
  e.poise.max *= ELITE.timedPoiseMul;
  addFloatingText(state, e.body.pos, TIMED_OUT_TEXT, ELITE_COLOR.timed, 1.3, 1);
  spawnRing(state, e.body.pos, 30, ELITE_COLOR.timed, 0.4);
  pushSfx(state, "enemyWindup");
}

/** 群長の: 同じ種類の小型を連れて湧く（小型はエリートではない） */
function spawnPacked(state: GameState, e: Enemy, w: EliteWork): void {
  w.initialized = true;
  const def = enemyDef(e.defKey);
  for (let i = 0; i < ELITE.packedCount; i++) {
    const want = add(e.body.pos, scale(fromAngle((i / ELITE.packedCount) * FULL_CIRCLE + e.id), ELITE.packedOffset));
    const pos = spawnSpot(state, want, e.body.pos, def.radius);
    const small = createEnemy(state, def, pos, e.roomIndex, true);
    small.maxHp = Math.max(1, Math.round(small.maxHp * ELITE.packedHpRatio));
    small.hp = small.maxHp;
    small.lastHp = small.hp;
    state.enemies.push(small);
  }
}

/** 貪食の: 近くの死骸を吸って回復する */
function devourNearby(state: GameState, e: Enemy): void {
  if (e.hp >= e.maxHp) return;
  const corpse = nearestCorpse(state, e.body.pos, ELITE.devourRange, e.roomIndex);
  if (!corpse) return;
  consumeCorpse(state, corpse);
  e.hp = Math.min(e.maxHp, e.hp + Math.round(e.maxHp * ELITE.devourHeal));
  e.lastHp = e.hp;
  addFloatingText(state, e.body.pos, DEVOUR_TEXT, ELITE_COLOR.devouring, 1, 0.8);
}

function breakShield(state: GameState, e: Enemy): void {
  const max = e.shieldMax ?? 0;
  e.maxHp -= max;
  e.shieldMax = 0;
  addFloatingText(state, e.body.pos, BREAK_TEXT, ELITE_COLOR.shielded, 1.3, 0.8);
  spawnBurst(state, e.body.pos, ELITE_COLOR.shielded, 14, 120, 0.4, 2);
  pushSfx(state, "hitHeavy");
  if (e.hp <= 0 || e.phase === "spawning") return;
  applyStagger(state, e, ELITE.shieldBreakStagger);
}

/**
 * 同じ部屋の Linked は受けた「最大 HP に対する割合」を全員で共有する。
 * 前ステップからの減少ぶんを集計し、他のメンバーにも同じ割合を与える
 */
function shareLinkedDamage(state: GameState): void {
  const groups = new Map<number, Enemy[]>();
  for (const e of state.enemies) {
    if (e.elite !== "linked") continue;
    const g = groups.get(e.roomIndex) ?? [];
    g.push(e);
    groups.set(e.roomIndex, g);
  }
  for (const group of groups.values()) {
    if (group.length < LINK_MIN_MEMBERS) continue;
    const fractions = group.map((e) => Math.max(0, (e.lastHp ?? e.hp) - Math.max(0, e.hp)) / e.maxHp);
    const total = fractions.reduce((s, f) => s + f, 0);
    if (total <= 0) continue;
    group.forEach((e, i) => {
      const share = total - (fractions[i] ?? 0);
      const amount = Math.round(share * e.maxHp);
      if (amount <= 0 || e.hp <= 0) return;
      damageEnemy(state, e, amount, { x: 0, y: 0 }, 0, { silent: true });
    });
  }
}

/** 連結の紐は感電を伝える: 1 体の感電が紐でつながった相方にも入る（docs/ideas/enemies.md H5） */
function shareLinkedStatus(state: GameState): void {
  const linked = state.enemies.filter((e) => e.elite === "linked" && e.hp > 0);
  if (linked.length < LINK_MIN_MEMBERS) return;
  for (const src of linked) {
    const shock = findStatus(src.status, "shock");
    if (!shock) continue;
    for (const dst of linked) {
      if (dst === src || dst.roomIndex !== src.roomIndex || findStatus(dst.status, "shock")) continue;
      const apply = { kind: "shock" as const, stacks: shock.stacks, duration: shock.time, potency: shock.potency };
      applyStatus(state, { kind: "enemy", enemy: dst }, apply, "env");
    }
  }
}

/** 正面（facing から ±blockArc/2 以内）から来た攻撃か。dir は攻撃の進行方向 */
export function isFrontal(e: Enemy, dir: Vec): boolean {
  if (length(dir) === 0) return false;
  const incoming = scale(normalize(dir), -1);
  const f = normalize(e.facing);
  const cosHalf = Math.cos((ENEMY_AI.knight.blockArcDeg / 2) * DEG_TO_RAD);
  return incoming.x * f.x + incoming.y * f.y >= cosHalf;
}

/** 盾持ち（EnemyDef.blocks）が構えているか */
function canBlock(e: Enemy): boolean {
  return enemyDef(e.defKey).blocks === true && !isStaggered(e) && e.phase !== "spawning";
}

function showBlock(state: GameState, e: Enemy, dir: Vec): void {
  addFloatingText(state, e.body.pos, BLOCK_TEXT, ENEMY_AI.knight.blockColor, 1.1, 0.6);
  spawnBurst(state, e.body.pos, ENEMY_AI.knight.blockColor, BLOCK_PARTICLES, 90, 0.25, 1.5);
  // 盾で受けた反動で少しだけ下がる
  e.knock = scale(normalize(dir), ENEMY_AI.knight.blockPushback);
  pushSfx(state, "wallHit");
}

/** GUARD BREAK の表示（盾を抜いた / 盾の上から怯みが溢れた） */
function showGuardBreak(state: GameState, e: Enemy): void {
  addFloatingText(state, e.body.pos, GUARD_BREAK_TEXT, ENEMY_AI.knight.blockColor, 1.3, 0.8);
  spawnBurst(state, e.body.pos, ENEMY_AI.knight.blockColor, GUARD_BREAK_PARTICLES, 130, 0.35, 2);
  pushSfx(state, "hitHeavy");
  pushSfx(state, "guardBreak");
  routIfBroken(state, e);
}

/** 黒鉄騎士: 盾を割られると脆弱になり、背を向けて逃げる */
function routIfBroken(state: GameState, e: Enemy): void {
  if (!enemyDef(e.defKey).rout) return;
  const target = { kind: "enemy" as const, enemy: e };
  applyStatus(state, target, { kind: "vulnerable", stacks: 1, duration: ROUT_TIME, potency: 0 }, "env");
  applyStatus(state, target, { kind: "fear", stacks: 1, duration: ROUT_TIME, potency: 0 }, "env");
  addFloatingText(state, { x: e.body.pos.x, y: e.body.pos.y - 10 }, ROUT_TEXT, ENEMY_AI.knight.blockColor, 1.1, 0.8);
}

/**
 * damageEnemy の直前に割り込む。返り値が 0 以下ならダメージ無効。
 * 近接の正面攻撃は盾持ちが防ぐ（弾は deflectProjectile が処理する）。
 * 防いでも怯み値の POISE.blockMul 倍は溜まり、溢れたら GUARD BREAK 表示 + 怯み。
 * guardBreak（カウンターヒット / 見切り斬り）なら盾を無視してダメージが通る（怯むかは怯み値しだい）。
 * 霜の巨人の氷の鎧は、氷柱が残っている間すべてを無効にする
 */
export function interceptEnemyDamage(
  state: GameState,
  e: Enemy,
  amount: number,
  knockDir: Vec,
  kind: "melee" | "ranged" | "proc",
  guardBreak = false,
  poise = 0,
): number {
  // 潜行中（土潜り・天井吊り・影踏み）には当たらない
  if (e.hidden) return 0;
  if (bossArmorBlocks(state, e)) {
    addFloatingText(state, e.body.pos, NULLIFY_TEXT, "#8fd0ff", 1, 0.5);
    return 0;
  }
  // 旗の加護・鏡の騎士の写し身の守り（掛からないときは値を丸めない）
  const guardMul = rallyTakenMul(e) * bossTakenMul(state, e);
  if (guardMul !== 1) amount = Math.max(1, Math.round(amount * guardMul));
  if (kind !== "melee") return amount;
  if (!canBlock(e) || !isFrontal(e, knockDir)) return amount;
  if (guardBreak) {
    showGuardBreak(state, e);
    return amount;
  }
  if (addPoise(state, e, poise * POISE.blockMul)) {
    showGuardBreak(state, e);
    return 0;
  }
  showBlock(state, e, knockDir);
  return 0;
}

/**
 * プレイヤー弾が敵に当たる直前に呼ぶ。true なら弾は処理済み（ダメージを与えない）。
 * 盾持ちの正面は弾かれて消え、Reflective は向きを反転して敵弾になる
 */
export function deflectProjectile(state: GameState, pr: Projectile, e: Enemy): boolean {
  if (pr.owner !== "player") return false;
  if (canBlock(e) && isFrontal(e, pr.vel)) {
    showBlock(state, e, pr.vel);
    pr.life = 0;
    return true;
  }
  if (e.elite !== "reflective" && !bossReflects(state, e, pr)) return false;
  // 弾は返されても、弾が運ぶ状態異常（燃焼・感電など）の付与だけは敵に残る（docs/ideas/enemies.md H1）
  if (pr.kind === "ranged") applyOnHitStatus(state, e, { kind: "ranged" });
  pr.owner = "enemy";
  pr.vel = scale(pr.vel, -1);
  pr.damage = ELITE.reflectDamage;
  pr.color = ELITE.reflectColor;
  pr.kind = "proc";
  pr.hitIds.clear();
  pr.pierceLeft = 0;
  pr.sourceId = e.id;
  spawnBurst(state, pr.pos, ELITE.reflectColor, REFLECT_PARTICLES, 80, 0.2, 1.5);
  pushSfx(state, "bulletHit");
  return true;
}

/** エリート撃破時: スコア上乗せ・追加ドロップ・死に際の修飾子（爆裂・伝染・寄生）。消えた（自爆）なら何もしない */
export function onEliteDeath(state: GameState, e: Enemy): void {
  if (!e.elite || e.vanished) return;
  const def = enemyDef(e.defKey);
  const bonus = Math.round(def.score * (ELITE.scoreMul - 1) * comboMultiplier(state.combo.count));
  state.score += bonus;
  // 通常ドロップ 1 回ぶんは killEnemy で済んでいるので残り (dropMul - 1) 倍ぶんを追加で抽選する
  const extra = Math.min(1, enemyDropChance(state, e) * (ELITE.dropMul - 1));
  if (state.rng.chance(extra)) dropItem(state, e.body.pos);
  pushSfx(state, "eliteKill");
  if (e.elite === "explosive") {
    // 死後の爆発は敵にも当たる（docs/ideas/enemies.md H10: 倒す前に群れへ送れば武器になる）
    const bomb = spawnBomb(state, e.body.pos, ELITE.explodeDamage, e.id, ELITE.explodeFuse, ELITE.explodeRadius);
    bomb.hitsEnemies = true;
  }
  if (e.elite === "contagious") spreadContagion(state, e);
  if (e.elite === "parasitic") releaseParasites(state, e);
}

/** 伝染の: 修飾子が一番近い敵へ移る（HP は割合を保ったまま増える。全快にはならない） */
function spreadContagion(state: GameState, e: Enemy): void {
  let best: Enemy | undefined;
  let bestD = Infinity;
  for (const o of state.enemies) {
    if (o === e || o.hp <= 0 || o.elite || o.roomIndex !== e.roomIndex || enemyDef(o.defKey).boss) continue;
    const d = length({ x: o.body.pos.x - e.body.pos.x, y: o.body.pos.y - e.body.pos.y });
    if (d >= bestD) continue;
    best = o;
    bestD = d;
  }
  if (!best) return;
  const ratio = best.hp / best.maxHp;
  best.elite = "contagious";
  best.eliteWork = createWork();
  best.poise.max *= elitePoiseMul("contagious");
  best.maxHp = Math.round(best.maxHp * ELITE.hpMul);
  best.hp = Math.max(1, Math.round(best.maxHp * ratio));
  best.lastHp = best.hp;
  spawnRing(state, best.body.pos, 20, ELITE_COLOR.contagious, 0.4);
}

/** 寄生の: 倒れると寄生虫（小さな蝙蝠）が湧く */
function releaseParasites(state: GameState, e: Enemy): void {
  const bat = enemyDef("bat");
  for (let i = 0; i < ELITE.parasiteCount; i++) {
    const want = add(e.body.pos, scale(fromAngle((i / ELITE.parasiteCount) * FULL_CIRCLE), ELITE.packedOffset));
    // 親がすり抜ける敵（鬼火・影蝙蝠）なら壁の中で倒れうるので、親の位置のままにせず近くの空きへ出す
    const pos = spawnSpot(state, want, e.body.pos, bat.radius);
    const parasite = createEnemy(state, bat, pos, e.roomIndex, true);
    parasite.maxHp = ELITE.parasiteHp;
    parasite.hp = ELITE.parasiteHp;
    parasite.lastHp = parasite.hp;
    state.enemies.push(parasite);
  }
}
