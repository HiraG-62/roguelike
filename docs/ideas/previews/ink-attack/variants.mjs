// 墨の案の見本: 実際の床の撮影に、案ごとの配色で攻撃の絵を置く
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
const R = "/home/user/roguelike/scripts/fx/";
const { Frame, cleanup } = await import(R + "raster.mjs");
const { inkify } = await import(R + "ink.mjs");
const { fitAtlas } = await import(R + "fit.mjs");
const { encodePng, decodePng } = await import(R + "png.mjs");
const S = "/tmp/claude-0/-home-user-roguelike/66500cd1-6074-5246-927b-d0d3eac5d6d7/scratchpad";
const OUT = process.argv[2];
const ONLY = process.argv[3];
const hex = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const BASE = JSON.parse(readFileSync("/home/user/roguelike/src/data/fxRamps.json", "utf8"));

// 墨の段（濃墨 → 淡墨）。予告の濃墨 #0b0a0e より僅かに青い墨（藍墨寄り）
const INK = ["#0d0e14", "#14161e", "#1c1f2a", "#272b38", "#363b4a", "#4d5364", "#6c7284"];
const ACC = {
  // 控えめの差し色（くすませた属性の色）
  soft: { steel: ["#2a3f66", "#5d7aa8", "#a9bcd8"], fire: ["#5a2a1a", "#a0582c", "#d9a070"], dark: ["#33224a", "#6a4c94", "#b8a0d8"] },
  // 強い差し色（今の配色の明部）
  strong: { steel: ["#34609c", "#7cc6ea", "#ffffff"], fire: ["#ec661c", "#ffa134", "#fffbe0"], dark: ["#7838b6", "#ae6efe", "#fff0ff"] },
};
const ELEMS = ["steel", "fire", "dark"];

/** 案: ramp(el) → 7 色、halo(el) → { color, alpha, r } | null */
const VARIANTS = {
  A: {
    title: "案 A 濃墨・銀の滲み（差し色ほぼ無し）",
    ramp: (el) => [INK[0], INK[0], INK[1], INK[2], INK[3], INK[5], ACC.soft[el][2]],
    halo: () => ({ color: "#c9ccd6", alpha: 0.28, r: 2 }),
  },
  B: {
    title: "案 B 濃墨・くすんだ差し色の芯",
    ramp: (el) => [INK[0], INK[0], INK[1], INK[2], INK[3], ACC.soft[el][1], ACC.soft[el][2]],
    halo: (el) => ({ color: ACC.soft[el][2], alpha: 0.18, r: 2 }),
  },
  C: {
    title: "案 C 墨の濃淡（ぼかし。白い芯を濃墨に）",
    ramp: () => ["#8a8f9c", "#5f6472", INK[4], INK[3], INK[2], INK[1], INK[0]],
    halo: (el) => ({ color: ACC.soft[el][2], alpha: 0.22, r: 1 }),
  },
  D: {
    title: "案 D 濃墨・鮮やかな属性の芯（差し色 強）",
    ramp: (el) => [INK[0], INK[1], INK[2], INK[3], ACC.strong[el][0], ACC.strong[el][1], ACC.strong[el][2]],
    halo: () => null,
  },
  E: {
    title: "案 E 濃墨・属性の色の光の滲み（差し色 強）",
    ramp: (el) => [INK[0], INK[0], INK[1], INK[2], INK[3], INK[4], ACC.strong[el][2]],
    halo: (el) => ({ color: ACC.strong[el][1], alpha: 0.55, r: 3 }),
  },
  NOW: {
    title: "今（墨の筆致だけ足した版。色は今のまま）",
    ramp: (el) => BASE[el],
    halo: () => null,
  },
};

const atlases = {};
async function atlasOf(k) {
  if (!atlases[k]) {
    const a = (await import(pathToFileURL(R + "sheets/" + k + ".mjs").href)).ATLAS;
    atlases[k] = { a, fit: fitAtlas("/home/user/roguelike", a) };
  }
  return atlases[k];
}
function keySeed(k) { let h = 0x811c9dc5; for (let i = 0; i < k.length; i++) h = Math.imul(h ^ k.charCodeAt(i), 0x01000193); return h >>> 0; }
async function frameOf(atlasKey, key, dir, f) {
  const { a, fit } = await atlasOf(atlasKey);
  const sheet = a.sheets.find((s) => s.key === key);
  const d = dir % sheet.dirs;
  const ang = (d / sheet.dirs) * Math.PI * 2;
  const fr = new Frame(sheet.size, sheet.size, ang, fit.sheets.get(key));
  sheet.draw(fr, f, { dir: d, angle: ang });
  cleanup(fr);
  inkify(fr, keySeed(key) ^ Math.imul(d + 1, 0x9e3779b1), Math.imul(f + 1, 0x85ebca6b));
  return fr;
}

// 置く絵: [アトラス, シート, 方向, フレーム, 属性, 画面の x, y（パネル内・画面 px）]
const PLACES = [
  // 背景ごとの位置 [洞窟, 氷窟]。大剣は自分（撮影の旅人）を原点に振る
  ["sword", "sword.l3", 0, 3, "steel", [[230, 150], [150, 120]]],
  ["greatsword", "greatsword.l3", 18, 3, "fire", [[648, 236], [598, 396]]],
  ["scythe", "scythe.l1", 12, 3, "dark", [[330, 430], [330, 300]]],
  ["spear", "spear.arc", 2, 3, "steel", [[820, 330], [560, 60]]],
  ["sword", "sword.hitHeavy", 3, 2, "steel", [[880, 90], [860, 120]]],
  ["greatsword", "greatsword.hitHeavy", 9, 2, "fire", [[110, 470], [120, 470]]],
];
const PW = 960, PH = 540, DOT = 2;
const bgs = ["d3-cave", "d13-glacier"].map((n) => decodePng(readFileSync(`${S}/shots/${n}.png`)));
const CROP = [{ x: 330, y: 300 }, { x: 380, y: 130 }];

function blend(img, w, x, y, c, a) {
  if (x < 0 || y < 0 || x >= w) return;
  const o = (y * w + x) * 4;
  if (o + 3 >= img.length) return;
  for (let k = 0; k < 3; k++) img[o + k] = Math.round(img[o + k] * (1 - a) + c[k] * a);
}

async function panel(variant, bi) {
  const bg = bgs[bi];
  const img = new Uint8Array(PW * PH * 4);
  for (let y = 0; y < PH; y++) for (let x = 0; x < PW; x++) {
    const s = ((y + CROP[bi].y) * bg.width + x + CROP[bi].x) * 4;
    img.set([bg.rgba[s], bg.rgba[s + 1], bg.rgba[s + 2], 255], (y * PW + x) * 4);
  }
  for (const [ak, key, dir, f, el, pos] of PLACES) {
    const [px, py] = pos[bi];
    const fr = await frameOf(ak, key, dir, f);
    const ramp = variant.ramp(el).map(hex);
    const halo = variant.halo(el);
    const ox = px - fr.cx * DOT, oy = py - fr.cy * DOT;
    if (halo) {
      const hc = hex(halo.color);
      for (let y = 0; y < fr.h; y++) for (let x = 0; x < fr.w; x++) {
        if (fr.get(x, y)) continue;
        let best = 99;
        for (let dy = -halo.r; dy <= halo.r; dy++) for (let dx = -halo.r; dx <= halo.r; dx++) {
          const d2 = dx * dx + dy * dy;
          if (d2 <= halo.r * halo.r + 1 && d2 < best && fr.get(x + dx, y + dy)) best = d2;
        }
        if (best === 99) continue;
        // 線から離れるほど薄く（滲みのぼかし）
        const a = halo.alpha * (1 - (Math.sqrt(best) - 1) / (halo.r + 0.5));
        for (let sy = 0; sy < DOT; sy++) for (let sx = 0; sx < DOT; sx++) blend(img, PW, ox + x * DOT + sx, oy + y * DOT + sy, hc, a);
      }
    }
    for (let y = 0; y < fr.h; y++) for (let x = 0; x < fr.w; x++) {
      const l = fr.get(x, y); if (!l) continue;
      for (let sy = 0; sy < DOT; sy++) for (let sx = 0; sx < DOT; sx++) blend(img, PW, ox + x * DOT + sx, oy + y * DOT + sy, ramp[l - 1], 1);
    }
  }
  return img;
}

/** 実寸 2 枚（洞窟・氷窟）+ 下段に洞窟の左上 480x270 を 2 倍 */
for (const [vk, v] of Object.entries(VARIANTS)) {
  if (ONLY && !ONLY.split(",").includes(vk)) continue;
  const p0 = await panel(v, 0), p1 = await panel(v, 1);
  const W = PW * 2, H = PH * 2;
  const out = new Uint8Array(W * H * 4);
  for (let y = 0; y < PH; y++) for (let x = 0; x < PW; x++) {
    out.set(p0.subarray((y * PW + x) * 4, (y * PW + x) * 4 + 4), (y * W + x) * 4);
    out.set(p1.subarray((y * PW + x) * 4, (y * PW + x) * 4 + 4), (y * W + x + PW) * 4);
  }
  // 拡大: 洞窟の (60, 20)-(540, 290) と 氷窟の (420, 20)-(900, 290)
  const Z = [[p0, 60, 20, 0], [p1, 440, 0, PW]];
  for (const [p, zx, zy, dx0] of Z) for (let y = 0; y < PH; y++) for (let x = 0; x < PW; x++) {
    const s = ((zy + (y >> 1)) * PW + zx + (x >> 1)) * 4;
    out.set(p.subarray(s, s + 4), ((PH + y) * W + dx0 + x) * 4);
  }
  writeFileSync(`${OUT}/ink-${vk}.png`, encodePng(W, H, out));
  console.log(vk, v.title);
}
