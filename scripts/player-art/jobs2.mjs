// ジョブの衣装（剣士〜錬金術師）。共通の道具は jobs.mjs と body.mjs
import { DIR, Z, add, capsule, ellipse, mid, poly, pt, subtract, union } from "./body.mjs";

export const SKIN = {
  fair: [24, 0.5, 0.72],
  tan: [22, 0.45, 0.58],
  deep: [18, 0.38, 0.42],
  pale: [30, 0.25, 0.74],
};

const COMMON = {
  metal: { hsl: [215, 0.1, 0.62], opts: { step: 0.14 } },
  grip: [20, 0.35, 0.28],
  wood: [28, 0.4, 0.36],
};

export function common(B, skin) {
  B.colors(COMMON);
  B.color("skin", skin, { shift: 0.06, sat: 0.8 });
}

/** 頭巾（顔の窓を抜く）。tip で尖らせる */
export function hood(B, mat, opts = {}) {
  const { S, fig } = B;
  const h = S.head;
  const shapes = [ellipse(add(h, { x: -0.6, y: -0.4 }), fig.headRx + 1.6, fig.headRy + 1.3, -S.lean * 0.3)];
  if (opts.tip) {
    const sway = Math.sin(S.phase * Math.PI * 2) * 2 * S.speed;
    shapes.push(
      poly([
        add(h, { x: -fig.headRx * 0.2, y: -fig.headRy - 0.5 }),
        add(h, { x: -fig.headRx * 1.9 - S.speed * 2 - opts.tip, y: -fig.headRy * 0.4 + sway }),
        add(h, { x: -fig.headRx - 1, y: fig.headRy * 0.3 }),
      ]),
    );
  }
  const cowl = ellipse(add(S.neckBase, { x: -0.5, y: 0.6 }), fig.chestR + 1.4, 3.2, -S.lean);
  B.add("cowl", cowl, mat, Z.neck + 2, { group: "hoodG", R: 3 });
  B.add("hood", subtract(union(...shapes), B.faceWindow(opts.window ?? 1)), mat, Z.headgear, { group: "hoodG", R: fig.headRx + 1 });
  // 頭巾の内側の暗がり
  B.add("hoodIn", B.faceWindow((opts.window ?? 1) + 0.05), opts.inner ?? "shade", Z.headgear - 0.5, { group: "hoodG", flat: 1, noLine: true });
}

/** 兜。visor で顔を覆う */
function helmet(B, mat, opts = {}) {
  const { S, fig } = B;
  const h = S.head;
  let f = ellipse(add(h, { x: -0.2, y: -0.6 }), fig.headRx + 1.1, fig.headRy + 0.9);
  if (!opts.visor) f = subtract(f, B.faceWindow(0.95));
  B.add("helm", f, mat, Z.headgear, { group: "helmG", spec: true, R: fig.headRx + 1 });
  if (opts.visor) {
    const y = Math.round(h.y + fig.headRy * 0.05);
    for (let x = Math.round(h.x + fig.headRx * 0.05); x <= h.x + fig.headRx + 0.8; x += 1) B.mark(pt(x, y), opts.slit ?? "#0c0a12");
    if (opts.slitGlow) B.mark(pt(h.x + fig.headRx * 0.55, y), opts.slitGlow);
  }
  if (opts.crest) {
    const sway = Math.sin(S.phase * Math.PI * 2) * 3 * S.speed;
    const top = add(h, { x: 0, y: -fig.headRy - 1 });
    const k1 = add(top, DIR(-120 - S.speed * 10 + sway), fig.headRy * 1.1);
    const k2 = add(k1, DIR(-80 - S.speed * 12 + sway), fig.headRy * 1.1);
    B.add("crest", union(capsule(top, k1, 1.6, 1.8), capsule(k1, k2, 1.8, 0.7)), opts.crest, Z.headgear - 1, { group: "crestG", flat: 0.2 });
  }
  if (opts.brim) B.add("helmBrim", ellipse(add(h, { x: 0.3, y: -fig.headRy * 0.15 }), fig.headRx + 2, 1.1), mat, Z.headgear + 0.5, { group: "helmG", spec: true });
}

/** 縦長の盾（奥の腕が体の前に構える） */
function shield(B, matFace, matRim, emblem) {
  const { S, fig } = B;
  const c = { x: S.chest.x + fig.chestR + 2.5 + (S.armF.hand.x - S.chest.x) * 0.25, y: S.chest.y + fig.torso * 0.35 };
  const hw = fig.chestR + 0.8;
  const hh = fig.torso * 0.62;
  const top = add(c, { x: 0, y: -hh });
  const pts = [
    add(top, { x: -hw * 0.45, y: 0 }),
    add(top, { x: hw * 0.55, y: 0 }),
    add(c, { x: hw * 0.62, y: hh * 0.3 }),
    add(c, { x: 0.3, y: hh + 1.5 }),
    add(c, { x: -hw * 0.5, y: hh * 0.3 }),
  ];
  B.add("shieldRim", poly(pts), matRim, Z.front - 3, { group: "shieldG", spec: true, R: 3 });
  const inner = poly(pts.map((p) => ({ x: c.x + (p.x - c.x) * 0.72, y: c.y + (p.y - c.y) * 0.8 })));
  B.add("shieldFace", inner, matFace, Z.front - 2.5, { group: "shieldG", R: 3.5 });
  if (emblem) {
    const cross = union(
      capsule(add(c, { x: 0.2, y: -hh * 0.45 }), add(c, { x: 0.2, y: hh * 0.45 }), 0.7),
      capsule(add(c, { x: -hw * 0.28, y: -hh * 0.12 }), add(c, { x: hw * 0.32, y: -hh * 0.12 }), 0.7),
    );
    B.add("shieldEmblem", cross, emblem, Z.front - 2, { group: "shieldG", spec: true, noLine: true });
  }
}

/** 胴の前を開けた上着（胸の前を三角に抜く） */
function openCoat(B, mat, z = Z.torsoOver) {
  const { S, fig } = B;
  const cut = poly([add(S.neckBase, { x: 1, y: -2 }), add(S.waist, { x: fig.waistR + 3, y: 1 }), add(S.neckBase, { x: fig.chestR + 4, y: -2 })]);
  B.over("coatBody", mat, subtract(ellipse(S.chest, 99, 99), cut), z);
}

/** 剣士: 打刀。紅の長羽織・結った黒髪・片側の肩当て・白い帯 */
function swordsman(B) {
  common(B, SKIN.fair);
  B.colors({
    coat: [355, 0.55, 0.36],
    coatIn: [230, 0.25, 0.2],
    under: [220, 0.18, 0.24],
    hakama: [228, 0.22, 0.22],
    boots: [230, 0.12, 0.16],
    sash: [40, 0.18, 0.84],
    hair: [240, 0.18, 0.13],
    tie: [355, 0.7, 0.45],
    gold: [42, 0.65, 0.5],
    armor: { hsl: [220, 0.12, 0.34], opts: { step: 0.13 } },
  });
  const { fig } = B;
  B.body({ top: "under", bottom: "hakama", boots: "boots", sleeve: "coat", glove: "under", gloveLen: 0.45, bootH: 0.45 });
  B.hair("pony", "hair", { tie: "tie" });
  openCoat(B, "coat");
  B.tails("coat", fig.thigh + fig.shin * 0.45, { slit: 0.15, flare: 3 });
  B.tails("coatIn", fig.thigh * 0.9, { name: "tailsIn", z: Z.tails - 0.5, group: "tailsG", flare: 1, trail: 4, frontLen: 0.2 });
  B.belt("sash", 1.7, { buckle: B.mats.tie[2] });
  B.pauldron("armor", fig.armR[0] + 1.6);
  B.blade({ len: 19, w: 1.1, grip: 4.5, guard: 1.6, guardMat: "gold", curve: -1.6, single: true, taper: 6 });
}

/** 狩人: 弩。つば広の帽子と羽根・緑の外套・革の胸当て・背の矢筒 */
function hunter(B) {
  common(B, SKIN.tan);
  B.colors({
    mantle: [110, 0.22, 0.3],
    vest: [28, 0.4, 0.34],
    shirt: [45, 0.2, 0.55],
    pants: [45, 0.18, 0.36],
    boots: [24, 0.38, 0.26],
    hat: [30, 0.3, 0.3],
    feather: [8, 0.7, 0.5],
    hair: [30, 0.35, 0.3],
    strap: [26, 0.35, 0.22],
    fletch: [40, 0.2, 0.8],
  });
  const { S, fig } = B;
  const q0 = add(S.neckBase, { x: -fig.chestR - 0.5, y: -1 });
  const q1 = add(S.waist, { x: -fig.chestR + 0.5, y: 2 });
  B.add("quiver", capsule(q0, q1, 1.8, 1.5), "strap", Z.cape + 1, { group: "quiverG" });
  for (const dx of [-1.2, 0.3, 1.6]) {
    B.add(`arrow${dx}`, capsule(add(q0, { x: dx - 0.8, y: -1 }), add(q0, { x: dx - 1.6, y: -4 }), 0.7), "fletch", Z.cape + 0.5, { group: "quiverG" });
  }
  B.cape("mantle", fig.torso * 0.55, {});
  B.add("hoodDown", ellipse(add(S.neckBase, { x: -1.5, y: 0.2 }), fig.chestR + 0.8, 2.6, -S.lean), "mantle", Z.neck + 2, { group: "hoodG", R: 2.5 });
  B.body({ top: "shirt", bottom: "pants", boots: "boots", sleeve: "shirt", glove: "vest", gloveLen: 0.55, bootH: 0.8, bootCuff: "vest" });
  B.hair("short", "hair");
  B.over("vest", "vest", ellipse(add(S.chest, { x: 0, y: 1 }), fig.chestR + 1, fig.torso * 0.42), Z.torsoOver);
  B.scarf("mantle", 0);
  B.belt("strap", 1.2, { buckle: "#c8b070" });
  const s0 = add(S.neckBase, { x: 1.4, y: 1 });
  B.add("strap", subtract(capsule(s0, add(S.waist, { x: -fig.waistR, y: -1 }), 0.7), subtract(ellipse(S.chest, 99, 99), B.torsoF)), "strap", Z.chestOver, { group: "strapG", noLine: true });
  const h = S.head;
  B.add("hatBrim", ellipse(add(h, { x: 0.2, y: -fig.headRy * 0.35 }), fig.headRx + 3.4, 1.4, -S.lean * 0.3 - 6), "hat", Z.headgear + 0.5, { group: "hatG" });
  B.add("hatCrown", ellipse(add(h, { x: -0.6, y: -fig.headRy * 0.75 }), fig.headRx * 0.85, fig.headRy * 0.55), "hat", Z.headgear, { group: "hatG" });
  const fb = add(h, { x: -fig.headRx * 0.6, y: -fig.headRy * 0.8 });
  B.add("feather", capsule(fb, add(fb, DIR(-125 - S.speed * 10), fig.headRy * 1.3), 1.1, 0.4), "feather", Z.headgear - 0.5, { group: "featherG" });
  // 弩: 手から前へ台、先に弓
  const d = DIR(S.pose.windupBow ?? (S.weaponA > 150 ? 150 : 88));
  const n = { x: -d.y, y: d.x };
  const hand = S.armN.hand;
  B.add("stock", capsule(add(hand, d, -5), add(hand, d, 10), 1.3, 1.0), "wood", Z.weapon, { group: "weapon" });
  const bowC = add(hand, d, 8.5);
  const limbs = union(capsule(bowC, add(add(bowC, n, 6), d, -2.5), 0.9, 0.6), capsule(bowC, add(add(bowC, n, -6), d, -2.5), 0.9, 0.6));
  B.add("bow", limbs, "metal", Z.weapon + 0.5, { group: "weapon", spec: true });
}

/** 拳闘士: 籠手。袖なし・逆立つ赤髪・鉢巻の尾・腰の長い帯 */
function brawler(B) {
  common(B, SKIN.tan);
  B.colors({
    vest: [20, 0.42, 0.28],
    pants: [36, 0.16, 0.3],
    wrap: [34, 0.16, 0.52],
    sash: [5, 0.68, 0.44],
    hair: [16, 0.72, 0.46],
    band: [5, 0.68, 0.44],
    gauntlet: { hsl: [210, 0.12, 0.5], opts: { step: 0.13 } },
  });
  const { S, fig } = B;
  B.body({ top: "skin", bottom: "pants", boots: "wrap", bareArms: true, glove: "gauntlet", gloveLen: 0.55, bootH: 0.7 });
  B.over("vest", "vest", subtract(ellipse(S.chest, 99, 99), ellipse(add(S.chest, { x: fig.chestR * 0.9, y: 0 }), fig.chestR * 0.6, fig.torso * 0.45)), Z.torsoOver);
  B.hair("spiky", "hair");
  B.belt("sash", 2.1, {});
  B.tails("sash", fig.thigh * 0.8, { name: "sashTail", z: Z.belt + 0.5, group: "beltG", trail: 25, flare: 0, frontLen: 0.05 });
  const h = S.head;
  B.add("band", ellipse(add(h, { x: 0, y: -fig.headRy * 0.58 }), fig.headRx + 0.8, 1.1), "band", Z.hair + 1, { group: "bandG" });
  const root = add(h, { x: -fig.headRx - 0.4, y: -fig.headRy * 0.55 });
  const fl = Math.sin(S.phase * Math.PI * 4) * 6;
  const tails = union(capsule(root, add(root, DIR(-60 - S.speed * 15 + fl), 5), 0.9, 0.7), capsule(root, add(root, DIR(-80 - S.speed * 12 - fl), 6), 0.8, 0.5));
  B.add("bandTail", tails, "band", Z.hairBack, { group: "bandT", flat: 0.3 });
  for (const [side, A, z] of [
    ["N", S.armN, Z.gloveN + 0.5],
    ["F", S.armF, Z.gloveF + 0.5],
  ]) {
    B.add(`fist${side}`, ellipse(A.hand, fig.handR + 1.1, fig.handR + 0.9), "gauntlet", z, { group: `arm${side}`, spec: true, far: side === "F" });
  }
}

/** 盾持ち: 鉈と大盾。全身の板金・面頬つきの兜・青の陣羽織 */
function shieldBearer(B) {
  common(B, SKIN.fair);
  B.colors({
    plate: { hsl: [215, 0.12, 0.56], opts: { step: 0.14 } },
    dark: { hsl: [220, 0.12, 0.3], opts: { step: 0.12 } },
    tabard: [218, 0.55, 0.36],
    trim: [42, 0.6, 0.52],
    chain: [220, 0.08, 0.42],
    shieldFace: [218, 0.5, 0.32],
  });
  const { S, fig } = B;
  B.body({ top: "chain", bottom: "chain", boots: "plate", sleeve: "chain", glove: "plate", gloveLen: 0.6, bootH: 0.95, noFace: true, bootCuff: "dark" });
  B.over("breast", "plate", ellipse(add(S.chest, { x: 0.5, y: -0.5 }), fig.chestR + 1, fig.torso * 0.36), Z.torsoOver, { spec: true, grow: 0.8 });
  B.tails("tabard", fig.thigh * 0.95, { slit: 0.2, trail: 4, flare: 0.5, frontLen: 0.9 });
  B.belt("dark", 1.4, { buckle: B.mats.trim[3] });
  B.add("thighPlate", ellipse(mid(S.legN.hip, S.legN.knee, 0.55), fig.thighR[0] + 0.6, fig.thigh * 0.38, -S.legN.thighA), "plate", Z.tails + 1, { group: "legN", spec: true });
  B.add("knee", ellipse(S.legN.knee, fig.shinR[0] + 0.5, fig.shinR[0] + 0.3), "plate", Z.tails + 1.5, { group: "legN", spec: true });
  helmet(B, "plate", { visor: true, brim: true });
  B.pauldron("plate", fig.armR[0] + 2.2, { far: true });
  shield(B, "shieldFace", "plate", "trim");
  B.blade({ len: 11, w: 1.9, grip: 3, guard: 1.2, taper: 2, single: true });
}

/** 呪術師: 鎌。尖った頭巾で顔は闇、光る眼。裾の裂けた紫の衣・垂れる呪符 */
function hexer(B) {
  common(B, SKIN.pale);
  B.colors({
    robe: [282, 0.28, 0.24],
    robeIn: [282, 0.2, 0.16],
    shade: { hsl: [270, 0.3, 0.1], opts: { step: 0.02 } },
    paper: [48, 0.35, 0.78],
    ink: [0, 0.6, 0.35],
    bone: [45, 0.2, 0.75],
    glow: { hsl: [110, 0.9, 0.55], opts: { step: 0.1 } },
    wrap: [282, 0.1, 0.35],
  });
  const { S, fig } = B;
  B.cape("robeIn", fig.torso + fig.thigh, { ragged: true });
  B.body({ top: "robe", bottom: "wrap", boots: "wrap", sleeve: "robe", glove: "wrap", gloveLen: 0.2, bootH: 0.6, noFace: true });
  B.robe("robe", { ragged: true, slit: 0.35, hemUp: 4 });
  hood(B, "robe", { tip: 4, window: 0.9 });
  const h = S.head;
  const ey = h.y + fig.headRy * 0.15;
  B.mark(pt(h.x + fig.headRx * 0.45, ey), B.mats.glow[4], false);
  B.mark(pt(h.x + fig.headRx * 0.95, ey), B.mats.glow[3], false);
  B.belt("wrap", 1.4, {});
  for (const [dx, len] of [
    [-1.5, 6],
    [1.5, 4.5],
  ]) {
    const r = add(S.waist, { x: dx, y: 1 });
    const e = add(r, DIR(-10 - S.speed * 15 + dx * 3), len);
    B.add(`talisman${dx}`, capsule(r, e, 1.0), "paper", Z.belt + 1, { group: `tal${dx}`, flat: 0.8 });
    B.mark(mid(r, e, 0.6), B.mats.ink[2]);
  }
  B.add("beads", ellipse(add(S.neckBase, { x: 1.4, y: 2 }), 1.2, 1.2), "bone", Z.chestOver, { group: "beadG", spec: true });
  // 鎌
  const { top } = B.pole({ back: 4, front: 10, r: 0.85 });
  const a = S.weaponA;
  const c1 = add(top, DIR(a - 100), 4);
  const c2 = add(c1, DIR(a - 150), 4);
  B.add("sickle", union(capsule(top, c1, 1.3, 1.1), capsule(c1, c2, 1.1, 0.3)), "metal", Z.weapon, { group: "weapon", spec: true });
}

/** 槍兵: 槍。羽根飾りの半兜・青銅の胸甲・青緑の腰布と外套 */
function lancer(B) {
  common(B, SKIN.tan);
  B.colors({
    bronze: { hsl: [36, 0.5, 0.46], opts: { step: 0.13 } },
    cloth: [178, 0.4, 0.3],
    under: [30, 0.2, 0.28],
    plume: [2, 0.7, 0.46],
    hair: [28, 0.35, 0.22],
    boots: [26, 0.35, 0.24],
  });
  const { S, fig } = B;
  B.cape("cloth", fig.torso * 1.1 + fig.pelvis, {});
  B.body({ top: "under", bottom: "under", boots: "boots", sleeve: "under", glove: "bronze", gloveLen: 0.55, bootH: 0.8, bootCuff: "bronze" });
  B.hair("short", "hair");
  B.over("cuirass", "bronze", ellipse(add(S.chest, { x: 0.3, y: 0.5 }), fig.chestR + 1, fig.torso * 0.45), Z.torsoOver, { spec: true, grow: 0.7 });
  B.tails("cloth", fig.thigh * 0.75, { trail: 6, flare: 0.5, frontLen: 0.95 });
  B.belt("bronze", 1.2, {});
  helmet(B, "bronze", { crest: "plume" });
  B.pauldron("bronze", fig.armR[0] + 1.4);
  const { top, d, n } = B.pole({ back: 12, front: 20, r: 0.85 });
  const tip = add(top, d, 7);
  B.add("spearHead", poly([add(top, n, 1.8), tip, add(top, n, -1.8), add(top, d, -1.2)]), "metal", Z.weapon + 0.5, { group: "weapon", spec: true });
  B.add("tassel", capsule(add(top, d, -1.5), add(add(top, d, -3), DIR(-20), 3.5), 0.9, 0.5), "plume", Z.weapon + 0.3, { group: "weapon2" });
}

/** 術士: 短杖。高い襟の長衣・銀の長髪・額の宝冠・手元に浮く紋 */
function invoker(B) {
  common(B, SKIN.fair);
  B.colors({
    robe: [222, 0.3, 0.5],
    robeIn: [228, 0.4, 0.3],
    trim: [44, 0.68, 0.52],
    hair: [215, 0.14, 0.7],
    boots: [228, 0.3, 0.24],
    gem: { hsl: [190, 0.9, 0.58], opts: { step: 0.1 } },
    rune: { hsl: [190, 0.9, 0.64], opts: { step: 0.08 } },
  });
  const { S, fig } = B;
  B.hair("long", "hair");
  B.body({ top: "robe", bottom: "robeIn", boots: "boots", sleeve: "robe", glove: "robe", gloveLen: 0, bootH: 0.5 });
  B.robe("robe", { slit: 0.25, hemUp: 2, backMax: 4 });
  B.tails("robeIn", fig.thigh * 0.95, { name: "robeBack", z: Z.tails - 1, trail: 8, flare: 1, frontLen: 0.1 });
  B.belt("trim", 1.1, {});
  const nb = S.neckBase;
  const collar = poly([add(nb, { x: -fig.neckR - 1.8, y: 1.5 }), add(nb, { x: -fig.neckR - 1.2, y: -fig.neck - 2.5 }), add(nb, { x: fig.neckR + 0.5, y: -0.5 }), add(nb, { x: fig.neckR + 1.5, y: 2 })]);
  B.add("collar", collar, "robeIn", Z.hair + 0.8, { group: "collarG" });
  B.add("collarTrim", capsule(add(nb, { x: -fig.neckR - 1.6, y: 1.5 }), add(nb, { x: -fig.neckR - 1.2, y: -fig.neck - 2.3 }), 0.6), "trim", Z.hair + 0.9, { group: "collarG", noLine: true });
  const h = S.head;
  B.add("circlet", ellipse(add(h, { x: 0.3, y: -fig.headRy * 0.4 }), fig.headRx + 0.6, 0.7), "trim", Z.hair + 1, { group: "circG", spec: true });
  B.mark(add(h, { x: fig.headRx * 0.75, y: -fig.headRy * 0.42 }), B.mats.gem[4], false);
  const { top } = B.pole({ back: 2, front: 8, r: 0.8, shaftMat: "trim" });
  B.add("gem", ellipse(top, 1.6, 1.6), "gem", Z.weapon + 1, { group: "weapon", emissive: true, emissiveLevel: 3 });
  B.mark(add(top, { x: -0.5, y: -0.5 }), B.mats.gem[4]);
  const rc = add(S.armF.hand, { x: 3, y: -3 + Math.sin(S.phase * Math.PI * 2) });
  B.add("rune", subtract(ellipse(rc, 2.2, 2.2), ellipse(rc, 1.1, 1.1)), "rune", Z.front, { group: "runeG", emissive: true, emissiveLevel: 2, noLine: true });
}

/** 影: 二振りの短刀。黒の装束・口元の覆面・長くなびく紅の襟巻 */
function shadow(B) {
  common(B, SKIN.fair);
  B.colors({
    suit: [250, 0.16, 0.2],
    suitHi: [250, 0.14, 0.28],
    scarf: [352, 0.7, 0.4],
    scarfDark: [352, 0.45, 0.28],
    wrap: [250, 0.1, 0.36],
    hair: [250, 0.2, 0.14],
    metal2: { hsl: [215, 0.12, 0.66], opts: { step: 0.15 } },
  });
  const { S, fig } = B;
  B.scarf("scarf", fig.torso * 1.5, { double: true });
  B.body({ top: "suit", bottom: "suit", boots: "wrap", sleeve: "suit", glove: "wrap", gloveLen: 0.6, bootH: 0.7, noMouth: true, brow: "#0c0a12" });
  B.hair("short", "hair");
  const h = S.head;
  const mask = poly([add(h, { x: -fig.headRx * 0.3, y: fig.headRy * 0.5 }), add(h, { x: fig.headRx + 1, y: fig.headRy * 0.42 }), add(h, { x: fig.headRx * 0.8, y: fig.headRy + 1 }), add(h, { x: -fig.headRx * 0.2, y: fig.headRy + 1 })]);
  B.add("mask", mask, "suitHi", Z.hair + 1, { group: "maskG" });
  B.over("chestWrap", "suitHi", poly([add(S.neckBase, { x: 2, y: 0 }), add(S.waist, { x: -fig.waistR, y: 0 }), add(S.waist, { x: 0, y: 0 })]), Z.torsoOver);
  B.belt("wrap", 1.2, { buckle: B.mats.scarf[3] });
  B.blade({ len: 8, w: 1.1, grip: 2.5, guard: 1, taper: 2, mat: "metal2" });
  const before = B.parts.length;
  B.blade({ hand: S.armF.hand, a: S.weaponA + 150, len: 7, w: 1.0, grip: 2.5, taper: 2, mat: "metal2" });
  // 奥の短刀は奥の腕の高さへ
  for (const p of B.parts.slice(before)) {
    p.z = Z.gloveF - 0.5;
    p.far = true;
    p.group = "weaponF";
  }
}

/** 錬金術師: 杖。額のゴーグル・革の前掛け・腰の光る薬瓶・丈の長い上着 */
function alchemist(B) {
  common(B, SKIN.fair);
  B.colors({
    coat: [165, 0.2, 0.32],
    shirt: [40, 0.25, 0.7],
    apron: [28, 0.45, 0.34],
    pants: [30, 0.15, 0.28],
    boots: [24, 0.35, 0.22],
    hair: [32, 0.55, 0.42],
    brass: { hsl: [42, 0.55, 0.48], opts: { step: 0.13 } },
    lens: { hsl: [175, 0.7, 0.55], opts: { step: 0.1 } },
    vialG: { hsl: [100, 0.85, 0.55], opts: { step: 0.1 } },
    vialP: { hsl: [300, 0.75, 0.6], opts: { step: 0.1 } },
  });
  const { S, fig } = B;
  B.body({ top: "shirt", bottom: "pants", boots: "boots", sleeve: "coat", glove: "apron", gloveLen: 0.5, bootH: 0.6 });
  B.hair("messy", "hair");
  openCoat(B, "coat");
  B.tails("coat", fig.thigh + fig.shin * 0.3, { slit: 0.1, flare: 2.5, trail: 12 });
  B.tails("apron", fig.thigh * 0.85, { name: "apron", z: Z.tails + 1, trail: 0, flare: -2, frontLen: 1.0, frontA: 4 });
  B.over("bib", "apron", ellipse(add(S.chest, { x: fig.chestR * 0.6, y: 1 }), fig.chestR * 0.7, fig.torso * 0.4), Z.chestOver);
  B.belt("apron", 1.3, { buckle: B.mats.brass[3], z: Z.tails + 2 });
  for (const [m, dx] of [
    ["vialG", -fig.waistR + 0.5],
    ["vialP", -fig.waistR - 2.5],
  ]) {
    const c = add(S.waist, { x: dx, y: 2.5 });
    B.add(`${m}Glass`, ellipse(c, 1.2, 1.7), m, Z.tails + 3, { group: `${m}G`, emissive: true, emissiveLevel: 3 });
    B.mark(add(c, { x: -0.4, y: -0.6 }), B.mats[m][4]);
  }
  const h = S.head;
  const gc = add(h, { x: fig.headRx * 0.3, y: -fig.headRy * 0.55 });
  B.add("goggleBand", ellipse(add(h, { x: 0, y: -fig.headRy * 0.5 }), fig.headRx + 0.9, 1.0), "apron", Z.hair + 1, { group: "gogG" });
  B.add("goggle", ellipse(gc, 1.9, 1.6), "brass", Z.hair + 1.5, { group: "gogG", spec: true });
  B.add("lens", ellipse(gc, 1.0, 0.9), "lens", Z.hair + 1.6, { group: "gogG", emissive: true, emissiveLevel: 3, noLine: true });
  const { top } = B.pole({ back: 12, front: 12, r: 0.9 });
  B.add("flaskCage", ellipse(top, 2.4, 2.4), "brass", Z.weapon + 0.5, { group: "weapon", spec: true });
  B.add("flask", ellipse(top, 1.5, 1.5), "vialG", Z.weapon + 1, { group: "weapon", emissive: true, emissiveLevel: 3 });
}

const POSE_OVERRIDES = {};
/** ジョブごとの姿勢の上書き（武器の構え方が違うもの） */
const AIM = {
  windup: { lean: -2, headTilt: 2, armN: { a: 78, b: 4 }, armF: { a: 60, b: 30 }, weaponA: 90, shiftX: 0 },
  strike: { lean: -8, headTilt: 4, legN: { t: 30, k: 20 }, legF: { t: -30, k: 8, toe: 30 }, armN: { a: 66, b: 10 }, armF: { a: 48, b: 34 }, weaponA: 96, shiftX: -2 },
};
const PUNCH = {
  windup: { armN: { a: -70, b: 118 }, armF: { a: 50, b: 70 }, lean: -4 },
  strike: { armN: { a: 88, b: 0 }, armF: { a: -40, b: 100 } },
};
const THRUST = {
  windup: { armN: { a: -50, b: 70 }, armF: { a: 60, b: 20 }, weaponA: 96, lean: -6 },
  strike: { armN: { a: 86, b: 0 }, armF: { a: 70, b: 10 }, weaponA: 92, lean: 22 },
  idle0: { weaponA: 172, armN: { a: 20, b: 60 } },
  idle1: { weaponA: 174, armN: { a: 22, b: 62 } },
};
const CAST = {
  windup: { armN: { a: 150, b: 10 }, weaponA: 175, armF: { a: 60, b: 20 } },
  strike: { armN: { a: 88, b: 0 }, armF: { a: 80, b: 0 }, weaponA: 90 },
};
for (const [fn, p] of [["hunter", AIM], ["brawler", PUNCH], ["lancer", THRUST], ["invoker", CAST], ["alchemist", CAST]]) POSE_OVERRIDES[fn] = p;

export const MORE_JOBS = [
  { key: "swordsman", name: "剣士", concept: "紅の長羽織と結った黒髪。片側の肩当てと白い帯、反りのある打刀", draw: swordsman, poses: POSE_OVERRIDES.swordsman },
  { key: "hunter", name: "狩人", concept: "つば広の帽子に赤い羽根、緑の外套、革の胸当て、背に矢筒。弩を構える", draw: hunter, poses: POSE_OVERRIDES.hunter },
  { key: "brawler", name: "拳闘士", concept: "袖なしの胴着、逆立つ赤髪、鉢巻と腰帯の尾がなびく。両手に大きな籠手", draw: brawler, poses: POSE_OVERRIDES.brawler },
  { key: "shieldBearer", name: "盾持ち", concept: "全身の板金と面頬の兜、青の陣羽織。大盾を前に、鉈を手に", draw: shieldBearer, poses: POSE_OVERRIDES.shieldBearer },
  { key: "hexer", name: "呪術師", concept: "尖った頭巾の奥は闇と光る眼。裾の裂けた紫の衣と腰の呪符、骨の飾り、鎌", draw: hexer, poses: POSE_OVERRIDES.hexer },
  { key: "lancer", name: "槍兵", concept: "赤い羽根飾りの兜、青銅の胸甲、青緑の外套と腰布。房つきの長槍", draw: lancer, poses: POSE_OVERRIDES.lancer },
  { key: "invoker", name: "術士", concept: "高い襟の青白い長衣に金の縁、銀の長髪と額の宝冠。短杖の宝玉と手元に浮く紋", draw: invoker, poses: POSE_OVERRIDES.invoker },
  { key: "shadow", name: "影", concept: "黒の装束と口元の覆面、長くなびく紅の襟巻。二振りの短刀", draw: shadow, poses: POSE_OVERRIDES.shadow },
  { key: "alchemist", name: "錬金術師", concept: "額のゴーグル、丈の長い上着に革の前掛け、腰に光る薬瓶。フラスコを戴く杖", draw: alchemist, poses: POSE_OVERRIDES.alchemist },
];
