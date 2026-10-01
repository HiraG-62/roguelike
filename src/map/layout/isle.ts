/**
 * 階の型「島と桟道」（isle）。穴の海に島（部屋）が浮かび、桟道でつなぐ。
 * 今はスタブ（null を返すだけ。呼び出し側が同じ rng を進めて作り直し、全部落ちたら旧生成器へ落ちる）。
 * 型のレーン（L2）が見本の gen を移植して中身を書く: docs/ideas/map-gen-impl.md 2-4（拡縮）・2-5（決定性と性能）、
 * 数値は data/balance/world/MAP_LAYOUT/isle.json
 */
import type { LayoutGenerator } from "./types";

export const generateIsle: LayoutGenerator = () => null;
