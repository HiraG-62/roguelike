import { type GameState, createGame, descend } from "./core/state";
import { playerMoveOrAttack, runMonsterTurns } from "./core/turn";
import { hashSeed } from "./core/rng";
import { CanvasRenderer, type UiState } from "./render/canvas";
import { handleSeedEntryKey, keyToCommand } from "./ui/input";

const canvas = document.getElementById("game");
if (!(canvas instanceof HTMLCanvasElement)) throw new Error("#game canvas not found");

const SEED_PARAM = "seed";
const KEY_RESTART_AFTER_DEATH = "Enter";

/** URL の ?seed=xxx があればそれを使う。無ければ時刻ベースの文字列を作る */
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
const ui: UiState = { seedEntry: null };
const renderer = new CanvasRenderer(canvas);
renderer.render(state, ui);

function onSeedEntryKey(key: string): void {
  if (ui.seedEntry === null) return;
  const result = handleSeedEntryKey(ui.seedEntry, key);
  switch (result.type) {
    case "typing":
      ui.seedEntry = result.buffer;
      return;
    case "submit":
      ui.seedEntry = null;
      state = startGame(result.buffer || randomSeedText());
      return;
    case "cancel":
      ui.seedEntry = null;
      return;
  }
}

function onPlayKey(key: string): void {
  if (state.status === "dead") {
    if (key === KEY_RESTART_AFTER_DEATH) state = startGame(randomSeedText());
    return;
  }
  const cmd = keyToCommand(key);
  if (!cmd) return;

  let tookTurn = false;
  switch (cmd.type) {
    case "move":
      tookTurn = playerMoveOrAttack(state, cmd.dir);
      break;
    case "descend":
      tookTurn = descend(state);
      break;
    case "newGameWithSeed":
      ui.seedEntry = "";
      break;
    case "restart":
      state = startGame(randomSeedText());
      break;
  }
  if (tookTurn) runMonsterTurns(state);
}

window.addEventListener("keydown", (ev) => {
  if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
  if (ui.seedEntry !== null) {
    onSeedEntryKey(ev.key);
  } else {
    onPlayKey(ev.key);
  }
  ev.preventDefault();
  renderer.render(state, ui);
});
