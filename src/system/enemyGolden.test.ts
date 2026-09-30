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
  eye: "b08d11b2",
  boar: "81c72155",
  knight: "c1a3644c",
  bomber: "3f24b069",
  laserEye: "78460525",
  golem: "4cf19468",
  bat: "49d40965",
  wisp: "9f46975a",
  kingSlime: "4e6d6f6d",
  boneLord: "626f4101",
  poisonSlime: "a42951a9",
  iceSlime: "74e15f57",
  fireSlime: "109c1bd5",
  goldSlime: "f2105dcb",
  boneBoar: "d0f092f8",
  boarDouble: "4a23fcc7",
  curseEye: "7b95c24a",
  frostEye: "5d12cf4f",
  blackKnight: "3f01f48a",
  lavaGolem: "7aa5d1ed",
  frostGolem: "c8a90faa",
  crystalGolem: "ca61a5c9",
  frostWisp: "e625cd8e",
  purpleLaser: "2454e2b5",
  flyingBook: "ea26977c",
  ashBat: "649de9a2",
  sproutSlime: "1c033a14",
  spikeRat: "f759195e",
  twinEye: "15421751",
  triLaser: "755d5533",
  shadowBat: "1f44eff5",
  wolf: "c5d2c4bd",
  multiBomber: "c2cd41d8",
  spearman: "83946093",
  hornBeetle: "125868df",
  netter: "0a0088db",
  carrionFly: "da3e9233",
  thunderWisp: "625c1edc",
  skeleton: "41084e95",
  fuseRat: "4e1b0271",
  crystalMite: "a6c59cac",
  echoStriker: "1de1d679",
  packLeader: "c40240e0",
  manaLeech: "f1920666",
  scavenger: "00209f36",
  graveBell: "00851971",
  silencer: "e096f587",
  frostCrusher: "e2d8bff9",
  twinShade: "9e44e786",
  mimic: "70ca32bf",
  hollowArmor: "e59986a7",
  hollowWraith: "59dd8240",
  boneConductor: "40f9ec71",
  twinBrother: "473b9f23",
  twinSister: "f10228a7",
  frostGiant: "ebf31b07",
  icePillar: "ad3bb09d",
  trainingDummy: "e6f9270f",
  mirrorSelf: "8debc0c8",
  mudman: "35e15334",
  toad: "557fd72c",
  oiler: "b9c80248",
  flameEater: "503d9d35",
  windSprite: "e6e765bb",
  mineLayer: "6558def0",
  enemyMine: "6ebccb39",
  bellImp: "d79e8863",
  bannerBearer: "c5d0edd8",
  banner: "4ba2dbaf",
  burrower: "26340bf0",
  dropper: "0d10e43a",
  absorber: "b2905f5a",
  homunculus: "f2384a6f",
  scribeImp: "18f1ffe5",
  crossGolem: "406dc115",
  chainWarden: "39ea63ac",
  hollow: "af3f3fab",
  lurker: "ea85090b",
  iceBoar: "b750f07b",
  sootBomber: "f75bdfa2",
  mossGolem: "97650602",
  swampWisp: "8a867322",
  frostToad: "77f952fc",
  magmaToad: "f9161942",
  oilSlime: "1dc47430",
  stormEye: "96b79e0a",
  emberRat: "bde39190",
  giantToad: "143e5c9d",
  forgeMaster: "0f260e89",
  anvil: "00851971",
  turretMaster: "1653ddcc",
  turret: "3d9107f3",
  basilisk: "546f9398",
  shadowStalker: "350d9daa",
  oilKing: "5648cdee",
  broodMother: "5648cdee",
  broodEgg: "62841a10",
  librarian: "6595b9be",
  mirrorKnight: "5648cdee",
  mirrorImage: "6036338f",
  thiefKing: "6595b9be",
  thief: "bda8bec5",
  reaperShade: "82a31627",
  merchant: "d8347cad",
  crate: "2d962a73",
  pot: "2d962a73",
  deepLord: "53fe0380",
  gatePillar: "e6f9270f",
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
