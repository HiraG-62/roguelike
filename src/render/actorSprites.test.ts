/// <reference types="node" />
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ACTOR_ATLASES, ACTOR_SHEETS } from "../data/actorSheets.gen";
import { JOB_KEYS } from "../data/jobs";
import { MOVESETS, MOVESET_KEYS } from "../data/weapons";
import { actorAnchor, actorDir, armColors, bodyAtlas, weaponAtlas, weaponStanceMeta } from "./actorSprites";
import { BODY_CLIP_FRAMES, DEFAULT_STANCE, solveRig, stanceFromMeta } from "./playerRig";

const RECT_STRIDE = 6;
/** 腕の袖・手は 3 段（暗・基・明） */
const ARM_SHADES = 3;

function capital(key: string): string {
  return `${key.charAt(0).toUpperCase()}${key.slice(1)}`;
}

/** PNG の IHDR から寸法を読む */
function pngSize(path: string): { width: number; height: number } {
  const buf = readFileSync(path);
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

describe("actorSprites: 生成物の一覧と PNG", () => {
  it("アトラスの寸法が PNG と一致し、シートの矩形がはみ出さない", () => {
    for (const [key, atlas] of Object.entries(ACTOR_ATLASES)) {
      const size = pngSize(`public/${atlas.url}`);
      expect(size, key).toEqual({ width: atlas.width, height: atlas.height });
    }
    for (const [key, sheet] of Object.entries(ACTOR_SHEETS)) {
      const atlas = ACTOR_ATLASES[sheet.atlas as keyof typeof ACTOR_ATLASES];
      expect(atlas, key).toBeDefined();
      expect(sheet.rects.length, key).toBe(sheet.frames * sheet.dirs * RECT_STRIDE);
      for (let i = 0; i < sheet.rects.length; i += RECT_STRIDE) {
        const [x = 0, y = 0, w = 0, h = 0] = sheet.rects.slice(i, i + 4);
        expect(x + w, key).toBeLessThanOrEqual(atlas?.width ?? 0);
        expect(y + h, key).toBeLessThanOrEqual(atlas?.height ?? 0);
      }
    }
  });

  it("方向は最寄りの番号に丸める（32 方向）", () => {
    expect(actorDir(0, 32)).toBe(0);
    expect(actorDir(Math.PI / 2, 32)).toBe(8);
    expect(actorDir(-Math.PI / 2, 32)).toBe(24);
    expect(actorDir(1.23, 1)).toBe(0);
  });
});

describe("actorSprites: 全ジョブの体", () => {
  it("どのジョブも専用の体を持ち、全クリップの全フレームに肩と頭の位置の印がある", () => {
    for (const job of JOB_KEYS) {
      const body = bodyAtlas(job);
      const own = job === "none" ? "bodyNone" : `body${capital(job)}`;
      expect(body, job).toBe(own);
      for (const [clip, frames] of Object.entries(BODY_CLIP_FRAMES)) {
        const sheet = ACTOR_SHEETS[`${body}.${clip}`];
        expect(sheet?.frames, `${job} ${clip}`).toBe(frames);
        for (let f = 0; f < frames; f++) {
          for (const mark of ["shoulderF", "shoulderB", "head"]) {
            expect(actorAnchor(`${body}.${clip}`, 0, f, mark), `${job} ${clip} ${f} ${mark}`).toBeDefined();
          }
        }
      }
    }
  });

  it("体は腕の色（袖・手の 3 段）を持つ", () => {
    for (const job of JOB_KEYS) {
      const arm = armColors(bodyAtlas(job));
      expect(arm?.sleeve.length, job).toBe(ARM_SHADES);
      expect(arm?.hand.length, job).toBe(ARM_SHADES);
      for (const c of [...(arm?.sleeve ?? []), ...(arm?.hand ?? [])]) expect(c, job).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});

describe("actorSprites: 全武器種の手に持つ武器", () => {
  it("どの武器種も手に持つ絵と、形の正しい構えを持つ", () => {
    for (const key of MOVESET_KEYS) {
      const atlas = weaponAtlas(key);
      expect(atlas, key).toBe(`wpn${capital(key)}`);
      if (!atlas) continue;
      expect(ACTOR_SHEETS[`${atlas}.held`]?.dirs, key).toBe(32);
      const stance = stanceFromMeta(weaponStanceMeta(atlas));
      expect(stance, `${key} の構えが既定のまま（meta.stance の形が崩れている）`).not.toBe(DEFAULT_STANCE);
    }
  });

  it("弾を撃つ武器種（primary が shot）は銃口の位置の印を全方向に持つ", () => {
    for (const key of MOVESET_KEYS) {
      if (MOVESETS[key].primary !== "shot") continue;
      const atlas = weaponAtlas(key);
      const sheet = ACTOR_SHEETS[`${atlas}.held`];
      for (let d = 0; d < (sheet?.dirs ?? 0); d++) expect(actorAnchor(`${atlas}.held`, d, 0, "muzzle"), `${key} ${d}`).toBeDefined();
    }
  });

  it("両手持ちの武器は添え手の位置を持つ", () => {
    for (const key of MOVESET_KEYS) {
      const atlas = weaponAtlas(key);
      if (!atlas) continue;
      const stance = stanceFromMeta(weaponStanceMeta(atlas));
      if (stance.grip !== "two") continue;
      const meta = ACTOR_ATLASES[atlas as keyof typeof ACTOR_ATLASES].meta as { offGrip?: unknown } | null;
      expect(typeof meta?.offGrip, key).toBe("number");
    }
  });
});

describe("二刀の後ろの手の前後（構えの offFront）", () => {
  it("爪・双剣・戦輪の後ろの手は、全ジョブの体の全コマで体の後ろ。拳だけ体の前に構える", () => {
    for (const key of ["claws", "twinBlades", "ringBlades", "fists"] as const) {
      const weapon = weaponAtlas(key);
      if (!weapon) throw new Error(`${key} の絵が無い`);
      const stance = stanceFromMeta(weaponStanceMeta(weapon));
      for (const job of JOB_KEYS) {
        const body = bodyAtlas(job);
        for (const [clip, frames] of Object.entries(BODY_CLIP_FRAMES)) {
          for (let f = 0; f < frames; f++) {
            const shoulderF = actorAnchor(`${body}.${clip}`, 0, f, "shoulderF");
            const shoulderB = actorAnchor(`${body}.${clip}`, 0, f, "shoulderB");
            if (!shoulderF || !shoulderB) continue;
            const rig = solveRig({ stance, swing: undefined, step: 0, aim: 0, aimHeld: false, facingRight: true, shoulderF, shoulderB, time: 0, offGrip: null, aimOrigin: { x: 0, y: -20 }, barrelY: 0 });
            expect(rig.back.behind, `${key} ${job} ${clip}[${f}]`).toBe(key !== "fists");
          }
        }
      }
    }
  });
});
