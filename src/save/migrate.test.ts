import { describe, expect, it } from "vitest";
import { MemoryStorage } from "../meta/testStorage";
import { migrateFromLocalStorage } from "./migrate";

describe("localStorage からセーブファイルへの移行", () => {
  it("ファイル側が空で localStorage に roguelike.* があれば写す", () => {
    const target = new MemoryStorage();
    const source = new MemoryStorage();
    source.setItem("roguelike.profile.v1", "p");
    source.setItem("roguelike.settings.v1", "s");
    source.setItem("other.app", "x");
    const copied = migrateFromLocalStorage(target, source);
    expect(copied.sort()).toEqual(["roguelike.profile.v1", "roguelike.settings.v1"]);
    expect(target.getItem("roguelike.profile.v1")).toBe("p");
    expect(target.getItem("other.app"), "roguelike.* 以外は写さない").toBeNull();
    expect(source.getItem("roguelike.profile.v1"), "移行元は消さない").toBe("p");
  });

  it("ファイル側に 1 つでもあれば何もしない", () => {
    const target = new MemoryStorage();
    target.setItem("roguelike.codex.v1", "c");
    const source = new MemoryStorage();
    source.setItem("roguelike.profile.v1", "p");
    expect(migrateFromLocalStorage(target, source)).toEqual([]);
    expect(target.getItem("roguelike.profile.v1")).toBeNull();
  });

  it("source が null なら何もしない", () => {
    const target = new MemoryStorage();
    expect(migrateFromLocalStorage(target, null)).toEqual([]);
    expect(target.length).toBe(0);
  });
});
