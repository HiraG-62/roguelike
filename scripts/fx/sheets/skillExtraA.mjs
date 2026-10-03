// スキル石: 大拡張のスキル 前半 12 本の墨のエフェクト（docs/ideas/fx-sprites.md 10 章）。単位は絵のドット（論理 0.5px）。正準の向きは +x
// 絵の大きさはスキルの数値（src/data/balance/skills/EXTRA_SKILL_TUNING/）の半径・長さ × 2 ドットで描き、表の base にその数値（px）を書く。
// 光・グロー・火花の星は使わず、筆の線・円相・墨の飛沫・墨だまり・滲み・掠れで描く。属性の差し色は芯の筋と粒だけ（段 6〜7）
//
// 伝染（contagion）: 写し元に墨が一滴落ちて床に滲み、斑点が咲く。点々の墨の筋が周りの敵へ渡り、写し先にも斑点が咲く
// 綻び（unravel）: 糸を引いた筆の針が飛び、当たると渦巻きの糸玉が解けて糸くずの筆が散る
// 燃え種爆ぜ（kindle）: 照準に円相を書き、内に火種の墨点が灯る。燃えていた敵ごとに墨の種が割れて花弁の筆が弾ける（床に焦げの滲み）
// 砕氷槌（iceBreaker）: 槌の頭（太い縦の一筆）が叩きつけられ、扇の筆と角ばった氷の欠片が飛ぶ。床に氷の割れ目。凍った敵は六角の殻ごと砕ける
// 血抜き（bloodlet）: 周りに書いた円相が縮み、墨の滴が中心へ吸われる。出血した敵の傷から滴の流れが自分へ注ぎ、手元で墨だまりになる
// 毒の収穫（harvest）: 回る鎌の筆が毒の滴を引いて飛び、毒を刈ると大鎌の一振りの弧と毒の泡（小さな円相）が昇る
// 放電（discharge）: 感電した敵で墨が弾けて稲妻の折れた筆が出て、ジグザグの一筆が自分へ走り、手元で墨玉にまとまる
// 追い討ち（rout）: 墨で描いた短刀（刃・鍔・柄・柄頭）が飛白の尾を引いて飛ぶ。恐怖した敵には 3 本の斬線が交差し、恐怖の円相が千切れて飛ぶ
// 処断（verdict）: 扇を裁く太い一筆と、交わる縦の「断」の一筆。床に角印。沈黙を消した敵には天から太い一筆が落ちて墨が弾ける
// 刺し穿ち（exploit）: 細く鋭い突きの一筆と先の飛沫。脆弱を消すと会心の十字の二筆と、殻（円相）が割れて飛ぶ
// 剥奪（strip）: 3 本の鉤爪の筆が飛び、弱体を奪うと爪が握って靄の一筆を引き剥がす。撚れた 2 本の筆が自分へ流れ、上向きの山形の筆が昇る
// 背水の一閃（lastStand）: 前へ長い一閃（太い一筆と細い残像の筆）と、背後の足元に水の波紋の筆としぶき（背水）
import { arcPoints, brushStroke, enso, inkBlot, inkWash, lv, splatter } from "../brush.mjs";
import { dot, hash1, paint, smoothstep } from "../raster.mjs";
import { DIRS } from "../motifs.mjs";

const TAU = Math.PI * 2;

// -----------------------------------------------------------------------------
// 共通の小さな部品
// -----------------------------------------------------------------------------

/** 画面の向き（sx, sy）→ 正準座標（シートの向き angle を打ち消す。天から落ちる筆・昇る泡のように画面の上下へ伸ばす物） */
function fromScreen(angle, sx, sy) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: sx * c + sy * s, y: -sx * s + sy * c };
}

/** 直線の折れ線（筆圧の profile が効くよう点を刻む） */
function linePts(ax, ay, bx, by, n = 8) {
  const pts = [];
  for (let i = 0; i <= n; i++) pts.push({ x: ax + ((bx - ax) * i) / n, y: ay + ((by - ay) * i) / n });
  return pts;
}

/** 稲妻の折れ線（端は動かさず、間の点を横へ振る） */
function zigzagPts(ax, ay, bx, by, n, amp, seed) {
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const off = i === 0 || i === n ? 0 : (i % 2 === 0 ? 1 : -1) * amp * (0.5 + hash1(i, seed));
    pts.push({ x: ax + dx * t + nx * off, y: ay + dy * t + ny * off });
  }
  return pts;
}

/** 墨の滴: 頭 (x, y) が丸く太く、向き a の反対へ細い尾を引く */
function drop(frame, x, y, a, len, w, o = {}) {
  brushStroke(frame, {
    pts: linePts(x, y, x - Math.cos(a) * len, y - Math.sin(a) * len, 4),
    width: w,
    profile: (u) => Math.pow(1 - u, 0.7),
    dry: 0,
    coreWidth: 0.45,
    seed: o.seed ?? 1,
    core: o.core,
    fade: o.fade ?? 0,
  });
}

/** 角ばった墨の欠片（氷・殻）。中心 (x, y)、向き a、大きさ s。芯の段を差し色にして縁は墨 */
function shard(frame, x, y, a, s, core = lv(6)) {
  const c = Math.cos(a);
  const sn = Math.sin(a);
  const local = [
    { x: s, y: 0 },
    { x: -s * 0.5, y: s * 0.55 },
    { x: -s * 0.35, y: -s * 0.6 },
  ];
  const p = local.map((q) => ({ x: x + q.x * c - q.y * sn, y: y + q.x * sn + q.y * c }));
  const [p0, p1, p2] = p;
  const area = (p1.x - p0.x) * (p2.y - p0.y) - (p2.x - p0.x) * (p1.y - p0.y);
  paint(
    frame,
    (px, py) => {
      const w0 = ((p1.x - px) * (p2.y - py) - (p2.x - px) * (p1.y - py)) / area;
      const w1 = ((p2.x - px) * (p0.y - py) - (p0.x - px) * (p2.y - py)) / area;
      const w2 = 1 - w0 - w1;
      if (w0 < 0 || w1 < 0 || w2 < 0) return -1;
      return Math.min(w0, w1, w2) > 0.22 ? core : lv(5);
    },
    { bounds: { x0: x - s - 1, y0: y - s - 1, x1: x + s + 1, y1: y + s + 1 }, dither: 0 },
  );
}

/** 小さな泡（細い筆の輪） */
function bubble(frame, x, y, r, level) {
  const n = Math.max(8, Math.round(r * 6));
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    if (i === 0) continue; // 一筆の書き終わりの隙間
    dot(frame, x + Math.cos(a) * r, y + Math.sin(a) * r, level);
  }
}

function sizeOf(radiusDots, pad) {
  return Math.ceil(radiusDots + pad) * 2;
}

// -----------------------------------------------------------------------------
// 伝染（contagion）
// -----------------------------------------------------------------------------

const CONTAGION = { radiusPx: 56, trailStep: 10, seed: 7101 };
const CONTAGION_R = CONTAGION.radiusPx * 2;

/** 写る斑点の置き場（写し元の周り） */
function spots(count, R, seed) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const r = (k) => hash1(i * 7 + k, seed);
    const a = r(1) * TAU;
    const at = R * (0.25 + 0.65 * Math.sqrt(r(2)));
    out.push({ x: Math.cos(a) * at, y: Math.sin(a) * at, size: 6 + 6 * r(3), born: r(4) * 0.5 });
  }
  return out;
}
const CONTAGION_SPOTS = spots(10, CONTAGION_R, CONTAGION.seed + 1);

/** 床（地面）: 一滴の墨が淡く滲み広がり、病の斑点が点々と咲く */
function contagionBloom(frame, f) {
  const frames = 8;
  const p = (f + 0.5) / frames;
  const reach = smoothstep(0, 0.6, p);
  const thin = smoothstep(0.6, 1, p);
  inkWash(frame, { radius: CONTAGION_R, reach, seed: CONTAGION.seed, rimWidth: 3 - 2 * thin, rimLevel: 4, tint: 2, density: 0.3 * (1 - thin), cell: 7 });
  CONTAGION_SPOTS.forEach((s, i) => {
    const t = smoothstep(s.born, s.born + 0.3, p) * (1 - smoothstep(0.75, 1, p) * 0.7);
    if (t <= 0.05) return;
    inkBlot(frame, { x: s.x * reach, y: s.y * reach, radius: s.size * t, seed: CONTAGION.seed + 10 + i, core: lv(6), coreWidth: 0.3 });
  });
}

/** 写し元（空中）: 中心の墨が弾け、胞子の粒が四方へ散る */
function contagionSpores(frame, f) {
  const frames = 8;
  const p = (f + 0.5) / frames;
  if (p < 0.4) inkBlot(frame, { radius: 10 * (1 - p), seed: CONTAGION.seed + 3, core: lv(6) });
  splatter(frame, f, 22, CONTAGION.seed + 4, (i, r) => {
    const a = r(1) * TAU;
    const sp = 4 + 7 * r(2);
    return { x: Math.cos(a) * 5, y: Math.sin(a) * 5, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, size: r(3) > 0.6 ? 2 : 1.1, life: 6, born: r(5) * 2, level: r(4) > 0.6 ? 7 : 5 };
  });
}

/** 渡る筋（beam の 1 区間）: 点々と続く墨の粒（胞子）が写し先（+x）へ流れ、細い筆の糸が繋ぐ */
function contagionTrail(frame, f) {
  const frames = 7;
  const p = (f + 0.5) / frames;
  const half = CONTAGION.trailStep;
  const fade = smoothstep(0.55, 1, p);
  brushStroke(frame, { pts: linePts(-half - 0.6, 0, half + 0.6, 0, 4), width: 1.3, profile: () => 1, flat: true, dry: 0, fade: 0.3 + 0.6 * fade, seed: CONTAGION.seed + 20 });
  // 粒は区間の長さ（2 × half ドット）を割り切る間隔で並べ、継ぎ目でも途切れない
  const pitch = half;
  for (let k = 0; k < 2; k++) {
    const x = -half + ((k * pitch + p * pitch * 2) % (2 * half));
    const r = 2.2 * (1 - 0.6 * fade);
    inkBlot(frame, { x, y: Math.sin(x * 0.6 + k) * 1.2, radius: r, seed: CONTAGION.seed + 21 + k, core: lv(6), coreWidth: 0.4 });
  }
}

/** 写し先: 飛んできた墨が落ちて、斑点が 4 つ咲く */
function contagionMark(frame, f) {
  const frames = 8;
  const p = (f + 0.5) / frames;
  const fade = smoothstep(0.7, 1, p);
  for (let i = 0; i < 4; i++) {
    const r = (k) => hash1(i * 5 + k, CONTAGION.seed + 30);
    const a = (i / 4) * TAU + r(1);
    const at = i === 0 ? 0 : 12 + 8 * r(2);
    const t = smoothstep(i * 0.12, i * 0.12 + 0.3, p) * (1 - fade * 0.8);
    if (t <= 0.05) continue;
    inkBlot(frame, { x: Math.cos(a) * at, y: Math.sin(a) * at, radius: (i === 0 ? 6 : 3 + 2 * r(3)) * t, seed: CONTAGION.seed + 31 + i, core: lv(6), coreWidth: 0.35 });
  }
  splatter(frame, f, 10, CONTAGION.seed + 40, (i, r) => {
    const a = r(1) * TAU;
    return { x: 0, y: 0, vx: Math.cos(a) * (2 + 4 * r(2)), vy: Math.sin(a) * (2 + 4 * r(2)), size: r(3) > 0.5 ? 1.4 : 0.8, life: 5, level: 6 };
  });
}

// -----------------------------------------------------------------------------
// 綻び（unravel）
// -----------------------------------------------------------------------------

const UNRAVEL_SEED = 7201;

/** 糸を引く針（飛んでいる間）: 鋭い筆の針と、後ろへ波打つ細い糸 */
function unravelNeedle(frame, f) {
  const frames = 6;
  const ph = (f / frames) * TAU;
  brushStroke(frame, { pts: linePts(-8, 0, 16, 0, 6), width: 3, press: 0.3, tail: 0.6, dry: 0, seed: UNRAVEL_SEED });
  // 針の穴
  dot(frame, -6, 0, 1);
  const thread = [];
  for (let i = 0; i <= 20; i++) {
    const x = -7 - i * 1.6;
    thread.push({ x, y: Math.sin(i * 0.55 - ph) * (0.6 + i * 0.12) * 2.2 });
  }
  brushStroke(frame, { pts: thread, width: 1.4, profile: (u) => 1 - 0.5 * u, dry: 0.4, seed: UNRAVEL_SEED + 1 + f });
}

/** 渦巻き（糸玉）の折れ線: 内から外へ */
function spiralPts(turns, r1, rot) {
  const pts = [];
  const n = Math.round(turns * 28);
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = rot + t * turns * TAU;
    const r = 1 + r1 * t;
    pts.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
  }
  return pts;
}

/** 綻ぶ（命中）: 巻いた糸玉が回りながら解けて小さくなり、解けた糸くずの筆が前へ散る */
function unravelFray(frame, f) {
  const frames = 8;
  const p = (f + 0.5) / frames;
  const left = 1 - smoothstep(0.1, 0.85, p);
  if (left > 0.05) brushStroke(frame, { pts: spiralPts(2, 13 * (0.5 + 0.5 * left), p * 3), width: 2, grow: left, profile: () => 1, dry: 0.15, seed: UNRAVEL_SEED + 10 });
  const fade = smoothstep(0.55, 1, p);
  // 糸くず: 玉の縁から解けて外へ伸び、波打ちながら離れていく
  const drift = 6 + 22 * smoothstep(0.2, 1, p);
  for (let i = 0; i < 6; i++) {
    const r = (k) => hash1(i * 11 + k, UNRAVEL_SEED + 20);
    const a = (i / 5 - 0.5) * 3.2 + (r(1) - 0.5) * 0.4;
    const len = (14 + 12 * r(2)) * smoothstep(0, 0.45, p);
    if (len < 2) continue;
    const pts = [];
    for (let j = 0; j <= 12; j++) {
      const t = j / 12;
      const d = 12 * left + drift * (0.6 + 0.4 * r(3)) + t * len;
      const w = Math.sin(t * 9 + i * 2 + p * 8) * 1.6 * t;
      pts.push({ x: Math.cos(a) * d - Math.sin(a) * w, y: Math.sin(a) * d + Math.cos(a) * w });
    }
    brushStroke(frame, { pts, width: 1.5, profile: (u) => 1 - 0.4 * u, fade, dry: 0.3, seed: UNRAVEL_SEED + 30 + i });
  }
  splatter(frame, f, 10, UNRAVEL_SEED + 40, (i, r) => {
    const a = (r(1) - 0.5) * 3;
    return { x: 4, y: 0, vx: Math.cos(a) * (2 + 4 * r(2)), vy: Math.sin(a) * (2 + 4 * r(2)), size: r(3) > 0.5 ? 1.4 : 0.8, life: 5, level: 7 };
  });
}

// -----------------------------------------------------------------------------
// 燃え種爆ぜ（kindle）
// -----------------------------------------------------------------------------

const KINDLE = { radiusPx: 52, burstPx: 30, seed: 7301 };
const KINDLE_R = KINDLE.radiusPx * 2;
const KINDLE_B = KINDLE.burstPx * 2;

/** 火種の置き場（照準の輪の内側） */
const KINDLE_SEEDS = spots(7, KINDLE_R * 0.8, KINDLE.seed + 1);

/** 灯す（照準）: 一筆の円相で範囲を囲い、内に火種の墨点が次々に灯る */
function kindleFlint(frame, f) {
  const frames = 8;
  const p = (f + 0.5) / frames;
  const fade = smoothstep(0.65, 1, p) * 0.9;
  enso(frame, { radius: KINDLE_R * 0.95, a0: -Math.PI * 0.6, width: 4.5, grow: smoothstep(0, 0.5, p), fade, seed: KINDLE.seed + 2 });
  KINDLE_SEEDS.forEach((s, i) => {
    const t = smoothstep(s.born, s.born + 0.25, p);
    if (t <= 0.05) return;
    // 火種: 細い滴の形（炎の芯は差し色）
    drop(frame, s.x, s.y + 3, -Math.PI / 2 + Math.sin(f * 1.7 + i) * 0.25, 11 * t, 5.5 * t, { seed: KINDLE.seed + 10 + i, core: lv(7), fade: fade * 0.6 });
  });
}

/** 爆ぜる（燃えていた敵）: 墨の種がふくらんで割れ、花弁の筆が六方へ弾けて飛沫が散る */
function kindleBurst(frame, f) {
  const frames = 9;
  const p = (f + 0.5) / frames;
  if (p < 0.3) inkBlot(frame, { radius: 6 + 10 * p, seed: KINDLE.seed + 20, core: lv(7), coreWidth: 0.5 });
  const grow = smoothstep(0.12, 0.5, p);
  const fade = smoothstep(0.5, 1, p) * 0.9;
  if (p >= 0.15) {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + 0.3;
      const bend = (hash1(i, KINDLE.seed + 21) - 0.5) * 0.6;
      const pts = [];
      for (let j = 0; j <= 8; j++) {
        const t = j / 8;
        const d = 5 + KINDLE_B * 0.75 * t;
        const aa = a + bend * t * t;
        pts.push({ x: Math.cos(aa) * d, y: Math.sin(aa) * d });
      }
      brushStroke(frame, { pts, width: 7, grow, fade, dry: 0.5, press: 0.25, tail: 0.6, seed: KINDLE.seed + 22 + i });
    }
  }
  splatter(frame, f, 18, KINDLE.seed + 30, (i, r) => {
    const a = r(1) * TAU;
    const sp = 4 + 7 * r(2);
    return { x: Math.cos(a) * 6, y: Math.sin(a) * 6, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, size: r(3) > 0.55 ? 2 : 1.1, born: 1, life: 6, level: r(4) > 0.5 ? 7 : 5 };
  });
}

/** 焦げ跡（地面）: 爆ぜた所に墨が滲む */
function kindleScorch(frame, f) {
  const frames = 9;
  const p = (f + 0.5) / frames;
  if (p > 0.92) return;
  inkWash(frame, { radius: KINDLE_B * 0.85, reach: smoothstep(0.05, 0.45, p), seed: KINDLE.seed + 40, rimWidth: 2.5 * (1 - 0.6 * smoothstep(0.5, 1, p)), rimLevel: 5, tint: 3, density: 0.3 * (1 - smoothstep(0.5, 1, p)), cell: 6 });
}

// -----------------------------------------------------------------------------
// 砕氷槌（iceBreaker）
// -----------------------------------------------------------------------------

const ICE = { radiusPx: 38, halfAngle: 0.7, shardPx: 44, seed: 7801 };
const ICE_R = ICE.radiusPx * 2;
const ICE_AT = ICE_R * 0.55;
const ICE_SH = ICE.shardPx * 2;

/** 叩く（空中）: 槌の頭（太い縦の一筆）が打ち込まれ、扇の弧の一筆と角ばった氷の欠片が前へ飛ぶ */
function iceSmash(frame, f) {
  const frames = 8;
  const p = (f + 0.5) / frames;
  const fade = smoothstep(0.45, 1, p) * 0.9;
  // 槌の頭: 打つ瞬間の太く短い縦の一筆（叩いた跡として少し残る）
  const head = 1 - smoothstep(0.3, 0.7, p);
  if (head > 0.05) {
    brushStroke(frame, { pts: linePts(ICE_AT, -22, ICE_AT, 22, 6), width: 18 * (0.6 + 0.4 * head), press: 0.2, tail: 0.3, sharp: 0.4, dry: 0.3, fade: 1 - head, grow: smoothstep(0, 0.2, p), coreWidth: 0.1, seed: ICE.seed });
    brushStroke(frame, { pts: linePts(ICE_AT - 6, 0, 4, 0, 5), width: 4.5, dry: 0.2, fade: 1 - head, seed: ICE.seed + 1 });
  }
  // 扇の弧（衝撃の届く範囲）
  if (p > 0.12) {
    const pts = arcPoints(0, 0, ICE_R * 0.9, -ICE.halfAngle, ICE.halfAngle * 2, 32);
    brushStroke(frame, { pts, width: 6, grow: smoothstep(0.12, 0.4, p), fade, dry: 0.55, seed: ICE.seed + 2 });
  }
  // 氷の欠片: 扇の中へ飛び散る三角
  const age = f - 1;
  if (age >= 0) {
    for (let i = 0; i < 12; i++) {
      const r = (k) => hash1(i * 9 + k, ICE.seed + 10);
      const a = (r(1) - 0.5) * ICE.halfAngle * 2.2;
      const k = 1 - Math.pow(0.7, age);
      const d = ICE_AT * 0.7 + (ICE_R * 0.6) * k * (0.5 + r(2));
      const life = 4 + 3 * r(3);
      if (age > life) continue;
      const s = (4 + 4 * r(4)) * (1 - (0.5 * age) / life);
      shard(frame, Math.cos(a) * d, Math.sin(a) * d, a + age * (r(5) - 0.5) * 1.5, s, lv(r(6) > 0.5 ? 7 : 6));
    }
  }
  splatter(frame, f, 10, ICE.seed + 20, (i, r) => {
    const a = (r(1) - 0.5) * ICE.halfAngle * 2.4;
    return { x: Math.cos(a) * ICE_AT, y: Math.sin(a) * ICE_AT, vx: Math.cos(a) * (3 + 5 * r(2)), vy: Math.sin(a) * (3 + 5 * r(2)), size: r(3) > 0.5 ? 1.6 : 0.9, born: 1, life: 5, level: 5 };
  });
}

/** 氷の割れ目の筆（扇の中を叩いた所から前へ折れながら走る） */
function iceCrackPaths() {
  const paths = [];
  for (let i = 0; i < 6; i++) {
    const r = (k) => hash1(i * 17 + k, ICE.seed + 30);
    let a = (i / 5 - 0.5) * ICE.halfAngle * 1.8 + (r(1) - 0.5) * 0.2;
    let x = ICE_AT * 0.6;
    let y = 0;
    const pts = [{ x, y }];
    for (let k = 0; k < 4; k++) {
      a += (r(10 + k) > 0.5 ? 1 : -1) * (0.15 + 0.25 * r(20 + k));
      const seg = 8 + 8 * r(3 + k);
      x += Math.cos(a) * seg;
      y += Math.sin(a) * seg;
      pts.push({ x, y });
    }
    paths.push(pts);
  }
  return paths;
}
const ICE_CRACKS = iceCrackPaths();

/** 床の割れ（地面）: 叩いた所に淡い墨だまり、そこから氷の割れ目が前へ走る */
function iceCrack(frame, f) {
  const frames = 8;
  const p = (f + 0.5) / frames;
  const fade = smoothstep(0.55, 1, p);
  if (p < 0.8) inkBlot(frame, { x: ICE_AT, y: 0, radius: 9 * (1 - 0.5 * fade), seed: ICE.seed + 40, core: lv(6), coreWidth: 0.2 });
  const cfade = smoothstep(0.7, 1, p);
  ICE_CRACKS.forEach((pts, i) => brushStroke(frame, { pts, width: 2.4, grow: smoothstep(0.05, 0.45, p), fade: cfade, dry: 0.2, press: 0.05, tail: 0.6, core: lv(7), seed: ICE.seed + 41 + i }));
}

/** 六角の殻の頂点 */
function hexPts(r, rot) {
  const pts = [];
  for (let i = 0; i <= 6; i++) {
    const a = rot + (i / 6) * TAU;
    pts.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
  }
  return pts;
}

/** 砕ける（凍った敵）: 六角の氷の殻が書かれ、ひびが入って、角ばった欠片が四方へ飛ぶ */
function iceShatter(frame, f) {
  const frames = 8;
  const p = (f + 0.5) / frames;
  if (p < 0.35) {
    brushStroke(frame, { pts: hexPts(18, Math.PI / 6), width: 4, profile: () => 1, dry: 0.2, seed: ICE.seed + 50 });
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * TAU + 0.4;
      brushStroke(frame, { pts: zigzagPts(0, 0, Math.cos(a) * 18, Math.sin(a) * 18, 3, 2, ICE.seed + 51 + i), width: 2, grow: smoothstep(0.05, 0.3, p), dry: 0, seed: ICE.seed + 52 + i });
    }
  }
  const age = f - 1;
  if (age >= 0) {
    for (let i = 0; i < 14; i++) {
      const r = (k) => hash1(i * 13 + k, ICE.seed + 60);
      const a = (i / 14) * TAU + r(1) * 0.4;
      const k = 1 - Math.pow(0.72, age);
      const d = 8 + ICE_SH * 0.85 * k * (0.6 + 0.4 * r(2));
      const s = (4.5 + 4 * r(3)) * (1 - 0.6 * smoothstep(0.4, 1, p));
      shard(frame, Math.cos(a) * d, Math.sin(a) * d, a + age * (r(4) - 0.5), s, lv(r(5) > 0.5 ? 7 : 6));
    }
  }
  splatter(frame, f, 14, ICE.seed + 70, (i, r) => {
    const a = r(1) * TAU;
    return { x: 0, y: 0, vx: Math.cos(a) * (3 + 6 * r(2)), vy: Math.sin(a) * (3 + 6 * r(2)), size: r(3) > 0.5 ? 1.5 : 0.8, born: 1, life: 5, level: 5 };
  });
}

// -----------------------------------------------------------------------------
// 血抜き（bloodlet）
// -----------------------------------------------------------------------------

const BLOOD = { radiusPx: 60, seed: 7901, streamStep: 10 };
const BLOOD_R = BLOOD.radiusPx * 2;

/** 抜き取る範囲（地面）: 範囲いっぱいに書いた円相が、締めるように縮む */
function bloodRing(frame, f) {
  const frames = 8;
  const p = (f + 0.5) / frames;
  const shrink = 1 - 0.55 * smoothstep(0.2, 1, p);
  enso(frame, { radius: BLOOD_R * 0.95 * shrink, a0: Math.PI * 0.3 + p * 1.5, width: 4 * (1 - 0.3 * p), grow: smoothstep(0, 0.35, p), fade: smoothstep(0.6, 1, p) * 0.9, seed: BLOOD.seed });
}

/** 吸い寄せ（空中）: 墨の滴が四方から中心へ吸われ、中心に墨だまりができる */
function bloodPull(frame, f) {
  const frames = 8;
  const p = (f + 0.5) / frames;
  for (let i = 0; i < 14; i++) {
    const r = (k) => hash1(i * 7 + k, BLOOD.seed + 10);
    const a = (i / 14) * TAU + r(1) * 0.4;
    const t = smoothstep(r(2) * 0.25, 0.7 + r(2) * 0.25, p);
    if (t >= 0.98) continue;
    const d = BLOOD_R * (0.9 - 0.1 * r(3)) * (1 - t) + 4;
    // 頭は中心を向く（吸われる向き）
    drop(frame, Math.cos(a) * d, Math.sin(a) * d, a + Math.PI, 9 + 10 * t, 4.2, { seed: BLOOD.seed + 20 + i, core: lv(7) });
  }
  const pool = smoothstep(0.3, 0.8, p) * (1 - smoothstep(0.85, 1, p));
  if (pool > 0.05) inkBlot(frame, { radius: 11 * pool, seed: BLOOD.seed + 30, core: lv(7), coreWidth: 0.4 });
}

/** 傷口（出血していた敵。+x が自分の方）: 墨が噴き、滴が自分の方へ跳ぶ */
function bloodSpurt(frame, f) {
  const frames = 7;
  const p = (f + 0.5) / frames;
  if (p < 0.6) inkBlot(frame, { radius: 9 * (1 - p), seed: BLOOD.seed + 40, core: lv(7) });
  splatter(frame, f, 14, BLOOD.seed + 41, (i, r) => {
    const a = (r(1) - 0.5) * 1.4;
    return { x: 2, y: 0, vx: Math.cos(a) * (3 + 5 * r(2)), vy: Math.sin(a) * (3 + 5 * r(2)), size: r(3) > 0.5 ? 1.8 : 1, life: 5, level: r(4) > 0.5 ? 7 : 5 };
  });
}

/** 流れ（beam の 1 区間）: 墨の滴が自分の方（+x）へ連なって流れ、細い筆の筋が繋ぐ */
function bloodStream(frame, f) {
  const frames = 7;
  const p = (f + 0.5) / frames;
  const half = BLOOD.streamStep;
  const fade = smoothstep(0.55, 1, p);
  brushStroke(frame, { pts: linePts(-half - 0.6, 0, half + 0.6, 0, 4), width: 1.6, profile: () => 1, flat: true, dry: 0, fade: 0.2 + 0.7 * fade, seed: BLOOD.seed + 50 });
  for (let k = 0; k < 2; k++) {
    const x = -half + ((k * half + p * half * 3) % (2 * half));
    drop(frame, x, 0, 0, 6 * (1 - 0.4 * fade), 3 * (1 - 0.5 * fade), { seed: BLOOD.seed + 51 + k, core: lv(7) });
  }
}

/** 取り込む（自分）: 流れ込んだ滴が手元の墨だまりに落ちて、小さな飛沫が跳ねる */
function bloodAbsorb(frame, f) {
  const frames = 7;
  const p = (f + 0.5) / frames;
  const pool = smoothstep(0, 0.35, p) * (1 - smoothstep(0.7, 1, p));
  if (pool > 0.05) inkBlot(frame, { radius: 7 * pool + 1, seed: BLOOD.seed + 60, core: lv(7), coreWidth: 0.45 });
  splatter(frame, f, 8, BLOOD.seed + 61, (i, r) => {
    const a = r(1) * TAU;
    return { x: 0, y: 0, vx: Math.cos(a) * (2 + 3 * r(2)), vy: Math.sin(a) * (2 + 3 * r(2)) - 1, size: 1, born: 1, life: 4, level: 7 };
  });
}

// -----------------------------------------------------------------------------
// 毒の収穫（harvest）
// -----------------------------------------------------------------------------

const HARVEST_SEED = 8001;

/** 回る鎌（飛んでいる間）: 三日月の鎌の筆が回り、刃先から毒の滴が後ろへ落ちる */
function harvestSickle(frame, f) {
  const frames = 8;
  const rot = (f / frames) * TAU;
  const pts = arcPoints(0, 0, 10, rot, Math.PI * 1.25, 20);
  brushStroke(frame, { pts, width: 5, press: 0.35, tail: 0.6, dry: 0.15, core: lv(7), seed: HARVEST_SEED });
  // 柄（短い一筆）
  brushStroke(frame, { pts: linePts(Math.cos(rot) * 10, Math.sin(rot) * 10, Math.cos(rot) * 2, Math.sin(rot) * 2, 3), width: 2.2, dry: 0, seed: HARVEST_SEED + 1 });
  for (let i = 0; i < 3; i++) {
    const t = ((f + i * 2.7) % frames) / frames;
    drop(frame, -12 - t * 18, (hash1(i, HARVEST_SEED + 2) - 0.5) * 8 + t * 4, 0.3, 4, 2.2 * (1 - 0.5 * t), { seed: HARVEST_SEED + 3 + i, core: lv(7) });
  }
}

/** 刈り取る（命中）: 大鎌の一振りの太い弧が敵を払い、刈られた毒が泡（小さな円相）になって昇る */
function harvestReap(frame, f, info) {
  const frames = 9;
  const p = (f + 0.5) / frames;
  const angle = info?.angle ?? 0;
  const pts = arcPoints(-14, 0, 30, -Math.PI * 0.5, Math.PI, 36);
  brushStroke(frame, { pts, width: 10, grow: smoothstep(0, 0.35, p), fade: smoothstep(0.4, 1, p) * 0.9, dry: 0.5, press: 0.2, tail: 0.5, coreWidth: 0.14, seed: HARVEST_SEED + 10 });
  for (let i = 0; i < 9; i++) {
    const r = (k) => hash1(i * 5 + k, HARVEST_SEED + 20);
    const t = smoothstep(0.15 + r(1) * 0.25, 1, p);
    if (t <= 0 || t >= 0.97) continue;
    const c = fromScreen(angle, (r(2) - 0.5) * 36 + Math.sin(t * 6 + i) * 2, -t * 40 + (r(3) - 0.5) * 10);
    bubble(frame, c.x, c.y, 2.5 + 3 * r(4) * (1 - 0.3 * t), r(5) > 0.4 ? 7 : 5);
  }
  splatter(frame, f, 10, HARVEST_SEED + 30, (i, r) => {
    const a = (r(1) - 0.5) * 2;
    return { x: 6, y: 0, vx: Math.cos(a) * (3 + 4 * r(2)), vy: Math.sin(a) * (3 + 4 * r(2)), size: r(3) > 0.5 ? 1.6 : 0.9, born: 1, life: 5, level: r(4) > 0.5 ? 7 : 5 };
  });
}

// -----------------------------------------------------------------------------
// 放電（discharge）
// -----------------------------------------------------------------------------

const SHOCK = { seed: 8101, boltStep: 12 };

/** 弾ける（感電していた敵）: 墨が弾け、折れた稲妻の短い筆が四方へ出る */
function dischargeSpark(frame, f) {
  const frames = 7;
  const p = (f + 0.5) / frames;
  if (p < 0.45) inkBlot(frame, { radius: 7 * (1 - p), seed: SHOCK.seed + f, core: lv(7), coreWidth: 0.45 });
  const fade = smoothstep(0.4, 1, p);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU + hash1(i, SHOCK.seed + 1);
    const len = 14 + 8 * hash1(i, SHOCK.seed + 2);
    brushStroke(frame, {
      pts: zigzagPts(Math.cos(a) * 4, Math.sin(a) * 4, Math.cos(a) * len, Math.sin(a) * len, 3, 2.2, SHOCK.seed + 3 + i + f * 7),
      width: 2.4,
      grow: smoothstep(0, 0.3, p),
      fade,
      dry: 0.2,
      core: lv(7),
      seed: SHOCK.seed + 10 + i,
    });
  }
}

/** 稲妻（beam の 1 区間。敵 → 自分）: 折れたジグザグの一筆。端は線の上に戻して区間を繋ぐ。コマごとに折れ方が変わる */
function dischargeBolt(frame, f) {
  const frames = 6;
  const p = (f + 0.5) / frames;
  const half = SHOCK.boltStep + 0.6;
  brushStroke(frame, {
    pts: zigzagPts(-half, 0, half, 0, 4, 3.2 * (1 - 0.3 * p), SHOCK.seed + 20 + f * 3),
    width: 3.6 * (1 - 0.45 * p),
    profile: () => 1,
    flat: true,
    dry: 0,
    coreWidth: 0.35,
    fade: smoothstep(0.4, 1, p) * 0.8,
    seed: SHOCK.seed + 21,
  });
}

/** まとまる（自分）: 稲妻の筆が手元へ集まり、墨玉（芯は差し色）にまとまって消える */
function dischargeGather(frame, f) {
  const frames = 7;
  const p = (f + 0.5) / frames;
  const ball = smoothstep(0, 0.4, p) * (1 - smoothstep(0.65, 1, p));
  if (ball > 0.05) inkBlot(frame, { radius: 7 * ball + 1, seed: SHOCK.seed + 30, core: lv(7), coreWidth: 0.5 });
  const far = 22 * (1 - smoothstep(0, 0.7, p)) + 6;
  if (p < 0.75) {
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU + 0.5;
      brushStroke(frame, {
        pts: zigzagPts(Math.cos(a) * far, Math.sin(a) * far, Math.cos(a) * 3, Math.sin(a) * 3, 3, 1.8, SHOCK.seed + 31 + i + f * 4),
        width: 2,
        dry: 0.1,
        core: lv(7),
        seed: SHOCK.seed + 40 + i,
      });
    }
  }
}

// -----------------------------------------------------------------------------
// 追い討ち（rout）
// -----------------------------------------------------------------------------

const ROUT_SEED = 8201;

/** 短刀（飛んでいる間）: 墨で描いた短刀（刃・鍔・柄・柄頭）と、後ろへ引く飛白の尾 */
function routDagger(frame, f) {
  // 尾: 乾いた筆で擦った筋（コマで擦れ方が変わる）
  brushStroke(frame, { pts: linePts(-12, 0, -34, 0, 6), width: 4, press: 0.05, tail: 0.8, dry: 0.4, fade: 0.35, breakLen: 6, seed: ROUT_SEED + f });
  // 刃
  brushStroke(frame, { pts: linePts(-2, 0, 15, 0, 6), width: 3.6, press: 0.05, tail: 0.7, sharp: 1, dry: 0, seed: ROUT_SEED + 10 });
  // 鍔・柄・柄頭
  brushStroke(frame, { pts: linePts(-3, -5, -3, 5, 4), width: 2.2, profile: () => 1, dry: 0, seed: ROUT_SEED + 11 });
  brushStroke(frame, { pts: linePts(-4, 0, -10, 0, 4), width: 2.2, profile: () => 1, dry: 0, seed: ROUT_SEED + 12 });
  inkBlot(frame, { x: -11, y: 0, radius: 1.8, seed: ROUT_SEED + 13 });
}

/** 崩れる（恐怖した敵）: 3 本の斬線が順に交差し、恐怖の円相が千切れて外へ飛ぶ */
function routBreak(frame, f) {
  const frames = 8;
  const p = (f + 0.5) / frames;
  const fade = smoothstep(0.5, 1, p) * 0.9;
  // 恐怖の輪（最初に書かれていて、斬られて千切れる）
  const burst = smoothstep(0.2, 0.9, p);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU + 0.3;
    const d = 22 + 20 * burst;
    const pts = arcPoints(Math.cos(a + 0.4) * (d - 22), Math.sin(a + 0.4) * (d - 22), 22, a, 0.9, 10);
    brushStroke(frame, { pts, width: 2.6, fade: Math.max(fade, burst * 0.4), dry: 0.4, seed: ROUT_SEED + 20 + i });
  }
  // 斬線（向きの前後に払う 3 本）
  const cuts = [
    { c: -0.75, ox: -5 },
    { c: 0.75, ox: 5 },
    { c: 0, ox: 0 },
  ];
  cuts.forEach(({ c, ox }, i) => {
    const g = smoothstep(i * 0.12, i * 0.12 + 0.22, p);
    if (g <= 0) return;
    const a = c + Math.PI / 2;
    const L = 30;
    brushStroke(frame, { pts: linePts(ox - Math.cos(a) * L, -Math.sin(a) * L, ox + Math.cos(a) * L, Math.sin(a) * L, 8), width: 4.5, grow: g, fade, dry: 0.45, press: 0.2, tail: 0.5, seed: ROUT_SEED + 30 + i });
  });
  splatter(frame, f, 12, ROUT_SEED + 40, (i, r) => {
    const a = (r(1) - 0.5) * 2.4;
    return { x: 4, y: 0, vx: Math.cos(a) * (3 + 5 * r(2)), vy: Math.sin(a) * (3 + 5 * r(2)), size: r(3) > 0.5 ? 1.6 : 0.9, born: 1, life: 5, level: 7 };
  });
}

// -----------------------------------------------------------------------------
// 処断（verdict）
// -----------------------------------------------------------------------------

const VERDICT = { radiusPx: 36, halfAngle: 0.55, seed: 8301 };
const VERDICT_R = VERDICT.radiusPx * 2;

/** 裁きの太刀（空中）: 扇を一息に払う太い弧の一筆と、交わる縦の「断」の一筆 */
function verdictSlash(frame, f) {
  const frames = 8;
  const p = (f + 0.5) / frames;
  const fade = smoothstep(0.45, 1, p) * 0.9;
  const ha = VERDICT.halfAngle + 0.2;
  const pts = arcPoints(0, 0, VERDICT_R * 0.82, -ha, ha * 2, 32);
  brushStroke(frame, { pts, width: 11, grow: smoothstep(0, 0.3, p), fade, dry: 0.45, press: 0.15, tail: 0.45, coreWidth: 0.15, seed: VERDICT.seed });
  const g2 = smoothstep(0.2, 0.45, p);
  if (g2 > 0) {
    const x = VERDICT_R * 0.38;
    brushStroke(frame, { pts: linePts(x + 6, -VERDICT_R * 0.42, x - 6, VERDICT_R * 0.42, 8), width: 7, coreWidth: 0.15, grow: g2, fade, dry: 0.5, press: 0.2, tail: 0.5, seed: VERDICT.seed + 1 });
  }
  splatter(frame, f, 12, VERDICT.seed + 2, (i, r) => {
    const a = (r(1) - 0.5) * ha * 2;
    const d = VERDICT_R * 0.82;
    return { x: Math.cos(a) * d, y: Math.sin(a) * d, vx: Math.cos(a) * (2 + 4 * r(2)), vy: Math.sin(a) * (2 + 4 * r(2)), size: r(3) > 0.5 ? 1.6 : 0.9, born: 1 + r(4) * 2, life: 5, level: 7 };
  });
}

/** 裁きの印（地面）: 扇の中ほどに角印を押す（四角の枠の筆と中の 3 画。画面に揃える） */
function verdictSeal(frame, f, info) {
  const frames = 8;
  const p = (f + 0.5) / frames;
  const angle = info?.angle ?? 0;
  const at = VERDICT_R * 0.5;
  const cx = Math.cos(0) * at;
  const S = 12 * (1.25 - 0.25 * smoothstep(0, 0.25, p));
  const fade = smoothstep(0.6, 1, p) * 0.9;
  const grow = smoothstep(0.1, 0.4, p);
  const pt = (sx, sy) => {
    const c = fromScreen(angle, sx, sy);
    return { x: cx + c.x, y: c.y };
  };
  const box = [pt(-S, -S), pt(S, -S), pt(S, S), pt(-S, S), pt(-S, -S + 2)];
  brushStroke(frame, { pts: box, width: 3, grow, fade, profile: () => 1, dry: 0.3, seed: VERDICT.seed + 10 });
  // 中の画: 横・縦・横（「断」の気配）
  const strokes = [
    [pt(-S * 0.55, -S * 0.4), pt(S * 0.55, -S * 0.4)],
    [pt(0, -S * 0.65), pt(0, S * 0.65)],
    [pt(-S * 0.55, S * 0.35), pt(S * 0.55, S * 0.35)],
  ];
  strokes.forEach(([a, b], i) => {
    const g = smoothstep(0.2 + i * 0.08, 0.45 + i * 0.08, p);
    if (g > 0) brushStroke(frame, { pts: [a, b], width: 2.2, grow: g, fade, dry: 0.2, core: lv(7), seed: VERDICT.seed + 11 + i });
  });
}

/** 天の一筆（沈黙を消した敵）: 画面の上から太い一筆が落ち、着いた所で墨が弾けて円相の跡 */
function verdictPillar(frame, f) {
  const frames = 8;
  const p = (f + 0.5) / frames;
  const H = 80;
  const fade = smoothstep(0.4, 1, p) * 0.9;
  brushStroke(frame, {
    pts: linePts(0, -H, 0, 0, 10),
    width: 9,
    grow: smoothstep(0, 0.25, p),
    fade,
    profile: (u) => 0.3 + 0.7 * u,
    dry: 0.5,
    coreWidth: 0.15,
    seed: VERDICT.seed + 20,
  });
  if (p > 0.2 && p < 0.7) inkBlot(frame, { radius: 9, seed: VERDICT.seed + 21, core: lv(7), coreWidth: 0.4 });
  if (p > 0.25) {
    const pts = arcPoints(0, 0, 18 + 8 * smoothstep(0.25, 1, p), Math.PI, TAU * 0.85, 40).map((q) => ({ x: q.x, y: q.y * 0.45 }));
    brushStroke(frame, { pts, width: 3, grow: smoothstep(0.25, 0.6, p), fade, dry: 0.5, seed: VERDICT.seed + 22 });
  }
  splatter(frame, f, 16, VERDICT.seed + 23, (i, r) => {
    const a = r(1) * TAU;
    return { x: 0, y: 0, vx: Math.cos(a) * (3 + 5 * r(2)), vy: Math.sin(a) * (2 + 3 * r(2)) - 2, size: r(3) > 0.5 ? 1.8 : 1, born: 2, life: 5, level: r(4) > 0.5 ? 7 : 5 };
  });
}

// -----------------------------------------------------------------------------
// 刺し穿ち（exploit）
// -----------------------------------------------------------------------------

const EXPLOIT = { lengthPx: 38, seed: 8401 };
const EXPLOIT_L = EXPLOIT.lengthPx * 2;

/** 突き（空中）: 細く鋭い一筆が先まで一気に走り、先で墨が飛ぶ。脇に細い速さの筆 */
function exploitThrust(frame, f) {
  const frames = 7;
  const p = (f + 0.5) / frames;
  const fade = smoothstep(0.35, 1, p) * 0.9;
  brushStroke(frame, { pts: linePts(4, 0, EXPLOIT_L, 0, 10), width: 5, grow: smoothstep(0, 0.2, p), fade, profile: (u) => 0.55 + 0.45 * Math.sin(u * Math.PI * 0.9) * (1 - smoothstep(0.75, 1, u)) + 0.1 * (1 - u), dry: 0.35, seed: EXPLOIT.seed });
  for (const s of [-1, 1]) {
    brushStroke(frame, { pts: linePts(EXPLOIT_L * 0.25, s * 6, EXPLOIT_L * 0.75, s * 4, 6), width: 1.2, grow: smoothstep(0.05, 0.3, p), fade: Math.min(1, fade + 0.2), dry: 0.5, seed: EXPLOIT.seed + 1 + s });
  }
  splatter(frame, f, 8, EXPLOIT.seed + 3, (i, r) => ({ x: EXPLOIT_L, y: 0, vx: 2 + 4 * r(1), vy: (r(2) - 0.5) * 5, size: r(3) > 0.5 ? 1.5 : 0.8, born: 1, life: 4, level: 7 }));
}

/** 穿つ（脆弱を消した敵）: 会心の十字の二筆が交わり、敵を包んでいた殻（円相）が割れて後ろへ飛ぶ */
function exploitPierce(frame, f) {
  const frames = 8;
  const p = (f + 0.5) / frames;
  const fade = smoothstep(0.5, 1, p) * 0.9;
  const burst = smoothstep(0.15, 0.8, p);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + Math.PI / 4;
    const d = 30 * burst;
    const pts = arcPoints(Math.cos(a) * d + 6 * burst, Math.sin(a) * d, 24, a - 0.5, 1.0, 10);
    brushStroke(frame, { pts, width: 2.6, fade: Math.max(fade, burst * 0.3), dry: 0.4, seed: EXPLOIT.seed + 10 + i });
  }
  const arms = [Math.PI / 4, -Math.PI / 4];
  arms.forEach((a, i) => {
    const g = smoothstep(i * 0.12, i * 0.12 + 0.2, p);
    if (g <= 0) return;
    brushStroke(frame, { pts: linePts(-Math.cos(a) * 26, -Math.sin(a) * 26, Math.cos(a) * 26, Math.sin(a) * 26, 8), width: 5, grow: g, fade, dry: 0.4, press: 0.2, tail: 0.5, seed: EXPLOIT.seed + 20 + i });
  });
  splatter(frame, f, 14, EXPLOIT.seed + 30, (i, r) => {
    const a = (r(1) - 0.5) * 1.6;
    return { x: 4, y: 0, vx: Math.cos(a) * (4 + 5 * r(2)), vy: Math.sin(a) * (4 + 5 * r(2)), size: r(3) > 0.5 ? 1.8 : 1, born: 1, life: 5, level: r(4) > 0.5 ? 7 : 5 };
  });
}

// -----------------------------------------------------------------------------
// 剥奪（strip）
// -----------------------------------------------------------------------------

const STRIP = { seed: 8451, drainStep: 10 };

/** 鉤爪の 3 本（open 0..1 で開き具合。tip が爪の先の x） */
function talons(frame, open, tip, o = {}) {
  for (let i = -1; i <= 1; i++) {
    const spread = i * (4 + 9 * open);
    const sx = o.flip ? -1 : 1;
    const pts = [];
    for (let j = 0; j <= 10; j++) {
      const t = j / 10;
      // 根元から前へ、先で内側へ曲がる鉤
      const x = -8 + (tip + 8) * t;
      const y = spread * Math.sin(t * Math.PI * 0.8) * (1 - 0.3 * t) + (i === 0 ? 0 : -Math.sign(i) * 4 * t * t * t);
      pts.push({ x: x * sx, y });
    }
    brushStroke(frame, { pts, width: 2.8, press: 0.2, tail: 0.5, sharp: 1, core: lv(5), dry: o.dry ?? 0.15, fade: o.fade ?? 0, seed: STRIP.seed + 5 + i });
  }
}

/** 鉤爪（飛んでいる間）: 3 本の鉤爪の筆が開いて前を掴みにいき、後ろに飛白の尾 */
function stripHook(frame, f) {
  const frames = 6;
  const open = 0.6 + 0.4 * Math.sin((f / frames) * TAU);
  talons(frame, open, 20);
  brushStroke(frame, { pts: linePts(-6, 0, -28, 0, 6), width: 4, press: 0.05, tail: 0.8, dry: 0.4, fade: 0.4, breakLen: 6, seed: STRIP.seed + f });
}

/** 奪う（敵。+x が自分の方）: 爪が閉じて握り、引き剥がした靄の一筆が自分の方へ伸びる */
function stripSnatch(frame, f) {
  const frames = 7;
  const p = (f + 0.5) / frames;
  const fade = smoothstep(0.55, 1, p) * 0.9;
  const open = 0.25 + 0.75 * (1 - smoothstep(0, 0.35, p));
  talons(frame, open, 16, { fade, flip: true });
  const g = smoothstep(0.25, 0.7, p);
  if (g > 0) {
    const pts = [];
    for (let j = 0; j <= 12; j++) {
      const t = j / 12;
      pts.push({ x: 2 + t * 30, y: Math.sin(t * 9) * 3 * (1 - t) });
    }
    brushStroke(frame, { pts, width: 5, grow: g, fade, dry: 0.6, press: 0.3, tail: 0.6, seed: STRIP.seed + 20 });
  }
  splatter(frame, f, 10, STRIP.seed + 21, (i, r) => {
    const a = Math.PI + (r(1) - 0.5) * 2;
    return { x: 0, y: 0, vx: Math.cos(a) * (2 + 4 * r(2)), vy: Math.sin(a) * (2 + 4 * r(2)), size: r(3) > 0.5 ? 1.5 : 0.8, born: 1, life: 5, level: 7 };
  });
}

/** 奪った力の流れ（beam の 1 区間。敵 → 自分）: 2 本の細い筆が撚り合って自分の方（+x）へ流れる */
function stripDrain(frame, f) {
  const frames = 7;
  const p = (f + 0.5) / frames;
  const half = STRIP.drainStep;
  const fade = smoothstep(0.45, 1, p) * 0.85;
  const amp = 3.2 * (1 - 0.4 * p);
  for (const s of [1, -1]) {
    const pts = [];
    for (let x = -half - 0.6; x <= half + 0.6; x += 1) {
      const ph = (x / (2 * half)) * TAU - p * TAU * 1.5;
      pts.push({ x, y: s * Math.sin(ph) * amp });
    }
    brushStroke(frame, { pts, width: 1.8, profile: () => 1, flat: true, dry: 0, fade, core: lv(7), coreWidth: 0.4, seed: STRIP.seed + 30 + s });
  }
}

/** 力を得る（自分）: 流れ込んだ筆が小さな渦になって巻き付き、上向きの山形の筆が 3 つ昇る */
function stripGain(frame, f, info) {
  const frames = 7;
  const p = (f + 0.5) / frames;
  const angle = info?.angle ?? 0;
  const fade = smoothstep(0.55, 1, p) * 0.9;
  enso(frame, { radius: 14 * (1 - 0.5 * p) + 4, a0: p * 4, sweep: TAU * 0.75, width: 2.6, grow: smoothstep(0, 0.4, p), fade, dry: 0.4, seed: STRIP.seed + 40 });
  for (let i = 0; i < 3; i++) {
    const t = p - i * 0.15;
    if (t < 0 || t > 0.85) continue;
    const sx = (i - 1) * 9;
    const sy = -8 - t * 26;
    const pts = [fromScreen(angle, sx - 5, sy + 4), fromScreen(angle, sx, sy - 1), fromScreen(angle, sx + 5, sy + 4)];
    brushStroke(frame, { pts, width: 2.6, fade: smoothstep(0.5, 0.85, t), dry: 0.2, core: lv(7), coreWidth: 0.4, seed: STRIP.seed + 41 + i });
  }
}

// -----------------------------------------------------------------------------
// 背水の一閃（lastStand）
// -----------------------------------------------------------------------------

const LAST = { lengthPx: 46, seed: 8501 };
const LAST_L = LAST.lengthPx * 2;

/** 一閃（空中）: 細い筆の線が一瞬走り、太い一筆に膨らんで掠れ、上下に細い残像の筆。先で墨が前へ飛ぶ */
function lastFlash(frame, f) {
  const frames = 8;
  const p = (f + 0.5) / frames;
  if (f === 0) {
    brushStroke(frame, { pts: linePts(4, 0, LAST_L, 0, 8), width: 1.6, profile: () => 1, dry: 0, seed: LAST.seed });
    return;
  }
  const fade = smoothstep(0.35, 1, p) * 0.9;
  brushStroke(frame, { pts: linePts(2, 0, LAST_L, 0, 12), width: 11, grow: smoothstep(0, 0.22, p), fade, dry: 0.25, press: 0.1, tail: 0.4, seed: LAST.seed + 1 });
  if (f >= 2) {
    const off = 16 + (f - 2) * 2;
    for (const s of [-1, 1]) brushStroke(frame, { pts: linePts(14, s * off, LAST_L - 10, s * off * 0.7, 8), width: 2.8, fade: Math.min(1, 0.1 + fade), dry: 0.4, seed: LAST.seed + 2 + s });
  }
  splatter(frame, f, 12, LAST.seed + 5, (i, r) => ({ x: LAST_L - 4, y: (r(1) - 0.5) * 6, vx: 3 + 5 * r(2), vy: (r(3) - 0.5) * 7, size: r(4) > 0.5 ? 1.8 : 1, born: 1, life: 5, level: 7 }));
}

/** 背水（地面）: 背後（-x）の足元に水の波紋の筆が半円に広がり、しぶきが後ろへ跳ねる */
function lastWater(frame, f) {
  const frames = 8;
  const p = (f + 0.5) / frames;
  const fade = smoothstep(0.4, 1, p) * 0.9;
  for (let i = 0; i < 3; i++) {
    const r = 8 + i * 8 + p * 16;
    const pts = arcPoints(0, 0, r, Math.PI * 0.55, Math.PI * 0.9, 20).map((q) => ({ x: q.x * 0.55 - 6, y: q.y }));
    brushStroke(frame, { pts, width: 2.8 - i * 0.4, grow: smoothstep(i * 0.06, i * 0.06 + 0.25, p), fade: Math.min(1, fade + i * 0.08), dry: 0.3, profile: (u) => Math.sin(u * Math.PI) * 0.8 + 0.2, seed: LAST.seed + 10 + i });
  }
  splatter(frame, f, 10, LAST.seed + 20, (i, r) => ({ x: -8, y: (r(1) - 0.5) * 12, vx: -(2 + 3 * r(2)), vy: (r(3) - 0.5) * 4, size: r(4) > 0.5 ? 1.4 : 0.8, life: 5, level: 5 }));
}

// -----------------------------------------------------------------------------
// 表
// -----------------------------------------------------------------------------

const FX = {
  skills: {
    contagion: {
      // 状態異常を写すだけ（攻撃の素性なし）なので無属性の墨
      ramp: "steel",
      // cast: pos = 写し元の敵。act: pos = 写し元、to = 写し先（胞子の筋を並べ、写し先に斑点）
      cast: { sheet: "skillExtraA.contagionSpores", life: 0.45, base: CONTAGION.radiusPx, ground: "skillExtraA.contagionBloom" },
      act: { sheet: "skillExtraA.contagionMark", life: 0.4, base: 0, pivot: "to", beam: { sheet: "skillExtraA.contagionTrail", step: CONTAGION.trailStep } },
    },
    unravel: {
      ramp: "steel",
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

const sheet = (name, dirs, frames, size, draw, extra = {}) => ({ key: `skillExtraA.${name}`, dirs, frames, active: 0, size, draw, ...extra });
/** beam の 1 区間（継ぎ目に墨の縁が出ないよう仕上げを掛けない） */
const BEAM = { ink: false };

export const ATLAS = {
  key: "skillExtraA",
  fx: FX,
  sheets: [
    sheet("contagionBloom", 1, 8, sizeOf(CONTAGION_R, 10), contagionBloom),
    sheet("contagionSpores", 1, 8, 112, contagionSpores),
    sheet("contagionTrail", 1, 7, 48, contagionTrail, BEAM),
    sheet("contagionMark", 1, 8, 72, contagionMark),
    sheet("unravelNeedle", DIRS, 6, 96, unravelNeedle),
    sheet("unravelFray", DIRS, 8, 136, unravelFray),
    sheet("kindleFlint", 1, 8, sizeOf(KINDLE_R, 10), kindleFlint),
    sheet("kindleBurst", 1, 9, sizeOf(KINDLE_B, 28), kindleBurst),
    sheet("kindleScorch", 1, 9, sizeOf(KINDLE_B, 8), kindleScorch),
    sheet("iceSmash", DIRS, 8, sizeOf(ICE_R, 28), iceSmash),
    sheet("iceCrack", DIRS, 8, sizeOf(ICE_R, 16), iceCrack),
    sheet("iceShatter", 1, 8, sizeOf(ICE_SH, 16), iceShatter),
    sheet("bloodRing", 1, 8, sizeOf(BLOOD_R, 8), bloodRing),
    sheet("bloodPull", 1, 8, sizeOf(BLOOD_R, 8), bloodPull),
    sheet("bloodSpurt", DIRS, 7, 72, bloodSpurt),
    sheet("bloodStream", 1, 7, 48, bloodStream, BEAM),
    sheet("bloodAbsorb", DIRS, 7, 56, bloodAbsorb),
    sheet("harvestSickle", DIRS, 8, 88, harvestSickle),
    sheet("harvestReap", DIRS, 9, 144, harvestReap),
    sheet("dischargeSpark", 1, 7, 72, dischargeSpark),
    sheet("dischargeBolt", 1, 6, 48, dischargeBolt, BEAM),
    sheet("dischargeGather", DIRS, 7, 72, dischargeGather),
    sheet("routDagger", DIRS, 4, 88, routDagger),
    sheet("routBreak", DIRS, 8, 120, routBreak),
    sheet("verdictSlash", DIRS, 8, sizeOf(VERDICT_R, 20), verdictSlash),
    sheet("verdictSeal", DIRS, 8, sizeOf(VERDICT_R, 8), verdictSeal),
    sheet("verdictPillar", 1, 8, 184, verdictPillar),
    sheet("exploitThrust", DIRS, 7, sizeOf(EXPLOIT_L, 16), exploitThrust),
    sheet("exploitPierce", DIRS, 8, 120, exploitPierce),
    sheet("stripHook", DIRS, 6, 80, stripHook),
    sheet("stripSnatch", DIRS, 7, 96, stripSnatch),
    sheet("stripDrain", 1, 7, 48, stripDrain, BEAM),
    sheet("stripGain", DIRS, 7, 88, stripGain),
    sheet("lastFlash", DIRS, 8, sizeOf(LAST_L, 16), lastFlash),
    sheet("lastWater", DIRS, 8, 96, lastWater),
  ],
};
