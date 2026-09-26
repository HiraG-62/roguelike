// 保存先の差し替え（Electron ならセーブファイル）はトップレベルの load*() より前に終わっていなければならないので最初に評価する
import "./save/bootstrap";
import { SfxPlayer } from "./audio/sfx";
import { MusicPlayer, musicCue } from "./audio/music";
import { RisingEdge } from "./audio/cues";
import { questProgress, questSnapshot } from "./meta/quests";
import { isEngaged } from "./system/engagement";
import { bossEnemy } from "./system/boss";
import { isStaggered } from "./system/poise";
import { createGame, step } from "./core/game";
import { GamepadInput } from "./core/gamepad";
import { PAD_Y, PadCapture, assignPadBinding, clearPadBinding } from "./core/padBinds";
import { KEYBIND_SLOTS, PlayerInput, assignBinding, clearBinding, isAssignableCode, type FrameInput } from "./core/input";
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
import { loadProfile, pushRunHistory, returnLoaned, saveProfile } from "./loot/profile";
import type { Item, Profile } from "./loot/types";
import { drawInventoryUi } from "./render/inventoryUi";
import { drawBudUi } from "./render/budUi";
import { loadImageAtlas } from "./render/imageAtlas";
import { SHEETS, TILE_SPRITES } from "./data/tiles";
import { Renderer } from "./render/renderer";
import {
  drawDeathSummary,
  drawHistoryScreen,
  drawKeybindsScreen,
  drawPauseMenu,
  drawReplayHud,
  drawSettingsScreen,
  drawTitle,
  keybindsRowGap,
} from "./render/titleUi";
import { loadSkillProfile, saveSkillProfile } from "./skills/persistence";
import { recordRunOnce } from "./system/combat";
import {
  KEYBINDS_ROWS,
  PADBINDS_ROWS,
  bindsExtraRow,
  bindsRowCount,
  isPadActionRow,
  type BindsMode,
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
  isActionRow,
  keybindsItemAt,
  clampKeybindsScroll,
  keybindsScrollFor,
  moveHistoryCursor,
  pauseMenuItemAt,
  processMenuKeys,
  replayAvailability,
  isSettingsGaugeItem,
  settingsGaugeRect,
  settingsGaugeValueAt,
  settingsItemAt,
  settingsRowSide,
  shiftReplaySpeed,
  startSeedInput,
  summarizeRunItems,
  type PauseMenuItem,
  type ReplaySpeed,
  type SettingsGaugeItem,
  type SettingsItem,
} from "./ui/title";
import { findReplayForEntry, loadReplays, pushReplay } from "./ui/replayStore";
import {
  adjustHitstopScale,
  adjustMusicVolume,
  adjustScreenShake,
  adjustVolume,
  loadSettings,
  resetKeybinds,
  resetPadBinds,
  saveSettings,
  setHitstopScale,
  setMusicVolume,
  setScreenShake,
  setVolume,
  toggleDropTooltip,
  toggleMute,
  type Settings,
} from "./ui/settings";
import { createInventoryUi, updateInventoryUi } from "./ui/inventory";
import { TEXT, drawText, textLineHeight } from "./render/pixelText";
import { drawOriginScreen } from "./render/originUi";
import {
  activateOriginCursor,
  createOriginScreen,
  moveOriginCursor,
  backOriginStage,
  originItemAt,
  originRowGap,
  originSetup,
  pointOriginRow,
  type OriginScreen,
} from "./ui/origin";
import { type RunSetup, defaultRunSetup } from "./system/runSetup";
import { saveCraft } from "./loot/craftingStore";
import { TRAIT_COLORS } from "./loot/types";
import { recordCodex } from "./meta/codex";
import { loadCodex, saveCodex } from "./meta/codexStore";
import { seedKnownLinks } from "./meta/links";
import { carriedQuest, codexPages, isQuestKey, lockedJobs, lockedOrigins, lockedRelicKeys, pickQuestOffers, recordQuest } from "./meta/quests";
import { loadQuests, saveQuests } from "./meta/questStore";
import { currentTitleLabel, evaluateAchievements, loadAchievements, noteJobPlayed, saveAchievements, selectTitle } from "./meta/achievements";
import { ACHIEVEMENT_TITLE_TAB, achievementTabs, codexListTabs, metaSummaryLines, questBoardTabs, questStatusLine, titleIdOfEntry } from "./meta/screens";
import { tipsListTabs } from "./meta/tips";
import { type ListAction, type ListScreen, type ListTab, createListScreen, listCursorEntry, listRowGap, stepListScreen } from "./meta/listScreen";
import { drawListScreen } from "./render/codexUi";
import { drawQuestChoice } from "./render/questUi";
import { type QuestChoiceScreen, chosenQuest, createQuestChoice, moveQuestChoice, questChoiceItemAt } from "./ui/quests";
import { type HubSession, borrowRackEntry, createHub, equippedMoveset, fillHubResources, hubResourceRatio, trialUltimateName, rackEntryName, setHubResource, setTrialKeystone, setTrialWeapon, stepHub } from "./system/hub";
import { HUB } from "./data/tuning";
import type { HubSpotKey } from "./map/hubMap";
import { type HubDecor, availableSpots, builtFacilities, facilityBuiltBanner, hubDecorations, newlyBuilt } from "./meta/hub";
import { loadHub, markFacilitiesSeen, saveHub } from "./meta/hubStore";
import { drawHubOverlay } from "./render/hubUi";
import { drawRackScreen } from "./render/rackUi";
import type { MovesetKey } from "./data/weapons";
import { altarTabs, createHoldLatch, hubOpenFor, hubProgressSource, latchedHold, openInventoryAt, resetHoldLatch, trialKeyOfEntry } from "./ui/hubFlow";
import { type RackAction, type RackCard, type RackUi, createRackUi, rackCards, rackCursorCard, stepRack } from "./ui/rackScreen";
import { type TitleMenuItem, titleMenuHotkey, titleMenuItemAt } from "./ui/title";

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

type Screen =
  | "title"
  | "origin"
  | "questChoice"
  | "codex"
  | "questBoard"
  | "achievements"
  | "tips"
  | "playing"
  | "paused"
  | "history"
  | "settings"
  | "keybinds"
  | "replay"
  | "hub"
  | "altar"
  | "rack";

/** タイトルのメニューから開く一覧画面（Tips ノートはポーズからも開く） */
type ListScreenKind = "codex" | "questBoard" | "achievements" | "tips";

const REPLAY_START_SPEED: ReplaySpeed = 1;
const NO_REPLAY_MESSAGE = "この探索のリプレイは保存されていません";
const BROKEN_REPLAY_MESSAGE = "リプレイデータが壊れています";
const OLD_REPLAY_MESSAGE = "このリプレイは旧バージョンのため再生できません";
/** 旧バージョン通知の表示秒数 */
const OLD_REPLAY_MESSAGE_DURATION = 2;

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
// メタ進行（図鑑・依頼・実績）。ラン終了時に endRun が 1 回だけ畳んで保存する（step の中では触れない）
const codexSave = loadCodex();
const questSave = loadQuests();
const achievementSave = loadAchievements();

function startGame(seedText: string): GameState {
  syncSeedUrl(seedText);
  return createGame(hashSeed(seedText), seedText, profile, skillProfile, runSetup, settings.hitstopScale);
}

/** ラン開始時に依頼の除外遺物を確定させる（記録器と createGame が同じ集合を見る） */
function withLockedRelics(setup: RunSetup): RunSetup {
  return { ...setup, lockedRelics: lockedRelicKeys(questSave) };
}

const input = new PlayerInput();
input.setKeybinds(settings.keybinds);
input.attachKeyboard(window);
input.attachMouse(canvas);
const gamepad = new GamepadInput();
gamepad.attach(window);
gamepad.setBinds(settings.padBinds);
input.attachGamepad(gamepad);
const menuKeys = new MenuKeyCapture();
menuKeys.attach(window);

/** "Gamepad connected" 表示の残り秒数 */
const GAMEPAD_CONNECTED_MESSAGE_DURATION = 2;
let gamepadConnectedTimer = 0;

/** アイテム情報表示（drop tooltip）切替の通知の残り秒数。state を書き換えない表示側だけの仕組み */
const DROP_INFO_HINT_DURATION = 1.5;
let dropInfoHintTimer = 0;

const renderer = new Renderer(canvas);
// PNG 取り込み（未ロード中はピクセルマップのまま。フォントの読み込みと同じ流儀でループを待たない）
void loadImageAtlas(TILE_SPRITES, SHEETS).then((atlas) => renderer.setAtlas(atlas));
const inventoryUi = createInventoryUi();
const sfx = new SfxPlayer();
let lastAim: { x: number; y: number } | null = null;

// ブラウザの autoplay 制約: 最初の操作で AudioContext を起こす
const unlockAudio = (): void => sfx.unlock();
window.addEventListener("keydown", unlockAudio);
window.addEventListener("mousedown", unlockAudio);

// 音楽は効果音と AudioContext を共有する（unlock 前は鳴らない）
const music = new MusicPlayer(() => sfx.context());

function applySettings(): void {
  sfx.setMuted(settings.muted);
  sfx.setMasterVolume(settings.volume);
  music.setMuted(settings.muted);
  music.setVolume(settings.volume * settings.musicVolume);
  saveSettings(settings);
}
applySettings();

/**
 * ヒットストップの強さ設定を、今動いているラン/拠点の state へ即座に書き戻す。
 * これをしないと（保存はされても）今のプレイに効かず「変えても変わらない」ように見える。
 * ラン中の変更は記録中のリプレイにもイベントとして積み、再生で同じ強さを再現する
 */
function applyHitstopScale(): void {
  if (state) {
    state.hitstopScale = settings.hitstopScale;
    recorder?.noteHitstopScale(state, settings.hitstopScale);
  }
  if (hub) hub.state.hitstopScale = settings.hitstopScale;
  saveSettings(settings);
}

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
/** キー設定画面の選択行（KEYBINDS_ROWS の index）・列（主 / 副 / 予備）・スクロール・取得モード */
let keybindsCursor = 0;
let keybindsSlot = 0;
let keybindsScroll = 0;
let keybindsCapturing = false;
/** 割り当て画面が編集している表（キーボード / パッド） */
let keybindsMode: BindsMode = "key";
const padCapture = new PadCapture();
/** 今フレームの Escape がキーボード由来か。パッド設定の取得中は B を割り当てたいので、取り消しは Esc と Start だけにする */
let keyboardEscape = false;
/** 設定/ポーズメニューのカーソル移動をエッジ検出するための直前フレームの move 値 */
const menuNav = { prevX: 0, prevY: 0 };
/** ポーズ/設定メニューでマウスが動いたかを判定するための直前フレームの aimScreen（動いた時だけホバーでカーソルを奪う） */
let menuAimPrev: { x: number; y: number } | null = null;

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
/** > 0 の間だけ historyMessage を自動で消す残り秒数（0 なら手動クリアのみ） */
let historyMessageTimer = 0;

interface ReplayPlayback {
  session: ReplaySession;
  speed: ReplaySpeed;
  /** 再生中だけ有効な、プロフィール保存の抑止を解除する */
  releaseGuard: () => void;
  clock: number;
}
let replay: ReplayPlayback | null = null;

// ---------------------------------------------------------------------------
// 起点画面（タイトル → 起点 → ラン開始。docs/ideas/run-expansion.md 7・8 章）
// ---------------------------------------------------------------------------

/** 直近に選んだ起点と縛り。リスタート・同じシードでの再挑戦にも使う */
let runSetup: RunSetup = defaultRunSetup();
let originUi: OriginScreen = createOriginScreen(runSetup, lockedOrigins(questSave), lockedJobs(questSave));
/** 起点画面を抜けたら始めるシード */
let pendingSeedText = "";

function openOrigin(seedText: string, frameMoveX: number, frameMoveY: number): void {
  pendingSeedText = seedText;
  originUi = createOriginScreen(runSetup, lockedOrigins(questSave), lockedJobs(questSave));
  screen = "origin";
  menuNav.prevX = frameMoveX;
  menuNav.prevY = frameMoveY;
  menuAimPrev = null;
}

function updateOriginScreen(frame: FrameInput, escape: boolean, arrowX: number, arrowY: number): void {
  if (escape) {
    sfx.play("uiClose");
    // 起点の段ならジョブの段へ 1 段戻る。ジョブの段ならタイトルへ
    if (!backOriginStage(originUi)) leaveMenu();
    return;
  }
  const rowGap = originRowGap(textLineHeight(TEXT.SMALL));
  const aim = frame.aimScreen;
  // マウスが実際に動いた時だけホバーでカーソルを奪う（キーボード操作を上書きしないため）
  const aimMoved = aim !== null && (menuAimPrev === null || menuAimPrev.x !== aim.x || menuAimPrev.y !== aim.y);
  const hovered = aim ? originItemAt(aim.x, aim.y, rowGap, originUi.stage) : null;
  if (aimMoved && hovered && pointOriginRow(originUi, hovered)) sfx.play("menuMove");
  menuAimPrev = aim;

  const navX = arrowX !== 0 ? arrowX : edgeDir(menuNav.prevX, frame.move.x);
  const navY = arrowY !== 0 ? arrowY : edgeDir(menuNav.prevY, frame.move.y);
  menuNav.prevX = frame.move.x;
  menuNav.prevY = frame.move.y;
  if (moveOriginCursor(originUi, navX, navY)) sfx.play("menuMove");

  const clicked = frame.clickPressed && hovered !== null;
  if (clicked && hovered) pointOriginRow(originUi, hovered);
  if (!frame.confirmPressed && !clicked) return;
  const result = activateOriginCursor(originUi);
  if (result === "none") return;
  sfx.play("uiClick");
  if (result !== "start") return;
  runSetup = originSetup(originUi);
  openQuestChoice(frame.move.x, frame.move.y);
}

/** 鍛冶場・交換所で得た残響を、装備画面が持つ保存データへ移して保存する（step の中では保存しない） */
function drainEchoes(s: GameState): void {
  const pending = s.runEvents.pendingEchoes;
  if (!TRAIT_COLORS.some((c) => pending[c] > 0)) return;
  const save = inventoryUi.echo.save;
  for (const c of TRAIT_COLORS) {
    save.echoes[c] += pending[c];
    pending[c] = 0;
  }
  saveCraft(save);
}

function beginRun(seedText: string): void {
  // 拠点の state はランに持ち込まない（試した誓約も消える）。次に拠点へ入るとき作り直す
  hub = null;
  inventoryUi.open = false;
  runSetup = withLockedRelics(runSetup);
  runStartedAt = Date.now();
  loadoutDirty = false;
  state = startGame(seedText);
  // スナップショットは createGame の後に取る（startJob が倉庫へ入れる初期スキル石の有無を記録に残すため）
  recorder = ReplayRecorder.fromStartedGame(
    { seedText, startedAt: runStartedAt, daily: isDailySeedText(seedText), setup: runSetup, hitstopScale: settings.hitstopScale },
    state,
  );
  // 受けた依頼（やり直し・同じシードでの再挑戦は起点画面を通らないので、保存の active を引き継ぐ）
  state.questRun.key = isQuestKey(questSave.active) ? questSave.active : null;
  // 連携の発見: 図鑑の既知を写す（初発見の表示・手がかり枠・発見の依頼が読む。ゲーム進行には効かない）
  seedKnownLinks(state.codexRun.links, codexSave);
  deathMetaLines = [];
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
  // 武器掛けの借り物はランが終わると消える（saveProfile も書かないが、手元の profile からも外す）
  returnLoaned(current.profile);
  saveProfile(current.profile);
  deathMetaLines = recordMeta(current, now);
  if (recorder) {
    replays = pushReplay(recorder.finish({ depth: current.depth, kills: current.kills, score: current.score }, now));
    recorder = null;
  }
}

// ---------------------------------------------------------------------------
// メタ進行（依頼の 3 択・図鑑・依頼の一覧・実績。src/meta/）
// ---------------------------------------------------------------------------

/** 死亡画面に出す、ラン終了時の依頼・図鑑・実績の結果 */
let deathMetaLines: string[] = [];
let questChoiceUi: QuestChoiceScreen = createQuestChoice([]);
let listUi: ListScreen = createListScreen();
/** 一覧画面のタブ（開いたときと決定のたびに作り直す） */
let listTabs: ListTab[] = [];

/** ラン 1 回ぶんを図鑑・依頼・実績へ畳んで保存する。戻り値は死亡画面の行 */
function recordMeta(s: GameState, now: number): string[] {
  const discovered = recordCodex(s, codexSave);
  saveCodex(codexSave);
  const outcome = recordQuest(s, questSave, now);
  saveQuests(questSave);
  const jobsPlayed = noteJobPlayed(achievementSave, s.job);
  const unlocked = evaluateAchievements({ codex: codexSave, quests: questSave, meta: s.profile.meta, jobsPlayed }, achievementSave, now);
  saveAchievements(achievementSave);
  return metaSummaryLines(outcome, discovered, unlocked);
}

function openQuestChoice(frameMoveX: number, frameMoveY: number): void {
  questChoiceUi = createQuestChoice(pickQuestOffers(questSave, hashSeed(pendingSeedText)), carriedQuest(questSave));
  screen = "questChoice";
  menuNav.prevX = frameMoveX;
  menuNav.prevY = frameMoveY;
  menuAimPrev = null;
}

function updateQuestChoice(frame: FrameInput, escape: boolean, arrowX: number, arrowY: number): void {
  if (escape) {
    sfx.play("uiClose");
    openOrigin(pendingSeedText, frame.move.x, frame.move.y);
    return;
  }
  const aim = frame.aimScreen;
  const aimMoved = aim !== null && (menuAimPrev === null || menuAimPrev.x !== aim.x || menuAimPrev.y !== aim.y);
  const hovered = aim ? questChoiceItemAt(questChoiceUi, aim.x, aim.y) : null;
  if (aimMoved && hovered !== null && hovered !== questChoiceUi.cursor) {
    questChoiceUi.cursor = hovered;
    sfx.play("menuMove");
  }
  menuAimPrev = aim;
  const navX = arrowX !== 0 ? arrowX : edgeDir(menuNav.prevX, frame.move.x);
  const navY = arrowY !== 0 ? arrowY : edgeDir(menuNav.prevY, frame.move.y);
  menuNav.prevX = frame.move.x;
  menuNav.prevY = frame.move.y;
  if (moveQuestChoice(questChoiceUi, navX, navY)) sfx.play("menuMove");
  const clicked = frame.clickPressed && hovered !== null;
  if (clicked && hovered !== null) questChoiceUi.cursor = hovered;
  if (!frame.confirmPressed && !clicked) return;
  sfx.play("uiClick");
  questSave.active = chosenQuest(questChoiceUi);
  saveQuests(questSave);
  beginRun(pendingSeedText);
}

function listTabsFor(kind: ListScreenKind): ListTab[] {
  if (kind === "codex") return codexListTabs(codexSave, codexPages(questSave));
  if (kind === "questBoard") return questBoardTabs(questSave);
  if (kind === "tips") return tipsListTabs();
  return achievementTabs(achievementSave, questSave);
}

const TITLE_MENU_SCREEN: Readonly<Record<TitleMenuItem, ListScreenKind>> = {
  codex: "codex",
  quests: "questBoard",
  achievements: "achievements",
  tips: "tips",
};

const LIST_SCREEN_TITLE: Readonly<Record<ListScreenKind, string>> = {
  codex: "図鑑",
  questBoard: "依頼",
  achievements: "実績",
  tips: "Tips ノート",
};

const LIST_SCREEN_HINT: Readonly<Record<ListScreenKind, string>> = {
  codex: "←→ タブ　↑↓ / ホイール 選ぶ　Esc 戻る",
  questBoard: "←→ タブ　↑↓ / ホイール 選ぶ　Esc 戻る",
  achievements: "←→ タブ　↑↓ / ホイール 選ぶ　Enter / クリック 称号を名乗る　Esc 戻る",
  tips: "←→ タブ　↑↓ / ホイール 選ぶ　Esc 戻る",
};

function openListScreen(next: ListScreenKind, frameMoveX: number, frameMoveY: number): void {
  screen = next;
  listUi = createListScreen();
  listTabs = listTabsFor(next);
  menuNav.prevX = frameMoveX;
  menuNav.prevY = frameMoveY;
  menuAimPrev = null;
}

/** 一覧画面（図鑑・依頼・実績・祭壇）の共通の入力。カーソル移動の音もここで鳴らす */
function stepListInput(frame: FrameInput, arrowX: number, arrowY: number): ListAction {
  const aim = frame.aimScreen;
  const aimMoved = aim !== null && (menuAimPrev === null || menuAimPrev.x !== aim.x || menuAimPrev.y !== aim.y);
  menuAimPrev = aim;
  const navX = arrowX !== 0 ? arrowX : edgeDir(menuNav.prevX, frame.move.x);
  const navY = arrowY !== 0 ? arrowY : edgeDir(menuNav.prevY, frame.move.y);
  menuNav.prevX = frame.move.x;
  menuNav.prevY = frame.move.y;
  const input = { navX, navY, wheel: frame.wheel, aim, aimMoved, click: frame.clickPressed, confirm: frame.confirmPressed };
  const action = stepListScreen(listUi, listTabs, input, listRowGap(textLineHeight(TEXT.SMALL)));
  if (action === "moved" || action === "tab") sfx.play("menuMove");
  return action;
}

function updateListScreenFrame(kind: ListScreenKind, frame: FrameInput, escape: boolean, arrowX: number, arrowY: number): void {
  if (escape) {
    sfx.play("uiClose");
    leaveMenu();
    return;
  }
  const action = stepListInput(frame, arrowX, arrowY);
  if (action !== "activate" || kind !== "achievements" || listUi.tab !== ACHIEVEMENT_TITLE_TAB) return;
  const entry = listCursorEntry(listUi, listTabs);
  if (!entry || !selectTitle(achievementSave, questSave, titleIdOfEntry(entry.key))) return;
  saveAchievements(achievementSave);
  listTabs = listTabsFor(kind);
  sfx.play("uiClick");
}

// ---------------------------------------------------------------------------
// 拠点（タイトル → 拠点 → 井戸 → 起点 → 依頼 → ラン。docs/ideas/hub-design.md）
// ---------------------------------------------------------------------------

const ALTAR_TITLE = "祭壇";
const ALTAR_HINT = "↑↓ / ホイール 選ぶ　Enter / クリック 試す　Esc 拠点へ";
/**
 * 拠点の state。リプレイに記録しないので `state` とは別に持つ
 * （`state` に入れると、ループ先頭の死亡判定や endRun が拠点を 1 ランとして記録してしまう）
 */
let hub: HubSession | null = null;
let hubDecor: HubDecor[] = [];
let hubBanner: string | null = null;
let hubBannerTimer = 0;
/** 起点画面・一覧画面・履歴の Esc の戻り先。拠点の台から開いたら拠点、タイトルから開いたらタイトル、ポーズから開いたらポーズ */
let menuReturn: "title" | "hub" | "paused" = "title";
const departLatch = createHoldLatch();

function hubSource(): ReturnType<typeof hubProgressSource> {
  return hubProgressSource(profile, skillProfile, codexSave, achievementSave, questSave);
}

/** 拠点へ入る。毎回作り直す（祭壇の試し打ちや木人の状態は持ち越さない） */
function openHub(): void {
  const src = hubSource();
  const built = builtFacilities(src);
  const hubSave = loadHub();
  hubBanner = facilityBuiltBanner(newlyBuilt(built, hubSave));
  hubBannerTimer = hubBanner === null ? 0 : HUB.bannerSeconds;
  saveHub(markFacilitiesSeen(hubSave, built));
  hub = createHub(profile, skillProfile, availableSpots(built), settings.hitstopScale);
  inventoryUi.open = false;
  returnToHub();
}

/** ラン後に拠点へ戻る。次の出撃が同じ迷宮にならないよう、シードを新しくする（死亡画面の R と同じ扱い） */
function openHubAfterRun(): void {
  committedSeedText = randomSeedText();
  seedInput.text = committedSeedText;
  syncSeedUrl(committedSeedText);
  openHub();
}

/** 設備の画面から拠点へ戻る。拠点の state はそのまま */
function returnToHub(): void {
  if (!hub) {
    openHub();
    return;
  }
  // 実績の画面で称号を名乗り替えると看板が変わる
  hubDecor = hubDecorations(hubSource());
  resetHoldLatch(departLatch);
  menuReturn = "hub";
  screen = "hub";
}

/** 起点画面・一覧画面・履歴の Esc */
function leaveMenu(): void {
  if (menuReturn === "hub") {
    returnToHub();
    return;
  }
  if (menuReturn === "paused" && state) {
    // ポーズの一覧から戻るだけ。以後の既定の戻り先はタイトルに戻す
    menuReturn = "title";
    // menuNav は一覧の入力が毎フレーム更新しているので、画面を戻すだけでよい
    screen = "paused";
    return;
  }
  screen = "title";
}

function leaveHub(): void {
  hub = null;
  inventoryUi.open = false;
  menuReturn = "title";
  screen = "title";
}

function openHubSpot(spot: HubSpotKey, session: HubSession, frame: FrameInput): void {
  const open = hubOpenFor(spot);
  sfx.play("uiClick");
  if (open.kind === "inventory") {
    openInventoryAt(session.state, inventoryUi, open.tab, open.bud);
    return;
  }
  if (open.kind === "altar") {
    openAltar(session, frame.move.x, frame.move.y);
    return;
  }
  if (open.kind === "rack") {
    openRack(session, frame.move.x, frame.move.y);
    return;
  }
  menuReturn = "hub";
  if (open.screen === "origin") openOrigin(committedSeedText, frame.move.x, frame.move.y);
  else if (open.screen === "history") openHistory();
  else openListScreen(open.screen, frame.move.x, frame.move.y);
}

function tickHubBanner(dt: number): void {
  if (hubBannerTimer <= 0) return;
  hubBannerTimer = Math.max(0, hubBannerTimer - dt);
  if (hubBannerTimer === 0) hubBanner = null;
}

function updateHubFrame(session: HubSession, frame: FrameInput, escape: boolean, dt: number): void {
  tickHubBanner(dt);
  // 装備画面は stepHub より前に処理する（開いている間は paused で拠点の時間が止まる。Tab は拠点でも使える）
  updateInventoryUi(session.state, inventoryUi, frame, dt);
  if (inventoryUi.open) {
    // 装備画面で押した Enter を、閉じた後の出撃の長押しに数えない
    resetHoldLatch(departLatch);
    if (escape) {
      inventoryUi.open = false;
      session.state.paused = false;
    }
    drainSfx(session.state);
    drainEchoes(session.state);
    return;
  }
  if (escape) {
    sfx.play("uiClose");
    leaveHub();
    return;
  }
  const action = stepHub(session, frame, dt, latchedHold(departLatch, input.confirmHeld()));
  drainSfx(session.state);
  drainEchoes(session.state);
  if (action.kind === "open") {
    openHubSpot(action.spot, session, frame);
    return;
  }
  if (action.kind !== "depart") return;
  // 即出撃: 前回の支度（runSetup）と保存中の依頼のまま始める
  sfx.play("uiClick");
  beginRun(committedSeedText);
}

function openAltar(session: HubSession, frameMoveX: number, frameMoveY: number): void {
  screen = "altar";
  listUi = createListScreen();
  listTabs = altarTabs(session.hub.trialKeystone);
  menuNav.prevX = frameMoveX;
  menuNav.prevY = frameMoveY;
  menuAimPrev = null;
}

function updateAltarFrame(session: HubSession, frame: FrameInput, escape: boolean, arrowX: number, arrowY: number): void {
  if (escape) {
    sfx.play("uiClose");
    returnToHub();
    return;
  }
  if (stepListInput(frame, arrowX, arrowY) !== "activate") return;
  const entry = listCursorEntry(listUi, listTabs);
  if (!entry) return;
  setTrialKeystone(session, trialKeyOfEntry(entry.key));
  listTabs = altarTabs(session.hub.trialKeystone);
  sfx.play("uiClick");
}

const RACK_TITLE = "武器掛け";
const RACK_HINT = "矢印 選ぶ　Enter / クリック 試す　Enter 長押し 借りる　↓で調整欄（←→ 増減）　Esc 拠点へ";
/** 武器掛けで決定キーを押し続けている秒（HUB.rackBorrowHold で借りる） */
let rackHold = 0;
const rackLatch = createHoldLatch();
let rackUi: RackUi = createRackUi();
let rackCardList: RackCard[] = [];
/** 「装備のまま」のカードに出す武器種（開いたときと借りたときだけ数え直す） */
let rackEquipped: MovesetKey | null = null;

function refreshRackCards(session: HubSession): void {
  rackCardList = rackCards(session.hub.trialMoveset);
  rackEquipped = equippedMoveset(session.state.profile);
}

function openRack(session: HubSession, frameMoveX: number, frameMoveY: number): void {
  screen = "rack";
  rackUi = createRackUi();
  refreshRackCards(session);
  rackHold = 0;
  resetHoldLatch(rackLatch);
  menuNav.prevX = frameMoveX;
  menuNav.prevY = frameMoveY;
  menuAimPrev = null;
}

function stepRackInput(frame: FrameInput, arrowX: number, arrowY: number): RackAction {
  const aim = frame.aimScreen;
  const aimMoved = aim !== null && (menuAimPrev === null || menuAimPrev.x !== aim.x || menuAimPrev.y !== aim.y);
  menuAimPrev = aim;
  const navX = arrowX !== 0 ? arrowX : edgeDir(menuNav.prevX, frame.move.x);
  const navY = arrowY !== 0 ? arrowY : edgeDir(menuNav.prevY, frame.move.y);
  menuNav.prevX = frame.move.x;
  menuNav.prevY = frame.move.y;
  const input = { navX, navY, wheel: frame.wheel, aim, aimMoved, click: frame.clickPressed, confirm: frame.confirmPressed };
  return stepRack(rackUi, rackCardList, input);
}

/** 短押し（決定）で試し、長押しで借りる。試すカードは押した瞬間に替わるので、借りる前に振り心地が変わって見える */
function updateRackFrame(session: HubSession, frame: FrameInput, escape: boolean, arrowX: number, arrowY: number, dt: number): void {
  if (escape) {
    sfx.play("uiClose");
    returnToHub();
    return;
  }
  applyRackAction(session, stepRackInput(frame, arrowX, arrowY));
  const target = rackCursorCard(rackUi, rackCardList)?.moveset ?? null;
  rackHold = target !== null && latchedHold(rackLatch, input.confirmHeld()) ? rackHold + dt : 0;
  if (target === null || rackHold < HUB.rackBorrowHold) return;
  rackHold = 0;
  resetHoldLatch(rackLatch);
  const borrowed = borrowRackEntry(session, { kind: "moveset", key: target }, Date.now());
  sfx.play(borrowed ? "uiClick" : "uiClose");
  refreshRackCards(session);
}

/** カードは試し、調整欄は拠点の資源を書き換える（拠点の state はリプレイにも保存にも載らない） */
function applyRackAction(session: HubSession, action: RackAction): void {
  if (action.kind === "none") return;
  if (action.kind === "moved") {
    sfx.play("menuMove");
    return;
  }
  if (action.kind === "try") {
    setTrialWeapon(session, action.moveset);
    refreshRackCards(session);
  } else if (action.kind === "adjust") {
    setHubResource(session, action.resource, hubResourceRatio(session, action.resource) + action.delta);
  } else {
    fillHubResources(session);
  }
  sfx.play("uiClick");
}

function drawRackFrame(ctx: CanvasRenderingContext2D, session: HubSession): void {
  const resources = { hp: hubResourceRatio(session, "hp"), mana: hubResourceRatio(session, "mana"), energy: hubResourceRatio(session, "energy") };
  drawRackScreen(ctx, {
    title: RACK_TITLE,
    hint: RACK_HINT,
    ui: rackUi,
    cards: rackCardList,
    resources,
    equipped: rackEquipped,
    borrowHold: rackHold / HUB.rackBorrowHold,
    lookup: (key) => renderer.atlasSprite(key),
  });
}

/** 拠点の重ね描きに出す、試している武器と借り物の名前 */
function rackLabels(session: HubSession): { trialWeapon: string | null; loaned: string | null; trialUltimate: string | null } {
  const h = session.hub;
  const trialWeapon = h.trialMoveset === null ? null : rackEntryName({ kind: "moveset", key: h.trialMoveset });
  const eq = session.state.profile.equipment;
  const loaned = eq.mainHand?.loaned === true ? [eq.mainHand.name] : [];
  return { trialWeapon, loaned: loaned.length > 0 ? loaned.join(" / ") : null, trialUltimate: trialUltimateName(session) };
}

function drawHubScreen(ctx: CanvasRenderingContext2D, session: HubSession): void {
  const s = session.state;
  const h = session.hub;
  const spots = { spots: h.layout.spots, available: h.available, near: h.near };
  // 台はマップの物なので world 層で描く（HUD や装備画面より下）。拠点以外の描画に残らないよう描いたら外す
  renderer.setHubView(spots);
  renderGame(s, inventoryUi.open ? null : lastAim);
  renderer.setHubView(null);
  drawHubOverlay(ctx, s, { ...spots, departHold: h.departHold, trialKeystone: h.trialKeystone, decor: hubDecor, banner: hubBanner, ...rackLabels(session) });
  if (!inventoryUi.open) drawBudUi(ctx, s);
  if (inventoryUi.open) drawInventoryUi(ctx, s, inventoryUi);
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
  historyMessageTimer = 0;
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
  // 連携の発見の表示（初発見・手がかり枠）を本番のランと揃える（beginRun と同じ。ゲーム進行には効かない）
  seedKnownLinks(session.state.codexRun.links, codexSave);
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

/** キー設定・パッド設定を入力と HUD 表記へ反映して保存する */
function applyKeybinds(): void {
  input.setKeybinds(settings.keybinds);
  gamepad.setBinds(settings.padBinds);
  saveSettings(settings);
}

function openKeybinds(mode: BindsMode, frameMoveX: number, frameMoveY: number): void {
  keybindsMode = mode;
  keybindsCursor = 0;
  keybindsSlot = 0;
  keybindsScroll = 0;
  setKeybindsCapturing(false);
  screen = "keybinds";
  menuNav.prevX = frameMoveX;
  menuNav.prevY = frameMoveY;
}

function setKeybindsCapturing(on: boolean): void {
  keybindsCapturing = on;
  input.setCapturing(on && keybindsMode === "key");
  if (on && keybindsMode === "pad") padCapture.start(gamepad.buttonsDown());
}

/** パッド設定の取得モード: ボタン（組み合わせ）が確定したら選択中の列に入れる。Esc / Start で取り消し */
function updatePadBindCapture(): void {
  if (keyboardEscape || gamepad.pausePressed()) {
    setKeybindsCapturing(false);
    sfx.play("uiClose");
    return;
  }
  const code = padCapture.step(gamepad.buttonsDown(), gamepad.buttonsJustPressed());
  if (code === null) return;
  const row = PADBINDS_ROWS[keybindsCursor];
  const next = row !== undefined && isPadActionRow(row) ? assignPadBinding(settings.padBinds, row, keybindsSlot, code) : null;
  setKeybindsCapturing(false);
  if (!next) {
    sfx.play("uiClose");
    return;
  }
  settings.padBinds = next;
  applyKeybinds();
  sfx.play("uiClick");
}

/** 取得モード: 直前フレームに押されたコードを順に見て、最初の割り当て可能なものを選択中の列に入れる */
function updateKeybindCapture(escape: boolean): void {
  if (keybindsMode === "pad") {
    updatePadBindCapture();
    return;
  }
  for (let code = input.takeAnyPressedCode(); code !== null; code = input.takeAnyPressedCode()) {
    if (code === "Escape") break;
    if (!isAssignableCode(code)) continue;
    const row = KEYBINDS_ROWS[keybindsCursor];
    const next = row !== undefined && isActionRow(row) ? assignBinding(settings.keybinds, row, keybindsSlot, code) : null;
    setKeybindsCapturing(false);
    if (!next) {
      sfx.play("uiClose");
      return;
    }
    settings.keybinds = next;
    applyKeybinds();
    sfx.play("uiClick");
    return;
  }
  // Escape（キーボード）/ パッド B は取り消し
  if (!escape) return;
  setKeybindsCapturing(false);
  sfx.play("uiClose");
}

/** キー設定の行を決定する。アクション行は取得モードへ、既定に戻す / 閉じる はその場で実行 */
function activateKeybindsRow(frameMoveX: number, frameMoveY: number): void {
  if (keybindsCursor >= bindsRowCount(keybindsMode)) return;
  const row = bindsExtraRow(keybindsMode, keybindsCursor);
  sfx.play("uiClick");
  if (row === null) {
    setKeybindsCapturing(true);
  } else if (row === "reset") {
    if (keybindsMode === "pad") resetPadBinds(settings);
    else resetKeybinds(settings);
    applyKeybinds();
  } else {
    enterMenu("settings", frameMoveX, frameMoveY);
  }
}

/** Delete / Backspace: 選択中の列を空にする（最後の 1 つは消せない） */
function clearSelectedKeybind(): void {
  if (keybindsMode === "pad") {
    clearSelectedPadBind();
    return;
  }
  const row = KEYBINDS_ROWS[keybindsCursor];
  if (row === undefined || !isActionRow(row)) return;
  const next = clearBinding(settings.keybinds, row, keybindsSlot);
  if (!next) {
    sfx.play("uiClose");
    return;
  }
  settings.keybinds = next;
  applyKeybinds();
  sfx.play("uiClick");
}

/** パッド設定の選択中の列を空にする（パッドはキーボードが残るので最後の 1 つも消せる） */
function clearSelectedPadBind(): void {
  const row = PADBINDS_ROWS[keybindsCursor];
  if (row === undefined || !isPadActionRow(row)) return;
  const next = clearPadBinding(settings.padBinds, row, keybindsSlot);
  if (!next) {
    sfx.play("uiClose");
    return;
  }
  settings.padBinds = next;
  applyKeybinds();
  sfx.play("uiClick");
}

function drawKeybindsOverlay(ctx: CanvasRenderingContext2D): void {
  drawKeybindsScreen(
    ctx,
    {
      mode: keybindsMode,
      binds: settings.keybinds,
      padBinds: settings.padBinds,
      cursor: keybindsCursor,
      slot: keybindsSlot,
      scroll: keybindsScroll,
      capturing: keybindsCapturing,
    },
    true,
  );
}

/** タイトルに出す称号と、マウスが乗っているメニュー項目 */
function titleMetaView(): { title: string | null; hovered: TitleMenuItem | null } {
  const aim = lastAim;
  return { title: currentTitleLabel(achievementSave, questSave), hovered: aim ? titleMenuItemAt(aim.x, aim.y) : null };
}

/** 依頼の達成音（8-10）はラン中に達成へ届いた瞬間に 1 回だけ。判定は meta/quests.ts を読むだけ */
const questCheer = new RisingEdge();
function questDoneInRun(s: GameState): boolean {
  const key = s.questRun.key;
  return key !== null && questProgress(key, questSnapshot(s)).done;
}

/**
 * 音楽の切り替え（src/audio/music.ts）。state は音楽を知らないので、ここで state を読んで曲を選ぶ。
 * ラン中の画面（プレイ・一時停止・設定・装備画面）と拠点は鳴らし続け、タイトル系・死亡後は止める
 */
const MUSIC_RUN_SCREENS: ReadonlySet<Screen> = new Set<Screen>(["playing", "paused", "settings", "keybinds", "replay"]);
/** 拠点の画面。ランの state は無いので、拠点の曲だけを流す */
const MUSIC_HUB_SCREENS: ReadonlySet<Screen> = new Set<Screen>(["hub", "altar", "rack"]);
function updateMusic(): void {
  if (hub && MUSIC_HUB_SCREENS.has(screen)) {
    music.update(musicCue({ inRun: true, hub: true, floorKind: "rooms", engaged: false, boss: false, bossDown: false, seed: 0, depth: 0 }));
    return;
  }
  const s = screen === "replay" ? (replay?.session.state ?? null) : state;
  const inRun = s !== null && s.status !== "dead" && MUSIC_RUN_SCREENS.has(screen);
  if (!s || !inRun) {
    music.update(musicCue({ inRun: false, floorKind: "rooms", engaged: false, boss: false, bossDown: false, seed: 0, depth: 0 }));
    return;
  }
  // ボス曲は 5 の倍数の階の階層ボス（major）だけ。毎階の階の主では鳴らさない
  const bossFoe = s.boss?.major === true && !s.boss.defeated ? bossEnemy(s) : undefined;
  music.update(
    musicCue({
      inRun,
      floorKind: s.floorKind,
      engaged: isEngaged(s),
      // ボスの部屋が封鎖されてから（登場演出以降）ボス曲にする
      boss: bossFoe !== undefined && s.rooms[s.boss?.roomIndex ?? -1]?.locked === true,
      bossDown: bossFoe !== undefined && isStaggered(bossFoe),
      seed: s.seed,
      depth: s.depth,
      slowmo: s.slowmo > 0,
    }),
  );
  if (questCheer.update(s, questDoneInRun(s))) sfx.play("questComplete");
}

function drainSfx(s: GameState | null = state): void {
  if (!s) return;
  const names = s.sfx.splice(0);
  for (const name of names) sfx.play(name);
}

/** 死亡時サマリの「ボス撃破数」。5 の倍数の階の階層ボス（major）だけ数える（毎階の階の主は数えない） */
function trackBoss(s: GameState): void {
  const defeated = s.boss?.major === true && s.boss.defeated;
  if (defeated && !prevBossDefeated) bossesDefeated += 1;
  prevBossDefeated = defeated;
}

function foundItems(p: Profile): Item[] {
  const equipped = Object.values(p.equipment).filter((it): it is Item => it !== null);
  return [...p.stash, ...equipped];
}

const GAMEPAD_HINT_TEXT = "ゲームパッドを接続しました";
const GAMEPAD_HINT_COLOR = "#e0e0e0";
const GAMEPAD_HINT_Y_FROM_BOTTOM = 6;

/** state や render に触れず、画面下に一時的な接続通知だけ重ねて描く */
function drawGamepadConnectedHint(ctx: CanvasRenderingContext2D): void {
  if (gamepadConnectedTimer <= 0) return;
  drawText(ctx, GAMEPAD_HINT_TEXT, VIEW_W / 2, VIEW_H - GAMEPAD_HINT_Y_FROM_BOTTOM, TEXT.SMALL, GAMEPAD_HINT_COLOR, "center");
}

/** アイテム情報表示 ON/OFF の切替通知。state を書き換えない表示側だけの仕組み（gamepadConnectedTimer と同じ流儀） */
function drawDropInfoHint(ctx: CanvasRenderingContext2D): void {
  if (dropInfoHintTimer <= 0) return;
  const text = `アイテム情報: ${settings.dropTooltip ? "オン" : "オフ"}`;
  drawText(ctx, text, VIEW_W / 2, VIEW_H - GAMEPAD_HINT_Y_FROM_BOTTOM, TEXT.SMALL, GAMEPAD_HINT_COLOR, "center");
}

/** 画面揺れの強度は renderer / system を触らず、描画直前だけカメラオフセットを倍率適用して戻す */
function renderGame(s: GameState, aim: { x: number; y: number } | null): void {
  const savedOffset = s.camera.offset;
  s.camera.offset = { x: savedOffset.x * settings.screenShake, y: savedOffset.y * settings.screenShake };
  renderer.render(s, aim, settings.dropTooltip);
  s.camera.offset = savedOffset;
}

/**
 * canvas は index.html で cursor: none にしている（プレイ中はクロスヘアを描くため）。
 * クロスヘアを描かない画面（装備画面・タイトル系・祝福選択）では OS のマウスカーソルを見せる
 */
let cursorVisible = false;
function updateCursorVisibility(cur: GameState | null): void {
  const inWorld = screen === "playing" || screen === "hub";
  const wantVisible = inventoryUi.open || !inWorld || cur?.boonChoice != null;
  if (wantVisible === cursorVisible) return;
  cursorVisible = wantVisible;
  canvas.style.cursor = wantVisible ? "default" : "none";
}

startLoop(
  (dt) => {
    const frame = input.snapshot((state ?? hub?.state)?.camera.offset);
    const hotkeys = processMenuKeys(menuKeys.drain(), seedInput);
    keyboardEscape = hotkeys.escape;
    // B / Start はメニューの「戻る/ポーズ」として Escape 相当に統合する。
    // ただしプレイ中（装備画面を閉じている間）は B がダッシュと共用なので、ポーズは Start だけで開く
    const padInGame = (screen === "playing" || screen === "hub") && !inventoryUi.open;
    if (padInGame ? gamepad.pausePressed() : input.gamepadEscapePressed()) hotkeys.escape = true;
    lastAim = frame.aimScreen;
    updateMusic();

    if (gamepad.consumeJustConnected()) gamepadConnectedTimer = GAMEPAD_CONNECTED_MESSAGE_DURATION;
    if (gamepadConnectedTimer > 0) gamepadConnectedTimer = Math.max(0, gamepadConnectedTimer - dt);
    if (dropInfoHintTimer > 0) dropInfoHintTimer = Math.max(0, dropInfoHintTimer - dt);

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
          menuReturn = "title";
          openHistory();
          break;
        }
        if (hotkeys.d) {
          sfx.play("uiClick");
          menuReturn = "title";
          openOrigin(dailySeedText(new Date()), frame.move.x, frame.move.y);
          break;
        }
        if (hotkeys.o) {
          sfx.play("uiClick");
          returnScreen = "title";
          settingsCursor = 0;
          enterMenu("settings", frame.move.x, frame.move.y);
          break;
        }
        const clickedMenu = frame.clickPressed && frame.aimScreen ? titleMenuItemAt(frame.aimScreen.x, frame.aimScreen.y) : null;
        const menuItem = titleMenuHotkey(hotkeys) ?? clickedMenu;
        if (menuItem) {
          sfx.play("uiClick");
          menuReturn = "title";
          openListScreen(TITLE_MENU_SCREEN[menuItem], frame.move.x, frame.move.y);
          break;
        }
        if (frame.confirmPressed || frame.clickPressed) {
          sfx.play("uiClick");
          openHub();
        }
        break;
      }

      case "hub": {
        if (!hub) {
          screen = "title";
          break;
        }
        updateHubFrame(hub, frame, hotkeys.escape, dt);
        break;
      }

      case "altar": {
        if (!hub) {
          screen = "title";
          break;
        }
        updateAltarFrame(hub, frame, hotkeys.escape, hotkeys.arrowX, hotkeys.arrowY);
        break;
      }

      case "rack": {
        if (!hub) {
          screen = "title";
          break;
        }
        updateRackFrame(hub, frame, hotkeys.escape, hotkeys.arrowX, hotkeys.arrowY, dt);
        break;
      }

      case "origin": {
        updateOriginScreen(frame, hotkeys.escape, hotkeys.arrowX, hotkeys.arrowY);
        break;
      }

      case "questChoice": {
        updateQuestChoice(frame, hotkeys.escape, hotkeys.arrowX, hotkeys.arrowY);
        break;
      }

      case "codex":
      case "questBoard":
      case "achievements":
      case "tips": {
        updateListScreenFrame(screen, frame, hotkeys.escape, hotkeys.arrowX, hotkeys.arrowY);
        break;
      }

      case "history": {
        if (historyMessageTimer > 0) {
          historyMessageTimer = Math.max(0, historyMessageTimer - dt);
          if (historyMessageTimer === 0) historyMessage = "";
        }
        if (hotkeys.escape) {
          leaveMenu();
          break;
        }
        const history = profile.meta.history ?? [];
        // ホイールは一覧の表示だけを送る対象（このスクロール窓は別レーンの担当）。カーソルは矢印キーでのみ動かす
        const navY = hotkeys.arrowY;
        if (navY !== 0) {
          historyCursor = moveHistoryCursor(historyCursor, navY, history.length);
          historyMessage = "";
          historyMessageTimer = 0;
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
          if (!data) {
            historyMessage = NO_REPLAY_MESSAGE;
          } else if (replayAvailability(data) === "old") {
            historyMessage = OLD_REPLAY_MESSAGE;
            historyMessageTimer = OLD_REPLAY_MESSAGE_DURATION;
          } else {
            startReplay(data);
          }
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

        // mute/volume/screenShake の調整をまとめる。close はここでは何もしない（クリック/Esc 専用）
        const applySettingsAdjust = (item: SettingsItem, dir: number): void => {
          if (item === "mute") {
            toggleMute(settings);
            applySettings();
          } else if (item === "volume") {
            adjustVolume(settings, dir);
            applySettings();
          } else if (item === "musicVolume") {
            adjustMusicVolume(settings, dir);
            applySettings();
          } else if (item === "screenShake") {
            adjustScreenShake(settings, dir);
            saveSettings(settings);
          } else if (item === "hitstopScale") {
            adjustHitstopScale(settings, dir);
            applyHitstopScale();
          } else if (item === "dropTooltip") {
            toggleDropTooltip(settings);
            saveSettings(settings);
          }
        };

        // ゲージのドラッグ/クリック: 0..1 の値を位置から直接決める（← → の刻みとは別経路）
        const applyGaugeValue = (item: SettingsGaugeItem, value01: number): void => {
          if (item === "volume") {
            setVolume(settings, value01);
            applySettings();
          } else if (item === "musicVolume") {
            setMusicVolume(settings, value01);
            applySettings();
          } else if (item === "screenShake") {
            setScreenShake(settings, value01);
            saveSettings(settings);
          } else {
            setHitstopScale(settings, value01);
            applyHitstopScale();
          }
        };

        const rowGap = Math.max(18, textLineHeight(TEXT.SMALL));
        const aim = frame.aimScreen;
        // マウスが実際に動いた時だけホバーでカーソルを奪う（キーボード操作を上書きしないため）
        const aimMoved = aim !== null && (menuAimPrev === null || menuAimPrev.x !== aim.x || menuAimPrev.y !== aim.y);
        if (aimMoved) {
          const hovered = settingsItemAt(aim.x, aim.y, rowGap);
          if (hovered !== null && hovered !== settingsCursor) {
            settingsCursor = hovered;
            sfx.play("menuMove");
          }
        }

        const keyNavY = edgeDir(menuNav.prevY, frame.move.y);
        const navY = keyNavY !== 0 ? keyNavY : Math.sign(frame.wheel);
        if (navY !== 0) {
          settingsCursor = cycleIndex(settingsCursor, navY, SETTINGS_ITEMS.length);
          sfx.play("menuMove");
        }
        const navX = edgeDir(menuNav.prevX, frame.move.x);
        if (navX !== 0) {
          const current = SETTINGS_ITEMS[settingsCursor];
          if (current) {
            applySettingsAdjust(current, navX);
            sfx.play("uiClick");
          }
        }
        menuNav.prevX = frame.move.x;
        menuNav.prevY = frame.move.y;
        menuAimPrev = aim;

        // 決定（Enter / パッド A）はキー設定を開く・閉じるだけ。値の調整は ← → とクリック
        if (frame.confirmPressed) {
          const current = SETTINGS_ITEMS[settingsCursor];
          if (current === "keybinds" || current === "padBinds") {
            sfx.play("uiClick");
            openKeybinds(current === "padBinds" ? "pad" : "key", frame.move.x, frame.move.y);
            break;
          }
          if (current === "close") {
            sfx.play("uiClick");
            screen = returnScreen;
            break;
          }
        }

        // ゲージのドラッグ: 左ボタンを押している間、ゲージの上ならその位置の値を直接設定する
        // （クリックの瞬間だけでなく、押しっぱなしで動かしている間も毎フレーム追従する）
        if (frame.clickHeld && aim) {
          const held = settingsItemAt(aim.x, aim.y, rowGap);
          const heldItem = held !== null ? SETTINGS_ITEMS[held] : undefined;
          if (held !== null && heldItem && isSettingsGaugeItem(heldItem)) {
            const gauge = settingsGaugeRect(heldItem, rowGap);
            if (gauge && aim.x >= gauge.x && aim.x <= gauge.x + gauge.w) {
              settingsCursor = held;
              applyGaugeValue(heldItem, settingsGaugeValueAt(aim.x, gauge));
              if (frame.clickPressed) sfx.play("uiClick");
            }
          }
        }

        if (frame.clickPressed && aim) {
          const clicked = settingsItemAt(aim.x, aim.y, rowGap);
          const item = clicked !== null ? SETTINGS_ITEMS[clicked] : undefined;
          const clickedGauge = item && isSettingsGaugeItem(item) ? settingsGaugeRect(item, rowGap) : null;
          const clickedInsideGauge = clickedGauge !== null && aim.x >= clickedGauge.x && aim.x <= clickedGauge.x + clickedGauge.w;
          if (clicked !== null && item && !clickedInsideGauge) {
            settingsCursor = clicked;
            if (item === "close") {
              screen = returnScreen;
            } else if (item === "keybinds" || item === "padBinds") {
              openKeybinds(item === "padBinds" ? "pad" : "key", frame.move.x, frame.move.y);
            } else {
              applySettingsAdjust(item, item === "mute" || item === "dropTooltip" ? 1 : settingsRowSide(aim.x));
            }
            sfx.play("uiClick");
          }
        }
        break;
      }

      case "keybinds": {
        if (keybindsCapturing) {
          updateKeybindCapture(hotkeys.escape);
          menuNav.prevX = frame.move.x;
          menuNav.prevY = frame.move.y;
          break;
        }
        if (hotkeys.escape) {
          enterMenu("settings", frame.move.x, frame.move.y);
          break;
        }

        const rowGap = keybindsRowGap();
        const aim = frame.aimScreen;
        // マウスが実際に動いた時だけホバーでカーソルを奪う（キーボード操作を上書きしないため）
        const aimMoved = aim !== null && (menuAimPrev === null || menuAimPrev.x !== aim.x || menuAimPrev.y !== aim.y);
        if (aimMoved) {
          const hovered = keybindsItemAt(aim.x, aim.y, rowGap, keybindsScroll, keybindsMode);
          if (hovered && (hovered.row !== keybindsCursor || (hovered.slot !== null && hovered.slot !== keybindsSlot))) {
            keybindsCursor = hovered.row;
            if (hovered.slot !== null) keybindsSlot = hovered.slot;
            sfx.play("menuMove");
          }
        }

        // 移動キーを割り当て直しても迷子にならないよう、矢印キーは束縛と無関係に常に効かせる
        const keyNavY = edgeDir(menuNav.prevY, frame.move.y);
        const navY = hotkeys.arrowY !== 0 ? hotkeys.arrowY : keyNavY;
        if (navY !== 0) {
          keybindsCursor = cycleIndex(keybindsCursor, navY, bindsRowCount(keybindsMode));
          sfx.play("menuMove");
        }
        const keyNavX = edgeDir(menuNav.prevX, frame.move.x);
        const navX = hotkeys.arrowX !== 0 ? hotkeys.arrowX : keyNavX;
        if (navX !== 0) {
          keybindsSlot = cycleIndex(keybindsSlot, navX, KEYBIND_SLOTS);
          sfx.play("menuMove");
        }
        keybindsScroll = keybindsScrollFor(keybindsCursor, keybindsScroll, rowGap, keybindsMode);
        // ホイールは表示だけを送る（カーソルは動かさない）
        if (frame.wheel !== 0) keybindsScroll = clampKeybindsScroll(keybindsScroll + Math.sign(frame.wheel), rowGap, keybindsMode);
        menuNav.prevX = frame.move.x;
        menuNav.prevY = frame.move.y;
        menuAimPrev = aim;

        // パッド設定ではパッドの Y でも空にできる（パッドだけで設定を終えられるように）
        const padClear = keybindsMode === "pad" && (gamepad.buttonsJustPressed()[PAD_Y] ?? false);
        if (hotkeys.clear || padClear) {
          clearSelectedKeybind();
          break;
        }
        if (frame.confirmPressed) {
          activateKeybindsRow(frame.move.x, frame.move.y);
        } else if (frame.clickPressed && aim) {
          const clicked = keybindsItemAt(aim.x, aim.y, rowGap, keybindsScroll, keybindsMode);
          if (clicked) {
            keybindsCursor = clicked.row;
            if (clicked.slot !== null) keybindsSlot = clicked.slot;
            activateKeybindsRow(frame.move.x, frame.move.y);
          }
        }
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

        const applyPauseItem = (item: PauseMenuItem): void => {
          if (item === "resume") {
            screen = "playing";
            cur.paused = false;
          } else if (item === "settings") {
            returnScreen = "paused";
            settingsCursor = 0;
            enterMenu("settings", frame.move.x, frame.move.y);
          } else if (item === "tips") {
            menuReturn = "paused";
            openListScreen("tips", frame.move.x, frame.move.y);
          } else if (item === "restart") {
            endRun(cur);
            beginRun(randomSeedText());
          } else {
            endRun(cur);
            cur.paused = false;
            state = null;
            openHubAfterRun();
          }
        };

        const itemGap = Math.max(16, textLineHeight(TEXT.SMALL));
        const aim = frame.aimScreen;
        // マウスが実際に動いた時だけホバーでカーソルを奪う（キーボード操作を上書きしないため）
        const aimMoved = aim !== null && (menuAimPrev === null || menuAimPrev.x !== aim.x || menuAimPrev.y !== aim.y);
        if (aimMoved) {
          const hovered = pauseMenuItemAt(aim.x, aim.y, itemGap);
          if (hovered !== null && hovered !== pauseCursor) {
            pauseCursor = hovered;
            sfx.play("menuMove");
          }
        }

        const keyNavY = edgeDir(menuNav.prevY, frame.move.y);
        const navY = keyNavY !== 0 ? keyNavY : Math.sign(frame.wheel);
        if (navY !== 0) {
          pauseCursor = cycleIndex(pauseCursor, navY, PAUSE_MENU_ITEMS.length);
          sfx.play("menuMove");
        }
        menuNav.prevX = frame.move.x;
        menuNav.prevY = frame.move.y;
        menuAimPrev = aim;

        if (frame.confirmPressed) {
          const current = PAUSE_MENU_ITEMS[pauseCursor];
          if (current) {
            sfx.play("uiClick");
            applyPauseItem(current);
          }
        } else if (frame.clickPressed && aim) {
          const clicked = pauseMenuItemAt(aim.x, aim.y, itemGap);
          const item = clicked !== null ? PAUSE_MENU_ITEMS[clicked] : undefined;
          if (clicked !== null && item) {
            pauseCursor = clicked;
            sfx.play("uiClick");
            applyPauseItem(item);
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
            openHubAfterRun();
            break;
          }
          if (deathConfirmPressed(frame, cur.deathTimer)) beginRun(cur.seedText);
          else if (frame.restartPressed) beginRun(randomSeedText());
        } else if (frame.restartPressed) {
          // 死んでいない状態で R を押した中断も、ラン結果として一度だけメタと履歴に記録する
          endRun(cur);
          beginRun(randomSeedText());
        }

        if (cur.status === "playing" && frame.toggleDropInfoPressed) {
          toggleDropTooltip(settings);
          saveSettings(settings);
          dropInfoHintTimer = DROP_INFO_HINT_DURATION;
        }

        if (state) {
          stepRecorded(state, frame, dt);
          trackBoss(state);
          drainSfx();
          drainEchoes(state);
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
      drawTitle(ctx, titleTime, GAME_NAME, seedInput, computeTitleStats(profile), titleMetaView());
      drawGamepadConnectedHint(ctx);
      return;
    }
    if (screen === "hub" && hub) {
      drawHubScreen(ctx, hub);
      drawGamepadConnectedHint(ctx);
      return;
    }
    if (screen === "rack" && hub) {
      drawRackFrame(ctx, hub);
      drawGamepadConnectedHint(ctx);
      return;
    }
    if (screen === "altar") {
      drawListScreen(ctx, { title: ALTAR_TITLE, tabs: listTabs, ui: listUi, rowGap: listRowGap(textLineHeight(TEXT.SMALL)), hint: ALTAR_HINT });
      drawGamepadConnectedHint(ctx);
      return;
    }
    if (screen === "questChoice") {
      drawQuestChoice(ctx, questChoiceUi, questSave, titleTime);
      drawGamepadConnectedHint(ctx);
      return;
    }
    if (screen === "codex" || screen === "questBoard" || screen === "achievements" || screen === "tips") {
      drawListScreen(ctx, {
        title: LIST_SCREEN_TITLE[screen],
        tabs: listTabs,
        ui: listUi,
        rowGap: listRowGap(textLineHeight(TEXT.SMALL)),
        hint: LIST_SCREEN_HINT[screen],
        detailSide: screen === "tips",
      });
      drawGamepadConnectedHint(ctx);
      return;
    }
    if (screen === "origin") {
      drawOriginScreen(ctx, originUi, titleTime, originRowGap(textLineHeight(TEXT.SMALL)));
      drawGamepadConnectedHint(ctx);
      return;
    }
    if (screen === "history") {
      drawHistoryScreen(ctx, {
        history: profile.meta.history ?? [],
        cursor: historyCursor,
        replayStatus: (i) => {
          const entry = profile.meta.history?.[i];
          if (entry === undefined) return "none";
          return replayAvailability(findReplayForEntry(replays, entry));
        },
        message: historyMessage,
      });
      drawGamepadConnectedHint(ctx);
      return;
    }
    if ((screen === "settings" || screen === "keybinds") && returnScreen === "title") {
      drawTitle(ctx, titleTime, GAME_NAME, seedInput, computeTitleStats(profile), titleMetaView());
      if (screen === "settings") drawSettingsScreen(ctx, settings, settingsCursor, true);
      else drawKeybindsOverlay(ctx);
      drawGamepadConnectedHint(ctx);
      return;
    }

    if (screen === "replay" && replay) {
      const session = replay.session;
      renderGame(session.state, session.lastInput.aimScreen);
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
      drawTitle(ctx, titleTime, GAME_NAME, seedInput, computeTitleStats(profile), titleMetaView());
      drawGamepadConnectedHint(ctx);
      return;
    }

    renderGame(cur, inventoryUi.open || screen !== "playing" ? null : lastAim);

    if (!inventoryUi.open) drawBudUi(ctx, cur);
    if (inventoryUi.open) drawInventoryUi(ctx, cur, inventoryUi);
    if (screen === "paused") drawPauseMenu(ctx, pauseCursor, questStatusLine(cur));
    if (screen === "settings") drawSettingsScreen(ctx, settings, settingsCursor, true);
    if (screen === "keybinds") drawKeybindsOverlay(ctx);
    if (cur.status === "dead" && cur.deathTimer > DEATH_INPUT_DELAY) {
      drawDeathSummary(ctx, {
        itemSummary: summarizeRunItems(foundItems(cur.profile), runStartedAt),
        bestCombo: cur.combo.best,
        bossesDefeated,
        metaLines: deathMetaLines,
      });
    }
    drawGamepadConnectedHint(ctx);
    drawDropInfoHint(ctx);
  },
);
