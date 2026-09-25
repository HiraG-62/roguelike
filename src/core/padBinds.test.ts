import { describe, expect, it } from "vitest";
import {
  DEFAULT_PAD_BINDS,
  PAD_A,
  PAD_B,
  PAD_LB,
  PAD_RB,
  PAD_START,
  PAD_BUTTON_COUNT,
  PAD_DPAD_UP,
  PadCapture,
  assignPadBinding,
  clearPadBinding,
  defaultPadBinds,
  formatPadCode,
  padButtonCode,
  padChordCode,
  parsePadCode,
  sanitizePadBinds,
} from "./padBinds";

function buttons(pressed: readonly number[]): boolean[] {
  return Array.from({ length: PAD_BUTTON_COUNT }, (_, i) => pressed.includes(i));
}
const NONE = buttons([]);

describe("パッドのコード", () => {
  it("単独と組み合わせを読み、表示名にする", () => {
    expect(parsePadCode("Pad0")).toEqual({ modifier: null, button: PAD_A });
    expect(parsePadCode("Pad4+Pad1")).toEqual({ modifier: PAD_LB, button: PAD_B });
    expect(formatPadCode(padButtonCode(PAD_A))).toBe("A");
    expect(formatPadCode(padChordCode(PAD_LB, PAD_A))).toBe("LB+A");
  });

  it("Start・十字キー・範囲外・同じボタン同士の組み合わせは割り当てられない", () => {
    expect(parsePadCode(padButtonCode(PAD_START))).toBeNull();
    expect(parsePadCode(padButtonCode(PAD_DPAD_UP))).toBeNull();
    expect(parsePadCode("Pad16")).toBeNull();
    expect(parsePadCode("Pad0+Pad0")).toBeNull();
    expect(parsePadCode("KeyA")).toBeNull();
  });

  it("既定の表はすべて割り当て可能なコードで、アクション間で重複しない", () => {
    const all = Object.values(DEFAULT_PAD_BINDS).flat();
    for (const code of all) expect(parsePadCode(code), code).not.toBeNull();
    expect(new Set(all).size).toBe(all.length);
  });
});

describe("sanitizePadBinds", () => {
  it("壊れた値・未知アクションは既定、空の割り当ては残す", () => {
    const binds = sanitizePadBinds({ dash: ["Pad99"], attack: [], unknown: ["Pad0"] });
    expect(binds.dash).toEqual(DEFAULT_PAD_BINDS.dash);
    expect(binds.attack).toEqual([]);
  });

  it("アクション間の重複は関わったアクションを既定へ戻す", () => {
    const binds = sanitizePadBinds({ ...defaultPadBinds(), dash: ["Pad0"] });
    expect(binds.dash).toEqual(DEFAULT_PAD_BINDS.dash);
    expect(binds.attack).toEqual(DEFAULT_PAD_BINDS.attack);
  });
});

describe("assignPadBinding / clearPadBinding", () => {
  it("別アクションが持っていたコードはそちらから外す（空になってもよい）", () => {
    const next = assignPadBinding(defaultPadBinds(), "interact", 0, padButtonCode(PAD_A));
    expect(next?.interact).toEqual(["Pad0"]);
    expect(next?.attack).toEqual(["Pad7"]);
    const special = assignPadBinding(defaultPadBinds(), "dash", 0, "Pad3");
    expect(special?.special, "奥義は空になる").toEqual([]);
  });

  it("空き列を指したら末尾に詰める", () => {
    const next = assignPadBinding(defaultPadBinds(), "special", 2, padChordCode(PAD_RB, PAD_A));
    expect(next?.special).toEqual(["Pad3", "Pad5+Pad0"]);
  });

  it("割り当てられないコードは null", () => {
    expect(assignPadBinding(defaultPadBinds(), "dash", 0, padButtonCode(PAD_START))).toBeNull();
  });

  it("最後の 1 つも消せる。空の列は null", () => {
    const next = clearPadBinding(defaultPadBinds(), "special", 0);
    expect(next?.special).toEqual([]);
    expect(next && clearPadBinding(next, "special", 0)).toBeNull();
  });
});

describe("PadCapture（取得モード）", () => {
  it("押して離したら単独のボタン", () => {
    const cap = new PadCapture();
    cap.start(NONE);
    expect(cap.step(buttons([PAD_B]), buttons([PAD_B]))).toBeNull();
    expect(cap.step(NONE, NONE)).toBe("Pad1");
  });

  it("押さえたまま別のボタンを押したら組み合わせ", () => {
    const cap = new PadCapture();
    cap.start(NONE);
    cap.step(buttons([PAD_LB]), buttons([PAD_LB]));
    expect(cap.step(buttons([PAD_LB, PAD_A]), buttons([PAD_A]))).toBe("Pad4+Pad0");
  });

  it("取得を始めたときに押していたボタン（決定の A）は離すまで数えない", () => {
    const cap = new PadCapture();
    cap.start(buttons([PAD_A]));
    expect(cap.step(buttons([PAD_A]), NONE)).toBeNull();
    expect(cap.step(NONE, NONE), "離しても確定しない").toBeNull();
    cap.step(buttons([PAD_A]), buttons([PAD_A]));
    expect(cap.step(NONE, NONE)).toBe("Pad0");
  });

  it("Start と十字キーは取らない", () => {
    const cap = new PadCapture();
    cap.start(NONE);
    cap.step(buttons([PAD_START, PAD_DPAD_UP]), buttons([PAD_START, PAD_DPAD_UP]));
    expect(cap.step(NONE, NONE)).toBeNull();
  });
});
