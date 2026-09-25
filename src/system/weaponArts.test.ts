import { describe, expect, it } from "vitest";
import { step } from "../core/game";
import type { FrameInput } from "../core/input";
import { FIXED_DT } from "../core/loop";
import type { Enemy, GameState, Projectile } from "../core/state";
import { PLAYER, WEAPON } from "../data/tuning";
import type { Vec } from "../core/vec";
import { VIEW_H, VIEW_W } from "../core/view";
import { type ActionStepDef, type MovesetKey, GUN_MOVESETS, MOVESETS, actionCooldown, bulletFeatures } from "../data/weapons";
import { botInput, createBotState } from "../qa/bot";
import { SKILL } from "../skills/data";
import { stoneFromSeed } from "../skills/generator";
import { damagePlayer } from "./combat";
import { nextLaneIndex, playerMoveset, shotDamage, updatePlayer } from "./player";
import { createSkillRunState, updateSkills } from "./skills";
import { arena, placeEnemy, withInput } from "./testHelpers";
import { actionCooldownLeft, onBranchStart } from "./weaponArts";
import { bulletDef } from "../loot/bullets";

/**
 * 右クリック = アクション 2（右レーン。docs/ideas/ougi-and-dual-actions.md 4 章 / system/weaponArts.ts）と銃の家系。
 * 実際の入力（step）を通して、段の種類ごとの出方・段カウンタ・再使用・被弾への効き方を状態と数値で確かめる
 */

const TOUGH_HP = 99999;
const NO_ATTACK_COOLDOWN = 99;
/** 振り・段を終えるまで待つ上限のステップ */
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
/** 入力の窓（段カウンタ）が確実に切れるまでの空フレーム */
const chainReset = (): Partial<FrameInput>[] => idle(stepsFor(WEAPON.chainWindow) + 2);

/** ワールド座標 → 画面内部座標（core/view.ts の screenToWorld の逆） */
function toScreen(state: GameState, world: Vec): Vec {
  const cam = state.camera;
  const ox = Math.round(VIEW_W / 2 - cam.pos.x + cam.offset.x);
  const oy = Math.round(VIEW_H / 2 - cam.pos.y + cam.offset.y);
  return { x: world.x + ox, y: world.y + oy };
}

/** 振りが先行入力を受ける（active / recover で予約が無い）まで空の入力で進める */
function untilActive(state: GameState): void {
  for (let i = 0; i < SETTLE_STEPS; i++) {
    const a = state.player.attack;
    if ((a.phase === "active" || a.phase === "recover") && !a.buffered) return;
    step(state, withInput({}), FIXED_DT);
  }
}

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

/** 今振っている右レーンの段の key（右の振りでなければ undefined） */
function laneKey(state: GameState): string | undefined {
  const a = state.player.attack;
  if (a.lane !== "secondary" || a.branch >= 0 || a.phase === "none") return undefined;
  return playerMoveset(state).steps2[a.step]?.key;
}

function laneStepOf<K extends ActionStepDef["kind"]>(key: MovesetKey, index: number, kind: K): Extract<ActionStepDef, { kind: K }> {
  const s = MOVESETS[key].steps2[index];
  if (s?.kind !== kind) throw new Error(`${key} の右 ${index + 1} 段目は ${kind} ではない`);
  return s as Extract<ActionStepDef, { kind: K }>;
}

describe("右レーンの 1 段目（旧固有技）", () => {
  it("右の 1 段目は武器種の技を出す（剣は受け流し、大剣は薙ぎ払い）", () => {
    const sword = arena(5);
    play(sword, [{ shootHeld: true }]);
    expect(sword.player.art.holding, "剣は受け流しの構え").toBe(true);
    expect(sword.player.attack.phase, "剣の右は振らない").toBe("none");
    expect(playerShots(sword), "剣の右は撃たない").toHaveLength(0);

    const gs = arena(5, { moveset: "greatsword" });
    play(gs, [{ shootHeld: true }]);
    expect(laneKey(gs), "大剣は薙ぎ払い").toBe("sweep");
    expect(gs.player.attack.branch, "派生ではなく右レーンの段").toBe(-1);
  });

  it("名前付きの派生は右レーンの段より優先される（左左右 → 兜割り）", () => {
    const state = arena(5, { moveset: "greatsword" });
    // 派生は実際に出た段の列で照合するので、2 段目が振りを受け付ける（active）まで待ってから押す
    play(state, [{ attackPressed: true }]);
    untilActive(state);
    play(state, [{ attackPressed: true }]);
    untilActive(state);
    play(state, [{ shootHeld: true }]);
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
    expect(state.player.attack.step, "受け流しが決まると段が進む").toBe(1);
  });

  it("受け流しの窓を過ぎた被弾は通り、外した硬直が付く", () => {
    const state = arena(5);
    const e = tough(placeEnemy(state, "boar", 14));
    const parry = laneStepOf("sword", 0, "hold").hold.parry;
    if (!parry) throw new Error("剣の右 1 段目は受け流し");
    play(state, holdRight(stepsFor(parry.windowSec) + 1));
    expect(state.player.art.holding, "窓が閉じた").toBe(false);
    expect(state.player.art.recover, "外した硬直").toBeGreaterThan(0);
    const hp = state.player.hp;
    expect(damagePlayer(state, HIT, e.body.pos, e)).toBe("hit");
    expect(state.player.hp, "生命が減る").toBeLessThan(hp);
  });

  it("受け流しは右 1 段目で、離す・窓が閉じると段が進む（右右 = 受け流し → 返し斬り）", () => {
    const state = arena(5);
    play(state, [{ shootHeld: true }, {}]);
    expect(state.player.art.holding, "受け流しの窓").toBe(true);
    expect(state.player.attack.step, "受け流しは 1 段目").toBe(0);
    play(state, [{ shootHeld: true }]);
    expect(state.player.art.holding, "次の右で受け流しを解く").toBe(false);
    expect(laneKey(state), "2 段目は返し斬り").toBe("returnCut");
    expect(state.player.attack.step).toBe(1);

    const closed = arena(5);
    const parry = laneStepOf("sword", 0, "hold").hold.parry;
    play(closed, [{ shootHeld: true }, ...idle(stepsFor(parry?.windowSec ?? 0) + 1)]);
    expect(closed.player.art.holding, "窓が閉じた").toBe(false);
    expect(closed.player.attack.step, "窓が閉じても段が進む").toBe(1);
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

  it("構えを離した盾押しは今までどおり派生として出る", () => {
    const state = arena(5, { moveset: "shield" });
    play(state, [...holdRight(10), {}]);
    expect(state.player.art.holding, "離した").toBe(false);
    expect(branchKey(state), "盾押し").toBe("guard.release");
    expect(state.player.attack.phase).not.toBe("none");
    expect(actionCooldownLeft(state, MOVESETS.shield.steps2[0]), "構えの再使用は離したときに立つ").toBeGreaterThan(0);
  });

  it("構えを離した盾押しの後も、構えの右は派生の列に残る（右右左の城壁が出る）", () => {
    const state = arena(5, { moveset: "shield" });
    play(state, [...holdRight(10), {}]);
    expect(branchKey(state), "盾押し").toBe("guard.release");
    expect(state.player.attack.inputs, "構えの右は出た段として残る").toEqual(["secondary"]);
    untilActive(state);
    play(state, [{ shootHeld: true }]);
    untilActive(state);
    play(state, [{ attackPressed: true }]);
    for (let i = 0; i < SETTLE_STEPS && branchKey(state) !== "rampart"; i++) step(state, withInput({}), FIXED_DT);
    expect(branchKey(state), "右（構え）・右・左で城壁").toBe("rampart");
  });

  it("斧の投擲は戻る弾を出して段を進め、再使用が明ける前は出ない", () => {
    const state = arena(5, { moveset: "axe" });
    play(state, [{ shootHeld: true }, {}]);
    const first = playerShots(state);
    expect(first, "1 本投げた").toHaveLength(1);
    expect(featuresOf(first[0]), "行って戻る弾").toEqual(["boomerang"]);
    expect(first[0]?.kind, "射撃扱い").toBe("ranged");
    expect(first[0]?.attack, "弾の素性は段のもの").toEqual(laneStepOf("axe", 0, "volley").throw.attack);
    expect(actionCooldownLeft(state, MOVESETS.axe.steps2[0]), "再使用が立った").toBeGreaterThan(0);
    expect(state.player.attack.step, "投げたら段だけ進む").toBe(1);
    play(state, chainReset());
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
    expect(shot.damage).toBeCloseTo(damage * laneStepOf("thrown", 0, "recall").recall.returnDamageMul);
  });

  it("呼び戻した弾は近くの敵へ曲がる", () => {
    const state = arena(5, { moveset: "thrown", bullet: "pistol" });
    play(state, [{ attackHeld: true }, ...idle(5)]);
    const shot = playerShots(state)[0];
    if (!shot) throw new Error("弾が出ていない");
    const recall = laneStepOf("thrown", 0, "recall").recall;
    if (!recall.homing) throw new Error("投擲の手元返しに追尾が無い");
    // 弾と手元の間の真横（手元へ戻る直線から外れた所）に敵を置く
    const p = state.player.body.pos;
    const e = tough(placeEnemy(state, "golem", 0));
    e.body.pos = { x: (shot.pos.x + p.x) / 2, y: p.y + recall.homing.range / 3 };
    play(state, [{ shootHeld: true }]);
    expect(shot.shot?.recallHoming, "戻りの弾に追尾が写った").toEqual(recall.homing);
    const toEnemy = e.body.pos.y - shot.pos.y;
    const vy0 = shot.vel.y;
    play(state, idle(10));
    expect(Math.sign(shot.vel.y), "敵のいる側へ曲がった").toBe(Math.sign(toEnemy));
    expect(Math.abs(shot.vel.y), "向きが変わった").toBeGreaterThan(Math.abs(vy0));
  });

  it("擲弾の派生の曲射はカーソルの距離で落ちる", () => {
    const state = arena(5, { moveset: "grenade", bullet: "grenadeLauncher" });
    const aimAt = 60;
    const frame = (f: Partial<FrameInput>): Partial<FrameInput> => {
      const p = state.player.body.pos;
      return { ...f, aimScreen: toScreen(state, { x: p.x + aimAt, y: p.y }) };
    };
    // 左左右 = 双発（twinShell）。左の射撃も段として積まれる
    step(state, withInput(frame({ attackPressed: true, attackHeld: true })), FIXED_DT);
    step(state, withInput(frame({ attackPressed: true, attackHeld: true })), FIXED_DT);
    const before = playerShots(state).length;
    step(state, withInput(frame({ shootHeld: true })), FIXED_DT);
    expect(branchKey(state), "左左右の派生が出た").toBe("twinShell");
    const shells = playerShots(state).slice(before);
    expect(shells.length, "派生の弾が出た").toBeGreaterThan(0);
    for (const pr of shells) {
      const range = (pr.life + FIXED_DT) * Math.hypot(pr.vel.x, pr.vel.y);
      expect(range, "カーソルの距離で落ちる").toBeCloseTo(aimAt, 0);
    }
  });

  it("照準が無ければ最大射程", () => {
    const state = arena(5, { moveset: "grenade", bullet: "grenadeLauncher" });
    const branch = MOVESETS.grenade.branches.find((b) => b.key === "twinShell");
    if (!branch) throw new Error("双発が無い");
    state.player.aimDistance = undefined;
    onBranchStart(state, branch);
    const shell = playerShots(state)[0];
    if (!shell) throw new Error("弾が出ていない");
    const def = bulletDef("grenadeLauncher");
    const speed = Math.hypot(shell.vel.x, shell.vel.y);
    expect(shell.life * speed, "射程いっぱい").toBeCloseTo(PLAYER.shoot.life * def.lifeMul * speed, 3);

    const aimed = arena(5, { moveset: "grenade", bullet: "grenadeLauncher" });
    aimed.player.aimDistance = 50;
    onBranchStart(aimed, branch);
    const near = playerShots(aimed)[0];
    if (!near) throw new Error("弾が出ていない");
    expect(near.life * Math.hypot(near.vel.x, near.vel.y), "照準があればその距離").toBeCloseTo(50, 3);
  });

  it("再使用中の右段は入力列に積まない", () => {
    const state = arena(5, { moveset: "axe" });
    play(state, [{ shootHeld: true }, {}, ...chainReset()]);
    expect(state.player.attack.step, "窓が切れて 1 段目に戻った").toBe(0);
    const inputs = [...state.player.attack.inputs];
    const count = state.projectiles.length;
    play(state, [{ shootHeld: true }]);
    expect(state.player.attack.inputs, "入力列は変わらない").toEqual(inputs);
    expect(state.projectiles.length, "投げない").toBeLessThanOrEqual(count);
    expect(state.player.attack.phase, "振りもしない").toBe("none");
  });

  it("弾を出す右段は押した瞬間に出て段だけ進む（杖の右右右 = 魔弾・魔弾・大魔弾）", () => {
    const state = arena(5, { moveset: "wand" });
    const gap = stepsFor(WEAPON.artDefaults.laneGap) + 1;
    // 魔弾は寿命が短いので、出た弾を id で数える
    const fired = new Map<number, number>();
    const record = (): number => {
      for (const pr of playerShots(state)) if (!fired.has(pr.id)) fired.set(pr.id, pr.damage);
      return fired.size;
    };
    play(state, [{ shootHeld: true }]);
    expect(record(), "1 発目の魔弾").toBe(1);
    expect(state.player.attack.phase, "振らない").toBe("none");
    expect(state.player.attack.step, "段が進む").toBe(1);
    play(state, [...idle(gap), { shootHeld: true }]);
    expect(record(), "2 発目の魔弾").toBe(2);
    expect(state.player.attack.step).toBe(2);
    play(state, [...idle(gap), { shootHeld: true }]);
    expect(record(), "3 発目の大魔弾").toBe(3);
    const [bolt, , great] = [...fired.values()];
    expect(great ?? 0, "大魔弾は魔弾より強い").toBeGreaterThan(bolt ?? 0);
    expect(state.player.attack.step, "4 段目（杖突き）へ").toBe(3);
  });

  it("弾・手元返しの段の直後は共有の間（laneGap）が明けるまで次の弾の段を押せない", () => {
    const state = arena(5, { moveset: "wand" });
    play(state, [{ shootHeld: true }, {}, { shootHeld: true }]);
    expect(playerShots(state), "間の中の右は出ない").toHaveLength(1);
    expect(state.player.attack.step, "段も進まない").toBe(1);
  });

  it("双剣の影踏みは踏み込みの間だけ無敵", () => {
    const state = arena(5, { moveset: "twinBlades" });
    play(state, [{ shootHeld: true }]);
    expect(laneKey(state)).toBe("shadowStep");
    expect(state.player.invulnTimer, "踏み込み中は無敵").toBeGreaterThan(0);
  });

  it("砲の零距離砲は自分が後ろへ跳び、床の自分の設置弾をすべて起爆する", () => {
    const state = arena(5, { moveset: "cannon", bullet: "mineLauncher" });
    play(state, [{ attackHeld: true }, ...idle(20)]);
    const mine = playerShots(state)[0];
    if (!mine) throw new Error("設置弾が出ていない");
    state.player.facing = { x: 1, y: 0 };
    play(state, [{ shootHeld: true }]);
    expect(laneKey(state)).toBe("pointBlank");
    expect(state.player.knock.x, "後ろへ押された").toBeLessThan(0);
    play(state, idle(2));
    expect(mine.shot?.detonated, "設置弾が炸裂した").toBe(true);
  });

  it("短銃の狙い撃ち: 溜めて離すと強く貫く 1 発、溜めずに離すと普通の 1 発", () => {
    const aim = laneStepOf("sidearm", 0, "aim").aim;
    const tap = arena(5, { moveset: "sidearm" });
    play(tap, [{ shootHeld: true }, {}]);
    const weak = playerShots(tap);
    expect(weak, "1 発").toHaveLength(1);
    expect(tap.player.attack.step, "離したら段が進む").toBe(1);

    const charged = arena(5, { moveset: "sidearm" });
    play(charged, [...holdRight(stepsFor(aim.time) + 2), {}]);
    const strong = playerShots(charged);
    expect(strong, "1 発").toHaveLength(1);
    expect(strong[0]?.damage ?? 0, "威力が上がる").toBeCloseTo((weak[0]?.damage ?? 0) * aim.damageMul);
    expect(strong[0]?.pierceLeft, "貫通が増える").toBe((weak[0]?.pierceLeft ?? 0) + aim.pierceBonus);
  });

  it("変身中の右は変身が引き受ける（遠吠え）", () => {
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
    expect(state.player.attack.inputs, "右レーンの入力列にも積まない").toEqual([]);
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

  it("銃の家系は左で撃ち右で 3 段の連撃を出す", () => {
    for (const key of GUN_MOVESETS) {
      const state = arena(5, { moveset: key, bullet: "pistol" });
      tough(placeEnemy(state, "golem", 200));
      const lane = MOVESETS[key].steps2;
      expect(lane, `${key} の右は 3 段`).toHaveLength(3);
      const last = lane[2]?.key ?? "";
      expect(driveRight(state, last), `${key} は右だけで 3 段目（${last}）まで進む`).toBe(true);
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
    expect(laneKey(state)).toBe("tubeBash");
    expect(state.player.knock.x, "後ろへ下がった").toBeLessThan(0);
    play(state, idle(20));
    expect(e.hp, "筒払いが当たった").toBeLessThan(TOUGH_HP);
    expect(playerShots(state), "筒払いは弾を出さない").toHaveLength(0);
  });

  it("仕掛けの撒き散らしは設置弾を扇に 3 つ出し、再使用が明ける前は出ない", () => {
    const state = arena(5, { moveset: "trapper", bullet: "mineLauncher" });
    play(state, [{ shootHeld: true }, {}]);
    const mines = playerShots(state);
    expect(mines, "3 つ撒いた").toHaveLength(laneStepOf("trapper", 0, "volley").throw.count);
    for (const m of mines) expect(featuresOf(m), "設置弾").toEqual(["mine"]);
    const angles = new Set(mines.map((m) => Math.round(Math.atan2(m.vel.y, m.vel.x) * 100)));
    expect(angles.size, "扇に散る").toBe(mines.length);
    expect(actionCooldownLeft(state, MOVESETS.trapper.steps2[0]), "再使用が立った").toBeGreaterThan(0);
    play(state, [...chainReset(), { shootHeld: true }, {}]);
    expect(playerShots(state).length, "再使用中は撒かない").toBe(mines.length);
  });

  it("仕掛けの右 3 段目の起爆は床の自分の設置弾をすべて起爆する", () => {
    const state = arena(5, { moveset: "trapper", bullet: "mineLauncher" });
    const gap = stepsFor(WEAPON.artDefaults.laneGap) + 1;
    play(state, [{ shootHeld: true }, ...idle(gap), { shootHeld: true }]);
    expect(laneKey(state), "2 段目は罠蹴り").toBe("trapKick");
    const mine = playerShots(state)[0];
    if (!mine) throw new Error("設置弾が出ていない");
    for (let i = 0; i < SETTLE_STEPS && state.player.attack.phase !== "recover"; i++) step(state, withInput({}), FIXED_DT);
    play(state, [{ shootHeld: true }]);
    for (let i = 0; i < SETTLE_STEPS && laneKey(state) !== "detonate"; i++) step(state, withInput({}), FIXED_DT);
    expect(laneKey(state), "3 段目は起爆").toBe("detonate");
    play(state, idle(2));
    expect(mine.shot?.detonated, "設置弾が炸裂した").toBe(true);
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

  it("銃の家系の派生は装備の弾を出す（二丁拳銃の左左右 = 二連）", () => {
    const state = arena(5, { moveset: "gunner", bullet: "pistol" });
    const cooldown = stepsFor(0.6);
    play(state, [{ attackPressed: true }, {}, { attackPressed: true }, {}, { shootHeld: true }]);
    for (let i = 0; i < SETTLE_STEPS && state.player.attack.branch < 0; i++) step(state, withInput({}), FIXED_DT);
    expect(branchKey(state)).toBe("twinShot");
    const shots = playerShots(state).filter((pr) => pr.shot === undefined);
    expect(shots.length, "装備の弾（短銃の弾）を 2 発").toBe(2);
    play(state, idle(cooldown));
  });
});

/**
 * 右だけを押して右レーンを進める（再使用・共有の間が明けるのを待ち、振りの最中は先行入力で繋ぐ）。
 * key の段（振りなら振り始め、弾なら弾が出た）に届いたら true
 */
function driveRight(state: GameState, key: string): boolean {
  let pressed = false;
  for (let i = 0; i < SETTLE_STEPS * 3; i++) {
    const p = state.player;
    const a = p.attack;
    const moveset = playerMoveset(state);
    const index = nextLaneIndex(state, moveset);
    const next = index === undefined ? undefined : moveset.steps2[index];
    const ready = next !== undefined && actionCooldownLeft(state, next) === 0 && !p.art.holding && !a.buffered && a.phase !== "windup";
    const press: boolean = !pressed && ready;
    step(state, withInput({ shootHeld: press }), FIXED_DT);
    pressed = press;
    if (laneKey(state) === key || playerShots(state).some((pr) => pr.shot?.key === `art.${key}`)) return true;
  }
  return false;
}

describe("QA bot と右レーン", () => {
  function botArena(moveset: "sidearm" | "greatsword" | "sword", dx: number): GameState {
    const state = arena(5, { moveset });
    state.skills = createSkillRunState({ version: 1, loadout: [], stones: [] });
    // 攻撃間隔の長い敵（先読みの回避を評価しない）
    const e = tough(placeEnemy(state, "golem", dx));
    e.phase = "chase";
    return state;
  }

  it("bot は銃なら左を押し続ける", () => {
    const gun = botArena("sidearm", 60);
    const gunInput = botInput(gun, createBotState(1), FIXED_DT);
    expect(gunInput.attackHeld, "銃は左を押す").toBe(true);
  });

  it("bot は近接の射程内で左右を混ぜて振る", () => {
    const state = botArena("sword", 16);
    const bot = createBotState(3);
    const lanes = new Set<string>();
    for (let i = 0; i < 600; i++) {
      step(state, botInput(state, bot, FIXED_DT), FIXED_DT);
      state.enemies[0]!.body.pos = { x: state.player.body.pos.x + 16, y: state.player.body.pos.y };
      const a = state.player.attack;
      if (a.phase !== "none" && a.branch < 0) lanes.add(a.lane);
    }
    expect([...lanes].sort(), "左右の両方の段を振った").toEqual(["primary", "secondary"]);
  });
});
