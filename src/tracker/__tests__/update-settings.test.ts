import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Wiring regressions: settings and the notice must share one updater instance.
const app = readFileSync(new URL('../TrackerApp.tsx', import.meta.url), 'utf8');
const updater = readFileSync(new URL('../UpdateNotice.tsx', import.meta.url), 'utf8');
assert.equal((app.match(/<UpdateNotice /g) || []).length, 1);
assert.match(app, /matchInProgress=\{environment.clientRunning\} settingsOpen=\{showSetup\}/);
assert.match(app, /id="settings-updates"/);
assert.doesNotMatch(app, /aria-label="Animated replay frames"/);
assert.match(app, /onClick=\{toggleFrameAnimations\}/);
assert.match(app, /!safetyDismissed && !showSetup/);
assert.match(app, /Continue reviewing/);
assert.match(updater, /Check for updates/);
assert.match(updater, /refresh\(true\)/);
assert.match(updater, /operationRef.current \|\| \['downloaded', 'installing', 'ready', 'restarting'\]/);
assert.equal((updater.match(/await getTrackerEnvironment\(\)/g) || []).length, 2);
assert.match(updater, /setDismissed\(true\)/);
assert.doesNotMatch(updater, /Waiting for match|After this match/);
console.log('update-settings: shared controls, dismissible safety screen, fresh process checks, and background-check guards verified');
