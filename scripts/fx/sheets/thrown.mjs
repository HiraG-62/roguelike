// 投擲（moveset "thrown"）のエフェクト。docs/ideas/fx-sprites.md 9 章。手本は sword.mjs、弾の作法は sidearm.mjs
// 単位は絵のドット（論理 0.5px）。当たり判定・弾の数値（weapons/WEAPON/movesets/thrown.json・bullets.json）× 2 が目安
//
// 手で投げる・吹く武器。銃のような火薬の閃光は出さず、「手から放つ風切り」（手首の返しの細い弧と、前へ抜ける空気の裂け目）を
// 撃つ瞬間の絵にする。弾 4 種は形そのもので描き分ける:
//   投げ短剣（throwingKnives）: 本体は描画側がナイフの絵で描くので、飛ぶ絵はその下の風切りの筋と切っ先の光だけ。着弾は壁に突き立って震える
//   吹き矢（blowgun）: 細い針と羽根。後ろへ揺れる毒の筋と滴。吹いた息の輪が口元に出る
//   跳ね銃（ricochetGun）: 硬い玉と短い曳光。着弾は折れ曲がって跳ね返る火花
//   導きの珠（seekerOrb）: 渦を抱いた毒の珠。揺らめく尾を引く。着弾は弾けて泡が散る
// 近接は「投げた武器を通す・引き戻す」突きと蹴り・掴み投げ。刃の軌跡は細く（投げ物は軽い）、白は刃の縁と光点だけ
import { easeSwing, lens, ring, shards, sparkle, streakLine } from "../shapes.mjs";
import { clamp01, dot, hash1, paint, valueNoise } from "../raster.mjs";
import { DEG, DIRS } from "../motifs.mjs";

const TAU = Math.PI * 2;
/** 細長い弾（針・曳光・尾）は 24 方向だと角のずれが目立つので 32 方向で描く（fx-brief2） */
const SHOT_DIRS = 32;
/** 投げる手の位置（自分の中心から前へ）。キャラ 48 ドットの縁の少し外 */
const HAND = 20;

// -----------------------------------------------------------------------------
// 共通の部品
// -----------------------------------------------------------------------------

/** 崩れの判定（shapes.mjs の survives と同じ考え。export されていないのでここに持つ） */
function survives(x, y, erosion, nearCore, seed) {
  if (erosion <= 0) return true;
  const n = valueNoise(x, y, 3.5, seed) * 0.6 + valueNoise(x, y, 1.4, seed + 7) * 0.2;
  return n + nearCore * 0.45 - erosion * 1.15 > 0;
}

/** 振りの進み p（active 中）と崩れ k（振り終わり 0..1） */
function phase(f, A, N) {
  return { p: f < A ? easeSwing((f + 1) / A) : 1, k: f < A ? 0 : (f - A + 1) / (N - A + 1) };
}

/** 先へ細る 1 本の針: (x, y) から角 a へ長さ len、根元の半幅 w。芯が明るく先ほど暗い */
function spike(frame, o) {
  const { x = 0, y = 0, a, len, w } = o;
  const bright = o.bright ?? 1;
  const erosion = o.erosion ?? 0;
  const seed = o.seed ?? 11;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const pad = w + 2;
  const ex = x + c * len;
  const ey = y + s * len;
  paint(
    frame,
    (px, py) => {
      const dx = px - x;
      const dy = py - y;
      const along = dx * c + dy * s;
      if (along < -w * 0.6 || along > len) return -1;
      const u = Math.max(0, along) / len;
      const half = w * (1 - u) ** 0.9 + 0.35;
      const across = Math.abs(-dx * s + dy * c);
      if (across > half) return -1;
      const q = across / half;
      if (!survives(px, py, erosion, 1 - q, seed)) return -1;
      return clamp01((1 - q) ** 0.8 * (1.05 - 0.6 * u) * bright);
    },
    { bounds: { x0: Math.min(x, ex) - pad, y0: Math.min(y, ey) - pad, x1: Math.max(x, ex) + pad, y1: Math.max(y, ey) + pad } },
  );
}

/** 円い芯（半径 r）。中心ほど明るい */
function flashCore(frame, x, y, r, bright = 1) {
  paint(
    frame,
    (px, py) => {
      const d = Math.hypot(px - x, py - y);
      if (d > r) return -1;
      return clamp01((1 - d / r) ** 0.6 * bright);
    },
    { bounds: { x0: x - r - 1, y0: y - r - 1, x1: x + r + 1, y1: y + r + 1 } },
  );
}

/** 前へ押し出す圧の弧（潰れた楕円の前側 ±spread だけ）。全周の輪にすると的に見えるので前だけ残す */
function frontArc(frame, o) {
  const { ox = 0, oy = 0, radius, width } = o;
  const squash = o.squash ?? 0.5;
  const spread = o.spread ?? 70 * DEG;
  const erosion = o.erosion ?? 0;
  const bright = o.bright ?? 0.6;
  const seed = o.seed ?? 21;
  const pad = radius + width + 2;
  paint(
    frame,
    (x, y) => {
      const dx = (x - ox) / squash;
      const dy = y - oy;
      const a = Math.atan2(dy, dx);
      if (Math.abs(a) > spread) return -1;
      const d = Math.abs(Math.hypot(dx, dy) - radius);
      if (d > width / 2) return -1;
      const q = d / (width / 2);
      const edge = Math.abs(a) / spread;
      if (!survives(x, y, erosion + edge * 0.3, 1 - q, seed)) return -1;
      return clamp01(bright * (1 - 0.5 * q) * (1 - 0.45 * edge));
    },
    { bounds: { x0: ox - 2, y0: oy - pad, x1: ox + pad * squash + 2, y1: oy + pad } },
  );
}

/**
 * 弧の帯（中心 (cx, cy)、半径 R の外縁から内へ太さ T）。head（角）が先頭で、そこから span だけ反時計回り側へ尾を引く。
 * 尾ほど細く暗い。edge = true なら先頭側の外縁 1 ドットだけ白（刃の縁）。blunt なら白くしない（足・腕の振り）
 */
function sweepBand(frame, o) {
  const { cx = 0, cy = 0, R, T, head, span } = o;
  const erosion = o.erosion ?? 0;
  const bright = o.bright ?? 0.85;
  const seed = o.seed ?? 31;
  const pad = R + 2;
  paint(
    frame,
    (x, y) => {
      const dx = x - cx;
      const dy = y - cy;
      const r = Math.hypot(dx, dy);
      if (r > R + 1 || r < R - T - 1) return -1;
      let s = (head - Math.atan2(dy, dx)) % TAU;
      if (s < 0) s += TAU;
      if (s > span) return -1;
      const u = s / span;
      const w = T * (1 - u) ** 0.6 + 0.6;
      const q = (R - r) / w;
      if (q < 0 || q > 1) return -1;
      if (!survives(x, y, erosion + u * 0.25, 1 - u, seed)) return -1;
      if (o.edge && R - r < 1.2 && u < 0.35 && erosion < 0.4) return 1;
      return clamp01((1 - q) ** 0.8 * (bright - 0.55 * u) * (1 - erosion * 0.35));
    },
    { bounds: o.bounds ?? { x0: cx - pad, y0: cy - pad, x1: cx + pad, y1: cy + pad } },
  );
}

/**
 * 投げ短剣の刃 1 本: 中心 (x, y)、角 a、全長 len、刃の半幅 w。前 6 割が刃（切っ先へ細る菱形）、後ろ 4 割が細い柄と柄頭。
 * 白は刃の片側の縁（+y 側）の細い線だけ。柄は段 3〜4 の暗い棒
 */
function knife(frame, o) {
  const { x = 0, y = 0, a, len, w } = o;
  const bright = o.bright ?? 1;
  const erosion = o.erosion ?? 0;
  const seed = o.seed ?? 41;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const blade = len * 0.6;
  const grip = len * 0.4;
  const pad = len / 2 + w + 2;
  paint(
    frame,
    (px, py) => {
      const dx = px - x;
      const dy = py - y;
      // 刃と柄の境（鍔）を原点に取り直す: 刃は +along、柄は −along
      const along = dx * c + dy * s + (grip - blade) / 2;
      const across = -dx * s + dy * c;
      if (along >= 0) {
        if (along > blade) return -1;
        const u = along / blade;
        const half = w * (1 - u) ** 0.85 + 0.3;
        if (Math.abs(across) > half) return -1;
        const q = Math.abs(across) / half;
        if (!survives(px, py, erosion, 1 - q, seed)) return -1;
        // 刃の縁（+y の外側 1 ドット）だけ白く光らせる。反対側は段 4 の鋼
        if (across > half - 1.1 && u < 0.85 && erosion < 0.35) return clamp01(0.95 * bright);
        return clamp01((0.72 - 0.25 * q - 0.15 * u) * bright);
      }
      const back = -along;
      if (back > grip) return -1;
      // 柄頭の輪（柄の端の小さな丸）
      if (Math.hypot(back - grip + 1, across) < 1.6) return clamp01(0.5 * bright);
      if (Math.abs(across) > w * 0.45 + 0.2) return -1;
      if (!survives(px, py, erosion, 0.5, seed)) return -1;
      // 鍔の 1 ドットだけ明るい
      return clamp01((back < 1.2 ? 0.6 : 0.38) * bright);
    },
    { bounds: { x0: x - pad, y0: y - pad, x1: x + pad, y1: y + pad } },
  );
}

/** 細い 1 本の弧線（中心 (cx, cy)、半径 r、角 a0 → a1）。a1 側が明るい。回転の残像・手首の返し */
function thinArc(frame, o) {
  const { cx = 0, cy = 0, r, a0, a1 } = o;
  const width = o.width ?? 1.1;
  const hi = o.bright ?? 0.6;
  const lo = Math.min(a0, a1);
  const span = Math.abs(a1 - a0);
  const pad = r + width + 2;
  paint(
    frame,
    (x, y) => {
      const dx = x - cx;
      const dy = y - cy;
      if (Math.abs(Math.hypot(dx, dy) - r) > width / 2) return -1;
      let s = (Math.atan2(dy, dx) - lo) % TAU;
      if (s < 0) s += TAU;
      if (s > span) return -1;
      const t = a1 >= a0 ? s / span : 1 - s / span;
      return hi * (0.25 + 0.75 * t);
    },
    { bounds: { x0: cx - pad, y0: cy - pad, x1: cx + pad, y1: cy + pad }, dither: 0, samples: 3 },
  );
}

/** 小さな泡（中空の輪、半径 r）。毒の泡・弾けた滴 */
function bubble(frame, x, y, r, bright) {
  paint(
    frame,
    (px, py) => {
      const d = Math.hypot(px - x, py - y);
      if (Math.abs(d - r) > 0.7) return -1;
      // 左上だけ少し明るい（泡の照り）
      const lit = (px - x) + (py - y) < 0 ? 1.15 : 0.85;
      return clamp01(bright * lit);
    },
    { bounds: { x0: x - r - 2, y0: y - r - 2, x1: x + r + 2, y1: y + r + 2 }, dither: 0, samples: 3 },
  );
}

// -----------------------------------------------------------------------------
// 近接の振り
// -----------------------------------------------------------------------------

/**
 * ダッシュ攻撃（thrust reach 40・踏み込み 16、原点 = 自分）: 滑り込みながら手の刃で低く突く。
 * 細いレンズの刺突 1 本と、切っ先へ向かって窄まる風の筋（外側だけ）、踏み切りの足元から後ろへ散る砂粒
 */
function dashStab(frame, f) {
  const A = 3;
  const N = 8;
  const { p, k } = phase(f, A, N);
  const tip = 14 + 66 * p + k * 6;
  const back = -8 + k * (tip + 8) * 0.85;
  const T = 9 * (1 - k * 0.5);
  lens(frame, { ax: back, ay: 0, bx: tip, by: 0, T, bias: 0, erosion: k * 0.85, seed: 3011, bright: 1 - k * 0.2 });
  if (k < 0.6) streakLine(frame, { ax: back + (tip - back) * 0.4, ay: 0, bx: tip - 2, by: 0, width: 1.2, bright: 1 });
  // 窄まる風の筋: 後ろほど外に開き、切っ先へ向かって刃に寄る（刃の外側に沿わせる）
  if (k < 0.85) {
    for (let i = 0; i < 4; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const lane = Math.floor(i / 2);
      const bx = tip - 12 - hash1(i, 3012) * 8 - k * 14;
      const ax = bx - 22 - hash1(i, 3013) * 12;
      const by = side * (T / 2 + 2 + lane * 3);
      const ay = side * (T / 2 + 6 + lane * 5 + k * 3);
      streakLine(frame, { ax, ay, bx, by, bright: 0.5 * (1 - k) });
    }
  }
  if (f === A - 1) sparkle(frame, tip - 1, 0, 3);
  if (f >= A - 1) {
    shards(frame, f - (A - 1), 6, 3014, (i, rnd) => {
      const a = (rnd(1) - 0.5) * 1.4;
      const sp = 3 + rnd(2) * 3;
      return { x: tip - 3, y: (rnd(3) - 0.5) * 5, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(4) * 2), size: rnd(5) > 0.5 ? 2 : 1 };
    });
  }
  // 踏み切りの砂粒（後ろの足元から −x へ）
  shards(frame, f, 7, 3015, (i, rnd) => {
    const a = Math.PI + (rnd(1) - 0.5) * 1.3;
    const sp = 2 + rnd(2) * 2.5;
    return { x: -10, y: (rnd(3) - 0.5) * 10, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(4) * 3), size: 1, bright: 0.5 };
  });
}

/**
 * 投げ抜け（thrust reach 36・踏み込み 16、原点 = 自分）: 手から放った短剣そのものが前へ飛び、相手を貫いて抜けていく。
 * 刃の後ろは細い空気の裂け目（段 4 まで。白くしない）。貫いた所に進む向きへ潰れた輪が 1 枚立つ
 */
function throughThrow(frame, f) {
  const A = 3;
  const N = 8;
  const { p, k } = phase(f, A, N);
  const reach = 72;
  const pos = f < A ? HAND - 4 + (reach - HAND + 4) * p : reach + (f - A + 1) * 6;
  const tailFrom = f < A ? HAND - 6 : HAND - 6 + (pos - HAND) * k;
  // 空気の裂け目: 細いレンズ（中央が太い）。刃が先へ行くほど根元から閉じる
  if (pos - 8 - tailFrom > 6) lens(frame, { ax: tailFrom, ay: 0, bx: pos - 7, by: 0, T: 3.4 * (1 - k * 0.4), bias: 0, erosion: k * 0.7, seed: 3111, bright: 0.58 });
  knife(frame, { x: pos, a: 0, len: 16, w: 3.2, bright: 1 - k * 0.45, erosion: Math.max(0, k - 0.35) * 1.2, seed: 3112 });
  if (f === A - 1) sparkle(frame, pos + 6, 0, 3);
  // 貫いた輪: 当たりの中ほど（reach の 8 割）に立ち、進む向きへ流れる
  if (f >= A - 1) {
    const age = f - (A - 1);
    const ox = reach * 0.8 + age * 3;
    ring(frame, { ox, radius: 5 + age * 3, width: 2, squash: 0.35, erosion: Math.min(0.92, age * 0.2), bright: 0.78 - age * 0.08, seed: 3113 });
    shards(frame, age, 7, 3114, (i, rnd) => {
      const a = (rnd(1) - 0.5) * 1.8;
      const sp = 2.5 + rnd(2) * 3;
      return { x: ox, y: (rnd(3) - 0.5) * 6, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(4) * 2), size: rnd(5) > 0.4 ? 2 : 1 };
    });
  }
  // 手を離した瞬間の手首の返し（手元の小さな弧）
  if (f <= 1) thinArc(frame, { cx: HAND - 12, cy: 0, r: 10, a0: -70 * DEG, a1: 5 * DEG, bright: 0.7 - f * 0.25 });
}

/**
 * 返し斬り（thrust reach 40・踏み込み 16、原点 = 自分）: 紐付きの刃を前へ放ち、先で手首を返して引き戻す。
 * 張った紐（段 3〜4 の細い線）の先で、刃が前へふくらむ三日月を 1 本描き、紐ごと手元へ巻き戻る
 */
function drawCut(frame, f) {
  const A = 4;
  const N = 9;
  const { k } = phase(f, A, N);
  const out = f < 2 ? easeSwing((f + 1) / 2) : 1;
  const reach = 80;
  const tip = HAND - 4 + (reach - HAND + 4) * out;
  // 紐: 振り終わりは先から手元へ巻き取られる
  const front = tip - 19 - k * (tip - HAND);
  if (front > HAND) streakLine(frame, { ax: HAND - 6, ay: 0, bx: front, by: 0, width: 1, bright: 0.42 * (1 - k * 0.5) });
  if (f < 2) {
    // 飛んでいく刃（切っ先が前）
    knife(frame, { x: tip - 6, a: 0, len: 14, w: 3, seed: 3211 });
    if (f === 1) sparkle(frame, tip, 0, 2);
    return drawCutShards(frame, f);
  }
  // 手首を返す三日月: 紐の先（tip − 14）を中心に、上（−y）から下（+y）へ時計回りに回り、外縁が前へふくらむ
  const cx = tip - 19;
  const R = 21;
  const swing = Math.min(1, (f - 1) / (A - 1));
  const head = -80 * DEG + 170 * DEG * easeSwing(swing) + k * 20 * DEG;
  const span = (f < A ? 60 + 90 * swing : 150 - 100 * k) * DEG;
  sweepBand(frame, { cx, R, T: 9 * (1 - k * 0.5), head, span, edge: true, erosion: k * 0.95, seed: 3212, bright: 0.9 });
  if (f === A - 1) sparkle(frame, cx + Math.cos(head) * (R - 1), Math.sin(head) * (R - 1), 3);
  // 巻き戻る刃の閃き（紐の先について手元へ戻る）
  if (k > 0 && k < 0.9) sparkle(frame, Math.max(HAND, front), 0, k < 0.5 ? 2 : 1);
  drawCutShards(frame, f);
}

/** 返し斬りの刃片（三日月の先から接線へ） */
function drawCutShards(frame, f) {
  if (f < 3) return;
  shards(frame, f - 3, 6, 3213, (i, rnd) => {
    const a = 60 * DEG + (rnd(1) - 0.5) * 1.4;
    const sp = 2.5 + rnd(2) * 2.5;
    return { x: 66 + rnd(3) * 6, y: 6 + (rnd(4) - 0.5) * 8, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(5) * 2), size: rnd(6) > 0.5 ? 2 : 1 };
  });
}

/**
 * 蹴り（box reach 12 / size 20、原点 = 当たりの中心 = 自分から 24 ドット先）: 回し蹴り。
 * 自分を中心に上から前へ回る太く鈍い足の軌跡（白い縁なし・先頭が丸い踵）が当たりで止まり、前へ潰れた圧の弧と砂粒が弾ける
 */
function kick(frame, f) {
  const A = 3;
  const N = 8;
  const { p, k } = phase(f, A, N);
  const cx = -24;
  const R = 32;
  const head = -85 * DEG + 95 * DEG * p + k * 12 * DEG;
  const span = (f < A ? 50 + 45 * p : 95 - 70 * k) * DEG;
  if (k < 0.85) {
    sweepBand(frame, { cx, R, T: 14 * (1 - k * 0.5), head, span, erosion: k * 1.05, seed: 3311, bright: 0.74, bounds: { x0: -30, y0: -36, x1: 12, y1: 16 } });
    // 踵: 先頭の丸い塊（段 5〜6）。足の重さを先に寄せる
    if (k < 0.5) {
      const hx = cx + Math.cos(head) * (R - 6);
      const hy = Math.sin(head) * (R - 6);
      flashCore(frame, hx, hy, 6.5 * (1 - k), 0.78);
    }
  }
  if (f >= A - 1) {
    const age = f - (A - 1);
    frontArc(frame, { ox: 4 + age * 2.5, radius: 6 + age * 4, width: 2.6 - age * 0.3, squash: 0.55, spread: 80 * DEG, erosion: Math.min(0.9, age * 0.2), bright: 0.8 - age * 0.09, seed: 3312 });
    if (age === 0) sparkle(frame, 4, 0, 3);
    shards(frame, age, 9, 3313, (i, rnd) => {
      const a = 0.35 + (rnd(1) - 0.5) * 1.8;
      const sp = 3 + rnd(2) * 3;
      return { x: 3, y: (rnd(3) - 0.5) * 8, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(4) * 2), size: rnd(5) > 0.45 ? 2 : 1, drag: 0.8 };
    });
  }
}

/**
 * 三本投げ（circle size 20、原点 = 自分）: −10° → 0° → +10° と 1 フレームずつ 3 本を放つ。
 * 投げるたびに手首の返しの細い弧と、前へ抜ける空気の裂け目（段 5 まで）。刃そのものは弾の絵が出るので描かない
 */
function tripleThrow(frame, f) {
  const N = 8;
  for (let j = 0; j < 3; j++) {
    const a = (j - 1) * 10 * DEG;
    const age = f - j;
    if (age < 0 || age > 3) continue;
    const c = Math.cos(a);
    const s = Math.sin(a);
    // 手首の返し: 手元の後ろから投げる向きへ時計回りに閉じる短い弧
    if (age <= 1) thinArc(frame, { cx: c * (HAND - 10), cy: s * (HAND - 10), r: 9, a0: a - 75 * DEG, a1: a + 5 * DEG, bright: 0.72 - age * 0.25 });
    // 空気の裂け目: 投げた向きへ流れて細る
    const x0 = HAND + age * 7;
    const len = 16 - age * 3;
    lens(frame, { ax: c * x0, ay: s * x0, bx: c * (x0 + len), by: s * (x0 + len), T: 3.6 - age * 0.7, bias: 0, erosion: age * 0.25, seed: 3411 + j, bright: 0.82 - age * 0.12 });
    if (age === 0) sparkle(frame, c * (HAND + 2), s * (HAND + 2), 2);
  }
  if (f >= N - 3) {
    for (let i = 0; i < 3; i++) dot(frame, HAND + 10 + hash1(i, 3412) * 10, (hash1(i, 3413) - 0.5) * 14, 3);
  }
}

/**
 * 回し投げ（circle size 20、原点 = 自分）: その場で 1 回転しながら前の扇（±30°）へ 6 本をばらまく。
 * 自分の周りを回る細い帯（先頭の外縁だけ白）と、放った向きへ外へ抜ける短い裂け目。扇は 2 本ずつ 3 フレームに分ける
 */
function spinThrow(frame, f) {
  const A = 4;
  const N = 8;
  const { p, k } = phase(f, A, N);
  const R = 26;
  const head = -150 * DEG + TAU * p + k * 30 * DEG;
  const span = (f < A ? 90 + 110 * p : 200 - 160 * k) * DEG;
  if (k < 0.95) sweepBand(frame, { R, T: 5 * (1 - k * 0.5), head, span, edge: true, erosion: k * 0.95, seed: 3511, bright: 0.85 });
  // 6 本の放つ向き: −30°, +30°, −18°, +18°, −6°, +6°（外から内へ。回転の途中で前を通るたびに 2 本）
  const angles = [-30, 30, -18, 18, -6, 6];
  for (let i = 0; i < angles.length; i++) {
    const born = 1 + Math.floor(i / 2);
    const age = f - born;
    if (age < 0 || age > 2) continue;
    const a = (angles[i] ?? 0) * DEG;
    const r0 = R + 1 + age * 6;
    const r1 = r0 + 11 - age * 2;
    lens(frame, { ax: Math.cos(a) * r0, ay: Math.sin(a) * r0, bx: Math.cos(a) * r1, by: Math.sin(a) * r1, T: 3 - age * 0.6, bias: 0, erosion: age * 0.3, seed: 3512 + i, bright: 0.8 - age * 0.15 });
    if (age === 0) sparkle(frame, Math.cos(a) * (R + 2), Math.sin(a) * (R + 2), 1);
  }
  if (f >= A) {
    shards(frame, f - A, 8, 3513, (i, rnd) => {
      const a = rnd(1) * TAU;
      const sp = 2 + rnd(2) * 2;
      return { x: Math.cos(a) * R, y: Math.sin(a) * R, vx: -Math.sin(a) * sp, vy: Math.cos(a) * sp, life: 2 + Math.floor(rnd(3) * 2), size: 1 };
    });
  }
}

/**
 * 掴み投げ（box reach 10 / size 20、原点 = 当たりの中心 = 自分から 20 ドット先）:
 * 上下から閉じる 2 つの鉤（掴む手）が当たりで噛み、掴んだ相手を前へ放る太い弧（上 −y へふくらむ放物線の見下ろし）。
 * 放った先で落ちた土煙の圧の弧が広がる
 */
function grabToss(frame, f) {
  const N = 9;
  // 掴む鉤: 0〜1 フレームで上下から閉じる
  if (f <= 2) {
    const close = f === 0 ? 0 : f === 1 ? 0.7 : 1;
    const r = 13 - 6 * close;
    for (const side of [-1, 1]) {
      const mid = side * 90 * DEG;
      thinArc(frame, { r, a0: mid - side * 55 * DEG, a1: mid + side * 40 * DEG, width: 2.2, bright: 0.85 - f * 0.1 });
    }
    if (f === 1) {
      flashCore(frame, 0, 0, 4, 1);
      sparkle(frame, 0, 0, 3);
    }
  }
  // 放る弧: 当たり（0, 0）から前（+44）へ、−y へふくらむ放物線。先頭に掴んだ相手の塊
  const L = 44;
  const H = 18;
  const t = f < 2 ? 0 : Math.min(1, easeSwing((f - 1) / 3));
  const k = f < 5 ? 0 : (f - 4) / (N - 4);
  if (f >= 2) {
    const tail = Math.max(0, t - 0.55) + k * 0.4;
    paint(
      frame,
      (x, y) => {
        const u = x / L;
        if (u < tail || u > t) return -1;
        const cy = -H * 4 * u * (1 - u);
        const v = t > 0 ? (u - tail) / Math.max(0.05, t - tail) : 0;
        const w = 1 + 4.2 * v ** 0.8;
        const d = Math.abs(y - cy);
        if (d > w) return -1;
        const q = d / w;
        if (!survives(x, y, k * 1.1, 1 - q, 3611)) return -1;
        return clamp01((1 - q) ** 0.8 * (0.42 + 0.4 * v) * (1 - k * 0.4));
      },
      { bounds: { x0: -2, y0: -H - 7, x1: L + 2, y1: 7 } },
    );
    if (k === 0 && t < 1) {
      const hx = L * t;
      flashCore(frame, hx, -H * 4 * t * (1 - t), 5, 0.8);
    }
  }
  // 落ちた所の土煙
  if (f >= 4) {
    const age = f - 4;
    frontArc(frame, { ox: L - 4 + age * 2, radius: 5 + age * 3.5, width: 2.4, squash: 0.6, spread: 85 * DEG, erosion: Math.min(0.9, age * 0.2), bright: 0.75 - age * 0.1, seed: 3612 });
    if (age === 0) sparkle(frame, L, 0, 3);
    shards(frame, age, 10, 3613, (i, rnd) => {
      const a = (rnd(1) - 0.5) * 3.2;
      const sp = 2 + rnd(2) * 3;
      return { x: L, y: (rnd(3) - 0.5) * 6, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(4) * 2), size: rnd(5) > 0.5 ? 2 : 1, drag: 0.8 };
    });
  }
}

/**
 * 命中（近接・投げ物の刃）: 原点 = 敵、+x = 刃の進む向き。細い刃が刺さって抜けた刺し傷。
 * 前へ長く後ろへ短い針 1 本と横の短い針、進む向きに潰れた小さな輪、前へ飛ぶ細かな破片。
 * heavy（呼び戻した刃・会心）は針が長く、斜め前へ 2 本の閃きが開き、輪が大きい
 */
function pierceHit(frame, f, heavy) {
  const s = heavy ? 1.5 : 1;
  if (f <= 1) {
    const g = f === 0 ? 0.85 : 1;
    spike(frame, { x: -6 * s, a: 0, len: 22 * s * g, w: 2.4 * s, bright: 1 });
    spike(frame, { x: -6 * s, a: Math.PI, len: 6 * s * g, w: 2 * s, bright: 0.8 });
    spike(frame, { x: -2, a: Math.PI / 2, len: 6 * s * g, w: 1.6 * s, bright: 0.75 });
    spike(frame, { x: -2, a: -Math.PI / 2, len: 6 * s * g, w: 1.6 * s, bright: 0.75 });
    if (heavy) {
      spike(frame, { x: 0, a: 35 * DEG, len: 14 * g, w: 1.8, bright: 0.9 });
      spike(frame, { x: 0, a: -35 * DEG, len: 14 * g, w: 1.8, bright: 0.9 });
    }
    flashCore(frame, -2, 0, 3 * s, 1);
    sparkle(frame, -2, 0, f === 0 ? (heavy ? 4 : 3) : 2);
  } else if (f === 2) {
    spike(frame, { x: 2, a: 0, len: 20 * s, w: 1.6 * s, bright: 0.7, erosion: 0.5, seed: 3711 });
  }
  if (f >= 1) {
    const age = f - 1;
    ring(frame, { radius: (heavy ? 8 : 5) + age * (heavy ? 5 : 3.5), width: heavy ? 2.6 : 1.8, squash: 0.55, erosion: Math.min(0.95, 0.2 + age * 0.3), bright: 0.72 - age * 0.12, seed: heavy ? 3712 : 3722 });
  }
  shards(frame, f - 1, heavy ? 14 : 8, heavy ? 3713 : 3723, (i, rnd) => {
    const a = (rnd(1) - 0.5) * (rnd(2) > 0.25 ? 1.2 : 3.4);
    const sp = (heavy ? 4 : 3) + rnd(3) * (heavy ? 3.5 : 2.5);
    return { x: 2, y: (rnd(4) - 0.5) * 3, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(5) * 2), size: rnd(6) > 0.3 ? 2 : 1, drag: 0.82 };
  });
}

// -----------------------------------------------------------------------------
// 弾: 投げ短剣（throwingKnives）。radius 2、速さ ≈ 186px/秒 → 尾 ≈ 15 ドット
// -----------------------------------------------------------------------------

/** 飛ぶ短剣の風切りの揺らぎの周期（フレーム数） */
const KNIFE_FLY_FRAMES = 6;
/** 描画側が弾の中心に重ねるナイフの絵の半分の長さの目安（ドット）。風切りはこれより後ろから引く */
const KNIFE_BODY_HALF = 8;

/**
 * 飛ぶ短剣: 原点 = 弾の中心。ナイフの本体（刃・柄）は描画側が武器の絵を進む向きへ向けて重ねる（thrownLook.ts）ので、
 * ここでは描かない（描くと二重になる）。その下に敷く風切りだけ: 刃の後ろへ抜ける芯の筋（切っ先の残像）、
 * 両脇を後ろへ流れる細い風の筋（フレームで長さが揺らぐ）、切っ先の前の小さな光（2 フレームおきに閃く）
 */
function knifeFly(frame, f) {
  const t = (f / KNIFE_FLY_FRAMES) * TAU;
  const tail = -KNIFE_BODY_HALF - 1;
  // 芯の筋: 本体の直後から後ろへ。切っ先が通った線の残像として一番明るい
  streakLine(frame, { ax: tail - 14, ay: 0, bx: tail, by: 0, width: 1.2, bright: 0.6 });
  // 両脇の風の筋: 上下で位相をずらして長さを揺らし、流れて見せる
  for (const side of [-1, 1]) {
    const len = 8 + 3 * Math.sin(t + (side > 0 ? 0 : Math.PI));
    const y = side * 3;
    streakLine(frame, { ax: tail - 2 - len, ay: y, bx: tail + 3, by: y * 0.7, bright: 0.38 });
  }
  // 切っ先の光: 本体の先に小さく閃く（常時だとうるさいので 2 フレームおき）
  if (f % 2 === 0) sparkle(frame, KNIFE_BODY_HALF + 1, 0, 1);
  // 後ろへ散る風の粒
  if (f % 3 === 0) dot(frame, tail - 8 - hash1(f, 4012) * 6, (hash1(f, 4013) - 0.5) * 6, 3);
}

/**
 * 投げの手元（muzzle）: 手首を返す細い弧が閉じ、前へ空気の裂け目が抜ける。火薬の閃光は無い。
 * 最初のフレームに刃の閃きの光点、あとは風の粒が前へ流れて消える
 */
function knifeMuzzle(frame, f) {
  if (f <= 1) thinArc(frame, { cx: -9, r: 10, a0: -80 * DEG, a1: 8 * DEG, width: 1.4, bright: 0.8 - f * 0.25 });
  if (f <= 2) {
    const x0 = -2 + f * 6;
    lens(frame, { ax: x0, ay: 0, bx: x0 + 18 - f * 3, by: 0, T: 4 - f, bias: 0, erosion: f * 0.25, seed: 4111, bright: 0.85 - f * 0.12 });
  }
  if (f === 0) sparkle(frame, 2, 0, 2);
  if (f >= 1) frontArc(frame, { ox: 10 + f * 3, radius: 3 + f * 2, width: 1.4, squash: 0.45, erosion: Math.min(0.9, f * 0.2), bright: 0.55 - f * 0.08, seed: 4112 });
  shards(frame, f - 1, 4, 4113, (i, rnd) => {
    const a = (rnd(1) - 0.5) * 1;
    const sp = 2 + rnd(2) * 2;
    return { x: 8, y: (rnd(3) - 0.5) * 4, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 2 + Math.floor(rnd(4) * 2), size: 1 };
  });
}

/**
 * 短剣の着弾（壁で止まった）: 原点 = 止まった位置、+x = 進んでいた向き。刃が切っ先から壁に突き立ち、
 * 柄が左右へ細かく震える（フレームごとに ±角）。最初に硬い当たりの閃きと、後ろへ跳ねる鋼の火花
 */
function knifeImpact(frame, f) {
  const N = 7;
  const quiver = [9, -7, 5, -3, 2, -1, 0][f] ?? 0;
  const fade = f / (N - 1);
  knife(frame, { x: -5, a: quiver * DEG, len: 14, w: 2.4, bright: 1 - fade * 0.55, erosion: Math.max(0, fade - 0.5) * 1.6, seed: 4211 });
  if (f <= 1) {
    lens(frame, { ax: 2, ay: -7, bx: 2, by: 7, T: f === 0 ? 3 : 2, bias: 0, bright: 0.9 });
    sparkle(frame, 2, 0, f === 0 ? 3 : 2);
  }
  shards(frame, f, 7, 4212, (i, rnd) => {
    const a = Math.PI + (rnd(1) - 0.5) * 2.4;
    const sp = 2.4 + rnd(2) * 2.4;
    return { x: 1, y: (rnd(3) - 0.5) * 3, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(4) * 2), size: rnd(5) > 0.5 ? 2 : 1, drag: 0.8 };
  });
  // 柄尻の震えの線（柄の後ろに短い弧が左右交互に）
  if (f >= 1 && f <= 4) {
    const side = f % 2 === 0 ? 1 : -1;
    thinArc(frame, { cx: 2, r: 13, a0: Math.PI - side * 4 * DEG, a1: Math.PI + side * 22 * DEG, bright: 0.45 - f * 0.05 });
  }
}

/** 短剣の命中: 刺し傷（軽い命中と同じ作りを小さく）。刺さった向きへ細い針と前へ散る粒 */
function knifeHit(frame, f) {
  if (f <= 1) {
    spike(frame, { x: -4, a: 0, len: 16 - f * 2, w: 2, bright: 1 });
    spike(frame, { x: -1, a: Math.PI / 2, len: 5, w: 1.4, bright: 0.7 });
    spike(frame, { x: -1, a: -Math.PI / 2, len: 5, w: 1.4, bright: 0.7 });
    flashCore(frame, -1, 0, 2.4, 1);
    if (f === 0) sparkle(frame, -1, 0, 2);
  }
  // 刃の通った斜めの浅い切り傷（前へふくらむ細いレンズ 1 本）
  if (f >= 1 && f <= 3) lens(frame, { ax: -6, ay: -6, bx: 8, by: 5, T: 3 - (f - 1) * 0.6, bend: 2, bias: 0, erosion: (f - 1) * 0.35, seed: 4311, bright: 0.8 });
  shards(frame, f, 7, 4312, (i, rnd) => {
    const a = (rnd(1) - 0.5) * 1.5;
    const sp = 2.5 + rnd(2) * 2.5;
    return { x: 2, y: (rnd(3) - 0.5) * 2, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(4) * 2), size: 2, drag: 0.82 };
  });
}

/**
 * 短剣が尽きた（dirs 1）: 勢いを失った刃が回りながら画面の下へ落ち、落ちた所で小さく光って消える
 */
function knifeFizzle(frame, f) {
  const drop = Math.min(1, f / 4);
  const y = drop * drop * 12;
  if (f <= 4) knife(frame, { x: f * 0.8, y, a: -30 * DEG + f * 55 * DEG, len: 12, w: 2, bright: 1 - f * 0.1, seed: 4411 });
  if (f === 4) sparkle(frame, 3, y + 1, 2);
  if (f >= 5) {
    const age = f - 5;
    for (let i = 0; i < 3; i++) dot(frame, 1 + i * 2 + age, y + 1 - (i === 1 ? 1 : 0), 4 - age - (i === 1 ? 0 : 1));
  }
}

// -----------------------------------------------------------------------------
// 弾: 吹き矢（blowgun）。radius 3、速さ ≈ 114px/秒。毒の配色
// -----------------------------------------------------------------------------

/**
 * 飛ぶ吹き矢: 原点 = 弾の中心。細い針（切っ先だけ白）と、尻の小さな羽根（V 字）。
 * 後ろへ揺れる毒の筋（波打つ 1 本、フレームで波が流れる）と、筋から落ちる滴
 */
function dartFly(frame, f) {
  const phaseShift = (f / 4) * TAU;
  // 毒の筋: 羽根の後ろから −x へ。後ろほど細く暗い
  paint(
    frame,
    (x, y) => {
      if (x > -7 || x < -30) return -1;
      const u = (-7 - x) / 23;
      const cy = Math.sin(u * 7 - phaseShift) * (0.6 + 2 * u);
      const w = 1.5 * (1 - u) + 0.45;
      const d = Math.abs(y - cy);
      if (d > w) return -1;
      return clamp01((1 - d / w) ** 0.5 * (0.6 - 0.45 * u));
    },
    { bounds: { x0: -31, y0: -5, x1: -6, y1: 5 }, dither: 0.02 },
  );
  // 針: −6 から +9、太さ 2 ドット。切っ先の 2 ドットだけ段 7
  paint(
    frame,
    (x, y) => {
      if (x < -6 || x > 9) return -1;
      const u = (x + 6) / 15;
      const half = 1.1 - Math.max(0, u - 0.7) * 2.8;
      if (half <= 0.2 || Math.abs(y) > half) return -1;
      return x > 6 ? 0.95 : 0.55 + 0.2 * u;
    },
    { bounds: { x0: -7, y0: -3, x1: 10, y1: 3 }, dither: 0 },
  );
  // 羽根: 尻から後ろ斜めへ開く 2 本の短い針
  spike(frame, { x: -5, y: 0, a: Math.PI - 32 * DEG, len: 5, w: 1.3, bright: 0.62 });
  spike(frame, { x: -5, y: 0, a: Math.PI + 32 * DEG, len: 5, w: 1.3, bright: 0.62 });
  // 滴: 筋から 1 つ落ちる（フレームで位置を変える）
  const dx = -12 - hash1(f, 4511) * 12;
  dot(frame, dx, 3 + (f % 2), 4);
}

/** 吹き矢の手元: 吹いた息の丸い輪（前へ押し出る）と、口元から前へ散る毒の霧の粒。閃光ではなく息 */
function dartMuzzle(frame, f) {
  if (f <= 1) lens(frame, { ax: -2, ay: 0, bx: 14 + f * 4, by: 0, T: 2.2, bias: 0, bright: 0.8 - f * 0.2, seed: 4611 });
  if (f === 0) flashCore(frame, 0, 0, 3, 0.8);
  frontArc(frame, { ox: 2 + f * 2, radius: 4 + f * 2.6, width: 2, squash: 0.7, spread: 80 * DEG, erosion: Math.min(0.9, f * 0.2), bright: 0.7 - f * 0.1, seed: 4612 });
  shards(frame, f, 8, 4613, (i, rnd) => {
    const a = (rnd(1) - 0.5) * 1.4;
    const sp = 1.4 + rnd(2) * 2;
    return { x: 4, y: (rnd(3) - 0.5) * 4, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(4) * 2), size: 1, drag: 0.75, bright: 0.7 };
  });
  if (f >= 2) bubble(frame, 10 + f * 2, -3 - f, 1.4, 0.6 - f * 0.06);
}

/**
 * 吹き矢の着弾: 針が突き立ち（短い棒と羽根）、毒が当たった所から前の半球へ滴になって飛び散る。
 * 最後は小さな毒溜まりの点と泡が残る
 */
function dartImpact(frame, f) {
  const N = 7;
  const fade = f / (N - 1);
  if (f <= 4) {
    streakLine(frame, { ax: -8, ay: 0, bx: 1, by: 0, width: 2, bright: 0.6 - fade * 0.3 });
    spike(frame, { x: -7, a: Math.PI - 32 * DEG, len: 4, w: 1.2, bright: 0.55 - fade * 0.2 });
    spike(frame, { x: -7, a: Math.PI + 32 * DEG, len: 4, w: 1.2, bright: 0.55 - fade * 0.2 });
  }
  if (f <= 1) {
    flashCore(frame, 1, 0, f === 0 ? 4 : 3, 0.9);
    if (f === 0) sparkle(frame, 1, 0, 2);
  }
  // 飛沫: 大きめの滴（2 ドット）が弧を描いて散る
  shards(frame, f, 9, 4711, (i, rnd) => {
    const a = (rnd(1) - 0.5) * 3.6;
    const sp = 1.8 + rnd(2) * 2.4;
    return { x: 1, y: 0, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(3) * 3), size: 2, drag: 0.72 };
  });
  if (f >= 1 && f <= 3) ring(frame, { ox: 1, radius: 3 + f * 2, width: 1.5, squash: 1, erosion: Math.min(0.9, f * 0.25), bright: 0.6, seed: 4712 });
  if (f >= 3) {
    bubble(frame, 4, -3 - (f - 3), 1.5, 0.6 - (f - 3) * 0.1);
    if (f <= 5) bubble(frame, -2, 4, 1.2, 0.5);
  }
}

/** 吹き矢の命中: 刺さった所から毒が花のように開く。6 つの泡が外へ離れ、中心に小さな輪 */
function dartHit(frame, f) {
  if (f <= 1) {
    spike(frame, { x: -8, a: 0, len: 12, w: 1.6, bright: 1 });
    flashCore(frame, 0, 0, 3.5 - f, 1);
    sparkle(frame, 0, 0, 2);
  }
  if (f >= 1) {
    const age = f - 1;
    ring(frame, { radius: 4 + age * 2.4, width: 1.6, squash: 0.8, erosion: Math.min(0.9, age * 0.22), bright: 0.7 - age * 0.1, seed: 4811 });
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + 0.3;
      const r = 6 + age * 3.2;
      if (age > 4 || (age === 4 && i % 2 === 0)) continue;
      bubble(frame, Math.cos(a) * r, Math.sin(a) * r, 1.6 + (i % 2) * 0.5, 0.62 - age * 0.1);
    }
  }
  shards(frame, f, 6, 4812, (i, rnd) => {
    const a = (rnd(1) - 0.5) * 2;
    const sp = 2 + rnd(2) * 2;
    return { x: 2, y: 0, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3, size: 2, drag: 0.75 };
  });
}

/** 吹き矢が尽きた（dirs 1）: 針が落ち、毒の滴が垂れ、泡が 2〜3 つ昇って弾ける */
function dartFizzle(frame, f) {
  if (f <= 3) streakLine(frame, { ax: -5, ay: f * 1.5, bx: 4, by: f * 1.5 + 1, width: 1.5, bright: 0.5 - f * 0.08 });
  if (f <= 4) dot(frame, 0, 3 + f * 2, 5 - Math.floor(f / 2));
  for (let i = 0; i < 3; i++) {
    const born = i * 2;
    const age = f - born;
    if (age < 0 || age > 3) continue;
    const x = (i - 1) * 4 + Math.sin(age + i) * 1.2;
    const y = -2 - age * 3;
    if (age === 3) {
      // 弾けた泡: 4 つの点に割れる
      for (const [ox, oy] of [[-2, 0], [2, 0], [0, -2], [0, 2]]) dot(frame, x + ox, y + oy, 3);
    } else bubble(frame, x, y, 1.3 + age * 0.3, 0.6 - age * 0.1);
  }
}

// -----------------------------------------------------------------------------
// 弾: 跳ね銃（ricochetGun）。radius 2、速さ ≈ 180px/秒 → 尾 ≈ 14 ドット。真鍮
// -----------------------------------------------------------------------------

/** 飛ぶ跳ね玉: 硬い丸玉（縁が明るく、照りの白い点が回る）と、短く細る曳光 */
function pelletFly(frame, f) {
  const R = 3.4;
  paint(
    frame,
    (x, y) => {
      if (x < -16 || x > R + 1) return -1;
      let v = -1;
      const d = Math.hypot(x, y);
      if (d <= R) v = clamp01(0.5 + 0.25 * (d / R));
      if (x < -R * 0.4) {
        const u = (-R * 0.4 - x) / (16 - R * 0.4);
        const hw = 1.6 * (1 - u) ** 0.7 + 0.3;
        if (Math.abs(y) <= hw) v = Math.max(v, clamp01((1 - Math.abs(y) / hw) ** 0.6 * 0.62 * (1 - u) + 0.08));
      }
      return v;
    },
    { bounds: { x0: -17, y0: -R - 1, x1: R + 2, y1: R + 1 }, dither: 0.02 },
  );
  // 照り: 玉の回転で縁を 90° ずつ移る 1 ドットの白
  const a = -45 * DEG + (f / 4) * TAU;
  dot(frame, Math.cos(a) * (R - 1.2), Math.sin(a) * (R - 1.2), 7);
}

/** 跳ね銃の手元: 指で弾いた硬い音の閃き（小さな菱形の芯と、前斜めへ開く 2 本の鉤）と、前へ押す弧 */
function pelletMuzzle(frame, f) {
  if (f <= 1) {
    const s = f === 0 ? 1 : 0.7;
    spike(frame, { x: -1, a: 0, len: 12 * s, w: 2.4 * s, bright: 1 });
    spike(frame, { x: -1, a: Math.PI, len: 4 * s, w: 1.8 * s, bright: 0.7 });
    spike(frame, { x: 1, a: 42 * DEG, len: 8 * s, w: 1.4, bright: 0.85 });
    spike(frame, { x: 1, a: -42 * DEG, len: 8 * s, w: 1.4, bright: 0.85 });
    flashCore(frame, -1, 0, 2.4 * s, 1);
    if (f === 0) sparkle(frame, 0, 0, 2);
  }
  if (f >= 1) frontArc(frame, { ox: 6 + f * 3, radius: 3 + f * 2.4, width: 1.6, squash: 0.5, erosion: Math.min(0.9, f * 0.22), bright: 0.62 - f * 0.1, seed: 4911 });
  shards(frame, f - 1, 4, 4912, (i, rnd) => {
    const side = i % 2 === 0 ? 1 : -1;
    const a = side * (40 + rnd(1) * 30) * DEG;
    const sp = 2.4 + rnd(2) * 2;
    return { x: 3, y: 0, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 2, size: 1 };
  });
}

/**
 * 折れ線の火花 1 本: (0, 0) から角 a へ、途中で bend だけ折れて跳ね返る 2 節の線。age で先へ進みながら根元から消える
 */
function zigSpark(frame, a, bend, len, age, bright) {
  const m = len * 0.45;
  const mx = Math.cos(a) * m;
  const my = Math.sin(a) * m;
  const b = a + bend;
  const ex = mx + Math.cos(b) * (len - m);
  const ey = my + Math.sin(b) * (len - m);
  // 根元から消える: 見えている区間を age で前へずらす
  const cut = Math.min(0.8, age * 0.3);
  const pts = [
    [0, 0, mx, my],
    [mx, my, ex, ey],
  ];
  for (let i = 0; i < pts.length; i++) {
    const [ax, ay, bx, by] = pts[i] ?? [0, 0, 0, 0];
    const t0 = i === 0 ? cut * 2 : Math.max(0, cut * 2 - 1);
    if (t0 >= 1) continue;
    streakLine(frame, { ax: ax + (bx - ax) * t0, ay: ay + (by - ay) * t0, bx, by, width: 1.1, bright: bright * (i === 1 ? 1 : 0.8) });
  }
  dot(frame, ex, ey, Math.max(3, 6 - age));
}

/**
 * 跳ね玉の着弾: 当たった面の短い閃きと、後ろの半球へ折れ曲がって跳ね返る火花（稲妻状の 2 節）。
 * 着弾の性格は「跳弾」なので、火花は直線でなく途中で向きを変える
 */
function pelletImpact(frame, f) {
  const N = 7;
  if (f <= 1) {
    lens(frame, { ax: 0, ay: -8, bx: 0, by: 8, T: f === 0 ? 3.6 : 2.2, bias: 0, bright: 0.95 });
    flashCore(frame, 0, 0, 3, 1);
    sparkle(frame, 0, 0, f === 0 ? 3 : 2);
  }
  if (f <= 4) {
    for (let i = 0; i < 5; i++) {
      const a = Math.PI + (hash1(i, 5011) - 0.5) * 2.6;
      const bend = (hash1(i, 5012) > 0.5 ? 1 : -1) * (35 + hash1(i, 5013) * 30) * DEG;
      const len = (10 + hash1(i, 5014) * 8) * Math.min(1, (f + 1) / 2);
      zigSpark(frame, a, bend, len, Math.max(0, f - 1), 0.85 - f * 0.12);
    }
  }
  shards(frame, f - 1, 6, 5015, (i, rnd) => {
    const a = Math.PI + (rnd(1) - 0.5) * 2.6;
    const sp = 3 + rnd(2) * 2.5;
    return { x: -2, y: 0, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(3) * 2), size: 1, drag: 0.8 };
  });
  if (f >= N - 2) dot(frame, -1, 0, 3);
}

/** 跳ね玉が尽きた（dirs 1）: 玉が床で小さく 2 回弾み、止まった所に光が残って消える */
function pelletFizzle(frame, f) {
  // 弾みの位置（画面の右へ転がりながら、下が床）
  const hops = [
    [0, -6],
    [3, -1],
    [6, -4],
    [8, 0],
    [10, -1.5],
    [11, 0],
    [11.5, 0],
  ];
  const [x, y] = hops[f] ?? [11, 0];
  const lv = Math.max(3, 6 - Math.floor(f / 2));
  dot(frame, x, y, lv);
  dot(frame, x + 1, y, lv - 1);
  dot(frame, x, y + 1, lv - 1);
  dot(frame, x + 1, y + 1, Math.max(2, lv - 2));
  // 床に当たったフレームの小さな砂
  if (f === 1 || f === 3) {
    dot(frame, x - 2, y + 2, 3);
    dot(frame, x + 3, y + 2, 3);
  }
  if (f >= 5) sparkle(frame, x, y - 2, 1);
}

// -----------------------------------------------------------------------------
// 弾: 導きの珠（seekerOrb）。radius 3、速さ ≈ 114px/秒。毒の配色
// -----------------------------------------------------------------------------

/**
 * 飛ぶ導きの珠: 原点 = 珠の中心。渦を抱いた丸い珠（中の渦がフレームで回る）と、
 * 後ろへ揺らめく尾（波打つ 1 本の太い筋が先ほど太く、後ろで細く切れる）。白は照りの 1 点だけ
 */
function orbFly(frame, f) {
  const R = 6;
  const spin = (f / 6) * TAU;
  const wave = (f / 6) * TAU;
  // 尾
  paint(
    frame,
    (x, y) => {
      if (x > -R + 2 || x < -30) return -1;
      const u = (-R + 2 - x) / (30 - R + 2);
      const cy = Math.sin(u * 5.5 - wave) * 3 * u ** 0.8;
      const w = 3.6 * (1 - u) ** 0.8 + 0.4;
      const d = Math.abs(y - cy);
      if (d > w) return -1;
      if (valueNoise(x + f * 3, y, 2.4, 5111) * 0.7 + (1 - u) * 0.6 < 0.45) return -1;
      return clamp01((1 - d / w) ** 0.6 * (0.55 - 0.4 * u));
    },
    { bounds: { x0: -31, y0: -8, x1: -R + 3, y1: 8 }, dither: 0.03 },
  );
  // 珠: 縁が段 3、中は段 4〜5 に、渦の 2 本の腕が段 6 で回る
  paint(
    frame,
    (x, y) => {
      const d = Math.hypot(x, y);
      if (d > R) return -1;
      const a = Math.atan2(y, x);
      const arm = Math.cos(2 * (a - spin) - d * 0.9);
      let v = 0.4 + 0.18 * (1 - d / R);
      if (arm > 0.55 && d > 1.5 && d < R - 1) v = 0.7;
      if (d > R - 1.1) v = 0.3;
      return clamp01(v);
    },
    { bounds: { x0: -R - 1, y0: -R - 1, x1: R + 1, y1: R + 1 }, dither: 0 },
  );
  dot(frame, -2, -2, 7);
  // 尾から剥がれる粒
  dot(frame, -14 - hash1(f, 5112) * 10, (hash1(f, 5113) - 0.5) * 8, 4);
}

/** 導きの珠の手元: 周りから渦を巻いて集まる粒と、閉じていく欠けた輪が手元で珠を結び、ぽんと放つ */
function orbMuzzle(frame, f) {
  const N = 6;
  const k = f / (N - 1);
  if (f <= 3) {
    const r = 12 - f * 3;
    ring(frame, { ox: 2, radius: Math.max(2, r), width: 1.6, erosion: 0.3 + f * 0.1, bright: 0.65, seed: 5211 + f });
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU + f * 0.9;
      const rr = 14 - f * 3.5;
      dot(frame, 2 + Math.cos(a) * rr, Math.sin(a) * rr, 5);
    }
  }
  if (f === 3) {
    flashCore(frame, 2, 0, 4, 0.95);
    sparkle(frame, 2, 0, 2);
  }
  if (f >= 3) frontArc(frame, { ox: 4 + (f - 3) * 3, radius: 4 + (f - 3) * 3, width: 1.8, squash: 0.6, erosion: Math.min(0.9, (f - 3) * 0.3), bright: 0.65 - k * 0.2, seed: 5212 });
}

/**
 * 導きの珠の着弾: 珠が弾ける。中心の芯と、全周へ広がる欠けた輪、飛び散る毒の塊（2 ドット）と、あとに残って昇る泡
 */
function orbImpact(frame, f) {
  const N = 8;
  if (f <= 1) {
    flashCore(frame, 0, 0, f === 0 ? 7 : 5, 1);
    sparkle(frame, 0, 0, f === 0 ? 3 : 2);
  }
  if (f >= 1) {
    const age = f - 1;
    ring(frame, { radius: 6 + age * 3.4, width: 2.4 - age * 0.2, squash: 0.9, erosion: Math.min(0.92, 0.15 + age * 0.18), bright: 0.75 - age * 0.08, seed: 5311 });
  }
  shards(frame, f, 12, 5312, (i, rnd) => {
    const a = (i / 12) * TAU + (rnd(1) - 0.5) * 0.4;
    const sp = 2.2 + rnd(2) * 2;
    return { x: 0, y: 0, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(3) * 3), size: 2, drag: 0.75 };
  });
  for (let i = 0; i < 3; i++) {
    const age = f - 3 - i;
    if (age < 0 || age > 3) continue;
    const x = (hash1(i, 5313) - 0.5) * 12;
    bubble(frame, x, -age * 2.5 + (hash1(i, 5314) - 0.5) * 6, 1.3 + age * 0.3, 0.65 - age * 0.12);
  }
  if (f >= N - 2) dot(frame, 0, 0, 3);
}

/** 導きの珠が尽きた（dirs 1）: 珠が縮みながら泡立ち、泡が上へ昇って消える */
function orbFizzle(frame, f) {
  const r = Math.max(0, 5 - f * 1.2);
  if (r > 0.8) {
    paint(
      frame,
      (x, y) => {
        const d = Math.hypot(x, y);
        if (d > r) return -1;
        if (valueNoise(x, y, 1.8, 5411 + f) < f * 0.12) return -1;
        return clamp01(0.55 - f * 0.05 + 0.15 * (1 - d / r));
      },
      { bounds: { x0: -r - 1, y0: -r - 1, x1: r + 1, y1: r + 1 }, dither: 0 },
    );
  }
  for (let i = 0; i < 4; i++) {
    const age = f - i;
    if (age < 0 || age > 4) continue;
    const x = (hash1(i, 5412) - 0.5) * 10 + Math.sin(age * 1.3 + i) * 1.2;
    bubble(frame, x, -3 - age * 3, 1.1 + age * 0.25, 0.6 - age * 0.1);
  }
}

// -----------------------------------------------------------------------------
// シートと表
// -----------------------------------------------------------------------------

/** 弾の表の 1 行 */
function bulletRow(name, o) {
  return {
    fly: `thrown.${name}Fly`,
    period: o.period,
    base: o.base,
    muzzle: `thrown.${name}Muzzle`,
    impact: `thrown.${name}Impact`,
    ...(o.hit ? { hit: `thrown.${name}Hit` } : {}),
    fizzle: `thrown.${name}Fizzle`,
    ramp: o.ramp,
  };
}

/**
 * 武器種のモーション → シート（render/fxMotions.ts が読む）。pivot: self = 自分の中心、anchor = 当たり判定の中心。
 * base は絵を描いたときの当たり判定の大きさ（measure の値。論理 px）
 */
const FX = {
  moveset: "thrown",
  motions: {
    dash: { sheet: "thrown.dash", pivot: "self", base: 40, measure: "reach" },
    "r:throughThrow": { sheet: "thrown.through", pivot: "self", base: 36, measure: "reach" },
    "r:thrownKick": { sheet: "thrown.kick", pivot: "anchor", base: 12, measure: "reach" },
    "branch:tripleThrow": { sheet: "thrown.triple", pivot: "self", base: 20, measure: "size" },
    "branch:spinThrow": { sheet: "thrown.spin", pivot: "self", base: 20, measure: "size" },
    "branch:grabToss": { sheet: "thrown.grab", pivot: "anchor", base: 10, measure: "reach" },
    "branch:drawCut": { sheet: "thrown.drawCut", pivot: "self", base: 40, measure: "reach" },
  },
  hit: "thrown.hit",
  hitHeavy: "thrown.hitHeavy",
  bullets: {
    // 投げ短剣は刃の鋼の色、跳ね玉は真鍮、吹き矢と導きの珠は毒
    throwingKnives: bulletRow("knife", { period: 0.18, base: 2, ramp: "steel", hit: true }),
    blowgun: bulletRow("dart", { period: 0.24, base: 3, ramp: "poison", hit: true }),
    ricochetGun: bulletRow("pellet", { period: 0.1, base: 2, ramp: "brass" }),
    seekerOrb: bulletRow("orb", { period: 0.4, base: 3, ramp: "poison" }),
  },
};

export const ATLAS = {
  key: "thrown",
  fx: FX,
  sheets: [
    { key: "thrown.dash", dirs: DIRS, frames: 8, active: 3, size: 184, draw: dashStab },
    { key: "thrown.through", dirs: DIRS, frames: 8, active: 3, size: 200, draw: throughThrow },
    { key: "thrown.drawCut", dirs: DIRS, frames: 9, active: 4, size: 200, draw: drawCut },
    { key: "thrown.kick", dirs: DIRS, frames: 8, active: 3, size: 96, draw: kick },
    { key: "thrown.triple", dirs: DIRS, frames: 8, active: 3, size: 96, draw: tripleThrow },
    { key: "thrown.spin", dirs: DIRS, frames: 8, active: 4, size: 104, draw: spinThrow },
    { key: "thrown.grab", dirs: DIRS, frames: 9, active: 3, size: 112, draw: grabToss },
    { key: "thrown.hit", dirs: DIRS, frames: 6, active: 0, size: 72, draw: (frame, f) => pierceHit(frame, f, false) },
    { key: "thrown.hitHeavy", dirs: DIRS, frames: 7, active: 0, size: 104, draw: (frame, f) => pierceHit(frame, f, true) },
    { key: "thrown.knifeFly", dirs: SHOT_DIRS, frames: KNIFE_FLY_FRAMES, active: 0, size: 48, draw: knifeFly },
    { key: "thrown.knifeMuzzle", dirs: DIRS, frames: 5, active: 0, size: 64, draw: knifeMuzzle },
    { key: "thrown.knifeImpact", dirs: DIRS, frames: 7, active: 0, size: 56, draw: knifeImpact },
    { key: "thrown.knifeHit", dirs: DIRS, frames: 6, active: 0, size: 56, draw: knifeHit },
    { key: "thrown.knifeFizzle", dirs: 1, frames: 7, active: 0, size: 48, draw: knifeFizzle },
    { key: "thrown.dartFly", dirs: SHOT_DIRS, frames: 4, active: 0, size: 72, draw: dartFly },
    { key: "thrown.dartMuzzle", dirs: DIRS, frames: 5, active: 0, size: 56, draw: dartMuzzle },
    { key: "thrown.dartImpact", dirs: DIRS, frames: 7, active: 0, size: 48, draw: dartImpact },
    { key: "thrown.dartHit", dirs: DIRS, frames: 6, active: 0, size: 56, draw: dartHit },
    { key: "thrown.dartFizzle", dirs: 1, frames: 7, active: 0, size: 40, draw: dartFizzle },
    { key: "thrown.pelletFly", dirs: SHOT_DIRS, frames: 4, active: 0, size: 44, draw: pelletFly },
    { key: "thrown.pelletMuzzle", dirs: DIRS, frames: 5, active: 0, size: 48, draw: pelletMuzzle },
    { key: "thrown.pelletImpact", dirs: DIRS, frames: 7, active: 0, size: 56, draw: pelletImpact },
    { key: "thrown.pelletFizzle", dirs: 1, frames: 7, active: 0, size: 40, draw: pelletFizzle },
    { key: "thrown.orbFly", dirs: SHOT_DIRS, frames: 6, active: 0, size: 72, draw: orbFly },
    { key: "thrown.orbMuzzle", dirs: DIRS, frames: 6, active: 0, size: 48, draw: orbMuzzle },
    { key: "thrown.orbImpact", dirs: DIRS, frames: 8, active: 0, size: 64, draw: orbImpact },
    { key: "thrown.orbFizzle", dirs: 1, frames: 7, active: 0, size: 40, draw: orbFizzle },
  ],
};
