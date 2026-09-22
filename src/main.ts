import { createGame, step } from "./core/game";
import { PlayerInput } from "./core/input";
import { startLoop } from "./core/loop";
import { hashSeed } from "./core/rng";
import type { GameState } from "./core/state";
import { Renderer } from "./render/renderer";

const canvas = document.getElementById("game");
if (!(canvas instanceof HTMLCanvasElement)) throw new Error("#game canvas not found");

const SEED_PARAM = "seed";

function initialSeedText(): string {
  return new URLSearchParams(location.search).get(SEED_PARAM) ?? randomSeedText();
}

function randomSeedText(): string {
  return (Date.now() >>> 0).toString(36);
}

function startGame(seedText: string): GameState {
  const url = new URL(location.href);
  url.searchParams.set(SEED_PARAM, seedText);
  history.replaceState(null, "", url);
  return createGame(hashSeed(seedText), seedText);
}

let state = startGame(initialSeedText());
const input = new PlayerInput();
input.attachKeyboard(window);
input.attachMouse(canvas);
let lastAim: { x: number; y: number } | null = null;
const renderer = new Renderer(canvas);

startLoop(
  (dt) => {
    const frame = input.snapshot();
    lastAim = frame.aimScreen;
    if (state.status === "dead" && state.deathTimer > 0.6) {
      if (frame.confirmPressed) state = startGame(state.seedText);
      else if (frame.restartPressed) state = startGame(randomSeedText());
    } else if (frame.restartPressed) {
      state = startGame(randomSeedText());
    }
    step(state, frame, dt);
  },
  () => renderer.render(state, lastAim),
);
