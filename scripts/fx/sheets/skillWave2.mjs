// スキル石: 第 2 弾（地形・新しい状態異常・属性・空間）を墨の筆で描く（docs/ideas/fx-sprites.md 10 章）。単位は絵のドット（論理 0.5px）。
// 正準の向きは +x（撃つ・振る向き）。絵の大きさはスキルの数値（src/data/balance/skills/WAVE2_SKILL_TUNING/）の半径 × 2 ドットで描き、
// 表の base にその半径（px）を書く。地形（水・油・泥・氷）そのものは地形の層が描くので、ここでは「置く瞬間」の演出に絞る
// 光の表現（白い芯・グロー・火花の星）は使わず、筆の線・円相・飛沫・墨だまり・滲み・掠れで描く。差し色（段 6〜7）は芯と粒だけ
//
// - 水瓶（waterJar）: 筆で描いた水瓶が落ちて割れ、陶片の弧が飛び、墨の王冠が跳ねる。床には波紋の円相が重なって広がる
// - 油流し（oilPot）: ずんぐりした油壺が割れ、重い墨の塊が糸を引いて飛ぶ。床には艶の抜け筋がある濃い油溜まりが散る
// - 地均し（levelGround）: 踏み込みで鏝（こて）の一画を押し、前へ太い一文字を均すように引く（beam。熊手の溝の毛筋と、
//   脇へ押しのけた土くれ）。終点は止めの一画に寄せた土が盛り上がる。砕いたマスは割れ目の筆と、角の欠けた礫が跳ねる
// - 火吸い（emberDraw）: 周りから渦の筆が手元へ巻き込み、火の粉（差し色の粒）が吸われて墨玉に火が宿る。
//   炎の床からは揺れる細い筆の流れ（beam）。飛ぶ火球は芯に火を抱いた墨玉と、炎の舌のような筆の尾
// - 焼き印（brandSear）: 前を薙ぐ一筆と、扇の中に押された 2 つの角印（烙印の字）。印の芯は赤熱から冷える
// - 烙火（brandBlast）: 床に大きな丸印が書かれ（地面）、印が割れて墨が炎の舌のように放射に弾ける。倍になった烙印は角印が 2 つに割れる
// - 瞬凍（flashFreeze）: 一滴が落ちた所から、霜の羊歯のように枝分かれする氷の棘の筆が放射に走る。床は円相がぴしりと閉じる。
//   凍った敵は六角の氷塊を筆の 6 画で囲う
// - 彩刻（hueEtch）: 斬りの一筆の内側に、菱の格子を細筆で彫り込む（芯は刻んだ彩痕の色）
// - 色解き（hueRelease）: 床に円相と五弁の花の筆、空中で菱の欠片が四方へ弾ける。彩痕の敵では菱の印が割れて花弁が散る
// - 死の宣告（doomSentence）: 床に時計の文字盤（円相と 12 の目盛りと針）、頭上に筆の砂時計と、上から下ろす宣告の縦の一筆
// - 移ろい刃（shiftingEdge）: 三日月の一筆の上に、炎・氷・雷・雫の筆の印を大きく 4 つ（芯は今の属性の差し色）
// - 結界杭（wardStake）: 札と紙垂を下げた杭が打ち込まれ、杭同士を注連縄（二本撚りの筆の縄と紙垂）が結ぶ（beam）
// - 泥沼（mire）: 泥の塊が弧を描いて撒かれ、床に淡墨の滲みと渦が広がる。泡の小さな円相が膨らんで弾け、沈む敵の足元を泥の指が掴む
import { arcPoints, brushStroke, enso, inkBlot, inkWash, lv, splatter } from "../brush.mjs";
import { dot, hash1, paint, segment, smoothstep, stamp } from "../raster.mjs";
import { DIRS } from "../motifs.mjs";

const TAU = Math.PI * 2;
/** 絵の 1 論理 px のドット数 */
const DPX = 2;

/** 進み（0..1）。フレームの中央 */
function prog(f, frames) {
  return (f + 0.5) / frames;
}

/** 半径 radiusPx（px）の絵を描く作業面の一辺（ドット） */
function sheetSize(radiusPx, pad) {
  return Math.ceil(radiusPx * DPX + pad) * 2;
}

// ---------------------------------------------------------------------------
// 共通の部品
// ---------------------------------------------------------------------------

/** 点を角 a だけ回して (ox, oy) へ動かす */
function place(pts, a, ox = 0, oy = 0, k = 1) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return pts.map((p) => ({ x: ox + (p.x * c - p.y * s) * k, y: oy + (p.x * s + p.y * c) * k }));
}

/** 直線の折れ線（筆の揺れが乗るよう細かく刻む） */
function linePts(ax, ay, bx, by, n = 8) {
  const out = [];
  for (let i = 0; i <= n; i++) out.push({ x: ax + ((bx - ax) * i) / n, y: ay + ((by - ay) * i) / n });
  return out;
}

/** 多角形の内側か（偶奇） */
function inPoly(pts, x, y) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i];
    const b = pts[j];
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/**
 * 墨で塗った欠片（多角形）。縁 rimW ドットは濃墨、内側は fill の段（負なら塗らず縁だけ）。
 * 内側を市松に間引くなら sparse
 */
function inkPoly(frame, pts, o = {}) {
  const rimW = o.rimW ?? 1.2;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of pts) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  paint(
    frame,
    (x, y) => {
      if (!inPoly(pts, x, y)) return -1;
      if (o.fade && hash1(Math.floor(x * 2) * 977 + Math.floor(y * 2), o.seed ?? 3) < o.fade) return -1;
      let d = Infinity;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) d = Math.min(d, segment(x, y, pts[j].x, pts[j].y, pts[i].x, pts[i].y).d);
      if (d < rimW) return lv(o.rim ?? 5);
      const fill = o.fill ?? 5;
      if (fill < 0) return -1;
      if (o.sparse && ((Math.floor(x) + Math.floor(y)) & 1) === 1) return -1;
      return lv(fill);
    },
    { bounds: { x0: x0 - 1, y0: y0 - 1, x1: x1 + 1, y1: y1 + 1 }, dither: 0 },
  );
}

/** いびつな欠片の輪郭（n 角・半径 r。角ごとに半径をばらす。礫・陶片・菱の欠片） */
function shardPts(n, r, seed, stretch = 1) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + (hash1(i, seed) - 0.5) * 0.7;
    const rr = r * (0.6 + 0.55 * hash1(i + 20, seed));
    pts.push({ x: Math.cos(a) * rr * stretch, y: Math.sin(a) * rr });
  }
  return pts;
}

/** 菱形（長さ len・幅 wid。+x が長手） */
function rhombus(len, wid) {
  return [
    { x: len / 2, y: 0 },
    { x: 0, y: wid / 2 },
    { x: -len / 2, y: 0 },
    { x: 0, y: -wid / 2 },
  ];
}

/** 細い円（いびつな閉じた輪。泡・紙垂の輪など、太さ 3 未満の線） */
function thinRing(frame, cx, cy, r, w, level, squash = 1) {
  paint(
    frame,
    (x, y) => {
      const d = Math.hypot(x - cx, (y - cy) / squash);
      return Math.abs(d - r) <= w / 2 ? lv(level) : -1;
    },
    { bounds: { x0: cx - r - w - 1, y0: cy - r * squash - w - 1, x1: cx + r + w + 1, y1: cy + r * squash + w + 1 }, dither: 0 },
  );
}

/**
 * 印（角印）。中心 (cx, cy)・一辺 s・傾き a。四辺を 4 画の筆で書き（角で少し突き出る）、中に烙印の字（火の略字）を書く。
 * heat は字の芯の段（属性つきでは 6〜7 が赤熱、5 で冷えた墨）
 */
function seal(frame, cx, cy, s, a, o = {}) {
  const h = s / 2;
  const grow = o.grow ?? 1;
  const fade = o.fade ?? 0;
  const w = o.width ?? Math.max(2.2, s * 0.16);
  const seed = o.seed ?? 1;
  const sides = [
    [-h - 1, -h, h + 1, -h],
    [h, -h - 1, h, h + 1],
    [h + 1, h, -h - 1, h],
    [-h, h + 1, -h, -h - 1],
  ];
  sides.forEach(([ax, ay, bx, by], i) => {
    const g = smoothstep(i * 0.18, i * 0.18 + 0.3, grow);
    if (g <= 0) return;
    brushStroke(frame, { pts: place(linePts(ax, ay, bx, by), a, cx, cy), width: w, grow: g, fade, dry: 0.35, press: 0.08, tail: 0.25, sharp: 0.4, core: lv(5), seed: seed + i });
  });
  const g = smoothstep(0.55, 1, grow);
  if (g <= 0) return;
  const k = s / 20;
  const core = lv(o.heat ?? 7);
  const glyph = [
    // 火の略字: 左右の点と、人の字
    [
      { x: -6, y: -4 },
      { x: -4, y: -1 },
    ],
    [
      { x: 6, y: -4 },
      { x: 4, y: -1 },
    ],
    [
      { x: 0, y: -7 },
      { x: 0, y: -1 },
      { x: -6, y: 7 },
    ],
    [
      { x: 0, y: -1 },
      { x: 6, y: 7 },
    ],
  ];
  glyph.forEach((pts, i) => {
    brushStroke(frame, { pts: place(pts, a, cx, cy, k), width: Math.max(1.6, w * 0.8), grow: g, fade, dry: 0.2, core, coreWidth: 0.5, tail: 0.5, seed: seed + 10 + i });
  });
}

// ---------------------------------------------------------------------------
// 水瓶
// ---------------------------------------------------------------------------

const JAR = { radiusPx: 32, frames: 10, seed: 7101 };
const JAR_R = JAR.radiusPx * DPX;
/** 割れるコマ（それまでは瓶が落ちてくる） */
const JAR_BREAK = 2;

/** 筆で描いた水瓶（丸い胴・すぼんだ首・反った口）。(0, oy) が胴の中心 */
function jarShape(frame, oy, seed) {
  // 胴: 上（首の所）を開けた一筆の円
  enso(frame, { oy, radius: 13, a0: -Math.PI / 2 + 0.42, sweep: TAU - 0.84, width: 3.6, dry: 0.3, tail: 0.3, seed });
  brushStroke(frame, { pts: [{ x: -5.5, y: oy - 12 }, { x: -4, y: oy - 16 }, { x: -5, y: oy - 20 }], width: 2.6, dry: 0.1, seed: seed + 1 });
  brushStroke(frame, { pts: [{ x: 5.5, y: oy - 12 }, { x: 4, y: oy - 16 }, { x: 5, y: oy - 20 }], width: 2.6, dry: 0.1, seed: seed + 2 });
  brushStroke(frame, { pts: linePts(-9, oy - 21, 9, oy - 21, 6), width: 3, dry: 0.2, seed: seed + 3 });
  // 胴の中の水の線（揺れる）
  brushStroke(frame, { pts: [{ x: -9, y: oy + 1 }, { x: -4, y: oy - 1.5 }, { x: 1, y: oy + 1 }, { x: 6, y: oy - 1.5 }, { x: 9, y: oy }], width: 1.8, dry: 0, core: lv(5), seed: seed + 4 });
}

/** 割れる（空中）: 瓶が落ちて割れ、陶片の弧が外へ飛び、墨の王冠が立って崩れる */
function jarBreak(frame, f) {
  const seed = JAR.seed;
  if (f < JAR_BREAK) {
    jarShape(frame, -34 + f * 18, seed);
    return;
  }
  const age = f - JAR_BREAK;
  const p = age / (JAR.frames - JAR_BREAK);
  // 陶片: 胴の弧のかけら。外へ飛んで回りながら掠れる
  for (let i = 0; i < 8; i++) {
    const r = (k) => hash1(i * 11 + k, seed + 5);
    const a = (i / 8) * TAU + r(1) * 0.5;
    const dist = 10 + JAR_R * 0.55 * (1 - Math.pow(0.68, age + 1)) * (0.7 + 0.5 * r(2));
    const cx = Math.cos(a) * dist;
    const cy = Math.sin(a) * dist - 6 * Math.sin(Math.min(1, p * 1.6) * Math.PI);
    const spin = a + age * (r(3) - 0.5) * 1.4;
    const pts = arcPoints(0, 0, 10, -0.5, 1.0, 8).map((q) => ({ x: q.x - 10, y: q.y }));
    brushStroke(frame, { pts: place(pts, spin, cx, cy), width: 2.6, fade: smoothstep(0.45, 1, p), dry: 0.2, tail: 0.4, seed: seed + 20 + i });
  }
  // 王冠: 割れた所から放射に立つ短い筆（上へ反る）
  const crown = smoothstep(0, 0.3, p) * (1 - smoothstep(0.35, 0.8, p));
  if (crown > 0.02) {
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * TAU + hash1(i, seed + 6) * 0.3;
      const r0 = 8;
      const r1 = 8 + 18 * crown;
      const pts = [
        { x: Math.cos(a) * r0, y: Math.sin(a) * r0 * 0.6 },
        { x: Math.cos(a) * (r0 + r1) * 0.5, y: Math.sin(a) * (r0 + r1) * 0.3 - 6 * crown },
        { x: Math.cos(a) * r1, y: Math.sin(a) * r1 * 0.5 - 10 * crown },
      ];
      brushStroke(frame, { pts, width: 2.4, dry: 0.4, tail: 0.6, seed: seed + 40 + i });
    }
  }
  splatter(frame, age, 24, seed + 7, (i, r) => {
    const a = r(1) * TAU;
    const sp = 2.5 + 5 * r(2);
    return { x: Math.cos(a) * 6, y: Math.sin(a) * 6, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 1.5, size: r(3) > 0.6 ? 1.8 : 1, life: 4 + Math.floor(3 * r(4)), level: r(5) > 0.5 ? 5 : 4 };
  });
  if (age < 2) inkBlot(frame, { radius: 8 - 3 * age, seed: seed + 8, core: lv(5) });
}

/** 波紋（地面）: 割れた所から円相が 3 重に広がり、真ん中に水の滲み（間引き） */
function jarSplash(frame, f) {
  const p = prog(f, JAR.frames);
  if (f < JAR_BREAK) return;
  const q = (f - JAR_BREAK + 0.5) / (JAR.frames - JAR_BREAK);
  inkWash(frame, { radius: JAR_R * 0.5, reach: smoothstep(0, 0.5, q), seed: JAR.seed + 9, rimWidth: 2, rimLevel: 4, tint: 2, density: 0.35 * (1 - smoothstep(0.6, 1, q)), cell: 7 });
  for (let i = 0; i < 3; i++) {
    const t = smoothstep(i * 0.15, i * 0.15 + 0.75, q);
    if (t <= 0.02) continue;
    enso(frame, {
      radius: JAR_R * (0.2 + 0.8 * t),
      a0: i * 2.1,
      sweep: TAU * 0.86,
      width: 3.2 * (1 - 0.5 * t),
      fade: smoothstep(0.6, 1, t) * 0.9,
      dry: 0.5,
      seed: JAR.seed + 60 + i,
    });
  }
  void p;
}

// ---------------------------------------------------------------------------
// 油流し
// ---------------------------------------------------------------------------

const OIL = { radiusPx: 32, frames: 10, seed: 7201 };
const OIL_R = OIL.radiusPx * DPX;
const OIL_BREAK = 2;

/** 油溜まり: 縁は濃墨、内側は詰んだ市松の墨に、艶の抜け筋（斜めの細い帯）が通る */
function oilPool(frame, cx, cy, r, seed) {
  if (r < 1) return;
  paint(
    frame,
    (x, y) => {
      const dx = x - cx;
      const dy = y - cy;
      const a = Math.atan2(dy, dx);
      const edge = r * (0.86 + 0.1 * Math.sin(a * 2 + seed) + 0.06 * Math.sin(a * 5 + seed * 1.7) + 0.05 * (hash1(Math.floor(((a + Math.PI) / TAU) * 40), seed) - 0.5));
      const d = Math.hypot(dx, dy);
      if (d > edge) return -1;
      if (edge - d < 2.2) return lv(6);
      // 艶の抜け筋（光ではなく塗り残し）
      const sheen = Math.abs(dx * 0.6 + dy * 0.8 + r * 0.25);
      if (sheen < 0.9 && d < edge * 0.7) return -1;
      if (((Math.floor(x) + Math.floor(y)) & 1) === 1 && d > edge * 0.35) return -1;
      return lv(5);
    },
    { bounds: { x0: cx - r * 1.4, y0: cy - r * 1.4, x1: cx + r * 1.4, y1: cy + r * 1.4 }, dither: 0 },
  );
}

/** 油の塊の飛ぶ先（中心からの角・距離・大きさ） */
const OIL_GLOBS = Array.from({ length: 6 }, (_, i) => {
  const r = (k) => hash1(i * 7 + k, OIL.seed + 3);
  return { a: (i / 6) * TAU + r(1) * 0.6, at: OIL_R * (0.5 + 0.35 * r(2)), size: 3.5 + 2 * r(3) };
});

/** 割れる（空中）: 油壺が落ちて割れ、重い塊が糸を引いて飛び、ぼたりと落ちる */
function oilPour(frame, f) {
  const seed = OIL.seed;
  if (f < OIL_BREAK) {
    const oy = -28 + f * 15;
    enso(frame, { oy, radius: 14, a0: -Math.PI / 2 + 0.7, sweep: TAU - 1.4, width: 3.8, dry: 0.3, tail: 0.3, seed });
    inkBlot(frame, { y: oy + 3, radius: 9, seed: seed + 1, core: lv(5) });
    brushStroke(frame, { pts: linePts(-10, oy - 13, 10, oy - 13, 6), width: 3.4, dry: 0.2, seed: seed + 2 });
    // 注ぎ口
    brushStroke(frame, { pts: [{ x: 9, y: oy - 12 }, { x: 15, y: oy - 15 }], width: 2.4, dry: 0.1, seed: seed + 3 });
    return;
  }
  const age = f - OIL_BREAK;
  const p = age / (OIL.frames - OIL_BREAK);
  // 重い塊は速く出て早く止まる
  const k = 1 - Math.pow(0.55, age + 1);
  OIL_GLOBS.forEach((g, i) => {
    const dist = 6 + (g.at - 6) * k;
    const lift = 10 * Math.sin(Math.min(1, k * 1.15) * Math.PI);
    const x = Math.cos(g.a) * dist;
    const y = Math.sin(g.a) * dist - lift;
    if (p < 0.85) inkBlot(frame, { x, y, radius: g.size * (1 - 0.3 * p), seed: seed + 10 + i, core: lv(5) });
    // 引く糸（細く、途中で切れる）
    if (age < 4) brushStroke(frame, { pts: [{ x: Math.cos(g.a) * 4, y: Math.sin(g.a) * 4 }, { x: (x + Math.cos(g.a) * 4) / 2, y: (y + Math.sin(g.a) * 4) / 2 + 3 }, { x, y }], width: 1.4, fade: age / 4, dry: 0.3, seed: seed + 20 + i });
  });
  splatter(frame, age, 14, seed + 4, (i, r) => {
    const a = r(1) * TAU;
    return { x: Math.cos(a) * 5, y: Math.sin(a) * 5, vx: Math.cos(a) * (2 + 3 * r(2)), vy: Math.sin(a) * (2 + 3 * r(2)) - 1, size: r(3) > 0.5 ? 1.6 : 1, life: 5, level: 6 };
  });
  if (age < 2) inkBlot(frame, { radius: 9 - 2 * age, seed: seed + 5, core: lv(6) });
}

/** 油溜まり（地面）: 真ん中の大きな溜まりと、塊が落ちた所の小さな溜まりが広がる */
function oilSplat(frame, f) {
  if (f < OIL_BREAK) return;
  const q = (f - OIL_BREAK + 0.5) / (OIL.frames - OIL_BREAK);
  const reach = smoothstep(0, 0.55, q);
  oilPool(frame, 0, 0, OIL_R * 0.42 * reach, OIL.seed + 30);
  OIL_GLOBS.forEach((g, i) => {
    const land = smoothstep(0.25, 0.7, q);
    oilPool(frame, Math.cos(g.a) * g.at, Math.sin(g.a) * g.at, g.size * 2.4 * land, OIL.seed + 40 + i);
    // 溜まり同士を結ぶ垂れの筋
    if (land > 0.1) brushStroke(frame, { pts: linePts(Math.cos(g.a) * OIL_R * 0.3, Math.sin(g.a) * OIL_R * 0.3, Math.cos(g.a) * g.at, Math.sin(g.a) * g.at, 6), width: 2.2, grow: land, dry: 0.5, seed: OIL.seed + 50 + i });
  });
}

// ---------------------------------------------------------------------------
// 地均し
// ---------------------------------------------------------------------------

const LEVEL = { seed: 7501, frames: 8, halfWidthPx: 9 };
const LEVEL_STEP_PX = 12;
/** 均す帯の半幅（ドット） */
const LEVEL_HALF = LEVEL.halfWidthPx * DPX;

/** 礫（角の欠けた墨の欠片）。弧を描いて跳ね、回る */
function rubble(frame, age, count, seed, spawn) {
  for (let i = 0; i < count; i++) {
    const r = (k) => hash1(i * 13 + k, seed);
    const s = spawn(i, r);
    const t = age - (s.born ?? 0);
    if (t < 0 || t > s.life) continue;
    const u = t / s.life;
    const x = s.x + s.vx * u;
    const y = s.y + s.vy * u - s.hop * Math.sin(u * Math.PI);
    const pts = place(shardPts(5, s.size, seed + i * 3, 1.3), r(9) * TAU + u * (r(8) - 0.5) * 3, x, y);
    inkPoly(frame, pts, { rim: 6, fill: u > 0.7 ? 4 : 5, rimW: 1 });
  }
}

/** 踏み込み: 足元に鏝の一画（照準と直交）を押し、墨が両脇と後ろへ跳ねる */
function levelStomp(frame, f) {
  const p = prog(f, LEVEL.frames);
  const g = smoothstep(0, 0.3, p);
  const fade = smoothstep(0.5, 1, p);
  brushStroke(frame, { pts: linePts(6, -LEVEL_HALF - 4, 8, LEVEL_HALF + 4, 10), width: 5, grow: g, fade, dry: 0.4, press: 0.2, tail: 0.3, seed: LEVEL.seed + 1 });
  if (p < 0.4) inkBlot(frame, { x: 2, y: 0, radius: 7 * (1 - p), seed: LEVEL.seed + 2, core: lv(6) });
  splatter(frame, f, 14, LEVEL.seed + 3, (i, r) => {
    const side = r(1) > 0.5 ? 1 : -1;
    return { x: 6, y: side * LEVEL_HALF * r(2), vx: -1 - 3 * r(3), vy: side * (2 + 4 * r(4)), size: r(5) > 0.5 ? 1.6 : 1, life: 5, level: r(6) > 0.5 ? 6 : 5 };
  });
}

/**
 * 均した帯（beam の 1 区間）: 帯幅いっぱいの乾いた太筆。毛筋が帯に沿って長く通る（熊手の溝）。
 * 両脇には押しのけた土くれが残る。コマが進むと毛筋が途切れて淡くなる
 */
function levelBeam(frame, f) {
  const p = prog(f, LEVEL.frames);
  const half = LEVEL_STEP_PX + 0.6;
  // 熊手の溝: 帯の幅に並ぶまっすぐな毛筋。所々途切れ（飛白）、コマが進むと途切れが増える。縁の 2 本は濃く太い
  const lanes = 11;
  const gap = 0.25 + 0.6 * smoothstep(0.2, 1, p);
  paint(
    frame,
    (x, y) => {
      if (x < -half || x > half) return -1;
      const lane = Math.round(((y + LEVEL_HALF) / (2 * LEVEL_HALF)) * (lanes - 1));
      if (lane < 0 || lane >= lanes) return -1;
      const ly = -LEVEL_HALF + (lane * 2 * LEVEL_HALF) / (lanes - 1);
      const edge = lane === 0 || lane === lanes - 1;
      if (Math.abs(y - ly) > (edge ? 1.3 : 0.7)) return -1;
      // 区間をまたいでも揃う途切れ（x の格子で決める）
      const cell = Math.floor((x + 100) / 5);
      if (hash1(cell * 31 + lane, LEVEL.seed + 12) < (edge ? gap * 0.5 : gap)) return -1;
      return edge ? lv(6) : lv(5);
    },
    { bounds: { x0: -half, y0: -LEVEL_HALF - 2, x1: half, y1: LEVEL_HALF + 2 }, dither: 0 },
  );
  // 押しのけた土くれ（帯の縁の外。継ぎ目で揃うよう区間の中だけ）
  for (let i = 0; i < 6; i++) {
    const r = (k) => hash1(i * 5 + k, LEVEL.seed + 11);
    if (p > 0.55 + 0.4 * r(4)) continue;
    const side = i % 2 === 0 ? 1 : -1;
    const x = -half + 3 + (2 * half - 6) * r(1);
    const y = side * (LEVEL_HALF + 2 + 3 * r(2) + 2 * p);
    const s = 1 + 1.2 * r(3);
    for (let dy = -s; dy <= s; dy += 0.5) for (let dx = -s; dx <= s; dx += 0.5) if (dx * dx + dy * dy <= s * s) dot(frame, x + dx, y + dy, 6);
  }
}

/** 止め: 押して寄せた土が盛り上がる。終点に直交の太い一画（止め）と、前へ転がる礫 */
function levelTip(frame, f) {
  const p = prog(f, LEVEL.frames);
  const pts = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    pts.push({ x: 2 + 10 * Math.sin(t * Math.PI), y: -LEVEL_HALF - 6 + (2 * LEVEL_HALF + 12) * t });
  }
  brushStroke(frame, { pts, width: 4.2, grow: smoothstep(0, 0.3, p), fade: smoothstep(0.55, 1, p), dry: 0.5, press: 0.15, tail: 0.35, seed: LEVEL.seed + 20 });
  rubble(frame, f, 4, LEVEL.seed + 21, (i, r) => ({ x: 8, y: (r(1) - 0.5) * LEVEL_HALF * 1.6, vx: 10 + 14 * r(2), vy: (r(3) - 0.5) * 10, hop: 6 + 6 * r(4), size: 4 + 2 * r(5), life: 6 }));
  splatter(frame, f, 10, LEVEL.seed + 22, (i, r) => ({ x: 8, y: (r(1) - 0.5) * LEVEL_HALF * 2, vx: 2 + 4 * r(2), vy: (r(3) - 0.5) * 4, size: r(4) > 0.5 ? 1.5 : 0.9, life: 5, level: 6 }));
}

/** 砕いたマス: 割れ目の筆が米の字に走り、角の欠けた礫が 4 つ跳ねて落ちる */
function levelRubble(frame, f) {
  const frames = 7;
  const p = prog(f, frames);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU + hash1(i, LEVEL.seed + 30) * 0.6;
    const pts = [
      { x: 0, y: 0 },
      { x: Math.cos(a + 0.25) * 7, y: Math.sin(a + 0.25) * 7 },
      { x: Math.cos(a) * 15, y: Math.sin(a) * 15 },
    ];
    brushStroke(frame, { pts, width: 2, grow: smoothstep(0, 0.3, p), fade: smoothstep(0.55, 1, p), dry: 0.3, press: 0.05, tail: 0.6, seed: LEVEL.seed + 31 + i });
  }
  rubble(frame, f, 4, LEVEL.seed + 40, (i, r) => {
    const a = (i / 4) * TAU + r(1);
    return { x: Math.cos(a) * 3, y: Math.sin(a) * 3, vx: Math.cos(a) * (10 + 6 * r(2)), vy: Math.sin(a) * (8 + 6 * r(2)), hop: 9 + 5 * r(3), size: 3 + 1.5 * r(4), life: 6 };
  });
  splatter(frame, f, 8, LEVEL.seed + 41, (i, r) => {
    const a = r(1) * TAU;
    return { x: 0, y: 0, vx: Math.cos(a) * (2 + 3 * r(2)), vy: Math.sin(a) * (2 + 3 * r(2)) - 1, size: 1, life: 4, level: 5 };
  });
}

// ---------------------------------------------------------------------------
// 火吸い
// ---------------------------------------------------------------------------

const EMBER = { radiusPx: 48, frames: 10, seed: 7601 };
const EMBER_R = EMBER.radiusPx * DPX;
const EMBER_STEP_PX = 10;
const EMBER_ARMS = 4;
/** 渦の巻き（ラジアン。外から手元まで） */
const EMBER_TWIST = 2.6;

/** 渦の 1 本の点（t: 0 = 外、1 = 手元） */
function emberSpiral(arm, t) {
  const a = (arm / EMBER_ARMS) * TAU + EMBER_TWIST * t;
  const r = EMBER_R * (0.95 - 0.86 * t);
  return { x: Math.cos(a) * r, y: Math.sin(a) * r };
}

/** 吸い込み（自分の周り）: 渦の筆が外から手元へ巻き込み、火の粉が渦に沿って吸われ、手元の墨玉に火が宿る */
function emberSwirl(frame, f) {
  const p = prog(f, EMBER.frames);
  const grow = smoothstep(0, 0.6, p);
  const fade = smoothstep(0.55, 1, p);
  for (let arm = 0; arm < EMBER_ARMS; arm++) {
    const pts = [];
    for (let i = 0; i <= 32; i++) pts.push(emberSpiral(arm, i / 32));
    brushStroke(frame, { pts, width: 4.2, grow, fade, dry: 0.45, press: 0.3, tail: 0.25, sharp: 0.5, coreWidth: 0.14, seed: EMBER.seed + arm });
    // 火の粉: 渦に沿って手元へ流れる差し色の粒
    for (let k = 0; k < 4; k++) {
      const t = (hash1(arm * 9 + k, EMBER.seed + 5) + p * 1.4) % 1;
      if (t > grow + 0.05) continue;
      const q = emberSpiral(arm, t);
      const off = 4 * (hash1(arm * 9 + k, EMBER.seed + 6) - 0.5);
      dot(frame, q.x + off, q.y - off, 7);
      dot(frame, q.x + off + 0.6, q.y - off, 6);
    }
  }
  const ball = smoothstep(0.2, 0.8, p);
  if (ball > 0.05) inkBlot(frame, { radius: 3 + 8 * ball, seed: EMBER.seed + 7, core: lv(7), coreWidth: 0.25 + 0.25 * ball });
}

/** 炎の床が吸われる: 床の炎の一筆が揺れて細り、火の粉が立つ */
function emberPuff(frame, f) {
  const frames = 7;
  const p = prog(f, frames);
  const k = 1.1 * (1 - 0.6 * p);
  const fade = smoothstep(0.45, 1, p);
  // 炎の印（移ろい刃と同じ形）が揺れて縮みながら吸われる
  glyphFlame(frame, { x: 0, y: -2 * p }, Math.sin(p * 7) * 0.25, k, 1, fade, EMBER.seed + 20);
  splatter(frame, f, 6, EMBER.seed + 21, (i, r) => ({ x: (r(1) - 0.5) * 8, y: -6, vx: (r(2) - 0.5) * 2, vy: -2 - 2 * r(3), size: 0.8, life: 5, level: 7 }));
}

/** 火の流れ（beam の 1 区間）: 揺れる細い筆と、流れる火の粉 */
function emberStream(frame, f) {
  const frames = 8;
  const p = prog(f, frames);
  const half = EMBER_STEP_PX + 0.6;
  const phase = f * 0.9;
  const amp = 3 * (1 - 0.4 * p);
  paint(
    frame,
    (x, y) => {
      if (x < -half || x > half) return -1;
      const cy = amp * Math.sin((x / (EMBER_STEP_PX * DPX)) * TAU + phase);
      const d = Math.abs(y - cy);
      if (d > 1.6 * (1 - 0.3 * p)) return -1;
      if (hash1(Math.floor(x * 1.3) + f * 31, EMBER.seed + 30) < 0.15 + 0.6 * p) return -1;
      return lv(5);
    },
    { bounds: { x0: -half, y0: -6, x1: half, y1: 6 }, dither: 0 },
  );
  for (let k = 0; k < 2; k++) {
    const x = -half + ((hash1(k, EMBER.seed + 31) * 2 * half + f * 4) % (2 * half));
    dot(frame, x, amp * Math.sin((x / (EMBER_STEP_PX * DPX)) * TAU + phase), 7);
  }
}

/** 飛ぶ火球: 芯に火を抱いた墨玉と、後ろへ揺れる炎の舌のような筆の尾 */
function emberBall(frame, f) {
  const frames = 8;
  const ph = (f / frames) * TAU;
  for (let i = 0; i < 3; i++) {
    const off = (i - 1) * 4;
    const pts = [];
    for (let k = 0; k <= 10; k++) {
      const t = k / 10;
      pts.push({ x: -3 - 24 * t * (i === 1 ? 1 : 0.75), y: off * (1 - t * 0.3) + Math.sin(ph + t * 5 + i * 2) * 2.5 * t });
    }
    brushStroke(frame, { pts, width: i === 1 ? 4.5 : 3, dry: 0.4, press: 0.05, tail: 0.6, core: lv(i === 1 ? 6 : 5), coreWidth: 0.15, seed: EMBER.seed + 40 + i + f * 3 });
  }
  inkBlot(frame, { radius: 7.5, seed: EMBER.seed + 45 + f, core: lv(7), coreWidth: 0.3 });
  dot(frame, -18 - (f % 4) * 2, Math.sin(ph) * 4, 7);
  dot(frame, -24 - (f % 3) * 2, -Math.sin(ph) * 3, 6);
}

// ---------------------------------------------------------------------------
// 焼き印・烙火
// ---------------------------------------------------------------------------

const BRAND = { searRadiusPx: 32, searHalf: 0.7, blastRadiusPx: 48, seed: 7801 };
const SEAR_R = BRAND.searRadiusPx * DPX;
const BLAST_R = BRAND.blastRadiusPx * DPX;

/** 焼き印: 前を薙ぐ一筆が走り、扇の中に角印が 2 つ押される。印の字の芯は赤熱（段 7）から冷える（段 5） */
function searCone(frame, f) {
  const frames = 8;
  const p = prog(f, frames);
  const half = BRAND.searHalf;
  brushStroke(frame, { pts: arcPoints(0, 0, SEAR_R * 0.88, -half - 0.1, 2 * half + 0.2, 30), width: 8, grow: smoothstep(0, 0.35, p), fade: smoothstep(0.55, 1, p) * 0.9, dry: 0.5, coreWidth: 0.16, seed: BRAND.seed + 1 });
  // 熱の揺らぎ: 扇の中を前へ揺れる細い筆 3 本
  for (let i = 0; i < 3; i++) {
    const a = (i - 1) * half * 0.6;
    const pts = [];
    for (let k = 0; k <= 10; k++) {
      const t = k / 10;
      const r = SEAR_R * (0.2 + 0.55 * t);
      const w = Math.sin(t * 7 + i * 2 + p * 6) * 0.08;
      pts.push({ x: Math.cos(a + w) * r, y: Math.sin(a + w) * r });
    }
    brushStroke(frame, { pts, width: 1.8, grow: smoothstep(0, 0.4, p), fade: smoothstep(0.3, 0.8, p), dry: 0.3, core: lv(6), coreWidth: 0.4, seed: BRAND.seed + 5 + i });
  }
  const stamp1 = smoothstep(0.3, 0.6, p);
  if (stamp1 <= 0) return;
  const heat = p < 0.65 ? 7 : p < 0.85 ? 6 : 5;
  [-0.32, 0.32].forEach((a, i) => {
    const r = SEAR_R * 0.56;
    seal(frame, Math.cos(a) * r, Math.sin(a) * r, 15 * (1.25 - 0.25 * stamp1), a + (i ? 0.15 : -0.15), { grow: stamp1, heat, seed: BRAND.seed + 10 + i * 20 });
  });
}

/** 烙火の丸印（地面）: 大きな円相と内輪、真ん中に烙印の字。後半は放射の割れ目が走って掠れる */
function blastSigil(frame, f) {
  const frames = 9;
  const p = prog(f, frames);
  const grow = smoothstep(0, 0.35, p);
  const fade = smoothstep(0.6, 1, p) * 0.9;
  enso(frame, { radius: BLAST_R * 0.62, a0: -Math.PI * 0.6, sweep: TAU * 0.93, width: 6, grow, fade, dry: 0.5, coreWidth: 0.15, seed: BRAND.seed + 30 });
  enso(frame, { radius: BLAST_R * 0.48, a0: Math.PI * 0.4, sweep: TAU * 0.8, width: 2.6, grow: smoothstep(0.1, 0.45, p), fade, dry: 0.4, core: lv(5), seed: BRAND.seed + 31 });
  seal(frame, 0, 0, 30, 0, { grow: smoothstep(0.15, 0.45, p), fade, heat: p < 0.6 ? 7 : 6, width: 3.2, seed: BRAND.seed + 32 });
  const crack = smoothstep(0.35, 0.7, p);
  if (crack > 0) {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU + 0.2;
      brushStroke(frame, { pts: [{ x: Math.cos(a) * 18, y: Math.sin(a) * 18 }, { x: Math.cos(a + 0.12) * BLAST_R * 0.4, y: Math.sin(a + 0.12) * BLAST_R * 0.4 }, { x: Math.cos(a) * BLAST_R * 0.66, y: Math.sin(a) * BLAST_R * 0.66 }], width: 1.8, grow: crack, fade, dry: 0.3, press: 0.05, core: lv(5), seed: BRAND.seed + 33 + i });
    }
  }
}

/** 烙火の爆ぜ（空中）: 印が縮んで溜め、墨が炎の舌のように放射に弾けて飛沫が四方へ */
function blastBurst(frame, f) {
  const frames = 9;
  const p = prog(f, frames);
  const burst = 2;
  if (f < burst) {
    inkBlot(frame, { radius: 8 + 4 * f, seed: BRAND.seed + 40, core: lv(7), coreWidth: 0.4 });
    return;
  }
  const q = (f - burst + 0.5) / (frames - burst);
  if (q < 0.4) inkBlot(frame, { radius: 16 * (1 - q), seed: BRAND.seed + 41, core: lv(7), coreWidth: 0.3 });
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * TAU + hash1(i, BRAND.seed + 42) * 0.4;
    const len = BLAST_R * (0.55 + 0.3 * hash1(i, BRAND.seed + 43));
    const pts = [];
    for (let k = 0; k <= 10; k++) {
      const t = k / 10;
      const w = Math.sin(t * 6 + i) * 0.12 * t;
      pts.push({ x: Math.cos(a + w) * (8 + len * t), y: Math.sin(a + w) * (8 + len * t) });
    }
    brushStroke(frame, { pts, width: 6, grow: smoothstep(0, 0.4, q), fade: smoothstep(0.45, 1, q), dry: 0.55, press: 0.1, tail: 0.5, core: lv(6), coreWidth: 0.14, seed: BRAND.seed + 44 + i });
  }
  splatter(frame, f - burst, 28, BRAND.seed + 45, (i, r) => {
    const a = r(1) * TAU;
    const sp = 4 + 7 * r(2);
    return { x: Math.cos(a) * 8, y: Math.sin(a) * 8, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, size: r(3) > 0.6 ? 2 : 1.1, life: 5 + Math.floor(2 * r(4)), level: r(5) > 0.6 ? 7 : 5 };
  });
  void p;
}

/** 烙印が倍に: 角印が押され、2 つに割れて左右へ分かれる */
function brandDouble(frame, f) {
  const frames = 7;
  const p = prog(f, frames);
  const split = smoothstep(0.25, 0.65, p);
  const fade = smoothstep(0.7, 1, p) * 0.8;
  const heat = p < 0.7 ? 7 : 6;
  if (split < 0.05) {
    seal(frame, 0, -14, 15, 0, { grow: smoothstep(0, 0.25, p) + 0.5, heat, seed: BRAND.seed + 60 });
    return;
  }
  seal(frame, -11 * split, -14 - 2 * split, 14, -0.2 * split, { grow: 1, fade, heat, seed: BRAND.seed + 61 });
  seal(frame, 11 * split, -14 - 2 * split, 14, 0.2 * split, { grow: 1, fade, heat, seed: BRAND.seed + 62 });
  splatter(frame, f - 2, 6, BRAND.seed + 63, (i, r) => ({ x: 0, y: -14, vx: (r(1) - 0.5) * 6, vy: -1 - 2 * r(2), size: 0.9, life: 4, level: 7 }));
}

// ---------------------------------------------------------------------------
// 瞬凍
// ---------------------------------------------------------------------------

const FREEZE = { radiusPx: 56, frames: 9, seed: 8201 };
const FREEZE_R = FREEZE.radiusPx * DPX;
const FREEZE_SPIKES = 12;

/** 霜の羊歯の棘（中心から外へ。途中で左右に短い枝） */
function frostSpike(i) {
  const r = (k) => hash1(i * 7 + k, FREEZE.seed + 3);
  const a = (i / FREEZE_SPIKES) * TAU + (r(1) - 0.5) * 0.25;
  const len = FREEZE_R * (0.6 + 0.35 * r(2));
  return { a, len, b1: 0.4 + 0.15 * r(3), b2: 0.65 + 0.12 * r(4) };
}
const SPIKES = Array.from({ length: FREEZE_SPIKES }, (_, i) => frostSpike(i));

/** 凍る（空中）: 一滴が落ち、霜の羊歯のように枝分かれする氷の棘が放射に走り、先で砕けて掠れる */
function freezeFlash(frame, f) {
  const p = prog(f, FREEZE.frames);
  const grow = smoothstep(0, 0.35, p);
  const fade = smoothstep(0.55, 1, p);
  if (p < 0.25) inkBlot(frame, { radius: 10 * (1 - p * 2), seed: FREEZE.seed + 1, core: lv(7) });
  SPIKES.forEach((s, i) => {
    const main = place(linePts(8, 0, s.len, 0, 10), s.a);
    brushStroke(frame, { pts: main, width: 5, grow, fade, dry: 0.35, press: 0.04, tail: 0.75, sharp: 1, core: lv(7), seed: FREEZE.seed + 10 + i });
    [s.b1, s.b2].forEach((b, j) => {
      const g = smoothstep(b * 0.35, b * 0.35 + 0.15, p);
      if (g <= 0) return;
      const at = 8 + (s.len - 8) * b;
      const side = j === 0 ? 1 : -1;
      const twig = place(linePts(at, 0, at + 12, side * 9, 4), s.a);
      brushStroke(frame, { pts: twig, width: 2.4, grow: g, fade, dry: 0.3, press: 0.04, tail: 0.7, sharp: 1, core: lv(7), seed: FREEZE.seed + 30 + i * 2 + j });
    });
  });
  if (f >= 4) {
    splatter(frame, f - 4, 18, FREEZE.seed + 50, (i, r) => {
      const s = SPIKES[i % FREEZE_SPIKES];
      return { x: Math.cos(s.a) * s.len, y: Math.sin(s.a) * s.len, vx: Math.cos(s.a + (r(1) - 0.5)) * (1.5 + 2 * r(2)), vy: Math.sin(s.a + (r(1) - 0.5)) * (1.5 + 2 * r(2)), size: r(3) > 0.5 ? 1.4 : 0.9, life: 4, level: r(4) > 0.5 ? 7 : 5 };
    });
  }
}

/** 凍った床（地面）: 円相がぴしりと速く閉じ、内側に冷えた墨の淡いむら（間引き） */
function freezeRing(frame, f) {
  const p = prog(f, FREEZE.frames);
  const fade = smoothstep(0.55, 1, p) * 0.9;
  inkWash(frame, { radius: FREEZE_R * 0.9, reach: smoothstep(0, 0.35, p), seed: FREEZE.seed + 60, rimWidth: 1.5, rimLevel: 4, tint: 6, density: 0.08 * (1 - fade), cell: 6 });
  enso(frame, { radius: FREEZE_R * 0.95, a0: -Math.PI / 2, sweep: TAU * 0.96, width: 4.5, grow: smoothstep(0, 0.25, p), fade, dry: 0.5, core: lv(7), seed: FREEZE.seed + 61 });
}

/** 氷塊: 凍った敵を六角に囲う 6 画の筆（芯は氷の差し色）と、中の面の筋 */
function freezeEncase(frame, f) {
  const frames = 8;
  const p = prog(f, frames);
  const R = 17;
  const fade = smoothstep(0.75, 1, p) * 0.6;
  const v = Array.from({ length: 6 }, (_, i) => {
    const a = (i / 6) * TAU - Math.PI / 2;
    return { x: Math.cos(a) * R, y: Math.sin(a) * R * 1.05 };
  });
  v.forEach((a, i) => {
    const b = v[(i + 1) % 6];
    const g = smoothstep(i * 0.06, i * 0.06 + 0.25, p);
    if (g <= 0) return;
    brushStroke(frame, { pts: linePts(a.x, a.y, b.x, b.y, 5), width: 3.2, grow: g, fade, dry: 0.3, press: 0.1, tail: 0.3, sharp: 0.5, core: lv(7), coreWidth: 0.35, seed: FREEZE.seed + 70 + i });
  });
  const facet = smoothstep(0.35, 0.6, p);
  if (facet > 0) {
    [0, 2, 4].forEach((i, j) => {
      const a = v[i];
      brushStroke(frame, { pts: linePts(a.x * 0.85, a.y * 0.85, a.x * 0.2, a.y * 0.2, 4), width: 1.6, grow: facet, fade, dry: 0.2, core: lv(6), seed: FREEZE.seed + 80 + j });
    });
  }
  splatter(frame, f, 8, FREEZE.seed + 90, (i, r) => {
    const a = r(1) * TAU;
    return { x: Math.cos(a) * R, y: Math.sin(a) * R, vx: Math.cos(a) * (2 + 2 * r(2)), vy: Math.sin(a) * (2 + 2 * r(2)), size: 0.9, life: 3, level: 7 };
  });
}

// ---------------------------------------------------------------------------
// 彩刻・色解き
// ---------------------------------------------------------------------------

const HUE = { etchRadiusPx: 34, etchHalf: 0.8, releaseRadiusPx: 50, seed: 8301 };
const ETCH_R = HUE.etchRadiusPx * DPX;
const RELEASE_R = HUE.releaseRadiusPx * DPX;
/** 菱の格子の目（ドット） */
const ETCH_CELL = 9;

/** 小さな菱の点（格子の交点に打つ。画面に揃う） */
const DIAMOND_DOT = ["..7..", ".757.", "75.57", ".757.", "..7.."];

/** 彩刻: 斬りの一筆が走り、その内側に菱の格子を細筆で彫り込む（芯は彩痕の色） */
function etchCone(frame, f) {
  const frames = 8;
  const p = prog(f, frames);
  const half = HUE.etchHalf;
  const fade = smoothstep(0.65, 1, p) * 0.8;
  brushStroke(frame, { pts: arcPoints(0, 0, ETCH_R * 0.9, -half, 2 * half, 30), width: 7, grow: smoothstep(0, 0.3, p), fade, dry: 0.5, seed: HUE.seed + 1 });
  const etch = smoothstep(0.25, 0.65, p);
  if (etch <= 0) return;
  const cx = ETCH_R * 0.58;
  const L = 22;
  for (let k = -2; k <= 2; k++) {
    for (const sgn of [1, -1]) {
      const d = { x: Math.SQRT1_2, y: sgn * Math.SQRT1_2 };
      const n = { x: -d.y, y: d.x };
      const ox = cx + n.x * k * ETCH_CELL;
      const oy = n.y * k * ETCH_CELL;
      const len = L - Math.abs(k) * 4;
      brushStroke(frame, { pts: linePts(ox - d.x * len, oy - d.y * len, ox + d.x * len, oy + d.y * len, 6), width: 1.9, grow: etch, fade, dry: 0.25, press: 0.05, tail: 0.4, core: lv(7), coreWidth: 0.5, seed: HUE.seed + 10 + (k + 2) * 2 + (sgn > 0 ? 0 : 1) });
    }
  }
  if (etch > 0.8 && fade < 0.5) {
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) if (Math.abs(i) + Math.abs(j) <= 1) stamp(frame, cx + (i + j) * ETCH_CELL * Math.SQRT1_2 * 0.7, (i - j) * ETCH_CELL * Math.SQRT1_2 * 0.7, DIAMOND_DOT);
  }
}

/** 色解きの花（地面）: 円相が囲い、真ん中から五弁の花の筆が開く */
function releaseBloom(frame, f) {
  const frames = 9;
  const p = prog(f, frames);
  const fade = smoothstep(0.6, 1, p) * 0.9;
  enso(frame, { radius: RELEASE_R * 0.9, a0: -Math.PI * 0.3, sweep: TAU * 0.9, width: 4, grow: smoothstep(0, 0.35, p), fade, dry: 0.5, seed: HUE.seed + 30 });
  const open = smoothstep(0.1, 0.55, p);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU - Math.PI / 2;
    const r0 = 8;
    const len = RELEASE_R * 0.5 * (0.5 + 0.5 * open);
    const wid = 11 * open;
    const pts = [];
    for (let k = 0; k <= 16; k++) {
      const t = k / 16;
      // 片側を外へ、もう片側を戻る（花弁の輪郭を一筆で）
      const u = t < 0.5 ? t * 2 : 2 - t * 2;
      const side = t < 0.5 ? 1 : -1;
      pts.push({ x: r0 + len * u, y: side * Math.sin(u * Math.PI) * wid * 0.5 });
    }
    brushStroke(frame, { pts: place(pts, a), width: 2.6, grow: open, fade, dry: 0.3, press: 0.1, tail: 0.3, core: lv(6), coreWidth: 0.3, seed: HUE.seed + 31 + i });
  }
}

/** 色解きの爆ぜ（空中）: 菱の欠片が放射に弾け、飛沫が散る */
function releaseBurst(frame, f) {
  const frames = 9;
  const p = prog(f, frames);
  if (p < 0.2) inkBlot(frame, { radius: 9, seed: HUE.seed + 40, core: lv(7), coreWidth: 0.4 });
  for (let i = 0; i < 10; i++) {
    const r = (k) => hash1(i * 5 + k, HUE.seed + 41);
    const a = (i / 10) * TAU + r(1) * 0.4;
    const k = 1 - Math.pow(0.6, f + 1);
    const dist = 8 + RELEASE_R * (0.55 + 0.35 * r(2)) * k;
    if (p > 0.6 + 0.35 * r(3)) continue;
    const len = 15 + 6 * r(4);
    inkPoly(frame, place(rhombus(len, len * 0.55), a, Math.cos(a) * dist, Math.sin(a) * dist), { rim: 6, fill: 5, rimW: 1.4 });
    brushStroke(frame, { pts: place(linePts(-len * 0.3, 0, len * 0.3, 0, 3), a, Math.cos(a) * dist, Math.sin(a) * dist), width: 1.4, dry: 0, core: lv(7), body: lv(7), edge: lv(6), seed: HUE.seed + 60 + i });
  }
  splatter(frame, f, 18, HUE.seed + 42, (i, r) => {
    const a = r(1) * TAU;
    return { x: Math.cos(a) * 6, y: Math.sin(a) * 6, vx: Math.cos(a) * (3 + 5 * r(2)), vy: Math.sin(a) * (3 + 5 * r(2)), size: r(3) > 0.5 ? 1.4 : 0.9, life: 5, level: 5 };
  });
}

/** 色爆（彩痕の敵）: 菱の印が割れて 4 つの欠片が飛び、間から花弁の払いが開く（芯は色の差し色） */
function releasePop(frame, f) {
  const frames = 7;
  const p = prog(f, frames);
  const fade = smoothstep(0.6, 1, p);
  if (p < 0.25) inkPoly(frame, rhombus(16, 12), { rim: 5, fill: 7, rimW: 1.5 });
  const k = smoothstep(0.15, 0.7, p);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU;
    if (fade < 0.9) inkPoly(frame, place(rhombus(7, 5), a, Math.cos(a) * (4 + 12 * k), Math.sin(a) * (4 + 12 * k)), { rim: 5, fill: 7, rimW: 1 });
    const b = a + Math.PI / 4;
    brushStroke(frame, { pts: place([{ x: 4, y: 0 }, { x: 10, y: 2 }, { x: 17, y: 0 }], b), width: 3, grow: k, fade, dry: 0.3, tail: 0.6, core: lv(7), coreWidth: 0.35, seed: HUE.seed + 50 + i });
  }
}

// ---------------------------------------------------------------------------
// 死の宣告
// ---------------------------------------------------------------------------

const DOOM = { radiusPx: 24, frames: 10, seed: 8501 };
const DOOM_R = DOOM.radiusPx * DPX;
/** 砂時計の中心の高さ（敵の頭上。ドット） */
const DOOM_GLASS_Y = -64;

/** 文字盤（地面）: 円相・12 の目盛り・戻っていく 1 本の針 */
function doomSigil(frame, f) {
  const p = prog(f, DOOM.frames);
  const fade = smoothstep(0.7, 1, p) * 0.8;
  enso(frame, { radius: DOOM_R * 0.92, a0: -Math.PI / 2, sweep: TAU * 0.95, width: 4, grow: smoothstep(0, 0.3, p), fade, dry: 0.5, coreWidth: 0.15, seed: DOOM.seed + 1 });
  for (let i = 0; i < 12; i++) {
    const g = smoothstep(0.1 + i * 0.025, 0.2 + i * 0.025, p);
    if (g <= 0) continue;
    const a = (i / 12) * TAU - Math.PI / 2;
    const major = i % 3 === 0;
    const r0 = DOOM_R * (major ? 0.58 : 0.68);
    brushStroke(frame, { pts: linePts(Math.cos(a) * r0, Math.sin(a) * r0, Math.cos(a) * DOOM_R * 0.8, Math.sin(a) * DOOM_R * 0.8, 3), width: major ? 2.6 : 1.6, grow: g, fade, dry: 0.2, press: 0.2, seed: DOOM.seed + 10 + i });
  }
  // 針: 12 時から反時計回りに戻る（残りの時を刻む）
  const hand = -Math.PI / 2 - TAU * 0.2 * smoothstep(0.3, 1, p);
  const hg = smoothstep(0.2, 0.4, p);
  if (hg > 0) brushStroke(frame, { pts: linePts(0, 0, Math.cos(hand) * DOOM_R * 0.62, Math.sin(hand) * DOOM_R * 0.62, 5), width: 3, grow: hg, fade, dry: 0.2, press: 0.3, tail: 0.5, core: lv(7), seed: DOOM.seed + 30 });
  if (hg > 0) inkBlot(frame, { radius: 3, seed: DOOM.seed + 31, core: lv(7) });
}

/** 宣告（空中）: 頭上に筆の砂時計が書かれて砂が落ち、上から下へ宣告の縦の一筆が下ろされ、止めの墨だまりが跳ねる */
function doomMark(frame, f) {
  const p = prog(f, DOOM.frames);
  const fade = smoothstep(0.7, 1, p) * 0.9;
  const gy = DOOM_GLASS_Y;
  const glass = smoothstep(0, 0.3, p);
  // 砂時計: 上下の横棒と、交差する 2 本の斜め（くびれ）
  const parts = [
    linePts(-13, gy - 17, 13, gy - 17, 5),
    linePts(-13, gy + 17, 13, gy + 17, 5),
    [{ x: -10, y: gy - 16 }, { x: -1.5, y: gy }, { x: -10, y: gy + 16 }],
    [{ x: 10, y: gy - 16 }, { x: 1.5, y: gy }, { x: 10, y: gy + 16 }],
  ];
  parts.forEach((pts, i) => brushStroke(frame, { pts, width: i < 2 ? 3.6 : 2.6, grow: glass, fade, dry: 0.3, press: 0.15, tail: 0.3, sharp: 0.5, seed: DOOM.seed + 40 + i }));
  if (glass > 0.6 && fade < 0.6) {
    // 落ちる砂（差し色の粒）と、下に溜まった砂
    for (let k = 0; k < 4; k++) dot(frame, 0, gy + 1 + ((f * 3 + k * 4) % 14), 7);
    const pile = 3 + 5 * p;
    for (let x = -pile; x <= pile; x += 0.5) for (let h = 0; h <= (pile - Math.abs(x)) * 0.5; h += 0.5) dot(frame, x, gy + 15 - h, 6);
    const top = 7 * (1 - p);
    for (let x = -top; x <= top; x += 0.5) dot(frame, x, gy - 11, 6);
  }
  // 宣告の縦の一筆
  const down = smoothstep(0.3, 0.55, p);
  if (down > 0) brushStroke(frame, { pts: linePts(0, gy + 22, 0, -4, 10), width: 7, grow: down, fade, dry: 0.45, press: 0.15, tail: 0.15, sharp: 0.2, core: lv(7), coreWidth: 0.2, seed: DOOM.seed + 50 });
  if (down >= 0.99) {
    const age = f - Math.ceil(0.55 * DOOM.frames - 0.5);
    if (p < 0.9) inkBlot(frame, { y: -2, radius: 7 + 1.5 * Math.min(2, age), seed: DOOM.seed + 51, core: lv(7) });
    splatter(frame, age, 12, DOOM.seed + 52, (i, r) => {
      const a = Math.PI + r(1) * Math.PI;
      return { x: 0, y: -2, vx: Math.cos(a) * (2 + 4 * r(2)), vy: Math.sin(a) * (1 + 2 * r(2)) + 1, size: r(3) > 0.5 ? 1.5 : 0.9, life: 4, level: r(4) > 0.5 ? 7 : 5 };
    });
  }
}

// ---------------------------------------------------------------------------
// 移ろい刃
// ---------------------------------------------------------------------------

const SHIFT = { radiusPx: 34, half: 0.8, seed: 8601 };
const SHIFT_R = SHIFT.radiusPx * DPX;
/** 印の大きさ（ドット。前回の 5〜7 ドットでは小さすぎて読めなかった） */
const GLYPH = 1.45;

// 印は墨の影絵（濃墨の面）に、差し色の芯（段 7）を細く入れる。上（-y）が印の上。小さくても形が読めるよう面で描く

/** 炎の印: 三つ又に揺れる炎の影絵 */
const GLYPH_FLAME = {
  body: [
    { x: 0, y: 10 }, { x: -6, y: 7 }, { x: -8, y: 0 }, { x: -6.5, y: -6 }, { x: -4, y: -2.5 }, { x: -3, y: -10 },
    { x: 0, y: -5 }, { x: 2, y: -14 }, { x: 4, y: -5 }, { x: 6.5, y: -8 }, { x: 7.5, y: -1 }, { x: 6, y: 7 },
  ],
  core: [{ x: 0, y: 7 }, { x: 0.5, y: 0 }, { x: 1.5, y: -6 }],
};
/** 雷の印: 折れる稲妻の影絵 */
const GLYPH_BOLT = {
  body: [
    { x: 2, y: -14 }, { x: -5.5, y: 1 }, { x: -0.5, y: 1 }, { x: -3.5, y: 14 }, { x: 6.5, y: -2.5 }, { x: 1.5, y: -2.5 }, { x: 6, y: -14 },
  ],
  core: [{ x: 3.5, y: -11 }, { x: -1.5, y: -0.5 }, { x: 2.5, y: -0.5 }, { x: -1.5, y: 9 }],
};
/** 雫の印: 上が尖る雫の影絵 */
const GLYPH_DROP = {
  body: Array.from({ length: 24 }, (_, i) => {
    const a = (i / 24) * TAU;
    // 下は半径 7 の丸、上は細って尖る
    const up = Math.max(0, -Math.sin(a));
    const r = 7 * (1 - 0.85 * up ** 1.5);
    return { x: Math.cos(a) * r, y: 4 + Math.sin(a) * (Math.sin(a) < 0 ? 18 : 7) };
  }),
  core: [{ x: -3, y: 6 }, { x: -3.5, y: 2 }, { x: -2, y: -2 }],
};

/** 影絵の印を 1 つ（中心 at・向き a・大きさ k）。grow で膨らみながら現れ、fade で掠れる */
function glyphSilhouette(frame, g, at, a, k, grow, fade, seed) {
  if (grow <= 0) return;
  const kk = k * (0.6 + 0.4 * grow);
  inkPoly(frame, place(g.body, a, at.x, at.y, kk), { rim: 6, fill: 5, rimW: 1.2, fade: fade * 0.9, seed });
  brushStroke(frame, { pts: place(g.core, a, at.x, at.y, kk), width: 1.6 * k, grow, fade, dry: 0, core: lv(7), body: lv(7), edge: lv(6), seed: seed + 1 });
}

/** 氷の印: 3 本の線が交わる六花（先に小さな枝）の筆 */
function glyphIce(frame, at, a, k, grow, fade, seed) {
  if (grow <= 0) return;
  for (let i = 0; i < 3; i++) {
    const b = (i / 3) * Math.PI + Math.PI / 2;
    const pts = linePts(-Math.cos(b) * 12, -Math.sin(b) * 12, Math.cos(b) * 12, Math.sin(b) * 12, 6);
    brushStroke(frame, { pts: place(pts, a, at.x, at.y, k), width: 3.4 * k, grow, fade, dry: 0.2, press: 0.1, tail: 0.3, sharp: 0.6, core: lv(7), coreWidth: 0.35, seed: seed + i });
  }
  for (let i = 0; i < 6; i++) {
    const b = (i / 6) * TAU + Math.PI / 2;
    const bx = Math.cos(b) * 8;
    const by = Math.sin(b) * 8;
    const pts = [{ x: bx + Math.cos(b + 0.9) * 4, y: by + Math.sin(b + 0.9) * 4 }, { x: bx, y: by }, { x: bx + Math.cos(b - 0.9) * 4, y: by + Math.sin(b - 0.9) * 4 }];
    brushStroke(frame, { pts: place(pts, a, at.x, at.y, k), width: 2 * k, grow, fade, dry: 0, core: lv(6), seed: seed + 5 + i });
  }
}

/** 炎の床の印（火吸いの吸われる炎にも使う） */
function glyphFlame(frame, at, a, k, grow, fade, seed) {
  glyphSilhouette(frame, GLYPH_FLAME, at, a, k, grow, fade, seed);
}

const SHIFT_GLYPHS = [
  glyphFlame,
  glyphIce,
  (frame, at, a, k, grow, fade, seed) => glyphSilhouette(frame, GLYPH_BOLT, at, a, k, grow, fade, seed),
  (frame, at, a, k, grow, fade, seed) => glyphSilhouette(frame, GLYPH_DROP, at, a, k, grow, fade, seed),
];

/** 移ろい刃: 三日月の一筆が走り、その上に炎・氷・雷・雫の筆の印が順に書かれる（芯は今の属性の差し色） */
function shiftCone(frame, f) {
  const frames = 8;
  const p = prog(f, frames);
  const half = SHIFT.half;
  const grow = smoothstep(0, 0.35, p);
  const fade = smoothstep(0.6, 1, p) * 0.85;
  brushStroke(frame, { pts: arcPoints(0, 0, SHIFT_R * 0.62, -half, 2 * half, 30), width: 7, grow, fade, dry: 0.5, coreWidth: 0.16, seed: SHIFT.seed + 1 });
  SHIFT_GLYPHS.forEach((glyph, i) => {
    const t = (i + 0.5) / SHIFT_GLYPHS.length;
    const a = -half + 2 * half * t;
    const g = smoothstep(t * 0.35 + 0.05, t * 0.35 + 0.3, p);
    const r = SHIFT_R * 0.98;
    // 印の上（-y）を外向きに立てる
    glyph(frame, { x: Math.cos(a) * r, y: Math.sin(a) * r }, a + Math.PI / 2, GLYPH, g, fade, SHIFT.seed + 10 + i * 10);
  });
  if (f >= 2) splatter(frame, f - 2, 10, SHIFT.seed + 60, (i, r) => {
    const a = -half + 2 * half * r(1);
    return { x: Math.cos(a) * SHIFT_R * 0.75, y: Math.sin(a) * SHIFT_R * 0.75, vx: Math.cos(a) * (2 + 3 * r(2)), vy: Math.sin(a) * (2 + 3 * r(2)), size: r(3) > 0.5 ? 1.4 : 0.9, life: 4, level: r(4) > 0.5 ? 7 : 5 };
  });
}

// ---------------------------------------------------------------------------
// 結界杭
// ---------------------------------------------------------------------------

const STAKE = { seed: 8801, height: 34 };
const STAKE_STEP_PX = 12;
const STAKE_FRAMES = 8;

/** 杭: 頭（上）で押して太く、先（下）で尖る縦の一筆。札の長方形と、紙垂（ジグザグ）。sway は紙垂の揺れ */
function stakeShape(frame, oy, sway, seed) {
  const H = STAKE.height;
  // 杭は札の上下に分けて書く（札の白地を残して形を読ませる）
  brushStroke(frame, { pts: linePts(0, oy - H + 1, 0, oy - 25, 3), width: 2.6, dry: 0, press: 0.3, tail: 0.1, sharp: 0, seed });
  brushStroke(frame, { pts: linePts(0, oy - 8, 0, oy, 4), width: 3.6, dry: 0.1, press: 0.05, tail: 0.8, sharp: 1, seed: seed + 9 });
  brushStroke(frame, { pts: linePts(-4, oy - H, 4, oy - H, 4), width: 2.2, dry: 0, seed: seed + 1 });
  // 札: 杭より幅の広い縁取りの長方形と、中の字の 2 画（縦と横）
  inkPoly(frame, [{ x: -6, y: oy - 25 }, { x: 6, y: oy - 25 }, { x: 6.5, y: oy - 9 }, { x: -5.5, y: oy - 9 }], { rim: 6, fill: -1, rimW: 1.3 });
  brushStroke(frame, { pts: linePts(0, oy - 22, 0.5, oy - 12, 4), width: 1.4, dry: 0, core: lv(6), seed: seed + 6 });
  brushStroke(frame, { pts: linePts(-3, oy - 19, 3, oy - 19, 3), width: 1.2, dry: 0, core: lv(6), seed: seed + 7 });
  // 紙垂: 杭の頭から横へ下がるジグザグ
  const z = [
    { x: 5, y: oy - H + 1 },
    { x: 11 + sway, y: oy - H + 3 },
    { x: 8 + sway, y: oy - H + 6 },
    { x: 13 + sway * 1.5, y: oy - H + 9 },
    { x: 10 + sway * 1.5, y: oy - H + 12 },
  ];
  brushStroke(frame, { pts: z, width: 1.5, dry: 0, core: lv(5), press: 0.05, tail: 0.2, seed: seed + 8 });
}

/** 打ち込み: 杭が上から落ちて刺さり、地面に楕円の波紋と飛沫 */
function stakeDrive(frame, f) {
  const frames = 8;
  const p = prog(f, frames);
  const drop = smoothstep(0, 0.3, p);
  stakeShape(frame, -18 * (1 - drop), Math.sin(p * 8) * 2, STAKE.seed);
  if (drop < 1) return;
  const age = f - 2;
  const t = smoothstep(0, 1, age / 5);
  thinRing(frame, 0, 0, 6 + 16 * t, 1.6 * (1 - t) + 0.6, 5, 0.45);
  if (age < 2) inkBlot(frame, { radius: 5, seed: STAKE.seed + 20, core: lv(6) });
  splatter(frame, age, 12, STAKE.seed + 21, (i, r) => {
    const a = r(1) * TAU;
    return { x: 0, y: 0, vx: Math.cos(a) * (2 + 4 * r(2)), vy: Math.sin(a) * (1 + 2 * r(2)) - 1.5, size: r(3) > 0.5 ? 1.4 : 0.9, life: 4, level: 6 };
  });
}

/** 立っている杭（空中）: 杭と札、風に揺れる紙垂 */
function stakeStand(frame, f) {
  stakeShape(frame, 0, Math.sin((f / STAKE_FRAMES) * TAU) * 2, STAKE.seed);
}

/** 杭の根元（地面）: 小さな墨だまりと、ゆっくり巡る点線の楕円 */
function stakeGlow(frame, f) {
  inkBlot(frame, { radius: 3.5, seed: STAKE.seed + 30, core: lv(6) });
  const turn = (f / STAKE_FRAMES) * TAU;
  for (let i = 0; i < 8; i++) {
    const a = turn + (i / 8) * TAU;
    dot(frame, Math.cos(a) * 11, Math.sin(a) * 5, 5);
    dot(frame, Math.cos(a + 0.08) * 11, Math.sin(a + 0.08) * 5, 5);
  }
}

/** 線が削る（杭の所）: 杭の根元から小さく墨が跳ねる */
function stakeSpark(frame, f) {
  thinRing(frame, 0, 0, 5 + 3 * f, 1.2, 5, 0.45);
  splatter(frame, f, 8, STAKE.seed + 40, (i, r) => {
    const a = r(1) * TAU;
    return { x: 0, y: -8, vx: Math.cos(a) * (1.5 + 2 * r(2)), vy: Math.sin(a) * (1.5 + 2 * r(2)) - 1, size: 1, life: 4, level: r(3) > 0.5 ? 7 : 5 };
  });
}

/** 注連縄（beam の 1 区間）: 二本撚りの筆の縄（区間の両端で継ぎ目が揃う周期）と、垂れる紙垂。コマで撚りが震える */
function stakeLine(frame, f) {
  const frames = 6;
  const half = STAKE_STEP_PX + 0.6;
  const period = STAKE_STEP_PX * DPX;
  const ph = (f / frames) * TAU * 0.25;
  paint(
    frame,
    (x, y) => {
      if (x < -half || x > half) return -1;
      const s = (x / period) * TAU * 2;
      const y1 = 2.2 * Math.sin(s + ph);
      const y2 = 2.2 * Math.sin(s + ph + Math.PI);
      const d1 = Math.abs(y - y1);
      const d2 = Math.abs(y - y2);
      if (Math.min(d1, d2) > 1.1) return -1;
      // 前に来ている方の撚りを濃く
      const front = Math.cos(s + ph) > 0 ? d1 <= 1.1 : d2 <= 1.1;
      return front ? lv(6) : lv(4);
    },
    { bounds: { x0: -half, y0: -5, x1: half, y1: 5 }, dither: 0 },
  );
  const sway = Math.sin((f / frames) * TAU) * 1.2;
  const z = [
    { x: 0, y: 3 },
    { x: 3 + sway, y: 6 },
    { x: 0 + sway, y: 9 },
    { x: 3 + sway * 1.5, y: 12 },
  ];
  for (let i = 1; i < z.length; i++) {
    const a = z[i - 1];
    const b = z[i];
    for (let t = 0; t <= 1; t += 0.12) dot(frame, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, 5);
  }
}

// ---------------------------------------------------------------------------
// 泥沼
// ---------------------------------------------------------------------------

const MIRE = { radiusPx: 30, frames: 9, seed: 8901 };
const MIRE_R = MIRE.radiusPx * DPX;
const MIRE_PLACED_FRAMES = 10;

/** 撒く（空中）: 真ん中に泥が叩きつけられ、泥の塊が弧を描いて飛んで落ち、落ちた所で跳ねる */
function mireSplash(frame, f) {
  const p = prog(f, MIRE.frames);
  if (p < 0.35) inkBlot(frame, { radius: 14 * (1 - p), seed: MIRE.seed + 1, core: lv(6) });
  for (let i = 0; i < 9; i++) {
    const r = (k) => hash1(i * 7 + k, MIRE.seed + 2);
    const a = (i / 9) * TAU + r(1) * 0.5;
    const at = MIRE_R * (0.5 + 0.45 * r(2));
    const t = smoothstep(0, 0.55, p);
    const x = Math.cos(a) * at * t;
    const y = Math.sin(a) * at * t - 16 * Math.sin(t * Math.PI);
    if (t < 1) inkBlot(frame, { x, y, radius: 3 + 2 * r(3), seed: MIRE.seed + 10 + i, core: lv(5) });
    else if (p < 0.85) splatter(frame, f - 5, 3, MIRE.seed + 20 + i, (j, q) => ({ x, y, vx: (q(1) - 0.5) * 5, vy: -1 - 2 * q(2), size: 1.1, life: 3, level: 5 }));
  }
}

/** 広がる（地面）: 淡墨の滲みが広がり、内側に泥の渦の筆が 2 本巻く */
function mireSpread(frame, f) {
  const p = prog(f, MIRE.frames);
  const reach = smoothstep(0, 0.6, p);
  inkWash(frame, { radius: MIRE_R, reach, seed: MIRE.seed + 30, rimWidth: 3, rimLevel: 5, tint: 3, density: 0.35, cell: 7 });
  for (let i = 0; i < 2; i++) {
    const pts = [];
    for (let k = 0; k <= 24; k++) {
      const t = k / 24;
      const a = i * Math.PI + t * 3.4;
      const r = MIRE_R * reach * (0.15 + 0.55 * t);
      pts.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
    }
    brushStroke(frame, { pts, width: 2.6, grow: smoothstep(0.1, 0.7, p), dry: 0.5, press: 0.2, seed: MIRE.seed + 31 + i });
  }
}

/** 泡（置いてある間）: 泥の泡が小さな輪で膨らみ、弾けて飛沫になる */
function mireBubble(frame, f) {
  for (let i = 0; i < 7; i++) {
    const r = (k) => hash1(i * 5 + k, MIRE.seed + 40);
    const a = r(1) * TAU;
    const at = MIRE_R * 0.8 * Math.sqrt(r(2));
    const x = Math.cos(a) * at;
    const y = Math.sin(a) * at;
    const ph = (f / MIRE_PLACED_FRAMES + r(3)) % 1;
    if (ph < 0.7) {
      const rr = 1.5 + 4 * (ph / 0.7);
      thinRing(frame, x, y, rr, 1.3, 5, 0.85);
      dot(frame, x - rr * 0.3, y - rr * 0.4, 4);
    } else if (ph < 0.9) {
      const age = (ph - 0.7) / 0.2;
      for (let k = 0; k < 5; k++) {
        const b = (k / 5) * TAU + r(4);
        dot(frame, x + Math.cos(b) * (4 + 4 * age), y + Math.sin(b) * (3 + 3 * age) - 2 * age, 5);
      }
    }
  }
}

/** 掴む（沈む敵の足元）: 泥の指が 5 本、足元の輪から上へ曲がって伸び、掴んで沈む */
function mireGrip(frame, f) {
  const frames = 8;
  const p = prog(f, frames);
  const reach = smoothstep(0, 0.4, p) * (1 - smoothstep(0.7, 1, p) * 0.7);
  thinRing(frame, 0, 6, 13, 2, 5, 0.4);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU + 0.3;
    const bx = Math.cos(a) * 13;
    const by = 6 + Math.sin(a) * 5;
    const pts = [
      { x: bx, y: by },
      { x: bx * 0.9, y: by - 8 * reach },
      { x: bx * 0.45, y: by - 15 * reach },
    ];
    if (reach > 0.05) brushStroke(frame, { pts, width: 3.4, fade: smoothstep(0.75, 1, p), dry: 0.35, press: 0.1, tail: 0.55, seed: MIRE.seed + 50 + i });
  }
}

// ---------------------------------------------------------------------------
// 絵の表
// ---------------------------------------------------------------------------

const FX = {
  skills: {
    waterJar: {
      ramp: "steel",
      cast: { sheet: "skillWave2.jarBreak", life: 0.55, base: JAR.radiusPx, ground: "skillWave2.jarSplash" },
    },
    oilPot: {
      ramp: "steel",
      cast: { sheet: "skillWave2.oilPour", life: 0.55, base: OIL.radiusPx, ground: "skillWave2.oilSplat" },
    },
    levelGround: {
      ramp: "steel",
      // pos = 踏み込んだ所（鏝の一画）、to = 帯の終点（止め）。帯は pos → to に並べる
      cast: { sheet: "skillWave2.levelStomp", life: 0.45, beam: { sheet: "skillWave2.levelBeam", step: LEVEL_STEP_PX }, tip: "skillWave2.levelTip" },
      act: { sheet: "skillWave2.levelRubble", life: 0.4 },
    },
    emberDraw: {
      ramp: "fire",
      cast: { sheet: "skillWave2.emberSwirl", life: 0.45, base: EMBER.radiusPx },
      act: { sheet: "skillWave2.emberPuff", life: 0.35, beam: { sheet: "skillWave2.emberStream", step: EMBER_STEP_PX } },
      fly: { sheet: "skillWave2.emberBall", base: 4, period: 0.4 },
    },
    brandSear: {
      ramp: "fire",
      cast: { sheet: "skillWave2.searCone", life: 0.5, base: BRAND.searRadiusPx },
    },
    brandBlast: {
      ramp: "fire",
      cast: { sheet: "skillWave2.blastBurst", life: 0.55, base: BRAND.blastRadiusPx, ground: "skillWave2.blastSigil" },
      act: { sheet: "skillWave2.brandDouble", life: 0.45 },
    },
    flashFreeze: {
      ramp: "ice",
      cast: { sheet: "skillWave2.freezeFlash", life: 0.5, base: FREEZE.radiusPx, ground: "skillWave2.freezeRing" },
      act: { sheet: "skillWave2.freezeEncase", life: 0.6 },
    },
    hueEtch: {
      ramp: "steel",
      cast: { sheet: "skillWave2.etchCone", life: 0.5, base: HUE.etchRadiusPx },
    },
    hueRelease: {
      ramp: "steel",
      cast: { sheet: "skillWave2.releaseBurst", life: 0.5, base: HUE.releaseRadiusPx, ground: "skillWave2.releaseBloom" },
      act: { sheet: "skillWave2.releasePop", life: 0.4 },
    },
    doomSentence: {
      ramp: "dark",
      cast: { sheet: "skillWave2.doomMark", life: 0.9, base: DOOM.radiusPx, ground: "skillWave2.doomSigil" },
    },
    shiftingEdge: {
      ramp: "steel",
      cast: { sheet: "skillWave2.shiftCone", life: 0.45, base: SHIFT.radiusPx },
    },
    wardStake: {
      ramp: "steel",
      cast: { sheet: "skillWave2.stakeDrive", life: 0.4 },
      placed: { sheet: "skillWave2.stakeStand", base: 0, period: 1.2, ground: "skillWave2.stakeGlow" },
      act: { sheet: "skillWave2.stakeSpark", life: 0.4, beam: { sheet: "skillWave2.stakeLine", step: STAKE_STEP_PX } },
    },
    mire: {
      ramp: "steel",
      cast: { sheet: "skillWave2.mireSplash", life: 0.5, base: MIRE.radiusPx, ground: "skillWave2.mireSpread" },
      placed: { sheet: "skillWave2.mireBubble", base: MIRE.radiusPx, period: 1.8 },
      act: { sheet: "skillWave2.mireGrip", life: 0.45 },
    },
  },
};

const S = (key, dirs, frames, size, draw, extra = {}) => ({ key: `skillWave2.${key}`, dirs, frames, active: 0, size, draw, ...extra });
const NO_INK = { ink: false };

export const ATLAS = {
  key: "skillWave2",
  fx: FX,
  sheets: [
    S("jarBreak", 1, JAR.frames, sheetSize(JAR.radiusPx, 20), jarBreak),
    S("jarSplash", 1, JAR.frames, sheetSize(JAR.radiusPx, 10), jarSplash),
    S("oilPour", 1, OIL.frames, sheetSize(OIL.radiusPx, 20), oilPour),
    S("oilSplat", 1, OIL.frames, sheetSize(OIL.radiusPx, 20), oilSplat),
    S("levelStomp", DIRS, LEVEL.frames, 96, levelStomp),
    S("levelBeam", 1, LEVEL.frames, 72, levelBeam, NO_INK),
    S("levelTip", DIRS, LEVEL.frames, 120, levelTip),
    S("levelRubble", 1, 7, 72, levelRubble),
    S("emberSwirl", 1, EMBER.frames, sheetSize(EMBER.radiusPx, 16), emberSwirl),
    S("emberPuff", 1, 7, 48, emberPuff),
    S("emberStream", 1, 8, 40, emberStream, NO_INK),
    S("emberBall", DIRS, 8, 72, emberBall),
    S("searCone", DIRS, 8, sheetSize(BRAND.searRadiusPx, 24), searCone),
    S("blastSigil", 1, 9, sheetSize(BRAND.blastRadiusPx, 12), blastSigil),
    S("blastBurst", 1, 9, sheetSize(BRAND.blastRadiusPx, 30), blastBurst),
    S("brandDouble", 1, 7, 64, brandDouble),
    S("freezeFlash", 1, FREEZE.frames, sheetSize(FREEZE.radiusPx, 24), freezeFlash),
    S("freezeRing", 1, FREEZE.frames, sheetSize(FREEZE.radiusPx, 12), freezeRing),
    S("freezeEncase", 1, 8, 64, freezeEncase),
    S("etchCone", DIRS, 8, sheetSize(HUE.etchRadiusPx, 16), etchCone),
    S("releaseBurst", 1, 9, sheetSize(HUE.releaseRadiusPx, 24), releaseBurst),
    S("releaseBloom", 1, 9, sheetSize(HUE.releaseRadiusPx, 12), releaseBloom),
    S("releasePop", 1, 7, 64, releasePop),
    S("doomSigil", 1, DOOM.frames, sheetSize(DOOM.radiusPx, 10), doomSigil),
    S("doomMark", 1, DOOM.frames, sheetSize(DOOM.radiusPx, 60), doomMark),
    S("shiftCone", DIRS, 8, sheetSize(SHIFT.radiusPx, 30), shiftCone),
    S("stakeDrive", 1, 8, 110, stakeDrive),
    S("stakeStand", 1, STAKE_FRAMES, 80, stakeStand),
    S("stakeGlow", 1, STAKE_FRAMES, 40, stakeGlow),
    S("stakeSpark", 1, 6, 64, stakeSpark),
    S("stakeLine", 1, 6, 40, stakeLine, NO_INK),
    S("mireSplash", 1, MIRE.frames, sheetSize(MIRE.radiusPx, 40), mireSplash),
    S("mireSpread", 1, MIRE.frames, sheetSize(MIRE.radiusPx, 20), mireSpread),
    S("mireBubble", 1, MIRE_PLACED_FRAMES, sheetSize(MIRE.radiusPx, 12), mireBubble),
    S("mireGrip", 1, 8, 64, mireGrip),
  ],
};
