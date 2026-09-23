/**
 * ゲームパッド入力。navigator.getGamepads() を毎フレーム read() でポーリングする。
 * Standard Gamepad マッピングを前提とする。
 * PlayerInput.snapshot() 側でキーボード/マウス入力とマージされる（このファイルは関知しない）。
 */
import { type Vec, isZero, length, normalize } from "./vec";

// Standard Gamepad のボタン番号
const BTN_A = 0;
const BTN_B = 1;
const BTN_X = 2;
const BTN_Y = 3;
const BTN_LB = 4;
const BTN_RB = 5;
const BTN_LT = 6;
const BTN_RT = 7;
const BTN_BACK = 8;
const BTN_START = 9;
// 10 = 左スティック押し込み（LSTICK）。現状どのアクションにも束縛していない
/** 右スティック押し込み（R3）。拾う */
const BTN_RSTICK = 11;
const BTN_DPAD_UP = 12;
const BTN_DPAD_DOWN = 13;
const BTN_DPAD_LEFT = 14;
const BTN_DPAD_RIGHT = 15;
/** prevPressed 配列の固定サイズ。Standard Gamepad のボタン数 */
const BUTTON_SLOT_COUNT = 16;

// Standard Gamepad のスティック軸番号
const AXIS_LEFT_X = 0;
const AXIS_LEFT_Y = 1;
const AXIS_RIGHT_X = 2;
const AXIS_RIGHT_Y = 3;

/** スティックの中立域。これより小さい入力は無視する */
export const STICK_DEADZONE = 0.2;
/** 右スティック照準を画面座標に落とし込むときの、画面中心からの距離(px) */
export const AIM_STICK_DISTANCE = 60;

/** 1 フレームぶんのパッド入力。PlayerInput が FrameInput にマージする */
export interface GamepadFrame {
  /** 正規化済み移動ベクトル（左スティック、D-pad があればそちらを優先。無入力なら 0,0） */
  move: Vec;
  /** 右スティックの照準方向（正規化済み）。中立なら null（マウス/キーボード優先の合図） */
  aimDir: Vec | null;
  dashPressed: boolean;
  attackPressed: boolean;
  attackHeld: boolean;
  shootHeld: boolean;
  specialPressed: boolean;
  confirmPressed: boolean;
  /** メニューの「戻る/ポーズ」に相当（B or Start）。今フレーム押されたときだけ true */
  escapePressed: boolean;
  inventoryPressed: boolean;
  /**
   * スキル 1〜4（docs/COMBAT_DESIGN.md B-3）。LB を押している間だけ A / X / Y / B がスキル層に切り替わる。
   * Held は溜め（Charge 刻印符）の長押し用
   */
  skill1Pressed: boolean;
  skill2Pressed: boolean;
  skill3Pressed: boolean;
  skill4Pressed: boolean;
  skill1Held: boolean;
  skill2Held: boolean;
  skill3Held: boolean;
  skill4Held: boolean;
  /** 床の遺物・スキル石を拾う（右スティック押し込みの押した瞬間。照準スティックの先を注目して押し込む） */
  interactPressed: boolean;
}

export const EMPTY_GAMEPAD_FRAME: Readonly<GamepadFrame> = {
  move: { x: 0, y: 0 },
  aimDir: null,
  dashPressed: false,
  attackPressed: false,
  attackHeld: false,
  shootHeld: false,
  specialPressed: false,
  confirmPressed: false,
  escapePressed: false,
  inventoryPressed: false,
  skill1Pressed: false,
  skill2Pressed: false,
  skill3Pressed: false,
  skill4Pressed: false,
  skill1Held: false,
  skill2Held: false,
  skill3Held: false,
  skill4Held: false,
  interactPressed: false,
};

/** スキル層（LB 押下中）でスキル 1〜4 に割り当てる面ボタン */
const SKILL_LAYER_BUTTONS = [BTN_A, BTN_X, BTN_Y, BTN_B] as const;

/** 円形デッドゾーン。しきい値未満は 0 ベクトル、長さ 1 超は正規化してクランプする */
function applyDeadzone(x: number, y: number): Vec {
  const v = { x, y };
  const len = length(v);
  if (len < STICK_DEADZONE) return { x: 0, y: 0 };
  if (len > 1) return normalize(v);
  return v;
}

export class GamepadInput {
  private index: number | null = null;
  private justConnected = false;
  private prevPressed = new Array<boolean>(BUTTON_SLOT_COUNT).fill(false);
  /** 直近の read() で Start が押されたか。プレイ中の「ポーズ」は B（= ダッシュと共用）ではなくこれだけで開く */
  private startJustPressed = false;

  /** 接続/切断イベントを購読する */
  attach(target: Window): void {
    target.addEventListener("gamepadconnected", (ev) => {
      this.index = ev.gamepad.index;
      this.justConnected = true;
    });
    target.addEventListener("gamepaddisconnected", (ev) => {
      if (ev.gamepad.index !== this.index) return;
      this.index = null;
      this.prevPressed.fill(false);
    });
  }

  /** 直近の read() で Start が今押されたか（B を含まない） */
  pausePressed(): boolean {
    return this.startJustPressed;
  }

  /** 接続していれば true。UI 表示用 */
  isConnected(): boolean {
    return this.index !== null;
  }

  /** 接続直後の 1 回だけ true を返す。呼ぶと消費される */
  consumeJustConnected(): boolean {
    const value = this.justConnected;
    this.justConnected = false;
    return value;
  }

  private currentPad(): Gamepad | null {
    if (this.index === null) return null;
    const pads = navigator.getGamepads();
    return pads[this.index] ?? null;
  }

  /**
   * 今フレームのパッド入力を読む。ボタンの「今フレーム押された」はここでエッジ検出するため、
   * 1 フレームにつき 1 回だけ呼ぶこと。
   */
  read(): GamepadFrame {
    const pad = this.currentPad();
    this.startJustPressed = false;
    if (!pad) return EMPTY_GAMEPAD_FRAME;

    const isDown = new Array<boolean>(BUTTON_SLOT_COUNT).fill(false);
    pad.buttons.forEach((button, i) => {
      if (i < BUTTON_SLOT_COUNT) isDown[i] = button.pressed;
    });
    const justPressed = (i: number): boolean => (isDown[i] ?? false) && !(this.prevPressed[i] ?? false);

    const dpad: Vec = {
      x: (isDown[BTN_DPAD_RIGHT] ? 1 : 0) - (isDown[BTN_DPAD_LEFT] ? 1 : 0),
      y: (isDown[BTN_DPAD_DOWN] ? 1 : 0) - (isDown[BTN_DPAD_UP] ? 1 : 0),
    };
    const leftStick = applyDeadzone(pad.axes[AXIS_LEFT_X] ?? 0, pad.axes[AXIS_LEFT_Y] ?? 0);
    const move = isZero(dpad) ? leftStick : normalize(dpad);

    const rightStick = applyDeadzone(pad.axes[AXIS_RIGHT_X] ?? 0, pad.axes[AXIS_RIGHT_Y] ?? 0);
    const aimDir = isZero(rightStick) ? null : normalize(rightStick);

    // LB はスキル層のシフト: 押している間は A / X / Y / B をスキル 1〜4 として読み、
    // 攻撃・射撃・必殺・ダッシュ・決定・戻るには使わない（RT / LT / RB はシフト中も効く）
    const shift = isDown[BTN_LB] ?? false;
    const face = (i: number): { pressed: boolean; held: boolean } => ({
      pressed: shift && justPressed(i),
      held: shift && (isDown[i] ?? false),
    });
    const [s1, s2, s3, s4] = SKILL_LAYER_BUTTONS.map(face);
    const faceDown = (i: number): boolean => !shift && (isDown[i] ?? false);
    const faceJust = (i: number): boolean => !shift && justPressed(i);

    const frame: GamepadFrame = {
      move,
      aimDir,
      dashPressed: faceJust(BTN_B) || justPressed(BTN_RB),
      attackPressed: justPressed(BTN_RT) || faceJust(BTN_A),
      attackHeld: (isDown[BTN_RT] ?? false) || faceDown(BTN_A),
      shootHeld: (isDown[BTN_LT] ?? false) || faceDown(BTN_X),
      specialPressed: faceJust(BTN_Y),
      confirmPressed: faceJust(BTN_A),
      escapePressed: faceJust(BTN_B) || justPressed(BTN_START),
      inventoryPressed: justPressed(BTN_BACK),
      skill1Pressed: s1?.pressed ?? false,
      skill2Pressed: s2?.pressed ?? false,
      skill3Pressed: s3?.pressed ?? false,
      skill4Pressed: s4?.pressed ?? false,
      skill1Held: s1?.held ?? false,
      skill2Held: s2?.held ?? false,
      skill3Held: s3?.held ?? false,
      skill4Held: s4?.held ?? false,
      // 面ボタンは全部埋まっている。射撃（X）と共用すると拾うたびに弾が出るので、空いている R3 に置く。
      // LB のスキル層とは関係しないので、シフト中も効く
      interactPressed: justPressed(BTN_RSTICK),
    };

    this.startJustPressed = justPressed(BTN_START);
    for (let i = 0; i < BUTTON_SLOT_COUNT; i++) this.prevPressed[i] = isDown[i] ?? false;
    return frame;
  }
}
