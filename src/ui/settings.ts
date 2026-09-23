import { defaultKeybinds, sanitizeKeybinds, type Keybinds } from "../core/input";

/**
 * 設定（mute / volume / screen shake / キー設定）。localStorage に永続化する。
 * profile.ts の loadProfile / saveProfile と同じパターン: 壊れたデータは黙ってデフォルトへ落とす。
 */

export interface Settings {
  muted: boolean;
  /** 0..1 */
  volume: number;
  /** 0..1。1 で通常の揺れ、0 で無効 */
  screenShake: number;
  /** キー設定。旧データ（フィールド無し）は既定になる。キー名は v1 のまま（追加フィールドで後方互換） */
  keybinds: Keybinds;
}

export const SETTINGS_KEY = "roguelike.settings.v1";

const CURRENT_VERSION = 1;
export const DEFAULT_VOLUME = 0.5;
export const DEFAULT_SCREEN_SHAKE = 1;
export const VOLUME_STEP = 0.1;
export const SCREEN_SHAKE_STEP = 0.1;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function defaultSettings(): Settings {
  return { muted: false, volume: DEFAULT_VOLUME, screenShake: DEFAULT_SCREEN_SHAKE, keybinds: defaultKeybinds() };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/** localStorage が存在しない環境（テスト等）でも安全に取得する */
function defaultStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadSettings(storage?: Storage): Settings {
  const target = storage ?? defaultStorage();
  if (!target) return defaultSettings();

  let raw: string | null;
  try {
    raw = target.getItem(SETTINGS_KEY);
  } catch {
    return defaultSettings();
  }
  if (!raw) return defaultSettings();

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return defaultSettings();
  }
  if (!isRecord(parsed) || parsed.version !== CURRENT_VERSION) return defaultSettings();

  const muted = typeof parsed.muted === "boolean" ? parsed.muted : false;
  const volume = typeof parsed.volume === "number" ? clamp01(parsed.volume) : DEFAULT_VOLUME;
  const screenShake = typeof parsed.screenShake === "number" ? clamp01(parsed.screenShake) : DEFAULT_SCREEN_SHAKE;
  const keybinds = sanitizeKeybinds(parsed.keybinds);
  return { muted, volume, screenShake, keybinds };
}

export function saveSettings(settings: Settings, storage?: Storage): void {
  const target = storage ?? defaultStorage();
  if (!target) return;
  try {
    target.setItem(SETTINGS_KEY, JSON.stringify({ version: CURRENT_VERSION, ...settings }));
  } catch (err) {
    console.warn("saveSettings failed", err);
  }
}

export function toggleMute(settings: Settings): void {
  settings.muted = !settings.muted;
}

/** dir の符号方向に 1 段階だけ動かす（連射防止は呼び出し側でエッジ検出する） */
export function adjustVolume(settings: Settings, dir: number): void {
  settings.volume = clamp01(settings.volume + Math.sign(dir) * VOLUME_STEP);
}

export function adjustScreenShake(settings: Settings, dir: number): void {
  settings.screenShake = clamp01(settings.screenShake + Math.sign(dir) * SCREEN_SHAKE_STEP);
}

/** キー設定だけを既定に戻す（音量などは残す） */
export function resetKeybinds(settings: Settings): void {
  settings.keybinds = defaultKeybinds();
}
