import assert from 'node:assert/strict';
import { createAutomaticInterfaceScaler, automaticInterfaceScaleForViewport,
  type InterfaceScaleState, type NativeInterfaceViewport } from '../interface-scale.js';

const viewport = (width: number, height: number, scaleFactor = 1): NativeInterfaceViewport => ({ width, height, scaleFactor });
const deferred = <T>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

for (const [width, height, expected] of [[1440, 900, 1], [1920, 1080, 1.2], [2560, 1440, 1.6], [3840, 2160, 2], [1024, 680, .85], [1280, 800, 1]]) {
  assert.equal(automaticInterfaceScaleForViewport(viewport(width, height)), expected);
}
for (const width of [1024, 1180, 1200, 1280, 1440, 1920, 2560, 3840]) {
  for (const height of [680, 720, 800, 900, 1080, 1440, 2160]) {
    const scale = automaticInterfaceScaleForViewport(viewport(width, height))!;
    assert.ok(scale > 0 && scale <= 2);
    assert.ok(width / scale >= 1200 - 1e-9 && height / scale >= 720 - 1e-9, 'fitted scale keeps the complete minimum canvas visible');
    for (const factor of [1.25, 1.5, 2]) {
      assert.equal(automaticInterfaceScaleForViewport(viewport(width * factor, height * factor, factor)), scale,
        'OS scaling is divided out, not applied twice');
    }
  }
}
for (const value of [0, -1, NaN, Infinity]) {
  assert.equal(automaticInterfaceScaleForViewport(viewport(value, 900)), null);
  assert.equal(automaticInterfaceScaleForViewport(viewport(1440, value)), null);
  assert.equal(automaticInterfaceScaleForViewport(viewport(1440, 900, value)), null);
}

// Restore zoom even at 100%, then skip duplicate native writes.
{
  const writes: number[] = [], states: InterfaceScaleState[] = [];
  const scaler = createAutomaticInterfaceScaler({ readViewport: async () => viewport(1440, 900), setZoom: async (scale) => { writes.push(scale); } }, (state) => states.push(state));
  scaler.refresh(); await settle();
  scaler.refresh(); await settle();
  assert.deepEqual(writes, [1]);
  assert.deepEqual(states.at(-1), { scale: 1, error: null });
  scaler.dispose();
}

// A coherent DPI payload supersedes an older asynchronous geometry read.
{
  const read = deferred<NativeInterfaceViewport>(), writes: number[] = [], states: InterfaceScaleState[] = [];
  let reads = 0;
  const scaler = createAutomaticInterfaceScaler({ readViewport: () => { reads++; return read.promise; }, setZoom: async (scale) => { writes.push(scale); } }, (state) => states.push(state));
  scaler.refresh(); scaler.refresh(viewport(5120, 2880, 2));
  read.resolve(viewport(1440, 900)); await settle();
  assert.equal(reads, 1);
  assert.deepEqual(writes, [1.6]);
  assert.deepEqual(states, [{ scale: 1.6, error: null }]);
  scaler.dispose();
}

// Repeated resize requests serialize reads and retain only the newest result.
{
  const first = deferred<NativeInterfaceViewport>(), second = deferred<NativeInterfaceViewport>(), writes: number[] = [];
  let reads = 0;
  const scaler = createAutomaticInterfaceScaler({ readViewport: () => ++reads === 1 ? first.promise : second.promise, setZoom: async (scale) => { writes.push(scale); } }, () => undefined);
  scaler.refresh(); scaler.refresh(); scaler.refresh();
  assert.equal(reads, 1);
  first.resolve(viewport(1440, 900)); await settle();
  assert.equal(reads, 2);
  assert.deepEqual(writes, []);
  second.resolve(viewport(1920, 1080)); await settle();
  assert.deepEqual(writes, [1.2]);
  scaler.dispose();
}

// Changes during a native write wait for it, then fit the latest window size.
{
  const firstWrite = deferred<void>(), writes: number[] = [], states: InterfaceScaleState[] = [];
  let reads = 0;
  const scaler = createAutomaticInterfaceScaler({ readViewport: async () => { reads++; return reads === 1 ? viewport(3840, 2160) : viewport(2560, 1440); }, setZoom: (scale) => {
    writes.push(scale); return writes.length === 1 ? firstWrite.promise : Promise.resolve();
  } }, (state) => states.push(state));
  scaler.refresh(); await settle();
  scaler.refresh(); scaler.refresh();
  assert.equal(reads, 1, 'no geometry read overlaps a native write');
  assert.deepEqual(writes, [2]);
  firstWrite.resolve(); await settle();
  assert.equal(reads, 2);
  assert.deepEqual(writes, [2, 1.6]);
  assert.deepEqual(states, [{ scale: 1.6, error: null }]);
  scaler.dispose();
}

// Minimized windows preserve the last usable zoom and restore automatically.
{
  const writes: number[] = [];
  const scaler = createAutomaticInterfaceScaler({ readViewport: async () => viewport(1440, 900), setZoom: async (scale) => { writes.push(scale); } }, () => undefined);
  scaler.refresh(); await settle();
  scaler.refresh(viewport(0, 0)); await settle();
  assert.deepEqual(writes, [1], 'minimizing preserves the last usable zoom');
  scaler.refresh(viewport(1920, 1080)); await settle();
  assert.deepEqual(writes, [1, 1.2]);
  scaler.dispose();
}

// Failed reads/writes surface an error and can recover on a later request.
{
  const writes: number[] = [], states: InterfaceScaleState[] = [];
  let failRead = true, failWrite = true;
  const scaler = createAutomaticInterfaceScaler({ readViewport: async () => {
    if (failRead) throw new Error('Window unavailable');
    return viewport(1440, 900);
  }, setZoom: async (scale) => { writes.push(scale); if (failWrite) throw new Error('Zoom unavailable'); } }, (state) => states.push(state));
  scaler.refresh(); await settle();
  assert.deepEqual(states.at(-1), { scale: 1, error: 'Window unavailable' });
  failRead = false;
  scaler.refresh(); await settle();
  assert.deepEqual(states.at(-1), { scale: 1, error: 'Zoom unavailable' });
  failWrite = false;
  scaler.refresh(); await settle();
  assert.deepEqual(writes, [1, 1]);
  assert.deepEqual(states.at(-1), { scale: 1, error: null });
  scaler.dispose();
}

// Stale failures do not obscure a newer valid request.
{
  const first = deferred<NativeInterfaceViewport>(), states: InterfaceScaleState[] = [], writes: number[] = [];
  const scaler = createAutomaticInterfaceScaler({ readViewport: () => first.promise, setZoom: async (scale) => { writes.push(scale); } }, (state) => states.push(state));
  scaler.refresh(); scaler.refresh(viewport(1920, 1080));
  first.reject(new Error('Stale read failed')); await settle();
  assert.deepEqual(writes, [1.2]);
  assert.deepEqual(states, [{ scale: 1.2, error: null }]);
  scaler.dispose();
}

// Disposal stops pending work and notifications, including late registrations.
for (const duringWrite of [false, true]) {
  const read = deferred<NativeInterfaceViewport>(), write = deferred<void>(), writes: number[] = [], states: InterfaceScaleState[] = [];
  let reads = 0;
  const scaler = createAutomaticInterfaceScaler({ readViewport: () => { reads++; return read.promise; }, setZoom: (scale) => { writes.push(scale); return write.promise; } }, (state) => states.push(state));
  scaler.refresh();
  if (duringWrite) { read.resolve(viewport(1440, 900)); await settle(); }
  scaler.refresh(viewport(1920, 1080)); scaler.dispose();
  scaler.refresh();
  read.resolve(viewport(1440, 900)); write.resolve(); await settle();
  assert.equal(reads, 1);
  assert.deepEqual(writes, duringWrite ? [1] : []);
  assert.deepEqual(states, []);
}

console.log('Interface scaling: automatic fit, OS scale equivalence, serialized races, error recovery, and disposal passed.');
