/**
 * テスト専用（本体からは import しない）。音は鳴らさず、ノードの API 呼び出しが通ることと
 * 生成したノードの数だけを数える最小の Web Audio モック
 */

export interface AudioParamMock {
  value: number;
  setValueAtTime(value: number, time: number): AudioParamMock;
  linearRampToValueAtTime(value: number, time: number): AudioParamMock;
  exponentialRampToValueAtTime(value: number, time: number): AudioParamMock;
  cancelScheduledValues(time: number): AudioParamMock;
}

function param(initial: number): AudioParamMock {
  const p: AudioParamMock = {
    value: initial,
    setValueAtTime(value) {
      p.value = value;
      return p;
    },
    linearRampToValueAtTime(value) {
      p.value = value;
      return p;
    },
    exponentialRampToValueAtTime(value) {
      p.value = value;
      return p;
    },
    cancelScheduledValues() {
      return p;
    },
  };
  return p;
}

function node(): { connect: (d: unknown) => unknown; disconnect: () => void } {
  return {
    connect: (d: unknown) => d,
    disconnect: () => undefined,
  };
}

export interface MockAudio {
  ctx: BaseAudioContext;
  /** 作った発音源（オシレーター・ノイズ）の数 */
  sources(): number;
  setTime(t: number): void;
}

export function createMockAudio(): MockAudio {
  let sources = 0;
  const raw = {
    currentTime: 0,
    sampleRate: 8000,
    destination: node(),
    createGain: () => ({ ...node(), gain: param(1) }),
    createOscillator: () => {
      sources += 1;
      return { ...node(), type: "sine", frequency: param(440), start: () => undefined, stop: () => undefined };
    },
    createBiquadFilter: () => ({ ...node(), type: "lowpass", frequency: param(350), Q: param(1) }),
    createDelay: () => ({ ...node(), delayTime: param(0) }),
    createBuffer: (_ch: number, length: number) => {
      const data = new Float32Array(length);
      return { getChannelData: () => data };
    },
    createBufferSource: () => {
      sources += 1;
      return { ...node(), buffer: null, loop: false, start: () => undefined, stop: () => undefined };
    },
  };
  return {
    ctx: raw as unknown as BaseAudioContext,
    sources: () => sources,
    setTime: (t: number) => {
      raw.currentTime = t;
    },
  };
}
