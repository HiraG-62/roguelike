// 斧（moveset "axe"）の奥義 3 本のエフェクト。docs/ideas/fx-sprites.md 9 章。手本は swordUlt.mjs、形の言葉は axe.mjs
// 単位は絵のドット（論理 0.5px）。数値は src/data/ultimates.ts の斧の奥義（scratchpad の ults/axe.md）× 2 が目安
//
// 斧の言葉（axe.mjs と同じ）: 重さが先端に集まる楔形の弧・木片（回る短い棒）・地面の割れ目（ジグザグの亀裂）・V 字の切り込み。
// 奥義はそれを大きく豪華にし、斧の奥義に共通の「出血」を血の滴（丸い頭に尾を引く涙形）で見せる。
// 剣で固まった決まりは守る: 1 回の振りは 1 本・白（段 7）は刃の縁と光点だけ・反りは前へ・終わりは崩れて消える
import { arcBounds, arcLine, easeSwing, lens, ring, sparkle, streakLine } from "../shapes.mjs";
import { clamp01, dot, hash1, paint, valueNoise } from "../raster.mjs";
import { DEG, DIRS } from "../motifs.mjs";

const TAU = Math.PI * 2;

// -----------------------------------------------------------------------------
// 斧の部品（axe.mjs から写して奥義向けに手を入れたもの。編集禁止のため import せず写す）
// -----------------------------------------------------------------------------

/** 崩れの判定（ノイズ + 芯の近さ）。芯に近いほど最後まで残る */
function survives(x, y, erosion, nearCore, seed) {
  if (erosion <= 0) return true;
  const n = valueNoise(x, y, 5, seed) * 0.6 + valueNoise(x, y, 1.8, seed + 7) * 0.2;
  return n + nearCore * 0.45 - erosion * 1.15 > 0;
}

/** 楔形の太さ（u = 0 が斧頭、1 が尾）。先端は丸く太く、plateau の間は太いまま、その先で急に細る */
function wedgeWidth(u, cap, power, plateau = 0) {
  if (u < 0 || u > 1) return 0;
  if (u < cap) return Math.sqrt(Math.max(0, 1 - ((cap - u) / cap) ** 2));
  const hold = cap + plateau;
  if (u < hold) return 1 - 0.12 * ((u - cap) / Math.max(1e-3, plateau));
  return 0.88 * Math.pow(1 - (u - hold) / (1 - hold), power);
}

/**
 * 楔形の弧（斧頭の通り道）。中心 (ox, 0)、外縁の半径 R、斧頭の太さ T。head > tail（時計回り）、1 周近くまで引ける。
 * 外縁の斧頭寄りだけが白い刃の縁、斧頭の塊が一番明るく、尾は暗い帯に溶ける
 */
function wedgeArc(frame, o) {
  const { R, T, head, tail } = o;
  const ox = o.ox ?? 0;
  const span = Math.max(1e-3, head - tail);
  const bright = o.bright ?? 1;
  const erosion = o.erosion ?? 0;
  const seed = o.seed ?? 1;
  const cap = o.cap ?? 0.07;
  const power = o.power ?? 2.2;
  const edgeReach = o.edgeReach ?? 0.3;
  const plateau = o.plateau ?? 0.12;
  const bounds = span > Math.PI * 0.9 ? { x0: ox - R - 2, y0: -R - 2, x1: ox + R + 2, y1: R + 2 } : arcBounds(ox, 0, Math.max(0, R - T - 1), R + 1, tail - 0.05, head + 0.05);
  paint(
    frame,
    (x, y) => {
      const dx = x - ox;
      const r = Math.hypot(dx, y);
      if (r > R) return -1;
      let s = (head - Math.atan2(y, dx)) % TAU;
      if (s < 0) s += TAU;
      const u = s / span;
      if (u > 1) return -1;
      const w = T * wedgeWidth(u, cap, power, plateau);
      if (w < 0.7) return -1;
      const q = (R - r) / w;
      if (q > 1) return -1;
      if (!survives(x, y, erosion, (1 - q) * (1 - u), seed)) return -1;
      if (R - r < 1.7 && u < edgeReach && erosion < 0.5) return clamp01(bright * (1.06 - 0.5 * u));
      const heavy = Math.pow(1 - u, 1.6);
      const inner = q > 0.85 ? 0.55 : 1;
      const grain = 0.9 + 0.2 * hash1(Math.floor((R - r) / 2), seed);
      return clamp01((0.28 + 0.66 * heavy) * (1 - q * 0.45) * inner * grain * bright * (1 - erosion * 0.4));
    },
    { bounds },
  );
}

/** 木片: 2〜3 ドットの棒が回りながら飛ぶ。spawn(i, rnd) → {x, y, vx, vy, life, len, angle, spin, drag?} */
function chips(frame, age, count, seed, spawn) {
  for (let i = 0; i < count; i++) {
    const s = spawn(i, (k) => hash1(i * 17 + k, seed));
    if (!s || age < 0 || age > s.life) continue;
    const drag = s.drag ?? 0.82;
    const travel = (1 - Math.pow(drag, age)) / (1 - drag);
    const x = s.x + s.vx * travel;
    const y = s.y + s.vy * travel;
    const fade = 1 - age / (s.life + 1);
    const top = Math.max(2, Math.round(3 + 3.6 * fade));
    const a = (s.angle ?? 0) + (s.spin ?? 0.9) * age;
    const len = age >= s.life - 1 ? Math.max(1, (s.len ?? 3) - 1) : (s.len ?? 3);
    for (let j = 0; j < len; j++) {
      const t = j - (len - 1) / 2;
      dot(frame, x + Math.cos(a) * t, y + Math.sin(a) * t, Math.max(2, top - (j === 0 ? 0 : 1)));
    }
  }
}

/** 地面の割れ目: (x, y) から角 angle へ伸びるジグザグの亀裂。根元が太く先へ細る。grow で伸び、erosion で崩れる */
function crack(frame, o) {
  const { x, y, angle, len } = o;
  const w0 = o.width ?? 3;
  const grow = o.grow ?? 1;
  const seed = o.seed ?? 9;
  const bright = o.bright ?? 0.7;
  const erosion = o.erosion ?? 0;
  const n = o.segments ?? 5;
  const jag = o.jag ?? 0.35;
  // squash: 縦を潰す（dirs 1 の地面の亀裂を「寝かせた」楕円の地面に置くため）
  const squash = o.squash ?? 1;
  if (grow <= 0) return;
  const pts = [{ x, y }];
  for (let i = 1; i <= n; i++) {
    const a = angle + (hash1(i, seed) - 0.5) * 2 * jag * (i % 2 === 0 ? -1 : 1) + (hash1(i, seed + 1) - 0.5) * jag;
    const step = (len / n) * (0.8 + 0.4 * hash1(i, seed + 2));
    const p = pts[i - 1];
    pts.push({ x: p.x + Math.cos(a) * step, y: p.y + Math.sin(a) * step * squash });
  }
  const total = n * grow;
  const minX = Math.min(...pts.map((p) => p.x)) - w0 - 2;
  const maxX = Math.max(...pts.map((p) => p.x)) + w0 + 2;
  const minY = Math.min(...pts.map((p) => p.y)) - w0 - 2;
  const maxY = Math.max(...pts.map((p) => p.y)) + w0 + 2;
  paint(
    frame,
    (px, py) => {
      let best = -1;
      for (let i = 0; i < n; i++) {
        if (i >= total) break;
        const p = pts[i];
        const q = pts[i + 1];
        const dx = q.x - p.x;
        const dy = q.y - p.y;
        const l2 = dx * dx + dy * dy;
        let t = ((px - p.x) * dx + (py - p.y) * dy) / l2;
        t = Math.max(0, Math.min(Math.min(1, total - i), t));
        const gt = (i + t) / n;
        const w = (w0 * Math.pow(1 - gt, 0.8) + 0.6) / 2;
        const d = Math.hypot(p.x + dx * t - px, p.y + dy * t - py);
        if (d > w) continue;
        if (!survives(px, py, erosion, 1 - gt, seed + 3)) continue;
        const v = bright * (1 - 0.45 * gt) * (d < w * 0.4 && gt < 0.3 ? 1.25 : 1 - 0.3 * (d / w));
        if (v > best) best = v;
      }
      return best < 0 ? -1 : clamp01(best * (1 - erosion * 0.35));
    },
    { bounds: { x0: minX, y0: minY, x1: maxX, y1: maxY }, samples: 2, dither: 0 },
  );
}

/** V 字の切り込み（頂点が +x、口が −x に開く）。縁は明るく、頂点寄りの底は暗い（深さ） */
function vNotch(frame, o) {
  const { L, H } = o;
  const apex = o.apex ?? 0;
  const open = o.open ?? 1;
  const erosion = o.erosion ?? 0;
  const bright = o.bright ?? 1;
  const seed = o.seed ?? 11;
  const back = apex - L;
  paint(
    frame,
    (x, y) => {
      if (x > apex || x < back) return -1;
      const t = (apex - x) / L;
      const half = H * open * Math.pow(t, 0.85);
      const ay = Math.abs(y);
      const rim = 2.8 * (1 - t) + 0.6;
      if (ay > half + rim * 0.5) return -1;
      const d = half - ay;
      if (!survives(x, y, erosion, 1 - t * 0.6, seed)) return -1;
      if (d < rim * 0.5) {
        if (t > 0.92) return -1;
        return clamp01(bright * (0.55 + 0.5 * (1 - t)) * (1 - erosion * 0.3));
      }
      if (t > 0.55) return -1;
      return clamp01(bright * 0.14 * (1 - erosion * 0.5));
    },
    { bounds: { x0: back - 2, y0: -H - 3, x1: apex + 2, y1: H + 3 } },
  );
}

// -----------------------------------------------------------------------------
// 奥義の部品: 血の滴・鋸歯の輪・怒りの棘
// -----------------------------------------------------------------------------

/**
 * 血の滴 1 つ（涙形）。(x, y) が丸い頭、尾は (vx, vy) の逆へ細る。
 * 木片（棒）・刃片（点）と見分ける斧の奥義の出血の印。頭の芯が明るく、尾は暗い
 */
function drop(frame, o) {
  const { x, y, r } = o;
  const sp = Math.hypot(o.vx, o.vy);
  const bx = sp > 1e-3 ? -o.vx / sp : 0;
  const by = sp > 1e-3 ? -o.vy / sp : 0;
  const tail = sp > 1e-3 ? r * (o.tail ?? 2.4) : 0;
  const bright = o.bright ?? 0.8;
  const pad = r + tail + 2;
  paint(
    frame,
    (px, py) => {
      const dx = px - x;
      const dy = py - y;
      const dh = Math.hypot(dx, dy);
      if (dh <= r) return clamp01(bright * (1 - 0.35 * (dh / r)));
      if (tail <= 0) return -1;
      const along = dx * bx + dy * by;
      if (along < 0 || along > tail) return -1;
      const across = Math.abs(dx * -by + dy * bx);
      const w = r * (1 - along / tail);
      if (across > w) return -1;
      return clamp01(bright * (0.7 - 0.35 * (along / tail)));
    },
    { bounds: { x0: x - pad, y0: y - pad, x1: x + pad, y1: y + pad }, samples: 3, dither: 0 },
  );
}

/**
 * 飛び散る血の滴の群れ。spawn(i, rnd) → {x, y, vx, vy, life, r, g?, drag?}。g は画面の下向きの重さ（持ち上げて落とす滴）。
 * 小さく（r < 1.2）なった滴は 1 ドットの点にする（涙形が潰れて灰色の染みにならないよう）
 */
function drops(frame, age, count, seed, spawn) {
  for (let i = 0; i < count; i++) {
    const s = spawn(i, (k) => hash1(i * 23 + k, seed));
    if (!s || age < 0 || age > s.life) continue;
    const drag = s.drag ?? 0.84;
    const travel = (1 - Math.pow(drag, age)) / (1 - drag);
    const g = s.g ?? 0;
    const x = s.x + s.vx * travel;
    const y = s.y + s.vy * travel + 0.5 * g * age * age;
    // 今の速度（尾の向き）
    const vx = s.vx * Math.pow(drag, age);
    const vy = s.vy * Math.pow(drag, age) + g * age;
    const fade = 1 - age / (s.life + 1);
    const r = s.r * (0.55 + 0.45 * fade);
    if (r < 1.2) {
      dot(frame, x, y, Math.max(2, Math.round(2 + 3 * fade)));
      continue;
    }
    drop(frame, { x, y, vx, vy, r, bright: 0.45 + 0.4 * fade, tail: 1.6 + Math.min(2, Math.hypot(vx, vy) * 0.3) });
  }
}

/**
 * 鋸歯の輪: 外縁が鋸の歯（teeth 枚、時計回りに傾いた歯）になった太い輪。内縁は R - T。
 * 叩き割った裂け目の縁（肉を裂く刃）の印。歯の先だけ白く、根元は本体の段
 */
function sawRing(frame, o) {
  const { R, T, teeth } = o;
  const tooth = o.tooth ?? 8;
  const erosion = o.erosion ?? 0;
  const bright = o.bright ?? 1;
  const seed = o.seed ?? 21;
  const oy = o.oy ?? 0;
  const squash = o.squash ?? 1;
  const phase = o.phase ?? 0;
  const edge = o.edge ?? true;
  const pad = R + tooth + 2;
  paint(
    frame,
    (x, y) => {
      const dy = (y - oy) * squash;
      const r = Math.hypot(x, dy);
      const a = Math.atan2(dy, x) + phase;
      // 歯: 角の小数部で 0 → 1 に上がり、ストンと落ちる（時計回りに流れる鋸）
      let saw = ((a / TAU) * teeth) % 1;
      if (saw < 0) saw += 1;
      const outer = R + tooth * saw;
      const inner = R - T;
      if (r > outer || r < inner) return -1;
      const q = (outer - r) / (outer - inner);
      if (!survives(x, y, erosion, 1 - q, seed)) return -1;
      // 白は歯の切っ先（鋸が落ちる直前の外縁）の細い線だけ。面は歯の先ほど明るく、根元と内縁は暗い段へ
      if (edge && outer - r < 1.5 && saw > 0.8 && erosion < 0.45) return clamp01(bright * 1.05);
      return clamp01(bright * (0.3 + 0.45 * saw) * (1 - 0.55 * q) * (1 - erosion * 0.4));
    },
    { bounds: { x0: -pad, y0: oy - pad / squash, x1: pad, y1: oy + pad / squash } },
  );
}

/**
 * 怒りの棘: 根元 (bx, by) から画面の上へ尖る細い三角（狂気の気が角張って噴く）。
 * 片側の縁に 1 つ刻み（ギザ）を入れて炎の揺らめきと見分ける。明るさは段 6 まで（白は光点だけ）
 */
const SPIKE_CAP = 0.8;
function spike(frame, o) {
  const { x: bx, y: by, h, w } = o;
  const lean = o.lean ?? 0;
  const bright = o.bright ?? 1;
  const erosion = o.erosion ?? 0;
  const seed = o.seed ?? 31;
  if (h < 3 || w < 1.5 || bright <= 0) return;
  paint(
    frame,
    (x, y) => {
      const t = (by - y) / h;
      if (t < 0 || t > 1) return -1;
      // 中ほどで一度だけ横へ折れる（ギザ）: 上半分を lean の逆へずらし、段差を刻む
      const kink = t > 0.5 ? -Math.sign(lean || 1) * w * 0.22 : 0;
      const cx = bx + lean * t + kink;
      const half = (w / 2) * (1 - t) * (t > 0.44 && t < 0.56 ? 0.7 : 1);
      const d = x - cx;
      if (half < 0.5 || Math.abs(d) > half) return -1;
      const q = Math.abs(d) / half;
      if (!survives(x, y, erosion + t * 0.2, 1 - q, seed)) return -1;
      const side = d < 0 ? 0.12 : -0.05;
      return Math.min(SPIKE_CAP, clamp01(((1 - q) * (0.5 + 0.5 * (1 - t)) + side) * bright));
    },
    { bounds: { x0: bx - w - Math.abs(lean) - 2, y0: by - h - 2, x1: bx + w + Math.abs(lean) + 2, y1: by + 2 } },
  );
}

// -----------------------------------------------------------------------------
// 血祭り（nova 半径 50）: 巨大な斧頭の楔が自分の周りを 1 周し、閉じた瞬間に鋸歯の裂け目の輪になって弾け、
// 血の滴と木片が外へ飛ぶ。地面は中心から放射状に叩き割れる（別シート）
// -----------------------------------------------------------------------------

/** 当たりの半径（50 論理 px × 2） */
const FEAST_R = 100;
/** 斧頭の太さ（通常の回し斬り 26 より一段太い） */
const FEAST_T = 36;
const FEAST_N = 11;
const FEAST_A = 4;
/** 振り始めの角（真上） */
const FEAST_FROM = -Math.PI / 2;

function bloodFeast(frame, f) {
  const A = FEAST_A;
  const k = f < A ? 0 : (f - A + 1) / (FEAST_N - A + 1);
  if (f < A) {
    // 1) 斧頭が 1 周: 楔は振り始めから太く、尾は 1 周の 8 割まで伸びる
    const p = easeSwing((f + 1) / A);
    const head = FEAST_FROM + TAU * p;
    const trail = Math.min(TAU * 0.82, TAU * p);
    wedgeArc(frame, { R: FEAST_R, T: FEAST_T * (0.8 + 0.2 * p), head, tail: head - trail, bright: 0.88 + 0.12 * p, seed: 5101, cap: 0.05, plateau: 0.06, power: 2.6, edgeReach: 0.2 });
    // 速度線: 刃の外側、斧頭の後ろにだけ
    for (let i = 0; i < 2; i++) {
      const len = Math.min(trail * 0.4, 0.6 + 0.5 * hash1(i, 5102));
      const end = head - 0.08 - 0.2 * hash1(i, 5103);
      arcLine(frame, { radius: FEAST_R + 3 + i * 3.4, from: end - len, to: end, bright: 0.6 - i * 0.12 });
    }
    if (f >= 1) sparkle(frame, Math.cos(head) * (FEAST_R - 2), Math.sin(head) * (FEAST_R - 2), f === A - 1 ? 4 : 3);
    return;
  }
  // 2) 閉じた瞬間に斧の楔は鋸歯の裂け目の輪へ変わり（2 本目の弧は重ねない）、外へ押し広がって崩れる
  const R = FEAST_R - 8 + Math.round(k * 16);
  sawRing(frame, {
    R,
    T: (f === A ? 14 : 10) * (1 - 0.5 * k),
    teeth: 14,
    tooth: f === A ? 14 : 12 * (1 - 0.4 * k),
    erosion: f === A ? 0 : 0.08 + 0.82 * Math.pow(k, 1.15),
    bright: f === A ? 1.05 : 1 - 0.3 * k,
    phase: k * 0.35,
    seed: 5111,
  });
  if (f === A) {
    // 閉じた瞬間の 4 方の光点（叩き割りの手応え）
    for (let i = 0; i < 4; i++) {
      const a = FEAST_FROM + (i / 4) * TAU + Math.PI / 4;
      sparkle(frame, Math.cos(a) * (R + 4), Math.sin(a) * (R + 4), 4);
    }
  }
  // 衝撃の輪: 裂け目の外へ 1 枚だけ走る（細く暗い風圧）
  if (k < 0.75) ring(frame, { radius: R + 22 + k * 26, width: 2.2 - k * 1.2, erosion: Math.min(0.9, 0.2 + k * 0.8), bright: 0.55 * (1 - k * 0.5), seed: 5112 });
  const age = f - A;
  // 血の滴: 裂け目の全周から外へ（出血 3 重の印。数を多く、大きさをばらす）
  drops(frame, age, 30, 5113, (i, rnd) => {
    const a = rnd(1) * TAU;
    const r0 = FEAST_R + 4 - rnd(2) * 8;
    const sp = 8 + rnd(3) * 8;
    // 少しだけ時計回りへ流す（斧の回った向き）
    const tang = 0.25;
    return { x: Math.cos(a) * r0, y: Math.sin(a) * r0, vx: (Math.cos(a) - Math.sin(a) * tang) * sp, vy: (Math.sin(a) + Math.cos(a) * tang) * sp, life: 4 + Math.floor(rnd(4) * 3), r: 2 + rnd(5) * 1.6, drag: 0.8 };
  });
  // 木片: 接線へ投げ出される
  chips(frame, age, 18, 5114, (i, rnd) => {
    const a = rnd(1) * TAU;
    const sp = 4 + rnd(2) * 4;
    return { x: Math.cos(a) * (FEAST_R - 10), y: Math.sin(a) * (FEAST_R - 10), vx: (-Math.sin(a) * 0.6 + Math.cos(a) * 0.6) * sp, vy: (Math.cos(a) * 0.6 + Math.sin(a) * 0.6) * sp, life: 3 + Math.floor(rnd(3) * 3), len: rnd(4) > 0.4 ? 3 : 2, angle: rnd(5) * Math.PI, spin: 0.9 };
  });
}

/** 血祭りの地面: 叩き割った瞬間（斧頭が閉じる直前）に中心から 10 本の亀裂が放射に走り、外周に割れた縁の輪が残る */
function bloodFeastGround(frame, f) {
  const start = FEAST_A - 1;
  if (f < start) return;
  const age = f - start;
  const grow = Math.min(1, (age + 1) / 3);
  const k = Math.max(0, (age - 3) / (FEAST_N - start - 3));
  const erosion = Math.min(0.95, k * 0.95);
  for (let i = 0; i < 10; i++) {
    const a = FEAST_FROM + (i / 10) * TAU + (hash1(i, 5201) - 0.5) * 0.3;
    const long = i % 2 === 0;
    const r0 = 14 + hash1(i, 5202) * 6;
    crack(frame, { x: Math.cos(a) * r0, y: Math.sin(a) * r0, angle: a, len: (long ? 84 : 62) * (0.9 + 0.2 * hash1(i, 5203)), width: long ? 4.4 : 3.2, grow, erosion, bright: 0.56, seed: 5210 + i * 5, segments: long ? 7 : 5, jag: 0.3 });
    // 長い亀裂は途中で枝分かれ
    if (long && grow > 0.6) {
      const br = r0 + 46;
      const side = i % 4 === 0 ? 1 : -1;
      crack(frame, { x: Math.cos(a) * br, y: Math.sin(a) * br, angle: a + side * 0.7, len: 26, width: 2.2, grow: (grow - 0.6) / 0.4, erosion: Math.min(0.95, erosion + 0.1), bright: 0.48, seed: 5260 + i, segments: 3, jag: 0.4 });
    }
  }
  // 中心の陥没（叩きつけた所）と外周の縁
  ring(frame, { radius: 10 + age, width: 3, erosion: Math.min(0.95, 0.1 + k), bright: 0.6, seed: 5270 });
  ring(frame, { radius: FEAST_R - 4, width: 2, erosion: Math.min(0.95, 0.35 + k * 0.7), bright: 0.4 * grow, seed: 5271 });
}

/** 血祭りの発動: 血の滴が自分へ吸い寄せられ（涙形の頭が内向き）、鋸歯の輪が締まって、満ちた瞬間に小さく弾ける */
function bloodFeastCast(frame, f) {
  const N = 8;
  const gather = 4;
  if (f < gather) {
    const p = (f + 1) / gather;
    const R = 46 - 30 * p;
    sawRing(frame, { R, T: 4 + 2 * p, teeth: 10, tooth: 5, bright: 0.5 + 0.35 * p, phase: -p * 0.6, edge: p > 0.7, seed: 5301 });
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * TAU + hash1(i, 5302) * 0.3;
      const r = R + 10 + (1 - p) * (14 + 10 * hash1(i, 5303));
      drop(frame, { x: Math.cos(a) * r, y: Math.sin(a) * r, vx: -Math.cos(a), vy: -Math.sin(a), r: 1.8 + hash1(i, 5304) * 0.8, bright: 0.5 + 0.35 * p, tail: 2.6 });
    }
    if (f === gather - 1) sparkle(frame, 0, 0, 3);
    return;
  }
  const k = (f - gather + 1) / (N - gather);
  sawRing(frame, { R: 12 + k * 28, T: 6 * (1 - k * 0.5), teeth: 10, tooth: 6, erosion: Math.min(0.9, k * 0.85), bright: 0.95 - k * 0.3, phase: k * 0.4, seed: 5305 });
  if (f === gather) sparkle(frame, 0, 0, 4);
  drops(frame, f - gather, 10, 5306, (i, rnd) => {
    const a = rnd(1) * TAU;
    const sp = 3 + rnd(2) * 3;
    return { x: Math.cos(a) * 8, y: Math.sin(a) * 8, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3, r: 1.4 + rnd(3) };
  });
}

// -----------------------------------------------------------------------------
// 大投擲（volley: returnChakram を 3 本、扇 25° 刻み）: 背から頭上を越える大振りで投げ放ち、3 本の風の道が扇に走る。
// 飛んでいる斧そのものは描画側が武器の絵を回すので、弾の fly は斧の周りの風切りと尾だけ
// -----------------------------------------------------------------------------

/** 扇の刻み（spreadOffsets と同じ: 隣どうしの角の差）と本数 */
const THROW_SPREAD = 25 * DEG;
const THROW_COUNT = 3;

/** 大投擲の発動: 背（−x の上）から頭上を越えて前へ振りかぶる楔の弧 1 本。振り切りで手を離す光点 */
function greatThrowCast(frame, f) {
  const N = 7;
  const A = 4;
  const R = 46;
  const from = -170 * DEG;
  const sweep = 150 * DEG;
  const k = f < A ? 0 : (f - A + 1) / (N - A + 1);
  const p = f < A ? easeSwing((f + 1) / A) : 1 + 0.06 * k;
  const head = from + sweep * p;
  const tail = f < A ? from + sweep * Math.max(0, p - 0.75) : from + sweep * (0.25 + 0.7 * Math.pow(k, 0.75));
  wedgeArc(frame, { R, T: 24 * (f < A ? 0.85 + 0.15 * p : 1 - 0.45 * k), head, tail, erosion: k === 0 ? 0 : 0.05 + 0.85 * Math.pow(k, 1.2), bright: 1 - 0.3 * k, seed: 5401, cap: 0.1, plateau: 0.1, power: 2 });
  if (k < 0.7) arcLine(frame, { radius: R + 3 + k * 5, from: head - (head - tail) * 0.45, to: head - 0.08, bright: 0.55 * (1 - k) });
  if (f === A - 1) sparkle(frame, Math.cos(head) * (R - 2), Math.sin(head) * (R - 2), 4);
  // 踏み込みの足元: 後ろへ潰れた輪（投げの反動）
  ring(frame, { ox: -8 - f * 2, radius: 5 + f * 3.5, width: 2.2 - k, squash: 0.5, erosion: Math.min(0.9, 0.15 + f * 0.13), bright: 0.6 - f * 0.05, seed: 5402 });
}

/**
 * 大投擲の行為（放つ瞬間）: 3 本の風の道（扇の各向きへレンズ形の筋）が走り、手元で木片が弾ける。
 * 3 本は実際に 3 本の斧が飛ぶ向きなので、角をはっきり分けて並べる
 */
function greatThrowRelease(frame, f) {
  const N = 8;
  const A = 3;
  const k = f < A ? 0 : (f - A + 1) / (N - A + 1);
  const L = 110;
  for (let j = 0; j < THROW_COUNT; j++) {
    const a = (j - (THROW_COUNT - 1) / 2) * THROW_SPREAD;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const grow = f < A ? easeSwing((f + 1) / A) : 1;
    // 風の道は手元側から痩せて前へ流れる
    const x0 = 12 + (f < A ? 0 : L * 0.55 * Math.pow(k, 1.1));
    const x1 = 12 + L * grow + k * 16;
    const mid = j === 1;
    lens(frame, { ax: c * x0, ay: s * x0, bx: c * x1, by: s * x1, T: (mid ? 16 : 13) * (1 - 0.5 * k), bias: 0.2, grow: 1, erosion: f < A ? 0 : 0.1 + 0.85 * k, bright: (mid ? 0.95 : 0.85) * (1 - 0.25 * k), seed: 5501 + j });
    // 速度線: 各道の外側（扇の外向きの側）に 1 本だけ
    if (k < 0.7 && j !== 1) {
      const side = j === 0 ? -1 : 1;
      const off = 7 * side;
      streakLine(frame, { ax: c * (x0 + 10) - s * off, ay: s * (x0 + 10) + c * off, bx: c * (x1 - 12) - s * off, by: s * (x1 - 12) + c * off, bright: 0.45 * (1 - k) });
    }
    if (f === A - 1) sparkle(frame, c * (x1 - 3), s * (x1 - 3), mid ? 4 : 3);
  }
  // 手元の閃き: 放った瞬間の前向きに潰れた輪
  if (f <= 4) ring(frame, { ox: 14 + f * 3, radius: 6 + f * 5, width: 2.4 - f * 0.3, squash: 0.45, erosion: Math.min(0.9, f * 0.2), bright: 0.8 - f * 0.1, seed: 5510 });
  chips(frame, f - 1, 10, 5511, (i, rnd) => {
    const a = (rnd(1) - 0.5) * 2.4;
    const sp = 3 + rnd(2) * 3.5;
    return { x: 14, y: (rnd(3) - 0.5) * 8, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(4) * 2), len: rnd(5) > 0.4 ? 3 : 2, angle: rnd(6) * Math.PI, spin: 1.2 };
  });
}

/** 弾（回る斧）の風切りの半径。投げた斧の絵（論理 12〜14px 程度）のすぐ外を回る */
const SPIN_R = 17;
/** 風切りの 1 巡のフレーム数（描画側の回転 14 rad/秒に近い 1 周 ≈ 0.45 秒） */
const SPIN_N = 8;
/** 尾の長さ（弾速 ≈ 270px/秒 × 0.04 秒 ≈ 論理 11px） */
const SPIN_TAIL = 24;

/**
 * 飛んでいる斧の風切り: 斧の外を回る 1 本の楔形の風（斧頭の軌跡。時計回り）と、後ろ（−x）へ引く尾の筋。
 * 斧そのものは描かない（描画側が武器の絵を回す）ので中心は空ける
 */
function greatThrowFly(frame, f) {
  const head = FEAST_FROM + (f / SPIN_N) * TAU;
  wedgeArc(frame, { R: SPIN_R, T: 6, head, tail: head - TAU * 0.55, seed: 5601, cap: 0.08, plateau: 0.05, power: 2.4, edgeReach: 0.18, bright: 0.82 });
  // 尾: 回転の円の上下の縁から後ろへ 2 本（斧が通った幅）と、真ん中の短い 1 本
  for (let i = 0; i < 3; i++) {
    const y = (i - 1) * (SPIN_R - 5);
    const len = (i === 1 ? SPIN_TAIL * 0.6 : SPIN_TAIL) * (0.85 + 0.15 * Math.sin((f / SPIN_N) * TAU + i * 2));
    const x1 = i === 1 ? -SPIN_R - 1 : -6;
    streakLine(frame, { ax: x1 - len, ay: y, bx: x1, by: y, width: i === 1 ? 1 : 1.4, bright: i === 1 ? 0.35 : 0.5 });
  }
  // 1 巡に 1 回、刃が前を向いた所で光る
  if (f === 2) sparkle(frame, SPIN_R - 2, 0, 2);
}

/** 投げ放つ瞬間の手元（弾ごとの銃口）: 前へ小さく潰れた輪と、前へ開く短い 2 本の筋 */
function greatThrowMuzzle(frame, f) {
  const k = f / 4;
  ring(frame, { ox: 2 + f * 2, radius: 5 + f * 4, width: 2.2 - k, squash: 0.5, erosion: Math.min(0.9, k * 0.8), bright: 0.8 - k * 0.3, seed: 5701 });
  if (f <= 2) {
    for (const side of [-1, 1]) {
      const a = side * 0.45;
      streakLine(frame, { ax: 4 * Math.cos(a), ay: 4 * Math.sin(a), bx: (14 + f * 5) * Math.cos(a), by: (14 + f * 5) * Math.sin(a), width: 1.4, bright: 0.7 - f * 0.15 });
    }
  }
  if (f === 0) sparkle(frame, 3, 0, 2);
}

/** 手元に戻った・壁で止まった: 風切りの輪がほどけて散り、木片が少し跳ねる */
function greatThrowImpact(frame, f) {
  const N = 6;
  const k = (f + 1) / N;
  const head = FEAST_FROM + f * 0.9;
  wedgeArc(frame, { R: SPIN_R + f * 3, T: 6 * (1 - 0.5 * k), head, tail: head - TAU * 0.5 * (1 - 0.6 * k), erosion: 0.1 + 0.85 * k, bright: 0.95 - 0.3 * k, seed: 5801, cap: 0.08, plateau: 0.05, power: 2.4 });
  if (f === 0) sparkle(frame, 0, 0, 3);
  chips(frame, f, 7, 5802, (i, rnd) => {
    const a = rnd(1) * TAU;
    const sp = 2.5 + rnd(2) * 2.5;
    return { x: Math.cos(a) * 6, y: Math.sin(a) * 6, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(3) * 2), len: rnd(4) > 0.5 ? 3 : 2, angle: rnd(5) * Math.PI, spin: 1 };
  });
}

/** 通り抜けた敵への命中（行きと帰りで毎回）: 深い V 字の切り込み + 回転の刃が抜けた弧の閃き + 血の滴 */
function greatThrowHit(frame, f) {
  const N = 7;
  const k = f < 2 ? 0 : (f - 1) / (N - 1);
  vNotch(frame, { L: 26, H: 11, apex: 10, open: f === 0 ? 0.45 : 1 - k * 0.25, erosion: k * 0.9, bright: 1 - k * 0.2, seed: 5901 });
  if (f >= 1) crack(frame, { x: 10, y: 0, angle: 0, len: 14, width: 2.4, grow: Math.min(1, f / 2), erosion: k * 0.9, bright: 0.7, seed: 5902, segments: 3 });
  if (f <= 1) sparkle(frame, 10, 0, f === 0 ? 3 : 4);
  // 回る刃が抜けた跡: 切り込みの口の後ろに短い弧（1 本）
  if (f <= 3) arcLine(frame, { ox: -2, radius: 14, from: -0.9, to: 0.9, width: 1.4, bright: 0.6 * (1 - f * 0.22) });
  drops(frame, f - 1, 8, 5903, (i, rnd) => {
    const side = rnd(1) > 0.5 ? 1 : -1;
    const a = side * (0.4 + rnd(2) * 1.0);
    const sp = 3 + rnd(3) * 3;
    return { x: 4 - rnd(4) * 8, y: side * 3, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(5) * 2), r: 1.3 + rnd(6) * 1.2 };
  });
}

// -----------------------------------------------------------------------------
// 狂斧（持続）: 足元を踏み割って怒りの棘が噴き、持続中は心臓の鼓動で棘が脈打ち、血の滴が垂れ続ける。
// dirs 1（画面に揃える）: 噴く向き・垂れる向きは向きによらず画面の上下
// -----------------------------------------------------------------------------

/** 足元の中心の高さ（キャラは絵で 48 ドット） */
const FEET_Y = 18;
/** 地面の輪の縦の潰し（上から斜めに見た地面） */
const GROUND_SQUASH = 2.2;

/** 狂斧の発動: 足元を踏み割り（寝かせた亀裂 + 鋸歯の輪）、怒りの棘が一斉に噴いて、血の滴が上へ撥ねて落ちる */
function madAxeCast(frame, f) {
  const N = 10;
  const k = f / (N - 1);
  sawRing(frame, { oy: FEET_Y, R: 10 + f * 6, T: 5 * (1 - 0.5 * k), teeth: 12, tooth: 5, squash: GROUND_SQUASH, erosion: Math.min(0.92, k * 0.95), bright: 0.9 - k * 0.3, phase: k * 0.5, seed: 6001 });
  // 寝かせた亀裂: 左右へ（地面の上なので縦は潰す）
  const grow = Math.min(1, (f + 1) / 3);
  const er = f < 4 ? 0 : Math.min(0.95, (f - 4) * 0.18);
  for (let i = 0; i < 6; i++) {
    const right = i % 2 === 0;
    const a = (right ? 0 : Math.PI) + (Math.floor(i / 2) - 1) * 0.45;
    crack(frame, { x: right ? 6 : -6, y: FEET_Y, angle: a, len: 44 + 12 * hash1(i, 6002), width: 3.2, grow, erosion: er, bright: 0.66, seed: 6010 + i * 5, segments: 5, jag: 0.35, squash: 1 / GROUND_SQUASH });
  }
  // 怒りの棘: 9 本。外ほど低く外へ傾き、時間差で伸びて千切れる
  for (let i = 0; i < 9; i++) {
    const s = i - 4;
    const age = f - Math.abs(s) * 0.4;
    if (age < 0) continue;
    const rise = Math.min(1, (age + 1) / 2.5);
    const fade = Math.max(0, (age - 2.5) / 5);
    if (fade >= 1) continue;
    spike(frame, {
      x: s * 9 * (1 + fade * 0.3),
      y: FEET_Y + 4 - fade * 24,
      h: (84 - Math.abs(s) * 11) * rise,
      w: 12 - Math.abs(s),
      lean: s * 6,
      bright: 1.05 - fade * 0.4,
      erosion: fade * 0.85,
      seed: 6030 + i,
    });
  }
  if (f === 2) sparkle(frame, 0, FEET_Y - 82, 4);
  // 撥ねて落ちる血の滴（重さで弧を描く）
  drops(frame, f - 1, 14, 6040, (i, rnd) => {
    const x = (rnd(1) - 0.5) * 40;
    return { x, y: FEET_Y - 6, vx: x * 0.08 + (rnd(2) - 0.5) * 2, vy: -(5 + rnd(3) * 4), g: 1.3, drag: 0.92, life: 5 + Math.floor(rnd(4) * 3), r: 1.5 + rnd(5) * 1.2 };
  });
}

/** 纏いの 1 巡のフレーム数（鼓動 2 拍: どくん・どくん・間） */
const MAD_N = 12;
/** 鼓動の強さ（f → 0..1）。0 と 3 で拍、残りは静まる。1 巡で継ぎ目が出ない */
function beat(f) {
  const b = [1, 0.55, 0.25, 0.85, 0.45, 0.2, 0.1, 0.05, 0.02, 0.02, 0.04, 0.2];
  return b[f % MAD_N] ?? 0;
}
/** 纏いの棘の根元。顔を覆わないよう左右と肩に寄せ、背の 1 本は頭の上 */
const MAD_SPIKES = [
  { x: -30, y: FEET_Y, h: 34, lean: -8 },
  { x: -22, y: FEET_Y + 4, h: 46, lean: -5 },
  { x: -14, y: FEET_Y + 6, h: 26, lean: -3 },
  { x: 14, y: FEET_Y + 6, h: 28, lean: 3 },
  { x: 22, y: FEET_Y + 4, h: 44, lean: 5 },
  { x: 30, y: FEET_Y, h: 32, lean: 8 },
  { x: 0, y: -22, h: 24, lean: 0 },
];

/** 狂斧の纏い（持続中ずっと）: 鼓動のたびに棘が伸びて脈打ち、静まる間は縮む。血の滴が垂れ続ける */
function madAxeSustain(frame, f) {
  MAD_SPIKES.forEach((sp, i) => {
    // 棘ごとに鼓動を 0〜1 フレームずらす（一斉だと 1 枚の板に見える）
    const bi = beat(f + (i % 3 === 0 ? MAD_N - 1 : 0));
    const flick = 0.9 + 0.2 * hash1(f * 7 + i, 6101);
    spike(frame, {
      x: sp.x,
      y: sp.y,
      h: sp.h * (0.45 + 0.55 * bi) * flick,
      w: 6 + 3 * bi,
      lean: sp.lean * (0.9 + 0.6 * bi),
      bright: 0.5 + 0.45 * bi,
      erosion: 0.15 * (1 - bi),
      seed: 6110 + i,
    });
  });
  // 垂れる血の滴: 体の左右の高い所から、位相で下へ落ちて 1 巡で戻る
  for (let i = 0; i < 6; i++) {
    const t = (f / MAD_N + hash1(i, 6120)) % 1;
    const side = i % 2 === 0 ? -1 : 1;
    const x = side * (18 + hash1(i, 6121) * 16);
    const y = -20 + hash1(i, 6122) * 10 + t * t * 44;
    if (t > 0.85) continue;
    drop(frame, { x, y, vx: 0, vy: 1 + t * 3, r: 1.5 + 0.6 * (1 - t), bright: 0.55 + 0.25 * (1 - t), tail: 1.8 + t * 1.5 });
  }
  // 拍の瞬間だけ胸の前に光点（どくん）
  if (f === 0) sparkle(frame, 0, -2, 2);
}

/** 纏いの足元: 鼓動で脈打つ鋸歯の楕円（歯はゆっくり回る。14 歯を 1 巡で 1 歯ぶん進めて継ぎ目を消す） */
function madAxeSustainGround(frame, f) {
  const b = beat(f);
  const teeth = 14;
  sawRing(frame, { oy: FEET_Y, R: 22 + 3 * b, T: 3, teeth, tooth: 4 + 2 * b, squash: GROUND_SQUASH, bright: 0.38 + 0.25 * b, phase: (f / MAD_N) * (TAU / teeth), edge: false, seed: 6201 });
}

// -----------------------------------------------------------------------------
// 表
// -----------------------------------------------------------------------------

/**
 * 奥義 → 絵（render/fxMotions.ts の buildUltimateFx が読む）。life は流し切る秒、base は描いたときの大きさ（論理 px）。
 * 血祭りの base は周囲攻撃の半径。大投擲の放つ絵は拡縮しない（0）。弾は returnChakram の半径 5 で描く
 */
const FX = {
  moveset: "axe",
  ultimates: {
    "axe.bloodFeast": {
      ramp: "light",
      cast: { sheet: "axeUlt.bloodFeastCast", life: 0.35 },
      acts: [{ sheet: "axeUlt.bloodFeast", life: 0.6, base: FEAST_R / 2, pivot: "pos", ground: "axeUlt.bloodFeastGround" }],
    },
    "axe.greatThrow": {
      ramp: "light",
      cast: { sheet: "axeUlt.greatThrowCast", life: 0.3 },
      acts: [{ sheet: "axeUlt.greatThrow", life: 0.4, base: 0, pivot: "pos" }],
      shots: {
        0: {
          fly: "axeUlt.greatThrowFly",
          period: 0.45,
          base: 5,
          muzzle: "axeUlt.greatThrowMuzzle",
          impact: "axeUlt.greatThrowImpact",
          hit: "axeUlt.greatThrowHit",
          ramp: "light",
        },
      },
    },
    "axe.madAxe": {
      ramp: "light",
      cast: { sheet: "axeUlt.madAxeCast", life: 0.6 },
      sustain: { sheet: "axeUlt.madAxe", period: 0.9, ground: "axeUlt.madAxeGround" },
    },
  },
};

export const ATLAS = {
  key: "axeUlt",
  fx: FX,
  sheets: [
    { key: "axeUlt.bloodFeast", dirs: 1, frames: FEAST_N, active: FEAST_A, size: 2 * (FEAST_R + 56), draw: bloodFeast },
    { key: "axeUlt.bloodFeastGround", dirs: 1, frames: FEAST_N, active: FEAST_A, size: 2 * (FEAST_R + 20), draw: bloodFeastGround },
    { key: "axeUlt.bloodFeastCast", dirs: 1, frames: 8, active: 0, size: 140, draw: bloodFeastCast },
    { key: "axeUlt.greatThrowCast", dirs: DIRS, frames: 7, active: 0, size: 128, draw: greatThrowCast },
    { key: "axeUlt.greatThrow", dirs: DIRS, frames: 8, active: 3, size: 280, draw: greatThrowRelease },
    { key: "axeUlt.greatThrowFly", dirs: DIRS, frames: SPIN_N, active: 0, size: 2 * (SPIN_R + SPIN_TAIL + 8), draw: greatThrowFly },
    { key: "axeUlt.greatThrowMuzzle", dirs: DIRS, frames: 5, active: 0, size: 64, draw: greatThrowMuzzle },
    { key: "axeUlt.greatThrowImpact", dirs: DIRS, frames: 6, active: 0, size: 80, draw: greatThrowImpact },
    { key: "axeUlt.greatThrowHit", dirs: DIRS, frames: 7, active: 0, size: 96, draw: greatThrowHit },
    { key: "axeUlt.madAxeCast", dirs: 1, frames: 10, active: 0, size: 220, draw: madAxeCast },
    { key: "axeUlt.madAxe", dirs: 1, frames: MAD_N, active: 0, size: 128, draw: madAxeSustain },
    { key: "axeUlt.madAxeGround", dirs: 1, frames: MAD_N, active: 0, size: 96, draw: madAxeSustainGround },
  ],
};
