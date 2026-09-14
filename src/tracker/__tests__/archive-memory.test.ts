import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Wiring regressions: a reducer upgrade must not materialize the archive.
const app = readFileSync(new URL('../TrackerApp.tsx', import.meta.url), 'utf8');
assert.doesNotMatch(app, /listRawMatchIds\(true,\s*5_000/);
assert.match(app, /listMatchSummaries\(0, 20\)/);
assert.match(app, /listMatchSummaries\(summaries.length, 20\)/);
assert.match(app, /summary.reducerVersion !== REDUCER_VERSION/);
assert.match(app, /stale \? await rebuildStoredMatch\(summary.id\) \|\| stored/);
assert.match(app, /<img loading="lazy" decoding="async"/);
console.log('archive-memory: no startup archive sweep, small pages, lazy thumbnails, selected stale replay refresh');
