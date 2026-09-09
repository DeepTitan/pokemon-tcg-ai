import assert from 'node:assert/strict';
import { boardZoomShortcut, nextBoardZoom, boardZoomScroll } from '../board-zoom.js';
const key = (key: string, overrides = {}) => ({ key, code: '', metaKey: false, ctrlKey: false, altKey: false, isComposing: false, ...overrides });
for (const modifier of [{ metaKey: true }, { ctrlKey: true }]) {
  for (const plus of ['+', '=']) assert.equal(boardZoomShortcut(key(plus, modifier)), 'in');
  assert.equal(boardZoomShortcut(key('-', modifier)), 'out');
  assert.equal(boardZoomShortcut(key('0', modifier)), 'reset');
  assert.equal(boardZoomShortcut(key('+', { ...modifier, altKey: true })), null);
  assert.equal(boardZoomShortcut(key('+', { ...modifier, isComposing: true })), null);
  for (const normal of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'w', 'a', 's', 'd']) assert.equal(boardZoomShortcut(key(normal, modifier)), null);
}
assert.equal(boardZoomShortcut(key('+')), null);
assert.equal(boardZoomShortcut(key('', { ctrlKey: true, code: 'NumpadAdd' })), 'in');
assert.equal(boardZoomShortcut(key('', { ctrlKey: true, code: 'NumpadSubtract' })), 'out');
assert.equal(nextBoardZoom(1, 'in'), 1.1);
assert.equal(nextBoardZoom(1.1, 'out'), 1);
assert.equal(nextBoardZoom(2.5, 'in'), 2.5);
assert.equal(nextBoardZoom(0.5, 'out'), 0.5);
assert.equal(nextBoardZoom(2.5, 'reset'), 1);
assert.equal(boardZoomScroll(0, 1000, 1, 1.5), 250);
assert.equal(boardZoomScroll(250, 1000, 1.5, 1), 0);
assert.equal(boardZoomScroll(0, 1000, 0.5, 1), 0);
console.log('Board zoom: Mac/Windows shortcuts, limits, reset, center anchoring, and replay-key isolation passed.');
