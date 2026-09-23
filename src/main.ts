import { SfxPlayer } from "./audio/sfx";
import { createGame, step } from "./core/game";
import { GamepadInput } from "./core/gamepad";
import { PlayerInput, type FrameInput } from "./core/input";
import { startLoop } from "./core/loop";
import {
  ReplayRecorder,
  createReplaySession,
  dailySeedText,
  guardStorageWrites,
  isDailySeedText,
  isReplayFinished,
  replayProgress,
  stepReplay,
  type ReplayData,
  type ReplaySession,
} from "./core/replay";
import { hashSeed } from "./core/rng";
import type { GameState } from "./core/state";
import { VIEW_H, VIEW_W } from "./core/view";
import { loadProfile, pushRunHistory, saveProfile } from "./loot/profile";
import type { Item, Profile } from "./loot/types";
import { drawInventoryUi } from "./render/inventoryUi";
import { Renderer } from "./render/renderer";
import { drawSkillHud } from "./render/skillHud";
import {
  drawDeathSummary,
  drawHistoryScreen,
  drawPauseMenu,
  drawReplayHud,
  drawSettingsScreen,
  drawTitle,
} from "./render/titleUi";
import { loadSkillProfile, saveSkillProfile } from "./skills/persistence";
import { recordRunOnce } from "./system/combat";
import {
  MenuKeyCapture,
  PAUSE_MENU_ITEMS,
  SETTINGS_ITEMS,
  buildHistoryEntry,
  cancelSeedInput,
  commitSeedInput,
  computeTitleStats,
  createSeedInputState,
  cycleIndex,
  edgeDir,
  moveHistoryCursor,
  processMenuKeys,
  shiftReplaySpeed,
  startSeedInput,
  summarizeRunItems,
  type ReplaySpeed,
} from "./ui/title";
import { findReplayForEntry, loadReplays, pushReplay } from "./ui/replayStore";
import {
  adjustScreenShake,
  adjustVolume,
  loadSettings,
  saveSettings,
  toggleMute,
  type Settings,
} from "./ui/settings";
import { createInventoryUi, updateInventoryUi } from "./ui/inventory";
import { uiFont } from "./render/font";

const canvasEl = document.getElementById("game");
if (!(canvasEl instanceof HTMLCanvasElement)) throw new Error("#game canvas not found");
/** 明示的に型を確定した参照。関数宣言の中から参照すると const の絞り込みが引き継がれないため */
const canvas: HTMLCanvasElement = canvasEl;

const GAME_NAME = "DEPTHBREAKER";
const SEED_PARAM = "seed";
/** 死亡演出が出そろうまでリスタート入力を受け付けない */
const DEATH_INPUT_DELAY = 0.6;
/**
 * 死亡画面のパッド A（confirm）は、攻撃連打からの誤リスタートを防ぐためこの秒数を待つ。
 * キーボード Enter は DEATH_INPUT_DELAY のみで即受け付ける
 */
const DEATH_PAD_CONFIRM_DELAY = 1.2;

/** 死亡画面のリスタート確定入力か。パッド A は DEATH_PAD_CONFIRM_DELAY を過ぎてから、キーボード Enter はそれより前でも受け付ける */
function deathConfirmPressed(frame: FrameInput, deathTimer: number): boolean {
  if (frame.padConfirmPressed) return deathTimer > DEATH_PAD_CONFIRM_DELAY;
  return frame.confirmPressed;
}

type Screen = "title" | "playing" | "paused" | "history" | "settings" | "replay";

const REPLAY_START_SPEED: ReplaySpeed = 1;
const NO_REPLAY_MESSAGE = "このランのリプレイは保存されていません";
const BROKEN_REPLAY_MESSAGE = "リプレイデータが壊れています";

function initialSeedText(): string {
  return new URLSearchParams(location.search).get(SEED_PARAM) ?? randomSeedText();
}

function randomSeedText(): string {
  return (Date.now() >>> 0).toString(36);
}

function syncSeedUrl(seedText: string): void {
  const url = new URL(location.href);
  url.searchParams.set(SEED_PARAM, seedText);
  history.replaceState(null, "", url);
}

// プロフィール（装備・stash・ラン履歴）はラン間で共有。拾った瞬間に保存される
const profile: Profile = loadProfile();
// スキル石も別キーで永続。刻印符（修飾子）はラン内なので createGame が毎回空で作る
const skillProfile = loadSkillProfile();
const settings: Settings = loadSettings();

function startGame(seedText: string): GameState {
  syncSeedUrl(seedText);
  return createGame(hashSeed(seedText), seedText, profile, skillProfile);
}

const input = new PlayerInput();
input.attachKeyboard(window);
input.attachMouse(canvas);
const gamepad = new GamepadInput();
gamepad.attach(window);
input.attachGamepad(gamepad);
const menuKeys = new MenuKeyCapture();
menuKeys.attach(window);

/** "Gamepad connected" 表示の残り秒数 */
const GAMEPAD_CONNECTED_MESSAGE_DURATION = 2;
let gamepadConnectedTimer = 0;

const renderer = new Renderer(canvas);
const inventoryUi = createInventoryUi();
const sfx = new SfxPlayer();
let lastAim: { x: number; y: number } | null = null;

// ブラウザの autoplay 制約: 最初の操作で AudioContext を起こす
const unlockAudio = (): void => sfx.unlock();
window.addEventListener("keydown", unlockAudio);
window.addEventListener("mousedown", unlockAudio);

function applySettings(): void {
  sfx.setMuted(settings.muted);
  sfx.setMasterVolume(settings.volume);
  saveSettings(settings);
}
applySettings();

// ---------------------------------------------------------------------------
// 画面状態
// ---------------------------------------------------------------------------

let screen: Screen = "title";
/** settings 画面を Esc で閉じたときにどこへ戻るか */
let returnScreen: "title" | "paused" = "title";
let state: GameState | null = null;

const seedInput = createSeedInputState(initialSeedText());
let committedSeedText = seedInput.text;

let titleTime = 0;
let pauseCursor = 0;
let settingsCursor = 0;
/** 設定/ポーズメニューのカーソル移動をエッジ検出するための直前フレームの move 値 */
const menuNav = { prevX: 0, prevY: 0 };

/** このランの開始時刻（epoch ms）。死亡サマリーで「このランで拾った」判定に使う */
let runStartedAt = Date.now();
let bossesDefeated = 0;
let prevBossDefeated = false;
/** recordRunOnce 経由の meta 更新と、ラン履歴の追加を二重にしないためのマーカー */
let historyRecordedState: GameState | null = null;

/** 現在のランの入力記録。step に渡す入力は必ずここを通す（照準の量子化を実プレイにも効かせる） */
let recorder: ReplayRecorder | null = null;
/** 装備画面を開いていたら、次の step の前に付け替えの有無を記録器に確認させる */
let loadoutDirty = false;
let replays: ReplayData[] = loadReplays();

let historyCursor = 0;
let historyMessage = "";

interface ReplayPlayback {
  session: ReplaySession;
  speed: ReplaySpeed;
  /** 再生中だけ有効な、プロフィール保存の抑止を解除する */
  releaseGuard: () => void;
  clock: number;
}
let replay: ReplayPlayback | null = null;

function beginRun(seedText: string): void {
  runStartedAt = Date.now();
  recorder = new ReplayRecorder({ seedText, startedAt: runStartedAt, daily: isDailySeedText(seedText) }, profile, skillProfile);
  loadoutDirty = false;
  state = startGame(seedText);
  committedSeedText = seedText;
  seedInput.text = seedText;
  bossesDefeated = 0;
  prevBossDefeated = false;
  historyRecordedState = null;
  screen = "playing";
}

/** ラン終了（死亡 or 中断）を 1 回だけ記録する。何度呼んでも安全 */
function endRun(current: GameState): void {
  recordRunOnce(current);
  if (historyRecordedState === current) return;
  historyRecordedState = current;
  // 履歴エントリの date とリプレイの endedAt を同じ値にして紐付ける
  const now = Date.now();
  pushRunHistory(current.profile, buildHistoryEntry(current, now));
  saveProfile(current.profile);
  if (recorder) {
    replays = pushReplay(recorder.finish({ depth: current.depth, kills: current.kills, score: current.score }, now));
    recorder = null;
  }
}

/** 記録器を通して step する。記録中でなければそのまま */
function stepRecorded(s: GameState, frame: FrameInput, dt: number): void {
  if (!recorder) {
    step(s, frame, dt);
    return;
  }
  if (loadoutDirty) {
    recorder.noteLoadout(s);
    loadoutDirty = false;
  }
  step(s, recorder.record(frame), dt);
}

function openHistory(): void {
  screen = "history";
  historyCursor = 0;
  historyMessage = "";
}

/**
 * 再生を始める。step 内の拾得処理は一時プロフィールを保存しようとするので、
 * 再生中はプロフィールのキーへの書き込みを止める
 */
function startReplay(data: ReplayData): void {
  let session: ReplaySession;
  try {
    session = createReplaySession(data);
  } catch (err) {
    console.warn("replay failed", err);
    historyMessage = BROKEN_REPLAY_MESSAGE;
    return;
  }
  replay = { session, speed: REPLAY_START_SPEED, releaseGuard: guardStorageWrites(), clock: 0 };
  screen = "replay";
}

/** 再生を終えて履歴画面へ戻る。念のため本物のプロフィールを保存し直す */
function endReplay(): void {
  if (replay) replay.releaseGuard();
  replay = null;
  saveProfile(profile);
  saveSkillProfile(skillProfile);
  screen = "history";
}

function enterMenu(next: "paused" | "settings", frameMoveX: number, frameMoveY: number): void {
  screen = next;
  menuNav.prevX = frameMoveX;
  menuNav.prevY = frameMoveY;
}

function drainSfx(s: GameState | null = state): void {
  if (!s) return;
  const names = s.sfx.splice(0);
  for (const name of names) sfx.play(name);
}

function trackBoss(s: GameState): void {
  const defeated = s.boss?.defeated ?? false;
  if (defeated && !prevBossDefeated) bossesDefeated += 1;
  prevBossDefeated = defeated;
}

function foundItems(p: Profile): Item[] {
  const equipped = Object.values(p.equipment).filter((it): it is Item => it !== null);
  return [...p.stash, ...equipped];
}

const GAMEPAD_HINT_TEXT = "ゲームパッドを接続しました";
const GAMEPAD_HINT_FONT = uiFont(8);
const GAMEPAD_HINT_COLOR = "#e0e0e0";
const GAMEPAD_HINT_Y_FROM_BOTTOM = 6;

/** state や render に触れず、画面下に一時的な接続通知だけ重ねて描く */
function drawGamepadConnectedHint(ctx: CanvasRenderingContext2D): void {
  if (gamepadConnectedTimer <= 0) return;
  ctx.font = GAMEPAD_HINT_FONT;
  ctx.fillStyle = GAMEPAD_HINT_COLOR;
  ctx.textAlign = "center";
  ctx.fillText(GAMEPAD_HINT_TEXT, VIEW_W / 2, VIEW_H - GAMEPAD_HINT_Y_FROM_BOTTOM);
}

/** 画面揺れの強度は renderer / system を触らず、描画直前だけカメラオフセットを倍率適用して戻す */
function renderGame(s: GameState, aim: { x: number; y: number } | null): void {
  const savedOffset = s.camera.offset;
  s.camera.offset = { x: savedOffset.x * settings.screenShake, y: savedOffset.y * settings.screenShake };
  renderer.render(s, aim);
  s.camera.offset = savedOffset;
}

/**
 * canvas は index.html で cursor: none にしている（プレイ中はクロスヘアを描くため）。
 * クロスヘアを描かない画面（装備画面・タイトル系・祝福選択）では OS のマウスカーソルを見せる
 */
let cursorVisible = false;
function updateCursorVisibility(cur: GameState | null): void {
  const wantVisible = inventoryUi.open || screen !== "playing" || cur?.boonChoice != null;
  if (wantVisible === cursorVisible) return;
  cursorVisible = wantVisible;
  canvas.style.cursor = wantVisible ? "default" : "none";
}

startLoop(
  (dt) => {
    const frame = input.snapshot(state?.camera.offset);
    const hotkeys = processMenuKeys(menuKeys.drain(), seedInput);
    // B / Start はメニューの「戻る/ポーズ」として Escape 相当に統合する。
    // ただしプレイ中（装備画面を閉じている間）は B がダッシュと共用なので、ポーズは Start だけで開く
    const padInGame = screen === "playing" && !inventoryUi.open;
    if (padInGame ? gamepad.pausePressed() : input.gamepadEscapePressed()) hotkeys.escape = true;
    lastAim = frame.aimScreen;

    if (gamepad.consumeJustConnected()) gamepadConnectedTimer = GAMEPAD_CONNECTED_MESSAGE_DURATION;
    if (gamepadConnectedTimer > 0) gamepadConnectedTimer = Math.max(0, gamepadConnectedTimer - dt);

    // 自然死（system/combat.ts が state.status を "dead" にして recordRunOnce を呼ぶ）も
    // ここで拾ってラン履歴に積む。endRun は何度呼んでも安全
    if (state && state.status === "dead") endRun(state);

    switch (screen) {
      case "title": {
        titleTime += dt;
        if (seedInput.active) {
          if (frame.confirmPressed) {
            committedSeedText = commitSeedInput(seedInput, committedSeedText);
            syncSeedUrl(committedSeedText);
          } else if (hotkeys.escape) {
            cancelSeedInput(seedInput, committedSeedText);
          }
          break;
        }
        if (hotkeys.n) {
          sfx.play("uiClick");
          startSeedInput(seedInput);
          break;
        }
        if (hotkeys.h) {
          sfx.play("uiClick");
          openHistory();
          break;
        }
        if (hotkeys.d) {
          sfx.play("uiClick");
          beginRun(dailySeedText(new Date()));
          break;
        }
        if (hotkeys.o) {
          sfx.play("uiClick");
          returnScreen = "title";
          settingsCursor = 0;
          enterMenu("settings", frame.move.x, frame.move.y);
          break;
        }
        if (frame.confirmPressed || frame.clickPressed) {
          sfx.play("uiClick");
          beginRun(committedSeedText);
        }
        break;
      }

      case "history": {
        if (hotkeys.escape) {
          screen = "title";
          break;
        }
        const history = profile.meta.history ?? [];
        const navY = hotkeys.arrowY !== 0 ? hotkeys.arrowY : Math.sign(frame.wheel);
        if (navY !== 0) {
          historyCursor = moveHistoryCursor(historyCursor, navY, history.length);
          historyMessage = "";
          sfx.play("menuMove");
        }
        const entry = history[historyCursor];
        if (!entry) break;
        if (hotkeys.s) {
          sfx.play("uiClick");
          beginRun(entry.seedText);
          break;
        }
        if (hotkeys.p) {
          const data = findReplayForEntry(replays, entry);
          if (data) startReplay(data);
          else historyMessage = NO_REPLAY_MESSAGE;
          sfx.play("uiClick");
        }
        break;
      }

      case "replay": {
        // 再生中は装備画面・ポーズを開かない。Esc で終了、←→ で速度
        const cur = replay;
        if (!cur) {
          screen = "history";
          break;
        }
        if (hotkeys.escape || (isReplayFinished(cur.session) && frame.confirmPressed)) {
          endReplay();
          break;
        }
        if (hotkeys.arrowX !== 0) cur.speed = shiftReplaySpeed(cur.speed, hotkeys.arrowX);
        cur.clock += dt;
        for (let i = 0; i < cur.speed; i++) stepReplay(cur.session, dt);
        drainSfx(cur.session.state);
        break;
      }

      case "settings": {
        if (hotkeys.escape) {
          screen = returnScreen;
          break;
        }
        if (hotkeys.m) {
          toggleMute(settings);
          applySettings();
        }
        const navY = edgeDir(menuNav.prevY, frame.move.y);
        if (navY !== 0) {
          settingsCursor = cycleIndex(settingsCursor, navY, SETTINGS_ITEMS.length);
          sfx.play("menuMove");
        }
        const navX = edgeDir(menuNav.prevX, frame.move.x);
        if (navX !== 0) {
          const item = SETTINGS_ITEMS[settingsCursor];
          if (item === "mute") {
            toggleMute(settings);
            applySettings();
          } else if (item === "volume") {
            adjustVolume(settings, navX);
            applySettings();
          } else {
            adjustScreenShake(settings, navX);
            saveSettings(settings);
          }
          sfx.play("uiClick");
        }
        menuNav.prevX = frame.move.x;
        menuNav.prevY = frame.move.y;
        break;
      }

      case "paused": {
        const cur = state;
        if (!cur) {
          screen = "title";
          break;
        }
        if (hotkeys.escape) {
          screen = "playing";
          cur.paused = false;
          break;
        }
        const navY = edgeDir(menuNav.prevY, frame.move.y);
        if (navY !== 0) {
          pauseCursor = cycleIndex(pauseCursor, navY, PAUSE_MENU_ITEMS.length);
          sfx.play("menuMove");
        }
        menuNav.prevX = frame.move.x;
        menuNav.prevY = frame.move.y;
        if (frame.confirmPressed) {
          sfx.play("uiClick");
          const item = PAUSE_MENU_ITEMS[pauseCursor];
          if (item === "resume") {
            screen = "playing";
            cur.paused = false;
          } else if (item === "settings") {
            returnScreen = "paused";
            settingsCursor = 0;
            enterMenu("settings", frame.move.x, frame.move.y);
          } else if (item === "restart") {
            endRun(cur);
            beginRun(randomSeedText());
          } else {
            endRun(cur);
            cur.paused = false;
            state = null;
            screen = "title";
          }
        }
        break;
      }

      case "playing": {
        const cur = state;
        if (!cur) {
          screen = "title";
          break;
        }

        // 装備画面は step の pause 判定より前に処理する（paused を UI が切り替える）
        updateInventoryUi(cur, inventoryUi, frame, dt);
        if (inventoryUi.open) loadoutDirty = true;
        if (inventoryUi.open) {
          if (hotkeys.escape) {
            inventoryUi.open = false;
            cur.paused = false;
          }
          drainSfx();
          break;
        }

        if (hotkeys.escape) {
          pauseCursor = 0;
          cur.paused = true;
          enterMenu("paused", frame.move.x, frame.move.y);
          break;
        }

        if (cur.status === "dead" && cur.deathTimer > DEATH_INPUT_DELAY) {
          if (hotkeys.t) {
            endRun(cur);
            state = null;
            screen = "title";
            break;
          }
          if (deathConfirmPressed(frame, cur.deathTimer)) beginRun(cur.seedText);
          else if (frame.restartPressed) beginRun(randomSeedText());
        } else if (frame.restartPressed) {
          // 死んでいない状態で R を押した中断も、ラン結果として一度だけメタと履歴に記録する
          endRun(cur);
          beginRun(randomSeedText());
        }

        if (state) {
          stepRecorded(state, frame, dt);
          trackBoss(state);
          drainSfx();
        }
        break;
      }
    }
  },
  () => {
    // タイトル等は render を通らないので、ここで論理座標の transform を掛ける
    renderer.beginFrame();
    const ctx = renderer.context;
    updateCursorVisibility(state);

    if (screen === "title") {
      drawTitle(ctx, titleTime, GAME_NAME, seedInput, computeTitleStats(profile));
      drawGamepadConnectedHint(ctx);
      return;
    }
    if (screen === "history") {
      drawHistoryScreen(ctx, {
        history: profile.meta.history ?? [],
        cursor: historyCursor,
        hasReplay: (i) => {
          const entry = profile.meta.history?.[i];
          return entry !== undefined && findReplayForEntry(replays, entry) !== null;
        },
        message: historyMessage,
      });
      drawGamepadConnectedHint(ctx);
      return;
    }
    if (screen === "settings" && returnScreen === "title") {
      drawTitle(ctx, titleTime, GAME_NAME, seedInput, computeTitleStats(profile));
      drawSettingsScreen(ctx, settings, settingsCursor, true);
      drawGamepadConnectedHint(ctx);
      return;
    }

    if (screen === "replay" && replay) {
      const session = replay.session;
      renderGame(session.state, session.lastInput.aimScreen);
      drawSkillHud(ctx, session.state);
      drawReplayHud(
        ctx,
        {
          speed: replay.speed,
          progress: replayProgress(session),
          finished: isReplayFinished(session),
          seedText: session.data.seedText,
        },
        replay.clock,
      );
      drawGamepadConnectedHint(ctx);
      return;
    }

    const cur = state;
    if (!cur) {
      drawTitle(ctx, titleTime, GAME_NAME, seedInput, computeTitleStats(profile));
      drawGamepadConnectedHint(ctx);
      return;
    }

    renderGame(cur, inventoryUi.open || screen !== "playing" ? null : lastAim);

    drawSkillHud(ctx, cur);
    if (inventoryUi.open) drawInventoryUi(ctx, cur, inventoryUi);
    if (screen === "paused") drawPauseMenu(ctx, pauseCursor);
    if (screen === "settings") drawSettingsScreen(ctx, settings, settingsCursor, true);
    if (cur.status === "dead" && cur.deathTimer > DEATH_INPUT_DELAY) {
      drawDeathSummary(ctx, {
        itemSummary: summarizeRunItems(foundItems(cur.profile), runStartedAt),
        bestCombo: cur.combo.best,
        bossesDefeated,
      });
    }
    drawGamepadConnectedHint(ctx);
  },
);
