import { describe, expect, it } from "vitest";
import { step } from "../core/game";
import type { FrameInput } from "../core/input";
import { FIXED_DT } from "../core/loop";
import type { Enemy, GameState, Projectile } from "../core/state";
import { hasStatus } from "./statusEffects";
import { FORM, ULTIMATE } from "../data/tuning";
import { KUNAI_SENBON } from "../data/weaponForms";
import { MOVESETS } from "../data/weapons";
import { bulletDef } from "../loot/bullets";
import { livePins, pinCount, stickPin } from "./pins";
import { arena, placeEnemy, withInput } from "./testHelpers";
import { tryUltimate } from "./ultimates";

/**
 * クナイの技の一式（docs/ideas/gun-bases-review.md 2-9）: 刺さる投げ・叩き込み（傷と戦意）・千本・影留め・離れ投げ・奥義 3 本。
 * 実際の入力（step）で確かめる。表示文字列ではなく本数・傷・戦意・状態で検証する
 */

const TOUGH_HP = 99999;
const NO_ATTACK_COOLDOWN = 99;
const MAX_STEPS = 600;
const NEAR = 18;
const STUCK_DAMAGE = 10;
const KUNAI_PIN = bulletDef("kunai").pin;

function tough(e: Enemy): Enemy {
  e.attackCooldown = NO_ATTACK_COOLDOWN;
  e.hp = TOUGH_HP;
  e.maxHp = TOUGH_HP;
  return e;
}

function kunaiArena(): GameState {
  return arena(5, { moveset: "kunai", bullet: "kunai" });
}

function playerShots(state: GameState): Projectile[] {
  return state.projectiles.filter((pr) => pr.owner === "player");
}

function frame(state: GameState, input: Partial<FrameInput>): void {
  step(state, withInput(input), FIXED_DT);
}

/** 左を 1 回押して 1 ステップ進める（押しっぱなしにしない） */
function pressLeft(state: GameState): void {
  frame(state, { attackPressed: true, attackHeld: true });
  frame(state, {});
}

/** 右を 1 回押す（右は押しっぱなしの差で押した瞬間を取るので、次のステップで離す） */
function pressRight(state: GameState): void {
  frame(state, { shootHeld: true });
  frame(state, {});
}

function runUntil(state: GameState, done: () => boolean): void {
  for (let i = 0; i < MAX_STEPS && !done(); i++) frame(state, {});
  expect(done(), "条件に届いた").toBe(true);
}

/** 右を押して、その振りが終わるまで進める（当たりは振りの active に出る） */
function swingRight(state: GameState): void {
  pressRight(state);
  runUntil(state, () => swingDone(state));
}

function swingDone(state: GameState): boolean {
  return state.player.attack.phase === "none";
}

function pinDef(): NonNullable<typeof KUNAI_PIN> {
  if (KUNAI_PIN === undefined) throw new Error("クナイの弾に pin が無い");
  return KUNAI_PIN;
}

describe("クナイの投げ（左）", () => {
  it("弾は刺さる弾（1 体に最大 3 本・5 秒で抜ける）で、貫通しない", () => {
    const pin = pinDef();
    expect(pin.kind).toBe("kunai");
    expect(pin.max, "1 体に 3 本").toBe(3);
    expect(pin.sec, "5 秒で抜ける").toBe(5);
    expect(pin.driveMul, "叩き込みは倍率つき").toBeGreaterThan(1);
    expect(bulletDef("kunai").pierceBonus, "貫通しない").toBe(0);
  });

  it("当たったクナイは消えて敵に刺さり、後ろの敵には届かない（1 本投げ）", () => {
    const state = kunaiArena();
    const front = tough(placeEnemy(state, "boar", 40));
    const back = tough(placeEnemy(state, "boar", 80));
    pressLeft(state);
    expect(playerShots(state).length, "1 本投げ").toBe(1);
    runUntil(state, () => pinCount(state, front) > 0);
    expect(playerShots(state).length, "刺さって消える").toBe(0);
    expect(pinCount(state, back), "後ろの敵には刺さらない").toBe(0);
  });

  it("同じ敵に 4 本投げても刺さるのは 3 本で、5 秒たつと抜ける", () => {
    const state = kunaiArena();
    const e = tough(placeEnemy(state, "boar", 30));
    for (let i = 0; i < 4; i++) stickPin(state, e, pinDef(), 0, STUCK_DAMAGE);
    expect(pinCount(state, e, "kunai"), "上限 3 本").toBe(3);
    state.time += pinDef().sec + 0.1;
    expect(pinCount(state, e, "kunai"), "抜ける").toBe(0);
  });
});

/** 斬りの押しで飛んだ敵を、次の斬りが届く位置へ戻す（実際は追いかけて詰める） */
function bringBack(state: GameState, e: Enemy): void {
  e.body.pos = { x: state.player.body.pos.x + NEAR, y: state.player.body.pos.y };
  e.body.vel = { x: 0, y: 0 };
}

describe("叩き込み（右の連撃）", () => {
  function stuck(state: GameState, n: number): Enemy {
    const e = tough(placeEnemy(state, "boar", NEAR));
    for (let i = 0; i < n; i++) stickPin(state, e, pinDef(), 0, STUCK_DAMAGE);
    return e;
  }

  it("前の 2 段は古い順に 1 本ずつ、叩き込みの段は残りを全部叩き込み、1 本ごとに大きな傷と戦意", () => {
    const state = kunaiArena();
    const e = stuck(state, 3);
    const hit = (): number => TOUGH_HP - e.hp;
    swingRight(state);
    expect(pinCount(state, e), "逆手斬りは 1 本").toBe(2);
    expect(state.player.morale.value, "戦意は叩き込んだ本数").toBe(1 * FORM.dart.gain.pinDriven);
    bringBack(state, e);
    swingRight(state);
    expect(pinCount(state, e), "返し斬りも 1 本").toBe(1);
    bringBack(state, e);
    const before = hit();
    swingRight(state);
    expect(pinCount(state, e), "叩き込みは全部").toBe(0);
    expect(state.player.morale.value, "3 本ぶんの戦意").toBe(3 * FORM.dart.gain.pinDriven);
    // 叩き込んだ 1 本の傷は刺さったときの威力 × 倍率（斬りの傷の上に乗る）
    expect(hit() - before, "叩き込んだ傷").toBeGreaterThanOrEqual(STUCK_DAMAGE * pinDef().driveMul);
  });

  it("刺さっていない敵を斬っても戦意は溜まらず、叩き込みは起きない", () => {
    const state = kunaiArena();
    const e = tough(placeEnemy(state, "boar", NEAR));
    pressRight(state);
    expect(pinCount(state, e)).toBe(0);
    expect(state.player.morale.value, "叩き込みが無い").toBe(0);
  });
});

describe("千本（戦意が満ちた後の左）", () => {
  it("戦意は 6 で満ちる。満ちた後の左は扇に 5 本投げ、刺さりの上限を超えて刺さり、戦意を使い切る", () => {
    expect(FORM.dart.max, "最大 6").toBe(6);
    expect(FORM.dart.releaseMin, "放つには 6").toBe(6);
    const state = kunaiArena();
    state.player.morale.value = FORM.dart.max;
    frame(state, {});
    pressLeft(state);
    const shots = playerShots(state);
    expect(shots.length, "扇に 5 本").toBe(KUNAI_SENBON.count);
    expect(new Set(shots.map((s) => Math.round(Math.atan2(s.vel.y, s.vel.x) * 1000))).size, "向きが違う 5 本").toBe(KUNAI_SENBON.count);
    for (const s of shots) expect(s.shot?.pin?.max, "刺さりの上限を広げる").toBe(KUNAI_SENBON.pinMax);
    expect(state.player.morale.value, "戦意を使い切る").toBe(0);
    expect(KUNAI_SENBON.pinMax, "普段の上限より多く刺さる").toBeGreaterThan(pinDef().max);
  });

  it("満ちていない左は 1 本だけ（扇にならない）", () => {
    const state = kunaiArena();
    state.player.morale.value = FORM.dart.max - 1;
    frame(state, {});
    pressLeft(state);
    expect(playerShots(state).length).toBe(1);
  });

  it("千本は同じ敵に 3 本を超えて刺さる", () => {
    const state = kunaiArena();
    // 扇の端まで当たるよう、近くの大きな的に向けて撃つ
    const e = tough(placeEnemy(state, "boar", 14));
    e.body.radius = 40;
    state.player.morale.value = FORM.dart.max;
    frame(state, {});
    pressLeft(state);
    runUntil(state, () => playerShots(state).length === 0);
    expect(pinCount(state, e, "kunai"), "3 本を超えて刺さる").toBeGreaterThan(pinDef().max);
    expect(livePins(state, e).length).toBeLessThanOrEqual(KUNAI_SENBON.pinMax);
  });
});

describe("派生（左左右の影留め・右右左の離れ投げ）", () => {
  it("影留め（左左右）: 足元へ投げたクナイが刺さった敵を 0.6 秒止める", () => {
    const state = kunaiArena();
    const e = tough(placeEnemy(state, "boar", NEAR));
    pressLeft(state);
    pressLeft(state);
    pressRight(state);
    expect(state.player.attack.branch, "影留めの派生が出る").toBeGreaterThanOrEqual(0);
    runUntil(state, () => hasStatus(e.status, "paralyze"));
    expect(pinCount(state, e, "kunai"), "クナイが刺さる").toBeGreaterThan(0);
    const paralyze = e.status.effects.find((s) => s.kind === "paralyze");
    expect(paralyze?.time ?? 0, "止まる秒").toBeLessThanOrEqual(0.6 + 1e-9);
    expect(paralyze?.time ?? 0).toBeGreaterThan(0.3);
  });

  it("影留めの派生は足元へ短く投げる弾（寿命が短い）で、足止めを持つ", () => {
    const branch = MOVESETS.kunai.branches.find((b) => b.key === "shadowPin");
    expect(branch?.sequence).toEqual(["primary", "primary", "secondary"]);
    expect(branch?.shots?.lifeMul ?? 1, "足元へ").toBeLessThan(0.3);
    expect(branch?.shots?.applies?.[0]?.kind).toBe("paralyze");
    expect(branch?.shots?.applies?.[0]?.duration).toBe(0.6);
  });

  it("離れ投げ（右右左）: 後ろへ跳びながらクナイを 2 本投げる", () => {
    const state = kunaiArena();
    tough(placeEnemy(state, "boar", 300));
    const x0 = state.player.body.pos.x;
    swingRight(state);
    swingRight(state);
    const x1 = state.player.body.pos.x;
    pressLeft(state);
    expect(state.player.attack.branch, "離れ投げの派生が出る").toBeGreaterThanOrEqual(0);
    expect(playerShots(state).length, "2 本投げ").toBe(2);
    runUntil(state, () => swingDone(state));
    expect(state.player.body.pos.x, "後ろ（左）へ跳ぶ").toBeLessThan(Math.min(x0, x1) - 10);
  });
});

describe("ダッシュ攻撃", () => {
  it("踏み込みの突き（短く速い突き）", () => {
    const dash = MOVESETS.kunai.dashAttack;
    expect(dash.shape.kind).toBe("thrust");
    expect(dash.lunge ?? 0, "踏み込む").toBeGreaterThan(0);
  });
});

describe("クナイの奥義", () => {
  function ready(key: string): GameState {
    const state = kunaiArena();
    state.profile.ultimates = { kunai: key };
    state.player.energy = ULTIMATE.common.cost;
    return state;
  }

  it("影縫いの陣: 周りの敵すべてにクナイを 2 本ずつ刺す（範囲の外の敵には刺さらない）", () => {
    const state = ready("kunai.shadowStitch");
    const a = tough(placeEnemy(state, "boar", 40));
    const b = tough(placeEnemy(state, "boar", -50, 20));
    const far = tough(placeEnemy(state, "boar", 400));
    expect(tryUltimate(state)).toBe(true);
    expect(pinCount(state, a, "kunai"), "近い敵に 2 本").toBe(ULTIMATE.defs.kunai.shadowStitch.pinNova.pins);
    expect(pinCount(state, b, "kunai"), "背中側の敵にも 2 本").toBe(2);
    expect(pinCount(state, far), "範囲の外").toBe(0);
    expect(livePins(state, a)[0]?.damage ?? 0, "刺さったときの威力を持つ").toBeGreaterThan(0);
  });

  it("爆ぜクナイ: 刺さっているクナイをすべて炸裂させ、1 本ごとに大きな傷を入れて刺さりを消す", () => {
    const state = ready("kunai.blastKunai");
    const a = tough(placeEnemy(state, "boar", 120));
    const b = tough(placeEnemy(state, "boar", -120));
    for (let i = 0; i < 3; i++) stickPin(state, a, pinDef(), 0, STUCK_DAMAGE);
    stickPin(state, b, pinDef(), 0, STUCK_DAMAGE);
    expect(tryUltimate(state)).toBe(true);
    expect(pinCount(state, a) + pinCount(state, b), "刺さりが消える").toBe(0);
    const mul = ULTIMATE.defs.kunai.blastKunai.detonatePins.damageMul;
    expect(TOUGH_HP - a.hp, "3 本ぶん").toBeGreaterThanOrEqual(3 * STUCK_DAMAGE * mul * 0.9);
    expect(TOUGH_HP - b.hp, "1 本ぶん").toBeGreaterThanOrEqual(STUCK_DAMAGE * mul * 0.9);
  });

  it("暗器: 持続中は叩き込みの傷が大きく、投げが 2 本ずつになる", () => {
    const drive = (hidden: boolean): number => {
      const state = ready("kunai.hiddenArms");
      const e = tough(placeEnemy(state, "boar", NEAR));
      if (hidden) {
        expect(tryUltimate(state), "発動").toBe(true);
        state.hitstop = 0;
      }
      for (let i = 0; i < 3; i++) stickPin(state, e, pinDef(), 0, 100);
      const before = e.hp;
      // 逆手斬り（1 本叩き込む）の傷の差で比べる
      swingRight(state);
      return before - e.hp;
    };
    const plain = drive(false);
    const boosted = drive(true);
    expect(boosted, "暗器の傷は大きい").toBeGreaterThan(plain);

    const state = ready("kunai.hiddenArms");
    tryUltimate(state);
    state.hitstop = 0;
    pressLeft(state);
    expect(playerShots(state).length, "2 本投げ").toBe(2);
  });
});
