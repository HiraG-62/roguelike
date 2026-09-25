import { describe, expect, it } from "vitest";
import { type EventInput, enemyTarget, pushEvent, pushPlayerEvent, pushReactionEvent } from "../core/events";
import type { Enemy, GameState } from "../core/state";
import type { StatusKind } from "../core/status";
import type { TerrainKind } from "../core/terrain";
import { BOON, PLAYER, SYNERGY } from "../data/tuning";
import { BOONS, BOON_KEYS, type BoonKey } from "./boonDefs";
import { BOON_KEYS_WAVE2 } from "./boonDefsWave2";
import { onBoonKillRules, onBoonMeleeHitRules, slotCostMul } from "./boonRules";
import { boonWeight, buildTags, onBoonRoomClear, onBoonRoomLock, onBoonSkillCast, onBoonWaveStart } from "./boons";
import { resolveRules } from "./rules";
import { applyStatus, hasStatus, removeStatus } from "./statusEffects";
import { placeTerrain, terrainAt } from "./terrain";
import { arena, engageStartRoom, placeEnemy } from "./testHelpers";

/** 祝福の第 2 弾（src/system/boonDefsWave2.ts）の定義・抽選・各祝福の発火と ICD */

const BIG = 1e6;
const LAST = PLAYER.melee.length - 1;
/** 対象の敵の位置（プレイヤーからの相対）。互いの地形・状態が混ざらない程度に離す */
const SPOTS: readonly (readonly [number, number])[] = [
  [40, 0],
  [0, 40],
  [-40, 0],
];
/** 地形を広げたかを見る点（対象からのずれ） */
const SPREAD_PROBE = 20;
/** ICD が明けたと見なす追加の秒 */
const AFTER = 0.05;

/** フックだけで効く祝福（Rule を持たない） */
const HOOK_BOONS: ReadonlySet<BoonKey> = new Set<BoonKey>(["hordeLord", "huntLord", "weave", "singleMind", "overflowCup"]);

/** createGame の床組みで積まれたイベントを捨てた、敵のいない部屋 */
function cleanArena(): GameState {
  const state = arena(7);
  for (const r of state.rooms) r.locked = false;
  state.events = [];
  state.pendingEvents = [];
  return state;
}

/** 動かず倒れない敵 */
function dummy(state: GameState, dx: number, dy: number, key = "golem"): Enemy {
  const e = placeEnemy(state, key, dx, dy);
  e.hp = BIG;
  e.maxHp = BIG;
  e.phase = "idle";
  e.poise.max = BIG;
  return e;
}

function targetsOf(state: GameState, key = "golem"): Enemy[] {
  return SPOTS.map(([dx, dy]) => dummy(state, dx, dy, key));
}

function hitEvent(kind: EventInput["kind"], e: Enemy, withStatus = false): EventInput {
  return { kind, actor: "player", source: { kind: "player", key: "test" }, ...enemyTarget(e, withStatus) };
}

function terrainUnder(state: GameState, e: Enemy, kind: TerrainKind): void {
  placeTerrain(state, e.body.pos.x, e.body.pos.y, kind, 1, 0);
}

function terrainOf(state: GameState, e: Enemy, dx = 0): TerrainKind {
  return terrainAt(state, e.body.pos.x + dx, e.body.pos.y);
}

function has(e: Enemy, kind: StatusKind): boolean {
  return hasStatus(e.status, kind);
}

// -----------------------------------------------------------------------------
// 定義
// -----------------------------------------------------------------------------

describe("祝福 第 2 弾の定義", () => {
  const wave2 = BOON_KEYS_WAVE2.map((k) => BOONS[k]);

  it("40 種以上を足し、呪い付きは 6 つ以上、結びは 6 種", () => {
    expect(wave2.length, "第 2 弾の数").toBeGreaterThanOrEqual(40);
    expect(wave2.filter((d) => d.cursed).length, "呪い付き").toBeGreaterThanOrEqual(6);
    expect(wave2.filter((d) => d.duo).length, "結び").toBe(6);
    expect(BOON_KEYS.length, "全体の数").toBe(new Set(BOON_KEYS).size);
  });

  it("系譜「大地」と「刃鳴」は 4 段で、4 段目（真髄）は装備のタグを要求する", () => {
    for (const lineage of ["earth", "blade"] as const) {
      const steps = wave2.filter((d) => d.lineage === lineage);
      expect(steps.length, `${lineage} は 4 段`).toBe(4);
      const first = steps.filter((d) => d.after === undefined);
      expect(first.length, `${lineage} の 1 段目は 1 つ`).toBe(1);
      const last = steps.find((d) => !steps.some((o) => o.after === d.key));
      expect(last?.requires, `${lineage} の真髄は requires を持つ`).toBeDefined();
    }
  });

  it("結びの 2 つは実在する別の祝福で、結び自身は呪いなし", () => {
    for (const d of wave2) {
      if (!d.duo) continue;
      expect(BOON_KEYS.includes(d.duo[0]) && BOON_KEYS.includes(d.duo[1]), `${d.key} の相手は実在`).toBe(true);
      expect(d.duo[0], `${d.key} の相手は別々`).not.toBe(d.duo[1]);
      expect(d.cursed, `${d.key} は呪いなし`).toBe(false);
    }
  });

  it("すべて keywords を持ち、フック以外は Rule で書かれ、Rule の ICD は下限以上で id は重複しない", () => {
    const ids = new Set<string>();
    for (const d of wave2) {
      const kws = [...d.keywords.produces, ...d.keywords.consumes, ...d.keywords.amplifies];
      expect(kws.length, `${d.key} の keywords`).toBeGreaterThan(0);
      if (HOOK_BOONS.has(d.key)) continue;
      expect((d.rules ?? []).length, `${d.key} は Rule を持つ`).toBeGreaterThan(0);
      for (const r of d.rules ?? []) {
        expect(r.icd, `${r.id} の ICD`).toBeGreaterThanOrEqual(BOON.ruleMinIcd);
        expect(ids.has(r.id), `${r.id} の重複`).toBe(false);
        ids.add(r.id);
      }
    }
  });
});

describe("武器種・銃の弾・ジョブで出る祝福（loadout）", () => {
  it("大剣でないと岩の構えは出ず、大剣なら出る", () => {
    const state = cleanArena();
    // 抽選は祝福を畳む前の装備 stats を読むので、テストでは stats だけを見させる
    state.boonRun.baseStats = null;
    state.stats.moveset = "sword";
    const sword = buildTags(state);
    expect(boonWeight(BOONS.rockStance, sword.owned, [], sword.gives, sword.loadout), "剣では 0").toBe(0);
    state.stats.moveset = "greatsword";
    const great = buildTags(state);
    expect(boonWeight(BOONS.rockStance, great.owned, [], great.gives, great.loadout), "大剣では出る").toBeGreaterThan(0);
  });

  it("銃の弾とジョブも見る。loadout の無い祝福は影響を受けない", () => {
    const state = cleanArena();
    state.boonRun.baseStats = null;
    state.stats.bullet = "pistol";
    state.job = "none";
    const t = buildTags(state);
    expect(boonWeight(BOONS.oilMine, t.owned, [], t.gives, t.loadout), "設置弾でないと 0").toBe(0);
    expect(boonWeight(BOONS.favoredPride, t.owned, [], t.gives, t.loadout), "見習いに得物の誉れは出ない").toBe(0);
    expect(boonWeight(BOONS.namelessPride, t.owned, [], t.gives, t.loadout), "見習いには無名の誇り").toBeGreaterThan(0);
    expect(boonWeight(BOONS.leyLine, t.owned, [], t.gives, t.loadout), "条件の無い祝福").toBeGreaterThan(0);
  });
});

// -----------------------------------------------------------------------------
// 各祝福の発火と ICD（統一ルール文法で書いたもの）
// -----------------------------------------------------------------------------

interface Scenario {
  key: BoonKey;
  /** 条件（武器種・地形・対象）を整えて対象を返す */
  setup: (state: GameState) => Enemy[];
  /** i 回目の起点（i は対象の添字。同じ敵の procIcd に掛からないよう回ごとに変える） */
  fire: (state: GameState, targets: Enemy[], i: number) => void;
  /** 効果の痕跡を消す（毎回の起点の前） */
  reset?: (state: GameState, targets: Enemy[]) => void;
  /** i 回目の効果が起きたか */
  check: (state: GameState, targets: Enemy[], i: number) => boolean;
  icd: number;
  /** 範囲に効くなどで 2 回目以降を同じ形で測れない（発火と ICD の遮断だけ見る） */
  once?: boolean;
}

function melee(state: GameState, t: Enemy[], i: number): void {
  const e = t[i];
  if (e) pushEvent(state, hitEvent("onMeleeHit", e));
}

function ranged(state: GameState, t: Enemy[], i: number): void {
  const e = t[i];
  if (e) pushEvent(state, hitEvent("onRangedHit", e));
}

function kill(state: GameState, t: Enemy[], i: number): void {
  const e = t[i];
  if (!e) return;
  onBoonKillRules(state, e);
  e.hp = 0;
  pushEvent(state, hitEvent("onKill", e, true));
}

function react(state: GameState, t: Enemy[], i: number, key = "vaporize"): void {
  const e = t[i];
  if (e) pushReactionEvent(state, e, key);
}

function enter(kind: TerrainKind) {
  return (state: GameState): void => pushPlayerEvent(state, "onTerrainEnter", kind, { tag: kind, source: { kind: "terrain", key: kind } });
}

const zeroMana = (state: GameState): void => {
  state.player.mana = 0;
};
const zeroEnergy = (state: GameState): void => {
  state.player.energy = 0;
};
const manaUp = (state: GameState): boolean => state.player.mana > 0;
const energyUp = (state: GameState): boolean => state.player.energy > 0;
const restoreHp = (_s: GameState, t: Enemy[]): void => {
  for (const e of t) e.hp = BIG;
};
const hurtAt = (_s: GameState, t: Enemy[], i: number): boolean => (t[i]?.hp ?? BIG) < BIG;
const poiseAt = (_s: GameState, t: Enemy[], i: number): boolean => (t[i]?.poise.damage ?? 0) > 0;
const statusAt =
  (kind: StatusKind) =>
  (_s: GameState, t: Enemy[], i: number): boolean => {
    const e = t[i];
    return e !== undefined && has(e, kind);
  };
const selfStatus =
  (kind: StatusKind) =>
  (state: GameState): boolean =>
    hasStatus(state.player.status, kind);
const clearSelf =
  (kind: StatusKind) =>
  (state: GameState): void => {
    removeStatus(state, { kind: "player" }, kind);
  };
const clearAll =
  (kind: StatusKind) =>
  (state: GameState, t: Enemy[]): void => {
    for (const e of t) removeStatus(state, { kind: "enemy", enemy: e }, kind);
  };
let projectileBase = 0;
const markProjectiles = (state: GameState): void => {
  projectileBase = state.projectiles.length;
};
const shotOut = (state: GameState): boolean => state.projectiles.length > projectileBase;

function withMoveset(moveset: GameState["stats"]["moveset"], key = "golem") {
  return (state: GameState): Enemy[] => {
    state.stats.moveset = moveset;
    return targetsOf(state, key);
  };
}

/** その弾を撃つ器（ベースの key）を持たせる */
function withShot(bullet: string) {
  return (state: GameState): Enemy[] => {
    state.stats.bullet = bullet;
    return targetsOf(state);
  };
}

function onTerrain(kind: TerrainKind) {
  return (state: GameState): Enemy[] => {
    const t = targetsOf(state);
    for (const e of t) terrainUnder(state, e, kind);
    return t;
  };
}

function roamers(state: GameState): Enemy[] {
  const t = targetsOf(state);
  for (const e of t) e.roomIndex = -1;
  return t;
}

const SCENARIOS: readonly Scenario[] = [
  // ---- 系譜: 大地 ----
  { key: "leyLine", setup: targetsOf, fire: enter("water"), reset: zeroMana, check: manaUp, icd: BOON.leyLineIcd },
  {
    key: "footBreak",
    setup: onTerrain("water"),
    fire: melee,
    check: poiseAt,
    icd: BOON.ruleMinIcd,
  },
  {
    key: "oilSpill",
    setup: (state) => {
      state.player.attack.combo = LAST;
      return targetsOf(state);
    },
    fire: melee,
    check: (s, t, i) => (t[i] ? terrainOf(s, t[i]) === "oil" : false),
    icd: BOON.oilSpillIcd,
  },
  {
    key: "earthWrath",
    setup: onTerrain("water"),
    fire: kill,
    check: (s, t, i) => (t[i] ? terrainOf(s, t[i], SPREAD_PROBE) === "water" : false),
    icd: BOON.earthWrathIcd,
  },
  // ---- 系譜: 刃鳴 ----
  {
    key: "bladeHum",
    setup: (state) => {
      state.player.attack.branch = 0;
      return targetsOf(state);
    },
    fire: melee,
    reset: zeroMana,
    check: manaUp,
    icd: BOON.bladeHumIcd,
  },
  {
    key: "layeredEdge",
    setup: (state) => {
      state.player.attack.step = BOON.layeredEdgeStep;
      return targetsOf(state);
    },
    fire: melee,
    reset: restoreHp,
    check: hurtAt,
    icd: BOON.layeredEdgeIcd,
  },
  {
    key: "chargeRing",
    setup: (state) => {
      state.player.attack.chargeLevel = 1;
      return targetsOf(state);
    },
    fire: melee,
    check: statusAt("broken"),
    icd: BOON.ruleMinIcd,
  },
  {
    key: "hundredBlades",
    setup: (state) => {
      state.player.attack.combo = LAST;
      return targetsOf(state);
    },
    fire: melee,
    reset: markProjectiles,
    check: shotOut,
    icd: BOON.hundredBladesIcd,
  },
  // ---- 武器種 ----
  {
    key: "rockStance",
    setup: (state) => {
      state.stats.moveset = "greatsword";
      state.player.attack.charging = true;
      return targetsOf(state);
    },
    fire: (state) => pushPlayerEvent(state, "onHurt", "hurt"),
    reset: clearSelf("harden"),
    check: selfStatus("harden"),
    icd: BOON.rockStanceIcd,
  },
  {
    key: "twinShadow",
    setup: (state) => {
      state.player.attack.step = BOON.twinShadowStep;
      return withMoveset("twinBlades")(state);
    },
    fire: melee,
    reset: restoreHp,
    check: hurtAt,
    icd: BOON.ruleMinIcd,
  },
  {
    key: "spearPierce",
    setup: (state) => {
      state.player.attack.combo = LAST;
      return withMoveset("spear")(state);
    },
    fire: melee,
    reset: markProjectiles,
    check: shotOut,
    icd: BOON.spearPierceIcd,
  },
  { key: "scytheReap", setup: withMoveset("scythe"), fire: kill, reset: zeroMana, check: manaUp, icd: BOON.ruleMinIcd },
  {
    key: "fistsHeat",
    setup: (state) => {
      state.combo.count = BOON.fistsHeatCombo;
      return withMoveset("fists")(state);
    },
    fire: melee,
    reset: zeroEnergy,
    check: energyUp,
    icd: BOON.fistsHeatIcd,
  },
  {
    key: "whipThreat",
    setup: (state) => {
      state.player.attack.branch = 0;
      return withMoveset("whip")(state);
    },
    fire: melee,
    check: statusAt("fear"),
    icd: BOON.whipThreatIcd,
  },
  {
    key: "cleaverSplit",
    setup: (state) => {
      const t = withMoveset("cleaver")(state);
      for (const e of t) applyStatus(state, { kind: "enemy", enemy: e }, { kind: "guarded", stacks: 1, duration: 10, potency: 0 }, "enemy");
      return t;
    },
    fire: melee,
    check: statusAt("broken"),
    icd: BOON.cleaverSplitIcd,
  },
  {
    key: "staffRing",
    setup: withMoveset("staff"),
    fire: (state, t, i) => {
      const e = t[i];
      if (e) pushEvent(state, hitEvent("onStagger", e));
    },
    reset: restoreHp,
    check: hurtAt,
    icd: BOON.staffRingIcd,
  },
  { key: "wandLamp", setup: withMoveset("wand"), fire: ranged, reset: zeroMana, check: manaUp, icd: BOON.wandLampIcd },
  // ---- 銃の弾 ----
  {
    key: "oilMine",
    setup: withShot("mineLauncher"),
    fire: ranged,
    check: (s, t, i) => (t[i] ? terrainOf(s, t[i]) === "oil" : false),
    icd: BOON.oilMineIcd,
  },
  {
    key: "chargeRecoil",
    setup: withShot("matchlock"),
    fire: ranged,
    reset: (state) => {
      state.player.dashChargesLeft = 0;
    },
    check: (state) => state.player.dashChargesLeft === 1,
    icd: BOON.chargeRecoilIcd,
  },
  { key: "venomBee", setup: withShot("blowgun"), fire: ranged, check: statusAt("poison"), icd: BOON.ruleMinIcd },
  { key: "pebbleRain", setup: withShot("shotgun"), fire: ranged, check: poiseAt, icd: BOON.ruleMinIcd },
  // ---- 属性 ----
  { key: "weakStrike", setup: withMoveset("scythe", "eye"), fire: melee, reset: zeroMana, check: manaUp, icd: BOON.weakStrikeIcd },
  { key: "resistBreak", setup: withMoveset("wand", "eye"), fire: react, check: statusAt("vulnerable"), icd: BOON.resistBreakIcd },
  { key: "oilSlash", setup: onTerrain("oil"), fire: melee, check: statusAt("burn"), icd: BOON.oilSlashIcd },
  { key: "elementTorrent", setup: withMoveset("scythe"), fire: react, reset: zeroEnergy, check: energyUp, icd: BOON.elementTorrentIcd },
  {
    key: "darkFeast",
    setup: withMoveset("scythe"),
    fire: kill,
    reset: (state) => {
      state.player.hp = state.player.maxHp / 2;
    },
    check: (state) => state.player.hp > state.player.maxHp / 2,
    icd: BOON.ruleMinIcd,
  },
  {
    key: "lightPierce",
    setup: withMoveset("wand"),
    fire: (state, t, i) => {
      const e = t[i];
      if (e) pushEvent(state, hitEvent("onCrit", e));
    },
    check: statusAt("vulnerable"),
    icd: BOON.lightPierceIcd,
  },
  {
    key: "waterThunder",
    setup: (state) => {
      const t = onTerrain("water")(state);
      // 対象のすぐ隣に 1 体ずつ（感電が走る先）
      return [...t, ...t.map((e) => dummy(state, e.body.pos.x - state.player.body.pos.x, e.body.pos.y - state.player.body.pos.y + 12))];
    },
    fire: (state, t, i) => {
      const e = t[i];
      if (e) applyStatus(state, { kind: "enemy", enemy: e }, { kind: "shock", stacks: 1, duration: 3, potency: 5 }, "player");
    },
    check: (_s, t, i) => {
      const next = t[i + SPOTS.length];
      return next !== undefined && has(next, "shock");
    },
    icd: BOON.waterThunderIcd,
  },
  // ---- 地形 ----
  {
    key: "iceSkate",
    setup: targetsOf,
    fire: enter("ice"),
    reset: (state) => {
      state.player.dashChargesLeft = 0;
    },
    check: (state) => state.player.dashChargesLeft === 1,
    icd: BOON.iceSkateIcd,
  },
  { key: "fieldBurn", setup: onTerrain("grass"), fire: ranged, check: statusAt("burn"), icd: BOON.fieldBurnIcd },
  { key: "waterRunner", setup: targetsOf, fire: enter("water"), reset: clearSelf("charged"), check: selfStatus("charged"), icd: BOON.waterRunnerIcd },
  {
    key: "frozenWater",
    setup: onTerrain("water"),
    fire: (state, t, i) => {
      const e = t[i];
      if (e) applyStatus(state, { kind: "enemy", enemy: e }, { kind: "chill", stacks: 1, duration: 3, potency: 0 }, "player");
    },
    check: statusAt("freeze"),
    icd: BOON.frozenWaterIcd,
  },
  // ---- ジョブ ----
  {
    key: "favoredPride",
    setup: (state) => {
      state.job = "swordsman";
      state.player.attack.combo = LAST;
      return withMoveset("sword")(state);
    },
    fire: melee,
    reset: zeroEnergy,
    check: energyUp,
    icd: BOON.favoredPrideIcd,
  },
  {
    key: "namelessPride",
    setup: (state) => {
      state.job = "none";
      return targetsOf(state);
    },
    fire: kill,
    reset: zeroMana,
    check: manaUp,
    icd: BOON.ruleMinIcd,
  },
  {
    key: "otherStyle",
    setup: (state) => {
      state.job = "swordsman";
      return withMoveset("spear")(state);
    },
    fire: melee,
    reset: zeroMana,
    check: manaUp,
    icd: BOON.otherStyleIcd,
  },
  // ---- 部屋 ----
  {
    key: "hordeEater",
    setup: (state) => {
      const room = state.rooms[0];
      if (room) room.kind = "horde";
      engageStartRoom(state);
      return targetsOf(state);
    },
    fire: kill,
    reset: zeroEnergy,
    check: energyUp,
    icd: BOON.ruleMinIcd,
  },
  { key: "roamHunt", setup: roamers, fire: kill, reset: zeroMana, check: manaUp, icd: BOON.ruleMinIcd },
  { key: "strayMark", setup: roamers, fire: melee, check: statusAt("vulnerable"), icd: BOON.ruleMinIcd },
  {
    key: "wayfarer",
    setup: (state) => {
      state.floorKind = "glacier";
      return targetsOf(state);
    },
    fire: enter("ice"),
    reset: zeroEnergy,
    check: energyUp,
    icd: BOON.wayfarerIcd,
  },
  {
    key: "engageSpark",
    setup: targetsOf,
    fire: (state) => pushPlayerEvent(state, "onRoomLock", "room"),
    reset: clearAll("fear"),
    check: (_s, t) => t.some((e) => has(e, "fear")),
    icd: BOON.ruleMinIcd,
    once: true,
  },
  // ---- 反応 ----
  { key: "reactionEmber", setup: targetsOf, fire: react, reset: zeroMana, check: manaUp, icd: BOON.reactionEmberIcd },
  {
    key: "steamVeil",
    setup: targetsOf,
    fire: react,
    reset: clearSelf("haste"),
    check: selfStatus("haste"),
    icd: BOON.steamVeilIcd,
  },
  // ---- 呪い ----
  { key: "bloodSoil", setup: targetsOf, fire: enter("grass"), reset: zeroEnergy, check: energyUp, icd: BOON.bloodSoilIcd },
  { key: "scorchBlade", setup: targetsOf, fire: melee, check: statusAt("burn"), icd: BOON.scorchBladeIcd },
  { key: "madBloom", setup: targetsOf, fire: react, reset: restoreHp, check: hurtAt, icd: BOON.madBloomIcd },
  { key: "strayBounty", setup: roamers, fire: kill, reset: zeroEnergy, check: energyUp, icd: BOON.ruleMinIcd },
  {
    key: "heavyOath",
    setup: (state) => {
      state.player.attack.chargeLevel = 1;
      return withMoveset("greatsword")(state);
    },
    fire: melee,
    check: poiseAt,
    icd: BOON.ruleMinIcd,
  },
  { key: "drenched", setup: targetsOf, fire: enter("water"), reset: zeroMana, check: manaUp, icd: BOON.drenchedIcd },
  // ---- 結び ----
  {
    key: "oilBlast",
    setup: targetsOf,
    fire: (state, t, i) => {
      const e = t[i];
      if (!e) return;
      applyStatus(state, { kind: "enemy", enemy: e }, { kind: "oiled", stacks: 1, duration: 5, potency: 0 }, "env");
      applyStatus(state, { kind: "enemy", enemy: e }, { kind: "burn", stacks: 1, duration: 3, potency: 1 }, "player");
    },
    reset: restoreHp,
    check: hurtAt,
    icd: BOON.oilBlastIcd,
  },
  {
    key: "iceDance",
    setup: (state) => {
      const p = state.player.body.pos;
      placeTerrain(state, p.x, p.y, "ice", 1, 0);
      return targetsOf(state);
    },
    fire: (state) => pushPlayerEvent(state, "onJustDodge", "just"),
    reset: clearAll("freeze"),
    check: (_s, t) => t.some((e) => has(e, "freeze")),
    icd: BOON.iceDanceIcd,
    once: true,
  },
  {
    key: "thunderRain",
    setup: targetsOf,
    fire: enter("water"),
    reset: restoreHp,
    check: (_s, t) => t.some((e) => e.hp < BIG),
    icd: BOON.thunderRainIcd,
  },
  {
    key: "groundRend",
    setup: (state) => {
      state.player.attack.branch = 0;
      return onTerrain("water")(state);
    },
    fire: melee,
    check: (s, t, i) => (t[i] ? terrainOf(s, t[i], SPREAD_PROBE) === "water" : false),
    icd: BOON.groundRendIcd,
  },
  {
    key: "weakChain",
    setup: withMoveset("scythe", "eye"),
    fire: react,
    reset: restoreHp,
    check: (_s, t) => t.some((e) => e.hp < BIG),
    icd: BOON.weakChainIcd,
  },
];

describe("第 2 弾の祝福: 発火と ICD", () => {
  it("フック以外の第 2 弾はすべて場面を持つ", () => {
    const covered = new Set(SCENARIOS.map((s) => s.key));
    for (const key of BOON_KEYS_WAVE2) {
      if (HOOK_BOONS.has(key)) continue;
      expect(covered.has(key), `${key} の場面`).toBe(true);
    }
  });

  for (const sc of SCENARIOS) {
    it(`${BOONS[sc.key].name}（${sc.key}）: 条件がそろうと起き、ICD の間は起きず、明けるとまた起きる`, () => {
      // 祝福なしの確認は別の state で（同じ対象を使うと反応・付与の ICD が本番の 1 回目を塞ぐ）
      const bare = cleanArena();
      const bareTargets = sc.setup(bare);
      sc.reset?.(bare, bareTargets);
      sc.fire(bare, bareTargets, 0);
      resolveRules(bare, 0);
      expect(sc.check(bare, bareTargets, 0), "祝福が無ければ起きない").toBe(false);

      const state = cleanArena();
      const targets = sc.setup(state);
      const run = (i: number): boolean => {
        sc.reset?.(state, targets);
        sc.fire(state, targets, i);
        resolveRules(state, 0);
        return sc.check(state, targets, i);
      };
      state.boons = [sc.key];
      expect(run(0), "起きる").toBe(true);
      expect(run(1), "ICD の間は起きない").toBe(false);
      if (sc.once) return;
      resolveRules(state, sc.icd + AFTER);
      expect(run(2), "ICD が明けると起きる").toBe(true);
    });
  }

  it("語ごとの回数上限で、同じ語の効果は窓の中で上限まで", () => {
    const state = cleanArena();
    state.boons = ["leyLine"];
    let fired = 0;
    for (let i = 0; i < SYNERGY.keywordBudget + 2; i++) {
      state.player.mana = 0;
      // ICD を毎回明けさせる（窓は keywordWindow より短い時間で進める）
      state.ruleIcd.clear();
      enter("water")(state);
      resolveRules(state, 0);
      if (state.player.mana > 0) fired += 1;
    }
    expect(fired, "上限で止まる").toBe(SYNERGY.keywordBudget);
  });
});

// -----------------------------------------------------------------------------
// 呪いの代償（Rule の 2 本目）
// -----------------------------------------------------------------------------

describe("呪いの代償", () => {
  it("血染めの地: 地形に踏み込むと自分が出血する", () => {
    const state = cleanArena();
    state.boons = ["bloodSoil"];
    enter("water")(state);
    resolveRules(state, 0);
    expect(hasStatus(state.player.status, "bleed"), "出血").toBe(true);
  });

  it("焦がれ刃: 倒すと自分も燃える", () => {
    const state = cleanArena();
    state.boons = ["scorchBlade"];
    kill(state, targetsOf(state), 0);
    resolveRules(state, 0);
    expect(hasStatus(state.player.status, "burn"), "燃焼").toBe(true);
  });

  it("狂い咲き: 反応のたび弱体する", () => {
    const state = cleanArena();
    state.boons = ["madBloom"];
    react(state, targetsOf(state), 0);
    resolveRules(state, 0);
    expect(hasStatus(state.player.status, "weaken"), "弱体").toBe(true);
  });

  it("野良の賞金: 交戦していない間の被弾で弱体、交戦中は受けない", () => {
    const state = cleanArena();
    state.boons = ["strayBounty"];
    pushPlayerEvent(state, "onHurt", "hurt");
    resolveRules(state, 0);
    expect(hasStatus(state.player.status, "weaken"), "交戦外で弱体").toBe(true);
    const engaged = cleanArena();
    engaged.boons = ["strayBounty"];
    engageStartRoom(engaged);
    pushPlayerEvent(engaged, "onHurt", "hurt");
    resolveRules(engaged, 0);
    expect(hasStatus(engaged.player.status, "weaken"), "交戦中は受けない").toBe(false);
  });

  it("重き誓い: 溜めずに当てると弱体する", () => {
    const state = cleanArena();
    state.boons = ["heavyOath"];
    state.stats.moveset = "greatsword";
    state.player.attack.chargeLevel = 0;
    melee(state, targetsOf(state), 0);
    resolveRules(state, 0);
    expect(hasStatus(state.player.status, "weaken"), "弱体").toBe(true);
  });

  it("濡れ鼠: 水たまりで自分が濡れる", () => {
    const state = cleanArena();
    state.boons = ["drenched"];
    enter("water")(state);
    resolveRules(state, 0);
    expect(hasStatus(state.player.status, "wet"), "濡れ").toBe(true);
  });
});

// -----------------------------------------------------------------------------
// フックの祝福
// -----------------------------------------------------------------------------

describe("フックの祝福", () => {
  it("巣窟の主: 巣窟・試練・闘技場の封鎖と次の波で必殺ゲージと気力。普通の部屋では起きない", () => {
    const state = cleanArena();
    state.boons = ["hordeLord"];
    const room = state.rooms[0];
    if (!room) throw new Error("開始部屋が無い");
    const p = state.player;
    p.energy = 0;
    p.mana = 0;
    room.kind = "normal";
    room.locked = true;
    onBoonRoomLock(state, 0);
    expect(p.energy, "普通の部屋では起きない").toBe(0);
    room.kind = "horde";
    onBoonRoomLock(state, 0);
    expect(p.energy, "封鎖（最初の波）で必殺ゲージ").toBeGreaterThan(0);
    expect(p.mana, "気力").toBeGreaterThan(0);
    const first = p.energy;
    onBoonWaveStart(state, room);
    expect(p.energy, "次の波でも").toBeGreaterThan(first);
  });

  it("狩場の王: 巣窟を制圧すると徘徊の敵だけが脆弱と恐怖", () => {
    const state = cleanArena();
    state.boons = ["huntLord"];
    const [roamer, local] = targetsOf(state);
    if (!roamer || !local) throw new Error("敵が無い");
    roamer.roomIndex = -1;
    const room = state.rooms[0];
    if (!room) throw new Error("開始部屋が無い");
    room.kind = "horde";
    // 狩場の王は BoonDef.rules（onRoomClear。部屋の種類はイベントの tag）。clearRoom と同じくイベントを積んで照合する
    pushPlayerEvent(state, "onRoomClear", "room", { tag: room.kind, source: { kind: "room", key: room.kind } });
    onBoonRoomClear(state, room);
    resolveRules(state, 0);
    expect(has(roamer, "vulnerable") && has(roamer, "fear"), "徘徊は脆弱と恐怖").toBe(true);
    expect(has(local, "vulnerable"), "部屋の敵は対象外").toBe(false);
  });

  it("織り交ぜ: 直前と違うスロットは安く、同じスロットは高い。まだ撃っていなければ等倍", () => {
    const state = cleanArena();
    state.boons = ["weave"];
    expect(slotCostMul(state, 1), "初回は等倍").toBe(1);
    onBoonSkillCast(state, 0, "mana", 0);
    expect(slotCostMul(state, 1), "別のスロット").toBeCloseTo(BOON.weaveOtherMul);
    expect(slotCostMul(state, 0), "同じスロット").toBeCloseTo(BOON.weaveSameMul);
    expect(slotCostMul(state, -1), "スロット不明は等倍").toBe(1);
  });

  it("一念: スロット 1 は安く、2〜4 は高い", () => {
    const state = cleanArena();
    state.boons = ["singleMind"];
    expect(slotCostMul(state, 0), "スロット 1").toBeCloseTo(BOON.singleMindMainMul);
    expect(slotCostMul(state, 3), "スロット 4").toBeCloseTo(BOON.singleMindOtherMul);
  });

  it("満ち溢れ: 満タン中の近接で溜め（上限つき）、次のスキルで払った分だけ返す", () => {
    const state = cleanArena();
    state.boons = ["overflowCup"];
    const p = state.player;
    const [e] = targetsOf(state);
    if (!e) throw new Error("敵が無い");
    const max = state.stats.maxMana;
    p.mana = max;
    const cap = max * BOON.overflowCapRatio;
    const hits = Math.ceil(cap / BOON.overflowPerHit) + 2;
    for (let i = 0; i < hits; i++) onBoonMeleeHitRules(state, e, false);
    expect(state.boonRun.rules.overflow, "上限で止まる").toBeCloseTo(cap);
    const paid = BOON.overflowPerHit;
    p.mana = max - paid;
    onBoonSkillCast(state, 0, "mana", paid);
    expect(p.mana, "払った分が戻る").toBeCloseTo(max);
    expect(state.boonRun.rules.overflow, "返した分だけ減る").toBeCloseTo(cap - paid);
    p.mana = 0;
    onBoonMeleeHitRules(state, e, false);
    expect(state.boonRun.rules.overflow, "満タンでなければ溜まらない").toBeCloseTo(cap - paid);
  });
});

describe("第 2 弾の祝福と既存の系譜・抽選", () => {
  it("系譜の次段は前段を持つと出る（大地の 2 段目）", () => {
    const state = cleanArena();
    const t = buildTags(state);
    expect(boonWeight(BOONS.footBreak, t.owned, [], t.gives, t.loadout), "前段なしは 0").toBe(0);
    expect(boonWeight(BOONS.footBreak, t.owned, ["leyLine"], t.gives, t.loadout), "前段ありで出る").toBeGreaterThan(0);
  });
});
