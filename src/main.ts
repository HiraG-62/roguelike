import { SfxPlayer } from "./audio/sfx";
import { createGame, step } from "./core/game";
import { PlayerInput } from "./core/input";
import { startLoop } from "./core/loop";
import { hashSeed } from "./core/rng";
import type { GameState } from "./core/state";
import { loadProfile } from "./loot/profile";
import { drawInventoryUi } from "./render/inventoryUi";
import { Renderer } from "./render/renderer";
import { recordRunOnce } from "./system/combat";
import { createInventoryUi, updateInventoryUi } from "./ui/inventory";

const canvas = document.getElementById("game");
if (!(canvas instanceof HTMLCanvasElement)) throw new Error("#game canvas not found");

const SEED_PARAM = "seed";
/** 死亡演出が出そろうまでリスタート入力を受け付けない */
const DEATH_INPUT_DELAY = 0.6;

function initialSeedText(): string {
  return new URLSearchParams(location.search).get(SEED_PARAM) ?? randomSeedText();
}

function randomSeedText(): string {
  return (Date.now() >>> 0).toString(36);
}

// プロフィール（装備・stash）はラン間で共有。拾った瞬間に保存される
const profile = loadProfile();

function startGame(seedText: string): GameState {
  const url = new URL(location.href);
  url.searchParams.set(SEED_PARAM, seedText);
  history.replaceState(null, "", url);
  return createGame(hashSeed(seedText), seedText, profile);
}

let state = startGame(initialSeedText());
const input = new PlayerInput();
input.attachKeyboard(window);
input.attachMouse(canvas);
const renderer = new Renderer(canvas);
const inventoryUi = createInventoryUi();
const sfx = new SfxPlayer();
let lastAim: { x: number; y: number } | null = null;

// ブラウザの autoplay 制約: 最初の操作で AudioContext を起こす
const unlockAudio = (): void => sfx.unlock();
window.addEventListener("keydown", unlockAudio);
window.addEventListener("mousedown", unlockAudio);

function drainSfx(): void {
  const names = state.sfx.splice(0);
  for (const name of names) sfx.play(name);
}

startLoop(
  (dt) => {
    const frame = input.snapshot();
    lastAim = frame.aimScreen;

    // 装備画面は step の pause 判定より前に処理する（paused を UI が切り替える）
    updateInventoryUi(state, inventoryUi, frame, dt);
    if (inventoryUi.open) {
      drainSfx();
      return;
    }

    if (state.status === "dead" && state.deathTimer > DEATH_INPUT_DELAY) {
      if (frame.confirmPressed) state = startGame(state.seedText);
      else if (frame.restartPressed) state = startGame(randomSeedText());
    } else if (frame.restartPressed) {
      // 死んでいない状態で R を押した中断も、ラン結果として一度だけメタに記録する
      recordRunOnce(state);
      state = startGame(randomSeedText());
    }
    step(state, frame, dt);
    drainSfx();
  },
  () => {
    renderer.render(state, inventoryUi.open ? null : lastAim);
    if (inventoryUi.open) drawInventoryUi(renderer.context, state, inventoryUi);
  },
);
