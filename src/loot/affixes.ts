import { BALANCE } from "../data/balance";
import { ELEMENTS, ELEMENT_LABEL, type Element } from "../core/element";
import type { StatusKind, StatusProc } from "../core/status";
import { formatMeters } from "../core/units";
import { HEAL, KEYSTONE, STATUS, TRIGGER } from "../data/tuning";
import { decodeTriggerRoll, formatTrigger, isTriggerKey } from "./triggers";
import {
  ATTR_KEYS,
  SLOTS,
  type AffixRoll,
  type AttrKey,
  type PlayerStats,
  type Slot,
  type TraitColor,
  type TriggeredEffect,
} from "./types";

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

/** 期待値曲線の実体（数値だけの点列）。src/data/balance/loot/ の "affixCurves" */
const CURVES = BALANCE.loot.affixCurves;

/** 性質の key で期待値曲線を引く。JSON にキーが無ければ tsc がここで落ちる（キーは AffixDef.key と同じ） */
function curveFor(key: keyof typeof CURVES): readonly CurvePoint[] {
  return CURVES[key];
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
  /**
   * 右手の家系を絞る（docs/ideas/weapon-redesign.md 5.2）。省略は家系を問わない。
   * mainHand を含む性質だけが意味を持つ（ring / amulet では常に出る）
   */
  family?: "melee" | "gun";
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
  /**
   * 目覚め（芽専用の性質）。ドロップ・染め・芽の通常の抽選には出ず、
   * provenance.ts の節目が名指ししたときだけ芽の片方に出る
   */
  awakening?: boolean;
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

const pct = (v: number): number => v * PERCENT;

// スロットのよく使う組み合わせ
const MELEE_SLOTS: readonly Slot[] = ["mainHand", "ring", "amulet"];
const RANGED_SLOTS: readonly Slot[] = ["mainHand", "ring", "amulet"];
const ATTACK_SLOTS: readonly Slot[] = ["mainHand", "ring"];
const OFFENSE_SLOTS: readonly Slot[] = ["mainHand", "ring", "amulet"];
const JEWELRY_SLOTS: readonly Slot[] = ["ring", "amulet"];
const ALL_SLOTS: readonly Slot[] = SLOTS;

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
  str: ["mainHand", "armor", "ring", "amulet"],
  dex: ["mainHand", "boots", "ring", "amulet"],
  vit: ["armor", "boots", "ring", "amulet"],
  mnd: ["mainHand", "ring", "amulet"],
  spi: ["mainHand", "armor", "ring", "amulet"],
};

/** 期待値曲線（属性ごとに同じ形。docs/COMBAT_DESIGN.md A-3）。attr_str など key ごとに JSON から引く */
const ATTR_TRAIT_CURVES: Readonly<Record<AttrKey, readonly CurvePoint[]>> = {
  str: curveFor("attr_str"),
  dex: curveFor("attr_dex"),
  vit: curveFor("attr_vit"),
  mnd: curveFor("attr_mnd"),
  spi: curveFor("attr_spi"),
};

/** ステータス 5 種の性質。flat 段階で attributes（生の値）に足す */
function attributeTraits(): AffixDef[] {
  return ATTR_KEYS.map((attr) => ({
    key: `${ATTR_TRAIT_PREFIX}${attr}`,
    label: `${ATTR_NAME[attr]} +{v}`,
    tags: ["attribute"],
    slots: ATTR_SLOTS[attr],
    curve: ATTR_TRAIT_CURVES[attr],
    color: ATTR_COLOR[attr],
    apply: (s: PlayerStats, v: number) => {
      s.attributes[attr] += v;
    },
  }));
}

/** 祝福の響きの色ごとの対応（表示）。判定は system/traitHooks.ts の BOON_ECHO_TAGS */
const BOON_ECHO_TEXT: Readonly<Record<TraitColor, string>> = {
  crimson: "近接・燃焼",
  azure: "射撃・ダッシュ・気力",
  jade: "生命・部屋",
  gold: "コンボ・会心・奥義ゲージ・感電",
  umbra: "呪い付き",
};
const BOON_ECHO_FIELD = {
  crimson: "boonEchoCrimson",
  azure: "boonEchoAzure",
  jade: "boonEchoJade",
  gold: "boonEchoGold",
  umbra: "boonEchoUmbra",
} as const satisfies Record<TraitColor, string>;
/** 祝福の響きの key の接頭辞（色ごとに 1 つ。boonEcho_crimson など） */
export const BOON_ECHO_PREFIX = "boonEcho_";

/** 期待値曲線（色ごとに同じ形）。boonEcho_crimson など key ごとに JSON から引く */
const BOON_ECHO_CURVES: Readonly<Record<TraitColor, readonly CurvePoint[]>> = {
  crimson: curveFor("boonEcho_crimson"),
  azure: curveFor("boonEcho_azure"),
  jade: curveFor("boonEcho_jade"),
  gold: curveFor("boonEcho_gold"),
  umbra: curveFor("boonEcho_umbra"),
};

/**
 * 祝福の響き（ハブ性質 P93）: 色ごとに 1 つ。その色に対応するタグの祝福 1 つにつき与ダメージ +{v}%、
 * 対応しない祝福 1 つにつき -2%（TRIGGER.trait.boonEchoOffPenalty）。装備と祝福の色を揃える理由を作る
 */
function boonEchoTraits(): AffixDef[] {
  const colors: readonly TraitColor[] = ["crimson", "azure", "jade", "gold", "umbra"];
  return colors.map((color) => ({
    key: `${BOON_ECHO_PREFIX}${color}`,
    label: `祝福の響き: ${BOON_ECHO_TEXT[color]}の祝福 1 つにつき与ダメージ +{v}%（それ以外の祝福 1 つにつき -${ratioPct(TRIGGER.trait.boonEchoOffPenalty)}%）`,
    // 代償（対応しない祝福の −2%）は固定値なので tradeoff（{v2} を持つ代償）には数えない
    tags: ["damage"],
    slots: JEWELRY_SLOTS,
    curve: BOON_ECHO_CURVES[color],
    color,
    apply: (s: PlayerStats, v: number) => {
      s.traits[BOON_ECHO_FIELD[color]] += pct(v);
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

/** 性質の固定トリガー（確率 1。内部クールダウン TRIGGER.icd は system/triggers.ts が掛ける）。値が 0 以下なら積まない */
function pushFixedTrigger(stats: PlayerStats, effect: Omit<TriggeredEffect, "chance">): void {
  if (effect.magnitude <= 0) return;
  stats.triggers.push({ ...effect, chance: 1 });
}

/** 数値を持たない性質（判定は別の場所が key を見る） */
const noTraitEffect = (): void => {};

/** 0..1 の割合を % の整数に（表示用） */
function ratioPct(ratio: number): number {
  return Math.round(ratio * 100);
}

/** ベースの implicit の固定値（ロールしない側） */
const MACHETE_BURN_DPS = 3;
const MATCHLOCK_BURN_DPS = 4;
const BLOWGUN_POISON_PCT = 25;
const FANG_BLEED_POTENCY = 1.5;
/** 出血が 1 回刻まれる移動距離（表示用。m に直す） */
const BLEED_STEP = formatMeters(STATUS.bleed.distance);
const TABI_BUFF_SECONDS = 1;
/** 第 2 弾のベースの implicit の代償（ロールしない側。%） */
const ZANBATO_SLOW_PCT = 8;
const HALBERD_SLOW_PCT = 5;
const CROSSBOW_SLOW_PCT = 10;
/** レーン B の大槌の implicit の代償（%） */
const MAUL_SLOW_PCT = 10;

// ---------------------------------------------------------------------------
// アフィックス一覧
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 防御・属性耐性の性質（docs/COMBAT_DESIGN.md A-8）
// ---------------------------------------------------------------------------

/**
 * 属性と色の対応（炎 = 紅 / 氷 = 蒼 / 雷 = 金 / 毒 = 翠 / 闇 = 冥）。光と無は 5 色のどれにも寄せない属性なので
 * 耐性は生存（翠）、変換は光 = 金（会心・必殺の輝き）、無 = 冥（属性を捨てる代償）に置く
 */
export const ELEMENT_TRAIT_COLOR: Readonly<Record<Element, TraitColor>> = {
  none: "umbra",
  fire: "crimson",
  ice: "azure",
  lightning: "gold",
  poison: "jade",
  dark: "umbra",
  light: "gold",
};

/** 属性の性質の key の接頭辞（res_fire / cv_infuseFire） */
export const RESIST_TRAIT_PREFIX = "res_";
export const INFUSE_KEY_PREFIX = "cv_infuse";

const RESIST_SLOTS: readonly Slot[] = ["armor", "boots", "ring", "amulet"];

/** 期待値曲線（属性ごとに同じ形。深度 1 で 6〜10%、20 で 20〜26%）。res_fire など key ごとに JSON から引く */
const RESIST_TRAIT_CURVES: Readonly<Record<Exclude<Element, "none">, readonly CurvePoint[]>> = {
  fire: curveFor("res_fire"),
  ice: curveFor("res_ice"),
  lightning: curveFor("res_lightning"),
  poison: curveFor("res_poison"),
  dark: curveFor("res_dark"),
  light: curveFor("res_light"),
};

/** 属性耐性 6 種（無属性は防御が受け持つので除く）+ 全属性耐性 + 魔防 + 堅牢 */
function defenseElementTraits(): AffixDef[] {
  const single: AffixDef[] = ELEMENTS.filter((e): e is Exclude<Element, "none"> => e !== "none").map((e) => ({
    key: `${RESIST_TRAIT_PREFIX}${e}`,
    label: `${ELEMENT_LABEL[e]}耐性 +{v}%`,
    tags: ["defense"],
    slots: RESIST_SLOTS,
    curve: RESIST_TRAIT_CURVES[e],
    color: e === "light" ? "jade" : ELEMENT_TRAIT_COLOR[e],
    apply: (s: PlayerStats, v: number) => {
      s.resist[e] += v;
    },
  }));
  return [
    ...single,
    {
      key: `${RESIST_TRAIT_PREFIX}all`,
      label: "全属性耐性 +{v}%（無属性を除く）",
      tags: ["defense"],
      slots: ["armor", "amulet"],
      curve: curveFor("res_all"),
      apply: (s: PlayerStats, v: number) => {
        for (const e of ELEMENTS) if (e !== "none") s.resist[e] += v;
      },
    },
    {
      key: "wardingFlat",
      label: "魔防 +{v}",
      tags: ["defense"],
      slots: ["armor", "ring", "amulet"],
      curve: curveFor("wardingFlat"),
      apply: (s: PlayerStats, v: number) => {
        s.warding += v;
      },
    },
    {
      key: "sturdy",
      // 代償の移動速度 −% は v2（深さで重くしない）
      label: "堅牢: アーマーと魔防 +{v}、移動速度 -{v2}%",
      tags: ["defense", "tradeoff"],
      slots: ["armor", "boots"],
      curve: curveFor("sturdy"),
      apply: (s: PlayerStats, v: number, v2: number) => {
        s.armor += v;
        s.warding += v;
        s.moveSpeedMul -= pct(v2);
      },
    },
  ];
}

export const AFFIXES: readonly AffixDef[] = [
  // ---- 近接 ----
  trait({
    key: "meleeDamagePct",
    label: "近接ダメージ +{v}%",
    tags: ["damage", "melee"],
    slots: MELEE_SLOTS,
    curve: curveFor("meleeDamagePct"),
    apply: (s, v) => {
      s.meleeDamageMul += pct(v);
    },
  }),
  trait({
    key: "meleeDamageFlat",
    label: "近接ダメージ +{v}",
    tags: ["damage", "melee"],
    slots: ["mainHand", "ring"],
    curve: curveFor("meleeDamageFlat"),
    apply: (s, v) => {
      s.meleeDamageFlat += v;
    },
  }),
  trait({
    key: "attackSpeed",
    label: "攻撃速度 +{v}%",
    tags: ["speed", "melee"],
    slots: MELEE_SLOTS,
    curve: curveFor("attackSpeed"),
    apply: (s, v) => {
      s.attackSpeedMul += pct(v);
    },
  }),
  trait({
    key: "meleeReach",
    label: "リーチ +{v}%",
    tags: ["melee", "utility"],
    slots: ["mainHand", "amulet"],
    curve: curveFor("meleeReach"),
    apply: (s, v) => {
      s.meleeReachMul += pct(v);
    },
  }),
  trait({
    key: "knockback",
    label: "ノックバック +{v}%",
    tags: ["melee", "utility"],
    slots: ["mainHand", "armor"],
    curve: curveFor("knockback"),
    apply: (s, v) => {
      s.knockbackMul += pct(v);
    },
  }),
  trait({
    key: "damageVsStaggered",
    label: "怯み中の敵へのダメージ +{v}%",
    tags: ["damage", "melee"],
    slots: ["mainHand", "ring"],
    curve: curveFor("damageVsStaggered"),
    apply: (s, v) => {
      s.damageVsStaggeredMul += pct(v);
    },
  }),

  // ---- 射撃 ----
  trait({
    key: "rangedDamagePct",
    family: "gun",
    label: "射撃ダメージ +{v}%",
    tags: ["damage", "ranged"],
    slots: RANGED_SLOTS,
    curve: curveFor("rangedDamagePct"),
    apply: (s, v) => {
      s.rangedDamageMul += pct(v);
    },
  }),
  trait({
    key: "rangedDamageFlat",
    family: "gun",
    label: "射撃ダメージ +{v}",
    tags: ["damage", "ranged"],
    slots: ["mainHand", "ring"],
    curve: curveFor("rangedDamageFlat"),
    apply: (s, v) => {
      s.rangedDamageFlat += v;
    },
  }),
  trait({
    key: "fireRate",
    family: "gun",
    label: "連射速度 +{v}%",
    tags: ["speed", "ranged"],
    slots: RANGED_SLOTS,
    curve: curveFor("fireRate"),
    apply: (s, v) => {
      s.fireRateMul += pct(v);
    },
  }),
  trait({
    key: "projectiles",
    family: "gun",
    label: "弾数 +{v}、射撃ダメージ -{v2}%",
    tags: ["ranged", "tradeoff"],
    slots: ["mainHand", "amulet"],
    curve: curveFor("projectiles"),
    apply: (s, v, v2) => {
      s.projectileCount += v;
      s.rangedDamageMul -= pct(v2);
    },
  }),
  trait({
    key: "pierce",
    family: "gun",
    label: "貫通 +{v}",
    tags: ["ranged"],
    slots: ["mainHand"],
    curve: curveFor("pierce"),
    apply: (s, v) => {
      s.pierce += v;
    },
  }),
  trait({
    key: "projectileSpeed",
    family: "gun",
    label: "弾速 +{v}%",
    tags: ["ranged", "speed"],
    slots: ["mainHand", "ring"],
    curve: curveFor("projectileSpeed"),
    apply: (s, v) => {
      s.projectileSpeedMul += pct(v);
    },
  }),

  // ---- 生存 ----
  trait({
    key: "maxLife",
    label: "最大生命 +{v}",
    tags: ["life"],
    slots: ["armor", "boots", "ring", "amulet"],
    curve: curveFor("maxLife"),
    apply: (s, v) => {
      s.maxHp += v;
    },
  }),
  trait({
    key: "maxLifePct",
    label: "最大生命 +{v}%",
    tags: ["life"],
    slots: ["armor", "amulet"],
    curve: curveFor("maxLifePct"),
    stage: "scale",
    apply: (s, v) => {
      s.maxHp *= 1 + pct(v);
    },
  }),
  trait({
    key: "hpRegen",
    // 近くに敵がいる間は止まる（system/combat.ts の hpRegenAllowed）
    label: "生命自然回復 +{v}/秒（敵が近くにいない間）",
    tags: ["life"],
    slots: ["armor", "boots", "ring", "amulet"],
    curve: curveFor("hpRegen"),
    decimals: 1,
    apply: (s, v) => {
      s.hpRegen += v;
    },
  }),
  trait({
    key: "lifeOnHit",
    // 値は与ダメージに対する %（memo 2026-09-24 で固定値から変更。旧セーブは migrate.ts が換算）。
    // 戦闘中の回復の共通上限（tuning の HEAL.sustainCapRatio）を受ける
    label: "与ダメの {v}% を回復",
    tags: ["life"],
    slots: ATTACK_SLOTS,
    curve: curveFor("lifeOnHit"),
    decimals: 1,
    apply: (s, v) => {
      s.lifeOnHit += v;
    },
  }),
  trait({
    key: "lifeOnKill",
    // コンボ HEAL.killHealMinCombo 以上の撃破だけ回復する（system/combat.ts の applyLifeOnKill）
    label: `撃破時の生命回復 +{v}（${HEAL.killHealMinCombo}コンボ以上）`,
    tags: ["life"],
    slots: ["mainHand", "armor", "ring", "amulet"],
    curve: curveFor("lifeOnKill"),
    apply: (s, v) => {
      s.lifeOnKill += v;
    },
  }),
  trait({
    key: "armorFlat",
    label: "アーマー +{v}",
    tags: ["defense"],
    slots: ["armor", "boots", "ring"],
    curve: curveFor("armorFlat"),
    apply: (s, v) => {
      s.armor += v;
    },
  }),
  trait({
    key: "damageTaken",
    label: "被ダメージ -{v}%",
    tags: ["defense"],
    slots: ["armor", "amulet"],
    curve: curveFor("damageTaken"),
    apply: (s, v) => {
      s.damageTakenMul -= pct(v);
    },
  }),
  trait({
    key: "thorns",
    label: "攻撃者に {v} ダメージを反射",
    tags: ["defense", "damage"],
    slots: ["armor", "boots"],
    curve: curveFor("thorns"),
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
    curve: curveFor("moveSpeed"),
    apply: (s, v) => {
      s.moveSpeedMul += pct(v);
    },
  }),
  trait({
    key: "dashCooldown",
    label: "ダッシュ再使用時間 -{v}%",
    tags: ["mobility"],
    slots: ["boots", "amulet"],
    curve: curveFor("dashCooldown"),
    apply: (s, v) => {
      s.dashCooldownMul -= pct(v);
    },
  }),
  trait({
    key: "dashCharge",
    label: "ダッシュ回数 +{v}",
    tags: ["mobility"],
    slots: ["boots"],
    curve: curveFor("dashCharge"),
    apply: (s, v) => {
      s.dashCharges += v;
    },
  }),
  trait({
    key: "dashDistance",
    label: "ダッシュ距離 +{v}%",
    tags: ["mobility"],
    slots: ["boots"],
    curve: curveFor("dashDistance"),
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
    curve: curveFor("critChance"),
    apply: (s, v) => {
      s.critChance += pct(v);
    },
  }),
  trait({
    key: "critMultiplier",
    label: "会心倍率 +{v}%",
    tags: ["critical", "damage"],
    slots: OFFENSE_SLOTS,
    curve: curveFor("critMultiplier"),
    apply: (s, v) => {
      s.critMul += pct(v);
    },
  }),

  // ---- 必殺 ----
  trait({
    key: "energyGain",
    label: "奥義ゲージ獲得 +{v}%",
    tags: ["burst"],
    slots: ["mainHand", "armor", "ring", "amulet"],
    curve: curveFor("energyGain"),
    apply: (s, v) => {
      s.energyGainMul += pct(v);
    },
  }),
  trait({
    key: "burstDamage",
    label: "奥義の威力 +{v}%",
    tags: ["burst", "damage"],
    slots: ["mainHand", "amulet"],
    curve: curveFor("burstDamage"),
    apply: (s, v) => {
      s.burstDamageMul += pct(v);
    },
  }),
  trait({
    key: "burstRadius",
    label: "奥義の範囲 +{v}%",
    tags: ["burst"],
    slots: ["armor", "amulet"],
    curve: curveFor("burstRadius"),
    apply: (s, v) => {
      s.burstRadiusMul += pct(v);
    },
  }),

  // ---- コンボ ----
  trait({
    key: "comboWindow",
    label: "コンボ猶予 +{v}秒",
    tags: ["combo"],
    slots: ["mainHand", "boots", "ring", "amulet"],
    curve: curveFor("comboWindow"),
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
    curve: curveFor("comboDamage"),
    decimals: 1,
    apply: (s, v, v2) => {
      s.comboDamagePerStack += pct(v);
      s.comboDamageCap += pct(v2);
    },
  }),
  trait({
    key: "justDodgeDamage",
    label: "見切り後 {v2}秒間ダメージ +{v}%",
    tags: ["combo", "damage"],
    slots: ["boots", "ring", "amulet"],
    curve: curveFor("justDodgeDamage"),
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
    curve: curveFor("burn"),
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
    curve: curveFor("chill"),
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
    curve: curveFor("shock"),
    apply: (s, v, v2) => {
      s.shockChance += pct(v);
      s.shockDamage += v2;
    },
  }),
  trait({
    key: "explodeOnKill",
    label: "撃破時{v}%の確率で爆発（{v2}ダメージ）",
    tags: ["elemental", "damage"],
    slots: ["mainHand", "amulet"],
    curve: curveFor("explodeOnKill"),
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
    curve: curveFor("hybridDamage"),
    apply: (s, v) => {
      s.meleeDamageMul += pct(v);
      s.rangedDamageMul += pct(v);
    },
  }),
  trait({
    key: "hybridDefense",
    label: "最大生命 +{v}、アーマー +{v2}",
    tags: ["life", "defense"],
    slots: ["armor", "boots"],
    curve: curveFor("hybridDefense"),
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
    curve: curveFor("hybridSpeed"),
    apply: (s, v) => {
      s.attackSpeedMul += pct(v);
      s.fireRateMul += pct(v);
    },
  }),

  // ---- トレードオフ（value2 = 代償側の値）。同系統の純粋アフィックスより伸び幅が大きい ----
  trait({
    key: "crushing",
    family: "melee",
    label: "近接ダメージ +{v}%、攻撃速度 -{v2}%",
    tags: ["damage", "melee", "tradeoff"],
    slots: ["mainHand"],
    curve: curveFor("crushing"),
    apply: (s, v, v2) => {
      s.meleeDamageMul += pct(v);
      s.attackSpeedMul -= pct(v2);
    },
  }),
  trait({
    key: "frenzied",
    family: "melee",
    label: "攻撃速度 +{v}%、近接ダメージ -{v2}%",
    tags: ["speed", "melee", "tradeoff"],
    slots: ["mainHand", "ring"],
    curve: curveFor("frenzied"),
    apply: (s, v, v2) => {
      s.attackSpeedMul += pct(v);
      s.meleeDamageMul -= pct(v2);
    },
  }),
  trait({
    key: "overcharged",
    family: "gun",
    label: "射撃ダメージ +{v}%、連射速度 -{v2}%",
    tags: ["damage", "ranged", "tradeoff"],
    slots: ["mainHand"],
    curve: curveFor("overcharged"),
    apply: (s, v, v2) => {
      s.rangedDamageMul += pct(v);
      s.fireRateMul -= pct(v2);
    },
  }),
  trait({
    key: "reckless",
    label: "移動速度 +{v}%、最大生命 -{v2}",
    tags: ["mobility", "speed", "tradeoff"],
    slots: ["boots", "amulet"],
    curve: curveFor("reckless"),
    apply: (s, v, v2) => {
      s.moveSpeedMul += pct(v);
      s.maxHp -= v2;
    },
  }),
  trait({
    key: "bloodbound",
    color: "umbra",
    label: "会心倍率 +{v}%、最大生命 -{v2}",
    tags: ["critical", "damage", "tradeoff"],
    slots: JEWELRY_SLOTS,
    curve: curveFor("bloodbound"),
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
    curve: curveFor("ironclad"),
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
    slots: ["mainHand", "ring"],
    curve: curveFor("razor"),
    apply: (s, v, v2) => {
      s.critChance += pct(v);
      s.damageTakenMul += pct(v2);
    },
  }),
  trait({
    key: "pike",
    family: "melee",
    label: "リーチ +{v}%、攻撃速度 -{v2}%",
    tags: ["melee", "utility", "tradeoff"],
    slots: ["mainHand"],
    curve: curveFor("pike"),
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
    curve: curveFor("flickering"),
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
    curve: curveFor("emberMomentum"),
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
    curve: curveFor("shatterEdge"),
    apply: (s, v, v2) => {
      s.chillChance += pct(v);
      s.damageVsStaggeredMul += pct(v2);
    },
  }),
  trait({
    key: "chainedBarrage",
    family: "gun",
    label: "{v}%の確率で感電、弾数 +{v2}",
    tags: ["elemental", "ranged"],
    slots: RANGED_SLOTS,
    curve: curveFor("chainedBarrage"),
    apply: (s, v, v2) => {
      s.shockChance += pct(v);
      s.projectileCount += v2;
    },
  }),
  trait({
    key: "deepPiercing",
    family: "gun",
    label: "貫通 +{v}、弾速 -{v2}%",
    tags: ["ranged", "damage", "tradeoff"],
    slots: ["mainHand"],
    curve: curveFor("deepPiercing"),
    apply: (s, v, v2) => {
      s.pierce += v;
      s.projectileSpeedMul -= pct(v2);
    },
  }),
  trait({
    key: "wallSlammer",
    label: "ノックバック +{v}%、移動速度 -{v2}%",
    tags: ["melee", "damage", "tradeoff"],
    slots: ["mainHand", "armor"],
    curve: curveFor("wallSlammer"),
    apply: (s, v, v2) => {
      s.knockbackMul += pct(v);
      s.moveSpeedMul -= pct(v2);
    },
  }),
  trait({
    key: "vampiricRush",
    label: "与ダメの {v}% を回復、攻撃速度 +{v2}%",
    tags: ["life", "speed"],
    slots: ATTACK_SLOTS,
    curve: curveFor("vampiricRush"),
    apply: (s, v, v2) => {
      s.lifeOnHit += v;
      s.attackSpeedMul += pct(v2);
    },
  }),
  trait({
    key: "stormcaller",
    family: "gun",
    color: "gold",
    label: "感電連鎖ダメージ +{v}、射撃ダメージ -{v2}%",
    tags: ["elemental", "ranged", "tradeoff"],
    slots: RANGED_SLOTS,
    curve: curveFor("stormcaller"),
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
    curve: curveFor("frostbite"),
    apply: (s, v, v2) => {
      s.chillSlow += pct(v);
      s.moveSpeedMul -= pct(v2);
    },
  }),
  trait({
    key: "arcaneBattery",
    label: "奥義ゲージ獲得 +{v}%、奥義の威力 -{v2}%",
    tags: ["burst", "tradeoff"],
    slots: ["mainHand", "armor", "ring", "amulet"],
    curve: curveFor("arcaneBattery"),
    apply: (s, v, v2) => {
      s.energyGainMul += pct(v);
      s.burstDamageMul -= pct(v2);
    },
  }),
  trait({
    key: "gildedFang",
    label: `会心倍率 +{v}%、撃破時の生命回復 +{v2}（${HEAL.killHealMinCombo}コンボ以上）`,
    tags: ["critical", "life"],
    slots: JEWELRY_SLOTS,
    curve: curveFor("gildedFang"),
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
    curve: curveFor("dashStrike"),
    decimals2: 1,
    apply: (s, v, v2) => {
      s.triggers.push({ trigger: "onDash", condition: "always", effect: "damageBuff", magnitude: v, duration: v2, chance: 1 });
    },
  }),
  trait({
    key: "finisherMend",
    label: "10コンボ以上での撃破時: 生命 {v} 回復",
    tags: ["combo", "life"],
    slots: MELEE_SLOTS,
    curve: curveFor("finisherMend"),
    apply: (s, v) => {
      s.triggers.push({ trigger: "onKill", condition: "comboAbove10", effect: "heal", magnitude: v, chance: 1 });
    },
  }),
  trait({
    key: "wardedSanctuary",
    label: "交戦中の部屋で被弾時: {v2}秒間移動速度 +{v}%",
    tags: ["defense", "utility"],
    slots: ["armor", "boots"],
    curve: curveFor("wardedSanctuary"),
    decimals2: 1,
    apply: (s, v, v2) => {
      s.triggers.push({ trigger: "onHurt", condition: "roomLocked", effect: "speedBuff", magnitude: v, duration: v2, chance: 1 });
    },
  }),
  trait({
    key: "roomMender",
    label: "部屋クリア時: 生命 {v} 回復",
    tags: ["life", "utility"],
    slots: ["armor", "amulet"],
    curve: curveFor("roomMender"),
    apply: (s, v) => {
      s.triggers.push({ trigger: "onRoomClear", condition: "always", effect: "heal", magnitude: v, chance: 1 });
    },
  }),
  trait({
    key: "energyReserve",
    label: "奥義ゲージ満タン時に被弾: {v}秒間無敵",
    tags: ["burst", "defense"],
    slots: ["armor", "ring", "amulet"],
    curve: curveFor("energyReserve"),
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
    label: `近接命中時 {v}% で出血させる（${BLEED_STEP} 動くごとに {v2} ダメージ）`,
    tags: ["status", "melee", "damage"],
    slots: MELEE_SLOTS,
    curve: curveFor("procBleed"),
    decimals2: 1,
    apply: (s, v, v2) => {
      pushProc(s, statusProc("bleed", v, STATUS.bleed.duration, v2, "melee"));
    },
  }),
  trait({
    key: "procPoison",
    color: "umbra",
    label: "命中時 {v}% で毒にする",
    tags: ["status", "damage"],
    slots: ATTACK_SLOTS,
    curve: curveFor("procPoison"),
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
    curve: curveFor("procVulnerable"),
    apply: (s, v) => {
      pushProc(s, statusProc("vulnerable", v, STATUS.vulnerable.duration, STATUS.vulnerable.mul, "skill"));
    },
  }),
  trait({
    key: "procWeaken",
    color: "jade",
    label: "命中時 {v}% で弱体にする（敵の攻撃が弱まる）",
    tags: ["status", "defense"],
    slots: ["mainHand", "armor", "ring"],
    curve: curveFor("procWeaken"),
    apply: (s, v) => {
      pushProc(s, statusProc("weaken", v, STATUS.weaken.duration, STATUS.weaken.mul, "any"));
    },
  }),
  trait({
    key: "procSilence",
    family: "gun",
    color: "azure",
    label: "射撃命中時 {v}% で沈黙させる（敵の弾・光線・爆弾を封じる）",
    tags: ["status", "ranged"],
    slots: RANGED_SLOTS,
    curve: curveFor("procSilence"),
    apply: (s, v) => {
      pushProc(s, statusProc("silence", v, STATUS.silence.enemyDuration, NO_POTENCY, "ranged"));
    },
  }),
  trait({
    key: "procFear",
    color: "gold",
    label: "会心時 {v}% で恐怖させる（敵が逃げて攻撃しなくなる）",
    tags: ["status", "critical"],
    slots: OFFENSE_SLOTS,
    curve: curveFor("procFear"),
    apply: (s, v) => {
      pushProc(s, { ...statusProc("fear", v, STATUS.fear.duration, NO_POTENCY, "any"), requiresCrit: true });
    },
  }),

  // ---- 弾斬り（docs/COMBAT_DESIGN.md C-1 の 6）: 既定では近接は敵弾を素通りする ----
  trait({
    key: "bulletCut",
    family: "melee",
    color: "azure",
    label: "近接攻撃で敵弾を消せる（リーチ -{v}%）",
    tags: ["melee", "defense"],
    slots: ["mainHand"],
    curve: curveFor("bulletCut"),
    apply: (s, v) => {
      s.bulletCut += BULLET_CUT_ON;
      s.meleeReachMul -= pct(v);
    },
  }),

  // ---- マナ（docs/COMBAT_DESIGN.md B 節）。序盤は乏しいマナを装備で伸ばしていく ----
  trait({
    key: "maxManaFlat",
    label: "最大気力 +{v}",
    tags: ["mana", "skill"],
    slots: ["amulet", "ring", "armor"],
    curve: curveFor("maxManaFlat"),
    apply: (s, v) => {
      s.maxMana += v;
    },
  }),
  trait({
    key: "manaRegenFlat",
    label: "気力自然回復 +{v}/秒",
    tags: ["mana", "skill"],
    // 兜の部位は無いので鎧で代える
    slots: ["amulet", "ring", "armor"],
    decimals: 1,
    curve: curveFor("manaRegenFlat"),
    apply: (s, v) => {
      s.manaRegen += v;
    },
  }),
  trait({
    key: "manaGainPct",
    label: "気力回収 +{v}%",
    tags: ["mana", "skill"],
    // 籠手の部位は無いので、通常攻撃を担う銃で代える
    slots: ["mainHand", "ring"],
    curve: curveFor("manaGainPct"),
    apply: (s, v) => {
      s.manaGainMul += pct(v);
    },
  }),
  trait({
    key: "manaCostPct",
    label: "スキルのコスト -{v}%、スキル威力 -{v2}%",
    tags: ["mana", "skill", "tradeoff"],
    slots: ["mainHand", "amulet", "ring"],
    // 代償（v2）は利得の半分の幅で振る（コスト軽減だけの上位互換にしない）
    curve: curveFor("manaCostPct"),
    apply: (s, v, v2) => {
      s.manaCostMul -= pct(v);
      s.skillDamageMul -= pct(v2);
    },
  }),
  trait({
    key: "manaOnKillFlat",
    label: "撃破で気力 +{v}",
    tags: ["mana", "skill"],
    slots: ["mainHand", "boots", "ring"],
    curve: curveFor("manaOnKillFlat"),
    apply: (s, v) => {
      s.manaOnKill += v;
    },
  }),
  trait({
    key: "manaDrought",
    label: "撃破で気力 +{v}、最大気力 -{v2}",
    tags: ["mana", "skill", "tradeoff"],
    slots: JEWELRY_SLOTS,
    // manaOnKillFlat より伸び幅が大きい代わりに器が縮む。名のある遺物「涸れ井戸の指輪」の核
    curve: curveFor("manaDrought"),
    apply: (s, v, v2) => {
      s.manaOnKill += v;
      s.maxMana -= v2;
    },
  }),

  // =====================================================================================
  // 2026-09 追加（docs/ideas/loot-expansion.md 1 章）。数値盛りより「ルール変更」を中心にし、
  // 強いものには代償（v2）を付ける。名前は「名前: 効果」で見せる（何ができるかを語る）。
  // 戦闘側は system/traitHooks.ts が stats.traits を読む。固定のトリガーは system/triggers.ts が撃つ
  // =====================================================================================

  // ---- マナ経済 ----
  trait({
    key: "manaOnStagger",
    label: "汲み上げ: 敵を怯ませると気力 +{v}、撃破時の気力回収 -{v2}",
    tags: ["mana", "skill", "tradeoff"],
    slots: ["mainHand", "ring"],
    curve: curveFor("manaOnStagger"),
    apply: (s, v, v2) => {
      s.traits.manaOnStagger += v;
      s.manaOnKill -= v2;
    },
  }),
  trait({
    key: "lowTide",
    label: `底打ち: 気力が ${ratioPct(TRIGGER.trait.lowManaRatio)}% 未満の間、気力回収 +{v}%、気力自然回復 -{v2}%`,
    tags: ["mana", "skill", "tradeoff"],
    slots: ["mainHand", "ring", "amulet"],
    curve: curveFor("lowTide"),
    stage: "scale",
    apply: (s, v, v2) => {
      s.traits.lowManaGainMul += pct(v);
      s.manaRegen *= 1 - pct(v2);
    },
  }),
  trait({
    key: "fullTide",
    label: "満ち潮: 気力が満タンの間、スキル威力 +{v}%、気力回収 -{v2}%",
    tags: ["mana", "skill", "tradeoff"],
    slots: ["armor", "amulet"],
    curve: curveFor("fullTide"),
    apply: (s, v, v2) => {
      s.traits.fullManaSkillMul += pct(v);
      s.manaGainMul -= pct(v2);
    },
  }),
  trait({
    key: "ebbTide",
    color: "umbra",
    label: "引き潮: 残り気力が少ないほどスキル威力が上がる（0 で +{v}%）、最大気力 -{v2}",
    tags: ["mana", "skill", "tradeoff"],
    slots: JEWELRY_SLOTS,
    curve: curveFor("ebbTide"),
    apply: (s, v, v2) => {
      s.traits.lowManaSkillMul += pct(v);
      s.maxMana -= v2;
    },
  }),
  trait({
    key: "manaShield",
    color: "jade",
    label: `身代わり: 被弾時に気力 {v} を払って被ダメージを ${ratioPct(1 - TRIGGER.trait.manaShieldMul)}% 減らす（足りなければ不発）、気力自然回復 -{v2}%`,
    tags: ["defense", "mana", "tradeoff"],
    slots: ["armor"],
    // 値は払うマナ。深いほど安い
    curve: curveFor("manaShield"),
    stage: "scale",
    apply: (s, v, v2) => {
      s.traits.manaShieldCost = Math.max(s.traits.manaShieldCost, v);
      s.manaRegen *= 1 - pct(v2);
    },
  }),
  trait({
    key: "painToMana",
    color: "umbra",
    label: "痛覚遮断: 被弾で気力 +{v}、被ダメージ +{v2}%",
    tags: ["mana", "tradeoff"],
    slots: ["armor"],
    curve: curveFor("painToMana"),
    apply: (s, v, v2) => {
      pushFixedTrigger(s, { trigger: "onHurt", condition: "always", effect: "restoreMana", magnitude: v });
      s.damageTakenMul += pct(v2);
    },
  }),
  trait({
    key: "silencedKillMana",
    family: "gun",
    label: "沈黙の報い: 沈黙中の敵を倒すと気力 +{v}、射撃ダメージ -{v2}%",
    tags: ["mana", "ranged", "tradeoff"],
    slots: ["mainHand", "ring"],
    curve: curveFor("silencedKillMana"),
    apply: (s, v, v2) => {
      s.traits.silencedKillMana += v;
      s.rangedDamageMul -= pct(v2);
    },
  }),
  trait({
    key: "lastKillMana",
    color: "gold",
    label: "殲滅の余韻: 殲滅で気力が最大の {v}% 戻る、最大気力 -{v2}",
    tags: ["mana", "tradeoff"],
    slots: ["mainHand", "amulet"],
    curve: curveFor("lastKillMana"),
    cap: 100,
    apply: (s, v, v2) => {
      s.traits.lastKillManaRatio += pct(v);
      s.maxMana -= v2;
    },
  }),
  trait({
    key: "manaOverflow",
    label: "溢れ: 気力が満タンのとき、あふれた気力回収の {v}% を奥義ゲージに回す、最大気力 -{v2}",
    tags: ["mana", "burst", "tradeoff"],
    slots: JEWELRY_SLOTS,
    curve: curveFor("manaOverflow"),
    apply: (s, v, v2) => {
      s.traits.manaOverflowToEnergy += pct(v);
      s.maxMana -= v2;
    },
  }),
  trait({
    key: "counterMana",
    family: "melee",
    color: "gold",
    label: "構えの呼吸: カウンターで気力 +{v}、攻撃速度 -{v2}%",
    tags: ["mana", "melee", "tradeoff"],
    slots: ["mainHand"],
    curve: curveFor("counterMana"),
    apply: (s, v, v2) => {
      pushFixedTrigger(s, { trigger: "onCounter", condition: "always", effect: "restoreMana", magnitude: v });
      s.attackSpeedMul -= pct(v2);
    },
  }),
  trait({
    key: "justBreath",
    label: "見切りの息吹: 見切りで気力 +{v}、ダッシュ再使用時間 +{v2}%",
    tags: ["mana", "mobility", "tradeoff"],
    slots: ["boots", "ring"],
    curve: curveFor("justBreath"),
    apply: (s, v, v2) => {
      pushFixedTrigger(s, { trigger: "onJustDodge", condition: "always", effect: "restoreMana", magnitude: v });
      s.dashCooldownMul += pct(v2);
    },
  }),
  trait({
    key: "arcaneFocus",
    label: "詠唱の集中: スキル威力 +{v}%、近接・射撃ダメージ -{v2}%",
    tags: ["mana", "skill", "tradeoff"],
    slots: JEWELRY_SLOTS,
    curve: curveFor("arcaneFocus"),
    apply: (s, v, v2) => {
      s.skillDamageMul += pct(v);
      s.meleeDamageMul -= pct(v2);
      s.rangedDamageMul -= pct(v2);
    },
  }),

  // ---- 状態異常 ----
  trait({
    key: "kaleidoscope",
    color: "gold",
    label: "多彩: 相手に付いた状態異常 1 種ごとに与ダメージ +{v}%、状態異常の効果量 -{v2}%",
    tags: ["status", "damage", "tradeoff"],
    slots: ATTACK_SLOTS,
    curve: curveFor("kaleidoscope"),
    apply: (s, v, v2) => {
      s.traits.damagePerStatusKind += pct(v);
      s.statusPotencyMul -= pct(v2);
    },
  }),
  trait({
    key: "fever",
    color: "umbra",
    label: "病み上がり: 自分に付いた状態異常 1 種ごとに与ダメージ +{v}%、受ける状態異常の持続 +{v2}%",
    tags: ["status", "damage", "tradeoff"],
    slots: ["armor", "amulet"],
    curve: curveFor("fever"),
    apply: (s, v, v2) => {
      s.traits.damagePerSelfStatus += pct(v);
      s.statusTakenMul += pct(v2);
    },
  }),
  trait({
    key: "weakenedGuard",
    color: "jade",
    label: "弱体の盾: 弱体中の敵から受けるダメージ -{v}%、弱体でない敵からは +{v2}%",
    tags: ["status", "defense", "tradeoff"],
    slots: ["armor"],
    curve: curveFor("weakenedGuard"),
    cap: 60,
    apply: (s, v, v2) => {
      s.traits.weakenedGuard += pct(v);
      s.traits.weakenedExposure += pct(v2);
    },
  }),
  trait({
    key: "plagueSeed",
    color: "umbra",
    label: "疫病の種: 撃破時、周囲の敵を毒にする（{v} 秒）",
    tags: ["status", "damage"],
    slots: ATTACK_SLOTS,
    curve: curveFor("plagueSeed"),
    apply: (s, v) => {
      pushFixedTrigger(s, { trigger: "onKill", condition: "always", effect: "inflict", magnitude: v, status: "poison" });
    },
  }),
  trait({
    key: "hurtWeaken",
    color: "jade",
    label: "払い手: 被弾時、攻撃してきた敵を弱体にする（{v} 秒）",
    tags: ["status", "defense"],
    slots: ["armor", "boots"],
    curve: curveFor("hurtWeaken"),
    apply: (s, v) => {
      pushFixedTrigger(s, { trigger: "onHurt", condition: "always", effect: "inflict", magnitude: v, status: "weaken" });
    },
  }),
  trait({
    key: "procParalyze",
    family: "melee",
    color: "gold",
    label: "近接命中時 {v}% で麻痺させる、攻撃速度 -{v2}%",
    tags: ["status", "melee", "tradeoff"],
    slots: ["mainHand", "ring"],
    curve: curveFor("procParalyze"),
    apply: (s, v, v2) => {
      pushProc(s, statusProc("paralyze", v, STATUS.paralyze.duration, NO_POTENCY, "melee"));
      s.attackSpeedMul -= pct(v2);
    },
  }),
  trait({
    key: "rotBurst",
    family: "melee",
    color: "umbra",
    label: "腐爆: 状態異常が 2 種以上の敵への近接命中で爆発する（{v} ダメージ）、近接ダメージ -{v2}%",
    tags: ["status", "melee", "damage", "tradeoff"],
    slots: ["mainHand"],
    curve: curveFor("rotBurst"),
    apply: (s, v, v2) => {
      pushFixedTrigger(s, { trigger: "onMeleeHit", condition: "targetMultiStatus", effect: "explode", magnitude: v });
      s.meleeDamageMul -= pct(v2);
    },
  }),
  trait({
    key: "virulent",
    color: "umbra",
    label: "毒気: 状態異常の効果量 +{v}%、会心率 -{v2}%",
    tags: ["status", "tradeoff"],
    slots: JEWELRY_SLOTS,
    curve: curveFor("virulent"),
    apply: (s, v, v2) => {
      s.statusPotencyMul += pct(v);
      s.critChance -= pct(v2);
    },
  }),
  trait({
    key: "statusWard",
    color: "jade",
    label: "耐性の布: 受ける状態異常の持続 -{v}%",
    tags: ["status", "defense"],
    slots: ["armor", "boots", "amulet"],
    curve: curveFor("statusWard"),
    apply: (s, v) => {
      s.statusTakenMul -= pct(v);
    },
  }),
  trait({
    key: "hurtCleanse",
    color: "jade",
    label: "払い清め: 自分が状態異常中に被弾すると 1 つ解除する、受ける状態異常の持続 -{v}%",
    tags: ["status", "defense"],
    slots: ["armor", "boots"],
    curve: curveFor("hurtCleanse"),
    apply: (s, v) => {
      pushFixedTrigger(s, { trigger: "onHurt", condition: "selfAfflicted", effect: "cleanse", magnitude: 1 });
      s.statusTakenMul -= pct(v);
    },
  }),

  // ---- 怯み ----
  trait({
    key: "wedge",
    label: "楔: 怯みの蓄積が半分を超えた敵への怯み値 +{v}%、半分未満の敵へは -{v2}%",
    tags: ["melee", "tradeoff"],
    slots: ["mainHand"],
    curve: curveFor("wedge"),
    apply: (s, v, v2) => {
      s.traits.wedgePoiseMul += pct(v);
      s.traits.wedgePenalty += pct(v2);
    },
  }),
  trait({
    key: "guardPiercer",
    family: "gun",
    label: "剥がし撃ち: 堅守中の敵への射撃の怯み値の減衰を {v}% 打ち消す、射撃の怯み値 -{v2}%",
    tags: ["ranged", "tradeoff"],
    slots: ["mainHand"],
    curve: curveFor("guardPiercer"),
    cap: 100,
    apply: (s, v, v2) => {
      s.traits.guardPierce += pct(v);
      s.traits.rangedPoiseMul -= pct(v2);
    },
  }),
  trait({
    key: "staggerQuake",
    label: "崩れの反響: 敵を怯ませると周囲の敵に怯み値 {v}、ノックバック -{v2}%",
    tags: ["melee", "tradeoff"],
    slots: ["mainHand", "armor"],
    curve: curveFor("staggerQuake"),
    apply: (s, v, v2) => {
      s.traits.staggerQuake += v;
      s.knockbackMul -= pct(v2);
    },
  }),
  trait({
    key: "staggerLeech",
    label: "怯み吸い: 敵を怯ませると生命 +{v}、撃破時の生命回復 -{v2}",
    tags: ["life", "tradeoff"],
    slots: ["mainHand", "ring"],
    curve: curveFor("staggerLeech"),
    apply: (s, v, v2) => {
      s.traits.healOnStagger += v;
      s.lifeOnKill -= v2;
    },
  }),
  trait({
    key: "fearPoise",
    color: "umbra",
    label: "追い討ち: 恐怖中の敵への怯み値 +{v}%、近接ダメージ -{v2}%",
    tags: ["status", "melee", "tradeoff"],
    slots: ["mainHand"],
    curve: curveFor("fearPoise"),
    apply: (s, v, v2) => {
      s.traits.fearPoiseMul += pct(v);
      s.meleeDamageMul -= pct(v2);
    },
  }),
  trait({
    key: "vortexCore",
    color: "umbra",
    label: "静寂崩し: 沈黙中の敵への怯み値 +{v}%、射撃ダメージ -{v2}%",
    tags: ["status", "tradeoff"],
    slots: JEWELRY_SLOTS,
    curve: curveFor("vortexCore"),
    apply: (s, v, v2) => {
      s.traits.silencedPoiseMul += pct(v);
      s.rangedDamageMul -= pct(v2);
    },
  }),
  trait({
    key: "vulnPoise",
    color: "umbra",
    label: "脆弱の楔: 脆弱の敵への怯み値 +{v}%、被ダメージ +{v2}%",
    tags: ["status", "tradeoff"],
    slots: ["mainHand", "ring"],
    curve: curveFor("vulnPoise"),
    apply: (s, v, v2) => {
      s.traits.vulnerablePoiseMul += pct(v);
      s.damageTakenMul += pct(v2);
    },
  }),
  trait({
    key: "heavyHand",
    label: "重い手: 怯み値 +{v}%、攻撃速度 -{v2}%",
    tags: ["melee", "tradeoff"],
    slots: ["mainHand", "armor"],
    curve: curveFor("heavyHand"),
    apply: (s, v, v2) => {
      s.poiseDamageMul += pct(v);
      s.attackSpeedMul -= pct(v2);
    },
  }),
  trait({
    key: "staggerSpark",
    color: "gold",
    label: "崩れ雷: 敵を怯ませると連鎖雷を呼ぶ（{v} ダメージ）",
    tags: ["elemental", "damage"],
    slots: ["mainHand"],
    curve: curveFor("staggerSpark"),
    apply: (s, v) => {
      pushFixedTrigger(s, { trigger: "onStagger", condition: "always", effect: "chainLightning", magnitude: v });
    },
  }),
  trait({
    key: "staggerCharge",
    label: "崩れの充填: 敵を怯ませると奥義ゲージ +{v}、奥義の威力 -{v2}%",
    tags: ["burst", "tradeoff"],
    slots: ["mainHand", "amulet"],
    curve: curveFor("staggerCharge"),
    apply: (s, v, v2) => {
      pushFixedTrigger(s, { trigger: "onStagger", condition: "always", effect: "energy", magnitude: v });
      s.burstDamageMul -= pct(v2);
    },
  }),
  trait({
    key: "staggerMark",
    color: "umbra",
    label: "崩れの刻印: 怯ませた敵を脆弱にする（{v} 秒）",
    tags: ["status", "damage"],
    slots: ["mainHand", "ring"],
    curve: curveFor("staggerMark"),
    apply: (s, v) => {
      pushFixedTrigger(s, { trigger: "onStagger", condition: "always", effect: "inflict", magnitude: v, status: "vulnerable" });
    },
  }),

  // ---- テレグラフ・カウンター ----
  trait({
    key: "readAhead",
    color: "gold",
    label: "先読み: 予備動作中の敵への与ダメージ +{v}%、それ以外の敵へは -{v2}%",
    tags: ["damage", "combo", "tradeoff"],
    slots: ["mainHand"],
    curve: curveFor("readAhead"),
    apply: (s, v, v2) => {
      s.traits.windupDamageMul += pct(v);
      s.traits.offWindupPenalty += pct(v2);
    },
  }),
  trait({
    key: "windupCrack",
    family: "melee",
    color: "gold",
    label: "崩し打ち: 予備動作中の敵への近接命中で、追加の怯み値 {v}",
    tags: ["melee", "combo"],
    slots: ["mainHand"],
    curve: curveFor("windupCrack"),
    apply: (s, v) => {
      pushFixedTrigger(s, { trigger: "onMeleeHit", condition: "targetInWindup", effect: "addPoise", magnitude: v });
    },
  }),
  trait({
    key: "counterWave",
    family: "melee",
    label: "返し波: カウンター時、衝撃波を放つ（{v} ダメージ）",
    tags: ["melee", "damage"],
    slots: ["mainHand"],
    curve: curveFor("counterWave"),
    apply: (s, v) => {
      pushFixedTrigger(s, { trigger: "onCounter", condition: "always", effect: "shockwave", magnitude: v });
    },
  }),
  trait({
    key: "guardedBane",
    label: "堅守崩し: 堅守中の敵への与ダメージ +{v}%",
    tags: ["melee", "damage"],
    slots: ["mainHand"],
    curve: curveFor("guardedBane"),
    apply: (s, v) => {
      s.traits.guardedDamageMul += pct(v);
    },
  }),
  trait({
    key: "downHunter",
    color: "gold",
    label: "ダウン狩り: ボスへの与ダメージ +{v}%、ボス以外への与ダメージ -{v2}%",
    tags: ["damage", "tradeoff"],
    slots: ["mainHand", "amulet"],
    curve: curveFor("downHunter"),
    apply: (s, v, v2) => {
      s.traits.bossDamageMul += pct(v);
      s.traits.nonBossPenalty += pct(v2);
    },
  }),

  // ---- 射撃・機動 ----
  trait({
    key: "dashVolley",
    label: "撒き足: ダッシュ時に照準の方向へ射撃の {v}% の弾を撃つ、ダッシュ距離 -{v2}%",
    tags: ["ranged", "mobility", "tradeoff"],
    slots: ["boots"],
    curve: curveFor("dashVolley"),
    apply: (s, v, v2) => {
      pushFixedTrigger(s, { trigger: "onDash", condition: "always", effect: "volley", magnitude: v, count: 1 });
      s.dashDistanceMul -= pct(v2);
    },
  }),
  trait({
    key: "brimShock",
    family: "gun",
    color: "gold",
    label: "満ちた器: 気力が満タンの間、射撃で連鎖雷を呼ぶ（{v} ダメージ）",
    tags: ["elemental", "mana", "ranged"],
    slots: ["mainHand", "ring"],
    curve: curveFor("brimShock"),
    apply: (s, v) => {
      pushFixedTrigger(s, { trigger: "onShoot", condition: "manaFull", effect: "chainLightning", magnitude: v });
    },
  }),
  trait({
    key: "nightEyes",
    family: "gun",
    label: "夜目: 暗闇フロアで射撃ダメージ +{v}%、それ以外のフロアでは -{v2}%",
    tags: ["ranged", "tradeoff"],
    slots: ["mainHand", "amulet"],
    curve: curveFor("nightEyes"),
    apply: (s, v, v2) => {
      s.traits.darkRangedMul += pct(v);
      s.traits.lightRangedPenalty += pct(v2);
    },
  }),

  // ---- 部屋・死神 ----
  trait({
    key: "lockdownFury",
    label: "封鎖の熱: 交戦中の部屋で与ダメージ +{v}%、それ以外では -{v2}%",
    tags: ["damage", "tradeoff"],
    slots: ["mainHand", "armor", "ring"],
    curve: curveFor("lockdownFury"),
    apply: (s, v, v2) => {
      s.traits.lockedDamageMul += pct(v);
      s.traits.unlockedPenalty += pct(v2);
    },
  }),
  trait({
    key: "reaperShadow",
    color: "umbra",
    label: "死神の影: 死神が出ている間、与ダメージ +{v}%、最大生命 -{v2}",
    tags: ["damage", "tradeoff"],
    slots: ["boots", "amulet"],
    curve: curveFor("reaperShadow"),
    apply: (s, v, v2) => {
      s.traits.reaperDamageMul += pct(v);
      s.maxHp -= v2;
    },
  }),

  // ---- 装備全体・来歴・共鳴を読む（loot/traitContext.ts）----
  trait({
    key: "sapling",
    color: "jade",
    label: "若木: 装備全体の残り余白 1 につき近接・射撃ダメージ +{v}%（芽を選ぶほど弱まる）",
    tags: ["damage", "utility"],
    slots: ["mainHand", "armor", "boots", "ring", "amulet"],
    curve: curveFor("sapling"),
    apply: (s, v) => {
      const bonus = pct(v) * s.traits.gearMargin;
      s.meleeDamageMul += bonus;
      s.rangedDamageMul += bonus;
    },
  }),
  trait({
    key: "inscribedWeight",
    label: "銘の重み: 銘を持つ装備 1 つにつき会心倍率 +{v}%、銘の無い装備 1 つにつき最大生命 -{v2}",
    tags: ["critical", "tradeoff"],
    slots: JEWELRY_SLOTS,
    curve: curveFor("inscribedWeight"),
    apply: (s, v, v2) => {
      const t = s.traits;
      s.critMul += pct(v) * t.gearInscribed;
      s.maxHp -= v2 * Math.max(0, t.gearItems - t.gearInscribed);
    },
  }),
  trait({
    key: "invertedFeast",
    color: "umbra",
    label: "裏の糧: 装備中の反転した性質 1 つにつき近接・射撃ダメージ +{v}%、被ダメージ +{v2}%",
    tags: ["damage", "tradeoff"],
    slots: JEWELRY_SLOTS,
    curve: curveFor("invertedFeast"),
    apply: (s, v, v2) => {
      const inverted = s.traits.gearInverted;
      s.meleeDamageMul += pct(v) * inverted;
      s.rangedDamageMul += pct(v) * inverted;
      s.damageTakenMul += pct(v2) * inverted;
    },
  }),
  trait({
    key: "foreignEcho",
    color: "umbra",
    label: "異郷の響き: 装備中の異色の性質 1 つにつき全ステータス +{v}、最大生命 -{v2}",
    tags: ["attribute", "tradeoff"],
    slots: ["ring"],
    curve: curveFor("foreignEcho"),
    apply: (s, v, v2) => {
      for (const k of ATTR_KEYS) s.attributes[k] += v * s.traits.gearOffColor;
      s.maxHp -= v2;
    },
  }),
  trait({
    key: "bridge",
    color: "jade",
    label: "橋渡し: 二重の共鳴が各色 {v}% から成立する（散光は成立しなくなる）",
    tags: ["utility"],
    slots: JEWELRY_SLOTS,
    // 値は二重の成立条件（%）。低いほど成立しやすい。判定は resonance.ts の resonanceRules
    curve: curveFor("bridge"),
    apply: noTraitEffect,
  }),
  trait({
    key: "oldScars",
    color: "jade",
    label: "古傷: この遺物で被弾 100 回ごとにアーマー +{v}（5 段まで）",
    tags: ["defense"],
    slots: ["armor"],
    curve: curveFor("oldScars"),
    apply: (s, v) => {
      s.armor += v;
    },
  }),
  trait({
    key: "veteran",
    label: "歴戦: この遺物での撃破 100 回ごとに近接・射撃ダメージ +{v}%（8 段まで）",
    tags: ["damage"],
    slots: ["mainHand"],
    curve: curveFor("veteran"),
    apply: (s, v) => {
      s.meleeDamageMul += pct(v);
      s.rangedDamageMul += pct(v);
    },
  }),
  trait({
    key: "wayfarer",
    label: "旅の垢: この遺物で階層を 3 つ踏破するごとに移動速度 +{v}%（6 段まで）",
    tags: ["mobility"],
    slots: ["boots"],
    curve: curveFor("wayfarer"),
    apply: (s, v) => {
      s.moveSpeedMul += pct(v);
    },
  }),
  trait({
    key: "kingslayerMark",
    color: "umbra",
    label: "王殺しの印: この遺物でのボス撃破 1 回ごとにボスへの与ダメージ +{v}%（5 段まで）",
    tags: ["damage"],
    slots: JEWELRY_SLOTS,
    curve: curveFor("kingslayerMark"),
    apply: (s, v) => {
      s.traits.bossDamageMul += pct(v);
    },
  }),
  trait({
    key: "keenMemory",
    label: "見切りの記憶: この遺物での見切り 25 回ごとに、見切り後 {v2} 秒間のダメージ +{v}%（4 段まで）",
    tags: ["combo", "damage"],
    slots: ["boots", "ring"],
    curve: curveFor("keenMemory"),
    decimals2: 1,
    apply: (s, v, v2) => {
      s.justDodgeDamageMul += pct(v);
      s.justDodgeWindow += v2;
    },
  }),

  // ---- 作業領域（Player.loot / Enemy.stuckShots）を使う性質 ----
  trait({
    key: "echoSlash",
    color: "gold",
    label: "余韻斬り: コンボが途切れた瞬間、コンボ数 × {v} の衝撃波を放つ、コンボ猶予 -{v2}秒",
    tags: ["combo", "damage", "tradeoff"],
    slots: ["mainHand", "amulet"],
    curve: curveFor("echoSlash"),
    decimals: 1,
    decimals2: 1,
    apply: (s, v, v2) => {
      s.traits.comboBreakWave += v;
      s.comboWindowBonus -= v2;
    },
  }),
  trait({
    key: "inheritance",
    color: "umbra",
    label: "形見: 状態異常の敵を倒すと、その状態異常を次の {v} 回の命中で付ける、状態異常の効果量 -{v2}%",
    tags: ["status", "tradeoff"],
    slots: ["mainHand"],
    curve: curveFor("inheritance"),
    apply: (s, v, v2) => {
      s.traits.inheritCharges = Math.max(s.traits.inheritCharges, v);
      s.statusPotencyMul -= pct(v2);
    },
  }),
  trait({
    key: "stake",
    family: "gun",
    color: "gold",
    label: "撃ち込み杭: 射撃が敵に刺さって残り、次の近接命中で 1 本につき {v} ダメージで爆発する、射撃ダメージ -{v2}%",
    tags: ["ranged", "melee", "tradeoff"],
    slots: ["mainHand"],
    curve: curveFor("stake"),
    apply: (s, v, v2) => {
      s.traits.stakeDamage += v;
      s.rangedDamageMul -= pct(v2);
    },
  }),

  // ---- ハブ性質（設置物・低 HP・祝福のタグをつなぐ。docs/ideas/loot-expansion.md 1-i）----
  trait({
    key: "placedInfuse",
    color: "jade",
    label: "置き土産: 自分の設置物（雷撃・引力球・氷結地帯）の範囲内では、近接命中でその状態異常を {v} 秒付ける、最大生命 -{v2}",
    tags: ["status", "melee", "tradeoff"],
    slots: ["mainHand", "ring"],
    curve: curveFor("placedInfuse"),
    decimals: 1,
    apply: (s, v, v2) => {
      s.traits.placedInfuse = Math.max(s.traits.placedInfuse, v);
      s.maxHp -= v2;
    },
  }),
  trait({
    key: "placedAnchor",
    color: "gold",
    label: "杭打ち: 敵を怯ませると、近くの自分の設置物（引力球・氷結地帯・地雷）が {v} 秒長く残る、最大気力 -{v2}",
    tags: ["utility", "tradeoff"],
    slots: ["amulet"],
    curve: curveFor("placedAnchor"),
    decimals: 1,
    apply: (s, v, v2) => {
      s.traits.placedExtend += v;
      s.maxMana -= v2;
    },
  }),
  trait({
    key: "bloodSignature",
    color: "umbra",
    label: "血の署名: 生命が半分を切っている間、スキルの再使用時間と最低間隔の進みが {v}% 速くなる、最大生命 -{v2}",
    tags: ["skill", "tradeoff"],
    slots: ["armor", "amulet"],
    curve: curveFor("bloodSignature"),
    apply: (s, v, v2) => {
      s.traits.lowHpSkillHaste += pct(v);
      s.maxHp -= v2;
    },
  }),
  ...boonEchoTraits(),

  // ---- 目覚め（芽専用。ドロップ・染めでは出ない。provenance.ts の節目が名指しする）----
  trait({
    key: "shieldSplitter",
    color: "crimson",
    awakening: true,
    label: "盾割り: 堅守中の敵への与ダメージ +{v}%・怯み値 +{v2}%",
    tags: ["melee", "damage"],
    slots: ALL_SLOTS,
    curve: curveFor("shieldSplitter"),
    apply: (s, v, v2) => {
      s.traits.guardedDamageMul += pct(v);
      s.traits.guardedPoiseMul += pct(v2);
    },
  }),
  trait({
    key: "kickback",
    color: "crimson",
    awakening: true,
    label: "蹴り返し: 予備動作中の敵を殴ると、その場で爆発が起きる（{v} ダメージ）",
    tags: ["melee", "damage"],
    slots: ALL_SLOTS,
    curve: curveFor("kickback"),
    apply: (s, v) => {
      pushFixedTrigger(s, { trigger: "onMeleeHit", condition: "targetInWindup", effect: "explode", magnitude: v });
    },
  }),
  trait({
    key: "plunder",
    color: "crimson",
    awakening: true,
    label: "剥ぎ取り: 精鋭を倒すと {v2} 秒間ダメージ +{v}%・移動速度 +{v}%",
    tags: ["damage", "mobility"],
    slots: ALL_SLOTS,
    curve: curveFor("plunder"),
    apply: (s, v, v2) => {
      pushFixedTrigger(s, { trigger: "onKill", condition: "targetElite", effect: "damageBuff", magnitude: v, duration: v2 });
      pushFixedTrigger(s, { trigger: "onKill", condition: "targetElite", effect: "speedBuff", magnitude: v, duration: v2 });
    },
  }),
  trait({
    key: "firstMove",
    color: "gold",
    awakening: true,
    label: "先の先: カウンターで相手に怯み値 {v} を追加で与える",
    tags: ["melee", "combo"],
    slots: ALL_SLOTS,
    curve: curveFor("firstMove"),
    apply: (s, v) => {
      pushFixedTrigger(s, { trigger: "onCounter", condition: "always", effect: "addPoise", magnitude: v });
    },
  }),
  trait({
    key: "curtainCall",
    color: "gold",
    awakening: true,
    label: "幕引き: 殲滅の瞬間に敵弾をすべて消し、奥義ゲージ +{v}",
    tags: ["burst"],
    slots: ALL_SLOTS,
    curve: curveFor("curtainCall"),
    apply: (s, v) => {
      s.traits.lastKillClearsBullets += 1;
      s.traits.lastKillEnergy += v;
    },
  }),

  // ---- 2026-09 第 2 弾: 属性（combat.ts の genreAndElement → system/traitHooks.ts の traitElementMul）----
  trait({
    key: "weakRead",
    color: "azure",
    label: "弱点読み: 属性の弱点を突くたびに気力 +{v}、弱点でない相手への与ダメージ -{v2}%",
    tags: ["mana", "elemental", "tradeoff"],
    slots: ["mainHand", "ring"],
    curve: curveFor("weakRead"),
    decimals: 1,
    apply: (s, v, v2) => {
      s.traits.weakHitMana += v;
      s.traits.nonWeakPenalty += pct(v2);
    },
  }),
  trait({
    key: "prismEdge",
    color: "crimson",
    label: "弱点刺し: 属性の弱点を突いた命中の与ダメージ +{v}%、弱点でない相手へは -{v2}%",
    tags: ["damage", "elemental", "tradeoff"],
    slots: ["mainHand", "amulet"],
    curve: curveFor("prismEdge"),
    apply: (s, v, v2) => {
      s.traits.weakDamageMul += pct(v);
      s.traits.nonWeakPenalty += pct(v2);
    },
  }),
  trait({
    key: "resistBreaker",
    color: "gold",
    label: "耐性破り: 敵の属性耐性による減少を {v}% 打ち消す、弱点を突いた命中の与ダメージ -{v2}%",
    tags: ["damage", "elemental", "tradeoff"],
    slots: ["mainHand", "ring"],
    curve: curveFor("resistBreaker"),
    cap: 100,
    apply: (s, v, v2) => {
      s.traits.resistPierce = Math.min(1, s.traits.resistPierce + pct(v));
      s.traits.weakDamageMul -= pct(v2);
    },
  }),
  trait({
    key: "backlash",
    color: "umbra",
    label: "逆撫で: 属性の耐性に阻まれた命中で、その属性の状態異常を {v} 秒付ける（反応の起点になる）",
    tags: ["status", "elemental"],
    slots: ["mainHand"],
    curve: curveFor("backlash"),
    decimals: 1,
    apply: (s, v) => {
      s.traits.resistedInflict = Math.max(s.traits.resistedInflict, v);
    },
  }),
  trait({
    key: "conductor",
    color: "gold",
    label: "通電: 濡れ・浸水の敵への与ダメージ +{v}%（雷属性の割合に応じてさらに上がる）",
    tags: ["damage", "elemental"],
    slots: OFFENSE_SLOTS,
    curve: curveFor("conductor"),
    apply: (s, v) => {
      s.traits.wetConductMul += pct(v);
    },
  }),
  trait({
    key: "igniter",
    color: "crimson",
    label: "引火: 油膜の敵への与ダメージ +{v}%（炎属性の割合に応じてさらに上がる）",
    tags: ["damage", "elemental"],
    slots: OFFENSE_SLOTS,
    curve: curveFor("igniter"),
    apply: (s, v) => {
      s.traits.oiledIgniteMul += pct(v);
    },
  }),
  trait({
    key: "elementalBreak",
    color: "umbra",
    label: "崩れの属性: 怯ませた敵に、武器の属性の状態異常を {v} 秒付ける（無属性の武器では付かない）",
    tags: ["status", "elemental"],
    slots: ["mainHand", "amulet"],
    curve: curveFor("elementalBreak"),
    decimals: 1,
    apply: (s, v) => {
      s.traits.elementBreak = Math.max(s.traits.elementBreak, v);
    },
  }),
  trait({
    key: "elementalWard",
    color: "jade",
    label: "属性の帳: 属性を持つ攻撃から受けるダメージ -{v}%、無属性の攻撃から受けるダメージ +{v2}%",
    tags: ["defense", "elemental", "tradeoff"],
    slots: ["armor", "boots", "amulet"],
    curve: curveFor("elementalWard"),
    apply: (s, v, v2) => {
      s.traits.elementalGuard += pct(v);
      s.traits.physicalExposure += pct(v2);
    },
  }),

  // ---- 武器種・銃の弾 ----
  trait({
    key: "chargeCore",
    color: "crimson",
    label: "溜めの芯: 溜めの段 1 つにつき近接ダメージ +{v}%、溜めを持つ武器で溜めずに振ると -{v2}%",
    tags: ["melee", "damage", "tradeoff"],
    slots: ["mainHand", "ring"],
    curve: curveFor("chargeCore"),
    apply: (s, v, v2) => {
      s.traits.chargedMeleeMul += pct(v);
      s.traits.unchargedPenalty += pct(v2);
    },
  }),
  trait({
    key: "chargeQuake",
    color: "gold",
    label: "溜め崩し: 溜めの段 1 つにつき、近接の怯み値 +{v}%・命中で奥義ゲージ +{v2}",
    tags: ["melee", "burst"],
    slots: ["mainHand"],
    curve: curveFor("chargeQuake"),
    apply: (s, v, v2) => {
      s.traits.chargedPoiseMul += pct(v);
      s.traits.chargedHitEnergy += v2;
    },
  }),
  trait({
    key: "branchArt",
    color: "gold",
    label: "派生の冴え: コンボ派生の命中の与ダメージ +{v}%、命中で気力 +{v2}",
    tags: ["combo", "melee"],
    slots: ["mainHand", "amulet"],
    curve: curveFor("branchArt"),
    decimals2: 1,
    apply: (s, v, v2) => {
      s.traits.branchDamageMul += pct(v);
      s.traits.branchHitMana += v2;
    },
  }),
  trait({
    key: "spreadCore",
    family: "gun",
    label: "散弾の芯: 散弾の射撃が近い敵に与えるダメージ +{v}%、遠い敵へは -{v2}%",
    tags: ["ranged", "tradeoff"],
    slots: ["mainHand"],
    curve: curveFor("spreadCore"),
    apply: (s, v, v2) => {
      s.traits.spreadCloseMul += pct(v);
      s.traits.spreadFarPenalty += pct(v2);
    },
  }),
  trait({
    key: "spreadShove",
    family: "gun",
    label: "散弾押し: 散弾の射撃の怯み値 +{v}%",
    tags: ["ranged", "utility"],
    slots: ["mainHand", "amulet"],
    curve: curveFor("spreadShove"),
    apply: (s, v) => {
      s.traits.spreadPoiseMul += pct(v);
    },
  }),
  trait({
    key: "homingVenom",
    family: "gun",
    color: "jade",
    label: "追尾の毒: 追尾の射撃の命中で、毒を {v} 秒付ける",
    tags: ["ranged", "status"],
    slots: ["mainHand"],
    curve: curveFor("homingVenom"),
    decimals: 1,
    apply: (s, v) => {
      s.traits.homingPoison = Math.max(s.traits.homingPoison, v);
    },
  }),
  trait({
    key: "rapidBrand",
    family: "gun",
    color: "umbra",
    label: "連射の烙印: 連射の射撃の命中が {v}% で烙印を刻む、射撃ダメージ -{v2}%",
    tags: ["ranged", "status", "tradeoff"],
    slots: ["mainHand"],
    curve: curveFor("rapidBrand"),
    cap: 100,
    apply: (s, v, v2) => {
      s.traits.rapidBrandChance = Math.min(1, s.traits.rapidBrandChance + pct(v));
      s.rangedDamageMul -= pct(v2);
    },
  }),
  trait({
    key: "brandDetonator",
    family: "gun",
    color: "gold",
    label: "起爆の手: 烙印の敵への射撃・スキルの与ダメージ +{v}%、烙印の無い敵への射撃 -{v2}%",
    tags: ["ranged", "damage", "tradeoff"],
    slots: ["mainHand", "ring", "amulet"],
    curve: curveFor("brandDetonator"),
    apply: (s, v, v2) => {
      s.traits.brandedMul += pct(v);
      s.traits.unbrandedPenalty += pct(v2);
    },
  }),

  // ---- ジョブ（state.job と得意武器。system/jobs.ts の isFavoredWeapon）----
  trait({
    key: "schoolForm",
    color: "crimson",
    label: "流派の型: ジョブの得意武器を持つ間、与ダメージ +{v}%、得意でない武器では -{v2}%",
    tags: ["damage", "tradeoff"],
    slots: ["mainHand", "ring", "amulet"],
    curve: curveFor("schoolForm"),
    apply: (s, v, v2) => {
      s.traits.favoredDamageMul += pct(v);
      s.traits.unfavoredPenalty += pct(v2);
    },
  }),
  trait({
    key: "selfTaught",
    color: "crimson",
    label: "我流: 得意でない武器の近接の怯み値 +{v}%、得意武器の近接の怯み値 -{v2}%",
    tags: ["melee", "tradeoff"],
    slots: ["mainHand", "ring"],
    curve: curveFor("selfTaught"),
    apply: (s, v, v2) => {
      s.traits.unfavoredPoiseMul += pct(v);
      s.traits.favoredPoisePenalty += pct(v2);
    },
  }),
  trait({
    key: "wanderer",
    color: "gold",
    label: "無所属: 見習い（ジョブなし）の間、与ダメージ +{v}%、ジョブを持つ間は -{v2}%",
    tags: ["damage", "tradeoff"],
    slots: JEWELRY_SLOTS,
    curve: curveFor("wanderer"),
    apply: (s, v, v2) => {
      s.traits.noJobDamageMul += pct(v);
      s.traits.jobPenalty += pct(v2);
    },
  }),
  trait({
    key: "schoolHarvest",
    color: "azure",
    label: "流派の糧: ジョブの得意武器を持つ間の撃破で気力 +{v}",
    tags: ["mana"],
    slots: ["mainHand", "amulet"],
    curve: curveFor("schoolHarvest"),
    decimals: 1,
    apply: (s, v) => {
      s.traits.favoredKillMana += v;
    },
  }),

  // ---- 地形（system/terrain.ts の terrainAt）----
  trait({
    key: "groundRooted",
    color: "jade",
    label: "地の利: 地形の上に立つ間、与ダメージ +{v}%、何も無い床では -{v2}%",
    tags: ["damage", "tradeoff"],
    slots: ["armor", "boots", "ring"],
    curve: curveFor("groundRooted"),
    apply: (s, v, v2) => {
      s.traits.terrainDamageMul += pct(v);
      s.traits.offTerrainPenalty += pct(v2);
    },
  }),
  trait({
    key: "slickFooting",
    color: "azure",
    label: "滑り足: 水たまり・氷床の上に立つ間、与ダメージ +{v}%",
    tags: ["damage", "mobility"],
    slots: ["boots", "ring"],
    curve: curveFor("slickFooting"),
    apply: (s, v) => {
      s.traits.slickDamageMul += pct(v);
    },
  }),
  trait({
    key: "mireGuard",
    color: "jade",
    label: "泥除け: 地形の上に立つ間、被ダメージ -{v}%",
    tags: ["defense"],
    slots: ["armor", "boots"],
    curve: curveFor("mireGuard"),
    apply: (s, v) => {
      s.traits.terrainGuard += pct(v);
    },
  }),
  trait({
    key: "terrainHunter",
    color: "crimson",
    label: "足場狩り: 地形の上にいる敵への与ダメージ +{v}%",
    tags: ["damage"],
    slots: ATTACK_SLOTS,
    curve: curveFor("terrainHunter"),
    apply: (s, v) => {
      s.traits.enemyOnTerrainMul += pct(v);
    },
  }),
  trait({
    key: "terrainBurst",
    color: "crimson",
    label: "地脈の炸裂: 地形の上にいる敵を倒すと、衝撃波を放つ（{v} ダメージ。炎・油・溶岩は燃焼、水・氷は冷気、毒沼・草は毒）",
    tags: ["damage", "elemental"],
    slots: ["mainHand", "amulet"],
    curve: curveFor("terrainBurst"),
    apply: (s, v) => {
      s.traits.terrainKillBlast += v;
    },
  }),
  trait({
    key: "emberTrail",
    color: "crimson",
    label: "残り火: 燃えている敵を倒すと、足元に炎を {v} 秒置く、炎耐性 -{v2}%",
    tags: ["elemental", "tradeoff"],
    slots: ["mainHand", "boots"],
    curve: curveFor("emberTrail"),
    decimals: 1,
    apply: (s, v, v2) => {
      s.traits.burningKillFire = Math.max(s.traits.burningKillFire, v);
      s.resist.fire -= v2;
    },
  }),
  trait({
    key: "frostTrail",
    color: "azure",
    label: "霜の轍: ダッシュの軌跡に氷床を {v} 秒残す、ダッシュ距離 -{v2}%",
    tags: ["mobility", "elemental", "tradeoff"],
    slots: ["boots"],
    curve: curveFor("frostTrail"),
    decimals: 1,
    apply: (s, v, v2) => {
      s.traits.dashIceTrail = Math.max(s.traits.dashIceTrail, v);
      s.dashDistanceMul -= pct(v2);
    },
  }),
  trait({
    key: "groundMend",
    color: "jade",
    label: "土の息: 地形の上に立つ間、毎秒生命 +{v}（戦闘中も有効。戦闘中の回復の上限あり）、最大生命 -{v2}",
    tags: ["life", "tradeoff"],
    slots: ["armor", "boots", "amulet"],
    curve: curveFor("groundMend"),
    decimals: 1,
    apply: (s, v, v2) => {
      s.traits.terrainRegen += v;
      s.maxHp -= v2;
    },
  }),

  // ---- 新しい状態異常（崩勢・腐食・宣告）----
  trait({
    key: "brokenHunter",
    color: "crimson",
    label: "崩勢狩り: 崩勢の敵への与ダメージ +{v}%",
    tags: ["damage", "melee"],
    slots: ["mainHand", "ring"],
    curve: curveFor("brokenHunter"),
    apply: (s, v) => {
      s.traits.brokenMul += pct(v);
    },
  }),
  trait({
    key: "corrodeClaw",
    color: "umbra",
    label: "腐食の爪: 腐食の敵への怯み値 +{v}%",
    tags: ["status", "melee"],
    slots: ["mainHand"],
    curve: curveFor("corrodeClaw"),
    apply: (s, v) => {
      s.traits.corrodePoiseMul += pct(v);
    },
  }),
  trait({
    key: "doomToll",
    color: "azure",
    label: "宣告の鐘: 宣告の付いた敵を倒すと気力 +{v}",
    tags: ["mana", "status"],
    slots: ["mainHand", "ring", "amulet"],
    curve: curveFor("doomToll"),
    apply: (s, v) => {
      s.traits.doomKillMana += v;
    },
  }),

  // ---- 交戦中・持ち替え ----
  trait({
    key: "siegeGuard",
    color: "jade",
    label: "籠城: 交戦中の部屋で被ダメージ -{v}%、それ以外では +{v2}%",
    tags: ["defense", "tradeoff"],
    slots: ["armor", "amulet"],
    curve: curveFor("siegeGuard"),
    apply: (s, v, v2) => {
      s.traits.engagedGuard += pct(v);
      s.traits.roamExposure += pct(v2);
    },
  }),
  trait({
    key: "siegeSpark",
    color: "gold",
    label: "封鎖の火花: 交戦中の部屋での撃破で奥義ゲージ +{v}",
    tags: ["burst"],
    slots: ["mainHand", "amulet"],
    curve: curveFor("siegeSpark"),
    apply: (s, v) => {
      s.traits.engagedKillEnergy += v;
    },
  }),
  trait({
    key: "switchHitter",
    color: "gold",
    label: "持ち替え: 直前と違う攻撃手段（近接・射撃・スキル）で当てると怯み値 +{v}%、同じ手段が続くと -{v2}%",
    tags: ["combo", "tradeoff"],
    slots: ["mainHand", "ring"],
    curve: curveFor("switchHitter"),
    apply: (s, v, v2) => {
      s.traits.alternatePoiseMul += pct(v);
      s.traits.repeatPoisePenalty += pct(v2);
    },
  }),
  trait({
    key: "switchBreath",
    color: "azure",
    label: "手替えの呼吸: 直前と違う攻撃手段（近接・射撃・スキル）で当てるたびに気力 +{v}",
    tags: ["mana"],
    slots: ["mainHand", "ring", "amulet"],
    curve: curveFor("switchBreath"),
    decimals: 1,
    apply: (s, v) => {
      s.traits.switchMana += v;
    },
  }),

  // ---- 第 2 弾の目覚め（芽専用。provenance.ts の節目が名指しする）----
  trait({
    key: "weakInsight",
    color: "azure",
    awakening: true,
    label: "弱点の目: 属性の弱点を突いた命中の与ダメージ +{v}%、気力 +{v2}",
    tags: ["elemental", "mana"],
    slots: ALL_SLOTS,
    curve: curveFor("weakInsight"),
    decimals2: 1,
    apply: (s, v, v2) => {
      s.traits.weakDamageMul += pct(v);
      s.traits.weakHitMana += v2;
    },
  }),
  trait({
    key: "sevenHues",
    color: "gold",
    awakening: true,
    label: "七色: 敵の属性耐性による減少を {v}% 打ち消し、弱点を突いた命中の与ダメージ +{v2}%",
    tags: ["elemental", "damage"],
    slots: ALL_SLOTS,
    curve: curveFor("sevenHues"),
    cap: 100,
    apply: (s, v, v2) => {
      s.traits.resistPierce = Math.min(1, s.traits.resistPierce + pct(v));
      s.traits.weakDamageMul += pct(v2);
    },
  }),
  trait({
    key: "counterGrain",
    color: "umbra",
    awakening: true,
    label: "逆目: 属性の耐性に阻まれた命中で、その属性の状態異常を {v} 秒付け、耐性による減少を {v2}% 打ち消す",
    tags: ["elemental", "status"],
    slots: ALL_SLOTS,
    curve: curveFor("counterGrain"),
    decimals: 1,
    apply: (s, v, v2) => {
      s.traits.resistedInflict = Math.max(s.traits.resistedInflict, v);
      s.traits.resistPierce = Math.min(1, s.traits.resistPierce + pct(v2));
    },
  }),
  trait({
    key: "groundWisdom",
    color: "jade",
    awakening: true,
    label: "地の利を知る: 地形の上に立つ間、与ダメージ +{v}%・被ダメージ -{v2}%",
    tags: ["damage", "defense"],
    slots: ALL_SLOTS,
    curve: curveFor("groundWisdom"),
    apply: (s, v, v2) => {
      s.traits.terrainDamageMul += pct(v);
      s.traits.terrainGuard += pct(v2);
    },
  }),
  trait({
    key: "mireLord",
    color: "jade",
    awakening: true,
    label: "沼の主: 地形の上にいる敵を倒すと衝撃波（{v} ダメージ）、地形の上の敵への与ダメージ +{v2}%",
    tags: ["damage", "elemental"],
    slots: ALL_SLOTS,
    curve: curveFor("mireLord"),
    apply: (s, v, v2) => {
      s.traits.terrainKillBlast += v;
      s.traits.enemyOnTerrainMul += pct(v2);
    },
  }),
  trait({
    key: "schoolMastery",
    color: "crimson",
    awakening: true,
    label: "免許皆伝: ジョブの得意武器を持つ間、与ダメージ +{v}%・撃破で気力 +{v2}",
    tags: ["damage", "mana"],
    slots: ALL_SLOTS,
    curve: curveFor("schoolMastery"),
    apply: (s, v, v2) => {
      s.traits.favoredDamageMul += pct(v);
      s.traits.favoredKillMana += v2;
    },
  }),
  trait({
    key: "schoolSecret",
    color: "gold",
    awakening: true,
    label: "秘伝: ジョブの得意武器を持つ間の与ダメージ +{v}%、コンボ派生の命中の与ダメージ +{v2}%",
    tags: ["damage", "combo"],
    slots: ALL_SLOTS,
    curve: curveFor("schoolSecret"),
    apply: (s, v, v2) => {
      s.traits.favoredDamageMul += pct(v);
      s.traits.branchDamageMul += pct(v2);
    },
  }),
  trait({
    key: "fullCharge",
    color: "crimson",
    awakening: true,
    label: "満ち溜め: 溜めの段 1 つにつき近接ダメージ +{v}%・命中で奥義ゲージ +{v2}",
    tags: ["melee", "burst"],
    slots: ALL_SLOTS,
    curve: curveFor("fullCharge"),
    apply: (s, v, v2) => {
      s.traits.chargedMeleeMul += pct(v);
      s.traits.chargedHitEnergy += v2;
    },
  }),
  trait({
    key: "formBreaker",
    color: "gold",
    awakening: true,
    label: "型破り: コンボ派生の命中の与ダメージ +{v}%・気力 +{v2}",
    tags: ["combo", "mana"],
    slots: ALL_SLOTS,
    curve: curveFor("formBreaker"),
    decimals2: 1,
    apply: (s, v, v2) => {
      s.traits.branchDamageMul += pct(v);
      s.traits.branchHitMana += v2;
    },
  }),
  trait({
    key: "hueBreak",
    color: "umbra",
    awakening: true,
    label: "崩れの色: 怯ませた敵に、武器の属性の状態異常を {v} 秒付ける",
    tags: ["status", "elemental"],
    slots: ALL_SLOTS,
    curve: curveFor("hueBreak"),
    decimals: 1,
    apply: (s, v) => {
      s.traits.elementBreak = Math.max(s.traits.elementBreak, v);
    },
  }),
  trait({
    key: "brokenBreaker",
    color: "crimson",
    awakening: true,
    label: "崩勢砕き: 崩勢の敵への与ダメージ +{v}%、腐食の敵への怯み値 +{v2}%",
    tags: ["damage", "status"],
    slots: ALL_SLOTS,
    curve: curveFor("brokenBreaker"),
    apply: (s, v, v2) => {
      s.traits.brokenMul += pct(v);
      s.traits.corrodePoiseMul += pct(v2);
    },
  }),
  trait({
    key: "battleRhythm",
    color: "gold",
    awakening: true,
    label: "戦の拍子: 直前と違う攻撃手段で当てると怯み値 +{v}%・気力 +{v2}",
    tags: ["combo", "mana"],
    slots: ALL_SLOTS,
    curve: curveFor("battleRhythm"),
    decimals2: 1,
    apply: (s, v, v2) => {
      s.traits.alternatePoiseMul += pct(v);
      s.traits.switchMana += v2;
    },
  }),
  trait({
    key: "stormConduit",
    color: "gold",
    awakening: true,
    label: "雷導: 濡れ・浸水の敵への与ダメージ +{v}%、油膜の敵への与ダメージ +{v2}%",
    tags: ["elemental", "damage"],
    slots: ALL_SLOTS,
    curve: curveFor("stormConduit"),
    apply: (s, v, v2) => {
      s.traits.wetConductMul += pct(v);
      s.traits.oiledIgniteMul += pct(v2);
    },
  }),
  trait({
    key: "siegeHeart",
    color: "jade",
    awakening: true,
    label: "籠城の心: 交戦中の部屋で被ダメージ -{v}%、撃破で奥義ゲージ +{v2}",
    tags: ["defense", "burst"],
    slots: ALL_SLOTS,
    curve: curveFor("siegeHeart"),
    apply: (s, v, v2) => {
      s.traits.engagedGuard += pct(v);
      s.traits.engagedKillEnergy += v2;
    },
  }),
  trait({
    key: "emberWalk",
    color: "crimson",
    awakening: true,
    label: "熾火歩き: 燃えている敵を倒すと足元に炎を {v} 秒置く、地形の上に立つ間の被ダメージ -{v2}%",
    tags: ["elemental", "defense"],
    slots: ALL_SLOTS,
    curve: curveFor("emberWalk"),
    decimals: 1,
    apply: (s, v, v2) => {
      s.traits.burningKillFire = Math.max(s.traits.burningKillFire, v);
      s.traits.terrainGuard += pct(v2);
    },
  }),
  trait({
    key: "frostWalk",
    color: "azure",
    awakening: true,
    label: "霜歩き: ダッシュの軌跡に氷床を {v} 秒残す、水たまり・氷床の上での与ダメージ +{v2}%",
    tags: ["mobility", "elemental"],
    slots: ALL_SLOTS,
    curve: curveFor("frostWalk"),
    decimals: 1,
    apply: (s, v, v2) => {
      s.traits.dashIceTrail = Math.max(s.traits.dashIceTrail, v);
      s.traits.slickDamageMul += pct(v2);
    },
  }),
  ...defenseElementTraits(),
];

// ---------------------------------------------------------------------------
// 変換の性質: 「A を B に変換する」でビルドの向きを変える（BiS を潰す主力）。
// 通常の抽選プール（traitsFor）には入らず、性質の枠ごとに CONVERSION_TRAIT_CHANCE（generator.ts）、
// 名のある遺物の固定セット、クラフトの「染め」からも付く。stage は "convert"（scale の後）。
// value は変換割合（%）など。変換は反転しない（負の値の変換は何もしない）。
// ---------------------------------------------------------------------------

export const CONVERSION_KEY_PREFIX = "cv_";

/** 近接ダメージ倍率 1.0 を移したときの burn DPS */
const BURN_DPS_PER_MELEE_MUL = 10;
/** 変換割合 1.0 あたりの burn 付与確率 */
const BURN_CHANCE_PER_FRACTION = 0.5;
/** 失った max HP 1 あたりの armor（armor 10 ≒ 被ダメ -17%） */
const ARMOR_PER_HP = 1 / 3;
/** 移した life on hit（与ダメの % 1 ポイント）あたりの energy gain 倍率 */
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
/** cv_regenToGain: 移したマナ自然回復 1/秒あたりのマナ回収倍率 */
const MANA_GAIN_PER_REGEN = 0.15;
/** cv_poiseToDamage: 移した怯み値倍率 1.0 あたりの与ダメージ倍率 */
const DAMAGE_PER_POISE = 0.5;
/** cv_lifeToMana / cv_manaToLife の交換比 */
const MANA_PER_HP = 0.5;
const HP_PER_MANA = 1.5;
/** cv_burstToSkill: 移した必殺ダメージ倍率 1.0 あたりのスキル威力 */
const SKILL_PER_BURST = 0.5;
/** cv_critToPoise: 移した会心率 1.0 あたりの怯み値倍率 */
const POISE_PER_CRIT = 2;
/** cv_resistToDamage: 捨てた耐性の平均 1%（表示単位）あたりの与ダメージ倍率 */
const DAMAGE_PER_RESIST_PCT = 0.005;
/** cv_resistToWarding: 捨てた耐性の平均 1% あたりの魔防 */
const WARDING_PER_RESIST_PCT = 1;
/** 状態異常の確率（0..1）1 あたりに移す属性の変換割合 */
const INFUSE_PER_STATUS_CHANCE = 2;
/** 会心率（0..1）1 あたりに移す光属性の変換割合 */
const INFUSE_PER_CRIT = 3;
/** 属性耐性を数える属性（無属性は防御が受け持つので除く） */
const RESIST_ELEMENTS: readonly Element[] = ELEMENTS.filter((e) => e !== "none");

/** 正の属性耐性をそれぞれ f 割捨て、捨てた量の平均（%）を返す */
function shedResist(s: PlayerStats, f: number): number {
  let shed = 0;
  for (const e of RESIST_ELEMENTS) {
    const moved = Math.max(0, s.resist[e]) * f;
    s.resist[e] -= moved;
    shed += moved;
  }
  return shed / RESIST_ELEMENTS.length;
}

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

/** 期待値曲線（組ごとに同じ形。深さで割合は変えず、揺らぎだけで振れる）。cv_dexToStr など key ごとに JSON から引く */
const ATTR_CONVERSION_CURVES: Readonly<Record<string, readonly CurvePoint[]>> = {
  cv_dexToStr: curveFor("cv_dexToStr"),
  cv_strToSpi: curveFor("cv_strToSpi"),
  cv_spiToVit: curveFor("cv_spiToVit"),
  cv_vitToMnd: curveFor("cv_vitToMnd"),
  cv_mndToDex: curveFor("cv_mndToDex"),
};

/** 期待値曲線（元は「変換割合の共通の期待値曲線」。深いほど多く移す）。cv_infuseFire など key ごとに JSON から引く */
const INFUSE_TRAIT_CURVES: Readonly<Record<Element, readonly CurvePoint[]>> = {
  none: curveFor("cv_infuseNone"),
  fire: curveFor("cv_infuseFire"),
  ice: curveFor("cv_infuseIce"),
  lightning: curveFor("cv_infuseLightning"),
  poison: curveFor("cv_infusePoison"),
  dark: curveFor("cv_infuseDark"),
  light: curveFor("cv_infuseLight"),
};

export const CONVERSION_AFFIXES: readonly AffixDef[] = [
  trait({
    key: "cv_meleeToBurn",
    label: "近接ダメージの{v}%を炎上に変換",
    tags: ["conversion", "melee", "elemental"],
    slots: MELEE_SLOTS,
    curve: curveFor("cv_meleeToBurn"),
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
    family: "gun",
    label: "拡散を貫通に変換: 追加弾1本ごとに射撃ダメージ -{v}%、貫通 +{v2}",
    tags: ["conversion", "ranged"],
    slots: RANGED_SLOTS,
    curve: curveFor("cv_splitToPierce"),
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
    curve: curveFor("cv_critToMultiplier"),
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
    curve: curveFor("cv_speedToAttack"),
    stage: "convert",
    apply: (s, v) => {
      const moved = Math.max(0, s.moveSpeedMul - BASE_MULTIPLIER) * fraction(v);
      s.moveSpeedMul -= moved;
      s.attackSpeedMul += moved;
    },
  }),
  trait({
    key: "cv_lifeToArmor",
    label: "最大生命の{v}%をアーマーに変換",
    tags: ["conversion", "life", "defense"],
    slots: ["armor", "amulet"],
    curve: curveFor("cv_lifeToArmor"),
    stage: "convert",
    apply: (s, v) => {
      const moved = s.maxHp * fraction(v);
      s.maxHp -= moved;
      s.armor += moved * ARMOR_PER_HP;
    },
  }),
  trait({
    key: "cv_chargesToDistance",
    label: "ダッシュ回数を距離に変換: 回数は 1 になり、元の回数 1 につきダッシュ距離 +{v}%",
    tags: ["conversion", "mobility"],
    slots: ["boots"],
    curve: curveFor("cv_chargesToDistance"),
    stage: "convert",
    apply: (s, v) => {
      s.dashDistanceMul += fraction(v) * s.dashCharges;
      s.dashCharges = REMAINING_DASH_CHARGES;
    },
  }),
  trait({
    key: "cv_leechToEnergy",
    label: "命中時・撃破時の生命回復の{v}%を奥義ゲージ獲得に変換",
    tags: ["conversion", "life", "burst"],
    slots: ["mainHand", "ring", "amulet"],
    curve: curveFor("cv_leechToEnergy"),
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
    label: "コンボダメージの{v}%を見切りダメージに変換",
    tags: ["conversion", "combo"],
    slots: ["boots", "ring", "amulet"],
    curve: curveFor("cv_comboToJust"),
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
    curve: curveFor("cv_meleeToRanged"),
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
    curve: curveFor("cv_critToBurn"),
    stage: "convert",
    apply: (s, v) => {
      const moved = s.critChance * fraction(v);
      s.critChance -= moved;
      s.burnChance += moved * BURN_CHANCE_PER_CRIT;
      s.burnDps += moved * BURN_DPS_PER_CRIT;
    },
  }),

  // ---- 2026-09 追加（docs/ideas/loot-expansion.md 3 章）: マナ・怯み・状態異常へ移す ----
  trait({
    key: "cv_regenToGain",
    label: "気力自然回復の{v}%を気力回収に変換（自然回復 1/秒につき回収 +15%）",
    tags: ["conversion", "mana", "skill"],
    slots: ["mainHand", "ring", "amulet"],
    curve: curveFor("cv_regenToGain"),
    stage: "convert",
    apply: (s, v) => {
      const moved = Math.max(0, s.manaRegen) * fraction(v);
      s.manaRegen -= moved;
      s.manaGainMul += moved * MANA_GAIN_PER_REGEN;
    },
  }),
  trait({
    key: "cv_knockbackToPoise",
    label: "ノックバックの上昇分の{v}%を怯み値に変換",
    tags: ["conversion", "melee"],
    slots: ["mainHand", "armor", "ring"],
    curve: curveFor("cv_knockbackToPoise"),
    stage: "convert",
    apply: (s, v) => {
      const moved = Math.max(0, s.knockbackMul - BASE_MULTIPLIER) * fraction(v);
      s.knockbackMul -= moved;
      s.poiseDamageMul += moved;
    },
  }),
  trait({
    key: "cv_projectilesToPoise",
    family: "gun",
    label: "弾数を 1 に変換し、減らした弾 1 本ごとに射撃の怯み値 +{v}%",
    tags: ["conversion", "ranged"],
    slots: ["mainHand", "amulet"],
    curve: curveFor("cv_projectilesToPoise"),
    stage: "convert",
    apply: (s, v) => {
      const removed = Math.max(0, Math.round(s.projectileCount) - BASE_PROJECTILES);
      s.projectileCount = BASE_PROJECTILES;
      s.traits.rangedPoiseMul += fraction(v) * removed;
    },
  }),
  trait({
    key: "cv_poiseToDamage",
    label: "怯み値の上昇分の{v}%を近接・射撃ダメージに変換（半分の率で）",
    tags: ["conversion", "melee", "damage"],
    slots: ["mainHand", "ring"],
    curve: curveFor("cv_poiseToDamage"),
    stage: "convert",
    apply: (s, v) => {
      const moved = Math.max(0, s.poiseDamageMul - BASE_MULTIPLIER) * fraction(v);
      s.poiseDamageMul -= moved;
      s.meleeDamageMul += moved * DAMAGE_PER_POISE;
      s.rangedDamageMul += moved * DAMAGE_PER_POISE;
    },
  }),
  trait({
    key: "cv_lifeToMana",
    label: "最大生命の{v}%を最大気力に変換（生命 2 につき気力 1）",
    tags: ["conversion", "mana", "life"],
    slots: ["armor", "amulet"],
    curve: curveFor("cv_lifeToMana"),
    stage: "convert",
    apply: (s, v) => {
      const moved = Math.max(0, s.maxHp) * fraction(v);
      s.maxHp -= moved;
      s.maxMana += moved * MANA_PER_HP;
    },
  }),
  trait({
    key: "cv_manaToLife",
    color: "jade",
    label: "最大気力の{v}%を最大生命に変換（気力 1 につき生命 1.5）",
    tags: ["conversion", "life", "mana"],
    slots: ["armor", "amulet"],
    curve: curveFor("cv_manaToLife"),
    stage: "convert",
    apply: (s, v) => {
      const moved = Math.max(0, s.maxMana) * fraction(v);
      s.maxMana -= moved;
      s.maxHp += moved * HP_PER_MANA;
    },
  }),
  trait({
    key: "cv_energyToMana",
    label: "奥義ゲージ獲得の上昇分の{v}%を気力回収に変換",
    tags: ["conversion", "mana", "burst"],
    slots: JEWELRY_SLOTS,
    curve: curveFor("cv_energyToMana"),
    stage: "convert",
    apply: (s, v) => {
      const moved = Math.max(0, s.energyGainMul - BASE_MULTIPLIER) * fraction(v);
      s.energyGainMul -= moved;
      s.manaGainMul += moved;
    },
  }),
  trait({
    key: "cv_burstToSkill",
    color: "gold",
    label: "奥義の威力の上昇分の{v}%をスキル威力に変換（半分の率で）",
    tags: ["conversion", "burst", "skill"],
    slots: ["mainHand", "amulet"],
    curve: curveFor("cv_burstToSkill"),
    stage: "convert",
    apply: (s, v) => {
      const moved = Math.max(0, s.burstDamageMul - BASE_MULTIPLIER) * fraction(v);
      s.burstDamageMul -= moved;
      s.skillDamageMul += moved * SKILL_PER_BURST;
    },
  }),
  trait({
    key: "cv_critToPoise",
    color: "crimson",
    label: "会心率の{v}%を怯み値に変換（会心率 1% につき怯み値 +2%）",
    tags: ["conversion", "critical", "melee"],
    slots: ["mainHand", "ring"],
    curve: curveFor("cv_critToPoise"),
    stage: "convert",
    apply: (s, v) => {
      const moved = Math.max(0, s.critChance) * fraction(v);
      s.critChance -= moved;
      s.poiseDamageMul += moved * POISE_PER_CRIT;
    },
  }),
  trait({
    key: "cv_burnToPoison",
    color: "umbra",
    label: "炎上の確率の{v}%を毒の付与に変換（炎上のダメージも同じ割合で消える）",
    tags: ["conversion", "status", "elemental"],
    slots: ATTACK_SLOTS,
    curve: curveFor("cv_burnToPoison"),
    stage: "convert",
    apply: (s, v) => {
      const f = fraction(v);
      const moved = Math.max(0, s.burnChance) * f;
      s.burnChance -= moved;
      s.burnDps -= Math.max(0, s.burnDps) * f;
      pushProc(s, { kind: "poison", chance: moved, stacks: PROC_STACKS, duration: STATUS.poison.duration, potency: STATUS.poison.hpRatioPerSec, on: "any" });
    },
  }),
  trait({
    key: "cv_chillToVulnerable",
    color: "umbra",
    label: "凍結確率の{v}%を脆弱の付与に変換",
    tags: ["conversion", "status", "elemental"],
    slots: ATTACK_SLOTS,
    curve: curveFor("cv_chillToVulnerable"),
    stage: "convert",
    apply: (s, v) => {
      const moved = Math.max(0, s.chillChance) * fraction(v);
      s.chillChance -= moved;
      pushProc(s, { kind: "vulnerable", chance: moved, stacks: PROC_STACKS, duration: STATUS.vulnerable.duration, potency: STATUS.vulnerable.mul, on: "any" });
    },
  }),

  // ---- 2026-09 第 2 弾: 防御・耐性・状態異常の確率を属性へ移す ----
  trait({
    key: "cv_armorToWarding",
    color: "jade",
    label: "防御の{v}%を魔防に変換",
    tags: ["conversion", "defense"],
    slots: ["armor", "boots", "amulet"],
    curve: curveFor("cv_armorToWarding"),
    stage: "convert",
    apply: (s, v) => {
      const moved = Math.max(0, s.armor) * fraction(v);
      s.armor -= moved;
      s.warding += moved;
    },
  }),
  trait({
    key: "cv_wardingToArmor",
    color: "jade",
    label: "魔防の{v}%を防御に変換",
    tags: ["conversion", "defense"],
    slots: ["armor", "boots", "amulet"],
    curve: curveFor("cv_wardingToArmor"),
    stage: "convert",
    apply: (s, v) => {
      const moved = Math.max(0, s.warding) * fraction(v);
      s.warding -= moved;
      s.armor += moved;
    },
  }),
  trait({
    key: "cv_resistToDamage",
    color: "crimson",
    label: "属性耐性の{v}%を近接・射撃ダメージに変換（捨てた耐性の平均 1% につき +0.5%）",
    tags: ["conversion", "damage", "elemental"],
    slots: ["armor", "ring", "amulet"],
    curve: curveFor("cv_resistToDamage"),
    stage: "convert",
    apply: (s, v) => {
      const bonus = shedResist(s, fraction(v)) * DAMAGE_PER_RESIST_PCT;
      s.meleeDamageMul += bonus;
      s.rangedDamageMul += bonus;
    },
  }),
  trait({
    key: "cv_resistToWarding",
    color: "jade",
    label: "属性耐性の{v}%を魔防に変換（捨てた耐性の平均 1% につき +1）",
    tags: ["conversion", "defense", "elemental"],
    slots: ["armor", "boots", "amulet"],
    curve: curveFor("cv_resistToWarding"),
    stage: "convert",
    apply: (s, v) => {
      s.warding += shedResist(s, fraction(v)) * WARDING_PER_RESIST_PCT;
    },
  }),
  trait({
    key: "cv_burnToFire",
    color: "crimson",
    label: "炎上確率の{v}%を炎属性の変換に移す（確率 1% につき 2%）",
    tags: ["conversion", "elemental"],
    slots: ATTACK_SLOTS,
    curve: curveFor("cv_burnToFire"),
    stage: "convert",
    apply: (s, v) => {
      const moved = Math.max(0, s.burnChance) * fraction(v);
      s.burnChance -= moved;
      s.infuse.fire += moved * INFUSE_PER_STATUS_CHANCE;
    },
  }),
  trait({
    key: "cv_chillToIce",
    color: "azure",
    label: "凍結確率の{v}%を氷属性の変換に移す（確率 1% につき 2%）",
    tags: ["conversion", "elemental"],
    slots: ATTACK_SLOTS,
    curve: curveFor("cv_chillToIce"),
    stage: "convert",
    apply: (s, v) => {
      const moved = Math.max(0, s.chillChance) * fraction(v);
      s.chillChance -= moved;
      s.infuse.ice += moved * INFUSE_PER_STATUS_CHANCE;
    },
  }),
  trait({
    key: "cv_shockToLightning",
    color: "gold",
    label: "感電確率の{v}%を雷属性の変換に移す（確率 1% につき 2%）",
    tags: ["conversion", "elemental"],
    slots: ATTACK_SLOTS,
    curve: curveFor("cv_shockToLightning"),
    stage: "convert",
    apply: (s, v) => {
      const moved = Math.max(0, s.shockChance) * fraction(v);
      s.shockChance -= moved;
      s.infuse.lightning += moved * INFUSE_PER_STATUS_CHANCE;
    },
  }),
  trait({
    key: "cv_critToLight",
    color: "gold",
    label: "会心率の{v}%を光属性の変換に移す（会心率 1% につき 3%）",
    tags: ["conversion", "critical", "elemental"],
    slots: OFFENSE_SLOTS,
    curve: curveFor("cv_critToLight"),
    stage: "convert",
    apply: (s, v) => {
      const moved = Math.max(0, s.critChance) * fraction(v);
      s.critChance -= moved;
      s.infuse.light += moved * INFUSE_PER_CRIT;
    },
  }),

  // ---- ステータスの変換（docs/COMBAT_DESIGN.md A-3）: 片方を捨てて片方を伸ばす交換 ----
  ...attributeConversions(),
  ...infuseConversions(),
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
    curve: ATTR_CONVERSION_CURVES[`${CONVERSION_KEY_PREFIX}${from}To${capitalize(to)}`]!,
    color: ATTR_COLOR[to],
    stage: "convert",
    apply: (s: PlayerStats, v: number) => {
      const moved = Math.max(0, s.attributes[from]) * fraction(v);
      s.attributes[from] -= moved;
      s.attributes[to] += moved;
    },
  }));
}

/**
 * 属性の変換 7 種（docs/COMBAT_DESIGN.md A-8）。近接・射撃（通常攻撃）の威力のうち v% をその属性として扱う
 * （割合の分だけ敵の耐性・弱点で倍率が変わる。弱点を突ける相手が増える代わりに、その属性に強い土地で鈍る）。
 * 無だけはスキル向けで、スキル固有の属性の v% を無属性に戻す（耐性の高い相手に通す代わりに弱点も突けなくなる）
 */
function infuseConversions(): AffixDef[] {
  const elemental: AffixDef[] = ELEMENTS.filter((e): e is Exclude<Element, "none"> => e !== "none").map((e) => ({
    key: `${INFUSE_KEY_PREFIX}${capitalize(e)}`,
    label: `近接・射撃の{v}%を${ELEMENT_LABEL[e]}属性に変換`,
    tags: ["conversion", "elemental"],
    slots: ATTACK_SLOTS,
    curve: INFUSE_TRAIT_CURVES[e],
    color: ELEMENT_TRAIT_COLOR[e],
    stage: "convert",
    apply: (s: PlayerStats, v: number) => {
      s.infuse[e] += fraction(v);
    },
  }));
  const neutral: AffixDef = {
    key: `${INFUSE_KEY_PREFIX}None`,
    label: "無の刻印: スキルの属性の{v}%を無属性に変換",
    tags: ["conversion", "skill"],
    slots: JEWELRY_SLOTS,
    curve: INFUSE_TRAIT_CURVES.none,
    color: ELEMENT_TRAIT_COLOR.none,
    stage: "convert",
    apply: (s: PlayerStats, v: number) => {
      s.skillNeutral += fraction(v);
    },
  };
  return [...elemental, neutral];
}

export function isConversionKey(key: string): boolean {
  return key.startsWith(CONVERSION_KEY_PREFIX);
}

/** slot に付けられ、depth で曲線が始まっている変換の性質 */
/** family を渡すと、その家系専用（AffixDef.family）の性質だけに絞る。省略は家系を問わない */
function familyAllowed(d: AffixDef, family: "melee" | "gun" | undefined): boolean {
  return d.family === undefined || family === undefined || d.family === family;
}

export function conversionsFor(slot: Slot, depth: number, family?: "melee" | "gun"): AffixDef[] {
  return CONVERSION_AFFIXES.filter((d) => d.slots.includes(slot) && firstDepth(d) <= depth && familyAllowed(d, family));
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

export type KeystoneGroup =
  | "body"
  | "tempo"
  | "style"
  | "mana"
  | "status"
  | "poise"
  | "room"
  | "hue"
  | "chronicle"
  // 2026-09 第 2 弾
  | "element"
  | "weapon"
  | "terrain";

/** ks_overdraw（過負荷）のスキル威力の低下 */
const OVERDRAW_SKILL_PENALTY = 0.1;
/** ks_silentVow（静寂の誓い）のマナ自然回復の倍率とスキル威力の上昇 */
const SILENT_VOW_REGEN_MUL = 3;
const SILENT_VOW_SKILL_BONUS = 0.3;
/** ks_thirst（渇きの誓約）の自然回復。攻撃の回収 ×3 は src/system/keystones.ts の attackManaMul */
const THIRST_MANA_REGEN = 0;
/** ks_bladeOath（近間の誓い）: 距離の境目の表示（m）。判定は src/system/combat.ts bladeOathMul */
const BLADE_OATH_RANGE = formatMeters(KEYSTONE.bladeOathRangePx);
const BLADE_OATH_FAR_PCT = Math.round((1 - KEYSTONE.bladeOathFarMul) * 100);
const BLADE_OATH_NEAR_PCT = Math.round((KEYSTONE.bladeOathNearMul - 1) * 100);
const BLADE_OATH_SPEED_PCT = Math.round(KEYSTONE.bladeOathAttackSpeedBonus * 100);

export interface KeystoneDef {
  key: string;
  name: string;
  description: string;
  exclusiveGroup: KeystoneGroup;
  /** 数値効果（メカニクスは戦闘側）。stats.keystones への push は共通処理が行う */
  apply: (stats: PlayerStats) => void;
}

const noNumericEffect = (): void => {};

/**
 * ks_oneElement（一色の誓い）: 属性の変換を最も大きい 1 つに寄せて 100% にする。変換が無ければ何もしない
 * （武器種の素の属性はそのまま。誓約は変換の後に畳むので、ここで見る infuse は全性質の合計）
 */
function focusInfuse(s: PlayerStats): void {
  let best: Element | undefined;
  for (const e of RESIST_ELEMENTS) if (s.infuse[e] > 0 && (best === undefined || s.infuse[e] > s.infuse[best])) best = e;
  if (best === undefined) return;
  for (const e of ELEMENTS) s.infuse[e] = e === best ? 1 : 0;
}

export const KEYSTONES: readonly KeystoneDef[] = [
  {
    key: "ks_glassCannon",
    name: "硝子の砲",
    description: "近接・射撃ダメージが2倍になる。最大生命が1/4になる。",
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
    description: `与ダメの ${KEYSTONE.vampireLeechPct}% を回復。生命自然回復とハート回収が無効になり、最大生命 -30%。`,
    exclusiveGroup: "body",
    apply: (s) => {
      s.lifeOnHit += KEYSTONE.vampireLeechPct;
      s.maxHp *= 0.7;
    },
  },
  {
    key: "ks_berserker",
    name: "狂戦士",
    description: "生命が減るほど与ダメージが上がる（最大 +100%）。生命自然回復が無効になり、回復量が半減する。",
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
    description: "攻撃速度・連射速度 +60%。攻撃のたびに生命を1消費する。",
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
    description: "怯んでいない敵の生命を1未満にできず、倒しきれない。怯み中の敵はそのまま倒せる。怯み値 +100%。",
    exclusiveGroup: "style",
    apply: (s) => {
      s.poiseDamageMul *= KEYSTONE.pacifistPoiseMul;
    },
  },
  {
    key: "ks_bladeOath",
    name: "近間の誓い",
    description: `${BLADE_OATH_RANGE}より遠い敵への与ダメージ -${BLADE_OATH_FAR_PCT}%、${BLADE_OATH_RANGE}以内の敵への与ダメージ +${BLADE_OATH_NEAR_PCT}%。攻撃速度 +${BLADE_OATH_SPEED_PCT}%。`,
    exclusiveGroup: "style",
    apply: (s) => {
      s.attackSpeedMul += KEYSTONE.bladeOathAttackSpeedBonus;
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
    description: "気力が足りなくても、不足分を生命で払ってスキルを撃てる（気力1につき生命0.5）。スキル威力 -10%。",
    exclusiveGroup: "mana",
    apply: (s) => {
      s.skillDamageMul -= OVERDRAW_SKILL_PENALTY;
    },
  },
  {
    key: "ks_silentVow",
    name: "静寂の誓い",
    description: "通常攻撃を当てても気力が戻らない。気力の自然回復が3倍になり、スキル威力 +30%。",
    exclusiveGroup: "mana",
    apply: (s) => {
      s.manaRegen *= SILENT_VOW_REGEN_MUL;
      s.skillDamageMul += SILENT_VOW_SKILL_BONUS;
    },
  },
  {
    key: "ks_thirst",
    name: "渇きの誓約",
    description: "気力が自然回復しなくなる。通常攻撃を当てて戻る気力が3倍になる。",
    exclusiveGroup: "mana",
    // 誓約は全性質の後（computeStats の最後）に畳むので、+自然回復の性質の順序に依らず 0 になる
    apply: (s) => {
      s.manaRegen = THIRST_MANA_REGEN;
    },
  },
  // ---- 2026-09 追加（docs/ideas/loot-expansion.md 2 章）。新しい排他グループ status / poise / room / hue / chronicle ----
  {
    key: "ks_pure",
    name: "無垢の誓い",
    description: "状態異常を一切受けない。代わりに装備による状態異常の付与（炎上・凍結・感電・命中時の付与・トリガーの付与）がすべて消える。",
    exclusiveGroup: "status",
    apply: (s) => {
      s.statusTakenMul = 0;
      s.burnChance = 0;
      s.chillChance = 0;
      s.shockChance = 0;
      s.statusProcs = [];
      s.triggers = s.triggers.filter((t) => t.effect !== "inflict");
    },
  },
  {
    key: "ks_blight",
    name: "蝕みの誓約",
    description: "装備による状態異常の付与確率が2倍になる。自分が受ける状態異常の持続も2倍になる。",
    exclusiveGroup: "status",
    apply: (s) => {
      const mul = KEYSTONE.blightChanceMul;
      s.burnChance *= mul;
      s.chillChance *= mul;
      s.shockChance *= mul;
      s.statusProcs = s.statusProcs.map((p) => ({ ...p, chance: Math.min(1, p.chance * mul) }));
      s.triggers = s.triggers.map((t) => (t.effect === "inflict" ? { ...t, chance: Math.min(1, t.chance * mul) } : t));
      s.statusTakenMul *= KEYSTONE.blightTakenMul;
    },
  },
  {
    key: "ks_contagion",
    name: "病みの誓い",
    description: "敵が倒れると、付いていた状態異常が周囲の敵へすべて移る。近接・射撃ダメージ -40%。",
    exclusiveGroup: "status",
    apply: (s) => {
      s.meleeDamageMul *= KEYSTONE.contagionDamageMul;
      s.rangedDamageMul *= KEYSTONE.contagionDamageMul;
    },
  },
  {
    key: "ks_wedgeOath",
    name: "楔の誓い",
    description: "怯み値が2.5倍になる。怯んでいない敵への与ダメージ -40%。",
    exclusiveGroup: "poise",
    apply: (s) => {
      s.poiseDamageMul *= KEYSTONE.wedgePoiseMul;
    },
  },
  {
    key: "ks_unshaken",
    name: "揺るがぬ誓い",
    description: "攻撃で敵を怯ませられなくなる。代わりに近接・射撃・スキルの与ダメージ +35%、怯み値の上昇分の半分も与ダメージになる。",
    exclusiveGroup: "poise",
    apply: (s) => {
      const bonus = KEYSTONE.unshakenDamageBonus + Math.max(0, s.poiseDamageMul - BASE_MULTIPLIER) * KEYSTONE.unshakenPoiseToDamage;
      s.meleeDamageMul += bonus;
      s.rangedDamageMul += bonus;
      s.skillDamageMul += bonus;
      s.poiseDamageMul = 0;
    },
  },
  {
    key: "ks_chokehold",
    name: "締め上げの誓い",
    description: "堅守中の敵にも怯み値が減らずに通り、固め続けられる。怯み値 -30%。",
    exclusiveGroup: "poise",
    apply: (s) => {
      s.poiseDamageMul *= KEYSTONE.chokeholdPoiseMul;
    },
  },
  {
    key: "ks_readOath",
    name: "読み勝ちの誓い",
    description: "予備動作中の敵への近接は怯み値が10倍になる。それ以外の敵への近接は怯み値が0になり、与ダメージ -30%。",
    exclusiveGroup: "tempo",
    apply: noNumericEffect,
  },
  {
    key: "ks_backwater",
    name: "背水の誓い",
    description: "交戦中の部屋では回復が効かない代わりに与ダメージ +15%。部屋を制圧すると失った生命の50%を取り戻す。",
    exclusiveGroup: "room",
    apply: (s) => {
      s.triggers.push({ trigger: "onRoomClear", condition: "always", effect: "healMissing", magnitude: KEYSTONE.backwaterClearHealPct, chance: 1 });
    },
  },
  {
    key: "ks_reaperOath",
    name: "死神の誓い",
    description: "死神が2倍の早さで現れる。与ダメージ +15%、死神が出ている間は +40%。",
    exclusiveGroup: "room",
    apply: noNumericEffect,
  },
  {
    key: "ks_chant",
    name: "詠唱の誓い",
    description: "近接・射撃の与ダメージが30%になる。通常攻撃の命中で戻る気力が4倍になり、スキル威力 +50%。",
    exclusiveGroup: "mana",
    apply: (s) => {
      s.meleeDamageMul *= KEYSTONE.chantAttackDamageMul;
      s.rangedDamageMul *= KEYSTONE.chantAttackDamageMul;
      s.skillDamageMul += KEYSTONE.chantSkillBonus;
    },
  },
  {
    key: "ks_monochrome",
    name: "単色の誓い",
    description: "共鳴は支配だけになり、1色が35%で成立する。支配の効果が2回掛かり、支配色以外の性質は50%に弱まる。",
    exclusiveGroup: "hue",
    apply: noNumericEffect,
  },
  {
    key: "ks_colorless",
    name: "無色の誓い",
    description: "共鳴が起きなくなる。代わりに全ての性質（誓約を除く）の値が20%上がる。",
    exclusiveGroup: "hue",
    apply: noNumericEffect,
  },
  {
    key: "ks_mirror",
    name: "鏡の誓い",
    description: "性質の色を反対色として数える（紅と蒼、翠と金が入れ替わる）。冥は配合に数えない。",
    exclusiveGroup: "hue",
    apply: noNumericEffect,
  },
  {
    key: "ks_discipline",
    name: "修行の誓い",
    description: "装備の来歴が3倍の早さで積もる。近接・射撃・スキルの与ダメージ -20%。",
    exclusiveGroup: "chronicle",
    apply: (s) => {
      s.meleeDamageMul *= KEYSTONE.disciplineDamageMul;
      s.rangedDamageMul *= KEYSTONE.disciplineDamageMul;
      s.skillDamageMul *= KEYSTONE.disciplineDamageMul;
    },
  },
  {
    key: "ks_oblivion",
    name: "忘却の誓い",
    description: "来歴が積もらず、芽も出ない。代わりに装備全体の残り余白1につき全ステータス +1。",
    exclusiveGroup: "chronicle",
    apply: (s) => {
      const bonus = s.traits.gearMargin * KEYSTONE.oblivionAttrPerMargin;
      for (const k of ATTR_KEYS) s.attributes[k] += bonus;
    },
  },
  // ---- 2026-09 第 2 弾: 属性 / 武器 / 地形の排他グループ。判定は src/system/traitHooks.ts ----
  {
    key: "ks_oneElement",
    name: "一色の誓い",
    description: `近接・射撃の属性を、最も強い属性の変換 1 つに寄せる（100%）。近接・射撃ダメージ +${ratioPct(KEYSTONE.oneElementDamageBonus)}%。全属性耐性 -${KEYSTONE.oneElementResistLoss}%。`,
    exclusiveGroup: "element",
    apply: (s) => {
      focusInfuse(s);
      s.meleeDamageMul += KEYSTONE.oneElementDamageBonus;
      s.rangedDamageMul += KEYSTONE.oneElementDamageBonus;
      for (const e of ELEMENTS) if (e !== "none") s.resist[e] -= KEYSTONE.oneElementResistLoss;
    },
  },
  {
    key: "ks_weakOath",
    name: "弱点の誓い",
    description: `属性の弱点を突いた命中は ${KEYSTONE.weakOathWeakMul} 倍、弱点を突かなかった命中は ${KEYSTONE.weakOathOtherMul} 倍になる。`,
    exclusiveGroup: "element",
    apply: noNumericEffect,
  },
  {
    key: "ks_nullOath",
    name: "無の誓い",
    description: `属性の変換をすべて捨て、敵の属性耐性と弱点を無視する。近接・射撃ダメージ +${ratioPct(KEYSTONE.nullOathDamageBonus)}%。状態異常の効果量 -${ratioPct(1 - KEYSTONE.nullOathPotencyMul)}%。`,
    exclusiveGroup: "element",
    apply: (s) => {
      for (const e of ELEMENTS) s.infuse[e] = 0;
      s.meleeDamageMul += KEYSTONE.nullOathDamageBonus;
      s.rangedDamageMul += KEYSTONE.nullOathDamageBonus;
      s.statusPotencyMul *= KEYSTONE.nullOathPotencyMul;
    },
  },
  {
    key: "ks_ironOath",
    name: "鉄の誓い",
    description: `ジョブの得意武器の近接は与ダメージ ${KEYSTONE.ironFavoredMul} 倍・怯み値 ${KEYSTONE.ironFavoredPoiseMul} 倍。得意でない武器の近接は与ダメージ ${KEYSTONE.ironUnfavoredMul} 倍（見習いは得意武器を持たない）。`,
    exclusiveGroup: "weapon",
    apply: noNumericEffect,
  },
  {
    key: "ks_chargeOath",
    name: "溜めの誓い",
    description: `溜めの段 1 つにつき近接の与ダメージ +${ratioPct(KEYSTONE.chargeOathPerLevel)}%。溜めを持つ武器で溜めずに振った近接は ${KEYSTONE.chargeOathUnchargedMul} 倍。`,
    exclusiveGroup: "weapon",
    apply: noNumericEffect,
  },
  {
    key: "ks_stanceOath",
    name: "構えの誓い",
    description: `近接を振っている間（予備動作〜攻撃判定）の被ダメージが ${KEYSTONE.stanceGuardMul} 倍、それ以外の間は ${KEYSTONE.stanceExposedMul} 倍になる。`,
    exclusiveGroup: "weapon",
    apply: noNumericEffect,
  },
  {
    key: "ks_earthOath",
    name: "土の誓い",
    description: `生命が自然回復しなくなる。代わりに地形の上に立つ間は、戦闘中でも毎秒生命 +${KEYSTONE.earthRegenPerSec}（戦闘中の回復の上限あり）。`,
    exclusiveGroup: "terrain",
    apply: (s) => {
      s.hpRegen = 0;
    },
  },
  {
    key: "ks_slickOath",
    name: "滑りの誓い",
    description: `水たまり・氷床の上に立つ間の与ダメージが ${KEYSTONE.slickOnMul} 倍、それ以外の床では ${KEYSTONE.slickOffMul} 倍になる。`,
    exclusiveGroup: "terrain",
    apply: noNumericEffect,
  },
  {
    key: "ks_emberOath",
    name: "熾火の誓い",
    description: `燃えている敵か、炎・油・溶岩の上の敵への与ダメージ ${KEYSTONE.emberOnMul} 倍、それ以外は ${KEYSTONE.emberOffMul} 倍。燃えている敵を倒すと足元に炎を置く。炎耐性 -${KEYSTONE.emberFireResistLoss}%。`,
    exclusiveGroup: "terrain",
    apply: (s) => {
      s.resist.fire -= KEYSTONE.emberFireResistLoss;
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
    label: "最大生命 +{v}、移動速度 +5%",
    range: { min: 5, max: 10 },
    apply: (s, v) => {
      s.maxHp += v;
      s.moveSpeedMul += pct(5);
    },
  },
  {
    key: "implicit.leather",
    label: "最大生命 +{v}",
    range: { min: 12, max: 20 },
    apply: (s, v) => {
      s.maxHp += v;
    },
  },
  {
    key: "implicit.chain",
    label: "最大生命 +{v}、アーマー +{v2}",
    range: { min: 20, max: 30, min2: 3, max2: 5 },
    apply: (s, v, v2) => {
      s.maxHp += v;
      s.armor += v2;
    },
  },
  {
    key: "implicit.plate",
    label: "アーマー +{v}、最大生命 +20、移動速度 -8%",
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
    label: "最大生命 +{v}",
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
    label: `撃破時の生命回復 +{v}（${HEAL.killHealMinCombo}コンボ以上）`,
    // 1〜3 → 1〜2（memo 2026-09-24: 回復系を 30〜50% 下げる。implicit は FLUX の係数を受けないので手で下げる）
    range: { min: 1, max: 2 },
    apply: (s, v) => {
      s.lifeOnKill += v;
    },
  },
  {
    key: "implicit.voidBand",
    label: "会心倍率 +{v}%、最大生命 -10",
    range: { min: 15, max: 25 },
    apply: (s, v) => {
      s.critMul += pct(v);
      s.maxHp -= 10;
    },
  },
  // amulet
  {
    key: "implicit.jadeAmulet",
    label: "奥義ゲージ獲得 +{v}%",
    range: { min: 5, max: 10 },
    apply: (s, v) => {
      s.energyGainMul += pct(v);
    },
  },
  {
    key: "implicit.amberAmulet",
    label: "生命自然回復 +{v}/秒（敵が近くにいない間）",
    // 0.2〜0.5 → 0.1〜0.3（同上）
    range: { min: 0.1, max: 0.3 },
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
    label: "奥義の範囲 +{v}%",
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
    label: "奥義の威力 +{v}%、奥義ゲージ獲得 -8%",
    range: { min: 15, max: 25 },
    apply: (s, v) => {
      s.burstDamageMul += pct(v);
      s.energyGainMul -= pct(8);
    },
  },
  // ---- 2026-09 追加のベース（docs/ideas/loot-expansion.md 5-1）----
  {
    key: "implicit.machete",
    label: "炎上確率 +{v}%（炎上 3 ダメージ/秒）、リーチ -10%",
    range: { min: 8, max: 12 },
    apply: (s, v) => {
      s.burnChance += pct(v);
      s.burnDps += MACHETE_BURN_DPS;
      s.meleeReachMul -= pct(10);
    },
  },
  {
    key: "implicit.rapier",
    label: "会心時の怯み値 +{v}%、会心率 +3%、ノックバック -20%",
    range: { min: 40, max: 60 },
    apply: (s, v) => {
      s.traits.critPoiseMul += pct(v);
      s.critChance += pct(3);
      s.knockbackMul -= pct(20);
    },
  },
  {
    key: "implicit.scythe",
    label: `撃破時の生命回復 +{v}（${HEAL.killHealMinCombo}コンボ以上）、リーチ +15%、攻撃速度 -15%`,
    // 2〜4 → 1〜3（同上）
    range: { min: 1, max: 3 },
    apply: (s, v) => {
      s.lifeOnKill += v;
      s.meleeReachMul += pct(15);
      s.attackSpeedMul -= pct(15);
    },
  },
  {
    key: "implicit.staff",
    label: "怯み値 +{v}%、気力回収 +20%、近接ダメージ -20%",
    range: { min: 25, max: 35 },
    apply: (s, v) => {
      s.poiseDamageMul += pct(v);
      s.manaGainMul += pct(20);
      s.meleeDamageMul -= pct(20);
    },
  },
  {
    key: "implicit.throwingKnives",
    label: "連射速度 +{v}%、会心率 +3%、射撃ダメージ -15%",
    range: { min: 15, max: 25 },
    apply: (s, v) => {
      s.fireRateMul += pct(v);
      s.critChance += pct(3);
      s.rangedDamageMul -= pct(15);
    },
  },
  {
    key: "implicit.matchlock",
    label: "炎上確率 +{v}%（炎上 4 ダメージ/秒）、連射速度 -30%",
    range: { min: 45, max: 60 },
    apply: (s, v) => {
      s.burnChance += pct(v);
      s.burnDps += MATCHLOCK_BURN_DPS;
      s.fireRateMul -= pct(30);
    },
  },
  {
    key: "implicit.blowgun",
    label: "射撃命中時 25% で毒、状態異常の効果量 +{v}%、射撃ダメージ -35%",
    range: { min: 15, max: 25 },
    apply: (s, v) => {
      pushProc(s, statusProc("poison", BLOWGUN_POISON_PCT, STATUS.poison.duration, STATUS.poison.hpRatioPerSec, "ranged"));
      s.statusPotencyMul += pct(v);
      s.rangedDamageMul -= pct(35);
    },
  },
  {
    key: "implicit.robe",
    label: "最大気力 +{v}、最大生命 -15",
    range: { min: 12, max: 18 },
    apply: (s, v) => {
      s.maxMana += v;
      s.maxHp -= 15;
    },
  },
  {
    key: "implicit.scale",
    label: "受ける状態異常の持続 -{v}%、最大生命 +10",
    range: { min: 15, max: 25 },
    apply: (s, v) => {
      s.statusTakenMul -= pct(v);
      s.maxHp += 10;
    },
  },
  {
    key: "implicit.spiked",
    label: "攻撃者に {v} ダメージを反射、被ダメージ +5%",
    range: { min: 6, max: 10 },
    apply: (s, v) => {
      s.thorns += v;
      s.damageTakenMul += pct(5);
    },
  },
  {
    key: "implicit.ironGeta",
    label: "アーマー +{v}、怯み値 +10%、移動速度 -12%",
    range: { min: 5, max: 8 },
    apply: (s, v) => {
      s.armor += v;
      s.poiseDamageMul += pct(10);
      s.moveSpeedMul -= pct(12);
    },
  },
  {
    key: "implicit.tabi",
    label: "ダッシュ時: 1 秒間移動速度 +{v}%",
    range: { min: 15, max: 25 },
    apply: (s, v) => {
      pushFixedTrigger(s, { trigger: "onDash", condition: "always", effect: "speedBuff", magnitude: v, duration: TABI_BUFF_SECONDS });
    },
  },
  {
    key: "implicit.snowBoots",
    label: "{v}%の確率で凍結（15%減速）、移動速度 -5%",
    range: { min: 6, max: 10 },
    apply: (s, v) => {
      s.chillChance += pct(v);
      s.chillSlow += pct(15);
      s.moveSpeedMul -= pct(5);
    },
  },
  {
    key: "implicit.boneRing",
    label: "撃破で気力 +{v}",
    range: { min: 1, max: 3 },
    apply: (s, v) => {
      s.manaOnKill += v;
    },
  },
  {
    key: "implicit.twinRing",
    label: "二重の共鳴の成立条件を {v} ポイント下げる",
    range: { min: 2, max: 4 },
    // 判定は resonance.ts の resonanceRules（数値は stats に畳まない）
    apply: noTraitEffect,
  },
  {
    key: "implicit.blackIronRing",
    label: "装備中の反転した性質 1 つにつき会心率 +{v}%",
    range: { min: 2, max: 3 },
    apply: (s, v) => {
      s.critChance += pct(v) * s.traits.gearInverted;
    },
  },
  {
    key: "implicit.signet",
    label: "この遺物の来歴が 2 倍の早さで積もる、最大生命 -{v}",
    range: { min: 4, max: 8 },
    // 来歴の倍速は provenance.ts の progressFor
    apply: (s, v) => {
      s.maxHp -= v;
    },
  },
  {
    key: "implicit.rosary",
    label: "気力自然回復 +{v}/秒、近接ダメージ -10%",
    range: { min: 0.3, max: 0.5 },
    decimals: 1,
    apply: (s, v) => {
      s.manaRegen += v;
      s.meleeDamageMul -= pct(10);
    },
  },
  {
    key: "implicit.bell",
    label: "会心時 {v}% で恐怖させる",
    range: { min: 15, max: 25 },
    apply: (s, v) => {
      pushProc(s, { ...statusProc("fear", v, STATUS.fear.duration, NO_POTENCY, "any"), requiresCrit: true });
    },
  },
  {
    key: "implicit.fangNecklace",
    label: `近接命中時 {v}% で出血させる（${BLEED_STEP} 動くごとに ${FANG_BLEED_POTENCY} ダメージ）`,
    range: { min: 8, max: 12 },
    apply: (s, v) => {
      pushProc(s, statusProc("bleed", v, STATUS.bleed.duration, FANG_BLEED_POTENCY, "melee"));
    },
  },
  // ---- 2026-09 第 2 弾のベース（武器種・銃の弾ごとに選べる器を増やす）----
  {
    key: "implicit.katana",
    label: "コンボ派生の命中の与ダメージ +{v}%",
    range: { min: 15, max: 22 },
    apply: (s, v) => {
      s.traits.branchDamageMul += pct(v);
    },
  },
  {
    key: "implicit.zanbato",
    label: "溜めの段 1 つにつき近接ダメージ +{v}%、攻撃速度 -8%",
    range: { min: 8, max: 12 },
    apply: (s, v) => {
      s.traits.chargedMeleeMul += pct(v);
      s.attackSpeedMul -= pct(ZANBATO_SLOW_PCT);
    },
  },
  {
    key: "implicit.twinDaggers",
    label: "会心率 +{v}%",
    range: { min: 4, max: 6 },
    apply: (s, v) => {
      s.critChance += pct(v);
    },
  },
  {
    key: "implicit.halberd",
    label: "怯み値 +{v}%、攻撃速度 -5%",
    range: { min: 15, max: 22 },
    apply: (s, v) => {
      s.poiseDamageMul += pct(v);
      s.attackSpeedMul -= pct(HALBERD_SLOW_PCT);
    },
  },
  {
    key: "implicit.sickle",
    label: "近接・射撃の{v}%を闇属性に変換",
    range: { min: 20, max: 30 },
    stage: "convert",
    apply: (s, v) => {
      s.infuse.dark += Math.max(0, pct(v));
    },
  },
  {
    key: "implicit.cestus",
    label: "攻撃速度 +{v}%",
    range: { min: 8, max: 12 },
    apply: (s, v) => {
      s.attackSpeedMul += pct(v);
    },
  },
  {
    key: "implicit.chainWhip",
    label: "濡れ・浸水の敵への与ダメージ +{v}%",
    range: { min: 15, max: 22 },
    apply: (s, v) => {
      s.traits.wetConductMul += pct(v);
    },
  },
  {
    key: "implicit.shakujo",
    label: "最大気力 +{v}",
    range: { min: 8, max: 12 },
    apply: (s, v) => {
      s.maxMana += v;
    },
  },
  {
    key: "implicit.crystalWand",
    label: "属性の弱点を突くたびに気力 +{v}",
    range: { min: 1, max: 1.5 },
    decimals: 1,
    apply: (s, v) => {
      s.traits.weakHitMana += v;
    },
  },
  {
    key: "implicit.blunderbuss",
    label: "散弾の射撃が近い敵に与えるダメージ +{v}%",
    range: { min: 15, max: 22 },
    apply: (s, v) => {
      s.traits.spreadCloseMul += pct(v);
    },
  },
  {
    key: "implicit.crossbow",
    label: "射撃の怯み値 +{v}%、連射速度 -10%",
    range: { min: 25, max: 35 },
    apply: (s, v) => {
      s.traits.rangedPoiseMul += pct(v);
      s.fireRateMul -= pct(CROSSBOW_SLOW_PCT);
    },
  },
  {
    key: "implicit.chakram",
    label: "弾速 +{v}%",
    range: { min: 15, max: 22 },
    apply: (s, v) => {
      s.projectileSpeedMul += pct(v);
    },
  },
  {
    key: "implicit.handCannon",
    label: "近接・射撃の{v}%を炎属性に変換",
    range: { min: 20, max: 30 },
    stage: "convert",
    apply: (s, v) => {
      s.infuse.fire += Math.max(0, pct(v));
    },
  },
  {
    key: "implicit.caltrops",
    label: "地形の上にいる敵への与ダメージ +{v}%",
    range: { min: 12, max: 18 },
    apply: (s, v) => {
      s.traits.enemyOnTerrainMul += pct(v);
    },
  },
  {
    key: "implicit.seekerOrb",
    label: "状態異常の効果量 +{v}%",
    range: { min: 10, max: 15 },
    apply: (s, v) => {
      s.statusPotencyMul += pct(v);
    },
  },
  {
    key: "implicit.mino",
    label: "地形の上に立つ間、被ダメージ -{v}%",
    range: { min: 8, max: 12 },
    apply: (s, v) => {
      s.traits.terrainGuard += pct(v);
    },
  },
  // ---- 2026-09-24 レーン B の武器種の器（docs/ideas/combat-feel-design.md B-1） ----
  {
    key: "implicit.tachi",
    label: "溜めの段 1 つにつき近接ダメージ +{v}%（居合が伸びる）",
    range: { min: 8, max: 12 },
    apply: (s, v) => {
      s.traits.chargedMeleeMul += pct(v);
    },
  },
  {
    key: "implicit.battleAxe",
    label: `近接命中時 {v}% で出血させる（${BLEED_STEP} 動くごとに ${FANG_BLEED_POTENCY} ダメージ）`,
    range: { min: 8, max: 12 },
    apply: (s, v) => {
      pushProc(s, statusProc("bleed", v, STATUS.bleed.duration, FANG_BLEED_POTENCY, "melee"));
    },
  },
  {
    key: "implicit.kiteShield",
    label: "防御 +{v}",
    range: { min: 6, max: 10 },
    apply: (s, v) => {
      s.armor += v;
    },
  },
  {
    key: "implicit.weightedChain",
    label: "リーチ +{v}%（分銅が遠くまで届く）",
    range: { min: 10, max: 15 },
    apply: (s, v) => {
      s.meleeReachMul += pct(v);
    },
  },
  {
    key: "implicit.maul",
    label: "怯み値 +{v}%、攻撃速度 -10%",
    range: { min: 20, max: 30 },
    apply: (s, v) => {
      s.poiseDamageMul += pct(v);
      s.attackSpeedMul -= pct(MAUL_SLOW_PCT);
    },
  },
  {
    key: "implicit.twinRevolvers",
    label: "会心率 +{v}%",
    range: { min: 6, max: 10 },
    apply: (s, v) => {
      s.critChance += pct(v);
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

/** slot に付けられ、depth で曲線が始まっている通常の性質（変換・目覚めは含まない） */
export function traitsFor(slot: Slot, depth: number, family?: "melee" | "gun"): AffixDef[] {
  return AFFIXES.filter((d) => d.awakening !== true && d.slots.includes(slot) && firstDepth(d) <= depth && familyAllowed(d, family));
}

/** 目覚め（芽専用の性質）の定義 */
export function isAwakeningKey(key: string): boolean {
  return affixDef(key)?.awakening === true;
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
      return decoded === null ? `不明な性質（${r.key}）` : formatTrigger(decoded);
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
  if (resolved === undefined) return `不明な性質（${roll.key}）`;
  return resolved.format(roll);
}
