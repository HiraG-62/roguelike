import { type Vec, ZERO, normalize, isZero, length } from "./vec";
import { VIEW_H, VIEW_W } from "./view";
import { AIM_STICK_DISTANCE, EMPTY_GAMEPAD_FRAME, type GamepadFrame, type GamepadInput } from "./gamepad";

export const ACTION_NAMES = [
  "up",
  "down",
  "left",
  "right",
  "dash",
  "attack",
  "shoot",
  "special",
  "confirm",
  "restart",
  "inventory",
  "skill1",
  "skill2",
  "skill3",
  "skill4",
  "interact",
] as const;
export type ActionName = (typeof ACTION_NAMES)[number];

/** KeyboardEvent.code か、マウスボタンの擬似コード "MouseN" */
export type BindingCode = string;
/** アクションごとの束縛。配列の先頭から 主 / 副 / 予備 の列に対応する（空き列は詰める） */
export type Keybinds = Record<ActionName, readonly BindingCode[]>;

/**
 * 設定画面から変更できるアクション（表示順）。confirm（Enter）だけは
 * メニュー操作の逃げ道なので固定にする（リスタートも変更できる）
 */
export const REBINDABLE_ACTIONS = [
  "up",
  "down",
  "left",
  "right",
  "dash",
  "attack",
  "shoot",
  "special",
  "inventory",
  "skill1",
  "skill2",
  "skill3",
  "skill4",
  "interact",
  "restart",
] as const satisfies readonly ActionName[];
export type RebindableAction = (typeof REBINDABLE_ACTIONS)[number];

/**
 * 1 アクションの束縛の上限。既定のダッシュ（Space / 左右 Shift）とスキル 1 / 2（数字 / 文字 / サイドボタン）が
 * 3 つ持つので 3 列にする
 */
export const KEYBIND_SLOTS = 3;

/**
 * 既定の束縛。キーボードとマウスを同じ表で持つ。
 * 右手はマウスなので、キーボード側は全部左手で届く位置に置く。
 * スキルは左手の数字キーと C / V / X / Z、サイドボタンはスキル 1 / 2（docs/COMBAT_DESIGN.md B-3）
 */
export const DEFAULT_KEYBINDS: Readonly<Keybinds> = {
  up: ["KeyW", "ArrowUp"],
  down: ["KeyS", "ArrowDown"],
  left: ["KeyA", "ArrowLeft"],
  right: ["KeyD", "ArrowRight"],
  dash: ["Space", "ShiftLeft", "ShiftRight"],
  attack: ["KeyE", "Mouse0"],
  shoot: ["KeyQ", "Mouse2"],
  special: ["KeyF"],
  confirm: ["Enter"],
  restart: ["KeyR"],
  inventory: ["Tab", "KeyI"],
  skill1: ["Digit1", "KeyC", "Mouse3"],
  skill2: ["Digit2", "KeyV", "Mouse4"],
  skill3: ["Digit3", "KeyX"],
  skill4: ["Digit4", "KeyZ"],
  // 床の遺物・スキル石を拾う。WASD の右隣で、移動しながら左手で押せる
  interact: ["KeyG"],
};

/**
 * 割り当てに使えないコード。Escape は取得の取り消し・ポーズ、Backspace / Delete は列を空にする操作、
 * Enter は固定の confirm に使う
 */
const RESERVED_CODES: ReadonlySet<BindingCode> = new Set(["Escape", "Backspace", "Delete", "Enter", "NumpadEnter"]);
/** コードとして受け付ける最大長（壊れたセーブの巨大文字列を弾く） */
const MAX_CODE_LENGTH = 32;

/** スキルスロット i のアクション名（スロット順） */
export const SKILL_ACTIONS: readonly ActionName[] = ["skill1", "skill2", "skill3", "skill4"];

const MOUSE_LEFT = 0;
const MOUSE_RIGHT = 2;
/** サイドボタン（戻る / 進む）。ブラウザの履歴移動を止める必要がある */
const MOUSE_BACK = 3;
const MOUSE_FORWARD = 4;
const HISTORY_BUTTONS: ReadonlySet<number> = new Set([MOUSE_BACK, MOUSE_FORWARD]);
/** マウスボタンを擬似キーコードとして扱う */
const MOUSE_CODE: Record<number, BindingCode> = {
  [MOUSE_LEFT]: "Mouse0",
  [MOUSE_RIGHT]: "Mouse2",
  [MOUSE_BACK]: "Mouse3",
  [MOUSE_FORWARD]: "Mouse4",
};
const MOUSE_CODE_SET: ReadonlySet<BindingCode> = new Set(Object.values(MOUSE_CODE));
/** UI クリック（clickPressed）は割り当てに関係なく左クリック固定 */
const UI_CLICK_CODE: BindingCode = "Mouse0";

/** 表示名の特例。それ以外は Key / Digit を落とすか code をそのまま出す */
const CODE_LABEL: Readonly<Record<string, string>> = {
  Mouse0: "左クリック",
  Mouse2: "右クリック",
  Mouse3: "サイド1",
  Mouse4: "サイド2",
  ShiftLeft: "L-Shift",
  ShiftRight: "R-Shift",
  ControlLeft: "L-Ctrl",
  ControlRight: "R-Ctrl",
  AltLeft: "L-Alt",
  AltRight: "R-Alt",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
};
/** キー表示で KeyboardEvent.code から落とす接頭辞 */
const KEY_CODE_PREFIX = /^(Digit|Key)/;

/** 既定の表の複製（呼び出し側が書き換えても既定を汚さない） */
export function defaultKeybinds(): Keybinds {
  const out = {} as Record<ActionName, readonly BindingCode[]>;
  for (const action of ACTION_NAMES) out[action] = [...DEFAULT_KEYBINDS[action]];
  return out;
}

export function isMouseCode(code: BindingCode): boolean {
  return MOUSE_CODE_SET.has(code);
}

export function isRebindable(action: ActionName): action is RebindableAction {
  return (REBINDABLE_ACTIONS as readonly ActionName[]).includes(action);
}

/** 変更不可のアクション（confirm / restart）が持つコード */
const FIXED_CODES: ReadonlySet<BindingCode> = new Set(
  ACTION_NAMES.filter((action) => !isRebindable(action)).flatMap((action) => DEFAULT_KEYBINDS[action]),
);

/** 変更可能なアクションに割り当ててよいコードか（予約キー・固定アクションのキーは不可） */
export function isAssignableCode(code: BindingCode): boolean {
  if (code.length === 0 || code.length > MAX_CODE_LENGTH) return false;
  if (RESERVED_CODES.has(code)) return false;
  return !FIXED_CODES.has(code);
}

/** 表示用の短い名前（"KeyE" → "E"、"Mouse3" → "サイド1"） */
export function formatBindingCode(code: BindingCode): string {
  const special = CODE_LABEL[code];
  if (special !== undefined) return special;
  return code.replace(KEY_CODE_PREFIX, "");
}

/** 1 アクション分の生データを検証する。不正なら null（呼び出し側が既定へ戻す） */
function sanitizeActionCodes(raw: unknown): BindingCode[] | null {
  if (!Array.isArray(raw)) return null;
  if (raw.length === 0 || raw.length > KEYBIND_SLOTS) return null;
  const codes: BindingCode[] = [];
  for (const value of raw) {
    if (typeof value !== "string" || !isAssignableCode(value)) return null;
    if (codes.includes(value)) return null;
    codes.push(value);
  }
  return codes;
}

/** 表の中で 2 つ以上のアクションに現れるコードを持つアクション */
function actionsWithDuplicates(binds: Keybinds): Set<ActionName> {
  const owner = new Map<BindingCode, ActionName>();
  const out = new Set<ActionName>();
  for (const action of ACTION_NAMES) {
    for (const code of binds[action]) {
      const prev = owner.get(code);
      if (prev !== undefined && prev !== action) {
        out.add(prev);
        out.add(action);
      }
      owner.set(code, action);
    }
  }
  return out;
}

/**
 * 保存データから束縛表を復元する。未知アクションは無視、欠け・不正な値は既定、
 * アクション間の重複は関わったアクションを既定へ戻す（既定同士は重複しないので必ず収束する）
 */
export function sanitizeKeybinds(raw: unknown): Keybinds {
  const binds = defaultKeybinds();
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return binds;
  const record = raw as Record<string, unknown>;
  for (const action of REBINDABLE_ACTIONS) {
    const codes = sanitizeActionCodes(record[action]);
    if (codes) binds[action] = codes;
  }
  for (let dup = actionsWithDuplicates(binds); dup.size > 0; dup = actionsWithDuplicates(binds)) {
    for (const action of dup) binds[action] = [...DEFAULT_KEYBINDS[action]];
  }
  return binds;
}

/** action 以外で code を持っているアクション */
function ownerOf(binds: Keybinds, code: BindingCode, except: ActionName): ActionName | null {
  for (const action of ACTION_NAMES) {
    if (action !== except && binds[action].includes(code)) return action;
  }
  return null;
}

/**
 * action の slot 列に code を割り当てた新しい表を返す。割り当てられないときは null。
 * 空き列を指したら末尾に詰める。同じコードを持つ別アクションからは外し、外すとそのアクションが空になる場合は
 * 上書きされる元のコードを渡して入れ替える（渡すものが無ければ拒否。どのアクションも空にしないため）
 */
export function assignBinding(binds: Keybinds, action: RebindableAction, slot: number, code: BindingCode): Keybinds | null {
  if (slot < 0 || slot >= KEYBIND_SLOTS || !isAssignableCode(code)) return null;
  const current = binds[action];
  const previous = current[slot];
  if (previous === code) return binds;

  const existing = current.indexOf(code);
  if (existing !== -1) {
    // 同じアクションの別の列にあるコードは列の入れ替えとして扱う。空き列へは動かさない（詰めるので意味が無い）
    if (previous === undefined) return binds;
    const swapped = [...current];
    swapped[existing] = previous;
    swapped[slot] = code;
    return { ...binds, [action]: swapped };
  }

  const placed = [...current];
  placed[Math.min(slot, placed.length)] = code;
  const next: Keybinds = { ...binds, [action]: placed };

  const victim = ownerOf(binds, code, action);
  if (victim === null) return next;
  const victimCodes = binds[victim].filter((c) => c !== code);
  if (victimCodes.length > 0) return { ...next, [victim]: victimCodes };
  if (previous === undefined) return null;
  return { ...next, [victim]: [previous] };
}

/** action の slot 列を空にした新しい表（後ろの列は詰める）。最後の 1 つは消せない（null） */
export function clearBinding(binds: Keybinds, action: RebindableAction, slot: number): Keybinds | null {
  const current = binds[action];
  if (slot < 0 || slot >= current.length) return null;
  if (current.length <= 1) return null;
  return { ...binds, [action]: current.filter((_, i) => i !== slot) };
}

/** HUD / ツールチップのキー表記が参照する現在の表。PlayerInput.setKeybinds が更新する */
let activeKeybinds: Keybinds = defaultKeybinds();

/** アクションに束縛されたコード（マウスは "MouseN" の擬似コード） */
export function codesForAction(action: ActionName, binds: Keybinds = activeKeybinds): BindingCode[] {
  return [...binds[action]];
}

/**
 * スキルスロット i のキー表記（例: "1 / C"）。UI のキー案内用。
 * マウスのサイドボタンは付いていない環境が多いので、キーボードがあれば載せずマウスしか無いときだけ出す
 */
export function skillKeyLabel(slot: number): string {
  return skillKeyLabelFor(slot, activeKeybinds);
}

/** skillKeyLabel の表を指定する版（テスト・設定画面のプレビュー用。map に渡せるよう本体は引数 1 つに保つ） */
export function skillKeyLabelFor(slot: number, binds: Keybinds): string {
  const action = SKILL_ACTIONS[slot];
  if (!action) return "";
  const codes = binds[action];
  const keyboard = codes.filter((code) => !isMouseCode(code));
  const shown = keyboard.length > 0 ? keyboard : codes;
  return shown.map(formatBindingCode).join(" / ");
}

/** アクションの現在のキー表記（例: "R"、"E / 左クリック"）。死亡画面などのキー案内用 */
export function actionKeyLabel(action: ActionName, binds: Keybinds = activeKeybinds): string {
  return binds[action].map(formatBindingCode).join(" / ");
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
  /** 攻撃キーの押しっぱなし（大剣の溜め攻撃。src/data/weapons.ts） */
  attackHeld: boolean;
  shootHeld: boolean;
  specialPressed: boolean;
  confirmPressed: boolean;
  /**
   * パッド A のエッジのみ（キーボード Enter を含まない）。confirmPressed はキーボード/パッド OR なので、
   * 「パッドの A だけを特別扱いしたい」場面（死亡画面の誤爆防止、祝福選択の attack との衝突回避）はこちらを見る
   */
  padConfirmPressed: boolean;
  restartPressed: boolean;
  inventoryPressed: boolean;
  /** スキルスロット 1 / 2 */
  skill1Pressed: boolean;
  skill2Pressed: boolean;
  /** スキルスロット 1 / 2 の押しっぱなし（Charge 刻印符の溜め入力）。パッドは LB を押しながらの A / X */
  skill1Held: boolean;
  skill2Held: boolean;
  /** スキルスロット 3 / 4（docs/COMBAT_DESIGN.md B-3）。パッドは LB を押しながらの Y / B */
  skill3Pressed: boolean;
  skill4Pressed: boolean;
  skill3Held: boolean;
  skill4Held: boolean;
  /** カーソル（パッドは照準スティックの先）で注目した床の遺物・スキル石を拾う。system/loot.ts */
  interactPressed: boolean;
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
  attackHeld: false,
  shootHeld: false,
  specialPressed: false,
  confirmPressed: false,
  padConfirmPressed: false,
  restartPressed: false,
  inventoryPressed: false,
  skill1Pressed: false,
  skill2Pressed: false,
  skill1Held: false,
  skill2Held: false,
  skill3Pressed: false,
  skill4Pressed: false,
  skill3Held: false,
  skill4Held: false,
  interactPressed: false,
  wheel: 0,
  clickPressed: false,
  shiftHeld: false,
};

export class PlayerInput {
  private readonly down = new Set<string>();
  private readonly pressed = new Set<string>();
  /** 直近の snapshot() で消費した押下コード（押した順）。キー設定の取得モードが takeAnyPressedCode で読む */
  private framePressed: BindingCode[] = [];
  private binds: Keybinds = defaultKeybinds();
  /** キー設定の取得モード中は、束縛の有無に関係なくキーの既定動作（Tab の焦点移動など）を止める */
  private capturing = false;
  private mouseScreen: Vec | null = null;
  private wheelDelta = 0;
  private gamepad: GamepadInput | null = null;
  /** 直近の snapshot() で読んだパッド入力。メニューの戻る/ポーズ判定に main.ts から参照される */
  private lastGamepadFrame: GamepadFrame = EMPTY_GAMEPAD_FRAME;

  /** ゲームパッドを紐付ける。以後 snapshot() が毎フレーム読み取ってマージする */
  attachGamepad(gamepad: GamepadInput): void {
    this.gamepad = gamepad;
  }

  /** 束縛表を差し替える。HUD のキー表記（skillKeyLabel）も同じ表を読むように合わせる */
  setKeybinds(binds: Keybinds): void {
    this.binds = binds;
    activeKeybinds = binds;
  }

  /** キー設定の取得モードの切り替え */
  setCapturing(on: boolean): void {
    this.capturing = on;
  }

  /**
   * 直近の snapshot() で押されたコードを押した順に 1 つずつ取り出す（無ければ null）。
   * snapshot() が押下集合を毎フレーム消費するので、その前に写しを取っておいたものから返す
   */
  takeAnyPressedCode(): BindingCode | null {
    return this.framePressed.shift() ?? null;
  }

  /** 直近フレームでパッドの「戻る/ポーズ」（B or Start）が今押されたか。main.ts がメニュー hotkeys にマージする */
  gamepadEscapePressed(): boolean {
    return this.lastGamepadFrame.escapePressed;
  }

  /**
   * 決定キー（Enter / パッド A）を押し続けているか。FrameInput は押した瞬間しか持たず、
   * 拠点の出撃の長押しはリプレイに記録しないので FrameInput の外で読ませる。パッドは直近 snapshot() の値
   */
  confirmHeld(): boolean {
    return this.isDown("confirm") || this.lastGamepadFrame.confirmHeld;
  }

  attachKeyboard(target: Window): void {
    target.addEventListener("keydown", (ev) => {
      if (ev.repeat) return;
      this.down.add(ev.code);
      this.pressed.add(ev.code);
      if (this.capturing || this.isBound(ev.code)) ev.preventDefault();
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
    return ACTION_NAMES.some((action) => this.binds[action].includes(code));
  }

  private codesFor(action: ActionName): readonly BindingCode[] {
    return this.binds[action];
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
      attackHeld: this.isDown("attack") || pad.attackHeld,
      shootHeld: this.isDown("shoot") || pad.shootHeld,
      specialPressed: this.wasPressed("special") || pad.specialPressed,
      confirmPressed: this.wasPressed("confirm") || pad.confirmPressed,
      padConfirmPressed: pad.confirmPressed,
      restartPressed: this.wasPressed("restart"),
      inventoryPressed: this.wasPressed("inventory") || pad.inventoryPressed,
      skill1Pressed: this.wasPressed("skill1") || pad.skill1Pressed,
      skill2Pressed: this.wasPressed("skill2") || pad.skill2Pressed,
      skill1Held: this.isDown("skill1") || pad.skill1Held,
      skill2Held: this.isDown("skill2") || pad.skill2Held,
      skill3Pressed: this.wasPressed("skill3") || pad.skill3Pressed,
      skill4Pressed: this.wasPressed("skill4") || pad.skill4Pressed,
      skill3Held: this.isDown("skill3") || pad.skill3Held,
      skill4Held: this.isDown("skill4") || pad.skill4Held,
      interactPressed: this.wasPressed("interact") || pad.interactPressed,
      wheel: this.wheelDelta,
      clickPressed: this.pressed.has(UI_CLICK_CODE),
      shiftHeld: this.down.has("ShiftLeft") || this.down.has("ShiftRight"),
    };
    // Set は挿入順を保つので、押した順のまま写す
    this.framePressed = [...this.pressed];
    this.pressed.clear();
    this.wheelDelta = 0;
    return input;
  }
}
