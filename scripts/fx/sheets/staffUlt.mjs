// 棍（moveset "staff"）の奥義 3 本のエフェクト。docs/ideas/fx-sprites.md 9 章。手本は swordUlt.mjs、形の言葉は staff.mjs
// 単位は絵のドット（論理 0.5px）。数値は src/data/balance/ultimates/ULTIMATE/defs/staff.json × 2 が目安
//
// 棍は刃が無いので、奥義でも剣の「白い縁の三日月」は使わない。棍の言葉（放射状の細い筋が並ぶ棒のブレの扇・
// 先端の丸い打撃の円盤と輪・風の渦の筋）をそのまま大きく・長く・段を多くして豪華にする。
// - 竜巻: 中央を持った棒の両端が 2 周（4 回の当たり）して、外へ巻き出す大きな渦と地面の砂の渦
// - 千本突き: 5 回の突きを時間と横の位置で分けて並べ、最後の 1 本で大きく弾ける
// - 柔の呼吸: 刃も衝撃も無い、ゆっくり巡る流れの帯と、足元に広がる水面の波紋
// 白（段 7）は光点だけ。棒のブレは筋で描き、面で塗らない（面にすると剣の三日月と見分けがつかない）
import { arcLine, easeSwing, ring, shards, sparkle, streakLine } from "../shapes.mjs";
import { clamp01, dot, hash1, paint, valueNoise, wrapAngle } from "../raster.mjs";
import { DIRS } from "../motifs.mjs";

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

// -----------------------------------------------------------------------------
// 共通の部品（staff.mjs の棍の言葉を写して、奥義の大きさに合わせたもの）
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
 * 棒のブレの扇（staff.mjs と同じ考え）。先頭（head の角）の筋が今の棒で最も太く明るく、後ろ（span）ほど短く暗い。
 * 奥義の大きさでは筋の間隔が開きすぎるので、筋の数 n を多めに渡す。fade で後ろの筋から抜ける
 */
function blurFan(frame, o) {
  const { R, r0, head, span, n, seed } = o;
  const fade = o.fade ?? 0;
  const bright = o.bright ?? 1;
  const lead = o.lead ?? true;
  const leadW = o.leadW ?? 3.4;
  // 薄い帯: 棒の直後だけ外寄りに暗い段で敷いて筋をまとめる（段 2〜3 まで。面を主役にしない）
  if (span > 0.05 && fade < 0.7) {
    const wash = span * 0.5;
    const rIn = R - (R - r0) * 0.42;
    paint(
      frame,
      (x, y) => {
        const r = Math.hypot(x, y);
        if (r > R - 1 || r < rIn) return -1;
        const s = wrapAngle(head - Math.atan2(y, x));
        if (s < 0 || s > wash) return -1;
        const t = 1 - s / wash;
        const out = (r - rIn) / (R - rIn);
        if (valueNoise(x, y, 3, seed + 9) + fade * 0.8 > 0.95) return -1;
        return (0.1 + 0.2 * t * out) * bright * (1 - fade);
      },
      { bounds: { x0: -R - 2, y0: -R - 2, x1: R + 2, y1: R + 2 }, dither: 0.08, samples: 2 },
    );
  }
  for (let i = lead ? 0 : 1; i <= n; i++) {
    const u = i / n;
    if (i > 0 && hash1(i, seed) * 0.6 + (1 - u) * 0.5 < fade * 1.2 - 0.1) continue;
    const a = head - span * Math.pow(u, 1.25);
    const inner = r0 + (R - r0) * (0.06 + 0.5 * u + 0.1 * hash1(i, seed + 1)) + (R - r0) * 0.4 * fade;
    const outer = R - u * (3 + 6 * hash1(i, seed + 2)) - fade * 3;
    if (outer - inner < 4) continue;
    const b = bright * (i === 0 ? 0.88 : 0.78 - 0.4 * u) * (1 - 0.45 * fade);
    const p0 = polar(0, 0, a, inner);
    const p1 = polar(0, 0, a, outer);
    streakLine(frame, { ax: p0.x, ay: p0.y, bx: p1.x, by: p1.y, width: i === 0 ? leadW : i <= 2 ? 1.8 : 1.35, bright: b });
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

/** 打撃の放射線: 中心の周りから外へ短い筋。cone を渡すと a0 を中心の扇に並べる */
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
    streakLine(frame, { ax: p0.x, ay: p0.y, bx: p1.x, by: p1.y, width: o.width ?? 1.3, bright });
  }
}

/** 先端の打撃の衝撃（age 0 = 当たった瞬間）。0: 円盤 + 光点 + 放射線、1 以降: 輪が広がって欠ける */
function impact(frame, x, y, age, o) {
  const size = o.size;
  const seed = o.seed;
  const squash = o.squash ?? 1;
  if (age < 0) return;
  if (age === 0) {
    disc(frame, x, y, size * 0.55, 1, squash);
    sparkle(frame, x, y, o.spark ?? (size >= 10 ? 3 : 2));
    rays(frame, x, y, { count: o.rays ?? 6, r0: size * 0.7, r1: size * 1.3, seed, a0: o.a0 ?? 0.3, cone: o.cone, bright: 0.74 });
    return;
  }
  if (age === 1) {
    disc(frame, x, y, size * 0.35, 0.75, squash);
    rays(frame, x, y, { count: o.rays ?? 6, r0: size * 1.05, r1: size * 1.55, seed, a0: o.a0 ?? 0.3, cone: o.cone, bright: 0.52 });
  }
  const rr = size * (0.6 + 0.32 * age);
  ring(frame, { ox: x, oy: y, radius: rr, width: Math.max(1.4, 2.6 - age * 0.35), squash, erosion: Math.min(0.92, 0.1 + (age - 1) * 0.28), bright: 0.82 - age * 0.08, seed: seed + 5 });
}

/** 風の渦の筋: 角 a0 から sweep だけ時計回りに回りながら、半径が rIn → rOut へ変わる細い線。先ほど明るい */
function spiral(frame, o) {
  const { a0, sweep, rIn, rOut } = o;
  const ox = o.ox ?? 0;
  const oy = o.oy ?? 0;
  const squash = o.squash ?? 1;
  const width = o.width ?? 1.3;
  const bright = o.bright ?? 0.6;
  const erosion = o.erosion ?? 0;
  const seed = o.seed ?? 7;
  const pad = Math.max(rIn, rOut) + width + 3;
  paint(
    frame,
    (x, y) => {
      const dx = (x - ox) / squash;
      const dy = y - oy;
      const r = Math.hypot(dx, dy);
      let s = wrapAngle(Math.atan2(dy, dx) - a0);
      if (s < 0) s += TAU;
      if (s > sweep) return -1;
      const t = s / sweep;
      const want = rIn + (rOut - rIn) * t;
      if (Math.abs(r - want) > width / 2) return -1;
      if (erosion > 0 && valueNoise(x, y, 4, seed) - erosion * 0.9 + t * 0.2 < 0.1) return -1;
      return bright * (0.3 + 0.7 * t);
    },
    { bounds: { x0: ox - pad * squash, y0: oy - pad, x1: ox + pad * squash, y1: oy + pad }, dither: 0, samples: 2 },
  );
}

/** 先端から接線の向きへ流れる埃 */
function tipDust(frame, age, count, seed, x, y, a) {
  shards(frame, age, count, seed, (i, rnd) => {
    const t = a + Math.PI / 2 + (rnd(1) - 0.5) * 1.2;
    const sp = 2.5 + rnd(2) * 3.5;
    return { x: x + (rnd(3) - 0.5) * 8, y: y + (rnd(4) - 0.5) * 8, vx: Math.cos(t) * sp, vy: Math.sin(t) * sp, life: 3 + Math.floor(rnd(5) * 3), size: rnd(6) > 0.55 ? 2 : 1 };
  });
}

// -----------------------------------------------------------------------------
// 竜巻（nova 半径 56・4 ヒット）: 中央を持った棒の両端が 2 周し（両端 × 2 周 = 4 回の当たり）、
// 外へ巻き出す大きな風の渦が当たりの円まで広がる。振り終わりは渦がほどけて砂が外へ散る
// -----------------------------------------------------------------------------

/** 当たりの円の半径（56 論理 px × 2） */
const TORN_R = 112;
const TORN_N = 13;
const TORN_A = 8;
const TORN_START = -Math.PI / 2;
const TORN_TURNS = 2;
/** 当たりの光るフレーム（両端が当たりの円の縁を打つ 4 回） */
const TORN_HITS = [1, 3, 5, 7];

function tornadoRot(p, k) {
  return TORN_START + TORN_TURNS * TAU * p + 0.7 * k;
}

function tornado(frame, f) {
  const { p, k } = timing(f, TORN_A, TORN_N);
  const rot = tornadoRot(p, k);
  // 1) 外へ巻き出す渦の筋 6 本: 内から外へ時計回りに巻く。回りながら外へ広がり、振り終わりはほどけて欠ける
  if (f >= 1) {
    const grow = Math.min(1, f / 4);
    const count = 6;
    for (let i = 0; i < count; i++) {
      const a0 = rot - 3.2 + (i / count) * TAU + hash1(i, 6101) * 0.35;
      spiral(frame, {
        a0,
        sweep: 2.8 * (1 - 0.35 * k),
        rIn: 20 + 20 * k + hash1(i, 6102) * 6,
        rOut: (TORN_R * 0.55 + TORN_R * 0.5 * grow) + k * 14,
        width: i % 2 === 0 ? 1.8 : 1.3,
        bright: 0.58 * (0.8 + 0.2 * hash1(i, 6103)) * (1 - 0.45 * k),
        erosion: 0.12 + k * 0.85,
        seed: 6110 + i,
      });
    }
  }
  // 2) 棒の両端のブレ（2 本の扇が向かい合って回る。棒 1 本の両端なので 1 振り 1 本の決まりの内）
  const span = Math.min(TORN_TURNS * TAU * p, 100 * DEG) * (1 - 0.55 * k);
  for (let e = 0; e < 2; e++) {
    const head = rot + e * Math.PI;
    blurFan(frame, { R: TORN_R - 6, r0: 10, head, span, n: 14, seed: 6120 + e * 17, fade: k, lead: f < TORN_A, leadW: 4 });
  }
  // 3) 4 回の当たり: 打った先端の円盤と、当たりの円の縁を走る細い輪の閃き（輪は半分欠けた薄い線）
  const hitIdx = TORN_HITS.indexOf(f);
  if (hitIdx >= 0) {
    const e = hitIdx % 2;
    const head = rot + e * Math.PI;
    const tip = polar(0, 0, head, TORN_R - 9);
    disc(frame, tip.x, tip.y, 7, 0.9);
    sparkle(frame, tip.x, tip.y, hitIdx === 3 ? 4 : 3);
    rays(frame, tip.x, tip.y, { count: 5, r0: 8, r1: 17, seed: 6130 + f, a0: head, cone: 2.2, bright: 0.7 });
    ring(frame, { radius: TORN_R - 2, width: 1.8, erosion: 0.45, bright: 0.55, seed: 6140 + f });
  }
  // 4) 最後の当たりの余韻: 当たりの円の外へ押し出される風圧の輪と、外周の速度線
  if (f >= TORN_A - 1) {
    const age = f - (TORN_A - 1);
    ring(frame, { radius: TORN_R - 4 + age * 6, width: 2.8 - age * 0.35, erosion: Math.min(0.94, 0.1 + age * 0.17), bright: 0.8 - age * 0.08, seed: 6150 });
    if (age <= 3) {
      for (let i = 0; i < 6; i++) {
        const a = rot + (i / 6) * TAU + hash1(i, 6151) * 0.6;
        arcLine(frame, { radius: TORN_R + 6 + age * 7 + (i % 2) * 3, from: a - 0.35 - 0.2 * hash1(i, 6152), to: a, bright: 0.52 - age * 0.12 });
      }
    }
    // 砂と棒の粒: 当たりの円の縁から接線（時計回り）と外向きへ
    shards(frame, age, 40, 6160, (i, rnd) => {
      const a = rnd(1) * TAU;
      const r = TORN_R * (0.55 + 0.4 * rnd(2));
      const sp = 3.5 + rnd(3) * 5;
      const out = 0.35 + 0.5 * rnd(4);
      return {
        x: Math.cos(a) * r,
        y: Math.sin(a) * r,
        vx: (-Math.sin(a) * (1 - out) + Math.cos(a) * out) * sp,
        vy: (Math.cos(a) * (1 - out) + Math.sin(a) * out) * sp,
        life: 3 + Math.floor(rnd(5) * 3),
        size: rnd(6) > 0.5 ? 2 : 1,
      };
    });
  }
  if (f >= 1 && f < TORN_A) {
    // 中心の手元: 棒を回す手の小さな渦（中心が空だと棒が 2 本に割れて見える）
    ring(frame, { radius: 9, width: 1.6, erosion: 0.35, bright: 0.5, seed: 6170 + f });
  }
}

/** 竜巻の地面: 当たりの円の縁と、地面を這う砂の渦の筋（外へほどける）。斬撃と同じフレームで広がって消える */
function tornadoGround(frame, f) {
  const { p, k } = timing(f, TORN_A, TORN_N);
  const grow = Math.min(1, (f + 1) / 3);
  const dim = 0.4 * (1 - k * 0.6);
  ring(frame, { radius: (TORN_R - 2) * (0.75 + 0.25 * grow), width: 2, erosion: k * 0.9, bright: dim, seed: 6201 });
  if (grow < 1 || k >= 0.9) return;
  // 地面の渦は棒より遅く回る（地面を擦る砂が遅れて巻く）
  const rot = TORN_START + TORN_TURNS * TAU * p * 0.35 + 0.3 * k;
  for (let i = 0; i < 8; i++) {
    const a0 = rot + (i / 8) * TAU;
    spiral(frame, { a0, sweep: 1.3, rIn: 30 + 10 * hash1(i, 6202) + k * 20, rOut: TORN_R - 10 + k * 8, width: 1.2, bright: dim * 0.9, erosion: 0.3 + k * 0.7, seed: 6210 + i });
  }
}

/** 竜巻の発動: 頭上で棒を小さく速く回し（両端の短いブレ）、風が足元から巻き上がりはじめる */
function tornadoCast(frame, f) {
  const N = 8;
  const k = f / (N - 1);
  const rot = -Math.PI / 2 + f * 1.3;
  if (f < 6) {
    for (let e = 0; e < 2; e++) {
      blurFan(frame, { R: 34 + f * 2, r0: 4, head: rot + e * Math.PI, span: 1.3 + f * 0.1, n: 8, seed: 6301 + e * 5, fade: Math.max(0, k - 0.3), leadW: 2.4, bright: 0.8 });
    }
  }
  // 巻き上がりはじめる風: 2 本の渦の筋が外へ伸びる
  for (let i = 0; i < 3; i++) {
    spiral(frame, { a0: rot - 2 + (i / 3) * TAU, sweep: 1.8, rIn: 14, rOut: 30 + f * 5, bright: 0.55 * (1 - k * 0.5), erosion: k * 0.7, seed: 6310 + i });
  }
  if (f === 3) sparkle(frame, 0, 0, 3);
  shards(frame, f, 10, 6320, (i, rnd) => {
    const a = rnd(1) * TAU;
    const sp = 2.5 + rnd(2) * 3;
    return { x: Math.cos(a) * 20, y: Math.sin(a) * 20, vx: -Math.sin(a) * sp, vy: Math.cos(a) * sp, life: 3 + Math.floor(rnd(3) * 2), size: 1 };
  });
}

/** 竜巻の気力の回復（buff mana 30）: 散った風が細い流れになって自分へ戻り、胸で小さく灯って上へ抜ける */
function tornadoBreath(frame, f) {
  const N = 9;
  const gather = 5;
  if (f < gather) {
    const p = (f + 1) / gather;
    // 内へ巻き戻る渦（竜巻の渦と逆に、外から内へ細る）
    for (let i = 0; i < 4; i++) {
      const a0 = (i / 4) * TAU + f * 0.5;
      spiral(frame, { a0, sweep: 1.6, rIn: 64 - 44 * p, rOut: 20 - 10 * p, width: 1.2, bright: 0.45 + 0.3 * p, seed: 6401 + i });
    }
    // 戻ってくる粒
    for (let i = 0; i < 14; i++) {
      const a = hash1(i, 6410) * TAU + p * 1.2;
      const r = (60 + 20 * hash1(i, 6411)) * (1 - p) + 8;
      dot(frame, Math.cos(a) * r, Math.sin(a) * r, Math.round(3 + 2 * p));
    }
    if (f === gather - 1) sparkle(frame, 0, -6, 3);
    return;
  }
  const k = (f - gather + 1) / (N - gather);
  // 満ちた気が胸で灯り、上へ抜けて消える
  disc(frame, 0, -6, 6 * (1 - k * 0.5), 0.8 - k * 0.4);
  ring(frame, { oy: -6, radius: 8 + k * 16, width: 2.2 - k, erosion: Math.min(0.9, k * 0.85), bright: 0.75 - k * 0.3, seed: 6420 });
  shards(frame, f - gather, 10, 6430, (i, rnd) => {
    const x = (rnd(1) - 0.5) * 24;
    return { x, y: -6, vx: x * 0.05, vy: -(3 + rnd(2) * 3), life: 3 + Math.floor(rnd(3) * 2), size: rnd(4) > 0.5 ? 2 : 1, drag: 0.92 };
  });
}

// -----------------------------------------------------------------------------
// 千本突き（thrust reach 60・幅 20・5 ヒット）: 5 回の突きを時間と横の位置で分ける（重なった二重線に見せない）。
// 同時に見えるのは「今の突き」と「消えていく 1 本前」だけ。最後の 1 本は中央を長く突いて大きく弾ける
// -----------------------------------------------------------------------------

/** 届き（60 論理 px × 2） */
const THRUST_L = 120;
/** 当たりの幅の半分（幅 20 論理 px） */
const THRUST_HALF = 20;
const THRUSTS_N = 12;
const THRUSTS_A = 7;
/** 5 回の突き: 出るフレーム・横の位置・届き（最後は中央・最長） */
const THRUSTS = [
  { at: 0, y: -9, reach: 104 },
  { at: 1, y: 11, reach: 110 },
  { at: 2, y: -2, reach: 100 },
  { at: 3, y: 14, reach: 106 },
  { at: 5, y: 0, reach: THRUST_L },
];

/** 1 回の突きの棒の通り道（太い中央の筋 + 両脇の細い筋）。age 0 = 伸びきった瞬間、以降は後ろから痩せる */
function thrustLine(frame, t, age, seed, last) {
  const fade = Math.min(1, age / (last ? 4 : 2.2));
  if (fade >= 1) return;
  const back = 8 + (t.reach - 8) * 0.55 * fade;
  const w = (last ? 4.2 : 3) * (1 - 0.5 * fade);
  streakLine(frame, { ax: back, ay: t.y, bx: t.reach - 2, by: t.y, width: w, bright: (last ? 0.88 : 0.8) * (1 - fade * 0.6) });
  const lines = last ? 6 : 3;
  for (let i = 0; i < lines; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const y = t.y + side * (5 + Math.floor(i / 2) * 3 + hash1(i, seed) * 1.5 + fade * 3);
    if (Math.abs(y) > THRUST_HALF + 4) continue;
    const len = t.reach * (0.35 + 0.35 * hash1(i, seed + 1)) * (1 - fade * 0.6);
    const x1 = t.reach - 8 - Math.abs(y - t.y) * 0.8 - hash1(i, seed + 2) * 10 - fade * 14;
    if (len < 4) continue;
    streakLine(frame, { ax: x1 - len, ay: y, bx: x1, by: y, width: 1.2, bright: 0.58 * (1 - fade) });
  }
}

function thousandThrusts(frame, f) {
  const { k } = timing(f, THRUSTS_A, THRUSTS_N);
  // 背景の速度線: 当たりの帯の中を前へ流れる細い筋（連打の勢い。突き自体より暗い）
  if (f <= THRUSTS_A && k < 0.8) {
    for (let i = 0; i < 6; i++) {
      const y = (i / 5 - 0.5) * THRUST_HALF * 2 + (hash1(i, 7101) - 0.5) * 4;
      const x1 = 40 + ((f * 23 + i * 37) % 70);
      streakLine(frame, { ax: x1 - 24 - 12 * hash1(i, 7102), ay: y, bx: x1, by: y, width: 1, bright: 0.34 });
    }
  }
  THRUSTS.forEach((t, j) => {
    const age = f - t.at;
    if (age < 0) return;
    const last = j === THRUSTS.length - 1;
    const seed = 7110 + j * 11;
    // 伸びる途中（出た枚）は届きの 7 割、次の枚で伸びきる
    if (age === 0 && last) {
      thrustLine(frame, { ...t, reach: t.reach * 0.7 }, 0, seed, last);
      return;
    }
    const hitAge = last ? age - 1 : age;
    thrustLine(frame, t, hitAge, seed, last);
    if (!last) {
      if (hitAge <= 3) impact(frame, t.reach + 2, t.y, hitAge, { size: 10, seed: seed + 5, rays: 5, a0: 0, cone: 2.4 });
      return;
    }
    // 最後の 1 本: 大きな円盤と八方の放射線、二重の輪、前へ弾ける粒
    const x = t.reach + 2;
    if (hitAge === 0) {
      disc(frame, x, 0, 12, 1);
      sparkle(frame, x, 0, 4);
      rays(frame, x, 0, { count: 9, r0: 13, r1: 30, seed: seed + 6, a0: 0.15, bright: 0.82, width: 1.5 });
      return;
    }
    if (hitAge <= 2) rays(frame, x, 0, { count: 9, r0: 16 + hitAge * 9, r1: 30 + hitAge * 10, seed: seed + 6, a0: 0.15, bright: 0.66 - hitAge * 0.14 });
    if (hitAge === 1) disc(frame, x, 0, 8, 0.8);
    ring(frame, { ox: x, radius: 12 + hitAge * 7, width: 3.2 - hitAge * 0.3, erosion: Math.min(0.92, (hitAge - 1) * 0.18), bright: 0.86 - hitAge * 0.08, seed: seed + 7 });
    if (hitAge >= 2) ring(frame, { ox: x + 4, radius: 6 + (hitAge - 1) * 8, width: 2.2, squash: 0.55, erosion: Math.min(0.92, (hitAge - 2) * 0.24), bright: 0.66 - hitAge * 0.06, seed: seed + 8 });
    shards(frame, hitAge - 1, 18, seed + 9, (i, rnd) => {
      const a = (rnd(1) - 0.5) * 2.4;
      const sp = 3 + rnd(2) * 4.5;
      return { x, y: 0, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(3) * 3), size: rnd(4) > 0.5 ? 2 : 1 };
    });
  });
}

/** 千本突きの発動: 棒を後ろへ引き絞る（後ろへ流れる平行の筋）→ 構えの先で光点、踏み込みの潰れた輪 */
function thousandThrustsCast(frame, f) {
  const N = 7;
  const k = f / (N - 1);
  if (f <= 3) {
    // 引き絞り: 前（+x）から後ろへ詰まってくる筋。棒の握りに沿う 3 本
    const pull = (f + 1) / 4;
    for (let i = 0; i < 3; i++) {
      const y = (i - 1) * 4;
      const x1 = 30 - pull * 18 - i * 3;
      streakLine(frame, { ax: x1 - 30 - i * 6, ay: y, bx: x1, by: y, width: i === 1 ? 2.6 : 1.2, bright: 0.5 + 0.35 * pull - Math.abs(i - 1) * 0.12 });
    }
  }
  if (f === 3) sparkle(frame, 18, 0, 3);
  if (f === 4) sparkle(frame, 22, 0, 2);
  // 踏み込みの足元: 前後に潰れた輪が後ろ寄りに広がる
  ring(frame, { ox: -4 - f * 1.5, radius: 8 + f * 4.5, width: 2.4 - k, squash: 0.55, erosion: Math.min(0.9, k * 0.9), bright: 0.72 - k * 0.3, seed: 7201 });
  shards(frame, f, 8, 7210, (i, rnd) => {
    const a = Math.PI + (rnd(1) - 0.5) * 1.8;
    const sp = 2.5 + rnd(2) * 3;
    return { x: -8, y: (rnd(3) - 0.5) * 12, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(4) * 2), size: 1 };
  });
}

// -----------------------------------------------------------------------------
// 柔の呼吸（持続）: 刃も打撃も無い、ゆっくり巡る流れ。体の周りを 2 本の帯が楕円に巡り、足元に水面の波紋が広がる
// dirs 1（画面に揃える）。楕円は上下に潰して「腰の高さを回る輪」に見せる
// -----------------------------------------------------------------------------

/** 足元の高さ（キャラは絵で 48 ドット） */
const FEET_Y = 18;
/** 流れの楕円の中心の高さ（腰）と横の半径・潰し */
const FLOW_Y = 4;
const FLOW_RX = 36;
const FLOW_SQUASH = 2.4;
const FLOW_N = 12;
/** 流れの帯の明るさの上限（白は光点だけ） */
const FLOW_CAP = 0.74;

/**
 * 流れの帯 1 本: 楕円の上を角 head から後ろへ len だけ伸びる、先が太く尾が細い帯。
 * 奥（楕円の上半分）はキャラの後ろになるので暗くする（手前と奥で前後を見せる）
 */
function flowBand(frame, o) {
  const { head, len, rx, cy, width } = o;
  const squash = o.squash ?? FLOW_SQUASH;
  const bright = o.bright ?? 1;
  const erosion = o.erosion ?? 0;
  const seed = o.seed ?? 1;
  const ry = rx / squash;
  paint(
    frame,
    (x, y) => {
      const dx = x;
      const dy = (y - cy) * squash;
      const r = Math.hypot(dx, dy);
      const s = wrapAngle(head - Math.atan2(dy, dx));
      const u = s < 0 ? s + TAU : s;
      if (u > len) return -1;
      const t = u / len;
      const half = (width / 2) * Math.pow(1 - t, 0.7) * Math.min(1, (u + 0.05) / 0.25);
      // 楕円の上下（y を潰した所）では半径方向の差が画面では 1/squash になる
      const sn = Math.sin(Math.atan2(dy, dx));
      const d = Math.abs(r - rx) / (1 + (squash - 1) * sn * sn);
      if (half < 0.5) return -1;
      const q = d / half;
      if (q > 1) return -1;
      if (erosion > 0 && valueNoise(x, y, 4, seed) + (1 - t) * 0.3 - erosion < 0.2) return -1;
      const depth = Math.sin(Math.atan2(dy, dx)) < 0 ? 0.6 : 1;
      return Math.min(FLOW_CAP, clamp01((1 - q) ** 0.8 * (0.55 + 0.45 * (1 - t)) * depth * bright));
    },
    { bounds: { x0: -rx - width - 2, y0: cy - ry - width - 2, x1: rx + width + 2, y1: cy + ry + width + 2 }, samples: 2 },
  );
}

/** 柔の呼吸の纏い（持続中ずっと）。帯は 2 本で向かい合うので、1 巡で半周すれば継ぎ目が出ない */
function flowBreath(frame, f) {
  const cycle = f / FLOW_N;
  const rot = cycle * Math.PI;
  // 息づかい: 1 巡に 1 回、帯がわずかに膨らんで縮む
  const breath = 0.5 - 0.5 * Math.cos(cycle * TAU);
  for (let e = 0; e < 2; e++) {
    flowBand(frame, { head: rot + e * Math.PI, len: 2.1, rx: FLOW_RX + breath * 3, cy: FLOW_Y - e * 2, width: 6 + breath * 1.5, bright: 0.85 + 0.15 * breath, seed: 8101 + e });
  }
  // 帯の先から後ろへ流れる細い筋（帯の外側だけ。内側に二重の帯を作らない）
  for (let e = 0; e < 2; e++) {
    const head = rot + e * Math.PI;
    for (let j = 0; j < 2; j++) {
      const a = head - 0.3 - j * 0.5;
      const r = FLOW_RX + 7 + j * 3 + breath * 3;
      const p0 = { x: Math.cos(a) * r, y: FLOW_Y + (Math.sin(a) * r) / FLOW_SQUASH };
      const p1 = { x: Math.cos(a - 0.45) * r, y: FLOW_Y + (Math.sin(a - 0.45) * r) / FLOW_SQUASH };
      streakLine(frame, { ax: p1.x, ay: p1.y, bx: p0.x, by: p0.y, width: 1, bright: 0.4 - j * 0.1 });
    }
  }
  // 立ちのぼる呼気の粒: ゆっくり上へ流れ、1 巡で元へ戻る（顔の前は避ける）
  for (let i = 0; i < 8; i++) {
    const t = (cycle + hash1(i, 8110)) % 1;
    const x = (hash1(i, 8111) - 0.5) * 64 + Math.sin(t * TAU + i) * 3;
    const y = FEET_Y - t * 56;
    if (Math.abs(x) < 11 && y > -24) continue;
    dot(frame, x, y, Math.max(2, Math.min(5, Math.round(2 + 3 * Math.sin(Math.PI * t)))));
  }
  // 息を吸いきった所で帯の先に光点（1 巡に 1 回）
  if (f === Math.round(FLOW_N / 2)) {
    const a = rot;
    sparkle(frame, Math.cos(a) * (FLOW_RX + 3), FLOW_Y + (Math.sin(a) * (FLOW_RX + 3)) / FLOW_SQUASH, 2);
  }
}

/** 柔の呼吸の地面: 足元から外へ広がる水面の波紋 3 本（位相をずらして 1 巡で 1 本分進む。継ぎ目が出ない） */
function flowBreathGround(frame, f) {
  const cycle = f / FLOW_N;
  for (let i = 0; i < 3; i++) {
    const t = (cycle + i / 3) % 1;
    const radius = 10 + t * 28;
    const b = 0.42 * Math.sin(Math.PI * Math.min(1, t * 1.1 + 0.05));
    if (b < 0.08) continue;
    ring(frame, { oy: FEET_Y, radius, width: 1.6 - t * 0.4, squash: FLOW_SQUASH, erosion: t * 0.55, bright: b, seed: 8201 + i });
  }
}

/** 柔の呼吸の発動: 息を吸う（波紋が外から足元へ寄る）→ 吐く（帯が体の周りへ解けて広がり、足元の輪が外へ） */
function flowBreathCast(frame, f) {
  const N = 10;
  const inhale = 4;
  if (f < inhale) {
    const p = (f + 1) / inhale;
    ring(frame, { oy: FEET_Y, radius: 36 - 22 * p, width: 1.8, squash: FLOW_SQUASH, bright: 0.35 + 0.35 * p, seed: 8301 });
    ring(frame, { oy: FEET_Y, radius: 48 - 28 * p, width: 1.4, squash: FLOW_SQUASH, erosion: 0.4, bright: 0.25 + 0.25 * p, seed: 8302 });
    // 吸い込まれる呼気の粒
    for (let i = 0; i < 10; i++) {
      const a = hash1(i, 8303) * TAU;
      const r = (50 + 16 * hash1(i, 8304)) * (1 - p * 0.75);
      dot(frame, Math.cos(a) * r, FLOW_Y + (Math.sin(a) * r) / 1.6, Math.round(2 + 3 * p));
    }
    if (f === inhale - 1) sparkle(frame, 0, FLOW_Y - 4, 3);
    return;
  }
  const k = (f - inhale + 1) / (N - inhale);
  // 吐く: 2 本の帯が体の周りを半周しながら外へ広がり、ほどけて消える
  for (let e = 0; e < 2; e++) {
    flowBand(frame, { head: -Math.PI / 2 + k * Math.PI * 1.2 + e * Math.PI, len: 1.4 + k * 1.2, rx: 22 + k * 30, cy: FLOW_Y, width: 7 - k * 2.5, bright: 1 - k * 0.3, erosion: k * 0.75, seed: 8310 + e });
  }
  ring(frame, { oy: FEET_Y, radius: 12 + k * 30, width: 2.4 - k * 1.1, squash: FLOW_SQUASH, erosion: Math.min(0.92, k * 0.9), bright: 0.75 - k * 0.3, seed: 8320 });
  if (f === inhale) sparkle(frame, 0, FLOW_Y - 4, 4);
  shards(frame, f - inhale, 12, 8330, (i, rnd) => {
    const a = rnd(1) * TAU;
    const sp = 2 + rnd(2) * 2.5;
    return { x: Math.cos(a) * 18, y: FLOW_Y + Math.sin(a) * 8, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.45 - 0.6, life: 3 + Math.floor(rnd(3) * 3), size: rnd(4) > 0.5 ? 2 : 1 };
  });
}

// -----------------------------------------------------------------------------
// 表
// -----------------------------------------------------------------------------

/**
 * 奥義 → 絵（render/fxMotions.ts の buildUltimateFx が読む）。life は流し切る秒、base は描いたときの大きさ（論理 px）。
 * 竜巻の base は周囲攻撃の半径、千本突きの base は振りの届き。竜巻の acts[1] は気力の回復（buff）で大きさを持たない
 */
const FX = {
  moveset: "staff",
  ultimates: {
    "staff.tornado": {
      ramp: "light",
      cast: { sheet: "staffUlt.tornadoCast", life: 0.35 },
      acts: [
        { sheet: "staffUlt.tornado", life: 0.7, base: TORN_R / 2, pivot: "pos", ground: "staffUlt.tornadoGround" },
        { sheet: "staffUlt.tornadoBreath", life: 0.5, base: 0, pivot: "pos" },
      ],
    },
    "staff.thousandThrusts": {
      ramp: "light",
      cast: { sheet: "staffUlt.thousandThrustsCast", life: 0.3 },
      acts: [{ sheet: "staffUlt.thousandThrusts", life: 0.6, base: THRUST_L / 2, pivot: "pos" }],
    },
    "staff.flowBreath": {
      ramp: "light",
      cast: { sheet: "staffUlt.flowBreathCast", life: 0.6 },
      sustain: { sheet: "staffUlt.flowBreath", period: 1.4, ground: "staffUlt.flowBreathGround" },
    },
  },
};

export const ATLAS = {
  key: "staffUlt",
  fx: FX,
  sheets: [
    { key: "staffUlt.tornado", dirs: 1, frames: TORN_N, active: TORN_A, size: 2 * (TORN_R + 36), draw: tornado },
    { key: "staffUlt.tornadoGround", dirs: 1, frames: TORN_N, active: TORN_A, size: 2 * (TORN_R + 10), draw: tornadoGround },
    { key: "staffUlt.tornadoCast", dirs: 1, frames: 8, active: 0, size: 136, draw: tornadoCast },
    { key: "staffUlt.tornadoBreath", dirs: 1, frames: 9, active: 0, size: 160, draw: tornadoBreath },
    { key: "staffUlt.thousandThrusts", dirs: DIRS, frames: THRUSTS_N, active: THRUSTS_A, size: 2 * (THRUST_L + 44), draw: thousandThrusts },
    { key: "staffUlt.thousandThrustsCast", dirs: DIRS, frames: 7, active: 0, size: 112, draw: thousandThrustsCast },
    { key: "staffUlt.flowBreathCast", dirs: 1, frames: 10, active: 0, size: 256, draw: flowBreathCast },
    { key: "staffUlt.flowBreath", dirs: 1, frames: FLOW_N, active: 0, size: 128, draw: flowBreath },
    { key: "staffUlt.flowBreathGround", dirs: 1, frames: FLOW_N, active: 0, size: 224, draw: flowBreathGround },
  ],
};
