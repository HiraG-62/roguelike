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
 *   / 2026-10-03 銃の弾倉 `Player.magazine` を足し、戦意の `window`（旧短銃の装填の窓）を外した（state の形だけが変わった。旧い形に写すと変更前の指紋と一致を確かめた）
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
  "cavern:11:2": "4ddec076c812eae0/39117439d6820ec1",
  "cavern:11:8": "1b7295c7d16fbc16/e3f6270668107d84",
  "cavern:11:24": "23fd585e582bc91d/8d24a10c11d6e2e9",
  "cavern:202:2": "b4f4041c8890ce24/0f079c07e8177aa2",
  "cavern:202:8": "61735d28a9ea2f4a/c3961370aea79920",
  "cavern:202:24": "f56e940b0708abfa/307fc9cded389585",
  "river:11:2": "7fd92fe0f6b155c9/44cdf2a0f850055c",
  "river:11:8": "6dccc63b70396367/5ef65e76421e4c20",
  "river:11:24": "e63bd2db9b8e6640/7c8698f6339cdb34",
  "river:202:2": "663fb7f251c43704/b3e2c2384e4918a7",
  "river:202:8": "025216c4ed397033/5ee77342ef810030",
  "river:202:24": "dccfee210efe2ac1/874d092805812945",
  "ring:11:2": "b91ee89a027592bc/f3dc369981444049",
  "ring:11:8": "64f1a0631e37bba1/460f7f3b04cff72b",
  "ring:11:24": "58c7befeb9d49467/5b82abb320fe8ca0",
  "ring:202:2": "c2e8671974ec6a49/ebcd28b848d87c6c",
  "ring:202:8": "1b2ebeba4eb30fd1/bd2845db2486ccb4",
  "ring:202:24": "5975b995966c4adc/5e5ca12a4dfb1fb4",
  "court:11:2": "a091eb1ddc6c5c6d/56589fe06995dd76",
  "court:11:8": "9d8f7fabc81657ec/1ba63153f725b1d7",
  "court:11:24": "a3ee01af225864b6/fc68e5ed9d921862",
  "court:202:2": "26154bee47538a2e/29137bb2c7aeb549",
  "court:202:8": "2e9108ec17cdd829/bd17551b583a66b0",
  "court:202:24": "8edf23d5d0a16138/8aebdc40ff2d2ec2",
  "drunk:11:2": "3c3f609b5a1342b7/0c6e723e04e4ff5b",
  "drunk:11:8": "5005503b32f98635/4611b99aa2e78c2a",
  "drunk:11:24": "fed7c9a12d24dc45/ac180ba33d460742",
  "drunk:202:2": "8043831eabf7d538/e726e5dcf38b74da",
  "drunk:202:8": "f31eaa21d85f6de0/5c9d8cf6fd157613",
  "drunk:202:24": "a6bb0552e9f4d2aa/a1f928d75a7387af",
  "isle:11:2": "8be70ae9e7809902/b957ee664b223f79",
  "isle:11:8": "e4674a7c10b0ec3d/2c60de1311780e67",
  "isle:11:24": "14dd80ef60636d05/ff292976608903c3",
  "isle:202:2": "4b97155b2361c643/ddf82e75f413d7c3",
  "isle:202:8": "c9c584a3979ef3e4/fccedd81aa5d1e9c",
  "isle:202:24": "dd635687dade353c/944d25bd38dcc529",
  "terrace:11:2": "805b457de1d016d0/e6564f08e7cd1da8",
  "terrace:11:8": "08d02f58e9caf893/efda1e3c6a85f86c",
  "terrace:11:24": "ef2f1539afd4cd85/1c1f1f04002ef3da",
  "terrace:202:2": "bb42183c87d7119a/f4dfa08f7d78bd71",
  "terrace:202:8": "83d5acfeb5c44083/d5e46260397b8b3f",
  "terrace:202:24": "ac5df544362b616f/ac3ef90f1150b5d7",
  "prefab:11:2": "89384e5b442a9a0a/068f66a3875e7fe1",
  "prefab:11:8": "21db68c598ff275d/638ea244e460d8aa",
  "prefab:11:24": "3519c0e5b17883e7/fbeb369cc90d209e",
  "prefab:202:2": "332427656c3d38ba/866dc06a10941707",
  "prefab:202:8": "7e26eb054ac5dc81/d477c4040be9a13e",
  "prefab:202:24": "2c92426ec250ef3a/bbb80d07490e20c6",
  "legacy:11:2": "e46c8b582153fc4b/5acc1a6c7f343d57",
  "legacy:11:8": "a7d2bcc5562d8050/af0a9c6638466fbc",
  "legacy:11:24": "995abd5684057eee/5708134c8d85f4b8",
  "legacy:202:2": "ff7654ff549368a7/ebbb031eb2e735ca",
  "legacy:202:8": "1a7578bdaebf9fbf/f1ba376c1ad84320",
  "legacy:202:24": "de19f8644cde1fa9/97c2b76d8adc43a7",
  "lordHall:11:5": "24b91eeb8fb30e5e/4c58f5c8f3535290",
  "lordHall:11:10": "810a1094a51dd95c/287a51f5e2b12b72",
  "lordHall:11:20": "4f906ad5524e0d2e/32b24ddfd5dfd2ba",
  "lordHall:202:5": "5d73062a75440b92/f4e64c73e4d3ed19",
  "lordHall:202:10": "40ef0790725f0826/882fef2d5a5da176",
  "lordHall:202:20": "bb3edf8d9487440c/14173a1c807685cd",
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
