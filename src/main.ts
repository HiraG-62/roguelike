import { createGame, descend, movePlayer } from "./core/state";
import { hashSeed } from "./core/rng";
import { CanvasRenderer } from "./render/canvas";
import { keyToCommand } from "./ui/input";

const canvas = document.getElementById("game");
if (!(canvas instanceof HTMLCanvasElement)) throw new Error("#game canvas not found");

// URL の ?seed=xxx で再現。無ければ時刻から生成
const params = new URLSearchParams(location.search);
const seedParam = params.get("seed");
const seed = seedParam ? hashSeed(seedParam) : Date.now() >>> 0;

const state = createGame(seed);
const renderer = new CanvasRenderer(canvas);
renderer.render(state);

window.addEventListener("keydown", (ev) => {
  const cmd = keyToCommand(ev.key);
  if (!cmd) return;
  ev.preventDefault();

  switch (cmd.type) {
    case "move":
      movePlayer(state, cmd.dir);
      break;
    case "descend":
      descend(state);
      break;
  }
  renderer.render(state);
});
