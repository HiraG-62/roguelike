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
  "cavern:11:2": "35b4f503c7617b31/3cbba6b9ce24d734",
  "cavern:11:8": "825c9723630ea938/15ac0c6539f4c0b9",
  "cavern:11:24": "b88a6f9341092b13/1ef2ce4429ab2bb0",
  "cavern:202:2": "4b2e501a0f5ee17a/8f377d81814ac606",
  "cavern:202:8": "2a0d8957b93b5622/c12ab13463a3ee80",
  "cavern:202:24": "677b02693c8a2cfc/04a1ef10beae72f9",
  "river:11:2": "ce6f850663255065/12f35b23f6d72171",
  "river:11:8": "9859db6e6aa085e7/7a61e41fdc69c483",
  "river:11:24": "4a11aa4c52436e47/0c3868b7b8514e67",
  "river:202:2": "703e96911d43328d/b6a171027b26029a",
  "river:202:8": "300fe8857b268f7b/17c40956447005dd",
  "river:202:24": "28dfa212965495c7/d069279f8e8f60a6",
  "ring:11:2": "3bfe2435f16efcf9/65d75bb5868f8b83",
  "ring:11:8": "f8737ffac3ce474b/3f727a25a3aa117c",
  "ring:11:24": "ce31d2bffa8ee64f/165993ea8a1f3d36",
  "ring:202:2": "5d040e911ee91912/526a31b8af09d6e9",
  "ring:202:8": "c6223db17e7da377/c54e46244dc02b81",
  "ring:202:24": "970db930c5d572ab/fa98aa6546c52094",
  "court:11:2": "3d487a7e3492bd5a/25583749a932cc1e",
  "court:11:8": "eba94eac0ebd7c61/d7e6199b070eda62",
  "court:11:24": "bb69104758266eaf/17184f02d62deeeb",
  "court:202:2": "16252a85af2ebca9/cbdbf10c3d6c40dd",
  "court:202:8": "979eaf857e0e0f20/5bd843778f090692",
  "court:202:24": "3dfa3e7736eb9a70/dcb2dcc373ab6263",
  "drunk:11:2": "443d7e4a070da67d/8989624e0b91354b",
  "drunk:11:8": "2719f81f85d7967f/a510b82ac212c38e",
  "drunk:11:24": "83047e71d08fd908/dfac8a58ed34bb23",
  "drunk:202:2": "302da7b0b9aef0f1/07bee74688a6b127",
  "drunk:202:8": "3db03cbc46dd8080/6a4b141bec292228",
  "drunk:202:24": "9e47b3b9b3f4f7b2/e1252eb03810847b",
  "isle:11:2": "70453f67d5e4534e/4aab7697990c7565",
  "isle:11:8": "31f8392a6027c323/9a741483e17a6c43",
  "isle:11:24": "a9df15f235b148c4/4797cbf7ae7192fb",
  "isle:202:2": "7a4ac64642d84e52/1b19921c9f1122f9",
  "isle:202:8": "9268b4980f12d750/c136cfa24d205143",
  "isle:202:24": "c16c4039208af27f/c76a6f2e1544401c",
  "terrace:11:2": "98dced37548651a1/c2d7121b3148a24e",
  "terrace:11:8": "7bd4007dfc9f78fd/490a0b2c052237c5",
  "terrace:11:24": "3c4f85bea81c51eb/0cf25f1c731dc105",
  "terrace:202:2": "597830f71c250d72/feaa26c989540361",
  "terrace:202:8": "5c00ecec6352ef50/32b5dc156a15bdfc",
  "terrace:202:24": "56a7bb3fdbb542f0/33c795208c2e50c2",
  "prefab:11:2": "e99fa556f9254d2e/2fb254c5d5ad9fec",
  "prefab:11:8": "b2d3401a3b746868/97251c76a657ebd2",
  "prefab:11:24": "d79760111fcaee02/c7505197eb6a0710",
  "prefab:202:2": "fe82945d7490dded/df34052a5613690f",
  "prefab:202:8": "ab0274e7b3f3e66a/29357cc9ea900847",
  "prefab:202:24": "378ff33c80212e32/37886c1e3b88d4a4",
  "legacy:11:2": "53b13258cb36c994/b49c68ec0dbcf7e5",
  "legacy:11:8": "06156a834b85aa38/2044977f1066272f",
  "legacy:11:24": "ee1f25999d9bc12d/e362ddb70fe1bcbb",
  "legacy:202:2": "335ad6056fc6dc19/baacf0d532a11d7a",
  "legacy:202:8": "d0fe05277095fb0c/ee0f2d0f4e9284b0",
  "legacy:202:24": "c948b22266cca3f2/b155129c5a4b8d07",
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
