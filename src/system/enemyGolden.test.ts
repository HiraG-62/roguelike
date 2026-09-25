import { describe, expect, it } from "vitest";
import { step } from "../core/game";
import { FIXED_DT } from "../core/loop";
import type { GameState } from "../core/state";
import { hashSeed } from "../core/rng";
import { ENEMIES } from "../data/enemies";
import { arena, placeEnemy, withInput } from "./testHelpers";

/**
 * 敵 behavior のクラス化（docs/ideas/oop-migration.md 4.1）の前後で結果が変わらないことを固定する黄金テスト。
 * 移行期間だけの安全網: 敵 behavior の移行完了（第 2 段 A5）で削除する。
 * 意図した数値変更（enemies.json など）で落ちたら、メッセージの実測値で期待値を貼り直す。
 * 粒子・効果（particles / shapes / floatingTexts）は見た目のレーンが別に動かすので観点に含めない。
 */

const STEPS = 500;
const HUGE_HP = 1_000_000;

/** 位置・生命・段・技の選択・弾の数（replay.test.ts の fingerprint の観点 + phase / ai.move） */
function fingerprint(state: GameState): string {
  const p = state.player.body.pos;
  return [
    state.tick,
    p.x.toFixed(4),
    p.y.toFixed(4),
    state.player.hp,
    state.enemies.length,
    state.enemies
      .map((e) => `${e.id}:${e.hp}:${e.body.pos.x.toFixed(4)}:${e.body.pos.y.toFixed(4)}:${e.phase}:${e.ai?.move ?? "-"}`)
      .join(","),
    state.score,
    state.kills,
    state.projectiles.length,
  ].join("|");
}

/** enemies.test.ts の「500 ステップ例外なく動く」と同じ入力で動かした後の fingerprint のハッシュ */
function goldenOf(key: string): string {
  const state = arena(11);
  state.player.maxHp = HUGE_HP;
  state.player.hp = HUGE_HP;
  state.depth = 4;
  placeEnemy(state, key, 50, 10);
  placeEnemy(state, key, -40, -20);
  for (let i = 0; i < STEPS; i++) {
    step(state, withInput({ move: { x: i % 80 < 40 ? 1 : -1, y: 0 }, attackPressed: i % 25 === 0 }), FIXED_DT);
  }
  return hashSeed(fingerprint(state)).toString(16).padStart(8, "0");
}

/** 移行前のコードで採った値 */
const GOLDEN: Readonly<Record<string, string>> = {
  slime: "d7340fb4",
  eye: "5e38cd8f",
  boar: "2a9bb56c",
  knight: "6bea8af6",
  bomber: "88d6a8c7",
  laserEye: "67476501",
  golem: "682081e8",
  bat: "41ace572",
  wisp: "0cf55e92",
  kingSlime: "08c66cc6",
  boneLord: "35a3ea2c",
  poisonSlime: "b62840d2",
  iceSlime: "c308c281",
  fireSlime: "322edad1",
  goldSlime: "be5ff8a1",
  boneBoar: "600d8c41",
  boarDouble: "b6251f57",
  curseEye: "61c33793",
  frostEye: "cb95b272",
  blackKnight: "245f5e7b",
  lavaGolem: "97980450",
  frostGolem: "9f09df92",
  crystalGolem: "7636a35a",
  frostWisp: "74a26678",
  purpleLaser: "fdba8e46",
  flyingBook: "0b0107a4",
  ashBat: "72e8ea45",
  sproutSlime: "24eaa6ac",
  spikeRat: "e97d951f",
  twinEye: "a4e10eea",
  triLaser: "fe330111",
  shadowBat: "d667e4e6",
  wolf: "4e8ebe70",
  multiBomber: "b4b32b8c",
  spearman: "a35c26e6",
  hornBeetle: "404dfb13",
  netter: "ecd73bed",
  carrionFly: "2fd75978",
  thunderWisp: "db4c0b1a",
  skeleton: "70dc0ad2",
  fuseRat: "c370c200",
  crystalMite: "0baf6947",
  echoStriker: "076cb4bf",
  packLeader: "5d7c500f",
  manaLeech: "ad372bbc",
  scavenger: "d0e23bba",
  graveBell: "c2b309fa",
  silencer: "ffa745bb",
  frostCrusher: "e826e413",
  twinShade: "248fcf48",
  mimic: "e35823b8",
  hollowArmor: "efc09113",
  hollowWraith: "43732cee",
  boneConductor: "54b7d95c",
  twinBrother: "1eab9e60",
  twinSister: "5abebe14",
  frostGiant: "4d9da2f7",
  icePillar: "60339a52",
  trainingDummy: "65893e44",
  mirrorSelf: "e01f5381",
  mudman: "9ea34a0c",
  toad: "a8861f58",
  oiler: "3f68a6a3",
  flameEater: "86d9941c",
  windSprite: "acccd5bb",
  mineLayer: "302226e3",
  enemyMine: "6ebccb39",
  bellImp: "50f95f20",
  bannerBearer: "82494e3f",
  banner: "0ba0c05e",
  burrower: "f4dd5510",
  dropper: "65fbdf99",
  absorber: "792f7d57",
  homunculus: "2a932593",
  scribeImp: "8464d0c2",
  crossGolem: "465caee0",
  chainWarden: "c3b82d28",
  hollow: "32acf568",
  lurker: "15393401",
  iceBoar: "2e376afc",
  sootBomber: "d86ce6ce",
  mossGolem: "8fc49b53",
  swampWisp: "5ff3db33",
  frostToad: "5c604e0b",
  magmaToad: "e1a68904",
  oilSlime: "bf4b80f9",
  stormEye: "ad082c32",
  emberRat: "87ef9405",
  giantToad: "55cf02fa",
  forgeMaster: "d1ed2af9",
  anvil: "a152252e",
  turretMaster: "adbf25d5",
  turret: "4c185ecd",
  basilisk: "c7d9ab09",
  shadowStalker: "159d954d",
  oilKing: "9f624d5a",
  broodMother: "9f624d5a",
  broodEgg: "5daf2cee",
  librarian: "2e3a3696",
  mirrorKnight: "9f624d5a",
  mirrorImage: "9f50c828",
  thiefKing: "2e3a3696",
  thief: "c58d06ff",
  reaperShade: "37c8a963",
};

describe("敵 behavior の黄金 fingerprint（移行期間の安全網）", () => {
  for (const def of ENEMIES) {
    it(`${def.key} の 500 ステップ後の状態が移行前と一致する`, () => {
      const actual = goldenOf(def.key);
      const expected = GOLDEN[def.key];
      if (expected === undefined) {
        expect.fail(`黄金値が未登録: "${def.key}": "${actual}",`);
      }
      expect(actual, `黄金値の不一致: "${def.key}": "${actual}",`).toBe(expected);
    });
  }
});
