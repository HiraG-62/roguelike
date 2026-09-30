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
  slime: "a16b5ce8",
  eye: "852b2cce",
  boar: "e985156e",
  knight: "6aaf427d",
  bomber: "d79b98f2",
  laserEye: "be3a918f",
  golem: "6a98d1d3",
  bat: "ee90cb79",
  wisp: "0fb9cdf0",
  kingSlime: "a1ed0b7b",
  boneLord: "ab14184f",
  poisonSlime: "5a259422",
  iceSlime: "fd8834ef",
  fireSlime: "fc3a12ce",
  goldSlime: "d9a0b219",
  boneBoar: "45064315",
  boarDouble: "cd79364c",
  curseEye: "8761efed",
  frostEye: "d57dd973",
  blackKnight: "1147623b",
  lavaGolem: "f5f2ca83",
  frostGolem: "88813d90",
  crystalGolem: "2eb57bdd",
  frostWisp: "87fbcd0c",
  purpleLaser: "a58f6080",
  flyingBook: "a6f0a264",
  ashBat: "0459d1c4",
  sproutSlime: "8f0ea89b",
  spikeRat: "6421dcef",
  twinEye: "102480ce",
  triLaser: "ed70f560",
  shadowBat: "6a9e090b",
  wolf: "43f0f427",
  multiBomber: "46eb799b",
  spearman: "e53d6f94",
  hornBeetle: "a3d49e88",
  netter: "bb5f6893",
  carrionFly: "5317ec3d",
  thunderWisp: "cd03ba2a",
  skeleton: "ee91920d",
  fuseRat: "07eb4ae4",
  crystalMite: "a6c59cac",
  echoStriker: "4cf2e698",
  packLeader: "dab9e92f",
  manaLeech: "d0d4fcdf",
  scavenger: "ea5f8533",
  graveBell: "5e724ea2",
  silencer: "fa8f4651",
  frostCrusher: "1babfa7f",
  twinShade: "748202e0",
  mimic: "de11230b",
  hollowArmor: "29ed2fbf",
  hollowWraith: "b44f3670",
  boneConductor: "f35d97cd",
  twinBrother: "f3e085fd",
  twinSister: "33d06735",
  frostGiant: "5fde7469",
  icePillar: "a70908af",
  trainingDummy: "c2f2fd15",
  mirrorSelf: "4651b202",
  mudman: "5c1803c8",
  toad: "d35ed679",
  oiler: "f06ee80f",
  flameEater: "f2b2ed2d",
  windSprite: "5440106d",
  mineLayer: "7e3877f9",
  enemyMine: "39a8b05b",
  bellImp: "ed921ede",
  bannerBearer: "f0bb7bda",
  banner: "8936fafd",
  burrower: "2c2cc0d4",
  dropper: "f0905ba7",
  absorber: "117496bc",
  homunculus: "ccf3a2b0",
  scribeImp: "661a9577",
  crossGolem: "8c620b28",
  chainWarden: "9bbc6538",
  hollow: "d71eb0c9",
  lurker: "dac80c87",
  iceBoar: "da0d3cb5",
  sootBomber: "745dbfff",
  mossGolem: "23405ef7",
  swampWisp: "d33cbb26",
  frostToad: "bcae6703",
  magmaToad: "dc3b3034",
  oilSlime: "8c10d9c3",
  stormEye: "60de7818",
  emberRat: "8300f0f2",
  giantToad: "a5c2e1af",
  forgeMaster: "527b90f0",
  anvil: "080ea81f",
  turretMaster: "35f896a1",
  turret: "2182af9b",
  basilisk: "19c182b9",
  shadowStalker: "69bfea2b",
  oilKing: "7d7798a0",
  broodMother: "7d7798a0",
  broodEgg: "62841a10",
  librarian: "348b40c8",
  mirrorKnight: "7d7798a0",
  mirrorImage: "f43336aa",
  thiefKing: "348b40c8",
  thief: "d8c3a8a1",
  reaperShade: "8a1d732f",
  merchant: "9bba4333",
  crate: "07cbd0ed",
  pot: "07cbd0ed",
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
