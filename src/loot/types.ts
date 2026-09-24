import { type ElementTable, uniformElements } from "../core/element";
import type { StatusKind, StatusProc } from "../core/status";
import type { Vec } from "../core/vec";
import { ATTR, MANA } from "../data/tuning";
import type { MovesetKey } from "../data/weapons";

/**
 * 装備システム（響き・揺らぎ・来歴）の共有型。docs/LOOT_DESIGN.md を参照。
 * 生成・集計・永続化・UI は全部この型を介してやり取りする。
 */

/**
 * 部位。右手 / 左手（旧「近接 / 銃」。docs/ideas/weapon-redesign.md 5 章）。
 * 左手（offHand）は共鳴の環の席取りで、今はベースが無く何も装備できない（LOOT_SLOTS で除く）
 */
export const SLOTS = ["mainHand", "offHand", "armor", "boots", "ring", "amulet"] as const;
export type Slot = (typeof SLOTS)[number];

/** ドロップ・依頼・QA の装備が対象にする部位（左手は今はベースが無い） */
export const LOOT_SLOTS: readonly Slot[] = SLOTS.filter((s) => s !== "offHand");

/** 旧セーブの武器 / 銃スロットの読み替え先（右手へ統合） */
export const LEGACY_SLOT_MAP: Readonly<Record<string, Slot>> = { weapon: "mainHand", gun: "mainHand" };

/** 未知の値（旧セーブの weapon / gun を含む）を今の Slot に読み替える。分からなければ null */
export function normalizeSlot(v: unknown): Slot | null {
  if (typeof v !== "string") return null;
  if ((SLOTS as readonly string[]).includes(v)) return v as Slot;
  return LEGACY_SLOT_MAP[v] ?? null;
}

/**
 * 揺らぎの見た目の分類（旧レアリティ。キーは互換のため英語のまま残す）。
 * 格付けではなく「どれだけ荒れているか」を表す。値の決め方は flux.ts の fluxClassOf。
 * - normal = 静: 揺らぎが小さい
 * - magic = 揺: ほどほどに振れている
 * - rare = 荒: 大きく振れている（上振れも下振れも）
 * - unique = 反転あり: 裏返った性質を 1 つ以上持つ
 */
export const RARITIES = ["normal", "magic", "rare", "unique"] as const;
export type Rarity = (typeof RARITIES)[number];

export const RARITY_COLOR: Record<Rarity, string> = {
  normal: "#e0e0e0",
  magic: "#6a8cff",
  rare: "#ffd75f",
  unique: "#b070ff",
};

/** 揺らぎ分類の表示名 */
export const RARITY_LABEL: Readonly<Record<Rarity, string>> = {
  normal: "静",
  magic: "揺",
  rare: "荒",
  unique: "反転あり",
};

// ---------------------------------------------------------------------------
// 色（響き）。docs/LOOT_DESIGN.md「色と共鳴」
// ---------------------------------------------------------------------------

/** 性質の色。紅 / 蒼 / 翠 / 金 / 冥 */
export const TRAIT_COLORS = ["crimson", "azure", "jade", "gold", "umbra"] as const;
export type TraitColor = (typeof TRAIT_COLORS)[number];

export const TRAIT_COLOR_HEX: Readonly<Record<TraitColor, string>> = {
  crimson: "#e8553a",
  azure: "#3a8ee8",
  jade: "#49c46b",
  gold: "#f2c84b",
  umbra: "#9a5ae0",
};

export const TRAIT_COLOR_LABEL: Readonly<Record<TraitColor, string>> = {
  crimson: "紅",
  azure: "蒼",
  jade: "翠",
  gold: "金",
  umbra: "冥",
};

/** 性質の出自。found = 拾った時点 / bud = 芽吹いた / named = 名のある遺物の固定 */
export type TraitOrigin = "found" | "bud" | "named";

/** @deprecated prefix / suffix は廃止。旧セーブの読み込みとテスト用の型としてだけ残す */
export type AffixKind = "prefix" | "suffix";

/** アイテムに付いた性質の実体（ロール済み） */
export interface AffixRoll {
  key: string;
  /** @deprecated 廃止（旧セーブ互換）。新しい生成では付けない */
  kind?: AffixKind;
  /** @deprecated 廃止（旧セーブ互換）。新しい生成では付けない */
  tier?: number;
  value: number;
  /** 2 値持ちの性質（例: burn は chance と dps） */
  value2?: number;
  /** 色。欠けていれば定義の既定色（colors.ts の traitColorOf） */
  color?: TraitColor;
  /** 発見深度で決まる期待値（表示単位）。value = nominal * (1 + flux) */
  nominal?: number;
  nominal2?: number;
  /** 期待値からの相対的なずれ。-1 を下回ると反転 */
  flux?: number;
  /** 反転（値が負）。色は冥になり、共鳴への重みが 2 倍 */
  inverted?: boolean;
  origin?: TraitOrigin;
  /** 脱色（残響の操作）: 共鳴の配合に数えず、支配の減衰も受けない。値は脱色した時点で 90% */
  colorless?: boolean;
  /** 張り（残響の操作）: 利得と代償を両方 1.3 倍にした。1 つの性質に 1 回だけ */
  tensed?: boolean;
}

// ---------------------------------------------------------------------------
// 来歴と芽。docs/LOOT_DESIGN.md「来歴と芽」
// ---------------------------------------------------------------------------

/** 装備中に起きた出来事の記録（そのアイテムを装備していた間だけ数える） */
export interface Provenance {
  kills: number;
  /** 敵種 key → 撃破数 */
  killsByEnemy: Record<string, number>;
  justDodges: number;
  hurtTaken: number;
  bosses: number;
  roomsCleared: number;
  floorsCleared: number;
  /** 装備中に到達した最深 */
  deepest: number;
  // ---- 2026-09 追加（docs/ideas/loot-expansion.md 7 章）。旧セーブは 0 で補う ----
  /** 敵を怯ませた回数（ボスのダウンを含む） */
  staggers: number;
  /** カウンター（予備動作中の敵への近接）の成立回数 */
  counters: number;
  /** スキルの発動回数 */
  skillCasts: number;
  /** エリートの撃破数 */
  eliteKills: number;
  /** 殲滅（封鎖中の部屋の最後の 1 体）の回数 */
  lastKills: number;
  // ---- 2026-09 第 2 弾（属性・武器種・ジョブ・地形）。旧セーブは 0 で補う ----
  /** 属性の弱点を突いた命中 */
  weakHits: number;
  /** 属性の耐性に阻まれた命中 */
  resistedHits: number;
  /** 地形の上にいる敵の撃破 */
  terrainKills: number;
  /** ジョブの得意武器を持っていた間の撃破 */
  favoredKills: number;
  /** 溜め攻撃（溜めの段 1 以上の近接）の命中 */
  chargedHits: number;
  /** コンボ派生の命中 */
  branchHits: number;
  // ---- 2026-09-24 第 4 弾。旧セーブは 0 で補う ----
  /** 上り階段で浅い階へ戻った回数（帰還） */
  returns: number;
}

export function createEmptyProvenance(): Provenance {
  return {
    kills: 0,
    killsByEnemy: {},
    justDodges: 0,
    hurtTaken: 0,
    bosses: 0,
    roomsCleared: 0,
    floorsCleared: 0,
    deepest: 0,
    staggers: 0,
    counters: 0,
    skillCasts: 0,
    eliteKills: 0,
    lastKills: 0,
    weakHits: 0,
    resistedHits: 0,
    terrainKills: 0,
    favoredKills: 0,
    chargedHits: 0,
    branchHits: 0,
    returns: 0,
  };
}

/** 芽の 2 択の履歴 1 件。選ばなかった方も記録する（二度と出ない） */
export interface BudChoice {
  /** 節目の key（例 "kills:50"） */
  milestone: string;
  options: [AffixRoll, AffixRoll];
  chosen: 0 | 1;
  /** 呼び戻し（残響の操作）で選び直した芽。1 遺物 1 回 */
  recalled?: boolean;
}

/** 提示中（未選択）の芽 */
export interface BudOffer {
  milestone: string;
  options: [AffixRoll, AffixRoll];
}

/**
 * GameState.pendingBud: 装備中のアイテムに提示中の芽（UI が 2 択を出し、chooseBud で選ぶ）。
 * 実体は Item.budOffer。これはその参照と表示用の情報
 */
export interface PendingBud {
  itemId: string;
  slot: Slot;
  milestone: string;
  /** 節目の表示名（例「撃破 50」） */
  milestoneLabel: string;
  options: [AffixRoll, AffixRoll];
}

export interface Item {
  /** 永続 ID。seed と生成順から作る */
  id: string;
  seed: number;
  baseKey: string;
  slot: Slot;
  /** 揺らぎの見た目の分類（格付けではない）。RARITIES の説明を参照 */
  rarity: Rarity;
  /** 生成に使った深度（発見深度 + 0..2）。期待値と揺らぎ幅の入力 */
  itemLevel: number;
  /** 表示名。銘があれば銘、名のある遺物は固有名、それ以外は「{色の形容}{ベース名}」 */
  name: string;
  /** ベース固有の暗黙補正（ロール済み）。色の配合には数えない */
  implicit: AffixRoll | null;
  /** 性質 */
  affixes: AffixRoll[];
  foundDepth: number;
  /** epoch ms */
  foundAt: number;
  // ---- 以下は新形式で必ず入る（旧セーブ・テストのリテラルのため optional。profile.ts の migrateItem が補う） ----
  provenance?: Provenance;
  /** 余白: まだ芽吹ける数 */
  margin?: number;
  /** 余白の上限（削ぎで戻せる上限） */
  marginMax?: number;
  /** 到達済みの節目（二度と芽は出ない） */
  milestones?: string[];
  /** 芽の 2 択の履歴 */
  buds?: BudChoice[];
  /** 提示中の芽（未選択）。ランを跨いで残る */
  budOffer?: BudOffer | null;
  /** 銘。余白を使い切ると来歴から刻まれる */
  inscription?: string;
  /** 名のある遺物の key（generator.ts の UNIQUES） */
  namedKey?: string;
  /** 鍛え直し（残響の操作）の回数 */
  reforged?: number;
  /** 拠点の武器掛けで借りた素の器。保存されず、ランが終わると消える */
  loaned?: true;
  /** 借り物が押し出した元の装備の id（返すときに同じスロットへ戻す） */
  loanedReplaces?: string;
}

export interface FloorItem {
  id: number;
  item: Item;
  pos: Vec;
  bobTime: number;
}

export type Equipment = Record<Slot, Item | null>;

/** 1 ラン分の履歴（死亡 or R 再開のたびに記録）。docs は無いので profile.ts の HISTORY_LIMIT を参照 */
export interface RunHistoryEntry {
  /** epoch ms */
  date: number;
  seedText: string;
  depth: number;
  kills: number;
  score: number;
  bestCombo: number;
  durationSec: number;
  /** "defeated"（死亡）/ "abandoned"（R や Restart で中断） */
  cause?: string;
}

export interface ProfileMeta {
  runs: number;
  bestDepth: number;
  totalKills: number;
  bestScore: number;
  /** 追加フィールド。version は変えず、欠けていても loadProfile 側で補う */
  history?: RunHistoryEntry[];
}

export interface Profile {
  version: 1;
  equipment: Equipment;
  stash: Item[];
  meta: ProfileMeta;
  /**
   * 武器種ごとに拠点の武器掛けで選んだ奥義の key（追加フィールド。version は変えない）。
   * 欠けた武器種はその武器種の 1 本目（data/ultimates.ts の defaultUltimate）。sanitize は loot/profile.ts（Lane C）
   */
  ultimates?: Partial<Record<MovesetKey, string>>;
}

export function createEmptyEquipment(): Equipment {
  return { mainHand: null, offHand: null, armor: null, boots: null, ring: null, amulet: null };
}

export function createEmptyProfile(): Profile {
  return {
    version: 1,
    equipment: createEmptyEquipment(),
    stash: [],
    meta: { runs: 0, bestDepth: 0, totalKills: 0, bestScore: 0, history: [] },
  };
}

// ---------------------------------------------------------------------------
// ステータス（素質値）。docs/COMBAT_DESIGN.md A
// ---------------------------------------------------------------------------

/** 筋力 / 技巧 / 体力 / 精神 / 霊力 */
export const ATTR_KEYS = ["str", "dex", "vit", "mnd", "spi"] as const;
export type AttrKey = (typeof ATTR_KEYS)[number];
export type Attributes = Record<AttrKey, number>;

/**
 * 係数表（LoL のレシオ）。技の威力 = base + Σ(係数 × 実効値)。base はステータスが 0 のときの値。
 * 参照するステータスの種類・数は技ごとに自由（1 つでも全部でも、0 個 = 基礎値だけでもよい）
 */
export type Scaling = { base: number } & Partial<Record<AttrKey, number>>;

/**
 * 「基礎値での値」を持つ量（怯み値・状態異常の効果量など）への上乗せ。ステータス（実効値）1 点あたりの増分。
 * 最終値 = 基礎値での値 + Σ(係数 × (実効値 − 基礎値))。ステータスが基礎値（各 5）なら元の値のまま
 */
export type AttrRatio = Partial<Record<AttrKey, number>>;

/** 全ステータスが同じ値の Attributes */
export function uniformAttributes(value: number): Attributes {
  return { str: value, dex: value, vit: value, mnd: value, spi: value };
}

/**
 * 装備から畳み込んだ派生ステータス。ゲームロジックはこれだけを見る。
 * 倍率は 1 が基準、確率は 0..1、flat は加算値。
 */
export interface PlayerStats {
  maxHp: number;
  /** 毎秒の回復。近くに敵がいる間は止まる（system/combat.ts の hpRegenAllowed） */
  hpRegen: number;
  /** 与ダメージに対する回復の %（3 = 3%）。戦闘中の回復の共通上限（HEAL.sustainCapRatio）を受ける */
  lifeOnHit: number;
  /** 撃破時の回復量。コンボ HEAL.killHealMinCombo 以上でだけ発動し、共通上限を受ける */
  lifeOnKill: number;
  /** 防御（物理の軽減。逓減式は system/combat.ts の armorReduction）。docs/COMBAT_DESIGN.md A-8 */
  armor: number;
  /** 魔防（魔法の軽減。armor と同じ逓減式）。混成の攻撃は防御と魔防の平均で受ける */
  warding: number;
  /** 属性耐性（%、−100〜75 のソフトキャップは system/combat.ts の effectiveResist） */
  resist: ElementTable;
  damageTakenMul: number;
  thorns: number;

  moveSpeedMul: number;
  dashCooldownMul: number;
  dashCharges: number;
  dashDistanceMul: number;

  meleeDamageMul: number;
  meleeDamageFlat: number;
  attackSpeedMul: number;
  meleeReachMul: number;
  knockbackMul: number;
  damageVsStaggeredMul: number;

  rangedDamageMul: number;
  rangedDamageFlat: number;
  fireRateMul: number;
  projectileCount: number;
  pierce: number;
  projectileSpeedMul: number;

  critChance: number;
  critMul: number;

  energyGainMul: number;
  burstDamageMul: number;
  burstRadiusMul: number;

  comboWindowBonus: number;
  /** コンボ 1 スタックあたりのダメージ倍率加算（上限は comboDamageCap） */
  comboDamagePerStack: number;
  comboDamageCap: number;
  /** JUST 回避後の一定時間、この倍率 */
  justDodgeDamageMul: number;
  justDodgeWindow: number;

  burnChance: number;
  burnDps: number;
  chillChance: number;
  chillSlow: number;
  shockChance: number;
  shockDamage: number;
  explodeOnKillChance: number;
  explodeDamage: number;

  /**
   * 誓約（旧キーストーン）: 遊び方そのものを変える大型改造の key 一覧（例 "glassCannon", "berserker", "blinkDash"）。
   * 同じ key は 1 つまで。相互排他グループは affixes.ts 側で定義する。
   */
  keystones: string[];
  /** trigger × condition × effect 文法で生成された条件付き効果 */
  triggers: TriggeredEffect[];
  /** 装備全体の色の配合で発現した共鳴（resonance.ts）。数値効果は他のフィールドに畳み込み済み */
  resonance: Resonance;

  // ---- 戦闘再設計（docs/COMBAT_DESIGN.md F-1）。既定値は中立 ----
  /** 装備・共鳴・祝福・ラン内振り分けの生の合計（逓減前）。基礎値を含む */
  attributes: Attributes;
  /** 逓減後の実効値。deriveAttributes が埋める。計算はこちらを使う */
  attributesEff: Attributes;
  maxMana: number;
  /** 毎秒 */
  manaRegen: number;
  manaGainMul: number;
  /** スキルのマナコストに掛ける倍率（装備の性質・祝福で下げる。下限は MANA.costMulMin） */
  manaCostMul: number;
  /** 撃破時のマナ回収に足す固定値（MANA.onKill に加算。manaGainMul も掛かる） */
  manaOnKill: number;
  skillDamageMul: number;
  poiseDamageMul: number;
  statusPotencyMul: number;
  /** プレイヤーが受ける状態異常の持続倍率 */
  statusTakenMul: number;
  /** 性質「弾斬り」: 0 より大きければ近接の active で敵弾を消す */
  bulletCut: number;
  statusProcs: StatusProc[];
  /** 性質のルール変更（docs/ideas/loot-expansion.md）。戦闘側は system/traitHooks.ts が読む */
  traits: TraitStats;
  /** 武器種（右手のベースが決める。src/data/weapons.ts） / 撃つ弾（銃のベースの key。src/loot/bullets.ts） */
  moveset: MovesetKey;
  bullet: string;
  /** 属性の変換: 近接・射撃（通常攻撃）の威力のうちその属性へ移す割合 0..1（none は使わない。合計は 1 で頭打ち） */
  infuse: ElementTable;
  /** スキルの属性のうち無属性へ戻す割合 0..1（無の刻印） */
  skillNeutral: number;
}

/**
 * 性質が持ち込むルール変更の数値。すべて 0 が「効果なし」。% 系は 0.01 単位の加算値（+25% なら 0.25）。
 * 数値のフィールドを PlayerStats の直下に増やすと statsSummary の表示表まで広がるので、ここにまとめる
 */
export interface TraitStats {
  // ---- マナ ----
  /** 敵を怯ませた瞬間に戻るマナ */
  manaOnStagger: number;
  /** マナが少ない間（TRIGGER.trait.lowManaRatio 未満）のマナ回収の加算倍率 */
  lowManaGainMul: number;
  /** マナ満タンの間のスキル威力の加算倍率 */
  fullManaSkillMul: number;
  /** 残りマナが 0 に近いほど効くスキル威力の加算倍率（0 で満額） */
  lowManaSkillMul: number;
  /** 身代わり: 被弾時に払うマナ（0 = 無効）。払えれば被ダメージが TRIGGER.trait.manaShieldMul 倍 */
  manaShieldCost: number;
  /** 沈黙中の敵を倒したときに戻るマナ */
  silencedKillMana: number;
  /** 殲滅で戻るマナ（最大マナに対する割合 0..1） */
  lastKillManaRatio: number;
  /** マナ満タンで溢れた回収のうち、必殺ゲージへ移す割合 0..1 */
  manaOverflowToEnergy: number;
  // ---- 与ダメージ（近接・射撃・スキル。proc は対象外） ----
  /** 対象に付いた状態異常 1 種ごと */
  damagePerStatusKind: number;
  /** 自分に付いた状態異常 1 種ごと */
  damagePerSelfStatus: number;
  /** 予備動作中の敵へ / それ以外への減少 */
  windupDamageMul: number;
  offWindupPenalty: number;
  /** 堅守中の敵へ */
  guardedDamageMul: number;
  /** ボスへ / ボス以外への減少 */
  bossDamageMul: number;
  nonBossPenalty: number;
  /** 封鎖中の部屋で / それ以外での減少 */
  lockedDamageMul: number;
  unlockedPenalty: number;
  /** 暗闇フロアの射撃 / それ以外のフロアの射撃の減少 */
  darkRangedMul: number;
  lightRangedPenalty: number;
  /** 死神が出ている間 */
  reaperDamageMul: number;
  // ---- 怯み値 ----
  fearPoiseMul: number;
  silencedPoiseMul: number;
  vulnerablePoiseMul: number;
  guardedPoiseMul: number;
  /** 蓄積が耐性の半分以上の敵へ / 半分未満の敵への減少（楔） */
  wedgePoiseMul: number;
  wedgePenalty: number;
  /** 射撃の怯み値の加算倍率（負で減る） */
  rangedPoiseMul: number;
  /** 会心時の怯み値の加算倍率 */
  critPoiseMul: number;
  /** 堅守による射撃の怯み値の減衰を打ち消す割合 0..1（剥がし撃ち） */
  guardPierce: number;
  /** 敵を怯ませた瞬間、周囲の敵に与える怯み値（崩れの反響） */
  staggerQuake: number;
  // ---- 生存 ----
  healOnStagger: number;
  /** 弱体中の敵から受けるダメージの減少 / 弱体でない敵からの増加 */
  weakenedGuard: number;
  weakenedExposure: number;
  // ---- その他 ----
  /** 1 以上: 殲滅の瞬間に敵弾をすべて消す（目覚め「幕引き」） */
  lastKillClearsBullets: number;
  /** 殲滅で得るエネルギー */
  lastKillEnergy: number;
  // ---- 2026-09 追加（作業領域 LootRuntime / Enemy.stuckShots を使うもの・ハブ性質）----
  /** 余韻斬り: コンボが途切れた瞬間、コンボ数 1 あたりの衝撃波のダメージ */
  comboBreakWave: number;
  /** 形見: 状態異常の敵を倒したとき、その 1 種を乗せる次の命中の回数 */
  inheritCharges: number;
  /** 撃ち込み杭: 刺さった弾 1 本あたりの、次の近接命中で爆ぜるダメージ */
  stakeDamage: number;
  /** 置き土産: 0 より大きければ、自分の設置物の範囲内での近接がその設置物の状態異常をこの秒数乗せる */
  placedInfuse: number;
  /** 杭打ち: 敵を怯ませたとき、近くの自分の設置物の残り時間を延ばす秒 */
  placedExtend: number;
  /** 血の署名: HP 半分未満の間、スキルの再使用時間と最低間隔が明ける速さの加算倍率 */
  lowHpSkillHaste: number;
  /** 祝福の響き（色ごと）: その色に対応するタグの祝福 1 つにつきの与ダメージ */
  boonEchoCrimson: number;
  boonEchoAzure: number;
  boonEchoJade: number;
  boonEchoGold: number;
  boonEchoUmbra: number;
  // ---- 2026-09 第 2 弾: 属性（combat.ts の genreAndElement から traitElementMul が読む）----
  /** 弱点を突いた命中の与ダメージ / 弱点でない相手への減少 */
  weakDamageMul: number;
  nonWeakPenalty: number;
  /** 耐性による減少を打ち消す割合 0..1 */
  resistPierce: number;
  /** 弱点を突いた命中で戻る気力 */
  weakHitMana: number;
  /** 耐性に阻まれた命中で、攻撃の主な属性の状態異常を付ける秒（0 = 無効） */
  resistedInflict: number;
  /** 濡れ・浸水の敵への与ダメージ（雷の割合が大きいほど伸びる） */
  wetConductMul: number;
  /** 油膜の敵への与ダメージ（炎の割合が大きいほど伸びる） */
  oiledIgniteMul: number;
  // ---- 武器種・銃の弾・ジョブ ----
  /** 溜めの段 1 つにつきの近接の与ダメージ / 溜めを持つ武器で溜めずに振った近接の減少 */
  chargedMeleeMul: number;
  unchargedPenalty: number;
  /** 溜めの段 1 つにつきの怯み値 */
  chargedPoiseMul: number;
  /** 溜めの段 1 つにつき、命中で得る必殺ゲージ */
  chargedHitEnergy: number;
  /** コンボ派生の命中の与ダメージ / 命中で戻る気力 */
  branchDamageMul: number;
  branchHitMana: number;
  /** ジョブの得意武器を持つ間の与ダメージ / 持たない間の減少 */
  favoredDamageMul: number;
  unfavoredPenalty: number;
  /** 得意でない武器の近接の怯み値 / 得意武器の近接の怯み値の減少（我流） */
  unfavoredPoiseMul: number;
  favoredPoisePenalty: number;
  /** 得意武器を持つ間の撃破で戻る気力 */
  favoredKillMana: number;
  /** 見習い（ジョブなし）の間の与ダメージ / ジョブを持つ間の減少 */
  noJobDamageMul: number;
  jobPenalty: number;
  /** 散弾の射撃: 近い敵への与ダメージ / 遠い敵への減少 / 怯み値 */
  spreadCloseMul: number;
  spreadFarPenalty: number;
  spreadPoiseMul: number;
  /** 追尾の射撃の命中で毒を付ける秒 */
  homingPoison: number;
  /** 連射の射撃の命中で烙印を付ける確率 0..1 */
  rapidBrandChance: number;
  // ---- 新しい状態異常 ----
  /** 烙印の敵への射撃・スキルの与ダメージ / 烙印の無い敵への射撃の減少 */
  brandedMul: number;
  unbrandedPenalty: number;
  /** 崩勢の敵への与ダメージ */
  brokenMul: number;
  /** 腐食の敵への怯み値 */
  corrodePoiseMul: number;
  /** 宣告の付いた敵を倒したときに戻る気力 */
  doomKillMana: number;
  // ---- 地形 ----
  /** 自分が地形の上に立つ間の与ダメージ / 地形の無い床での減少 */
  terrainDamageMul: number;
  offTerrainPenalty: number;
  /** 自分が水たまり・氷床の上に立つ間の与ダメージ */
  slickDamageMul: number;
  /** 地形の上にいる敵への与ダメージ */
  enemyOnTerrainMul: number;
  /** 自分が地形の上に立つ間の被ダメージの減少 */
  terrainGuard: number;
  /** 地形の上に立つ間の毎秒の回復（戦闘中の共通上限を受ける） */
  terrainRegen: number;
  /** 地形の上にいる敵を倒すと、その地形に応じた衝撃波（ダメージ） */
  terrainKillBlast: number;
  /** 燃えている敵を倒すと足元に炎を置く秒 */
  burningKillFire: number;
  /** ダッシュ中に足元へ氷床を置く秒 */
  dashIceTrail: number;
  // ---- 交戦中 ----
  /** 交戦中の被ダメージの減少 / 交戦外の被ダメージの増加 */
  engagedGuard: number;
  roamExposure: number;
  /** 交戦中の撃破で得る必殺ゲージ */
  engagedKillEnergy: number;
  // ---- 被ダメージの属性 ----
  /** 属性を持つ攻撃から受けるダメージの減少 / 無属性の攻撃から受けるダメージの増加 */
  elementalGuard: number;
  physicalExposure: number;
  // ---- 攻撃手段の持ち替え（近接 / 射撃 / スキル） ----
  /** 直前と違う手段で当てた命中の怯み値 / 同じ手段が続いた命中の減少 */
  alternatePoiseMul: number;
  repeatPoisePenalty: number;
  /** 直前と違う手段で当てるたびに戻る気力 */
  switchMana: number;
  /** 近接と射撃を交互に当てるたびに重なる与ダメージ（1 段）と上限 */
  alternateDamageStep: number;
  alternateDamageCap: number;
  /** 怯ませた敵に、武器の主な属性の状態異常を付ける秒 */
  elementBreak: number;
  // ---- 共鳴・星座が持ち込むもの ----
  /** 生命が半分以上の間の与ダメージ / 半分未満の間の被ダメージの減少（表裏） */
  highHpDamageMul: number;
  lowHpGuard: number;
  /** 装備トリガーの内部クールダウンを縮める割合 0..1（鏡像） */
  triggerIcdCut: number;
  // ---- 装備全体の文脈（computeStats が性質の適用前に入れる。性質の apply はこれを読む） ----
  /** 装備全体の残り余白の合計 */
  gearMargin: number;
  /** 装備している遺物の数 */
  gearItems: number;
  /** 銘を持つ遺物の数 */
  gearInscribed: number;
  /** 反転した性質の数 */
  gearInverted: number;
  /** 異色（既定と別の色で生まれた）性質の数 */
  gearOffColor: number;
}

/**
 * 装備の性質がラン中に覚えておく作業領域（Player.loot）。createPlayer が初期化する。
 * 決定性のため state の中に置く（リプレイで同じ入力なら同じ値になる）
 */
export interface LootRuntime {
  /** 余韻斬り: 前のステップのコンボ数（途切れた瞬間を検出する） */
  lastCombo: number;
  /** 形見: 次の命中に乗せる状態異常と残り回数 */
  inherited: { kind: StatusKind; charges: number } | null;
  /** 直前に当てた攻撃手段（持ち替えの性質・星座・拮抗が読む） */
  lastMode: AttackMode | null;
  /** 天秤（拮抗）: 近接と射撃を交互に当て続けた回数と、途切れるまでの残り秒 */
  alternateStacks: number;
  alternateTimer: number;
  /** 地形の衝撃波の内部クールダウン（連鎖で画面が爆ぜ続けないように） */
  terrainBlastIcd: number;
}

/** 攻撃手段。スキルは近接・射撃どちらの命中でも「スキル」として数える */
export type AttackMode = "melee" | "ranged" | "skill";

export function createLootRuntime(): LootRuntime {
  return { lastCombo: 0, inherited: null, lastMode: null, alternateStacks: 0, alternateTimer: 0, terrainBlastIcd: 0 };
}

export const DEFAULT_TRAIT_STATS: Readonly<TraitStats> = {
  manaOnStagger: 0,
  lowManaGainMul: 0,
  fullManaSkillMul: 0,
  lowManaSkillMul: 0,
  manaShieldCost: 0,
  silencedKillMana: 0,
  lastKillManaRatio: 0,
  manaOverflowToEnergy: 0,
  damagePerStatusKind: 0,
  damagePerSelfStatus: 0,
  windupDamageMul: 0,
  offWindupPenalty: 0,
  guardedDamageMul: 0,
  bossDamageMul: 0,
  nonBossPenalty: 0,
  lockedDamageMul: 0,
  unlockedPenalty: 0,
  darkRangedMul: 0,
  lightRangedPenalty: 0,
  reaperDamageMul: 0,
  fearPoiseMul: 0,
  silencedPoiseMul: 0,
  vulnerablePoiseMul: 0,
  guardedPoiseMul: 0,
  wedgePoiseMul: 0,
  wedgePenalty: 0,
  rangedPoiseMul: 0,
  critPoiseMul: 0,
  guardPierce: 0,
  staggerQuake: 0,
  healOnStagger: 0,
  weakenedGuard: 0,
  weakenedExposure: 0,
  lastKillClearsBullets: 0,
  lastKillEnergy: 0,
  comboBreakWave: 0,
  inheritCharges: 0,
  stakeDamage: 0,
  placedInfuse: 0,
  placedExtend: 0,
  lowHpSkillHaste: 0,
  boonEchoCrimson: 0,
  boonEchoAzure: 0,
  boonEchoJade: 0,
  boonEchoGold: 0,
  boonEchoUmbra: 0,
  weakDamageMul: 0,
  nonWeakPenalty: 0,
  resistPierce: 0,
  weakHitMana: 0,
  resistedInflict: 0,
  wetConductMul: 0,
  oiledIgniteMul: 0,
  chargedMeleeMul: 0,
  unchargedPenalty: 0,
  chargedPoiseMul: 0,
  chargedHitEnergy: 0,
  branchDamageMul: 0,
  branchHitMana: 0,
  favoredDamageMul: 0,
  unfavoredPenalty: 0,
  unfavoredPoiseMul: 0,
  favoredPoisePenalty: 0,
  favoredKillMana: 0,
  noJobDamageMul: 0,
  jobPenalty: 0,
  spreadCloseMul: 0,
  spreadFarPenalty: 0,
  spreadPoiseMul: 0,
  homingPoison: 0,
  rapidBrandChance: 0,
  brandedMul: 0,
  unbrandedPenalty: 0,
  brokenMul: 0,
  corrodePoiseMul: 0,
  doomKillMana: 0,
  terrainDamageMul: 0,
  offTerrainPenalty: 0,
  slickDamageMul: 0,
  enemyOnTerrainMul: 0,
  terrainGuard: 0,
  terrainRegen: 0,
  terrainKillBlast: 0,
  burningKillFire: 0,
  dashIceTrail: 0,
  engagedGuard: 0,
  roamExposure: 0,
  engagedKillEnergy: 0,
  elementalGuard: 0,
  physicalExposure: 0,
  alternatePoiseMul: 0,
  repeatPoisePenalty: 0,
  switchMana: 0,
  alternateDamageStep: 0,
  alternateDamageCap: 0,
  elementBreak: 0,
  highHpDamageMul: 0,
  lowHpGuard: 0,
  triggerIcdCut: 0,
  gearMargin: 0,
  gearItems: 0,
  gearInscribed: 0,
  gearInverted: 0,
  gearOffColor: 0,
};

/**
 * 共鳴の種類。同時に 1 つだけ。
 * dominant = 支配（1 色 >= 50%）/ dual = 二重（上位 2 色が各 >= 30%）/
 * triad = 三和音（上位 3 色が各 >= 22%）/ scatter = 散光（全色 < 30%）/ none = なし
 */
export type ResonanceKind = "dominant" | "dual" | "triad" | "scatter" | "none";

export interface Resonance {
  kind: ResonanceKind;
  /** dominant は 1 色、dual は 2 色、triad は 3 色（TRAIT_COLORS 順）、scatter / none は空 */
  colors: TraitColor[];
  /** 色ごとの配合比（合計 1。性質が無ければ全部 0） */
  ratios: Record<TraitColor, number>;
  /**
   * 共鳴の変形（docs/ideas/loot-expansion.md 9-2 / 9-3）。kind は据え置いたまま効果だけを差し替える
   * （kind で分岐する他の仕組みを壊さない）。negative = 陰画（支配が裏返る。kind は dominant）/
   * balance = 拮抗（反対色の均衡。kind は dual）
   */
  form?: ResonanceForm;
  /** 星座（6 部位の主色の並び。共鳴とは別の層で同時に 1 つ）。computeStats が入れる */
  constellation?: ConstellationKey;
}

export type ResonanceForm = "negative" | "balance";

/** 星座の key（resonance.ts の CONSTELLATIONS） */
export const CONSTELLATION_KEYS = ["twins", "shores", "spine", "ring", "mirror", "void", "chain"] as const;
export type ConstellationKey = (typeof CONSTELLATION_KEYS)[number];

export function createEmptyResonance(): Resonance {
  return { kind: "none", colors: [], ratios: { crimson: 0, azure: 0, jade: 0, gold: 0, umbra: 0 } };
}

export type TriggerKind =
  | "onMeleeHit"
  | "onShoot"
  | "onKill"
  | "onJustDodge"
  | "onDash"
  | "onHurt"
  | "onRoomClear"
  | "everyNthMeleeHit"
  /** 敵を怯ませた瞬間（ボスのダウンを含む） */
  | "onStagger"
  /** カウンター（予備動作中の敵への近接）が成立した瞬間 */
  | "onCounter";

export type TriggerCondition =
  | "always"
  | "aboveHalfHp"
  | "belowHalfHp"
  | "comboAbove10"
  | "roomLocked"
  | "fullEnergy"
  // ---- 2026-09 追加（docs/ideas/loot-expansion.md 6-1）----
  | "manaFull"
  | "manaLow"
  | "selfAfflicted"
  /** 以下は対象（TriggerContext.targetId の敵）を見る。対象の無い起点とは組まない */
  | "targetInWindup"
  | "targetGuarded"
  | "targetMultiStatus"
  | "targetElite";

export type TriggerEffectKind =
  | "shockwave"
  | "spawnBullets"
  | "chainLightning"
  | "burnNearby"
  | "freezeNearby"
  | "explode"
  | "heal"
  | "damageBuff"
  | "speedBuff"
  | "energy"
  | "invuln"
  // ---- 2026-09 追加（docs/ideas/loot-expansion.md 6-2）----
  | "restoreMana"
  | "addPoise"
  /** 状態異常を付ける。種類は TriggeredEffect.status */
  | "inflict"
  | "cleanse"
  | "extendStatus"
  | "skillHaste"
  /** 照準方向へ射撃の弾を撃つ（射撃の性質が乗る） */
  | "volley"
  /** 失った HP の割合を回復する（誓約・性質の固定効果専用。文法からは出ない） */
  | "healMissing";

export interface TriggeredEffect {
  trigger: TriggerKind;
  /** everyNthMeleeHit の N */
  every?: number;
  condition: TriggerCondition;
  effect: TriggerEffectKind;
  /** 効果量（ダメージ・回復量・倍率加算など効果ごとに解釈） */
  magnitude: number;
  /** バフ系の持続秒 */
  duration?: number;
  /** spawnBullets の弾数など */
  count?: number;
  /** 発動確率 0..1 */
  chance: number;
  /** inflict の状態異常 */
  status?: StatusKind;
}

export const DEFAULT_STATS: Readonly<PlayerStats> = {
  maxHp: 100,
  hpRegen: 0,
  lifeOnHit: 0,
  lifeOnKill: 0,
  armor: 0,
  warding: 0,
  resist: uniformElements(0),
  damageTakenMul: 1,
  thorns: 0,

  moveSpeedMul: 1,
  dashCooldownMul: 1,
  dashCharges: 1,
  dashDistanceMul: 1,

  meleeDamageMul: 1,
  meleeDamageFlat: 0,
  attackSpeedMul: 1,
  meleeReachMul: 1,
  knockbackMul: 1,
  damageVsStaggeredMul: 1,

  rangedDamageMul: 1,
  rangedDamageFlat: 0,
  fireRateMul: 1,
  projectileCount: 1,
  pierce: 0,
  projectileSpeedMul: 1,

  critChance: 0.05,
  critMul: 1.5,

  energyGainMul: 1,
  burstDamageMul: 1,
  burstRadiusMul: 1,

  comboWindowBonus: 0,
  comboDamagePerStack: 0,
  comboDamageCap: 0,
  justDodgeDamageMul: 1,
  justDodgeWindow: 0,

  burnChance: 0,
  burnDps: 0,
  chillChance: 0,
  chillSlow: 0,
  shockChance: 0,
  shockDamage: 0,
  explodeOnKillChance: 0,
  explodeDamage: 0,

  keystones: [],
  triggers: [],
  resonance: createEmptyResonance(),

  attributes: uniformAttributes(ATTR.base),
  attributesEff: uniformAttributes(ATTR.base),
  maxMana: MANA.baseMax,
  manaRegen: MANA.baseRegen,
  manaGainMul: 1,
  manaCostMul: 1,
  manaOnKill: 0,
  skillDamageMul: 1,
  poiseDamageMul: 1,
  statusPotencyMul: 1,
  statusTakenMul: 1,
  bulletCut: 0,
  statusProcs: [],
  traits: DEFAULT_TRAIT_STATS,
  moveset: "sword",
  bullet: "pistol",
  infuse: uniformElements(0),
  skillNeutral: 0,
};
