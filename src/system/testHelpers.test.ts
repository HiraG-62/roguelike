import { describe, expect, it } from "vitest";
import { PLAYER } from "../data/tuning";
import { withTuning } from "./testHelpers";

describe("withTuning（テスト中だけバランスの数値を上書きする）", () => {
  it("fn の間だけ入れ子の値が上書きされ、終わると元に戻る", () => {
    const table = { a: 1, nested: { b: 2, c: 3 }, list: [10, 20] };
    const seen = withTuning(table, { nested: { b: 5 }, list: { 1: 99 } }, () => [table.nested.b, table.nested.c, table.list[1]]);
    expect(seen, "上書きした葉だけ変わる").toEqual([5, 3, 99]);
    expect(table, "元に戻る").toEqual({ a: 1, nested: { b: 2, c: 3 }, list: [10, 20] });
  });

  it("fn が投げても元に戻る", () => {
    const table = { a: 1 };
    expect(() =>
      withTuning(table, { a: 2 }, () => {
        throw new Error("失敗");
      }),
    ).toThrow("失敗");
    expect(table.a, "例外の後も元の値").toBe(1);
  });

  it("入れ子のオブジェクトは差し替えず中身を書くので、先に握った参照からも上書きが見える", () => {
    const held = PLAYER.shoot.scaling;
    const original = held.base;
    withTuning(PLAYER, { shoot: { scaling: { base: 123 } } }, () => {
      expect(held.base).toBe(123);
    });
    expect(held.base).toBe(original);
  });
});
