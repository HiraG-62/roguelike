// 技（共通技 前半 15 種）の墨のエフェクト（docs/ideas/fx-sprites.md 10 章）。単位は絵のドット（論理 0.5px）。正準の向きは +x
// 見本は skillArt.mjs（旋風斬り・撃ち抜き・突進斬り）。表は行為の種類ごと（acts.<種類>）に絵を持ち、弾を撃つ技は fly も持つ
//
// 衝撃波（commonShockwave。ring 42px・押し返す）: 足元を踏む墨だまり（地面）から、太い円相が外へ押し広がり、縁から外へ短い払いと飛沫が飛ぶ
// 飛び退き（commonBackstep。dashBack 64px）: 踏み切りで前（敵の側）へ墨が跳ね、通り道は宙を跳んだ細い点線の飛白、着地は踵で擦った弧の筆
// 瞬身（commonBlink。blink）: 元の所で立った墨の一筆が飛沫に砕けて消え、まばらな墨の粒が道を示し、着いた所で粒が寄り集まって一筆に戻る
// 鬨の声（commonWarCry。ring 56px + buff）: 口から声の輪（途切れた弧の三重）が外へ広がり、鋸の叫び線が走る。纏いは体の両脇に立ち昇る気炎の筆
// 応急手当（commonFirstAid。buff）: 包帯が体に巻き付く帯の筆と、頭上に書く「十」の二画、立ち昇る小さな墨の粒
// 瞑想（commonMeditate。buff）: 体の周りを静かに一周する細い円相と、足元の水面に広がる二重の波紋（地面）
// 火球（commonFireball。shot・弾 5px・火）: 墨玉の芯に火の差し色、後ろへ揺れる炎の舌の筆。撃つ瞬間は前へ墨が弾けて炎の舌が開く
// 氷の投げ槍（commonIceLance。shot・弾 4px・氷）: 尖った一筆の槍（稜の筋と返し）と、後ろに散る六花の欠片。撃つ瞬間は前へ氷の欠片の短い筆
// 雷鳴（commonThunderclap。ringTarget 30px・雷）: 天から折れ曲がる稲妻の一筆が落ち、着いた所で墨が弾けて円相が割れる。床は裂け目の筆（地面）
// 毒霧（commonPoisonMist。ringTarget 34px・毒）: 渦を巻く雲（霊芝雲の巻き）が湧いて広がり、毒の雫が垂れる。床は間引いた毒沼の滲み（地面）
// 闇弾（commonShadowBolt。shot・弾 6px・闇）: 揺らぐ墨玉と、後ろへうねる二筋の煙の尾。撃つ瞬間は墨が膨らんで触手が開く
// 聖光（commonHolyNova。ring 44px・光 + buff）: 光背（円相と放射する筆の筋）が外へ開く。纏いは頭上に書く小さな頭光の円
// 連鎖電（commonChainSpark。chain・雷）: 跳ねる 1 区間ごとの折れ線の筆（beam）と、当たった所で弾ける墨と短い折れの筆（tip）
// 引き寄せ（commonMagnet。pull 70px・闇）: 外から中心へ巻き込む渦の筆が 6 本走り、墨の粒が吸い込まれ、最後に中心へ墨が溜まる
// 煙玉（commonSmokeBomb。ring 10px〔煙は 30px〕+ dashBack 48px）: 足元で墨玉が割れて、淡墨の煙の巻き雲が膨らむ。跳び退く道は煙の筋
import { arcPoints, brushStroke, enso, inkBlot, inkWash, lv, splatter } from "../brush.mjs";
import { dot, hash1, paint, smoothstep, valueNoise } from "../raster.mjs";
import { DIRS } from "../motifs.mjs";

const TAU = Math.PI * 2;
const SEED = 7301;

/** 進み（0..1）。f はコマ、n はコマ数 */
const prog = (f, n) => (f + 0.5) / n;

/** 渦（中心 0,0。半径 r0 → r1 へ、角 a0 から sweep） */
function spiralPoints(r0, r1, a0, sweep, steps = 32) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const a = a0 + sweep * t;
    const r = r0 + (r1 - r0) * t;
    pts.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
  }
  return pts;
}

/** 平行移動した折れ線 */
function shift(pts, dx, dy) {
  return pts.map((p) => ({ x: p.x + dx, y: p.y + dy }));
}

/** 折れ線の稲妻（a → b。jag は横の振れ、n は折れの数）。両端は動かさない */
function zigzag(ax, ay, bx, by, n, jag, seed) {
  const pts = [{ x: ax, y: ay }];
  const len = Math.hypot(bx - ax, by - ay) || 1;
  const nx = -(by - ay) / len;
  const ny = (bx - ax) / len;
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const s = (i % 2 === 0 ? 1 : -1) * jag * (0.5 + hash1(i, seed));
    pts.push({ x: ax + (bx - ax) * t + nx * s, y: ay + (by - ay) * t + ny * s });
  }
  pts.push({ x: bx, y: by });
  return pts;
}

/** 寄り集まる墨の粒（splatter の逆。外から (tx, ty) へ吸い込まれる） */
function converge(frame, p, count, seed, o) {
  for (let i = 0; i < count; i++) {
    const r = (k) => hash1(i * 13 + k, seed);
    const a = r(1) * TAU;
    const d = o.from * (0.6 + 0.4 * r(2));
    const delay = r(3) * 0.3;
    const t = smoothstep(delay, delay + (o.span ?? 0.6), p);
    if (t <= 0 || t >= 0.98) continue;
    const k = t * t;
    const x = (o.tx ?? 0) + Math.cos(a) * d * (1 - k);
    const y = (o.ty ?? 0) + Math.sin(a) * d * (1 - k);
    const size = (r(4) > 0.6 ? 1.5 : 0.9) * (1 - 0.4 * t);
    for (let dy = -size; dy <= size; dy += 0.5) for (let dx = -size; dx <= size; dx += 0.5) if (dx * dx + dy * dy <= size * size) dot(frame, x + dx, y + dy, o.level ?? 6);
    // 尾（来た向き = 外へ）
    for (let s = 1; s < size * 3; s += 0.5) dot(frame, x + Math.cos(a) * s, y + Math.sin(a) * s, 3);
  }
}

/** 外へ放射状に飛ぶ飛沫（中心 cx, cy・半径 r0 から） */
function burst(frame, f, count, seed, o) {
  splatter(frame, f, count, seed, (i, r) => {
    const a = (o.a0 ?? 0) + (o.spread ?? TAU) * (r(1) - (o.spread ? 0.5 : 0));
    const r0 = o.r0 ?? 0;
    const sp = (o.speed ?? 4) * (0.6 + 0.8 * r(2));
    return {
      x: (o.cx ?? 0) + Math.cos(a) * r0,
      y: (o.cy ?? 0) + Math.sin(a) * r0,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp + (o.fall ?? 0),
      size: r(3) > 0.55 ? (o.big ?? 1.7) : 0.9,
      born: o.born ? r(5) * o.born : 0,
      life: o.life ?? 5,
      level: r(4) > 0.5 ? 7 : 5,
    };
  });
}

// ---------------------------------------------------------------------------
// 衝撃波
// ---------------------------------------------------------------------------

const SHOCK = { radiusPx: 42, frames: 9 };

function shockwave(frame, f) {
  const R = SHOCK.radiusPx * 2;
  const p = prog(f, SHOCK.frames);
  const reach = 0.35 + 0.65 * smoothstep(0, 0.55, p);
  const fade = smoothstep(0.55, 1, p) * 0.9;
  // 太い円相が押し広がる（外へ行くほど筆が細って乾く）
  enso(frame, { radius: R * 0.9 * reach, a0: -Math.PI * 0.35, sweep: TAU * 0.94, width: 11 - 4 * p, grow: smoothstep(0, 0.35, p), fade, dry: 0.4 + 0.3 * p, seed: SEED + 1 });
  // 縁から外へ押し出す短い払い（8 本）
  const g = smoothstep(0.15, 0.6, p);
  if (g > 0.02) {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU + 0.2 * hash1(i, SEED + 2);
      const r0 = R * 0.9 * reach + 4;
      const r1 = r0 + 14 + 8 * hash1(i, SEED + 3);
      brushStroke(frame, {
        pts: [
          { x: Math.cos(a) * r0, y: Math.sin(a) * r0 },
          { x: Math.cos(a + 0.08) * r1, y: Math.sin(a + 0.08) * r1 },
        ],
        width: 4,
        grow: g,
        fade: fade,
        dry: 0.6,
        tail: 0.6,
        seed: SEED + 10 + i,
      });
    }
  }
  burst(frame, f, 16, SEED + 4, { r0: R * 0.4, speed: 6, life: 5 });
}

/** 足元の踏み込み（地面）: 墨だまりがひび割れて広がる */
function shockStomp(frame, f) {
  const p = prog(f, SHOCK.frames);
  if (p > 0.85) return;
  inkBlot(frame, { radius: 14 + 6 * smoothstep(0, 0.3, p), seed: SEED + 20, coreWidth: 0.3 * (1 - p) });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + hash1(i, SEED + 21);
    const pts = zigzag(Math.cos(a) * 14, Math.sin(a) * 14, Math.cos(a) * 44, Math.sin(a) * 44, 3, 4, SEED + 22 + i);
    brushStroke(frame, { pts, width: 2.4, grow: smoothstep(0, 0.4, p), fade: smoothstep(0.4, 0.85, p), dry: 0.3, tail: 0.6, seed: SEED + 30 + i });
  }
}

// ---------------------------------------------------------------------------
// 飛び退き（dashBack。+x = 跳んだ向き）
// ---------------------------------------------------------------------------

const LEAP_STEP_PX = 12;

/** 踏み切り: 足元から前（-x = 敵の側）へ墨が跳ね、短く蹴った筆 */
function leapKick(frame, f) {
  const p = prog(f, 6);
  brushStroke(frame, {
    pts: [
      { x: 6, y: 0 },
      { x: -18, y: 0 },
    ],
    width: 6,
    grow: smoothstep(0, 0.35, p),
    fade: smoothstep(0.35, 1, p),
    dry: 0.8,
    seed: SEED + 40,
  });
  burst(frame, f, 12, SEED + 41, { a0: Math.PI, spread: 1.4, speed: 5, life: 5 });
}

/** 宙を跳んだ道（beam の 1 区間）: 細い 2 本の飛白の点線（足が床を離れているので途切れがち） */
function leapTrail(frame, f) {
  const p = prog(f, 7);
  const half = LEAP_STEP_PX + 0.6;
  for (const [y, s] of [
    [-5, 0],
    [5, 1],
  ]) {
    brushStroke(frame, {
      pts: [
        { x: -half, y },
        { x: half, y },
      ],
      width: 2.2,
      profile: () => 1,
      flat: true,
      dry: 0,
      fade: 0.25 + 0.7 * smoothstep(0.1, 1, p),
      pitch: 0.9,
      breakLen: 5,
      seed: SEED + 45 + s,
    });
  }
}

/** 着地: 踵で擦った弧の筆（跳んだ向きへ膨らむ）と、前へ跳ねる粒 */
function leapLand(frame, f) {
  const p = prog(f, 7);
  const pts = arcPoints(-14, 0, 22, -Math.PI * 0.42, Math.PI * 0.84, 20);
  brushStroke(frame, { pts, width: 6, grow: smoothstep(0, 0.35, p), fade: smoothstep(0.4, 1, p) * 0.9, dry: 0.6, tail: 0.5, seed: SEED + 50 });
  burst(frame, f, 9, SEED + 51, { cx: 8, a0: 0, spread: 1.6, speed: 4, life: 5 });
}

// ---------------------------------------------------------------------------
// 瞬身（blink。+x = 跳んだ向き）
// ---------------------------------------------------------------------------

const BLINK_STEP_PX = 12;

/** 消える: 立った墨の一筆（体の影）が飛沫に砕けて行き先へ流れる */
function blinkVanish(frame, f) {
  const p = prog(f, 8);
  if (p < 0.4) {
    brushStroke(frame, {
      pts: [
        { x: 0, y: -26 },
        { x: 1, y: 10 },
      ],
      width: 8,
      fade: smoothstep(0, 0.4, p) * 0.9,
      dry: 0.4,
      seed: SEED + 60,
    });
  }
  splatter(frame, f, 18, SEED + 61, (i, r) => ({
    x: (r(1) - 0.5) * 8,
    y: -26 + 36 * r(2),
    vx: 2 + 5 * r(3),
    vy: (r(4) - 0.5) * 3,
    size: r(5) > 0.5 ? 1.5 : 0.9,
    born: r(6) * 2,
    life: 5,
    level: r(7) > 0.5 ? 7 : 5,
  }));
}

/** 道（beam の 1 区間）: まばらな墨の粒 */
function blinkTrail(frame, f) {
  const p = prog(f, 8);
  const half = BLINK_STEP_PX;
  for (let i = 0; i < 3; i++) {
    if (hash1(i + f * 7, SEED + 65) < p * 0.9) continue;
    const x = -half + (i + 0.5) * ((half * 2) / 3) + (hash1(i, SEED + 66) - 0.5) * 4;
    const y = (hash1(i, SEED + 67) - 0.5) * 10;
    const s = hash1(i, SEED + 68) > 0.5 ? 1.4 : 0.9;
    for (let dy = -s; dy <= s; dy += 0.5) for (let dx = -s; dx <= s; dx += 0.5) if (dx * dx + dy * dy <= s * s) dot(frame, x + dx, y + dy, 6);
  }
}

/** 現れる: 粒が寄り集まって立った一筆に戻り、足元に小さな墨の輪 */
function blinkAppear(frame, f) {
  const p = prog(f, 8);
  converge(frame, p, 18, SEED + 70, { from: 30, ty: -8, span: 0.45 });
  const g = smoothstep(0.35, 0.65, p);
  if (g > 0.02) {
    brushStroke(frame, {
      pts: [
        { x: 0, y: 10 },
        { x: 0, y: -26 },
      ],
      width: 7,
      grow: g,
      fade: smoothstep(0.7, 1, p),
      dry: 0.5,
      seed: SEED + 71,
    });
  }
  if (p > 0.4) enso(frame, { radius: 14, oy: 10, a0: 0, sweep: TAU * 0.85, width: 2.5, grow: smoothstep(0.4, 0.7, p), fade: smoothstep(0.75, 1, p), seed: SEED + 72 });
}

// ---------------------------------------------------------------------------
// 鬨の声
// ---------------------------------------------------------------------------

const SHOUT = { radiusPx: 56, frames: 10 };

/** 声の輪: 途切れた弧が三重に、時間差で外へ広がる。始めに鋸の叫び線 */
function warShout(frame, f) {
  const R = SHOUT.radiusPx * 2;
  const p = prog(f, SHOUT.frames);
  for (let k = 0; k < 3; k++) {
    const t0 = k * 0.18;
    const q = smoothstep(t0, t0 + 0.55, p);
    if (q <= 0.01 || q >= 0.99) continue;
    const r = R * (0.25 + 0.75 * q);
    const segs = 4;
    for (let s = 0; s < segs; s++) {
      const a0 = (s / segs) * TAU + k * 0.6 + 0.12;
      const pts = arcPoints(0, 0, r, a0, (TAU / segs) * 0.72, 20, 0.03, SEED + 80 + s);
      brushStroke(frame, { pts, width: 7 - 1.5 * k - 2 * q, fade: smoothstep(0.55, 1, q), dry: 0.5, tail: 0.5, seed: SEED + 81 + k * 7 + s });
    }
  }
  // 叫び線（鋸の筆が外へ）
  const g = smoothstep(0, 0.25, p);
  const fd = smoothstep(0.3, 0.6, p);
  if (fd < 0.99) {
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * TAU + 0.3 * hash1(i, SEED + 90);
      const pts = zigzag(Math.cos(a) * 20, Math.sin(a) * 20, Math.cos(a) * 62, Math.sin(a) * 62, 5, 4, SEED + 91 + i);
      brushStroke(frame, { pts, width: 3, grow: g, fade: fd, dry: 0.3, tail: 0.6, seed: SEED + 100 + i });
    }
  }
}

/** 気炎（buff）: 体の両脇から立ち昇る炎の形の筆 */
function warRouse(frame, f) {
  const p = prog(f, 9);
  const g = smoothstep(0, 0.5, p);
  const fd = smoothstep(0.55, 1, p);
  for (const side of [-1, 1]) {
    for (let k = 0; k < 2; k++) {
      const x0 = side * (14 + k * 7);
      const pts = [];
      for (let i = 0; i <= 14; i++) {
        const t = i / 14;
        pts.push({ x: x0 + side * Math.sin(t * Math.PI * 1.4 + k) * 4 - side * t * 8, y: 14 - (56 + k * 10) * t });
      }
      brushStroke(frame, { pts, width: 3.6 - k * 1.1, grow: g, fade: fd, dry: 0.5, tail: 0.7, seed: SEED + 110 + k + (side > 0 ? 5 : 0) });
    }
  }
  splatter(frame, f, 8, SEED + 115, (i, r) => ({ x: (r(1) - 0.5) * 36, y: -10, vx: (r(2) - 0.5) * 2, vy: -(3 + 3 * r(3)), size: r(4) > 0.5 ? 1.3 : 0.8, born: r(5) * 3, life: 5, level: 6 }));
}

// ---------------------------------------------------------------------------
// 応急手当
// ---------------------------------------------------------------------------

/** 包帯の帯が体に巻き付き、頭上に「十」を書く */
function firstAid(frame, f) {
  const p = prog(f, 10);
  const fd = smoothstep(0.7, 1, p) * 0.9;
  // 巻き付く帯: 傾いた楕円の弧を 2 段（前を通る半周だけ太く）
  for (let k = 0; k < 2; k++) {
    const cy = -2 + k * 10;
    const pts = [];
    for (let i = 0; i <= 24; i++) {
      const a = Math.PI * 1.05 - Math.PI * 1.1 * (i / 24);
      pts.push({ x: Math.cos(a) * 16, y: cy + Math.sin(a) * 5 + (i / 24 - 0.5) * -6 });
    }
    brushStroke(frame, { pts, width: 3.6, profile: () => 1, grow: smoothstep(k * 0.15, 0.35 + k * 0.15, p), fade: fd, dry: 0.35, seed: SEED + 120 + k });
  }
  // 十（横画 → 縦画）
  const h = smoothstep(0.3, 0.5, p);
  const v = smoothstep(0.45, 0.65, p);
  if (h > 0.02) brushStroke(frame, { pts: [{ x: -14, y: -40 }, { x: 14, y: -41 }], width: 3.4, grow: h, fade: fd, dry: 0.4, seed: SEED + 125 });
  if (v > 0.02) brushStroke(frame, { pts: [{ x: 0, y: -55 }, { x: 0.5, y: -26 }], width: 3.4, grow: v, fade: fd, dry: 0.4, seed: SEED + 126 });
  splatter(frame, f, 10, SEED + 127, (i, r) => ({ x: (r(1) - 0.5) * 30, y: 8 - 10 * r(2), vx: (r(3) - 0.5) * 1, vy: -(2 + 2 * r(4)), size: r(5) > 0.5 ? 1.2 : 0.8, born: 2 + r(6) * 4, life: 4, level: 6 }));
}

// ---------------------------------------------------------------------------
// 瞑想
// ---------------------------------------------------------------------------

/** 体の周りを静かに一周する細い円相 */
function meditate(frame, f) {
  const p = prog(f, 12);
  enso(frame, { radius: 30, a0: Math.PI * 0.5, sweep: TAU * 0.96, width: 3.6, grow: smoothstep(0, 0.6, p), fade: smoothstep(0.7, 1, p) * 0.9, dry: 0.45, wobble: 0.02, seed: SEED + 130 });
}

/** 足元の波紋（地面）: 平たい楕円の細い輪が二重に広がる */
function meditateRipple(frame, f) {
  const p = prog(f, 12);
  for (let k = 0; k < 2; k++) {
    const q = smoothstep(k * 0.25, 0.6 + k * 0.25, p);
    if (q <= 0.01 || q >= 0.99) continue;
    const rx = 14 + 30 * q;
    const pts = [];
    for (let i = 0; i <= 40; i++) {
      const a = 0.3 + (TAU - 0.6) * (i / 40);
      pts.push({ x: Math.cos(a) * rx, y: 12 + Math.sin(a) * rx * 0.35 });
    }
    brushStroke(frame, { pts, width: 2.2, profile: () => 1, fade: smoothstep(0.4, 1, q), dry: 0.3, seed: SEED + 135 + k });
  }
}

// ---------------------------------------------------------------------------
// 火球（弾 5px）
// ---------------------------------------------------------------------------

const FIREBALL_PX = 5;

/** 炎の舌: 玉の後ろへ揺れながら伸びる筆（コマで揺れる） */
function flameTongues(frame, f, frames, r, seed, n = 3, len = 40) {
  for (let k = 0; k < n; k++) {
    const off = (k - (n - 1) / 2) * r * 0.7;
    const ph = (f / frames) * TAU + k * 2.1;
    const pts = [];
    for (let i = 0; i <= 12; i++) {
      const t = i / 12;
      pts.push({ x: -r * 0.3 - (len - Math.abs(off) * 1.2) * t, y: off * (1 - 0.3 * t) + Math.sin(ph + t * 5) * 4 * t });
    }
    brushStroke(frame, { pts, width: r * 0.42, dry: 0.4, tail: 0.75, core: lv(6), coreWidth: 0.25, seed: seed + k });
  }
}

function fireballFly(frame, f) {
  const r = FIREBALL_PX * 2;
  flameTongues(frame, f, 8, r, SEED + 140);
  inkBlot(frame, { radius: r * 0.9, seed: SEED + 145 + (f % 4), coreWidth: 0.28 });
}

/** 撃つ: 手元で墨が前へ弾け、炎の舌が開く */
function fireballShot(frame, f) {
  const p = prog(f, 7);
  if (p < 0.5) inkBlot(frame, { x: 8, radius: 9 * (1 - p), seed: SEED + 150, coreWidth: 0.5 });
  for (const s of [-1, 1]) {
    const pts = [];
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      pts.push({ x: 6 + 22 * t, y: s * (4 + 10 * t * t) });
    }
    brushStroke(frame, { pts, width: 4, grow: smoothstep(0, 0.4, p), fade: smoothstep(0.35, 1, p), dry: 0.5, tail: 0.7, core: lv(7), seed: SEED + 151 + s });
  }
  burst(frame, f, 10, SEED + 153, { cx: 8, a0: 0, spread: 1.4, speed: 4, life: 5 });
}

// ---------------------------------------------------------------------------
// 氷の投げ槍（弾 4px）
// ---------------------------------------------------------------------------

const LANCE_PX = 4;

/** 六花の欠片（小さな三本線の雪の結晶） */
function flake(frame, x, y, size, level) {
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI + 0.3;
    for (let t = -size; t <= size; t += 0.5) dot(frame, x + Math.cos(a) * t, y + Math.sin(a) * t, level);
  }
}

function lanceFly(frame, f) {
  // 槍の本体: 後ろ（太い）から穂先（尖る）へ、押してから細って尖る一筆
  brushStroke(frame, {
    pts: [
      { x: -34, y: 0 },
      { x: 18, y: 0 },
    ],
    width: 6,
    profile: (u) => 0.45 + 0.55 * smoothstep(0, 0.45, u) * (1 - smoothstep(0.62, 1, u) * 0.95),
    dry: 0.1,
    coreWidth: 0.3,
    seed: SEED + 160,
  });
  // 穂先の返し（稜）
  for (const s of [-1, 1]) {
    brushStroke(frame, {
      pts: [
        { x: 10, y: s * 2 },
        { x: 2, y: s * 8 },
      ],
      width: 2.2,
      tail: 0.7,
      dry: 0,
      seed: SEED + 162 + s,
    });
  }
  // 後ろに散る六花（コマで後ろへ流れて消える）
  for (let i = 0; i < 4; i++) {
    const t = ((f / 8 + i / 4) % 1);
    const y = (hash1(i, SEED + 165) - 0.5) * 14;
    if (t > 0.85) continue;
    flake(frame, -36 - 26 * t, y, 2.6 * (1 - t * 0.6), t < 0.4 ? 7 : 5);
  }
}

/** 撃つ: 手元から前へ三本の細い氷の針が扇に走り、六花が散る */
function lanceShot(frame, f) {
  const p = prog(f, 7);
  const g = smoothstep(0, 0.35, p);
  const fd = smoothstep(0.4, 1, p);
  for (let i = 0; i < 3; i++) {
    const a = (i - 1) * 0.32;
    const len = i === 1 ? 30 : 22;
    brushStroke(frame, {
      pts: [
        { x: 4, y: 0 },
        { x: 4 + Math.cos(a) * len, y: Math.sin(a) * len },
      ],
      width: i === 1 ? 3.4 : 2.6,
      grow: g,
      fade: fd,
      press: 0.05,
      tail: 0.7,
      dry: 0.2,
      seed: SEED + 172 + i,
    });
  }
  if (p > 0.25 && p < 0.9) {
    flake(frame, 20, -12, 3, 7);
    flake(frame, 24, 12, 2.4, 6);
  }
}

// ---------------------------------------------------------------------------
// 雷鳴（照準地点。半径 30px）
// ---------------------------------------------------------------------------

const THUNDER = { radiusPx: 30, frames: 9 };
const BOLT_TOP = -150;

/** 天から落ちる稲妻と、着いた所で弾ける墨・割れた円相 */
function thunder(frame, f) {
  const R = THUNDER.radiusPx * 2;
  const p = prog(f, THUNDER.frames);
  // 稲妻: 上から一気に落ちる太い折れの筆（初めの 3 コマ）
  if (p < 0.5) {
    const pts = zigzag(6, BOLT_TOP, 0, 0, 6, 9, SEED + 180);
    brushStroke(frame, { pts, width: 7, grow: smoothstep(0, 0.12, p), fade: smoothstep(0.2, 0.5, p), dry: 0.3, press: 0.05, tail: 0.25, sharp: 0.3, coreWidth: 0.3, seed: SEED + 181 });
    // 枝分かれ
    const b = zigzag(-4, BOLT_TOP * 0.55, -26, BOLT_TOP * 0.28, 3, 4, SEED + 182);
    brushStroke(frame, { pts: b, width: 3, grow: smoothstep(0.03, 0.15, p), fade: smoothstep(0.2, 0.5, p), dry: 0.3, tail: 0.6, seed: SEED + 183 });
  }
  // 着弾: 墨だまりが割れる
  if (p > 0.08 && p < 0.6) inkBlot(frame, { radius: 16 * (1 - 0.5 * smoothstep(0.2, 0.6, p)), seed: SEED + 184, coreWidth: 0.4 });
  // 割れた円相（二筆で半周ずつ）
  const g = smoothstep(0.1, 0.5, p);
  if (g > 0.02) {
    for (let k = 0; k < 2; k++) {
      enso(frame, { radius: R * (0.7 + 0.25 * g), a0: k * Math.PI + 0.4, sweep: Math.PI * 0.82, width: 6, grow: g, fade: smoothstep(0.55, 1, p) * 0.9, dry: 0.5, seed: SEED + 185 + k });
    }
  }
  burst(frame, f - 1, 16, SEED + 188, { r0: 8, speed: 6, life: 5 });
}

/** 床の裂け目（地面）: 中心から外へ折れて走る細い筆 */
function thunderScorch(frame, f) {
  const R = THUNDER.radiusPx * 2;
  const p = prog(f, THUNDER.frames);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * TAU + hash1(i, SEED + 190) * 0.6;
    const len = R * (0.6 + 0.35 * hash1(i, SEED + 191));
    const pts = zigzag(0, 0, Math.cos(a) * len, Math.sin(a) * len, 4, 4, SEED + 192 + i);
    brushStroke(frame, { pts, width: 2.4, grow: smoothstep(0.08, 0.35, p), fade: smoothstep(0.55, 1, p), dry: 0.3, tail: 0.6, core: lv(7), seed: SEED + 200 + i });
  }
}

// ---------------------------------------------------------------------------
// 毒霧（照準地点。半径 34px・毒沼 22px）
// ---------------------------------------------------------------------------

const MIST = { radiusPx: 34, frames: 11 };

/** 霊芝雲の巻き: 外側から内へ巻き込む渦の一筆（cx, cy に r の大きさ） */
function curl(frame, cx, cy, r, a0, dir, o) {
  const pts = shift(spiralPoints(r, r * 0.18, a0, dir * TAU * 1.45, 40), cx, cy);
  brushStroke(frame, { pts, width: o.width, grow: o.grow, fade: o.fade, dry: 0.45, press: 0.08, tail: 0.6, core: o.core, body: o.body, edge: o.edge, seed: o.seed });
}

/** 雲の輪郭: 丸い瘤が連なる閉じきらない輪（瘤の数 n）。sx, sy で楕円に。3 つに途切れさせて筆らしく */
function cloudOutline(frame, R, n, o) {
  const segs = 3;
  for (let k = 0; k < segs; k++) {
    const pts = [];
    const a0 = (k / segs) * TAU + 0.15;
    const sweep = (TAU / segs) * 0.86;
    for (let i = 0; i <= 40; i++) {
      const a = a0 + sweep * (i / 40);
      const r = R * (0.8 + 0.2 * Math.sqrt(Math.abs(Math.sin((a * n) / 2))));
      pts.push({ x: Math.cos(a) * r, y: Math.sin(a) * r * (o.sy ?? 1) + (o.oy ?? 0) });
    }
    brushStroke(frame, { pts, width: o.width, grow: o.grow, fade: o.fade, dry: 0.45, tail: 0.5, core: o.core, body: o.body, edge: o.edge, seed: o.seed + k });
  }
}

function poisonMist(frame, f) {
  const R = MIST.radiusPx * 2;
  const p = prog(f, MIST.frames);
  const g = smoothstep(0, 0.45, p);
  const fd = smoothstep(0.6, 1, p) * 0.9;
  const spread = 0.45 + 0.55 * g;
  // 霧の外形（瘤の連なる雲の輪郭）
  cloudOutline(frame, R * 0.95 * spread, 7, { sy: 0.85, oy: -6 * p, width: 4, grow: smoothstep(0, 0.4, p), fade: fd, seed: SEED + 205 });
  // 内側の巻き雲 5 つ（外へ広がって少し昇る）
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU + 0.3 * hash1(i, SEED + 210);
    const d = R * 0.5 * spread;
    const cx = Math.cos(a) * d;
    const cy = Math.sin(a) * d * 0.8 - 6 * p;
    const r = R * (0.17 + 0.05 * hash1(i, SEED + 211)) * (0.7 + 0.3 * g);
    curl(frame, cx, cy, r, a + Math.PI, 1, { width: 3.2, grow: smoothstep(i * 0.03, 0.4 + i * 0.03, p), fade: fd, seed: SEED + 212 + i });
  }
  // 真ん中の大きな巻き
  curl(frame, 0, -4 * p, R * 0.22 * (0.6 + 0.4 * g), 0, 1, { width: 4, grow: smoothstep(0.05, 0.45, p), fade: fd, seed: SEED + 220 });
  // 毒の雫（下へ垂れる）
  splatter(frame, f, 12, SEED + 221, (i, r) => ({
    x: (r(1) - 0.5) * R * 1.4,
    y: (r(2) - 0.5) * R * 0.8,
    vx: 0,
    vy: 2 + 2 * r(3),
    size: r(4) > 0.5 ? 1.6 : 1,
    born: 2 + r(5) * 5,
    life: 4,
    level: r(6) > 0.4 ? 7 : 5,
  }));
}

/** 毒沼の滲み（地面）: 縁は墨だまり、内側は差し色のまばらなむら */
function poisonMistFloor(frame, f) {
  const R = MIST.radiusPx * 2;
  const p = prog(f, MIST.frames);
  inkWash(frame, { radius: R * 0.85, reach: smoothstep(0.1, 0.6, p), seed: SEED + 230, rimWidth: 2.5, rimLevel: 5, tint: 6, density: 0.12 * (1 - smoothstep(0.7, 1, p)) + 0.02, cell: 7 });
}

// ---------------------------------------------------------------------------
// 闇弾（弾 6px）
// ---------------------------------------------------------------------------

const SHADOW_PX = 6;

/** 煙の尾: 玉から後ろへうねって細る二筋 */
function shadowTendrils(frame, f, frames, r, seed, len = 60) {
  for (let k = 0; k < 2; k++) {
    const ph = (f / frames) * TAU + k * Math.PI;
    const pts = [];
    for (let i = 0; i <= 16; i++) {
      const t = i / 16;
      pts.push({ x: -r * 0.5 - len * t, y: Math.sin(ph - t * 6) * (2 + 9 * t) });
    }
    brushStroke(frame, { pts, width: r * 0.38, dry: 0.5, tail: 0.8, coreWidth: 0.2, core: lv(6), seed: seed + k });
  }
}

function shadowFly(frame, f) {
  const r = SHADOW_PX * 2;
  shadowTendrils(frame, f, 8, r, SEED + 240);
  // 揺らぐ墨玉（縁が波打つ）
  const ph = (f / 8) * TAU;
  paint(
    frame,
    (x, y) => {
      const a = Math.atan2(y, x);
      const d = Math.hypot(x, y);
      const edge = r * (0.88 + 0.1 * Math.sin(a * 5 + ph) + 0.12 * valueNoise(Math.cos(a) * 5 + 7, Math.sin(a) * 5 + 7 + f, 3, SEED + 245));
      if (d > edge) return -1;
      return d / edge < 0.28 ? lv(7) : lv(5);
    },
    { bounds: { x0: -r * 1.4, y0: -r * 1.4, x1: r * 1.4, y1: r * 1.4 } },
  );
}

/** 撃つ: 墨が膨らんで、前へ触手が開く */
function shadowShot(frame, f) {
  const p = prog(f, 7);
  if (p < 0.55) inkBlot(frame, { x: 6, radius: 7 + 6 * smoothstep(0, 0.3, p) - 8 * smoothstep(0.3, 0.55, p), seed: SEED + 250, coreWidth: 0.45 });
  for (let k = 0; k < 4; k++) {
    const a = (k - 1.5) * 0.45;
    const pts = [];
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      const aa = a + Math.sin(t * 3 + k) * 0.25;
      pts.push({ x: 6 + Math.cos(aa) * 26 * t, y: Math.sin(aa) * 26 * t });
    }
    brushStroke(frame, { pts, width: 3, grow: smoothstep(0.05, 0.45, p), fade: smoothstep(0.4, 1, p), dry: 0.4, tail: 0.8, seed: SEED + 251 + k });
  }
}

// ---------------------------------------------------------------------------
// 聖光（半径 44px）
// ---------------------------------------------------------------------------

const NOVA = { radiusPx: 44, frames: 10 };

/** 光背: 円相と、内から外へ放射する筆の筋（光を墨の線で描く） */
function holyNova(frame, f) {
  const R = NOVA.radiusPx * 2;
  const p = prog(f, NOVA.frames);
  const g = smoothstep(0, 0.5, p);
  const fd = smoothstep(0.6, 1, p) * 0.9;
  const reach = 0.5 + 0.5 * g;
  enso(frame, { radius: R * 0.55 * reach, a0: -Math.PI / 2, sweep: TAU * 0.97, width: 5, grow: smoothstep(0, 0.35, p), fade: fd, dry: 0.4, seed: SEED + 260 });
  const n = 24;
  const rg = smoothstep(0.1, 0.5, p);
  for (let i = 0; i < n && rg > 0.08; i++) {
    const a = (i / n) * TAU;
    const long = i % 2 === 0;
    const r0 = R * 0.62 * reach;
    const r1 = R * (long ? 0.98 : 0.82) * reach;
    brushStroke(frame, {
      pts: [
        { x: Math.cos(a) * r0, y: Math.sin(a) * r0 },
        { x: Math.cos(a) * r1, y: Math.sin(a) * r1 },
      ],
      width: long ? 3 : 2,
      grow: rg,
      fade: fd,
      press: 0.1,
      tail: 0.7,
      dry: 0.3,
      coreWidth: 0.35,
      seed: SEED + 262 + i,
    });
  }
}

/** 恵み（buff）: 頭上に小さな頭光の円を書き、墨の粒が降る */
function holyBless(frame, f) {
  const p = prog(f, 9);
  const pts = [];
  for (let i = 0; i <= 30; i++) {
    const a = Math.PI * 0.9 + TAU * 0.92 * (i / 30);
    pts.push({ x: Math.cos(a) * 11, y: -40 + Math.sin(a) * 4 });
  }
  brushStroke(frame, { pts, width: 2.8, grow: smoothstep(0, 0.45, p), fade: smoothstep(0.6, 1, p), dry: 0.4, tail: 0.5, seed: SEED + 290 });
  splatter(frame, f, 8, SEED + 291, (i, r) => ({ x: (r(1) - 0.5) * 24, y: -36, vx: 0, vy: 2 + 2 * r(2), size: r(3) > 0.5 ? 1.2 : 0.8, born: 2 + r(4) * 4, life: 4, level: 7 }));
}

// ---------------------------------------------------------------------------
// 連鎖電（chain。pos → to）
// ---------------------------------------------------------------------------

const SPARK_STEP_PX = 12;

/** 1 区間の折れ線（両端は y=0 で継ぐ）。コマごとに折れ方が変わってちらつく */
function sparkBeam(frame, f) {
  const p = prog(f, 7);
  const half = SPARK_STEP_PX + 0.6;
  const pts = [{ x: -half, y: 0 }];
  const jag = 6 * (1 - 0.4 * p);
  const n = 3;
  for (let i = 1; i < n; i++) {
    const t = i / n;
    pts.push({ x: -half + 2 * half * t, y: (i % 2 === 0 ? 1 : -1) * jag * (0.4 + hash1(i + f * 5, SEED + 300)) * (f % 2 === 0 ? 1 : -1) });
  }
  pts.push({ x: half, y: 0 });
  brushStroke(frame, { pts, width: 3.2, profile: () => 1, flat: true, dry: 0, fade: smoothstep(0.3, 1, p) * 0.8, pitch: 1.2, breakLen: 14, seed: SEED + 301 });
}

/** 撃ち出し: 手元の小さな墨だまり */
function sparkFrom(frame, f) {
  const p = prog(f, 7);
  if (p < 0.6) inkBlot(frame, { radius: 6 * (1 - p), seed: SEED + 305, coreWidth: 0.5 });
}

/** 当たり: 墨が弾け、短い折れの筆が四方へ */
function sparkHit(frame, f) {
  const p = prog(f, 7);
  if (p < 0.6) inkBlot(frame, { radius: 9 * (1 - 0.6 * p), seed: SEED + 310, coreWidth: 0.45 });
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + 0.6 + hash1(i, SEED + 311) * 0.6;
    const pts = zigzag(Math.cos(a) * 8, Math.sin(a) * 8, Math.cos(a) * 24, Math.sin(a) * 24, 3, 3, SEED + 312 + i);
    brushStroke(frame, { pts, width: 2.4, grow: smoothstep(0, 0.3, p), fade: smoothstep(0.35, 1, p), dry: 0.2, tail: 0.6, seed: SEED + 320 + i });
  }
  burst(frame, f, 8, SEED + 325, { r0: 4, speed: 4, life: 4 });
}

// ---------------------------------------------------------------------------
// 引き寄せ（半径 70px）
// ---------------------------------------------------------------------------

const PULL = { radiusPx: 70, frames: 10 };

function magnet(frame, f) {
  const R = PULL.radiusPx * 2;
  const p = prog(f, PULL.frames);
  // 渦の腕 6 本: 外の端から書き始め、中心へ巻き込む
  const fd = smoothstep(0.55, 0.95, p) * 0.9;
  for (let i = 0; i < 6; i++) {
    const a0 = (i / 6) * TAU;
    const pts = spiralPoints(R * 0.95, R * 0.12, a0, TAU * 0.33, 28);
    brushStroke(frame, { pts, width: 5, grow: smoothstep(0, 0.5, p), fade: fd, dry: 0.55, press: 0.06, tail: 0.5, seed: SEED + 330 + i });
  }
  // 吸い込まれる墨の粒
  converge(frame, p, 22, SEED + 340, { from: R * 0.95, span: 0.55 });
  // 最後に中心へ墨が溜まる
  const c = smoothstep(0.45, 0.7, p);
  if (c > 0.02 && p < 0.95) inkBlot(frame, { radius: 14 * c * (1 - 0.6 * smoothstep(0.75, 0.95, p)), seed: SEED + 345, coreWidth: 0.45 });
}

// ---------------------------------------------------------------------------
// 煙玉（ring 10px。煙は 30px）
// ---------------------------------------------------------------------------

const SMOKE = { ringPx: 10, cloudPx: 30, frames: 11 };

/** 煙: 淡墨の巻き雲が膨らむ（無属性の段 2〜4 で薄い灰） */
function smokeBomb(frame, f) {
  const R = SMOKE.cloudPx * 2;
  const p = prog(f, SMOKE.frames);
  // 墨玉が割れる
  if (p < 0.2) inkBlot(frame, { radius: 7, seed: SEED + 350, coreWidth: 0.3 });
  burst(frame, f, 10, SEED + 351, { r0: 3, speed: 5, life: 3 });
  const g = smoothstep(0.05, 0.5, p);
  const fd = smoothstep(0.6, 1, p) * 0.85;
  // 淡い煙のむら（間引き）
  paint(
    frame,
    (x, y) => {
      const d = Math.hypot(x, y);
      const a = Math.atan2(y, x);
      const edge = R * 0.88 * g * (0.82 + 0.18 * Math.sqrt(Math.abs(Math.sin(a * 3.5))));
      if (d > edge) return -1;
      if (((Math.floor(x) + Math.floor(y)) & 1) === 1) return -1;
      const m = valueNoise(x + f * 2, y - f * 3, 8, SEED + 352);
      if (m > 0.55 - fd * 0.5) return -1;
      return lv(2);
    },
    { bounds: { x0: -R, y0: -R, x1: R, y1: R }, dither: 0 },
  );
  // 巻き雲の輪郭（淡墨の筆）
  cloudOutline(frame, R * 0.92 * g, 7, { width: 3.4, grow: smoothstep(0.05, 0.45, p), fade: fd, core: lv(5), body: lv(4), edge: lv(3), seed: SEED + 364 });
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + 0.6 + 0.4 * hash1(i, SEED + 355);
    const d = R * 0.42 * g;
    const r = R * (0.16 + 0.05 * hash1(i, SEED + 356)) * (0.5 + 0.5 * g);
    curl(frame, Math.cos(a) * d, Math.sin(a) * d * 0.85 - 4 * p, r, a + Math.PI, 1, {
      width: 3,
      grow: smoothstep(0.05 + i * 0.03, 0.45 + i * 0.03, p),
      fade: fd,
      core: lv(4),
      body: lv(3),
      edge: lv(3),
      seed: SEED + 357 + i,
    });
  }
}

/** 跳び退く道（beam の 1 区間）: 引きずる煙の淡い筋 */
function smokeTrail(frame, f) {
  const p = prog(f, 8);
  const half = LEAP_STEP_PX + 0.6;
  for (let k = 0; k < 2; k++) {
    const pts = [];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      pts.push({ x: -half + 2 * half * t, y: (k ? 4 : -4) + Math.sin(t * TAU + k * 2) * 2.5 });
    }
    brushStroke(frame, { pts, width: 3, profile: () => 1, flat: true, dry: 0, fade: 0.3 + 0.65 * smoothstep(0.1, 1, p), pitch: 1, breakLen: 7, core: lv(4), body: lv(3), edge: lv(2), seed: SEED + 370 + k });
  }
}

// ---------------------------------------------------------------------------
// 表
// ---------------------------------------------------------------------------

const FX = {
  skills: {
    commonShockwave: {
      ramp: "steel",
      acts: { ring: { sheet: "skillArtA.shockwave", ground: "skillArtA.shockStomp", life: 0.42, base: SHOCK.radiusPx } },
    },
    commonBackstep: {
      ramp: "steel",
      // pos = 踏み切り、to = 着地。angle は跳んだ向き（照準と逆）
      acts: { dashBack: { sheet: "skillArtA.leapKick", life: 0.36, base: 0, beam: { sheet: "skillArtA.leapTrail", step: LEAP_STEP_PX }, tip: "skillArtA.leapLand" } },
    },
    commonBlink: {
      ramp: "steel",
      acts: { blink: { sheet: "skillArtA.blinkVanish", life: 0.4, base: 0, beam: { sheet: "skillArtA.blinkTrail", step: BLINK_STEP_PX }, tip: "skillArtA.blinkAppear" } },
    },
    commonWarCry: {
      ramp: "steel",
      acts: {
        ring: { sheet: "skillArtA.warShout", life: 0.5, base: SHOUT.radiusPx },
        buff: { sheet: "skillArtA.warRouse", life: 0.5, base: 0 },
      },
    },
    commonFirstAid: {
      ramp: "steel",
      acts: { buff: { sheet: "skillArtA.firstAid", life: 0.7, base: 0 } },
    },
    commonMeditate: {
      ramp: "steel",
      acts: { buff: { sheet: "skillArtA.meditate", ground: "skillArtA.meditateRipple", life: 0.8, base: 0 } },
    },
    commonFireball: {
      ramp: "fire",
      acts: { shot: { sheet: "skillArtA.fireballShot", life: 0.3, base: 0 } },
      fly: { sheet: "skillArtA.fireballFly", base: FIREBALL_PX, period: 0.4 },
    },
    commonIceLance: {
      ramp: "ice",
      acts: { shot: { sheet: "skillArtA.lanceShot", life: 0.3, base: 0 } },
      fly: { sheet: "skillArtA.lanceFly", base: LANCE_PX, period: 0.4 },
    },
    commonThunderclap: {
      ramp: "lightning",
      acts: { ringTarget: { sheet: "skillArtA.thunder", ground: "skillArtA.thunderScorch", life: 0.5, base: THUNDER.radiusPx } },
    },
    commonPoisonMist: {
      ramp: "poison",
      acts: { ringTarget: { sheet: "skillArtA.poisonMist", ground: "skillArtA.poisonMistFloor", life: 0.7, base: MIST.radiusPx } },
    },
    commonShadowBolt: {
      ramp: "dark",
      acts: { shot: { sheet: "skillArtA.shadowShot", life: 0.3, base: 0 } },
      fly: { sheet: "skillArtA.shadowFly", base: SHADOW_PX, period: 0.5 },
    },
    commonHolyNova: {
      ramp: "light",
      acts: {
        ring: { sheet: "skillArtA.holyNova", life: 0.5, base: NOVA.radiusPx },
        buff: { sheet: "skillArtA.holyBless", life: 0.6, base: 0 },
      },
    },
    commonChainSpark: {
      ramp: "lightning",
      // pos = 跳ねた元、to = 当たった敵。1 跳びごとに出来事が出る
      acts: { chain: { sheet: "skillArtA.sparkFrom", life: 0.28, base: 0, beam: { sheet: "skillArtA.sparkBeam", step: SPARK_STEP_PX }, tip: "skillArtA.sparkHit" } },
    },
    commonMagnet: {
      ramp: "dark",
      acts: { pull: { sheet: "skillArtA.magnet", life: 0.5, base: PULL.radiusPx } },
    },
    commonSmokeBomb: {
      ramp: "steel",
      acts: {
        // 当たりの半径は 10px だが煙（地形）は 30px。絵は煙の大きさで描き、base は当たりの半径
        ring: { sheet: "skillArtA.smokeBomb", life: 0.7, base: SMOKE.ringPx },
        dashBack: { sheet: "skillArtA.leapKick", life: 0.36, base: 0, beam: { sheet: "skillArtA.smokeTrail", step: LEAP_STEP_PX }, tip: "skillArtA.leapLand" },
      },
    },
  },
};

/** 円の絵の大きさ（半径 px → シートの辺のドット） */
const ringSize = (px, pad = 30) => Math.ceil(px * 2 + pad) * 2;

export const ATLAS = {
  key: "skillArtA",
  fx: FX,
  sheets: [
    { key: "skillArtA.shockwave", dirs: 1, frames: SHOCK.frames, active: 0, size: ringSize(SHOCK.radiusPx, 40), draw: shockwave },
    { key: "skillArtA.shockStomp", dirs: 1, frames: SHOCK.frames, active: 0, size: 112, draw: shockStomp },
    { key: "skillArtA.leapKick", dirs: DIRS, frames: 6, active: 0, size: 80, draw: leapKick },
    { key: "skillArtA.leapTrail", dirs: 1, frames: 7, active: 0, size: 48, ink: false, draw: leapTrail },
    { key: "skillArtA.leapLand", dirs: DIRS, frames: 7, active: 0, size: 96, draw: leapLand },
    { key: "skillArtA.blinkVanish", dirs: DIRS, frames: 8, active: 0, size: 112, draw: blinkVanish },
    { key: "skillArtA.blinkTrail", dirs: 1, frames: 8, active: 0, size: 48, ink: false, draw: blinkTrail },
    { key: "skillArtA.blinkAppear", dirs: DIRS, frames: 8, active: 0, size: 112, draw: blinkAppear },
    { key: "skillArtA.warShout", dirs: 1, frames: SHOUT.frames, active: 0, size: ringSize(SHOUT.radiusPx), draw: warShout },
    { key: "skillArtA.warRouse", dirs: 1, frames: 9, active: 0, size: 112, draw: warRouse },
    { key: "skillArtA.firstAid", dirs: 1, frames: 10, active: 0, size: 112, draw: firstAid },
    { key: "skillArtA.meditate", dirs: 1, frames: 12, active: 0, size: 96, draw: meditate },
    { key: "skillArtA.meditateRipple", dirs: 1, frames: 12, active: 0, size: 112, draw: meditateRipple },
    { key: "skillArtA.fireballFly", dirs: DIRS, frames: 8, active: 0, size: 96, draw: fireballFly },
    { key: "skillArtA.fireballShot", dirs: DIRS, frames: 7, active: 0, size: 80, draw: fireballShot },
    { key: "skillArtA.lanceFly", dirs: DIRS, frames: 8, active: 0, size: 160, draw: lanceFly },
    { key: "skillArtA.lanceShot", dirs: DIRS, frames: 7, active: 0, size: 80, draw: lanceShot },
    { key: "skillArtA.thunder", dirs: 1, frames: THUNDER.frames, active: 0, size: 340, draw: thunder },
    { key: "skillArtA.thunderScorch", dirs: 1, frames: THUNDER.frames, active: 0, size: ringSize(THUNDER.radiusPx), draw: thunderScorch },
    { key: "skillArtA.poisonMist", dirs: 1, frames: MIST.frames, active: 0, size: ringSize(MIST.radiusPx, 40), draw: poisonMist },
    { key: "skillArtA.poisonMistFloor", dirs: 1, frames: MIST.frames, active: 0, size: ringSize(MIST.radiusPx), draw: poisonMistFloor },
    { key: "skillArtA.shadowFly", dirs: DIRS, frames: 8, active: 0, size: 128, draw: shadowFly },
    { key: "skillArtA.shadowShot", dirs: DIRS, frames: 7, active: 0, size: 80, draw: shadowShot },
    { key: "skillArtA.holyNova", dirs: 1, frames: NOVA.frames, active: 0, size: ringSize(NOVA.radiusPx), draw: holyNova },
    { key: "skillArtA.holyBless", dirs: 1, frames: 9, active: 0, size: 112, draw: holyBless },
    { key: "skillArtA.sparkFrom", dirs: 1, frames: 7, active: 0, size: 32, draw: sparkFrom },
    { key: "skillArtA.sparkBeam", dirs: 1, frames: 7, active: 0, size: 48, ink: false, draw: sparkBeam },
    { key: "skillArtA.sparkHit", dirs: 1, frames: 7, active: 0, size: 72, draw: sparkHit },
    { key: "skillArtA.magnet", dirs: 1, frames: PULL.frames, active: 0, size: ringSize(PULL.radiusPx), draw: magnet },
    { key: "skillArtA.smokeBomb", dirs: 1, frames: SMOKE.frames, active: 0, size: ringSize(SMOKE.cloudPx), draw: smokeBomb },
    { key: "skillArtA.smokeTrail", dirs: 1, frames: 8, active: 0, size: 48, ink: false, draw: smokeTrail },
  ],
};
