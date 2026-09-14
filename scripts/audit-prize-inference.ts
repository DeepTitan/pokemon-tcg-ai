import { execFileSync } from 'node:child_process';
import { gunzipSync } from 'node:zlib';
import { derivePrizeKnowledge } from '../src/tracker/prize-knowledge-model.js';
import { deriveReviewTurnStatus } from '../src/tracker/turn-status-model.js';
import type { MatchReview, CardInfo } from '../src/tracker/types.js';
import { cardSourceIdFromReviewCard } from '../src/tracker/card-adapter.js';
import { pathToFileURL } from 'node:url';
import { LiveReviewAssembler } from '../src/tracker/live-operation-reducer.js';
// Run against a quiescent archive or a consistent copy (immutable excludes WAL).
// This audit never opens the archive for writes.
if (!process.argv[2]) throw new Error('Usage: node --import tsx scripts/audit-prize-inference.ts /path/to/quiescent/trace.sqlite3 [--rebuild] [--strict]');
const uri = pathToFileURL(process.argv[2]).href + '?mode=ro&immutable=1';
const sql = (query: string) => JSON.parse(execFileSync('sqlite3', ['-json', uri, query], { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 }) || '[]');
const rebuild = process.argv.includes('--rebuild');
const catalog = new Map<string, CardInfo>(sql("SELECT id,json_remove(payload_json,'$.imageDataUrl') AS payload_json FROM cards")
  .map((row: { id: string; payload_json: string }) => [row.id, JSON.parse(row.payload_json)]));
const reasons: Record<string, number> = {};
const examples: unknown[] = [];
let matches = 0, inferredMatches = 0, frames = 0, inferredFrames = 0;
let consistentTransitions = 0;
const changedSets: unknown[] = [];
const availabilityDrops: unknown[] = [];
let rewindChecks = 0;
let rebuiltMatches = 0, operationsReplayed = 0;
const storedOnlyMatches: string[] = [];
for (const { id } of sql('SELECT id FROM matches ORDER BY first_received DESC')) {
  const row = sql("SELECT hex(review_gzip) AS data FROM matches WHERE id='" + id.replaceAll("'", "''") + "'")[0];
  if (!row?.data) continue;
  let review: MatchReview = JSON.parse(gunzipSync(Buffer.from(row.data, 'hex')).toString());
  if (rebuild) {
    const assembler = new LiveReviewAssembler(catalog);
    let reconstructed: MatchReview | null = null;
    for (const operation of sql("SELECT hex(payload_gzip) AS data FROM operations WHERE match_id='" + id.replaceAll("'", "''") + "' ORDER BY id")) {
      reconstructed = assembler.ingest(JSON.parse(gunzipSync(Buffer.from(operation.data, 'hex')).toString())) || reconstructed;
      operationsReplayed++;
    }
    if (reconstructed) { review = reconstructed; rebuiltMatches++; }
    else storedOnlyMatches.push(id);
  }
  matches++;
  let found = false;
  let lastKind: string | undefined;
  const signatures = new Map<number, string>();
  const signature = (result: ReturnType<typeof derivePrizeKnowledge>) => JSON.stringify({ kind: result.kind,
    note: result.note, cards: result.cards.map(c => [c.id, cardSourceIdFromReviewCard(c)]).sort() });
  const atFrame = (index: number) => {
    const turn = review.turns[index], canonical = turn.canonical!, board = turn.snapshot.players[review.localPlayer];
    const status = deriveReviewTurnStatus(review, index, canonical);
    return derivePrizeKnowledge({ deck: review.decklists?.find(d => d.playerName === review.localPlayer),
      player: canonical.state.players[canonical.localPlayerIndex], pendingCards: canonical.pendingCards?.[canonical.localPlayerIndex], board, visibility: canonical.visibility,
      catalog: new Map(), local: true, stadium: canonical.state.stadium, stadiumOwner: status.stadiumOwner });
  };
  let previous: { counts: Map<string, number>; size: number; index: number } | undefined;
  for (const [index, turn] of review.turns.entries()) {
    const canonical = turn.canonical, board = turn.snapshot.players[review.localPlayer];
    if (!canonical || !board) continue;
    frames++;
    const result = atFrame(index);
    signatures.set(index, signature(result));
    if ((lastKind === 'inferred' || lastKind === 'revealed') && result.kind === 'unavailable'
      && canonical.state.players[canonical.localPlayerIndex].prizes.length > 0) {
      availabilityDrops.push({ id, index, label: turn.choiceLabel, reason: result.note });
    }
    lastKind = result.kind;
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
  for (const [index, expected] of [...signatures].reverse()) {
    if (signature(atFrame(index)) !== expected) throw new Error(`Prize knowledge changed on rewind: ${id} frame ${index}`);
    rewindChecks++;
  }
  if (found) inferredMatches++;
}
console.log(JSON.stringify({ rebuild, matches, inferredMatches, frames, inferredFrames, rewindChecks, consistentTransitions,
  rebuiltMatches, operationsReplayed, storedOnlyMatches, changedSets, availabilityDrops, reasons, examples }, null, 2));
if (process.argv.includes('--strict') && (changedSets.length || availabilityDrops.length
  || reasons['The full 60-card accounting is incomplete at this action.'])) {
  process.exitCode = 1;
}
