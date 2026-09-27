// lint.mjs の型（src/tools から読むため）
export function lintFrames(
  key: string,
  frames: readonly (readonly string[])[],
  palette: Readonly<Record<string, string>>,
  dots?: number,
  ramps?: Readonly<Record<string, readonly string[]>>,
): { lines: string[]; warn: number };
