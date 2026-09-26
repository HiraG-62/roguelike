// 仕掛け（moveset "trapper"）のエフェクト。docs/ideas/fx-sprites.md 9 章。手本は sword.mjs、弾は sidearm.mjs、設置弾は wand.mjs の venomMist
// 単位は絵のドット（論理 0.5px）。当たり判定・弾の数値（weapons/WEAPON/movesets/trapper.json・bullets.json）× 2 が目安
//
// 性格: 床に地雷・撒き菱を置いて起爆する。刃の弧は無く、形は「置く・蹴る・合図を飛ばす・噴き上がる」。
//   設置弾の fly（dirs 1）は転がって止まったあとも同じ絵が繰り返されるので、「置かれて待っている」絵にする:
//     地雷（mineLauncher）: 円盤の縁に鋲、中央の信号灯が赤く点滅し、点いた直後に感知の輪が小さく広がる
//     撒き菱（caltrops）: 3 本の棘が床に寝た鉄の星。ゆっくり回り、棘の先を光が順に渡る
//     子地雷（art.scatterMines）: 小さな六角の円盤。信号灯が 2 度ずつ速く瞬く
//   炸裂（blast、dirs 1、半径 60 ドット = blastRadius 30）:
//     地雷: 地面から噴き上がる火柱と土の塊（放物線で落ちる）、焦げ跡、衝撃の輪
//     撒き菱: 鉄片が全周へ飛び散る（筋を引く 2 ドットの破片）。火は小さい
//     子地雷: 鋭い星の閃光と細い輪。軽く短い
// 近接は刃ではないので、白（段 7）は信号灯・合図の閃き・爆ぜる芯の光点だけ
import { arcLine, easeSwing, ring, shards, sparkle, streakLine } from "../shapes.mjs";
import { clamp01, dot, hash1, paint, stamp, valueNoise } from "../raster.mjs";
import { DEG, DIRS, WIDE_DIRS } from "../motifs.mjs";

const TAU = Math.PI * 2;
/** 炸裂の半径（blastRadius 30 論理 px × 2） */
const BLAST_R = 60;
/** 手元（自分の中心から前へ）。キャラ 48 ドットの縁の少し内 */
const HAND = 14;

// -----------------------------------------------------------------------------
// 共通の部品
// -----------------------------------------------------------------------------

/** 崩れの判定（shapes.mjs の survives と同じ考え。export されていないのでここに持つ） */
function survives(x, y, erosion, nearCore, seed) {
  if (erosion <= 0) return true;
  const n = valueNoise(x, y, 3.5, seed) * 0.6 + valueNoise(x, y, 1.4, seed + 7) * 0.2;
  return n + nearCore * 0.45 - erosion * 1.15 > 0;
}

/** 細る三角の針: (x, y) から角 a へ長さ len、根元の半幅 w。芯が明るく先ほど暗い */
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

/** 丸い塊（火の玉・煙の玉・土煙）。ノイズで縁を揺らし、erosion で虫食いに消える。hollow で中を抜く */
function blob(frame, x, y, r, o = {}) {
  const bright = o.bright ?? 0.7;
  const seed = o.seed ?? 1;
  const erosion = o.erosion ?? 0;
  const rough = o.rough ?? 0.25;
  const hollow = o.hollow ?? 0;
  paint(
    frame,
    (px, py) => {
      const d = Math.hypot(px - x, py - y);
      const edge = r * (1 - rough + rough * 2 * valueNoise(px, py, Math.max(2, r * 0.45), seed));
      if (d > edge) return -1;
      const q = d / Math.max(0.5, edge);
      if (erosion > 0 && valueNoise(px, py, 3, seed + 3) * 0.75 + (1 - q) * 0.3 - erosion * 1.1 < 0) return -1;
      const v = hollow > 0 ? (q < hollow ? 0.3 + 0.3 * q : 1 - ((q - hollow) / (1 - hollow)) * 0.5) : Math.pow(1 - q, 0.6);
      return clamp01(v * bright * (1 - erosion * 0.4));
    },
    { bounds: { x0: x - r * 1.3 - 2, y0: y - r * 1.3 - 2, x1: x + r * 1.3 + 2, y1: y + r * 1.3 + 2 } },
  );
}

/** 前へ押し出す圧の弧（潰れた楕円の前側 ±spread だけ）。全周の輪にすると的に見えるので前だけ */
function frontArc(frame, o) {
  const { ox = 0, radius, width } = o;
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
      const a = Math.atan2(y, dx);
      if (Math.abs(a) > spread) return -1;
      const d = Math.abs(Math.hypot(dx, y) - radius);
      if (d > width / 2) return -1;
      const q = d / (width / 2);
      const edge = Math.abs(a) / spread;
      if (!survives(x, y, erosion + edge * 0.3, 1 - q, seed)) return -1;
      return clamp01(bright * (1 - 0.5 * q) * (1 - 0.45 * edge));
    },
    { bounds: { x0: ox - 2, y0: -pad, x1: ox + pad * squash + 2, y1: pad } },
  );
}

/** 飛び散る粒の束（shards の薄い包み）。cone の扇へ、center の向きに */
function burst(frame, age, o) {
  const { n, seed, speed } = o;
  const cone = o.cone ?? TAU;
  const center = o.center ?? 0;
  shards(frame, age, n, seed, (i, rnd) => {
    const a = center + (rnd(1) - 0.5) * cone;
    const sp = speed * (0.5 + rnd(2));
    return {
      x: (o.x ?? 0) + (rnd(6) - 0.5) * (o.jitter ?? 2),
      y: (o.y ?? 0) + (rnd(7) - 0.5) * (o.jitter ?? 2),
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp,
      life: (o.life ?? 3) + Math.floor(rnd(3) * 3),
      size: rnd(4) > (o.big ?? 0.5) ? 2 : 1,
      drag: o.drag ?? 0.8,
      bright: o.bright ?? 1,
    };
  });
}

/**
 * 合図の閃き（手元のスイッチから走る電気の折れ線）: (ax, ay) → (bx, by) を n 折りにした 1px の線。
 * 起爆の「信号が走った」を見せる。grow で先端まで伸び、先端に光点
 */
function signalBolt(frame, o) {
  const { ax, ay, bx, by, seed } = o;
  const n = o.n ?? 4;
  const amp = o.amp ?? 3;
  const grow = o.grow ?? 1;
  const bright = o.bright ?? 0.85;
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
    streakLine(frame, { ax: p.x, ay: p.y, bx: q.x, by: q.y, bright: bright * (0.75 + 0.25 * (i / last)), width: 1.2 });
  }
  const tip = pts[last];
  if (tip && grow < 1) dot(frame, tip.x, tip.y, 7);
}

/** 放物線で飛んで落ちる塊（土・鉄片）。dirs 1 のシート用: 画面の上（−y）へ噴き上がり、重力で +y へ戻る */
function debris(frame, age, o) {
  const { n, seed } = o;
  for (let i = 0; i < n; i++) {
    const rnd = (k) => hash1(i * 13 + k, seed);
    const life = (o.life ?? 6) + Math.floor(rnd(5) * 3);
    if (age < 0 || age > life) continue;
    const a = -Math.PI / 2 + (rnd(1) - 0.5) * (o.cone ?? 2.4);
    const sp = o.speed * (0.55 + 0.7 * rnd(2));
    const x = (rnd(3) - 0.5) * (o.jitter ?? 10) + Math.cos(a) * sp * age;
    const y = Math.sin(a) * sp * age + (o.gravity ?? 1.2) * age * age;
    const fade = 1 - age / (life + 1);
    const level = Math.max(2, Math.round(2 + 4 * fade));
    // 土の塊は 2x2、落ちる向きに 1 ドットの尾
    dot(frame, x, y, level);
    dot(frame, x + 1, y, Math.max(1, level - 1));
    if (rnd(4) > 0.4) dot(frame, x, y + 1, Math.max(1, level - 1));
    if (fade > 0.4) dot(frame, x - Math.cos(a) * sp * 0.4, y - (Math.sin(a) * sp + 2 * (o.gravity ?? 1.2) * age) * 0.4, Math.max(1, level - 2));
  }
}

/** 画面の上へ昇る煙の玉（dirs 1）。後半の燻り */
function smokePuffs(frame, f, o) {
  const { n, seed, spread, from } = o;
  for (let i = 0; i < n; i++) {
    const t = f - from - hash1(i, seed) * 2;
    if (t < 0) continue;
    const k = t / (o.life ?? 5);
    if (k > 1) continue;
    const x = (hash1(i, seed + 1) - 0.5) * spread;
    const y = (hash1(i, seed + 2) - 0.5) * spread * 0.5 - t * (o.rise ?? 4);
    blob(frame, x, y, (o.r ?? 6) * (0.7 + 0.5 * k), { bright: (o.bright ?? 0.28) * (1 - k * 0.5), seed: seed + 10 + i, rough: 0.35, erosion: k * 0.9 });
  }
}

// -----------------------------------------------------------------------------
// 設置弾の本体（fly: 転がって止まり、置かれて待っている絵。dirs 1）
// -----------------------------------------------------------------------------

/**
 * 地雷の円盤（真上から）: 縁（段 5）・胴（段 3〜4、左上が明るい）・内側の溝（段 2）・中央の信号灯。
 * studs 個の鋲を縁に並べる。sides > 0 で多角形の縁（子地雷の六角）
 */
function mineBody(frame, o) {
  const { R } = o;
  const sides = o.sides ?? 0;
  const lamp = o.lamp ?? 0;
  const rot = o.rot ?? 0;
  paint(
    frame,
    (x, y) => {
      let d = Math.hypot(x, y);
      if (sides > 0) {
        // 多角形の縁: 辺の中心までの距離で測る
        const a = Math.atan2(y, x) - rot;
        const seg = TAU / sides;
        const local = ((a % seg) + seg) % seg - seg / 2;
        d = (d * Math.cos(local)) / Math.cos(Math.PI / sides);
      }
      if (d > R) return -1;
      // 段を直に決める（ディザで胴がざらつくと硬い筐体に見えないので dither 0）
      const lit = -(x + y) / (Math.SQRT2 * R);
      if (R - d < 1.3) return lit > -0.2 ? 0.52 : 0.4;
      const groove = R * 0.52;
      if (Math.abs(d - groove) < 0.65) return 0.12;
      if (d > groove) return lit > 0.3 ? 0.3 : 0.24;
      // 内側の感圧板（段 4）と、中央の信号灯（点けば白、消えれば暗いレンズ）
      if (d < 1.7) return lamp > 0 ? clamp01(0.7 + 0.3 * lamp) : 0.15;
      return lit > 0.2 ? 0.44 : 0.36;
    },
    { bounds: { x0: -R - 2, y0: -R - 2, x1: R + 2, y1: R + 2 }, dither: 0 },
  );
  // 鋲（縁の外へ出る 2 ドットの突起）: 転がって止まった向きが分かる
  const studs = o.studs ?? 0;
  for (let i = 0; i < studs; i++) {
    const a = rot + (i / studs) * TAU + (sides > 0 ? Math.PI / sides : 0);
    dot(frame, Math.cos(a) * (R + 0.6), Math.sin(a) * (R + 0.6), 5);
    dot(frame, Math.cos(a) * (R + 1.6), Math.sin(a) * (R + 1.6), 4);
  }
}

/** 地雷（mineLauncher）: 8 フレームで 1 巡。0〜1 で信号灯が点き、点いた直後に感知の輪が広がって消える */
function mineFly(frame, f) {
  const on = f === 0 ? 1 : f === 1 ? 0.55 : 0;
  mineBody(frame, { R: 7, studs: 4, lamp: on, rot: 45 * DEG });
  if (f === 0) sparkle(frame, 0, 0, 3);
  if (f === 1) sparkle(frame, 0, 0, 2);
  // 感知の輪: 縁の外で広がる細い輪（地雷が「生きている」ことを示す）
  if (f >= 1 && f <= 4) {
    const t = (f - 1) / 3;
    ring(frame, { radius: 8.5 + t * 7, width: 1.1, bright: 0.52 - t * 0.28, erosion: t * 0.55, seed: 3011 + f });
  }
}

/**
 * 撒き菱（caltrops）: 3 本の棘が床に寝た鉄の星（4 本目の上を向いた棘は中央の鋲）。
 * 6 フレームで 120°（3 回対称なので 1 巡でつながる）ゆっくり回り、棘の先を光が順に渡る
 */
function caltropFly(frame, f) {
  const N = 6;
  const rot = (f / N) * (TAU / 3);
  for (let i = 0; i < 3; i++) {
    const a = rot + (i / 3) * TAU - Math.PI / 2;
    spike(frame, { a, len: 8.5, w: 2.3, bright: 0.72 });
    // 棘の間に短い返し（撒き菱の角ばった輪郭）
    spike(frame, { a: a + Math.PI / 3, len: 3.5, w: 1.6, bright: 0.45 });
  }
  // 上を向いた棘（中央の鋲）
  blob(frame, 0, 0, 2.2, { bright: 0.9, seed: 3021, rough: 0 });
  // 光が棘の先を順に渡る（2 フレームずつ 1 本）
  const lit = Math.floor(f / 2) % 3;
  const a = rot + (lit / 3) * TAU - Math.PI / 2;
  sparkle(frame, Math.cos(a) * 7, Math.sin(a) * 7, f % 2 === 0 ? 2 : 1);
}

/** 子地雷（art.scatterMines）: 小さな六角の円盤。信号灯が 6 フレームで 2 度瞬く（親の地雷より忙しない） */
function miniMineFly(frame, f) {
  const on = f === 0 || f === 2 ? 1 : 0;
  mineBody(frame, { R: 5.4, sides: 6, studs: 3, lamp: on, rot: 30 * DEG });
  if (on) sparkle(frame, 0, 0, 2);
  // 点いた次のフレームに鋲の先が 1 つ光る（親の地雷の感知の輪より小さく、忙しなく瞬く）
  if (f === 1 || f === 3) {
    // 鋲の角（mineBody の rot 30° + 辺の半分 30°）に合わせる
    const a = (f === 1 ? 60 : 180) * DEG;
    sparkle(frame, Math.cos(a) * 7, Math.sin(a) * 7, 1);
  }
}

// -----------------------------------------------------------------------------
// 撃った瞬間（muzzle。原点 = 弾が出た位置、+x = 撃った向き）
// -----------------------------------------------------------------------------

/** 置き撃ち筒: 鋭い閃光ではなく、筒の「ぽん」という丸い煙の輪と短い炎。重い弾を押し出す鈍い発射 */
function launcherMuzzle(frame, f) {
  const N = 6;
  const k = f / (N - 1);
  if (f <= 1) {
    blob(frame, 1, 0, f === 0 ? 5 : 7, { bright: f === 0 ? 0.95 : 0.8, seed: 3101, rough: 0.2, erosion: f === 1 ? 0.4 : 0 });
    spike(frame, { x: 2, a: 0, len: f === 0 ? 11 : 8, w: 3, bright: 0.9 });
    if (f === 0) sparkle(frame, 1, 0, 2);
  }
  // 丸い煙の輪（筒の口の形）が前へ抜けて広がる
  if (f >= 1) {
    const age = f - 1;
    ring(frame, { ox: 6 + age * 4, radius: 4 + age * 2.2, width: 2, squash: 0.55, bright: 0.55 - age * 0.08, erosion: Math.min(0.9, age * 0.22), seed: 3102 });
  }
  // 筒の後ろから漏れる煙の玉
  if (f >= 2) {
    for (let i = 0; i < 3; i++) {
      const side = i === 1 ? 0 : i === 0 ? -1 : 1;
      blob(frame, -2 - f * 0.6, side * (3 + f), 2.4 + f * 0.4, { bright: 0.3 * (1 - k * 0.5), seed: 3103 + i, rough: 0.35, erosion: k * 0.8 });
    }
  }
}

/** 撒き菱筒: 小さな鉄片が扇に弾き出され、口に白い鉄の擦れる光。煙は薄い */
function caltropMuzzle(frame, f) {
  if (f <= 1) {
    blob(frame, 0, 0, f === 0 ? 3.5 : 4.5, { bright: 0.7, seed: 3111, rough: 0.3, erosion: f === 1 ? 0.4 : 0 });
    for (const a of [-22 * DEG, 0, 22 * DEG]) spike(frame, { x: 1, a, len: f === 0 ? 8 : 6, w: 1.5, bright: 0.85 });
  }
  // 撒かれる鉄片: 前の扇へ角ばった粒が飛び、1 つおきに光る
  shards(frame, f, 7, 3112, (i, rnd) => {
    const a = (rnd(1) - 0.5) * 1.1;
    const sp = 2.6 + rnd(2) * 2.6;
    return { x: 3, y: (rnd(3) - 0.5) * 3, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(4) * 2), size: 2, drag: 0.78 };
  });
  if (f === 1 || f === 2) sparkle(frame, 7 + f * 3, (f === 1 ? -1 : 1) * 3, 1);
}

/** 子地雷の撒き出し: 3 発の扇（±20°）に 1 つずつ小さな「ぽん」と、口の丸い閃き */
function scatterMuzzle(frame, f) {
  const N = 5;
  const k = f / (N - 1);
  if (f <= 1) {
    blob(frame, 0, 0, f === 0 ? 4 : 5.5, { bright: 0.85, seed: 3121, rough: 0.2, erosion: f === 1 ? 0.4 : 0 });
    if (f === 0) sparkle(frame, 0, 0, 2);
  }
  for (let j = -1; j <= 1; j++) {
    const a = j * 20 * DEG;
    const age = f - Math.abs(j);
    if (age < 0 || age > 3) continue;
    const r = 6 + age * 3;
    if (age <= 1) spike(frame, { x: Math.cos(a) * 3, y: Math.sin(a) * 3, a, len: 7 - age * 2, w: 1.8, bright: 0.85 });
    blob(frame, Math.cos(a) * r, Math.sin(a) * r, 1.8 + age * 0.6, { bright: 0.45 * (1 - k * 0.5), seed: 3122 + j, rough: 0.3, erosion: age * 0.25 });
  }
}

// -----------------------------------------------------------------------------
// 着弾（壁・敵に当たって止まった。原点 = 止まった位置、+x = 進んでいた向き）
// -----------------------------------------------------------------------------

/** 鉄の筐体がぶつかる「がん」: 当たった面の平たい閃き、後ろへ跳ねる火花、小さな潰れた輪 */
function clankImpact(frame, f, o) {
  const s = o.scale;
  if (f <= 1) {
    spike(frame, { x: 0, a: -Math.PI / 2, len: 7 * s, w: 1.6, bright: 0.85 });
    spike(frame, { x: 0, a: Math.PI / 2, len: 7 * s, w: 1.6, bright: 0.85 });
    spike(frame, { x: 0, a: Math.PI, len: 5 * s, w: 1.8, bright: 0.9 });
    if (f === 0) sparkle(frame, 0, 0, 2);
  }
  if (f >= 1 && f <= 3) ring(frame, { radius: 4 * s + f * 2.5, width: 1.5, squash: 0.55, erosion: (f - 1) * 0.35, bright: 0.6 - f * 0.1, seed: o.seed });
  shards(frame, f, o.sparks, o.seed + 1, (i, rnd) => {
    const a = Math.PI + (rnd(1) - 0.5) * 2.4;
    const sp = 2.4 + rnd(2) * 2.4;
    return { x: -1, y: (rnd(3) - 0.5) * 3, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(4) * 2), size: o.chunky ? 2 : rnd(5) > 0.5 ? 2 : 1, drag: 0.8 };
  });
}

// -----------------------------------------------------------------------------
// 炸裂（blast。dirs 1、原点 = 炸裂の中心、半径 60 ドットまで）
// -----------------------------------------------------------------------------

/**
 * 地雷: 地面から噴き上がる爆発。最初の閃光のあと、火の玉の塊が画面の上へ噴き上がって煙に変わり、
 * 土の塊が放物線で飛んで落ちる。床には土煙の輪が這い、焦げ跡の暗い斑が最後まで残る
 */
function mineBlast(frame, f) {
  const N = 10;
  const k = f / (N - 1);
  const R = BLAST_R * (0.4 + 0.6 * easeSwing(Math.min(1, (f + 1) / 4)));
  // 焦げ跡（地面）: 段 1〜2 の斑の円
  if (f >= 1) {
    paint(
      frame,
      (x, y) => {
        const d = Math.hypot(x, y * 1.3);
        const rr = 20 + 7 * valueNoise(x, y, 6, 3201);
        if (d > rr) return -1;
        if (valueNoise(x, y, 3, 3202) * 0.8 + (1 - d / rr) * 0.3 - k * 0.5 < 0.18) return -1;
        return 0.12 + 0.06 * (1 - d / rr);
      },
      { bounds: { x0: -30, y0: -24, x1: 30, y1: 24 }, samples: 2 },
    );
  }
  // 土煙の輪: 床を這う潰れた帯。縁はノイズで波打ち、最初から途切れがち（線の輪ではなく土の壁）
  if (f >= 1 && f <= 7) {
    paint(
      frame,
      (x, y) => {
        const a = Math.atan2(y * 1.35, x);
        const crest = R + 5 * valueNoise(Math.cos(a) * 20, Math.sin(a) * 20, 2.2, 3210) - 2;
        const d = Math.hypot(x, y * 1.35);
        const w = 10 * (1 - k * 0.5);
        const q = (crest - d) / w;
        if (q < 0 || q > 1) return -1;
        if (valueNoise(x, y, 4, 3203) * 0.7 + (1 - q) * 0.25 - 0.2 - k * 0.8 < 0) return -1;
        return clamp01((q < 0.2 ? 0.58 : 0.46 - q * 0.3) * (1 - k * 0.45));
      },
      { bounds: { x0: -R - 8, y0: -R / 1.35 - 8, x1: R + 8, y1: R / 1.35 + 8 } },
    );
  }
  // 閃光（最初の 1 枚）
  if (f === 0) {
    blob(frame, 0, -2, 14, { bright: 1, seed: 3204, rough: 0.3 });
    for (let i = 0; i < 6; i++) spike(frame, { y: -2, a: -Math.PI / 2 + (i - 2.5) * 0.45, len: 20 + 8 * hash1(i, 3211), w: 3, bright: 0.95 });
    sparkle(frame, 0, -2, 4);
  }
  // 噴き上がる火の玉 → 煙: 塊が上へ昇りながらふくらみ、明るさが火（段 6〜5）から煙（段 2〜3）へ落ちる
  if (f >= 1) {
    for (let i = 0; i < 7; i++) {
      const h = hash1(i, 3212);
      const t = f - 1;
      const cx = (hash1(i, 3213) - 0.5) * (14 + t * 3);
      const cy = -4 - t * (4 + 5 * h) - i * 2.5;
      const r = (9 + 7 * hash1(i, 3214)) * (0.85 + 0.12 * t) * (1 - i * 0.05);
      const fire = t < 2 ? 0.95 - t * 0.12 - i * 0.03 : t < 4 ? 0.62 - (t - 2) * 0.12 - i * 0.02 : 0.32 - (t - 4) * 0.03;
      blob(frame, cx, cy, r, { bright: fire, seed: 3215 + i, rough: 0.35, erosion: Math.max(0, t - 3) * 0.16 + i * 0.02 });
    }
  }
  // 土の塊が噴き上がって落ちる・横へ地を這う石つぶて
  debris(frame, f, { n: 22, seed: 3207, speed: 10, gravity: 0.95, cone: 2.4, jitter: 14, life: 7 });
  burst(frame, f, { n: 14, seed: 3208, speed: 8, life: 3, drag: 0.8, jitter: 12, big: 0.4 });
}

/**
 * 撒き菱: 鉄片が全周へ飛び散る。小さな閃光の芯と弱い輪、回りながら筋を引く三角の鉄片が主役。
 * 火の玉は小さく、噴き上がらない（地雷と形で見分ける）。後半は床に突き立った鉄片が残る
 */
function caltropBlast(frame, f) {
  const N = 9;
  const k = f / (N - 1);
  if (f <= 1) {
    blob(frame, 0, 0, f === 0 ? 7 : 9, { bright: f === 0 ? 0.95 : 0.7, seed: 3301, rough: 0.35, erosion: f * 0.3 });
    for (let i = 0; i < 8; i++) spike(frame, { a: (i / 8) * TAU + 0.3, len: (f === 0 ? 13 : 18) * (0.7 + 0.5 * hash1(i, 3302)), w: 2.2, bright: 0.9, erosion: f * 0.35, seed: 3312 + i });
    sparkle(frame, 0, 0, f === 0 ? 4 : 3);
  }
  if (f >= 1 && f <= 3) {
    const t = (f - 1) / 2;
    ring(frame, { radius: 16 + 30 * t, width: 1.4, bright: 0.45 - t * 0.15, erosion: 0.2 + t * 0.6, seed: 3303 });
  }
  // 鉄片: 放射状に飛ぶ小さな三角。回りながら減速し、最初の 2 枚は後ろへ筋を引く
  const count = 20;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * TAU + (hash1(i, 3304) - 0.5) * 0.28;
    const sp = 10 + hash1(i, 3305) * 5;
    const drag = 0.74;
    const life = 5 + Math.floor(hash1(i, 3306) * 3);
    if (f > life) continue;
    const travel = (1 - Math.pow(drag, f + 1)) / (1 - drag);
    const r = Math.min(BLAST_R, 5 + sp * travel);
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    const fade = 1 - f / (life + 1);
    if (f <= 2) {
      const tail = sp * Math.pow(drag, f) * 1.1;
      streakLine(frame, { ax: x - Math.cos(a) * tail, ay: y - Math.sin(a) * tail, bx: x - Math.cos(a) * 2, by: y - Math.sin(a) * 2, bright: 0.6 * fade });
    }
    const spin = a + f * (hash1(i, 3311) > 0.5 ? 1.1 : -1.1);
    spike(frame, { x: x - Math.cos(spin) * 2, y: y - Math.sin(spin) * 2, a: spin, len: 5, w: 1.7, bright: 0.45 + 0.5 * fade });
  }
  // 床に突き立った鉄片（後半に残る小さな棘）
  if (f >= 4) {
    for (let i = 0; i < 10; i++) {
      if (hash1(i + f * 3, 3307) < (k - 0.45) * 1.6) continue;
      const a = hash1(i, 3308) * TAU;
      const d = 20 + hash1(i, 3309) * 36;
      dot(frame, Math.cos(a) * d, Math.sin(a) * d, 5);
      dot(frame, Math.cos(a) * d, Math.sin(a) * d - 1, 4);
      dot(frame, Math.cos(a) * d + 1, Math.sin(a) * d, 3);
    }
  }
  smokePuffs(frame, f, { n: 3, seed: 3310, spread: 16, from: 2, life: 5, r: 5, rise: 3, bright: 0.22 });
}

/**
 * 子地雷: 鋭く短い「ぱん」。長さのばらつく 10 本の針と火の芯、全周の細い輪（最初から途切れがち）、
 * 火の粉。煙は少ない。針を等間隔・同じ長さにすると羅針盤の図形に見えるのでばらす
 */
function miniBlast(frame, f) {
  const N = 8;
  const k = f / (N - 1);
  const R = BLAST_R * easeSwing(Math.min(1, (f + 1) / 3));
  if (f <= 2) {
    const s = f === 0 ? 0.6 : f === 1 ? 1 : 1.1;
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * TAU + (hash1(i, 3406) - 0.5) * 0.5;
      spike(frame, { a, len: 26 * s * (0.45 + 0.55 * hash1(i, 3407)), w: 2.4, bright: 0.92, erosion: f === 2 ? 0.55 : 0, seed: 3401 + i });
    }
    blob(frame, 0, 0, f === 2 ? 9 : 6 + 4 * s, { bright: f === 2 ? 0.6 : 0.95, seed: 3402, rough: 0.3, erosion: f === 2 ? 0.4 : 0 });
    if (f <= 1) sparkle(frame, 0, 0, f === 0 ? 3 : 4);
  }
  if (f >= 1) {
    ring(frame, { radius: R, width: 2.6 * (1 - k * 0.5), bright: 0.56 - k * 0.25, erosion: Math.min(0.92, 0.35 + k * 0.9), seed: 3403 });
  }
  burst(frame, f, { n: 18, seed: 3404, speed: 7, life: 4, drag: 0.8, jitter: 6 });
  if (f >= 3) blob(frame, 0, -f * 1.5, 5 + f, { bright: 0.22, seed: 3405, rough: 0.4, erosion: k * 0.9 });
}

// -----------------------------------------------------------------------------
// 近接: 罠蹴り・起爆・連置き・罠陣・蹴り起爆・罠投げ・ダッシュ
// -----------------------------------------------------------------------------

/**
 * 蹴りの楔（足裏で前へ押し出す空気の塊）: 後ろが細く前ほど太く、前縁が前へふくらむ。
 * tip = 前縁の位置、back = 後端、H = 最大の半高。縁を白くしない（刃ではない）
 */
function kickWedge(frame, o) {
  const { tip, back, H, k, seed } = o;
  paint(
    frame,
    (x, y) => {
      const d = Math.abs(y);
      const front = tip - (d / H) ** 2 * 4;
      if (x < back || x > front) return -1;
      const u = (x - back) / Math.max(1, tip - back);
      const hw = 1.2 + (H - 1.2) * u ** 0.7;
      if (d > hw) return -1;
      const q = d / hw;
      if (!survives(x, y, k * 0.95 + (1 - u) * 0.3, u * (1 - q), seed)) return -1;
      if (front - x < 2 && k < 0.5) return 0.78 - q * 0.25;
      const grain = 0.8 + 0.3 * hash1(Math.floor((y + 40) / 1.8), seed + 1);
      return clamp01(u ** 1.4 * 0.66 * grain * (1 - q * 0.35) * (1 - k * 0.3));
    },
    { bounds: { x0: back - 1, y0: -H - 1, x1: tip + 1, y1: H + 1 } },
  );
}

/**
 * 罠蹴り（box reach 12 / size 20、原点 = 当たりの中心 = 自分から 24 ドット先）:
 * 足裏の楔が当たりの中心まで押し出し、蹴られた地雷（小さな円盤）が信号灯を瞬かせながら前へ滑る。
 * 滑った跡に床を擦る火花の筋
 */
function trapKick(frame, f) {
  const A = 3;
  const N = 8;
  const k = f < A ? 0 : (f - A + 1) / (N - A + 1);
  const p = f < A ? easeSwing((f + 1) / A) : 1;
  const tip = -14 + 16 * p;
  if (k < 0.85) kickWedge(frame, { tip, back: -30 + k * 20, H: 9 * (1 - k * 0.3), k, seed: 3501 });
  // 蹴られた地雷: 当たりの中心から前へ、減速しながら滑る
  if (f >= A - 1) {
    const age = f - (A - 1);
    const travel = (1 - Math.pow(0.7, age)) / 0.3;
    const x = 2 + travel * 7;
    slidMine(frame, x, age);
    // 床を擦る火花の筋（円盤の後ろ、上下 2 本）
    if (age >= 1 && age <= 4) {
      for (const side of [-1, 1]) streakLine(frame, { ax: x - 16 + age, ay: side * 3.5, bx: x - 5, by: side * 3.5, bright: 0.5 * (1 - k) });
    }
    shards(frame, age - 1, 5, 3502, (i, rnd) => {
      const a = Math.PI + (rnd(1) - 0.5) * 1.6;
      const sp = 1.8 + rnd(2) * 2;
      return { x: x - 4, y: (rnd(3) - 0.5) * 6, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 2 + Math.floor(rnd(4) * 2), size: 1 };
    });
  }
  if (f === A - 1) {
    frontArc(frame, { ox: -2, radius: 6, width: 2.2, squash: 0.5, spread: 80 * DEG, bright: 0.75, seed: 3503 });
    sparkle(frame, 0, 0, 2);
  }
  if (f >= A) {
    const age = f - A;
    frontArc(frame, { ox: age * 2, radius: 8 + age * 3, width: 2, squash: 0.5, spread: 80 * DEG, erosion: Math.min(0.9, age * 0.22), bright: 0.65 - age * 0.08, seed: 3503 });
  }
}

/** 滑る地雷の円盤を (x, 0) に描く（mineBody は原点に描くので、ずらした小さな円盤をここで塗る） */
function slidMine(frame, x, age) {
  const R = 5;
  const lamp = age % 2 === 0;
  paint(
    frame,
    (px, py) => {
      const d = Math.hypot(px - x, py);
      if (d > R) return -1;
      if (R - d < 1.2) return 0.6;
      if (d < 1.8) return lamp ? 1 : 0.32;
      return 0.3 + 0.12 * (-(px - x + py) / (Math.SQRT2 * R));
    },
    { bounds: { x0: x - R - 2, y0: -R - 2, x1: x + R + 2, y1: R + 2 } },
  );
  // 転がる鋲（回りながら縁を進む 2 つ）
  for (let i = 0; i < 2; i++) {
    const a = age * 50 * DEG + i * Math.PI;
    dot(frame, x + Math.cos(a) * (R - 0.4), Math.sin(a) * (R - 0.4), 5);
  }
}

/**
 * 起爆（circle size 24、原点 = 自分）: 手元のスイッチが閃き、合図の折れ線が周り（置いた罠のある床）へ走る。
 * 追って電波の輪が点線で 2 度広がる。刃の弧は無い
 */
function detonate(frame, f) {
  const A = 3;
  const N = 8;
  const k = f < A ? 0 : (f - A + 1) / (N - A + 1);
  const R = 24;
  // 手元のスイッチ: 押した瞬間の小さな閃き
  if (f <= 1) {
    blob(frame, HAND * 0.5, 0, f === 0 ? 3.5 : 2.5, { bright: 0.9, seed: 3601, rough: 0 });
    sparkle(frame, HAND * 0.5, 0, f === 0 ? 3 : 2);
  }
  // 合図の折れ線: 6 方向へ伸び、届くと先で消える
  if (f >= 0 && f <= 4) {
    const grow = f < A ? easeSwing((f + 1) / A) : 1;
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU + 45 * DEG;
      const r0 = 5 + (f >= A ? (f - A + 1) * 7 : 0);
      const r1 = R + 6;
      if (r0 >= r1 - 2) continue;
      signalBolt(frame, { ax: Math.cos(a) * r0, ay: Math.sin(a) * r0, bx: Math.cos(a) * r1, by: Math.sin(a) * r1, seed: 3602 + i * 7 + f, n: 4, amp: 1.6, grow, bright: 0.85 * (1 - k * 0.6) });
    }
  }
  // 電波の点線の輪（2 本を時間差で。同時には重ねない）
  for (let j = 0; j < 2; j++) {
    const age = f - 1 - j * 2;
    if (age < 0 || age > 3) continue;
    const t = age / 3;
    const radius = 8 + t * (R + 2);
    paint(
      frame,
      (x, y) => {
        const d = Math.abs(Math.hypot(x, y) - radius);
        if (d > 0.9) return -1;
        // 点線: 角を 16 に刻んで半分だけ塗る
        const seg = ((Math.atan2(y, x) / TAU) * 16 + 16 + age * 0.5) % 1;
        if (seg > 0.5) return -1;
        if (!survives(x, y, t * 0.8, 0.3, 3604 + j)) return -1;
        return clamp01(0.62 - t * 0.3);
      },
      { bounds: { x0: -radius - 2, y0: -radius - 2, x1: radius + 2, y1: radius + 2 }, dither: 0, samples: 2 },
    );
  }
  // 合図が届いた先の光点（置いた罠が応える）
  if (f === A || f === A + 1) {
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU + 45 * DEG;
      sparkle(frame, Math.cos(a) * (R + 6), Math.sin(a) * (R + 6), f === A ? 2 : 1);
    }
  }
  if (f >= A + 1) {
    burst(frame, f - A - 1, { n: 8, seed: 3603, speed: 2.5, life: 2, drag: 0.8, jitter: R * 1.6, bright: 0.7 });
  }
}

/** 置いた瞬間の床の印: 潰れた土煙の輪と、置かれた円盤の輪郭、信号灯の光点 */
function setDown(frame, x, y, age, seed) {
  if (age < 0 || age > 5) return;
  const t = age / 5;
  if (age <= 3) ring(frame, { ox: x, oy: y, radius: 3 + age * 2.4, width: 1.5, squash: 1.4, bright: 0.55 - age * 0.1, erosion: age * 0.25, seed });
  if (age <= 4) ring(frame, { ox: x, oy: y, radius: 3.2, width: 1.3, bright: 0.62 - t * 0.3, seed: seed + 1 });
  if (age === 0) sparkle(frame, x, y, 3);
  else if (age === 2 || age === 4) sparkle(frame, x, y, 1);
  shards(frame, age, 4, seed + 2, (i, rnd) => {
    const a = rnd(1) * TAU;
    const sp = 1.6 + rnd(2) * 1.4;
    return { x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.6, life: 2 + Math.floor(rnd(3) * 2), size: 1 };
  });
}

/** 連置き（circle size 20、原点 = 自分）: 前の左右に 2 つ、時間差で罠を置く。腕の振りの短い弧が置く場所へ下りる */
function doublePlace(frame, f) {
  const spots = [
    { x: 17, y: -10, at: 0 },
    { x: 17, y: 10, at: 2 },
  ];
  for (const [j, s] of spots.entries()) {
    const age = f - s.at;
    // 置く手の軌跡: 自分の前から置く場所へ下りる 1px の弧（置く直前の 1 フレーム）
    if (age === -1 || age === 0) {
      const a1 = Math.atan2(s.y, s.x);
      const r = Math.hypot(s.x, s.y);
      const from = a1 - Math.sign(s.y) * 35 * DEG;
      arcLine(frame, { radius: r, from: Math.min(from, a1), to: Math.max(from, a1), bright: age === 0 ? 0.6 : 0.45 });
    }
    setDown(frame, s.x, s.y, age, 3701 + j * 10);
  }
}

/**
 * 罠陣（circle size 20、原点 = 自分）: 自分の周りに 6 つの杭（小さな菱形）を時計回りに順に打ち、
 * 打った杭どうしを細い線の弧がつないで輪が閉じる。閉じたあと 1 度光って崩れる
 */
function trapCircle(frame, f) {
  const A = 4;
  const N = 9;
  const R = 20;
  const start = -90 * DEG;
  const k = f < A ? 0 : (f - A + 1) / (N - A + 1);
  const p = f < A ? easeSwing((f + 1) / A) : 1;
  const lit = Math.floor(p * 6 + 1e-6);
  // つなぐ弧（外に 1 本だけ。杭の外縁に沿わせる）
  if (k < 0.9) {
    const to = start + TAU * p;
    paint(
      frame,
      (x, y) => {
        const d = Math.abs(Math.hypot(x, y) - R);
        if (d > 0.8) return -1;
        let s = (Math.atan2(y, x) - start) % TAU;
        if (s < 0) s += TAU;
        if (s > to - start) return -1;
        if (!survives(x, y, k * 1.05, 0.3, 3801)) return -1;
        return clamp01((0.38 + (f === A ? 0.14 : 0)) * (1 - k * 0.4));
      },
      { bounds: { x0: -R - 2, y0: -R - 2, x1: R + 2, y1: R + 2 }, dither: 0, samples: 2 },
    );
  }
  for (let i = 0; i < 6; i++) {
    if (i >= lit && f < A) continue;
    const a = start + (i / 6) * TAU + (0.5 / 6) * TAU;
    const x = Math.cos(a) * R;
    const y = Math.sin(a) * R;
    const born = (i / 6) * A;
    const age = f - born;
    // 杭: 画面に揃えた小さな菱形（段 5 の縁・段 3 の芯）。崩れの間は欠ける
    if (k < 0.75 || hash1(i + f, 3802) > k) {
      // 杭は輪より明るく大きく（5x5 の菱形。輪の上で埋もれない）
      stamp(frame, x, y, ["..5..", ".565.", "56365", ".454.", "..4.."]);
    }
    if (age >= 0 && age < 1) sparkle(frame, x, y, 2);
    if (f === A) sparkle(frame, x, y, 1);
  }
  if (f >= A) {
    const age = f - A;
    shards(frame, age, 10, 3803, (i, rnd) => {
      const a = rnd(1) * TAU;
      return { x: Math.cos(a) * R, y: Math.sin(a) * R, vx: Math.cos(a) * 1.8, vy: Math.sin(a) * 1.8, life: 2 + Math.floor(rnd(2) * 2), size: 1 };
    });
  }
}

/**
 * 蹴り起爆（box reach 12 / size 20、原点 = 当たりの中心）: 短い蹴りの楔が当たりの中心で止まった瞬間、
 * 足元の罠がその場で爆ぜる（8 本の針の星と火の玉、前へ開く圧の弧、破片）
 */
function kickDetonate(frame, f) {
  const A = 3;
  const N = 8;
  const k = f < A ? 0 : (f - A + 1) / (N - A + 1);
  const p = f < A ? easeSwing((f + 1) / A) : 1;
  if (f < A) kickWedge(frame, { tip: -16 + 14 * p, back: -30, H: 8, k: 0, seed: 3901 });
  if (f === A - 1) {
    blob(frame, 0, 0, 6, { bright: 0.95, seed: 3902, rough: 0.2 });
    sparkle(frame, 0, 0, 3);
  }
  if (f >= A) {
    const age = f - A;
    if (age <= 1) {
      for (let i = 0; i < 8; i++) {
        const long = i % 2 === 0 ? 1 : 0.55;
        spike(frame, { a: (i / 8) * TAU + (hash1(i, 3908) - 0.5) * 0.5, len: (18 + age * 4) * long * (0.7 + 0.5 * hash1(i, 3909)), w: 3, bright: 0.9, erosion: age * 0.4, seed: 3903 + i });
      }
      blob(frame, 0, 0, 9 + age * 3, { bright: 0.85 - age * 0.2, seed: 3904, rough: 0.4, erosion: age * 0.45 });
      if (age === 0) sparkle(frame, 0, 0, 4);
    }
    frontArc(frame, { ox: 4 + age * 3, radius: 10 + age * 4, width: 2.4, squash: 0.55, spread: 85 * DEG, erosion: Math.min(0.9, age * 0.22), bright: 0.72 - age * 0.08, seed: 3905 });
    if (age >= 2) blob(frame, -2, -age * 2, 6 + age * 1.5, { bright: 0.26, seed: 3906, rough: 0.4, erosion: k * 0.9 });
  }
  if (f >= A - 1) burst(frame, f - (A - 1), { n: 12, seed: 3907, speed: 4, life: 3, drag: 0.8, jitter: 4, cone: 3.6, big: 0.3 });
}

/**
 * 罠投げ（circle size 20、原点 = 自分）: 手元から前へ山なりに放る。点線の放物線（画面上側の −y へふくらむ）の
 * 先を小さな円盤が回りながら進み、着地で土煙と信号灯の光点
 */
function trapToss(frame, f) {
  const A = 3;
  const N = 8;
  const land = { x: 36, y: 0 };
  const lift = 14;
  const at = (t) => ({ x: HAND * 0.6 + (land.x - HAND * 0.6) * t, y: -lift * 4 * t * (1 - t) });
  const p = f < A ? easeSwing((f + 1) / A) : 1;
  // 点線の軌跡（通ったところだけ。崩れの間は後ろから消える）
  const tailFrom = f < A ? 0 : Math.min(1, (f - A + 1) * 0.3);
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    if (t > p || t < tailFrom || i % 2 === 1) continue;
    const q = at(t);
    dot(frame, q.x, q.y, t > p - 0.2 ? 5 : 4);
  }
  // 放る腕の小さな風: 手元の前に短い 1px の弧
  if (f <= 1) arcLine(frame, { radius: HAND, from: -50 * DEG, to: 10 * DEG, bright: f === 0 ? 0.6 : 0.4 });
  if (f < A) {
    const q = at(p);
    // 回る円盤（真横から見た潰れた楕円。縁の段 5、中の段 3）と信号灯
    const spin = Math.abs(Math.cos(f * 1.3));
    paint(
      frame,
      (x, y) => {
        const dx = (x - q.x) / (4.5 * (0.45 + 0.55 * spin));
        const dy = (y - q.y) / 4.5;
        const d = Math.hypot(dx, dy);
        if (d > 1) return -1;
        return d > 0.7 ? 0.6 : 0.3;
      },
      { bounds: { x0: q.x - 7, y0: q.y - 7, x1: q.x + 7, y1: q.y + 7 } },
    );
    dot(frame, q.x, q.y, 7);
  } else {
    setDown(frame, land.x, land.y, f - A, 4001);
    if (f - A <= 2) mineOutline(frame, land.x, land.y);
  }
}

/** 着地した地雷の小さな輪郭（段 4 の輪）。罠投げの着地点 */
function mineOutline(frame, x, y) {
  ring(frame, { ox: x, oy: y, radius: 4.5, width: 1.2, bright: 0.48, seed: 4002 });
}

/**
 * ダッシュ（circle size 32、原点 = 自分）: 低く滑り込む。前の縁だけ厚い潰れた土煙の弧と、
 * 後ろへ引く 2 本の擦り跡（床を滑った足の跡）、跳ね上がる小石。起爆の点線の輪とは形で見分ける
 */
function dash(frame, f) {
  const A = 3;
  const N = 8;
  const k = f < A ? 0 : (f - A + 1) / (N - A + 1);
  const p = f < A ? easeSwing((f + 1) / A) : 1;
  const R = 14 + 18 * p + k * 5;
  const W = 8 * (1 - k * 0.6);
  // 前の縁の土煙: 前半分（±100°）だけ。前ほど厚く明るい
  paint(
    frame,
    (x, y) => {
      const a = Math.atan2(y, x);
      if (Math.abs(a) > 100 * DEG) return -1;
      const front = Math.cos(a * 0.9);
      const r = Math.hypot(x, y);
      const w = W * (0.35 + 0.65 * Math.max(0, front));
      const d = r - (R - w);
      if (d < 0 || d > w) return -1;
      const q = d / w;
      if (!survives(x, y, k * 0.95 + (1 - Math.max(0, front)) * 0.3, q, 4101)) return -1;
      const grain = 0.8 + 0.3 * valueNoise(x, y, 2.5, 4102);
      return clamp01(q ** 0.8 * (0.35 + 0.4 * Math.max(0, front)) * grain * (1 - k * 0.4));
    },
    { bounds: { x0: -R * 0.3 - 2, y0: -R - 2, x1: R + 2, y1: R + 2 } },
  );
  // 擦り跡: 自分の下（左右の足）から後ろへ伸びる 2 本（途切れがちな線）
  if (k < 0.9) {
    for (const side of [-1, 1]) {
      const y = side * 6;
      const x1 = 4 - k * 10;
      const len = 30 * p * (1 - k * 0.5);
      paint(
        frame,
        (x, py) => {
          if (Math.abs(py - y) > 0.8 || x > x1 || x < x1 - len) return -1;
          const u = (x1 - x) / Math.max(1, len);
          if (valueNoise(x, py, 2.2, 4103 + side) < 0.25 + k * 0.5) return -1;
          return clamp01(0.5 * (1 - u) * (1 - k * 0.5));
        },
        { bounds: { x0: x1 - len - 2, y0: y - 2, x1: x1 + 2, y1: y + 2 }, dither: 0, samples: 2 },
      );
    }
  }
  if (f === A - 1) sparkle(frame, R - 3, 0, 2);
  if (f >= A - 1) {
    shards(frame, f - (A - 1), 9, 4104, (i, rnd) => {
      const a = (rnd(1) - 0.5) * 3;
      const sp = 2 + rnd(2) * 2.5;
      return { x: Math.cos(a) * R * 0.9, y: Math.sin(a) * R * 0.9, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 2 + Math.floor(rnd(3) * 3), size: rnd(4) > 0.6 ? 2 : 1 };
    });
  }
}

// -----------------------------------------------------------------------------
// 近接の命中（蹴り・起爆が当たったとき）
// -----------------------------------------------------------------------------

/**
 * 命中: 小さく爆ぜる火薬と鉄片。細い針の星（白は芯の光点だけ）、火の玉の芯、前へ多く飛ぶ角ばった鉄片。
 * heavy は火の玉が大きく、衝撃の輪と煙の玉が加わる
 */
function trapHit(frame, f, heavy) {
  const s = heavy ? 1.5 : 1;
  if (f <= 1) {
    const n = heavy ? 7 : 5;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + (hash1(i, heavy ? 4201 : 4211) - 0.5) * 0.4;
      const fwd = 0.6 + 0.4 * Math.max(0, Math.cos(a));
      spike(frame, { a, len: 12 * s * fwd * (f === 0 ? 0.8 : 1), w: 1.8 * s, bright: 0.9 });
    }
    blob(frame, 0, 0, (f === 0 ? 4 : 5.5) * s, { bright: f === 0 ? 0.92 : 0.78, seed: heavy ? 4202 : 4212, rough: 0.35, erosion: f === 1 ? 0.4 : 0 });
    sparkle(frame, 0, 0, f === 0 ? (heavy ? 4 : 3) : 2);
  }
  if (heavy && f >= 1 && f <= 4) {
    const age = f - 1;
    ring(frame, { radius: 9 + age * 5, width: 2.4, squash: 0.75, erosion: Math.min(0.9, age * 0.26), bright: 0.78 - age * 0.12, seed: 4203 });
  }
  shards(frame, f, heavy ? 16 : 9, heavy ? 4204 : 4214, (i, rnd) => {
    const a = (rnd(1) - 0.5) * (rnd(2) > 0.3 ? 1.6 : 4);
    const sp = (heavy ? 4 : 3) + rnd(3) * (heavy ? 4 : 2.5);
    return { x: 0, y: 0, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(4) * 2), size: 2, drag: 0.8 };
  });
  if (f >= 2) blob(frame, -1, -(f - 2) * 1.5, (3 + f) * s * 0.8, { bright: 0.24, seed: heavy ? 4205 : 4215, rough: 0.4, erosion: (f - 2) * 0.2 });
}

// -----------------------------------------------------------------------------
// シートと表
// -----------------------------------------------------------------------------

/** 繰り返しの設置弾（fly。dirs 1: 止まって置かれている絵なので向きを持たない） */
const FLY = (key, frames, size, draw) => ({ key, dirs: 1, frames, active: 0, size, draw });
/** 一度流す絵（muzzle・impact・blast） */
const ONCE = (key, frames, size, draw, dirs = DIRS) => ({ key, dirs, frames, active: 0, size, draw });

/** 設置弾の半径（数値表の radius） */
const MINE_BASE = 3;

/**
 * 武器種のモーション → シート・弾の key → 弾の絵。pivot: self = 自分の中心、anchor = 当たり判定の中心。
 * 弾は物理の火薬と鉄なので配色は真鍮（brass）
 */
const FX = {
  moveset: "trapper",
  motions: {
    dash: { sheet: "trapper.dash", pivot: "self", base: 32, measure: "size" },
    "r:trapKick": { sheet: "trapper.kick", pivot: "anchor", base: 12, measure: "reach" },
    "r:detonate": { sheet: "trapper.detonate", pivot: "self", base: 24, measure: "size" },
    "branch:doublePlace": { sheet: "trapper.doublePlace", pivot: "self", base: 20, measure: "size" },
    "branch:trapCircle": { sheet: "trapper.trapCircle", pivot: "self", base: 20, measure: "size" },
    "branch:kickDetonate": { sheet: "trapper.kickDetonate", pivot: "anchor", base: 12, measure: "reach" },
    "branch:trapToss": { sheet: "trapper.toss", pivot: "self", base: 20, measure: "size" },
  },
  hit: "trapper.hit",
  hitHeavy: "trapper.hitHeavy",
  bullets: {
    mineLauncher: {
      fly: "trapper.mineFly",
      period: 0.8,
      base: MINE_BASE,
      muzzle: "trapper.mineMuzzle",
      impact: "trapper.mineImpact",
      blast: "trapper.mineBlast",
      blastBase: 30,
      ramp: "brass",
    },
    caltrops: {
      fly: "trapper.caltropFly",
      period: 0.6,
      base: MINE_BASE,
      muzzle: "trapper.caltropMuzzle",
      impact: "trapper.caltropImpact",
      blast: "trapper.caltropBlast",
      blastBase: 30,
      ramp: "brass",
    },
    "art.scatterMines": {
      fly: "trapper.miniMineFly",
      period: 0.45,
      base: MINE_BASE,
      muzzle: "trapper.scatterMuzzle",
      impact: "trapper.miniImpact",
      blast: "trapper.miniBlast",
      blastBase: 30,
      ramp: "brass",
    },
  },
};

export const ATLAS = {
  key: "trapper",
  fx: FX,
  sheets: [
    // 近接
    { key: "trapper.dash", dirs: WIDE_DIRS, frames: 8, active: 3, size: 96, draw: dash },
    { key: "trapper.kick", dirs: DIRS, frames: 8, active: 3, size: 104, draw: trapKick },
    { key: "trapper.detonate", dirs: DIRS, frames: 8, active: 3, size: 80, draw: detonate },
    { key: "trapper.doublePlace", dirs: DIRS, frames: 8, active: 3, size: 64, draw: doublePlace },
    { key: "trapper.trapCircle", dirs: DIRS, frames: 9, active: 4, size: 64, draw: trapCircle },
    { key: "trapper.kickDetonate", dirs: DIRS, frames: 8, active: 3, size: 88, draw: kickDetonate },
    { key: "trapper.toss", dirs: DIRS, frames: 8, active: 3, size: 96, draw: trapToss },
    { key: "trapper.hit", dirs: DIRS, frames: 6, active: 0, size: 64, draw: (fr, f) => trapHit(fr, f, false) },
    { key: "trapper.hitHeavy", dirs: DIRS, frames: 7, active: 0, size: 96, draw: (fr, f) => trapHit(fr, f, true) },
    // 設置弾（置かれて待っている）
    FLY("trapper.mineFly", 8, 40, mineFly),
    FLY("trapper.caltropFly", 6, 32, caltropFly),
    FLY("trapper.miniMineFly", 6, 24, miniMineFly),
    // 撃った瞬間
    ONCE("trapper.mineMuzzle", 6, 56, launcherMuzzle),
    ONCE("trapper.caltropMuzzle", 5, 56, caltropMuzzle),
    ONCE("trapper.scatterMuzzle", 5, 48, scatterMuzzle),
    // 着弾
    ONCE("trapper.mineImpact", 6, 48, (fr, f) => clankImpact(fr, f, { scale: 1.2, sparks: 7, seed: 3151 })),
    ONCE("trapper.caltropImpact", 6, 48, (fr, f) => clankImpact(fr, f, { scale: 0.9, sparks: 9, seed: 3161, chunky: true })),
    ONCE("trapper.miniImpact", 5, 40, (fr, f) => clankImpact(fr, f, { scale: 0.8, sparks: 5, seed: 3171 })),
    // 炸裂
    ONCE("trapper.mineBlast", 10, 160, mineBlast, 1),
    ONCE("trapper.caltropBlast", 9, 144, caltropBlast, 1),
    ONCE("trapper.miniBlast", 8, 144, miniBlast, 1),
  ],
};
