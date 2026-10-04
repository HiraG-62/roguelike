import { describe, expect, it } from "vitest";
import { createGame, step } from "../core/game";
import type { GameState, HiddenRoom, Merchant, Ware, WareKind } from "../core/state";
import { ULTIMATES } from "../data/ultimates";
import { PICKUP } from "../data/tuning";
import { placeEnemy, arena, slayFloorLord, withInput } from "../system/testHelpers";
import { ringsInFlight } from "../system/projectiles";
import { resolveSlot } from "../system/skills";
import { MOVESETS, type MovesetKey } from "../data/weapons";
import { magazineView } from "../system/magazine";
import { isDashing } from "../system/player";
import type { BoonGrade } from "../system/boonGrade";
import { BOONS, BOON_KEYS, type BoonChoice, type BoonKey } from "../system/boons";
import {
  HIDDEN_DOOR_GIVE_UP,
  autoAttachHand,
  botInput,
  chooseTargetRoomIndex,
  createBotState,
  crossesPit,
  gunNeedsMana,
  nearestEngagedEnemy,
  pickBoonIndex,
  shouldDrinkFlask,
  shouldPressUltimate,
  worldToScreen,
} from "./bot";
import { TILE_SIZE, Tile, toIndex } from "../map/grid";
import { invalidatePathing } from "../map/pathing";
import { isZero } from "../core/vec";
import { buildFloor } from "../system/floor";
import { planHidden } from "../system/hiddenRoom";
import { setupFloorLordRoom } from "../system/floorLord";

/** bot が待ち終えた後の提示時間（BOON_CHOICE_WAIT 0.5 秒より長く） */
const WAITED = 1;

function choiceOf(options: BoonKey[], grades: BoonGrade[]): BoonChoice {
  return { options, hover: -1, curseHover: false, timer: WAITED, curseTaken: false, curse: null, grades };
}

const clean = BOON_KEYS.filter((k) => !BOONS[k].cursed);
const cursed = BOON_KEYS.filter((k) => BOONS[k].cursed);

function key(list: readonly BoonKey[], i: number): BoonKey {
  const k = list[i];
  if (k === undefined) throw new Error("祝福が足りない");
  return k;
}

describe("bot の祝福の選び方", () => {
  it("bot は格の高い札を選ぶ", () => {
    const options = [key(clean, 0), key(clean, 1), key(clean, 2)];
    expect(pickBoonIndex(choiceOf(options, [1, 3, 2])), "神威の札").toBe(1);
    expect(pickBoonIndex(choiceOf(options, [1, 1, 2])), "大祝福の札").toBe(2);
    expect(pickBoonIndex(choiceOf(options, [1, 1, 1])), "同じ格なら前の札").toBe(0);
  });

  it("呪い付きの札は格が高くても選ばない", () => {
    const options = [key(clean, 0), key(cursed, 0), key(clean, 1)];
    expect(pickBoonIndex(choiceOf(options, [1, 3, 2])), "呪いでない方の最上位").toBe(2);
    const allCursed = [key(cursed, 0), key(cursed, 1), key(cursed, 2)];
    expect(pickBoonIndex(choiceOf(allCursed, [1, 1, 1])), "呪い付きしか無ければ 1 枚目").toBe(0);
  });

  it("格の無い提示（grades 省略）では呪いでない最初の札", () => {
    const options = [key(cursed, 0), key(clean, 0), key(clean, 1)];
    const choice: BoonChoice = { options, hover: -1, curseHover: false, timer: WAITED, curseTaken: false, curse: null };
    expect(pickBoonIndex(choice), "2 枚目").toBe(1);
  });

  it("選んだ札に対応するキーを押す", () => {
    const state = createGame(1);
    state.boonChoice = choiceOf([key(clean, 0), key(clean, 1), key(clean, 2)], [1, 1, 3]);
    const input = botInput(state, createBotState(1), 1 / 60);
    expect(input.attackPressed, "3 枚目は攻撃のキー").toBe(true);
    expect(input.skill1Pressed || input.skill2Pressed, "他の札のキーは押さない").toBe(false);
  });
});

const DT = 1 / 60;
/** 回避の危険距離（55px）より外で、奥義の距離（8m = 80px）より内 */
const NEAR_ENEMY_DX = 70;
/** 奥義の距離（8m）より外 */
const FAR_ENEMY_DX = 120;
/** 殴り続けても倒れない・倒されない体力 */
const ENDLESS_HP = 1e9;

/** 開始部屋で追ってくる敵 1 体と向き合う（互いに倒れない。待機中の敵は bot が交戦相手に選ばないので追跡にする） */
function facingEnemy(dx: number): GameState {
  const state = arena(3);
  const e = placeEnemy(state, "slime", dx);
  e.phase = "chase";
  e.hp = ENDLESS_HP;
  e.maxHp = ENDLESS_HP;
  state.player.hp = ENDLESS_HP;
  state.player.maxHp = ENDLESS_HP;
  return state;
}

function fullGauge(state: GameState): void {
  state.player.energy = state.player.maxEnergy;
}

describe("bot の奥義", () => {
  it("bot は奥義ゲージが満タンなら敵の近くで F を押す", () => {
    const state = facingEnemy(NEAR_ENEMY_DX);
    fullGauge(state);
    expect(botInput(state, createBotState(1), DT).specialPressed, "満タン・8m 以内なら押す").toBe(true);
  });

  it("ゲージが満タンでない・敵が 8m より遠いときは F を押さない", () => {
    const half = facingEnemy(NEAR_ENEMY_DX);
    half.player.energy = half.player.maxEnergy / 2;
    expect(botInput(half, createBotState(1), DT).specialPressed, "ゲージが半分").toBe(false);
    const far = facingEnemy(FAR_ENEMY_DX);
    fullGauge(far);
    expect(botInput(far, createBotState(1), DT).specialPressed, "敵が 8m より遠い").toBe(false);
  });

  it("持続の奥義の間は F を押さず、ゲージが減るのを待つ（押し直すと終わるため）", () => {
    const state = facingEnemy(NEAR_ENEMY_DX);
    const sustain = Object.values(ULTIMATES).flat().find((u) => u.kind === "sustain");
    expect(sustain, "持続の奥義がある").toBeDefined();
    fullGauge(state);
    state.player.ultimate.active = sustain?.key ?? null;
    expect(shouldPressUltimate(state, NEAR_ENEMY_DX), "持続中").toBe(false);
  });

  it("bot に任せると満タンのゲージで奥義が出てゲージが減る", () => {
    const state = facingEnemy(NEAR_ENEMY_DX);
    fullGauge(state);
    const bot = createBotState(1);
    const before = state.player.energy;
    step(state, botInput(state, bot, DT), DT);
    const used = state.player.energy < before || state.player.ultimate.active !== null;
    expect(used, "一撃ならゲージが 0、持続なら持続中").toBe(true);
  });
});

describe("bot の左右の連撃", () => {
  it("bot は近接なら左右を混ぜた列で連撃を出し、名前付き派生を踏む", () => {
    const state = facingEnemy(20);
    const bot = createBotState(2);
    let right = false;
    let branch = false;
    const FRAMES = 60 * 30;
    for (let i = 0; i < FRAMES && !(right && branch); i++) {
      step(state, botInput(state, bot, DT), DT);
      const a = state.player.attack;
      if (a.phase !== "none" && a.lane === "secondary") right = true;
      if (a.branch >= 0) branch = true;
    }
    expect(right, "右の段を振った").toBe(true);
    expect(branch, "名前付き派生を踏んだ").toBe(true);
  });
});

describe("bot の銃の寄り（弾の命中で気力が戻らない。gun-bases-review 0-2）", () => {
  /** 敵に寄った間合い（MELEE_RANGE 30px より内） */
  const CLOSE_DX = 20;

  function gunFacing(): GameState {
    const state = facingEnemy(CLOSE_DX);
    state.stats = { ...state.stats, moveset: "cannon" };
    return state;
  }

  /** 気力を払うスキルの装着枠（無ければテストの前提が崩れている） */
  function manaSlot(state: GameState): number {
    const i = [0, 1, 2, 3].find((k) => resolveSlot(state, k)?.def.resource === "mana");
    if (i === undefined) throw new Error("気力のスキルが装着されていない");
    return i;
  }

  it("銃で気力が足りなければ気力が要ると見る。足りていれば・近接の武器種なら見ない", () => {
    const state = gunFacing();
    manaSlot(state);
    state.player.mana = 0;
    expect(gunNeedsMana(state, MOVESETS.cannon), "気力 0 の砲").toBe(true);
    state.player.mana = state.stats.maxMana;
    expect(gunNeedsMana(state, MOVESETS.cannon), "気力が満ちた砲").toBe(false);
    state.player.mana = 0;
    expect(gunNeedsMana(state, MOVESETS.sword), "剣は銃の寄りをしない").toBe(false);
  });

  it("気力が足りない銃は近接の射程で左を撃たず、右の近接を振る", () => {
    const state = gunFacing();
    manaSlot(state);
    const bot = createBotState(4);
    let right = false;
    const FRAMES = 60 * 3;
    for (let i = 0; i < FRAMES && !right; i++) {
      state.player.mana = 0;
      const input = botInput(state, bot, DT);
      expect(input.attackHeld, `${i} フレーム目: 左を押さない`).toBe(false);
      step(state, input, DT);
      const a = state.player.attack;
      if (a.phase !== "none" && a.lane === "secondary") right = true;
    }
    expect(right, "右の段を振った").toBe(true);
  });
});

describe("bot の戦輪（投げた輪が戻るまで待つ）", () => {
  function ringFacing(): GameState {
    const state = facingEnemy(60);
    state.stats = { ...state.stats, moveset: "ringBlades", bullet: "ringBlades" };
    return state;
  }

  it("輪が飛んでいる間は左も右も押さず、戻ったら連撃を出す", () => {
    const state = ringFacing();
    const bot = createBotState(6);
    let thrown = false;
    let waited = 0;
    let swung = false;
    // 戦輪の弧が大きく、輪が飛んでいる時間が長いので、戻ってから寄って振る機会が来るまで長めに回す
    const FRAMES = 60 * 20;
    for (let i = 0; i < FRAMES && !swung; i++) {
      const flying = ringsInFlight(state);
      const input = botInput(state, bot, DT);
      if (flying && state.player.attack.phase === "none") {
        thrown = true;
        waited += 1;
        // 受け流し・回避の入力を除いて、攻撃の入力は出さない
        if (!input.dashPressed && !input.parryPressed) expect(input.attackHeld || input.shootHeld, `${i} フレーム目: 戻るまで押さない`).toBe(false);
      }
      step(state, input, DT);
      if (thrown && !ringsInFlight(state) && state.player.attack.phase !== "none") swung = true;
    }
    expect(thrown, "輪を投げた").toBe(true);
    expect(waited, "戻りを待った").toBeGreaterThan(0);
    expect(swung, "戻ってから振った").toBe(true);
  });
});

describe("bot の隠し部屋", () => {
  /** rng.chance を強制的に true にして隠し部屋を計画させる（抽選自体は planHiddenRoom のまま） */
  function forceHidden(state: GameState): HiddenRoom {
    state.hiddenRoom = null;
    state.rng = { ...state.rng, chance: () => true };
    planHidden(state);
    const hr = state.hiddenRoom;
    if (!hr) throw new Error("隠し部屋が計画されなかった（テストの前提が崩れている）");
    return hr;
  }

  /** 隠し部屋のある rooms 型の階（HIDDEN_ROOM.minDepth 以上・ボス階を避ける）。手がかりは立てておく */
  function hiddenFloor(seed: number): GameState {
    const state = arena(seed);
    state.depth = 3;
    buildFloor(state, "rooms");
    forceHidden(state).hinted = true;
    return state;
  }

  it("手がかりの出た扉へ動き、届かないまま上限秒を超えたら諦める（壁に押し当て続けて止まらない）", () => {
    const state = hiddenFloor(9);
    const bot = createBotState(1);
    const first = botInput(state, bot, 1);
    expect(isZero(first.move), "扉へ向かって動く").toBe(false);
    expect(bot.hiddenDoorTime).toBeGreaterThan(0);
    // state を進めないので扉は開かない。追った秒が上限を超えたら以後は数えない（= 扉を追わない）
    for (let i = 0; i < HIDDEN_DOOR_GIVE_UP * 2; i++) botInput(state, bot, 1);
    expect(bot.hiddenDoorTime).toBeLessThanOrEqual(HIDDEN_DOOR_GIVE_UP + 1);
  });
});

describe("bot の瓶", () => {
  function withHpRatio(state: GameState, ratio: number): void {
    state.player.hp = state.player.maxHp * ratio;
  }

  it("瓶が 1 本以上で生命が 40% 以下なら飲む（ちょうど 40% は飲み、超えれば飲まない）", () => {
    const state = arena(4);
    state.player.flasks = 1;
    withHpRatio(state, 0.4);
    expect(botInput(state, createBotState(1), DT).flaskPressed, "40% で飲む").toBe(true);
    withHpRatio(state, 0.41);
    expect(botInput(state, createBotState(1), DT).flaskPressed, "41% では飲まない").toBe(false);
  });

  it("瓶が 0 本なら生命が低くても押さない", () => {
    const state = arena(4);
    state.player.flasks = 0;
    withHpRatio(state, 0.1);
    expect(shouldDrinkFlask(state), "0 本").toBe(false);
    expect(botInput(state, createBotState(1), DT).flaskPressed).toBe(false);
  });

  it("交戦中でも低 HP なら攻撃の入力に重ねて飲む", () => {
    const state = arena(4);
    placeEnemy(state, "slime", 20).phase = "chase";
    state.player.flasks = 2;
    withHpRatio(state, 0.2);
    const input = botInput(state, createBotState(1), DT);
    expect(input.flaskPressed, "戦闘の入力にも重なる").toBe(true);
    expect(isZero(input.move) && !input.attackPressed && !input.attackHeld && !input.shootHeld && !input.dashPressed, "戦闘の入力そのものは残る").toBe(false);
  });
});

describe("bot の市", () => {
  const WARE_OFFSET = 40;

  function ware(state: GameState, kind: WareKind, price: number, dx = WARE_OFFSET): Ware {
    const p = state.player.body.pos;
    return { kind, key: kind, price, base: price, pos: { x: p.x + dx, y: p.y }, used: false };
  }

  function stand(state: GameState, wares: Ware[], provoked = false): void {
    const merchant: Merchant = { enemyId: -1, kind: "market", pos: { ...state.player.body.pos }, wares, greeted: false, provoked, rerolls: 0 };
    state.economy.merchants = [merchant];
  }

  it("瓶が上限未満で払えるなら瓶の台座へ寄り、手が届けば照準を合わせてインタラクトし、その台座は済ませたことにして探索へ戻る", () => {
    const state = arena(4);
    state.player.flasks = 0;
    state.economy.coins = 100;
    const target = ware(state, "flask", 40, 0);
    stand(state, [target]);
    const bot = createBotState(1);
    const press = botInput(state, bot, DT);
    expect(bot.marketTime, "台座を追った").toBeGreaterThan(0);
    expect(press.interactPressed, "手の届く台座でインタラクトを押す").toBe(true);
    expect(press.aimScreen, "照準は台座").toEqual(worldToScreen(state, target.pos));
    expect(bot.triedWares.has(target), "押した台座は済ませた").toBe(true);
    const before = bot.marketTime;
    botInput(state, bot, DT);
    expect(bot.marketTime, "済んだ台座には寄り続けない").toBe(before);
  });

  it("手の届かない台座ではインタラクトを押さず、歩いて寄る", () => {
    const state = arena(4);
    state.player.flasks = 0;
    state.economy.coins = 100;
    const target = ware(state, "flask", 40, PICKUP.reach * 2);
    stand(state, [target]);
    const bot = createBotState(1);
    const input = botInput(state, bot, DT);
    expect(input.interactPressed, "遠い台座では押さない").toBe(false);
    expect(bot.triedWares.has(target), "まだ済ませていない").toBe(false);
    expect(bot.marketTime, "台座を追っている").toBeGreaterThan(0);
  });

  it("払えない・瓶が上限・瓶以外の台座には寄らない（他は買わない）", () => {
    const poor = arena(4);
    poor.player.flasks = 0;
    poor.economy.coins = 39;
    stand(poor, [ware(poor, "flask", 40)]);
    const poorBot = createBotState(1);
    botInput(poor, poorBot, DT);
    expect(poorBot.marketTime, "銭が足りなければ寄らない").toBe(0);

    const full = arena(4);
    full.economy.coins = 100;
    full.player.flasks = full.stats.flaskMax;
    stand(full, [ware(full, "flask", 40)]);
    const fullBot = createBotState(1);
    botInput(full, fullBot, DT);
    expect(fullBot.marketTime, "瓶が上限なら寄らない").toBe(0);

    const other = arena(4);
    other.player.flasks = 0;
    other.economy.coins = 500;
    stand(other, [ware(other, "item", 70), ware(other, "rune", 50), ware(other, "key", 30)]);
    const otherBot = createBotState(1);
    botInput(other, otherBot, DT);
    expect(otherBot.marketTime, "瓶以外の台座には寄らない").toBe(0);
  });

  it("怒った商人の台座には寄らない（売らないので）", () => {
    const state = arena(4);
    state.player.flasks = 0;
    state.economy.coins = 100;
    stand(state, [ware(state, "flask", 40)], true);
    const bot = createBotState(1);
    botInput(state, bot, DT);
    expect(bot.marketTime, "怒った商人").toBe(0);
  });

  it("買われて used になった台座には寄らず、寄り道の秒の上限を超えたら諦める", () => {
    const sold = arena(4);
    sold.player.flasks = 0;
    sold.economy.coins = 100;
    const w = ware(sold, "flask", 40);
    w.used = true;
    stand(sold, [w]);
    const soldBot = createBotState(1);
    botInput(sold, soldBot, DT);
    expect(soldBot.marketTime, "used の台座は対象外").toBe(0);

    const far = arena(4);
    far.player.flasks = 0;
    far.economy.coins = 100;
    stand(far, [ware(far, "flask", 40, 5000)]);
    const bot = createBotState(1);
    for (let i = 0; i < 100; i++) botInput(far, bot, 1);
    expect(bot.marketTime, "追った秒は上限を少し超えたところで止まる").toBeLessThanOrEqual(31 + 1);
  });
});

describe("bot の進み方（封鎖の部屋 → 階の主 → 階段）", () => {
  /** 階の主がいて、封鎖中の部屋は無い盤面（階段は主を倒すまで現れないので、全部屋を掃除して待つ bot は進めない） */
  function lordFloor(seed: number): GameState {
    const state = arena(seed);
    state.rooms.forEach((room) => {
      room.locked = false;
    });
    // arena は敵を空にするので、主は置き直す（slayFloorLord が倒せるよう敵としても立てる）
    state.boss = null;
    setupFloorLordRoom(state, state.rooms.length - 1);
    return state;
  }

  it("封鎖中の部屋を最優先で目標にする（主の部屋より先）", () => {
    const state = lordFloor(3);
    expect(state.boss, "前提: 階の主がいる").not.toBeNull();
    const lockedIndex = 0;
    expect(state.boss?.roomIndex, "前提: 封鎖する部屋は主の部屋と別").not.toBe(lockedIndex);
    const room = state.rooms[lockedIndex];
    if (!room) throw new Error("部屋が無い");
    room.locked = true;
    expect(chooseTargetRoomIndex(state, createBotState(1)), "封鎖中の部屋").toBe(lockedIndex);
  });

  it("主が生きている間は主の部屋を目標にする（未制圧の近い部屋は後回し）", () => {
    const state = lordFloor(3);
    const boss = state.boss;
    if (!boss) throw new Error("階の主がいない");
    expect(boss.defeated, "前提: 主は未撃破").toBe(false);
    const bot = createBotState(1);
    expect(chooseTargetRoomIndex(state, bot), "主の部屋").toBe(boss.roomIndex);
    expect(bot.targetRoomIndex, "bot の目標にも残る").toBe(boss.roomIndex);
  });

  it("主を倒した後は階段へ向かう（目標の部屋が null）", () => {
    const state = lordFloor(3);
    slayFloorLord(state);
    expect(state.boss?.defeated, "前提: 主を倒した").toBe(true);
    state.rooms.forEach((room) => {
      room.locked = false;
    });
    const bot = createBotState(1);
    bot.targetRoomIndex = state.boss?.roomIndex ?? null;
    expect(chooseTargetRoomIndex(state, bot), "階段へ").toBeNull();
    expect(bot.targetRoomIndex, "覚えていた目標も捨てる").toBeNull();
  });
});

describe("bot は閉じた扉の向こうを追わない", () => {
  const ENEMY_DX = 70;
  const HEART_DX = 60;
  const LOW_HP_RATIO = 0.1;

  function lockTileAt(state: GameState, x: number, y: number): number {
    const index = toIndex(state.map, Math.floor(x / TILE_SIZE), Math.floor(y / TILE_SIZE));
    state.lockedTiles.add(index);
    return index;
  }

  it("視線が通っていても、線分が封鎖中の扉を横切る敵は狙わない", () => {
    const state = facingEnemy(ENEMY_DX);
    const enemy = state.enemies[0];
    expect(nearestEngagedEnemy(state), "前提: 扉が無ければ狙う").toBe(enemy);
    const p = state.player.body.pos;
    lockTileAt(state, p.x + ENEMY_DX / 2, p.y);
    expect(nearestEngagedEnemy(state), "扉越しの敵は狙わない").toBeNull();
  });

  it("封鎖中の扉が線分から外れていれば狙う", () => {
    const state = facingEnemy(ENEMY_DX);
    const p = state.player.body.pos;
    lockTileAt(state, p.x, p.y + TILE_SIZE * 4);
    expect(nearestEngagedEnemy(state), "扉が別の所にある").toBe(state.enemies[0]);
  });

  it("生命が低くても、経路で届かないハートへは向かわない（届くハートへは向かう）", () => {
    const reachable = arena(3);
    const heartPos = { x: reachable.player.body.pos.x + HEART_DX, y: reachable.player.body.pos.y };
    reachable.pickups.push({ id: 9001, kind: "heart", pos: { ...heartPos }, radius: 6, bobTime: 0 });
    reachable.player.hp = reachable.player.maxHp * LOW_HP_RATIO;
    reachable.player.flasks = 0;
    const botA = createBotState(1);
    botInput(reachable, botA, DT);
    expect(botA.pathGoal, "届くハートへ経路を引く").toEqual(heartPos);

    const sealed = arena(3);
    sealed.pickups.push({ id: 9002, kind: "heart", pos: { ...heartPos }, radius: 6, bobTime: 0 });
    sealed.player.hp = sealed.player.maxHp * LOW_HP_RATIO;
    sealed.player.flasks = 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) lockTileAt(sealed, heartPos.x + dx * TILE_SIZE, heartPos.y + dy * TILE_SIZE);
    const botB = createBotState(1);
    botInput(sealed, botB, DT);
    expect(botB.pathGoal === null || Math.abs(botB.pathGoal.x - heartPos.x) > TILE_SIZE || Math.abs(botB.pathGoal.y - heartPos.y) > TILE_SIZE, "ハートを経路の目標にしない").toBe(true);
    expect(botB.heartRetry, "届かないと分かったら次の引き直しまで待つ").toBeGreaterThan(0);
  });
});

describe("bot は穴越しの敵へ直進しない", () => {
  const ENEMY_DX = 80;
  /** 穴の列を置く、プレイヤーから右へのタイル数 */
  const PIT_COLUMN_TILES = 2;
  /** 回り込みに使う秒 */
  const ROUTE_SECONDS = 6;
  /** 回り込んで近づけたとみなす距離（px） */
  const REACHED_DIST = 40;

  /**
   * プレイヤーの右に縦一列の穴を開ける。gapAbove > 0 なら上端からそのタイル数だけ開けて回り道を残す
   * （縁を滑る向きの探索は下を先に試すので、回り道を上に置くと直進では袋小路に入る）
   */
  function digPitColumn(state: GameState, gapAbove: number): void {
    const map = state.map;
    const room = state.rooms[0];
    if (!room) throw new Error("開始部屋が無い");
    const tx = Math.floor(state.player.body.pos.x / TILE_SIZE) + PIT_COLUMN_TILES;
    for (let ty = room.rect.y + gapAbove; ty < room.rect.y + room.rect.h; ty++) map.tiles[toIndex(map, tx, ty)] = Tile.Pit;
    invalidatePathing(map);
  }

  it("視線が通っていても、線分が穴を横切る敵は狙わない", () => {
    const state = facingEnemy(ENEMY_DX);
    const enemy = state.enemies[0];
    if (!enemy) throw new Error("敵が無い");
    expect(nearestEngagedEnemy(state), "前提: 穴が無ければ狙う").toBe(enemy);
    digPitColumn(state, 0);
    expect(crossesPit(state, state.player.body.pos, enemy.body.pos), "線分は穴を横切る").toBe(true);
    expect(nearestEngagedEnemy(state), "穴越しの敵は後回し").toBeNull();
  });

  it("封鎖中の部屋で穴を挟んだ敵へ、縁で詰まらずに経路で回り込む", () => {
    const state = facingEnemy(ENEMY_DX);
    const enemy = state.enemies[0];
    const room = state.rooms[0];
    if (!enemy || !room) throw new Error("敵か開始部屋が無い");
    room.cleared = false;
    room.locked = true;
    enemy.roomIndex = 0;
    digPitColumn(state, 2);
    const pin = { ...enemy.body.pos };
    const bot = createBotState(1);
    let closest = Infinity;
    for (let t = 0; t < ROUTE_SECONDS / DT; t++) {
      step(state, botInput(state, bot, DT), DT);
      // 敵は動かさない（敵が自分から穴を回って来ると、bot の回り込みを確かめられない）
      enemy.body.pos = { ...pin };
      enemy.body.vel = { x: 0, y: 0 };
      closest = Math.min(closest, Math.hypot(pin.x - state.player.body.pos.x, pin.y - state.player.body.pos.y));
    }
    expect(closest, "穴の縁で止まらず敵のそばまで回り込む").toBeLessThan(REACHED_DIST);
  });
});

describe("bot の刻印符の自動装着", () => {
  it("手持ちの符を付けられるスキルへ付け、付けた数を返す。付かなかった符は手持ちに残る", () => {
    const state = createGame(3);
    state.skills.hand = ["focus", "echo", "streak"];
    const attached = autoAttachHand(state);
    const placed = state.skills.slots.reduce((n, s) => n + s.runModifiers.length, 0);
    expect(attached, "返り値は付けた枚数").toBe(placed);
    expect(state.skills.hand.length, "付けた分だけ手持ちが減る").toBe(3 - attached);
  });

  it("botInput は手持ちの符を毎ステップ付けにいく（本体は自動で付けない）", () => {
    const state = createGame(3);
    const stone = state.skills.slots.findIndex((_, i) => (state.skills.profile.loadout[i] ?? null) !== null);
    expect(stone, "石を持つスロットがある").toBeGreaterThanOrEqual(0);
    state.skills.hand = ["focus", "echo", "streak"];
    step(state, botInput(state, createBotState(3), 1 / 60), 1 / 60);
    const placed = state.skills.slots.reduce((n, s) => n + s.runModifiers.length, 0);
    expect(placed + state.skills.hand.length, "符は増えも消えもしない（押し出しが起きない枚数）").toBe(3);
    expect(placed, "付けられる符は付く").toBeGreaterThan(0);
  });

  it("ゲーム本体の step だけでは手持ちの符は付かない", () => {
    const state = createGame(3);
    state.skills.hand = ["focus"];
    for (let i = 0; i < 30; i++) step(state, withInput({}), 1 / 60);
    expect(state.skills.hand, "手持ちのまま").toEqual(["focus"]);
  });
});

describe("bot の二丁拳銃（左右の手。system/dualPistols.ts）", () => {
  it("左右を交互に 1 発ずつ押して拍を溜め、両手の弾で撃つ", () => {
    const state = facingEnemy(80);
    state.stats = { ...state.stats, moveset: "gunner", bullet: "twinPistols" };
    const bot = createBotState(6);
    const lanes = new Set<string>();
    let beat = 0;
    const FRAMES = 60 * 3;
    for (let i = 0; i < FRAMES; i++) {
      // スキルではなく手で撃たせる
      state.player.mana = 0;
      const input = botInput(state, bot, DT);
      expect(input.attackHeld && !input.attackPressed, `${i} フレーム目: 押しっぱなしにしない`).toBe(false);
      step(state, input, DT);
      for (const pr of state.projectiles) if (pr.owner === "player" && pr.lane) lanes.add(pr.lane);
      beat = Math.max(beat, state.player.morale.value);
    }
    expect([...lanes].sort(), "左手と右手の両方で撃った").toEqual(["primary", "secondary"]);
    expect(beat, "交互に撃って拍が溜まった").toBeGreaterThanOrEqual(2);
  });
});

describe("bot の銃の込めと射程（弾倉・早込め・詰め。gun-bases-review 0-3・0-4）", () => {
  /** 敵と向き合い、武器種と器を替える（弾倉は弾が替わると作り直される） */
  function armed(dx: number, moveset: MovesetKey, bullet: string): GameState {
    const state = facingEnemy(dx);
    state.stats = { ...state.stats, moveset, bullet };
    return state;
  }

  /** 気力のスキルではなく手で撃たせるため気力を 0 にして 1 フレーム回し、押した入力を返す */
  function nextInput(state: GameState, bot = createBotState(5)) {
    state.player.mana = 0;
    return botInput(state, bot, DT);
  }

  it("散弾は届かない間は撃たず（寄る）、射程の内に入れば撃つ", () => {
    // 散弾銃の射程は約 97px。気力 0 でも近接の射程（30px）より外なので左で撃つ側の判断になる
    const far = armed(-150, "cannon", "shotgun");
    const farInput = nextInput(far);
    expect(farInput.attackHeld, "射程外では左を押さない").toBe(false);
    expect(isZero(farInput.move), "寄るために動く").toBe(false);
    const near = armed(-60, "cannon", "shotgun");
    expect(nextInput(near).attackHeld, "射程内では左を押す").toBe(true);
  });

  it("射程の長い弾は遠くからでも撃つ", () => {
    const state = armed(-150, "sidearm", "pistol");
    expect(nextInput(state).attackHeld, "拳銃の射程は 270px").toBe(true);
  });

  it("短銃は込めの進みが早込めの窓に入ったときだけリロードを押す", () => {
    const state = armed(-150, "sidearm", "pistol");
    const bot = createBotState(5);
    // 弾倉は弾が替わった後の最初の step で作り直される
    step(state, nextInput(state, bot), DT);
    const h = state.player.magazine.hands[0];
    h.rounds = 0;
    h.reloadTotal = 1;
    h.reloadLeft = 0.9;
    const early = nextInput(state, bot);
    expect(magazineView(state).quickWindow, "窓が見える").not.toBeNull();
    expect(early.reloadPressed, "進み 10% は窓の前").toBeFalsy();
    h.reloadLeft = 0.4;
    expect(nextInput(state, bot).reloadPressed, "進み 60% は窓の中").toBe(true);
    step(state, { ...nextInput(state, bot), reloadPressed: true }, DT);
    expect(state.player.morale.value, "早込めで戦意が溜まった").toBeGreaterThan(0);
  });

  it("弾が届かない敵がいる間は減った弾倉を込める。満ちていれば込めず、敵がいない間は歩きが遅くならないよう込めない", () => {
    const state = armed(-150, "cannon", "shotgun");
    const bot = createBotState(5);
    step(state, nextInput(state, bot), DT);
    expect(nextInput(state, bot).reloadPressed, "満タンなら押さない").toBeFalsy();
    const hand = state.player.magazine.hands[0];
    // 満タンの間に詰め始めているので、詰めを解いて減った弾倉にする
    hand.rounds = 2;
    hand.reloadLeft = 0;
    hand.reloadTotal = 0;
    expect(nextInput(state, bot).reloadPressed, "射程外の敵がいて減っていれば込める").toBe(true);
    const idle = arena(3);
    idle.stats = { ...idle.stats, moveset: "longarm", bullet: "rifle" };
    const idleBot = createBotState(5);
    step(idle, botInput(idle, idleBot, DT), DT);
    idle.player.magazine.hands[0].rounds = 2;
    expect(botInput(idle, idleBot, DT).reloadPressed, "敵がいなければ込めない（撃ち切れば本体が自動で込める）").toBeFalsy();
  });

  it("砲は満ちた弾倉で射程の外の敵へ寄る間、リロードを押し続けて詰める。射程に入れば離す", () => {
    const state = armed(-150, "cannon", "shotgun");
    const bot = createBotState(5);
    expect(nextInput(state, bot).reloadHeld, "射程外で満タン").toBe(true);
    const near = armed(-60, "cannon", "shotgun");
    expect(nextInput(near).reloadHeld, "射程内では詰めない").toBeFalsy();
  });

  it("長銃は射程内の離れた敵には足を止めて撃ち、近づかれたら歩く", () => {
    const far = armed(-150, "longarm", "rifle");
    const farInput = nextInput(far);
    expect(isZero(farInput.move), "止まって狙う（止まっている秒が戦意になる）").toBe(true);
    expect(farInput.attackHeld, "撃つ").toBe(true);
    const near = armed(-40, "longarm", "rifle");
    expect(isZero(nextInput(near).move), "近いと歩く").toBe(false);
  });

  it("溜めの長銃は、戦意が満ちているときだけ最大段まで溜めてから離す", () => {
    const state = armed(-150, "longarm", "matchlock");
    const bot = createBotState(5);
    const p = state.player;
    p.shotCharging = true;
    p.shotChargeTime = 0.8;
    expect(nextInput(state, bot).attackHeld, "戦意が満ちていなければ 0.75 秒で離す").toBe(false);
    p.morale.primed = true;
    expect(nextInput(state, bot).attackHeld, "満ちていれば 0.8 秒ではまだ溜める").toBe(true);
    p.shotChargeTime = 1.2;
    expect(nextInput(state, bot).attackHeld, "最大段（1.1 秒）に届いたら離す").toBe(false);
  });
});

describe("bot の抜け斬り（手裏剣。気力の源がダッシュ攻撃だけ）", () => {
  function shurikenFacing(dx: number): GameState {
    const state = facingEnemy(dx);
    state.stats = { ...state.stats, moveset: "shuriken", bullet: "shuriken" };
    state.player.mana = 0;
    return state;
  }

  it("気力が足りなければ間合いの敵へダッシュし、ダッシュの間に左を押して抜け斬りを予約する", () => {
    const state = shurikenFacing(55);
    const bot = createBotState(5);
    state.player.mana = 0;
    const first = botInput(state, bot, DT);
    expect(first.dashPressed, "踏み込みのダッシュ").toBe(true);
    step(state, first, DT);
    expect(isDashing(state.player), "ダッシュに入った").toBe(true);
    state.player.mana = 0;
    const second = botInput(state, bot, DT);
    expect(second.attackPressed, "ダッシュの間に左を押す").toBe(true);
    step(state, second, DT);
    expect(state.player.dashAttackQueued, "抜け斬りが予約された").toBe(true);
  });

  it("気力が足りていれば踏み込まない。間合いの外でも踏み込まない", () => {
    const full = shurikenFacing(55);
    full.player.mana = full.stats.maxMana;
    expect(botInput(full, createBotState(5), DT).dashPressed, "気力が足りている").toBeFalsy();
    const far = shurikenFacing(-140);
    expect(botInput(far, createBotState(5), DT).dashPressed, "間合いの外").toBeFalsy();
  });

  it("抜け斬りの無い武器種ではダッシュで踏み込まない", () => {
    const state = facingEnemy(55);
    state.stats = { ...state.stats, moveset: "sword" };
    state.player.mana = 0;
    expect(botInput(state, createBotState(5), DT).dashPressed, "剣").toBeFalsy();
  });
});
