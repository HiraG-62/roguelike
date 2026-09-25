import { describe, expect, it } from "vitest";
import { createGame } from "../core/game";
import { VIEW_H, VIEW_W } from "../core/view";
import { SKILL } from "../skills/data";
import { boonHudTop } from "./boonUi";
import { LAYER_CONTENTS, RENDER_LAYERS, type RenderLayer, drawInLayerOrder, hudLayoutFor, layerIndex } from "./layers";
import { type HudRect, hudLayout, rectsOverlap } from "./renderMath";

describe("描画の層の順", () => {
  it("マップ → 画面効果 → HUD → 知らせ → 階層移動 → ポップアップ → 照準 の順", () => {
    expect(RENDER_LAYERS, "層の順").toEqual(["world", "worldOverlay", "hud", "hudOverlay", "transition", "popup", "cursor"]);
    expect(layerIndex("hud"), "HUD はワールドより上").toBeGreaterThan(layerIndex("worldOverlay"));
    expect(layerIndex("popup"), "ポップアップは HUD より上").toBeGreaterThan(layerIndex("hudOverlay"));
    expect(layerIndex("popup"), "祝福 3 択は黒帯より上").toBeGreaterThan(layerIndex("transition"));
  });

  it("drawInLayerOrder は層の順に 1 回ずつ呼ぶ", () => {
    const called: RenderLayer[] = [];
    const mark = (l: RenderLayer) => (): void => {
      called.push(l);
    };
    drawInLayerOrder({
      cursor: mark("cursor"),
      popup: mark("popup"),
      transition: mark("transition"),
      hudOverlay: mark("hudOverlay"),
      hud: mark("hud"),
      worldOverlay: mark("worldOverlay"),
      world: mark("world"),
    });
    expect(called, "呼んだ順").toEqual([...RENDER_LAYERS]);
  });

  it("各描画はちょうど 1 つの層に属する", () => {
    const all = RENDER_LAYERS.flatMap((l) => LAYER_CONTENTS[l]);
    expect(new Set(all).size, "重複なし").toBe(all.length);
  });

  it("画面全体の効果は HUD より下、床のアイテムのツールチップは HUD より上", () => {
    const layerOf = (name: string): number => RENDER_LAYERS.findIndex((l) => LAYER_CONTENTS[l].includes(name));
    expect(layerOf("drawOverlays"), "閃光・周辺減光").toBeLessThan(layerOf("drawHud"));
    expect(layerOf("darkness"), "暗がり").toBeLessThan(layerOf("drawHud"));
    expect(layerOf("drawDropFocus"), "床のアイテムのツールチップ").toBeGreaterThan(layerOf("drawSkillSlots"));
    expect(layerOf("drawBoonChoice"), "祝福 3 択").toBeGreaterThan(layerOf("drawFloorWipe"));
    expect(layerOf("drawSkillGround"), "スキルの設置物はワールド").toBe(layerIndex("world"));
  });
});

/** 祝福アイコン列（最大の 16 個分の幅で見る） */
function boonRows(count: number): HudRect {
  const perRow = 16;
  const w = perRow * 12 - 2;
  const top = boonHudTop(count);
  return { x: VIEW_W - 4 - w, y: top, w, h: VIEW_H - 4 - top };
}

/** 画面下中央のラン情報（runUi.ts: 基準線 VIEW_H - 20 から上へ 2 行）と、最下行の「封鎖中」・ログ */
function bottomCenter(line: number): HudRect[] {
  const runTop = VIEW_H - 20 - line * 2 + 2;
  return [
    { x: 0, y: runTop, w: VIEW_W, h: VIEW_H - 18 - runTop },
    { x: 0, y: VIEW_H - 8 - line + 2, w: VIEW_W / 2, h: line },
  ];
}

function inside(r: HudRect): boolean {
  return r.x >= 0 && r.y >= 0 && r.x + r.w <= VIEW_W && r.y + r.h <= VIEW_H;
}

describe("画面下の HUD の配置", () => {
  const cases = [1, 16, 17, 40].flatMap((boons) => [8, 10, 12].map((lineH) => ({ boons, lineH })));

  it.each(cases)("祝福 $boons 個・行高 $lineH でスキル枠・変身・コンボ・祝福・芽が重ならない", ({ boons, lineH }) => {
    const layout = hudLayout(boonHudTop(boons), lineH, SKILL.slots);
    const line = Math.max(10, lineH);
    const named: [string, HudRect][] = [
      ["スキル枠", layout.skills],
      ["変身の行", layout.form],
      ["芽", layout.bud],
      ["コンボ", layout.combo],
      ["祝福", boonRows(boons)],
    ];
    for (const [name, r] of named) expect(inside(r), `${name}は画面内`).toBe(true);
    for (let i = 0; i < named.length; i++) {
      for (let j = i + 1; j < named.length; j++) {
        const [an, a] = named[i] ?? ["", layout.skills];
        const [bn, b] = named[j] ?? ["", layout.skills];
        expect(rectsOverlap(a, b), `${an} と ${bn}`).toBe(false);
      }
    }
    for (const r of bottomCenter(line)) expect(rectsOverlap(layout.combo, r), "コンボと画面下中央").toBe(false);
    expect(layout.chainBottom, "連鎖は変身の行より上").toBeLessThan(layout.form.y);
    expect(layout.chainBottom, "連鎖はコンボより上").toBeLessThan(layout.combo.y);
  });

  it("スキル枠は右下（右端に寄せ、画面の下半分）", () => {
    const layout = hudLayout(boonHudTop(1), 10, SKILL.slots);
    expect(layout.skills.x + layout.skills.w, "右端").toBe(VIEW_W - 4);
    expect(layout.skills.y, "下半分").toBeGreaterThan(VIEW_H / 2);
    expect(layout.keyBaseline, "キー番号は枠の下").toBeGreaterThan(layout.slotTop + 16);
  });

  it("祝福が 0 個でも 1 段分を空け、祝福を取ってもスキル枠が動かない", () => {
    const state = createGame(1);
    state.boons = [];
    const none = hudLayoutFor(state, 10);
    state.boons = ["burnSpread"];
    const one = hudLayoutFor(state, 10);
    expect(none.skills, "同じ位置").toEqual(one.skills);
  });

  it("rectsOverlap は辺が接するだけなら重ならない", () => {
    const a = { x: 0, y: 0, w: 10, h: 10 };
    expect(rectsOverlap(a, { x: 10, y: 0, w: 5, h: 5 }), "右に接する").toBe(false);
    expect(rectsOverlap(a, { x: 9, y: 9, w: 5, h: 5 }), "角が重なる").toBe(true);
  });
});
