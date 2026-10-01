/**
 * 階の型「大洞窟」（cavern）。大広間の芯と衛星の小洞を通り道でつなぎ、広間の中に岩の島を置く。
 * 今はスタブ（null を返すだけ。呼び出し側が同じ rng を進めて作り直し、全部落ちたら旧生成器へ落ちる）。
 * 型のレーン（L1）が見本の gen を移植して中身を書く: docs/ideas/map-gen-impl.md 2-4（拡縮）・2-5（決定性と性能）、
 * 数値は data/balance/world/MAP_LAYOUT/cavern.json
 */
import type { LayoutGenerator } from "./types";

export const generateCavern: LayoutGenerator = () => null;
