// ドット絵の作業台（tools/sprite-gen.html）の配線。Spriteloom で案を出し、見比べて選んだ案を Frame リテラルとしてコピーする。
// 開発用のページで、ゲーム本体からは読まない。手順は docs/recipes/sprite.md
import { lintFrames } from "../../scripts/sprite/lint.mjs";
import { VIEW_TEMPLATES } from "../../scripts/sprite/prompt.mjs";
import { RENDER_SCALE } from "../core/view";
import { PALETTE, PALETTE_RAMPS, SPRITES } from "../data/sprites";
import { spriteDots } from "../data/sprites/dots";
import {
  BACKGROUNDS,
  constName,
  editRequest,
  frameLiteral,
  generateRequest,
  paletteRgb,
  quantizeToRows,
  rowsToRgba,
  type Background,
  type RgbaImage,
  type SpriteloomRequest,
} from "./spriteGenCore";
import { DEFAULT_SPRITELOOM_PORT, requestSprites } from "./spriteloomClient";

type Mode = "generate" | "edit";

/** 拡大表示の長辺の目安（CSS px） */
const BIG_VIEW_PX = 240;
/** 元フレームの小さな確認表示の長辺（CSS px） */
const SOURCE_PREVIEW_PX = 64;
const DEFAULT_SIZE = 48;
const DEFAULT_VIEW = "side";
const DEFAULT_VARIANTS = 4;
const MAX_VARIANTS = 8;
/** 背景は床の色（PALETTE の l。cli.mjs の render と同じ） */
const FLOOR_CHAR = "l";
const FLOOR_FALLBACK = "#000000";
const PORT_QUERY = "port";
const COPIED_LABEL_MS = 1200;

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`#${id} が無い`);
  return node as T;
}

const form = el<HTMLFormElement>("form");
const subject = el<HTMLTextAreaElement>("subject");
const subjectCaption = el<HTMLSpanElement>("subject-caption");
const editFields = el<HTMLDivElement>("edit-fields");
const generateFields = el<HTMLDivElement>("generate-fields");
const extraLabel = el<HTMLLabelElement>("extra-label");
const fromKey = el<HTMLInputElement>("from-key");
const fromFrame = el<HTMLInputElement>("from-frame");
const sourcePreview = el<HTMLCanvasElement>("source-preview");
const viewSelect = el<HTMLSelectElement>("view");
const sizeInput = el<HTMLInputElement>("size");
const extraInput = el<HTMLInputElement>("extra");
const dotsSelect = el<HTMLSelectElement>("dots");
const variantsInput = el<HTMLInputElement>("variants");
const seedInput = el<HTMLInputElement>("seed");
const backgroundSelect = el<HTMLSelectElement>("background");
const portInput = el<HTMLInputElement>("port");
const freePalette = el<HTMLInputElement>("free-palette");
const compareKey = el<HTMLInputElement>("compare-key");
const constNameInput = el<HTMLInputElement>("const-name");
const runButton = el<HTMLButtonElement>("run");
const statusLine = el<HTMLDivElement>("status");
const results = el<HTMLElement>("results");
const floorColor = PALETTE[FLOOR_CHAR] ?? FLOOR_FALLBACK;

let mode: Mode = "generate";
let batchCount = 0;

function setStatus(msg: string, isError = false): void {
  statusLine.textContent = msg;
  statusLine.classList.toggle("error", isError);
}

function fillSelect(select: HTMLSelectElement, values: readonly string[], selected: string): void {
  for (const v of values) select.append(new Option(v, v, v === selected, v === selected));
}

function setup(): void {
  fillSelect(viewSelect, Object.keys(VIEW_TEMPLATES), DEFAULT_VIEW);
  fillSelect(backgroundSelect, BACKGROUNDS, "auto");
  const keys = el<HTMLDataListElement>("sprite-keys");
  for (const key of Object.keys(SPRITES).sort()) keys.append(new Option(key));
  const port = Number(new URLSearchParams(location.search).get(PORT_QUERY));
  portInput.value = String(Number.isInteger(port) && port > 0 ? port : DEFAULT_SPRITELOOM_PORT);
  variantsInput.value = String(DEFAULT_VARIANTS);
  sizeInput.value = String(DEFAULT_SIZE);
}

function setMode(next: Mode): void {
  mode = next;
  for (const b of form.querySelectorAll<HTMLButtonElement>(".tabs button")) b.setAttribute("aria-pressed", String(b.dataset.mode === next));
  editFields.hidden = next !== "edit";
  generateFields.hidden = next !== "generate";
  extraLabel.hidden = next !== "generate";
  subjectCaption.textContent = next === "edit" ? "指示（英語）" : "主題（英語）";
  subject.placeholder = next === "edit" ? "give it a red cape" : "skeleton knight with a rusty sword";
  if (next === "edit") syncSourceDots();
  drawSourcePreview();
}

function sourceRows(): readonly string[] | null {
  const frames = SPRITES[fromKey.value.trim()];
  return frames?.[Number(fromFrame.value) || 0] ?? null;
}

/** 描き変えの元を選んだら密度もそのキーに合わせる（lint と等倍表示の基準） */
function syncSourceDots(): void {
  const key = fromKey.value.trim();
  if (SPRITES[key]) dotsSelect.value = String(spriteDots(key));
}

/** RGBA を指定倍率で描いた canvas */
function imageCanvas(img: RgbaImage, scale: number): HTMLCanvasElement {
  const src = document.createElement("canvas");
  src.width = img.width;
  src.height = img.height;
  src.getContext("2d")?.putImageData(new ImageData(new Uint8ClampedArray(img.rgba), img.width, img.height), 0, 0);
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(img.width * scale));
  out.height = Math.max(1, Math.round(img.height * scale));
  const ctx = out.getContext("2d");
  if (!ctx) return out;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(src, 0, 0, out.width, out.height);
  return out;
}

function drawSourcePreview(): void {
  const rows = sourceRows();
  const ctx = sourcePreview.getContext("2d");
  if (!ctx) return;
  if (mode !== "edit" || !rows) {
    sourcePreview.width = sourcePreview.height = 1;
    return;
  }
  const img = rowsToRgba(rows, PALETTE);
  const scale = Math.max(1, Math.floor(SOURCE_PREVIEW_PX / Math.max(img.width, img.height)));
  const big = imageCanvas(img, scale);
  sourcePreview.width = big.width;
  sourcePreview.height = big.height;
  ctx.fillStyle = floorColor;
  ctx.fillRect(0, 0, big.width, big.height);
  ctx.drawImage(big, 0, 0);
}

function pngBase64(img: RgbaImage): string {
  const c = imageCanvas(img, 1);
  return c.toDataURL("image/png").split(",")[1] ?? "";
}

function parseSize(raw: string): { width: number; height: number } | null {
  const m = /^(\d+)(?:x(\d+))?$/.exec(raw.trim());
  if (!m) return null;
  return { width: Number(m[1]), height: Number(m[2] ?? m[1]) };
}

function optionalSeed(): number | undefined {
  const raw = seedInput.value.trim();
  return raw === "" ? undefined : Number(raw);
}

function variantCount(): number {
  return Math.min(MAX_VARIANTS, Math.max(1, Math.round(Number(variantsInput.value) || DEFAULT_VARIANTS)));
}

/** 画面の入力から依頼を組む。足りなければ理由の文字列 */
function buildRequest(): SpriteloomRequest | string {
  const text = subject.value.trim();
  if (!text) return mode === "edit" ? "指示を書く" : "主題を書く";
  const common = {
    variants: variantCount(),
    background: backgroundSelect.value as Background,
    seed: optionalSeed(),
    palette: freePalette.checked ? undefined : paletteRgb(PALETTE),
  };
  const id = `page-${Date.now()}`;
  if (mode === "edit") {
    const rows = sourceRows();
    if (!rows) return `'${fromKey.value}' の ${fromFrame.value} 番のフレームが無い`;
    const img = rowsToRgba(rows, PALETTE);
    return editRequest(id, { ...common, instruction: text, width: img.width, height: img.height, imagePngB64: pngBase64(img) });
  }
  const size = parseSize(sizeInput.value);
  if (!size) return "サイズは N か WxH";
  return generateRequest(id, { ...common, ...size, subject: text, view: viewSelect.value, extra: extraInput.value.trim() });
}

function button(label: string, onClick: (b: HTMLButtonElement) => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = label;
  b.addEventListener("click", () => onClick(b));
  return b;
}

function flashLabel(b: HTMLButtonElement, label: string): void {
  const original = b.textContent;
  b.textContent = label;
  setTimeout(() => (b.textContent = original), COPIED_LABEL_MS);
}

/** 床色の台に拡大表示と、ゲーム内の大きさ（論理 px x RENDER_SCALE / 密度）を並べる */
function viewsOf(img: RgbaImage, dots: number, bigScale: number): HTMLDivElement {
  const views = document.createElement("div");
  views.className = "views";
  for (const scale of [bigScale, RENDER_SCALE / dots]) {
    const stage = document.createElement("div");
    stage.className = "stage";
    stage.style.background = floorColor;
    stage.append(imageCanvas(img, scale));
    views.append(stage);
  }
  return views;
}

function lintDetails(key: string, rows: readonly string[], dots: number): HTMLDetailsElement {
  const r = lintFrames(key, [rows], PALETTE, dots, PALETTE_RAMPS);
  const details = document.createElement("details");
  const summary = document.createElement("summary");
  summary.textContent = r.warn ? `様式書の注意 ${r.warn} 件` : "様式書の注意なし";
  if (r.warn) summary.className = "warn";
  const pre = document.createElement("pre");
  pre.textContent = r.lines.join("\n");
  details.append(summary, pre);
  return details;
}

function variantCard(img: RgbaImage, index: number, seed: number | undefined, dots: number, bigScale: number): HTMLDivElement {
  const card = document.createElement("div");
  card.className = "card";
  const { rows, offPalette } = quantizeToRows(img, PALETTE);
  // 表示も PALETTE に丸めた後の絵にする（コピーされるのはこちら）
  const shown = rowsToRgba(rows, PALETTE);
  const meta = document.createElement("div");
  meta.className = "meta";
  meta.textContent = `#${index} ${img.width}x${img.height} seed ${seed ?? "?"}${offPalette ? `／PALETTE 外 ${offPalette}px を丸めた` : ""}`;
  const actions = document.createElement("div");
  actions.className = "actions";
  actions.append(
    button("Frame をコピー", (b) => {
      const name = constName(constNameInput.value);
      void navigator.clipboard.writeText(frameLiteral(name, rows)).then(
        () => flashLabel(b, "コピーした"),
        () => setStatus("クリップボードに書けない", true),
      );
    }),
  );
  if (seed !== undefined) actions.append(button("この seed で", () => (seedInput.value = String(seed))));
  card.append(viewsOf(shown, dots, bigScale), meta, actions, lintDetails(`#${index}`, rows, dots));
  return card;
}

function compareCard(key: string, bigScaleFor: (img: RgbaImage) => number): HTMLDivElement | null {
  const rows = SPRITES[key]?.[0];
  if (!rows) return null;
  const card = document.createElement("div");
  card.className = "card";
  const img = rowsToRgba(rows, PALETTE);
  const meta = document.createElement("div");
  meta.className = "meta";
  meta.textContent = `比較: ${key}（密度 ${spriteDots(key)}）`;
  card.append(viewsOf(img, spriteDots(key), bigScaleFor(img)), meta);
  return card;
}

function renderBatch(req: SpriteloomRequest, images: RgbaImage[], seeds: number[]): void {
  batchCount++;
  const dots = Number(dotsSelect.value) || 1;
  const longest = Math.max(1, ...images.map((im) => Math.max(im.width, im.height)));
  const bigScale = Math.max(1, Math.floor(BIG_VIEW_PX / longest));
  const batch = document.createElement("div");
  batch.className = "batch";
  const h2 = document.createElement("h2");
  const source = req.mode === "edit" ? `${fromKey.value} [${fromFrame.value}] を描き変え: ` : "";
  h2.textContent = `${batchCount}. ${source}${req.prompt}`;
  const cards = document.createElement("div");
  cards.className = "cards";
  images.forEach((im, i) => cards.append(variantCard(im, i, seeds[i], dots, bigScale)));
  const key = compareKey.value.trim();
  // 比較は論理サイズを揃える: 案の拡大率 x 案の密度 / 比較の密度
  const compare = key ? compareCard(key, () => (bigScale * dots) / spriteDots(key)) : null;
  if (compare) cards.append(compare);
  batch.append(h2, cards);
  results.querySelector(".empty")?.remove();
  results.prepend(batch);
}

async function run(): Promise<void> {
  if (runButton.disabled) return;
  const req = buildRequest();
  if (typeof req === "string") {
    setStatus(req, true);
    return;
  }
  runButton.disabled = true;
  setStatus(`送る文: ${req.prompt}`);
  try {
    const { images, seeds } = await requestSprites(Number(portInput.value) || DEFAULT_SPRITELOOM_PORT, req, (msg) => setStatus(msg));
    renderBatch(req, images, seeds);
    setStatus(`${images.length} 案`);
  } catch (e) {
    setStatus(e instanceof Error ? e.message : String(e), true);
  } finally {
    runButton.disabled = false;
  }
}

setup();
form.addEventListener("submit", (e) => {
  e.preventDefault();
  void run();
});
form.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    void run();
  }
});
for (const b of form.querySelectorAll<HTMLButtonElement>(".tabs button")) {
  b.addEventListener("click", () => setMode(b.dataset.mode === "edit" ? "edit" : "generate"));
}
fromKey.addEventListener("input", () => {
  syncSourceDots();
  drawSourcePreview();
});
fromFrame.addEventListener("input", drawSourcePreview);
