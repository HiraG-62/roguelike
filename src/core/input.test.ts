import { describe, expect, it } from "vitest";
import { PlayerInput } from "./input";
import type { GamepadFrame } from "./gamepad";
import { EMPTY_GAMEPAD_FRAME } from "./gamepad";
import { VIEW_H, VIEW_W } from "./view";

/** GamepadInput の代わりに任意の GamepadFrame を返す最小スタブ。read() は呼ばれるたびに same frame を返す */
class StubGamepad {
  constructor(private frame: GamepadFrame) {}
  read(): GamepadFrame {
    return this.frame;
  }
}

function gamepadFrame(overrides: Partial<GamepadFrame>): GamepadFrame {
  return { ...EMPTY_GAMEPAD_FRAME, ...overrides };
}

describe("PlayerInput とゲームパッドのマージ", () => {
  it("パッド未接続なら move はキーボードのみで決まる", () => {
    const input = new PlayerInput();
    const frame = input.snapshot();
    expect(frame.move).toEqual({ x: 0, y: 0 });
  });

  it("move はキーボードとパッドのうち大きい方を採用する（パッドが大きい場合）", () => {
    const input = new PlayerInput();
    input.attachGamepad(new StubGamepad(gamepadFrame({ move: { x: 0.8, y: 0 } })) as never);

    const frame = input.snapshot();
    expect(frame.move.x).toBeCloseTo(0.8);
    expect(frame.move.y).toBeCloseTo(0);
  });

  it("押下フラグはキーボード/パッドの OR になる（skill1Pressed = パッド LB）", () => {
    const input = new PlayerInput();
    input.attachGamepad(new StubGamepad(gamepadFrame({ skill1Pressed: true })) as never);

    const frame = input.snapshot();
    expect(frame.skill1Pressed).toBe(true);
  });

  it("右スティックが中立ならマウス照準を優先する", () => {
    const input = new PlayerInput();
    input.attachGamepad(new StubGamepad(gamepadFrame({ aimDir: null })) as never);
    // attachMouse は DOM canvas が必要なので、内部の mouseScreen が null のままでも
    // aimScreen が null のままであることだけ確認する（マウス未使用時の挙動）
    const frame = input.snapshot();
    expect(frame.aimScreen).toBeNull();
  });

  it("右スティック入力があれば、画面中心 + カメラのずれから 60px の点を aimScreen にする", () => {
    const input = new PlayerInput();
    input.attachGamepad(new StubGamepad(gamepadFrame({ aimDir: { x: 1, y: 0 } })) as never);

    const frame = input.snapshot({ x: 3, y: -2 });
    expect(frame.aimScreen).toEqual({ x: VIEW_W / 2 + 3 + 60, y: VIEW_H / 2 - 2 });
  });

  it("gamepadEscapePressed は直近 snapshot() のパッド escapePressed を返す", () => {
    const input = new PlayerInput();
    input.attachGamepad(new StubGamepad(gamepadFrame({ escapePressed: true })) as never);

    expect(input.gamepadEscapePressed()).toBe(false);
    input.snapshot();
    expect(input.gamepadEscapePressed()).toBe(true);
  });

  it("padConfirmPressed はパッド A のエッジのみを反映する（confirmPressed は kb/pad の OR）", () => {
    const input = new PlayerInput();
    input.attachGamepad(new StubGamepad(gamepadFrame({ confirmPressed: true })) as never);

    const frame = input.snapshot();
    expect(frame.padConfirmPressed).toBe(true);
    expect(frame.confirmPressed).toBe(true);
  });

  it("padConfirmPressed はパッド未接続/未押下なら false", () => {
    const input = new PlayerInput();
    input.attachGamepad(new StubGamepad(gamepadFrame({ confirmPressed: false })) as never);

    const frame = input.snapshot();
    expect(frame.padConfirmPressed).toBe(false);
  });
});

/** addEventListener を捕まえて手動で発火できる、DOM 無し環境用の最小スタブ */
class FakeEventTarget {
  private readonly listeners = new Map<string, ((ev: never) => void)[]>();
  addEventListener(type: string, cb: (ev: never) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(cb);
    this.listeners.set(type, list);
  }
  removeEventListener(): void {
    // 未使用（attachKeyboard は外さないので空実装で十分）
  }
  dispatch(type: string, ev: Record<string, unknown>): void {
    for (const cb of this.listeners.get(type) ?? []) cb(ev as never);
  }
}

function keyEvent(code: string, repeat = false): Record<string, unknown> {
  return { code, repeat, preventDefault: () => undefined };
}

describe("長押し (skill1Held / skill2Held)", () => {
  it("押している間 Held が true、離すと false（パッド未対応でキーボードのみ判定）", () => {
    const input = new PlayerInput();
    const target = new FakeEventTarget();
    input.attachKeyboard(target as unknown as Window);

    target.dispatch("keydown", keyEvent("Digit1"));
    const pressedFrame = input.snapshot();
    expect(pressedFrame.skill1Held).toBe(true);
    expect(pressedFrame.skill1Pressed).toBe(true);

    // Pressed は消費されるが、押しっぱなしの間は Held が立ち続ける
    const heldFrame = input.snapshot();
    expect(heldFrame.skill1Held).toBe(true);
    expect(heldFrame.skill1Pressed).toBe(false);

    target.dispatch("keyup", { code: "Digit1" });
    const releasedFrame = input.snapshot();
    expect(releasedFrame.skill1Held).toBe(false);
  });

  it("スロット 1 / 2 は独立に判定される", () => {
    const input = new PlayerInput();
    const target = new FakeEventTarget();
    input.attachKeyboard(target as unknown as Window);

    target.dispatch("keydown", keyEvent("Digit2"));
    const frame = input.snapshot();
    expect(frame.skill1Held).toBe(false);
    expect(frame.skill2Held).toBe(true);
  });

  it("repeat の keydown では二重に反応しない（Held は変わらず true のまま）", () => {
    const input = new PlayerInput();
    const target = new FakeEventTarget();
    input.attachKeyboard(target as unknown as Window);

    target.dispatch("keydown", keyEvent("KeyC"));
    target.dispatch("keydown", keyEvent("KeyC", true));
    const frame = input.snapshot();
    expect(frame.skill1Held).toBe(true);
    expect(frame.skill1Pressed).toBe(true);
  });
});
