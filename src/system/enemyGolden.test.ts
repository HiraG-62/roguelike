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
  slime: "d1b4f538",
  eye: "1ae4d36b",
  boar: "5e423f62",
  knight: "46a062d0",
  bomber: "f17b450f",
  laserEye: "5afea214",
  golem: "a111abc0",
  bat: "4a5a9186",
  wisp: "f1821e87",
  kingSlime: "bad190bb",
  boneLord: "30815ebe",
  poisonSlime: "4a43d703",
  iceSlime: "86bf4c7d",
  fireSlime: "72440357",
  goldSlime: "0d98fd92",
  boneBoar: "d700bdd9",
  boarDouble: "81542e83",
  curseEye: "959a0f47",
  frostEye: "c6fe3130",
  blackKnight: "87e0dec2",
  lavaGolem: "1208323b",
  frostGolem: "027b7a2e",
  crystalGolem: "060e5879",
  frostWisp: "af3d985c",
  purpleLaser: "c96180d7",
  flyingBook: "97ffc3e5",
  ashBat: "44af266c",
  sproutSlime: "3d86f199",
  crownSlime: "9638420d",
  spikeRat: "e64cca9c",
  twinEye: "ca9c4ada",
  triLaser: "dd2003b1",
  shadowBat: "29278e67",
  wolf: "d74c04c1",
  multiBomber: "ae14d991",
  spearman: "56e3715a",
  hornBeetle: "bc4c7d7c",
  netter: "9fbf8ff5",
  carrionFly: "6a0cb272",
  thunderWisp: "3e80b893",
  skeleton: "41cfa0b2",
  fuseRat: "d415937a",
  crystalMite: "428e91ca",
  echoStriker: "68388a88",
  packLeader: "7ca371e0",
  manaLeech: "c0fb5eb7",
  scavenger: "e2edc986",
  graveBell: "cd246517",
  silencer: "2b3f699a",
  frostCrusher: "54d597c0",
  twinShade: "79835625",
  mimic: "29c0658a",
  hollowArmor: "84a62678",
  hollowWraith: "080d91ae",
  boneConductor: "074fa6be",
  twinBrother: "e8759846",
  twinSister: "bea14692",
  frostGiant: "17bbec6d",
  icePillar: "fac2ba9c",
  trainingDummy: "8f610ff4",
  mirrorSelf: "a39c5063",
  mudman: "4bf9fab3",
  toad: "88712b8a",
  oiler: "1aadb6fb",
  flameEater: "77c640d2",
  windSprite: "c1251b73",
  mineLayer: "2d6ec07e",
  enemyMine: "a3abdb9c",
  bellImp: "db9b862d",
  bannerBearer: "eb1b70cb",
  banner: "c747b0ea",
  burrower: "48fdd1b8",
  dropper: "cde507a1",
  absorber: "4fbc2d67",
  homunculus: "0e9fb7a1",
  scribeImp: "6a1b0101",
  crossGolem: "2ed99988",
  chainWarden: "b05d7778",
  hollow: "88dd6198",
  lurker: "9c11f9ba",
  iceBoar: "77786359",
  sootBomber: "42c45176",
  mossGolem: "dca73457",
  swampWisp: "999b4868",
  frostToad: "68d22cd0",
  magmaToad: "c65059c2",
  oilSlime: "d0ca2acc",
  stormEye: "dced4a93",
  emberRat: "d9bf0d16",
  giantToad: "2fd674ab",
  forgeMaster: "68d14aed",
  anvil: "805d0df4",
  turretMaster: "237b5409",
  turret: "e544c266",
  basilisk: "8da6c12d",
  shadowStalker: "0ee7559c",
  oilKing: "f782897c",
  broodMother: "06da7d5d",
  broodEgg: "55df6dd2",
  librarian: "2e7e0c3a",
  mirrorKnight: "866dd2d6",
  mirrorImage: "51985581",
  thiefKing: "866dd2d6",
  thief: "69807dd1",
  reaperShade: "99eb4324",
  merchant: "4b999085",
  crate: "14de88a8",
  mirrorPane: "7923942a",
  deepLord: "6c7c1aaf",
  gatePillar: "d2a74595",
  pot: "14de88a8",
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
