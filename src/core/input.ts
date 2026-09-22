import { type Vec, ZERO, normalize, isZero, length } from "./vec";
import { VIEW_H, VIEW_W } from "./view";
import { AIM_STICK_DISTANCE, EMPTY_GAMEPAD_FRAME, type GamepadFrame, type GamepadInput } from "./gamepad";

export type ActionName =
  | "up"
  | "down"
  | "left"
  | "right"
  | "dash"
  | "attack"
  | "shoot"
  | "special"
  | "confirm"
  | "restart"
  | "inventory"
  | "skill1"
  | "skill2";

/** KeyboardEvent.code で束縛する（配列に依存しない） */
const BINDINGS: Record<ActionName, readonly string[]> = {
  up: ["KeyW", "ArrowUp"],
  down: ["KeyS", "ArrowDown"],
  left: ["KeyA", "ArrowLeft"],
  right: ["KeyD", "ArrowRight"],
  dash: ["Space", "ShiftLeft", "ShiftRight"],
  // 右手はマウスなので、キーボード側は全部左手で届く位置に置く
  attack: ["KeyE"],
  shoot: ["KeyQ"],
  special: ["KeyF"],
  confirm: ["Enter"],
  restart: ["KeyR"],
  inventory: ["Tab", "KeyI"],
  // スキルは左手の数字キーと C / V。マウスのサイドボタンは MOUSE_BINDINGS
  skill1: ["Digit1", "KeyC"],
  skill2: ["Digit2", "KeyV"],
};

const MOUSE_LEFT = 0;
const MOUSE_RIGHT = 2;
/** サイドボタン（戻る / 進む）。ブラウザの履歴移動を止める必要がある */
const MOUSE_BACK = 3;
const MOUSE_FORWARD = 4;
const HISTORY_BUTTONS: ReadonlySet<number> = new Set([MOUSE_BACK, MOUSE_FORWARD]);
/** マウスボタンを擬似キーコードとして扱う */
const MOUSE_CODE: Record<number, string> = {
  [MOUSE_LEFT]: "Mouse0",
  [MOUSE_RIGHT]: "Mouse2",
  [MOUSE_BACK]: "Mouse3",
  [MOUSE_FORWARD]: "Mouse4",
};
const MOUSE_BINDINGS: Partial<Record<ActionName, string>> = {
  attack: "Mouse0",
  shoot: "Mouse2",
  skill1: "Mouse3",
  skill2: "Mouse4",
};

/** アクションに束縛されたキーコード（マウスは "MouseN" の擬似コード） */
export function codesForAction(action: ActionName): string[] {
  const mouse = MOUSE_BINDINGS[action];
  return mouse ? [...BINDINGS[action], mouse] : [...BINDINGS[action]];
}

/** マウスボタン番号 → 擬似キーコード */
export function mouseButtonCode(button: number): string | undefined {
  return MOUSE_CODE[button];
}

/** 1 フレームぶんの入力スナップショット。ゲームロジックはこれだけを見る */
export interface FrameInput {
  /** 正規化済み移動ベクトル（無入力なら 0,0） */
  move: Vec;
  /** マウス照準位置（画面内部座標）。マウス未使用なら null */
  aimScreen: Vec | null;
  dashPressed: boolean;
  attackPressed: boolean;
  shootHeld: boolean;
  specialPressed: boolean;
  confirmPressed: boolean;
  restartPressed: boolean;
  inventoryPressed: boolean;
  /** スキルスロット 1 / 2 */
  skill1Pressed: boolean;
  skill2Pressed: boolean;
  /** 今フレームのホイール移動量（正 = 下）。UI のスクロール用 */
  wheel: number;
  /** 今フレームに左クリックが押されたか（UI 用。attackPressed と同じ元だが意味を分ける） */
  clickPressed: boolean;
  shiftHeld: boolean;
}

export const EMPTY_INPUT: Readonly<FrameInput> = {
  move: { x: 0, y: 0 },
  aimScreen: null,
  dashPressed: false,
  attackPressed: false,
  shootHeld: false,
  specialPressed: false,
  confirmPressed: false,
  restartPressed: false,
  inventoryPressed: false,
  skill1Pressed: false,
  skill2Pressed: false,
  wheel: 0,
  clickPressed: false,
  shiftHeld: false,
};

export class PlayerInput {
  private readonly down = new Set<string>();
  private readonly pressed = new Set<string>();
  private mouseScreen: Vec | null = null;
  private wheelDelta = 0;
  private gamepad: GamepadInput | null = null;
  /** 直近の snapshot() で読んだパッド入力。メニューの戻る/ポーズ判定に main.ts から参照される */
  private lastGamepadFrame: GamepadFrame = EMPTY_GAMEPAD_FRAME;

  /** ゲームパッドを紐付ける。以後 snapshot() が毎フレーム読み取ってマージする */
  attachGamepad(gamepad: GamepadInput): void {
    this.gamepad = gamepad;
  }

  /** 直近フレームでパッドの「戻る/ポーズ」（B or Start）が今押されたか。main.ts がメニュー hotkeys にマージする */
  gamepadEscapePressed(): boolean {
    return this.lastGamepadFrame.escapePressed;
  }

  attachKeyboard(target: Window): void {
    target.addEventListener("keydown", (ev) => {
      if (ev.repeat) return;
      this.down.add(ev.code);
      this.pressed.add(ev.code);
      if (this.isBound(ev.code)) ev.preventDefault();
    });
    target.addEventListener("keyup", (ev) => {
      this.down.delete(ev.code);
    });
    target.addEventListener("blur", () => {
      this.down.clear();
      this.pressed.clear();
    });
  }

  /** canvas の CSS サイズと内部解像度の比で座標を変換する */
  attachMouse(canvas: HTMLCanvasElement): void {
    canvas.addEventListener("mousemove", (ev) => {
      const rect = canvas.getBoundingClientRect();
      this.mouseScreen = {
        x: ((ev.clientX - rect.left) / rect.width) * VIEW_W,
        y: ((ev.clientY - rect.top) / rect.height) * VIEW_H,
      };
    });
    canvas.addEventListener("mousedown", (ev) => {
      const code = MOUSE_CODE[ev.button];
      if (!code) return;
      this.down.add(code);
      this.pressed.add(code);
      ev.preventDefault();
    });
    window.addEventListener("mouseup", (ev) => {
      // 戻る / 進むは mouseup で発火するので、ここでも止める
      if (HISTORY_BUTTONS.has(ev.button)) ev.preventDefault();
      const code = MOUSE_CODE[ev.button];
      if (code) this.down.delete(code);
    });
    canvas.addEventListener("contextmenu", (ev) => ev.preventDefault());
    canvas.addEventListener(
      "wheel",
      (ev) => {
        this.wheelDelta += Math.sign(ev.deltaY);
        ev.preventDefault();
      },
      { passive: false },
    );
    canvas.addEventListener("mouseleave", () => {
      // 画面外に出たら押しっぱなし判定を解除する
      for (const code of Object.values(MOUSE_CODE)) this.down.delete(code);
    });
  }

  private isBound(code: string): boolean {
    return Object.values(BINDINGS).some((codes) => codes.includes(code));
  }

  private codesFor(action: ActionName): string[] {
    return codesForAction(action);
  }

  private isDown(action: ActionName): boolean {
    return this.codesFor(action).some((c) => this.down.has(c));
  }

  private wasPressed(action: ActionName): boolean {
    return this.codesFor(action).some((c) => this.pressed.has(c));
  }

  /**
   * 今フレームの入力を切り出す。押下フラグは呼び出しごとに消費される。
   * cameraOffset は右スティック照準を画面座標に変換するときの画面中心のずれ（画面揺れ分）。
   */
  snapshot(cameraOffset: Vec = ZERO): FrameInput {
    const pad = this.gamepad?.read() ?? EMPTY_GAMEPAD_FRAME;
    this.lastGamepadFrame = pad;

    const raw = {
      x: (this.isDown("right") ? 1 : 0) - (this.isDown("left") ? 1 : 0),
      y: (this.isDown("down") ? 1 : 0) - (this.isDown("up") ? 1 : 0),
    };
    const kbMove = isZero(raw) ? { x: 0, y: 0 } : normalize(raw);
    // move はキーボード/パッドのうち、大きい方（アナログの踏み込みを活かす）
    const move = length(pad.move) > length(kbMove) ? pad.move : kbMove;

    // 右スティックが中立ならマウス/キーボード照準を優先。入力があれば画面中心からの方向で上書きする
    const aimScreen = pad.aimDir
      ? {
          x: VIEW_W / 2 + cameraOffset.x + pad.aimDir.x * AIM_STICK_DISTANCE,
          y: VIEW_H / 2 + cameraOffset.y + pad.aimDir.y * AIM_STICK_DISTANCE,
        }
      : this.mouseScreen
        ? { ...this.mouseScreen }
        : null;

    const input: FrameInput = {
      move,
      aimScreen,
      dashPressed: this.wasPressed("dash") || pad.dashPressed,
      attackPressed: this.wasPressed("attack") || pad.attackPressed,
      shootHeld: this.isDown("shoot") || pad.shootHeld,
      specialPressed: this.wasPressed("special") || pad.specialPressed,
      confirmPressed: this.wasPressed("confirm") || pad.confirmPressed,
      restartPressed: this.wasPressed("restart"),
      inventoryPressed: this.wasPressed("inventory") || pad.inventoryPressed,
      skill1Pressed: this.wasPressed("skill1") || pad.skill1Pressed,
      skill2Pressed: this.wasPressed("skill2") || pad.skill2Pressed,
      wheel: this.wheelDelta,
      clickPressed: this.pressed.has("Mouse0"),
      shiftHeld: this.down.has("ShiftLeft") || this.down.has("ShiftRight"),
    };
    this.pressed.clear();
    this.wheelDelta = 0;
    return input;
  }
}
