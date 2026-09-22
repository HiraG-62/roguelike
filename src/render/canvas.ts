import type { GameState } from "../core/state";
import { type GameMap, Tile, getTile, toIndex } from "../map/grid";

/** 論理グリッドは固定。Canvas の拡大縮小でウィンドウに合わせる */
export const GRID_COLS = 80;
export const GRID_ROWS = 24;
/** 上部 1 行をステータス表示に使う */
export const STATUS_ROWS = 1;
/** 下部にメッセージログ */
export const LOG_ROWS = 5;
const MAP_ROW_OFFSET = STATUS_ROWS;
const LOG_ROW_OFFSET = STATUS_ROWS + GRID_ROWS;

const CELL_W = 12;
const CELL_H = 20;
const FONT = `${CELL_H - 2}px "Consolas", "Courier New", monospace`;

const COLOR_BG = "#000000";
const COLOR_STATUS = "#c0c0c0";
const COLOR_LOG_OLD = "#707070";

/** 可視 / 記憶 で色を分ける。記憶は暗く落とす */
const TILE_STYLE: Record<Tile, { glyph: string; lit: string; remembered: string }> = {
  [Tile.Wall]: { glyph: "#", lit: "#9a8f7a", remembered: "#3d3a33" },
  [Tile.Floor]: { glyph: ".", lit: "#6a6a6a", remembered: "#262626" },
  [Tile.StairsDown]: { glyph: ">", lit: "#ffd75f", remembered: "#6b5a28" },
};

export class CanvasRenderer {
  private readonly ctx: CanvasRenderingContext2D;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D context unavailable");
    this.ctx = ctx;
    canvas.width = GRID_COLS * CELL_W;
    canvas.height = (STATUS_ROWS + GRID_ROWS + LOG_ROWS) * CELL_H;
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
    this.drawMap(state.map, state.visible, state.explored);
    for (const e of state.entities) {
      if (!state.visible[toIndex(state.map, e.pos.x, e.pos.y)]) continue;
      this.drawGlyph(e.glyph, e.color, e.pos.x, e.pos.y + MAP_ROW_OFFSET);
    }
    this.drawLog(state);
  }

  private drawStatus(state: GameState): void {
    this.drawText(`Depth: ${state.depth}   Turn: ${state.turn}   Seed: ${state.seed}`, COLOR_STATUS, 0, 0);
  }

  private drawMap(map: GameMap, visible: Uint8Array, explored: Uint8Array): void {
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const idx = toIndex(map, x, y);
        if (!explored[idx]) continue;
        const style = TILE_STYLE[getTile(map, x, y)];
        const color = visible[idx] ? style.lit : style.remembered;
        this.drawGlyph(style.glyph, color, x, y + MAP_ROW_OFFSET);
      }
    }
  }

  private drawLog(state: GameState): void {
    const recent = state.log.slice(-LOG_ROWS);
    recent.forEach((msg, i) => {
      // 現在ターンのメッセージだけ本来の色、古いものは灰色に落とす
      const color = msg.turn === state.turn ? msg.color : COLOR_LOG_OLD;
      this.drawText(msg.text, color, 0, LOG_ROW_OFFSET + i);
    });
  }

  private drawGlyph(glyph: string, color: string, col: number, row: number): void {
    this.ctx.fillStyle = color;
    this.ctx.fillText(glyph, col * CELL_W + 2, row * CELL_H + 1);
  }

  private drawText(text: string, color: string, col: number, row: number): void {
    this.ctx.fillStyle = color;
    this.ctx.fillText(text, col * CELL_W + 2, row * CELL_H + 1);
  }
}
