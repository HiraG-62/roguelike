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
 *   / 2026-10-03 三点の続き `Player.shotBurst` を `{ queue, side }` にした（state の形だけが変わった。旧い形に写すと変更前の指紋と一致を確かめた）
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
  "cavern:11:2": "e974116d579e05d7/de35cef2d63f9a85",
  "cavern:11:8": "7fc10a582517f52f/c271194b4bc3f330",
  "cavern:11:24": "6883e9add1a68dc6/afb6520b9f8a12f9",
  "cavern:202:2": "6addbaddf6691bc2/ec8eceac3e8957b9",
  "cavern:202:8": "d700a6a76f0eb308/0c7763ab3ac65fe3",
  "cavern:202:24": "7b58bc946f26fd58/e2afa87edbf63c76",
  "river:11:2": "625342399630a925/a46c3f7dadbeb720",
  "river:11:8": "d261f432b02e5288/24344d1bd7a8f136",
  "river:11:24": "8f2ec604ff9458ac/61ce06adb5a3c842",
  "river:202:2": "a738fb9563af7e6b/fa5a7b8d40e25e3e",
  "river:202:8": "c7111b67a2c42cb8/f64832dfc89ec375",
  "river:202:24": "1267d9a2f8f24c21/a6cc59b9b579063b",
  "ring:11:2": "81ef53270f3babba/3b364cbcaaea91fb",
  "ring:11:8": "bca9b320150cb9f3/e28161da61a886ef",
  "ring:11:24": "fe130dd9938ca226/f2a27198db8b978f",
  "ring:202:2": "fc953786c5d79acf/0d6a1ad542f29d3c",
  "ring:202:8": "385af33be185d008/37b9f404b987230e",
  "ring:202:24": "f7e4b1be57d382d7/632232cb754fd082",
  "court:11:2": "f03a1e22aadccddb/58efead7a6a9d074",
  "court:11:8": "6a9bd48a75c6c0dd/6e0b958698e4c301",
  "court:11:24": "07989094403043b7/c32249deec8d103d",
  "court:202:2": "3d55a10d10eb4690/2e152e33fe368eed",
  "court:202:8": "fe15176712cb2e7c/b9d4a9a0fd0dd2f2",
  "court:202:24": "dec6ee8c4a7ef3ef/47c938990b81d780",
  "drunk:11:2": "ac5e4938b63f2044/1319b4716208a8ee",
  "drunk:11:8": "fafe41eea1a5dabe/b678c89739efeb4c",
  "drunk:11:24": "b1784cf837aa9d71/19d460ead6478216",
  "drunk:202:2": "2e12fd790d93efba/6e231809daaf1a57",
  "drunk:202:8": "8da69dae72de9878/02fed1c1337bed5b",
  "drunk:202:24": "da4f1f7f1531e9b5/588a8ebca062d166",
  "isle:11:2": "0cbec38a7ed8be71/200ff13b4c2e410f",
  "isle:11:8": "9a96c321776a7b1c/9035ed00fbea113e",
  "isle:11:24": "c4570fbe31285fe2/8d0e03cdd1630714",
  "isle:202:2": "89ca6c6a54dabb34/65368c1613a199fb",
  "isle:202:8": "857276865e74aede/c1b57c78d77783e7",
  "isle:202:24": "249777de75c775ae/968f490e4ebfe97f",
  "terrace:11:2": "216bfe3060757cf5/bd64b3955c883ca6",
  "terrace:11:8": "4058329b168542c9/a8028783e747cd97",
  "terrace:11:24": "e0232f1edf50e87e/b213f1b9c99a73bd",
  "terrace:202:2": "58f61699251a39a2/3a8a136ea84d3630",
  "terrace:202:8": "38654155519f3da0/3e3531db760d04bc",
  "terrace:202:24": "ac3ce8379dd84eee/1d8e89baac7e6d8f",
  "prefab:11:2": "595dfb7add67fac6/b9441dca146a6c04",
  "prefab:11:8": "1cbada68834bf75f/9c8ea719182ae8a6",
  "prefab:11:24": "c834a580e7d59394/dbc71d5102e4b3c5",
  "prefab:202:2": "1818752ed2eb9e81/484cbabbe98d9eb2",
  "prefab:202:8": "c7fa064c6d2886e6/51fc89bf720789f3",
  "prefab:202:24": "ed718d5bd31f6d30/8298039a6a8dc691",
  "legacy:11:2": "487f4de34fb5e3e3/0a8267d74d7add9e",
  "legacy:11:8": "4ad1c54eedbc52e6/388175d16861320b",
  "legacy:11:24": "405cf1217c94a45a/9588fd811d61ca45",
  "legacy:202:2": "73d1ab6207035428/44d34ac73d8242d0",
  "legacy:202:8": "2d12d980da2e2042/5fa5b52fe0159fd9",
  "legacy:202:24": "7a7bce35e11eb94b/3f4829d03379faf0",
  "lordHall:11:5": "40bfc15e4f0aec7e/8693d66d090fd600",
  "lordHall:11:10": "0c557e7fefb6ca01/55e2fbc2719d0ee1",
  "lordHall:11:20": "a2e08448601d106d/88a2907434265262",
  "lordHall:202:5": "17a610f972cf3b8e/ce4873648ae8467d",
  "lordHall:202:10": "ad170d1328dbf047/ab97807cc124051d",
  "lordHall:202:20": "ff8c8edc7961237d/8fdda53bdfcb7f42",
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
