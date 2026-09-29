import { DAMAGE_TAGS, type DamageTag, type MoreMul, dedupeMore, withMore } from "../core/damage";
import { ELEMENTS, ELEMENT_LABEL } from "../core/element";
import { HEAL, MANA, STATUS, WEAPON } from "../data/tuning";
import { DEFAULT_MOVESET } from "../data/weapons";
import { bulletOfBase } from "./bullets";
import { APPLY_STAGES, applyRoll, isKeystoneKey, resolveKeystones, rollStage } from "./affixes";
import { baseDef } from "./bases";
import {
  adjustForResonance,
  applyConstellation,
  applyResonanceEffect,
  cancelInversions,
  computeResonance,
  mainColors,
  resolveConstellation,
  resonanceRules,
  type ResonanceRules,
} from "./resonance";
import { collectInnate } from "./innate";
import { gearContext, gearContextCleared, scaleByProvenance } from "./traitContext";
import { ATTR_KEYS, DEFAULT_STATS, SLOTS, type AffixRoll, type Equipment, type PlayerStats, type Resonance } from "./types";

/** 倍率系の下限（マイナス補正の積み重ねで 0 以下にならないように） */
const MIN_MULTIPLIER = 0.1;
/** 被ダメ倍率の下限（無敵化を防ぐ） */
const MIN_DAMAGE_TAKEN_MUL = 0.3;
const MIN_MAX_HP = 1;
const MIN_PROJECTILES = 1;
const MIN_DASH_CHARGES = 1;
/** 表示・比較用の誤差 */
const EPSILON = 1e-6;
const PERCENT_SCALE = 100;
const DISPLAY_DECIMALS = 1;
/** 倍の表示の小数の桁 */
const MORE_DECIMALS = 2;

/** PlayerStats のうち数値のフィールド（keystones / triggers などの配列は除く） */
type StatKey = {
  [K in keyof PlayerStats]: PlayerStats[K] extends number ? K : never;
}[keyof PlayerStats];

const MULTIPLIER_KEYS: readonly StatKey[] = [
  "moveSpeedMul",
  "dashCooldownMul",
  "dashDistanceMul",
  "attackSpeedMul",
  "meleeReachMul",
  "knockbackMul",
  "fireRateMul",
  "projectileSpeedMul",
  "critMul",
  "energyGainMul",
  "burstRadiusMul",
  "justDodgeDamageMul",
  // マナの性質（スキルのコスト −% と威力の代償）を重ねても 0 以下にしない
  "manaGainMul",
  "manaCostMul",
  // 多彩（効果量 −）などの代償を重ねても 0 以下にしない
  "statusPotencyMul",
];

const PROBABILITY_KEYS: readonly StatKey[] = [
  "critChance",
  "burnChance",
  "chillChance",
  "shockChance",
  "explodeOnKillChance",
];

/** ソフトキャップ: この倍率（= +100%）を超えた分を圧縮する */
export const SOFT_CAP_THRESHOLD = 2;
/**
 * 圧縮の曲率。超過分 x を knee * (sqrt(1 + 2x / knee) - 1) に写す（x = 0 で傾き 1、以降 sqrt で鈍化）。
 * 0.4 なら +300%（x = 2）で 2.93 倍に収まる
 */
const SOFT_CAP_KNEE = 0.4;

/**
 * ソフトキャップ対象（速さだけ。与ダメの増は加算なので積むほど 1 点の価値が下がり、圧縮しない。
 * docs/ideas/scaling-impl.md 2-2）
 */
const SOFT_CAPPED_KEYS: readonly StatKey[] = [
  "attackSpeedMul",
  "fireRateMul",
  "moveSpeedMul",
];

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));

/**
 * 装備順（SLOTS 順）に implicit → affixes を並べる。
 * 来歴で育つ性質（古傷・歴戦 …）はここでその遺物の来歴の段数を掛けておく（traitContext.ts）
 */
function collectRolls(equipment: Equipment): AffixRoll[] {
  const rolls: AffixRoll[] = [];
  for (const slot of SLOTS) {
    const item = equipment[slot];
    if (item === null) continue;
    if (item.implicit !== null) rolls.push(item.implicit);
    rolls.push(...item.affixes.map((roll) => scaleByProvenance(roll, item.provenance)));
  }
  return rolls;
}

/** 共鳴の判定の規則（色の誓約・橋渡し・双頭の指輪）。誓約は排他を解決した後のものだけを見る */
function rulesOf(equipment: Equipment): ResonanceRules {
  return resonanceRules(filterKeystoneRolls(collectRolls(equipment)));
}

/** 装備中の性質（implicit を除く）。色の配合の入力 */
export function equippedTraits(equipment: Equipment): AffixRoll[] {
  return SLOTS.flatMap((slot) => equipment[slot]?.affixes ?? []);
}

/** 装備全体の共鳴（computeStats と同じ判定。星座も入れる）。UI のプレビュー用 */
export function equipmentResonance(equipment: Equipment): Resonance {
  return withConstellation(computeResonance(equippedTraits(equipment), rulesOf(equipment)), equipment);
}

/** 星座が成立していれば共鳴に添える（成立しなければ元のまま。比較・表示に空のフィールドを増やさない） */
function withConstellation(resonance: Resonance, equipment: Equipment): Resonance {
  const constellation = resolveConstellation(mainColors(equipment));
  return constellation === undefined ? resonance : { ...resonance, constellation };
}

/** DEFAULT_STATS のコピー。配列は共有しないよう複製する */
function createBaseStats(): PlayerStats {
  return {
    ...DEFAULT_STATS,
    increased: { ...DEFAULT_STATS.increased },
    more: [],
    keystones: [...DEFAULT_STATS.keystones],
    triggers: [...DEFAULT_STATS.triggers],
    resonance: {
      ...DEFAULT_STATS.resonance,
      colors: [...DEFAULT_STATS.resonance.colors],
      ratios: { ...DEFAULT_STATS.resonance.ratios },
    },
    attributes: { ...DEFAULT_STATS.attributes },
    attributesEff: { ...DEFAULT_STATS.attributesEff },
    statusProcs: [...DEFAULT_STATS.statusProcs],
    traits: { ...DEFAULT_STATS.traits },
    resist: { ...DEFAULT_STATS.resist },
    infuse: { ...DEFAULT_STATS.infuse },
  };
}

/** +100% を超える部分を sqrt 系の曲線で圧縮する。単調増加・連続・閾値で傾き 1 */
export function softCap(mul: number): number {
  if (mul <= SOFT_CAP_THRESHOLD) return mul;
  const excess = mul - SOFT_CAP_THRESHOLD;
  return SOFT_CAP_THRESHOLD + SOFT_CAP_KNEE * (Math.sqrt(1 + (2 * excess) / SOFT_CAP_KNEE) - 1);
}

function applySoftCaps(stats: PlayerStats): void {
  for (const key of SOFT_CAPPED_KEYS) stats[key] = softCap(stats[key]);
}

/**
 * キーストーンの排他を解決する。同じ exclusiveGroup は装備順で後勝ち、同じ key の重複は 1 つにする。
 * 負けたキーストーンは apply しない（数値効果も keystones への push も起きない）
 */
function filterKeystoneRolls(rolls: readonly AffixRoll[]): AffixRoll[] {
  const keystoneKeys = rolls.filter((r) => isKeystoneKey(r.key)).map((r) => r.key);
  const winners = new Set(resolveKeystones(keystoneKeys));
  const lastIndexByKey = new Map<string, number>();
  rolls.forEach((r, i) => {
    if (isKeystoneKey(r.key)) lastIndexByKey.set(r.key, i);
  });
  return rolls.filter((r, i) => !isKeystoneKey(r.key) || (winners.has(r.key) && lastIndexByKey.get(r.key) === i));
}

/** 整数化・クランプ */
function finalize(stats: PlayerStats): PlayerStats {
  for (const key of MULTIPLIER_KEYS) stats[key] = Math.max(MIN_MULTIPLIER, stats[key]);
  for (const key of PROBABILITY_KEYS) stats[key] = clamp(stats[key], 0, 1);
  stats.damageTakenMul = Math.max(MIN_DAMAGE_TAKEN_MUL, stats.damageTakenMul);
  // 無垢の誓いは 0（状態異常を受けない）。耐性の性質を重ねても負にはしない
  stats.statusTakenMul = Math.max(0, stats.statusTakenMul);
  // 揺るがぬ誓いは 0（怯ませない）。代償の −% を重ねても負にはしない
  stats.poiseDamageMul = Math.max(0, stats.poiseDamageMul);
  // 装備画面の表示と実払い（effectiveManaCost）が同じ下限を見るよう、装備側でも costMulMin で止める
  stats.manaCostMul = Math.max(MANA.costMulMin, stats.manaCostMul);
  // chill の上限は STATUS.maxSlow（statusEffects.ts の chillFactor）と 1 箇所に統一する
  stats.chillSlow = clamp(stats.chillSlow, 0, STATUS.maxSlow);
  stats.maxHp = Math.max(MIN_MAX_HP, Math.round(stats.maxHp));
  stats.projectileCount = Math.max(MIN_PROJECTILES, Math.round(stats.projectileCount));
  stats.dashCharges = Math.max(MIN_DASH_CHARGES, Math.round(stats.dashCharges));
  stats.pierce = Math.max(0, Math.round(stats.pierce));
  // 最大マナ −の性質（涸れ井戸など）で負にしない。自然回復も同様
  stats.maxMana = Math.max(0, stats.maxMana);
  stats.manaRegen = Math.max(0, stats.manaRegen);
  // 支配の減衰（× 0.75）で端数が出る。UI は整数で見せるので集計の時点で揃える（逓減は deriveAttributes）
  for (const key of ATTR_KEYS) stats.attributes[key] = Math.max(0, Math.round(stats.attributes[key]));
  finalizeElements(stats);
  return stats;
}

/**
 * 防御・属性（docs/COMBAT_DESIGN.md A-8）。魔防は負にしない。変換の割合は 0..1 に収め、合計が 1 を超えたら按分で 1 に縮める
 * （耐性のソフトキャップは被弾時に system/combat.ts の effectiveResist が掛ける。表示は生の合計を見せる）
 */
function finalizeElements(stats: PlayerStats): void {
  stats.warding = Math.max(0, stats.warding);
  stats.skillNeutral = clamp(stats.skillNeutral, 0, 1);
  stats.infuse.none = 0;
  for (const e of ELEMENTS) stats.infuse[e] = Math.max(0, stats.infuse[e]);
  const total = ELEMENTS.reduce((sum, e) => sum + stats.infuse[e], 0);
  if (total <= 1) return;
  for (const e of ELEMENTS) stats.infuse[e] /= total;
}

/**
 * flat → scale → convert の段階ごとに適用する（max HP % は flat の合算後に掛かる）。
 * convert は変換アフィックス（"A を B に変換"）。盛り終えた値を移すので scale の後、ソフトキャップの前
 */
function applyStaged(stats: PlayerStats, rolls: readonly AffixRoll[]): void {
  for (const stage of APPLY_STAGES) {
    for (const roll of rolls) {
      if (rollStage(roll) === stage) applyRoll(stats, roll);
    }
  }
}

/**
 * 装備から PlayerStats を畳み込む。
 * 1. 誓約（旧キーストーン）の排他を解決（同グループは装備順で後勝ち）。来歴で育つ性質は段数を掛ける
 * 2. 装備中の性質の色の配合から共鳴を決める（resonance.ts。支配 → 二重 → 三和音 → 散光 → なし。規則は色の誓約などで変わる）
 * 3. 共鳴に応じて性質の値を調整（支配: 他の色を 75% に / 冥の支配: 反転を正として扱う / 無色の誓い: 全性質 +20%）
 * 4. DEFAULT_STATS のコピーに装備全体の文脈（余白・銘・反転・異色の数）を入れ、
 *    地金（全部位。今の深度 depth で決め直す: innate.ts の innateAt）→ 装備順で implicit → 性質（trigger 含む）を段階適用（flat → scale → convert）
 * 5. 共鳴の効果を畳み込む。星座（6 部位の主色の並び）が成立していればその効果も（虚空は 3 の後に反転を打ち消す）
 * 6. 速さの倍率にソフトキャップ
 * 7. 誓約を apply（アイデンティティなのでソフトキャップの対象外。与ダメは倍（more）に入る。HP 倍率も flat 合算後に掛かる）
 * 8. 整数化・クランプ
 *
 * depth は今いる階の深度（地金だけが使う。拠点・倉庫・ランの開始は 1）
 */
export function computeStats(equipment: Equipment, depth = 1): PlayerStats {
  const stats = createBaseStats();
  Object.assign(stats.traits, gearContext(equipment));
  const filtered = filterKeystoneRolls(collectRolls(equipment));
  const rules = resonanceRules(filtered);
  const resonance = withConstellation(computeResonance(equippedTraits(equipment), rules), equipment);
  const constellation = resonance.constellation;
  const adjusted = adjustForResonance(filtered, resonance, rules);
  const rolls = constellation === "void" ? cancelInversions(adjusted) : adjusted;
  // 地金は共鳴の調整・来歴の段数・色の配合を通さず、性質と同じ段階（flat → scale → convert）で先に畳む
  applyStaged(stats, [...collectInnate(equipment, depth), ...rolls.filter((r) => !isKeystoneKey(r.key))]);
  applyResonanceEffect(stats, resonance, rules);
  if (constellation !== undefined) applyConstellation(stats, constellation);
  applySoftCaps(stats);
  applyStaged(stats, rolls.filter((r) => isKeystoneKey(r.key)));
  // 装備全体の文脈は性質の適用の間だけ使う入力。畳み込み後は既定へ戻す（比較・表示に装備の数を紛れ込ませない）
  Object.assign(stats.traits, gearContextCleared());
  stats.resonance = resonance;
  applyWeaponForms(stats, equipment);
  return finalize(stats);
}

/** 右手のベースが決める武器種と弾（src/data/weapons.ts / src/loot/bullets.ts）。空きスロットや銃でないベースは既定 */
function applyWeaponForms(stats: PlayerStats, equipment: Equipment): void {
  const base = equipment.mainHand ? baseDef(equipment.mainHand.baseKey) : undefined;
  stats.moveset = base?.moveset ?? DEFAULT_MOVESET;
  stats.bullet = bulletOfBase(base?.key);
  // 素手は拳と同じ動きができるが、武器を持つ意味を残すため威力を下げる。
  // 右手に物があれば素手ではない（未知のベースは壊れたデータなので型だけ既定へ落とし、威力は削らない）
  stats.unarmed = !equipment.mainHand;
  if (stats.unarmed) stats.more = withMore(stats.more, UNARMED_MORE);
}

/** 素手の威力の倍（近接だけ。拠点の武器掛けで試すときは source で外す） */
export const UNARMED_MORE: Readonly<MoreMul> = {
  source: "unarmed",
  label: "素手",
  mul: WEAPON.unarmed.damageMul,
  tags: ["melee"],
};

// ---------------------------------------------------------------------------
// 表示
// ---------------------------------------------------------------------------

/**
 * - flat: 値そのまま（"Max HP 140"）
 * - mul: 基準 1 からの差を %（"Melee Damage +25%"）
 * - percent: 値 × 100 を %（"Crit Chance 12%"）
 * - seconds: 秒（"Combo Window +0.5s"）
 */
type StatStyle = "flat" | "mul" | "percent" | "seconds";

interface StatFormat {
  label: string;
  style: StatStyle;
}

const STAT_FORMATS: Readonly<Record<StatKey, StatFormat>> = {
  maxHp: { label: "最大生命", style: "flat" },
  hpRegen: { label: "生命自然回復（敵が近くにいない間）", style: "flat" },
  // lifeOnHit は与ダメに対する %（値 3 = 3%）なので flat のまま単位をラベルで示す
  lifeOnHit: { label: "与ダメからの生命回復(%)", style: "flat" },
  lifeOnKill: { label: `撃破時の生命回復（${HEAL.killHealMinCombo}コンボ以上）`, style: "flat" },
  armor: { label: "防御力", style: "flat" },
  warding: { label: "魔防", style: "flat" },
  damageTakenMul: { label: "被ダメージ", style: "mul" },
  thorns: { label: "反射ダメージ", style: "flat" },

  moveSpeedMul: { label: "移動速度", style: "mul" },
  dashCooldownMul: { label: "ダッシュ再使用時間", style: "mul" },
  dashCharges: { label: "ダッシュ回数", style: "flat" },
  dashDistanceMul: { label: "ダッシュ距離", style: "mul" },
  dashInvulnBonus: { label: "ダッシュの無敵時間", style: "flat" },

  meleeDamageFlat: { label: "近接ダメージ（固定値）", style: "flat" },
  attackSpeedMul: { label: "攻撃速度", style: "mul" },
  meleeReachMul: { label: "リーチ", style: "mul" },
  knockbackMul: { label: "ノックバック", style: "mul" },

  rangedDamageFlat: { label: "射撃ダメージ（固定値）", style: "flat" },
  fireRateMul: { label: "連射速度", style: "mul" },
  projectileCount: { label: "弾数", style: "flat" },
  pierce: { label: "貫通", style: "flat" },
  projectileSpeedMul: { label: "弾速", style: "mul" },

  critChance: { label: "会心率", style: "percent" },
  critMul: { label: "会心倍率", style: "percent" },

  energyGainMul: { label: "奥義ゲージ獲得", style: "mul" },
  burstRadiusMul: { label: "奥義の範囲", style: "mul" },

  comboWindowBonus: { label: "コンボ猶予", style: "seconds" },
  comboDamagePerStack: { label: "コンボ1段階ごとのダメージ", style: "percent" },
  comboDamageCap: { label: "コンボダメージ上限", style: "percent" },
  justDodgeDamageMul: { label: "見切りダメージ", style: "mul" },
  justDodgeWindow: { label: "見切り猶予", style: "seconds" },

  burnChance: { label: "炎上確率", style: "percent" },
  burnDps: { label: "炎上ダメージ/秒", style: "flat" },
  chillChance: { label: "凍結確率", style: "percent" },
  chillSlow: { label: "凍結減速", style: "percent" },
  shockChance: { label: "感電確率", style: "percent" },
  shockDamage: { label: "感電ダメージ", style: "flat" },
  explodeOnKillChance: { label: "撃破時爆発確率", style: "percent" },
  explodeDamage: { label: "爆発ダメージ", style: "flat" },
  maxMana: { label: "最大気力", style: "flat" },
  manaRegen: { label: "気力自然回復", style: "flat" },
  manaGainMul: { label: "気力回収", style: "mul" },
  manaCostMul: { label: "スキルのコスト", style: "mul" },
  manaOnKill: { label: "撃破時気力回収", style: "flat" },
  poiseDamageMul: { label: "怯み値", style: "mul" },
  statusPotencyMul: { label: "状態異常の効果量", style: "mul" },
  statusTakenMul: { label: "受ける状態異常の持続", style: "mul" },
  bulletCut: { label: "弾斬り", style: "flat" },
  skillNeutral: { label: "スキルの無属性化", style: "percent" },
  chainRevisits: { label: "連鎖が同じ敵へ戻れる回数", style: "flat" },
  chainCoefBonus: { label: "連鎖係数の上乗せ", style: "percent" },
};

/** 小数 1 桁に丸め、末尾の .0 を落とす */
function num(v: number): string {
  return String(Number(v.toFixed(DISPLAY_DECIMALS)));
}

function signed(v: number): string {
  return v >= 0 ? `+${num(v)}` : num(v);
}

function formatStat(format: StatFormat, value: number): string {
  switch (format.style) {
    case "flat":
      return `${format.label} ${num(value)}`;
    case "mul":
      return `${format.label} ${signed((value - 1) * PERCENT_SCALE)}%`;
    case "percent":
      return `${format.label} ${num(value * PERCENT_SCALE)}%`;
    case "seconds":
      return `${format.label} ${signed(value)}秒`;
  }
}

/** DEFAULT_STATS と異なる数値項目だけを表示用文字列で列挙する（keystones / triggers は対象外）。増・倍は数値項目の後 */
export function statsSummary(stats: PlayerStats): string[] {
  const keys = Object.keys(STAT_FORMATS) as StatKey[];
  const lines = keys
    .filter((key) => Math.abs(stats[key] - DEFAULT_STATS[key]) > EPSILON)
    .map((key) => formatStat(STAT_FORMATS[key], stats[key]));
  return [...lines, ...increasedSummary(stats), ...moreSummary(stats), ...elementSummary(stats)];
}

/** 増のタグの表示名（「近接ダメージ 増 +20%」の頭）。docs/GLOSSARY.md「増 / 倍」 */
export const INCREASED_LABEL: Readonly<Record<DamageTag, string>> = {
  melee: "近接ダメージ",
  ranged: "射撃ダメージ",
  skill: "スキル威力",
  ultimate: "奥義の威力",
  proc: "追加効果のダメージ",
  dot: "継続ダメージ",
  area: "範囲ダメージ",
  placed: "設置物のダメージ",
  minion: "従魔のダメージ",
  fire: "炎属性のダメージ",
  ice: "氷属性のダメージ",
  lightning: "雷属性のダメージ",
  poison: "毒属性のダメージ",
  dark: "闇属性のダメージ",
  light: "光属性のダメージ",
  vsStaggered: "怯み中の敵へのダメージ",
  vsBoss: "ボスへのダメージ",
  vsElite: "精鋭へのダメージ",
  counter: "カウンターのダメージ",
  backstab: "背後からのダメージ",
  reaction: "反応のダメージ",
  critMulti: "会心倍率",
  poise: "怯み値",
};

/** 増の 1 行（「近接ダメージ 増 +20%」） */
export function formatIncreased(tag: DamageTag, value: number): string {
  return `${INCREASED_LABEL[tag]} 増 ${signed(value * PERCENT_SCALE)}%`;
}

/** 倍の 1 行（「硝子の砲 倍 ×2」） */
export function formatMore(m: Readonly<MoreMul>): string {
  return `${m.label} 倍 ×${formatMoreMul(m.mul)}`;
}

/** 倍率の表記（小数 2 桁まで、末尾の 0 は落とす） */
export function formatMoreMul(mul: number): string {
  return String(Number(mul.toFixed(MORE_DECIMALS)));
}

/** 0 でない増を DAMAGE_TAGS 順に */
export function increasedSummary(stats: Readonly<PlayerStats>): string[] {
  return DAMAGE_TAGS.filter((tag) => Math.abs(stats.increased[tag]) > EPSILON).map((tag) => formatIncreased(tag, stats.increased[tag]));
}

/** 常時の倍を出所ごとに（等倍は出さない） */
export function moreSummary(stats: Readonly<PlayerStats>): string[] {
  return dedupeMore(stats.more).filter((m) => Math.abs(m.mul - 1) > EPSILON).map(formatMore);
}

/** 装備の入れ替えで変わる増・倍の 1 行（rises は値が上がったか。与ダメの増・倍は上がるほど良い） */
export interface DamageModDiff {
  text: string;
  rises: boolean;
}

/** 入れ替え前後の増（タグごと）と倍（出所ごと）の差。消えたものは「→ なし」 */
export function damageModDiffs(before: Readonly<PlayerStats>, after: Readonly<PlayerStats>): DamageModDiff[] {
  const out: DamageModDiff[] = [];
  for (const tag of DAMAGE_TAGS) {
    const was = before.increased[tag];
    const now = after.increased[tag];
    if (Math.abs(now - was) <= EPSILON) continue;
    const text = Math.abs(now) > EPSILON ? formatIncreased(tag, now) : `${formatIncreased(tag, was)} → なし`;
    out.push({ text, rises: now > was });
  }
  const wasMore = new Map(dedupeMore(before.more).map((m) => [m.source, m]));
  const nowMore = new Map(dedupeMore(after.more).map((m) => [m.source, m]));
  for (const source of new Set([...nowMore.keys(), ...wasMore.keys()])) {
    const was = wasMore.get(source);
    const now = nowMore.get(source);
    const wasMul = was?.mul ?? 1;
    const nowMul = now?.mul ?? 1;
    if (Math.abs(nowMul - wasMul) <= EPSILON) continue;
    const text = now !== undefined ? formatMore(now) : `${formatMore(was ?? { source, label: source, mul: 1 })} → なし`;
    out.push({ text, rises: nowMul > wasMul });
  }
  return out;
}

/** 属性耐性（「炎耐性 +20%」）と属性の変換（「近接・射撃の炎属性 40%」）。0 の行は出さない */
export function elementSummary(stats: PlayerStats): string[] {
  const lines: string[] = [];
  for (const e of ELEMENTS) {
    if (Math.abs(stats.resist[e]) > EPSILON) lines.push(`${ELEMENT_LABEL[e]}耐性 ${signed(stats.resist[e])}%`);
  }
  for (const e of ELEMENTS) {
    if (stats.infuse[e] > EPSILON) lines.push(`近接・射撃の${ELEMENT_LABEL[e]}属性 ${num(stats.infuse[e] * PERCENT_SCALE)}%`);
  }
  return lines;
}
