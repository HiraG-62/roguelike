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
  "cavern:11:2": "daaf890ad3a04285/27049c49f8c35d48",
  "cavern:11:8": "3791ca4f2f4a2a26/de040a3a857601ba",
  "cavern:11:24": "7da98fe2b6a3b28e/788bd484d46fcaf7",
  "cavern:202:2": "8c529688c2367d3b/966706eff42be694",
  "cavern:202:8": "750db6780b08c80b/e70cfc3c71ab75d1",
  "cavern:202:24": "8813bbc3c7fd1ab8/1f6ddf241416e246",
  "river:11:2": "e181c23449cf600c/93bdf0888775c5a8",
  "river:11:8": "0dd9c4e7e9c7a3d9/9e68d8c275ad3c7e",
  "river:11:24": "9ccfa3e3f63dc193/eececc6efc79cf53",
  "river:202:2": "8cf9b81a1f089e9e/34be7b569084ad81",
  "river:202:8": "c5d709a0f7eba868/f99aeb567fbcb815",
  "river:202:24": "de0c6bdd0d426294/58a0c9d02373fd19",
  "ring:11:2": "812ffefa9943fd6c/8a7efa610ac38cff",
  "ring:11:8": "c4142b07dd99e9bb/d2a9a2e7aef387ff",
  "ring:11:24": "8bbf4926ea7dea3f/b589154f7ee25cf7",
  "ring:202:2": "78e5569d3324652d/ed51a90850e52917",
  "ring:202:8": "b8890de6327b8ed4/b9e10ee35962fba8",
  "ring:202:24": "8796ba55484a9f0c/4b8004ccc5b59b28",
  "court:11:2": "c1dc163d34b6a462/03ef2268988f64ec",
  "court:11:8": "0325726727c18d24/d2dad12f805e9f66",
  "court:11:24": "5463f27f60870694/4dc5905d1a17e17e",
  "court:202:2": "449e75fe6b2bac72/11b2f5cdd3e59c3f",
  "court:202:8": "b8949fbc9910ca72/849c198be6b26dc0",
  "court:202:24": "ec98b22d14344e60/c00b994405ce710e",
  "drunk:11:2": "9c82d09b544a9299/fba1eb6ae177ed27",
  "drunk:11:8": "6b39b8df1b106d93/a80095b6b1f33f88",
  "drunk:11:24": "24eb7c49dd37feed/682fafe73a22868c",
  "drunk:202:2": "dabf483ef73d20a9/10f2c4d097ad70d3",
  "drunk:202:8": "6b05eb557aeb1f8c/c62aa9baad3e5b1a",
  "drunk:202:24": "27166e9e1bab316d/143612678c8e3697",
  "isle:11:2": "345c10e9a875a9bb/add9c6fe4edb7df4",
  "isle:11:8": "e58bc580b04f49af/9498df63501417d7",
  "isle:11:24": "92dc18c3cec11328/bd3390ca291a2b55",
  "isle:202:2": "5e90c3cf19e8f79e/7124614d9c309052",
  "isle:202:8": "f7428fc82878bdab/65f8ef4d58b80357",
  "isle:202:24": "12d80c5e669aed7c/fdb468cde819c6db",
  "terrace:11:2": "60f876d543b68342/b2d71018674ba9e9",
  "terrace:11:8": "e341b2bc38736082/f3f8b7e073c9c999",
  "terrace:11:24": "610e8619b1aaf79a/897735907e8abee4",
  "terrace:202:2": "fa36c41cfb6aff40/2390744b80434444",
  "terrace:202:8": "884baa52e1fe9d2b/e73dc0b8de508bb4",
  "terrace:202:24": "2454ce2c2a5fd868/0f3da8d7fb506242",
  "prefab:11:2": "24fa0793d671fe28/9c8df27778dc1621",
  "prefab:11:8": "9b0b52d1a4db8c89/13a24d746cfd60b6",
  "prefab:11:24": "9dccc1d10c7c5d1b/3ace3674d02d7385",
  "prefab:202:2": "a44e1ec5b84201d1/8d742a0ef95854c3",
  "prefab:202:8": "86966719432a4c1e/e886e4f0e3e66233",
  "prefab:202:24": "990388d65c4bcada/f9eaff5724d59e49",
  "legacy:11:2": "167510fc4911cb22/c9c6f71459f0e409",
  "legacy:11:8": "6cc97479c343416b/998e0090c4f62004",
  "legacy:11:24": "cb00314e1828e45c/80e4ceac793f7d6a",
  "legacy:202:2": "01100aa7039ea098/665470824b2e155f",
  "legacy:202:8": "9a5c2ef59ceff8e5/226438f0b1357276",
  "legacy:202:24": "83e12834c3b65d5f/61571d41ef66f85a",
  "lordHall:11:5": "4a137ca35f4aa72e/1bdc0e8007aeb141",
  "lordHall:11:10": "bdd7da20cc523a66/89d007616113f687",
  "lordHall:11:20": "5b4536a9326f33ba/046c8dbf2b6c790c",
  "lordHall:202:5": "84a0affa0b99236e/c176fcdf0f6aa072",
  "lordHall:202:10": "cb1e6884439b4bed/83976eb986dc9e2e",
  "lordHall:202:20": "ab6f9629ff845fbd/40cc7f04fb2575d0",
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
