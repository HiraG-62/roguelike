import { describe, expect, it } from "vitest";
import { createRng } from "../../core/rng";
import {
  type Grid,
  addLoops,
  bfsDistances,
  blob,
  caStep,
  chaikin,
  clamp,
  connectAll,
  disc,
  farthestPair,
  h32,
  line,
  makeGrid,
  mstEdges,
  poisson,
  polyline,
  relax,
  sealBorder,
  segCross,
  tidy,
  vnoise,
  voronoiCarve,
  wander,
} from "./shapes";
import { Cell } from "./types";

/** '#' = 壁、'.' = 床、'~' = 穴 の文字の絵から格子を作る */
function gridOf(rows: readonly string[]): Grid {
  const h = rows.length;
  const w = rows[0]?.length ?? 0;
  const g = makeGrid(w, h, Cell.Wall);
  rows.forEach((row, y) => {
    for (let x = 0; x < w; x++) {
      const c = row[x];
      g.cells[y * w + x] = c === "." ? Cell.Floor : c === "~" ? Cell.Pit : Cell.Wall;
    }
  });
  return g;
}

function count(g: Grid, cell: Cell): number {
  let n = 0;
  for (const c of g.cells) if (c === cell) n++;
  return n;
}

function at(g: Grid, x: number, y: number): number {
  return g.cells[y * g.w + x] ?? -1;
}

describe("座標ハッシュと雑音", () => {
  it("h32 は同じ入力で同じ値を返し、座標が違えば（ほぼ）違う値になる", () => {
    expect(h32(3, 4, 5)).toBe(h32(3, 4, 5));
    expect(h32(3, 4, 5)).not.toBe(h32(4, 3, 5));
    expect(h32(3, 4, 5)).not.toBe(h32(3, 4, 6));
  });

  it("vnoise は 0〜1 に収まり、決定的で、近い座標ではなめらかに変わる", () => {
    let maxStep = 0;
    for (let x = 0; x < 200; x++) {
      const v = vnoise(x, 7, 5, 11);
      expect(v, `x=${x}`).toBeGreaterThanOrEqual(0);
      expect(v, `x=${x}`).toBeLessThanOrEqual(1);
      expect(vnoise(x, 7, 5, 11)).toBe(v);
      maxStep = Math.max(maxStep, Math.abs(vnoise(x + 1, 7, 5, 11) - v));
    }
    expect(maxStep, "周期 5 の雑音は 1 マスで大きく跳ねない").toBeLessThan(0.5);
  });
});

describe("makeGrid / clamp / sealBorder", () => {
  it("makeGrid は指定の Cell で埋め、sealBorder は外周だけを壁にする", () => {
    const g = makeGrid(6, 5, Cell.Floor);
    expect(count(g, Cell.Floor)).toBe(30);
    sealBorder(g);
    expect(count(g, Cell.Wall)).toBe(6 * 5 - 4 * 3);
    expect(at(g, 2, 2)).toBe(Cell.Floor);
    expect(at(g, 0, 2)).toBe(Cell.Wall);
    expect(at(g, 5, 2)).toBe(Cell.Wall);
  });

  it("clamp は範囲に収める", () => {
    expect([clamp(-1, 0, 3), clamp(2, 0, 3), clamp(9, 0, 3)]).toEqual([0, 2, 3]);
  });
});

describe("disc / line / polyline", () => {
  it("disc は半径 r の円を塗り、外周には触れない", () => {
    const g = makeGrid(20, 20, Cell.Wall);
    disc(g, 10, 10, 4, Cell.Floor);
    expect(at(g, 10, 10)).toBe(Cell.Floor);
    expect(at(g, 13, 10)).toBe(Cell.Floor);
    expect(at(g, 16, 10)).toBe(Cell.Wall);
    const n = count(g, Cell.Floor);
    expect(n, "面積は πr² に近い").toBeGreaterThan(Math.PI * 16 * 0.85);
    expect(n).toBeLessThan(Math.PI * 16 * 1.15);

    const edge = makeGrid(8, 8, Cell.Floor);
    disc(edge, 0, 0, 5, Cell.Wall);
    expect(at(edge, 0, 0), "外周は塗らない").toBe(Cell.Floor);
    expect(at(edge, 1, 1)).toBe(Cell.Wall);
  });

  it("disc は床で上書きすると穴を消し、only を渡すと指定の Cell だけを書き換える", () => {
    const g = makeGrid(16, 16, Cell.Pit);
    disc(g, 8, 8, 3, Cell.Floor);
    expect(at(g, 8, 8), "床で上書きすれば穴は消える").toBe(Cell.Floor);

    const h = gridOf(["######", "#~~..#", "#~~..#", "######"]);
    disc(h, 3, 2, 8, Cell.Floor, { only: Cell.Wall });
    expect(at(h, 1, 1), "only = 壁なら穴は残る").toBe(Cell.Pit);
    expect(at(h, 4, 2)).toBe(Cell.Floor);
  });

  it("line は 2 点の間をつなぎ、polyline は折れ線をなぞる", () => {
    const g = makeGrid(30, 12, Cell.Wall);
    line(g, 3, 6, 26, 6, 1, Cell.Floor);
    for (let x = 4; x <= 25; x++) expect(at(g, x, 6), `x=${x}`).toBe(Cell.Floor);

    const p = makeGrid(30, 30, Cell.Wall);
    polyline(
      p,
      [
        { x: 4, y: 4 },
        { x: 24, y: 4 },
        { x: 24, y: 24 },
      ],
      1,
      Cell.Floor,
    );
    expect(at(p, 14, 4)).toBe(Cell.Floor);
    expect(at(p, 24, 14)).toBe(Cell.Floor);
    expect(at(p, 4, 24), "折れ線の外は塗らない").toBe(Cell.Wall);
  });
});

describe("wander / chaikin", () => {
  const A = { x: 0, y: 0 };
  const B = { x: 40, y: 0 };

  it("wander は depth 回の細分で点が 2^depth + 1 個になり、端点を保ち、同じ seed で同じ道になる", () => {
    const a = wander(createRng(5), A, B, 0.2, 3);
    const b = wander(createRng(5), A, B, 0.2, 3);
    expect(a.length).toBe(2 ** 3 + 1);
    expect(a[0]).toEqual(A);
    expect(a[a.length - 1]).toEqual(B);
    expect(a).toEqual(b);
    expect(wander(createRng(6), A, B, 0.2, 3)).not.toEqual(a);
  });

  it("wander は wig = 0 なら直線のまま", () => {
    for (const p of wander(createRng(1), A, B, 0, 3)) expect(Math.abs(p.y)).toBeLessThan(1e-9);
  });

  it("chaikin は端点を保ったまま点を増やして角を丸める", () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ];
    const out = chaikin(pts, 2);
    expect(out[0]).toEqual(pts[0]);
    expect(out[out.length - 1]).toEqual(pts[2]);
    expect(out.length).toBeGreaterThan(pts.length * 2);
    expect(out.some((p) => p.x === 10 && p.y === 0), "角の点は切り落とされる").toBe(false);
    expect(pts[1], "元の配列は変えない").toEqual({ x: 10, y: 0 });
  });
});

describe("blob", () => {
  it("雑音で縁が揺れる塊を作り、同じ noiseSeed なら同じ形、違えば違う形", () => {
    const a = makeGrid(30, 30, Cell.Wall);
    const b = makeGrid(30, 30, Cell.Wall);
    const c = makeGrid(30, 30, Cell.Wall);
    blob(a, 15, 15, 6, 7, 0.3, Cell.Floor);
    blob(b, 15, 15, 6, 7, 0.3, Cell.Floor);
    blob(c, 15, 15, 6, 8, 0.3, Cell.Floor);
    expect(Array.from(a.cells)).toEqual(Array.from(b.cells));
    expect(Array.from(a.cells)).not.toEqual(Array.from(c.cells));
    expect(at(a, 15, 15)).toBe(Cell.Floor);
    expect(count(a, Cell.Floor)).toBeGreaterThan(60);
  });

  it("楕円（sx・ang）に伸ばせる", () => {
    const g = makeGrid(40, 40, Cell.Wall);
    blob(g, 20, 20, 5, 1, 0, Cell.Floor, { sx: 2, sy: 1, ang: 0 });
    expect(at(g, 28, 20), "x 方向に 2 倍").toBe(Cell.Floor);
    expect(at(g, 20, 27), "y 方向は伸びない").toBe(Cell.Wall);
  });
});

describe("poisson / relax", () => {
  it("poisson は枠の中に minD 以上離れた点を maxN 個まで置き、同じ seed で同じ点列になる", () => {
    const pts = poisson(createRng(3), 8, 4, 4, 100, 60, 12);
    expect(pts.length).toBeGreaterThan(6);
    expect(pts.length).toBeLessThanOrEqual(12);
    for (const p of pts) {
      expect(p.x).toBeGreaterThanOrEqual(4);
      expect(p.x).toBeLessThan(100);
      expect(p.y).toBeGreaterThanOrEqual(4);
      expect(p.y).toBeLessThan(60);
    }
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const a = pts[i];
        const b = pts[j];
        if (!a || !b) continue;
        expect(Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2), `${i} と ${j}`).toBeGreaterThanOrEqual(8);
      }
    }
    expect(poisson(createRng(3), 8, 4, 4, 100, 60, 12)).toEqual(pts);
  });

  it("poisson の avoid が true の所には置かない", () => {
    const pts = poisson(createRng(1), 5, 0, 0, 60, 60, 30, (p) => p.x < 30);
    expect(pts.length).toBeGreaterThan(0);
    for (const p of pts) expect(p.x).toBeGreaterThanOrEqual(30);
  });

  it("relax は近すぎる点を押し離し、fixed の点は動かさず、枠の外へ出さない", () => {
    const pts = [
      { x: 10, y: 10, fixed: true },
      { x: 11, y: 10 },
      { x: 10.5, y: 11 },
    ];
    relax(pts, 30, 6, 0, 0, 20, 20);
    expect(pts[0]).toMatchObject({ x: 10, y: 10 });
    for (const p of pts) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(20);
    }
    const a = pts[0];
    const b = pts[1];
    const c = pts[2];
    if (!a || !b || !c) throw new Error("点が無い");
    expect(Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2), "押し離された").toBeGreaterThan(5);
    expect(Math.sqrt((a.x - c.x) ** 2 + (a.y - c.y) ** 2)).toBeGreaterThan(5);
  });
});

describe("mstEdges / segCross / addLoops", () => {
  const SQUARE = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];

  it("mstEdges は n - 1 本で全点をつなぎ、同じ入力で同じ辺になる", () => {
    const pts = poisson(createRng(2), 8, 0, 0, 80, 50, 14);
    const edges = mstEdges(pts);
    expect(edges.length).toBe(pts.length - 1);
    const parent = pts.map((_, i) => i);
    const find = (i: number): number => ((parent[i] ?? i) === i ? i : find(parent[i] ?? i));
    for (const [a, b] of edges) parent[find(a)] = find(b);
    expect(new Set(pts.map((_, i) => find(i))).size, "1 つの木").toBe(1);
    expect(mstEdges(pts)).toEqual(edges);
    expect(mstEdges([])).toEqual([]);
  });

  it("segCross は X 字の線分だけを交差とみなす（端点で接するだけは交差でない）", () => {
    expect(segCross({ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 10, y: 0 })).toBe(true);
    expect(segCross({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 5 }, { x: 10, y: 5 })).toBe(false);
    expect(segCross({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 })).toBe(false);
  });

  it("addLoops は maxLen 以下で交差しない辺だけを k 本まで足す", () => {
    const edges = mstEdges(SQUARE);
    expect(edges.length).toBe(3);
    addLoops(SQUARE, edges, 1, 11);
    expect(edges.length, "正方形の 4 辺目").toBe(4);

    const none = mstEdges(SQUARE);
    addLoops(SQUARE, none, 5, 5);
    expect(none.length, "maxLen が短ければ足さない").toBe(3);

    const diag = mstEdges(SQUARE);
    addLoops(SQUARE, diag, 5, 20);
    expect(diag.length, "対角線 2 本は交差するので片方だけ足せる").toBeLessThanOrEqual(5);
    for (let i = 0; i < diag.length; i++) {
      for (let j = i + 1; j < diag.length; j++) {
        const [a, b] = diag[i] ?? [0, 0];
        const [c, d] = diag[j] ?? [0, 0];
        const pa = SQUARE[a];
        const pb = SQUARE[b];
        const pc = SQUARE[c];
        const pd = SQUARE[d];
        if (!pa || !pb || !pc || !pd) continue;
        expect(segCross(pa, pb, pc, pd), `辺 ${i} と ${j}`).toBe(false);
      }
    }
  });
});

describe("caStep / tidy", () => {
  it("caStep は壁の多い所を壁に、少ない所を床にし、穴は変えず、元の格子を変えない", () => {
    const g = gridOf([
      "#######",
      "#.....#",
      "#.~...#",
      "#.....#",
      "#######",
    ]);
    const before = Array.from(g.cells);
    const next = caStep(g, 5, 4);
    expect(Array.from(g.cells), "元は変えない").toEqual(before);
    expect(next[2 * 7 + 2], "穴は残る").toBe(Cell.Pit);
    expect(next[2 * 7 + 4], "広間の中央は床").toBe(Cell.Floor);
    expect(next[1 * 7 + 1], "角は壁に囲まれて壁になる").toBe(Cell.Wall);
  });

  it("tidy は床に囲まれた 1 マスの岩くずだけを床にする", () => {
    const g = gridOf([
      "#######",
      "#.....#",
      "#..#..#",
      "#.....#",
      "#######",
    ]);
    tidy(g);
    expect(at(g, 3, 2), "孤立した岩は消える").toBe(Cell.Floor);
    expect(at(g, 0, 0), "外壁は残る").toBe(Cell.Wall);
    expect(at(g, 3, 4)).toBe(Cell.Wall);
  });
});

describe("voronoiCarve", () => {
  it("各マスを一番近い種の部屋にし、境目（gap 未満）は壁のまま残して、所属を返す", () => {
    const g = makeGrid(40, 20, Cell.Wall);
    const owner = voronoiCarve(
      g,
      [
        { x: 10, y: 10, r: 15 },
        { x: 30, y: 10, r: 15 },
      ],
      2,
      1,
      0,
    );
    expect(at(g, 10, 10)).toBe(Cell.Floor);
    expect(owner[10 * 40 + 10]).toBe(0);
    expect(owner[10 * 40 + 30]).toBe(1);
    expect(at(g, 20, 10), "2 つの部屋の境目は壁").toBe(Cell.Wall);
    expect(owner[10 * 40 + 20]).toBe(-1);
    expect(at(g, 17, 10), "境目から離れれば床").toBe(Cell.Floor);
  });

  it("mask が false のマスは触らず、種から半径 r より遠いマスも床にしない", () => {
    const g = makeGrid(30, 20, Cell.Wall);
    voronoiCarve(g, [{ x: 15, y: 10, r: 8 }], 0, 1, 0, (x) => x >= 15);
    expect(at(g, 17, 10)).toBe(Cell.Floor);
    expect(at(g, 12, 10), "mask の外").toBe(Cell.Wall);
    expect(at(g, 24, 10), "半径の外").toBe(Cell.Wall);
  });
});

describe("connectAll", () => {
  it("離れた床を最短の道で本体につなぎ、掘った道は幅 2 の床になる（穴の上は桟道）", () => {
    const g = gridOf([
      "####################",
      "#......#~~~~#......#",
      "#......#~~~~#......#",
      "#......#~~~~#......#",
      "#......#~~~~#......#",
      "####################",
    ]);
    connectAll(g, 5);
    expect(bfsDistances(g, 1 * 20 + 1)[1 * 20 + 18], "左右の部屋が歩いてつながる").toBeGreaterThan(0);
    expect([1, 2, 3].some((y) => at(g, 9, y) === Cell.Floor && at(g, 9, y + 1) === Cell.Floor), "桟道の幅は 2").toBe(true);
  });

  it("minKeep 未満の欠片は壁で埋め、大きい欠片は残してつなぐ", () => {
    const g = gridOf([
      "##########",
      "#.....#..#",
      "#.....#..#",
      "#.....####",
      "#........#",
      "##########",
    ]);
    // 右上の 2x2（4 マス）は本体につながっていない欠片。minKeep = 5 なら埋める
    connectAll(g, 5);
    expect(at(g, 7, 1), "小さい欠片は壁に").toBe(Cell.Wall);
    expect(at(g, 8, 2)).toBe(Cell.Wall);
    expect(at(g, 8, 4), "本体は残る").toBe(Cell.Floor);
  });

  it("欠片が 3 つあっても全部が 1 つの連結成分になり、決定的", () => {
    const rows = [
      "##############################",
      "#.....#.....#.....#.....#....#",
      "#.....#.....#.....#.....#....#",
      "#.....#.....#.....#.....#....#",
      "#.....#.....#.....#.....#....#",
      "#.....#.....#.....#.....#....#",
      "##############################",
    ];
    const a = gridOf(rows);
    const b = gridOf(rows);
    connectAll(a, 5);
    connectAll(b, 5);
    expect(Array.from(a.cells)).toEqual(Array.from(b.cells));
    const dist = bfsDistances(a, 1 * 30 + 1);
    for (let i = 0; i < a.cells.length; i++) if (a.cells[i] === Cell.Floor) expect(dist[i], `床 ${i} に歩いて着く`).toBeGreaterThanOrEqual(0);
  });
});

describe("bfsDistances / farthestPair", () => {
  const MAZE = gridOf([
    "##########",
    "#........#",
    "#.######.#",
    "#.#....#.#",
    "#.#.##.#.#",
    "#...##...#",
    "##########",
  ]);

  it("bfsDistances は床の 4 近傍の歩数を返し、壁・穴・届かない所は -1", () => {
    const d = bfsDistances(MAZE, 1 * 10 + 1);
    expect(d[1 * 10 + 1]).toBe(0);
    expect(d[1 * 10 + 8]).toBe(7);
    expect(d[0]).toBe(-1);
    const pit = gridOf(["#####", "#.~.#", "#####"]);
    expect(bfsDistances(pit, 1 * 5 + 1)[1 * 5 + 3], "穴を越えては歩けない").toBe(-1);
  });

  it("farthestPair は歩く距離が最も遠い候補 2 点の添字を返す（壁越しの近さに惑わされない）", () => {
    const pts = [
      { x: 1.5, y: 1.5 },
      { x: 3.5, y: 3.5 },
      { x: 6.5, y: 5.5 },
      { x: 1.5, y: 5.5 },
    ];
    // 0 から最も遠いのは 2（歩数 13）。2 から最も遠いのは 0
    expect(farthestPair(MAZE, pts)).toEqual([2, 0]);
  });

  it("farthestPair は床の上の候補が 2 つ未満なら null、同じ入力で同じ答え", () => {
    expect(farthestPair(MAZE, [{ x: 1.5, y: 1.5 }])).toBeNull();
    expect(
      farthestPair(MAZE, [
        { x: 1.5, y: 1.5 },
        { x: 0.5, y: 0.5 },
      ]),
      "壁の上の候補は使わない",
    ).toBeNull();
    const pts = [
      { x: 1.5, y: 1.5 },
      { x: 8.5, y: 1.5 },
      { x: 3.5, y: 3.5 },
    ];
    expect(farthestPair(MAZE, pts)).toEqual([2, 1]);
    expect(farthestPair(MAZE, pts)).toEqual(farthestPair(MAZE, pts));
  });
});
