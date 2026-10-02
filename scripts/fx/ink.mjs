// 墨の筆致の仕上げ（docs/ideas/fx-sprites.md 3.5）。描き終えた 1 フレームの段の格子を、筆で書いた線に見せる
//
// 色（配色の段）はそのまま使い、質だけを墨にする（docs/ideas/previews/ink-brush-a の案 A「色は今のまま・墨の質」）。
// 予告の予約色（濃墨・朱・薄墨・胡粉。src/data/signs.ts）は使わない。プレイヤーの攻撃が敵の予告に見えないように、
// 黒い一筆ではなく「属性の色の墨」で書く。
//
//   1. 墨の縁: 太い線の外周を配色の最暗の段にする（筆の輪郭の滲み）
//   2. 掠れ: 太い線の内側に、縁と平行な毛筋の隙間を開ける（乾いた筆）。縁からの距離を「線を横切る座標」に使うので、
//      曲がった三日月でも筋が線に沿う
//   3. 毛羽: 縁を座標ハッシュで齧り、外へ短い毛を出す
//   4. 飛沫: 太い線の周りに暗い墨の粒を散らす
//
// 細い線・小さな粒・光点（太さが THICK 未満の所）には触らない。読みやすさと火花の明るさを残す。
// ばらつきは座標ハッシュだけ（決定的）。掠れの筋はシートと方向で決め、フレームでは変えない（筋が毎コマちらつかない）

import { hash2, valueNoise } from "./raster.mjs";

/** 縁からの距離の上限（これより奥は同じ扱い） */
const DIST_CAP = 12;
/** この太さ（縁からの距離）以上の所がある線だけを墨にする */
const THICK = 3;
/** 太い所からこの距離までを「太い線の一部」とみなす（縁・毛羽・飛沫の届く範囲） */
const THICK_REACH = 3;
/** 毛筋の間隔（線を横切る向きのドット）・そのうち隙間にする幅の割合・毛筋が隙間になる割合 */
const STREAK_PITCH = 2.6;
const STREAK_LINE = 0.42;
const STREAK_GAP = 0.5;
/** 掠れの筋をうねらせる雑音の格子の大きさと強さ */
const STREAK_WARP_CELL = 14;
const STREAK_WARP = 2.2;
/** 掠れの毛筋を開ける線の太さ（縁からの距離がこれ以上の所を持つ線） */
const STREAK_THICK = 5;
/** 掠れの隙間を線に沿って途切れさせる区切りの長さと、区切りが隙間を持つ割合（毛筋が線の全長で通らないように） */
const BREAK_LEN = 11;
const BREAK_ON = 0.62;
/** 芯（段 7）は掠れを減らす（光の芯が千切れすぎない） */
const CORE_LEVEL = 7;
const CORE_GAP_MUL = 0.45;
/** 縁を齧る割合・外へ毛を出す割合 */
const NIBBLE = 0.22;
const HAIR = 0.16;
/** 飛沫: 線からの距離の範囲と、1 ドットあたりの出る率 */
const SPLASH_MIN = 3;
const SPLASH_MAX = 9;
const SPLASH_RATE = 0.012;
/** 掠れの筋のうち、抜かずに暗くする割合と暗くする段数（墨の濃淡の毛筋） */
const DARK_STRAND = 0.35;
const DARK_STEP = 2;
/** 線の向きを均す窓の半径（構造テンソル） */
const ORIENT_RADIUS = 3;
/** 墨の縁と毛羽・飛沫の段（配色の暗部） */
const RIM_LEVEL = 1;
const HAIR_LEVEL = 2;

/**
 * 8 近傍のチャムファー距離（縁 = 1。透明は 0）。inside が真のドットの、透明までの距離を cap で頭打ちにして返す
 */
function distanceField(w, h, inside, cap, edge = 0) {
  const d = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) d[i] = inside(i) ? cap : 0;
  const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? edge : (d[y * w + x] ?? 0));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!d[i]) continue;
      d[i] = Math.min(d[i] ?? cap, at(x - 1, y) + 1, at(x, y - 1) + 1, at(x - 1, y - 1) + 1, at(x + 1, y - 1) + 1);
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (!d[i]) continue;
      d[i] = Math.min(d[i] ?? cap, at(x + 1, y) + 1, at(x, y + 1) + 1, at(x + 1, y + 1) + 1, at(x - 1, y + 1) + 1);
    }
  }
  return d;
}

/**
 * ドットごとの線の法線（単位ベクトル。[nx, ny] の並び）。縁からの距離の勾配の構造テンソルを窓で均して向きを出す
 * （勾配の符号は線の両側で逆になるので、倍角で足し合わせる）
 */
function strokeNormals(w, h, dist) {
  const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : (dist[y * w + x] ?? 0));
  const W = w + 1;
  // 倍角の成分 (gx² − gy², 2 gx gy) の積分画像
  const ic = new Float64Array(W * (h + 1));
  const is = new Float64Array(W * (h + 1));
  for (let y = 0; y < h; y++) {
    let rc = 0;
    let rs = 0;
    for (let x = 0; x < w; x++) {
      const gx = at(x + 1, y) - at(x - 1, y);
      const gy = at(x, y + 1) - at(x, y - 1);
      rc += gx * gx - gy * gy;
      rs += 2 * gx * gy;
      const o = (y + 1) * W + x + 1;
      ic[o] = (ic[o - W] ?? 0) + rc;
      is[o] = (is[o - W] ?? 0) + rs;
    }
  }
  const box = (img, x0, y0, x1, y1) => (img[y1 * W + x1] ?? 0) - (img[y0 * W + x1] ?? 0) - (img[y1 * W + x0] ?? 0) + (img[y0 * W + x0] ?? 0);
  const out = new Float32Array(w * h * 2);
  const r = ORIENT_RADIUS;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!dist[y * w + x]) continue;
      const x0 = Math.max(0, x - r);
      const y0 = Math.max(0, y - r);
      const x1 = Math.min(w, x + r + 1);
      const y1 = Math.min(h, y + r + 1);
      const a = Math.atan2(box(is, x0, y0, x1, y1), box(ic, x0, y0, x1, y1)) / 2;
      out[(y * w + x) * 2] = Math.cos(a);
      out[(y * w + x) * 2 + 1] = Math.sin(a);
    }
  }
  return out;
}

/** 太い所（縁からの距離 thick 以上）からの距離（太い所 = 1、reachMax より遠い所 = 0） */
function thickReach(w, h, dist, thick, reachMax) {
  // 太い所の外側への距離 = 「太い所でない」ドットの、太い所までの距離
  const r = distanceField(w, h, (i) => (dist[i] ?? 0) < thick, reachMax + 2);
  const out = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const v = r[i] ?? 0;
    out[i] = v === 0 ? 1 : v <= reachMax ? v + 1 : 0;
  }
  return out;
}

/** 外向きの向き（距離が減る向き）。毛を伸ばす向きに使う */
function outward(frame, dist, x, y) {
  const { w, h } = frame;
  const at = (ax, ay) => (ax < 0 || ay < 0 || ax >= w || ay >= h ? 0 : (dist[ay * w + ax] ?? 0));
  const gx = at(x - 1, y) - at(x + 1, y);
  const gy = at(x, y - 1) - at(x, y + 1);
  return { gx: Math.sign(gx), gy: Math.sign(gy) };
}

/**
 * 1 フレームを墨の筆致に仕上げる（作業面を書き換える）。
 * seed はシートと方向で決める（フレームで変えると掠れの筋がちらつく）。frameSeed はフレームごとの粒（飛沫・毛羽）
 */
export function inkify(frame, seed, frameSeed = 0) {
  const { w, h, grid } = frame;
  const src = grid.slice();
  const dist = distanceField(w, h, (i) => (src[i] ?? 0) > 0, DIST_CAP);
  const reach = thickReach(w, h, dist, THICK, THICK_REACH);
  // 掠れは十分に太い線だけ（小さな石・刃片に穴が開くと顔のような模様になる）
  const broad = thickReach(w, h, dist, STREAK_THICK, STREAK_THICK);
  const normal = strokeNormals(w, h, dist);
  // 1. 墨の縁と 2. 掠れ
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const level = src[i] ?? 0;
      const d = dist[i] ?? 0;
      if (!level || !reach[i]) continue;
      if (d === 1) {
        // 3. 毛羽（齧り）: 縁のドットを抜く。抜かなければ墨の縁
        grid[i] = hash2(x, y, seed ^ 0x6b1d ^ frameSeed) < NIBBLE ? 0 : Math.min(level, RIM_LEVEL);
        continue;
      }
      if (d < THICK || !broad[i]) continue;
      // 線を横切る座標: 原点から見た位置を線の法線へ射影する。原点まわりの弧でも直線でも、線に沿って一定になる
      const nx = normal[i * 2] ?? 0;
      const ny = normal[i * 2 + 1] ?? 0;
      const across = (x - frame.cx) * nx + (y - frame.cy) * ny;
      // 線に沿う座標（原点まわりの弧では弧長に近い）。毛筋をこの長さの区切りで途切れさせる
      const along = -(x - frame.cx) * ny + (y - frame.cy) * nx;
      const warp = (valueNoise(x, y, STREAK_WARP_CELL, seed) - 0.5) * 2 * STREAK_WARP;
      const s = (across + warp) / STREAK_PITCH;
      const strand = Math.floor(s);
      // 毛筋 1 本につき、幅 STREAK_LINE の細い隙間だけを開ける（隙間が隣り合って斑の穴にならない）
      if (s - strand >= STREAK_LINE) continue;
      const seg = Math.floor((along + hash2(strand, 0x5d, seed) * BREAK_LEN) / BREAK_LEN);
      if (hash2(strand, seg, seed ^ 0x3f1) > BREAK_ON) continue;
      const pick = hash2(strand, 0x2c9, seed);
      const gapRate = STREAK_GAP * (level >= CORE_LEVEL ? CORE_GAP_MUL : 1);
      if (pick < gapRate) grid[i] = 0;
      else if (pick < gapRate + DARK_STRAND) grid[i] = Math.max(RIM_LEVEL, level - DARK_STEP);
    }
  }
  // 3. 毛羽（外へ伸びる短い毛）と 4. 飛沫
  // 作業面の外は線から遠い所とみなす（端に飛沫や毛が並ばない）
  const outside = distanceField(w, h, (i) => !(src[i] ?? 0), SPLASH_MAX + 1, SPLASH_MAX + 1);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if ((src[i] ?? 0) || grid[i]) continue;
      const od = outside[i] ?? 0;
      if (od === 1 && reachNear(reach, w, h, x, y) && hash2(x, y, seed ^ 0x51a7 ^ frameSeed) < HAIR) {
        grid[i] = HAIR_LEVEL;
        const o = outward(frame, dist, x, y);
        if (hash2(x, y, seed ^ 0x77 ^ frameSeed) < 0.5) frame.set(x + o.gx, y + o.gy, HAIR_LEVEL);
        continue;
      }
      if (od < SPLASH_MIN || od > SPLASH_MAX) continue;
      if (!splashOwner(src, dist, w, h, x, y, od)) continue;
      // 線から離れるほど疎に
      const rate = SPLASH_RATE * (1 - (od - SPLASH_MIN) / (SPLASH_MAX - SPLASH_MIN + 1));
      if (hash2(x, y, seed ^ 0x9e3 ^ frameSeed) >= rate) continue;
      grid[i] = HAIR_LEVEL;
      if (hash2(x, y, seed ^ 0x1f ^ frameSeed) < 0.35) frame.set(x + 1, y, HAIR_LEVEL);
    }
  }
}

/** 隣（8 近傍）に太い線のドットがあるか */
function reachNear(reach, w, h, x, y) {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const ax = x + dx;
      const ay = y + dy;
      if (ax < 0 || ay < 0 || ax >= w || ay >= h) continue;
      if (reach[ay * w + ax]) return true;
    }
  }
  return false;
}

/** 飛沫を出してよいか: 線までの距離 od の円の上（粗く 8 方向）に、太い線（縁からの距離 THICK 以上）がある */
function splashOwner(src, dist, w, h, x, y, od) {
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    for (const r of [od, od + 1, od + 2]) {
      const ax = Math.round(x + Math.cos(a) * r);
      const ay = Math.round(y + Math.sin(a) * r);
      if (ax < 0 || ay < 0 || ax >= w || ay >= h) continue;
      const i = ay * w + ax;
      if ((src[i] ?? 0) && (dist[i] ?? 0) >= THICK) return true;
    }
  }
  return false;
}
