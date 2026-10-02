import { type EliteKind, type Enemy, type GameState, type Jin, ROAMING_ROOM, pushLog, pushSfx } from "../core/state";
import { dist } from "../core/vec";
import { type EnemyDef, enemyDef } from "../data/enemies";
import { roleOf } from "../data/enemyRoles";
import { NEMESIS } from "../data/tuning";
import { isBossDepth } from "./boss";
import { nemesisEligible } from "./deathCause";
import { dropKey } from "./economy";
import { addFloatingText } from "./effects";
import { ELITE_PAIRS, eliteDisplayName, eliteKindsFor, eliteKindsForRole, makeElite, makeElitePair } from "./elites";
import { memberWeight } from "./jin";
import { addJinMember, applyHpMul, makeStrong } from "./jinSpawn";
import { dropItem } from "./loot";
import type { NemesisSpec } from "./runMeta";

/**
 * 仇（docs/ideas/meta-impl.md 2-4）。直近のランで力尽きた相手が、次のランの眠った陣に 1 体だけ混ざる。
 * 修飾子を 1 つ足し、格は猛。倒すと仇討ち（遺物と鍵）。置き方・強さは乱数を引かない
 */

export interface NemesisRun {
  spec: NemesisSpec;
  /** 出てよい最も浅い階 */
  spawnDepth: number;
  /** 置いた仇の敵 id。まだ置いていなければ null */
  enemyId: number | null;
  /** 1 ラン 1 体（上り階段で戻った階・2 体目は出さない） */
  placed: boolean;
  avenged: boolean;
}

/** 仇討ちの浮き文字の大きさと寿命（階の到着の告知と揃える） */
const AVENGE_TEXT_SCALE = 2;
const AVENGE_TEXT_LIFE = 1.4;

export function createNemesisRun(spec: NemesisSpec | null): NemesisRun | null {
  if (!spec || !nemesisEligible(spec.key)) return null;
  const def = enemyDef(spec.key);
  const spawnDepth = Math.max(NEMESIS.minDepth, spec.depth - NEMESIS.depthLead, def.minDepth);
  return { spec: { key: spec.key, elites: [...spec.elites], depth: spec.depth }, spawnDepth, enemyId: null, placed: false, avenged: false };
}

/** この階に仇を置いてよいか: 未配置・spawnDepth 以上・ボスの階と最深の間でない・拠点でない・上り階段で戻った階でない */
function canPlaceHere(state: GameState, run: NemesisRun): boolean {
  if (run.placed || state.sandbox) return false;
  if (state.depth < run.spawnDepth || isBossDepth(state.depth)) return false;
  return !state.runEvents.strata.revisit;
}

/** 開始地点から遠い順（同じなら id の小さい順）の眠った陣。部屋の陣だけ（長蛇・物見は歩くので外す） */
function candidateJins(state: GameState): Jin[] {
  const start = state.player.body.pos;
  return state.jins
    .filter((j) => j.roomIndex !== ROAMING_ROOM && j.phase === "sleeping")
    .sort((a, b) => dist(b.center, start) - dist(a.center, start) || a.id - b.id);
}

/** buildFloor の末尾（出口の予告を消す直前）。置けなければ次の階で再挑戦 */
export function placeNemesis(state: GameState): void {
  const run = state.nemesis;
  if (!run || !canPlaceHere(state, run)) return;
  const def = enemyDef(run.spec.key);
  for (const jin of candidateJins(state)) {
    const e = addJinMember(state, jin, def, jin.center);
    if (!e) continue;
    strengthen(e, def, run.spec.elites);
    // 群勢の最大に仇の重さを足す（倒したときの減りと釣り合わせる。格を決めた後の重さ）
    const w = memberWeight(jin, e);
    jin.moraleMax += w;
    jin.morale += w;
    run.placed = true;
    run.enemyId = e.id;
    pushLog(state, `仇の気配: ${nemesisName(e)}`, NEMESIS.color);
    pushSfx(state, "runEventWarn");
    return;
  }
}

/** 記録の修飾子を濾して 1 つ足し（2 つで頭打ち、以後は生命の倍率）、猛と生命の倍率を掛ける */
function strengthen(e: Enemy, def: EnemyDef, recorded: readonly EliteKind[]): void {
  // 生成のフック（縛り・反転層）の精鋭化は addJinMember が飛ばすので、ここで付く精鋭は記録のものだけ
  const allowed = eliteKindsFor(def);
  const kinds = recorded.filter((k) => allowed.includes(k));
  const [main, second] = kinds;
  if (main === undefined) {
    const first = eliteKindsForRole(def, roleOf(def))[0];
    if (first !== undefined) makeElite(e, first);
  } else if (second === undefined) {
    const extra = partnerOf(main, allowed);
    if (extra === undefined) makeElite(e, main);
    else makeElitePair(e, main, extra);
  } else {
    makeElitePair(e, main, second);
    applyHpMul(e, NEMESIS.maxedHpMul);
  }
  makeStrong(e);
  applyHpMul(e, NEMESIS.hpMul);
  e.nemesis = true;
}

/** main と組む添え: ELITE_PAIRS で main と組む最初の許される相手、無ければ main 以外の最初の許される種類 */
function partnerOf(main: EliteKind, allowed: readonly EliteKind[]): EliteKind | undefined {
  for (const [a, b] of ELITE_PAIRS) {
    if (a === main && allowed.includes(b)) return b;
    if (b === main && allowed.includes(a)) return a;
  }
  return allowed.find((k) => k !== main);
}

/** ログに出す名前（名札の「仇・」は見出しと重なるので外す） */
function nemesisName(e: Enemy): string {
  return eliteDisplayName({ ...e, nemesis: undefined });
}

/** enemyTraits.ts の onEnemyDeath の末尾（消えた敵は呼ばれない）。蘇った敵は数えない */
export function onNemesisDeath(state: GameState, e: Enemy): void {
  if (!e.nemesis || e.vanished || e.revived) return;
  const run = state.nemesis;
  if (!run || run.avenged) return;
  run.avenged = true;
  const pos = { ...e.body.pos };
  for (let i = 0; i < NEMESIS.rewardItems; i++) dropItem(state, pos, NEMESIS.rewardBoost);
  for (let i = 0; i < NEMESIS.rewardKeys; i++) dropKey(state, pos);
  addFloatingText(state, pos, "仇討ち", NEMESIS.color, AVENGE_TEXT_SCALE, AVENGE_TEXT_LIFE, "notice");
  pushLog(state, `仇を討った: ${nemesisName(e)}`, NEMESIS.color);
  pushSfx(state, "questComplete");
}
