import type { StatusKind, StatusProc } from "../core/status";
import { STATUS, TRIGGER } from "../data/tuning";
import { decodeTriggerRoll, formatTrigger, isTriggerKey } from "./triggers";
import { ATTR_KEYS, type AffixRoll, type AttrKey, type PlayerStats, type Slot, type TraitColor } from "./types";

/**
 * 性質（旧アフィックス）の定義（データ駆動）。docs/LOOT_DESIGN.md の「性質」を参照。
 * 各性質は期待値曲線（curve）と色（color、省略時は tags から colors.ts が決める）を持つ。
 * 値はすべて「表示単位」で保持する（+25% なら value = 25）。apply で PlayerStats の単位に変換する。
 * - 倍率系: % × 0.01 を *Mul に加算
 * - flat 系: そのまま加算
 * - 確率系: % × 0.01（0..1）
 */

/** % 表示値 → 内部値 */
const PERCENT = 0.01;

export type AffixTag =
  | "damage"
  | "melee"
  | "ranged"
  | "life"
  | "defense"
  | "speed"
  | "mobility"
  | "critical"
  | "burst"
  | "combo"
  | "elemental"
  | "utility"
  /** ステータス（筋力〜霊力）を足す・移す */
  | "attribute"
  /** 命中時に状態異常を付ける（PlayerStats.statusProcs） */
  | "status"
  /** 変換（A を B に変換する。"convert" 段階で適用） */
  | "conversion"
  /** 代償付き（label に代償も出す）。純粋な上位互換を作らないための枠 */
  | "tradeoff"
  /** マナ（最大・自然回復・回収・コスト）を動かす */
  | "mana"
  /** スキル（スキル石）に効く */
  | "skill";

/** ロール幅。value2 を持つアフィックスは min2/max2 も持つ */
export interface RollRange {
  min: number;
  max: number;
  min2?: number;
  max2?: number;
}

/**
 * 期待値曲線の点。旧 tier 表をそのまま「この深度ではこの幅の中央が期待値」という点列として読む
 * （flux.ts の nominalAt が深度で線形補間する）。段階としての tier はもう無い。
 */
export interface CurvePoint extends RollRange {
  /** この点の深度（旧 tier の minLevel） */
  depth: number;
}

/**
 * 適用段階。flat → scale → convert の順に畳み込む（例: max HP % は flat の max HP を全部足した後に掛ける）。
 * convert は変換の性質用で、scale の後・ソフトキャップと誓約の前に掛かる
 * （「盛った結果」を別の軸へ移す。誓約の数値効果は変換されない）
 */
export type ApplyStage = "flat" | "scale" | "convert";
export const APPLY_STAGES: readonly ApplyStage[] = ["flat", "scale", "convert"];

export type ApplyFn = (stats: PlayerStats, value: number, value2: number) => void;

/** 性質の定義（旧アフィックス。prefix / suffix の区別は廃止） */
export interface AffixDef {
  key: string;
  /** 表示テンプレ。{v} と {v2} を値で置換する */
  label: string;
  tags: readonly AffixTag[];
  slots: readonly Slot[];
  /** 期待値曲線（順不同。深度の昇順に並べ直して使う） */
  curve: readonly CurvePoint[];
  /** 色。省略時は tags から決める（colors.ts の colorFromTags） */
  color?: TraitColor;
  /** value の小数桁（省略時 0 = 整数） */
  decimals?: number;
  /** value2 の小数桁（省略時 0 = 整数） */
  decimals2?: number;
  /** 省略時 "flat" */
  stage?: ApplyStage;
  /**
   * value の上限（適用と表示の両方で切り詰める）。揺らぎで上振れしても超えさせたくない性質用
   * （例: 無敵の持続は TRIGGER.invulnMax まで）
   */
  cap?: number;
  apply: ApplyFn;
}

/** ベース固有の暗黙補正。アフィックスと同じ仕組みで適用・表示する */
export interface ImplicitDef {
  key: string;
  label: string;
  range: RollRange;
  decimals?: number;
  decimals2?: number;
  stage?: ApplyStage;
  apply: ApplyFn;
}

// ---------------------------------------------------------------------------
// 定義用ヘルパー
// ---------------------------------------------------------------------------

function trait(def: AffixDef): AffixDef {
  return def;
}

/** 期待値曲線の点（1 値） */
function t(depth: number, min: number, max: number): CurvePoint {
  return { depth, min, max };
}

/** 期待値曲線の点（2 値） */
function t2(depth: number, min: number, max: number, min2: number, max2: number): CurvePoint {
  return { depth, min, max, min2, max2 };
}

const pct = (v: number): number => v * PERCENT;

// スロットのよく使う組み合わせ
const MELEE_SLOTS: readonly Slot[] = ["weapon", "ring", "amulet"];
const RANGED_SLOTS: readonly Slot[] = ["gun", "ring", "amulet"];
const ATTACK_SLOTS: readonly Slot[] = ["weapon", "gun", "ring"];
const OFFENSE_SLOTS: readonly Slot[] = ["weapon", "gun", "ring", "amulet"];
const JEWELRY_SLOTS: readonly Slot[] = ["ring", "amulet"];

// ---------------------------------------------------------------------------
// ステータスの性質・状態異常の性質の部品
// ---------------------------------------------------------------------------

/** ステータスの表示名（docs/GLOSSARY.md）。resonance.ts の ATTR_LABEL と同じ表記（循環 import を避けて持つ） */
const ATTR_NAME: Readonly<Record<AttrKey, string>> = {
  str: "筋力",
  dex: "技巧",
  vit: "体力",
  mnd: "精神",
  spi: "霊力",
};

/** ステータスの色（docs/COMBAT_DESIGN.md A-1）。resonance.ts の COLOR_ATTR の逆引き */
export const ATTR_COLOR: Readonly<Record<AttrKey, TraitColor>> = {
  str: "crimson",
  dex: "azure",
  vit: "jade",
  mnd: "gold",
  spi: "umbra",
};

/** ステータスの性質の key（attr_str など） */
export const ATTR_TRAIT_PREFIX = "attr_";

/** ステータスを付けられる部位。その色の性質が出やすい部位に寄せる */
const ATTR_SLOTS: Readonly<Record<AttrKey, readonly Slot[]>> = {
  str: ["weapon", "armor", "ring", "amulet"],
  dex: ["gun", "boots", "ring", "amulet"],
  vit: ["armor", "boots", "ring", "amulet"],
  mnd: ["weapon", "gun", "ring", "amulet"],
  spi: ["gun", "armor", "ring", "amulet"],
};

/** 期待値: 深度 1 で 2、10 で 5、20 で 8（docs/COMBAT_DESIGN.md A-3） */
const ATTR_CURVE: readonly CurvePoint[] = [
  { depth: 20, min: 7, max: 9 },
  { depth: 10, min: 4, max: 6 },
  { depth: 1, min: 1, max: 3 },
];

/** ステータス 5 種の性質。flat 段階で attributes（生の値）に足す */
function attributeTraits(): AffixDef[] {
  return ATTR_KEYS.map((attr) => ({
    key: `${ATTR_TRAIT_PREFIX}${attr}`,
    label: `${ATTR_NAME[attr]} +{v}`,
    tags: ["attribute"],
    slots: ATTR_SLOTS[attr],
    curve: ATTR_CURVE,
    color: ATTR_COLOR[attr],
    apply: (s: PlayerStats, v: number) => {
      s.attributes[attr] += v;
    },
  }));
}

/** 効果量を持たない状態異常（沈黙・恐怖）の potency */
const NO_POTENCY = 0;
/** 性質 1 つが付ける状態異常のスタック */
const PROC_STACKS = 1;
/** bulletCut の加算値（0 より大きければ有効。値の大小に意味は無い） */
const BULLET_CUT_ON = 1;

function statusProc(kind: StatusKind, chancePct: number, duration: number, potency: number, on: StatusProc["on"]): StatusProc {
  return { kind, chance: pct(chancePct), stacks: PROC_STACKS, duration, potency, on };
}

/** 確率が 0 以下（反転・減衰で消えた）なら積まない */
function pushProc(stats: PlayerStats, proc: StatusProc): void {
  if (proc.chance <= 0) return;
  stats.statusProcs.push(proc);
}

// ---------------------------------------------------------------------------
// アフィックス一覧
// ---------------------------------------------------------------------------

export const AFFIXES: readonly AffixDef[] = [
  // ---- 近接 ----
  trait({
    key: "meleeDamagePct",
    label: "近接ダメージ +{v}%",
    tags: ["damage", "melee"],
    slots: MELEE_SLOTS,
    curve: [t(26, 50, 60), t(19, 40, 49), t(13, 30, 39), t(8, 21, 29), t(4, 13, 20), t(1, 6, 12)],
    apply: (s, v) => {
      s.meleeDamageMul += pct(v);
    },
  }),
  trait({
    key: "meleeDamageFlat",
    label: "近接ダメージ +{v}",
    tags: ["damage", "melee"],
    slots: ["weapon", "ring"],
    curve: [t(26, 14, 18), t(19, 10, 13), t(13, 7, 9), t(8, 5, 6), t(4, 3, 4), t(1, 1, 2)],
    apply: (s, v) => {
      s.meleeDamageFlat += v;
    },
  }),
  trait({
    key: "attackSpeed",
    label: "攻撃速度 +{v}%",
    tags: ["speed", "melee"],
    slots: MELEE_SLOTS,
    curve: [t(24, 14, 16), t(15, 10, 13), t(8, 7, 9), t(3, 4, 6), t(1, 2, 3)],
    apply: (s, v) => {
      s.attackSpeedMul += pct(v);
    },
  }),
  trait({
    key: "meleeReach",
    label: "リーチ +{v}%",
    tags: ["melee", "utility"],
    slots: ["weapon", "amulet"],
    curve: [t(18, 13, 18), t(8, 8, 12), t(1, 4, 7)],
    apply: (s, v) => {
      s.meleeReachMul += pct(v);
    },
  }),
  trait({
    key: "knockback",
    label: "ノックバック +{v}%",
    tags: ["melee", "utility"],
    slots: ["weapon", "armor"],
    curve: [t(16, 25, 40), t(8, 15, 24), t(1, 8, 14)],
    apply: (s, v) => {
      s.knockbackMul += pct(v);
    },
  }),
  trait({
    key: "damageVsStaggered",
    label: "怯み中の敵へのダメージ +{v}%",
    tags: ["damage", "melee"],
    slots: ["weapon", "ring"],
    curve: [t(26, 40, 55), t(16, 25, 39), t(8, 15, 24), t(1, 8, 14)],
    apply: (s, v) => {
      s.damageVsStaggeredMul += pct(v);
    },
  }),

  // ---- 射撃 ----
  trait({
    key: "rangedDamagePct",
    label: "射撃ダメージ +{v}%",
    tags: ["damage", "ranged"],
    slots: RANGED_SLOTS,
    curve: [t(26, 50, 60), t(19, 40, 49), t(13, 30, 39), t(8, 21, 29), t(4, 13, 20), t(1, 6, 12)],
    apply: (s, v) => {
      s.rangedDamageMul += pct(v);
    },
  }),
  trait({
    key: "rangedDamageFlat",
    label: "射撃ダメージ +{v}",
    tags: ["damage", "ranged"],
    slots: ["gun", "ring"],
    curve: [t(28, 7, 9), t(20, 5, 7), t(12, 3, 5), t(6, 2, 3), t(1, 1, 2)],
    apply: (s, v) => {
      s.rangedDamageFlat += v;
    },
  }),
  trait({
    key: "fireRate",
    label: "連射速度 +{v}%",
    tags: ["speed", "ranged"],
    slots: RANGED_SLOTS,
    curve: [t(24, 14, 16), t(15, 10, 13), t(8, 7, 9), t(3, 4, 6), t(1, 2, 3)],
    apply: (s, v) => {
      s.fireRateMul += pct(v);
    },
  }),
  trait({
    key: "projectiles",
    label: "弾数 +{v}、射撃ダメージ -{v2}%",
    tags: ["ranged", "tradeoff"],
    slots: ["gun", "amulet"],
    curve: [t2(30, 2, 2, 30, 40), t2(10, 1, 1, 15, 25)],
    apply: (s, v, v2) => {
      s.projectileCount += v;
      s.rangedDamageMul -= pct(v2);
    },
  }),
  trait({
    key: "pierce",
    label: "貫通 +{v}",
    tags: ["ranged"],
    slots: ["gun"],
    curve: [t(18, 2, 2), t(3, 1, 1)],
    apply: (s, v) => {
      s.pierce += v;
    },
  }),
  trait({
    key: "projectileSpeed",
    label: "弾速 +{v}%",
    tags: ["ranged", "speed"],
    slots: ["gun", "ring"],
    curve: [t(18, 19, 28), t(8, 11, 18), t(1, 6, 10)],
    apply: (s, v) => {
      s.projectileSpeedMul += pct(v);
    },
  }),

  // ---- 生存 ----
  trait({
    key: "maxLife",
    label: "最大HP +{v}",
    tags: ["life"],
    slots: ["armor", "boots", "ring", "amulet"],
    curve: [t(32, 61, 80), t(24, 46, 60), t(16, 31, 45), t(10, 21, 30), t(5, 11, 20), t(1, 5, 10)],
    apply: (s, v) => {
      s.maxHp += v;
    },
  }),
  trait({
    key: "maxLifePct",
    label: "最大HP +{v}%",
    tags: ["life"],
    slots: ["armor", "amulet"],
    curve: [t(30, 14, 18), t(20, 10, 13), t(12, 6, 9), t(5, 3, 5)],
    stage: "scale",
    apply: (s, v) => {
      s.maxHp *= 1 + pct(v);
    },
  }),
  trait({
    key: "hpRegen",
    label: "HP自然回復 +{v}/秒",
    tags: ["life"],
    slots: ["armor", "boots", "ring", "amulet"],
    curve: [t(28, 2.9, 4), t(20, 1.9, 2.8), t(12, 1.1, 1.8), t(6, 0.6, 1), t(1, 0.2, 0.5)],
    decimals: 1,
    apply: (s, v) => {
      s.hpRegen += v;
    },
  }),
  trait({
    key: "lifeOnHit",
    label: "命中時HP回復 +{v}",
    tags: ["life"],
    slots: ATTACK_SLOTS,
    curve: [t(26, 4, 5), t(16, 3, 3), t(8, 2, 2), t(1, 1, 1)],
    apply: (s, v) => {
      s.lifeOnHit += v;
    },
  }),
  trait({
    key: "lifeOnKill",
    label: "撃破時HP回復 +{v}",
    tags: ["life"],
    slots: ["weapon", "gun", "armor", "ring", "amulet"],
    curve: [t(25, 11, 15), t(15, 7, 10), t(7, 4, 6), t(1, 1, 3)],
    apply: (s, v) => {
      s.lifeOnKill += v;
    },
  }),
  trait({
    key: "armorFlat",
    label: "アーマー +{v}",
    tags: ["defense"],
    slots: ["armor", "boots", "ring"],
    curve: [t(28, 12, 16), t(20, 8, 11), t(12, 5, 7), t(6, 3, 4), t(1, 1, 2)],
    apply: (s, v) => {
      s.armor += v;
    },
  }),
  trait({
    key: "damageTaken",
    label: "被ダメージ -{v}%",
    tags: ["defense"],
    slots: ["armor", "amulet"],
    curve: [t(24, 6, 8), t(14, 4, 5), t(6, 2, 3)],
    apply: (s, v) => {
      s.damageTakenMul -= pct(v);
    },
  }),
  trait({
    key: "thorns",
    label: "攻撃者に{v}ダメージを反射",
    tags: ["defense", "damage"],
    slots: ["armor", "boots"],
    curve: [t(26, 17, 25), t(16, 10, 16), t(8, 5, 9), t(1, 2, 4)],
    apply: (s, v) => {
      s.thorns += v;
    },
  }),

  // ---- 機動 ----
  trait({
    key: "moveSpeed",
    label: "移動速度 +{v}%",
    tags: ["mobility", "speed"],
    slots: ["boots", "amulet"],
    curve: [t(30, 21, 25), t(22, 15, 20), t(13, 10, 14), t(6, 6, 9), t(1, 3, 5)],
    apply: (s, v) => {
      s.moveSpeedMul += pct(v);
    },
  }),
  trait({
    key: "dashCooldown",
    label: "ダッシュ再使用時間 -{v}%",
    tags: ["mobility"],
    slots: ["boots", "amulet"],
    curve: [t(26, 19, 25), t(16, 13, 18), t(8, 8, 12), t(1, 4, 7)],
    apply: (s, v) => {
      s.dashCooldownMul -= pct(v);
    },
  }),
  trait({
    key: "dashCharge",
    label: "ダッシュ回数 +{v}",
    tags: ["mobility"],
    slots: ["boots"],
    curve: [t(15, 1, 1)],
    apply: (s, v) => {
      s.dashCharges += v;
    },
  }),
  trait({
    key: "dashDistance",
    label: "ダッシュ距離 +{v}%",
    tags: ["mobility"],
    slots: ["boots"],
    curve: [t(18, 16, 24), t(8, 10, 15), t(1, 5, 9)],
    apply: (s, v) => {
      s.dashDistanceMul += pct(v);
    },
  }),

  // ---- クリティカル ----
  trait({
    key: "critChance",
    label: "会心率 +{v}%",
    tags: ["critical"],
    slots: OFFENSE_SLOTS,
    curve: [t(30, 7, 10), t(20, 5, 7), t(12, 3, 5), t(6, 2, 3), t(1, 1, 2)],
    apply: (s, v) => {
      s.critChance += pct(v);
    },
  }),
  trait({
    key: "critMultiplier",
    label: "会心倍率 +{v}%",
    tags: ["critical", "damage"],
    slots: OFFENSE_SLOTS,
    curve: [t(30, 39, 50), t(22, 28, 38), t(13, 19, 27), t(6, 11, 18), t(1, 5, 10)],
    apply: (s, v) => {
      s.critMul += pct(v);
    },
  }),

  // ---- 必殺 ----
  trait({
    key: "energyGain",
    label: "エネルギー獲得 +{v}%",
    tags: ["burst"],
    slots: ["weapon", "armor", "ring", "amulet"],
    curve: [t(25, 25, 35), t(15, 16, 24), t(7, 10, 15), t(1, 5, 9)],
    apply: (s, v) => {
      s.energyGainMul += pct(v);
    },
  }),
  trait({
    key: "burstDamage",
    label: "必殺ダメージ +{v}%",
    tags: ["burst", "damage"],
    slots: ["weapon", "amulet"],
    curve: [t(25, 40, 60), t(15, 25, 39), t(7, 15, 24), t(1, 8, 14)],
    apply: (s, v) => {
      s.burstDamageMul += pct(v);
    },
  }),
  trait({
    key: "burstRadius",
    label: "必殺範囲 +{v}%",
    tags: ["burst"],
    slots: ["armor", "amulet"],
    curve: [t(18, 17, 25), t(8, 10, 16), t(1, 5, 9)],
    apply: (s, v) => {
      s.burstRadiusMul += pct(v);
    },
  }),

  // ---- コンボ ----
  trait({
    key: "comboWindow",
    label: "コンボ猶予 +{v}秒",
    tags: ["combo"],
    slots: ["weapon", "boots", "ring", "amulet"],
    curve: [t(18, 0.9, 1.3), t(8, 0.5, 0.8), t(1, 0.2, 0.4)],
    decimals: 1,
    apply: (s, v) => {
      s.comboWindowBonus += v;
    },
  }),
  trait({
    key: "comboDamage",
    label: "コンボ1段階ごとにダメージ +{v}%（上限 {v2}%）",
    tags: ["combo", "damage"],
    slots: MELEE_SLOTS,
    curve: [t2(20, 2.3, 3, 26, 40), t2(10, 1.6, 2.2, 16, 25), t2(3, 1, 1.5, 10, 15)],
    decimals: 1,
    apply: (s, v, v2) => {
      s.comboDamagePerStack += pct(v);
      s.comboDamageCap += pct(v2);
    },
  }),
  trait({
    key: "justDodgeDamage",
    label: "ジャスト回避後 {v2}秒間ダメージ +{v}%",
    tags: ["combo", "damage"],
    slots: ["boots", "ring", "amulet"],
    curve: [t2(20, 36, 55, 2, 3), t2(10, 21, 35, 1.5, 2), t2(1, 10, 20, 1, 1.5)],
    decimals2: 1,
    apply: (s, v, v2) => {
      s.justDodgeDamageMul += pct(v);
      s.justDodgeWindow += v2;
    },
  }),

  // ---- 元素 / on-hit ----
  trait({
    key: "burn",
    label: "{v}%の確率で炎上（{v2}ダメージ/秒）",
    tags: ["elemental", "damage"],
    slots: ATTACK_SLOTS,
    curve: [t2(26, 18, 25, 15, 22), t2(16, 12, 17, 9, 14), t2(8, 7, 11, 5, 8), t2(1, 3, 6, 2, 4)],
    apply: (s, v, v2) => {
      s.burnChance += pct(v);
      s.burnDps += v2;
    },
  }),
  trait({
    key: "chill",
    color: "azure",
    label: "{v}%の確率で凍結、{v2}%減速",
    tags: ["elemental", "utility"],
    slots: ATTACK_SLOTS,
    curve: [t2(18, 12, 18, 23, 30), t2(9, 7, 11, 16, 22), t2(1, 3, 6, 10, 15)],
    apply: (s, v, v2) => {
      s.chillChance += pct(v);
      s.chillSlow += pct(v2);
    },
  }),
  trait({
    key: "shock",
    color: "gold",
    label: "{v}%の確率で感電、{v2}ダメージが連鎖",
    tags: ["elemental", "damage"],
    slots: ATTACK_SLOTS,
    curve: [t2(18, 12, 18, 13, 20), t2(9, 7, 11, 7, 12), t2(1, 3, 6, 3, 6)],
    apply: (s, v, v2) => {
      s.shockChance += pct(v);
      s.shockDamage += v2;
    },
  }),
  trait({
    key: "explodeOnKill",
    label: "撃破時{v}%の確率で爆発（{v2}ダメージ）",
    tags: ["elemental", "damage"],
    slots: ["weapon", "gun", "amulet"],
    curve: [t2(23, 16, 24, 21, 32), t2(13, 10, 15, 13, 20), t2(5, 5, 9, 8, 12)],
    apply: (s, v, v2) => {
      s.explodeOnKillChance += pct(v);
      s.explodeDamage += v2;
    },
  }),

  // ---- ハイブリッド ----
  trait({
    key: "hybridDamage",
    label: "近接・射撃ダメージ +{v}%",
    tags: ["damage", "melee", "ranged"],
    slots: JEWELRY_SLOTS,
    curve: [t(26, 19, 25), t(16, 13, 18), t(8, 8, 12), t(1, 4, 7)],
    apply: (s, v) => {
      s.meleeDamageMul += pct(v);
      s.rangedDamageMul += pct(v);
    },
  }),
  trait({
    key: "hybridDefense",
    label: "最大HP +{v}、アーマー +{v2}",
    tags: ["life", "defense"],
    slots: ["armor", "boots"],
    curve: [t2(18, 16, 24, 4, 6), t2(9, 9, 15, 2, 3), t2(1, 4, 8, 1, 1)],
    apply: (s, v, v2) => {
      s.maxHp += v;
      s.armor += v2;
    },
  }),
  trait({
    key: "hybridSpeed",
    label: "攻撃速度・連射速度 +{v}%",
    tags: ["speed", "melee", "ranged"],
    slots: JEWELRY_SLOTS,
    curve: [t(18, 8, 11), t(9, 5, 7), t(1, 2, 4)],
    apply: (s, v) => {
      s.attackSpeedMul += pct(v);
      s.fireRateMul += pct(v);
    },
  }),

  // ---- トレードオフ（value2 = 代償側の値）。同系統の純粋アフィックスより伸び幅が大きい ----
  trait({
    key: "crushing",
    label: "近接ダメージ +{v}%、攻撃速度 -{v2}%",
    tags: ["damage", "melee", "tradeoff"],
    slots: ["weapon"],
    curve: [t2(22, 55, 70, 12, 15), t2(12, 35, 50, 10, 12), t2(4, 20, 30, 8, 10)],
    apply: (s, v, v2) => {
      s.meleeDamageMul += pct(v);
      s.attackSpeedMul -= pct(v2);
    },
  }),
  trait({
    key: "frenzied",
    label: "攻撃速度 +{v}%、近接ダメージ -{v2}%",
    tags: ["speed", "melee", "tradeoff"],
    slots: ["weapon", "ring"],
    curve: [t2(20, 20, 26, 10, 12), t2(10, 14, 19, 8, 10), t2(2, 8, 13, 6, 8)],
    apply: (s, v, v2) => {
      s.attackSpeedMul += pct(v);
      s.meleeDamageMul -= pct(v2);
    },
  }),
  trait({
    key: "overcharged",
    label: "射撃ダメージ +{v}%、連射速度 -{v2}%",
    tags: ["damage", "ranged", "tradeoff"],
    slots: ["gun"],
    curve: [t2(22, 55, 70, 12, 15), t2(12, 35, 50, 10, 12), t2(4, 20, 30, 8, 10)],
    apply: (s, v, v2) => {
      s.rangedDamageMul += pct(v);
      s.fireRateMul -= pct(v2);
    },
  }),
  trait({
    key: "reckless",
    label: "移動速度 +{v}%、最大HP -{v2}",
    tags: ["mobility", "speed", "tradeoff"],
    slots: ["boots", "amulet"],
    curve: [t2(20, 18, 24, 15, 20), t2(10, 12, 17, 10, 15), t2(1, 7, 11, 5, 10)],
    apply: (s, v, v2) => {
      s.moveSpeedMul += pct(v);
      s.maxHp -= v2;
    },
  }),
  trait({
    key: "bloodbound",
    color: "umbra",
    label: "会心倍率 +{v}%、最大HP -{v2}",
    tags: ["critical", "damage", "tradeoff"],
    slots: JEWELRY_SLOTS,
    curve: [t2(22, 45, 60, 15, 20), t2(12, 30, 44, 10, 15), t2(3, 18, 29, 6, 10)],
    apply: (s, v, v2) => {
      s.critMul += pct(v);
      s.maxHp -= v2;
    },
  }),
  trait({
    key: "ironclad",
    label: "被ダメージ -{v}%、移動速度 -{v2}%",
    tags: ["defense", "tradeoff"],
    slots: ["armor"],
    curve: [t2(20, 10, 14, 8, 10), t2(10, 7, 9, 6, 8), t2(3, 4, 6, 4, 6)],
    apply: (s, v, v2) => {
      s.damageTakenMul -= pct(v);
      s.moveSpeedMul -= pct(v2);
    },
  }),
  trait({
    key: "razor",
    color: "umbra",
    label: "会心率 +{v}%、被ダメージ +{v2}%",
    tags: ["critical", "tradeoff"],
    slots: ["weapon", "ring"],
    curve: [t2(20, 8, 12, 8, 10), t2(10, 5, 7, 6, 8), t2(2, 3, 4, 4, 6)],
    apply: (s, v, v2) => {
      s.critChance += pct(v);
      s.damageTakenMul += pct(v2);
    },
  }),
  trait({
    key: "pike",
    label: "リーチ +{v}%、攻撃速度 -{v2}%",
    tags: ["melee", "utility", "tradeoff"],
    slots: ["weapon"],
    curve: [t2(16, 25, 35, 8, 10), t2(6, 15, 24, 5, 7), t2(1, 10, 14, 4, 5)],
    apply: (s, v, v2) => {
      s.meleeReachMul += pct(v);
      s.attackSpeedMul -= pct(v2);
    },
  }),
  trait({
    key: "flickering",
    label: "ダッシュ再使用時間 -{v}%、ダッシュ距離 -{v2}%",
    tags: ["mobility", "tradeoff"],
    slots: ["boots"],
    curve: [t2(18, 30, 40, 15, 20), t2(8, 20, 29, 10, 15), t2(1, 12, 19, 8, 10)],
    apply: (s, v, v2) => {
      s.dashCooldownMul -= pct(v);
      s.dashDistanceMul -= pct(v2);
    },
  }),

  // ---- シナジー網（docs/ideas/build-diversity.md 4 章）: 単体は凡庸、組み合わせで化ける ----
  trait({
    key: "emberMomentum",
    label: "攻撃速度 +{v}%、炎上ダメージ +{v2}/秒",
    tags: ["speed", "elemental", "melee"],
    slots: MELEE_SLOTS,
    curve: [t2(24, 10, 13, 9, 13), t2(14, 7, 9, 6, 8), t2(6, 4, 6, 4, 5), t2(1, 2, 3, 2, 3)],
    apply: (s, v, v2) => {
      s.attackSpeedMul += pct(v);
      s.burnDps += v2;
    },
  }),
  trait({
    key: "shatterEdge",
    color: "azure",
    label: "凍結確率 +{v}%、怯み中の敵へのダメージ +{v2}%",
    tags: ["elemental", "melee", "damage"],
    slots: ATTACK_SLOTS,
    curve: [t2(22, 14, 20, 30, 42), t2(12, 9, 13, 20, 29), t2(4, 5, 8, 12, 19)],
    apply: (s, v, v2) => {
      s.chillChance += pct(v);
      s.damageVsStaggeredMul += pct(v2);
    },
  }),
  trait({
    key: "chainedBarrage",
    label: "{v}%の確率で感電、弾数 +{v2}",
    tags: ["elemental", "ranged"],
    slots: RANGED_SLOTS,
    curve: [t2(26, 14, 20, 1, 1), t2(12, 8, 13, 1, 1)],
    apply: (s, v, v2) => {
      s.shockChance += pct(v);
      s.projectileCount += v2;
    },
  }),
  trait({
    key: "deepPiercing",
    label: "貫通 +{v}、弾速 -{v2}%",
    tags: ["ranged", "damage", "tradeoff"],
    slots: ["gun"],
    curve: [t2(20, 2, 2, 20, 28), t2(8, 1, 1, 12, 19)],
    apply: (s, v, v2) => {
      s.pierce += v;
      s.projectileSpeedMul -= pct(v2);
    },
  }),
  trait({
    key: "wallSlammer",
    label: "ノックバック +{v}%、移動速度 -{v2}%",
    tags: ["melee", "damage", "tradeoff"],
    slots: ["weapon", "armor"],
    curve: [t2(20, 45, 60, 12, 16), t2(8, 28, 44, 8, 11), t2(1, 15, 27, 5, 7)],
    apply: (s, v, v2) => {
      s.knockbackMul += pct(v);
      s.moveSpeedMul -= pct(v2);
    },
  }),
  trait({
    key: "vampiricRush",
    label: "命中時HP回復 +{v}、攻撃速度 +{v2}%",
    tags: ["life", "speed"],
    slots: ATTACK_SLOTS,
    curve: [t2(24, 4, 5, 9, 12), t2(12, 2, 3, 6, 8), t2(1, 1, 1, 3, 5)],
    apply: (s, v, v2) => {
      s.lifeOnHit += v;
      s.attackSpeedMul += pct(v2);
    },
  }),
  trait({
    key: "stormcaller",
    color: "gold",
    label: "感電連鎖ダメージ +{v}、射撃ダメージ -{v2}%",
    tags: ["elemental", "ranged", "tradeoff"],
    slots: RANGED_SLOTS,
    curve: [t2(22, 18, 26, 14, 18), t2(10, 11, 17, 9, 13), t2(2, 5, 10, 5, 8)],
    apply: (s, v, v2) => {
      s.shockDamage += v;
      s.rangedDamageMul -= pct(v2);
    },
  }),
  trait({
    key: "frostbite",
    label: "凍結減速 +{v}%、移動速度 -{v2}%",
    tags: ["elemental", "mobility", "tradeoff"],
    slots: ATTACK_SLOTS,
    curve: [t2(20, 25, 34, 14, 18), t2(8, 16, 24, 9, 13), t2(1, 8, 15, 5, 8)],
    apply: (s, v, v2) => {
      s.chillSlow += pct(v);
      s.moveSpeedMul -= pct(v2);
    },
  }),
  trait({
    key: "arcaneBattery",
    label: "エネルギー獲得 +{v}%、必殺ダメージ -{v2}%",
    tags: ["burst", "tradeoff"],
    slots: ["weapon", "armor", "ring", "amulet"],
    curve: [t2(20, 30, 42, 14, 18), t2(8, 18, 29, 9, 13), t2(1, 10, 17, 5, 8)],
    apply: (s, v, v2) => {
      s.energyGainMul += pct(v);
      s.burstDamageMul -= pct(v2);
    },
  }),
  trait({
    key: "gildedFang",
    label: "会心倍率 +{v}%、撃破時HP回復 +{v2}",
    tags: ["critical", "life"],
    slots: JEWELRY_SLOTS,
    curve: [t2(22, 30, 42, 8, 11), t2(10, 18, 29, 5, 7), t2(1, 8, 17, 2, 4)],
    apply: (s, v, v2) => {
      s.critMul += pct(v);
      s.lifeOnKill += v2;
    },
  }),

  // ---- トリガー文法へ落とすアフィックス: PlayerStats に無い条件付き効果を固定の tr: TriggeredEffect として encode ----
  trait({
    key: "dashStrike",
    label: "ダッシュ時: {v2}秒間ダメージ +{v}%",
    tags: ["mobility", "damage"],
    slots: ["boots", "ring", "amulet"],
    curve: [t2(22, 20, 28, 0.6, 0.8), t2(10, 13, 19, 0.5, 0.6), t2(2, 7, 12, 0.4, 0.5)],
    decimals2: 1,
    apply: (s, v, v2) => {
      s.triggers.push({ trigger: "onDash", condition: "always", effect: "damageBuff", magnitude: v, duration: v2, chance: 1 });
    },
  }),
  trait({
    key: "finisherMend",
    label: "10コンボ以上での撃破時: HP {v} 回復",
    tags: ["combo", "life"],
    slots: MELEE_SLOTS,
    curve: [t(24, 14, 20), t(12, 9, 13), t(1, 4, 8)],
    apply: (s, v) => {
      s.triggers.push({ trigger: "onKill", condition: "comboAbove10", effect: "heal", magnitude: v, chance: 1 });
    },
  }),
  trait({
    key: "wardedSanctuary",
    label: "封鎖された部屋で被弾時: {v2}秒間移動速度 +{v}%",
    tags: ["defense", "utility"],
    slots: ["armor", "boots"],
    curve: [t2(20, 22, 30, 1.5, 2), t2(8, 14, 21, 1, 1.4), t2(1, 8, 13, 0.6, 0.9)],
    decimals2: 1,
    apply: (s, v, v2) => {
      s.triggers.push({ trigger: "onHurt", condition: "roomLocked", effect: "speedBuff", magnitude: v, duration: v2, chance: 1 });
    },
  }),
  trait({
    key: "roomMender",
    label: "部屋クリア時: HP {v} 回復",
    tags: ["life", "utility"],
    slots: ["armor", "amulet"],
    curve: [t(20, 20, 28), t(8, 12, 19), t(1, 6, 11)],
    apply: (s, v) => {
      s.triggers.push({ trigger: "onRoomClear", condition: "always", effect: "heal", magnitude: v, chance: 1 });
    },
  }),
  trait({
    key: "energyReserve",
    label: "エネルギー満タン時に被弾: {v}秒間無敵",
    tags: ["burst", "defense"],
    slots: ["armor", "ring", "amulet"],
    curve: [t(24, 0.35, 0.4), t(10, 0.3, 0.4), t(1, 0.2, 0.3)],
    decimals: 1,
    cap: TRIGGER.invulnMax,
    apply: (s, v) => {
      s.triggers.push({ trigger: "onHurt", condition: "fullEnergy", effect: "invuln", magnitude: v, chance: 1 });
    },
  }),

  // ---- ステータス（docs/COMBAT_DESIGN.md A-3）: 色はそのステータスの色（紅 = 筋力 … 冥 = 霊力） ----
  ...attributeTraits(),

  // ---- 状態異常の付与（docs/COMBAT_DESIGN.md E-5）: PlayerStats.statusProcs に積む ----
  trait({
    key: "procBleed",
    color: "crimson",
    label: "近接命中時 {v}% で出血させる（10px 動くごとに {v2} ダメージ）",
    tags: ["status", "melee", "damage"],
    slots: MELEE_SLOTS,
    curve: [t2(20, 15, 20, 2.5, 3.5), t2(10, 10, 15, 1.5, 2.5), t2(1, 6, 10, 1, 1.5)],
    decimals2: 1,
    apply: (s, v, v2) => {
      pushProc(s, statusProc("bleed", v, STATUS.bleed.duration, v2, "melee"));
    },
  }),
  trait({
    key: "procPoison",
    color: "umbra",
    label: "命中時 {v}% で毒を与え、じわじわと削る",
    tags: ["status", "damage"],
    slots: ATTACK_SLOTS,
    curve: [t(22, 15, 20), t(12, 10, 15), t(3, 6, 10)],
    apply: (s, v) => {
      pushProc(s, statusProc("poison", v, STATUS.poison.duration, STATUS.poison.hpRatioPerSec, "any"));
    },
  }),
  trait({
    key: "procVulnerable",
    color: "umbra",
    label: "スキル命中時 {v}% で脆弱にする（受けるダメージが増える）",
    tags: ["status", "damage"],
    slots: OFFENSE_SLOTS,
    curve: [t(25, 22, 30), t(15, 16, 22), t(5, 10, 15)],
    apply: (s, v) => {
      pushProc(s, statusProc("vulnerable", v, STATUS.vulnerable.duration, STATUS.vulnerable.mul, "skill"));
    },
  }),
  trait({
    key: "procWeaken",
    color: "jade",
    label: "命中時 {v}% で弱体にする（敵の攻撃が弱まる）",
    tags: ["status", "defense"],
    slots: ["weapon", "gun", "armor", "ring"],
    curve: [t(24, 15, 20), t(14, 10, 15), t(4, 6, 10)],
    apply: (s, v) => {
      pushProc(s, statusProc("weaken", v, STATUS.weaken.duration, STATUS.weaken.mul, "any"));
    },
  }),
  trait({
    key: "procSilence",
    color: "azure",
    label: "射撃命中時 {v}% で沈黙させる（敵の弾・光線・爆弾を封じる）",
    tags: ["status", "ranged"],
    slots: RANGED_SLOTS,
    curve: [t(26, 14, 18), t(16, 10, 14), t(6, 6, 10)],
    apply: (s, v) => {
      pushProc(s, statusProc("silence", v, STATUS.silence.enemyDuration, NO_POTENCY, "ranged"));
    },
  }),
  trait({
    key: "procFear",
    color: "gold",
    label: "会心時 {v}% で恐怖させる（敵が逃げ惑い、攻撃をやめる）",
    tags: ["status", "critical"],
    slots: OFFENSE_SLOTS,
    curve: [t(28, 31, 40), t(18, 23, 30), t(8, 15, 22)],
    apply: (s, v) => {
      pushProc(s, { ...statusProc("fear", v, STATUS.fear.duration, NO_POTENCY, "any"), requiresCrit: true });
    },
  }),

  // ---- 弾斬り（docs/COMBAT_DESIGN.md C-1 の 6）: 既定では近接は敵弾を素通りする ----
  trait({
    key: "bulletCut",
    color: "azure",
    label: "近接攻撃で敵弾を斬り消す（リーチ -{v}%）",
    tags: ["melee", "defense"],
    slots: ["weapon"],
    curve: [t(4, 8, 12)],
    apply: (s, v) => {
      s.bulletCut += BULLET_CUT_ON;
      s.meleeReachMul -= pct(v);
    },
  }),

  // ---- マナ（docs/COMBAT_DESIGN.md B 節）。序盤は乏しいマナを装備で伸ばしていく ----
  trait({
    key: "maxManaFlat",
    label: "最大マナ +{v}",
    tags: ["mana", "skill"],
    slots: ["amulet", "ring", "armor"],
    curve: [t(26, 27, 33), t(12, 15, 20), t(1, 6, 10)],
    apply: (s, v) => {
      s.maxMana += v;
    },
  }),
  trait({
    key: "manaRegenFlat",
    label: "マナ自然回復 +{v}/秒",
    tags: ["mana", "skill"],
    // 兜の部位は無いので鎧で代える
    slots: ["amulet", "ring", "armor"],
    decimals: 1,
    curve: [t(26, 1.3, 1.7), t(12, 0.7, 1), t(1, 0.2, 0.4)],
    apply: (s, v) => {
      s.manaRegen += v;
    },
  }),
  trait({
    key: "manaGainPct",
    label: "マナ回収 +{v}%",
    tags: ["mana", "skill"],
    // 籠手の部位は無いので、通常攻撃を担う銃で代える
    slots: ["weapon", "gun", "ring"],
    curve: [t(26, 50, 60), t(12, 25, 35), t(1, 10, 15)],
    apply: (s, v) => {
      s.manaGainMul += pct(v);
    },
  }),
  trait({
    key: "manaCostPct",
    label: "スキルのコスト -{v}%、スキル威力 -{v2}%",
    tags: ["mana", "skill", "tradeoff"],
    slots: ["weapon", "amulet", "ring"],
    // 代償（v2）は利得の半分の幅で振る（コスト軽減だけの上位互換にしない）
    curve: [t2(26, 27, 32, 13, 16), t2(12, 15, 19, 7, 9), t2(1, 7, 9, 3, 4)],
    apply: (s, v, v2) => {
      s.manaCostMul -= pct(v);
      s.skillDamageMul -= pct(v2);
    },
  }),
  trait({
    key: "manaOnKillFlat",
    label: "撃破でマナ +{v}",
    tags: ["mana", "skill"],
    slots: ["weapon", "boots", "ring"],
    curve: [t(26, 7, 8), t(12, 4, 5), t(1, 2, 3)],
    apply: (s, v) => {
      s.manaOnKill += v;
    },
  }),
  trait({
    key: "manaDrought",
    label: "撃破でマナ +{v}、最大マナ -{v2}",
    tags: ["mana", "skill", "tradeoff"],
    slots: JEWELRY_SLOTS,
    // manaOnKillFlat より伸び幅が大きい代わりに器が縮む。名のある遺物「涸れ井戸の指輪」の核
    curve: [t2(22, 12, 14, 34, 40), t2(8, 9, 11, 28, 32)],
    apply: (s, v, v2) => {
      s.manaOnKill += v;
      s.maxMana -= v2;
    },
  }),
];

// ---------------------------------------------------------------------------
// 変換の性質: 「A を B に変換する」でビルドの向きを変える（BiS を潰す主力）。
// 通常の抽選プール（traitsFor）には入らず、性質の枠ごとに CONVERSION_TRAIT_CHANCE（generator.ts）、
// 名のある遺物の固定セット、クラフトの「染め」からも付く。stage は "convert"（scale の後）。
// value は変換割合（%）など。変換は反転しない（負の値の変換は何もしない）。
// ---------------------------------------------------------------------------

export const CONVERSION_KEY_PREFIX = "cv_";

/** 変換割合（%）の共通の期待値曲線。深いほど多く移す */
const CONVERSION_CURVE: readonly CurvePoint[] = [t(24, 56, 70), t(12, 43, 55), t(1, 30, 42)];
/** 近接ダメージ倍率 1.0 を移したときの burn DPS */
const BURN_DPS_PER_MELEE_MUL = 10;
/** 変換割合 1.0 あたりの burn 付与確率 */
const BURN_CHANCE_PER_FRACTION = 0.5;
/** 失った max HP 1 あたりの armor（armor 10 ≒ 被ダメ -17%） */
const ARMOR_PER_HP = 1 / 3;
/** 移した life on hit 1 あたりの energy gain 倍率 */
const ENERGY_PER_LIFE_ON_HIT = 0.15;
/** 移した life on kill 1 あたりの energy gain 倍率 */
const ENERGY_PER_LIFE_ON_KILL = 0.03;
/** 移したコンボ上限 1.0 あたりの JUST 回避ダメージ倍率 */
const JUST_PER_COMBO_CAP = 1.5;
/** 移した crit chance 1.0 あたりの burn chance */
const BURN_CHANCE_PER_CRIT = 2;
/** 移した crit chance 1.0 あたりの burn DPS */
const BURN_DPS_PER_CRIT = 50;
/** 分割→貫通: ダメージ倍率の下限（弾が多すぎても 0 にしない） */
const MIN_SPLIT_DAMAGE_FACTOR = 0.2;
const BASE_MULTIPLIER = 1;
const BASE_PROJECTILES = 1;
const REMAINING_DASH_CHARGES = 1;

/** ステータスの変換は 50% を基準にする（深さで割合は変えず、揺らぎだけで振れる） */
const ATTR_CONVERSION_CURVE: readonly CurvePoint[] = [t(1, 50, 50)];
const ATTR_CONVERSION_PAIRS: readonly (readonly [AttrKey, AttrKey])[] = [
  ["dex", "str"],
  ["str", "spi"],
  ["spi", "vit"],
  ["vit", "mnd"],
  ["mnd", "dex"],
];

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** 変換割合（0..1）。負の値は 0 */
const fraction = (v: number): number => Math.max(0, pct(v));

export const CONVERSION_AFFIXES: readonly AffixDef[] = [
  trait({
    key: "cv_meleeToBurn",
    label: "近接ダメージの{v}%を炎上に変換",
    tags: ["conversion", "melee", "elemental"],
    slots: MELEE_SLOTS,
    curve: CONVERSION_CURVE,
    stage: "convert",
    apply: (s, v) => {
      const f = fraction(v);
      const moved = s.meleeDamageMul * f;
      s.meleeDamageMul -= moved;
      s.burnChance += f * BURN_CHANCE_PER_FRACTION;
      s.burnDps += moved * BURN_DPS_PER_MELEE_MUL;
    },
  }),
  trait({
    key: "cv_splitToPierce",
    label: "拡散を貫通に変換: 追加弾1本ごとに射撃ダメージ -{v}%、貫通 +{v2}",
    tags: ["conversion", "ranged"],
    slots: RANGED_SLOTS,
    curve: [t2(24, 10, 14, 3, 3), t2(12, 15, 20, 2, 2), t2(1, 21, 25, 1, 1)],
    stage: "convert",
    apply: (s, v, v2) => {
      const extra = Math.max(0, s.projectileCount - BASE_PROJECTILES);
      const factor = Math.max(MIN_SPLIT_DAMAGE_FACTOR, 1 - fraction(v) * extra);
      s.rangedDamageMul *= factor;
      s.pierce += v2;
    },
  }),
  trait({
    key: "cv_critToMultiplier",
    label: "会心率をすべて会心倍率に変換（会心率1%につき +{v}%）",
    tags: ["conversion", "critical"],
    slots: OFFENSE_SLOTS,
    curve: [t(24, 5, 6), t(12, 4, 4), t(1, 3, 3)],
    stage: "convert",
    apply: (s, v) => {
      s.critMul += s.critChance * Math.max(0, v);
      s.critChance = 0;
    },
  }),
  trait({
    key: "cv_speedToAttack",
    label: "移動速度の上昇分の{v}%を攻撃速度に変換",
    tags: ["conversion", "speed", "melee"],
    slots: ["boots", "ring", "amulet"],
    curve: CONVERSION_CURVE,
    stage: "convert",
    apply: (s, v) => {
      const moved = Math.max(0, s.moveSpeedMul - BASE_MULTIPLIER) * fraction(v);
      s.moveSpeedMul -= moved;
      s.attackSpeedMul += moved;
    },
  }),
  trait({
    key: "cv_lifeToArmor",
    label: "最大HPの{v}%をアーマーに変換",
    tags: ["conversion", "life", "defense"],
    slots: ["armor", "amulet"],
    curve: [t(24, 36, 45), t(12, 26, 35), t(1, 18, 25)],
    stage: "convert",
    apply: (s, v) => {
      const moved = s.maxHp * fraction(v);
      s.maxHp -= moved;
      s.armor += moved * ARMOR_PER_HP;
    },
  }),
  trait({
    key: "cv_chargesToDistance",
    label: "ダッシュ回数を1残して消費: 消費1回につきダッシュ距離 +{v}%",
    tags: ["conversion", "mobility"],
    slots: ["boots"],
    curve: [t(24, 86, 100), t(12, 66, 85), t(1, 50, 65)],
    stage: "convert",
    apply: (s, v) => {
      s.dashDistanceMul += fraction(v) * s.dashCharges;
      s.dashCharges = REMAINING_DASH_CHARGES;
    },
  }),
  trait({
    key: "cv_leechToEnergy",
    label: "命中時・撃破時HP回復の{v}%をエネルギー獲得に変換",
    tags: ["conversion", "life", "burst"],
    slots: ["weapon", "gun", "ring", "amulet"],
    curve: CONVERSION_CURVE,
    stage: "convert",
    apply: (s, v) => {
      const f = fraction(v);
      const onHit = s.lifeOnHit * f;
      const onKill = s.lifeOnKill * f;
      s.lifeOnHit -= onHit;
      s.lifeOnKill -= onKill;
      s.energyGainMul += onHit * ENERGY_PER_LIFE_ON_HIT + onKill * ENERGY_PER_LIFE_ON_KILL;
    },
  }),
  trait({
    key: "cv_comboToJust",
    label: "コンボダメージの{v}%をジャスト回避ダメージに変換",
    tags: ["conversion", "combo"],
    slots: ["boots", "ring", "amulet"],
    curve: CONVERSION_CURVE,
    stage: "convert",
    apply: (s, v) => {
      const f = fraction(v);
      const movedCap = s.comboDamageCap * f;
      s.comboDamagePerStack -= s.comboDamagePerStack * f;
      s.comboDamageCap -= movedCap;
      s.justDodgeDamageMul += movedCap * JUST_PER_COMBO_CAP;
    },
  }),
  trait({
    key: "cv_meleeToRanged",
    label: "近接ダメージの上昇分の{v}%を射撃ダメージに変換",
    tags: ["conversion", "melee", "ranged"],
    slots: JEWELRY_SLOTS,
    curve: CONVERSION_CURVE,
    stage: "convert",
    apply: (s, v) => {
      const moved = Math.max(0, s.meleeDamageMul - BASE_MULTIPLIER) * fraction(v);
      s.meleeDamageMul -= moved;
      s.rangedDamageMul += moved;
    },
  }),
  trait({
    key: "cv_critToBurn",
    label: "会心率の{v}%を2倍の炎上確率に変換",
    tags: ["conversion", "critical", "elemental"],
    slots: ATTACK_SLOTS,
    curve: CONVERSION_CURVE,
    stage: "convert",
    apply: (s, v) => {
      const moved = s.critChance * fraction(v);
      s.critChance -= moved;
      s.burnChance += moved * BURN_CHANCE_PER_CRIT;
      s.burnDps += moved * BURN_DPS_PER_CRIT;
    },
  }),

  // ---- ステータスの変換（docs/COMBAT_DESIGN.md A-3）: 片方を捨てて片方を伸ばす交換 ----
  ...attributeConversions(),
];

/**
 * ステータスの変換 5 種。各ステータスが 1 回ずつ移し元・移し先になる輪
 * （技巧 → 筋力 → 霊力 → 体力 → 精神 → 技巧）。
 * convert 段階の attributes は基礎値と装備の合計なので、基礎値ごと移す（「技巧は 50% 減る」）。
 * 共鳴とラン内の振り分けは convert の後に足されるので移らない
 */
function attributeConversions(): AffixDef[] {
  return ATTR_CONVERSION_PAIRS.map(([from, to]) => ({
    key: `${CONVERSION_KEY_PREFIX}${from}To${capitalize(to)}`,
    label: `${ATTR_NAME[from]}の{v}%を${ATTR_NAME[to]}に変換`,
    tags: ["conversion", "attribute"],
    slots: JEWELRY_SLOTS,
    curve: ATTR_CONVERSION_CURVE,
    color: ATTR_COLOR[to],
    stage: "convert",
    apply: (s: PlayerStats, v: number) => {
      const moved = Math.max(0, s.attributes[from]) * fraction(v);
      s.attributes[from] -= moved;
      s.attributes[to] += moved;
    },
  }));
}

export function isConversionKey(key: string): boolean {
  return key.startsWith(CONVERSION_KEY_PREFIX);
}

/** slot に付けられ、depth で曲線が始まっている変換の性質 */
export function conversionsFor(slot: Slot, depth: number): AffixDef[] {
  return CONVERSION_AFFIXES.filter((d) => d.slots.includes(slot) && firstDepth(d) <= depth);
}

// ---------------------------------------------------------------------------
// マーカー: 旧形式の Corrupt 済みの印（"cr_corrupted"）。新形式には無い。
// 旧セーブの読み込み（profile.ts の migrateItem が落とす）と表示の互換のためだけに key を残す。
// ---------------------------------------------------------------------------

export const CORRUPTED_KEY = "cr_corrupted";

export function isMarkerKey(key: string): boolean {
  return key === CORRUPTED_KEY;
}

// ---------------------------------------------------------------------------
// 誓約（旧キーストーン）: 遊び方を変える大型改造。色は冥で固定。
// AffixRoll としては { key: "ks_xxx", value: 0, color: "umbra" } で保存する。
// apply で stats.keystones に key を積み、数値効果も掛ける（"scale" 段階。flat の合算後）。
// メカニクスの変更は戦闘側（src/system/keystones.ts）が stats.keystones.includes(key) で実装する。
// 同じ exclusiveGroup は同時に成立しない。computeStats は装備順で後勝ちの 1 つだけを apply する。
// ---------------------------------------------------------------------------

export const KEYSTONE_KEY_PREFIX = "ks_";
const KEYSTONE_VALUE = 0;
const KEYSTONE_COLOR: TraitColor = "umbra";

export type KeystoneGroup = "body" | "tempo" | "style" | "mana";

/** ks_overdraw（過負荷）のスキル威力の低下 */
const OVERDRAW_SKILL_PENALTY = 0.1;
/** ks_silentVow（静寂の誓い）のマナ自然回復の倍率とスキル威力の上昇 */
const SILENT_VOW_REGEN_MUL = 3;
const SILENT_VOW_SKILL_BONUS = 0.3;
/** ks_thirst（渇きの誓約）の自然回復。攻撃の回収 ×3 は src/system/keystones.ts の attackManaMul */
const THIRST_MANA_REGEN = 0;

export interface KeystoneDef {
  key: string;
  name: string;
  description: string;
  exclusiveGroup: KeystoneGroup;
  /** 数値効果（メカニクスは戦闘側）。stats.keystones への push は共通処理が行う */
  apply: (stats: PlayerStats) => void;
}

const noNumericEffect = (): void => {};

export const KEYSTONES: readonly KeystoneDef[] = [
  {
    key: "ks_glassCannon",
    name: "硝子の砲",
    description: "近接・射撃ダメージが2倍になる。最大HPが1/4になる。",
    exclusiveGroup: "body",
    apply: (s) => {
      s.meleeDamageMul += 1;
      s.rangedDamageMul += 1;
      s.maxHp *= 0.25;
    },
  },
  {
    key: "ks_juggernaut",
    name: "不動",
    description: "被ダメージが半減し、ノックバックを無視する。移動速度 -35%。",
    exclusiveGroup: "body",
    apply: (s) => {
      s.moveSpeedMul -= 0.35;
      s.damageTakenMul -= 0.5;
    },
  },
  {
    key: "ks_vampire",
    name: "吸血",
    description: "命中時HP回復 +3。HP自然回復とハート回収が無効になり、最大HP -30%。",
    exclusiveGroup: "body",
    apply: (s) => {
      s.lifeOnHit += 3;
      s.maxHp *= 0.7;
    },
  },
  {
    key: "ks_berserker",
    name: "狂戦士",
    description: "HPが減るほど最大+100%のダメージ。HP自然回復が無効になり、回復量が半減する。",
    exclusiveGroup: "tempo",
    apply: noNumericEffect,
  },
  {
    key: "ks_gambler",
    name: "賭博師",
    description: "全ての攻撃が0.2〜3倍のランダムなダメージになる。会心率 +10%。",
    exclusiveGroup: "tempo",
    apply: (s) => {
      s.critChance += 0.1;
    },
  },
  {
    key: "ks_overclock",
    name: "過駆動",
    description: "攻撃速度・連射速度 +60%。攻撃のたびにHPを1消費する。",
    exclusiveGroup: "tempo",
    apply: (s) => {
      s.attackSpeedMul += 0.6;
      s.fireRateMul += 0.6;
    },
  },
  {
    key: "ks_blink",
    name: "瞬歩",
    description: "ダッシュが瞬間移動になり着地時に爆発するが、無敵時間を失う。ダッシュ再使用時間 -30%。",
    exclusiveGroup: "style",
    apply: (s) => {
      s.dashCooldownMul -= 0.3;
    },
  },
  {
    key: "ks_pacifist",
    name: "不殺",
    description: "近接攻撃ができなくなる。射撃ダメージが3倍になり、弾数 +1。",
    exclusiveGroup: "style",
    apply: (s) => {
      s.rangedDamageMul += 2;
      s.projectileCount += 1;
    },
  },
  {
    key: "ks_bladeOath",
    name: "剣の誓い",
    description: "射撃ができなくなる。近接ダメージが2倍になり、攻撃速度 +20%。",
    exclusiveGroup: "style",
    apply: (s) => {
      s.meleeDamageMul += 1;
      s.attackSpeedMul += 0.2;
    },
  },
  {
    key: "ks_windWalker",
    name: "風走り",
    description: "ダッシュ回数 +2。ダッシュ再使用時間 +50%。",
    exclusiveGroup: "style",
    apply: (s) => {
      s.dashCharges += 2;
      s.dashCooldownMul += 0.5;
    },
  },
  // ---- マナ（docs/COMBAT_DESIGN.md F-2 の L5）。支払いと回収の規則は src/system/keystones.ts ----
  {
    key: "ks_overdraw",
    name: "過負荷",
    description: "マナが足りなくても、不足分をHPで払ってスキルを撃てる（マナ1につきHP0.5）。スキル威力 -10%。",
    exclusiveGroup: "mana",
    apply: (s) => {
      s.skillDamageMul -= OVERDRAW_SKILL_PENALTY;
    },
  },
  {
    key: "ks_silentVow",
    name: "静寂の誓い",
    description: "通常攻撃を当ててもマナが戻らない。マナの自然回復が3倍になり、スキル威力 +30%。",
    exclusiveGroup: "mana",
    apply: (s) => {
      s.manaRegen *= SILENT_VOW_REGEN_MUL;
      s.skillDamageMul += SILENT_VOW_SKILL_BONUS;
    },
  },
  {
    key: "ks_thirst",
    name: "渇きの誓約",
    description: "マナが自然回復しなくなる。通常攻撃を当てて戻るマナが3倍になる。",
    exclusiveGroup: "mana",
    // 誓約は全性質の後（computeStats の最後）に畳むので、+自然回復の性質の順序に依らず 0 になる
    apply: (s) => {
      s.manaRegen = THIRST_MANA_REGEN;
    },
  },
];

const KEYSTONE_BY_KEY: ReadonlyMap<string, KeystoneDef> = new Map(KEYSTONES.map((k) => [k.key, k]));

export function keystoneDef(key: string): KeystoneDef | undefined {
  return KEYSTONE_BY_KEY.get(key);
}

export function isKeystoneKey(key: string): boolean {
  return key.startsWith(KEYSTONE_KEY_PREFIX);
}

export function keystoneToRoll(def: KeystoneDef): AffixRoll {
  return { key: def.key, value: KEYSTONE_VALUE, color: KEYSTONE_COLOR };
}

/**
 * 排他グループを解決する。同じグループは後に出たものが勝ち、同じ key の重複と未知の key は落とす。
 * 結果は勝者の（最後の）出現順。
 */
export function resolveKeystones(keys: readonly string[]): string[] {
  const winnerByGroup = new Map<KeystoneGroup, { key: string; index: number }>();
  keys.forEach((key, index) => {
    const def = keystoneDef(key);
    if (def === undefined) return;
    winnerByGroup.set(def.exclusiveGroup, { key, index });
  });
  return [...winnerByGroup.values()].sort((a, b) => a.index - b.index).map((w) => w.key);
}

/** UI 警告用: 同じ排他グループに異なるキーストーンが 2 つ以上あるグループの一覧 */
export function keystoneConflicts(keys: readonly string[]): KeystoneDef[][] {
  const byGroup = new Map<KeystoneGroup, KeystoneDef[]>();
  for (const key of new Set(keys)) {
    const def = keystoneDef(key);
    if (def === undefined) continue;
    byGroup.set(def.exclusiveGroup, [...(byGroup.get(def.exclusiveGroup) ?? []), def]);
  }
  return [...byGroup.values()].filter((defs) => defs.length > 1);
}

// ---------------------------------------------------------------------------
// implicit（ベース固有）。key は "implicit." 始まりでアフィックスと衝突させない
// ---------------------------------------------------------------------------

export const IMPLICITS: readonly ImplicitDef[] = [
  // weapon
  {
    key: "implicit.dagger",
    label: "攻撃速度 +{v}%、会心率 +3%、近接ダメージ -20%、リーチ -15%",
    range: { min: 20, max: 30 },
    apply: (s, v) => {
      s.attackSpeedMul += pct(v);
      s.critChance += pct(3);
      s.meleeDamageMul -= pct(20);
      s.meleeReachMul -= pct(15);
    },
  },
  {
    key: "implicit.shortsword",
    label: "近接ダメージ +{v}%",
    range: { min: 8, max: 12 },
    apply: (s, v) => {
      s.meleeDamageMul += pct(v);
    },
  },
  {
    key: "implicit.longsword",
    label: "近接ダメージ +{v}%、リーチ +10%、攻撃速度 -5%",
    range: { min: 15, max: 22 },
    apply: (s, v) => {
      s.meleeDamageMul += pct(v);
      s.meleeReachMul += pct(10);
      s.attackSpeedMul -= pct(5);
    },
  },
  {
    key: "implicit.spear",
    label: "リーチ +{v}%、ノックバック +15%、近接ダメージ -10%",
    range: { min: 30, max: 40 },
    apply: (s, v) => {
      s.meleeReachMul += pct(v);
      s.knockbackMul += pct(15);
      s.meleeDamageMul -= pct(10);
    },
  },
  {
    key: "implicit.greatsword",
    label: "近接ダメージ +{v}%、リーチ +20%、攻撃速度 -25%",
    range: { min: 35, max: 45 },
    apply: (s, v) => {
      s.meleeDamageMul += pct(v);
      s.meleeReachMul += pct(20);
      s.attackSpeedMul -= pct(25);
    },
  },
  {
    key: "implicit.twinblades",
    label: "攻撃速度 +{v}%、リーチ -20%",
    range: { min: 30, max: 40 },
    apply: (s, v) => {
      s.attackSpeedMul += pct(v);
      s.meleeReachMul -= pct(20);
    },
  },
  {
    key: "implicit.warpick",
    label: "怯み中の敵へのダメージ +{v}%、ノックバック +25%、攻撃速度 -15%",
    range: { min: 40, max: 55 },
    apply: (s, v) => {
      s.damageVsStaggeredMul += pct(v);
      s.knockbackMul += pct(25);
      s.attackSpeedMul -= pct(15);
    },
  },
  // gun
  {
    key: "implicit.pistol",
    label: "射撃ダメージ +{v}%",
    range: { min: 5, max: 10 },
    apply: (s, v) => {
      s.rangedDamageMul += pct(v);
    },
  },
  {
    key: "implicit.smg",
    label: "連射速度 +{v}%、射撃ダメージ -30%",
    range: { min: 40, max: 60 },
    apply: (s, v) => {
      s.fireRateMul += pct(v);
      s.rangedDamageMul -= pct(30);
    },
  },
  {
    key: "implicit.rifle",
    label: "射撃ダメージ +{v}%、貫通 +1、弾速 +25%、連射速度 -20%",
    range: { min: 30, max: 40 },
    apply: (s, v) => {
      s.rangedDamageMul += pct(v);
      s.pierce += 1;
      s.projectileSpeedMul += pct(25);
      s.fireRateMul -= pct(20);
    },
  },
  {
    key: "implicit.shotgun",
    label: "弾数 +{v}、射撃ダメージ -40%、連射速度 -30%、弾速 -25%",
    range: { min: 2, max: 3 },
    apply: (s, v) => {
      s.projectileCount += v;
      s.rangedDamageMul -= pct(40);
      s.fireRateMul -= pct(30);
      s.projectileSpeedMul -= pct(25);
    },
  },
  {
    key: "implicit.revolver",
    label: "会心率 +{v}%、射撃ダメージ +20%、連射速度 -25%",
    range: { min: 8, max: 12 },
    apply: (s, v) => {
      s.critChance += pct(v);
      s.rangedDamageMul += pct(20);
      s.fireRateMul -= pct(25);
    },
  },
  {
    key: "implicit.railgun",
    label: "連射速度 -{v}%、貫通 +2、弾速 +25%",
    range: { min: 35, max: 45 },
    apply: (s, v) => {
      s.fireRateMul -= pct(v);
      s.pierce += 2;
      s.projectileSpeedMul += pct(25);
    },
  },
  // armor
  {
    key: "implicit.cloth",
    label: "最大HP +{v}、移動速度 +5%",
    range: { min: 5, max: 10 },
    apply: (s, v) => {
      s.maxHp += v;
      s.moveSpeedMul += pct(5);
    },
  },
  {
    key: "implicit.leather",
    label: "最大HP +{v}",
    range: { min: 12, max: 20 },
    apply: (s, v) => {
      s.maxHp += v;
    },
  },
  {
    key: "implicit.chain",
    label: "最大HP +{v}、アーマー +{v2}",
    range: { min: 20, max: 30, min2: 3, max2: 5 },
    apply: (s, v, v2) => {
      s.maxHp += v;
      s.armor += v2;
    },
  },
  {
    key: "implicit.plate",
    label: "アーマー +{v}、最大HP +20、移動速度 -8%",
    range: { min: 8, max: 12 },
    apply: (s, v) => {
      s.armor += v;
      s.maxHp += 20;
      s.moveSpeedMul -= pct(8);
    },
  },
  {
    key: "implicit.berserkerHide",
    label: "近接ダメージ +{v}%、被ダメージ +10%",
    range: { min: 12, max: 18 },
    apply: (s, v) => {
      s.meleeDamageMul += pct(v);
      s.damageTakenMul += pct(10);
    },
  },
  // boots
  {
    key: "implicit.sandals",
    label: "移動速度 +{v}%",
    range: { min: 4, max: 7 },
    apply: (s, v) => {
      s.moveSpeedMul += pct(v);
    },
  },
  {
    key: "implicit.boots",
    label: "ダッシュ距離 +{v}%",
    range: { min: 10, max: 15 },
    apply: (s, v) => {
      s.dashDistanceMul += pct(v);
    },
  },
  {
    key: "implicit.greaves",
    label: "ダッシュ再使用時間 -{v}%、アーマー +3",
    range: { min: 10, max: 15 },
    apply: (s, v) => {
      s.dashCooldownMul -= pct(v);
      s.armor += 3;
    },
  },
  {
    key: "implicit.wingedBoots",
    label: "ダッシュ回数 +1、移動速度 +{v}%",
    range: { min: 3, max: 5 },
    apply: (s, v) => {
      s.dashCharges += 1;
      s.moveSpeedMul += pct(v);
    },
  },
  {
    key: "implicit.lungingBoots",
    label: "ダッシュ距離 +{v}%、移動速度 -10%",
    range: { min: 15, max: 25 },
    apply: (s, v) => {
      s.dashDistanceMul += pct(v);
      s.moveSpeedMul -= pct(10);
    },
  },
  // ring
  {
    key: "implicit.ironRing",
    label: "最大HP +{v}",
    range: { min: 5, max: 10 },
    apply: (s, v) => {
      s.maxHp += v;
    },
  },
  {
    key: "implicit.rubyRing",
    label: "近接ダメージ +{v}%",
    range: { min: 4, max: 8 },
    apply: (s, v) => {
      s.meleeDamageMul += pct(v);
    },
  },
  {
    key: "implicit.sapphireRing",
    label: "射撃ダメージ +{v}%",
    range: { min: 4, max: 8 },
    apply: (s, v) => {
      s.rangedDamageMul += pct(v);
    },
  },
  {
    key: "implicit.goldRing",
    label: "会心率 +{v}%",
    range: { min: 1, max: 3 },
    apply: (s, v) => {
      s.critChance += pct(v);
    },
  },
  {
    key: "implicit.bloodRing",
    label: "撃破時HP回復 +{v}",
    range: { min: 1, max: 3 },
    apply: (s, v) => {
      s.lifeOnKill += v;
    },
  },
  {
    key: "implicit.voidBand",
    label: "会心倍率 +{v}%、最大HP -10",
    range: { min: 15, max: 25 },
    apply: (s, v) => {
      s.critMul += pct(v);
      s.maxHp -= 10;
    },
  },
  // amulet
  {
    key: "implicit.jadeAmulet",
    label: "エネルギー獲得 +{v}%",
    range: { min: 5, max: 10 },
    apply: (s, v) => {
      s.energyGainMul += pct(v);
    },
  },
  {
    key: "implicit.amberAmulet",
    label: "HP自然回復 +{v}/秒",
    range: { min: 0.2, max: 0.5 },
    decimals: 1,
    apply: (s, v) => {
      s.hpRegen += v;
    },
  },
  {
    key: "implicit.onyxAmulet",
    label: "会心倍率 +{v}%",
    range: { min: 8, max: 15 },
    apply: (s, v) => {
      s.critMul += pct(v);
    },
  },
  {
    key: "implicit.lapisAmulet",
    label: "必殺範囲 +{v}%",
    range: { min: 10, max: 15 },
    apply: (s, v) => {
      s.burstRadiusMul += pct(v);
    },
  },
  {
    key: "implicit.coralAmulet",
    label: "移動速度 +{v}%",
    range: { min: 3, max: 5 },
    apply: (s, v) => {
      s.moveSpeedMul += pct(v);
    },
  },
  {
    key: "implicit.duskAmulet",
    label: "必殺ダメージ +{v}%、エネルギー獲得 -8%",
    range: { min: 15, max: 25 },
    apply: (s, v) => {
      s.burstDamageMul += pct(v);
      s.energyGainMul -= pct(8);
    },
  },
];

// ---------------------------------------------------------------------------
// 参照 API
// ---------------------------------------------------------------------------

/** 通常の性質 + 変換の性質（変換は traitsFor の抽選プールには入らない） */
const AFFIX_BY_KEY: ReadonlyMap<string, AffixDef> = new Map(
  [...AFFIXES, ...CONVERSION_AFFIXES].map((d) => [d.key, d]),
);
const IMPLICIT_BY_KEY: ReadonlyMap<string, ImplicitDef> = new Map(IMPLICITS.map((d) => [d.key, d]));

export function affixDef(key: string): AffixDef | undefined {
  return AFFIX_BY_KEY.get(key);
}

export function implicitDef(key: string): ImplicitDef | undefined {
  return IMPLICIT_BY_KEY.get(key);
}

/** 期待値曲線が始まる深度（これより浅いと抽選されない） */
export function firstDepth(def: AffixDef): number {
  if (def.curve.length === 0) return Number.POSITIVE_INFINITY;
  return Math.min(...def.curve.map((p) => p.depth));
}

/** slot に付けられ、depth で曲線が始まっている通常の性質（変換は含まない） */
export function traitsFor(slot: Slot, depth: number): AffixDef[] {
  return AFFIXES.filter((d) => d.slots.includes(slot) && firstDepth(d) <= depth);
}

export type AffixSource = "affix" | "conversion" | "implicit" | "keystone" | "trigger" | "marker";

/**
 * ロール済みアフィックスの振る舞い。固定テーブル（affix / implicit / keystone）に無い
 * 動的 key（トリガー文法 "tr_..."）も復元できる。
 */
export interface ResolvedAffix {
  key: string;
  source: AffixSource;
  stage: ApplyStage;
  apply: (stats: PlayerStats, roll: AffixRoll) => void;
  format: (roll: AffixRoll) => string;
}

/** 符号付きテンプレ（"+{v}%" / "-{v}%"）に負の値が入ったとき（反転）の符号を整える */
function fixSigns(text: string): string {
  return text.replaceAll("+-", "-").replaceAll("--", "+");
}

function fillTemplate(label: string, roll: AffixRoll, decimals: number, decimals2: number): string {
  const v = roll.value.toFixed(decimals);
  const v2 = (roll.value2 ?? 0).toFixed(decimals2);
  return fixSigns(label.replaceAll("{v2}", v2).replaceAll("{v}", v));
}

/** 定義の上限（AffixDef.cap）で value を切り詰めた roll。上限が無ければそのまま */
function cappedRoll(def: AffixDef | ImplicitDef, roll: AffixRoll): AffixRoll {
  const cap = "cap" in def ? def.cap : undefined;
  if (cap === undefined || roll.value <= cap) return roll;
  return { ...roll, value: cap };
}

function resolveTable(def: AffixDef | ImplicitDef, source: AffixSource): ResolvedAffix {
  const decimals = def.decimals ?? 0;
  const decimals2 = def.decimals2 ?? 0;
  return {
    key: def.key,
    source,
    stage: def.stage ?? "flat",
    apply: (stats, roll) => {
      const r = cappedRoll(def, roll);
      def.apply(stats, r.value, r.value2 ?? 0);
    },
    format: (roll) => fillTemplate(def.label, cappedRoll(def, roll), decimals, decimals2),
  };
}

const KEYSTONE_LABEL = "【誓約】";
const CORRUPTED_LABEL = "腐敗の印（旧形式）";

const MARKER_RESOLVED: ResolvedAffix = {
  key: CORRUPTED_KEY,
  source: "marker",
  stage: "flat",
  apply: () => {},
  format: () => CORRUPTED_LABEL,
};

function resolveKeystone(def: KeystoneDef): ResolvedAffix {
  return {
    key: def.key,
    source: "keystone",
    stage: "scale",
    apply: (stats) => {
      stats.keystones.push(def.key);
      def.apply(stats);
    },
    format: () => `${KEYSTONE_LABEL}${def.name}: ${def.description}`,
  };
}

function resolveTrigger(roll: AffixRoll): ResolvedAffix | undefined {
  const effect = decodeTriggerRoll(roll);
  if (effect === null) return undefined;
  return {
    key: roll.key,
    source: "trigger",
    stage: "flat",
    apply: (stats, r) => {
      const decoded = decodeTriggerRoll(r);
      if (decoded !== null) stats.triggers.push(decoded);
    },
    format: (r) => {
      const decoded = decodeTriggerRoll(r);
      return decoded === null ? `不明な特性（${r.key}）` : formatTrigger(decoded);
    },
  };
}

/** AffixRoll から振る舞いを復元する。未知の key は undefined */
export function affixDefForRoll(roll: AffixRoll): ResolvedAffix | undefined {
  const affix = affixDef(roll.key);
  if (affix !== undefined) return resolveTable(affix, isConversionKey(affix.key) ? "conversion" : "affix");
  const implicit = implicitDef(roll.key);
  if (implicit !== undefined) return resolveTable(implicit, "implicit");
  const keystone = keystoneDef(roll.key);
  if (keystone !== undefined) return resolveKeystone(keystone);
  if (isTriggerKey(roll.key)) return resolveTrigger(roll);
  if (isMarkerKey(roll.key)) return MARKER_RESOLVED;
  return undefined;
}

/** 適用段階。未知の key は undefined */
export function rollStage(roll: AffixRoll): ApplyStage | undefined {
  return affixDefForRoll(roll)?.stage;
}

/**
 * ロール済みアフィックス（implicit / keystone / trigger 含む）を stats に適用する。
 * 未知の key（古いセーブ等）は無視して false を返す。
 */
export function applyRoll(stats: PlayerStats, roll: AffixRoll): boolean {
  const resolved = affixDefForRoll(roll);
  if (resolved === undefined) return false;
  resolved.apply(stats, roll);
  return true;
}

/** 表示文字列。implicit / 誓約 / trigger にも使える */
export function formatAffix(roll: AffixRoll): string {
  const resolved = affixDefForRoll(roll);
  if (resolved === undefined) return `不明な特性（${roll.key}）`;
  return resolved.format(roll);
}
