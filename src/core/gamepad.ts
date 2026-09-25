/**
 * ゲームパッド入力。navigator.getGamepads() を毎フレーム read() でポーリングする。
 * Standard Gamepad マッピングを前提とする。
 * PlayerInput.snapshot() 側でキーボード/マウス入力とマージされる（このファイルは関知しない）。
 */
import { type Vec, isZero, length, normalize } from "./vec";
import {
  PAD_A,
  PAD_B,
  PAD_BUTTON_COUNT,
  PAD_DPAD_DOWN,
  PAD_DPAD_LEFT,
  PAD_DPAD_RIGHT,
  PAD_DPAD_UP,
  PAD_START,
  chordTargetsByModifier,
  defaultPadBinds,
  parsePadCode,
  setActivePadBinds,
  type PadAction,
  type PadBinds,
} from "./padBinds";

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
  /** 右スティックの照準方向（正規化済み）。中立なら null */
  aimDir: Vec | null;
  dashPressed: boolean;
  attackPressed: boolean;
  attackHeld: boolean;
  shootHeld: boolean;
  specialPressed: boolean;
  confirmPressed: boolean;
  /** A の押下中（LB のスキル層を除く）。拠点の出撃の長押しが読む */
  confirmHeld: boolean;
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
  /** 床の遺物・スキル石を拾う（既定は右スティック押し込み。照準スティックの先を注目して押し込む） */
  interactPressed: boolean;
  /** 床のアイテム情報ポップアップの表示切替（既定は割り当て無し） */
  toggleDropInfoPressed: boolean;
  /** 何かのボタンを押しているかスティックを倒している。照準の入力元をパッドへ切り替える合図（core/input.ts） */
  active: boolean;
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
  confirmHeld: false,
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
  toggleDropInfoPressed: false,
  active: false,
};

/** 円形デッドゾーン。しきい値未満は 0 ベクトル、長さ 1 超は正規化してクランプする */
function applyDeadzone(x: number, y: number): Vec {
  const v = { x, y };
  const len = length(v);
  if (len < STICK_DEADZONE) return { x: 0, y: 0 };
  if (len > 1) return normalize(v);
  return v;
}

/** 1 アクションの押した瞬間 / 押している間 */
interface ActionState {
  pressed: boolean;
  held: boolean;
}

/**
 * ボタンの状態と割り当て表から、アクションごとの押下を解決する。
 * 組み合わせ（"LB+A"）の押さえる側を押している間、その押す側のボタン（A）は単独の割り当て・決定・戻るに使わない
 * （LB を押しながらの A でスキルを出したとき、攻撃や決定まで出ないように）
 */
export function resolvePadActions(
  binds: PadBinds,
  down: readonly boolean[],
  justPressed: readonly boolean[],
): { actions: Record<PadAction, ActionState>; consumed: (button: number) => boolean } {
  const chords = chordTargetsByModifier(binds);
  const consumed = (button: number): boolean => {
    for (const [modifier, targets] of chords) {
      if (down[modifier] && targets.has(button)) return true;
    }
    return false;
  };
  const actions = {} as Record<PadAction, ActionState>;
  for (const action of Object.keys(binds) as PadAction[]) {
    const state: ActionState = { pressed: false, held: false };
    for (const code of binds[action]) {
      const parsed = parsePadCode(code);
      if (!parsed) continue;
      const { modifier, button } = parsed;
      const isDown = down[button] ?? false;
      const isJust = justPressed[button] ?? false;
      if (modifier === null) {
        if (consumed(button)) continue;
        state.pressed ||= isJust;
        state.held ||= isDown;
        continue;
      }
      if (!down[modifier]) continue;
      state.pressed ||= isJust;
      state.held ||= isDown;
    }
    actions[action] = state;
  }
  return { actions, consumed };
}

export class GamepadInput {
  private index: number | null = null;
  private justConnected = false;
  private prevPressed = new Array<boolean>(PAD_BUTTON_COUNT).fill(false);
  /** 直近の read() のボタン状態。パッド設定の取得モードが読む */
  private lastDown: readonly boolean[] = new Array<boolean>(PAD_BUTTON_COUNT).fill(false);
  private lastJustPressed: readonly boolean[] = new Array<boolean>(PAD_BUTTON_COUNT).fill(false);
  /** 直近の read() で Start が押されたか。プレイ中の「ポーズ」は B（= ダッシュと共用）ではなくこれだけで開く */
  private startJustPressed = false;
  private binds: PadBinds = defaultPadBinds();

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

  /** ボタンの割り当て表を差し替える（設定画面で変えたとき） */
  setBinds(binds: PadBinds): void {
    this.binds = binds;
    setActivePadBinds(binds);
  }

  /** 直近の read() で Start が今押されたか（B を含まない） */
  pausePressed(): boolean {
    return this.startJustPressed;
  }

  /** 直近の read() のボタンの押下状態（添字 = Standard Gamepad のボタン番号） */
  buttonsDown(): readonly boolean[] {
    return this.lastDown;
  }

  /** 直近の read() で今押されたボタン */
  buttonsJustPressed(): readonly boolean[] {
    return this.lastJustPressed;
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
    if (!pad) {
      this.lastDown = new Array<boolean>(PAD_BUTTON_COUNT).fill(false);
      this.lastJustPressed = this.lastDown;
      return EMPTY_GAMEPAD_FRAME;
    }

    const isDown = new Array<boolean>(PAD_BUTTON_COUNT).fill(false);
    pad.buttons.forEach((button, i) => {
      if (i < PAD_BUTTON_COUNT) isDown[i] = button.pressed;
    });
    const just = isDown.map((d, i) => d && !(this.prevPressed[i] ?? false));
    const justPressed = (i: number): boolean => just[i] ?? false;

    const dpad: Vec = {
      x: (isDown[PAD_DPAD_RIGHT] ? 1 : 0) - (isDown[PAD_DPAD_LEFT] ? 1 : 0),
      y: (isDown[PAD_DPAD_DOWN] ? 1 : 0) - (isDown[PAD_DPAD_UP] ? 1 : 0),
    };
    const leftStick = applyDeadzone(pad.axes[AXIS_LEFT_X] ?? 0, pad.axes[AXIS_LEFT_Y] ?? 0);
    const move = isZero(dpad) ? leftStick : normalize(dpad);

    const rightStick = applyDeadzone(pad.axes[AXIS_RIGHT_X] ?? 0, pad.axes[AXIS_RIGHT_Y] ?? 0);
    const aimDir = isZero(rightStick) ? null : normalize(rightStick);

    const { actions: a, consumed } = resolvePadActions(this.binds, isDown, just);
    // メニューの決定 A / 戻る B は固定。組み合わせの押す側に使われている間（LB+A など）は出さない
    const menuJust = (i: number): boolean => justPressed(i) && !consumed(i);

    const frame: GamepadFrame = {
      move,
      aimDir,
      dashPressed: a.dash.pressed,
      attackPressed: a.attack.pressed,
      attackHeld: a.attack.held,
      shootHeld: a.shoot.held,
      specialPressed: a.special.pressed,
      confirmPressed: menuJust(PAD_A),
      confirmHeld: (isDown[PAD_A] ?? false) && !consumed(PAD_A),
      escapePressed: menuJust(PAD_B) || justPressed(PAD_START),
      inventoryPressed: a.inventory.pressed,
      skill1Pressed: a.skill1.pressed,
      skill2Pressed: a.skill2.pressed,
      skill3Pressed: a.skill3.pressed,
      skill4Pressed: a.skill4.pressed,
      skill1Held: a.skill1.held,
      skill2Held: a.skill2.held,
      skill3Held: a.skill3.held,
      skill4Held: a.skill4.held,
      interactPressed: a.interact.pressed,
      toggleDropInfoPressed: a.toggleDropInfo.pressed,
      active: isDown.some(Boolean) || !isZero(leftStick) || aimDir !== null,
    };

    this.startJustPressed = justPressed(PAD_START);
    this.lastDown = isDown;
    this.lastJustPressed = just;
    for (let i = 0; i < PAD_BUTTON_COUNT; i++) this.prevPressed[i] = isDown[i] ?? false;
    return frame;
  }
}
