/**
 * 階の型「環状」（ring）。中央の大岩か池を輪の道が回り、外側の Voronoi の部屋と芯を突っ切る近道。
 * 今はスタブ（null を返すだけ。呼び出し側が同じ rng を進めて作り直し、全部落ちたら旧生成器へ落ちる）。
 * 型のレーン（L3）が見本の gen を移植して中身を書く: docs/ideas/map-gen-impl.md 2-4（拡縮）・2-5（決定性と性能）、
 * 数値は data/balance/world/MAP_LAYOUT/ring.json
 */
import type { LayoutGenerator } from "./types";

export const generateRing: LayoutGenerator = () => null;
