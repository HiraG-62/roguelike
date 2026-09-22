import { describe, expect, it } from "vitest";
import { handleSeedEntryKey, keyToCommand } from "./input";

describe("keyToCommand", () => {
  it("小文字 n は斜め移動、大文字 N は新規ゲーム", () => {
    expect(keyToCommand("n")).toEqual({ type: "move", dir: { dx: 1, dy: 1 } });
    expect(keyToCommand("N")).toEqual({ type: "newGameWithSeed" });
  });

  it("未割り当てキーは null", () => {
    expect(keyToCommand("z")).toBeNull();
  });
});

describe("handleSeedEntryKey", () => {
  it("文字を積み、Backspace で消し、Enter で確定する", () => {
    expect(handleSeedEntryKey("ab", "c")).toEqual({ type: "typing", buffer: "abc" });
    expect(handleSeedEntryKey("abc", "Backspace")).toEqual({ type: "typing", buffer: "ab" });
    expect(handleSeedEntryKey("ab", "Enter")).toEqual({ type: "submit", buffer: "ab" });
    expect(handleSeedEntryKey("ab", "Escape")).toEqual({ type: "cancel" });
  });

  it("修飾キーなどの長い key 名は無視する", () => {
    expect(handleSeedEntryKey("ab", "Shift")).toEqual({ type: "typing", buffer: "ab" });
  });
});
