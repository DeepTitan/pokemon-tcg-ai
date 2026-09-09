import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const config = JSON.parse(read('src-tauri/tauri.conf.json'));
const capability = JSON.parse(read('src-tauri/capabilities/default.json'));

// Tauri owns Cmd +/-/0 on macOS and Ctrl +/-/0 on Windows. Enabling the
// setting alone is insufficient on macOS: its injected handler needs IPC ACL.
for (const window of config.app.windows) {
  assert.equal(window.zoomHotkeysEnabled, true, `${window.title}: native zoom shortcuts enabled`);
  assert.ok(capability.windows.includes(window.label ?? 'main'), 'zoom capability covers the window');
}
assert.ok(capability.permissions.includes('core:webview:allow-set-webview-zoom'), 'macOS zoom IPC is allowed');

const css = read('src/tracker/tracker.css');
assert.match(css, /body\s*\{[^}]*overflow:\s*auto\b/, 'zoomed content can scroll into view');
assert.match(css, /\.workspace\s*\{\s*height:\s*100vh;\s*min-height:\s*720px;/, 'zoom preserves usable board height');

console.log('Trace zoom: native shortcut configuration, macOS permission, and overflow guards passed.');
