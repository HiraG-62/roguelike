// プレイヤーの体と手に持つ武器のスプライトを生成する（npm run actor:gen）。docs/ideas/player-sprites.md
//
// scripts/actor/sheets/<アトラス>.mjs を自動で集める。各ファイルは `export const ATLAS = { key, sheets, meta }` を持つ。
// アトラスごとに public/assets/actor/<key>.png と src/data/actor/<key>.gen.json を書き、全アトラスを束ねる
// src/data/actorSheets.gen.ts を書き直す。仕組みは scripts/fx/gen.mjs と同じで、色を段ではなくそのまま書く
//
//   node scripts/actor/gen.mjs                          全アトラス
//   node scripts/actor/gen.mjs --atlas bodyNone,wpnSword 指定したアトラスだけ（他の生成物はそのまま）
//   node scripts/actor/gen.mjs --only <key> --preview <dir> [--dirs 0,4] [--scale 4]  確認用 PNG だけ
//   node scripts/actor/gen.mjs --check [--atlas …]      書き出さずに最新か確かめる
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { encodePng } from "../fx/png.mjs";
import { shelfPack } from "../fx/pack.mjs";
import { ColorFrame, finish, trimBox } from "./paint.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const SHEETS_DIR = join(HERE, "sheets");
const OUT_DIR = join(ROOT, "public/assets/actor");
const JSON_DIR = join(ROOT, "src/data/actor");
const INDEX = join(ROOT, "src/data/actorSheets.gen.ts");
const KEY_RE = /^[a-zA-Z][a-zA-Z0-9]*$/;

async function discoverAtlases(keys) {
  const all = readdirSync(SHEETS_DIR).filter((f) => f.endsWith(".mjs") && !f.startsWith("_")).sort();
  const files = keys ? all.filter((f) => keys.includes(f.replace(/\.mjs$/, ""))) : all;
  const atlases = [];
  for (const file of files) {
    const mod = await import(pathToFileURL(join(SHEETS_DIR, file)).href);
    const atlas = mod.ATLAS;
    if (!atlas || !KEY_RE.test(atlas.key ?? "")) throw new Error(`actor: ${file} に ATLAS（key は英数字）が無い`);
    if (`${atlas.key}.mjs` !== file) throw new Error(`actor: ${file} の ATLAS.key はファイル名と同じにする（${atlas.key}）`);
    for (const sheet of atlas.sheets) {
      if (!sheet.key.startsWith(`${atlas.key}.`)) throw new Error(`actor: ${file} のシート ${sheet.key} は "${atlas.key}." で始める`);
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

/** 1 シートの全フレーム（方向 × フレーム）を描いて切り詰める。原点は作業面の (ox, oy) */
function renderSheet(sheet) {
  const cells = [];
  const dirs = sheet.dirs ?? 1;
  for (let d = 0; d < dirs; d++) {
    const angle = (d / dirs) * Math.PI * 2;
    for (let f = 0; f < sheet.frames; f++) {
      const frame = new ColorFrame(sheet.w, sheet.h, sheet.ox, sheet.oy, angle, sheet.mirror === true);
      sheet.draw(frame, f, { dir: d, angle });
      finish(frame, { outline: sheet.outline !== false });
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
        const c = cell.frame.rgba[(cell.box.y + y) * cell.frame.w + cell.box.x + x] ?? 0;
        if (!c) continue;
        const o = ((place.y + y) * packed.width + place.x + x) * 4;
        rgba[o] = (c >>> 24) & 255;
        rgba[o + 1] = (c >>> 16) & 255;
        rgba[o + 2] = (c >>> 8) & 255;
        rgba[o + 3] = c & 255;
      }
    }
  });
  let index = 0;
  const entries = sheets.map(({ sheet, cells }) => {
    const rects = [];
    const anchors = [];
    for (const cell of cells) {
      const place = packed.places[index++] ?? { x: 0, y: 0 };
      anchors.push(cell.frame.anchors);
      if (!cell.box) {
        rects.push(0, 0, 0, 0, 0, 0);
        continue;
      }
      rects.push(place.x, place.y, cell.w, cell.h, cell.frame.ox - cell.box.x, cell.frame.oy - cell.box.y);
    }
    const hasAnchors = anchors.some((a) => Object.keys(a).length > 0);
    return { key: sheet.key, frames: sheet.frames, dirs: sheet.dirs ?? 1, rects, anchors: hasAnchors ? anchors : undefined };
  });
  const json = {
    width: packed.width,
    height: packed.height,
    sheets: Object.fromEntries(
      entries.map((e) => [e.key, { atlas: atlas.key, frames: e.frames, dirs: e.dirs, rects: e.rects, ...(e.anchors ? { anchors: e.anchors } : {}) }]),
    ),
    meta: atlas.meta ?? null,
  };
  return { key: atlas.key, png: encodePng(packed.width, packed.height, rgba), width: packed.width, height: packed.height, entries, sheets, json: `${JSON.stringify(json)}\n` };
}

function ident(key) {
  return `actor_${key}`;
}

function indexSource(keys) {
  return [
    "// 生成物: npm run actor:gen（scripts/actor/gen.mjs）。手で直さない。docs/ideas/player-sprites.md",
    "// アトラスごとの中身は src/data/actor/<key>.gen.json（寸法・シートの矩形・位置の印・アトラスの付帯情報）",
    ...keys.map((k) => `import ${ident(k)} from "./actor/${k}.gen.json";`),
    "",
    "/** アトラス（public/ からの相対パスと寸法、付帯情報） */",
    "export const ACTOR_ATLASES = {",
    ...keys.map((k) => `  ${k}: { url: "assets/actor/${k}.png", width: ${ident(k)}.width, height: ${ident(k)}.height, meta: ${ident(k)}.meta },`),
    "} as const;",
    "",
    "export type ActorAtlasKey = keyof typeof ACTOR_ATLASES;",
    "",
    "/**",
    " * シート 1 つ。rects は `(dir * frames + frame) * 6` から [x, y, w, h, ox, oy]（(ox, oy) は矩形の左上から原点までのずれ、絵のドット）。",
    " * anchors は同じ順で、原点からの位置の印（肩・頭・銃口など）",
    " */",
    "export interface ActorSheetDef {",
    "  readonly atlas: string;",
    "  readonly frames: number;",
    "  readonly dirs: number;",
    "  readonly rects: readonly number[];",
    "  readonly anchors?: readonly Readonly<Record<string, readonly number[]>>[];",
    "}",
    "",
    "export const ACTOR_SHEETS: Record<string, ActorSheetDef> = {",
    ...keys.map((k) => `  ...${ident(k)}.sheets,`),
    "};",
    "",
  ].join("\n");
}

/** 確認用: 選んだ方向 × 全フレームを並べる（原点に赤い 1 ドット、位置の印に水色の 1 ドット） */
function writePreview(dir, a) {
  const SCALE = Number(argValue("--scale") ?? 4);
  const BG = [58, 52, 66];
  for (const { sheet, cells } of a.sheets) {
    const dirs = sheet.dirs ?? 1;
    const dirsArg = argValue("--dirs");
    const pick = dirs === 1 ? [0] : dirsArg ? dirsArg.split(",").map((v) => Number(v) % dirs) : [...Array(Math.min(dirs, 8)).keys()].map((i) => Math.round((i * dirs) / Math.min(dirs, 8)));
    const cw = sheet.w * SCALE;
    const ch = sheet.h * SCALE;
    const w = cw * sheet.frames;
    const h = ch * pick.length;
    const rgba = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) rgba.set([...BG, 255], i * 4);
    const put = (px, py, color) => {
      for (let sy = 0; sy < SCALE; sy++) for (let sx = 0; sx < SCALE; sx++) rgba.set(color, ((py + sy) * w + px + sx) * 4);
    };
    pick.forEach((d, di) => {
      for (let f = 0; f < sheet.frames; f++) {
        const cell = cells[d * sheet.frames + f];
        if (!cell) continue;
        const oy0 = di * ch;
        const ox0 = f * cw;
        for (let y = 0; y < sheet.h; y++) {
          for (let x = 0; x < sheet.w; x++) {
            const c = cell.frame.rgba[y * sheet.w + x] ?? 0;
            if (!c) continue;
            put(ox0 + x * SCALE, oy0 + y * SCALE, [(c >>> 24) & 255, (c >>> 16) & 255, (c >>> 8) & 255, 255]);
          }
        }
        if (!args.includes("--marks")) continue;
        put(ox0 + Math.floor(sheet.ox) * SCALE, oy0 + Math.floor(sheet.oy) * SCALE, [255, 60, 60, 255]);
        for (const [ax, ay] of Object.values(cell.frame.anchors)) {
          put(ox0 + Math.floor(sheet.ox + ax) * SCALE, oy0 + Math.floor(sheet.oy + ay) * SCALE, [80, 220, 255, 255]);
        }
      }
    });
    writeFileSync(join(dir, `${sheet.key}.png`), encodePng(w, h, rgba));
  }
}

const onlyAtlas = only?.split(".")[0];
const atlases = await discoverAtlases(onlyAtlas ? [onlyAtlas] : atlasFilter);
if (only) {
  const dir = previewDir ?? "actor-preview";
  mkdirSync(dir, { recursive: true });
  for (const atlas of atlases) {
    const sheets = atlas.sheets.filter((s) => s.key.startsWith(only));
    if (sheets.length) writePreview(dir, { sheets: sheets.map((sheet) => ({ sheet, cells: renderSheet(sheet) })) });
  }
  process.exit(0);
}
const unknown = (atlasFilter ?? []).filter((k) => !atlases.some((a) => a.key === k));
if (unknown.length) throw new Error(`actor: アトラスが無い: ${unknown.join(", ")}`);
const targets = atlasFilter ? atlases.filter((a) => atlasFilter.includes(a.key)) : atlases;
const built = targets.map(buildAtlas);
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
  console.log(same ? "actor: 生成物は最新" : "actor: 生成物が古い（npm run actor:gen）");
  process.exit(same ? 0 : 1);
}
mkdirSync(OUT_DIR, { recursive: true });
mkdirSync(JSON_DIR, { recursive: true });
for (const a of built) {
  writeFileSync(join(OUT_DIR, `${a.key}.png`), a.png);
  writeFileSync(join(JSON_DIR, `${a.key}.gen.json`), a.json);
  const cells = a.entries.reduce((n, e) => n + e.frames * e.dirs, 0);
  console.log(`actor: ${a.key}.png ${a.width}x${a.height}（シート ${a.entries.length}、フレーム ${cells}）`);
}
writeFileSync(INDEX, index);
if (previewDir) {
  mkdirSync(previewDir, { recursive: true });
  for (const a of built) writePreview(previewDir, a);
  console.log(`actor: 確認用 → ${previewDir}`);
}
