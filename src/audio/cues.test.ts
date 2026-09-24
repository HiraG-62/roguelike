import { describe, expect, it } from "vitest";
import { RisingEdge } from "./cues";

describe("立ち上がりの検出（依頼の達成音）", () => {
  it("false → true に変わった瞬間だけ知らせる", () => {
    const edge = new RisingEdge();
    const run = {};
    expect(edge.update(run, false), "最初は基準にするだけ").toBe(false);
    expect(edge.update(run, true), "達成した瞬間").toBe(true);
    expect(edge.update(run, true), "達成のままなら鳴らさない").toBe(false);
  });

  it("ランが変わったら基準を取り直し、開始時点で満たしていても鳴らさない", () => {
    const edge = new RisingEdge();
    edge.update({}, false);
    const next = {};
    expect(edge.update(next, true), "新しいランの最初").toBe(false);
    expect(edge.update(next, true)).toBe(false);
  });

  it("一度下がってから再び満たすとまた知らせる", () => {
    const edge = new RisingEdge();
    const run = {};
    edge.update(run, true);
    edge.update(run, false);
    expect(edge.update(run, true)).toBe(true);
  });
});
