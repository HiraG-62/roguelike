// スキル石: 変身 5 種の墨のエフェクト（docs/ideas/fx-sprites.md 10 章）。単位は絵のドット（論理 0.5px）。正準の向きは +x
// 纏い（aura）は自分の中心に向きなしで描く。体（半径 5px = 10 ドット）を覆わないよう、絵は体の外側に置く。
// 光・閃き・火花の星は使わず、筆の一筆・円相・墨の飛沫・墨だまり・滲み・飛白で描く
//
// 狼化（wolfForm）: 「狼になる。攻撃 1 が噛みつき突進（出血）、攻撃 2 が遠吠え（恐怖）」
// - 変身（cast）: 3 本爪の爪痕の筆が交差して 2 度走り、墨が跳ねる
// - 纏い: 体の周りに逆立つたてがみ（外向きの短い払い）がさざめく
// - 噛みつき（acts.bite）: 前で上下の牙の筆が噛み合い、噛んだ所で墨が弾ける
// - 遠吠え（act）: ぎざぎざに震える声の輪（閉じない筆の輪）が 3 重に広がる（半径 56px）
// - 解除: 毛の払いが抜けて舞い落ちる
// 霊体化（wraithForm）: 「敵と敵弾をすり抜ける。解けたとき、すり抜けた敵すべてに出血」。闇
// - 変身: 体の輪郭が墨の煙の筆になって揺れながら立ち昇り、ほどける
// - 纏い: 掠れた煙の尾が体の周りを螺旋に巡って昇る
// - 解除: 煙の筆が外から体へ吸い込まれ、墨だまりになって実体に戻る
// 砲身化（siegeForm）: 「その場で構えて砲撃する。構え中は動けない」
// - 構え（cast）: 四隅に杭の太い縦の一筆が打ち込まれ、床に八角の台座の筆（地面）。打ち込みの墨が跳ねる（空中）
// - 纏い: 足元の八角の台座と四隅の杭（地面）、後ろから細い墨の煙（空中）
// - 砲撃（act）: 砲口で墨が弾けて前へ扇の飛沫、小さな円相の煙の輪、後ろへ反動の擦れ（向きあり）
// - 砲弾（fly）: 墨玉と、後ろへ引く筆の尾
// - 解除: 杭が抜けて上へ払われ、墨が散る
// 鉄塊化（ironForm）: 「鉄の塊になる。被弾しても怯まず振りも止まらない」
// - 変身: 外から太く短い筆の鉄板 6 枚が体へ集まって閉じ、閉じた瞬間に墨が散る
// - 纏い: 太い筆の鉄板の殻（鋲の点つき）が体の周りをゆっくり回る（隙間から体が見える）
// - 重い振り（acts.swing）: 前の半円をなぞる極太の一筆と、振り下ろした先で床を打つ墨の飛沫
// - 解除: 鉄板が外へ剥がれて落ちる
// 業火の化身（pyreForm）: 「近接と射撃が燃焼を付ける。気力が尽きると自分が燃えて解ける」。炎
// - 変身: 足元から炎の舌の筆が揺れながら噴き上がり（空中）、床に火の円相が広がる（地面）
// - 纏い: 体の縁から炎の舌の筆が立ち昇り、墨の粒が昇る。足元に熾火の墨点の輪
// - 解除: 炎の筆が細って煙の筆に変わり昇って消える
import { arcPoints, brushStroke, enso, inkBlot, lv, splatter } from "../brush.mjs";
import { dot, hash1, smoothstep } from "../raster.mjs";
import { DIRS } from "../motifs.mjs";

const TAU = Math.PI * 2;
/** 体の半径（ドット）。PLAYER.radius 5px */
const BODY = 10;
const SEED = 8101;
/** 床に寝た形の縦の潰れ */
const FLOOR_SQ = 0.55;
/** 纏い・解除の作業面の一辺（ドット） */
const AURA_SIZE = 80;

function sheetSize(radiusDots, pad) {
  return Math.ceil(radiusDots + pad) * 2;
}

/** コマの進み（0..1。コマの真ん中） */
function prog(f, frames) {
  return (f + 0.5) / frames;
}

/** 揺れながら立ち昇る線（炎の舌・煙）。根元 (x, y) から高さ h、揺れ幅 amp、位相 ph */
function risePts(x, y, h, amp, ph, steps = 12) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    pts.push({ x: x + Math.sin(ph + t * 4.2) * amp * t, y: y - h * t });
  }
  return pts;
}

/** 正多角形の折れ線（床に寝た八角の台座など） */
function polygonPts(n, r, sq, a0 = 0) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + (i / n) * TAU;
    pts.push({ x: Math.cos(a) * r, y: Math.sin(a) * r * sq });
  }
  return pts;
}

// ---------------------------------------------------------------------------
// 狼化
// ---------------------------------------------------------------------------

const WOLF = {
  /** 遠吠えの半径（px）。SKILL.wolfForm.howlRadius */
  howlPx: 56,
  /** 噛みつきの届き（px）。WOLF_BITE_STEP.reach */
  bitePx: 24,
  seed: SEED + 400,
};
const HOWL_R = WOLF.howlPx * 2;

/** 3 本爪の爪痕: 中心 (cx, cy)・向き a・長さ len。grow で走り、fade で掠れる */
function clawMarks(frame, cx, cy, a, len, grow, fade, seed) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  for (let k = -1; k <= 1; k++) {
    const off = k * 10;
    const l = len * (k === 0 ? 1 : 0.85);
    const pts = [];
    for (let i = 0; i <= 10; i++) {
      const t = i / 10 - 0.5;
      // 少し弓なりに曲がる爪の筋
      const bow = (1 - 4 * t * t) * 3;
      const u = t * l;
      const v = off + bow;
      pts.push({ x: cx + u * c - v * s, y: cy + u * s + v * c });
    }
    brushStroke(frame, { pts, width: 3.2, grow, fade, dry: 0.5, press: 0.1, tail: 0.6, seed: seed + k });
  }
}

/** 変身（cast）: 爪痕が交差して 2 度走り（右上から、左上から）、墨が跳ねる */
function wolfCast(frame, f) {
  const p = prog(f, 9);
  const fade = smoothstep(0.6, 1, p) * 0.9;
  clawMarks(frame, 0, 0, Math.PI * 0.3, 60, smoothstep(0, 0.3, p), fade, WOLF.seed);
  clawMarks(frame, 0, 0, Math.PI * 0.7, 60, smoothstep(0.25, 0.55, p), fade, WOLF.seed + 10);
  splatter(frame, f, 14, WOLF.seed + 20, (i, r) => {
    const a = r(1) * TAU;
    return { x: Math.cos(a) * 12, y: Math.sin(a) * 12, vx: Math.cos(a) * (3 + 4 * r(2)), vy: Math.sin(a) * (3 + 4 * r(2)), size: r(3) > 0.5 ? 1.5 : 0.9, born: 1 + r(4) * 3, life: 5, level: 6 };
  });
}

const WOLF_AURA_FRAMES = 8;

/** 纏い: 逆立つたてがみ。体の縁から外へ短い払いの毛の房が並び、波のように伸び縮みする */
function wolfAura(frame, f) {
  const n = 14;
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + ((i / (n - 1)) - 0.5) * Math.PI * 1.5;
    const wave = 0.5 + 0.5 * Math.sin((f / WOLF_AURA_FRAMES) * TAU + i * 0.9);
    const r0 = BODY + 3;
    const len = 5 + 6 * wave * (0.6 + 0.4 * hash1(i, WOLF.seed + 30));
    const bend = 0.35;
    brushStroke(frame, {
      pts: [
        { x: Math.cos(a) * r0, y: Math.sin(a) * r0 },
        { x: Math.cos(a + bend * 0.5) * (r0 + len * 0.6), y: Math.sin(a + bend * 0.5) * (r0 + len * 0.6) },
        { x: Math.cos(a + bend) * (r0 + len), y: Math.sin(a + bend) * (r0 + len) },
      ],
      width: 2.4,
      press: 0.1,
      tail: 0.7,
      dry: 0.3,
      seed: WOLF.seed + 40 + i,
    });
  }
}

/** 噛みつき（acts.bite）: 前で上下の牙の筆が噛み合い、牙の歯の短い払い、噛んだ所で墨が弾ける */
function wolfBite(frame, f) {
  const frames = 7;
  const p = prog(f, frames);
  const close = smoothstep(0, 0.4, p);
  const fade = smoothstep(0.55, 1, p) * 0.9;
  const tipX = WOLF.bitePx * 2 + 6;
  const open = 14 * (1 - close) + 6;
  for (const sgn of [-1, 1]) {
    const pts = [];
    for (let i = 0; i <= 12; i++) {
      const t = i / 12;
      pts.push({ x: 14 + (tipX - 14) * t, y: sgn * (open * Math.sin(t * Math.PI * 0.85) + 4 * (1 - t)) });
    }
    brushStroke(frame, { pts, width: 5, fade, dry: 0.35, press: 0.15, tail: 0.5, seed: WOLF.seed + 50 + sgn });
    // 牙: 顎の線から内側へ尖る短い払い
    for (let k = 0; k < 3; k++) {
      const t = 0.45 + k * 0.17;
      const x = 14 + (tipX - 14) * t;
      const y = sgn * (open * Math.sin(t * Math.PI * 0.85) + 4 * (1 - t));
      const L = k === 1 ? 6 : 4;
      brushStroke(frame, { pts: [{ x, y }, { x: x + 1, y: y - sgn * L }], width: 2.6, fade, press: 0.05, tail: 0.8, dry: 0, seed: WOLF.seed + 60 + k + sgn * 5 });
    }
  }
  if (close > 0.8 && p < 0.7) inkBlot(frame, { x: tipX - 4, y: 0, radius: 4.5, seed: WOLF.seed + 70, coreWidth: 0.45 });
  splatter(frame, f, 12, WOLF.seed + 71, (i, r) => ({ x: tipX - 4, y: 0, vx: 2 + 4 * r(1), vy: (r(2) - 0.5) * 9, size: r(3) > 0.5 ? 1.6 : 0.9, born: 2, life: 5, level: r(4) > 0.5 ? 7 : 5 }));
}

/** 遠吠え（act）: ぎざぎざに震える声の輪が 3 重に広がる（閉じない筆の輪。外ほど細く掠れる） */
function wolfHowl(frame, f) {
  const frames = 10;
  const p = prog(f, frames);
  for (let k = 0; k < 3; k++) {
    const q = smoothstep(k * 0.15, 0.6 + k * 0.15, p);
    if (q <= 0.01 || q >= 0.99) continue;
    const r = HOWL_R * q;
    const pts = [];
    const n = 48;
    const a0 = -Math.PI / 2 + 0.4 + k * 0.7;
    for (let i = 0; i <= n; i++) {
      const a = a0 + (i / n) * TAU * 0.86;
      // 声の震え: 山と谷が交互に来るぎざぎざ
      const jag = (i % 2 === 0 ? 1 : -1) * (2 + 2 * (1 - q));
      pts.push({ x: Math.cos(a) * (r + jag), y: Math.sin(a) * (r + jag) });
    }
    brushStroke(frame, { pts, width: 4.5 * (1 - 0.6 * q) + 1, fade: smoothstep(0.6, 1, q) * 0.9, dry: 0.5, tail: 0.4, seed: WOLF.seed + 80 + k });
  }
}

/** 解除: たてがみの毛の払いが抜けて、左右に揺れながら舞い落ちる */
function wolfEnd(frame, f) {
  const frames = 7;
  const p = prog(f, frames);
  for (let i = 0; i < 10; i++) {
    const r = (k) => hash1(i * 7 + k, WOLF.seed + 90);
    const a = -Math.PI / 2 + (r(1) - 0.5) * Math.PI * 1.4;
    const x = Math.cos(a) * (BODY + 6) + (r(2) - 0.5) * 6 + Math.sin(p * 6 + i) * 3;
    const y = Math.sin(a) * (BODY + 6) + p * 22;
    const tilt = (r(3) - 0.5) * 1.6 + Math.sin(p * 5 + i) * 0.5;
    brushStroke(frame, {
      pts: [{ x, y }, { x: x + Math.cos(tilt) * 6, y: y + Math.sin(tilt) * 6 }],
      width: 2.2,
      fade: smoothstep(0.4, 1, p),
      press: 0.1,
      tail: 0.7,
      dry: 0.2,
      seed: WOLF.seed + 100 + i,
    });
  }
}

// ---------------------------------------------------------------------------
// 霊体化
// ---------------------------------------------------------------------------

const WRAITH = { seed: SEED + 500 };

/** 変身（cast）: 体の輪郭の円相が書かれ、ほどけて墨の煙の筆になり揺れながら立ち昇る */
function wraithCast(frame, f) {
  const frames = 10;
  const p = prog(f, frames);
  if (p < 0.45) enso(frame, { radius: BODY + 4, width: 4, grow: smoothstep(0, 0.25, p), fade: smoothstep(0.2, 0.45, p), seed: WRAITH.seed });
  const rise = smoothstep(0.15, 1, p);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + 0.3;
    const x = Math.cos(a) * (BODY + 3);
    const y = Math.sin(a) * (BODY + 3) * 0.7 - rise * 18;
    brushStroke(frame, {
      pts: risePts(x, y, 14 + 18 * rise, 5, i * 1.3 + p * 3),
      width: 3.4,
      grow: smoothstep(0.15, 0.55, p),
      fade: smoothstep(0.5, 1, p) * 0.95,
      dry: 0.6,
      press: 0.2,
      tail: 0.7,
      seed: WRAITH.seed + 10 + i,
    });
  }
}

const WRAITH_AURA_FRAMES = 12;

/** 纏い: 掠れた煙の尾 3 本が体の周りを螺旋に巡りながら昇る */
function wraithAura(frame, f) {
  const t0 = f / WRAITH_AURA_FRAMES;
  // 体の縁を巡る根元から、煙の尾が揺れて昇る（体の前を横切らないよう、尾は縁の外で上へ伸びる）
  for (let k = 0; k < 4; k++) {
    const a = (t0 + k / 4) * TAU;
    const x = Math.cos(a) * (BODY + 5);
    const y = 6 + Math.sin(a) * 4;
    const sway = Math.cos(a) >= 0 ? 4 : -4;
    brushStroke(frame, { pts: risePts(x, y, 20, sway, a * 2, 12), width: 2.8, dry: 0.7, press: 0.3, tail: 0.75, pitch: 1.3, breakLen: 8, seed: WRAITH.seed + 30 + k });
  }
  // 昇る墨の粒
  for (let i = 0; i < 5; i++) {
    const ph = (t0 + hash1(i, WRAITH.seed + 40)) % 1;
    const x = (hash1(i, WRAITH.seed + 41) - 0.5) * BODY * 3;
    dot(frame, x + Math.sin(ph * 6 + i) * 2, 6 - ph * 32, ph < 0.5 ? 7 : 5);
  }
}

/** 解除: 外の煙の筆が体へ吸い込まれ、墨だまりになって実体に戻る */
function wraithEnd(frame, f) {
  const frames = 8;
  const p = prog(f, frames);
  const inward = smoothstep(0, 0.6, p);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU + 0.2;
    const r0 = 42 * (1 - inward) + BODY;
    const r1 = r0 + 14 * (1 - inward) + 4;
    brushStroke(frame, {
      pts: arcPoints(0, 0, r1, a, -0.6, 8).map((q, j, all) => {
        const t = j / (all.length - 1);
        const rr = r1 + (r0 - r1) * t;
        const aa = a - 0.6 * t;
        return { x: Math.cos(aa) * rr, y: Math.sin(aa) * rr };
      }),
      width: 3,
      fade: smoothstep(0.5, 0.85, p),
      dry: 0.6,
      press: 0.1,
      tail: 0.5,
      seed: WRAITH.seed + 50 + i,
    });
  }
  if (p > 0.5) inkBlot(frame, { radius: BODY * (0.4 + 0.8 * smoothstep(0.5, 0.8, p)) * (1 - smoothstep(0.85, 1, p)) + 1, seed: WRAITH.seed + 60, coreWidth: 0.4 });
  if (p > 0.55) {
    splatter(frame, f, 10, WRAITH.seed + 61, (i, r) => {
      const a = r(1) * TAU;
      return { x: Math.cos(a) * BODY, y: Math.sin(a) * BODY, vx: Math.cos(a) * (2 + 3 * r(2)), vy: Math.sin(a) * (2 + 3 * r(2)), size: 1, born: 4, life: 4, level: 6 };
    });
  }
}

// ---------------------------------------------------------------------------
// 砲身化
// ---------------------------------------------------------------------------

const SIEGE = {
  /** 台座の半径（ドット） */
  baseR: 18,
  /** 杭の位置（台座の四隅の半径。ドット） */
  stakeR: 22,
  seed: SEED + 600,
};

/** 杭の 1 本（床に刺さった太い縦の一筆）。drive（0..1）で上から打ち込まれる、lift で抜けて上がる */
function stake(frame, x, y, drive, lift, fade, seed) {
  const top = y - 12 + 8 * (1 - drive) - lift;
  const bottom = y + 2 - lift;
  brushStroke(frame, { pts: [{ x, y: top }, { x, y: bottom }], width: 3.4, press: 0.25, tail: 0.35, sharp: 0.95, fade, dry: 0.2, seed });
}

/** 四隅の位置（床の上で斜めの 4 点） */
function stakeSpots() {
  return [0, 1, 2, 3].map((i) => {
    const a = Math.PI / 4 + (i / 4) * TAU;
    return { x: Math.cos(a) * SIEGE.stakeR, y: 6 + Math.sin(a) * SIEGE.stakeR * FLOOR_SQ };
  });
}

/** 八角の台座（床に寝た八角の一筆） */
function octBase(frame, grow, fade) {
  const pts = polygonPts(8, SIEGE.baseR, FLOOR_SQ, Math.PI / 8).map((q) => ({ x: q.x, y: q.y + 6 }));
  brushStroke(frame, { pts, width: 3, grow, fade, press: 0.1, tail: 0.3, dry: 0.35, seed: SIEGE.seed });
}

/** 構え（cast の地面）: 八角の台座が書かれ、四隅に杭が打ち込まれる（下に短い割れ目の払い） */
function siegeCastGround(frame, f) {
  const frames = 8;
  const p = prog(f, frames);
  octBase(frame, smoothstep(0, 0.5, p), 0);
  stakeSpots().forEach((s, i) => {
    const drive = smoothstep(0.2 + i * 0.1, 0.45 + i * 0.1, p);
    if (drive <= 0) return;
    stake(frame, s.x, s.y, drive, 0, 0, SIEGE.seed + 10 + i);
    if (drive > 0.9) {
      const a = Math.atan2(s.y - 6, s.x);
      brushStroke(frame, { pts: [{ x: s.x, y: s.y + 2 }, { x: s.x + Math.cos(a) * 8, y: s.y + 2 + Math.sin(a) * 4 }], width: 1.8, press: 0.05, tail: 0.8, dry: 0.3, seed: SIEGE.seed + 20 + i });
    }
  });
}

/** 構え（cast の空中）: 杭を打ち込んだ所から墨が上へ跳ねる */
function siegeCast(frame, f) {
  stakeSpots().forEach((s, i) => {
    splatter(frame, f, 5, SIEGE.seed + 30 + i, (j, r) => ({ x: s.x, y: s.y - 4, vx: (r(1) - 0.5) * 5, vy: -(2 + 3 * r(2)), size: r(3) > 0.5 ? 1.2 : 0.8, born: 2 + i * 0.8, life: 4, level: 5 }));
  });
}

/** 纏い（地面）: 足元の八角の台座と四隅の杭 */
function siegeAuraGround(frame) {
  octBase(frame, 1, 0);
  stakeSpots().forEach((s, i) => stake(frame, s.x, s.y, 1, 0, 0, SIEGE.seed + 10 + i));
}

const SIEGE_AURA_FRAMES = 8;

/** 纏い（空中）: 背から細い墨の煙の筆が 2 本、揺れて昇る */
function siegeAura(frame, f) {
  const t0 = f / SIEGE_AURA_FRAMES;
  for (let k = 0; k < 2; k++) {
    const x = (k === 0 ? -1 : 1) * 6;
    brushStroke(frame, { pts: risePts(x, -BODY, 18, 4, t0 * TAU + k * 2), width: 2.4, dry: 0.65, press: 0.2, tail: 0.7, pitch: 1.2, breakLen: 6, seed: SIEGE.seed + 40 + k });
  }
}

/** 砲撃（act。向きあり）: 砲口で墨が弾けて前へ扇の飛沫、円相の煙の輪、後ろへ反動の擦れ */
function siegeMuzzle(frame, f) {
  const frames = 7;
  const p = prog(f, frames);
  const mx = BODY + 6;
  if (p < 0.45) inkBlot(frame, { x: mx + 4, y: 0, radius: 7 + 5 * p, seed: SIEGE.seed + 50 + f, coreWidth: 0.5 });
  enso(frame, { ox: mx + 14 + 10 * p, radius: 6 + 10 * smoothstep(0, 0.6, p), width: 3, grow: smoothstep(0, 0.4, p), fade: smoothstep(0.4, 1, p), seed: SIEGE.seed + 51 });
  splatter(frame, f, 14, SIEGE.seed + 52, (i, r) => ({ x: mx + 4, y: 0, vx: 5 + 6 * r(1), vy: (r(2) - 0.5) * 8, size: r(3) > 0.5 ? 1.6 : 0.9, life: 5, level: r(4) > 0.5 ? 7 : 5 }));
  // 反動: 後ろへ乾いた筆の擦れ
  for (let k = -1; k <= 1; k += 2) {
    brushStroke(frame, { pts: [{ x: -BODY, y: k * 5 }, { x: -BODY - 18, y: k * 7 }], width: 3, grow: smoothstep(0, 0.35, p), fade: smoothstep(0.3, 1, p), dry: 0.75, tail: 0.7, seed: SIEGE.seed + 53 + k });
  }
}

/** 砲弾（fly）: 墨玉と、後ろへ引く筆の尾（尾の毛筋がコマで揺れる） */
function siegeShell(frame, f) {
  brushStroke(frame, { pts: [{ x: 0, y: 0 }, { x: -22, y: (f % 2 === 0 ? 1 : -1) * 0.8 }], width: 6, press: 0.05, tail: 0.85, dry: 0.6, pitch: 1.2, breakLen: 8, seed: SIEGE.seed + 60 + f });
  inkBlot(frame, { radius: 5, seed: SIEGE.seed + 61, coreWidth: 0.4 });
}

/** 解除: 杭が抜けて上へ払われ、台座の筆が掠れ、墨が散る */
function siegeEnd(frame, f) {
  const frames = 7;
  const p = prog(f, frames);
  octBase(frame, 1, smoothstep(0, 0.6, p));
  stakeSpots().forEach((s, i) => {
    stake(frame, s.x, s.y, 1, 16 * smoothstep(0, 0.6, p), smoothstep(0.4, 1, p), SIEGE.seed + 10 + i);
    splatter(frame, f, 4, SIEGE.seed + 70 + i, (j, r) => ({ x: s.x, y: s.y, vx: (r(1) - 0.5) * 6, vy: -(1 + 3 * r(2)), size: 0.9, life: 4, level: 5 }));
  });
}

// ---------------------------------------------------------------------------
// 鉄塊化
// ---------------------------------------------------------------------------

const IRON = {
  /** 殻の半径（ドット） */
  shellR: BODY + 7,
  plates: 6,
  /** 重い振りの届き（px）。IRON_SWING_STEP.reach */
  swingPx: 32,
  seed: SEED + 700,
};

/** 鉄板 1 枚（殻の弧に沿う太く短い一筆と、鋲の墨点）。中心角 a・半径 r */
function plate(frame, a, r, fade, seed) {
  const span = (TAU / IRON.plates) * 0.68;
  brushStroke(frame, { pts: arcPoints(0, 0, r, a - span / 2, span, 10), width: 6, press: 0.2, tail: 0.25, sharp: 0.6, fade, dry: 0.3, seed });
  // 鋲: 板の両端の少し外に小さな墨点
  for (const s of [-0.3, 0.3]) {
    const aa = a + span * s;
    dot(frame, Math.cos(aa) * (r + 4.5), Math.sin(aa) * (r + 4.5), 6);
  }
}

/** 変身（cast）: 外から鉄板 6 枚が体へ集まって閉じ、閉じた瞬間に墨が散る */
function ironCast(frame, f) {
  const frames = 9;
  const p = prog(f, frames);
  const close = smoothstep(0, 0.55, p);
  const r = IRON.shellR + 30 * (1 - close);
  for (let i = 0; i < IRON.plates; i++) plate(frame, (i / IRON.plates) * TAU + (1 - close) * 0.6, r, smoothstep(0.75, 1, p) * 0.5, IRON.seed + i);
  splatter(frame, f, 18, IRON.seed + 10, (i, rr) => {
    const a = rr(1) * TAU;
    return { x: Math.cos(a) * (IRON.shellR + 3), y: Math.sin(a) * (IRON.shellR + 3), vx: Math.cos(a) * (3 + 5 * rr(2)), vy: Math.sin(a) * (3 + 5 * rr(2)), size: rr(3) > 0.5 ? 1.5 : 0.9, born: 4.5, life: 4, level: 6 };
  });
}

const IRON_AURA_FRAMES = 8;

/** 纏い: 鉄板 6 枚の殻が体の周りをゆっくり回る（板の隙間から体が見える） */
function ironAura(frame, f) {
  const turn = (f / IRON_AURA_FRAMES) * (TAU / IRON.plates);
  for (let i = 0; i < IRON.plates; i++) plate(frame, (i / IRON.plates) * TAU + turn, IRON.shellR, 0, IRON.seed + i);
}

/** 重い振り（acts.swing。向きあり）: 前の半円をなぞる極太の一筆と、振り下ろした先で床を打つ墨の飛沫 */
function ironSwing(frame, f) {
  const frames = 9;
  const p = prog(f, frames);
  const R = IRON.swingPx * 2 * 0.9;
  brushStroke(frame, {
    pts: arcPoints(0, 0, R, -Math.PI / 2, Math.PI, 36),
    width: 14,
    grow: smoothstep(0, 0.45, p),
    fade: smoothstep(0.55, 1, p) * 0.9,
    dry: 0.55,
    press: 0.15,
    tail: 0.4,
    swell: 0.3,
    seed: IRON.seed + 20,
  });
  // 打ち付けた所（払いの先）で墨が弾ける
  const end = { x: 0, y: R };
  if (p > 0.4 && p < 0.75) inkBlot(frame, { x: end.x + 4, y: end.y, radius: 7, seed: IRON.seed + 21, coreWidth: 0.4 });
  splatter(frame, f, 16, IRON.seed + 22, (i, r) => {
    const a = r(1) * TAU;
    return { x: end.x + 4, y: end.y, vx: Math.cos(a) * (3 + 5 * r(2)) + 2, vy: Math.sin(a) * (3 + 5 * r(2)), size: r(3) > 0.5 ? 1.8 : 1, born: 3.5, life: 5, level: r(4) > 0.5 ? 7 : 5 };
  });
}

/** 解除: 鉄板が外へ剥がれ、回りながら落ちて掠れる */
function ironEnd(frame, f) {
  const frames = 8;
  const p = prog(f, frames);
  const out = smoothstep(0, 0.7, p);
  for (let i = 0; i < IRON.plates; i++) {
    const a = (i / IRON.plates) * TAU;
    const r = IRON.shellR + 14 * out;
    const fall = 18 * p * p;
    const span = (TAU / IRON.plates) * 0.68;
    const pts = arcPoints(0, 0, r, a - span / 2 + out * 0.5, span, 10).map((q) => ({ x: q.x, y: q.y + fall }));
    brushStroke(frame, { pts, width: 6 * (1 - 0.4 * p), press: 0.2, tail: 0.25, sharp: 0.6, fade: smoothstep(0.35, 1, p), dry: 0.4, seed: IRON.seed + 30 + i });
  }
}

// ---------------------------------------------------------------------------
// 業火の化身
// ---------------------------------------------------------------------------

const PYRE = {
  /** 床の火の円相の半径（ドット） */
  ringR: 36,
  seed: SEED + 800,
};

/** 炎の舌 1 本（根元 (x, y)・高さ h。芯の筋が差し色） */
function flameTongue(frame, x, y, h, w, ph, grow, fade, seed) {
  brushStroke(frame, { pts: risePts(x, y, h, w * 1.4, ph, 14), width: w, grow, fade, press: 0.3, tail: 0.6, swell: 0.3, dry: 0.2, coreWidth: 0.4, seed });
}

/** 変身（cast の空中）: 足元から炎の舌の筆が揺れながら噴き上がり、墨の粒が昇る */
function pyreCast(frame, f) {
  const frames = 10;
  const p = prog(f, frames);
  const grow = smoothstep(0, 0.4, p);
  const fade = smoothstep(0.55, 1, p) * 0.95;
  for (let i = 0; i < 7; i++) {
    const x = (i - 3) * 8;
    const h = 56 + 26 * hash1(i, PYRE.seed) - Math.abs(i - 3) * 9;
    flameTongue(frame, x, 10, h, 4.6 - Math.abs(i - 3) * 0.5, i * 1.7 + p * 4, grow, fade, PYRE.seed + 10 + i);
  }
  splatter(frame, f, 14, PYRE.seed + 20, (i, r) => ({ x: (r(1) - 0.5) * 24, y: -20, vx: (r(2) - 0.5) * 3, vy: -(3 + 5 * r(3)), size: r(4) > 0.5 ? 1.2 : 0.8, born: 1 + r(5) * 4, life: 5, level: 7 }));
}

/** 変身（cast の地面）: 床に火の円相（床に寝た楕円）が広がり、内側に間引いた熾火のむら */
function pyreCastGround(frame, f) {
  const frames = 10;
  const p = prog(f, frames);
  const reach = smoothstep(0, 0.5, p);
  const fade = smoothstep(0.6, 1, p) * 0.9;
  const R = PYRE.ringR * (0.3 + 0.7 * reach);
  const pts = arcPoints(0, 0, R, -Math.PI * 0.7, TAU * 0.92, 48).map((q) => ({ x: q.x, y: 8 + q.y * FLOOR_SQ }));
  brushStroke(frame, { pts, width: 4, grow: reach, fade, dry: 0.5, tail: 0.45, coreWidth: 0.4, seed: PYRE.seed + 30 });
  for (let i = 0; i < 10; i++) {
    const a = hash1(i, PYRE.seed + 31) * TAU;
    const rr = R * 0.8 * Math.sqrt(hash1(i, PYRE.seed + 32));
    if (hash1(i + f * 13, PYRE.seed + 33) < fade) continue;
    dot(frame, Math.cos(a) * rr, 8 + Math.sin(a) * rr * FLOOR_SQ, 7);
  }
}

const PYRE_AURA_FRAMES = 8;

/** 纏い（空中）: 体の縁から炎の舌の筆がちらちら立ち昇り、墨の粒（芯が差し色）が昇る */
function pyreAura(frame, f) {
  const t0 = f / PYRE_AURA_FRAMES;
  for (let i = 0; i < 5; i++) {
    const a = Math.PI + (i / 4) * Math.PI;
    const x = Math.cos(a) * (BODY + 2);
    const y = Math.sin(a) * (BODY + 2) * 0.6 + 4;
    const flick = 0.6 + 0.4 * Math.sin(t0 * TAU * 2 + i * 1.9);
    flameTongue(frame, x, y, (14 + 8 * hash1(i, PYRE.seed + 40)) * flick, 2.8, t0 * TAU + i, 1, 0, PYRE.seed + 41 + i);
  }
  for (let i = 0; i < 5; i++) {
    const ph = (t0 + hash1(i, PYRE.seed + 50)) % 1;
    const x = (hash1(i, PYRE.seed + 51) - 0.5) * BODY * 2.4 + Math.sin(ph * 7 + i) * 2;
    const y = -BODY - ph * 22;
    dot(frame, x, y, 7);
    dot(frame, x, y + 1, 5);
  }
}

/** 纏い（地面）: 足元に熾火の墨点の輪（ゆっくり明滅して巡る） */
function pyreAuraGround(frame, f) {
  const n = 8;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + (f / PYRE_AURA_FRAMES) * (TAU / n);
    const hot = (i + f) % 3 === 0;
    inkBlot(frame, { x: Math.cos(a) * 13, y: 8 + Math.sin(a) * 13 * FLOOR_SQ, radius: hot ? 1.8 : 1.2, seed: PYRE.seed + 60 + i, core: lv(hot ? 7 : 5), coreWidth: 0.6 });
  }
}

/** 解除: 炎の舌が細って煙の筆に変わり、揺れて昇って消える */
function pyreEnd(frame, f) {
  const frames = 8;
  const p = prog(f, frames);
  for (let i = 0; i < 4; i++) {
    const x = (i - 1.5) * 9;
    brushStroke(frame, {
      pts: risePts(x, 4 - p * 14, 16 + 10 * p, 5, i * 1.5 + p * 3),
      width: 2.8 * (1 - 0.4 * p),
      fade: smoothstep(0.2, 1, p),
      dry: 0.4 + 0.4 * p,
      press: 0.2,
      tail: 0.7,
      core: lv(p < 0.3 ? 7 : 5),
      seed: PYRE.seed + 70 + i,
    });
  }
  splatter(frame, f, 8, PYRE.seed + 80, (i, r) => ({ x: (r(1) - 0.5) * 20, y: -6, vx: (r(2) - 0.5) * 2, vy: -(2 + 3 * r(3)), size: 0.9, life: 5, level: 7 }));
}

// ---------------------------------------------------------------------------

/**
 * スキル → 絵（render/fxMotions.ts の SkillFx）。変身 5 種。
 * 狼化の噛みつき・鉄塊化の重い振りは acts の bite / swing（skills/forms.ts の noteShapeSwing が振りの出た瞬間に積む）
 */
const FX = {
  skills: {
    wolfForm: {
      ramp: "steel",
      cast: { sheet: "skillForm.wolfCast", life: 0.45, base: 0, pivot: "pos" },
      aura: { sheet: "skillForm.wolfAura", base: 0, period: 0.8 },
      act: { sheet: "skillForm.wolfHowl", life: 0.5, base: WOLF.howlPx, pivot: "pos" },
      acts: { bite: { sheet: "skillForm.wolfBite", life: 0.25, base: 0, pivot: "pos" } },
      end: { sheet: "skillForm.wolfEnd", life: 0.35, base: 0, pivot: "pos" },
    },
    wraithForm: {
      ramp: "dark",
      cast: { sheet: "skillForm.wraithCast", life: 0.5, base: 0, pivot: "pos" },
      aura: { sheet: "skillForm.wraithAura", base: 0, period: 1.5 },
      end: { sheet: "skillForm.wraithEnd", life: 0.4, base: 0, pivot: "pos" },
    },
    siegeForm: {
      ramp: "steel",
      cast: { sheet: "skillForm.siegeCast", life: 0.4, base: 0, pivot: "pos", ground: "skillForm.siegeCastGround" },
      aura: { sheet: "skillForm.siegeAura", base: 0, period: 1.2, ground: "skillForm.siegeAuraGround" },
      act: { sheet: "skillForm.siegeMuzzle", life: 0.3, base: 0, pivot: "pos" },
      fly: { sheet: "skillForm.siegeShell", base: 0, period: 0.2 },
      end: { sheet: "skillForm.siegeEnd", life: 0.35, base: 0, pivot: "pos" },
    },
    ironForm: {
      ramp: "steel",
      cast: { sheet: "skillForm.ironCast", life: 0.45, base: 0, pivot: "pos" },
      aura: { sheet: "skillForm.ironAura", base: 0, period: 2.4 },
      acts: { swing: { sheet: "skillForm.ironSwing", life: 0.4, base: 0, pivot: "pos" } },
      end: { sheet: "skillForm.ironEnd", life: 0.4, base: 0, pivot: "pos" },
    },
    pyreForm: {
      ramp: "fire",
      cast: { sheet: "skillForm.pyreCast", life: 0.5, base: 0, pivot: "pos", ground: "skillForm.pyreCastGround" },
      aura: { sheet: "skillForm.pyreAura", base: 0, period: 0.8, ground: "skillForm.pyreAuraGround" },
      end: { sheet: "skillForm.pyreEnd", life: 0.4, base: 0, pivot: "pos" },
    },
  },
};

export const ATLAS = {
  key: "skillForm",
  fx: FX,
  sheets: [
    { key: "skillForm.wolfCast", dirs: 1, frames: 9, active: 0, size: 120, draw: wolfCast },
    { key: "skillForm.wolfAura", dirs: 1, frames: WOLF_AURA_FRAMES, active: 0, size: AURA_SIZE, draw: wolfAura },
    { key: "skillForm.wolfBite", dirs: DIRS, frames: 7, active: 0, size: sheetSize(WOLF.bitePx * 2 + 24, 4), draw: wolfBite },
    { key: "skillForm.wolfHowl", dirs: 1, frames: 10, active: 0, size: sheetSize(HOWL_R, 10), draw: wolfHowl },
    { key: "skillForm.wolfEnd", dirs: 1, frames: 7, active: 0, size: AURA_SIZE, draw: wolfEnd },
    { key: "skillForm.wraithCast", dirs: 1, frames: 10, active: 0, size: 120, draw: wraithCast },
    { key: "skillForm.wraithAura", dirs: 1, frames: WRAITH_AURA_FRAMES, active: 0, size: AURA_SIZE, draw: wraithAura },
    { key: "skillForm.wraithEnd", dirs: 1, frames: 8, active: 0, size: 170, draw: wraithEnd },
    { key: "skillForm.siegeCast", dirs: 1, frames: 8, active: 0, size: AURA_SIZE, draw: siegeCast },
    { key: "skillForm.siegeCastGround", dirs: 1, frames: 8, active: 0, size: AURA_SIZE, draw: siegeCastGround },
    { key: "skillForm.siegeAura", dirs: 1, frames: SIEGE_AURA_FRAMES, active: 0, size: AURA_SIZE, draw: siegeAura },
    { key: "skillForm.siegeAuraGround", dirs: 1, frames: 1, active: 0, size: AURA_SIZE, draw: siegeAuraGround },
    { key: "skillForm.siegeMuzzle", dirs: DIRS, frames: 7, active: 0, size: 120, draw: siegeMuzzle },
    { key: "skillForm.siegeShell", dirs: DIRS, frames: 4, active: 0, size: 72, draw: siegeShell },
    { key: "skillForm.siegeEnd", dirs: 1, frames: 7, active: 0, size: AURA_SIZE, draw: siegeEnd },
    { key: "skillForm.ironCast", dirs: 1, frames: 9, active: 0, size: 120, draw: ironCast },
    { key: "skillForm.ironAura", dirs: 1, frames: IRON_AURA_FRAMES, active: 0, size: AURA_SIZE, draw: ironAura },
    { key: "skillForm.ironSwing", dirs: DIRS, frames: 9, active: 0, size: sheetSize(IRON.swingPx * 2 + 12, 10), draw: ironSwing },
    { key: "skillForm.ironEnd", dirs: 1, frames: 8, active: 0, size: 110, draw: ironEnd },
    { key: "skillForm.pyreCast", dirs: 1, frames: 10, active: 0, size: 170, draw: pyreCast },
    { key: "skillForm.pyreCastGround", dirs: 1, frames: 10, active: 0, size: 100, draw: pyreCastGround },
    { key: "skillForm.pyreAura", dirs: 1, frames: PYRE_AURA_FRAMES, active: 0, size: AURA_SIZE, draw: pyreAura },
    { key: "skillForm.pyreAuraGround", dirs: 1, frames: PYRE_AURA_FRAMES, active: 0, size: AURA_SIZE, draw: pyreAuraGround },
    { key: "skillForm.pyreEnd", dirs: 1, frames: 8, active: 0, size: AURA_SIZE, draw: pyreEnd },
  ],
};
