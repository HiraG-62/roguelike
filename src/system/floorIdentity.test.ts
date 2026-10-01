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
  "cavern:11:2": "74984db789e1f916/12de091b8c3fc113",
  "cavern:11:8": "77442398ead699b5/528b84d447bfaef2",
  "cavern:11:24": "0d41112bcfa58910/ec9db7ad124878ab",
  "cavern:202:2": "0383033a10ea0ec9/fea4ecd80f6592f1",
  "cavern:202:8": "02f7592b41cc06e6/3beb66da3667ecc4",
  "cavern:202:24": "10633db603ac730c/cfaaa8f1159455cc",
  "river:11:2": "6649ba6c3f686f45/48e586ba6c49621f",
  "river:11:8": "b8908ae584ef93e4/4ea78c8374dc023b",
  "river:11:24": "5b25a46f94b27158/d268f44ad4682d79",
  "river:202:2": "f72172ba227d09af/04c0eae99b351be9",
  "river:202:8": "43e12dd26422c574/49c0163f95d5eb77",
  "river:202:24": "c13acb6a1ed75261/6f375cde92f04928",
  "ring:11:2": "a9a754fec8106957/542cd3ce65893f85",
  "ring:11:8": "826876355a20610b/cc010ed8857d122f",
  "ring:11:24": "46397a5f8de019cf/e3ffd21492f70a55",
  "ring:202:2": "339cb84cc40660c6/2a645b2bbe648577",
  "ring:202:8": "0aea76654617fdaa/f8c8c1d3980ff956",
  "ring:202:24": "9fa45f229bb923e2/ef07b26b8fe2238e",
  "court:11:2": "5c3e73375ff029d1/a02357f6e36fd193",
  "court:11:8": "9061c6ea8fdbafb8/95805fa98cb56a47",
  "court:11:24": "0add79c1d31a5101/6117c87f33b55792",
  "court:202:2": "9e6062913fe71ef7/457a940c298be5cc",
  "court:202:8": "635bbd9877a473ab/f07e09e17ede66f1",
  "court:202:24": "f9173d63f092598b/6f364d207e006566",
  "drunk:11:2": "616f6f2e8dd40cde/defade20cd6bfb52",
  "drunk:11:8": "1e08a8b4de4fd185/cf0dedd8ebe71f52",
  "drunk:11:24": "66c2a42e81622196/e51e35ce91f222c8",
  "drunk:202:2": "e903729816972948/0e1da52753f24f7a",
  "drunk:202:8": "0fb343bd36ec5672/f509a02d3a7b1c36",
  "drunk:202:24": "4faac5ca6781e447/e37cd81e54d43e16",
  "isle:11:2": "e3212baa805beb15/3133cb5b6fbd5f41",
  "isle:11:8": "1f7e14ea9b00e4f0/f4bfeb0d04d0f576",
  "isle:11:24": "41005e1543b4b6ed/6ed9e76cb7f8e7e9",
  "isle:202:2": "4a3d88045b462e2e/61c2e5c92222fe7e",
  "isle:202:8": "dc57a2950d5202d3/f64919ee1c166979",
  "isle:202:24": "5e69e496e19e1d18/b2cac9286757d1f3",
  "terrace:11:2": "ff4d9ed17ef2ccb0/330b24b005f7f5e2",
  "terrace:11:8": "b5747b211bc605f7/7843ae076ad2450c",
  "terrace:11:24": "41dfb6e7094045ab/783320bc4def0ae0",
  "terrace:202:2": "f8b7d2d7d99eef5f/b59c8ab7972b3e32",
  "terrace:202:8": "5c3a8d1228da91c2/ea10775ec157c852",
  "terrace:202:24": "e232a74b4f78bc7f/6cc71c0ec4b7b333",
  "prefab:11:2": "9c0e55badd9fcfb5/394fb9e7f3a7dfc8",
  "prefab:11:8": "c46db5084f056086/83f5c5db26ae0095",
  "prefab:11:24": "7af11ae18b57f313/d4400c672346dde2",
  "prefab:202:2": "c31f466dcc29cde0/03ed081f57754ba2",
  "prefab:202:8": "dcee38a78a506b94/625f306fd49c7cf8",
  "prefab:202:24": "1e758194117f5e90/30f25732213aa312",
  "legacy:11:2": "f6e8a1b979554f67/8d3b7d1dbc2bc25a",
  "legacy:11:8": "f4ad0e95f4d65fed/494a340a6c10ad7e",
  "legacy:11:24": "39c61866831d4f2e/8a2691f84d37c4a4",
  "legacy:202:2": "368666f8371528a7/2efcff3564f9e0d8",
  "legacy:202:8": "cfaf273573187d5f/9f5ba43abb367901",
  "legacy:202:24": "878fa2fb84a3298b/2e9acc666724b83f",
  "lordHall:11:5": "f8db47b15f105047/578250327060f95c",
  "lordHall:11:10": "11cabf600a616030/5f64028225699144",
  "lordHall:11:20": "0861a08c5bab54c2/27b070da2629cfb7",
  "lordHall:202:5": "fa0e27f7fd9af94a/8c4d0f7a1bb98f32",
  "lordHall:202:10": "e3938cd4b7b005ca/3278dc941dd89df9",
  "lordHall:202:20": "0cc9bb74fca3e6a5/6d28182ba3b6e23b",
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
