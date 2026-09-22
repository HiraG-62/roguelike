import { type GameState, createGame, descend } from "./core/state";
import { playerMoveOrAttack, runMonsterTurns } from "./core/turn";
import { hashSeed } from "./core/rng";
import { CanvasRenderer } from "./render/canvas";
import { keyToCommand } from "./ui/input";

const canvas = document.getElementById("game");
if (!(canvas instanceof HTMLCanvasElement)) throw new Error("#game canvas not found");

// URL の ?seed=xxx で再現。無ければ時刻から生成
function resolveSeed(): number {
  const seedParam = new URLSearchParams(location.search).get("seed");
  return seedParam ? hashSeed(seedParam) : Date.now() >>> 0;
}

let state: GameState = createGame(resolveSeed());
const renderer = new CanvasRenderer(canvas);
renderer.render(state);

const KEY_RESTART = "Enter";

window.addEventListener("keydown", (ev) => {
  if (state.status === "dead") {
    if (ev.key !== KEY_RESTART) return;
    state = createGame(resolveSeed());
    renderer.render(state);
    return;
  }

  const cmd = keyToCommand(ev.key);
  if (!cmd) return;
  ev.preventDefault();

  let tookTurn = false;
  switch (cmd.type) {
    case "move":
      tookTurn = playerMoveOrAttack(state, cmd.dir);
      break;
    case "descend":
      tookTurn = descend(state);
      break;
  }
  if (tookTurn) runMonsterTurns(state);
  renderer.render(state);
});
