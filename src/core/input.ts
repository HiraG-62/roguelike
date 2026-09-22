import { type Vec, normalize, isZero } from "./vec";
import { VIEW_H, VIEW_W } from "./view";

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
  | "restart";

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
};

const MOUSE_LEFT = 0;
const MOUSE_RIGHT = 2;
/** マウスボタンを擬似キーコードとして扱う */
const MOUSE_CODE: Record<number, string> = {
  [MOUSE_LEFT]: "Mouse0",
  [MOUSE_RIGHT]: "Mouse2",
};
const MOUSE_BINDINGS: Partial<Record<ActionName, string>> = {
  attack: "Mouse0",
  shoot: "Mouse2",
};

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
};

export class PlayerInput {
  private readonly down = new Set<string>();
  private readonly pressed = new Set<string>();
  private mouseScreen: Vec | null = null;

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
      const code = MOUSE_CODE[ev.button];
      if (code) this.down.delete(code);
    });
    canvas.addEventListener("contextmenu", (ev) => ev.preventDefault());
    canvas.addEventListener("mouseleave", () => {
      // 画面外に出たら押しっぱなし判定を解除する
      for (const code of Object.values(MOUSE_CODE)) this.down.delete(code);
    });
  }

  private isBound(code: string): boolean {
    return Object.values(BINDINGS).some((codes) => codes.includes(code));
  }

  private codesFor(action: ActionName): string[] {
    const mouse = MOUSE_BINDINGS[action];
    return mouse ? [...BINDINGS[action], mouse] : [...BINDINGS[action]];
  }

  private isDown(action: ActionName): boolean {
    return this.codesFor(action).some((c) => this.down.has(c));
  }

  private wasPressed(action: ActionName): boolean {
    return this.codesFor(action).some((c) => this.pressed.has(c));
  }

  /** 今フレームの入力を切り出す。押下フラグは呼び出しごとに消費される */
  snapshot(): FrameInput {
    const raw = {
      x: (this.isDown("right") ? 1 : 0) - (this.isDown("left") ? 1 : 0),
      y: (this.isDown("down") ? 1 : 0) - (this.isDown("up") ? 1 : 0),
    };
    const input: FrameInput = {
      move: isZero(raw) ? { x: 0, y: 0 } : normalize(raw),
      aimScreen: this.mouseScreen ? { ...this.mouseScreen } : null,
      dashPressed: this.wasPressed("dash"),
      attackPressed: this.wasPressed("attack"),
      shootHeld: this.isDown("shoot"),
      specialPressed: this.wasPressed("special"),
      confirmPressed: this.wasPressed("confirm"),
      restartPressed: this.wasPressed("restart"),
    };
    this.pressed.clear();
    return input;
  }
}
