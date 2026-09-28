// スキル石: 第 2 弾（地形・新しい状態異常・属性・武器種・空間。docs/ideas/fx-sprites.md 10 章）。単位は絵のドット（論理 0.5px）。
// 正準の向きは +x（撃つ・振る向き）。絵の大きさはスキルの数値（src/data/balance/skills/WAVE2_SKILL_TUNING/）の半径 × 2 ドットで描き、
// 表の base にその半径（px）を書く。地形（水・油・泥・炎・氷）は地形の層が描くので、ここでは「置く瞬間」の演出に絞る
//
// - 水瓶（waterJar）: 水瓶が落ちて割れ、陶片と水の王冠が跳ね、床に波紋が広がる
// - 油流し（oilPot）: 油壺が割れ、黒い油の塊が糸を引いて飛び、床に艶のある油溜まりが散る
// - 焼き払い（scorchLine）: 手元の火口から炎の帯が走り（beam）、先で炎が噴き上がる
// - 凍て道（iceSlide）: 蹴り出しの霜、滑走中の氷の飛沫、止まった所の氷の削り飛沫と通った跡のスケートの溝
// - 地均し（levelGround）: 踏み込みの地割れが前へ走り、石板がめくれて砕ける（beam）。砕いたマスごとに瓦礫が跳ねる
// - 火吸い（emberDraw）: 周りの炎が渦を巻いて手元の火球へ吸い込まれる。炎の床からは火の粉の流れ（beam）。飛ぶ火球
// - 沼呼び（bogCall）: 毒の泥が湧いて広がり、泡が膨らんで弾け、毒気が立つ
// - 焼き印（brandSear）: 前方を熱波が焼き、烙印の紋が 2 つ赤熱して冷える
// - 烙火（brandBlast）: 大きな烙印の紋が浮かび、炎の柱が放射に噴き出す。烙印が倍になる敵には紋が 2 つに割れる
// - 崩し蹴り（breakKick）: 蹴りの弧と、先の衝撃の星形と崩れのひび
// - 崩落槌（collapseHammer）: 大槌の頭が前方へ叩き下ろされ、扇の床が割れて瓦礫が跳ねる
// - 水刃（tideSlash）: 飛ぶ水の三日月（泡の巻き波としぶき）
// - 瞬凍（flashFreeze）: 一瞬の白い閃光から氷の棘が放射に走る。凍った敵は六角の氷塊に閉じ込められる
// - 彩刻（hueEtch）: 斬撃の跡に菱形の格子の彫り跡が刻まれてきらめく（色は刻んだ彩痕の色）
// - 色解き（hueRelease）: 菱形の結晶片が放射に弾け、花弁の輪が広がる。彩痕の敵ではその色で結晶が割れる
// - 吸魔の矢（siphonMark）: 弓弦の閃きと、螺旋の吸い込みを纏う矢
// - 死の宣告（doomSentence）: 時計の文字盤の魔法陣と、頭上の砂時計から落ちる宣告の杭
// - 移ろい刃（shiftingEdge）: 斬撃の縁に炎・氷の結晶・稲妻・毒の滴が並ぶ（配色は今の属性）
// - 極意（weaponArt）: 気合いの四芒星。面の技（扇・円）は大きな半月の薙ぎ、線の技（突き・先端）は突きの光条、魔弾は光弾
// - 結界杭（wardStake）: 札を下げた杭が打ち込まれ、杭同士を光の鎖が結ぶ（beam）
// - 泥沼（mire）: 泥の塊が撒かれて広がり、泡が弾け続ける。沈む敵の足元を泥が掴む
import { arcLine, crescent, lens, ring, shards, streakLine } from "../shapes.mjs";
import { clamp01, dot, glint, hash1, hash2, paint, segment, smoothstep, stamp, valueNoise } from "../raster.mjs";
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

/** 太い線分（一定の明るさ）。mode "set" で暗い線を上書きする */
function bar(frame, ax, ay, bx, by, width, v, mode = "raise") {
  const pad = width + 2;
  paint(
    frame,
    (x, y) => {
      const s = segment(x, y, ax, ay, bx, by);
      return s.d > width / 2 ? -1 : v;
    },
    { bounds: { x0: Math.min(ax, bx) - pad, y0: Math.min(ay, by) - pad, x1: Math.max(ax, bx) + pad, y1: Math.max(ay, by) + pad }, dither: 0, mode },
  );
}

/** いびつな円の半径（角 a）。amt で凸凹の強さ */
function wobble(a, r, seed, amt) {
  return r * (1 + amt * Math.sin(3 * a + hash1(1, seed) * TAU) + amt * 0.55 * Math.sin(5 * a + hash1(2, seed) * TAU) + amt * 0.3 * Math.sin(9 * a + hash1(3, seed) * TAU));
}

/** 塊（いびつな円盤）。shade(q, dx, dy) が内側の明るさ（q = 縁までの割合 0..1）、負なら塗らない */
function lump(frame, cx, cy, r, seed, amt, shade, mode = "raise") {
  if (r < 0.5) return;
  const pad = r * (1 + amt * 2) + 2;
  paint(
    frame,
    (x, y) => {
      const dx = x - cx;
      const dy = y - cy;
      const d = Math.hypot(dx, dy);
      const rr = wobble(Math.atan2(dy, dx), r, seed, amt);
      if (d > rr) return -1;
      return shade(d / rr, dx, dy);
    },
    { bounds: { x0: cx - pad, y0: cy - pad, x1: cx + pad, y1: cy + pad }, dither: 0.03, mode },
  );
}

/** 丸い玉（左上が明るい）。lo..hi の明るさ */
function ball(frame, cx, cy, r, lo, hi) {
  lump(frame, cx, cy, r, 1, 0, (q, dx, dy) => clamp01(lo + (hi - lo) * (0.55 - 0.45 * ((dx + dy) / Math.max(1, r * 1.5)) - 0.25 * q)));
}

/** 楕円の輪（床に寝た輪。横に長い）。rx 横半径、ry 縦半径、width 太さ */
function flatRing(frame, cx, cy, rx, ry, width, v, erosion = 0, seed = 7) {
  const pad = rx + width + 2;
  paint(
    frame,
    (x, y) => {
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      const d = Math.abs(Math.hypot(dx, dy) - 1) * Math.min(rx, ry);
      if (d > width / 2) return -1;
      if (erosion > 0 && valueNoise(x, y, 4, seed) < erosion) return -1;
      return v * (1 - 0.4 * (d / (width / 2)));
    },
    { bounds: { x0: cx - pad, y0: cy - pad, x1: cx + pad, y1: cy + pad }, dither: 0 },
  );
}

/** 重力の付いた粒の位置（dirs 1 の絵だけで使う。正準の y が画面の下） */
function fall(x0, y0, vx, vy, g, t) {
  return { x: x0 + vx * t, y: y0 + vy * t + 0.5 * g * t * t };
}

/** 2x2 の滴（左上が明るい） */
function drop(frame, x, y, level) {
  dot(frame, x, y, level);
  dot(frame, x + 1, y, Math.max(1, level - 1));
  dot(frame, x, y + 1, Math.max(1, level - 1));
  dot(frame, x + 1, y + 1, Math.max(1, level - 2));
}

/** 三角形（a, b, c）を明るさ v で塗る */
function tri(frame, ax, ay, bx, by, cx, cy, v, mode = "raise") {
  const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  if (Math.abs(area) < 1e-3) return;
  paint(
    frame,
    (x, y) => {
      const w0 = ((bx - x) * (cy - y) - (by - y) * (cx - x)) / area;
      const w1 = ((cx - x) * (ay - y) - (cy - y) * (ax - x)) / area;
      const w2 = 1 - w0 - w1;
      return w0 < 0 || w1 < 0 || w2 < 0 ? -1 : v;
    },
    { bounds: { x0: Math.min(ax, bx, cx) - 1, y0: Math.min(ay, by, cy) - 1, x1: Math.max(ax, bx, cx) + 1, y1: Math.max(ay, by, cy) + 1 }, dither: 0, mode },
  );
}

/** 菱形の結晶片（中心 cx, cy、長軸の角 a、長さ len、幅 wid）。長軸の片側を明るく、もう片側を暗くして面を見せる */
function facet(frame, cx, cy, a, len, wid, hi, lo) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  const tip = (k) => ({ x: cx + c * len * k, y: cy + s * len * k });
  const side = (k) => ({ x: cx - s * wid * k, y: cy + c * wid * k });
  const f = tip(0.5);
  const b = tip(-0.5);
  const l = side(0.5);
  const r = side(-0.5);
  tri(frame, f.x, f.y, b.x, b.y, l.x, l.y, hi);
  tri(frame, f.x, f.y, b.x, b.y, r.x, r.y, lo);
}

/** 段の文字の並び（stamp の絵）の段を k 倍に落とす（冷める・薄れる） */
function dim(pattern, k) {
  return pattern.map((row) => row.replace(/[1-7]/g, (ch) => String(Math.max(1, Math.round(Number(ch) * k)))));
}

/** 画面に揃った絵（stamp）を k 倍に太らせる（小さな紋を読める大きさに） */
function enlarge(pattern, k) {
  const out = [];
  for (const row of pattern) {
    const wide = row.split("").map((ch) => ch.repeat(k)).join("");
    for (let i = 0; i < k; i++) out.push(wide);
  }
  return out;
}

/** 弧の進み（from から時計回りに sweep rad。一周を超えない）。arcLine は半周までなので、一周を描く輪はこちら */
function arcProgress(frame, radius, width, from, sweep, v) {
  const pad = radius + width + 2;
  paint(
    frame,
    (x, y) => {
      if (Math.abs(Math.hypot(x, y) - radius) > width / 2) return -1;
      const a = (((Math.atan2(y, x) - from) % TAU) + TAU) % TAU;
      return a > sweep ? -1 : v;
    },
    { bounds: { x0: -pad, y0: -pad, x1: pad, y1: pad }, dither: 0 },
  );
}

/** 烙印の紋（輪の中に十字と 4 つの爪）。heat（0..1）で赤熱 → 冷める */
function brandGlyph(frame, cx, cy, r, heat) {
  const v = 0.35 + 0.65 * heat;
  ring(frame, { ox: cx, oy: cy, radius: r, width: 2.2, bright: v });
  bar(frame, cx - r * 0.6, cy, cx + r * 0.6, cy, 2, clamp01(v + 0.1));
  bar(frame, cx, cy - r * 0.6, cx, cy + r * 0.6, 2, clamp01(v + 0.1));
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2;
    bar(frame, cx + Math.cos(a) * r * 0.55, cy + Math.sin(a) * r * 0.55, cx + Math.cos(a) * r * 0.85, cy + Math.sin(a) * r * 0.85, 1.4, v * 0.85);
  }
}

/** 床を透かす間引き（4 ドットに 1 つだけ残す） */
function sparse(x, y) {
  return (Math.floor(x) & 1) === 0 && (Math.floor(y) & 1) === 0;
}

/** もっと薄い間引き（9 ドットに 1 つ） */
function thin(x, y) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  return ((ix % 3) + 3) % 3 === 0 && ((iy % 3) + 3) % 3 === (Math.floor(ix / 3) & 1);
}

// ---------------------------------------------------------------------------
// 水瓶（waterJar）: 半径 32px
// ---------------------------------------------------------------------------

const JAR = { radiusPx: 32, frames: 10, seed: 7101 };
const JAR_R = JAR.radiusPx * DPX;
/** 瓶が割れるフレーム */
const JAR_BREAK = 2;

/** 水瓶の形: 丸い胴・細い首・広がった口。crack で胴にひび */
function jar(frame, cx, cy, crack) {
  const body = 14;
  lump(frame, cx, cy, body, 1, 0, (q, dx, dy) => clamp01(0.62 - 0.3 * ((dx + dy) / (body * 1.4)) - 0.22 * q));
  // 胴の帯（瓶の模様）
  bar(frame, cx - 13, cy - 3, cx + 13, cy - 3, 1.5, 0.7);
  bar(frame, cx - 12, cy + 3, cx + 12, cy + 3, 1.2, 0.5);
  // 首と口
  bar(frame, cx, cy - 13, cx, cy - 19, 8, 0.5);
  bar(frame, cx - 7, cy - 20, cx + 7, cy - 20, 3, 0.72);
  dot(frame, cx - 7, cy - 7, 7);
  dot(frame, cx - 6, cy - 7, 6);
  dot(frame, cx - 7, cy - 6, 6);
  if (!crack) return;
  // ひび: 暗い稲妻形を上書き
  bar(frame, cx + 1, cy - 12, cx - 3, cy - 4, 1.2, 0.12, "set");
  bar(frame, cx - 3, cy - 4, cx + 4, cy + 2, 1.2, 0.12, "set");
  bar(frame, cx + 4, cy + 2, cx + 1, cy + 11, 1.2, 0.12, "set");
  bar(frame, cx - 3, cy - 4, cx - 9, cy - 1, 1, 0.12, "set");
}

/** 割れる（空中）: 瓶が落ちてきて割れ、陶片と水の王冠が跳ねる */
function jarBreak(frame, f) {
  const p = prog(f, JAR.frames);
  if (f < JAR_BREAK) {
    jar(frame, 0, f === 0 ? -18 : -8, f === 1);
    if (f === 0) for (let i = -1; i <= 1; i++) streakLine(frame, { ax: i * 6, ay: -40, bx: i * 6, by: -28, bright: 0.4 });
    return;
  }
  const t = f - JAR_BREAK;
  const seed = JAR.seed;
  // 水柱: 割れた直後に中央から立ち上がる
  if (t < 3) {
    const h = 26 * (1 - t / 3) + 8;
    paint(
      frame,
      (x, y) => {
        if (y > 0 || y < -h) return -1;
        const u = -y / h;
        const w = 7 * (1 - u) + 1.5;
        if (Math.abs(x) > w) return -1;
        return clamp01(0.95 - 0.5 * (Math.abs(x) / w));
      },
      { bounds: { x0: -10, y0: -h - 2, x1: 10, y1: 2 }, dither: 0 },
    );
  }
  // 陶片: 重い板が放射に跳ねて落ちる
  for (let i = 0; i < 9; i++) {
    const r = (k) => hash1(i * 7 + k, seed + 1);
    const a = (i / 9) * TAU + r(1) * 0.4;
    const sp = 4 + 3 * r(2);
    const pos = fall(0, -4, Math.cos(a) * sp, Math.sin(a) * sp * 0.6 - 3, 1.2, t);
    if (t > 6) continue;
    bar(frame, pos.x - 1.5, pos.y, pos.x + 1.5, pos.y + (i % 2 ? 1 : -1), 2.2, 0.5);
    dot(frame, pos.x - 1, pos.y - 1, 6);
  }
  // 水の王冠: 縁から滴が弧を描いて外へ落ちる
  for (let i = 0; i < 26; i++) {
    const r = (k) => hash1(i * 5 + k, seed + 2);
    const a = (i / 26) * TAU + r(1) * 0.2;
    const sp = (JAR_R * (0.55 + 0.4 * r(2))) / 7;
    const pos = fall(Math.cos(a) * 8, Math.sin(a) * 5 - 2, Math.cos(a) * sp, Math.sin(a) * sp * 0.7 - 4 - 2 * r(3), 1.3, t);
    if (t > 7) continue;
    drop(frame, pos.x, pos.y, t < 3 ? 7 : 6);
    if (t < 4) dot(frame, pos.x - Math.cos(a) * sp * 0.5, pos.y + 2, 4);
  }
  void p;
}

/** 割れる（地面）: 水が床に広がり、波紋の輪が 2 重に縁まで走る */
function jarSplash(frame, f) {
  if (f < JAR_BREAK) {
    // 落ちてくる瓶の影
    flatRing(frame, 0, 2, 6 + f * 3, 3 + f * 1.5, 2, 0.3);
    return;
  }
  const q = (f - JAR_BREAK + 0.5) / (JAR.frames - JAR_BREAK);
  const reach = JAR_R * (0.35 + 0.65 * smoothstep(0, 0.6, q));
  const seed = JAR.seed + 5;
  const fade = 1 - smoothstep(0.55, 1, q);
  paint(
    frame,
    (x, y) => {
      const d = Math.hypot(x, y);
      const rr = wobble(Math.atan2(y, x), reach * 0.8, seed, 0.05);
      if (d > rr) return -1;
      const rim = rr - d;
      if (rim < 1.5) return 0.62 * fade + 0.1;
      if (!thin(x, y)) return -1;
      return 0.45 * fade + 0.1;
    },
    { bounds: { x0: -JAR_R - 4, y0: -JAR_R - 4, x1: JAR_R + 4, y1: JAR_R + 4 }, dither: 0 },
  );
  ring(frame, { radius: reach, width: 2.5, bright: 0.85 * fade + 0.1, erosion: q * 0.5, seed: seed + 1 });
  if (q > 0.25) ring(frame, { radius: reach * 0.6, width: 2, bright: 0.6 * fade, erosion: q * 0.6, seed: seed + 2 });
}

// ---------------------------------------------------------------------------
// 油流し（oilPot）: 半径 32px
// ---------------------------------------------------------------------------

const OIL = { radiusPx: 32, frames: 10, seed: 7201 };
const OIL_R = OIL.radiusPx * DPX;
const OIL_BREAK = 2;

/** 油壺: 平たい胴・広い口（口の中は油で暗い）・横の取っ手 */
function pot(frame, cx, cy, crack) {
  paint(
    frame,
    (x, y) => {
      const dx = (x - cx) / 13;
      const dy = (y - cy) / 9;
      const d = Math.hypot(dx, dy);
      if (d > 1) return -1;
      return clamp01(0.62 - 0.28 * (dx + dy) - 0.2 * d);
    },
    { bounds: { x0: cx - 15, y0: cy - 11, x1: cx + 15, y1: cy + 11 }, dither: 0.03 },
  );
  // 口（縁は明るく、中は油で暗い）
  flatRing(frame, cx, cy - 8, 7, 2.5, 1.6, 0.8);
  paint(frame, (x, y) => (Math.hypot((x - cx) / 5.5, (y - cy + 8) / 1.6) > 1 ? -1 : 0.12), { bounds: { x0: cx - 7, y0: cy - 11, x1: cx + 7, y1: cy - 5 }, dither: 0, mode: "set" });
  // 取っ手
  ring(frame, { ox: cx + 13, oy: cy - 2, radius: 4, width: 1.6, bright: 0.55 });
  dot(frame, cx - 7, cy - 3, 7);
  if (!crack) return;
  bar(frame, cx - 3, cy - 6, cx + 1, cy, 1, 0.1, "set");
  bar(frame, cx + 1, cy, cx - 2, cy + 7, 1, 0.1, "set");
}

/** 油の塊（暗い玉に艶の点） */
function gob(frame, x, y, r) {
  lump(frame, x, y, r, 3, 0.15, (q) => clamp01(0.25 - 0.1 * q));
  dot(frame, x - r * 0.4, y - r * 0.4, 6);
}

/** 撒く（空中）: 壺が割れ、油の塊が糸を引いて飛ぶ */
function oilPour(frame, f) {
  if (f < OIL_BREAK) {
    pot(frame, 0, f === 0 ? -14 : -6, f === 1);
    return;
  }
  const t = f - OIL_BREAK;
  const seed = OIL.seed;
  // 陶片
  for (let i = 0; i < 7; i++) {
    const r = (k) => hash1(i * 7 + k, seed + 1);
    const a = (i / 7) * TAU + r(1) * 0.5;
    const pos = fall(0, -6, Math.cos(a) * (3 + 2 * r(2)), Math.sin(a) * 2 - 3, 1.1, t);
    if (t > 5) continue;
    bar(frame, pos.x - 1.5, pos.y, pos.x + 1.5, pos.y + 1, 2.2, 0.55);
    dot(frame, pos.x - 1, pos.y - 1, 6);
  }
  // 油の塊: 放射に飛んで着地すると平たく潰れる（地面の層の染みと同じ所に落ちる）
  for (let i = 0; i < 12; i++) {
    const r = (k) => hash1(i * 5 + k, seed + 2);
    const a = (i / 12) * TAU + r(1) * 0.3;
    const land = OIL_R * (0.45 + 0.5 * r(2));
    const k = Math.min(1, (t + 1) / 4);
    const x = Math.cos(a) * land * k;
    const y = Math.sin(a) * land * k - 14 * Math.sin(Math.PI * k);
    if (k >= 1) continue;
    const rad = 2 + 1.5 * r(3);
    gob(frame, x, y, rad);
    // 糸を引く尾
    const back = Math.max(0, k - 0.18);
    bar(frame, Math.cos(a) * land * back, Math.sin(a) * land * back - 14 * Math.sin(Math.PI * back), x, y, 1, 0.22);
  }
}

/** 撒く（地面）: 中央の油溜まりと、塊が落ちた所の染み。艶の弧が光る */
function oilSplat(frame, f) {
  if (f < OIL_BREAK) {
    flatRing(frame, 0, 2, 6 + f * 3, 3 + f * 1.5, 2, 0.3);
    return;
  }
  const t = f - OIL_BREAK;
  const q = (t + 0.5) / (OIL.frames - OIL_BREAK);
  const seed = OIL.seed;
  const fade = 1 - smoothstep(0.6, 1, q);
  const glossy = (qq, dx, dy, r) => (qq < 0.72 && qq > 0.55 && dx + dy < -r * 0.75 ? 0.7 * fade + 0.1 : qq > 0.85 ? 0.28 : 0.18);
  const mainR = OIL_R * 0.42 * smoothstep(0, 0.4, q + 0.1);
  lump(frame, 0, 0, mainR, seed + 3, 0.1, (qq, dx, dy) => glossy(qq, dx, dy, mainR));
  for (let i = 0; i < 12; i++) {
    if (t < 3) continue;
    const r = (k) => hash1(i * 5 + k, seed + 2);
    const a = (i / 12) * TAU + r(1) * 0.3;
    const land = OIL_R * (0.45 + 0.5 * r(2));
    const rad = (3 + 3 * r(3)) * Math.min(1, (t - 2) / 2);
    lump(frame, Math.cos(a) * land, Math.sin(a) * land, rad, seed + 10 + i, 0.25, (qq, dx, dy) => glossy(qq, dx, dy, rad));
    // 跳ねた小さな飛沫
    dot(frame, Math.cos(a) * (land + rad + 3), Math.sin(a) * (land + rad + 3), 2);
  }
}

// ---------------------------------------------------------------------------
// 焼き払い（scorchLine）: 長さ 90px、帯の半幅 8px
// ---------------------------------------------------------------------------

const SCORCH = { seed: 7301, frames: 8 };
const SCORCH_STEP_PX = 12;

/** 炎の舌（+x へ伸びる）。len 長さ、wid 最大の半幅、flick で揺らぎの位相 */
function flameTongue(frame, x0, len, wid, flick, seed, bright = 1) {
  paint(
    frame,
    (x, y) => {
      const u = (x - x0) / len;
      if (u < 0 || u > 1) return -1;
      const n = valueNoise(x - flick * 6, y, 5, seed);
      const w = wid * Math.pow(Math.sin(Math.PI * Math.min(1, u * 0.85 + 0.12)), 0.8) * (1 - u * 0.45) * (0.75 + 0.5 * n);
      const d = Math.abs(y) / Math.max(0.5, w);
      if (d > 1) return -1;
      return clamp01((1.05 - 0.75 * d - 0.3 * u) * bright);
    },
    { bounds: { x0: x0 - 1, y0: -wid * 1.4 - 2, x1: x0 + len + 1, y1: wid * 1.4 + 2 }, dither: 0.05 },
  );
}

/** 点火（cast）: 手元の火口から前へ炎が噴き、火の粉が散る */
function scorchFlare(frame, f) {
  const p = prog(f, SCORCH.frames);
  const fade = 1 - smoothstep(0.4, 1, p);
  flameTongue(frame, 4, 34 * (0.5 + 0.5 * smoothstep(0, 0.3, p)), 11 * fade + 3, f, SCORCH.seed, 0.6 + 0.5 * fade);
  if (p < 0.35) glint(frame, 8, 0, 3);
  shards(frame, f, 10, SCORCH.seed + 1, (i, r) => ({ x: 10, y: (r(1) - 0.5) * 8, vx: 2 + 4 * r(2), vy: (r(3) - 0.5) * 5, life: 4 + Math.floor(3 * r(4)) }));
}

/**
 * 炎の帯の 1 区間（beam。step px）。芯の白い帯と、両側に交互に立つ炎の舌。舌の位相は区間の長さで 1 周するので並べても続く。
 * フレームが進むと舌が低くなり、火の粉が残る
 */
function scorchBeam(frame, f) {
  const p = prog(f, SCORCH.frames);
  const half = SCORCH_STEP_PX;
  const span = half * 2;
  const low = 1 - 0.55 * smoothstep(0.35, 1, p);
  paint(
    frame,
    (x, y) => {
      if (Math.abs(x) > half + 0.5) return -1;
      const ph = ((x + half) / span) * TAU;
      const side = y < 0 ? 0 : Math.PI;
      const tongue = Math.max(0, Math.sin(ph * 2 + side + f * 1.4));
      const w = (4 + 7 * tongue * tongue) * low;
      const d = Math.abs(y) / w;
      if (d > 1) return -1;
      if (Math.abs(y) < 1.6 && p < 0.7) return 1;
      return clamp01((0.95 - 0.65 * d) * (1 - 0.35 * p));
    },
    { bounds: { x0: -half - 1, y0: -14, x1: half + 1, y1: 14 }, dither: 0.04 },
  );
  // 舌の先から昇る火の粉
  for (let i = 0; i < 3; i++) {
    const x = ((i * 9 + f * 3) % span) - half;
    const y = (i % 2 ? 1 : -1) * (9 + ((f * 2 + i * 3) % 5));
    dot(frame, x, y, 6 - (i % 2));
  }
}

/** 先の噴き上がり（tip）: 炎が扇に跳ね返り、火の粉と煤の輪 */
function scorchTip(frame, f) {
  const p = prog(f, SCORCH.frames);
  const fade = 1 - smoothstep(0.35, 1, p);
  for (let i = 0; i < 5; i++) {
    const a = (i - 2) * 0.45;
    const len = (10 + 10 * hash1(i, SCORCH.seed + 3)) * (0.6 + 0.6 * smoothstep(0, 0.4, p));
    lens(frame, { ax: 0, ay: 0, bx: Math.cos(a) * len, by: Math.sin(a) * len, T: 7 * fade + 2, erosion: smoothstep(0.5, 1, p), seed: SCORCH.seed + 4 + i, bright: 1 });
  }
  if (p < 0.3) glint(frame, 0, 0, 4);
  shards(frame, f, 12, SCORCH.seed + 5, (i, r) => ({ x: 2, y: 0, vx: 1 + 4 * r(1), vy: (r(2) - 0.5) * 8, life: 4 + Math.floor(3 * r(3)) }));
  ring(frame, { radius: 4 + 14 * p, width: 2, squash: 0.6, bright: 0.45 * fade, erosion: 0.3 + 0.5 * p, seed: SCORCH.seed + 6 });
}

// ---------------------------------------------------------------------------
// 凍て道（iceSlide）: 80px を 0.22 秒で滑る
// ---------------------------------------------------------------------------

const SLIDE = { seed: 7401 };
const SLIDE_STEP_PX = 10;

/** 蹴り出し（cast）: 足元から後ろへ霜の飛沫と、潰れた冷気の輪 */
function slideKick(frame, f) {
  const frames = 6;
  const p = prog(f, frames);
  const fade = 1 - smoothstep(0.3, 1, p);
  ring(frame, { ox: -4 - p * 8, radius: 5 + p * 16, width: 3 - p * 1.5, squash: 0.55, bright: 0.8 * fade, erosion: p * 0.5, seed: SLIDE.seed });
  shards(frame, f, 14, SLIDE.seed + 1, (i, r) => ({ x: -4, y: (r(1) - 0.5) * 10, vx: -(2 + 4 * r(2)), vy: (r(3) - 0.5) * 6, life: 3 + Math.floor(3 * r(4)), size: 2 }));
  if (p < 0.4) glint(frame, -2, 0, 3);
}

/** 滑走中（active）: 足元の両脇から後ろへ氷の飛沫が扇に噴き、後ろへ霜の筋が伸びる */
function slideActive(frame, f) {
  const seed = SLIDE.seed + 2;
  for (const side of [-1, 1]) {
    for (let i = 0; i < 22; i++) {
      const r = (k) => hash1(i * 7 + k + f * 29, seed + (side > 0 ? 50 : 0));
      const age = (i % 5) * 0.9 + r(1);
      const x = -4 - age * (4 + 3 * r(2));
      const y = side * (5 + age * (2.5 + 3 * r(3)));
      const level = Math.max(3, 7 - Math.floor(age));
      if (age < 2.5) drop(frame, x, y, level);
      else dot(frame, x, y, level);
    }
    // 刃の当たる所の白い芯
    bar(frame, -6, side * 5, 2, side * 4, 2, 0.95);
  }
  // 霜の筋
  for (let i = 0; i < 5; i++) {
    const y = (i - 2) * 3.5;
    const len = 30 + 30 * hash1(i + f * 5, seed + 9);
    streakLine(frame, { ax: -8 - len, ay: y, bx: -8, by: y, bright: 0.45 + 0.2 * (i === 2 ? 1 : 0) });
  }
  // 前の冷気の楔
  crescent(frame, { ox: -6, R: 18, T: 4, head: 0.9, tail: -0.9, peak: 0.5, seed: seed + 3, bright: 0.75, edge: 1.2, edgeReach: 1 });
  if (f % 3 === 0) glint(frame, -14 - f * 2, (f % 2 ? 1 : -1) * 7, 2);
}

/** 止まる（end）: 前へ削れた氷の飛沫が壁のように跳ね、氷片が散る */
function slideStop(frame, f) {
  const frames = 8;
  const p = prog(f, frames);
  const fade = 1 - smoothstep(0.35, 1, p);
  for (let i = 0; i < 26; i++) {
    const r = (k) => hash1(i * 7 + k, SLIDE.seed + 4);
    const a = (r(1) - 0.5) * 2.2;
    const sp = 3 + 4 * r(2);
    const t = f + 0.5;
    const d = 6 + sp * t * (1 - t / 14);
    if (t > 3 + 4 * r(3)) continue;
    dot(frame, Math.cos(a) * d, Math.sin(a) * d, t < 3 ? 7 : 5);
    if (r(4) > 0.5) dot(frame, Math.cos(a) * d - 1, Math.sin(a) * d, 4);
  }
  crescent(frame, { ox: -4, R: 16 + p * 8, T: 6 * fade + 1, head: 1.1, tail: -1.1, peak: 0.5, seed: SLIDE.seed + 5, bright: 0.9 * fade + 0.1, erosion: smoothstep(0.4, 1, p), edge: 1.4, edgeReach: 1 });
  ring(frame, { radius: 6 + p * 18, width: 2, squash: 0.5, bright: 0.55 * fade });
}

/** 通った跡（beam。step px）: スケートの 2 本の溝がきらめき、細って消える */
function slideTrail(frame, f) {
  const frames = 8;
  const p = prog(f, frames);
  const half = SLIDE_STEP_PX;
  const v = 0.95 * (1 - 0.6 * p);
  for (const y of [-3.5, 3.5]) bar(frame, -half - 0.5, y, half + 0.5, y, p < 0.5 ? 1.6 : 1, v);
  if (p < 0.4) bar(frame, -half - 0.5, 0, half + 0.5, 0, 1, 0.4);
  // きらめく結晶（区間の中の決まった所。並べると等間隔に光る）
  if (f % 2 === 0) glint(frame, (f % 4 === 0 ? -1 : 1) * (half / 2), f % 4 === 0 ? -3.5 : 3.5, 2);
}

// ---------------------------------------------------------------------------
// 地均し（levelGround）: 長さ 100px、半幅 9px
// ---------------------------------------------------------------------------

const LEVEL = { seed: 7501, frames: 8 };
const LEVEL_STEP_PX = 12;

/** 石の欠片（小さな四角い塊に明るい上縁） */
function rock(frame, x, y, s, v) {
  lump(frame, x, y, s, 11 + Math.floor(x * 7 + y * 3), 0.25, (q, dx, dy) => clamp01(v - 0.2 * q + (dy < -s * 0.35 ? 0.2 : 0)));
}

/** 土煙（ふくらんだ淡い雲。面は間引く） */
function dust(frame, x, y, r, v, seed) {
  lump(frame, x, y, r, seed, 0.2, (q, dx, dy) => (sparse(dx + x + 200, dy + y + 200) && (q < 0.8 || dy < 0) ? clamp01(v * (1 - 0.35 * q)) : -1));
}

/** 踏み込み（cast）: 足元の衝撃の輪と、前へ走り出す地割れと土煙 */
function levelStomp(frame, f) {
  const p = prog(f, LEVEL.frames);
  const fade = 1 - smoothstep(0.35, 1, p);
  ring(frame, { radius: 6 + p * 20, width: 3 - p * 1.5, squash: 0.6, bright: 0.75 * fade, erosion: p * 0.5, seed: LEVEL.seed });
  for (let i = 0; i < 5; i++) {
    const a = Math.PI + (i - 2) * 0.7 + hash1(i, LEVEL.seed + 1) * 0.3;
    dust(frame, Math.cos(a) * (8 + 10 * p), Math.sin(a) * (8 + 10 * p), (4 + 2 * hash1(i, LEVEL.seed + 2)) * (0.6 + 0.6 * p), 0.5 * fade + 0.1, LEVEL.seed + 3 + i);
  }
  // 前へ走る地割れ（ジグザグ）
  const len = 40 * smoothstep(0, 0.5, p);
  let px = 4;
  let py = 0;
  for (let x = 4; x < 4 + len; x += 6) {
    const ny = (Math.floor(x / 6) % 2 ? 1 : -1) * 2.5;
    bar(frame, px, py, x + 6, ny, 1.5, 0.28 + 0.2 * fade);
    px = x + 6;
    py = ny;
  }
  if (p < 0.3) glint(frame, 0, 0, 3);
}

/** 地割れの 1 区間（beam。step px）: 中央のジグザグの割れ目と、両側で石板がめくれて砕ける */
function levelBeam(frame, f) {
  const p = prog(f, LEVEL.frames);
  const half = LEVEL_STEP_PX;
  // 割れ目（区間の両端で y = 0 に戻るジグザグ。並べても続く）
  const zig = (x) => 3 * Math.sin(((x + half) / (half * 2)) * TAU * 2);
  for (let x = -half; x < half; x += 2) bar(frame, x, zig(x), x + 2, zig(x + 2), 2, p < 0.25 ? 0.9 : 0.3);
  const lift = Math.sin(Math.PI * Math.min(1, p * 1.4));
  const crumble = smoothstep(0.55, 1, p);
  for (const [cx, side] of [
    [-half / 2, 1],
    [half / 2, -1],
  ]) {
    const out = 5 + 6 * lift;
    if (crumble < 0.5) {
      // めくれた石板（斜めの四角。上縁が明るい）
      const y = side * out;
      tri(frame, cx - 5, y - 3, cx + 5, y - 2, cx + 4, y + 3, 0.55);
      tri(frame, cx - 5, y - 3, cx + 4, y + 3, cx - 4, y + 3, 0.45);
      bar(frame, cx - 5, y - 3, cx + 5, y - 2, 1.2, 0.85);
    }
    // 砕けた欠片が外へ散る
    for (let i = 0; i < 4; i++) {
      const r = hash1(i + (side > 0 ? 10 : 20), LEVEL.seed + 5);
      const d = out + crumble * (4 + 8 * r);
      if (crumble <= 0) break;
      rock(frame, cx + (i - 1.5) * 3, side * d, 1.4, 0.5 * (1 - crumble) + 0.25);
    }
  }
}

/** 先（tip）: 瓦礫が前と両脇へ噴き、土煙が膨らむ */
function levelTip(frame, f) {
  const p = prog(f, LEVEL.frames);
  const fade = 1 - smoothstep(0.35, 1, p);
  for (let i = 0; i < 4; i++) {
    const a = (i - 1.5) * 0.7;
    dust(frame, Math.cos(a) * (4 + 12 * p), Math.sin(a) * (4 + 12 * p), 5 + 5 * p, 0.45 * fade + 0.1, LEVEL.seed + 20 + i);
  }
  for (let i = 0; i < 9; i++) {
    const r = (k) => hash1(i * 5 + k, LEVEL.seed + 21);
    const a = (r(1) - 0.5) * 2.4;
    const d = 3 + (6 + 14 * r(2)) * smoothstep(0, 0.8, p);
    if (p > 0.85) continue;
    rock(frame, Math.cos(a) * d, Math.sin(a) * d, 1.4 + r(3), 0.6);
  }
  if (p < 0.25) glint(frame, 0, 0, 3);
}

/** 砕いたマス（act）: 小石が跳ね上がって落ち、土煙の輪 */
function levelRubble(frame, f) {
  const frames = 7;
  const p = prog(f, frames);
  const fade = 1 - smoothstep(0.35, 1, p);
  flatRing(frame, 0, 2, 5 + 12 * p, 3 + 6 * p, 2, 0.5 * fade, p * 0.5, LEVEL.seed + 30);
  for (let i = 0; i < 6; i++) {
    const r = (k) => hash1(i * 5 + k, LEVEL.seed + 31);
    const pos = fall(0, 0, (r(1) - 0.5) * 5, -3 - 3 * r(2), 1.1, f + 0.5);
    if (pos.y > 4) continue;
    rock(frame, pos.x, pos.y, 1.3 + r(3), 0.6);
  }
}

// ---------------------------------------------------------------------------
// 火吸い（emberDraw）: 周り 48px の炎を吸う
// ---------------------------------------------------------------------------

const EMBER = { radiusPx: 48, frames: 10, seed: 7601 };
const EMBER_R = EMBER.radiusPx * DPX;
const EMBER_STEP_PX = 10;

/** 火の雫（+x へ流れる。後ろに尾） */
function ember(frame, x, y, level) {
  dot(frame, x, y, level);
  dot(frame, x, y + 1, level);
  dot(frame, x - 1, y, level - 1);
  dot(frame, x - 2, y, level - 2);
  dot(frame, x - 3, y + 0.5, Math.max(2, level - 3));
}

/** 吸い込む（cast）: 炎の渦が外から中心へ巻き込み、手元の火球が育つ */
function emberSwirl(frame, f) {
  const p = prog(f, EMBER.frames);
  const seed = EMBER.seed;
  for (let i = 0; i < 44; i++) {
    const r = (k) => hash1(i * 7 + k, seed);
    const phase = (p * 1.3 + r(1)) % 1;
    const d = EMBER_R * (1 - phase) * (0.75 + 0.25 * r(2)) + 4;
    // 中心に近いほど角が進む（渦の巻き）
    const a = (i / 44) * TAU + (1 - d / EMBER_R) * 2.4;
    const x = Math.cos(a) * d;
    const y = Math.sin(a) * d;
    // 流れの向き（内向き + 回転）
    const ta = a + Math.PI * 0.62;
    const len = 7 + 8 * (1 - d / EMBER_R);
    streakLine(frame, { ax: x - Math.cos(ta) * len, ay: y - Math.sin(ta) * len, bx: x, by: y, bright: 0.55 + 0.5 * phase, width: 2 });
    if (i % 2 === 0) dot(frame, x, y, 7);
  }
  // 渦の腕（外周の炎の弧）
  for (let k = 0; k < 3; k++) {
    const from = (k / 3) * TAU + p * 3;
    const radius = EMBER_R * (0.8 - 0.5 * p) + k * 4;
    arcLine(frame, { radius, from, to: from + 1.3, bright: 0.8 * (1 - p * 0.4), width: 3 });
  }
  // 火球
  const orb = 3 + 9 * smoothstep(0, 1, p);
  lump(frame, 0, 0, orb, seed + 3, 0.12, (q) => clamp01(1.05 - 0.6 * q));
  if (p > 0.7) glint(frame, 0, 0, 4);
}

/** 吸われる炎の床（act）: マスの炎が中心へ引かれて細る */
function emberPuff(frame, f) {
  const frames = 7;
  const p = prog(f, frames);
  const fade = 1 - smoothstep(0.2, 1, p);
  lump(frame, 0, 0, 7 * fade + 1, EMBER.seed + 5 + f, 0.3, (q) => clamp01(0.95 - 0.6 * q));
  for (let i = 0; i < 4; i++) {
    const x = (hash1(i, EMBER.seed + 6) - 0.5) * 10;
    dot(frame, x, -6 - f * 2 - i, Math.max(2, 5 - f));
  }
}

/** 火の粉の流れ（beam。step px）: 火の雫が +x（吸い込む先）へ流れる。区間ごとに同じ並びで、フレームで位置が進む */
function emberStream(frame, f) {
  const frames = 8;
  const half = EMBER_STEP_PX;
  const span = half * 2;
  bar(frame, -half - 0.5, 0, half + 0.5, 0, 1, 0.16);
  for (let k = 0; k < 3; k++) {
    const x = ((k * (span / 3) + f * (span / frames)) % span) - half;
    const y = Math.sin(k * 2.1 + f) * 2.5;
    ember(frame, x, y, k === 0 ? 7 : 6);
  }
}

/** 飛ぶ火球（fly）: 白い芯の火の玉と、後ろへ揺れる炎の尾 */
function emberBall(frame, f) {
  const seed = EMBER.seed + 8;
  paint(
    frame,
    (x, y) => {
      // 尾: 後ろ（-x）へ細る炎
      if (x < 0) {
        const u = -x / 24;
        if (u > 1) return -1;
        const n = valueNoise(x + f * 5, y, 4, seed);
        const w = 8 * (1 - u) * (0.7 + 0.5 * n);
        if (Math.abs(y) > w) return -1;
        return clamp01(0.85 - 0.6 * u - 0.3 * (Math.abs(y) / w));
      }
      const d = Math.hypot(x, y);
      if (d > 8) return -1;
      return clamp01(1.05 - 0.55 * (d / 8));
    },
    { bounds: { x0: -26, y0: -10, x1: 10, y1: 10 }, dither: 0.05 },
  );
  for (let i = 0; i < 4; i++) dot(frame, -10 - ((f * 4 + i * 7) % 22), (hash1(i + f, seed) - 0.5) * 10, 5);
}

// ---------------------------------------------------------------------------
// 沼呼び（bogCall）: 半径 32px
// ---------------------------------------------------------------------------

const BOG = { radiusPx: 32, frames: 10, seed: 7701 };
const BOG_R = BOG.radiusPx * DPX;

/** 泡の輪郭（膨らむ泡。上に艶の点） */
function bubble(frame, x, y, r, v) {
  ring(frame, { ox: x, oy: y, radius: r, width: 1.4, bright: v });
  dot(frame, x - r * 0.45, y - r * 0.45, 7);
}

/** 泡の一生（膨らむ → 弾ける）。age（フレーム）で描く */
function bubbleLife(frame, x, y, age, size) {
  if (age < 0) return;
  if (age < 3) {
    bubble(frame, x, y, 1.5 + size * (age + 1) / 3, 0.75);
    return;
  }
  const k = age - 3;
  if (k > 2) return;
  ring(frame, { ox: x, oy: y, radius: size + 2 + k * 3, width: 1.2, bright: 0.6 * (1 - k / 3), erosion: 0.3 + k * 0.2 });
  for (let i = 0; i < 4; i++) {
    const a = -Math.PI / 2 + (i - 1.5) * 0.7;
    dot(frame, x + Math.cos(a) * (size + 2 + k * 3), y + Math.sin(a) * (size + 2 + k * 2) - k, 6);
  }
}

/** 湧く（地面）: 中心から毒の泥が広がり、縁が盛り上がる。中に波紋 */
function bogWell(frame, f) {
  const p = prog(f, BOG.frames);
  const reach = BOG_R * (0.2 + 0.8 * smoothstep(0, 0.55, p));
  const fade = 1 - smoothstep(0.65, 1, p);
  const seed = BOG.seed;
  paint(
    frame,
    (x, y) => {
      const d = Math.hypot(x, y);
      const rr = wobble(Math.atan2(y, x), reach, seed, 0.1);
      if (d > rr) return -1;
      const rim = rr - d;
      if (rim < 2.5) return 0.55 * fade + 0.12;
      // 波紋（外へ 1 本だけ）
      if (Math.abs(d - reach * 0.6) < 0.8) return 0.42 * fade + 0.08;
      if (!thin(x, y)) return -1;
      return 0.4 * fade + 0.1;
    },
    { bounds: { x0: -BOG_R - 8, y0: -BOG_R - 8, x1: BOG_R + 8, y1: BOG_R + 8 }, dither: 0 },
  );
}

/** 湧く（空中）: 中央の噴き上がり、泡が膨らんで弾け、毒気が立つ */
function bogBubbles(frame, f) {
  const p = prog(f, BOG.frames);
  const seed = BOG.seed + 1;
  if (f < 3) {
    // 噴き上がる泥の柱と飛沫
    const h = 18 - f * 4;
    bar(frame, 0, 0, 0, -h, 8 - f * 2, 0.7);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU;
      const pos = fall(0, -4, Math.cos(a) * 4, Math.sin(a) * 2.5 - 3, 1.2, f + 1);
      drop(frame, pos.x, pos.y, 6);
    }
  }
  for (let i = 0; i < 12; i++) {
    const r = (k) => hash1(i * 7 + k, seed);
    const a = r(1) * TAU;
    const d = BOG_R * 0.85 * Math.sqrt(r(2)) * Math.min(1, p * 2 + 0.2);
    const born = Math.floor(r(3) * 6);
    bubbleLife(frame, Math.cos(a) * d, Math.sin(a) * d, f - born, 2 + 3 * r(4));
  }
  // 毒気: 淡い粒が揺れて立ち昇る
  for (let i = 0; i < 10; i++) {
    const r = (k) => hash1(i * 5 + k, seed + 9);
    const a = r(1) * TAU;
    const d = BOG_R * 0.7 * Math.sqrt(r(2));
    const rise = (p + r(3)) % 1;
    dot(frame, Math.cos(a) * d + Math.sin(rise * 6 + i) * 2, Math.sin(a) * d - rise * 20, rise < 0.5 ? 5 : 3);
  }
}

// ---------------------------------------------------------------------------
// 焼き印（brandSear）・烙火（brandBlast）
// ---------------------------------------------------------------------------

const BRAND = { searRadiusPx: 32, searHalf: 0.7, blastRadiusPx: 48, seed: 7801 };


/** 焼き印（cast）: 前方の扇を熱波が焼き、2 つの烙印が赤熱してから冷める */
function searCone(frame, f) {
  const frames = 8;
  const p = prog(f, frames);
  const R = BRAND.searRadiusPx * DPX;
  const H = BRAND.searHalf;
  const grow = smoothstep(0, 0.45, p);
  const fade = 1 - smoothstep(0.45, 1, p);
  // 熱波: 扇の中の揺らめく縞
  paint(
    frame,
    (x, y) => {
      const d = Math.hypot(x, y);
      if (d > R * grow || d < 8) return -1;
      const a = Math.atan2(y, x);
      if (Math.abs(a) > H) return -1;
      const wave = Math.sin(d * 0.45 - f * 1.6 + Math.sin(a * 5) * 1.5);
      if (wave < 0.72) return -1;
      return clamp01((0.35 + 0.35 * (d / R)) * fade + 0.05);
    },
    { bounds: { x0: 0, y0: -R, x1: R + 2, y1: R }, dither: 0 },
  );
  // 焼く縁（前の弧）
  if (fade > 0.1) arcLine(frame, { radius: R * grow, from: -H, to: H, bright: 0.95 * fade, width: 2.5 });
  // 烙印（押された所から赤熱 → 冷める）
  if (p > 0.3) {
    const heat = 1 - smoothstep(0.45, 1, p) * 0.55;
    for (const s of [-1, 1]) {
      const a = s * 0.4;
      const at = R * 0.62;
      brandGlyph(frame, Math.cos(a) * at, Math.sin(a) * at, 9, heat);
      if (p > 0.6) dot(frame, Math.cos(a) * at + s * 2, Math.sin(a) * at - 8 - (f - 5) * 2, 3);
    }
    if (p < 0.5) {
      glint(frame, Math.cos(0.4) * R * 0.62, Math.sin(0.4) * R * 0.62, 3);
      glint(frame, Math.cos(-0.4) * R * 0.62, Math.sin(-0.4) * R * 0.62, 3);
    }
  }
  shards(frame, f, 10, BRAND.seed, (i, r) => ({ x: R * 0.4, y: (r(1) - 0.5) * R * 0.5, vx: 2 + 3 * r(2), vy: (r(3) - 0.5) * 4, life: 3 + Math.floor(3 * r(4)) }));
}

/** 烙火（地面）: 大きな烙印の紋が浮かび、焦げた輪が縁まで広がって、放射のひび */
function blastSigil(frame, f) {
  const frames = 9;
  const p = prog(f, frames);
  const R = BRAND.blastRadiusPx * DPX;
  const fade = 1 - smoothstep(0.5, 1, p);
  const sig = R * 0.42;
  ring(frame, { radius: sig, width: 3, bright: 0.9 * fade + 0.1 });
  ring(frame, { radius: sig * 0.62, width: 1.6, bright: 0.7 * fade + 0.1 });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU + Math.PI / 8;
    bar(frame, Math.cos(a) * sig * 0.62, Math.sin(a) * sig * 0.62, Math.cos(a) * sig, Math.sin(a) * sig, 1.5, 0.75 * fade + 0.1);
  }
  bar(frame, -sig * 0.5, 0, sig * 0.5, 0, 2.5, 0.95 * fade + 0.05);
  bar(frame, 0, -sig * 0.5, 0, sig * 0.5, 2.5, 0.95 * fade + 0.05);
  if (p > 0.2) {
    const q = smoothstep(0.2, 0.8, p);
    ring(frame, { radius: sig + (R - sig) * q, width: 4 - 2 * q, bright: 0.7 * (1 - q) + 0.1, erosion: 0.2 + 0.6 * q, seed: BRAND.seed + 2 });
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * TAU + hash1(i, BRAND.seed + 3) * 0.4;
      const len = (R - sig) * q * (0.5 + 0.5 * hash1(i, BRAND.seed + 4));
      bar(frame, Math.cos(a) * sig, Math.sin(a) * sig, Math.cos(a) * (sig + len), Math.sin(a) * (sig + len), 1.2, 0.35 * fade + 0.1);
    }
  }
}

/** 烙火（空中）: 紋から炎の柱が放射に噴き、火の粉が昇る */
function blastBurst(frame, f) {
  const frames = 9;
  const p = prog(f, frames);
  const R = BRAND.blastRadiusPx * DPX;
  if (f < 2) {
    brandGlyph(frame, 0, 0, 12 + f * 4, 1);
    glint(frame, 0, 0, 4);
    return;
  }
  const q = smoothstep(0.15, 0.7, p);
  const erosion = smoothstep(0.55, 1, p);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU + hash1(i, BRAND.seed + 5) * 0.2;
    const len = R * (0.35 + 0.6 * q) * (0.8 + 0.2 * hash1(i, BRAND.seed + 6));
    lens(frame, { ax: Math.cos(a) * 6, ay: Math.sin(a) * 6, bx: Math.cos(a) * len, by: Math.sin(a) * len, T: 14 * (1 - erosion * 0.5), erosion, seed: BRAND.seed + 7 + i, bright: 1.05 });
  }
  if (p < 0.45) glint(frame, 0, 0, 4);
  shards(frame, f - 2, 18, BRAND.seed + 8, (i, r) => {
    const a = r(1) * TAU;
    return { x: Math.cos(a) * 10, y: Math.sin(a) * 10, vx: Math.cos(a) * (3 + 5 * r(2)), vy: Math.sin(a) * (3 + 5 * r(2)) - 1.5, life: 4 + Math.floor(3 * r(3)) };
  });
}

/** 烙印が倍になる（act）: 敵の上の小さな紋が 2 つに割れて左右へ開く */
function brandDouble(frame, f) {
  const frames = 7;
  const p = prog(f, frames);
  const open = 3 + 7 * smoothstep(0, 0.6, p);
  const heat = 1 - 0.5 * smoothstep(0.6, 1, p);
  brandGlyph(frame, -open, -10, 6, heat);
  brandGlyph(frame, open, -10, 6, heat);
  if (p < 0.35) glint(frame, 0, -10, 3);
  shards(frame, f, 6, BRAND.seed + 9, (i, r) => ({ x: 0, y: -10, vx: (r(1) - 0.5) * 5, vy: -1 - 2 * r(2), life: 3 + Math.floor(2 * r(3)) }));
}

// ---------------------------------------------------------------------------
// 崩し蹴り（breakKick）: 長さ 30px
// ---------------------------------------------------------------------------

const KICK = { lengthPx: 30, seed: 7901 };
const KICK_L = KICK.lengthPx * DPX;

/** ぎざぎざの星（衝撃）。spikes 本の尖り、外 r1・内 r0 */
function starburst(frame, cx, cy, r0, r1, spikes, v, seed, rot = 0) {
  paint(
    frame,
    (x, y) => {
      const dx = x - cx;
      const dy = y - cy;
      const a = Math.atan2(dy, dx) - rot;
      const k = (((a / TAU) * spikes) % 1 + 1) % 1;
      const i = Math.floor((((a / TAU) * spikes) % spikes + spikes) % spikes);
      const tipR = r1 * (0.75 + 0.25 * hash1(i, seed));
      const rr = r0 + (tipR - r0) * (1 - Math.abs(k - 0.5) * 2);
      const d = Math.hypot(dx, dy);
      if (d > rr) return -1;
      return clamp01(v * (1.05 - 0.45 * (d / rr)));
    },
    { bounds: { x0: cx - r1 - 2, y0: cy - r1 - 2, x1: cx + r1 + 2, y1: cy + r1 + 2 }, dither: 0.03 },
  );
}

/** 蹴り（cast）: 足の軌跡の弧が前へ振り抜け、先で衝撃の星が弾け、崩れのひびが走る */
function kick(frame, f) {
  const frames = 8;
  const p = prog(f, frames);
  const grow = Math.min(1, p * 3.5);
  lens(frame, { ax: 6, ay: 16, bx: KICK_L - 4, by: -2, T: 10, bend: 8, grow, erosion: smoothstep(0.35, 1, p), seed: KICK.seed, bright: 1 });
  if (p < 0.2) return;
  const q = smoothstep(0.2, 0.6, p);
  const fade = 1 - smoothstep(0.45, 1, p);
  starburst(frame, KICK_L - 4, 0, 4 + 3 * q, 10 + 10 * q, 8, 0.95 * fade + 0.1, KICK.seed + 1);
  ring(frame, { ox: KICK_L - 4, radius: 6 + 18 * q, width: 2.5, squash: 0.55, bright: 0.7 * fade, erosion: q * 0.5, seed: KICK.seed + 2 });
  // 崩れのひび: 衝撃点から前と斜めへ折れ線
  for (let i = 0; i < 4; i++) {
    const a = (i - 1.5) * 0.55;
    let x = KICK_L - 4;
    let y = 0;
    const segs = 3;
    for (let s = 0; s < segs; s++) {
      const len = (6 + 3 * hash1(i * 5 + s, KICK.seed + 3)) * q;
      const turn = (hash1(i * 5 + s, KICK.seed + 4) - 0.5) * 0.9;
      const nx = x + Math.cos(a + turn) * len;
      const ny = y + Math.sin(a + turn) * len;
      bar(frame, x, y, nx, ny, 1.2, 0.6 * fade + 0.15);
      x = nx;
      y = ny;
    }
  }
  shards(frame, f - 2, 8, KICK.seed + 5, (i, r) => ({ x: KICK_L - 4, y: 0, vx: 2 + 4 * r(1), vy: (r(2) - 0.5) * 8, life: 3 + Math.floor(3 * r(3)), size: 2 }));
}

// ---------------------------------------------------------------------------
// 崩落槌（collapseHammer）: 半径 38px、半角 0.8
// ---------------------------------------------------------------------------

const HAMMER = { radiusPx: 38, half: 0.8, frames: 9, seed: 8001, impactFrame: 3 };
const HAMMER_R = HAMMER.radiusPx * DPX;
const HAMMER_AT = HAMMER_R * 0.55;

/** 大槌の頭（打つ面を +x に向けた四角い塊）と柄 */
function hammerHead(frame, hx, v) {
  bar(frame, 0, 0, hx - 6, 0, 3, 0.45 * v);
  paint(
    frame,
    (x, y) => {
      const dx = x - hx;
      if (Math.abs(dx) > 7 || Math.abs(y) > 14) return -1;
      // 縁の暗部と、打つ面（+x）の明るい縁
      if (Math.abs(dx) > 6 || Math.abs(y) > 13) return 0.2 * v;
      if (dx > 4) return 0.9 * v;
      return clamp01((0.5 - 0.15 * (y / 14)) * v);
    },
    { bounds: { x0: hx - 9, y0: -16, x1: hx + 9, y1: 16 }, dither: 0 },
  );
  // 鉄の帯
  bar(frame, hx - 2, -14, hx - 2, 14, 1.2, 0.7 * v);
}

/** 叩き下ろす（空中）: 槌の頭が前へ振り下ろされ、衝撃の星、瓦礫が扇に跳ねる */
function hammerDrop(frame, f) {
  const p = prog(f, HAMMER.frames);
  const I = HAMMER.impactFrame;
  if (f < I) {
    const k = (f + 1) / I;
    const hx = 10 + (HAMMER_AT - 10) * k * k;
    hammerHead(frame, hx, 1);
    for (let i = -2; i <= 2; i++) streakLine(frame, { ax: hx - 30, ay: i * 6, bx: hx - 9, by: i * 6, bright: 0.45 });
    return;
  }
  const t = f - I;
  const fade = 1 - smoothstep(0.5, 1, p);
  if (t < 2) hammerHead(frame, HAMMER_AT, 1 - t * 0.35);
  if (t < 3) starburst(frame, HAMMER_AT + 4, 0, 6 + t * 2, 16 + t * 4, 10, 0.95 * (1 - t / 4), HAMMER.seed + 1);
  if (t === 0) glint(frame, HAMMER_AT + 4, 0, 4);
  // 瓦礫: 扇の中へ跳ねて落ちる
  for (let i = 0; i < 14; i++) {
    const r = (k) => hash1(i * 7 + k, HAMMER.seed + 2);
    const a = (r(1) - 0.5) * 2 * HAMMER.half;
    const d = HAMMER_AT * 0.6 + (HAMMER_R - HAMMER_AT * 0.6) * r(2) * smoothstep(0, 4, t + 0.5);
    if (t > 4 + 2 * r(3)) continue;
    rock(frame, Math.cos(a) * d, Math.sin(a) * d, 1.6 + 1.2 * r(4), 0.55 * fade + 0.25);
  }
  for (let i = 0; i < 4; i++) {
    const a = (i - 1.5) * 0.45;
    dust(frame, HAMMER_AT + Math.cos(a) * (6 + t * 5), Math.sin(a) * (6 + t * 5), 5 + t * 1.5, 0.45 * fade, HAMMER.seed + 10 + i);
  }
}

/** 崩落（地面）: 衝撃点から扇へ地割れが枝分かれして走り、衝撃点の周りは輪のひびで陥没する */
function hammerCrack(frame, f) {
  const p = prog(f, HAMMER.frames);
  const I = HAMMER.impactFrame;
  if (f < I) {
    // 振り下ろす先の影
    flatRing(frame, HAMMER_AT, 0, 6 + f * 3, 10 + f * 3, 2, 0.3);
    return;
  }
  const q = smoothstep(0, 0.45, (f - I + 0.5) / (HAMMER.frames - I));
  const fade = 1 - smoothstep(0.6, 1, p);
  const seed = HAMMER.seed + 3;
  const v = 0.55 * fade + 0.12;
  // 陥没の輪（衝撃点の周りの割れた円）
  ring(frame, { ox: HAMMER_AT, radius: 10 + 4 * q, width: 1.6, bright: v, erosion: 0.25, seed });
  lump(frame, HAMMER_AT, 0, 9, seed + 1, 0.2, (qq, dx, dy) => (sparse(dx + 100, dy + 100) ? 0.18 : -1));
  // 放射の地割れ: 扇の中へ折れ線、途中で枝分かれ
  for (let i = 0; i < 9; i++) {
    const r = (k) => hash1(i * 11 + k, seed + 2);
    const a0 = (i / 8 - 0.5) * 2 * (HAMMER.half + 0.5) + (r(1) - 0.5) * 0.2;
    let x = HAMMER_AT + Math.cos(a0) * 10;
    let y = Math.sin(a0) * 10;
    const total = (HAMMER_R * 0.55 + HAMMER_R * 0.3 * r(2)) * q;
    let went = 0;
    let s = 0;
    while (went < total) {
      const len = Math.min(total - went, 6 + 5 * hash1(i * 7 + s, seed + 3));
      const a = a0 + (hash1(i * 7 + s, seed + 4) - 0.5) * 0.9;
      const nx = x + Math.cos(a) * len;
      const ny = y + Math.sin(a) * len;
      bar(frame, x, y, nx, ny, went < 12 ? 2 : 1.2, v);
      if (s === 1 && r(5) > 0.4) {
        const b = a + (r(6) > 0.5 ? 0.7 : -0.7);
        bar(frame, nx, ny, nx + Math.cos(b) * 9 * q, ny + Math.sin(b) * 9 * q, 1, v * 0.85);
      }
      x = nx;
      y = ny;
      went += len;
      s++;
    }
  }
  ring(frame, { ox: HAMMER_AT, radius: 8 + 26 * q, width: 3, squash: 0.7, bright: 0.6 * (1 - q), erosion: q * 0.5, seed: seed + 5 });
}

// ---------------------------------------------------------------------------
// 水刃（tideSlash）: 飛ぶ水の斬撃（半径 6px）
// ---------------------------------------------------------------------------

const TIDE = { seed: 8101 };

/** 放つ（cast）: 手元で水が前へ弾け、しぶきが扇に散る */
function tideCast(frame, f) {
  const frames = 6;
  const p = prog(f, frames);
  const fade = 1 - smoothstep(0.3, 1, p);
  crescent(frame, { ox: -2, R: 16 + p * 8, T: 6 * fade + 1, head: 1, tail: -1, peak: 0.5, seed: TIDE.seed, bright: 0.9, edge: 1.4, edgeReach: 1, erosion: smoothstep(0.4, 1, p) });
  for (let i = 0; i < 14; i++) {
    const r = (k) => hash1(i * 5 + k, TIDE.seed + 1);
    const a = (r(1) - 0.5) * 1.8;
    const d = 12 + (4 + 5 * r(2)) * (f + 0.5);
    if (f > 2 + 3 * r(3)) continue;
    drop(frame, Math.cos(a) * d, Math.sin(a) * d, 6);
  }
}

/** 水の三日月（fly）: 前へ膨らむ水の刃。内側に波の線、後ろの縁に泡の巻き、しぶきが尾を引く */
function tideWave(frame, f) {
  crescent(frame, { ox: -12, R: 22, T: 11, head: 1.15, tail: -1.15, peak: 0.5, seed: TIDE.seed + 2, bright: 1, edge: 1.6, edgeReach: 1, streak: 0.2 });
  // 波の線（揺れる）
  arcLine(frame, { ox: -12, radius: 16 + Math.sin(f * 0.8) * 1, from: -0.9, to: 0.9, bright: 0.85, width: 1.2 });
  // 泡の縁（内側の縁で白い泡がちぎれて揺れる）
  for (let i = 0; i < 9; i++) {
    const a = -1 + i * 0.25;
    const rr = 11 + Math.sin(f * 1.1 + i * 1.7) * 1.2;
    const x = -12 + Math.cos(a) * rr;
    const y = Math.sin(a) * rr;
    if ((i + f) % 3 !== 0) drop(frame, x, y, 7);
  }
  // しぶき: 両端から後ろへ
  for (let i = 0; i < 8; i++) {
    const side = i % 2 ? 1 : -1;
    const k = ((f / 8 + i / 8) % 1);
    const x = -10 - k * 22;
    const y = side * (18 - k * 6) + Math.sin(i * 3) * 2;
    dot(frame, x, y, k < 0.5 ? 7 : 5);
    if (k < 0.3) dot(frame, x + 1, y, 5);
  }
}

// ---------------------------------------------------------------------------
// 瞬凍（flashFreeze）: 半径 56px
// ---------------------------------------------------------------------------

const FREEZE = { radiusPx: 56, frames: 9, seed: 8201 };
const FREEZE_R = FREEZE.radiusPx * DPX;

/** 氷の棘（外向きの細い三角。片側を明るく） */
function spike(frame, a, r0, r1, wid) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  const bx = c * r0;
  const by = s * r0;
  const tx = c * r1;
  const ty = s * r1;
  tri(frame, bx - s * wid, by + c * wid, bx, by, tx, ty, 0.55);
  tri(frame, bx + s * wid, by - c * wid, bx, by, tx, ty, 0.85);
  dot(frame, tx, ty, 7);
}

/** 閃光と氷の棘（空中）: 一瞬の白い閃光のあと、氷の棘が放射に縁まで走って砕ける */
function freezeFlash(frame, f) {
  const p = prog(f, FREEZE.frames);
  if (f < 2) {
    const L = f === 0 ? 34 : 50;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      const len = i % 2 ? L * 0.55 : L;
      lens(frame, { ax: 0, ay: 0, bx: Math.cos(a) * len, by: Math.sin(a) * len, T: i % 2 ? 4 : 7, bright: 1.1, bias: 0 });
    }
    glint(frame, 0, 0, 4);
    lump(frame, 0, 0, 8 - f * 2, 3, 0, () => 1);
    return;
  }
  const q = smoothstep(0.15, 0.6, p);
  const shatter = smoothstep(0.6, 1, p);
  for (let i = 0; i < 18; i++) {
    const r = (k) => hash1(i * 7 + k, FREEZE.seed);
    const a = (i / 18) * TAU + r(1) * 0.2;
    const tip = FREEZE_R * q * (0.8 + 0.2 * r(2));
    const len = 24 + 14 * r(3);
    if (shatter < 0.5) spike(frame, a, Math.max(4, tip - len), tip, 4 + 2 * r(4));
    else {
      // 砕けた棘の欠片
      for (let k = 0; k < 3; k++) {
        const d = tip - k * 6 + shatter * 6;
        facet(frame, Math.cos(a) * d, Math.sin(a) * d, a + k, 4, 2.5, 0.8, 0.5);
      }
    }
  }
  if (f % 2 === 0 && p < 0.8) {
    for (let i = 0; i < 4; i++) {
      const a = hash1(i + f, FREEZE.seed + 3) * TAU;
      const d = FREEZE_R * q * 0.7;
      glint(frame, Math.cos(a) * d, Math.sin(a) * d, 2);
    }
  }
}

/** 霜の輪（地面）: 閃光の輪が縁まで広がり、通った床に霜の結晶の筋が残る */
function freezeRing(frame, f) {
  const p = prog(f, FREEZE.frames);
  const q = smoothstep(0, 0.6, p);
  const fade = 1 - smoothstep(0.6, 1, p);
  const reach = FREEZE_R * (0.1 + 0.9 * q);
  ring(frame, { radius: reach, width: 4 - 2 * q, bright: 0.9 * fade + 0.1, erosion: shatterErosion(p), seed: FREEZE.seed + 4 });
  // 霜の筋: 6 本の結晶の腕（枝を持つ）
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + 0.26;
    const len = reach * 0.9;
    bar(frame, Math.cos(a) * 6, Math.sin(a) * 6, Math.cos(a) * len, Math.sin(a) * len, 1.2, 0.55 * fade + 0.1);
    for (let k = 1; k <= 3; k++) {
      const d = (len * k) / 4;
      if (d < 10) continue;
      for (const s of [-1, 1]) {
        const b = a + s * 0.6;
        bar(frame, Math.cos(a) * d, Math.sin(a) * d, Math.cos(a) * d + Math.cos(b) * 7, Math.sin(a) * d + Math.sin(b) * 7, 1, 0.45 * fade + 0.1);
      }
    }
  }
}

function shatterErosion(p) {
  return smoothstep(0.5, 1, p) * 0.8;
}

/** 凍結（act）: 敵の足元から六角の氷塊が伸びて包み、面がきらめく */
function freezeEncase(frame, f) {
  const frames = 8;
  const p = prog(f, frames);
  const grow = smoothstep(0, 0.45, p);
  const W = 9;
  const H = 13;
  const bottom = H;
  const top = bottom - 2 * H * grow;
  paint(
    frame,
    (x, y) => {
      if (y < top || y > bottom) return -1;
      // 尖った六角（縦長）
      const ny = Math.abs(y) / H;
      const nx = Math.abs(x) / W;
      if (nx > 1 || nx * 0.5 + ny > 1.05) return -1;
      const edge = Math.min(1 - nx, 1.05 - nx * 0.5 - ny);
      if (edge < 0.08) return 0.95;
      if (Math.abs(x) < 0.8) return 0.75;
      // 面は透けた氷（中の敵が見えるよう間引く）。左の面に斜めの光の筋
      if (x < 0 && Math.abs(x + y * 0.5 + 3) < 1) return 0.85;
      if (!sparse(x + 20, y + 20)) return -1;
      return x < 0 ? 0.62 : 0.42;
    },
    { bounds: { x0: -W - 1, y0: -H - 2, x1: W + 1, y1: H + 2 }, dither: 0 },
  );
  if (p > 0.45 && p < 0.75) glint(frame, -4, top + 6, 3);
  if (p < 0.4) for (let i = 0; i < 5; i++) dot(frame, (hash1(i + f, FREEZE.seed + 6) - 0.5) * 20, bottom - (hash1(i, FREEZE.seed + 7) * 6), 6);
}

// ---------------------------------------------------------------------------
// 彩刻（hueEtch）・色解き（hueRelease）
// ---------------------------------------------------------------------------

const HUE = { etchRadiusPx: 34, etchHalf: 0.8, releaseRadiusPx: 50, seed: 8301 };

/** 刻む（cast）: 斬撃が扇を払い、通った所に菱形の格子の彫り跡が刻まれてきらめく */
function etchCone(frame, f) {
  const frames = 8;
  const p = prog(f, frames);
  const R = HUE.etchRadiusPx * DPX;
  const H = HUE.etchHalf;
  const sweep = smoothstep(0, 0.5, p);
  const head = -H + 2 * H * sweep;
  const fade = 1 - smoothstep(0.55, 1, p);
  if (p < 0.75) crescent(frame, { R, T: 14, head, tail: Math.max(-H - 0.1, head - 1.3), peak: 0.15, seed: HUE.seed, erosion: smoothstep(0.45, 0.75, p), edge: 1.8 });
  // 彫り跡: 扇の中の菱形の格子（刃が通った角まで）
  paint(
    frame,
    (x, y) => {
      const d = Math.hypot(x, y);
      if (d < 14 || d > R - 8) return -1;
      const a = Math.atan2(y, x);
      if (a > head || a < -H) return -1;
      const g = 11;
      const u = (((x + y) % g) + g) % g;
      const v = (((x - y) % g) + g) % g;
      const line = Math.min(u, g - u) < 0.8 || Math.min(v, g - v) < 0.8;
      if (!line) {
        // 一部の菱形の面がきらめく
        const id = Math.floor((x + y) / g) * 31 + Math.floor((x - y) / g);
        if (hash1(id, HUE.seed + 1) > 0.9 && ((f + Math.floor(hash1(id, HUE.seed + 2) * 4)) % 4) === 0) return 0.75 * fade + 0.1;
        return -1;
      }
      return clamp01(0.62 * fade + 0.12);
    },
    { bounds: { x0: 0, y0: -R, x1: R, y1: R }, dither: 0 },
  );
}

/** 色解き（空中）: 菱形の結晶片が放射に弾け、光の筋が走る */
function releaseBurst(frame, f) {
  const frames = 9;
  const p = prog(f, frames);
  const R = HUE.releaseRadiusPx * DPX;
  const q = smoothstep(0, 0.7, p);
  const fade = 1 - smoothstep(0.6, 1, p);
  if (p < 0.4) {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + 0.5;
      streakLine(frame, { ax: Math.cos(a) * R * 0.1, ay: Math.sin(a) * R * 0.1, bx: Math.cos(a) * R * (0.3 + q), by: Math.sin(a) * R * (0.3 + q), bright: 0.8, width: 2 });
    }
    glint(frame, 0, 0, 4);
  }
  for (let i = 0; i < 14; i++) {
    const r = (k) => hash1(i * 7 + k, HUE.seed + 3);
    const a = (i / 14) * TAU + r(1) * 0.3;
    const d = R * (0.12 + 0.8 * q * (0.75 + 0.25 * r(2)));
    const size = (10 + 6 * r(3)) * (0.45 + 0.55 * fade);
    if (size < 4) continue;
    facet(frame, Math.cos(a) * d, Math.sin(a) * d, a + p * (r(4) - 0.5) * 3, size * 1.7, size, 0.92, 0.5);
  }
}

/** 色解き（地面）: 6 枚の花弁が開いて輪が縁まで広がる */
function releaseBloom(frame, f) {
  const frames = 9;
  const p = prog(f, frames);
  const R = HUE.releaseRadiusPx * DPX;
  const q = smoothstep(0, 0.6, p);
  const fade = 1 - smoothstep(0.55, 1, p);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + p * 0.5;
    const len = R * 0.85 * q;
    if (len < 6) continue;
    lens(frame, { ax: Math.cos(a) * 4, ay: Math.sin(a) * 4, bx: Math.cos(a) * len, by: Math.sin(a) * len, T: 18 * q, bright: 0.5 * fade + 0.1, bias: 0, erosion: smoothstep(0.5, 1, p) * 0.7, seed: HUE.seed + 10 + i });
  }
  ring(frame, { radius: R * q, width: 3, bright: 0.75 * fade + 0.1, erosion: smoothstep(0.5, 1, p) * 0.7, seed: HUE.seed + 5 });
}

/** 彩痕が弾ける（act）: 敵の上の菱形の結晶が 4 片に割れて散り、輪が広がる */
function releasePop(frame, f) {
  const frames = 7;
  const p = prog(f, frames);
  const fade = 1 - smoothstep(0.4, 1, p);
  if (f < 2) {
    facet(frame, 0, 0, Math.PI / 2, 22, 13, 0.95, 0.6);
    glint(frame, 0, 0, f === 0 ? 3 : 4);
    return;
  }
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + Math.PI / 4;
    const d = 4 + (f - 1) * 5;
    facet(frame, Math.cos(a) * d, Math.sin(a) * d, a + f * 0.4, 11, 7, 0.9 * fade + 0.1, 0.5 * fade + 0.1);
  }
  ring(frame, { radius: 6 + p * 16, width: 1.4, bright: 0.5 * fade, erosion: 0.3 });
}

// ---------------------------------------------------------------------------
// 吸魔の矢（siphonMark）
// ---------------------------------------------------------------------------

const SIPHON = { seed: 8401 };

/** 放つ（cast）: 弓の弧が閃いて弦が戻り、闇の筋が手元へ吸い込まれる */
function siphonCast(frame, f) {
  const frames = 6;
  const p = prog(f, frames);
  const fade = 1 - smoothstep(0.3, 1, p);
  arcLine(frame, { ox: -8, radius: 16, from: -1.1, to: 1.1, bright: 0.95 * fade + 0.05, width: 2 });
  // 弦（戻り切る）
  const back = -8 + 16 * Math.cos(1.1) - (1 - p) * 6;
  bar(frame, -8 + 16 * Math.cos(1.1), -16 * Math.sin(1.1), back, 0, 1, 0.7 * fade);
  bar(frame, back, 0, -8 + 16 * Math.cos(1.1), 16 * Math.sin(1.1), 1, 0.7 * fade);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU;
    const d = 24 * (1 - p) + 4;
    streakLine(frame, { ax: 10 + Math.cos(a) * (d + 6), ay: Math.sin(a) * (d + 6), bx: 10 + Math.cos(a) * d, by: Math.sin(a) * d, bright: 0.6 });
  }
  if (p < 0.4) glint(frame, 10, 0, 3);
}

/** 飛ぶ矢（fly）: 矢羽根・細い柄・菱形の鏃。柄の周りを吸い込みの螺旋が巻き、後ろに粒が引かれる */
function siphonArrow(frame, f) {
  // 螺旋（手前は明るく、奥は暗い）
  for (let x = -30; x < 6; x += 0.5) {
    const ph = x * 0.42 + f * 0.8;
    const amp = 4.5 * (0.5 + 0.5 * ((x + 30) / 36));
    dot(frame, x, Math.sin(ph) * amp, Math.cos(ph) > 0 ? 6 : 3);
  }
  bar(frame, -16, 0, 8, 0, 1.6, 0.62);
  // 鏃
  tri(frame, 8, -4, 8, 4, 17, 0, 0.8);
  bar(frame, 8, 0, 16, 0, 1, 1);
  // 矢羽根
  for (const s of [-1, 1]) {
    tri(frame, -16, 0, -11, 0, -18, s * 5, 0.55);
  }
  for (let i = 0; i < 4; i++) {
    const k = ((f / 8 + i / 4) % 1);
    dot(frame, -20 - k * 16, (i % 2 ? 1 : -1) * (2 + 5 * k), k < 0.5 ? 6 : 4);
  }
}

// ---------------------------------------------------------------------------
// 死の宣告（doomSentence）: 半径 24px
// ---------------------------------------------------------------------------

const DOOM = { radiusPx: 24, frames: 10, seed: 8501 };
const DOOM_R = DOOM.radiusPx * DPX;

/** 時計の文字盤の魔法陣（地面）: 外の輪が描かれて閉じ、12 の目盛りが刻まれ、針が回って真上で止まる */
function doomSigil(frame, f) {
  const p = prog(f, DOOM.frames);
  const draw = smoothstep(0, 0.45, p);
  const fade = 1 - smoothstep(0.7, 1, p);
  const flash = p > 0.5 && p < 0.65 ? 1 : 0;
  const v = (0.8 + 0.2 * flash) * fade + 0.1;
  const from = -Math.PI / 2;
  if (draw > 0.02) arcProgress(frame, DOOM_R, 3, from, TAU * draw, v);
  if (draw > 0.02) arcProgress(frame, DOOM_R * 0.7, 1.5, from + Math.PI, TAU * draw, v * 0.8);
  for (let i = 0; i < 12; i++) {
    if (i / 12 > draw) continue;
    const a = from + (i / 12) * TAU;
    const long = i % 3 === 0;
    bar(frame, Math.cos(a) * DOOM_R * (long ? 0.72 : 0.8), Math.sin(a) * DOOM_R * (long ? 0.72 : 0.8), Math.cos(a) * DOOM_R * 0.94, Math.sin(a) * DOOM_R * 0.94, long ? 2 : 1.2, v);
  }
  // 針: 長針が回り、終わりに短針と重なって真上（零時）を指す
  const hand = from + TAU * (1 - smoothstep(0, 0.55, p)) * 1.5;
  bar(frame, 0, 0, Math.cos(hand) * DOOM_R * 0.62, Math.sin(hand) * DOOM_R * 0.62, 1.6, v);
  bar(frame, 0, 0, Math.cos(from) * DOOM_R * 0.4, Math.sin(from) * DOOM_R * 0.4, 2.4, v);
  lump(frame, 0, 0, 2.5, 1, 0, () => v);
}

/** 砂時計の形（画面に揃う）。sand = 上の砂の残り（0..1） */
function hourglass(frame, cx, cy, sand, v) {
  const W = 11;
  const H = 15;
  paint(
    frame,
    (x, y) => {
      const dx = x - cx;
      const dy = y - cy;
      if (Math.abs(dy) > H) return -1;
      const w = 1 + (W - 1) * (Math.abs(dy) / H);
      if (Math.abs(dx) > w) return -1;
      // 縁（ガラス）
      if (Math.abs(dx) > w - 1.2 || Math.abs(dy) > H - 1.2) return v;
      // 砂: 上は残りの分だけ（下から減る）、下は溜まった分
      const topLevel = -H + (1 - sand) * H;
      if (dy < 0 && dy > topLevel) return v * 0.7;
      if (dy > 0 && dy > H - (1 - sand) * H) return v * 0.7;
      if (Math.abs(dx) < 0.6) return v * 0.6;
      return -1;
    },
    { bounds: { x0: cx - W - 2, y0: cy - H - 2, x1: cx + W + 2, y1: cy + H + 2 }, dither: 0 },
  );
  bar(frame, cx - W - 1, cy - H, cx + W + 1, cy - H, 2, v);
  bar(frame, cx - W - 1, cy + H, cx + W + 1, cy + H, 2, v);
}

/** 宣告（空中）: 頭上に砂時計が現れて砂が落ち、落ち切ると宣告の杭が中心へ突き立つ */
function doomMark(frame, f) {
  const p = prog(f, DOOM.frames);
  const hy = -DOOM_R - 22;
  const appear = smoothstep(0, 0.2, p);
  const fade = 1 - smoothstep(0.75, 1, p);
  hourglass(frame, 0, hy, 1 - smoothstep(0.1, 0.5, p), (0.4 + 0.55 * appear) * fade + 0.05);
  if (p > 0.5) {
    const k = smoothstep(0.5, 0.62, p);
    // 杭: 砂時計の下から中心へ
    const tipY = hy + 16 + (-hy - 16) * k;
    bar(frame, 0, hy + 16, 0, tipY - 6, 4, 0.8 * fade + 0.1);
    tri(frame, -6, tipY - 8, 6, tipY - 8, 0, tipY + 3, 0.95 * fade + 0.05);
    if (k >= 1) {
      ring(frame, { radius: 6 + 20 * smoothstep(0.62, 1, p), width: 2.5, squash: 1, bright: 0.8 * fade, erosion: 0.2, seed: DOOM.seed });
      if (p < 0.75) glint(frame, 0, 0, 4);
    }
  }
}

// ---------------------------------------------------------------------------
// 移ろい刃（shiftingEdge）: 半径 34px、半角 0.8
// ---------------------------------------------------------------------------

const SHIFT = { radiusPx: 34, half: 0.8, seed: 8601 };

const MOTIF_FLAME = ["...6...", "..676..", "..565..", ".56765.", ".45654.", "..444.."];
const MOTIF_CRYSTAL = ["..5..", "5.6.5", ".676.", "5.6.5", "..5.."];
const MOTIF_BOLT = ["...77", "..77.", ".7777", "..77.", ".77..", "77..."];
const MOTIF_DROP = ["..6..", ".565.", "56765", "45654", ".444."];
const SHIFT_MOTIFS = [MOTIF_FLAME, MOTIF_CRYSTAL, MOTIF_BOLT, MOTIF_DROP];

/** 斬る（cast）: 扇の斬撃の外縁に、炎・氷の結晶・稲妻・毒の滴が並ぶ（巡る 4 属性。色は今の属性） */
function shiftCone(frame, f) {
  const frames = 8;
  const p = prog(f, frames);
  const R = SHIFT.radiusPx * DPX;
  const H = SHIFT.half;
  const sweep = smoothstep(0, 0.5, p);
  const head = -H + 2 * H * sweep;
  const tail = Math.max(-H - 0.1, head - 1.4);
  const erosion = smoothstep(0.55, 1, p);
  crescent(frame, { R, T: 16, head, tail, peak: 0.15, seed: SHIFT.seed, erosion, edge: 1.8, streak: 0.5 });
  if (erosion > 0.8) return;
  for (let i = 0; i < 4; i++) {
    const a = head - 0.2 - i * 0.36;
    if (a < tail) continue;
    const motif = SHIFT_MOTIFS[i] ?? MOTIF_FLAME;
    stamp(frame, Math.cos(a) * (R + 9), Math.sin(a) * (R + 9), enlarge(dim(motif, 1 - erosion * 0.5), 2));
  }
}

// ---------------------------------------------------------------------------
// 極意（weaponArt）
// ---------------------------------------------------------------------------

const ART = { radiusPx: 40, seed: 8701 };
const ART_R = ART.radiusPx * DPX;
const ART_STEP_PX = 12;

/** 四芒星（中心 cx, cy。縦横の長さ lx, ly） */
function fourStar(frame, cx, cy, lx, ly, v) {
  paint(
    frame,
    (x, y) => {
      const u = Math.abs(x - cx) / lx;
      const w = Math.abs(y - cy) / ly;
      if (u > 1 || w > 1) return -1;
      const k = Math.sqrt(u) + Math.sqrt(w);
      if (k > 1) return -1;
      return clamp01(v * (1.1 - 0.6 * k));
    },
    { bounds: { x0: cx - lx - 1, y0: cy - ly - 1, x1: cx + lx + 1, y1: cy + ly + 1 }, dither: 0 },
  );
}

/** 気合い（cast）: 前に四芒星が閃き、輪と放射の光が弾ける */
function artFlash(frame, f) {
  const frames = 7;
  const p = prog(f, frames);
  const fade = 1 - smoothstep(0.3, 1, p);
  const k = f < 2 ? (f + 1) / 2 : 1;
  fourStar(frame, 14, 0, 26 * k * (0.6 + 0.4 * fade), 14 * k * fade + 2, 1);
  ring(frame, { ox: 14, radius: 6 + 18 * p, width: 2, bright: 0.75 * fade });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU + Math.PI / 8;
    const d = 10 + 16 * p;
    streakLine(frame, { ax: 14 + Math.cos(a) * d, ay: Math.sin(a) * d, bx: 14 + Math.cos(a) * (d + 6), by: Math.sin(a) * (d + 6), bright: 0.7 * fade });
  }
  if (p < 0.4) glint(frame, 14, 0, 4);
}

/** 面の技（end）: 体の前を半月に薙ぐ大きな斬撃。円の技はこれを反対向きにもう 1 枚重ねる */
function artSweep(frame, f) {
  const frames = 8;
  const p = prog(f, frames);
  const half = Math.PI / 2;
  const sweep = smoothstep(0, 0.5, p);
  const head = -half + 2 * half * sweep;
  const tail = Math.max(-half - 0.05, head - 2);
  const erosion = smoothstep(0.55, 1, p);
  crescent(frame, { R: ART_R, T: 22, head, tail, peak: 0.12, seed: ART.seed, erosion, edge: 2.2, streak: 0.5 });
  crescent(frame, { R: ART_R - 16, T: 7, head: head - 0.25, tail: Math.max(-half, head - 1.4), peak: 0.2, seed: ART.seed + 1, erosion: Math.min(1, erosion + 0.2), bright: 0.7 });
  for (let i = 0; i < 3; i++) {
    const to = head - 0.2 - i * 0.35;
    if (to - 0.6 < -half) continue;
    arcLine(frame, { radius: ART_R + 4 + i * 3, from: to - 0.6, to, bright: 0.7 * (1 - erosion), width: 1 });
  }
}

/** 線の技の手元（act）: 前へ細い閃きと、潰れた衝撃の輪 */
function artThrust(frame, f) {
  const frames = 7;
  const p = prog(f, frames);
  const fade = 1 - smoothstep(0.3, 1, p);
  lens(frame, { ax: 2, ay: 0, bx: 34, by: 0, T: 8 * fade + 2, bias: 0, bright: 1.05 });
  ring(frame, { ox: 6, radius: 4 + 14 * p, width: 2.5, squash: 0.4, bright: 0.8 * fade });
}

/** 突きの光条（beam。step px）: 白い芯の帯と、両脇を流れる速度線。細って消える */
function artBeam(frame, f) {
  const frames = 7;
  const p = prog(f, frames);
  const half = ART_STEP_PX;
  const width = 4.5 * (1 - p) + 0.8;
  paint(
    frame,
    (x, y) => {
      if (Math.abs(x) > half + 0.5) return -1;
      const d = Math.abs(y) / width;
      if (d > 1) return -1;
      return clamp01((1.1 - 0.6 * d) * (1 - 0.5 * p));
    },
    { bounds: { x0: -half - 1, y0: -width - 2, x1: half + 1, y1: width + 2 }, dither: 0 },
  );
  if (p < 0.6) for (const s of [-1, 1]) bar(frame, -half + ((f * 5) % 8), s * (width + 3), half - 6 + ((f * 5) % 8), s * (width + 3), 1, 0.45);
}

/** 突きの先（tip）: 前へ尖った火花の星 */
function artTip(frame, f) {
  const frames = 7;
  const p = prog(f, frames);
  const fade = 1 - smoothstep(0.25, 1, p);
  fourStar(frame, 0, 0, 16 * fade + 4, 10 * fade + 2, 1);
  shards(frame, f, 9, ART.seed + 3, (i, r) => ({ x: 0, y: 0, vx: 2 + 4 * r(1), vy: (r(2) - 0.5) * 8, life: 3 + Math.floor(3 * r(3)) }));
}

/** 魔弾（fly）: 光の菱形の弾と、後ろの細い尾 */
function artBolt(frame, f) {
  lens(frame, { ax: -8, ay: 0, bx: 8, by: 0, T: 7, bias: 0, bright: 1.1 });
  streakLine(frame, { ax: -26, ay: 0, bx: -8, by: 0, bright: 0.7, width: 2 });
  for (let i = 0; i < 2; i++) dot(frame, -12 - ((f * 5 + i * 9) % 16), (i ? 1 : -1) * 3, 5);
  if (f % 2 === 0) glint(frame, 2, 0, 2);
}

// ---------------------------------------------------------------------------
// 結界杭（wardStake）
// ---------------------------------------------------------------------------

const STAKE = { seed: 8801, height: 24 };
const STAKE_STEP_PX = 12;

/** 杭: 上が太く下が尖った柱、縄の帯、横に下がる札（sway で揺れる） */
function stakePost(frame, cx, cy, sway, v = 1) {
  const H = STAKE.height;
  paint(
    frame,
    (x, y) => {
      const dx = x - cx;
      const dy = y - cy;
      if (dy > 0 || dy < -H) return -1;
      const u = -dy / H;
      const w = 1 + 2.4 * Math.min(1, u * 2.5);
      if (Math.abs(dx) > w) return -1;
      if (Math.abs(dx) > w - 0.9) return 0.25 * v;
      return clamp01((dx < 0 ? 0.62 : 0.42) * v);
    },
    { bounds: { x0: cx - 5, y0: cy - H - 2, x1: cx + 5, y1: cy + 1 }, dither: 0 },
  );
  // 頭の明るい切り口
  bar(frame, cx - 3, cy - H, cx + 3, cy - H, 1.5, 0.85 * v);
  // 縄
  bar(frame, cx - 4, cy - H + 7, cx + 4, cy - H + 6, 1.6, 0.75 * v);
  // 札（縄から下がる白い紙。中に墨の一筆）
  const px = cx + 4 + sway;
  paint(
    frame,
    (x, y) => {
      const dx = x - px - (y - (cy - H + 6)) * sway * 0.08;
      const dy = y - (cy - H + 6);
      if (dy < 0 || dy > 10 || dx < 0 || dx > 4) return -1;
      return 0.95 * v;
    },
    { bounds: { x0: px - 2, y0: cy - H + 5, x1: px + 7, y1: cy - H + 17 }, dither: 0 },
  );
  bar(frame, px + 2, cy - H + 8, px + 2 + sway * 0.4, cy - H + 13, 1, 0.3 * v, "set");
}

/** 打ち込む（cast）: 杭が上から落ちて刺さり、足元に輪と土煙、光の粒が昇る */
function stakeDrive(frame, f) {
  const frames = 8;
  const p = prog(f, frames);
  if (f < 2) {
    const y = -26 + f * 16;
    stakePost(frame, 0, y, 0);
    for (let i = -1; i <= 1; i++) streakLine(frame, { ax: i * 3, ay: y - STAKE.height - 16, bx: i * 3, by: y - STAKE.height - 2, bright: 0.5 });
    return;
  }
  const t = f - 2;
  const fade = 1 - smoothstep(0.4, 1, p);
  stakePost(frame, 0, 0, Math.sin(t) * 1.5);
  flatRing(frame, 0, 0, 6 + t * 5, 3 + t * 2.5, 2, 0.8 * fade + 0.1, t * 0.1, STAKE.seed);
  for (const s of [-1, 1]) dust(frame, s * (5 + t * 3), 1, 3 + t, 0.4 * fade, STAKE.seed + (s > 0 ? 1 : 2));
  if (t === 0) glint(frame, 0, -STAKE.height, 3);
  for (let i = 0; i < 6; i++) {
    const x = (hash1(i, STAKE.seed + 3) - 0.5) * 20;
    dot(frame, x, -2 - t * 4 - hash1(i, STAKE.seed + 4) * 6, 6);
  }
}

const STAKE_FRAMES = 8;

/** 立っている杭（placed の空中）: 札が風に揺れ、光の粒がゆっくり昇る */
function stakeStand(frame, f) {
  const sway = Math.sin((f / STAKE_FRAMES) * TAU) * 1.5;
  stakePost(frame, 0, 0, sway);
  for (let i = 0; i < 4; i++) {
    const k = (f / STAKE_FRAMES + i / 4) % 1;
    const x = (hash1(i, STAKE.seed + 5) - 0.5) * 16;
    if (k > 0.85) continue;
    dot(frame, x + Math.sin(k * 6 + i) * 1.5, -2 - k * 26, k < 0.5 ? 6 : 4);
  }
}

/** 杭の足元（placed の地面）: 脈打つ光の輪 */
function stakeGlow(frame, f) {
  const k = 0.5 + 0.5 * Math.sin((f / STAKE_FRAMES) * TAU);
  flatRing(frame, 0, 0, 8 + k * 2, 4 + k, 1.6, 0.5 + 0.3 * k);
  flatRing(frame, 0, 0, 4, 2, 1.2, 0.35 + 0.2 * k);
}

/** 線が脈打つ（act の手元）: 杭の上で小さな閃き */
function stakeSpark(frame, f) {
  const frames = 6;
  const p = prog(f, frames);
  if (p < 0.5) glint(frame, 0, -STAKE.height + 2, p < 0.25 ? 3 : 2);
  flatRing(frame, 0, 0, 5 + 8 * p, 2.5 + 4 * p, 1.4, 0.6 * (1 - p));
}

/** 結ぶ線（beam。step px）: 光の鎖（区間ごとに 1 つの菱形の輪）と白い芯。ぱちぱちと光り、細って消える */
function stakeLine(frame, f) {
  const frames = 6;
  const p = prog(f, frames);
  const half = STAKE_STEP_PX;
  const v = 1 - 0.55 * p;
  bar(frame, -half - 0.5, 0, half + 0.5, 0, p < 0.5 ? 2 : 1, 0.95 * v);
  // 鎖の輪（菱形）
  const L = 7;
  const W = 3.5;
  for (const [ax, ay, bx, by] of [
    [-L, 0, 0, -W],
    [0, -W, L, 0],
    [L, 0, 0, W],
    [0, W, -L, 0],
  ]) bar(frame, ax, ay, bx, by, 1.1, 0.8 * v);
  // 火花
  if (f % 2 === 0 && p < 0.7) {
    const x = (hash1(f, STAKE.seed + 6) - 0.5) * half * 2;
    dot(frame, x, (hash1(f, STAKE.seed + 7) - 0.5) * 6, 7);
  }
}

// ---------------------------------------------------------------------------
// 泥沼（mire）: 半径 30px
// ---------------------------------------------------------------------------

const MIRE = { radiusPx: 30, frames: 9, seed: 8901 };
const MIRE_R = MIRE.radiusPx * DPX;

/** 泥の塊（暗い玉。上に鈍い艶） */
function clod(frame, x, y, r) {
  lump(frame, x, y, r, 5 + Math.floor(x + y), 0.2, (q, dx, dy) => clamp01(0.36 - 0.12 * q + (dx + dy < -r * 0.6 ? 0.2 : 0)));
}

/** 撒く（空中）: 泥の塊が放り上げられ、弧を描いて落ちて潰れる */
function mireSplash(frame, f) {
  const seed = MIRE.seed;
  for (let i = 0; i < 12; i++) {
    const r = (k) => hash1(i * 7 + k, seed);
    const a = (i / 12) * TAU + r(1) * 0.4;
    const land = MIRE_R * (0.3 + 0.6 * r(2));
    const k = Math.min(1, (f + 0.5) / 5);
    const x = Math.cos(a) * land * k;
    const y = Math.sin(a) * land * k - 18 * Math.sin(Math.PI * k);
    if (k < 1) clod(frame, x, y, 2 + 1.5 * r(3));
    else if (f < 7) {
      // 落ちた所で潰れて飛沫
      for (let s = -1; s <= 1; s += 2) dot(frame, x + s * (3 + (f - 5)), y - 1, 3);
    }
  }
}

/** 撒く（地面）: 泥が広がり、厚い縁が盛り上がる */
function mireSpread(frame, f) {
  const p = prog(f, MIRE.frames);
  const reach = MIRE_R * (0.25 + 0.75 * smoothstep(0, 0.65, p));
  const fade = 1 - smoothstep(0.65, 1, p);
  const seed = MIRE.seed + 3;
  paint(
    frame,
    (x, y) => {
      const d = Math.hypot(x, y);
      const rr = wobble(Math.atan2(y, x), reach, seed, 0.16);
      if (d > rr) return -1;
      const rim = rr - d;
      if (rim < 3) return rim < 1.2 ? 0.55 * fade + 0.1 : 0.4 * fade + 0.1;
      if (!sparse(x, y)) return -1;
      return 0.25 * fade + 0.08;
    },
    { bounds: { x0: -MIRE_R - 8, y0: -MIRE_R - 8, x1: MIRE_R + 8, y1: MIRE_R + 8 }, dither: 0 },
  );
  if (p > 0.3) ring(frame, { radius: reach * 0.55, width: 1.5, bright: 0.4 * fade, erosion: 0.4, seed: seed + 1 });
}

const MIRE_PLACED_FRAMES = 10;

/** ぬかるみ（placed の空中）: ところどころで泥の泡が膨らんで弾ける */
function mireBubble(frame, f) {
  const seed = MIRE.seed + 5;
  for (let i = 0; i < 7; i++) {
    const r = (k) => hash1(i * 7 + k, seed);
    const a = r(1) * TAU;
    const d = MIRE_R * 0.8 * Math.sqrt(r(2));
    const age = (f + Math.floor(r(3) * MIRE_PLACED_FRAMES)) % MIRE_PLACED_FRAMES;
    const x = Math.cos(a) * d;
    const y = Math.sin(a) * d;
    const size = 2 + 2.5 * r(4);
    if (age < 4) {
      const rad = 1 + (size * (age + 1)) / 4;
      lump(frame, x, y, rad, 2, 0, (q, dx, dy) => (q > 0.7 ? 0.45 : dx + dy < -rad * 0.5 ? 0.62 : 0.3));
    } else if (age < 7) {
      const k = age - 4;
      flatRing(frame, x, y, size + 2 + k * 2.5, (size + 2 + k * 2.5) * 0.6, 1.2, 0.45 * (1 - k / 3));
      for (const s of [-1, 1]) dot(frame, x + s * (size + k), y - 2 - k * 1.5, 4);
    }
  }
}

/** 沈む（act）: 敵の足元で泥が渦を巻いて締まり、泥の指が掴み上がる */
function mireGrip(frame, f) {
  const frames = 8;
  const p = prog(f, frames);
  const fade = 1 - smoothstep(0.5, 1, p);
  const rx = 16 - 8 * smoothstep(0, 0.7, p);
  flatRing(frame, 0, 4, rx, rx * 0.5, 2, 0.5 * fade + 0.1);
  // 泥の指: 輪から上へ伸びて内へ曲がる
  const rise = 4 + 8 * Math.sin(Math.PI * Math.min(1, p * 1.4));
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + 0.3;
    const bx = Math.cos(a) * rx;
    const by = 4 + Math.sin(a) * rx * 0.5;
    const mx = bx * 0.85;
    const my = by - rise * 0.6;
    bar(frame, bx, by, mx, my, 2.6, 0.38 * fade + 0.12);
    bar(frame, mx, my, bx * 0.55, by - rise, 1.8, 0.45 * fade + 0.12);
    dot(frame, bx * 0.55, by - rise - 1, 5);
  }
}

// ---------------------------------------------------------------------------
// 表
// ---------------------------------------------------------------------------

/**
 * スキル → 絵（render/fxMotions.ts の SkillFx）。出来事はスキルの処理（src/skills/actions2.ts・placed.ts）が addSkillFx で積む:
 * - cast の pos は発動地点（照準地点のスキルは照準地点）、to はビームの終点
 * - act: 地均しの砕いたマス / 火吸いの吸ったマス（to = 自分）/ 烙火で烙印が倍になった敵 / 瞬凍で凍った敵 /
 *   色解きで弾けた敵（属性 = 彩痕の色）/ 極意の線の技（to = 先）/ 結界杭の線の当たり（pos → to の杭）/ 泥沼で掴んだ敵
 * - end: 凍て道の止まった所（to = 滑り始め）/ 極意の面の技（円の技は反対向きにもう 1 つ）
 */
const FX = {
  skills: {
    waterJar: {
      ramp: "ice",
      cast: { sheet: "skillWave2.jarBreak", life: 0.55, base: JAR.radiusPx, ground: "skillWave2.jarSplash" },
    },
    oilPot: {
      ramp: "brass",
      cast: { sheet: "skillWave2.oilPour", life: 0.55, base: OIL.radiusPx, ground: "skillWave2.oilSplat" },
    },
    scorchLine: {
      ramp: "fire",
      cast: { sheet: "skillWave2.scorchFlare", life: 0.45, beam: { sheet: "skillWave2.scorchBeam", step: SCORCH_STEP_PX }, tip: "skillWave2.scorchTip" },
    },
    iceSlide: {
      ramp: "ice",
      cast: { sheet: "skillWave2.slideKick", life: 0.3 },
      active: { sheet: "skillWave2.slideActive", base: 0 },
      end: { sheet: "skillWave2.slideStop", life: 0.35, beam: { sheet: "skillWave2.slideTrail", step: SLIDE_STEP_PX } },
    },
    levelGround: {
      ramp: "brass",
      cast: { sheet: "skillWave2.levelStomp", life: 0.45, beam: { sheet: "skillWave2.levelBeam", step: LEVEL_STEP_PX }, tip: "skillWave2.levelTip" },
      act: { sheet: "skillWave2.levelRubble", life: 0.4 },
    },
    emberDraw: {
      ramp: "fire",
      cast: { sheet: "skillWave2.emberSwirl", life: 0.45, base: EMBER.radiusPx },
      act: { sheet: "skillWave2.emberPuff", life: 0.35, beam: { sheet: "skillWave2.emberStream", step: EMBER_STEP_PX } },
      fly: { sheet: "skillWave2.emberBall", base: 4, period: 0.4 },
    },
    bogCall: {
      ramp: "poison",
      cast: { sheet: "skillWave2.bogBubbles", life: 0.6, base: BOG.radiusPx, ground: "skillWave2.bogWell" },
    },
    brandSear: {
      ramp: "fire",
      cast: { sheet: "skillWave2.searCone", life: 0.45, base: BRAND.searRadiusPx },
    },
    brandBlast: {
      ramp: "fire",
      cast: { sheet: "skillWave2.blastBurst", life: 0.5, base: BRAND.blastRadiusPx, ground: "skillWave2.blastSigil" },
      act: { sheet: "skillWave2.brandDouble", life: 0.4 },
    },
    breakKick: {
      ramp: "steel",
      cast: { sheet: "skillWave2.kick", life: 0.35, base: KICK.lengthPx },
    },
    collapseHammer: {
      ramp: "brass",
      cast: { sheet: "skillWave2.hammerDrop", life: 0.5, base: HAMMER.radiusPx, ground: "skillWave2.hammerCrack" },
    },
    tideSlash: {
      ramp: "ice",
      cast: { sheet: "skillWave2.tideCast", life: 0.25 },
      fly: { sheet: "skillWave2.tideWave", base: 0, period: 0.4 },
    },
    flashFreeze: {
      ramp: "ice",
      cast: { sheet: "skillWave2.freezeFlash", life: 0.5, base: FREEZE.radiusPx, ground: "skillWave2.freezeRing" },
      act: { sheet: "skillWave2.freezeEncase", life: 0.55 },
    },
    hueEtch: {
      ramp: "light",
      cast: { sheet: "skillWave2.etchCone", life: 0.45, base: HUE.etchRadiusPx },
    },
    hueRelease: {
      ramp: "light",
      cast: { sheet: "skillWave2.releaseBurst", life: 0.5, base: HUE.releaseRadiusPx, ground: "skillWave2.releaseBloom" },
      act: { sheet: "skillWave2.releasePop", life: 0.4 },
    },
    siphonMark: {
      ramp: "dark",
      cast: { sheet: "skillWave2.siphonCast", life: 0.25 },
      fly: { sheet: "skillWave2.siphonArrow", base: 0, period: 0.35 },
    },
    doomSentence: {
      ramp: "dark",
      cast: { sheet: "skillWave2.doomMark", life: 0.8, base: DOOM.radiusPx, ground: "skillWave2.doomSigil" },
    },
    shiftingEdge: {
      ramp: "steel",
      cast: { sheet: "skillWave2.shiftCone", life: 0.4, base: SHIFT.radiusPx },
    },
    weaponArt: {
      ramp: "steel",
      cast: { sheet: "skillWave2.artFlash", life: 0.3 },
      act: { sheet: "skillWave2.artThrust", life: 0.3, beam: { sheet: "skillWave2.artBeam", step: ART_STEP_PX }, tip: "skillWave2.artTip" },
      end: { sheet: "skillWave2.artSweep", life: 0.35, base: ART.radiusPx },
      fly: { sheet: "skillWave2.artBolt", base: 0, period: 0.3 },
    },
    wardStake: {
      ramp: "brass",
      cast: { sheet: "skillWave2.stakeDrive", life: 0.4 },
      placed: { sheet: "skillWave2.stakeStand", base: 0, period: 1.2, ground: "skillWave2.stakeGlow" },
      act: { sheet: "skillWave2.stakeSpark", life: 0.45, beam: { sheet: "skillWave2.stakeLine", step: STAKE_STEP_PX } },
    },
    mire: {
      ramp: "brass",
      cast: { sheet: "skillWave2.mireSplash", life: 0.5, base: MIRE.radiusPx, ground: "skillWave2.mireSpread" },
      placed: { sheet: "skillWave2.mireBubble", base: MIRE.radiusPx, period: 1.8 },
      act: { sheet: "skillWave2.mireGrip", life: 0.45 },
    },
  },
};

const S = (key, dirs, frames, size, draw) => ({ key: `skillWave2.${key}`, dirs, frames, active: 0, size, draw });

export const ATLAS = {
  key: "skillWave2",
  fx: FX,
  sheets: [
    S("jarBreak", 1, JAR.frames, sheetSize(JAR.radiusPx, 20), jarBreak),
    S("jarSplash", 1, JAR.frames, sheetSize(JAR.radiusPx, 10), jarSplash),
    S("oilPour", 1, OIL.frames, sheetSize(OIL.radiusPx, 20), oilPour),
    S("oilSplat", 1, OIL.frames, sheetSize(OIL.radiusPx, 16), oilSplat),
    S("scorchFlare", DIRS, SCORCH.frames, 100, scorchFlare),
    S("scorchBeam", 1, SCORCH.frames, 48, scorchBeam),
    S("scorchTip", DIRS, SCORCH.frames, 80, scorchTip),
    S("slideKick", DIRS, 6, 80, slideKick),
    S("slideActive", DIRS, 8, 180, slideActive),
    S("slideStop", DIRS, 8, 100, slideStop),
    S("slideTrail", 1, 8, 40, slideTrail),
    S("levelStomp", DIRS, LEVEL.frames, 120, levelStomp),
    S("levelBeam", 1, LEVEL.frames, 64, levelBeam),
    S("levelTip", DIRS, LEVEL.frames, 90, levelTip),
    S("levelRubble", 1, 7, 64, levelRubble),
    S("emberSwirl", 1, EMBER.frames, sheetSize(EMBER.radiusPx, 16), emberSwirl),
    S("emberPuff", 1, 7, 48, emberPuff),
    S("emberStream", 1, 8, 40, emberStream),
    S("emberBall", DIRS, 8, 72, emberBall),
    S("bogWell", 1, BOG.frames, sheetSize(BOG.radiusPx, 20), bogWell),
    S("bogBubbles", 1, BOG.frames, sheetSize(BOG.radiusPx, 40), bogBubbles),
    S("searCone", DIRS, 8, sheetSize(BRAND.searRadiusPx, 24), searCone),
    S("blastSigil", 1, 9, sheetSize(BRAND.blastRadiusPx, 12), blastSigil),
    S("blastBurst", 1, 9, sheetSize(BRAND.blastRadiusPx, 30), blastBurst),
    S("brandDouble", 1, 7, 64, brandDouble),
    S("kick", DIRS, 8, sheetSize(KICK.lengthPx, 50), kick),
    S("hammerDrop", DIRS, HAMMER.frames, sheetSize(HAMMER.radiusPx, 30), hammerDrop),
    S("hammerCrack", DIRS, HAMMER.frames, sheetSize(HAMMER.radiusPx, 16), hammerCrack),
    S("tideCast", DIRS, 6, 90, tideCast),
    S("tideWave", DIRS, 8, 90, tideWave),
    S("freezeFlash", 1, FREEZE.frames, sheetSize(FREEZE.radiusPx, 30), freezeFlash),
    S("freezeRing", 1, FREEZE.frames, sheetSize(FREEZE.radiusPx, 12), freezeRing),
    S("freezeEncase", 1, 8, 48, freezeEncase),
    S("etchCone", DIRS, 8, sheetSize(HUE.etchRadiusPx, 16), etchCone),
    S("releaseBurst", 1, 9, sheetSize(HUE.releaseRadiusPx, 24), releaseBurst),
    S("releaseBloom", 1, 9, sheetSize(HUE.releaseRadiusPx, 16), releaseBloom),
    S("releasePop", 1, 7, 64, releasePop),
    S("siphonCast", DIRS, 6, 90, siphonCast),
    S("siphonArrow", DIRS, 8, 90, siphonArrow),
    S("doomSigil", 1, DOOM.frames, sheetSize(DOOM.radiusPx, 10), doomSigil),
    S("doomMark", 1, DOOM.frames, sheetSize(DOOM.radiusPx, 60), doomMark),
    S("shiftCone", DIRS, 8, sheetSize(SHIFT.radiusPx, 24), shiftCone),
    S("artFlash", DIRS, 7, 110, artFlash),
    S("artSweep", DIRS, 8, sheetSize(ART.radiusPx, 16), artSweep),
    S("artThrust", DIRS, 7, 100, artThrust),
    S("artBeam", 1, 7, 48, artBeam),
    S("artTip", DIRS, 7, 64, artTip),
    S("artBolt", DIRS, 6, 72, artBolt),
    S("stakeDrive", 1, 8, 110, stakeDrive),
    S("stakeStand", 1, STAKE_FRAMES, 80, stakeStand),
    S("stakeGlow", 1, STAKE_FRAMES, 40, stakeGlow),
    S("stakeSpark", 1, 6, 64, stakeSpark),
    S("stakeLine", 1, 6, 40, stakeLine),
    S("mireSplash", 1, MIRE.frames, sheetSize(MIRE.radiusPx, 40), mireSplash),
    S("mireSpread", 1, MIRE.frames, sheetSize(MIRE.radiusPx, 20), mireSpread),
    S("mireBubble", 1, MIRE_PLACED_FRAMES, sheetSize(MIRE.radiusPx, 12), mireBubble),
    S("mireGrip", 1, 8, 64, mireGrip),
  ],
};

