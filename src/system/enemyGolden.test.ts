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
  slime: "672ead62",
  eye: "5e38cd8f",
  boar: "c24b5b58",
  knight: "647f56d7",
  bomber: "88d6a8c7",
  laserEye: "67476501",
  golem: "710a3987",
  bat: "575e335d",
  wisp: "341200d0",
  kingSlime: "2172a8be",
  boneLord: "d76af08e",
  poisonSlime: "394e31a7",
  iceSlime: "55029ca4",
  fireSlime: "fdcabff2",
  goldSlime: "8127126e",
  boneBoar: "43d8c94f",
  boarDouble: "0b40445e",
  curseEye: "61c33793",
  frostEye: "cb95b272",
  blackKnight: "5e9ae9da",
  lavaGolem: "68e02cde",
  frostGolem: "bce6015a",
  crystalGolem: "fd6da297",
  frostWisp: "df9d7dae",
  purpleLaser: "fdba8e46",
  flyingBook: "f15aa407",
  ashBat: "0739838a",
  sproutSlime: "9f44039f",
  spikeRat: "c229263c",
  twinEye: "a4e10eea",
  triLaser: "fe330111",
  shadowBat: "524b4c84",
  wolf: "3651f279",
  multiBomber: "b4b32b8c",
  spearman: "fbab56df",
  hornBeetle: "da6035d7",
  netter: "ecd73bed",
  carrionFly: "2fd75978",
  thunderWisp: "fce9d93a",
  skeleton: "21dbd223",
  fuseRat: "0720d80b",
  crystalMite: "faaa29cf",
  echoStriker: "076cb4bf",
  packLeader: "d5fbec69",
  manaLeech: "9183473d",
  scavenger: "578deb3b",
  graveBell: "24dfb948",
  silencer: "ffa745bb",
  frostCrusher: "e4af1a8a",
  twinShade: "9bae9ee1",
  mimic: "bdef7640",
  hollowArmor: "1cafaa56",
  hollowWraith: "5a7a30c0",
  boneConductor: "1533bfcf",
  twinBrother: "3eec5bb6",
  twinSister: "f54dfd86",
  frostGiant: "475aca4e",
  icePillar: "f41ead13",
  trainingDummy: "c5f9508b",
  mirrorSelf: "a59d21e7",
  mudman: "b3200160",
  toad: "8e8cc383",
  oiler: "bf57707b",
  flameEater: "128061cd",
  windSprite: "acccd5bb",
  mineLayer: "302226e3",
  enemyMine: "6ebccb39",
  bellImp: "50f95f20",
  bannerBearer: "2e3a4539",
  banner: "cf4ac58a",
  burrower: "bdb21141",
  dropper: "9a45f1e5",
  absorber: "d0564a37",
  homunculus: "2a932593",
  scribeImp: "8464d0c2",
  crossGolem: "8b7e380a",
  chainWarden: "3f4108c1",
  hollow: "5facab1d",
  lurker: "4c4b4a2f",
  iceBoar: "57dd3c40",
  sootBomber: "d86ce6ce",
  mossGolem: "39d242d4",
  swampWisp: "6dcdc0c3",
  frostToad: "eec24bd4",
  magmaToad: "e1a68904",
  oilSlime: "26b6109b",
  stormEye: "ad082c32",
  emberRat: "0eef1c94",
  giantToad: "3bcd7103",
  forgeMaster: "c620670b",
  anvil: "dbe845b1",
  turretMaster: "228bc2f1",
  turret: "0ae90404",
  basilisk: "960ebc63",
  shadowStalker: "1fd55b28",
  oilKing: "2c757d5a",
  broodMother: "2c757d5a",
  broodEgg: "b67a1391",
  librarian: "71269d6c",
  mirrorKnight: "2c757d5a",
  mirrorImage: "8acb8fc5",
  thiefKing: "71269d6c",
  thief: "fecd36f3",
  reaperShade: "aaf23753",
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
