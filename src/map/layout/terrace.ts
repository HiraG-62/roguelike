/**
 * 階の型「縦穴・段々」（terrace）。段々の床を坂とはしごでつなぐ。1 つの段を 18u マスごとの種で区切って部屋にする。
 * 今はスタブ（null を返すだけ。呼び出し側が同じ rng を進めて作り直し、全部落ちたら旧生成器へ落ちる）。
 * 型のレーン（L3）が見本の gen を移植して中身を書く: docs/ideas/map-gen-impl.md 2-4（拡縮）・2-5（決定性と性能）、
 * 数値は data/balance/world/MAP_LAYOUT/terrace.json
 */
import type { LayoutGenerator } from "./types";

export const generateTerrace: LayoutGenerator = () => null;
