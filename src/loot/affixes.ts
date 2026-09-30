import { BALANCE } from "../data/balance";
import { type DamageTag, withMore } from "../core/damage";
import { ELEMENTS, ELEMENT_LABEL, type Element } from "../core/element";
import type { StatusKind, StatusProc } from "../core/status";
import { formatMeters } from "../core/units";
import { ECONOMY, HEAL, KEYSTONE, STATUS, TRIGGER } from "../data/tuning";
import type { EventKind, EventSource } from "../core/events";
import { type KeywordProfile, emptyProfile, kw } from "../core/keywords";
import { type Modifier, type ModifierPer, type Rule, type RuleCondition, type RuleEffect, SCOPE_ANY, ruleId } from "../core/rules";
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
 * 性質（旧アフィックス）の定義（データ駆動）。docs/LOOT_DESIGN.md の「性質」、docs/ideas/relics-7d-plan.md 1 章を参照。
 * 性質は 2 つの族と来歴だけ（段取り 7d）: 無条件に数値を上げる性質は無い（それは地金 innate.ts の役目）。
 * - 条件の族（tags に condition）: 条件を満たす間だけ与ダメが上がる。代償を持たない（条件が代償）
 * - 行動: 状態異常・トリガー・源（燃焼・冷気・感電・爆発）・ルールの欄を動かす。代償は基礎の欄を下げる向きだけ
 * 各性質は期待値曲線（curve）と色と語（keywords。共鳴の数え）を持つ。
 * 値はすべて「表示単位」で保持する（+25% なら value = 25）。apply で PlayerStats の単位に変換する。
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
  | "skill"
  /** 条件の族（条件を満たす間だけ効く。代償を持たない。docs/ideas/relics-7d-plan.md 1-1） */
  | "condition";

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
   * 目覚め（芽専用の性質）。ドロップ・芽の通常の抽選には出ず、
   * provenance.ts の節目が名指ししたときだけ芽の片方に出る。段取り 7d で専用の性質は 0 になった（口だけ残す）
   */
  awakening?: boolean;
  /** 共鳴の数えに使う語（出す / 食う / 強める。system/resonance.ts が遺物 1 つにつき語ごと最大 1 と数える） */
  keywords?: KeywordProfile;
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
const ATTACK_SLOTS: readonly Slot[] = ["mainHand", "ring"];
const OFFENSE_SLOTS: readonly Slot[] = ["mainHand", "ring", "amulet"];
const JEWELRY_SLOTS: readonly Slot[] = ["ring", "amulet"];
const ALL_SLOTS: readonly Slot[] = SLOTS;

/** 性質の持ち主（Modifier / Rule の owner）。id は ruleId(owner, 0) で、同じ性質は同じ id になる */
function itemOwner(key: string): EventSource {
  return { kind: "item", key };
}

/** 性質が足す常時の増・倍の中身（owner / id / label は addItemModifier が埋める） */
interface ItemModifierBody {
  kind: Modifier["kind"];
  tag: Modifier["tag"];
  amount: number;
  if?: readonly RuleCondition[];
  per?: ModifierPer;
}

/** 性質の常時の増・倍（core/rules.ts の Modifier）を足す。stats.modifiers は共有されうるので差し替える */
function addItemModifier(s: PlayerStats, key: string, label: string, body: ItemModifierBody): void {
  const owner = itemOwner(key);
  const mod: Modifier = { id: ruleId(owner, 0), kind: body.kind, tag: body.tag, amount: body.amount, if: body.if ?? [], owner, label };
  if (body.per !== undefined) mod.per = body.per;
  s.modifiers = [...s.modifiers, mod];
}

/** 条件付きの与ダメ全部の増（条件の族の多くがこの形。M(all, …)） */
function increasedAll(s: PlayerStats, key: string, label: string, amount: number, conditions: readonly RuleCondition[] = [], per?: ModifierPer): void {
  const body: ItemModifierBody = { kind: "increased", tag: "all", amount, if: conditions };
  if (per !== undefined) body.per = per;
  addItemModifier(s, key, label, body);
}

/** 性質の「〜時: 〜」（core/rules.ts の Rule）を足す。効果量が 0 以下なら積まない */
function addItemRule(s: PlayerStats, key: string, when: EventKind, then: RuleEffect, icd: number): void {
  if (then.magnitude <= 0) return;
  const owner = itemOwner(key);
  const rule: Rule = { id: ruleId(owner, 0), when, if: [], then, chance: 1, icd, scope: SCOPE_ANY, owner };
  s.rules = [...s.rules, rule];
}

/** 直前の出来事の後、窓の秒の間（先制・応手・双撃の後） */
function recentWithin(event: EventKind, within: number): readonly RuleCondition[] {
  return [{ kind: "recent", event, within }];
}

/** 先制・応手・双撃の後の窓（秒。表示にも出す） */
const MOMENT_WINDOW = TRIGGER.trait.momentWindowSec;

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
  def: "防御",
};

/**
 * ステータスの色（docs/COMBAT_DESIGN.md A-1）。resonance.ts の COLOR_ATTR の逆引きは 5 色 = 5 ステータスのまま
 * （防御は色を持つ 5 色の外）なので、防御の表示色はここだけ翠（jade、体力と共有）に決め打つ
 */
export const ATTR_COLOR: Readonly<Record<AttrKey, TraitColor>> = {
  str: "crimson",
  dex: "azure",
  vit: "jade",
  mnd: "gold",
  spi: "umbra",
  def: "jade",
};

/** ステータスの性質の key（attr_str など） */
export const ATTR_TRAIT_PREFIX = "attr_";

/** ステータスを付けられる部位（地金の行の定義に残す。抽選には出ない） */
const ATTR_SLOTS: Readonly<Record<AttrKey, readonly Slot[]>> = {
  str: ["mainHand", "armor", "ring", "amulet"],
  dex: ["mainHand", "head", "boots", "ring", "amulet"],
  vit: ["armor", "boots", "ring", "amulet"],
  mnd: ["mainHand", "ring", "amulet"],
  spi: ["mainHand", "armor", "ring", "amulet"],
  def: ["armor", "boots", "ring", "amulet"],
};

/** 期待値曲線（属性ごとに同じ形。docs/COMBAT_DESIGN.md A-3）。attr_str など key ごとに JSON から引く */
const ATTR_TRAIT_CURVES: Readonly<Record<AttrKey, readonly CurvePoint[]>> = {
  str: curveFor("attr_str"),
  dex: curveFor("attr_dex"),
  vit: curveFor("attr_vit"),
  mnd: curveFor("attr_mnd"),
  spi: curveFor("attr_spi"),
  def: curveFor("attr_def"),
};

/** ステータス 6 種の地金の行。flat 段階で attributes（生の値）に足す */
function attributeLines(): AffixDef[] {
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
// 防御・属性耐性（docs/COMBAT_DESIGN.md A-8）
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

/** 属性耐性 6 種の地金の行（無属性は防御が受け持つので除く） */
function resistLines(): AffixDef[] {
  return ELEMENTS.filter((e): e is Exclude<Element, "none"> => e !== "none").map((e) => ({
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
}

/**
 * 地金の行（ステータス 6・属性耐性 6・防御力）。性質の抽選には出ないが、地金（innate.ts）の AffixRoll が
 * この定義の apply と表示を使うので定義は残す（affixDef で引ける。traitsFor / conversionsFor / 色の表は見ない）
 */
export const INNATE_LINE_DEFS: readonly AffixDef[] = [
  ...attributeLines(),
  ...resistLines(),
  {
    key: "armorFlat",
    label: "防御力 +{v}",
    tags: ["defense"],
    slots: ["armor", "boots", "ring"],
    curve: curveFor("armorFlat"),
    apply: (s: PlayerStats, v: number) => {
      s.armor += v;
    },
  },
];

// ---------------------------------------------------------------------------
// 性質 71（条件の族 25 + 行動 43 + 来歴 3）。docs/ideas/relics-7d-plan.md 1 章の表の順
// ---------------------------------------------------------------------------

export const AFFIXES: readonly AffixDef[] = [
  // ---- 条件の族（Modifier / 条件付きの欄。代償を持たない）----
  trait({
    key: "damageVsStaggered",
    color: "crimson",
    label: "怯み中の敵へのダメージ +{v}%",
    tags: ["condition", "damage", "melee"],
    slots: ["mainHand", "ring"],
    curve: curveFor("damageVsStaggered"),
    keywords: kw([], ["stagger"]),
    apply: (s, v) => {
      s.increased.vsStaggered += pct(v);
    },
  }),
  trait({
    key: "guardedBane",
    color: "crimson",
    label: "堅守中の敵への与ダメージ +{v}%",
    tags: ["condition", "damage", "melee"],
    slots: ["mainHand"],
    curve: curveFor("guardedBane"),
    keywords: kw([], ["stagger"]),
    apply: (s, v) => {
      increasedAll(s, "guardedBane", "堅守崩し", pct(v), [{ kind: "targetHas", status: "guarded" }]);
    },
  }),
  trait({
    key: "readAhead",
    color: "gold",
    label: "予備動作中の敵への与ダメージ +{v}%",
    tags: ["condition", "damage", "combo"],
    slots: ["mainHand"],
    curve: curveFor("readAhead"),
    keywords: kw([], ["counter"]),
    apply: (s, v) => {
      increasedAll(s, "readAhead", "先読み", pct(v), [{ kind: "trigger", condition: "targetInWindup" }]);
    },
  }),
  trait({
    key: "kaleidoscope",
    color: "gold",
    label: "相手の状態異常 1 種につき与ダメージ +{v}%",
    tags: ["condition", "damage", "status"],
    slots: ATTACK_SLOTS,
    curve: curveFor("kaleidoscope"),
    keywords: kw([], ["reaction"]),
    apply: (s, v) => {
      increasedAll(s, "kaleidoscope", "多彩", pct(v), [], { count: { kind: "targetStatusKinds" } });
    },
  }),
  trait({
    key: "brandDetonator",
    color: "gold",
    label: "烙印の敵への与ダメージ +{v}%",
    tags: ["condition", "damage", "status"],
    slots: OFFENSE_SLOTS,
    curve: curveFor("brandDetonator"),
    // 烙印の語は起爆（system/keywords.ts の STATUS_KEYWORDS.brand。loot から system を読まないので語を直に書く）
    keywords: kw([], ["explode"]),
    apply: (s, v) => {
      increasedAll(s, "brandDetonator", "起爆の手", pct(v), [{ kind: "targetHas", status: "brand" }]);
    },
  }),
  trait({
    key: "conductor",
    color: "gold",
    label: "濡れ・浸水・油膜の敵への与ダメージ +{v}%（雷・炎の割合でさらに上がる）",
    tags: ["condition", "damage", "elemental"],
    slots: OFFENSE_SLOTS,
    curve: curveFor("conductor"),
    keywords: kw([], ["reaction"], ["shock", "burn"]),
    // 属性の割合で伸びるので Modifier にしない（system/traitHooks.ts の soakedBonus）
    apply: (s, v) => {
      s.traits.wetConductMul += pct(v);
      s.traits.oiledIgniteMul += pct(v);
    },
  }),
  trait({
    key: "terrainHunter",
    color: "crimson",
    label: "地形の上にいる敵への与ダメージ +{v}%",
    tags: ["condition", "damage"],
    slots: ATTACK_SLOTS,
    curve: curveFor("terrainHunter"),
    keywords: emptyProfile(),
    apply: (s, v) => {
      increasedAll(s, "terrainHunter", "足場狩り", pct(v), [{ kind: "targetOnTerrain", terrain: "any" }]);
    },
  }),
  trait({
    key: "prismEdge",
    color: "crimson",
    label: "属性の弱点を突いた命中の与ダメージ +{v}%",
    tags: ["condition", "damage", "elemental"],
    slots: ["mainHand", "amulet"],
    curve: curveFor("prismEdge"),
    keywords: emptyProfile(),
    apply: (s, v) => {
      s.traits.weakDamageMul += pct(v);
    },
  }),
  trait({
    key: "downHunter",
    color: "gold",
    label: "精鋭・ボスへの与ダメージ +{v}%",
    tags: ["condition", "damage"],
    slots: ["mainHand", "amulet"],
    curve: curveFor("downHunter"),
    keywords: kw([], ["elite"]),
    apply: (s, v) => {
      s.increased.vsElite += pct(v);
      s.increased.vsBoss += pct(v);
    },
  }),
  trait({
    key: "fullTide",
    color: "azure",
    label: "気力が満ちている間、スキル威力 +{v}%",
    tags: ["condition", "mana", "skill"],
    slots: ["armor", "amulet"],
    curve: curveFor("fullTide"),
    keywords: kw([], ["mana"]),
    apply: (s, v) => {
      addItemModifier(s, "fullTide", "満ち潮", { kind: "increased", tag: "skill", amount: pct(v), if: [{ kind: "manaFull" }] });
    },
  }),
  trait({
    key: "desperation",
    color: "umbra",
    label: "瀕死の間、与ダメージ +{v}%",
    tags: ["condition", "damage", "life"],
    slots: ["armor", "ring", "amulet"],
    curve: curveFor("desperation"),
    keywords: kw([], ["lowHp"]),
    apply: (s, v) => {
      increasedAll(s, "desperation", "死に物狂い", pct(v), [{ kind: "lowHp" }]);
    },
  }),
  trait({
    key: "moraleSurge",
    color: "crimson",
    label: `戦意 ${TRIGGER.trait.moraleEvery} につき与ダメージ +{v}%`,
    tags: ["condition", "damage"],
    slots: ["mainHand", "amulet"],
    curve: curveFor("moraleSurge"),
    keywords: emptyProfile(),
    apply: (s, v) => {
      increasedAll(s, "moraleSurge", "奮い立ち", pct(v), [], { count: { kind: "morale" }, every: TRIGGER.trait.moraleEvery });
    },
  }),
  trait({
    key: "fever",
    color: "umbra",
    label: "自分の状態異常 1 種につき与ダメージ +{v}%",
    tags: ["condition", "damage", "status"],
    slots: ["armor", "amulet"],
    curve: curveFor("fever"),
    keywords: kw([], ["hurt"]),
    apply: (s, v) => {
      increasedAll(s, "fever", "病み上がり", pct(v), [], { count: { kind: "selfStatusKinds" } });
    },
  }),
  trait({
    key: "lockdownFury",
    color: "crimson",
    label: "交戦中の部屋で与ダメージ +{v}%",
    tags: ["condition", "damage"],
    slots: ["mainHand", "armor", "ring"],
    curve: curveFor("lockdownFury"),
    keywords: kw([], ["clear"]),
    apply: (s, v) => {
      increasedAll(s, "lockdownFury", "封鎖の熱", pct(v), [{ kind: "roomLocked" }]);
    },
  }),
  trait({
    key: "groundRooted",
    color: "jade",
    label: "地形の上に立つ間、与ダメージ +{v}%",
    tags: ["condition", "damage"],
    slots: ["armor", "boots", "ring"],
    curve: curveFor("groundRooted"),
    keywords: emptyProfile(),
    apply: (s, v) => {
      increasedAll(s, "groundRooted", "地の利", pct(v), [{ kind: "selfOnTerrain", terrain: "any" }]);
    },
  }),
  trait({
    key: "finisherEdge",
    color: "crimson",
    label: "終撃の与ダメージ +{v}%",
    tags: ["condition", "damage", "melee"],
    slots: ["mainHand", "ring"],
    curve: curveFor("finisherEdge"),
    keywords: kw([], ["finisher"]),
    apply: (s, v) => {
      increasedAll(s, "finisherEdge", "終の太刀", pct(v), [{ kind: "finisher" }]);
    },
  }),
  trait({
    key: "releaseEdge",
    color: "gold",
    label: "放出の一撃の与ダメージ +{v}%",
    tags: ["condition", "damage"],
    slots: ["mainHand", "amulet"],
    curve: curveFor("releaseEdge"),
    keywords: emptyProfile(),
    apply: (s, v) => {
      s.increased.release += pct(v);
    },
  }),
  trait({
    key: "riposteEdge",
    color: "gold",
    label: `応手の後 ${MOMENT_WINDOW} 秒間、与ダメージ +{v}%`,
    tags: ["condition", "damage", "combo"],
    slots: ["mainHand", "head", "ring"],
    curve: curveFor("riposteEdge"),
    keywords: kw([], ["counter", "just"]),
    apply: (s, v) => {
      increasedAll(s, "riposteEdge", "返しの勢い", pct(v), recentWithin("onRiposte", MOMENT_WINDOW));
    },
  }),
  trait({
    key: "twinEdge",
    color: "azure",
    label: `双撃の後 ${MOMENT_WINDOW} 秒間、与ダメージ +{v}%`,
    tags: ["condition", "damage", "combo"],
    slots: ["mainHand", "ring"],
    curve: curveFor("twinEdge"),
    keywords: kw([], ["combo"]),
    apply: (s, v) => {
      increasedAll(s, "twinEdge", "双の勢い", pct(v), recentWithin("onTwinStrike", MOMENT_WINDOW));
    },
  }),
  trait({
    key: "firstStrikeEdge",
    color: "azure",
    label: `先制の後 ${MOMENT_WINDOW} 秒間、与ダメージ +{v}%`,
    tags: ["condition", "damage"],
    slots: ["head", "boots", "amulet"],
    curve: curveFor("firstStrikeEdge"),
    keywords: emptyProfile(),
    apply: (s, v) => {
      increasedAll(s, "firstStrikeEdge", "先手の勢い", pct(v), recentWithin("onFirstStrike", MOMENT_WINDOW));
    },
  }),
  trait({
    key: "branchArt",
    color: "gold",
    label: "コンボ派生の命中の与ダメージ +{v}%、命中で気力 +{v2}",
    tags: ["condition", "combo", "melee"],
    slots: ["mainHand", "amulet"],
    curve: curveFor("branchArt"),
    decimals2: 1,
    keywords: kw(["mana"], ["combo"]),
    apply: (s, v, v2) => {
      increasedAll(s, "branchArt", "派生の冴え", pct(v), [{ kind: "branchSwing" }]);
      s.traits.branchHitMana += v2;
    },
  }),
  trait({
    key: "chargeCore",
    color: "crimson",
    label: "溜めの段 1 つにつき近接ダメージ +{v}%",
    tags: ["condition", "melee", "damage"],
    slots: ["mainHand", "ring"],
    curve: curveFor("chargeCore"),
    keywords: kw([], ["melee"], ["melee"]),
    apply: (s, v) => {
      s.traits.chargedMeleeMul += pct(v);
    },
  }),
  trait({
    key: "comboDamage",
    color: "gold",
    label: `コンボ ${TRIGGER.trait.comboEvery} につき与ダメージ +{v}%（上限 {v2}%）`,
    tags: ["condition", "combo", "damage"],
    slots: OFFENSE_SLOTS,
    curve: curveFor("comboDamage"),
    keywords: kw([], ["combo"]),
    // 基礎の欄 comboDamagePerStack（コンボの倍）は触らない。コンボ 10 ごとの増として別に積む
    apply: (s, v, v2) => {
      increasedAll(s, "comboDamage", "連撃の熱", pct(v), [], { count: { kind: "combo" }, every: TRIGGER.trait.comboEvery, cap: pct(v2) });
    },
  }),
  trait({
    key: "justDodgeDamage",
    color: "gold",
    label: "見切りの後 {v2} 秒間、与ダメージ +{v}%",
    tags: ["condition", "combo", "damage"],
    slots: ["boots", "ring", "amulet"],
    curve: curveFor("justDodgeDamage"),
    decimals2: 1,
    keywords: kw([], ["just"]),
    // 基礎の欄 justDodgeDamageMul（見切りの倍）は触らない
    apply: (s, v, v2) => {
      increasedAll(s, "justDodgeDamage", "見切りの勢い", pct(v), recentWithin("onJustDodge", v2));
    },
  }),
  trait({
    key: "purse",
    color: "crimson",
    label: `懐: 持ち金が ${ECONOMY.build.pocketCoins} 以上の間、与ダメージ +{v}%`,
    tags: ["condition", "damage"],
    slots: OFFENSE_SLOTS,
    curve: curveFor("purse"),
    keywords: emptyProfile(),
    apply: (s, v) => {
      increasedAll(s, "purse", "懐", pct(v), [{ kind: "coinsAtLeast", amount: ECONOMY.build.pocketCoins }]);
    },
  }),

  // ---- 行動（状態異常・トリガー・源・ルールの欄。代償は基礎の欄を下げる向きだけ）----
  trait({
    key: "burn",
    color: "crimson",
    label: "{v}%の確率で炎上（{v2}ダメージ/秒）",
    tags: ["elemental", "damage"],
    slots: ATTACK_SLOTS,
    curve: curveFor("burn"),
    keywords: kw(["burn"]),
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
    keywords: kw(["chill"]),
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
    keywords: kw(["shock"]),
    apply: (s, v, v2) => {
      s.shockChance += pct(v);
      s.shockDamage += v2;
    },
  }),
  trait({
    key: "explodeOnKill",
    color: "crimson",
    label: "撃破時{v}%の確率で爆発（{v2}ダメージ）",
    tags: ["elemental", "damage"],
    slots: ["mainHand", "amulet"],
    curve: curveFor("explodeOnKill"),
    keywords: kw(["explode"], ["kill"]),
    apply: (s, v, v2) => {
      s.explodeOnKillChance += pct(v);
      s.explodeDamage += v2;
    },
  }),
  trait({
    key: "procBleed",
    color: "crimson",
    label: `近接命中時 {v}% で出血させる（${BLEED_STEP} 動くごとに {v2} ダメージ）`,
    tags: ["status", "melee", "damage"],
    slots: MELEE_SLOTS,
    curve: curveFor("procBleed"),
    decimals2: 1,
    keywords: kw(["bleed"], ["melee"]),
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
    keywords: kw(["poison"]),
    apply: (s, v) => {
      pushProc(s, statusProc("poison", v, STATUS.poison.duration, STATUS.poison.hpRatioPerSec, "any"));
    },
  }),
  trait({
    key: "procFear",
    color: "gold",
    label: "会心時 {v}% で恐怖させる（敵が逃げて攻撃しなくなる）",
    tags: ["status", "critical"],
    slots: OFFENSE_SLOTS,
    curve: curveFor("procFear"),
    keywords: kw(["fear"], ["crit"]),
    apply: (s, v) => {
      pushProc(s, { ...statusProc("fear", v, STATUS.fear.duration, NO_POTENCY, "any"), requiresCrit: true });
    },
  }),
  trait({
    key: "manaOnStagger",
    color: "azure",
    label: "汲み上げ: 敵を怯ませると気力 +{v}、撃破時の気力回収 -{v2}",
    tags: ["mana", "skill", "tradeoff"],
    slots: ["mainHand", "ring"],
    curve: curveFor("manaOnStagger"),
    keywords: kw(["mana"], ["stagger"]),
    apply: (s, v, v2) => {
      s.traits.manaOnStagger += v;
      s.manaOnKill -= v2;
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
    keywords: kw(["ward"], ["mana"]),
    apply: (s, v, v2) => {
      s.traits.manaShieldCost = Math.max(s.traits.manaShieldCost, v);
      s.manaRegen *= 1 - pct(v2);
    },
  }),
  trait({
    key: "manaOverflow",
    color: "azure",
    label: "溢れ: 気力が満タンのとき、あふれた気力回収の {v}% を奥義ゲージに回す、最大気力 -{v2}",
    tags: ["mana", "burst", "tradeoff"],
    slots: JEWELRY_SLOTS,
    curve: curveFor("manaOverflow"),
    keywords: kw(["energy"], ["mana"]),
    apply: (s, v, v2) => {
      s.traits.manaOverflowToEnergy += pct(v);
      s.maxMana -= v2;
    },
  }),
  trait({
    key: "justBreath",
    color: "azure",
    label: "見切りの息吹: 見切りで気力 +{v}、ダッシュ再使用時間 +{v2}%",
    tags: ["mana", "mobility", "tradeoff"],
    slots: ["boots", "ring"],
    curve: curveFor("justBreath"),
    keywords: kw(["mana"], ["just"]),
    apply: (s, v, v2) => {
      pushFixedTrigger(s, { trigger: "onJustDodge", condition: "always", effect: "restoreMana", magnitude: v });
      s.dashCooldownMul += pct(v2);
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
    keywords: kw(["mana"], ["melee", "ranged"]),
    apply: (s, v) => {
      s.traits.switchMana += v;
    },
  }),
  trait({
    key: "plagueSeed",
    color: "umbra",
    label: "疫病の種: 撃破時、周囲の敵を毒にする（{v} 秒）",
    tags: ["status", "damage"],
    slots: ATTACK_SLOTS,
    curve: curveFor("plagueSeed"),
    keywords: kw(["poison"], ["kill"]),
    apply: (s, v) => {
      pushFixedTrigger(s, { trigger: "onKill", condition: "always", effect: "inflict", magnitude: v, status: "poison" });
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
    keywords: kw(["explode"], ["reaction"]),
    apply: (s, v, v2) => {
      pushFixedTrigger(s, { trigger: "onMeleeHit", condition: "targetMultiStatus", effect: "explode", magnitude: v });
      s.increased.melee -= pct(v2);
    },
  }),
  trait({
    key: "inheritance",
    color: "umbra",
    label: "形見: 状態異常の敵を倒すと、その状態異常を次の {v} 回の命中で付ける、状態異常の効果量 -{v2}%",
    tags: ["status", "tradeoff"],
    slots: ["mainHand"],
    curve: curveFor("inheritance"),
    keywords: kw([], ["kill"], ["reaction"]),
    apply: (s, v, v2) => {
      s.traits.inheritCharges = Math.max(s.traits.inheritCharges, v);
      s.statusPotencyMul -= pct(v2);
    },
  }),
  trait({
    key: "wedge",
    color: "crimson",
    label: "楔: 怯みの蓄積が半分を超えた敵への怯み値 +{v}%",
    tags: ["melee"],
    slots: ["mainHand"],
    curve: curveFor("wedge"),
    keywords: kw([], ["stagger"], ["stagger"]),
    apply: (s, v) => {
      s.traits.wedgePoiseMul += pct(v);
    },
  }),
  trait({
    key: "guardPiercer",
    color: "azure",
    label: "剥がし: 堅守中の敵への怯み値の減衰を {v}% 打ち消す",
    tags: ["melee", "ranged"],
    slots: ["mainHand"],
    curve: curveFor("guardPiercer"),
    cap: 100,
    keywords: kw([], ["stagger"]),
    apply: (s, v) => {
      s.traits.guardPierce += pct(v);
    },
  }),
  trait({
    key: "staggerQuake",
    color: "crimson",
    label: "崩れの反響: 敵を怯ませると周囲の敵に怯み値 {v}、ノックバック -{v2}%",
    tags: ["melee", "tradeoff"],
    slots: ["mainHand", "armor"],
    curve: curveFor("staggerQuake"),
    keywords: kw(["stagger", "area"], ["stagger"]),
    apply: (s, v, v2) => {
      s.traits.staggerQuake += v;
      s.knockbackMul -= pct(v2);
    },
  }),
  trait({
    key: "staggerSpark",
    color: "gold",
    label: "崩れ雷: 敵を怯ませると連鎖雷を呼ぶ（{v} ダメージ）",
    tags: ["elemental", "damage"],
    slots: ["mainHand"],
    curve: curveFor("staggerSpark"),
    keywords: kw(["shock"], ["stagger"]),
    apply: (s, v) => {
      pushFixedTrigger(s, { trigger: "onStagger", condition: "always", effect: "chainLightning", magnitude: v });
    },
  }),
  trait({
    key: "staggerMark",
    color: "umbra",
    label: "崩れの刻印: 怯ませた敵を脆弱にする（{v} 秒）",
    tags: ["status", "damage"],
    slots: ["mainHand", "ring"],
    curve: curveFor("staggerMark"),
    keywords: kw(["vulnerable"], ["stagger"]),
    apply: (s, v) => {
      pushFixedTrigger(s, { trigger: "onStagger", condition: "always", effect: "inflict", magnitude: v, status: "vulnerable" });
    },
  }),
  trait({
    key: "firstMove",
    color: "gold",
    label: "先の先: カウンターで相手に怯み値 {v} を追加で与える",
    tags: ["melee", "combo"],
    slots: ["mainHand", "head", "amulet"],
    curve: curveFor("firstMove"),
    keywords: kw(["stagger"], ["counter"]),
    apply: (s, v) => {
      pushFixedTrigger(s, { trigger: "onCounter", condition: "always", effect: "addPoise", magnitude: v });
    },
  }),
  trait({
    key: "counterWave",
    family: "melee",
    color: "crimson",
    label: "返し波: カウンター時、衝撃波を放つ（{v} ダメージ）",
    tags: ["melee", "damage"],
    slots: ["mainHand"],
    curve: curveFor("counterWave"),
    keywords: kw(["area"], ["counter"]),
    apply: (s, v) => {
      pushFixedTrigger(s, { trigger: "onCounter", condition: "always", effect: "shockwave", magnitude: v });
    },
  }),
  trait({
    key: "curtainCall",
    color: "gold",
    label: "幕引き: 殲滅の瞬間に敵弾をすべて消し、奥義ゲージ +{v}",
    tags: ["burst"],
    slots: ALL_SLOTS,
    curve: curveFor("curtainCall"),
    keywords: kw(["energy"], ["clear"]),
    apply: (s, v) => {
      s.traits.lastKillClearsBullets += 1;
      s.traits.lastKillEnergy += v;
    },
  }),
  trait({
    key: "energyReserve",
    color: "gold",
    label: "奥義ゲージ満タン時に被弾: {v}秒間無敵",
    tags: ["burst", "defense"],
    slots: ["armor", "ring", "amulet"],
    curve: curveFor("energyReserve"),
    decimals: 1,
    cap: TRIGGER.invulnMax,
    keywords: kw(["ward"], ["energy", "hurt"]),
    apply: (s, v) => {
      s.triggers.push({ trigger: "onHurt", condition: "fullEnergy", effect: "invuln", magnitude: v, chance: 1 });
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
    keywords: kw(["reaction"]),
    apply: (s, v) => {
      s.traits.resistedInflict = Math.max(s.traits.resistedInflict, v);
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
    keywords: kw(["reaction"], ["stagger"]),
    apply: (s, v) => {
      s.traits.elementBreak = Math.max(s.traits.elementBreak, v);
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
    keywords: kw(["explode"], ["ranged"]),
    apply: (s, v, v2) => {
      s.traits.rapidBrandChance = Math.min(1, s.traits.rapidBrandChance + pct(v));
      s.increased.ranged -= pct(v2);
    },
  }),
  trait({
    key: "terrainBurst",
    color: "crimson",
    label: "地脈の炸裂: 地形の上にいる敵を倒すと、衝撃波を放つ（{v} ダメージ。炎・油・溶岩は燃焼、水・氷は冷気、毒沼・草は毒）",
    tags: ["damage", "elemental"],
    slots: ["mainHand", "amulet"],
    curve: curveFor("terrainBurst"),
    keywords: kw(["area"], ["kill"]),
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
    keywords: kw(["burn"], ["burn", "kill"]),
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
    keywords: kw(["chill"], ["dash"]),
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
    keywords: kw(["heal"]),
    apply: (s, v, v2) => {
      s.traits.terrainRegen += v;
      s.maxHp -= v2;
    },
  }),
  trait({
    key: "echoSlash",
    color: "gold",
    label: "余韻斬り: コンボが途切れた瞬間、コンボ数 × {v} の衝撃波を放つ、コンボ猶予 -{v2}秒",
    tags: ["combo", "damage", "tradeoff"],
    slots: ["mainHand", "amulet"],
    curve: curveFor("echoSlash"),
    decimals: 1,
    decimals2: 1,
    keywords: kw(["area"], ["combo"]),
    apply: (s, v, v2) => {
      s.traits.comboBreakWave += v;
      s.comboWindowBonus -= v2;
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
    keywords: kw(["explode"], ["bullet", "melee"]),
    apply: (s, v, v2) => {
      s.traits.stakeDamage += v;
      s.increased.ranged -= pct(v2);
    },
  }),
  trait({
    key: "placedInfuse",
    color: "jade",
    label: "置き土産: 自分の設置物（引力球・氷結地帯）の範囲内では、近接命中でその状態異常を {v} 秒付ける、最大生命 -{v2}",
    tags: ["status", "melee", "tradeoff"],
    slots: ["mainHand", "ring"],
    curve: curveFor("placedInfuse"),
    decimals: 1,
    keywords: kw([], ["placed", "melee"]),
    apply: (s, v, v2) => {
      s.traits.placedInfuse = Math.max(s.traits.placedInfuse, v);
      s.maxHp -= v2;
    },
  }),
  trait({
    key: "bloodSignature",
    color: "umbra",
    label: "血の署名: 生命が半分を切っている間、スキルの再使用時間と最低間隔の進みが {v}% 速くなる、最大生命 -{v2}",
    tags: ["skill", "tradeoff"],
    slots: ["armor", "amulet"],
    curve: curveFor("bloodSignature"),
    keywords: kw([], ["lowHp"], ["mana"]),
    apply: (s, v, v2) => {
      s.traits.lowHpSkillHaste += pct(v);
      s.maxHp -= v2;
    },
  }),
  trait({
    key: "siegeGuard",
    color: "jade",
    label: "籠城: 交戦中の部屋で被ダメージ -{v}%",
    tags: ["defense"],
    slots: ["armor", "amulet"],
    curve: curveFor("siegeGuard"),
    keywords: kw(["ward"], ["clear"]),
    apply: (s, v) => {
      s.traits.engagedGuard += pct(v);
    },
  }),
  trait({
    key: "stanceGuard",
    color: "jade",
    label: "構え: 近接を振っている間、被ダメージ -{v}%",
    tags: ["defense", "melee"],
    slots: ["armor", "head"],
    curve: curveFor("stanceGuard"),
    keywords: kw(["ward"], ["melee"]),
    apply: (s, v) => {
      s.traits.stanceGuard += pct(v);
    },
  }),
  trait({
    key: "bulletCut",
    family: "melee",
    color: "azure",
    label: "近接攻撃で敵弾を消せる（リーチ -{v}%）",
    tags: ["melee", "defense"],
    slots: ["mainHand"],
    curve: curveFor("bulletCut"),
    keywords: kw([], ["bullet"]),
    apply: (s, v) => {
      s.bulletCut += BULLET_CUT_ON;
      s.meleeReachMul -= pct(v);
    },
  }),
  trait({
    key: "unmoving",
    color: "jade",
    label: "踏ん張り: 被弾で押し戻されない。立ち止まっている間、被ダメージ -{v}%",
    tags: ["defense"],
    slots: ["armor", "boots"],
    curve: curveFor("unmoving"),
    keywords: kw(["ward"], ["still"]),
    // 0 より大きいと押し戻し無効（system/combat.ts・player.ts）。静止中の減りは system/traitHooks.ts
    apply: (s, v) => {
      s.traits.unmoving = Math.max(s.traits.unmoving, pct(v));
    },
  }),
  trait({
    key: "chainSource",
    color: "gold",
    label: "連鎖係数 +{v}%",
    tags: ["utility"],
    slots: JEWELRY_SLOTS,
    curve: curveFor("chainSource"),
    keywords: kw([], [], ["reaction"]),
    apply: (s, v) => {
      s.chainCoefBonus += pct(v);
    },
  }),
  trait({
    key: "chainReturn",
    color: "gold",
    label: "連鎖が同じ敵へ戻れる回数 +{v}",
    tags: ["utility"],
    slots: ["amulet"],
    curve: curveFor("chainReturn"),
    keywords: kw([], [], ["reaction"]),
    apply: (s, v) => {
      s.chainRevisits += Math.round(v);
    },
  }),
  trait({
    key: "moraleCap",
    color: "crimson",
    label: "戦意の上限 +{v}",
    tags: ["utility"],
    slots: ["mainHand", "amulet"],
    curve: curveFor("moraleCap"),
    keywords: emptyProfile(),
    apply: (s, v) => {
      s.moraleMaxAdd += v;
    },
  }),
  trait({
    key: "burnStack",
    color: "crimson",
    label: "燃焼の重ねの上限 +{v}",
    tags: ["elemental", "status"],
    slots: ATTACK_SLOTS,
    curve: curveFor("burnStack"),
    keywords: kw([], [], ["burn"]),
    apply: (s, v) => {
      s.statusStackCapBonus = { ...s.statusStackCapBonus, burn: (s.statusStackCapBonus.burn ?? 0) + Math.round(v) };
    },
  }),

  // ---- 来歴（装備全体・この遺物の来歴を読む。loot/traitContext.ts）----
  trait({
    key: "sapling",
    color: "jade",
    label: "若木: 装備全体の残り余白 1 につき近接・射撃ダメージ +{v}%（芽を選ぶほど弱まる）",
    tags: ["damage", "utility"],
    slots: ["mainHand", "armor", "boots", "ring", "amulet"],
    curve: curveFor("sapling"),
    keywords: emptyProfile(),
    apply: (s, v) => {
      const bonus = pct(v) * s.traits.gearMargin;
      s.increased.melee += bonus;
      s.increased.ranged += bonus;
    },
  }),
  trait({
    key: "veteran",
    color: "crimson",
    label: "歴戦: この遺物での撃破 100 回ごとに近接・射撃ダメージ +{v}%（8 段まで）",
    tags: ["damage"],
    slots: ["mainHand"],
    curve: curveFor("veteran"),
    keywords: emptyProfile(),
    apply: (s, v) => {
      s.increased.melee += pct(v);
      s.increased.ranged += pct(v);
    },
  }),
  trait({
    key: "oldScars",
    color: "jade",
    label: "古傷: この遺物で被弾 100 回ごとに防御力 +{v}（5 段まで）",
    tags: ["defense"],
    slots: ["armor"],
    curve: curveFor("oldScars"),
    keywords: emptyProfile(),
    apply: (s, v) => {
      s.armor += v;
    },
  }),
];

/** 来歴の性質（装備全体・この遺物の来歴で値が育つ。「無条件に数値を上げない」の決まりの外） */
export const PROVENANCE_TRAIT_KEYS: ReadonlySet<string> = new Set(["sapling", "veteran", "oldScars"]);

// ---------------------------------------------------------------------------
// 転じ 12 と属性の変換 6: 「A を B に変換する」でビルドの向きを変える（BiS を潰す主力）。
// 通常の抽選プール（traitsFor）には入らず、性質の枠ごとに CONVERSION_TRAIT_CHANCE（generator.ts）、
// 名のある遺物の固定セットからも付く。stage は "convert"（scale の後）。
// value は変換割合（%）など。変換は反転しない（負の値の変換は何もしない）。
// ---------------------------------------------------------------------------

export const CONVERSION_KEY_PREFIX = "cv_";

const BASE_PROJECTILES = 1;
const REMAINING_DASH_CHARGES = 1;
/** 会心率（0..1）を % の数に直す（「会心率 1% につき」） */
const CRIT_PERCENT = 100;
/** 転じの Rule の効果（連鎖雷の色などは効果の既定） */
const CRIT_RULE_ICD = TRIGGER.trait.critRuleIcd;

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** 変換割合（0..1）。負の値は 0 */
const fraction = (v: number): number => Math.max(0, pct(v));

/** 期待値曲線（元は「変換割合の共通の期待値曲線」。深いほど多く移す）。cv_infuseFire など key ごとに JSON から引く */
const INFUSE_TRAIT_CURVES: Readonly<Record<Exclude<Element, "none">, readonly CurvePoint[]>> = {
  fire: curveFor("cv_infuseFire"),
  ice: curveFor("cv_infuseIce"),
  lightning: curveFor("cv_infuseLightning"),
  poison: curveFor("cv_infusePoison"),
  dark: curveFor("cv_infuseDark"),
  light: curveFor("cv_infuseLight"),
};

/** 属性 → 語（system/keywords.ts の ELEMENT_KEYWORD と同じ対応。loot から system を読まないので持つ） */
const ELEMENT_KEYWORD_OF = {
  fire: "elFire",
  ice: "elIce",
  lightning: "elLightning",
  poison: "elPoison",
  dark: "elDark",
  light: "elLight",
} as const satisfies Record<Exclude<Element, "none">, string>;

export const CONVERSION_AFFIXES: readonly AffixDef[] = [
  trait({
    key: "cv_critToChain",
    color: "gold",
    label: "会心率 1% につき連鎖係数 +{v}%",
    tags: ["conversion", "critical"],
    slots: ["mainHand", "ring"],
    curve: curveFor("cv_critToChain"),
    decimals: 1,
    stage: "convert",
    keywords: kw([], ["crit"], ["reaction"]),
    apply: (s, v) => {
      s.chainCoefBonus += Math.max(0, s.critChance) * CRIT_PERCENT * fraction(v);
    },
  }),
  trait({
    key: "cv_speedToDamage",
    color: "azure",
    label: `移動速度の上昇 1% につき与ダメージ +{v}%（最大 +${ratioPct(TRIGGER.trait.speedToDamageCap)}%）`,
    tags: ["conversion", "mobility"],
    slots: ["boots", "amulet"],
    curve: curveFor("cv_speedToDamage"),
    decimals: 1,
    stage: "convert",
    keywords: kw([], ["dash"]),
    apply: (s, v) => {
      increasedAll(s, "cv_speedToDamage", "速さの転じ", fraction(v), [], {
        count: { kind: "stat", stat: "moveSpeedMul" },
        cap: TRIGGER.trait.speedToDamageCap,
      });
    },
  }),
  trait({
    key: "cv_manaToProjectiles",
    family: "gun",
    color: "azure",
    label: `最大気力の {v}% を弾数に変換（${TRIGGER.trait.manaPerProjectile} につき +1）、気力自然回復 -${ratioPct(1 - TRIGGER.trait.manaToProjectileRegenMul)}%`,
    tags: ["conversion", "mana", "ranged"],
    slots: ["mainHand", "amulet"],
    curve: curveFor("cv_manaToProjectiles"),
    stage: "convert",
    keywords: kw([], ["mana"], ["bullet"]),
    apply: (s, v) => {
      const moved = Math.max(0, s.maxMana) * fraction(v);
      s.projectileCount += Math.floor(moved / TRIGGER.trait.manaPerProjectile);
      s.manaRegen *= TRIGGER.trait.manaToProjectileRegenMul;
    },
  }),
  trait({
    key: "cv_armorToPoise",
    color: "jade",
    label: `防御力 ${TRIGGER.trait.armorPerPoiseStep} につき怯み値 +{v}%`,
    tags: ["conversion", "defense"],
    slots: ["armor", "boots"],
    curve: curveFor("cv_armorToPoise"),
    decimals: 1,
    stage: "convert",
    keywords: kw([], [], ["stagger"]),
    apply: (s, v) => {
      addItemModifier(s, "cv_armorToPoise", "鎧の転じ", {
        kind: "increased",
        tag: "poise",
        amount: fraction(v),
        per: { count: { kind: "stat", stat: "armor" }, every: TRIGGER.trait.armorPerPoiseStep },
      });
    },
  }),
  trait({
    key: "cv_lifeToArea",
    color: "jade",
    label: `最大生命 ${TRIGGER.trait.lifePerAreaStep} につき範囲攻撃の与ダメージ +{v}%`,
    tags: ["conversion", "life"],
    slots: ["armor", "amulet"],
    curve: curveFor("cv_lifeToArea"),
    decimals: 1,
    stage: "convert",
    keywords: kw([], [], ["area"]),
    apply: (s, v) => {
      addItemModifier(s, "cv_lifeToArea", "命の転じ", {
        kind: "increased",
        tag: "area",
        amount: fraction(v),
        per: { count: { kind: "stat", stat: "maxHp" }, every: TRIGGER.trait.lifePerAreaStep },
      });
    },
  }),
  trait({
    key: "cv_comboToFinisher",
    color: "gold",
    label: "コンボ猶予 0.1 秒につき終撃の与ダメージ +{v}%",
    tags: ["conversion", "combo"],
    slots: ["boots", "ring"],
    curve: curveFor("cv_comboToFinisher"),
    decimals: 1,
    stage: "convert",
    keywords: kw([], ["combo"], ["finisher"]),
    apply: (s, v) => {
      increasedAll(s, "cv_comboToFinisher", "間の転じ", fraction(v), [{ kind: "finisher" }], { count: { kind: "stat", stat: "comboWindow" } });
    },
  }),
  trait({
    key: "cv_coinsToMore",
    color: "gold",
    label: `持ち金 ${TRIGGER.trait.coinsPerMoreStep} につき与ダメージの倍 +{v}%（最大 +${ratioPct(TRIGGER.trait.coinsMoreCap)}%）`,
    tags: ["conversion", "damage"],
    slots: JEWELRY_SLOTS,
    curve: curveFor("cv_coinsToMore"),
    decimals: 1,
    stage: "convert",
    keywords: emptyProfile(),
    apply: (s, v) => {
      addItemModifier(s, "cv_coinsToMore", "銭の転じ", {
        kind: "more",
        tag: "all",
        amount: fraction(v),
        per: { count: { kind: "coins" }, every: TRIGGER.trait.coinsPerMoreStep, cap: TRIGGER.trait.coinsMoreCap },
      });
    },
  }),
  trait({
    key: "cv_critToLightning",
    color: "gold",
    label: "会心時: 連鎖雷（{v} ダメージ）",
    tags: ["conversion", "critical", "elemental"],
    slots: ["mainHand", "ring"],
    curve: curveFor("cv_critToLightning"),
    stage: "convert",
    keywords: kw(["shock"], ["crit"]),
    apply: (s, v) => {
      addItemRule(s, "cv_critToLightning", "onCrit", { kind: "chainLightning", magnitude: v }, CRIT_RULE_ICD);
    },
  }),
  trait({
    key: "cv_critToCoins",
    color: "gold",
    label: "会心時: 銭 +{v}",
    tags: ["conversion", "critical"],
    slots: JEWELRY_SLOTS,
    curve: curveFor("cv_critToCoins"),
    stage: "convert",
    keywords: kw([], ["crit"]),
    apply: (s, v) => {
      addItemRule(s, "cv_critToCoins", "onCrit", { kind: "gainCoins", magnitude: v }, CRIT_RULE_ICD);
    },
  }),
  trait({
    key: "cv_critToMorale",
    color: "crimson",
    label: "会心時: 戦意 +{v}",
    tags: ["conversion", "critical"],
    slots: ["mainHand", "ring"],
    curve: curveFor("cv_critToMorale"),
    stage: "convert",
    keywords: kw([], ["crit"]),
    apply: (s, v) => {
      addItemRule(s, "cv_critToMorale", "onCrit", { kind: "gainMorale", magnitude: v }, CRIT_RULE_ICD);
    },
  }),
  trait({
    key: "cv_chargesToDistance",
    label: "ダッシュ回数を距離に変換: 回数は 1 になり、元の回数 1 につきダッシュ距離 +{v}%",
    tags: ["conversion", "mobility"],
    slots: ["boots"],
    curve: curveFor("cv_chargesToDistance"),
    stage: "convert",
    keywords: kw([], [], ["dash"]),
    apply: (s, v) => {
      s.dashDistanceMul += fraction(v) * s.dashCharges;
      s.dashCharges = REMAINING_DASH_CHARGES;
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
    keywords: kw([], ["bullet"], ["stagger"]),
    apply: (s, v) => {
      const removed = Math.max(0, Math.round(s.projectileCount) - BASE_PROJECTILES);
      s.projectileCount = BASE_PROJECTILES;
      s.traits.rangedPoiseMul += fraction(v) * removed;
    },
  }),
  // ---- 属性の変換 6（docs/COMBAT_DESIGN.md A-8）。通常攻撃の属性を変える手段を武器のベースだけにしないため残す ----
  ...infuseConversions(),
];

/**
 * 属性の変換 6 種（docs/COMBAT_DESIGN.md A-8）。近接・射撃（通常攻撃）の威力のうち v% をその属性として扱う
 * （割合の分だけ敵の耐性・弱点で倍率が変わる。弱点を突ける相手が増える代わりに、その属性に強い土地で鈍る）
 */
function infuseConversions(): AffixDef[] {
  return ELEMENTS.filter((e): e is Exclude<Element, "none"> => e !== "none").map((e) => ({
    key: `${INFUSE_KEY_PREFIX}${capitalize(e)}`,
    label: `近接・射撃の{v}%を${ELEMENT_LABEL[e]}属性に変換`,
    tags: ["conversion", "elemental"],
    slots: ATTACK_SLOTS,
    curve: INFUSE_TRAIT_CURVES[e],
    color: ELEMENT_TRAIT_COLOR[e],
    stage: "convert",
    keywords: kw([ELEMENT_KEYWORD_OF[e]]),
    apply: (s: PlayerStats, v: number) => {
      s.infuse[e] += fraction(v);
    },
  }));
}

export function isConversionKey(key: string): boolean {
  return key.startsWith(CONVERSION_KEY_PREFIX);
}

/** slot に付けられ、depth で曲線が始まっている変換の性質 */
/** family を渡すと、その家系専用（AffixDef.family）の性質だけに絞る。省略は家系を問わない */
function familyAllowed(d: AffixDef, family: "melee" | "gun" | undefined): boolean {
  return d.family === undefined || family === undefined || d.family === family;
}

/**
 * 部位の別名。頭は体（armor）の性質をそのまま引く。定義の slots に head を書き足すと
 * 追加漏れが起きやすいので、頭だけに出したい性質だけ head を明示する
 */
const SLOT_ALIAS: Readonly<Partial<Record<Slot, Slot>>> = { head: "armor" };

/** 定義 d がその部位に付けられるか（別名の部位の性質も含む） */
export function slotAllows(d: Pick<AffixDef, "slots">, slot: Slot): boolean {
  if (d.slots.includes(slot)) return true;
  const alias = SLOT_ALIAS[slot];
  return alias !== undefined && d.slots.includes(alias);
}

export function conversionsFor(slot: Slot, depth: number, family?: "melee" | "gun"): AffixDef[] {
  return CONVERSION_AFFIXES.filter((d) => slotAllows(d, slot) && firstDepth(d) <= depth && familyAllowed(d, family));
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
// 誓約 20（旧キーストーン）: 遊び方を変える大型改造。色は冥で固定。
// AffixRoll としては { key: "ks_xxx", value: 0, color: "umbra" } で保存する。
// apply で stats.keystones に key を積み、数値効果も掛ける（"scale" 段階。flat の合算後）。
// メカニクスの変更は戦闘側（src/system/keystones.ts）が stats.keystones.includes(key) で実装する。
// 常時の倍は keystones.ts の keystoneModifiers、「〜時: 〜」は keystoneRules が集める。
// 同じ exclusiveGroup は同時に成立しない。computeStats は装備順で後勝ちの 1 つだけを apply する。
// ---------------------------------------------------------------------------

export const KEYSTONE_KEY_PREFIX = "ks_";
const KEYSTONE_VALUE = 0;
const KEYSTONE_COLOR: TraitColor = "umbra";

export type KeystoneGroup = "body" | "tempo" | "style" | "mana" | "status" | "poise" | "coin";

/** ks_overdraw（過負荷）のスキル威力の低下 */
const OVERDRAW_SKILL_PENALTY = 0.1;
/** ks_silentVow（静寂の誓い）のマナ自然回復の倍率とスキル威力の上昇 */
const SILENT_VOW_REGEN_MUL = 3;
const SILENT_VOW_SKILL_BONUS = 0.3;
/** 倍率の 1 を超える分・下回る分を % の表示に */
const BASE_MULTIPLIER = 1;
/** ks_bladeOath（近間の誓い）: 距離の境目の表示（m）。判定は src/system/combat.ts bladeOathMul */
const BLADE_OATH_RANGE = formatMeters(KEYSTONE.bladeOathRangePx);
const BLADE_OATH_FAR_PCT = Math.round((1 - KEYSTONE.bladeOathFarMul) * 100);
const BLADE_OATH_NEAR_PCT = Math.round((KEYSTONE.bladeOathNearMul - 1) * 100);
const BLADE_OATH_SPEED_PCT = Math.round(KEYSTONE.bladeOathAttackSpeedBonus * 100);
/** ks_farOath（遠間の誓い）: 境目の表示（m）と倍の % */
const FAR_OATH_RANGE = formatMeters(KEYSTONE.farOathRangePx);
const FAR_OATH_NEAR_PCT = ratioPct(1 - KEYSTONE.farOathNearMul);
const FAR_OATH_FAR_PCT = ratioPct(KEYSTONE.farOathFarMul - 1);

export interface KeystoneDef {
  key: string;
  name: string;
  description: string;
  exclusiveGroup: KeystoneGroup;
  /** 数値効果（メカニクスは戦闘側）。stats.keystones への push は共通処理が行う */
  apply: (stats: PlayerStats) => void;
}

const noNumericEffect = (): void => {};

/** 硝子の砲の近接・射撃の倍 */
const GLASS_CANNON_MUL = 2;
const ATTACK_TAGS: readonly DamageTag[] = ["melee", "ranged"];
const SKILL_TAGS: readonly DamageTag[] = ["skill"];
const ATTACK_SKILL_TAGS: readonly DamageTag[] = ["melee", "ranged", "skill"];
/** 1 つの誓約が近接・射撃とスキルに別の倍を持つときのスキル側（source と表示名の添え） */
const SKILL_PART = { suffix: "skill", label: "スキル" } as const;

/**
 * 誓約の与ダメは増ではなく倍（ビルドの顔。docs/ideas/scaling-impl.md 2-1）。
 * source は "keystone:<key>"。part は 1 つの誓約が対象ごとに別の倍を持つときの添え（source と表示名を分ける）
 */
function oathMore(s: PlayerStats, key: string, mul: number, tags: readonly DamageTag[], part?: { suffix: string; label: string }): void {
  const name = keystoneDef(key)?.name ?? key;
  const source = part === undefined ? `keystone:${key}` : `keystone:${key}:${part.suffix}`;
  const label = part === undefined ? name : `${name}（${part.label}）`;
  s.more = withMore(s.more, { source, label, mul, tags });
}

export const KEYSTONES: readonly KeystoneDef[] = [
  // ---- 体（body）----
  {
    key: "ks_glassCannon",
    name: "硝子の砲",
    description: "近接・射撃ダメージが2倍になる。最大生命が1/4になる。",
    exclusiveGroup: "body",
    apply: (s) => {
      oathMore(s, "ks_glassCannon", GLASS_CANNON_MUL, ATTACK_TAGS);
      s.maxHp *= 0.25;
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
  // ---- 拍子（tempo）----
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
    key: "ks_gambler",
    name: "賭博師",
    description: "全ての攻撃が0.2〜3倍のランダムなダメージになる。会心率 +10%。",
    exclusiveGroup: "tempo",
    apply: (s) => {
      s.critChance += 0.1;
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
    key: "ks_mushin",
    name: "虚心",
    description: `コンボが加算されない。攻撃を当てずに ${KEYSTONE.mushinIdleSec} 秒たつと、次の近接・射撃の 1 撃の与ダメージが ${KEYSTONE.mushinMul} 倍になる。`,
    exclusiveGroup: "tempo",
    apply: noNumericEffect,
  },
  {
    key: "ks_instant",
    name: "刹那",
    description: `見切りの瞬間、周囲 ${formatMeters(KEYSTONE.instantRadius)} の敵を ${KEYSTONE.instantSec} 秒凍結させる（ボスは凍らない）。`,
    exclusiveGroup: "tempo",
    apply: noNumericEffect,
  },
  // ---- 流儀（style）----
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
    key: "ks_farOath",
    name: "遠間の誓い",
    description: `${FAR_OATH_RANGE}以内の敵への与ダメージ -${FAR_OATH_NEAR_PCT}%、${FAR_OATH_RANGE}より遠い敵への与ダメージ +${FAR_OATH_FAR_PCT}%。`,
    exclusiveGroup: "style",
    apply: noNumericEffect,
  },
  // ---- 気力（mana）。支払いと回収の規則は src/system/keystones.ts ----
  {
    key: "ks_overdraw",
    name: "過負荷",
    description: "気力が足りなくても、不足分を生命で払ってスキルを撃てる（気力1につき生命0.5）。スキル威力 -10%。",
    exclusiveGroup: "mana",
    apply: (s) => {
      oathMore(s, "ks_overdraw", 1 - OVERDRAW_SKILL_PENALTY, SKILL_TAGS);
    },
  },
  {
    key: "ks_silentVow",
    name: "静寂の誓い",
    description: "通常攻撃を当てても気力が戻らない。気力の自然回復が3倍になり、スキル威力 +30%。",
    exclusiveGroup: "mana",
    apply: (s) => {
      s.manaRegen *= SILENT_VOW_REGEN_MUL;
      oathMore(s, "ks_silentVow", 1 + SILENT_VOW_SKILL_BONUS, SKILL_TAGS);
    },
  },
  {
    key: "ks_chant",
    name: "詠唱の誓い",
    description: "近接・射撃の与ダメージが30%になる。通常攻撃の命中で戻る気力が4倍になり、スキル威力 +50%。",
    exclusiveGroup: "mana",
    apply: (s) => {
      oathMore(s, "ks_chant", KEYSTONE.chantAttackDamageMul, ATTACK_TAGS);
      // 近接のスキルは両方に当たる（従来の近接 × スキルと同じ）ので source を分ける
      oathMore(s, "ks_chant", 1 + KEYSTONE.chantSkillBonus, SKILL_TAGS, SKILL_PART);
    },
  },
  // ---- 状態異常（status）----
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
    key: "ks_contagion",
    name: "病みの誓い",
    description: "敵が倒れると、付いていた状態異常が周囲の敵へすべて移る。近接・射撃ダメージ -40%。",
    exclusiveGroup: "status",
    apply: (s) => {
      oathMore(s, "ks_contagion", KEYSTONE.contagionDamageMul, ATTACK_TAGS);
    },
  },
  // ---- 怯み（poise）----
  {
    key: "ks_unshaken",
    name: "揺るがぬ誓い",
    description: "攻撃で敵を怯ませられなくなる。代わりに近接・射撃・スキルの与ダメージ +35%、怯み値の上昇分の半分も与ダメージになる。",
    exclusiveGroup: "poise",
    apply: (s) => {
      const bonus = KEYSTONE.unshakenDamageBonus + Math.max(0, s.poiseDamageMul - BASE_MULTIPLIER) * KEYSTONE.unshakenPoiseToDamage;
      oathMore(s, "ks_unshaken", 1 + bonus, ATTACK_SKILL_TAGS);
      s.poiseDamageMul = 0;
    },
  },
  // ---- 銭（coin）。docs/ideas/economy-impl.md 2-10 の「持つ・使う・捨てる」の 3 つ ----
  {
    key: "ks_poverty",
    name: "清貧",
    description: `銭を持てない（拾った銭は 1 につき気力 +${KEYSTONE.povertyManaPerCoin} に換わる）。与ダメージ +${ratioPct(KEYSTONE.povertyIncreased)}%。`,
    exclusiveGroup: "coin",
    apply: noNumericEffect,
  },
  {
    key: "ks_goldCage",
    name: "黄金の檻",
    description: `持ち金 ${KEYSTONE.goldCageEvery} につき与ダメージ ×${KEYSTONE.goldCageMul}（足し合わせ）。被弾でこぼれる銭が持ち金の ${ratioPct(KEYSTONE.goldCageSpillRatio)}% になる。`,
    exclusiveGroup: "coin",
    apply: (s) => {
      s.coinSpillMul *= KEYSTONE.goldCageSpillRatio / ECONOMY.spill.ratio;
    },
  },
  {
    key: "ks_alms",
    name: "喜捨",
    description: `銭を払うたび、払った額 × ${KEYSTONE.almsHealPerCoin} の生命を回復し、${KEYSTONE.almsBuffSec} 秒与ダメージ +${KEYSTONE.almsBuffPct}%。`,
    exclusiveGroup: "coin",
    apply: noNumericEffect,
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
      s.increased.melee -= pct(20);
      s.meleeReachMul -= pct(15);
    },
  },
  {
    key: "implicit.shortsword",
    label: "近接ダメージ +{v}%",
    range: { min: 8, max: 12 },
    apply: (s, v) => {
      s.increased.melee += pct(v);
    },
  },
  {
    key: "implicit.longsword",
    label: "近接ダメージ +{v}%、リーチ +10%、攻撃速度 -5%",
    range: { min: 15, max: 22 },
    apply: (s, v) => {
      s.increased.melee += pct(v);
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
      s.increased.melee -= pct(10);
    },
  },
  {
    key: "implicit.greatsword",
    label: "近接ダメージ +{v}%、リーチ +20%、攻撃速度 -25%",
    range: { min: 35, max: 45 },
    apply: (s, v) => {
      s.increased.melee += pct(v);
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
      s.increased.vsStaggered += pct(v);
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
      s.increased.ranged += pct(v);
    },
  },
  {
    key: "implicit.smg",
    label: "連射速度 +{v}%、射撃ダメージ -30%",
    range: { min: 40, max: 60 },
    apply: (s, v) => {
      s.fireRateMul += pct(v);
      s.increased.ranged -= pct(30);
    },
  },
  {
    key: "implicit.rifle",
    label: "射撃ダメージ +{v}%、貫通 +1、弾速 +25%、連射速度 -20%",
    range: { min: 30, max: 40 },
    apply: (s, v) => {
      s.increased.ranged += pct(v);
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
      s.increased.ranged -= pct(40);
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
      s.increased.ranged += pct(20);
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
    label: "最大生命 +{v}、防御力 +{v2}",
    range: { min: 20, max: 30, min2: 3, max2: 5 },
    apply: (s, v, v2) => {
      s.maxHp += v;
      s.armor += v2;
    },
  },
  {
    key: "implicit.plate",
    label: "防御力 +{v}、最大生命 +20、移動速度 -8%",
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
      s.increased.melee += pct(v);
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
    label: "ダッシュ再使用時間 -{v}%、防御力 +3",
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
      s.increased.melee += pct(v);
    },
  },
  {
    key: "implicit.sapphireRing",
    label: "射撃ダメージ +{v}%",
    range: { min: 4, max: 8 },
    apply: (s, v) => {
      s.increased.ranged += pct(v);
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
      s.increased.ultimate += pct(v);
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
      s.increased.melee -= pct(20);
    },
  },
  {
    key: "implicit.throwingKnives",
    label: "連射速度 +{v}%、会心率 +3%、射撃ダメージ -15%",
    range: { min: 15, max: 25 },
    apply: (s, v) => {
      s.fireRateMul += pct(v);
      s.critChance += pct(3);
      s.increased.ranged -= pct(15);
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
      s.increased.ranged -= pct(35);
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
    label: "防御力 +{v}、怯み値 +10%、移動速度 -12%",
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
  // head（2026-09-26 部位「頭」）: 軽い個性。頭は体の性質を引くので implicit は小さめ
  {
    key: "implicit.hood",
    label: "移動速度 +{v}%",
    range: { min: 3, max: 5 },
    apply: (s, v) => {
      s.moveSpeedMul += pct(v);
    },
  },
  {
    key: "implicit.leatherCap",
    label: "最大生命 +{v}",
    range: { min: 4, max: 8 },
    apply: (s, v) => {
      s.maxHp += v;
    },
  },
  {
    key: "implicit.ironHelm",
    label: "防御力 +{v}、移動速度 -3%",
    range: { min: 3, max: 5 },
    apply: (s, v) => {
      s.armor += v;
      s.moveSpeedMul -= pct(3);
    },
  },
  {
    key: "implicit.circlet",
    label: "最大気力 +{v}",
    range: { min: 6, max: 10 },
    apply: (s, v) => {
      s.maxMana += v;
    },
  },
  {
    key: "implicit.maskedVisor",
    label: "受ける状態異常の持続 -{v}%、防御力 +2",
    range: { min: 10, max: 15 },
    apply: (s, v) => {
      s.statusTakenMul -= pct(v);
      s.armor += 2;
    },
  },
  {
    key: "implicit.sandogasa",
    label: "氷耐性 +{v}%、雷耐性 +{v}%",
    range: { min: 5, max: 8 },
    apply: (s, v) => {
      s.resist.ice += v;
      s.resist.lightning += v;
    },
  },
  {
    key: "implicit.hachigane",
    label: "ダッシュ再使用時間 -{v}%",
    range: { min: 5, max: 8 },
    apply: (s, v) => {
      s.dashCooldownMul -= pct(v);
    },
  },
  {
    key: "implicit.hornedHelm",
    label: "近接ダメージ +{v}%、被ダメージ +5%",
    range: { min: 6, max: 10 },
    apply: (s, v) => {
      s.increased.melee += pct(v);
      s.damageTakenMul += pct(5);
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
      s.increased.melee -= pct(10);
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
  },  // ---- 武器 Wave 4 の器（docs/ideas/weapons-wave4.md 2〜5 章）。設計の「踏み込み中の被ダメ −」「溜め中の移動 +」「弾の命中で気力 +」は
  // 専用の数値が無いので、近い既存の数値（交戦中の被ダメ・溜めの怯み値・気力回収）で表す ----
  {
    key: "implicit.ironClaws",
    label: "状態異常の効果量 +{v}%（出血が深くなる）",
    range: { min: 10, max: 15 },
    apply: (s, v) => {
      s.statusPotencyMul += pct(v);
    },
  },
  {
    key: "implicit.beastClaws",
    label: "交戦中の部屋で被ダメージ -{v}%",
    range: { min: 6, max: 10 },
    apply: (s, v) => {
      s.traits.engagedGuard += pct(v);
    },
  },
  {
    key: "implicit.morningStar",
    label: "怯み値 +{v}%",
    range: { min: 15, max: 22 },
    apply: (s, v) => {
      s.poiseDamageMul += pct(v);
    },
  },
  {
    key: "implicit.greatFlail",
    label: "溜めの段 1 つにつき近接の怯み値 +{v}%（回しが重くなる）",
    range: { min: 10, max: 15 },
    apply: (s, v) => {
      s.traits.chargedPoiseMul += pct(v);
    },
  },
  {
    key: "implicit.fangRings",
    label: "気力回収 +{v}%",
    range: { min: 10, max: 15 },
    apply: (s, v) => {
      s.manaGainMul += pct(v);
    },
  },
  {
    key: "implicit.danceFan",
    label: "移動速度 +{v}%",
    range: { min: 4, max: 6 },
    apply: (s, v) => {
      s.moveSpeedMul += pct(v);
    },
  },
  {
    key: "implicit.warFan",
    label: "ノックバック +{v}%",
    range: { min: 20, max: 30 },
    apply: (s, v) => {
      s.knockbackMul += pct(v);
    },
  },
];

// ---------------------------------------------------------------------------
// 参照 API
// ---------------------------------------------------------------------------

/** 性質 + 変換の性質 + 地金の行（変換は traitsFor の抽選プールに入らない。地金の行はどの抽選にも入らない） */
const AFFIX_BY_KEY: ReadonlyMap<string, AffixDef> = new Map(
  [...AFFIXES, ...CONVERSION_AFFIXES, ...INNATE_LINE_DEFS].map((d) => [d.key, d]),
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

/** slot に付けられ、depth で曲線が始まっている通常の性質（変換・目覚め・地金の行は含まない） */
export function traitsFor(slot: Slot, depth: number, family?: "melee" | "gun"): AffixDef[] {
  return AFFIXES.filter((d) => d.awakening !== true && slotAllows(d, slot) && firstDepth(d) <= depth && familyAllowed(d, family));
}

/** 目覚め（芽専用の性質）の定義。段取り 7d で専用の性質は無くなったので、今は true を返す key は無い */
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
