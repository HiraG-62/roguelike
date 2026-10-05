import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGame } from "../core/game";
import type { GameState } from "../core/state";
import { withFixedLayout } from "../map/layout/select";
import { type FloorLayout, LAYOUT_KINDS } from "../map/layout/types";
import { defaultRunSetup } from "./runSetup";
import { buildFloor } from "./floor";

/**
 * 階の構築（buildFloor）の決定性: 同じ seed・型・深度なら、地図・部屋・扉・敵の配置・乱数の続きまで同じになる。
 * 固定の指紋（ハッシュ）は持たない。バランスの数値を変えるたびに取り直しになるため（docs/TESTING.md）
 */
const SEEDS = [11, 202] as const;
const PLAIN_DEPTHS = [2, 8, 24] as const;
const BOSS_DEPTHS = [5, 10, 20] as const;
const RNG_TAIL = 4;
/** 生成物の foundAt に入る実時間を固定する値 */
const FIXED_NOW = 1_700_000_000_000;
/** 装備 ID の通し番号はモジュール共通なので、比較から除く。 */
const ITEM_ID = /^([0-9a-z]+-[0-9a-z]+)-[0-9a-z]+$/;

function plain(key: string, value: unknown): unknown {
  if (key === "id" && typeof value === "string") return value.replace(ITEM_ID, "$1");
  if (value instanceof Set) return { set: [...value] };
  if (value instanceof Map) return { map: [...value.entries()] };
  if (ArrayBuffer.isView(value)) return { typed: Array.from(value as unknown as ArrayLike<number>) };
  return value;
}

/** 同じ入力で作った階全体と、続く乱数列を比較する。 */
function floors(layout: FloorLayout, seed: number, depth: number): [string, string, number[]] {
  return withFixedLayout(layout, () => {
    const state: GameState = createGame(seed, String(seed), undefined, undefined, { ...defaultRunSetup(), startDepth: depth });
    const first = JSON.stringify(state, plain);
    state.depth += 1;
    buildFloor(state);
    const second = JSON.stringify(state, plain);
    const tail = Array.from({ length: RNG_TAIL }, () => state.rng.next());
    return [first, second, tail];
  });
}

interface Case {
  layout: FloorLayout;
  seed: number;
  depth: number;
}

function cases(): Case[] {
  const out: Case[] = [];
  for (const layout of [...LAYOUT_KINDS, "legacy"] as const) {
    for (const seed of SEEDS) for (const depth of PLAIN_DEPTHS) out.push({ layout, seed, depth });
  }
  for (const seed of SEEDS) for (const depth of BOSS_DEPTHS) out.push({ layout: "lordHall", seed, depth });
  return out;
}

describe("階の構築の決定性", () => {
  beforeEach(() => {
    vi.spyOn(Date, "now").mockReturnValue(FIXED_NOW);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  for (const { layout, seed, depth } of cases()) {
    const key = `${layout}:${seed}:${depth}`;
    it(`${key} は同じ seed から地図・部屋・扉・敵・乱数の続きを再現する`, () => {
      expect(floors(layout, seed, depth), `${key} の 2 回の階構築`).toEqual(floors(layout, seed, depth));
    });
  }
});
