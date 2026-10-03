// スキル石: 大拡張の後半（近接の技・移動・自己強化）と召喚・設置を墨の筆で描く（docs/ideas/fx-sprites.md 10 章）。
// 単位は絵のドット（論理 0.5px）。正準の向きは +x（技の向き）。当たり判定の半径 × 2 ドットで描き、表の base にその半径（px）を書く
//
// 絵は名前と説明から連想できる形にする（光・グローは使わず、筆の線・円相・飛沫・墨だまり・掠れで描く）:
// - 連環撃（comboChain）: 槍の一突きの一文字に、筆で書いた鎖の環が連なって追いかけ、穂先で小さな環が弾ける（act。突き 1 段ごと）
// - 恨み返し（grudge）: 周りの墨の粒が自分へ吸い込まれて（受けた痛み）一点にたまり、前の扇へ大きな弧の一筆と牙の払いで返る（cast）
// - 巻き戻し（backflow）: 元の所に逆回りに書かれる時計の円相と針（cast）、戻る道に飛白と進む向きの山形（beam）、着いた所で円相が閉じて縮む（tip）
// - 傷返し（scarRoar）: 体から剥がれた墨のしみが外へ飛び、咆哮の揺れた円相が二重に広がり、三本の爪痕が外へ走る（cast）
// - 爆薬樽（powderKeg）: 箍のある樽を墨の線で描き、導火線の先で火の粒がちらつき煙が昇る（placed）、床に爆発範囲の点線（placed の地面）、
//   墨玉が割れて樽板と飛沫が四方へ飛ぶ爆発（end）と焦げ跡（end の地面）
// - 剣の墓標（swordGrave）: 地に突き立つ剣の線画と柄の飾り紐が風に揺れる（placed）、足元の土の割れと回転の届く範囲の点線（placed の地面）、
//   空から落ちて突き刺さる（cast）、剣を軸に一周する円相の斬り（act）
// - 湧き石（manaSpring）: 床の石から波紋の輪が広がる泉（placed の地面）、石から立ち昇る雫（placed の空中）、噴き上がって落ちる雫の噴水（cast）、
//   雫が自分へ吸い込まれる（act）
// - 砲台（turret）: 三脚の上の丸い砲座（placed。向きを持てないので砲身は描かない）、撃つ瞬間に狙う向きへ砲身が突き出て反動で下がり
//   砲口で墨が弾け煙の輪（act。向きは狙う向き）、墨の弾と後ろへ引く筆の尾（fly）、脚が一本ずつ書かれて組み上がる（cast）
import { arcPoints, brushStroke, enso, inkBlot, inkWash, lv, splatter } from "../brush.mjs";
import { dot, hash1, paint, smoothstep, valueNoise } from "../raster.mjs";
import { DIRS } from "../motifs.mjs";

const TAU = Math.PI * 2;
const SEED = 7301;

/** 進み（0..1）。フレームの中央 */
function prog(f, frames) {
  return (f + 0.5) / frames;
}

/** 楕円の折れ線（中心・半径 rx, ry・傾き rot・角 a0 から sweep） */
function ellipsePts(cx, cy, rx, ry, rot, a0, sweep, steps = 32) {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const a = a0 + (sweep * i) / steps;
    const x = Math.cos(a) * rx;
    const y = Math.sin(a) * ry;
    pts.push({ x: cx + x * c - y * s, y: cy + x * s + y * c });
  }
  return pts;
}

/** 太さの揃った筆の線（物の輪郭。筆圧は一定で、端だけ少し細る）。width は線の全幅（brushStroke の width は中心からの半幅なので半分にして渡す） */
function line(frame, pts, width, o = {}) {
  brushStroke(frame, { pts, width: width / 2, profile: (u) => 0.75 + 0.25 * Math.sin(Math.min(1, u * 6) * (Math.PI / 2)) * (1 - smoothstep(0.85, 1, u) * 0.5), dry: 0.1, core: lv(5), ...o });
}

/** 円盤の墨の粒（小さな雫・欠片） */
function drop(frame, x, y, r, level) {
  for (let dy = -r; dy <= r; dy += 0.5) for (let dx = -r; dx <= r; dx += 0.5) if (dx * dx + dy * dy <= r * r) dot(frame, x + dx, y + dy, level);
}

/** 雫の形（丸い腹と、尖った頭が向き (ux, uy) の側） */
function teardrop(frame, x, y, r, ux, uy, level) {
  drop(frame, x, y, r, level);
  for (let t = 0; t < r * 2.2; t += 0.5) {
    const w = r * (1 - t / (r * 2.2));
    for (let k = -w; k <= w; k += 0.5) dot(frame, x + ux * (r * 0.4 + t) - uy * k, y + uy * (r * 0.4 + t) + ux * k, level);
  }
}

/**
 * 点線の輪（範囲の目安）。半径 r・太さ width・段 level。dashes 本の筆の点を、phase（0..1）だけ回して打つ。
 * 点ごとに入りが太く払いが細い（筆で打った点線）
 */
function dashRing(frame, o) {
  const n = o.dashes;
  for (let i = 0; i < n; i++) {
    const a = ((i + (o.phase ?? 0)) / n) * TAU;
    const span = (TAU / n) * (o.fill ?? 0.45);
    brushStroke(frame, {
      pts: arcPoints(0, 0, o.radius, a, span, 8),
      width: o.width,
      body: lv(o.level),
      edge: lv(o.level),
      core: lv(o.level),
      dry: 0,
      fade: o.fade ?? 0,
      press: 0.2,
      tail: 0.6,
      seed: (o.seed ?? 1) + i,
    });
  }
}

/** 間引いた面（淡墨のむら）: inside(x, y) の内側を、市松に 1 つおき・雑音のむらで塗る */
function thinFill(frame, inside, bounds, o = {}) {
  const density = o.density ?? 0.45;
  const level = o.level ?? 2;
  paint(
    frame,
    (x, y) => {
      if (!inside(x, y)) return -1;
      if (((Math.floor(x) + Math.floor(y)) & 1) === 1) return -1;
      if (valueNoise(x, y, o.cell ?? 5, o.seed ?? 1) > density) return -1;
      return lv(level);
    },
    { bounds, dither: 0 },
  );
}

/** 墨の粒が外側から中心へ吸い込まれる（飛沫の逆回し）。k（0..1）で吸い込みの進み */
function converge(frame, count, seed, radius, k, level = 5) {
  for (let i = 0; i < count; i++) {
    const r = (j) => hash1(i * 7 + j, seed);
    const start = r(1) * 0.4;
    const t = smoothstep(start, start + 0.6, k);
    if (t <= 0 || t >= 0.98) continue;
    const a = r(2) * TAU + t * 0.6;
    const at = radius * (0.6 + 0.4 * r(3)) * (1 - t);
    const x = Math.cos(a) * at;
    const y = Math.sin(a) * at;
    const size = r(4) > 0.5 ? 1.6 : 1;
    drop(frame, x, y, size, level);
    // 尾は外側（来た向き）へ
    for (let s = 1; s < 6; s += 0.5) dot(frame, x + Math.cos(a) * s, y + Math.sin(a) * s, Math.max(3, level - 1));
  }
}

// =============================================================================
// 連環撃: 槍の一突きと、追いかける鎖の環
// =============================================================================

const CHAIN = {
  /** 突きの長さ（px）。EXTRA_SKILL_TUNING.comboChain.length */
  lengthPx: 40,
  frames: 7,
  seed: SEED + 10,
};

function comboThrust(frame, f) {
  const L = CHAIN.lengthPx * 2;
  const p = prog(f, CHAIN.frames);
  const grow = smoothstep(0, 0.35, p);
  const fade = smoothstep(0.45, 1, p) * 0.9;
  // 一突き: 起筆で押し、穂先へ鋭く払う一文字
  brushStroke(frame, { pts: [{ x: 4, y: 0 }, { x: L + 4, y: 0 }], width: 3.2, grow, fade, dry: 0.45, press: 0.06, tail: 0.4, seed: CHAIN.seed });
  // 鎖の環: 突きを追って順に書かれる。表向きの環（輪）と横向きの環（細い楕円）が交互につながる
  const links = 5;
  for (let i = 0; i < links; i++) {
    const cx = 12 + i * ((L - 20) / (links - 1)) * 0.92;
    const born = (i / links) * 0.4 + 0.05;
    const g = smoothstep(born, born + 0.2, p);
    if (g <= 0) continue;
    const face = i % 2 === 0;
    const pts = face ? ellipsePts(cx, 0, 7.5, 7.5, 0, -Math.PI / 2, TAU * 0.92, 28) : ellipsePts(cx, 0, 7.5, 2.6, 0, Math.PI / 2, TAU * 0.92, 28);
    brushStroke(frame, { pts, width: 1.3, grow: g, fade: Math.min(1, fade * 1.15), dry: 0.3, press: 0.1, tail: 0.5, seed: CHAIN.seed + 3 + i });
  }
  // 穂先で小さな環が弾ける
  const pop = smoothstep(0.3, 0.7, p);
  if (pop > 0 && p < 0.9) enso(frame, { ox: L + 6, radius: 3 + 6 * pop, width: 1.4, sweep: TAU * 0.8, a0: Math.PI, fade: smoothstep(0.55, 0.9, p), seed: CHAIN.seed + 20 });
  splatter(frame, f - 2, 8, CHAIN.seed + 21, (i, r) => ({ x: L + 4, y: 0, vx: 2 + 4 * r(1), vy: (r(2) - 0.5) * 6, size: r(3) > 0.5 ? 1.4 : 0.8, life: 4, level: 7 }));
}

// =============================================================================
// 恨み返し: 痛みを吸い込み、前の扇へ牙で返す
// =============================================================================

const GRUDGE = {
  /** 扇の半径（px）。EXTRA_SKILL_TUNING.grudge.radius */
  radiusPx: 50,
  /** 扇の半角（ラジアン）。grudge.halfAngle */
  halfAngle: 0.8,
  frames: 9,
  seed: SEED + 30,
};

function grudgeWave(frame, f) {
  const R = GRUDGE.radiusPx * 2;
  const H = GRUDGE.halfAngle;
  const p = prog(f, GRUDGE.frames);
  // 痛みを吸う: 墨の粒が自分へ集まる
  converge(frame, 16, GRUDGE.seed, R * 0.45, smoothstep(0, 0.4, p), 5);
  // たまった恨み: 胸元の墨だまり（芯は差し色）
  if (p > 0.15 && p < 0.6) inkBlot(frame, { x: 4, y: 0, radius: 4 + 5 * smoothstep(0.15, 0.4, p) * (1 - smoothstep(0.45, 0.6, p)), seed: GRUDGE.seed + 1, coreWidth: 0.45 });
  // 返す: 前の扇へ大きな弧の一筆
  const g = smoothstep(0.35, 0.6, p);
  const fade = smoothstep(0.65, 1, p) * 0.9;
  if (g > 0) brushStroke(frame, { pts: arcPoints(0, 0, R * 0.78, -H, H * 2, 32, 0.03, GRUDGE.seed + 2), width: 5, grow: g, fade, dry: 0.5, press: 0.1, tail: 0.4, seed: GRUDGE.seed + 3 });
  // 牙: 根元が太く外へ尖る払いが 4 本（弧から外へ突き出す）
  const fangs = [-0.62, -0.2, 0.2, 0.62];
  fangs.forEach((t, i) => {
    const born = 0.42 + i * 0.04;
    const fg = smoothstep(born, born + 0.15, p);
    if (fg <= 0) return;
    const a = t * H;
    const bend = (i % 2 === 0 ? 1 : -1) * 0.06;
    // 牙: 弧の内側から外へ、根元が太く先が尖る。弧と重なる所は短くし、外へ突き出た所で形が読めるようにする
    const pts = [0.72, 0.84, 0.96, 1.1].map((k, j) => ({ x: Math.cos(a + bend * j) * R * k, y: Math.sin(a + bend * j) * R * k }));
    brushStroke(frame, { pts, width: 4.5, grow: fg, fade, dry: 0.3, press: 0.02, tail: 1, sharp: 1, seed: GRUDGE.seed + 10 + i });
  });
  splatter(frame, f - 4, 14, GRUDGE.seed + 20, (i, r) => {
    const a = (r(1) - 0.5) * 2 * H;
    const at = R * (0.7 + 0.25 * r(2));
    return { x: Math.cos(a) * at, y: Math.sin(a) * at, vx: Math.cos(a) * (2 + 3 * r(3)), vy: Math.sin(a) * (2 + 3 * r(3)), size: r(4) > 0.5 ? 1.6 : 1, life: 4, level: 7 };
  });
}

/** 返した扇の床: 扇の形に淡墨の擦れが残り、薄れていく */
function grudgeGround(frame, f) {
  const R = GRUDGE.radiusPx * 2;
  const H = GRUDGE.halfAngle;
  const p = prog(f, GRUDGE.frames);
  // 足元の擦れから始まり、返すと扇の先まで広がる
  const reach = 0.2 + 0.8 * smoothstep(0.35, 0.65, p);
  const density = 0.28 * (1 - smoothstep(0.6, 1, p)) + 0.04;
  thinFill(
    frame,
    (x, y) => {
      const r = Math.hypot(x, y);
      if (r < 6 || r > R * 0.95 * reach) return false;
      return Math.abs(Math.atan2(y, x)) < H;
    },
    { x0: 0, y0: -R, x1: R, y1: R },
    { density, level: 2, seed: GRUDGE.seed + 40, cell: 3 },
  );
}

// =============================================================================
// 巻き戻し: 逆回りの時計の円相・戻る道・閉じる円相
// =============================================================================

const BACK = {
  /** beam の 1 区間（px） */
  stepPx: 12,
  frames: 8,
  seed: SEED + 50,
};

/** 元いた所: 時計の円相が逆回り（反時計回り）に書かれ、針も逆へ回る。文字盤の目盛りは墨の点 */
function backflowFade(frame, f) {
  const p = prog(f, BACK.frames);
  const r = 22;
  const g = smoothstep(0, 0.55, p);
  const fade = smoothstep(0.55, 1, p) * 0.9;
  enso(frame, { radius: r, a0: -Math.PI / 2, sweep: -TAU * 0.9, width: 3, grow: g, fade, dry: 0.5, seed: BACK.seed });
  // 目盛り（12 個の点。円相が書かれた所まで）
  for (let i = 0; i < 12; i++) {
    const t = i / 12;
    if (t > g * 0.9 || hash1(i, BACK.seed + 1) < fade) continue;
    const a = -Math.PI / 2 - t * TAU;
    drop(frame, Math.cos(a) * (r - 7), Math.sin(a) * (r - 7), i % 3 === 0 ? 1.4 : 0.8, 6);
  }
  // 針: 12 時から反時計回りに回る長針と短針
  if (fade < 0.8) {
    const a = -Math.PI / 2 - p * TAU * 0.8;
    brushStroke(frame, { pts: [{ x: 0, y: 0 }, { x: Math.cos(a) * (r - 6), y: Math.sin(a) * (r - 6) }], width: 1.4, fade, dry: 0.1, press: 0.05, tail: 0.5, seed: BACK.seed + 2 });
    const b = -Math.PI / 2 - p * TAU * 0.25;
    brushStroke(frame, { pts: [{ x: 0, y: 0 }, { x: Math.cos(b) * (r - 12), y: Math.sin(b) * (r - 12) }], width: 1.8, fade, dry: 0.1, press: 0.05, tail: 0.5, seed: BACK.seed + 3 });
    drop(frame, 0, 0, 2, 7);
  }
}

/** 戻る道（beam の 1 区間）: 乾いた筆の飛白と、進む向き（+x）へ流れる山形 */
function backflowTrail(frame, f) {
  const p = prog(f, BACK.frames);
  const half = BACK.stepPx + 0.6;
  brushStroke(frame, {
    pts: [{ x: -half, y: 0 }, { x: half, y: 0 }],
    width: 6 * (1 - 0.4 * p),
    profile: () => 1,
    flat: true,
    dry: 0,
    fade: 0.3 + 0.6 * smoothstep(0.2, 1, p),
    pitch: 1.3,
    breakLen: 8,
    seed: BACK.seed + 10,
  });
  // 山形「>」: 区間の中を進む向きへ流れる（区間を並べると継ぎ目なく流れる）
  if (p > 0.85) return;
  const span = BACK.stepPx * 2;
  const x = -BACK.stepPx + ((f * 5 + 6) % span);
  const pts = [{ x: x - 6, y: -8 }, { x, y: 0 }, { x: x - 6, y: 8 }];
  brushStroke(frame, { pts, width: 1.6, fade: smoothstep(0.5, 0.85, p), dry: 0.1, press: 0.1, tail: 0.4, seed: BACK.seed + 11, flat: false });
}

/** 着いた所: 時計の円相が閉じながら縮み、真ん中に墨が一滴落ちる */
function backflowArrive(frame, f) {
  const p = prog(f, BACK.frames);
  const r = 24 * (1 - 0.65 * smoothstep(0, 0.7, p));
  const fade = smoothstep(0.6, 1, p) * 0.9;
  enso(frame, { radius: r, a0: -Math.PI / 2 + p * 2, sweep: -TAU * (0.6 + 0.35 * p), width: 4.5 - 1.5 * p, fade, dry: 0.4, seed: BACK.seed + 20 });
  if (p > 0.5) inkBlot(frame, { radius: 3 + 2 * (1 - p), seed: BACK.seed + 21, coreWidth: 0.4 });
  splatter(frame, f - 4, 8, BACK.seed + 22, (i, rr) => {
    const a = rr(1) * TAU;
    return { x: 0, y: 0, vx: Math.cos(a) * (1.5 + 2 * rr(2)), vy: Math.sin(a) * (1.5 + 2 * rr(2)), size: rr(3) > 0.5 ? 1.2 : 0.8, life: 3, level: 6 };
  });
}

// =============================================================================
// 傷返し: 剥がれた墨のしみ・咆哮の円相・外へ走る爪痕
// =============================================================================

const SCAR = {
  /** 衝撃の半径（px）。EXTRA_SKILL_TUNING.scarRoar.radius */
  radiusPx: 56,
  frames: 9,
  seed: SEED + 70,
};

function scarRoar(frame, f) {
  const R = SCAR.radiusPx * 2;
  const p = prog(f, SCAR.frames);
  // 剥がれる: 体に付いていた墨のしみ（状態異常）が大きな粒で外へ飛ぶ
  splatter(frame, f, 10, SCAR.seed, (i, r) => {
    const a = r(1) * TAU;
    return { x: Math.cos(a) * 6, y: Math.sin(a) * 6, vx: Math.cos(a) * (4 + 4 * r(2)), vy: Math.sin(a) * (4 + 4 * r(2)), size: 2 + r(3) * 1.4, life: 6, level: r(4) > 0.5 ? 7 : 5 };
  });
  // 咆哮: 揺れた円相が 2 重に広がる
  for (let k = 0; k < 2; k++) {
    const e = smoothstep(0.05 + k * 0.15, 0.7 + k * 0.15, p);
    if (e <= 0) continue;
    enso(frame, {
      radius: R * (0.25 + 0.7 * e) * (1 - k * 0.12),
      a0: k * 2.2,
      sweep: TAU * 0.88,
      width: (8 - k * 3) * (1 - 0.55 * e),
      wobble: 0.1,
      steps: 40,
      fade: smoothstep(0.55 + k * 0.1, 1, p) * 0.9,
      dry: 0.6,
      seed: SCAR.seed + 10 + k,
    });
  }
  // 爪痕: 三本の平行な払いが 5 方へ走る
  const e = smoothstep(0.15, 0.75, p);
  const fade = smoothstep(0.55, 1, p);
  for (let s = 0; s < 5; s++) {
    const a = (s / 5) * TAU + 0.35;
    const at = R * (0.2 + 0.55 * e);
    const c = Math.cos(a);
    const sn = Math.sin(a);
    for (let k = -1; k <= 1; k++) {
      const off = k * 6;
      const len = 30 - Math.abs(k) * 6;
      const x0 = c * at - sn * off;
      const y0 = sn * at + c * off;
      brushStroke(frame, {
        pts: [{ x: x0, y: y0 }, { x: x0 + c * len + sn * 3, y: y0 + sn * len - c * 3 }],
        width: 1.6,
        grow: smoothstep(0.1, 0.4, p),
        fade,
        dry: 0.4,
        press: 0.08,
        tail: 0.6,
        sharp: 1,
        seed: SCAR.seed + 20 + s * 3 + k,
      });
    }
  }
}

/** 衝撃の床: 足元から放射状の割れが走り、淡墨の滲みが広がって薄れる */
function scarGround(frame, f) {
  const R = SCAR.radiusPx * 2;
  const p = prog(f, SCAR.frames);
  const reach = smoothstep(0, 0.6, p);
  const thin = 1 - smoothstep(0.55, 1, p);
  if (thin > 0.05) {
    thinFill(frame, (x, y) => Math.hypot(x, y) < R * 0.9 * reach, { x0: -R, y0: -R, x1: R, y1: R }, { density: 0.16 * thin, level: 2, seed: SCAR.seed + 40, cell: 4 });
  }
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU + hash1(i, SCAR.seed + 41) * 0.5;
    const len = R * (0.35 + 0.3 * hash1(i, SCAR.seed + 42));
    const pts = [0, 0.35, 0.7, 1].map((k, j) => {
      const aa = a + (j ? (hash1(i * 5 + j, SCAR.seed + 43) - 0.5) * 0.35 : 0);
      return { x: Math.cos(aa) * (8 + len * k), y: Math.sin(aa) * (8 + len * k) };
    });
    brushStroke(frame, { pts, width: 1.1, grow: smoothstep(0, 0.4, p), fade: smoothstep(0.5, 1, p), dry: 0.3, press: 0.05, tail: 0.6, seed: SCAR.seed + 50 + i });
  }
}

// =============================================================================
// 爆薬樽: 樽の線画・導火線・爆発範囲の点線・爆発・焦げ跡
// =============================================================================

const KEG = {
  /** 爆発の半径（px）。EXTRA_SKILL_TUNING.powderKeg.radius */
  radiusPx: 40,
  frames: 8,
  blastFrames: 10,
  seed: SEED + 90,
};

/** 樽の線画（中心が原点。幅 14・高さ 18 ドットほど。正面から見た胴の膨らんだ樽） */
function drawBarrel(frame, ox, oy, fade = 0) {
  const w = 9;
  const h = 11;
  const bulge = 2.5;
  // 胴の面は塗らない（属性つきの配色では淡墨の段も黒になり、樽が墨の塊に見える）。木目は短い縦の掠れ数本
  for (const x of [-3.5, 0, 3.5]) brushStroke(frame, { pts: [{ x: ox + x, y: oy - h + 3 }, { x: ox + x * 1.1, y: oy + h - 3 }], width: 0.6, dry: 0.6, fade: 0.3 + fade, body: lv(4), edge: lv(4), core: lv(4), seed: KEG.seed + 1 + x });
  const side = (sgn) => {
    const pts = [];
    for (let i = 0; i <= 10; i++) {
      const t = -1 + (2 * i) / 10;
      pts.push({ x: ox + sgn * (w + bulge * (1 - t * t)), y: oy + t * h });
    }
    return pts;
  };
  const o = { fade, seed: KEG.seed + 2 };
  line(frame, side(-1), 2.4, o);
  line(frame, side(1), 2.4, { ...o, seed: KEG.seed + 3 });
  // 上下の縁（口の楕円）と箍 2 本
  line(frame, ellipsePts(ox, oy - h, w, 2.2, 0, 0, TAU, 20), 2, { ...o, seed: KEG.seed + 4 });
  line(frame, [{ x: ox - w, y: oy + h }, { x: ox + w, y: oy + h }], 2.4, { ...o, seed: KEG.seed + 5 });
  for (const t of [-0.45, 0.45]) {
    const hw = w + bulge * (1 - t * t);
    line(frame, [{ x: ox - hw, y: oy + t * h }, { x: ox, y: oy + t * h + 1 }, { x: ox + hw, y: oy + t * h }], 2.6, { ...o, seed: KEG.seed + 6 + t * 10 });
  }
}

/** 置いてある間（空中）: 樽と、上へ出た導火線。先で火の粒がちらつき、煙の輪が昇る */
function kegBarrel(frame, f) {
  drawBarrel(frame, 0, 0);
  // 導火線: 口から右上へ曲がる細い筆
  const fuse = [{ x: 1, y: -12 }, { x: 3, y: -17 }, { x: 7, y: -19 }, { x: 10, y: -18 }];
  brushStroke(frame, { pts: fuse, width: 0.9, dry: 0, press: 0.05, tail: 0.1, sharp: 0.3, seed: KEG.seed + 10 });
  // 火の粒（芯は差し色）。コマごとに大きさと位置が揺れる
  const flick = hash1(f, KEG.seed + 11);
  drop(frame, 10.5 + (flick - 0.5), -18.5, 1.4 + flick, 7);
  if (f % 2 === 0) dot(frame, 12 + flick * 2, -20 - flick * 2, 6);
  // 煙: 小さな筆の輪が 2 つ、ゆらぎながら昇る
  for (let k = 0; k < 2; k++) {
    const ph = ((f / KEG.frames + k * 0.5) % 1);
    const x = 11 + Math.sin(ph * TAU + k) * 2;
    const y = -21 - ph * 14;
    if (ph > 0.85) continue;
    brushStroke(frame, { pts: arcPoints(x, y, 1.5 + ph * 2, k * 2, TAU * 0.75, 10), width: 0.7, fade: ph * 0.6, dry: 0, press: 0.1, tail: 0.5, body: lv(4), edge: lv(4), core: lv(5), seed: KEG.seed + 12 + k });
  }
}

/** 置いてある間（地面）: 爆発の届く範囲の点線（筆で打った点がゆっくり回る） */
function kegRange(frame, f) {
  dashRing(frame, { radius: KEG.radiusPx * 2 - 2, width: 1.2, level: 4, dashes: 24, phase: f / KEG.frames, fill: 0.5, seed: KEG.seed + 20 });
}

/** 爆発: 墨玉が膨らんで割れ、円相の衝撃と、樽板・飛沫が四方へ飛ぶ */
function kegBlast(frame, f) {
  const R = KEG.radiusPx * 2;
  const p = prog(f, KEG.blastFrames);
  // 墨玉（芯は火の差し色）。膨らんで割れる
  if (p < 0.45) inkBlot(frame, { radius: 10 + 18 * smoothstep(0, 0.3, p), seed: KEG.seed + 30 + f, coreWidth: 0.5 - 0.4 * p });
  // 衝撃の円相
  const e = smoothstep(0.05, 0.55, p);
  enso(frame, { radius: R * (0.35 + 0.6 * e), a0: 0.6, sweep: TAU * 0.9, width: 10 * (1 - 0.6 * e), wobble: 0.08, fade: smoothstep(0.5, 1, p) * 0.9, dry: 0.6, seed: KEG.seed + 31 });
  // 樽板: 短い太い筆の切れが回りながら外へ飛ぶ
  for (let i = 0; i < 7; i++) {
    const r = (k) => hash1(i * 11 + k, KEG.seed + 32);
    const a = (i / 7) * TAU + r(1) * 0.6;
    const at = R * (0.15 + 0.85 * smoothstep(0, 0.8, p) * (0.7 + 0.4 * r(2)));
    const spin = a + p * (r(3) > 0.5 ? 6 : -6);
    const cx = Math.cos(a) * at;
    const cy = Math.sin(a) * at;
    const hl = 4 + 2 * r(4);
    if (p > 0.92) continue;
    brushStroke(frame, { pts: [{ x: cx - Math.cos(spin) * hl, y: cy - Math.sin(spin) * hl }, { x: cx + Math.cos(spin) * hl, y: cy + Math.sin(spin) * hl }], width: 2, fade: smoothstep(0.6, 1, p), dry: 0.2, press: 0.1, tail: 0.2, sharp: 0.4, seed: KEG.seed + 40 + i });
  }
  splatter(frame, f, 30, KEG.seed + 50, (i, r) => {
    const a = r(1) * TAU;
    const sp = 4 + 7 * r(2);
    return { x: Math.cos(a) * 8, y: Math.sin(a) * 8, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, size: r(3) > 0.6 ? 2.2 : 1.1, born: r(4) * 2, life: 7, level: r(5) > 0.5 ? 7 : 5 };
  });
}

/** 焦げ跡: 爆発の床に墨が滲み、縁に焦げの差し色が点々と残って薄れる */
function kegScorch(frame, f) {
  const R = KEG.radiusPx * 2;
  const p = prog(f, KEG.blastFrames);
  const reach = smoothstep(0, 0.35, p) * 0.85;
  const thin = 1 - smoothstep(0.5, 1, p);
  if (thin < 0.05) return;
  inkWash(frame, { radius: R, reach, seed: KEG.seed + 60, rimWidth: Math.max(1, 3 * thin), rimLevel: 5, tint: 4, density: 0.08 * thin, cell: 5 });
  // 燻る火の粒（差し色）がまばらに残る
  for (let i = 0; i < 14; i++) {
    const a = hash1(i, KEG.seed + 61) * TAU;
    const at = R * reach * Math.sqrt(hash1(i, KEG.seed + 62)) * 0.9;
    if (hash1(i * 3 + f, KEG.seed + 63) < 1 - thin) continue;
    drop(frame, Math.cos(a) * at, Math.sin(a) * at, 0.9, 6);
  }
}

// =============================================================================
// 剣の墓標: 地に突き立つ剣・足元・落ちて刺さる・回転斬り
// =============================================================================

const GRAVE = {
  /** 回転斬りの半径（px）。EXTRA_SKILL_TUNING.swordGrave.radius */
  radiusPx: 28,
  frames: 8,
  seed: SEED + 110,
};

/** 剣の線画（切っ先が地面 y = 6 に刺さり、柄が上。oy だけ上下にずらせる） */
function drawSword(frame, oy, o = {}) {
  const fade = o.fade ?? 0;
  const top = -26 + oy;
  const ground = 6 + oy;
  // 刀身: 淡墨の面と、両の刃の線・真ん中の鎬の細線
  paint(
    frame,
    (x, y) => {
      if (y < top || y > ground) return -1;
      const hw = 3 * (1 - 0.35 * smoothstep(ground - 8, ground, y));
      return Math.abs(x) < hw ? lv(2) : -1;
    },
    { bounds: { x0: -5, y0: top - 1, x1: 5, y1: ground + 1 }, dither: 0 },
  );
  line(frame, [{ x: -3.2, y: top }, { x: -3, y: ground - 6 }, { x: -1.6, y: ground }], 1.8, { fade, seed: GRAVE.seed + 1 });
  line(frame, [{ x: 3.2, y: top }, { x: 3, y: ground - 6 }, { x: 1.6, y: ground }], 1.8, { fade, seed: GRAVE.seed + 2 });
  for (let y = top + 2; y < ground - 3; y += 1) if (hash1(y, GRAVE.seed + 3) > 0.3) dot(frame, 0, y, 4);
  // 鍔: 横の一筆（入りで押し、払いで少し反る）
  brushStroke(frame, { pts: [{ x: -10, y: top + 1 }, { x: 0, y: top - 0.5 }, { x: 10, y: top + 1 }], width: 2, fade, dry: 0.2, press: 0.1, tail: 0.3, sharp: 0.6, seed: GRAVE.seed + 4 });
  // 柄と柄頭
  brushStroke(frame, { pts: [{ x: 0, y: top - 1 }, { x: 0, y: top - 10 }], width: 1.6, profile: () => 1, fade, dry: 0.1, seed: GRAVE.seed + 5 });
  for (let y = top - 9; y < top - 1; y += 2.5) line(frame, [{ x: -1.8, y }, { x: 1.8, y: y + 1 }], 1, { fade, seed: GRAVE.seed + 6 });
  drop(frame, 0, top - 12, 2.4, 6);
}

/** 置いてある間（空中）: 剣と、柄頭から垂れる飾り紐が風に揺れる。墓前の香の煙が細く昇る */
function graveSword(frame, f) {
  drawSword(frame, 0);
  const ph = (f / GRAVE.frames) * TAU;
  const pts = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    pts.push({ x: 1 + t * 9 + Math.sin(ph + t * 3) * 2 * t, y: -38 + t * 10 + Math.cos(ph + t * 2) * t });
  }
  brushStroke(frame, { pts, width: 1.1, dry: 0.2, press: 0.1, tail: 0.5, seed: GRAVE.seed + 10 });
  // 細い煙（墨流しの糸）
  for (let k = 0; k < 2; k++) {
    const q = (f / GRAVE.frames + k * 0.5) % 1;
    if (q > 0.8) continue;
    const sp = [];
    for (let i = 0; i <= 6; i++) {
      const t = i / 6;
      sp.push({ x: -6 + Math.sin(t * 4 + q * TAU + k) * 2, y: 2 - q * 8 - t * 12 });
    }
    brushStroke(frame, { pts: sp, width: 0.7, fade: q * 0.7, dry: 0.3, body: lv(3), edge: lv(3), core: lv(4), press: 0.1, tail: 0.5, seed: GRAVE.seed + 11 + k });
  }
}

/** 置いてある間（地面）: 剣が刺さった所の土の割れと墨だまり、回転斬りの届く範囲の細い点線 */
function graveGround(frame, f) {
  const R = GRAVE.radiusPx * 2;
  inkBlot(frame, { x: 0, y: 6, radius: 4, seed: GRAVE.seed + 20, coreWidth: 0 });
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU + 0.4;
    const len = 7 + 5 * hash1(i, GRAVE.seed + 21);
    brushStroke(frame, { pts: [{ x: Math.cos(a) * 4, y: 6 + Math.sin(a) * 2.5 }, { x: Math.cos(a) * (4 + len), y: 6 + Math.sin(a) * (2.5 + len * 0.6) }], width: 0.9, dry: 0.2, press: 0.05, tail: 0.6, seed: GRAVE.seed + 22 + i });
  }
  dashRing(frame, { radius: R - 2, width: 1, level: 3, dashes: 12, phase: f / GRAVE.frames / 3, fill: 0.35, seed: GRAVE.seed + 30 });
}

const STAB_FRAMES = 7;

/** 刺す: 剣が空から真っ直ぐ落ち（上へ引く速度の擦れ）、地に刺さって土の飛沫が左右へ跳ねる */
function graveStab(frame, f) {
  const p = prog(f, STAB_FRAMES);
  const fall = smoothstep(0, 0.4, p);
  const oy = -46 * (1 - fall);
  drawSword(frame, oy);
  if (fall < 1) {
    for (const x of [-4, 0, 4]) brushStroke(frame, { pts: [{ x, y: oy - 38 }, { x, y: oy - 38 - 24 * (1 - fall) }], width: 1.2, dry: 0.6, fade: 0.3, press: 0.05, tail: 0.6, seed: GRAVE.seed + 40 + x });
  }
  if (p > 0.4) {
    const q = smoothstep(0.4, 1, p);
    brushStroke(frame, { pts: [{ x: -18 * q - 4, y: 7 }, { x: 18 * q + 4, y: 7 }], width: 3.5 * (1 - q) + 1, fade: q * 0.8, dry: 0.4, press: 0.3, tail: 0.3, seed: GRAVE.seed + 45 });
  }
  splatter(frame, f - 3, 12, GRAVE.seed + 46, (i, r) => {
    const sgn = r(1) > 0.5 ? 1 : -1;
    return { x: sgn * 3, y: 5, vx: sgn * (2 + 4 * r(2)), vy: -(1 + 3 * r(3)), size: r(4) > 0.5 ? 1.5 : 0.9, life: 4, level: 6 };
  });
}

/** 回転斬り: 剣を軸に一筆の円相が一周走り、筆先から接線へ飛沫 */
function graveSpin(frame, f) {
  const R = GRAVE.radiusPx * 2;
  const p = prog(f, GRAVE.frames);
  const g = smoothstep(0, 0.55, p);
  const fade = smoothstep(0.55, 1, p) * 0.9;
  enso(frame, { radius: R * 0.85, a0: Math.PI * 0.3, sweep: TAU * 1.05, width: 8, grow: g, fade, dry: 0.5, seed: GRAVE.seed + 50 });
  enso(frame, { radius: R * 0.55, a0: Math.PI * 1.3, sweep: TAU * 0.6, width: 3.5, grow: smoothstep(0.15, 0.7, p), fade: Math.min(1, fade * 1.2), dry: 0.6, seed: GRAVE.seed + 51 });
  splatter(frame, f, 12, GRAVE.seed + 52, (i, r) => {
    const born = r(1) * 4;
    const a = Math.PI * 0.3 + TAU * 1.05 * smoothstep(0, 0.55, (born + 0.5) / GRAVE.frames);
    const rr = R * 0.85;
    return { x: Math.cos(a) * rr, y: Math.sin(a) * rr, vx: -Math.sin(a) * (3 + 3 * r(2)) + Math.cos(a) * 1.5, vy: Math.cos(a) * (3 + 3 * r(2)) + Math.sin(a) * 1.5, size: r(3) > 0.6 ? 1.5 : 0.9, born, life: 4, level: 7 };
  });
}

// =============================================================================
// 湧き石: 石の泉・立ち昇る雫・噴水・吸い込まれる雫
// =============================================================================

const SPRING = {
  /** 泉の半径（px）。EXTRA_SKILL_TUNING.manaSpring.radius */
  radiusPx: 40,
  frames: 8,
  seed: SEED + 130,
};

/** 石の線画（横長の丸い石。ゆがんだ閉じた一筆と、面の淡墨・苔の点） */
function drawStone(frame) {
  const rx = 10;
  const ry = 7;
  const wob = (a) => 1 + 0.12 * (valueNoise(Math.cos(a) * 3 + 5, Math.sin(a) * 3 + 5, 1.5, SPRING.seed) - 0.5);
  thinFill(frame, (x, y) => { const a = Math.atan2(y, x); return (x / (rx * wob(a))) ** 2 + (y / (ry * wob(a))) ** 2 < 0.8; }, { x0: -12, y0: -9, x1: 12, y1: 9 }, { density: 0.7, level: 2, seed: SPRING.seed + 1, cell: 3 });
  const pts = [];
  for (let i = 0; i <= 40; i++) {
    const a = -Math.PI * 0.6 + (i / 40) * TAU * 1.02;
    pts.push({ x: Math.cos(a) * rx * wob(a), y: Math.sin(a) * ry * wob(a) });
  }
  line(frame, pts, 2.6, { seed: SPRING.seed + 2 });
  // 石の割れ目（湧き口）
  brushStroke(frame, { pts: [{ x: -3, y: -3 }, { x: 0, y: -1 }, { x: 2, y: -4 }], width: 0.9, dry: 0.1, press: 0.05, tail: 0.5, seed: SPRING.seed + 3 });
}

/** 置いてある間（地面）: 石と、石から外へ広がる波紋の輪（細く間の空いた筆）、泉の縁の淡い点線 */
function springGround(frame, f) {
  const R = SPRING.radiusPx * 2;
  for (let k = 0; k < 3; k++) {
    const q = (f / SPRING.frames + k / 3) % 1;
    const r = 14 + (R - 18) * q;
    enso(frame, { radius: r, a0: k * 2.1 + q, sweep: TAU * 0.8, width: 1.6 * (1 - 0.4 * q), steps: 48, wobble: 0.02, fade: 0.1 + 0.6 * q, dry: 0.3, body: lv(4), seed: SPRING.seed + 10 + k });
  }
  dashRing(frame, { radius: R - 2, width: 1, level: 3, dashes: 20, phase: 0, fill: 0.3, seed: SPRING.seed + 20 });
  drawStone(frame);
}

/** 置いてある間（空中）: 石の割れ目から雫が昇り、ふくらんで消える（気力が湧く） */
function springRise(frame, f) {
  for (let i = 0; i < 6; i++) {
    const r = (k) => hash1(i * 5 + k, SPRING.seed + 30);
    const q = (f / SPRING.frames + r(1)) % 1;
    if (q > 0.85) continue;
    const x = (r(2) - 0.5) * 10 + Math.sin(q * TAU + i) * 2;
    const y = -4 - q * (22 + 10 * r(3));
    teardrop(frame, x, y, q < 0.5 ? 1.6 : 1.1, 0, -1, q < 0.6 ? 6 : 5);
  }
}

/** 湧き出す: 石から墨の柱が噴き上がり、雫が放物線で四方へ落ち、波紋の円相が縁まで広がる */
function springBurst(frame, f) {
  const R = SPRING.radiusPx * 2;
  const p = prog(f, SPRING.frames);
  const up = smoothstep(0, 0.35, p);
  const fade = smoothstep(0.4, 1, p);
  brushStroke(frame, { pts: [{ x: 0, y: -2 }, { x: 0, y: -2 - 36 * up }], width: 6, fade, dry: 0.5, press: 0.1, tail: 0.5, seed: SPRING.seed + 40 });
  for (let i = 0; i < 12; i++) {
    const r = (k) => hash1(i * 7 + k, SPRING.seed + 41);
    const a = (i / 12) * TAU + r(1) * 0.4;
    const t = smoothstep(0.1, 0.9, p) * (0.8 + 0.3 * r(2));
    if (t <= 0 || t > 1) continue;
    const dist = R * (0.4 + 0.5 * r(3)) * t;
    const h = 40 * (0.6 + 0.4 * r(4)) * 4 * t * (1 - t);
    const x = Math.cos(a) * dist;
    const y = Math.sin(a) * dist * 0.6 - h;
    const fall = t > 0.5;
    teardrop(frame, x, y, 1.5, fall ? 0 : 0, fall ? 1 : -1, 6);
  }
  const e = smoothstep(0.2, 0.8, p);
  enso(frame, { radius: R * (0.2 + 0.75 * e), a0: 1, sweep: TAU * 0.85, width: 4 * (1 - 0.5 * e), wobble: 0.04, fade: smoothstep(0.5, 1, p) * 0.9, dry: 0.5, seed: SPRING.seed + 42 });
}

/** 吸う: 周りの雫が自分（中心）へ吸い込まれ、小さな円相が閉じる */
function springDrink(frame, f) {
  const p = prog(f, 6);
  converge(frame, 8, SPRING.seed + 50, 24, smoothstep(0, 0.8, p), 6);
  if (p > 0.4) enso(frame, { radius: 10 * (1 - 0.5 * smoothstep(0.4, 1, p)), a0: -1, sweep: TAU * 0.8, width: 1.3, fade: smoothstep(0.7, 1, p), dry: 0.3, seed: SPRING.seed + 51 });
}

// =============================================================================
// 砲台: 三脚と砲座・狙う向きへの砲身と砲口の墨・弾・組み上がり
// =============================================================================

const TURRET = {
  frames: 8,
  fireFrames: 6,
  seed: SEED + 150,
};

/** 三脚の脚の先（上から見た 3 本） */
const LEGS = [
  { x: -17, y: 11 },
  { x: 17, y: 11 },
  { x: 0, y: -17 },
];

/** 三脚の脚（grow で書き進む） */
function drawLegs(frame, grow = 1) {
  LEGS.forEach((l, i) => {
    const g = Math.max(0, Math.min(1, grow * 3 - i));
    if (g <= 0) return;
    brushStroke(frame, { pts: [{ x: l.x * 0.45, y: l.y * 0.45 }, { x: l.x * 0.7, y: l.y * 0.7 + 1 }, l], width: 1.5, grow: g, dry: 0.2, press: 0.08, tail: 0.25, sharp: 0.5, seed: TURRET.seed + i });
    drop(frame, l.x, l.y, 1.6, 6);
  });
}

/** 砲座: 丸い胴（閉じた円相と淡墨の面）と真ん中の軸の点 */
function drawDrum(frame, grow = 1) {
  thinFill(frame, (x, y) => Math.hypot(x, y) < 6.5, { x0: -8, y0: -8, x1: 8, y1: 8 }, { density: 0.9, level: 2, seed: TURRET.seed + 5, cell: 3 });
  enso(frame, { radius: 8, a0: -2, sweep: TAU * 0.97, width: 1.3, grow, dry: 0.15, tail: 0.2, seed: TURRET.seed + 6 });
  if (grow >= 1) drop(frame, 0, 0, 1.6, 7);
}

/** 置いてある間: 三脚と砲座と、狙う向き（+x。描画が砲台の狙いへ回す）へ向いた砲身。砲座の上の細い煙が揺れる */
function turretBody(frame, f) {
  drawLegs(frame);
  drawDrum(frame);
  brushStroke(frame, { pts: [{ x: 5, y: 0 }, { x: 17, y: 0 }], width: 2.4, profile: (u) => 1 - 0.25 * u, dry: 0.1, flat: true, seed: TURRET.seed + 8 });
  const q = f / TURRET.frames;
  const pts = [];
  for (let i = 0; i <= 5; i++) {
    const t = i / 5;
    pts.push({ x: 4 + Math.sin(q * TAU + t * 3) * 1.5, y: -9 - t * 9 });
  }
  brushStroke(frame, { pts, width: 0.7, dry: 0.4, fade: 0.2, body: lv(3), edge: lv(3), core: lv(4), press: 0.1, tail: 0.5, seed: TURRET.seed + 7 });
}

/** 組み上がる: 脚が一本ずつ書かれ、砲座の円相が閉じ、足元に墨が跳ねる */
function turretDeploy(frame, f) {
  const p = prog(f, 7);
  drawLegs(frame, smoothstep(0, 0.6, p));
  if (p > 0.45) drawDrum(frame, smoothstep(0.45, 0.85, p));
  splatter(frame, f - 1, 10, TURRET.seed + 10, (i, r) => {
    const a = r(1) * TAU;
    return { x: Math.cos(a) * 8, y: Math.sin(a) * 6, vx: Math.cos(a) * (2 + 3 * r(2)), vy: Math.sin(a) * (2 + 3 * r(2)), size: r(3) > 0.5 ? 1.3 : 0.8, life: 4, level: 6 };
  });
}

/** 撃つ（狙う向き = +x）: 砲身が突き出て反動で下がり、砲口で墨が弾け、煙の輪が前へ流れる */
function turretFire(frame, f) {
  const p = prog(f, TURRET.fireFrames);
  const recoil = f === 0 ? -3 : -3 * (1 - smoothstep(0.1, 0.7, p));
  const fade = smoothstep(0.75, 1, p) * 0.8;
  // 砲身: 砲座の縁から前へ太い一文字（根元が太い）
  brushStroke(frame, { pts: [{ x: 4 + recoil, y: 0 }, { x: 20 + recoil, y: 0 }], width: 3, profile: (u) => 1 - 0.25 * u, fade, dry: 0.1, seed: TURRET.seed + 20 });
  line(frame, [{ x: 19 + recoil, y: -3.5 }, { x: 19 + recoil, y: 3.5 }], 2, { fade, seed: TURRET.seed + 21 });
  // 砲口の墨: 一瞬で弾けて前へ飛ぶ
  if (p < 0.45) inkBlot(frame, { x: 22, y: 0, radius: 5 * (1 - p), seed: TURRET.seed + 22 + f, coreWidth: 0.5 });
  splatter(frame, f, 9, TURRET.seed + 23, (i, r) => ({ x: 22, y: 0, vx: 3 + 4 * r(1), vy: (r(2) - 0.5) * 6, size: r(3) > 0.5 ? 1.4 : 0.8, life: 4, level: 7 }));
  // 煙の輪: 前へ流れながら広がる
  const q = smoothstep(0.2, 1, p);
  if (q > 0) brushStroke(frame, { pts: arcPoints(24 + q * 10, 0, 2 + q * 4, 0.5, TAU * 0.8, 16), width: 0.8, fade: q * 0.8, dry: 0.2, body: lv(4), edge: lv(4), core: lv(5), seed: TURRET.seed + 24 });
}

/** 弾: 墨玉（芯は差し色）と、後ろへ引く掠れた筆の尾 */
function turretShell(frame, f) {
  brushStroke(frame, { pts: [{ x: -16, y: 0 }, { x: 0, y: 0 }], width: 3, profile: (u) => 0.3 + 0.7 * u, dry: 0.5, fade: 0.1 + 0.1 * (f % 2), seed: TURRET.seed + 30 + f });
  inkBlot(frame, { x: 1, y: 0, radius: 3.4, seed: TURRET.seed + 31 + f, coreWidth: 0.35 });
}

// =============================================================================
// 表
// =============================================================================

const size = (radiusPx, pad) => Math.ceil(radiusPx * 2 + pad) * 2;

const FX = {
  skills: {
    comboChain: {
      ramp: "steel",
      act: { sheet: "skillExtraB.comboThrust", life: 0.22 },
    },
    grudge: {
      ramp: "steel",
      cast: { sheet: "skillExtraB.grudgeWave", life: 0.42, base: GRUDGE.radiusPx, ground: "skillExtraB.grudgeGround" },
    },
    backflow: {
      ramp: "steel",
      // cast: pos = 元いた所、to = 戻った先
      cast: { sheet: "skillExtraB.backflowFade", life: 0.4, beam: { sheet: "skillExtraB.backflowTrail", step: BACK.stepPx }, tip: "skillExtraB.backflowArrive" },
    },
    scarRoar: {
      ramp: "steel",
      cast: { sheet: "skillExtraB.scarRoar", life: 0.45, base: SCAR.radiusPx, ground: "skillExtraB.scarGround" },
    },
    powderKeg: {
      ramp: "fire",
      placed: { sheet: "skillExtraB.kegBarrel", base: KEG.radiusPx, period: 0.6, ground: "skillExtraB.kegRange" },
      end: { sheet: "skillExtraB.kegBlast", life: 0.5, base: KEG.radiusPx, ground: "skillExtraB.kegScorch" },
    },
    swordGrave: {
      ramp: "steel",
      cast: { sheet: "skillExtraB.graveStab", life: 0.3 },
      placed: { sheet: "skillExtraB.graveSword", base: 0, period: 1.6, ground: "skillExtraB.graveGround" },
      act: { sheet: "skillExtraB.graveSpin", life: 0.25, base: GRAVE.radiusPx },
    },
    manaSpring: {
      ramp: "steel",
      cast: { sheet: "skillExtraB.springBurst", life: 0.45, base: SPRING.radiusPx },
      placed: { sheet: "skillExtraB.springRise", base: SPRING.radiusPx, period: 1.6, ground: "skillExtraB.springGround" },
      act: { sheet: "skillExtraB.springDrink", life: 0.25 },
    },
    turret: {
      ramp: "brass",
      cast: { sheet: "skillExtraB.turretDeploy", life: 0.3 },
      placed: { sheet: "skillExtraB.turretBody", base: 0, period: 2 },
      // 砲身は向きのある撃つ絵に描くので、次の射撃までしばらく狙う向きに残す
      act: { sheet: "skillExtraB.turretFire", life: 0.32 },
      fly: { sheet: "skillExtraB.turretShell", base: 0, period: 0.15 },
    },
  },
};

const sheet = (key, dirs, frames, sz, draw) => ({ key: `skillExtraB.${key}`, dirs, frames, active: 0, size: sz, draw });

export const ATLAS = {
  key: "skillExtraB",
  fx: FX,
  sheets: [
    sheet("comboThrust", DIRS, CHAIN.frames, 200, comboThrust),
    sheet("grudgeWave", DIRS, GRUDGE.frames, size(GRUDGE.radiusPx, 24), grudgeWave),
    sheet("grudgeGround", DIRS, GRUDGE.frames, size(GRUDGE.radiusPx, 4), grudgeGround),
    sheet("backflowFade", 1, BACK.frames, 72, backflowFade),
    { ...sheet("backflowTrail", 1, BACK.frames, 40, backflowTrail), ink: false },
    sheet("backflowArrive", 1, BACK.frames, 72, backflowArrive),
    sheet("scarRoar", 1, SCAR.frames, size(SCAR.radiusPx, 24), scarRoar),
    sheet("scarGround", 1, SCAR.frames, size(SCAR.radiusPx, 8), scarGround),
    // 樽は細い線の物の絵。墨の筆致の仕上げを掛けると胴の内側が埋まって墨の塊になるので掛けない
    { ...sheet("kegBarrel", 1, KEG.frames, 64, kegBarrel), ink: false },
    sheet("kegRange", 1, KEG.frames, size(KEG.radiusPx, 6), kegRange),
    sheet("kegBlast", 1, KEG.blastFrames, size(KEG.radiusPx, 30), kegBlast),
    sheet("kegScorch", 1, KEG.blastFrames, size(KEG.radiusPx, 8), kegScorch),
    sheet("graveSword", 1, GRAVE.frames, 104, graveSword),
    sheet("graveGround", 1, GRAVE.frames, size(GRAVE.radiusPx, 8), graveGround),
    sheet("graveStab", 1, STAB_FRAMES, 220, graveStab),
    sheet("graveSpin", 1, GRAVE.frames, size(GRAVE.radiusPx, 14), graveSpin),
    sheet("springGround", 1, SPRING.frames, size(SPRING.radiusPx, 6), springGround),
    sheet("springRise", 1, SPRING.frames, 96, springRise),
    sheet("springBurst", 1, SPRING.frames, size(SPRING.radiusPx, 30), springBurst),
    sheet("springDrink", 1, 6, 64, springDrink),
    sheet("turretBody", DIRS, TURRET.frames, 56, turretBody),
    sheet("turretDeploy", 1, 7, 72, turretDeploy),
    sheet("turretFire", DIRS, TURRET.fireFrames, 96, turretFire),
    sheet("turretShell", DIRS, 4, 48, turretShell),
  ],
};
