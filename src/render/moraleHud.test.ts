import { describe, expect, it } from "vitest";
import { VIEW_W } from "../core/view";
import { MOMENT } from "../data/tuning";
import { arena } from "../system/testHelpers";
import { moraleGauge } from "../system/morale";
import {
  MORALE_BAR_H,
  MORALE_BAR_W,
  MORALE_BLINK_TICKS,
  moraleBlinkOn,
  moraleFillColor,
  moraleHudLayout,
  moraleMarks,
  moraleRatio,
} from "./moraleHud";

/** renderer.ts の HUD: HP の数値の左端と、気力バーの行（気力バーの隣に置く位置） */
const ANCHOR_X = 138;
const ANCHOR_Y = 17;
/** 画面中央上のヒット数の表示（renderer.ts の COMBO_TEXT_Y）の、中央から左へ広がる幅の見積り */
const HIT_TEXT_HALF_W = 30;

describe("戦意ゲージの割合", () => {
  it("値 / 上限を 0..1 に収め、上限 0 は空", () => {
    expect(moraleRatio(3, 6), "半分").toBe(0.5);
    expect(moraleRatio(9, 6), "上限を超えても 1").toBe(1);
    expect(moraleRatio(-1, 6), "負でも 0").toBe(0);
    expect(moraleRatio(2, 0), "上限 0").toBe(0);
  });

  it("目盛りは内側の単位の区切りと放出の最低の位置", () => {
    const marks = moraleMarks(4, 2);
    expect(marks.units, "1/4・2/4・3/4").toEqual([0.25, 0.5, 0.75]);
    expect(marks.release, "放出の最低 2 / 4").toBe(0.5);
  });

  it("単位が多い型は区切りを省き、放出の最低が上限と同じ・0 なら放出の目盛りも出さない", () => {
    expect(moraleMarks(100, 10).units, "多すぎる区切りは省く").toEqual([]);
    expect(moraleMarks(100, 10).release, "放出の最低は出す").toBe(0.1);
    expect(moraleMarks(3, 3).release, "上限と同じ").toBeNull();
    expect(moraleMarks(3, 0).release, "0").toBeNull();
    expect(moraleMarks(0, 0), "上限 0").toEqual({ units: [], release: null });
  });
});

describe("放出できる間の点滅", () => {
  it("tick だけで決まり、周期の前半が点灯・後半が消灯", () => {
    expect(moraleBlinkOn(0), "周期の頭").toBe(true);
    expect(moraleBlinkOn(MORALE_BLINK_TICKS / 2 - 1), "前半の終わり").toBe(true);
    expect(moraleBlinkOn(MORALE_BLINK_TICKS / 2), "後半の頭").toBe(false);
    expect(moraleBlinkOn(MORALE_BLINK_TICKS), "次の周期").toBe(true);
  });

  it("放出できなければ点滅せず同じ色、できる間は放出・充溢の浮き文字の色を交互に使う", () => {
    expect(moraleFillColor(false, true), "点灯でも通常色").toBe(moraleFillColor(false, false));
    expect(moraleFillColor(true, true), "点灯は放出の色").toBe(MOMENT.release.color);
    expect(moraleFillColor(true, false), "消灯は充溢の色").toBe(MOMENT.brim.color);
  });
});

describe("戦意ゲージの配置", () => {
  it("バーは指定の位置に固定の大きさで、ラベルはバーの右に出る", () => {
    const l = moraleHudLayout(ANCHOR_X, ANCHOR_Y, 10);
    expect(l.bar, "バー").toEqual({ x: ANCHOR_X, y: ANCHOR_Y, w: MORALE_BAR_W, h: MORALE_BAR_H });
    expect(l.labelX, "ラベルはバーの右").toBeGreaterThan(l.bar.x + l.bar.w);
    expect(l.labelBaseline, "ラベルの基準線はバーの下端より下").toBeGreaterThan(l.bar.y + l.bar.h);
  });

  it("行高が大きくなるとラベルの基準線が下がり、小さくても定数の行高を割らない", () => {
    const small = moraleHudLayout(ANCHOR_X, ANCHOR_Y, 4);
    const base = moraleHudLayout(ANCHOR_X, ANCHOR_Y, 10);
    const big = moraleHudLayout(ANCHOR_X, ANCHOR_Y, 16);
    expect(small.labelBaseline, "小さい行高は定数に丸める").toBe(base.labelBaseline);
    expect(big.labelBaseline, "大きい行高は下がる").toBeGreaterThan(base.labelBaseline);
  });

  it.each([8, 10, 12, 16])("行高 %i で、ラベルが画面中央のヒット数の表示（中央から左 30）に掛からない", (lineH) => {
    const l = moraleHudLayout(ANCHOR_X, ANCHOR_Y, lineH);
    expect(l.labelX + l.labelMaxW, "ヒット数の表示の左").toBeLessThanOrEqual(VIEW_W / 2 - HIT_TEXT_HALF_W);
  });
});

describe("戦意ゲージの材料（HUD が読む型の状態）", () => {
  it("戦意が溜まる型は描く対象で、上限は正", () => {
    const g = moraleGauge(arena(5, { moveset: "sword" }));
    expect(g.active, "剣は戦意が溜まる").toBe(true);
    expect(g.max, "上限").toBeGreaterThan(0);
  });

  it("溜まっていない間は放出できず、放出の最低まで溜まると ready になる", () => {
    const state = arena(5, { moveset: "sword" });
    expect(moraleGauge(state).ready, "空").toBe(false);
    state.player.morale.value = moraleGauge(state).max;
    expect(moraleGauge(state).ready, "満ちた").toBe(true);
  });
});
