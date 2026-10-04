import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ACTOR_ATLASES } from "../data/actorSheets.gen";
import { FX_ATLASES } from "../data/fxSheets.gen";
import { ActorSpriteBank, actorArtLoading } from "./actorSprites";
import { FxSpriteBank, fxArtLoading } from "./fxSprites";

/** decode を外から解決・失敗させられる Image の代役 */
interface PendingDecode {
  resolve: () => void;
  reject: () => void;
}
let decodes: PendingDecode[] = [];

class FakeImage {
  src = "";
  decode(): Promise<void> {
    return new Promise<void>((resolve, reject) => decodes.push({ resolve, reject: () => reject(new Error("decode")) }));
  }
}

async function flush(): Promise<void> {
  for (let i = 0; i < 3; i++) await Promise.resolve();
}

const FX_ATLAS = Object.keys(FX_ATLASES)[0] ?? "";
const ACTOR_ATLAS = Object.keys(ACTOR_ATLASES)[0] ?? "";

beforeEach(() => {
  decodes = [];
  vi.stubGlobal("Image", FakeImage);
  // primeReadback の作業面（2D が無ければ何もしない）
  vi.stubGlobal("document", { createElement: () => ({ getContext: () => null }) });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("FxSpriteBank: 読み込み中の判定", () => {
  it("読み込み中は isLoading、読めたら解ける", async () => {
    const bank = new FxSpriteBank();
    bank.focus([FX_ATLAS]);
    expect(bank.isLoading()).toBe(true);
    decodes[0]?.resolve();
    await flush();
    expect(bank.isLoading()).toBe(false);
    expect(bank.ready(FX_ATLAS)).toBe(true);
  });

  it("読めなくても待ち続けない（手続きの描画のまま進む）", async () => {
    const bank = new FxSpriteBank();
    bank.focus([FX_ATLAS]);
    decodes[0]?.reject();
    await flush();
    expect(bank.isLoading()).toBe(false);
  });

  it("持ち替えて外したアトラスは待たない", () => {
    const bank = new FxSpriteBank();
    bank.focus([FX_ATLAS]);
    bank.focus([]);
    expect(bank.isLoading()).toBe(false);
  });
});

describe("ActorSpriteBank: 読み込み中の判定", () => {
  it("読み込み中は isLoading、読めたら解ける", async () => {
    const bank = new ActorSpriteBank();
    bank.focus([ACTOR_ATLAS]);
    expect(bank.isLoading()).toBe(true);
    decodes[0]?.resolve();
    await flush();
    expect(bank.isLoading()).toBe(false);
    expect(bank.ready(ACTOR_ATLAS)).toBe(true);
  });

  it("読めなくても待ち続けない", async () => {
    const bank = new ActorSpriteBank();
    bank.focus([ACTOR_ATLAS]);
    decodes[0]?.reject();
    await flush();
    expect(bank.isLoading()).toBe(false);
  });

  it("絵のまだ無い武器種（undefined）は待たない", () => {
    const bank = new ActorSpriteBank();
    bank.focus([undefined]);
    expect(bank.isLoading()).toBe(false);
  });
});

describe("全 bank の読み込み中の判定", () => {
  it("どれかの bank が読み込み中なら actorArtLoading / fxArtLoading が立つ", async () => {
    const actor = new ActorSpriteBank();
    const fx = new FxSpriteBank();
    actor.focus([ACTOR_ATLAS]);
    fx.focus([FX_ATLAS]);
    expect(actorArtLoading()).toBe(true);
    expect(fxArtLoading()).toBe(true);
    for (const d of decodes) d.resolve();
    await flush();
    expect(actorArtLoading()).toBe(false);
    expect(fxArtLoading()).toBe(false);
  });
});
