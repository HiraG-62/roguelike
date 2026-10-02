import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGame } from "../core/game";
import type { GameState } from "../core/state";
import { withFixedLayout } from "../map/layout/select";
import { type FloorLayout, LAYOUT_KINDS } from "../map/layout/types";
import { defaultRunSetup } from "./runSetup";
import { buildFloor } from "./floor";

/**
 * 階の構築（buildFloor）の出力の同一性を縛る。速くするための書き換え（扉探し・陣の配置・型の生成器の内側）で
 * 地図・部屋・扉・敵の配置・乱数の消費が 1 ビットも変わらないことを、書き換え前のコードで取った指紋と比べて確かめる。
 * 指紋は createGame 直後と、続けてもう 1 階作った後の state 全体（関数を除く）と、rng の続きの 4 個から取る。
 * 生成の中身を意図して変えたときは、ここの指紋を取り直す（落ちたテストのメッセージに新しい値が出る）
 */

const SEEDS = [11, 202] as const;
/** 通常の階（章の 1 階目・章の中・深み） */
const PLAIN_DEPTHS = [2, 8, 24] as const;
/** ボス階（専用の部屋） */
const BOSS_DEPTHS = [5, 10, 20] as const;
const RNG_TAIL = 4;
/** 生成物の id / foundAt に入る実時間を固定する値 */
const FIXED_NOW = 1_700_000_000_000;

/** 装備の id（種-時刻-通し番号）。通し番号はモジュールの変数で、同じプロセスで先に回ったテストの数で変わる */
const ITEM_ID = /^([0-9a-z]+-[0-9a-z]+)-[0-9a-z]+$/;

/**
 * JSON に落とせない値（Set・Map・型付き配列）を配列にする。関数は JSON.stringify が落とす。
 * 装備の id は通し番号を落とす（テストを分離しないで回すと、他のテストが作った装備の数だけずれる）
 */
function plain(key: string, value: unknown): unknown {
  if (key === "id" && typeof value === "string") return value.replace(ITEM_ID, "$1");
  if (value instanceof Set) return { set: [...value] };
  if (value instanceof Map) return { map: [...value.entries()] };
  if (ArrayBuffer.isView(value)) return { typed: Array.from(value as unknown as ArrayLike<number>) };
  return value;
}

/** 2 本の FNV-1a（種を変えた 32bit）をつないだ 16 桁 */
function hash(text: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x5bd1e995) >>> 0;
    b = (b ^ (b >>> 13)) >>> 0;
  }
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}

/** state の指紋。rng の続きを引くので、取った後の state は使わない */
function fingerprint(state: GameState): string {
  const body = JSON.stringify(state, plain);
  const tail = Array.from({ length: RNG_TAIL }, () => state.rng.next()).join(",");
  return hash(`${body}|${tail}`);
}

/** layout に固定して depth から始め、createGame 直後と次の階の指紋を取る */
function fingerprints(layout: FloorLayout, seed: number, depth: number): string {
  return withFixedLayout(layout, () => {
    const first = createGame(seed, String(seed), undefined, undefined, { ...defaultRunSetup(), startDepth: depth });
    const firstPrint = hash(JSON.stringify(first, plain));
    first.depth += 1;
    buildFloor(first);
    return `${firstPrint}/${fingerprint(first)}`;
  });
}

/** 書き換え前のコードで取った指紋（key = 型:seed:深度） */
const EXPECTED: Readonly<Record<string, string>> = {
  "cavern:11:2": "4c6510b4c3dfa56e/c5cc033623cf5687",
  "cavern:11:8": "98927ec667155ac0/009cb8ac70d96f92",
  "cavern:11:24": "79cee904f4968c8d/a958120551ee9385",
  "cavern:202:2": "8182e16d2bb849e2/b22c30861a602598",
  "cavern:202:8": "3891b9f482aa51b6/3381942f71373a71",
  "cavern:202:24": "0da29db496eeb537/a8deba3b5a8086f1",
  "river:11:2": "74d2c6e129084355/1d23f6a0b5e29724",
  "river:11:8": "18b85e2df4ecebea/e9ca02e04fe45112",
  "river:11:24": "0833cbed36d71a36/755cece2f301e424",
  "river:202:2": "0937f9fcd9cf7589/bf980f5db25805a0",
  "river:202:8": "65dff1640da96a52/dd7d1701a200b932",
  "river:202:24": "4a2da97be965a895/ac1dcc68485e25c8",
  "ring:11:2": "9bdca6eafd8eba1a/f801df300b630df6",
  "ring:11:8": "dd1ecc69e3b2e703/bbb7eb42c01d18ab",
  "ring:11:24": "fc70cb3827609379/86afc6f539948512",
  "ring:202:2": "a519369a33757896/af2abad95ba4ca45",
  "ring:202:8": "fc5cf6342fcef56f/55e79c1362f71372",
  "ring:202:24": "7d6282e7bbb38adc/cf6df8727ba064f7",
  "court:11:2": "1266b7e31ca7cb8a/e15f5f34f2ac4957",
  "court:11:8": "c003b0b3f114d964/c22f6fec436263a6",
  "court:11:24": "f10913f66f7930ba/2a00a8d5f4adafe5",
  "court:202:2": "e4dc2518b3c03602/e94b929da211d576",
  "court:202:8": "860f1b327b9e640e/6380b50c4a078ad3",
  "court:202:24": "bb57f292e50b3e58/5f2ed932b9d99041",
  "drunk:11:2": "ac0c2885a042157c/c13607b1d29ce729",
  "drunk:11:8": "36378fd410ae5774/2bd3e56b11c57525",
  "drunk:11:24": "5f2d136a07b9f911/e3e441d1623272b4",
  "drunk:202:2": "30a875bda4ec8376/561e3bd7dfe2c5cb",
  "drunk:202:8": "81f8e0330d2be491/088b9d460b1d0b61",
  "drunk:202:24": "4efa0c14c18b7fc5/7671dd5d144efebe",
  "isle:11:2": "bc8553826e8573e0/66a0c36c9949479a",
  "isle:11:8": "b380ed292d8465d3/d5e0c318d1f0cd31",
  "isle:11:24": "772f21ede82a5382/1b7917cc0582c8bd",
  "isle:202:2": "e43204a500f8a5b9/d98d856b38fbb8b7",
  "isle:202:8": "cb534d19121433a8/bf79ee591bd0428e",
  "isle:202:24": "cb2a88527e5e4dae/397559bf845049be",
  "terrace:11:2": "3a053f00127b241f/96bb51ce5f6a73ac",
  "terrace:11:8": "0d82bfd2410cab4d/9fcf0351c7501bde",
  "terrace:11:24": "05118dcba0456fad/3e8b299f50fdc068",
  "terrace:202:2": "62c895fc4801a5d6/e4c3b472259c3143",
  "terrace:202:8": "66f2afe980e114f4/d5dd5b6404ed87bf",
  "terrace:202:24": "39d756ac3b803d7e/1448ee75c880280b",
  "prefab:11:2": "57a9f36d56620468/17c6e540dd1e536a",
  "prefab:11:8": "14a20751ddbd93ce/07c402d1aa1cb999",
  "prefab:11:24": "c4e001f83cb05825/4b1b3b8e30ac1c7d",
  "prefab:202:2": "f8498e548b645bc3/f9444e29b9e06e30",
  "prefab:202:8": "f3bd41c2d7cd2a91/a6a165a478415082",
  "prefab:202:24": "f43380ed0f6f6909/53157fc387fcf723",
  "legacy:11:2": "59573a25a3aa4c46/a548edffaec4444d",
  "legacy:11:8": "bf750ff0f9d60344/f90e6540507cf8b8",
  "legacy:11:24": "4bbc22c4c97f0774/f740e9f64f71a0fa",
  "legacy:202:2": "6c57810aecac382d/e6fa9cd82e9c0f2a",
  "legacy:202:8": "2f74855ab9042287/0d948aaa5f7470ab",
  "legacy:202:24": "655770db05a5dc4d/e4a368418d33169d",
  "lordHall:11:5": "ba93768c7ce43274/a639134b4ef286c3",
  "lordHall:11:10": "484b5a256113d5f1/886276a1dbe72add",
  "lordHall:11:20": "0165e8d9295e2740/55caacc166025d3c",
  "lordHall:202:5": "2e60ffe41e8a2fc2/d43ae4a36b450ce6",
  "lordHall:202:10": "ef226933d8c972e2/7ea37d595fb535ce",
  "lordHall:202:20": "2b0060a5a607e851/dff30b34a9692453",
};

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

describe("階の構築の出力の同一性", () => {
  beforeEach(() => {
    vi.spyOn(Date, "now").mockReturnValue(FIXED_NOW);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  for (const { layout, seed, depth } of cases()) {
    const key = `${layout}:${seed}:${depth}`;
    it(`${key} の地図・部屋・扉・敵・乱数の続きが変わらない`, () => {
      expect(fingerprints(layout, seed, depth), `${key} の指紋`).toBe(EXPECTED[key]);
    });
  }
});
