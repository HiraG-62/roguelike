import { afterEach, describe, expect, it, vi } from "vitest";
import { createGame } from "../core/game";
import { ACTOR_SHEETS } from "../data/actorSheets.gen";
import { MOVESET_KEYS } from "../data/weapons";
import { ATTIRE_PART_RECTS, ATTIRE_SLOTS, FIGURE_RECT } from "../ui/attire";
import { ACTOR_ART_SCALE, type ActorCell, actorAnchor, weaponAtlas, weaponOffGrip, weaponStanceMeta } from "./actorSprites";
import { FIGURE_FEET, PART_ANCHORS } from "./attireUi";
import { FIGURE_ANCHOR_DOTS, FIGURE_ZOOM, type FigurePainter, MINI_ZOOM, composeIdle, dotSize, drawAttireFigure, ellipseRows, figurePoint, figureReady, fitZoom, isCrispZoom } from "./attireFigure";
import { type Pt, solveRig, stanceFromMeta } from "./playerRig";

const RECT_STRIDE = 6;
/** コマの下端の透明な余白（足の下の台座の高さ）の許容。論理 px */
const BOTTOM_MARGIN = 3;

/** シートの 1 コマ目の矩形（絵のドット） */
function firstRect(key: string): { w: number; h: number; ox: number; oy: number } {
  const sheet = ACTOR_SHEETS[key];
  const r = sheet?.rects ?? [];
  return { w: r[2] ?? 0, h: r[3] ?? 0, ox: r[4] ?? 0, oy: r[5] ?? 0 };
}

const BODY_IDLE_KEYS = Object.keys(ACTOR_SHEETS).filter((k) => k.startsWith("body") && k.endsWith(".idleReady"));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("体の倍率と置き場の計算", () => {
  it("装束の倍率 3 と小さな体の倍率 2 は、粒が背面バッファの整数画素になる", () => {
    expect(isCrispZoom(FIGURE_ZOOM), "装束の倍率").toBe(true);
    expect(isCrispZoom(MINI_ZOOM), "小さな体の倍率").toBe(true);
    expect(dotSize(FIGURE_ZOOM), "3 倍で 1 ドット = 論理 1.5px").toBe(1.5);
  });

  it("半端な倍率は粒が崩れるので整数画素にならない", () => {
    expect(isCrispZoom(1.25), "1.25 倍（1 ドット 0.625px = 2.5 画素）").toBe(false);
  });

  it("体のコマ（43 ドット = 論理 21.5px）は高さ 66px の箱に 3 倍まで入る", () => {
    expect(fitZoom(43, 66), "66px の箱").toBe(3);
    expect(fitZoom(43, 20), "箱が小さくても 1 倍を下回らない").toBe(1);
  });

  it("足元からのドットを論理座標へ直す（上が負）", () => {
    expect(figurePoint({ x: 100, y: 100 }, 3, { x: 2, y: -10 }), "1.5 倍して足す").toEqual({ x: 103, y: 85 });
  });

  it("台座の楕円は上下対称で、真ん中の行がいちばん広い", () => {
    const rows = ellipseRows(50, 50, 20, 4);
    expect(rows.length, "行数").toBe(9);
    expect(rows[4]?.w, "真ん中の幅").toBe(40);
    expect(rows[0]?.w, "上端の幅").toBe(rows[8]?.w);
    expect(rows[0]?.w ?? 99, "端は狭い").toBeLessThan(rows[4]?.w ?? 0);
  });
});

describe("装束の人影の枠", () => {
  it("全ジョブの待機の体が部位の枠にかぶらず、人影の枠の下端に収まる", () => {
    expect(BODY_IDLE_KEYS.length, "体のシートがある").toBeGreaterThan(0);
    const d = dotSize(FIGURE_ZOOM);
    for (const key of BODY_IDLE_KEYS) {
      const r = firstRect(key);
      const left = FIGURE_FEET.x - r.ox * d;
      const right = FIGURE_FEET.x + (r.w - r.ox) * d;
      const top = FIGURE_FEET.y - r.oy * d;
      const bottom = FIGURE_FEET.y + (r.h - r.oy) * d;
      expect(left, `${key} の左（左の部位の枠の右まで）`).toBeGreaterThanOrEqual(ATTIRE_PART_RECTS.mainHand.x + ATTIRE_PART_RECTS.mainHand.w);
      expect(right, `${key} の右（右の部位の枠の左まで）`).toBeLessThanOrEqual(ATTIRE_PART_RECTS.ring.x);
      expect(top, `${key} の上（頭の枠の下まで）`).toBeGreaterThanOrEqual(ATTIRE_PART_RECTS.head.y + ATTIRE_PART_RECTS.head.h);
      expect(bottom, `${key} の下`).toBeLessThanOrEqual(FIGURE_RECT.y + FIGURE_RECT.h + BOTTOM_MARGIN);
    }
  });

  it("部位から伸ばす糸の先は、全ジョブの体のコマの中にある", () => {
    const d = dotSize(FIGURE_ZOOM);
    for (const key of BODY_IDLE_KEYS) {
      const r = firstRect(key);
      for (const slot of ATTIRE_SLOTS) {
        const a = PART_ANCHORS[slot];
        expect(a.x, `${key} ${slot} の x`).toBeGreaterThanOrEqual(FIGURE_FEET.x - r.ox * d);
        expect(a.x, `${key} ${slot} の x`).toBeLessThanOrEqual(FIGURE_FEET.x + (r.w - r.ox) * d);
        expect(a.y, `${key} ${slot} の y`).toBeGreaterThanOrEqual(FIGURE_FEET.y - r.oy * d);
        expect(a.y, `${key} ${slot} の y`).toBeLessThanOrEqual(FIGURE_FEET.y + (r.h - r.oy) * d);
      }
    }
  });

  it("糸の先は 6 部位ぶんあり、頭が最も上・足が最も下", () => {
    expect(Object.keys(FIGURE_ANCHOR_DOTS).sort(), "部位").toEqual([...ATTIRE_SLOTS].sort());
    const ys = ATTIRE_SLOTS.map((s) => PART_ANCHORS[s].y);
    expect(PART_ANCHORS.head.y, "頭").toBe(Math.min(...ys));
    expect(PART_ANCHORS.boots.y, "足").toBe(Math.max(...ys));
  });
});

describe("読み込み前は代わりの人形", () => {
  it("画像を読めない環境では描かず false を返す（呼び側が今までの人形を描く）", () => {
    const state = createGame(1);
    const calls: string[] = [];
    const ctx = new Proxy({}, { get: (_o, p) => (...a: unknown[]) => void calls.push(`${String(p)}:${a.length}`) }) as unknown as CanvasRenderingContext2D;
    expect(figureReady(state), "準備できていない").toBe(false);
    expect(drawAttireFigure(ctx, state, FIGURE_FEET, FIGURE_ZOOM, 0), "描かない").toBe(false);
    expect(calls.length, "Canvas に触らない").toBe(0);
  });

  it("画像の読み込みが終わっていない間は false のまま（読み始める）", () => {
    const requested: string[] = [];
    class PendingImage {
      set src(v: string) {
        requested.push(v);
      }
      decode(): Promise<void> {
        return new Promise(() => undefined);
      }
    }
    vi.stubGlobal("Image", PendingImage);
    const state = createGame(1);
    expect(figureReady(state), "読み込み中").toBe(false);
    expect(requested.length, "体と武器の 2 枚を読み始めた").toBe(2);
    expect(figureReady(state), "2 回目の呼びでも読み込み中").toBe(false);
    expect(requested.length, "読み直さない").toBe(2);
  });
});

describe("待機の腕と武器の重ね順", () => {
  const cell: ActorCell = { img: {} as HTMLImageElement, sx: 0, sy: 0, w: 24, h: 43, ox: 12, oy: 41 };

  function record(): { painter: FigurePainter; log: string[] } {
    const log: string[] = [];
    const painter: FigurePainter = {
      body: () => void log.push("body"),
      weapon: () => void log.push("weapon"),
      arm: (_s: Pt, _p, dim: boolean) => void log.push(dim ? "armBack" : "armFront"),
      hand: () => void log.push("hand"),
    };
    return { painter, log };
  }

  it("絵のある全武器種で、体を 1 回だけ置き、武器か手のどちらかを描く", () => {
    const shoulderF = actorAnchor("bodyNone.idleReady", 0, 0, "shoulderF");
    const shoulderB = actorAnchor("bodyNone.idleReady", 0, 0, "shoulderB");
    expect(shoulderF, "肩の印").toBeDefined();
    if (!shoulderF || !shoulderB) return;
    for (const key of MOVESET_KEYS) {
      const weapon = weaponAtlas(key);
      if (weapon === undefined) continue;
      const stance = stanceFromMeta(weaponStanceMeta(weapon));
      const rig = solveRig({
        stance,
        swing: undefined,
        step: 0,
        aim: 0,
        aimHeld: false,
        facingRight: true,
        shoulderF,
        shoulderB,
        time: 0.3,
        offGrip: weaponOffGrip(weapon),
        aimOrigin: { x: 0, y: -26 },
        barrelY: 0,
        unrotated: false,
      });
      const { painter, log } = record();
      composeIdle(painter, { rig, shoulderF, shoulderB, stance }, cell);
      expect(log.filter((l) => l === "body").length, `${key} の体は 1 回`).toBe(1);
      expect(log.some((l) => l === "weapon" || l === "armFront"), `${key} は武器か前の腕を描く`).toBe(true);
    }
  });

  it("手にはめる武器（爪など）は腕の上に武器を重ね、持つ武器は腕の下に敷く", () => {
    const shoulderF: Pt = { x: 4, y: -21 };
    const shoulderB: Pt = { x: -3, y: -22 };
    const front = { hand: { x: 8, y: -12 }, angle: 0, mirror: false, behind: false, bare: false };
    const back = { ...front, hand: { x: -4, y: -13 }, behind: true, bare: true };
    const worn = record();
    composeIdle(worn.painter, { rig: { front, back }, shoulderF, shoulderB, stance: { ...stanceFromMeta(undefined), worn: true } }, cell);
    expect(worn.log.slice(-2), "爪は腕のあとに武器").toEqual(["armFront", "weapon"]);
    const held = record();
    composeIdle(held.painter, { rig: { front, back }, shoulderF, shoulderB, stance: stanceFromMeta(undefined) }, cell);
    expect(held.log.indexOf("weapon"), "持つ武器は前の腕より先").toBeLessThan(held.log.indexOf("armFront"));
  });
});

describe("絵の寸法の前提", () => {
  it("絵 1 ドットは論理 1 / ACTOR_ART_SCALE px で、体のコマの矩形は 6 要素ずつ並ぶ", () => {
    expect(ACTOR_ART_SCALE, "ドット密度").toBe(2);
    for (const key of BODY_IDLE_KEYS) {
      expect((ACTOR_SHEETS[key]?.rects.length ?? 0) % RECT_STRIDE, `${key} の矩形`).toBe(0);
    }
  });
});
