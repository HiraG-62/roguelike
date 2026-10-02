import { describe, expect, it } from "vitest";
import { RENDER_SCALE } from "../core/view";
import type { FloatTextKind } from "../core/state";
import { FLOAT_TEXT } from "../data/tuning";
import { floatTextAlpha, floatTextPx, floatTextShake } from "./floatText";
import { PIXEL_FONT_DESIGN_PX } from "./pixelText";

/** 描画と同じ切り上げ（pixelText の sizeFor）でのドット倍率 */
function dotScale(px: number): number {
  return Math.max(1, Math.ceil((px * RENDER_SCALE) / PIXEL_FONT_DESIGN_PX - 1e-6));
}

const ALL_KINDS: readonly FloatTextKind[] = ["normal", "crit", "weak", "resist", "dot", "reaction", "status", "label", "notice"];
const NORMAL_PX = FLOAT_TEXT.px.normal;

describe("浮き文字の大きさ（種類で決まる）", () => {
  it("会心の弾み以外のどの種類も、通常のダメージ数字より大きいドット倍率にならない", () => {
    for (const kind of ALL_KINDS) {
      expect(dotScale(floatTextPx(kind, false, 10)), `${kind} のドット倍率`).toBeLessThanOrEqual(dotScale(NORMAL_PX));
    }
  });

  it("技名・自分の状態（label）と継続ダメージ（dot）は通常のダメージ数字より小さい", () => {
    expect(floatTextPx("label", false, 0)).toBeLessThan(NORMAL_PX);
    expect(floatTextPx("dot", false, 0)).toBeLessThan(NORMAL_PX);
    expect(floatTextPx("status", false, 0), "敵の状態は読めるよう通常と同じ").toBe(NORMAL_PX);
  });

  it("種類を省いたら label の大きさになる", () => {
    expect(floatTextPx(undefined, false, 0)).toBe(floatTextPx("label", false, 0));
  });

  it("会心の数字は出た瞬間に大きく弾み、弾みの秒が過ぎたら通常の大きさへ戻る", () => {
    const pop = FLOAT_TEXT.critPop;
    const start = floatTextPx("crit", true, 0);
    expect(start, "出た瞬間は通常より大きい").toBeGreaterThan(NORMAL_PX);
    expect(dotScale(start), "ドット倍率でも 1 段大きい").toBeGreaterThan(dotScale(NORMAL_PX));
    expect(floatTextPx("crit", true, pop.time / 2), "途中は戻りかけ").toBeLessThan(start);
    expect(floatTextPx("crit", true, pop.time / 2)).toBeGreaterThan(NORMAL_PX);
    expect(floatTextPx("crit", true, pop.time), "弾みの秒で戻る").toBe(NORMAL_PX);
    expect(floatTextPx("crit", true, 5), "その後は通常").toBe(NORMAL_PX);
  });

  it("会心の弾みでもドット倍率の上限（maxMul）以内に収まる", () => {
    expect(Math.min(FLOAT_TEXT.maxMul, dotScale(floatTextPx("crit", true, 0)))).toBeLessThanOrEqual(FLOAT_TEXT.maxMul);
  });

  it("会心でない文字は経過時間で大きさが変わらない", () => {
    expect(floatTextPx("normal", false, 0)).toBe(floatTextPx("normal", false, 1));
  });
});

describe("浮き文字の揺れと濃さ", () => {
  it("会心の揺れは幅の範囲に収まり、消えかけ（fade 0）では揺れない", () => {
    for (let i = 0; i < 20; i++) {
      expect(Math.abs(floatTextShake(i * 0.1, i, 1))).toBeLessThanOrEqual(Math.ceil(FLOAT_TEXT.critPop.shake));
      expect(floatTextShake(i * 0.1, i, 0)).toBe(0);
    }
  });

  it("label だけ控えめに薄く、数字と敵の状態は濃いまま", () => {
    expect(floatTextAlpha("label")).toBeLessThan(1);
    expect(floatTextAlpha(undefined)).toBe(floatTextAlpha("label"));
    for (const kind of ["normal", "crit", "status", "notice"] as const) expect(floatTextAlpha(kind), kind).toBe(1);
  });
});
