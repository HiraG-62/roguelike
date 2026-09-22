import { describe, expect, it } from "vitest";
import {
  SETTINGS_KEY,
  adjustScreenShake,
  adjustVolume,
  defaultSettings,
  loadSettings,
  saveSettings,
  toggleMute,
} from "./settings";

/** loot/profile.test.ts と同じ Map ベースの Storage モック */
class MemoryStorage implements Storage {
  private map = new Map<string, string>();

  get length(): number {
    return this.map.size;
  }

  clear(): void {
    this.map.clear();
  }

  getItem(key: string): string | null {
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }

  key(index: number): string | null {
    return Array.from(this.map.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }

  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
}

describe("settings persistence", () => {
  it("何も保存されていなければデフォルトを返す", () => {
    const storage = new MemoryStorage();
    expect(loadSettings(storage)).toEqual(defaultSettings());
  });

  it("保存した内容がそのまま読み戻る（round trip）", () => {
    const storage = new MemoryStorage();
    const settings = { muted: true, volume: 0.3, screenShake: 0.7 };
    saveSettings(settings, storage);
    expect(loadSettings(storage)).toEqual(settings);
  });

  it("壊れた JSON やバージョン不一致はデフォルトに落ちる", () => {
    const storage = new MemoryStorage();
    storage.setItem(SETTINGS_KEY, "not json");
    expect(loadSettings(storage)).toEqual(defaultSettings());

    storage.setItem(SETTINGS_KEY, JSON.stringify({ version: 999, muted: true }));
    expect(loadSettings(storage)).toEqual(defaultSettings());
  });

  it("範囲外の値は 0..1 にクランプされる", () => {
    const storage = new MemoryStorage();
    storage.setItem(SETTINGS_KEY, JSON.stringify({ version: 1, muted: false, volume: 5, screenShake: -2 }));
    expect(loadSettings(storage)).toEqual({ muted: false, volume: 1, screenShake: 0 });
  });
});

describe("settings mutation", () => {
  it("toggleMute は反転する", () => {
    const s = defaultSettings();
    toggleMute(s);
    expect(s.muted).toBe(true);
    toggleMute(s);
    expect(s.muted).toBe(false);
  });

  it("adjustVolume / adjustScreenShake は符号方向に1段階動き 0..1 でクランプする", () => {
    const s = defaultSettings();
    adjustVolume(s, 1);
    expect(s.volume).toBeCloseTo(0.6);
    adjustVolume(s, -1);
    adjustVolume(s, -1);
    expect(s.volume).toBeCloseTo(0.4);

    s.screenShake = 0;
    adjustScreenShake(s, -5);
    expect(s.screenShake).toBe(0);
    s.screenShake = 1;
    adjustScreenShake(s, 5);
    expect(s.screenShake).toBe(1);
  });
});
