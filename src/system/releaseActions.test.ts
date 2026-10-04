import { describe, expect, it } from "vitest";
import { length } from "../core/vec";
import { WEAPON } from "../data/tuning";
import { type ActionStepDef, type MeleeStepDef, MOVESETS, type MovesetDef, type SwingActionStep } from "../data/weapons";
import { bulletDef } from "../loot/bullets";
import type { ReleaseMul } from "./morale";
import { meleeStep, releaseShotOf } from "./player";
import { arena } from "./testHelpers";
import { onLaneSwingStart } from "./weaponArts";

/** 戦意あり用のアクション（releaseStep / releaseExtras / releaseShot / releaseUnload）を調整ファイルで別に決める */

/** 倍率を掛けない放出（差し替えだけを見る） */
const PLAIN_RELEASE: ReleaseMul = { damageMul: 1, poiseMul: 1, reachMul: 1, hitsAdd: 0, knockbackMul: 1, pierceAdd: 0 };
/** 戦意あり用の段の溜めの秒（普段の段と見分ける値） */
const RELEASE_WINDUP = 0.5;
const PLAIN_KNOCK = 100;
const RELEASE_KNOCK = 500;
const EPS = 1e-6;

/** 剣の右 2 段目（返し斬り）に、溜めの秒だけ違う戦意あり用の段を持たせた武器種 */
function swordWithReleaseStep(): MovesetDef {
  const sword = MOVESETS.sword;
  const steps2 = sword.steps2.map((s): ActionStepDef => {
    if (s.kind !== "swing" || s.key !== "returnCut") return s;
    const releaseStep: MeleeStepDef = { ...s.step, windup: RELEASE_WINDUP };
    return { ...s, step: { ...s.step, releaseStep } };
  });
  const [first, ...rest] = steps2;
  if (!first) throw new Error("剣の右レーンが空");
  return { ...sword, steps2: [first, ...rest] };
}

function returnCutIndex(moveset: MovesetDef): number {
  return moveset.steps2.findIndex((s) => s.kind === "swing" && s.key === "returnCut");
}

describe("戦意あり用の段（releaseStep）", () => {
  it("放出の振りは戦意あり用の段を振り、放出でない振りは普段の段を振る", () => {
    const state = arena(5, { moveset: "sword" });
    const moveset = swordWithReleaseStep();
    const index = returnCutIndex(moveset);
    const speed = state.stats.attackSpeedMul;
    const released = meleeStep(state.stats, index, false, 0, -1, moveset, "secondary", PLAIN_RELEASE);
    const plain = meleeStep(state.stats, index, false, 0, -1, moveset, "secondary");
    expect(released?.windup, "戦意あり").toBeCloseTo(RELEASE_WINDUP / speed);
    expect(plain?.windup, "戦意なし").not.toBeCloseTo(RELEASE_WINDUP / speed);
    expect(released?.release, "放出の印").toBe(true);
  });

  it("放出になる段はすべて戦意あり用の段を JSON に持つ（中身は最初は普段の段と同じ）", () => {
    const laneKeys = ["returnCut", "frenzy", "rend", "slam", "detonate", "pointBlank", "tubeBash", "freeCast", "toll"];
    let found = 0;
    for (const moveset of Object.values(MOVESETS)) {
      for (const s of moveset.steps2) {
        if (s.kind === "swing" && s.key !== undefined && laneKeys.includes(s.key)) {
          expect(s.step.releaseStep, `${moveset.key}.${s.key}`).toBeDefined();
          expect(s.step.releaseStep?.windup, `${moveset.key}.${s.key} の溜め`).toBe(s.step.windup);
          found += 1;
        }
      }
    }
    expect(found, "放出の右の振り").toBeGreaterThan(laneKeys.length);
    for (const key of ["spear", "staff"] as const) {
      const thrusts = MOVESETS[key].steps.filter((s) => s.shape.kind === "thrust");
      for (const t of thrusts) expect(t.releaseStep, `${key} の突き`).toBeDefined();
    }
    const iai = MOVESETS.katana.steps2.find((s) => s.kind === "charge");
    expect(iai?.kind === "charge" ? iai.charge.step.releaseStep : undefined, "刀の居合").toBeDefined();
  });
});

describe("戦意あり用の付随効果（releaseExtras）", () => {
  function knockAfter(release: boolean): number {
    const state = arena(5, { moveset: "cannon" });
    const s: SwingActionStep = { ...(MOVESETS.cannon.steps2[0] as SwingActionStep), extras: { selfKnock: PLAIN_KNOCK }, releaseExtras: { selfKnock: RELEASE_KNOCK } };
    state.player.knock = { x: 0, y: 0 };
    onLaneSwingStart(state, s, release);
    return length(state.player.knock);
  }

  it("放出の振りは戦意あり用の反動、放出でない振りは普段の反動", () => {
    expect(knockAfter(true)).toBeCloseTo(RELEASE_KNOCK);
    expect(knockAfter(false)).toBeCloseTo(PLAIN_KNOCK);
  });

  it("零距離砲・筒払い・起爆は今と同じ付随効果を戦意あり用にも持つ", () => {
    for (const [key, move] of [["pointBlank", "cannon"], ["tubeBash", "grenade"], ["detonate", "trapper"]] as const) {
      const s = MOVESETS[move].steps2.find((a) => a.kind === "swing" && a.key === key);
      expect(s?.kind === "swing" ? s.releaseExtras : undefined, key).toEqual(s?.kind === "swing" ? s.extras : undefined);
    }
  });
});

describe("戦意あり用の 1 発（releaseShot）", () => {
  it("器の弾に武器種の数値を浅く重ねる。無ければ器の弾のまま", () => {
    const shot = bulletDef("kunai");
    const moveset: MovesetDef = { ...MOVESETS.kunai, releaseShot: { radius: shot.radius + 5 } };
    expect(releaseShotOf(moveset, shot).radius).toBe(shot.radius + 5);
    expect(releaseShotOf({ ...MOVESETS.kunai, releaseShot: undefined }, shot)).toBe(shot);
  });

  it("苦無と長銃は戦意あり用の 1 発の手応えを JSON に持つ（止めは今と同じ終撃の 9）", () => {
    expect(MOVESETS.kunai.releaseShot?.releaseHit?.hitstop).toBe(9);
    expect(MOVESETS.longarm.releaseShot?.releaseHit?.hitstop).toBe(9);
  });
});

describe("戦意を使った撃ち尽くし（releaseUnload）", () => {
  it("二丁拳銃は戦意あり用の撃ち尽くしを unload と同じ形で持つ（中身は最初は同じ）", () => {
    const h = WEAPON.movesets.gunner.hands;
    expect(Object.keys(h.releaseUnload).sort()).toEqual(Object.keys(h.unload).sort());
    expect(Math.abs(h.releaseUnload.damageMul - h.unload.damageMul)).toBeLessThan(EPS);
  });
});
