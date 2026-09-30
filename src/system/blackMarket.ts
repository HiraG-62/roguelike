import { type GameState, type HiddenRoom, type WareKind, allocId, pushSfx } from "../core/state";
import type { Vec } from "../core/vec";
import { ECONOMY, LOOT_DROP } from "../data/tuning";
import { TILE_SIZE } from "../map/grid";
import { affixDef, isConversionKey, keystoneDef } from "../loot/affixes";
import { fluxClassOf, rollInvertedFlux } from "../loot/flux";
import { generateItem, refluxTrait } from "../loot/generator";
import { nameItem } from "../loot/names";
import type { Item } from "../loot/types";
import { SKILL_DEFS, SKILL_MIN_DEPTH } from "../skills/data";
import { generateSkillStone } from "../skills/generator";
import { SKILL_KEYS, type SkillKey } from "../skills/types";
import { ownsSkillStone } from "./jobs";
import { altarKeystoneCandidates, refreshRunStats } from "./runSetup";

/**
 * 闇市（MerchantKind "blackMarket"。docs/ideas/economy-impl.md 2-5）の置き場所と品。
 * 隠し部屋（system/hiddenRoom.ts）が開いた瞬間にポケットの中に立つ。品は闇市にしか無い 3 種:
 * 未所持のスキル石 / 反転の遺物（反転した性質を必ず持つ遺物）/ 誓約 1 つ（祭壇と同じ候補）。
 * 商人の体・台座・値段は system/merchants.ts
 */

// -----------------------------------------------------------------------------
// 置き場所（ポケットの中。乱数なし）
// -----------------------------------------------------------------------------

type PocketTile = { index: number; along: number; off: number; d2: number };

/** 扉から見たポケットのタイル: 扉からの奥行き along・扉 → 階段の線からの横ずれ off・扉からの距離の 2 乗 */
function pocketTiles(width: number, hr: Readonly<HiddenRoom>): PocketTile[] {
  const dx = hr.doorTile % width;
  const dy = Math.floor(hr.doorTile / width);
  // 階段は扉の正面の奥（map/hidden.ts の tryPocket）。扉と同じ行なら横に掘ったポケット
  const horizontal = Math.floor(hr.stairsTile / width) === dy;
  return hr.tiles
    .filter((t) => t !== hr.stairsTile)
    .map((index) => {
      const tx = index % width;
      const ty = Math.floor(index / width);
      const along = horizontal ? Math.abs(tx - dx) : Math.abs(ty - dy);
      const off = horizontal ? ty - dy : tx - dx;
      return { index, along, off, d2: (tx - dx) ** 2 + (ty - dy) ** 2 };
    });
}

function tileCenter(width: number, index: number): Vec {
  return { x: ((index % width) + 0.5) * TILE_SIZE, y: (Math.floor(index / width) + 0.5) * TILE_SIZE };
}

function tileDist(width: number, a: number, b: number): number {
  return Math.hypot((a % width) - (b % width), Math.floor(a / width) - Math.floor(b / width));
}

/** 扉のすぐ内側（奥行き 1）には台座を置かない（入った瞬間に買ってしまわないように） */
const MIN_ALONG = 2;

/**
 * 闇市の立ち位置と台座（最大 n 個）。台座は扉 → 階段の通り道（横ずれ 0）と入口の 1 列を避け、扉に近い順に
 * offerSpacing タイル以上離して選ぶ（触れて 2 つ同時に買わないように）。商人は残りのうち扉から最も遠いタイル。
 * 置けなければ null
 */
export function pocketStall(width: number, hr: Readonly<HiddenRoom>, n: number): { stand: Vec; offers: Vec[] } | null {
  const tiles = pocketTiles(width, hr).sort((a, b) => a.d2 - b.d2 || a.index - b.index);
  const picked: number[] = [];
  for (const t of tiles) {
    if (picked.length >= n) break;
    if (t.off === 0 || t.along < MIN_ALONG) continue;
    if (picked.some((p) => tileDist(width, p, t.index) < ECONOMY.market.offerSpacing)) continue;
    picked.push(t.index);
  }
  const stand = [...tiles].reverse().find((t) => t.off !== 0 && !picked.includes(t.index));
  if (!stand) return null;
  return { stand: tileCenter(width, stand.index), offers: picked.map((i) => tileCenter(width, i)) };
}

// -----------------------------------------------------------------------------
// 品の細目
// -----------------------------------------------------------------------------

function isSkillKey(key: string): key is SkillKey {
  return (SKILL_KEYS as readonly string[]).includes(key);
}

/** 闇市に並べられるスキル石: この深度で出る種類のうち、まだ 1 つも持っていないもの */
export function unownedSkillKeys(state: GameState): SkillKey[] {
  const depth = Math.max(1, state.depth);
  return SKILL_KEYS.filter((k) => SKILL_MIN_DEPTH[k] <= depth && !ownsSkillStone(state.skills.profile, k));
}

/**
 * 品の細目を決める（スキル石: 未所持の種類から rng 1 回 / 誓約: 祭壇と同じ候補から rng 1 回 / それ以外は空）。
 * 候補が無い品は並べない（null）
 */
export function rollGoodKey(state: GameState, kind: WareKind): string | null {
  const pool = kind === "skill" ? unownedSkillKeys(state) : kind === "keystone" ? altarKeystoneCandidates(state) : null;
  if (pool === null) return "";
  if (pool.length === 0) return null;
  return state.rng.pick(pool);
}

/** 品札に添える細目の名前（スキル石・誓約だけ） */
export function goodDetailName(kind: WareKind, key: string): string | null {
  if (kind === "skill") return isSkillKey(key) ? SKILL_DEFS[key].name : null;
  if (kind === "keystone") return keystoneDef(key)?.name ?? null;
  return null;
}

// -----------------------------------------------------------------------------
// 渡す
// -----------------------------------------------------------------------------

/** 決めた種類のスキル石を床に置く（拾うと倉庫へ）。種類が壊れていれば何もしない */
export function dropChosenStone(state: GameState, key: string, pos: Vec): void {
  if (!isSkillKey(key)) return;
  // now は決定性に影響しない（id と foundAt の表示用）
  const stone = generateSkillStone(state.rng, { foundDepth: state.depth, now: Date.now(), skillKey: key, moveset: state.stats.moveset });
  state.skills.floorStones.push({ id: allocId(state), stone, pos: { ...pos }, bobTime: 0, warned: false });
  pushSfx(state, "lootRare");
}

/** 表の性質（変換・誓約・トリガーを除く）のうち最初のものを反転させる。名のある遺物は形を崩さないので触らない */
function invertOneTrait(item: Item, flux: number): void {
  if (item.namedKey !== undefined) return;
  const i = item.affixes.findIndex((r) => affixDef(r.key) !== undefined && !isConversionKey(r.key) && r.inverted !== true);
  const roll = item.affixes[i];
  if (!roll) return;
  item.affixes[i] = refluxTrait(roll, flux);
  item.rarity = fluxClassOf(item.affixes);
  item.name = nameItem(item);
}

/**
 * 反転の遺物を床に置く: cursedItemBoost の揺らぎで作り、反転した性質が無ければ 1 つを反転させる（rng は生成 + 反転の強さ 1 回）
 */
export function dropCursedItem(state: GameState, pos: Vec): Item {
  const depth = state.depth;
  const item = generateItem(state.rng, {
    itemLevel: depth + state.rng.int(0, LOOT_DROP.itemLevelSpread),
    rarityBoost: ECONOMY.market.cursedItemBoost,
    foundDepth: depth,
    // 決定性に影響しない（foundAt と id の表示用にだけ使われる）
    now: Date.now(),
    excludeNamed: state.lockedRelics,
  });
  const flux = rollInvertedFlux(state.rng);
  if (!item.affixes.some((r) => r.inverted === true)) invertOneTrait(item, flux);
  state.floorItems.push({ id: allocId(state), item, pos: { ...pos }, bobTime: 0 });
  pushSfx(state, "lootRare");
  return item;
}

/** その誓約を今立てられるか（祭壇と同じ: 装備・ランの誓約と排他グループがぶつからない、まだ立てていない） */
export function keystoneOpen(state: GameState, key: string): boolean {
  return altarKeystoneCandidates(state).includes(key);
}

/** 誓約を立てる（この探索の間）。立てられなければ false */
export function takeKeystoneWare(state: GameState, key: string): boolean {
  if (!keystoneOpen(state, key)) return false;
  state.runKeystones.push(key);
  refreshRunStats(state);
  return true;
}
