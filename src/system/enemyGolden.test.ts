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
  slime: "ee3afa0f",
  eye: "82c59bdc",
  boar: "b36ac94e",
  knight: "f84f90cf",
  bomber: "509d7781",
  laserEye: "7d7c849f",
  golem: "c48aae09",
  bat: "0d13963d",
  wisp: "58d6af73",
  kingSlime: "a25dbe27",
  boneLord: "2166fd73",
  poisonSlime: "9ff58930",
  iceSlime: "e40953f8",
  fireSlime: "29b789f9",
  goldSlime: "df55c682",
  boneBoar: "5200ec78",
  boarDouble: "008353e3",
  curseEye: "a6333971",
  frostEye: "672d24f5",
  blackKnight: "35409b25",
  lavaGolem: "eea40ad7",
  frostGolem: "eb38147d",
  crystalGolem: "1afc326d",
  frostWisp: "246e7f22",
  purpleLaser: "4975414a",
  flyingBook: "aeb42bcc",
  ashBat: "3c062c78",
  sproutSlime: "6c4bd5f3",
  crownSlime: "6639f73d",
  spikeRat: "9e4b0407",
  twinEye: "548bd283",
  triLaser: "2eb14c13",
  shadowBat: "2ed34df0",
  wolf: "29bd4f55",
  multiBomber: "d77b3208",
  spearman: "cc996b3d",
  hornBeetle: "06aa7f2d",
  netter: "ce51647e",
  carrionFly: "f2e6658b",
  thunderWisp: "04ba4769",
  skeleton: "5606ccef",
  fuseRat: "0199801c",
  crystalMite: "06588600",
  echoStriker: "32b46297",
  packLeader: "833dea9a",
  manaLeech: "8e9cfc02",
  scavenger: "4f67fcd3",
  graveBell: "09fff29f",
  silencer: "392384a4",
  frostCrusher: "f419e6a6",
  twinShade: "fd8d93db",
  mimic: "5cf08684",
  hollowArmor: "9a2db194",
  hollowWraith: "b758ac75",
  boneConductor: "b88a4fef",
  twinBrother: "2a3b7bc6",
  twinSister: "381310ad",
  frostGiant: "50d90208",
  icePillar: "6bde17ef",
  trainingDummy: "6294bdc5",
  mirrorSelf: "8c598136",
  mudman: "84f16a06",
  toad: "9babb97f",
  oiler: "333e11a8",
  flameEater: "f4e337ca",
  windSprite: "5ebfa5de",
  mineLayer: "02929320",
  enemyMine: "d58b5d52",
  bellImp: "a16b8482",
  bannerBearer: "6412e80a",
  banner: "5736b2db",
  burrower: "e8b98779",
  dropper: "ca3d7e57",
  absorber: "749dd3fb",
  homunculus: "4dbb8ca4",
  scribeImp: "530cba38",
  crossGolem: "e1c7ac0f",
  chainWarden: "fd557c7e",
  hollow: "aa911c83",
  lurker: "ae7c2660",
  iceBoar: "b0fb3e93",
  sootBomber: "460973b8",
  mossGolem: "ca5f6c03",
  swampWisp: "3860ad50",
  frostToad: "a1a37822",
  magmaToad: "faf0f14a",
  oilSlime: "d9fb1d44",
  stormEye: "0f5b8b72",
  emberRat: "d6589e6e",
  giantToad: "a95bacfe",
  forgeMaster: "d74a598f",
  anvil: "c1677875",
  turretMaster: "63867b56",
  turret: "01127f22",
  basilisk: "7682ec0d",
  shadowStalker: "f015af52",
  oilKing: "4e17509a",
  broodMother: "584f4cee",
  broodEgg: "1d69d346",
  librarian: "49ecb160",
  mirrorKnight: "9b28d1bf",
  mirrorImage: "6d845ff6",
  thiefKing: "9b28d1bf",
  thief: "ad9820a7",
  reaperShade: "b64c8c95",
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
