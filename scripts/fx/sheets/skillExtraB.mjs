// スキル石: 大拡張の後半（近接の技・弾・移動・自己強化）と召喚・設置（docs/ideas/fx-sprites.md 10 章）。
// 単位は絵のドット（論理 0.5px）。正準の向きは +x（技の向き）。当たり判定の半径 × 2 ドットで描き、表の base にその半径（px）を書く
//
// 絵は名前と説明から連想できる形にする:
// - 連環撃（comboChain）: 突きの一閃の柄に鎖の環が連なり、穂先で環が弾ける（act。突き 1 段ごと）
// - 恨み返し（grudge）: 受けた痛みが黒い渦で自分に集まり、牙のように尖った波頭が扇に返る（cast）
// - 断頭振り（guillotine）: 溜めの間は斜めの刃を持つ断頭台の刃の影が浮かび刃先の帯が光る（active）。落ちると刃が叩きつけられ、床に溝（act）
// - 跳弾（ricochet）: 真鍮の弾（fly）、壁で跳ねた所の火花（act）、発射の閃光（cast）
// - 風切り（galeSlash）: 前へ凸の風の刃が渦を巻いて飛ぶ（fly）、放つ一振り（cast）、敵弾を切った十字（act）
// - 散弾符（scatterSigil）: 前に浮いた紙の符が破れて 7 条の扇に弾ける（cast）、小さな粒の弾（fly）
// - 震脚（stomp）: 足元から地割れが走り、地面の波が同心円に広がる（cast の地面）、石礫が跳ね上がる（cast の空中）
// - 手繰り糸（threadReel）: 自分の糸巻きから照準へたるんだ糸と先の鉤（cast）、巻き取ると糸が張り、手前へ向く山形が流れる（act）
// - 墜星（meteorDive）: 跳び上がりの土煙（cast）、落下点の照準の輪と空から降る火の隕石（act）、着弾の火柱とクレーター（end）
// - 燕返し（swallowFlip）: 燕の翼と二股の尾の速度線（active）、着地から燕の形の刃が元の位置へ戻る（end + 道筋の二本線）
// - 巻き戻し（backflow）: 元の位置に逆回りする時計の文字盤（cast）、戻る道の早戻しの山形（beam）、着いた所で時計の輪が縮む（tip）
// - 傷返し（scarRoar）: 咆哮の音の波が三重に広がり、爪痕の三本線が外へ飛ぶ（cast）
// - 爆薬樽（powderKeg）: 箍の付いた樽と燃える導火線（placed）、床に爆発範囲の点線、爆発の火球と飛び散る樽板（end）
// - 剣の墓標（swordGrave）: 地面に突き立つ剣と墓標の刻印の輪（placed）、空から落ちて刺さる（cast）、剣を軸に回る斬撃（act）
// - 骨片の輪（boneRing）: 周りを回る骨の道筋（aura）、骨片 1 本（placed。骨の位置ごと）、骨が渦で湧く（cast）、敵弾を止めて砕ける（act）
// - 湧き石（manaSpring）: 石から波紋が広がる泉と縁（placed の地面）、立ち昇る気力の泡（placed の空中）、湧き出す噴水（cast）、気力を吸う滴（act）
// - 砲台（turret）: 据え付けの台座と見回す砲身（placed）、組み上がる脚（cast）、砲口の閃光（act）、曳光弾（fly）
import { arcLine, crescent, lens, ring, shards, streakLine } from "../shapes.mjs";
import { clamp01, dot, glint, hash1, paint, segment, smoothstep, stamp, valueNoise } from "../raster.mjs";
import { DIRS } from "../motifs.mjs";

const TAU = Math.PI * 2;
const SEED = 7301;

/** 進み（0..1）。フレームの中央 */
function prog(f, frames) {
  return (f + 0.5) / frames;
}

/** 太さのある一様な線（a → b） */
function bar(frame, ax, ay, bx, by, width, v) {
  const pad = width + 2;
  paint(
    frame,
    (x, y) => {
      const s = segment(x, y, ax, ay, bx, by);
      return s.d > width / 2 ? -1 : v;
    },
    { bounds: { x0: Math.min(ax, bx) - pad, y0: Math.min(ay, by) - pad, x1: Math.max(ax, bx) + pad, y1: Math.max(ay, by) + pad }, dither: 0 },
  );
}

/** 円盤。v は数値か、中心からの距離の比（0..1）→ 明るさの関数 */
function disc(frame, cx, cy, r, v, dither = 0.04) {
  paint(
    frame,
    (x, y) => {
      const d = Math.hypot(x - cx, y - cy) / r;
      if (d > 1) return -1;
      return typeof v === "function" ? v(d, x, y) : v;
    },
    { bounds: { x0: cx - r - 1, y0: cy - r - 1, x1: cx + r + 1, y1: cy + r + 1 }, dither },
  );
}

/** 多角形（点の並び）の内側を v で塗る。v は数値か (x, y) → 明るさ */
function poly(frame, pts, v) {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  paint(
    frame,
    (x, y) => {
      let inside = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi, yi] = pts[i];
        const [xj, yj] = pts[j];
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
      }
      if (!inside) return -1;
      return typeof v === "function" ? v(x, y) : v;
    },
    { bounds: { x0: Math.min(...xs) - 1, y0: Math.min(...ys) - 1, x1: Math.max(...xs) + 1, y1: Math.max(...ys) + 1 }, dither: 0 },
  );
}

/** ぎざぎざの折れ線（地割れ）。a から角 angle へ len 伸ばす。seed ごとに折れ方が決まる */
function crack(frame, x0, y0, angle, len, level, seed, width = 1) {
  const steps = Math.max(2, Math.round(len / 7));
  let x = x0;
  let y = y0;
  for (let i = 0; i < steps; i++) {
    const a = angle + (hash1(i, seed) - 0.5) * 0.9;
    const seg = len / steps;
    const nx = x + Math.cos(a) * seg;
    const ny = y + Math.sin(a) * seg;
    bar(frame, x, y, nx, ny, width, level / 7);
    x = nx;
    y = ny;
  }
}

/** 角ごとに半径が揺れる輪（咆哮・地面の波）。wob（ドット）と lobes（山の数）で揺らす */
function wobbleRing(frame, o) {
  const pad = o.radius + o.wob + o.width + 2;
  paint(
    frame,
    (x, y) => {
      const a = Math.atan2(y, x);
      const r0 = o.radius + Math.sin(a * o.lobes + (o.phase ?? 0)) * o.wob + (hash1(Math.floor((a / TAU + 1) * 40), o.seed) - 0.5) * (o.jitter ?? 0);
      const d = Math.abs(Math.hypot(x, y) - r0);
      if (d > o.width / 2) return -1;
      if ((o.gap ?? 0) > 0 && hash1(Math.floor((a / TAU + 1) * 24), o.seed + 1) < o.gap) return -1;
      return clamp01(o.bright * (1 - 0.45 * (d / (o.width / 2))));
    },
    { bounds: { x0: -pad, y0: -pad, x1: pad, y1: pad }, dither: 0 },
  );
}

// =============================================================================
// 連環撃: 突きの一閃と鎖の環
// =============================================================================

const CHAIN = {
  /** 突きの長さ（px）。EXTRA.comboChain.length */
  lengthPx: 40,
  seed: SEED + 10,
};

function comboThrust(frame, f) {
  const frames = 7;
  const p = prog(f, frames);
  const L = CHAIN.lengthPx * 2;
  const grow = Math.min(1, p * 3.5);
  const erosion = smoothstep(0.45, 1, p);
  lens(frame, { ax: 30, ay: 0, bx: L, by: 0, T: 7, grow, erosion, seed: CHAIN.seed, bright: 1.05, bias: 0 });
  if (p < 0.5) bar(frame, 30, 0, 30 + (L - 32) * grow, 0, 1, 1);
  // 手元から連なる鎖の環（横長と縦長を交互に。環が連なって突きへ繋がる）
  const links = 4;
  for (let i = 0; i < links; i++) {
    const x = 6 + i * 7;
    if (x > 6 + (L - 6) * grow) continue;
    const flat = i % 2 === 0;
    ring(frame, { ox: x, radius: flat ? 3 : 3.6, width: 1.7, squash: flat ? 1.5 : 0.45, bright: 0.85 * (1 - erosion), seed: CHAIN.seed + i });
  }
  // 穂先で環が弾けて広がる
  if (grow >= 1) ring(frame, { ox: L - 3, radius: 3 + 14 * (p - 0.28), width: 2.2, squash: 0.55, bright: 0.9 * (1 - erosion) });
  for (const s of [-1, 1]) streakLine(frame, { ax: 12, ay: s * 7, bx: 12 + (L - 30) * grow, by: s * 5, bright: 0.5 * (1 - p) });
  if (f === 1 || f === 2) glint(frame, L, 0, f === 1 ? 3 : 2);
}

// =============================================================================
// 恨み返し: 集まる黒い渦と、牙の波頭の扇
// =============================================================================

const GRUDGE = {
  /** 扇の半径（px）。EXTRA.grudge.radius */
  radiusPx: 50,
  /** 扇の半角（rad）。EXTRA.grudge.halfAngle */
  half: 0.8,
  seed: SEED + 20,
};

function grudgeWave(frame, f) {
  const frames = 9;
  const p = prog(f, frames);
  const R = GRUDGE.radiusPx * 2;
  const half = GRUDGE.half;
  const s = GRUDGE.seed;
  const front = R * (0.2 + 0.8 * (1 - Math.pow(1 - Math.min(1, p * 1.7), 2)));
  const fade = 1 - smoothstep(0.55, 1, p);
  paint(
    frame,
    (x, y) => {
      const r = Math.hypot(x, y);
      const a = Math.atan2(y, x);
      if (Math.abs(a) > half) return -1;
      // 波頭の牙: 角ごとの三角波で外へ尖らせる
      const k = (a / half + 1) * 6;
      const i = Math.floor(k);
      const spike = 1 - Math.abs(k - i - 0.5) * 2;
      const edge = front + spike * 10 * (0.55 + 0.45 * hash1(i, s)) * (1 - Math.abs(a) / half * 0.4);
      if (r > edge) return -1;
      const depth = edge - r;
      if (depth < 2) return fade;
      if (depth < 9) return (0.78 - depth * 0.03) * fade;
      if (r < front * 0.3) return -1;
      // 内側は恨みの爪痕のような放射の筋（まばら）
      const band = Math.floor(a * 36);
      if (hash1(band, s + 3) < 0.7) return -1;
      return 0.4 * fade * (r / front);
    },
    { bounds: { x0: 0, y0: -R - 12, x1: R + 14, y1: R + 12 }, dither: 0.02 },
  );
  // 返す前の一瞬: 自分へ巻き込む黒い渦（受けた痛みが集まる）
  if (p < 0.35) {
    for (let i = 0; i < 5; i++) {
      const a0 = (i / 5) * TAU + p * 4;
      const radius = 18 - p * 30 + i * 1.2;
      if (radius < 3) continue;
      arcLine(frame, { radius, from: a0, to: a0 + 1.4, bright: 0.55, width: 2 });
    }
    glint(frame, 4, 0, 3);
  }
  // 波頭から千切れた牙の欠片
  shards(frame, f, 14, s + 5, (i, r) => {
    const a = (r(1) - 0.5) * 2 * half;
    const at = 20 + 20 * r(2);
    return { x: Math.cos(a) * at, y: Math.sin(a) * at, vx: Math.cos(a) * (9 + 5 * r(3)), vy: Math.sin(a) * (9 + 5 * r(3)), life: 5 + Math.floor(3 * r(4)), size: 2, drag: 0.9 };
  });
}

/** 恨み返しの地面: 扇の中を放射に走るひび */
function grudgeGround(frame, f) {
  const frames = 9;
  const p = prog(f, frames);
  const R = GRUDGE.radiusPx * 2;
  const reach = Math.min(1, p * 2);
  const level = Math.round(5 - 3 * smoothstep(0.4, 1, p));
  if (level < 2) return;
  for (let i = 0; i < 7; i++) {
    const a = (i / 6 - 0.5) * 2 * GRUDGE.half * 0.9;
    crack(frame, Math.cos(a) * 8, Math.sin(a) * 8, a, (R - 14) * reach * (0.7 + 0.3 * hash1(i, GRUDGE.seed + 9)), level, GRUDGE.seed + 30 + i);
  }
}

// =============================================================================
// 断頭振り: 断頭台の刃
// =============================================================================

const GUILLO = {
  /** 振り下ろす長さ（px）。EXTRA.guillotine.length */
  lengthPx: 48,
  /** 刃先の帯の始まり（px）。EXTRA.guillotine.sweetFrom */
  sweetPx: 36,
  seed: SEED + 40,
};

/** 断頭台の刃（+x に沿って寝かせた台形。背は真っ直ぐ、刃は斜め）。k は大きさ、v は明るさの倍率、sparse で面を間引く */
function guillotineBlade(frame, o) {
  const L = GUILLO.lengthPx * 2;
  const k = o.k ?? 1;
  const cx = (10 + L) / 2;
  const sx = (x) => cx + (x - cx) * k;
  const back = -9 * k;
  const pts = [
    [sx(10), back],
    [sx(L), back],
    [sx(L), 3 * k],
    [sx(10), 10 * k],
  ];
  const edgeA = { x: sx(10), y: 10 * k };
  const edgeB = { x: sx(L), y: 3 * k };
  const v = o.v ?? 1;
  poly(frame, pts, (x, y) => {
    const s = segment(x, y, edgeA.x, edgeA.y, edgeB.x, edgeB.y);
    // 刃の斜めの研ぎ（明るい帯）と背（暗い縁）、面は刃から背へ暗く
    if (s.d < 1.3) return clamp01(1 * v);
    if (s.d < 3.5) return clamp01(0.78 * v);
    if (Math.abs(y - back) < 1.5) return clamp01(0.5 * v);
    if (o.sparse && ((Math.floor(x) + Math.floor(y)) & 1) === 1) return -1;
    return clamp01((0.32 + 0.18 * (1 - s.d / 16)) * v);
  });
  // 吊り綱を通す穴（断頭台の刃らしさ）
  if (o.hole) disc(frame, sx(cx + 8), back + 4 * k, 1.6 * k, 0.2 * v, 0);
}

/** 溜め（active）: 刃の影が浮かび、刃先の帯が点滅し、光が刃へ集まる */
function guillotineAim(frame, f) {
  const frames = 8;
  const p = prog(f, frames);
  const L = GUILLO.lengthPx * 2;
  const S = GUILLO.sweetPx * 2;
  guillotineBlade(frame, { v: 0.55 + 0.45 * p, sparse: true, hole: true, k: 1 + 0.02 * (f % 2) });
  // 刃先（威力が倍になる所）の括弧
  const blink = f % 2 === 0 ? 0.95 : 0.7;
  for (const x of [S, L]) {
    bar(frame, x, -15, x, -12, 1.5, blink);
    bar(frame, x, 13, x, 16, 1.5, blink);
  }
  bar(frame, S, -15, S + 4, -15, 1.2, blink * 0.8);
  bar(frame, S, 16, S + 4, 16, 1.2, blink * 0.8);
  bar(frame, L, -15, L - 4, -15, 1.2, blink * 0.8);
  bar(frame, L, 16, L - 4, 16, 1.2, blink * 0.8);
  // 刃へ吸い込まれる光の粒
  for (let i = 0; i < 8; i++) {
    const r = (k) => hash1(i * 7 + k, GUILLO.seed);
    const ph = (p * 1.5 + r(1)) % 1;
    const x = 16 + (L - 20) * r(2);
    const y = 8 + (1 - ph) * (10 + 14 * r(3));
    dot(frame, x, y, ph > 0.7 ? 7 : 5);
  }
  if (p > 0.8) glint(frame, (S + L) / 2, 6, 3);
}

/** 振り下ろし（act）: 大きな刃の影が落ちてきて叩きつけられ、一閃の跡と刃先の火花が残る */
function guillotineDrop(frame, f) {
  const frames = 8;
  const p = prog(f, frames);
  const L = GUILLO.lengthPx * 2;
  const S = GUILLO.sweetPx * 2;
  if (f === 0) guillotineBlade(frame, { k: 1.3, v: 0.6, sparse: true });
  else if (f === 1) guillotineBlade(frame, { k: 1.12, v: 0.85 });
  else if (f === 2) guillotineBlade(frame, { k: 1, v: 1.1 });
  if (f >= 2) {
    const erosion = smoothstep(0.35, 1, p);
    lens(frame, { ax: 4, ay: 5, bx: L + 4, by: 5, T: 11, erosion, seed: GUILLO.seed + 3, bright: 1.1, bias: -0.2 });
    ring(frame, { ox: (S + L) / 2, oy: 5, radius: 6 + 26 * (p - 0.25), width: 3, squash: 1.6, bright: 0.8 * (1 - erosion) });
    shards(frame, f - 2, 14, GUILLO.seed + 5, (i, r) => ({
      x: S + (L - S) * r(1),
      y: 5,
      vx: (r(2) - 0.5) * 4,
      vy: (r(3) > 0.5 ? 1 : -1) * (4 + 5 * r(4)),
      life: 4 + Math.floor(2 * r(5)),
      size: r(6) > 0.4 ? 2 : 1,
    }));
  }
  if (f === 2 || f === 3) glint(frame, (S + L) / 2, 5, f === 2 ? 4 : 3);
}

/** 振り下ろしの床: 刃が落ちた溝と、刃先から枝分かれするひび */
function guillotineCrack(frame, f) {
  const frames = 8;
  const p = prog(f, frames);
  if (f < 2) return;
  const L = GUILLO.lengthPx * 2;
  const S = GUILLO.sweetPx * 2;
  const level = Math.round(5 - 3 * smoothstep(0.4, 1, p));
  bar(frame, 8, 5, L, 5, 2, level / 7);
  for (let i = 0; i < 5; i++) {
    const x = S + (L - S) * hash1(i, GUILLO.seed + 8);
    const side = i % 2 === 0 ? 1 : -1;
    crack(frame, x, 5, side * (Math.PI / 2 - 0.4 + 0.5 * hash1(i, GUILLO.seed + 9)), 8 + 8 * hash1(i, GUILLO.seed + 10), level - 1, GUILLO.seed + 20 + i);
  }
}

// =============================================================================
// 跳弾: 真鍮の弾と壁の火花
// =============================================================================

const RICO = { seed: SEED + 60 };

function ricochetFly(frame, f) {
  lens(frame, { ax: -5, ay: 0, bx: 6, by: 0, T: 5, bright: 1.05, bias: 0 });
  streakLine(frame, { ax: -26, ay: 0, bx: -4, by: 0, bright: 0.7, width: 2 });
  streakLine(frame, { ax: -18, ay: f % 2 === 0 ? -2 : 2, bx: -6, by: 0, bright: 0.45 });
  if (f % 2 === 0) glint(frame, 2, 0, 2);
  else dot(frame, 3, -1, 7);
}

/** 跳ねた所（+x = 跳ねた後の向き）: 閃光と、進む向きへ扇に散る火花、小さな跳ねの輪 */
function ricochetSpark(frame, f) {
  const frames = 6;
  const p = prog(f, frames);
  const fade = 1 - smoothstep(0.2, 1, p);
  disc(frame, 0, 0, 2 + 5 * (1 - p), (d) => clamp01((1.05 - 0.6 * d) * fade));
  ring(frame, { radius: 3 + 12 * p, width: 2, squash: 0.6, bright: 0.75 * fade });
  shards(frame, f, 12, RICO.seed + 1, (i, r) => {
    const a = (r(1) - 0.5) * 1.8;
    const sp = 4 + 5 * r(2);
    return { x: 0, y: 0, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(3 * r(3)), size: r(4) > 0.5 ? 2 : 1 };
  });
  // 跳ねの山形（進む向きを指す）
  if (p < 0.5) {
    streakLine(frame, { ax: -4, ay: -8, bx: 6, by: 0, bright: 0.9 });
    streakLine(frame, { ax: -4, ay: 8, bx: 6, by: 0, bright: 0.9 });
  }
  if (f === 0) glint(frame, 0, 0, 4);
}

function ricochetMuzzle(frame, f) {
  const frames = 5;
  const p = prog(f, frames);
  const fade = 1 - smoothstep(0.2, 1, p);
  lens(frame, { ax: 6, ay: 0, bx: 6 + 18 * (1 - p * 0.5), by: 0, T: 8 * fade + 1, bright: fade, bias: 0 });
  ring(frame, { ox: 8, radius: 3 + 8 * p, width: 2, squash: 0.5, bright: 0.7 * fade });
  if (f === 0) glint(frame, 8, 0, 3);
}

// =============================================================================
// 風切り: 飛ぶ風の刃
// =============================================================================

const GALE = {
  /** 刃の半径（px）。EXTRA.galeSlash.radius */
  radiusPx: 8,
  seed: SEED + 80,
};

function galeFly(frame, f) {
  const R = GALE.radiusPx * 2 + 4;
  // 前へ凸の三日月（外縁が刃）
  crescent(frame, { ox: -8, R, T: 7, head: 1.25, tail: -1.25, peak: 0.5, seed: GALE.seed, bright: 1, edge: 1.6, edgeReach: 1, streak: 0.5 });
  // 両端から巻き込む風の渦（端がくるりと巻く）
  for (const s of [-1, 1]) {
    const cx = -8 + Math.cos(1.25) * (R - 4);
    const cy = s * Math.sin(1.25) * (R - 4);
    const a0 = f * 0.9;
    for (let t = 0; t < 1; t += 0.06) {
      const a = a0 + s * t * 4.2;
      const r = 5 * (1 - t) + 1;
      dot(frame, cx - 4 + Math.cos(a) * r, cy + Math.sin(a) * r, t < 0.3 ? 6 : 4);
    }
  }
  // 後ろへ流れる風の筋（フレームでずれる）
  for (let i = 0; i < 5; i++) {
    const y = (i - 2) * 6;
    const off = ((f * 5 + i * 7) % 14) - 7;
    streakLine(frame, { ax: -40 + off, ay: y, bx: -14 + off - Math.abs(y) * 0.3, by: y * 0.9, bright: 0.55 - Math.abs(i - 2) * 0.1 });
  }
}

function galeCast(frame, f) {
  const frames = 6;
  const p = prog(f, frames);
  const erosion = smoothstep(0.3, 1, p);
  crescent(frame, { ox: -6, R: 18 + 16 * p, T: 6, head: 1.1, tail: -1.1, peak: 0.5, erosion, seed: GALE.seed + 1, bright: 0.95, edgeReach: 1 });
  for (let i = 0; i < 4; i++) {
    const y = (i - 1.5) * 7;
    streakLine(frame, { ax: 4 + p * 10, ay: y, bx: 22 + p * 26, by: y * 1.2, bright: 0.6 * (1 - p) });
  }
}

/** 敵弾を切った所: 小さな十字の斬線と風の粒 */
function galeCut(frame, f) {
  const frames = 5;
  const p = prog(f, frames);
  const erosion = smoothstep(0.3, 1, p);
  lens(frame, { ax: -8, ay: -8, bx: 8, by: 8, T: 4, erosion, seed: GALE.seed + 2, bright: 1 });
  lens(frame, { ax: -8, ay: 8, bx: 8, by: -8, T: 4, erosion, seed: GALE.seed + 3, bright: 1 });
  ring(frame, { radius: 3 + 8 * p, width: 1.5, bright: 0.6 * (1 - p) });
}

// =============================================================================
// 散弾符: 破れて弾ける紙の符
// =============================================================================

const SCATTER = {
  /** 扇の広がり（rad）。EXTRA.scatterSigil.fanRad */
  fanRad: 0.7,
  count: 7,
  seed: SEED + 100,
};

/** 紙の符（前に浮いた長方形。縁取りと墨の印） */
function talisman(frame, cx, v, torn) {
  const w = 6;
  const h = 11;
  paint(
    frame,
    (x, y) => {
      const dx = x - cx;
      if (Math.abs(dx) > w || Math.abs(y) > h) return -1;
      // 破れ: 中央から裂け目が広がる
      if (torn > 0 && Math.abs(y + Math.sin(dx * 1.3) * 1.5) < torn * h) return -1;
      if (Math.abs(dx) > w - 1.2 || Math.abs(y) > h - 1.2) return clamp01(0.95 * v);
      // 墨の印（縦の一画と横の二画、真ん中の丸）
      if (Math.abs(dx) < 0.8 && Math.abs(y) < h - 3) return 0.2;
      if (Math.abs(y + 4) < 0.7 && Math.abs(dx) < 3) return 0.2;
      if (Math.abs(y - 3) < 0.7 && Math.abs(dx) < 3) return 0.2;
      return clamp01(0.72 * v);
    },
    { bounds: { x0: cx - w - 1, y0: -h - 1, x1: cx + w + 1, y1: h + 1 }, dither: 0 },
  );
}

function scatterCast(frame, f) {
  const frames = 8;
  const p = prog(f, frames);
  const cx = 14;
  const half = SCATTER.fanRad;
  if (f < 2) talisman(frame, cx, f === 0 ? 0.8 : 1.05, 0);
  else if (f === 2) talisman(frame, cx, 1, 0.35);
  if (f === 1) glint(frame, cx, 0, 3);
  if (f >= 2) {
    const k = (f - 2) / (frames - 2);
    const fade = 1 - smoothstep(0.3, 1, k);
    // 扇の閃光（7 条）
    for (let i = 0; i < SCATTER.count; i++) {
      const a = (i / (SCATTER.count - 1) - 0.5) * 2 * half;
      const r0 = cx + 4 + k * 20;
      const r1 = cx + 14 + k * 50;
      streakLine(frame, { ax: Math.cos(a) * r0, ay: Math.sin(a) * r0, bx: Math.cos(a) * r1, by: Math.sin(a) * r1, bright: 0.95 * fade, width: i === 3 ? 2 : 1.5 });
    }
    // 扇の面（薄い）
    if (k < 0.5) {
      paint(
        frame,
        (x, y) => {
          const r = Math.hypot(x - 6, y);
          const a = Math.atan2(y, x - 6);
          if (Math.abs(a) > half || r < 10 || r > 16 + k * 40) return -1;
          if ((Math.floor(x) + Math.floor(y)) & 1) return -1;
          return 0.45 * (1 - k * 2);
        },
        { bounds: { x0: 0, y0: -50, x1: 70, y1: 50 }, dither: 0 },
      );
    }
    // 紙の切れ端が扇に散る
    shards(frame, f - 2, 12, SCATTER.seed + 1, (i, r) => {
      const a = (r(1) - 0.5) * 2 * half;
      const sp = 3 + 4 * r(2);
      return { x: cx, y: (r(3) - 0.5) * 14, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 4 + Math.floor(2 * r(4)), size: 2, drag: 0.8 };
    });
  }
}

function scatterPellet(frame, f) {
  disc(frame, 1, 0, 2.2, (d) => 1.05 - 0.4 * d, 0);
  streakLine(frame, { ax: -10, ay: 0, bx: -1, by: 0, bright: 0.6 });
  if (f === 0) dot(frame, 2, -1, 7);
}

// =============================================================================
// 震脚: 地割れと地面の波、跳ね上がる石礫
// =============================================================================

const STOMP = {
  /** 半径（px）。EXTRA.stomp.radius */
  radiusPx: 40,
  seed: SEED + 120,
};

function stompGround(frame, f) {
  const frames = 9;
  const p = prog(f, frames);
  const R = STOMP.radiusPx * 2;
  const reach = Math.min(1, p * 2.4);
  const lv = Math.round(6 - 3 * smoothstep(0.35, 1, p));
  // 足元の踏み跡の窪み
  ring(frame, { radius: 7, width: 2.5, squash: 1.3, bright: (lv - 1) / 7 });
  // 放射の地割れ
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * TAU + hash1(i, STOMP.seed) * 0.4;
    crack(frame, Math.cos(a) * 8, Math.sin(a) * 8, a, (R * 0.85) * reach * (0.55 + 0.45 * hash1(i, STOMP.seed + 1)), lv, STOMP.seed + 10 + i, i % 3 === 0 ? 1.6 : 1);
  }
  // 地面の波（同心円が二重に広がる）
  for (let k = 0; k < 2; k++) {
    const radius = R * (p * 1.25 - k * 0.28);
    if (radius < 6 || radius > R * 1.02) continue;
    wobbleRing(frame, { radius, width: 4 - k, wob: 2, lobes: 11, phase: k, seed: STOMP.seed + 30 + k, bright: 0.85 * (1 - radius / R * 0.5) * (1 - smoothstep(0.7, 1, p)), gap: 0.12 });
  }
}

function stompAir(frame, f) {
  const frames = 9;
  const p = prog(f, frames);
  const R = STOMP.radiusPx * 2;
  // 跳ね上がる石礫（放物線。画面の上へ）
  for (let i = 0; i < 16; i++) {
    const r = (k) => hash1(i * 9 + k, STOMP.seed + 50);
    const a = r(1) * TAU;
    const start = 10 + R * 0.6 * r(2);
    const t = p * (1.1 + 0.4 * r(3)) - r(4) * 0.2;
    if (t < 0 || t > 1) continue;
    const at = start + t * 18 * (0.5 + r(5));
    const h = Math.sin(Math.PI * t) * (10 + 16 * r(6));
    const x = Math.cos(a) * at;
    const y = Math.sin(a) * at * 0.8 - h;
    const lv = t < 0.6 ? 6 : 4;
    // 2x2 の石に暗い下面（跳ね上がった石礫）
    dot(frame, x, y, lv);
    dot(frame, x + 1, y, lv);
    dot(frame, x, y + 1, lv - 1);
    dot(frame, x + 1, y + 1, lv - 2);
    if (r(7) > 0.5) dot(frame, x + 2, y + 1, lv - 2);
  }
  if (f === 0) glint(frame, 0, 0, 4);
  else if (f === 1) glint(frame, 0, 0, 3);
}

// =============================================================================
// 手繰り糸: 糸巻き・糸・鉤
// =============================================================================

const THREAD = {
  /** 糸の区間の長さ（px） */
  stepPx: 10,
  seed: SEED + 140,
};

/** 糸巻き（輪と輻）。spin は回った角 */
function spool(frame, spin, v) {
  ring(frame, { radius: 7, width: 2, bright: 0.8 * v });
  ring(frame, { radius: 4, width: 2.5, bright: 0.55 * v });
  for (let i = 0; i < 3; i++) {
    const a = spin + (i * TAU) / 3;
    bar(frame, Math.cos(a) * 2, Math.sin(a) * 2, Math.cos(a) * 7, Math.sin(a) * 7, 1.2, 0.85 * v);
  }
  disc(frame, 0, 0, 1.5, 1, 0);
}

function threadSpool(frame, f) {
  spool(frame, f * 0.35, 0.85);
}

/** 糸を巻き取る: 糸巻きが速く回り、巻き込む弧の筋 */
function threadWind(frame, f) {
  const frames = 6;
  const p = prog(f, frames);
  spool(frame, -f * 1.1, 1);
  for (let i = 0; i < 3; i++) {
    const a0 = -f * 1.1 + (i * TAU) / 3;
    arcLine(frame, { radius: 11 + i, from: a0, to: a0 + 1.3, bright: 0.8 * (1 - p * 0.6) });
  }
}

/** たるんだ糸（beam の 1 区間）。区間の長さでちょうど 1 周の揺れにして、並べても切れ目が続く */
function threadLoose(frame, f) {
  const frames = 6;
  const half = THREAD.stepPx;
  const amp = 1.6;
  for (let x = -half; x < half; x += 0.5) {
    const y = Math.sin(((x + half) / (half * 2)) * TAU + f * 0.8) * amp;
    dot(frame, x, y, 5);
  }
  // 糸を走るきらめき
  const gx = -half + ((f + 0.5) / frames) * half * 2;
  dot(frame, gx, Math.sin(((gx + half) / (half * 2)) * TAU + f * 0.8) * amp, 7);
}

/** 張った糸（beam の 1 区間）: 真っ直ぐな糸と、手前（-x）へ流れる山形 */
function threadTaut(frame, f) {
  const frames = 6;
  const p = prog(f, frames);
  const half = THREAD.stepPx;
  bar(frame, -half - 0.5, 0, half + 0.5, 0, 1.5, 1 - p * 0.35);
  if (p > 0.85) return;
  const cx = half - ((f / frames) * half * 2) % (half * 2);
  streakLine(frame, { ax: cx + 4, ay: -3.5, bx: cx, by: 0, bright: 0.85 });
  streakLine(frame, { ax: cx + 4, ay: 3.5, bx: cx, by: 0, bright: 0.85 });
}

/** 糸の先の鉤（+x = 自分から照準へ）。細い軸と、手前へ返る二本の返し */
function threadHook(frame, f) {
  ring(frame, { radius: 3, width: 1.5, bright: 0.85 });
  for (const s of [-1, 1]) streakLine(frame, { ax: 2, ay: s * 1, bx: -5, by: s * 6, bright: 0.85 });
  if (f % 2 === 0) glint(frame, 1, 0, 2);
}

/** 巻き取りの瞬間の先端: 糸が弾けて、手前へ火花が流れる */
function threadSnap(frame, f) {
  const frames = 6;
  const p = prog(f, frames);
  disc(frame, 0, 0, 5 * (1 - p) + 1, (d) => clamp01((1 - 0.5 * d) * (1 - p)));
  shards(frame, f, 9, THREAD.seed + 2, (i, r) => ({ x: 0, y: (r(1) - 0.5) * 8, vx: -(3 + 4 * r(2)), vy: (r(3) - 0.5) * 3, life: 3 + Math.floor(3 * r(4)), size: r(5) > 0.5 ? 2 : 1 }));
  if (f === 0) glint(frame, 0, 0, 3);
}

// =============================================================================
// 墜星: 跳び上がり・落下点の輪と降る隕石・着弾
// =============================================================================

const METEOR = {
  /** 半径（px）。EXTRA.meteorDive.radius */
  radiusPx: 40,
  seed: SEED + 160,
};

function meteorLeap(frame, f) {
  const frames = 7;
  const p = prog(f, frames);
  const fade = 1 - smoothstep(0.3, 1, p);
  ring(frame, { radius: 6 + 16 * p, width: 3, squash: 1.8, bright: 0.8 * fade, erosion: p * 0.5, seed: METEOR.seed + 1 });
  // 上へ昇る筋（画面の上）
  for (let i = 0; i < 6; i++) {
    const x = (i - 2.5) * 5 + (hash1(i, METEOR.seed) - 0.5) * 3;
    const top = -20 - 50 * p - 16 * hash1(i, METEOR.seed + 2);
    streakLine(frame, { ax: x, ay: top + 26, bx: x * 0.6, by: top, bright: 0.85 * fade, width: i === 2 || i === 3 ? 2 : 1 });
  }
  shards(frame, f, 10, METEOR.seed + 3, (i, r) => ({ x: (r(1) - 0.5) * 16, y: 0, vx: (r(2) - 0.5) * 3, vy: -(3 + 4 * r(3)), life: 4 + Math.floor(2 * r(4)), size: 1, drag: 0.92 }));
}

/** 隕石の位置（進み t。左上の空から落下点へ、終わりほど速く） */
function meteorAt(t) {
  const e = Math.pow(t, 1.6);
  return { x: -80 * (1 - e), y: -170 * (1 - e) - 6 };
}

/** 落下点の照準（地面）: 縁の破線の輪が回り、内の輪が締まり、影が育つ。敵にも見える予告 */
function meteorMark(frame, f) {
  const frames = 10;
  const p = prog(f, frames);
  const R = METEOR.radiusPx * 2;
  paint(
    frame,
    (x, y) => {
      const r = Math.hypot(x, y);
      const a = Math.atan2(y, x);
      // 縁: 回る破線
      if (Math.abs(r - R) < 1.6) {
        const seg = Math.floor(((a + p * 1.5) / TAU + 1) * 20);
        return seg % 2 === 0 ? 0.95 : 0.55;
      }
      // 締まっていく内の輪
      const inner = R * (1 - p * 0.85);
      if (Math.abs(r - inner) < 1.2) return 0.8;
      // 落ちてくる影（間引いた暗い面）
      const shadow = 4 + 20 * p;
      if (r < shadow && ((Math.floor(x) + Math.floor(y)) & 1) === 0) return 0.25;
      return -1;
    },
    { bounds: { x0: -R - 3, y0: -R - 3, x1: R + 3, y1: R + 3 }, dither: 0 },
  );
  // 十字の目盛り
  for (let i = 0; i < 4; i++) {
    const a = (i * TAU) / 4;
    bar(frame, Math.cos(a) * (R - 8), Math.sin(a) * (R - 8), Math.cos(a) * (R + 5), Math.sin(a) * (R + 5), 1.5, 0.9);
  }
}

/** 降る隕石（空中）: 岩の芯を持つ火の玉と、空へ伸びる炎の尾 */
function meteorFall(frame, f) {
  const frames = 10;
  const t = prog(f, frames);
  const pos = meteorAt(t);
  const back = meteorAt(Math.max(0, t - 0.25));
  const dx = back.x - pos.x;
  const dy = back.y - pos.y;
  const len = Math.hypot(dx, dy) + 20;
  const ux = dx / Math.max(1, Math.hypot(dx, dy));
  const uy = dy / Math.max(1, Math.hypot(dx, dy));
  const rad = 9 + 5 * t;
  // 炎の尾: 後ろへ細る
  paint(
    frame,
    (x, y) => {
      const s = segment(x, y, pos.x, pos.y, pos.x + ux * len, pos.y + uy * len);
      const w = rad * (1 - s.t) * 1.05;
      if (s.d > w) return -1;
      const flick = valueNoise(x + f * 7, y - f * 11, 4, METEOR.seed + 7);
      return clamp01((0.95 - 0.7 * s.t) * (1 - 0.6 * (s.d / w)) + (flick - 0.5) * 0.3);
    },
    { bounds: { x0: Math.min(pos.x, pos.x + ux * len) - rad - 2, y0: Math.min(pos.y, pos.y + uy * len) - rad - 2, x1: Math.max(pos.x, pos.x + ux * len) + rad + 2, y1: Math.max(pos.y, pos.y + uy * len) + rad + 2 }, dither: 0.05 },
  );
  // 火の玉と岩の芯（芯は暗い斑）
  disc(frame, pos.x, pos.y, rad, (d, x, y) => {
    const rock = valueNoise(x, y, 3, METEOR.seed + 9);
    if (d < 0.55 && rock > 0.55) return 0.3;
    return clamp01(1.05 - 0.35 * d);
  });
  // 剥がれる火の粉
  for (let i = 0; i < 6; i++) {
    const k = hash1(i + f * 5, METEOR.seed + 11);
    dot(frame, pos.x + ux * (rad + 6 + 18 * k) + (hash1(i, METEOR.seed + 12) - 0.5) * 12, pos.y + uy * (rad + 6 + 18 * k), k > 0.5 ? 6 : 4);
  }
  if (f >= frames - 2) glint(frame, pos.x, pos.y, 3);
}

/** 着弾（空中）: 火球が膨らんで火柱になり、岩が飛ぶ、衝撃の輪 */
function meteorImpact(frame, f) {
  const frames = 9;
  const p = prog(f, frames);
  const R = METEOR.radiusPx * 2;
  const grow = Math.min(1, p * 2.5);
  const erosion = smoothstep(0.35, 1, p);
  const rad = 10 + R * 0.55 * grow;
  paint(
    frame,
    (x, y) => {
      // 火柱: 上へ伸びた楕円
      const yy = (y + rad * 0.35 * grow) / (1 + 0.5 * grow);
      const d = Math.hypot(x, yy) / rad;
      if (d > 1) return -1;
      const n = valueNoise(x, y, 7, METEOR.seed + 20);
      if (n - erosion * 1.1 + (1 - d) * 0.4 < 0) return -1;
      return clamp01((1.1 - 0.75 * d + (n - 0.5) * 0.6) * (1 - erosion * 0.55));
    },
    { bounds: { x0: -rad - 2, y0: -rad * 2 - 2, x1: rad + 2, y1: rad + 2 }, dither: 0.05 },
  );
  ring(frame, { radius: R * (0.35 + 0.75 * p), width: 3, squash: 1.25, bright: 0.85 * (1 - p), erosion: p * 0.6, seed: METEOR.seed + 21 });
  // 岩が放物線で飛ぶ
  for (let i = 0; i < 14; i++) {
    const r = (k) => hash1(i * 11 + k, METEOR.seed + 22);
    const a = r(1) * TAU;
    const t = p * (1 + 0.5 * r(2));
    if (t > 1) continue;
    const at = 10 + R * 0.9 * t * (0.5 + 0.5 * r(3));
    const h = Math.sin(Math.PI * t) * (14 + 20 * r(4));
    const x = Math.cos(a) * at;
    const y = Math.sin(a) * at * 0.8 - h;
    const lv = t < 0.5 ? 6 : 3;
    dot(frame, x, y, lv);
    dot(frame, x + 1, y, lv);
    dot(frame, x, y + 1, Math.max(2, lv - 2));
    dot(frame, x + 1, y + 1, Math.max(2, lv - 2));
  }
  if (f === 0) glint(frame, 0, 0, 4);
}

/** 着弾（地面）: 縁の盛り上がったクレーターと、赤熱した放射のひび */
function meteorCrater(frame, f) {
  const frames = 9;
  const p = prog(f, frames);
  const R = METEOR.radiusPx * 2;
  const lv = Math.round(6 - 4 * smoothstep(0.3, 1, p));
  if (lv < 2) return;
  ring(frame, { radius: R * 0.3, width: 4, squash: 1.2, bright: lv / 7, erosion: 0.15, seed: METEOR.seed + 30 });
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU + hash1(i, METEOR.seed + 31) * 0.3;
    crack(frame, Math.cos(a) * R * 0.32, Math.sin(a) * R * 0.3, a, R * (0.35 + 0.45 * hash1(i, METEOR.seed + 32)) * Math.min(1, p * 3), lv, METEOR.seed + 40 + i);
  }
  // 残り火
  for (let i = 0; i < 14; i++) {
    if (hash1(i + f * 3, METEOR.seed + 50) < p) continue;
    const a = hash1(i, METEOR.seed + 51) * TAU;
    const at = R * 0.8 * Math.sqrt(hash1(i, METEOR.seed + 52));
    dot(frame, Math.cos(a) * at, Math.sin(a) * at, 5);
  }
}

// =============================================================================
// 燕返し: 燕の速度線と、戻る燕の刃
// =============================================================================

const SWALLOW = { seed: SEED + 180 };

/** 燕の形（頭 = -x 向き。翼を後ろへ反らし、尾は二股）。(bx, 0) が胴の中心、k は大きさ */
function swallowShape(frame, bx, k, bright, erosion, seed) {
  // 胴
  lens(frame, { ax: bx - 12 * k, ay: 0, bx: bx + 8 * k, by: 0, T: 6 * k, bright, erosion, seed, bias: 0 });
  // 翼: 付け根から後ろ斜めへ反る刃
  for (const s of [-1, 1]) {
    lens(frame, { ax: bx - 4 * k, ay: s * 1 * k, bx: bx + 14 * k, by: s * 26 * k, T: 6 * k, bend: s * 5 * k, bright, erosion, seed: seed + (s > 0 ? 1 : 2), bias: s * 0.3 });
    // 二股の尾
    streakLine(frame, { ax: bx + 24 * k, ay: s * 9 * k, bx: bx + 6 * k, by: s * 1.5 * k, bright: bright * 0.9 * (1 - erosion), width: 1.5 });
  }
}

/** 跳んでいる間（active）: 前に翼の弧、後ろへ二股に開く燕の尾の速度線 */
function swallowDash(frame, f) {
  const frames = 6;
  for (const s of [-1, 1]) {
    lens(frame, { ax: 8, ay: s * 1, bx: -14, by: s * 20, T: 5, bend: -s * 4, bright: 0.95, seed: SWALLOW.seed + (s > 0 ? 3 : 4), bias: -s * 0.3 });
    const jitter = hash1(f * 3 + (s > 0 ? 1 : 0), SWALLOW.seed + 5) * 6;
    streakLine(frame, { ax: -64 - jitter, ay: s * 18, bx: -10, by: s * 3, bright: 0.85, width: 2 });
    streakLine(frame, { ax: -48 - jitter, ay: s * 10, bx: -12, by: s * 2, bright: 0.55 });
  }
  for (let i = 0; i < 3; i++) {
    const r = hash1(i + f * 7, SWALLOW.seed + 6);
    streakLine(frame, { ax: -40 - 20 * r, ay: (i - 1) * 4, bx: -14, by: (i - 1) * 3, bright: 0.45 });
  }
  void frames;
}

/** 着地（end。+x = 跳んだ向き）: 着地点の返しの V 字の閃きと、燕の形の刃が元の位置（-x）へ飛び戻る */
function swallowReturn(frame, f) {
  const frames = 8;
  const p = prog(f, frames);
  const erosion = smoothstep(0.5, 1, p);
  const bx = -p * 70;
  swallowShape(frame, bx, 0.9, 1.05, erosion, SWALLOW.seed + 10);
  if (p < 0.45) {
    const k = 1 - p / 0.45;
    for (const s of [-1, 1]) lens(frame, { ax: 2, ay: 0, bx: 14, by: s * 16, T: 5 * k + 1, bright: k, seed: SWALLOW.seed + 12, bias: 0 });
    if (f === 0) glint(frame, 0, 0, 4);
  }
  shards(frame, f, 8, SWALLOW.seed + 13, (i, r) => ({ x: bx + 8, y: (r(1) - 0.5) * 30, vx: 2 + 3 * r(2), vy: (r(3) - 0.5) * 4, life: 3 + Math.floor(2 * r(4)), size: r(5) > 0.5 ? 2 : 1 }));
}

/** 往復の道筋（beam の 1 区間）: 二本の細い斬線（行きと帰り） */
const SWALLOW_STEP_PX = 12;
function swallowTrail(frame, f) {
  const frames = 8;
  const p = prog(f, frames);
  const half = SWALLOW_STEP_PX + 0.6;
  const gap = 1.8 + p * 1.5;
  for (const s of [-1, 1]) {
    const w = (s < 0 ? 2.4 : 1.6) * (1 - p) + 0.5;
    paint(
      frame,
      (x, y) => {
        if (Math.abs(x) > half) return -1;
        const d = Math.abs(y - s * gap) / w;
        if (d > 1) return -1;
        return clamp01((1.05 - 0.6 * d) * (1 - 0.6 * p));
      },
      { bounds: { x0: -half - 1, y0: s * gap - w - 2, x1: half + 1, y1: s * gap + w + 2 }, dither: 0 },
    );
  }
}

// =============================================================================
// 巻き戻し: 逆回りする時計
// =============================================================================

const BACK = { seed: SEED + 200, stepPx: 12 };

/** 時計の文字盤: 輪と 12 の目盛り、長針と短針（逆回り） */
function clock(frame, radius, turn, v) {
  ring(frame, { radius, width: 2, bright: 0.85 * v });
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU;
    const inner = radius - (i % 3 === 0 ? 5 : 3);
    bar(frame, Math.cos(a) * inner, Math.sin(a) * inner, Math.cos(a) * (radius - 1.5), Math.sin(a) * (radius - 1.5), 1, 0.7 * v);
  }
  const long = -Math.PI / 2 - turn * TAU;
  const short = -Math.PI / 2 - turn * TAU * 0.25;
  bar(frame, 0, 0, Math.cos(long) * (radius - 4), Math.sin(long) * (radius - 4), 1.4, v);
  bar(frame, 0, 0, Math.cos(short) * (radius * 0.55), Math.sin(short) * (radius * 0.55), 2, 0.85 * v);
  disc(frame, 0, 0, 1.6, v, 0);
}

/** 元の位置（cast）: 逆回りの時計が現れて速く巻き戻り、周りの粒が逆向きの渦で吸われて消える */
function backflowFade(frame, f) {
  const frames = 8;
  const p = prog(f, frames);
  const v = 1 - smoothstep(0.5, 1, p);
  clock(frame, 18, p * 1.5, v);
  arcLine(frame, { radius: 24, from: -Math.PI / 2 - p * 6 - 1.6, to: -Math.PI / 2 - p * 6, bright: 0.7 * v, width: 2 });
  for (let i = 0; i < 10; i++) {
    const r = (k) => hash1(i * 5 + k, BACK.seed);
    const a = r(1) * TAU - p * 3;
    const at = (30 + 10 * r(2)) * (1 - p);
    if (at < 3) continue;
    dot(frame, Math.cos(a) * at, Math.sin(a) * at, 6);
  }
}

/** 戻る道（beam の 1 区間）: 細い二本線と、戻る向き（+x）を指す早戻しの山形 */
function backflowTrail(frame, f) {
  const frames = 8;
  const p = prog(f, frames);
  const half = BACK.stepPx;
  const v = 1 - p * 0.7;
  bar(frame, -half - 0.5, -3, half + 0.5, -3, 1, 0.55 * v);
  bar(frame, -half - 0.5, 3, half + 0.5, 3, 1, 0.55 * v);
  if (p > 0.8) return;
  const cx = -half + ((f / frames) * half * 2 + half) % (half * 2);
  for (const off of [0, 4]) {
    streakLine(frame, { ax: cx - off - 4, ay: -4, bx: cx - off, by: 0, bright: 0.9 * v });
    streakLine(frame, { ax: cx - off - 4, ay: 4, bx: cx - off, by: 0, bright: 0.9 * v });
  }
}

/** 着いた所（tip）: 時計の輪が縮んで閉じ、閃く */
function backflowArrive(frame, f) {
  const frames = 8;
  const p = prog(f, frames);
  const radius = 22 - 14 * smoothstep(0, 0.7, p);
  ring(frame, { radius, width: 2, bright: 0.85 * (1 - smoothstep(0.6, 1, p)) });
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU - p * 2;
    bar(frame, Math.cos(a) * (radius + 2), Math.sin(a) * (radius + 2), Math.cos(a) * (radius + 4), Math.sin(a) * (radius + 4), 1, 0.7 * (1 - p));
  }
  if (p > 0.55 && p < 0.85) glint(frame, 0, 0, 3);
}

// =============================================================================
// 傷返し: 咆哮の音の波と爪痕
// =============================================================================

const SCAR = {
  /** 半径（px）。EXTRA.scarRoar.radius */
  radiusPx: 56,
  seed: SEED + 220,
};

function scarRoar(frame, f) {
  const frames = 9;
  const p = prog(f, frames);
  const R = SCAR.radiusPx * 2;
  // 三重の音の波（揺れる輪）
  for (let k = 0; k < 3; k++) {
    const radius = R * (p * 1.3 - k * 0.2);
    if (radius < 8 || radius > R * 1.05) continue;
    wobbleRing(frame, { radius, width: 5 - k * 1.2, wob: 3, lobes: 9, phase: k * 1.3 + f * 0.4, seed: SCAR.seed + k, bright: (0.95 - k * 0.15) * (1 - smoothstep(0.75, 1.05, radius / R)), jitter: 2 });
  }
  // 爪痕: 3 本の平行な傷が外へ飛ぶ
  const fade = 1 - smoothstep(0.55, 1, p);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + 0.3;
    const at = R * (0.18 + 0.62 * p);
    const cx = Math.cos(a) * at;
    const cy = Math.sin(a) * at;
    const tx = -Math.sin(a);
    const ty = Math.cos(a);
    for (let j = -1; j <= 1; j++) {
      const ox = cx + tx * j * 4;
      const oy = cy + ty * j * 4;
      lens(frame, { ax: ox - Math.cos(a) * 7 - tx * 2, ay: oy - Math.sin(a) * 7 - ty * 2, bx: ox + Math.cos(a) * 7 + tx * 2, by: oy + Math.sin(a) * 7 + ty * 2, T: 3, bright: fade, seed: SCAR.seed + 10 + i, bias: 0 });
    }
  }
  if (f === 0) glint(frame, 0, 0, 4);
  else if (f === 1) glint(frame, 0, 0, 3);
}

function scarGround(frame, f) {
  const frames = 9;
  const p = prog(f, frames);
  const R = SCAR.radiusPx * 2;
  const radius = R * Math.min(1, p * 1.4);
  ring(frame, { radius, width: 3, bright: 0.55 * (1 - smoothstep(0.5, 1, p)), erosion: 0.2 + p * 0.5, seed: SCAR.seed + 30 });
}

// =============================================================================
// 爆薬樽: 樽と導火線・範囲の点線・爆発
// =============================================================================

const KEG = {
  /** 爆発の半径（px）。EXTRA.powderKeg.radius */
  radiusPx: 40,
  seed: SEED + 240,
};

/** 樽（胴の膨らみ・樽板の筋・二本の箍・蓋）。底が y = 6 */
function barrel(frame) {
  const top = -12;
  const bottom = 6;
  const yc = (top + bottom) / 2;
  const hh = (bottom - top) / 2;
  paint(
    frame,
    (x, y) => {
      if (y < top || y > bottom) return -1;
      const w = 6.5 + 1.8 * Math.cos(((y - yc) / hh) * (Math.PI / 2));
      if (Math.abs(x) > w) return -1;
      // 箍
      if (Math.abs(y - (top + 3.5)) < 1 || Math.abs(y - (bottom - 3.5)) < 1) return Math.abs(x) > w - 1 ? 0.55 : 0.7;
      if (Math.abs(x) > w - 1) return 0.18;
      // 樽板の筋
      const u = (x / w + 1) * 2.5;
      if (Math.abs(u - Math.round(u)) < 0.12) return 0.22;
      // 左上から光が当たる
      return clamp01(0.42 - (x / w) * 0.12);
    },
    { bounds: { x0: -10, y0: top - 1, x1: 10, y1: bottom + 1 }, dither: 0.03 },
  );
  // 蓋（上から見える楕円）
  paint(
    frame,
    (x, y) => {
      const d = Math.hypot(x / 6.5, (y - top) / 2.4);
      if (d > 1) return -1;
      return d > 0.7 ? 0.62 : 0.36;
    },
    { bounds: { x0: -8, y0: top - 3, x1: 8, y1: top + 3 }, dither: 0 },
  );
}

function kegBarrel(frame, f) {
  barrel(frame);
  // 導火線（蓋から上へ曲がる）と、先で爆ぜる火花
  const pts = [
    [1.5, -12.5],
    [3, -16],
    [2.5, -19],
    [4.5, -21.5],
  ];
  for (let i = 0; i < pts.length - 1; i++) bar(frame, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], 1, 0.3);
  const tip = pts[pts.length - 1];
  glint(frame, tip[0], tip[1], f % 2 === 0 ? 2 : 1);
  for (let i = 0; i < 3; i++) {
    const a = hash1(i + f * 3, KEG.seed) * TAU;
    const r = 2 + 3 * hash1(i + f * 5, KEG.seed + 1);
    dot(frame, tip[0] + Math.cos(a) * r, tip[1] + Math.sin(a) * r - 1, 6);
  }
}

/** 床の爆発範囲: 回る点線の輪と、四方の危険の刻み */
function kegRange(frame, f) {
  const R = KEG.radiusPx * 2;
  const n = 56;
  for (let i = 0; i < n; i++) {
    if ((i + f) % 4 >= 2) continue;
    const a = (i / n) * TAU;
    dot(frame, Math.cos(a) * R, Math.sin(a) * R, 3);
    dot(frame, Math.cos(a) * (R - 0.8), Math.sin(a) * (R - 0.8), 3);
  }
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + Math.PI / 4;
    bar(frame, Math.cos(a) * (R - 5), Math.sin(a) * (R - 5), Math.cos(a) * (R + 1), Math.sin(a) * (R + 1), 1.5, f % 4 < 2 ? 0.6 : 0.45);
  }
}

/** 爆発（空中）: 火球 → 煙、樽板と箍の欠片が飛ぶ、衝撃の輪 */
function kegBlast(frame, f) {
  const frames = 10;
  const p = prog(f, frames);
  const R = KEG.radiusPx * 2;
  const grow = 1 - Math.pow(1 - Math.min(1, p * 2.6), 2);
  const erosion = smoothstep(0.3, 1, p);
  const rad = 8 + R * 0.75 * grow;
  paint(
    frame,
    (x, y) => {
      const d = Math.hypot(x, y) / rad;
      if (d > 1) return -1;
      const n = valueNoise(x + f * 3, y - f * 5, 8, KEG.seed + 2) * 0.7 + valueNoise(x, y, 3, KEG.seed + 3) * 0.3;
      if (n - erosion * 1.05 + (1 - d) * 0.35 < 0.05) return -1;
      // 芯は白く、縁と後半は煙（暗い段）
      const hot = (1.1 - 0.8 * d + (n - 0.5) * 0.6) * (1 - erosion);
      const smoke = 0.22 + 0.1 * n;
      return clamp01(Math.max(hot, smoke));
    },
    { bounds: { x0: -rad - 2, y0: -rad - 2, x1: rad + 2, y1: rad + 2 }, dither: 0.05 },
  );
  ring(frame, { radius: R * (0.3 + 0.8 * p), width: 3, bright: 0.85 * (1 - p), erosion: p * 0.5, seed: KEG.seed + 4 });
  // 樽板（細長い板が回りながら飛ぶ）
  for (let i = 0; i < 8; i++) {
    const r = (k) => hash1(i * 13 + k, KEG.seed + 5);
    const a = r(1) * TAU;
    const t = p * (1 + 0.3 * r(2));
    if (t > 1) continue;
    const at = 6 + R * 0.95 * t * (0.6 + 0.4 * r(3));
    const h = Math.sin(Math.PI * t) * (8 + 14 * r(4));
    const x = Math.cos(a) * at;
    const y = Math.sin(a) * at * 0.8 - h;
    const spin = a + t * 7 * (r(5) > 0.5 ? 1 : -1);
    bar(frame, x - Math.cos(spin) * 3.5, y - Math.sin(spin) * 3.5, x + Math.cos(spin) * 3.5, y + Math.sin(spin) * 3.5, 2, t < 0.6 ? 0.5 : 0.35);
  }
  // 箍の欠片（弧）
  for (let i = 0; i < 2; i++) {
    const a = (i + 0.3) * Math.PI + p;
    const at = R * 0.6 * p;
    arcLine(frame, { ox: Math.cos(a) * at, oy: Math.sin(a) * at, radius: 5, from: a + p * 4, to: a + p * 4 + 1.8, bright: 0.75 * (1 - p), width: 1.5 });
  }
  if (f === 0) glint(frame, 0, 0, 4);
}

/** 爆発（地面）: 焦げ跡と残り火 */
function kegScorch(frame, f) {
  const frames = 10;
  const p = prog(f, frames);
  const R = KEG.radiusPx * 2;
  const fade = 1 - smoothstep(0.4, 1, p);
  paint(
    frame,
    (x, y) => {
      const r = Math.hypot(x, y);
      if (r > R * 0.7) return -1;
      if ((Math.floor(x) + Math.floor(y)) & 1) return -1;
      const n = valueNoise(x, y, 6, KEG.seed + 8);
      if (n < 0.35 + p * 0.4) return -1;
      return 0.18 * fade + 0.02;
    },
    { bounds: { x0: -R, y0: -R, x1: R, y1: R }, dither: 0 },
  );
  for (let i = 0; i < 12; i++) {
    if (hash1(i + f * 7, KEG.seed + 9) < p * 0.9) continue;
    const a = hash1(i, KEG.seed + 10) * TAU;
    const at = R * 0.7 * Math.sqrt(hash1(i, KEG.seed + 11));
    dot(frame, Math.cos(a) * at, Math.sin(a) * at, 5);
  }
}

// =============================================================================
// 剣の墓標: 突き立つ剣・刻印の輪・回転斬り
// =============================================================================

const GRAVE = {
  /** 回転斬りの半径（px）。EXTRA.swordGrave.radius */
  radiusPx: 28,
  seed: SEED + 260,
};

/** 地面に刺さった剣（柄が上）。oy は全体を上下にずらす（落ちてくる途中） */
function graveSwordShape(frame, oy, v, glintY) {
  // 刀身: 地面（y = 2）から鍔（y = -24）まで。左が明るく、中央の鎬が白い
  poly(frame, [
    [-2.2, -24 + oy],
    [2.2, -24 + oy],
    [2.2, 1 + oy],
    [0, 3 + oy],
    [-2.2, 1 + oy],
  ], (x) => clamp01((Math.abs(x) < 0.6 ? 0.95 : x < 0 ? 0.72 : 0.45) * v));
  // 鍔
  poly(frame, [
    [-9, -26.5 + oy],
    [9, -26.5 + oy],
    [8, -24 + oy],
    [-8, -24 + oy],
  ], (x) => clamp01((Math.abs(x) > 7 ? 0.7 : 0.5) * v));
  // 柄（巻きの縞）と柄頭
  poly(frame, [
    [-1.6, -35 + oy],
    [1.6, -35 + oy],
    [1.6, -26.5 + oy],
    [-1.6, -26.5 + oy],
  ], (x, y) => clamp01((Math.floor(y) % 2 === 0 ? 0.35 : 0.22) * v));
  disc(frame, 0, -37.5 + oy, 2.4, (d) => clamp01((0.75 - 0.3 * d) * v), 0);
  if (glintY !== undefined) glint(frame, -0.5, glintY + oy, 2);
}

const GRAVE_FRAMES = 8;

function graveSword(frame, f) {
  // 小さな土の盛り上がり
  ring(frame, { oy: 2, radius: 5, width: 2, squash: 1.8, bright: 0.3 });
  const gy = -22 + (f / GRAVE_FRAMES) * 26;
  graveSwordShape(frame, 0, 1, f < 6 ? gy : undefined);
}

/** 墓標の床: 刺さった所のひびと、回転斬りの届く所を示す刻印の輪（淡く脈打つ） */
function graveGround(frame, f) {
  const R = GRAVE.radiusPx * 2;
  const pulse = 0.5 + 0.5 * Math.sin((f / GRAVE_FRAMES) * TAU);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU + 0.4;
    crack(frame, 0, 2, a, 7 + 5 * hash1(i, GRAVE.seed), 3, GRAVE.seed + i);
  }
  const n = 44;
  for (let i = 0; i < n; i++) {
    if (i % 2) continue;
    const a = (i / n) * TAU;
    const lv = 3 + Math.round(pulse);
    dot(frame, Math.cos(a) * R, Math.sin(a) * R, lv);
    dot(frame, Math.cos(a + 0.04) * R, Math.sin(a + 0.04) * R, lv);
  }
  // 墓標の刻印（小さな十字を 6 つ）
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU - Math.PI / 2;
    const x = Math.cos(a) * R;
    const y = Math.sin(a) * R;
    const lv = (3 + pulse) / 7;
    bar(frame, x, y - 3, x, y + 3, 1, lv);
    bar(frame, x - 2, y - 1, x + 2, y - 1, 1, lv);
  }
}

/** 刺す（cast）: 剣が空から落ちて突き立ち、土煙の輪とひび */
function graveStab(frame, f) {
  const frames = 7;
  const p = prog(f, frames);
  if (f < 2) {
    const oy = -60 * (1 - (f + 1) / 2.4);
    graveSwordShape(frame, oy, 0.9);
    streakLine(frame, { ax: 0, ay: oy - 70, bx: 0, by: oy - 40, bright: 0.7 });
    return;
  }
  const k = (f - 2) / (frames - 2);
  ring(frame, { oy: 2, radius: 6 + 22 * k, width: 3, squash: 1.8, bright: 0.8 * (1 - k), erosion: k * 0.5, seed: GRAVE.seed + 10 });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + 0.2;
    crack(frame, 0, 2, a, 8 + 14 * Math.min(1, k * 2), Math.round(6 - 3 * k), GRAVE.seed + 20 + i);
  }
  shards(frame, f - 2, 10, GRAVE.seed + 11, (i, r) => ({ x: (r(1) - 0.5) * 6, y: 2, vx: (r(2) - 0.5) * 6, vy: -(2 + 4 * r(3)), life: 3 + Math.floor(2 * r(4)), size: 2 }));
  if (f === 2) glint(frame, 0, 0, 4);
  void p;
}

/** 回転斬り（act）: 剣を軸に一周の斬撃と、回る剣の影 */
function graveSpin(frame, f) {
  const frames = 8;
  const p = prog(f, frames);
  const R = GRAVE.radiusPx * 2;
  const head = -Math.PI / 2 + p * TAU * 1.3;
  const trail = Math.min(TAU * 0.8, p * TAU * 1.3 + 0.3);
  const erosion = smoothstep(0.6, 1, p) * 0.9;
  crescent(frame, { R, T: 12, head, tail: head - trail, peak: 0.08, erosion, seed: GRAVE.seed + 30, streak: 0.5, edge: 2, edgeReach: 0.45 });
  // 回る剣の影（3 本の刃）
  for (let i = 0; i < 3; i++) {
    const a = head - 0.4 - i * ((TAU / 3) * 0.5);
    lens(frame, { ax: Math.cos(a) * 8, ay: Math.sin(a) * 8, bx: Math.cos(a) * (R - 8), by: Math.sin(a) * (R - 8), T: 4, bright: 0.7 * (1 - erosion), seed: GRAVE.seed + 31 + i, bias: 0 });
  }
  arcLine(frame, { radius: R + 4, from: head - 1.4, to: head - 0.2, bright: 0.6 * (1 - erosion), width: 1 });
}

// =============================================================================
// 骨片の輪
// =============================================================================

const BONE = {
  /** 回る半径（px）。EXTRA.boneRing.orbit */
  orbitPx: 16,
  /** 回る速さ（rad/秒）。EXTRA.boneRing.spin */
  spin: 3,
  seed: SEED + 280,
};

/** 骨 1 本（軸と、両端の二つ瘤）。a は向き */
function bone(frame, cx, cy, a, k, v) {
  const L = 5 * k;
  const ux = Math.cos(a);
  const uy = Math.sin(a);
  const nx = -uy;
  const ny = ux;
  bar(frame, cx - ux * L, cy - uy * L, cx + ux * L, cy + uy * L, 2.2 * k, 0.75 * v);
  for (const e of [-1, 1]) {
    for (const s of [-1, 1]) disc(frame, cx + ux * e * L + nx * s * 1.3 * k, cy + uy * e * L + ny * s * 1.3 * k, 1.7 * k, (d) => clamp01((0.95 - 0.35 * d) * v), 0);
  }
}

const BONE_FRAMES = 8;

/** 骨片 1 本（骨の位置ごとに置く）: くるくると回る */
function boneShard(frame, f) {
  bone(frame, 0, 0, (f / BONE_FRAMES) * Math.PI, 1, 1);
}

/** 纏いの地面: 骨の通り道の点線の輪（回る） */
function boneOrbit(frame, f) {
  const R = BONE.orbitPx * 2;
  const n = 36;
  const turn = (f / BONE_FRAMES) * TAU;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + turn;
    if (i % 3 === 2) continue;
    // 2 ドットの短い破線（孤立した暗い点は掃除で消えるので対にする）
    const lv = i % 3 === 0 ? 4 : 3;
    dot(frame, Math.cos(a) * R, Math.sin(a) * R, lv);
    dot(frame, Math.cos(a + 0.05) * R, Math.sin(a + 0.05) * R, lv);
  }
}

/** 纏いの空中: 輪の上を漂う骨の粉 */
function boneDust(frame, f) {
  const R = BONE.orbitPx * 2;
  const turn = (f / BONE_FRAMES) * TAU;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + turn + hash1(i, BONE.seed) * 0.5;
    const r = R + (hash1(i, BONE.seed + 1) - 0.5) * 6;
    dot(frame, Math.cos(a) * r, Math.sin(a) * r - 1, 5);
  }
}

/** 湧く（cast）: 骨片が渦を巻いて自分から外へ広がり、輪に収まる */
function boneRise(frame, f) {
  const frames = 8;
  const p = prog(f, frames);
  const R = BONE.orbitPx * 2;
  const e = 1 - Math.pow(1 - p, 2);
  for (let i = 0; i < 3; i++) {
    const a = (i * TAU) / 3 + p * 3;
    bone(frame, Math.cos(a) * R * e, Math.sin(a) * R * e, a + p * 6, 0.7 + 0.3 * e, 1);
    arcLine(frame, { radius: R * e, from: a - 1.2, to: a - 0.2, bright: 0.6 * (1 - p), width: 1.5 });
  }
  ring(frame, { radius: 6 + R * p, width: 2, bright: 0.55 * (1 - p), erosion: 0.3, seed: BONE.seed + 3 });
}

/** 敵弾を止めて砕ける（act）: 骨が二つに折れ、破片が散る */
function boneBreak(frame, f) {
  const frames = 6;
  const p = prog(f, frames);
  const sep = 2 + 6 * p;
  const v = 1 - smoothstep(0.5, 1, p);
  bar(frame, -sep - 4, -p * 3, -sep, 0, 2, 0.75 * v);
  disc(frame, -sep - 4, -p * 3, 1.8, 0.9 * v, 0);
  bar(frame, sep, 0, sep + 4, p * 3, 2, 0.75 * v);
  disc(frame, sep + 4, p * 3, 1.8, 0.9 * v, 0);
  shards(frame, f, 8, BONE.seed + 5, (i, r) => {
    const a = r(1) * TAU;
    return { x: 0, y: 0, vx: Math.cos(a) * (2 + 3 * r(2)), vy: Math.sin(a) * (2 + 3 * r(2)), life: 3 + Math.floor(3 * r(3)), size: 1 };
  });
  if (f === 0) glint(frame, 0, 0, 3);
}

// =============================================================================
// 湧き石: 石の泉
// =============================================================================

const SPRING = {
  /** 半径（px）。EXTRA.manaSpring.radius */
  radiusPx: 40,
  seed: SEED + 300,
};

/** 泉の中の石（丸い岩と上の光、小さな結晶の閃き） */
function springStone(frame, v) {
  disc(frame, 0, 0, 7, (d, x, y) => {
    if (y < -2 && x < 1) return clamp01(0.62 * v);
    return clamp01((0.42 - 0.12 * d) * v);
  }, 0.03);
  bar(frame, -1, -1, 2, 3, 1, 0.2);
  ring(frame, { radius: 10.5, width: 1.6, squash: 1.3, bright: 0.7 * v });
}

const SPRING_FRAMES = 8;

function springGround(frame, f) {
  const R = SPRING.radiusPx * 2;
  // 縁: 破線の輪
  const n = 60;
  for (let i = 0; i < n; i++) {
    if (i % 3 === 2) continue;
    const a = (i / n) * TAU;
    dot(frame, Math.cos(a) * R, Math.sin(a) * R, 4);
    dot(frame, Math.cos(a) * (R - 1), Math.sin(a) * (R - 1), 3);
  }
  // 広がる波紋（周期で外へ 1 巡）
  for (let k = 0; k < 3; k++) {
    const t = (f / SPRING_FRAMES + k / 3) % 1;
    const radius = 12 + (R - 14) * t;
    ring(frame, { radius, width: 1.6, bright: 0.62 * (1 - t * 0.7), erosion: 0.25 + t * 0.4, seed: SPRING.seed + k + f * 3 });
  }
  springStone(frame, 1);
}

/** 立ち昇る気力の泡と閃き */
function springRise(frame, f) {
  const R = SPRING.radiusPx * 2;
  for (let i = 0; i < 12; i++) {
    const r = (k) => hash1(i * 7 + k, SPRING.seed + 10);
    const a = r(1) * TAU;
    const at = i < 4 ? 4 * r(2) : R * 0.8 * Math.sqrt(r(2));
    const phase = (f / SPRING_FRAMES + r(3)) % 1;
    if (phase > 0.85) continue;
    const x = Math.cos(a) * at + Math.sin(phase * TAU + i) * 1.5;
    const y = Math.sin(a) * at - phase * 24 - (i < 4 ? 6 : 0);
    if (i % 3 === 0) stamp(frame, x, y, [".5.", "5.5", ".5."]);
    else dot(frame, x, y, phase < 0.5 ? 7 : 5);
  }
}

/** 湧き出す（cast）: 石から水が噴き上がって放物線で落ち、波紋が縁まで広がる */
function springBurst(frame, f) {
  const frames = 8;
  const p = prog(f, frames);
  const R = SPRING.radiusPx * 2;
  if (p < 0.5) lens(frame, { ax: 0, ay: 2, bx: 0, by: -30 - 20 * p, T: 8 * (1 - p), bright: 1, bias: 0 });
  for (let i = 0; i < 16; i++) {
    const r = (k) => hash1(i * 5 + k, SPRING.seed + 20);
    const a = r(1) * TAU;
    const t = p * (1 + 0.3 * r(2));
    if (t > 1) continue;
    const at = R * 0.5 * t * (0.4 + 0.6 * r(3));
    const h = Math.sin(Math.PI * t) * (24 + 20 * r(4));
    dot(frame, Math.cos(a) * at, Math.sin(a) * at * 0.8 - h, t < 0.6 ? 7 : 5);
  }
  ring(frame, { radius: 10 + (R - 10) * p, width: 2, bright: 0.8 * (1 - p * 0.6), erosion: p * 0.4, seed: SPRING.seed + 21 });
  springStone(frame, Math.min(1, p * 3));
}

/** 気力を吸う（act。自分の位置）: 周りの滴が集まり、芯で閃く */
function springDrink(frame, f) {
  const frames = 6;
  const p = prog(f, frames);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU + hash1(i, SPRING.seed + 30) * 0.5;
    const at = 22 * (1 - p) + 2;
    dot(frame, Math.cos(a) * at, Math.sin(a) * at, 6);
    dot(frame, Math.cos(a) * (at + 2), Math.sin(a) * (at + 2), 4);
  }
  if (p > 0.6) glint(frame, 0, 0, 3);
}

// =============================================================================
// 砲台
// =============================================================================

const TURRET = { seed: SEED + 320 };
const TURRET_FRAMES = 8;

/** 台座（八角の板と脚・ボルト）と丸い砲塔、aim の向きの砲身 */
function turretShape(frame, aim, v, legs = 1) {
  // 3 本の脚（左下・右下・奥）
  for (const a of [Math.PI * 0.8, Math.PI * 0.2, -Math.PI / 2]) {
    bar(frame, 0, 1, Math.cos(a) * 13 * legs, Math.sin(a) * 9 * legs + 1, 2, 0.35 * v);
    dot(frame, Math.cos(a) * 13 * legs, Math.sin(a) * 9 * legs + 1, 4);
  }
  // 台座の板（上から見た平たい楕円。縁が明るい）
  paint(
    frame,
    (x, y) => {
      const r = Math.hypot(x / 9, (y - 1) / 6.5);
      if (r > 1) return -1;
      return clamp01((r > 0.8 ? 0.45 : 0.26) * v);
    },
    { bounds: { x0: -10, y0: -7, x1: 10, y1: 9 }, dither: 0 },
  );
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * TAU - Math.PI / 2;
    dot(frame, Math.cos(a) * 7, Math.sin(a) * 5.6, 5);
  }
  // 砲身（砲塔の下から伸びる）
  const ux = Math.cos(aim);
  const uy = Math.sin(aim);
  bar(frame, ux * 2, uy * 2 - 2, ux * 12, uy * 12 - 2, 3, 0.55 * v);
  bar(frame, ux * 11, uy * 11 - 2, ux * 12.5, uy * 12.5 - 2, 3.6, 0.72 * v);
  // 砲塔（上から光）
  disc(frame, 0, -2, 5, (d, x, y) => clamp01((y < -3.5 && x < 0.5 ? 0.78 : 0.5 - 0.1 * d) * v), 0.03);
}

/** 置いてある砲台: 砲身がゆっくり見回し、上の灯が瞬く */
function turretBody(frame, f) {
  const aim = -Math.PI / 4 + Math.sin((f / TURRET_FRAMES) * TAU) * 0.9;
  turretShape(frame, aim, 1);
  if (f % 4 === 0) glint(frame, 0, -4, 2);
  else dot(frame, 0, -4, 6);
}

/** 組み上がる（cast）: 着地の土煙と、脚が開いて締まる火花 */
function turretDeploy(frame, f) {
  const frames = 7;
  const p = prog(f, frames);
  turretShape(frame, -Math.PI / 4, Math.min(1, 0.6 + p), Math.min(1, p * 1.6));
  ring(frame, { oy: 2, radius: 8 + 16 * p, width: 2.5, squash: 1.7, bright: 0.7 * (1 - p), erosion: p * 0.5, seed: TURRET.seed + 1 });
  if (p > 0.45 && p < 0.75) {
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * TAU + Math.PI / 2;
      glint(frame, Math.cos(a) * 12, Math.sin(a) * 10 + 2, 2);
    }
  }
}

/** 砲口の閃光（act。+x = 撃つ向き）: 閃光の舌と煙の輪 */
function turretFire(frame, f) {
  const frames = 5;
  const p = prog(f, frames);
  const fade = 1 - smoothstep(0.2, 1, p);
  lens(frame, { ax: 12, ay: 0, bx: 12 + 16 * (1 - p * 0.4), by: 0, T: 9 * fade + 1, bright: fade * 1.05, bias: 0 });
  ring(frame, { ox: 14 + p * 6, radius: 3 + 7 * p, width: 2, squash: 0.6, bright: 0.6 * fade });
  if (f === 0) glint(frame, 13, 0, 3);
}

/** 曳光弾: 明るい弾頭と長い尾 */
function turretShell(frame, f) {
  bar(frame, -1, 0, 3, 0, 3, 1);
  streakLine(frame, { ax: -22, ay: 0, bx: -1, by: 0, bright: 0.7, width: 1.5 });
  if (f === 0) dot(frame, 3, 0, 7);
}

// =============================================================================
// 表
// =============================================================================

const size = (radiusPx, pad) => Math.ceil(radiusPx * 2 + pad) * 2;

const FX = {
  skills: {
    comboChain: {
      ramp: "steel",
      act: { sheet: "skillExtraB.comboThrust", life: 0.2 },
    },
    grudge: {
      ramp: "dark",
      cast: { sheet: "skillExtraB.grudgeWave", life: 0.42, base: GRUDGE.radiusPx, ground: "skillExtraB.grudgeGround" },
    },
    backflow: {
      ramp: "steel",
      // cast: pos = 元いた所、to = 戻った先
      cast: { sheet: "skillExtraB.backflowFade", life: 0.4, beam: { sheet: "skillExtraB.backflowTrail", step: BACK.stepPx }, tip: "skillExtraB.backflowArrive" },
    },
    scarRoar: {
      ramp: "dark",
      cast: { sheet: "skillExtraB.scarRoar", life: 0.45, base: SCAR.radiusPx, ground: "skillExtraB.scarGround" },
    },
    powderKeg: {
      ramp: "fire",
      placed: { sheet: "skillExtraB.kegBarrel", base: KEG.radiusPx, period: 0.5, ground: "skillExtraB.kegRange" },
      end: { sheet: "skillExtraB.kegBlast", life: 0.5, base: KEG.radiusPx, ground: "skillExtraB.kegScorch" },
    },
    swordGrave: {
      ramp: "steel",
      cast: { sheet: "skillExtraB.graveStab", life: 0.3 },
      placed: { sheet: "skillExtraB.graveSword", base: 0, period: 1.6, ground: "skillExtraB.graveGround" },
      act: { sheet: "skillExtraB.graveSpin", life: 0.25, base: GRAVE.radiusPx },
    },
    manaSpring: {
      ramp: "ice",
      cast: { sheet: "skillExtraB.springBurst", life: 0.45, base: SPRING.radiusPx },
      placed: { sheet: "skillExtraB.springRise", base: SPRING.radiusPx, period: 1.6, ground: "skillExtraB.springGround" },
      act: { sheet: "skillExtraB.springDrink", life: 0.25 },
    },
    turret: {
      ramp: "brass",
      cast: { sheet: "skillExtraB.turretDeploy", life: 0.3 },
      placed: { sheet: "skillExtraB.turretBody", base: 0, period: 2 },
      act: { sheet: "skillExtraB.turretFire", life: 0.15 },
      fly: { sheet: "skillExtraB.turretShell", base: 0, period: 0.15 },
    },
  },
};

const sheet = (key, dirs, frames, sz, draw) => ({ key: `skillExtraB.${key}`, dirs, frames, active: 0, size: sz, draw });

export const ATLAS = {
  key: "skillExtraB",
  fx: FX,
  sheets: [
    sheet("comboThrust", DIRS, 7, 200, comboThrust),
    sheet("grudgeWave", DIRS, 9, size(GRUDGE.radiusPx, 16), grudgeWave),
    sheet("grudgeGround", DIRS, 9, size(GRUDGE.radiusPx, 4), grudgeGround),
    { ...sheet("guillotineAim", DIRS, 8, size(GUILLO.lengthPx, 12), guillotineAim), active: 8 },
    sheet("guillotineDrop", DIRS, 8, size(GUILLO.lengthPx, 24), guillotineDrop),
    sheet("guillotineCrack", DIRS, 8, size(GUILLO.lengthPx, 12), guillotineCrack),
    sheet("ricochetFly", DIRS, 4, 64, ricochetFly),
    sheet("ricochetSpark", DIRS, 6, 72, ricochetSpark),
    sheet("ricochetMuzzle", DIRS, 5, 72, ricochetMuzzle),
    sheet("galeFly", DIRS, 6, 104, galeFly),
    sheet("galeCast", DIRS, 6, 112, galeCast),
    sheet("galeCut", 1, 5, 36, galeCut),
    sheet("scatterCast", DIRS, 8, 150, scatterCast),
    sheet("scatterPellet", DIRS, 3, 28, scatterPellet),
    sheet("stompGround", 1, 9, size(STOMP.radiusPx, 16), stompGround),
    sheet("stompAir", 1, 9, size(STOMP.radiusPx, 40), stompAir),
    sheet("threadSpool", 1, 6, 28, threadSpool),
    sheet("threadWind", 1, 6, 36, threadWind),
    sheet("threadLoose", 1, 6, 32, threadLoose),
    sheet("threadTaut", 1, 6, 32, threadTaut),
    sheet("threadHook", DIRS, 6, 28, threadHook),
    sheet("threadSnap", DIRS, 6, 40, threadSnap),
    sheet("meteorLeap", 1, 7, 150, meteorLeap),
    sheet("meteorMark", 1, 10, size(METEOR.radiusPx, 12), meteorMark),
    sheet("meteorFall", 1, 10, 400, meteorFall),
    sheet("meteorImpact", 1, 9, size(METEOR.radiusPx, 60), meteorImpact),
    sheet("meteorCrater", 1, 9, size(METEOR.radiusPx, 12), meteorCrater),
    { ...sheet("swallowDash", DIRS, 6, 150, swallowDash), active: 6 },
    sheet("swallowReturn", DIRS, 8, 220, swallowReturn),
    sheet("swallowTrail", 1, 8, 40, swallowTrail),
    sheet("backflowFade", 1, 8, 96, backflowFade),
    sheet("backflowTrail", 1, 8, 40, backflowTrail),
    sheet("backflowArrive", 1, 8, 64, backflowArrive),
    sheet("scarRoar", 1, 9, size(SCAR.radiusPx, 20), scarRoar),
    sheet("scarGround", 1, 9, size(SCAR.radiusPx, 8), scarGround),
    sheet("kegBarrel", 1, 8, 56, kegBarrel),
    sheet("kegRange", 1, 8, size(KEG.radiusPx, 6), kegRange),
    sheet("kegBlast", 1, 10, size(KEG.radiusPx, 40), kegBlast),
    sheet("kegScorch", 1, 10, size(KEG.radiusPx, 6), kegScorch),
    sheet("graveSword", 1, GRAVE_FRAMES, 96, graveSword),
    sheet("graveGround", 1, GRAVE_FRAMES, size(GRAVE.radiusPx, 8), graveGround),
    sheet("graveStab", 1, 7, 200, graveStab),
    sheet("graveSpin", 1, 8, size(GRAVE.radiusPx, 12), graveSpin),
    sheet("boneShard", 1, BONE_FRAMES, 24, boneShard),
    sheet("boneOrbit", 1, BONE_FRAMES, size(BONE.orbitPx, 6), boneOrbit),
    sheet("boneDust", 1, BONE_FRAMES, size(BONE.orbitPx, 8), boneDust),
    sheet("boneRise", 1, 8, size(BONE.orbitPx, 16), boneRise),
    sheet("boneBreak", 1, 6, 36, boneBreak),
    sheet("springGround", 1, SPRING_FRAMES, size(SPRING.radiusPx, 6), springGround),
    sheet("springRise", 1, SPRING_FRAMES, size(SPRING.radiusPx, 30), springRise),
    sheet("springBurst", 1, 8, size(SPRING.radiusPx, 40), springBurst),
    sheet("springDrink", 1, 6, 56, springDrink),
    sheet("turretBody", 1, TURRET_FRAMES, 48, turretBody),
    sheet("turretDeploy", 1, 7, 80, turretDeploy),
    sheet("turretFire", DIRS, 5, 72, turretFire),
    sheet("turretShell", DIRS, 3, 56, turretShell),
  ],
};
