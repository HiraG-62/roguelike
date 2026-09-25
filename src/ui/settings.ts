import { saveStorage } from "../save/backend";
import { defaultKeybinds, sanitizeKeybinds, type Keybinds } from "../core/input";
import { defaultPadBinds, sanitizePadBinds, type PadBinds } from "../core/padBinds";

/**
 * 設定（mute / volume / 音楽の音量 / screen shake / キー設定 / パッド設定）。save/backend.ts の保存先に永続化する（キー設定とパッド設定は別キー）。
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
   * ヒットストップの強度（0..HITSTOP_SCALE_MAX、0.25 刻み）。既定 1（標準）、0 で無効、最大で通常の 2 倍長く止まる。
   * core/game.ts の createGame へ渡り、state.hitstopScale としてシミュレーションに効くため決定性を保つ
   * （core/replay.ts が記録する。ラン中に変えたときは main.ts が state へも書き戻してリプレイイベントを積む）
   */
  hitstopScale: number;
  /** 床のアイテムの性能ポップアップ（render/dropTooltip.ts）を表示するか。既定 true。表示だけの設定 */
  dropTooltip: boolean;
  /** キー設定。KEYBINDS_KEY に別保存する。どちらにも無ければ既定 */
  keybinds: Keybinds;
  /** パッドのボタン設定。PADBINDS_KEY に別保存する。無ければ既定 */
  padBinds: PadBinds;
}

export const SETTINGS_KEY = "roguelike.settings.v1";
/** キー設定は単独のファイル（Electron 版の keybinds.json）にするため settings から分離した別キー */
export const KEYBINDS_KEY = "roguelike.keybinds.v1";
/** パッドのボタン設定もキー設定と同じ理由で別キー（Electron 版の padbinds.json） */
export const PADBINDS_KEY = "roguelike.padbinds.v1";

const CURRENT_VERSION = 1;
export const DEFAULT_VOLUME = 0.5;
export const DEFAULT_MUSIC_VOLUME = 0.5;
export const DEFAULT_SCREEN_SHAKE = 1;
export const DEFAULT_HITSTOP_SCALE = 1;
export const DEFAULT_DROP_TOOLTIP = true;
export const VOLUME_STEP = 0.1;
export const SCREEN_SHAKE_STEP = 0.1;
export const HITSTOP_SCALE_STEP = 0.25;
/** ヒットストップの強度の上限。1 が標準（旧仕様の最大値）、2 で標準の倍まで止まる */
export const HITSTOP_SCALE_MAX = 2;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function clamp(value: number, max: number): number {
  return Math.min(max, Math.max(0, value));
}

/** 0..HITSTOP_SCALE_MAX を HITSTOP_SCALE_STEP 刻みに丸める */
export function clampHitstopScale(value: number): number {
  return Math.round(clamp(value, HITSTOP_SCALE_MAX) / HITSTOP_SCALE_STEP) * HITSTOP_SCALE_STEP;
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
    padBinds: defaultPadBinds(),
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
  const padBinds = sanitizePadBinds(readVersioned(target, PADBINDS_KEY)?.padBinds);
  if (!parsed) return { ...defaultSettings(), keybinds, padBinds };

  const muted = typeof parsed.muted === "boolean" ? parsed.muted : false;
  const volume = typeof parsed.volume === "number" ? clamp01(parsed.volume) : DEFAULT_VOLUME;
  const musicVolume = typeof parsed.musicVolume === "number" ? clamp01(parsed.musicVolume) : DEFAULT_MUSIC_VOLUME;
  const screenShake = typeof parsed.screenShake === "number" ? clamp01(parsed.screenShake) : DEFAULT_SCREEN_SHAKE;
  const hitstopScale = typeof parsed.hitstopScale === "number" ? clampHitstopScale(parsed.hitstopScale) : DEFAULT_HITSTOP_SCALE;
  const dropTooltip = typeof parsed.dropTooltip === "boolean" ? parsed.dropTooltip : DEFAULT_DROP_TOOLTIP;
  return { muted, volume, musicVolume, screenShake, hitstopScale, dropTooltip, keybinds, padBinds };
}

export function saveSettings(settings: Settings, storage?: Storage): void {
  const target = storage ?? saveStorage();
  if (!target) return;
  const { keybinds, padBinds, ...rest } = settings;
  try {
    target.setItem(SETTINGS_KEY, JSON.stringify({ version: CURRENT_VERSION, ...rest }));
    target.setItem(KEYBINDS_KEY, JSON.stringify({ version: CURRENT_VERSION, keybinds }));
    target.setItem(PADBINDS_KEY, JSON.stringify({ version: CURRENT_VERSION, padBinds }));
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

/**
 * ゲージ上の位置（0..1）を実際の強度（0..HITSTOP_SCALE_MAX）へ写し、0.25 刻みに丸める。
 * 他のゲージと違い値域が 0..1 でないため、ここだけ HITSTOP_SCALE_MAX を掛ける
 */
export function setHitstopScale(settings: Settings, value01: number): void {
  settings.hitstopScale = clampHitstopScale(roundToGaugeStep(value01) * HITSTOP_SCALE_MAX);
}

export function toggleDropTooltip(settings: Settings): void {
  settings.dropTooltip = !settings.dropTooltip;
}

/** キー設定だけを既定に戻す（音量などは残す） */
export function resetKeybinds(settings: Settings): void {
  settings.keybinds = defaultKeybinds();
}

/** パッドのボタン設定だけを既定に戻す */
export function resetPadBinds(settings: Settings): void {
  settings.padBinds = defaultPadBinds();
}
