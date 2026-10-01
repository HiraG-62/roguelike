/**
 * 階の型「断片の組み合わせ」（prefab）。手で描いた部屋の断片（PREFABS）を空き地に置き、L 字の廊下でつなぐ。
 * 今はスタブ（null を返すだけ。呼び出し側が同じ rng を進めて作り直し、全部落ちたら旧生成器へ落ちる）。
 * 型のレーン（L4）が見本の gen を移植して中身を書く: docs/ideas/map-gen-impl.md 2-4（拡縮）・2-5（決定性と性能）、
 * 数値は data/balance/world/MAP_LAYOUT/prefab.json
 */
import type { LayoutGenerator } from "./types";

export const generatePrefab: LayoutGenerator = () => null;
