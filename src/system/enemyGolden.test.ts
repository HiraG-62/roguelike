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
  slime: "57b6840e",
  eye: "18b27601",
  boar: "abaa24c7",
  knight: "dd4afe96",
  bomber: "3d69bbbb",
  laserEye: "27d724ec",
  golem: "7aa759e2",
  bat: "30f0ea3e",
  wisp: "5c1dad7f",
  kingSlime: "b8ddee2c",
  boneLord: "3b654482",
  poisonSlime: "c9451974",
  iceSlime: "60544793",
  fireSlime: "e5a4c07d",
  goldSlime: "9e2bfa05",
  boneBoar: "2c038b41",
  boarDouble: "529109b3",
  curseEye: "2adbee53",
  frostEye: "825bcc34",
  blackKnight: "92f52c80",
  lavaGolem: "12d973e9",
  frostGolem: "6d7684aa",
  crystalGolem: "a84fd9a3",
  frostWisp: "07968a5f",
  purpleLaser: "d3fd6f90",
  flyingBook: "fc575e9d",
  ashBat: "e438c9fa",
  sproutSlime: "e87910bb",
  spikeRat: "08afc358",
  twinEye: "75a6e3b5",
  triLaser: "ec32b065",
  shadowBat: "2d14fdda",
  wolf: "2307f18f",
  multiBomber: "ac979ca5",
  spearman: "702e7a85",
  hornBeetle: "9706bcce",
  netter: "c05f422c",
  carrionFly: "d5315a05",
  thunderWisp: "dccd8085",
  skeleton: "34f986f3",
  fuseRat: "d1e09f11",
  crystalMite: "a6c59cac",
  echoStriker: "b321772a",
  packLeader: "fdd83916",
  manaLeech: "8d62c369",
  scavenger: "4fce05e4",
  graveBell: "4035453a",
  silencer: "18835ff5",
  frostCrusher: "92d4b675",
  twinShade: "0e97b3fd",
  mimic: "78e50326",
  hollowArmor: "d3eaf2de",
  hollowWraith: "c22b5542",
  boneConductor: "de092c82",
  twinBrother: "56c4501c",
  twinSister: "76a40e4c",
  frostGiant: "01d3935d",
  icePillar: "86f52122",
  trainingDummy: "e780a3ce",
  mirrorSelf: "c9dc8004",
  mudman: "29c0a689",
  toad: "0a175c6a",
  oiler: "fb3ab717",
  flameEater: "be8eab68",
  windSprite: "0f1641c4",
  mineLayer: "99e15bc7",
  enemyMine: "11a476b0",
  bellImp: "16c88d9d",
  bannerBearer: "52e974b3",
  banner: "311aea35",
  burrower: "3e4a4403",
  dropper: "6f9032e6",
  absorber: "2bc5473b",
  homunculus: "317894ab",
  scribeImp: "b6b22479",
  crossGolem: "f302b115",
  chainWarden: "3c7969c8",
  hollow: "4a1712fa",
  lurker: "0c7dff20",
  iceBoar: "71d66218",
  sootBomber: "1ec950f9",
  mossGolem: "0b0463ad",
  swampWisp: "122c9c9e",
  frostToad: "9917a29a",
  magmaToad: "809a33e3",
  oilSlime: "da55fb9e",
  stormEye: "54523516",
  emberRat: "4f66683c",
  giantToad: "925c34ac",
  forgeMaster: "2b6a24b9",
  anvil: "c825d562",
  turretMaster: "8b196b02",
  turret: "300e9075",
  basilisk: "576b7edf",
  shadowStalker: "c1f61144",
  oilKing: "cd0fb700",
  broodMother: "cd0fb700",
  broodEgg: "c53fde1f",
  librarian: "5c649b80",
  mirrorKnight: "cd0fb700",
  mirrorImage: "9d8e0810",
  thiefKing: "5c649b80",
  thief: "4455644e",
  reaperShade: "83fd7872",
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
