import { isKeystoneKey, isMarkerKey, keystoneDef, keystoneToRoll } from "./affixes";
import { defaultColorOfKey } from "./colors";
import { fluxClassOf } from "./flux";
import { UNIQUES } from "./named";
import { nameItem } from "./names";
import { isTriggerKey } from "./triggers";
import { createEmptyProvenance, type AffixRoll, type Item, type Rarity } from "./types";

/**
 * 旧形式（prefix / suffix / tier / rarity）のアイテムを新形式（色・揺らぎ・来歴）へ変換する。
 * docs/LOOT_DESIGN.md「旧セーブの移行」。
 * - tier → 揺らぎ: T1 +0.4 / T2 +0.2 / T3 0 / T4 -0.1 / T5 -0.2 / T6 -0.3。期待値は |value| / (1 + flux) で逆算
 * - 負の値（旧 Corrupt の反転）→ 反転（色は冥）
 * - 旧 rarity → 余白: normal 4 / magic 3 / rare 2 / unique 1
 * - 旧 rare の 2 語名は銘として残す。旧 unique は固有名から名のある遺物の key を引く
 * - 腐敗の印（cr_corrupted）は捨てる。来歴は空
 * 新形式のアイテム（provenance を持つ）には欠けたフィールドを補うだけで、値は変えない（冪等）。
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
  return UNIQUES.find((u) => u.baseKey === item.baseKey && u.affixes.every((spec) => keys.has(spec.key)))?.key;
}

/**
 * 成長まわりのフィールド（provenance / margin / milestones / buds / budOffer）が欠けていれば補う（その場で書き換える）。
 * 余白は旧 rarity から決める。ラン中に旧形式のまま装備されたアイテム（テストのリテラル等）にも使う
 */
export function ensureGrowthFields(item: Item): Item {
  if (item.provenance === undefined) item.provenance = createEmptyProvenance();
  if (item.margin === undefined) item.margin = LEGACY_RARITY_MARGIN[item.rarity];
  if (item.marginMax === undefined) item.marginMax = Math.max(item.margin, LEGACY_RARITY_MARGIN[item.rarity]);
  if (item.milestones === undefined) item.milestones = [];
  if (item.buds === undefined) item.buds = [];
  if (item.budOffer === undefined) item.budOffer = null;
  return item;
}

/** 旧形式 → 新形式。新形式ならフィールドを補うだけ（冪等）。引数は変更しない */
export function migrateItem(item: Item): Item {
  if (isNewFormat(item)) return ensureGrowthFields({ ...item });
  const affixes = item.affixes.map(migrateRoll).filter((r): r is AffixRoll => r !== null);
  const margin = LEGACY_RARITY_MARGIN[item.rarity];
  const out: Item = {
    id: item.id,
    seed: item.seed,
    baseKey: item.baseKey,
    slot: item.slot,
    rarity: fluxClassOf(affixes),
    itemLevel: item.itemLevel,
    name: item.name,
    implicit: item.implicit === null ? null : stripLegacy(item.implicit),
    affixes,
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
  return out;
}

/** implicit から kind / tier を落とす */
function stripLegacy(roll: AffixRoll): AffixRoll {
  const out: AffixRoll = { key: roll.key, value: roll.value };
  if (roll.value2 !== undefined) out.value2 = roll.value2;
  return out;
}
