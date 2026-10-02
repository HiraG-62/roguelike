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
 * 生成の中身を意図して変えたときは、ここの指紋を取り直す（落ちたテストのメッセージに新しい値が出る）。
 * 取り直した履歴: 2026-10-02 刻印符の手持ち `SkillRunState.hand` を state に足した（生成の中身は変わっていない。state の形だけが変わった）
 *   / 2026-10-02 台座の `armed` を外し（照準 + インタラクトで使う）、素の最大気力を 80 → 60 にした（地図・部屋・敵・品の値段・乱数の続きは変更前のコードと一致を確かめた。state の形と気力の値だけが変わった）
 *   / 2026-10-02 誓約 20 → 22（祭壇の誓約の候補が増え、選ばれる誓約だけが変わる。地図・部屋・敵・品の値段・乱数の続きは一致を確かめた）
 *   / 2026-10-02 スキル石の絵の出来事 `EffectsState.skills` を state に足した（state の形だけが変わった）
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
  "cavern:11:2": "d3880daabaabebcc/dabbb2c95ed4eef0",
  "cavern:11:8": "ed342d8f7aaccf2e/3a687f5a95880845",
  "cavern:11:24": "f8333a82b0afae9b/44b4bb4426a1d89e",
  "cavern:202:2": "a2b732f47402dbec/eea525af9a9fec99",
  "cavern:202:8": "4ee41bc4e65fcfe1/f1984c3c0d8de8d4",
  "cavern:202:24": "4d20bc036b8b85ca/57974c7d0fef3007",
  "river:11:2": "58a29ce025c49fa7/b32a22f440a7489b",
  "river:11:8": "693f8c676ecd9f23/875c811e82b53ef3",
  "river:11:24": "f2a1f4a30e521491/19cddf0e123a5095",
  "river:202:2": "ab33cfdae1a56444/47b119dc68bdedd6",
  "river:202:8": "78b60decc0062786/562dbaf6a4bee365",
  "river:202:24": "563f13213a6f016b/c0ca1830497f3b07",
  "ring:11:2": "18e92f3a7103888e/14c7fe1550388a7b",
  "ring:11:8": "7a822d774b27407f/0f4989679b341b1d",
  "ring:11:24": "82a0b58e18d0ebdd/661c8ccf7d4279cb",
  "ring:202:2": "3d9ee8e103cac6b2/6d949c88b7aa17be",
  "ring:202:8": "19f00466f3774cd9/7a83c163d5058d2f",
  "ring:202:24": "45441879c0da43fc/6db71076298cdcca",
  "court:11:2": "d67fb081117fe576/674343dc927e74f8",
  "court:11:8": "daa3c1e7df6b736e/1cb4882f0c59092d",
  "court:11:24": "348b47df38443e08/fb0c871d90d7c6ea",
  "court:202:2": "bf4a489e6ffd627d/08c76812ae1e9fea",
  "court:202:8": "6ab59fe89b19fee0/77578de71e815fa9",
  "court:202:24": "8f6b9a918a3968fa/295ebe8439f357fc",
  "drunk:11:2": "d05ad19b31144129/88ec7446650f89af",
  "drunk:11:8": "d3e80ebff7f367c6/c97619768ddf0484",
  "drunk:11:24": "9851d88da84aa3aa/057c62a758f6e540",
  "drunk:202:2": "73d345de525bca9d/d897aca4aab6fac2",
  "drunk:202:8": "3efc79797439cfb3/1886635a83e6aa87",
  "drunk:202:24": "9d662ebe02adc18f/fdc25d278589ede5",
  "isle:11:2": "4d1be92db702c677/6543309e905f3042",
  "isle:11:8": "223a5dccb8c01edc/6f66d94fee02d55b",
  "isle:11:24": "e22a890354549060/8e68fa0a4eca38ed",
  "isle:202:2": "e329ef0f664fcd6c/89719221d0abaef6",
  "isle:202:8": "b61b76f395e57fc7/683a18693c07dfd2",
  "isle:202:24": "15a7858772a50c60/d80bdccd09af0488",
  "terrace:11:2": "39712cf9fd61e31a/a20410187dc0d743",
  "terrace:11:8": "b22642e85edd62da/51725ca06a756d44",
  "terrace:11:24": "6b548dfdd81d0892/19f22850794c57e6",
  "terrace:202:2": "a5fc1048b2f377a9/d3b13f3fb72188da",
  "terrace:202:8": "3d094d52759c7afe/ea6f0d1818448df3",
  "terrace:202:24": "37311838e88345db/6ac8d7f7c309cd95",
  "prefab:11:2": "a39cb8339bc0f6e9/4b21823380783cb8",
  "prefab:11:8": "49e09dd59e6c28f9/64e838f4f4952916",
  "prefab:11:24": "2576dcd5f962ebdc/45234678b7ce2728",
  "prefab:202:2": "6cbc37c960527bb1/126d0ad2ed2fc63c",
  "prefab:202:8": "18c69efdcc5fe7f7/5c23e9c40792df57",
  "prefab:202:24": "b86eee363d936ad5/700a12b7935ecc54",
  "legacy:11:2": "838917280a4ef953/be1025746205e642",
  "legacy:11:8": "a1f1b25dcb65778d/6b27ce7a67de4fa7",
  "legacy:11:24": "6938fb8e42c0c70b/9cd3be6c965c55e9",
  "legacy:202:2": "3abfc6270d67fd53/c3fbd076d62f8bf2",
  "legacy:202:8": "23286f19179bcf9e/292066307d7616e1",
  "legacy:202:24": "f18522e07962d5a4/03985ec1f04bbf57",
  "lordHall:11:5": "5cd0f163e6fcac5f/f01b6814fbb1d85c",
  "lordHall:11:10": "d215f66c5d70d207/09601235aef949eb",
  "lordHall:11:20": "65f3a2ed8ca96155/2f28ac1f1acf37fc",
  "lordHall:202:5": "daeb103aba675573/10e937ffe8c32314",
  "lordHall:202:10": "a78571d084b797a4/3ca12635381d7970",
  "lordHall:202:20": "01d7ea6dbd7917bf/90152724bef5adef",
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
