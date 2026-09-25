import { saveStorage } from "../save/backend";
import { defaultKeybinds, sanitizeKeybinds, type Keybinds } from "../core/input";

/**
 * 設定（mute / volume / 音楽の音量 / screen shake / キー設定）。save/backend.ts の保存先に永続化する（キー設定だけは別キー）。
 * profile.ts の loadProfile / saveProfile と同じパターン: 壊れたデータは黙ってデフォルトへ落とす。
 */

export interface Settings {
  muted: boolean;
  /** 0..1 */
  volume: number;
  /** 0..1。音楽の音量（全体の volume に掛かる）。旧データ（フィールド無し）は既定 */
  musicVolume: number;
  /** 0..1。1 で通常の揺れ、0 で無効 */
  screenShake: number;
  /**
   * ヒットストップの強度（0..1、0.25 刻み）。既定 1、0 で無効。core/game.ts の createGame へ渡り、
   * state.hitstopScale としてシミュレーションに効くため決定性を保つ（core/replay.ts が記録する）
   */
  hitstopScale: number;
  /** 床のアイテムの性能ポップアップ（render/dropTooltip.ts）を表示するか。既定 true。表示だけの設定 */
  dropTooltip: boolean;
  /** キー設定。KEYBINDS_KEY に別保存する。どちらにも無ければ既定 */
  keybinds: Keybinds;
}

export const SETTINGS_KEY = "roguelike.settings.v1";
/** キー設定は単独のファイル（Electron 版の keybinds.json）にするため settings から分離した別キー */
export const KEYBINDS_KEY = "roguelike.keybinds.v1";

const CURRENT_VERSION = 1;
export const DEFAULT_VOLUME = 0.5;
export const DEFAULT_MUSIC_VOLUME = 0.5;
export const DEFAULT_SCREEN_SHAKE = 1;
export const DEFAULT_HITSTOP_SCALE = 1;
export const DEFAULT_DROP_TOOLTIP = true;
export const VOLUME_STEP = 0.1;
export const SCREEN_SHAKE_STEP = 0.1;
export const HITSTOP_SCALE_STEP = 0.25;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** 0..1 を HITSTOP_SCALE_STEP 刻みに丸める */
function clampHitstopScale(value: number): number {
  return Math.round(clamp01(value) / HITSTOP_SCALE_STEP) * HITSTOP_SCALE_STEP;
}

export function defaultSettings(): Settings {
  return {
    muted: false,
    volume: DEFAULT_VOLUME,
    musicVolume: DEFAULT_MUSIC_VOLUME,
    screenShake: DEFAULT_SCREEN_SHAKE,
    hitstopScale: DEFAULT_HITSTOP_SCALE,
    dropTooltip: DEFAULT_DROP_TOOLTIP,
    keybinds: defaultKeybinds(),
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/** 保存先から version の合う JSON オブジェクトを読む。無い・壊れている・触れない・version 不一致なら null */
function readVersioned(target: Storage, key: string): Record<string, unknown> | null {
  let parsed: unknown;
  try {
    const raw = target.getItem(key);
    if (!raw) return null;
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || parsed.version !== CURRENT_VERSION) return null;
  return parsed;
}

export function loadSettings(storage?: Storage): Settings {
  const target = storage ?? saveStorage();
  if (!target) return defaultSettings();

  const parsed = readVersioned(target, SETTINGS_KEY);
  // キー設定は別キー。まだ分離前の保存なら旧 settings に埋め込まれた分を読む（次の保存で分離される）
  const keybindsSave = readVersioned(target, KEYBINDS_KEY);
  const keybinds = sanitizeKeybinds(keybindsSave ? keybindsSave.keybinds : parsed?.keybinds);
  if (!parsed) return { ...defaultSettings(), keybinds };

  const muted = typeof parsed.muted === "boolean" ? parsed.muted : false;
  const volume = typeof parsed.volume === "number" ? clamp01(parsed.volume) : DEFAULT_VOLUME;
  const musicVolume = typeof parsed.musicVolume === "number" ? clamp01(parsed.musicVolume) : DEFAULT_MUSIC_VOLUME;
  const screenShake = typeof parsed.screenShake === "number" ? clamp01(parsed.screenShake) : DEFAULT_SCREEN_SHAKE;
  const hitstopScale = typeof parsed.hitstopScale === "number" ? clampHitstopScale(parsed.hitstopScale) : DEFAULT_HITSTOP_SCALE;
  const dropTooltip = typeof parsed.dropTooltip === "boolean" ? parsed.dropTooltip : DEFAULT_DROP_TOOLTIP;
  return { muted, volume, musicVolume, screenShake, hitstopScale, dropTooltip, keybinds };
}

export function saveSettings(settings: Settings, storage?: Storage): void {
  const target = storage ?? saveStorage();
  if (!target) return;
  const { keybinds, ...rest } = settings;
  try {
    target.setItem(SETTINGS_KEY, JSON.stringify({ version: CURRENT_VERSION, ...rest }));
    target.setItem(KEYBINDS_KEY, JSON.stringify({ version: CURRENT_VERSION, keybinds }));
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

export function adjustMusicVolume(settings: Settings, dir: number): void {
  settings.musicVolume = clamp01(settings.musicVolume + Math.sign(dir) * VOLUME_STEP);
}

export function adjustScreenShake(settings: Settings, dir: number): void {
  settings.screenShake = clamp01(settings.screenShake + Math.sign(dir) * SCREEN_SHAKE_STEP);
}

export function adjustHitstopScale(settings: Settings, dir: number): void {
  settings.hitstopScale = clampHitstopScale(settings.hitstopScale + Math.sign(dir) * HITSTOP_SCALE_STEP);
}

/** ゲージのドラッグ/クリックで直接値を決める。1% 刻み（0..1 を 0..100 の整数として扱う） */
const GAUGE_STEP = 0.01;
function roundToGaugeStep(value01: number): number {
  return Math.round(clamp01(value01) / GAUGE_STEP) * GAUGE_STEP;
}

export function setVolume(settings: Settings, value01: number): void {
  settings.volume = roundToGaugeStep(value01);
}

export function setMusicVolume(settings: Settings, value01: number): void {
  settings.musicVolume = roundToGaugeStep(value01);
}

export function setScreenShake(settings: Settings, value01: number): void {
  settings.screenShake = roundToGaugeStep(value01);
}

/** ヒットストップは値域が 0.25 刻みの離散値なので、ゲージもその刻みに合わせる */
export function setHitstopScale(settings: Settings, value01: number): void {
  settings.hitstopScale = clampHitstopScale(value01);
}

export function toggleDropTooltip(settings: Settings): void {
  settings.dropTooltip = !settings.dropTooltip;
}

/** キー設定だけを既定に戻す（音量などは残す） */
export function resetKeybinds(settings: Settings): void {
  settings.keybinds = defaultKeybinds();
}
