import type { FrameInput } from "../core/input";
import type { StatusKind } from "../core/status";
import { type Enemy, type GameState, type Projectile, allocId, pushLog, pushSfx } from "../core/state";
import { type Vec, fromAngle, length, scale } from "../core/vec";
import { VIEW_W } from "../core/view";
import { ATTR, BOON, FEEL, MANA, PLAYER, STATUS } from "../data/tuning";
import { ATTR_KEYS, type AttrKey, type Attributes, DEFAULT_STATS, type PlayerStats } from "../loot/types";
import { cancelAttack, healPlayer } from "./combat";
import { addFloatingText, spawnBurst, spawnRing } from "./effects";
import { KS } from "./keystones";
import { dropItem } from "./loot";
import { scaled } from "./attributes";
import { gainMana } from "./mana";
import { applyStats, dashTime } from "./player";
import {
  applyBurn,
  applyChill,
  applyStatus,
  chainLightning,
  enemiesInRadius,
  explodeAt,
  findStatus,
  hasStatus,
  removeStatus,
} from "./statusEffects";

/**
 * ラン内限定の祝福 3 択。docs/ideas/run-structure.md「祝福 3 択（Boon）」。
 * 数値盛りではなく「ルール変更」を中心にし、装備のタグ（burn / dash / just など）に反応して出やすさが変わる。
 * 各システムは hasBoon で分岐し、数値系は foldBoonStats（applyStats 内）で stats に畳み込む。
 */

export const BOON_KEYS = [
  "finisherOnly",
  "dashGun",
  "reflect",
  "justSlash",
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
  "lopsided",
  "swapHands",
  "spiritBlade",
  "plague",
  "bloodMist",
  "crumble",
  "frostPierce",
  "springWell",
  "bloodMana",
  "reaperCup",
  "keenBreath",
  "circulation",
  "hollowVessel",
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
  | "boss"
  | "attr"
  | "poison"
  | "bleed"
  | "stagger"
  | "mana";

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
    name: "終撃のみ",
    desc: "近接は常に3段目のみ。1・2段目は出ない。",
    icon: "3",
    rarity: "rare",
    tags: ["melee"],
    cursed: false,
  },
  dashGun: {
    key: "dashGun",
    name: "疾走射撃",
    desc: "ダッシュ中でも射撃できる。",
    icon: "»",
    rarity: "common",
    tags: ["ranged", "dash"],
    cursed: false,
  },
  reflect: {
    key: "reflect",
    name: "弾返し",
    desc: "近接攻撃で敵弾を撃ち返す。撃ち返すと必殺ゲージが3倍増える。",
    icon: "P",
    rarity: "common",
    tags: ["melee", "energy"],
    cursed: false,
  },
  justSlash: {
    key: "justSlash",
    name: "見切り斬り",
    desc: "ジャスト回避の直後に攻撃すると、回避した敵の目の前へ瞬間移動して斬る。",
    icon: "/",
    rarity: "rare",
    tags: ["just", "melee"],
    cursed: false,
  },
  lockdown: {
    key: "lockdown",
    name: "封鎖疾走",
    desc: "封鎖中は移動速度+30%になる代わりに、それ以外では-10%になる。",
    icon: "L",
    rarity: "common",
    tags: ["room", "dash"],
    cursed: true,
  },
  glassJust: {
    key: "glassJust",
    name: "硝子の見切り",
    desc: "最大HPが1になる代わりに、ジャスト回避の受付時間が2倍になる。",
    icon: "G",
    rarity: "epic",
    tags: ["just", "dash"],
    cursed: true,
  },
  comboWave: {
    key: "comboWave",
    name: "連撃波",
    desc: "コンボ20以上で、斬るたびに貫通する衝撃波が出る。",
    icon: "W",
    rarity: "rare",
    tags: ["melee", "combo"],
    cursed: false,
  },
  heartBurn: {
    key: "heartBurn",
    name: "業火の心",
    desc: "ハートを拾うと10秒間、燃焼効果が2倍になる。",
    icon: "H",
    rarity: "common",
    tags: ["burn", "hp"],
    cursed: false,
    requires: "burn",
  },
  eliteVault: {
    key: "eliteVault",
    name: "宝物の鍵",
    desc: "エリートを倒すと、次の階に宝物庫が確定で出現する。",
    icon: "K",
    rarity: "rare",
    tags: ["loot"],
    cursed: false,
  },
  secondWind: {
    key: "secondWind",
    name: "再起",
    desc: "ラン中1回だけ、力尽きる代わりにHP30%で復活する。",
    icon: "R",
    rarity: "epic",
    tags: ["hp"],
    cursed: false,
  },
  giantSlayer: {
    key: "giantSlayer",
    name: "巨人殺し",
    desc: "ボスのHPが-25%になる代わりに、通常の敵のHPが+25%になる。",
    icon: "B",
    rarity: "common",
    tags: ["boss"],
    cursed: true,
  },
  dashBlast: {
    key: "dashBlast",
    name: "爆走",
    desc: "ダッシュの終わりに爆発が起こる。",
    icon: "X",
    rarity: "rare",
    tags: ["dash", "explode"],
    cursed: false,
  },
  justWipe: {
    key: "justWipe",
    name: "回避一掃",
    desc: "ジャスト回避で敵弾を全て消し去る。",
    icon: "J",
    rarity: "rare",
    tags: ["just"],
    cursed: false,
  },
  clearShield: {
    key: "clearShield",
    name: "勝利の帳",
    desc: "部屋を制圧すると5秒間無敵になる。",
    icon: "V",
    rarity: "common",
    tags: ["room"],
    cursed: false,
  },
  clearHeal: {
    key: "clearHeal",
    name: "血の代償",
    desc: "部屋を制圧するとHPが全回復する代わりに、最大HPが-30%になる。",
    icon: "T",
    rarity: "rare",
    tags: ["room", "hp"],
    cursed: true,
  },
  finisherWave: {
    key: "finisherWave",
    name: "断裂波",
    desc: "3段目の斬撃で貫通する衝撃波が出る。",
    icon: "~",
    rarity: "common",
    tags: ["melee"],
    cursed: false,
  },
  rearGuard: {
    key: "rearGuard",
    name: "背面射撃",
    desc: "射撃するたびに後方へも弾を1発撃つ。",
    icon: "<",
    rarity: "common",
    tags: ["ranged"],
    cursed: false,
  },
  standingSniper: {
    key: "standingSniper",
    name: "静止狙撃",
    desc: "静止して撃った弾は貫通+3、速度+50%になる。",
    icon: "S",
    rarity: "common",
    tags: ["ranged"],
    cursed: false,
  },
  triggerHappy: {
    key: "triggerHappy",
    name: "連射狂い",
    desc: "連射速度が2倍になる代わりに、近接攻撃ができなくなる。",
    icon: "!",
    rarity: "rare",
    tags: ["ranged"],
    cursed: true,
  },
  dashGuard: {
    key: "dashGuard",
    name: "鉄壁の構え",
    desc: "ダッシュがその場の防御になり、防御中の被弾はJUST扱いになる。",
    icon: "I",
    rarity: "rare",
    tags: ["just", "dash"],
    cursed: true,
  },
  comboKeeper: {
    key: "comboKeeper",
    name: "堅実な手",
    desc: "被弾してもコンボが0にならず半分残る。",
    icon: "C",
    rarity: "common",
    tags: ["combo"],
    cursed: false,
  },
  comboClock: {
    key: "comboClock",
    name: "刻限コンボ",
    desc: "コンボ受付時間が半分になる代わりに、10コンボごとに必殺ゲージが満タンになる。",
    icon: "@",
    rarity: "rare",
    tags: ["combo", "energy"],
    cursed: true,
  },
  overcharge: {
    key: "overcharge",
    name: "過充填",
    desc: "必殺ゲージが満タンの間、斬撃が爆発する。",
    icon: "O",
    rarity: "rare",
    tags: ["energy", "melee", "explode"],
    cursed: false,
  },
  burstRefund: {
    key: "burstRefund",
    name: "残響爆発",
    desc: "バーストでの撃破ごとにゲージが25%還元される。",
    icon: "E",
    rarity: "common",
    tags: ["energy"],
    cursed: false,
  },
  burnSpread: {
    key: "burnSpread",
    name: "野火",
    desc: "燃えている敵は死亡時に周囲へ燃焼を広げる。",
    icon: "F",
    rarity: "common",
    tags: ["burn"],
    cursed: false,
    requires: "burn",
  },
  chillShatter: {
    key: "chillShatter",
    name: "氷砕",
    desc: "凍えた敵は死亡時に氷の破片となって弾け飛ぶ。",
    icon: "*",
    rarity: "common",
    tags: ["chill"],
    cursed: false,
    requires: "chill",
  },
  dashShock: {
    key: "dashShock",
    name: "帯電疾走",
    desc: "ダッシュ開始時に連鎖する雷を放つ。",
    icon: "Z",
    rarity: "rare",
    tags: ["dash", "shock"],
    cursed: false,
  },
  critChain: {
    key: "critChain",
    name: "会心雷撃",
    desc: "クリティカルヒットで連鎖する雷を放つ。",
    icon: "A",
    rarity: "rare",
    tags: ["crit", "shock"],
    cursed: false,
  },
  bloodFeast: {
    key: "bloodFeast",
    name: "血の饗宴",
    desc: "ハートが出なくなる代わりに、撃破するたびHP3回復する。",
    icon: "+",
    rarity: "rare",
    tags: ["hp"],
    cursed: true,
  },
  eliteMagnet: {
    key: "eliteMagnet",
    name: "エリート誘引",
    desc: "エリートの出現率が大きく上がる代わりに、エリートは必ずアイテムを落とす。",
    icon: "M",
    rarity: "rare",
    tags: ["loot"],
    cursed: true,
  },
  frostLock: {
    key: "frostLock",
    name: "氷結封鎖",
    desc: "部屋をロックすると、中の敵全員を3秒間凍えさせる。",
    icon: "#",
    rarity: "common",
    tags: ["chill", "room"],
    cursed: false,
  },
  lopsided: {
    key: "lopsided",
    name: "偏重",
    desc: "最も高いステータスの伸びが1.25倍になる代わりに、最も低いステータスは0として扱う。",
    icon: "^",
    rarity: "rare",
    tags: ["attr"],
    cursed: true,
    requires: "attr",
  },
  swapHands: {
    key: "swapHands",
    name: "持ち替え",
    desc: "筋力と技巧を入れ替えて扱う。近接が技巧で、射撃が筋力で伸びる。",
    icon: "%",
    rarity: "common",
    tags: ["attr", "melee", "ranged"],
    cursed: false,
  },
  spiritBlade: {
    key: "spiritBlade",
    name: "霊刃",
    desc: "通常攻撃が霊力でも伸びる代わりに、通常攻撃で戻るマナが半分になる。",
    icon: "&",
    rarity: "rare",
    tags: ["attr", "melee", "ranged"],
    cursed: true,
  },
  plague: {
    key: "plague",
    name: "疫病",
    desc: "毒の敵が死ぬと、周囲の敵に毒を引き継ぐ。",
    icon: "Q",
    rarity: "common",
    tags: ["poison"],
    cursed: false,
    requires: "poison",
  },
  bloodMist: {
    key: "bloodMist",
    name: "血煙",
    desc: "出血の敵を倒すと、自分の出血が消えてHP3回復する。",
    icon: "D",
    rarity: "common",
    tags: ["bleed", "hp"],
    cursed: false,
    requires: "bleed",
  },
  crumble: {
    key: "crumble",
    name: "崩し",
    desc: "怯ませた敵を脆弱にする。",
    icon: "Y",
    rarity: "common",
    tags: ["stagger", "melee"],
    cursed: false,
  },
  frostPierce: {
    key: "frostPierce",
    name: "凍て刺し",
    desc: "砕きで周囲の敵に冷気を2つ重ねる。",
    icon: "N",
    rarity: "rare",
    tags: ["chill"],
    cursed: false,
    requires: "chill",
  },
  springWell: {
    key: "springWell",
    name: "湧水",
    desc: "部屋を制圧するとマナが満タンになる。",
    icon: "U",
    rarity: "rare",
    tags: ["mana", "room"],
    cursed: false,
  },
  bloodMana: {
    key: "bloodMana",
    name: "血の対価",
    desc: "HPが50%以下の間、スキルのマナコストが-40%になる。",
    icon: "$",
    rarity: "common",
    tags: ["mana", "hp"],
    cursed: false,
  },
  reaperCup: {
    key: "reaperCup",
    name: "屠りの盃",
    desc: "撃破するたびマナが10回復する代わりに、マナの自然回復が半分になる。",
    icon: "=",
    rarity: "common",
    tags: ["mana"],
    cursed: false,
  },
  keenBreath: {
    key: "keenBreath",
    name: "見切りの息",
    desc: "ジャスト回避でマナが25回復する。",
    icon: "'",
    rarity: "common",
    tags: ["mana", "just"],
    cursed: false,
  },
  circulation: {
    key: "circulation",
    name: "循環",
    desc: "スキルが命中するたびマナが2回復する。1回の発動で8まで。",
    icon: "o",
    rarity: "rare",
    tags: ["mana"],
    cursed: false,
  },
  hollowVessel: {
    key: "hollowVessel",
    name: "虚ろの器",
    desc: "スキルのマナコストが-35%になる代わりに、最大マナが-40%、通常攻撃で戻るマナが半分になる。",
    icon: "0",
    rarity: "rare",
    tags: ["mana"],
    cursed: true,
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
  /** crumble: 前ステップまでに脆弱を付けた「怯み中の敵」の id。怯み 1 回につき 1 度だけ付ける */
  crumbled: number[];
  /** circulation: 直近の発動 1 回で既に戻したマナ。発動ごとに 0 へ戻す（多段ヒットの過剰還元を防ぐ） */
  circulationGained: number;
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
    crumbled: [],
    circulationGained: 0,
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
  addAttributeTags(stats, tags);
  addStatusProcTags(stats, tags);
  addManaTags(stats, tags);
  return tags;
}

/** マナの性質（最大・回復・回収・軽減のどれか）が基礎より良ければ mana */
function addManaTags(stats: Readonly<PlayerStats>, tags: Set<BoonTag>): void {
  const d = DEFAULT_STATS;
  if (
    stats.maxMana > d.maxMana ||
    stats.manaRegen > d.manaRegen ||
    stats.manaGainMul > d.manaGainMul ||
    stats.manaCostMul < d.manaCostMul
  ) {
    tags.add("mana");
  }
}

/** ステータスの性質（基礎値より高いステータス）があれば attr、筋力・怯み値の性質なら stagger */
function addAttributeTags(stats: Readonly<PlayerStats>, tags: Set<BoonTag>): void {
  if (ATTR_KEYS.some((k) => stats.attributes[k] > ATTR.base)) tags.add("attr");
  if (stats.attributes.str > ATTR.base || stats.poiseDamageMul > DEFAULT_STATS.poiseDamageMul) tags.add("stagger");
}

/** 状態異常 proc の性質（出血・毒など）の種類をタグにする */
function addStatusProcTags(stats: Readonly<PlayerStats>, tags: Set<BoonTag>): void {
  for (const proc of stats.statusProcs) {
    const tag = STATUS_PROC_TAG[proc.kind];
    if (tag) tags.add(tag);
  }
}

const STATUS_PROC_TAG: Readonly<Partial<Record<StatusKind, BoonTag>>> = {
  burn: "burn",
  chill: "chill",
  freeze: "chill",
  shock: "shock",
  paralyze: "shock",
  poison: "poison",
  bleed: "bleed",
  vulnerable: "stagger",
};

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
  // 祝福を畳み込む前の装備 stats で判定する（triggerHappy の射撃速度 x2 などを「装備のタグ」と誤認しない）
  const tags = equipmentTags(state.boonRun.baseStats ?? state.stats);
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
  pushSfx(state, "boonOffer");
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

/**
 * 入力から選んだカード。クリックはカード上のみ。E（attack）は 3 枚目。無ければ -1
 * パッドの A は attackPressed も同時に立つが、ここでは confirm 扱いで 1 枚目にする
 * （3 枚目は attackPressed かつ padConfirmPressed でないときだけ＝RT 単独のときのみ）
 */
function selectedIndex(input: FrameInput, hover: number): number {
  if (input.skill1Pressed || input.padConfirmPressed) return 0;
  if (input.skill2Pressed) return 1;
  // クリックと attackPressed は同じ元なので、クリックならカード判定だけを使う
  if (input.clickPressed) return hover;
  if (input.attackPressed && !input.padConfirmPressed) return 2;
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
  // 祝福は階に着いた後で選ぶので、この階に配置済みの敵（ボス含む）にも遡って掛ける
  if (key === "giantSlayer") applyGiantSlayerToExisting(state);
  const def = boonDef(key);
  const color = def.cursed ? BOON.cursedColor : BOON.rarityColor[def.rarity];
  addFloatingText(state, state.player.body.pos, def.name, color, 1.4, 1.2);
  pushLog(state, `祝福: ${def.name} - ${def.desc}`, color);
  pushSfx(state, "lootRare");
  pushSfx(state, def.cursed ? "boonSelectCursed" : "boonSelect");
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
  if (boons.includes("reaperCup")) out.manaRegen *= BOON.reaperCupRegenMul;
  if (boons.includes("hollowVessel")) {
    out.manaCostMul *= BOON.hollowVesselCostMul;
    out.maxMana = Math.round(out.maxMana * BOON.hollowVesselMaxManaMul);
  }
  if (boons.includes("heartBurn") && run.heartBurnTimer > 0) {
    out.burnChance = Math.min(1, out.burnChance * BOON.heartBurnMul);
    out.burnDps *= BOON.heartBurnMul;
  }
  // 係数（実効値）を組み替える。派生（HP・移動など）は元のステータスで決まっているので触らない
  if (boons.includes("swapHands") || boons.includes("lopsided")) out.attributesEff = foldAttributeBoons(out.attributesEff, boons);
  // 最終段で下限を掛ける。0 だと capManaCost がコストを 0 に切り詰めて撃ち放題になる
  out.maxMana = Math.max(MANA.maxMin, out.maxMana);
  return out;
}

/** swapHands → lopsided の順に実効値を組み替える（入力は書き換えない） */
function foldAttributeBoons(eff: Readonly<Attributes>, boons: readonly BoonKey[]): Attributes {
  const out: Attributes = { ...eff };
  if (boons.includes("swapHands")) {
    out.str = eff.dex;
    out.dex = eff.str;
  }
  if (boons.includes("lopsided")) applyLopsided(out);
  return out;
}

/**
 * lopsided: 最も高いステータスの実効値 ×lopsidedHighMul、最も低いものを 0 に。
 * 同値なら ATTR_KEYS の先頭を最高、末尾を最低にする（決定的）。全部同じなら偏りが無いので何もしない
 */
function applyLopsided(eff: Attributes): void {
  let high: AttrKey = ATTR_KEYS[0];
  let low: AttrKey = ATTR_KEYS[0];
  for (const k of ATTR_KEYS) {
    if (eff[k] > eff[high]) high = k;
    if (eff[k] <= eff[low]) low = k;
  }
  if (eff[high] === eff[low]) return;
  eff[high] *= BOON.lopsidedHighMul;
  eff[low] = 0;
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
  updateCrumble(state);
  if (run.heartBurnTimer <= 0) return;
  run.heartBurnTimer = Math.max(0, run.heartBurnTimer - dt);
  if (run.heartBurnTimer === 0) applyBoonsToStats(state);
}

/**
 * crumble: プレイヤー由来の怯みに入った敵へ脆弱を付ける（怯み 1 回につき 1 度）。
 * 怯みの付与元（poise.ts）に手を入れずに済むよう、毎ステップ新しく怯んだ敵を探す。
 * 自傷の怯み（猪の壁激突）は source が env なので対象外
 */
function updateCrumble(state: GameState): void {
  const run = state.boonRun;
  if (!hasBoon(state, "crumble")) {
    run.crumbled = [];
    return;
  }
  const seen = new Set(run.crumbled);
  const now: number[] = [];
  const v = STATUS.vulnerable;
  for (const e of state.enemies) {
    if (e.hp <= 0) continue;
    const stagger = findStatus(e.status, "stagger");
    if (!stagger || stagger.source !== "player") continue;
    now.push(e.id);
    if (seen.has(e.id)) continue;
    applyStatus(state, { kind: "enemy", enemy: e }, { kind: "vulnerable", stacks: 1, duration: v.duration, potency: 0 }, "player");
  }
  run.crumbled = now;
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

/** 近接 1 段目の装備・ステータス込みダメージ（祝福の威力は装備 stat に比例させる） */
function slashBase(state: GameState): number {
  const s = state.stats;
  const base = scaled(s, PLAYER.melee[0].scaling);
  return Math.round((base + s.meleeDamageFlat) * s.meleeDamageMul);
}

/**
 * spiritBlade: 通常攻撃（近接 3 段・ダッシュ攻撃・射撃 1 発）の威力に足す値（霊力の実効値 × 係数）。
 * 祝福が無ければ 0。player.ts の近接・射撃の威力に加算する
 */
export function boonNormalAttackBonus(state: GameState): number {
  if (!hasBoon(state, "spiritBlade")) return 0;
  return BOON.spiritBladeSpi * state.stats.attributesEff.spi;
}

/** spiritBlade / hollowVessel: 通常攻撃の命中で戻るマナに掛ける倍率（keystones の attackManaMul と掛け合わせる） */
export function boonAttackManaMul(state: GameState): number {
  const spirit = hasBoon(state, "spiritBlade") ? BOON.spiritBladeManaMul : 1;
  const hollow = hasBoon(state, "hollowVessel") ? BOON.hollowVesselAttackManaMul : 1;
  return spirit * hollow;
}

/**
 * bloodMana: HP が閾値以下の間だけのコスト倍率。HP で変わるので stats（manaCostMul）には畳めず、
 * skills.ts の effectiveManaCost が払う瞬間に読む（下限 MANA.costMulMin は向こうで掛かる）
 */
export function boonManaCostMul(state: GameState): number {
  if (!hasBoon(state, "bloodMana")) return 1;
  const p = state.player;
  return p.hp <= p.maxHp * BOON.bloodManaHpRatio ? BOON.bloodManaCostMul : 1;
}

// -----------------------------------------------------------------------------
// フック: skills.ts / skills/hit.ts
// -----------------------------------------------------------------------------

/** スキル発動（castSlot）: circulation の還元量を発動単位で数え直す */
export function onBoonSkillCast(state: GameState): void {
  state.boonRun.circulationGained = 0;
}

/** スキル命中（skillHit）: circulation。1 回の発動で circulationCap まで */
export function onBoonSkillHit(state: GameState): void {
  if (!hasBoon(state, "circulation")) return;
  const run = state.boonRun;
  const room = BOON.circulationCap - run.circulationGained;
  if (room <= 0) return;
  // 上限に数えるのは基礎量（manaGainMul の前）。回収量の性質はそのまま掛け算で効かせる
  const base = Math.min(BOON.circulationPerHit, room);
  run.circulationGained += base;
  gainMana(state, base);
}

export function boonMoveMul(state: GameState): number {
  if (state.boonRun.guardTimer > 0) return 0;
  if (!hasBoon(state, "lockdown")) return 1;
  return state.rooms.some((r) => r.locked) ? BOON.lockdownFastMul : BOON.lockdownSlowMul;
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
  addFloatingText(state, p.body.pos, "チャージ！", BOON.rarityColor.rare, TEXT_SCALE, TEXT_LIFE);
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
    addFloatingText(state, enemy.body.pos, "次階に宝物庫", BOON.rarityColor.rare, TEXT_SCALE, 1);
  }
  if (enemy.elite && hasBoon(state, "eliteMagnet")) dropItem(state, enemy.body.pos);
  if (hasBoon(state, "bloodFeast")) healPlayer(state, BOON.feastHeal, { silent: true });
  // 燃焼の強さ（dps）は status の potency。広げた先にも同じ強さで付ける
  const burn = findStatus(enemy.status, "burn");
  if (burn && hasBoon(state, "burnSpread")) {
    for (const e of enemiesInRadius(state, enemy.body.pos, BOON.burnSpreadRadius)) {
      if (e.id !== enemy.id) applyBurn(state, e, burn.potency, STATUS.burnDuration);
    }
    spawnRing(state, enemy.body.pos, BOON.burnSpreadRadius, STATUS.burnColor, STATUS.fxLife);
  }
  if (hasStatus(enemy.status, "chill") && hasBoon(state, "chillShatter")) shatter(state, enemy.body.pos);
  if (hasBoon(state, "plague")) spreadPlague(state, enemy);
  if (hasBoon(state, "bloodMist")) bloodMist(state, enemy);
  if (hasBoon(state, "reaperCup")) gainMana(state, BOON.reaperCupKillMana);
}

/** plague: 毒のスタックと強さをそのまま周囲の敵へ引き継ぐ */
function spreadPlague(state: GameState, enemy: Enemy): void {
  const poison = findStatus(enemy.status, "poison");
  if (!poison) return;
  // potency は付与時に霊力の倍率が掛かっている。applyStatus が player 由来に再度掛けないよう割り戻す
  const potency = poison.potency / Math.max(Number.EPSILON, state.stats.statusPotencyMul);
  const apply = { kind: "poison" as const, stacks: poison.stacks, duration: STATUS.poison.duration, potency };
  for (const e of enemiesInRadius(state, enemy.body.pos, BOON.plagueRadius)) {
    if (e.id !== enemy.id) applyStatus(state, { kind: "enemy", enemy: e }, apply, "player");
  }
  spawnRing(state, enemy.body.pos, BOON.plagueRadius, BOON.plagueColor, STATUS.fxLife);
}

/** bloodMist: 出血の敵を倒すと、自分の出血を消して回復 */
function bloodMist(state: GameState, enemy: Enemy): void {
  if (!hasStatus(enemy.status, "bleed")) return;
  removeStatus(state, { kind: "player" }, "bleed");
  healPlayer(state, BOON.bloodMistHeal, { silent: true });
  spawnBurst(state, state.player.body.pos, BOON.bloodMistColor, 8, 60, 0.3, 1.5);
}

/**
 * frostPierce: 凍結の敵を砕いたとき、周囲の敵に冷気を重ねる（砕かれた本人は冷気免疫なので除く）。
 * combat.ts の砕き（shatterFreeze）から呼ぶ
 */
export function onBoonShatter(state: GameState, enemy: Enemy): void {
  if (!hasBoon(state, "frostPierce")) return;
  const apply = { kind: "chill" as const, stacks: BOON.frostPierceStacks, duration: STATUS.chill.duration, potency: 0 };
  for (const e of enemiesInRadius(state, enemy.body.pos, BOON.frostPierceRadius)) {
    if (e.id !== enemy.id) applyStatus(state, { kind: "enemy", enemy: e }, apply, "player");
  }
  spawnRing(state, enemy.body.pos, BOON.frostPierceRadius, STATUS.chillColor, STATUS.fxLife);
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
  addFloatingText(state, p.body.pos, "再起", BOON.rarityColor.epic, 1.6, 1.2);
  spawnBurst(state, p.body.pos, BOON.rarityColor.epic, 30, 180, 0.6, 2.5);
  pushLog(state, "再起！まだ終わらない。", BOON.rarityColor.epic);
  pushSfx(state, "heal");
  return true;
}

/** JUST 回避時: justWipe / glassJust / keenBreath */
export function onBoonJust(state: GameState): void {
  const p = state.player;
  if (hasBoon(state, "keenBreath")) gainMana(state, BOON.keenBreathJustMana);
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

/** giantSlayer を取った時点で生きている敵に適用する（ボスは -25%、それ以外は +25%） */
function applyGiantSlayerToExisting(state: GameState): void {
  const bossId = state.boss?.enemyId;
  for (const e of state.enemies) {
    if (e.hp <= 0) continue;
    scaleHp(e, e.id === bossId ? BOON.bossHpMul : BOON.mobHpMul);
  }
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

/** 部屋クリア: clearShield / clearHeal / springWell */
export function onBoonRoomClear(state: GameState): void {
  const p = state.player;
  // 回収ではなく補充なので manaGainMul を通さず上限へ直接揃える
  if (hasBoon(state, "springWell")) {
    p.mana = state.stats.maxMana;
    addFloatingText(state, p.body.pos, "湧水", BOON.springWellColor, TEXT_SCALE, TEXT_LIFE);
  }
  if (hasBoon(state, "clearShield")) {
    p.buffs.invuln = Math.max(p.buffs.invuln, BOON.clearInvulnTime);
    addFloatingText(state, p.body.pos, "結界", BOON.guardColor, TEXT_SCALE, TEXT_LIFE);
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
  addFloatingText(state, state.player.body.pos, "業火", STATUS.burnColor, TEXT_SCALE, TEXT_LIFE);
}
