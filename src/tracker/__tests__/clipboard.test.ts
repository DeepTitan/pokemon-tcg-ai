import assert from 'node:assert/strict';
import { clearMocks, mockIPC } from '@tauri-apps/api/mocks';
import { writeClipboardText } from '../tauri.js';

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
const browserWrites: string[] = [];
Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {
  clipboard: { writeText: async () => { throw new Error('Browser clipboard denied'); } },
} });

try {
  const nativeWrites: string[] = [];
  mockIPC((command, args) => {
    assert.equal(command, 'write_clipboard_text');
    assert.deepEqual(Object.keys(args || {}), ['text']);
    nativeWrites.push((args as { text: string }).text);
  });
  const url = 'https://victoryroad.app/trace/abcdefghijklmnopqrstuvwx';
  // Sharing has already awaited a network response. Native copying must still work
  // even when the embedded browser has no clipboard permission/user activation.
  await Promise.resolve();
  await writeClipboardText(url);
  const deck = 'Pokémon: 1\n4 N’s Zoroark ex JTG 98\n\nTotal Cards: 60';
  await writeClipboardText(deck);
  assert.deepEqual(nativeWrites, [url, deck]);

  mockIPC(() => { throw new Error('Native clipboard busy'); });
  await assert.rejects(writeClipboardText(url), /Native clipboard busy/,
    'A failed native write must not report success or silently use the denied browser path');
  clearMocks();
  delete window.__TAURI_INTERNALS__;

  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {
    clipboard: { writeText: async (text: string) => { browserWrites.push(text); } },
  } });
  await writeClipboardText(url);
  assert.deepEqual(browserWrites, [url], 'The web preview keeps its browser clipboard path');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {
    clipboard: { writeText: async () => { throw new Error('Clipboard permission denied'); } },
  } });
  await assert.rejects(writeClipboardText(url), /Clipboard permission denied/);
} finally {
  clearMocks();
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
  else Reflect.deleteProperty(globalThis, 'window');
  if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
  else Reflect.deleteProperty(globalThis, 'navigator');
}
console.log('clipboard native routing and error handling tests passed');
