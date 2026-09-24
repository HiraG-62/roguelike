import { afterEach, describe, expect, it } from "vitest";
import { MemoryStorage } from "../meta/testStorage";
import { guardSaveWrites, saveStorage, setSaveStorage } from "./backend";

afterEach(() => {
  setSaveStorage(null);
});

describe("保存先の差し込み", () => {
  it("setSaveStorage で差し込んだ保存先を saveStorage が返す", () => {
    const memory = new MemoryStorage();
    setSaveStorage(memory);
    const target = saveStorage();
    expect(target, "差し込み後は null にならない").not.toBeNull();
    target?.setItem("roguelike.profile.v1", "{}");
    expect(memory.getItem("roguelike.profile.v1"), "書き込みが差し込んだ保存先へ届く").toBe("{}");
    memory.setItem("roguelike.skills.v1", "[1]");
    expect(target?.getItem("roguelike.skills.v1"), "読み込みも差し込んだ保存先から").toBe("[1]");
  });
});

describe("guardSaveWrites", () => {
  it("guardSaveWrites の間は指定キーへの setItem が捨てられ、解除後は書ける", () => {
    const memory = new MemoryStorage();
    setSaveStorage(memory);
    const release = guardSaveWrites(["roguelike.profile.v1"]);
    saveStorage()?.setItem("roguelike.profile.v1", "blocked");
    expect(memory.getItem("roguelike.profile.v1"), "ガード中は書かれない").toBeNull();
    release();
    saveStorage()?.setItem("roguelike.profile.v1", "ok");
    expect(memory.getItem("roguelike.profile.v1"), "解除後は書ける").toBe("ok");
  });

  it("ガードは指定していないキーには効かない", () => {
    const memory = new MemoryStorage();
    setSaveStorage(memory);
    const release = guardSaveWrites(["roguelike.profile.v1"]);
    saveStorage()?.setItem("roguelike.settings.v1", "free");
    release();
    expect(memory.getItem("roguelike.settings.v1"), "指定外のキーは書ける").toBe("free");
  });

  it("重なったガードは両方解除するまで効き、同じ解除を 2 回呼んでも 1 回分だけ戻る", () => {
    const memory = new MemoryStorage();
    setSaveStorage(memory);
    const first = guardSaveWrites(["roguelike.profile.v1"]);
    const second = guardSaveWrites(["roguelike.profile.v1"]);
    first();
    first();
    saveStorage()?.setItem("roguelike.profile.v1", "still");
    expect(memory.getItem("roguelike.profile.v1"), "片方が残っていれば捨てる").toBeNull();
    second();
    saveStorage()?.setItem("roguelike.profile.v1", "ok");
    expect(memory.getItem("roguelike.profile.v1"), "両方解除で書ける").toBe("ok");
  });
});
