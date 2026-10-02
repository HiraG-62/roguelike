// スキル石: 基本スキル 6 本の墨のエフェクト（docs/ideas/fx-sprites.md 10 章）。単位は絵のドット（論理 0.5px）。正準の向きは +x（構える・投げる向き）
// 絵の大きさはスキルの数値（src/data/balance/skills/SKILL/）の半径 × 2 ドットで描き、表の base にその半径（px）を書く。
// 光・閃き・火花の星は使わず、筆の一筆・円相・墨の飛沫・墨だまり・滲み・飛白で描く
//
// パリィ（parry）「構える。受け止めた攻撃は見切りになり、再使用時間が戻る」
// - 構え（active）: 体の前に受けの一筆（三日月の太い弧）が書き進み、内側に細い二の筆
// - 見切り（act）: 刃が打ち合った「×」の二筆が交わり、弾き返す円相が範囲の縁まで開いて墨が外へ飛ぶ
// 血の契約（bloodPact）「生命を払って攻撃速度と吸血を得る」
// - 契約（cast の地面）: 床に押した血判（丸印の円相の中に指の渦の筆）。空中は胸から血の墨が噴いて落ちる
// - 纏い（aura）: 体の縁を血の墨が滴り落ち、足元に滴の跡が脈打つ
// 引力球（gravityWell）「設置した場所へ範囲内の敵（と敵弾）を引き寄せる」
// - 設置（cast）: 縁から中心へ巻き込む渦の一筆
// - 渦（placed）: 床に内へ巻く墨流しの腕（間引いた滲み）、中心に墨玉と、それを巡る筆の輪。墨の粒が渦に沿って吸い込まれる
// - 破裂（end）: 墨玉が割れて飛沫が四方へ、円相が外へ開く
// 地雷（mines）「足元に地雷を設置する。起動後、敵が踏むと爆発する」
// - 設置（cast）: 床に墨を一滴落とし、小さく跳ねる
// - 設置物（placed）: 筆で描いた円盤に「×」の印、真ん中の墨点が脈打つ。床に範囲の破線の筆
// - 炸裂（end）: 大きな墨だまりが割れて外へ筆の放射と飛沫。床に円相の衝撃と焦げの滲み
// 加速（haste）「ダッシュの再使用時間が無くなり移動速度が上がる」
// - 発動（cast）: 体から乾いた筆の速度線（飛白の払い）が放射に走る
// - 纏い（aura）: 体に巻きつく 2 本の風の筆と、足元を回る飛白の弧
// 鎖鎌（chainHook）「鎖を伸ばし、最初に当たった敵を手元へ引き寄せる」
// - 伸びる（active）: 手元から筆の鎖の輪が連なって伸び、先に鎌の刃の一筆
// - 引き寄せ（end）: 刺さった所から手元へ鎖（beam）が張り、先で鎌が食い込んで墨が跳ね（tip）、手元で引く払い
import { arcPoints, brushStroke, enso, inkBlot, inkWash, lv, splatter } from "../brush.mjs";
import { dot, hash1, paint, smoothstep } from "../raster.mjs";
import { DIRS } from "../motifs.mjs";

const TAU = Math.PI * 2;
/** 1 論理 px のドット数 */
const PX = 2;
/** プレイヤーの体の半径（ドット。PLAYER.radius 5px） */
const BODY = 10;
/** 床に寝た形の縦の潰れ（足元の輪・紋） */
const FLOOR_SQ = 0.55;

/** 作業面の一辺（半径 + 余白。ドット） */
function side(radius, pad) {
  return Math.ceil(radius + pad) * 2;
}

/** コマの進み（0..1。コマの真ん中） */
function prog(f, frames) {
  return (f + 0.5) / frames;
}

/** 楕円の折れ線（中心 cx, cy・半径 rx, ry・角 a0 から sweep） */
function ellipsePts(cx, cy, rx, ry, a0, sweep, steps = 32) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const a = a0 + (sweep * i) / steps;
    pts.push({ x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry });
  }
  return pts;
}

/** 渦の腕の折れ線: 半径 r0 → r1、角 a0 から turn だけ巻く */
function spiralPts(r0, r1, a0, turn, steps = 40) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const r = r0 + (r1 - r0) * t;
    const a = a0 + turn * t;
    pts.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
  }
  return pts;
}

/** 間引いた墨のむら（円の中を市松に 1 つおき・まばらに）。level は段 */
function sparseDisc(frame, cx, cy, r, density, level, seed) {
  paint(
    frame,
    (x, y) => {
      const d = Math.hypot(x - cx, y - cy);
      if (d > r) return -1;
      if (((Math.floor(x) + Math.floor(y)) & 1) === 1) return -1;
      if (hash1(Math.floor(x) * 131 + Math.floor(y), seed) > density) return -1;
      return lv(level);
    },
    { bounds: { x0: cx - r - 1, y0: cy - r - 1, x1: cx + r + 1, y1: cy + r + 1 }, dither: 0 },
  );
}

// -----------------------------------------------------------------------------
// パリィ
// -----------------------------------------------------------------------------

const PARRY = {
  /** 弾き返しの半径（px）。SKILL.parry.radius */
  radiusPx: 40,
  /** 受けの弧の半径（ドット）。受け止める届き（体 + catchPad = 9px）の少し外 */
  guardR: 22,
  seed: 7201,
};
const PARRY_GUARD_FRAMES = 6;

/** 構え（active）: 体の前に受けの一筆が上から下へ書き進み、内側に細い二の筆。構えの終わりは掠れて薄れる */
function parryGuard(frame, f) {
  const p = prog(f, PARRY_GUARD_FRAMES);
  const R = PARRY.guardR;
  const grow = smoothstep(0, 0.45, p);
  const fade = smoothstep(0.7, 1, p) * 0.5;
  brushStroke(frame, { pts: arcPoints(0, 0, R, -1.05, 2.1, 28), width: 6, grow, fade, dry: 0.45, press: 0.18, tail: 0.4, seed: PARRY.seed });
  const g2 = smoothstep(0.2, 0.7, p);
  if (g2 > 0.02) brushStroke(frame, { pts: arcPoints(0, 0, R - 9, -0.7, 1.4, 20), width: 2.4, grow: g2, fade, dry: 0.5, seed: PARRY.seed + 1 });
  // 書き先から垂れる小さな墨（構えの気配）
  if (p > 0.4) dot(frame, Math.cos(1.05) * R + 1, Math.sin(1.05) * R + 3, 5);
}

const PARRY_FLASH_FRAMES = 8;

/** 見切り（act）: 中心で「×」の二筆が交わり（刃の打ち合い）、弾き返しの円相が範囲の縁まで開き、墨が外へ飛ぶ */
function parryFlash(frame, f) {
  const p = prog(f, PARRY_FLASH_FRAMES);
  const R = PARRY.radiusPx * PX;
  const seed = PARRY.seed + 10;
  // ×: 左上 → 右下、右上 → 左下の二筆（打ち合いの一瞬で書き切り、掠れて消える）
  const xFade = smoothstep(0.35, 0.8, p);
  const L = 18;
  brushStroke(frame, { pts: [{ x: -L, y: -L }, { x: L, y: L }], width: 7, grow: smoothstep(0, 0.15, p), fade: xFade, dry: 0.4, seed: seed + 1 });
  brushStroke(frame, { pts: [{ x: L, y: -L }, { x: -L, y: L }], width: 7, grow: smoothstep(0.08, 0.25, p), fade: xFade, dry: 0.4, seed: seed + 2 });
  if (p < 0.2) inkBlot(frame, { radius: 5, seed: seed + 3 });
  // 弾き返しの円相: 小さく書かれてから縁まで開く
  const r = R * (0.35 + 0.65 * smoothstep(0.05, 0.7, p));
  enso(frame, { radius: r, a0: -Math.PI * 0.6, width: 6 * (1 - 0.5 * p) + 1, grow: smoothstep(0.05, 0.45, p), fade: smoothstep(0.55, 1, p) * 0.9, seed: seed + 4 });
  splatter(frame, f, 18, seed + 5, (i, rr) => {
    const a = rr(1) * TAU;
    return { x: Math.cos(a) * 8, y: Math.sin(a) * 8, vx: Math.cos(a) * (6 + 6 * rr(2)), vy: Math.sin(a) * (6 + 6 * rr(2)), size: rr(3) > 0.6 ? 1.6 : 0.9, born: rr(4) * 2, life: 5, level: rr(5) > 0.5 ? 7 : 5 };
  });
}

// -----------------------------------------------------------------------------
// 血の契約
// -----------------------------------------------------------------------------

const PACT = {
  /** 血判の丸印の半径（ドット） */
  sigilR: 30,
  seed: 7301,
};
const PACT_FRAMES = 10;

/** 血判の指の渦（丸印の内側の、渦を巻く細い筆の弧）。grow で書き進む */
function thumbprint(frame, grow, fade, seed) {
  const R = PACT.sigilR;
  for (let i = 0; i < 4; i++) {
    const rx = R * (0.18 + 0.15 * i);
    const g = smoothstep(i * 0.12, 0.5 + i * 0.12, grow);
    if (g < 0.02) continue;
    const pts = ellipsePts(0, 0, rx, rx * FLOOR_SQ * 1.25, -Math.PI / 2 + i * 0.9, TAU * (0.6 + 0.08 * i), 28);
    brushStroke(frame, { pts, width: 2, grow: g, fade, dry: 0.4, press: 0.05, core: lv(7), body: lv(6), edge: lv(5), seed: seed + i });
  }
}

/** 契約（cast の地面）: 床に血判を押す。丸印の円相（床に寝た楕円）が書かれ、中に指の渦。後半は滲んで薄れる */
function pactSigil(frame, f) {
  const p = prog(f, PACT_FRAMES);
  const R = PACT.sigilR;
  const fade = smoothstep(0.6, 1, p) * 0.9;
  brushStroke(frame, {
    pts: ellipsePts(0, 0, R, R * FLOOR_SQ, -Math.PI * 0.7, TAU * 0.92, 48),
    width: 4.5,
    grow: smoothstep(0, 0.4, p),
    fade,
    dry: 0.5,
    tail: 0.45,
    seed: PACT.seed,
  });
  thumbprint(frame, smoothstep(0.15, 0.6, p), fade, PACT.seed + 20);
}

/** 契約（cast の空中）: 胸から血の墨が噴き上がり、放物線で落ちる（粒の芯が血の差し色） */
function pactSplash(frame, f) {
  const seed = PACT.seed + 3;
  if (f < 3) inkBlot(frame, { x: 0, y: -4, radius: 6 - f * 1.5, seed: seed + f, core: lv(7), coreWidth: 0.6 });
  for (let i = 0; i < 16; i++) {
    const r = (k) => hash1(i * 7 + k, seed);
    const vx = (r(1) - 0.5) * 8;
    const vy = -(4 + 5 * r(2));
    const t = f - Math.floor(r(3) * 2);
    if (t < 0 || t > PACT_FRAMES - 2) continue;
    const x = vx * t;
    const y = -4 + vy * t + 0.9 * t * t;
    const size = r(4) > 0.5 ? 1.8 : 1.1;
    inkBlot(frame, { x, y, radius: size + 0.4, seed: seed + i, core: lv(7), coreWidth: 0.55 });
    // 落ちていく向きの反対へ短い尾
    dot(frame, x - vx * 0.25, y - (vy + 1.8 * t) * 0.25, 5);
  }
}

const AURA_FRAMES = 8;

/** 纏い（空中）: 体の縁を血の墨が伝って滴り落ちる（伸びた滴に差し色の芯） */
function pactAura(frame, f) {
  const seed = PACT.seed + 7;
  for (let i = 0; i < 6; i++) {
    const r = (k) => hash1(i * 5 + k, seed);
    const t = (f / AURA_FRAMES + r(1)) % 1;
    const x = (r(2) - 0.5) * BODY * 2.2;
    const y = -10 + t * t * 24;
    const len = 2 + 4 * (1 - t);
    brushStroke(frame, { pts: [{ x, y: y - len }, { x, y }], width: 2.2, press: 0.4, tail: 0.1, sharp: 0, dry: 0, core: lv(7), seed: seed + i });
    dot(frame, x, y + 1, 7);
    dot(frame, x + 0.5, y + 1, 6);
  }
}

/** 纏い（地面）: 足元に落ちた滴の跡が脈を打つ（拍で墨だまりが膨らむ） */
function pactAuraGround(frame, f) {
  const beat = f % 4;
  const pulse = beat === 0 ? 1 : beat === 1 ? 0.6 : 0.3;
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU + 0.5;
    inkBlot(frame, { x: Math.cos(a) * 10, y: 8 + Math.sin(a) * 4, radius: 1.2 + pulse * 1.1, seed: PACT.seed + 40 + i, core: lv(7), coreWidth: 0.4 * pulse });
  }
}

// -----------------------------------------------------------------------------
// 引力球
// -----------------------------------------------------------------------------

const WELL = {
  /** 引く範囲の半径（px）。SKILL.gravityWell.radius */
  radiusPx: 50,
  /** 中心の墨玉の半径（ドット） */
  coreR: 13,
  seed: 7601,
};
const WELL_R = WELL.radiusPx * PX;
const WELL_FRAMES = 10;
const WELL_ARMS = 3;

/** 中心の墨玉（芯に差し色）と、それを巡る筆の輪（spin で回る） */
function darkOrb(frame, spin, grow = 1) {
  inkBlot(frame, { radius: WELL.coreR * grow, seed: WELL.seed + 1, coreWidth: 0.45 });
  if (grow < 0.5) return;
  brushStroke(frame, { pts: arcPoints(0, 0, WELL.coreR + 7, spin, TAU * 0.7, 24), width: 3.4, dry: 0.5, tail: 0.5, seed: WELL.seed + 2 });
}

/** 設置（cast）: 範囲の縁から中心へ、巻き込む渦の一筆が 3 本走る */
function wellOpen(frame, f) {
  const p = prog(f, 8);
  const grow = smoothstep(0, 0.6, p);
  const fade = smoothstep(0.6, 1, p) * 0.8;
  for (let i = 0; i < WELL_ARMS; i++) {
    const a0 = (i / WELL_ARMS) * TAU;
    brushStroke(frame, { pts: spiralPts(WELL_R, WELL.coreR, a0, 2.2, 40), width: 5, grow, fade, dry: 0.5, press: 0.2, tail: 0.5, seed: WELL.seed + 10 + i });
  }
  if (p > 0.5) inkBlot(frame, { radius: WELL.coreR * smoothstep(0.5, 0.9, p), seed: WELL.seed + 1, coreWidth: 0.45 });
}

/** 渦（placed の地面）: 間引いた滲みの床と、内へ巻く墨流しの腕（回る） */
function wellFloor(frame, f) {
  const turn = (f / WELL_FRAMES) * (TAU / WELL_ARMS);
  inkWash(frame, { radius: WELL_R, reach: 1, seed: WELL.seed + 3, rimWidth: 2, rimLevel: 4, tint: 3, density: 0.12, cell: 7 });
  for (let i = 0; i < WELL_ARMS; i++) {
    const a0 = (i / WELL_ARMS) * TAU - turn;
    brushStroke(frame, { pts: spiralPts(WELL_R * 0.92, WELL.coreR + 4, a0, 2.4, 40), width: 3.2, dry: 0.65, press: 0.1, tail: 0.6, seed: WELL.seed + 20 + i });
  }
}

/** 渦（placed の空中）: 中心の墨玉と巡る輪、渦に沿って吸い込まれる墨の粒 */
function wellCore(frame, f) {
  const t0 = f / WELL_FRAMES;
  darkOrb(frame, -t0 * TAU);
  for (let i = 0; i < 12; i++) {
    const r = (k) => hash1(i * 11 + k, WELL.seed + 30);
    const ph = (t0 + r(1)) % 1;
    const rad = WELL_R * 0.9 * (1 - ph) + WELL.coreR;
    const a = r(2) * TAU - ph * 2.4;
    const x = Math.cos(a) * rad;
    const y = Math.sin(a) * rad;
    inkBlot(frame, { x, y, radius: 1.5, seed: WELL.seed + 31 + i, coreWidth: 0.5 });
    // 吸い込まれる向きの後ろ（外側）へ短い尾
    for (let t = 1.5; t < 5; t += 0.5) dot(frame, x + Math.cos(a) * t, y + Math.sin(a) * t, 5);
  }
}

/** 破裂（end）: 墨玉が割れて飛沫が四方へ、円相が外へ開いて掠れる */
function wellBurst(frame, f) {
  const p = prog(f, 8);
  if (p < 0.3) inkBlot(frame, { radius: WELL.coreR * (1 + p * 2), seed: WELL.seed + 40, coreWidth: 0.5 });
  enso(frame, { radius: WELL_R * (0.3 + 0.7 * smoothstep(0, 0.6, p)), width: 7 * (1 - 0.6 * p), grow: smoothstep(0, 0.35, p), fade: smoothstep(0.45, 1, p) * 0.9, seed: WELL.seed + 41 });
  splatter(frame, f, 26, WELL.seed + 42, (i, r) => {
    const a = r(1) * TAU;
    return { x: Math.cos(a) * 6, y: Math.sin(a) * 6, vx: Math.cos(a) * (6 + 8 * r(2)), vy: Math.sin(a) * (6 + 8 * r(2)), size: r(3) > 0.6 ? 2 : 1.1, life: 6, level: r(4) > 0.5 ? 7 : 5 };
  });
}

// -----------------------------------------------------------------------------
// 地雷
// -----------------------------------------------------------------------------

const MINE = {
  /** 爆発の半径（px）。SKILL.mines.radius */
  radiusPx: 30,
  /** 円盤の半径（ドット） */
  discR: 11,
  seed: 7701,
};
const MINE_R = MINE.radiusPx * PX;
const MINE_FRAMES = 8;

/** 筆で描いた地雷: 円盤の輪郭の一筆と「×」の印、真ん中の墨点（pulse で膨らむ） */
function mineDisc(frame, pulse) {
  const R = MINE.discR;
  sparseDisc(frame, 0, 0, R - 3, 0.35, 2, MINE.seed + 1);
  brushStroke(frame, { pts: ellipsePts(0, 0, R, R * 0.8, -Math.PI * 0.6, TAU * 0.95, 28), width: 2.4, dry: 0.35, tail: 0.3, seed: MINE.seed + 2 });
  const k = R * 0.42;
  brushStroke(frame, { pts: [{ x: -k, y: -k * 0.8 }, { x: k, y: k * 0.8 }], width: 1.6, dry: 0.2, seed: MINE.seed + 3 });
  brushStroke(frame, { pts: [{ x: k, y: -k * 0.8 }, { x: -k, y: k * 0.8 }], width: 1.6, dry: 0.2, seed: MINE.seed + 4 });
  if (pulse > 0) inkBlot(frame, { radius: 1 + pulse * 1.6, seed: MINE.seed + 5, coreWidth: 0.6 });
}

/** 設置物（placed の空中）: 円盤と、脈打つ真ん中の墨点（踏まれるのを待つ鼓動） */
function mineLamp(frame, f) {
  const beat = f % 4;
  mineDisc(frame, beat === 0 ? 1 : beat === 1 ? 0.5 : 0);
}

/** 設置物（placed の地面）: 爆発の範囲を示す破線の筆（間の空いた短い弧の連なり） */
function mineRange(frame, f) {
  const n = 10;
  const turn = (f / MINE_FRAMES) * (TAU / n);
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * TAU + turn;
    brushStroke(frame, { pts: arcPoints(0, 0, MINE_R - 2, a0, (TAU / n) * 0.5, 8), width: 1.8, dry: 0.3, press: 0.1, tail: 0.5, core: lv(4), body: lv(3), edge: lv(3), seed: MINE.seed + 10 + i });
  }
}

/** 設置（cast）: 床に墨が一滴落ちて、小さく跳ねる */
function mineSet(frame, f) {
  const p = prog(f, 6);
  inkBlot(frame, { radius: 5 + 3 * smoothstep(0, 0.4, p), seed: MINE.seed + 20, coreWidth: 0.3 });
  splatter(frame, f, 10, MINE.seed + 21, (i, r) => {
    const a = r(1) * TAU;
    return { x: Math.cos(a) * 5, y: Math.sin(a) * 4, vx: Math.cos(a) * (2 + 3 * r(2)), vy: Math.sin(a) * (1.5 + 2 * r(2)), size: r(3) > 0.5 ? 1.2 : 0.8, life: 4, level: 5 };
  });
}

const MINE_BLAST_FRAMES = 9;

/** 炸裂（end の空中）: 大きな墨だまりが膨らんで割れ、外へ筆の放射（尖る払い）と飛沫 */
function mineBlast(frame, f) {
  const p = prog(f, MINE_BLAST_FRAMES);
  const seed = MINE.seed + 30;
  if (p < 0.35) inkBlot(frame, { radius: 10 + 26 * smoothstep(0, 0.35, p), seed: seed + f, coreWidth: 0.55 - p });
  const n = 9;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + hash1(i, seed) * 0.4;
    const r0 = 10;
    const r1 = MINE_R * (0.75 + 0.35 * hash1(i, seed + 1));
    brushStroke(frame, {
      pts: [{ x: Math.cos(a) * r0, y: Math.sin(a) * r0 }, { x: Math.cos(a) * r1, y: Math.sin(a) * r1 }],
      width: 6,
      grow: smoothstep(0.05, 0.45, p),
      fade: smoothstep(0.45, 1, p),
      dry: 0.55,
      tail: 0.6,
      seed: seed + 10 + i,
    });
  }
  splatter(frame, f, 28, seed + 2, (i, r) => {
    const a = r(1) * TAU;
    return { x: Math.cos(a) * 10, y: Math.sin(a) * 10, vx: Math.cos(a) * (7 + 9 * r(2)), vy: Math.sin(a) * (7 + 9 * r(2)) - 2, size: r(3) > 0.6 ? 2.2 : 1.2, life: 7, level: r(4) > 0.4 ? 7 : 5 };
  });
}

/** 炸裂（end の地面）: 床に円相の衝撃が開き、焦げの滲みが残って薄れる */
function mineShock(frame, f) {
  const p = prog(f, MINE_BLAST_FRAMES);
  inkWash(frame, { radius: MINE_R * 0.8, reach: smoothstep(0, 0.4, p), seed: MINE.seed + 40, rimWidth: 2, rimLevel: 4, tint: 3, density: 0.18 * (1 - p), cell: 5 });
  enso(frame, { radius: MINE_R * (0.4 + 0.6 * smoothstep(0, 0.5, p)), width: 5 * (1 - 0.5 * p), grow: smoothstep(0, 0.3, p), fade: smoothstep(0.4, 1, p), seed: MINE.seed + 41 });
}

// -----------------------------------------------------------------------------
// 加速
// -----------------------------------------------------------------------------

const HASTE = { seed: 7801 };
const HASTE_FRAMES = 8;

/** 発動（cast）: 体から乾いた筆の速度線（飛白の払い）が放射に走って抜ける */
function hasteBurst(frame, f) {
  const p = prog(f, 8);
  const n = 10;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + hash1(i, HASTE.seed) * 0.35;
    const r0 = 12 + 40 * smoothstep(0.2, 1, p);
    const len = 30 * (0.6 + 0.4 * hash1(i, HASTE.seed + 1));
    const r1 = r0 + len;
    brushStroke(frame, {
      pts: [{ x: Math.cos(a) * r0, y: Math.sin(a) * r0 }, { x: Math.cos(a) * r1, y: Math.sin(a) * r1 }],
      width: i % 2 === 0 ? 4 : 2.6,
      grow: smoothstep(0, 0.4, p),
      fade: smoothstep(0.35, 1, p),
      dry: 0.8,
      pitch: 1.3,
      breakLen: 10,
      tail: 0.7,
      seed: HASTE.seed + 10 + i,
    });
  }
  if (p < 0.4) enso(frame, { radius: 14 + 10 * p, width: 3.5, grow: smoothstep(0, 0.35, p), fade: smoothstep(0.2, 0.4, p), seed: HASTE.seed + 2 });
}

/** 纏い（地面）: 足元を回る飛白の弧（床に寝た楕円の上を、乾いた筆が走る） */
function hasteRing(frame, f) {
  const a0 = (f / HASTE_FRAMES) * TAU;
  for (let k = 0; k < 2; k++) {
    brushStroke(frame, { pts: ellipsePts(0, 8, 13, 13 * FLOOR_SQ, a0 + k * Math.PI, 2.2, 20), width: 2.6, dry: 0.75, press: 0.05, tail: 0.7, pitch: 1.2, breakLen: 6, seed: HASTE.seed + 20 + k });
  }
}

/** 纏い（空中）: 体に巻きつく 2 本の風の筆（螺旋に昇り、尾が掠れる） */
function hasteWind(frame, f) {
  const t0 = f / HASTE_FRAMES;
  for (let k = 0; k < 2; k++) {
    const pts = [];
    for (let i = 0; i <= 18; i++) {
      const t = i / 18;
      const a = (t0 + k * 0.5) * TAU + t * Math.PI * 1.3;
      pts.push({ x: Math.cos(a) * (BODY + 5), y: 8 - t * 22 + Math.sin(a) * 4 });
    }
    brushStroke(frame, { pts, width: 2.2, dry: 0.6, press: 0.05, tail: 0.6, pitch: 1.2, breakLen: 6, seed: HASTE.seed + 30 + k });
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

/** 鎖の輪 1 つ（筆で描いた輪）: 中心 (cx, cy)。正面の楕円の輪か、横から見た短い一筆（side） */
function chainLink(frame, cx, cy, sideView, fade, seed) {
  const half = HOOK.link * 0.62;
  if (sideView) {
    brushStroke(frame, { pts: [{ x: cx - half, y: cy }, { x: cx + half, y: cy }], width: 2.2, press: 0.2, tail: 0.2, dry: 0, fade, seed });
    return;
  }
  brushStroke(frame, { pts: ellipsePts(cx, cy, half, 2.8, Math.PI * 0.8, TAU * 0.95, 16), width: 1.6, press: 0.05, tail: 0.2, dry: 0, fade, seed });
}

/** 鎌の刃: 先 (x, 0) から反り返る三日月の一筆と、短い柄 */
function sickle(frame, x, fade) {
  const pts = [];
  for (let i = 0; i <= 14; i++) {
    const t = i / 14;
    // 柄の根元から前へ出て、上へ反り、手元側へ尖って戻る
    pts.push({ x: x + 6 * Math.sin(t * Math.PI) - 5 * t, y: -18 * t + 2 * Math.sin(t * Math.PI) });
  }
  brushStroke(frame, { pts, width: 5, press: 0.15, tail: 0.6, dry: 0.3, fade, seed: HOOK.seed + 1 });
  brushStroke(frame, { pts: [{ x: x - 5, y: 0 }, { x: x + 3, y: 0 }], width: 3, press: 0.1, tail: 0.1, sharp: 0, dry: 0, fade, seed: HOOK.seed + 2 });
}

/** 伸びる（active）: 手元から筆の鎖の輪が連なって届く長さまで伸び、先に鎌の刃。進み具合 = 長さ */
function hookExtend(frame, f) {
  const p = (f + 1) / HOOK_FRAMES;
  const reach = HOOK.rangePx * PX * p;
  let n = 0;
  for (let x = BODY; x < reach - 6; x += HOOK.link) {
    chainLink(frame, x, 0, n % 2 === 1, 0, HOOK.seed + 10 + n);
    n++;
  }
  sickle(frame, reach, 0);
  // 投げた手元で後ろへ跳ねる墨
  if (f < 3) splatter(frame, f, 6, HOOK.seed + 5, (i, r) => ({ x: BODY, y: 0, vx: -(1 + 2 * r(1)), vy: (r(2) - 0.5) * 4, size: 0.9, life: 3, level: 5 }));
}

const PULL_FRAMES = 7;

/** 鎖（beam の 1 区間。step px）: 張った筆の鎖の輪 2 つ。引く初めは震え、後半は掠れて消える */
function hookChain(frame, f) {
  const p = prog(f, PULL_FRAMES);
  const L = HOOK.link;
  const fade = smoothstep(0.4, 1, p) * 0.85;
  const shake = f < 3 ? (f % 2 === 0 ? 1 : -1) * 0.8 : 0;
  chainLink(frame, -L * 0.5, shake, false, fade, HOOK.seed + 20);
  chainLink(frame, L * 0.5, -shake, true, fade, HOOK.seed + 21);
}

/** 食い込み（tip）: 鎌が刺さり、刺さった所で墨が弾けて引かれる向き（-x）と前へ飛ぶ */
function hookBite(frame, f) {
  const p = prog(f, PULL_FRAMES);
  sickle(frame, 0, smoothstep(0.4, 1, p));
  if (p < 0.4) inkBlot(frame, { x: 2, y: -8, radius: 4.5 - 6 * p, seed: HOOK.seed + 30, coreWidth: 0.4 });
  splatter(frame, f, 12, HOOK.seed + 31, (i, r) => ({ x: 2, y: -8, vx: (r(5) > 0.4 ? -1 : 1) * (2 + 5 * r(1)), vy: (r(2) - 0.5) * 8, size: r(3) > 0.5 ? 1.6 : 0.9, life: 5, level: r(4) > 0.5 ? 7 : 5 }));
}

/** 引き寄せ（end の手元）: 鎖を引く弓なりの払い（前へ膨らむ縦の一筆）と、後ろへ擦れる飛白 */
function hookYank(frame, f) {
  const p = prog(f, PULL_FRAMES);
  const pts = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    pts.push({ x: 12 + 7 * Math.sin(t * Math.PI), y: -16 + 32 * t });
  }
  brushStroke(frame, { pts, width: 5, grow: smoothstep(0, 0.3, p), fade: smoothstep(0.4, 1, p), dry: 0.5, seed: HOOK.seed + 40 });
  for (let i = 0; i < 3; i++) {
    const y = (i - 1) * 6;
    brushStroke(frame, { pts: [{ x: 30 - p * 8, y }, { x: 4 - p * 10, y }], width: 2.4, grow: smoothstep(0, 0.4, p), fade: smoothstep(0.3, 1, p), dry: 0.7, tail: 0.6, seed: HOOK.seed + 41 + i });
  }
}

// -----------------------------------------------------------------------------

const FX = {
  skills: {
    parry: {
      ramp: "steel",
      active: { sheet: "skillBase.parryGuard", base: 0 },
      act: { sheet: "skillBase.parryFlash", life: 0.4, base: PARRY.radiusPx, pivot: "pos" },
    },
    bloodPact: {
      // 血の差し色（素性は無属性だが、血の墨の芯を赤錆に見せたいので炎の配色）
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
    { key: "skillBase.parryGuard", dirs: DIRS, frames: PARRY_GUARD_FRAMES, active: PARRY_GUARD_FRAMES, size: side(PARRY.guardR + 12, 4), draw: parryGuard },
    { key: "skillBase.parryFlash", dirs: 1, frames: PARRY_FLASH_FRAMES, active: 0, size: side(PARRY.radiusPx * PX, 16), draw: parryFlash },
    { key: "skillBase.pactSigil", dirs: 1, frames: PACT_FRAMES, active: 0, size: side(PACT.sigilR + 8, 4), draw: pactSigil },
    { key: "skillBase.pactSplash", dirs: 1, frames: PACT_FRAMES, active: 0, size: 128, draw: pactSplash },
    { key: "skillBase.pactAura", dirs: 1, frames: AURA_FRAMES, active: 0, size: 64, draw: pactAura },
    { key: "skillBase.pactAuraGround", dirs: 1, frames: AURA_FRAMES, active: 0, size: 48, draw: pactAuraGround },
    { key: "skillBase.wellOpen", dirs: 1, frames: 8, active: 0, size: side(WELL_R + 8, 6), draw: wellOpen },
    { key: "skillBase.wellFloor", dirs: 1, frames: WELL_FRAMES, active: 0, size: side(WELL_R, 8), draw: wellFloor },
    { key: "skillBase.wellCore", dirs: 1, frames: WELL_FRAMES, active: 0, size: side(WELL_R, 8), draw: wellCore },
    { key: "skillBase.wellBurst", dirs: 1, frames: 8, active: 0, size: side(WELL_R + 30, 10), draw: wellBurst },
    { key: "skillBase.mineSet", dirs: 1, frames: 6, active: 0, size: 64, draw: mineSet },
    { key: "skillBase.mineLamp", dirs: 1, frames: MINE_FRAMES, active: 0, size: 40, draw: mineLamp },
    { key: "skillBase.mineRange", dirs: 1, frames: MINE_FRAMES, active: 0, size: side(MINE_R, 6), draw: mineRange },
    { key: "skillBase.mineBlast", dirs: 1, frames: MINE_BLAST_FRAMES, active: 0, size: side(MINE_R * 1.2, 30), draw: mineBlast },
    { key: "skillBase.mineShock", dirs: 1, frames: MINE_BLAST_FRAMES, active: 0, size: side(MINE_R, 10), draw: mineShock },
    { key: "skillBase.hasteBurst", dirs: 1, frames: 8, active: 0, size: side(90, 8), draw: hasteBurst },
    { key: "skillBase.hasteRing", dirs: 1, frames: HASTE_FRAMES, active: 0, size: 56, draw: hasteRing },
    { key: "skillBase.hasteWind", dirs: 1, frames: HASTE_FRAMES, active: 0, size: 64, draw: hasteWind },
    { key: "skillBase.hookExtend", dirs: DIRS, frames: HOOK_FRAMES, active: HOOK_FRAMES, size: side(HOOK.rangePx * PX, 24), draw: hookExtend },
    { key: "skillBase.hookChain", dirs: 1, frames: PULL_FRAMES, active: 0, size: 32, ink: false, draw: hookChain },
    { key: "skillBase.hookBite", dirs: DIRS, frames: PULL_FRAMES, active: 0, size: 72, draw: hookBite },
    { key: "skillBase.hookYank", dirs: DIRS, frames: PULL_FRAMES, active: 0, size: 96, draw: hookYank },
  ],
};
