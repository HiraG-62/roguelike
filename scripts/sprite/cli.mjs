// ドット絵の道具箱: ppnpm run sprite <render | strip | import | palette | lint | gen> …
// 真実は src/data/sprites*.ts のピクセルマップ。Aseprite / PNG はその作業台で、行き来はこのスクリプトで行う。
// 手順は docs/recipes/sprite.md
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import { encodePng } from "../fx/png.mjs";
import { buildAseprite, exportStrip } from "./aseprite.mjs";
import { lintFrames } from "./lint.mjs";
import { loadSprites } from "./load.mjs";
import { Canvas, frameToRgba, hexToRgb, loadPng, rgbaToRows } from "./raster.mjs";
import { VIEW_TEMPLATES, assemblePrompt, requestSprites } from "./spriteloom.mjs";

const DEFAULT_SCALE = 8;
/** フレームとフレーム・キーとキーの間（論理 px） */
const GAP = 2;
const MARGIN = 2;
/** 格子線を引く最小の拡大率 */
const GRID_MIN_SCALE = 4;
const GRID_RGB = [0, 0, 0];
const GRID_ALPHA = 56;
const CELL_RGB = [255, 255, 255];
const CELL_ALPHA = 90;
/** 背景 floor は床の色（PALETTE の l） */
const FLOOR_CHAR = "l";
/** gen の既定: 密度 2 の人型（48x48）の寸法と、1 回に出す案の数 */
const GEN_DEFAULT_SIZE = 48;
const GEN_DEFAULT_VARIANTS = 4;
const GEN_DEFAULT_VIEW = "side";
const USAGE = `使い方:
  render <key>[,<key>…] --out <png> [--scale <N>] [--bg floor|none|#rrggbb] [--grid] [--beside <png>]
      拡大して並べた確認用 PNG（フレームは横、キーは縦。--beside で参考画像を右に置く）
      拡大率は既定でキーごとに ${DEFAULT_SCALE} / 密度（src/data/sprites/dots.ts の spriteDots）。
      密度 1 と密度 2 のキーを並べても論理サイズどおりの見た目で揃う。--scale を指定すると全キー同じ拡大率を強制する
  strip <key> --out <png> [--ase <aseprite>]
      等倍・透明背景の横一列 PNG。--ase を付けると Aseprite でフレームに分けた .aseprite も作る（PALETTE 付き）
  import <png | aseprite> [--cell <N | WxH>] [--name <NAME>] [--nearest]
      横一列の PNG（または .aseprite）をフレームの TS リテラルにして標準出力へ。PALETTE に無い色は失敗（--nearest で最も近い色に丸める）
  palette [--gpl <path>] [--json]
      PALETTE を GIMP パレット（Aseprite で読める）/ hex の JSON 配列で出す
  lint <key>[,<key>…]
      様式書の決まりで点検（輪郭・頭上・最下段・白の量・3 段 / 5 段）。判定は spriteDots(key) の密度に合わせる
  gen "<主題（英語）>" --out <png> [--size ${GEN_DEFAULT_SIZE} | WxH] [--variants ${GEN_DEFAULT_VARIANTS}] [--view ${Object.keys(VIEW_TEMPLATES).join("|")}]
      [--extra "<追記>"] [--seed N] [--bg auto|remove|keep] [--free-palette] [--port <N>]
  gen "<指示（英語）>" --from <key> [--frame N] --out <png> …
      Spriteloom（ローカルの画像生成サーバー）で案を作る。--from で既存スプライトを指示で描き変える。
      色は PALETTE に固定（--free-palette で外す）。<out> に拡大の一覧、<out の名前>-<番号>.png に等倍の案を書く`;

function parseArgs(argv) {
  const positional = [];
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) {
      positional.push(a);
      continue;
    }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) opts[key] = true;
    else {
      opts[key] = next;
      i++;
    }
  }
  return { positional, opts };
}

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

function pickFrames(SPRITES, key) {
  const frames = SPRITES[key];
  if (!frames) fail(`SPRITES に '${key}' が無い`);
  return frames;
}

function writeOut(path, buf) {
  mkdirSync(dirname(resolve(path)), { recursive: true });
  writeFileSync(path, buf);
}

function bgRgb(bg, PALETTE) {
  if (bg === "none") return null;
  if (typeof bg === "string" && bg.startsWith("#")) return hexToRgb(bg);
  return hexToRgb(PALETTE[FLOOR_CHAR]);
}

/**
 * キーごとの行（フレームを横に並べる）を 1 枚に合成する。
 * 行ごとに違う拡大率 `r.scale` を持てる（密度の違うキーを並べるとき、既定値は `8 / dots(key)` が入る）。
 * 行が拡大率を持たなければ渡された既定の `scale` を使う。margin と行間の gap は渡された既定の `scale` で揃える
 */
function compose({ rows, scale, bg, grid, beside, gap, margin }) {
  const rowScale = (r) => r.scale ?? scale;
  const rowWidth = (r) => {
    const rs = rowScale(r);
    return r.frames.reduce((s, f) => s + f.width * rs, 0) + gap * rs * (r.frames.length - 1);
  };
  const rowHeight = (r) => r.frames[0].height * rowScale(r);
  let width = Math.max(...rows.map(rowWidth));
  const besideW = beside ? beside.width * scale + gap * scale : 0;
  width += besideW;
  const height = rows.reduce((s, r) => s + rowHeight(r), 0) + gap * scale * (rows.length - 1);
  const marginPx = margin * scale;
  const canvas = new Canvas(Math.round(width + marginPx * 2), Math.round(height + marginPx * 2));
  if (bg) canvas.fill(0, 0, canvas.width, canvas.height, bg);

  let y = marginPx;
  const cells = [];
  for (const r of rows) {
    const rs = rowScale(r);
    let x = marginPx;
    for (const f of r.frames) {
      canvas.blitRgba(x, y, f, rs);
      cells.push({ x, y, w: f.width * rs, h: f.height * rs, scale: rs });
      x += f.width * rs + gap * rs;
    }
    y += rowHeight(r) + gap * scale;
  }
  if (beside) canvas.blitRgba(marginPx + width - beside.width * scale, marginPx, beside, scale);

  if (grid) {
    for (const c of cells) {
      if (c.scale < GRID_MIN_SCALE) continue;
      for (let gx = 0; gx <= c.w; gx += c.scale) {
        for (let py = 0; py < c.h; py++) canvas.blend(c.x + gx, c.y + py, gx === 0 || gx === c.w ? CELL_RGB : GRID_RGB, gx === 0 || gx === c.w ? CELL_ALPHA : GRID_ALPHA);
      }
      for (let gy = 0; gy <= c.h; gy += c.scale) {
        for (let px = 0; px < c.w; px++) canvas.blend(c.x + px, c.y + gy, gy === 0 || gy === c.h ? CELL_RGB : GRID_RGB, gy === 0 || gy === c.h ? CELL_ALPHA : GRID_ALPHA);
      }
    }
  }
  return canvas;
}

async function cmdRender(keys, opts) {
  if (!opts.out) fail("--out <png> が要る");
  const { PALETTE, SPRITES, spriteDots } = await loadSprites();
  const forcedScale = opts.scale !== undefined ? Number(opts.scale) : undefined;
  const ambientScale = forcedScale ?? DEFAULT_SCALE;
  const rows = keys.map((key) => ({
    key,
    scale: forcedScale ?? DEFAULT_SCALE / spriteDots(key),
    frames: pickFrames(SPRITES, key).map((f) => frameToRgba(f, PALETTE)),
  }));
  const beside = opts.beside ? loadPng(readFileSync(opts.beside)) : null;
  const canvas = compose({ rows, scale: ambientScale, bg: bgRgb(opts.bg, PALETTE), grid: Boolean(opts.grid), beside, gap: GAP, margin: MARGIN });
  writeOut(opts.out, encodePng(canvas.width, canvas.height, canvas.rgba));
  console.log(`${opts.out}: ${keys.join(", ")}（${rows.map((r) => `${r.key} x${r.scale} ${r.frames.length} 枚`).join(" / ")}）`);
}

function gplText(PALETTE) {
  const lines = ["GIMP Palette", "Name: roguelike", "Columns: 8", "#"];
  for (const [ch, hex] of Object.entries(PALETTE)) {
    const [r, g, b] = hexToRgb(hex);
    lines.push(`${String(r).padStart(3)} ${String(g).padStart(3)} ${String(b).padStart(3)}\t${ch}`);
  }
  return `${lines.join("\n")}\n`;
}

async function cmdStrip(keys, opts) {
  if (!opts.out) fail("--out <png> が要る");
  const key = keys[0];
  const { PALETTE, SPRITES } = await loadSprites();
  const frames = pickFrames(SPRITES, key).map((f) => frameToRgba(f, PALETTE));
  const canvas = compose({ rows: [{ key, frames }], scale: 1, bg: null, grid: false, beside: null, gap: 0, margin: 0 });
  writeOut(opts.out, encodePng(canvas.width, canvas.height, canvas.rgba));
  console.log(`${opts.out}: ${key} を横一列（${frames.length} 枚 x ${frames[0].width}x${frames[0].height}）`);
  if (!opts.ase) return;
  const gpl = join(dirname(resolve(opts.ase)), "roguelike.gpl");
  writeOut(gpl, gplText(PALETTE));
  const out = buildAseprite({ strip: opts.out, frameW: frames[0].width, frameH: frames[0].height, gpl, out: opts.ase });
  console.log(out.trim());
}

function parseCell(cell, img) {
  if (cell === undefined) return { w: img.height, h: img.height };
  const m = /^(\d+)(?:x(\d+))?$/.exec(String(cell));
  if (!m) fail("--cell は N か WxH");
  return { w: Number(m[1]), h: Number(m[2] ?? m[1]) };
}

async function cmdImport(files, opts) {
  const src = files[0];
  if (!src) fail("PNG か .aseprite のパスが要る");
  let png = src;
  if (extname(src).toLowerCase() === ".aseprite") {
    png = join(tmpdir(), `${basename(src, ".aseprite")}.strip.png`);
    exportStrip(src, png);
  }
  const img = loadPng(readFileSync(png));
  const cell = parseCell(opts.cell, img);
  if (img.width % cell.w !== 0 || img.height !== cell.h) fail(`画像 ${img.width}x${img.height} が 1 セル ${cell.w}x${cell.h} の横一列になっていない`);
  const { PALETTE } = await loadSprites();
  const name = String(opts.name ?? "FRAME");
  const count = img.width / cell.w;
  const allUnknown = new Map();
  const out = [];
  for (let i = 0; i < count; i++) {
    const { rows, unknown } = rgbaToRows(img, i * cell.w, 0, cell.w, cell.h, PALETTE, { nearest: Boolean(opts.nearest) });
    for (const [hex, n] of unknown) allUnknown.set(hex, (allUnknown.get(hex) ?? 0) + n);
    out.push(`const ${name}${count > 1 ? `_${i}` : ""}: Frame = [\n${rows.map((r) => `  "${r}",`).join("\n")}\n];`);
  }
  if (allUnknown.size) {
    const list = [...allUnknown].map(([hex, n]) => `${hex} x${n}`).join(", ");
    if (!opts.nearest) fail(`PALETTE に無い色: ${list}\n（PALETTE の色で塗り直すか、--nearest で最も近い色に丸める）`);
    console.error(`PALETTE に無い色を最も近い色に丸めた: ${list}`);
  }
  console.log(out.join("\n\n"));
}

async function cmdPalette(opts) {
  const { PALETTE } = await loadSprites();
  if (opts.gpl) {
    writeOut(opts.gpl, gplText(PALETTE));
    console.log(`${opts.gpl}: ${Object.keys(PALETTE).length} 色`);
  }
  if (opts.json || !opts.gpl) console.log(JSON.stringify(Object.values(PALETTE)));
}

async function cmdLint(keys) {
  const { PALETTE, SPRITES, PALETTE_RAMPS, spriteDots } = await loadSprites();
  let warn = 0;
  for (const key of keys) {
    const r = lintFrames(key, pickFrames(SPRITES, key), PALETTE, spriteDots(key), PALETTE_RAMPS);
    console.log(r.lines.join("\n"));
    warn += r.warn;
  }
  console.log(warn ? `注意 ${warn} 件` : "注意なし");
}

function parseSize(size) {
  const m = /^(\d+)(?:x(\d+))?$/.exec(String(size ?? GEN_DEFAULT_SIZE));
  if (!m) fail("--size は N か WxH");
  return { width: Number(m[1]), height: Number(m[2] ?? m[1]) };
}

async function cmdGen(text, opts) {
  if (!text) fail("主題（または --from のときは指示）が要る");
  if (!opts.out) fail("--out <png> が要る");
  const { PALETTE, SPRITES } = await loadSprites();
  const palette = opts["free-palette"] ? undefined : Object.values(PALETTE).map(hexToRgb);
  const req = { variants: Number(opts.variants ?? GEN_DEFAULT_VARIANTS), background: String(opts.bg ?? "auto"), palette };
  if (opts.seed !== undefined) req.seed = Number(opts.seed);
  if (opts.from) {
    const frame = pickFrames(SPRITES, String(opts.from))[Number(opts.frame ?? 0)];
    if (!frame) fail(`'${opts.from}' に ${opts.frame} 番のフレームが無い`);
    const src = frameToRgba(frame, PALETTE);
    Object.assign(req, { mode: "edit", prompt: text, width: src.width, height: src.height, imagePngB64: encodePng(src.width, src.height, src.rgba).toString("base64") });
  } else {
    Object.assign(req, { mode: "generate", prompt: assemblePrompt(String(opts.view ?? GEN_DEFAULT_VIEW), text, opts.extra ? String(opts.extra) : ""), ...parseSize(opts.size) });
  }
  console.error(`送る文: ${req.prompt}`);
  const { images, seeds } = await requestSprites(opts.port ? Number(opts.port) : undefined, req).catch((e) => fail(e.message));
  const stem = join(dirname(opts.out), basename(opts.out, extname(opts.out)));
  images.forEach((im, i) => writeOut(`${stem}-${i}.png`, encodePng(im.width, im.height, im.rgba)));
  const canvas = compose({ rows: [{ key: "gen", frames: images }], scale: DEFAULT_SCALE, bg: bgRgb(opts.bg === "keep" ? "none" : undefined, PALETTE), grid: false, beside: null, gap: GAP, margin: MARGIN });
  writeOut(opts.out, encodePng(canvas.width, canvas.height, canvas.rgba));
  console.log(`${opts.out}: ${images.length} 案（${images.map((im, i) => `${stem}-${i}.png ${im.width}x${im.height} seed ${seeds[i] ?? "?"}`).join(" / ")}）`);
}

const { positional, opts } = parseArgs(process.argv.slice(2));
const [cmd, target] = positional;
const keys = (target ?? "").split(",").filter(Boolean);
if (cmd === "render" && keys.length) await cmdRender(keys, opts);
else if (cmd === "strip" && keys.length) await cmdStrip(keys, opts);
else if (cmd === "import") await cmdImport(positional.slice(1), opts);
else if (cmd === "palette") await cmdPalette(opts);
else if (cmd === "lint" && keys.length) await cmdLint(keys);
else if (cmd === "gen") await cmdGen(positional.slice(1).join(" "), opts);
else {
  console.log(USAGE);
  process.exit(cmd ? 1 : 0);
}
