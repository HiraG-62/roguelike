import { describe, expect, it } from "vitest";
import {
  ARM_REACH,
  DEFAULT_STANCE,
  FOREARM,
  type RigInput,
  type Stance,
  UPPER_ARM,
  armPixels,
  attackClip,
  attackFrame,
  bodyClip,
  elbowOf,
  solveRig,
  stanceFromMeta,
  toRigAngle,
} from "./playerRig";

const idle = { dashing: false, dashProgress: 0, hit: false, phase: "none", holding: false, moving: false, walkTime: 0, time: 0, idle: "ready" } as const;

describe("playerRig: 体のシートの選び方", () => {
  it("被弾 → ダッシュ → 攻撃 → 歩き → 待機の順に選ぶ", () => {
    expect(bodyClip({ ...idle, hit: true, dashing: true }).clip).toBe("hit");
    expect(bodyClip({ ...idle, dashing: true, phase: "active" }).clip).toBe("dash");
    expect(bodyClip({ ...idle, phase: "windup", moving: true }).clip).toBe("windup");
    expect(bodyClip({ ...idle, holding: true }).clip).toBe("windup");
    expect(bodyClip({ ...idle, phase: "recover" }).clip).toBe("strike");
    expect(bodyClip({ ...idle, moving: true }).clip).toBe("walk");
    expect(bodyClip(idle).clip).toBe("idleReady");
  });

  it("待機は武器の構えの系統のシートを選び、呼吸の周期でフレームが進む", () => {
    expect(bodyClip({ ...idle, idle: "heavy" }).clip).toBe("idleHeavy");
    expect(bodyClip({ ...idle, idle: "aim" }).clip).toBe("idleAim");
    const frames = new Set([0, 0.4, 0.8, 1.2].map((time) => bodyClip({ ...idle, time }).frame));
    expect(frames.size).toBeGreaterThan(1);
  });
});

describe("playerRig: 攻撃の体のコマ", () => {
  const idle = { dashing: false, dashProgress: 0, hit: false, phase: "none", holding: false, moving: false, walkTime: 0, time: 0, idle: "ready" } as const;
  it("予備動作・振り・戻しを 2 枚ずつに割り、進みで順に送る", () => {
    const seq = [
      attackFrame("windup", 0),
      attackFrame("windup", 0.9),
      attackFrame("active", 0),
      attackFrame("active", 0.9),
      attackFrame("recover", 0),
      attackFrame("recover", 0.9),
    ];
    expect(seq).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("形と振る向き・重さで体のコマを選ぶ", () => {
    const ready = { body: "ready" } as const;
    expect(attackClip("box", 0, false, ready)).toBe("atkSlash");
    expect(attackClip("box", 1, false, ready), "逆の段は斬り上げ").toBe("atkRise");
    expect(attackClip("box", 0, true, ready), "重い振り下ろしは叩きつけ").toBe("atkSlam");
    expect(attackClip("box", 1, false, { body: "heavy" }), "重い構えの箱も叩きつけ").toBe("atkSlam");
    expect(attackClip("arc", 0, true, ready), "扇は重くても振り下ろし").toBe("atkSlash");
    expect(attackClip("thrust", 0, false, ready)).toBe("atkThrust");
    expect(attackClip("arc", 0, false, { body: "ready", braced: true }), "構えて押す盾は突き").toBe("atkThrust");
    expect(attackClip("circle", 0, false, ready)).toBe("atkSpin");
  });

  it("攻撃中は選んだコマ、被弾とダッシュはそれより優先", () => {
    const atk = { ...idle, phase: "active", attack: "atkSlash", t: 0.8 } as const;
    expect(bodyClip(atk)).toEqual({ clip: "atkSlash", frame: 3 });
    expect(bodyClip({ ...atk, hit: true }).clip).toBe("hit");
    expect(bodyClip({ ...atk, dashing: true }).clip).toBe("dash");
  });
});

describe("playerRig: 構えの読み込み", () => {
  it("形の正しい構えはそのまま読み、崩れていれば既定", () => {
    const raw = { grip: "dual", body: "light", restDeg: -20, restHand: [7, 8], swayDeg: 4, offHand: [-3, 9], offDeg: 150, worn: true };
    const s = stanceFromMeta(raw);
    expect(s).toMatchObject({ grip: "dual", body: "light", restDeg: -20, offDeg: 150, worn: true });
    expect(stanceFromMeta({ ...raw, grip: "three" })).toBe(DEFAULT_STANCE);
    expect(stanceFromMeta({ ...raw, restHand: [1] })).toBe(DEFAULT_STANCE);
    expect(stanceFromMeta(undefined)).toBe(DEFAULT_STANCE);
  });
});

const base: RigInput = {
  stance: DEFAULT_STANCE,
  swing: undefined,
  step: 0,
  aim: 0,
  aimHeld: false,
  facingRight: true,
  shoulderF: { x: 3, y: -24 },
  shoulderB: { x: -4, y: -24 },
  time: 0,
  offGrip: null,
  aimOrigin: { x: 0, y: -22 },
  barrelY: -4,
};

describe("playerRig: 手と武器の位置", () => {
  it("待機は構えの手の位置（前の肩から）と向きで持つ", () => {
    const stance: Stance = { ...DEFAULT_STANCE, restDeg: -30, restHand: [6, 5], swayDeg: 0 };
    const r = solveRig({ ...base, stance });
    expect(r.front.hand).toEqual({ x: 9, y: -19 });
    expect(r.front.angle).toBeCloseTo((-30 * Math.PI) / 180);
  });

  it("両手持ちは後ろの手を柄の上（添え手の位置）に置き、武器を描かない", () => {
    const stance: Stance = { ...DEFAULT_STANCE, grip: "two", restDeg: 0, swayDeg: 0 };
    const r = solveRig({ ...base, stance, offGrip: -10 });
    expect(r.back.bare).toBe(true);
    expect(r.back.hand.x).toBeCloseTo(r.front.hand.x - 10);
    expect(r.back.hand.y).toBeCloseTo(r.front.hand.y);
  });

  it("照準へ向けて持つ銃は、銃身の線が弾の出る高さを通るように握りを寄せる", () => {
    const r = solveRig({ ...base, aimHeld: true });
    // 右向きに撃つとき、銃身（握りから barrelY 上）が aimOrigin の高さに来る
    expect(r.front.hand.y + base.barrelY).toBeCloseTo(base.aimOrigin.y);
    expect(r.front.behind).toBe(false);
  });

  it("二丁の銃は後ろの手も照準へ向ける", () => {
    const stance: Stance = { ...DEFAULT_STANCE, grip: "dual", body: "aim" };
    const r = solveRig({ ...base, stance, aimHeld: true, aim: 0.3 });
    expect(r.back.angle).toBeCloseTo(r.front.angle);
    expect(r.back.bare).toBe(false);
  });

  it("左向きは照準を左右に写して右向きで組む", () => {
    expect(toRigAngle(Math.PI, false)).toBeCloseTo(0);
    expect(toRigAngle(Math.PI * 0.75, false)).toBeCloseTo(Math.PI * 0.25);
  });
});

describe("playerRig: 腕", () => {
  it("肘は上腕の長さの所にあり、下へ曲がる", () => {
    const s = { x: 0, y: 0 };
    const h = { x: 8, y: 0 };
    const e = elbowOf(s, h);
    expect(Math.hypot(e.x - s.x, e.y - s.y)).toBeCloseTo(UPPER_ARM);
    expect(Math.hypot(h.x - e.x, h.y - e.y)).toBeCloseTo(FOREARM);
    expect(e.y).toBeGreaterThan(0);
  });

  it("届かない手へは腕をまっすぐ伸ばす", () => {
    const e = elbowOf({ x: 0, y: 0 }, { x: ARM_REACH * 3, y: 0 });
    expect(e.y).toBeCloseTo(0);
    expect(e.x).toBeCloseTo(UPPER_ARM);
  });

  it("腕の画素は輪郭と袖と拳を持ち、手にはめる武器なら拳を描かない", () => {
    const s = { x: 0, y: 0 };
    const h = { x: 8, y: 4 };
    const inks = new Set(armPixels(s, elbowOf(s, h), h).map((p) => p.ink));
    expect(inks.has(0)).toBe(true);
    expect([1, 2, 3].some((i) => inks.has(i as 1))).toBe(true);
    expect([4, 5, 6].some((i) => inks.has(i as 4))).toBe(true);
    const bare = new Set(armPixels(s, elbowOf(s, h), h, false).map((p) => p.ink));
    expect([4, 5, 6].some((i) => bare.has(i as 4))).toBe(false);
  });
});
