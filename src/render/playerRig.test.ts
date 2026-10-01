import { describe, expect, it } from "vitest";
import {
  ARM_REACH,
  DEFAULT_STANCE,
  FOREARM,
  IDLE_PERIOD,
  type RigInput,
  type Stance,
  UPPER_ARM,
  armPixels,
  attackClip,
  attackFrame,
  bodyClip,
  handPixels,
  RECOIL_TIME,
  recoilOf,
  restBlendOf,
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
    expect(attackClip("box", 1, false, ready)).toBe("atkSlash");
    expect(attackClip("box", -1, false, ready), "下から振る向きは斬り上げ").toBe("atkRise");
    expect(attackClip("box", 1, true, ready), "重い振り下ろしは叩きつけ").toBe("atkSlam");
    expect(attackClip("box", -1, false, { body: "heavy" }), "重い構えの箱も叩きつけ").toBe("atkSlam");
    expect(attackClip("arc", 1, true, ready), "扇は重くても振り下ろし").toBe("atkSlash");
    expect(attackClip("thrust", 1, false, ready)).toBe("atkThrust");
    expect(attackClip("arc", 1, false, { body: "ready", braced: true }), "構えて押す盾は突き").toBe("atkThrust");
    expect(attackClip("circle", 1, false, ready)).toBe("atkSpin");
  });

  it("攻撃中は選んだコマ、被弾とダッシュはそれより優先", () => {
    const atk = { ...idle, phase: "active", attack: "atkSlash", t: 0.8 } as const;
    expect(bodyClip(atk)).toEqual({ clip: "atkSlash", frame: 3 });
    expect(bodyClip({ ...atk, hit: true }).clip).toBe("hit");
    expect(bodyClip({ ...atk, dashing: true }).clip).toBe("dash");
  });
});

describe("playerRig: 戻しで構え直す", () => {
  it("戻しの前半は振り抜いたまま、後半で待機の構えへ寄せる", () => {
    expect(restBlendOf("active", 0.9)).toBe(0);
    expect(restBlendOf("recover", 0.3), "残心").toBe(0);
    expect(restBlendOf("recover", 1)).toBe(1);
    const mid = restBlendOf("recover", 0.7);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
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

describe("playerRig: 撃った反動", () => {
  it("撃った瞬間が最大で、RECOIL_TIME で戻る", () => {
    expect(recoilOf(0)).toBe(1);
    expect(recoilOf(RECOIL_TIME / 2)).toBeLessThan(0.5);
    expect(recoilOf(RECOIL_TIME)).toBe(0);
    expect(recoilOf(Number.POSITIVE_INFINITY), "撃っていない").toBe(0);
  });

  it("反動で銃を後ろへ引き、銃口を上へ跳ね上げる。強い銃ほど大きい", () => {
    const aim = { ...base, aimHeld: true };
    const still = solveRig(aim).front;
    const kicked = solveRig({ ...aim, kick: 1 }).front;
    expect(kicked.hand.x, "後ろへ引く").toBeLessThan(still.hand.x);
    expect(kicked.angle, "銃口が上へ").toBeLessThan(still.angle);
    const heavy = solveRig({ ...aim, kick: 1, stance: { ...DEFAULT_STANCE, recoil: 2 } }).front;
    expect(heavy.angle).toBeLessThan(kicked.angle);
  });
});

describe("playerRig: 銃の構え", () => {
  const span = UPPER_ARM + FOREARM;
  const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
  const longGun: RigInput = { ...base, aimHeld: true, stance: { ...DEFAULT_STANCE, grip: "two", body: "aim" }, offGrip: 13, barrelY: -3.6 };

  it("両手の銃は後ろの腕が握り・前の腕が先台を持ち、どの向きでも腕を伸ばしきらずに届く", () => {
    for (const deg of [0, -45, -80, 45, 80]) {
      const rig = solveRig({ ...longGun, aim: (deg * Math.PI) / 180 });
      expect(rig.gunHold, `${deg} 度: 銃の持ち方`).toBe(true);
      expect(dist(rig.front.hand, longGun.shoulderB), `${deg} 度: 握りに届く`).toBeLessThanOrEqual(span);
      expect(dist(rig.back.hand, longGun.shoulderF), `${deg} 度: 先台に届く`).toBeLessThanOrEqual(span);
    }
  });

  it("二丁拳銃のもう 1 挺は後ろの腕が届く所に持つ", () => {
    const rig = solveRig({ ...base, aimHeld: true, stance: { ...DEFAULT_STANCE, grip: "dual", body: "aim" }, barrelY: -4.2 });
    expect(rig.gunHold).toBeUndefined();
    expect(dist(rig.front.hand, base.shoulderF)).toBeLessThanOrEqual(span);
    expect(dist(rig.back.hand, base.shoulderB)).toBeLessThanOrEqual(span);
  });
});

describe("playerRig: 拳だけの画素", () => {
  it("拳の塗り（手の色）と外周の輪郭だけを返す", () => {
    const px = handPixels({ x: 0, y: 0 });
    expect(px.some((p) => p.ink === 0)).toBe(true);
    expect(px.every((p) => p.ink === 0 || (p.ink >= 4 && p.ink <= 6)), "袖の色は無い").toBe(true);
  });
});

describe("playerRig: 腕の長さを越えない", () => {
  const span = UPPER_ARM + FOREARM;
  const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
  /** 武器の姿勢（renderMath の weaponPose の形）: 腕の付け根（体の中心の 4px 上）から reach px の所に拳 */
  const swingAt = (angle: number, reach = 6): RigInput["swing"] => ({ frame: 0, flipX: false, flipY: false, angle, dx: Math.cos(angle) * reach, dy: -4 + Math.sin(angle) * reach, behind: false });

  it("振りの伸び・突きの突き出しでも拳は肩から腕の長さの内", () => {
    for (const reach of [6, 8, 10, 14]) {
      const rig = solveRig({ ...base, swing: swingAt(0, reach) });
      expect(dist(rig.front.hand, base.shoulderF), `拳の距離 ${reach}px`).toBeLessThanOrEqual(span);
    }
  });

  it("両手持ちの添え手は柄を滑らせて届く所を持ち、届かなければ手を離して体の脇へ下ろす", () => {
    const two: RigInput = { ...base, stance: { ...DEFAULT_STANCE, grip: "two", body: "heavy" }, offGrip: -14 };
    for (const deg of [-90, -45, 0, 45, 90]) {
      const a = (deg * Math.PI) / 180;
      const rig = solveRig({ ...two, swing: swingAt(a) });
      const held = dist(rig.back.hand, base.shoulderB) <= span + 0.5;
      expect(held || rig.back.behind, `${deg} 度: 届くか、離して体の後ろ`).toBe(true);
    }
  });
});

describe("playerRig: 二刀の後ろの手の前後", () => {
  it("後ろの手の振りから構えへ戻る途中も、体の後ろのまま", () => {
    const dual: RigInput = { ...base, stance: { ...DEFAULT_STANCE, grip: "dual", body: "light", offHand: [2, 6], offDeg: -10 } };
    const swing = { frame: 0, flipX: false, flipY: false, angle: 0.3, dx: 6, dy: -2, behind: false } as const;
    for (const restBlend of [0.2, 0.5, 0.8]) {
      const rig = solveRig({ ...dual, step: 1, swing, restBlend });
      expect(rig.back.behind, `寄せる割合 ${restBlend}`).toBe(true);
    }
  });
});

describe("playerRig: 待機で体の前に構える手（restFront）", () => {
  const rest: Stance = { ...DEFAULT_STANCE, grip: "dual", body: "light", restDeg: -20, restHand: [7, 5], swayDeg: 5, offHand: [2, 6], offDeg: -10 };

  it("呼吸の揺れで武器の向きが上寄りの境目をまたいでも、前の手は体の前のまま", () => {
    for (let k = 0; k < 32; k++) {
      const time = (IDLE_PERIOD * k) / 32;
      const rig = solveRig({ ...base, stance: { ...rest, restFront: true }, time });
      expect(rig.front.behind, `時刻 ${time}`).toBe(false);
    }
  });

  it("restFront の無い構えは、同じ揺れで上寄りの向きになると今までどおり体の後ろへ回る", () => {
    const behinds = [0, IDLE_PERIOD * 0.75].map((time) => solveRig({ ...base, stance: rest, time }).front.behind);
    expect(behinds, "揺れの谷で後ろへ回る").toEqual([false, true]);
  });

  it("振りから構えへ戻す後半は、寄せた角が境目をまたいでも前の手は体の前", () => {
    const swing = { frame: 0, flipX: false, flipY: false, angle: -1.4, dx: 0, dy: -10, behind: true } as const;
    for (const restBlend of [0.5, 0.7, 0.9, 1]) {
      const rig = solveRig({ ...base, stance: { ...rest, restFront: true }, swing, restBlend, time: IDLE_PERIOD * 0.75 });
      expect(rig.front.behind, `寄せる割合 ${restBlend}`).toBe(false);
    }
  });
});

describe("playerRig: 回さない武器（書）の上向き", () => {
  const book: Stance = { grip: "one", body: "light", restDeg: 0, restHand: [6, 5], swayDeg: 2, braced: true };
  const UP = -Math.PI / 2;
  const swingAt = (aim: number) => ({ frame: 0, flipX: false, flipY: false, angle: aim, dx: 0, dy: -10, behind: true }) as const;

  it("真上を狙った振りでも、振り・戻しの間ずっと本は体の前に描く", () => {
    for (const restBlend of [0, 0.3, 0.6, 1]) {
      const rig = solveRig({ ...base, stance: book, aim: UP, swing: swingAt(UP), restBlend, unrotated: true });
      expect(rig.front.behind, `寄せる割合 ${restBlend}`).toBe(false);
    }
  });

  it("回す武器（unrotated 無し）は今までどおり上向きで体の後ろへ回る", () => {
    const rig = solveRig({ ...base, stance: book, aim: UP, swing: swingAt(UP) });
    expect(rig.front.behind).toBe(true);
  });

  it("上向きでも拳は肩の真上でなく前へ倒した所（顔を隠さない）で、腕の長さを越えない", () => {
    const rig = solveRig({ ...base, stance: book, aim: UP, swing: swingAt(UP), unrotated: true });
    expect(rig.front.hand.x, "拳は前（+x）へ寄る").toBeGreaterThan(base.shoulderF.x + 3);
    // 腕を伸ばしきらない上限は ARM_REACH より少し長い（playerRig の ARM_SPAN）
    expect(Math.hypot(rig.front.hand.x - base.shoulderF.x, rig.front.hand.y - base.shoulderF.y)).toBeLessThanOrEqual(ARM_REACH + 0.5 + 1e-6);
  });

  it("真上寄りの度合いが違っても拳の高さは上限で揃う（連続）", () => {
    const a = solveRig({ ...base, stance: book, aim: (-80 * Math.PI) / 180, swing: swingAt(UP), unrotated: true });
    const b = solveRig({ ...base, stance: book, aim: UP, swing: swingAt(UP), unrotated: true });
    expect(Math.abs(a.front.hand.y - b.front.hand.y)).toBeLessThan(0.01);
  });
});
