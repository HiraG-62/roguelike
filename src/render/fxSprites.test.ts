/// <reference types="node" />
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FX_ATLASES, FX_MOVESET_RAW, FX_SHEETS, type FxSheetKey } from "../data/fxSheets.gen";
import { MOVESETS, type MovesetKey } from "../data/weapons";
import { FX_RAMP_KEYS, cellOf, fitScale, haloAlpha, lifeFrame, loopFrame, pickDir, rampColors, rampGlow, rampHalo, snapArt, swingFrame } from "./fxSprites";
import { ART_FX_KEY, BULLET_FX, MOVESET_FX, SKILL_FX, type SkillFx, ULTIMATE_FX, ULT_ATLAS_SUFFIX, mirrorFlip, motionKey, rampOfElement, skillAtlas, swingMotionKeys } from "./fxMotions";
import { LEGACY_SKILL_KEYS, SKILL_KEYS } from "../skills/types";
import { COMMON_ART_KEYS } from "../skills/arts/keys";
import { ART_ACT_KINDS } from "../skills/arts/types";
import { ultPiece } from "./fxUltimate";
import { actPieceOf } from "./fxSkill";
import { BULLETS, baseHasBullet } from "../loot/bullets";
import { BASES } from "../loot/bases";
import { movesetCasts } from "../data/weapons";
import { ULTIMATES, ultimateDef } from "../data/ultimates";
import { MOVESET_KEYS } from "../data/weapons";
import { ELEMENTS } from "../core/element";

const SHEET_KEYS = Object.keys(FX_SHEETS) as FxSheetKey[];
const RECT_STRIDE = 6;

/** PNG の IHDR から寸法を読む */
function pngSize(path: string): { width: number; height: number } {
  const buf = readFileSync(path);
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

describe("fxSprites: 方向の選び方", () => {
  it("24 方向で最寄りの方向を選ぶ", () => {
    expect(pickDir(0, 24, false)).toEqual({ dir: 0, flip: false });
    expect(pickDir(Math.PI / 2, 24, false)).toEqual({ dir: 6, flip: false });
    expect(pickDir(-Math.PI / 2, 24, false)).toEqual({ dir: 18, flip: false });
    expect(pickDir((7 * Math.PI) / 180, 24, false).dir).toBe(0);
    expect(pickDir((8 * Math.PI) / 180, 24, false).dir).toBe(1);
  });

  it("反時計回りは −θ の方向を上下反転で引く", () => {
    expect(pickDir(Math.PI / 6, 24, true)).toEqual({ dir: 22, flip: true });
    expect(pickDir(0, 24, true)).toEqual({ dir: 0, flip: true });
  });

  it("向きのないシートは常に方向 0", () => {
    expect(pickDir(2.3, 1, false)).toEqual({ dir: 0, flip: false });
    expect(pickDir(2.3, 1, true)).toEqual({ dir: 0, flip: true });
  });
});

describe("fxSprites: 時間の割り付け", () => {
  const sheet = { frames: 8, active: 4 };

  it("active の進みで前半のフレームを流す", () => {
    expect(swingFrame(sheet, "active", 0, 0, 0.2)).toBe(0);
    expect(swingFrame(sheet, "active", 0.5, 0, 0.2)).toBe(2);
    expect(swingFrame(sheet, "active", 1, 0, 0.2)).toBe(3);
  });

  it("recover の経過で後半のフレームを流し、流し切ったら描かない", () => {
    expect(swingFrame(sheet, "recover", 1, 0, 0.2)).toBe(4);
    expect(swingFrame(sheet, "recover", 1, 0.19, 0.2)).toBe(7);
    expect(swingFrame(sheet, "recover", 1, 0.2, 0.2)).toBeNull();
  });

  it("寿命で流すフレームは寿命を過ぎたら描かない", () => {
    expect(lifeFrame(6, 0, 0.18)).toBe(0);
    expect(lifeFrame(6, 0.17, 0.18)).toBe(5);
    expect(lifeFrame(6, 0.18, 0.18)).toBeNull();
  });

  it("押している間の絵は period 秒で 1 巡して繰り返す", () => {
    expect(loopFrame(8, 0, 0.25)).toBe(0);
    expect(loopFrame(8, 0.125, 0.25)).toBe(4);
    expect(loopFrame(8, 0.25, 0.25)).toBe(0);
    expect(loopFrame(8, 0.26, 0.25)).toBe(0);
    expect(loopFrame(8, 0.24, 0.25)).toBe(7);
  });

  it("大きさの差が許容内なら拡縮しない", () => {
    expect(fitScale(17, 16, 0.15)).toBe(1);
    expect(fitScale(24, 16, 0.15)).toBe(1.5);
    expect(fitScale(0, 16, 0.15)).toBe(1);
  });

  it("置く位置は絵のドット（0.5px）の格子に揃う", () => {
    expect(snapArt(10.3)).toBe(10.5);
    expect(snapArt(10.2)).toBe(10);
  });
});

describe("fxSprites: 生成物と一覧の整合", () => {
  it("一覧のアトラスの寸法が PNG と一致する", () => {
    for (const [key, atlas] of Object.entries(FX_ATLASES)) {
      expect(pngSize(`public/${atlas.url}`), key).toEqual({ width: atlas.width, height: atlas.height });
    }
  });

  it("すべてのフレームの矩形がアトラスに収まり、方向ごとに描かれたフレームがある", () => {
    for (const key of SHEET_KEYS) {
      const sheet = FX_SHEETS[key];
      const atlas = Object.entries(FX_ATLASES).find(([k]) => k === sheet.atlas)?.[1];
      expect(atlas, `${key} のアトラス ${sheet.atlas}`).toBeDefined();
      if (!atlas) continue;
      expect(sheet.rects.length, key).toBe(sheet.dirs * sheet.frames * RECT_STRIDE);
      expect(sheet.active, key).toBeLessThanOrEqual(sheet.frames);
      for (let d = 0; d < sheet.dirs; d++) {
        let drawn = 0;
        for (let f = 0; f < sheet.frames; f++) {
          const cell = cellOf(sheet, d, f);
          if (!cell) continue;
          drawn++;
          expect(cell.x + cell.w, key).toBeLessThanOrEqual(atlas.width);
          expect(cell.y + cell.h, key).toBeLessThanOrEqual(atlas.height);
        }
        expect(drawn, `${key} 方向 ${d}`).toBeGreaterThan(sheet.frames / 2);
      }
    }
  });

  it("配色はすべて 7 段で、属性ごとに配色がある", () => {
    for (const key of FX_RAMP_KEYS) expect(rampColors(key), key).toHaveLength(7);
    for (const element of ELEMENTS) expect(FX_RAMP_KEYS).toContain(rampOfElement(element));
  });

  it("墨の配色: 無属性は芯ほど濃墨、属性つきは濃墨の一筆に明るい芯（docs/ideas/fx-sprites.md 3.6）", () => {
    const luma = (hex: string): number => {
      const n = Number.parseInt(hex.slice(1), 16);
      return 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
    };
    const INK_MAX_LUMA = 64;
    for (const key of FX_RAMP_KEYS) {
      const lumas = rampColors(key).map(luma);
      const core = lumas[6] ?? 0;
      const body = lumas.slice(0, 5);
      if (key === "steel" || key === "brass") {
        expect(core, `${key} の芯は濃墨`).toBeLessThan(INK_MAX_LUMA);
        expect(lumas[0] ?? 0, `${key} の縁と飛沫は淡墨`).toBeGreaterThan(core);
      } else {
        for (const v of body) expect(v, `${key} の本体は墨`).toBeLessThan(INK_MAX_LUMA);
        expect(core, `${key} の芯は属性の色で明るい`).toBeGreaterThan(INK_MAX_LUMA * 2);
      }
    }
  });

  it("どの配色にも線の周りの滲みがあり、線から離れるほど薄れて幅の外では 0", () => {
    for (const key of FX_RAMP_KEYS) {
      const halo = rampHalo(key);
      expect(halo.alpha, key).toBeGreaterThan(0);
      expect(halo.alpha, key).toBeLessThanOrEqual(1);
      expect(Number.isInteger(halo.r) && halo.r >= 1, key).toBe(true);
      expect(rampGlow(key)).toBe(halo.color);
      expect(haloAlpha(halo, 0), `${key} 線そのもの`).toBe(0);
      expect(haloAlpha(halo, 1), key).toBeCloseTo(halo.alpha);
      expect(haloAlpha(halo, halo.r), key).toBeLessThan(haloAlpha(halo, 1) + 1e-9);
      expect(haloAlpha(halo, halo.r + 1), `${key} 幅の外`).toBe(0);
    }
  });
});

/**
 * 段を足して絵がまだ無いもの（手続きの描画に落ちる）。fx レーンが scripts/fx/sheets/<武器種>.mjs に足して `npm run fx:gen` したら消す。
 * 連刃の段数の拡張（5b-F）の分は 2026-09-30 に描き切ったので空
 */
const UNDRAWN_MOTIONS: Readonly<Partial<Record<MovesetKey, readonly string[]>>> = {
  // クナイ（段 5-A で足した）: 段 7-A で命中と弾の絵のアトラスだけ作った。振りの絵は技の配線が固まってから段 7-B で描く
  kunai: ["dash", "r:kunaiCut", "r:kunaiReturn", "r:kunaiDrive", "branch:shadowPin", "branch:farThrow"],
};

/**
 * 定義から消えた段の絵。生成物が残っているだけなので、fx レーンが取り除くまで許す。
 * 砲の筒殴り・尻叩き、チャクラムの左 4 段と輪断ち・二輪断ちは段 7-A で取り除いたので空
 */
const STALE_MOTIONS: Readonly<Partial<Record<MovesetKey, readonly string[]>>> = {};

describe("fxMotions: 武器種のモーションの表", () => {
  it("表の行は壊れていない（無いシート・知らない原点がない）", () => {
    for (const raw of FX_MOVESET_RAW) {
      // 奥義のアトラス（`<武器種>Ult`）は motions を持たない
      if (!raw || !("motions" in raw)) continue;
      const built = MOVESET_FX[raw.moveset as MovesetKey];
      expect(built, raw.moveset).toBeDefined();
      expect(Object.keys(built?.motions ?? {}), raw.moveset).toEqual(Object.keys(raw.motions));
    }
  });

  it("表のある武器種は、振りのモーション（左の段・ダッシュ・右の振り・派生・溜め）をすべて持つ", () => {
    for (const [moveset, fx] of Object.entries(MOVESET_FX)) {
      const def = MOVESETS[moveset as MovesetKey];
      const undrawn = UNDRAWN_MOTIONS[moveset as MovesetKey] ?? [];
      for (const key of swingMotionKeys(def)) {
        if (undrawn.includes(key)) continue;
        expect(fx?.motions[key], `${moveset} ${key}`).toBeDefined();
      }
    }
  });

  it("表のモーションの key は武器種の定義に実在する", () => {
    for (const [moveset, fx] of Object.entries(MOVESET_FX)) {
      const real = new Set(swingMotionKeys(MOVESETS[moveset as MovesetKey]));
      const stale = STALE_MOTIONS[moveset as MovesetKey] ?? [];
      for (const key of Object.keys(fx?.motions ?? {})) expect(real.has(key) || stale.includes(key), `${moveset} ${key}`).toBe(true);
    }
  });

  it("未描画・旧 key の許容リストは実在する段だけを指す（絵を足したら消し忘れを落とす）", () => {
    for (const [moveset, keys] of Object.entries(UNDRAWN_MOTIONS)) {
      const real = new Set(swingMotionKeys(MOVESETS[moveset as MovesetKey]));
      const motions = MOVESET_FX[moveset as MovesetKey]?.motions ?? {};
      for (const key of keys ?? []) {
        expect(real.has(key), `${moveset} ${key} は定義にある`).toBe(true);
        expect(motions[key], `${moveset} ${key} は絵ができたので許容リストから消す`).toBeUndefined();
      }
    }
    for (const [moveset, keys] of Object.entries(STALE_MOTIONS)) {
      const real = new Set(swingMotionKeys(MOVESETS[moveset as MovesetKey]));
      for (const key of keys ?? []) expect(real.has(key), `${moveset} ${key} は定義に戻ったので許容リストから消す`).toBe(false);
    }
  });

  it("モーションの key は段・右・派生・ダッシュ・溜めを見分ける", () => {
    const sword = MOVESETS.sword;
    const ref = { lane: "primary" as const, step: 1, branch: -1, dashStrike: false, chargeLevel: 0 };
    expect(motionKey(sword, ref)).toBe("l:1");
    expect(motionKey(sword, { ...ref, dashStrike: true })).toBe("dash");
    expect(motionKey(sword, { ...ref, lane: "secondary" })).toBe("r:returnCut");
    expect(motionKey(sword, { ...ref, branch: 0 })).toBe(`branch:${sword.branches[0]?.key}`);
    expect(motionKey(MOVESETS.greatsword, { ...ref, chargeLevel: 1 })).toBe("charge");
    // 溜めを持たない武器種は溜めの段でも通常の段
    expect(motionKey(sword, { ...ref, chargeLevel: 1 })).toBe("l:1");
  });

  it("反転の条件: 振りの左右か、向いている左右で絵を上下反転する", () => {
    expect(mirrorFlip("swing", true, false)).toBe(true);
    expect(mirrorFlip("swing", false, true)).toBe(false);
    expect(mirrorFlip("faceLeft", false, true)).toBe(true);
    expect(mirrorFlip("faceLeft", true, false)).toBe(false);
    expect(mirrorFlip("faceRight", false, false)).toBe(true);
    expect(mirrorFlip("faceRight", true, true)).toBe(false);
  });

  it("地面の層の絵は、空中の絵と同じフレーム数・方向数・active を持つ（同じ時間割で流す）", () => {
    for (const [moveset, fx] of Object.entries(MOVESET_FX)) {
      for (const [key, m] of Object.entries(fx?.motions ?? {})) {
        if (!m.ground) continue;
        const air = FX_SHEETS[m.sheet];
        const ground = FX_SHEETS[m.ground];
        expect([ground.frames, ground.dirs, ground.active], `${moveset} ${key}`).toEqual([air.frames, air.dirs, air.active]);
      }
    }
  });

  it("押している間の絵は、その武器種の右の溜めの段（回しを持つもの）に対応する", () => {
    for (const [moveset, fx] of Object.entries(MOVESET_FX)) {
      const def = MOVESETS[moveset as MovesetKey];
      for (const key of Object.keys(fx?.holds ?? {})) {
        const lane = def.steps2.find((s) => s.key === key);
        expect(lane?.kind, `${moveset} ${key}`).toBe("charge");
        expect(lane?.kind === "charge" ? lane.charge.spinning : undefined, `${moveset} ${key}`).toBeDefined();
      }
    }
    expect(MOVESET_FX.flail?.holds.flailWhirl).toBeDefined();
  });
});

/** 武器種が撃つ弾の key（弾を持つベースの弾・右の弾の段・振りの cast） */
function movesetBulletKeys(moveset: MovesetKey): string[] {
  const def = MOVESETS[moveset];
  const bases = BASES.filter((b) => b.moveset === moveset && baseHasBullet(b)).map((b) => b.key);
  const volleys = def.steps2.flatMap((s) => (s.kind === "volley" ? [s.throw.bullet.key] : []));
  const casts = movesetCasts(def).map((c) => c.throw.bullet.key);
  return [...new Set([...bases, ...volleys, ...casts])];
}

describe("fxMotions: 弾の絵の表", () => {
  it("表の弾の key は実在し、壊れた行が無い", () => {
    for (const raw of FX_MOVESET_RAW) {
      const bullets = raw && "bullets" in raw ? (raw.bullets as Record<string, unknown>) : {};
      for (const key of Object.keys(bullets)) {
        expect(BULLETS[key], `${raw && "moveset" in raw ? raw.moveset : "?"} の弾 ${key}`).toBeDefined();
        expect(BULLET_FX.get(key), `${raw && "moveset" in raw ? raw.moveset : "?"} の弾 ${key} の行`).toBeDefined();
      }
    }
  });

  it("弾の表を持つ武器種は、撃つ弾（ベース・右の弾の段・cast）をすべて持つ", () => {
    for (const [moveset, fx] of Object.entries(MOVESET_FX)) {
      if (!fx || Object.keys(fx.bullets).length === 0) continue;
      for (const key of movesetBulletKeys(moveset as MovesetKey)) expect(fx.bullets[key], `${moveset} の弾 ${key}`).toBeDefined();
    }
  });
});

describe("fxMotions: 奥義の絵の表", () => {
  it("表の奥義は実在し、アトラスは奥義の武器種の `<武器種>Ult`", () => {
    for (const [key, fx] of Object.entries(ULTIMATE_FX)) {
      const def = ultimateDef(key);
      expect(def, key).toBeDefined();
      const sheets = [fx.cast, ...fx.acts, fx.target, ...fx.ends, fx.aura, fx.quake, fx.sustain].flatMap((p) => (p ? [p.sheet] : []));
      expect(sheets.length, `${key} に絵がある`).toBeGreaterThan(0);
      for (const sheet of sheets) expect(FX_SHEETS[sheet].atlas, `${key} ${sheet}`).toBe(`${def?.moveset}${ULT_ATLAS_SUFFIX}`);
    }
  });

  it("絵の出来事は奥義の定義に合う（行為の番号・引き寄せ・纏い・衝撃波・持続・弾）", () => {
    for (const [key, fx] of Object.entries(ULTIMATE_FX)) {
      const def = ultimateDef(key);
      if (!def) continue;
      const acts = def.kind === "instant" ? def.acts : [];
      const ends = def.kind === "sustain" ? (def.sustain.onEnd ?? []) : [];
      expect(fx.acts.length, `${key} acts`).toBeLessThanOrEqual(acts.length);
      expect(fx.ends.length, `${key} ends`).toBeLessThanOrEqual(ends.length);
      if (fx.target) expect([...acts, ...ends].some((a) => a.kind === "pull"), `${key} target は引き寄せだけ`).toBe(true);
      if (fx.aura) expect(def.kind === "sustain" && def.sustain.aura, `${key} aura`).toBeTruthy();
      if (fx.quake) expect(def.kind === "sustain" && def.sustain.hitQuake, `${key} quake`).toBeTruthy();
      if (fx.sustain) expect(def.kind, `${key} sustain`).toBe("sustain");
      for (const i of Object.keys(fx.shots)) expect(acts[Number(i)]?.kind, `${key} の弾 ${i}`).toBe("volley");
      // 絵の表の行は壊れていない（載せた番号の絵が引ける）
      fx.acts.forEach((p, i) => p && expect(ultPiece(fx, { part: "act", index: i }), `${key} act ${i}`).toBe(p));
    }
  });
});

/**
 * エフェクトの絵がまだ無い武器種（新しい武器種を足した直後、手続きの描画に落ちている間だけ載せる）。
 * fx レーンが scripts/fx/sheets/<武器種>.mjs と <武器種>Ult.mjs を足して `npm run fx:gen` したら消す。書・手鈴は 2026-09-30 に描き切った。
 * 手裏剣は段 5-A で足した（絵は段 7-B）。クナイは段 7-A で命中と弾の絵の表を作った（振りは UNDRAWN_MOTIONS）
 */
const UNDRAWN_MOVESETS: readonly MovesetKey[] = ["shuriken"];
/** 奥義の絵（`<武器種>Ult.mjs`）がまだ無い武器種。クナイ・手裏剣の奥義は技の配線が固まってから段 7-B で描く */
const UNDRAWN_ULTIMATES: readonly MovesetKey[] = ["kunai", "shuriken"];

describe("fxMotions: スキル石の絵の表", () => {
  const sheetsOf = (fx: SkillFx): FxSheetKey[] => {
    const all: (FxSheetKey | undefined)[] = [fx.active, fx.placed, fx.fly, fx.aura].flatMap((l) => [l?.sheet, l?.ground]);
    for (const p of [fx.cast, fx.act, fx.end, ...Object.values(fx.acts ?? {})]) if (p) all.push(p.sheet, p.ground, p.beam?.sheet, p.tip);
    return all.filter((k): k is FxSheetKey => k !== undefined);
  };

  it("表のスキルは実在し、絵はスキル石のアトラス（`skill<形>`）に載る", () => {
    expect(Object.keys(SKILL_FX).length).toBeGreaterThan(0);
    for (const [key, fx] of Object.entries(SKILL_FX)) {
      if (key !== ART_FX_KEY) expect(SKILL_KEYS as readonly string[], key).toContain(key);
      const sheets = sheetsOf(fx);
      expect(sheets.length, `${key} に絵がある`).toBeGreaterThan(0);
      for (const sheet of sheets) expect(FX_SHEETS[sheet].atlas, `${key} ${sheet}`).toMatch(/^skill[A-Z]/);
      expect(skillAtlas(key), key).toMatch(/^skill[A-Z]/);
    }
  });

  it("表の行は壊れていない（生成器の表の行がすべて型付きの表に残る）", () => {
    for (const raw of FX_MOVESET_RAW) {
      const skills = raw && "skills" in raw ? (raw.skills as Record<string, Record<string, unknown>>) : {};
      for (const [key, row] of Object.entries(skills)) {
        const fx = SKILL_FX[key];
        expect(fx, key).toBeDefined();
        for (const part of ["cast", "act", "end", "active", "placed", "fly", "aura"] as const) {
          if (row[part] !== undefined) expect(fx?.[part], `${key} ${part}`).toBeDefined();
        }
        for (const variant of Object.keys((row.acts ?? {}) as Record<string, unknown>)) expect(fx?.acts?.[variant], `${key} acts.${variant}`).toBeDefined();
      }
    }
  });

  it("置いてある間・飛んでいる間・纏いの絵は繰り返しの周期を持つ", () => {
    for (const [key, fx] of Object.entries(SKILL_FX)) {
      for (const [part, loop] of [["placed", fx.placed], ["fly", fx.fly], ["aura", fx.aura]] as const) if (loop) expect(loop.period, `${key} ${part}`).toBeGreaterThan(0);
    }
  });
});

describe("fxMotions: 全スキル石の網羅", () => {
  it("どのスキル石も専用の絵を持つ（手書きと技の両方）", () => {
    const missing = [...LEGACY_SKILL_KEYS, ...COMMON_ART_KEYS].filter((key) => !SKILL_FX[key]);
    expect(missing).toEqual([]);
  });

  it("汎用の技の絵はどの行為の種類も描け、弾の絵を持つ（武器の型で行為の種類が変わっても絵が出る）", () => {
    const generic = SKILL_FX[ART_FX_KEY];
    for (const kind of ART_ACT_KINDS) expect(generic?.acts?.[kind], `@art acts.${kind}`).toBeDefined();
    expect(generic?.fly, "@art fly").toBeDefined();
  });

  it("技の行為の絵は 技の細分 → 技の種類 → 汎用の細分 → 汎用の種類 の順に引く", () => {
    const generic = SKILL_FX[ART_FX_KEY];
    // 旋風斬りは輪だけを持つ: 輪は自分の絵、扇は汎用の絵
    expect(actPieceOf("commonWhirl", "ring")).toBe(SKILL_FX.commonWhirl?.acts?.ring);
    expect(actPieceOf("commonWhirl", "arcWide")).toBe(generic?.acts?.arcWide ?? generic?.acts?.arc);
    // 手書きのスキルは汎用の絵に落ちない
    expect(actPieceOf("parry", "ring")).toBeUndefined();
  });

  it("技の表の acts は行為の種類（と細分）の名前だけを持つ", () => {
    const kinds: readonly string[] = ART_ACT_KINDS;
    for (const key of [...COMMON_ART_KEYS, ART_FX_KEY]) {
      for (const variant of Object.keys(SKILL_FX[key]?.acts ?? {})) {
        expect(kinds, `${key} acts.${variant}`).toContain(/^[a-z]+/.exec(variant)?.[0] ?? variant);
      }
    }
  });
});

describe("fxMotions: 全武器種・全奥義の網羅", () => {
  it("どの武器種も専用の絵の表を持つ（手続きの描画に戻らない）", () => {
    for (const key of MOVESET_KEYS) {
      if (UNDRAWN_MOVESETS.includes(key)) expect(MOVESET_FX[key], `${key} は絵ができたので UNDRAWN_MOVESETS から消す`).toBeUndefined();
      else expect(MOVESET_FX[key], key).toBeDefined();
    }
  });

  it("どの奥義も専用の絵を持つ（一撃は発動と行為、持続は発動と纏い）", () => {
    for (const key of MOVESET_KEYS) {
      if (UNDRAWN_ULTIMATES.includes(key)) continue;
      for (const def of ULTIMATES[key]) {
        const fx = ULTIMATE_FX[def.key];
        expect(fx?.cast, `${def.key} の発動`).toBeDefined();
        if (def.kind === "sustain") expect(fx?.sustain, `${def.key} の纏い`).toBeDefined();
        else expect(fx?.acts.some((p) => p), `${def.key} の行為`).toBe(true);
      }
    }
  });
});
