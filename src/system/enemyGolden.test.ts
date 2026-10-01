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
  slime: "6e94c8a4",
  eye: "3ae31de7",
  boar: "23c0cdfc",
  knight: "2da3f321",
  bomber: "96a9b279",
  laserEye: "c4aeaf03",
  golem: "ee90d6bd",
  bat: "19b18228",
  wisp: "d598bd33",
  kingSlime: "fb2a9260",
  boneLord: "2166fd73",
  poisonSlime: "19232831",
  iceSlime: "ded8318a",
  fireSlime: "78e93b3b",
  goldSlime: "df55c682",
  boneBoar: "f3c34e41",
  boarDouble: "832bf60e",
  curseEye: "43eb555f",
  frostEye: "c53f4dd1",
  blackKnight: "0ef03b1b",
  lavaGolem: "dfeb5dec",
  frostGolem: "29343f22",
  crystalGolem: "7fbe2057",
  frostWisp: "1b62c49c",
  purpleLaser: "aac78bbe",
  flyingBook: "cb1b95b8",
  ashBat: "649de9a2",
  sproutSlime: "172f843a",
  spikeRat: "76e9f07d",
  twinEye: "81a37086",
  triLaser: "11a94101",
  shadowBat: "31d7743b",
  wolf: "c982def1",
  multiBomber: "d5524677",
  spearman: "b07ada42",
  hornBeetle: "31023167",
  netter: "19daac70",
  carrionFly: "e9ac335f",
  thunderWisp: "d671d429",
  skeleton: "c185b252",
  fuseRat: "cc6c9b4e",
  crystalMite: "536a7c59",
  echoStriker: "08bbfc08",
  packLeader: "f2fae5c6",
  manaLeech: "c8b3229e",
  scavenger: "a136f1c8",
  graveBell: "5d414c05",
  silencer: "392384a4",
  frostCrusher: "f419e6a6",
  twinShade: "c8c6e5c0",
  mimic: "f92e6abd",
  hollowArmor: "ca8e78a7",
  hollowWraith: "f3fd83c5",
  boneConductor: "45359bf5",
  twinBrother: "2a3b7bc6",
  twinSister: "381310ad",
  frostGiant: "50d90208",
  icePillar: "6bde17ef",
  trainingDummy: "6294bdc5",
  mirrorSelf: "ab30ffac",
  mudman: "8e814a73",
  toad: "002f007a",
  oiler: "139316e0",
  flameEater: "39c22c18",
  windSprite: "5ebfa5de",
  mineLayer: "0468de85",
  enemyMine: "4fa134d5",
  bellImp: "a16b8482",
  bannerBearer: "8e87e99a",
  banner: "e44dc1e5",
  burrower: "ef71d6e6",
  dropper: "24ab8714",
  absorber: "749dd3fb",
  homunculus: "9d0b4bc8",
  scribeImp: "530cba38",
  crossGolem: "198e4640",
  chainWarden: "79af919c",
  hollow: "af86e635",
  lurker: "bdb5bf74",
  iceBoar: "2b980314",
  sootBomber: "cfc51cd3",
  mossGolem: "66ae19b0",
  swampWisp: "efdff832",
  frostToad: "d67d8519",
  magmaToad: "6187ed7a",
  oilSlime: "94ee7241",
  stormEye: "25e35463",
  emberRat: "772b8a5b",
  giantToad: "adae0adc",
  forgeMaster: "be1542a5",
  anvil: "c1677875",
  turretMaster: "b605e0e5",
  turret: "7e9a89d7",
  basilisk: "7f3ff27f",
  shadowStalker: "71c9a9da",
  oilKing: "4e17509a",
  broodMother: "584f4cee",
  broodEgg: "c347e3bf",
  librarian: "49ecb160",
  mirrorKnight: "9b28d1bf",
  mirrorImage: "03ef8111",
  thiefKing: "9b28d1bf",
  thief: "12010d54",
  reaperShade: "c3b45fe7",
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
