// 擲弾筒（moveset "grenade"）のエフェクト。docs/ideas/fx-sprites.md 9 章。手本は sword.mjs・sidearm.mjs、炸裂は wand.mjs の fireBlast
// 単位は絵のドット（論理 0.5px）。当たり判定・弾の数値（weapons/WEAPON/movesets/grenade.json・弾の表）× 2 が目安
//
// 山なりに榴弾を撃ち込む武器。絵の軸:
//   - 弾は「回転しながら飛ぶ砲弾」（dirs 1。描画側が持ち上げて影を落とすので、絵は砲弾そのものだけ）
//   - 撃った瞬間は、筒口から吹く白煙と短く丸い閃光（銃の針の閃光ではなく、ずんぐりした「ぽん」）
//   - 炸裂は魔法ではない火薬の爆発: 閃光 → 火球 → 黒煙の輪 → 破片。曲射筒は重く大きく土煙を上げ、擲弾筒は鋭い破片が飛ぶ
//   - 近接は筒そのもので殴る・突く・蹴る。刃の白い縁を使わない鈍い帯と、筒口（丸い穴）の形、振るたびに漏れる煤煙
import { easeSwing, lens, shards, sparkle, streakLine } from "../shapes.mjs";
import { clamp01, dot, hash1, paint, valueNoise } from "../raster.mjs";
import { DEG, DIRS, WIDE_DIRS } from "../motifs.mjs";

const TAU = Math.PI * 2;

// -----------------------------------------------------------------------------
// 共通の部品
// -----------------------------------------------------------------------------

/** 崩れの判定（shapes.mjs の survives と同じ考え。export されていないのでここに持つ） */
function survives(x, y, erosion, nearCore, seed) {
  if (erosion <= 0) return true;
  const n = valueNoise(x, y, 3.5, seed) * 0.6 + valueNoise(x, y, 1.4, seed + 7) * 0.2;
  return n + nearCore * 0.45 - erosion * 1.15 > 0;
}

/** 振りの進み p（active の間 0→1）と崩れ k（振り終わり 0→1） */
function timing(f, A, N) {
  return { p: f < A ? easeSwing((f + 1) / A) : 1, k: f < A ? 0 : (f - A + 1) / (N - A + 1) };
}

/** 閃光の針 1 本（sidearm.mjs の spike と同じ形）: (x, y) から角 a へ長さ len、根元の半幅 w で先へ細る */
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
      const hw = w * (1 - u) + 0.35;
      const d = Math.abs(-dx * s + dy * c);
      if (d > hw) return -1;
      const q = d / hw;
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
 * 前へ押し出す圧の弧（潰れた楕円の前側だけ）。全周の輪にすると閃光の横に輪がぶら下がって見えるので前だけ
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
 * 煙の塊 1 つ: 縁がノイズで波打つ丸。芯が明るく縁が暗い（段 2 で締める）。
 * lit を渡すと画面の上（−y）側を明るくする（dirs 1 の絵だけ。回る絵で上を光らせると向きで光が回ってしまう）
 */
function puff(frame, x, y, r, o = {}) {
  const bright = o.bright ?? 0.5;
  const seed = o.seed ?? 1;
  const erosion = o.erosion ?? 0;
  const rough = o.rough ?? 0.3;
  const lit = o.lit ?? 0;
  if (r < 0.8) return;
  paint(
    frame,
    (px, py) => {
      const dx = px - x;
      const dy = py - y;
      const d = Math.hypot(dx, dy);
      const edge = r * (1 - rough + rough * 2 * valueNoise(px, py, Math.max(3, r * 0.9), seed));
      if (d > edge) return -1;
      const q = d / Math.max(0.5, edge);
      if (erosion > 0 && valueNoise(px, py, Math.max(3, r * 0.5), seed + 3) * 0.75 + (1 - q) * 0.3 - erosion * 1.1 < 0) return -1;
      // 縁の 1 ドットは暗部（煙の輪郭をくっきりさせる）。上から光を受けた面は少し明るい
      const rim = q > 0.82 ? 0.55 : 1;
      const light = lit ? 1 + lit * (-dy / Math.max(1, edge)) : 1;
      return clamp01((0.55 + 0.45 * (1 - q) ** 0.7) * rim * light * bright * (1 - erosion * 0.35));
    },
    { bounds: { x0: x - r * 1.3 - 2, y0: y - r * 1.3 - 2, x1: x + r * 1.3 + 2, y1: y + r * 1.3 + 2 } },
  );
}

/**
 * 火球: 縁が大きく揺れる炎の塊。中心は明るく（白は中心の数ドットだけ）、外縁ほど暗い。
 * heat（0..1）が下がるほど芯が消えて赤黒い塊になる
 */
function fireball(frame, o) {
  const { x = 0, y = 0, R, seed } = o;
  const heat = o.heat ?? 1;
  const erosion = o.erosion ?? 0;
  paint(
    frame,
    (px, py) => {
      const dx = px - x;
      const dy = py - y;
      const d = Math.hypot(dx, dy);
      const a = Math.atan2(dy, dx);
      // 外縁は角のノイズで瘤（こぶ）状に膨らむ。上側の瘤を大きく（熱い空気が昇る）
      const lobe = valueNoise(Math.cos(a) * 9, Math.sin(a) * 9, 2.2, seed) * 0.45 + Math.max(0, -dy / Math.max(1, d)) * 0.12;
      const edge = R * (0.72 + lobe);
      if (d > edge) return -1;
      const q = d / edge;
      if (erosion > 0 && valueNoise(px, py, 7, seed + 5) * 0.75 + (1 - q) * 0.35 - erosion * 1.15 < 0) return -1;
      // 中の渦（ノイズの筋）で平らな円に見せない
      const swirl = 0.82 + 0.3 * valueNoise(px + 40, py, 3.2, seed + 9);
      const core = (1 - q) ** 0.9;
      return clamp01((0.28 + core * (0.55 + 0.35 * heat)) * swirl * (0.55 + 0.45 * heat));
    },
    { bounds: { x0: x - R * 1.35 - 2, y0: y - R * 1.35 - 2, x1: x + R * 1.35 + 2, y1: y + R * 1.35 + 2 } },
  );
}

/**
 * 重い破片（塊）: 2x2 の角ばった塊（上が明るく下が暗い）。空へ跳ねて重力で落ちる放物線。
 * dirs 1 の炸裂で使う（y は画面の下）
 */
function chunk(frame, x, y, level) {
  dot(frame, x, y, level);
  dot(frame, x + 1, y, Math.max(2, level - 1));
  dot(frame, x, y + 1, Math.max(2, level - 1));
  dot(frame, x + 1, y + 1, Math.max(2, level - 2));
}

/** 打撃の星: n 本のトゲ + 芯。刃ではなく鈍器なので白は芯の中心だけ */
function bluntStar(frame, o) {
  const { x = 0, y = 0, R, n, seed } = o;
  const bright = o.bright ?? 1;
  const rot = o.rot ?? 0;
  for (let i = 0; i < n; i++) {
    const a = rot + ((i + (hash1(i, seed) - 0.5) * 0.5) / n) * TAU;
    const long = i % 2 === 0 ? 1 : 0.55;
    spike(frame, { x, y, a, len: R * long * (0.7 + 0.5 * hash1(i, seed + 1)), w: (o.w ?? 2.6) * (0.8 + 0.4 * hash1(i, seed + 2)), bright: bright * 0.9, erosion: o.erosion ?? 0, seed: seed + i });
  }
  if ((o.core ?? 1) > 0.3) flashCore(frame, x, y, o.core ?? R * 0.28, bright);
}

/**
 * 筒口: 筒の断面（丸い穴）を横から見た楕円の輪。(x, y) が中心、rx は奥行き（前後）、ry は筒の半径。
 * 輪は段 5、穴の中は段 2 の暗がり。擲弾筒の近接で「筒で殴っている」と一目で分かる印
 */
function bore(frame, o) {
  const { x, y = 0, rx, ry } = o;
  const bright = o.bright ?? 0.8;
  const erosion = o.erosion ?? 0;
  const tilt = o.tilt ?? 0;
  const c = Math.cos(tilt);
  const s = Math.sin(tilt);
  paint(
    frame,
    (px, py) => {
      const dx = px - x;
      const dy = py - y;
      const u = dx * c + dy * s;
      const v = -dx * s + dy * c;
      const e = Math.hypot(u / rx, v / ry);
      if (e > 1) return -1;
      if (!survives(px, py, erosion, 1 - e, 3301)) return -1;
      // 外周の輪（筒の肉厚）: 明るく、上側ほど光る
      if (e > 0.62) return clamp01(bright * (0.8 + 0.2 * (-v / ry)));
      return 0.16;
    },
    { bounds: { x0: x - Math.max(rx, ry) - 2, y0: y - Math.max(rx, ry) - 2, x1: x + Math.max(rx, ry) + 2, y1: y + Math.max(rx, ry) + 2 } },
  );
}

/**
 * 鈍い筒の帯（筒を振った軌跡）: 自分を中心に、角 head（先頭）から後ろ span だけ伸びる太い帯。
 * 刃ではないので外縁は段 5 止まり（白くしない）。先頭は平らに切れ、筒の回る縞（円周に沿う濃淡）が入る
 */
function tubeBand(frame, o) {
  const { R, T, head, span, seed } = o;
  const erosion = o.erosion ?? 0;
  const bright = o.bright ?? 1;
  paint(
    frame,
    (x, y) => {
      const r = Math.hypot(x, y);
      if (r > R + 0.5 || r < R - T - 1) return -1;
      const s = head - Math.atan2(y, x);
      if (s < 0 || s > span) return -1;
      const u = s / span;
      // 尾へ向かって内側から細る。先頭は太いまま（鈍器の平らな頭）
      const w = T * (1 - u) ** 0.55 + 0.8;
      const q = (R - r) / w;
      if (q < 0 || q > 1) return -1;
      if (!survives(x, y, erosion + u * 0.25, (1 - q) * (1 - u), seed)) return -1;
      const band = Math.floor((R - r) / 2.4);
      const stripe = 0.78 + 0.34 * hash1(band, seed);
      // 外縁の 2 ドットを段 5 の明部に（筒の肌の照り返し）。白（段 7）は使わない
      if (R - r < 2 && u < 0.5) return clamp01(0.74 * bright);
      return clamp01((1 - q * 0.55) * (0.66 - 0.4 * u) * stripe * bright * (1 - erosion * 0.4));
    },
    { bounds: { x0: -R - 2, y0: -R - 2, x1: R + 2, y1: R + 2 } },
  );
}

/** 振りの先頭の位置（半径 r、角 a） */
function polar(r, a) {
  return { x: Math.cos(a) * r, y: Math.sin(a) * r };
}

// -----------------------------------------------------------------------------
// 近接の振り
// -----------------------------------------------------------------------------

/**
 * 筒払い（arc 150° reach 30、原点 = 自分、heavy）: 重い筒を横に振り抜く太い鈍い帯。
 * 先頭に筒口（丸い穴）が見え、正面を通るところで打撃の星が弾ける。振り抜いたあと筒口から煤煙が漏れて漂う
 */
function tubeBash(frame, f) {
  const A = 4;
  const N = 9;
  const { p, k } = timing(f, A, N);
  const R = 60;
  const from = -75 * DEG;
  const head = from + 150 * DEG * p + k * 8 * DEG;
  const span = Math.min(head - from + 6 * DEG, 105 * DEG) * (1 - k * 0.7);
  const T = 19 * (1 - k * 0.35);
  if (k < 0.85) tubeBand(frame, { R, T, head, span, seed: 3401, erosion: k * 1.05 });
  // 先頭の筒口: 帯の平らな頭に、進む向きへ向いた楕円の穴（振っている間だけ）
  if (k < 0.3) {
    const mid = polar(R - T / 2, head - 2 * DEG);
    bore(frame, { x: mid.x, y: mid.y, rx: 3.4, ry: T / 2 - 0.5, tilt: head + Math.PI / 2, bright: 0.8 });
  }
  // 正面（角 5〜15°）を通るところの打撃: 太く短いトゲの星
  const hitAt = polar(R - 8, 10 * DEG);
  if (f >= 1 && f <= 3) {
    const age = f - 1;
    bluntStar(frame, { x: hitAt.x, y: hitAt.y, R: 18 + age * 2, n: 7, seed: 3402, w: 3.4 * (1 - age * 0.2), core: age === 0 ? 5 : age === 1 ? 3 : 0, bright: 0.95 - age * 0.2, erosion: age * 0.35, rot: 0.3 });
    if (age === 0) sparkle(frame, hitAt.x, hitAt.y, 3);
  }
  if (f >= 2) {
    const age = f - 2;
    frontArc(frame, { ox: hitAt.x + 2 + age * 3, oy: hitAt.y + age * 2, radius: 8 + age * 4, width: 2.6 - age * 0.3, squash: 0.55, spread: 80 * DEG, erosion: Math.min(0.9, age * 0.22), bright: 0.72 - age * 0.08, seed: 3403 });
  }
  // 角ばった破片: 振りの進む向き（接線 = +y 寄り）と外へ
  shards(frame, f - 1, 11, 3404, (i, rnd) => {
    const a = 10 * DEG + 70 * DEG * rnd(1) - 20 * DEG;
    const sp = 3 + rnd(2) * 3.5;
    return { x: hitAt.x, y: hitAt.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(3) * 3), size: 2, drag: 0.8 };
  });
  // 煤煙: 振り抜いた筒口（終わりの位置）から漏れ、ゆっくり外へ膨らんで薄れる
  if (f >= A - 1) {
    const age = f - (A - 1);
    const t = age / (N - A);
    const end = from + 150 * DEG;
    for (let i = 0; i < 3; i++) {
      const a = end - (6 + i * 12) * DEG;
      const c = polar(R - 6 + age * (1.5 + i * 0.5), a);
      puff(frame, c.x, c.y, (4 + i * 0.8) * (0.7 + t * 0.9), { bright: 0.42 - t * 0.12, seed: 3405 + i, erosion: Math.max(0, t - 0.35) * 1.4 });
    }
  }
}

/**
 * 筒突き（thrust reach 30 size 12、原点 = 自分）: 太い筒を真っすぐ押し出す柱。先は平らで筒口の輪が正面を向く。
 * 当たると前へ潰れた圧の弧、筒口から「ぼふっ」と煤煙が吹き出す（突きで撃鉄が揺れた暴発のにおい）
 */
function tubeThrust(frame, f) {
  const A = 3;
  const N = 7;
  const { p, k } = timing(f, A, N);
  const H = 7.5;
  const tip = 16 + 42 * p + k * 4;
  const back = 6 + k * 34;
  if (k < 0.9) {
    paint(
      frame,
      (x, y) => {
        if (x < back || x > tip) return -1;
        const d = Math.abs(y);
        const u = (x - back) / Math.max(1, tip - back);
        // 後ろは細く、前 7 割は筒の太さ（押し出しの柱）
        const hw = u > 0.3 ? H : 2 + (H - 2) * (u / 0.3) ** 0.7;
        if (d > hw) return -1;
        const q = d / hw;
        if (!survives(x, y, k * 1.05 + (1 - u) * 0.2, u * (1 - q), 3501)) return -1;
        // 筒の円柱の陰影: 上（−y）の面が明るく下が暗い。縦の縞で押し出しの勢い
        const side = 0.5 - 0.5 * (y / hw);
        const grain = 0.82 + 0.3 * hash1(Math.floor(x / 3), 3502);
        return clamp01((0.34 + 0.42 * side) * (0.55 + 0.45 * u) * grain * (1 - k * 0.3));
      },
      { bounds: { x0: back - 1, y0: -H - 1, x1: tip + 1, y1: H + 1 } },
    );
    // 柱の上縁の照り（1 ドット、段 5。刃ではないので白くしない）
    streakLine(frame, { ax: back + (tip - back) * 0.35, ay: -H + 0.8, bx: tip - 2, by: -H + 0.8, bright: 0.72 * (1 - k) });
  }
  if (k < 0.45) bore(frame, { x: tip, rx: 3.2, ry: H + 0.5, bright: 0.82 - k * 0.4 });
  // 柱の外側を後ろへ流れる速度線（上下に離して、柱に重ねない）
  if (k < 0.7) {
    for (let i = 0; i < 4; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const y = side * (H + 4 + Math.floor(i / 2) * 4);
      const x1 = tip - 6 - hash1(i, 3503) * 8 - k * 14;
      streakLine(frame, { ax: x1 - 14 - hash1(i, 3504) * 8, ay: y, bx: x1, by: y, bright: 0.5 * (1 - k) });
    }
  }
  if (f >= A - 1) {
    const age = f - (A - 1);
    const t = age / (N - A);
    frontArc(frame, { ox: tip + 2 + age * 2.5, radius: 7 + age * 4.5, width: 3 - age * 0.35, squash: 0.5, spread: 78 * DEG, erosion: Math.min(0.9, age * 0.2), bright: 0.8 - age * 0.1, seed: 3505 });
    // 筒口の前で膨らむ煤煙（3 つの塊が前と斜めへ）
    for (let i = 0; i < 3; i++) {
      const a = (i - 1) * 32 * DEG;
      const d = 3 + age * (3 + (i === 1 ? 1.5 : 0));
      puff(frame, tip + Math.cos(a) * d, Math.sin(a) * d, (3.2 + (i === 1 ? 1.2 : 0)) * (0.8 + t), { bright: 0.46 - t * 0.14, seed: 3506 + i, erosion: Math.max(0, t - 0.3) * 1.5 });
    }
    if (age === 0) sparkle(frame, tip + 1, 0, 3);
  }
  shards(frame, f - (A - 1), 8, 3509, (i, rnd) => {
    const a = (rnd(1) - 0.5) * 1.7;
    const sp = 3 + rnd(2) * 3;
    return { x: tip + 2, y: (rnd(3) - 0.5) * 8, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(4) * 2), size: rnd(5) > 0.4 ? 2 : 1 };
  });
}

/**
 * 靴底: 前へ出る平たい板（足の裏）。高さ 2·half、厚み thick。前面だけ段 5、横の溝（靴底の刻み）が段 3 で入る
 */
function sole(frame, o) {
  const { x, half, thick } = o;
  const erosion = o.erosion ?? 0;
  const bright = o.bright ?? 1;
  paint(
    frame,
    (px, py) => {
      const d = Math.abs(py);
      // 前面はわずかに前へふくらむ（足裏の丸み）
      const front = x + (1 - (d / half) ** 2) * 2;
      if (px > front || px < front - thick || d > half) return -1;
      const q = (front - px) / thick;
      if (!survives(px, py, erosion, 1 - q, 3601)) return -1;
      const groove = Math.floor((py + half) / 3) % 2 === 0 ? 1 : 0.62;
      if (q < 0.3) return clamp01(0.74 * bright);
      return clamp01((0.56 - 0.2 * q) * groove * bright);
    },
    { bounds: { x0: x - thick - 2, y0: -half - 1, x1: x + 3, y1: half + 1 } },
  );
}

/**
 * 蹴り飛ばし（box reach 12 size 20、原点 = 当たりの中心、heavy）: 靴底の平たい板が前へ叩き込まれ、
 * 後ろに押し出した空気の楔、当たった面で潰れた 2 枚の圧の弧（重い蹴り）、両脇へ噴き出す土煙
 */
function kickAway(frame, f) {
  const A = 3;
  const N = 8;
  const { p, k } = timing(f, A, N);
  const tip = -18 + 22 * p + k * 5;
  const half = 13;
  if (k < 0.8) {
    // 空気の楔: 靴底の後ろへ、後ろほど細い
    const back = tip - 30 + k * 18;
    paint(
      frame,
      (x, y) => {
        if (x < back || x > tip - 4) return -1;
        const u = (x - back) / Math.max(1, tip - 4 - back);
        const hw = 1.2 + (half - 3) * u ** 0.8;
        const d = Math.abs(y);
        if (d > hw) return -1;
        if (!survives(x, y, k * 1.1 + (1 - u) * 0.3, u, 3602)) return -1;
        const grain = 0.75 + 0.35 * hash1(Math.floor((y + 40) / 1.8), 3603);
        return clamp01(u ** 1.2 * 0.5 * grain * (1 - k * 0.4));
      },
      { bounds: { x0: back - 1, y0: -half, x1: tip, y1: half } },
    );
    sole(frame, { x: tip, half: half * (1 - k * 0.3), thick: 6, erosion: k * 1.2, bright: 1 - k * 0.3 });
  }
  if (f >= A - 1) {
    const age = f - (A - 1);
    frontArc(frame, { ox: tip + 1 + age * 2, radius: 7 + age * 4.5, width: 3.2 - age * 0.35, squash: 0.5, spread: 84 * DEG, erosion: Math.min(0.9, age * 0.2), bright: 0.8 - age * 0.08, seed: 3604 });
    // 2 枚目の弧は 1 フレーム遅れて外側（重い蹴りの 2 度目の揺れ）。1 枚目と半径をはっきり分ける
    if (age >= 1) frontArc(frame, { ox: tip + 6 + age * 3, radius: 4 + age * 5, width: 2, squash: 0.45, spread: 60 * DEG, erosion: Math.min(0.9, (age - 1) * 0.25), bright: 0.6 - age * 0.06, seed: 3605 });
    if (age === 0) sparkle(frame, tip + 2, 0, 3);
    // 両脇の土煙: 靴底の上下の端から横と後ろへ噴き出して広がる（上下対称）
    const t = age / (N - A + 1);
    for (const side of [-1, 1]) {
      for (let i = 0; i < 2; i++) {
        const cx = tip - 3 - i * 6 - age * 1.5;
        const cy = side * (half + 2 + age * (2.2 + i));
        puff(frame, cx, cy, (3 + i) * (0.8 + t), { bright: 0.4 - t * 0.12, seed: 3606 + i + (side > 0 ? 5 : 0), erosion: Math.max(0, t - 0.3) * 1.5 });
      }
    }
  }
  shards(frame, f - (A - 1), 9, 3612, (i, rnd) => {
    const a = (rnd(1) - 0.5) * 1.6;
    const sp = 3.5 + rnd(2) * 3;
    return { x: tip + 2, y: (rnd(3) - 0.5) * 16, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(4) * 2), size: 2, drag: 0.8 };
  });
}

/**
 * 蹴り撃ち（box reach 12 size 20、原点 = 当たりの中心）: 軽い蹴りの靴底（蹴り飛ばしより小さく薄い）と、
 * 蹴った直後に頭上の筒が火を吹く（筒口の丸い閃光と前へ流れる白煙）。弾は弾の絵が出るので描かない
 */
function kickShell(frame, f) {
  const A = 3;
  const N = 8;
  const { p, k } = timing(f, A, N);
  const tip = -14 + 16 * p + k * 3;
  if (k < 0.6) sole(frame, { x: tip, half: 11, thick: 5.5, erosion: k * 1.5, bright: 0.9 - k * 0.3 });
  if (f >= 1 && f <= 3) {
    const age = f - 1;
    frontArc(frame, { ox: tip + 1 + age * 2, radius: 5 + age * 3.5, width: 2.2, squash: 0.5, spread: 78 * DEG, erosion: Math.min(0.9, age * 0.3), bright: 0.66 - age * 0.1, seed: 3701 });
  }
  // 筒の発砲: 蹴り足の上（−y 側）の筒口から前へ。蹴り（正面）と上下に分けて重ねない
  const mx = -6;
  const my = -16;
  if (f === 2 || f === 3) {
    const s = f === 2 ? 1 : 0.6;
    flashCore(frame, mx, my, 6 * s, 1);
    spike(frame, { x: mx, y: my, a: 0, len: 14 * s, w: 4 * s, bright: 1 });
    spike(frame, { x: mx, y: my, a: -40 * DEG, len: 7 * s, w: 2.4 * s, bright: 0.85 });
    spike(frame, { x: mx, y: my, a: 40 * DEG, len: 7 * s, w: 2.4 * s, bright: 0.85 });
    if (f === 2) sparkle(frame, mx + 2, my, 3);
  }
  if (f >= 3) {
    const age = f - 3;
    const t = age / (N - 4);
    for (let i = 0; i < 3; i++) {
      const d = 5 + i * 4 + age * (2 + i * 0.6);
      puff(frame, mx + d, my - i * 1.5 - age * 0.5, (4 + i * 0.8) * (0.8 + t * 0.7), { bright: 0.55 - t * 0.2, seed: 3702 + i, erosion: Math.max(0, t - 0.3) * 1.5 });
    }
  }
  shards(frame, f - 1, 6, 3706, (i, rnd) => {
    const a = (rnd(1) - 0.5) * 1.4;
    const sp = 3 + rnd(2) * 2.5;
    return { x: tip + 2, y: (rnd(3) - 0.5) * 10, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 2 + Math.floor(rnd(4) * 2), size: rnd(5) > 0.5 ? 2 : 1 };
  });
}

/**
 * 突き払い（arc 150° reach 30、原点 = 自分、heavy）: 振り始めの位置で筒口を突き出す短い閃き（圧の輪）から、
 * 筒払いより細い帯で払い抜ける。通り道に筒口から漏れた白煙の粒が点々と残る（筒払いの太い帯・正面の星と見分ける）
 */
function thrustSweep(frame, f) {
  const A = 4;
  const N = 9;
  const { p, k } = timing(f, A, N);
  const R = 60;
  const from = -75 * DEG;
  const head = from + 150 * DEG * p + k * 6 * DEG;
  const span = Math.min(head - from + 4 * DEG, 125 * DEG) * (1 - k * 0.75);
  const T = 11 * (1 - k * 0.4);
  if (k < 0.85) tubeBand(frame, { R, T, head, span, seed: 3801, erosion: k * 1.1, bright: 0.95 });
  if (k < 0.3) {
    const mid = polar(R - T / 2, head - 2 * DEG);
    bore(frame, { x: mid.x, y: mid.y, rx: 2.6, ry: T / 2 + 0.5, tilt: head + Math.PI / 2, bright: 0.8 });
  }
  // 振り始めの突き: 始点の外へ潰れた圧の弧（外向き）
  if (f <= 2) {
    const a0 = from;
    const c = polar(R + 2, a0);
    paint(
      frame,
      (x, y) => {
        const dx = x - c.x;
        const dy = y - c.y;
        const along = dx * Math.cos(a0) + dy * Math.sin(a0);
        const across = -dx * Math.sin(a0) + dy * Math.cos(a0);
        const rr = 5 + f * 4;
        const d = Math.abs(Math.hypot(along / 0.5, across) - rr);
        if (along < 0 || d > 1.3) return -1;
        return clamp01(0.8 - f * 0.2);
      },
      { bounds: { x0: c.x - 24, y0: c.y - 24, x1: c.x + 24, y1: c.y + 24 } },
    );
    if (f === 0) sparkle(frame, c.x, c.y, 3);
  }
  // 通り道に残る白煙の粒: 先頭が通った角に生まれ、少し外へ漂って薄れる
  for (let j = 0; j < 5; j++) {
    const born = j * 0.8;
    const age = f - born;
    if (age < 0.5) continue;
    const a = from + 150 * DEG * easeSwing((born + 1) / A) - 6 * DEG;
    const t = age / (N - born);
    const c = polar(R + 2 + age * 1.3, a);
    puff(frame, c.x, c.y, (4 + hash1(j, 3802) * 1.6) * (0.8 + t * 0.7), { bright: 0.5 - t * 0.16, seed: 3803 + j, erosion: Math.max(0, t - 0.35) * 1.5 });
  }
  if (f >= A - 1) {
    shards(frame, f - (A - 1), 7, 3809, (i, rnd) => {
      const a = 75 * DEG + (rnd(1) - 0.3) * 0.9;
      const sp = 2.5 + rnd(2) * 3;
      const at = polar(R - 4, 70 * DEG);
      return { x: at.x, y: at.y, vx: Math.cos(a + Math.PI / 2) * sp, vy: Math.sin(a + Math.PI / 2) * sp, life: 2 + Math.floor(rnd(3) * 2), size: rnd(4) > 0.5 ? 2 : 1 };
    });
  }
}

/**
 * ダッシュ攻撃（circle size 36、原点 = 自分）: 筒を抱えて体ごとぶつかる。前だけ厚い弓なりの衝撃（船首の波）と、
 * 背中から後ろへ尾を引く煤煙の粒、両脇の土煙。銃の家系のダッシュ（全周の輪）と見分ける
 */
function dash(frame, f) {
  const A = 3;
  const N = 8;
  const { p, k } = timing(f, A, N);
  const R = 20 + 16 * p + k * 6;
  const W = 11 * (1 - k * 0.55);
  paint(
    frame,
    (x, y) => {
      const r = Math.hypot(x, y);
      const a = Math.atan2(y, x);
      if (Math.abs(a) > 82 * DEG) return -1;
      const front = Math.cos(a * 1.05);
      const w = W * Math.max(0.2, front);
      const d = r - (R - w);
      if (d < 0 || d > w) return -1;
      const q = d / w;
      if (!survives(x, y, k * 1.0 + (1 - front) * 0.55, q, 3901)) return -1;
      return clamp01(q ** 0.8 * (0.2 + 0.56 * front) * (1 - k * 0.35));
    },
    { bounds: { x0: -R, y0: -R - 2, x1: R + 2, y1: R + 2 } },
  );
  if (f === A - 1) sparkle(frame, R - 3, 0, 3);
  // 後ろへ残る煤煙: 走った道筋（−x）に 4 つ、古いものほど大きく薄い
  for (let i = 0; i < 4; i++) {
    const age = f - i * 0.6;
    if (age < 0) continue;
    const t = age / N;
    const x = -14 - i * 9 - age * 1.2;
    const y = (hash1(i, 3902) - 0.5) * 8;
    puff(frame, x, y, (4.5 + i * 0.8) * (0.8 + t), { bright: 0.42 - t * 0.14, seed: 3903 + i, erosion: Math.max(0, t - 0.3) * 1.6 + (i === 3 ? 0.1 : 0) });
  }
  if (f >= A - 1) {
    shards(frame, f - (A - 1), 10, 3908, (i, rnd) => {
      const a = (rnd(1) - 0.5) * 2.6;
      const sp = 2.5 + rnd(2) * 3;
      return { x: Math.cos(a) * R * 0.9, y: Math.sin(a) * R * 0.9, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 2 + Math.floor(rnd(3) * 3), size: rnd(4) > 0.5 ? 2 : 1 };
    });
  }
}

// -----------------------------------------------------------------------------
// その場で撃つ派生（二連弾・足元撃ち）。circle size 20、原点 = 自分。弾は弾の絵が出るので、筒口の閃光と白煙だけ
// -----------------------------------------------------------------------------

/** 筒を構えた先（自分の中心から前へ）。キャラ 48 ドットの縁の少し外 */
const HAND = 22;

/** 筒口の「ぽん」: 丸くずんぐりした閃光と前の短い太い針 3 本。s で大きさ */
function pomp(frame, x, y, a, s) {
  flashCore(frame, x, y, 5.5 * s, 1);
  spike(frame, { x, y, a, len: 12 * s, w: 4.2 * s, bright: 1 });
  spike(frame, { x, y, a: a - 38 * DEG, len: 7 * s, w: 2.6 * s, bright: 0.85 });
  spike(frame, { x, y, a: a + 38 * DEG, len: 7 * s, w: 2.6 * s, bright: 0.85 });
}

/**
 * 二連弾: 左右に 12° 開いて 2 発。1 発ごとに筒口がぽんと光り、白煙の塊がそれぞれの向きへ押し出されて膨らむ
 */
function twinShell(frame, f) {
  const N = 8;
  for (let j = 0; j < 2; j++) {
    const a = (j === 0 ? -6 : 6) * DEG;
    const age = f - j * 2;
    if (age < 0) continue;
    const x = Math.cos(a) * HAND;
    const y = Math.sin(a) * HAND;
    if (age === 0) {
      pomp(frame, x, y, a, 1.25);
      sparkle(frame, x, y, 3);
    }
    if (age === 1) pomp(frame, x, y, a, 0.7);
    // 白煙: 撃った向きへ 2 つ、筒口の脇に 1 つ
    const t = age / (N - j * 2);
    for (let i = 0; i < 3; i++) {
      if (age < 1) break;
      const d = 4 + i * 4 + age * (1.6 + i * 0.6);
      const side = i === 2 ? (j === 0 ? -1 : 1) * 3 : 0;
      puff(frame, x + Math.cos(a) * d - Math.sin(a) * side, y + Math.sin(a) * d + Math.cos(a) * side, (4.4 + i * 0.6) * (0.75 + t * 0.7), { bright: 0.55 - t * 0.22, seed: 4001 + j * 5 + i, rough: 0.4, erosion: Math.max(0, t - 0.35) * 1.6 });
    }
  }
}

/**
 * 足元撃ち: 腰だめに低く撃つ重い 1 発。大きな筒口の閃光と前の厚い白煙、反動で足元の土煙が自分の周りへ
 * 潰れた輪のように噴き出す（上下対称。反転しても崩れない）
 */
function footShot(frame, f) {
  const N = 8;
  const x = HAND - 2;
  if (f === 0) {
    pomp(frame, x, 0, 0, 1.3);
    sparkle(frame, x + 2, 0, 4);
  } else if (f === 1) {
    pomp(frame, x, 0, 0, 0.75);
  }
  if (f >= 1) {
    const age = f - 1;
    const t = age / (N - 1);
    frontArc(frame, { ox: x + 8 + age * 3, radius: 6 + age * 3.5, width: 2.4, squash: 0.5, spread: 80 * DEG, erosion: Math.min(0.9, age * 0.25), bright: 0.72 - age * 0.1, seed: 4101 });
    for (let i = 0; i < 3; i++) {
      const d = 5 + i * 5 + age * (2 + i * 0.6);
      puff(frame, x + d, (i - 1) * 2.5, (4.6 + i * 0.8) * (0.8 + t * 0.7), { bright: 0.56 - t * 0.22, seed: 4102 + i, erosion: Math.max(0, t - 0.35) * 1.6 });
    }
    // 足元の土煙: 自分の周りに 8 つの塊が外へ（前は筒の煙があるので後ろと脇を厚く）
    // 塊どうしを重ねて切れ目のない土煙の帯にする（離れた粒を並べると点線の輪に見える）
    for (let i = 0; i < 11; i++) {
      const a = Math.PI + ((i - 5) / 5) * 140 * DEG;
      const d = 17 + age * 3 + hash1(i, 4105) * 3;
      puff(frame, Math.cos(a) * d, Math.sin(a) * d, (4.6 + hash1(i, 4106) * 1.8) * (0.8 + t * 0.5), { bright: 0.36 - t * 0.12, seed: 4107 + i, rough: 0.4, erosion: Math.max(0, t - 0.25) * 1.6 });
    }
  }
  shards(frame, f - 1, 8, 4120, (i, rnd) => {
    const a = Math.PI + (rnd(1) - 0.5) * 4.4;
    const sp = 2 + rnd(2) * 2.5;
    return { x: Math.cos(a) * 20, y: Math.sin(a) * 20, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 2 + Math.floor(rnd(3) * 2), size: rnd(4) > 0.5 ? 2 : 1 };
  });
}

// -----------------------------------------------------------------------------
// 近接の命中（筒・靴底が当たったとき）
// -----------------------------------------------------------------------------

/**
 * 命中: 鉄の筒の鈍い打撃。太いトゲの少ない星（白は芯だけ）、進む向きに潰れた圧の弧、角ばった塊の破片、
 * 当たった所から漏れる煤の塊（擲弾筒の打撃の印）。heavy は星が大きく破片と煤が多い
 */
function meleeHit(frame, f, heavy) {
  const R = heavy ? 22 : 15;
  if (f <= 1) {
    bluntStar(frame, { R: R * (f === 0 ? 0.8 : 1), n: heavy ? 7 : 5, seed: heavy ? 4211 : 4221, w: heavy ? 4 : 3, core: heavy ? 5.5 : 4, rot: 0.25 });
    sparkle(frame, 0, 0, f === 0 ? (heavy ? 4 : 3) : heavy ? 3 : 2);
  } else if (f === 2) {
    bluntStar(frame, { R, n: heavy ? 7 : 5, seed: heavy ? 4211 : 4221, w: (heavy ? 4 : 3) * 0.7, core: 0, bright: 0.72, erosion: 0.6, rot: 0.25 });
  }
  if (f >= 1) {
    const age = f - 1;
    frontArc(frame, { ox: 2 + age * 2, radius: (heavy ? 9 : 6) + age * (heavy ? 5.5 : 4), width: heavy ? 3.4 : 2.4, squash: 0.6, spread: 85 * DEG, erosion: Math.min(0.92, age * 0.22), bright: 0.8 - age * 0.1, seed: heavy ? 4212 : 4222 });
  }
  shards(frame, f - 1, heavy ? 14 : 8, heavy ? 4214 : 4224, (i, rnd) => {
    const a = (rnd(1) - 0.5) * (rnd(2) > 0.3 ? 1.5 : 3.6);
    const sp = (heavy ? 4 : 3) + rnd(3) * (heavy ? 4 : 2.5);
    return { x: 0, y: 0, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(4) * 2), size: 2, drag: 0.8 };
  });
  // 煤: 当たった所の少し手前（−x）に暗い塊が膨らんで消える
  if (f >= 2) {
    const age = f - 2;
    const t = age / (heavy ? 4 : 3);
    const n = heavy ? 3 : 2;
    for (let i = 0; i < n; i++) {
      const a = Math.PI + (i - (n - 1) / 2) * 50 * DEG;
      const d = 5 + age * 2;
      puff(frame, Math.cos(a) * d, Math.sin(a) * d, (heavy ? 4.5 : 3.4) * (0.8 + t * 0.6), { bright: 0.3, seed: 4230 + i + (heavy ? 5 : 0), erosion: Math.max(0, t - 0.2) * 1.4 });
    }
  }
}

// -----------------------------------------------------------------------------
// 弾: 曲射筒（mortar）・擲弾筒（grenadeLauncher）
// -----------------------------------------------------------------------------

/**
 * 飛ぶ砲弾（dirs 1、原点 = 弾の中心）。フレームごとに砲弾の向き（角 rot）が回る。光は画面の左上から固定で当て、
 * 回っても上の面が光る（立体の砲弾が回って見える）。白は照りの 1〜2 ドットだけ
 */
function shellBody(frame, rot, g) {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const L = g.len;
  const H = g.half;
  paint(
    frame,
    (x, y) => {
      // 砲弾の軸の座標（u = 軸方向、+u が頭、v = 横）
      const u = x * c + y * s;
      const v = -x * s + y * c;
      let inside = false;
      let shade = 0;
      if (g.kind === "mortar") {
        // 曲射弾: 丸い頭 → 太い胴 → 細る尾 → 尾翼の板
        if (u >= 0) inside = Math.hypot(u / (L * 0.5), v / H) <= 1;
        else if (u >= -L * 0.55) inside = Math.abs(v) <= H * (1 - ((-u) / (L * 0.55)) ** 1.6 * 0.55);
        const fin = u < -L * 0.42 && u > -L * 0.72 && Math.abs(v) <= H * 0.95;
        if (fin) {
          inside = true;
          shade = -0.18;
        }
        // 胴の帯（信管の継ぎ目）
        if (inside && Math.abs(u - L * 0.12) < 0.8) shade = -0.22;
      } else {
        // 擲弾: ずんぐりした卵形。中央に帯（弾帯）、頭に小さな信管
        inside = Math.hypot(u / (L * 0.5), v / H) <= 1;
        if (inside && Math.abs(u + L * 0.08) < 0.9) shade = -0.25;
        if (!inside && u > 0 && u < L * 0.5 + 2 && Math.abs(v) < 1.3) {
          inside = true;
          shade = -0.1;
        }
      }
      if (!inside) return -1;
      // 光: 画面の左上（−x, −y）から。中心からの位置で面の向きを近似する
      const nx = x / (L * 0.5);
      const ny = y / (L * 0.5);
      const light = clamp01(0.5 - 0.45 * (nx * 0.55 + ny * 0.85));
      return clamp01(0.3 + 0.5 * light + shade);
    },
    { bounds: { x0: -L - 2, y0: -L - 2, x1: L + 2, y1: L + 2 } },
  );
  // 照り: 左上の 1 ドット
  dot(frame, -L * 0.18, -H * 0.55, 7);
}

/** 砲弾の数値。len = 全長、half = 胴の半幅（弾の半径 3 = 6 ドット前後に合わせる） */
const SHELLS = {
  mortar: { kind: "mortar", len: 17, half: 5.2, frames: 8, period: 0.4, seed: 4400 },
  grenadeLauncher: { kind: "grenade", len: 13, half: 5.4, frames: 6, period: 0.3, seed: 4500 },
};

/**
 * 曲射弾の飛行: 1 周を frames で回る。尾から細い煙の粒が後ろへこぼれる（向きを持たない絵なので、
 * 砲弾の尾の向きへ 2 つの粒を置く＝回転と一緒に煙が振り回される）
 */
function mortarFly(frame, f) {
  const g = SHELLS.mortar;
  const rot = (f / g.frames) * TAU;
  shellBody(frame, rot, g);
  for (let i = 0; i < 2; i++) {
    const a = rot + Math.PI + (i === 0 ? 0.35 : -0.5);
    const d = g.len * 0.75 + i * 3.5;
    const lvl = i === 0 ? 3 : 2;
    dot(frame, Math.cos(a) * d, Math.sin(a) * d, lvl);
    dot(frame, Math.cos(a) * d + 1, Math.sin(a) * d, lvl);
  }
}

/** 擲弾の飛行: 卵形が回り、頭の信管の火花がフレームごとに明滅する */
function grenadeFly(frame, f) {
  const g = SHELLS.grenadeLauncher;
  const rot = (f / g.frames) * TAU;
  shellBody(frame, rot, g);
  const tip = g.len * 0.5 + 2.5;
  const fx = Math.cos(rot) * tip;
  const fy = Math.sin(rot) * tip;
  if (f % 2 === 0) sparkle(frame, fx, fy, 2);
  else dot(frame, fx, fy, 6);
}

/**
 * 曲射筒の発射（原点 = 筒口の先、+x = 撃った向き）: 太く丸い閃光（前に短い太い炎）と、筒口から前と斜め上下へ
 * どっと吹く白煙の厚い塊。一発の重さを煙の量で見せる
 */
function mortarMuzzle(frame, f) {
  const N = 6;
  if (f <= 1) {
    const s = f === 0 ? 1 : 0.65;
    flashCore(frame, 0, 0, 9 * s, 1);
    spike(frame, { x: 0, a: 0, len: 18 * s, w: 7 * s, bright: 1 });
    spike(frame, { x: 0, a: -50 * DEG, len: 9 * s, w: 3.6 * s, bright: 0.85 });
    spike(frame, { x: 0, a: 50 * DEG, len: 9 * s, w: 3.6 * s, bright: 0.85 });
    if (f === 0) sparkle(frame, 0, 0, 4);
  }
  const t = f / (N - 1);
  // 白煙: 前の大きな塊 1 つと、斜めに押し出される 4 つ
  const blobs = [
    { a: 0, d: 9, r: 9.5 },
    { a: -32 * DEG, d: 7, r: 7 },
    { a: 32 * DEG, d: 7, r: 7 },
    { a: -75 * DEG, d: 5, r: 5.5 },
    { a: 75 * DEG, d: 5, r: 5.5 },
  ];
  blobs.forEach((b, i) => {
    if (f === 0 && i > 2) return;
    const d = b.d + f * (i === 0 ? 4.5 : 2.6);
    puff(frame, Math.cos(b.a) * d, Math.sin(b.a) * d, b.r * (0.6 + t * 0.7), { bright: 0.72 - t * 0.26, seed: 4410 + i, rough: 0.35, erosion: Math.max(0, t - 0.45) * 1.6 });
  });
  shards(frame, f, 7, 4420, (i, rnd) => {
    const a = (rnd(1) - 0.5) * 1.3;
    const sp = 3 + rnd(2) * 3;
    return { x: 4, y: (rnd(3) - 0.5) * 6, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 2 + Math.floor(rnd(4) * 3), size: 1 };
  });
}

/**
 * 擲弾筒の発射: 短く鋭い「ぽん」の閃光と、筒口から前へ抜けていく煙の輪（横から見た渦輪 = 上下 2 つの塊と、
 * それをつなぐ薄い帯）。曲射筒のどっと吹く煙と形で見分ける
 */
function launcherMuzzle(frame, f) {
  const N = 6;
  if (f <= 1) {
    const s = f === 0 ? 1 : 0.6;
    pomp(frame, -1, 0, 0, s);
    if (f === 0) sparkle(frame, 0, 0, 3);
  }
  const t = f / (N - 1);
  if (f >= 1) {
    const x = 6 + f * 5;
    const ry = 6 + f * 1.4;
    for (const side of [-1, 1]) puff(frame, x, side * ry, 4.6 * (0.8 + t * 0.4), { bright: 0.68 - t * 0.22, seed: 4510 + (side > 0 ? 1 : 0), rough: 0.2, erosion: Math.max(0, t - 0.45) * 1.8 });
    // 輪の前面（薄い楕円の弧）: 2 つの塊をつなぐ
    if (f <= 4) frontArc(frame, { ox: x - 1, radius: ry, width: 2.6, squash: 0.35, spread: 88 * DEG, erosion: Math.min(0.9, t * 0.6), bright: 0.56 - t * 0.12, seed: 4512 });
    // 筒口に残る小さな煙
    puff(frame, 2, 0, 2.6 * (0.8 + t), { bright: 0.42 - t * 0.14, seed: 4513, erosion: Math.max(0, t - 0.3) * 1.6 });
  }
  shards(frame, f, 5, 4520, (i, rnd) => {
    const a = (rnd(1) - 0.5) * 0.9;
    const sp = 3 + rnd(2) * 3;
    return { x: 4, y: (rnd(3) - 0.5) * 3, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 2 + Math.floor(rnd(4) * 2), size: 1 };
  });
}

/**
 * 着弾（落ちる前に壁・敵に当たって消えた。原点 = 消えた位置、+x = 進んでいた向き）: 砲弾がぶつかった
 * 平たい閃き・跳ね返る破片・ぶつかった所の土埃。炸裂は別の絵（blast）が出るので、ここは小さな衝突だけ
 */
function shellImpact(frame, f, s, seed) {
  if (f <= 1) {
    lens(frame, { ax: -1, ay: -9 * s, bx: -1, by: 9 * s, T: (f === 0 ? 4.5 : 2.8) * s, bias: 0, bright: 0.95 });
    flashCore(frame, 0, 0, 3.5 * s, 1);
    if (f === 0) sparkle(frame, 0, 0, 3);
  }
  shards(frame, f, Math.round(9 * s), seed, (i, rnd) => {
    const a = Math.PI + (rnd(1) - 0.5) * 2.4;
    const sp = 3 * s * (0.6 + 0.8 * rnd(2));
    return { x: -1, y: (rnd(3) - 0.5) * 4, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3 + Math.floor(rnd(4) * 2), size: 2, drag: 0.8 };
  });
  if (f >= 1) {
    const t = (f - 1) / 5;
    for (let i = 0; i < 3; i++) {
      const a = Math.PI + (i - 1) * 55 * DEG;
      const d = 4 + f * 2;
      puff(frame, Math.cos(a) * d, Math.sin(a) * d, (3.6 + (i % 2) * 1.2) * s * (0.8 + t * 0.6), { bright: 0.38 - t * 0.1, seed: seed + 10 + i, erosion: Math.max(0, t - 0.45) * 1.4 });
    }
  }
}

/** 炸裂の半径（blastRadius 28 = 56 ドット） */
const BLAST_R = 56;

/**
 * 地面に広がる楕円の輪（上下に潰した円 = 見下ろした地面の衝撃波）。上下対称
 */
function groundRing(frame, o) {
  const { r, width } = o;
  const erosion = o.erosion ?? 0;
  const bright = o.bright ?? 0.7;
  const seed = o.seed ?? 1;
  const sq = o.squash ?? 0.72;
  paint(
    frame,
    (x, y) => {
      const d = Math.abs(Math.hypot(x, y / sq) - r);
      if (d > width / 2) return -1;
      const q = d / (width / 2);
      if (!survives(x, y, erosion, 1 - q, seed)) return -1;
      return clamp01(bright * (1 - 0.5 * q) * (1 - erosion * 0.4));
    },
    { bounds: { x0: -r - width - 2, y0: -r * sq - width - 2, x1: r + width + 2, y1: r * sq + width + 2 } },
  );
}

/** 放物線で飛ぶ重い塊（dirs 1。y は画面の下、g は重力） */
function debris(frame, f, o) {
  const { n, seed, speed, g, life } = o;
  for (let i = 0; i < n; i++) {
    const age = f - (o.from ?? 0);
    if (age < 0 || age > life) continue;
    const a = hash1(i, seed) * TAU;
    const sp = speed * (0.55 + 0.6 * hash1(i, seed + 1));
    // 上へ跳ね上げる成分を足して、放物線で落ちる
    const up = (o.lift ?? 3) * (0.5 + hash1(i, seed + 2));
    const x = Math.cos(a) * sp * age;
    const y = Math.sin(a) * sp * age * 0.75 - up * age + 0.5 * g * age * age;
    const fade = age / (life + 1);
    const level = Math.max(3, Math.round(6 - fade * 3));
    if ((o.size ?? 2) >= 2 && hash1(i, seed + 3) > 0.35) chunk(frame, x, y, level);
    else dot(frame, x, y, level);
  }
}

/**
 * 曲射筒の炸裂（dirs 1、blastBase 28、原点 = 炸裂の中心）: 重く大きい火薬の爆発。
 * 0: 丸い白い閃光 → 1〜3: 瘤の膨らむ火球と地面の衝撃の輪 → 3〜: 黒煙の輪が外へ広がり、中心から黒煙が昇る
 * → 土煙が低く横へ這う。重い土塊が放物線で飛んで落ちる
 */
function mortarBlast(frame, f) {
  const N = 11;
  const k = f / (N - 1);
  if (f === 0) {
    flashCore(frame, 0, 0, 36, 1);
    bluntStar(frame, { R: 54, n: 8, seed: 4601, w: 6, core: 0 });
    sparkle(frame, 0, 0, 4);
  }
  // 火球: 1〜4 で膨らみ、熱が引いて赤黒く崩れる
  if (f >= 1 && f <= 5) {
    const t = (f - 1) / 4;
    fireball(frame, { x: 0, y: -2 - f * 2, R: 36 + 14 * easeSwing(Math.min(1, t * 1.6)), seed: 4602, heat: 1 - t * 0.9, erosion: Math.max(0, t - 0.5) * 1.4 });
  }
  // 地面の衝撃の輪: 速く外へ、炸裂の半径で消える
  if (f >= 1 && f <= 4) {
    const t = (f - 1) / 3;
    groundRing(frame, { r: 24 + (BLAST_R + 2 - 24) * easeSwing(t), width: 4.5 - t * 2, erosion: t * 0.75, bright: 0.8 - t * 0.25, seed: 4603 });
  }
  // 黒煙の輪: 10 個の塊が外へ広がる（地面を這うので上下に潰す）
  if (f >= 3) {
    const t = (f - 3) / (N - 3);
    const rr = 28 + 28 * easeSwing(Math.min(1, t * 1.4));
    // 塊を重ねて切れ目のない輪にする（離すと数珠に見える）
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * TAU + hash1(i, 4604) * 0.25;
      puff(frame, Math.cos(a) * rr, Math.sin(a) * rr * 0.7, (13 + hash1(i, 4605) * 5) * (0.8 + t * 0.35), { bright: 0.24 - t * 0.04, seed: 4606 + i, rough: 0.35, erosion: Math.max(0, t - 0.3) * 1.3, lit: 0.35 });
    }
  }
  // 中心の黒煙の柱: 画面の上へ昇りながら膨らむ（茸雲の軸）
  if (f >= 4) {
    const t = (f - 4) / (N - 4);
    for (let i = 0; i < 3; i++) {
      const y = -10 - i * 12 - t * 26;
      puff(frame, (i - 1) * 3, y, (14 - i * 2) * (0.8 + t * 0.5), { bright: 0.28 - t * 0.04, seed: 4620 + i, rough: 0.35, erosion: Math.max(0, t - 0.35) * 1.4 + i * 0.05, lit: 0.4 });
    }
  }
  // 土煙: 地面を低く横へ這う薄い塊（左右へ）
  if (f >= 2) {
    const t = (f - 2) / (N - 2);
    for (let i = 0; i < 6; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const x = side * (30 + Math.floor(i / 2) * 14 + t * 18);
      const y = 16 + Math.floor(i / 2) * 4 - t * 4;
      puff(frame, x, y, (7 + Math.floor(i / 2) * 1.5) * (0.7 + t * 0.6), { bright: 0.42 - t * 0.14, seed: 4630 + i, rough: 0.4, erosion: Math.max(0, t - 0.4) * 1.5, lit: 0.3 });
    }
  }
  // 土塊: 重く、上へ跳ね上がって落ちる
  debris(frame, f, { n: 16, seed: 4640, speed: 7, g: 1.6, lift: 5, life: 7, from: 1 });
  // 火の粉: 火球の周りに少し
  if (f >= 1 && f <= 6) {
    for (let i = 0; i < 10; i++) {
      if (hash1(i, 4650) < k) continue;
      const a = hash1(i, 4651) * TAU;
      const d = 30 + f * 5 + hash1(i, 4652) * 10;
      dot(frame, Math.cos(a) * d, Math.sin(a) * d * 0.8 - f * 2, Math.max(4, 7 - f));
    }
  }
}

/**
 * 擲弾筒の炸裂（dirs 1、blastBase 28）: 鋭く速い爆発。0: 細く長い針の星形の閃光 → 1〜2: 小さく速い火球 →
 * 破片が放射状に高速で飛ぶ（筋を引く鋭い欠片）→ 細めの黒煙の輪。曲射筒より火球と煙が小さく、破片が主役
 */
function launcherBlast(frame, f) {
  const N = 10;
  if (f === 0) {
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU + (hash1(i, 4701) - 0.5) * 0.25;
      const long = i % 2 === 0 ? 1 : 0.6;
      spike(frame, { a, len: (34 + 14 * hash1(i, 4702)) * long, w: 3, bright: 1 });
    }
    flashCore(frame, 0, 0, 12, 1);
    sparkle(frame, 0, 0, 4);
  }
  if (f >= 1 && f <= 3) {
    const t = (f - 1) / 2;
    fireball(frame, { x: 0, y: -f, R: 30 + 8 * t, seed: 4703, heat: 1 - t * 0.8, erosion: Math.max(0, t - 0.5) * 1.1 });
  }
  if (f >= 1 && f <= 3) {
    const t = (f - 1) / 2;
    groundRing(frame, { r: 22 + (BLAST_R - 22) * easeSwing(t), width: 3 - t, erosion: t * 0.8, bright: 0.75 - t * 0.2, seed: 4704 });
  }
  // 鋭い破片: 放射状に筋を引いて飛ぶ（先が明るい細い線 + 先端の粒）
  if (f >= 1 && f <= 6) {
    for (let i = 0; i < 22; i++) {
      const a = (i / 22) * TAU + (hash1(i, 4705) - 0.5) * 0.3;
      const sp = 11 + 6 * hash1(i, 4706);
      const age = f - 1;
      const r1 = 12 + sp * age * (1 - age * 0.07);
      if (r1 > BLAST_R + 18) continue;
      const len = Math.max(5, 18 - age * 3);
      const r0 = r1 - len;
      const fade = age / 6;
      streakLine(frame, { ax: Math.cos(a) * r0, ay: Math.sin(a) * r0 * 0.85, bx: Math.cos(a) * r1, by: Math.sin(a) * r1 * 0.85, width: age <= 1 ? 1.6 : 1.1, bright: 0.95 * (1 - fade * 0.5) });
      dot(frame, Math.cos(a) * r1, Math.sin(a) * r1 * 0.85, age <= 1 ? 7 : 6 - Math.min(2, age - 1));
    }
  }
  // 細めの黒煙の輪（7 つ）と中心の小さな煙
  if (f >= 2) {
    const t = (f - 2) / (N - 2);
    const rr = 20 + 22 * easeSwing(Math.min(1, t * 1.5));
    for (let i = 0; i < 11; i++) {
      const a = (i / 11) * TAU + hash1(i, 4707) * 0.3;
      puff(frame, Math.cos(a) * rr, Math.sin(a) * rr * 0.72, (9 + hash1(i, 4708) * 3) * (0.8 + t * 0.35), { bright: 0.24 - t * 0.04, seed: 4710 + i, rough: 0.35, erosion: Math.max(0, t - 0.25) * 1.4, lit: 0.35 });
    }
    puff(frame, 0, -6 - t * 16, 8 * (0.8 + t * 0.5), { bright: 0.32, seed: 4720, rough: 0.35, erosion: Math.max(0, t - 0.3) * 1.4, lit: 0.4 });
  }
  debris(frame, f, { n: 8, seed: 4730, speed: 6, g: 1.2, lift: 3, life: 6, from: 1, size: 1 });
}

// -----------------------------------------------------------------------------
// シートと表
// -----------------------------------------------------------------------------

/**
 * 武器種のモーション → シート（render/fxMotions.ts が読む）。pivot: self = 自分の中心、anchor = 当たり判定の中心。
 * base は絵を描いたときの当たり判定の大きさ（measure の値。論理 px）
 */
const FX = {
  moveset: "grenade",
  motions: {
    dash: { sheet: "grenade.dash", pivot: "self", base: 36, measure: "size" },
    "r:tubeBash": { sheet: "grenade.bash", pivot: "self", base: 30, measure: "reach" },
    "r:tubeThrust": { sheet: "grenade.thrust", pivot: "self", base: 30, measure: "reach" },
    "r:kickAway": { sheet: "grenade.kick", pivot: "anchor", base: 12, measure: "reach" },
    "branch:twinShell": { sheet: "grenade.twinShell", pivot: "self", base: 20, measure: "size" },
    "branch:footShot": { sheet: "grenade.footShot", pivot: "self", base: 20, measure: "size" },
    "branch:kickShell": { sheet: "grenade.kickShell", pivot: "anchor", base: 12, measure: "reach" },
    "branch:thrustSweep": { sheet: "grenade.thrustSweep", pivot: "self", base: 30, measure: "reach" },
  },
  hit: "grenade.hit",
  hitHeavy: "grenade.hitHeavy",
  bullets: {
    mortar: { fly: "grenade.mortarFly", period: SHELLS.mortar.period, base: 3, muzzle: "grenade.mortarMuzzle", impact: "grenade.mortarImpact", blast: "grenade.mortarBlast", blastBase: 28, ramp: "brass" },
    grenadeLauncher: { fly: "grenade.launcherFly", period: SHELLS.grenadeLauncher.period, base: 3, muzzle: "grenade.launcherMuzzle", impact: "grenade.launcherImpact", blast: "grenade.launcherBlast", blastBase: 28, ramp: "brass" },
  },
};

export const ATLAS = {
  key: "grenade",
  fx: FX,
  sheets: [
    { key: "grenade.dash", dirs: DIRS, frames: 8, active: 3, size: 112, draw: dash },
    { key: "grenade.bash", dirs: WIDE_DIRS, frames: 9, active: 4, size: 144, draw: tubeBash },
    { key: "grenade.thrust", dirs: DIRS, frames: 7, active: 3, size: 144, draw: tubeThrust },
    { key: "grenade.kick", dirs: DIRS, frames: 8, active: 3, size: 96, draw: kickAway },
    { key: "grenade.twinShell", dirs: DIRS, frames: 8, active: 3, size: 96, draw: twinShell },
    { key: "grenade.footShot", dirs: DIRS, frames: 8, active: 3, size: 96, draw: footShot },
    { key: "grenade.kickShell", dirs: DIRS, frames: 8, active: 3, size: 96, draw: kickShell },
    { key: "grenade.thrustSweep", dirs: WIDE_DIRS, frames: 9, active: 4, size: 144, draw: thrustSweep },
    { key: "grenade.hit", dirs: DIRS, frames: 6, active: 0, size: 72, draw: (frame, f) => meleeHit(frame, f, false) },
    { key: "grenade.hitHeavy", dirs: DIRS, frames: 7, active: 0, size: 96, draw: (frame, f) => meleeHit(frame, f, true) },
    { key: "grenade.mortarFly", dirs: 1, frames: SHELLS.mortar.frames, active: 0, size: 48, draw: mortarFly },
    { key: "grenade.launcherFly", dirs: 1, frames: SHELLS.grenadeLauncher.frames, active: 0, size: 40, draw: grenadeFly },
    { key: "grenade.mortarMuzzle", dirs: DIRS, frames: 6, active: 0, size: 88, draw: mortarMuzzle },
    { key: "grenade.launcherMuzzle", dirs: DIRS, frames: 6, active: 0, size: 80, draw: launcherMuzzle },
    { key: "grenade.mortarImpact", dirs: DIRS, frames: 7, active: 0, size: 64, draw: (frame, f) => shellImpact(frame, f, 1.2, 4801) },
    { key: "grenade.launcherImpact", dirs: DIRS, frames: 6, active: 0, size: 56, draw: (frame, f) => shellImpact(frame, f, 0.9, 4811) },
    { key: "grenade.mortarBlast", dirs: 1, frames: 11, active: 0, size: 176, draw: mortarBlast },
    { key: "grenade.launcherBlast", dirs: 1, frames: 10, active: 0, size: 168, draw: launcherBlast },
  ],
};
