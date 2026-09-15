import assert from 'node:assert/strict';
import { createSetupFlow, setupLabel, type SetupState } from '../setup-flow.js';
import type { TrackerEnvironment } from '../types.js';

function fixture() {
  const environment = { clientRunning: false, capture: { permissionReady: false, enabled: true, observerRunning: true, waitingForMatchEnd: false, lastError: null } } as TrackerEnvironment;
  const states: SetupState[] = [];
  const calls: string[] = [];
  const deps = {
    environment: async () => environment,
    check: async (): Promise<any> => { calls.push('check'); return null; },
    permission: async () => { calls.push('permission'); return { ...environment.capture, permissionReady: true }; },
    start: async () => { calls.push('start'); return environment.capture; },
    restart: async () => { calls.push('restart'); },
    capture: () => { calls.push('capture'); },
  };
  return { environment, states, calls, deps, create: () => createSetupFlow(deps, s => states.push(s)) };
}

{
  const f = fixture(); await f.create().run();
  assert.deepEqual(f.states.map(s => s.phase), ['checking', 'approval', 'connecting', 'ready']);
  assert.deepEqual(f.calls, ['check', 'permission', 'start', 'capture']);
}
{
  const f = fixture(); f.environment.capture.permissionReady = true;
  await f.create().run(); assert.ok(!f.calls.includes('permission'));
}
{
  const f = fixture(); f.environment.clientRunning = true;
  const flow = f.create(); await flow.run();
  assert.equal(f.states.at(-1)?.phase, 'close-live'); assert.deepEqual(f.calls, []);
  f.environment.clientRunning = false; await flow.run();
  assert.equal(f.states.at(-1)?.phase, 'ready');
}
{
  const f = fixture(); f.deps.permission = async () => f.environment.capture;
  const flow = f.create(); await flow.run();
  assert.equal(f.states.at(-1)?.phase, 'failed'); assert.ok(!f.calls.includes('start'));
  f.environment.capture.permissionReady = true; await flow.run();
  assert.equal(f.states.at(-1)?.phase, 'ready');
}
{
  const f = fixture(); f.deps.check = async () => { throw new Error('Offline. Check your internet connection and try again.'); };
  await f.create().run(); assert.match(f.states.at(-1)!.message, /Offline/);
  assert.ok(!f.calls.includes('permission'));
}
{
  const f = fixture(); let release!: () => void;
  f.deps.check = async () => { f.calls.push('check'); await new Promise<void>(r => { release = r; }); return null; };
  const flow = f.create(); const first = flow.run();
  await flow.run(); await new Promise(r => setImmediate(r)); release(); await first;
  assert.equal(f.calls.filter(c => c === 'check').length, 1);
}
{
  const f = fixture();
  f.deps.check = async () => ({
    download: async () => { f.calls.push('download'); f.environment.clientRunning = true; },
    install: async () => { f.calls.push('install'); }, close: async () => {},
  });
  const flow = f.create(); await flow.run(); assert.equal(f.states.at(-1)?.phase, 'update');
  await flow.run(); assert.equal(f.states.at(-1)?.phase, 'close-live'); assert.ok(!f.calls.includes('install'));
  f.environment.clientRunning = false; await flow.run(); assert.equal(f.states.at(-1)?.phase, 'restart');
  assert.equal(f.calls.filter(c => c === 'download').length, 1);
  await flow.run(); assert.ok(f.calls.includes('restart')); assert.ok(!f.calls.includes('start'));
}
for (const status of [{ waitingForMatchEnd: true }, { enabled: false }, { observerRunning: false }, { lastError: 'Helper unavailable' }]) {
  const f = fixture(); Object.assign(f.environment.capture, status);
  await f.create().run(); assert.equal(f.states.at(-1)?.phase, 'waitingForMatchEnd' in status ? 'close-live' : 'failed');
}
assert.equal(setupLabel('initial'), 'Set up Trace');
assert.equal(setupLabel('failed'), 'Try again');
assert.equal(setupLabel('ready'), 'Done');
console.log('setup-flow: 11 scenarios passed (fresh setup, reconnect, Live blockers, permission failure/retry, offline, double click, update safety, capture failures).');
