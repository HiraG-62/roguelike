import { describe, expect, it } from "vitest";
import { DEFAULT_KEYBINDS, assignBinding, defaultKeybinds } from "../core/input";
import {
  SETTINGS_KEY,
  adjustScreenShake,
  adjustVolume,
  defaultSettings,
  loadSettings,
  resetKeybinds,
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
    const settings = { muted: true, volume: 0.3, screenShake: 0.7, keybinds: defaultKeybinds() };
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
    expect(loadSettings(storage)).toEqual({ muted: false, volume: 1, screenShake: 0, keybinds: defaultKeybinds() });
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

describe("キー設定の永続化", () => {
  it("変更したキー設定が保存→読込で往復する", () => {
    const storage = new MemoryStorage();
    const settings = defaultSettings();
    const changed = assignBinding(settings.keybinds, "attack", 0, "KeyJ");
    expect(changed, "割り当てできる").not.toBeNull();
    if (!changed) return;
    settings.keybinds = changed;
    saveSettings(settings, storage);
    const loaded = loadSettings(storage);
    expect(loaded.keybinds.attack, "攻撃の主が J のまま読み戻る").toEqual(["KeyJ", "Mouse0"]);
    expect(loaded.keybinds).toEqual(changed);
  });

  it("keybinds の無い旧データは既定のキー設定で読める（v1 のまま後方互換）", () => {
    const storage = new MemoryStorage();
    storage.setItem(SETTINGS_KEY, JSON.stringify({ version: 1, muted: true, volume: 0.2, screenShake: 1 }));
    const loaded = loadSettings(storage);
    expect(loaded.muted).toBe(true);
    expect(loaded.keybinds).toEqual(defaultKeybinds());
  });

  it("壊れた keybinds は既定へ落ち、他の設定は残る", () => {
    const storage = new MemoryStorage();
    storage.setItem(SETTINGS_KEY, JSON.stringify({ version: 1, muted: false, volume: 0.4, screenShake: 1, keybinds: "broken" }));
    const loaded = loadSettings(storage);
    expect(loaded.volume).toBeCloseTo(0.4);
    expect(loaded.keybinds).toEqual(defaultKeybinds());
  });

  it("resetKeybinds はキー設定だけを既定へ戻す", () => {
    const settings = defaultSettings();
    settings.volume = 0.9;
    const changed = assignBinding(settings.keybinds, "dash", 0, "KeyG");
    if (changed) settings.keybinds = changed;
    resetKeybinds(settings);
    expect(settings.keybinds.dash).toEqual(DEFAULT_KEYBINDS.dash);
    expect(settings.volume).toBeCloseTo(0.9);
  });
});
