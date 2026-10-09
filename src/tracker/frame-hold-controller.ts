type Timer = ReturnType<typeof setTimeout>;

/** Start slowly enough to inspect frames, then accelerate while the press lasts. */
export function createFrameHoldController({ onRepeat, now = Date.now, schedule = setTimeout, cancel = clearTimeout }: {
  onRepeat: (speed: number) => void;
  now?: () => number;
  schedule?: (callback: () => void, delay: number) => Timer;
  cancel?: (timer: Timer) => void;
}) {
  let timer: Timer | undefined;
  let generation = 0;
  const stop = () => {
    generation++;
    if (timer !== undefined) cancel(timer);
    timer = undefined;
  };
  const start = () => {
    stop();
    const press = generation;
    const started = now();
    const repeat = () => {
      if (press !== generation) return;
      const elapsed = now() - started;
      const speed = elapsed >= 2600 ? 4 : elapsed >= 1200 ? 2 : 1;
      onRepeat(speed);
      // The callback can stop at a boundary or when its view is dismissed.
      if (press === generation) timer = schedule(repeat, 250 / speed);
    };
    timer = schedule(repeat, 350);
  };
  return { start, stop };
}
