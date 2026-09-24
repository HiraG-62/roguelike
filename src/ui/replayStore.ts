/**
 * リプレイの永続化。プロフィールとは別キーに最新 REPLAY_LIMIT 件だけ保存する（最新が先頭）。
 * 容量超過したら古いものから捨てて保存し直す。
 */
import { saveStorage } from "../save/backend";
import { type ReplayData, sanitizeReplay } from "../core/replay";

export const REPLAY_STORE_KEY = "roguelike.replays.v1";
export const REPLAY_LIMIT = 10;

/** 保存済みリプレイを読む。壊れた要素は捨てる */
export function loadReplays(storage?: Storage): ReplayData[] {
  const target = storage ?? saveStorage();
  if (!target) return [];
  let raw: string | null;
  try {
    raw = target.getItem(REPLAY_STORE_KEY);
  } catch {
    return [];
  }
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: ReplayData[] = [];
  for (const v of parsed) {
    const replay = sanitizeReplay(v);
    if (replay) out.push(replay);
  }
  return out.slice(0, REPLAY_LIMIT);
}

/** 書き込めるまで末尾（古いもの）を削って再試行する。1 件も書けなければ false */
function writeReplays(target: Storage, replays: ReplayData[]): boolean {
  const list = [...replays];
  while (list.length > 0) {
    try {
      target.setItem(REPLAY_STORE_KEY, JSON.stringify(list));
      return true;
    } catch {
      list.pop();
    }
  }
  return false;
}

/** 先頭に 1 件追加し、最新 REPLAY_LIMIT 件だけ保存する。保存後の一覧を返す */
export function pushReplay(replay: ReplayData, storage?: Storage): ReplayData[] {
  const target = storage ?? saveStorage();
  const list = [replay, ...loadReplays(target ?? undefined)].slice(0, REPLAY_LIMIT);
  if (!target) return list;
  if (!writeReplays(target, list)) console.warn("pushReplay: storage full");
  return list;
}

/** ラン履歴エントリ（date = ラン終了時刻）に対応するリプレイを探す */
export function findReplayForEntry(replays: readonly ReplayData[], entry: { date: number; seedText: string }): ReplayData | null {
  return replays.find((r) => r.endedAt === entry.date && r.seedText === entry.seedText) ?? null;
}
