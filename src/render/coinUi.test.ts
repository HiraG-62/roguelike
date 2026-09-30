import { describe, expect, it } from "vitest";
import type { Pickup } from "../core/state";
import { ECONOMY } from "../data/tuning";
import { SPRITES } from "../data/sprites";
import { COIN_SPRITE_KEYS } from "../data/sprites/economy";
import { coinHalfSize, coinTier, drawFieldPickup, fieldPickupSpriteKey, isBlinkHidden } from "./coinUi";
import type { Sprite, SpriteAtlas } from "./sprites";

/** 描画命令の呼び出し回数だけ数える ctx（Canvas を使わずに「描いたか」を見る） */
function countingCtx(): { ctx: CanvasRenderingContext2D; fills: () => number } {
  let fills = 0;
  const noop = (): void => {};
  const target: Record<string, unknown> = {
    fill: () => {
      fills++;
    },
    fillRect: () => {
      fills++;
    },
  };
  const ctx = new Proxy(target, {
    get: (t, key: string) => t[key] ?? noop,
    set: (t, key: string, value: unknown) => {
      t[key] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, fills: () => fills };
}

function coin(patch: Partial<Pickup> = {}): Pickup {
  return { id: 1, kind: "coin", pos: { x: 10, y: 10 }, radius: 4, bobTime: 0, value: 1, ...patch };
}

describe("銭の大きさの段", () => {
  it("額が大きいほど段が上がり、菱形も大きくなる", () => {
    expect(coinTier(1), "小").toBe(0);
    expect(coinTier(3), "中").toBe(1);
    expect(coinTier(8), "大").toBe(2);
    expect(coinHalfSize(1)).toBeLessThan(coinHalfSize(3));
    expect(coinHalfSize(3)).toBeLessThan(coinHalfSize(8));
  });
});

describe("消える前の点滅", () => {
  const blink = 2;

  it("残りが blinkSec より長いあいだは点滅しない", () => {
    for (const life of [8, 5, 2.5, 2.01]) expect(isBlinkHidden(life, blink), `残り ${life} 秒`).toBe(false);
  });

  it("life が undefined（消えない銭）は点滅しない", () => {
    expect(isBlinkHidden(undefined, blink)).toBe(false);
  });

  it("blinkSec 以下では出る・消えるが交互に来る", () => {
    const seen = new Set<boolean>();
    for (let life = blink; life > 0; life -= 0.05) seen.add(isBlinkHidden(life, blink));
    expect(seen.size, "出ている時間と消えている時間の両方がある").toBe(2);
  });

  it("同じ life なら必ず同じ結果（乱数も実時間も使わない）", () => {
    for (const life of [1.9, 1.2, 0.7, 0.1]) expect(isBlinkHidden(life, blink)).toBe(isBlinkHidden(life, blink));
  });
});

describe("床の銭・鍵・瓶の描画", () => {
  it("銭・鍵・瓶はそれぞれ何かを塗る", () => {
    for (const kind of ["coin", "key", "flask"] as const) {
      const { ctx, fills } = countingCtx();
      drawFieldPickup(ctx, coin({ kind }));
      expect(fills(), `${kind} を描く`).toBeGreaterThan(0);
    }
  });

  it("点滅で消えている側の銭は何も塗らない", () => {
    const hidden = ECONOMY.coin.blinkSec;
    let life = hidden;
    while (!isBlinkHidden(life, hidden) && life > 0) life -= 0.01;
    const { ctx, fills } = countingCtx();
    drawFieldPickup(ctx, coin({ life }));
    expect(fills()).toBe(0);
  });

  it("心臓は coinUi では描かない（renderer のスプライト描画に任せる）", () => {
    const { ctx, fills } = countingCtx();
    drawFieldPickup(ctx, coin({ kind: "heart" }));
    expect(fills()).toBe(0);
  });
});

describe("床の拾い物の絵", () => {
  it("銭は額の段ごとに別の絵、鍵・瓶はそれぞれの絵を引き、心臓は絵を持たない", () => {
    const keys = [1, 3, 8].map((value) => fieldPickupSpriteKey({ kind: "coin", value }));
    expect(keys).toEqual([...COIN_SPRITE_KEYS]);
    expect(fieldPickupSpriteKey({ kind: "key" })).toBe("pickup.key");
    expect(fieldPickupSpriteKey({ kind: "flask" })).toBe("pickup.flask");
    expect(fieldPickupSpriteKey({ kind: "heart" })).toBeNull();
  });

  it("引く絵はすべて SPRITES にある", () => {
    for (const kind of ["coin", "key", "flask"] as const) {
      for (const value of [1, 3, 8]) {
        const key = fieldPickupSpriteKey({ kind, value });
        expect(key && SPRITES[key], `${kind} ${value}`).toBeTruthy();
      }
    }
  });

  it("アトラスに絵があれば図形を塗らずに絵を置く", () => {
    let images = 0;
    const { ctx, fills } = countingCtx();
    (ctx as unknown as Record<string, unknown>).drawImage = () => {
      images++;
    };
    const img = {} as HTMLCanvasElement;
    const sprite: Sprite = { frames: [img, img], white: [], w: 8, h: 8, dots: 2 };
    const atlas: SpriteAtlas = { "pickup.coin.small": sprite, "pickup.coin.mid": sprite, "pickup.coin.big": sprite, "pickup.key": sprite, "pickup.flask": sprite };
    drawFieldPickup(ctx, coin({ kind: "key" }), atlas);
    expect(images, "絵を 1 枚置く").toBe(1);
    // 影の楕円は塗る（fill 1 回）が、菱形・矩形の図形は描かない
    expect(fills()).toBe(1);
  });
});
