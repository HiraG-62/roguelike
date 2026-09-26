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
  slime: "27f96d67",
  eye: "56975018",
  boar: "56d4efd4",
  knight: "aa0118eb",
  bomber: "649527ba",
  laserEye: "4b7f4d96",
  golem: "8fe23fe9",
  bat: "3b10fd91",
  wisp: "87d7d4a4",
  kingSlime: "289e1790",
  boneLord: "25242f12",
  poisonSlime: "dff2d0b7",
  iceSlime: "9bedf83c",
  fireSlime: "9f5aee63",
  goldSlime: "fc1e66e9",
  boneBoar: "7602c830",
  boarDouble: "beeaff5b",
  curseEye: "b013e374",
  frostEye: "f793f581",
  blackKnight: "6ae71469",
  lavaGolem: "09f51ce3",
  frostGolem: "22f2d5a4",
  crystalGolem: "3abf1863",
  frostWisp: "4f5a61db",
  purpleLaser: "69d7f6c1",
  flyingBook: "12560371",
  ashBat: "bbbf889c",
  sproutSlime: "f44054f9",
  spikeRat: "c792c9c1",
  twinEye: "68eac9a1",
  triLaser: "fca9c1b2",
  shadowBat: "ddac6a74",
  wolf: "bc26a36e",
  multiBomber: "b27513c0",
  spearman: "8899234f",
  hornBeetle: "17739a95",
  netter: "321d437f",
  carrionFly: "78602570",
  thunderWisp: "22390b05",
  skeleton: "2c97b35e",
  fuseRat: "d1e09f11",
  crystalMite: "0baf6947",
  echoStriker: "c959ad36",
  packLeader: "df5ba2f5",
  manaLeech: "e1176f76",
  scavenger: "3c5ab074",
  graveBell: "a0bd467a",
  silencer: "f3c6b514",
  frostCrusher: "f3c4782d",
  twinShade: "da248dcb",
  mimic: "81c850fb",
  hollowArmor: "59765902",
  hollowWraith: "93d5d946",
  boneConductor: "476fa29e",
  twinBrother: "20daf69e",
  twinSister: "27281372",
  frostGiant: "645a15f9",
  icePillar: "7840a3e4",
  trainingDummy: "ec22a98a",
  mirrorSelf: "177401c6",
  mudman: "39ea72a9",
  toad: "92fe231c",
  oiler: "84a6686c",
  flameEater: "c6d27a51",
  windSprite: "503f5ab2",
  mineLayer: "9ea1b45a",
  enemyMine: "9e93971f",
  bellImp: "190d3b99",
  bannerBearer: "4f4a40b4",
  banner: "a38a9fdc",
  burrower: "59339591",
  dropper: "611a0d15",
  absorber: "ff37d5b5",
  homunculus: "e542d5a3",
  scribeImp: "ca019da1",
  crossGolem: "356e5fe6",
  chainWarden: "31dc180a",
  hollow: "7a4428fb",
  lurker: "e5982880",
  iceBoar: "7585dd0f",
  sootBomber: "85e58b49",
  mossGolem: "e8ff10dc",
  swampWisp: "6d99b97b",
  frostToad: "efbced6c",
  magmaToad: "ba4d5951",
  oilSlime: "3900f23c",
  stormEye: "06b51938",
  emberRat: "4f66683c",
  giantToad: "89a74475",
  forgeMaster: "9ca7a0d8",
  anvil: "3d0a4ce4",
  turretMaster: "c137b480",
  turret: "8cc85c7c",
  basilisk: "cf5c3bce",
  shadowStalker: "152c6b76",
  oilKing: "3848d058",
  broodMother: "3848d058",
  broodEgg: "b8ab5d66",
  librarian: "df324f0c",
  mirrorKnight: "3848d058",
  mirrorImage: "13e964c7",
  thiefKing: "df324f0c",
  thief: "fd6fdeab",
  reaperShade: "6709a3e9",
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
