/** 固定タイムステップ。物理と判定をフレームレートから切り離す */
export const FIXED_DT = 1 / 60;
/** タブ復帰などで dt が跳ねたときの上限（秒） */
const MAX_FRAME_TIME = 0.25;
/** 1 描画あたりの最大更新回数。これを超えたら時間を捨てる */
const MAX_STEPS_PER_FRAME = 5;

export function startLoop(update: (dt: number) => void, render: () => void): void {
  let last = performance.now();
  let accumulator = 0;

  const frame = (now: number): void => {
    accumulator += Math.min((now - last) / 1000, MAX_FRAME_TIME);
    last = now;
    let steps = 0;
    while (accumulator >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
      update(FIXED_DT);
      accumulator -= FIXED_DT;
      steps++;
    }
    if (steps === MAX_STEPS_PER_FRAME) accumulator = 0;
    render();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
