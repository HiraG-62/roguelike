import { describe, expect, it, vi } from "vitest";
// system の循環参照は core/game を先に読むと解ける（他の描画のテストと同じ順）
import "../core/game";
import type { GameState } from "../core/state";
import { Tile, TILE_SIZE, createMap, type Rect } from "../map/grid";
import { HUB_LOT_KEYS, HUB_SPOT_KEYS, type HubLayout, type HubLotKey, type HubSpotKey } from "../map/hubMap";
import { FACILITY_KEYS, FACILITY_NAME, FACILITY_OF_LOT, type FacilityKey } from "../meta/hub";
import type { TownLook } from "../meta/townLook";
import { type TownObjectKind, townObjectGlows } from "./townArt";
import {
  ROAD_DOTS_PER_FRAME,
  TOWN_ART_PER_FRAME,
  TownLayer,
  type TownHubView,
  bakeRoadPixels,
  buildTownGlows,
  buildTownLabels,
  buildTownPlacements,
  createRoadBake,
  glowFlicker,
  glowLevel,
  glowPixels,
  isBehindPlayer,
  stelePosition,
  townArtKey,
  trophyPositions,
} from "./townScene";
import { MAP_DOTS, TILE_DOTS } from "./mapTypes";

/** 絵が入ったかどうか（townArt は C2 の担当。ここでは差し替えて仕組みだけ検査する） */
const art = { real: false };
vi.mock("./townArt", () => ({
  townObjectPixels: (_kind: TownObjectKind) =>
    art.real ? { w: 4, h: 6, anchor: { x: 2, y: 6 }, pixels: new Uint32Array(24).fill(0xff0000ff) } : { w: 1, h: 1, anchor: { x: 0, y: 0 }, pixels: new Uint32Array(1) },
  // 灯の点の差し替え: 鳥居の石段は奥 1、建った鍛冶屋は提灯 2、建った蔵は窓 5、灯籠は火袋 1、ほかは無し
  townObjectGlows: (kind: TownObjectKind) => {
    if (kind.type === "toriiSteps") return [{ x: 2, y: 3, kind: "gate" }];
    if (kind.type === "lantern") return [{ x: 2, y: 2, kind: "lantern" }];
    if (kind.type !== "lot" || !kind.built) return [];
    if (kind.lot === "forge") return [{ x: 1, y: 2, kind: "lantern" }, { x: 3, y: 2, kind: "lantern" }];
    if (kind.lot === "archive") return [0, 1, 2, 3, 4].map((i) => ({ x: i, y: 3, kind: "window" }));
    return [];
  },
}));

const T = TILE_SIZE;

/** 設計（docs/ideas/hub-town-impl.md 3 章）に近い手組みの配置。A レーンの本物には依存しない */
const LOTS: Readonly<Record<HubLotKey, Rect>> = {
  shrine: { x: 3, y: 1, w: 5, h: 3 },
  hall: { x: 22, y: 1, w: 5, h: 3 },
  forge: { x: 2, y: 6, w: 5, h: 3 },
  library: { x: 22, y: 6, w: 5, h: 3 },
  well: { x: 9, y: 6, w: 2, h: 2 },
  board: { x: 19, y: 10, w: 2, h: 1 },
  archive: { x: 2, y: 13, w: 9, h: 3 },
  garden: { x: 3, y: 19, w: 6, h: 3 },
  rackShed: { x: 19, y: 13, w: 3, h: 2 },
  yard: { x: 18, y: 12, w: 11, h: 11 },
};

function belowLot(lot: Rect, dx = 0): { x: number; y: number } {
  return { x: (lot.x + lot.w / 2 + dx) * T, y: (lot.y + lot.h + 0.5) * T };
}

function fixtureLayout(): HubLayout {
  const map = createMap(30, 24);
  map.tiles.fill(Tile.Floor);
  const spots = {
    well: belowLot(LOTS.well),
    board: belowLot(LOTS.board),
    forge: belowLot(LOTS.forge),
    library: belowLot(LOTS.library),
    altar: belowLot(LOTS.shrine),
    garden: belowLot(LOTS.garden),
    history: belowLot(LOTS.archive, -3),
    codex: belowLot(LOTS.archive),
    achievements: belowLot(LOTS.archive, 3),
    rack: belowLot(LOTS.rackShed),
    hall: belowLot(LOTS.hall),
    dojo: { x: (LOTS.yard.x + 5.5) * T, y: (LOTS.yard.y + LOTS.yard.h - 0.5) * T },
  } satisfies Record<HubSpotKey, { x: number; y: number }>;
  const slot = (tx: number, ty: number): { x: number; y: number } => ({ x: (tx + 0.5) * T, y: (ty + 1) * T });
  return {
    map,
    ground: map,
    spots,
    dummySpots: [],
    playerStart: { x: 15 * T, y: 6 * T },
    lots: LOTS,
    gate: { x: 12, y: 1, w: 6, h: 3 },
    gateZone: { x: 13, y: 1, w: 4, h: 2 },
    roads: [
      { x: 13, y: 3, w: 4, h: 20 },
      { x: 1, y: 11, w: 28, h: 1 },
    ],
    lanternSlots: [slot(11, 5), slot(18, 5), slot(12, 9), slot(17, 9), slot(12, 13), slot(17, 13), slot(12, 17), slot(17, 17)],
    clutterSlots: [slot(17, 10), slot(8, 12), slot(16, 15), slot(11, 4)],
  };
}

function look(over: Partial<TownLook> = {}): TownLook {
  return {
    key: "k",
    built: new Set<FacilityKey>(),
    lanterns: 0,
    wellTier: 0,
    trophies: [],
    hallLit: false,
    archiveLights: 0,
    stele: 0,
    deepestChapter: 1,
    bustle: 0,
    title: null,
    ...over,
  };
}

const ALL_BUILT = new Set<FacilityKey>(FACILITY_KEYS);

function view(layout: HubLayout, lk: TownLook, near: HubSpotKey | null = null): TownHubView {
  return { spots: layout.spots, available: new Set<HubSpotKey>(HUB_SPOT_KEYS), near, town: { layout, look: lk } };
}

describe("buildTownPlacements（描く物の配置）", () => {
  const layout = fixtureLayout();

  it("矩形が空の拠点（段 0 の仮の配置）では何も置かない", () => {
    const empty = { ...layout, lots: Object.fromEntries(HUB_LOT_KEYS.map((k) => [k, { x: 0, y: 0, w: 0, h: 0 }])) as Record<HubLotKey, Rect>, gate: { x: 0, y: 0, w: 0, h: 0 } };
    expect(buildTownPlacements(empty, look({ lanterns: 3, bustle: 2 })).filter((p) => p.kind.type !== "lantern" && p.kind.type !== "clutter")).toEqual([]);
  });

  it("敷地 10 + 鳥居が置かれ、建物の足元は敷地の下辺中央（井戸は井戸の絵）", () => {
    const list = buildTownPlacements(layout, look());
    for (const lot of HUB_LOT_KEYS) {
      const p = list.find((x) => x.id === `lot:${lot}`);
      expect(p, `${lot} の配置`).toBeDefined();
      const rect = LOTS[lot];
      expect(p?.footX, `${lot} の足元の x`).toBe((rect.x + rect.w / 2) * T);
      expect(p?.footY, `${lot} の足元の y`).toBe((rect.y + rect.h) * T);
    }
    expect(list.find((p) => p.id === "lot:well")?.kind.type, "井戸は well の絵").toBe("well");
    expect(list.filter((p) => p.kind.type === "torii").length, "鳥居").toBe(1);
  });

  it("鳥居の石段は地面の物で、石段の上に立つプレイヤーより常に奥に描き、柱より先に描く", () => {
    const list = buildTownPlacements(layout, look());
    const steps = list.find((p) => p.kind.type === "toriiSteps");
    const torii = list.find((p) => p.kind.type === "torii");
    if (!steps || !torii) throw new Error("鳥居の配置が無い");
    expect(steps.flat, "石段は地面の物").toBe(true);
    expect(torii.flat, "柱は立つ物").toBe(false);
    const onStairsFeetY = steps.footY - T;
    expect(isBehindPlayer(steps, onStairsFeetY), "石段の上でも体は隠れない").toBe(true);
    expect(isBehindPlayer(torii, onStairsFeetY), "柱と笠木は手前").toBe(false);
    expect(list.indexOf(steps), "石段が先").toBeLessThan(list.indexOf(torii));
  });

  it("建っているかは設備の対応（FACILITY_OF_LOT）で決まり、絵の鍵が分かれる", () => {
    const lk = look({ built: new Set<FacilityKey>(["forge"]) });
    const list = buildTownPlacements(layout, lk);
    const forge = list.find((p) => p.id === "lot:forge");
    const library = list.find((p) => p.id === "lot:library");
    expect(forge?.kind).toEqual({ type: "lot", lot: "forge", built: true });
    expect(library?.kind).toEqual({ type: "lot", lot: "library", built: false });
    expect(forge?.art).not.toBe(library?.art);
  });

  it("井戸の段は TownLook.wellTier から", () => {
    const list = buildTownPlacements(layout, look({ wellTier: 3 }));
    expect(list.find((p) => p.id === "lot:well")?.kind).toEqual({ type: "well", tier: 3 });
  });

  it("灯籠・小物は lanternSlots / clutterSlots の前から、景色の数と枠の少ないほうだけ", () => {
    const count = (kind: string, lk: TownLook): number => buildTownPlacements(layout, lk).filter((p) => p.kind.type === kind).length;
    expect(count("lantern", look({ lanterns: 0 })), "灯籠 0").toBe(0);
    expect(count("lantern", look({ lanterns: 3 })), "灯籠 3").toBe(3);
    expect(count("lantern", look({ lanterns: 99 })), "枠が 8").toBe(layout.lanternSlots.length);
    expect(count("clutter", look({ bustle: 2 })), "賑わい 2").toBe(2);
    expect(count("clutter", look({ bustle: 99 })), "枠が 4").toBe(layout.clutterSlots.length);
    const first = buildTownPlacements(layout, look({ lanterns: 1 })).find((p) => p.kind.type === "lantern");
    expect(first?.footX).toBe(layout.lanternSlots[0]?.x);
  });

  it("幟は倒したボスの数だけ御堂の前に並び、踏破の碑は位階があるときだけ鳥居の脇", () => {
    const list = buildTownPlacements(layout, look({ trophies: [1, 2, 4], stele: 2 }));
    const trophies = list.filter((p) => p.kind.type === "trophy");
    expect(trophies.map((p) => p.kind.type === "trophy" && p.kind.chapter)).toEqual([1, 2, 4]);
    const hallBottom = (LOTS.hall.y + LOTS.hall.h) * T;
    for (const t of trophies) expect(t.footY, "御堂の下辺").toBe(hallBottom);
    const stele = list.find((p) => p.kind.type === "stele");
    expect(stele?.kind).toEqual({ type: "stele", tier: 2 });
    expect(stele?.footX).toBe(stelePosition(layout.gate).x);
    expect(buildTownPlacements(layout, look()).some((p) => p.kind.type === "stele"), "位階 0 は碑なし").toBe(false);
  });

  it("足元の y の昇順に並び、同じ入力なら同じ並び", () => {
    const lk = look({ built: ALL_BUILT, lanterns: 8, bustle: 4, trophies: [1, 2], stele: 1, wellTier: 2 });
    const a = buildTownPlacements(layout, lk);
    const b = buildTownPlacements(layout, lk);
    expect(a.map((p) => p.id)).toEqual(b.map((p) => p.id));
    for (let i = 1; i < a.length; i++) expect(a[i - 1]?.footY ?? 0, `${i} 番目`).toBeLessThanOrEqual(a[i]?.footY ?? 0);
  });

  it("絵の鍵は同じ見た目で同じ（灯籠 8 本は 1 つの絵を共有）", () => {
    const list = buildTownPlacements(layout, look({ lanterns: 8 }));
    expect(new Set(list.filter((p) => p.kind.type === "lantern").map((p) => p.art)).size).toBe(1);
    expect(townArtKey({ type: "lot", lot: "forge", built: true })).not.toBe(townArtKey({ type: "lot", lot: "forge", built: false }));
    expect(townArtKey({ type: "well", tier: 0 })).not.toBe(townArtKey({ type: "well", tier: 1 }));
  });
});

describe("isBehindPlayer（体との前後）", () => {
  it("足元の y がプレイヤーの足元以下なら奥（先に描く）、それより下なら手前", () => {
    expect(isBehindPlayer({ footY: 100, flat: false }, 120), "物が上").toBe(true);
    expect(isBehindPlayer({ footY: 120, flat: false }, 120), "同じ y は奥").toBe(true);
    expect(isBehindPlayer({ footY: 121, flat: false }, 120), "物が下").toBe(false);
  });

  it("地面の物（稽古場）は体の位置に関わらず常に奥", () => {
    const yard = buildTownPlacements(fixtureLayout(), look()).find((p) => p.id === "lot:yard");
    expect(yard?.flat).toBe(true);
    expect(isBehindPlayer({ footY: 999, flat: true }, 0)).toBe(true);
  });

  it("どの物も奥か手前のどちらか一方に入り、プレイヤーを物の南から北へ動かすと奥 → 手前へ入れ替わる", () => {
    const list = buildTownPlacements(fixtureLayout(), look({ built: ALL_BUILT, lanterns: 8, bustle: 4 }));
    const behind = (feetY: number): number => list.filter((p) => isBehindPlayer(p, feetY)).length;
    expect(behind(0), "北端では地面の物だけが奥").toBe(list.filter((p) => p.flat).length);
    expect(behind(24 * T), "南端では全部が奥").toBe(list.length);
    for (let y = 0; y < 24 * T; y += T) expect(behind(y), `y=${y}`).toBeLessThanOrEqual(behind(y + T));
  });
});

describe("trophyPositions / stelePosition", () => {
  it("幟は御堂の中央を軸に左右対称に並ぶ", () => {
    const hall = LOTS.hall;
    const cx = (hall.x + hall.w / 2) * T;
    for (const n of [1, 2, 5, 6]) {
      const xs = trophyPositions(hall, n).map((p) => p.x);
      expect(xs.length).toBe(n);
      expect(xs.reduce((a, b) => a + b, 0) / n, `${n} 本の重心`).toBeCloseTo(cx, 5);
    }
    expect(trophyPositions(hall, 0)).toEqual([]);
  });

  it("碑は鳥居の矩形の左外・足元の行", () => {
    const gate = fixtureLayout().gate;
    const at = stelePosition(gate);
    expect(at.x).toBeLessThan(gate.x * T);
    expect(at.y).toBe((gate.y + gate.h) * T);
  });
});

describe("buildTownLabels（名札）", () => {
  const layout = fixtureLayout();

  it("全設備に名札が出る（建っていなくても）。記録の蔵は建っていれば扉ごとの 3 枚", () => {
    const labels = buildTownLabels(layout, look({ built: ALL_BUILT }));
    for (const lot of HUB_LOT_KEYS) {
      if (lot === "archive") continue;
      const name = FACILITY_NAME[FACILITY_OF_LOT[lot]];
      expect(labels.some((l) => l.text === name), `${lot} の名札`).toBe(true);
    }
    const doors = labels.filter((l) => l.spot === "history" || l.spot === "codex" || l.spot === "achievements");
    expect(doors.length, "蔵の扉の小札").toBe(3);
    expect(labels.some((l) => l.spot === "dojo"), "稽古の間の入口の小札").toBe(true);
    expect(labels.length, "名札の総数（9 設備 + 蔵の扉 3 - 蔵 1 + 稽古の間 1）").toBe(HUB_LOT_KEYS.length - 1 + 3 + 1);
  });

  it("未建設は「（建設予定）」付きで built = false。建っていれば付かない。井戸は常に建っている扱い", () => {
    const labels = buildTownLabels(layout, look({ built: new Set<FacilityKey>(["forge"]) }));
    const forge = labels.find((l) => l.text === FACILITY_NAME.forge);
    expect(forge?.built).toBe(true);
    const library = labels.find((l) => l.text.startsWith(FACILITY_NAME.library));
    expect(library?.built).toBe(false);
    expect(library?.text).toContain("建設予定");
    expect(labels.find((l) => l.text === FACILITY_NAME.well)?.built, "井戸").toBe(true);
    expect(labels.some((l) => l.spot === "history"), "未建設の蔵は扉ごとに分けない").toBe(false);
    const archive = labels.find((l) => l.text.startsWith(FACILITY_NAME.archive));
    expect(archive?.x, "敷地の中央").toBe((LOTS.archive.x + LOTS.archive.w / 2) * T);
  });

  it("名札の x は台の x、y は敷地の下辺の少し上（扉の上）。稽古場だけ台が無く敷地の上辺", () => {
    const labels = buildTownLabels(layout, look({ built: ALL_BUILT }));
    const forge = labels.find((l) => l.spot === "forge");
    expect(forge?.x).toBe(layout.spots.forge.x);
    expect(forge?.y).toBeLessThan((LOTS.forge.y + LOTS.forge.h) * T);
    expect(forge?.y).toBeGreaterThan(LOTS.forge.y * T);
    const yard = labels.find((l) => l.spot === null);
    expect(yard?.text).toBe(FACILITY_NAME.training);
    expect(yard?.y).toBeLessThan((LOTS.yard.y + 2) * T);
  });
});

describe("buildTownGlows（発光）", () => {
  const layout = fixtureLayout();
  const glowsOf = (kind: TownObjectKind): number => townObjectGlows(kind).length;

  it("灯は絵が返す灯の点から。建っていない建物・井戸は光らず、何も無ければ石段の奥の灯だけ", () => {
    const base = buildTownGlows(layout, look());
    expect(base.length, "鳥居の石段の灯の点の数").toBe(glowsOf({ type: "toriiSteps" }));
    const forge = buildTownGlows(layout, look({ built: new Set<FacilityKey>(["forge"]) }));
    expect(forge.length - base.length, "鍛冶屋の絵の灯の点の数").toBe(glowsOf({ type: "lot", lot: "forge", built: true }));
    expect(glowsOf({ type: "lot", lot: "forge", built: true }), "鍛冶屋には灯がある").toBeGreaterThan(0);
    const added = forge.filter((g) => !base.some((b) => b.x === g.x && b.y === g.y));
    for (const g of added) {
      expect(g.x, "鍛冶屋の灯は敷地の横幅の中").toBeGreaterThanOrEqual(LOTS.forge.x * T);
      expect(g.x).toBeLessThanOrEqual((LOTS.forge.x + LOTS.forge.w) * T);
    }
    const well = buildTownGlows(layout, look({ built: new Set<FacilityKey>(["well"]) }));
    expect(well.length, "井戸は光らない").toBe(base.length);
  });

  it("参道の灯籠は 1 基ごとに灯籠の絵の灯の数だけ、御堂の篝火は hallLit のときだけ 2 つ増える", () => {
    const base = buildTownGlows(layout, look()).length;
    expect(buildTownGlows(layout, look({ lanterns: 4 })).length - base).toBe(4 * glowsOf({ type: "lantern" }));
    expect(buildTownGlows(layout, look({ hallLit: true })).length - base).toBe(2);
  });

  it("石段の奥の灯は最深の章の色で、章が深いほど別の色", () => {
    const gate = (chapter: number): string | undefined => buildTownGlows(layout, look({ deepestChapter: chapter })).find((g) => g.r === 40)?.color;
    expect(new Set([1, 2, 3, 4].map(gate)).size, "章 1〜4 で色が違う").toBe(4);
    expect(gate(99), "範囲外は最後の色").toBe(gate(4));
  });
  it("位相は座標のハッシュ（同じ配置なら同じ）で、揺らぎは 0.8〜1 の範囲を time で往復する", () => {
    const a = buildTownGlows(layout, look({ lanterns: 3 }));
    const b = buildTownGlows(layout, look({ lanterns: 3 }));
    expect(a.map((g) => g.phase)).toEqual(b.map((g) => g.phase));
    for (let t = 0; t < 10; t += 0.37) {
      const f = glowFlicker(t, 1.2);
      expect(f).toBeLessThanOrEqual(1);
      expect(f).toBeGreaterThanOrEqual(0.8);
    }
    expect(glowFlicker(0, 0)).not.toBe(glowFlicker(0.4, 0));
  });

  it("記録の蔵の窓は左から archiveLights 個だけ灯る", () => {
    const built = new Set<FacilityKey>(["archive"]);
    const none = buildTownGlows(layout, look({ built, archiveLights: 0 })).length;
    const two = buildTownGlows(layout, look({ built, archiveLights: 2 })).length;
    expect(two - none).toBe(2);
  });
});

describe("発光の絵", () => {
  it("中心ほど濃い段つきの円で、縁の外は透明", () => {
    expect(glowLevel(0)).toBe(1);
    expect(glowLevel(0.5)).toBeLessThan(glowLevel(0));
    expect(glowLevel(0.95), "縁の近く").toBeLessThan(glowLevel(0.5));
    expect(glowLevel(1)).toBe(0);
    for (let d = 0; d < 1; d += 0.05) expect(glowLevel(d + 0.05), `d=${d}`).toBeLessThanOrEqual(glowLevel(d));
    const dots = 48;
    const px = glowPixels("#ffcf8a", dots);
    expect(px.length).toBe(dots * dots);
    expect(px[0], "四隅は透明").toBe(0);
    const center = px[(dots / 2) * dots + dots / 2] ?? 0;
    expect(center >>> 24, "中心は不透明").toBe(255);
    expect(center & 0xff, "色は #ffcf8a の R").toBe(0xff);
  });
});

describe("参道の石畳の焼き付け", () => {
  const layout = fixtureLayout();

  it("矩形の外接の大きさで、石畳のドットは全部不透明。矩形が空なら null", () => {
    const baked = bakeRoadPixels(layout.roads, 30, 24);
    expect(baked).not.toBeNull();
    expect(baked?.x).toBe(1 * TILE_DOTS);
    expect(baked?.y).toBe(3 * TILE_DOTS);
    expect(baked?.w).toBe(28 * TILE_DOTS);
    expect(baked?.h).toBe(20 * TILE_DOTS);
    expect(bakeRoadPixels([], 30, 24)).toBeNull();
    expect(bakeRoadPixels([{ x: 1, y: 1, w: 0, h: 3 }], 30, 24)).toBeNull();
  });

  it("石畳の中は不透明、石畳でないドット（外接の中の余白）は透明", () => {
    const baked = bakeRoadPixels(layout.roads, 30, 24);
    if (!baked) throw new Error("焼けていない");
    const at = (tx: number, ty: number): number => baked.pixels[(ty * TILE_DOTS - baked.y + 5) * baked.w + (tx * TILE_DOTS - baked.x + 5)] ?? 0;
    expect(at(14, 8) >>> 24, "参道の中").toBe(255);
    expect(at(5, 11) >>> 24, "辻の中").toBe(255);
    expect(at(5, 8), "参道でも辻でもない").toBe(0);
  });

  it("石畳の縁は輪郭の暗い色になり、同じ入力なら同じ画素", () => {
    const a = bakeRoadPixels(layout.roads, 30, 24);
    const b = bakeRoadPixels(layout.roads, 30, 24);
    expect(a?.pixels).toEqual(b?.pixels);
    if (!a) throw new Error("焼けていない");
    const left = 13 * TILE_DOTS - a.x;
    const top = 8 * TILE_DOTS - a.y;
    const edge = a.pixels[top * a.w + left] ?? 0;
    const inner = a.pixels[top * a.w + left + 6] ?? 0;
    const lum = (c: number): number => (c & 255) + ((c >>> 8) & 255) + ((c >>> 16) & 255);
    expect(lum(edge), "縁は内側より暗い").toBeLessThan(lum(inner));
  });

  it("予算の刻み方に依らず結果は同じ。小さい予算なら複数回に分かれる", () => {
    const whole = bakeRoadPixels(layout.roads, 30, 24);
    const job = createRoadBake(layout.roads, 30, 24);
    let calls = 0;
    while (!job.done) {
      job.step(ROAD_DOTS_PER_FRAME);
      calls++;
    }
    expect(calls, "1 フレームでは焼き切れない").toBeGreaterThan(1);
    expect(job.result()?.pixels).toEqual(whole?.pixels);
  });
});

/** canvas を作らずに数えるだけの絵の作り手 */
function fakeFactory(): { made: { w: number; h: number }[]; make: (p: Uint32Array, w: number, h: number) => CanvasImageSource } {
  const made: { w: number; h: number }[] = [];
  return {
    made,
    make: (_p, w, h) => {
      made.push({ w, h });
      return { w, h } as unknown as CanvasImageSource;
    },
  };
}

interface Call {
  op: string;
  args: unknown[];
}

function fakeCtx(): { ctx: CanvasRenderingContext2D; calls: Call[] } {
  const calls: Call[] = [];
  const rec =
    (op: string) =>
    (...args: unknown[]): void => {
      calls.push({ op, args });
    };
  const ctx = { globalAlpha: 1, fillStyle: "", globalCompositeOperation: "source-over", drawImage: rec("drawImage"), fillRect: rec("fillRect"), save: rec("save"), restore: rec("restore") };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

function fakeState(feetY: number): GameState {
  return { time: 3, camera: { pos: { x: 15 * T, y: 12 * T }, offset: { x: 0, y: 0 } }, player: { body: { pos: { x: 15 * T, y: feetY - 6 }, radius: 6 } } } as unknown as GameState;
}

describe("TownLayer（絵の作り直しとフレーム分け）", () => {
  it("道は ROAD_DOTS_PER_FRAME ずつ数フレームかけて焼き、物の絵は 1 フレーム TOWN_ART_PER_FRAME 枚まで", () => {
    art.real = true;
    const f = fakeFactory();
    const layer = new TownLayer(f.make);
    const v = view(fixtureLayout(), look({ built: ALL_BUILT, lanterns: 8, bustle: 4, trophies: [1, 2, 3], stele: 1, wellTier: 2 }));
    layer.prepare(v);
    expect(f.made.length, "最初のフレームの絵の数").toBeLessThanOrEqual(TOWN_ART_PER_FRAME);
    expect(layer.pendingCount, "まだ作り終わっていない").toBeGreaterThan(0);
    expect(layer.hasRoad, "道はまだ").toBe(false);
    let frames = 1;
    while (layer.pendingCount > 0 && frames < 100) {
      layer.prepare(v);
      frames++;
    }
    expect(frames, "有限のフレームで終わる").toBeLessThan(100);
    expect(layer.hasRoad, "道が出来た").toBe(true);
    // 灯籠 8 本は同じ絵 1 枚、鍵の種類 = 敷地 10（井戸は well の絵）+ 鳥居 + 灯籠 + 幟 3 + 碑 + 小物 4 + 道 1
    const placements = buildTownPlacements(v.town.layout, v.town.look);
    const keys = new Set(placements.map((p) => p.art));
    expect(f.made.length, "絵の canvas の数 = 鍵の数 + 道").toBe(keys.size + 1);
  });

  it("1 フレームに描く口を全部通しても、焼き進めるのは 1 フレームぶんだけ", () => {
    art.real = true;
    const v = view(fixtureLayout(), look({ built: ALL_BUILT, lanterns: 8, bustle: 4, trophies: [1, 2, 3], stele: 1, wellTier: 2 }));
    const once = new TownLayer(fakeFactory().make);
    once.prepare(v);
    const layer = new TownLayer(fakeFactory().make);
    const { ctx } = fakeCtx();
    const state = fakeState(10 * T);
    layer.drawRoads(ctx, v);
    layer.drawBack(ctx, state, v);
    layer.drawFront(ctx, state, v);
    layer.drawGlow(ctx, state, v);
    expect(layer.pendingCount, "残りは prepare 1 回と同じ").toBe(once.pendingCount);
    expect(layer.pendingCount, "まだ作り終わっていない").toBeGreaterThan(0);
  });

  it("TownLook.key が同じなら作り直さず、変わった時だけ物の絵を作り直す（道は作り直さない）", () => {
    art.real = true;
    const f = fakeFactory();
    const layer = new TownLayer(f.make);
    const layout = fixtureLayout();
    const a = view(layout, look({ key: "a", built: ALL_BUILT }));
    for (let i = 0; i < 40; i++) layer.prepare(a);
    const done = f.made.length;
    for (let i = 0; i < 5; i++) layer.prepare(a);
    expect(f.made.length, "同じ key では増えない").toBe(done);
    const b = view(layout, look({ key: "b", built: new Set<FacilityKey>(["forge"]) }));
    for (let i = 0; i < 40; i++) layer.prepare(b);
    const keys = new Set(buildTownPlacements(layout, b.town.look).map((p) => p.art));
    expect(f.made.length - done, "key が変わると物の絵だけ作り直す").toBe(keys.size);
  });

  it("配置（HubLayout）が別物になったら道も焼き直す", () => {
    art.real = false;
    const f = fakeFactory();
    const layer = new TownLayer(f.make);
    for (const layout of [fixtureLayout(), fixtureLayout()]) {
      const v = view(layout, look());
      for (let i = 0; i < 40; i++) layer.prepare(v);
    }
    expect(f.made.filter((m) => m.w === 28 * TILE_DOTS).length, "道の canvas は配置ごとに 1 枚").toBe(2);
  });

  it("体より奥と手前の描画は重ならず、合わせて全部の物を 1 回ずつ描く（絵がある場合は drawImage）", () => {
    art.real = true;
    const f = fakeFactory();
    const layer = new TownLayer(f.make);
    const v = view(fixtureLayout(), look({ built: ALL_BUILT, lanterns: 4 }));
    for (let i = 0; i < 40; i++) layer.prepare(v);
    const placements = buildTownPlacements(v.town.layout, v.town.look);
    const feetY = 10 * T;
    const back = fakeCtx();
    layer.drawBack(back.ctx, fakeState(feetY), v);
    const front = fakeCtx();
    layer.drawFront(front.ctx, fakeState(feetY), v);
    const behind = placements.filter((p) => isBehindPlayer(p, feetY)).length;
    // 画面の外の物は描かない（カメラは 480x270）ので、描いた数は配置の数以下
    expect(back.calls.filter((c) => c.op === "drawImage").length, "奥").toBeLessThanOrEqual(behind);
    expect(front.calls.filter((c) => c.op === "drawImage").length, "手前").toBeLessThanOrEqual(placements.length - behind);
    expect(back.calls.length + front.calls.length, "何かは描く").toBeGreaterThan(0);
  });

  it("絵が 1 ドット（仮）の物は敷地の矩形を色の箱で描く", () => {
    art.real = false;
    const f = fakeFactory();
    const layer = new TownLayer(f.make);
    const v = view(fixtureLayout(), look({ built: ALL_BUILT }));
    for (let i = 0; i < 40; i++) layer.prepare(v);
    const { ctx, calls } = fakeCtx();
    layer.drawBack(ctx, fakeState(24 * T), v);
    const boxes = calls.filter((c) => c.op === "fillRect");
    expect(boxes.length, "仮の箱を描く").toBeGreaterThan(0);
    expect(calls.some((c) => c.op === "drawImage"), "canvas は作らない").toBe(false);
    const forge = LOTS.forge;
    expect(boxes.some((c) => c.args[0] === forge.x * T && c.args[1] === forge.y * T && c.args[2] === forge.w * T), "鍛冶屋の敷地の箱").toBe(true);
  });

  it("発光は加算合成で描き、描き終えたら元の合成と透明度に戻す", () => {
    art.real = false;
    const f = fakeFactory();
    const layer = new TownLayer(f.make);
    const v = view(fixtureLayout(), look({ built: ALL_BUILT, lanterns: 2 }));
    for (let i = 0; i < 40; i++) layer.prepare(v);
    const { ctx, calls } = fakeCtx();
    layer.drawGlow(ctx, fakeState(24 * T), v);
    expect(calls[0]?.op).toBe("save");
    expect(calls[calls.length - 1]?.op).toBe("restore");
    expect(calls.filter((c) => c.op === "drawImage").length, "発光を描いた").toBeGreaterThan(0);
  });
});

describe("MAP_DOTS", () => {
  it("1 ドット = 0.5px（道の canvas の論理寸法の前提）", () => {
    expect(MAP_DOTS).toBe(2);
  });
});
