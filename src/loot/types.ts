import { type IncreasedTable, type MoreMul, createIncreased } from "../core/damage";
import { type ElementTable, uniformElements } from "../core/element";
import type { BoonAction } from "../core/build";
import type { Modifier, Rule } from "../core/rules";
import type { StatusKind, StatusProc } from "../core/status";
import type { Vec } from "../core/vec";
import type { HurtKind } from "../core/hurt";
import { ATTR, ECONOMY, MANA } from "../data/tuning";
import type { MovesetKey } from "../data/weapons";

/**
 * 装備システム（響き・揺らぎ・来歴）の共有型。docs/LOOT_DESIGN.md を参照。
 * 生成・集計・永続化・UI は全部この型を介してやり取りする。
 */

/**
 * 部位。右手 / 左手（旧「近接 / 銃」。docs/ideas/weapon-redesign.md 5 章）。
 * 左手（offHand）は将来の両手の仕組みの席取りで、今はベースが無く何も装備できない（LOOT_SLOTS で除く）
 */
export const SLOTS = ["mainHand", "offHand", "head", "armor", "boots", "ring", "amulet"] as const;
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
// 色（響き）。docs/LOOT_DESIGN.md「色（分類）と源と糧の共鳴」
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

/** 性質の出自。found = 拾った時点 / bud = 芽吹いた / named = 名のある遺物の固定 / innate = 地金（Item.innate） */
export type TraitOrigin = "found" | "bud" | "named" | "innate";

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
  /** 反転（値が負）。色は冥になる。共鳴の数えには入らない */
  inverted?: boolean;
  origin?: TraitOrigin;
  /** 旧セーブの脱色済みの印（脱色の操作は段取り 7d で廃止）。色を持たず、色の帯に数えない */
  colorless?: boolean;
  /** 旧セーブの張りの印（張りの操作は段取り 7d で廃止）。利得と代償を両方 1.3 倍にした値が入っている */
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
  /** ベース固有の暗黙補正（ロール済み）。共鳴の数え・色の帯には数えない */
  implicit: AffixRoll | null;
  /** 性質 */
  affixes: AffixRoll[];
  /**
   * 地金: ベースに既定で宿るステータス・防御力・耐性（loot/innate.ts）。性質とは別で、余白・共鳴の数え・クラフトの対象外。
   * 旧セーブ・リプレイのスナップショットには無いので、読むときは item.innate ?? []
   */
  innate?: AffixRoll[];
  /** 地金の上振れ（抽選した予算 ÷ 拾った深度の期待値）。持ち込むと今の深度の期待値に掛かる（loot/innate.ts の innateAt）。旧アイテムは migrate.ts が innate から補う */
  innateLuck?: number;
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
  /** "defeated"（死亡）/ "cleared"（踏破。最深の主を倒したラン）/ "abandoned"（R や Restart で中断） */
  cause?: string;
  // ---- 以下は段取り 9 の任意項目（docs/ideas/meta-impl.md 2-2）。0・空は書かない。旧データには無い ----
  /** 力尽きたときの最後の被弾（死因） */
  killer?: HistoryKiller;
  /** 仇の種（力尽きたときだけ。次のランの仇） */
  grudge?: HistoryGrudge;
  /** このランで仇を討った */
  avenged?: true;
  /** 位階（縛りの点の合計。0 は書かない） */
  tier?: number;
  /** ジョブの key（見習いは書かない） */
  job?: string;
  /** 被弾・見切り・カウンター・無傷の階の回数（前回比） */
  hurts?: number;
  justDodges?: number;
  counters?: number;
  noHurtFloors?: number;
}

export interface HistoryKiller {
  kind: HurtKind;
  key: string;
  elites?: string[];
  nemesis?: true;
}

export interface HistoryGrudge {
  key: string;
  elites: string[];
}

export interface ProfileMeta {
  runs: number;
  bestDepth: number;
  totalKills: number;
  bestScore: number;
  /** 追加フィールド。version は変えず、欠けていても loadProfile 側で補う */
  history?: RunHistoryEntry[];
  /** 踏破の回数と、踏破した最高位階（履歴は 20 件で切れるので別に持つ。0 / 無しは書かない） */
  clears?: number;
  bestClearTier?: number;
  /** 部位ごとに最後に候補を見たときの拾った時刻（新着の判定。ui/seen.ts。追加フィールドで version は変えない） */
  seenAt?: Partial<Record<Slot, number>>;
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
  return { mainHand: null, offHand: null, head: null, armor: null, boots: null, ring: null, amulet: null };
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

/** 筋力 / 技巧 / 体力 / 精神 / 霊力 / 防御 */
export const ATTR_KEYS = ["str", "dex", "vit", "mnd", "spi", "def"] as const;
export type AttrKey = (typeof ATTR_KEYS)[number];
export type Attributes = Record<AttrKey, number>;

/** ステータスの表示名（docs/GLOSSARY.md）。装備画面・振り分けパネル・Tips・流儀の説明で共有する */
export const ATTR_LABEL: Readonly<Record<AttrKey, string>> = {
  str: "筋力",
  dex: "技巧",
  vit: "体力",
  mnd: "精神",
  spi: "霊力",
  def: "防御",
};

/**
 * 「5 色 = 5 ステータス」の枠に乗る 5 種（防御を除く）。「5 種全部を参照する行動」の
 * 判定はこちら。防御は色を持たない別軸のステータスなので、5 種すべてを求めるテスト・ロジックはこちらを使う
 */
export const COMBAT_ATTR_KEYS = ["str", "dex", "vit", "mnd", "spi"] as const;

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
  return { str: value, dex: value, vit: value, mnd: value, spi: value, def: value };
}

/** 厳選の到達点の軸（無尽 / 燎原 / 常在。loot/reach.ts） */
export const REACH_KEYS = ["chain", "burn", "morale"] as const;
export type ReachKey = (typeof REACH_KEYS)[number];

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
  /** 防御力（物理の軽減。逓減式は system/combat.ts の armorReduction）。docs/COMBAT_DESIGN.md A-8。ステータスの「防御」`def` はこれと魔防を底上げする */
  armor: number;
  /** 魔防（魔法の軽減。armor と同じ逓減式）。混成の攻撃は防御力と魔防の平均で受ける */
  warding: number;
  /** 属性耐性（%、−100〜75 のソフトキャップは system/combat.ts の effectiveResist） */
  resist: ElementTable;
  damageTakenMul: number;
  thorns: number;

  moveSpeedMul: number;
  dashCooldownMul: number;
  dashCharges: number;
  dashDistanceMul: number;
  /** ダッシュの無敵時間の加算（秒。PLAYER.dash.invulnTime に足す。ダッシュ時間を超えない） */
  dashInvulnBonus: number;

  /**
   * 与ダメの増（core/damage.ts。0.1 = +10%）。性質・地金の数値はここへ足す（共鳴は倍で入る）。
   * 1 撃に効くタグの増を全部足して 1 回掛ける（system/damageMods.ts）
   */
  increased: IncreasedTable;
  /**
   * 装備・祝福・ジョブが出す常時の倍（誓約・芯・得意武器・素手・弱点など。出所ごと 1 要素）。
   * 列は複数の stats で共有されうるので push せず withMore で新しい列に差し替える
   */
  more: readonly MoreMul[];
  /** 装備が出す常時の増・倍（core/rules.ts の Modifier。条件付き・〜につき）。more と同じく差し替えで足す */
  modifiers: readonly Modifier[];
  /**
   * 装備が出す「〜時: 〜」（core/rules.ts の Rule。転じ・名のある遺物）。装備スロット順に畳み、collectRules が先頭で集める。
   * modifiers と同じく差し替えで足す
   */
  rules: readonly Rule[];

  meleeDamageFlat: number;
  attackSpeedMul: number;
  meleeReachMul: number;
  knockbackMul: number;

  rangedDamageFlat: number;
  fireRateMul: number;
  projectileCount: number;
  pierce: number;
  projectileSpeedMul: number;

  critChance: number;
  critMul: number;

  energyGainMul: number;
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

  // ---- 戦闘再設計（docs/COMBAT_DESIGN.md F-1）。既定値は中立 ----
  /** 装備・祝福の生の合計（逓減前）。基礎値を含む */
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
  poiseDamageMul: number;
  statusPotencyMul: number;
  /** プレイヤーが受ける状態異常の持続倍率 */
  statusTakenMul: number;
  /** 性質「弾斬り」: 0 より大きければ近接の active で敵弾を消す */
  bulletCut: number;
  /** 連鎖が同じ敵をもう 1 度訪れてよい回数（0 = 1 度だけ。system/rules.ts の訪問回数） */
  chainRevisits: number;
  /** 連鎖係数に掛ける上乗せ（× (1 + これ)。連鎖の源） */
  chainCoefBonus: number;
  statusProcs: StatusProc[];
  /** 性質のルール変更（docs/ideas/loot-expansion.md）。戦闘側は system/traitHooks.ts が読む */
  traits: TraitStats;
  /** 武器種（右手のベースが決める。src/data/weapons.ts） / 撃つ弾（銃のベースの key。src/loot/bullets.ts） */
  moveset: MovesetKey;
  /** 右手が空（素手）。型は拳（DEFAULT_MOVESET）のまま威力に WEAPON.unarmed.damageMul が掛かり、表示名は「素手」 */
  unarmed: boolean;
  bullet: string;
  /** 属性の変換: 近接・射撃（通常攻撃）の威力のうちその属性へ移す割合 0..1（none は使わない。合計は 1 で頭打ち） */
  infuse: ElementTable;
  /** スキルの属性のうち無属性へ戻す割合 0..1（無の刻印） */
  skillNeutral: number;
  /** 戦意の上限への加算（武器の型の max に足す。system/morale.ts。性質・祝福で使うのは段取り 7） */
  moraleMaxAdd: number;
  /** 戦意の溜まりやすさの倍率（1 = 等倍。導出の型には効かない） */
  moraleGainMul: number;
  /** 銭・鍵を引き寄せる半径の倍率（ECONOMY.coin.magnetRadius に掛ける。system/economy.ts） */
  coinMagnetMul: number;
  /** 被弾でこぼれる銭の倍率（ECONOMY.spill.ratio に掛ける。0 でこぼれない） */
  coinSpillMul: number;
  /** 稼ぐ銭の倍率（こぼれた銭の拾い直し・賭けの払い戻しには掛けない） */
  coinGainMul: number;
  /** 持てる瓶の本数（既定は ECONOMY.flask.max。system/flask.ts） */
  flaskMax: number;
  /** 自分が敵に付ける状態異常の重ねの上限への加算（種類ごと。system/statusEffects.ts の maxStacks が敵側だけに足す） */
  statusStackCapBonus: Readonly<Partial<Record<StatusKind, number>>>;
  /** 加護の枠の加算（行動ごと。名のある遺物の 3 枠目。system/boons.ts の graceSlotsOf が足す） */
  graceSlotBonus: Readonly<Partial<Record<BoonAction, number>>>;
  /** 厳選の到達点の測る量（装備だけ。computeStats が入れる。loot/reach.ts） */
  reach: Readonly<Record<ReachKey, number>>;
}

/**
 * 性質が持ち込むルール変更の数値。すべて 0 が「効果なし」。% 系は 0.01 単位の加算値（+25% なら 0.25）。
 * 数値のフィールドを PlayerStats の直下に増やすと statsSummary の表示表まで広がるので、ここにまとめる
 */
export interface TraitStats {
  // ---- 気力 ----
  /** 敵を怯ませた瞬間に戻る気力 */
  manaOnStagger: number;
  /** 身代わり: 被弾時に払う気力（0 = 無効）。払えれば被ダメージが TRIGGER.trait.manaShieldMul 倍 */
  manaShieldCost: number;
  /** 気力満タンで溢れた回収のうち、奥義ゲージへ移す割合 0..1 */
  manaOverflowToEnergy: number;
  // ---- 怯み値 ----
  /** 蓄積が耐性の半分以上の敵への怯み値（楔） */
  wedgePoiseMul: number;
  /** 射撃の怯み値の加算倍率（ベースの弩・転じ「弾数 → 怯み値」） */
  rangedPoiseMul: number;
  /** 会心時の怯み値の加算倍率（ベースの細剣） */
  critPoiseMul: number;
  /** 堅守による怯み値の減衰を打ち消す割合 0..1（剥がし。近接・射撃とも） */
  guardPierce: number;
  /** 敵を怯ませた瞬間、周囲の敵に与える怯み値（崩れの反響） */
  staggerQuake: number;
  // ---- その他 ----
  /** 1 以上: 殲滅の瞬間に敵弾をすべて消す（幕引き） */
  lastKillClearsBullets: number;
  /** 殲滅で得るエネルギー */
  lastKillEnergy: number;
  // ---- 作業領域（LootRuntime / Enemy.stuckShots）を使うもの ----
  /** 余韻斬り: コンボが途切れた瞬間、コンボ数 1 あたりの衝撃波のダメージ */
  comboBreakWave: number;
  /** 形見: 状態異常の敵を倒したとき、その 1 種を乗せる次の命中の回数 */
  inheritCharges: number;
  /** 撃ち込み杭: 刺さった弾 1 本あたりの、次の近接命中で爆ぜるダメージ */
  stakeDamage: number;
  /** 置き土産: 0 より大きければ、自分の設置物の範囲内での近接がその設置物の状態異常をこの秒数乗せる */
  placedInfuse: number;
  /** 血の署名: HP 半分未満の間、スキルの再使用時間と最低間隔が明ける速さの加算倍率 */
  lowHpSkillHaste: number;
  // ---- 属性（combat.ts の genreAndElement から traitElementMul が読む）----
  /** 弱点を突いた命中の与ダメージ */
  weakDamageMul: number;
  /** 弱点を突いた命中で戻る気力（ベースの水晶杖） */
  weakHitMana: number;
  /** 耐性に阻まれた命中で、攻撃の主な属性の状態異常を付ける秒（0 = 無効） */
  resistedInflict: number;
  /** 濡れ・浸水の敵への与ダメージ（雷の割合が大きいほど伸びる） */
  wetConductMul: number;
  /** 油膜の敵への与ダメージ（炎の割合が大きいほど伸びる） */
  oiledIgniteMul: number;
  // ---- 武器種・銃の弾 ----
  /** 溜めの段 1 つにつきの近接の与ダメージ */
  chargedMeleeMul: number;
  /** 溜めの段 1 つにつきの怯み値（ベースの大連接棍） */
  chargedPoiseMul: number;
  /** コンボ派生の命中の与ダメージ（ベースの刀）/ 命中で戻る気力 */
  branchDamageMul: number;
  branchHitMana: number;
  /** 散弾の射撃: 近い敵への与ダメージ（ベースのラッパ銃） */
  spreadCloseMul: number;
  /** 連射の射撃の命中で烙印を付ける確率 0..1 */
  rapidBrandChance: number;
  // ---- 地形 ----
  /** 地形の上にいる敵への与ダメージ（ベースの撒き菱） */
  enemyOnTerrainMul: number;
  /** 自分が地形の上に立つ間の被ダメージの減少（ベースの蓑） */
  terrainGuard: number;
  /** 地形の上に立つ間の毎秒の回復（戦闘中の共通上限を受ける） */
  terrainRegen: number;
  /** 地形の上にいる敵を倒すと、その地形に応じた衝撃波（ダメージ） */
  terrainKillBlast: number;
  /** 燃えている敵を倒すと足元に炎を置く秒 */
  burningKillFire: number;
  /** ダッシュ中に足元へ氷床を置く秒 */
  dashIceTrail: number;
  // ---- 被ダメージ ----
  /** 交戦中の被ダメージの減少 */
  engagedGuard: number;
  /** 近接を振っている間（予備動作〜攻撃判定）の被ダメージの減少（構え） */
  stanceGuard: number;
  /** 0 より大: 被弾で押し戻されず、立ち止まっている間の被ダメージがこの割合だけ減る（踏ん張り） */
  unmoving: number;
  // ---- 攻撃手段の持ち替え（近接 / 射撃 / スキル） ----
  /** 直前と違う手段で当てるたびに戻る気力 */
  switchMana: number;
  /** 怯ませた敵に、武器の主な属性の状態異常を付ける秒 */
  elementBreak: number;
  // ---- 旧 色の共鳴が持ち込んでいた欄（段取り 7d で書く所が無くなった。読む system/traitHooks.ts と一緒に消す）----
  /** 直前と違う手段で当てた命中の怯み値 / 同じ手段が続いた命中の減少 */
  alternatePoiseMul: number;
  repeatPoisePenalty: number;
  /** 近接と射撃を交互に当てるたびに重なる与ダメージ（1 段）と上限 */
  alternateDamageStep: number;
  alternateDamageCap: number;
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
  /** 直前に当てた攻撃手段（持ち替えの性質が読む） */
  lastMode: AttackMode | null;
  /** 旧共鳴「天秤」の名残: 近接と射撃を交互に当て続けた回数と、途切れるまでの残り秒 */
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
  manaShieldCost: 0,
  manaOverflowToEnergy: 0,
  wedgePoiseMul: 0,
  rangedPoiseMul: 0,
  critPoiseMul: 0,
  guardPierce: 0,
  staggerQuake: 0,
  lastKillClearsBullets: 0,
  lastKillEnergy: 0,
  comboBreakWave: 0,
  inheritCharges: 0,
  stakeDamage: 0,
  placedInfuse: 0,
  lowHpSkillHaste: 0,
  weakDamageMul: 0,
  weakHitMana: 0,
  resistedInflict: 0,
  wetConductMul: 0,
  oiledIgniteMul: 0,
  chargedMeleeMul: 0,
  chargedPoiseMul: 0,
  branchDamageMul: 0,
  branchHitMana: 0,
  spreadCloseMul: 0,
  rapidBrandChance: 0,
  enemyOnTerrainMul: 0,
  terrainGuard: 0,
  terrainRegen: 0,
  terrainKillBlast: 0,
  burningKillFire: 0,
  dashIceTrail: 0,
  engagedGuard: 0,
  stanceGuard: 0,
  unmoving: 0,
  switchMana: 0,
  elementBreak: 0,
  alternatePoiseMul: 0,
  repeatPoisePenalty: 0,
  alternateDamageStep: 0,
  alternateDamageCap: 0,
  highHpDamageMul: 0,
  lowHpGuard: 0,
  triggerIcdCut: 0,
  gearMargin: 0,
  gearItems: 0,
  gearInscribed: 0,
  gearInverted: 0,
  gearOffColor: 0,
};

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
  dashInvulnBonus: 0,

  // 既定は凍らせる（{ ...DEFAULT_STATS } の浅い写しから書き換えて既定を汚さない。複製は stats.ts の createBaseStats）
  increased: Object.freeze(createIncreased()),
  more: Object.freeze([]),
  modifiers: Object.freeze([]),
  rules: Object.freeze([]),

  meleeDamageFlat: 0,
  attackSpeedMul: 1,
  meleeReachMul: 1,
  knockbackMul: 1,

  rangedDamageFlat: 0,
  fireRateMul: 1,
  projectileCount: 1,
  pierce: 0,
  projectileSpeedMul: 1,

  critChance: 0.05,
  critMul: 1.5,

  energyGainMul: 1,
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

  attributes: uniformAttributes(ATTR.base),
  attributesEff: uniformAttributes(ATTR.base),
  maxMana: MANA.baseMax,
  manaRegen: MANA.baseRegen,
  manaGainMul: 1,
  manaCostMul: 1,
  manaOnKill: 0,
  poiseDamageMul: 1,
  statusPotencyMul: 1,
  statusTakenMul: 1,
  bulletCut: 0,
  chainRevisits: 0,
  chainCoefBonus: 0,
  statusProcs: [],
  traits: DEFAULT_TRAIT_STATS,
  moveset: "sword",
  unarmed: false,
  bullet: "pistol",
  infuse: uniformElements(0),
  skillNeutral: 0,
  moraleMaxAdd: 0,
  moraleGainMul: 1,
  coinMagnetMul: 1,
  coinSpillMul: 1,
  coinGainMul: 1,
  flaskMax: ECONOMY.flask.max,
  statusStackCapBonus: Object.freeze({}),
  graceSlotBonus: Object.freeze({}),
  reach: Object.freeze({ chain: 0, burn: 0, morale: 0 }),
};
