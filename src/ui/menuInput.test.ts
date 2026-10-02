import { describe, expect, it } from "vitest";
import { withInput } from "../system/testHelpers";
import { MENU_HOLD_SECONDS, NAV_REPEAT_DELAY, NAV_REPEAT_EVERY, menuGuideText, readMenuNav, stepHold } from "./menuInput";

const DT = 0.05;

describe("装備画面の入力", () => {
  it("押した瞬間だけ 1 マス動き、押し続けると 0.35 秒後から繰り返す", () => {
    const nav = { x: 0, y: 0, held: 0 };
    const down = withInput({ move: { x: 0, y: 1 } });
    expect(readMenuNav(nav, down, DT), "押した瞬間").toEqual({ dx: 0, dy: 1 });
    let moves = 0;
    let firstRepeatAt = -1;
    for (let i = 1; i <= 20; i++) {
      const r = readMenuNav(nav, down, DT);
      if (r.dy === 0) continue;
      moves += 1;
      if (firstRepeatAt < 0) firstRepeatAt = i * DT;
    }
    expect(firstRepeatAt, "繰り返しの始まり").toBeCloseTo(NAV_REPEAT_DELAY, 5);
    const expected = Math.floor((20 * DT - NAV_REPEAT_DELAY) / NAV_REPEAT_EVERY + 1e-9) + 1;
    expect(moves, "0.1 秒ごとに繰り返す").toBe(expected);
    expect(readMenuNav(nav, withInput({}), DT), "離すと止まる").toEqual({ dx: 0, dy: 0 });
    expect(readMenuNav(nav, withInput({ move: { x: 1, y: 0 } }), DT), "向きを変えると押した瞬間").toEqual({ dx: 1, dy: 0 });
  });

  it("長押しは 0.6 秒で発火し、先に離すと決定になる", () => {
    const hold = { t: 0 };
    const frames = Math.round(MENU_HOLD_SECONDS / DT);
    for (let i = 1; i < frames; i++) expect(stepHold(hold, true, DT), `${i} コマ目は待つ`).toBe("wait");
    expect(stepHold(hold, true, DT), "0.6 秒で発火").toBe("fire");
    const early = { t: 0 };
    expect(stepHold(early, true, DT), "押し始め").toBe("wait");
    expect(stepHold(early, false, DT), "先に離すと決定").toBe("release");
  });

  it("操作案内は動詞を順に並べ、面替えは行き先の面を書く", () => {
    const attire = menuGuideText(["move", "face", "close"], "attire");
    const crest = menuGuideText(["face"], "crest");
    expect(attire.startsWith("↑↓←→"), "方向は絵記号").toBe(true);
    expect(attire.includes("紋へ"), "装束からは紋へ").toBe(true);
    expect(crest.includes("装束へ"), "紋からは装束へ").toBe(true);
  });
});
