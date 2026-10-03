// 技（共通技）の墨のエフェクト C 組（docs/ideas/fx-sprites.md 10 章）。単位は絵のドット（論理 0.5px）。正準の向きは +x（照準の向き）
// 行為の種類ごと（acts.<種類>）に絵を持つ。数値（半径・長さ・幅）は src/data/balance/skills/ART/common.json の値 × 2 ドットで描く
//
// 地叩き（commonTremor。ring 38px・瓦礫）: 叩いた所の墨だまりから地割れの筆が放射に走り、震える円相が揺れを描く。瓦礫の墨の欠片が跳ね上がって落ちる
// 跳ね返し（commonDeflect。ring 26px・弾消し）: 体の周りを一息に払う細い円相と、輪で折れて外へ跳ね返る「レ」の筆（跳弾の跡）
// 煙幕玉（commonSmokeScreen。ring 10px・煙 32px）: 足元で玉が割れ、淡墨の煙の塊がもくもくと巻きながら広がる
// 貫通突き（commonPierce。line 78px・幅 12px）: 踏み込みの蹴り、細く鋭い一文字の針、穂先の楔から飛沫が先へ抜ける
// 地裂き（commonQuake。line 72px・幅 24px・瓦礫）: 叩きつけの墨だまり、ジグザグの地割れの筆と両脇の瓦礫、終点で崩れる塊
// 炎の壁（commonFireWall。line 70px・幅 20px・火）: 帯に沿って墨の炎の舌が両側へ揺らぐ（芯だけ火の差し色）、終点に火柱
// 押し込み（commonShove。line 50px・幅 30px）: 掌底の押印、刷毛で擦った幅広の飛白、先頭で押し寄せる弓なりの波
// 三日月（commonCrescent。arcWide 220°・42px）: 真ん中が太り両端が尖る三日月の一筆が大きく回り込む
// 血刃（commonBleedEdge。arc 90°・30px・出血）: 鋭く細い斬り筋から墨の血が垂れ、雫が滴る
// 昇り斬り（commonRisingSlash。arc 90°・32px・叩きつけ）: 下から上へ太く斬り上げて跳ねる筆と、昇る飛沫・昇る筋
// 百裂（commonFlurry。arc 70°・30px・6 連撃）: 短い打ち込みの筆が 6 つ、次々に交差して刻まれる
// 炸裂玉（commonBomb。ringTarget 32px）: 墨玉が膨らんで弾け、瘤と舌の墨しぶきが四方へ飛び（舌の先に雫）、床に染みが残る
// 冷却弾（commonFreezeBomb。ringTarget 32px・氷）: 一滴が落ちて筆の大きな六花が開き、床は氷の差し色の滲み
// 閃光弾（commonFlashBang。ringTarget 36px・沈黙・恐怖）: 光ではなく目くらましの淡墨の煙が弾け、破裂の楔が跳び、震える声の円相が二重に広がる（沈黙と怯え）
import { brushStroke, enso, inkBlot, inkWash, lv, splatter } from "../brush.mjs";
import { hash1, paint, smoothstep, valueNoise } from "../raster.mjs";
import { DIRS, WIDE_DIRS } from "../motifs.mjs";

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const SEED = 7301;

/** コマの進み具合（0..1。コマの真ん中） */
function prog(f, frames) {
  return (f + 0.5) / frames;
}

/** 多角形の内側か（偶奇則） */
function insidePoly(pts, x, y) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i];
    const b = pts[j];
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y || 1e-6) + a.x) inside = !inside;
  }
  return inside;
}

/** 墨の欠片（瓦礫）: 角ばった 4〜5 角形を塗る。縁は濃墨、真ん中に芯の段の点 */
function chunk(frame, x, y, size, rot, seed, level = 5) {
  const n = 4 + Math.floor(hash1(1, seed) * 2);
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = rot + (i / n) * TAU + (hash1(i + 3, seed) - 0.5) * 0.9;
    const r = size * (0.6 + 0.5 * hash1(i + 11, seed));
    pts.push({ x: x + Math.cos(a) * r, y: y + Math.sin(a) * r });
  }
  paint(
    frame,
    (px, py) => {
      if (!insidePoly(pts, px, py)) return -1;
      return Math.hypot(px - x, py - y) < size * 0.3 ? lv(7) : lv(level);
    },
    { bounds: { x0: x - size * 1.3, y0: y - size * 1.3, x1: x + size * 1.3, y1: y + size * 1.3 }, dither: 0 },
  );
}

/** ジグザグの折れ線（地割れ）。from → to を n 区間に分け、横へ jitter ドット振る */
function jagged(x0, y0, x1, y1, n, jitter, seed) {
  const pts = [];
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const j = i === 0 ? 0 : (hash1(i, seed) - 0.5) * 2 * jitter * (i % 2 === 0 ? 1 : -1);
    pts.push({ x: x0 + dx * t + nx * j, y: y0 + dy * t + ny * j });
  }
  return pts;
}

/** 放射に飛ぶ飛沫（中心 cx, cy から外へ） */
function burstSplatter(frame, f, count, seed, o) {
  splatter(frame, f, count, seed, (i, r) => {
    const a = r(1) * TAU;
    const at = (o.at ?? 2) + (o.spread ?? 0) * r(5);
    const sp = o.speed[0] + (o.speed[1] - o.speed[0]) * r(2);
    return {
      x: (o.cx ?? 0) + Math.cos(a) * at,
      y: (o.cy ?? 0) + Math.sin(a) * at,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp,
      size: r(3) > 0.55 ? o.big ?? 1.6 : 0.9,
      born: o.born ? Math.floor(r(6) * o.born) : 0,
      life: o.life ?? 5,
      level: r(4) > 0.5 ? 7 : 5,
    };
  });
}

// ===========================================================================
// 地叩き（ring・半径 38px）
// ===========================================================================

const TREMOR = { radiusPx: 38, frames: 9, seed: SEED + 100 };
const TREMOR_R = TREMOR.radiusPx * 2;
const TREMOR_CRACKS = Array.from({ length: 8 }, (_, i) => {
  const a = (i / 8) * TAU + (hash1(i, TREMOR.seed) - 0.5) * 0.5;
  const len = TREMOR_R * (0.55 + 0.35 * hash1(i + 20, TREMOR.seed));
  return jagged(Math.cos(a) * 8, Math.sin(a) * 8, Math.cos(a) * len, Math.sin(a) * len, 5, 4, TREMOR.seed + i);
});

/** 地面: 叩いた墨だまり・地割れの筆・震える円相 */
function tremorGround(frame, f) {
  const p = prog(f, TREMOR.frames);
  const fade = smoothstep(0.55, 1, p) * 0.9;
  if (p < 0.85) inkBlot(frame, { radius: 15 - 4 * p, seed: TREMOR.seed + 1, coreWidth: 0.3 });
  TREMOR_CRACKS.forEach((pts, i) => brushStroke(frame, { pts, width: 3.2, grow: smoothstep(0, 0.4, p), fade, dry: 0.35, press: 0.05, tail: 0.5, seed: TREMOR.seed + 10 + i }));
  // 揺れ: 円相がぶるぶる震える（コマごとに揺れの種を変える）
  const g = smoothstep(0.05, 0.5, p);
  enso(frame, { radius: TREMOR_R * 0.9, a0: -Math.PI * 0.6, sweep: TAU * 0.9, width: 6, wobble: 0.1, steps: 40, grow: g, fade, dry: 0.5, seed: TREMOR.seed + 30 + (f % 3) });
  if (p > 0.25) enso(frame, { radius: TREMOR_R * 0.7, a0: Math.PI * 0.4, sweep: TAU * 0.55, width: 3, wobble: 0.14, steps: 30, grow: smoothstep(0.25, 0.6, p), fade: Math.min(1, fade * 1.2), dry: 0.6, seed: TREMOR.seed + 40 + (f % 2) });
}

/** 空中: 瓦礫の欠片が跳ね上がって落ちる・土の飛沫 */
function tremorAir(frame, f) {
  const p = prog(f, TREMOR.frames);
  for (let i = 0; i < 11; i++) {
    const r = (k) => hash1(i * 7 + k, TREMOR.seed + 50);
    const born = r(1) * 0.2;
    const t = (p - born) / 0.75;
    if (t < 0 || t > 1) continue;
    const a = r(2) * TAU;
    const d0 = TREMOR_R * (0.3 + 0.55 * r(3));
    const d = d0 + 10 * t * r(4);
    const h = (14 + 16 * r(5)) * Math.sin(Math.PI * t);
    chunk(frame, Math.cos(a) * d, Math.sin(a) * d - h, (4 + 4 * r(6)) * (1 - 0.35 * t), r(7) * TAU + t * 3, TREMOR.seed + 60 + i);
  }
  burstSplatter(frame, f, 16, TREMOR.seed + 70, { at: 10, spread: 30, speed: [2, 5], life: 5, born: 2 });
}

// ===========================================================================
// 跳ね返し（ring・半径 26px）
// ===========================================================================

const DEFLECT = { radiusPx: 26, frames: 8, seed: SEED + 200 };
const DEFLECT_R = DEFLECT.radiusPx * 2;

function deflect(frame, f) {
  const p = prog(f, DEFLECT.frames);
  const fade = smoothstep(0.5, 1, p) * 0.9;
  // 一息に払う細い円相（速い。閉じきらない）
  enso(frame, { radius: DEFLECT_R * 0.82, a0: -Math.PI * 0.3, sweep: TAU * 0.95, width: 5, grow: smoothstep(0, 0.35, p), fade, dry: 0.65, press: 0.06, tail: 0.6, seed: DEFLECT.seed });
  // 跳弾の「レ」: 輪の外から飛び込み、輪で折れて外へ跳ね返る筆
  const g = smoothstep(0.2, 0.6, p);
  if (g <= 0.01) return;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + 0.4 + (hash1(i, DEFLECT.seed + 1) - 0.5) * 0.4;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const tx = -s;
    const ty = c;
    const R0 = DEFLECT_R * 0.84;
    const out = 10 + 14 * g;
    const side = i % 2 === 0 ? 1 : -1;
    const pts = [
      { x: c * (R0 + 10) + tx * 8 * side, y: s * (R0 + 10) + ty * 8 * side },
      { x: c * R0, y: s * R0 },
      { x: c * (R0 + out) - tx * 4 * side, y: s * (R0 + out) - ty * 4 * side },
    ];
    brushStroke(frame, { pts, width: 2.8, grow: g, fade: Math.min(1, fade * 1.1), dry: 0.4, press: 0.08, tail: 0.6, seed: DEFLECT.seed + 10 + i });
  }
  splatter(frame, f, 12, DEFLECT.seed + 30, (i, r) => {
    const a = r(1) * TAU;
    return { x: Math.cos(a) * DEFLECT_R * 0.84, y: Math.sin(a) * DEFLECT_R * 0.84, vx: Math.cos(a) * (3 + 3 * r(2)), vy: Math.sin(a) * (3 + 3 * r(2)), size: r(3) > 0.6 ? 1.4 : 0.8, born: 2 + Math.floor(r(4) * 2), life: 4, level: 7 };
  });
}

// ===========================================================================
// 煙幕玉（ring・半径 10px。煙は 32px まで広がる）
// ===========================================================================

const SMOKE = { radiusPx: 10, cloudPx: 32, frames: 10, seed: SEED + 300 };
const SMOKE_R = SMOKE.cloudPx * 2;

/** 煙の塊 1 つ: 淡墨の巻いた輪郭（筆）と、中の渦、薄いむら */
function puff(frame, cx, cy, r, grow, fade, seed) {
  paint(
    frame,
    (x, y) => {
      const d = Math.hypot(x - cx, y - cy);
      if (d > r * 0.92) return -1;
      if (((Math.floor(x) + Math.floor(y)) & 1) === 1) return -1;
      if (hash1(Math.floor(x) * 97 + Math.floor(y), seed) < 0.35 + fade * 0.6) return -1;
      return lv(1);
    },
    { bounds: { x0: cx - r, y0: cy - r, x1: cx + r, y1: cy + r }, dither: 0 },
  );
  enso(frame, { ox: cx, oy: cy, radius: r, a0: hash1(1, seed) * TAU, sweep: TAU * 0.78, width: 3, wobble: 0.16, steps: 28, grow, fade, dry: 0.55, core: lv(4), body: lv(3), edge: lv(2), seed });
  // 中の渦（巻き込む小さな一筆）
  const swirl = [];
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    const a = hash1(2, seed) * TAU + t * TAU * 0.9;
    const rr = r * (0.55 - 0.35 * t);
    swirl.push({ x: cx + Math.cos(a) * rr, y: cy + Math.sin(a) * rr });
  }
  brushStroke(frame, { pts: swirl, width: 1.8, grow, fade: Math.min(1, fade * 1.2), dry: 0.4, core: lv(3), body: lv(3), edge: lv(2), seed: seed + 1 });
}

function smokeAir(frame, f) {
  const p = prog(f, SMOKE.frames);
  // 玉が割れる: 小さな墨玉が潰れて欠片が散る
  if (p < 0.22) inkBlot(frame, { radius: 7, seed: SMOKE.seed, coreWidth: 0.3 });
  if (p < 0.5) for (let i = 0; i < 4; i++) chunk(frame, Math.cos(i * 1.7) * (4 + 14 * p), Math.sin(i * 1.7) * (4 + 14 * p), 2, i, SMOKE.seed + 5 + i, 6);
  const spread = smoothstep(0.05, 0.75, p);
  const fade = smoothstep(0.7, 1, p) * 0.9;
  for (let i = 0; i < 8; i++) {
    const r = (k) => hash1(i * 5 + k, SMOKE.seed + 20);
    const a = (i / 8) * TAU + r(1) * 0.5;
    const d = SMOKE_R * (0.3 + 0.25 * r(2)) * spread;
    const size = (6 + 12 * r(3)) * (0.4 + 0.6 * spread);
    puff(frame, Math.cos(a) * d, Math.sin(a) * d - 6 * p, size, smoothstep(0.05 + r(4) * 0.2, 0.55, p), fade, SMOKE.seed + 30 + i * 3);
  }
  puff(frame, 0, -4 * p, 10 + 12 * spread, smoothstep(0, 0.4, p), fade, SMOKE.seed + 60);
}

/** 地面: 淡墨の滲みが煙の届く所まで広がる（間引き） */
function smokeGround(frame, f) {
  const p = prog(f, SMOKE.frames);
  inkWash(frame, { radius: SMOKE_R * 0.85, reach: smoothstep(0, 0.7, p), seed: SMOKE.seed + 70, rimWidth: 2, rimLevel: 2, tint: 1, density: 0.35 * (1 - smoothstep(0.7, 1, p)), cell: 7 });
}

// ===========================================================================
// 貫通突き（line・78px・幅 12px）
// ===========================================================================

const PIERCE = { stepPx: 12, frames: 7, seed: SEED + 400 };

/** 踏み込み: 後ろへ蹴った飛沫と、手元から前へ伸びる尖った墨 */
function piercePress(frame, f) {
  const p = prog(f, PIERCE.frames);
  brushStroke(frame, { pts: [{ x: -4, y: 0 }, { x: 26, y: 0 }], width: 7, grow: smoothstep(0, 0.3, p), fade: smoothstep(0.4, 1, p), dry: 0.3, press: 0.15, tail: 0.85, seed: PIERCE.seed });
  splatter(frame, f, 9, PIERCE.seed + 1, (i, r) => ({ x: -4, y: (r(1) - 0.5) * 6, vx: -(2 + 4 * r(2)), vy: (r(3) - 0.5) * 7, size: r(4) > 0.5 ? 1.4 : 0.8, life: 5, level: 6 }));
}

/** 針の一文字（区間）: 細い芯の線と、その両脇に風を切る淡い毛筋 */
function pierceBeam(frame, f) {
  const p = prog(f, PIERCE.frames);
  const half = PIERCE.stepPx + 0.6;
  const fade = smoothstep(0.25, 1, p) * 0.8;
  brushStroke(frame, { pts: [{ x: -half, y: 0 }, { x: half, y: 0 }], width: 4.5 * (1 - 0.5 * p) + 0.8, profile: () => 1, flat: true, dry: 0, fade, pitch: 1.2, breakLen: 40, seed: PIERCE.seed + 10 });
  for (const side of [-1, 1]) {
    if (p > 0.75) continue;
    brushStroke(frame, { pts: [{ x: -half, y: side * 9 }, { x: half, y: side * 9 }], width: 0.9, profile: () => 1, flat: true, dry: 0, fade: Math.min(1, 0.35 + fade), core: lv(3), body: lv(3), edge: lv(2), breakLen: 7, seed: PIERCE.seed + 11 + side });
  }
}

/** 穂先: 楔の筆が尖って前を指し、飛沫が細く先へ抜ける（貫通） */
function pierceTip(frame, f) {
  const p = prog(f, PIERCE.frames);
  const fade = smoothstep(0.45, 1, p) * 0.9;
  brushStroke(frame, { pts: [{ x: -18, y: 0 }, { x: 16, y: 0 }], width: 6, profile: (u) => (u < 0.25 ? 0.6 + 1.6 * u : 1 - (u - 0.25) / 0.8), fade, dry: 0.2, seed: PIERCE.seed + 20 });
  splatter(frame, f, 12, PIERCE.seed + 21, (i, r) => ({ x: 12, y: (r(1) - 0.5) * 3, vx: 5 + 6 * r(2), vy: (r(3) - 0.5) * 2.4, size: r(4) > 0.5 ? 1.3 : 0.8, born: Math.floor(r(5) * 2), life: 5, level: 7 }));
}

// ===========================================================================
// 地裂き（line・72px・幅 24px・瓦礫）
// ===========================================================================

const QUAKE = { stepPx: 12, halfDots: 24, frames: 8, seed: SEED + 500 };

/** 叩きつけ: 重い墨だまりが横へ潰れて飛ぶ */
function quakePress(frame, f) {
  const p = prog(f, QUAKE.frames);
  if (p < 0.8) inkBlot(frame, { x: 4, radius: 13 * (1.2 - 0.4 * p), seed: QUAKE.seed, coreWidth: 0.35 - 0.3 * p });
  splatter(frame, f, 14, QUAKE.seed + 1, (i, r) => {
    const side = r(1) > 0.5 ? 1 : -1;
    return { x: 4, y: side * 4, vx: (r(2) - 0.3) * 4, vy: side * (3 + 4 * r(3)), size: r(4) > 0.5 ? 1.8 : 1, life: 5, level: 6 };
  });
}

/** 地割れ（区間）: ジグザグの割れの筆と、両脇に押し上がる瓦礫。コマが進むと割れが開いて瓦礫が外へずれる */
function quakeBeam(frame, f) {
  const p = prog(f, QUAKE.frames);
  const half = QUAKE.stepPx + 0.6;
  const open = smoothstep(0, 0.5, p);
  const fade = smoothstep(0.55, 1, p) * 0.85;
  // 区間の端は y = 0 で継ぐ（1 区間で 1 往復）
  const pts = [
    { x: -half, y: 0 },
    { x: -6, y: 5 },
    { x: 0, y: -1 },
    { x: 5, y: -6 },
    { x: half, y: 0 },
  ];
  brushStroke(frame, { pts, width: 4 + 2 * open, profile: () => 1, flat: true, dry: 0, fade, pitch: 1.3, breakLen: 30, seed: QUAKE.seed + 10 });
  // 割れ口の両縁（細い線）
  for (const side of [-1, 1]) {
    const edge = pts.map((q) => ({ x: q.x, y: q.y + side * (7 + 3 * open) }));
    brushStroke(frame, { pts: edge, width: 1.2, profile: () => 1, flat: true, dry: 0, fade: Math.min(1, fade + 0.2), breakLen: 6, seed: QUAKE.seed + 12 + side });
  }
  // 瓦礫: 区間ごとに 3 つずつ両脇へ
  for (let i = 0; i < 4; i++) {
    const r = (k) => hash1(i * 9 + k, QUAKE.seed + 20);
    const side = i % 2 === 0 ? 1 : -1;
    const x = -10 + 20 * r(1);
    const y = side * (12 + 9 * r(2) + 4 * open);
    if (hash1(i + 40, QUAKE.seed) < fade * 1.1) continue;
    chunk(frame, x, y, 3.5 + 2.5 * r(3), r(4) * TAU, QUAKE.seed + 30 + i);
  }
}

/** 崩れ: 終点に大きな塊が崩れ落ちて、欠片と飛沫が前と横へ */
function quakeTip(frame, f) {
  const p = prog(f, QUAKE.frames);
  const fade = smoothstep(0.5, 1, p);
  if (p < 0.7) inkBlot(frame, { radius: 12 * (0.9 + 0.4 * p), seed: QUAKE.seed + 40, coreWidth: 0.3 });
  for (let i = 0; i < 7; i++) {
    const r = (k) => hash1(i * 5 + k, QUAKE.seed + 41);
    if (r(9) < fade) continue;
    const a = (r(1) - 0.5) * Math.PI * 1.3;
    const d = 8 + 18 * p * (0.5 + r(2));
    chunk(frame, Math.cos(a) * d, Math.sin(a) * d, 4.5 + 3.5 * r(3), r(4) * TAU + p * 2, QUAKE.seed + 50 + i);
  }
  splatter(frame, f, 12, QUAKE.seed + 60, (i, r) => {
    const a = (r(1) - 0.5) * Math.PI * 1.4;
    return { x: 0, y: 0, vx: Math.cos(a) * (3 + 4 * r(2)), vy: Math.sin(a) * (3 + 4 * r(2)), size: r(3) > 0.5 ? 1.7 : 1, life: 6, level: 6 };
  });
}

// ===========================================================================
// 炎の壁（line・70px・幅 20px・火）
// ===========================================================================

const FIREWALL = { stepPx: 10, frames: 8, seed: SEED + 600 };

/** 炎の舌 1 本: 根から外へ、揺らぎながら尖る筆 */
function flameTongue(frame, x, side, len, sway, w, fade, grow, seed) {
  const pts = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    pts.push({ x: x + Math.sin(t * Math.PI * 1.3 + sway) * 4 * t, y: side * (1 + len * t) });
  }
  brushStroke(frame, { pts, width: w, grow, fade, dry: 0.25, press: 0.2, tail: 0.7, sharp: 1, coreWidth: 0.22, seed });
}

function firePress(frame, f) {
  const p = prog(f, FIREWALL.frames);
  if (p < 0.6) inkBlot(frame, { x: 6, radius: 10 * (1 - 0.5 * p), seed: FIREWALL.seed, coreWidth: 0.3 });
  for (let i = 0; i < 3; i++) flameTongue(frame, 4 + i * 6, i % 2 === 0 ? -1 : 1, 12 + 6 * Math.sin(f + i), f * 0.9 + i, 4.5, smoothstep(0.55, 1, p), smoothstep(0, 0.35, p), FIREWALL.seed + 1 + i);
  burstSplatter(frame, f, 8, FIREWALL.seed + 5, { cx: 6, speed: [1.5, 3.5], life: 5, big: 1.2 });
}

/** 炎の帯（区間）: 根の一文字の上に、両側へ高く揺らぐ炎の舌（コマで揺れが進む）。区間ごとに 3 本で壁の厚みを出す */
function fireBeam(frame, f) {
  const p = prog(f, FIREWALL.frames);
  const half = FIREWALL.stepPx + 0.6;
  const fade = smoothstep(0.6, 1, p) * 0.85;
  const grow = smoothstep(0, 0.2, p);
  brushStroke(frame, { pts: [{ x: -half, y: 0 }, { x: half, y: 0 }], width: 5, profile: () => 1, flat: true, dry: 0, fade: fade * 0.9, coreWidth: 0.2, breakLen: 14, seed: FIREWALL.seed + 10 });
  const flick = f * 1.1;
  // 上下に大きな舌を 1 本ずつと、間に短い舌。長さはコマで伸び縮み（燃え立つ）。壁の幅（±20 ドット）を越えて立ち昇る
  flameTongue(frame, -6, -1, (30 + 7 * Math.sin(flick)) * grow, flick, 7, fade, grow, FIREWALL.seed + 11);
  flameTongue(frame, 4, 1, (27 + 7 * Math.sin(flick + 2)) * grow, flick + 1.5, 7, fade, grow, FIREWALL.seed + 12);
  flameTongue(frame, 1, f % 2 === 0 ? -1 : 1, (16 + 5 * Math.sin(flick + 4)) * grow, flick + 3, 5, Math.min(1, fade * 1.2), grow, FIREWALL.seed + 13);
  // 火の粉（差し色の小さな粒）
  for (let i = 0; i < 2; i++) {
    const r = (k) => hash1(i * 7 + f * 31 + k, FIREWALL.seed + 14);
    if (r(5) < fade) continue;
    const side = r(1) > 0.5 ? 1 : -1;
    paint(frame, (x, y) => (Math.hypot(x - (r(2) - 0.5) * 18, y - side * (32 + 8 * r(3))) < 1 ? lv(7) : -1), { bounds: { x0: -12, y0: -44, x1: 12, y1: 44 }, dither: 0 });
  }
}

/** 終点の火柱: 舌が束になって燃え立ち、火の粉が散る */
function fireTip(frame, f) {
  const p = prog(f, FIREWALL.frames);
  const fade = smoothstep(0.5, 1, p) * 0.9;
  const grow = smoothstep(0, 0.35, p);
  for (let i = 0; i < 5; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    flameTongue(frame, -6 + i * 3, side, (20 + 10 * hash1(i, FIREWALL.seed + 20) + 5 * Math.sin(f + i)) * grow, f + i * 1.3, 6.5, fade, grow, FIREWALL.seed + 21 + i);
  }
  burstSplatter(frame, f, 12, FIREWALL.seed + 30, { speed: [2, 4.5], life: 6, big: 1.2, born: 3 });
}

// ===========================================================================
// 押し込み（line・50px・幅 30px）
// ===========================================================================

const SHOVE = { stepPx: 12, halfDots: 26, frames: 8, seed: SEED + 700 };

/** 掌底: 刷毛を縦に押し当てた太い一画（掌の幅）と、押した反動で後ろへ跳ねる飛沫 */
function shovePress(frame, f) {
  const p = prog(f, SHOVE.frames);
  const fade = smoothstep(0.35, 1, p) * 0.9;
  brushStroke(frame, {
    pts: [
      { x: 8, y: -22 },
      { x: 11, y: 0 },
      { x: 8, y: 22 },
    ],
    width: 7,
    grow: smoothstep(0, 0.3, p),
    fade,
    dry: 0.5,
    press: 0.2,
    tail: 0.4,
    seed: SHOVE.seed + 1,
  });
  splatter(frame, f, 8, SHOVE.seed + 2, (i, r) => ({ x: 4, y: (r(1) - 0.5) * 30, vx: -(1.5 + 3 * r(2)), vy: (r(3) - 0.5) * 3, size: r(4) > 0.5 ? 1.3 : 0.8, life: 4, level: 6 }));
}

/** 刷毛の飛白（区間）: 幅広の毛筋の帯。進むほど毛筋が途切れる */
function shoveBeam(frame, f) {
  const p = prog(f, SHOVE.frames);
  const half = SHOVE.stepPx + 0.6;
  brushStroke(frame, {
    pts: [
      { x: -half, y: 0 },
      { x: half, y: 0 },
    ],
    width: SHOVE.halfDots * (1 - 0.25 * p),
    profile: () => 1,
    flat: true,
    dry: 0,
    fade: 0.32 + 0.6 * smoothstep(0.15, 1, p),
    pitch: 2,
    breakLen: 10,
    coreWidth: 0.12,
    seed: SHOVE.seed + 10,
  });
}

/** 押し寄せ: 先頭の弓なりの太い筆（前へ膨らむ）が 2 重に押し出し、飛沫が前へ */
function shoveTip(frame, f) {
  const p = prog(f, SHOVE.frames);
  const fade = smoothstep(0.45, 1, p) * 0.9;
  const push = 10 * smoothstep(0, 0.7, p);
  const bow = (x0, bulge, h) => {
    const pts = [];
    for (let i = 0; i <= 16; i++) {
      const t = i / 16;
      pts.push({ x: x0 + bulge * Math.sin(t * Math.PI), y: -h + 2 * h * t });
    }
    return pts;
  };
  brushStroke(frame, { pts: bow(-6 + push, 12, SHOVE.halfDots + 4), width: 7, grow: smoothstep(0, 0.35, p), fade, dry: 0.45, seed: SHOVE.seed + 20 });
  brushStroke(frame, { pts: bow(-16 + push * 0.6, 9, SHOVE.halfDots - 4), width: 3.5, grow: smoothstep(0.1, 0.45, p), fade: Math.min(1, fade * 1.2), dry: 0.6, seed: SHOVE.seed + 21 });
  splatter(frame, f, 14, SHOVE.seed + 22, (i, r) => ({ x: 6, y: (r(1) - 0.5) * 50, vx: 4 + 4 * r(2), vy: (r(3) - 0.5) * 2, size: r(4) > 0.5 ? 1.6 : 0.9, born: Math.floor(r(5) * 2), life: 5, level: 7 }));
}

// ===========================================================================
// 三日月（arcWide 220°・届き 42px）
// ===========================================================================

const CRES = { reachPx: 42, deg: 220, frames: 10, seed: SEED + 800 };
const CRES_R = CRES.reachPx * 2;

function crescent(frame, f) {
  const p = prog(f, CRES.frames);
  const half = (CRES.deg * DEG) / 2;
  const grow = smoothstep(0, 0.55, p);
  const fade = smoothstep(0.55, 1, p) * 0.9;
  // 真ん中が太り、両端が尖る（三日月の形）
  const moon = (u) => 0.12 + 0.88 * Math.pow(Math.sin(Math.PI * u), 0.8);
  enso(frame, { radius: CRES_R * 0.8, a0: -half, sweep: half * 2, width: 13, profile: moon, grow, fade, dry: 0.35, steps: 56, wobble: 0.02, seed: CRES.seed });
  // 内側に細い二の筆（月の影）
  const g2 = smoothstep(0.2, 0.7, p);
  if (g2 > 0.02) enso(frame, { radius: CRES_R * 0.56, a0: -half * 0.8, sweep: half * 1.6, width: 3.5, profile: moon, grow: g2, fade: Math.min(1, fade * 1.2), dry: 0.6, steps: 40, seed: CRES.seed + 1 });
  // 筆の先から外へ飛ぶ飛沫
  splatter(frame, f, 14, CRES.seed + 2, (i, r) => {
    const born = Math.floor(r(1) * 6);
    const a = -half + half * 2 * smoothstep(0, 0.55, (born + 0.5) / CRES.frames);
    const rr = CRES_R * 0.82;
    return { x: Math.cos(a) * rr, y: Math.sin(a) * rr, vx: Math.cos(a) * (2 + 3 * r(2)) - Math.sin(a) * 2, vy: Math.sin(a) * (2 + 3 * r(2)) + Math.cos(a) * 2, size: r(3) > 0.6 ? 1.6 : 0.9, born, life: 4, level: 7 };
  });
}

// ===========================================================================
// 血刃（arc 90°・届き 30px・出血）
// ===========================================================================

const BLEED = { reachPx: 30, frames: 10, seed: SEED + 900 };
const BLEED_R = BLEED.reachPx * 2;

/** 斬り筋の折れ線（向こうからこちらへ斜めに浅く反る一閃） */
const BLEED_CUT = Array.from({ length: 13 }, (_, i) => {
  const t = i / 12;
  const a = (-48 + 96 * t) * DEG;
  const r = BLEED_R * (0.72 + 0.16 * Math.sin(t * Math.PI));
  return { x: Math.cos(a) * r, y: Math.sin(a) * r };
});

function bleedEdge(frame, f) {
  const p = prog(f, BLEED.frames);
  const grow = smoothstep(0, 0.25, p);
  const fade = smoothstep(0.6, 1, p) * 0.9;
  brushStroke(frame, { pts: BLEED_CUT, width: 4.5, grow, fade, dry: 0.3, press: 0.05, tail: 0.6, sharp: 1, seed: BLEED.seed });
  // 細い二の筋（刃の返り）
  const inner = BLEED_CUT.map((q) => ({ x: q.x * 0.86, y: q.y * 0.86 }));
  brushStroke(frame, { pts: inner, width: 1.4, grow: smoothstep(0.1, 0.35, p), fade: Math.min(1, fade * 1.3), dry: 0.4, tail: 0.6, seed: BLEED.seed + 1 });
  // 斬り口から垂れる墨の血: 筋に沿って 6 か所、外へ（前へ）伸びる垂れと先の雫
  const drip = smoothstep(0.2, 0.75, p);
  for (let i = 0; i < 6; i++) {
    const r = (k) => hash1(i * 11 + k, BLEED.seed + 2);
    const at = BLEED_CUT[2 + Math.floor((i / 6) * 9)];
    if (!at || drip <= 0.02) continue;
    const len = (6 + 10 * r(1)) * drip;
    const dir = Math.atan2(at.y, at.x) + (r(2) - 0.5) * 0.4;
    const ex = at.x + Math.cos(dir) * len;
    const ey = at.y + Math.sin(dir) * len;
    brushStroke(frame, { pts: [at, { x: ex, y: ey }], width: 2.2, fade, dry: 0.1, press: 0.02, tail: 0.15, sharp: 0.3, seed: BLEED.seed + 10 + i });
    if (r(3) > 0.35) inkBlot(frame, { x: ex + Math.cos(dir) * 1.5, y: ey + Math.sin(dir) * 1.5, radius: 2 + 1.2 * r(4), seed: BLEED.seed + 20 + i, coreWidth: 0.5 });
  }
  splatter(frame, f, 12, BLEED.seed + 30, (i, r) => {
    const q = BLEED_CUT[Math.floor(r(1) * 12)] ?? { x: BLEED_R * 0.7, y: 0 };
    const a = Math.atan2(q.y, q.x) + (r(2) - 0.5) * 0.8;
    return { x: q.x, y: q.y, vx: Math.cos(a) * (2 + 3 * r(3)), vy: Math.sin(a) * (2 + 3 * r(3)), size: r(4) > 0.5 ? 1.5 : 0.8, born: 1 + Math.floor(r(5) * 3), life: 5, level: 7 };
  });
}

// ===========================================================================
// 昇り斬り（arc 90°・届き 32px・叩きつけ）
// ===========================================================================

const RISE = { reachPx: 32, frames: 9, seed: SEED + 1000 };
const RISE_R = RISE.reachPx * 2;

/** 斬り上げの筆: 下（+y の手前）から前を通って上（−y の奥）へ大きく振り上げ、最後に内へ跳ねる */
const RISE_PATH = (() => {
  const pts = [];
  for (let i = 0; i <= 18; i++) {
    const t = i / 18;
    const a = (50 - 110 * t) * DEG;
    const r = RISE_R * (0.45 + 0.42 * Math.sin(Math.min(1, t * 1.2) * Math.PI * 0.6));
    pts.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
  }
  const last = pts[pts.length - 1];
  // 跳ね（はね）: 振り上げた先で内側へ小さく返る
  pts.push({ x: last.x - 6, y: last.y + 3 });
  return pts;
})();

function risingSlash(frame, f) {
  const p = prog(f, RISE.frames);
  const grow = smoothstep(0, 0.45, p);
  const fade = smoothstep(0.55, 1, p) * 0.9;
  brushStroke(frame, { pts: RISE_PATH, width: 11, grow, fade, dry: 0.45, press: 0.1, tail: 0.3, swell: 0.3, seed: RISE.seed });
  // 昇る筋: 振り上げた向きへ平行に伸びる細い 3 本
  const g2 = smoothstep(0.3, 0.7, p);
  if (g2 > 0.02) {
    for (let i = 0; i < 3; i++) {
      const x = RISE_R * (0.45 + 0.15 * i);
      const y0 = RISE_R * (0.15 - 0.1 * i);
      brushStroke(frame, { pts: [{ x, y: y0 }, { x: x - 4, y: y0 - 22 - 6 * i }], width: 1.6, grow: g2, fade: Math.min(1, fade * 1.2), dry: 0.5, tail: 0.6, seed: RISE.seed + 1 + i });
    }
  }
  // 斬り上げた先から上（−y）へ飛ぶ飛沫
  splatter(frame, f, 14, RISE.seed + 10, (i, r) => {
    const q = RISE_PATH[10 + Math.floor(r(1) * 8)] ?? { x: RISE_R * 0.6, y: -RISE_R * 0.5 };
    return { x: q.x, y: q.y, vx: (r(2) - 0.3) * 3, vy: -(3 + 4 * r(3)), size: r(4) > 0.55 ? 1.6 : 0.9, born: 2 + Math.floor(r(5) * 3), life: 5, level: 7 };
  });
}

// ===========================================================================
// 百裂（arc 70°・届き 30px・6 連撃）
// ===========================================================================

const FLURRY = { reachPx: 30, deg: 70, hits: 6, frames: 11, seed: SEED + 1100 };
const FLURRY_R = FLURRY.reachPx * 2;

function flurry(frame, f) {
  const half = (FLURRY.deg * DEG) / 2;
  for (let i = 0; i < FLURRY.hits; i++) {
    const r = (k) => hash1(i * 13 + k, FLURRY.seed);
    const born = i * 1.2;
    const age = f - born;
    if (age < 0 || age > 6) continue;
    // 円錐の中の打点と、交差する向きの短い一筆
    const a = -half + half * 2 * ((i * 0.618 + r(1) * 0.3) % 1);
    const d = FLURRY_R * (0.45 + 0.4 * r(2));
    const cx = Math.cos(a) * d;
    const cy = Math.sin(a) * d;
    const sa = a + (i % 2 === 0 ? 1 : -1) * (0.9 + 0.5 * r(3));
    const len = 13 + 6 * r(4);
    const pts = [
      { x: cx - Math.cos(sa) * len, y: cy - Math.sin(sa) * len },
      { x: cx + Math.cos(sa) * len, y: cy + Math.sin(sa) * len },
    ];
    const grow = smoothstep(0, 1.2, age + 0.5);
    const fade = smoothstep(2, 6, age);
    brushStroke(frame, { pts, width: 5.5, grow, fade, dry: 0.35, press: 0.15, tail: 0.6, sharp: 1, seed: FLURRY.seed + 10 + i });
    // 打点の飛沫（当たった瞬間の墨）
    if (age >= 1 && age <= 4) {
      splatter(frame, age - 1, 4, FLURRY.seed + 20 + i, (j, rr) => {
        const b = a + (rr(1) - 0.5) * 1.6;
        return { x: cx, y: cy, vx: Math.cos(b) * (2 + 2 * rr(2)), vy: Math.sin(b) * (2 + 2 * rr(2)), size: rr(3) > 0.5 ? 1.2 : 0.8, life: 3, level: 7 };
      });
    }
  }
}

// ===========================================================================
// 炸裂玉（ringTarget・半径 32px）
// ===========================================================================

const BOMB = { radiusPx: 32, frames: 9, seed: SEED + 1200 };
const BOMB_R = BOMB.radiusPx * 2;
/** 弾けた墨の舌の数（墨しぶきの指） */
const BOMB_TONGUES = 9;

/** 墨しぶきの縁（角度 a での半径の倍率）: 丸い瘤のうねりに、先が丸く膨らむ太い舌が数本 */
function splatShape(a, seed) {
  const lump = 0.62 + 0.22 * valueNoise(Math.cos(a) * 4 + 30, Math.sin(a) * 4 + 30, 1.6, seed);
  const k = ((a + Math.PI) / TAU) * BOMB_TONGUES;
  const i = Math.floor(k);
  const t = k - i;
  const len = 0.15 + 0.4 * hash1(i % BOMB_TONGUES, seed + 1);
  // 舌は細い幅（t が 0.5 の近く）だけ伸びる
  const tongue = Math.max(0, 1 - Math.abs(t - 0.5) * 6);
  return lump + len * Math.sqrt(tongue);
}

/** 舌の先の雫（墨しぶきの先に丸く溜まる） */
function tongueDrops(frame, reach, seed, level) {
  for (let i = 0; i < BOMB_TONGUES; i++) {
    const a = ((i + 0.5) / BOMB_TONGUES) * TAU - Math.PI;
    const len = 0.15 + 0.4 * hash1(i, seed + 1);
    if (len < 0.3) continue;
    const d = reach * (0.84 + len + 0.08);
    inkBlot(frame, { x: Math.cos(a) * d, y: Math.sin(a) * d, radius: 2 + 2.5 * len, seed: seed + 10 + i, core: lv(level), coreWidth: 0.4 });
  }
}

function bombAir(frame, f) {
  const p = prog(f, BOMB.frames);
  // 墨玉が膨らむ（最初の 2 コマ）
  if (p < 0.2) {
    inkBlot(frame, { radius: 9 + 14 * p, seed: BOMB.seed, coreWidth: 0.45 });
    return;
  }
  const burst = smoothstep(0.15, 0.5, p);
  const fade = smoothstep(0.5, 1, p);
  const reach = BOMB_R * 0.62 * burst;
  // 弾けた墨: 瘤と舌の縁を持つ墨だまり。真ん中から抜けて輪になり、掠れて消える
  paint(
    frame,
    (x, y) => {
      const d = Math.hypot(x, y);
      const edge = reach * splatShape(Math.atan2(y, x), BOMB.seed + 1);
      if (d > edge) return -1;
      const hole = edge * 0.7 * smoothstep(0.25, 0.8, p);
      if (d < hole) return -1;
      if (hash2d(x, y, BOMB.seed + 2) < fade * 0.9) return -1;
      return d < hole + 2.5 ? lv(7) : lv(5);
    },
    { bounds: { x0: -BOMB_R, y0: -BOMB_R, x1: BOMB_R, y1: BOMB_R }, dither: 0 },
  );
  if (fade < 0.6) tongueDrops(frame, reach, BOMB.seed + 1, 7);
  burstSplatter(frame, f - 1, 20, BOMB.seed + 3, { at: 8, spread: 10, speed: [4, 8], life: 6, big: 2 });
}

/** 間引きの粗い格子のハッシュ（2 ドット角） */
function hash2d(x, y, seed) {
  return hash1(Math.floor(x / 2) * 157 + Math.floor(y / 2) * 7, seed);
}

/** 地面: 墨しぶきの染み（縁は墨だまり、中はまばらな淡墨）。少し角度をずらした別の形で、空中の絵の下に残る */
function bombGround(frame, f) {
  const p = prog(f, BOMB.frames);
  if (p < 0.2) return;
  const reach = BOMB_R * 0.78 * smoothstep(0.15, 0.55, p);
  const fade = smoothstep(0.5, 1, p);
  paint(
    frame,
    (x, y) => {
      const d = Math.hypot(x, y);
      const edge = reach * splatShape(Math.atan2(y, x) + 0.2, BOMB.seed + 4);
      if (d > edge) return -1;
      if (hash2d(x, y, BOMB.seed + 5) < fade * 0.85) return -1;
      if (d > edge - 2.5) return lv(5);
      if (((Math.floor(x) + Math.floor(y)) & 1) === 1) return -1;
      return hash2d(x, y, BOMB.seed + 6) < 0.4 ? lv(2) : -1;
    },
    { bounds: { x0: -BOMB_R, y0: -BOMB_R, x1: BOMB_R, y1: BOMB_R }, dither: 0 },
  );
}

// ===========================================================================
// 冷却弾（ringTarget・半径 32px・氷）
// ===========================================================================

const FREEZE = { radiusPx: 32, frames: 9, seed: SEED + 1300 };
const FREEZE_R = FREEZE.radiusPx * 2;

/** 筆の六花: 6 本の腕と、腕ごとに 2 対の枝 */
function snowflake(frame, R, grow, fade, seed) {
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU - Math.PI / 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    brushStroke(frame, { pts: [{ x: c * 4, y: s * 4 }, { x: c * R, y: s * R }], width: 4, grow, fade, dry: 0.2, press: 0.08, tail: 0.5, coreWidth: 0.35, seed: seed + i });
    for (const at of [0.42, 0.68]) {
      const bg = smoothstep(at, at + 0.25, grow);
      if (bg <= 0.02) continue;
      const bx = c * R * at;
      const by = s * R * at;
      const bl = R * (0.32 - 0.12 * at);
      for (const side of [-1, 1]) {
        const b = a + side * 60 * DEG;
        brushStroke(frame, { pts: [{ x: bx, y: by }, { x: bx + Math.cos(b) * bl, y: by + Math.sin(b) * bl }], width: 2.4, grow: bg, fade: Math.min(1, fade * 1.1), dry: 0.2, press: 0.05, tail: 0.6, seed: seed + 20 + i * 4 + (at > 0.5 ? 2 : 0) + (side > 0 ? 1 : 0) });
      }
    }
  }
}

function freezeAir(frame, f) {
  const p = prog(f, FREEZE.frames);
  if (p < 0.3) inkBlot(frame, { radius: 8 - 6 * p, seed: FREEZE.seed, core: lv(6), coreWidth: 0.5 });
  snowflake(frame, FREEZE_R * 0.72, smoothstep(0.08, 0.55, p), smoothstep(0.6, 1, p) * 0.9, FREEZE.seed + 1);
  // 砕けて散る氷の欠片（終わりぎわ）
  splatter(frame, f - 4, 16, FREEZE.seed + 50, (i, r) => {
    const a = r(1) * TAU;
    const at = FREEZE_R * (0.3 + 0.5 * r(2));
    return { x: Math.cos(a) * at, y: Math.sin(a) * at, vx: Math.cos(a) * (1.5 + 2.5 * r(3)), vy: Math.sin(a) * (1.5 + 2.5 * r(3)), size: r(4) > 0.5 ? 1.4 : 0.8, life: 4, level: r(5) > 0.5 ? 7 : 5 };
  });
}

function freezeGround(frame, f) {
  const p = prog(f, FREEZE.frames);
  inkWash(frame, { radius: FREEZE_R * 0.95, reach: smoothstep(0, 0.6, p), seed: FREEZE.seed + 60, rimWidth: 3, rimLevel: 5, tint: 6, density: 0.12 * (1 - smoothstep(0.7, 1, p)), cell: 6 });
}

// ===========================================================================
// 閃光弾（ringTarget・半径 36px・沈黙・恐怖）
// ===========================================================================

const FLASH = { radiusPx: 36, frames: 9, seed: SEED + 1400 };
const FLASH_R = FLASH.radiusPx * 2;

function flashBang(frame, f) {
  const p = prog(f, FLASH.frames);
  const fade = smoothstep(0.45, 1, p) * 0.95;
  // 弾ける玉: 墨玉が割れる
  if (p < 0.25) inkBlot(frame, { radius: 10 * (1 - p), seed: FLASH.seed, coreWidth: 0.4 });
  // 目くらましの墨煙: 淡墨のむらが一気に広がって薄れる（間引き）
  const mist = smoothstep(0.05, 0.45, p);
  paint(
    frame,
    (x, y) => {
      const d = Math.hypot(x, y);
      const edge = FLASH_R * 0.85 * mist * (0.85 + 0.25 * valueNoise(Math.cos(Math.atan2(y, x)) * 3 + 5, Math.sin(Math.atan2(y, x)) * 3 + 5, 1.4, FLASH.seed + 2));
      if (d > edge || d < edge * 0.3 * mist) return -1;
      if (((Math.floor(x) + Math.floor(y)) & 1) === 1) return -1;
      if (valueNoise(x, y, 7, FLASH.seed + 3) < 0.45 + fade * 0.55) return -1;
      return lv(d > edge * 0.8 ? 2 : 1);
    },
    { bounds: { x0: -FLASH_R, y0: -FLASH_R, x1: FLASH_R, y1: FLASH_R }, dither: 0 },
  );
  // 破裂の筆: 短い楔が外へ跳ぶ（8 本。中心から離れた所だけ。光の放射に見せない）
  const shoot = smoothstep(0.05, 0.35, p);
  for (let i = 0; i < 8; i++) {
    const r = (k) => hash1(i * 7 + k, FLASH.seed + 1);
    const a = (i / 8) * TAU + (r(1) - 0.5) * 0.5;
    const r0 = FLASH_R * (0.22 + 0.25 * shoot);
    const r1 = r0 + FLASH_R * (0.16 + 0.12 * r(2));
    brushStroke(frame, { pts: [{ x: Math.cos(a) * r0, y: Math.sin(a) * r0 }, { x: Math.cos(a) * r1, y: Math.sin(a) * r1 }], width: 3.5, grow: shoot, fade, dry: 0.3, press: 0.3, tail: 0.6, sharp: 1, seed: FLASH.seed + 10 + i });
  }
  // 震える声の円相（二重に広がる。怯え）
  const wave = smoothstep(0.2, 0.8, p);
  if (wave > 0.02) {
    enso(frame, { radius: FLASH_R * (0.4 + 0.5 * wave), a0: -Math.PI * 0.2, sweep: TAU * 0.82, width: 3.5, wobble: 0.12, steps: 44, grow: smoothstep(0.2, 0.5, p), fade: Math.min(1, fade * 1.1), dry: 0.6, seed: FLASH.seed + 40 + (f % 2) });
    enso(frame, { radius: FLASH_R * (0.25 + 0.4 * wave), a0: Math.PI * 0.7, sweep: TAU * 0.6, width: 2.2, wobble: 0.16, steps: 36, grow: smoothstep(0.3, 0.6, p), fade: Math.min(1, fade * 1.25), dry: 0.6, seed: FLASH.seed + 42 + (f % 2) });
  }
}

// ===========================================================================
// 表
// ===========================================================================

/** 円の絵のシートの大きさ（半径 R ドット + 余白） */
function ringSize(R, margin = 24) {
  return Math.ceil(R + margin) * 2;
}

const FX = {
  skills: {
    commonTremor: {
      ramp: "steel",
      acts: { ring: { sheet: "skillArtC.tremorAir", ground: "skillArtC.tremorGround", life: 0.5, base: TREMOR.radiusPx } },
    },
    commonDeflect: {
      ramp: "steel",
      acts: { ring: { sheet: "skillArtC.deflect", life: 0.32, base: DEFLECT.radiusPx } },
    },
    commonSmokeScreen: {
      ramp: "steel",
      acts: { ring: { sheet: "skillArtC.smokeAir", ground: "skillArtC.smokeGround", life: 0.6, base: SMOKE.radiusPx } },
    },
    commonPierce: {
      ramp: "steel",
      acts: { line: { sheet: "skillArtC.piercePress", life: 0.3, beam: { sheet: "skillArtC.pierceBeam", step: PIERCE.stepPx }, tip: "skillArtC.pierceTip" } },
    },
    commonQuake: {
      ramp: "steel",
      acts: { line: { sheet: "skillArtC.quakePress", life: 0.48, beam: { sheet: "skillArtC.quakeBeam", step: QUAKE.stepPx }, tip: "skillArtC.quakeTip" } },
    },
    commonFireWall: {
      ramp: "fire",
      acts: { line: { sheet: "skillArtC.firePress", life: 0.5, beam: { sheet: "skillArtC.fireBeam", step: FIREWALL.stepPx }, tip: "skillArtC.fireTip" } },
    },
    commonShove: {
      ramp: "steel",
      acts: { line: { sheet: "skillArtC.shovePress", life: 0.36, beam: { sheet: "skillArtC.shoveBeam", step: SHOVE.stepPx }, tip: "skillArtC.shoveTip" } },
    },
    commonCrescent: {
      ramp: "steel",
      acts: { arcWide: { sheet: "skillArtC.crescent", life: 0.4, base: CRES.reachPx } },
    },
    commonBleedEdge: {
      ramp: "steel",
      acts: { arc: { sheet: "skillArtC.bleedEdge", life: 0.42, base: BLEED.reachPx } },
    },
    commonRisingSlash: {
      ramp: "steel",
      acts: { arc: { sheet: "skillArtC.risingSlash", life: 0.38, base: RISE.reachPx } },
    },
    commonFlurry: {
      ramp: "steel",
      acts: { arc: { sheet: "skillArtC.flurry", life: 0.5, base: FLURRY.reachPx } },
    },
    commonBomb: {
      ramp: "steel",
      acts: { ringTarget: { sheet: "skillArtC.bombAir", ground: "skillArtC.bombGround", life: 0.45, base: BOMB.radiusPx } },
    },
    commonFreezeBomb: {
      ramp: "ice",
      acts: { ringTarget: { sheet: "skillArtC.freezeAir", ground: "skillArtC.freezeGround", life: 0.5, base: FREEZE.radiusPx } },
    },
    commonFlashBang: {
      ramp: "steel",
      acts: { ringTarget: { sheet: "skillArtC.flashBang", life: 0.45, base: FLASH.radiusPx } },
    },
  },
};

export const ATLAS = {
  key: "skillArtC",
  fx: FX,
  sheets: [
    { key: "skillArtC.tremorGround", dirs: 1, frames: TREMOR.frames, active: 0, size: ringSize(TREMOR_R), draw: tremorGround },
    { key: "skillArtC.tremorAir", dirs: 1, frames: TREMOR.frames, active: 0, size: ringSize(TREMOR_R, 40), draw: tremorAir },
    { key: "skillArtC.deflect", dirs: 1, frames: DEFLECT.frames, active: 0, size: ringSize(DEFLECT_R, 40), draw: deflect },
    { key: "skillArtC.smokeAir", dirs: 1, frames: SMOKE.frames, active: 0, size: ringSize(SMOKE_R, 30), draw: smokeAir },
    { key: "skillArtC.smokeGround", dirs: 1, frames: SMOKE.frames, active: 0, size: ringSize(SMOKE_R), draw: smokeGround },
    { key: "skillArtC.piercePress", dirs: DIRS, frames: PIERCE.frames, active: 0, size: 80, draw: piercePress },
    { key: "skillArtC.pierceBeam", dirs: 1, frames: PIERCE.frames, active: 0, size: 48, ink: false, draw: pierceBeam },
    { key: "skillArtC.pierceTip", dirs: DIRS, frames: PIERCE.frames, active: 0, size: 112, draw: pierceTip },
    { key: "skillArtC.quakePress", dirs: DIRS, frames: QUAKE.frames, active: 0, size: 96, draw: quakePress },
    { key: "skillArtC.quakeBeam", dirs: 1, frames: QUAKE.frames, active: 0, size: 80, ink: false, draw: quakeBeam },
    { key: "skillArtC.quakeTip", dirs: DIRS, frames: QUAKE.frames, active: 0, size: 112, draw: quakeTip },
    { key: "skillArtC.firePress", dirs: DIRS, frames: FIREWALL.frames, active: 0, size: 80, draw: firePress },
    { key: "skillArtC.fireBeam", dirs: 1, frames: FIREWALL.frames, active: 0, size: 100, ink: false, draw: fireBeam },
    { key: "skillArtC.fireTip", dirs: DIRS, frames: FIREWALL.frames, active: 0, size: 112, draw: fireTip },
    { key: "skillArtC.shovePress", dirs: DIRS, frames: SHOVE.frames, active: 0, size: 80, draw: shovePress },
    { key: "skillArtC.shoveBeam", dirs: 1, frames: SHOVE.frames, active: 0, size: 80, ink: false, draw: shoveBeam },
    { key: "skillArtC.shoveTip", dirs: DIRS, frames: SHOVE.frames, active: 0, size: 112, draw: shoveTip },
    { key: "skillArtC.crescent", dirs: WIDE_DIRS, frames: CRES.frames, active: 0, size: ringSize(CRES_R, 30), draw: crescent },
    { key: "skillArtC.bleedEdge", dirs: DIRS, frames: BLEED.frames, active: 0, size: ringSize(BLEED_R, 36), draw: bleedEdge },
    { key: "skillArtC.risingSlash", dirs: DIRS, frames: RISE.frames, active: 0, size: ringSize(RISE_R, 36), draw: risingSlash },
    { key: "skillArtC.flurry", dirs: DIRS, frames: FLURRY.frames, active: 0, size: ringSize(FLURRY_R, 30), draw: flurry },
    { key: "skillArtC.bombAir", dirs: 1, frames: BOMB.frames, active: 0, size: ringSize(BOMB_R, 40), draw: bombAir },
    { key: "skillArtC.bombGround", dirs: 1, frames: BOMB.frames, active: 0, size: ringSize(BOMB_R), draw: bombGround },
    { key: "skillArtC.freezeAir", dirs: 1, frames: FREEZE.frames, active: 0, size: ringSize(FREEZE_R, 32), draw: freezeAir },
    { key: "skillArtC.freezeGround", dirs: 1, frames: FREEZE.frames, active: 0, size: ringSize(FREEZE_R), draw: freezeGround },
    { key: "skillArtC.flashBang", dirs: 1, frames: FLASH.frames, active: 0, size: ringSize(FLASH_R, 32), draw: flashBang },
  ],
};
