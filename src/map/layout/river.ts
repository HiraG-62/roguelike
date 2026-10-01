/**
 * 階の型「谷・川筋」（river）。地図を横切る川（穴）を蛇行させ、河原と両岸の洞を開け、橋と浅瀬でだけ渡れる。
 * 今はスタブ（null を返すだけ。呼び出し側が同じ rng を進めて作り直し、全部落ちたら旧生成器へ落ちる）。
 * 型のレーン（L2）が見本の gen を移植して中身を書く: docs/ideas/map-gen-impl.md 2-4（拡縮）・2-5（決定性と性能）、
 * 数値は data/balance/world/MAP_LAYOUT/river.json
 */
import type { LayoutGenerator } from "./types";

export const generateRiver: LayoutGenerator = () => null;
