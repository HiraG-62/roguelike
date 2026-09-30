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
  slime: "fb502c62",
  eye: "3f7eadf4",
  boar: "9446534c",
  knight: "c9b06c27",
  bomber: "85472154",
  laserEye: "a640cb39",
  golem: "011f9a33",
  bat: "6d812ff8",
  wisp: "d0beabb6",
  kingSlime: "0937a78d",
  boneLord: "0d49402d",
  poisonSlime: "96a19a93",
  iceSlime: "7b513f38",
  fireSlime: "53948419",
  goldSlime: "bd13b247",
  boneBoar: "869ac94c",
  boarDouble: "3c3db111",
  curseEye: "5202fab6",
  frostEye: "e6940371",
  blackKnight: "82e21f7a",
  lavaGolem: "ce34c1ea",
  frostGolem: "809e591b",
  crystalGolem: "b5c170cb",
  frostWisp: "8041c52e",
  purpleLaser: "7667c7ee",
  flyingBook: "7a7ddc08",
  ashBat: "fece6a4e",
  sproutSlime: "78a366ab",
  spikeRat: "8c64a26d",
  twinEye: "300238d2",
  triLaser: "2170679c",
  shadowBat: "f03f932c",
  wolf: "2f8a64ac",
  multiBomber: "071470e0",
  spearman: "50898fb0",
  hornBeetle: "bb2ef024",
  netter: "2bc279f3",
  carrionFly: "43060f1e",
  thunderWisp: "1cd87728",
  skeleton: "9fd44d61",
  fuseRat: "d8d28e38",
  crystalMite: "56819800",
  echoStriker: "48376979",
  packLeader: "c7c58d12",
  manaLeech: "6f40717c",
  scavenger: "59982fa7",
  graveBell: "0d4e1520",
  silencer: "d73c9531",
  frostCrusher: "c2137195",
  twinShade: "a287aead",
  mimic: "d8d6425d",
  hollowArmor: "d481a841",
  hollowWraith: "aeb00a3a",
  boneConductor: "d5d46f19",
  twinBrother: "6c16625f",
  twinSister: "84ce6d8b",
  frostGiant: "4d9df5f7",
  icePillar: "c5ed1a5d",
  trainingDummy: "b195395b",
  mirrorSelf: "5e478ae2",
  mudman: "af78ea7e",
  toad: "41115245",
  oiler: "31311329",
  flameEater: "99b764bf",
  windSprite: "f08713f7",
  mineLayer: "40b8b6f3",
  enemyMine: "f2714feb",
  bellImp: "f5bde18b",
  bannerBearer: "093ae706",
  banner: "8b061999",
  burrower: "e26463c1",
  dropper: "cde813c8",
  absorber: "8188028a",
  homunculus: "d11b0501",
  scribeImp: "5a72a636",
  crossGolem: "d6f4a387",
  chainWarden: "85daf170",
  hollow: "1185de3d",
  lurker: "f1e8c518",
  iceBoar: "02d77948",
  sootBomber: "386e47e4",
  mossGolem: "d2b37831",
  swampWisp: "fba99a1c",
  frostToad: "15b14f7d",
  magmaToad: "d5cee06b",
  oilSlime: "94d12905",
  stormEye: "05fe7583",
  emberRat: "cbfde132",
  giantToad: "625ac5cc",
  forgeMaster: "1cd93145",
  anvil: "5daae70d",
  turretMaster: "a383bde0",
  turret: "334bd0b4",
  basilisk: "5e04082f",
  shadowStalker: "98c26f36",
  oilKing: "a21b26b6",
  broodMother: "a21b26b6",
  broodEgg: "62841a10",
  librarian: "e82e1a1a",
  mirrorKnight: "a21b26b6",
  mirrorImage: "1449b5b6",
  thiefKing: "e82e1a1a",
  thief: "f0bc19c4",
  reaperShade: "59f50234",
  merchant: "962bded5",
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
