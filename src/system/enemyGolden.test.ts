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
  slime: "7e206e49",
  eye: "9155b205",
  boar: "f5bd72c9",
  knight: "7cf25d3e",
  bomber: "93e67bf2",
  laserEye: "3fdf6304",
  golem: "d542d446",
  bat: "2d427186",
  wisp: "d1cc00e2",
  kingSlime: "12c0b7dd",
  boneLord: "240c6137",
  poisonSlime: "65d00418",
  iceSlime: "3041234d",
  fireSlime: "2ad3c2c4",
  goldSlime: "7615e509",
  boneBoar: "7809cb00",
  boarDouble: "1b3fef2f",
  curseEye: "9640853f",
  frostEye: "61283f31",
  blackKnight: "983840ae",
  lavaGolem: "546dcceb",
  frostGolem: "b371c528",
  crystalGolem: "271d2f53",
  frostWisp: "7e764e0a",
  purpleLaser: "eb105786",
  flyingBook: "a73f0461",
  ashBat: "45bac32c",
  sproutSlime: "1c033a14",
  spikeRat: "cbc89516",
  twinEye: "ce8e421f",
  triLaser: "b9a25e1a",
  shadowBat: "881103b7",
  wolf: "299f1cc0",
  multiBomber: "d1e3ff77",
  spearman: "fff9f901",
  hornBeetle: "47a495ef",
  netter: "3dba424f",
  carrionFly: "164850eb",
  thunderWisp: "0fe2d978",
  skeleton: "0f287d77",
  fuseRat: "4e1b0271",
  crystalMite: "a6c59cac",
  echoStriker: "e674175b",
  packLeader: "137949d5",
  manaLeech: "c1f149b0",
  scavenger: "45304dde",
  graveBell: "b0779a9d",
  silencer: "e763b9c3",
  frostCrusher: "d5d1d9f3",
  twinShade: "a14edab6",
  mimic: "d83485c7",
  hollowArmor: "fc0aa695",
  hollowWraith: "7f916d72",
  boneConductor: "f6611cea",
  twinBrother: "b7857e0f",
  twinSister: "cbde989b",
  frostGiant: "47e4aa29",
  icePillar: "3aa753ad",
  trainingDummy: "f47924a9",
  mirrorSelf: "127f833c",
  mudman: "d2f3fffc",
  toad: "20f746a3",
  oiler: "909a24a2",
  flameEater: "9e0a1f19",
  windSprite: "83c5cfef",
  mineLayer: "b303c7a1",
  enemyMine: "cdf44db8",
  bellImp: "bccef863",
  bannerBearer: "e9707849",
  banner: "fac97d38",
  burrower: "471b2d8c",
  dropper: "cd1c573a",
  absorber: "4f800dd6",
  homunculus: "c76d9964",
  scribeImp: "1ef5e1ca",
  crossGolem: "ce2471eb",
  chainWarden: "9f96a20c",
  hollow: "e285d90f",
  lurker: "652e787b",
  iceBoar: "1376c56b",
  sootBomber: "7bde583f",
  mossGolem: "239da578",
  swampWisp: "8b1480ba",
  frostToad: "38f0f73f",
  magmaToad: "4d24d002",
  oilSlime: "d6d60577",
  stormEye: "2b27ff5f",
  emberRat: "bde39190",
  giantToad: "839abd01",
  forgeMaster: "81da50e9",
  anvil: "b0779a9d",
  turretMaster: "6b321965",
  turret: "1052d3f1",
  basilisk: "0f2ac932",
  shadowStalker: "b4b04c6c",
  oilKing: "db0ea958",
  broodMother: "db0ea958",
  broodEgg: "62841a10",
  librarian: "72398aac",
  mirrorKnight: "db0ea958",
  mirrorImage: "e6dd4249",
  thiefKing: "72398aac",
  thief: "b28aaacb",
  reaperShade: "b18d9599",
  merchant: "f4c4d3e1",
  crate: "bd8a64fc",
  pot: "bd8a64fc",
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
