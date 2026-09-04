import { DatabaseSync } from 'node:sqlite';
import { gunzipSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { presentTurnEvents } from '../src/tracker/game-log-copy.js';
import type { MatchReview, ReviewSelection, TrackerEvent } from '../src/tracker/types.js';

interface MatchRow {
  id: string;
  review_gzip: Uint8Array;
}

interface AuditedEvent {
  matchId: string;
  opponent: string;
  result: string;
  turnLabel: string;
  actionIndex: number;
  eventIndex: number;
  kind: TrackerEvent['kind'];
  text: string;
  detail: boolean;
  facts: TrackerEvent['facts'];
  cardName?: string;
  choiceKind?: string;
  selectionMethod?: number;
  subActionType?: number;
  selection?: ReviewSelection;
}

const databasePath = process.argv[2];
const outputDirectory = process.argv[3] || 'artifacts/trace-log-audit';
const requestedMatchCount = Number(process.argv[4] || 6);

if (!databasePath) {
  throw new Error('Usage: npm run trace:audit-copy -- <trace.sqlite3> [output-directory] [match-count]');
}

function reviewUsesAlakazam(review: MatchReview): boolean {
  return review.turns.some((turn) => {
    const board = turn.snapshot.players[review.localPlayer];
    if (!board) return false;
    return [board.active, ...board.bench].some((pokemon) => pokemon?.name === 'Alakazam')
      || board.knownHand.includes('Alakazam')
      || board.discard.includes('Alakazam');
  });
}

function issueTags(text: string, kind?: TrackerEvent['kind']): string[] {
  const tags: string[] = [];
  if (/\b(?:unknown|entity|text|reparent|damage) selection\b/i.test(text)) tags.push('protocol-selection');
  if (/\bState update\b/i.test(text)) tags.push('state-update');
  if (/\bEnd turn\b/i.test(text)) tags.push('end-turn');
  if (/^Start turn$/i.test(text)) tags.push('start-turn');
  if (/searched \d+ cards \(0 eligible\)/i.test(text)) tags.push('zero-eligible-search');
  if (kind === 'pokemon' && /:\s*used [^:]+$/i.test(text)) tags.push('ambiguous-used');
  if (kind === 'attack' && /\bused an attack$/i.test(text)) tags.push('ambiguous-attack');
  if (/^[^:]+:\s*Benched\b/.test(text)) tags.push('capitalized-action');
  if (/^(.+) was Knocked Out by \1$/i.test(text)) tags.push('self-knockout');
  if (/\{[A-Z]\}/.test(text)) tags.push('energy-code');
  return tags;
}

function factIssueTags(fact: NonNullable<TrackerEvent['facts']>[number]): string[] {
  const tags: string[] = [];
  if (/^(?:Operation|Player|Action|Source|Target|Selection type|Candidate zone|Selection|Chosen|Selection limits|Turn state|Choice resolved|Effect applied|Effect activated|Damage calculated)$/.test(fact.label)) tags.push('protocol-fact');
  if (/\b(?:method|sub-action|eligible|candidate list|entity choice|text choice|reparent choice)\b/i.test(fact.value)) tags.push('protocol-language');
  if (/\{[A-Z]\}/.test(fact.value)) tags.push('energy-code');
  if (/[→↔]/.test(fact.value)) tags.push('symbolic-movement');
  return tags;
}

const database = new DatabaseSync(databasePath, { readOnly: true });
const rows = database.prepare(`
  SELECT id, review_gzip
  FROM matches
  WHERE review_gzip IS NOT NULL
  ORDER BY last_received DESC
`).all() as unknown as MatchRow[];

const reviews = rows
  .map((row) => JSON.parse(gunzipSync(row.review_gzip).toString('utf8')) as MatchReview)
  .filter(reviewUsesAlakazam)
  .slice(0, requestedMatchCount);

const auditedEvents: AuditedEvent[] = reviews.flatMap((review) => review.turns.flatMap((turn) => turn.events.map((event, eventIndex) => ({
  matchId: review.id,
  opponent: review.opponent,
  result: review.winner === review.localPlayer ? 'Victory' : review.winner ? 'Defeat' : 'Incomplete',
  turnLabel: turn.label,
  actionIndex: turn.index,
  eventIndex,
  kind: event.kind,
  text: event.text,
  detail: event.detail,
  facts: event.facts,
  cardName: event.cardName,
  choiceKind: turn.canonical?.selection?.kind,
  selectionMethod: turn.canonical?.selection?.selectionMethod,
  subActionType: turn.canonical?.selection?.subActionType,
  selection: event.id.includes(':selection:')
    ? turn.canonical?.selections.find((selection) => event.id.endsWith(`:selection:${selection.id}`))
    : undefined,
}))));

const presentedEvents: AuditedEvent[] = reviews.flatMap((review) => review.turns.flatMap((turn) =>
  presentTurnEvents(turn).map((event, eventIndex) => ({
    matchId: review.id,
    opponent: review.opponent,
    result: review.winner === review.localPlayer ? 'Victory' : review.winner ? 'Defeat' : 'Incomplete',
    turnLabel: turn.label,
    actionIndex: turn.index,
    eventIndex,
    kind: event.kind,
    text: event.text,
    detail: event.detail,
    facts: event.facts,
  })),
));

const issueCounts = new Map<string, number>();
for (const event of auditedEvents) {
  for (const tag of issueTags(event.text, event.kind)) issueCounts.set(tag, (issueCounts.get(tag) || 0) + 1);
}
const presentedIssueCounts = new Map<string, number>();
for (const event of presentedEvents) {
  for (const tag of issueTags(event.text, event.kind)) presentedIssueCounts.set(tag, (presentedIssueCounts.get(tag) || 0) + 1);
}
const presentedFactIssueCounts = new Map<string, number>();
for (const event of presentedEvents) {
  for (const fact of event.facts || []) {
    for (const tag of factIssueTags(fact)) presentedFactIssueCounts.set(tag, (presentedFactIssueCounts.get(tag) || 0) + 1);
  }
}

mkdirSync(outputDirectory, { recursive: true });
writeFileSync(join(outputDirectory, 'production-alakazam-events.json'), JSON.stringify({
  generatedAt: new Date().toISOString(),
  databasePath,
  matches: reviews.map((review) => ({
    id: review.id,
    opponent: review.opponent,
    winner: review.winner,
    turns: review.turns.length,
    publicEvents: review.turns.flatMap((turn) => turn.events).filter((event) => !event.detail).length,
    detailEvents: review.turns.flatMap((turn) => turn.events).filter((event) => event.detail).length,
  })),
  issueCounts: Object.fromEntries([...issueCounts].sort(([left], [right]) => left.localeCompare(right))),
  presentedIssueCounts: Object.fromEntries([...presentedIssueCounts].sort(([left], [right]) => left.localeCompare(right))),
  presentedFactIssueCounts: Object.fromEntries([...presentedFactIssueCounts].sort(([left], [right]) => left.localeCompare(right))),
  events: auditedEvents.map((event) => ({ ...event, issueTags: issueTags(event.text, event.kind) })),
  presentedEvents: presentedEvents.map((event) => ({ ...event, issueTags: issueTags(event.text, event.kind) })),
}, null, 2));

const report: string[] = [
  '# Production Alakazam timeline copy audit',
  '',
  `Matches: ${reviews.length}`,
  `Public events: ${auditedEvents.filter((event) => !event.detail).length}`,
  `Detail events: ${auditedEvents.filter((event) => event.detail).length}`,
  `Player-facing events after cleanup: ${presentedEvents.length}`,
  '',
  '## Flagged patterns',
  '',
  ...[...issueCounts].sort(([left], [right]) => left.localeCompare(right)).map(([tag, count]) => `- ${tag}: ${count}`),
  '',
  '## Remaining player-facing flags',
  '',
  ...([...presentedIssueCounts].length
    ? [...presentedIssueCounts].sort(([left], [right]) => left.localeCompare(right)).map(([tag, count]) => `- ${tag}: ${count}`)
    : ['- None']),
  '',
  '## Remaining action-detail flags',
  '',
  ...([...presentedFactIssueCounts].length
    ? [...presentedFactIssueCounts].sort(([left], [right]) => left.localeCompare(right)).map(([tag, count]) => `- ${tag}: ${count}`)
    : ['- None']),
  '',
];

for (const review of reviews) {
  report.push(`## ${review.opponent} — ${review.winner === review.localPlayer ? 'Victory' : review.winner ? 'Defeat' : 'Incomplete'}`, '');
  for (const turn of review.turns) {
    const events = presentTurnEvents(turn);
    if (!events.length) continue;
    report.push(`### ${turn.label}`, '');
    for (const event of events) {
      const tags = issueTags(event.text, event.kind);
      report.push(`- ${event.kind}: ${event.text}${tags.length ? ` [${tags.join(', ')}]` : ''}`);
    }
    report.push('');
  }
}

writeFileSync(join(outputDirectory, 'production-alakazam-events.md'), report.join('\n'));

console.log(JSON.stringify({
  matches: reviews.map((review) => review.opponent),
  publicEvents: auditedEvents.filter((event) => !event.detail).length,
  detailEvents: auditedEvents.filter((event) => event.detail).length,
  playerFacingEvents: presentedEvents.length,
  issueCounts: Object.fromEntries(issueCounts),
  presentedIssueCounts: Object.fromEntries(presentedIssueCounts),
  presentedFactIssueCounts: Object.fromEntries(presentedFactIssueCounts),
  outputDirectory,
}, null, 2));

if (presentedIssueCounts.size || presentedFactIssueCounts.size) process.exitCode = 1;
