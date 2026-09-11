import assert from 'node:assert/strict';
import { readArchiveSearchIndex, searchArchive } from '../archive-search.js';
import type { MatchSummary } from '../types.js';

const now = new Date(2026, 8, 11, 12);
const match = (id: string, opponent: string, day: number, winner = 'isaiahw'): MatchSummary => ({
  id, opponent, localPlayer: 'isaiahw', importedAt: new Date(2026, 8, day, 14).toISOString(),
  source: 'live-network', winner, recording: false, turnCount: 4, operationCount: 20, reducerVersion: 1,
});
const matches = [match('1', 'Shaymin_V', 10), match('2', 'FugitiveBIake', 11, 'FugitiveBIake')];
assert.deepEqual(searchArchive(matches, 'SHAYMINv yesterday win', now).map(m => m.id), ['1']);
assert.deepEqual(searchArchive(matches, 'fugitive today loss', now).map(m => m.id), ['2']);
assert.equal(searchArchive(matches, 'shay today', now).length, 0);
assert.equal(searchArchive(matches, 'isaiahw', now).length, 2);
assert.equal(searchArchive(matches, '  ', now).length, 2);
assert.equal(searchArchive(matches, 'missing', now).length, 0);
assert.equal(searchArchive(matches, '2026-09-10', now)[0].id, '1');
const withCard = { ...matches[0], finalSnapshot: { stadium: null, players: { isaiahw: {
  name: 'isaiahw', active: { id: 'entity1', cardId: 'SV9_98', name: 'Unknown card', damage: 0, energies: [], evolutionStack: [] },
  bench: [], knownHand: [], handCount: 0, discard: [], prizesTaken: 0,
} } } };
assert.equal(searchArchive([withCard], "N’S ZOROARK", now, new Map([['sv9_98', { id: 'sv9_98', name: "N's Zoroark ex" }]])).length, 1);
assert.equal(searchArchive([match('3', 'Poké_Fan', 10)], 'poke fan', now).length, 1);
await assert.rejects(readArchiveSearchIndex(async () => { throw new Error('offline'); }, () => false, () => {}), /offline/);
const calls: number[] = [];
const found: MatchSummary[] = [];
await readArchiveSearchIndex(async (offset) => {
  calls.push(offset);
  return offset === 0 ? Array.from({length: 200}, (_, i) => match(String(i), 'Other', 9)) : [matches[0]];
}, () => false, page => found.push(...page));
assert.deepEqual(calls, [0, 200]);
assert.equal(searchArchive(found, 'shaymin', now).length, 1);
let stopped = false;
await readArchiveSearchIndex(async () => { stopped = true; return matches; }, () => stopped, () => assert.fail('Cancelled search published a page'));
console.log('archive-search: player names, combined terms, dates, full archive paging and cancellation passed');
