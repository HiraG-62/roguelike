// 槍（moveset "spear"）のエフェクト。docs/ideas/fx-sprites.md。手本は sword.mjs
// 単位は絵のドット（論理 0.5px）。当たり判定の数値（src/data/balance/weapons/WEAPON/movesets/spear.json）× 2 が目安
//
// 槍らしさ = リーチと鋭さ。剣の突き（太いレンズ）と見分けるため、突きは「細い柄の光 + 菱形の穂先 + 穂先の前の V 字の衝撃」で組む。
// 光条は reach いっぱいまで一気に伸び、崩れは柄の根元から先へ向かって消える（穂先が最後まで残る）
import { arcLine, easeSwing, ring, shards, sparkle, streakLine } from "../shapes.mjs";
import { clamp01, hash1, paint, valueNoise, wrapAngle } from "../raster.mjs";
import { DIRS } from "../motifs.mjs";

const DEG = Math.PI / 180;
/** 柄の光が始まる位置（キャラの胴の縁。キャラは絵のドットで 48） */
const SHAFT_BACK = 14;

// -----------------------------------------------------------------------------
// 小道具
// -----------------------------------------------------------------------------

/** 崩れ（0..1）の判定。nearCore が大きい所（芯・穂先）ほど最後まで残る */
function keep(x, y, erosion, nearCore, seed) {
  if (erosion <= 0) return true;
  const n = valueNoise(x, y, 4, seed) * 0.6 + valueNoise(x, y, 1.6, seed + 7) * 0.25;
  return n + nearCore * 0.45 - erosion * 1.15 > 0;
}

/**
 * 正準座標を回して・ずらして描く作業面の写し。多段突きの「少し角度をずらした光条」を、
 * 同じ描き方のまま角度だけ変えて重ねるために使う（paint / stamp / dot は toGrid・toCanon しか見ない）
 */
function turned(frame, angle, ox = 0, oy = 0) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return {
    w: frame.w,
    h: frame.h,
    toGrid: (x, y) => frame.toGrid(ox + x * c - y * s, oy + x * s + y * c),
    toCanon: (gx, gy) => {
      const p = frame.toCanon(gx, gy);
      const dx = p.x - ox;
      const dy = p.y - oy;
      return { x: dx * c + dy * s, y: -dx * s + dy * c };
    },
    get: (ix, iy) => frame.get(ix, iy),
    set: (ix, iy, v) => frame.set(ix, iy, v),
    raise: (ix, iy, v) => frame.raise(ix, iy, v),
  };
}

/**
 * 柄の光: back → neck の細い線。根元は細く暗く、穂先側ほど太く明るい。中央の 1 ドットが芯。
 * erosion で根元側から先に崩れる
 */
function shaft(frame, o) {
  const { back, neck, T } = o;
  const bright = o.bright ?? 1;
  const erosion = o.erosion ?? 0;
  const seed = o.seed ?? 11;
  if (neck - back < 2) return;
  paint(
    frame,
    (x, y) => {
      const u = (x - back) / (neck - back);
      if (u < 0 || u > 1) return -1;
      const w = 0.6 + (T / 2 - 0.6) * Math.pow(u, 0.7);
      const ay = Math.abs(y);
      if (ay > w) return -1;
      const q = ay / w;
      if (!keep(x, y, erosion, u * (1 - q), seed)) return -1;
      return clamp01((0.35 + 0.65 * u) * (1 - q * 0.55) * bright * (1 - erosion * 0.4));
    },
    { bounds: { x0: back - 2, y0: -T - 2, x1: neck + 2, y1: T + 2 }, dither: 0.03 },
  );
  // 芯の 1 ドット線（穂先寄り 6 割だけ。根元まで白いと棒に見える）
  if (erosion < 0.5) streakLine(frame, { ax: back + (neck - back) * 0.4, ay: 0, bx: neck, by: 0, width: 1, bright: 0.95 * bright });
}

/**
 * 菱形の穂先: 先端 tip、長さ L、半幅 W。前の 2 辺の縁が白く光り、中央の稜線が明るい。後ろ半分は暗い
 */
function spearhead(frame, o) {
  const { tip, L, W } = o;
  const bright = o.bright ?? 1;
  const erosion = o.erosion ?? 0;
  const seed = o.seed ?? 13;
  const oy = o.oy ?? 0;
  const hx = tip - L / 2;
  const hl = L / 2;
  const edgeScale = (hl * W) / Math.hypot(hl, W);
  paint(
    frame,
    (x, y) => {
      const dx = x - hx;
      const dy = y - oy;
      const d = Math.abs(dx) / hl + Math.abs(dy) / W;
      if (d > 1) return -1;
      const front = dx > 0;
      if (!keep(x, y, erosion, (1 - d) * 0.8 + (front ? 0.3 : 0), seed)) return -1;
      const edgeDist = (1 - d) * edgeScale;
      // 前の 2 辺の縁 = 刃（白い芯）。崩れ始めたら光らせない
      if (front && edgeDist < 1.1 && erosion < 0.4) return clamp01(1.05 * bright);
      const ridge = Math.abs(dy) < 0.8 ? 0.2 : 0;
      const side = front ? 0.72 : 0.5;
      return clamp01((side * (1 - d * 0.5) + ridge) * bright * (1 - erosion * 0.45));
    },
    { bounds: { x0: hx - hl - 2, y0: oy - W - 2, x1: tip + 2, y1: oy + W + 2 } },
  );
}

/**
 * 穂先の前で空気を裂く V 字の衝撃線（弓波）。apex = 頂点の x、len = 後ろへ開く長さ、spread = 開きの半幅
 */
function bowWave(frame, o) {
  const { apex, len, spread } = o;
  const bright = o.bright ?? 0.8;
  const width = o.width ?? 1.2;
  for (const side of [-1, 1]) {
    streakLine(frame, { ax: apex - len, ay: side * spread, bx: apex, by: side * (o.gap ?? 1), width, bright });
  }
}

/**
 * 穂先の前の円錐状の衝撃: 進行方向に潰れた輪が 1 枚ずつ遅れて穂先から前へ押し出される。
 * 先に出た輪ほど前にあって大きいので、並ぶと前へ開く円錐に見える
 */
function coneRings(frame, tip, age, count, seed, strength = 1) {
  for (let i = 0; i < count; i++) {
    const a = age - i;
    if (a < 0 || a > 4) continue;
    ring(frame, {
      ox: tip + 3 + a * 4 * strength,
      radius: (3 + a * 2.8) * strength,
      width: 1.5 + strength * 0.4,
      squash: 0.32,
      erosion: Math.min(0.9, a * 0.22),
      bright: (0.85 - a * 0.12) * Math.min(1, strength + 0.1),
      seed: seed + i,
    });
  }
}

/** 先端で弾ける衝撃（重い突き）: 前半分へ放射する短い棘。輪は coneRings に任せる（重ねると球に見える） */
function tipBurst(frame, tip, age, strength, seed) {
  if (age < 0 || age > 2) return;
  const spikes = 5;
  for (let i = 0; i < spikes; i++) {
    const a = ((i / (spikes - 1)) * 2 - 1) * 62 * DEG + (hash1(i, seed) - 0.5) * 0.12;
    const long = i % 2 === 0 ? 1 : 0.65;
    const r1 = (12 + age * 8) * strength * long + 4;
    const r0 = age === 0 ? 3 : r1 - (7 + 5 * strength);
    if (r0 >= r1) continue;
    streakLine(frame, { ax: tip + Math.cos(a) * r0, ay: Math.sin(a) * r0, bx: tip + Math.cos(a) * r1, by: Math.sin(a) * r1, width: long > 0.9 ? 1.6 : 1.1, bright: 0.95 - age * 0.2 });
  }
}

// -----------------------------------------------------------------------------
// 突きの時間割
// -----------------------------------------------------------------------------

/**
 * 1 本の突き。spec:
 *   reach（穂先の到達・絵のドット）, T（柄の最大の太さ）, L / W（穂先の長さ・半幅）, A（active の枚数）, N（全枚数）,
 *   cone（輪の数）, wave（V 字の大きさ 0..）, lines（平行の速度線の数）, burst（先端で弾ける強さ。0 で無し）,
 *   trail（背後に残る突進の尾の長さ）, pierce（貫通して先へ抜ける光の長さ）, shards, seed
 */
function thrust(frame, f, spec) {
  const { A, N, reach, seed } = spec;
  const p = f < A ? easeSwing((f + 1) / A) : 1;
  const k = f < A ? 0 : (f - A + 1) / (N - A + 1);
  // 一気に伸びる: 1 枚目ですでに reach の 6 割
  const tip = SHAFT_BACK + 6 + (reach - SHAFT_BACK - 6) * (0.35 + 0.65 * p) + k * 4;
  const back = SHAFT_BACK + (f < A ? 0 : (tip - SHAFT_BACK) * Math.pow(k, 0.8) * 0.9);
  const L = spec.L * (f < A ? 0.75 + 0.25 * p : 1 - k * 0.3);
  const W = spec.W * (f < A ? 0.8 + 0.2 * p : 1 - k * 0.35);
  const erosion = f < A ? 0 : 0.05 + 0.8 * Math.pow(k, 1.2);
  const bright = f < A ? 0.85 + 0.15 * p : 1 - 0.3 * k;

  if (spec.trail) drawTrail(frame, f, spec, back, k);
  if (spec.ghosts) drawGhosts(frame, f, spec, tip, L, W);
  shaft(frame, { back, neck: tip - L * 0.55, T: spec.T * (1 - k * 0.4), erosion, bright, seed: seed + 1 });
  spearhead(frame, { tip, L, W, erosion: erosion * 0.8, bright, seed: seed + 2 });

  // 平行の速度線: 柄のすぐ外、穂先の少し後ろから根元へ
  for (let i = 0; i < (spec.lines ?? 2); i++) {
    if (k > 0.8) break;
    const side = i % 2 === 0 ? -1 : 1;
    const y = side * (spec.W + 1.5 + Math.floor(i / 2) * 3 + k * 2);
    const x1 = tip - L - 2 - hash1(i, seed + 3) * 8 - k * 14;
    const len = (reach * 0.2 + hash1(i, seed + 4) * reach * 0.2) * (1 - k * 0.6);
    streakLine(frame, { ax: x1 - len, ay: y, bx: x1, by: y, bright: 0.55 * (1 - k) });
  }

  // 穂先の前の V 字の衝撃（伸び切る直前から）と、潰れた輪
  const waveAge = f - (A - 2);
  if (spec.wave && waveAge >= 0 && waveAge <= (spec.waveMax ?? (spec.burst ? 0 : 3))) {
    const s = spec.wave;
    bowWave(frame, { apex: tip + 5 + waveAge * 3, len: (10 + waveAge * 4) * s, spread: (5 + waveAge * 3) * s, gap: 1, bright: 0.9 - waveAge * 0.18, width: s > 1.2 ? 1.6 : 1.2 });
    // 大突き: 後ろにもう 1 つ小さな山形（空気が 2 層に裂ける）。同じ向きの入れ子で、線が重ならない間隔
    if (spec.waves2) bowWave(frame, { apex: tip - 6 + waveAge * 2, len: (7 + waveAge * 3) * s, spread: (4 + waveAge * 2.2) * s, gap: 1, bright: 0.7 - waveAge * 0.15, width: 1.2 });
  }
  if (spec.cone && f >= A - 1) coneRings(frame, tip, f - (A - 1), spec.cone, seed + 10, spec.coneSize ?? 1);
  if (spec.burst && f >= A - 1) tipBurst(frame, tip, f - (A - 1), spec.burst, seed + 20);
  if (spec.pierce) drawPierce(frame, f, spec, tip, k);

  if (f === A - 1) sparkle(frame, tip - 1, 0, spec.burst ? 4 : 3);
  if (f === A) sparkle(frame, tip + 2, 0, 2);
  if (f >= A - 1 && spec.shards) {
    shards(frame, f - (A - 1), spec.shards, seed + 30, (i, rnd) => {
      // 前へ抜ける破片（突きの向きに細い円錐）
      const a = (rnd(1) - 0.5) * (spec.burst ? 1.4 : 0.9);
      const sp = 3 + rnd(2) * (spec.burst ? 5 : 3);
      return { x: tip - 2, y: (rnd(3) - 0.5) * 4, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(4) * 2), size: rnd(5) > 0.5 ? 2 : 1 };
    });
  }
}

/** 突進の尾: 背後から柄の根元へ流れる細い速度線の束（突進した距離を見せる） */
function drawTrail(frame, f, spec, back, k) {
  if (k > 0.85) return;
  const n = spec.trailLines ?? 5;
  for (let i = 0; i < n; i++) {
    const y = (i - (n - 1) / 2) * 4 + (hash1(i, spec.seed + 60) - 0.5) * 2;
    const x1 = back + 6 - Math.abs(y) * 1.2 - hash1(i, spec.seed + 61) * 8 - k * 20;
    const len = spec.trail * (0.5 + 0.5 * hash1(i, spec.seed + 62)) * (1 - k * 0.5) * Math.min(1, (f + 1) / 2);
    streakLine(frame, { ax: x1 - len, ay: y, bx: x1, by: y, width: i === (n - 1) / 2 ? 1.4 : 1, bright: 0.5 * (1 - k) });
  }
}

/**
 * 突進突きの残像: 踏み込みの道筋に、暗い穂先の写しが間を空けて残る（突進した距離を見せる）。
 * 並ぶのは同じ線の上で、平行の二重線にはならない
 */
function drawGhosts(frame, f, spec, tip, L, W) {
  for (let i = 0; i < spec.ghosts; i++) {
    const age = f - i;
    if (age < 0 || age > 3) continue;
    const x = tip - (i + 1) * spec.ghostGap;
    spearhead(frame, { tip: x, L: L * 0.85, W: W * 0.8, erosion: 0.15 + age * 0.22, bright: 0.55 - i * 0.08, seed: spec.seed + 80 + i });
  }
}

/** 深突きの貫通: 当たった先へさらに細い光が抜け、抜けた先で小さな穂先の写しが飛ぶ */
function drawPierce(frame, f, spec, tip, k) {
  const age = f - (spec.A - 1);
  if (age < 0) return;
  const len = spec.pierce * Math.min(1, (age + 1) / 2);
  const from = tip + 2 + age * 6;
  if (age <= 4) streakLine(frame, { ax: from, ay: 0, bx: tip + 2 + len, by: 0, width: age <= 1 ? 1.6 : 1, bright: 0.95 - age * 0.15 });
  if (age >= 1 && age <= 4) spearhead(frame, { tip: tip + len + 4, L: 10 * (1 - k * 0.4), W: 2.6, erosion: k * 0.7, bright: 0.9, seed: spec.seed + 70 });
  // 抜けた穴の輪: 当たった所（tip）に縦長の輪
  if (age <= 3) ring(frame, { ox: tip, radius: 5 + age * 3, width: 1.8, squash: 0.35, erosion: Math.min(0.9, age * 0.25), bright: 0.85 - age * 0.12, seed: spec.seed + 71 });
}

// -----------------------------------------------------------------------------
// 突きの定義（reach × 2 = 穂先の到達）
// -----------------------------------------------------------------------------

/** 左 1 段（thrust reach 38）: 細く鋭い基本の突き */
const L1 = { reach: 76, T: 2.6, L: 20, W: 4.4, A: 3, N: 7, cone: 0, wave: 0.9, lines: 2, shards: 4, seed: 1100 };
/** 左 2 段（reach 40）: 少し太く、衝撃の輪が 2 枚 */
const L2 = { reach: 80, T: 3, L: 22, W: 4.8, A: 3, N: 7, cone: 2, wave: 0, lines: 3, shards: 5, seed: 1200 };
/** 左 4 段（reach 44・重い）: 最大の貫通の一撃。太い光条、先端で弾ける */
const L4 = { reach: 88, T: 4.4, L: 24, W: 6, A: 4, N: 9, cone: 2, coneSize: 1.2, wave: 1.3, lines: 4, burst: 0.8, shards: 10, seed: 1400 };
/** ダッシュ攻撃（reach 46・重い）: 走り込みの突き。背後に速度線の尾 */
const DASH = { reach: 92, T: 4, L: 20, W: 4.6, A: 3, N: 8, cone: 2, wave: 1.2, lines: 2, burst: 0.7, trail: 50, trailLines: 5, shards: 8, seed: 1500 };
/** 右: 突進突き（reach 48・踏み込み 40）: 長い突進の尾（踏み込み 80 ドット）の先で弾ける */
const CHARGE = { reach: 96, T: 4.4, L: 22, W: 5, A: 3, N: 8, cone: 2, coneSize: 1.2, wave: 1.4, lines: 2, burst: 1, trail: 70, trailLines: 5, ghosts: 3, ghostGap: 30, shards: 10, seed: 1600 };
/** 右: 大突き（reach 52）: 最も太く大きい穂先。円錐の衝撃が 3 枚重なり、先端で大きく弾ける */
const GREAT = { reach: 104, T: 6, L: 32, W: 9, A: 4, N: 9, cone: 3, coneSize: 1.5, wave: 1.8, waves2: true, lines: 4, burst: 1.5, shards: 14, seed: 1700 };
/** 派生: 深突き（reach 52）: 細く最も長い。当たった所を抜けて、先へ光が突き抜ける */
const DEEP = { reach: 104, T: 3.6, L: 22, W: 4, A: 4, N: 9, cone: 1, wave: 1.1, lines: 2, burst: 0.6, pierce: 44, shards: 8, seed: 1800 };

/**
 * 多段突き: 少し角度をずらした短い突きが時間差で出る。前の突きは次が出る頃には崩れ始めている（二重線に見せない）。
 * stabs: [{ at（開始の枚）, angle（度）, reach }]
 */
function multiThrust(frame, f, stabs, base) {
  for (let i = 0; i < stabs.length; i++) {
    const s = stabs[i];
    const local = f - s.at;
    const last = i === stabs.length - 1;
    // 最後以外は短く崩す（次の突きが出る頃には消えかけている）
    const N = last ? base.N : base.A + 2;
    if (local < 0 || local >= N) continue;
    thrust(turned(frame, s.angle * DEG), local, { ...base, N, reach: s.reach, seed: base.seed + i * 100, burst: last ? base.lastBurst ?? 0 : 0, cone: last ? base.cone : 0, waveMax: last ? 3 : 1, shards: last ? base.shards : 3 });
  }
}

/** 左 3 段（reach 40・2 段ヒット）: 上下にずらした 2 本の短い突き */
const L3_STABS = [
  { at: 0, angle: -7, reach: 74 },
  { at: 3, angle: 6, reach: 80 },
];
const L3_BASE = { T: 2.6, L: 18, W: 4, A: 2, N: 6, cone: 2, wave: 0.8, lines: 1, shards: 5, lastBurst: 0, seed: 1300 };
/** 派生: 連ね突き（reach 40・3 段ヒット）: 3 本が扇に時間差で出て、最後が正面 */
const LINKED_STABS = [
  { at: 0, angle: -9, reach: 72 },
  { at: 2, angle: 8, reach: 76 },
  { at: 4, angle: 0, reach: 80 },
];
const LINKED_BASE = { T: 2.6, L: 18, W: 4, A: 2, N: 6, cone: 1, wave: 0.9, lines: 1, shards: 7, lastBurst: 0.6, seed: 1900 };

// -----------------------------------------------------------------------------
// 薙ぎ（長い柄の細く長い弧）
// -----------------------------------------------------------------------------

/**
 * 細い弧の帯（半径 R、帯の太さ T）。head から tail まで。角は巻き戻さずに扱う（1 周を超えない範囲で 360° 近い帯も描ける）。
 * 外縁が刃の筋（白）で、先端側ほど太く明るい
 */
function thinArc(frame, o) {
  const { R, T, head, tail } = o;
  const span = Math.max(1e-3, head - tail);
  const erosion = o.erosion ?? 0;
  const bright = o.bright ?? 1;
  const seed = o.seed ?? 21;
  paint(
    frame,
    (x, y) => {
      const r = Math.hypot(x, y);
      if (r > R + 0.5 || r < R - T - 1) return -1;
      let s = (head - Math.atan2(y, x)) % (Math.PI * 2);
      if (s < 0) s += Math.PI * 2;
      const u = s / span;
      if (u > 1) return -1;
      // 先端は尖り、少し後ろで最も太く、尾へ細る
      const w = T * (u < 0.08 ? u / 0.08 : Math.pow(1 - (u - 0.08) / 0.92, 0.8));
      if (w < 0.6) return -1;
      const q = (R - r) / w;
      if (q < 0 || q > 1) return -1;
      if (!keep(x, y, erosion, (1 - q) * (1 - u), seed)) return -1;
      if (R - r < 1.3 && u < 0.55 && erosion < 0.45) return clamp01(bright * (1.05 - 0.35 * u));
      return clamp01((1 - q) * (0.85 - 0.5 * u) * bright * (1 - erosion * 0.45));
    },
    { bounds: { x0: -R - 2, y0: -R - 2, x1: R + 2, y1: R + 2 }, dither: 0.03 },
  );
}

/** 弧の先に付く穂先（弧の接線を向いた菱形）。rotate した作業面に spearhead を描く */
function arcHead(frame, R, angle, o) {
  // 穂先は弧の接線（時計回りの進む向き）を向く。原点を先端に置いて描く
  const tipX = Math.cos(angle) * R;
  const tipY = Math.sin(angle) * R;
  const t = turned(frame, angle + Math.PI / 2, tipX, tipY);
  spearhead(t, { tip: 2, L: o.L, W: o.W, erosion: o.erosion ?? 0, bright: o.bright ?? 1, seed: o.seed ?? 31 });
}

/** 右: 払い（arc 180° reach 34）: 半径の大きい細い弧。先端に穂先の菱形が光る */
function spearArc(frame, f) {
  const A = 4;
  const N = 9;
  const R = 74;
  const half = 95 * DEG;
  const p = f < A ? easeSwing((f + 1) / A) : 1;
  const k = f < A ? 0 : (f - A + 1) / (N - A + 1);
  const head = -half + half * 2 * (f < A ? p : 1 + 0.05 * k);
  const tail = f < A ? -half + half * 2 * Math.max(0, p - 0.75) * 0.5 : -half + half * 2 * Math.min(0.97, 0.3 + 0.67 * Math.pow(k, 0.8));
  const erosion = f < A ? 0 : 0.04 + 0.8 * Math.pow(k, 1.3);
  const T = 9 * (f < A ? 0.75 + 0.25 * p : 1 - 0.5 * k);
  thinArc(frame, { R, T, head, tail, erosion, bright: f < A ? 0.85 + 0.15 * p : 1 - 0.3 * k, seed: 2101 });
  if (k < 0.6) arcHead(frame, R - 3, head, { L: 16, W: 3.6, erosion: erosion * 0.8, bright: 1 - k * 0.3, seed: 2102 });
  // 速度線は外側にだけ
  for (let i = 0; i < 3; i++) {
    if (k >= 0.9) break;
    const span = head - tail;
    const radius = R + 2.5 + i * 2 + k * 6;
    const end = head - span * (0.12 + 0.1 * hash1(i, 2103)) + k * span * 0.2;
    const len = span * (0.3 + 0.35 * hash1(i, 2104)) * (1 - k * 0.8);
    if (len > 0.02) arcLine(frame, { radius, from: end - len, to: end, bright: (0.6 - i * 0.08) * (1 - k * 0.6) });
  }
  if (f === A - 1) sparkle(frame, Math.cos(head) * (R - 2), Math.sin(head) * (R - 2), 3);
  if (f >= A - 1) {
    shards(frame, f - (A - 1), 7, 2105, (i, rnd) => {
      const a = head - rnd(1) * 0.6;
      const sp = 3 + rnd(2) * 3;
      const out = 0.3 + 0.4 * rnd(3);
      return { x: Math.cos(a) * (R - 3), y: Math.sin(a) * (R - 3), vx: (-Math.sin(a) * (1 - out) + Math.cos(a) * out) * sp, vy: (Math.cos(a) * (1 - out) + Math.sin(a) * out) * sp, life: 3 + Math.floor(rnd(4) * 2), size: rnd(5) > 0.5 ? 2 : 1 };
    });
  }
}

/** 派生: 石突き回し（circle size 50）: 槍が 1 周する細い輪の帯。先端に穂先の菱形が光る */
function spearSweep(frame, f) {
  const A = 6;
  const N = 10;
  const R = 52;
  const p = f < A ? easeSwing((f + 1) / A) : 1;
  const k = f < A ? 0 : (f - A + 1) / (N - A + 1);
  const start = -90 * DEG;
  const head = start + Math.PI * 2 * (f < A ? p : 1) + (f < A ? 0 : Math.sin(k * Math.PI * 0.5) * 0.6);
  const trailSpan = f < A ? Math.min(Math.PI * 1.7, Math.PI * 2 * p * 0.9) : Math.PI * 1.7 * (1 - Math.pow(k, 0.8) * 0.85);
  const erosion = f < A ? 0 : 0.04 + 0.8 * Math.pow(k, 1.3);
  const T = 8 * (1 - k * 0.5);
  thinArc(frame, { R, T, head, tail: head - trailSpan, erosion, bright: 1 - 0.3 * k, seed: 2201 });
  if (k < 0.6) arcHead(frame, R - 3, head, { L: 14, W: 3.4, erosion: erosion * 0.8, bright: 1 - k * 0.3, seed: 2202 });
  if (k < 0.6) {
    for (let i = 0; i < 2; i++) {
      const to = head - 0.3 - i * 0.5;
      arcLine(frame, { radius: R + 3 + i * 2 + k * 5, from: to - 1.1 * (1 - k), to, bright: (0.55 - i * 0.1) * (1 - k) });
    }
  }
  if (f === 2 || f === A - 1) sparkle(frame, Math.cos(head) * (R - 2), Math.sin(head) * (R - 2), 3);
  if (f >= A - 1) {
    shards(frame, f - (A - 1), 10, 2203, (i, rnd) => {
      const a = rnd(1) * Math.PI * 2;
      const sp = 3 + rnd(2) * 3;
      return { x: Math.cos(a) * (R - 2), y: Math.sin(a) * (R - 2), vx: (-Math.sin(a) * 0.7 + Math.cos(a) * 0.5) * sp, vy: (Math.cos(a) * 0.7 + Math.sin(a) * 0.5) * sp, life: 3 + Math.floor(rnd(3) * 2), size: rnd(4) > 0.5 ? 2 : 1 };
    });
  }
}

// -----------------------------------------------------------------------------
// 石突きの打撃（当たりの中心に置く）
// -----------------------------------------------------------------------------

/** 衝撃の星: 4 本の長い棘 + 4 本の短い棘。rot で少し回す */
function impactStar(frame, x, y, size, rot, bright) {
  for (let i = 0; i < 8; i++) {
    const a = rot + (i / 8) * Math.PI * 2;
    const r = (i % 2 === 0 ? 1 : 0.55) * size;
    streakLine(frame, { ax: x + Math.cos(a) * r, ay: y + Math.sin(a) * r, bx: x + Math.cos(a) * 1.5, by: y + Math.sin(a) * 1.5, width: i % 2 === 0 ? 1.6 : 1.1, bright });
  }
}

/** 右: 石突き（box reach 10 / size 22）: 短く押し出す鈍い打撃。石突きの丸い光点 + 衝撃の星 + 輪 */
function buttStrike(frame, f) {
  const A = 3;
  const N = 7;
  const p = f < A ? easeSwing((f + 1) / A) : 1;
  const k = f < A ? 0 : (f - A + 1) / (N - A + 1);
  // 押し出す柄の短い線（後ろから当たりの中心へ）
  const head = -6 + 6 * p;
  if (k < 0.6) shaft(frame, { back: -26 + p * 6 + k * 14, neck: head, T: 3.4 * (1 - k * 0.4), erosion: k * 0.9, seed: 2301 });
  if (f < A + 1) {
    // 石突き（丸い金具）の光
    paint(frame, (x, y) => {
      const d = Math.hypot(x - head, y);
      return d > 3.2 ? -1 : clamp01(1 - d * 0.12);
    }, { bounds: { x0: head - 5, y0: -5, x1: head + 5, y1: 5 } });
  }
  if (f >= A - 1) {
    const age = f - (A - 1);
    if (age <= 3) impactStar(frame, 2, 0, (12 + age * 3) * (1 - age * 0.12), age * 0.12, 0.95 - age * 0.18);
    ring(frame, { ox: 2, radius: 5 + age * 5, width: 2.4 - age * 0.25, erosion: Math.min(0.9, age * 0.2), bright: 0.85 - age * 0.1, seed: 2302 });
    if (age <= 1) sparkle(frame, 2, 0, age === 0 ? 4 : 3);
    shards(frame, age, 8, 2303, (i, rnd) => {
      const a = (rnd(1) - 0.5) * 2.2;
      const sp = 2.5 + rnd(2) * 3;
      return { x: 2, y: 0, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(3) * 2), size: rnd(4) > 0.5 ? 2 : 1 };
    });
  }
}

/** 派生: 蹴り上げ（box reach 12 / size 22・重い）: 石突きが下から前へ跳ね上がる短い弧 + 大きな星 + 上へ散る破片 */
function kickUp(frame, f) {
  const A = 4;
  const N = 9;
  const p = f < A ? easeSwing((f + 1) / A) : 1;
  const k = f < A ? 0 : (f - A + 1) / (N - A + 1);
  // 当たりの中心の後ろ（-x）を中心に、下（+y）から前（+x）を通って上（-y）へ振り上げる。
  // 振りは時計回りで描く決まりなので、上下を入れ替えた「上から前を通って下へ」を描き、弧は前へふくらむ
  const cx = -14;
  const R = 22;
  const from = -80 * DEG;
  const to = 30 * DEG;
  const head = from + (to - from) * (f < A ? p : 1 + 0.05 * k);
  const tail = f < A ? from : from + (to - from) * Math.min(0.95, Math.pow(k, 0.8));
  const erosion = f < A ? 0 : 0.05 + 0.8 * Math.pow(k, 1.3);
  const t = turned(frame, 0, cx, 0);
  thinArc(t, { R, T: 8 * (1 - k * 0.5), head, tail, erosion, bright: 1 - k * 0.3, seed: 2401 });
  const hx = cx + Math.cos(head) * (R - 2);
  const hy = Math.sin(head) * (R - 2);
  if (f < A) sparkle(frame, hx, hy, 2);
  const impact = { x: cx + Math.cos(0) * (R - 2), y: 0 };
  if (f >= A - 2) {
    const age = f - (A - 2);
    if (age <= 2) impactStar(frame, impact.x, impact.y, (14 + age * 4) * (1 - age * 0.1), 0.2 + age * 0.1, 0.95 - age * 0.17);
    ring(frame, { ox: impact.x, oy: impact.y, radius: 6 + age * 6, width: 2.6 - age * 0.25, erosion: Math.min(0.9, age * 0.18), bright: 0.85 - age * 0.09, seed: 2402 });
    if (age <= 1) sparkle(frame, impact.x, impact.y, 4);
    // 破片は振り抜けの向き（+y・時計回りの側）と前へ
    shards(frame, age, 12, 2404, (i, rnd) => {
      const a = 60 * DEG + (rnd(1) - 0.5) * 1.6;
      const sp = 3 + rnd(2) * 4;
      return { x: impact.x, y: impact.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(3) * 3), size: rnd(4) > 0.45 ? 2 : 1 };
    });
  }
}

// -----------------------------------------------------------------------------
// 命中
// -----------------------------------------------------------------------------

/** 命中（軽）: 突き刺しの点状の閃光 + 前へ抜ける細い光 + 小さな V 字 + 前方へ抜ける破片の円錐 */
function hit(frame, f) {
  if (f <= 1) spearhead(frame, { tip: 6, L: 12 - f * 3, W: 3.6 - f, bright: 1 - f * 0.15, seed: 2501 });
  if (f <= 2) sparkle(frame, 0, 0, f === 1 ? 3 : 2);
  if (f <= 3) streakLine(frame, { ax: 4 + f * 6, ay: 0, bx: 14 + f * 7, by: 0, width: 1.2, bright: 0.9 - f * 0.18 });
  if (f >= 1 && f <= 2) bowWave(frame, { apex: 12 + f * 4, len: 6 + f * 2, spread: 3 + f * 2, bright: 0.8 - f * 0.2 });
  shards(frame, f, 8, 2502, (i, rnd) => {
    const a = (rnd(1) - 0.5) * 1.1;
    const sp = 3 + rnd(2) * 3;
    return { x: 2, y: 0, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(3) * 3), size: rnd(4) > 0.45 ? 2 : 1 };
  });
}

/** 貫通して抜ける先（hitHeavy の正準座標。敵の体の向こう側） */
const EXIT_X = 30;

/** 命中（重）: 刺さった点の閃光から太い光が敵を貫き、後ろ（+x の先）で潰れた輪と棘が弾けて破片が抜ける */
function hitHeavy(frame, f) {
  if (f <= 1) spearhead(frame, { tip: 9, L: 18 - f * 4, W: 5 - f * 1.2, bright: 1 - f * 0.12, seed: 2601 });
  if (f <= 2) sparkle(frame, 0, 0, f === 0 ? 3 : 4 - f);
  if (f <= 3) streakLine(frame, { ax: f * 8, ay: 0, bx: 18 + f * 12, by: 0, width: f <= 1 ? 2 : 1.3, bright: 0.95 - f * 0.15 });
  if (f === 1) ring(frame, { radius: 6, width: 1.8, bright: 0.65, seed: 2603 });
  if (f >= 1) {
    const age = f - 1;
    ring(frame, { ox: EXIT_X + age * 6, radius: 5 + age * 3.5, width: 2.2 - age * 0.2, squash: 0.4, erosion: Math.min(0.9, age * 0.2), bright: 0.85 - age * 0.1, seed: 2602 });
    tipBurst(frame, EXIT_X, age, 0.55, 2605);
  }
  shards(frame, f - 1, 14, 2604, (i, rnd) => {
    const a = (rnd(1) - 0.5) * 1.3;
    const sp = 3.5 + rnd(2) * 4;
    return { x: EXIT_X - 4, y: (rnd(3) - 0.5) * 4, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(4) * 3), size: rnd(5) > 0.4 ? 2 : 1 };
  });
}

// -----------------------------------------------------------------------------
// 表
// -----------------------------------------------------------------------------

/**
 * 武器種のモーション → シート（render/fxMotions.ts が読む）。
 * 突きは pivot self（自分から reach まで伸びる）、石突きの打撃は当たりの中心、回しは自分の中心
 */
const FX = {
  moveset: "spear",
  motions: {
    "l:0": { sheet: "spear.l1", pivot: "self", base: 38, measure: "reach" },
    "l:1": { sheet: "spear.l2", pivot: "self", base: 40, measure: "reach" },
    "l:2": { sheet: "spear.l3", pivot: "self", base: 40, measure: "reach" },
    "l:3": { sheet: "spear.l4", pivot: "self", base: 44, measure: "reach" },
    dash: { sheet: "spear.dash", pivot: "self", base: 46, measure: "reach" },
    "r:chargeThrust": { sheet: "spear.charge", pivot: "self", base: 48, measure: "reach" },
    "r:buttStrike": { sheet: "spear.butt", pivot: "anchor", base: 22, measure: "size" },
    "r:spearArc": { sheet: "spear.arc", pivot: "self", base: 34, measure: "reach" },
    "r:greatThrust": { sheet: "spear.great", pivot: "self", base: 52, measure: "reach" },
    "branch:spearSweep": { sheet: "spear.sweep", pivot: "self", base: 50, measure: "size" },
    "branch:linkedThrusts": { sheet: "spear.linked", pivot: "self", base: 40, measure: "reach" },
    "branch:kickUp": { sheet: "spear.kick", pivot: "anchor", base: 22, measure: "size" },
    "branch:deepThrust": { sheet: "spear.deep", pivot: "self", base: 52, measure: "reach" },
  },
  hit: "spear.hit",
  hitHeavy: "spear.hitHeavy",
};

/** 突きのシート（作業面は穂先 + 衝撃が収まる大きさ） */
function thrustSheet(key, spec, extra = 30) {
  const size = Math.ceil(Math.max(spec.reach + extra, (spec.trail ?? 0) + 10)) * 2;
  return { key, dirs: DIRS, frames: spec.N, active: spec.A, size, draw: (frame, f) => thrust(frame, f, spec) };
}

function multiSheet(key, stabs, base, frames, active) {
  return { key, dirs: DIRS, frames, active, size: 240, draw: (frame, f) => multiThrust(frame, f, stabs, base) };
}

export const ATLAS = {
  key: "spear",
  fx: FX,
  sheets: [
    thrustSheet("spear.l1", L1),
    thrustSheet("spear.l2", L2),
    multiSheet("spear.l3", L3_STABS, L3_BASE, 9, 5),
    thrustSheet("spear.l4", L4, 40),
    thrustSheet("spear.dash", DASH, 36),
    thrustSheet("spear.charge", CHARGE, 40),
    thrustSheet("spear.great", GREAT, 46),
    thrustSheet("spear.deep", DEEP, 70),
    multiSheet("spear.linked", LINKED_STABS, LINKED_BASE, 10, 6),
    { key: "spear.arc", dirs: DIRS, frames: 9, active: 4, size: 176, draw: spearArc },
    { key: "spear.sweep", dirs: 1, frames: 10, active: 6, size: 136, draw: spearSweep },
    { key: "spear.butt", dirs: DIRS, frames: 7, active: 3, size: 96, draw: buttStrike },
    { key: "spear.kick", dirs: DIRS, frames: 9, active: 4, size: 112, draw: kickUp },
    { key: "spear.hit", dirs: DIRS, frames: 6, active: 0, size: 80, draw: hit },
    { key: "spear.hitHeavy", dirs: DIRS, frames: 7, active: 0, size: 128, draw: hitHeavy },
  ],
};
