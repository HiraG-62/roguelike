// スキル石: 変身 8 種（docs/ideas/fx-sprites.md 10 章）。単位は絵のドット（論理 0.5px）。正準の向きは +x
// 纏い（aura）は自分の中心に向きなしで描く。体（半径 5px = 10 ドット）を覆わないよう、絵は体の外側に置き、段は控えめにする
//
// 剛の型（titanForm）: 「しばらく武器が大剣になる（変身の瞬間に周りを打つ）」。衝撃の半径 44px
// - 変身（cast）: 巨大な大剣が頭上から床へ突き立ち、地割れが走って岩の欠片が跳ねる（地面の層は放射の地割れと土煙の輪）
// - 纏い（aura）: 大剣の刀身の影が 1 本、体の周りをゆっくり巡る
// - 解除（end）: 刀身の影が砕けて欠片が落ちる
// 迅の型（swiftForm）: 「しばらく武器が双剣になる」。衝撃の半径 32px
// - 変身: 周りに X 字の斬線が次々と走る連撃と、速い風の輪
// - 纏い: 2 本の短剣が向かい合って体の周りを回り、短い風の尾を引く
// - 解除: 2 本の短剣が X に交差して火花で消える
// 霊の型（spiritForm）: 「しばらく武器が杖になる」。衝撃の半径 40px。光
// - 変身: 足元に六芒星と紋字の魔法陣が広がり（地面）、光の粒が立ち昇る（空中）
// - 纏い: 3 つの霊光の玉が尾を引いて巡り、足元に小さな紋の輪
// - 解除: 玉が外へ散って光点になる
// 狼化（wolfForm）: 「狼になる。攻撃 1 が噛みつき突進（出血）、攻撃 2 が遠吠え（恐怖）」
// - 変身: 3 本爪の爪痕が交差して 2 度走り、毛の房が弾ける
// - 纏い: 体の周りに逆立つたてがみ（外向きの毛の房）がさざめく
// - 遠吠え（act）: ぎざぎざの音の波が 3 重に広がる（半径 56px）
// - 解除: 毛の房が抜けて舞い落ちる
// 霊体化（wraithForm）: 「敵と敵弾をすり抜ける。解けたとき、すり抜けた敵すべてに出血」。闇
// - 変身: 体の輪郭が霧の筋になって立ち昇り、ほどける
// - 纏い: 間引いた霧の尾が体の周りを螺旋に巡って昇る
// - 解除: 霧の筋が外から体へ吸い込まれ、実体に戻る閃き
// 砲身化（siegeForm）: 「その場で構えて砲撃する。構え中は動けない」。真鍮
// - 構え（cast）: 四隅に杭が床へ打ち込まれ、割れ目と八角の台座が出る（地面）。杭から火花と蒸気（空中）
// - 纏い: 足元の八角の鉄の台座と四隅の杭（地面）、排気口から上がる小さな蒸気（空中）
// - 砲撃（act）: 砲口の炎と煙の輪、後ろへ噴く反動の煙（向きあり）
// - 砲弾（fly）: 鉄の砲丸と、後ろに引く煙の尾
// - 解除: 杭が抜け、ボルトが弾けて蒸気が噴く
// 鉄塊化（ironForm）: 「鉄の塊になる。被弾しても怯まず振りも止まらない」
// - 変身: 外から鉄板が体へ集まって閉じ、閉じた瞬間に火花が散る
// - 纏い: 鋲を打った鉄板 6 枚の殻が体の周りをゆっくり回る（隙間から体が見える）
// - 解除: 鉄板が外へ剥がれて落ちる
// 業火の化身（pyreForm）: 「近接と射撃が燃焼を付ける。気力が尽きると自分が燃えて解ける」。炎
// - 変身: 足元から炎の柱が噴き上がり（空中）、床に火の輪が広がる（地面）
// - 纏い: 体の縁から炎の舌がちらちら立ち昇り、火の粉が昇る。足元に熾火の輪
// - 解除: 炎が消えて煙と火の粉が昇る
import { arcLine, lens, ring, shards, streakLine } from "../shapes.mjs";
import { clamp01, dot, glint, hash1, paint, smoothstep, stamp, valueNoise } from "../raster.mjs";
import { DIRS } from "../motifs.mjs";

const TAU = Math.PI * 2;
/** 体の半径（ドット）。PLAYER.radius 5px */
const BODY = 10;
const SEED = 8101;

// ---------------------------------------------------------------------------
// 共通の部品
// ---------------------------------------------------------------------------

/** 多角形の内側か（偶奇則） */
function inPoly(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i];
    const b = pts[j];
    if (a[1] > y !== b[1] > y && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

/** 多角形を塗る。shade(x, y) が明るさ（0..1）。負なら塗らない */
function poly(frame, pts, shade) {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  paint(frame, (x, y) => (inPoly(x, y, pts) ? shade(x, y) : -1), {
    bounds: { x0: Math.min(...xs) - 1, y0: Math.min(...ys) - 1, x1: Math.max(...xs) + 1, y1: Math.max(...ys) + 1 },
    dither: 0,
  });
}

/** 点列を (cx, cy) を中心に a だけ回して (ox, oy) へ動かす */
function place(pts, a, ox, oy) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return pts.map(([x, y]) => [ox + x * c - y * s, oy + x * s + y * c]);
}

/** 塗りつぶしの小さな円 */
function disc(frame, x, y, r, level) {
  for (let dy = -r; dy <= r; dy += 0.5) {
    for (let dx = -r; dx <= r; dx += 0.5) {
      if (dx * dx + dy * dy <= r * r) dot(frame, x + dx, y + dy, level);
    }
  }
}

/** 間引いた円（霧・煙。市松の半分だけ塗って下が透ける） */
function puff(frame, x, y, r, level) {
  for (let dy = -r; dy <= r; dy += 1) {
    for (let dx = -r; dx <= r; dx += 1) {
      const d = Math.hypot(dx, dy);
      if (d > r) continue;
      const ix = Math.floor(x + dx);
      const iy = Math.floor(y + dy);
      if (((ix + iy) & 1) === 1 && d > r * 0.45) continue;
      dot(frame, x + dx, y + dy, d > r * 0.7 ? Math.max(1, level - 1) : level);
    }
  }
}

/** 岩・鉄の欠片（2x2 に影 1 ドット） */
function chunk(frame, x, y, level) {
  dot(frame, x, y, level);
  dot(frame, x + 1, y, level);
  dot(frame, x, y + 1, Math.max(1, level - 1));
  dot(frame, x + 1, y + 1, Math.max(1, level - 2));
}

/** 放射のぎざぎざの地割れ（中心から角 a へ len ドット） */
function crack(frame, a, from, len, seed, level) {
  let x = Math.cos(a) * from;
  let y = Math.sin(a) * from;
  let dir = a;
  for (let t = 0; t < len; t += 1) {
    dir = a + (hash1(Math.floor(t / 4), seed) - 0.5) * 0.9;
    x += Math.cos(dir);
    y += Math.sin(dir);
    dot(frame, x, y, t > len - 3 ? Math.max(2, level - 2) : level);
    if (t < len * 0.4) dot(frame, x + 0.5, y + 0.5, Math.max(1, level - 2));
  }
}

// ---------------------------------------------------------------------------
// 剛の型（大剣）
// ---------------------------------------------------------------------------

const TITAN = {
  /** 衝撃の半径（px）。SKILL.titanForm.radius */
  radiusPx: 44,
  seed: SEED + 100,
};
const TITAN_R = TITAN.radiusPx * 2;

/** 大剣の輪郭（切っ先が +x、柄頭が -x。長さ len、刀身の幅 w） */
function greatswordPts(len, w) {
  const hilt = len * 0.22;
  const guard = w * 1.9;
  return [
    [-len * 0.5, -w * 0.28],
    [-len * 0.5 + hilt, -w * 0.28],
    [-len * 0.5 + hilt, -guard / 2],
    [-len * 0.5 + hilt + w * 0.45, -guard / 2],
    [-len * 0.5 + hilt + w * 0.45, -w / 2],
    [len * 0.5 - w * 0.9, -w / 2],
    [len * 0.5, 0],
    [len * 0.5 - w * 0.9, w / 2],
    [-len * 0.5 + hilt + w * 0.45, w / 2],
    [-len * 0.5 + hilt + w * 0.45, guard / 2],
    [-len * 0.5 + hilt, guard / 2],
    [-len * 0.5 + hilt, w * 0.28],
    [-len * 0.5, w * 0.28],
  ];
}

/** 大剣を描く（刀身の中央線が白い芯、縁が明るく面は暗め） */
function greatsword(frame, ox, oy, a, len, w, bright) {
  const pts = place(greatswordPts(len, w), a, ox, oy);
  const c = Math.cos(a);
  const s = Math.sin(a);
  poly(frame, pts, (x, y) => {
    const lx = (x - ox) * c + (y - oy) * s;
    const ly = -(x - ox) * s + (y - oy) * c;
    const onBlade = lx > -len * 0.5 + len * 0.22 + w * 0.45;
    if (!onBlade) return 0.4 * bright;
    const q = Math.abs(ly) / (w / 2);
    if (q < 0.18) return clamp01(0.95 * bright);
    if (q > 0.72) return clamp01(0.7 * bright);
    return clamp01(0.45 * bright);
  });
}

/** 変身（空中）: 大剣が頭上から降って床に突き立ち、閃きと岩の欠片 */
function titanCast(frame, f) {
  const frames = 10;
  const p = (f + 0.5) / frames;
  const LEN = 70;
  const W = 14;
  // 切っ先を下（+y）に向けて降る。3 フレームで床（中心）に届く
  const fall = smoothstep(0, 0.3, p);
  const tipY = -26 + fall * 32;
  const fade = 1 - smoothstep(0.55, 1, p);
  if (fade > 0.1) {
    // 切っ先が床に刺さって見えるよう、中心より下は描かない
    greatsword(frame, 0, tipY - LEN / 2, Math.PI / 2, LEN, W, fade);
    paint(frame, (x, y) => (y > 4 && Math.abs(x) < W ? 0 : -1), { bounds: { x0: -W, y0: 4, x1: W, y1: 12 }, mode: "erase" });
  }
  if (p < 0.3) {
    // 降る筋
    for (let i = -2; i <= 2; i++) streakLine(frame, { ax: i * 5, ay: tipY - LEN - 20, bx: i * 5, by: tipY - LEN * 0.5, bright: 0.5 - Math.abs(i) * 0.1 });
  }
  if (p >= 0.3 && p < 0.55) glint(frame, 0, 2, 4);
  // 衝撃の輪
  if (p >= 0.3) {
    const q = (p - 0.3) / 0.7;
    ring(frame, { radius: TITAN_R * (0.3 + 0.7 * q), width: 5 - q * 3, squash: 1, bright: 0.8 * (1 - q), erosion: q * 0.7, seed: TITAN.seed + 1 });
  }
  // 岩の欠片: 突き立った瞬間から外へ弧を描いて跳ねる
  const age = f - 3;
  if (age >= 0) {
    for (let i = 0; i < 22; i++) {
      const r = (k) => hash1(i * 7 + k, TITAN.seed + 2);
      const a = r(1) * TAU;
      const sp = 5 + 6 * r(2);
      const t = age;
      const x = Math.cos(a) * (6 + sp * t);
      const y = Math.sin(a) * (6 + sp * t) * 0.8 - (7 + 4 * r(3)) * t + 1.2 * t * t;
      if (t > 5 + r(4) * 2) continue;
      const level = Math.max(2, 6 - Math.floor(t * 0.7));
      chunk(frame, x, y, level);
      chunk(frame, x + 1.5, y - 1, level - 1);
      if (r(5) > 0.5) chunk(frame, x - 1, y + 1.5, level - 1);
    }
  }
}

/** 変身（地面）: 突き立った所から放射の地割れが縁まで走り、土煙の輪が広がる */
function titanCastGround(frame, f) {
  const frames = 10;
  const p = (f + 0.5) / frames;
  if (p < 0.3) return;
  const q = (p - 0.3) / 0.7;
  const fade = 1 - smoothstep(0.6, 1, q);
  const level = Math.max(2, Math.round(2 + 3 * fade));
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * TAU + hash1(i, TITAN.seed + 3) * 0.4;
    const len = TITAN_R * (0.55 + 0.4 * hash1(i, TITAN.seed + 4)) * Math.min(1, q * 2.2);
    crack(frame, a, 4, len, TITAN.seed + 10 + i, level);
  }
  // 窪み: 刺さった所の小さな割れの輪
  ring(frame, { radius: 9, width: 2, bright: 0.45 * fade, erosion: 0.3, seed: TITAN.seed + 5 });
  // 土煙の輪（間引き）
  paint(
    frame,
    (x, y) => {
      const r = Math.hypot(x, y * 1.15);
      const at = TITAN_R * (0.5 + 0.5 * q);
      if (Math.abs(r - at) > 4) return -1;
      if (valueNoise(x, y, 4, TITAN.seed + 6) < 0.45 + q * 0.3) return -1;
      if (((Math.floor(x) + Math.floor(y)) & 1) === 1) return -1;
      return 0.35 * fade;
    },
    { bounds: { x0: -TITAN_R - 4, y0: -TITAN_R - 4, x1: TITAN_R + 4, y1: TITAN_R + 4 }, dither: 0 },
  );
}

const AURA_FRAMES = 12;

/** 纏い: 大剣の刀身の影が体の周りを 1 周巡る。切っ先は進む向き、後ろに土の粒が落ちる */
function titanAura(frame, f) {
  const p = f / AURA_FRAMES;
  const orbit = BODY + 12;
  const a = -Math.PI / 2 + p * TAU;
  const x = Math.cos(a) * orbit;
  const y = Math.sin(a) * orbit;
  // 刀身は接線（時計回りの進む向き）を向く
  greatsword(frame, x, y, a + Math.PI / 2, 26, 6, 0.72);
  arcLine(frame, { radius: orbit, from: a - 1.3, to: a - 0.45, bright: 0.4, width: 1 });
  for (let i = 0; i < 3; i++) {
    const b = a - 0.5 - i * 0.28;
    dot(frame, Math.cos(b) * (orbit + 2) , Math.sin(b) * (orbit + 2) + i * 1.5, 3);
  }
}

/** 解除: 刀身の影が砕けて欠片が落ちる */
function titanEnd(frame, f) {
  const frames = 8;
  const p = (f + 0.5) / frames;
  if (p < 0.25) greatsword(frame, 0, -BODY - 10, 0, 26, 6, 0.8);
  shards(frame, f, 14, TITAN.seed + 20, (i, r) => ({
    x: -13 + 26 * r(1),
    y: -BODY - 10 + (r(2) - 0.5) * 5,
    vx: (r(3) - 0.5) * 3,
    vy: -1.5 + 2 * r(4) + 0.5,
    drag: 1,
    life: 5 + Math.floor(3 * r(5)),
    size: 2,
  }));
  if (p < 0.35) glint(frame, 0, -BODY - 10, 2);
}

// ---------------------------------------------------------------------------
// 迅の型（双剣）
// ---------------------------------------------------------------------------

const SWIFT = {
  /** 衝撃の半径（px）。SKILL.swiftForm.radius */
  radiusPx: 32,
  seed: SEED + 200,
};
const SWIFT_R = SWIFT.radiusPx * 2;

/** 変身: 周りに X 字の斬線が次々と走り、速い風の輪が一周する */
function swiftCast(frame, f) {
  const frames = 8;
  const p = (f + 0.5) / frames;
  const cuts = 7;
  for (let i = 0; i < cuts; i++) {
    const born = (i / cuts) * 4.5;
    const age = f - born;
    if (age < 0 || age > 3.5) continue;
    const a = (i / cuts) * TAU + hash1(i, SWIFT.seed) * 0.5;
    const at = SWIFT_R * (0.45 + 0.35 * hash1(i, SWIFT.seed + 1));
    const cx = Math.cos(a) * at;
    const cy = Math.sin(a) * at;
    const half = 14;
    const grow = Math.min(1, (age + 1) / 1.5);
    const erosion = smoothstep(1.5, 3.5, age);
    // X の 2 本（1 本目が伸びきってから 2 本目）
    const t1 = a + Math.PI / 4;
    lens(frame, { ax: cx - Math.cos(t1) * half, ay: cy - Math.sin(t1) * half, bx: cx + Math.cos(t1) * half, by: cy + Math.sin(t1) * half, T: 4, bend: 2, grow, erosion, seed: SWIFT.seed + i, bright: 1 });
    if (age >= 0.8) {
      const t2 = a - Math.PI / 4;
      const g2 = Math.min(1, (age - 0.3) / 1.5);
      lens(frame, { ax: cx + Math.cos(t2) * half, ay: cy + Math.sin(t2) * half, bx: cx - Math.cos(t2) * half, by: cy - Math.sin(t2) * half, T: 4, bend: -2, grow: g2, erosion, seed: SWIFT.seed + 20 + i, bright: 1 });
    }
    if (age < 1.2) dot(frame, cx, cy, 7);
  }
  // 速い風の輪: 頭が一周半する細い弧
  const head = -Math.PI / 2 + p * TAU * 1.5;
  const fade = 1 - smoothstep(0.65, 1, p);
  arcLine(frame, { radius: SWIFT_R * 0.92, from: head - 1.6, to: head, bright: 0.7 * fade, width: 2 });
  arcLine(frame, { radius: SWIFT_R * 0.8, from: head - Math.PI - 1.1, to: head - Math.PI, bright: 0.55 * fade, width: 1 });
}

/** 短剣（切っ先が +x）。長さ len */
function dagger(frame, ox, oy, a, len, bright) {
  const w = 3.2;
  const pts = place(
    [
      [-len * 0.5, -1],
      [-len * 0.2, -1],
      [-len * 0.2, -w],
      [-len * 0.1, -w],
      [-len * 0.1, -w * 0.5],
      [len * 0.5, 0],
      [-len * 0.1, w * 0.5],
      [-len * 0.1, w],
      [-len * 0.2, w],
      [-len * 0.2, 1],
      [-len * 0.5, 1],
    ],
    a,
    ox,
    oy,
  );
  const c = Math.cos(a);
  const s = Math.sin(a);
  poly(frame, pts, (x, y) => {
    const lx = (x - ox) * c + (y - oy) * s;
    const ly = -(x - ox) * s + (y - oy) * c;
    if (lx < -len * 0.1) return 0.4 * bright;
    return clamp01((ly < 0 ? 0.95 : 0.6) * bright);
  });
}

/** 纏い: 2 本の短剣が向かい合って巡り、短い風の尾を引く（180° 対称なので半周で継ぎ目なく繰り返す） */
function swiftAura(frame, f) {
  const p = f / AURA_FRAMES;
  const orbit = BODY + 9;
  for (let k = 0; k < 2; k++) {
    const a = -Math.PI / 2 + p * Math.PI + k * Math.PI;
    const x = Math.cos(a) * orbit;
    const y = Math.sin(a) * orbit;
    dagger(frame, x, y, a + Math.PI / 2, 13, 0.8);
    arcLine(frame, { radius: orbit, from: a - 1.2, to: a - 0.3, bright: 0.5, width: 1 });
    arcLine(frame, { radius: orbit + 3, from: a - 0.9, to: a - 0.4, bright: 0.35, width: 1 });
  }
}

/** 解除: 2 本の短剣が頭上で X に交差し、火花で消える */
function swiftEnd(frame, f) {
  const frames = 7;
  const p = (f + 0.5) / frames;
  const cy = -BODY - 8;
  const close = smoothstep(0, 0.4, p);
  const fade = 1 - smoothstep(0.45, 1, p);
  if (fade > 0.15) {
    const spread = (1 - close) * 10;
    dagger(frame, -spread, cy, -Math.PI / 4 - Math.PI / 2 + close * 0, 13, fade);
    dagger(frame, spread, cy, -Math.PI / 4, 13, fade);
  }
  if (p > 0.35 && p < 0.7) glint(frame, 0, cy, 3);
  shards(frame, f - 3, 8, SWIFT.seed + 40, (i, r) => {
    const a = r(1) * TAU;
    return { x: 0, y: cy, vx: Math.cos(a) * (2 + 2 * r(2)), vy: Math.sin(a) * (2 + 2 * r(2)), life: 3, size: 1 };
  });
}

// ---------------------------------------------------------------------------
// 霊の型（杖）
// ---------------------------------------------------------------------------

const SPIRIT = {
  /** 衝撃の半径（px）。SKILL.spiritForm.radius */
  radiusPx: 40,
  seed: SEED + 300,
};
const SPIRIT_R = SPIRIT.radiusPx * 2;

/** 紋字（小さな 3x3 の記号）。輪に沿って並べる */
const RUNES = [
  ["6.6", ".6.", "6.6"],
  ["666", "6..", "666"],
  [".6.", "666", ".6."],
  ["6.6", "666", "..6"],
  ["66.", "6.6", ".66"],
];

/** 魔法陣: 2 重の輪・六芒星・紋字。reach（0..1）で広がり、spin で回り、bright で明るさ */
function magicCircle(frame, R, reach, spin, bright, seed) {
  const r1 = R * reach;
  const r2 = r1 * 0.8;
  ring(frame, { radius: r1, width: 2, bright: 0.9 * bright, seed });
  ring(frame, { radius: r2, width: 1.2, bright: 0.7 * bright, seed: seed + 1 });
  // 六芒星（2 つの三角形）
  for (let t = 0; t < 2; t++) {
    for (let k = 0; k < 3; k++) {
      const a0 = spin + t * Math.PI + (k / 3) * TAU - Math.PI / 2;
      const a1 = spin + t * Math.PI + ((k + 1) / 3) * TAU - Math.PI / 2;
      streakLine(frame, { ax: Math.cos(a0) * r2, ay: Math.sin(a0) * r2, bx: Math.cos(a1) * r2, by: Math.sin(a1) * r2, bright: 0.55 * bright });
    }
  }
  // 輪の間の紋字
  const count = Math.max(6, Math.round((TAU * (r1 + r2)) / 2 / 14));
  if (bright < 0.25) return;
  for (let i = 0; i < count; i++) {
    const a = -spin * 0.6 + (i / count) * TAU;
    const at = (r1 + r2) / 2;
    stamp(frame, Math.cos(a) * at, Math.sin(a) * at, RUNES[Math.floor(hash1(i, seed + 2) * RUNES.length)] ?? RUNES[0]);
  }
}

/** 変身（地面）: 足元から魔法陣が広がって回り、薄れる */
function spiritCastGround(frame, f) {
  const frames = 10;
  const p = (f + 0.5) / frames;
  const reach = 0.25 + 0.75 * smoothstep(0, 0.45, p);
  const fade = 1 - smoothstep(0.6, 1, p);
  magicCircle(frame, SPIRIT_R, reach, p * 0.8, fade, SPIRIT.seed);
}

/** 変身（空中）: 中心の閃きと、陣の上から立ち昇る光の粒 */
function spiritCast(frame, f) {
  const frames = 10;
  const p = (f + 0.5) / frames;
  if (p < 0.3) glint(frame, 0, 0, 4);
  for (let i = 0; i < 34; i++) {
    const r = (k) => hash1(i * 11 + k, SPIRIT.seed + 5);
    const born = r(1) * 5;
    const age = f - born;
    if (age < 0 || age > 5) continue;
    const a = r(2) * TAU;
    const at = SPIRIT_R * (0.3 + 0.65 * Math.sqrt(r(3)));
    const x = Math.cos(a) * at + Math.sin(age + i) * 1.5;
    const y = Math.sin(a) * at - age * (4 + 3 * r(4));
    if (i % 3 === 0 && age < 3) glint(frame, x, y, 2);
    else {
      stamp(frame, x, y, age < 2 ? ["67", "56"] : ["5"]);
      streakLine(frame, { ax: x, ay: y + 5, bx: x, by: y + 1, bright: 0.5 });
    }
  }
}

/** 纏い（空中）: 3 つの霊光の玉が尾を引いて巡る（120° 対称なので 1/3 周で継ぎ目なく繰り返す） */
function spiritAura(frame, f) {
  const p = f / AURA_FRAMES;
  const orbit = BODY + 9;
  for (let k = 0; k < 3; k++) {
    const a = -Math.PI / 2 + (p + k) * (TAU / 3);
    const bob = Math.sin((p + k / 3) * TAU) * 1.5;
    const x = Math.cos(a) * orbit;
    const y = Math.sin(a) * orbit * 0.85 + bob;
    arcLine(frame, { radius: orbit, from: a - 0.9, to: a - 0.15, bright: 0.45, width: 1 });
    stamp(frame, x, y, [".5.", "575", ".5."]);
  }
}

/** 纏い（地面）: 足元の小さな紋の輪がゆっくり回る */
function spiritAuraGround(frame, f) {
  const p = f / AURA_FRAMES;
  const R = BODY + 6;
  // 6 つの刻みの輪（60° 対称で 1/6 周）
  paint(
    frame,
    (x, y) => {
      const r = Math.hypot(x, y / 0.6);
      if (Math.abs(r - R) > 0.7) return -1;
      const a = Math.atan2(y / 0.6, x) - p * (TAU / 6);
      const k = (((a / TAU) * 6) % 1 + 1) % 1;
      if (k > 0.72) return -1;
      return 0.4;
    },
    { bounds: { x0: -R - 2, y0: -R, x1: R + 2, y1: R }, dither: 0 },
  );
  for (let i = 0; i < 6; i++) {
    const a = p * (TAU / 6) + (i / 6) * TAU + 0.62 * (TAU / 6);
    dot(frame, Math.cos(a) * R, Math.sin(a) * R * 0.6, 5);
  }
}

/** 解除: 玉が外へ散って光点になる */
function spiritEnd(frame, f) {
  const frames = 8;
  const p = (f + 0.5) / frames;
  for (let k = 0; k < 3; k++) {
    const a = -Math.PI / 2 + (k / 3) * TAU;
    const at = BODY + 9 + p * 26;
    const x = Math.cos(a) * at;
    const y = Math.sin(a) * at - p * 6;
    if (p < 0.55) stamp(frame, x, y, [".5.", "575", ".5."]);
    else glint(frame, x, y, p < 0.8 ? 2 : 1);
    streakLine(frame, { ax: Math.cos(a) * (at - 10), ay: Math.sin(a) * (at - 10) - p * 6, bx: x, by: y, bright: 0.5 * (1 - p) });
  }
}

// ---------------------------------------------------------------------------
// 狼化
// ---------------------------------------------------------------------------

const WOLF = {
  /** 遠吠えの半径（px）。SKILL.wolfForm.howlRadius */
  howlPx: 56,
  seed: SEED + 400,
};
const HOWL_R = WOLF.howlPx * 2;

/** 3 本爪の爪痕: 中心 (cx, cy)・向き a・長さ len。grow で伸び、erosion で崩れる */
function clawMarks(frame, cx, cy, a, len, grow, erosion, seed) {
  const nx = -Math.sin(a);
  const ny = Math.cos(a);
  const tx = Math.cos(a);
  const ty = Math.sin(a);
  for (let k = -1; k <= 1; k++) {
    const off = k * 7;
    const l = len * (k === 0 ? 1 : 0.85);
    const ox = cx + nx * off;
    const oy = cy + ny * off;
    lens(frame, { ax: ox - tx * l * 0.5, ay: oy - ty * l * 0.5, bx: ox + tx * l * 0.5, by: oy + ty * l * 0.5, T: 5, bend: 3, grow, erosion, seed: seed + k, bright: 1.05 });
  }
}

/** 毛の房（外向きの細い V）。根元 (x, y)・向き a・長さ len */
function tuft(frame, x, y, a, len, level) {
  for (let s = -1; s <= 1; s += 2) {
    const b = a + s * 0.22;
    for (let t = 0; t < len; t += 0.5) dot(frame, x + Math.cos(b) * t, y + Math.sin(b) * t, t > len - 1.5 ? level : Math.max(2, level - 2));
  }
  for (let t = 0; t < len * 1.2; t += 0.5) dot(frame, x + Math.cos(a) * t, y + Math.sin(a) * t, t > len * 0.6 ? level : Math.max(2, level - 1));
}

/** 変身: 爪痕が 2 度交差して走り、毛の房が弾ける */
function wolfCast(frame, f) {
  const frames = 9;
  // 1 本目（右上から左下）、2 本目（左上から右下）
  const marks = [
    { born: 0, a: Math.PI * 0.72 },
    { born: 2, a: Math.PI * 0.28 },
  ];
  for (const [i, m] of marks.entries()) {
    const age = f - m.born;
    if (age < 0) continue;
    const grow = Math.min(1, (age + 1) / 2);
    const erosion = smoothstep(2.5, 6.5, age);
    if (erosion >= 1) continue;
    clawMarks(frame, 0, 0, m.a, 52, grow, erosion, WOLF.seed + i * 5);
  }
  // 弾ける毛の房
  const age = f - 2;
  if (age >= 0) {
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU + hash1(i, WOLF.seed + 9) * 0.4;
      const at = BODY + 4 + age * (4 + 3 * hash1(i, WOLF.seed + 10));
      if (age > 5) continue;
      tuft(frame, Math.cos(a) * at, Math.sin(a) * at + age * age * 0.3, a, 5, Math.max(3, 6 - age));
    }
  }
  void frames;
}

/** 纏い: 体の周りに逆立つたてがみ。房の長さが角に沿って波打つ（1 周期で波がひと巡り） */
function wolfAura(frame, f) {
  const frames = 8;
  const p = f / frames;
  const n = 16;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    // 下側（足元）は薄く短く、上と横が逆立つ
    const up = 0.55 + 0.45 * Math.max(0, -Math.sin(a) * 0.6 + 0.4);
    const wave = 0.5 + 0.5 * Math.sin((i / n) * TAU * 2 - p * TAU);
    const len = (3 + 3.5 * wave) * up;
    const root = BODY + 2;
    tuft(frame, Math.cos(a) * root, Math.sin(a) * root, a - 0.15, len, wave > 0.7 ? 5 : 4);
  }
}

/** 遠吠え: ぎざぎざの音の波が 3 重に広がる。中心から短い叫びの筋 */
function wolfHowl(frame, f) {
  const frames = 10;
  const p = (f + 0.5) / frames;
  for (let k = 0; k < 3; k++) {
    const q = clamp01((p - k * 0.14) / 0.72);
    if (q <= 0 || q >= 1) continue;
    const at = HOWL_R * (0.12 + 0.88 * smoothstep(0, 1, q));
    const amp = 3 + 3 * (1 - q);
    const teeth = 36;
    const fade = 1 - smoothstep(0.55, 1, q);
    paint(
      frame,
      (x, y) => {
        const r = Math.hypot(x, y);
        const a = Math.atan2(y, x);
        const saw = Math.abs(((((a / TAU) * teeth) % 1) + 1) % 1 - 0.5) * 2;
        const rr = at + (saw - 0.5) * amp;
        const d = Math.abs(r - rr);
        const w = k === 0 ? 1.6 : 1.1;
        if (d > w) return -1;
        return clamp01((0.95 - k * 0.15) * fade * (1 - d / (w * 2)));
      },
      { bounds: { x0: -at - amp - 2, y0: -at - amp - 2, x1: at + amp + 2, y1: at + amp + 2 }, dither: 0 },
    );
  }
  // 叫びの筋（上向きの扇）
  if (p < 0.5) {
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + (i - 2) * 0.32;
      const r0 = BODY + 3 + p * 20;
      streakLine(frame, { ax: Math.cos(a) * r0, ay: Math.sin(a) * r0, bx: Math.cos(a) * (r0 + 10), by: Math.sin(a) * (r0 + 10), bright: 0.85 * (1 - p * 1.6), width: i === 2 ? 2 : 1 });
    }
  }
}

/** 解除: 毛の房が抜けて舞い落ちる */
function wolfEnd(frame, f) {
  const n = 12;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + hash1(i, WOLF.seed + 20) * 0.3;
    const at = BODY + 3 + f * 1.5;
    const x = Math.cos(a) * at + Math.sin(f * 0.8 + i) * 2;
    const y = Math.sin(a) * at + f * f * 0.35;
    if (f > 6) continue;
    tuft(frame, x, y, a + f * 0.3, 4, Math.max(2, 5 - Math.floor(f / 2)));
  }
}

// ---------------------------------------------------------------------------
// 霊体化
// ---------------------------------------------------------------------------

const WRAITH = { seed: SEED + 500 };

/** 霧の筋: 点列に沿って太さ w0 → 0 で細る尾。間引いて塗る */
function wisp(frame, pts, w0, level) {
  for (let i = 0; i < pts.length; i++) {
    const [x, y] = pts[i];
    const t = i / Math.max(1, pts.length - 1);
    const w = w0 * (1 - t) + 0.5;
    const lv = Math.max(2, Math.round(level - t * 2.5));
    if (w <= 1) dot(frame, x, y, lv);
    else puff(frame, x, y, w, lv);
  }
}

/** 螺旋の点列: 角 a0 から、半径 r0 で、上へ昇りながら戻る向きへ回る */
function spiralPts(a0, r0, turn, rise, n) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const a = a0 - turn * t;
    pts.push([Math.cos(a) * r0 * (1 + 0.15 * t), Math.sin(a) * r0 * 0.7 + rise * t]);
  }
  return pts;
}

/** 変身: 体の輪郭から霧の筋が立ち昇ってほどけ、輪郭の輪が崩れる */
function wraithCast(frame, f) {
  const frames = 10;
  const p = (f + 0.5) / frames;
  ring(frame, { radius: BODY + 1 + p * 8, width: 2.5, bright: 0.8 * (1 - p), erosion: 0.2 + p * 0.8, seed: WRAITH.seed });
  for (let i = 0; i < 10; i++) {
    const r = (k) => hash1(i * 7 + k, WRAITH.seed + 1);
    const a = (i / 10) * TAU + r(1) * 0.4;
    const x0 = Math.cos(a) * (BODY + 1);
    const y0 = Math.sin(a) * (BODY + 1);
    const rise = 6 + p * (22 + 14 * r(2));
    const sway = (r(3) - 0.5) * 12;
    const pts = [];
    const n = 10;
    for (let k = 0; k < n; k++) {
      const t = k / (n - 1);
      pts.push([x0 + Math.cos(a) * t * p * 10 + Math.sin(t * 4 + i) * sway * t, y0 - rise * t]);
    }
    // 根元（体の側）から先に消える
    const cut = Math.floor(smoothstep(0.35, 1, p) * n);
    wisp(frame, pts.slice(cut), 2.2 * (1 - p * 0.5), Math.max(3, 6 - Math.floor(p * 3)));
  }
}

/** 纏い: 霧の尾が 3 本、体の周りを螺旋に巡って昇る（120° 対称で 1/3 周） */
function wraithAura(frame, f) {
  const p = f / AURA_FRAMES;
  for (let k = 0; k < 3; k++) {
    const a0 = -Math.PI / 2 + (p + k) * (TAU / 3);
    const pts = spiralPts(a0, BODY + 5, 1.6, -10, 12);
    wisp(frame, pts, 2, 5);
  }
}

/** 解除: 外の霧が体へ吸い込まれ、実体に戻る閃き */
function wraithEnd(frame, f) {
  const frames = 8;
  const p = (f + 0.5) / frames;
  const inward = 1 - smoothstep(0, 0.6, p);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU + 0.3;
    const at = BODY + 2 + inward * 24;
    const pts = [];
    for (let k = 0; k < 8; k++) {
      const t = k / 7;
      const b = a + t * 0.8;
      pts.push([Math.cos(b) * (at + t * 10), Math.sin(b) * (at + t * 10)]);
    }
    if (p < 0.7) wisp(frame, pts, 1.8, 5);
  }
  if (p > 0.5 && p < 0.9) {
    glint(frame, 0, 0, 3);
    ring(frame, { radius: BODY + 2, width: 2, bright: 0.8, erosion: (p - 0.5) * 1.5, seed: WRAITH.seed + 3 });
  }
}

// ---------------------------------------------------------------------------
// 砲身化
// ---------------------------------------------------------------------------

const SIEGE = {
  /** 砲弾の半径（px）。SKILL.siegeForm.radius */
  shellPx: 4,
  seed: SEED + 600,
  /** 八角の台座の半径（ドット） */
  plate: BODY + 8,
};

/** 杭（床に刺さる楔）: 位置 (x, y)、刺さり具合 depth（0..1。1 で頭だけ見える） */
function stake(frame, x, y, depth, bright) {
  const h = 9 * (1 - depth) + 3;
  poly(
    frame,
    [
      [x - 2.5, y - h],
      [x + 2.5, y - h],
      [x + 1.5, y],
      [x - 1.5, y],
    ],
    (px) => clamp01((px < x ? 0.75 : 0.5) * bright),
  );
  // 杭の頭の平たい鋲
  for (let dx = -3; dx <= 3; dx += 0.5) dot(frame, x + dx, y - h, Math.round(4 + 2 * bright));
}

/** 八角の台座の輪郭と鋲。blink（0..1）でどの鋲が光るか */
function octPlate(frame, R, bright, blink) {
  const pts = [];
  for (let i = 0; i < 8; i++) {
    const a = Math.PI / 8 + (i / 8) * TAU;
    pts.push([Math.cos(a) * R, Math.sin(a) * R * 0.6]);
  }
  for (let i = 0; i < 8; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % 8];
    if (!a || !b) continue;
    streakLine(frame, { ax: a[0], ay: a[1], bx: b[0], by: b[1], bright: 0.55 * bright, width: 1.5 });
    const lit = blink !== undefined && Math.abs(((i / 8 - blink) % 1 + 1) % 1) < 0.13;
    dot(frame, a[0], a[1], lit ? 7 : Math.round(3 + 2 * bright));
  }
}

const STAKE_ANGLES = [Math.PI * 0.25, Math.PI * 0.75, Math.PI * 1.25, Math.PI * 1.75];

/** 構え（地面）: 四隅の杭が床へ打ち込まれ、割れ目が走り、八角の台座が浮かぶ */
function siegeCastGround(frame, f) {
  const frames = 8;
  const p = (f + 0.5) / frames;
  const drive = smoothstep(0, 0.4, p);
  const R = SIEGE.plate;
  octPlate(frame, R * (0.6 + 0.4 * drive), 0.6 + 0.4 * (1 - p), undefined);
  for (const [i, a] of STAKE_ANGLES.entries()) {
    const x = Math.cos(a) * (R + 3);
    const y = Math.sin(a) * (R + 3) * 0.6;
    if (p > 0.3) {
      for (let k = 0; k < 3; k++) crack(frame, a + (k - 1) * 0.5, 0, 6 + 5 * smoothstep(0.3, 0.8, p), SIEGE.seed + i * 3 + k, 4);
    }
    stake(frame, x, y, drive, 1);
  }
}

/** 構え（空中）: 杭が刺さった瞬間の火花と、噴き出す蒸気 */
function siegeCast(frame, f) {
  const R = SIEGE.plate;
  for (const [i, a] of STAKE_ANGLES.entries()) {
    const x = Math.cos(a) * (R + 3);
    const y = Math.sin(a) * (R + 3) * 0.6;
    shards(frame, f - 2, 5, SIEGE.seed + 10 + i, (k, r) => ({ x, y: y - 2, vx: (r(1) - 0.5) * 4, vy: -1.5 - 2 * r(2), life: 3, size: 1 }));
    if (f >= 2 && f <= 3) glint(frame, x, y - 2, 2);
    // 蒸気
    const age = f - 3;
    if (age >= 0 && age < 5) puff(frame, x + Math.cos(a) * age * 1.5, y - 3 - age * 2.5, 2 + age * 0.6, Math.max(2, 5 - age));
  }
}

/** 纏い（地面）: 八角の鉄の台座と四隅の杭。鋲の光が一周する */
function siegeAuraGround(frame, f) {
  const frames = 8;
  const R = SIEGE.plate;
  octPlate(frame, R, 0.75, f / frames);
  for (const a of STAKE_ANGLES) stake(frame, Math.cos(a) * (R + 3), Math.sin(a) * (R + 3) * 0.6, 1, 0.75);
}

/** 纏い（空中）: 背中の排気口から小さな蒸気が上がる */
function siegeAura(frame, f) {
  const frames = 8;
  for (let k = 0; k < 2; k++) {
    const x = k === 0 ? -6 : 6;
    const age = (f + k * 4) % frames;
    puff(frame, x + Math.sin(age * 0.7) * 1, -BODY - 2 - age * 2.2, 1 + age * 0.35, Math.max(2, 5 - Math.floor(age / 2)));
  }
}

/** 砲撃（向きあり。+x が撃つ向き）: 砲口の炎、転がる煙の輪、後ろへ噴く反動の煙 */
function siegeMuzzle(frame, f) {
  const frames = 7;
  const p = (f + 0.5) / frames;
  const mx = BODY + 2;
  if (p < 0.45) {
    const k = 1 - p / 0.45;
    // 前へ開く炎の円錐
    poly(
      frame,
      [
        [mx, -4],
        [mx + 10 + 18 * k, -10 * k - 2],
        [mx + 16 + 22 * k, 0],
        [mx + 10 + 18 * k, 10 * k + 2],
        [mx, 4],
      ],
      (x, y) => clamp01(1 - Math.abs(y) / 14 - (x - mx) / 70),
    );
    glint(frame, mx + 4, 0, 4);
  }
  // 煙の輪（前へ転がって広がる）
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU;
    const at = 4 + p * 10;
    puff(frame, mx + 10 + p * 22 + Math.cos(a) * at * 0.4, Math.sin(a) * at, 2 + p * 2.5, Math.max(2, Math.round(5 - p * 3)));
  }
  // 反動の煙（後ろへ）
  if (p > 0.15) {
    for (let s = -1; s <= 1; s += 2) puff(frame, -BODY - 2 - p * 12, s * (5 + p * 6), 2 + p * 2, Math.max(2, Math.round(4 - p * 2)));
  }
}

/** 砲弾（向きあり。+x が進む向き）: 鉄の砲丸、回る帯、後ろの煙の尾 */
function siegeShell(frame, f) {
  const frames = 4;
  const R = SIEGE.shellPx * 2;
  paint(
    frame,
    (x, y) => {
      const r = Math.hypot(x, y);
      if (r > R) return -1;
      // 左上の照り返し
      const hl = Math.hypot(x - R * 0.3, y + R * 0.35) / R;
      if (hl < 0.28) return 1;
      if (R - r < 1.2) return 0.3;
      return clamp01(0.62 - r / R * 0.3);
    },
    { bounds: { x0: -R - 1, y0: -R - 1, x1: R + 1, y1: R + 1 }, dither: 0 },
  );
  // 回る帯（進む向きに垂直の線がずれる）
  const bx = -R * 0.6 + ((f / frames) * R * 1.2);
  for (let y = -R + 1; y <= R - 1; y += 0.5) if (Math.hypot(bx, y) < R - 1) dot(frame, bx, y, 3);
  // 煙の尾
  for (let i = 0; i < 5; i++) {
    const x = -R - 3 - i * 5;
    const wob = Math.sin(i * 1.7 + f * 1.6) * 1.5;
    puff(frame, x, wob, 1.5 + i * 0.5, Math.max(2, 5 - i));
  }
}

/** 解除: 杭が抜けてボルトが弾け、蒸気が噴く */
function siegeEnd(frame, f) {
  const frames = 7;
  const p = (f + 0.5) / frames;
  const R = SIEGE.plate;
  for (const [i, a] of STAKE_ANGLES.entries()) {
    const x = Math.cos(a) * (R + 3);
    const y = Math.sin(a) * (R + 3) * 0.6;
    if (p < 0.6) stake(frame, x + Math.cos(a) * p * 8, y - p * 14, 0.5, 1 - p);
    shards(frame, f, 3, SIEGE.seed + 30 + i, (k, r) => ({ x, y: y - 2, vx: Math.cos(a) * (2 + 2 * r(1)), vy: -2 - 2 * r(2), drag: 0.95, life: 5, size: 2 }));
    puff(frame, x, y - 2 - f * 2.5, 2 + f * 0.6, Math.max(2, 5 - f));
  }
}

// ---------------------------------------------------------------------------
// 鉄塊化
// ---------------------------------------------------------------------------

const IRON = { seed: SEED + 700, plates: 6 };
const IRON_R = BODY + 5;

/** 鉄板 1 枚（厚い弧）: 中心の角 a・半径 r・幅（角）span・厚み t。bright で明るさ */
function ironPlate(frame, a, r, span, t, bright) {
  paint(
    frame,
    (x, y) => {
      const d = Math.hypot(x, y);
      if (d < r - t / 2 || d > r + t / 2) return -1;
      const da = Math.atan2(y, x) - a;
      const w = Math.atan2(Math.sin(da), Math.cos(da));
      if (Math.abs(w) > span / 2) return -1;
      // 外縁と左上を向く面が明るい（照り返し）
      const outer = d > r + t / 2 - 1;
      const edge = Math.abs(w) > span / 2 - 0.08;
      const lit = Math.cos(a + Math.PI * 0.75) > 0.3;
      if (edge) return clamp01(0.35 * bright);
      if (outer) return clamp01((lit ? 0.95 : 0.7) * bright);
      return clamp01((lit ? 0.6 : 0.45) * bright);
    },
    { bounds: { x0: -r - t, y0: -r - t, x1: r + t, y1: r + t }, dither: 0 },
  );
  // 鋲 2 つ
  for (const s of [-0.28, 0.28]) {
    const b = a + s * span;
    dot(frame, Math.cos(b) * r, Math.sin(b) * r, Math.round(2 + 4 * bright));
  }
}

const IRON_SPAN = (TAU / IRON.plates) * 0.62;

/** 変身: 外から鉄板が体へ集まって閉じ、閉じた瞬間に火花 */
function ironCast(frame, f) {
  const frames = 9;
  const p = (f + 0.5) / frames;
  const close = smoothstep(0, 0.45, p);
  const r = IRON_R + (1 - close) * 26;
  const spin = (1 - close) * 0.8;
  const fade = 1 - smoothstep(0.7, 1, p);
  for (let i = 0; i < IRON.plates; i++) {
    const a = (i / IRON.plates) * TAU + spin;
    ironPlate(frame, a, r, IRON_SPAN * (1 + 0.25 * close), 6, Math.max(0.3, fade));
    if (close < 0.95) streakLine(frame, { ax: Math.cos(a) * (r + 12), ay: Math.sin(a) * (r + 12), bx: Math.cos(a) * (r + 3), by: Math.sin(a) * (r + 3), bright: 0.5 });
  }
  // 閉じた瞬間（フレーム 4）の火花
  const age = f - 4;
  if (age >= 0) {
    if (age < 2) ring(frame, { radius: IRON_R + 3 + age * 5, width: 2, bright: 0.85 - age * 0.3 });
    shards(frame, age, 16, IRON.seed + 1, (i, rr) => {
      const a = ((i % IRON.plates) + 0.5) / IRON.plates * TAU;
      return { x: Math.cos(a) * IRON_R, y: Math.sin(a) * IRON_R, vx: Math.cos(a + (rr(1) - 0.5)) * (2.5 + 2 * rr(2)), vy: Math.sin(a + (rr(1) - 0.5)) * (2.5 + 2 * rr(2)) - 1, life: 3 + Math.floor(2 * rr(3)), size: 1 };
    });
  }
}

/** 纏い: 鋲を打った鉄板 6 枚の殻がゆっくり回る（60° 対称なので 1/6 周で継ぎ目なく繰り返す） */
function ironAura(frame, f) {
  const frames = 8;
  const p = f / frames;
  for (let i = 0; i < IRON.plates; i++) {
    const a = (i + p) / IRON.plates * TAU;
    ironPlate(frame, a, IRON_R, IRON_SPAN, 5, 0.62);
  }
}

/** 解除: 鉄板が外へ剥がれて落ちる */
function ironEnd(frame, f) {
  const frames = 8;
  const p = (f + 0.5) / frames;
  for (let i = 0; i < IRON.plates; i++) {
    const a = (i / IRON.plates) * TAU;
    const out = IRON_R + f * 3;
    const cx = Math.cos(a) * out;
    const cy = Math.sin(a) * out + f * f * 0.45;
    if (p > 0.9) continue;
    // 剥がれた板は小さな矩形の破片として回りながら落ちる
    const tilt = a + f * 0.5 * (i % 2 === 0 ? 1 : -1);
    const pts = place(
      [
        [-5, -2.5],
        [5, -2.5],
        [5, 2.5],
        [-5, 2.5],
      ],
      tilt + Math.PI / 2,
      cx,
      cy,
    );
    const bright = 1 - p * 0.6;
    poly(frame, pts, (x, y) => clamp01((y < cy ? 0.75 : 0.5) * bright));
    dot(frame, cx, cy, Math.round(3 + 3 * bright));
  }
  if (f < 2) glint(frame, 0, -IRON_R, 2);
}

// ---------------------------------------------------------------------------
// 業火の化身
// ---------------------------------------------------------------------------

const PYRE = { seed: SEED + 800 };

/** 炎の舌: 根元 (x, y) から上（-y）へ高さ h、根元の幅 w、先の揺れ sway */
function tongue(frame, x, y, h, w, sway, bright, seed) {
  paint(
    frame,
    (px, py) => {
      const v = (y - py) / h;
      if (v < 0 || v > 1) return -1;
      const cx = x + sway * v * v;
      const half = w * Math.pow(1 - v, 0.8) * (0.6 + 0.4 * Math.sin(Math.PI * Math.min(1, v * 2 + 0.3)));
      const d = Math.abs(px - cx);
      if (d > half) return -1;
      const n = valueNoise(px, py, 3, seed) * 0.25;
      return clamp01(((1 - d / Math.max(0.5, half)) * 0.55 + (1 - v) * 0.45 + n - 0.1) * bright);
    },
    { bounds: { x0: x - w - Math.abs(sway) - 1, y0: y - h - 1, x1: x + w + Math.abs(sway) + 1, y1: y + 1 }, dither: 0.06 },
  );
}

/** 変身（空中）: 足元から炎の柱が噴き上がって崩れ、火の粉が舞う */
function pyreCast(frame, f) {
  const frames = 10;
  const p = (f + 0.5) / frames;
  const rise = smoothstep(0, 0.35, p);
  const fade = 1 - smoothstep(0.5, 1, p);
  const H = 70 * rise;
  if (fade > 0.05) {
    for (let i = 0; i < 7; i++) {
      const x = (i - 3) * 6;
      const h = H * (0.7 + 0.3 * hash1(i + f * 5, PYRE.seed)) * (1 - Math.abs(i - 3) * 0.12);
      const sway = (hash1(i * 3 + f, PYRE.seed + 1) - 0.5) * 10;
      tongue(frame, x, 8, h, 9 - Math.abs(i - 3) * 1.5, sway, fade, PYRE.seed + f);
    }
  }
  for (let i = 0; i < 16; i++) {
    const r = (k) => hash1(i * 9 + k, PYRE.seed + 2);
    const born = r(1) * 5;
    const age = f - born;
    if (age < 0 || age > 5) continue;
    const x = (r(2) - 0.5) * 30 + Math.sin(age + i) * 3;
    const y = -H * r(3) - age * 6;
    dot(frame, x, y, Math.max(3, 7 - Math.floor(age)));
  }
}

/** 変身（地面）: 床に火の輪が広がる */
function pyreCastGround(frame, f) {
  const frames = 10;
  const p = (f + 0.5) / frames;
  const at = 8 + smoothstep(0, 0.6, p) * 24;
  const fade = 1 - smoothstep(0.55, 1, p);
  paint(
    frame,
    (x, y) => {
      const r = Math.hypot(x, y / 0.6);
      if (Math.abs(r - at) > 2.5) return -1;
      const n = valueNoise(x, y, 3, PYRE.seed + 4 + f);
      if (n < 0.3) return -1;
      return clamp01((0.35 + n * 0.5) * fade);
    },
    { bounds: { x0: -at - 4, y0: -at, x1: at + 4, y1: at }, dither: 0.05 },
  );
  // 輪の上に立つ小さな炎
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * TAU;
    tongue(frame, Math.cos(a) * at, Math.sin(a) * at * 0.6, 7 * fade, 2.5, 0, fade, PYRE.seed + 5 + i);
  }
}

/** 纏い（空中）: 体の縁から炎の舌がちらちら立ち昇り、火の粉が昇る */
function pyreAura(frame, f) {
  const frames = 8;
  const n = 7;
  for (let i = 0; i < n; i++) {
    // 左右と上に並べ、足元（下）は空ける
    const a = Math.PI * (0.95 + (i / (n - 1)) * 1.1);
    const x = Math.cos(a) * (BODY + 1);
    const y = Math.sin(a) * (BODY + 1) + 3;
    const flick = 0.5 + 0.5 * Math.sin((f / frames) * TAU * 2 + i * 2.1);
    const h = 5 + 5 * flick;
    tongue(frame, x, y, h, 2.2, Math.sin((f / frames) * TAU + i) * 2, 0.75, PYRE.seed + 10 + i * 7 + f);
  }
  for (let i = 0; i < 5; i++) {
    const phase = ((f / frames) + hash1(i, PYRE.seed + 20)) % 1;
    const x = (hash1(i, PYRE.seed + 21) - 0.5) * 22 + Math.sin(phase * TAU + i) * 1.5;
    const y = -BODY - phase * 18;
    if (phase < 0.85) dot(frame, x, y, phase < 0.4 ? 6 : 4);
  }
}

/** 纏い（地面）: 足元の熾火の輪（明滅する） */
function pyreAuraGround(frame, f) {
  const frames = 8;
  const R = BODY + 4;
  paint(
    frame,
    (x, y) => {
      const r = Math.hypot(x, y / 0.55);
      if (Math.abs(r - R) > 1.3) return -1;
      const a = Math.atan2(y / 0.55, x);
      const pulse = 0.5 + 0.5 * Math.sin(a * 5 + (f / frames) * TAU);
      if (((Math.floor(x) + Math.floor(y)) & 1) === 1 && pulse < 0.5) return -1;
      return clamp01(0.25 + 0.3 * pulse);
    },
    { bounds: { x0: -R - 2, y0: -R, x1: R + 2, y1: R }, dither: 0 },
  );
}

/** 解除: 炎がしぼんで消え、煙と火の粉が昇る */
function pyreEnd(frame, f) {
  const frames = 8;
  const p = (f + 0.5) / frames;
  if (p < 0.4) {
    for (let i = 0; i < 5; i++) {
      const a = Math.PI * (1 + (i / 4));
      tongue(frame, Math.cos(a) * (BODY + 1), Math.sin(a) * (BODY + 1) + 3, 8 * (1 - p * 2), 2.2, 0, 0.8, PYRE.seed + 30 + i);
    }
  }
  for (let i = 0; i < 5; i++) {
    const x = (i - 2) * 6 + Math.sin(f * 0.7 + i) * 2;
    const y = -BODY - f * 3 - hash1(i, PYRE.seed + 31) * 4;
    puff(frame, x, y, 2 + f * 0.5, Math.max(1, 3 - Math.floor(f / 3)));
  }
  shards(frame, f, 8, PYRE.seed + 32, (i, r) => ({ x: (r(1) - 0.5) * 20, y: -BODY, vx: (r(2) - 0.5) * 1.5, vy: -2 - 2 * r(3), drag: 0.92, life: 6, size: 1 }));
}

// ---------------------------------------------------------------------------
// 表
// ---------------------------------------------------------------------------

function sheetSize(radiusDots, pad) {
  return Math.ceil(radiusDots + pad) * 2;
}

/** 纏いの作業面（体の周り） */
const AURA_SIZE = 80;

/**
 * スキル → 絵（render/fxMotions.ts の SkillFx）。変身 8 種。
 * 纏い（aura）は拡縮しない（base 0）。変身の瞬間の衝撃（第 2 弾の 3 種）は半径 px を base に書き、size（衝撃の半径）で拡縮する
 */
const FX = {
  skills: {
    wolfForm: {
      ramp: "brass",
      cast: { sheet: "skillForm.wolfCast", life: 0.45, base: 0, pivot: "pos" },
      aura: { sheet: "skillForm.wolfAura", base: 0, period: 0.8 },
      act: { sheet: "skillForm.wolfHowl", life: 0.5, base: WOLF.howlPx, pivot: "pos" },
      end: { sheet: "skillForm.wolfEnd", life: 0.35, base: 0, pivot: "pos" },
    },
    wraithForm: {
      ramp: "dark",
      cast: { sheet: "skillForm.wraithCast", life: 0.5, base: 0, pivot: "pos" },
      aura: { sheet: "skillForm.wraithAura", base: 0, period: 1.5 },
      end: { sheet: "skillForm.wraithEnd", life: 0.4, base: 0, pivot: "pos" },
    },
    siegeForm: {
      ramp: "brass",
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
    { key: "skillForm.titanCast", dirs: 1, frames: 10, active: 0, size: sheetSize(TITAN_R, 12), draw: titanCast },
    { key: "skillForm.titanCastGround", dirs: 1, frames: 10, active: 0, size: sheetSize(TITAN_R, 8), draw: titanCastGround },
    { key: "skillForm.titanAura", dirs: 1, frames: AURA_FRAMES, active: 0, size: AURA_SIZE, draw: titanAura },
    { key: "skillForm.titanEnd", dirs: 1, frames: 8, active: 0, size: AURA_SIZE, draw: titanEnd },
    { key: "skillForm.swiftCast", dirs: 1, frames: 8, active: 0, size: sheetSize(SWIFT_R, 14), draw: swiftCast },
    { key: "skillForm.swiftAura", dirs: 1, frames: AURA_FRAMES, active: 0, size: AURA_SIZE, draw: swiftAura },
    { key: "skillForm.swiftEnd", dirs: 1, frames: 7, active: 0, size: AURA_SIZE, draw: swiftEnd },
    { key: "skillForm.spiritCast", dirs: 1, frames: 10, active: 0, size: sheetSize(SPIRIT_R, 10), draw: spiritCast },
    { key: "skillForm.spiritCastGround", dirs: 1, frames: 10, active: 0, size: sheetSize(SPIRIT_R, 6), draw: spiritCastGround },
    { key: "skillForm.spiritAura", dirs: 1, frames: AURA_FRAMES, active: 0, size: AURA_SIZE, draw: spiritAura },
    { key: "skillForm.spiritAuraGround", dirs: 1, frames: AURA_FRAMES, active: 0, size: AURA_SIZE, draw: spiritAuraGround },
    { key: "skillForm.spiritEnd", dirs: 1, frames: 8, active: 0, size: 120, draw: spiritEnd },
    { key: "skillForm.wolfCast", dirs: 1, frames: 9, active: 0, size: 120, draw: wolfCast },
    { key: "skillForm.wolfAura", dirs: 1, frames: 8, active: 0, size: AURA_SIZE, draw: wolfAura },
    { key: "skillForm.wolfHowl", dirs: 1, frames: 10, active: 0, size: sheetSize(HOWL_R, 8), draw: wolfHowl },
    { key: "skillForm.wolfEnd", dirs: 1, frames: 7, active: 0, size: AURA_SIZE, draw: wolfEnd },
    { key: "skillForm.wraithCast", dirs: 1, frames: 10, active: 0, size: 120, draw: wraithCast },
    { key: "skillForm.wraithAura", dirs: 1, frames: AURA_FRAMES, active: 0, size: AURA_SIZE, draw: wraithAura },
    { key: "skillForm.wraithEnd", dirs: 1, frames: 8, active: 0, size: 100, draw: wraithEnd },
    { key: "skillForm.siegeCast", dirs: 1, frames: 8, active: 0, size: AURA_SIZE, draw: siegeCast },
    { key: "skillForm.siegeCastGround", dirs: 1, frames: 8, active: 0, size: AURA_SIZE, draw: siegeCastGround },
    { key: "skillForm.siegeAura", dirs: 1, frames: 8, active: 0, size: AURA_SIZE, draw: siegeAura },
    { key: "skillForm.siegeAuraGround", dirs: 1, frames: 8, active: 0, size: AURA_SIZE, draw: siegeAuraGround },
    { key: "skillForm.siegeMuzzle", dirs: DIRS, frames: 7, active: 0, size: 120, draw: siegeMuzzle },
    { key: "skillForm.siegeShell", dirs: DIRS, frames: 4, active: 0, size: 72, draw: siegeShell },
    { key: "skillForm.siegeEnd", dirs: 1, frames: 7, active: 0, size: AURA_SIZE, draw: siegeEnd },
    { key: "skillForm.ironCast", dirs: 1, frames: 9, active: 0, size: 110, draw: ironCast },
    { key: "skillForm.ironAura", dirs: 1, frames: 8, active: 0, size: AURA_SIZE, draw: ironAura },
    { key: "skillForm.ironEnd", dirs: 1, frames: 8, active: 0, size: 100, draw: ironEnd },
    { key: "skillForm.pyreCast", dirs: 1, frames: 10, active: 0, size: 170, draw: pyreCast },
    { key: "skillForm.pyreCastGround", dirs: 1, frames: 10, active: 0, size: 90, draw: pyreCastGround },
    { key: "skillForm.pyreAura", dirs: 1, frames: 8, active: 0, size: AURA_SIZE, draw: pyreAura },
    { key: "skillForm.pyreAuraGround", dirs: 1, frames: 8, active: 0, size: AURA_SIZE, draw: pyreAuraGround },
    { key: "skillForm.pyreEnd", dirs: 1, frames: 8, active: 0, size: AURA_SIZE, draw: pyreEnd },
  ],
};

