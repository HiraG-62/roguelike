/**
 * 階の型「掘り手の迷い道」（drunk）。掘り手が目印から目印へ迷いながら掘る。溜まりが部屋になる。
 * 今はスタブ（null を返すだけ。呼び出し側が同じ rng を進めて作り直し、全部落ちたら旧生成器へ落ちる）。
 * 型のレーン（L1）が見本の gen を移植して中身を書く: docs/ideas/map-gen-impl.md 2-4（拡縮）・2-5（決定性と性能）、
 * 数値は data/balance/world/MAP_LAYOUT/drunk.json
 */
import type { LayoutGenerator } from "./types";

export const generateDrunk: LayoutGenerator = () => null;
