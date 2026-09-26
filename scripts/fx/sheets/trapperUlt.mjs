// 仕掛け（moveset "trapper"）の奥義 3 本のエフェクト。docs/ideas/fx-sprites.md 9.2 章。手本は swordUlt.mjs、形の言葉は trapper.mjs
// 単位は絵のドット（論理 0.5px）。数値は src/data/balance/ultimates/ULTIMATE/defs/trapper.json × 2 が目安
//
// 性格は通常の罠と同じ「置く・合図を飛ばす・噴き上がる」。刃の弧は無い。奥義はそれを大きく・段を多くする:
//   地雷原: 8 個の地雷を扇に撒く。撒き出しは筒の「ぽん」を 8 本の炎の舌と煙の扇に広げ、地雷は危険の歯を縁に持つ大きな円盤、
//           炸裂は火柱がきのこ雲に開き、衝撃の輪と燃えさしの輪が這う（通常の地雷の炸裂より一段大きく長い）
//   連鎖爆破: 起爆の合図（折れ線・点線の電波の輪）を床いっぱいへ走らせ、足元は 8 つの火の玉が時計回りに連鎖して噴く
//   罠師の勘（持続）: 探知の掃引（レーダー）が足元を回り、頭上の信号灯が瞬き、引き寄せの山形が内へ脈打つ
// 白（段 7）は信号灯・合図の先・炸裂の芯の光点だけ（火の玉・煙は段 6 まで）
import { easeSwing, ring, shards, sparkle, streakLine } from "../shapes.mjs";
import { clamp01, dot, hash1, paint, valueNoise } from "../raster.mjs";
import { DEG, DIRS } from "../motifs.mjs";

const TAU = Math.PI * 2;
/** 炸裂の半径（blastRadius 30 論理 px × 2） */
const BLAST_R = 60;
/** 手元（自分の中心から前へ） */
const HAND = 14;
/** 足元の高さ（キャラは絵で 48 ドット） */
const FEET_Y = 18;
/** 火の玉・煙の明るさの上限（白の面を作らない） */
const FIRE_CAP = 0.78;

// -----------------------------------------------------------------------------
// 共通の部品（trapper.mjs と同じ形の言葉。export されていないので写して奥義向けに少し変える）
// -----------------------------------------------------------------------------

/** 崩れの判定: ノイズと芯からの近さで、縁から先に欠ける */
function survives(x, y, erosion, nearCore, seed) {
  if (erosion <= 0) return true;
  const n = valueNoise(x, y, 3.5, seed) * 0.6 + valueNoise(x, y, 1.4, seed + 7) * 0.2;
  return n + nearCore * 0.45 - erosion * 1.15 > 0;
}

/** 細る三角の針: (x, y) から角 a へ長さ len、根元の半幅 w */
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

/** 丸い塊（火の玉・煙）。ノイズで縁を揺らし、erosion で虫食いに消える。明るさは FIRE_CAP まで */
function blob(frame, x, y, r, o = {}) {
  const bright = Math.min(FIRE_CAP, o.bright ?? 0.7);
  const seed = o.seed ?? 1;
  const erosion = o.erosion ?? 0;
  const rough = o.rough ?? 0.3;
  if (r < 0.8 || bright <= 0) return;
  paint(
    frame,
    (px, py) => {
      const d = Math.hypot(px - x, py - y);
      const edge = r * (1 - rough + rough * 2 * valueNoise(px, py, Math.max(2, r * 0.45), seed));
      if (d > edge) return -1;
      const q = d / Math.max(0.5, edge);
      if (erosion > 0 && valueNoise(px, py, 3, seed + 3) * 0.75 + (1 - q) * 0.3 - erosion * 1.1 < 0) return -1;
      return clamp01(Math.pow(1 - q, 0.6) * bright * (1 - erosion * 0.4));
    },
    { bounds: { x0: x - r * 1.3 - 2, y0: y - r * 1.3 - 2, x1: x + r * 1.3 + 2, y1: y + r * 1.3 + 2 } },
  );
}

/** 飛び散る粒の束。cone の扇へ、center の向きに */
function burst(frame, age, o) {
  const { n, seed, speed } = o;
  const cone = o.cone ?? TAU;
  const center = o.center ?? 0;
  shards(frame, age, n, seed, (i, rnd) => {
    const a = center + (rnd(1) - 0.5) * cone;
    const sp = speed * (0.5 + rnd(2));
    const r0 = o.r0 ?? 0;
    return {
      x: (o.x ?? 0) + Math.cos(a) * r0 + (rnd(6) - 0.5) * (o.jitter ?? 2),
      y: (o.y ?? 0) + Math.sin(a) * r0 + (rnd(7) - 0.5) * (o.jitter ?? 2),
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp + (o.lift ?? 0),
      life: (o.life ?? 3) + Math.floor(rnd(3) * 3),
      size: rnd(4) > (o.big ?? 0.5) ? 2 : 1,
      drag: o.drag ?? 0.8,
      bright: o.bright ?? 1,
    };
  });
}

/** 合図の折れ線: (ax, ay) → (bx, by) を n 折りにした線。grow で先端まで伸び、伸びている先に白い光点 */
function signalBolt(frame, o) {
  const { ax, ay, bx, by, seed } = o;
  const n = o.n ?? 4;
  const amp = o.amp ?? 3;
  const grow = o.grow ?? 1;
  const bright = o.bright ?? 0.85;
  const width = o.width ?? 1.2;
  const len = Math.hypot(bx - ax, by - ay);
  const nx = -(by - ay) / len;
  const ny = (bx - ax) / len;
  const pts = [{ x: ax, y: ay }];
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const side = i % 2 === 0 ? 1 : -1;
    const off = (0.5 + 0.5 * hash1(i, seed)) * amp * side;
    pts.push({ x: ax + (bx - ax) * t + nx * off, y: ay + (by - ay) * t + ny * off });
  }
  pts.push({ x: bx, y: by });
  const last = Math.max(1, Math.round(n * grow));
  for (let i = 0; i < last; i++) {
    const p = pts[i];
    const q = pts[i + 1];
    if (!p || !q) continue;
    streakLine(frame, { ax: p.x, ay: p.y, bx: q.x, by: q.y, bright: bright * (0.75 + 0.25 * (i / last)), width });
  }
  const tip = pts[last];
  if (tip && grow < 1) dot(frame, tip.x, tip.y, 7);
}

/** 放物線で飛んで落ちる土の塊（dirs 1。画面の上へ噴き上がり、重力で戻る） */
function debris(frame, age, o) {
  const { n, seed } = o;
  const ox = o.x ?? 0;
  const oy = o.y ?? 0;
  for (let i = 0; i < n; i++) {
    const rnd = (k) => hash1(i * 13 + k, seed);
    const life = (o.life ?? 6) + Math.floor(rnd(5) * 3);
    if (age < 0 || age > life) continue;
    const a = -Math.PI / 2 + (rnd(1) - 0.5) * (o.cone ?? 2.4);
    const sp = o.speed * (0.55 + 0.7 * rnd(2));
    const g = o.gravity ?? 1.2;
    const x = ox + (rnd(3) - 0.5) * (o.jitter ?? 10) + Math.cos(a) * sp * age;
    const y = oy + Math.sin(a) * sp * age + g * age * age;
    const fade = 1 - age / (life + 1);
    const level = Math.max(2, Math.round(2 + 4 * fade));
    dot(frame, x, y, level);
    dot(frame, x + 1, y, Math.max(1, level - 1));
    if (rnd(4) > 0.4) dot(frame, x, y + 1, Math.max(1, level - 1));
    if (fade > 0.4) dot(frame, x - Math.cos(a) * sp * 0.4, y - (Math.sin(a) * sp + 2 * g * age) * 0.4, Math.max(1, level - 2));
  }
}

/** 点線の輪（電波・探知の輪）。segs に刻んで duty の割合だけ塗る。squash で地面に寝かせる */
function dashedRing(frame, o) {
  const { radius } = o;
  const oy = o.oy ?? 0;
  const squash = o.squash ?? 1;
  const segs = o.segs ?? 16;
  const duty = o.duty ?? 0.5;
  const phase = o.phase ?? 0;
  const width = o.width ?? 1.8;
  const bright = o.bright ?? 0.6;
  const erosion = o.erosion ?? 0;
  const seed = o.seed ?? 31;
  const pad = radius + width + 2;
  paint(
    frame,
    (x, y) => {
      const dx = x / squash;
      const dy = y - oy;
      const d = Math.abs(Math.hypot(dx, dy) - radius);
      if (d > width / 2) return -1;
      const seg = (((Math.atan2(dy, dx) / TAU) * segs + phase) % 1 + 1) % 1;
      if (seg > duty) return -1;
      if (!survives(x, y, erosion, 0.4, seed)) return -1;
      return clamp01(bright * (1 - 0.4 * (d / (width / 2))));
    },
    { bounds: { x0: -pad * squash, y0: oy - pad, x1: pad * squash, y1: oy + pad }, dither: 0, samples: 2 },
  );
}

/** 焦げ跡（段 1〜2 の斑）。(x, y) 中心、半径 r、地面に寝かせて上下を潰す */
function scorch(frame, x, y, r, k, seed) {
  paint(
    frame,
    (px, py) => {
      const d = Math.hypot(px - x, (py - y) * 1.3);
      const rr = r + r * 0.35 * valueNoise(px, py, 6, seed);
      if (d > rr) return -1;
      if (valueNoise(px, py, 3, seed + 1) * 0.8 + (1 - d / rr) * 0.3 - k * 0.5 < 0.18) return -1;
      return 0.12 + 0.07 * (1 - d / rr);
    },
    { bounds: { x0: x - r * 1.4 - 2, y0: y - r * 1.1 - 2, x1: x + r * 1.4 + 2, y1: y + r * 1.1 + 2 }, samples: 2 },
  );
}

/** 地面を這う土煙の輪（潰れた帯。縁はノイズで波打つ土の壁） */
function dustWall(frame, R, w, k, seed) {
  paint(
    frame,
    (x, y) => {
      const a = Math.atan2(y * 1.35, x);
      const crest = R + 6 * valueNoise(Math.cos(a) * 24, Math.sin(a) * 24, 2.2, seed) - 3;
      const d = Math.hypot(x, y * 1.35);
      const q = (crest - d) / w;
      if (q < 0 || q > 1) return -1;
      if (valueNoise(x, y, 4, seed + 1) * 0.7 + (1 - q) * 0.25 - 0.2 - k * 0.8 < 0) return -1;
      return clamp01((q < 0.2 ? 0.6 : 0.46 - q * 0.3) * (1 - k * 0.45));
    },
    { bounds: { x0: -R - 10, y0: -R / 1.35 - 10, x1: R + 10, y1: R / 1.35 + 10 } },
  );
}

// -----------------------------------------------------------------------------
// 地雷原（volley 8 個・扇 45°）
// -----------------------------------------------------------------------------

/** 扇の半角（spreadDeg 45 の半分） */
const FIELD_HALF = 22.5 * DEG;
/** 撒く数 */
const FIELD_COUNT = 8;

/** 扇の i 番目の向き（等間隔） */
function fieldAngle(i) {
  return -FIELD_HALF + (FIELD_HALF * 2 * i) / (FIELD_COUNT - 1);
}

/** 地雷原の発動: 足元の周りに 8 つの信号灯が時計回りに順に灯り、揃った瞬間に一斉に瞬いて土煙が弾ける */
function minefieldCast(frame, f) {
  const N = 9;
  const R = 40;
  const lit = Math.min(FIELD_COUNT, (f + 1) * 2);
  // 危険の点線の輪（地面に寝かせる）。灯りが揃うまでゆっくり回り、揃うと広がって崩れる
  const k = f < 4 ? 0 : (f - 3) / (N - 4);
  dashedRing(frame, { radius: R * (1 + k * 0.35), oy: FEET_Y * 0.4, squash: 1.6, segs: 16, duty: 0.55, phase: f * 0.15, width: 2, bright: 0.5 - k * 0.2, erosion: k * 0.9, seed: 5101 });
  for (let i = 0; i < FIELD_COUNT; i++) {
    const a = -Math.PI / 2 + (i / FIELD_COUNT) * TAU;
    const x = Math.cos(a) * R * 1.6 * (1 + k * 0.35);
    const y = FEET_Y * 0.4 + Math.sin(a) * R * (1 + k * 0.35);
    if (i >= lit) continue;
    const fresh = i >= lit - 2 && f < 4;
    if (f === 4) sparkle(frame, x, y, 3);
    else if (fresh) sparkle(frame, x, y, 2);
    else if (k < 0.8) {
      dot(frame, x, y, 5);
      dot(frame, x + 1, y, 4);
    }
    // 灯った灯の足元の小さな感知の輪
    if (f >= 1 && f <= 5) ring(frame, { ox: x, oy: y, radius: 3 + (f % 2) * 1.5, width: 1.1, squash: 1.4, bright: 0.4, erosion: k * 0.6, seed: 5102 + i });
  }
  // 揃った瞬間の中央の閃きと、足元の土煙
  if (f === 4) sparkle(frame, 0, 0, 4);
  if (f >= 4) {
    const age = f - 4;
    ring(frame, { oy: FEET_Y, radius: 10 + age * 7, width: 3 - age * 0.4, squash: 2, bright: 0.6 - age * 0.08, erosion: Math.min(0.92, age * 0.2), seed: 5103 });
    burst(frame, age, { n: 14, seed: 5104, speed: 4, y: FEET_Y, jitter: 16, life: 3, lift: -1.5 });
  }
}

/**
 * 地雷原の撒き出し（acts[0]、原点 = 自分、+x = 照準）: 8 本の筒の「ぽん」を扇に並べた豪華な発射。
 * 扇の向きごとに短い炎の舌と煙の玉、前へ押す圧の弧、後ろへ吹く反動の土煙。地雷そのものは弾の絵が出すので描かない
 */
function minefieldRelease(frame, f) {
  // 炎の舌: 1 枚目に中央、2 枚目に外側が遅れて開く（8 発の連射の手触り）
  for (let i = 0; i < FIELD_COUNT; i++) {
    const a = fieldAngle(i);
    const delay = Math.abs(i - 3.5) > 2 ? 1 : 0;
    const age = f - delay;
    if (age < 0 || age > 3) continue;
    const len = (22 + 10 * hash1(i, 5201)) * (age === 0 ? 0.7 : age === 1 ? 1 : 0.6);
    spike(frame, { x: Math.cos(a) * HAND, y: Math.sin(a) * HAND, a, len, w: 3.4 - age * 0.5, bright: 0.95 - age * 0.18, erosion: age >= 2 ? 0.3 + (age - 2) * 0.3 : 0, seed: 5202 + i });
    if (age === 0) sparkle(frame, Math.cos(a) * (HAND + 2), Math.sin(a) * (HAND + 2), 2);
  }
  // 煙の玉: 各向きに押し出され、減速してふくらみ、崩れる
  for (let i = 0; i < FIELD_COUNT; i++) {
    const a = fieldAngle(i) + (hash1(i, 5203) - 0.5) * 0.1;
    const t = f - 1;
    if (t < 0) continue;
    const travel = HAND + 18 + 30 * (1 - Math.pow(0.6, t + 1));
    const r = 5 + t * 1.6;
    const e = Math.max(0, (t - 2) * 0.18);
    if (e >= 1) continue;
    blob(frame, Math.cos(a) * travel, Math.sin(a) * travel, r, { bright: t < 2 ? 0.62 : 0.34 - t * 0.02, seed: 5204 + i, rough: 0.4, erosion: e });
  }
  // 前へ押す圧の弧（扇の幅の、潰れた弧 1 本。2 本目は重ねない）
  if (f >= 1 && f <= 5) {
    const age = f - 1;
    const radius = 34 + age * 12;
    paint(
      frame,
      (x, y) => {
        const dx = x / 0.8;
        const a = Math.atan2(y, dx);
        if (Math.abs(a) > FIELD_HALF + 12 * DEG) return -1;
        const d = Math.abs(Math.hypot(dx, y) - radius);
        const w = 3 - age * 0.4;
        if (d > w / 2) return -1;
        if (!survives(x, y, age * 0.2 + (Math.abs(a) / FIELD_HALF) * 0.15, 1 - d / w, 5205)) return -1;
        return clamp01((0.62 - age * 0.08) * (1 - 0.4 * (d / (w / 2))));
      },
      { bounds: { x0: 0, y0: -radius, x1: radius + 4, y1: radius } },
    );
  }
  // 反動: 後ろへ吹く土煙の筋と潰れた輪
  if (f <= 5) {
    ring(frame, { ox: -6 - f * 1.5, radius: 6 + f * 3.5, width: 2.2, squash: 0.5, bright: 0.55 - f * 0.05, erosion: Math.min(0.9, f * 0.12), seed: 5206 });
    for (let i = 0; f <= 3 && i < 5; i++) {
      const side = i - 2;
      const x0 = -10 - f * 5 - hash1(i, 5207) * 6;
      streakLine(frame, { ax: x0, ay: side * 5, bx: x0 - 14 - hash1(i, 5208) * 12, by: side * 7, bright: 0.5 - f * 0.1 });
    }
  }
  // 火の粉: 扇の中へ
  burst(frame, f, { n: 22, seed: 5209, speed: 6, cone: FIELD_HALF * 2.4, x: HAND + 4, life: 4, drag: 0.82 });
}

/** 地雷原の筒口（muzzle。8 発は同じ tick で 1 つにまとまる）: 丸い煙の輪と、短く太い炎、口の光点 */
function minefieldMuzzle(frame, f) {
  const N = 6;
  const k = f / (N - 1);
  if (f <= 2) {
    spike(frame, { a: 0, len: 16 - f * 3, w: 4.5 - f, bright: 0.95 - f * 0.15, erosion: f * 0.25, seed: 5301 });
    blob(frame, 3, 0, 6 - f, { bright: 0.75, seed: 5302, rough: 0.2, erosion: f * 0.3 });
  }
  if (f === 0) sparkle(frame, 2, 0, 3);
  ring(frame, { ox: 6 + f * 2, radius: 5 + f * 3, width: 2.2 - k, squash: 0.6, bright: 0.6 - k * 0.3, erosion: Math.min(0.9, k * 0.9), seed: 5303 });
  if (f >= 2) blob(frame, 10 + f * 2, -f, 4 + f, { bright: 0.3, seed: 5304, rough: 0.45, erosion: k * 0.8 });
  burst(frame, f, { n: 8, seed: 5305, speed: 4, cone: 1.2, x: 4, life: 3 });
}

/**
 * 地雷原の地雷（fly、dirs 1。置かれて待っている絵）: 通常の地雷より大きな円盤。
 * 縁に 8 つの危険の歯（鋸の三角）、中央の信号灯が点いた直後に感知の輪が 2 重ではなく 1 本ずつ大きく広がる
 */
function minefieldFly(frame, f) {
  const R = 8.5;
  const on = f === 0 ? 1 : f === 1 ? 0.55 : 0;
  // 危険の歯: 縁の外へ出る短い三角。ゆっくり 1/8 回る（8 回対称なので 1 巡でつながる）
  const rot = (f / 8) * (TAU / 8);
  for (let i = 0; i < 8; i++) {
    const a = rot + (i / 8) * TAU;
    spike(frame, { x: Math.cos(a) * (R - 1), y: Math.sin(a) * (R - 1), a, len: 4, w: 1.6, bright: 0.6, seed: 5401 + i });
  }
  paint(
    frame,
    (x, y) => {
      const d = Math.hypot(x, y);
      if (d > R) return -1;
      const lit = -(x + y) / (Math.SQRT2 * R);
      if (R - d < 1.3) return lit > -0.2 ? 0.55 : 0.42;
      if (Math.abs(d - R * 0.6) < 0.65) return 0.12;
      if (Math.abs(d - R * 0.32) < 0.55) return 0.14;
      if (d > R * 0.6) return lit > 0.3 ? 0.32 : 0.25;
      if (d < 1.8) return on > 0 ? clamp01(0.7 + 0.3 * on) : 0.16;
      return lit > 0.2 ? 0.46 : 0.37;
    },
    { bounds: { x0: -R - 2, y0: -R - 2, x1: R + 2, y1: R + 2 }, dither: 0 },
  );
  if (f === 0) sparkle(frame, 0, 0, 3);
  if (f === 1) sparkle(frame, 0, 0, 2);
  // 感知の輪（triggerRadius 10 = 20 ドットまで）
  if (f >= 1 && f <= 5) {
    const t = (f - 1) / 4;
    dashedRing(frame, { radius: 12 + t * 9, segs: 12, duty: 0.6, phase: t, width: 1.3, bright: 0.55 - t * 0.28, erosion: t * 0.5, seed: 5410 + f });
  }
}

/** 地雷原の着弾（壁・敵に当たって止まった）: 鉄の筐体の「がん」を大きく。平たい閃き・跳ね返る火花・潰れた輪 */
function minefieldImpact(frame, f) {
  const N = 6;
  const k = f / (N - 1);
  if (f <= 1) {
    for (const s of [-1, 1]) spike(frame, { x: 0, y: 0, a: (Math.PI / 2) * s, len: 11 - f * 3, w: 2.2, bright: 0.9, seed: 5501 });
    spike(frame, { a: Math.PI, len: 9 - f * 2, w: 2.4, bright: 0.85, seed: 5502 });
  }
  if (f === 0) sparkle(frame, 0, 0, 3);
  ring(frame, { radius: 5 + f * 3.5, width: 2 - k, squash: 0.55, bright: 0.6 - k * 0.3, erosion: Math.min(0.9, k * 0.9), seed: 5503 });
  burst(frame, f, { n: 12, seed: 5504, speed: 5, cone: 2.2, center: Math.PI, life: 3 });
}

/**
 * 地雷原の炸裂（blast、dirs 1、半径 60 ドット）: 通常の地雷の炸裂を一段大きく。
 * 星の閃光 → 火柱が昇ってきのこ雲に開く → 衝撃の輪（1 本）が全周へ、地を這う土煙、燃えさしの輪、焦げ跡
 */
function minefieldBlast(frame, f) {
  const N = 12;
  const k = f / (N - 1);
  const R = BLAST_R * (0.35 + 0.65 * easeSwing(Math.min(1, (f + 1) / 4)));
  if (f >= 1) scorch(frame, 0, 0, 24, k, 5601);
  // 地を這う土煙
  if (f >= 1 && f <= 8) dustWall(frame, R, 11 * (1 - k * 0.5), k, 5602);
  // 衝撃の輪（細く速い 1 本。3 枚で端まで届いて消える）
  if (f >= 1 && f <= 4) {
    const t = (f - 1) / 3;
    ring(frame, { radius: 20 + (BLAST_R + 8 - 20) * t, width: 2.4 - t, squash: 1.25, bright: 0.7 - t * 0.3, erosion: 0.1 + t * 0.7, seed: 5603 });
  }
  // 閃光: 長さのばらつく 12 本の針と芯
  if (f <= 1) {
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU + (hash1(i, 5604) - 0.5) * 0.4;
      spike(frame, { y: -2, a, len: (f === 0 ? 30 : 40) * (0.5 + 0.5 * hash1(i, 5605)), w: 3.2, bright: 0.95, erosion: f * 0.4, seed: 5606 + i });
    }
    blob(frame, 0, -2, f === 0 ? 14 : 18, { bright: 0.78, seed: 5607, rough: 0.3, erosion: f * 0.2 });
    sparkle(frame, 0, -2, 4);
  }
  // 火柱 → きのこ雲: 柱の塊が昇り、頂で横へ開く。火（段 6〜5）から煙（段 2〜3）へ落ちる
  if (f >= 1) {
    const t = f - 1;
    const topY = -10 - Math.min(t, 5) * 11 - Math.max(0, t - 5) * 3;
    for (let i = 0; i < 6; i++) {
      const u = i / 5;
      const cy = -4 + (topY + 4) * u * Math.min(1, (t + 1) / 3);
      const r = (8 + 3 * hash1(i, 5608)) * (1 - u * 0.3) * (1 - Math.max(0, t - 4) * 0.12);
      const fire = t < 2 ? 0.78 - u * 0.1 : t < 5 ? 0.6 - (t - 2) * 0.1 - u * 0.05 : 0.3 - (t - 5) * 0.02;
      blob(frame, (hash1(i, 5609) - 0.5) * 6, cy, r, { bright: fire, seed: 5610 + i, rough: 0.35, erosion: Math.max(0, t - 5) * 0.2 + u * 0.03 });
    }
    // 頂の傘: 左右へ開く塊
    if (t >= 2) {
      const open = Math.min(1, (t - 1) / 4);
      for (let i = 0; i < 5; i++) {
        const s = i - 2;
        const cx = s * 11 * open;
        const cy = topY + Math.abs(s) * 3;
        const fire = t < 4 ? 0.62 - Math.abs(s) * 0.05 : 0.36 - (t - 4) * 0.03;
        blob(frame, cx, cy, (12 - Math.abs(s) * 1.5) * (0.7 + 0.3 * open), { bright: fire, seed: 5620 + i, rough: 0.4, erosion: Math.max(0, t - 6) * 0.22 });
      }
    }
  }
  // 燃えさしの輪: 衝撃の輪が過ぎた床に、ちらちら残る火の粒
  if (f >= 3) {
    for (let i = 0; i < 18; i++) {
      if (hash1(i + f * 5, 5630) < (k - 0.3) * 1.3) continue;
      const a = (i / 18) * TAU + hash1(i, 5631) * 0.3;
      const d = 30 + hash1(i, 5632) * 26;
      const x = Math.cos(a) * d;
      const y = Math.sin(a) * d * 0.8;
      dot(frame, x, y, (i + f) % 3 === 0 ? 6 : 4);
      dot(frame, x, y - 1, 3);
    }
  }
  debris(frame, f, { n: 26, seed: 5640, speed: 11, gravity: 0.95, cone: 2.6, jitter: 16, life: 8 });
  burst(frame, f, { n: 20, seed: 5641, speed: 9, life: 3, drag: 0.8, jitter: 12, big: 0.4 });
}

// -----------------------------------------------------------------------------
// 連鎖爆破（detonate ×2 + nova 半径 40）
// -----------------------------------------------------------------------------

/** 足元の爆発の半径（nova 40 論理 px × 2） */
const CHAIN_R = 80;
/** 床いっぱいへ走る合図の届き */
const SIGNAL_R = 130;

/** 連鎖爆破の発動: 足元の危険の縞の輪が 3 拍で締まり（点滅の拍）、締まりきった瞬間に手元の起爆装置が閃く */
function chainBlastCast(frame, f) {
  const N = 8;
  if (f <= 4) {
    const beat = Math.min(2, Math.floor(f / 1.5));
    const radius = 34 - beat * 9 - (f % 2) * 2;
    // 危険の縞: 太い点線を地面に寝かせる。拍ごとに縞がずれて明滅する
    dashedRing(frame, { radius, oy: FEET_Y * 0.5, squash: 1.5, segs: 10, duty: 0.5, phase: beat * 0.5, width: 3.2, bright: 0.5 + beat * 0.1, seed: 5701 });
    // 拍の灯: 頭上に 3 つ並んだ灯が 1 つずつ点く
    for (let i = 0; i <= beat; i++) {
      const x = (i - 1) * 7;
      if (i === beat && f % 2 === 0) sparkle(frame, x, -30, 2);
      else {
        dot(frame, x, -30, 5);
        dot(frame, x + 1, -30, 4);
      }
    }
    return;
  }
  const age = f - 5;
  const k = age / (N - 5);
  if (age === 0) {
    sparkle(frame, HAND * 0.5, 0, 4);
    for (let i = 0; i < 8; i++) spike(frame, { x: HAND * 0.5, a: (i / 8) * TAU + 22.5 * DEG, len: 12 + 6 * hash1(i, 5702), w: 2, bright: 0.9, seed: 5703 + i });
  }
  ring(frame, { radius: 10 + age * 10, width: 2.4 - age * 0.5, bright: 0.7 - k * 0.3, erosion: Math.min(0.9, 0.1 + k * 0.7), seed: 5704 });
  burst(frame, age, { n: 12, seed: 5705, speed: 4, x: HAND * 0.5, life: 2 });
}

/**
 * 連鎖爆破の合図（acts[0] detonate、原点 = 自分）: 通常の起爆を床いっぱいへ広げる。
 * 8 方向へ長い折れ線が枝を出しながら走り、点線の電波の輪が 3 度（時間差で 1 本ずつ）広がる。届いた先で光点が応える
 */
function chainBlastSignal(frame, f) {
  const N = 10;
  const A = 4;
  const k = f < A ? 0 : (f - A + 1) / (N - A + 1);
  if (f <= 1) {
    blob(frame, HAND * 0.5, 0, f === 0 ? 5 : 3.5, { bright: 0.78, seed: 5801, rough: 0 });
    sparkle(frame, HAND * 0.5, 0, f === 0 ? 4 : 3);
  }
  // 折れ線: 8 方向。根元から順に消え、先は届いた所で止まる
  if (f <= 6) {
    const grow = f < A ? easeSwing((f + 1) / A) : 1;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU + 22.5 * DEG + (hash1(i, 5802) - 0.5) * 0.25;
      const r1 = SIGNAL_R * (0.8 + 0.2 * hash1(i, 5803));
      const r0 = 8 + (f >= A ? (f - A + 1) * 26 : 0);
      if (r0 >= r1 - 4) continue;
      signalBolt(frame, { ax: Math.cos(a) * r0, ay: Math.sin(a) * r0, bx: Math.cos(a) * r1, by: Math.sin(a) * r1, seed: 5804 + i * 7 + f, n: 7, amp: 3, grow, width: 1.4, bright: 0.85 * (1 - k * 0.5) });
      // 枝: 中ほどから横へ短く分かれる（床の罠を探して走る）
      const bt = 0.55;
      const br = r1 * bt;
      if (grow > bt + 0.1 && br > r0) {
        const side = i % 2 === 0 ? 1 : -1;
        const ba = a + side * 0.5;
        signalBolt(frame, { ax: Math.cos(a) * br, ay: Math.sin(a) * br, bx: Math.cos(a) * br + Math.cos(ba) * 26, by: Math.sin(a) * br + Math.sin(ba) * 26, seed: 5850 + i, n: 3, amp: 1.6, grow: Math.min(1, (grow - bt) * 2.5), bright: 0.6 * (1 - k * 0.5) });
      }
    }
  }
  // 点線の電波の輪（3 本を時間差で。同時に 2 本までしか見えない）
  for (let j = 0; j < 3; j++) {
    const age = f - j * 2;
    if (age < 0 || age > 4) continue;
    const t = age / 4;
    dashedRing(frame, { radius: 12 + t * (SIGNAL_R + 4), segs: 24, duty: 0.45, phase: age * 0.3 + j * 0.25, width: 1.6, bright: 0.64 - t * 0.28, erosion: t * 0.7, seed: 5860 + j });
  }
  // 届いた先の応え（光点と小さな輪）
  if (f >= A - 1 && f <= A + 2) {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU + 22.5 * DEG + (hash1(i, 5802) - 0.5) * 0.25;
      const r1 = SIGNAL_R * (0.8 + 0.2 * hash1(i, 5803));
      const x = Math.cos(a) * r1;
      const y = Math.sin(a) * r1;
      const age = f - (A - 1);
      if (age <= 1) sparkle(frame, x, y, age === 0 ? 3 : 2);
      ring(frame, { ox: x, oy: y, radius: 3 + age * 3, width: 1.2, bright: 0.5 - age * 0.1, erosion: age * 0.25, seed: 5870 + i });
    }
  }
  if (f >= A) burst(frame, f - A, { n: 16, seed: 5880, speed: 2, life: 2, jitter: SIGNAL_R * 1.4, bright: 0.6 });
}

/** 足元の連鎖の火の玉の位置（時計回りに 8 つ、少しずつ内外へずらす） */
function chainSpot(i) {
  const a = -Math.PI / 2 + (i / 8) * TAU + (hash1(i, 5901) - 0.5) * 0.2;
  const d = CHAIN_R * (0.5 + 0.15 * hash1(i, 5902));
  return { x: Math.cos(a) * d, y: Math.sin(a) * d * 0.85, a };
}

/** 連鎖の火の玉 1 つ（age 0 で閃き、昇ってふくらみ、煙に落ちる） */
function chainPop(frame, x, y, age, seed) {
  if (age < 0 || age > 6) return;
  if (age === 0) {
    for (let i = 0; i < 6; i++) spike(frame, { x, y, a: (i / 6) * TAU + hash1(i, seed) * 0.5, len: 15 + 8 * hash1(i, seed + 1), w: 2.8, bright: 0.9, seed: seed + 2 + i });
    blob(frame, x, y, 10, { bright: 0.78, seed: seed + 10, rough: 0.25 });
    sparkle(frame, x, y, 3);
    return;
  }
  const t = age - 1;
  for (let j = 0; j < 3; j++) {
    const cy = y - 2 - t * (4 + j * 2.5) - j * 6;
    const r = (12 - j * 2) * (0.85 + 0.15 * t);
    const fire = t < 2 ? 0.74 - j * 0.06 : 0.4 - (t - 2) * 0.06;
    blob(frame, x + (hash1(j, seed + 20) - 0.5) * 5, cy, r, { bright: fire, seed: seed + 21 + j, rough: 0.35, erosion: Math.max(0, t - 2) * 0.22 });
  }
}

/**
 * 連鎖爆破の足元（acts[1] nova 半径 40、原点 = 自分）: 中央の閃きから、8 つの火の玉が時計回りに順に噴く（連鎖）。
 * 衝撃の輪が 1 本、半径まで広がり、土の塊が飛んで落ちる
 */
function chainBlastNova(frame, f) {
  const N = 12;
  const k = f / (N - 1);
  if (f <= 1) {
    blob(frame, 0, 0, f === 0 ? 12 : 16, { bright: 0.78, seed: 5910, rough: 0.3, erosion: f * 0.35 });
    sparkle(frame, 0, 0, f === 0 ? 4 : 3);
  }
  // 衝撃の輪（1 本）
  if (f <= 5) {
    const t = f / 5;
    ring(frame, { radius: 16 + (CHAIN_R + 6 - 16) * easeSwing(t), width: 3.2 - t * 1.6, squash: 1.18, bright: 0.72 - t * 0.3, erosion: 0.05 + t * 0.8, seed: 5911 });
  }
  // 連鎖: 半フレームずつずれて時計回りに噴く
  for (let i = 0; i < 8; i++) {
    const s = chainSpot(i);
    chainPop(frame, s.x, s.y, f - 1 - Math.floor(i * 0.6), 5920 + i * 30);
  }
  // 連鎖の導火（隣の火の玉へ走る短い合図の折れ線。点いた所から次へ）
  for (let i = 0; i < 7; i++) {
    const at = 1 + Math.floor(i * 0.6);
    if (f !== at) continue;
    const p = chainSpot(i);
    const q = chainSpot(i + 1);
    signalBolt(frame, { ax: p.x, ay: p.y, bx: q.x, by: q.y, seed: 5960 + i, n: 3, amp: 2, bright: 0.7 });
  }
  debris(frame, f - 1, { n: 26, seed: 5970, speed: 9, gravity: 0.9, cone: 2.8, jitter: CHAIN_R * 1.1, life: 7 });
  burst(frame, f, { n: 26, seed: 5971, speed: 8, r0: 10, life: 4, drag: 0.82 });
  if (k > 0.6) burst(frame, f - 7, { n: 12, seed: 5972, speed: 1.2, jitter: CHAIN_R * 1.3, life: 3, lift: -1, bright: 0.5 });
}

/** 連鎖爆破の地面: 当たりの円の縁（土煙の壁）と、8 つの焦げ跡、中央の大きな焦げ */
function chainBlastGround(frame, f) {
  const N = 12;
  const k = f / (N - 1);
  const R = CHAIN_R * (0.4 + 0.6 * easeSwing(Math.min(1, (f + 1) / 5)));
  scorch(frame, 0, 0, 16, k, 5980);
  for (let i = 0; i < 8; i++) {
    const s = chainSpot(i);
    if (f - 1 - Math.floor(i * 0.6) < 0) continue;
    scorch(frame, s.x, s.y, 9, k, 5981 + i);
  }
  if (f >= 1 && f <= 9) dustWall(frame, R, 12 * (1 - k * 0.5), k, 5990);
}

// -----------------------------------------------------------------------------
// 罠師の勘（持続。引き寄せ半径 50）: 探知の掃引・頭上の信号灯・引き寄せの山形
// -----------------------------------------------------------------------------

/** 探知の半径（minePull 50 × 2） */
const SENSE_R = 100;
/** 纏いの 1 巡のフレーム数 */
const SENSE_N = 12;

/**
 * 掃引（レーダーの扇）: 先の線が最も明るく、後ろへ尾を引いて薄れる。squash で地面に寝かせる。
 * head = 先の角、tail = 尾の長さ（ラジアン）
 */
function sweep(frame, o) {
  const { R, head, tail } = o;
  const oy = o.oy ?? 0;
  const squash = o.squash ?? 1;
  const bright = o.bright ?? 0.6;
  const inner = o.inner ?? 4;
  paint(
    frame,
    (x, y) => {
      const dx = x / squash;
      const dy = y - oy;
      const r = Math.hypot(dx, dy);
      if (r > R || r < inner) return -1;
      const behind = (((head - Math.atan2(dy, dx)) % TAU) + TAU) % TAU;
      if (behind > tail) return -1;
      const u = behind / tail;
      // 先の線（1〜2 ドット）は明るく、扇の面は塗らずに同心の細い弧だけ（残光の目盛り。面にすると重い）
      const lineW = 1.6 / Math.max(6, r);
      if (behind < lineW) return clamp01(bright * 1.1);
      const ringGap = o.gap ?? 8;
      if (r % ringGap > 1.1) return -1;
      // 弧は尾へ行くほど短く途切れる
      if (u > 0.85 - 0.25 * hash1(Math.floor(r / ringGap), 6300)) return -1;
      return clamp01(bright * 0.7 * (1 - u * 0.8));
    },
    { bounds: { x0: -R * squash - 2, y0: oy - R - 2, x1: R * squash + 2, y1: oy + R + 2 }, dither: 0.02 },
  );
}

/** 内向きの山形（引き寄せ）。(x, y) の先が中心（原点）を向く「く」の字 */
function chevronIn(frame, x, y, size, bright) {
  const a = Math.atan2(-y, -x);
  const c = Math.cos(a);
  const s = Math.sin(a);
  for (const side of [-1, 1]) {
    const bx = x - c * size * 0.8 + -s * side * size;
    const by = y - s * size * 0.8 + c * side * size;
    streakLine(frame, { ax: bx, ay: by, bx: x, by: y, width: 1.4, bright });
  }
}

/**
 * 罠師の勘の発動（dirs 1）: 探知の掃引が半径 100 を 1 周し、掃いた所に「罠の反応」が点々と灯って小さな輪で応える。
 * 1 周しきると外周の点線の輪が締まって消える
 */
function trapperSenseCast(frame, f) {
  const N = 10;
  const A = 6;
  if (f < A) {
    const p = easeSwing((f + 1) / A);
    const head = -Math.PI / 2 + TAU * p;
    sweep(frame, { R: SENSE_R, head, tail: 1.3, bright: 0.72, squash: 1 });
    ring(frame, { radius: SENSE_R, width: 1.6, bright: 0.45, seed: 6001 });
    ring(frame, { radius: SENSE_R * 0.5, width: 1.1, bright: 0.3, seed: 6002 });
  } else {
    const k = (f - A + 1) / (N - A);
    dashedRing(frame, { radius: SENSE_R * (1 - k * 0.55), segs: 24, duty: 0.5, phase: k, width: 2, bright: 0.55 - k * 0.2, erosion: k * 0.7, seed: 6003 });
  }
  // 反応: 掃いた角の後ろで灯る 7 つの点
  const swept = f < A ? easeSwing((f + 1) / A) : 1;
  for (let i = 0; i < 7; i++) {
    const at = hash1(i, 6010) * 0.9 + 0.05;
    if (at > swept) continue;
    const a = -Math.PI / 2 + TAU * at;
    const d = SENSE_R * (0.35 + 0.55 * hash1(i, 6011));
    const x = Math.cos(a) * d;
    const y = Math.sin(a) * d;
    const found = Math.floor(at * A);
    const age = f - found;
    if (age === 0) sparkle(frame, x, y, 2);
    else if (age < 6) {
      dot(frame, x, y, 5);
      ring(frame, { ox: x, oy: y, radius: 3 + age * 2, width: 1.1, bright: 0.5 - age * 0.07, erosion: age * 0.15, seed: 6012 + i });
    }
  }
  if (f === 0) sparkle(frame, 0, 0, 3);
}

/** 頭上の信号灯（地雷の信号灯と同じ言葉）の高さ */
const LAMP_Y = -34;

/**
 * 罠師の勘の纏い（dirs 1、持続中ずっと）: 頭上の信号灯が 1 巡に 2 度瞬き、周りの 4 つの照準の角が 1/4 回る。
 * 斜め 4 方で引き寄せの山形が外から内へ流れる（4 回対称なので 1 巡で継ぎ目が出ない）
 */
function trapperSenseSustain(frame, f) {
  const cycle = f / SENSE_N;
  // 信号灯: 灯の台（小さな円盤）と、瞬き
  paint(frame, (x, y) => (Math.hypot(x, y - LAMP_Y) <= 3 ? 0.3 : -1), { bounds: { x0: -5, y0: LAMP_Y - 5, x1: 5, y1: LAMP_Y + 5 }, dither: 0 });
  const blink = f === 0 || f === 6;
  if (blink) sparkle(frame, 0, LAMP_Y, 3);
  else if (f === 1 || f === 7) sparkle(frame, 0, LAMP_Y, 2);
  else dot(frame, 0, LAMP_Y, 4);
  if (f === 1 || f === 7) ring(frame, { oy: LAMP_Y, radius: 6, width: 1.1, bright: 0.45, seed: 6101 });
  // 照準の角（L 字の括弧）: 半径 30 で回る
  const turn = cycle * (TAU / 4);
  for (let i = 0; i < 4; i++) {
    const a = turn + (i / 4) * TAU;
    const r = 30;
    const cx = Math.cos(a) * r;
    const cy = Math.sin(a) * r * 0.9;
    // 括弧の 2 辺: 接線方向と、内へ向かう方向
    const tx = -Math.sin(a);
    const ty = Math.cos(a);
    const inx = -Math.cos(a);
    const iny = -Math.sin(a);
    streakLine(frame, { ax: cx + tx * 6, ay: cy + ty * 6, bx: cx, by: cy, width: 1.3, bright: 0.62 });
    streakLine(frame, { ax: cx + inx * 6, ay: cy + iny * 6, bx: cx, by: cy, width: 1.3, bright: 0.62 });
  }
  // 引き寄せの山形: 斜め 4 方で外（半径 54）から内（半径 38）へ流れる。1 巡で 2 つ流れる
  for (let i = 0; i < 4; i++) {
    // 斜め 4 方（真上は信号灯と重なるので外す）
    const a = (i / 4) * TAU + Math.PI / 4;
    for (let j = 0; j < 2; j++) {
      const t = (cycle * 2 + j * 0.5) % 1;
      const d = 54 - t * 18;
      const x = Math.cos(a) * d;
      const y = Math.sin(a) * d * 0.85;
      chevronIn(frame, x, y, 4.5, 0.62 * Math.sin(Math.PI * t));
    }
  }
}

/** 纏いの足元: 地面に寝かせた探知の輪と、1 巡で 1 周する掃引の扇、16 の刻み（掃引が 1 周するので継ぎ目が出ない） */
function trapperSenseGround(frame, f) {
  const cycle = f / SENSE_N;
  const R = 34;
  const squash = 1.6;
  ring(frame, { oy: FEET_Y * 0.5, radius: R, width: 1.6, squash, bright: 0.4, seed: 6201 });
  sweep(frame, { R: R - 1, oy: FEET_Y * 0.5, squash, head: -Math.PI / 2 + cycle * TAU, tail: 1.4, bright: 0.55, inner: 6, gap: 6 });
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * TAU;
    const long = i % 4 === 0;
    const r0 = R + 2;
    const r1 = R + (long ? 6 : 4);
    streakLine(frame, { ax: Math.cos(a) * r0 * squash, ay: FEET_Y * 0.5 + Math.sin(a) * r0, bx: Math.cos(a) * r1 * squash, by: FEET_Y * 0.5 + Math.sin(a) * r1, width: 1.2, bright: long ? 0.42 : 0.3 });
  }
}

// -----------------------------------------------------------------------------
// 表
// -----------------------------------------------------------------------------

/**
 * 奥義 → 絵（render/fxMotions.ts の buildUltimateFx が読む）。life は流し切る秒、base は描いたときの大きさ（論理 px）。
 * 地雷原の acts[0] は volley（撒き出しの絵は拡縮しない）で、地雷は shots[0]。連鎖爆破の acts[0] は起爆の合図（自分の位置）、
 * acts[1] は足元の爆発（base = nova の半径）。罠師の勘は持続（cast と纏い）
 */
const FX = {
  moveset: "trapper",
  ultimates: {
    "trapper.minefield": {
      ramp: "fire",
      cast: { sheet: "trapperUlt.minefieldCast", life: 0.4 },
      acts: [{ sheet: "trapperUlt.minefield", life: 0.45, base: 0, pivot: "pos" }],
      shots: {
        0: {
          fly: "trapperUlt.minefieldFly",
          period: 0.8,
          base: 3,
          muzzle: "trapperUlt.minefieldMuzzle",
          impact: "trapperUlt.minefieldImpact",
          blast: "trapperUlt.minefieldBlast",
          blastBase: 30,
          ramp: "fire",
        },
      },
    },
    "trapper.chainBlast": {
      ramp: "fire",
      cast: { sheet: "trapperUlt.chainBlastCast", life: 0.4 },
      acts: [
        { sheet: "trapperUlt.chainBlastSignal", life: 0.5, base: 0, pivot: "pos" },
        { sheet: "trapperUlt.chainBlast", life: 0.6, base: CHAIN_R / 2, pivot: "pos", ground: "trapperUlt.chainBlastGround" },
      ],
    },
    "trapper.trapperSense": {
      ramp: "light",
      cast: { sheet: "trapperUlt.trapperSenseCast", life: 0.5 },
      sustain: { sheet: "trapperUlt.trapperSense", period: 1.0, ground: "trapperUlt.trapperSenseGround" },
    },
  },
};

export const ATLAS = {
  key: "trapperUlt",
  fx: FX,
  sheets: [
    // 地雷原
    { key: "trapperUlt.minefieldCast", dirs: 1, frames: 9, active: 0, size: 176, draw: minefieldCast },
    { key: "trapperUlt.minefield", dirs: DIRS, frames: 9, active: 3, size: 176, draw: minefieldRelease },
    { key: "trapperUlt.minefieldFly", dirs: 1, frames: 8, active: 0, size: 56, draw: minefieldFly },
    { key: "trapperUlt.minefieldMuzzle", dirs: DIRS, frames: 6, active: 0, size: 64, draw: minefieldMuzzle },
    { key: "trapperUlt.minefieldImpact", dirs: DIRS, frames: 6, active: 0, size: 56, draw: minefieldImpact },
    { key: "trapperUlt.minefieldBlast", dirs: 1, frames: 12, active: 0, size: 2 * (BLAST_R + 36), draw: minefieldBlast },
    // 連鎖爆破
    { key: "trapperUlt.chainBlastCast", dirs: 1, frames: 8, active: 0, size: 112, draw: chainBlastCast },
    { key: "trapperUlt.chainBlastSignal", dirs: 1, frames: 10, active: 4, size: 2 * (SIGNAL_R + 16), draw: chainBlastSignal },
    { key: "trapperUlt.chainBlast", dirs: 1, frames: 12, active: 4, size: 2 * (CHAIN_R + 36), draw: chainBlastNova },
    { key: "trapperUlt.chainBlastGround", dirs: 1, frames: 12, active: 4, size: 2 * (CHAIN_R + 20), draw: chainBlastGround },
    // 罠師の勘
    { key: "trapperUlt.trapperSenseCast", dirs: 1, frames: 10, active: 0, size: 2 * (SENSE_R + 10), draw: trapperSenseCast },
    { key: "trapperUlt.trapperSense", dirs: 1, frames: SENSE_N, active: 0, size: 136, draw: trapperSenseSustain },
    { key: "trapperUlt.trapperSenseGround", dirs: 1, frames: SENSE_N, active: 0, size: 136, draw: trapperSenseGround },
  ],
};
