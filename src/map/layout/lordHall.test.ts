import { describe, expect, it } from "vitest";
import { BOSS, LORD_HALL } from "../../data/tuning";
import { type GameMap, Tile, TILE_SIZE, getTile, isPassableTile, rectCenter } from "../grid";
import { LORD_HALL_OF, type LordHallKey, generateLordHallMap, lordHallKeyOf } from "./lordHall";
import { LORD_ANTE_GRID, LORD_ENTRY_GRID, LORD_HALL_GRIDS } from "./lordHallGrids";

const KEYS = Object.keys(LORD_HALL_GRIDS) as LordHallKey[];
/** 各間の代表のボス key（表の逆引き） */
const BOSS_OF: Readonly<Record<LordHallKey, string>> = {
  alcoves: "kingSlime",
  pits: "thiefKing",
  pillars: "oilKing",
  island: "mirrorKnight",
  plain: "deepLord",
};
const ALLOWED = new Set(["#", ".", "@", ",", "_", "o", "~"]);
const LORD_STEP = 4;
const NEIGHBORS_8 = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
] as const;
const NEIGHBORS_4 = NEIGHBORS_8.slice(0, 4);

/** 主の間（最後の部屋）の rect と中心 */
function hallOf(map: GameMap) {
  const rect = map.rooms[2];
  if (!rect) throw new Error("主の間が無い");
  return { rect, center: rectCenter(rect) };
}

function floorAt(map: GameMap, x: number, y: number): boolean {
  return getTile(map, x, y) === Tile.Floor;
}

/** 4 近傍で (from) から (to) に歩けるか。blocked のタイルは通れない */
function canWalk(map: GameMap, from: { x: number; y: number }, to: { x: number; y: number }, blocked: ReadonlySet<number> = new Set()): boolean {
  const seen = new Set<number>([from.y * map.width + from.x]);
  const queue = [from];
  for (let head = 0; head < queue.length; head++) {
    const p = queue[head];
    if (!p) continue;
    if (p.x === to.x && p.y === to.y) return true;
    for (const [dx, dy] of NEIGHBORS_4) {
      const x = p.x + dx;
      const y = p.y + dy;
      const i = y * map.width + x;
      if (seen.has(i) || blocked.has(i) || !isPassableTile(getTile(map, x, y))) continue;
      seen.add(i);
      queue.push({ x, y });
    }
  }
  return false;
}

/** 2x2 の体が (from) の窓から (to) を含む窓へ歩けるか */
function canWalkWindow(map: GameMap, from: { x: number; y: number }, to: { x: number; y: number }): boolean {
  const fits = (x: number, y: number): boolean => [0, 1].every((dy) => [0, 1].every((dx) => isPassableTile(getTile(map, x + dx, y + dy))));
  const seen = new Set<number>([from.y * map.width + from.x]);
  const queue = [from];
  for (let head = 0; head < queue.length; head++) {
    const p = queue[head];
    if (!p) continue;
    if (p.x <= to.x && to.x <= p.x + 1 && p.y <= to.y && to.y <= p.y + 1) return true;
    for (const [dx, dy] of NEIGHBORS_4) {
      const x = p.x + dx;
      const y = p.y + dy;
      const i = y * map.width + x;
      if (seen.has(i) || !fits(x, y)) continue;
      seen.add(i);
      queue.push({ x, y });
    }
  }
  return false;
}

describe("ボス階の格子（lordHallGrids）", () => {
  const all: [string, readonly string[]][] = [
    ...KEYS.map((k): [string, readonly string[]] => [`主の間 ${k}`, LORD_HALL_GRIDS[k]]),
    ["入口の間", LORD_ENTRY_GRID],
    ["前室", LORD_ANTE_GRID],
  ];

  it.each(all)("%s は行の幅が揃い、使える文字だけで書かれている", (_name, grid) => {
    const width = grid[0]?.length ?? 0;
    expect(width, "幅が 0").toBeGreaterThan(0);
    for (const line of grid) {
      expect(line.length, "行の幅が揃わない").toBe(width);
      for (const ch of line) expect(ALLOWED.has(ch), `使えない文字 ${ch}`).toBe(true);
    }
  });

  it.each(KEYS)("主の間 %s は主の立つ所（@）がちょうど 1 つ", (key) => {
    const count = LORD_HALL_GRIDS[key].join("").split("@").length - 1;
    expect(count).toBe(1);
  });

  it("入口の間は 7x7、前室は 15x9", () => {
    expect([LORD_ENTRY_GRID[0]?.length, LORD_ENTRY_GRID.length]).toEqual([7, 7]);
    expect([LORD_ANTE_GRID[0]?.length, LORD_ANTE_GRID.length]).toEqual([15, 9]);
  });
});

describe("ボスと間の対応", () => {
  it("章ボス 4 体は専用の間、最深の主と表に無い key は plain", () => {
    expect(lordHallKeyOf("kingSlime")).toBe("alcoves");
    expect(lordHallKeyOf("thiefKing")).toBe("pits");
    expect(lordHallKeyOf("oilKing")).toBe("pillars");
    expect(lordHallKeyOf("mirrorKnight")).toBe("island");
    expect(lordHallKeyOf("deepLord")).toBe("plain");
    expect(lordHallKeyOf("存在しないボス")).toBe("plain");
  });

  it("表の値はすべて格子を持つ間の key", () => {
    for (const key of Object.values(LORD_HALL_OF)) expect(KEYS).toContain(key);
  });
});

describe.each(KEYS)("ボス階の地図（間 %s）", (key) => {
  const map = generateLordHallMap(BOSS_OF[key]);
  const { rect, center } = hallOf(map);

  it("部屋は 3 つで、入口 → 前室 → 主の間の順（左から右）", () => {
    expect(map.rooms).toHaveLength(3);
    const xs = map.rooms.map((r) => r.x);
    expect(xs[0] ?? 0).toBeLessThan(xs[1] ?? 0);
    expect(xs[1] ?? 0).toBeLessThan(xs[2] ?? 0);
    expect(map.layout).toBe("lordHall");
  });

  it("全部屋が roomTiles を持ち、所属タイルは床で、階段はまだ無い", () => {
    expect(map.roomTiles).toHaveLength(3);
    for (const tiles of map.roomTiles ?? []) {
      expect(tiles.length).toBeGreaterThan(0);
      for (const i of tiles) expect(map.tiles[i], "所属タイルが床でない（穴・壁の上）").toBe(Tile.Floor);
    }
    expect(map.tiles.includes(Tile.StairsDown)).toBe(false);
  });

  it("部屋どうしは 8 近傍で接しない", () => {
    const owner = new Map<number, number>();
    (map.roomTiles ?? []).forEach((tiles, room) => tiles.forEach((i) => owner.set(i, room)));
    for (const [i, room] of owner) {
      const x = i % map.width;
      const y = Math.floor(i / map.width);
      for (const [dx, dy] of NEIGHBORS_8) {
        const other = owner.get((y + dy) * map.width + x + dx);
        expect(other === undefined || other === room, "別の部屋と接している").toBe(true);
      }
    }
  });

  it("主の間の rect は奇数 x 奇数で、中心が主の立つ所（@）", () => {
    expect(rect.w % 2).toBe(1);
    expect(rect.h % 2).toBe(1);
    const grid = LORD_HALL_GRIDS[key];
    const row = grid.findIndex((line) => line.includes("@"));
    const col = grid[row]?.indexOf("@") ?? -1;
    // 主の間は margin の行から置かれる。桟道（,）は部屋に属さないので、床の左端の列を基準にする
    const leftmost = Math.min(...grid.map((line) => line.search(/[.@~]/)).filter((c) => c >= 0));
    expect(center.y).toBe(LORD_HALL.margin + row);
    expect(center.x - rect.x).toBe(col - leftmost);
    expect(map.roomTiles?.[2]).toContain(center.y * map.width + center.x);
  });

  it("中心 ±4 の 4 方向が床", () => {
    for (const [dx, dy] of NEIGHBORS_4) {
      expect(floorAt(map, center.x + dx * LORD_STEP, center.y + dy * LORD_STEP), `(${dx}, ${dy}) 方向の分岐が床でない`).toBe(true);
    }
  });

  it("入口の中心から主の間の中心まで歩ける", () => {
    expect(canWalk(map, rectCenter(map.rooms[0] ?? rect), center)).toBe(true);
  });

  it("2x2 の体で前室から主の間の中心まで歩ける", () => {
    expect(canWalkWindow(map, rectCenter(map.rooms[1] ?? rect), center)).toBe(true);
  });

  it("主の間の口は門の通路の幅 3 だけ（rect の西辺の外）で、2 マス内側は床", () => {
    const hallTiles = new Set(map.roomTiles?.[2] ?? []);
    const doors = new Set<number>();
    for (const i of hallTiles) {
      const x = i % map.width;
      const y = Math.floor(i / map.width);
      for (const [dx, dy] of NEIGHBORS_8) {
        const ni = (y + dy) * map.width + x + dx;
        if (!hallTiles.has(ni) && map.tiles[ni] === Tile.Floor) doors.add(ni);
      }
    }
    expect(doors.size).toBe(LORD_HALL.corridorWidth);
    for (const d of doors) expect(d % map.width, "扉が西辺の外でない").toBe(rect.x - 1);
    expect(floorAt(map, rect.x + 1, center.y), "扉から 2 マス内側が床でない").toBe(true);
    expect(floorAt(map, rect.x - 1, center.y)).toBe(true);
  });

  it("地図は 30x17 以上", () => {
    expect(map.width).toBeGreaterThanOrEqual(30);
    expect(map.height).toBeGreaterThanOrEqual(17);
  });

  it("同じ key なら同じタイル列と部屋（乱数を引かない）", () => {
    const again = generateLordHallMap(BOSS_OF[key]);
    expect(Array.from(again.tiles)).toEqual(Array.from(map.tiles));
    expect(again.rooms).toEqual(map.rooms);
    expect(again.roomTiles).toEqual(map.roomTiles);
  });
});

describe("地図の大きさ", () => {
  it("幅は余白 + 入口 + 参道 + 前室 + 門 + 主の間 + 余白、高さは主の間の行数 + 余白 2 つ", () => {
    for (const key of KEYS) {
      const map = generateLordHallMap(BOSS_OF[key]);
      const hall = LORD_HALL_GRIDS[key];
      const width = LORD_HALL.margin * 2 + 7 + LORD_HALL.entryLength + 15 + LORD_HALL.gateLength + (hall[0]?.length ?? 0);
      expect(map.width).toBe(width);
      expect(map.height).toBe(hall.length + LORD_HALL.margin * 2);
    }
  });
});

describe("スライム王の間（alcoves）", () => {
  const map = generateLordHallMap("kingSlime");
  const { rect, center } = hallOf(map);

  it("rect の四隅が床", () => {
    for (const x of [rect.x, rect.x + rect.w - 1]) {
      for (const y of [rect.y, rect.y + rect.h - 1]) expect(floorAt(map, x, y), `隅 (${x}, ${y})`).toBe(true);
    }
  });

  it("中央の膨張は窪みの外の床に届き、窪みごとに安全な床が 3 マス以上残る", () => {
    const px = (t: number): number => (t + 0.5) * TILE_SIZE;
    const middle = { x: (rect.x + rect.w / 2) * TILE_SIZE, y: (rect.y + rect.h / 2) * TILE_SIZE };
    let nearestCorner = Number.POSITIVE_INFINITY;
    for (const x of [rect.x, rect.x + rect.w]) {
      for (const y of [rect.y, rect.y + rect.h]) nearestCorner = Math.min(nearestCorner, Math.hypot(x * TILE_SIZE - middle.x, y * TILE_SIZE - middle.y));
    }
    const radius = nearestCorner * BOSS.kingSlime.cornerSafeRatio;
    const safe = (map.roomTiles?.[2] ?? []).filter((i) => Math.hypot(px(i % map.width) - middle.x, px(Math.floor(i / map.width)) - middle.y) > radius);
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        const inQuadrant = safe.filter((i) => Math.sign(px(i % map.width) - middle.x) === sx && Math.sign(px(Math.floor(i / map.width)) - middle.y) === sy);
        expect(inQuadrant.length, `象限 (${sx}, ${sy}) の安全な床`).toBeGreaterThanOrEqual(3);
        // 窪みは中央から遠い隅だけ（広間の中ほどは届く）
        for (const i of inQuadrant) {
          expect(Math.abs(i % map.width - center.x), "安全な床が広間の中ほどにある").toBeGreaterThanOrEqual(7);
          expect(Math.abs(Math.floor(i / map.width) - center.y), "enemies.BOSS.kingSlime.cornerSafeRatio: 安全な床は広間の隅にある").toBeGreaterThanOrEqual(4);
        }
      }
    }
  });
});

describe("盗賊王の間（pits）", () => {
  const map = generateLordHallMap("thiefKing");
  const { rect } = hallOf(map);
  const QUARTER = 0.25;
  const spots = [
    { x: Math.floor(rect.x + rect.w * QUARTER), y: Math.floor(rect.y + rect.h * QUARTER) },
    { x: Math.floor(rect.x + rect.w * (1 - QUARTER)), y: Math.floor(rect.y + rect.h * QUARTER) },
    { x: Math.floor(rect.x + rect.w * QUARTER), y: Math.floor(rect.y + rect.h * (1 - QUARTER)) },
    { x: Math.floor(rect.x + rect.w * (1 - QUARTER)), y: Math.floor(rect.y + rect.h * (1 - QUARTER)) },
  ];

  it("柵の角の 4 か所が床で、穴と重ならない", () => {
    for (const s of spots) expect(getTile(map, s.x, s.y), `(${s.x}, ${s.y})`).toBe(Tile.Floor);
  });

  it("どの 2 か所に L 字の柵を立てても床がつながる", () => {
    const middle = { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
    const fenceOf = (s: { x: number; y: number }): number[] => {
      const dx = s.x + 0.5 < middle.x ? 1 : -1;
      const dy = s.y + 0.5 < middle.y ? 1 : -1;
      const out: number[] = [];
      for (let i = 0; i < BOSS.thiefKing.fenceLen; i++) out.push(s.y * map.width + s.x + dx * i);
      for (let i = 1; i < BOSS.thiefKing.fenceLen; i++) out.push((s.y + dy * i) * map.width + s.x);
      return out;
    };
    const entry = rectCenter(map.rooms[1] ?? rect);
    const hallTiles = map.roomTiles?.[2] ?? [];
    let pairs = 0;
    for (let a = 0; a < spots.length; a++) {
      for (let b = a + 1; b < spots.length; b++) {
        const blocked = new Set([...fenceOf(spots[a] ?? rect), ...fenceOf(spots[b] ?? rect)]);
        for (const i of hallTiles) {
          if (blocked.has(i)) continue;
          expect(canWalk(map, entry, { x: i % map.width, y: Math.floor(i / map.width) }, blocked), `柵 ${a}・${b} で床が切れる`).toBe(true);
        }
        pairs++;
      }
    }
    expect(pairs).toBe(6);
  });
});

describe("油壺の王の間（pillars）", () => {
  it("最初の油溜まりの 4 点が床で、柱と重ならない", () => {
    const map = generateLordHallMap("oilKing");
    const { rect } = hallOf(map);
    const cx = (rect.x + rect.w / 2) * TILE_SIZE;
    const cy = (rect.y + rect.h / 2) * TILE_SIZE;
    const dist = Math.min(rect.w, rect.h) * TILE_SIZE * 0.3;
    for (let i = 0; i < 4; i++) {
      const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const tx = Math.floor((cx + Math.cos(angle) * dist) / TILE_SIZE);
      const ty = Math.floor((cy + Math.sin(angle) * dist) / TILE_SIZE);
      expect(getTile(map, tx, ty), `油溜まり ${i}`).toBe(Tile.Floor);
    }
  });

  it("柱は壁で、柱のタイルは部屋に属さない", () => {
    const map = generateLordHallMap("oilKing");
    const { rect } = hallOf(map);
    expect(getTile(map, rect.x + 3, rect.y + 3)).toBe(Tile.Wall);
    expect(map.roomTiles?.[2]).not.toContain((rect.y + 3) * map.width + rect.x + 3);
  });
});

describe("鏡の騎士の間（island）", () => {
  const map = generateLordHallMap("mirrorKnight");
  const { rect } = hallOf(map);

  it("rect は島の外接 15x15 で、桟道の端が rect.x - 1", () => {
    expect([rect.w, rect.h]).toEqual([15, 15]);
    expect(floorAt(map, rect.x - 1, rect.y + 7)).toBe(true);
    expect(map.roomTiles?.[2]).not.toContain((rect.y + 7) * map.width + rect.x - 1);
  });

  it("中心 ±70px（姿見の位置）が島の床", () => {
    const cx = (rect.x + rect.w / 2) * TILE_SIZE;
    const cy = (rect.y + rect.h / 2) * TILE_SIZE;
    const tiles = new Set(map.roomTiles?.[2] ?? []);
    for (const side of [-1, 1]) {
      const tx = Math.floor((cx + side * BOSS.mirrorKnight.paneOffset) / TILE_SIZE);
      const ty = Math.floor(cy / TILE_SIZE);
      expect(tiles.has(ty * map.width + tx), `姿見 ${side}`).toBe(true);
    }
  });

  it("島の縁は穴（Tile.Pit）に接している", () => {
    let pits = 0;
    for (const i of map.roomTiles?.[2] ?? []) {
      const x = i % map.width;
      const y = Math.floor(i / map.width);
      for (const [dx, dy] of NEIGHBORS_4) if (getTile(map, x + dx, y + dy) === Tile.Pit) pits++;
    }
    expect(pits).toBeGreaterThan(0);
  });
});

describe("最深の間（plain）", () => {
  it("rect の全マスが床で、部屋に属す", () => {
    const map = generateLordHallMap("deepLord");
    const { rect } = hallOf(map);
    const tiles = new Set(map.roomTiles?.[2] ?? []);
    expect([rect.w, rect.h]).toEqual([21, 15]);
    for (let y = rect.y; y < rect.y + rect.h; y++) {
      for (let x = rect.x; x < rect.x + rect.w; x++) expect(tiles.has(y * map.width + x), `(${x}, ${y})`).toBe(true);
    }
  });

  it("表に無い key でも同じ plain の地図になる", () => {
    const a = generateLordHallMap("deepLord");
    const b = generateLordHallMap("未知のボス");
    expect(Array.from(b.tiles)).toEqual(Array.from(a.tiles));
  });
});
