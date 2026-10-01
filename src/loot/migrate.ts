import { affixDef, isConversionKey, isKeystoneKey, isMarkerKey, keystoneDef, keystoneToRoll } from "./affixes";
import { affixColor, defaultColorOfKey } from "./colors";
import { fluxClassOf, fluxedValues, scaledNominalAt } from "./flux";
import { recoverInnateLuck } from "./innate";
import { UNIQUES } from "./named";
import { nameItem } from "./names";
import { isTriggerKey } from "./triggers";
import { createEmptyProvenance, normalizeSlot, type AffixRoll, type BudChoice, type Item, type Provenance, type Rarity } from "./types";

/**
 * 旧形式（prefix / suffix / tier / rarity）のアイテムを新形式（色・揺らぎ・来歴）へ変換する。
 * docs/LOOT_DESIGN.md「旧セーブの移行」。
 * - tier → 揺らぎ: T1 +0.4 / T2 +0.2 / T3 0 / T4 -0.1 / T5 -0.2 / T6 -0.3。期待値は |value| / (1 + flux) で逆算
 * - 負の値（旧 Corrupt の反転）→ 反転（色は冥）
 * - 旧 rarity → 余白: normal 4 / magic 3 / rare 2 / unique 1
 * - 旧 rare の 2 語名は銘として残す。旧 unique は固有名から名のある遺物の key を引く
 * - 腐敗の印（cr_corrupted）は捨てる。来歴は空
 * 新形式のアイテム（provenance を持つ）には欠けたフィールドを補うだけで、値は変えない（冪等）。
 * どちらの形式も最後に段取り 7d の写し（applyRelicMigration）を通す: 消えた性質・誓約は余白 +1、名のある遺物は写し先か普通の遺物へ。
 * セーブのキーは v1 のまま（写しは読み込みのたびに掛かり、2 回目以降は何もしない）
 */

/** 旧 tier（1 = T1）→ 揺らぎ。範囲外は 0 */
export const LEGACY_TIER_FLUX: Readonly<Record<number, number>> = {
  1: 0.4,
  2: 0.2,
  3: 0,
  4: -0.1,
  5: -0.2,
  6: -0.3,
};

/** 旧 rarity → 余白 */
export const LEGACY_RARITY_MARGIN: Readonly<Record<Rarity, number>> = {
  normal: 4,
  magic: 3,
  rare: 2,
  unique: 1,
};

const NO_FLUX = 0;

function isNewFormat(item: Item): boolean {
  return item.provenance !== undefined;
}

function tierFlux(tier: number | undefined): number {
  if (tier === undefined) return NO_FLUX;
  return LEGACY_TIER_FLUX[tier] ?? NO_FLUX;
}

/** 旧 AffixRoll 1 つを新形式へ。腐敗の印は null */
export function migrateRoll(roll: AffixRoll): AffixRoll | null {
  if (isMarkerKey(roll.key)) return null;
  if (isKeystoneKey(roll.key)) {
    const def = keystoneDef(roll.key);
    return def === undefined ? { key: roll.key, value: roll.value } : keystoneToRoll(def);
  }
  const color = defaultColorOfKey(roll.key);
  if (isTriggerKey(roll.key)) {
    const out: AffixRoll = { key: roll.key, value: roll.value, nominal: roll.value, flux: NO_FLUX, origin: "found" };
    if (roll.value2 !== undefined) out.value2 = roll.value2;
    if (color !== undefined) out.color = color;
    return out;
  }
  if (color === undefined) {
    // 未知の key: 値だけ残す（computeStats は無視する）
    const out: AffixRoll = { key: roll.key, value: roll.value };
    if (roll.value2 !== undefined) out.value2 = roll.value2;
    return out;
  }
  const legacyFlux = tierFlux(roll.tier);
  const nominal = Math.abs(roll.value) / (1 + legacyFlux);
  const inverted = roll.value < 0;
  const flux = nominal === 0 ? legacyFlux : roll.value / nominal - 1;
  const out: AffixRoll = { key: roll.key, value: roll.value, color: inverted ? "umbra" : color, nominal, flux, origin: "found" };
  if (roll.value2 !== undefined) {
    out.value2 = roll.value2;
    out.nominal2 = Math.abs(roll.value2) / (1 + legacyFlux);
  }
  if (inverted) out.inverted = true;
  return out;
}

/**
 * 旧 unique の名のある遺物の key。固有名で引き、引けなければ（日本語化前の英語名など）
 * ベースと固定性質の key の組で引く
 */
function namedKeyFor(item: Item): string | undefined {
  if (item.rarity !== "unique") return undefined;
  const byName = UNIQUES.find((u) => u.name === item.name && u.baseKey === item.baseKey);
  if (byName !== undefined) return byName.key;
  const keys = new Set(item.affixes.map((r) => r.key));
  // 固定の性質が無い遺物（無地の刃など）は性質の組で引けない（どの旧 unique にも当たってしまう）
  return UNIQUES.find((u) => u.baseKey === item.baseKey && u.affixes.length > 0 && u.affixes.every((spec) => keys.has(spec.key)))?.key;
}

/**
 * 成長まわりのフィールド（provenance / margin / milestones / buds / budOffer）が欠けていれば補う（その場で書き換える）。
 * 余白は旧 rarity から決める。ラン中に旧形式のまま装備されたアイテム（テストのリテラル等）にも使う
 */
export function ensureGrowthFields(item: Item): Item {
  if (item.provenance === undefined) item.provenance = createEmptyProvenance();
  else fillProvenanceCounters(item.provenance);
  if (item.margin === undefined) item.margin = LEGACY_RARITY_MARGIN[item.rarity];
  if (item.marginMax === undefined) item.marginMax = Math.max(item.margin, LEGACY_RARITY_MARGIN[item.rarity]);
  if (item.milestones === undefined) item.milestones = [];
  if (item.buds === undefined) item.buds = [];
  if (item.budOffer === undefined) item.budOffer = null;
  // 地金を足す前の遺物は地金なし（後から抽選し直すと手持ちの強さが勝手に変わるため）
  if (item.innate === undefined) item.innate = [];
  return item;
}

/**
 * 来歴に後から足したカウンタ（怯ませた・カウンター …）が欠けていれば 0 で補う（その場で書き換える）。
 * profile.ts の読み込みは補うが、リプレイの装備スナップショットなど読み込みを通らない来歴もある
 */
export function fillProvenanceCounters(p: Provenance): void {
  // 毎回の出来事で呼ばれるので、最後に足したカウンタがあれば（= 全部そろっていれば）何もしない
  // 第 1 弾・第 2 弾・第 4 弾それぞれの最後のカウンタを見る（一部だけ欠けた来歴も補う）
  if (typeof p.lastKills === "number" && typeof p.branchHits === "number" && typeof p.returns === "number") return;
  for (const key of PROVENANCE_COUNTERS) {
    if (typeof p[key] !== "number" || !Number.isFinite(p[key])) p[key] = EMPTY_COUNTER;
  }
}

/** 空の来歴のカウンタの値（createEmptyProvenance と同じ） */
const EMPTY_COUNTER = 0;

/** 数値のカウンタ（killsByEnemy 以外）。注ぎ（crafting.ts）も同じ一覧で来歴を足す */
export const PROVENANCE_COUNTERS = [
  "kills",
  "justDodges",
  "hurtTaken",
  "bosses",
  "roomsCleared",
  "floorsCleared",
  "deepest",
  "staggers",
  "counters",
  "skillCasts",
  "eliteKills",
  "lastKills",
  "weakHits",
  "resistedHits",
  "terrainKills",
  "favoredKills",
  "chargedHits",
  "branchHits",
  "returns",
] as const satisfies readonly (keyof Provenance)[];

/**
 * 旧形式 → 新形式。新形式ならフィールドを補うだけ（冪等）。引数は変更しない。
 * slot は常に normalizeSlot を通す（旧 weapon / gun。profile.ts を経由しないリプレイの装備スナップショットのため）
 */
export function migrateItem(item: Item): Item {
  const slot = normalizeSlot(item.slot) ?? item.slot;
  if (isNewFormat(item)) return ensureInnateLuck(applyRelicMigration(ensureGrowthFields({ ...item, slot })));
  const affixes = item.affixes.map(migrateRoll).filter((r): r is AffixRoll => r !== null);
  const margin = LEGACY_RARITY_MARGIN[item.rarity];
  const out: Item = {
    id: item.id,
    seed: item.seed,
    baseKey: item.baseKey,
    slot,
    rarity: fluxClassOf(affixes),
    itemLevel: item.itemLevel,
    name: item.name,
    implicit: item.implicit === null ? null : stripLegacy(item.implicit),
    affixes,
    innate: item.innate ?? [],
    foundDepth: item.foundDepth,
    foundAt: item.foundAt,
    provenance: createEmptyProvenance(),
    margin,
    marginMax: margin,
    milestones: [],
    buds: [],
    budOffer: null,
  };
  const namedKey = namedKeyFor(item);
  if (namedKey !== undefined) out.namedKey = namedKey;
  // 旧 rare の 2 語名と、名のある遺物を引けなかった旧 unique の固有名は銘として残す（名前を失わせない）
  const keepName = item.rarity === "rare" || (item.rarity === "unique" && namedKey === undefined);
  if (keepName && item.name.length > 0) out.inscription = item.name;
  out.name = nameItem(out);
  if (item.innateLuck !== undefined) out.innateLuck = item.innateLuck;
  return ensureInnateLuck(applyRelicMigration(out));
}

/**
 * 地金の上振れが無い・壊れていれば行から補う（その場で書き換える）。innateLuck を足す前の遺物は、
 * 拾った深度での点の合計 ÷ その深度の期待値を上振れとする（拾った深度では今と同じ地金になる）
 */
function ensureInnateLuck(item: Item): Item {
  const luck = item.innateLuck;
  if (luck === undefined || !Number.isFinite(luck) || luck < 0) item.innateLuck = recoverInnateLuck(item);
  return item;
}

/** implicit から kind / tier を落とす */
function stripLegacy(roll: AffixRoll): AffixRoll {
  const out: AffixRoll = { key: roll.key, value: roll.value };
  if (roll.value2 !== undefined) out.value2 = roll.value2;
  return out;
}

// ---------------------------------------------------------------------------
// 段取り 7d の写し（docs/ideas/relics-7d-plan.md 1-5・3 章）。表は scratchpad/p7d の機械集計をそのまま貼ったもの
// ---------------------------------------------------------------------------

/**
 * 段取り 7d で消えた性質・変換・誓約の key → 写し先（210 件。null 180 / 写し 30）。docs/ideas/boon-impl.md 3-6、6 章 8。
 * - null: その性質を消し、消えた数だけ余白 margin +1（marginMax は max(marginMax, margin)）
 * - 写し先が別 key: 値を写し先の期待値 nominalAt(def, item.itemLevel).nominal（value2 は .nominal2）で取り直す（揺らぎ 0・色は既定・反転と origin の awakening は外す）
 * - 同じ遺物で写し先が既にある / 重なったら先の 1 つだけ残し、残りは null と同じ扱い
 * - item.affixes と item.buds / budOffer の候補だけに掛ける（item.innate・item.implicit には掛けない）。冪等（写し先の key は表に無い）
 */
export const LEGACY_AFFIX_MAP: Readonly<Record<string, string | null>> = {
  // ---- 性質（地金の行 attr_* / res_* / armorFlat は item.affixes にあるときだけ消す。item.innate は触らない） ----
  meleeDamagePct: null,
  meleeDamageFlat: null,
  attackSpeed: null,
  meleeReach: null,
  knockback: null,
  rangedDamagePct: null,
  rangedDamageFlat: null,
  fireRate: null,
  projectiles: null,
  pierce: null,
  projectileSpeed: null,
  maxLife: null,
  maxLifePct: null,
  hpRegen: null,
  lifeOnHit: null,
  lifeOnKill: null,
  armorFlat: null,
  damageTaken: null,
  thorns: null,
  moveSpeed: null,
  dashCooldown: null,
  dashCharge: null,
  dashDistance: null,
  critChance: null,
  critMultiplier: null,
  energyGain: null,
  burstDamage: null,
  burstRadius: null,
  comboWindow: null,
  hybridDamage: null,
  hybridDefense: null,
  hybridSpeed: null,
  crushing: null,
  frenzied: null,
  overcharged: null,
  reckless: null,
  bloodbound: null,
  ironclad: null,
  razor: null,
  pike: null,
  flickering: null,
  emberMomentum: null,
  shatterEdge: null,
  chainedBarrage: null,
  deepPiercing: null,
  wallSlammer: null,
  vampiricRush: null,
  stormcaller: null,
  frostbite: null,
  arcaneBattery: null,
  gildedFang: null,
  dashStrike: null,
  finisherMend: null,
  wardedSanctuary: null,
  roomMender: null,
  attr_str: null,
  attr_dex: null,
  attr_vit: null,
  attr_mnd: null,
  attr_spi: null,
  attr_def: null,
  procVulnerable: null,
  procWeaken: null,
  procSilence: null,
  maxManaFlat: null,
  manaRegenFlat: null,
  manaGainPct: null,
  manaCostPct: null,
  manaOnKillFlat: null,
  manaDrought: null,
  lowTide: null,
  ebbTide: null,
  painToMana: null,
  silencedKillMana: null,
  lastKillMana: null,
  counterMana: null,
  arcaneFocus: null,
  weakenedGuard: null,
  hurtWeaken: null,
  procParalyze: null,
  virulent: null,
  statusWard: null,
  hurtCleanse: null,
  staggerLeech: null,
  fearPoise: null,
  vortexCore: null,
  vulnPoise: null,
  heavyHand: null,
  staggerCharge: null,
  windupCrack: "firstMove",
  dashVolley: null,
  brimShock: null,
  nightEyes: null,
  reaperShadow: null,
  inscribedWeight: null,
  invertedFeast: null,
  foreignEcho: null,
  bridge: null,
  wayfarer: null,
  kingslayerMark: null,
  keenMemory: null,
  placedAnchor: null,
  boonEcho_crimson: null,
  boonEcho_azure: null,
  boonEcho_jade: null,
  boonEcho_gold: null,
  boonEcho_umbra: null,
  shieldSplitter: "guardedBane",
  kickback: "counterWave",
  plunder: null,
  weakRead: null,
  resistBreaker: null,
  igniter: "conductor",
  elementalWard: null,
  chargeQuake: null,
  spreadCore: null,
  spreadShove: null,
  homingVenom: null,
  schoolForm: null,
  selfTaught: null,
  wanderer: null,
  schoolHarvest: null,
  slickFooting: "groundRooted",
  mireGuard: null,
  brokenHunter: null,
  corrodeClaw: null,
  doomToll: null,
  siegeSpark: null,
  switchHitter: null,
  weakInsight: "prismEdge",
  sevenHues: "prismEdge",
  counterGrain: "backlash",
  groundWisdom: "groundRooted",
  mireLord: "terrainHunter",
  schoolMastery: null,
  schoolSecret: "branchArt",
  fullCharge: "chargeCore",
  formBreaker: "branchArt",
  hueBreak: "elementalBreak",
  brokenBreaker: null,
  battleRhythm: "switchBreath",
  stormConduit: "conductor",
  siegeHeart: "siegeGuard",
  emberWalk: "emberTrail",
  frostWalk: "frostTrail",
  res_fire: null,
  res_ice: null,
  res_lightning: null,
  res_poison: null,
  res_dark: null,
  res_light: null,
  res_all: null,
  wardingFlat: null,
  sturdy: null,
  // ---- 変換（転じ 12 と属性の変換 6 以外） ----
  cv_meleeToBurn: null,
  cv_splitToPierce: null,
  cv_critToMultiplier: null,
  cv_speedToAttack: null,
  cv_lifeToArmor: null,
  cv_leechToEnergy: null,
  cv_comboToJust: null,
  cv_meleeToRanged: null,
  cv_critToBurn: null,
  cv_regenToGain: null,
  cv_knockbackToPoise: null,
  cv_poiseToDamage: null,
  cv_lifeToMana: null,
  cv_manaToLife: null,
  cv_energyToMana: null,
  cv_burstToSkill: null,
  cv_critToPoise: null,
  cv_burnToPoison: null,
  cv_chillToVulnerable: null,
  cv_armorToWarding: null,
  cv_wardingToArmor: null,
  cv_resistToDamage: null,
  cv_resistToWarding: null,
  cv_burnToFire: null,
  cv_chillToIce: null,
  cv_shockToLightning: null,
  cv_critToLight: null,
  cv_dexToStr: null,
  cv_strToSpi: null,
  cv_spiToVit: null,
  cv_vitToMnd: null,
  cv_mndToDex: null,
  cv_infuseNone: null,
  // ---- 誓約（残す 14 以外。条件付きの倍は性質の条件の族へ写す） ----
  ks_juggernaut: "unmoving",
  ks_berserker: "desperation",
  ks_windWalker: null,
  ks_thirst: null,
  ks_blight: null,
  ks_wedgeOath: "wedge",
  ks_chokehold: "guardPiercer",
  ks_backwater: "lockdownFury",
  ks_reaperOath: null,
  ks_monochrome: null,
  ks_colorless: null,
  ks_mirror: null,
  ks_discipline: null,
  ks_oblivion: null,
  ks_oneElement: null,
  ks_weakOath: "prismEdge",
  ks_nullOath: null,
  ks_ironOath: null,
  ks_chargeOath: "chargeCore",
  ks_stanceOath: "stanceGuard",
  ks_earthOath: "groundMend",
  ks_slickOath: "groundRooted",
  ks_emberOath: "emberTrail",
};

/**
 * 段取り 7d で消えた名のある遺物の key → 写し先（null = namedKey を外して普通の遺物として残す。固有名は銘 inscription に写す）。
 * 写し先は部位とベースが同じもの（遺物のベース・性質はそのまま。性質は LEGACY_AFFIX_MAP を通す）。
 * 図鑑（codex.v1 の relics）も読み込み時にこの表で写す
 */
export const LEGACY_UNIQUE_MAP: Readonly<Record<string, string | null>> = {
  widowmaker: null, // 喪服の剣（greatsword）
  hailstormEngine: null, // 雹嵐機関（smg）
  heartOfTheMountain: null, // 山の心臓（plate）
  stormstriders: null, // 嵐脚（greaves）
  eyeOfTheTempest: null, // 颶風の瞳（lapisAmulet）
  cinderfang: null, // 燠牙（dagger）
  bloodletterKiss: null, // 瀉血の口づけ（shortsword）
  whisperOfTheVoid: null, // 虚無の囁き（rifle）
  lastRites: null, // 終油の秘跡（shotgun）
  aegisOfTheUnbroken: null, // 不屈のイージス（plate）
  wardensSilence: null, // 看守の沈黙（chain）
  tempestLoader: null, // 疾風の装填（greaves）
  berserkersSignet: null, // 狂戦士の印章（bloodRing）
  fortunesGambit: "luckyCat", // 運命の賭け（goldRing）
  phaseAnchor: "reverseHourglass", // 位相の錨（onyxAmulet）
  driedWell: null, // 涸れ井戸の指輪（sapphireRing）
  guardStripper: null, // 堅守剥がし（revolver）
  silentScripture: null, // 沈黙の聖句（smg）
  paradoxRing: null, // 矛盾の指輪（goldRing）
  bottomless: null, // 底なし（jadeAmulet）
  manyHuedBrush: null, // 多彩の筆（staff）
  wedgeDriver: null, // 楔打ち（warpick）
  firstStrikeBlade: null, // 先の先（shortsword）
  lightningRod: null, // 避雷針（railgun）
  scarredHide: null, // 古傷の胴（leather）
  proxyRobe: null, // 身代わり衣（robe）
  sickbedCurtain: null, // 病床の帳（chain）
  whiteCloth: null, // 白布（cloth）
  backwaterPlate: null, // 背水の甲（plate）
  painlessChain: null, // 無痛の鎖（scale）
  wayfarerSandals: "wanderShoes", // 旅の垢（sandals）
  idatenTabi: null, // 韋駄天の足袋（tabi）
  keenSandals: null, // 見切りの草履（sandals）
  reaperBoots: null, // 死神の靴（wingedBoots）
  reverseRing: null, // 裏返しの輪（voidBand）
  monochromeNecklace: null, // 一色の首飾り（lapisAmulet）
  facingMirrors: null, // 合わせ鏡（onyxAmulet）
  kingslayerCollar: null, // 王殺しの首輪（duskAmulet）
  nightOwl: null, // 夜更かしの眼（rifle）
  lastBell: null, // 殲滅の鐘（greatsword）
  colorlessBell: null, // 無色の鈴（bell）
  contagionFang: "herdFlute", // 病みの牙（fangNecklace）
  chantRosary: "pilgrimBeads", // 詠唱の数珠（rosary）
  unshakenScale: "dragonScale", // 揺るがぬ鱗（scale）
  chokeTwins: null, // 締め上げの双剣（twinblades）
  oblivionRags: null, // 忘却の襤褸（rags）
  brokenCadence: null, // 途切れの音（longsword）
  keepsakeRing: null, // 形見分け（rubyRing）
  returningSwallow: null, // 帰り燕（pistol）
  leftBehind: null, // 置き土産の輪（ironRing）
  emberHeart: null, // 熾火の心臓（handCannon）
  glacierStep: null, // 氷河の足（snowBoots）
  thunderLash: null, // 雷導の鞭（chainWhip）
  bogMother: null, // 沼母の珠（seekerOrb）
  duskSickle: null, // 宵の小鎌（sickle）
  dawnCrystal: null, // 暁の水晶杖（crystalWand）
  oneHueBand: null, // 一色の輪（goldRing）
  plainVeil: null, // 無地の帳（robe）
  backlashCharm: null, // 逆撫での首飾り（onyxAmulet）
  moonCleaver: null, // 月断ち（zanbato）
  mastersKatana: null, // 師範の打刀（katana）
  strayFists: null, // 野良の鉄拳（cestus）
  matedFangs: "twinSerpent", // 番いの短刀（twinDaggers）
  gateHalberd: null, // 城門の矛槍（halberd）
  abbotsStaff: null, // 住職の錫杖（shakujo）
  rustbreaker: null, // 錆割りの双剣（twinblades）
  thunderTrumpet: null, // 雷鳴の喇叭銃（blunderbuss）
  brandingKnives: null, // 烙印の投げ短剣（throwingKnives）
  demonCaltrops: null, // 鬼の撒き菱（caltrops）
  circlingMoon: null, // 巡り月（chakram）
  earthMino: null, // 土の蓑（mino）
  rootedGeta: null, // 根張りの下駄（ironGeta）
  driftersCharm: null, // 流れ者の護符（jadeAmulet）
  lampOil: null, // 灯油の首飾り（amberAmulet）
  readersCirclet: "starReader", // 読み手の額冠（circlet）
  demonMask: null, // 鬼面（maskedVisor）
};

/** 写し表の引き（Record の添字は Object.prototype の名前も引いてしまうので Map にする） */
const AFFIX_MAP: ReadonlyMap<string, string | null> = new Map(Object.entries(LEGACY_AFFIX_MAP));
const UNIQUE_MAP: ReadonlyMap<string, string | null> = new Map(Object.entries(LEGACY_UNIQUE_MAP));

/** 旧 key の写し。undefined = 表に無い（今の key）、null = 消す、文字列 = 写し先 */
function affixTarget(key: string): string | null | undefined {
  return AFFIX_MAP.get(key);
}

/** 名のある遺物の旧 key → 今の key（null = 普通の遺物に戻る）。表に無い key はそのまま。図鑑の写しも使う */
export function migrateRelicKey(key: string): string | null {
  const target = UNIQUE_MAP.get(key);
  return target === undefined ? key : target;
}

/**
 * 写し先の性質を、写し先の期待値（揺らぎ 0・色は既定・反転なし）で作り直す。写し先が表に無ければ null（消すのと同じ）。
 * 期待値は生成と同じく装備の強さの係数を掛ける（変換は掛けない）
 */
function remapRoll(roll: AffixRoll, target: string, itemLevel: number): AffixRoll | null {
  const def = affixDef(target);
  if (def === undefined) return null;
  const nominal = scaledNominalAt(def, itemLevel, !isConversionKey(target));
  const values = fluxedValues(nominal, NO_FLUX, def.decimals ?? 0, def.decimals2 ?? 0);
  const out: AffixRoll = { key: target, value: values.value, color: affixColor(def), nominal: nominal.nominal, flux: NO_FLUX, origin: roll.origin ?? "found" };
  if (values.value2 !== undefined) out.value2 = values.value2;
  if (nominal.nominal2 !== undefined) out.nominal2 = nominal.nominal2;
  return out;
}

interface RemappedAffixes {
  affixes: AffixRoll[];
  /** 消した（余白に戻す）数 */
  dropped: number;
}

/** 遺物の性質に写しを掛ける。写し先が既にある / 先の写しと重なったら、先の 1 つだけ残して後は消す */
function remapAffixes(affixes: readonly AffixRoll[], itemLevel: number): RemappedAffixes {
  const present = new Set(affixes.filter((r) => affixTarget(r.key) === undefined).map((r) => r.key));
  const out: AffixRoll[] = [];
  let dropped = 0;
  for (const roll of affixes) {
    const target = affixTarget(roll.key);
    if (target === undefined) {
      out.push(roll);
      continue;
    }
    const mapped = target === null || present.has(target) ? null : remapRoll(roll, target, itemLevel);
    if (mapped === null) {
      dropped++;
      continue;
    }
    present.add(mapped.key);
    out.push(mapped);
  }
  return { affixes: out, dropped };
}

/** 芽の候補 1 つの写し。今の key はそのまま、消えたもの（写し先が無いもの）は null */
function remapOption(roll: AffixRoll, itemLevel: number): AffixRoll | null {
  const target = affixTarget(roll.key);
  if (target === undefined) return roll;
  return target === null ? null : remapRoll(roll, target, itemLevel);
}

/** 芽の履歴: 候補を写す。候補が消えた履歴は捨てる（呼び戻しで消えた性質を選び直させない） */
function remapBudHistory(buds: readonly BudChoice[], itemLevel: number): BudChoice[] | undefined {
  let changed = false;
  const out: BudChoice[] = [];
  for (const bud of buds) {
    const a = remapOption(bud.options[0], itemLevel);
    const b = remapOption(bud.options[1], itemLevel);
    if (a === bud.options[0] && b === bud.options[1]) {
      out.push(bud);
      continue;
    }
    changed = true;
    if (a !== null && b !== null) out.push({ ...bud, options: [a, b] });
  }
  return changed ? out : undefined;
}

/** 提示中の芽: 候補を写す。候補が消えたら提示を捨て、その節目を未到達に戻す（次の offerNextBud が出し直す） */
function remapBudOffer(item: Item): void {
  const offer = item.budOffer;
  if (offer === null || offer === undefined) return;
  const a = remapOption(offer.options[0], item.itemLevel);
  const b = remapOption(offer.options[1], item.itemLevel);
  if (a === offer.options[0] && b === offer.options[1]) return;
  if (a !== null && b !== null) {
    item.budOffer = { ...offer, options: [a, b] };
    return;
  }
  item.budOffer = null;
  item.milestones = (item.milestones ?? []).filter((m) => m !== offer.milestone);
}

/** 消えた名のある遺物は写し先へ。写し先が無ければ namedKey を外し、固有名を銘に写して普通の遺物にする */
function remapNamedKey(item: Item): void {
  const key = item.namedKey;
  if (key === undefined) return;
  const target = migrateRelicKey(key);
  if (target === key) return;
  if (target === null) {
    delete item.namedKey;
    if (item.inscription === undefined && item.name.length > 0) item.inscription = item.name;
  } else {
    item.namedKey = target;
  }
  item.name = nameItem(item);
}

/**
 * 段取り 7d の写し（その場で書き換える）。消えた性質・誓約は 1 つにつき余白 +1（芽で埋め直せる）、
 * 写しのある性質は写し先の期待値で作り直す。item.affixes と芽（buds / budOffer）だけに掛け、地金（innate）・implicit には掛けない。
 * 写し先の key は表に無いので冪等
 */
export function applyRelicMigration(item: Item): Item {
  const { affixes, dropped } = remapAffixes(item.affixes, item.itemLevel);
  if (affixes.length !== item.affixes.length || affixes.some((r, i) => r !== item.affixes[i])) {
    item.affixes = affixes;
    item.rarity = fluxClassOf(affixes);
  }
  if (dropped > 0) {
    item.margin = (item.margin ?? LEGACY_RARITY_MARGIN[item.rarity]) + dropped;
    item.marginMax = Math.max(item.marginMax ?? 0, item.margin);
  }
  const buds = item.buds === undefined ? undefined : remapBudHistory(item.buds, item.itemLevel);
  if (buds !== undefined) item.buds = buds;
  remapBudOffer(item);
  remapNamedKey(item);
  return item;
}
