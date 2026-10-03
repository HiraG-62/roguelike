import { describe, expect, it } from "vitest";
import { HUB } from "../data/tuning";
import type { Vec } from "../core/vec";
import { type GameMap, type Rect, TILE_SIZE, Tile, getTile } from "./grid";
import { HUB_LOT_KEYS, HUB_SPOT_KEYS, type HubLotKey, type HubSpotKey, buildHubMap } from "./hubMap";
import { NEIGHBORS_4, floodFill } from "./regions";

const layout = buildHubMap();

function tileOf(p: Vec): [number, number] {
  return [Math.floor(p.x / TILE_SIZE), Math.floor(p.y / TILE_SIZE)];
}

function tilesOf(rect: Rect): [number, number][] {
  const out: [number, number][] = [];
  for (let y = rect.y; y < rect.y + rect.h; y++) for (let x = rect.x; x < rect.x + rect.w; x++) out.push([x, y]);
  return out;
}

function inRect(rect: Rect, [x, y]: readonly [number, number]): boolean {
  return x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h;
}

function isFloor(map: GameMap, [x, y]: readonly [number, number]): boolean {
  return getTile(map, x, y) === Tile.Floor;
}

/** 台は自分の敷地の南 1 マス以内（敷地の列の範囲の中）に立つ。記録の蔵の 3 台は蔵の南。稽古の間の入口は稽古場の中（別に見る） */
const SPOT_LOT: Readonly<Record<Exclude<HubSpotKey, "dojo">, HubLotKey>> = {
  well: "well",
  board: "board",
  forge: "forge",
  library: "library",
  altar: "shrine",
  garden: "garden",
  history: "archive",
  codex: "archive",
  achievements: "archive",
  rack: "rackShed",
  hall: "hall",
};

describe("門前町の配置", () => {
  it("台・木人・開始位置は当たりの床にある", () => {
    const points = [...HUB_SPOT_KEYS.map((k) => layout.spots[k]), ...layout.dummySpots, layout.playerStart];
    for (const p of points) expect(isFloor(layout.map, tileOf(p)), `(${p.x}, ${p.y}) が床`).toBe(true);
    expect(layout.dummySpots, "木人は HUB.dummyCount 体").toHaveLength(HUB.dummyCount);
    expect(layout.map.width, "横 30 マス").toBe(30);
    expect(layout.map.height, "縦 24 マス").toBe(24);
  });

  it("開始位置から全部の台・木人・石段へ歩いて行ける", () => {
    const { map } = layout;
    const g = { w: map.width, h: map.height, cells: map.tiles };
    const [sx, sy] = tileOf(layout.playerStart);
    const reach = new Uint8Array(map.width * map.height);
    floodFill(g, sy * map.width + sx, NEIGHBORS_4, (i) => map.tiles[i] === Tile.Floor, reach);
    const reached = (t: readonly [number, number]): boolean => reach[t[1] * map.width + t[0]] === 1;
    for (const key of HUB_SPOT_KEYS) expect(reached(tileOf(layout.spots[key])), `${key} に着く`).toBe(true);
    for (const d of layout.dummySpots) expect(reached(tileOf(d)), "木人に着く").toBe(true);
    for (const t of tilesOf(layout.gateZone)) expect(reached(t), `石段 (${t.join(",")}) に着く`).toBe(true);
  });

  it("台どうしは HUB.interactRadius の 2 倍より離れている", () => {
    for (const a of HUB_SPOT_KEYS) {
      for (const b of HUB_SPOT_KEYS) {
        if (a >= b) continue;
        const pa = layout.spots[a];
        const pb = layout.spots[b];
        expect(Math.hypot(pa.x - pb.x, pa.y - pb.y), `${a} と ${b}`).toBeGreaterThan(HUB.interactRadius * 2);
      }
    }
  });

  it("台は自分の敷地の南 1 マス以内に立つ", () => {
    for (const key of Object.keys(SPOT_LOT) as (keyof typeof SPOT_LOT)[]) {
      const lot = layout.lots[SPOT_LOT[key]];
      const [tx, ty] = tileOf(layout.spots[key]);
      expect(ty, `${key} は敷地の 1 行南`).toBe(lot.y + lot.h);
      expect(tx >= lot.x && tx < lot.x + lot.w, `${key} は敷地の列の範囲`).toBe(true);
    }
  });

  it("敷地は当たりで壁、ground で床。稽古場だけは両方とも床（武器小屋の所を除く）", () => {
    for (const key of HUB_LOT_KEYS) {
      const rect = layout.lots[key];
      expect(rect.w * rect.h, `${key} は空でない`).toBeGreaterThan(0);
      for (const t of tilesOf(rect)) {
        expect(isFloor(layout.ground, t), `${key} (${t.join(",")}) は ground で床`).toBe(true);
        if (key === "yard" && !inRect(layout.lots.rackShed, t)) {
          expect(isFloor(layout.map, t), `稽古場 (${t.join(",")}) は当たりも床`).toBe(true);
          continue;
        }
        expect(isFloor(layout.map, t), `${key} (${t.join(",")}) は当たりで壁`).toBe(false);
      }
    }
  });

  it("武器小屋は稽古場の中にあり、木人は稽古場の中に立つ", () => {
    const yard = layout.lots.yard;
    for (const t of tilesOf(layout.lots.rackShed)) expect(inRect(yard, t), "小屋が稽古場の中").toBe(true);
    for (const d of layout.dummySpots) expect(inRect(yard, tileOf(d)), "木人が稽古場の中").toBe(true);
    expect(inRect(yard, tileOf(layout.spots.dojo)), "稽古の間の入口が稽古場の中").toBe(true);
  });

  it("鳥居の柱は当たりで壁、ground で床。鳥居の矩形は石段を含み、柱の間は参道", () => {
    const { gate, gateZone } = layout;
    for (const t of tilesOf(gateZone)) expect(inRect(gate, t), "石段が鳥居の矩形の中").toBe(true);
    const pillarY = gate.y + gate.h - 1;
    for (const x of [gate.x, gate.x + gate.w - 1]) {
      expect(isFloor(layout.map, [x, pillarY]), `柱 ${x} は当たりで壁`).toBe(false);
      expect(isFloor(layout.ground, [x, pillarY]), `柱 ${x} は ground で床`).toBe(true);
    }
    for (let x = gate.x + 1; x < gate.x + gate.w - 1; x++) expect(isFloor(layout.map, [x, pillarY]), `参道 ${x} は床`).toBe(true);
  });

  it("石段は床で、開始位置は石段の外にある", () => {
    for (const t of tilesOf(layout.gateZone)) expect(isFloor(layout.map, t), `石段 (${t.join(",")}) は床`).toBe(true);
    expect(inRect(layout.gateZone, tileOf(layout.playerStart)), "開始位置は石段の外").toBe(false);
    expect([...layout.map.tiles].includes(Tile.StairsDown), "迷宮の階段タイルは使わない").toBe(false);
  });

  it("参道・辻の石畳はすべて当たりの床", () => {
    for (const road of layout.roads) for (const t of tilesOf(road)) expect(isFloor(layout.map, t), `道 (${t.join(",")})`).toBe(true);
  });

  it("灯籠・小物の置き場は床で、台・木人・道を塞がず、互いに重ならない", () => {
    expect(layout.lanternSlots.length, "灯籠は最大 8").toBeLessThanOrEqual(8);
    expect(layout.lanternSlots.length, "灯籠の置き場がある").toBeGreaterThan(0);
    expect(layout.clutterSlots.length, "小物は 4〜6 個").toBeGreaterThanOrEqual(4);
    expect(layout.clutterSlots.length, "小物は 4〜6 個").toBeLessThanOrEqual(6);
    const taken = new Set<string>(
      [...HUB_SPOT_KEYS.map((k) => layout.spots[k]), ...layout.dummySpots, layout.playerStart].map((p) => tileOf(p).join(",")),
    );
    const slots = [...layout.lanternSlots, ...layout.clutterSlots];
    for (const p of slots) {
      const t = tileOf(p);
      const id = t.join(",");
      expect(isFloor(layout.map, t), `(${id}) は床`).toBe(true);
      expect(taken.has(id), `(${id}) は台・木人・開始位置の上でない`).toBe(false);
      expect(
        layout.roads.some((r) => inRect(r, t)),
        `(${id}) は道の上でない`,
      ).toBe(false);
      expect(inRect(layout.gateZone, t), `(${id}) は石段の上でない`).toBe(false);
      taken.add(id);
    }
  });

  it("灯籠の置き場は門に近い順に並ぶ", () => {
    const ys = layout.lanternSlots.map((p) => p.y);
    expect(ys, "上（門）から下へ").toEqual([...ys].sort((a, b) => a - b));
  });

  it("当たりの地図と ground の違いは、敷地と鳥居の柱だけ（見えない壁を作らない）", () => {
    let diff = 0;
    layout.map.tiles.forEach((tile, i) => {
      if (tile !== layout.ground.tiles[i]) diff += 1;
    });
    const walled = HUB_LOT_KEYS.filter((k) => k !== "yard").reduce((n, k) => n + layout.lots[k].w * layout.lots[k].h, 0);
    expect(diff, "差は敷地 + 柱 2").toBe(walled + 2);
  });

  it("部屋は外周の壁を除いた 1 つ", () => {
    expect(layout.map.rooms).toHaveLength(1);
    expect(layout.map.rooms[0]).toEqual({ x: 1, y: 1, w: layout.map.width - 2, h: layout.map.height - 2 });
  });
});
