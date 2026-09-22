import { type GameState } from "../core/state";
import { type Vec, fromAngle, scale } from "../core/vec";

/** パーティクル・テキスト・揺れなど「気持ちよさ」担当。ロジックには影響しない */

export function spawnBurst(
  state: GameState,
  pos: Vec,
  color: string,
  count: number,
  speed: number,
  life = 0.35,
  size = 2,
): void {
  for (let i = 0; i < count; i++) {
    const dir = fromAngle(state.rng.next() * Math.PI * 2);
    const v = scale(dir, speed * (0.4 + state.rng.next() * 0.8));
    state.particles.push({
      pos: { ...pos },
      vel: v,
      life,
      maxLife: life,
      color,
      size: size * (0.6 + state.rng.next() * 0.8),
      drag: 0.9,
    });
  }
}

/** 方向性のある飛沫（斬撃ヒットなど） */
export function spawnDirectional(
  state: GameState,
  pos: Vec,
  dir: Vec,
  color: string,
  count: number,
  speed: number,
  spread = 0.7,
): void {
  const base = Math.atan2(dir.y, dir.x);
  for (let i = 0; i < count; i++) {
    const a = base + (state.rng.next() - 0.5) * spread * 2;
    const v = scale(fromAngle(a), speed * (0.5 + state.rng.next() * 0.9));
    state.particles.push({
      pos: { ...pos },
      vel: v,
      life: 0.3,
      maxLife: 0.3,
      color,
      size: 1.5 + state.rng.next() * 1.5,
      drag: 0.88,
    });
  }
}

export function addFloatingText(
  state: GameState,
  pos: Vec,
  text: string,
  color: string,
  scale = 1,
  life = 0.6,
): void {
  state.texts.push({
    pos: { x: pos.x + (state.rng.next() - 0.5) * 6, y: pos.y - 8 },
    vel: { x: (state.rng.next() - 0.5) * 20, y: -40 },
    text,
    color,
    life,
    maxLife: life,
    scale,
  });
}

export function shake(state: GameState, amount: number): void {
  state.camera.shake = Math.max(state.camera.shake, amount);
}

export function hitstop(state: GameState, steps: number): void {
  state.hitstop = Math.max(state.hitstop, steps);
}

export function updateEffects(state: GameState, dt: number): void {
  for (const p of state.particles) {
    p.life -= dt;
    p.pos.x += p.vel.x * dt;
    p.pos.y += p.vel.y * dt;
    p.vel.x *= p.drag;
    p.vel.y *= p.drag;
  }
  state.particles = state.particles.filter((p) => p.life > 0);

  for (const t of state.texts) {
    t.life -= dt;
    t.pos.x += t.vel.x * dt;
    t.pos.y += t.vel.y * dt;
    t.vel.y *= 0.92;
  }
  state.texts = state.texts.filter((t) => t.life > 0);

  state.flash = Math.max(0, state.flash - dt * 4);
}
