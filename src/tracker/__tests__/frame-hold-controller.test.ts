import assert from 'node:assert/strict';
import { createFrameHoldController } from '../frame-hold-controller.js';

let time = 0;
let id = 0;
const timers = new Map<number, { at: number; callback: () => void }>();
const clock = {
  now: () => time,
  schedule: (callback: () => void, delay: number) => {
    const key = ++id;
    timers.set(key, { at: time + delay, callback });
    return key as unknown as ReturnType<typeof setTimeout>;
  },
  cancel: (key: ReturnType<typeof setTimeout>) => { timers.delete(key as unknown as number); },
};
function advance(milliseconds: number) {
  const end = time + milliseconds;
  while (timers.size) {
    const [key, next] = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
    if (next.at > end) break;
    time = next.at;
    timers.delete(key);
    next.callback();
  }
  time = end;
}
const repeats: { at: number; speed: number }[] = [];
const hold = createFrameHoldController({ ...clock, onRepeat: speed => repeats.push({ at: time, speed }) });
hold.start();
advance(349);
assert.equal(repeats.length, 0, 'Quick taps must not also trigger a repeated step');
hold.stop();
advance(1000);
assert.equal(repeats.length, 0, 'Releasing before the hold threshold cancels it');

const start = time;
hold.start();
advance(4000);
const early = repeats.filter(step => step.at - start <= 1000).length;
const late = repeats.filter(step => step.at - start > 3000).length;
assert.ok(early > 0 && late >= early * 3, 'A sustained press must accelerate meaningfully');
assert.deepEqual([...new Set(repeats.map(step => step.speed))], [1, 2, 4]);
hold.stop();
const releasedCount = repeats.length;
advance(1000);
assert.equal(repeats.length, releasedCount, 'Releasing stops every scheduled step');
assert.equal(timers.size, 0);

hold.start();
const stale = [...timers.values()][0].callback;
hold.stop();
hold.start();
stale();
assert.equal(repeats.length, releasedCount, 'A callback from an old press cannot affect a new one');
advance(350);
assert.equal(repeats.at(-1)?.speed, 1, 'Each new press starts slowly again');
hold.stop();

let index = 101;
const boundary = createFrameHoldController({ ...clock, onRepeat: () => {
  index++;
  if (index === 103) boundary.stop();
} });
boundary.start();
advance(5000);
assert.equal(index, 103, 'Stopping inside a step must not schedule another step beyond the boundary');
assert.equal(timers.size, 0);
console.log('frame-hold-controller: tap threshold, acceleration, release, restart and boundary cancellation verified');
