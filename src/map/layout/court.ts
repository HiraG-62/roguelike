/**
 * 階の型「中庭・寺院」（court）。軸に沿って門 → 参道 → 中庭 → 本堂（主の間）。外回りの廊下でループ。
 * 今はスタブ（null を返すだけ。呼び出し側が同じ rng を進めて作り直し、全部落ちたら旧生成器へ落ちる）。
 * 型のレーン（L4）が見本の gen を移植して中身を書く: docs/ideas/map-gen-impl.md 2-4（拡縮）・2-5（決定性と性能）、
 * 数値は data/balance/world/MAP_LAYOUT/court.json
 */
import type { LayoutGenerator } from "./types";

export const generateCourt: LayoutGenerator = () => null;
