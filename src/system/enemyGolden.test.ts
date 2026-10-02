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
  slime: "dc1b0361",
  eye: "82c59bdc",
  boar: "be71b365",
  knight: "bd90f97f",
  bomber: "86cfa41d",
  laserEye: "4729c2aa",
  golem: "373ef2b8",
  bat: "dd4ce0d5",
  wisp: "be581571",
  kingSlime: "fb2a9260",
  boneLord: "2166fd73",
  poisonSlime: "8c55d721",
  iceSlime: "789ac3ef",
  fireSlime: "f13f0e2a",
  goldSlime: "df55c682",
  boneBoar: "4912ceaa",
  boarDouble: "43930263",
  curseEye: "870318b2",
  frostEye: "672d24f5",
  blackKnight: "0ef03b1b",
  lavaGolem: "32d9ca78",
  frostGolem: "375ddc07",
  crystalGolem: "ea9ce5b3",
  frostWisp: "aba279d7",
  purpleLaser: "d5e96607",
  flyingBook: "70717bfb",
  ashBat: "649de9a2",
  sproutSlime: "6bf04e4e",
  spikeRat: "2d19407c",
  twinEye: "548bd283",
  triLaser: "7dd3d66c",
  shadowBat: "cf83f187",
  wolf: "9f3824f5",
  multiBomber: "d77b3208",
  spearman: "2c860726",
  hornBeetle: "a54e949a",
  netter: "ce51647e",
  carrionFly: "18692d6d",
  thunderWisp: "56bd3873",
  skeleton: "8c943f7a",
  fuseRat: "f6547215",
  crystalMite: "06588600",
  echoStriker: "99814aa8",
  packLeader: "4ed2d411",
  manaLeech: "be9a465e",
  scavenger: "1afca244",
  graveBell: "5d414c05",
  silencer: "392384a4",
  frostCrusher: "f419e6a6",
  twinShade: "77d64ace",
  mimic: "76b2f064",
  hollowArmor: "0d6af28f",
  hollowWraith: "b758ac75",
  boneConductor: "416dd504",
  twinBrother: "2a3b7bc6",
  twinSister: "381310ad",
  frostGiant: "50d90208",
  icePillar: "6bde17ef",
  trainingDummy: "6294bdc5",
  mirrorSelf: "40c39b3f",
  mudman: "69f33adb",
  toad: "9babb97f",
  oiler: "39402965",
  flameEater: "38e1dd66",
  windSprite: "5ebfa5de",
  mineLayer: "0468de85",
  enemyMine: "4fa134d5",
  bellImp: "a16b8482",
  bannerBearer: "9212fc0e",
  banner: "e44dc1e5",
  burrower: "e8b98779",
  dropper: "9d8afada",
  absorber: "749dd3fb",
  homunculus: "4dbb8ca4",
  scribeImp: "530cba38",
  crossGolem: "ccafbe81",
  chainWarden: "912d8980",
  hollow: "6249bc17",
  lurker: "ce819e28",
  iceBoar: "8c7fd990",
  sootBomber: "460973b8",
  mossGolem: "6c50b030",
  swampWisp: "eb707829",
  frostToad: "a1a37822",
  magmaToad: "c097233f",
  oilSlime: "8529ef76",
  stormEye: "0f5b8b72",
  emberRat: "2c6e68f2",
  giantToad: "b6f420cd",
  forgeMaster: "9017e0cf",
  anvil: "c1677875",
  turretMaster: "0f1fc69e",
  turret: "0cece356",
  basilisk: "0c7b0a64",
  shadowStalker: "f015af52",
  oilKing: "4e17509a",
  broodMother: "584f4cee",
  broodEgg: "62841a10",
  librarian: "49ecb160",
  mirrorKnight: "9b28d1bf",
  mirrorImage: "7e551d34",
  thiefKing: "9b28d1bf",
  thief: "b3775ca4",
  reaperShade: "10bb23a5",
  merchant: "090466ce",
  crate: "e5d1e476",
  mirrorPane: "af04e3c0",
  deepLord: "c2f86b78",
  gatePillar: "6294bdc5",
  pot: "e5d1e476",
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
