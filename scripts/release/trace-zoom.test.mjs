import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const config = JSON.parse(read('src-tauri/tauri.conf.json'));
const capability = JSON.parse(read('src-tauri/capabilities/default.json'));
for (const window of config.app.windows) {
  assert.equal(window.zoomHotkeysEnabled, false, 'native page zoom must not compete with board zoom');
}
assert.ok(!capability.permissions.includes('core:webview:allow-set-webview-zoom'), 'whole-app zoom IPC is unnecessary');
assert.ok(read('src/tracker/TrackerApp.tsx').includes('<BoardZoomViewport><div className={`board-frame'));
assert.ok(read('src/tracker/TrackerApp.tsx').includes('</BoardZoomViewport><div className="turn-controls">'), 'playback stays outside zoom');
const css = read('src/tracker/tracker.css');
assert.match(css, /\.board-zoom-viewport\s*\{[^}]*overflow:\s*auto;[^}]*scrollbar-width:\s*none;/, 'board stays scrollable without scrollbar chrome');
assert.match(css, /\.board-zoom-viewport::-webkit-scrollbar\s*\{[^}]*display:\s*none;/, 'older WebKit also hides scrollbar chrome');
console.log('Trace zoom: board-only wiring, hidden scrollbars, and native page zoom disabled.');
