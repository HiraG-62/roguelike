import { afterEach, describe, expect, it, vi } from "vitest";
import { AIM_STICK_DISTANCE, GamepadInput, STICK_DEADZONE } from "./gamepad";

/** addEventListener を素朴に記録するだけの偽 EventTarget。jsdom なしでも attach() をテストできる */
class FakeEventTarget {
  private listeners = new Map<string, ((ev: unknown) => void)[]>();

  addEventListener(type: string, cb: (ev: unknown) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(cb);
    this.listeners.set(type, list);
  }

  dispatch(type: string, ev: unknown): void {
    for (const cb of this.listeners.get(type) ?? []) cb(ev);
  }
}

interface FakeButton {
  pressed: boolean;
}

function makeButtons(pressedIndices: readonly number[], count = 16): FakeButton[] {
  return Array.from({ length: count }, (_, i) => ({ pressed: pressedIndices.includes(i) }));
}

function stubPads(pad: unknown): void {
  vi.stubGlobal("navigator", { getGamepads: () => [pad] } as unknown as Navigator);
}

function connect(target: FakeEventTarget, index = 0): void {
  target.dispatch("gamepadconnected", { gamepad: { index } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GamepadInput 接続", () => {
  it("接続イベント後、consumeJustConnected は最初の 1 回だけ true を返す", () => {
    const target = new FakeEventTarget();
    const input = new GamepadInput();
    input.attach(target as unknown as Window);
    expect(input.isConnected()).toBe(false);

    connect(target);
    expect(input.isConnected()).toBe(true);
    expect(input.consumeJustConnected()).toBe(true);
    expect(input.consumeJustConnected()).toBe(false);
  });

  it("切断イベントで isConnected が false に戻る", () => {
    const target = new FakeEventTarget();
    const input = new GamepadInput();
    input.attach(target as unknown as Window);
    connect(target);
    target.dispatch("gamepaddisconnected", { gamepad: { index: 0 } });
    expect(input.isConnected()).toBe(false);
  });

  it("未接続時の read() は EMPTY_GAMEPAD_FRAME 相当（無入力）を返す", () => {
    const input = new GamepadInput();
    const frame = input.read();
    expect(frame.move).toEqual({ x: 0, y: 0 });
    expect(frame.aimDir).toBeNull();
    expect(frame.attackPressed).toBe(false);
  });
});

describe("GamepadInput 左スティック（デッドゾーン）", () => {
  it("デッドゾーン未満の入力は move を 0 にする", () => {
    const target = new FakeEventTarget();
    const input = new GamepadInput();
    input.attach(target as unknown as Window);
    connect(target);
    stubPads({ index: 0, buttons: makeButtons([]), axes: [STICK_DEADZONE - 0.05, 0, 0, 0] });

    const frame = input.read();
    expect(frame.move).toEqual({ x: 0, y: 0 });
  });

  it("デッドゾーン以上の入力はそのまま move に反映する", () => {
    const target = new FakeEventTarget();
    const input = new GamepadInput();
    input.attach(target as unknown as Window);
    connect(target);
    stubPads({ index: 0, buttons: makeButtons([]), axes: [0.5, 0, 0, 0] });

    const frame = input.read();
    expect(frame.move.x).toBeCloseTo(0.5);
    expect(frame.move.y).toBeCloseTo(0);
  });

  it("D-pad が押されていれば左スティックより優先し、正規化して move にする", () => {
    const target = new FakeEventTarget();
    const input = new GamepadInput();
    input.attach(target as unknown as Window);
    connect(target);
    // D-pad 上(12) + 右(15) を同時押し、左スティックは無視される
    stubPads({ index: 0, buttons: makeButtons([12, 15]), axes: [0.9, 0.9, 0, 0] });

    const frame = input.read();
    expect(frame.move.x).toBeCloseTo(Math.SQRT1_2);
    expect(frame.move.y).toBeCloseTo(-Math.SQRT1_2);
  });
});

describe("GamepadInput 右スティック（照準方向）", () => {
  it("中立なら aimDir は null", () => {
    const target = new FakeEventTarget();
    const input = new GamepadInput();
    input.attach(target as unknown as Window);
    connect(target);
    stubPads({ index: 0, buttons: makeButtons([]), axes: [0, 0, 0.05, 0.05] });

    expect(input.read().aimDir).toBeNull();
  });

  it("入力があれば正規化した方向を返す", () => {
    const target = new FakeEventTarget();
    const input = new GamepadInput();
    input.attach(target as unknown as Window);
    connect(target);
    stubPads({ index: 0, buttons: makeButtons([]), axes: [0, 0, 1, 1] });

    const dir = input.read().aimDir;
    expect(dir).not.toBeNull();
    expect(dir!.x).toBeCloseTo(Math.SQRT1_2);
    expect(dir!.y).toBeCloseTo(Math.SQRT1_2);
  });

  it("AIM_STICK_DISTANCE は 60px", () => {
    expect(AIM_STICK_DISTANCE).toBe(60);
  });
});

describe("GamepadInput ボタンのエッジ検出", () => {
  it("押しっぱなしでは 2 フレーム目以降 *Pressed が false になる（confirmPressed = A）", () => {
    const target = new FakeEventTarget();
    const input = new GamepadInput();
    input.attach(target as unknown as Window);
    connect(target);
    stubPads({ index: 0, buttons: makeButtons([0]), axes: [0, 0, 0, 0] }); // A = index 0

    expect(input.read().confirmPressed).toBe(true);
    expect(input.read().confirmPressed).toBe(false);
  });

  it("離して押し直すと再度 true になる", () => {
    const target = new FakeEventTarget();
    const input = new GamepadInput();
    input.attach(target as unknown as Window);
    connect(target);

    stubPads({ index: 0, buttons: makeButtons([0]), axes: [0, 0, 0, 0] });
    expect(input.read().confirmPressed).toBe(true);

    stubPads({ index: 0, buttons: makeButtons([]), axes: [0, 0, 0, 0] });
    expect(input.read().confirmPressed).toBe(false);

    stubPads({ index: 0, buttons: makeButtons([0]), axes: [0, 0, 0, 0] });
    expect(input.read().confirmPressed).toBe(true);
  });

  it("RT(7) or A(0) は attackPressed、LT(6) or X(2) は shootHeld（トリガーは held でよい）", () => {
    const target = new FakeEventTarget();
    const input = new GamepadInput();
    input.attach(target as unknown as Window);
    connect(target);

    stubPads({ index: 0, buttons: makeButtons([7]), axes: [0, 0, 0, 0] });
    expect(input.read().attackPressed).toBe(true);

    stubPads({ index: 0, buttons: makeButtons([6]), axes: [0, 0, 0, 0] });
    const f1 = input.read();
    expect(f1.shootHeld).toBe(true);
    stubPads({ index: 0, buttons: makeButtons([6]), axes: [0, 0, 0, 0] });
    const f2 = input.read();
    // held は edge ではないので、押しっぱなしでも true が続く
    expect(f2.shootHeld).toBe(true);
  });

  it("B(1) or RB(5) は dashPressed、Y(3) は specialPressed", () => {
    const target = new FakeEventTarget();
    const input = new GamepadInput();
    input.attach(target as unknown as Window);
    connect(target);

    stubPads({ index: 0, buttons: makeButtons([1]), axes: [0, 0, 0, 0] });
    expect(input.read().dashPressed).toBe(true);

    stubPads({ index: 0, buttons: makeButtons([5]), axes: [0, 0, 0, 0] });
    expect(input.read().dashPressed).toBe(true);

    stubPads({ index: 0, buttons: makeButtons([3]), axes: [0, 0, 0, 0] });
    expect(input.read().specialPressed).toBe(true);
  });

  it("LB(4) を押している間は A / X / Y / B がスキル 1〜4 になり、攻撃・射撃・必殺・ダッシュには使わない", () => {
    const target = new FakeEventTarget();
    const input = new GamepadInput();
    input.attach(target as unknown as Window);
    connect(target);

    stubPads({ index: 0, buttons: makeButtons([4]), axes: [0, 0, 0, 0] });
    const lbOnly = input.read();
    expect(lbOnly.skill1Pressed, "LB 単独ではスキルを出さない").toBe(false);

    stubPads({ index: 0, buttons: makeButtons([4, 0, 2, 3, 1]), axes: [0, 0, 0, 0] });
    const f = input.read();
    expect([f.skill1Pressed, f.skill2Pressed, f.skill3Pressed, f.skill4Pressed], "A X Y B = スキル 1〜4").toEqual([true, true, true, true]);
    expect([f.skill1Held, f.skill2Held, f.skill3Held, f.skill4Held], "押しっぱなしも読む").toEqual([true, true, true, true]);
    expect(f.attackPressed, "A は攻撃にならない").toBe(false);
    expect(f.confirmPressed, "A は決定にならない").toBe(false);
    expect(f.shootHeld, "X は射撃にならない").toBe(false);
    expect(f.specialPressed, "Y は必殺にならない").toBe(false);
    expect(f.dashPressed, "B はダッシュにならない").toBe(false);
    expect(f.escapePressed, "B は戻るにならない").toBe(false);

    const held = input.read();
    expect(held.skill1Pressed, "押しっぱなしの 2 フレーム目は Pressed が立たない").toBe(false);
    expect(held.skill1Held).toBe(true);
  });

  it("LB 中も RT(攻撃) / LT(射撃) / RB(ダッシュ) は効く", () => {
    const target = new FakeEventTarget();
    const input = new GamepadInput();
    input.attach(target as unknown as Window);
    connect(target);

    stubPads({ index: 0, buttons: makeButtons([4, 7, 6, 5]), axes: [0, 0, 0, 0] });
    const f = input.read();
    expect(f.attackPressed).toBe(true);
    expect(f.shootHeld).toBe(true);
    expect(f.dashPressed).toBe(true);
  });

  it("右スティック押し込み(11) / D-pad 上(12) はスキルに使わない", () => {
    const target = new FakeEventTarget();
    const input = new GamepadInput();
    input.attach(target as unknown as Window);
    connect(target);

    stubPads({ index: 0, buttons: makeButtons([11]), axes: [0, 0, 0, 0] });
    expect(input.read().skill2Pressed).toBe(false);
    stubPads({ index: 0, buttons: makeButtons([12]), axes: [0, 0, 0, 0] });
    expect(input.read().skill2Pressed).toBe(false);
  });

  it("Start(9) or B(1) は escapePressed、Select/Back(8) は inventoryPressed", () => {
    const target = new FakeEventTarget();
    const input = new GamepadInput();
    input.attach(target as unknown as Window);
    connect(target);

    stubPads({ index: 0, buttons: makeButtons([9]), axes: [0, 0, 0, 0] });
    expect(input.read().escapePressed).toBe(true);

    stubPads({ index: 0, buttons: makeButtons([]), axes: [0, 0, 0, 0] });
    input.read();
    stubPads({ index: 0, buttons: makeButtons([1]), axes: [0, 0, 0, 0] });
    expect(input.read().escapePressed).toBe(true);

    stubPads({ index: 0, buttons: makeButtons([]), axes: [0, 0, 0, 0] });
    input.read();
    stubPads({ index: 0, buttons: makeButtons([8]), axes: [0, 0, 0, 0] });
    expect(input.read().inventoryPressed).toBe(true);
  });
});

describe("GamepadInput 拾う（右スティック押し込み）", () => {
  const BTN_X = 2;
  const BTN_RSTICK = 11;

  function readWith(pressed: readonly number[]): ReturnType<GamepadInput["read"]> {
    const target = new FakeEventTarget();
    const input = new GamepadInput();
    input.attach(target as unknown as Window);
    connect(target);
    stubPads({ index: 0, buttons: makeButtons(pressed), axes: [0, 0, 0, 0] });
    return input.read();
  }

  it("右スティック押し込みで interactPressed が立ち、射撃は出ない", () => {
    const frame = readWith([BTN_RSTICK]);
    expect(frame.interactPressed, "拾う").toBe(true);
    expect(frame.shootHeld, "射撃は出ない").toBe(false);
  });

  it("X は射撃だけで、拾うは立たない", () => {
    const frame = readWith([BTN_X]);
    expect(frame.shootHeld, "射撃").toBe(true);
    expect(frame.interactPressed, "拾わない").toBe(false);
  });

  it("押しっぱなしでは 2 フレーム目に立たない（押した瞬間だけ）", () => {
    const target = new FakeEventTarget();
    const input = new GamepadInput();
    input.attach(target as unknown as Window);
    connect(target);
    stubPads({ index: 0, buttons: makeButtons([BTN_RSTICK]), axes: [0, 0, 0, 0] });
    expect(input.read().interactPressed).toBe(true);
    expect(input.read().interactPressed).toBe(false);
  });
});
