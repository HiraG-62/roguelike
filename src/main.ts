import { SfxPlayer } from "./audio/sfx";
import { createGame, step } from "./core/game";
import { GamepadInput } from "./core/gamepad";
import { PlayerInput } from "./core/input";
import { startLoop } from "./core/loop";
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
  drawSettingsScreen,
  drawTitle,
} from "./render/titleUi";
import { loadSkillProfile } from "./skills/persistence";
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
  processMenuKeys,
  startSeedInput,
  summarizeRunItems,
} from "./ui/title";
import {
  adjustScreenShake,
  adjustVolume,
  loadSettings,
  saveSettings,
  toggleMute,
  type Settings,
} from "./ui/settings";
import { createInventoryUi, updateInventoryUi } from "./ui/inventory";

const canvas = document.getElementById("game");
if (!(canvas instanceof HTMLCanvasElement)) throw new Error("#game canvas not found");

const GAME_NAME = "DEPTHBREAKER";
const SEED_PARAM = "seed";
/** 死亡演出が出そろうまでリスタート入力を受け付けない */
const DEATH_INPUT_DELAY = 0.6;

type Screen = "title" | "playing" | "paused" | "history" | "settings";

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

function beginRun(seedText: string): void {
  state = startGame(seedText);
  committedSeedText = seedText;
  seedInput.text = seedText;
  runStartedAt = Date.now();
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
  pushRunHistory(current.profile, buildHistoryEntry(current, Date.now()));
  saveProfile(current.profile);
}

function enterMenu(next: "paused" | "settings", frameMoveX: number, frameMoveY: number): void {
  screen = next;
  menuNav.prevX = frameMoveX;
  menuNav.prevY = frameMoveY;
}

function drainSfx(): void {
  if (!state) return;
  const names = state.sfx.splice(0);
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

const GAMEPAD_HINT_TEXT = "Gamepad connected";
const GAMEPAD_HINT_FONT = "bold 8px monospace";
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

startLoop(
  (dt) => {
    const frame = input.snapshot(state?.camera.offset);
    const hotkeys = processMenuKeys(menuKeys.drain(), seedInput);
    // B / Start はメニューの「戻る/ポーズ」として Escape 相当に統合する
    if (input.gamepadEscapePressed()) hotkeys.escape = true;
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
          startSeedInput(seedInput);
          break;
        }
        if (hotkeys.h) {
          screen = "history";
          break;
        }
        if (hotkeys.o) {
          returnScreen = "title";
          settingsCursor = 0;
          enterMenu("settings", frame.move.x, frame.move.y);
          break;
        }
        if (frame.confirmPressed || frame.clickPressed) beginRun(committedSeedText);
        break;
      }

      case "history": {
        if (hotkeys.escape) screen = "title";
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
        if (navY !== 0) settingsCursor = cycleIndex(settingsCursor, navY, SETTINGS_ITEMS.length);
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
        if (navY !== 0) pauseCursor = cycleIndex(pauseCursor, navY, PAUSE_MENU_ITEMS.length);
        menuNav.prevX = frame.move.x;
        menuNav.prevY = frame.move.y;
        if (frame.confirmPressed) {
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
          if (frame.confirmPressed) beginRun(cur.seedText);
          else if (frame.restartPressed) beginRun(randomSeedText());
        } else if (frame.restartPressed) {
          // 死んでいない状態で R を押した中断も、ラン結果として一度だけメタと履歴に記録する
          endRun(cur);
          beginRun(randomSeedText());
        }

        if (state) {
          step(state, frame, dt);
          trackBoss(state);
          drainSfx();
        }
        break;
      }
    }
  },
  () => {
    const ctx = renderer.context;

    if (screen === "title") {
      drawTitle(ctx, titleTime, GAME_NAME, seedInput, computeTitleStats(profile));
      drawGamepadConnectedHint(ctx);
      return;
    }
    if (screen === "history") {
      drawHistoryScreen(ctx, profile.meta.history ?? []);
      drawGamepadConnectedHint(ctx);
      return;
    }
    if (screen === "settings" && returnScreen === "title") {
      drawTitle(ctx, titleTime, GAME_NAME, seedInput, computeTitleStats(profile));
      drawSettingsScreen(ctx, settings, settingsCursor, true);
      drawGamepadConnectedHint(ctx);
      return;
    }

    const cur = state;
    if (!cur) {
      drawTitle(ctx, titleTime, GAME_NAME, seedInput, computeTitleStats(profile));
      drawGamepadConnectedHint(ctx);
      return;
    }

    // 画面揺れの強度は renderer / system を触らず、描画直前だけカメラオフセットを倍率適用して戻す
    const savedOffset = cur.camera.offset;
    cur.camera.offset = { x: savedOffset.x * settings.screenShake, y: savedOffset.y * settings.screenShake };
    renderer.render(cur, inventoryUi.open || screen !== "playing" ? null : lastAim);
    cur.camera.offset = savedOffset;

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
