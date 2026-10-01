import { describe, expect, it } from "vitest";
import { buildHubMap, type HubSpotKey } from "../map/hubMap";
import { nearGate, spotPrompt, nearUnbuiltSpot } from "./hubUi";

describe("拠点の台の案内文", () => {
  it("井戸は寄進の総額があれば「寄進 n」を添える", () => {
    expect(spotPrompt("well", 120), "寄進あり").toContain("寄進 120");
    expect(spotPrompt("well", 0), "0 なら出さない").not.toContain("寄進");
    expect(spotPrompt("well", undefined), "未設定なら出さない").not.toContain("寄進");
  });

  it("井戸以外の台には寄進を出さない", () => {
    expect(spotPrompt("board", 120)).not.toContain("寄進");
  });
});

describe("石段の案内（nearGate）", () => {
  const gate = { x: 13, y: 1, w: 4, h: 2 };
  const T = 16;

  it("石段の矩形の中と、その周り 3 マスまでは近い。それより離れると遠い", () => {
    expect(nearGate({ x: 15 * T, y: 1.5 * T }, gate), "矩形の中").toBe(true);
    expect(nearGate({ x: 15 * T, y: 3 * T + 40 }, gate), "南へ 40px").toBe(true);
    expect(nearGate({ x: 15 * T, y: 3 * T + 60 }, gate), "南へ 60px").toBe(false);
    expect(nearGate({ x: 13 * T - 40, y: 2 * T }, gate), "西へ 40px").toBe(true);
    expect(nearGate({ x: 13 * T - 60, y: 2 * T }, gate), "西へ 60px").toBe(false);
  });

  it("矩形の角からは直線距離で測る（斜めに離れると遠い）", () => {
    expect(nearGate({ x: 13 * T - 35, y: 3 * T + 35 }, gate), "角から約 49px").toBe(false);
  });

  it("石段が無い拠点（矩形が空）では出さない", () => {
    expect(nearGate({ x: 0, y: 0 }, { x: 0, y: 0, w: 0, h: 0 })).toBe(false);
  });
});

describe("未建設の設備の手がかり（nearUnbuiltSpot）", () => {
  const spots = { ...buildHubMap().spots };
  const all = new Set(Object.keys(spots) as HubSpotKey[]);

  it("建っていない台の近くなら、その台を返す", () => {
    const available = new Set(all);
    available.delete("library");
    const at = spots.library;
    expect(nearUnbuiltSpot({ x: at.x, y: at.y + 8 }, { spots, available, near: null })).toBe("library");
  });

  it("建っている台や、遠い所では null", () => {
    const at = spots.library;
    expect(nearUnbuiltSpot({ x: at.x, y: at.y + 8 }, { spots, available: all, near: null })).toBeNull();
    const available = new Set(all);
    available.delete("library");
    expect(nearUnbuiltSpot({ x: at.x + 400, y: at.y }, { spots, available, near: null })).toBeNull();
  });
});
