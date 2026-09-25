// エフェクトのスプライトを生成する（npm run fx:gen）。docs/ideas/fx-sprites.md
//
// scripts/fx/sheets/<アトラス>.mjs を自動で集める（登録は要らない）。各ファイルは `export const ATLAS = { key, sheets, fx }` を持つ。
// アトラスごとに public/assets/fx/<key>.png と src/data/fx/<key>.gen.json を書き、全アトラスを束ねる src/data/fxSheets.gen.ts を書き直す
//
//   node scripts/fx/gen.mjs                         全アトラスを描いて書き出す
//   node scripts/fx/gen.mjs --atlas greatsword,axe  指定したアトラスだけ描き直す（他の生成物はそのまま。並列作業で互いを上書きしない）
//   node scripts/fx/gen.mjs --only <key> --preview <dir> [--dirs 0,3] [--scale 4] [--ramps brass,fire]
//                                                   シートの key の前方一致で、配色済みの確認用 PNG だけ描く（生成物は書かない）
//   node scripts/fx/gen.mjs --check [--atlas …]     書き出さずに、今のファイルと一致するかだけ見る（一致しなければ非 0）
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { encodePng } from "./png.mjs";
import { shelfPack } from "./pack.mjs";
import { Frame, cleanup, trimBox } from "./raster.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const SHEETS_DIR = join(HERE, "sheets");
const OUT_DIR = join(ROOT, "public/assets/fx");
const JSON_DIR = join(ROOT, "src/data/fx");
const INDEX = join(ROOT, "src/data/fxSheets.gen.ts");
const RAMPS = JSON.parse(readFileSync(join(ROOT, "src/data/fxRamps.json"), "utf8"));
/** PNG に書く段の灰色（段 × LEVEL_GRAY）。実行時の fxSprites.ts と同じ値 */
const LEVEL_GRAY = 32;
const KEY_RE = /^[a-zA-Z][a-zA-Z0-9]*$/;

/**
 * sheets/ のアトラス（ファイル名の順。決定的）。ファイル名 = アトラスの key。
 * keys を渡すとそのファイルだけを読む（並列作業中の他人の書きかけのファイルで止まらない）
 */
async function discoverAtlases(keys) {
  const all = readdirSync(SHEETS_DIR).filter((f) => f.endsWith(".mjs")).sort();
  const files = keys ? all.filter((f) => keys.includes(f.replace(/\.mjs$/, ""))) : all;
  const atlases = [];
  for (const file of files) {
    const mod = await import(pathToFileURL(join(SHEETS_DIR, file)).href);
    const atlas = mod.ATLAS;
    if (!atlas || !KEY_RE.test(atlas.key ?? "")) throw new Error(`fx: ${file} に ATLAS（key は英数字）が無い`);
    if (`${atlas.key}.mjs` !== file) throw new Error(`fx: ${file} の ATLAS.key はファイル名と同じにする（${atlas.key}）`);
    for (const sheet of atlas.sheets) {
      if (!sheet.key.startsWith(`${atlas.key}.`)) throw new Error(`fx: ${file} のシート ${sheet.key} は "${atlas.key}." で始める`);
    }
    atlases.push(atlas);
  }
  return atlases;
}

const args = process.argv.slice(2);
function argValue(name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}
const previewDir = argValue("--preview");
const checkOnly = args.includes("--check");
const only = argValue("--only");
const atlasFilter = argValue("--atlas")?.split(",");

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
  const json = {
    width: packed.width,
    height: packed.height,
    sheets: Object.fromEntries(entries.map((e) => [e.key, { atlas: atlas.key, frames: e.frames, dirs: e.dirs, active: e.active, rects: e.rects }])),
    fx: atlas.fx ?? null,
  };
  return { key: atlas.key, png: encodePng(packed.width, packed.height, rgba), width: packed.width, height: packed.height, entries, sheets, json: `${JSON.stringify(json)}\n` };
}

/** アトラスの名前を import の識別子に（予約語や数字始まりを避ける） */
function ident(key) {
  return `fx_${key}`;
}

/** 全アトラスの JSON を束ねる index（描かずに作れる。アトラスの一覧だけで決まる） */
function indexSource(keys) {
  return [
    "// 生成物: npm run fx:gen（scripts/fx/gen.mjs）。手で直さない。docs/ideas/fx-sprites.md",
    "// アトラスごとの中身は src/data/fx/<key>.gen.json（寸法・シートの矩形・武器種のモーションの表）",
    ...keys.map((k) => `import ${ident(k)} from "./fx/${k}.gen.json";`),
    "",
    "/** アトラス（public/ からの相対パスと寸法） */",
    "export const FX_ATLASES = {",
    ...keys.map((k) => `  ${k}: { url: "assets/fx/${k}.png", width: ${ident(k)}.width, height: ${ident(k)}.height },`),
    "} as const;",
    "",
    "export type FxAtlasKey = keyof typeof FX_ATLASES;",
    "",
    "/**",
    " * シート 1 つ（モーション 1 つ）。rects は `(dir * frames + frame) * 6` から [x, y, w, h, ox, oy]。",
    " * (ox, oy) は矩形の左上から原点（振りの中心など）までのずれ（絵のドット）。空のフレームは w = h = 0",
    " */",
    "export interface FxSheetDef {",
    "  /** 載っているアトラス（FxAtlasKey。JSON 由来なので string で持ち、引くときに確かめる） */",
    "  readonly atlas: string;",
    "  readonly frames: number;",
    "  /** 事前に描いた方向の数（1 は向きなし）。方向 i の角は i / dirs * 2π */",
    "  readonly dirs: number;",
    "  /** 振りの active に割り当てるフレーム数（残りは振り終わりの尾） */",
    "  readonly active: number;",
    "  readonly rects: readonly number[];",
    "}",
    "",
    "export const FX_SHEETS = {",
    ...keys.map((k) => `  ...${ident(k)}.sheets,`),
    "} satisfies Record<string, FxSheetDef>;",
    "",
    "export type FxSheetKey = keyof typeof FX_SHEETS;",
    "",
    "/** アトラスごとの武器種のモーションの表（検査と型付けは render/fxMotions.ts） */",
    `export const FX_MOVESET_RAW = [${keys.map((k) => `${ident(k)}.fx`).join(", ")}] as const;`,
    "",
  ].join("\n");
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
    const ramps = argValue("--ramps")?.split(",") ?? ["steel", "fire"];
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

const onlyAtlas = only?.split(".")[0];
const atlases = await discoverAtlases(onlyAtlas ? [onlyAtlas] : atlasFilter);
if (only) {
  const dir = previewDir ?? "fx-preview";
  mkdirSync(dir, { recursive: true });
  for (const atlas of atlases) {
    const sheets = atlas.sheets.filter((s) => s.key.startsWith(only));
    if (sheets.length) writePreview(dir, { sheets: sheets.map((sheet) => ({ sheet, cells: renderSheet(sheet) })) });
  }
  process.exit(0);
}
const unknown = (atlasFilter ?? []).filter((k) => !atlases.some((a) => a.key === k));
if (unknown.length) throw new Error(`fx: アトラスが無い: ${unknown.join(", ")}`);
const targets = atlasFilter ? atlases.filter((a) => atlasFilter.includes(a.key)) : atlases;
const built = targets.map(buildAtlas);
// まだ描いていないアトラスがあると index の import が壊れるので、JSON の揃ったもの（と今回描いたもの）だけを束ねる
const onDisk = existsSync(JSON_DIR) ? readdirSync(JSON_DIR).filter((f) => f.endsWith(".gen.json")).map((f) => f.replace(/\.gen\.json$/, "")) : [];
const ready = [...new Set([...onDisk, ...built.map((b) => b.key)])].sort();
const index = indexSource(ready);
if (checkOnly) {
  let same = existsSync(INDEX) && readFileSync(INDEX, "utf8") === index;
  for (const a of built) {
    const png = join(OUT_DIR, `${a.key}.png`);
    const json = join(JSON_DIR, `${a.key}.gen.json`);
    same = same && existsSync(png) && readFileSync(png).equals(a.png) && existsSync(json) && readFileSync(json, "utf8") === a.json;
  }
  console.log(same ? "fx: 生成物は最新" : "fx: 生成物が古い（npm run fx:gen）");
  process.exit(same ? 0 : 1);
}
mkdirSync(OUT_DIR, { recursive: true });
mkdirSync(JSON_DIR, { recursive: true });
for (const a of built) {
  writeFileSync(join(OUT_DIR, `${a.key}.png`), a.png);
  writeFileSync(join(JSON_DIR, `${a.key}.gen.json`), a.json);
  const cells = a.entries.reduce((n, e) => n + e.frames * e.dirs, 0);
  console.log(`fx: ${a.key}.png ${a.width}x${a.height}（シート ${a.entries.length}、フレーム ${cells}）`);
}
writeFileSync(INDEX, index);
if (previewDir) {
  mkdirSync(previewDir, { recursive: true });
  for (const a of built) writePreview(previewDir, a);
  console.log(`fx: 確認用 → ${previewDir}`);
}
