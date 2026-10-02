// ink.mjs の型（src のテストから読むため）
export interface InkFrame {
  readonly w: number;
  readonly h: number;
  readonly cx: number;
  readonly cy: number;
  readonly grid: Uint8Array;
  set(ix: number, iy: number, level: number): void;
}
export function inkify(frame: InkFrame, seed: number, frameSeed?: number): void;
