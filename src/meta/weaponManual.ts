import { formatMeters } from "../core/units";
import { STATUS_LABEL } from "../core/status";
import { BASES } from "../loot/bases";
import { BULLETS, bulletOfBase } from "../loot/bullets";
import { MANUAL } from "../data/tuning";
import { type UltimateDef, ULTIMATES } from "../data/ultimates";
import { formCutsBullets, formOf } from "../data/weaponForms";
import {
  type ActionStepDef,
  type BranchDef,
  type ButtonKey,
  MOVESETS,
  MOVESET_KEYS,
  type MeleeChargeDef,
  type MeleeStepDef,
  type MovesetDef,
  type MovesetKey,
  actionStepName,
  firesByHand,
  isThrowingWeapon,
  matchBranch,
  shootsPrimary,
} from "../data/weapons";
import { HAND_ACTION_NAME } from "../system/dualPistols";
import type { DemoCue, DemoExpect, DemoScript } from "../system/manualDemo";
import { featureText, formText } from "./weaponText";

/**
 * 武器指南書（docs/ideas/weapon-manual.md）の中身: 武器種ごとの頁（特色・型と戦意・技の一覧）を武器の定義から組み立てる。
 * 技 1 つは「入力の台本（system/manualDemo.ts の DemoScript）」を持ち、指南書の窓はその台本を本物の入力として流して実演する。
 * 表示の入力の列は台本の手から作る（cueToken）ので、台本と表示がずれない。手書きの表は持たない
 */

export const MANUAL_GROUPS = ["chain", "branch", "dash", "charge", "morale", "ultimate"] as const;
export type ManualGroup = (typeof MANUAL_GROUPS)[number];

/** 技の一覧の見出し（docs/GLOSSARY.md） */
export const MANUAL_GROUP_LABEL: Readonly<Record<ManualGroup, string>> = {
  chain: "連撃",
  branch: "コンボ派生",
  dash: "ダッシュ攻撃",
  charge: "溜め攻撃",
  morale: "戦意",
  ultimate: "奥義",
};

export interface ManualMove {
  /** 頁の中で一意 */
  readonly key: string;
  readonly group: ManualGroup;
  readonly name: string;
  /** 短い性質の札（間合い・形・多段・無敵…。単一指標は出さない） */
  readonly traits: readonly string[];
  /** 何ができるかの一文（無ければ空） */
  readonly desc: string;
  readonly script: DemoScript;
  /** 実演で確かめること（木人の距離の合わせ込みと網羅テストが読む） */
  readonly expect: DemoExpect;
}

export interface ManualSection {
  readonly heading: string;
  readonly body: string;
}

export interface ManualPage {
  readonly key: MovesetKey;
  readonly name: string;
  /** 型・重さ・左の役割の 1 行 */
  readonly summary: string;
  readonly sections: readonly ManualSection[];
  readonly moves: readonly ManualMove[];
}

/** 入力の列の 1 つの札（表示用）。long = 長押し */
export interface ManualToken {
  readonly label: string;
  readonly long: boolean;
}

const BUTTON_LABEL: Readonly<Record<ButtonKey, string>> = { primary: "左", secondary: "右" };
/** 左右の同時押しの札 */
const BOTH_LABEL = "左右同時";
const WEIGHT_LABEL: Readonly<Record<MovesetDef["weight"], string>> = { light: "軽", medium: "中", heavy: "重" };
const ULTIMATE_KIND_LABEL: Readonly<Record<UltimateDef["kind"], string>> = { instant: "一撃", sustain: "持続" };

/** 台本の手を表示の札にする。待ちの手と見せるだけの手（hidden）は札にしない（null） */
export function cueToken(cue: DemoCue): ManualToken | null {
  switch (cue.kind) {
    case "tap":
      return cue.hidden === true ? null : { label: BUTTON_LABEL[cue.button], long: false };
    case "hold":
      return cue.hidden === true ? null : { label: BUTTON_LABEL[cue.button], long: true };
    case "holdUntil":
      return { label: BUTTON_LABEL[cue.button], long: true };
    case "both":
      return { label: BOTH_LABEL, long: false };
    case "dash":
      return { label: "ダッシュ", long: false };
    case "special":
      return { label: "奥義", long: false };
    case "wait":
    case "waitUntil":
      return null;
  }
}

// ---------------------------------------------------------------------------
// 台本の部品
// ---------------------------------------------------------------------------

const tap = (button: ButtonKey): DemoCue => ({ kind: "tap", button });
const hold = (button: ButtonKey, sec: number): DemoCue => ({ kind: "hold", button, sec });
const wait = (sec: number): DemoCue => ({ kind: "wait", sec });
const NO_SETUP = {} as const;

/** 溜めの最大段に届く秒（最後の段の秒に余裕を足す。攻撃速度の補正で段の秒が伸びても届くように） */
const CHARGE_MARGIN_MUL = 1.15;
const CHARGE_MARGIN_SEC = 0.1;
/** 射撃を見せる押しっぱなしの秒 */
const FIRE_SEC = 1.2;
/** 構えを見せる秒（受け流しは短く、構え・扇ぎは長く） */
const PARRY_HOLD_SEC = 0.25;
const GUARD_HOLD_SEC = 0.9;
/** 持続の奥義を出してから通常の手を見せるまでの秒 */
const SUSTAIN_LEAD_SEC = 0.5;
/** 導出の戦意（飛んでいる弾・床の設置弾）を溜める押しっぱなしの秒 */
const BUILD_FIRE_SEC = 1.0;

function withPeriod(s: string): string {
  return s.endsWith("。") ? s : `${s}。`;
}

function times(n: number, cue: DemoCue): DemoCue[] {
  return Array.from({ length: n }, () => cue);
}

function chargeHoldSec(charge: { readonly levels: readonly Pick<MeleeChargeDef["levels"][number], "time">[] }): number {
  const last = charge.levels[charge.levels.length - 1]?.time ?? 0;
  return last * CHARGE_MARGIN_MUL + CHARGE_MARGIN_SEC;
}

/** 長さ len の入力列（すべての組み合わせ。右の少ない順、同じなら左が先） */
function sequencesOf(len: number): ButtonKey[][] {
  const out: ButtonKey[][] = [];
  for (let bits = 0; bits < 1 << len; bits++) out.push(Array.from({ length: len }, (_, i) => ((bits >> (len - 1 - i)) & 1 ? "secondary" : "primary")));
  const rights = (s: ButtonKey[]): number => s.filter((b) => b === "secondary").length;
  return out.sort((a, b) => rights(a) - rights(b));
}

/** 途中のどの手でも派生に当たらない列か（最後の手まで普通の段が出る） */
function avoidsBranches(m: Readonly<MovesetDef>, seq: readonly ButtonKey[]): boolean {
  for (let k = 1; k <= seq.length; k++) if (matchBranch(m, seq.slice(0, k)) !== undefined) return false;
  return true;
}

/**
 * 右の index 段目に届く押し方。段カウンタは左右で共有するので、index 手の後に右を押す。
 * 近接は「左 × index → 右」を先に試し、派生に当たれば右の多い順に探す。左で撃つ武器種の左（射撃）は段を進めないので右だけで数える
 */
export function laneSequence(m: Readonly<MovesetDef>, index: number): ButtonKey[] {
  if (shootsPrimary(m)) return Array.from({ length: index + 1 }, () => "secondary" as const);
  if (m.chainAdvance === "alternate") return alternatingHands(index + 1, "secondary");
  const fits = sequencesOf(index + 1).filter((s) => s[index] === "secondary" && avoidsBranches(m, s));
  // 反動で下がる段（爪の跳び退き）を途中に挟まない列を先に選ぶ（下がると続く振りが届かない）
  const found = fits.find((s) => !knockedOnTheWay(m, s)) ?? fits[0];
  return found ?? [...Array.from({ length: index }, () => "primary" as const), "secondary"];
}

/** 交互の連撃（手裏剣）で段が進む押し方: length 手、左右を替えながら最後が final になる列 */
function alternatingHands(length: number, final: ButtonKey): ButtonKey[] {
  const other: ButtonKey = final === "secondary" ? "primary" : "secondary";
  return Array.from({ length }, (_, k) => ((length - 1 - k) % 2 === 0 ? final : other));
}

/** 右の段の最後の手（構え・溜めは長押し） */
function laneFinalCue(s: Readonly<ActionStepDef>): DemoCue {
  switch (s.kind) {
    case "hold":
      return hold("secondary", s.hold.parry ? PARRY_HOLD_SEC : GUARD_HOLD_SEC);
    case "charge":
      return hold("secondary", chargeHoldSec(s.charge));
    default:
      return tap("secondary");
  }
}

/** 右の index 段目を出す手（前の手は押して離す） */
function laneCues(m: Readonly<MovesetDef>, index: number): DemoCue[] {
  const seq = laneSequence(m, index);
  const s = m.steps2[index];
  const head = seq.slice(0, -1).map(tap);
  return s === undefined ? head : [...head, laneFinalCue(s)];
}

/** 下ごしらえの後、連撃の段と入力の列が 1 段目へ戻るのを待つ（見せる手を 1 段目から数えるため） */
const FRESH: DemoCue = { kind: "waitUntil", until: "fresh", maxSec: 3 };

/**
 * 弾を数える段の前に、弾を飛ばしておく下ごしらえ。銃は撃ち、近接は右の最初の弾の段（爪・扇子などの弾の技）、
 * 無ければ左の 1 段目
 */
function shotsPrelude(m: Readonly<MovesetDef>): DemoCue[] {
  if (shootsPrimary(m)) return [hold("primary", BUILD_FIRE_SEC), FRESH];
  const volley = m.steps2.findIndex((s) => s.kind === "volley");
  return volley >= 0 ? [...laneCues(m, volley), FRESH] : [tap("primary"), FRESH];
}

// ---------------------------------------------------------------------------
// 性質の札
// ---------------------------------------------------------------------------

/** 当たり判定の形の札（扇は角度、円は周り / 前方） */
function shapeTrait(step: Readonly<MeleeStepDef>): string {
  switch (step.shape.kind) {
    case "arc":
      return `扇 ${step.shape.deg}°`;
    case "thrust":
      return "突き";
    case "circle":
      return step.reach === 0 ? "周り" : "前方の円";
    case "box":
      return "正面";
  }
}

/** 届く距離（周りの円は半径） */
function reachOf(step: Readonly<MeleeStepDef>): number {
  if (step.shape.kind === "circle" && step.reach === 0) return step.size / 2;
  if (step.shape.kind === "box" || step.shape.kind === "circle") return step.reach + step.size / 2;
  return step.reach;
}

/** 踏み込みを札にする最小の距離（px。これより短い踏み込みは手触りの揺れなので出さない） */
const LUNGE_TRAIT_MIN = 10;

/** 振り 1 つの性質の札 */
export function stepTraits(m: Readonly<MovesetDef>, step: Readonly<MeleeStepDef>, finisher: boolean): string[] {
  const out = [shapeTrait(step), `間合い ${formatMeters(reachOf(step))}`];
  if ((step.hits ?? 1) > 1) out.push(`${step.hits} 段ヒット`);
  if ((step.lunge ?? 0) >= LUNGE_TRAIT_MIN) out.push(`踏み込み ${formatMeters(step.lunge ?? 0)}`);
  if (step.invuln !== undefined) out.push(`無敵 ${step.invuln} 秒`);
  if (step.pull === true) out.push("引き寄せ");
  if (step.throw === true) out.push("投げ");
  if (step.cutsBullets === true || formCutsBullets(m, step)) out.push("敵弾払い");
  if (step.cast) out.push(`${step.cast.name}を放つ`);
  for (const a of step.applies ?? []) out.push(`${STATUS_LABEL[a.kind]}を付与`);
  if (step.heavy) out.push("重い一撃");
  if (finisher) out.push("終撃");
  return out;
}

function cooldownTrait(sec: number | undefined): string[] {
  return sec !== undefined && sec > 0 ? [`再使用 ${sec} 秒`] : [];
}

/** 右の段の性質の札（振り以外は段の種類から） */
function laneTraits(m: Readonly<MovesetDef>, s: Readonly<ActionStepDef>, index: number): string[] {
  const last = index === m.steps2.length - 1;
  switch (s.kind) {
    case "swing":
      return [...stepTraits(m, s.step, last), ...cooldownTrait(s.cooldown)];
    case "hold": {
      const out: string[] = [];
      if (s.hold.parry) out.push(`受け流しの窓 ${s.hold.parry.windowSec} 秒`);
      if (s.hold.guard) out.push(`正面 ${s.hold.guard.arcDeg}° を受ける`);
      if (s.hold.release) out.push("離すと振る");
      return [...out, ...cooldownTrait(s.cooldown)];
    }
    case "volley":
      return [`${s.throw.bullet.name} × ${s.throw.count}`, ...cooldownTrait(s.cooldown)];
    case "charge":
      return [`溜め ${s.charge.levels.length} 段`, ...stepTraits(m, s.charge.step, last), ...cooldownTrait(s.cooldown)];
  }
}

function branchTraits(m: Readonly<MovesetDef>, b: Readonly<BranchDef>): string[] {
  const out = stepTraits(m, b.step, b.next === undefined);
  if (b.shots) out.push(`弾 × ${b.shots.count}`);
  if (b.extras?.selfKnock !== undefined) out.push("反動で下がる");
  if (b.extras?.detonateMines === true) out.push("設置弾を起爆");
  return out;
}

// ---------------------------------------------------------------------------
// 技の一覧
// ---------------------------------------------------------------------------

function chainMove(m: Readonly<MovesetDef>): ManualMove {
  if (shootsPrimary(m)) {
    // 投擲物（戦輪・クナイ）は銃ではないので「投げ」と書く
    const thrown = isThrowingWeapon(m);
    const name = thrown ? "投げ" : "射撃";
    const desc = thrown ? "左を押している間、装備の器を投げる。" : "左を押している間、装備の銃の弾を撃つ。";
    return { key: "fire", group: "chain", name, traits: ["押している間"], desc, script: { setup: NO_SETUP, cues: [hold("primary", FIRE_SEC)] }, expect: "hit" };
  }
  const n = m.steps.length;
  const last = m.steps[n - 1];
  const traits = last === undefined ? [] : [`${n} 段`, ...stepTraits(m, last, true).filter((t) => t !== shapeTrait(last))];
  // 交互の連撃（手裏剣）は左右を替えるときだけ段が進む。左から始めて最後の段を左で出す
  if (m.chainAdvance === "alternate") {
    const hands = alternatingHands(n, "primary");
    return { key: "chain", group: "chain", name: "左右の連撃", traits, desc: "左右を替えて押すたびに次の段を振る。同じ手を続けても段は進まない。最後の段は終撃。", script: { setup: NO_SETUP, cues: hands.map(tap) }, expect: "hit" };
  }
  return { key: "chain", group: "chain", name: "左の連撃", traits, desc: "左を押すたびに次の段を振る。最後の段は終撃。", script: { setup: NO_SETUP, cues: times(n, tap("primary")) }, expect: "hit" };
}

function chargeMoves(m: Readonly<MovesetDef>): ManualMove[] {
  if (m.primary !== "charge" || m.charge === undefined) return [];
  const c = m.charge;
  const traits = [`溜め ${c.levels.length} 段`, ...stepTraits(m, c.step, true)];
  return [{ key: "charge", group: "charge", name: "溜め斬り", traits, desc: "左を押し続けて溜め、離すと段に応じた一振り。押してすぐ離せば連撃。", script: { setup: NO_SETUP, cues: [hold("primary", chargeHoldSec(c))] }, expect: "hit" }];
}

/** 右の段の振り（振り・溜めの振り・構えを離した振り）。弾（volley）・構えの受け流しの段は undefined */
function laneSwingStep(s: Readonly<ActionStepDef>): MeleeStepDef | undefined {
  switch (s.kind) {
    case "swing":
      return s.step;
    case "charge":
      return s.charge.step;
    case "hold":
      return s.hold.release;
    default:
      return undefined;
  }
}

/** 振りを見せる技の木人の距離。近接の武器種は左の段の距離と振りの届きの近い方、左で撃つ武器種は振りの届き */
function swingSetup(m: Readonly<MovesetDef>, step: Readonly<MeleeStepDef> | undefined): { foeDistance?: number } {
  if (step === undefined || step.size <= 0) return NO_SETUP;
  const own = reachDistance(reachOf(step));
  return { foeDistance: shootsPrimary(m) ? own : Math.min(own, foeDistanceFor(m)) };
}

/**
 * 最後の手より前に、反動で自分が下がる右の段（砲・擲弾の筒の振り）を挟む列か。下がった分だけ木人から離れ、
 * 続く振りは届かない（実演では当たりを確かめない）。段カウンタは左右共有で、左で撃つ武器種の左（射撃）は進めない
 */
function knockedOnTheWay(m: Readonly<MovesetDef>, seq: readonly ButtonKey[]): boolean {
  let step = 0;
  for (const b of seq.slice(0, -1)) {
    if (b === "secondary") {
      const s = m.steps2[step];
      if (s?.kind === "swing" && s.extras?.selfKnock !== undefined) return true;
      step += 1;
    } else if (!shootsPrimary(m)) step += 1;
  }
  return false;
}

function laneMoves(m: Readonly<MovesetDef>): ManualMove[] {
  return m.steps2.map((s, i) => {
    const setup = swingSetup(m, laneSwingStep(s));
    const script: DemoScript = { setup, cues: laneCues(m, i) };
    // 振らない構え（受け流し・離しても振らない構え）と、反動で下がってから振る段は当たりを確かめない
    const knocked = (s.kind === "swing" && s.extras?.selfKnock !== undefined) || knockedOnTheWay(m, laneSequence(m, i));
    const expect: DemoExpect = (s.kind === "hold" && s.hold.release === undefined) || knocked ? "none" : "hit";
    // 右の段は「押し方の列で出る技」としてコンボ派生と同じ見出しに並べる（段カウンタは左右共有なので、列で出る点は派生と同じ）
    return { key: `lane.${i}`, group: "branch", name: actionStepName(s, i), traits: laneTraits(m, s, i), desc: s.desc ?? "", script, expect };
  });
}

function branchMoves(m: Readonly<MovesetDef>): ManualMove[] {
  return m.branches
    .filter((b) => b.art !== "release")
    .map((b) => ({
      key: `branch.${b.key}`,
      group: "branch",
      name: b.name,
      traits: branchTraits(m, b),
      desc: b.next === undefined ? "連撃はここで終わる。" : `続けて ${b.next + 1} 段目から連撃を続けられる。`,
      script: { setup: swingSetup(m, b.step), cues: b.sequence.map(tap) },
      // 左で撃つ武器種の筒・銃把の振りは届きが短く、反動で下がった後の振りは届かない（近接の武器種は踏み込みで届く）
      expect: b.extras?.selfKnock !== undefined || (shootsPrimary(m) && knockedOnTheWay(m, b.sequence)) ? ("none" as const) : ("hit" as const),
    }));
}

function dashMove(m: Readonly<MovesetDef>): ManualMove {
  const desc = shootsPrimary(m) ? "ダッシュ中に左を押すと、抜けた先で振り返って撃つ。" : "ダッシュ中に左を押すと、ダッシュの終わりに振る。";
  return { key: "dash", group: "dash", name: "ダッシュ攻撃", traits: stepTraits(m, m.dashAttack, false), desc, script: { setup: { foeDistance: MANUAL.dashFoeDistance }, cues: [{ kind: "dash" }, tap("primary")] }, expect: "hit" };
}

function ultimateMoves(key: MovesetKey): ManualMove[] {
  const m = MOVESETS[key];
  return ULTIMATES[key].map((u) => {
    // 持続の奥義の間に振って見せる通常の手は札にしない（入力は「奥義 → 奥義で終える」）
    const follow: DemoCue[] = firesByHand(m)
      ? HAND_FOLLOW
      : shootsPrimary(m) ? [{ kind: "hold", button: "primary", sec: FIRE_SEC, hidden: true }] : times(Math.max(1, m.steps.length), { kind: "tap", button: "primary", hidden: true });
    const cues: DemoCue[] = u.kind === "sustain" ? [{ kind: "special" }, wait(SUSTAIN_LEAD_SEC), ...follow, { kind: "special" }] : [{ kind: "special" }];
    const desc = u.kind === "sustain" ? `${withPeriod(u.desc)}持続の間は通常の攻撃が変わり、もう一度奥義キーで終える。` : withPeriod(u.desc);
    // 左で撃つ武器種の奥義にも至近の行為（零距離乱射・輪舞）があるので、木人は既定の距離に立てる
    const setup = shootsPrimary(m) ? { ultimate: u.key, foeDistance: MANUAL.foeDistance } : { ultimate: u.key };
    // 刺さりを炸裂させる奥義（爆ぜクナイ）は、先に投げて木人に刺しておく
    const prelude = u.kind === "instant" && u.acts.some((a) => a.kind === "detonatePins") ? shotsPrelude(m) : [];
    const script: DemoScript = prelude.length > 0 ? { setup, prelude, cues } : { setup, cues };
    return { key: `ult.${u.key}`, group: "ultimate", name: u.name, traits: u.desc.startsWith(ULTIMATE_KIND_LABEL[u.kind]) ? [] : [ULTIMATE_KIND_LABEL[u.kind]], desc, script, expect: "hit" };
  });
}

// ---------------------------------------------------------------------------
// 二丁拳銃の手（system/dualPistols.ts）
// ---------------------------------------------------------------------------

/**
 * 手と手の間に置く待ち（秒）。左右を続けて押す手が撃ち尽くしの猶予（movesets/gunner.json の hands.bothHandsSec）に
 * 入らないよう、猶予より長く空ける
 */
const HAND_GAP_SEC = 0.12;
const handGap = wait(HAND_GAP_SEC);

/** 手を順に押す（手の間は待ちを挟む） */
function handTaps(buttons: readonly ButtonKey[], hidden = false): DemoCue[] {
  return buttons.flatMap((b, i) => {
    const t: DemoCue = hidden ? { kind: "tap", button: b, hidden: true } : tap(b);
    return i === 0 ? [t] : [handGap, t];
  });
}

/** 持続の奥義の間に見せる手（左右を交互に撃つ） */
const HAND_FOLLOW: DemoCue[] = handTaps(["primary", "secondary", "primary", "secondary"], true);

/** 左手・右手の射撃と、同じ手を続けた技の 1 つ（振りを見せる手の木人の距離は振りの届き） */
function handMove(
  m: Readonly<MovesetDef>,
  key: string,
  name: string,
  traits: readonly string[],
  desc: string,
  buttons: readonly ButtonKey[],
  step?: Readonly<MeleeStepDef>,
): ManualMove {
  return { key, group: "chain", name, traits, desc, script: { setup: swingSetup(m, step), cues: handTaps(buttons) }, expect: "hit" };
}

/**
 * 二丁拳銃の手の技の一覧: 射撃（左右交互）・左を続けた蹴り / 回し蹴り（左の段）・右を続けた銃把打ち / 回転撃ち と
 * 弾切れの手の銃把打ち（右の段。key は lane.<添字> で右の段の数と揃える）
 */
function handChainMoves(m: Readonly<MovesetDef>): ManualMove[] {
  const L = "primary" as const;
  const R = "secondary" as const;
  const kick = m.steps[0];
  const roundKick = m.steps[1];
  const fire = handMove(m, "fire", HAND_ACTION_NAME.shot, ["1 クリック 1 発", "交互で拍"], "左を押すと左手、右を押すと右手の銃を 1 発撃つ。左右を交互に撃つと拍が溜まり、同じ手が続くと途切れる。", [L, R, L, R]);
  const left = [
    ...(kick ? [handMove(m, "kick", HAND_ACTION_NAME.kick, stepTraits(m, kick, false), "左を続けて 2 回押すと蹴る。", [L, L], kick)] : []),
    ...(roundKick ? [handMove(m, "roundKick", HAND_ACTION_NAME.roundKick, stepTraits(m, roundKick, true), "左を続けて 3 回押すと回し蹴り。", [L, L, L], roundKick)] : []),
  ];
  return [fire, ...left, ...m.steps2.map((s, i) => handLaneMove(m, s, i))];
}

/** 右の段（右を続けた 2・3 回目と、弾切れの手の銃把打ち） */
function handLaneMove(m: Readonly<MovesetDef>, s: Readonly<ActionStepDef>, index: number): ManualMove {
  const R = "secondary" as const;
  const base = { key: `lane.${index}`, group: "branch" as const, name: actionStepName(s, index), traits: laneTraits(m, s, index), desc: s.desc ?? "", expect: "hit" as const };
  const setup = swingSetup(m, laneSwingStep(s));
  // 弾切れの手の銃把打ちは右手を空にして込めている間に押す
  if (s.key === "emptyHandStrike") return { ...base, script: { setup: { ...setup, emptyHand: 1 }, cues: [tap(R)] } };
  // 右の連続は 2 回目が右の 1 段目、3 回目が 2 段目
  return { ...base, script: { setup, cues: handTaps(Array.from({ length: index + 2 }, () => R)) } };
}

// ---------------------------------------------------------------------------
// 戦意の放出
// ---------------------------------------------------------------------------

/** 導出の戦意を溜める下ごしらえ（溜め込む型は満たしておくので要らない） */
function moralePrelude(m: Readonly<MovesetDef>): DemoCue[] {
  const form = formOf(m);
  if (!form.morale.derived) return [];
  const kinds = new Set(form.morale.gain.map((g) => g.kind));
  if (kinds.has("placedShots")) return shotsPrelude(m);
  if (kinds.has("pullHit")) return [...pullCues(m), FRESH];
  if (kinds.has("applyStatus")) return [...times(m.steps.length, tap("primary")), FRESH];
  return [];
}

/** 敵を繋ぐ手（鎖の型）: 引き寄せの最初の段。左に無ければ右の段から */
function pullCues(m: Readonly<MovesetDef>): DemoCue[] {
  const left = m.steps.findIndex((s) => s.pull === true);
  if (left >= 0) return times(left + 1, tap("primary"));
  const lane = m.steps2.findIndex((s) => s.kind === "swing" && s.step.pull === true);
  return lane >= 0 ? laneCues(m, lane) : [tap("primary")];
}

/** 放出の手（型の放出の形ごと） */
function releaseCues(m: Readonly<MovesetDef>): DemoCue[] | null {
  const r = formOf(m).morale.release;
  switch (r.kind) {
    case "laneStep": {
      const index = m.steps2.findIndex((s) => s.key !== undefined && r.keys.includes(s.key));
      return index < 0 ? null : laneCues(m, index);
    }
    case "branch": {
      const b = m.branches.find((x) => x.art !== "release");
      return b === undefined ? null : b.sequence.map(tap);
    }
    case "nextPrimary":
      return r.gate === "rifle" ? rifleReleaseCues(m) : times(firstThrust(m) + 1, tap("primary"));
    case "nextMagazine":
    case "nextShot":
      // 短銃の強装填の 1 発目・装薬の詰めた次の 1 発（実演は込め終えた弾倉で始まる）
      return [tap("primary")];
    case "maxCharge": {
      const lane = m.steps2.findIndex((s) => s.kind === "charge");
      if (m.primary === "charge" && m.charge) return [hold("primary", chargeHoldSec(m.charge))];
      return lane < 0 ? null : laneCues(m, lane);
    }
    case "release":
      return [hold("secondary", GUARD_HOLD_SEC)];
    case "bothHands":
      return [{ kind: "both" }];
    case "timed":
      // 連ね投げは満ちた後の次の投げで始まる
      return [tap("primary")];
  }
}

/**
 * 実演で放出まで見せられるか。床の弾を数える型（砲）は、床に残る設置弾を撃つ器でないと
 * 放出の段に届く前に弾が炸裂して数が 0 に戻る（曲射は落ちた所で炸裂する）
 */
function releaseShown(m: Readonly<MovesetDef>): boolean {
  if (!formOf(m).morale.gain.some((g) => g.kind === "placedShots")) return true;
  return BULLETS[demoBulletKey(m)]?.mine !== undefined;
}

/** 実演が借りる器（武器種の一番早い器）の弾の key */
function demoBulletKey(m: Readonly<MovesetDef>): string {
  const base = BASES.filter((b) => b.slot === "mainHand" && b.moveset === m.key).sort((a, b) => a.minLevel - b.minLevel)[0];
  return bulletOfBase(base?.key);
}

/** 長銃の放出の手: 溜めの器は最大段まで溜めて離し、溜めでない器はリロード後の 1 発目（実演は込め終えた弾倉で始まる） */
function rifleReleaseCues(m: Readonly<MovesetDef>): DemoCue[] {
  const charge = BULLETS[demoBulletKey(m)]?.charge;
  return charge ? [hold("primary", chargeHoldSec(charge))] : [tap("primary")];
}

/** 左の最初の突きの段（長柄の放出は満ちた後の最初の突き。左で撃つ武器種は 1 発目で 0） */
function firstThrust(m: Readonly<MovesetDef>): number {
  const i = m.steps.findIndex((s) => s.shape.kind === "thrust");
  return i < 0 ? 0 : i;
}

function moraleMove(m: Readonly<MovesetDef>): ManualMove[] {
  const form = formOf(m);
  if (form.morale.gain.length === 0) return [];
  const cues = releaseCues(m);
  if (cues === null) return [];
  const label = m.moraleLabel ?? form.morale.label;
  const prelude = moralePrelude(m);
  const script: DemoScript = prelude.length > 0 ? { setup: { moraleFull: true }, prelude, cues } : { setup: { moraleFull: true }, cues };
  return [{ key: "morale", group: "morale", name: `${label}の放出`, traits: [`型 ${form.name}`], desc: "戦意が満ちた状態で出す一撃。", script, expect: releaseShown(m) ? "release" : "none" }];
}

// ---------------------------------------------------------------------------
// 頁
// ---------------------------------------------------------------------------

function summaryOf(m: Readonly<MovesetDef>): string {
  const form = formOf(m);
  if (firesByHand(m)) return `型 ${form.name}・重さ ${WEIGHT_LABEL[m.weight]}・左右のクリックで左手・右手の射撃`;
  const left = shootsPrimary(m) ? "左で射撃" : m.primary === "charge" ? `左は ${m.steps.length} 段の連撃と溜め` : `左は ${m.steps.length} 段の連撃`;
  return `型 ${form.name}・重さ ${WEIGHT_LABEL[m.weight]}・${left}・右は ${m.steps2.length} 段`;
}

/**
 * 武器種の木人までの距離（px）。左で撃つ武器種は離し、近接は左の段の一番短い届きの内側（体の半径ぶん入る）に立てて、
 * どの段も木人に当たるようにする
 */
export function foeDistanceFor(m: Readonly<MovesetDef>): number {
  if (shootsPrimary(m)) return MANUAL.gunFoeDistance;
  const reaches = m.steps.map(reachOf);
  return reachDistance(reaches.length > 0 ? Math.min(...reaches) : MANUAL.foeDistance);
}

/** 届き reach の振りが当たる木人の距離（px） */
function reachDistance(reach: number): number {
  return Math.max(MANUAL.foeMinDistance, Math.round(reach * MANUAL.foeReachRatio));
}

/** 台本が木人の距離を決めていなければ武器種の既定を入れる */
function withFoeDistance(move: ManualMove, distance: number): ManualMove {
  if (move.script.setup.foeDistance !== undefined) return move;
  return { ...move, script: { ...move.script, setup: { ...move.script.setup, foeDistance: distance } } };
}

/** 武器種 1 つの頁。本文は武器の定義と型から組む */
export function weaponManualPage(key: MovesetKey): ManualPage {
  const m = MOVESETS[key];
  const sections: ManualSection[] = [
    { heading: "特色", body: featureText(m) },
    { heading: "型と戦意", body: formText(m) },
  ];
  const distance = foeDistanceFor(m);
  const head = firesByHand(m) ? handChainMoves(m) : [chainMove(m), ...chargeMoves(m), ...laneMoves(m)];
  const moves = [...head, ...branchMoves(m), dashMove(m), ...moraleMove(m), ...ultimateMoves(key)].map((mv) => withFoeDistance(mv, distance));
  return { key, name: m.name, summary: summaryOf(m), sections, moves };
}

/** 指南書に載せる武器種（MOVESET_KEYS の並び） */
export const MANUAL_KEYS: readonly MovesetKey[] = MOVESET_KEYS;
