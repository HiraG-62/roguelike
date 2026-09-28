// 素材（格子が揃っていない拡大ドット絵）から元のドットの格子を推定し、各ドットの中心の色を拾う。
// node scripts/player-art/hand/degrid.mjs <x0> <y0> <w> <h> <out.txt> [name] [--pitch 3.7] [--flip]
// 色の境目が格子線に揃う間隔と位相を、縦横別に探す
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { decodePng } from "../../fx/png.mjs";
import { hexToRgb } from "../engine.mjs";
import { HAND_PALETTE } from "./palette.mjs";

const a = process.argv.slice(2);
const [x0, y0, w, h] = a.slice(0, 4).map(Number);
const out = a[4];
const name = a[5] && !a[5].startsWith("--") ? a[5] : "frame";
const flip = a.includes("--flip");
const pIdx = a.indexOf("--pitch");
const img = decodePng(readFileSync("docs/example/Graphics/Character/player/sample.png"));
const at = (x, y) => {
  const k = ((y0 + y) * img.width + x0 + x) * 4;
  return [img.rgba[k], img.rgba[k + 1], img.rgba[k + 2]];
};
const diff = (p, q) => Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) + Math.abs(p[2] - q[2]);

// 縦・横それぞれ、隣の画素との差（境目の強さ）を足し合わせた列
const gx = new Float64Array(w);
const gy = new Float64Array(h);
for (let y = 0; y < h; y++)
  for (let x = 1; x < w; x++) gx[x] += diff(at(x, y), at(x - 1, y));
for (let x = 0; x < w; x++)
  for (let y = 1; y < h; y++) gy[y] += diff(at(x, y), at(x, y - 1));

/** 間隔 p・位相 f の格子線上に境目がどれだけ集まるか */
function score(g, p, f) {
  let s = 0;
  let n = 0;
  for (let t = f; t < g.length; t += p) {
    const i = Math.round(t);
    if (i > 0 && i < g.length) {
      s += g[i];
      n++;
    }
  }
  return n ? s / n : 0;
}
function best(g) {
  const pitches = pIdx >= 0 ? [Number(a[pIdx + 1])] : Array.from({ length: 121 }, (_, i) => 2.5 + i * 0.02);
  let bp = 0;
  let bf = 0;
  let bs = -1;
  const mean = g.reduce((s, v) => s + v, 0) / g.length;
  for (const p of pitches)
    for (let f = 0; f < p; f += 0.1) {
      const s = score(g, p, f) / mean;
      if (s > bs) {
        bs = s;
        bp = p;
        bf = f;
      }
    }
  return { p: bp, f: bf, s: bs };
}
const bx = best(gx);
const by = best(gy);
console.log(`横: 間隔 ${bx.p.toFixed(2)} 位相 ${bx.f.toFixed(1)}（集まり ${bx.s.toFixed(2)}）/ 縦: 間隔 ${by.p.toFixed(2)} 位相 ${by.f.toFixed(1)}（集まり ${by.s.toFixed(2)}）`);

const BG = [55, 55, 64];
const PAL = [...Object.entries(HAND_PALETTE).filter(([, v]) => v).map(([c, v]) => [c, hexToRgb(v)]), [".", BG], [".", [48, 48, 57]], [".", [43, 43, 51]]];
const nearest = (c) => {
  let bc = ".";
  let bd = Infinity;
  for (const [ch, p] of PAL) {
    const d = (c[0] - p[0]) ** 2 * 0.3 + (c[1] - p[1]) ** 2 * 0.59 + (c[2] - p[2]) ** 2 * 0.11;
    if (d < bd) {
      bd = d;
      bc = ch;
    }
  }
  return bc;
};
const lines = [];
for (let ty = by.f; ty + by.p <= h; ty += by.p) {
  let line = "";
  for (let tx = bx.f; tx + bx.p <= w; tx += bx.p) {
    // ドットの中央 1/2 の範囲の中央値に近い色（縁のにじみを避ける）
    const cs = [];
    for (let y = Math.ceil(ty + by.p * 0.25); y <= Math.floor(ty + by.p * 0.75); y++)
      for (let x = Math.ceil(tx + bx.p * 0.25); x <= Math.floor(tx + bx.p * 0.75); x++) cs.push(at(x, y));
    cs.sort((p, q) => p[0] + p[1] + p[2] - (q[0] + q[1] + q[2]));
    line += nearest(cs[Math.floor(cs.length / 2)] ?? at(Math.round(tx), Math.round(ty)));
  }
  lines.push(flip ? [...line].reverse().join("") : line);
}
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `# ${name} ${lines[0].length}x${lines.length} anchor ${Math.round(lines[0].length / 2)},${lines.length - 1}\n${lines.join("\n")}\n`);
console.log(`${out}（${lines[0].length}x${lines.length}）`);
