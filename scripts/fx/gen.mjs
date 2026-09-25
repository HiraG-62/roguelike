// エフェクトのスプライトを生成する（npm run fx:gen）。docs/ideas/fx-sprites.md
//
//   node scripts/fx/gen.mjs                   全シートを描いて public/assets/fx/*.png と src/data/fxSheets.gen.ts を書き直す
//   node scripts/fx/gen.mjs --preview <dir>   配色済みの確認用 PNG（方向 × フレームの一覧）も <dir> に書く
//   node scripts/fx/gen.mjs --check           書き出さずに、今のファイルと一致するかだけ見る（一致しなければ非 0）
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { encodePng } from "./png.mjs";
import { shelfPack } from "./pack.mjs";
import { Frame, cleanup, trimBox } from "./raster.mjs";
import { SWORD_ATLAS } from "./sheets/sword.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const OUT_DIR = join(ROOT, "public/assets/fx");
const MANIFEST = join(ROOT, "src/data/fxSheets.gen.ts");
const RAMPS = JSON.parse(readFileSync(join(ROOT, "src/data/fxRamps.json"), "utf8"));
/** PNG に書く段の灰色（段 × LEVEL_GRAY）。実行時の fxSprites.ts と同じ値 */
const LEVEL_GRAY = 32;

/** 生成するアトラス（武器・スキルの単位で 1 枚） */
const ATLASES = [SWORD_ATLAS];

const args = process.argv.slice(2);
function argValue(name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}
const previewIdx = args.indexOf("--preview");
const previewDir = previewIdx >= 0 ? args[previewIdx + 1] : undefined;
const checkOnly = args.includes("--check");
const onlyIdx = args.indexOf("--only");
/** --only <シートの key の前方一致>: 確認用だけ描く（生成物は書かない） */
const only = onlyIdx >= 0 ? args[onlyIdx + 1] : undefined;

/** 1 シートの全フレーム（方向 × フレーム）を描いて切り詰める */
function renderSheet(sheet) {
  const cells = [];
  for (let d = 0; d < sheet.dirs; d++) {
    const angle = (d / sheet.dirs) * Math.PI * 2;
    for (let f = 0; f < sheet.frames; f++) {
      const frame = new Frame(sheet.size, sheet.size, angle);
      sheet.draw(frame, f, { dir: d, angle });
      cleanup(frame);
      const box = trimBox(frame);
      cells.push({ frame, box, w: box?.w ?? 0, h: box?.h ?? 0 });
    }
  }
  return cells;
}

function buildAtlas(atlas) {
  const sheets = atlas.sheets.map((sheet) => ({ sheet, cells: renderSheet(sheet) }));
  const all = sheets.flatMap((s) => s.cells);
  const packed = shelfPack(all);
  const rgba = new Uint8Array(packed.width * packed.height * 4);
  all.forEach((cell, i) => {
    const place = packed.places[i];
    if (!cell.box || !place) return;
    for (let y = 0; y < cell.h; y++) {
      for (let x = 0; x < cell.w; x++) {
        const level = cell.frame.get(cell.box.x + x, cell.box.y + y);
        if (!level) continue;
        const o = ((place.y + y) * packed.width + place.x + x) * 4;
        rgba[o] = rgba[o + 1] = rgba[o + 2] = level * LEVEL_GRAY;
        rgba[o + 3] = 255;
      }
    }
  });
  let index = 0;
  const entries = sheets.map(({ sheet, cells }) => {
    const rects = [];
    for (const cell of cells) {
      const place = packed.places[index++] ?? { x: 0, y: 0 };
      if (!cell.box) {
        rects.push(0, 0, 0, 0, 0, 0);
        continue;
      }
      // 原点（作業面の中心）から見た矩形の左上 = -(原点 - 左上)
      rects.push(place.x, place.y, cell.w, cell.h, cell.frame.cx - cell.box.x, cell.frame.cy - cell.box.y);
    }
    return { key: sheet.key, frames: sheet.frames, dirs: sheet.dirs, active: sheet.active, rects };
  });
  return { key: atlas.key, png: encodePng(packed.width, packed.height, rgba), width: packed.width, height: packed.height, entries, sheets };
}

function manifestSource(built) {
  const lines = [
    "// 生成物: npm run fx:gen（scripts/fx/gen.mjs）。手で直さない。docs/ideas/fx-sprites.md",
    "",
    "/** アトラス（public/ からの相対パスと寸法） */",
    "export const FX_ATLASES = {",
    ...built.map((a) => `  ${a.key}: { url: "assets/fx/${a.key}.png", width: ${a.width}, height: ${a.height} },`),
    "} as const;",
    "",
    "export type FxAtlasKey = keyof typeof FX_ATLASES;",
    "",
    "/**",
    " * シート 1 つ（モーション 1 つ）。rects は `(dir * frames + frame) * 6` から [x, y, w, h, ox, oy]。",
    " * (ox, oy) は矩形の左上から原点（振りの中心など）までのずれ（絵のドット）。空のフレームは w = h = 0",
    " */",
    "export interface FxSheetDef {",
    "  readonly atlas: FxAtlasKey;",
    "  readonly frames: number;",
    "  /** 事前に描いた方向の数（1 は向きなし）。方向 i の角は i / dirs * 2π */",
    "  readonly dirs: number;",
    "  /** 振りの active に割り当てるフレーム数（残りは振り終わりの尾） */",
    "  readonly active: number;",
    "  readonly rects: readonly number[];",
    "}",
    "",
    "export const FX_SHEETS = {",
  ];
  for (const a of built) {
    for (const e of a.entries) {
      lines.push(`  "${e.key}": { atlas: "${a.key}", frames: ${e.frames}, dirs: ${e.dirs}, active: ${e.active}, rects: [${e.rects.join(",")}] },`);
    }
  }
  lines.push("} as const satisfies Record<string, FxSheetDef>;", "", "export type FxSheetKey = keyof typeof FX_SHEETS;", "");
  return lines.join("\n");
}

function hexRgb(hex) {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** 確認用: 選んだ方向 × 全フレームを配色して 3 倍で並べる */
function writePreview(dir, a) {
  const SCALE = Number(argValue("--scale") ?? 3);
  const BG = [30, 26, 38];
  for (const { sheet, cells } of a.sheets) {
    const dirsArg = argValue("--dirs");
    const pick = dirsArg
      ? dirsArg.split(",").map((v) => Number(v) % sheet.dirs)
      : [...new Set([0, sheet.dirs / 8, (sheet.dirs * 3) / 8, (sheet.dirs * 6) / 8].map((v) => Math.round(v) % sheet.dirs))];
    const ramps = ["steel", "fire"];
    const rows = pick.length * ramps.length;
    const cw = sheet.size * SCALE;
    const w = cw * sheet.frames;
    const h = cw * rows;
    const rgba = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) rgba.set([...BG, 255], i * 4);
    ramps.forEach((rampKey, ri) => {
      const ramp = RAMPS[rampKey].map(hexRgb);
      pick.forEach((d, di) => {
        for (let f = 0; f < sheet.frames; f++) {
          const cell = cells[d * sheet.frames + f];
          if (!cell) continue;
          const oy0 = (ri * pick.length + di) * cw;
          const ox0 = f * cw;
          for (let y = 0; y < sheet.size; y++) {
            for (let x = 0; x < sheet.size; x++) {
              const level = cell.frame.get(x, y);
              // 原点に 1 ドットの印（位置合わせの確認用）
              const pivot = x === sheet.size / 2 && y === sheet.size / 2;
              const color = level ? ramp[level - 1] : pivot ? [255, 60, 60] : null;
              if (!color) continue;
              for (let sy = 0; sy < SCALE; sy++)
                for (let sx = 0; sx < SCALE; sx++) rgba.set([...color, 255], ((oy0 + y * SCALE + sy) * w + ox0 + x * SCALE + sx) * 4);
            }
          }
        }
      });
    });
    writeFileSync(join(dir, `${sheet.key}.png`), encodePng(w, h, rgba));
  }
}

if (only) {
  mkdirSync(previewDir ?? "fx-preview", { recursive: true });
  for (const atlas of ATLASES) {
    const sheets = atlas.sheets.filter((s) => s.key.startsWith(only));
    if (sheets.length) writePreview(previewDir ?? "fx-preview", { sheets: sheets.map((sheet) => ({ sheet, cells: renderSheet(sheet) })) });
  }
  process.exit(0);
}
const built = ATLASES.map(buildAtlas);
const manifest = manifestSource(built);
if (checkOnly) {
  let same = existsSync(MANIFEST) && readFileSync(MANIFEST, "utf8") === manifest;
  for (const a of built) {
    const file = join(OUT_DIR, `${a.key}.png`);
    same = same && existsSync(file) && readFileSync(file).equals(a.png);
  }
  console.log(same ? "fx: 生成物は最新" : "fx: 生成物が古い（npm run fx:gen）");
  process.exit(same ? 0 : 1);
}
mkdirSync(OUT_DIR, { recursive: true });
for (const a of built) {
  writeFileSync(join(OUT_DIR, `${a.key}.png`), a.png);
  const cells = a.entries.reduce((n, e) => n + e.frames * e.dirs, 0);
  console.log(`fx: ${a.key}.png ${a.width}x${a.height}（シート ${a.entries.length}、フレーム ${cells}）`);
}
writeFileSync(MANIFEST, manifest);
if (previewDir) {
  mkdirSync(previewDir, { recursive: true });
  for (const a of built) writePreview(previewDir, a);
  console.log(`fx: 確認用 → ${previewDir}`);
}
