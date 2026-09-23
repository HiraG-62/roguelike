import { describe, expect, it } from "vitest";
import {
  ACTION_NAMES,
  DEFAULT_KEYBINDS,
  KEYBIND_SLOTS,
  PlayerInput,
  REBINDABLE_ACTIONS,
  actionKeyLabel,
  assignBinding,
  clearBinding,
  codesForAction,
  defaultKeybinds,
  formatBindingCode,
  isAssignableCode,
  sanitizeKeybinds,
  skillKeyLabel,
  skillKeyLabelFor,
  type Keybinds,
} from "./input";
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

  it("押下フラグはキーボード/パッドの OR になる（skill1Pressed = パッド LB + A）", () => {
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

describe("長押し (skill1Held〜skill4Held)", () => {
  it("押している間 Held が true、離すと false", () => {
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

describe("スロット 3 / 4", () => {
  it("Digit3 / KeyX がスロット 3、Digit4 / KeyZ がスロット 4 の Pressed と Held", () => {
    const input = new PlayerInput();
    const target = new FakeEventTarget();
    input.attachKeyboard(target as unknown as Window);

    target.dispatch("keydown", keyEvent("KeyX"));
    target.dispatch("keydown", keyEvent("Digit4"));
    const frame = input.snapshot();
    expect(frame.skill3Pressed).toBe(true);
    expect(frame.skill3Held).toBe(true);
    expect(frame.skill4Pressed).toBe(true);
    expect(frame.skill4Held).toBe(true);
    expect(frame.skill1Pressed || frame.skill2Pressed, "1 / 2 は立たない").toBe(false);
  });

  it("パッドのスキル層（LB + 面ボタン）の Pressed / Held をマージする", () => {
    const input = new PlayerInput();
    input.attachGamepad(new StubGamepad(gamepadFrame({ skill4Pressed: true, skill4Held: true, skill2Held: true })) as never);
    const frame = input.snapshot();
    expect(frame.skill4Pressed).toBe(true);
    expect(frame.skill4Held).toBe(true);
    expect(frame.skill2Held, "パッドの長押しで溜められる").toBe(true);
  });
});

function allCodes(binds: Keybinds): string[] {
  return ACTION_NAMES.flatMap((action) => [...binds[action]]);
}

describe("既定のキー設定", () => {
  it("どのコードも 1 つのアクションにしか割り当てられていない", () => {
    const codes = allCodes(DEFAULT_KEYBINDS);
    expect(new Set(codes).size, "重複がない").toBe(codes.length);
  });

  it("変更可能なアクションは 1〜KEYBIND_SLOTS 個のコードを持つ", () => {
    for (const action of REBINDABLE_ACTIONS) {
      const n = DEFAULT_KEYBINDS[action].length;
      expect(n, action).toBeGreaterThanOrEqual(1);
      expect(n, action).toBeLessThanOrEqual(KEYBIND_SLOTS);
    }
  });

  it("キーボードとマウスを同じ表で持つ（攻撃は E と左クリック、サイドボタンはスキル 1 / 2）", () => {
    expect(DEFAULT_KEYBINDS.attack).toEqual(["KeyE", "Mouse0"]);
    expect(DEFAULT_KEYBINDS.skill1).toContain("Mouse3");
    expect(DEFAULT_KEYBINDS.skill2).toContain("Mouse4");
  });

  it("拾う（interact）は既定で G、キー設定画面で変更できる", () => {
    expect(DEFAULT_KEYBINDS.interact).toEqual(["KeyG"]);
    expect((REBINDABLE_ACTIONS as readonly string[]).includes("interact"), "変更可能").toBe(true);
    const next = assignBinding(defaultKeybinds(), "interact", 0, "KeyH");
    expect(next?.interact, "H に変えられる").toEqual(["KeyH"]);
    expect(actionKeyLabel("interact"), "キー案内は G").toBe("G");
  });

  it("既定の変更可能なコードはすべて割り当て可能", () => {
    for (const action of REBINDABLE_ACTIONS) {
      for (const code of DEFAULT_KEYBINDS[action]) expect(isAssignableCode(code), code).toBe(true);
    }
  });
});

describe("sanitizeKeybinds", () => {
  it("オブジェクトでなければ既定", () => {
    expect(sanitizeKeybinds(null)).toEqual(defaultKeybinds());
    expect(sanitizeKeybinds("x")).toEqual(defaultKeybinds());
    expect(sanitizeKeybinds([1, 2])).toEqual(defaultKeybinds());
  });

  it("欠けたアクションは既定、未知アクションは無視する", () => {
    const binds = sanitizeKeybinds({ attack: ["KeyJ"], bogus: ["KeyK"] });
    expect(binds.attack).toEqual(["KeyJ"]);
    expect(binds.dash).toEqual(DEFAULT_KEYBINDS.dash);
    expect(Object.keys(binds).sort()).toEqual([...ACTION_NAMES].sort());
  });

  it("不正な値（非配列・空・上限超え・文字列以外・予約キー）はそのアクションだけ既定", () => {
    const binds = sanitizeKeybinds({
      up: "KeyW",
      down: [],
      left: ["KeyJ", "KeyK", "KeyL", "KeyU"],
      right: [3],
      dash: ["Escape"],
      shoot: ["Enter"],
      special: ["KeyH"],
    });
    expect(binds.up).toEqual(DEFAULT_KEYBINDS.up);
    expect(binds.down).toEqual(DEFAULT_KEYBINDS.down);
    expect(binds.left).toEqual(DEFAULT_KEYBINDS.left);
    expect(binds.right).toEqual(DEFAULT_KEYBINDS.right);
    expect(binds.dash).toEqual(DEFAULT_KEYBINDS.dash);
    expect(binds.shoot, "confirm の Enter は奪えない").toEqual(DEFAULT_KEYBINDS.shoot);
    expect(binds.special, "正しい値は残る").toEqual(["KeyH"]);
  });

  it("confirm は保存データで変えられないが restart は変えられる", () => {
    const binds = sanitizeKeybinds({ confirm: ["KeyJ"], restart: ["KeyK"] });
    expect(binds.confirm).toEqual(DEFAULT_KEYBINDS.confirm);
    expect(binds.restart).toEqual(["KeyK"]);
  });

  it("R は他のアクションに割り当てられる（restart から外れる）", () => {
    const next = assignBinding(defaultKeybinds(), "attack", 0, "KeyR");
    expect(next?.attack[0]).toBe("KeyR");
    expect(next?.restart, "restart には attack の元のキーが渡る").toEqual(["KeyE"]);
  });

  it("アクション間の重複は関わったアクションを既定へ戻し、結果に重複が残らない", () => {
    // special に W を入れると up の既定と衝突する
    const binds = sanitizeKeybinds({ special: ["KeyW"], attack: ["KeyJ"] });
    expect(binds.special).toEqual(DEFAULT_KEYBINDS.special);
    expect(binds.attack, "無関係な変更は残る").toEqual(["KeyJ"]);
    const codes = allCodes(binds);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("同じアクション内の重複は既定へ戻す", () => {
    expect(sanitizeKeybinds({ attack: ["KeyJ", "KeyJ"] }).attack).toEqual(DEFAULT_KEYBINDS.attack);
  });
});

describe("assignBinding", () => {
  it("空いているコードを主の列に入れると置き換わる", () => {
    const next = assignBinding(defaultKeybinds(), "attack", 0, "KeyJ");
    expect(next?.attack).toEqual(["KeyJ", "Mouse0"]);
  });

  it("空き列を指すと末尾に詰めて入る", () => {
    const next = assignBinding(defaultKeybinds(), "special", 2, "KeyH");
    expect(next?.special).toEqual(["KeyF", "KeyH"]);
  });

  it("他のアクションが持つコードを割り当てると、そちらから外れる", () => {
    const next = assignBinding(defaultKeybinds(), "special", 1, "KeyC");
    expect(next?.special).toEqual(["KeyF", "KeyC"]);
    expect(next?.skill1, "スキル 1 から C が外れる").toEqual(["Digit1", "Mouse3"]);
    if (!next) return;
    const codes = allCodes(next);
    expect(new Set(codes).size, "重複しない").toBe(codes.length);
  });

  it("移動 4 方向も重複禁止の対象", () => {
    const next = assignBinding(defaultKeybinds(), "up", 0, "KeyS");
    expect(next?.up).toEqual(["KeyS", "ArrowUp"]);
    expect(next?.down).toEqual(["ArrowDown"]);
  });

  it("相手が空になる場合は、上書きされた元のコードと入れ替える", () => {
    const base = sanitizeKeybinds({ special: ["KeyF"] });
    const next = assignBinding(base, "attack", 0, "KeyF");
    expect(next?.attack).toEqual(["KeyF", "Mouse0"]);
    expect(next?.special, "E を受け取る").toEqual(["KeyE"]);
  });

  it("相手が空になり、渡すコードも無いなら拒否する", () => {
    expect(assignBinding(defaultKeybinds(), "attack", 2, "KeyF")).toBeNull();
  });

  it("同じアクションの別の列にあるコードは列の入れ替えになる", () => {
    const next = assignBinding(defaultKeybinds(), "attack", 0, "Mouse0");
    expect(next?.attack).toEqual(["Mouse0", "KeyE"]);
  });

  it("左クリックは攻撃以外にも割り当てられる", () => {
    const next = assignBinding(defaultKeybinds(), "dash", 0, "Mouse0");
    expect(next?.dash).toEqual(["Mouse0", "ShiftLeft", "ShiftRight"]);
    expect(next?.attack).toEqual(["KeyE"]);
  });

  it("予約キーと固定アクションのキーは割り当てられない", () => {
    for (const code of ["Escape", "Enter", "Backspace", "Delete"]) {
      expect(assignBinding(defaultKeybinds(), "attack", 0, code), code).toBeNull();
    }
  });

  it("元の表は書き換えない", () => {
    const base = defaultKeybinds();
    assignBinding(base, "special", 1, "KeyC");
    expect(base).toEqual(defaultKeybinds());
  });
});

describe("clearBinding", () => {
  it("列を空にすると後ろの列が詰まる", () => {
    const next = clearBinding(defaultKeybinds(), "attack", 0);
    expect(next?.attack).toEqual(["Mouse0"]);
  });

  it("最後の 1 つは消せない", () => {
    expect(clearBinding(defaultKeybinds(), "special", 0)).toBeNull();
  });

  it("空の列は消せない", () => {
    expect(clearBinding(defaultKeybinds(), "attack", 2)).toBeNull();
  });
});

describe("formatBindingCode", () => {
  it("キーとマウスを短い表示名にする", () => {
    const cases: Array<[string, string]> = [
      ["KeyE", "E"],
      ["Digit1", "1"],
      ["Space", "Space"],
      ["ShiftLeft", "L-Shift"],
      ["Mouse0", "左クリック"],
      ["Mouse2", "右クリック"],
      ["Mouse3", "サイド1"],
      ["Mouse4", "サイド2"],
      ["Tab", "Tab"],
      ["F5", "F5"],
    ];
    for (const [code, label] of cases) expect(formatBindingCode(code), code).toBe(label);
  });
});

describe("PlayerInput の束縛差し替え", () => {
  it("G を押すと interactPressed が立ち、パッドの interactPressed とも OR になる", () => {
    const input = new PlayerInput();
    const target = new FakeEventTarget();
    input.attachKeyboard(target as unknown as Window);
    target.dispatch("keydown", keyEvent("KeyG"));
    expect(input.snapshot().interactPressed, "G で拾う").toBe(true);
    expect(input.snapshot().interactPressed, "押した瞬間だけ").toBe(false);
    const padInput = new PlayerInput();
    padInput.attachGamepad(new StubGamepad(gamepadFrame({ interactPressed: true })) as never);
    expect(padInput.snapshot().interactPressed, "パッド").toBe(true);
  });

  it("setKeybinds の後は新しいキーでアクションが立ち、外したキーでは立たない", () => {
    const input = new PlayerInput();
    const target = new FakeEventTarget();
    input.attachKeyboard(target as unknown as Window);
    const next = assignBinding(defaultKeybinds(), "attack", 0, "KeyJ");
    if (!next) throw new Error("割り当てできない");
    input.setKeybinds(next);

    target.dispatch("keydown", keyEvent("KeyJ"));
    expect(input.snapshot().attackPressed, "J で攻撃").toBe(true);
    target.dispatch("keydown", keyEvent("KeyE"));
    expect(input.snapshot().attackPressed, "E は外れた").toBe(false);
    input.setKeybinds(defaultKeybinds());
  });

  it("setKeybinds で HUD のスキル表記も追従する", () => {
    const input = new PlayerInput();
    const next = assignBinding(defaultKeybinds(), "skill1", 0, "KeyH");
    if (!next) throw new Error("割り当てできない");
    input.setKeybinds(next);
    expect(skillKeyLabel(0)).toBe("H / C");
    expect(codesForAction("skill1")).toEqual(["KeyH", "KeyC", "Mouse3"]);
    input.setKeybinds(defaultKeybinds());
    expect(skillKeyLabel(0)).toBe("1 / C");
  });

  it("スキル表記はキーボードがあればマウスを載せず、マウスだけなら短い表記を出す", () => {
    const mouseOnly = sanitizeKeybinds({ skill1: ["Mouse3"] });
    expect(skillKeyLabelFor(0, mouseOnly)).toBe("サイド1");
    expect(skillKeyLabelFor(0, defaultKeybinds())).toBe("1 / C");
  });

  it("未束縛のキーは preventDefault しないが、取得モード中はする", () => {
    const input = new PlayerInput();
    const target = new FakeEventTarget();
    input.attachKeyboard(target as unknown as Window);
    let prevented = 0;
    const ev = { code: "F5", repeat: false, preventDefault: () => (prevented += 1) };
    target.dispatch("keydown", ev);
    expect(prevented, "通常時は止めない").toBe(0);
    input.setCapturing(true);
    target.dispatch("keydown", ev);
    expect(prevented, "取得モード中は止める").toBe(1);
  });

  it("takeAnyPressedCode は直前の snapshot で押されたコードを押した順に 1 つずつ返す", () => {
    const input = new PlayerInput();
    const target = new FakeEventTarget();
    input.attachKeyboard(target as unknown as Window);
    target.dispatch("keydown", keyEvent("KeyK"));
    target.dispatch("keydown", keyEvent("KeyL"));
    expect(input.takeAnyPressedCode(), "snapshot 前は空").toBeNull();
    input.snapshot();
    expect(input.takeAnyPressedCode()).toBe("KeyK");
    expect(input.takeAnyPressedCode()).toBe("KeyL");
    expect(input.takeAnyPressedCode()).toBeNull();
    input.snapshot();
    expect(input.takeAnyPressedCode(), "次のフレームには持ち越さない").toBeNull();
  });
});
