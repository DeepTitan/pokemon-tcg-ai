import { execFileSync } from 'node:child_process';
import { gunzipSync } from 'node:zlib';
import { derivePrizeKnowledge } from '../src/tracker/prize-knowledge-model.js';
import { deriveReviewTurnStatus } from '../src/tracker/turn-status-model.js';
import type { MatchReview } from '../src/tracker/types.js';
import { cardSourceIdFromReviewCard } from '../src/tracker/card-adapter.js';
import { pathToFileURL } from 'node:url';
// Run against a quiescent archive or a consistent copy (immutable excludes WAL).
// This audit never opens the archive for writes.
if (!process.argv[2]) throw new Error('Usage: node --import tsx scripts/audit-prize-inference.ts /path/to/quiescent/trace.sqlite3');
const uri = pathToFileURL(process.argv[2]).href + '?mode=ro&immutable=1';
const sql = (query: string) => JSON.parse(execFileSync('sqlite3', ['-json', uri, query], { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 }) || '[]');
const reasons: Record<string, number> = {};
const examples: unknown[] = [];
let matches = 0, inferredMatches = 0, frames = 0, inferredFrames = 0;
let consistentTransitions = 0;
const changedSets: unknown[] = [];
for (const { id } of sql('SELECT id FROM matches ORDER BY first_received DESC')) {
  const row = sql("SELECT hex(review_gzip) AS data FROM matches WHERE id='" + id.replaceAll("'", "''") + "'")[0];
  if (!row?.data) continue;
  const review: MatchReview = JSON.parse(gunzipSync(Buffer.from(row.data, 'hex')).toString());
  matches++;
  let found = false;
  let previous: { counts: Map<string, number>; size: number; index: number } | undefined;
  for (const [index, turn] of review.turns.entries()) {
    const canonical = turn.canonical, board = turn.snapshot.players[review.localPlayer];
    if (!canonical || !board) continue;
    frames++;
    const status = deriveReviewTurnStatus(review, index, canonical);
    const result = derivePrizeKnowledge({ deck: review.decklists?.find(d => d.playerName === review.localPlayer),
      player: canonical.state.players[canonical.localPlayerIndex], board, visibility: canonical.visibility,
      catalog: new Map(), local: true, stadium: canonical.state.stadium, stadiumOwner: status.stadiumOwner });
    reasons[result.note] = (reasons[result.note] || 0) + 1;
    if (result.kind === 'inferred') {
      const counts = new Map<string, number>();
      for (const card of result.cards) { const id = cardSourceIdFromReviewCard(card)!; counts.set(id, (counts.get(id) || 0) + 1); }
      if (previous && result.cards.length <= previous.size) {
        if ([...counts].every(([id, n]) => n <= (previous!.counts.get(id) || 0))) consistentTransitions++;
        else changedSets.push({ id, from: previous.index, to: index, label: turn.choiceLabel,
          before: Object.fromEntries(previous.counts), after: Object.fromEntries(counts) });
      }
      previous = { counts, size: result.cards.length, index };
      inferredFrames++;
      if (!found && examples.length < 5) examples.push({ id, index, label: turn.choiceLabel, count: result.cards.length, cards: result.cards.map(c => c.name) });
      found = true;
    }
  }
  if (found) inferredMatches++;
}
console.log(JSON.stringify({ matches, inferredMatches, frames, inferredFrames, consistentTransitions, changedSets, reasons, examples }, null, 2));
