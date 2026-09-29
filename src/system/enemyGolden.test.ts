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
  slime: "7b44bc40",
  eye: "c34341eb",
  boar: "5cab3ea6",
  knight: "4e86b1af",
  bomber: "4164f0c7",
  laserEye: "bd8b419f",
  golem: "6b32429a",
  bat: "ab958200",
  wisp: "80649a99",
  kingSlime: "f71943fd",
  boneLord: "48e84217",
  poisonSlime: "da54b450",
  iceSlime: "ebe94818",
  fireSlime: "febe28a5",
  goldSlime: "dec63ab9",
  boneBoar: "7b1de4a1",
  boarDouble: "0169b02e",
  curseEye: "2f37f6dc",
  frostEye: "ad9da2d1",
  blackKnight: "4c7632fc",
  lavaGolem: "225bfbf3",
  frostGolem: "0ce85787",
  crystalGolem: "a79cd4a3",
  frostWisp: "02812820",
  purpleLaser: "ae16ed50",
  flyingBook: "fb0efa9a",
  ashBat: "467eb3cc",
  sproutSlime: "fc340c60",
  spikeRat: "da1aa81b",
  twinEye: "4e44e06b",
  triLaser: "41b37e92",
  shadowBat: "af872bc7",
  wolf: "ca087d59",
  multiBomber: "8a8c66ea",
  spearman: "1d25a1f5",
  hornBeetle: "5b51c336",
  netter: "ae291bbd",
  carrionFly: "9136de30",
  thunderWisp: "347563cf",
  skeleton: "a52be77b",
  fuseRat: "5ecbc3da",
  crystalMite: "a6c59cac",
  echoStriker: "de840b6f",
  packLeader: "dc1620b5",
  manaLeech: "14bb331c",
  scavenger: "f31b7e76",
  graveBell: "997ffc7d",
  silencer: "2740aca5",
  frostCrusher: "9f779783",
  twinShade: "909981b7",
  mimic: "a1f1d7a2",
  hollowArmor: "f91bb4cd",
  hollowWraith: "10e56f8a",
  boneConductor: "98d4e758",
  twinBrother: "d633afdf",
  twinSister: "932b3eab",
  frostGiant: "53687409",
  icePillar: "da19617d",
  trainingDummy: "33e75ea9",
  mirrorSelf: "c21e17dd",
  mudman: "bccb7515",
  toad: "8add8a62",
  oiler: "fc9dfaa1",
  flameEater: "27f44ddd",
  windSprite: "b78ba403",
  mineLayer: "5345b6b4",
  enemyMine: "11a476b0",
  bellImp: "a972125a",
  bannerBearer: "699e9d8d",
  banner: "5e79ec00",
  burrower: "4d639ff5",
  dropper: "4e92e7aa",
  absorber: "b75eeca6",
  homunculus: "0f0cc0e8",
  scribeImp: "9cc7acd6",
  crossGolem: "7b8e5526",
  chainWarden: "a33301e9",
  hollow: "7ecb9371",
  lurker: "b66cae35",
  iceBoar: "ae9fa872",
  sootBomber: "b693216a",
  mossGolem: "c2470e15",
  swampWisp: "d4c1bea9",
  frostToad: "a0e85446",
  magmaToad: "2240657c",
  oilSlime: "5f814113",
  stormEye: "66d24b9b",
  emberRat: "50f47fb2",
  giantToad: "8d99e70f",
  forgeMaster: "3f5dd15f",
  anvil: "997ffc7d",
  turretMaster: "d1817c2b",
  turret: "2d82239a",
  basilisk: "548ebc2a",
  shadowStalker: "628b8379",
  oilKing: "102afcd8",
  broodMother: "102afcd8",
  broodEgg: "62841a10",
  librarian: "88159a4c",
  mirrorKnight: "102afcd8",
  mirrorImage: "11132b69",
  thiefKing: "88159a4c",
  thief: "4bb86b04",
  reaperShade: "946c8c27",
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
