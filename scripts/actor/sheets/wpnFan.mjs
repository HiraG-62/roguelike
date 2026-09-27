// 扇子（鉄扇）: 鉄の親骨と骨に、朱の紙を張った開いた扇。要（留め具）は拳の後ろ、紙は折り目ごとに明暗が割れ、
// 外周に金の縁。片側（上）へ開くので刃のある武器として写しの絵も持つ（振る向きで開く側が入れ替わる）
import { capsule, ellipse, paint, polygon } from "../paint.mjs";
import { CLOTH_RED, DARK_STEEL, GOLD, weaponSheets } from "../weapon.mjs";

const DEG = Math.PI / 180;
/** 要（骨の集まる点）。握りの少し後ろ */
const PIVOT_X = -3;
/** 開いた角（+x = 0、負 = 上）。上へ大きく、下へ少しだけ開く */
const OPEN_FROM = -80 * DEG;
const OPEN_TO = 14 * DEG;
/** 紙の張ってある範囲（要からの半径）と外周の金の縁。体より大きく見えないよう半径 19 ドットに留める */
const LEAF_IN = 8;
const LEAF_OUT = 19;
const RIM_IN = 17.2;
/** 折り目の数（紙の面） */
const PLEATS = 7;
/** 朱の紙（暗・基・明・艶）。鉄の骨と金の縁の間で識別色になる */
const LACQUER = ["#3c1219", "#6e1f28", "#9c3036", "#c65446"];

function polar(x, y) {
  const dx = x - PIVOT_X;
  return { r: Math.hypot(dx, y), a: Math.atan2(y, dx) };
}

function inOpen(a) {
  return a >= OPEN_FROM && a <= OPEN_TO;
}

/** 折り目の面: 面ごとに円周方向へ交互に傾け、谷と山で明暗を割る */
function pleatNormal(a, k = 0.5) {
  const t = (a - OPEN_FROM) / (OPEN_TO - OPEN_FROM);
  const i = Math.floor(t * PLEATS);
  const s = i % 2 === 0 ? k : -k;
  return { nx: -Math.sin(a) * s, ny: Math.cos(a) * s };
}

function ribAngle(i) {
  return OPEN_FROM + ((OPEN_TO - OPEN_FROM) * i) / PLEATS;
}

function at(a, r) {
  return [PIVOT_X + Math.cos(a) * r, Math.sin(a) * r];
}

function draw(frame) {
  // 骨の間（紙より内側）: 黒鉄の地に骨を並べる
  paint(
    frame,
    (x, y) => {
      const p = polar(x, y);
      if (p.r < 3 || p.r > LEAF_IN + 0.5 || !inOpen(p.a)) return null;
      return pleatNormal(p.a, 0.3);
    },
    DARK_STEEL,
    { maxShade: 1 },
  );
  for (let i = 1; i < PLEATS; i++) {
    const [x, y] = at(ribAngle(i), LEAF_IN);
    paint(frame, capsule(PIVOT_X, 0, x, y, 0.55), DARK_STEEL, { minShade: 2, rim: false });
  }
  // 紙: 折り目ごとの明暗
  paint(
    frame,
    (x, y) => {
      const p = polar(x, y);
      if (p.r < LEAF_IN || p.r > RIM_IN || !inOpen(p.a)) return null;
      return pleatNormal(p.a);
    },
    LACQUER,
    { maxShade: 2 },
  );
  // 紙の模様: 金の三日月（折り目をまたいで 1 本の弧）
  paint(
    frame,
    (x, y) => {
      const p = polar(x, y);
      if (!inOpen(p.a) || p.a < -62 * DEG || p.a > -8 * DEG) return null;
      return Math.abs(p.r - 13) < 0.6 ? { nx: 0, ny: -0.3 } : null;
    },
    GOLD,
    { rim: false, maxShade: 2 },
  );
  // 外周の金の縁（波打つ扇の縁）
  paint(
    frame,
    (x, y) => {
      const p = polar(x, y);
      if (!inOpen(p.a)) return null;
      const t = (p.a - OPEN_FROM) / (OPEN_TO - OPEN_FROM);
      const scallop = Math.abs(Math.sin(t * PLEATS * Math.PI)) * 0.9;
      if (p.r < RIM_IN || p.r > LEAF_OUT - scallop) return null;
      return { nx: Math.cos(p.a) * 0.6, ny: Math.sin(p.a) * 0.6 };
    },
    GOLD,
  );
  // 親骨（両端の太い鉄の骨）と先の鋲
  for (const a of [OPEN_FROM, OPEN_TO]) {
    const [x, y] = at(a, LEAF_OUT + 0.5);
    paint(frame, capsule(PIVOT_X, 0, x, y, 1.5, 1.1), DARK_STEEL);
    const [sx, sy] = at(a, LEAF_OUT - 2.2);
    paint(frame, ellipse(sx, sy, 0.9, 0.9), GOLD, { rim: false });
    const [mx, my] = at(a, LEAF_IN);
    paint(frame, ellipse(mx, my, 0.9, 0.9), GOLD, { rim: false });
  }
  // 房（要から後ろへ垂れる）
  paint(frame, capsule(PIVOT_X - 1, 0.5, PIVOT_X - 4, 3, 0.6), GOLD, { rim: false });
  paint(frame, polygon([[PIVOT_X - 3.5, 2], [PIVOT_X - 2.5, 3], [PIVOT_X - 5, 8], [PIVOT_X - 7.5, 7]], { round: 1 }), LACQUER);
  // 要（金の留め具）
  paint(frame, ellipse(PIVOT_X, 0, 2.2, 2.2), GOLD, { bias: 0.2 });
}

export const ATLAS = {
  key: "wpnFan",
  sheets: weaponSheets("wpnFan", draw, { size: 56, edge: true }),
  meta: { offGrip: null, stance: { grip: "one", body: "light", restDeg: -40, restHand: [7, 7], restMirror: true, swayDeg: 5 } },
};
