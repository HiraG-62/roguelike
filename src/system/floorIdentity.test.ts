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
  "cavern:11:2": "8c4b25d268fcb648/cd99800de6acbedb",
  "cavern:11:8": "fdc4fd0da71077f6/18749364f8fd374f",
  "cavern:11:24": "d402df54485a998e/84a686934cd6680f",
  "cavern:202:2": "d5c7f846bf54a623/a4dc492f8c9cb854",
  "cavern:202:8": "e37c66a5b539bd38/ad35692e602c4caa",
  "cavern:202:24": "494d5bec86d25e90/ffa9f7b80dc7a603",
  "river:11:2": "663ee5b7e59bafb2/35c8ad4bc62c251a",
  "river:11:8": "025ef31e819599ad/dc3b5d324932a4dc",
  "river:11:24": "c39b4930b3fd13d5/612ef95f05129048",
  "river:202:2": "fb66a24aeac9fcf4/e914c718c2aa31d7",
  "river:202:8": "bd5680f56ee654a5/ff2d33637b83c8d7",
  "river:202:24": "0187a9ba39a9febe/6128f8b8cd872fef",
  "ring:11:2": "936900ee52a53a69/45f87153480227d6",
  "ring:11:8": "26a663a0298cedce/954490c3e26352fe",
  "ring:11:24": "ea83c973063878ff/b57ecdfba6f0b1e1",
  "ring:202:2": "797a80b9e37214f3/c660b3527d54b809",
  "ring:202:8": "64f97f7d16f4dae9/bfeed43f8bce7038",
  "ring:202:24": "0baa63c04b253937/0eca8f02f1920f2b",
  "court:11:2": "202854ee957a7c5e/16c204fa723d090b",
  "court:11:8": "92b761602d7cbb9f/743a6b5b20b98982",
  "court:11:24": "2953700484a17369/75acd628cd4950ef",
  "court:202:2": "a589889f489d580a/85e30abfad54f12f",
  "court:202:8": "97675848704a9173/37f8dcacbaabc532",
  "court:202:24": "1c83e86dd197fbaa/15a328fc3d7afd36",
  "drunk:11:2": "e4df79b60c9b6e31/1054cee7e9391f7a",
  "drunk:11:8": "c83dee6529f6b042/1572b06d99149f92",
  "drunk:11:24": "71541517cd0b3b57/8cade26522af51eb",
  "drunk:202:2": "a0010389c1732c4f/1d2154b10e7b0d84",
  "drunk:202:8": "a7e440f1f878f561/8a120e0127edbcf0",
  "drunk:202:24": "79a661dec05e475c/0c1ceb7945c2cd2d",
  "isle:11:2": "deda663dc18da5e0/94f68f2188248e25",
  "isle:11:8": "d1a2c2b08c92c0ca/d7c999f7d1c7d0aa",
  "isle:11:24": "b27391750ec2064f/5d7e7c7564e5547a",
  "isle:202:2": "6f5ac36f4b3c993d/4274e79b4e0e6bec",
  "isle:202:8": "d8a981191d7cf574/29bd901cd307b12f",
  "isle:202:24": "3298d3752f7ceadb/24f6966ddccc58fc",
  "terrace:11:2": "e6d30b9d7f3128a7/c69951ddbd27d2b4",
  "terrace:11:8": "7e09359f87a7a419/6e85a9f333587a39",
  "terrace:11:24": "19957f06ba20b207/4b1690358f34d823",
  "terrace:202:2": "d7ab0dba147fc1ad/1f6faeed15e6333a",
  "terrace:202:8": "dd77cd6ea1ddfb2e/4bd49c1e81798f15",
  "terrace:202:24": "bf7a7898ee8d4e86/ae08cdb4c7a6cd37",
  "prefab:11:2": "b73134bc51db52d1/befb735c5acbe0c9",
  "prefab:11:8": "48a0734254fff703/3ba1081735fd7d7a",
  "prefab:11:24": "4fee7db4fc6c0b1a/d5f51f61072bc67e",
  "prefab:202:2": "d94f847804fffdaf/bdc20ba9ebda34e1",
  "prefab:202:8": "338e5ca6b5bde60a/e08a1053e77376d0",
  "prefab:202:24": "e739526902a15b4b/2b683ef5b3ece246",
  "legacy:11:2": "d70c0f3947e0f36f/eb98becfce5104d8",
  "legacy:11:8": "2c86e3ae870cbf32/4b09dd2d852499a5",
  "legacy:11:24": "0008c097ed04194d/499aba0e02915645",
  "legacy:202:2": "9f5c121a0d805100/3ad5a89ddcc7dad9",
  "legacy:202:8": "57eb839907a3c53d/a645c4c8ff500cb5",
  "legacy:202:24": "3917e49cbd5cb966/72524b99e544b8ea",
  "lordHall:11:5": "6b58f245ba0e922d/b4d978ab1ec4a015",
  "lordHall:11:10": "7d84a926bf77b3e4/3ae3e2c0d1f6ab67",
  "lordHall:11:20": "2dde6dd9473ff050/bb3273dd742258ad",
  "lordHall:202:5": "b85547240e2b6839/9c6ddc50b6dc5c9f",
  "lordHall:202:10": "43b497dad2dcb39a/f38df8be40848737",
  "lordHall:202:20": "bd6c75b1573633f9/ddabb756d643eb24",
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
