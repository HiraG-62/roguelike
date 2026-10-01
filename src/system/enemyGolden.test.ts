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
  slime: "5504fed0",
  eye: "2abcf657",
  boar: "06f29507",
  knight: "2b39e5fe",
  bomber: "e36bea7a",
  laserEye: "0a910ff4",
  golem: "8d7fdec7",
  bat: "c18874e3",
  wisp: "212ae32c",
  kingSlime: "843b31d9",
  boneLord: "f15390ce",
  poisonSlime: "4db62d5f",
  iceSlime: "232339d9",
  fireSlime: "d7f2f844",
  goldSlime: "0b5d6bd3",
  boneBoar: "2f2eacd2",
  boarDouble: "2d50951f",
  curseEye: "3e475c4d",
  frostEye: "818adfde",
  blackKnight: "26ef8b8f",
  lavaGolem: "0e179cc5",
  frostGolem: "f3b05437",
  crystalGolem: "f3610fd9",
  frostWisp: "c18ed363",
  purpleLaser: "09605cab",
  flyingBook: "7ea2128a",
  ashBat: "649de9a2",
  sproutSlime: "e55784d3",
  spikeRat: "38493eee",
  twinEye: "10ab3fb0",
  triLaser: "5cc2e62c",
  shadowBat: "13df0533",
  wolf: "14b75bc5",
  multiBomber: "541a58f7",
  spearman: "da56d12b",
  hornBeetle: "63e9ecc6",
  netter: "7e512469",
  carrionFly: "cf7fc50e",
  thunderWisp: "405c6e22",
  skeleton: "a62638de",
  fuseRat: "b88206e5",
  crystalMite: "a3332354",
  echoStriker: "b91d851f",
  packLeader: "5dc000be",
  manaLeech: "21d8ef43",
  scavenger: "832309b5",
  graveBell: "6d11e47a",
  silencer: "9e860217",
  frostCrusher: "541bc973",
  twinShade: "4ae6ad1e",
  mimic: "f63ff7c5",
  hollowArmor: "960567a3",
  hollowWraith: "87c7f454",
  boneConductor: "a7b74519",
  twinBrother: "40218355",
  twinSister: "990922c2",
  frostGiant: "ab79b281",
  icePillar: "cb02e114",
  trainingDummy: "a899ae5c",
  mirrorSelf: "2e56d07a",
  mudman: "5a8e1441",
  toad: "bbf48ed2",
  oiler: "9968f8cf",
  flameEater: "2eb54bbe",
  windSprite: "07493b0f",
  mineLayer: "e2d99970",
  enemyMine: "3f961986",
  bellImp: "87f810cb",
  bannerBearer: "fa9aa723",
  banner: "82ccbe10",
  burrower: "002e97b2",
  dropper: "4c629a5a",
  absorber: "32e94114",
  homunculus: "1ec91913",
  scribeImp: "6a75a07b",
  crossGolem: "0301dc38",
  chainWarden: "16c2ab3c",
  hollow: "d456042e",
  lurker: "4b61543c",
  iceBoar: "84a389db",
  sootBomber: "4163c1bb",
  mossGolem: "d1ed38a4",
  swampWisp: "3639028a",
  frostToad: "3fe63ee6",
  magmaToad: "c09adc89",
  oilSlime: "5b4d49d0",
  stormEye: "5aa106f9",
  emberRat: "cbefb9e0",
  giantToad: "b4d20b4e",
  forgeMaster: "efd033d5",
  anvil: "6d11e47a",
  turretMaster: "9dc68ea5",
  turret: "34901dbb",
  basilisk: "0e66a07b",
  shadowStalker: "cabc1a20",
  oilKing: "c98cb43f",
  broodMother: "8a23cca7",
  broodEgg: "c347e3bf",
  librarian: "da10dce1",
  mirrorKnight: "f4ecbca2",
  mirrorImage: "33d9ba08",
  thiefKing: "f4ecbca2",
  thief: "b6673a55",
  reaperShade: "9b3be109",
  merchant: "4d617d35",
  crate: "2d962a73",
  mirrorPane: "47b3553d",
  deepLord: "369ed999",
  gatePillar: "a899ae5c",
  pot: "2d962a73",
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
