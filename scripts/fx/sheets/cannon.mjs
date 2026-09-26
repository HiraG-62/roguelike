// 大筒（moveset "cannon"）のエフェクト。docs/ideas/fx-sprites.md 9 章。手本は sword.mjs、銃の作法は sidearm.mjs
// 単位は絵のドット（論理 0.5px）。当たり判定・弾の数値（weapons/WEAPON/movesets/cannon.json・弾の表）× 2 が目安
//
// 大筒は「至近で散弾を叩き込む重い銃」。片手銃（細い針の閃光・細い曳光）と見分けがつくように:
//   - 閃光は横に広い扇（銃口が太い）。撃つたびに大きな煙の塊が前へ膨らむ
//   - 弾は 1 粒ずつ出る散弾なので、曳光は短く太い鉛玉（散弾銃）/ 不揃いに回る礫（喇叭銃）
//   - 近接は刃を持たない重い打撃: 至近撃ちの円い爆風・筒の突き・銃床と砲身の振り回し。白い刃の縁は描かない
//
// 部品:
//   扇の閃光（fanFlash）: 銃口から前へ開く太い針の束 + 根元の扇形の塊。散弾銃の閃光・至近撃ちの爆炎
//   漏斗の閃光（funnelFlash）: 喇叭の口（縦に広い口）から前へ広がる、縁のぎざぎざな炎
//   煙の塊（smokePuff）: 段 2〜3 の丸い塊。縁がノイズで波打ち、古くなると中から抜ける
//   散弾の殻（shell）: 4 ドットの筒と真鍮の口金。回りながら横へ飛ぶ
import { easeSwing, lens, ring, shards, sparkle, streakLine } from "../shapes.mjs";
import { clamp01, dot, hash1, paint, valueNoise } from "../raster.mjs";
import { DEG, DIRS, WIDE_DIRS } from "../motifs.mjs";

const TAU = Math.PI * 2;
/** 弾の絵の方向の数（鉛玉は丸いが、尾があるので 24 方向だと角のずれが見える） */
const SHOT_DIRS = 32;
/** 構えた銃口の位置（自分の中心から前へ）。片手銃より長い筒なので少し遠い */
const HAND = 22;

// -----------------------------------------------------------------------------
// 共通の部品
// -----------------------------------------------------------------------------

/** 崩れの判定（shapes.mjs の survives と同じ考え。export されていないのでここに持つ） */
function survives(x, y, erosion, nearCore, seed) {
  if (erosion <= 0) return true;
  const n = valueNoise(x, y, 3.5, seed) * 0.6 + valueNoise(x, y, 1.4, seed + 7) * 0.2;
  return n + nearCore * 0.45 - erosion * 1.15 > 0;
}

/** 閃光の針 1 本: (x, y) から角 a へ長さ len、根元の半幅 w で先へ細る三角。芯が明るく、先ほど暗い */
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

/** 円い閃光の芯（半径 r）。中心ほど明るい */
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

/**
 * 前へ押し出す圧の弧（潰れた楕円の前側だけ）。全周で描くと閃光の横に輪がぶら下がって見えるので、
 * 進む向き（+x）の ±spread だけ残す
 */
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
 * 扇の閃光: (x, y) から前（角 a）へ ±spread に開く n 本の太い針と、根元の扇形の塊。
 * 中央の針ほど長い。太い銃口から一気に吐き出す散弾の炎の形（片手銃の菱形・細い針と見分ける）
 */
function fanFlash(frame, o) {
  const { x = 0, y = 0, a = 0, spread, len, n, w, seed } = o;
  const bright = o.bright ?? 1;
  const erosion = o.erosion ?? 0;
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : (i / (n - 1)) * 2 - 1;
    const ang = a + t * spread + (hash1(i, seed) - 0.5) * 0.12;
    const l = len * (1 - 0.42 * Math.abs(t) ** 1.4) * (0.82 + 0.3 * hash1(i, seed + 1));
    spike(frame, { x, y, a: ang, len: l, w: w * (1 - 0.3 * Math.abs(t)), bright: bright * (0.95 - 0.2 * Math.abs(t)), erosion, seed: seed + i });
  }
  // 根元の扇形の塊: 半径 len の 4 割まで、角の端ほど短い。中心から外へ暗くなる（白は芯の flashCore だけ）
  const R = len * 0.42;
  const sp = spread + 8 * DEG;
  paint(
    frame,
    (px, py) => {
      const dx = px - x;
      const dy = py - y;
      const r = Math.hypot(dx, dy);
      let da = Math.atan2(dy, dx) - a;
      if (da > Math.PI) da -= TAU;
      if (da < -Math.PI) da += TAU;
      const t = Math.abs(da) / sp;
      if (t > 1) return -1;
      const rr = R * (1 - 0.45 * t * t);
      if (r > rr) return -1;
      if (!survives(px, py, erosion, 1 - r / rr, seed + 50)) return -1;
      return clamp01((1 - r / rr) ** 0.7 * 0.78 * bright * (1 - 0.3 * t));
    },
    { bounds: { x0: x - R - 2, y0: y - R - 2, x1: x + R + 2, y1: y + R + 2 } },
  );
}

/**
 * 煙の塊（段 2〜3）: (x, y) 中心、半径 r。縁はノイズで波打ち、age（0..1）で中から抜けて消える。
 * 白や明部を使わない。重ねると大きな煙の雲になる
 */
function smokePuff(frame, o) {
  const { x, y, r, seed } = o;
  const age = o.age ?? 0;
  const bright = o.bright ?? 0.26;
  paint(
    frame,
    (px, py) => {
      const d = Math.hypot(px - x, py - y) / r;
      if (d > 1.2) return -1;
      const n = valueNoise(px, py, 3, seed) * 0.6 + valueNoise(px, py, 1.6, seed + 3) * 0.3;
      if (d > 0.72 + n * 0.5) return -1;
      if (age > 0 && n * 0.9 + (1 - d) * 0.25 - age * 1.05 < 0) return -1;
      // 縁の 1 段だけ暗く、内側に少し明るいむら（段 3）
      const rim = d > 0.62 + n * 0.5 ? 0.62 : 1;
      // 中は細かいむら（べた塗りの丸に見せない）
      const mottle = 0.55 + 0.9 * valueNoise(px, py, 1.3, seed + 9);
      return clamp01(bright * rim * mottle * (1 - age * 0.35));
    },
    { bounds: { x0: x - r * 1.3, y0: y - r * 1.3, x1: x + r * 1.3, y1: y + r * 1.3 }, samples: 2 },
  );
}

/**
 * 煙の雲: count 個の塊を、中心 (cx, cy) から前（角 a）へ ±spread の扇に置き、age（0..1）で前へ流しつつ膨らませる。
 * 塊の位置・大きさはハッシュで決まる（決定的）
 */
function smokeCloud(frame, o) {
  const { cx = 0, cy = 0, a = 0, count, dist, r, age, seed } = o;
  const spread = o.spread ?? 35 * DEG;
  const drift = o.drift ?? 10;
  const grow = o.grow ?? 1;
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0 : (i / (count - 1)) * 2 - 1;
    const ang = a + t * spread + (hash1(i, seed) - 0.5) * 0.3;
    const d = dist * (0.55 + 0.6 * hash1(i, seed + 1)) + drift * age * (0.6 + 0.6 * hash1(i, seed + 2));
    const rr = r * (0.7 + 0.5 * hash1(i, seed + 3)) * (1 + grow * age);
    smokePuff(frame, { x: cx + Math.cos(ang) * d, y: cy + Math.sin(ang) * d, r: rr, age: Math.min(1, age * (0.8 + 0.5 * hash1(i, seed + 4))), seed: seed + i * 17, bright: o.bright });
  }
}

/**
 * 散弾の殻: (x, y) の 4 ドットの筒。spin（0..3）で 45° ずつ回る。口金（真鍮）の端が段 5、筒は段 3〜4。
 * 片手銃の薬莢より太く長い（大きな殻が落ちる重さ）
 */
function shell(frame, x, y, spin, fade = 0) {
  const k = ((spin % 4) + 4) % 4;
  const dirs = [
    [1, 0],
    [0.7, 0.7],
    [0, 1],
    [-0.7, 0.7],
  ];
  const [cx, cy] = dirs[k] ?? [1, 0];
  const hi = Math.max(3, 5 - Math.round(fade * 2));
  // 筒は太さ 2（直交方向にもう 1 列）
  const nx = -cy;
  const ny = cx;
  for (let j = -1; j <= 2; j++) {
    const lv = j === 2 ? hi : Math.max(2, hi - 1 - (j < 0 ? 1 : 0));
    dot(frame, x + cx * j, y + cy * j, lv);
    dot(frame, x + cx * j + nx * 0.9, y + cy * j + ny * 0.9, Math.max(2, lv - 1));
  }
}

/** 横（+y）へ飛ぶ殻。age（フレーム）で放物線を描き、回りながら落ちる */
function ejectShell(frame, age, o) {
  if (age < 0 || age > o.life) return;
  const t = age;
  const x = o.x - o.back * t;
  const y = o.y + o.side * t - 0.35 * t * t * o.fall;
  shell(frame, x, y, o.spin + t, t / (o.life + 1));
}

/**
 * 鈍い衝撃の星: (x, y) を中心に n 本のトゲ（長さはハッシュでばらす）+ 芯。刃ではないので白は芯の中心だけ
 */
function bluntStar(frame, o) {
  const { x = 0, y = 0, R, n, seed } = o;
  const bright = o.bright ?? 1;
  const rot = o.rot ?? 0;
  for (let i = 0; i < n; i++) {
    const a = rot + ((i + (hash1(i, seed) - 0.5) * 0.5) / n) * TAU;
    const long = i % 2 === 0 ? 1 : 0.55;
    spike(frame, { x, y, a, len: R * long * (0.7 + 0.5 * hash1(i, seed + 1)), w: (o.w ?? 2.6) * (0.8 + 0.4 * hash1(i, seed + 2)), bright: bright * 0.9, erosion: o.erosion ?? 0, seed: seed + i });
  }
  flashCore(frame, x, y, o.core ?? R * 0.28, bright);
}

/** 画面に揃えて昇る細い煙（dirs 1 のシート用）。段 2〜3 だけ */
function smokeWisp(frame, o) {
  const { x0, y0, height, width, age, seed } = o;
  const sway = o.sway ?? 3;
  const bright = o.bright ?? 0.34;
  const rise = age * (o.rise ?? 8);
  paint(
    frame,
    (x, y) => {
      const h = y0 - rise - y;
      if (h < 0 || h > height) return -1;
      const u = h / height;
      const cx = x0 + Math.sin(u * 5.2 + seed + age * 3) * sway * u + (o.lean ?? 0) * u;
      const w = width * (0.6 + 0.8 * u) * (1 + age * 0.5);
      const d = Math.abs(x - cx);
      if (d > w) return -1;
      if (valueNoise(x, y + rise, 2.6, seed) * 0.8 + (1 - u) * 0.3 - age * 0.75 - u * 0.25 < 0) return -1;
      return clamp01(bright * (1 - d / w) ** 0.5 * (1 - u * 0.4) * (1 - age * 0.5));
    },
    { bounds: { x0: x0 - sway - width * 3 - 6, y0: y0 - rise - height - 1, x1: x0 + sway + width * 3 + 6 + Math.abs(o.lean ?? 0), y1: y0 - rise + 1 }, samples: 2 },
  );
}

// -----------------------------------------------------------------------------
// 弾 2 種の数値。1 論理 px = 2 ドット、半径 2 → 直径 4 ドット（絵は少し大きめに太らせる）
// -----------------------------------------------------------------------------

/**
 * tail = 尾の長さ（270px/秒 × 0.04 秒 ≈ 22 ドットだが、散弾の粒は「短く太く」見せたいので半分ほど）、
 * R = 弾の半径、tailHalf = 尾の根元の半幅、spark / chip = 着弾・命中の粒の数、ringR = 命中の輪の大きさ
 */
const SHOTS = {
  // 散弾銃: 整った丸い鉛玉。短い太い尾
  shotgun: { tail: 11, R: 2.9, tailHalf: 1.9, flick: 0.12, frames: 4, period: 0.1, spark: 8, sparkSpeed: 3, chip: 6, ringR: 6, seed: 3100 },
  // 喇叭銃: 不揃いな礫が回りながら飛ぶ。尾は途切れた火の粉
  blunderbuss: { tail: 9, R: 3.7, tailHalf: 1.4, flick: 0.25, frames: 6, period: 0.12, spark: 11, sparkSpeed: 3.6, chip: 9, ringR: 6.5, seed: 3200 },
};

/**
 * 鉛玉（散弾銃の 1 粒）: 原点 = 弾の中心、+x = 進む向き。丸い玉（芯だけ白、縁は段 3 の鈍い鉛）と、
 * 後ろへ短く太く細る尾。尾は根元から一気に暗くなる（速い細い曳光ではなく、重い粒）
 */
function leadBall(frame, f, g) {
  const len = g.tail * (1 + (hash1(f, g.seed) - 0.5) * 2 * g.flick);
  const R = g.R;
  paint(
    frame,
    (x, y) => {
      if (x > R + 1 || x < -len - 1) return -1;
      let v = -1;
      // 光は少し前寄り（進む向きに照り返す）
      const d = Math.hypot(x - 0.4, y) / R;
      if (d <= 1) v = clamp01(1.02 - d * 0.78);
      if (x < 0) {
        const u = -x / len;
        if (u <= 1) {
          const hw = g.tailHalf * (1 - u) ** 0.7 + 0.35;
          const ay = Math.abs(y);
          if (ay <= hw) v = Math.max(v, clamp01((1 - ay / hw) ** 0.6 * 0.58 * (1 - u) ** 1.3 + 0.1));
        }
      }
      return v;
    },
    { bounds: { x0: -len - 2, y0: -R - 2, x1: R + 2, y1: R + 2 }, dither: 0.03 },
  );
  // 尾の横に 1 つだけ火の粉（フレームごとに位置を変える）
  const ex = -len * (0.5 + 0.4 * hash1(f, g.seed + 1));
  const ey = (hash1(f, g.seed + 2) > 0.5 ? 1 : -1) * (g.tailHalf + 1.5);
  dot(frame, ex, ey, 4);
}

/**
 * 礫（喇叭銃の 1 粒）: 角ばった不揃いな塊がフレームごとに回る（転がりながら飛ぶ）。
 * 面ごとに明るさを変えて角を立て、尾は滑らかな曳光ではなく途切れた火の粉の点列
 */
function gravel(frame, f, g) {
  const R = g.R;
  const V = 5;
  const rot = f * (TAU / g.frames) * 1.5;
  paint(
    frame,
    (x, y) => {
      const r = Math.hypot(x, y);
      if (r > R * 1.35) return -1;
      const a = Math.atan2(y, x) - rot;
      const t = (((a / TAU) * V) % V + V) % V;
      const i0 = Math.floor(t);
      const fr = t - i0;
      // 頂点ごとの半径を直線でつなぐ（丸くせず角を残す）
      const r0 = R * (0.55 + 0.7 * hash1(i0 % V, g.seed + 5));
      const r1 = R * (0.55 + 0.7 * hash1((i0 + 1) % V, g.seed + 5));
      const edge = r0 + (r1 - r0) * fr;
      if (r > edge) return -1;
      // 面ごとに明暗をはっきり分ける（丸い玉ではなく角ばった礫に見せる）。縁の 1 ドットは暗い
      const facet = 0.3 + 0.6 * hash1(i0 + f * 3, g.seed + 6);
      if (edge - r < 0.9) return clamp01(facet * 0.55);
      return clamp01(facet + (r < 0.9 ? 0.25 : 0));
    },
    { bounds: { x0: -R * 1.5, y0: -R * 1.5, x1: R * 1.5, y1: R * 1.5 } },
  );
  // 短い暗い尾（段 2〜3）
  paint(
    frame,
    (x, y) => {
      if (x > -R * 0.6 || x < -g.tail) return -1;
      const u = (-x - R * 0.6) / (g.tail - R * 0.6);
      const hw = g.tailHalf * (1 - u) + 0.3;
      if (Math.abs(y) > hw) return -1;
      return clamp01(0.36 * (1 - u) + 0.08);
    },
    { bounds: { x0: -g.tail - 2, y0: -4, x1: 0, y1: 4 }, dither: 0 },
  );
  // 途切れた火の粉の点列: 後ろへ 3 つ。フレームごとに上下にぶれる
  for (let i = 0; i < 3; i++) {
    const x = -g.tail - 2 - i * 4 - hash1(i + f * 5, g.seed + 7) * 2;
    const y = (hash1(i + f * 7, g.seed + 8) - 0.5) * 5;
    dot(frame, x, y, 5 - i);
  }
}

// -----------------------------------------------------------------------------
// 銃口の閃光。原点 = 弾が出た位置（銃口の少し先）、+x = 撃った向き
// -----------------------------------------------------------------------------

/**
 * 散弾銃: 横に広い整った扇（9 本の太い針）と円い芯。すぐ前へ大きな煙の雲が膨らみ、
 * 横へ散弾の殻が 1 つ飛ぶ（ポンプで排莢）
 */
function muzzleShotgun(frame, f) {
  const N = 7;
  if (f <= 2) {
    const s = f === 0 ? 0.85 : f === 1 ? 1 : 0.6;
    fanFlash(frame, { x: -3, spread: 50 * DEG, len: 30 * s, n: 11, w: 3.4 * s, seed: 3111, bright: f === 2 ? 0.8 : 1 });
    flashCore(frame, -3, 0, 5 * s, 1);
    if (f <= 1) sparkle(frame, -2, 0, f === 0 ? 3 : 4);
  }
  if (f >= 1 && f <= 4) {
    const age = f - 1;
    frontArc(frame, { ox: 10 + age * 5, radius: 9 + age * 4, width: 2.6, squash: 0.45, spread: 75 * DEG, erosion: Math.min(0.9, age * 0.25), bright: 0.7 - age * 0.12, seed: 3112 });
  }
  if (f >= 2) {
    const age = (f - 2) / (N - 3);
    smokeCloud(frame, { cx: 4, count: 5, dist: 18, r: 5.5, age, seed: 3113, spread: 32 * DEG, drift: 12, grow: 0.8, bright: 0.22 });
  }
  ejectShell(frame, f - 1, { x: -12, y: 5, side: 3, back: 1.2, fall: 0.5, spin: 1, life: N - 1 });
  if (f >= 2) {
    shards(frame, f - 2, 6, 3114, (i, rnd) => {
      const a = (rnd(1) - 0.5) * 1.3;
      const sp = 3 + rnd(2) * 3;
      return { x: 8, y: (rnd(3) - 0.5) * 8, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 2 + Math.floor(rnd(4) * 2), size: 1 };
    });
  }
}

/**
 * 漏斗の閃光: 喇叭の口（x = mouth、縦に ±mouthHalf）から前へ広がる炎。前縁は角ごとにぎざぎざの長さ、
 * 中心線の口寄りだけ明るい。整った扇（散弾銃）ではなく、口の広い筒から吐き散らす形
 */
function funnelFlash(frame, o) {
  const { mouth = -4, mouthHalf, len, open, seed } = o;
  const bright = o.bright ?? 1;
  const erosion = o.erosion ?? 0;
  const tanO = Math.tan(open);
  const H = mouthHalf + len * tanO;
  paint(
    frame,
    (x, y) => {
      const dx = x - mouth;
      if (dx < -1) return -1;
      const half = mouthHalf + Math.max(0, dx) * tanO;
      const ay = Math.abs(y);
      if (ay > half) return -1;
      const t = y / half;
      // 前縁: 横の位置（t）ごとにぎざぎざ。8 本の舌が不揃いに伸びる
      const tb = (t + 1) * 3.5;
      const bin = Math.floor(tb);
      // 舌の中ほどが長く、舌と舌の境目で短くくびれる（1 枚の塊に見せない）
      const notch = Math.sin(Math.PI * (tb - bin)) ** 0.6;
      const tongue = len * (0.3 + 0.8 * hash1(bin, seed)) * (1 - 0.3 * t * t) * (0.35 + 0.65 * notch);
      if (dx > tongue) return -1;
      const u = Math.max(0, dx) / tongue;
      if (!survives(x, y, erosion, 1 - u, seed + 3)) return -1;
      return clamp01((1 - u) ** 0.9 * (1 - 0.6 * Math.abs(t)) * 0.9 * bright);
    },
    { bounds: { x0: mouth - 2, y0: -H - 2, x1: mouth + len * 1.1 + 2, y1: H + 2 } },
  );
}

/**
 * 喇叭銃: 漏斗形の口から不揃いな炎の舌が吐き出され、礫と火花が広い扇にばら撒かれる。
 * 煙は散弾銃より暗く、塊の大きさも位置も不揃い
 */
function muzzleBlunderbuss(frame, f) {
  const N = 8;
  if (f <= 2) {
    const s = f === 0 ? 0.8 : f === 1 ? 1 : 0.65;
    funnelFlash(frame, { mouth: -5, mouthHalf: 6 * s, len: 34 * s, open: 38 * DEG, seed: 3211 + f * 3, bright: f === 2 ? 0.8 : 1, erosion: f === 2 ? 0.25 : 0 });
    // 口の縁（喇叭の開き）を示す縦の短い閃き: 口の上下の角から斜め前へ細い針
    for (const side of [-1, 1]) spike(frame, { x: -5, y: side * 6 * s, a: side * 62 * DEG, len: 9 * s, w: 1.6, bright: 0.85 });
    flashCore(frame, -4, 0, 3.6 * s, 1);
    if (f === 1) sparkle(frame, -3, 0, 3);
  }
  // 礫: 2 ドットの粒が広い扇（±60°）へ速さもばらばらに飛ぶ
  shards(frame, f, 14, 3212, (i, rnd) => {
    const a = (rnd(1) - 0.5) * 2.1;
    const sp = 4 + rnd(2) * 5;
    return { x: 4, y: (rnd(3) - 0.5) * 8, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 4 + Math.floor(rnd(4) * 3), size: rnd(5) > 0.4 ? 2 : 1, drag: 0.86 };
  });
  // 火花: 1 ドットで速く、さらに広く（口の縁から横にも漏れる）
  shards(frame, f - 1, 10, 3213, (i, rnd) => {
    const a = (rnd(1) - 0.5) * 2.8;
    const sp = 4 + rnd(2) * 3;
    return { x: 0, y: (rnd(3) - 0.5) * 10, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 2 + Math.floor(rnd(4) * 2), size: 1, bright: 1 };
  });
  if (f >= 1) {
    const age = (f - 1) / (N - 2);
    smokeCloud(frame, { cx: 4, count: 6, dist: 18, r: 4.5, age, seed: 3214, spread: 55 * DEG, drift: 12, grow: 1, bright: 0.2 });
  }
}

// -----------------------------------------------------------------------------
// 着弾・命中・尽きた
// -----------------------------------------------------------------------------

/**
 * 散弾銃の着弾: 鉛玉が当たった面で潰れる平たい閃き（y に沿う短いレンズ）と、後ろへ跳ねる火花。
 * 最後に当たった所から小さな砂煙が立つ
 */
function impactShotgun(frame, f, g) {
  if (f <= 1) {
    lens(frame, { ax: -1, ay: -8, bx: -1, by: 8, T: f === 0 ? 5 : 3, bias: 0, bright: 0.95 });
    spike(frame, { x: 0, a: Math.PI, len: 7, w: 2.6, bright: 1 });
    flashCore(frame, 0, 0, 3, 1);
    sparkle(frame, 0, 0, f === 0 ? 3 : 2);
  }
  shards(frame, f, g.spark, g.seed + 21, (i, rnd) => {
    const a = Math.PI + (rnd(1) - 0.5) * 2.4;
    const sp = g.sparkSpeed * (0.6 + 0.8 * rnd(2));
    return { x: -1, y: (rnd(3) - 0.5) * 4, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(4) * 3), size: rnd(5) > 0.4 ? 2 : 1, drag: 0.8 };
  });
  if (f >= 2) {
    const age = (f - 2) / 4;
    smokePuff(frame, { x: -4 - age * 3, y: 0, r: 3.5 + age * 2.5, age, seed: g.seed + 22, bright: 0.25 });
  }
}

/**
 * 喇叭銃の着弾: 礫が砕けて全方向（後ろ寄り）へ角ばった欠片が散る。閃きは小さく尖ったぎざぎざの星
 */
function impactBlunderbuss(frame, f, g) {
  if (f <= 1) {
    bluntStar(frame, { x: -1, R: f === 0 ? 9 : 11, n: 7, seed: g.seed + 31, w: 2, core: 2.6, rot: 0.4 });
    if (f === 0) sparkle(frame, -1, 0, 2);
  }
  shards(frame, f, g.chip + 4, g.seed + 32, (i, rnd) => {
    const a = Math.PI + (rnd(1) - 0.5) * 4;
    const sp = g.sparkSpeed * (0.5 + 0.9 * rnd(2));
    return { x: -1, y: 0, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(4) * 3), size: 2, drag: 0.78 };
  });
  shards(frame, f, 6, g.seed + 33, (i, rnd) => {
    const a = Math.PI + (rnd(1) - 0.5) * 2;
    const sp = 4 + rnd(2) * 3;
    return { x: -1, y: 0, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 2, size: 1, bright: 1 };
  });
  if (f >= 2) {
    // 砕けた所に残る煤（段 1〜2 の点）
    for (let i = 0; i < 4; i++) {
      if (hash1(i + f * 3, g.seed + 34) < (f - 2) / 5) continue;
      dot(frame, -1 - hash1(i, g.seed + 35) * 3, (hash1(i, g.seed + 36) - 0.5) * 8, 2);
    }
  }
}

/**
 * 命中（敵の体に食い込む）: 原点 = 敵、+x = 弾の進む向き。着弾より重く、跳ね返らない。
 * 散弾銃は潰れた輪と前へ抜ける破片、喇叭銃は不揃いなぎざぎざの星と前へ散る火花
 */
function bulletHit(frame, f, g, rough) {
  const N = 6;
  const s = g.ringR / 5;
  if (f <= 1) {
    if (rough) {
      bluntStar(frame, { x: -1, R: (f === 0 ? 10 : 13) * s, n: 7, seed: g.seed + 41, w: 2.4, core: 3, rot: 0.2 });
    } else {
      spike(frame, { x: -2, a: 0, len: 11 * s, w: 3.2 * s, bright: 1 });
      spike(frame, { x: -2, a: Math.PI / 2, len: 6 * s, w: 2.2 * s, bright: 0.8 });
      spike(frame, { x: -2, a: -Math.PI / 2, len: 6 * s, w: 2.2 * s, bright: 0.8 });
      flashCore(frame, -2, 0, 3.6 * s, 1);
    }
    if (f === 0) sparkle(frame, -2, 0, 3);
  }
  if (f >= 1 && f <= 3) ring(frame, { radius: g.ringR * (0.6 + f * 0.5), width: 2.2, squash: 0.55, erosion: Math.min(0.9, (f - 1) * 0.35), bright: 0.7 - f * 0.1, seed: g.seed + 42 });
  shards(frame, f, g.chip + 3, g.seed + 43, (i, rnd) => {
    const back = rnd(5) < 0.2;
    const a = back ? Math.PI + (rnd(1) - 0.5) * 1.6 : (rnd(1) - 0.5) * (rough ? 2.6 : 1.7);
    const sp = g.sparkSpeed * (back ? 0.6 : 1) * (0.8 + 0.8 * rnd(2));
    return { x: 1, y: (rnd(3) - 0.5) * 3, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(4) * 3), size: 2, drag: 0.82 };
  });
  if (f >= N - 3) {
    // 撃ち込まれた所に漂う煤煙（小さく）
    const age = (f - (N - 3)) / 3;
    smokePuff(frame, { x: -3, y: 0, r: 3 + age * 2, age, seed: g.seed + 44, bright: 0.26 });
  }
}

/**
 * 尽きた（dirs 1）: 散弾銃は鉛玉が力を失って床へ落ち、小さく跳ねて転がる。落ちた所に小さな砂煙。
 * 画面の座標で描く（向きで回さない。どの向きに撃っても下へ落ちる）
 */
function fizzleShotgun(frame, f, g) {
  // 落ちる軌跡: 0..2 で落ち、3 で跳ね、4 以降は床で止まる
  const ys = [-4, -2, 0, -1.5, 0, 0, 0];
  const xs = [0, 1, 2, 3, 4, 4.5, 4.5];
  const y = ys[f] ?? 0;
  const x = xs[f] ?? 4.5;
  const lv = f <= 3 ? 5 : f <= 5 ? 4 : 3;
  dot(frame, x, y, lv);
  dot(frame, x + 1, y, lv - 1);
  dot(frame, x, y + 1, lv - 1);
  dot(frame, x + 1, y + 1, lv - 2);
  if (f >= 2) {
    const age = (f - 2) / 4;
    smokePuff(frame, { x: 2, y: 1, r: 2.5 + age * 3, age, seed: g.seed + 51, bright: 0.24 });
  }
}

/** 尽きた（dirs 1）: 喇叭銃は礫の火の粉がばらばらに落ちて消え、暗い煙が細く昇る */
function fizzleBlunderbuss(frame, f, g) {
  const N = 7;
  for (let i = 0; i < 4; i++) {
    const life = 3 + Math.floor(hash1(i, g.seed + 52) * 3);
    if (f > life) continue;
    const x = (hash1(i, g.seed + 53) - 0.5) * 8 + (hash1(i, g.seed + 54) - 0.5) * f * 1.5;
    const y = -2 + f * (0.8 + hash1(i, g.seed + 55));
    dot(frame, x, y, Math.max(3, 6 - f));
  }
  smokeWisp(frame, { x0: 0, y0: -1, height: 12 + f * 2.5, width: 1.1 + (f / (N - 1)) * 0.6, age: f / (N - 1), seed: g.seed % 97, sway: 3.5, lean: -2, rise: 7, bright: 0.26 });
}

// -----------------------------------------------------------------------------
// 近接: 零距離砲・ダッシュ・筒殴り・尻叩き・派生
// -----------------------------------------------------------------------------

/**
 * 零距離砲（circle size 44、原点 = 自分）: 足元へ向けて撃ち込み、周りを吹き飛ばす。
 * 前の銃口で大きな扇の爆炎が弾け、自分を中心に厚い爆風の輪（前ほど厚い）が広がり、輪の外縁に煙の塊が並んで膨らむ。
 * 刃ではなく爆発なので白は銃口の芯だけ
 */
function pointBlank(frame, f) {
  const A = 3;
  const N = 9;
  const X = HAND;
  if (f <= 1) {
    const s = f === 0 ? 1 : 1.2;
    fanFlash(frame, { x: X - 4, spread: 48 * DEG, len: 30 * s, n: 9, w: 4 * s, seed: 4011 });
    flashCore(frame, X - 3, 0, 7 * s, 1);
    sparkle(frame, X - 3, 0, f === 0 ? 3 : 4);
  } else if (f === 2) {
    fanFlash(frame, { x: X - 2, spread: 52 * DEG, len: 30, n: 9, w: 3, seed: 4011, bright: 0.75, erosion: 0.45 });
  }
  // 爆発の放射: 最初の 2 フレームだけ、自分の周りから全周へ太い針が噴く（爆風の輪より先に「弾けた」を見せる）
  if (f >= 1 && f <= 2) {
    const s = f === 1 ? 1 : 0.8;
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * TAU + (hash1(i, 4019) - 0.5) * 0.35;
      const front = (Math.cos(a) + 1) / 2;
      spike(frame, { x: Math.cos(a) * 8, y: Math.sin(a) * 8, a, len: (22 + 16 * front) * s * (0.8 + 0.4 * hash1(i, 4020)), w: 3 * s, bright: f === 1 ? 0.85 : 0.65, erosion: f === 2 ? 0.45 : 0, seed: 4021 + i });
    }
  }
  // 爆風の輪: 自分を中心に広がる。前（+x）ほど厚く明るく、後ろは細い。外縁はノイズで波打つ（整った円にしない）
  if (f >= 1) {
    const age = f - 1;
    const R = 18 + 28 * easeSwing(Math.min(1, age / 2.5)) + Math.max(0, age - 3) * 2;
    const k = Math.min(1, Math.max(0, (age - 1) / (N - 4)));
    const W = 12 * (1 - k * 0.5);
    paint(
      frame,
      (x, y) => {
        const r = Math.hypot(x, y);
        const a = Math.atan2(y, x);
        const front = (Math.cos(a) + 1) / 2;
        const wob = valueNoise(Math.cos(a) * 14, Math.sin(a) * 14, 5, 4022 + age) - 0.5;
        const RR = R * (1 + wob * 0.16);
        const w = W * (0.35 + 0.65 * front);
        const d = RR - r;
        if (d < 0 || d > w) return -1;
        const q = d / w;
        if (!survives(x, y, k * 1.1 + (1 - front) * 0.15, 1 - q, 4012)) return -1;
        const band = Math.floor(a / (7 * DEG));
        const grain = q > 0.3 ? 0.72 + 0.4 * hash1(band, 4013) : 1;
        return clamp01((1 - q) ** 0.9 * (0.5 + 0.28 * front) * grain * (1 - k * 0.35));
      },
      { bounds: { x0: -R * 1.1 - 2, y0: -R * 1.1 - 2, x1: R * 1.1 + 2, y1: R * 1.1 + 2 } },
    );
  }
  // 煙の塊: 輪が抜けたあと、輪の外へ 8 つ膨らむ。前の塊ほど大きい
  if (f >= A) {
    const age = (f - A) / (N - A - 1);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU + 0.3 + (hash1(i, 4014) - 0.5) * 0.5;
      const front = (Math.cos(a) + 1) / 2;
      const d = 44 + age * 10 + hash1(i, 4015) * 6;
      smokePuff(frame, { x: Math.cos(a) * d, y: Math.sin(a) * d, r: (4 + 3 * front) * (1 + age * 0.6), age: Math.min(1, age * (0.8 + 0.4 * hash1(i, 4016))), seed: 4017 + i * 13, bright: 0.24 });
    }
  }
  // 吹き飛ぶ石と火の粉: 全周へ。前が多い
  if (f >= 1) {
    shards(frame, f - 1, 16, 4018, (i, rnd) => {
      const a = rnd(5) < 0.55 ? (rnd(1) - 0.5) * 1.8 : rnd(1) * TAU;
      const sp = 4 + rnd(2) * 4;
      return { x: Math.cos(a) * 16, y: Math.sin(a) * 16, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(3) * 3), size: rnd(4) > 0.35 ? 2 : 1, drag: 0.84 };
    });
  }
}

/**
 * ダッシュ攻撃（circle size 44、原点 = 自分）: 筒を前に構えて突っ込む。前にふくらむ厚い押しの弓（前縁だけ明るい）と、
 * 足元から後ろへ噴く砂煙、弓の上下の外側を後ろへ流れる速度線。零距離砲（全周の爆風）とは前だけの形で見分ける
 */
function dash(frame, f) {
  const A = 3;
  const N = 8;
  const k = f < A ? 0 : (f - A + 1) / (N - A + 1);
  const p = f < A ? easeSwing((f + 1) / A) : 1;
  const R = 18 + 26 * p + k * 6;
  const W = 18 * (1 - k * 0.55);
  const SPREAD = 78 * DEG;
  paint(
    frame,
    (x, y) => {
      const dx = x / 0.75;
      const a = Math.atan2(y, dx);
      if (Math.abs(a) > SPREAD) return -1;
      const e = Math.abs(a) / SPREAD;
      const w = W * (1 - e * e * 0.8);
      const d = R - Math.hypot(dx, y);
      if (d < 0 || d > w) return -1;
      const q = d / w;
      if (!survives(x, y, k * 0.95 + e * 0.2, 1 - q, 4111)) return -1;
      // 前縁の 2 ドットは段 6（押す面）。本体は内側ほど薄く、横の筋目で割る
      if (d < 1.8 && k < 0.5 && e < 0.7) return 0.76;
      const grain = 0.78 + 0.35 * hash1(Math.floor((y + 60) / 2), 4112);
      return clamp01((1 - q) ** 0.9 * 0.66 * grain * (1 - 0.5 * e) * (1 - k * 0.3));
    },
    { bounds: { x0: -2, y0: -R - 2, x1: R + 2, y1: R + 2 } },
  );
  // 速度線: 弓の上下の端の外側から後ろへ
  if (k < 0.85) {
    for (let i = 0; i < 6; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const y = side * (R * 0.8 + 3 + Math.floor(i / 2) * 5);
      const x1 = R * 0.25 - hash1(i, 4113) * 8 - k * 14;
      const len = 16 + 14 * hash1(i, 4114);
      streakLine(frame, { ax: x1 - len, ay: y, bx: x1, by: y, bright: 0.5 * (1 - k) });
    }
  }
  // 砂煙: 後ろの左右（足元）から噴く
  if (f >= 1) {
    const age = (f - 1) / (N - 1);
    for (const side of [-1, 1]) {
      for (let j = 0; j < 2; j++) {
        const s = hash1(j + (side > 0 ? 2 : 0), 4115);
        smokePuff(frame, { x: -16 - j * 9 - age * 12, y: side * (16 + j * 3 + age * 6), r: (4 + s * 2) * (1 + age * 0.6), age: Math.min(1, age * 1.1), seed: 4116 + j * 7 + (side > 0 ? 50 : 0), bright: 0.24 });
      }
    }
  }
  if (f === A - 1) sparkle(frame, R - 2, 0, 3);
  if (f >= A - 1) {
    shards(frame, f - (A - 1), 10, 4117, (i, rnd) => {
      const a = (rnd(1) - 0.5) * 2.2;
      const sp = 3 + rnd(2) * 3;
      return { x: Math.cos(a) * R, y: Math.sin(a) * R * 0.9, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 2 + Math.floor(rnd(3) * 3), size: rnd(4) > 0.5 ? 2 : 1 };
    });
  }
}

/**
 * 筒殴り（box reach 16 / size 28、原点 = 当たりの中心 = 自分から 32 ドット先）:
 * 太い筒を真っ直ぐ突き出す。筒の太さの帯が前へ伸び、先の口（縦に長い楕円の輪。中は暗い）がそのまま敵を打つ。
 * 当たった瞬間に口の前で平たい衝撃と前へ潰れる弧、欠片が前へ飛ぶ
 */
function barrelBash(frame, f) {
  const A = 3;
  const N = 8;
  const k = f < A ? 0 : (f - A + 1) / (N - A + 1);
  const p = f < A ? easeSwing((f + 1) / A) : 1;
  const tip = -12 + 20 * p - k * 5;
  const back = -34 + k * 12;
  const H = 8;
  if (k < 0.85) {
    paint(
      frame,
      (x, y) => {
        if (x < back || x > tip - 1) return -1;
        const ay = Math.abs(y);
        if (ay > H) return -1;
        const u = (x - back) / Math.max(1, tip - back);
        if (!survives(x, y, k * 1.05 + (1 - u) * 0.3, u, 4211)) return -1;
        // 帯の上下の縁（筒の輪郭）だけ段 4〜5 の線。中は後ろほど薄い筋（塗りつぶしの面にしない）
        if (ay > H - 1.4) return clamp01((0.35 + 0.35 * u) * (1 - k * 0.4));
        const grain = 0.7 + 0.45 * hash1(Math.floor((y + 20) / 2), 4212);
        return clamp01(u ** 1.4 * 0.42 * grain * (1 - k * 0.4));
      },
      { bounds: { x0: back - 1, y0: -H - 1, x1: tip + 1, y1: H + 1 } },
    );
    // 筒の口: 縦に長い楕円の輪。縁は段 6、中は段 2 の暗い穴
    paint(
      frame,
      (x, y) => {
        const e = Math.hypot((x - tip) / 3.2, y / (H + 0.5));
        if (e > 1) return -1;
        // 口の輪も帯と一緒に崩れる（輪だけ最後まで残ると浮いて見える）
        if (!survives(x, y, k * 1.3, 0.3, 4217)) return -1;
        if (e > 0.62) return clamp01((0.78 - (1 - e) * 0.2) * (1 - k * 0.45));
        return 0.14;
      },
      { bounds: { x0: tip - 4, y0: -H - 2, x1: tip + 4, y1: H + 2 } },
    );
  }
  // 速度線: 筒の上下の外側を後ろへ
  if (k < 0.8) {
    for (let i = 0; i < 4; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const y = side * (H + 4 + Math.floor(i / 2) * 4);
      const x1 = tip - 6 - hash1(i, 4213) * 6 - k * 10;
      streakLine(frame, { ax: x1 - 16 - hash1(i, 4214) * 10, ay: y, bx: x1, by: y, bright: 0.5 * (1 - k) });
    }
  }
  if (f === A - 1) {
    // 当たった瞬間: 口の前に縦の平たい衝撃（筒の口の形のまま押し潰れる）
    lens(frame, { ax: tip + 3, ay: -16, bx: tip + 3, by: 16, T: 5, bias: 0, bright: 0.9 });
    sparkle(frame, tip + 3, 0, 3);
  }
  if (f >= A - 1) {
    const age = f - (A - 1);
    if (age >= 1 && age <= 4) frontArc(frame, { ox: tip + 2 + age * 2, radius: 8 + age * 5, width: 3 - age * 0.3, squash: 0.45, spread: 80 * DEG, erosion: Math.min(0.9, age * 0.2), bright: 0.78 - age * 0.1, seed: 4215 });
    shards(frame, age, 10, 4216, (i, rnd) => {
      const a = (rnd(1) - 0.5) * 1.6;
      const sp = 3 + rnd(2) * 3.5;
      return { x: tip + 3, y: (rnd(3) - 0.5) * 14, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(4) * 2), size: 2, drag: 0.8 };
    });
  }
}

/**
 * 尻叩き（arc 180° reach 26、原点 = 自分）: 銃床を半周振り回す。刃の三日月ではなく、先が四角く切れた厚い帯
 * （銃床の尻の面が先頭）で、縁を白くしない。帯の外縁は段 6 まで、先頭の面の外側から砂粒が接線へ弾ける
 */
function buttSwing(frame, f) {
  const A = 4;
  const N = 9;
  const R = 54;
  const T = 20;
  const k = f < A ? 0 : (f - A + 1) / (N - A + 1);
  const p = f < A ? easeSwing((f + 1) / A) : 1;
  const from = -100 * DEG;
  const sweep = 190 * DEG;
  const head = from + sweep * p + k * 10 * DEG;
  const span = 120 * DEG * (0.35 + 0.65 * p) * (1 - k * 0.5);
  paint(
    frame,
    (x, y) => {
      const r = Math.hypot(x, y);
      if (r > R || r < R - T - 1) return -1;
      let s = head - Math.atan2(y, x);
      s = ((s % TAU) + TAU) % TAU;
      if (s > span) return -1;
      const u = s / span;
      // 先頭 1 割は四角い面（太さ一定）、その後ろは尾へ細る
      const w = u < 0.1 ? T : T * ((1 - u) / 0.9) ** 1.1;
      const q = (R - r) / w;
      if (q < 0 || q > 1) return -1;
      if (!survives(x, y, k * 1.05 + u * 0.2, (1 - q) * (1 - u), 4311)) return -1;
      // 先頭の面（進む向きの縁 2 ドット）は段 6 の線で「尻の面」を見せる
      if (s * r < 2.2 && k < 0.5) return 0.74;
      const band = Math.floor((R - r) / 2.2);
      const grain = q > 0.15 ? 0.72 + 0.4 * hash1(band, 4312) : 1;
      return clamp01((1 - q) ** 0.8 * (0.76 - 0.42 * u) * grain * (1 - k * 0.35));
    },
    { bounds: { x0: -R - 2, y0: -R - 2, x1: R + 2, y1: R + 2 } },
  );
  // 先頭の面の外側から弾ける砂粒（振り切ったところで多く）
  if (f >= 2) {
    const a0 = from + sweep * easeSwing(Math.min(1, (Math.min(f, A - 1) + 1) / A));
    shards(frame, f - 2, 9, 4313, (i, rnd) => {
      const out = 0.25 + 0.5 * rnd(1);
      const sp = 3 + rnd(2) * 3;
      const vx = (-Math.sin(a0) * (1 - out) + Math.cos(a0) * out) * sp;
      const vy = (Math.cos(a0) * (1 - out) + Math.sin(a0) * out) * sp;
      const rr = R - 2 - rnd(3) * 10;
      return { x: Math.cos(a0) * rr, y: Math.sin(a0) * rr, vx, vy, life: 2 + Math.floor(rnd(4) * 3), size: rnd(5) > 0.4 ? 2 : 1, drag: 0.82 };
    });
  }
}

/**
 * 砲身振り（circle size 50、原点 = 自分）: 長い砲身ごと 1 周振り回す。先頭は自分から外縁まで伸びる放射状の棒（砲身）で、
 * 先端に口の輪。後ろには砲身の通った跡が同心の筋のぶれとして尾を引く（尻叩きの四角い帯・半周とは形と周回で見分ける）
 */
function barrelSwing(frame, f) {
  const A = 4;
  const N = 9;
  const R = 50;
  const R0 = 14;
  const k = f < A ? 0 : (f - A + 1) / (N - A + 1);
  const p = f < A ? easeSwing((f + 1) / A) : 1;
  const start = -90 * DEG;
  const head = start + TAU * p + k * 30 * DEG;
  const span = (f < A ? 150 : 150 - 100 * k) * DEG;
  // 砲身の先が通った跡: 外縁に沿う帯（先頭で太さ 14、尾へ細る）。同心の筋目で塗りを割る
  paint(
    frame,
    (x, y) => {
      const r = Math.hypot(x, y);
      if (r > R || r < R - 16) return -1;
      let s = head - Math.atan2(y, x);
      s = ((s % TAU) + TAU) % TAU;
      if (s > span) return -1;
      const u = s / span;
      const w = 14 * (1 - u) ** 0.8 + 1;
      const q = (R - r) / w;
      if (q > 1) return -1;
      if (!survives(x, y, k * 1.05 + u * 0.25, (1 - q) * (1 - u), 4412)) return -1;
      const band = Math.floor((R - r) / 2);
      const grain = 0.6 + 0.55 * hash1(band, 4413);
      return clamp01((1 - q) ** 0.9 * (0.66 - 0.4 * u) * grain * (1 - k * 0.3));
    },
    { bounds: { x0: -R - 2, y0: -R - 2, x1: R + 2, y1: R + 2 } },
  );
  // 先頭の砲身: 自分の近くから外縁まで伸びる放射状の棒（幅 5）。先ほど明るい
  if (k < 0.6) {
    const c = Math.cos(head - 3 / R);
    const sn = Math.sin(head - 3 / R);
    paint(
      frame,
      (x, y) => {
        const along = x * c + y * sn;
        const across = Math.abs(-x * sn + y * c);
        if (along < R0 || along > R - 5 || across > 2.6) return -1;
        const v = (along - R0) / (R - 5 - R0);
        if (!survives(x, y, k * 1.2, v, 4417)) return -1;
        return clamp01((0.3 + 0.42 * v) * (across > 1.6 ? 0.7 : 1));
      },
      { bounds: { x0: -R, y0: -R, x1: R, y1: R } },
    );
    // 砲身の先の口の輪（先頭と一緒に回る）
    ring(frame, { ox: c * (R - 2), oy: sn * (R - 2), radius: 3.4, width: 1.8, bright: 0.82, seed: 4414 });
    if (f === A - 1) sparkle(frame, c * (R - 2), sn * (R - 2), 3);
  }
  // 口から外へ弾き出される火の粉（通り道の 3 か所）
  for (let j = 0; j < 3; j++) {
    const born = j + 1;
    if (f < born) continue;
    const a0 = start + TAU * easeSwing((born + 0.5) / A);
    shards(frame, f - born, 4, 4415 + j, (i, rnd) => {
      const out = 0.35 + 0.5 * rnd(1);
      const sp = 3 + rnd(2) * 2.5;
      const vx = (-Math.sin(a0) * (1 - out) + Math.cos(a0) * out) * sp;
      const vy = (Math.cos(a0) * (1 - out) + Math.sin(a0) * out) * sp;
      return { x: Math.cos(a0) * (R - 2), y: Math.sin(a0) * (R - 2), vx, vy, life: 2 + Math.floor(rnd(3) * 2), size: rnd(4) > 0.5 ? 2 : 1 };
    });
  }
}

/**
 * 装填撃ち（circle size 20、原点 = 自分）: 殻を 2 つ弾き出して込め直し（尾栓の小さな閃き）、1 拍おいて前へ 1 発。
 * 弾は弾の絵が出るので、ここは手元の閃き・殻・扇の小さな閃光・煙だけ
 */
function loadedShot(frame, f) {
  const N = 8;
  // 込め直し: 尾栓（手元の後ろ）の小さな閃き
  if (f === 0) {
    spike(frame, { x: 6, y: 4, a: -Math.PI / 2, len: 6, w: 1.6, bright: 0.85 });
    spike(frame, { x: 6, y: 4, a: Math.PI / 2, len: 4, w: 1.4, bright: 0.7 });
    sparkle(frame, 6, 4, 2);
  }
  ejectShell(frame, f, { x: 4, y: 8, side: 2.4, back: 1.1, fall: 0.3, spin: 0, life: 5 });
  ejectShell(frame, f - 1, { x: 4, y: 8, side: 3, back: 0.5, fall: 0.3, spin: 2, life: 5 });
  // 撃つ: 扇の閃光（大筒らしく横に広い。構えた先で）
  if (f === 2 || f === 3) {
    const s = f === 2 ? 1 : 0.65;
    fanFlash(frame, { x: HAND, spread: 34 * DEG, len: 16 * s, n: 7, w: 2.6 * s, seed: 4511, bright: f === 2 ? 1 : 0.8 });
    flashCore(frame, HAND, 0, 3.6 * s, 1);
    if (f === 2) sparkle(frame, HAND + 1, 0, 3);
  }
  if (f >= 3 && f <= 5) {
    const age = f - 3;
    frontArc(frame, { ox: HAND + 8 + age * 3, radius: 5 + age * 3, width: 2, squash: 0.5, spread: 75 * DEG, erosion: Math.min(0.9, age * 0.25), bright: 0.66 - age * 0.12, seed: 4512 });
  }
  if (f >= 3) {
    const age = (f - 3) / (N - 4);
    smokeCloud(frame, { cx: HAND, count: 3, dist: 6, r: 3.6, age, seed: 4513, spread: 25 * DEG, drift: 6, grow: 0.8, bright: 0.24 });
  }
}

/**
 * 密着砲（box reach 12 / size 24、原点 = 当たりの中心 = 銃口を押し付けた所）:
 * 押し付けた口の周りから逃げ場のない火が上下へ噴き（横の 2 本の噴き）、前へは広い扇の爆炎が敵を貫く。
 * 続いて押し付けた所を中心に前寄りの爆風の輪、前へ押し出される煙の雲
 */
function contactShot(frame, f) {
  const A = 3;
  const N = 8;
  if (f <= 1) {
    const s = f === 0 ? 0.85 : 1.1;
    fanFlash(frame, { x: -2, spread: 52 * DEG, len: 34 * s, n: 9, w: 4 * s, seed: 4611 });
    // 口の縁から上下へ漏れる噴き（少し後ろへ寝かせる）
    for (const side of [-1, 1]) spike(frame, { x: -6, y: side * 3, a: side * 100 * DEG, len: 14 * s, w: 2.8 * s, bright: 0.9 });
    flashCore(frame, -3, 0, 6.5 * s, 1);
    sparkle(frame, -3, 0, f === 0 ? 3 : 4);
  } else if (f === 2) {
    fanFlash(frame, { x: 0, spread: 56 * DEG, len: 32, n: 9, w: 3, seed: 4611, bright: 0.72, erosion: 0.5 });
  }
  // 前寄りの爆風の輪（押し付けた所が中心。後ろは描かない）
  if (f >= 1 && f <= 4) {
    const age = f - 1;
    const k = age / 3;
    frontArc(frame, { ox: -4, radius: 12 + age * 6, width: 4.2 - age * 0.4, squash: 0.75, spread: 110 * DEG, erosion: Math.min(0.92, age * 0.28), bright: 0.8 - k * 0.3, seed: 4612 });
  }
  if (f >= A - 1) {
    const age = (f - (A - 1)) / (N - A);
    smokeCloud(frame, { cx: 0, count: 6, dist: 16, r: 5, age, seed: 4613, spread: 55 * DEG, drift: 12, grow: 0.8, bright: 0.25 });
  }
  if (f >= 1) {
    shards(frame, f - 1, 12, 4614, (i, rnd) => {
      const a = (rnd(1) - 0.5) * 2;
      const sp = 3.5 + rnd(2) * 4;
      return { x: 4, y: (rnd(3) - 0.5) * 6, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(4) * 2), size: rnd(5) > 0.4 ? 2 : 1, drag: 0.82 };
    });
  }
}

/**
 * 突き飛ばし（box reach 12 / size 24・前へ 20 踏み込む、原点 = 当たりの中心）:
 * 筒を横に構えて体ごと押し込む。縦に広い平たい壁（前へ少しふくらむ面）が前へ滑り、
 * 後ろに押しの風の筋、当たった所で壁の上下の端から砂煙が巻き、前へ広い潰れた弧が抜ける
 */
function shoveOff(frame, f) {
  const A = 3;
  const N = 8;
  const k = f < A ? 0 : (f - A + 1) / (N - A + 1);
  const p = f < A ? easeSwing((f + 1) / A) : 1;
  const tip = -18 + 24 * p + k * 6;
  const H = 23 * (1 - k * 0.2);
  const D = 12;
  if (k < 0.85) {
    paint(
      frame,
      (x, y) => {
        const e = y / H;
        if (Math.abs(e) > 1) return -1;
        const front = tip - e * e * 6;
        const d = front - x;
        if (d < 0 || d > D) return -1;
        const q = d / D;
        if (!survives(x, y, k * 1.05 + Math.abs(e) * 0.2, 1 - q, 4711)) return -1;
        // 前面の 2 ドットは段 6（押す面）。後ろへ薄れる。縦の筋目で塗りを割る
        if (d < 2 && k < 0.5) return 0.74 - Math.abs(e) * 0.1;
        const grain = 0.75 + 0.4 * hash1(Math.floor((y + 40) / 2), 4712);
        return clamp01((1 - q) ** 1.2 * 0.5 * grain * (1 - 0.35 * Math.abs(e)) * (1 - k * 0.3));
      },
      { bounds: { x0: tip - D - 8, y0: -H - 1, x1: tip + 1, y1: H + 1 } },
    );
  }
  // 押しの風の筋: 壁の後ろを長く（踏み込みの距離の分）
  if (k < 0.85) {
    for (let i = 0; i < 6; i++) {
      const y = (i - 2.5) * 8 + (hash1(i, 4713) - 0.5) * 3;
      const x1 = tip - D - 3 - hash1(i, 4714) * 5 - k * 10;
      const len = 18 + 16 * hash1(i, 4715);
      streakLine(frame, { ax: x1 - len, ay: y, bx: x1, by: y, bright: 0.45 * (1 - k) });
    }
  }
  if (f >= A - 1) {
    const age = f - (A - 1);
    const t = age / (N - A + 1);
    for (const side of [-1, 1]) {
      smokePuff(frame, { x: tip - 4 + t * 6, y: side * (H + 1 + t * 6), r: 4.5 + t * 4, age: t, seed: 4717 + (side > 0 ? 9 : 0), bright: 0.24 });
    }
    shards(frame, age, 8, 4718, (i, rnd) => {
      const a = (rnd(1) - 0.5) * 1.3;
      const sp = 3 + rnd(2) * 3;
      return { x: tip, y: (rnd(3) - 0.5) * H * 1.6, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(4) * 2), size: 2, drag: 0.8 };
    });
  }
}

/**
 * 近接の命中: 重い鈍器の打撃。角ばった衝撃の星（白は芯だけ）と潰れた輪、進む向きへ飛ぶ石の欠片、
 * 最後に火薬の煤煙の塊が前へ漂う（大筒の打撃は硝煙を纏う）。heavy は星と輪が大きく、煙が増える
 */
function meleeHit(frame, f, heavy) {
  const R = heavy ? 24 : 15;
  const n = heavy ? 8 : 6;
  const seed = heavy ? 4811 : 4821;
  if (f <= 1) {
    bluntStar(frame, { R: R * (f === 0 ? 0.8 : 1), n, seed, w: heavy ? 3.6 : 2.6, core: heavy ? 5.5 : 3.8 });
    sparkle(frame, 0, 0, f === 0 ? (heavy ? 4 : 3) : heavy ? 3 : 2);
  } else if (f === 2) {
    bluntStar(frame, { R, n, seed, w: (heavy ? 3.6 : 2.6) * 0.7, core: 0.1, bright: 0.75, erosion: 0.6 });
  }
  if (f >= 1) {
    const age = f - 1;
    ring(frame, { radius: (heavy ? 10 : 6) + age * (heavy ? 6.5 : 4.5), width: heavy ? 3.6 : 2.2, squash: 0.65, erosion: Math.min(0.92, age * 0.24), bright: 0.8 - age * 0.1, seed: seed + 1 });
  }
  shards(frame, f - 1, heavy ? 16 : 9, seed + 2, (i, rnd) => {
    const a = (rnd(1) - 0.5) * (rnd(2) > 0.3 ? 1.4 : 3.6);
    const sp = (heavy ? 4.2 : 3) + rnd(3) * (heavy ? 4 : 2.5);
    return { x: 0, y: 0, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(4) * 2), size: 2, drag: 0.8 };
  });
  if (f >= 2) {
    const age = (f - 2) / (heavy ? 5 : 4);
    smokeCloud(frame, { cx: 2, count: heavy ? 3 : 2, dist: heavy ? 10 : 6, r: heavy ? 5 : 3.6, age, seed: seed + 3, spread: 50 * DEG, drift: 8, grow: 0.7, bright: 0.24 });
  }
}

// -----------------------------------------------------------------------------
// シートと表
// -----------------------------------------------------------------------------

/** 弾 1 種のシート（飛ぶ粒・銃口・着弾・命中・尽きた） */
const SHOT_SHEETS = {
  shotgun: {
    fly: leadBall,
    muzzle: { draw: muzzleShotgun, frames: 7, size: 120 },
    impact: impactShotgun,
    rough: false,
    fizzle: fizzleShotgun,
  },
  blunderbuss: {
    fly: gravel,
    muzzle: { draw: muzzleBlunderbuss, frames: 8, size: 120 },
    impact: impactBlunderbuss,
    rough: true,
    fizzle: fizzleBlunderbuss,
  },
};

function shotSheets(name) {
  const g = SHOTS[name];
  const d = SHOT_SHEETS[name];
  return [
    { key: `cannon.${name}Fly`, dirs: SHOT_DIRS, frames: g.frames, active: 0, size: Math.ceil(g.tail * 1.6 + 16) * 2, draw: (frame, f) => d.fly(frame, f, g) },
    { key: `cannon.${name}Muzzle`, dirs: DIRS, frames: d.muzzle.frames, active: 0, size: d.muzzle.size, draw: d.muzzle.draw },
    { key: `cannon.${name}Impact`, dirs: DIRS, frames: 7, active: 0, size: 64, draw: (frame, f) => d.impact(frame, f, g) },
    { key: `cannon.${name}Hit`, dirs: DIRS, frames: 6, active: 0, size: 72, draw: (frame, f) => bulletHit(frame, f, g, d.rough) },
    { key: `cannon.${name}Fizzle`, dirs: 1, frames: 7, active: 0, size: 56, draw: (frame, f) => d.fizzle(frame, f, g) },
  ];
}

/** 弾の表の 1 行（物理の弾なので配色は真鍮） */
function bulletRow(name) {
  const g = SHOTS[name];
  return {
    fly: `cannon.${name}Fly`,
    period: g.period,
    base: 2,
    muzzle: `cannon.${name}Muzzle`,
    impact: `cannon.${name}Impact`,
    hit: `cannon.${name}Hit`,
    fizzle: `cannon.${name}Fizzle`,
    ramp: "brass",
  };
}

const SHOT_KEYS = ["shotgun", "blunderbuss"];

/**
 * 武器種のモーション → シート（render/fxMotions.ts が読む）。pivot: self = 自分の中心、anchor = 当たり判定の中心。
 * base は絵を描いたときの当たり判定の大きさ（measure の値。論理 px）
 */
const FX = {
  moveset: "cannon",
  motions: {
    dash: { sheet: "cannon.dash", pivot: "self", base: 44, measure: "size" },
    "r:pointBlank": { sheet: "cannon.pointBlank", pivot: "self", base: 44, measure: "size" },
    "r:barrelBash": { sheet: "cannon.barrelBash", pivot: "anchor", base: 16, measure: "reach" },
    "r:buttSwing": { sheet: "cannon.buttSwing", pivot: "self", base: 26, measure: "reach" },
    "branch:loadedShot": { sheet: "cannon.loadedShot", pivot: "self", base: 20, measure: "size" },
    "branch:barrelSwing": { sheet: "cannon.barrelSwing", pivot: "self", base: 50, measure: "size" },
    "branch:contactShot": { sheet: "cannon.contactShot", pivot: "anchor", base: 12, measure: "reach" },
    "branch:shoveOff": { sheet: "cannon.shoveOff", pivot: "anchor", base: 12, measure: "reach" },
  },
  hit: "cannon.hit",
  hitHeavy: "cannon.hitHeavy",
  bullets: Object.fromEntries(SHOT_KEYS.map((name) => [name, bulletRow(name)])),
};

export const ATLAS = {
  key: "cannon",
  fx: FX,
  sheets: [
    { key: "cannon.dash", dirs: WIDE_DIRS, frames: 8, active: 3, size: 136, draw: dash },
    { key: "cannon.pointBlank", dirs: WIDE_DIRS, frames: 9, active: 3, size: 148, draw: pointBlank },
    { key: "cannon.barrelBash", dirs: DIRS, frames: 8, active: 3, size: 104, draw: barrelBash },
    { key: "cannon.buttSwing", dirs: WIDE_DIRS, frames: 9, active: 4, size: 124, draw: buttSwing },
    { key: "cannon.loadedShot", dirs: DIRS, frames: 8, active: 3, size: 88, draw: loadedShot },
    { key: "cannon.barrelSwing", dirs: WIDE_DIRS, frames: 9, active: 4, size: 124, draw: barrelSwing },
    { key: "cannon.contactShot", dirs: DIRS, frames: 8, active: 3, size: 112, draw: contactShot },
    { key: "cannon.shoveOff", dirs: DIRS, frames: 8, active: 3, size: 104, draw: shoveOff },
    { key: "cannon.hit", dirs: DIRS, frames: 6, active: 0, size: 64, draw: (frame, f) => meleeHit(frame, f, false) },
    { key: "cannon.hitHeavy", dirs: DIRS, frames: 7, active: 0, size: 100, draw: (frame, f) => meleeHit(frame, f, true) },
    ...SHOT_KEYS.flatMap(shotSheets),
  ],
};
