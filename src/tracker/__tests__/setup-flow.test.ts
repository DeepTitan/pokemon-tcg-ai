import assert from 'node:assert/strict';
import { createSetupFlow, setupLabel, type SetupState } from '../setup-flow.js';
import type { TrackerEnvironment } from '../types.js';

function fixture() {
  const environment = { clientRunning: false, capture: { permissionReady: false, enabled: true, observerRunning: true, routeActive: true, clientAttached: false, waitingForMatchEnd: false, lastError: null } } as TrackerEnvironment;
  const states: SetupState[] = [];
  const calls: string[] = [];
  const deps = {
    environment: async () => environment,
    check: async (): Promise<any> => { calls.push('check'); return null; },
    permission: async () => { calls.push('permission'); return { ...environment.capture, permissionReady: true }; },
    start: async () => { calls.push('start'); return environment.capture; },
    background: async () => { calls.push('background'); },
    restart: async () => { calls.push('restart'); },
    capture: () => { calls.push('capture'); },
    waitForRetry: async () => {},
  };
  return { environment, states, calls, deps, create: () => createSetupFlow(deps, s => states.push(s)) };
}

{
  const f = fixture(); await f.create().run();
  assert.deepEqual(f.states.map(s => s.phase), ['checking', 'approval', 'checking', 'connecting', 'startup', 'ready']);
  assert.deepEqual(f.calls, ['check', 'permission', 'start', 'capture', 'background']);
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
  await f.create().run(); assert.match(f.states.at(-1)!.message, /internet connection/);
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
{
  // A slow environment check after successful approval must not keep telling
  // the user to approve a prompt that has already disappeared.
  const f = fixture(); let approved = false; let release!: () => void;
  f.deps.permission = async () => { approved = true; return { ...f.environment.capture, permissionReady: true }; };
  f.deps.environment = async () => {
    if (approved) await new Promise<void>(resolve => { release = resolve; });
    return f.environment;
  };
  const running = f.create().run();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.states.at(-1)?.phase, 'checking');
  assert.match(f.states.at(-1)!.message, /Approval received/);
  f.environment.clientRunning = true;
  release(); await running;
  assert.equal(f.states.at(-1)?.phase, 'close-live');
  assert.ok(!f.calls.includes('start'));
}
assert.equal(setupLabel('initial'), 'Set up Trace');
assert.equal(setupLabel('failed'), 'Try again');
assert.equal(setupLabel('ready'), 'Done');
{
  const f = fixture();
  f.deps.background = async () => { throw new Error('Sign-in registration failed'); };
  await f.create().run();
  assert.equal(f.states.at(-1)?.phase, 'failed');
  assert.match(f.states.at(-1)!.message, /automatic startup couldn’t be turned on/);
}
{
  const f = fixture(); f.environment.capture.routeActive = false;
  let release!: () => void;
  f.deps.waitForRetry = () => new Promise<void>(resolve => { release = resolve; });
  const pending = f.create().run();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.states.at(-1)?.phase, 'connecting');
  assert.ok(!f.calls.includes('background'), 'do not announce success before routing is ready');
  f.environment.capture.routeActive = true; release(); await pending;
  assert.equal(f.states.at(-1)?.phase, 'ready');
}
{
  const f = fixture(); f.environment.capture.routeActive = false;
  const flow = f.create(); await flow.run();
  assert.equal(f.states.at(-1)?.phase, 'failed');
  assert.match(f.states.at(-1)!.message, /Keep Pokémon closed/);
  assert.ok(!f.calls.includes('background'));
  f.environment.capture.routeActive = true; await flow.run();
  assert.equal(f.states.at(-1)?.phase, 'ready');
}
{
  const f = fixture(); f.environment.capture.routeActive = false;
  f.deps.waitForRetry = async () => { f.environment.clientRunning = true; };
  await f.create().run();
  assert.equal(f.states.at(-1)?.phase, 'close-live');
  assert.ok(!f.calls.includes('background'));
}
{
  const f = fixture(); f.environment.capture.routeActive = false;
  const flow = f.create();
  f.deps.waitForRetry = async () => { flow.dispose(); };
  await flow.run(); assert.ok(!f.calls.includes('background'));
}
{
  const f = fixture(); f.deps.permission = async () => { throw new Error('User canceled. (-128)'); };
  const flow = f.create(); await flow.run();
  assert.match(f.states.at(-1)!.message, /Setup wasn’t approved/);
  assert.doesNotMatch(f.states.at(-1)!.message, /-128/);
  f.environment.capture.permissionReady = true; await flow.run();
  assert.equal(f.states.at(-1)?.phase, 'ready');
}
console.log('setup-flow: first install, approval, connection readiness, retries, and update safety passed.');

// A permission probe can fail while the existing route is still recording.
for (const permissionReady of [false, true]) {
  const f = fixture();
  Object.assign(f.environment, { clientRunning: true });
  Object.assign(f.environment.capture, { clientAttached: true, permissionReady });
  await f.create().run();
  assert.equal(f.states.at(-1)?.phase, 'ready');
  assert.match(f.states.at(-1)!.message, /already connected and recording/);
  assert.deepEqual(f.calls, ['capture'], 'do not update, restart, request permissions, or restart capture');
}
{
  const { shouldOfferInitialSetup, shouldDismissRecoveredSetup, initialSetup } = await import('../setup-flow.js');
  const f = fixture();
  assert.equal(shouldOfferInitialSetup(f.environment, false), true, 'first installation still offers setup');
  assert.equal(shouldOfferInitialSetup(f.environment, true), false, 'an existing user is not blocked by a failed probe');
  f.environment.clientRunning = true;
  assert.equal(shouldOfferInitialSetup(f.environment, false), false, 'never cover an open game with onboarding');
  assert.equal(shouldDismissRecoveredSetup(initialSetup, f.environment), false, 'running game alone does not prove recording');
  f.environment.capture.clientAttached = true;
  assert.equal(shouldDismissRecoveredSetup({ phase: 'close-live', message: 'stale' }, f.environment), true);
  for (const phase of ['initial', 'close-live', 'failed', 'ready'] as const) {
    assert.equal(shouldDismissRecoveredSetup({ phase, message: '' }, f.environment), true, `dismiss recovered ${phase} automatically`);
  }
  for (const phase of ['checking', 'approval', 'connecting', 'startup', 'update', 'updating', 'restart', 'restarting'] as const) {
    assert.equal(shouldDismissRecoveredSetup({ phase, message: '' }, f.environment), false, `let ${phase} settle before dismissal`);
  }
  for (const flag of ['enabled', 'observerRunning', 'routeActive', 'clientAttached'] as const) {
    const environment = { ...f.environment, capture: { ...f.environment.capture, [flag]: false } };
    assert.equal(shouldDismissRecoveredSetup(initialSetup, environment), false, `${flag} is required to prove recording recovered`);
  }
  f.environment.capture.routeActive = false;
  assert.equal(shouldDismissRecoveredSetup(initialSetup, f.environment), false, 'a broken route must not claim recording is ready');
}
for (const boundary of ['environment', 'check', 'permission'] as const) {
  const f = fixture();
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  if (boundary === 'environment') f.deps.environment = async () => { await pending; return f.environment; };
  if (boundary === 'check') f.deps.check = async () => {
    await pending;
    return { download: async () => f.calls.push('download'), install: async () => f.calls.push('install'), close: async () => f.calls.push('close') };
  };
  if (boundary === 'permission') f.deps.permission = async () => { await pending; return { ...f.environment.capture, permissionReady: true }; };
  const flow = f.create();
  const running = flow.run();
  await new Promise(resolve => setImmediate(resolve));
  flow.dispose(); release(); await running;
  assert.ok(!f.calls.includes('start'), `dismiss during ${boundary} must not start recording later`);
  assert.ok(!f.calls.includes('background'));
  assert.ok(!f.calls.includes('install'));
  if (boundary === 'check') assert.ok(f.calls.includes('close'), 'release the downloaded-update resource after dismissal');
}
console.log('setup recovery: active recording, first-run gating, recovered status, and dismissal during pending operations passed.');
