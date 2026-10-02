// スキル石: 大拡張のスキル 前半 16 本（docs/ideas/fx-sprites.md 10 章）。単位は絵のドット（論理 0.5px）。正準の向きは +x
// 絵の大きさはスキルの数値（src/data/balance/skills/EXTRA_SKILL_TUNING/）の半径・長さ × 2 ドットで描き、表の base にその数値（px）を書く
//
// 伝染（contagion）: 病の斑点が床に広がり、胞子が噴き、胞子の筋が周りの敵へ渡って斑点を咲かせる
// 綻び（unravel）: 糸を引く針が飛び、当たると巻いた糸玉がほどけて糸くずが散る
// 燃え種爆ぜ（kindle）: 照準の輪に火種が灯り、燃えていた敵ごとに種が割れて炎の花弁が弾ける（床に焦げ跡）
// 五彩の礫（prismShard）: 三角のプリズムが光を 3 本に分け、結晶の礫が分光の尾を引いて飛ぶ
// 満月の砲（fullMoon）: 満月の円盤が昇り、月光の太い帯が壁まで伸び、壁で三日月形に砕ける
// 枯渇の刃（dregsBlade）: 干からびてひび割れた刃の 3 連斬。刃から乾いた欠片が崩れ落ちる
// 影渡り（shadowStep）: 影の水溜まりに沈み（触手が立つ）、敵の背後の水溜まりから影が噴き上がって爪の弧。間を影の筋が繋ぐ
// 砕氷槌（iceBreaker）: 槌の頭が振り下ろされ、床の氷が扇にひび割れて氷塊が飛ぶ。凍った敵は結晶ごと砕け散る
// 血抜き（bloodlet）: 血の輪が縮み、滴が中心へ吸われる。出血した敵の傷から血の滴の流れが自分へ注ぐ
// 毒の収穫（harvest）: 回る鎌が毒の滴を引いて飛び、毒を刈り取ると大鎌の一振りと毒の泡が抜け出る
// 放電（discharge）: 感電した敵で火花が弾け、稲妻がジグザグに自分へ戻って手元で玉にまとまる
// 追い討ち（rout）: 短刀（鍔と柄頭つき）が飛ぶ。恐怖した敵には 3 本の斬線が交差し、恐怖の輪が砕ける
// 処断（verdict）: 裁きの太刀筋に天秤の紋が浮かび、床に裁きの印。沈黙を消した敵には天から光の柱が落ちる
// 刺し穿ち（exploit）: 細い刺突の光と先端の衝撃。脆弱を消すと十字の会心の光と殻の割れ
// 剥奪（strip）: 鉤爪の手が飛び、弱体を奪うと爪が靄を握って引き抜き、撚れた靄が自分へ流れて上向きの山形が昇る
// 背水の一閃（lastStand）: 前へ長い一閃（残像つき）と、背後の足元に水の波紋（背水）
import { arcLine, crescent, easeSwing, lens, ring, shards, streakLine } from "../shapes.mjs";
import { clamp01, dot, glint, hash1, paint, segment, smoothstep, stamp, valueNoise } from "../raster.mjs";
import { DIRS } from "../motifs.mjs";

const TAU = Math.PI * 2;

// -----------------------------------------------------------------------------
// 共通の小さな部品
// -----------------------------------------------------------------------------

/** 円板。value は明るさ、または (d: 中心からの割合 0..1, x, y) → 明るさ（負で塗らない） */
function disc(frame, x, y, r, value) {
  if (r <= 0.3) return;
  paint(
    frame,
    (px, py) => {
      const d = Math.hypot(px - x, py - y) / r;
      if (d > 1) return -1;
      return typeof value === "function" ? value(d, px, py) : value;
    },
    { bounds: { x0: x - r - 1, y0: y - r - 1, x1: x + r + 1, y1: y + r + 1 }, dither: 0 },
  );
}

/** 滴（頭が丸く、尾へ細る）。頭 (x, y)、進む向き a、長さ len、頭の半径 w */
function teardrop(frame, o) {
  const { x, y, a, len, w } = o;
  const tx = x - Math.cos(a) * len;
  const ty = y - Math.sin(a) * len;
  const bright = o.bright ?? 0.8;
  paint(
    frame,
    (px, py) => {
      const s = segment(px, py, x, y, tx, ty);
      const r = w * Math.pow(1 - s.t, 0.7) + 0.3;
      if (s.d > r) return -1;
      return clamp01(bright * (1 - 0.45 * s.t) * (1 - 0.3 * (s.d / r)));
    },
    { bounds: { x0: Math.min(x, tx) - w - 1, y0: Math.min(y, ty) - w - 1, x1: Math.max(x, tx) + w + 1, y1: Math.max(y, ty) + w + 1 }, dither: 0 },
  );
}

/** 上下を反転した作業面（逆向きの振り）。塗りは元の格子へ入る */
function flipY(frame) {
  const f = Object.create(frame);
  f.toCanon = (gx, gy) => {
    const c = frame.toCanon(gx, gy);
    return { x: c.x, y: -c.y };
  };
  f.toGrid = (x, y) => frame.toGrid(x, -y);
  return f;
}

/** 画面の向き（sx, sy）→ 正準座標（シートの向き angle を打ち消す。影の立ち昇り・光の柱のように画面の上へ伸ばす物） */
function fromScreen(angle, sx, sy) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: sx * c + sy * s, y: -sx * s + sy * c };
}

/** 折れ線（点の列）を太さ width で塗る。bright は線に沿って一定 */
function polyline(frame, pts, width, bright) {
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (!a || !b) continue;
    streakLine(frame, { ax: a.x, ay: a.y, bx: b.x, by: b.y, bright: bright / 0.85, width });
  }
}

/** 上下に潰れた楕円の輪（床の波紋・水溜まり）。ring の squash は x 方向なので別に持つ */
function flatRing(frame, o) {
  const { radius, width } = o;
  const ox = o.ox ?? 0;
  const oy = o.oy ?? 0;
  const squash = o.squash ?? 0.5;
  const bright = o.bright ?? 0.6;
  const from = o.from ?? -Math.PI;
  const to = o.to ?? Math.PI;
  const pad = radius + width + 2;
  paint(
    frame,
    (x, y) => {
      const dx = x - ox;
      const dy = (y - oy) / squash;
      const d = Math.abs(Math.hypot(dx, dy) - radius);
      if (d > width / 2) return -1;
      const a = Math.atan2(dy, dx);
      if (a < from || a > to) return -1;
      return clamp01(bright * (1 - 0.4 * (d / (width / 2))));
    },
    { bounds: { x0: ox - pad, y0: oy - pad * squash, x1: ox + pad, y1: oy + pad * squash }, dither: 0 },
  );
}

/** 画面に揃った模様を 2 倍に（天秤の紋。0.5px のドットでは小さすぎる） */
function doubled(pattern) {
  const out = [];
  for (const row of pattern) {
    const wide = [...row].map((c) => c + c).join("");
    out.push(wide, wide);
  }
  return out;
}

function sizeOf(radiusDots, pad) {
  return Math.ceil(radiusDots + pad) * 2;
}

// -----------------------------------------------------------------------------
// 伝染（contagion）
// -----------------------------------------------------------------------------

const CONTAGION = { radiusPx: 56, trailStep: 10, seed: 7101 };
const CONTAGION_R = CONTAGION.radiusPx * 2;

/** 病の斑点 1 つ（暗い縁・膿んだ中・明るい点） */
function blotch(frame, x, y, r, bright = 1) {
  disc(frame, x, y, r, (d, px, py) => {
    if (d > 0.72) return 0.3 * bright;
    if (Math.hypot(px - (x - r * 0.3), py - (y - r * 0.3)) < r * 0.28) return 0.78 * bright;
    return (0.52 - 0.15 * d) * bright;
  });
}

/** 感染の広がり（地面）: 波の縁が広がり、通った床に斑点がぽつぽつ咲く */
function contagionBloom(frame, f) {
  const frames = 8;
  const p = (f + 0.5) / frames;
  const R = CONTAGION_R;
  const reach = smoothstep(0, 0.6, p);
  const fade = 1 - smoothstep(0.55, 1, p);
  ring(frame, { radius: R * reach, width: 3, bright: 0.75 * fade, erosion: 0.3 + 0.4 * p, seed: CONTAGION.seed });
  ring(frame, { radius: R * reach * 0.8, width: 1.5, bright: 0.45 * fade, erosion: 0.5 + 0.3 * p, seed: CONTAGION.seed + 2 });
  for (let i = 0; i < 36; i++) {
    const r = (k) => hash1(i * 7 + k, CONTAGION.seed + 1);
    const a = r(1) * TAU;
    const d = R * (0.15 + 0.8 * Math.sqrt(r(2)));
    if (d > R * reach + 2) continue;
    const grow = clamp01(((R * reach - d) / (R * 0.3)) * 1.5);
    const rad = (3.5 + 4.5 * r(3)) * grow * (1 - 0.5 * smoothstep(0.7, 1, p));
    if (rad < 1) continue;
    blotch(frame, Math.cos(a) * d, Math.sin(a) * d, rad, 0.6 + 0.4 * fade);
  }
}

/** 胞子の噴き出し（空中）: 中心に病の靄の塊、胞子の粒が外へ漂う */
function contagionSpores(frame, f) {
  const frames = 8;
  const p = (f + 0.5) / frames;
  const R = CONTAGION_R;
  if (p < 0.5) {
    const k = smoothstep(0, 0.5, p);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + 0.4;
      const at = 7 + 14 * k;
      blotch(frame, Math.cos(a) * at, Math.sin(a) * at - 6 * k, (6 + 3 * hash1(i, CONTAGION.seed + 3)) * (1 - k * 0.5), 1 - k * 0.4);
    }
  }
  for (let i = 0; i < 20; i++) {
    const r = (k) => hash1(i * 5 + k, CONTAGION.seed + 4);
    const a = r(1) * TAU;
    const at = R * (0.1 + 0.9 * smoothstep(0, 1, p) * (0.6 + 0.4 * r(2)));
    const wob = Math.sin(p * 9 + i) * 3;
    const x = Math.cos(a) * at - Math.sin(a) * wob;
    const y = Math.sin(a) * at + Math.cos(a) * wob - p * 10;
    if (p > 0.85 && r(3) < 0.5) continue;
    disc(frame, x, y, 2.2 + 1.2 * r(4), (d) => (d < 0.5 ? 0.85 : 0.5));
    dot(frame, x - Math.cos(a) * 2.5, y - Math.sin(a) * 2.5, 3);
  }
}

/** 胞子の筋（伝染の渡り。beam の 1 区間）: 細くうねる蔓と、渡る向き（+x）へ流れる胞子の粒 */
function contagionTrail(frame, f) {
  const frames = 7;
  const p = (f + 0.5) / frames;
  const half = CONTAGION.trailStep + 0.6;
  const len = CONTAGION.trailStep * 2;
  const fade = 1 - smoothstep(0.5, 1, p);
  for (let x = -CONTAGION.trailStep; x < CONTAGION.trailStep; x += 0.5) {
    const y = Math.sin(((x + CONTAGION.trailStep) / len) * TAU) * 2.5;
    dot(frame, x, y, fade > 0.5 ? 4 : 3);
  }
  for (let k = 0; k < 2; k++) {
    const u = (k * 0.5 + p * 1.2) % 1;
    const x = -half + u * len;
    const y = Math.sin(u * TAU) * 2.5;
    if (fade <= 0.1) continue;
    disc(frame, x, y, 2, (d) => (d < 0.5 ? 0.9 * fade + 0.1 : 0.55 * fade + 0.1));
  }
}

/** 斑点が咲く（渡った先の敵）: 体に斑点が次々と浮き、胞子が 2〜3 粒立つ */
function contagionMark(frame, f) {
  const frames = 8;
  const p = (f + 0.5) / frames;
  const fade = 1 - smoothstep(0.6, 1, p);
  if (p < 0.35) ring(frame, { radius: 4 + 22 * p, width: 2, bright: 0.7 });
  for (let i = 0; i < 6; i++) {
    const r = (k) => hash1(i * 3 + k, CONTAGION.seed + 6);
    const born = i / 8;
    const grow = clamp01((p - born) * 5);
    if (grow <= 0) continue;
    const a = (i / 6) * TAU + r(1) * 0.8;
    const at = 5 + 8 * r(2);
    blotch(frame, Math.cos(a) * at, Math.sin(a) * at, (2.5 + 2.5 * r(3)) * grow, 0.4 + 0.6 * fade);
  }
  for (let i = 0; i < 3; i++) {
    const y = -6 - p * 18 - i * 5;
    if (fade <= 0.1) continue;
    dot(frame, (hash1(i, CONTAGION.seed + 7) - 0.5) * 14, y, 6);
  }
}

// -----------------------------------------------------------------------------
// 綻び（unravel）
// -----------------------------------------------------------------------------

const UNRAVEL_SEED = 7201;

/** 糸を引く針（飛んでいる間）: 光る針先と、尾でほつれて 3 本に割れる糸 */
function unravelNeedle(frame, f) {
  lens(frame, { ax: -5, ay: 0, bx: 14, by: 0, T: 3.6, bright: 1.05, bias: 0 });
  // 針の穴
  dot(frame, -3, -1, 3);
  dot(frame, -3, 1, 3);
  if (f % 3 === 0) glint(frame, 13, 0, 2);
  const ph = f * 1.05;
  for (let x = -4; x > -20; x -= 0.5) {
    const amp = 0.6 + (-(x + 4) / 16) * 2.2;
    dot(frame, x, Math.sin(x * 0.45 + ph) * amp, x > -12 ? 6 : 5);
  }
  // ほつれ: 3 本の糸が広がりながら揺れる
  for (let s = -1; s <= 1; s++) {
    for (let x = -20; x > -36; x -= 0.5) {
      const t = -(x + 20) / 16;
      const y = s * t * 7 + Math.sin(x * 0.5 + ph + s * 2) * (1 + t * 1.5) + Math.sin(-20 * 0.45 + ph) * 2.8 * (1 - t);
      if (t > 0.75 && hash1(Math.floor(x * 2) + s * 50, UNRAVEL_SEED) < t - 0.5) continue;
      dot(frame, x, y, t < 0.5 ? 4 : 3);
    }
  }
}

/** ほどける糸玉（命中）: 巻いた糸の塊が現れ、糸が渦を描いてほどけて外へ伸び、切れ端が散る */
function unravelFray(frame, f) {
  const frames = 8;
  const p = (f + 0.5) / frames;
  const tight = 1 - smoothstep(0.1, 0.45, p);
  if (tight > 0.05) {
    for (let i = 0; i < 4; i++) {
      const rad = 5 + i * 1.8;
      ring(frame, { ox: (i - 1.5) * 0.8, radius: rad, width: 1.5, squash: 0.45 + 0.18 * i, bright: 0.85 * tight + 0.1 });
    }
    if (p < 0.2) glint(frame, 0, 0, 3);
  }
  const open = smoothstep(0.1, 0.8, p);
  const fade = 1 - smoothstep(0.65, 1, p);
  for (let i = 0; i < 7; i++) {
    const a0 = (i / 7) * TAU + hash1(i, UNRAVEL_SEED + 1) * 0.5;
    const L = 26 + 14 * hash1(i, UNRAVEL_SEED + 2);
    const curl = 1.6 + hash1(i, UNRAVEL_SEED + 3);
    for (let t = 0; t < 1; t += 0.02) {
      if (t > open) break;
      const r = 4 + t * L * open;
      const a = a0 + t * curl * (1 - open * 0.5);
      // 先の方から途切れて消える
      if (fade < 1 && hash1(Math.floor(t * 50) + i * 60, UNRAVEL_SEED + 4) > fade + (1 - t) * 0.4) continue;
      dot(frame, Math.cos(a) * r, Math.sin(a) * r, t > open - 0.08 ? 7 : t < 0.5 ? 5 : 4);
    }
  }
  shards(frame, f - 2, 9, UNRAVEL_SEED + 5, (i, r) => {
    const a = r(1) * TAU;
    return { x: Math.cos(a) * 6, y: Math.sin(a) * 6, vx: Math.cos(a) * (2 + 3 * r(2)), vy: Math.sin(a) * (2 + 3 * r(2)), life: 4, size: 2 };
  });
}

// -----------------------------------------------------------------------------
// 燃え種爆ぜ（kindle）
// -----------------------------------------------------------------------------

const KINDLE = { radiusPx: 52, burstPx: 30, seed: 7301 };

/** 火種（アーモンド形の種。割れ目が光る） */
function seed(frame, x, y, a, len, bright, crack) {
  lens(frame, { ax: x - Math.cos(a) * len, ay: y - Math.sin(a) * len, bx: x + Math.cos(a) * len, by: y + Math.sin(a) * len, T: len * 1.1, bright: bright * 0.7, bias: 0 });
  if (crack) {
    const nx = -Math.sin(a);
    const ny = Math.cos(a);
    for (let t = -0.6; t <= 0.6; t += 0.2) dot(frame, x + Math.cos(a) * len * t + nx * Math.sin(t * 8) * 0.8, y + Math.sin(a) * len * t + ny * Math.sin(t * 8) * 0.8, 7);
  }
}

/** 火を点ける（照準の輪）: 輪の上に火種が灯り、内へ火花を散らして消える */
function kindleFlint(frame, f) {
  const frames = 8;
  const p = (f + 0.5) / frames;
  const R = KINDLE.radiusPx * 2;
  const fade = 1 - smoothstep(0.55, 1, p);
  ring(frame, { radius: R, width: 2, bright: 0.55 * fade, erosion: 0.45 + 0.3 * p, seed: KINDLE.seed });
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * TAU + hash1(i, KINDLE.seed + 1) * 0.15;
    const x = Math.cos(a) * R;
    const y = Math.sin(a) * R;
    const lit = clamp01((p - hash1(i, KINDLE.seed + 2) * 0.3) * 4);
    if (lit <= 0 || fade <= 0.05) continue;
    seed(frame, x, y, a + Math.PI / 2, 4, 0.5 + 0.5 * fade, lit > 0.5 && p < 0.6);
    // 小さな炎: 画面の上へ揺れて立つ（頭が下の滴 = 炎の形）
    const flame = lit * fade * (0.7 + 0.3 * Math.sin(f * 2.1 + i));
    if (flame > 0.15) teardrop(frame, { x: x + Math.sin(f + i) * 1.2, y: y - 3, a: Math.PI / 2, len: 9 * flame + 2, w: 2.6 * flame + 0.6, bright: 0.95 });
    // 内へ跳ぶ火花
    const k = clamp01((p - 0.2) * 2);
    if (k > 0 && k < 1) streakLine(frame, { ax: x * (1 - 0.12 * k), ay: y * (1 - 0.12 * k), bx: x * (1 - 0.2 * k), by: y * (1 - 0.2 * k), bright: 0.9 * (1 - k) });
  }
}

/** 種が爆ぜる（燃えていた敵 1 体）: 光る種が割れ、炎の花弁が外へ開き、火の粉が上へ舞う */
function kindleBurst(frame, f) {
  const frames = 9;
  const p = (f + 0.5) / frames;
  const R = KINDLE.burstPx * 2;
  if (f <= 1) {
    seed(frame, 0, 0, -Math.PI / 2 + 0.3, 6 + f * 2, 1.2, true);
    glint(frame, 0, 0, f === 1 ? 4 : 2);
    if (f === 0) return;
  }
  const k = smoothstep(0.08, 0.5, p);
  const fade = 1 - smoothstep(0.45, 1, p);
  // 火球: 縁がぎざぎざで、崩れながら薄れる
  const core = R * 0.45 * k;
  paint(
    frame,
    (x, y) => {
      const d = Math.hypot(x, y);
      const edge = core * (0.85 + 0.3 * valueNoise(x + 40, y, 5, KINDLE.seed + 3));
      if (d > edge) return -1;
      const n = valueNoise(x, y + p * 30, 4, KINDLE.seed + 4);
      if (n < smoothstep(0.4, 1, p) * 1.1) return -1;
      return clamp01((1.1 - 0.7 * (d / Math.max(1, edge))) * (0.5 + 0.5 * fade));
    },
    { bounds: { x0: -core * 1.2 - 2, y0: -core * 1.2 - 2, x1: core * 1.2 + 2, y1: core * 1.2 + 2 } },
  );
  // 炎の花弁（外向きの滴。先が尖る）
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * TAU + hash1(i, KINDLE.seed + 5) * 0.3;
    const reach = R * (0.55 + 0.4 * hash1(i, KINDLE.seed + 6)) * k;
    const len = reach * 0.55 * (1 - 0.4 * (1 - fade));
    if (len < 2 || fade <= 0.05) continue;
    teardrop(frame, { x: Math.cos(a) * (reach - len), y: Math.sin(a) * (reach - len), a: a + Math.PI, len, w: 3.2 * fade + 0.8, bright: 0.95 * fade + 0.15 });
  }
  ring(frame, { radius: R * (0.3 + 0.7 * k), width: 2.5, bright: 0.6 * fade, erosion: 0.2 + 0.6 * p, seed: KINDLE.seed + 7 });
  shards(frame, f - 1, 14, KINDLE.seed + 8, (i, r) => {
    const a = r(1) * TAU;
    return { x: Math.cos(a) * 6, y: Math.sin(a) * 6, vx: Math.cos(a) * (3 + 4 * r(2)), vy: Math.sin(a) * (3 + 4 * r(2)) - 2.5, life: 5 + Math.floor(3 * r(3)), drag: 0.8 };
  });
}

/** 焦げ跡（地面）: 星形に焼けた床が暗く残って薄れる */
function kindleScorch(frame, f) {
  const frames = 9;
  const p = (f + 0.5) / frames;
  const R = KINDLE.burstPx * 2;
  const k = smoothstep(0.05, 0.35, p);
  const fade = 1 - smoothstep(0.5, 1, p);
  paint(
    frame,
    (x, y) => {
      const d = Math.hypot(x, y);
      const a = Math.atan2(y, x);
      const star = R * (0.35 + 0.35 * Math.pow(Math.abs(Math.cos(a * 4 + 0.3)), 3) + 0.1 * hash1(Math.floor((a / TAU + 1) * 24), KINDLE.seed + 9)) * k;
      if (d > star) return -1;
      const rim = d > star - 1.5;
      // 中は 2x2 の市松（孤立した暗い点は掃除で消えるので塊で間引く）
      if (!rim && ((Math.floor(x / 2) + Math.floor(y / 2)) & 1) === 1) return -1;
      if (hash1(Math.floor(x * 3.1) * 97 + Math.floor(y * 3.1), KINDLE.seed + 10) > fade + 0.2) return -1;
      return rim ? 0.24 : 0.15;
    },
    { bounds: { x0: -R, y0: -R, x1: R, y1: R }, dither: 0 },
  );
}

// -----------------------------------------------------------------------------
// 五彩の礫（prismShard）
// -----------------------------------------------------------------------------

const PRISM_SEED = 7401;
const PRISM_AT = 16;

/** 正三角形のプリズム（中心 cx、頂点の 1 つが +x）。面は明暗の 2 面、縁は明るい */
function prism(frame, cx, rad, bright) {
  const verts = [0, 1, 2].map((i) => ({ x: cx + Math.cos((i * TAU) / 3) * rad, y: Math.sin((i * TAU) / 3) * rad }));
  paint(
    frame,
    (x, y) => {
      let inside = true;
      let edge = Infinity;
      for (let i = 0; i < 3; i++) {
        const a = verts[i];
        const b = verts[(i + 1) % 3];
        const cross = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x);
        if (cross < 0) inside = false;
        edge = Math.min(edge, segment(x, y, a.x, a.y, b.x, b.y).d);
      }
      if (!inside) return -1;
      if (edge < 1.1) return clamp01(0.95 * bright);
      return clamp01((y < 0 ? 0.62 : 0.38) * bright);
    },
    { bounds: { x0: cx - rad - 1, y0: -rad - 1, x1: cx + rad + 1, y1: rad + 1 }, dither: 0 },
  );
}

/** 分光（撃った瞬間）: 後ろから白い光がプリズムへ入り、先の頂点から 3 本の縞の光へ分かれる */
function prismSplit(frame, f) {
  const frames = 7;
  const p = (f + 0.5) / frames;
  const fade = 1 - smoothstep(0.4, 1, p);
  const grow = smoothstep(0, 0.45, p);
  prism(frame, PRISM_AT, 8, 0.6 + 0.5 * fade);
  streakLine(frame, { ax: 0, ay: 0, bx: PRISM_AT - 4, by: 0, bright: 0.95 * fade, width: 2 });
  const tip = PRISM_AT + 8;
  for (const a of [-0.3, 0, 0.3]) {
    const len = 42 * grow;
    const nx = -Math.sin(a);
    const ny = Math.cos(a);
    // 縞: 3 本の平行な細線（明・中・暗）で分光に見せる
    [7, 5, 3].forEach((level, j) => {
      const off = (j - 1) * 1;
      const bx = tip + Math.cos(a) * len + nx * off;
      const by = Math.sin(a) * len + ny * off;
      if (fade <= 0.05) return;
      streakLine(frame, { ax: tip + nx * off, ay: ny * off, bx, by, bright: ((level / 7) * 0.95 * fade) / 0.85 });
    });
  }
  if (p < 0.5) glint(frame, tip, 0, 3);
}

/** 結晶の礫（飛んでいる間）: 菱形の結晶（明暗の面と稜線）に光が走り、後ろへ分光の 3 筋 */
function prismShot(frame, f) {
  const frames = 6;
  const shine = ((f / frames) * 14) - 6;
  paint(
    frame,
    (x, y) => {
      const w = x >= 2 ? (3.8 * (9 - x)) / 7 : (3.8 * (x + 6)) / 8;
      if (w <= 0 || Math.abs(y) > w) return -1;
      if (Math.abs(y) < 0.6) return 0.95;
      if (Math.abs(x - shine) < 1.2) return 0.85;
      return y < 0 ? 0.7 : 0.42;
    },
    { bounds: { x0: -7, y0: -5, x1: 10, y1: 5 }, dither: 0 },
  );
  [-2, 0, 2].forEach((y, j) => {
    const len = 12 + ((f + j) % 3) * 3;
    streakLine(frame, { ax: -6 - len, ay: y * 1.2, bx: -6, by: y * 0.6, bright: 0.75 - j * 0.12 });
  });
  if (f % 3 === 1) glint(frame, 3, -1, 2);
}

// -----------------------------------------------------------------------------
// 満月の砲（fullMoon）
// -----------------------------------------------------------------------------

const MOON = { halfPx: 9, beamStep: 12, seed: 7501, at: 18 };

/** 満月の円盤: 明るい面に暗いクレーター、縁は白く */
function moonDisc(frame, cx, r, bright) {
  const craters = [
    { x: -0.3, y: -0.25, r: 0.28 },
    { x: 0.35, y: 0.15, r: 0.2 },
    { x: -0.05, y: 0.45, r: 0.18 },
    { x: 0.25, y: -0.45, r: 0.13 },
  ];
  disc(frame, cx, 0, r, (d, x, y) => {
    if (d > 0.86) return clamp01(1 * bright);
    for (const c of craters) if (Math.hypot(x - cx - c.x * r, y - c.y * r) < c.r * r) return clamp01(0.5 * bright);
    return clamp01((0.8 - 0.1 * d) * bright);
  });
}

/** 満月が昇る（撃った瞬間）: 構えた先に満月が満ち、光輪が広がって、月が光へ溶ける */
function moonMuzzle(frame, f) {
  const frames = 8;
  const p = (f + 0.5) / frames;
  const grow = smoothstep(0, 0.3, p);
  const fade = 1 - smoothstep(0.45, 1, p);
  const r = 13 * grow + 1;
  if (fade > 0.05) moonDisc(frame, MOON.at, r, 0.55 + 0.5 * fade);
  ring(frame, { ox: MOON.at, radius: r + 4 + 18 * p, width: 2, bright: 0.7 * fade });
  ring(frame, { ox: MOON.at, radius: r + 2 + 8 * p, width: 1.5, bright: 0.55 * fade, erosion: 0.4, seed: MOON.seed });
  if (p > 0.2 && p < 0.6) glint(frame, MOON.at, 0, 4);
}

/** 月光の帯（beam の 1 区間）: 白い芯の太い帯、縁に月光の塵がきらめき、細って消える */
function moonBeam(frame, f) {
  const frames = 7;
  const p = (f + 0.5) / frames;
  const half = MOON.beamStep + 0.6;
  const band = MOON.halfPx * 2 * (1 - 0.55 * p) + 1.5;
  const coreW = 5.5 * (1 - p);
  paint(
    frame,
    (x, y) => {
      if (Math.abs(x) > half) return -1;
      const d = Math.abs(y);
      if (d > band) return -1;
      if (d < coreW) return 1;
      if (band - d < 1.2) return clamp01(0.75 * (1 - p * 0.5));
      return clamp01((0.72 - 0.32 * (d / band)) * (1 - p * 0.4));
    },
    { bounds: { x0: -half - 1, y0: -band - 2, x1: half + 1, y1: band + 2 }, dither: 0.03 },
  );
  if (p < 0.9) {
    for (let i = 0; i < 3; i++) {
      const x = (hash1(i + f * 5, MOON.seed + 1) - 0.5) * half * 2;
      const side = i % 2 === 0 ? -1 : 1;
      const y = side * (band + 2 + 3 * hash1(i + f * 7, MOON.seed + 2));
      dot(frame, x, y, 7);
      dot(frame, x + side * 0, y + side * 1, 5);
    }
  }
}

/** 壁で砕ける（着弾）: 三日月形の光のしぶきが手前へ開き、輪と光の欠片が返る */
function moonTip(frame, f) {
  const frames = 7;
  const p = (f + 0.5) / frames;
  const fade = 1 - smoothstep(0.25, 1, p);
  const r = 10 + 10 * p;
  paint(
    frame,
    (x, y) => {
      if (Math.hypot(x, y) > r) return -1;
      if (Math.hypot(x - r * 0.45, y) < r * 0.85) return -1;
      return clamp01(0.95 * fade + 0.05);
    },
    { bounds: { x0: -r - 1, y0: -r - 1, x1: r + 1, y1: r + 1 }, dither: 0 },
  );
  ring(frame, { radius: 4 + 16 * p, width: 2, squash: 0.5, bright: 0.7 * fade });
  if (p < 0.35) glint(frame, 0, 0, 4);
  shards(frame, f, 10, MOON.seed + 3, (i, rr) => ({ x: 0, y: 0, vx: -(2 + 4 * rr(1)), vy: (rr(2) - 0.5) * 10, life: 3 + Math.floor(4 * rr(3)), size: rr(4) > 0.5 ? 2 : 1 }));
}

// -----------------------------------------------------------------------------
// 枯渇の刃（dregsBlade）
// -----------------------------------------------------------------------------

const DREGS = { radiusPx: 30, halfAngle: 0.95, hits: 3, perHit: 4, seed: 7601 };

/** 干からびた斬撃 1 振り（q = その振りの中の進み 0..1）。ひびで欠けた刃の軌跡と、崩れ落ちる乾いた欠片 */
function driedSlash(frame, q, k, faded) {
  const R = DREGS.radiusPx * 2;
  const from = -DREGS.halfAngle;
  const sweep = DREGS.halfAngle * 2;
  const head = from + sweep * easeSwing(Math.min(1, q * 1.7));
  const tail = Math.max(from, head - sweep * 0.75);
  const erosion = faded ? 0.7 : 0.12 + 0.55 * smoothstep(0.45, 1, q);
  crescent(frame, { R, T: 15 + k * 2, head, tail, peak: 0.12, erosion, seed: DREGS.seed + k, streak: 0.8, bright: faded ? 0.5 : 0.85 + 0.08 * k, edge: 1.2, edgeReach: 0.4 });
  if (faded) return;
  // ひび: 刃の帯を横切る暗い切れ目（乾いて割れた刃）
  for (let i = 0; i < 5; i++) {
    const a = tail + (head - tail) * (0.15 + 0.17 * i);
    for (let t = 0; t < 8; t += 0.5) dot(frame, Math.cos(a) * (R - t) + (t % 2) * 0.5, Math.sin(a) * (R - t), 1);
  }
  // 崩れる欠片: 刃の通った所から、外へゆっくり落ちる灰色の粒
  const age = q * DREGS.perHit;
  for (let i = 0; i < 16; i++) {
    const r = (m) => hash1(i * 7 + m + k * 100, DREGS.seed + 20);
    const a = from + sweep * r(1);
    if (a > head) continue;
    const drift = age * (1.5 + 1.5 * r(2));
    const at = R - 4 - 6 * r(3) + drift;
    dot(frame, Math.cos(a) * at, Math.sin(a) * at + drift * 0.6, Math.max(2, 5 - Math.floor(age)));
    dot(frame, Math.cos(a) * at + 0.5, Math.sin(a) * at + drift * 0.6, 3);
  }
  if (q > 0.35 && q < 0.7) glint(frame, Math.cos(head) * (R - 3), Math.sin(head) * (R - 3), k === DREGS.hits - 1 ? 3 : 2);
}

/** 3 連斬（発動中）: 振りごとに向きを返し、前の振りの跡が乾いて崩れ残る */
function dregsSlashes(frame, f) {
  const k = Math.floor(f / DREGS.perHit);
  const q = ((f % DREGS.perHit) + 0.5) / DREGS.perHit;
  const target = (i) => (i % 2 === 0 ? frame : flipY(frame));
  if (k > 0) driedSlash(target(k - 1), 1, k - 1, true);
  driedSlash(target(k), q, k, false);
}

// -----------------------------------------------------------------------------
// 影渡り（shadowStep）
// -----------------------------------------------------------------------------

const SHADOW = { seed: 7701, trailStep: 10 };

/** 影の水溜まり（地面）: 暗い楕円が広がって縮む。縁に波紋 */
function shadowPool(frame, f) {
  const frames = 8;
  const p = (f + 0.5) / frames;
  const size = smoothstep(0, 0.25, p) * (1 - smoothstep(0.6, 1, p));
  const rx = 18 * size + 1;
  paint(
    frame,
    (x, y) => {
      const d = Math.hypot(x, y * 2.2) / rx;
      if (d > 1) return -1;
      if (d > 0.85) return 0.42;
      return 0.14 + 0.1 * valueNoise(x, y, 4, SHADOW.seed);
    },
    { bounds: { x0: -rx - 1, y0: -rx - 1, x1: rx + 1, y1: rx + 1 }, dither: 0 },
  );
  flatRing(frame, { radius: rx + 3 + 10 * p, width: 1.5, squash: 1 / 2.2, bright: 0.45 * (1 - p) });
}

/** 影の触手（立ち昇り）。画面の上へ伸びる細い影の筋 */
function tendrils(frame, angle, p, height, spread, seed) {
  for (let i = 0; i < 7; i++) {
    const x0 = (hash1(i, seed) - 0.5) * spread;
    const h = height * (0.5 + 0.5 * hash1(i, seed + 1));
    for (let t = 0; t < h; t += 0.5) {
      const u = t / h;
      const w = (1 - u) * 1.3;
      const sx = x0 + Math.sin(t * 0.3 + i * 1.7 + p * 6) * 2 * u;
      const level = u > 0.8 ? 5 : u > 0.4 ? 4 : 3;
      for (let s = -w; s <= w; s += 0.5) {
        const c = fromScreen(angle, sx + s, -t);
        dot(frame, c.x, c.y, level);
      }
    }
  }
}

/** 影に沈む（発った所）: 体の影が縦に縮んで沈み、触手が立って消える。黒い粒が昇る */
function shadowSink(frame, f, info) {
  const frames = 8;
  const p = (f + 0.5) / frames;
  const angle = info?.angle ?? 0;
  const body = 1 - smoothstep(0, 0.45, p);
  if (body > 0.05) {
    const h = 22 * body;
    paint(
      frame,
      (x, y) => {
        const s = fromScreen(-angle, x, y);
        if (s.y > 0 || s.y < -h) return -1;
        const w = 6 * Math.sqrt(1 - Math.pow((s.y + h / 2) / (h / 2 + 0.01), 2));
        if (Math.abs(s.x) > w) return -1;
        return Math.abs(s.x) > w - 1 ? 0.45 : 0.2;
      },
      { bounds: { x0: -26, y0: -26, x1: 26, y1: 26 }, dither: 0 },
    );
  }
  const k = smoothstep(0.1, 0.5, p) * (1 - smoothstep(0.6, 1, p));
  if (k > 0.05) tendrils(frame, angle, p, 26 * k, 30, SHADOW.seed + 2);
  for (let i = 0; i < 8; i++) {
    const r = (m) => hash1(i * 3 + m, SHADOW.seed + 3);
    const c = fromScreen(angle, (r(1) - 0.5) * 26, -p * (20 + 16 * r(2)));
    if (p > 0.9) continue;
    dot(frame, c.x, c.y, r(3) > 0.5 ? 5 : 4);
  }
}

/** 背後に現れる（着いた所）: 水溜まりから影が噴き上がって体になり、敵の側（+x）へ影の爪の弧 */
function shadowRise(frame, f, info) {
  const frames = 8;
  const p = (f + 0.5) / frames;
  const angle = info?.angle ?? 0;
  const k = 1 - smoothstep(0.3, 0.9, p);
  if (k > 0.05) tendrils(frame, angle, p, 30 * k * (0.6 + 0.4 * smoothstep(0, 0.2, p)), 18, SHADOW.seed + 4);
  if (p > 0.15 && p < 0.75) {
    const q = smoothstep(0.15, 0.45, p);
    const erosion = smoothstep(0.45, 0.75, p) * 0.9;
    // 3 本の爪の弧（背面から斬りつける予告）
    for (let i = 0; i < 3; i++) crescent(frame, { ox: -6, oy: (i - 1) * 5, R: 24, T: 4, head: -0.9 + 1.8 * q, tail: -0.9, peak: 0.3, bright: 0.9, erosion, seed: SHADOW.seed + 5 + i, edge: 1, edgeReach: 0.5 });
  }
  if (p < 0.3) glint(frame, 0, 0, 2);
}

/** 影の筋（beam の 1 区間。着いた所 → 発った所）: 煙のような暗い帯が揺れて薄れる */
function shadowTrail(frame, f) {
  const frames = 7;
  const p = (f + 0.5) / frames;
  const half = SHADOW.trailStep + 0.6;
  const w = 3 * (1 - p) + 1;
  paint(
    frame,
    (x, y) => {
      if (Math.abs(x) > half) return -1;
      const d = Math.abs(y) / w;
      if (d > 1) return -1;
      const n = valueNoise(x + f * 3, y, 3, SHADOW.seed + 6);
      if (n < 0.4 + p * 0.45) return -1;
      return clamp01((0.5 - 0.25 * d) * (1 - p * 0.5));
    },
    { bounds: { x0: -half - 1, y0: -w - 1, x1: half + 1, y1: w + 1 }, dither: 0 },
  );
}

// -----------------------------------------------------------------------------
// 砕氷槌（iceBreaker）
// -----------------------------------------------------------------------------

const ICE = { radiusPx: 38, halfAngle: 0.7, shardPx: 44, seed: 7801 };
const ICE_R = ICE.radiusPx * 2;
const ICE_AT = ICE_R * 0.55;

/** 氷塊（角ばった粒: 明るい上面と暗い縁） */
function iceChunk(frame, x, y, s, level) {
  for (let dy = -s; dy <= s; dy += 0.5) {
    for (let dx = -s; dx <= s; dx += 0.5) {
      if (Math.abs(dx) + Math.abs(dy) > s * 1.2) continue;
      const edge = Math.abs(dx) + Math.abs(dy) > s * 0.8;
      dot(frame, x + dx, y + dy, edge ? Math.max(2, level - 3) : dy < 0 ? level : level - 1);
    }
  }
}

/** 槌の一撃（空中）: 槌の頭が振り下ろされ、打点に衝撃の星、扇の衝撃の弧、氷塊が前へ飛ぶ */
function iceSmash(frame, f) {
  const frames = 8;
  const p = (f + 0.5) / frames;
  if (f <= 1) {
    // 槌: 柄と、打点に横長の頭（f 0 はまだ高い = 少し大きい）
    const s = f === 0 ? 1.25 : 1;
    streakLine(frame, { ax: 6, ay: 0, bx: ICE_AT - 9 * s, by: 0, bright: 0.6, width: 3.5 });
    paint(
      frame,
      (x, y) => {
        const dx = Math.abs(x - ICE_AT) / (9 * s);
        const dy = Math.abs(y) / (16 * s);
        if (dx > 1 || dy > 1) return -1;
        if (dx > 0.75 || dy > 0.85) return 0.4;
        return x < ICE_AT ? 0.85 : 0.6;
      },
      { bounds: { x0: ICE_AT - 14, y0: -22, x1: ICE_AT + 14, y1: 22 }, dither: 0 },
    );
    if (f === 1) glint(frame, ICE_AT + 6, 0, 4);
    return;
  }
  const k = smoothstep(0.2, 0.7, p);
  const fade = 1 - smoothstep(0.4, 1, p);
  // 衝撃の星: 打点から尖った光が放射
  if (p < 0.6) {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU + 0.2;
      const len = (i % 2 === 0 ? 28 : 15) * (1 - p * 0.8);
      lens(frame, { ax: ICE_AT, ay: 0, bx: ICE_AT + Math.cos(a) * len, by: Math.sin(a) * len, T: 4.5, bright: 1, bias: 0 });
    }
  }
  arcLine(frame, { radius: ICE_AT * 0.4 + ICE_R * 0.7 * k, from: -ICE.halfAngle, to: ICE.halfAngle, width: 2.5, bright: 0.8 * fade });
  for (let i = 0; i < 14; i++) {
    const r = (m) => hash1(i * 5 + m, ICE.seed + 1);
    const a = (r(1) - 0.5) * 2 * ICE.halfAngle * 1.2;
    const speed = 6 + 7 * r(2);
    const age = f - 1;
    const travel = (1 - Math.pow(0.82, age)) / 0.18;
    const x = ICE_AT + Math.cos(a) * speed * travel;
    const y = Math.sin(a) * speed * travel - age * (1 - age / 8) * 1.5;
    if (age > 5 + 2 * r(3)) continue;
    iceChunk(frame, x, y, 2.5 + 2 * r(4), 7 - Math.floor(age / 2));
  }
}

/** 床の氷のひび（地面）: 打点から前と左右へぎざぎざの割れ目が走り、周りに霜が散る */
function iceCrack(frame, f) {
  const frames = 8;
  const p = (f + 0.5) / frames;
  if (f === 0) return;
  const grow = smoothstep(0.1, 0.45, p);
  const fade = 1 - smoothstep(0.6, 1, p);
  // 霜: 打点の周りに間引いた点
  paint(
    frame,
    (x, y) => {
      // 扇（槌の当たる範囲）の中だけ。4 ドットに 1 つ、さらに間引いて床を見せる
      const r = Math.hypot(x, y);
      if (r > ICE_R * grow || Math.abs(Math.atan2(y, x)) > ICE.halfAngle) return -1;
      if ((Math.floor(x) & 1) === 1 || (Math.floor(y) & 1) === 1) return -1;
      if (hash1(Math.floor(x) * 131 + Math.floor(y), ICE.seed + 2) > fade * 0.6) return -1;
      return 0.34;
    },
    { bounds: { x0: 0, y0: -ICE_R, x1: ICE_R, y1: ICE_R }, dither: 0 },
  );
  // 割れ目: 打点から放射に、節ごとに少し折れるぎざぎざの折れ線。先から消える
  for (let i = 0; i < 9; i++) {
    const base = (i / 9) * TAU + (hash1(i, ICE.seed + 3) - 0.5) * 0.4;
    const L = (22 + 26 * hash1(i, ICE.seed + 4)) * grow * (1 - 0.5 * (1 - fade));
    const pts = [{ x: ICE_AT, y: 0 }];
    for (let s = 1; s <= 5; s++) {
      const a = base + (hash1(i * 10 + s, ICE.seed + 5) - 0.5) * 0.8;
      const at = (L * s) / 5;
      pts.push({ x: ICE_AT + Math.cos(a) * at, y: Math.sin(a) * at });
    }
    polyline(frame, pts, 1.2, 0.8 * fade + 0.15);
  }
}

/** 凍った敵が砕ける: 結晶の柱の束が光り、角ばった破片が四方へ飛び、霜の輪が広がる */
function iceShatter(frame, f) {
  const frames = 8;
  const p = (f + 0.5) / frames;
  const R = ICE.shardPx * 2;
  if (f <= 1) {
    for (let i = 0; i < 3; i++) {
      const x = (i - 1) * 10;
      const h = i === 1 ? 32 : 22;
      lens(frame, { ax: x, ay: 8, bx: x + (i - 1) * 5, by: 8 - h, T: 12, bright: 0.9 + 0.2 * f, bias: 0.3 });
    }
    if (f === 1) glint(frame, 0, -6, 4);
    return;
  }
  const k = smoothstep(0.15, 1, p);
  const fade = 1 - smoothstep(0.5, 1, p);
  for (let i = 0; i < 16; i++) {
    const r = (m) => hash1(i * 7 + m, ICE.seed + 6);
    const a = (i / 16) * TAU + r(1) * 0.3;
    const at = 6 + R * (0.45 + 0.45 * r(2)) * k;
    const len = (9 + 8 * r(3)) * (0.4 + 0.6 * fade);
    const x = Math.cos(a) * at;
    const y = Math.sin(a) * at;
    if (fade <= 0.05 && r(4) < 0.5) continue;
    lens(frame, { ax: x - Math.cos(a) * len, ay: y - Math.sin(a) * len, bx: x, by: y, T: 5.5, bright: 0.6 + 0.45 * fade, bias: 0.4 });
  }
  ring(frame, { radius: R * (0.2 + 0.8 * k), width: 2.5, bright: 0.6 * fade, erosion: 0.3 + 0.5 * p, seed: ICE.seed + 7 });
  if (p < 0.35) glint(frame, 0, 0, 3);
}

// -----------------------------------------------------------------------------
// 血抜き（bloodlet）
// -----------------------------------------------------------------------------

const BLOOD = { radiusPx: 60, seed: 7901, streamStep: 10 };
const BLOOD_R = BLOOD.radiusPx * 2;

/** 血の輪（地面）: 範囲の縁に血の輪が張り、内向きの垂れを伸ばしながら縮んで消える */
function bloodRing(frame, f) {
  const frames = 8;
  const p = (f + 0.5) / frames;
  const rad = BLOOD_R * (1 - 0.35 * smoothstep(0.2, 1, p));
  const fade = 1 - smoothstep(0.5, 1, p);
  ring(frame, { radius: rad, width: 4, bright: 0.7 * fade + 0.1, erosion: 0.15 + 0.6 * p, seed: BLOOD.seed });
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * TAU + hash1(i, BLOOD.seed + 1) * 0.2;
    const len = (8 + 8 * hash1(i, BLOOD.seed + 2)) * smoothstep(0, 0.4, p);
    if (len < 1 || fade <= 0.05) continue;
    teardrop(frame, { x: Math.cos(a) * (rad - len), y: Math.sin(a) * (rad - len), a: a + Math.PI, len, w: 2.6, bright: 0.65 * fade + 0.15 });
  }
}

/** 吸い寄せ（空中）: 血の滴が範囲の中から中心（自分）へ吸われ、最後に中心で脈打つ */
function bloodPull(frame, f) {
  const frames = 8;
  const p = (f + 0.5) / frames;
  for (let i = 0; i < 20; i++) {
    const r = (m) => hash1(i * 5 + m, BLOOD.seed + 3);
    const a = r(1) * TAU;
    const start = BLOOD_R * (0.45 + 0.55 * r(2));
    const q = clamp01(p * 1.3 - r(3) * 0.3);
    const at = start * (1 - smoothstep(0, 1, q)) + 8;
    if (q >= 0.98) continue;
    teardrop(frame, { x: Math.cos(a) * at, y: Math.sin(a) * at, a: a + Math.PI, len: 4 + 6 * q, w: 1.8, bright: 0.85 });
  }
  if (p > 0.6) {
    ring(frame, { radius: 6 + 10 * (p - 0.6), width: 2, bright: 0.8 * (1 - p) + 0.2 });
    glint(frame, 0, 0, p > 0.8 ? 2 : 3);
  }
}

/** 傷から噴く（出血した敵）: 自分へ向かう向き（+x）へ血の滴が扇に噴き、小さなしぶきの輪 */
function bloodSpurt(frame, f) {
  const frames = 7;
  const p = (f + 0.5) / frames;
  const fade = 1 - smoothstep(0.4, 1, p);
  for (let i = 0; i < 5; i++) {
    const a = (i - 2) * 0.28;
    const at = 4 + 18 * smoothstep(0, 0.7, p) * (0.7 + 0.3 * hash1(i, BLOOD.seed + 4));
    if (fade <= 0.05) continue;
    teardrop(frame, { x: Math.cos(a) * at, y: Math.sin(a) * at, a, len: 5, w: 1.8, bright: 0.9 * fade + 0.1 });
  }
  ring(frame, { radius: 3 + 8 * p, width: 1.5, squash: 0.6, bright: 0.6 * fade });
}

/** 血の流れ（beam の 1 区間。敵 → 自分）: 細い赤い筋の上を、滴が自分の方（+x）へ流れる */
function bloodStream(frame, f) {
  const frames = 7;
  const p = (f + 0.5) / frames;
  const len = BLOOD.streamStep * 2;
  const fade = 1 - smoothstep(0.55, 1, p);
  for (let x = -BLOOD.streamStep; x < BLOOD.streamStep; x += 0.5) dot(frame, x, 0, fade > 0.4 ? 3 : 2);
  for (let k = 0; k < 2; k++) {
    const u = (k * 0.5 + p * 1.5) % 1;
    const x = -BLOOD.streamStep + u * len;
    if (fade <= 0.05) continue;
    teardrop(frame, { x, y: Math.sin(u * TAU) * 1.2, a: 0, len: 6, w: 2, bright: 0.9 * fade + 0.1 });
  }
}

/** 取り込む（自分の所）: 滴が集まって縮む輪と光 */
function bloodAbsorb(frame, f) {
  const frames = 7;
  const p = (f + 0.5) / frames;
  const fade = 1 - smoothstep(0.5, 1, p);
  ring(frame, { radius: 14 * (1 - p) + 2, width: 2, bright: 0.75 * fade + 0.1 });
  for (let i = 0; i < 4; i++) {
    const a = Math.PI + (i - 1.5) * 0.6;
    const at = 12 * (1 - p) + 2;
    if (fade <= 0.05) continue;
    teardrop(frame, { x: Math.cos(a) * at, y: Math.sin(a) * at, a: a + Math.PI, len: 3, w: 1.4, bright: 0.8 });
  }
  if (p > 0.3 && p < 0.8) glint(frame, 0, 0, 2);
}

// -----------------------------------------------------------------------------
// 毒の収穫（harvest）
// -----------------------------------------------------------------------------

const HARVEST_SEED = 8001;

/** 回る鎌（飛んでいる間）: 小さな鎌の刃と柄が回り、後ろへ毒の滴が垂れる */
function harvestSickle(frame, f) {
  const frames = 8;
  const s = -(f / frames) * TAU;
  crescent(frame, { R: 11, T: 5, head: s, tail: s - 2.3, peak: 0.15, bright: 1, streak: 0.2, edge: 1.2, edgeReach: 0.7, seed: HARVEST_SEED });
  // 柄: 刃の尾の根元から中心を通って反対へ
  const ha = s - 2.3;
  streakLine(frame, { ax: Math.cos(ha) * 9, ay: Math.sin(ha) * 9, bx: Math.cos(ha + Math.PI) * 6, by: Math.sin(ha + Math.PI) * 6, bright: 0.5, width: 1.5 });
  for (let i = 0; i < 3; i++) {
    const x = -12 - i * 5;
    const y = Math.sin(f * 0.8 + i * 2) * 1.5;
    disc(frame, x, y, 1.6 - i * 0.3, 0.7 - i * 0.12);
  }
}

/** 刈り取り（毒を消した命中）: 大鎌が敵を横切って振り抜け、毒の泡が体から抜けて立ち昇って弾ける */
function harvestReap(frame, f, info) {
  const frames = 9;
  const p = (f + 0.5) / frames;
  const angle = info?.angle ?? 0;
  const q = Math.min(1, (f + 1) / 4);
  const head = -1.2 + 2.4 * easeSwing(q);
  const tail = Math.max(-1.2, head - 1.6 + (f >= 4 ? (f - 3) * 0.35 : 0));
  const erosion = f >= 4 ? smoothstep(4, frames, f + 1) * 0.9 : 0;
  crescent(frame, { ox: -22, R: 40, T: 13, head, tail, peak: 0.1, bright: 1.05, erosion, streak: 0.5, seed: HARVEST_SEED + 1, edge: 1.8, edgeReach: 0.6 });
  if (f === 3) glint(frame, -22 + Math.cos(head) * 38, Math.sin(head) * 38, 3);
  // 毒の泡: 体（原点）から画面の上へ
  for (let i = 0; i < 8; i++) {
    const r = (m) => hash1(i * 5 + m, HARVEST_SEED + 2);
    const born = r(1) * 0.4;
    const t = p - born;
    if (t < 0 || t > 0.55) continue;
    const c = fromScreen(angle, (r(2) - 0.5) * 16 + Math.sin(t * 12 + i) * 2, -4 - t * 44);
    const rad = 1.5 + 2.2 * r(3) + t * 3;
    if (t > 0.48) {
      glint(frame, c.x, c.y, 2);
      continue;
    }
    ring(frame, { ox: c.x, oy: c.y, radius: rad, width: 1.2, bright: 0.8 });
    dot(frame, c.x - rad * 0.4, c.y - rad * 0.4, 7);
  }
}

// -----------------------------------------------------------------------------
// 放電（discharge）
// -----------------------------------------------------------------------------

const SHOCK = { seed: 8101, boltStep: 12 };

/** ジグザグの稲妻（a → b）。段の数 n、振れ幅 amp。端は必ず a と b を通る */
function bolt(frame, ax, ay, bx, by, n, amp, seed, width, bright) {
  const pts = [];
  const nx = -(by - ay);
  const ny = bx - ax;
  const nl = Math.hypot(nx, ny) || 1;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const off = i === 0 || i === n ? 0 : (hash1(i, seed) - 0.5) * 2 * amp;
    pts.push({ x: ax + (bx - ax) * t + (nx / nl) * off, y: ay + (by - ay) * t + (ny / nl) * off });
  }
  polyline(frame, pts, width + 2.5, bright * 0.45);
  polyline(frame, pts, width, bright);
  return pts;
}

/** 火花（感電していた敵）: 短い稲妻が四方へ弾け、白い閃き */
function dischargeSpark(frame, f) {
  const frames = 7;
  const p = (f + 0.5) / frames;
  const fade = 1 - smoothstep(0.3, 1, p);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + hash1(i + f * 7, SHOCK.seed) * 0.6;
    const len = 8 + 10 * p;
    if (fade <= 0.05) continue;
    bolt(frame, Math.cos(a) * 3, Math.sin(a) * 3, Math.cos(a) * len, Math.sin(a) * len, 3, 2, SHOCK.seed + i * 13 + f, 1, 0.95 * fade);
  }
  if (p < 0.4) glint(frame, 0, 0, 4);
  ring(frame, { radius: 3 + 12 * p, width: 1.5, bright: 0.6 * fade });
}

/** 稲妻（beam の 1 区間。敵 → 自分）: 端が必ず中心を通るジグザグ。コマごとに形が変わってちらつく */
function dischargeBolt(frame, f) {
  const frames = 6;
  const p = (f + 0.5) / frames;
  const half = SHOCK.boltStep;
  const bright = 1 - 0.5 * smoothstep(0.4, 1, p);
  const pts = bolt(frame, -half - 0.6, 0, half + 0.6, 0, 4, 4.5 * (1 - 0.4 * p), SHOCK.seed + 40 + f * 17, p > 0.7 ? 1 : 1.5, bright);
  // 枝: 途中から短く分かれる
  const mid = pts[2];
  if (mid && hash1(f, SHOCK.seed + 5) > 0.35 && p < 0.8) {
    const side = hash1(f, SHOCK.seed + 6) > 0.5 ? 1 : -1;
    bolt(frame, mid.x, mid.y, mid.x + 5, mid.y + side * 7, 2, 1.5, SHOCK.seed + 60 + f, 1, bright * 0.8);
  }
}

/** 手元にまとまる（自分）: 周りから短い稲妻が寄り、光の玉になって消える */
function dischargeGather(frame, f) {
  const frames = 7;
  const p = (f + 0.5) / frames;
  const fade = 1 - smoothstep(0.5, 1, p);
  const rad = 3 + 4 * smoothstep(0, 0.5, p) * fade;
  disc(frame, 0, 0, rad, (d) => clamp01(1.05 - 0.5 * d));
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + 0.5 + f * 0.4;
    const far = 18 * (1 - p) + 6;
    if (fade <= 0.05) continue;
    bolt(frame, Math.cos(a) * far, Math.sin(a) * far, Math.cos(a) * rad, Math.sin(a) * rad, 3, 2, SHOCK.seed + 80 + i + f * 5, 1, 0.9 * fade);
  }
  if (p > 0.2 && p < 0.6) glint(frame, 0, 0, 3);
}

// -----------------------------------------------------------------------------
// 追い討ち（rout）
// -----------------------------------------------------------------------------

const ROUT_SEED = 8201;

/** 短刀（飛んでいる間）: 刃・鍔・柄・柄頭。後ろへ速度線 */
function routDagger(frame, f) {
  lens(frame, { ax: -1, ay: 0, bx: 14, by: 0, T: 4.2, bright: 1.05, bias: 0.3 });
  streakLine(frame, { ax: -1.5, ay: -3.5, bx: -1.5, by: 3.5, bright: 0.7, width: 1.5 });
  streakLine(frame, { ax: -7, ay: 0, bx: -2, by: 0, bright: 0.45, width: 2 });
  dot(frame, -8, 0, 5);
  dot(frame, -8.5, -0.5, 4);
  for (let i = 0; i < 3; i++) {
    const len = 10 + ((f + i * 2) % 4) * 3;
    streakLine(frame, { ax: -10 - len, ay: (i - 1) * 2.5, bx: -10, by: (i - 1) * 1.5, bright: 0.55 });
  }
  if (f % 2 === 0) glint(frame, 12, -1, 2);
}

/** 恐怖を打ち砕く（恐怖した敵への命中）: 3 本の短刀の斬線が順に交差し、暗い恐怖の輪が割れ、衝撃の星 */
function routBreak(frame, f) {
  const frames = 8;
  const p = (f + 0.5) / frames;
  for (let i = 0; i < 3; i++) {
    const born = i;
    const age = f - born;
    if (age < 0 || age > 4) continue;
    const a = (i - 1) * 0.45;
    const L = 22;
    lens(frame, { ax: -Math.cos(a) * L, ay: -Math.sin(a) * L, bx: Math.cos(a) * L, by: Math.sin(a) * L, T: 5, grow: Math.min(1, (age + 1) / 2), erosion: smoothstep(1, 4, age), bright: 1.05, seed: ROUT_SEED + i });
  }
  // 恐怖の輪: 暗い輪が割れて破片が外へ
  const k = smoothstep(0.2, 0.9, p);
  ring(frame, { radius: 12 + 12 * k, width: 3, bright: 0.35, erosion: 0.2 + 0.7 * k, seed: ROUT_SEED + 5 });
  if (f >= 2 && f <= 4) {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      const len = f === 3 ? 14 : 9;
      lens(frame, { ax: 0, ay: 0, bx: Math.cos(a) * len, by: Math.sin(a) * len, T: 2.5, bright: 1, bias: 0 });
    }
    glint(frame, 0, 0, 4);
  }
  shards(frame, f - 2, 12, ROUT_SEED + 6, (i, r) => {
    const a = r(1) * TAU;
    return { x: Math.cos(a) * 12, y: Math.sin(a) * 12, vx: Math.cos(a) * (2 + 3 * r(2)), vy: Math.sin(a) * (2 + 3 * r(2)), life: 4, size: 2 };
  });
}

// -----------------------------------------------------------------------------
// 処断（verdict）
// -----------------------------------------------------------------------------

const VERDICT = { radiusPx: 36, halfAngle: 0.55, seed: 8301 };
const VERDICT_R = VERDICT.radiusPx * 2;

/** 天秤の紋（画面に揃える） */
const SCALES = doubled([
  "......7......",
  ".5555575555..",
  ".6....6....6.",
  "5.5...6...5.5",
  "5..5..6..5..5",
  "55555.6.55555",
  ".444..6..444.",
  "......6......",
  "....66666....",
]);

/** 裁きの太刀（空中）: 前方の扇を太い光の太刀筋が一息に払い、「断」の縦の一閃が交わり、上に天秤の紋が浮かぶ */
function verdictSlash(frame, f, info) {
  const frames = 8;
  const p = (f + 0.5) / frames;
  const angle = info?.angle ?? 0;
  const from = -VERDICT.halfAngle - 0.1;
  const sweep = (VERDICT.halfAngle + 0.1) * 2;
  const q = Math.min(1, (f + 1) / 2.5);
  const head = from + sweep * easeSwing(q);
  const erosion = f >= 3 ? smoothstep(3, frames, f + 1) * 0.9 : 0;
  crescent(frame, { R: VERDICT_R, T: 16, head, tail: from, peak: 0.25, bright: 1.1, erosion, streak: 0.3, seed: VERDICT.seed, edge: 2, edgeReach: 0.8 });
  const cx = VERDICT_R * 0.62;
  if (f >= 1) {
    const grow = Math.min(1, f / 2);
    lens(frame, { ax: cx, ay: -VERDICT_R * 0.5, bx: cx, by: VERDICT_R * 0.5, T: 6, grow, erosion: f >= 4 ? smoothstep(4, frames, f + 1) : 0, bright: 1.1, seed: VERDICT.seed + 1, bias: 0 });
  }
  if (f === 2) glint(frame, cx, 0, 4);
  if (f >= 1 && f <= 6) {
    const up = fromScreen(angle, 0, -26 - f);
    stamp(frame, cx + up.x, up.y, SCALES);
  }
}

/** 裁きの印（地面）: 扇の中心に円と十字の印が灯って消える */
function verdictSeal(frame, f) {
  const frames = 8;
  const p = (f + 0.5) / frames;
  const cx = VERDICT_R * 0.62;
  const fade = 1 - smoothstep(0.4, 1, p);
  const r = 14 + 8 * smoothstep(0, 0.4, p);
  ring(frame, { ox: cx, radius: r, width: 2, bright: 0.55 * fade + 0.1, erosion: 0.1 + 0.5 * p, seed: VERDICT.seed + 2 });
  ring(frame, { ox: cx, radius: r * 0.6, width: 1.2, bright: 0.45 * fade, erosion: 0.3 + 0.4 * p, seed: VERDICT.seed + 3 });
  if (fade > 0.1) {
    streakLine(frame, { ax: cx - r, ay: 0, bx: cx + r, by: 0, bright: 0.45 * fade });
    streakLine(frame, { ax: cx, ay: -r, bx: cx, by: r, bright: 0.45 * fade });
  }
}

/** 天の光の柱（沈黙を消した敵）: 細い光が天から落ち、着いた所で太い柱になって、足元に光の輪が広がる */
function verdictPillar(frame, f) {
  const frames = 8;
  const p = (f + 0.5) / frames;
  const H = 80;
  const fall = Math.min(1, (f + 1) / 2);
  const bottom = -H + H * fall;
  const wide = f >= 2 ? 7 * (1 - smoothstep(0.3, 1, p)) + 1 : 1.5;
  paint(
    frame,
    (x, y) => {
      if (y < -H || y > bottom) return -1;
      const d = Math.abs(x) / wide;
      if (d > 1) return -1;
      const top = clamp01((y + H) / 20);
      if (d < 0.35) return clamp01(1.05 * top);
      return clamp01((0.75 - 0.35 * d) * top * (Math.floor(y / 3) % 3 === 0 ? 1.1 : 1));
    },
    { bounds: { x0: -12, y0: -H - 1, x1: 12, y1: 2 }, dither: 0 },
  );
  if (f >= 2) {
    const k = smoothstep(0.2, 1, p);
    flatRing(frame, { radius: 8 + 16 * k, width: 2.5, squash: 0.45, bright: 0.8 * (1 - k) + 0.1 });
    if (f <= 3) glint(frame, 0, 0, 4);
    for (let i = 0; i < 6; i++) {
      const x = (hash1(i, VERDICT.seed + 4) - 0.5) * 22;
      const y = -((p - 0.25) * 60 * (0.5 + 0.5 * hash1(i, VERDICT.seed + 5)));
      if (y > 0) continue;
      dot(frame, x, y, 6);
    }
  }
}

// -----------------------------------------------------------------------------
// 刺し穿ち（exploit）
// -----------------------------------------------------------------------------

const EXPLOIT = { lengthPx: 38, seed: 8401 };
const EXPLOIT_L = EXPLOIT.lengthPx * 2;

/** 刺突（空中）: 細く鋭い光の突きが一瞬で伸び、先端で V 字の衝撃と光点。残像の細線が残る */
function exploitThrust(frame, f) {
  const frames = 7;
  const p = (f + 0.5) / frames;
  const grow = Math.min(1, (f + 1) / 2);
  const erosion = f >= 3 ? smoothstep(3, frames, f + 1) * 0.85 : 0;
  lens(frame, { ax: 6, ay: 0, bx: EXPLOIT_L, by: 0, T: 5, grow, erosion, bright: 1.1, seed: EXPLOIT.seed, bias: 0 });
  if (f >= 1) {
    const fade = 1 - smoothstep(0.3, 1, p);
    for (const s of [-1, 1]) streakLine(frame, { ax: EXPLOIT_L - 12, ay: s * 7 * (1 + p), bx: EXPLOIT_L - 2, by: s * 1.5, bright: 0.85 * fade });
    if (f <= 2) glint(frame, EXPLOIT_L, 0, f === 1 ? 4 : 3);
    if (f >= 3) streakLine(frame, { ax: 4, ay: 0, bx: EXPLOIT_L * (1 - 0.3 * p), by: 0, bright: 0.45 * fade });
  }
}

/** 会心の貫き（脆弱を消した命中）: 十字の強い光、殻（脆弱）の輪が割れて欠片が散り、背中側（+x）へ抜ける光 */
function exploitPierce(frame, f) {
  const frames = 8;
  const p = (f + 0.5) / frames;
  const fade = 1 - smoothstep(0.3, 1, p);
  if (f <= 4) {
    const s = f <= 1 ? 1 : 1 - (f - 1) * 0.22;
    lens(frame, { ax: -18 * s, ay: 0, bx: 32 * s, by: 0, T: 6 * s, bright: 1.1, bias: 0 });
    lens(frame, { ax: 0, ay: -16 * s, bx: 0, by: 16 * s, T: 4 * s, bright: 1, bias: 0 });
  }
  if (f <= 2) glint(frame, 0, 0, 4);
  const k = smoothstep(0.1, 0.8, p);
  ring(frame, { radius: 10 + 8 * k, width: 2.5, bright: 0.65 * fade + 0.1, erosion: 0.25 + 0.6 * k, seed: EXPLOIT.seed + 1 });
  shards(frame, f - 1, 12, EXPLOIT.seed + 2, (i, r) => {
    const a = r(1) * TAU;
    return { x: Math.cos(a) * 10, y: Math.sin(a) * 10, vx: Math.cos(a) * (2 + 3 * r(2)) + 1.5, vy: Math.sin(a) * (2 + 3 * r(2)), life: 4 + Math.floor(2 * r(3)), size: 2 };
  });
}

// -----------------------------------------------------------------------------
// 剥奪（strip）
// -----------------------------------------------------------------------------

const STRIP = { seed: 8451, drainStep: 10 };

/** 3 本の鉤爪（開き open 0..1。1 で大きく開く）。原点の少し後ろが手の甲 */
function talons(frame, open, bright) {
  for (let s = -1; s <= 1; s++) {
    const spread = s * (2 + 5 * open);
    const pts = [
      { x: -2, y: s * 2 },
      { x: 5, y: spread },
      { x: 11, y: spread * (0.9 + 0.2 * open) },
      { x: 13, y: spread * 0.5 - s * 1.5 * (1 - open) },
    ];
    polyline(frame, pts, s === 0 ? 2 : 1.5, bright);
    dot(frame, pts[3].x, pts[3].y, 7);
  }
}

/** 奪う手（飛んでいる間）: 開いた鉤爪の手が伸び、後ろへ暗い靄の尾 */
function stripHook(frame, f) {
  const frames = 6;
  const open = 0.6 + 0.4 * Math.sin((f / frames) * TAU);
  disc(frame, -4, 0, 3.5, (d) => (d > 0.7 ? 0.5 : 0.75));
  talons(frame, open, 0.95);
  for (let x = -8; x > -26; x -= 0.5) {
    const t = -(x + 8) / 18;
    const y = Math.sin(x * 0.4 + f * 1.05) * (1 + 2 * t);
    dot(frame, x, y, t < 0.4 ? 5 : t < 0.75 ? 4 : 3);
  }
}

/** 掴み取る（弱体を奪った敵）: 爪が閉じて暗い靄の塊を握り、引き抜くと輪が縮んで欠片が散る */
function stripSnatch(frame, f) {
  const frames = 7;
  const p = (f + 0.5) / frames;
  const fade = 1 - smoothstep(0.5, 1, p);
  const close = smoothstep(0, 0.4, p);
  // 引き抜く: 手は敵（原点）から自分の向き（+x）へ動く
  const pull = smoothstep(0.35, 1, p) * 14;
  const hand = Object.create(frame);
  hand.toCanon = (gx, gy) => {
    const c = frame.toCanon(gx, gy);
    return { x: c.x + 6 - pull, y: c.y };
  };
  hand.toGrid = (x, y) => frame.toGrid(x - 6 + pull, y);
  talons(hand, 1 - close, 0.9 * fade + 0.1);
  disc(frame, 4 + pull, 0, 4 * (0.6 + 0.4 * close) * (0.4 + 0.6 * fade), (d) => (d > 0.6 ? 0.4 : 0.62));
  ring(frame, { radius: 16 * (1 - close) + 4, width: 2, bright: 0.6 * fade });
  shards(frame, f - 2, 8, STRIP.seed, (i, r) => {
    const a = r(1) * TAU;
    return { x: Math.cos(a) * 5, y: Math.sin(a) * 5, vx: Math.cos(a) * (1.5 + 2 * r(2)) + 1, vy: Math.sin(a) * (1.5 + 2 * r(2)), life: 4 };
  });
}

/** 奪った力の流れ（beam の 1 区間。敵 → 自分）: 2 本の靄の筋が撚り合って自分の方（+x）へ流れる */
function stripDrain(frame, f) {
  const frames = 7;
  const p = (f + 0.5) / frames;
  const len = STRIP.drainStep * 2;
  const fade = 1 - smoothstep(0.5, 1, p);
  const amp = 3 * (1 - 0.5 * p);
  for (let x = -STRIP.drainStep; x < STRIP.drainStep; x += 0.5) {
    const ph = ((x + STRIP.drainStep) / len) * TAU - p * TAU * 1.5;
    const a = Math.sin(ph) * amp;
    dot(frame, x, a, Math.cos(ph) > 0 ? (fade > 0.4 ? 6 : 4) : 3);
    dot(frame, x, -a, Math.cos(ph) < 0 ? (fade > 0.4 ? 6 : 4) : 3);
  }
}

/** 上向きの山形（画面に揃える。与ダメが上がる印） */
const CHEVRON = ["...7...", "..676..", ".6...6.", "5.....5"];

/** 力を得る（自分）: 流れ込んだ靄が輪になって縮み、上向きの山形が 3 つ昇る */
function stripGain(frame, f, info) {
  const frames = 7;
  const p = (f + 0.5) / frames;
  const angle = info?.angle ?? 0;
  const fade = 1 - smoothstep(0.55, 1, p);
  ring(frame, { radius: 14 * (1 - p) + 3, width: 2, bright: 0.7 * fade + 0.1 });
  for (let i = 0; i < 3; i++) {
    const t = p - i * 0.15;
    if (t < 0 || t > 0.8) continue;
    const c = fromScreen(angle, (i - 1) * 8, -6 - t * 26);
    stamp(frame, c.x, c.y, CHEVRON);
  }
}

// -----------------------------------------------------------------------------
// 背水の一閃（lastStand）
// -----------------------------------------------------------------------------

const LAST = { lengthPx: 46, seed: 8501 };
const LAST_L = LAST.lengthPx * 2;

/** 一閃（空中）: 細い光の線が一瞬走り、太いレンズの閃きに膨らみ、上下に残像を残して細る。刃から火花が横へ散る */
function lastFlash(frame, f) {
  const frames = 8;
  const p = (f + 0.5) / frames;
  if (f === 0) {
    streakLine(frame, { ax: 4, ay: 0, bx: LAST_L, by: 0, bright: 1, width: 1.5 });
    glint(frame, LAST_L, 0, 3);
    return;
  }
  const T = f <= 2 ? 13 : 13 * (1 - smoothstep(2, frames, f));
  const erosion = f >= 3 ? smoothstep(3, frames, f + 1) * 0.85 : 0;
  lens(frame, { ax: 4, ay: 0, bx: LAST_L, by: 0, T: Math.max(2, T), erosion, bright: 1.15, seed: LAST.seed, bias: 0 });
  if (f >= 2) {
    const off = 3 + (f - 2) * 1.5;
    for (const s of [-1, 1]) lens(frame, { ax: 10, ay: s * off, bx: LAST_L - 8, by: s * off, T: 3, erosion: 0.3 + erosion, bright: 0.55, seed: LAST.seed + 1 + s, bias: 0 });
  }
  if (f === 1) glint(frame, LAST_L, 0, 4);
  shards(frame, f - 1, 14, LAST.seed + 3, (i, r) => ({ x: 10 + (LAST_L - 10) * r(1), y: 0, vx: 0.5, vy: (r(2) > 0.5 ? 1 : -1) * (2 + 3 * r(3)), life: 3 + Math.floor(3 * r(4)) }));
  void p;
}

/** 背水（地面）: 背後（-x）の足元に水の波紋が半円に広がり、しぶきが後ろへ跳ねる */
function lastWater(frame, f) {
  const frames = 8;
  const p = (f + 0.5) / frames;
  const fade = 1 - smoothstep(0.4, 1, p);
  for (let i = 0; i < 3; i++) {
    const r = 6 + i * 7 + p * 16;
    flatRing(frame, { ox: -6, radius: r, width: 1.8, squash: 0.55, bright: (0.65 - i * 0.12) * fade + 0.08, from: Math.PI / 2, to: Math.PI });
    flatRing(frame, { ox: -6, radius: r, width: 1.8, squash: 0.55, bright: (0.65 - i * 0.12) * fade + 0.08, from: -Math.PI, to: -Math.PI / 2 });
  }
  shards(frame, f, 10, LAST.seed + 4, (i, r) => ({ x: -8, y: (r(1) - 0.5) * 10, vx: -(1.5 + 3 * r(2)), vy: (r(3) - 0.5) * 3 - 1.5, life: 3 + Math.floor(3 * r(4)) }));
}

// -----------------------------------------------------------------------------
// 表
// -----------------------------------------------------------------------------

const FX = {
  skills: {
    contagion: {
      ramp: "poison",
      // cast: pos = 写し元の敵。act: pos = 写し元、to = 写し先（胞子の筋を並べ、写し先に斑点）
      cast: { sheet: "skillExtraA.contagionSpores", life: 0.45, base: CONTAGION.radiusPx, ground: "skillExtraA.contagionBloom" },
      act: { sheet: "skillExtraA.contagionMark", life: 0.4, base: 0, pivot: "to", beam: { sheet: "skillExtraA.contagionTrail", step: CONTAGION.trailStep } },
    },
    unravel: {
      ramp: "dark",
      fly: { sheet: "skillExtraA.unravelNeedle", base: 0, period: 0.3 },
      act: { sheet: "skillExtraA.unravelFray", life: 0.4, base: 0 },
    },
    kindle: {
      ramp: "fire",
      cast: { sheet: "skillExtraA.kindleFlint", life: 0.35, base: KINDLE.radiusPx },
      act: { sheet: "skillExtraA.kindleBurst", life: 0.45, base: KINDLE.burstPx, ground: "skillExtraA.kindleScorch" },
    },
    iceBreaker: {
      ramp: "ice",
      // act: pos = 自分（扇の根元）。end: 凍った敵が砕けた所（size = 破片の半径）
      act: { sheet: "skillExtraA.iceSmash", life: 0.4, base: ICE.radiusPx, ground: "skillExtraA.iceCrack" },
      end: { sheet: "skillExtraA.iceShatter", life: 0.4, base: ICE.shardPx },
    },
    bloodlet: {
      ramp: "dark",
      // cast: pos = 自分。act: pos = 出血していた敵、to = 自分（血の流れを並べ、自分の所で取り込む）
      cast: { sheet: "skillExtraA.bloodPull", life: 0.4, base: BLOOD.radiusPx, ground: "skillExtraA.bloodRing" },
      act: { sheet: "skillExtraA.bloodSpurt", life: 0.35, base: 0, beam: { sheet: "skillExtraA.bloodStream", step: BLOOD.streamStep }, tip: "skillExtraA.bloodAbsorb" },
    },
    harvest: {
      ramp: "poison",
      fly: { sheet: "skillExtraA.harvestSickle", base: 0, period: 0.25 },
      act: { sheet: "skillExtraA.harvestReap", life: 0.45, base: 0 },
    },
    discharge: {
      ramp: "lightning",
      // act: pos = 感電していた敵、to = 自分（稲妻を並べ、手元にまとまる）
      act: { sheet: "skillExtraA.dischargeSpark", life: 0.3, base: 0, beam: { sheet: "skillExtraA.dischargeBolt", step: SHOCK.boltStep }, tip: "skillExtraA.dischargeGather" },
    },
    rout: {
      ramp: "steel",
      fly: { sheet: "skillExtraA.routDagger", base: 0, period: 0.16 },
      act: { sheet: "skillExtraA.routBreak", life: 0.4, base: 0 },
    },
    verdict: {
      ramp: "light",
      // act: pos = 自分（扇の根元）。end: 沈黙を消した敵
      act: { sheet: "skillExtraA.verdictSlash", life: 0.4, base: VERDICT.radiusPx, ground: "skillExtraA.verdictSeal" },
      end: { sheet: "skillExtraA.verdictPillar", life: 0.45, base: 0 },
    },
    exploit: {
      ramp: "steel",
      // act: pos = 自分、size = 実際の突きの長さ（壁で縮む）。end: 脆弱を消した敵
      act: { sheet: "skillExtraA.exploitThrust", life: 0.28, base: EXPLOIT.lengthPx },
      end: { sheet: "skillExtraA.exploitPierce", life: 0.36, base: 0 },
    },
    strip: {
      ramp: "dark",
      fly: { sheet: "skillExtraA.stripHook", base: 0, period: 0.3 },
      // act: pos = 弱体を奪った敵、to = 自分（奪った力の流れを並べ、自分の所で力を得る）
      act: { sheet: "skillExtraA.stripSnatch", life: 0.4, base: 0, beam: { sheet: "skillExtraA.stripDrain", step: STRIP.drainStep }, tip: "skillExtraA.stripGain" },
    },
    lastStand: {
      ramp: "steel",
      act: { sheet: "skillExtraA.lastFlash", life: 0.36, base: LAST.lengthPx, ground: "skillExtraA.lastWater" },
    },
  },
};

const sheet = (name, dirs, frames, size, draw) => ({ key: `skillExtraA.${name}`, dirs, frames, active: 0, size, draw });

export const ATLAS = {
  key: "skillExtraA",
  fx: FX,
  sheets: [
    sheet("contagionBloom", 1, 8, sizeOf(CONTAGION_R, 10), contagionBloom),
    sheet("contagionSpores", 1, 8, sizeOf(CONTAGION_R, 12), contagionSpores),
    sheet("contagionTrail", 1, 7, 48, contagionTrail),
    sheet("contagionMark", 1, 8, 64, contagionMark),
    sheet("unravelNeedle", DIRS, 6, 80, unravelNeedle),
    sheet("unravelFray", DIRS, 8, 104, unravelFray),
    sheet("kindleFlint", 1, 8, sizeOf(KINDLE.radiusPx * 2, 10), kindleFlint),
    sheet("kindleBurst", 1, 9, sizeOf(KINDLE.burstPx * 2, 24), kindleBurst),
    sheet("kindleScorch", 1, 9, sizeOf(KINDLE.burstPx * 2, 4), kindleScorch),
    sheet("prismSplit", DIRS, 7, 144, prismSplit),
    sheet("prismShot", DIRS, 6, 64, prismShot),
    sheet("moonMuzzle", DIRS, 8, 120, moonMuzzle),
    sheet("moonBeam", 1, 7, 64, moonBeam),
    sheet("moonTip", DIRS, 7, 88, moonTip),
    { ...sheet("dregsSlashes", DIRS, DREGS.hits * DREGS.perHit, sizeOf(DREGS.radiusPx * 2, 12), dregsSlashes), active: DREGS.hits * DREGS.perHit },
    sheet("shadowPool", 1, 8, 64, shadowPool),
    sheet("shadowSink", 1, 8, 80, shadowSink),
    sheet("shadowRise", DIRS, 8, 96, shadowRise),
    sheet("shadowTrail", 1, 7, 48, shadowTrail),
    sheet("iceSmash", DIRS, 8, sizeOf(ICE_R, 24), iceSmash),
    sheet("iceCrack", DIRS, 8, sizeOf(ICE_R, 8), iceCrack),
    sheet("iceShatter", 1, 8, sizeOf(ICE.shardPx * 2, 12), iceShatter),
    sheet("bloodRing", 1, 8, sizeOf(BLOOD_R, 6), bloodRing),
    sheet("bloodPull", 1, 8, sizeOf(BLOOD_R, 4), bloodPull),
    sheet("bloodSpurt", DIRS, 7, 64, bloodSpurt),
    sheet("bloodStream", 1, 7, 48, bloodStream),
    sheet("bloodAbsorb", DIRS, 7, 48, bloodAbsorb),
    sheet("harvestSickle", DIRS, 8, 64, harvestSickle),
    sheet("harvestReap", DIRS, 9, 144, harvestReap),
    sheet("dischargeSpark", 1, 7, 64, dischargeSpark),
    sheet("dischargeBolt", 1, 6, 48, dischargeBolt),
    sheet("dischargeGather", DIRS, 7, 64, dischargeGather),
    sheet("routDagger", DIRS, 4, 64, routDagger),
    sheet("routBreak", DIRS, 8, 96, routBreak),
    sheet("verdictSlash", DIRS, 8, sizeOf(VERDICT_R, 20), verdictSlash),
    sheet("verdictSeal", DIRS, 8, sizeOf(VERDICT_R, 4), verdictSeal),
    sheet("verdictPillar", 1, 8, 184, verdictPillar),
    sheet("exploitThrust", DIRS, 7, sizeOf(EXPLOIT_L, 14), exploitThrust),
    sheet("exploitPierce", DIRS, 8, 104, exploitPierce),
    sheet("stripHook", DIRS, 6, 72, stripHook),
    sheet("stripSnatch", DIRS, 7, 80, stripSnatch),
    sheet("stripDrain", 1, 7, 48, stripDrain),
    sheet("stripGain", DIRS, 7, 88, stripGain),
    sheet("lastFlash", DIRS, 8, sizeOf(LAST_L, 14), lastFlash),
    sheet("lastWater", DIRS, 8, 88, lastWater),
  ],
};
