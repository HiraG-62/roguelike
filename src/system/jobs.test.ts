import { describe, expect, it } from "vitest";
import { type GameEvent, type EventInput, enemyTarget, pushEvent, pushPlayerEvent } from "../core/events";
import { createGame, step } from "../core/game";
import { FIXED_DT } from "../core/loop";
import { ReplayRecorder, createReplaySession, isReplayFinished, sanitizeReplay, stepReplay } from "../core/replay";
import { createRng, hashSeed } from "../core/rng";
import { profileKeywords } from "../core/keywords";
import type { Enemy, GameState } from "../core/state";
import { JOBS, JOB_KEYS, type JobKey, favoredMovesets } from "../data/jobs";
import { ATTR, JOB, PLAYER } from "../data/tuning";
import { baseDef } from "../loot/bases";
import { generateItem } from "../loot/generator";
import { ATTR_KEYS, DEFAULT_STATS, createEmptyProfile } from "../loot/types";
import { createDefaultSkillProfile } from "../skills/persistence";
import { QUESTS, createQuestSave, lockedJobs, questRewardLabel } from "../meta/quests";
import { ORIGINS, ORIGIN_KEYS } from "./runSetup";
import { applyJobStats, isFavoredWeapon, jobDetailLines, jobRules, ownsSkillStone, ownsWeaponBase } from "./jobs";
import { applyBoonsToStats } from "./boons";
import { collectRules, resolveRules } from "./rules";
import { applyStatus, hasStatus } from "./statusEffects";
import { arena, placeEnemy, withInput } from "./testHelpers";

/** ジョブ（src/data/jobs.ts / src/system/jobs.ts）の検査 */

const NEAR = 20;
const MID = 36;
const SEED = 21;
const PLAYABLE: readonly JobKey[] = JOB_KEYS.filter((j) => j !== "none");
/** 既定で解放されているジョブの数（見習いを除く） */
const DEFAULT_UNLOCKED = 6;
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

  it("見習い以外は語・ルール 2 つ・固有のダッシュの形・気力の源・初期スキル石を持つ", () => {
    for (const key of PLAYABLE) {
      const def = JOBS[key];
      expect(profileKeywords(def.keywords).length, `${key} の語`).toBeGreaterThan(0);
      expect(def.rules.length, `${key} のルール`).toBe(RULES_PER_JOB);
      expect(def.dash, `${key} のダッシュの形`).not.toBe("standard");
      const base = def.mana.filter((m) => m.kind === "attackHit");
      expect(base.map((m) => (m.kind === "attackHit" ? m.mul : 0)), `${key} の通常攻撃の下地`).toEqual([JOB.manaBaseMul]);
      expect(def.mana.length, `${key} の流儀の源`).toBeGreaterThan(base.length);
      expect(def.starterSkill, `${key} の初期スキル石`).not.toBeNull();
    }
  });

  it("ダッシュの形・気力の源は流儀ごとに違う（同じ形・同じ源の流儀が無い）", () => {
    const dashes = PLAYABLE.map((k) => JOBS[k].dash);
    expect(new Set(dashes).size, "ダッシュの形").toBe(dashes.length);
    const sources = PLAYABLE.map((k) => JOBS[k].mana.filter((m) => m.kind !== "attackHit").map((m) => m.kind).join("+"));
    expect(new Set(sources).size, "気力の源").toBe(sources.length);
  });

  it("見習いは既定のダッシュと通常攻撃の気力だけを持つ", () => {
    const def = JOBS.none;
    expect(def.rules).toEqual([]);
    expect(def.starterSkill).toBeNull();
    expect(def.dash).toBe("standard");
    expect(def.mana).toEqual([{ kind: "attackHit", mul: 1 }]);
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

  it("既定で 6 つ解放（陰陽師・巫女を含む）、残りは依頼の報酬で、依頼の報酬とジョブの unlockedBy が一致する", () => {
    expect(PLAYABLE.filter((k) => JOBS[k].unlockedBy === undefined).length).toBe(DEFAULT_UNLOCKED);
    expect(JOBS.onmyoji.unlockedBy, "陰陽師は既定で解放").toBeUndefined();
    expect(JOBS.miko.unlockedBy, "巫女は既定で解放").toBeUndefined();
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

  it("説明欄はステータス・ダッシュの形・気力の源・ルール・初期武器・初期スキル石を語る", () => {
    for (const key of PLAYABLE) {
      const lines = jobDetailLines(key);
      expect(lines.length, `${key} の行数`).toBe(1 + 1 + 1 + RULES_PER_JOB + 1 + 1);
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

  it("ジョブは偏り以外の数値を変えない（得意武器の倍率と弱点は流儀のダッシュ・気力に置き換えた）", () => {
    for (const job of PLAYABLE) {
      const stats = structuredClone({ ...DEFAULT_STATS, moveset: "sword" as const });
      applyJobStats(stats, job);
      const expected = structuredClone({ ...DEFAULT_STATS, moveset: "sword" as const });
      for (const k of ATTR_KEYS) expected.attributes[k] += JOBS[job].attributes[k] ?? 0;
      expect(stats, `${job} は偏りだけ`).toEqual(expected);
      expect(game(job).stats.more.some((m) => m.source.startsWith("job:")), `${job} は倍を持たない`).toBe(false);
    }
  });

  it("祝福・振り分けで畳み込み直してもジョブの偏り・倍率は二重に掛からない", () => {
    for (const job of PLAYABLE) {
      const s = game(job);
      const before = structuredClone(s.stats);
      applyBoonsToStats(s);
      applyBoonsToStats(s);
      expect(s.stats.attributes, `${job} の生値`).toEqual(before.attributes);
      expect(s.stats.maxHp, `${job} の最大生命`).toBeCloseTo(before.maxHp);
      expect(s.stats.more, `${job} の倍`).toEqual(before.more);
      expect(s.stats.increased, `${job} の増`).toEqual(before.increased);
      expect(s.stats.attackSpeedMul, `${job} の攻撃速度`).toBeCloseTo(before.attackSpeedMul);
      expect(s.stats.damageTakenMul, `${job} の被ダメ倍率`).toBeCloseTo(before.damageTakenMul);
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

  it("陰陽師: スキルが当たった敵は弱体、弱体の敵の撃破で必殺ゲージ", () => {
    const s = cleanArena("onmyoji");
    const e = placeEnemy(s, "golem", NEAR);
    fire(s, hit(e, "onSkillHit"));
    expect(hasStatus(e.status, "weaken"), "スキルの命中で弱体").toBe(true);
    const other = placeEnemy(s, "golem", MID);
    fire(s, hit(other, "onSkillHit"));
    expect(hasStatus(other.status, "weaken"), "同じ瞬間の別の敵にも付く（規則の ICD で 1 体に絞らない）").toBe(true);
    const healthy = placeEnemy(s, "slime", -NEAR);
    s.player.energy = 0;
    fire(s, { kind: "onKill", actor: "player", source: { kind: "player", key: "kill" }, ...enemyTarget(healthy, true) });
    expect(s.player.energy, "弱体でない敵の撃破では溜まらない").toBe(0);
    fire(s, { kind: "onKill", actor: "player", source: { kind: "player", key: "kill" }, ...enemyTarget(e, true) });
    expect(s.player.energy, "弱体の敵の撃破").toBeCloseTo(JOB.onmyojiKillEnergy * s.stats.energyGainMul);
  });

  it("巫女: 被弾で状態異常を 1 つ祓い、部屋の制圧で最大生命の一部を回復する", () => {
    const s = cleanArena("miko");
    applyStatus(s, { kind: "player" }, { kind: "burn", stacks: 1, duration: 5, potency: 1 }, "enemy");
    expect(hasStatus(s.player.status, "burn"), "前提: 燃えている").toBe(true);
    pushEvent(s, { kind: "onHurt", actor: "enemy", pos: { ...s.player.body.pos }, source: { kind: "enemy", key: "golem" } });
    resolveRules(s, 0, jobRules("miko"));
    expect(hasStatus(s.player.status, "burn"), "被弾で祓われる").toBe(false);
    s.player.hp = 1;
    pushPlayerEvent(s, "onRoomClear", "clear");
    resolveRules(s, 0, jobRules("miko"));
    expect(s.player.hp - 1, "最大生命の割合を回復").toBeGreaterThan(0);
    expect(s.player.hp).toBeLessThanOrEqual(1 + Math.ceil(s.player.maxHp * JOB.mikoClearHealRatio));
  });
});

describe("ジョブの初期武器", () => {
  it("初期武器は旧「得意な武器」の武器種のベースを指す（見習いは持たない）", () => {
    expect(JOBS.none.starterWeapon, "見習いは初期武器なし").toBeNull();
    for (const key of PLAYABLE) {
      const baseKey = JOBS[key].starterWeapon;
      if (baseKey === null) throw new Error(`${key} に初期武器が無い`);
      const base = baseDef(baseKey);
      expect(base?.slot, `${key} の初期武器は右手`).toBe("mainHand");
      const moveset = base?.moveset;
      if (moveset === undefined) throw new Error(`${key} の初期武器に武器種が無い`);
      expect(favoredMovesets(key), `${key} の初期武器は旧「得意な武器」の武器種`).toContain(moveset);
    }
  });

  it("初期武器は右手が空なら装着され、stats.moveset がその武器種になる", () => {
    const profile = createEmptyProfile();
    const s = createGame(SEED, String(SEED), profile, undefined, { origin: "wanderer", modifiers: [], job: "hunter" });
    const weapon = profile.equipment.mainHand;
    expect(weapon?.baseKey, "弩を装着").toBe(JOBS.hunter.starterWeapon);
    expect(weapon?.affixes, "性質なしの素の器").toEqual([]);
    expect(s.stats.moveset, "武器種が長銃になる").toBe("longarm");
    expect(isFavoredWeapon(s.stats, "hunter"), "得意武器を読む性質・祝福が効く").toBe(true);
  });

  it("右手が埋まっていれば初期武器は倉庫へ入る", () => {
    const profile = createEmptyProfile();
    const own = generateItem(createRng(1), { baseKey: "dagger", plain: true, itemLevel: 1, foundDepth: 1, now: 0 });
    profile.equipment.mainHand = own;
    createGame(SEED, String(SEED), profile, undefined, { origin: "wanderer", modifiers: [], job: "brawler" });
    expect(profile.equipment.mainHand?.id, "装備はそのまま").toBe(own.id);
    expect(profile.stash.map((it) => it.baseKey), "倉庫に手甲").toContain(JOBS.brawler.starterWeapon);
  });

  it("同じベースの武器を持っていれば初期武器を渡さない", () => {
    const profile = createEmptyProfile();
    const setup = { origin: "wanderer" as const, modifiers: [], job: "swordsman" as const };
    createGame(SEED, String(SEED), profile, undefined, setup);
    const first = profile.equipment.mainHand;
    expect(ownsWeaponBase(profile, "katana"), "1 回目で打刀を持つ").toBe(true);
    createGame(SEED + 1, String(SEED + 1), profile, undefined, setup);
    expect(profile.equipment.mainHand?.id, "2 回目は差し替えない").toBe(first?.id);
    expect(profile.stash, "倉庫にも増えない").toHaveLength(0);
  });

  it("借り物は「持っている」に数えない", () => {
    const profile = createEmptyProfile();
    const loan = generateItem(createRng(2), { baseKey: "katana", plain: true, itemLevel: 1, foundDepth: 1, now: 0 });
    loan.loaned = true;
    profile.equipment.mainHand = loan;
    expect(ownsWeaponBase(profile, "katana")).toBe(false);
  });

  it("初期武器は state.rng を消費しない（渡す前後で rng の次の値が同じ）", () => {
    const setup = { origin: "wanderer" as const, modifiers: [], job: "shadow" as const };
    const given = createGame(SEED, String(SEED), createEmptyProfile(), undefined, setup);
    const owned = createEmptyProfile();
    const baseKey = JOBS.shadow.starterWeapon;
    if (baseKey === null) throw new Error("影の初期武器が無い");
    owned.stash.push(generateItem(createRng(3), { baseKey, plain: true, itemLevel: 1, foundDepth: 1, now: 0 }));
    const skipped = createGame(SEED, String(SEED), owned, undefined, setup);
    expect(given.profile.equipment.mainHand?.baseKey, "片方だけ渡している").toBe(baseKey);
    expect(skipped.profile.equipment.mainHand, "もう片方は渡していない").toBeNull();
    expect(given.rng.next(), "乱数列がずれない").toBe(skipped.rng.next());
  });

  it("初期武器を装着したランを記録して再生すると同じ結果になる", () => {
    const seedText = "starter-weapon";
    const setup = { origin: "wanderer" as const, modifiers: [], job: "lancer" as const };
    const state = createGame(hashSeed(seedText), seedText, createEmptyProfile(), createDefaultSkillProfile(), setup);
    const recorder = ReplayRecorder.fromStartedGame({ seedText, startedAt: 1, daily: false, setup }, state);
    for (let i = 0; i < REPLAY_FRAMES; i++) step(state, recorder.record(swingInput(i)), FIXED_DT);
    const data = sanitizeReplay(JSON.parse(JSON.stringify(recorder.finish({ depth: state.depth, kills: state.kills, score: state.score }, 2))));
    if (!data) throw new Error("記録を読み戻せない");
    const session = createReplaySession(data);
    expect(session.state.stats.moveset, "再生でも初期武器の武器種").toBe("spear");
    while (!isReplayFinished(session)) stepReplay(session, FIXED_DT);
    expect(runSignature(session.state), "再生の結果が一致する").toBe(runSignature(state));
  });
});

const REPLAY_FRAMES = 900;
const SWING_EVERY = 7;
const TURN_EVERY = 120;

/** 振りと移動を混ぜた決まった入力（武器種の違いが結果に出るように） */
function swingInput(frame: number): ReturnType<typeof withInput> {
  const dir = Math.floor(frame / TURN_EVERY) % 2 === 0 ? 1 : -1;
  return withInput({ move: { x: dir, y: 0 }, attackPressed: frame % SWING_EVERY === 0 });
}

function runSignature(s: GameState): string {
  const p = s.player.body.pos;
  return [s.tick, s.depth, p.x.toFixed(4), p.y.toFixed(4), s.player.hp, s.kills, s.score, s.enemies.map((e) => `${e.id}:${e.hp}`).join(",")].join("|");
}
