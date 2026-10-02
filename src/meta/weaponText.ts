import { formatMeters } from "../core/units";
import {
  type BulletDef,
  type MeleeStepDef,
  type MovesetDef,
  type TipDef,
  actionStepName,
  type BulletFeature,
  bulletFeatures,
  isGun,
  movesetCasts,
} from "../data/weapons";
import { type FormDef, type MoraleGain, type RiposteSource, formCutsBullets, formOf } from "../data/weaponForms";
import { STATUS_LABEL } from "../core/status";
import { FORM } from "../data/tuning";
import { ATTR_KEYS, ATTR_LABEL, type AttrKey } from "../loot/types";

/**
 * 武器指南書（meta/weaponManual.ts）の頁の本文: 特色（間合い・参照ステータス・固有の仕組み）と型の文（戦意・放出・応手）を
 * 武器の定義と型（data/weaponForms.ts）から組み立てる。手書きの表は持たない（MovesetDef.desc は data/weapons.ts の手書きの一言をそのまま使う）
 */

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

/** 武器の重さの表記（docs/GLOSSARY.md「武器の重さ（軽 / 中 / 重）」） */
const WEIGHT_TEXT: Readonly<Record<MovesetDef["weight"], string>> = { light: "軽", medium: "中", heavy: "重" };

/** 溜め込む戦意の出来事（「〜で溜まる」の前に置く名詞） */
const GAIN_EVENT_TEXT: Readonly<Partial<Record<MoraleGain["kind"], string>>> = {
  meleeHit: "振りの命中",
  riposte: "応手",
  tipHit: "先端の命中",
  guardBlock: "構えで受けたダメージ",
  bulletCut: "敵弾払い",
  shotFired: "撃った弾",
  skillHit: "スキルの命中",
  minionHit: "設置物・連動体の命中",
};

/** 導出の戦意（毎瞬数え直す量）の名詞。傷の状態異常の名はデータから引く */
function derivedGainText(g: MoraleGain): string | undefined {
  switch (g.kind) {
    case "chargeLevel":
      return "溜めの段の数";
    case "applyStatus":
      return `近くの敵に刻んだ${STATUS_LABEL[g.status]}の数`;
    case "pullHit":
      return "繋いだ敵の数";
    case "cast":
      return "連撃で重ねた手の数";
    case "flyingShots":
      return "飛んでいる自分の弾の数";
    case "placedShots":
      return "床に置いた自分の弾の数";
    default:
      return undefined;
  }
}

/** 刀の居合の段の key（応手「居合のカウンター」を出せるのはこの段を持つ武器種だけ） */
const IAI_KEY = "iai";

/** 応手になる出来事の表記（docs/GLOSSARY.md「先制 / 終撃 / 充溢 / 放出 / 応手 / 双撃」） */
const RIPOSTE_TEXT: Readonly<Record<RiposteSource, string>> = {
  parry: "受け流し",
  counter: "カウンター",
  justDodge: "見切り",
  guardBlock: "構えの受け止め",
  bulletCut: "敵弾払い",
  iai: "居合の出端",
  pullInterrupt: "予備動作中の敵の引き寄せ",
  recallCut: "戻りの弾での敵弾消し",
  chargeEndure: "溜め中の被弾",
};

/** 放出の段の表記。右レーンの段は今の武器種の段の名前から引く */
function releaseText(m: Readonly<MovesetDef>, form: FormDef): string {
  const r = form.morale.release;
  switch (r.kind) {
    case "laneStep": {
      const names = m.steps2.flatMap((s, i) => (s.key !== undefined && r.keys.includes(s.key) ? [`右の${actionStepName(s, i)}`] : []));
      return names.length > 0 ? names.join("・") : "右の連撃";
    }
    case "branch":
      return "3 手の派生";
    case "nextPrimary":
      return isGun(m) ? "満ちた後の 1 発" : "満ちた後の最初の突き";
    case "maxCharge":
      return "最大段の溜め攻撃";
    case "release":
      return "構えを離した振り";
    case "reload":
      return "強装填";
  }
}

/** 応手の出来事のうち、この武器種で起こせるもの（居合は居合を持つ刀だけ）。短銃の見切りは零距離だけ */
function riposteText(m: Readonly<MovesetDef>, form: FormDef): string {
  const own = form.riposte.filter((r) => r !== "iai" || m.steps2.some((s) => s.key === IAI_KEY));
  return own.map((r) => (form.key === "pistol" && r === "justDodge" ? `${formatMeters(FORM.pistol.zeroDistance)} 以内の見切り` : RIPOSTE_TEXT[r])).join("・");
}

/** 戦意の溜まり方（「先端の命中で溜まり」/「繋いだ敵の数で」） */
function gainText(form: FormDef): string {
  const derived = form.morale.gain.map(derivedGainText).filter((t): t is string => t !== undefined);
  if (derived.length > 0) return `${derived.join("・")}で、`;
  if (form.morale.gain.some((g) => g.kind === "still")) return "足を止めている間に溜まって動くと減り、";
  const events = form.morale.gain.map((g) => GAIN_EVENT_TEXT[g.kind]).filter((t): t is string => t !== undefined);
  return `${events.join("・")}で溜まり、`;
}

/** 放出のしかた。短銃は撃ち切ると装填になり、その途中で右を押すと強装填 */
function releaseSentence(m: Readonly<MovesetDef>, form: FormDef): string {
  if (form.morale.release.kind === "reload") return "撃ち切ると装填になり、装填の途中で右を押すと次の弾倉が強装填になる。";
  return `${releaseText(m, form)}で放つ。`;
}

/** 武器の型の 1 文（型・重さ・戦意の溜まり方と放出・応手）。型と武器種の定義から組む */
export function formText(m: Readonly<MovesetDef>): string {
  const form = formOf(m);
  const head = `型は${form.name}（重さ${WEIGHT_TEXT[m.weight]}）。`;
  const riposte = `応手は${riposteText(m, form)}。`;
  if (form.morale.gain.length === 0) return `${head}${riposte}`;
  const label = m.moraleLabel ?? form.morale.label;
  return `${head}戦意「${label}」は${gainText(form)}${releaseSentence(m, form)}${riposte}`;
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

/** 先端判定の表記。根元が弱い武器種（鞭）と、薙ぎ・回しの外周も先端に数える武器種（棍）を言い分ける */
function tipText(tip: Readonly<TipDef>): string {
  const where = tip.sweep === true ? "突きは先、薙ぎ・回しは外周" : "先端";
  return tip.offDamageMul < 1 ? `${where}で当てると強く、根元は弱い` : `${where}で当てると強い`;
}

/** 武器の定義から検出する固有の仕組み（手書きしない）。無ければ空配列 */
export function weaponMechanics(m: Readonly<MovesetDef>): string[] {
  const steps = allSteps(m);
  const has = (pred: (s: MeleeStepDef) => boolean): boolean => steps.some(pred);
  const out: string[] = [];
  if (m.tip !== undefined) out.push(tipText(m.tip));
  if (has((s) => s.pull === true)) out.push("敵を引き寄せる");
  if (has((s) => s.throw === true)) out.push("敵を放り投げる");
  // 長柄の穂先を持つ突きは型が敵弾を払わせる（data/weaponForms.ts の formCutsBullets）
  if (has((s) => s.cutsBullets === true || formCutsBullets(m, s))) out.push("敵弾を払う");
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
export function featureText(m: Readonly<MovesetDef>): string {
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
