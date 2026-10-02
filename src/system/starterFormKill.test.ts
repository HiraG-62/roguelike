import { describe, expect, it } from "vitest";
import { createRng } from "../core/rng";
import { BUD } from "../data/tuning";
import { JOBS, JOB_KEYS, type JobKey } from "../data/jobs";
import { MOVESETS, MOVESET_KEYS, type MovesetKey } from "../data/weapons";
import { baseDef } from "../loot/bases";
import { generateItem } from "../loot/generator";
import { migrateItem } from "../loot/migrate";
import { milestoneDef } from "../loot/provenance";
import { createEmptyProvenance, type Item } from "../loot/types";
import { isStarterFormWeapon, starterForm } from "./jobs";
import { arena, placeEnemy } from "./testHelpers";
import { onTraitKill } from "./traitHooks";

/** 来歴の節目「初期武器と同じ型での撃破」（key は旧「得意武器での撃破」の favoredKills のまま） */

const NOW = 1_700_000_000_000;
/** 節目の key は基準の値（150）のまま、判定は倍率を掛けた値 */
const FIRST_KEY_BASE = 150;
const FIRST_THRESHOLD = FIRST_KEY_BASE * BUD.thresholdScale;
const MIDWAY = 40;
const ENEMY_DX = 30;

function weapon(): Item {
  const item = generateItem(createRng(3), { itemLevel: 10, foundDepth: 10, slot: "mainHand", now: NOW });
  return { ...item, affixes: item.affixes.slice(0, 1), margin: 3, marginMax: 3 };
}

/** 初期武器の武器種（見習いは持たない） */
function starterMoveset(job: JobKey): MovesetKey {
  const baseKey = JOBS[job].starterWeapon;
  const moveset = baseKey === null ? undefined : baseDef(baseKey)?.moveset;
  if (moveset === undefined) throw new Error(`${job} に初期武器が無い`);
  return moveset;
}

/** ジョブと武器種を持たせた部屋で敵を 1 体倒し、装備中の遺物の favoredKills を返す */
function favoredAfterKill(job: JobKey, moveset: MovesetKey, unarmed = false, startAt = 0): number {
  const state = arena(5, { moveset, unarmed });
  state.job = job;
  const item = weapon();
  item.provenance = { ...createEmptyProvenance(), favoredKills: startAt };
  state.profile.equipment.mainHand = item;
  onTraitKill(state, placeEnemy(state, "slime", ENEMY_DX));
  return state.profile.equipment.mainHand?.provenance?.favoredKills ?? -1;
}

describe("初期武器と同じ型での撃破", () => {
  it("初期武器と同じ型の別の武器種でも数える", () => {
    const job: JobKey = "swordsman";
    const own = starterMoveset(job);
    const sameForm = MOVESET_KEYS.find((k) => k !== own && MOVESETS[k].form === MOVESETS[own].form);
    if (sameForm === undefined) throw new Error("同じ型の別の武器種が無い");
    expect(favoredAfterKill(job, own), "初期武器そのもの").toBe(1);
    expect(favoredAfterKill(job, sameForm), "同じ型の別の武器種").toBe(1);
  });

  it("違う型の武器では数えない", () => {
    const job: JobKey = "swordsman";
    const form = starterForm(job);
    const other = MOVESET_KEYS.find((k) => MOVESETS[k].form !== form);
    if (other === undefined) throw new Error("違う型の武器種が無い");
    expect(favoredAfterKill(job, other), "違う型").toBe(0);
  });

  it("見習いと素手は数えない", () => {
    expect(starterForm("none"), "見習いは初期武器が無い").toBeUndefined();
    expect(favoredAfterKill("none", "sword"), "見習い").toBe(0);
    expect(favoredAfterKill("brawler", starterMoveset("brawler"), true), "素手は型が拳でも数えない").toBe(0);
  });

  it("全ジョブで、初期武器と同じ型の武器種だけを数える", () => {
    for (const job of JOB_KEYS) {
      if (job === "none") continue;
      const own = starterMoveset(job);
      expect(starterForm(job), `${job} の型`).toBe(MOVESETS[own].form);
      for (const k of MOVESET_KEYS) {
        const same = MOVESETS[k].form === MOVESETS[own].form;
        const arm = arena(5, { moveset: k, unarmed: false });
        expect(isStarterFormWeapon(arm.stats, job), `${job} / ${k}`).toBe(same);
      }
    }
  });

  it("旧セーブの数えを引き継ぎ、続きから節目に届く（key は据え置き）", () => {
    const migrated = migrateItem({ ...weapon(), provenance: { ...createEmptyProvenance(), favoredKills: FIRST_THRESHOLD - 1 } });
    expect(migrated.provenance?.favoredKills, "旧セーブの数えが読める").toBe(FIRST_THRESHOLD - 1);
    const state = arena(5, { moveset: starterMoveset("hunter"), unarmed: false });
    state.job = "hunter";
    state.profile.equipment.mainHand = migrated;
    onTraitKill(state, placeEnemy(state, "slime", ENEMY_DX));
    const item = state.profile.equipment.mainHand;
    expect(item?.provenance?.favoredKills, "節目の値に届く").toBe(FIRST_THRESHOLD);
    expect(milestoneDef(`favoredKills:${FIRST_KEY_BASE}`), "節目の key は据え置き").toBeDefined();
    expect(item?.milestones, "その節目が到達済みになる").toContain(`favoredKills:${FIRST_KEY_BASE}`);
  });

  it("途中の数えに加算される", () => {
    expect(favoredAfterKill("lancer", starterMoveset("lancer"), false, MIDWAY), "加算される").toBe(MIDWAY + 1);
  });
});
