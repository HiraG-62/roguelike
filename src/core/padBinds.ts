/**
 * ゲームパッドのボタン設定（キーボードの Keybinds とは別の表）。
 * コードは "Pad<ボタン番号>"（Standard Gamepad）と、組み合わせ "Pad<押さえる>+Pad<押す>"（例: LB を押しながら A）。
 * 移動（左スティック・十字キー）・照準（右スティック）・メニューの決定 A / 戻る B / ポーズ Start は固定。
 * 解決（どのボタンがどのアクションになるか）は core/gamepad.ts、画面は main.ts のキー設定画面をパッドの表で使い回す
 */

/** パッドで割り当て直せるアクション（表示順）。移動は左スティック・十字キー固定なので含めない */
export const PAD_ACTIONS = [
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
  "toggleDropInfo",
] as const;
export type PadAction = (typeof PAD_ACTIONS)[number];

export type PadCode = string;
export type PadBinds = Record<PadAction, readonly PadCode[]>;

/** 1 アクションの束縛の上限。キー設定の列（主 / 副 / 予備）と同じ数にして画面を共用する */
export const PAD_BIND_SLOTS = 3;

// Standard Gamepad のボタン番号
export const PAD_A = 0;
export const PAD_B = 1;
export const PAD_X = 2;
export const PAD_Y = 3;
export const PAD_LB = 4;
export const PAD_RB = 5;
export const PAD_LT = 6;
export const PAD_RT = 7;
export const PAD_BACK = 8;
export const PAD_START = 9;
export const PAD_LSTICK = 10;
export const PAD_RSTICK = 11;
export const PAD_DPAD_UP = 12;
export const PAD_DPAD_DOWN = 13;
export const PAD_DPAD_LEFT = 14;
export const PAD_DPAD_RIGHT = 15;
/** 読み取るボタンの数（Standard Gamepad の 0〜15。16 番のホームボタンは OS が使うので読まない） */
export const PAD_BUTTON_COUNT = 16;

/**
 * 割り当てに使えないボタン。Start はポーズと取得の取り消し、十字キーは移動とメニュー操作に固定する
 * （割り当てると移動と同時に技が出て、メニューでも迷子になるため）
 */
const RESERVED_BUTTONS: ReadonlySet<number> = new Set([PAD_START, PAD_DPAD_UP, PAD_DPAD_DOWN, PAD_DPAD_LEFT, PAD_DPAD_RIGHT]);

const BUTTON_LABEL: Readonly<Record<number, string>> = {
  [PAD_A]: "A",
  [PAD_B]: "B",
  [PAD_X]: "X",
  [PAD_Y]: "Y",
  [PAD_LB]: "LB",
  [PAD_RB]: "RB",
  [PAD_LT]: "LT",
  [PAD_RT]: "RT",
  [PAD_BACK]: "Back",
  [PAD_START]: "Start",
  [PAD_LSTICK]: "L3",
  [PAD_RSTICK]: "R3",
};

const CODE_PATTERN = /^Pad(\d{1,2})(?:\+Pad(\d{1,2}))?$/;
const CHORD_SEPARATOR = "+";

/** コードの中身。modifier は組み合わせの「押さえる」側（単独なら null） */
export interface ParsedPadCode {
  modifier: number | null;
  button: number;
}

export function padButtonCode(button: number): PadCode {
  return `Pad${button}`;
}

export function padChordCode(modifier: number, button: number): PadCode {
  return `${padButtonCode(modifier)}${CHORD_SEPARATOR}${padButtonCode(button)}`;
}

export function isAssignableButton(button: number): boolean {
  return Number.isInteger(button) && button >= 0 && button < PAD_BUTTON_COUNT && !RESERVED_BUTTONS.has(button);
}

/** 割り当てられるコードなら中身を返す（不正・予約ボタン・同じボタン同士の組み合わせは null） */
export function parsePadCode(code: PadCode): ParsedPadCode | null {
  const m = CODE_PATTERN.exec(code);
  if (!m || m[1] === undefined) return null;
  const first = Number(m[1]);
  if (!isAssignableButton(first)) return null;
  if (m[2] === undefined) return { modifier: null, button: first };
  const second = Number(m[2]);
  if (!isAssignableButton(second) || second === first) return null;
  return { modifier: first, button: second };
}

function buttonLabel(button: number): string {
  return BUTTON_LABEL[button] ?? `ボタン${button}`;
}

/** 表示用の名前（"Pad0" → "A"、"Pad4+Pad0" → "LB+A"） */
export function formatPadCode(code: PadCode): string {
  const parsed = parsePadCode(code);
  if (!parsed) return code;
  const main = buttonLabel(parsed.button);
  return parsed.modifier === null ? main : `${buttonLabel(parsed.modifier)}${CHORD_SEPARATOR}${main}`;
}

/**
 * 既定の割り当て（以前の固定配置と同じ）。LB はスキルの層: 押している間の A / X / Y / B がスキル 1〜4。
 * 面ボタンは攻撃・固有技・奥義・ダッシュとメニューの決定・戻るを兼ねる。拾うは空いている R3
 */
export const DEFAULT_PAD_BINDS: Readonly<PadBinds> = {
  dash: [padButtonCode(PAD_B), padButtonCode(PAD_RB)],
  attack: [padButtonCode(PAD_RT), padButtonCode(PAD_A)],
  shoot: [padButtonCode(PAD_LT), padButtonCode(PAD_X)],
  special: [padButtonCode(PAD_Y)],
  inventory: [padButtonCode(PAD_BACK)],
  skill1: [padChordCode(PAD_LB, PAD_A)],
  skill2: [padChordCode(PAD_LB, PAD_X)],
  skill3: [padChordCode(PAD_LB, PAD_Y)],
  skill4: [padChordCode(PAD_LB, PAD_B)],
  interact: [padButtonCode(PAD_RSTICK)],
  toggleDropInfo: [],
};

/** 既定の表の複製（呼び出し側が書き換えても既定を汚さない） */
export function defaultPadBinds(): PadBinds {
  const out = {} as Record<PadAction, readonly PadCode[]>;
  for (const action of PAD_ACTIONS) out[action] = [...DEFAULT_PAD_BINDS[action]];
  return out;
}

/** 1 アクション分の生データを検証する。不正なら null（呼び出し側が既定へ戻す）。パッドは空も許す */
function sanitizeActionCodes(raw: unknown): PadCode[] | null {
  if (!Array.isArray(raw) || raw.length > PAD_BIND_SLOTS) return null;
  const codes: PadCode[] = [];
  for (const value of raw) {
    if (typeof value !== "string" || parsePadCode(value) === null || codes.includes(value)) return null;
    codes.push(value);
  }
  return codes;
}

/** 表の中で 2 つ以上のアクションに現れるコードを持つアクション */
function actionsWithDuplicates(binds: PadBinds): Set<PadAction> {
  const owner = new Map<PadCode, PadAction>();
  const out = new Set<PadAction>();
  for (const action of PAD_ACTIONS) {
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
 * 保存データから表を復元する。未知アクションは無視、欠け・不正な値は既定、
 * アクション間の重複は関わったアクションを既定へ戻す（既定同士は重複しないので収束する）
 */
export function sanitizePadBinds(raw: unknown): PadBinds {
  const binds = defaultPadBinds();
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return binds;
  const record = raw as Record<string, unknown>;
  for (const action of PAD_ACTIONS) {
    const codes = sanitizeActionCodes(record[action]);
    if (codes) binds[action] = codes;
  }
  for (let dup = actionsWithDuplicates(binds); dup.size > 0; dup = actionsWithDuplicates(binds)) {
    for (const action of dup) binds[action] = [...DEFAULT_PAD_BINDS[action]];
  }
  return binds;
}

/**
 * action の slot 列に code を割り当てた新しい表。割り当てられないときは null。
 * 空き列を指したら末尾に詰める。同じコードを持つ別アクションからは外す（パッドはアクションが空になってもよい。
 * キーボードが残るので操作不能にはならない）
 */
export function assignPadBinding(binds: PadBinds, action: PadAction, slot: number, code: PadCode): PadBinds | null {
  if (slot < 0 || slot >= PAD_BIND_SLOTS || parsePadCode(code) === null) return null;
  const current = binds[action];
  const previous = current[slot];
  if (previous === code) return binds;

  const existing = current.indexOf(code);
  if (existing !== -1) {
    if (previous === undefined) return binds;
    const swapped = [...current];
    swapped[existing] = previous;
    swapped[slot] = code;
    return { ...binds, [action]: swapped };
  }

  const placed = [...current];
  placed[Math.min(slot, placed.length)] = code;
  const next: PadBinds = { ...binds, [action]: placed };
  for (const other of PAD_ACTIONS) {
    if (other !== action && next[other].includes(code)) next[other] = next[other].filter((c) => c !== code);
  }
  return next;
}

/** action の slot 列を空にした新しい表（後ろの列は詰める）。空の列なら null */
export function clearPadBinding(binds: PadBinds, action: PadAction, slot: number): PadBinds | null {
  const current = binds[action];
  if (slot < 0 || slot >= current.length) return null;
  return { ...binds, [action]: current.filter((_, i) => i !== slot) };
}

/** 表の中で組み合わせの「押さえる」側に使われているボタンごとの、押す側のボタン */
export function chordTargetsByModifier(binds: PadBinds): Map<number, Set<number>> {
  const out = new Map<number, Set<number>>();
  for (const action of PAD_ACTIONS) {
    for (const code of binds[action]) {
      const parsed = parsePadCode(code);
      if (!parsed || parsed.modifier === null) continue;
      const set = out.get(parsed.modifier) ?? new Set<number>();
      set.add(parsed.button);
      out.set(parsed.modifier, set);
    }
  }
  return out;
}

/** 画面の案内が参照する現在の表。GamepadInput.setBinds が更新する（キーボードの activeKeybinds と同じ流儀） */
let activePadBinds: PadBinds = defaultPadBinds();

export function setActivePadBinds(binds: PadBinds): void {
  activePadBinds = binds;
}

const PAD_UNBOUND_LABEL = "-";
const SKILL_PAD_ACTIONS = ["skill1", "skill2", "skill3", "skill4"] as const satisfies readonly PadAction[];

/** アクションの表記（例: "RT / A"）。割り当てが無ければ "-" */
export function padActionLabel(action: PadAction, binds: PadBinds = activePadBinds): string {
  const codes = binds[action];
  return codes.length === 0 ? PAD_UNBOUND_LABEL : codes.map(formatPadCode).join(" / ");
}

/** スキル 1〜4 の先頭の割り当てを並べた表記（例: "LB+A LB+X LB+Y LB+B"） */
export function padSkillKeysLabel(binds: PadBinds = activePadBinds): string {
  return SKILL_PAD_ACTIONS.map((a) => {
    const code = binds[a][0];
    return code === undefined ? PAD_UNBOUND_LABEL : formatPadCode(code);
  }).join(" ");
}

/**
 * パッド設定の取得モード。最初に押したボタンを覚え、
 * - それを押さえたまま別のボタンを押したら組み合わせ（"LB+A"）
 * - 何も足さずに離したら単独（"A"）
 * として確定する。押した瞬間に確定しないのは、組み合わせの「押さえる」側を単独と区別するため
 */
export class PadCapture {
  private first: number | null = null;
  /** 取得開始時に押されていたボタン（決定の A など）。一度離すまで数えない */
  private ignored = new Set<number>();

  /** 取得を始める。今押されているボタンは離すまで無視する */
  start(down: readonly boolean[]): void {
    this.first = null;
    this.ignored = new Set(down.flatMap((d, i) => (d ? [i] : [])));
  }

  /** 1 フレーム分のボタン状態を渡す。確定したらコード、まだなら null */
  step(down: readonly boolean[], justPressed: readonly boolean[]): PadCode | null {
    for (const i of [...this.ignored]) if (!down[i]) this.ignored.delete(i);
    if (this.first === null) {
      const pressed = justPressed.findIndex((p, i) => p && !this.ignored.has(i) && isAssignableButton(i));
      if (pressed !== -1) this.first = pressed;
      return null;
    }
    const first = this.first;
    const second = justPressed.findIndex((p, i) => p && i !== first && isAssignableButton(i));
    if (second !== -1 && down[first]) {
      this.first = null;
      return padChordCode(first, second);
    }
    if (!down[first]) {
      this.first = null;
      return padButtonCode(first);
    }
    return null;
  }
}
