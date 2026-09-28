// 体・服・髪・武器の部品を組む道具。ジョブの衣装（jobs.mjs）はこれを呼んで部品を積む
import { capsule, clamp, ellipse, grow, intersect, poly, ramp, subtract, union } from "./engine.mjs";
import { add, dirDown, mid, pt } from "./rig.mjs";

/** z の目安（小さいほど奥） */
export const Z = {
  backFar: 0,
  cape: 2,
  hairBack: 4,
  armF: 10,
  gloveF: 12,
  shieldF: 13,
  legF: 15,
  bootF: 16,
  torso: 20,
  torsoOver: 22,
  pelvis: 23,
  legN: 30,
  bootN: 31,
  tails: 34,
  belt: 36,
  chestOver: 37,
  neck: 40,
  head: 42,
  hair: 44,
  headgear: 46,
  weapon: 49,
  armN: 50,
  gloveN: 52,
  pauldron: 53,
  front: 56,
};

export class Builder {
  constructor(S, style) {
    this.S = S;
    this.fig = S.fig;
    this.style = style;
    this.parts = [];
    this.marks = [];
    this.mats = {};
  }

  /** 色を [色相, 彩度, 明度] から作る。style の彩度・刻みを掛ける */
  color(name, hsl, opts = {}) {
    // 5 色の段を直接渡したとき（素材から拾った色）はそのまま使う
    if (typeof hsl[0] === "string") {
      this.mats[name] = hsl;
      return hsl;
    }
    const [h, s, l] = hsl;
    const ro = this.style.ramp;
    this.mats[name] = ramp(h, s, l, { step: opts.step ?? ro.step, sat: (opts.sat ?? 1) * ro.sat, shift: ro.shift });
    return this.mats[name];
  }

  colors(table) {
    for (const [k, v] of Object.entries(table)) this.color(k, v.hsl ?? v, v.opts ?? {});
  }

  add(name, f, mat, z, opts = {}) {
    const m = typeof mat === "string" ? this.mats[mat] : mat;
    if (!m) throw new Error(`色が無い: ${mat}`);
    this.parts.push({ name, f, mat: m, z, group: opts.group ?? name, ...opts });
  }

  mark(p, color, onlyOn = true) {
    this.marks.push({ x: p.x, y: p.y, color, onlyOn });
  }

  /** a → b の線上に色を置く。onPart の部品の上だけ */
  line(a, b, color, onPart, opts = {}) {
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y)));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      if (opts.from && t < opts.from) continue;
      if (opts.to && t > opts.to) continue;
      if (opts.dash && i % opts.dash === opts.dash - 1) continue;
      this.marks.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, color, onPart: onPart ? [].concat(onPart) : undefined, onlyOn: true });
    }
  }

  /** a → b の線上の画素を、その部品の段で shift だけずらす（しわ・髪の筋・艶） */
  shade(a, b, shift, onPart, opts = {}) {
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y)));
    const seen = new Set();
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      if (opts.from && t < opts.from) continue;
      if (opts.to && t > opts.to) continue;
      // 曲げ: 中央で法線方向へ bend だけふくらむ
      const bend = (opts.bend ?? 0) * Math.sin(t * Math.PI);
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const x = Math.round(a.x + dx * t + (-dy / len) * bend);
      const y = Math.round(a.y + dy * t + (dx / len) * bend);
      const key = x * 1000 + y;
      if (seen.has(key)) continue;
      seen.add(key);
      this.marks.push({ x, y, shift, onPart: [].concat(onPart), onlyOn: true });
    }
  }

  // -------------------------------------------------------------------------
  // 体
  // -------------------------------------------------------------------------

  /**
   * 基本の体。c = { skin, top, bottom, boots, sleeve?, glove?, bootH?, gloveLen?, neck?, bareArms? }
   */
  body(c) {
    const { S, fig } = this;
    const up = S.up;
    // 首
    this.add("neck", capsule(S.neckBase, add(S.head, up, -fig.headRy * 0.4), fig.neckR, fig.neckR * 0.9), c.neck ?? "skin", Z.neck, { noLine: true });
    // 頭
    const h = S.head;
    const jaw = ellipse(add(h, { x: fig.headRx * 0.3, y: fig.headRy * 0.5 }), fig.headRx * 0.62, fig.headRy * 0.5, -S.lean * 0.3);
    const nose = ellipse(add(h, { x: fig.headRx * 0.95, y: fig.headRy * 0.25 }), 0.9, 1.0);
    this.add("head", union(ellipse(h, fig.headRx, fig.headRy * 0.94, -S.lean * 0.3), jaw, nose), "skin", Z.head, { noRim: true, group: "headG", R: fig.headRx * 1.1, lumBias: this.style.faceLight ?? 0.22, flat: 0.2 });
    // 胴
    const top = add(S.neckBase, up, -1.2);
    const chestC = add(S.chest, { x: 0.9, y: 0 });
    const torso = union(capsule(top, S.waist, fig.chestR, fig.waistR), ellipse(chestC, fig.chestR * 0.95, fig.torso * 0.32, -S.lean));
    this.torsoF = torso;
    this.add("torso", torso, c.top, Z.torso, { group: "bodyG" });
    // 腰
    const pelvisC = add(S.hip, up, 1.2);
    const pelvis = ellipse(pelvisC, fig.hipR, fig.pelvis * 0.8 + 1.2, -S.lean * 0.5);
    this.pelvisF = pelvis;
    this.add("pelvis", pelvis, c.bottom, Z.pelvis, { group: "bodyG" });
    // 脚
    this.leg("F", S.legF, c, true);
    this.leg("N", S.legN, c, false);
    // 腕
    this.arm("F", S.armF, c, true);
    this.arm("N", S.armN, c, false);
    if (!c.noEar) this.add("ear", ellipse(add(h, { x: -fig.headRx * 0.12, y: fig.headRy * 0.18 }), 1.0, 1.5), "skin", Z.hair + 0.3, { group: "earG", lumBias: 0.1 });
    this.face(c);
  }

  leg(side, L, c, far) {
    const { fig } = this;
    const z = far ? Z.legF : Z.legN;
    const group = `leg${side}`;
    const thigh = capsule(L.hip, L.knee, fig.thighR[0], fig.thighR[1]);
    const shin = capsule(L.knee, L.ankle, fig.shinR[0], fig.shinR[1]);
    this.add(`thigh${side}`, union(thigh, shin), c.bottom, z, { group, far, R: fig.thighR[0] * 1.1 });
    const bootH = c.bootH ?? 0.55;
    const bootTop = mid(L.ankle, L.knee, bootH);
    const foot = capsule(L.heel, L.toe, fig.footR, fig.footR * 0.85);
    const boot = union(capsule(bootTop, L.ankle, fig.shinR[1] + 0.55, fig.shinR[1] + 0.35), foot);
    this.add(`boot${side}`, boot, c.boots, z + 1, { group, far, R: fig.shinR[1] + 1 });
    if (c.bootCuff) {
      this.add(`cuff${side}`, capsule(bootTop, mid(L.ankle, L.knee, bootH - 0.12), fig.shinR[1] + 0.95), c.bootCuff, z + 1.5, { group, far });
    }
  }

  arm(side, A, c, far) {
    const { fig } = this;
    const z = far ? Z.armF : Z.armN;
    const group = `arm${side}`;
    // 肩の丸み（三角筋）: 腕の付け根を少し太く
    const upper = union(capsule(A.sh, A.elbow, fig.armR[0], fig.armR[1]), ellipse(add(A.sh, { x: -0.2, y: 0.6 }), fig.armR[0] + 0.7, fig.armR[0] + 0.4));
    const fore = capsule(A.elbow, A.wrist, fig.foreR[0], fig.foreR[1]);
    if (c.bareArms) {
      this.add(`arm${side}`, union(upper, fore), "skin", z, { noRim: true, group, far, R: fig.armR[0] * 1.1 });
      if (c.sleeve) this.add(`sleeve${side}`, capsule(A.sh, mid(A.sh, A.elbow, c.sleeveLen ?? 0.45), fig.armR[0] + 0.5, fig.armR[1] + 0.4), c.sleeve, z + 0.5, { group, far });
    } else if (c.rolled) {
      // 捲った袖: 前腕の途中まで袖、折り返しの帯、その先は素肌
      this.add(`arm${side}`, union(upper, fore), "skin", z, { noRim: true, group, far, R: fig.armR[0] * 1.1 });
      const end = mid(A.elbow, A.wrist, c.rolled);
      this.add(`sleeve${side}`, union(upper, capsule(A.elbow, end, fig.foreR[0] + 0.35, fig.foreR[0] + 0.3)), c.sleeve ?? c.top, z + 0.5, { group, far, R: fig.armR[0] * 1.1 });
      const band0 = mid(A.elbow, A.wrist, c.rolled - 0.14);
      this.add(`cuff${side}`, capsule(band0, end, fig.foreR[0] + 0.75), c.cuff ?? c.sleeve, z + 0.8, { group, far });
    } else {
      this.add(`arm${side}`, union(upper, fore), c.sleeve ?? c.top, z, { group, far, R: fig.armR[0] * 1.1 });
    }
    const gloveLen = c.gloveLen ?? 0.3;
    const cuff = mid(A.wrist, A.elbow, gloveLen);
    const hand = ellipse(A.hand, fig.handR, fig.handR * 0.95);
    const glove = gloveLen > 0 ? union(capsule(cuff, A.wrist, fig.foreR[1] + 0.45, fig.foreR[1] + 0.35), hand) : hand;
    this.add(`glove${side}`, glove, c.glove ?? "skin", z + 2, { group, far });
  }

  /** 顔: 右向き 3/4。手前の眼と、奥の眼の端 */
  face(c) {
    const { S, fig } = this;
    const eyeC = c.eye ?? this.style.eye;
    const h = S.head;
    const big = this.style.bigEyes;
    const ex = h.x + fig.headRx * 0.42;
    const ey = h.y + fig.headRy * 0.12;
    if (c.noFace) return;
    this.mark(pt(ex, ey), eyeC);
    this.mark(pt(ex, ey + 1), eyeC);
    if (big) {
      this.mark(pt(ex - 1, ey), eyeC);
      this.mark(pt(ex - 1, ey + 1), eyeC);
      this.mark(pt(ex, ey), this.style.eyeGlint);
    }
    // 奥の眼（顔の輪郭の手前 1 列）
    const fx = h.x + fig.headRx * 0.92;
    this.mark(pt(fx, ey), eyeC);
    if (big) this.mark(pt(fx, ey + 1), eyeC);
    // 眉
    if (c.brow) {
      this.mark(pt(ex - (big ? 1 : 0), ey - 2), c.brow);
      this.mark(pt(ex + 1, ey - 2), c.brow);
    }
    // 口元の影（鼻の下を 1 点）
    if (!c.noMouth) this.mark(pt(h.x + fig.headRx * 0.62, h.y + fig.headRy * 0.62), this.mats.skin[1]);
  }

  /** 顔の窓（頭巾・兜の切り抜き） */
  faceWindow(scale = 1) {
    const { S, fig } = this;
    return ellipse(add(S.head, { x: fig.headRx * 0.62, y: fig.headRy * 0.28 }), fig.headRx * 0.78 * scale, fig.headRy * 0.72 * scale);
  }

  // -------------------------------------------------------------------------
  // 髪
  // -------------------------------------------------------------------------

  hair(kind, mat, opts = {}) {
    const { S, fig } = this;
    const h = S.head;
    const rx = fig.headRx;
    const ry = fig.headRy;
    const sway = Math.sin(S.phase * Math.PI * 2) * 6 * (S.speed || 0.4);
    const cap = subtract(
      ellipse(add(h, { x: -0.5, y: -ry * 0.18 }), rx + 0.9, ry * 0.92 + 0.3),
      union(ellipse(add(h, { x: rx * 0.55, y: ry * 0.5 }), rx * 0.78, ry * 0.72), poly([pt(h.x - rx * 0.1, h.y + ry * 0.25), pt(h.x + rx * 2, h.y + ry * 0.05), pt(h.x + rx * 2, h.y + ry * 2)])),
    );
    const shapes = [cap];
    // 前髪
    const bangs = poly([pt(h.x + rx * 0.1, h.y - ry * 0.95), pt(h.x + rx * 1.05, h.y - ry * 0.45), pt(h.x + rx * 0.95, h.y - ry * 0.05), pt(h.x + rx * 0.55, h.y - ry * 0.3), pt(h.x + rx * 0.3, h.y + ry * 0.05)]);
    shapes.push(bangs);
    if (kind === "spiky") {
      const spikes = [
        [-0.2, -1.1, -1.2, -1.9],
        [-0.8, -0.7, -2.1, -1.2],
        [-1.0, -0.1, -2.2, -0.2],
        [0.4, -1.0, 0.5, -1.8],
      ];
      for (const [ax, ay, bx, by] of spikes) {
        shapes.push(poly([pt(h.x + rx * ax - 1.8, h.y + ry * ay + 1), pt(h.x + rx * bx, h.y + ry * by), pt(h.x + rx * ax + 1.8, h.y + ry * ay + 0.5)]));
      }
    }
    if (kind === "short" || kind === "messy") {
      shapes.push(poly([pt(h.x - rx * 0.8, h.y - ry * 0.2), pt(h.x - rx * 1.35, h.y + ry * 0.5), pt(h.x - rx * 0.5, h.y + ry * 0.35)]));
      if (kind === "messy") {
        shapes.push(poly([pt(h.x - rx * 0.5, h.y - ry * 0.8), pt(h.x - rx * 1.2, h.y - ry * 1.05), pt(h.x - rx * 0.1, h.y - ry * 1.0)]));
        shapes.push(poly([pt(h.x - rx * 1.0, h.y - ry * 0.3), pt(h.x - rx * 1.55, h.y - ry * 0.35), pt(h.x - rx * 0.9, h.y + ry * 0.1)]));
      }
    }
    if (kind === "wild") {
      // 無造作な黒髪（素材の主人公）: 量の多い後頭部、跳ねた房、目にかかる前髪、襟足
      const sw = sway * 0.35;
      const tufts = [
        // [根元 x, y, 先 x, y, 太さ]（頭の半径で）
        [-0.2, -0.95, -0.9, -1.55, 2.2],
        [0.35, -0.95, 0.2, -1.5, 1.8],
        [-0.75, -0.7, -1.75, -1.1, 2.2],
        [-1.0, -0.2, -2.0, -0.15, 2.2],
        [-0.95, 0.3, -1.75, 0.75, 2.0],
        [-0.6, 0.55, -1.15, 1.25, 1.8],
        [0.8, -0.7, 1.35, -0.85, 1.4],
      ];
      for (const [ax, ay, bx, by, wd] of tufts) {
        const a = pt(h.x + rx * ax, h.y + ry * ay);
        const tip = pt(h.x + rx * bx + (bx < 0 ? sw : 0), h.y + ry * by);
        const dx = tip.x - a.x;
        const dy = tip.y - a.y;
        const L = Math.hypot(dx, dy) || 1;
        const nx = (-dy / L) * wd;
        const ny = (dx / L) * wd;
        shapes.push(poly([pt(a.x + nx, a.y + ny), tip, pt(a.x - nx, a.y - ny)]));
      }
      // 目にかかる前髪（先の尖った房を 3 本）
      for (const [x0, len] of [
        [0.15, 1.0],
        [0.5, 1.15],
        [0.85, 0.85],
      ]) {
        const root = pt(h.x + rx * x0, h.y - ry * 0.7);
        shapes.push(poly([pt(root.x - 1.4, root.y), pt(root.x + 1.1, root.y - 0.4), pt(root.x + 0.9 + len * 0.6, root.y + ry * len * 0.52)]));
      }
    }
    if (kind === "pony" || kind === "long") {
      const root = add(h, { x: -rx * 0.9, y: -ry * 0.35 });
      if (kind === "pony") {
        const tipA = -58 + sway;
        const k1 = add(root, dirDown(tipA), fig.headRy * 1.2);
        const k2 = add(k1, dirDown(tipA + 12 + sway * 0.5), fig.headRy * 1.1);
        this.add("hairTail", union(capsule(root, k1, 1.9, 1.6), capsule(k1, k2, 1.6, 0.6)), mat, Z.hairBack, { group: "hairG", spec: true });
        this.add("hairTie", ellipse(root, 1.3, 1.3), opts.tie ?? mat, Z.hair + 0.5, { group: "hairG" });
      } else {
        const back = poly([pt(h.x - rx * 0.4, h.y - ry * 0.6), pt(h.x - rx * 1.25, h.y), pt(h.x - rx * 1.4 - sway * 0.15, h.y + ry * 1.9), pt(h.x - rx * 0.3, h.y + ry * 1.6), pt(h.x + rx * 0.1, h.y + ry * 0.4)]);
        this.add("hairBack", back, mat, Z.hairBack, { group: "hairG", spec: true });
      }
    }
    this.add("hair", union(...shapes), mat, Z.hair, { group: "headG2", spec: true, R: rx });
    // 髪の筋（つむじから後ろ下へ）と、左上の艶の弧
    if (!opts.noStrands) {
      const crown = pt(h.x + rx * 0.2, h.y - ry * 0.95);
      this.shade(crown, pt(h.x - rx * 0.9, h.y + ry * 0.1), -1, "hair", { bend: -1.2, from: 0.25 });
      this.shade(pt(h.x + rx * 0.5, h.y - ry * 0.8), pt(h.x - rx * 0.3, h.y + ry * 0.2), -1, "hair", { bend: -0.8, from: 0.35 });
      this.shade(pt(h.x + rx * 0.7, h.y - ry * 0.55), pt(h.x + rx * 0.6, h.y - ry * 0.05), -1, "hair", { from: 0.2 });
      this.shade(pt(h.x - rx * 0.6, h.y - ry * 0.55), pt(h.x + rx * 0.1, h.y - ry * 0.85), 1, "hair", { bend: 0.6 });
    }
  }

  // -------------------------------------------------------------------------
  // 布
  // -------------------------------------------------------------------------

  /** 腰から垂れる裾（コートの裾・腰布）。len は長さ、flare は後ろへの広がり */
  tails(mat, len, opts = {}) {
    const { S, fig } = this;
    const w = S.waist;
    const trail = (opts.trail ?? 10) + S.speed * 8 + Math.sin(S.phase * Math.PI * 2) * 4 * S.speed;
    // 倒れた姿勢では裾を地面に沿わせる（coatTrail / coatFront で向きを直接決める）
    const back = dirDown(S.pose.coatTrail ?? -trail);
    const fwd = dirDown(S.pose.coatFront ?? opts.frontA ?? 8 + S.speed * 4);
    const front0 = add(w, { x: opts.frontX ?? fig.waistR + 0.5, y: 0 });
    const back0 = add(w, { x: -fig.waistR - 0.8, y: 0.5 });
    const frontEnd = add(front0, fwd, len * (opts.frontLen ?? 0.8));
    const backEnd = add(back0, back, len + (opts.flare ?? 2));
    const midBack = add(back0, back, len * 0.5);
    const pts = [front0, frontEnd, mid(frontEnd, backEnd, 0.5), backEnd, add(midBack, { x: -(opts.flare ?? 2) * 0.4, y: 0 }), back0];
    let f = poly(pts);
    if (opts.slit) {
      // 前の割れ（脚が見える）
      const slitTop = add(w, { x: fig.waistR * 0.3, y: len * opts.slit });
      f = subtract(f, poly([slitTop, add(frontEnd, { x: 3, y: 2 }), add(mid(frontEnd, backEnd, 0.45), { x: 0, y: 2 })]));
    }
    this.add(opts.name ?? "tails", f, mat, opts.z ?? Z.tails, { group: opts.group ?? "tailsG", flat: 0.35, R: 4 });
    if (len > 8 && !opts.noFolds) this.folds(opts.name ?? "tails", [front0, back0], [frontEnd, backEnd], 2);
    if (opts.lining) {
      // 裏地: 前の縁と裾の内側に細く見せる（素材の黒コートの紅い裏）
      const edge = union(capsule(front0, frontEnd, opts.liningW ?? 1.3), capsule(frontEnd, mid(frontEnd, backEnd, 0.55), 1.0));
      this.add(`${opts.name ?? "tails"}Lining`, intersect(f, edge), opts.lining, (opts.z ?? Z.tails) + 0.3, { group: opts.group ?? "tailsG", flat: 0.5 });
    }
    return { front0, back0, frontEnd, backEnd, midHem: mid(frontEnd, backEnd, 0.5), f };
  }

  /**
   * 布のしわ: 上辺 [前, 後] と裾 [前, 後] の間に n 本の暗い筋を引く。裾に近い側だけ（上は張っている）
   */
  folds(part, top, hem, n) {
    for (let i = 1; i <= n; i++) {
      const t = i / (n + 1);
      const a = mid(top[0], top[1], t);
      const b = mid(hem[0], hem[1], t + (i % 2 ? 0.04 : -0.04));
      this.shade(a, b, -1, part, { from: 0.4 + (i % 2) * 0.1, to: 0.97, bend: i % 2 ? 0.8 : -0.8 });
    }
  }

  /** 足首近くまでのローブ。裾は両足の位置に追従する */
  robe(mat, opts = {}) {
    const { S, fig } = this;
    const w = S.waist;
    const lN = S.legN;
    const lF = S.legF;
    const hemY = Math.max(lN.ankle.y, lF.ankle.y) - (opts.hemUp ?? 3);
    const xs = [lN.knee.x, lF.knee.x, lN.ankle.x, lF.ankle.x];
    const fx = Math.max(...xs) + 2.5;
    const bx = Math.max(Math.min(...xs) - 3 - S.speed * 2, w.x - fig.waistR - (opts.backMax ?? 99));
    const pts = [add(w, { x: fig.waistR + 0.6, y: -1 }), pt(fx, hemY), pt(bx, hemY + 1), add(w, { x: -fig.waistR - 1, y: -1 })];
    let f = poly(pts);
    if (opts.ragged) {
      // ぎざぎざの裾
      const cuts = [];
      const n = 5;
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n;
        const x = bx + (fx - bx) * t;
        cuts.push(poly([pt(x - 1.4, hemY + 3), pt(x, hemY - 1.6 - (i % 2) * 1.2), pt(x + 1.4, hemY + 3)]));
      }
      f = subtract(f, union(...cuts));
    }
    if (opts.slit) {
      const top = add(w, { x: fig.waistR * 0.2, y: (hemY - w.y) * opts.slit });
      f = subtract(f, poly([top, pt(fx + 2, hemY + 2), pt((fx + bx) / 2 + 1, hemY + 2)]));
    }
    this.add(opts.name ?? "robe", f, mat, opts.z ?? Z.tails, { group: "robeG", flat: 0.4, R: 5 });
    this.folds(opts.name ?? "robe", [pts[0], pts[3]], [pts[1], pts[2]], 3);
  }

  /** 背中のマント。len は肩からの長さ */
  cape(mat, len, opts = {}) {
    const { S, fig } = this;
    const trail = 14 + S.speed * 14 + Math.sin(S.phase * Math.PI * 2) * 5 * S.speed;
    const a = add(S.neckBase, { x: 0.5, y: -0.5 });
    const shB = add(S.neckBase, { x: -fig.chestR - 0.5, y: 1.5 });
    const end = add(shB, dirDown(-trail), len);
    const endF = add(add(S.neckBase, { x: -1, y: 2 }), dirDown(-trail * 0.55), len * 0.92);
    const pts = [a, shB, add(mid(shB, end, 0.55), { x: -1.5, y: 0 }), end, add(mid(end, endF, 0.5), { x: 0, y: 1.2 }), endF];
    let f = poly(pts);
    if (opts.ragged) {
      const cuts = [];
      for (let i = 0; i < 3; i++) {
        const c = mid(end, endF, (i + 0.5) / 3);
        cuts.push(poly([add(c, { x: -1.3, y: 2 }), add(c, { x: 0, y: -2 - (i % 2) }), add(c, { x: 1.3, y: 2 })]));
      }
      f = subtract(f, union(...cuts));
    }
    this.add("cape", f, mat, Z.cape, { group: "capeG", flat: 0.3, R: 4, lumBias: -0.1 });
    if (len > 10) this.folds("cape", [a, shB], [endF, end], 2);
  }

  /** 首巻き。尾を後ろへなびかせる */
  scarf(mat, tailLen, opts = {}) {
    const { S, fig } = this;
    const n = add(S.neckBase, S.up, fig.neck * 0.45);
    this.add("scarf", ellipse(n, fig.neckR + 2, fig.neck * 0.5 + 1.8, -S.lean), mat, Z.neck + 1.5, { group: "scarfG", R: 2.5 });
    if (!tailLen) return;
    const flutter = Math.sin(S.phase * Math.PI * 4) * 3;
    const root = add(n, { x: -fig.neckR - 1, y: 0.5 });
    const a1 = -32 - S.speed * 22 + flutter;
    const k1 = add(root, dirDown(a1), tailLen * 0.5);
    const k2 = add(k1, dirDown(a1 - 8 - flutter), tailLen * 0.5);
    this.add("scarfTail", union(capsule(root, k1, 1.6, 1.4), capsule(k1, k2, 1.4, opts.tipR ?? 1.1)), mat, opts.z ?? Z.cape + 1, { group: "scarfT", flat: 0.3 });
    if (opts.double) {
      const k3 = add(root, dirDown(a1 + 14), tailLen * 0.45);
      const k4 = add(k3, dirDown(a1 + 20 + flutter), tailLen * 0.35);
      this.add("scarfTail2", union(capsule(root, k3, 1.3, 1.1), capsule(k3, k4, 1.1, 0.8)), mat, (opts.z ?? Z.cape + 1) - 0.5, { group: "scarfT2", flat: 0.3, far: true });
    }
  }

  /** 腰の帯・ベルト */
  belt(mat, width = 1.6, opts = {}) {
    const { S, fig } = this;
    const c = add(S.waist, S.up, opts.up ?? -0.8);
    const f = intersect(grow(union(this.torsoF, this.pelvisF), 0.45), ellipse(c, fig.hipR + 3, width, -S.lean));
    this.add(opts.name ?? "belt", f, mat, opts.z ?? Z.belt, { group: opts.group ?? "beltG", R: 2 });
    if (opts.buckle) this.mark(add(c, { x: fig.waistR + 0.2, y: 0 }), opts.buckle);
  }

  /** 肩当て（手前） */
  pauldron(mat, r = 3.2, opts = {}) {
    const { S } = this;
    const A = S.armN;
    const c = add(A.sh, { x: -0.3, y: -0.2 });
    this.add("pauldron", ellipse(c, r + 0.4, r * 0.8, -A.upperA * 0.2 - 10), mat, Z.pauldron, { group: "armN", spec: true, noLineBehind: false, ...opts });
    if (opts.far) {
      const F = S.armF;
      this.add("pauldronF", ellipse(add(F.sh, { x: -0.3, y: -0.2 }), r, r * 0.75, -10), mat, Z.armF + 3, { group: "armF", spec: true, far: true });
    }
  }

  /** 胴の上に重ねる層（胸当て・ベスト・前掛け）。clipF で形を切る */
  over(name, mat, clipF, z = Z.torsoOver, opts = {}) {
    this.add(name, intersect(grow(this.torsoF, opts.grow ?? 0.4), clipF), mat, z, { group: opts.group ?? name, ...opts });
  }

  // -------------------------------------------------------------------------
  // 武器（手前の手に持つ）
  // -------------------------------------------------------------------------

  /** 刃物。a は刃の向き（度）、len 刃渡り、w 刃の幅、curve 反り（+ で刃先が背の側へ） */
  blade(opts) {
    const { S } = this;
    const hand = opts.hand ?? S.armN.hand;
    const a = opts.a ?? S.weaponA;
    const d = dirDown(a);
    const n = { x: -d.y, y: d.x };
    const gripBack = add(hand, d, -(opts.grip ?? 3));
    const base = add(hand, d, opts.guardAt ?? 2);
    this.add("grip", capsule(gripBack, base, 0.9), opts.gripMat ?? "grip", Z.weapon - 1, { group: "weapon", R: 1 });
    if (opts.guard) this.add("guard", capsule(add(base, n, -opts.guard), add(base, n, opts.guard), 0.9), opts.guardMat ?? "metal", Z.weapon + 0.5, { group: "weapon", spec: true });
    const len = opts.len;
    const w = opts.w ?? 1.3;
    const curve = opts.curve ?? 0;
    const pts = [];
    const steps = 6;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const bend = curve * (t * t);
      const c = add(add(base, d, len * t), n, bend);
      const ww = w * (1 - Math.pow(t, opts.taper ?? 4)) + 0.25;
      pts.push({ c, ww });
    }
    const edge = pts.map(({ c, ww }) => add(c, n, ww));
    const spine = pts.map(({ c, ww }) => add(c, n, -ww * (opts.single ? 0.4 : 1)));
    const tip = add(add(base, d, len + 1.2), n, curve);
    this.add("blade", poly([...edge, tip, ...spine.reverse()]), opts.mat ?? "metal", Z.weapon, { group: "weapon", spec: true, R: w + 0.8, lumBias: 0.15 });
  }

  /** 長柄（槍・杖）。headLen の穂先は tipMat */
  pole(opts) {
    const { S } = this;
    const hand = opts.hand ?? S.armN.hand;
    const a = opts.a ?? S.weaponA;
    const d = dirDown(a);
    const n = { x: -d.y, y: d.x };
    const butt = add(hand, d, -(opts.back ?? 10));
    const top = add(hand, d, opts.front ?? 18);
    this.add("shaft", capsule(butt, top, opts.r ?? 0.9), opts.shaftMat ?? "wood", Z.weapon - 1, { group: "weapon", R: 1.2 });
    return { top, d, n, butt };
  }
}

export const DIR = dirDown;
export { add, mid, pt, clamp, capsule, ellipse, poly, union, subtract, intersect, grow };
