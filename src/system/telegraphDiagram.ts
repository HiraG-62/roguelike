import { createStatusBag } from "../core/status";
import type { Enemy } from "../core/state";
import type { EnemyDef } from "../data/enemies";
import { ENEMY_AI, ENEMY_TEMPO } from "../data/tuning";
import { type ThreatBand, BOSS_THREATS } from "./bossKit";
import { enemyTelegraph } from "./enemies";
import { createPoiseState } from "./statusEffects";

/**
 * 予告の図解（docs/ideas/meta-impl.md 2-3）。図鑑の敵の頁から、同じ敵に倒された回数が
 * META.diagramDeaths に届くと開く。敵データ（def）から導く純関数で、手書きの表を持たない。
 * 形は右向きの「最初の技」で、ai を読んで形を変える敵（ボス・二形態）は最初の技の形になる
 */

export type DiagramShape =
  | { kind: "line"; length: number }
  | { kind: "laser"; count: number; spreadDeg: number }
  | { kind: "ring"; radius: number }
  | { kind: "cone"; range: number; halfDeg: number }
  | { kind: "cross" }
  | { kind: "volley"; count: number; spreadDeg: number }
  | { kind: "landing"; radius: number }
  | { kind: "touch" }
  /** 予告の形を持たない敵（支援役など。図鑑に載るので例外を出さず、時間の帯だけ見せる） */
  | { kind: "none" };

export interface TelegraphDiagram {
  shape: DiagramShape;
  /** def.windup（秒） */
  windup: number;
  /** 予備動作の始まりから赤（コミット。怯まず必ず出る）になるまでの秒 = windup × (1 − commitRatio) */
  commitFrom: number;
  /** def.strikeTime（秒） */
  strike: number;
  /** def.recover（隙の秒） */
  recover: number;
  /** 安全な場所の一言（形から決める） */
  safe: string;
  /** ボスだけ: 段階 1〜3 の危ない間合い。無ければ undefined */
  threats?: readonly ThreatBand[];
}

/** 安全な場所の一言（形ごと）。予告の形を持たない敵（none）は空で、描画側が「予告の形なし」と出す */
export const DIAGRAM_SAFE: Readonly<Record<DiagramShape["kind"], string>> = {
  line: "線の横",
  laser: "線の外",
  ring: "輪の外",
  cone: "扇の後ろ",
  cross: "斜め",
  volley: "弾の間",
  landing: "影の外",
  touch: "触れない間合い",
  none: "",
};

/** 段階の危ない間合いの表示名 */
export const THREAT_LABEL: Readonly<Record<ThreatBand, string>> = {
  near: "近いと危ない",
  far: "遠いと危ない",
  moving: "動くと危ない",
  still: "止まると危ない",
};

/** 形を調べるための最小の Enemy（予備動作中・向きは右・ai なし）。createEnemy は state と乱数を要るので使わない */
function stubEnemy(def: EnemyDef): Enemy {
  return {
    id: 0,
    defKey: def.key,
    roomIndex: 0,
    body: { pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, radius: def.radius },
    hp: 1,
    maxHp: 1,
    facing: { x: 1, y: 0 },
    phase: "windup",
    phaseTimer: def.windup,
    windupTotal: def.windup,
    strikeDir: { x: 1, y: 0 },
    attackCooldown: 0,
    hitFlash: 0,
    knock: { x: 0, y: 0 },
    animTime: 0,
    status: createStatusBag(),
    poise: createPoiseState(),
  };
}

function shapeOf(def: EnemyDef): DiagramShape {
  if (def.explode) return { kind: "ring", radius: def.explode.radius };
  const beams = def.laserBeams;
  if (def.behavior === "laser" || beams !== undefined) {
    return { kind: "laser", count: beams?.count ?? 1, spreadDeg: beams?.spreadDeg ?? 0 };
  }
  if (def.lob) return { kind: "landing", radius: def.lob.blastRadius };
  // 爆弾魔は volley を投げる数に使うが、見えるのは足元へ落ちる爆弾の影なので影で見せる
  if (def.behavior === "bomber") return { kind: "landing", radius: ENEMY_AI.bomber.radius };
  if (def.volley) return { kind: "volley", count: def.volley.count, spreadDeg: def.volley.spreadDeg };
  // volley を持たない射手は 1 発を正面へ撃つ
  if (def.behavior === "shooter") return { kind: "volley", count: 1, spreadDeg: 0 };
  const t = enemyTelegraph(stubEnemy(def), def);
  if (t !== null) {
    switch (t.kind) {
      case "line":
        return { kind: "line", length: t.length ?? 0 };
      case "laser":
        return { kind: "laser", count: 1, spreadDeg: 0 };
      case "ring":
        return { kind: "ring", radius: t.radius };
      case "cone":
        return { kind: "cone", range: t.range, halfDeg: t.halfDeg };
      case "cross":
        return { kind: "cross" };
    }
  }
  return def.contactDamage > 0 ? { kind: "touch" } : { kind: "none" };
}

export function telegraphDiagram(def: EnemyDef): TelegraphDiagram {
  const shape = shapeOf(def);
  const out: TelegraphDiagram = {
    shape,
    windup: def.windup,
    commitFrom: def.windup * (1 - ENEMY_TEMPO.commitRatio),
    strike: def.strikeTime,
    recover: def.recover,
    safe: DIAGRAM_SAFE[shape.kind],
  };
  const threats = def.boss ? BOSS_THREATS[def.key] : undefined;
  if (threats !== undefined) out.threats = threats;
  return out;
}
