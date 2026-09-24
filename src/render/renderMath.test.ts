import { describe, expect, it } from "vitest";
import {
  type WeaponPoseInput,
  artHoldPose,
  edgeNormal,
  edgeView,
  offhandOffset,
  phaseProgress,
  playerBodyPose,
  slashVisual,
  slashWeight,
  swingSign,
  weaponGrip,
  weaponPose,
  weaponView,
} from "./renderMath";
import { SLASH_SPRITE, WEAPON_CANVAS, WEAPON_FRAME } from "../data/sprites/weapons";
import { MOVESETS } from "../data/weapons";
import { createMap, setTile, Tile } from "../map/grid";
import { BOSS, ELITE, ENEMY_AI, FX_WAVE3, PLAYER } from "../data/tuning";
import { RARITIES, TRAIT_COLOR_HEX, createEmptyResonance, type Resonance } from "../loot/types";
import {
  KEYSTONE_GROUP_COLOR,
  LOOT_PILLAR_HEIGHTS,
  auraArcs,
  counterMonoAlpha,
  keystoneAuraColors,
  resonanceMantleColors,
  bombBlinkFrameTime,
  bombStyle,
  bossIntroPhase,
  bossPhaseThreshold,
  damageTextStyle,
  fitTooltip,
  floorVariant,
  floorWipeCover,
  pulse,
  spriteFeetY,
  tileHash,
  wallMask,
  wallStyle,
  computeViewScale,
} from "./renderMath";

describe("floorVariant", () => {
  it("決定的で範囲内", () => {
    for (let y = 0; y < 20; y++) {
      for (let x = 0; x < 20; x++) {
        const v = floorVariant(x, y, 6);
        expect(v).toBe(floorVariant(x, y, 6));
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(6);
      }
    }
  });

  it("全バリアントが出現する", () => {
    const seen = new Set<number>();
    for (let i = 0; i < 400; i++) seen.add(floorVariant(i % 20, Math.floor(i / 20), 6));
    expect(seen.size).toBe(6);
  });

  it("負の座標でも符号なし", () => {
    expect(tileHash(-3, -7)).toBeGreaterThanOrEqual(0);
  });
});

describe("wallStyle", () => {
  it("下が床なら face、横だけ床なら top、埋まっていれば none", () => {
    const map = createMap(5, 5);
    setTile(map, 2, 2, Tile.Floor);
    expect(wallStyle(map, 2, 1)).toBe("face");
    expect(wallStyle(map, 1, 2)).toBe("top");
    expect(wallStyle(map, 2, 3)).toBe("top");
    expect(wallStyle(map, 0, 0)).toBe("none");
  });
});

describe("wallMask", () => {
  it("隣接 4 方向の床をビットにする", () => {
    const map = createMap(5, 5);
    setTile(map, 2, 1, Tile.Floor); // N
    setTile(map, 3, 2, Tile.Floor); // E
    expect(wallMask(map, 2, 2)).toBe(1 | 2);
  });

  it("周囲が全部壁なら 0", () => {
    const map = createMap(5, 5);
    expect(wallMask(map, 2, 2)).toBe(0);
  });
});

describe("spriteFeetY", () => {
  it("16px 当時の足元（半径 6 → +8）と一致する", () => {
    expect(spriteFeetY(100, 6)).toBe(108);
  });
});

describe("pulse", () => {
  it("min..max に収まる", () => {
    for (let t = 0; t < 10; t += 0.37) {
      const v = pulse(t, 3, 0.2, 0.8);
      expect(v).toBeGreaterThanOrEqual(0.2);
      expect(v).toBeLessThanOrEqual(0.8);
    }
  });
});

describe("fitTooltip", () => {
  it("収まるなら通常行高で全行", () => {
    expect(fitTooltip(5, 8, 6, 12, 200, 4)).toEqual({ lineH: 8, small: false, shown: 5, height: 44 });
  });

  it("maxLines 超過なら小さい行高", () => {
    const fit = fitTooltip(14, 8, 6, 12, 200, 4);
    expect(fit.small).toBe(true);
    expect(fit.shown).toBe(14);
  });

  it("高さが足りなければ切り詰める", () => {
    const fit = fitTooltip(20, 8, 6, 12, 64, 4);
    expect(fit.shown).toBe(10);
    expect(fit.height).toBeLessThanOrEqual(64);
  });
});

describe("演出用の純関数", () => {
  it("bombStyle: 半径と導火線で出どころを見分ける", () => {
    const w = ENEMY_AI.wisp;
    expect(bombStyle({ radius: w.deathExplodeRadius, maxTime: w.deathExplodeFuse })).toBe("wispDeath");
    expect(bombStyle({ radius: ELITE.explodeRadius, maxTime: ELITE.explodeFuse })).toBe("eliteDeath");
    expect(bombStyle({ radius: ENEMY_AI.bomber.radius, maxTime: ENEMY_AI.bomber.fuse })).toBe("bomber");
  });

  it("bombBlinkFrameTime: 残りが減るほど間隔が短くなる", () => {
    const slow = 0.3;
    const fast = 0.08;
    expect(bombBlinkFrameTime(1, slow, fast)).toBeCloseTo(slow);
    expect(bombBlinkFrameTime(0, slow, fast)).toBeCloseTo(fast);
    expect(bombBlinkFrameTime(0.3, slow, fast)).toBeLessThan(bombBlinkFrameTime(0.7, slow, fast));
  });

  it("floorWipeCover: 閉じきってから開き、最後は全開", () => {
    expect(floorWipeCover(1)).toBeGreaterThan(0);
    expect(floorWipeCover(1)).toBeLessThan(1);
    expect(floorWipeCover(0.7)).toBe(1);
    expect(floorWipeCover(0)).toBeCloseTo(0);
    for (let f = 0.6; f > 0; f -= 0.05) expect(floorWipeCover(f - 0.05)).toBeLessThanOrEqual(floorWipeCover(f) + 1e-9);
  });

  it("bossIntroPhase: 帯が出て名前が中央へ滑り込み、最後に消える", () => {
    const total = 2;
    const start = bossIntroPhase(total, total);
    expect(start.bars).toBe(0);
    expect(start.slide).toBe(0);
    const mid = bossIntroPhase(total / 2, total);
    expect(mid.bars).toBe(1);
    expect(mid.slide).toBe(1);
    expect(mid.alpha).toBe(1);
    expect(bossIntroPhase(0.1, total).alpha).toBeLessThan(1);
    expect(bossIntroPhase(0, total).alpha).toBe(0);
  });

  it("LOOT_PILLAR_HEIGHTS: レアほど高い", () => {
    const hs = RARITIES.map((r) => LOOT_PILLAR_HEIGHTS[r]);
    for (let i = 1; i < hs.length; i++) expect(hs[i] ?? 0).toBeGreaterThan(hs[i - 1] ?? 0);
  });

  it("damageTextStyle: 数字だけ縁取り対象、crit 色は crit", () => {
    expect(damageTextStyle("12", PLAYER.critColor, 1.6).crit).toBe(true);
    expect(damageTextStyle("12", "#ffffff", 1).crit).toBe(false);
    expect(damageTextStyle("12", "#ffffff", 1).numeric).toBe(true);
    expect(damageTextStyle("BLOCK", PLAYER.critColor, 1).numeric).toBe(false);
    expect(damageTextStyle("12", "#ffffff", 1.4).outline).not.toBe(damageTextStyle("12", "#ffffff", 1).outline);
  });

  it("bossPhaseThreshold: ボスごとの境界、他は null", () => {
    expect(bossPhaseThreshold("kingSlime")).toBe(BOSS.kingSlime.phase2Ratio);
    expect(bossPhaseThreshold("boneLord")).toBe(BOSS.boneLord.teleportRatio);
    expect(bossPhaseThreshold("chaser")).toBeNull();
  });
});

describe("computeViewScale", () => {
  it("ウィンドウに収まる最大の整数倍率を選ぶ", () => {
    const s = computeViewScale(1920, 1080, 1);
    expect(s.cssScale).toBe(4);
    expect(s.pixelRatio).toBe(4);
    expect(s.canvasW).toBe(1920);
    expect(s.canvasH).toBe(1080);
  });

  it("dpr を掛けた実ピクセルで canvas を持つ", () => {
    const s = computeViewScale(1920, 1080, 2);
    expect(s.cssScale).toBe(4);
    expect(s.pixelRatio).toBe(8);
    expect(s.canvasW).toBe(3840);
    expect(s.canvasH).toBe(2160);
  });

  it("非整数 dpr は実ピクセルを丸める", () => {
    const s = computeViewScale(1280, 720, 1.25);
    expect(s.cssScale).toBe(2);
    expect(s.pixelRatio).toBe(2.5);
    expect(s.canvasW).toBe(1200);
    expect(s.canvasH).toBe(675);
  });

  it("小さいウィンドウでも倍率は最低 1", () => {
    expect(computeViewScale(100, 100, 1).cssScale).toBe(1);
  });

  it("不正な dpr は 1 とみなす", () => {
    expect(computeViewScale(960, 540, 0).pixelRatio).toBe(2);
    expect(computeViewScale(960, 540, Number.NaN).pixelRatio).toBe(2);
  });

  it("縦横の小さい方で倍率が決まる", () => {
    expect(computeViewScale(2000, 600, 1).cssScale).toBe(2);
  });
});

describe("演出の位置計算", () => {
  it("制圧の波は前線の手前だけ光り、寿命の終わりに消える", async () => {
    const { clearWaveAlpha } = await import("./renderMath");
    expect(clearWaveAlpha(100, 0.1, 1, 240, 20), "前線より先はまだ暗い").toBe(0);
    expect(clearWaveAlpha(20, 0.1, 1, 240, 20), "前線の手前は光る").toBeGreaterThan(0);
    expect(clearWaveAlpha(0, 0.5, 1, 240, 20), "通り過ぎた床は元に戻る").toBe(0);
    expect(clearWaveAlpha(230, 1, 1, 240, 20), "寿命の終わりは 0").toBe(0);
  });

  it("両断の半身は離れていき、最大で gap", async () => {
    const { severGap } = await import("./renderMath");
    expect(severGap(0, 10)).toBe(0);
    expect(severGap(0.5, 10)).toBeGreaterThan(0);
    expect(severGap(1, 10)).toBeCloseTo(10);
    expect(severGap(2, 10), "範囲外は丸める").toBeCloseTo(10);
  });

  it("灰は溜めてから崩れ、溶けると縦に潰れて横に広がる", async () => {
    const { ashCrumble, meltScale } = await import("./renderMath");
    expect(ashCrumble(0.1), "最初は崩れない").toBe(0);
    expect(ashCrumble(1)).toBe(1);
    const m = meltScale(0.8);
    expect(m.sy).toBeLessThan(1);
    expect(m.sx).toBeGreaterThan(1);
  });

  it("砕けた破片は四方へ散る", async () => {
    const { shardOffset } = await import("./renderMath");
    const offsets = [0, 1, 2, 3].map((i) => shardOffset(i, 4, 1, 20));
    expect(offsets.some((o) => o.x > 0) && offsets.some((o) => o.x < 0), "左右に散る").toBe(true);
    expect(offsets.some((o) => o.y > 0) && offsets.some((o) => o.y < 0), "上下に散る").toBe(true);
  });

  it("階層到達の名札は遅れて現れ、保って消える", async () => {
    const { floorCardAlpha } = await import("./renderMath");
    const c = { delay: 0.3, fadeIn: 0.2, hold: 1, fadeOut: 0.5 };
    expect(floorCardAlpha(0.1, c), "到達直後は出ない").toBe(0);
    expect(floorCardAlpha(0.9, c), "保っている間は 1").toBe(1);
    expect(floorCardAlpha(5, c), "最後は消える").toBe(0);
  });

  it("状態異常の疑似粒は敵の幅と高さの中に収まり、同じ入力で同じ位置", async () => {
    const { statusParticle } = await import("./renderMath");
    for (const motion of ["rise", "fall", "bubble", "orbit", "stars", "spark"] as const) {
      for (let i = 0; i < 20; i++) {
        const p = statusParticle(motion, 17, i, i * 0.13, 8, 16);
        expect(Math.abs(p.x), `${motion} の横`).toBeLessThanOrEqual(8);
        expect(p.y, `${motion} の縦`).toBeLessThanOrEqual(0);
        expect(p.y, `${motion} の縦`).toBeGreaterThanOrEqual(-16 - 2 - 8);
        expect(statusParticle(motion, 17, i, i * 0.13, 8, 16), "決定的").toEqual(p);
      }
    }
  });

  it("光条は本数ぶん等間隔", async () => {
    const { rayAngles } = await import("./renderMath");
    const a = rayAngles(4, 0, 1);
    expect(a.length).toBe(4);
    expect((a[1] ?? 0) - (a[0] ?? 0)).toBeCloseTo(Math.PI / 2);
  });

  it("武器種ごとの軌跡の太さがあり、大剣は剣より太い", async () => {
    const { WEAPON_TRAIL_WIDTH } = await import("./renderMath");
    const { MOVESET_KEYS } = await import("../data/weapons");
    for (const key of MOVESET_KEYS) expect(WEAPON_TRAIL_WIDTH[key], key).toBeGreaterThan(0);
    expect(WEAPON_TRAIL_WIDTH.greatsword).toBeGreaterThan(WEAPON_TRAIL_WIDTH.sword);
  });
});

describe("ダメージ文字の種類の縁取り（7-19）", () => {
  it("種類 crit は色に関係なく会心。種類が無ければ従来どおり色で判定する", () => {
    expect(damageTextStyle("12", "#ffd040", 1, "crit").crit).toBe(true);
    expect(damageTextStyle("12", PLAYER.critColor, 1, "normal").crit, "種類が通常なら会心の色でも会心にしない").toBe(false);
    expect(damageTextStyle("12", PLAYER.critColor, 1).crit, "種類なしは色で判定").toBe(true);
  });

  it("弱点・耐性・反応・継続は通常と別の縁取り", () => {
    const normal = damageTextStyle("12", "#ffffff", 1, "normal").outline;
    for (const kind of ["weak", "resist", "reaction", "dot"] as const) {
      expect(damageTextStyle("12", "#ffffff", 1, kind).outline, kind).not.toBe(normal);
    }
    expect(damageTextStyle("12", "#ffffff", 0.7, "dot").numeric, "継続も数字").toBe(true);
  });
});

describe("カウンターの白黒の濃さ（7-10）", () => {
  it("始まりで最大、残りに比例して薄れ、終われば 0", () => {
    expect(counterMonoAlpha(0.1, 0.1, 0.8)).toBeCloseTo(0.8);
    expect(counterMonoAlpha(0.05, 0.1, 0.8)).toBeCloseTo(0.4);
    expect(counterMonoAlpha(0, 0.1, 0.8)).toBe(0);
  });
});

describe("共鳴のまとい（7-14）", () => {
  function res(partial: Partial<Resonance>): Resonance {
    return { ...createEmptyResonance(), ...partial };
  }

  it("共鳴が無ければ描かない。散りも描かない", () => {
    expect(resonanceMantleColors(createEmptyResonance())).toEqual([]);
    expect(resonanceMantleColors(res({ kind: "scatter" }))).toEqual([]);
  });

  it("単色・三和音は配合の色", () => {
    expect(resonanceMantleColors(res({ kind: "dominant", colors: ["crimson"] }))).toEqual([TRAIT_COLOR_HEX.crimson]);
    expect(resonanceMantleColors(res({ kind: "triad", colors: ["crimson", "azure", "jade"] })).length, "三和音は 3 色").toBe(3);
  });

  it("陰画は冥を重ね、星座は星の色を足す", () => {
    expect(resonanceMantleColors(res({ kind: "dominant", colors: ["gold"], form: "negative" }))).toEqual([TRAIT_COLOR_HEX.gold, TRAIT_COLOR_HEX.umbra]);
    expect(resonanceMantleColors(res({ kind: "none", constellation: "twins" })), "星座だけでも描く").toEqual([FX_WAVE3.mantle.constellationColor]);
  });
});

describe("誓約のオーラ（7-20）", () => {
  it("誓約が無ければ描かない", () => {
    expect(keystoneAuraColors([])).toEqual([]);
  });

  it("同じ系統の誓約は 1 色、系統が違えば色が増える。知らない key は無視する", () => {
    expect(keystoneAuraColors(["ks_glassCannon", "ks_juggernaut"]), "どちらも body").toEqual([KEYSTONE_GROUP_COLOR.body]);
    expect(keystoneAuraColors(["ks_glassCannon", "ks_berserker", "ks_unknown"])).toEqual([KEYSTONE_GROUP_COLOR.body, KEYSTONE_GROUP_COLOR.tempo]);
  });

  it("輪を系統の数の弧に分け、隙間を空けて回す", () => {
    const arcs = auraArcs(3, 0, 1, 0.3);
    expect(arcs.length).toBe(3);
    for (const a of arcs) expect(a.end - a.start, "隙間ぶん短い").toBeCloseTo((Math.PI * 2) / 3 - 0.3);
    expect(auraArcs(3, 1, 1, 0.3)[0]?.start, "時間で回る").toBeCloseTo((arcs[0]?.start ?? 0) + 1);
    expect(auraArcs(0, 0, 1, 0.3)).toEqual([]);
  });
});

describe("手に持つ武器の姿勢（docs/ideas/combat-feel-design.md C-2）", () => {
  const base: WeaponPoseInput = { phase: "none", t: 0, shape: "arc", deg: 120, aim: 0, step: 0, facingRight: true, aimHeld: false };
  const pose = (over: Partial<WeaponPoseInput>) => weaponPose({ ...base, ...over });
  /** 2 つの角度の差（-π..π） */
  const diff = (a: number, b: number): number => Math.atan2(Math.sin(a - b), Math.cos(a - b));

  it("weaponView は 8 方向を横・斜め・縦の 3 枚と反転で表す", () => {
    expect(weaponView(0)).toEqual({ frame: WEAPON_FRAME.side, flipX: false, flipY: false });
    expect(weaponView(Math.PI)).toEqual({ frame: WEAPON_FRAME.side, flipX: true, flipY: false });
    expect(weaponView(-Math.PI / 2)).toEqual({ frame: WEAPON_FRAME.up, flipX: false, flipY: false });
    expect(weaponView(Math.PI / 2)).toEqual({ frame: WEAPON_FRAME.up, flipX: false, flipY: true });
    expect(weaponView(-Math.PI / 4)).toEqual({ frame: WEAPON_FRAME.diagonal, flipX: false, flipY: false });
    expect(weaponView((3 * Math.PI) / 4)).toEqual({ frame: WEAPON_FRAME.diagonal, flipX: true, flipY: true });
    expect(weaponView(Math.PI * 2 + 0.1), "一周しても同じ").toEqual(weaponView(0.1));
  });

  it("待機は向いている側の上へ担ぎ、左向きは拳の位置も左右反転する", () => {
    const right = pose({});
    const left = pose({ facingRight: false });
    expect(Math.sin(right.angle), "上向き").toBeLessThan(0);
    expect(Math.cos(right.angle), "右寄り").toBeGreaterThan(0);
    expect(Math.cos(left.angle), "左寄り").toBeLessThan(0);
    expect(left.dx).toBe(-right.dx);
    expect(right.behind, "担いだ武器は体の後ろ").toBe(true);
  });

  it("撃つ武器（aimHeld）は待機でも照準へ向ける", () => {
    const p = pose({ aimHeld: true, aim: Math.PI / 2 });
    expect(p.angle).toBeCloseTo(Math.PI / 2);
    expect(p.dy, "下へ向けた拳は腕の付け根より下").toBeGreaterThan(-4);
    expect(p.behind).toBe(false);
  });

  it("windup は攻撃方向の逆へ引き、active の終わりで攻撃方向の先へ振り抜く", () => {
    const aim = 0.3;
    for (const shape of ["arc", "box"] as const) {
      const windup = pose({ shape, aim, phase: "windup", t: 1 });
      const end = pose({ shape, aim, phase: "active", t: 1 });
      expect(Math.abs(diff(windup.angle, aim)), `${shape}: 引く`).toBeGreaterThan(Math.PI / 2);
      expect(Math.abs(diff(end.angle, aim)), `${shape}: 振り抜く`).toBeLessThan(Math.PI * 0.75);
      expect(Math.sign(diff(end.angle, aim)), `${shape}: 引いた側の反対へ抜ける`).toBe(-Math.sign(diff(windup.angle, aim)));
    }
  });

  it("arc は段が偶数と奇数で振る向きが反転する", () => {
    const even = pose({ phase: "active", t: 1, step: 0 });
    const odd = pose({ phase: "active", t: 1, step: 1 });
    expect(diff(even.angle, 0)).toBeCloseTo(-diff(odd.angle, 0));
    expect(swingSign(0)).toBe(1);
    expect(swingSign(3)).toBe(-1);
  });

  it("thrust は active で前へ伸び recover で戻る", () => {
    const pulled = pose({ shape: "thrust", phase: "windup", t: 1 });
    const out = pose({ shape: "thrust", phase: "active", t: 1 });
    const back = pose({ shape: "thrust", phase: "recover", t: 1 });
    expect(out.angle).toBeCloseTo(0);
    expect(out.dx).toBeGreaterThan(back.dx);
    expect(back.dx).toBeGreaterThan(pulled.dx);
  });

  it("circle は active の間に一周する", () => {
    const half = pose({ shape: "circle", phase: "active", t: 0.3 });
    const done = pose({ shape: "circle", phase: "active", t: 1 });
    expect(Math.abs(diff(half.angle, 0)), "途中は攻撃方向から離れる").toBeGreaterThan(0.5);
    expect(diff(done.angle, 0)).toBeCloseTo(0);
  });

  it("weaponGrip は反転すると拳の中心を鏡に写す", () => {
    const plain = weaponGrip({ frame: WEAPON_FRAME.side, flipX: false, flipY: false });
    const flipped = weaponGrip({ frame: WEAPON_FRAME.side, flipX: true, flipY: true });
    expect(flipped.x).toBe(WEAPON_CANVAS - plain.x);
    expect(flipped.y).toBe(WEAPON_CANVAS - plain.y);
  });

  it("二丁拳銃の 2 挺は照準に直交して左右に分かれる", () => {
    const a = offhandOffset(0, 3, 1);
    const b = offhandOffset(0, 3, -1);
    expect(a.x).toBeCloseTo(0);
    expect(a.y).toBeCloseTo(3);
    expect(b.y).toBeCloseTo(-3);
  });

  it("phaseProgress は段階の残り秒から 0 → 1 の進みを出す", () => {
    const step = { windup: 0.2, active: 0.1, recover: 0.4 };
    expect(phaseProgress("windup", 0.2, step)).toBeCloseTo(0);
    expect(phaseProgress("active", 0.05, step)).toBeCloseTo(0.5);
    expect(phaseProgress("recover", 0, step)).toBeCloseTo(1);
    expect(phaseProgress("none", 0, step)).toBe(1);
  });

  it("playerBodyPose は予備動作と溜めで構え、振りと戻しの前半で振り抜き", () => {
    expect(playerBodyPose("windup", 0.5, false)).toBe("windup");
    expect(playerBodyPose("none", 0, true)).toBe("windup");
    expect(playerBodyPose("active", 0.5, false)).toBe("strike");
    expect(playerBodyPose("recover", 0.2, false)).toBe("strike");
    expect(playerBodyPose("recover", 0.8, false)).toBe("walk");
    expect(playerBodyPose("none", 0, false)).toBe("walk");
  });
});

describe("刃・頭を外向きにする規則（docs/ideas/weapon-redesign.md 7 章）", () => {
  const base: WeaponPoseInput = { phase: "none", t: 0, shape: "arc", deg: 120, aim: 0, step: 0, facingRight: true, aimHeld: false };
  const pose = (over: Partial<WeaponPoseInput>) => weaponPose({ ...base, ...over });

  it("大鎌を右向きで構えると刃は頭と反対側（右下）を向く", () => {
    const p = pose({ edge: "up" });
    const n = edgeNormal(p, "up");
    expect(p.frame, "斜めの絵を柄の線で写した方").toBe(WEAPON_FRAME.diagonalOut);
    expect(n.x, "右").toBeGreaterThan(0);
    expect(n.y, "下").toBeGreaterThan(0);
  });

  it("左向きの構えでも刃は頭と反対側（左下）を向く", () => {
    const p = pose({ edge: "up", facingRight: false });
    const n = edgeNormal(p, "up");
    expect(n.x, "左").toBeLessThan(0);
    expect(n.y, "下").toBeGreaterThan(0);
  });

  it("扇の振りでは刃が振り抜く方向を向く（段で振る向きが変わると刃も入れ替わる）", () => {
    for (const step of [0, 1]) {
      const p = pose({ edge: "up", phase: "active", t: 0.5, step });
      const n = edgeNormal(p, "up");
      const tangent = { x: -Math.sin(p.angle) * swingSign(step), y: Math.cos(p.angle) * swingSign(step) };
      expect(n.x * tangent.x + n.y * tangent.y, `段 ${step}`).toBeGreaterThan(0);
    }
  });

  it("予備動作でも刃はこれから振り抜く側を向く", () => {
    const p = pose({ edge: "up", phase: "windup", t: 1, shape: "box" });
    const n = edgeNormal(p, "up");
    const tangent = { x: -Math.sin(p.angle), y: Math.cos(p.angle) };
    expect(n.x * tangent.x + n.y * tangent.y).toBeGreaterThan(0);
  });

  it("両刃の武器（edge なし）は反転しない", () => {
    for (const over of [{}, { facingRight: false }, { phase: "active" as const, t: 0.5, step: 1 }]) {
      const p = pose(over);
      const view = weaponView(p.angle);
      expect({ frame: p.frame, flipX: p.flipX, flipY: p.flipY }).toEqual(view);
    }
  });

  it("edgeView は柄の向きを保ったまま刃の側だけ入れ替える", () => {
    const side = { frame: WEAPON_FRAME.side, flipX: false, flipY: false } as const;
    expect(edgeView(side, "up", { x: 0, y: 1 })).toEqual({ ...side, flipY: true });
    expect(edgeView(side, "up", { x: 0, y: -1 }), "もう向いていれば変えない").toEqual(side);
    expect(edgeView(side, "down", { x: 0, y: -1 }), "刃が下の武器は逆").toEqual({ ...side, flipY: true });
    const up = { frame: WEAPON_FRAME.up, flipX: false, flipY: false } as const;
    expect(edgeView(up, "up", { x: 1, y: 0 })).toEqual({ ...up, flipX: true });
    const diag = { frame: WEAPON_FRAME.diagonal, flipX: true, flipY: false } as const;
    expect(edgeView(diag, "up", { x: -1, y: 1 })).toEqual({ ...diag, frame: WEAPON_FRAME.diagonalOut });
  });
});

describe("固有技の構え（docs/ideas/weapon-redesign.md 3 章）", () => {
  const base: WeaponPoseInput = { phase: "none", t: 0, shape: "arc", deg: 120, aim: 0, step: 0, facingRight: true, aimHeld: false };
  const pose = (over: Partial<WeaponPoseInput>) => weaponPose({ ...base, ...over });

  it("受け流しは照準の先に拳を出し、刃を上へ立てる", () => {
    const rest = pose({});
    const p = pose({ hold: "parry" });
    expect(p.dx, "拳が前へ出る").toBeGreaterThan(rest.dx);
    expect(Math.sin(p.angle), "刃は上向き").toBeCloseTo(-1);
    const left = pose({ hold: "parry", aim: Math.PI, facingRight: false });
    expect(left.dx, "左向きは左へ出す").toBeLessThan(0);
    expect(Math.sin(left.angle), "左向きでも刃は上").toBeCloseTo(-1);
  });

  it("盾の構えと狙い撃ちは照準へ腕を伸ばす", () => {
    const aim = Math.PI / 4;
    const plain = pose({ aimHeld: true, aim });
    for (const hold of ["guard", "aim"] as const) {
      const p = pose({ hold, aim, aimHeld: true });
      expect(p.angle).toBeCloseTo(aim);
      expect(Math.hypot(p.dx, p.dy + 4), hold).toBeGreaterThan(Math.hypot(plain.dx, plain.dy + 4));
    }
  });

  it("artHoldPose は押している最中の構えの種類を選ぶ", () => {
    expect(artHoldPose(MOVESETS.sword.art, true)).toBe("parry");
    expect(artHoldPose(MOVESETS.shield.art, true)).toBe("guard");
    expect(artHoldPose(MOVESETS.sidearm.art, true)).toBe("aim");
    expect(artHoldPose(MOVESETS.katana.art, true), "居合は溜めの経路").toBeUndefined();
    expect(artHoldPose(MOVESETS.sword.art, false), "押していなければ構えない").toBeUndefined();
  });
});

describe("斬撃の絵の選び方（docs/ideas/combat-feel-design.md C-3）", () => {
  it("当たり判定の形ごとに別の絵を使う（扇は開き角で 2 種）", () => {
    expect(slashVisual("box", 0, 0, false, 1).key).toBe(SLASH_SPRITE.box);
    expect(slashVisual("arc", 120, 0, false, 1).key).toBe(SLASH_SPRITE.arc);
    expect(slashVisual("arc", 240, 0, false, 1).key).toBe(SLASH_SPRITE.arcWide);
    expect(slashVisual("thrust", 0, 0, false, 1).key).toBe(SLASH_SPRITE.thrust);
    expect(slashVisual("circle", 0, 0, false, 1).key).toBe(SLASH_SPRITE.ring);
  });

  it("5 段の武器でも段ごとに絵（フレームと反転の組）が違う", () => {
    const steps = [0, 1, 2, 3, 4].map((i) => slashVisual("arc", 120, i, i === 4, 1));
    const looks = new Set(steps.map((v) => `${v.frame}:${v.flipY}`));
    expect(looks.size).toBe(5);
  });

  it("太さの段で違うフレームを使い、軌跡の太さから段が決まる", () => {
    expect(slashWeight(1)).toBe(0);
    expect(slashWeight(2)).toBe(1);
    expect(slashWeight(4)).toBe(2);
    expect(slashVisual("box", 0, 0, false, 0).frame).not.toBe(slashVisual("box", 0, 0, false, 2).frame);
  });
});
