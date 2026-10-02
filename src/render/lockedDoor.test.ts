import { describe, expect, it } from "vitest";
// system の循環参照は core/game を先に読むと解ける（他の描画のテストと同じ順）
import "../core/game";
import { FLOOR_KINDS } from "../system/biomes";
import {
  DOOR_CONTRAST_MIN,
  DOOR_EDGE_MIN,
  colorDistance,
  doorBarSeen,
  doorBaseColor,
  doorEdgeSeenDim,
  lockedDoorBar,
  lockedDoorEdge,
  type DoorEdgeLook,
} from "./lockedDoor";
import { hexColor, mapThemeFor } from "./mapTheme";
import type { MapTheme } from "./mapTypes";

/** 迷宮の深度 1〜40 × 9 バイオームのテーマ（同じ参照は 1 つに） */
function allThemes(): MapTheme[] {
  const seen = new Set<MapTheme>();
  for (let depth = 1; depth <= 40; depth++) for (const kind of FLOOR_KINDS) seen.add(mapThemeFor(depth, kind));
  return [...seen];
}

const RGB_RE = /^rgb\((\d+),(\d+),(\d+)\)$/;

describe("lockedDoor: 封鎖の扉の色", () => {
  it("すべての章・バイオーム・深みの変異で、格子と外周の赤（脈の谷）が十分に違う", () => {
    const rows: string[] = [];
    for (const theme of allThemes()) {
      const P = theme.palette;
      const d = colorDistance(doorBarSeen(P, lockedDoorBar(P)), doorEdgeSeenDim(P));
      rows.push(`${theme.key} ${d.toFixed(0)}`);
      expect(d, `${theme.key} の格子と外周`).toBeGreaterThanOrEqual(DOOR_CONTRAST_MIN);
    }
    expect(rows.length, "テーマが複数ある").toBeGreaterThan(9);
  });

  it("外周の赤は、どの章でも扉の暗い床から十分に浮く", () => {
    for (const theme of allThemes()) {
      const P = theme.palette;
      expect(colorDistance(doorEdgeSeenDim(P), doorBaseColor(P)), `${theme.key} の外周と床`).toBeGreaterThanOrEqual(DOOR_CONTRAST_MIN);
    }
  });

  it("差し色が赤でない章（苔の洞・廃城・異界）は、格子を章の差し色のまま描く", () => {
    for (const [depth, kind] of [[3, "cave"], [12, "forge"], [13, "glacier"], [17, "cave"]] as const) {
      const P = mapThemeFor(depth, kind).palette;
      expect(lockedDoorBar(P), `深度 ${depth} ${kind}`).toBe(P.accent);
    }
  });

  it("差し色が朱の章（寺院・最深の間）は、格子を差し色から替える", () => {
    for (const [depth, kind] of [[7, "rooms"], [8, "mine"], [21, "rooms"]] as const) {
      const P = mapThemeFor(depth, kind).palette;
      expect(colorDistance(doorBarSeen(P, P.accent), doorEdgeSeenDim(P)), `深度 ${depth} ${kind} の朱は外周の赤に近い`).toBeLessThan(DOOR_CONTRAST_MIN);
      expect(lockedDoorBar(P), `深度 ${depth} ${kind}`).not.toBe(P.accent);
    }
  });

  it("外周は脈のどの位相でも赤く（R が G・B より大きい）、透けは谷でも濃い", () => {
    const look: DoorEdgeLook = { color: "", alpha: 0 };
    for (let t = 0; t < 2; t += 0.05) {
      lockedDoorEdge(t, look);
      const m = RGB_RE.exec(look.color);
      expect(m, `時刻 ${t} の色 ${look.color}`).not.toBeNull();
      if (!m) continue;
      const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])];
      expect(r, `時刻 ${t} の R`).toBeGreaterThan(g);
      expect(r, `時刻 ${t} の R`).toBeGreaterThan(b);
      expect(look.alpha, `時刻 ${t} の透け`).toBeGreaterThanOrEqual(DOOR_EDGE_MIN - 1e-9);
    }
  });

  it("同じ時刻なら同じ外周（実時間に依らない）", () => {
    const a = lockedDoorEdge(1.234, { color: "", alpha: 0 });
    const b = lockedDoorEdge(1.234, { color: "", alpha: 0 });
    expect(b).toEqual(a);
  });

  it("色の距離は同じ色で 0、黒と白で最大に近い", () => {
    const red = hexColor("#ff3030");
    expect(colorDistance(red, red)).toBe(0);
    expect(colorDistance(hexColor("#000000"), hexColor("#ffffff"))).toBeGreaterThan(700);
  });
});
