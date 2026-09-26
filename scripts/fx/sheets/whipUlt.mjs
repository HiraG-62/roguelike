// 鞭（moveset "whip"）の奥義 3 本のエフェクト。docs/ideas/fx-sprites.md 9 章。見本は swordUlt.mjs、形の言葉は whip.mjs
// 単位は絵のドット（論理 0.5px）。数値は src/data/balance/ultimates/ULTIMATE/defs/whip.json × 2 が目安
//
// 鞭の形の言葉（whip.mjs）をそのまま大きくする: 「細く長い 1 本の線（tube）」「手元から先端へ伝わる波」「伸び切った先端の破裂」。
// 3 本とも属性 lightning なので、鞭の線に「雷の折れ線（bolt）」を添えて通常の振りと見分ける。
// 決まり: 1 本の鞭は 1 本の線で描く（内側に残像の線を重ねない）。複数の線は実際に複数を捕える・何度も鳴らすときだけ、角度か時間をはっきり分ける。
// 白（段 7）は光点と破裂の閃きだけ。雷の線も段 6 までに抑える
import { arcLine, easeSwing, ring, shards, sparkle, streakLine } from "../shapes.mjs";
import { clamp01, dot, hash1, paint, valueNoise } from "../raster.mjs";
import { DIRS } from "../motifs.mjs";

const TAU = Math.PI * 2;
/** 鞭の手元（whip.mjs と同じ。キャラの手の辺り） */
const HAND = 10;
/** 1 本の鞭を何点の折れ線で描くか */
const LINE_POINTS = 64;
/** 雷の線の明るさ（段 6 の上端。白は光点だけに使う） */
const BOLT_LUM = 0.74;
/** 足元の高さ（キャラは絵で 48 ドット） */
const FEET_Y = 18;

// -----------------------------------------------------------------------------
// 部品: 鞭の管・破裂・雷の折れ線（whip.mjs の tube / burst を写して奥義向けに作り変えたもの）
// -----------------------------------------------------------------------------

/**
 * 鞭の本体（折れ線 pts に沿う細い管）。太さは手元 w0 → 先端 w1（半幅）で細る。
 * glow は先端側 glowLen の範囲だけ明るくする（白い塊を作らない）
 */
function tube(frame, pts, o) {
  const n = pts.length;
  if (n < 2) return;
  const cum = [0];
  for (let i = 1; i < n; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  const total = Math.max(1e-3, cum[n - 1]);
  const w0 = o.w0 ?? 1.5;
  const w1 = o.w1 ?? 0.8;
  const bright = o.bright ?? 1;
  const erosion = o.erosion ?? 0;
  const seed = o.seed ?? 9;
  const glow = o.glow ?? 0;
  const glowLen = o.glowLen ?? 0.15;
  const lum = o.lum ?? ((u) => 0.62 + 0.16 * u);
  const CH = 6;
  for (let c = 0; c < n - 1; c += CH) {
    const i0 = Math.max(0, c - 1);
    const i1 = Math.min(n - 1, c + CH + 1);
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (let i = i0; i <= i1; i++) {
      x0 = Math.min(x0, pts[i].x);
      y0 = Math.min(y0, pts[i].y);
      x1 = Math.max(x1, pts[i].x);
      y1 = Math.max(y1, pts[i].y);
    }
    const pad = Math.max(w0, w1) + 2;
    paint(
      frame,
      (x, y) => {
        let best = Infinity;
        let bu = 0;
        // 1 フレームで何十万回も呼ぶので、segment() のオブジェクトを作らず展開する
        for (let i = i0; i < i1; i++) {
          const ax = pts[i].x;
          const ay = pts[i].y;
          const dx = pts[i + 1].x - ax;
          const dy = pts[i + 1].y - ay;
          const l2 = dx * dx + dy * dy;
          let t = l2 > 0 ? ((x - ax) * dx + (y - ay) * dy) / l2 : 0;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const ex = ax + dx * t - x;
          const ey = ay + dy * t - y;
          const d2 = ex * ex + ey * ey;
          if (d2 < best) {
            best = d2;
            bu = (cum[i] + (cum[i + 1] - cum[i]) * t) / total;
          }
        }
        best = Math.sqrt(best);
        const hw = w0 + (w1 - w0) * Math.pow(bu, 0.8);
        if (best > hw) return -1;
        const q = best / hw;
        if (erosion > 0 && valueNoise(x, y, 4, seed) * 0.7 + (1 - q) * 0.25 + (1 - bu) * 0.1 - erosion * 1.1 < 0) return -1;
        let v = Math.pow(1 - q, 0.55) * lum(bu);
        if (glow > 0 && bu > 1 - glowLen) v += glow * ((bu - (1 - glowLen)) / glowLen) * (1 - q * 0.8);
        return clamp01(v * bright * (1 - erosion * 0.35));
      },
      { bounds: { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad } },
    );
  }
}

/** 点列を原点の周りに角 a だけ回す（放射状に何本も出す鞭を、+x 向きで作ってから回す） */
function rotPts(pts, a) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return pts.map((p) => ({ x: p.x * c - p.y * s, y: p.x * s + p.y * c }));
}

/** 直線の軸に沿う鞭の折れ線。s（0..1）で x を手元 → 先端へ、y = wave(s) で横に振る */
function linePts(xa, xb, wave, n = LINE_POINTS) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const s = i / n;
    pts.push({ x: xa + (xb - xa) * s, y: wave(s) });
  }
  return pts;
}

/**
 * 雷の折れ線（a → b）。段 6 までの細い線で、途中の節を seed で横へ振る。
 * forks で途中から短い枝を出す（雷らしさ。枝は幹より暗く細い）
 */
function bolt(frame, ax, ay, bx, by, o = {}) {
  const seed = o.seed ?? 1;
  const len = Math.hypot(bx - ax, by - ay);
  if (len < 2) return;
  const jag = o.jag ?? Math.min(6, len * 0.12);
  const n = Math.max(2, Math.round(len / (o.seg ?? 7)));
  const nx = -(by - ay) / len;
  const ny = (bx - ax) / len;
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const off = i === 0 || i === n ? 0 : (hash1(i, seed) - 0.5) * 2 * jag * Math.sqrt(Math.sin(Math.PI * t));
    pts.push({ x: ax + (bx - ax) * t + nx * off, y: ay + (by - ay) * t + ny * off });
  }
  const bright = o.bright ?? 1;
  const w = o.w ?? 1.1;
  tube(frame, pts, { w0: w, w1: w * 0.8, bright, erosion: o.erosion ?? 0, seed: seed + 3, lum: () => BOLT_LUM });
  const forks = o.forks ?? 0;
  for (let k = 0; k < forks; k++) {
    const idx = 1 + Math.floor(hash1(k, seed + 5) * (n - 1));
    const p = pts[Math.min(n - 1, idx)];
    const side = hash1(k, seed + 6) > 0.5 ? 1 : -1;
    const base = Math.atan2(by - ay, bx - ax) + side * (0.5 + 0.4 * hash1(k, seed + 7));
    const fl = len * (0.22 + 0.18 * hash1(k, seed + 8));
    tubeless(frame, p.x, p.y, p.x + Math.cos(base) * fl, p.y + Math.sin(base) * fl, seed + 20 + k, bright * 0.75, o.erosion ?? 0);
  }
}

/** 枝の雷（幹より細く、節は少なく）。bolt から再帰させずに 1 段だけ */
function tubeless(frame, ax, ay, bx, by, seed, bright, erosion) {
  const len = Math.hypot(bx - ax, by - ay);
  const n = Math.max(2, Math.round(len / 6));
  const nx = -(by - ay) / len;
  const ny = (bx - ax) / len;
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const off = i === 0 || i === n ? 0 : (hash1(i, seed) - 0.5) * 2 * Math.min(4, len * 0.18);
    pts.push({ x: ax + (bx - ax) * t + nx * off, y: ay + (by - ay) * t + ny * off });
  }
  tube(frame, pts, { w0: 0.85, w1: 0.6, bright, erosion, seed: seed + 1, lum: () => BOLT_LUM * 0.85 });
}

/**
 * 先端の破裂（「パァン」）。age 0 = 弾けた瞬間: 光点 + 短い放射線。以後は放射線が外へ抜け、輪が広がって欠け、火花が散る
 */
function burst(frame, x, y, age, o) {
  const size = o.size ?? 3;
  const lines = o.lines ?? 8;
  const len = o.len ?? 12;
  const seed = o.seed ?? 71;
  const life = o.life ?? 4;
  if (age < 0 || age > life + 2) return;
  const k = age / life;
  if (age <= 1) sparkle(frame, x, y, age === 0 ? size : Math.max(2, size - 1));
  if (k < 1) {
    for (let i = 0; i < lines; i++) {
      const a = (i / lines) * TAU + (o.rot ?? 0.2) + (hash1(i, seed) - 0.5) * 0.3;
      const long = i % 2 === 0 ? 1 : 0.55;
      const r1 = len * long * (0.85 + 0.3 * hash1(i, seed + 1)) * (1 + age * 0.3);
      const r0 = age === 0 ? 3 : Math.min(r1 - 2, len * (0.35 + age * 0.35) * long);
      if (r1 - r0 < 1.5) continue;
      streakLine(frame, { ax: x + Math.cos(a) * r0, ay: y + Math.sin(a) * r0, bx: x + Math.cos(a) * r1, by: y + Math.sin(a) * r1, width: age === 0 && long === 1 ? 1.6 : 1.1, bright: (0.7 + 0.3 * long) * (1 - k * 0.55) });
    }
  }
  if ((o.ring ?? 1) > 0 && age >= 1) {
    const rr = (o.ringR ?? 4) + (age - 1) * (o.ringSpeed ?? 4);
    ring(frame, { ox: x, oy: y, radius: rr, width: 1.8, erosion: Math.min(0.92, 0.1 + age * 0.2), bright: 0.75 - age * 0.08, seed: seed + 2 });
  }
  shards(frame, age, o.shards ?? 6, seed + 3, (i, rnd) => {
    const a = (o.spray ?? 0) + (rnd(1) - 0.5) * (o.spread ?? TAU);
    const sp = 2.5 + rnd(2) * 3.5;
    return { x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(3) * 2), size: rnd(4) > 0.5 ? 2 : 1 };
  });
}

/** 鳴りの弧（鞭の音）: (x, y) から dir の向きへ開いた短い弧が 3 枚、外へ広がる */
function crackArcs(frame, x, y, dir, age, scale = 1) {
  for (let i = 0; i < 3; i++) {
    const r = (6 + i * 6 + age * 5) * scale;
    const half = (0.8 - i * 0.12) * (1 - age * 0.14);
    if (half <= 0.15) continue;
    // arcLine は原点の周りの弧なので、中心を破裂点より少し後ろに置いて前へ開かせる
    const cx = x - Math.cos(dir) * 4;
    const cy = y - Math.sin(dir) * 4;
    arcLine(frame, { ox: cx, oy: cy, radius: r, from: dir - half, to: dir + half, width: 1.2, bright: (0.75 - i * 0.15) * (1 - age * 0.22) });
  }
}

// -----------------------------------------------------------------------------
// 蛇縛り（pull 半径 70 → 24 まで寄せる・恐怖 → nova 34）
// 発動: 鞭が足元でとぐろを巻き、雷を帯びる。行為 0: 7 本の鞭が蛇のように四方へ伸びて掴み、引き戻す（実際に周りの敵を何体も捕えるので本数を出す）。
// 掴んだ敵: 鞭が敵に巻き付いて締まる。行為 1: 巻いた鞭が 1 本の輪になって外へ弾け、うねりの山ごとに鳴る
// -----------------------------------------------------------------------------

/** 引き寄せの半径（70 論理 px × 2）と、寄せた先の距離（24 × 2） */
const PULL_R = 140;
const PULL_TO = 48;
const PULL_N = 11;
const PULL_A = 5;
/** 伸びる鞭の本数（角をはっきり分けて、重なった線に見せない） */
const SERPENTS = 7;

/** 螺旋の点（中心 cx, cy・半径 r0 → r1・角 a0 から turns 周） */
function spiralPts(cx, cy, r0, r1, a0, turns, n) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = a0 + turns * TAU * t;
    const r = r0 + (r1 - r0) * t;
    pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  }
  return pts;
}

/** 蛇縛りの発動: 鞭が外から内へとぐろを巻き込み、巻き終わった瞬間に雷がとぐろを走って弾ける */
function serpentCast(frame, f) {
  const N = 8;
  const wind = 4;
  const p = Math.min(1, (f + 1) / wind);
  const k = f < wind ? 0 : (f - wind + 1) / (N - wind);
  // とぐろ: 外（手元の側）から内へ 1.6 周。巻く量が p で伸び、崩れで欠けて消える
  const turns = 1.6 * easeSwing(p);
  if (turns > 0.05) {
    const pts = spiralPts(0, 0, 46 + k * 6, 46 - 30 * Math.min(1, turns / 1.6) + k * 6, -Math.PI / 2, -turns, Math.ceil(40 * turns) + 4);
    tube(frame, pts, { w0: 1.7, w1: 0.9, bright: 1 - 0.3 * k, erosion: k > 0 ? 0.1 + 0.8 * k : 0, glow: f === wind - 1 ? 0.45 : 0.1, glowLen: 0.12, seed: 1501 });
  }
  if (f === wind - 1) sparkle(frame, 0, -16, 3);
  // 巻き終わりに、とぐろを横切らず外側へ 5 本の短い雷が跳ねる
  if (f >= wind - 1 && f <= wind + 1) {
    const age = f - (wind - 1);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU + 0.3 + age * 0.4;
      const r0 = 50;
      const r1 = r0 + 12 + 8 * hash1(i + age * 5, 1502);
      bolt(frame, Math.cos(a) * r0, Math.sin(a) * r0, Math.cos(a) * r1, Math.sin(a) * r1, { seed: 1503 + i + age * 7, jag: 3, seg: 5, bright: 1 - age * 0.25, w: 1 });
    }
  }
  shards(frame, f - (wind - 1), 12, 1504, (i, rnd) => {
    const a = rnd(1) * TAU;
    const sp = 2.5 + rnd(2) * 3;
    return { x: Math.cos(a) * 30, y: Math.sin(a) * 30, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3, size: rnd(3) > 0.5 ? 2 : 1 };
  });
}

/** 1 本の蛇の鞭（+x 向き）。ext = 伸びた長さ、amp = 蛇行の振れ、ph = 波の位相 */
function serpentPts(len, amp, ph, hook) {
  return linePts(HAND, len, (s) => amp * Math.sin(TAU * (s * 1.8 - ph)) * Math.pow(s, 0.6) + hook * Math.pow(s, 6));
}

function serpentPull(frame, f) {
  const A = PULL_A;
  const k = f < A ? 0 : (f - A + 1) / (PULL_N - A + 1);
  for (let j = 0; j < SERPENTS; j++) {
    const a = -Math.PI / 2 + (j / SERPENTS) * TAU + (hash1(j, 1511) - 0.5) * 0.3;
    // 伸びる（f 0〜3）→ 掴む（f 4。先端が鉤に曲がる）→ 引き戻す（f 5〜）。本ごとに少し遅らせて一斉に見せない
    const lag = hash1(j, 1512) * 0.6;
    const t = f - lag;
    let len;
    let amp;
    let hook = 0;
    let erosion = 0;
    let bright = 1;
    if (t < A - 1) {
      const p = clamp01((t + 1) / (A - 1));
      len = HAND + (PULL_R - HAND) * (0.2 + 0.8 * easeSwing(p));
      amp = 12 * (1 - 0.55 * p);
    } else {
      const g = clamp01((t - (A - 1)) / 4);
      len = PULL_R - (PULL_R - PULL_TO) * easeSwing(g);
      // 引かれる鞭は張って、先端だけ掴んだ形に曲がる
      amp = 5 + 3 * g;
      hook = (j % 2 === 0 ? 1 : -1) * (6 + 4 * g);
      erosion = k > 0.25 ? 0.05 + 0.9 * Math.pow((k - 0.25) / 0.75, 1.1) : 0;
      bright = 1 - 0.3 * k;
    }
    if (erosion >= 0.98) continue;
    const pts = rotPts(serpentPts(len, amp, f * 0.35 + j * 0.37, hook), a);
    tube(frame, pts, { w0: 1.5, w1: 0.8, bright, erosion, glow: Math.round(t) === A - 1 ? 0.5 : 0.1, glowLen: 0.12, seed: 1513 + j });
    const tip = pts[pts.length - 1];
    // 掴んだ瞬間: 先端に光点と、雷の小さな跳ね（属性 lightning の手応え）
    if (f === A - 1) {
      sparkle(frame, tip.x, tip.y, 3);
    } else if (f === A && j % 2 === 0) {
      const oa = a + 0.9;
      bolt(frame, tip.x, tip.y, tip.x + Math.cos(oa) * 12, tip.y + Math.sin(oa) * 12, { seed: 1520 + j, jag: 3, seg: 4, w: 0.9 });
    }
  }
  // 引き戻しの速度線: 鞭の間（角を半分ずらした所）に、内向きの短い筋
  if (f >= A && k < 0.8) {
    for (let j = 0; j < SERPENTS; j++) {
      const a = -Math.PI / 2 + ((j + 0.5) / SERPENTS) * TAU;
      const r1 = PULL_R * (0.85 - 0.4 * k);
      const r0 = r1 - 20;
      streakLine(frame, { ax: Math.cos(a) * r1, ay: Math.sin(a) * r1, bx: Math.cos(a) * r0, by: Math.sin(a) * r0, width: 1, bright: 0.5 * (1 - k) });
    }
  }
}

/** 蛇縛りの地面の紋: 掴む範囲の輪が広がり、引き戻しで内へ縮んで消える。輪の外に鱗のような刻み */
function serpentPullGround(frame, f) {
  const A = PULL_A;
  const grow = Math.min(1, (f + 1) / (A - 1));
  const k = f < A ? 0 : (f - A + 1) / (PULL_N - A + 1);
  const R = (PULL_R - 4) * (0.55 + 0.45 * easeSwing(grow)) - (PULL_R - PULL_TO) * 0.6 * easeSwing(k);
  const dim = 0.42 * (1 - k * 0.5);
  ring(frame, { radius: R, width: 2, erosion: k * 0.85, bright: dim, seed: 1531 });
  if (k >= 0.7) return;
  // 鱗の刻み: 輪の内側に並ぶ短い弧（14 枚。ゆっくり回る）
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * TAU + f * 0.04;
    arcLine(frame, { radius: R - 7, from: a, to: a + 0.22, width: 1.4, bright: dim * 0.9 * (1 - k) });
  }
}

/** 掴んだ敵（原点 = 敵、−x = 自分の側）: 鞭が敵に巻き付いて締まり、雷が巻きを走る */
const BIND_N = 8;
function serpentTarget(frame, f) {
  const k = f < 3 ? 0 : (f - 2) / (BIND_N - 2);
  const p = Math.min(1, (f + 1) / 3);
  const R0 = 14 - 5 * k;
  const turns = 1.7 * easeSwing(p);
  const erosion = k > 0.2 ? 0.05 + 0.9 * Math.pow((k - 0.2) / 0.8, 1.1) : 0;
  // 自分の側から来た鞭が上から巻きに入る（1 本の線として続けて描く）
  const body = linePts(-40, 0, (s) => -R0 * Math.pow(s, 2.2) + 4 * Math.sin(Math.PI * s) * (1 - k), 20);
  const coil = spiralPts(0, 0, R0, R0 * 0.55, -Math.PI / 2, turns, Math.ceil(28 * turns) + 2);
  tube(frame, body.concat(coil.slice(1)), { w0: 1.3, w1: 0.9, bright: 1 - 0.3 * k, erosion, glow: f === 2 ? 0.4 : 0.1, glowLen: 0.1, seed: 1541, lum: () => 0.7 });
  if (f === 2) sparkle(frame, 0, 0, 3);
  // 締める雷: 巻きの外へ短く跳ねる（フレームごとに角を変える）
  if (f >= 2 && f <= 5) {
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * TAU + f * 1.1;
      const r0 = R0 + 2;
      bolt(frame, Math.cos(a) * r0, Math.sin(a) * r0, Math.cos(a) * (r0 + 10), Math.sin(a) * (r0 + 10), { seed: 1542 + f * 3 + i, jag: 2.5, seg: 4, w: 0.9, bright: 1 - k * 0.5 });
    }
  }
  shards(frame, f - 2, 8, 1543, (i, rnd) => {
    const a = rnd(1) * TAU;
    return { x: Math.cos(a) * R0, y: Math.sin(a) * R0, vx: Math.cos(a) * (1.5 + rnd(2) * 2), vy: Math.sin(a) * (1.5 + rnd(2) * 2), life: 3 + Math.floor(rnd(3) * 2), size: rnd(4) > 0.5 ? 2 : 1 };
  });
}

/** 締め打ち（nova 34）の半径と、輪のうねりの山の数 */
const SNAP_R = 68;
const SNAP_LOBES = 6;
const SNAP_N = 9;
const SNAP_A = 3;

/** 閉じた鞭の輪（1 本の線が一周する）。cover（0..1）で巻いた長さ、phase でうねりを回す */
function loopRing(R, amp, cover, phase, a0) {
  const pts = [];
  const n = Math.ceil(96 * cover) + 2;
  for (let i = 0; i <= n; i++) {
    const a = a0 + TAU * cover * (i / n);
    const r = R + amp * Math.sin(SNAP_LOBES * a + phase);
    pts.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
  }
  return pts;
}

/** 行為 1: 巻き付けた鞭が 1 本の輪になって外へ弾け、うねりの山（6 つ）で鳴って雷が外へ跳ぶ */
function serpentSnap(frame, f) {
  const A = SNAP_A;
  const k = f < A ? 0 : (f - A + 1) / (SNAP_N - A + 1);
  const p = Math.min(1, (f + 1) / A);
  const R = f < A ? 22 + (SNAP_R - 22) * easeSwing(p) : SNAP_R + k * 8;
  const cover = f < A ? 0.55 + 0.45 * p : 1;
  const a0 = -Math.PI / 2 + (f < A ? (1 - p) * 1.2 : 0);
  const amp = 6 * (1 - 0.5 * k);
  const erosion = k > 0 ? 0.08 + 0.85 * Math.pow(k, 1.1) : 0;
  tube(frame, loopRing(R, amp, cover, 0, a0), { w0: 1.7, w1: 1.2, bright: 1 - 0.3 * k, erosion, glow: 0, seed: 1551, lum: (u) => 0.64 + 0.1 * Math.sin(Math.PI * u) });
  // 山ごとの破裂（輪が張り切った f = A - 1 に弾ける）と外への雷
  for (let i = 0; i < SNAP_LOBES; i++) {
    const a = (Math.PI / 2 + i * TAU) / SNAP_LOBES;
    const rr = SNAP_R + 6;
    const x = Math.cos(a) * rr;
    const y = Math.sin(a) * rr;
    const age = f - (A - 1);
    burst(frame, x, y, age, { size: 3, lines: 6, len: 9, seed: 1552 + i, shards: 3, spray: a, spread: 1.8, life: 3, ring: 0 });
    if (age >= 0 && age <= 2) {
      const r1 = rr + 14 + age * 6;
      bolt(frame, Math.cos(a) * (rr + 4 + age * 4), Math.sin(a) * (rr + 4 + age * 4), Math.cos(a + 0.12) * r1, Math.sin(a + 0.12) * r1, { seed: 1560 + i * 5 + age, jag: 3, seg: 5, w: 1, bright: 1 - age * 0.25, forks: age === 0 ? 1 : 0 });
    }
  }
}

// -----------------------------------------------------------------------------
// 百鳴り（nova 64・6 回当たる）: 大きな 1 本の鞭が自分の周りを 2 周半回り、先端が 6 度鳴る。最後に全周の鳴りの輪
// -----------------------------------------------------------------------------

const CRACKS_R = 128;
const CRACKS_N = 13;
const CRACKS_A = 8;
/** 先端が鳴るフレーム（6 回の当たり） */
const CRACKS_AT = [2, 3, 4, 5, 6, 7];
const CRACKS_TURNS = 2.5;

/**
 * 回る鞭の折れ線（whip.mjs の circlePts を大きく）。手元の角 head から外へ出て、半径 R の円を後ろへ span だけ引きずる
 */
function circlePts(head, R, span, amp, lobes, phase) {
  const pts = [];
  const n = Math.max(24, Math.ceil(LINE_POINTS * (0.6 + span / TAU)));
  const lead = 0.6;
  for (let i = 0; i <= n; i++) {
    const s = i / n;
    const out = Math.min(1, s / 0.18);
    const back = s < 0.1 ? 0 : (s - 0.1) / 0.9;
    const a = head - span * back + lead * (1 - out) * (1 - out);
    const r = HAND + (R - HAND) * Math.sin((out * Math.PI) / 2) + amp * Math.sin(lobes * a - phase) * back;
    pts.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
  }
  return pts;
}

/** 百鳴りのフレーム f の鞭の形。一定の速さで回す（鳴りの間隔をそろえる） */
function cracksState(f) {
  const A = CRACKS_A;
  const k = f < A ? 0 : (f - A + 1) / (CRACKS_N - A + 1);
  const p = f < A ? (f + 1) / A : 1;
  const head = -Math.PI / 2 + CRACKS_TURNS * TAU * (f < A ? p : 1 + 0.06 * k);
  const span = f < A ? (160 + 120 * Math.min(1, p * 2)) * (Math.PI / 180) : 280 * (Math.PI / 180) * (1 - 0.4 * k);
  const pts = circlePts(head, CRACKS_R - 6 + k * 6, span, 6 * (1 - 0.4 * k), 7, TAU * p * 1.6);
  return { k, pts };
}

function hundredCracks(frame, f) {
  const { k, pts } = cracksState(f);
  const erosion = k > 0 ? 0.08 + 0.85 * Math.pow(k, 1.1) : 0;
  const cracking = CRACKS_AT.includes(f);
  tube(frame, pts, { w0: 1.9, w1: 0.9, erosion, bright: 1 - 0.3 * k, glow: cracking ? 0.5 : 0.1, glowLen: 0.06, seed: 1601, lum: (u) => 0.5 + 0.3 * Math.sin(Math.PI * Math.min(1, u * 1.3)) });
  // 6 度の鳴り: 鳴ったフレームの先端の位置に置き、その場で広がる（回り続ける鞭からは離れていく）
  CRACKS_AT.forEach((ff, j) => {
    const age = f - ff;
    if (age < 0 || age > 5) return;
    const t = cracksState(ff).pts.at(-1);
    const at = Math.atan2(t.y, t.x);
    burst(frame, t.x, t.y, age, { size: j === CRACKS_AT.length - 1 ? 4 : 3, lines: 8, len: 12, seed: 1610 + j * 5, shards: 5, spray: at, spread: 2.2, life: 3, ring: 0 });
    if (age <= 3) crackArcs(frame, t.x, t.y, at, age, 1.1);
    // 雷の跳ね: 鳴った瞬間だけ、外へ 1 本（枝つき）
    if (age <= 1) {
      const a = at + (hash1(j, 1620) - 0.5) * 0.6;
      const r0 = Math.hypot(t.x, t.y) + 4;
      bolt(frame, Math.cos(at) * r0, Math.sin(at) * r0, Math.cos(a) * (r0 + 22), Math.sin(a) * (r0 + 22), { seed: 1621 + j * 3 + age, jag: 3.5, seg: 5, w: 1, forks: 1, bright: 1 - age * 0.3 });
    }
  });
  // 最後の鳴りのあと、全周へ鳴りの輪が広がる（百鳴りの締め）
  if (f >= CRACKS_A) {
    const age = f - CRACKS_A;
    // 鞭の輪と重ねない（二重線に見える）よう、鞭より 18 ドット以上外に置く
    ring(frame, { radius: CRACKS_R + 18 + age * 6, width: 2.2 - age * 0.3, erosion: Math.min(0.92, 0.25 + age * 0.17), bright: 0.7 - age * 0.1, seed: 1630 });
    if (age <= 2) {
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * TAU + 0.13;
        arcLine(frame, { radius: CRACKS_R + 28 + age * 7, from: a, to: a + 0.25, width: 1.2, bright: 0.5 * (1 - age * 0.3) });
      }
    }
  }
}

/** 百鳴りの地面の紋: 当たりの円の縁と、鳴った所の焦げ（短い放射の 3 本）が残って薄れる */
function hundredCracksGround(frame, f) {
  const grow = Math.min(1, (f + 1) / 3);
  const k = f < CRACKS_A ? 0 : (f - CRACKS_A + 1) / (CRACKS_N - CRACKS_A + 1);
  const dim = 0.4 * (1 - k * 0.4);
  ring(frame, { radius: (CRACKS_R - 2) * (0.75 + 0.25 * grow), width: 2, erosion: k * 0.9, bright: dim, seed: 1641 });
  CRACKS_AT.forEach((ff, j) => {
    const age = f - ff;
    if (age < 0) return;
    const fade = 1 - Math.max(0, (f - CRACKS_A) / (CRACKS_N - CRACKS_A));
    if (fade <= 0.1) return;
    const t = cracksState(ff).pts.at(-1);
    const at = Math.atan2(t.y, t.x);
    const r = Math.hypot(t.x, t.y);
    for (let i = -1; i <= 1; i++) {
      const a = at + i * 0.07;
      const l = i === 0 ? 14 : 8;
      streakLine(frame, { ax: Math.cos(a) * (r - l), ay: Math.sin(a) * (r - l), bx: Math.cos(a) * (r + l * 0.4), by: Math.sin(a) * (r + l * 0.4), width: 1.3, bright: 0.42 * fade });
    }
  });
}

/** 百鳴りの発動: 頭上で鞭を投げ縄のように 1 周回し、先端が鳴って全方位へ小さな鳴りの輪 */
function hundredCracksCast(frame, f) {
  const N = 8;
  const spin = 5;
  const cy = -40;
  const rx = 26;
  const ry = 10;
  const k = f < spin ? 0 : (f - spin + 1) / (N - spin);
  const p = Math.min(1, (f + 1) / spin);
  const head = -Math.PI / 2 + TAU * 1.1 * p;
  const span = 4.4 * (0.75 + 0.25 * p) * (1 - 0.5 * k);
  // 手元（胸の前）から頭上の楕円へ上がり、楕円を後ろへ span だけ引きずる 1 本の線
  const pts = [];
  const rise = 12;
  for (let i = 0; i <= rise; i++) {
    const s = i / rise;
    const ex = Math.cos(head) * rx;
    const ey = cy + Math.sin(head) * ry;
    pts.push({ x: 4 + (ex - 4) * s, y: -6 + (ey + 6) * Math.pow(s, 0.8) });
  }
  const n = 48;
  for (let i = 1; i <= n; i++) {
    const a = head - span * (i / n);
    pts.push({ x: Math.cos(a) * rx, y: cy + Math.sin(a) * ry });
  }
  tube(frame, pts, { w0: 1.4, w1: 0.8, erosion: k > 0 ? 0.1 + 0.8 * k : 0, bright: 1 - 0.3 * k, glow: f === spin - 1 ? 0.5 : 0.1, glowLen: 0.1, seed: 1651 });
  // 先端の鳴り（尾の端）
  const tip = pts[pts.length - 1];
  const age = f - (spin - 1);
  if (age >= 0) {
    const tx = Math.cos(head - 4.4) * rx;
    const ty = cy + Math.sin(head - 4.4) * ry;
    burst(frame, age === 0 ? tip.x : tx, age === 0 ? tip.y : ty, age, { size: 4, lines: 10, len: 12, seed: 1652, shards: 8, life: 3, ring: 0 });
    // 鳴りの弧は左右と上へ（輪にすると投げ縄と重なって見分けにくい）
    if (age <= 3) for (const d of [-Math.PI / 2, 0, Math.PI]) crackArcs(frame, tx, ty, d, age, 1);
  }
}

// -----------------------------------------------------------------------------
// 雷鞭（持続: 当てた敵を感電・纏い半径 36 が 0.5 秒ごとに周りを打つ）
// 発動: 空から雷が自分へ落ち、足元の輪と地を這う雷が広がる。纏い: 体の周りを短い雷が這い回る。
// 纏いの 1 打: 自分から 6 本の雷が外へ走り、半径の縁で弾ける
// -----------------------------------------------------------------------------

/** 纏いの 1 打の半径（36 論理 px × 2） */
const AURA_R = 72;

/** 雷鞭の発動 */
function thunderCast(frame, f) {
  const N = 10;
  const k = f / (N - 1);
  // 落雷: f 0〜2。太い幹 + 枝。f 0 は途中まで、f 1 で足元に届く
  if (f <= 2) {
    const reach = f === 0 ? 0.55 : 1;
    const top = -118;
    const by = top + (FEET_Y - 2 - top) * reach;
    bolt(frame, 6, top, 0, by, { seed: 1701, jag: 9, seg: 10, w: f === 1 ? 1.8 : 1.4, forks: 3, bright: f === 2 ? 0.7 : 1, erosion: f === 2 ? 0.35 : 0 });
    if (f === 1) sparkle(frame, 0, FEET_Y - 4, 4);
  }
  // 足元の輪（地面に置いた楕円）
  if (f >= 1) {
    const age = f - 1;
    ring(frame, { oy: FEET_Y, radius: 6 + age * 5, width: 2.4 - k * 1.1, squash: 2.2, erosion: Math.min(0.92, age * 0.12), bright: 0.85 - k * 0.3, seed: 1702 });
  }
  // 地を這う雷: 足元から 6 方向へ、平たい楕円に沿って伸び、千切れる
  if (f >= 1 && f <= 6) {
    const age = f - 1;
    const g = Math.min(1, (age + 1) / 2);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + 0.35;
      const r = (34 + 14 * hash1(i, 1703)) * g;
      const ex = Math.cos(a) * r * 1.6;
      const ey = FEET_Y + Math.sin(a) * r * 0.55;
      bolt(frame, Math.cos(a) * 8, FEET_Y + Math.sin(a) * 3, ex, ey, { seed: 1704 + i * 11 + age, jag: 3, seg: 6, w: 1, bright: 1 - age * 0.14, erosion: age >= 3 ? (age - 2) * 0.25 : 0 });
    }
  }
  // 火花: 足元から上と外へ
  shards(frame, f - 1, 16, 1710, (i, rnd) => {
    const a = -Math.PI / 2 + (rnd(1) - 0.5) * 2.6;
    const sp = 3 + rnd(2) * 4;
    return { x: (rnd(3) - 0.5) * 10, y: FEET_Y - 4, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(4) * 3), size: rnd(5) > 0.5 ? 2 : 1, drag: 0.82 };
  });
}

/** 纏いの 1 巡のフレーム数 */
const THUNDER_LOOP = 12;

/**
 * 雷鞭の纏い（持続中ずっと）: 体の外周（顔を覆わない半径）を短い雷が 3 本、回りながら這う。
 * 角は 1 巡で一周するので継ぎ目が出ない。節の振れはフレームごとに変わる（ちらつき）
 */
function thunderSustain(frame, f) {
  const cycle = f / THUNDER_LOOP;
  for (let i = 0; i < 3; i++) {
    const a = cycle * TAU + (i / 3) * TAU;
    // 2 フレームに 1 回だけ出る本もある（常に 3 本だと輪に見える）
    if (i === 2 && f % 2 === 1) continue;
    const r0 = 26 + 2 * hash1(f * 3 + i, 1801);
    const r1 = 31 + 3 * hash1(f * 3 + i, 1802);
    const span = 0.7 + 0.3 * hash1(f * 3 + i, 1803);
    bolt(frame, Math.cos(a) * r0, Math.sin(a) * r0, Math.cos(a + span) * r1, Math.sin(a + span) * r1, { seed: 1810 + f * 7 + i, jag: 3, seg: 4, w: 0.95, bright: 0.9 });
  }
  // ちらつく光点（1 巡に 3 回）
  if (f % 4 === 1) {
    const a = cycle * TAU + 1.3;
    sparkle(frame, Math.cos(a) * 30, Math.sin(a) * 30, 2);
  }
  // 静電気の粒: 外周を回って昇る
  for (let i = 0; i < 8; i++) {
    const t = (cycle + hash1(i, 1820)) % 1;
    const a = hash1(i, 1821) * TAU + t * 2;
    const x = Math.cos(a) * (28 + 6 * hash1(i, 1822));
    const y = Math.sin(a) * 24 - t * 14;
    const level = Math.max(2, Math.round(2 + 3 * Math.sin(Math.PI * t)));
    dot(frame, x, y, level);
  }
}

/** 纏いの足元（地面）: 帯電した楕円の輪と、輪の上を回る 6 つの閃き（6 回対称で 1 巡の継ぎ目が出ない） */
function thunderSustainGround(frame, f) {
  const cycle = f / THUNDER_LOOP;
  const pulse = 0.5 + 0.5 * Math.cos(cycle * TAU * 2);
  ring(frame, { oy: FEET_Y, radius: 14 + pulse, width: 1.8, squash: 2.3, bright: 0.34 + 0.14 * pulse, seed: 1830 });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6 + cycle / 6) * TAU;
    const x = Math.cos(a) * 14 * 2.3;
    const y = FEET_Y + Math.sin(a) * 14;
    streakLine(frame, { ax: x - 3, ay: y, bx: x + 3, by: y, width: 1.3, bright: 0.3 + 0.2 * pulse });
  }
}

/** 纏いの 1 打（原点 = 自分）: 6 本の雷が外へ走り、縁で弾けて輪が欠けて消える */
function thunderAura(frame, f) {
  const N = 7;
  const k = f / (N - 1);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + 0.5 + (hash1(i, 1901) - 0.5) * 0.5;
    const end = AURA_R + 4 * hash1(i, 1902);
    if (f <= 2) {
      const g = f === 0 ? 0.6 : 1;
      const r1 = 16 + (end - 16) * g;
      bolt(frame, Math.cos(a) * 16, Math.sin(a) * 16, Math.cos(a) * r1, Math.sin(a) * r1, { seed: 1903 + i * 3, jag: 5, seg: 7, w: f === 1 ? 1.3 : 1.05, forks: f === 1 ? 2 : 1, bright: f === 2 ? 0.7 : 1, erosion: f === 2 ? 0.4 : 0 });
    }
    if (f === 1) sparkle(frame, Math.cos(a) * end, Math.sin(a) * end, i % 2 === 0 ? 3 : 2);
    shards(frame, f - 1, 3, 1910 + i, (j, rnd) => {
      const b = a + (rnd(1) - 0.5) * 1.4;
      const sp = 2 + rnd(2) * 3;
      return { x: Math.cos(a) * end, y: Math.sin(a) * end, vx: Math.cos(b) * sp, vy: Math.sin(b) * sp, life: 3 + Math.floor(rnd(3) * 2), size: rnd(4) > 0.5 ? 2 : 1 };
    });
  }
  if (f >= 1) {
    const age = f - 1;
    ring(frame, { radius: AURA_R + age * 3, width: 2 - age * 0.25, erosion: Math.min(0.92, 0.2 + age * 0.17), bright: 0.7 - k * 0.3, seed: 1920 });
  }
}

// -----------------------------------------------------------------------------
// 表
// -----------------------------------------------------------------------------

/**
 * 奥義 → 絵（render/fxMotions.ts の buildUltimateFx が読む）。3 本とも属性 lightning なので実行時は雷の配色で出る（ramp は属性の無いときの控え）。
 * 蛇縛りの行為 0 の base は引き寄せの半径、行為 1 は周囲攻撃の半径。纏いの base は纏いの半径
 */
const FX = {
  moveset: "whip",
  ultimates: {
    "whip.serpentBind": {
      ramp: "lightning",
      cast: { sheet: "whipUlt.serpentCast", life: 0.35 },
      acts: [
        { sheet: "whipUlt.serpentPull", life: 0.6, base: PULL_R / 2, pivot: "pos", ground: "whipUlt.serpentPullGround" },
        { sheet: "whipUlt.serpentSnap", life: 0.45, base: SNAP_R / 2, pivot: "pos" },
      ],
      target: { sheet: "whipUlt.serpentBind", life: 0.45, pivot: "to" },
    },
    "whip.hundredCracks": {
      ramp: "lightning",
      cast: { sheet: "whipUlt.hundredCracksCast", life: 0.35 },
      acts: [{ sheet: "whipUlt.hundredCracks", life: 0.75, base: CRACKS_R / 2, pivot: "pos", ground: "whipUlt.hundredCracksGround" }],
    },
    "whip.thunderWhip": {
      ramp: "lightning",
      cast: { sheet: "whipUlt.thunderCast", life: 0.55 },
      aura: { sheet: "whipUlt.thunderAura", life: 0.3, base: AURA_R / 2 },
      sustain: { sheet: "whipUlt.thunder", period: 0.6, ground: "whipUlt.thunderGround" },
    },
  },
};

export const ATLAS = {
  key: "whipUlt",
  fx: FX,
  sheets: [
    { key: "whipUlt.serpentCast", dirs: 1, frames: 8, active: 0, size: 160, draw: serpentCast },
    { key: "whipUlt.serpentPull", dirs: 1, frames: PULL_N, active: PULL_A, size: 2 * (PULL_R + 24), draw: serpentPull },
    { key: "whipUlt.serpentPullGround", dirs: 1, frames: PULL_N, active: PULL_A, size: 2 * (PULL_R + 6), draw: serpentPullGround },
    { key: "whipUlt.serpentBind", dirs: DIRS, frames: BIND_N, active: 0, size: 120, draw: serpentTarget },
    { key: "whipUlt.serpentSnap", dirs: 1, frames: SNAP_N, active: SNAP_A, size: 2 * (SNAP_R + 50), draw: serpentSnap },
    { key: "whipUlt.hundredCracksCast", dirs: 1, frames: 8, active: 0, size: 140, draw: hundredCracksCast },
    { key: "whipUlt.hundredCracks", dirs: 1, frames: CRACKS_N, active: CRACKS_A, size: 2 * (CRACKS_R + 54), draw: hundredCracks },
    { key: "whipUlt.hundredCracksGround", dirs: 1, frames: CRACKS_N, active: CRACKS_A, size: 2 * (CRACKS_R + 20), draw: hundredCracksGround },
    { key: "whipUlt.thunderCast", dirs: 1, frames: 10, active: 0, size: 260, draw: thunderCast },
    { key: "whipUlt.thunder", dirs: 1, frames: THUNDER_LOOP, active: 0, size: 96, draw: thunderSustain },
    { key: "whipUlt.thunderGround", dirs: 1, frames: THUNDER_LOOP, active: 0, size: 96, draw: thunderSustainGround },
    { key: "whipUlt.thunderAura", dirs: 1, frames: 7, active: 0, size: 2 * (AURA_R + 22), draw: thunderAura },
  ],
};
