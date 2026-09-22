import type { GameState } from "../core/state";
import { type GameMap, Tile, getTile } from "../map/grid";

/** 論理グリッドは固定。Canvas の拡大縮小でウィンドウに合わせる */
export const GRID_COLS = 80;
export const GRID_ROWS = 24;
/** 上部 1 行をステータス表示に使う */
export const STATUS_ROWS = 1;

const CELL_W = 12;
const CELL_H = 20;
const FONT = `${CELL_H - 2}px "Consolas", "Courier New", monospace`;

const COLOR_BG = "#000000";
const COLOR_WALL = "#7a7a7a";
const COLOR_FLOOR = "#3a3a3a";
const COLOR_STAIRS = "#ffd75f";
const COLOR_STATUS = "#c0c0c0";

const GLYPH: Record<Tile, string> = {
  [Tile.Wall]: "#",
  [Tile.Floor]: ".",
  [Tile.StairsDown]: ">",
};
const TILE_COLOR: Record<Tile, string> = {
  [Tile.Wall]: COLOR_WALL,
  [Tile.Floor]: COLOR_FLOOR,
  [Tile.StairsDown]: COLOR_STAIRS,
};

export class CanvasRenderer {
  private readonly ctx: CanvasRenderingContext2D;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D context unavailable");
    this.ctx = ctx;
    canvas.width = GRID_COLS * CELL_W;
    canvas.height = (GRID_ROWS + STATUS_ROWS) * CELL_H;
    this.fitToWindow();
    window.addEventListener("resize", () => this.fitToWindow());
  }

  private fitToWindow(): void {
    const scale = Math.min(
      window.innerWidth / this.canvas.width,
      window.innerHeight / this.canvas.height,
    );
    this.canvas.style.width = `${Math.floor(this.canvas.width * scale)}px`;
    this.canvas.style.height = `${Math.floor(this.canvas.height * scale)}px`;
  }

  render(state: GameState): void {
    const { ctx } = this;
    ctx.fillStyle = COLOR_BG;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.font = FONT;
    ctx.textBaseline = "top";

    this.drawStatus(state);
    this.drawMap(state.map);
    for (const e of state.entities) {
      this.drawGlyph(e.glyph, e.color, e.pos.x, e.pos.y + STATUS_ROWS);
    }
  }

  private drawStatus(state: GameState): void {
    this.ctx.fillStyle = COLOR_STATUS;
    this.ctx.fillText(`Depth: ${state.depth}   Seed: ${state.seed}`, 2, 1);
  }

  private drawMap(map: GameMap): void {
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const tile = getTile(map, x, y);
        this.drawGlyph(GLYPH[tile], TILE_COLOR[tile], x, y + STATUS_ROWS);
      }
    }
  }

  private drawGlyph(glyph: string, color: string, col: number, row: number): void {
    this.ctx.fillStyle = color;
    this.ctx.fillText(glyph, col * CELL_W + 2, row * CELL_H + 1);
  }
}
