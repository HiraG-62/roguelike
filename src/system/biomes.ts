import type { Rng } from "../core/rng";
import type { FloorKind, GameState } from "../core/state";
import type { TerrainKind } from "../core/terrain";
import type { EnemyDef } from "../data/enemies";
import { FLOOR_KIND } from "../data/tuning";
import type { MapShape } from "../map/generator";
import { TILE_SIZE, Tile, getTile, inBounds, toIndex } from "../map/grid";
import { isBossDepth } from "./boss";
import { hasMod } from "./runSetup";
import { placeTerrain } from "./terrain";

/**
 * フロア種別とバイオーム（docs/ideas/run-expansion.md 1 章）。1 フロア = 形（回廊 / 洞窟）× テーマ。
 * テーマごとに 地形の配置 / 出やすい敵ファミリー / 色調 / 抽選の深度 を持つ。数値は tuning の FLOOR_KIND
 */

export const FLOOR_KINDS: readonly FloorKind[] = ["rooms", "cave", "dark", "forge", "ossuary", "swamp", "glacier", "mine", "meadow"];

interface TerrainWeight {
  kind: TerrainKind;
  weight: number;
}

export interface BiomeDef {
  /** 表示名（HUD・階段の行き先・ログ） */
  label: string;
  shape: MapShape;
  /** 部屋に置く地形の塊（空なら置かない） */
  terrain: readonly TerrainWeight[];
  /** 出やすい敵（ENEMIES の key）。重みが FLOOR_KIND.familyMul 倍になる */
  family: readonly string[];
  /** 床に重ねる色調（null は重ねない） */
  tint: string | null;
}

export const BIOMES: Readonly<Record<FloorKind, BiomeDef>> = {
  rooms: { label: "回廊", shape: "rooms", terrain: [], family: [], tint: null },
  cave: { label: "洞窟", shape: "cave", terrain: [], family: [], tint: null },
  dark: { label: "暗闇", shape: "rooms", terrain: [], family: [], tint: null },
  forge: {
    label: "熔鉱炉",
    shape: "rooms",
    terrain: [
      { kind: "lava", weight: 3 },
      { kind: "oil", weight: 1 },
    ],
    family: ["fireSlime", "lavaGolem", "fuseRat", "bomber", "multiBomber", "wisp", "ashBat"],
    tint: "#ff5020",
  },
  ossuary: {
    label: "骨の墓所",
    shape: "rooms",
    terrain: [{ kind: "bog", weight: 1 }],
    family: ["skeleton", "boneBoar", "scavenger", "graveBell", "boneConductor", "curseEye", "shadowBat"],
    tint: "#c8bea0",
  },
  swamp: {
    label: "沼",
    shape: "cave",
    terrain: [
      { kind: "bog", weight: 3 },
      { kind: "water", weight: 2 },
      { kind: "grass", weight: 1 },
    ],
    family: ["poisonSlime", "carrionFly", "sproutSlime", "slime", "manaLeech", "curseEye"],
    tint: "#50a040",
  },
  glacier: {
    label: "氷窟",
    shape: "cave",
    terrain: [
      { kind: "ice", weight: 3 },
      { kind: "water", weight: 1 },
    ],
    family: ["iceSlime", "frostEye", "frostGolem", "frostWisp", "frostCrusher", "crystalGolem", "crystalMite"],
    tint: "#80c8ff",
  },
  mine: {
    label: "油の坑道",
    shape: "rooms",
    terrain: [
      { kind: "oil", weight: 3 },
      { kind: "water", weight: 1 },
    ],
    family: ["bomber", "multiBomber", "fuseRat", "golem", "crystalMite", "spikeRat", "hornBeetle"],
    tint: "#8a6a40",
  },
  meadow: {
    label: "草原",
    shape: "cave",
    terrain: [
      { kind: "grass", weight: 4 },
      { kind: "water", weight: 1 },
    ],
    family: ["wolf", "packLeader", "boar", "spikeRat", "hornBeetle", "sproutSlime", "bat"],
    tint: "#90d060",
  },
};

export function floorKindLabel(kind: FloorKind): string {
  return BIOMES[kind].label;
}

export function biomeShape(kind: FloorKind): MapShape {
  return BIOMES[kind].shape;
}

// -----------------------------------------------------------------------------
// 抽選（深度の規則）
// -----------------------------------------------------------------------------

export function isCaveDepth(depth: number): boolean {
  return depth >= FLOOR_KIND.caveMinDepth && depth % FLOOR_KIND.caveInterval === FLOOR_KIND.caveRemainder;
}

/**
 * この深度で出せるフロア種別。ボス階は boss.ts が「最後の部屋」を前提にしているので rooms だけ。
 * 洞窟の周期の階は洞窟の形のものだけ（洞窟・沼・氷窟・草原）
 */
export function floorKindCandidates(depth: number): FloorKind[] {
  if (isBossDepth(depth)) return ["rooms"];
  const open = FLOOR_KINDS.filter((k) => depth >= FLOOR_KIND.biomeMinDepth[k]);
  if (isCaveDepth(depth)) return open.filter((k) => BIOMES[k].shape === "cave");
  return open.filter((k) => k !== "cave");
}

/** 候補が 1 つなら乱数を消費しない（浅い階・ボス階の乱数消費を増やさない） */
export function chooseFloorKind(depth: number, rng: Rng): FloorKind {
  return pickFloorKinds(depth, rng, 1)[0] ?? "rooms";
}

/** 重複なしで count 個まで選ぶ（分岐路の行き先）。候補が足りなければ候補の数だけ */
export function pickFloorKinds(depth: number, rng: Rng, count: number): FloorKind[] {
  const pool = floorKindCandidates(depth);
  const picks: FloorKind[] = [];
  while (picks.length < count && pool.length > 0) {
    const index = pool.length === 1 ? 0 : weightedIndex(rng, pool.map((k) => FLOOR_KIND.weight[k]));
    const [kind] = pool.splice(index, 1);
    if (kind) picks.push(kind);
  }
  return picks;
}

function weightedIndex(rng: Rng, weights: readonly number[]): number {
  const total = weights.reduce((s, w) => s + w, 0);
  let roll = rng.next() * total;
  for (let i = 0; i < weights.length; i++) {
    roll -= weights[i] ?? 0;
    if (roll < 0) return i;
  }
  return weights.length - 1;
}

// -----------------------------------------------------------------------------
// 敵の出現表
// -----------------------------------------------------------------------------

/**
 * バイオームでの出現の重み。EnemyDef.biomeWeight（個別の上書き）→ バイオームのファミリー → 通常の重み。
 * ファミリーに入っていない敵も出る（出現表を狭めすぎない）
 */
export function biomeEnemyWeight(def: EnemyDef, kind: FloorKind): number {
  const override = def.biomeWeight?.[kind];
  if (override !== undefined) return def.weight * override;
  return BIOMES[kind].family.includes(def.key) ? def.weight * FLOOR_KIND.familyMul : def.weight;
}

// -----------------------------------------------------------------------------
// 地形の配置
// -----------------------------------------------------------------------------

function pickTerrain(rng: Rng, list: readonly TerrainWeight[]): TerrainKind | null {
  if (list.length === 0) return null;
  return list[weightedIndex(rng, list.map((t) => t.weight))]?.kind ?? null;
}

/**
 * バイオームの地形を部屋に置く（消えない）。skip の部屋（開始・最後の部屋）には置かない。
 * placeTerrain（system/terrain.ts）を通すので、後から入る自然配置はここで置いたセルを上書きしない
 */
export function placeBiomeTerrain(state: GameState, skip: ReadonlySet<number>): void {
  const biome = BIOMES[state.floorKind];
  if (biome.terrain.length === 0) return;
  const perRoom = FLOOR_KIND.patchesPerRoom * (hasMod(state, "roughLand") ? 2 : 1);
  state.rooms.forEach((room, i) => {
    if (skip.has(i)) return;
    const r = room.rect;
    if (r.w < 3 || r.h < 3) return;
    for (let n = 0; n < perRoom; n++) {
      const kind = pickTerrain(state.rng, biome.terrain);
      if (!kind) continue;
      const x = (state.rng.int(r.x + 1, r.x + r.w - 2) + 0.5) * TILE_SIZE;
      const y = (state.rng.int(r.y + 1, r.y + r.h - 2) + 0.5) * TILE_SIZE;
      const radius = state.rng.int(FLOOR_KIND.patchRadiusMin, FLOOR_KIND.patchRadiusMax) * (kind === "lava" ? FLOOR_KIND.lavaRadiusMul : 1);
      placeTerrain(state, x, y, kind, radius, 0);
    }
  });
}

/** 骨の墓所: 部屋に最初から死骸を転がしておく（骨拾い・墓守の鐘・貪食のが使う） */
export function placeOssuaryCorpses(state: GameState, skip: ReadonlySet<number>): void {
  if (state.floorKind !== "ossuary") return;
  state.rooms.forEach((room, i) => {
    if (skip.has(i)) return;
    const r = room.rect;
    for (let n = 0; n < FLOOR_KIND.ossuaryCorpses; n++) {
      const tx = state.rng.int(r.x + 1, Math.max(r.x + 1, r.x + r.w - 2));
      const ty = state.rng.int(r.y + 1, Math.max(r.y + 1, r.y + r.h - 2));
      if (!inBounds(state.map, tx, ty) || getTile(state.map, tx, ty) !== Tile.Floor) continue;
      if (room.tiles && !room.tiles.has(toIndex(state.map, tx, ty))) continue;
      state.corpses.push({
        id: state.nextId++,
        defKey: "skeleton",
        pos: { x: (tx + 0.5) * TILE_SIZE, y: (ty + 0.5) * TILE_SIZE },
        roomIndex: i,
        time: FLOOR_KIND.ossuaryCorpseTime,
        depth: state.depth,
      });
    }
  });
}
