// スキル石: 基本スキル（docs/ideas/fx-sprites.md 10 章）。単位は絵のドット（論理 0.5px）。正準の向きは +x（撃つ・構える向き）
// 絵の大きさはスキルの数値（src/data/balance/skills/SKILL/）の半径 × 2 ドットで描き、表の base にその半径（px）を書く
//
// グレネード（frag）「導火線付きの手榴弾を投げ、少し遅れて爆発させる」
// - 飛ぶ（fly）: 宙を転がる筒形の手榴弾と、導火線の火花・細い煙の尾。地面には小さな影
// - 着地（placed）: 転がった手榴弾の導火線が火花を散らして燃え、床には爆発の範囲の破線の輪（自爆するので範囲をはっきり）
// - 爆発（end）: 火球が膨らんで煤に崩れ、破片が飛ぶ。床には焦げ跡と衝撃の輪
// パリィ（parry）「構える。受け止めた攻撃は見切りになり、再使用時間が戻る」
// - 構え（active）: 体の周りに刃を並べた盾の輪。構えた向き（+x）が厚く明るい
// - 見切り（act）: 受け止めた瞬間の十字の閃光と、弾き返す刃の弧が外へ走り、火花が散る
// 血の契約（bloodPact）「生命を払って攻撃速度と吸血を得る」
// - 契約（cast）: 足元に血の紋（二重円と逆三角、外向きの棘）が浮かび、血の飛沫が噴き上がる
// - 纏い（aura）: 体から血の粒が滴り、足元の赤い輪が脈打つ
// 地裂き（quake）「溜めてから前方扇状に衝撃波を放つ」
// - 溜め（active）: 足元から前の扇へ亀裂が伸び、扇の縁が浮かぶ。足元で小石が震える
// - 放つ（act）: 扇いっぱいに地面が割れ、波頭の弧が走って岩が跳ね上がる
// 雷撃（thunder）「カーソル地点に遅れて雷を落とす」
// - 予兆（placed）: 落ちる地点に稲光の紋が瞬き、空から細い先駆けの放電が降りる
// - 落雷（end）: 空から地面まで折れ曲がる太い稲妻と閃光、地面に焦げの放射
// 引力球（gravityWell）「設置した場所へ範囲内の敵（と敵弾）を引き寄せる」
// - 設置（cast）: 範囲の縁から内へ輪が潰れる
// - 渦（placed）: 床に内へ巻く渦の腕、中心に黒い球（明るい縁取り）と、渦に沿って吸い込まれる粒
// - 破裂（end）: 球が弾けて外へ衝撃の輪
// 地雷（mines）「足元に地雷を設置する。起動後、敵が踏むと爆発する」
// - 設置（cast）: 円盤を床に据えた土埃の輪
// - 設置物（placed）: 鋲の並んだ円盤と点滅する灯、範囲の薄い輪
// - 炸裂（end）: 真上へ噴く炎の柱と、地を這う破片の輪
// 加速（haste）「ダッシュの再使用時間が無くなり移動速度が上がる」
// - 発動（cast）: 体から風の輪が弾け、放射の速度線が走る
// - 纏い（aura）: 足元を回る風の輪と、体に巻きつく風の筋（動きの向きは纏いに渡らないので巻く形にする）
// 鎖鎌（chainHook）「鎖を伸ばし、最初に当たった敵を手元へ引き寄せる」
// - 伸びる（active）: 手元から鎖の輪が連なって伸び、先に鎌の刃
// - 引き寄せ（end）: 刺さった所から手元へ鎖（beam）が張って縮み、先で鎌が食い込む火花（tip）、手元で引く衝撃
// 回転弾幕（spiral）「自分を中心に螺旋状の弾を放つ」
// - 撃っている間（active）: 体の周りの紋の輪と、2 本の腕の発射口が回る（弾の出る角と揃う）
// - 弾（fly）: 光る玉と、螺旋に曲がる短い尾
import { arcLine, lens, ring, shards, streakLine } from "../shapes.mjs";
import { clamp01, dot, glint, hash1, paint, segment, smoothstep, stamp, valueNoise, wrapAngle } from "../raster.mjs";
import { DIRS } from "../motifs.mjs";

const TAU = Math.PI * 2;
/** 1 論理 px のドット数 */
const PX = 2;
/** プレイヤーの体の半径（px。PLAYER.radius） */
const BODY_PX = 5;

// -----------------------------------------------------------------------------
// 共通の部品
// -----------------------------------------------------------------------------

/** 画面の上方向の変位（dy < 0 が上）を正準座標へ（向きのあるシートで「宙に浮く」「空から降る」を描く） */
function screenOffset(frame, dx, dy) {
  return { x: dx * frame.cos + dy * frame.sin, y: -dx * frame.sin + dy * frame.cos };
}

/** 塗りつぶしの楕円（中心 cx, cy・半径 rx, ry）。level は中心からの距離 d（0..1）→ 明るさ */
function blob(frame, cx, cy, rx, ry, level, opts = {}) {
  paint(
    frame,
    (x, y) => {
      const d = Math.hypot((x - cx) / rx, (y - cy) / ry);
      if (d > 1) return -1;
      return level(d, x, y);
    },
    { bounds: { x0: cx - rx - 1, y0: cy - ry - 1, x1: cx + rx + 1, y1: cy + ry + 1 }, dither: opts.dither ?? 0.04 },
  );
}

/** 太さのある線（a → b）。bright は 0..1、w はドットの太さ */
function bar(frame, ax, ay, bx, by, w, bright) {
  paint(
    frame,
    (x, y) => {
      const s = segment(x, y, ax, ay, bx, by);
      if (s.d > w / 2) return -1;
      return clamp01(bright * (1 - 0.35 * (s.d / (w / 2))));
    },
    { bounds: { x0: Math.min(ax, bx) - w, y0: Math.min(ay, by) - w, x1: Math.max(ax, bx) + w, y1: Math.max(ay, by) + w }, dither: 0 },
  );
}

/** 破線の輪（範囲の目安）。dash 個に分け、phase（0..1）でずらす */
function dashedRing(frame, radius, o = {}) {
  const dashes = o.dashes ?? 24;
  const fill = o.fill ?? 0.55;
  const phase = o.phase ?? 0;
  const width = o.width ?? 2;
  const bright = o.bright ?? 0.6;
  const squash = o.squash ?? 1;
  paint(
    frame,
    (x, y) => {
      const r = Math.hypot(x, y / squash);
      if (Math.abs(r - radius) > width / 2) return -1;
      const k = ((Math.atan2(y / squash, x) / TAU + 1 + phase) * dashes) % 1;
      if (k > fill) return -1;
      return bright;
    },
    { bounds: { x0: -radius - 3, y0: -radius * squash - 3, x1: radius + 3, y1: radius * squash + 3 }, dither: 0 },
  );
}

/** 折れ線の稲妻（a → b）。jag で横の振れ、seed で形。太さ w の光と芯 */
function bolt(frame, ax, ay, bx, by, o) {
  const segs = o.segs ?? 9;
  const pts = [{ x: ax, y: ay }];
  const len = Math.hypot(bx - ax, by - ay);
  const nx = -(by - ay) / len;
  const ny = (bx - ax) / len;
  for (let i = 1; i < segs; i++) {
    const t = i / segs;
    const off = (hash1(i, o.seed) - 0.5) * 2 * o.jag * Math.sin(Math.PI * t) ** 0.5;
    pts.push({ x: ax + (bx - ax) * t + nx * off, y: ay + (by - ay) * t + ny * off });
  }
  pts.push({ x: bx, y: by });
  for (let i = 0; i + 1 < pts.length; i++) {
    const p = pts[i];
    const q = pts[i + 1];
    if (!p || !q) continue;
    if (o.glow > 0) bar(frame, p.x, p.y, q.x, q.y, o.glow, o.glowBright ?? 0.55);
    bar(frame, p.x, p.y, q.x, q.y, o.w, o.bright ?? 1);
  }
  return pts;
}

/** 飛沫 1 粒（2 ドットの粒と尾） */
function droplet(frame, x, y, level, tailX = 0, tailY = -1) {
  dot(frame, x, y, level);
  dot(frame, x + 1, y, Math.max(1, level - 1));
  dot(frame, x, y + 1, Math.max(1, level - 1));
  dot(frame, x + tailX, y + tailY, Math.max(1, level - 2));
}

/** 丸い煙の塊（段 1〜3 の煤。面をまばらにして奥が見えるように） */
function puff(frame, x, y, r, dark, seed) {
  paint(
    frame,
    (px, py) => {
      const d = Math.hypot(px - x, py - y) / r;
      if (d > 1) return -1;
      const n = valueNoise(px, py, 3, seed);
      if (n < 0.35 + d * 0.3) return -1;
      return clamp01(dark * (1 - d * 0.5));
    },
    { bounds: { x0: x - r - 1, y0: y - r - 1, x1: x + r + 1, y1: y + r + 1 }, dither: 0.1 },
  );
}

// -----------------------------------------------------------------------------
// グレネード
// -----------------------------------------------------------------------------

const FRAG = {
  /** 爆発の半径（px）。SKILL.frag.radius */
  radiusPx: 36,
  seed: 7101,
  /** 手榴弾の筒の長さ・太さ（ドット） */
  bodyL: 11,
  bodyW: 7,
};
const FRAG_R = FRAG.radiusPx * PX;
const FLY_FRAMES = 8;
/** 飛んでいる間、影から浮かせる高さ（ドット） */
const FRAG_LIFT = 14;

/** 手榴弾の本体: 中心 (cx, cy)、回転 spin の筒（胴の帯・口金・安全レバー）。導火線の先の位置を返す */
function grenadeBody(frame, cx, cy, spin) {
  const c = Math.cos(spin);
  const s = Math.sin(spin);
  const L = FRAG.bodyL / 2;
  const W = FRAG.bodyW / 2;
  paint(
    frame,
    (x, y) => {
      const dx = x - cx;
      const dy = y - cy;
      const u = dx * c + dy * s;
      const v = -dx * s + dy * c;
      // 角の丸い筒
      const qu = Math.max(0, Math.abs(u) - (L - W));
      if (Math.hypot(qu, v) > W) return -1;
      // 胴の格子の帯（手榴弾らしい刻み）
      if (Math.abs(u) < L - 1 && Math.abs(((u + L) % 3.2) - 1.6) < 0.45) return 0.3;
      // 上半分に光
      return clamp01(0.5 - 0.28 * (v / W) + (v < -W * 0.4 && Math.abs(u) < L * 0.6 ? 0.2 : 0));
    },
    { bounds: { x0: cx - L - 2, y0: cy - L - 2, x1: cx + L + 2, y1: cy + L + 2 }, dither: 0 },
  );
  // 口金とレバー（+u 側の小さな突起）
  const capX = cx + c * (L + 1);
  const capY = cy + s * (L + 1);
  dot(frame, capX, capY, 5);
  dot(frame, capX - s, capY + c, 4);
  const tipX = cx + c * (L + 3) - s * 1.5;
  const tipY = cy + s * (L + 3) + c * 1.5;
  return { x: tipX, y: tipY };
}

/** 導火線の火花: 先で白い点と十字、四方へ 1 ドットの火の粉 */
function fuseSpark(frame, x, y, f, seed) {
  glint(frame, x, y, f % 2 === 0 ? 2 : 1);
  for (let i = 0; i < 5; i++) {
    const a = hash1(i + f * 7, seed) * TAU;
    const r = 2 + 4 * hash1(i + f * 5, seed + 1);
    dot(frame, x + Math.cos(a) * r, y + Math.sin(a) * r, r < 4 ? 6 : 5);
  }
}

/** 飛ぶ手榴弾（空中）: 宙で転がる筒と導火線の火花、後ろへ細い煙の尾 */
function fragFly(frame, f) {
  const up = screenOffset(frame, 0, -FRAG_LIFT);
  const spin = (f / FLY_FRAMES) * TAU;
  const tip = grenadeBody(frame, up.x, up.y, spin);
  fuseSpark(frame, tip.x, tip.y, f, FRAG.seed + 1);
  // 煙の尾: 後ろ（-x）へ点が間遠に並び、暗くなる
  for (let i = 0; i < 6; i++) {
    const back = 8 + i * 4.5;
    const wob = Math.sin(i * 1.7 + f * 0.8) * 1.5;
    dot(frame, up.x - back, up.y + wob, Math.max(2, 5 - i));
    if (i < 3) dot(frame, up.x - back - 1, up.y + wob + 1, Math.max(2, 4 - i));
  }
}

/** 飛ぶ手榴弾（地面）: 小さな楕円の影 */
function fragShadow(frame) {
  blob(frame, 0, 0, 5, 2.5, () => 0.14, { dither: 0 });
}

const FUSE_FRAMES = 8;

/** 着地した手榴弾（空中）: 床に転がった筒と燃える導火線、細い煙が立ち昇る */
function fragFuse(frame, f) {
  const tip = grenadeBody(frame, 0, 0, -0.35);
  fuseSpark(frame, tip.x, tip.y, f, FRAG.seed + 2);
  // 煙: 導火線の先から上へ揺れながら
  for (let i = 0; i < 5; i++) {
    const t = ((f / FUSE_FRAMES + i / 5) % 1);
    const y = tip.y - 3 - t * 16;
    const x = tip.x + Math.sin(t * 5 + i) * 2;
    dot(frame, x, y, t < 0.5 ? 3 : 2);
    dot(frame, x + 1, y, 2);
  }
}

/** 着地した手榴弾（地面）: 爆発の範囲の破線の輪（回る）と、内側に向く危険の刻み。点滅は速い */
function fragFuseGround(frame, f) {
  const on = f % 2 === 0;
  dashedRing(frame, FRAG_R, { dashes: 20, fill: 0.55, phase: f / FUSE_FRAMES / 20, width: 2, bright: on ? 0.72 : 0.48 });
  // 内向きの刻み（8 方向）
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU + f * 0.04;
    const r0 = FRAG_R - 3;
    const r1 = FRAG_R - 9;
    streakLine(frame, { ax: Math.cos(a) * r0, ay: Math.sin(a) * r0, bx: Math.cos(a) * r1, by: Math.sin(a) * r1, bright: on ? 0.6 : 0.4 });
  }
  blob(frame, 0, 3, 7, 3, () => 0.14, { dither: 0 });
}

const BLAST_FRAMES = 9;

/** 爆発（空中）: 白い芯の火球が膨らみ、煤の塊に崩れて昇る。破片と火の粉が外へ */
function fragBlast(frame, f) {
  const p = (f + 0.5) / BLAST_FRAMES;
  const seed = FRAG.seed + 5;
  const grow = smoothstep(0, 0.35, p);
  const R = FRAG_R * (0.35 + 0.5 * grow);
  const heat = 1 - smoothstep(0.2, 0.9, p);
  paint(
    frame,
    (x, y) => {
      const lift = p * 10;
      const dy = y + lift;
      const n = valueNoise(x, dy, 9, seed) * 0.5 + valueNoise(x, dy, 4, seed + 1) * 0.3;
      const d = Math.hypot(x, dy) / R;
      if (d > 0.75 + n * 0.5) return -1;
      // 崩れ: 後半は火球がほどけて煤の塊だけが残る
      if (p > 0.45 && n < (p - 0.45) * 1.4) return -1;
      const core = clamp01(1 - d * 1.1) * heat;
      return clamp01(0.18 + core * 0.95 + n * 0.25 * heat);
    },
    { bounds: { x0: -R * 1.3, y0: -R * 1.3 - 12, x1: R * 1.3, y1: R * 1.3 }, dither: 0.06 },
  );
  if (p < 0.25) glint(frame, 0, 0, 4);
  // 手榴弾の破片（2 ドットの尾つき）と火の粉
  shards(frame, f, 18, seed + 3, (i, r) => {
    const a = r(1) * TAU;
    return { x: Math.cos(a) * 6, y: Math.sin(a) * 6, vx: Math.cos(a) * (6 + 6 * r(2)), vy: Math.sin(a) * (6 + 6 * r(2)) - 1, life: 4 + Math.floor(4 * r(3)), size: r(4) > 0.4 ? 2 : 1, drag: 0.8 };
  });
  // 煤の小さな塊が上へ
  if (p > 0.4) for (let i = 0; i < 4; i++) puff(frame, (hash1(i, seed + 9) - 0.5) * R, -p * 26 - hash1(i, seed + 8) * 10, 6 + 3 * hash1(i, seed + 7), 0.25, seed + i);
}

/** 爆発（地面）: 衝撃の輪が範囲の縁まで広がり、中心に放射の焦げ跡が残る */
function fragScorch(frame, f) {
  const p = (f + 0.5) / BLAST_FRAMES;
  const seed = FRAG.seed + 11;
  ring(frame, { radius: FRAG_R * (0.4 + 0.6 * smoothstep(0, 0.5, p)), width: 5 - 3 * p, bright: 0.85 * (1 - smoothstep(0.4, 1, p)), erosion: p * 0.7, seed });
  const scorch = FRAG_R * 0.6;
  paint(
    frame,
    (x, y) => {
      const r = Math.hypot(x, y);
      const a = Math.atan2(y, x);
      // 細い放射の筋（24 本）: 筋の中心ほど遠くまで焦げる
      const k = (a / TAU + 1) * 24;
      const spoke = hash1(Math.floor(k) % 24, seed + 1) * (1 - Math.abs((k % 1) - 0.5) * 1.6);
      if (r > scorch * (0.25 + 0.75 * spoke)) return -1;
      if ((Math.floor(x) + Math.floor(y)) % 2 !== 0) return -1;
      return clamp01(0.2 - 0.06 * p);
    },
    { bounds: { x0: -scorch - 2, y0: -scorch - 2, x1: scorch + 2, y1: scorch + 2 }, dither: 0 },
  );
}

// -----------------------------------------------------------------------------
// パリィ
// -----------------------------------------------------------------------------

const PARRY = {
  /** 弾き返しの半径（px）。SKILL.parry.radius */
  radiusPx: 40,
  /** 構えの輪の半径（ドット）。受け止める届き（体 + catchPad = 9px）の少し外 */
  guardR: 22,
  seed: 7201,
};

/** 構え（active）: 体の周りに刃（短い菱形）を 8 枚並べた盾の輪。前（+x）ほど厚く、刃の縁がきらめく */
function parryGuard(frame, f) {
  const frames = 6;
  const p = (f + 0.5) / frames;
  const R = PARRY.guardR;
  // 輪の帯（前ほど明るい）
  paint(
    frame,
    (x, y) => {
      const r = Math.hypot(x, y);
      const front = Math.cos(Math.atan2(y, x));
      const w = 1.2 + 1.3 * Math.max(0, front);
      if (Math.abs(r - R) > w) return -1;
      return clamp01(0.45 + 0.35 * Math.max(0, front));
    },
    { bounds: { x0: -R - 4, y0: -R - 4, x1: R + 4, y1: R + 4 }, dither: 0 },
  );
  // 刃: 輪から外へ尖る菱形。前の 3 枚は大きい
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU + p * 0.3;
    const front = Math.cos(a);
    const len = 8 + 7 * Math.max(0, front);
    const T = 4 + 3 * Math.max(0, front);
    const r0 = R - 2;
    lens(frame, { ax: Math.cos(a) * r0, ay: Math.sin(a) * r0, bx: Math.cos(a) * (r0 + len), by: Math.sin(a) * (r0 + len), T, seed: PARRY.seed + i, bright: 0.8 + 0.25 * Math.max(0, front), bias: 0 });
  }
  // 前の刃の縁を走るきらめき
  const g = -0.9 + 1.8 * p;
  glint(frame, Math.cos(g) * (R + 4), Math.sin(g) * (R + 4), 2);
}

/** 見切り（act）: 受け止めた十字の閃光、弾き返す刃の弧が 4 方へ走って範囲の縁まで、火花が散る */
function parryFlash(frame, f) {
  const frames = 8;
  const p = (f + 0.5) / frames;
  const R = PARRY.radiusPx * PX;
  const seed = PARRY.seed + 10;
  const fade = 1 - smoothstep(0.3, 1, p);
  // 中心の閃光（前半）
  if (p < 0.3) {
    blob(frame, 0, 0, 12 - p * 20, 12 - p * 20, (d) => 1.05 - d * 0.5);
    glint(frame, 0, 0, 4);
  }
  // 十字の閃き（画面に揃えた長い光条）
  if (p < 0.55) {
    const L = 20 + 30 * p;
    const w = 4.5 * (1 - p) + 1;
    bar(frame, -L, 0, L, 0, w, 0.95);
    bar(frame, 0, -L * 0.7, 0, L * 0.7, w, 0.9);
    // 斜めの短い光条（金属が打ち合った星形）
    const d = L * 0.45;
    bar(frame, -d, -d, d, d, w * 0.6, 0.75);
    bar(frame, -d, d, d, -d, w * 0.6, 0.75);
  }
  // 弾き返す刃の弧: 4 本の三日月状の斬線が外へ（範囲の縁まで）
  const r = R * (0.3 + 0.7 * smoothstep(0, 0.7, p));
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + Math.PI / 4;
    const span = 0.55;
    const ax = Math.cos(a - span) * r;
    const ay = Math.sin(a - span) * r;
    const bx = Math.cos(a + span) * r;
    const by = Math.sin(a + span) * r;
    lens(frame, { ax, ay, bx, by, T: 12 * fade + 2, bend: -r * 0.13, erosion: smoothstep(0.5, 1, p), seed: seed + i, bright: 1.0 * fade + 0.2 });
  }
  ring(frame, { radius: r, width: 2, bright: 0.55 * fade, erosion: 0.4 + p * 0.5, seed: seed + 5 });
  shards(frame, f, 16, seed + 7, (i, rr) => {
    const a = rr(1) * TAU;
    return { x: Math.cos(a) * 8, y: Math.sin(a) * 8, vx: Math.cos(a) * (6 + 6 * rr(2)), vy: Math.sin(a) * (6 + 6 * rr(2)), life: 3 + Math.floor(4 * rr(3)), size: 2, drag: 0.82, bright: 1.3 };
  });
}

// -----------------------------------------------------------------------------
// 血の契約
// -----------------------------------------------------------------------------

const PACT = {
  /** 血の紋の半径（ドット） */
  sigilR: 34,
  seed: 7301,
};

/** 血の紋: 二重円・逆三角・外向きの棘。reach（0..1）で描き進み、bright で濃さ */
function bloodSigil(frame, reach, bright) {
  const R = PACT.sigilR;
  // 紋は床に寝ているので縦に潰す
  const sq = 0.6;
  const inRing = (x, y, rad, w) => Math.abs(Math.hypot(x, y / sq) - rad) <= w;
  paint(
    frame,
    (x, y) => {
      const a = Math.atan2(y / sq, x);
      // 描き進み: 上から時計回り
      const along = (((a + Math.PI / 2) % TAU) + TAU) % TAU;
      if (along / TAU > reach) return -1;
      if (inRing(x, y, R, 1.1)) return bright;
      if (inRing(x, y, R - 5, 0.7)) return bright * 0.8;
      return -1;
    },
    { bounds: { x0: -R - 8, y0: -R * sq - 8, x1: R + 8, y1: R * sq + 8 }, dither: 0 },
  );
  // 逆三角（頂点は下）
  const tri = [0, 1, 2].map((i) => {
    const a = Math.PI / 2 + (i / 3) * TAU;
    return { x: Math.cos(a) * (R - 5), y: Math.sin(a) * (R - 5) * sq };
  });
  for (let i = 0; i < 3; i++) {
    const p = tri[i];
    const q = tri[(i + 1) % 3];
    if (!p || !q || reach < 0.55 + i * 0.15) continue;
    streakLine(frame, { ax: p.x, ay: p.y, bx: q.x, by: q.y, bright: bright * 0.8, width: 1 });
  }
  // 外向きの棘（12 本）
  for (let i = 0; i < 12; i++) {
    if (i / 12 >= reach) continue;
    const a = (i / 12) * TAU - Math.PI / 2;
    const L = i % 3 === 0 ? 7 : 4;
    bar(frame, Math.cos(a) * (R + 1), Math.sin(a) * (R + 1) * sq, Math.cos(a) * (R + 1 + L), Math.sin(a) * (R + 1 + L) * sq, 1.2, bright * 0.9);
  }
}

/** 契約（cast の地面）: 血の紋が描き進んで浮かび、薄れる */
function pactSigil(frame, f) {
  const frames = 10;
  const p = (f + 0.5) / frames;
  // 血の色（段 3〜4）に収める。明るい段は炎の黄色になる
  bloodSigil(frame, smoothstep(0, 0.45, p), 0.34 * (1 - smoothstep(0.65, 1, p)) + 0.12);
}

/** 契約（cast の空中）: 体から血の飛沫が噴き上がって落ちる。胸に一瞬の赤い閃き */
function pactSplash(frame, f) {
  const frames = 10;
  const seed = PACT.seed + 3;
  // 胸から噴く血の放射（初めの 3 コマ）
  if (f < 3) {
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * TAU + hash1(i, seed + 1) * 0.4;
      const r0 = 4 + f * 5;
      const L = 6 + 6 * hash1(i, seed + 2);
      bar(frame, Math.cos(a) * r0, -4 + Math.sin(a) * r0, Math.cos(a) * (r0 + L), -4 + Math.sin(a) * (r0 + L), 2, 0.5 - f * 0.08);
    }
    blob(frame, 0, -4, 5 - f, 5 - f, (d) => 0.55 - d * 0.2);
  }
  // 飛沫: 噴き上がって放物線で落ちる大きめの粒（段 3 の赤に段 4 の艶）
  for (let i = 0; i < 16; i++) {
    const r = (k) => hash1(i * 7 + k, seed);
    const vx = (r(1) - 0.5) * 8;
    const vy = -(4 + 5 * r(2));
    const t = f - Math.floor(r(3) * 2);
    if (t < 0 || t > frames - 2) continue;
    const x = vx * t;
    const y = -4 + vy * t + 0.9 * t * t;
    blob(frame, x, y, 1.8, 1.8, () => 0.42, { dither: 0 });
    dot(frame, x - 0.5, y - 0.5, 4);
    dot(frame, x - vx * 0.25, y - (vy + 1.8 * t) * 0.25, 2);
  }
}

const AURA_FRAMES = 8;

/** 纏い（空中）: 体の縁から血の粒が滴って落ち、細い赤い筋が体を昇る */
function pactAura(frame, f) {
  const seed = PACT.seed + 7;
  for (let i = 0; i < 7; i++) {
    const r = (k) => hash1(i * 5 + k, seed);
    const t = (f / AURA_FRAMES + r(1)) % 1;
    const x = (r(2) - 0.5) * BODY_PX * PX * 2.2;
    const y = -8 + t * t * 22;
    // 滴: 伸びた粒（上に尾）
    dot(frame, x, y, 4);
    dot(frame, x + 1, y, 3);
    dot(frame, x, y + 1, 3);
    dot(frame, x + 1, y + 1, 3);
    dot(frame, x, y - 1, 3);
    if (t < 0.5) dot(frame, x, y - 2, 2);
  }
  // 昇る細い筋（脈の拍に合わせて明るむ）
  const beat = f % 4 === 0 ? 1 : 0.6;
  for (let i = 0; i < 3; i++) {
    const t = (f / AURA_FRAMES + i / 3) % 1;
    const x = (i - 1) * 7 + Math.sin(t * 6 + i) * 1.5;
    const y = 6 - t * 26;
    streakLine(frame, { ax: x, ay: y + 5, bx: x, by: y, bright: 0.55 * beat * (1 - t) + 0.1 });
  }
}

/** 纏い（地面）: 足元の赤い輪が脈打つ（拍で太く明るく） */
function pactAuraGround(frame, f) {
  const beat = f % 4;
  const pulse = beat === 0 ? 1 : beat === 1 ? 0.7 : 0.4;
  // 足元（体の下の縁）に寝た楕円。squash は x を伸ばす
  ring(frame, { oy: 8, radius: 7 + pulse * 1.5, width: 1.2 + pulse * 0.8, squash: 2, bright: 0.28 + 0.2 * pulse });
  // 足元の血溜まりの点
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + 0.4;
    dot(frame, Math.cos(a) * 9, 8 + Math.sin(a) * 3, 2);
  }
}

// -----------------------------------------------------------------------------
// 地裂き
// -----------------------------------------------------------------------------

const QUAKE = {
  /** 扇の半径（px）。SKILL.quake.radius */
  radiusPx: 56,
  /** 扇の半角（rad）。SKILL.quake.halfAngle */
  half: 0.6,
  seed: 7401,
};
const QUAKE_R = QUAKE.radiusPx * PX;

/** 亀裂: 扇の中の i 本目。角と揺れを返す（溜めと放つで同じ形を使う） */
function crackPath(i, count, t) {
  const seed = QUAKE.seed;
  const base = -QUAKE.half + (QUAKE.half * 2 * (i + 0.5)) / count + (hash1(i, seed) - 0.5) * 0.12;
  const wob = (Math.sin(t * 0.21 + i * 1.9) * 0.6 + (hash1(Math.floor(t / 6) + i * 31, seed + 1) - 0.5) * 1.4) * 2.2;
  return { a: base, wob };
}

/** 亀裂を reach（ドット）まで描く。枝分かれあり。bright・w で濃さと太さ */
function cracks(frame, count, reach, bright, w) {
  for (let i = 0; i < count; i++) {
    let px = 0;
    let py = 0;
    for (let t = 4; t <= reach; t += 3) {
      const c = crackPath(i, count, t);
      const x = Math.cos(c.a) * t - Math.sin(c.a) * c.wob;
      const y = Math.sin(c.a) * t + Math.cos(c.a) * c.wob;
      if (t > 4) bar(frame, px, py, x, y, w * (1 - (t / QUAKE_R) * 0.5), bright * (t > reach - 6 ? 1.15 : 1));
      // 枝: 所々で短く横へ
      if (hash1(Math.floor(t / 3) + i * 17, QUAKE.seed + 3) > 0.9) {
        const b = c.a + (hash1(t + i, QUAKE.seed + 4) > 0.5 ? 0.7 : -0.7);
        streakLine(frame, { ax: x, ay: y, bx: x + Math.cos(b) * 7, by: y + Math.sin(b) * 7, bright: bright * 0.8 });
      }
      px = x;
      py = y;
    }
  }
}

/** 扇の縁（左右の辺と弧）を破線で */
function fanEdge(frame, R, bright, phase) {
  paint(
    frame,
    (x, y) => {
      const r = Math.hypot(x, y);
      const a = Math.atan2(y, x);
      if (r > R + 1 || r < 6) return -1;
      const onArc = Math.abs(r - R) < 1 && Math.abs(a) <= QUAKE.half;
      const onSide = Math.abs(Math.abs(a) - QUAKE.half) * r < 0.9 && r < R;
      if (!onArc && !onSide) return -1;
      if (((r + (onArc ? a * R : 0)) / 5 + phase) % 2 > 1.1) return -1;
      return bright;
    },
    { bounds: { x0: -2, y0: -R - 2, x1: R + 2, y1: R + 2 }, dither: 0 },
  );
}

const QUAKE_CHARGE_FRAMES = 8;

/** 溜め（地面）: 足元から扇の中へ亀裂が伸び、縁が濃くなる */
function quakeCharge(frame, f) {
  const p = (f + 0.5) / QUAKE_CHARGE_FRAMES;
  cracks(frame, 5, 10 + QUAKE_R * 0.7 * smoothstep(0, 1, p), 0.5 + 0.2 * p, 1.6);
  fanEdge(frame, QUAKE_R, 0.35 + 0.35 * p, f * 0.5);
  // 足元の円い割れ
  ring(frame, { radius: 8 + 2 * p, width: 1.5, squash: 1, bright: 0.45 + 0.3 * p, erosion: 0.3, seed: QUAKE.seed + 9 });
}

/** 溜め（空中）: 足元で小石が震えて浮く（溜まるほど高く） */
function quakePebbles(frame, f) {
  const p = (f + 0.5) / QUAKE_CHARGE_FRAMES;
  for (let i = 0; i < 7; i++) {
    const r = (k) => hash1(i * 3 + k, QUAKE.seed + 20);
    const a = r(1) * TAU;
    const at = 6 + 10 * r(2);
    const jit = (f % 2 === 0 ? 1 : -1) * (i % 2 === 0 ? 1 : -1);
    const up = screenOffset(frame, jit * 0.8, -(2 + 6 * p * r(3)));
    const x = Math.cos(a) * at + up.x;
    const y = Math.sin(a) * at + up.y;
    dot(frame, x, y, 5);
    dot(frame, x + 1, y, 4);
    dot(frame, x, y + 1, 3);
    dot(frame, x + 1, y + 1, 3);
  }
}

const QUAKE_ACT_FRAMES = 9;

/** 放つ（地面）: 扇いっぱいに太い亀裂が走り、波頭の弧が縁まで。後半は亀裂だけが残って薄れる */
function quakeSplit(frame, f) {
  const p = (f + 0.5) / QUAKE_ACT_FRAMES;
  const reach = QUAKE_R * smoothstep(0, 0.4, p);
  const fade = 1 - smoothstep(0.5, 1, p);
  cracks(frame, 7, reach, 0.35 + 0.55 * fade, 4);
  // 波頭: 扇の弧が外へ（前半だけ）
  if (p < 0.6) {
    const r = reach;
    paint(
      frame,
      (x, y) => {
        const d = Math.hypot(x, y);
        const a = Math.atan2(y, x);
        if (Math.abs(a) > QUAKE.half + 0.05 || Math.abs(d - r) > 3.5) return -1;
        const n = valueNoise(x, y, 3, QUAKE.seed + 30);
        if (n < 0.3) return -1;
        return clamp01(0.85 * (1 - p) + 0.2);
      },
      { bounds: { x0: 0, y0: -r - 4, x1: r + 4, y1: r + 4 }, dither: 0 },
    );
  }
  // 割れた地面の土埃（暗い点、面をまばらに）
  paint(
    frame,
    (x, y) => {
      const d = Math.hypot(x, y);
      const a = Math.atan2(y, x);
      if (d > reach || d < 8 || Math.abs(a) > QUAKE.half) return -1;
      if ((Math.floor(x) & 1) || (Math.floor(y) & 1)) return -1;
      if (valueNoise(x, y, 6, QUAKE.seed + 31) < 0.55) return -1;
      return 0.2 * fade + 0.05;
    },
    { bounds: { x0: 0, y0: -QUAKE_R, x1: QUAKE_R, y1: QUAKE_R }, dither: 0 },
  );
}

/** 放つ（空中）: 波頭の通った所から岩の塊が跳ね上がって落ちる */
function quakeRocks(frame, f) {
  const p = (f + 0.5) / QUAKE_ACT_FRAMES;
  const seed = QUAKE.seed + 40;
  for (let i = 0; i < 20; i++) {
    const r = (k) => hash1(i * 9 + k, seed);
    const a = (r(1) * 2 - 1) * QUAKE.half * 0.95;
    const at = QUAKE_R * (0.2 + 0.8 * r(2));
    const born = (at / QUAKE_R) * 0.4;
    const t = (p - born) / 0.5;
    if (t < 0 || t > 1) continue;
    const h = Math.sin(Math.PI * t) * (8 + 14 * r(3));
    const out = at + t * 6;
    const up = screenOffset(frame, 0, -h);
    const x = Math.cos(a) * out + up.x;
    const y = Math.sin(a) * out + up.y;
    const s = 3 + r(4) * 3;
    // 角ばった岩: 上が明るく下が暗い塊と、縁の暗い線
    blob(frame, x, y, s, s * 0.8, (d, px, py) => clamp01(0.55 - 0.3 * ((py - y) / s) - d * 0.15), { dither: 0 });
    dot(frame, x - s * 0.4, y - s * 0.4, 6);
  }
}

// -----------------------------------------------------------------------------
// 雷撃
// -----------------------------------------------------------------------------

const THUNDER = {
  /** 範囲の半径（px）。SKILL.thunder.radius */
  radiusPx: 22,
  /** 空の高さ（ドット。skills/placed.ts の BOLT_HEIGHT 70px） */
  sky: 140,
  seed: 7501,
};
const THUNDER_R = THUNDER.radiusPx * PX;
const OMEN_FRAMES = 8;

/** 予兆（地面）: 落ちる所に稲光の紋（輪と内向きの稲妻の刻み）が瞬く */
function thunderOmen(frame, f) {
  const R = THUNDER_R;
  const on = f % 2 === 0;
  dashedRing(frame, R, { dashes: 12, fill: 0.7, phase: f / OMEN_FRAMES / 12, width: 2, bright: on ? 0.75 : 0.5 });
  // 内向きの小さな稲妻（6 本。フレームごとに 2 本ずつ明るい）
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + 0.3;
    const lit = (i + f) % 3 === 0;
    const ax = Math.cos(a) * R * 0.9;
    const ay = Math.sin(a) * R * 0.9;
    bolt(frame, ax, ay, ax * 0.45, ay * 0.45, { seed: THUNDER.seed + i + f * 11, jag: 3, w: lit ? 1.4 : 1, glow: 0, bright: lit ? 0.95 : 0.4, segs: 4 });
  }
  blob(frame, 0, 0, 4, 3, () => (on ? 0.7 : 0.45), { dither: 0 });
}

/** 予兆（空中）: 空から細い先駆けの放電が降りかけては消える */
function thunderLeader(frame, f) {
  const p = (f % 4) / 4;
  const top = -THUNDER.sky;
  const len = THUNDER.sky * (0.3 + 0.5 * p);
  bolt(frame, 0, top, 0, top + len, { seed: THUNDER.seed + 20 + f, jag: 5, w: 1, glow: 0, bright: 0.55 + 0.3 * p, segs: 6 });
  // 空の雲の縁の小さな瞬き
  glint(frame, (hash1(f, THUNDER.seed + 21) - 0.5) * 20, top + 2, f % 2 === 0 ? 2 : 1);
}

const STRIKE_FRAMES = 8;

/** 落雷（空中）: 空から地面まで折れ曲がる太い稲妻（枝つき）と、地面の閃光、火花 */
function thunderBolt(frame, f) {
  const p = (f + 0.5) / STRIKE_FRAMES;
  const seed = THUNDER.seed + 30 + (f < 3 ? 0 : 1);
  if (p < 0.65) {
    const w = p < 0.3 ? 3.5 : 2;
    const pts = bolt(frame, (hash1(1, seed) - 0.5) * 16, -THUNDER.sky, 0, 0, { seed, jag: 14, w, glow: w + 4, glowBright: 0.55, bright: 1.05, segs: 12 });
    // 枝: 途中の折れ目から斜め下へ
    for (const k of [3, 6]) {
      const q = pts[k];
      if (!q) continue;
      const dir = hash1(k, seed + 2) > 0.5 ? 1 : -1;
      bolt(frame, q.x, q.y, q.x + dir * 18, q.y + 22, { seed: seed + k, jag: 4, w: 1.2, glow: 0, bright: 0.8, segs: 4 });
    }
  }
  if (p < 0.4) {
    blob(frame, 0, 0, 14, 10, (d) => 1.05 - d * 0.55);
    glint(frame, 0, 0, 4);
  }
  shards(frame, f, 14, THUNDER.seed + 40, (i, r) => {
    const a = -Math.PI * r(1);
    return { x: 0, y: 0, vx: Math.cos(a) * (5 + 5 * r(2)), vy: Math.sin(a) * (4 + 4 * r(2)), life: 3 + Math.floor(3 * r(3)), size: r(4) > 0.5 ? 2 : 1, drag: 0.8 };
  });
}

/** 落雷（地面）: 焦げの放射状の稲妻が範囲に走り、輪が縁まで広がって消える */
function thunderScorch(frame, f) {
  const p = (f + 0.5) / STRIKE_FRAMES;
  const R = THUNDER_R;
  const fade = 1 - smoothstep(0.3, 1, p);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * TAU + hash1(i, THUNDER.seed + 50) * 0.5;
    const len = R * (0.7 + 0.35 * hash1(i, THUNDER.seed + 51)) * smoothstep(0, 0.3, p);
    if (len < 3) continue;
    bolt(frame, 0, 0, Math.cos(a) * len, Math.sin(a) * len, { seed: THUNDER.seed + 52 + i, jag: 3, w: 1.3, glow: 0, bright: 0.25 + 0.7 * fade, segs: 5 });
  }
  ring(frame, { radius: R * (0.5 + 0.55 * smoothstep(0, 0.5, p)), width: 3 - 1.5 * p, bright: 0.8 * fade, erosion: p * 0.6, seed: THUNDER.seed + 53 });
}

// -----------------------------------------------------------------------------
// 引力球
// -----------------------------------------------------------------------------

const WELL = {
  /** 引く範囲の半径（px）。SKILL.gravityWell.radius */
  radiusPx: 50,
  /** 黒い球の半径（ドット） */
  coreR: 14,
  seed: 7601,
};
const WELL_R = WELL.radiusPx * PX;
const WELL_FRAMES = 10;

/** 黒い球: 最暗の芯と明るい縁取り、縁を回る光の筋（spin で位置） */
function darkOrb(frame, R, spin, flare = 0) {
  // 球の周りの滲む光（間引いた暗い紫の輪）
  paint(
    frame,
    (x, y) => {
      const d = Math.hypot(x, y) / R;
      if (d <= 1 || d > 1.45) return -1;
      if ((Math.floor(x) + Math.floor(y)) % 2 !== 0 && d > 1.2) return -1;
      return clamp01(0.45 - (d - 1) * 0.6);
    },
    { bounds: { x0: -R * 1.5, y0: -R * 1.5, x1: R * 1.5, y1: R * 1.5 }, dither: 0 },
  );
  paint(
    frame,
    (x, y) => {
      const d = Math.hypot(x, y) / R;
      if (d > 1) return -1;
      if (d > 0.8) return clamp01(0.72 + flare * 0.3);
      return clamp01(0.06 + 0.1 * d + flare * (1 - d) * 0.9);
    },
    { bounds: { x0: -R - 1, y0: -R - 1, x1: R + 1, y1: R + 1 }, dither: 0 },
  );
  for (let i = 0; i < 2; i++) {
    const a = spin + i * Math.PI;
    const r = R + 2;
    streakLine(frame, { ax: Math.cos(a - 0.9) * r, ay: Math.sin(a - 0.9) * r, bx: Math.cos(a) * r, by: Math.sin(a) * r, bright: 0.85 });
  }
}

/** 渦（地面）: 範囲の薄い縁と、外から内へ巻く渦の腕（回る） */
function wellFloor(frame, f) {
  const R = WELL_R;
  const t = f / WELL_FRAMES;
  ring(frame, { radius: R, width: 1.5, bright: 0.42 });
  // 対数螺旋の腕: 角 a で半径が内へ縮む
  const arms = 4;
  paint(
    frame,
    (x, y) => {
      const r = Math.hypot(x, y);
      if (r > R - 2 || r < WELL.coreR + 2) return -1;
      const a = Math.atan2(y, x);
      const k = Math.log(r / R) * 2.2;
      const phase = (((a + k + t * TAU / arms) * arms) / TAU) % 1;
      const ph = (phase + 1) % 1;
      if (ph > 0.1) return -1;
      // 外側は間引いて床を見せる。内へ行くほど明るく（吸い込まれて速くなる）
      if (r > R * 0.55 && (Math.floor(x) + Math.floor(y)) % 2 !== 0) return -1;
      return clamp01(0.25 + 0.5 * (1 - r / R));
    },
    { bounds: { x0: -R, y0: -R, x1: R, y1: R }, dither: 0 },
  );
}

/** 渦（空中）: 黒い球と、渦に沿って内へ吸い込まれる粒 */
function wellCore(frame, f) {
  const t = f / WELL_FRAMES;
  darkOrb(frame, WELL.coreR, -t * TAU * 2);
  for (let i = 0; i < 14; i++) {
    const r = (k) => hash1(i * 7 + k, WELL.seed + 3);
    const ph = (t + r(1)) % 1;
    const rad = WELL_R * 0.95 * (1 - ph) + WELL.coreR;
    const a = r(2) * TAU + ph * 2.4;
    const x = Math.cos(a) * rad;
    const y = Math.sin(a) * rad;
    dot(frame, x, y, ph > 0.6 ? 6 : 5);
    dot(frame, x + 1, y, 4);
    dot(frame, x, y + 1, 4);
    // 渦の向きの尾
    dot(frame, Math.cos(a - 0.12) * (rad + 2), Math.sin(a - 0.12) * (rad + 2), 3);
  }
}

/** 設置（cast）: 範囲の縁から輪が内へ潰れ、中心に球が生まれる */
function wellOpen(frame, f) {
  const frames = 8;
  const p = (f + 0.5) / frames;
  const r = WELL_R * (1 - smoothstep(0, 0.9, p)) + WELL.coreR;
  ring(frame, { radius: r, width: 3, bright: 0.75 });
  ring(frame, { radius: r * 0.7 + 4, width: 1.5, bright: 0.5, erosion: 0.3, seed: WELL.seed + 5 });
  if (p > 0.4) darkOrb(frame, WELL.coreR * smoothstep(0.4, 1, p) + 1, p * 4);
}

/** 破裂（end）: 球が白く膨らんで弾け、衝撃の輪が縁まで、粒が外へ */
function wellBurst(frame, f) {
  const frames = 8;
  const p = (f + 0.5) / frames;
  const fade = 1 - smoothstep(0.3, 1, p);
  if (p < 0.4) darkOrb(frame, WELL.coreR * (1 + p * 1.5), p * 6, 1 - p * 2);
  ring(frame, { radius: WELL_R * smoothstep(0, 0.7, p) + 6, width: 4 - 2 * p, bright: 0.85 * fade, erosion: p * 0.6, seed: WELL.seed + 7 });
  shards(frame, f, 18, WELL.seed + 8, (i, r) => {
    const a = r(1) * TAU;
    return { x: Math.cos(a) * 10, y: Math.sin(a) * 10, vx: Math.cos(a) * (8 + 7 * r(2)), vy: Math.sin(a) * (8 + 7 * r(2)), life: 4 + Math.floor(3 * r(3)), size: 2, drag: 0.85 };
  });
}

// -----------------------------------------------------------------------------
// 地雷
// -----------------------------------------------------------------------------

const MINE = {
  /** 爆発の半径（px）。SKILL.mines.radius */
  radiusPx: 30,
  /** 円盤の半径（ドット） */
  discR: 9,
  seed: 7701,
};
const MINE_R = MINE.radiusPx * PX;
const MINE_FRAMES = 8;

/** 円盤: 床に据えた潰れた円盤、縁の鋲、中央の灯（lamp 0..1） */
function mineDisc(frame, lamp) {
  const R = MINE.discR;
  const sq = 0.7;
  // 胴（側面の暗い帯）と天板
  blob(frame, 0, 1.5, R, R * sq, () => 0.12, { dither: 0 });
  blob(frame, 0, 0, R, R * sq, (d, x, y) => clamp01(0.3 - 0.1 * (y / (R * sq)) - 0.1 * d), { dither: 0 });
  // 鋲
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + 0.5;
    dot(frame, Math.cos(a) * (R - 2.5), Math.sin(a) * (R - 2.5) * sq, 5);
  }
  // 灯
  blob(frame, 0, -0.5, 2.6, 2, () => 0.3 + 0.7 * lamp, { dither: 0 });
  if (lamp > 0.8) glint(frame, 0, -1, 2);
}

/** 設置物（空中）: 灯が点滅する（光ると上に十字の瞬き） */
function mineLamp(frame, f) {
  const on = f % 4 < 1;
  mineDisc(frame, on ? 1 : 0.25);
  if (on) glint(frame, 0, -4, 3);
}

/** 設置物（地面）: 爆発の範囲の薄い輪（点滅に合わせて一瞬明るい） */
function mineRange(frame, f) {
  const on = f % 4 < 1;
  dashedRing(frame, MINE_R, { dashes: 16, fill: 0.35, width: 1.5, bright: on ? 0.5 : 0.28 });
}

/** 設置（cast）: 円盤が据わる土埃の輪 */
function mineSet(frame, f) {
  const frames = 6;
  const p = (f + 0.5) / frames;
  ring(frame, { radius: 8 + 16 * p, width: 2, squash: 1, bright: 0.55 * (1 - p), erosion: 0.3 + p * 0.5, seed: MINE.seed + 3 });
  shards(frame, f, 8, MINE.seed + 4, (i, r) => {
    const a = r(1) * TAU;
    return { x: Math.cos(a) * 8, y: Math.sin(a) * 6, vx: Math.cos(a) * 2.5, vy: Math.sin(a) * 2 - 1, life: 3 + Math.floor(2 * r(2)) };
  });
}

const MINE_BLAST_FRAMES = 9;

/** 炸裂（空中）: 円盤から真上へ噴く炎の柱と、飛び散る金属片 */
function mineBlast(frame, f) {
  const p = (f + 0.5) / MINE_BLAST_FRAMES;
  const seed = MINE.seed + 10;
  const H = 60 * smoothstep(0, 0.35, p);
  const heat = 1 - smoothstep(0.2, 0.95, p);
  paint(
    frame,
    (x, y) => {
      if (y > 6 || y < -H - 14) return -1;
      const raw = -y / Math.max(1, H);
      const u = clamp01(raw);
      // 根元は細く、上で膨らんで丸い頭（噴き上がる炎の柱）
      const cap = raw > 0.75 ? Math.sqrt(Math.max(0, 1 - ((raw - 0.75) / 0.35) ** 2)) : 1;
      const w = (6 + 16 * Math.sqrt(u) + 6 * valueNoise(x, y, 5, seed)) * cap;
      if (Math.abs(x) > w) return -1;
      const n = valueNoise(x, y + p * 30, 6, seed + 1);
      if (p > 0.45 && n < (p - 0.45) * 1.5) return -1;
      const core = clamp01(1 - Math.abs(x) / w) * (1 - u * 0.5) * heat;
      return clamp01(0.2 + core * 0.95 + 0.2 * n * heat);
    },
    { bounds: { x0: -30, y0: -H - 12, x1: 30, y1: 8 }, dither: 0.06 },
  );
  if (p < 0.25) glint(frame, 0, 0, 4);
  shards(frame, f, 16, seed + 3, (i, r) => {
    const a = r(1) * TAU;
    return { x: 0, y: 0, vx: Math.cos(a) * (6 + 6 * r(2)), vy: Math.sin(a) * (4 + 4 * r(2)) - 2, life: 4 + Math.floor(4 * r(3)), size: 2, drag: 0.82 };
  });
}

/** 炸裂（地面）: 地を這う衝撃の輪と、焦げた円盤の跡 */
function mineShock(frame, f) {
  const p = (f + 0.5) / MINE_BLAST_FRAMES;
  const fade = 1 - smoothstep(0.35, 1, p);
  ring(frame, { radius: MINE_R * (0.3 + 0.7 * smoothstep(0, 0.55, p)), width: 5 - 3 * p, squash: 1, bright: 0.85 * fade, erosion: p * 0.7, seed: MINE.seed + 12 });
  blob(frame, 0, 0, 14, 10, (d, x, y) => ((Math.floor(x) + Math.floor(y)) % 2 ? -1 : 0.2), { dither: 0 });
}

// -----------------------------------------------------------------------------
// 加速
// -----------------------------------------------------------------------------

const HASTE = { seed: 7801 };
const HASTE_FRAMES = 8;

/** 発動（cast）: 体から風の輪が弾け、放射の速度線が外へ走る */
function hasteBurst(frame, f) {
  const frames = 8;
  const p = (f + 0.5) / frames;
  const fade = 1 - smoothstep(0.3, 1, p);
  const rr = 10 + 34 * smoothstep(0, 0.8, p);
  // 風の輪: 途切れた 3 本の弧が回りながら広がる（つむじ風が弾ける）
  for (let i = 0; i < 3; i++) {
    const a0 = (i / 3) * TAU + p * 2.2;
    arcLine(frame, { radius: rr - i * 2, from: a0, to: a0 + 1.5, bright: 0.95 * fade, width: 2.5 - p });
  }
  // 放射の速度線は輪の外側を先行する
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU + hash1(i, HASTE.seed + 1) * 0.3;
    const r0 = rr + 3 + 8 * hash1(i, HASTE.seed + 2);
    const L = 10 + 8 * hash1(i, HASTE.seed + 3);
    streakLine(frame, { ax: Math.cos(a) * r0, ay: Math.sin(a) * r0, bx: Math.cos(a) * (r0 + L), by: Math.sin(a) * (r0 + L), bright: 0.8 * fade, width: i % 3 === 0 ? 2 : 1 });
  }
}

/** 纏い（地面）: 足元を回る風の輪（途切れた弧が 3 本回る） */
function hasteRing(frame, f) {
  const t = f / HASTE_FRAMES;
  const sq = 0.45;
  for (let i = 0; i < 3; i++) {
    const a0 = t * TAU + (i / 3) * TAU;
    const R = 14 + i * 1.5;
    paint(
      frame,
      (x, y) => {
        const yy = (y - 7) / sq;
        const r = Math.hypot(x, yy);
        if (Math.abs(r - R) > 1.1) return -1;
        const s = wrapAngle(a0 - Math.atan2(yy, x));
        if (s < 0 || s > 1.6) return -1;
        return clamp01(0.75 * (1 - s / 1.6) + 0.15);
      },
      { bounds: { x0: -R - 2, y0: 7 - R * sq - 2, x1: R + 2, y1: 7 + R * sq + 2 }, dither: 0 },
    );
  }
}

/** 纏い（空中）: 体に巻きつく風の筋（斜めに昇る弧）と、後ろへ千切れる風の粒 */
function hasteWind(frame, f) {
  const t = f / HASTE_FRAMES;
  for (let i = 0; i < 3; i++) {
    const ph = (t + i / 3) % 1;
    const a0 = ph * TAU * 1.5 + i;
    const R = 11;
    // 体の前を回る 1 本の弧（上下にずれて巻く）
    const yOff = 6 - ph * 18;
    for (let s = 0; s < 1.4; s += 0.08) {
      const a = a0 - s;
      const x = Math.cos(a) * R;
      const y = yOff + Math.sin(a) * R * 0.35;
      // 奥（sin < 0）は描かない = 体の手前を巻く
      if (Math.sin(a) < -0.2) continue;
      dot(frame, x, y, s < 0.3 ? 6 : s < 0.8 ? 5 : 3);
    }
  }
  for (let i = 0; i < 4; i++) {
    const ph = (t * 2 + hash1(i, HASTE.seed + 9)) % 1;
    const x = (hash1(i, HASTE.seed + 10) - 0.5) * 22;
    const y = -12 + 20 * hash1(i, HASTE.seed + 11) - ph * 6;
    streakLine(frame, { ax: x, ay: y, bx: x + 5, by: y, bright: 0.6 * (1 - ph) });
  }
}

// -----------------------------------------------------------------------------
// 鎖鎌
// -----------------------------------------------------------------------------

const HOOK = {
  /** 鎖の届く長さ（px）。SKILL.chainHook.range */
  rangePx: 110,
  /** 鎖の輪 1 つの間隔（ドット）。beam の 1 区間（step px = 2 輪）もこれで決まる */
  link: 8,
  seed: 7901,
};
const HOOK_FRAMES = 7;

/** 鎖の輪 1 つ: 中心 (cx, cy)、+x に長い楕円の輪（横向き）か、縦の短い輪（side） */
function chainLink(frame, cx, cy, side, bright) {
  const half = HOOK.link * 0.62;
  if (side) {
    // 横から見た輪（細い棒）
    bar(frame, cx - half, cy, cx + half, cy, 1.6, bright);
    return;
  }
  paint(
    frame,
    (x, y) => {
      const d = Math.hypot((x - cx) / half, (y - cy) / 2.8);
      if (d > 1 || d < 0.45) return -1;
      return clamp01(bright * (y < cy ? 1 : 0.75));
    },
    { bounds: { x0: cx - half - 1, y0: cy - 4, x1: cx + half + 1, y1: cy + 4 }, dither: 0 },
  );
}

/** 鎌の刃: 先 (x, 0) から前へ弧を描く刃と、柄の輪 */
function sickle(frame, x, bright) {
  // 刃: 上へ反る三日月（先端が手元側へ戻る）
  lens(frame, { ax: x - 2, ay: -1, bx: x + 4, by: -14, T: 5, bend: 5, seed: HOOK.seed + 1, bright });
  lens(frame, { ax: x + 4, ay: -14, bx: x - 5, by: -17, T: 3, bend: 2, seed: HOOK.seed + 2, bright: bright * 0.9 });
  // 柄
  bar(frame, x - 4, 0, x + 3, 0, 2.4, bright * 0.6);
  dot(frame, x + 4, -12, 7);
}

/** 伸びる（active）: 手元から鎖が連なって届く長さまで伸び、先に鎌の刃。進み具合 = 長さ */
function hookExtend(frame, f) {
  const p = (f + 1) / HOOK_FRAMES;
  const reach = HOOK.rangePx * PX * p;
  const step = HOOK.link;
  let n = 0;
  for (let x = BODY_PX * PX; x < reach - 6; x += step) {
    chainLink(frame, x, 0, n % 2 === 1, 0.72);
    n++;
  }
  sickle(frame, reach, 1.0);
  // 先の風切り
  streakLine(frame, { ax: reach - 24, ay: 4, bx: reach - 6, by: 4, bright: 0.5 });
  // 手元の投げの閃き
  if (f < 2) glint(frame, BODY_PX * PX, 0, 2);
}

const PULL_FRAMES = 7;

/** 鎖（beam の 1 区間。step px）: 張った鎖の輪 2 つ。後半は細って消える */
function hookChain(frame, f) {
  const p = (f + 0.5) / PULL_FRAMES;
  const L = HOOK.link;
  const bright = 0.8 * (1 - smoothstep(0.4, 1, p)) + 0.15;
  const shake = f < 3 ? (f % 2 === 0 ? 1 : -1) * 0.8 : 0;
  chainLink(frame, -L * 0.5, shake, false, bright);
  chainLink(frame, L * 0.5, -shake, true, bright);
}

/** 食い込み（tip）: 鎌が刺さった所の火花と、引かれて手元（-x）へ向く衝撃 */
function hookBite(frame, f) {
  const p = (f + 0.5) / PULL_FRAMES;
  if (p < 0.6) sickle(frame, 0, 1 - p * 0.6);
  if (p < 0.3) glint(frame, 2, -6, 3);
  shards(frame, f, 10, HOOK.seed + 5, (i, r) => ({ x: 2, y: -6, vx: -(3 + 5 * r(1)), vy: (r(2) - 0.5) * 8, life: 3 + Math.floor(3 * r(3)), size: r(4) > 0.5 ? 2 : 1 }));
}

/** 引き寄せ（end の手元）: 鎖を引く衝撃（前へ開く弓なりの弧）と、手元で弾む火花 */
function hookYank(frame, f) {
  const p = (f + 0.5) / PULL_FRAMES;
  const fade = 1 - smoothstep(0.2, 1, p);
  lens(frame, { ax: 10, ay: -14, bx: 10, by: 14, T: 5 * fade + 1, bend: 6, seed: HOOK.seed + 7, bright: fade + 0.1, erosion: smoothstep(0.5, 1, p) });
  for (let i = 0; i < 3; i++) {
    const y = (i - 1) * 6;
    streakLine(frame, { ax: 34 - p * 10, ay: y, bx: 16 - p * 6, by: y, bright: 0.6 * fade });
  }
}

// -----------------------------------------------------------------------------
// 回転弾幕
// -----------------------------------------------------------------------------

const SPIRAL = {
  /** 弾の半径（px）。SKILL.spiral.radius */
  bulletPx: 2.5,
  /** 腕の数・周数（SKILL.spiral.arms / turns）。発射口の回りを弾の出る角と揃える */
  arms: 2,
  turns: 2,
  /** 紋の輪の半径（ドット） */
  ringR: 18,
  seed: 8001,
};
const SPIRAL_FRAMES = 16;

/** 撃っている間（active）: 体の周りの紋の輪（刻みが回る）と、2 本の腕の発射口（弾の出る角）と、その後ろの螺旋の尾 */
function spiralChannel(frame, f) {
  const p = f / SPIRAL_FRAMES;
  const R = SPIRAL.ringR;
  const head = p * SPIRAL.turns * TAU;
  // 紋の輪: 細い輪と刻み
  paint(
    frame,
    (x, y) => {
      const r = Math.hypot(x, y);
      if (Math.abs(r - R) < 0.8) return 0.45;
      return -1;
    },
    { bounds: { x0: -R - 2, y0: -R - 2, x1: R + 2, y1: R + 2 }, dither: 0 },
  );
  for (let k = 0; k < SPIRAL.arms; k++) {
    const a = head + (k * TAU) / SPIRAL.arms;
    // 発射口: 輪の上の明るい玉と十字
    const x = Math.cos(a) * R;
    const y = Math.sin(a) * R;
    blob(frame, x, y, 3.2, 3.2, (d) => 1.05 - d * 0.5, { dither: 0 });
    // 後ろに渦巻く尾（外へ開く螺旋: 撃ち出した弾の軌跡）と、内側を追う細い弧
    for (let s = 0.05; s < 2.2; s += 0.04) {
      const b = a - s;
      const r = R + 2 + s * 7;
      const lv = s < 0.6 ? 6 : s < 1.4 ? 5 : 3;
      dot(frame, Math.cos(b) * r, Math.sin(b) * r, lv);
      if (s < 1) dot(frame, Math.cos(b) * (r + 1), Math.sin(b) * (r + 1), lv - 1);
    }
    arcLine(frame, { radius: R - 5, from: a - 1.2, to: a - 0.1, bright: 0.7 });
  }
}

const SPIRAL_FLY_FRAMES = 6;

/** 弾（fly）: 光る玉と、横へ曲がりながら伸びる短い尾（螺旋の軌跡）。尾がちらつく */
function spiralBullet(frame, f) {
  const R = SPIRAL.bulletPx * PX;
  blob(frame, 0, 0, R + 0.6, R + 0.6, (d) => 1.1 - d * 0.55, { dither: 0 });
  for (let i = 1; i <= 12; i++) {
    const x = -R - i * 1.6;
    const y = i * i * 0.07 + (f % 2 === 0 ? 0 : 0.5);
    dot(frame, x, y, Math.max(3, 6 - Math.floor(i * 0.3)));
    if (i < 6) dot(frame, x, y - 1, Math.max(3, 6 - Math.floor(i * 0.5)));
  }
  if (f % 3 === 0) glint(frame, 0, 0, 2);
}

// -----------------------------------------------------------------------------
// 表
// -----------------------------------------------------------------------------

/** 作業面の一辺（半径 + 余白。ドット） */
function side(radius, pad) {
  return Math.ceil(radius + pad) * 2;
}

const FX = {
  skills: {
    parry: {
      ramp: "steel",
      active: { sheet: "skillBase.parryGuard", base: 0 },
      act: { sheet: "skillBase.parryFlash", life: 0.4, base: PARRY.radiusPx, pivot: "pos" },
    },
    bloodPact: {
      ramp: "fire",
      cast: { sheet: "skillBase.pactSplash", life: 0.6, base: 0, pivot: "pos", ground: "skillBase.pactSigil" },
      aura: { sheet: "skillBase.pactAura", base: 0, period: 0.9, ground: "skillBase.pactAuraGround" },
    },
    gravityWell: {
      ramp: "dark",
      cast: { sheet: "skillBase.wellOpen", life: 0.35, base: WELL.radiusPx, pivot: "pos" },
      placed: { sheet: "skillBase.wellCore", base: WELL.radiusPx, period: 1.2, ground: "skillBase.wellFloor" },
      end: { sheet: "skillBase.wellBurst", life: 0.4, base: WELL.radiusPx, pivot: "pos" },
    },
    mines: {
      ramp: "fire",
      cast: { sheet: "skillBase.mineSet", life: 0.3, base: 0, pivot: "pos" },
      placed: { sheet: "skillBase.mineLamp", base: MINE.radiusPx, period: 0.8, ground: "skillBase.mineRange" },
      end: { sheet: "skillBase.mineBlast", life: 0.45, base: MINE.radiusPx, pivot: "pos", ground: "skillBase.mineShock" },
    },
    haste: {
      ramp: "steel",
      cast: { sheet: "skillBase.hasteBurst", life: 0.35, base: 0, pivot: "pos" },
      aura: { sheet: "skillBase.hasteWind", base: 0, period: 0.5, ground: "skillBase.hasteRing" },
    },
    chainHook: {
      ramp: "steel",
      active: { sheet: "skillBase.hookExtend", base: HOOK.rangePx },
      // end: pos = 手元（引き寄せ先）、to = 鎌が刺さった所（敵・壁・届いた先）。鎖は pos → to に並べる
      end: { sheet: "skillBase.hookYank", life: 0.25, base: 0, pivot: "pos", beam: { sheet: "skillBase.hookChain", step: (HOOK.link * 2) / PX }, tip: "skillBase.hookBite" },
    },
  },
};

export const ATLAS = {
  key: "skillBase",
  fx: FX,
  sheets: [
    { key: "skillBase.fragFly", dirs: DIRS, frames: FLY_FRAMES, active: 0, size: 96, draw: fragFly },
    { key: "skillBase.fragShadow", dirs: 1, frames: 1, active: 0, size: 24, draw: fragShadow },
    { key: "skillBase.fragFuse", dirs: 1, frames: FUSE_FRAMES, active: 0, size: 64, draw: fragFuse },
    { key: "skillBase.fragFuseGround", dirs: 1, frames: FUSE_FRAMES, active: 0, size: side(FRAG_R, 6), draw: fragFuseGround },
    { key: "skillBase.fragBlast", dirs: 1, frames: BLAST_FRAMES, active: 0, size: side(FRAG_R * 1.3, 40), draw: fragBlast },
    { key: "skillBase.fragScorch", dirs: 1, frames: BLAST_FRAMES, active: 0, size: side(FRAG_R, 8), draw: fragScorch },
    { key: "skillBase.parryGuard", dirs: DIRS, frames: 6, active: 6, size: side(PARRY.guardR + 12, 4), draw: parryGuard },
    { key: "skillBase.parryFlash", dirs: 1, frames: 8, active: 0, size: side(PARRY.radiusPx * PX, 16), draw: parryFlash },
    { key: "skillBase.pactSigil", dirs: 1, frames: 10, active: 0, size: side(PACT.sigilR + 8, 4), draw: pactSigil },
    { key: "skillBase.pactSplash", dirs: 1, frames: 10, active: 0, size: 128, draw: pactSplash },
    { key: "skillBase.pactAura", dirs: 1, frames: AURA_FRAMES, active: 0, size: 64, draw: pactAura },
    { key: "skillBase.pactAuraGround", dirs: 1, frames: AURA_FRAMES, active: 0, size: 48, draw: pactAuraGround },
    { key: "skillBase.quakeCharge", dirs: DIRS, frames: QUAKE_CHARGE_FRAMES, active: QUAKE_CHARGE_FRAMES, size: side(QUAKE_R, 8), draw: quakeCharge },
    { key: "skillBase.quakePebbles", dirs: DIRS, frames: QUAKE_CHARGE_FRAMES, active: QUAKE_CHARGE_FRAMES, size: 64, draw: quakePebbles },
    { key: "skillBase.quakeSplit", dirs: DIRS, frames: QUAKE_ACT_FRAMES, active: 0, size: side(QUAKE_R, 10), draw: quakeSplit },
    { key: "skillBase.quakeRocks", dirs: DIRS, frames: QUAKE_ACT_FRAMES, active: 0, size: side(QUAKE_R, 40), draw: quakeRocks },
    { key: "skillBase.thunderOmen", dirs: 1, frames: OMEN_FRAMES, active: 0, size: side(THUNDER_R, 8), draw: thunderOmen },
    { key: "skillBase.thunderLeader", dirs: 1, frames: OMEN_FRAMES, active: 0, size: side(THUNDER.sky, 8), draw: thunderLeader },
    { key: "skillBase.thunderBolt", dirs: 1, frames: STRIKE_FRAMES, active: 0, size: side(THUNDER.sky, 16), draw: thunderBolt },
    { key: "skillBase.thunderScorch", dirs: 1, frames: STRIKE_FRAMES, active: 0, size: side(THUNDER_R * 1.1, 8), draw: thunderScorch },
    { key: "skillBase.wellOpen", dirs: 1, frames: 8, active: 0, size: side(WELL_R + WELL.coreR, 6), draw: wellOpen },
    { key: "skillBase.wellFloor", dirs: 1, frames: WELL_FRAMES, active: 0, size: side(WELL_R, 4), draw: wellFloor },
    { key: "skillBase.wellCore", dirs: 1, frames: WELL_FRAMES, active: 0, size: side(WELL_R + WELL.coreR, 6), draw: wellCore },
    { key: "skillBase.wellBurst", dirs: 1, frames: 8, active: 0, size: side(WELL_R + 30, 10), draw: wellBurst },
    { key: "skillBase.mineSet", dirs: 1, frames: 6, active: 0, size: 64, draw: mineSet },
    { key: "skillBase.mineLamp", dirs: 1, frames: MINE_FRAMES, active: 0, size: 40, draw: mineLamp },
    { key: "skillBase.mineRange", dirs: 1, frames: MINE_FRAMES, active: 0, size: side(MINE_R, 4), draw: mineRange },
    { key: "skillBase.mineBlast", dirs: 1, frames: MINE_BLAST_FRAMES, active: 0, size: side(80, 20), draw: mineBlast },
    { key: "skillBase.mineShock", dirs: 1, frames: MINE_BLAST_FRAMES, active: 0, size: side(MINE_R, 8), draw: mineShock },
    { key: "skillBase.hasteBurst", dirs: 1, frames: 8, active: 0, size: side(70, 4), draw: hasteBurst },
    { key: "skillBase.hasteRing", dirs: 1, frames: HASTE_FRAMES, active: 0, size: 48, draw: hasteRing },
    { key: "skillBase.hasteWind", dirs: 1, frames: HASTE_FRAMES, active: 0, size: 64, draw: hasteWind },
    { key: "skillBase.hookExtend", dirs: DIRS, frames: HOOK_FRAMES, active: HOOK_FRAMES, size: side(HOOK.rangePx * PX, 24), draw: hookExtend },
    { key: "skillBase.hookChain", dirs: 1, frames: PULL_FRAMES, active: 0, size: 32, draw: hookChain },
    { key: "skillBase.hookBite", dirs: DIRS, frames: PULL_FRAMES, active: 0, size: 72, draw: hookBite },
    { key: "skillBase.hookYank", dirs: DIRS, frames: PULL_FRAMES, active: 0, size: 96, draw: hookYank },
    { key: "skillBase.spiralChannel", dirs: DIRS, frames: SPIRAL_FRAMES, active: SPIRAL_FRAMES, size: side(SPIRAL.ringR + 12, 4), draw: spiralChannel },
    { key: "skillBase.spiralBullet", dirs: DIRS, frames: SPIRAL_FLY_FRAMES, active: 0, size: 40, draw: spiralBullet },
  ],
};
