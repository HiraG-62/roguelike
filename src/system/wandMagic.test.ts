import { describe, expect, it } from "vitest";
import { step } from "../core/game";
import type { FrameInput } from "../core/input";
import { FIXED_DT } from "../core/loop";
import type { Enemy, GameState } from "../core/state";
import type { StatusKind } from "../core/status";
import type { Element } from "../core/element";
import { WEAPON } from "../data/tuning";
import { type CastDef, type ThrowArtDef, MOVESETS } from "../data/weapons";
import { BULLETS } from "../loot/bullets";
import { playerMoveset } from "./player";
import { findStatus } from "./statusEffects";
import { terrainAt } from "./terrain";
import { emitArtVolley } from "./weaponArts";
import { arena, placeEnemy, withInput } from "./testHelpers";

/**
 * 杖（wand）の魔法化（docs/ideas/weapons-wave4.md 6 章）: 左 = 炎の cast、右 = 氷の弾の段、左右を混ぜた 3 手 = 雷・毒・渦・光・闇。
 * 魔法はすべて射撃扱いの弾で、状態異常（applies）や地形（leaves）の副次効果を持つ
 */

const TOUGH_HP = 99999;
const NO_ATTACK_COOLDOWN = 99;
/** 振り・段を終えるまで待つ上限のステップ */
const SETTLE_STEPS = 90;
/** 弾が的に届いて副次効果が出るまで待つステップ */
const FLIGHT_STEPS = 90;
/** 的までの距離（px） */
const TARGET_DIST = 40;

const WAND = MOVESETS.wand;
const LEFT: Partial<FrameInput> = { attackPressed: true, attackHeld: true };
const RIGHT: Partial<FrameInput> = { shootHeld: true };
const LEFT_ELEMENTS: readonly Element[] = ["fire"];
const RIGHT_ELEMENTS: readonly Element[] = ["ice"];
/** 左右を混ぜた派生の魔法の属性（炎・氷以外の系統） */
const MIXED_ELEMENTS: readonly Element[] = ["lightning", "poison", "light", "dark"];

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
const stepsFor = (sec: number): number => Math.ceil(sec / FIXED_DT);

/** 振りが先行入力を受ける（active / recover で予約が無い）まで空の入力で進める */
function untilActive(state: GameState): void {
  for (let i = 0; i < SETTLE_STEPS; i++) {
    const a = state.player.attack;
    if ((a.phase === "active" || a.phase === "recover") && !a.buffered) return;
    step(state, withInput({}), FIXED_DT);
  }
}

/** 派生が振り始めるまで進め、派生の key を返す */
function untilBranch(state: GameState): string | undefined {
  for (let i = 0; i < SETTLE_STEPS && state.player.attack.branch < 0; i++) step(state, withInput({}), FIXED_DT);
  return playerMoveset(state).branches[state.player.attack.branch]?.key;
}

/** 派生の振りを active まで進めたときに出た自分の弾の key */
function shotKeysAfterSwing(state: GameState): string[] {
  const keys: string[] = [];
  for (let i = 0; i < SETTLE_STEPS && state.player.attack.phase !== "none"; i++) {
    step(state, withInput({}), FIXED_DT);
    for (const pr of state.projectiles) if (pr.owner === "player" && pr.shot) keys.push(pr.shot.key);
  }
  return keys;
}

function namedBranches() {
  return WAND.branches.filter((b) => b.art !== "release");
}

function leftCasts(): CastDef[] {
  return WAND.steps.map((s, i) => {
    if (!s.cast) throw new Error(`杖の左 ${i + 1} 段目に cast が無い`);
    return s.cast;
  });
}

function rightThrows(): ThrowArtDef[] {
  return WAND.steps2.map((s, i) => {
    if (s.kind !== "volley") throw new Error(`杖の右 ${i + 1} 段目が弾の段でない`);
    return s.throw;
  });
}

function branchCasts(): CastDef[] {
  return namedBranches().flatMap((b) => (b.step.cast ? [b.step.cast] : []));
}

/** cast / 右の段の key から弾を引く */
function throwOf(key: string): ThrowArtDef {
  const cast = [...leftCasts(), ...branchCasts()].find((c) => c.key === key);
  if (cast) return cast.throw;
  const lane = WAND.steps2.find((s) => s.key === key);
  if (lane?.kind === "volley") return lane.throw;
  throw new Error(`杖の魔法 ${key} が無い`);
}

describe("杖の魔法（データ）", () => {
  it("杖の左右の段はすべて cast か volley を持ち、派生 6 本の弾の key が一意", () => {
    const left = leftCasts();
    const right = rightThrows();
    expect(left.length, "左の段").toBe(WAND.steps.length);
    expect(right.length, "右の段").toBe(WAND.steps2.length);
    expect(namedBranches().length, "派生は 6 本").toBe(6);
    const keys = [...left.map((c) => c.throw.bullet.key), ...right.map((t) => t.bullet.key), ...branchCasts().map((c) => c.throw.bullet.key)];
    expect(new Set(keys).size, "弾の key が重ならない").toBe(keys.length);
    for (const key of keys) expect(BULLETS[key], `${key} を弾の表から引ける`).toBeDefined();
    for (const c of branchCasts()) expect(c.throw.bullet.key, "派生の弾は cast.<key>").toBe(`cast.${c.key}`);
    // 弾でない派生は渦巻き（引き寄せの振り）だけ
    const swings = namedBranches().filter((b) => !b.step.cast);
    expect(swings.map((b) => b.key), "弾でない派生").toEqual(["vortex"]);
    expect(swings[0]?.step.pull, "渦巻きは引き寄せる").toBe(true);
  });

  it("左は炎、右は氷、混ぜると雷・毒・光・闇の系統に分かれ、どれも射撃扱い", () => {
    for (const c of leftCasts()) expect(LEFT_ELEMENTS, `左 ${c.key}`).toContain(c.throw.attack.element);
    for (const t of rightThrows()) expect(RIGHT_ELEMENTS, `右 ${t.bullet.key}`).toContain(t.attack.element);
    const mixed = new Set(branchCasts().map((c) => c.throw.attack.element));
    for (const el of mixed) expect(MIXED_ELEMENTS, "派生の属性").toContain(el);
    expect(mixed.size, "派生の属性は 4 系統").toBe(MIXED_ELEMENTS.length);
    const all = [...leftCasts().map((c) => c.throw), ...rightThrows(), ...branchCasts().map((c) => c.throw)];
    for (const t of all) {
      expect(t.attack.genre.quality, `${t.bullet.key} は魔法`).toBe("arcane");
      expect(t.applies?.length ?? 0, `${t.bullet.key} は副次効果を持つ`).toBeGreaterThan(0);
    }
  });

  it("名前の違う魔法は弾の色も違う", () => {
    const all = [...leftCasts().map((c) => c.throw), ...rightThrows(), ...branchCasts().map((c) => c.throw)];
    const colorByName = new Map<string, string>();
    for (const t of all) {
      const color = t.bullet.look?.color;
      expect(color, `${t.bullet.key} は色を持つ`).toBeDefined();
      colorByName.set(t.bullet.name, color ?? "");
    }
    expect(new Set(colorByName.values()).size, "色の数 = 名前の数").toBe(colorByName.size);
  });
});

describe("杖の魔法（入力）", () => {
  it("杖の LLR で稲妻、RRL で毒泡が出る", () => {
    const llr = arena(5, { moveset: "wand" });
    play(llr, [LEFT]);
    untilActive(llr);
    play(llr, [{ attackPressed: true }]);
    untilActive(llr);
    play(llr, [RIGHT]);
    expect(untilBranch(llr), "左左右は稲妻").toBe("lightningBolt");
    expect(shotKeysAfterSwing(llr), "稲妻の弾が出る").toContain("cast.lightningBolt");

    const rrl = arena(5, { moveset: "wand" });
    const gap = stepsFor(WEAPON.artDefaults.laneGap) + 1;
    play(rrl, [RIGHT, ...idle(gap), RIGHT, {}, { attackPressed: true }]);
    expect(untilBranch(rrl), "右右左は毒泡").toBe("venomMist");
    expect(shotKeysAfterSwing(rrl), "毒泡の弾が出る").toContain("cast.venomMist");
  });

  it("左を押すと振りの active で火矢が 1 本出る", () => {
    const state = arena(5, { moveset: "wand" });
    play(state, [LEFT]);
    expect(shotKeysAfterSwing(state), "火矢").toContain("cast.fireDart");
  });
});

describe("杖の魔法（副次効果）", () => {
  const CASES: readonly (readonly [string, readonly StatusKind[]])[] = [
    ["fireDart", ["burn"]],
    ["iceLance", ["chill"]],
    ["lightningBolt", ["shock"]],
    ["flash", ["vulnerable"]],
    ["darkHand", ["weaken", "siphon"]],
    ["arcLightning", ["shock"]],
  ];

  it.each(CASES)("魔法の弾は副次効果を付ける（%s）", (key, kinds) => {
    const state = arena(5, { moveset: "wand" });
    const e = tough(placeEnemy(state, "boar", TARGET_DIST));
    emitArtVolley(state, throwOf(key));
    for (let i = 0; i < FLIGHT_STEPS && kinds.some((k) => !findStatus(e.status, k)); i++) step(state, withInput({}), FIXED_DT);
    for (const k of kinds) expect(findStatus(e.status, k)?.source, `${key} は ${k} を付ける（付与元 player）`).toBe("player");
  });

  it("爆炎球は炸裂で燃やして火を残し、毒泡は毒と毒沼を残す", () => {
    const orb = arena(5, { moveset: "wand" });
    const burnt = tough(placeEnemy(orb, "boar", TARGET_DIST));
    orb.player.aimDistance = TARGET_DIST;
    emitArtVolley(orb, throwOf("blastOrb"));
    for (let i = 0; i < FLIGHT_STEPS; i++) step(orb, withInput({}), FIXED_DT);
    expect(findStatus(burnt.status, "burn")?.source, "爆炎球の炸裂で燃焼").toBe("player");
    const p = orb.player.body.pos;
    expect(terrainAt(orb, p.x + TARGET_DIST, p.y), "炸裂の位置に火").toBe("fire");

    const mist = arena(5, { moveset: "wand" });
    const poisoned = tough(placeEnemy(mist, "boar", TARGET_DIST));
    emitArtVolley(mist, throwOf("venomMist"));
    let bog = false;
    for (let i = 0; i < FLIGHT_STEPS; i++) {
      step(mist, withInput({}), FIXED_DT);
      const at = poisoned.body.pos;
      bog ||= terrainAt(mist, at.x, at.y) === "bog";
    }
    // 炸裂の毒と毒沼の毒は同じ状態異常に重なる（付与元は先に付いた方）ので、有無だけを見る
    expect(findStatus(poisoned.status, "poison"), "毒泡の炸裂で毒").toBeDefined();
    expect(bog, "敵の足元に毒沼が残る").toBe(true);
  });
});
