import { describe, expect, it } from "vitest";
import { type GameEvent, type EventInput, enemyTarget, pushEvent, pushPlayerEvent } from "../core/events";
import { createGame } from "../core/game";
import { profileKeywords } from "../core/keywords";
import type { Enemy, GameState } from "../core/state";
import { JOBS, JOB_KEYS, type JobKey } from "../data/jobs";
import { ATTR, JOB, PLAYER } from "../data/tuning";
import { ATTR_KEYS, DEFAULT_STATS, createEmptyProfile } from "../loot/types";
import { createDefaultSkillProfile } from "../skills/persistence";
import { QUESTS, createQuestSave, lockedJobs, questRewardLabel } from "../meta/quests";
import { ORIGINS, ORIGIN_KEYS } from "./runSetup";
import { applyJobStats, isFavoredWeapon, jobDetailLines, jobRules, ownsSkillStone } from "./jobs";
import { applyBoonsToStats } from "./boons";
import { collectRules, resolveRules } from "./rules";
import { applyStatus, hasStatus } from "./statusEffects";
import { arena, placeEnemy } from "./testHelpers";

/** ジョブ（src/data/jobs.ts / src/system/jobs.ts）の検査 */

const NEAR = 20;
const MID = 36;
const SEED = 21;
const PLAYABLE: readonly JobKey[] = JOB_KEYS.filter((j) => j !== "none");
/** 既定で解放されているジョブの数（見習いを除く） */
const DEFAULT_UNLOCKED = 4;
/** 得意な武器種の数の範囲 */
const FAVORED_MIN = 2;
const FAVORED_MAX = 3;
const RULES_PER_JOB = 2;

function game(job: JobKey, seed = SEED): GameState {
  return createGame(seed, String(seed), createEmptyProfile(), undefined, { origin: "wanderer", modifiers: [], job });
}

/** createGame の床組みで積まれたイベントを捨てた、敵のいない部屋 */
function cleanArena(job: JobKey): GameState {
  const state = arena();
  state.job = job;
  for (const r of state.rooms) r.locked = false;
  state.events = [];
  state.pendingEvents = [];
  return state;
}

/** そのジョブの Rule だけで照合する */
function fire(state: GameState, input: EventInput): void {
  pushEvent(state, input);
  resolveRules(state, 0, jobRules(state.job));
}

function hit(e: Enemy, kind: GameEvent["kind"]): EventInput {
  return { kind, actor: "player", source: { kind: "player", key: "test" }, ...enemyTarget(e) };
}

function poiseTaken(e: Enemy): boolean {
  return e.poise.damage > 0 || hasStatus(e.status, "stagger");
}

describe("ジョブの定義", () => {
  it("見習いのほかに 8 種以上あり、名前は重ならず起点の名前ともぶつからない", () => {
    expect(PLAYABLE.length, "8 種以上").toBeGreaterThanOrEqual(8);
    const names = JOB_KEYS.map((k) => JOBS[k].name);
    expect(new Set(names).size, "ジョブ名が重ならない").toBe(names.length);
    const originNames = new Set(ORIGIN_KEYS.map((o) => ORIGINS[o].name));
    for (const n of names) expect(originNames.has(n), `${n} が起点と同名`).toBe(false);
  });

  it("見習い以外は語・ルール 2 つ・得意な武器種・初期スキル石・弱点を持つ", () => {
    for (const key of PLAYABLE) {
      const def = JOBS[key];
      expect(profileKeywords(def.keywords).length, `${key} の語`).toBeGreaterThan(0);
      expect(def.rules.length, `${key} のルール`).toBe(RULES_PER_JOB);
      expect(def.favored.length, `${key} の得意な武器種`).toBeGreaterThanOrEqual(FAVORED_MIN);
      expect(def.favored.length, `${key} の得意な武器種`).toBeLessThanOrEqual(FAVORED_MAX);
      expect(def.starterSkill, `${key} の初期スキル石`).not.toBeNull();
      expect(def.weakness, `${key} の弱点`).not.toBeNull();
    }
  });

  it("見習いは何も持たない", () => {
    const def = JOBS.none;
    expect(def.rules).toEqual([]);
    expect(def.starterSkill).toBeNull();
    expect(def.weakness).toBeNull();
    expect(def.unlockedBy).toBeUndefined();
  });

  it("ステータスの偏りの合計は 0（伸ばしたぶんどこかが下がる）", () => {
    for (const key of JOB_KEYS) {
      const attrs = JOBS[key].attributes;
      const sum = ATTR_KEYS.reduce((n, k) => n + (attrs[k] ?? 0), 0);
      expect(sum, `${key} の偏りの合計`).toBe(0);
    }
  });

  it("Rule の id はすべて異なる", () => {
    const ids = PLAYABLE.flatMap((k) => jobRules(k).map((r) => r.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("既定で 4 つ解放、残りは依頼の報酬で、依頼の報酬とジョブの unlockedBy が一致する", () => {
    expect(PLAYABLE.filter((k) => JOBS[k].unlockedBy === undefined).length).toBe(DEFAULT_UNLOCKED);
    for (const key of PLAYABLE) {
      const by = JOBS[key].unlockedBy;
      if (by === undefined) continue;
      const reward = QUESTS[by].reward;
      expect(reward.kind === "job" && reward.job === key, `${key} を解放する依頼「${by}」の報酬`).toBe(true);
    }
  });

  it("依頼を達成するとジョブが解放され、報酬の表示はジョブ名を語る", () => {
    const save = createQuestSave();
    const locked = lockedJobs(save);
    expect(locked.size, "既定で閉じているジョブ").toBe(PLAYABLE.length - DEFAULT_UNLOCKED);
    expect(locked.has("none"), "見習いは常に選べる").toBe(false);
    save.completed.critStorm = 1;
    expect(lockedJobs(save).has("lancer"), "槍兵が解放").toBe(false);
    expect(questRewardLabel(QUESTS.critStorm.reward)).toContain(JOBS.lancer.name);
  });

  it("説明欄はステータス・得意な武器・ルール・初期スキル石・弱点を語る", () => {
    for (const key of PLAYABLE) {
      const lines = jobDetailLines(key);
      expect(lines.length, `${key} の行数`).toBe(1 + 1 + RULES_PER_JOB + 1 + 1);
    }
    expect(jobDetailLines("none"), "見習いは詳細なし").toEqual([]);
  });
});

describe("ジョブの適用", () => {
  it("見習いは stats を変えない（ジョブ指定なしと同じ）", () => {
    const a = game("none");
    const b = createGame(SEED, String(SEED), createEmptyProfile());
    expect(a.job).toBe("none");
    expect(a.stats).toEqual(b.stats);
    expect(a.skills.floorStones.length, "石も置かない").toBe(b.skills.floorStones.length);
  });

  it("ステータスの偏りが生値に乗る", () => {
    const s = game("swordsman");
    for (const k of ATTR_KEYS) {
      expect(s.stats.attributes[k], `${k}`).toBe(ATTR.base + (JOBS.swordsman.attributes[k] ?? 0));
    }
  });

  it("弱点の倍率が掛かる（体力の偏りによる増減は後の派生で乗る）", () => {
    const hunter = structuredClone(DEFAULT_STATS);
    applyJobStats(hunter, "hunter");
    expect(hunter.maxHp).toBeCloseTo(DEFAULT_STATS.maxHp * JOB.hunterHpMul);
    expect(game("hunter").stats.maxHp, "ラン開始時にも弱い").toBeLessThan(game("none").stats.maxHp);
    const plain = game("none");
    expect(game("swordsman").stats.rangedDamageMul).toBeCloseTo(plain.stats.rangedDamageMul * JOB.swordsmanRangedMul);
  });

  it("得意な武器種を持つ間だけ近接の威力と攻撃速度が上がる", () => {
    const favored = structuredClone({ ...DEFAULT_STATS, moveset: "sword" as const });
    const other = structuredClone({ ...DEFAULT_STATS, moveset: "wand" as const });
    expect(isFavoredWeapon(favored, "swordsman")).toBe(true);
    expect(isFavoredWeapon(other, "swordsman")).toBe(false);
    applyJobStats(favored, "swordsman");
    applyJobStats(other, "swordsman");
    expect(favored.meleeDamageMul).toBeCloseTo(DEFAULT_STATS.meleeDamageMul * JOB.favoredMeleeMul);
    expect(favored.attackSpeedMul).toBeCloseTo(DEFAULT_STATS.attackSpeedMul * JOB.favoredAttackSpeedMul);
    expect(other.meleeDamageMul, "得意でなければ等倍").toBeCloseTo(DEFAULT_STATS.meleeDamageMul);
  });

  it("祝福・振り分けで畳み込み直してもジョブの偏り・倍率は二重に掛からない", () => {
    for (const job of PLAYABLE) {
      const s = game(job);
      const before = structuredClone(s.stats);
      applyBoonsToStats(s);
      applyBoonsToStats(s);
      expect(s.stats.attributes, `${job} の生値`).toEqual(before.attributes);
      expect(s.stats.maxHp, `${job} の最大生命`).toBeCloseTo(before.maxHp);
      expect(s.stats.meleeDamageMul, `${job} の近接倍率`).toBeCloseTo(before.meleeDamageMul);
      expect(s.stats.attackSpeedMul, `${job} の攻撃速度`).toBeCloseTo(before.attackSpeedMul);
      expect(s.stats.rangedDamageMul, `${job} の射撃倍率`).toBeCloseTo(before.rangedDamageMul);
    }
  });

  it("起点・縛りの最大生命の倍率も畳み込み直しで重ならない（詠み手・薄氷）", () => {
    const s = createGame(SEED, String(SEED), createEmptyProfile(), undefined, { origin: "chanter", modifiers: ["glassBody"], job: "hunter" });
    const maxHp = s.stats.maxHp;
    applyBoonsToStats(s);
    expect(s.stats.maxHp).toBeCloseTo(maxHp);
  });

  it("初期スキル石は未所持のときだけ倉庫に加わり、2 回始めても増えない", () => {
    const profile = createEmptyProfile();
    const skills = createDefaultSkillProfile();
    const key = JOBS.hunter.starterSkill;
    if (key === null) throw new Error("狩人の初期スキル石が無い");
    expect(ownsSkillStone(skills, key), "最初は持っていない").toBe(false);
    const before = skills.stones.length;
    const setup = { origin: "wanderer" as const, modifiers: [], job: "hunter" as const };
    const a = createGame(SEED, String(SEED), profile, skills, setup);
    expect(skills.stones.length, "1 つ加わる").toBe(before + 1);
    expect(skills.stones.at(-1)?.links).toBe(JOB.starterStoneLinks);
    expect(a.skills.floorStones.some((fs) => fs.stone.skillKey === key), "床には置かない").toBe(false);
    createGame(SEED + 1, String(SEED + 1), profile, skills, setup);
    expect(skills.stones.length, "2 回目は増えない").toBe(before + 1);
  });

  it("見習いは石を加えない", () => {
    const skills = createDefaultSkillProfile();
    const before = skills.stones.length;
    createGame(SEED, String(SEED), createEmptyProfile(), skills, { origin: "wanderer", modifiers: [], job: "none" });
    expect(skills.stones.length).toBe(before);
  });

  it("ジョブの Rule が collectRules に入る（祝福より前）", () => {
    const s = game("brawler");
    const ids = collectRules(s).map((r) => r.id);
    const own = jobRules("brawler").map((r) => r.id);
    expect(ids.slice(0, own.length)).toEqual(own);
    expect(collectRules(game("none")).some((r) => r.id.includes("job.")), "見習いは無し").toBe(false);
  });
});

describe("ジョブのルールが発火する", () => {
  it("剣士: 終撃の命中で怯み値、見切りでダメージの強化", () => {
    const s = cleanArena("swordsman");
    const e = placeEnemy(s, "golem", NEAR);
    s.player.attack.combo = 0;
    fire(s, hit(e, "onMeleeHit"));
    expect(poiseTaken(e), "終撃でなければ乗らない").toBe(false);
    s.player.attack.combo = PLAYER.melee.length - 1;
    fire(s, hit(e, "onMeleeHit"));
    expect(poiseTaken(e), "終撃で怯み値").toBe(true);
    const before = s.player.buffs.damage.time;
    pushPlayerEvent(s, "onJustDodge", "just");
    resolveRules(s, 0, jobRules("swordsman"));
    expect(s.player.buffs.damage.time).toBeGreaterThan(before);
  });

  it("狩人: 予備動作中の敵への射撃で怯み値、精鋭への射撃で脆弱", () => {
    const s = cleanArena("hunter");
    const e = placeEnemy(s, "golem", NEAR);
    e.phase = "windup";
    fire(s, hit(e, "onRangedHit"));
    expect(poiseTaken(e)).toBe(true);
    const elite = placeEnemy(s, "golem", -MID);
    fire(s, hit(elite, "onRangedHit"));
    expect(hasStatus(elite.status, "vulnerable"), "精鋭でなければ付かない").toBe(false);
    elite.elite = "shielded";
    fire(s, hit(elite, "onRangedHit"));
    expect(hasStatus(elite.status, "vulnerable")).toBe(true);
  });

  it("拳闘士: 近接の N 回目で衝撃波、被弾でダメージの強化", () => {
    const s = cleanArena("brawler");
    const e = placeEnemy(s, "golem", NEAR);
    s.player.meleeHitCount = JOB.brawlerEveryHits - 1;
    fire(s, hit(e, "onMeleeHit"));
    expect(e.hp, "N 回目でなければ出ない").toBe(e.maxHp);
    s.player.meleeHitCount = JOB.brawlerEveryHits;
    fire(s, hit(e, "onMeleeHit"));
    expect(e.hp).toBeLessThan(e.maxHp);
    pushEvent(s, { kind: "onHurt", actor: "enemy", pos: { ...s.player.body.pos }, source: { kind: "enemy", key: "golem" } });
    resolveRules(s, 0, jobRules("brawler"));
    expect(s.player.buffs.damage.time).toBeGreaterThan(0);
  });

  it("盾持ち: 被弾で短い無敵、カウンターで衝撃波", () => {
    const s = cleanArena("shieldBearer");
    pushEvent(s, { kind: "onHurt", actor: "enemy", pos: { ...s.player.body.pos }, source: { kind: "enemy", key: "golem" } });
    resolveRules(s, 0, jobRules("shieldBearer"));
    expect(s.player.buffs.invuln).toBeGreaterThan(0);
    const e = placeEnemy(s, "golem", NEAR);
    fire(s, hit(e, "onCounter"));
    expect(e.hp).toBeLessThan(e.maxHp);
  });

  it("呪術師: 状態異常を付けると気力、毒の敵を倒すと毒が広がる", () => {
    const s = cleanArena("hexer");
    const e = placeEnemy(s, "golem", NEAR);
    s.player.mana = 0;
    fire(s, { ...hit(e, "onStatusApplied"), tag: "burn" });
    expect(s.player.mana).toBeGreaterThan(0);
    const dying = placeEnemy(s, "slime", NEAR);
    const near = placeEnemy(s, "golem", MID);
    applyStatus(s, { kind: "enemy", enemy: dying }, { kind: "poison", stacks: 1, duration: 3, potency: 0.02 }, "player");
    dying.hp = 0;
    s.events = [];
    fire(s, { kind: "onKill", actor: "player", source: { kind: "player", key: "kill" }, ...enemyTarget(dying, true) });
    expect(hasStatus(near.status, "poison")).toBe(true);
  });

  it("槍兵: 堅守の敵への近接で怯み値、怯ませると必殺ゲージ", () => {
    const s = cleanArena("lancer");
    const e = placeEnemy(s, "golem", NEAR);
    fire(s, hit(e, "onMeleeHit"));
    expect(poiseTaken(e), "堅守でなければ乗らない").toBe(false);
    applyStatus(s, { kind: "enemy", enemy: e }, { kind: "guarded", stacks: 1, duration: 3, potency: 0 }, "env");
    fire(s, hit(e, "onMeleeHit"));
    expect(poiseTaken(e)).toBe(true);
    s.player.energy = 0;
    fire(s, hit(e, "onStagger"));
    expect(s.player.energy).toBeGreaterThan(0);
  });

  it("術士: スキル発動でダメージの強化、気力が少ないときの撃破で気力", () => {
    const s = cleanArena("invoker");
    pushPlayerEvent(s, "onSkillCast", "skill");
    resolveRules(s, 0, jobRules("invoker"));
    expect(s.player.buffs.damage.time).toBeGreaterThan(0);
    const e = placeEnemy(s, "slime", NEAR);
    s.player.mana = 0;
    fire(s, { kind: "onKill", actor: "player", source: { kind: "player", key: "kill" }, ...enemyTarget(e, true) });
    expect(s.player.mana).toBeGreaterThan(0);
  });

  it("影: ダッシュ直後の近接で脆弱、見切りで加速", () => {
    const s = cleanArena("shadow");
    const e = placeEnemy(s, "golem", NEAR);
    fire(s, hit(e, "onMeleeHit"));
    expect(hasStatus(e.status, "vulnerable"), "ダッシュ直後でなければ付かない").toBe(false);
    pushPlayerEvent(s, "onDashEnd", "dash");
    fire(s, hit(e, "onMeleeHit"));
    expect(hasStatus(e.status, "vulnerable")).toBe(true);
    pushPlayerEvent(s, "onJustDodge", "just");
    resolveRules(s, 0, jobRules("shadow"));
    expect(s.player.buffs.speed.time).toBeGreaterThan(0);
  });

  it("錬金術師: 反応で必殺ゲージ、状態異常の重なった敵の撃破で爆発", () => {
    const s = cleanArena("alchemist");
    const e = placeEnemy(s, "golem", NEAR);
    s.player.energy = 0;
    fire(s, { ...hit(e, "onReaction"), tag: "vaporize" });
    expect(s.player.energy).toBeGreaterThan(0);
    const near = placeEnemy(s, "golem", MID);
    applyStatus(s, { kind: "enemy", enemy: e }, { kind: "poison", stacks: 1, duration: 3, potency: 0.02 }, "player");
    applyStatus(s, { kind: "enemy", enemy: e }, { kind: "bleed", stacks: 1, duration: 3, potency: 1 }, "player");
    s.events = [];
    fire(s, { kind: "onKill", actor: "player", source: { kind: "player", key: "kill" }, ...enemyTarget(e, true) });
    expect(near.hp).toBeLessThan(near.maxHp);
  });
});
