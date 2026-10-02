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
  "cavern:11:8": "3e5193f01e4335d8/cba9bb7029371d4a",
  "cavern:11:24": "77aa2836103c1ce2/b848a1bc36ec4e16",
  "cavern:202:2": "2a7e03a73b34d7ba/443a4af2f14f64d3",
  "cavern:202:8": "2ca94d76610483e0/4739a269ef839ed4",
  "cavern:202:24": "190b5cc40e4cf109/50849d50f8667b8d",
  "river:11:2": "b8006d8aa9ecd100/3c35beea97296a7a",
  "river:11:8": "822f81886574ee9d/acd930fabf5504c8",
  "river:11:24": "c20502c2d2e7b46a/06d169284cc40424",
  "river:202:2": "49dfcc3bfbc41357/618c4f7d6cae518c",
  "river:202:8": "e035796279b2d1d5/acf85fc0648d364d",
  "river:202:24": "db523d532b5dcb52/045b1a7e4f65f38e",
  "ring:11:2": "e246b90315ccf1ff/da7a148c158c39a3",
  "ring:11:8": "ed052db23c1a54a8/2f578b5b7e5a33a5",
  "ring:11:24": "982fb1b2c74fc464/7293d0f790ae91fe",
  "ring:202:2": "1b46645ce5ea137d/fae3bf3d29023ad2",
  "ring:202:8": "7756e72e3bfe92d9/65a7ec64c7930182",
  "ring:202:24": "72d4a37e2527d0d0/7b9d7f94124da1c0",
  "court:11:2": "d9a8e02717562c4f/8cb2b675d57c9e58",
  "court:11:8": "e13d4ca73530a5fe/69722769a34257a8",
  "court:11:24": "12adfb5b8df828f0/391c3317b3125003",
  "court:202:2": "1577835486f37023/769fb2721df26096",
  "court:202:8": "e9025f398cd564fb/4d8e30c71fb7ab5f",
  "court:202:24": "a1104eb97733fd7e/ed06ff8f5eb6188f",
  "drunk:11:2": "e82437bb1cfb0c3d/db5287dc5dc3d6fe",
  "drunk:11:8": "ec880a8fb94d5a81/2200b3bb5dc11358",
  "drunk:11:24": "e801aba2057bede5/e05300a2337c44b2",
  "drunk:202:2": "f947045c8ae881bb/c87b97e45575bc16",
  "drunk:202:8": "11f1137def2298d7/b6a3f768318558e6",
  "drunk:202:24": "46be7e214bffa11d/bf3a3b71b35ec019",
  "isle:11:2": "a8ce9e7e7a23f0c0/c565ff1a434671af",
  "isle:11:8": "6d47853a84607a12/c0b0e4117eb9f64f",
  "isle:11:24": "2c247dcb3441eeb9/a56844b06f93f485",
  "isle:202:2": "2307af48c9d0ce47/20a92ef470c951a0",
  "isle:202:8": "2d54728f79fde56e/b76a230533fdfcd3",
  "isle:202:24": "291befabe1987517/543ce0928f8d9cf1",
  "terrace:11:2": "c99fa4c83f1a8f97/b83c8a8434905619",
  "terrace:11:8": "f9c70b766fa9e9f8/a38682ed2138b2af",
  "terrace:11:24": "ee1456076f7725ea/3c75e1d621dde1ec",
  "terrace:202:2": "bb41c337cb3c2160/b5cb754a6b763b77",
  "terrace:202:8": "48081e30e16ba195/1ae18ebcb9c2f51b",
  "terrace:202:24": "b0d38c095d2933db/7ea49d65cc01ddfd",
  "prefab:11:2": "2aaedb15105e56c5/287324371806cc8b",
  "prefab:11:8": "cf4282e4a60de39f/0d701bfbafc69d40",
  "prefab:11:24": "98c7eae9f2387b1e/a0912349a6ccdd3a",
  "prefab:202:2": "ec64ba1764e3fe73/2985f97615c8830a",
  "prefab:202:8": "ddfe0273db3c96f8/1d328c8e314c0f55",
  "prefab:202:24": "2540dd5f66ce0df0/3bd85e2a13493475",
  "legacy:11:2": "c2edda869de8dad1/ed1b8a3afe860052",
  "legacy:11:8": "046736d880d8ebe9/6662e45f0a8b0c2d",
  "legacy:11:24": "ec71192ef7b47656/edcf5adb8eca3ab0",
  "legacy:202:2": "8853965ba0d1451d/9032eb70e1d583bf",
  "legacy:202:8": "3d6f8785ab83add4/b16123564a7e0d69",
  "legacy:202:24": "38c48d15614eb50a/fff5bde8478060e3",
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
