// 素材の 1 コマを、指定の行数へ縮めて文字の格子にする（手で清書するための下敷き）
// node scripts/player-art/hand/trace.mjs <x0> <y0> <w> <h> <rows> <out.txt> [name] [--flip]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { decodePng } from "../../fx/png.mjs";
import { hexToRgb } from "../engine.mjs";
import { HAND_PALETTE } from "./palette.mjs";

const a = process.argv.slice(2);
const [x0, y0, w, h, rows] = a.slice(0, 5).map(Number);
const out = a[5];
const name = a[6] && !a[6].startsWith("--") ? a[6] : "frame";
const flip = a.includes("--flip");
const img = decodePng(readFileSync("docs/example/Graphics/Character/player/sample.png"));
const BG = [55, 55, 64];
// 背景・床の影は透明（'.'）として候補に入れる
const PAL = [...Object.entries(HAND_PALETTE).filter(([, v]) => v).map(([c, v]) => [c, hexToRgb(v)]), [".", BG], [".", [46, 46, 54]], [".", [40, 40, 48]]];

const s = h / rows;
const cols = Math.round(w / s);
const lines = [];
for (let r = 0; r < rows; r++) {
  let line = "";
  for (let c = 0; c < cols; c++) {
    const acc = [0, 0, 0];
    let n = 0;
    for (let y = Math.floor(r * s); y < Math.floor((r + 1) * s); y++)
      for (let x = Math.floor(c * s); x < Math.floor((c + 1) * s); x++) {
        const k = ((y0 + y) * img.width + x0 + x) * 4;
        acc[0] += img.rgba[k];
        acc[1] += img.rgba[k + 1];
        acc[2] += img.rgba[k + 2];
        n++;
      }
    const col = acc.map((v) => v / n);
    let best = ".";
    let bd = Infinity;
    for (const [ch, p] of PAL) {
      const d = (col[0] - p[0]) ** 2 + (col[1] - p[1]) ** 2 + (col[2] - p[2]) ** 2;
      if (d < bd) {
        bd = d;
        best = ch;
      }
    }
    line += best;
  }
  lines.push(flip ? [...line].reverse().join("") : line);
}
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `# ${name} ${cols}x${rows} anchor ${Math.round(cols / 2)},${rows - 1}\n${lines.join("\n")}\n`);
console.log(out);
