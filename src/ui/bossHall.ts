/**
 * ボスの間の一覧と結果の文（DOM 非依存。docs/ideas/meta-impl.md 2-7）。
 * 一覧は祭壇と同じ ListScreen で出し、行の key はボスの key。倒したことのないボスは ？？？ で挑めない
 */
import { actionKeyLabel } from "../core/input";
import { enemyDef } from "../data/enemies";
import { type CodexSave, UNKNOWN_NAME } from "../meta/codex";
import { type HallRecord, type HubSave, hallRecordOf } from "../meta/hubStore";
import type { ListEntry, ListTab } from "../meta/listScreen";
import type { HallOutcome } from "../system/bossHall";
import { hallBossKeys, hallDepthOf } from "../system/bossHallKeys";

export const HALL_TITLE = "ボスの間";
export const HALL_LIST_HINT = "↑↓ / ホイール 選ぶ　Enter / クリック 挑む　Esc 拠点へ";
/** 秒の表示の小数の桁 */
const SECONDS_DIGITS = 1;

function formatSeconds(seconds: number): string {
  return seconds.toFixed(SECONDS_DIGITS);
}

function bossLabel(key: string): string {
  const def = enemyDef(key);
  return def.bossTitle ?? def.name;
}

/** 本番のランで倒したことがあるか（図鑑の倒した数）。倒したボスだけ挑める */
export function hallUnlocked(codex: CodexSave, key: string): boolean {
  return (codex.enemyKills[key] ?? 0) > 0;
}

function recordInfo(record: HallRecord | undefined): string {
  if (record?.bestSeconds === undefined) return "未撃破";
  return `最速 ${formatSeconds(record.bestSeconds)} 秒・被弾 ${record.fewestHits ?? 0}`;
}

function hallEntry(key: string, codex: CodexSave, save: HubSave): ListEntry {
  if (!hallUnlocked(codex, key)) return { key, known: false, name: UNKNOWN_NAME, info: "", detail: "" };
  const record = hallRecordOf(save, key);
  const depth = hallDepthOf(key) ?? 0;
  const tries = record?.tries ?? 0;
  const wins = record?.wins ?? 0;
  return {
    key,
    known: true,
    name: bossLabel(key),
    info: recordInfo(record),
    detail: `地下 ${depth} 階。挑戦 ${tries} 回・撃破 ${wins} 回。${actionKeyLabel("confirm")} で挑む`,
  };
}

/** ボスの間の一覧。章ボス（章の順）→ 最深の主 */
export function hallTabs(codex: CodexSave, save: HubSave): ListTab[] {
  const keys = hallBossKeys();
  return [{ label: `ボス ${keys.length}`, entries: keys.map((k) => hallEntry(k, codex, save)) }];
}

/** 一覧の行から挑むボスの key。？？？（未撃破）や知らない key は null */
export function hallKeyOfEntry(entry: ListEntry | undefined): string | null {
  if (!entry || !entry.known) return null;
  return hallDepthOf(entry.key) === null ? null : entry.key;
}

/** 最速の行。撃破して前の最速より速ければ（または初めての撃破なら）更新を示す。記録が無ければ出さない */
function bestLine(outcome: HallOutcome, before: HallRecord | undefined): string | null {
  const prev = before?.bestSeconds;
  if (outcome.won && (prev === undefined || outcome.seconds < prev)) return `最速 ${formatSeconds(outcome.seconds)} 秒（更新）`;
  if (prev === undefined) return null;
  return `最速 ${formatSeconds(prev)} 秒`;
}

/** 結果の行（1 行目が見出し）。before は今回の挑戦を足す前の記録 */
export function hallResultLines(outcome: HallOutcome, before: HallRecord | undefined): string[] {
  const seconds = formatSeconds(outcome.seconds);
  const head = outcome.won ? `撃破 ${seconds} 秒・被弾 ${outcome.hits}・ダウン ${outcome.downs}` : `力尽きた ${seconds} 秒・被弾 ${outcome.hits}`;
  const best = bestLine(outcome, before);
  return best === null ? [head] : [head, best];
}

/** 結果の下の案内 */
export function hallResultHint(): string {
  return `${actionKeyLabel("confirm")}: もう一度　Esc: 拠点へ`;
}

/** 挑戦中の画面の上に出す案内 */
export function hallFightHint(key: string): string {
  return `${HALL_TITLE}: ${bossLabel(key)}　Esc: 拠点へ`;
}
