// 技（共通技）14 種の墨のエフェクト（docs/ideas/fx-sprites.md 10 章）。単位は絵のドット（論理 0.5px）。正準の向きは +x（照準の向き）
// 表は行為の種類ごと（acts.<種類>）に絵を持つ。当たりの数値（px）× 2 ドットで描き、表の base にその px を書く
//
// 猪突（commonCharge。dash 110px・幅 26px）: 蹄で蹴った重い墨だまりと後ろへの掻き跡、太く荒い飛白の通り道、
//   止まった所で墨が前へ撥ね散り、牙の形の二筆が反り上がる
// 千本斬り（commonThousandCuts。照準の輪 30px × 4）: 細い筆の斬り線が輪の中で無数に交差しては掠れて消える（刃の嵐）。外側を風の細い円相が巡る
// 三連打（commonTriplePound。照準の輪 26〜30px × 3）: 上から打ち据えた丸い墨だまりと衝撃の円相、床にひび割れの筆と滲み
// 吸い風（commonInhale。pull 50px）: 外から中心へ巻き込む渦の筆が縮み、墨の粒が尾を引いて吸い寄せられ、中心に墨が溜まる
// 三段突き（commonTripleThrust。line 44〜50px・幅 10〜12px）: 細く鋭い一文字の柄と、先で尖る穂先の一筆
// 跳躍叩き（commonLeapSlam。dash 70px + ring 36px）: 踏み切りの墨跳ね、宙を跳ぶ間の途切れ途切れの影、着地の太い円相と床のひび
// 飛び込み撃ち（commonDiveShot。dash 70px + shot）: 転がる通り道の波打つ筆、撃った口の墨の破裂、飛ぶ墨玉と筆の尾
// 返し構え（commonRiposte。buff + arc 140° 36px）: 前に立てた半月の受けの一筆、斬り返しの弧が終わりで跳ね（はね）て返る
// 滅多切り（commonHack。arc 100〜110° 36〜40px）: 荒れた太い弧と、逆から交差する二の太刀、欠けた墨の欠片
// 墜星（commonMeteorDive。blink + ring 26px・闇）: 跳んだ元に墨の煙が散り、着地点へ上から筆の流れ星が墜ち、闇の墨が円く滲み広がる
// 一斉起爆（commonDetonate。detonate + ring 36px）: 自分に押した丸印から合図の筆が四方へ走り、周りで大きな墨だまりが割れて弾ける
// 十字斬り（commonCrossCut。arc 110° 34px + line 40px・幅 16px）: 書の「十」。横画は起筆と止めのある一筆、縦画は太い一文字と止め
// 背取り（commonBackstab。blink 130px + arc 100° 30px）: 残像の縦の一筆が裂けて消え、影の足跡が続き、着いた所で回り込む筆、背から刺す鋭い一筆
// 飛び退き打ち（commonStrikeAway。line 60px・幅 10px + 後ろへ dash 70px・雷）: 稲妻に折れる細い筆の打ち、跳び退く二筋の擦れと着地の滑り跡
import { arcPoints, brushStroke, enso, inkBlot, inkWash, lv, splatter } from "../brush.mjs";
import { hash1, smoothstep } from "../raster.mjs";
import { DIRS } from "../motifs.mjs";

const TAU = Math.PI * 2;
const SEED = 7401;
/** 線・突進の 1 区間（px） */
const STEP_PX = 12;
/** beam の区間の半分の長さ（ドット。継ぎ目で少し重ねる） */
const SEG_HALF = STEP_PX + 0.6;

/** コマの進み（0..1。コマの真ん中） */
function prog(f, frames) {
  return (f + 0.5) / frames;
}

/** 直線の折れ線 */
function seg(x0, y0, x1, y1) {
  return [
    { x: x0, y: y0 },
    { x: x1, y: y1 },
  ];
}

/** 間に点を補った折れ線（筆圧が滑らかに乗るよう細かく刻む） */
function polyline(pts, per = 6) {
  const out = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    for (let k = 0; k < per; k++) out.push({ x: a.x + ((b.x - a.x) * k) / per, y: a.y + ((b.y - a.y) * k) / per });
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/** 蹴りの墨跳ね（踏み込みの起点。後ろ = -x へ飛ぶ） */
function kickSpray(frame, f, count, seed, o = {}) {
  splatter(frame, f, count, seed, (i, r) => ({
    x: o.x ?? -4,
    y: (r(1) - 0.5) * (o.spread ?? 10),
    vx: -(2 + (o.speed ?? 4) * r(2)),
    vy: (r(3) - 0.5) * 7,
    size: r(4) > 0.5 ? (o.big ?? 1.7) : 0.9,
    life: 5,
    level: 6,
  }));
}

// ---------------------------------------------------------------------------
// 猪突（dash・110px・幅 26px）
// ---------------------------------------------------------------------------

const CHARGE = { widthPx: 26, seed: SEED + 100 };

/** 蹴り: 蹄で踏んだ重い墨だまりと、後ろへ掻いた太い二筋 */
function chargeKick(frame, f) {
  const p = prog(f, 7);
  if (p < 0.7) inkBlot(frame, { x: -2, y: 0, radius: 13 * (1.1 - 0.5 * p), seed: CHARGE.seed + f, coreWidth: 0.3 });
  for (const s of [-1, 1]) {
    brushStroke(frame, { pts: seg(2, s * 9, -34, s * 13), width: 6, grow: smoothstep(0, 0.4, p), fade: smoothstep(0.35, 1, p), dry: 0.7, seed: CHARGE.seed + 10 + s });
  }
  kickSpray(frame, f, 14, CHARGE.seed + 12, { spread: 22, speed: 5, big: 2.2 });
}

/** 通り道（1 区間）: 幅の広い荒い飛白。毛筋の間が大きく、重い体で擦った跡 */
function chargeTrail(frame, f) {
  const p = prog(f, 8);
  brushStroke(frame, {
    pts: seg(-SEG_HALF, 0, SEG_HALF, 0),
    width: 20 * (1 - 0.35 * p),
    profile: () => 1,
    flat: true,
    dry: 0,
    fade: 0.3 + 0.65 * smoothstep(0.15, 1, p),
    pitch: 1.8,
    breakLen: 14,
    coreWidth: 0.08,
    seed: CHARGE.seed + 20,
  });
}

/** 撥ね飛ばし: 前へつぶれる墨だまり、前方の扇へ撥ね散る墨、反り上がる牙の二筆 */
function chargeImpact(frame, f) {
  const p = prog(f, 9);
  if (p < 0.75) inkBlot(frame, { x: 6 + 6 * p, y: 0, radius: 12 * (1 - 0.3 * p), seed: CHARGE.seed + 30, coreWidth: 0.35 - 0.3 * p });
  const g = smoothstep(0, 0.35, p);
  const fade = smoothstep(0.5, 1, p) * 0.9;
  for (const s of [-1, 1]) {
    // 牙: 脇から前へ出て外へ反り、先が尖る
    const pts = [];
    for (let i = 0; i <= 14; i++) {
      const t = i / 14;
      pts.push({ x: -2 + 40 * t, y: s * (12 + 4 * t + 26 * t * t) });
    }
    brushStroke(frame, { pts, width: 7, press: 0.08, grow: g, fade, dry: 0.4, tail: 0.6, sharp: 1, seed: CHARGE.seed + 31 + s });
  }
  splatter(frame, f, 20, CHARGE.seed + 33, (i, r) => {
    const a = (r(1) - 0.5) * 1.6;
    const sp = 4 + 5 * r(2);
    return { x: 12, y: 0, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, size: r(3) > 0.55 ? 2.2 : 1, life: 7, level: 7 };
  });
}

// ---------------------------------------------------------------------------
// 千本斬り（照準の輪・30px × 4）
// ---------------------------------------------------------------------------

const CUTS = { radiusPx: 30, frames: 8, seed: SEED + 200 };

/** 刃の嵐: 輪の中に細い斬り線が次々に走り、交差しては掠れる。外を風の細い円相が巡る */
function cutsStorm(frame, f) {
  const R = CUTS.radiusPx * 2;
  const p = prog(f, CUTS.frames);
  const count = 22;
  for (let i = 0; i < count; i++) {
    const r = (k) => hash1(i * 31 + k, CUTS.seed);
    const born = Math.floor(r(1) * 5);
    const age = f - born;
    if (age < 0 || age > 3) continue;
    const d = R * 0.7 * Math.sqrt(r(2));
    const at = r(3) * TAU;
    const cx = Math.cos(at) * d;
    const cy = Math.sin(at) * d;
    const a = r(4) * Math.PI;
    const len = 18 + 22 * r(5);
    const pts = seg(cx - Math.cos(a) * len, cy - Math.sin(a) * len, cx + Math.cos(a) * len, cy + Math.sin(a) * len);
    brushStroke(frame, {
      pts,
      width: 2.6 + 1.4 * r(6),
      grow: age === 0 ? 0.55 : 1,
      fade: age >= 2 ? 0.35 * (age - 1) : 0,
      dry: 0.4,
      press: 0.06,
      tail: 0.6,
      sharp: 1,
      seed: CUTS.seed + 10 + i,
    });
  }
  // 風の円相（嵐の外縁が巡る）
  enso(frame, { radius: R * 0.95, a0: p * TAU * 0.8, sweep: TAU * 0.55, width: 2.4, grow: smoothstep(0, 0.4, p), fade: smoothstep(0.55, 1, p) * 0.9, dry: 0.7, seed: CUTS.seed + 2 });
  splatter(frame, f, 10, CUTS.seed + 3, (i, r) => {
    const a = r(1) * TAU;
    return { x: Math.cos(a) * R * 0.5, y: Math.sin(a) * R * 0.5, vx: -Math.sin(a) * 4, vy: Math.cos(a) * 4, size: 0.9, born: Math.floor(r(2) * 5), life: 3, level: 6 };
  });
}

// ---------------------------------------------------------------------------
// 三連打（照準の輪・26〜30px × 3）
// ---------------------------------------------------------------------------

const POUND = { radiusPx: 28, frames: 8, seed: SEED + 300 };

/** 打ち据え（空中）: 丸い墨だまりが叩きつけられ、衝撃の円相が外へ走り、飛沫が四方へ */
function poundHit(frame, f) {
  const R = POUND.radiusPx * 2;
  const p = prog(f, POUND.frames);
  if (p < 0.55) inkBlot(frame, { x: 0, y: 0, radius: 20 * (0.8 + 0.4 * smoothstep(0, 0.2, p)), seed: POUND.seed + f, coreWidth: 0.4 });
  enso(frame, { radius: R * (0.55 + 0.35 * smoothstep(0, 0.45, p)), a0: -Math.PI * 0.6, sweep: TAU * 0.9, width: 7, grow: smoothstep(0, 0.3, p), fade: smoothstep(0.4, 1, p) * 0.9, dry: 0.5, seed: POUND.seed + 1 });
  splatter(frame, f, 18, POUND.seed + 2, (i, r) => {
    const a = (i / 18) * TAU + r(1) * 0.3;
    const sp = 4 + 4 * r(2);
    return { x: Math.cos(a) * 14, y: Math.sin(a) * 14, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, size: r(3) > 0.5 ? 1.8 : 1, life: 6, level: 7 };
  });
}

/** 床（地面）: 叩いた所から滲みが広がり、ひび割れの筆が外へ走る */
function poundGround(frame, f) {
  const R = POUND.radiusPx * 2;
  const p = prog(f, POUND.frames);
  inkWash(frame, { radius: R * 0.6, reach: smoothstep(0, 0.4, p), seed: POUND.seed + 3, rimWidth: 3, rimLevel: 5, tint: 3, density: 0.25 * (1 - p), cell: 6 });
  for (let i = 0; i < 6; i++) {
    const r = (k) => hash1(i * 7 + k, POUND.seed + 4);
    let a = (i / 6) * TAU + r(1) * 0.5;
    const pts = [{ x: Math.cos(a) * 8, y: Math.sin(a) * 8 }];
    let d = 8;
    for (let k = 0; k < 4; k++) {
      d += R * (0.15 + 0.08 * r(2 + k));
      a += (r(10 + k) - 0.5) * 0.6;
      pts.push({ x: Math.cos(a) * d, y: Math.sin(a) * d });
    }
    brushStroke(frame, { pts: polyline(pts, 4), width: 2.2, grow: smoothstep(0, 0.35, p), fade: smoothstep(0.45, 1, p), dry: 0.3, press: 0.05, tail: 0.6, edge: lv(5), seed: POUND.seed + 10 + i });
  }
}

// ---------------------------------------------------------------------------
// 吸い風（pull・50px）
// ---------------------------------------------------------------------------

const INHALE = { radiusPx: 50, frames: 10, arms: 6, seed: SEED + 400 };

/** 渦の筆: 外から中心へ巻き込みながら縮む腕。墨の粒が尾を引いて吸われ、中心に墨が溜まる */
function inhaleSwirl(frame, f) {
  const R = INHALE.radiusPx * 2;
  const p = prog(f, INHALE.frames);
  const outer = R * (1.05 - 0.55 * p);
  const inner = Math.max(R * 0.1, outer - R * 0.6);
  for (let i = 0; i < INHALE.arms; i++) {
    const a0 = (i / INHALE.arms) * TAU + hash1(i, INHALE.seed) * 0.4;
    const pts = [];
    for (let k = 0; k <= 20; k++) {
      const rr = outer + (inner - outer) * (k / 20);
      // 中心に近いほど巻きが強い（吸い込みの渦）
      const a = a0 + (1 - rr / R) * 2.2 + p * 1.2;
      pts.push({ x: Math.cos(a) * rr, y: Math.sin(a) * rr });
    }
    brushStroke(frame, { pts, width: 4.5, grow: smoothstep(0, 0.12, p), fade: smoothstep(0.7, 1, p) * 0.9, dry: 0.55, press: 0.2, tail: 0.5, seed: INHALE.seed + 10 + i });
  }
  // 吸われる墨の粒（外の輪から中心へ）
  splatter(frame, f, 22, INHALE.seed + 2, (i, r) => {
    const a = r(1) * TAU;
    const rr = R * (0.85 + 0.2 * r(2));
    const sp = (rr * 0.85) / 3.1;
    return { x: Math.cos(a) * rr, y: Math.sin(a) * rr, vx: -Math.cos(a) * sp, vy: -Math.sin(a) * sp, size: r(3) > 0.5 ? 1.5 : 0.9, born: Math.floor(r(4) * 3), life: 7, level: 6 };
  });
  if (p > 0.4) inkBlot(frame, { x: 0, y: 0, radius: 4 + 7 * smoothstep(0.4, 0.85, p) * (1 - smoothstep(0.9, 1, p) * 0.5), seed: INHALE.seed + 3, coreWidth: 0.4 });
}

// ---------------------------------------------------------------------------
// 三段突き（line・44〜50px・幅 10〜12px）
// ---------------------------------------------------------------------------

const THRUST = { half: 7, seed: SEED + 500 };

/** 突きの起こり: 手元で墨を押し込み、後ろへ少し跳ねる */
function thrustPress(frame, f) {
  const p = prog(f, 6);
  if (p < 0.7) inkBlot(frame, { x: 4, y: 0, radius: 8 * (1.1 - 0.5 * p), seed: THRUST.seed + f, coreWidth: 0.3 });
  splatter(frame, f, 6, THRUST.seed + 1, (i, r) => ({ x: 0, y: 0, vx: -(1.5 + 2 * r(1)), vy: (r(2) - 0.5) * 5, size: 0.9, life: 4, level: 6 }));
}

/** 柄（1 区間）: 細く締まった一文字と、両脇を流れる髪の毛ほどの速さの筋 */
function thrustBeam(frame, f) {
  const p = prog(f, 6);
  brushStroke(frame, {
    pts: seg(-SEG_HALF, 0, SEG_HALF, 0),
    width: THRUST.half * (1 - 0.5 * smoothstep(0.2, 1, p)),
    profile: () => 1,
    flat: true,
    dry: 0,
    fade: smoothstep(0.35, 1, p) * 0.8,
    pitch: 1.2,
    breakLen: 36,
    coreWidth: 0.14,
    seed: THRUST.seed + 10,
  });
  for (const s of [-1, 1]) {
    brushStroke(frame, { pts: seg(-SEG_HALF, s * 11, SEG_HALF, s * 11), width: 0.9, profile: () => 1, flat: true, dry: 0, fade: 0.35 + 0.6 * p, breakLen: 6, core: lv(5), seed: THRUST.seed + 11 + s });
  }
}

/** 穂先: 帯の終わりから尖って前へ抜ける一筆と、先から細く飛ぶ墨 */
function thrustTip(frame, f) {
  const p = prog(f, 6);
  const fade = smoothstep(0.4, 1, p) * 0.85;
  brushStroke(frame, {
    pts: seg(-14, 0, 20, 0),
    width: THRUST.half * 0.85,
    profile: (u) => (1 - u) ** 0.9 + 0.04,
    swell: 0,
    coreWidth: 0.14,
    grow: smoothstep(0, 0.3, p),
    fade,
    dry: 0.2,
    seed: THRUST.seed + 20,
  });
  splatter(frame, f, 9, THRUST.seed + 21, (i, r) => ({ x: 19, y: (r(1) - 0.5) * 3, vx: 4 + 4 * r(2), vy: (r(3) - 0.5) * 3, size: r(4) > 0.6 ? 1.3 : 0.8, life: 5, level: 7 }));
}

// ---------------------------------------------------------------------------
// 跳躍叩き（dash 70px・幅 20px + ring 36px）
// ---------------------------------------------------------------------------

const LEAP = { slamPx: 36, seed: SEED + 600 };

/** 踏み切り: 足元の墨だまりが跳ね、周りへ散る（地を蹴って跳ぶ） */
function leapKick(frame, f) {
  const p = prog(f, 7);
  if (p < 0.6) inkBlot(frame, { x: 0, y: 0, radius: 10 * (1.1 - 0.6 * p), seed: LEAP.seed + f, coreWidth: 0.3 });
  enso(frame, { radius: 16 + 8 * p, a0: Math.PI * 0.35, sweep: TAU * 0.6, width: 3.5, grow: smoothstep(0, 0.4, p), fade: smoothstep(0.3, 1, p), dry: 0.6, seed: LEAP.seed + 1 });
  splatter(frame, f, 14, LEAP.seed + 2, (i, r) => {
    const a = Math.PI + (r(1) - 0.5) * 2.6;
    const sp = 3 + 4 * r(2);
    return { x: 0, y: 0, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, size: r(3) > 0.5 ? 1.6 : 0.9, life: 5, level: 6 };
  });
}

/** 宙（1 区間）: 跳んでいる間の影。途切れ途切れの淡い擦れ */
function leapTrail(frame, f) {
  const p = prog(f, 7);
  brushStroke(frame, {
    pts: seg(-SEG_HALF, 0, SEG_HALF, 0),
    width: 4.5 * (1 - 0.4 * p),
    profile: () => 1,
    flat: true,
    dry: 0,
    fade: 0.45 + 0.5 * smoothstep(0.1, 1, p),
    pitch: 1.3,
    breakLen: 7,
    seed: LEAP.seed + 10,
  });
}

/** 叩きつけ（空中）: 太い衝撃の円相が一気に開き、外へ大きな墨が跳ねる */
function slamAir(frame, f) {
  const R = LEAP.slamPx * 2;
  const p = prog(f, 9);
  if (p < 0.3) inkBlot(frame, { x: 0, y: 0, radius: 22, seed: LEAP.seed + 20 + f, coreWidth: 0.45 });
  enso(frame, { radius: R * (0.6 + 0.3 * smoothstep(0, 0.35, p)), a0: Math.PI * 0.8, sweep: TAU * 0.95, width: 10 * (1 - 0.35 * p), grow: smoothstep(0, 0.25, p), fade: smoothstep(0.4, 1, p) * 0.9, dry: 0.45, seed: LEAP.seed + 21 });
  splatter(frame, f, 24, LEAP.seed + 22, (i, r) => {
    const a = (i / 24) * TAU + r(1) * 0.25;
    const sp = 5 + 5 * r(2);
    return { x: Math.cos(a) * R * 0.55, y: Math.sin(a) * R * 0.55, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, size: r(3) > 0.5 ? 2.2 : 1.1, life: 7, level: 7 };
  });
}

/** 叩きつけ（地面）: 地割れの筆が放射に走り、中心に滲み */
function slamGround(frame, f) {
  const R = LEAP.slamPx * 2;
  const p = prog(f, 9);
  inkWash(frame, { radius: R * 0.5, reach: smoothstep(0, 0.3, p), seed: LEAP.seed + 30, rimWidth: 4, rimLevel: 5, tint: 3, density: 0.3 * (1 - 0.7 * p), cell: 6 });
  for (let i = 0; i < 8; i++) {
    const r = (k) => hash1(i * 11 + k, LEAP.seed + 31);
    let a = (i / 8) * TAU + r(1) * 0.4;
    const pts = [{ x: Math.cos(a) * 12, y: Math.sin(a) * 12 }];
    let d = 12;
    for (let k = 0; k < 5; k++) {
      d += R * (0.12 + 0.07 * r(2 + k));
      a += (r(10 + k) - 0.5) * 0.7;
      pts.push({ x: Math.cos(a) * d, y: Math.sin(a) * d });
    }
    brushStroke(frame, { pts: polyline(pts, 4), width: 3, grow: smoothstep(0, 0.3, p), fade: smoothstep(0.5, 1, p), dry: 0.3, press: 0.05, tail: 0.6, edge: lv(5), seed: LEAP.seed + 40 + i });
  }
}

// ---------------------------------------------------------------------------
// 飛び込み撃ち（dash 70px・幅 18px + shot・弾の半径 4px）
// ---------------------------------------------------------------------------

const DIVE = { bulletPx: 4, seed: SEED + 700 };

/** 飛び込みの起こり: 低く擦った跡と後ろへの墨跳ね */
function diveKick(frame, f) {
  const p = prog(f, 6);
  brushStroke(frame, { pts: seg(4, 0, -20, 2), width: 6, grow: smoothstep(0, 0.4, p), fade: smoothstep(0.35, 1, p), dry: 0.6, seed: DIVE.seed + 1 });
  kickSpray(frame, f, 10, DIVE.seed + 2, { spread: 10 });
}

/** 転がる通り道（1 区間）: 波打つ一筆（区間の長さが波の 1 周期。並べると続く） */
function diveTrail(frame, f) {
  const p = prog(f, 8);
  const pts = [];
  for (let i = 0; i <= 24; i++) {
    const x = -SEG_HALF + (2 * SEG_HALF * i) / 24;
    pts.push({ x, y: 7 * Math.sin(((x + STEP_PX) / (STEP_PX * 2)) * TAU) });
  }
  brushStroke(frame, { pts, width: 3.2 * (1 - 0.3 * p), profile: () => 1, flat: true, dry: 0, fade: 0.2 + 0.7 * smoothstep(0.15, 1, p), pitch: 1, breakLen: 16, seed: DIVE.seed + 10 });
  brushStroke(frame, { pts: seg(-SEG_HALF, 0, SEG_HALF, 0), width: 5, profile: () => 1, flat: true, dry: 0, fade: 0.6 + 0.35 * p, pitch: 1.4, breakLen: 6, core: lv(4), body: lv(3), edge: lv(2), seed: DIVE.seed + 11 });
}

/** 着地: 低くしゃがんだ足元の墨と、前へ流れる擦れ */
function diveLand(frame, f) {
  const p = prog(f, 6);
  if (p < 0.6) inkBlot(frame, { x: 0, y: 0, radius: 7, seed: DIVE.seed + 20, coreWidth: 0.3 });
  brushStroke(frame, { pts: seg(-6, 0, 16, 0), width: 4, grow: smoothstep(0, 0.4, p), fade: smoothstep(0.3, 1, p), dry: 0.7, seed: DIVE.seed + 21 });
}

/** 撃つ: 口で墨が前へ弾け、V の字に開く二筆 */
function diveMuzzle(frame, f) {
  const p = prog(f, 6);
  if (p < 0.6) inkBlot(frame, { x: 8, y: 0, radius: 7 * (1.2 - 0.5 * p), seed: DIVE.seed + 30, coreWidth: 0.4 });
  for (const s of [-1, 1]) brushStroke(frame, { pts: seg(8, s * 3, 26, s * 10), width: 2.8, grow: smoothstep(0, 0.35, p), fade: smoothstep(0.3, 1, p), dry: 0.4, tail: 0.7, sharp: 1, seed: DIVE.seed + 31 + s });
  splatter(frame, f, 10, DIVE.seed + 33, (i, r) => {
    const a = (r(1) - 0.5) * 1.1;
    return { x: 10, y: 0, vx: Math.cos(a) * (3 + 4 * r(2)), vy: Math.sin(a) * (3 + 4 * r(2)), size: r(3) > 0.5 ? 1.3 : 0.8, life: 5, level: 7 };
  });
}

/** 墨玉（飛んでいる間）: 丸い墨の雫と、後ろへ引く筆の尾 */
function diveBullet(frame, f) {
  const r = DIVE.bulletPx * 2;
  brushStroke(frame, { pts: seg(-2, 0, -26, 0), width: r * 0.8, press: 0.02, tail: 0.85, sharp: 1, dry: 0.5, swell: 0, seed: DIVE.seed + 40 + f });
  inkBlot(frame, { x: 0, y: 0, radius: r, seed: DIVE.seed + 41 + f, coreWidth: 0.4 });
  splatter(frame, 2, 3, DIVE.seed + 42 + f, (i, rr) => ({ x: -10 - 8 * i, y: (rr(1) - 0.5) * 8, vx: -1, vy: 0, size: 0.8, life: 5, level: 5 }));
}

// ---------------------------------------------------------------------------
// 返し構え（buff + arc 140°・36px）
// ---------------------------------------------------------------------------

const RIPOSTE = { reachPx: 36, deg: 140, seed: SEED + 800 };

/** 構え: 前に立てた半月の受けの一筆（しばらく保ち、擦れて消える）と、受けた墨の滴 */
function riposteGuard(frame, f) {
  const p = prog(f, 8);
  const pts = arcPoints(0, 0, 26, -Math.PI * 0.42, Math.PI * 0.84, 32, 0.02, RIPOSTE.seed);
  brushStroke(frame, { pts, width: 6, grow: smoothstep(0, 0.25, p), fade: smoothstep(0.6, 1, p) * 0.9, dry: 0.35, press: 0.15, tail: 0.3, seed: RIPOSTE.seed + 1 });
  splatter(frame, f, 6, RIPOSTE.seed + 2, (i, r) => {
    const a = (r(1) - 0.5) * 1.4;
    return { x: Math.cos(a) * 28, y: Math.sin(a) * 28, vx: Math.cos(a) * 1.5, vy: 1.5 + r(2), size: 1, born: 2, life: 5, level: 6 };
  });
}

/** 斬り返し: 140° の弧を走り、終わりで内へ跳ねて返る（書の「はね」） */
function riposteCounter(frame, f) {
  const R = RIPOSTE.reachPx * 2;
  const p = prog(f, 8);
  const half = (RIPOSTE.deg / 2) * (Math.PI / 180);
  const pts = arcPoints(0, 0, R * 0.82, half, -half * 2, 40, 0.02, RIPOSTE.seed + 3);
  const end = pts[pts.length - 1];
  // はね: 弧の終わりから内側・後ろへ短く跳ね上げる
  const ea = -half;
  for (let i = 1; i <= 6; i++) {
    const t = i / 6;
    pts.push({ x: end.x - Math.cos(ea) * 24 * t - 10 * t, y: end.y - Math.sin(ea) * 24 * t });
  }
  brushStroke(frame, { pts, width: 8, grow: smoothstep(0, 0.4, p), fade: smoothstep(0.5, 1, p) * 0.9, dry: 0.5, tail: 0.2, sharp: 1, seed: RIPOSTE.seed + 4 });
  splatter(frame, f, 12, RIPOSTE.seed + 5, (i, r) => {
    const a = half - half * 2 * r(1);
    return { x: Math.cos(a) * R * 0.85, y: Math.sin(a) * R * 0.85, vx: Math.cos(a) * (2 + 3 * r(2)), vy: Math.sin(a) * (2 + 3 * r(2)), size: r(3) > 0.5 ? 1.5 : 0.9, born: Math.floor(r(4) * 3), life: 5, level: 7 };
  });
}

// ---------------------------------------------------------------------------
// 滅多切り（arc 100〜110°・36〜40px）
// ---------------------------------------------------------------------------

const HACK = { reachPx: 36, seed: SEED + 900 };

/** 大振り: 荒れた太い弧の一の太刀と、逆から交差する二の太刀、欠けて飛ぶ墨の欠片 */
function hackArc(frame, f) {
  const R = HACK.reachPx * 2;
  const p = prog(f, 8);
  const half = 55 * (Math.PI / 180);
  brushStroke(frame, { pts: arcPoints(0, 0, R * 0.8, -half, half * 2, 40, 0.1, HACK.seed), width: 11, grow: smoothstep(0, 0.35, p), fade: smoothstep(0.45, 1, p) * 0.9, dry: 0.7, seed: HACK.seed + 1 });
  const g2 = smoothstep(0.15, 0.55, p);
  if (g2 > 0.02) {
    // 一の太刀を斜めに断ち切る二の太刀（上の奥から手前の下へ）
    const pts = [];
    for (let i = 0; i <= 24; i++) {
      const t = i / 24;
      pts.push({ x: R * (0.3 + 0.7 * t) + (hash1(i, HACK.seed + 2) - 0.5) * 3, y: R * (-0.7 + 1.3 * t) + 5 * Math.sin(t * Math.PI) });
    }
    brushStroke(frame, { pts, width: 7, grow: g2, fade: smoothstep(0.55, 1, p) * 0.9, dry: 0.75, seed: HACK.seed + 3 });
  }
  splatter(frame, f, 18, HACK.seed + 4, (i, r) => {
    const a = (r(1) - 0.5) * half * 2;
    const sp = 3 + 5 * r(2);
    return { x: Math.cos(a) * R * 0.8, y: Math.sin(a) * R * 0.8, vx: Math.cos(a) * sp + (r(5) - 0.5) * 4, vy: Math.sin(a) * sp + (r(6) - 0.5) * 4, size: r(3) > 0.5 ? 2 : 1, born: Math.floor(r(4) * 3), life: 6, level: 7 };
  });
}

// ---------------------------------------------------------------------------
// 墜星（blink + ring 26px・闇）
// ---------------------------------------------------------------------------

const METEOR = { burstPx: 26, seed: SEED + 1000 };

/** 闇に紛れる: 跳んだ元に墨の煙の塊が立ち昇りながらほどけ、巻いた筆の煙が昇る */
function meteorVanish(frame, f) {
  const p = prog(f, 9);
  for (let i = 0; i < 6; i++) {
    const r = (k) => hash1(i * 5 + k, METEOR.seed);
    const a = r(1) * TAU;
    const d = 4 + 12 * p * r(2);
    const rad = (6 + 4 * r(3)) * (1 - smoothstep(0.3, 1, p));
    if (rad > 1) inkBlot(frame, { x: Math.cos(a) * d, y: Math.sin(a) * d - 18 * p, radius: rad, seed: METEOR.seed + 10 + i, coreWidth: 0.3 });
  }
  for (const s of [-1, 1]) {
    const pts = [];
    for (let i = 0; i <= 16; i++) {
      const t = i / 16;
      pts.push({ x: s * (6 + 8 * Math.sin(t * 5)), y: 6 - 44 * t });
    }
    brushStroke(frame, { pts, width: 3.4, grow: smoothstep(0.1, 0.6, p), fade: smoothstep(0.4, 1, p) * 0.9, dry: 0.6, tail: 0.6, sharp: 1, seed: METEOR.seed + 20 + s });
  }
}

/** 墜ちる星（着地点。向き 1 で画面の上から）: 細い筆が上から斜めに太りながら走り、頭の墨玉が着地点へ落ちる */
function meteorFall(frame, f) {
  const p = prog(f, 9);
  const g = smoothstep(0, 0.35, p);
  const top = { x: -46, y: -110 };
  const pts = [];
  for (let i = 0; i <= 20; i++) {
    const t = i / 20;
    pts.push({ x: top.x * (1 - t) + 3 * Math.sin(t * 3), y: top.y * (1 - t) });
  }
  brushStroke(frame, { pts, width: 10, profile: (u) => 0.25 + 0.75 * u * u, grow: g, fade: smoothstep(0.3, 0.85, p), dry: 0.5, seed: METEOR.seed + 30 });
  const head = pts[Math.min(pts.length - 1, Math.round(g * 20))];
  if (p < 0.45 && head) inkBlot(frame, { x: head.x, y: head.y, radius: 6 + 4 * g, seed: METEOR.seed + 31 + f, coreWidth: 0.5 });
}

/** 闇の円（空中）: 円相が中心から外へ広がり、墜ちた所から墨が五方へ放射に跳ねる */
function burstAir(frame, f) {
  const R = METEOR.burstPx * 2;
  const p = prog(f, 9);
  enso(frame, { radius: R * (0.35 + 0.6 * smoothstep(0.05, 0.55, p)), a0: -Math.PI / 2, sweep: TAU * 0.93, width: 6, grow: smoothstep(0.05, 0.4, p), fade: smoothstep(0.55, 1, p) * 0.9, dry: 0.5, seed: METEOR.seed + 40 });
  splatter(frame, f, 20, METEOR.seed + 41, (i, r) => {
    const a = -Math.PI / 2 + ((i % 5) / 5) * TAU + (r(1) - 0.5) * 0.25;
    const sp = 2.5 + 5 * r(2);
    return { x: 0, y: 0, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, size: r(3) > 0.5 ? 1.7 : 0.9, born: 1, life: 6, level: 7 };
  });
}

/** 闇の円（地面）: 闇の墨が円く滲み広がる（内側は闇の差し色のむら） */
function burstGround(frame, f) {
  const R = METEOR.burstPx * 2;
  const p = prog(f, 9);
  inkWash(frame, { radius: R, reach: smoothstep(0, 0.55, p), seed: METEOR.seed + 50, rimWidth: 3 + 2 * (1 - p), rimLevel: 5, tint: 6, density: 0.18 * (1 - smoothstep(0.6, 1, p)), cell: 5 });
}

// ---------------------------------------------------------------------------
// 一斉起爆（detonate + ring 36px）
// ---------------------------------------------------------------------------

const DETONATE = { blastPx: 36, seed: SEED + 1100 };

/** 起爆の合図: 自分に押した丸印が開き、合図の短い筆が八方へ走る */
function detonateSign(frame, f) {
  const p = prog(f, 8);
  enso(frame, { radius: 10 + 4 * p, a0: -Math.PI / 2, sweep: TAU * 0.96, width: 3.5, grow: smoothstep(0, 0.3, p), fade: smoothstep(0.4, 1, p), dry: 0.3, seed: DETONATE.seed });
  const go = smoothstep(0.15, 1, p);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU + Math.PI / 8;
    const d0 = 18 + 34 * go;
    brushStroke(frame, { pts: seg(Math.cos(a) * d0, Math.sin(a) * d0, Math.cos(a) * (d0 + 12), Math.sin(a) * (d0 + 12)), width: 2.6, grow: 1, fade: smoothstep(0.5, 1, p) * 0.9, dry: 0.3, press: 0.05, tail: 0.7, sharp: 1, seed: DETONATE.seed + 1 + i });
  }
}

/** 弾ける（空中）: 大きな墨だまりが割れ、欠片が四方へ飛び、荒い円相が外縁を走る */
function blastAir(frame, f) {
  const R = DETONATE.blastPx * 2;
  const p = prog(f, 10);
  if (p < 0.25) inkBlot(frame, { x: 0, y: 0, radius: 28 * (0.8 + p), seed: DETONATE.seed + 10, coreWidth: 0.5 });
  enso(frame, { radius: R * (0.5 + 0.38 * smoothstep(0, 0.4, p)), a0: Math.PI * 0.2, sweep: TAU * 0.9, width: 8 * (1 - 0.4 * p), wobble: 0.14, grow: smoothstep(0, 0.3, p), fade: smoothstep(0.35, 1, p) * 0.9, dry: 0.6, seed: DETONATE.seed + 11 });
  splatter(frame, f, 30, DETONATE.seed + 12, (i, r) => {
    const a = r(1) * TAU;
    const sp = 4 + 7 * r(2);
    const big = r(3) > 0.7;
    return { x: Math.cos(a) * 10, y: Math.sin(a) * 10, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, size: big ? 3 : r(4) > 0.4 ? 1.6 : 0.9, life: 8, level: big ? 5 : 7 };
  });
}

/** 弾ける（地面）: 焦げ跡のような墨の滲みと、放射の短い擦れ */
function blastGround(frame, f) {
  const R = DETONATE.blastPx * 2;
  const p = prog(f, 10);
  inkWash(frame, { radius: R * 0.85, reach: smoothstep(0, 0.3, p), seed: DETONATE.seed + 20, rimWidth: 3, rimLevel: 5, tint: 3, density: 0.3 * (1 - 0.7 * p), cell: 6 });
  for (let i = 0; i < 12; i++) {
    const r = (k) => hash1(i * 3 + k, DETONATE.seed + 21);
    const a = (i / 12) * TAU + r(1) * 0.3;
    const d0 = R * (0.4 + 0.2 * r(2));
    const d1 = d0 + R * (0.25 + 0.2 * r(3));
    brushStroke(frame, { pts: seg(Math.cos(a) * d0, Math.sin(a) * d0, Math.cos(a) * d1, Math.sin(a) * d1), width: 2.4, grow: smoothstep(0, 0.3, p), fade: smoothstep(0.4, 1, p), dry: 0.6, press: 0.05, tail: 0.6, sharp: 1, edge: lv(5), seed: DETONATE.seed + 30 + i });
  }
}

// ---------------------------------------------------------------------------
// 十字斬り（arc 110°・34px + line 40px・幅 16px）
// ---------------------------------------------------------------------------

const CROSS = { reachPx: 34, half: 11, seed: SEED + 1200 };

/** 横画: 照準を横切る真っ直ぐに近い一筆。斜めの起筆の墨だまりから入り、終わりは止める */
function crossSide(frame, f) {
  const R = CROSS.reachPx * 2;
  const p = prog(f, 8);
  const pts = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    const y = -R * 0.78 + R * 1.56 * t;
    pts.push({ x: R * 0.55 + R * 0.12 * Math.sin(t * Math.PI), y });
  }
  const g = smoothstep(0, 0.4, p);
  const fade = smoothstep(0.5, 1, p) * 0.9;
  brushStroke(frame, { pts, width: 7, grow: g, fade, dry: 0.4, press: 0.1, tail: 0.12, sharp: 0.3, seed: CROSS.seed + 1 });
  // 起筆（斜めに置いた筆の頭）と止め（終わりで押さえた墨だまり）
  if (p < 0.8) inkBlot(frame, { x: pts[0].x - 2, y: pts[0].y - 2, radius: 7, seed: CROSS.seed + 2, coreWidth: 0.2 });
  const last = pts[pts.length - 1];
  if (g > 0.95 && p < 0.85) inkBlot(frame, { x: last.x + 1, y: last.y + 1, radius: 7, seed: CROSS.seed + 3, coreWidth: 0.2 });
}

/** 縦画の起筆: 斜めに置いた筆の頭 */
function crossPress(frame, f) {
  const p = prog(f, 7);
  if (p < 0.8) inkBlot(frame, { x: 2, y: -3, radius: CROSS.half * (1.1 - 0.4 * p), seed: CROSS.seed + 10, coreWidth: 0.25 });
  brushStroke(frame, { pts: seg(-6, -10, 6, 0), width: 5, fade: smoothstep(0.4, 1, p), dry: 0.3, seed: CROSS.seed + 11 });
}

/** 縦画（1 区間）: 太く真っ直ぐな一文字。掠れは少なめ（楷書の縦画） */
function crossBeam(frame, f) {
  const p = prog(f, 7);
  brushStroke(frame, {
    pts: seg(-SEG_HALF, 0, SEG_HALF, 0),
    width: CROSS.half * (1 - 0.45 * smoothstep(0.25, 1, p)),
    profile: () => 1,
    flat: true,
    dry: 0,
    fade: smoothstep(0.35, 1, p) * 0.8,
    pitch: 1.3,
    breakLen: 50,
    coreWidth: 0.1,
    seed: CROSS.seed + 20,
  });
}

/** 縦画の止め: 終わりで筆を押さえた丸い墨だまり（飛ばさない） */
function crossTip(frame, f) {
  const p = prog(f, 7);
  if (p < 0.85) inkBlot(frame, { x: 1, y: 1, radius: CROSS.half * (1 + 0.15 * p), seed: CROSS.seed + 30, coreWidth: 0.3 - 0.25 * p });
  splatter(frame, f, 4, CROSS.seed + 31, (i, r) => ({ x: 6, y: (r(1) - 0.5) * 10, vx: 1 + r(2), vy: (r(3) - 0.5) * 2, size: 0.9, born: 1, life: 4, level: 6 }));
}

// ---------------------------------------------------------------------------
// 背取り（blink 130px + arc 100°・30px）
// ---------------------------------------------------------------------------

const BACKSTAB = { reachPx: 30, seed: SEED + 1300 };

/** 残像: 立っていた所の縦の一筆が毛筋に裂けて掠れ消える */
function backVanish(frame, f) {
  const p = prog(f, 8);
  brushStroke(frame, { pts: seg(0, -24, 0, 12), width: 7 * (1 - 0.4 * p), press: 0.25, tail: 0.4, dry: 0.4, fade: smoothstep(0.1, 1, p), pitch: 1.6, breakLen: 6, seed: BACKSTAB.seed + 1 });
  splatter(frame, f, 6, BACKSTAB.seed + 2, (i, r) => ({ x: (r(1) - 0.5) * 10, y: -20 + 30 * r(2), vx: (r(3) - 0.5) * 3, vy: -1 - r(4), size: 0.9, life: 6, level: 5 }));
}

/** 影の足跡（1 区間）: 左右交互の小さな墨の点 */
function backTrail(frame, f) {
  const p = prog(f, 7);
  const rad = 3 * (1 - 0.6 * smoothstep(0.3, 1, p));
  if (rad < 0.8) return;
  inkBlot(frame, { x: -6, y: -4, radius: rad, seed: BACKSTAB.seed + 10, coreWidth: 0 });
  inkBlot(frame, { x: 6, y: 4, radius: rad, seed: BACKSTAB.seed + 11, coreWidth: 0 });
}

/** 回り込み: 着いた所で敵の背へ回る半円の筆 */
function backArrive(frame, f) {
  const p = prog(f, 7);
  const pts = arcPoints(0, 0, 16, Math.PI * 0.9, -Math.PI * 1.3, 30, 0.03, BACKSTAB.seed + 20);
  brushStroke(frame, { pts, width: 4, grow: smoothstep(0, 0.4, p), fade: smoothstep(0.4, 1, p) * 0.9, dry: 0.5, tail: 0.6, sharp: 1, seed: BACKSTAB.seed + 21 });
}

/** 背から斬る: 素早く締まった弧と、真ん中を貫く鋭い刺しの一筆 */
function backStab(frame, f) {
  const R = BACKSTAB.reachPx * 2;
  const p = prog(f, 7);
  const half = 50 * (Math.PI / 180);
  brushStroke(frame, { pts: arcPoints(0, 0, R * 0.72, -half, half * 2, 30, 0.03, BACKSTAB.seed + 30), width: 4.5, grow: smoothstep(0, 0.3, p), fade: smoothstep(0.4, 1, p) * 0.9, dry: 0.5, tail: 0.5, sharp: 1, seed: BACKSTAB.seed + 31 });
  brushStroke(frame, { pts: seg(6, 0, R * 1.05, 0), width: 5, grow: smoothstep(0.1, 0.4, p), fade: smoothstep(0.45, 1, p) * 0.9, press: 0.08, tail: 0.75, sharp: 1, dry: 0.3, seed: BACKSTAB.seed + 32 });
  splatter(frame, f, 9, BACKSTAB.seed + 33, (i, r) => ({ x: R, y: (r(1) - 0.5) * 4, vx: 3 + 3 * r(2), vy: (r(3) - 0.5) * 5, size: r(4) > 0.5 ? 1.4 : 0.8, born: 1, life: 5, level: 7 }));
}

// ---------------------------------------------------------------------------
// 飛び退き打ち（line 60px・幅 10px + 後ろへ dash 70px・幅 16px・雷）
// ---------------------------------------------------------------------------

const AWAY = { seed: SEED + 1400 };

/** 打ちの起こり: 手元の小さな墨だまり */
function strikePress(frame, f) {
  const p = prog(f, 6);
  if (p < 0.7) inkBlot(frame, { x: 3, y: 0, radius: 7 * (1.1 - 0.5 * p), seed: AWAY.seed + 1, coreWidth: 0.35 });
}

/** 打ち（1 区間）: 稲妻に折れる細い筆（区間の長さで 1 折れ。並べると続く）と、下を通る淡い擦れ */
function strikeBeam(frame, f) {
  const p = prog(f, 6);
  const h = SEG_HALF;
  const pts = polyline([
    { x: -h, y: 0 },
    { x: -h * 0.5, y: -5 },
    { x: h * 0.5, y: 5 },
    { x: h, y: 0 },
  ], 6);
  brushStroke(frame, { pts, width: 3.2 * (1 - 0.4 * smoothstep(0.2, 1, p)), profile: () => 1, flat: true, dry: 0, fade: smoothstep(0.3, 1, p) * 0.8, coreWidth: 0.4, breakLen: 30, seed: AWAY.seed + 10 });
  brushStroke(frame, { pts: seg(-h, 0, h, 0), width: 5, profile: () => 1, flat: true, dry: 0, fade: 0.55 + 0.4 * p, pitch: 1.3, breakLen: 8, core: lv(4), body: lv(3), edge: lv(2), seed: AWAY.seed + 11 });
}

/** 打ち当て: 当たった所の墨だまりと、前へ折れて走る二筋の稲妻の筆 */
function strikeTip(frame, f) {
  const p = prog(f, 7);
  if (p < 0.7) inkBlot(frame, { x: 0, y: 0, radius: 8 * (1 + 0.3 * p), seed: AWAY.seed + 20, coreWidth: 0.45 });
  for (const s of [-1, 1]) {
    const pts = polyline([
      { x: 4, y: 0 },
      { x: 12, y: s * 8 },
      { x: 16, y: s * 4 },
      { x: 26, y: s * 14 },
    ], 5);
    brushStroke(frame, { pts, width: 2.4, grow: smoothstep(0, 0.35, p), fade: smoothstep(0.35, 1, p), dry: 0.3, tail: 0.6, sharp: 1, coreWidth: 0.45, seed: AWAY.seed + 21 + s });
  }
  splatter(frame, f, 10, AWAY.seed + 23, (i, r) => {
    const a = (r(1) - 0.5) * 1.8;
    return { x: 4, y: 0, vx: Math.cos(a) * (3 + 4 * r(2)), vy: Math.sin(a) * (3 + 4 * r(2)), size: r(3) > 0.5 ? 1.5 : 0.9, life: 5, level: 7 };
  });
}

/** 跳び退きの蹴り（向き = 跳んだ向き。墨は前 = 敵の側 = -x へ跳ねる） */
function awayKick(frame, f) {
  const p = prog(f, 6);
  for (const s of [-1, 1]) brushStroke(frame, { pts: seg(2, s * 5, -16, s * 7), width: 3.5, grow: smoothstep(0, 0.35, p), fade: smoothstep(0.3, 1, p), dry: 0.6, seed: AWAY.seed + 30 + s });
  kickSpray(frame, f, 9, AWAY.seed + 32, { spread: 12, speed: 3 });
}

/** 跳び退く通り道（1 区間）: 両足で擦った二筋の掠れ */
function awayTrail(frame, f) {
  const p = prog(f, 7);
  for (const s of [-1, 1]) {
    brushStroke(frame, { pts: seg(-SEG_HALF, s * 6, SEG_HALF, s * 6), width: 2.6 * (1 - 0.3 * p), profile: () => 1, flat: true, dry: 0, fade: 0.3 + 0.65 * smoothstep(0.1, 1, p), pitch: 1, breakLen: 8, seed: AWAY.seed + 40 + s });
  }
}

/** 着地の滑り: 進む向きへ流れて止まる二筋と、前へ散る墨 */
function awayLand(frame, f) {
  const p = prog(f, 7);
  for (const s of [-1, 1]) brushStroke(frame, { pts: seg(-8, s * 6, 14, s * 8), width: 4, grow: smoothstep(0, 0.35, p), fade: smoothstep(0.35, 1, p), dry: 0.5, press: 0.3, tail: 0.3, seed: AWAY.seed + 50 + s });
  splatter(frame, f, 8, AWAY.seed + 52, (i, r) => ({ x: 14, y: (r(1) - 0.5) * 16, vx: 2 + 3 * r(2), vy: (r(3) - 0.5) * 4, size: r(4) > 0.5 ? 1.3 : 0.8, life: 5, level: 6 }));
}

// ---------------------------------------------------------------------------
// 表
// ---------------------------------------------------------------------------

const K = (name) => `skillArtD.${name}`;

const FX = {
  skills: {
    commonCharge: {
      ramp: "steel",
      acts: { dash: { sheet: K("chargeKick"), life: 0.4, beam: { sheet: K("chargeTrail"), step: STEP_PX }, tip: K("chargeImpact") } },
    },
    commonThousandCuts: {
      ramp: "steel",
      acts: { ringTarget: { sheet: K("cutsStorm"), life: 0.36, base: CUTS.radiusPx } },
    },
    commonTriplePound: {
      ramp: "steel",
      acts: { ringTarget: { sheet: K("poundHit"), ground: K("poundGround"), life: 0.4, base: POUND.radiusPx } },
    },
    commonInhale: {
      ramp: "steel",
      acts: { pull: { sheet: K("inhaleSwirl"), life: 0.45, base: INHALE.radiusPx } },
    },
    commonTripleThrust: {
      ramp: "steel",
      acts: { line: { sheet: K("thrustPress"), life: 0.22, beam: { sheet: K("thrustBeam"), step: STEP_PX }, tip: K("thrustTip") } },
    },
    commonLeapSlam: {
      ramp: "steel",
      acts: {
        dash: { sheet: K("leapKick"), life: 0.3, beam: { sheet: K("leapTrail"), step: STEP_PX } },
        ring: { sheet: K("slamAir"), ground: K("slamGround"), life: 0.5, base: LEAP.slamPx },
      },
    },
    commonDiveShot: {
      ramp: "steel",
      acts: {
        dash: { sheet: K("diveKick"), life: 0.32, beam: { sheet: K("diveTrail"), step: STEP_PX }, tip: K("diveLand") },
        shot: { sheet: K("diveMuzzle"), life: 0.24 },
      },
      fly: { sheet: K("diveBullet"), base: DIVE.bulletPx, period: 0.2 },
    },
    commonRiposte: {
      ramp: "steel",
      acts: {
        buff: { sheet: K("riposteGuard"), life: 0.4 },
        arc: { sheet: K("riposteCounter"), life: 0.34, base: RIPOSTE.reachPx },
      },
    },
    commonHack: {
      ramp: "steel",
      acts: { arc: { sheet: K("hackArc"), life: 0.34, base: HACK.reachPx } },
    },
    commonMeteorDive: {
      ramp: "dark",
      acts: {
        blink: { sheet: K("meteorVanish"), life: 0.45, tip: K("meteorFall") },
        ring: { sheet: K("burstAir"), ground: K("burstGround"), life: 0.5, base: METEOR.burstPx },
      },
    },
    commonDetonate: {
      ramp: "steel",
      acts: {
        detonate: { sheet: K("detonateSign"), life: 0.35 },
        ring: { sheet: K("blastAir"), ground: K("blastGround"), life: 0.5, base: DETONATE.blastPx },
      },
    },
    commonCrossCut: {
      ramp: "steel",
      acts: {
        arc: { sheet: K("crossSide"), life: 0.34, base: CROSS.reachPx },
        line: { sheet: K("crossPress"), life: 0.32, beam: { sheet: K("crossBeam"), step: STEP_PX }, tip: K("crossTip") },
      },
    },
    commonBackstab: {
      ramp: "steel",
      acts: {
        blink: { sheet: K("backVanish"), life: 0.4, beam: { sheet: K("backTrail"), step: STEP_PX }, tip: K("backArrive") },
        arc: { sheet: K("backStab"), life: 0.3, base: BACKSTAB.reachPx },
      },
    },
    commonStrikeAway: {
      ramp: "lightning",
      acts: {
        line: { sheet: K("strikePress"), life: 0.26, beam: { sheet: K("strikeBeam"), step: STEP_PX }, tip: K("strikeTip") },
        dashBack: { sheet: K("awayKick"), life: 0.32, beam: { sheet: K("awayTrail"), step: STEP_PX }, tip: K("awayLand") },
      },
    },
  },
};

/** 向きのあるシート（24 方向） */
const dir = (name, frames, size, draw) => ({ key: K(name), dirs: DIRS, frames, active: 0, size, draw });
/** 向きのないシート */
const flat = (name, frames, size, draw) => ({ key: K(name), dirs: 1, frames, active: 0, size, draw });
/** beam の 1 区間（継ぎ目に縁を出さないよう墨の仕上げを掛けない） */
const strip = (name, frames, size, draw) => ({ key: K(name), dirs: 1, frames, active: 0, size, ink: false, draw });

export const ATLAS = {
  key: "skillArtD",
  fx: FX,
  sheets: [
    dir("chargeKick", 7, 112, chargeKick),
    strip("chargeTrail", 8, 64, chargeTrail),
    dir("chargeImpact", 9, 144, chargeImpact),
    flat("cutsStorm", CUTS.frames, 160, cutsStorm),
    flat("poundHit", POUND.frames, 160, poundHit),
    flat("poundGround", POUND.frames, 160, poundGround),
    flat("inhaleSwirl", INHALE.frames, 240, inhaleSwirl),
    dir("thrustPress", 6, 64, thrustPress),
    strip("thrustBeam", 6, 48, thrustBeam),
    dir("thrustTip", 6, 96, thrustTip),
    dir("leapKick", 7, 96, leapKick),
    strip("leapTrail", 7, 48, leapTrail),
    flat("slamAir", 9, 208, slamAir),
    flat("slamGround", 9, 200, slamGround),
    dir("diveKick", 6, 96, diveKick),
    strip("diveTrail", 8, 48, diveTrail),
    dir("diveLand", 6, 64, diveLand),
    dir("diveMuzzle", 6, 96, diveMuzzle),
    dir("diveBullet", 4, 80, diveBullet),
    dir("riposteGuard", 8, 96, riposteGuard),
    dir("riposteCounter", 8, 192, riposteCounter),
    dir("hackArc", 8, 208, hackArc),
    flat("meteorVanish", 9, 128, meteorVanish),
    flat("meteorFall", 9, 256, meteorFall),
    flat("burstAir", 9, 160, burstAir),
    flat("burstGround", 9, 128, burstGround),
    flat("detonateSign", 8, 160, detonateSign),
    flat("blastAir", 10, 224, blastAir),
    flat("blastGround", 10, 176, blastGround),
    dir("crossSide", 8, 192, crossSide),
    dir("crossPress", 7, 64, crossPress),
    strip("crossBeam", 7, 64, crossBeam),
    dir("crossTip", 7, 64, crossTip),
    flat("backVanish", 8, 96, backVanish),
    strip("backTrail", 7, 48, backTrail),
    dir("backArrive", 7, 64, backArrive),
    dir("backStab", 7, 160, backStab),
    dir("strikePress", 6, 48, strikePress),
    strip("strikeBeam", 6, 48, strikeBeam),
    dir("strikeTip", 7, 96, strikeTip),
    dir("awayKick", 6, 80, awayKick),
    strip("awayTrail", 7, 48, awayTrail),
    dir("awayLand", 7, 80, awayLand),
  ],
};
