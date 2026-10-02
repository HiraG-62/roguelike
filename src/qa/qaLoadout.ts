import type { Rng } from "../core/rng";
import { fluxClassOf } from "../loot/flux";
import { generateItem, makeItemId, MAX_FOUND_TRAITS, rollBase, rollImplicit, rollMargin, rollTraitOfColor, type TraitRollOptions } from "../loot/generator";
import { nameItem } from "../loot/names";
import { createEmptyProvenance, type AffixRoll, type Item, type Rarity, type Slot, type TraitColor } from "../loot/types";
import { stoneFromSeed } from "../skills/generator";
import type { SkillProfile, SkillStone } from "../skills/types";

/**
 * QA の装備とスキルの組み立て（フル QA の simulation.test.ts と装備パターンの行列 gearMatrix.ts が共有する）。
 * どれも専用の rng を受け取り、state.rng は消費しない
 */

const UINT32_MAX = 0xffffffff;

// ---------------------------------------------------------------------------
// 装備
// ---------------------------------------------------------------------------

/**
 * generateItem に rarity（揺らぎ分類）を直接指定するオプションは無い（再設計で格付けの抽選自体を
 * 廃止したため）。目的の分類が出るまで rarityBoost=25（揺らぎの増幅）で棄却サンプリングする。
 * rarity は今も Item.rarity に残っているが、意味は「格付け」ではなく「どれだけ揺らいでいるか」
 * （静/揺/荒/反転あり）。generateItem 自体のシグネチャは再設計の前後で変わっていない
 */
export function rollUntilRarity(rng: Rng, slot: Slot, rarity: Rarity, itemLevel: number, foundDepth: number, now: number, attempts = 80): Item {
  let last: Item | undefined;
  for (let i = 0; i < attempts; i++) {
    const item = generateItem(rng, { itemLevel, slot, rarityBoost: 25, foundDepth, now });
    last = item;
    if (item.rarity === rarity) return item;
  }
  // 目的の rarity に届かなくても、引けた中で最後のものを使う（unique が存在しない slot 等）
  return last!;
}

/**
 * 色を指定して性質を組み立てた装備アイテムを 1 個作る（generateItem は色を選べないため自前で組む）。
 * colors を巡回させながら loot/generator.ts の rollTraitOfColor で性質を埋める。
 * MAX_FOUND_TRAITS 枠すべて埋めて、装備の色の偏り（単色 / 2 色 / 5 色）を狙いどおりにする
 */
export function buildColoredItem(rng: Rng, slot: Slot, colors: readonly TraitColor[], depth: number, foundDepth: number, now: number): Item {
  const base = rollBase(rng, slot, depth);
  const opts: TraitRollOptions = { depth, foundDepth };
  const used = new Set<string>();
  const affixes: AffixRoll[] = [];
  for (let i = 0; i < MAX_FOUND_TRAITS; i++) {
    const color = colors[i % colors.length]!;
    const roll = rollTraitOfColor(rng, slot, color, used, opts);
    if (roll === undefined) continue;
    affixes.push(roll);
    used.add(roll.key);
  }
  const margin = rollMargin(rng, affixes.length);
  const implicit = rollImplicit(rng, base);
  const item: Item = {
    id: makeItemId(rng.int(0, UINT32_MAX), now),
    seed: rng.int(0, UINT32_MAX),
    baseKey: base.key,
    slot,
    rarity: fluxClassOf(affixes),
    itemLevel: depth,
    name: "",
    implicit,
    affixes,
    foundDepth,
    foundAt: now,
    provenance: createEmptyProvenance(),
    margin,
    marginMax: margin,
    milestones: [],
    buds: [],
    budOffer: null,
  };
  item.name = nameItem(item);
  return item;
}

// ---------------------------------------------------------------------------
// QA 標準ビルドのスキル装備（docs/COMBAT_DESIGN.md B-7「QA bot の標準ビルド」）
// ---------------------------------------------------------------------------

/**
 * 近接（旋風斬り）/ 遠隔の帯（撃ち抜き）/ 踏み込み（突進斬り）/ 照準地点の範囲（炸裂玉）の 4 種の技で、
 * 間合い（近接 / 遠隔）と照準（自分 / 照準地点）を両方カバーする（段取り 7c で手書きの 4 種を技へ写した）。variants は空・links は 1 に固定し、刻印符・変異の乱数要素を増やさない
 * （bot の決定性・再現性を保つため。src/skills/persistence.ts の STARTER_STONES と同じ作り方）
 */
const QA_SKILL_LOADOUT: readonly { seed: number; skillKey: SkillStone["skillKey"] }[] = [
  { seed: 9001, skillKey: "commonWhirl" },
  { seed: 9002, skillKey: "commonRailshot" },
  { seed: 9003, skillKey: "commonLunge" },
  { seed: 9004, skillKey: "commonBomb" },
];

export function buildQaSkillProfile(): SkillProfile {
  const stones: SkillStone[] = QA_SKILL_LOADOUT.map(({ seed, skillKey }) => ({
    ...stoneFromSeed(seed, { foundDepth: 0, now: 0, skillKey }),
    variants: [],
    links: 1,
  }));
  return { version: 1, loadout: stones.map((s) => s.id), stones };
}
