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
  slime: "2d40d57f",
  eye: "e4cce001",
  boar: "cb8a5ac0",
  knight: "01f6a381",
  bomber: "6c6af3fb",
  laserEye: "f2148167",
  golem: "fc90dcce",
  bat: "e156771e",
  wisp: "3af5ae6d",
  kingSlime: "b97ee29c",
  boneLord: "8d23dfac",
  poisonSlime: "9674b731",
  iceSlime: "7b5decc7",
  fireSlime: "151b74c7",
  goldSlime: "fc1e66e9",
  boneBoar: "849a800a",
  boarDouble: "2f3d3ec9",
  curseEye: "f9e8554f",
  frostEye: "d308bd1b",
  blackKnight: "e6230e14",
  lavaGolem: "1abefdbc",
  frostGolem: "381705c8",
  crystalGolem: "2a4f389b",
  frostWisp: "15beb815",
  purpleLaser: "e0150d44",
  flyingBook: "15133ec3",
  ashBat: "57df7bd7",
  sproutSlime: "9e724aa4",
  spikeRat: "cde40f18",
  twinEye: "12a6330e",
  triLaser: "22cfbba0",
  shadowBat: "f9fa33c5",
  wolf: "c0229861",
  multiBomber: "141479b3",
  spearman: "11816cc0",
  hornBeetle: "a59db64b",
  netter: "38d5e2c9",
  carrionFly: "a55a3043",
  thunderWisp: "b1a7d68b",
  skeleton: "f57c85a5",
  fuseRat: "a328d95b",
  crystalMite: "074837fa",
  echoStriker: "62aad2de",
  packLeader: "b7e792f0",
  manaLeech: "1e9bd1c5",
  scavenger: "4ea73b77",
  graveBell: "09f4b5cc",
  silencer: "03f856b0",
  frostCrusher: "782d5e66",
  twinShade: "a2836da8",
  mimic: "846865da",
  hollowArmor: "cdc21fc7",
  hollowWraith: "4caff1c3",
  boneConductor: "aeefed7d",
  twinBrother: "97eb2389",
  twinSister: "0966e5f9",
  frostGiant: "0b2dd6a1",
  icePillar: "8d9af6a8",
  trainingDummy: "fcb34399",
  mirrorSelf: "821d66c2",
  mudman: "24c69023",
  toad: "e97bd1ed",
  oiler: "663f39ec",
  flameEater: "c8305c9a",
  windSprite: "353b16ab",
  mineLayer: "9ea1b45a",
  enemyMine: "9e93971f",
  bellImp: "e509d311",
  bannerBearer: "4afbed63",
  banner: "840af602",
  burrower: "21cc5f15",
  dropper: "b50cf0d5",
  absorber: "ef5e6afe",
  homunculus: "6a28e865",
  scribeImp: "4d6335c8",
  crossGolem: "fd4c2b27",
  chainWarden: "9d73c460",
  hollow: "66d2b0a9",
  lurker: "6542a090",
  iceBoar: "96d5e149",
  sootBomber: "f3be5e0a",
  mossGolem: "a69a8e5b",
  swampWisp: "a2cd5bd1",
  frostToad: "70ad6efe",
  magmaToad: "62e99cbb",
  oilSlime: "8dde8497",
  stormEye: "6e997024",
  emberRat: "7a99d2ef",
  giantToad: "64e9a16a",
  forgeMaster: "90ac7b01",
  anvil: "ffdf9400",
  turretMaster: "b2f06dd9",
  turret: "b326ce41",
  basilisk: "d6654568",
  shadowStalker: "06dce7bf",
  oilKing: "09847894",
  broodMother: "09847894",
  broodEgg: "c347e3bf",
  librarian: "3ef100b3",
  mirrorKnight: "09847894",
  mirrorImage: "46933eb2",
  thiefKing: "3ef100b3",
  thief: "774cc1bd",
  reaperShade: "40675850",
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
