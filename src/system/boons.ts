import type { FrameInput } from "../core/input";
import { type Enemy, type GameState, type Projectile, allocId, pushLog, pushSfx } from "../core/state";
import { type Vec, fromAngle, length, scale } from "../core/vec";
import { VIEW_W } from "../core/view";
import { BOON, FEEL, PLAYER, STATUS } from "../data/tuning";
import { DEFAULT_STATS, type PlayerStats } from "../loot/types";
import { cancelAttack, healPlayer } from "./combat";
import { addFloatingText, spawnBurst, spawnRing } from "./effects";
import { KS } from "./keystones";
import { dropItem } from "./loot";
import { applyStats, dashTime } from "./player";
import { applyBurn, applyChill, chainLightning, enemiesInRadius, explodeAt } from "./statusEffects";

/**
 * ラン内限定の祝福 3 択。docs/ideas/run-structure.md「祝福 3 択（Boon）」。
 * 数値盛りではなく「ルール変更」を中心にし、装備のタグ（burn / dash / just など）に反応して出やすさが変わる。
 * 各システムは hasBoon で分岐し、数値系は foldBoonStats（applyStats 内）で stats に畳み込む。
 */

export const BOON_KEYS = [
  "finisherOnly",
  "dashGun",
  "parryCharge",
  "lockdown",
  "glassJust",
  "comboWave",
  "heartBurn",
  "eliteVault",
  "secondWind",
  "giantSlayer",
  "dashBlast",
  "justWipe",
  "clearShield",
  "clearHeal",
  "finisherWave",
  "rearGuard",
  "standingSniper",
  "triggerHappy",
  "dashGuard",
  "comboKeeper",
  "comboClock",
  "overcharge",
  "burstRefund",
  "burnSpread",
  "chillShatter",
  "dashShock",
  "critChain",
  "bloodFeast",
  "eliteMagnet",
  "frostLock",
] as const;

export type BoonKey = (typeof BOON_KEYS)[number];
export type BoonRarity = "common" | "rare" | "epic";
export type BoonTag =
  | "melee"
  | "ranged"
  | "dash"
  | "just"
  | "combo"
  | "energy"
  | "burn"
  | "chill"
  | "shock"
  | "explode"
  | "crit"
  | "hp"
  | "room"
  | "loot"
  | "boss";

export interface BoonDef {
  key: BoonKey;
  name: string;
  desc: string;
  /** HUD のアイコン文字（1 文字） */
  icon: string;
  rarity: BoonRarity;
  tags: readonly BoonTag[];
  /** 呪い付き（強い効果 + 代償）。3 択のうち 1 枠に確率で混ざる */
  cursed: boolean;
  /** このタグを装備が持っていないと出ない（burn の無い装備に燃焼祝福を出さない） */
  requires?: BoonTag;
}

export const BOONS: Readonly<Record<BoonKey, BoonDef>> = {
  finisherOnly: {
    key: "finisherOnly",
    name: "Finisher Only",
    desc: "Every slash is the 3rd (heavy) hit. No 1st/2nd hits.",
    icon: "3",
    rarity: "rare",
    tags: ["melee"],
    cursed: false,
  },
  dashGun: {
    key: "dashGun",
    name: "Run & Gun",
    desc: "You can shoot while dashing.",
    icon: "»",
    rarity: "common",
    tags: ["ranged", "dash"],
    cursed: false,
  },
  parryCharge: {
    key: "parryCharge",
    name: "Parry Charge",
    desc: "Slashing enemy bullets gives 3x burst gauge.",
    icon: "P",
    rarity: "common",
    tags: ["melee", "energy"],
    cursed: false,
  },
  lockdown: {
    key: "lockdown",
    name: "Lockdown Rush",
    desc: "+30% move speed while a room is locked. -10% otherwise.",
    icon: "L",
    rarity: "common",
    tags: ["room", "dash"],
    cursed: true,
  },
  glassJust: {
    key: "glassJust",
    name: "Glass Dancer",
    desc: "Max HP becomes 1. JUST dodge window x2.",
    icon: "G",
    rarity: "epic",
    tags: ["just", "dash"],
    cursed: true,
  },
  comboWave: {
    key: "comboWave",
    name: "Combo Wave",
    desc: "At 20+ combo, every slash fires a piercing wave.",
    icon: "W",
    rarity: "rare",
    tags: ["melee", "combo"],
    cursed: false,
  },
  heartBurn: {
    key: "heartBurn",
    name: "Heart Fire",
    desc: "Picking up a heart doubles your burn for 10s.",
    icon: "H",
    rarity: "common",
    tags: ["burn", "hp"],
    cursed: false,
    requires: "burn",
  },
  eliteVault: {
    key: "eliteVault",
    name: "Vault Key",
    desc: "Killing an elite guarantees a treasure vault next floor.",
    icon: "K",
    rarity: "rare",
    tags: ["loot"],
    cursed: false,
  },
  secondWind: {
    key: "secondWind",
    name: "Second Wind",
    desc: "Once per run, revive at 30% HP instead of dying.",
    icon: "R",
    rarity: "epic",
    tags: ["hp"],
    cursed: false,
  },
  giantSlayer: {
    key: "giantSlayer",
    name: "Giant Slayer",
    desc: "Bosses have -25% HP. Normal enemies +25% HP.",
    icon: "B",
    rarity: "common",
    tags: ["boss"],
    cursed: true,
  },
  dashBlast: {
    key: "dashBlast",
    name: "Blast Step",
    desc: "The end of each dash explodes.",
    icon: "X",
    rarity: "rare",
    tags: ["dash", "explode"],
    cursed: false,
  },
  justWipe: {
    key: "justWipe",
    name: "Clean Slate",
    desc: "A JUST dodge erases all enemy bullets.",
    icon: "J",
    rarity: "rare",
    tags: ["just"],
    cursed: false,
  },
  clearShield: {
    key: "clearShield",
    name: "Victory Veil",
    desc: "Clearing a room grants 5s of invulnerability.",
    icon: "V",
    rarity: "common",
    tags: ["room"],
    cursed: false,
  },
  clearHeal: {
    key: "clearHeal",
    name: "Blood Tithe",
    desc: "Clearing a room fully heals you. Max HP -30%.",
    icon: "T",
    rarity: "rare",
    tags: ["room", "hp"],
    cursed: true,
  },
  finisherWave: {
    key: "finisherWave",
    name: "Rending Wave",
    desc: "The 3rd slash fires a piercing wave.",
    icon: "~",
    rarity: "common",
    tags: ["melee"],
    cursed: false,
  },
  rearGuard: {
    key: "rearGuard",
    name: "Rear Guard",
    desc: "Each shot also fires a bullet backwards.",
    icon: "<",
    rarity: "common",
    tags: ["ranged"],
    cursed: false,
  },
  standingSniper: {
    key: "standingSniper",
    name: "Still Aim",
    desc: "Shots fired while standing still: +3 pierce, +50% speed.",
    icon: "S",
    rarity: "common",
    tags: ["ranged"],
    cursed: false,
  },
  triggerHappy: {
    key: "triggerHappy",
    name: "Trigger Happy",
    desc: "Fire rate x2, but you cannot slash.",
    icon: "!",
    rarity: "rare",
    tags: ["ranged"],
    cursed: true,
  },
  dashGuard: {
    key: "dashGuard",
    name: "Iron Stance",
    desc: "Dash becomes a guard in place. Hits while guarding are JUST.",
    icon: "I",
    rarity: "rare",
    tags: ["just", "dash"],
    cursed: true,
  },
  comboKeeper: {
    key: "comboKeeper",
    name: "Steady Hands",
    desc: "Getting hit halves your combo instead of resetting it.",
    icon: "C",
    rarity: "common",
    tags: ["combo"],
    cursed: false,
  },
  comboClock: {
    key: "comboClock",
    name: "Tick Tock",
    desc: "Combo window halved. Every 10 combo fills the burst gauge.",
    icon: "@",
    rarity: "rare",
    tags: ["combo", "energy"],
    cursed: true,
  },
  overcharge: {
    key: "overcharge",
    name: "Overcharge",
    desc: "While the burst gauge is full, slashes explode.",
    icon: "O",
    rarity: "rare",
    tags: ["energy", "melee", "explode"],
    cursed: false,
  },
  burstRefund: {
    key: "burstRefund",
    name: "Echo Burst",
    desc: "Each kill by burst refunds 25% of the gauge.",
    icon: "E",
    rarity: "common",
    tags: ["energy"],
    cursed: false,
  },
  burnSpread: {
    key: "burnSpread",
    name: "Wildfire",
    desc: "Burning enemies spread their burn when they die.",
    icon: "F",
    rarity: "common",
    tags: ["burn"],
    cursed: false,
    requires: "burn",
  },
  chillShatter: {
    key: "chillShatter",
    name: "Shatter",
    desc: "Chilled enemies burst into ice shards when they die.",
    icon: "*",
    rarity: "common",
    tags: ["chill"],
    cursed: false,
    requires: "chill",
  },
  dashShock: {
    key: "dashShock",
    name: "Static Step",
    desc: "Starting a dash releases chain lightning.",
    icon: "Z",
    rarity: "rare",
    tags: ["dash", "shock"],
    cursed: false,
  },
  critChain: {
    key: "critChain",
    name: "Crit Arc",
    desc: "Critical hits release chain lightning.",
    icon: "A",
    rarity: "rare",
    tags: ["crit", "shock"],
    cursed: false,
  },
  bloodFeast: {
    key: "bloodFeast",
    name: "Blood Feast",
    desc: "Hearts no longer drop. Every kill heals 3 HP.",
    icon: "+",
    rarity: "rare",
    tags: ["hp"],
    cursed: true,
  },
  eliteMagnet: {
    key: "eliteMagnet",
    name: "Elite Lure",
    desc: "Elites appear far more often. Elites always drop an item.",
    icon: "M",
    rarity: "rare",
    tags: ["loot"],
    cursed: true,
  },
  frostLock: {
    key: "frostLock",
    name: "Cold Welcome",
    desc: "Locking a room chills all its enemies for 3s.",
    icon: "#",
    rarity: "common",
    tags: ["chill", "room"],
    cursed: false,
  },
};

export function boonDef(key: BoonKey): BoonDef {
  return BOONS[key];
}

// -----------------------------------------------------------------------------
// 状態
// -----------------------------------------------------------------------------

export interface BoonChoice {
  options: BoonKey[];
  /** マウスが乗っているカード（-1 = なし）。入力から決まるので決定的 */
  hover: number;
  /** 提示からの経過（実時間秒）。inputDelay までは入力を無視 */
  timer: number;
}

/** 祝福のラン内の作業領域 */
export interface BoonRunState {
  /** applyStats に渡された装備由来の stats（祝福を畳み込む前）。未設定なら null */
  baseStats: PlayerStats | null;
  reviveUsed: boolean;
  /** eliteVault: 次の階に宝物庫を確定させる */
  vaultNext: boolean;
  heartBurnTimer: number;
  /** dashGuard: ガードの残り秒 */
  guardTimer: number;
  /** glassJust: ダッシュ後も JUST が取れる残り秒 */
  justExtendTimer: number;
  overchargeCd: number;
  critChainCd: number;
}

export function createBoonRunState(): BoonRunState {
  return {
    baseStats: null,
    reviveUsed: false,
    vaultNext: false,
    heartBurnTimer: 0,
    guardTimer: 0,
    justExtendTimer: 0,
    overchargeCd: 0,
    critChainCd: 0,
  };
}

export function hasBoon(state: GameState, key: BoonKey): boolean {
  return state.boons.includes(key);
}

// -----------------------------------------------------------------------------
// 装備タグと抽選
// -----------------------------------------------------------------------------

/** 装備（stats）から祝福タグを読む。keystones / triggers / 状態異常の有無に反応する */
export function equipmentTags(stats: Readonly<PlayerStats>): Set<BoonTag> {
  const tags = new Set<BoonTag>();
  const effects = new Set(stats.triggers.map((t) => t.effect));
  const triggers = new Set(stats.triggers.map((t) => t.trigger));
  const conditions = new Set(stats.triggers.map((t) => t.condition));
  const ks = new Set(stats.keystones);
  const d = DEFAULT_STATS;

  if (stats.burnChance > 0 || effects.has("burnNearby")) tags.add("burn");
  if (stats.chillChance > 0 || effects.has("freezeNearby")) tags.add("chill");
  if (stats.shockChance > 0 || effects.has("chainLightning")) tags.add("shock");
  if (stats.explodeOnKillChance > 0 || effects.has("explode") || ks.has(KS.blink)) tags.add("explode");
  if (
    stats.meleeDamageMul > d.meleeDamageMul ||
    stats.meleeDamageFlat > d.meleeDamageFlat ||
    stats.attackSpeedMul > d.attackSpeedMul ||
    triggers.has("onMeleeHit") ||
    triggers.has("everyNthMeleeHit") ||
    ks.has(KS.bladeOath)
  ) {
    tags.add("melee");
  }
  if (
    stats.rangedDamageMul > d.rangedDamageMul ||
    stats.rangedDamageFlat > d.rangedDamageFlat ||
    stats.fireRateMul > d.fireRateMul ||
    stats.projectileCount > d.projectileCount ||
    stats.pierce > d.pierce ||
    triggers.has("onShoot") ||
    ks.has(KS.pacifist)
  ) {
    tags.add("ranged");
  }
  if (
    stats.dashCharges > d.dashCharges ||
    stats.dashCooldownMul < d.dashCooldownMul ||
    stats.dashDistanceMul > d.dashDistanceMul ||
    triggers.has("onDash") ||
    ks.has(KS.blink)
  ) {
    tags.add("dash");
  }
  if (stats.justDodgeDamageMul > d.justDodgeDamageMul || stats.justDodgeWindow > d.justDodgeWindow || triggers.has("onJustDodge")) {
    tags.add("just");
  }
  if (stats.comboDamagePerStack > 0 || stats.comboWindowBonus > 0 || conditions.has("comboAbove10")) tags.add("combo");
  if (
    stats.energyGainMul > d.energyGainMul ||
    stats.burstDamageMul > d.burstDamageMul ||
    stats.burstRadiusMul > d.burstRadiusMul ||
    effects.has("energy") ||
    conditions.has("fullEnergy")
  ) {
    tags.add("energy");
  }
  if (stats.critChance > d.critChance || stats.critMul > d.critMul) tags.add("crit");
  if (stats.lifeOnHit > 0 || stats.lifeOnKill > 0 || stats.hpRegen > 0 || effects.has("heal") || ks.has(KS.vampire) || ks.has(KS.berserker)) {
    tags.add("hp");
  }
  if (triggers.has("onRoomClear") || conditions.has("roomLocked")) tags.add("room");
  return tags;
}

/** 候補の重み。requires を満たさない / 取得済みなら 0。装備タグの一致数で上がる */
export function boonWeight(def: BoonDef, tags: ReadonlySet<BoonTag>, owned: readonly BoonKey[]): number {
  if (owned.includes(def.key)) return 0;
  if (def.requires && !tags.has(def.requires)) return 0;
  const matches = def.tags.filter((t) => tags.has(t)).length;
  return BOON.rarityWeight[def.rarity] * (1 + BOON.tagBonus * matches);
}

/** 重み付きで 1 つ取り出す（pool から除く）。全て 0 なら null */
function takeWeighted(state: GameState, pool: BoonDef[], tags: ReadonlySet<BoonTag>): BoonDef | null {
  const weights = pool.map((d) => boonWeight(d, tags, state.boons));
  const total = weights.reduce((s, w) => s + w, 0);
  if (total <= 0) return null;
  let roll = state.rng.next() * total;
  for (let i = 0; i < pool.length; i++) {
    roll -= weights[i] ?? 0;
    if (roll > 0) continue;
    const [picked] = pool.splice(i, 1);
    return picked ?? null;
  }
  return pool.pop() ?? null;
}

/** 3 枚（重複なし）を抽選する。cursedChance で 1 枚が呪い付き祝福になる */
export function rollBoonOptions(state: GameState): BoonKey[] {
  const tags = equipmentTags(state.stats);
  const all = BOON_KEYS.map(boonDef);
  const normal = all.filter((d) => !d.cursed);
  const cursed = all.filter((d) => d.cursed);
  const picks: BoonDef[] = [];
  const wantCursed = state.rng.chance(BOON.cursedChance);
  if (wantCursed) {
    const c = takeWeighted(state, cursed, tags);
    if (c) picks.push(c);
  }
  while (picks.length < BOON.choiceCount) {
    const next = takeWeighted(state, normal, tags) ?? takeWeighted(state, cursed, tags);
    if (!next) break;
    picks.push(next);
  }
  // 呪い枠の位置もランダム（いつも左端だと読まれる）
  if (wantCursed && picks.length > 1) {
    const [first] = picks.splice(0, 1);
    if (first) picks.splice(state.rng.int(0, picks.length), 0, first);
  }
  return picks.map((d) => d.key);
}

/** 3 択を提示する（階段で降りた直後。depth 2 以降） */
export function offerBoons(state: GameState): void {
  if (state.depth < 2) return;
  const options = rollBoonOptions(state);
  if (options.length === 0) return;
  state.boonChoice = { options, hover: -1, timer: 0 };
  pushSfx(state, "lootRare");
}

// -----------------------------------------------------------------------------
// 選択 UI のレイアウトと入力
// -----------------------------------------------------------------------------

export const BOON_CARD = {
  w: 128,
  h: 124,
  gap: 12,
  y: 64,
  /** ホバーで浮く量（px） */
  hoverLift: 4,
} as const;

export interface CardRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** index 番目のカード矩形（画面座標）。描画と当たり判定で共有する */
export function boonCardRect(index: number, count: number): CardRect {
  const total = count * BOON_CARD.w + (count - 1) * BOON_CARD.gap;
  const x0 = Math.round((VIEW_W - total) / 2);
  return { x: x0 + index * (BOON_CARD.w + BOON_CARD.gap), y: BOON_CARD.y, w: BOON_CARD.w, h: BOON_CARD.h };
}

export function cardIndexAt(point: Vec, count: number): number {
  for (let i = 0; i < count; i++) {
    const r = boonCardRect(i, count);
    if (point.x >= r.x && point.x < r.x + r.w && point.y >= r.y - BOON_CARD.hoverLift && point.y < r.y + r.h) return i;
  }
  return -1;
}

/** 入力から選んだカード。クリックはカード上のみ。E（attack）は 3 枚目。無ければ -1 */
function selectedIndex(input: FrameInput, hover: number): number {
  if (input.skill1Pressed) return 0;
  if (input.skill2Pressed) return 1;
  // クリックと attackPressed は同じ元なので、クリックならカード判定だけを使う
  if (input.clickPressed) return hover;
  if (input.attackPressed) return 2;
  return -1;
}

/** 選択中の 1 ステップ（step から呼ぶ。他の更新は止まっている） */
export function updateBoonChoice(state: GameState, input: FrameInput, dt: number): void {
  const c = state.boonChoice;
  if (!c) return;
  c.timer += dt;
  c.hover = input.aimScreen ? cardIndexAt(input.aimScreen, c.options.length) : -1;
  if (c.timer < BOON.inputDelay) return;
  const index = selectedIndex(input, c.hover);
  if (index < 0 || index >= c.options.length) return;
  chooseBoon(state, index);
}

export function chooseBoon(state: GameState, index: number): void {
  const key = state.boonChoice?.options[index];
  state.boonChoice = null;
  if (!key) return;
  grantBoon(state, key);
}

/** 祝福を得る（テストからも直接使う） */
export function grantBoon(state: GameState, key: BoonKey): void {
  if (hasBoon(state, key)) return;
  state.boons.push(key);
  applyBoonsToStats(state);
  const def = boonDef(key);
  const color = def.cursed ? BOON.cursedColor : BOON.rarityColor[def.rarity];
  addFloatingText(state, state.player.body.pos, def.name, color, 1.4, 1.2);
  pushLog(state, `Boon: ${def.name} - ${def.desc}`, color);
  pushSfx(state, "lootRare");
}

// -----------------------------------------------------------------------------
// 数値系: stats への畳み込み
// -----------------------------------------------------------------------------

/** 装備由来の stats に祝福を畳み込む（元の stats は変更しない） */
export function foldBoonStats(stats: Readonly<PlayerStats>, boons: readonly BoonKey[], run: Readonly<BoonRunState>): PlayerStats {
  const out: PlayerStats = { ...stats };
  if (boons.includes("clearHeal")) out.maxHp = Math.round(out.maxHp * BOON.clearHealMaxHpMul);
  if (boons.includes("glassJust")) out.maxHp = BOON.glassJustMaxHp;
  if (boons.includes("triggerHappy")) out.fireRateMul *= BOON.triggerHappyFireMul;
  if (boons.includes("comboClock")) out.comboWindowBonus -= FEEL.comboWindow * BOON.comboClockWindowMul;
  if (boons.includes("heartBurn") && run.heartBurnTimer > 0) {
    out.burnChance = Math.min(1, out.burnChance * BOON.heartBurnMul);
    out.burnDps *= BOON.heartBurnMul;
  }
  return out;
}

/** 装備の stats（祝福前）を覚えて、祝福を畳み込み直す。何度呼んでも同じ結果 */
export function applyBoonsToStats(state: GameState): void {
  const base = state.boonRun.baseStats ?? state.stats;
  applyStats(state, base);
}

// -----------------------------------------------------------------------------
// 毎ステップ
// -----------------------------------------------------------------------------

export function updateBoons(state: GameState, dt: number): void {
  const run = state.boonRun;
  run.guardTimer = Math.max(0, run.guardTimer - dt);
  run.justExtendTimer = Math.max(0, run.justExtendTimer - dt);
  run.overchargeCd = Math.max(0, run.overchargeCd - dt);
  run.critChainCd = Math.max(0, run.critChainCd - dt);
  if (run.heartBurnTimer <= 0) return;
  run.heartBurnTimer = Math.max(0, run.heartBurnTimer - dt);
  if (run.heartBurnTimer === 0) applyBoonsToStats(state);
}

// -----------------------------------------------------------------------------
// フック: player.ts
// -----------------------------------------------------------------------------

const LAST_COMBO = PLAYER.melee.length - 1;
const FULL_CIRCLE = Math.PI * 2;
const TEXT_SCALE = 1.1;
const TEXT_LIFE = 0.6;

/** finisherOnly: 近接は常に最終段から（ダッシュ攻撃は除く） */
export function boonSwingCombo(state: GameState, combo: number, dashStrike: boolean): number {
  if (dashStrike || !hasBoon(state, "finisherOnly")) return combo;
  return LAST_COMBO;
}

/** 振り始め: 3 段目 / コンボ 20 以上なら貫通する衝撃波 */
export function onBoonSwing(state: GameState, combo: number, dashStrike: boolean, baseDamage: number): void {
  const finisher = !dashStrike && combo === LAST_COMBO && hasBoon(state, "finisherWave");
  const comboWave = hasBoon(state, "comboWave") && state.combo.count >= BOON.comboWaveThreshold;
  if (!finisher && !comboWave) return;
  const p = state.player;
  state.projectiles.push({
    id: allocId(state),
    owner: "player",
    pos: { ...p.body.pos },
    vel: scale(p.attack.dir, BOON.waveSpeed),
    radius: BOON.waveRadius,
    damage: baseDamage * BOON.waveDamageRatio,
    life: BOON.waveLife,
    color: BOON.waveColor,
    kind: "melee",
    hitIds: new Set(),
    pierceLeft: BOON.wavePierce,
  });
}

/** triggerHappy: 近接できない */
export function boonBlocksMelee(state: GameState): boolean {
  return hasBoon(state, "triggerHappy");
}

export function canShootWhileDashing(state: GameState): boolean {
  return hasBoon(state, "dashGun");
}

/** 射撃直後: 背面撃ち / 静止射撃 */
export function onBoonShoot(state: GameState, shots: readonly Projectile[]): void {
  const p = state.player;
  if (hasBoon(state, "standingSniper") && length(p.body.vel) < BOON.standStillSpeed) {
    for (const s of shots) {
      s.pierceLeft += BOON.standPierceBonus;
      s.vel = scale(s.vel, BOON.standSpeedMul);
    }
  }
  const first = shots[0];
  if (!first || !hasBoon(state, "rearGuard")) return;
  state.projectiles.push({
    ...first,
    id: allocId(state),
    pos: { ...p.body.pos },
    vel: scale(first.vel, -1),
    damage: first.damage * BOON.rearShotDamageMul,
    hitIds: new Set(),
  });
}

/** dashGuard: ダッシュの代わりにその場ガード。置き換えたら true */
export function tryDashGuard(state: GameState): boolean {
  if (!hasBoon(state, "dashGuard")) return false;
  const p = state.player;
  cancelAttack(state);
  state.boonRun.guardTimer = BOON.guardTime;
  p.invulnTimer = Math.max(p.invulnTimer, BOON.guardTime);
  p.dodgedThisDash = false;
  p.knock = { x: 0, y: 0 };
  spawnRing(state, p.body.pos, p.body.radius * 2, BOON.guardColor, BOON.guardTime);
  pushSfx(state, "dash");
  return true;
}

/** ダッシュ開始: glassJust の JUST 窓延長、dashShock の連鎖雷 */
export function onBoonDash(state: GameState): void {
  const p = state.player;
  if (hasBoon(state, "glassJust")) {
    const extended = dashTime(state.stats) * BOON.glassJustMul;
    state.boonRun.justExtendTimer = extended;
    p.invulnTimer = Math.max(p.invulnTimer, extended);
  }
  if (hasBoon(state, "dashShock")) chainLightning(state, p.body.pos, slashBase(state) * BOON.dashShockRatio);
}

/** ダッシュ終了（時間切れ / 壁）: dashBlast */
export function onBoonDashEnd(state: GameState): void {
  if (!hasBoon(state, "dashBlast")) return;
  explodeAt(state, state.player.body.pos, BOON.dashBlastRadius, slashBase(state) * BOON.dashBlastRatio);
}

/** 近接 1 段目の装備込みダメージ（祝福の威力は装備 stat に比例させる） */
function slashBase(state: GameState): number {
  const s = state.stats;
  const base = PLAYER.melee[0]?.damage ?? 0;
  return Math.round((base + s.meleeDamageFlat) * s.meleeDamageMul);
}

export function boonMoveMul(state: GameState): number {
  if (state.boonRun.guardTimer > 0) return 0;
  if (!hasBoon(state, "lockdown")) return 1;
  return state.rooms.some((r) => r.locked) ? BOON.lockdownFastMul : BOON.lockdownSlowMul;
}

export function parryEnergyMul(state: GameState): number {
  return hasBoon(state, "parryCharge") ? BOON.parryEnergyMul : 1;
}

/** overcharge: ゲージ満タン中の近接ヒットで爆発 */
export function onBoonMeleeHit(state: GameState, e: Enemy): void {
  if (!hasBoon(state, "overcharge") || state.boonRun.overchargeCd > 0) return;
  const p = state.player;
  if (p.energy < p.maxEnergy) return;
  state.boonRun.overchargeCd = BOON.overchargeIcd;
  explodeAt(state, e.body.pos, BOON.overchargeRadius, slashBase(state) * BOON.overchargeRatio, e.id);
}

/** burstRefund: バーストで倒した数だけゲージを返す */
export function onBoonBurstKills(state: GameState, kills: number): void {
  if (kills <= 0 || !hasBoon(state, "burstRefund")) return;
  const p = state.player;
  p.energy = Math.min(p.maxEnergy, p.energy + kills * BOON.burstRefundPerKill);
}

// -----------------------------------------------------------------------------
// フック: combat.ts
// -----------------------------------------------------------------------------

/** comboClock: コンボ 10 ごとにゲージ満タン */
export function onBoonComboHit(state: GameState): void {
  if (!hasBoon(state, "comboClock")) return;
  if (state.combo.count <= 0 || state.combo.count % BOON.comboClockEvery !== 0) return;
  const p = state.player;
  p.energy = p.maxEnergy;
  addFloatingText(state, p.body.pos, "TICK!", BOON.rarityColor.rare, TEXT_SCALE, TEXT_LIFE);
}

/** critChain: クリティカルで連鎖雷 */
export function onBoonCrit(state: GameState, enemy: Enemy, amount: number): void {
  if (!hasBoon(state, "critChain") || state.boonRun.critChainCd > 0) return;
  state.boonRun.critChainCd = BOON.critChainIcd;
  chainLightning(state, enemy.body.pos, amount * BOON.critChainRatio, enemy.id);
}

/** 撃破時: eliteVault / burnSpread / chillShatter / bloodFeast / eliteMagnet */
export function onBoonKill(state: GameState, enemy: Enemy): void {
  if (enemy.elite && hasBoon(state, "eliteVault") && !state.boonRun.vaultNext) {
    state.boonRun.vaultNext = true;
    addFloatingText(state, enemy.body.pos, "VAULT NEXT FLOOR", BOON.rarityColor.rare, TEXT_SCALE, 1);
  }
  if (enemy.elite && hasBoon(state, "eliteMagnet")) dropItem(state, enemy.body.pos);
  if (hasBoon(state, "bloodFeast")) healPlayer(state, BOON.feastHeal, { silent: true });
  const burn = enemy.effects.burn;
  if (burn.time > 0 && hasBoon(state, "burnSpread")) {
    for (const e of enemiesInRadius(state, enemy.body.pos, BOON.burnSpreadRadius)) {
      if (e.id !== enemy.id) applyBurn(state, e, burn.dps, STATUS.burnDuration);
    }
    spawnRing(state, enemy.body.pos, BOON.burnSpreadRadius, STATUS.burnColor, STATUS.fxLife);
  }
  if (enemy.effects.chill.time > 0 && hasBoon(state, "chillShatter")) shatter(state, enemy.body.pos);
}

function shatter(state: GameState, pos: Vec): void {
  for (let i = 0; i < BOON.shatterShards; i++) {
    state.projectiles.push({
      id: allocId(state),
      owner: "player",
      pos: { ...pos },
      vel: scale(fromAngle((FULL_CIRCLE * i) / BOON.shatterShards), BOON.shatterSpeed),
      radius: 2,
      damage: BOON.shatterDamage,
      life: BOON.shatterLife,
      color: BOON.shatterColor,
      kind: "proc",
      hitIds: new Set(),
      pierceLeft: 0,
    });
  }
  spawnBurst(state, pos, BOON.shatterColor, 8, 90, 0.3, 1.5);
}

/** 無敵中に JUST 回避になる追加条件（ガード中 / glassJust の延長窓） */
export function boonJustEligible(state: GameState): boolean {
  const run = state.boonRun;
  return run.guardTimer > 0 || run.justExtendTimer > 0;
}

/** 被弾後のコンボ数。comboKeeper なら半分残す */
export function comboAfterHurt(state: GameState): number {
  if (!hasBoon(state, "comboKeeper")) return 0;
  return Math.floor(state.combo.count / 2);
}

/** secondWind: HP 0 になったとき 1 回だけ復活。復活したら true */
export function tryRevive(state: GameState): boolean {
  const run = state.boonRun;
  if (run.reviveUsed || !hasBoon(state, "secondWind")) return false;
  const p = state.player;
  run.reviveUsed = true;
  p.hp = Math.max(1, Math.round(p.maxHp * BOON.reviveHpRatio));
  p.invulnTimer = Math.max(p.invulnTimer, BOON.reviveInvuln);
  state.flash = 1;
  addFloatingText(state, p.body.pos, "SECOND WIND", BOON.rarityColor.epic, 1.6, 1.2);
  spawnBurst(state, p.body.pos, BOON.rarityColor.epic, 30, 180, 0.6, 2.5);
  pushLog(state, "Second Wind! You refuse to die.", BOON.rarityColor.epic);
  pushSfx(state, "heal");
  return true;
}

/** JUST 回避時: justWipe / glassJust */
export function onBoonJust(state: GameState): void {
  const p = state.player;
  if (hasBoon(state, "glassJust")) {
    p.justTimer *= BOON.glassJustMul;
    p.justCounterTimer *= BOON.glassJustMul;
  }
  if (!hasBoon(state, "justWipe")) return;
  for (const pr of state.projectiles) {
    if (pr.owner !== "enemy" || pr.life <= 0) continue;
    pr.life = 0;
    spawnBurst(state, pr.pos, pr.color, 3, 60, 0.2, 1.5);
  }
}

// -----------------------------------------------------------------------------
// フック: floor.ts
// -----------------------------------------------------------------------------

/** eliteVault: 予約があれば、この階の空いている部屋を 1 つ宝物庫にする */
export function applyBoonFloorRules(state: GameState, reserved: ReadonlySet<number>): void {
  const run = state.boonRun;
  if (!run.vaultNext) return;
  if (state.rooms.some((r) => r.kind === "treasure")) {
    run.vaultNext = false;
    return;
  }
  const index = state.rooms.findIndex((r, i) => !reserved.has(i) && r.kind === "normal");
  const room = state.rooms[index];
  if (!room) return;
  room.kind = "treasure";
  run.vaultNext = false;
}

/** giantSlayer: 通常敵の HP +25%（湧いた直後、エリート化の前に呼ぶ） */
export function onBoonEnemySpawned(state: GameState, e: Enemy): void {
  if (!hasBoon(state, "giantSlayer")) return;
  scaleHp(e, BOON.mobHpMul);
}

/** giantSlayer: ボスの HP -25% */
export function onBossSpawned(state: GameState): void {
  if (!state.boss || !hasBoon(state, "giantSlayer")) return;
  const id = state.boss.enemyId;
  const boss = state.enemies.find((e) => e.id === id);
  if (boss) scaleHp(boss, BOON.bossHpMul);
}

function scaleHp(e: Enemy, mul: number): void {
  const hp = Math.max(1, Math.round(e.maxHp * mul));
  e.maxHp = hp;
  e.hp = hp;
  e.lastHp = hp;
}

/** eliteMagnet: エリート判定をもう 1 回振る */
export function extraEliteRoll(state: GameState, e: Enemy): boolean {
  return !e.elite && hasBoon(state, "eliteMagnet");
}

/** frostLock: ロックした部屋の敵を凍えさせる */
export function onBoonRoomLock(state: GameState, index: number): void {
  if (!hasBoon(state, "frostLock")) return;
  for (const e of state.enemies) {
    if (e.roomIndex === index && e.hp > 0) applyChill(state, e, BOON.frostLockSlow, BOON.frostLockTime);
  }
}

/** 部屋クリア: clearShield / clearHeal */
export function onBoonRoomClear(state: GameState): void {
  const p = state.player;
  if (hasBoon(state, "clearShield")) {
    p.buffs.invuln = Math.max(p.buffs.invuln, BOON.clearInvulnTime);
    addFloatingText(state, p.body.pos, "VEIL", BOON.guardColor, TEXT_SCALE, TEXT_LIFE);
  }
  if (hasBoon(state, "clearHeal")) healPlayer(state, p.maxHp);
}

export function boonHeartsAllowed(state: GameState): boolean {
  return !hasBoon(state, "bloodFeast");
}

/** heartBurn: ハートを拾うと burn が一定時間 2 倍 */
export function onBoonHeartPickup(state: GameState): void {
  if (!hasBoon(state, "heartBurn")) return;
  const wasActive = state.boonRun.heartBurnTimer > 0;
  state.boonRun.heartBurnTimer = BOON.heartBurnTime;
  if (!wasActive) applyBoonsToStats(state);
  addFloatingText(state, state.player.body.pos, "HEART FIRE", STATUS.burnColor, TEXT_SCALE, TEXT_LIFE);
}
