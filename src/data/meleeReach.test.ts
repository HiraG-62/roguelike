import { describe, expect, it } from "vitest";
import { ACTOR_SHEETS } from "./actorSheets.gen";
import { MOVESETS, MOVESET_KEYS, type MeleeStepDef, type MovesetDef, type MovesetKey } from "./weapons";

/**
 * 近接の当たり判定の外縁は「振った武器の先端」まで（docs/recipes/weapon.md）。
 * 描いた刃より遠くの敵に当たると、離れているのに当たったように見える（ユーザーの指摘: 剣の 1 段目が刃の 15px 先まで当たっていた）。
 * 敵の半径ぶんは当たり判定の計算（meleeContact）が足すので、外縁は刃先に揃えれば「刃が敵の体に触れたら当たる」になる
 */

/** 手に持つ絵の 1px あたりのドット（render/actorSprites.ts の ACTOR_ART_SCALE。data から render を読まないので写す） */
const ART_DOTS_PER_PX = 2;
/** 振っている間の握りの手の、体の中心からの距離（px。高精細の体の腕の伸び。画面で測った値） */
const GRIP_FROM_CENTER = 7;
/** 刃先から外へ許す余裕（px）。絵の刃先の丸め（大きくすると刃と敵の間に隙間が見えたまま当たる） */
const EDGE_SLACK = 1;
/** 突きは腕ごと前へ出す（構えの reach）ので、振りより余裕を足す（px） */
const THRUST_SLACK = 5;
/** 拳・爪・盾は腕ごと前へ突き出して打つので、全段を突きと同じ余裕で見る */
const ARM_STRIKE: readonly MovesetKey[] = ["fists", "claws", "shield"];
/** 鎖で振る武器は鎖が伸びる分だけ刃先より遠くへ届いてよい（px）。鎖を投げる技は BEYOND_BLADE */
const CHAIN_REACH: Partial<Record<MovesetKey, number>> = { flail: 8, chainSickle: 8 };
/** 溜めの段で届く距離の倍率の上限。溜めは威力と怯み値で強くし、届く距離は刃先のまま（伸ばすと刃から離れた所に当たる） */
const MAX_CHARGE_REACH_MUL = 1;

/**
 * 武器の外まで届くのが個性の段（武器種 → 段の名前の一覧。"*" は全段）。
 * 鞭は縄（whipRope.ts とエフェクトが描く）、鎖鎌・連接棍の鎖投げは鎖、鎌鼬と扇子は風、杖の渦巻きは術、刀の居合は刃の先へ飛ぶ一閃、
 * 書は頁から出る文字の刃・術
 */
const BEYOND_BLADE: Partial<Record<MovesetKey, readonly string[]>> = {
  whip: ["*"],
  fan: ["*"],
  book: ["*"],
  chainSickle: ["r:0", "dash", "branch:kamaitachi", "branch:chainBind"],
  flail: ["r:3", "branch:dragCrush"],
  wand: ["branch:vortex"],
  katana: ["r:0.charge"],
};

interface LabeledStep {
  label: string;
  step: MeleeStepDef;
}

/** 武器種の近接の振り（左の段・右の振り・派生・ダッシュ攻撃・溜め）。銃の弾・奥義・ジョブの派生（どの武器種にも付く）は対象外 */
function swingsOf(m: MovesetDef): LabeledStep[] {
  const out: LabeledStep[] = m.steps.map((step, i) => ({ label: `l:${i}`, step }));
  m.steps2.forEach((s, i) => {
    if (s.kind === "swing") out.push({ label: `r:${i}`, step: s.step });
    if (s.kind === "charge") out.push({ label: `r:${i}.charge`, step: s.charge.step });
  });
  for (const b of m.branches) out.push({ label: `branch:${b.key}`, step: b.step });
  out.push({ label: "dash", step: m.dashAttack });
  if (m.charge) out.push({ label: "charge", step: m.charge.step });
  return out;
}

/** 形の外縁（体の中心から、攻撃方向へいちばん遠い所。px） */
function outerEdge(step: Readonly<MeleeStepDef>): number {
  const k = step.shape.kind;
  return k === "box" || k === "circle" ? step.reach + step.size / 2 : step.reach;
}

/** 手に持つ絵の握りから刃先まで（px）。向き 0（右向き）の矩形の幅 − 原点 */
function bladeLength(moveset: MovesetKey): number | undefined {
  const key = `wpn${moveset.charAt(0).toUpperCase()}${moveset.slice(1)}`;
  const rects = ACTOR_SHEETS[`${key}.held`]?.rects;
  const w = rects?.[2];
  const ox = rects?.[4];
  if (w === undefined || ox === undefined) return undefined;
  return (w - ox) / ART_DOTS_PER_PX;
}

function exempt(moveset: MovesetKey, label: string): boolean {
  const list = BEYOND_BLADE[moveset];
  return !!list && (list.includes("*") || list.includes(label));
}

describe("近接の当たり判定の外縁", () => {
  it.each(MOVESET_KEYS.filter((k) => bladeLength(k) !== undefined))("%s の振りは武器の先端より遠くへ届かない", (key) => {
    const tip = GRIP_FROM_CENTER + (bladeLength(key) ?? 0);
    const over = swingsOf(MOVESETS[key])
      .filter(({ label }) => !exempt(key, label))
      .map(({ label, step }) => ({ label, edge: outerEdge(step), cap: tip + EDGE_SLACK + (CHAIN_REACH[key] ?? 0) + (step.shape.kind === "thrust" || ARM_STRIKE.includes(key) ? THRUST_SLACK : 0) }))
      .filter(({ edge, cap }) => edge > cap + 1e-6)
      .map(({ label, edge, cap }) => `${label}: 外縁 ${edge.toFixed(1)} > ${cap.toFixed(1)}`);
    expect(over, `${key}（刃先 ${tip.toFixed(1)}px）`).toEqual([]);
  });

  it("溜めで届く距離を伸ばさない", () => {
    const over = MOVESET_KEYS.flatMap((key) => {
      const m = MOVESETS[key];
      // 刃の先へ届く例外の溜め（刀の居合）は距離を伸ばしてよい
      const lanes = m.steps2.flatMap((s, i) => (s.kind === "charge" && !exempt(key, `r:${i}.charge`) ? [s.charge] : []));
      return [m.charge, ...lanes].flatMap((c) => (c?.levels ?? []).filter((l) => (l.reachMul ?? 1) > MAX_CHARGE_REACH_MUL).map((l) => `${key}: ${l.reachMul}`));
    });
    expect(over).toEqual([]);
  });

  it("例外の表は実在する段だけを指す", () => {
    for (const [key, labels] of Object.entries(BEYOND_BLADE)) {
      const known = swingsOf(MOVESETS[key as MovesetKey]).map((s) => s.label);
      for (const label of labels ?? []) if (label !== "*") expect(known, `${key} ${label}`).toContain(label);
    }
  });
});
