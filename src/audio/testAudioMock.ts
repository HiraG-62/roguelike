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

/** ノードの種類（後始末の検査で数える） */
export type MockNodeKind = "gain" | "filter" | "delay" | "other";

export interface MockNode {
  kind: MockNodeKind;
  /** disconnect() が呼ばれた回数 */
  disconnects: number;
  connect: (d: unknown) => unknown;
  disconnect: () => void;
}

function node(kind: MockNodeKind = "other", created?: MockNode[]): MockNode {
  const n: MockNode = {
    kind,
    disconnects: 0,
    connect: (d: unknown) => d,
    disconnect: () => {
      n.disconnects += 1;
    },
  };
  created?.push(n);
  return n;
}

export interface MockAudio {
  ctx: BaseAudioContext;
  /** 作った発音源（オシレーター・ノイズ）の数 */
  sources(): number;
  /** 作ったノード（発音源を除く）を種類で絞って返す。作った順 */
  nodes(kind: MockNodeKind): MockNode[];
  setTime(t: number): void;
}

export function createMockAudio(): MockAudio {
  let sources = 0;
  const created: MockNode[] = [];
  const raw = {
    currentTime: 0,
    sampleRate: 8000,
    destination: node(),
    // スプレッドで写すと disconnect が元のノードの回数を数えるので、ノード本体に直接フィールドを足す
    createGain: () => Object.assign(node("gain", created), { gain: param(1) }),
    createOscillator: () => {
      sources += 1;
      return { ...node(), type: "sine", frequency: param(440), start: () => undefined, stop: () => undefined };
    },
    createBiquadFilter: () => Object.assign(node("filter", created), { type: "lowpass", frequency: param(350), Q: param(1) }),
    createDelay: () => Object.assign(node("delay", created), { delayTime: param(0) }),
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
    nodes: (kind: MockNodeKind) => created.filter((n) => n.kind === kind),
    setTime: (t: number) => {
      raw.currentTime = t;
    },
  };
}
