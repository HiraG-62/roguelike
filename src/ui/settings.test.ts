import { describe, expect, it } from "vitest";
import { DEFAULT_KEYBINDS, assignBinding, defaultKeybinds } from "../core/input";
import { assignPadBinding, defaultPadBinds, padChordCode } from "../core/padBinds";
import {
  DEFAULT_DROP_TOOLTIP,
  DEFAULT_HITSTOP_SCALE,
  DEFAULT_MUSIC_VOLUME,
  HITSTOP_SCALE_MAX,
  KEYBINDS_KEY,
  PADBINDS_KEY,
  SETTINGS_KEY,
  adjustHitstopScale,
  adjustMusicVolume,
  adjustScreenShake,
  adjustVolume,
  defaultSettings,
  loadSettings,
  resetKeybinds,
  resetPadBinds,
  saveSettings,
  setHitstopScale,
  setMusicVolume,
  setScreenShake,
  setVolume,
  toggleDropTooltip,
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
    const settings = { muted: true, volume: 0.3, musicVolume: 0.8, screenShake: 0.7, hitstopScale: 0.5, dropTooltip: false, keybinds: defaultKeybinds(), padBinds: defaultPadBinds() };
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
    storage.setItem(SETTINGS_KEY, JSON.stringify({ version: 1, muted: false, volume: 5, musicVolume: 3, screenShake: -2 }));
    expect(loadSettings(storage)).toEqual({
      muted: false,
      volume: 1,
      musicVolume: 1,
      screenShake: 0,
      hitstopScale: DEFAULT_HITSTOP_SCALE,
      dropTooltip: DEFAULT_DROP_TOOLTIP,
      keybinds: defaultKeybinds(),
      padBinds: defaultPadBinds(),
    });
  });

  it("音楽の音量が無い旧データは既定の音楽の音量で読める", () => {
    const storage = new MemoryStorage();
    storage.setItem(SETTINGS_KEY, JSON.stringify({ version: 1, muted: false, volume: 0.3, screenShake: 1 }));
    const loaded = loadSettings(storage);
    expect(loaded.musicVolume, "既定の音楽の音量").toBe(DEFAULT_MUSIC_VOLUME);
    expect(loaded.volume, "全体の音量は残る").toBeCloseTo(0.3);
  });
});

describe("ヒットストップ強度 / アイテム情報表示の設定", () => {
  it("旧データ（新フィールド無し）は既定値に落ちる", () => {
    const storage = new MemoryStorage();
    storage.setItem(SETTINGS_KEY, JSON.stringify({ version: 1, muted: false, volume: 0.3, screenShake: 1 }));
    const loaded = loadSettings(storage);
    expect(loaded.hitstopScale).toBe(DEFAULT_HITSTOP_SCALE);
    expect(loaded.dropTooltip).toBe(DEFAULT_DROP_TOOLTIP);
  });

  it("ヒットストップの強さは 2.0 まで上げられる", () => {
    const storage = new MemoryStorage();
    storage.setItem(SETTINGS_KEY, JSON.stringify({ version: 1, muted: false, volume: 0.3, screenShake: 1, hitstopScale: HITSTOP_SCALE_MAX }));
    expect(loadSettings(storage).hitstopScale).toBe(2);
  });

  it("hitstopScale は範囲外を 0..HITSTOP_SCALE_MAX に丸め、0.25 刻みへ寄せる", () => {
    const storage = new MemoryStorage();
    storage.setItem(SETTINGS_KEY, JSON.stringify({ version: 1, muted: false, volume: 0.3, screenShake: 1, hitstopScale: 5 }));
    expect(loadSettings(storage).hitstopScale).toBe(HITSTOP_SCALE_MAX);

    storage.setItem(SETTINGS_KEY, JSON.stringify({ version: 1, muted: false, volume: 0.3, screenShake: 1, hitstopScale: -2 }));
    expect(loadSettings(storage).hitstopScale).toBe(0);

    storage.setItem(SETTINGS_KEY, JSON.stringify({ version: 1, muted: false, volume: 0.3, screenShake: 1, hitstopScale: 0.6 }));
    expect(loadSettings(storage).hitstopScale, "0.6 は 0.5 刻みに丸まる").toBe(0.5);
  });

  it("保存して読み直せる（round trip）", () => {
    const storage = new MemoryStorage();
    const settings = defaultSettings();
    settings.hitstopScale = 0.25;
    settings.dropTooltip = false;
    saveSettings(settings, storage);
    const loaded = loadSettings(storage);
    expect(loaded.hitstopScale).toBe(0.25);
    expect(loaded.dropTooltip).toBe(false);
  });

  it("adjustHitstopScale は 0.25 刻みで動き 0..HITSTOP_SCALE_MAX でクランプする", () => {
    const s = defaultSettings();
    adjustHitstopScale(s, -1);
    expect(s.hitstopScale).toBe(0.75);
    s.hitstopScale = 0;
    adjustHitstopScale(s, -5);
    expect(s.hitstopScale, "0 未満にはならない").toBe(0);
    s.hitstopScale = HITSTOP_SCALE_MAX;
    adjustHitstopScale(s, 5);
    expect(s.hitstopScale, "上限を超えない").toBe(HITSTOP_SCALE_MAX);
  });

  it("toggleDropTooltip は反転する", () => {
    const s = defaultSettings();
    toggleDropTooltip(s);
    expect(s.dropTooltip).toBe(false);
    toggleDropTooltip(s);
    expect(s.dropTooltip).toBe(true);
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

    adjustMusicVolume(s, 1);
    expect(s.musicVolume, "音楽の音量も 1 段階").toBeCloseTo(DEFAULT_MUSIC_VOLUME + 0.1);
    s.musicVolume = 1;
    adjustMusicVolume(s, 1);
    expect(s.musicVolume, "音楽の音量は 1 で止まる").toBe(1);

    s.screenShake = 0;
    adjustScreenShake(s, -5);
    expect(s.screenShake).toBe(0);
    s.screenShake = 1;
    adjustScreenShake(s, 5);
    expect(s.screenShake).toBe(1);
  });

  it("ゲージの setVolume/setMusicVolume/setScreenShake は 0..1 を 1% 刻みに丸め、範囲外はクランプする", () => {
    const s = defaultSettings();
    setVolume(s, 0.5);
    expect(s.volume, "左端で 0、右端で 1、中央で 0.5").toBe(0.5);
    setVolume(s, -1);
    expect(s.volume).toBe(0);
    setVolume(s, 2);
    expect(s.volume).toBe(1);
    setVolume(s, 0.333);
    expect(s.volume, "1% 刻みに丸まる").toBe(0.33);

    setMusicVolume(s, 0.678);
    expect(s.musicVolume).toBe(0.68);
    setScreenShake(s, 0.001);
    expect(s.screenShake).toBe(0);
  });

  it("ゲージの setHitstopScale は 0..1 の位置を 0..HITSTOP_SCALE_MAX へ写し 0.25 刻みへ寄せる", () => {
    const s = defaultSettings();
    setHitstopScale(s, 0.5);
    expect(s.hitstopScale, "ゲージ中央が標準の強さ 1.0").toBe(1);
    setHitstopScale(s, -1);
    expect(s.hitstopScale, "左端未満は 0").toBe(0);
    setHitstopScale(s, 2);
    expect(s.hitstopScale, "右端超えは上限").toBe(HITSTOP_SCALE_MAX);
    setHitstopScale(s, 1);
    expect(s.hitstopScale, "右端で最大の 2.0 まで上げられる").toBe(HITSTOP_SCALE_MAX);
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

describe("キー設定の別キー保存", () => {
  it("キー設定は roguelike.keybinds.v1 に別保存され settings 側には含まれない", () => {
    const storage = new MemoryStorage();
    const settings = defaultSettings();
    const changed = assignBinding(settings.keybinds, "dash", 0, "KeyG");
    if (changed) settings.keybinds = changed;
    saveSettings(settings, storage);
    expect(KEYBINDS_KEY).toBe("roguelike.keybinds.v1");
    const rawSettings = JSON.parse(storage.getItem(SETTINGS_KEY) ?? "{}") as Record<string, unknown>;
    expect("keybinds" in rawSettings, "settings 側にキー設定を含めない").toBe(false);
    const rawKeybinds = JSON.parse(storage.getItem(KEYBINDS_KEY) ?? "{}") as Record<string, unknown>;
    expect(rawKeybinds.keybinds, "キー設定は別キーに入る").toEqual(settings.keybinds);
  });

  it("旧 settings に埋め込まれたキー設定を keybinds キーが無いときだけ読む", () => {
    const legacy = assignBinding(defaultKeybinds(), "attack", 0, "KeyJ");
    const separate = assignBinding(defaultKeybinds(), "attack", 0, "KeyK");
    expect(legacy && separate, "割り当てできる").toBeTruthy();
    const storage = new MemoryStorage();
    storage.setItem(SETTINGS_KEY, JSON.stringify({ version: 1, muted: true, volume: 0.2, screenShake: 1, keybinds: legacy }));
    expect(loadSettings(storage).keybinds, "別キーが無ければ旧データを読む").toEqual(legacy);
    storage.setItem(KEYBINDS_KEY, JSON.stringify({ version: 1, keybinds: separate }));
    const loaded = loadSettings(storage);
    expect(loaded.keybinds, "別キーがあればそちらを優先").toEqual(separate);
    expect(loaded.muted, "他の設定は settings 側から").toBe(true);
  });

  it("settings が無くても別キーのキー設定は読める", () => {
    const changed = assignBinding(defaultKeybinds(), "dash", 0, "KeyG");
    const storage = new MemoryStorage();
    storage.setItem(KEYBINDS_KEY, JSON.stringify({ version: 1, keybinds: changed }));
    expect(loadSettings(storage)).toEqual({ ...defaultSettings(), keybinds: changed });
  });
});

describe("パッド設定の保存", () => {
  it("パッド設定は roguelike.padbinds.v1 に別保存され、読み戻せる", () => {
    const storage = new MemoryStorage();
    const settings = defaultSettings();
    const changed = assignPadBinding(settings.padBinds, "dash", 0, padChordCode(5, 0));
    expect(changed, "割り当てできる").not.toBeNull();
    if (changed) settings.padBinds = changed;
    saveSettings(settings, storage);
    expect(PADBINDS_KEY).toBe("roguelike.padbinds.v1");
    const rawSettings = JSON.parse(storage.getItem(SETTINGS_KEY) ?? "{}") as Record<string, unknown>;
    expect("padBinds" in rawSettings, "settings 側に含めない").toBe(false);
    expect(loadSettings(storage).padBinds).toEqual(settings.padBinds);
  });

  it("壊れたパッド設定は既定に落ちる", () => {
    const storage = new MemoryStorage();
    storage.setItem(PADBINDS_KEY, JSON.stringify({ version: 1, padBinds: { dash: ["Pad99"], attack: "x" } }));
    expect(loadSettings(storage).padBinds).toEqual(defaultPadBinds());
  });

  it("resetPadBinds はパッド設定だけを既定に戻す", () => {
    const settings = defaultSettings();
    settings.volume = 0.2;
    settings.padBinds = { ...settings.padBinds, dash: [] };
    resetPadBinds(settings);
    expect(settings.padBinds).toEqual(defaultPadBinds());
    expect(settings.volume).toBe(0.2);
  });
});
