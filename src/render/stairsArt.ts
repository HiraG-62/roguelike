// 下りの階段の章別の絵（docs/ideas/map-visual-impl.md 3 章の「階段は置物の絵のレーンで密度 2 の章別の絵へ」）。
// 絵は data/sprites/stairs.ts の役の文字で、章のテーマの配色で塗る（置物と同じ当て方）。
// 階段は焼かずに上描きで毎フレーム描くので、テーマごとに 1 回だけ canvas を作って持つ。拠点（門前町）は今の絵のまま。
import { STAIRS_DOTS, STAIRS_ROLES, STAIRS_SPRITES, type StairsStyle } from "../data/sprites/stairs";
import { MAP_PROP_CLEAR } from "../data/sprites/mapProps";
import { TILE_SIZE } from "../map/grid";
import { roleColor } from "./mapDecor";
import type { MapPalette, MapStyle, MapTheme } from "./mapTypes";

const COLOR_TABLE_SIZE = 128;
const OUTLINE_CHAR = "k";

/** 章の様式 → 階段の絵の様式。拠点は null（今の絵） */
export function stairsStyleOf(style: MapStyle): StairsStyle | null {
  return style === "town" ? null : style;
}

/** 役の文字 → 色（文字コードで引く。0 は透明） */
function stairsColors(P: MapPalette, outline: keyof MapPalette | undefined): Uint32Array {
  const table = new Uint32Array(COLOR_TABLE_SIZE);
  for (const [ch, role] of Object.entries(STAIRS_ROLES)) {
    table[ch.charCodeAt(0)] = ch === OUTLINE_CHAR && outline ? P[outline] : roleColor(P, role);
  }
  return table;
}

/** 階段の画素（STAIRS_DOTS 四方の行優先、ABGR。0 は透明）。同じテーマなら同じ画素（純関数） */
export function stairsPixels(theme: MapTheme): Uint32Array | null {
  const style = stairsStyleOf(theme.style);
  if (!style) return null;
  const sprite = STAIRS_SPRITES[style];
  const colors = stairsColors(theme.palette, sprite.outline);
  const out = new Uint32Array(STAIRS_DOTS * STAIRS_DOTS);
  sprite.rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      if (row[x] === MAP_PROP_CLEAR) continue;
      out[y * STAIRS_DOTS + x] = colors[row.charCodeAt(x)] ?? 0;
    }
  });
  return out;
}

/** テーマごとの階段の canvas（初めて描くときに 1 回だけ作る） */
export class StairsArt {
  private readonly cache = new Map<MapTheme, HTMLCanvasElement | null>();

  get(theme: MapTheme): HTMLCanvasElement | null {
    const hit = this.cache.get(theme);
    if (hit !== undefined) return hit;
    const pixels = stairsPixels(theme);
    const canvas = pixels ? canvasOf(pixels) : null;
    this.cache.set(theme, canvas);
    return canvas;
  }

  /** マス (px, py)（論理 px）に 1 マスの大きさで描く。密度 2 の絵を論理 16px へ縮めて置く */
  draw(ctx: CanvasRenderingContext2D, theme: MapTheme, px: number, py: number): boolean {
    const canvas = this.get(theme);
    if (!canvas) return false;
    ctx.drawImage(canvas, px, py, TILE_SIZE, TILE_SIZE);
    return true;
  }
}

function canvasOf(pixels: Uint32Array): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = STAIRS_DOTS;
  canvas.height = STAIRS_DOTS;
  const g = canvas.getContext("2d");
  if (!g) return canvas;
  // ABGR の 32bit をそのまま RGBA のバイト列として写す（リトルエンディアン。mapChunks と同じ）
  const img = new ImageData(STAIRS_DOTS, STAIRS_DOTS);
  new Uint32Array(img.data.buffer).set(pixels);
  g.putImageData(img, 0, 0);
  return canvas;
}
