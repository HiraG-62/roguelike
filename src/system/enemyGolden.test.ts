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
  eye: "e4cce001",
  boar: "1af00992",
  knight: "fe49cd72",
  bomber: "649527ba",
  laserEye: "4b7f4d96",
  golem: "f7c5856c",
  bat: "a1107676",
  wisp: "87d7d4a4",
  kingSlime: "207defdc",
  boneLord: "8ea88054",
  poisonSlime: "4c87002e",
  iceSlime: "daa6c3d3",
  fireSlime: "fca6f6af",
  goldSlime: "fc1e66e9",
  boneBoar: "810298f4",
  boarDouble: "412cb456",
  curseEye: "f9e8554f",
  frostEye: "d308bd1b",
  blackKnight: "023d5d6c",
  lavaGolem: "407069bf",
  frostGolem: "57fd65dc",
  crystalGolem: "3f2abcb5",
  frostWisp: "4f5a61db",
  purpleLaser: "69d7f6c1",
  flyingBook: "12560371",
  ashBat: "e858469a",
  sproutSlime: "f44054f9",
  spikeRat: "2f45ea5e",
  twinEye: "12a6330e",
  triLaser: "fca9c1b2",
  shadowBat: "cc66e9d7",
  wolf: "eaaaa712",
  multiBomber: "b27513c0",
  spearman: "d453e9d4",
  hornBeetle: "f21f7889",
  netter: "38d5e2c9",
  carrionFly: "b6c4a432",
  thunderWisp: "22390b05",
  skeleton: "e2229402",
  fuseRat: "184341bf",
  crystalMite: "0baf6947",
  echoStriker: "c959ad36",
  packLeader: "e02f7a65",
  manaLeech: "8bb76abb",
  scavenger: "9b1ef42a",
  graveBell: "89c9de55",
  silencer: "f3c6b514",
  frostCrusher: "e6ae60ef",
  twinShade: "e517cbef",
  mimic: "b4960a40",
  hollowArmor: "66137238",
  hollowWraith: "cfb450a6",
  boneConductor: "9b29c626",
  twinBrother: "716b6acc",
  twinSister: "001f9802",
  frostGiant: "1cd6a31c",
  icePillar: "7840a3e4",
  trainingDummy: "ec22a98a",
  mirrorSelf: "ea865f48",
  mudman: "39ea72a9",
  toad: "92fe231c",
  oiler: "8f132afc",
  flameEater: "dfa30648",
  windSprite: "503f5ab2",
  mineLayer: "9ea1b45a",
  enemyMine: "9e93971f",
  bellImp: "190d3b99",
  bannerBearer: "bfc22b5a",
  banner: "a38a9fdc",
  burrower: "ea95ab56",
  dropper: "a9be33a9",
  absorber: "a71816de",
  homunculus: "e542d5a3",
  scribeImp: "ca019da1",
  crossGolem: "6732450d",
  chainWarden: "3541b2d8",
  hollow: "2519b0d6",
  lurker: "81611363",
  iceBoar: "e6beac8a",
  sootBomber: "85e58b49",
  mossGolem: "d47158a9",
  swampWisp: "6d99b97b",
  frostToad: "efbced6c",
  magmaToad: "ba4d5951",
  oilSlime: "dd09abf6",
  stormEye: "6e997024",
  emberRat: "76cabc19",
  giantToad: "eec355b5",
  forgeMaster: "9ca7a0d8",
  anvil: "3d0a4ce4",
  turretMaster: "c05ddeb3",
  turret: "718c535d",
  basilisk: "571df411",
  shadowStalker: "05a06710",
  oilKing: "051f49ec",
  broodMother: "051f49ec",
  broodEgg: "b8ab5d66",
  librarian: "be4eea50",
  mirrorKnight: "051f49ec",
  mirrorImage: "1a538702",
  thiefKing: "be4eea50",
  thief: "383faaec",
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
