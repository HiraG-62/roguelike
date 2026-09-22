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
});
