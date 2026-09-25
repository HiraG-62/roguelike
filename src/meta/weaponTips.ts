import { type Keybinds, keyLabel } from "../core/input";
import { formatMeters } from "../core/units";
import {
  type BranchDef,
  type BulletDef,
  type ButtonKey,
  MOVESETS,
  MOVESET_KEYS,
  type MeleeStepDef,
  type MovesetDef,
  type MovesetKey,
  actionStepName,
  type BulletFeature,
  bulletFeatures,
  isGun,
  movesetCasts,
} from "../data/weapons";
import { type UltimateDef, ULTIMATES } from "../data/ultimates";
import { ATTR_LABEL } from "../loot/resonance";
import { ATTR_KEYS, type AttrKey } from "../loot/types";

/**
 * 武器種の Tips 本文を武器の定義（moveset の段・派生・右の段・奥義の名前）から組み立てる。
 * 手書きの表は持たない（MovesetDef.desc は data/weapons.ts が既に持つ手書きの一言をそのまま使う）。
 * Tips ノートの「武器種」タブは meta/tips.ts の TIP_DEFS へこの本文を差し込む
 */

/** 奥義の種類の短い表記（docs/GLOSSARY.md「一撃 / 持続」）。ui/statusTab.ts の ULTIMATE_KIND_LABEL と同じ語だが、
 * meta 層から ui 層へ依存しないようここに小さく持つ */
const ULTIMATE_KIND_LABEL: Readonly<Record<UltimateDef["kind"], string>> = { instant: "一撃", sustain: "持続" };

/** 弾の性質（data/weapons.ts の BulletFeature）の短い説明 */
const BULLET_FEATURE_TEXT: Readonly<Record<BulletFeature, string>> = {
  rapid: "弾筋が揺れる連射",
  spread: "散弾が出る",
  pierce: "貫通する",
  homing: "敵を追う",
  ricochet: "跳ね返る",
  charge: "溜めるほど強くなる",
  mine: "設置弾になる",
  burst: "三点で出る",
  boomerang: "行って戻ってくる",
  lob: "曲射になる",
};

/** ButtonKey の列を HUD と同じ「左」「右」の表記にする（docs/GLOSSARY.md「アクション 1 / アクション 2」） */
function sequenceText(seq: readonly ButtonKey[]): string {
  return seq.map((b) => (b === "primary" ? "左" : "右")).join("");
}

/** 派生の引き金の表記（構えを離して出す派生は「◯を離す」） */
function branchTrigger(b: Readonly<BranchDef>): string {
  const seq = sequenceText(b.sequence);
  return b.art === "release" ? `${seq}を離す` : seq;
}

/** 武器種が持つすべての近接の振り（段・ダッシュ攻撃・派生・溜め・右の振り・構えの離し）。固有の仕組みの検出に使う */
function allSteps(m: Readonly<MovesetDef>): MeleeStepDef[] {
  const out: (MeleeStepDef | undefined)[] = [...m.steps, m.dashAttack, ...m.branches.map((b) => b.step), m.charge?.step, m.charge?.spinning?.step];
  for (const s of m.steps2) {
    if (s.kind === "swing") out.push(s.step);
    if (s.kind === "hold") out.push(s.hold.release);
    if (s.kind === "charge") out.push(s.charge.step, s.charge.spinning?.step);
  }
  return out.filter((s): s is MeleeStepDef => s !== undefined);
}

/** 右レーンの弾の段・cast が持つ弾（弾の性質の検出に使う） */
function allBullets(m: Readonly<MovesetDef>): BulletDef[] {
  const out: BulletDef[] = [];
  for (const s of m.steps2) if (s.kind === "volley") out.push(s.throw.bullet);
  for (const c of movesetCasts(m)) out.push(c.throw.bullet);
  return out;
}

/** 武器の定義から検出する固有の仕組み（手書きしない）。無ければ空配列 */
export function weaponMechanics(m: Readonly<MovesetDef>): string[] {
  const steps = allSteps(m);
  const has = (pred: (s: MeleeStepDef) => boolean): boolean => steps.some(pred);
  const out: string[] = [];
  if (m.tip !== undefined) out.push("先端を当てるほど威力が上がる");
  if (has((s) => s.pull === true)) out.push("敵を引き寄せる");
  if (has((s) => s.throw === true)) out.push("敵を放り投げる");
  if (has((s) => s.cutsBullets === true)) out.push("敵弾を払う");
  if (has((s) => s.invuln !== undefined)) out.push("踏み込みに無敵がある");
  if (movesetCasts(m).length > 0) out.push("振りから弾を放つ");
  if (m.steps2.some((s) => s.kind === "hold" && s.hold.parry !== undefined)) out.push("受け流しの構えがある");
  if (m.steps2.some((s) => s.kind === "hold" && s.hold.guard !== undefined)) out.push("防御の構えがある");
  if (m.steps2.some((s) => s.kind === "recall")) out.push("飛んでいる弾を手元へ戻せる");
  const features = new Set(allBullets(m).flatMap((b) => bulletFeatures(b)));
  for (const f of features) out.push(BULLET_FEATURE_TEXT[f]);
  return out;
}

function withPeriod(s: string): string {
  return s.endsWith("。") ? s : `${s}。`;
}

/** 主に参照するステータス（左 1 段目の係数を持つもの）。銃の家系はベースごとに違うので出さない */
function referencedAttrs(step: Readonly<MeleeStepDef>): AttrKey[] {
  return ATTR_KEYS.filter((a) => Math.abs(step.scaling[a] ?? 0) > 0);
}

/** 特徴（間合い・参照ステータス・固有の仕組み）。desc は data/weapons.ts の手書きの一言 */
function featureText(m: Readonly<MovesetDef>): string {
  const desc = withPeriod(m.desc);
  const mechanics = weaponMechanics(m)
    .map(withPeriod)
    .join("");
  if (isGun(m)) return `${desc}${mechanics}`;
  const step = m.steps[0];
  if (step === undefined) return `${desc}${mechanics}`;
  const reach = `間合いはおよそ${formatMeters(step.reach)}。`;
  const attrs = referencedAttrs(step);
  const attrText = attrs.length > 0 ? `威力は${attrs.map((a) => ATTR_LABEL[a]).join("・")}で伸びる。` : "";
  return `${desc}${reach}${attrText}${mechanics}`;
}

/** 右レーンの段の並び（「受け流し（説明）→2 段目→3 段目」）。desc は 1 段目だけが持つ */
function laneSummary(m: Readonly<MovesetDef>): string {
  const names = m.steps2.map((s, i) => {
    const name = actionStepName(s, i);
    return s.desc ? `${name}（${s.desc}）` : name;
  });
  return names.join("→");
}

/** 操作（攻撃 1 / 攻撃 2 / 奥義）。キー表記は今のキー設定から組む */
function operationText(m: Readonly<MovesetDef>, binds: Keybinds | undefined): string {
  const atk = keyLabel("attack", { binds });
  const sh = keyLabel("shoot", { binds });
  const sp = keyLabel("special", { binds });
  const left = isGun(m)
    ? `${atk}: 押している間、弾を撃つ。`
    : m.primary === "charge"
      ? `${atk}: 連撃。長押しで溜め、離すと強い一振り。`
      : `${atk}: ${m.steps.length} 段の連撃。`;
  const right = `${sh}: ${laneSummary(m)}。`;
  return `${left}${right}${sp}: 奥義ゲージが満ちると出せる（拠点で 3 本から選ぶ）。`;
}

/** コンボ派生の一覧（「左左右→十字断ち」）。無ければ空文字 */
function comboText(m: Readonly<MovesetDef>): string {
  if (m.branches.length === 0) return "";
  const list = m.branches.map((b) => `${branchTrigger(b)}→${b.name}`).join("、");
  return `派生: ${list}。`;
}

/** 奥義 3 本の名前と種類 */
function ultimateText(key: MovesetKey): string {
  const list = ULTIMATES[key].map((u) => `${u.name}（${ULTIMATE_KIND_LABEL[u.kind]}）`).join("・");
  return `奥義の候補: ${list}。`;
}

/** 武器種 1 つの Tips 本文。特徴・操作・コンボ一覧・奥義の候補を武器の定義から組み立てる */
export function weaponTipBody(key: MovesetKey, binds?: Keybinds): string {
  const m = MOVESETS[key];
  return [featureText(m), operationText(m, binds), comboText(m), ultimateText(key)].filter((s) => s.length > 0).join(" ");
}

/** 全武器種の key（Tips のタブ・網羅テストが使う） */
export const WEAPON_TIP_KEYS: readonly MovesetKey[] = MOVESET_KEYS;
