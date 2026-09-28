// 1 枚を描く（build / preview 共通）
import { Builder } from "./body.mjs";
import { render } from "./engine.mjs";
import { POSES, skeleton } from "./rig.mjs";
import { CANVAS } from "./styles.mjs";

export function drawFrame(style, job, poseKey, { weapon = true } = {}) {
  const pose = { ...POSES[poseKey], ...(job.poses?.[poseKey] ?? {}) };
  const S = skeleton(style.fig, pose, { x: CANVAS.anchorX, ground: CANVAS.ground });
  const B = new Builder(S, style);
  B.groundY = CANVAS.ground;
  job.draw(B);
  const parts = weapon ? B.parts : B.parts.filter((p) => p.group !== "weapon");
  const px = render(parts, B.marks, style, CANVAS.w, CANVAS.h);
  return pose.mirrorOut ? mirror(px) : px;
}

/** 素材で左を向いているコマ: 足元の中心で左右を返す */
function mirror(px) {
  const { w, h, anchorX } = CANVAS;
  const out = new Array(w * h).fill(null);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const X = 2 * anchorX - x;
      if (X >= 0 && X < w) out[y * w + X] = px[y * w + x];
    }
  return out;
}
