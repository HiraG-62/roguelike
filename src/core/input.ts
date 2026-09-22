import { type Vec, normalize, isZero } from "./vec";

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
  attack: ["KeyJ", "KeyZ"],
  shoot: ["KeyK", "KeyX"],
  special: ["KeyL", "KeyC"],
  confirm: ["Enter"],
  restart: ["KeyR"],
};

/** 1 フレームぶんの入力スナップショット。ゲームロジックはこれだけを見る */
export interface FrameInput {
  /** 正規化済み移動ベクトル（無入力なら 0,0） */
  move: Vec;
  dashPressed: boolean;
  attackPressed: boolean;
  shootHeld: boolean;
  specialPressed: boolean;
  confirmPressed: boolean;
  restartPressed: boolean;
}

export const EMPTY_INPUT: Readonly<FrameInput> = {
  move: { x: 0, y: 0 },
  dashPressed: false,
  attackPressed: false,
  shootHeld: false,
  specialPressed: false,
  confirmPressed: false,
  restartPressed: false,
};

export class KeyboardInput {
  private readonly down = new Set<string>();
  private readonly pressed = new Set<string>();

  attach(target: Window): void {
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

  private isBound(code: string): boolean {
    return Object.values(BINDINGS).some((codes) => codes.includes(code));
  }

  private isDown(action: ActionName): boolean {
    return BINDINGS[action].some((c) => this.down.has(c));
  }

  private wasPressed(action: ActionName): boolean {
    return BINDINGS[action].some((c) => this.pressed.has(c));
  }

  /** 今フレームの入力を切り出す。押下フラグは呼び出しごとに消費される */
  snapshot(): FrameInput {
    const raw = {
      x: (this.isDown("right") ? 1 : 0) - (this.isDown("left") ? 1 : 0),
      y: (this.isDown("down") ? 1 : 0) - (this.isDown("up") ? 1 : 0),
    };
    const input: FrameInput = {
      move: isZero(raw) ? { x: 0, y: 0 } : normalize(raw),
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
