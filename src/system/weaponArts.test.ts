import { describe, expect, it } from "vitest";
import { step } from "../core/game";
import type { FrameInput } from "../core/input";
import { FIXED_DT } from "../core/loop";
import type { Enemy, GameState, Projectile } from "../core/state";
import { WEAPON } from "../data/tuning";
import { GUN_MOVESETS, MOVESETS, actionCooldown, bulletFeatures } from "../data/weapons";
import { botInput, createBotState } from "../qa/bot";
import { SKILL } from "../skills/data";
import { stoneFromSeed } from "../skills/generator";
import { damagePlayer } from "./combat";
import { playerMoveset, shotDamage, updatePlayer } from "./player";
import { createSkillRunState, updateSkills } from "./skills";
import { arena, placeEnemy, withInput } from "./testHelpers";
import { bulletDef } from "../loot/bullets";

/**
 * 右クリックの固有技（docs/ideas/weapon-redesign.md 3 章 / system/weaponArts.ts）と銃の家系。
 * 実際の入力（step）を通して、技の種類ごとの出方・再使用・被弾への効き方を状態と数値で確かめる
 */

const TOUGH_HP = 99999;
const NO_ATTACK_COOLDOWN = 99;
/** 振り・技を終えるまで待つ上限のステップ */
const SETTLE_STEPS = 90;
const HIT = 10;

function tough(e: Enemy): Enemy {
  e.attackCooldown = NO_ATTACK_COOLDOWN;
  e.hp = TOUGH_HP;
  e.maxHp = TOUGH_HP;
  return e;
}

function play(state: GameState, frames: readonly Partial<FrameInput>[]): void {
  for (const f of frames) step(state, withInput(f), FIXED_DT);
}

const idle = (n: number): Partial<FrameInput>[] => Array.from({ length: n }, () => ({}));
const holdRight = (n: number): Partial<FrameInput>[] => Array.from({ length: n }, () => ({ shootHeld: true }));
const stepsFor = (sec: number): number => Math.ceil(sec / FIXED_DT);

function playerShots(state: GameState): Projectile[] {
  return state.projectiles.filter((pr) => pr.owner === "player");
}

/** 弾の性質（作業領域の key から弾を引き直す） */
function featuresOf(pr: Projectile | undefined): string[] {
  const key = pr?.shot?.key;
  return key === undefined ? [] : bulletFeatures(bulletDef(key));
}

function branchKey(state: GameState): string | undefined {
  return playerMoveset(state).branches[state.player.attack.branch]?.key;
}

describe("右クリックの固有技", () => {
  it("右クリックは武器種の固有技を出す（剣は受け流し、大剣は薙ぎ払い）", () => {
    const sword = arena(5);
    play(sword, [{ shootHeld: true }]);
    expect(sword.player.art.holding, "剣は受け流しの構え").toBe(true);
    expect(sword.player.attack.phase, "剣の右は振らない").toBe("none");
    expect(playerShots(sword), "剣の右は撃たない").toHaveLength(0);

    const gs = arena(5, { moveset: "greatsword" });
    play(gs, [{ shootHeld: true }]);
    expect(branchKey(gs), "大剣は薙ぎ払い").toBe("sweep");
  });

  it("strike の技は派生として branches に混ざり、長い列の派生が優先される（左左右 → 兜割り）", () => {
    const state = arena(5, { moveset: "greatsword" });
    play(state, [{ attackPressed: true }, ...idle(3), { attackPressed: true }, ...idle(3), { shootHeld: true }]);
    for (let i = 0; i < SETTLE_STEPS && state.player.attack.branch < 0; i++) step(state, withInput({}), FIXED_DT);
    expect(branchKey(state)).toBe("helmSplitter");
  });

  it("受け流しの窓の被弾は無効化され、相手が怯みカウンター扱いになる", () => {
    const state = arena(5);
    const e = tough(placeEnemy(state, "boar", 14));
    e.phase = "windup";
    play(state, [{ shootHeld: true }]);
    const hp = state.player.hp;
    state.events.length = 0;
    const result = damagePlayer(state, HIT, e.body.pos, e);
    expect(result, "被弾しない").toBe("ignored");
    expect(state.player.hp, "生命が減らない").toBe(hp);
    expect(e.poise.damage, "相手に怯み値が入った").toBeGreaterThan(0);
    expect(state.events.some((ev) => ev.kind === "onCounter"), "カウンター扱い").toBe(true);
    expect(state.player.invulnTimer, "受け流した直後は無敵").toBeGreaterThan(0);
    expect(state.player.art.recover, "成功なら硬直しない").toBe(0);
  });

  it("受け流しの窓を過ぎた被弾は通り、外した硬直が付く", () => {
    const state = arena(5);
    const e = tough(placeEnemy(state, "boar", 14));
    const parry = WEAPON.movesets.sword.art.hold.parry;
    play(state, holdRight(stepsFor(parry.windowSec) + 1));
    expect(state.player.art.holding, "窓が閉じた").toBe(false);
    expect(state.player.art.recover, "外した硬直").toBeGreaterThan(0);
    const hp = state.player.hp;
    expect(damagePlayer(state, HIT, e.body.pos, e)).toBe("hit");
    expect(state.player.hp, "生命が減る").toBeLessThan(hp);
  });

  it("盾の構えは前方の被ダメを減らし、後ろからは減らさない", () => {
    const lossFrom = (dx: number, guarding: boolean): number => {
      const state = arena(5, { moveset: "shield" });
      state.player.facing = { x: 1, y: 0 };
      if (guarding) play(state, holdRight(3));
      state.player.facing = { x: 1, y: 0 };
      state.player.invulnTimer = 0;
      const hp = state.player.hp;
      const from = { x: state.player.body.pos.x + dx, y: state.player.body.pos.y };
      damagePlayer(state, HIT * 4, from);
      return hp - state.player.hp;
    };
    const open = lossFrom(20, false);
    expect(lossFrom(20, true), "前からは減る").toBeLessThan(open);
    expect(lossFrom(-20, true), "後ろからは減らない").toBe(lossFrom(-20, false));
  });

  it("構えを離すと盾押しが出る", () => {
    const state = arena(5, { moveset: "shield" });
    play(state, [...holdRight(10), {}]);
    expect(state.player.art.holding, "離した").toBe(false);
    expect(branchKey(state), "盾押し").toBe("guard.release");
    expect(state.player.attack.phase).not.toBe("none");
  });

  it("斧の投擲は戻る弾を出し、再使用が明ける前は出ない", () => {
    const state = arena(5, { moveset: "axe" });
    play(state, [{ shootHeld: true }, {}]);
    const first = playerShots(state);
    expect(first, "1 本投げた").toHaveLength(1);
    expect(featuresOf(first[0]), "行って戻る弾").toEqual(["boomerang"]);
    expect(first[0]?.kind, "射撃扱い").toBe("ranged");
    expect(first[0]?.attack, "弾の素性は技のもの").toEqual(MOVESETS.axe.steps2[0].kind === "volley" ? MOVESETS.axe.steps2[0].throw.attack : undefined);
    expect(state.player.art.cooldown, "再使用が立った").toBeGreaterThan(0);
    const before = state.projectiles.length;
    play(state, [{ shootHeld: true }, {}]);
    expect(state.projectiles.length, "再使用中は投げない").toBeLessThanOrEqual(before);
  });

  it("手元返しで自分の弾が反転し、戻りは強く当たる", () => {
    const state = arena(5, { moveset: "thrown", bullet: "pistol" });
    play(state, [{ attackHeld: true }, ...idle(5)]);
    const shot = playerShots(state)[0];
    if (!shot) throw new Error("弾が出ていない");
    expect(shot.vel.x, "前へ飛んでいる").toBeGreaterThan(0);
    const damage = shot.damage;
    play(state, [{ shootHeld: true }]);
    expect(shot.vel.x, "手元へ向いた").toBeLessThan(0);
    expect(shot.damage).toBeCloseTo(damage * WEAPON.movesets.thrown.art.recall.returnDamageMul);
  });

  it("技の再使用中は右を押しても何も起きず、入力列にも積まない", () => {
    const state = arena(5, { moveset: "axe" });
    play(state, [{ shootHeld: true }, {}]);
    const inputs = [...state.player.attack.inputs];
    const count = state.projectiles.length;
    play(state, [{ shootHeld: true }]);
    expect(state.player.attack.inputs, "入力列は変わらない").toEqual(inputs);
    expect(state.projectiles.length, "投げない").toBeLessThanOrEqual(count);
  });

  it("双剣の影踏みは踏み込みの間だけ無敵", () => {
    const state = arena(5, { moveset: "twinBlades" });
    play(state, [{ shootHeld: true }]);
    expect(branchKey(state)).toBe("shadowStep");
    expect(state.player.invulnTimer, "踏み込み中は無敵").toBeGreaterThan(0);
  });

  it("砲の零距離砲は自分が後ろへ跳び、床の自分の設置弾をすべて起爆する", () => {
    const state = arena(5, { moveset: "cannon", bullet: "mineLauncher" });
    play(state, [{ attackHeld: true }, ...idle(20)]);
    const mine = playerShots(state)[0];
    if (!mine) throw new Error("設置弾が出ていない");
    state.player.facing = { x: 1, y: 0 };
    play(state, [{ shootHeld: true }]);
    expect(branchKey(state)).toBe("pointBlank");
    expect(state.player.knock.x, "後ろへ押された").toBeLessThan(0);
    play(state, idle(2));
    expect(mine.shot?.detonated, "設置弾が炸裂した").toBe(true);
  });

  it("短銃の狙い撃ち: 溜めて離すと強く貫く 1 発、溜めずに離すと普通の 1 発", () => {
    const aim = WEAPON.movesets.sidearm.art.aim;
    const tap = arena(5, { moveset: "sidearm" });
    play(tap, [{ shootHeld: true }, {}]);
    const weak = playerShots(tap);
    expect(weak, "1 発").toHaveLength(1);

    const charged = arena(5, { moveset: "sidearm" });
    play(charged, [...holdRight(stepsFor(aim.time) + 2), {}]);
    const strong = playerShots(charged);
    expect(strong, "1 発").toHaveLength(1);
    expect(strong[0]?.damage ?? 0, "威力が上がる").toBeCloseTo((weak[0]?.damage ?? 0) * aim.damageMul);
    expect(strong[0]?.pierceLeft, "貫通が増える").toBe((weak[0]?.pierceLeft ?? 0) + aim.pierceBonus);
  });

  it("変身中の右クリックは変身が引き受ける（遠吠え）", () => {
    const state = arena(5);
    const stone = { ...stoneFromSeed(901, { foundDepth: 1, now: 0, skillKey: "wolfForm" }), variants: [], links: 0 };
    state.skills = createSkillRunState({ version: 1, loadout: [stone.id], stones: [stone] });
    updateSkills(state, withInput({}), 0);
    state.player.mana = state.stats.maxMana;
    const near = tough(placeEnemy(state, "slime", 30));
    near.phase = "idle";
    updatePlayer(state, withInput({ skill1Pressed: true }), FIXED_DT);
    expect(state.skills.shape?.key).toBe("wolfForm");
    updatePlayer(state, withInput({ shootHeld: true }), FIXED_DT);
    expect(near.status.effects.some((s) => s.kind === "fear"), "遠吠えで恐怖").toBe(true);
    expect(state.player.art.holding, "剣の受け流しは出ない").toBe(false);
    expect(SKILL.wolfForm.howlRadius).toBeGreaterThan(30);
  });
});

describe("銃の家系", () => {
  it("銃の家系だけ左で撃ち、近接の武器種では左を押しても弾が出ない", () => {
    const sword = arena(5);
    play(sword, [{ attackPressed: true, attackHeld: true }, { attackHeld: true }]);
    expect(playerShots(sword), "剣は撃たない").toHaveLength(0);
    expect(sword.player.attack.phase, "剣は振る").not.toBe("none");

    for (const key of GUN_MOVESETS) {
      const gun = arena(5, { moveset: key });
      play(gun, [{ attackPressed: true, attackHeld: true }]);
      expect(playerShots(gun).length, `${key} は左で撃つ`).toBeGreaterThan(0);
      expect(gun.player.attack.phase, `${key} は振らない`).toBe("none");
    }
  });

  it("弾はベースのまま（短銃の三連銃は三点）", () => {
    const state = arena(5, { moveset: "sidearm", bullet: "burstRifle" });
    play(state, Array.from({ length: 12 }, () => ({ attackHeld: true })));
    expect(playerShots(state), "三点").toHaveLength(bulletDef("burstRifle").burst?.count ?? 0);
    expect(playerShots(state)[0]?.damage).toBeCloseTo(shotDamage(state.stats) * bulletDef("burstRifle").damageMul);
  });

  it("長銃の銃剣突きは近接として当たる", () => {
    const state = arena(5, { moveset: "longarm" });
    const e = tough(placeEnemy(state, "boar", 20));
    play(state, [{ shootHeld: true }, ...idle(20)]);
    expect(state.player.meleeHitCount, "突きが当たった").toBeGreaterThan(0);
    expect(e.hp).toBeLessThan(TOUGH_HP);
    expect(actionCooldown(MOVESETS.longarm.steps2[0])).toBeGreaterThan(0);
  });

  it("擲弾は左で照準の地点へ曲射を撃ち、右の筒払いは近接で当てて自分が後ろへ下がる", () => {
    const lob = arena(5, { moveset: "grenade", bullet: "mortar" });
    play(lob, [{ attackHeld: true }]);
    expect(featuresOf(playerShots(lob)[0]), "左は曲射").toEqual(["lob"]);

    const state = arena(5, { moveset: "grenade", bullet: "mortar" });
    const e = tough(placeEnemy(state, "boar", 20));
    play(state, [{ shootHeld: true }]);
    expect(branchKey(state)).toBe("tubeBash");
    expect(state.player.knock.x, "後ろへ下がった").toBeLessThan(0);
    play(state, idle(20));
    expect(e.hp, "筒払いが当たった").toBeLessThan(TOUGH_HP);
    expect(playerShots(state), "筒払いは弾を出さない").toHaveLength(0);
  });

  it("仕掛けの撒き散らしは設置弾を扇に 3 つ出し、再使用が明ける前は出ない", () => {
    const state = arena(5, { moveset: "trapper", bullet: "mineLauncher" });
    play(state, [{ shootHeld: true }, {}]);
    const mines = playerShots(state);
    expect(mines, "3 つ撒いた").toHaveLength(WEAPON.movesets.trapper.art.throw.count);
    for (const m of mines) expect(featuresOf(m), "設置弾").toEqual(["mine"]);
    const angles = new Set(mines.map((m) => Math.round(Math.atan2(m.vel.y, m.vel.x) * 100)));
    expect(angles.size, "扇に散る").toBe(mines.length);
    expect(state.player.art.cooldown, "再使用が立った").toBeGreaterThan(0);
    play(state, [{ shootHeld: true }, {}]);
    expect(playerShots(state).length, "再使用中は撒かない").toBe(mines.length);
  });

  it("戦輪は左で回転刃を投げ、右の輪払いは背中側の敵にも近接で当たる", () => {
    const ring = arena(5, { moveset: "warRing", bullet: "returnChakram" });
    play(ring, [{ attackHeld: true }]);
    expect(featuresOf(playerShots(ring)[0]), "左は回転刃").toEqual(["boomerang"]);

    const state = arena(5, { moveset: "warRing", bullet: "returnChakram" });
    // 220 度の扇なので、向きから 100 度ずれた敵にも届く
    const side = tough(placeEnemy(state, "boar", -4, 18));
    play(state, [{ shootHeld: true }, ...idle(20)]);
    expect(state.player.meleeHitCount, "輪払いが当たった").toBeGreaterThan(0);
    expect(side.hp).toBeLessThan(TOUGH_HP);
  });
});

describe("QA bot と固有技", () => {
  function botArena(moveset: "sidearm" | "greatsword", dx: number): GameState {
    const state = arena(5, { moveset });
    state.skills = createSkillRunState({ version: 1, loadout: [], stones: [] });
    // 攻撃間隔の長い敵（先読みの回避を評価しない）
    const e = tough(placeEnemy(state, "golem", dx));
    e.phase = "chase";
    return state;
  }

  it("bot は銃なら左を押し、近接なら右の技を周期的に使う", () => {
    const gun = botArena("sidearm", 60);
    const gunInput = botInput(gun, createBotState(1), FIXED_DT);
    expect(gunInput.attackHeld, "銃は左を押す").toBe(true);

    const melee = botArena("greatsword", 16);
    const bot = createBotState(1);
    const first = botInput(melee, bot, FIXED_DT);
    expect(first.shootHeld, "射程内で右の技を押す").toBe(true);
    const second = botInput(melee, bot, FIXED_DT);
    expect(second.shootHeld, "続けては押さない").toBe(false);
    expect(second.attackPressed, "間は左で振る").toBe(true);
  });
});
