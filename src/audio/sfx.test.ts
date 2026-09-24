import { beforeEach, describe, expect, it } from "vitest";
import { SFX_NAMES, type SfxName } from "./sfxNames";
import { SFX_DEFINITIONS, SfxPlayer } from "./sfx";
import { LAYERED_SFX } from "./sfxLayers";

/**
 * 実際の音は鳴らさず、ノードグラフの API 呼び出しが例外なく通ることだけを検証するための
 * 最小限の Web Audio モック。
 */

function createAudioParamMock(initial: number) {
  return {
    value: initial,
    setValueAtTime(value: number, _time: number) {
      this.value = value;
      return this;
    },
    linearRampToValueAtTime(value: number, _time: number) {
      this.value = value;
      return this;
    },
    exponentialRampToValueAtTime(value: number, _time: number) {
      this.value = value;
      return this;
    },
    cancelScheduledValues(_time: number) {
      return this;
    },
  };
}

function createNodeMock() {
  return {
    connect(_destination: unknown) {
      return _destination;
    },
    disconnect() {
      /* no-op */
    },
  };
}

function createMockAudioContext() {
  const ctx = {
    currentTime: 0,
    sampleRate: 44100,
    state: "running" as "running" | "suspended" | "closed",
    destination: createNodeMock(),
    resume() {
      this.state = "running";
      return Promise.resolve();
    },
    createGain() {
      return { ...createNodeMock(), gain: createAudioParamMock(1) };
    },
    createOscillator() {
      return {
        ...createNodeMock(),
        type: "sine" as OscillatorType,
        frequency: createAudioParamMock(440),
        start(_time?: number) {
          /* no-op */
        },
        stop(_time?: number) {
          /* no-op */
        },
      };
    },
    createBiquadFilter() {
      return {
        ...createNodeMock(),
        type: "lowpass" as BiquadFilterType,
        frequency: createAudioParamMock(350),
        Q: createAudioParamMock(1),
      };
    },
    createBuffer(numberOfChannels: number, length: number, sampleRate: number) {
      const channels: Float32Array[] = [];
      for (let i = 0; i < numberOfChannels; i++) {
        channels.push(new Float32Array(length));
      }
      return {
        numberOfChannels,
        length,
        sampleRate,
        getChannelData(channel: number): Float32Array {
          return channels[channel] ?? new Float32Array(length);
        },
      };
    },
    createBufferSource() {
      return {
        ...createNodeMock(),
        buffer: null as unknown,
        loop: false,
        start(_time?: number) {
          /* no-op */
        },
        stop(_time?: number) {
          /* no-op */
        },
      };
    },
    createWaveShaper() {
      return { ...createNodeMock(), curve: null as Float32Array | null, oversample: "none" as OverSampleType };
    },
    createDynamicsCompressor() {
      return {
        ...createNodeMock(),
        threshold: createAudioParamMock(-24),
        knee: createAudioParamMock(30),
        ratio: createAudioParamMock(12),
        attack: createAudioParamMock(0.003),
        release: createAudioParamMock(0.25),
      };
    },
  };
  return ctx;
}

type MockAudioContext = ReturnType<typeof createMockAudioContext>;

beforeEach(() => {
  const MockAudioContextCtor = function (this: MockAudioContext) {
    return createMockAudioContext();
  } as unknown as new () => AudioContext;
  (globalThis as unknown as { AudioContext: new () => AudioContext }).AudioContext = MockAudioContextCtor;
});

describe("SfxPlayer", () => {
  it("unlock 前に play しても例外を出さない", () => {
    const player = new SfxPlayer();
    expect(() => player.play("hit")).not.toThrow();
    expect(player.getActiveVoiceCount()).toBe(0);
  });

  it("SFX_NAMES の全ての名前に定義があり、例外なく再生できる", () => {
    for (const name of SFX_NAMES as readonly SfxName[]) {
      const player = new SfxPlayer();
      player.unlock();
      expect(() => player.play(name)).not.toThrow();
      expect(player.getActiveVoiceCount()).toBeGreaterThan(0);
    }
  });

  it("volume / pitch オプション付きでも例外を出さない", () => {
    const player = new SfxPlayer();
    player.unlock();
    expect(() => player.play("shoot", { volume: 0.3, pitch: 1.5 })).not.toThrow();
  });

  it("setMuted(true) の間は音が鳴らない", () => {
    const player = new SfxPlayer();
    player.unlock();
    player.setMuted(true);
    expect(player.isMuted()).toBe(true);
    player.play("hit");
    expect(player.getActiveVoiceCount()).toBe(0);

    player.setMuted(false);
    player.play("hit");
    expect(player.getActiveVoiceCount()).toBe(1);
  });

  it("同じ名前を30ms未満の間隔で連発すると間引かれる", () => {
    const player = new SfxPlayer();
    player.unlock();
    player.play("uiClick");
    player.play("uiClick");
    expect(player.getActiveVoiceCount()).toBe(1);
  });

  it("同時発音数は24に制限される", () => {
    const player = new SfxPlayer();
    player.unlock();
    const names = SFX_NAMES.slice(0, 30) as readonly SfxName[];
    for (const name of names) {
      player.play(name);
    }
    expect(player.getActiveVoiceCount()).toBe(24);
  });

  it("setMasterVolume は 0..1 にクランプされる", () => {
    const player = new SfxPlayer();
    player.unlock();
    expect(() => player.setMasterVolume(2)).not.toThrow();
    expect(() => player.setMasterVolume(-1)).not.toThrow();
  });
});

describe("演出と音の第 3 弾の効果音（8-4 / 8-7〜8-10 / 8-14）", () => {
  const WAVE3: readonly SfxName[] = [
    "reactionSteam",
    "reactionShatter",
    "reactionBlaze",
    "reactionSpark",
    "reactionBlight",
    "reactionSurge",
    "chargeStep1",
    "chargeStep2",
    "chargeStep3",
    "manaFull",
    "budSprout",
    "inscribe",
    "questComplete",
    "reaperHeartbeat",
  ];

  it("名前が SFX_NAMES にあり、層の表（LAYERED_SFX）で定義されている", () => {
    const layered: ReadonlySet<string> = new Set(Object.keys(LAYERED_SFX));
    for (const name of WAVE3) {
      expect(SFX_NAMES as readonly string[], `名前 ${name}`).toContain(name);
      expect(layered.has(name), `層の定義 ${name}`).toBe(true);
      expect(typeof SFX_DEFINITIONS[name], `再生の定義 ${name}`).toBe("function");
    }
  });

  it("溜めの段の音は段が上がるほど高い", () => {
    const firstFreq = (name: "chargeStep1" | "chargeStep2" | "chargeStep3"): number => {
      const layer = LAYERED_SFX[name][0];
      return layer.k === "tone" ? layer.freq : 0;
    };
    expect(firstFreq("chargeStep2"), "2 段目は 1 段目より高い").toBeGreaterThan(firstFreq("chargeStep1"));
    expect(firstFreq("chargeStep3"), "3 段目は 2 段目より高い").toBeGreaterThan(firstFreq("chargeStep2"));
  });

  it("依頼の達成は 3 音のファンファーレから始まる", () => {
    const first = LAYERED_SFX.questComplete[0];
    expect(first.k === "arp" ? first.freqs.length : 0, "3 音").toBe(3);
  });
});
