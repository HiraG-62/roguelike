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
  slime: "2d56cea0",
  eye: "5ec5b21f",
  boar: "2f53d376",
  knight: "74c29fad",
  bomber: "ebcf8022",
  laserEye: "cefd7b4e",
  golem: "383c8b4b",
  bat: "806a9216",
  wisp: "9e9cabd4",
  kingSlime: "df36d923",
  boneLord: "5ec21314",
  poisonSlime: "be409aa6",
  iceSlime: "9fe2cf82",
  fireSlime: "d1e2cc19",
  goldSlime: "df12f626",
  boneBoar: "41542c67",
  boarDouble: "20a03051",
  curseEye: "a8967622",
  frostEye: "6d80b48f",
  blackKnight: "b2119163",
  lavaGolem: "280f19e0",
  frostGolem: "f60353c6",
  crystalGolem: "683c24e8",
  frostWisp: "83719958",
  purpleLaser: "bf4ae80d",
  flyingBook: "4dcd99cb",
  ashBat: "fdd2f2af",
  sproutSlime: "a697a7d6",
  crownSlime: "0ebe559b",
  spikeRat: "4d2c0903",
  twinEye: "a0d4d194",
  triLaser: "a9d72aa3",
  shadowBat: "d07fc208",
  wolf: "14956fad",
  multiBomber: "f7527e51",
  spearman: "c3ad32b9",
  hornBeetle: "83520033",
  netter: "06b5068e",
  carrionFly: "5039faa8",
  thunderWisp: "981b86ba",
  skeleton: "2ff5fff6",
  fuseRat: "5599ff22",
  crystalMite: "cb6824b8",
  echoStriker: "0ec28884",
  packLeader: "35392c4b",
  manaLeech: "f52c6a70",
  scavenger: "23eab5d0",
  graveBell: "f0529aac",
  silencer: "428dbfe0",
  frostCrusher: "6ce9f067",
  twinShade: "2323f6e2",
  mimic: "8c1d14f2",
  hollowArmor: "e438b490",
  hollowWraith: "df9ce6ba",
  boneConductor: "5819b31d",
  twinBrother: "c5aac363",
  twinSister: "9a14a680",
  frostGiant: "73d1895d",
  icePillar: "4fafd9d7",
  trainingDummy: "ed4f9786",
  mirrorSelf: "a52e5c51",
  mudman: "a175ae43",
  toad: "e87bc826",
  oiler: "c8a6eaf8",
  flameEater: "8ed8197e",
  windSprite: "f922f7b0",
  mineLayer: "b0a2c210",
  enemyMine: "79c937b3",
  bellImp: "7abfc32e",
  bannerBearer: "58c119f5",
  banner: "ae6a1696",
  burrower: "e0bf9860",
  dropper: "829f14be",
  absorber: "8d06d4b9",
  homunculus: "9a8d4db9",
  scribeImp: "c4c7fa74",
  crossGolem: "4620a144",
  chainWarden: "c0881212",
  hollow: "7aeecb5b",
  lurker: "78f93507",
  iceBoar: "a35af921",
  sootBomber: "21322d30",
  mossGolem: "208bf8e3",
  swampWisp: "a32ff5b4",
  frostToad: "93246d9b",
  magmaToad: "80f189b8",
  oilSlime: "1a5e218c",
  stormEye: "67544b63",
  emberRat: "817d81ea",
  giantToad: "668856c4",
  forgeMaster: "5fcc4502",
  anvil: "a5307c75",
  turretMaster: "be2d5bc5",
  turret: "00075191",
  basilisk: "5d2eec0f",
  shadowStalker: "d5802387",
  oilKing: "c559ace0",
  broodMother: "6ac23b89",
  broodEgg: "d62c799f",
  librarian: "e88176f8",
  mirrorKnight: "97e7f11c",
  mirrorImage: "0e471bf5",
  thiefKing: "97e7f11c",
  thief: "f37f3aee",
  reaperShade: "742a3cda",
  merchant: "78aa0056",
  crate: "fd0f0ca9",
  mirrorPane: "c77307a8",
  deepLord: "0d1070d5",
  gatePillar: "56ce9d57",
  pot: "fd0f0ca9",
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
