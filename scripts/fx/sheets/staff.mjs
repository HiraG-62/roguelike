// 棍（moveset "staff"）のエフェクト。docs/ideas/fx-sprites.md。手本は sword.mjs
// 単位は絵のドット（論理 0.5px）。当たり判定の数値（src/data/balance/weapons/WEAPON/movesets/staff.json）× 2 が目安
//
// 棍は刃が無いので、剣の「白い縁の三日月」は使わない。振りは棒の軌跡のブレ（中心から外へ放射状の細い筋が
// 扇状に並び、外端ほど明るい）で、当たりは先端の丸い打撃の衝撃（円盤 + 輪）で見せる。剣との見分けの要
import { arcLine, easeSwing, ring, shards, sparkle, streakLine } from "../shapes.mjs";
import { clamp01, hash1, paint, segment, valueNoise, wrapAngle } from "../raster.mjs";
import { DEG, DIRS } from "../motifs.mjs";

const TAU = Math.PI * 2;

// -----------------------------------------------------------------------------
// 共通の部品（棍だけで使う）
// -----------------------------------------------------------------------------

/** 振り（active）の進み p と、振り終わりの進み k（0..1） */
function timing(f, A, N) {
  const p = f < A ? easeSwing((f + 1) / A) : 1;
  const k = f < A ? 0 : (f - A + 1) / (N - A + 1);
  return { p, k };
}

/** 極座標 → 正準座標 */
function polar(ox, oy, a, r) {
  return { x: ox + Math.cos(a) * r, y: oy + Math.sin(a) * r };
}

/**
 * 棒のブレの扇。先頭（head の角）の筋が今の棒の位置で最も太く明るく、後ろ（dir の逆側へ span）ほど筋が短く暗い。
 * 筋の間隔は後ろほど開く（棒が速く抜けた跡に見える）。fade（0..1）で内側から痩せ、筋が間引かれて消える。
 * 塗りの面は作らない（面にすると剣の三日月と見分けがつかない）
 */
function blurFan(frame, o) {
  const { R, r0, head, span, n, seed } = o;
  const ox = o.ox ?? 0;
  const oy = o.oy ?? 0;
  const dir = o.dir ?? 1;
  const fade = o.fade ?? 0;
  const bright = o.bright ?? 1;
  const lead = o.lead ?? true;
  // 薄い帯: 棒の直後だけ、外寄りに暗い段の帯を敷いて筋をまとめる（面が主役にならないよう段 2〜3 まで）
  if (span > 0.05 && fade < 0.7) {
    const wash = span * 0.55;
    const rIn = R - (R - r0) * 0.45;
    paint(
      frame,
      (x, y) => {
        const dx = x - ox;
        const dy = y - oy;
        const r = Math.hypot(dx, dy);
        if (r > R - 1 || r < rIn) return -1;
        const s = dir * wrapAngle(head - Math.atan2(dy, dx));
        if (s < 0 || s > wash) return -1;
        const t = 1 - s / wash;
        const out = (r - rIn) / (R - rIn);
        if (valueNoise(x, y, 3, seed + 9) + fade * 0.8 > 0.95) return -1;
        return (0.1 + 0.2 * t * out) * bright * (1 - fade);
      },
      { bounds: { x0: ox - R - 2, y0: oy - R - 2, x1: ox + R + 2, y1: oy + R + 2 }, dither: 0.08, samples: 2 },
    );
  }
  for (let i = lead ? 0 : 1; i <= n; i++) {
    const u = i / n;
    // 崩れ: 後ろの筋から先に抜ける
    if (i > 0 && hash1(i, seed) * 0.6 + (1 - u) * 0.5 < fade * 1.2 - 0.1) continue;
    const a = head - dir * span * Math.pow(u, 1.25);
    const inner = r0 + (R - r0) * (0.08 + 0.5 * u + 0.1 * hash1(i, seed + 1)) + (R - r0) * 0.4 * fade;
    const outer = R - u * (2 + 4 * hash1(i, seed + 2)) - fade * 2;
    if (outer - inner < 3) continue;
    const b = bright * (i === 0 ? 0.86 : 0.78 - 0.4 * u) * (1 - 0.45 * fade);
    const p0 = polar(ox, oy, a, inner);
    const p1 = polar(ox, oy, a, outer);
    streakLine(frame, { ax: p0.x, ay: p0.y, bx: p1.x, by: p1.y, width: i === 0 ? 3 : i <= 2 ? 1.7 : 1.35, bright: b });
  }
}

/** 丸い打撃の円盤（中心が明るい。白は中央の光点だけにするので 0.75 まで） */
function disc(frame, x, y, radius, bright = 1, squash = 1) {
  paint(
    frame,
    (px, py) => {
      const d = Math.hypot((px - x) / squash, py - y) / radius;
      if (d > 1) return -1;
      return clamp01((0.35 + 0.4 * (1 - d) ** 0.8) * bright);
    },
    { bounds: { x0: x - radius * squash - 2, y0: y - radius - 2, x1: x + radius * squash + 2, y1: y + radius + 2 } },
  );
}

/** 打撃の放射線: 中心の周りから外へ短い筋。a0 から count 本、len の長さ */
function rays(frame, x, y, o) {
  const { count, r0, r1, seed } = o;
  const a0 = o.a0 ?? 0;
  const bright = o.bright ?? 0.7;
  const cone = o.cone ?? TAU;
  for (let i = 0; i < count; i++) {
    const a = a0 + (cone === TAU ? (i / count) * TAU : (i / Math.max(1, count - 1) - 0.5) * cone) + (hash1(i, seed) - 0.5) * 0.3;
    const long = 0.7 + 0.5 * hash1(i, seed + 1);
    const p0 = polar(x, y, a, r0);
    const p1 = polar(x, y, a, r0 + (r1 - r0) * long);
    streakLine(frame, { ax: p0.x, ay: p0.y, bx: p1.x, by: p1.y, width: 1.3, bright });
  }
}

/**
 * 先端の打撃の衝撃（age 0 = 当たった瞬間）。0: 円盤 + 光点 + 短い放射線、1 以降: 輪が広がって欠ける
 */
function impact(frame, x, y, age, o) {
  const size = o.size;
  const seed = o.seed;
  const squash = o.squash ?? 1;
  if (age < 0) return;
  if (age === 0) {
    disc(frame, x, y, size * 0.55, 1, squash);
    sparkle(frame, x, y, size >= 10 ? 3 : 2);
    rays(frame, x, y, { count: o.rays ?? 6, r0: size * 0.7, r1: size * 1.25, seed, a0: o.a0 ?? 0.3, bright: 0.72 });
    return;
  }
  if (age === 1) {
    disc(frame, x, y, size * 0.35, 0.75, squash);
    rays(frame, x, y, { count: o.rays ?? 6, r0: size * 1.05, r1: size * 1.5, seed, a0: o.a0 ?? 0.3, bright: 0.5 });
  }
  const rr = size * (0.6 + 0.32 * age);
  ring(frame, { ox: x, oy: y, radius: rr, width: Math.max(1.4, 2.6 - age * 0.35), squash, erosion: Math.min(0.92, 0.1 + (age - 1) * 0.28), bright: 0.82 - age * 0.08, seed: seed + 5 });
}

/** 風の渦の筋: 角 a0 から sweep だけ回りながら、半径が rIn → rOut へ広がる細い線。終わり（先）ほど明るい */
function spiral(frame, o) {
  const { a0, sweep, rIn, rOut } = o;
  const width = o.width ?? 1.3;
  const bright = o.bright ?? 0.6;
  const erosion = o.erosion ?? 0;
  const seed = o.seed ?? 7;
  const pad = Math.max(rIn, rOut) + 3;
  paint(
    frame,
    (x, y) => {
      const r = Math.hypot(x, y);
      let s = wrapAngle(Math.atan2(y, x) - a0);
      if (s < 0) s += TAU;
      if (s > sweep) return -1;
      const t = s / sweep;
      const want = rIn + (rOut - rIn) * t;
      if (Math.abs(r - want) > width / 2) return -1;
      if (erosion > 0 && valueNoise(x, y, 4, seed) - erosion * 0.9 + t * 0.2 < 0.1) return -1;
      return bright * (0.3 + 0.7 * t);
    },
    { bounds: { x0: -pad, y0: -pad, x1: pad, y1: pad }, dither: 0, samples: 2 },
  );
}

/** 振り終わりの粒（棒の先から接線の向きへ流れる埃） */
function tipDust(frame, age, count, seed, x, y, a, dir = 1) {
  shards(frame, age, count, seed, (i, rnd) => {
    const t = a + dir * (Math.PI / 2) + (rnd(1) - 0.5) * 1.2;
    const sp = 2 + rnd(2) * 3;
    return { x: x + (rnd(3) - 0.5) * 6, y: y + (rnd(4) - 0.5) * 6, vx: Math.cos(t) * sp, vy: Math.sin(t) * sp, life: 3 + Math.floor(rnd(5) * 2), size: rnd(6) > 0.6 ? 2 : 1 };
  });
}

// -----------------------------------------------------------------------------
// 薙ぎ（arc 180°）: 左 1・2 段・払い上げ・二段払い
// -----------------------------------------------------------------------------

/**
 * 薙ぎの 1 回。spec: R（先端の半径）・r0（筋の内端）・sweep / tilt（度）・blur（扇の広がりの度）・n（筋の数）・
 * frames / active・hitAt（先端の衝撃を出すフレーム）・seed
 */
function sweepFrame(frame, f, spec) {
  const A = spec.active;
  const N = spec.frames;
  const { p, k } = timing(f, A, N);
  const from = (-spec.sweep / 2 + (spec.tilt ?? 0)) * DEG;
  const sweep = spec.sweep * DEG;
  const head = from + sweep * (p + (spec.overshoot ?? 0.05) * k);
  // 扇は振った分だけ広がり、振り終わりは先端へ畳まれる
  const span = Math.min(sweep * p, spec.blur * DEG) * (1 - 0.55 * k);
  blurFan(frame, { R: spec.R, r0: spec.r0, head, span, n: spec.n, seed: spec.seed, fade: k, lead: f <= A, bright: 0.9 + 0.1 * p });
  const hitAt = spec.hitAt ?? A - 1;
  const tipR = spec.R - 3;
  const endHead = from + sweep;
  if (f >= hitAt) {
    const age = f - hitAt;
    const aTip = age === 0 ? head : endHead;
    const tip = polar(0, 0, aTip, tipR);
    // 衝撃の放射線は棒の進む向き（接線）を中心に
    impact(frame, tip.x, tip.y, age, { size: spec.impact ?? 9, seed: spec.seed + 20, a0: aTip + Math.PI / 2 });
  }
  if (f >= A - 1) {
    const tip = polar(0, 0, endHead, tipR);
    tipDust(frame, f - (A - 1), spec.dust ?? 6, spec.seed + 30, tip.x, tip.y, endHead);
  }
}

/** 左 1 段（arc 180° reach 26）: 狭いブレの扇で素早く薙ぐ */
const L0 = { R: 54, r0: 14, sweep: 180, tilt: 0, blur: 75, n: 8, frames: 8, active: 4, impact: 9, dust: 5, seed: 1101 };
/** 左 2 段（返し。描画側が上下反転）: 扇が広く、筋が多い。軌道を少し前へ傾ける */
const L1 = { R: 56, r0: 16, sweep: 180, tilt: 8, blur: 115, n: 11, frames: 8, active: 4, impact: 10, dust: 7, seed: 1202, overshoot: 0.08 };
/** 右: 払い上げ（arc 180° reach 28・踏み込み 10）。後ろ下から大きくすくい上げ、最後に前へ押し返しの波 */
const UPSWING = { R: 58, r0: 12, sweep: 200, tilt: -14, blur: 130, n: 12, frames: 9, active: 4, impact: 11, dust: 8, seed: 1303, overshoot: 0.04 };

function upswing(frame, f) {
  sweepFrame(frame, f, UPSWING);
  const A = UPSWING.active;
  if (f < A - 1) return;
  // 押し返し: 前方へふくらむ浅い弧の波が 2 枚、時間差で外へ押し出される（棒の払いの風圧）
  const age = f - (A - 1);
  for (let j = 0; j < 2; j++) {
    const a = age - j;
    if (a < 0 || a > 4) continue;
    const half = (0.55 - a * 0.06) * (1 - j * 0.2);
    const radius = UPSWING.R + 8 + a * 7 + j * 2;
    arcLine(frame, { radius, from: -half, to: half, width: 2.4 - a * 0.3, bright: 0.72 - a * 0.12 - j * 0.1 });
    // 両端を少し欠いて波の切れ目にする
    if (a >= 2) tipDust(frame, a - 2, 3, 1320 + j, Math.cos(half) * radius, Math.sin(half) * radius, half);
  }
}

/** 派生: 二段払い（arc 180°・2 段ヒット）。行きの薙ぎと、半径を詰めた返しの薙ぎを時間で分ける */
const DOUBLE = { R: 54, r0: 14, n: 9, frames: 9, seed: 1404 };

function doubleSweep(frame, f) {
  const half = 90 * DEG;
  // 1 振り目: 0..2 で -90° → +90°（時計回り）、2 振り目: 3..5 で +90° → -90°（反時計回り）
  if (f <= 3) {
    const p = easeSwing(Math.min(1, (f + 1) / 3));
    const k = f === 3 ? 0.6 : 0;
    const head = -half + 2 * half * p;
    blurFan(frame, { R: DOUBLE.R, r0: DOUBLE.r0, head, span: Math.min(2 * half * p, 85 * DEG) * (1 - k * 0.6), n: DOUBLE.n, seed: DOUBLE.seed, fade: k, lead: f < 3 });
    if (f >= 2) {
      const tip = polar(0, 0, half, DOUBLE.R - 3);
      impact(frame, tip.x, tip.y, f - 2, { size: 8, seed: DOUBLE.seed + 20, a0: half + Math.PI / 2 });
    }
  }
  if (f >= 3) {
    const R2 = DOUBLE.R - 6;
    const { p, k } = timing(f - 3, 3, DOUBLE.frames - 3);
    const head = half - 2 * half * p - 0.05 * k;
    blurFan(frame, { R: R2, r0: DOUBLE.r0, head, span: Math.min(2 * half * p, 110 * DEG) * (1 - 0.55 * k), n: DOUBLE.n + 2, seed: DOUBLE.seed + 50, fade: k, lead: f <= 6, dir: -1 });
    if (f >= 5) {
      const tip = polar(0, 0, -half, R2 - 3);
      impact(frame, tip.x, tip.y, f - 5, { size: 10, seed: DOUBLE.seed + 60, a0: -half - Math.PI / 2 });
      tipDust(frame, f - 5, 7, DOUBLE.seed + 70, tip.x, tip.y, -half, -1);
    }
  }
}

// -----------------------------------------------------------------------------
// 突き（thrust）: 左 3 段目・ダッシュ・石突き・天突き
// -----------------------------------------------------------------------------

/**
 * 突きの棒の通り道: 中央の太い筋（今の棒）+ 両脇の細い平行の筋。back → tip。fade で後ろから消える
 */
function thrustPath(frame, o) {
  const { back, tip, fade, seed, lines, spread } = o;
  const bright = o.bright ?? 1;
  const len = tip - back;
  if (fade < 0.6) streakLine(frame, { ax: back + len * fade, ay: 0, bx: tip, by: 0, width: o.width ?? 2.6, bright: 0.8 * bright * (1 - fade * 0.6) });
  for (let i = 0; i < lines; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const y = side * (spread + Math.floor(i / 2) * 3 + (hash1(i, seed) - 0.5) * 1.5 + fade * 3);
    const l = len * (0.45 + 0.4 * hash1(i, seed + 1)) * (1 - fade * 0.6);
    const x1 = tip - 6 - Math.abs(y) * 0.8 - hash1(i, seed + 2) * 8 - fade * 12;
    if (l < 4 || fade > 0.85) continue;
    streakLine(frame, { ax: x1 - l, ay: y, bx: x1, by: y, width: 1.2, bright: (0.6 - 0.05 * i) * bright * (1 - fade) });
  }
}

/** 左 3 段目（thrust reach 36・踏み込み 6）: 真っ直ぐな筋と、先端の丸い衝撃 */
function thrust(frame, f) {
  const A = 3;
  const N = 7;
  const { p, k } = timing(f, A, N);
  const reach = 72;
  const tip = 12 + (reach - 12) * p;
  thrustPath(frame, { back: 6, tip, fade: k, seed: 2101, lines: 5, spread: 5, width: 3.4 });
  if (f >= A - 1) impact(frame, reach, 0, f - (A - 1), { size: 10, seed: 2110, rays: 7, a0: 0.45 });
}

/** ダッシュ攻撃（thrust reach 36）: 後ろから長く伸びる突進の筋の束 + 先端の衝撃 + 足もとの埃 */
function dashThrust(frame, f) {
  const A = 3;
  const N = 7;
  const { p, k } = timing(f, A, N);
  const reach = 72;
  const tip = -20 + (reach + 20) * p;
  thrustPath(frame, { back: -34, tip, fade: k, seed: 2201, lines: 6, spread: 5, width: 2.2 });
  // 後ろへ流れる突進の筋（剣のダッシュより細かく、棒の通り道に揃える）
  for (let i = 0; i < 4; i++) {
    const y = (i - 1.5) * 9 + (hash1(i, 2202) - 0.5) * 3;
    const x1 = 10 - k * 24 - hash1(i, 2203) * 10;
    const len = 18 + 18 * hash1(i, 2204);
    if (k > 0.8) continue;
    streakLine(frame, { ax: x1 - len, ay: y, bx: x1, by: y, bright: 0.42 * (1 - k) });
  }
  if (f >= A - 1) impact(frame, reach, 0, f - (A - 1), { size: 9, seed: 2210, rays: 6, a0: 0.5 });
  if (f >= 1) {
    shards(frame, f - 1, 6, 2220, (i, rnd) => {
      const side = rnd(1) > 0.5 ? 1 : -1;
      return { x: -10 + rnd(2) * 16, y: side * (4 + rnd(3) * 4), vx: -1.5 - rnd(4) * 2, vy: side * (1 + rnd(5) * 1.5), life: 3 + Math.floor(rnd(6) * 2), size: 1 };
    });
  }
}

/**
 * 右: 石突き（thrust reach 36）。棒の尻で短く重く突く: 先端の衝撃は突きの向きに潰れた大きな円盤と二重の輪、
 * 筋は太く短く、跳ね返りの短い筋が後ろへ
 */
function staffButt(frame, f) {
  const A = 3;
  const N = 7;
  const { p, k } = timing(f, A, N);
  const reach = 70;
  const tip = 24 + (reach - 24) * p;
  thrustPath(frame, { back: 22 + k * 10, tip, fade: k, seed: 2301, lines: 2, spread: 5, width: 3.4 });
  if (f >= A - 1) {
    const age = f - (A - 1);
    // 平たい当て面: 突きの向きに潰れた円盤（棒の尻の丸さ）
    if (age === 0) {
      disc(frame, reach, 0, 11, 1, 0.55);
      sparkle(frame, reach, 0, 3);
      rays(frame, reach, 0, { count: 5, r0: 9, r1: 18, seed: 2310, a0: 0, cone: 2.2, bright: 0.75 });
    }
    if (age >= 1) {
      for (let j = 0; j < 2; j++) {
        const a = age - j;
        if (a < 0) continue;
        ring(frame, { ox: reach - 2 + a * 2.5, radius: 9 + a * 4, width: 2.6 - a * 0.3, squash: 0.5, erosion: Math.min(0.9, a * 0.22), bright: 0.8 - a * 0.1 - j * 0.12, seed: 2320 + j });
      }
      if (age === 1) disc(frame, reach, 0, 6, 0.7, 0.55);
    }
    // 跳ね返り: 当て面から後ろ斜めへ短い筋
    if (age >= 1 && age <= 3) {
      for (const side of [-1, 1]) {
        const s = 10 + age * 4;
        streakLine(frame, { ax: reach - 4 - s, ay: side * (8 + age * 3), bx: reach - 6, by: side * 6, width: 1.2, bright: 0.55 - age * 0.1 });
      }
    }
  }
}

/** 右: 天突き（thrust reach 40・重い）。長い筋と、先端で大きく弾ける輪 2 枚 + 八方の放射線 */
function skyThrust(frame, f) {
  const A = 4;
  const N = 9;
  const { p, k } = timing(f, A, N);
  const reach = 80;
  const tip = 8 + (reach - 8) * p;
  thrustPath(frame, { back: 2, tip, fade: k, seed: 2401, lines: 6, spread: 5, width: 3.8 });
  if (f < A - 1) return;
  const age = f - (A - 1);
  if (age === 0) {
    disc(frame, reach, 0, 9, 1);
    sparkle(frame, reach, 0, 4);
    rays(frame, reach, 0, { count: 8, r0: 10, r1: 22, seed: 2410, a0: 0.2, bright: 0.8 });
    return;
  }
  if (age <= 2) rays(frame, reach, 0, { count: 8, r0: 12 + age * 8, r1: 24 + age * 9, seed: 2410, a0: 0.2, bright: 0.65 - age * 0.12 });
  if (age === 1) disc(frame, reach, 0, 6, 0.8);
  ring(frame, { ox: reach, radius: 10 + age * 6, width: 3 - age * 0.3, erosion: Math.min(0.9, (age - 1) * 0.2), bright: 0.85 - age * 0.08, seed: 2420 });
  if (age >= 2) ring(frame, { ox: reach, radius: 5 + (age - 1) * 7, width: 2, erosion: Math.min(0.92, (age - 2) * 0.25), bright: 0.65 - age * 0.06, seed: 2421 });
  shards(frame, age - 1, 10, 2430, (i, rnd) => {
    const a = (rnd(1) - 0.5) * 2.6;
    const sp = 3 + rnd(2) * 3.5;
    return { x: reach, y: 0, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(3) * 2), size: rnd(4) > 0.5 ? 2 : 1 };
  });
}

// -----------------------------------------------------------------------------
// 回転（circle）: 左 4 段目・回し打ち・旋風・風車
// -----------------------------------------------------------------------------

/**
 * 回転の共通: 棒のブレの扇が turns 周だけ回る。ends = 2 なら中央を持って両端が回る（風車）。
 * flashes のフレームで先端に打撃の光点を出す
 */
function spinFrame(frame, f, spec) {
  const A = spec.active;
  const N = spec.frames;
  const { p, k } = timing(f, A, N);
  const rot = spec.start + spec.turns * TAU * p + (spec.coast ?? 0.5) * k;
  const span = Math.min(spec.turns * TAU * p, spec.blur * DEG) * (1 - 0.5 * k);
  for (let e = 0; e < spec.ends; e++) {
    const head = rot + (e * TAU) / spec.ends;
    blurFan(frame, { R: spec.R, r0: spec.r0, head, span, n: spec.n, seed: spec.seed + e * 17, fade: k, lead: f < A });
    if ((spec.flashes ?? []).includes(f)) {
      const tip = polar(0, 0, head, spec.R - 3);
      sparkle(frame, tip.x, tip.y, 3);
      disc(frame, tip.x, tip.y, 4, 0.8);
    }
  }
}

/** 外周の風の筋（回転の向きに流れる弧を、少しずつ外へ広がる渦にする） */
function windRing(frame, f, o) {
  const { count, rIn, rOut, rot, sweep, seed } = o;
  const erosion = o.erosion ?? 0;
  for (let i = 0; i < count; i++) {
    const a0 = rot + (i / count) * TAU + hash1(i, seed) * 0.4;
    spiral(frame, { a0, sweep, rIn: rIn + hash1(i, seed + 1) * 4, rOut, bright: (o.bright ?? 0.6) * (0.8 + 0.2 * hash1(i, seed + 2)), erosion, seed: seed + i });
  }
}

/** 左 4 段目（circle size 56）: 片端の棒が 1 周強回るブレと、外へ広がる風の渦 */
const SPIN = { R: 52, r0: 12, start: -Math.PI / 2, turns: 1.1, blur: 150, n: 14, ends: 1, frames: 9, active: 5, seed: 3101, flashes: [4] };

function spin(frame, f) {
  spinFrame(frame, f, SPIN);
  const { p, k } = timing(f, SPIN.active, SPIN.frames);
  if (f < 1) return;
  const rot = SPIN.start + SPIN.turns * TAU * p;
  windRing(frame, f, { count: 3, rIn: 26 + k * 10, rOut: 58 + k * 8, rot: rot - 1.8, sweep: 1.5 * (1 - 0.4 * k), seed: 3110, bright: 0.62 * (1 - 0.5 * k), erosion: k });
}

/** 右: 回し打ち（circle size 52・踏み込み 6）: 中央を持って両端が 1 周する。両端の先で打撃の輪 */
const SPIN_STRIKE = { R: 50, r0: 8, start: -Math.PI / 2, turns: 1, blur: 110, n: 10, ends: 2, frames: 8, active: 4, seed: 3201, coast: 0.4 };

function spinStrike(frame, f) {
  spinFrame(frame, f, SPIN_STRIKE);
  if (f < SPIN_STRIKE.active - 1) return;
  const age = f - (SPIN_STRIKE.active - 1);
  const end = SPIN_STRIKE.start + SPIN_STRIKE.turns * TAU;
  for (let e = 0; e < 2; e++) {
    const tip = polar(0, 0, end + e * Math.PI, SPIN_STRIKE.R - 3);
    impact(frame, tip.x, tip.y, age, { size: 8, seed: 3210 + e * 3, rays: 5, a0: end + e * Math.PI + Math.PI / 2 });
  }
}

/** 派生: 旋風（circle size 64・3 段ヒット・長い active）: 太い風の渦が 3 周巻き、中の棒のブレが当たりごとに光る */
const TEMPEST = { R: 50, r0: 12, start: 0, turns: 2.6, blur: 140, n: 12, ends: 1, frames: 10, active: 7, seed: 3301, flashes: [1, 3, 5], coast: 0.8 };

function tempest(frame, f) {
  spinFrame(frame, f, TEMPEST);
  const { p, k } = timing(f, TEMPEST.active, TEMPEST.frames);
  const rot = TEMPEST.start + TEMPEST.turns * TAU * p;
  // 渦は内から外へ巻き出す長い筋 4 本。振り終わりは外へ散って欠ける
  windRing(frame, f, { count: 4, rIn: 18 + k * 14, rOut: 64 + k * 6, rot: rot - 2.8, sweep: 2.6 * (1 - 0.35 * k), seed: 3310, bright: 0.56 * (1 - 0.4 * k), erosion: 0.15 + k * 0.8 });
  if ([1, 3, 5].includes(f)) ring(frame, { radius: 60, width: 2, erosion: 0.5, bright: 0.6, seed: 3320 + f });
  if (f >= TEMPEST.active - 1) {
    shards(frame, f - (TEMPEST.active - 1), 12, 3330, (i, rnd) => {
      const a = rnd(1) * TAU;
      const sp = 2.5 + rnd(2) * 3;
      return { x: Math.cos(a) * 56, y: Math.sin(a) * 56, vx: (-Math.sin(a) * 0.8 + Math.cos(a) * 0.4) * sp, vy: (Math.cos(a) * 0.8 + Math.sin(a) * 0.4) * sp, life: 3 + Math.floor(rnd(3) * 2), size: rnd(4) > 0.5 ? 2 : 1 };
    });
  }
}

/** 派生: 風車（circle size 64・3 段ヒット・短い active）: 両端の棒が 1.5 周の速い風車。3 回の当たりで 4 か所が光る */
const WINDMILL = { R: 60, r0: 6, start: Math.PI / 4, turns: 1.5, blur: 95, n: 10, ends: 2, frames: 9, active: 5, seed: 3401, flashes: [1, 2, 4], coast: 0.6 };

function windmill(frame, f) {
  spinFrame(frame, f, WINDMILL);
  const { p, k } = timing(f, WINDMILL.active, WINDMILL.frames);
  const rot = WINDMILL.start + WINDMILL.turns * TAU * p;
  // 外周の細い弧の速度線（渦ではなく同じ半径を回る。旋風と見分ける）
  if (f >= 1 && k < 0.7) {
    for (let i = 0; i < 4; i++) {
      const a = rot + (i * TAU) / 4 - 0.3;
      spiral(frame, { a0: a - 0.8, sweep: 0.8, rIn: 63 + (i % 2) * 2 + k * 4, rOut: 63 + (i % 2) * 2 + k * 4, bright: 0.55 * (1 - k), seed: 3410 + i });
    }
  }
  if (f >= WINDMILL.active - 1) {
    const age = f - (WINDMILL.active - 1);
    for (let e = 0; e < 2; e++) {
      const a = rot + e * Math.PI;
      const tip = polar(0, 0, a, WINDMILL.R - 3);
      tipDust(frame, age, 5, 3420 + e * 7, tip.x, tip.y, a);
    }
  }
}

// -----------------------------------------------------------------------------
// 打ち据え（box・重い）: 当たりの中心に置く
// -----------------------------------------------------------------------------

/**
 * 派生: 打ち据え（box reach 20 / size 26・重い）。攻撃の向きに直交して寝かせた棒が上から地面へ叩きつけられる。
 * 0〜1: 棒の影が濃くなりながら落ちてくる（手前へ流れる筋）、2: 叩きつけの閃光と平たい棒、3〜: 横長の衝撃の輪・地割れの筋・埃
 */
function pinDown(frame, f) {
  const HALF = 30;
  if (f <= 1) {
    // 落ちてくる棒: 攻撃の向きの手前から原点へ、平行の筋が詰まってくる
    const off = f === 0 ? -14 : -6;
    for (let i = 0; i < 3; i++) {
      const x = off - i * 5;
      streakLine(frame, { ax: x, ay: -HALF + i * 3, bx: x, by: HALF - i * 3, width: i === 0 ? 2.4 : 1.2, bright: (0.7 - i * 0.18) * (f === 0 ? 0.8 : 1) });
    }
    return;
  }
  const age = f - 2;
  // 叩きつけた棒（寝かせた太い筋）と中央の閃光
  if (age <= 2) {
    paint(
      frame,
      (x, y) => {
        const s = segment(x, y, 0, -HALF, 0, HALF);
        const w = 2.2 - age * 0.5;
        if (s.d > w) return -1;
        return clamp01((0.8 - age * 0.18) * (1 - 0.4 * Math.abs(s.t - 0.5) * 2) * (1 - 0.4 * (s.d / w)));
      },
      { bounds: { x0: -5, y0: -HALF - 2, x1: 5, y1: HALF + 2 } },
    );
  }
  if (age === 0) {
    disc(frame, 0, 0, 12, 1, 0.55);
    sparkle(frame, 0, 0, 4);
  }
  // 横長（棒に沿って長い）の衝撃の輪
  // 棒より一回り大きく始めて外へ広がる（棒に沿わせると輪が棒を縁取るだけに見える）
  ring(frame, { radius: 36 + age * 7, width: 3 - age * 0.3, squash: 0.62, erosion: Math.min(0.92, age * 0.2), bright: 0.82 - age * 0.08, seed: 4110 });
  // 地割れ: 棒の両脇から前後（棒と直交）へ伸びるぎざぎざの筋
  if (age <= 3) {
    for (let i = 0; i < 6; i++) {
      const y = (i / 5 - 0.5) * HALF * 1.6 + (hash1(i, 4120) - 0.5) * 6;
      const side = i % 2 === 0 ? 1 : -1;
      const len = (12 + 12 * hash1(i, 4121)) * Math.min(1, (age + 1) / 2);
      const kink = (hash1(i, 4122) - 0.5) * 6;
      const b = 0.78 - age * 0.14;
      streakLine(frame, { ax: side * 3, ay: y, bx: side * (3 + len * 0.5), by: y + kink, width: 1.2, bright: b });
      streakLine(frame, { ax: side * (3 + len * 0.5), ay: y + kink, bx: side * (3 + len), by: y + kink * 0.3, width: 1.2, bright: b * 0.85 });
    }
  }
  // 埃: 棒の両脇から前後へ
  shards(frame, age, 14, 4130, (i, rnd) => {
    const side = rnd(1) > 0.5 ? 1 : -1;
    const y = (rnd(2) - 0.5) * HALF * 2;
    const sp = 2 + rnd(3) * 3;
    return { x: side * 4, y, vx: side * sp, vy: (rnd(4) - 0.5) * 1.5, life: 3 + Math.floor(rnd(5) * 3), size: rnd(6) > 0.5 ? 2 : 1 };
  });
}

// -----------------------------------------------------------------------------
// 命中
// -----------------------------------------------------------------------------

/** 命中: 丸い打撃の閃光 + 短い放射線（進む向き +x に多め）。heavy は大きな輪 2 枚と長い放射線 */
function hit(frame, f, heavy) {
  const R = heavy ? 12 : 8;
  const seed = heavy ? 5101 : 5201;
  if (f === 0) {
    disc(frame, 0, 0, R * 0.9, 1);
    sparkle(frame, 0, 0, heavy ? 4 : 3);
  }
  if (f === 1) disc(frame, 0, 0, R * 0.6, 0.8);
  if (f <= 2) {
    const grow = f * (heavy ? 5 : 3);
    // 前方の扇に長めの線、全周に短い線
    rays(frame, 0, 0, { count: heavy ? 5 : 3, r0: R + grow, r1: R * 2.4 + grow, seed, a0: 0, cone: 1.6, bright: 0.78 - f * 0.15 });
    rays(frame, 0, 0, { count: heavy ? 8 : 6, r0: R * 0.9 + grow, r1: R * 1.6 + grow, seed: seed + 3, a0: 0.4, bright: 0.62 - f * 0.15 });
  }
  if (f >= 1) {
    const age = f - 1;
    ring(frame, { radius: R + age * (heavy ? 6 : 4), width: (heavy ? 3.2 : 2.2) - age * 0.3, erosion: Math.min(0.92, 0.1 + age * 0.26), bright: 0.82 - age * 0.1, seed: seed + 5 });
    if (heavy && f >= 2) ring(frame, { radius: R * 0.8 + (f - 2) * 8, width: 2, erosion: Math.min(0.92, (f - 2) * 0.25), bright: 0.65 - age * 0.06, seed: seed + 6 });
    shards(frame, age, heavy ? 10 : 6, seed + 7, (i, rnd) => {
      const a = rnd(1) > 0.4 ? (rnd(2) - 0.5) * 1.4 : rnd(2) * TAU;
      const sp = (heavy ? 3.5 : 2.5) + rnd(3) * 3;
      return { x: 0, y: 0, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(4) * 2), size: rnd(5) > 0.5 ? 2 : 1 };
    });
  }
}

// -----------------------------------------------------------------------------
// 表
// -----------------------------------------------------------------------------

function sweepSheet(key, spec, draw) {
  return { key, dirs: DIRS, frames: spec.frames, active: spec.active, size: Math.ceil(spec.R + 16) * 2, draw: draw ?? ((frame, f) => sweepFrame(frame, f, spec)) };
}

/**
 * 武器種のモーション → シート（render/fxMotions.ts が読む）。
 * pivot: self = 自分の中心、anchor = 当たり判定の中心。base は絵を描いたときの当たり判定の大きさ（measure の値。論理 px）
 */
const FX = {
  moveset: "staff",
  motions: {
    "l:0": { sheet: "staff.sweep1", pivot: "self", base: 26, measure: "reach" },
    "l:1": { sheet: "staff.sweep2", pivot: "self", base: 26, measure: "reach" },
    "l:2": { sheet: "staff.thrust", pivot: "self", base: 36, measure: "reach" },
    "l:3": { sheet: "staff.spin", pivot: "anchor", base: 56, measure: "size" },
    dash: { sheet: "staff.dash", pivot: "self", base: 36, measure: "reach" },
    "r:upswing": { sheet: "staff.upswing", pivot: "self", base: 28, measure: "reach" },
    "r:staffButt": { sheet: "staff.butt", pivot: "self", base: 36, measure: "reach" },
    "r:spinStrike": { sheet: "staff.spinStrike", pivot: "anchor", base: 52, measure: "size" },
    "r:skyThrust": { sheet: "staff.skyThrust", pivot: "self", base: 40, measure: "reach" },
    "branch:tempest": { sheet: "staff.tempest", pivot: "anchor", base: 64, measure: "size" },
    "branch:windmill": { sheet: "staff.windmill", pivot: "anchor", base: 64, measure: "size" },
    "branch:doubleSweep": { sheet: "staff.double", pivot: "self", base: 26, measure: "reach" },
    "branch:pinDown": { sheet: "staff.pinDown", pivot: "anchor", base: 20, measure: "reach" },
  },
  hit: "staff.hit",
  hitHeavy: "staff.hitHeavy",
};

export const ATLAS = {
  key: "staff",
  fx: FX,
  sheets: [
    sweepSheet("staff.sweep1", L0),
    sweepSheet("staff.sweep2", L1),
    { ...sweepSheet("staff.upswing", UPSWING, upswing), size: 208 },
    { key: "staff.double", dirs: DIRS, frames: DOUBLE.frames, active: 6, size: 144, draw: doubleSweep },
    { key: "staff.thrust", dirs: DIRS, frames: 7, active: 3, size: 176, draw: thrust },
    { key: "staff.dash", dirs: DIRS, frames: 7, active: 3, size: 184, draw: dashThrust },
    { key: "staff.butt", dirs: DIRS, frames: 7, active: 3, size: 204, draw: staffButt },
    { key: "staff.skyThrust", dirs: DIRS, frames: 9, active: 4, size: 256, draw: skyThrust },
    { key: "staff.spin", dirs: 1, frames: SPIN.frames, active: SPIN.active, size: 144, draw: spin },
    { key: "staff.spinStrike", dirs: 1, frames: SPIN_STRIKE.frames, active: SPIN_STRIKE.active, size: 136, draw: spinStrike },
    { key: "staff.tempest", dirs: 1, frames: TEMPEST.frames, active: TEMPEST.active, size: 160, draw: tempest },
    { key: "staff.windmill", dirs: 1, frames: WINDMILL.frames, active: WINDMILL.active, size: 160, draw: windmill },
    { key: "staff.pinDown", dirs: DIRS, frames: 8, active: 3, size: 144, draw: pinDown },
    { key: "staff.hit", dirs: DIRS, frames: 6, active: 0, size: 80, draw: (frame, f) => hit(frame, f, false) },
    { key: "staff.hitHeavy", dirs: DIRS, frames: 7, active: 0, size: 112, draw: (frame, f) => hit(frame, f, true) },
  ],
};
