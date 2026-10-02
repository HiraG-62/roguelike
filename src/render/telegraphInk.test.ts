import { describe, expect, it } from "vitest";
import { ENEMIES } from "../data/enemies";
import { ENEMY_TEMPO, SIGN_CHECK, TELEGRAPH, TELEGRAPH_POSE } from "../data/tuning";
import { applyStagger, attackCommitted } from "../system/poise";
import { arena, placeEnemy } from "../system/testHelpers";
import { circleCut, cutSpans, segLength, sketchGap, sketchSpans, telegraphStage } from "./telegraphInk";
import { TelegraphLayer, type TelegraphHelpers, veered } from "./telegraphLayer";
import { telegraphPose, yellowProgress } from "./telegraphPose";

function windupEnemy(key: string, timerRatio: number) {
  const state = arena();
  const e = placeEnemy(state, key, 100);
  e.phase = "windup";
  e.windupTotal = 1;
  e.phaseTimer = timerRatio;
  e.strikeDir = { x: 1, y: 0 };
  return { state, e };
}

/** 色の代入を集める偽の ctx（メソッドは何もしない） */
function recordingCtx(): { ctx: CanvasRenderingContext2D; colors: Set<string> } {
  const colors = new Set<string>();
  const store: Record<string, unknown> = {};
  const ctx = new Proxy(store, {
    get: (target, key: string) => (key in target ? target[key] : () => undefined),
    set: (target, key: string, value) => {
      if ((key === "strokeStyle" || key === "fillStyle") && typeof value === "string") colors.add(value.toLowerCase());
      target[key] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, colors };
}

const HELPERS: TelegraphHelpers = { headTop: (e) => e.body.pos.y - 10, glow: () => undefined };

describe("下絵と墨入れの段", () => {
  it("段は attackCommitted と一致する（予備動作の 0.6 の境・攻撃中）", () => {
    const ratio = ENEMY_TEMPO.commitRatio;
    for (const t of [1, ratio + 0.01, ratio, ratio - 0.01, 0.1]) {
      const { e } = windupEnemy("slime", t);
      expect(telegraphStage(e), `残り ${t}`).toBe(attackCommitted(e) ? "ink" : "sketch");
    }
    const { e } = windupEnemy("slime", 0.5);
    e.phase = "strike";
    expect(telegraphStage(e), "攻撃中").toBe("ink");
  });

  it("連撃の続きは最初から墨入れ", () => {
    const { e } = windupEnemy("slime", 1);
    e.chainWindup = true;
    expect(telegraphStage(e)).toBe("ink");
  });
});

describe("下絵の欠け", () => {
  const covered = (spans: readonly { from: number; to: number }[]): number => spans.reduce((a, s) => a + (s.to - s.from), 0);

  it("同じ id・長さ・欠けなら同じ並び（決定的）", () => {
    expect(sketchSpans(7, 120, 0.4)).toEqual(sketchSpans(7, 120, 0.4));
  });

  it("欠けの割合を上げると描くセルは減るだけで増えない（削れが戻って見えない）", () => {
    for (let id = 1; id <= 60; id++) {
      let prev = Number.POSITIVE_INFINITY;
      for (const gap of [0, 0.25, 0.4, 0.55, 0.7]) {
        const c = covered(sketchSpans(id, 90, gap));
        expect(c, `id ${id} gap ${gap}`).toBeLessThanOrEqual(prev + 1e-6);
        prev = c;
      }
    }
  });

  it("根元と先端のセルは欠けが最大でも必ず描く", () => {
    for (let id = 1; id <= 80; id++) {
      const spans = sketchSpans(id, 100, TELEGRAPH.sketchGapMax);
      expect(spans[0]?.from, `id ${id} の根元`).toBe(0);
      expect(spans[spans.length - 1]?.to ?? 0, `id ${id} の先端`).toBeCloseTo(100, 5);
    }
  });

  it("描くセルの長さは sketchCell 未満にならない", () => {
    for (const length of [24, 25, 50, 119, 200]) {
      for (let id = 1; id <= 30; id++) {
        for (const sp of sketchSpans(id, length, 0.5)) {
          expect(sp.to - sp.from, `長さ ${length} id ${id}`).toBeGreaterThanOrEqual(TELEGRAPH.sketchCell - 1e-6);
        }
      }
    }
  });

  it("描く塊と欠けの長さの対が同じまま sketchMaxRepeat を超えて続かない（規則的な破線に見せない）", () => {
    const TOLERANCE = 0.25;
    let max = 0;
    for (let id = 1; id <= 200; id++) {
      const spans = sketchSpans(id, 200, sketchGap(0.5));
      const pairs: [number, number][] = [];
      for (let i = 0; i + 1 < spans.length; i++) {
        const s = spans[i];
        const n = spans[i + 1];
        if (s && n) pairs.push([s.to - s.from, n.from - s.to]);
      }
      let streak = 1;
      for (let i = 1; i < pairs.length; i++) {
        const [a, b] = pairs[i] ?? [0, 0];
        const [pa, pb] = pairs[i - 1] ?? [0, 0];
        streak = Math.abs(a - pa) < TOLERANCE && Math.abs(b - pb) < TOLERANCE ? streak + 1 : 1;
        max = Math.max(max, streak);
      }
    }
    expect(max).toBeLessThanOrEqual(SIGN_CHECK.sketchMaxRepeat);
  });

  it("欠けの割合は怯み値の割合で増え、上限で丸まる", () => {
    expect(sketchGap(0)).toBe(TELEGRAPH.sketchGapBase);
    expect(sketchGap(1)).toBeLessThanOrEqual(TELEGRAPH.sketchGapMax);
    expect(sketchGap(0.5)).toBeGreaterThan(sketchGap(0.1));
  });
});

describe("自分の体の上を切る", () => {
  const seg = { x0: 0, y0: 0, x1: 100, y1: 0 };

  it("円が線に重なる区間を返し、外れていれば null", () => {
    const hit = circleCut(seg, { x: 50, y: 2, r: 6 });
    expect(hit?.from).toBeCloseTo(50 - Math.sqrt(36 - 4), 5);
    expect(circleCut(seg, { x: 50, y: 20, r: 6 })).toBeNull();
    expect(circleCut(seg, { x: 200, y: 0, r: 6 })).toBeNull();
  });

  it("区間の列から切り抜く（前後は残る）", () => {
    expect(cutSpans([{ from: 0, to: 100 }], 40, 60)).toEqual([
      { from: 0, to: 40 },
      { from: 60, to: 100 },
    ]);
  });

  it("筆先が逸れても根元と長さは変わらない", () => {
    const v = veered(seg, 0.4);
    expect(v.x0).toBe(0);
    expect(segLength(v)).toBeCloseTo(100, 5);
    expect(v.y1).not.toBe(0);
  });
});

describe("溜めと張り", () => {
  it("黄の間は攻撃の逆へのけぞり縦に縮み、進むほど深い", () => {
    const early = windupEnemy("slime", 0.95);
    const late = windupEnemy("slime", ENEMY_TEMPO.commitRatio + 0.01);
    const a = telegraphPose(early.e, 0, { x: 1, y: 0 });
    const b = telegraphPose(late.e, 0, { x: 1, y: 0 });
    expect(a.dx, "攻撃の逆").toBeLessThan(0);
    expect(b.dx).toBeLessThan(a.dx);
    expect(b.sy).toBeLessThan(a.sy);
    expect(b.sy).toBeGreaterThanOrEqual(1 - TELEGRAPH_POSE.squashMax);
  });

  it("赤に入った直後だけ攻撃の向きへ伸び、張りの長さを過ぎたら元に戻る", () => {
    const { e } = windupEnemy("slime", ENEMY_TEMPO.commitRatio - 0.05);
    e.committedAt = 10;
    const p = telegraphPose(e, 10, { x: 1, y: 0 });
    expect(p.dx, "攻撃の向き").toBeGreaterThan(0);
    expect(telegraphPose(e, 10 + TELEGRAPH_POSE.stretchSec + 0.01, { x: 1, y: 0 })).toEqual({ dx: 0, dy: 0, sx: 1, sy: 1 });
  });

  it("黄の進みは 0 から 1、予備動作でなければ動かない", () => {
    const { e } = windupEnemy("slime", 1);
    expect(yellowProgress(e)).toBe(0);
    e.phaseTimer = ENEMY_TEMPO.commitRatio;
    expect(yellowProgress(e)).toBeCloseTo(1, 5);
    e.phase = "chase";
    expect(telegraphPose(e, 0, { x: 1, y: 0 })).toEqual({ dx: 0, dy: 0, sx: 1, sy: 1 });
  });
});

describe("黄の間は赤を使わない（全部の敵）", () => {
  function colorsFor(ratio: number): Set<string> {
    const state = arena();
    ENEMIES.forEach((def, i) => {
      const e = placeEnemy(state, def.key, 20 + (i % 10) * 12, Math.floor(i / 10) * 12 - 60);
      e.phase = "windup";
      e.windupTotal = 1;
      e.phaseTimer = ratio;
      e.strikeDir = { x: 1, y: 0 };
    });
    const { ctx, colors } = recordingCtx();
    new TelegraphLayer().draw(ctx, state, HELPERS);
    return colors;
  }

  it("黄の間の予告は commitColor を使わない（線・範囲・折れ線・頭上の印のすべて）", () => {
    const colors = colorsFor(1);
    expect(colors.has(TELEGRAPH.readyColor), "黄は使う").toBe(true);
    expect(colors.has(TELEGRAPH.commitColor), "赤は使わない").toBe(false);
  });

  it("赤の間の予告は commitColor を使い、readyColor を使わない", () => {
    const colors = colorsFor(ENEMY_TEMPO.commitRatio - 0.1);
    expect(colors.has(TELEGRAPH.commitColor)).toBe(true);
    expect(colors.has(TELEGRAPH.readyColor)).toBe(false);
  });
});

describe("擦れと筆先の逸れ", () => {
  function effectsOf(layer: TelegraphLayer): { kind: string }[] {
    return (layer as unknown as { effects: { kind: string }[] }).effects;
  }

  it("下絵の敵が怯みに入ると線を覚えて散らし、時間が過ぎたら消える", () => {
    const { state, e } = windupEnemy("slime", 0.9);
    const layer = new TelegraphLayer();
    const { ctx } = recordingCtx();
    layer.draw(ctx, state, HELPERS);
    applyStagger(state, e, 1);
    layer.draw(ctx, state, HELPERS);
    expect(effectsOf(layer).length, "擦れが 1 つ").toBe(1);
    expect(effectsOf(layer)[0]?.kind).toBe("erase");
    state.time += TELEGRAPH.eraseSec + 0.01;
    layer.draw(ctx, state, HELPERS);
    expect(effectsOf(layer).length, "散り終わった").toBe(0);
  });

  it("墨入れの敵が怯みに入る（受け流し）と筆先が逸れる", () => {
    const { state, e } = windupEnemy("slime", 0.3);
    const layer = new TelegraphLayer();
    const { ctx } = recordingCtx();
    layer.draw(ctx, state, HELPERS);
    applyStagger(state, e, 1);
    layer.draw(ctx, state, HELPERS);
    expect(effectsOf(layer)[0]?.kind).toBe("veer");
  });

  it("怯みに入らずに線が消えても（攻撃を出し終えた）擦れは出ない", () => {
    const { state, e } = windupEnemy("slime", 0.9);
    const layer = new TelegraphLayer();
    const { ctx } = recordingCtx();
    layer.draw(ctx, state, HELPERS);
    e.phase = "recover";
    layer.draw(ctx, state, HELPERS);
    expect(effectsOf(layer).length).toBe(0);
  });
});
