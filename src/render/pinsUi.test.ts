import { describe, expect, it } from "vitest";
import type { PinDef } from "../data/weapons";
import { stickPin } from "../system/pins";
import { arena, placeEnemy } from "../system/testHelpers";
import { pinMarks } from "./pinsUi";

describe("刺さった飛び物の描く位置", () => {
  const KUNAI: PinDef = { kind: "kunai", max: 3, sec: 5, driveMul: 2 };

  it("抜けていない刺さりだけを、飛んできた側の縁から外へ突き出して描く", () => {
    const state = arena();
    const e = placeEnemy(state, "boar", 40);
    stickPin(state, e, KUNAI, 0, 1);
    const marks = pinMarks(state, e);
    expect(marks.length).toBe(1);
    const mark = marks[0];
    if (!mark) return;
    // 右へ飛んできたので、先端は中心より左（手前）、端はさらに左
    expect(mark.from.x).toBeLessThan(e.body.pos.x);
    expect(mark.to.x).toBeLessThan(mark.from.x);
    state.time += KUNAI.sec + 1;
    expect(pinMarks(state, e).length, "抜けたら描かない").toBe(0);
  });
});
