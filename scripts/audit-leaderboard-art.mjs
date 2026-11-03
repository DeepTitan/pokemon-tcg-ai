import { readFileSync } from 'node:fs';
import { leaderboardCardArt } from '../landing/lib/leaderboard-card-art.mjs';
import { measureCardArt } from '../landing/lib/share-card-art.mjs';

// Release gate: examine the current public feed, not the stale build snapshot.
// An optional local public snapshot makes the same audit reproducible offline.
const source = process.argv[2] ?? 'https://victoryroad.app/trace/leaderboard-static/events.json';
let snapshot;
if (source.startsWith('https://')) {
  const response = await fetch(source, { signal: AbortSignal.timeout(30000), cache: 'no-store' });
  if (!response.ok) throw new Error(`Cannot audit leaderboard artwork: HTTP ${response.status}`);
  snapshot = await response.json();
} else snapshot = JSON.parse(readFileSync(source, 'utf8'));
if (!Array.isArray(snapshot.matches)) throw new Error('Expected a public leaderboard snapshot');
const ids = new Set();
for (const match of [...snapshot.matches, ...(snapshot.clientExitMatches ?? [])]) {
  for (const side of Object.values(match.history?.players ?? {})) {
    const id = side.pokemon?.artCardId ?? side.pokemon?.cardId;
    if (id) ids.add(id);
  }
}
if (!ids.size) throw new Error('Artwork audit found no history card IDs');
const missing = [];
for (const id of ids) {
  try {
    const image = leaderboardCardArt(id);
    if (!image) throw new Error('missing');
    measureCardArt(image);
  } catch { missing.push(id); }
}
if (missing.length) throw new Error(`Bundle verified artwork before publishing: ${missing.join(', ')}`);
console.log(`Leaderboard art audit passed: ${ids.size} history card IDs have valid bundled portraits.`);
