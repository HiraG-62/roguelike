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
  "cavern:11:2": "45bb164737b8cd5f/57a4f6a2641c74e7",
  "cavern:11:8": "7414de767017decc/9efcebd70cea9408",
  "cavern:11:24": "4a31ca9d317666b3/6e0f57a08e3d6934",
  "cavern:202:2": "2a7e03a73b34d7ba/443a4af2f14f64d3",
  "cavern:202:8": "22773e1069ca4bfb/e165a191d9758f8d",
  "cavern:202:24": "687a44d937ee4acb/cd4290e34984313f",
  "river:11:2": "b8006d8aa9ecd100/3c35beea97296a7a",
  "river:11:8": "8a73ba4d89d2eb95/c1016de149aaf481",
  "river:11:24": "5414f233321cd0c1/9ab6a7d40d05ad54",
  "river:202:2": "49dfcc3bfbc41357/618c4f7d6cae518c",
  "river:202:8": "199decd086d5591a/177731e61de36cae",
  "river:202:24": "bf9a2bbd9d862263/5c07324ba0105829",
  "ring:11:2": "e246b90315ccf1ff/da7a148c158c39a3",
  "ring:11:8": "232e16f1f8d777ff/f45f00da78ae5e45",
  "ring:11:24": "b82f679e04bca470/b341bdee5fa4e870",
  "ring:202:2": "1b46645ce5ea137d/fae3bf3d29023ad2",
  "ring:202:8": "f701071e46abc0ce/f1a9b910eed47842",
  "ring:202:24": "fc3704259339184c/c36d98938deea4a9",
  "court:11:2": "d9a8e02717562c4f/8cb2b675d57c9e58",
  "court:11:8": "085642e1385c0d57/d34f50c675f67309",
  "court:11:24": "fc57e9ab3b1d225d/391c3317b3125003",
  "court:202:2": "1577835486f37023/769fb2721df26096",
  "court:202:8": "3c02bb0d24b0bd56/1dbeae512e34b381",
  "court:202:24": "3c3d3c68298b18f6/11579cb3ee38bb44",
  "drunk:11:2": "e82437bb1cfb0c3d/db5287dc5dc3d6fe",
  "drunk:11:8": "39e58e1604ec4ef4/f652bede195d1359",
  "drunk:11:24": "a9cb1c1ebc54e784/93b2948abdf24e8f",
  "drunk:202:2": "f947045c8ae881bb/c87b97e45575bc16",
  "drunk:202:8": "1b8387b67f51a3d0/26b10646b8ddb596",
  "drunk:202:24": "6120264f1abf490d/2bbb2e28398409ae",
  "isle:11:2": "a8ce9e7e7a23f0c0/c565ff1a434671af",
  "isle:11:8": "4ef771c92ac3c890/38bc8090b4b804c2",
  "isle:11:24": "0e5d22428c56871f/58a7c5860eb05ec0",
  "isle:202:2": "2307af48c9d0ce47/20a92ef470c951a0",
  "isle:202:8": "f1cc0c2ce8301ff8/206c1fbbfded8434",
  "isle:202:24": "1975fd3ab5e1e18a/dbb66d20b8ef066a",
  "terrace:11:2": "c99fa4c83f1a8f97/b83c8a8434905619",
  "terrace:11:8": "3a1df474014b2e7b/42dc8584496b1f8c",
  "terrace:11:24": "1ec9acadf8546c2c/a7cd4450c55a9229",
  "terrace:202:2": "bb41c337cb3c2160/b5cb754a6b763b77",
  "terrace:202:8": "ee65c0e748a272f9/b06675c5a1244d67",
  "terrace:202:24": "31d00933f1a48aeb/4953f019a088c6f1",
  "prefab:11:2": "2aaedb15105e56c5/287324371806cc8b",
  "prefab:11:8": "5c4dfad1d5d9c16d/8227df36887862da",
  "prefab:11:24": "d909ce8dbf0fde4e/05409f46962c0599",
  "prefab:202:2": "ec64ba1764e3fe73/2985f97615c8830a",
  "prefab:202:8": "fc2466ef65458b70/d173635af3f37137",
  "prefab:202:24": "1bf82778b8ba788e/7dd1fee8fe155510",
  "legacy:11:2": "c2edda869de8dad1/ed1b8a3afe860052",
  "legacy:11:8": "99a822138fe496c2/b5e9d5c8fb0805a7",
  "legacy:11:24": "6f0c6918be232c16/edcf5adb8eca3ab0",
  "legacy:202:2": "8853965ba0d1451d/9032eb70e1d583bf",
  "legacy:202:8": "6f4ba6fa54fdfc36/6847013524965902",
  "legacy:202:24": "0dbbb0d54149057a/fff5bde8478060e3",
  "lordHall:11:5": "d932a0f27b9a8c7e/d1b4a4e6a9a65696",
  "lordHall:11:10": "f32c921d5fc6d40c/6b84f2651306c25c",
  "lordHall:11:20": "3db4feda2362b489/d6c97bc47b7809b4",
  "lordHall:202:5": "e22428fdb0fbf216/8dbb2a039fea293a",
  "lordHall:202:10": "98a7710d5917d1d7/44921d15a4b1d9ca",
  "lordHall:202:20": "79aea8426e46627a/5a48be854d8afc16",
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
