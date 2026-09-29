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
  slime: "03eb818b",
  eye: "b7431981",
  boar: "551e4134",
  knight: "4aef5ebd",
  bomber: "12cc23ca",
  laserEye: "725d7cb8",
  golem: "672a9412",
  bat: "9e8c6520",
  wisp: "edb63dc4",
  kingSlime: "0a0dda34",
  boneLord: "32269158",
  poisonSlime: "dfc8d057",
  iceSlime: "69371570",
  fireSlime: "3babea78",
  goldSlime: "22fa9f55",
  boneBoar: "23669d79",
  boarDouble: "404f438b",
  curseEye: "50f1878c",
  frostEye: "f2fcce7a",
  blackKnight: "bc6df105",
  lavaGolem: "ea342994",
  frostGolem: "2f1f815c",
  crystalGolem: "8089e987",
  frostWisp: "2637308e",
  purpleLaser: "4c42b07c",
  flyingBook: "1e5e4b57",
  ashBat: "65ed9b32",
  sproutSlime: "db4d8540",
  spikeRat: "a2fa1b70",
  twinEye: "2ad67375",
  triLaser: "59974ccb",
  shadowBat: "bdef2cd0",
  wolf: "6a226660",
  multiBomber: "e704232e",
  spearman: "bc2f3b38",
  hornBeetle: "a7916fe3",
  netter: "6dd1a981",
  carrionFly: "5ac11dc2",
  thunderWisp: "3c304d9e",
  skeleton: "b8f7c599",
  fuseRat: "aa679799",
  crystalMite: "1206bf9b",
  echoStriker: "70b1b5c2",
  packLeader: "de3c6f62",
  manaLeech: "519dc16d",
  scavenger: "6eadaf0b",
  graveBell: "ccf1bc10",
  silencer: "6911fe8c",
  frostCrusher: "85e74d53",
  twinShade: "cb5a8e75",
  mimic: "06c69eeb",
  hollowArmor: "c5ed3479",
  hollowWraith: "9f669f30",
  boneConductor: "0bf93c18",
  twinBrother: "f77a65c5",
  twinSister: "ea4a4305",
  frostGiant: "ca4ee141",
  icePillar: "c4d63d90",
  trainingDummy: "6bb240f9",
  mirrorSelf: "3a53929e",
  mudman: "fe13cc31",
  toad: "627306bd",
  oiler: "a79c8faf",
  flameEater: "2577b8c0",
  windSprite: "beba8fbd",
  mineLayer: "c330facd",
  enemyMine: "28c70fd5",
  bellImp: "3e36bf56",
  bannerBearer: "b83ded6e",
  banner: "20db144c",
  burrower: "d3a36015",
  dropper: "c7762717",
  absorber: "c131c6ba",
  homunculus: "184b3f6d",
  scribeImp: "2dc1a3b1",
  crossGolem: "2f0fccf7",
  chainWarden: "a3c2b06b",
  hollow: "c5cadc8a",
  lurker: "e85b08f3",
  iceBoar: "c03cca7a",
  sootBomber: "8fa60e45",
  mossGolem: "1b506216",
  swampWisp: "ea8d92a6",
  frostToad: "bdd62bc4",
  magmaToad: "1d0809d0",
  oilSlime: "82714873",
  stormEye: "f5f6ba6a",
  emberRat: "2cb0842f",
  giantToad: "3e7b54f6",
  forgeMaster: "8b5acd0e",
  anvil: "1ca07e6c",
  turretMaster: "e91c62a3",
  turret: "9ad2f782",
  basilisk: "e21ced08",
  shadowStalker: "170be116",
  oilKing: "6ef650c0",
  broodMother: "6ef650c0",
  broodEgg: "c347e3bf",
  librarian: "9f0ffaef",
  mirrorKnight: "6ef650c0",
  mirrorImage: "4054359c",
  thiefKing: "9f0ffaef",
  thief: "c12016b3",
  reaperShade: "496b0f41",
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
