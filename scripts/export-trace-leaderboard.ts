#!/usr/bin/env node
/** Read-only Trace export. Minimal display metadata from the private archive stays in the local browser. */
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

import { projectHistoryPreview, mergeHistoryPreviews } from './leaderboard-history-preview.js';
import type { CardInfo } from '../src/tracker/types.js';
import type { MatchHistoryPreview } from '../src/leaderboard/history.js';

type Json = Record<string, unknown>;
export interface LeaderboardSourceReview {
  review: Json;
  sourceLabel: string;
  importedAtFallback?: string;
}
export interface LeaderboardPlayer {
  id: string;
  name: string;
  traceStatus: 'trace-user' | 'opponent-only';
  latestLiveRating?: number;
  liveRatingObservedAt?: string;
  liveRatingTiming?: 'pre-match' | 'post-match' | 'match-snapshot';
  liveRatingMatchId?: string;
  liveRatingBefore?: number;
  liveRatingChange?: number;
}
export interface LeaderboardMatch {
  id: string;
  playedAt: string;
  playerIds: [string, string];
  confirmed: true;
  outcome: { type: 'win'; winnerId: string } | { type: 'draw' };
  seasonId?: string;
  history?: MatchHistoryPreview;
  liveRatings?: Record<string, number>;
  liveRatingsAfter?: Record<string, number>;
  liveRatingEligibility?: LiveRatingEligibility;
  timestampSource: 'raw-pregame' | 'playedAt' | 'startedAt' | 'importedAt' | 'archive-importedAt';
  sources: string[];
}
export interface LiveRatingObservation {
  matchId: string;
  observedAt: string;
  playerIds: [string, string];
  liveRatings: Record<string, number>;
  seasonId?: string;
  sources: string[];
}
interface LiveRatingEligibility {
  timing: 'pre-match';
  valueType: 'elo';
  evidence: string[];
}
interface AuditedPregameMetadata {
  observedAt: string;
  players: Array<{ name: string; liveRating?: number }>;
  liveRatingEligibility?: LiveRatingEligibility;
}
export interface LiveRatingAudit {
  matches: Record<string, AuditedPregameMetadata>;
  playerMetadata?: Record<string, AuditedPregameMetadata>;
}
const record = (value: unknown): Json => value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {};
const text = (value: unknown): string => typeof value === 'string' ? value.trim().normalize('NFC') : '';
const rating = (value: unknown): number | undefined => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
/** Names are a fallback identity, not a claim that account identifiers were captured. Preserve case. */
export function leaderboardPlayerId(name: string): string {
  return `name-${createHash('sha256').update(text(name)).digest('hex').slice(0, 24)}`;
}
function validName(value: unknown): string {
  const name = text(value);
  return !name || /^(you|opponent|live game|unknown|player [12])$/i.test(name) ? '' : name;
}
function timestamp(review: Json, fallback?: string): { value: string; source: LeaderboardMatch['timestampSource'] } | undefined {
  for (const key of ['playedAt', 'startedAt', 'importedAt'] as const) {
    const value = text(review[key]);
    if (value && Number.isFinite(Date.parse(value))) return { value: new Date(value).toISOString(), source: key };
  }
  if (fallback && Number.isFinite(Date.parse(fallback))) return { value: new Date(fallback).toISOString(), source: 'archive-importedAt' };
  return undefined;
}
function hasInferredExit(review: Json): boolean {
  if (text(review.resultReason) === 'local-client-closed') return true;
  // Older archives may retain the generated final event without the top-level reason.
  const turns = Array.isArray(review.turns) ? review.turns : [];
  return turns.slice(-2).some(value => {
    const turn = record(value);
    if (/client closed/i.test(text(turn.label)) || /closed TCG Live/i.test(text(turn.choiceLabel))) return true;
    return (Array.isArray(turn.events) ? turn.events : []).some(value => text(record(value).id).endsWith(':client-exit'));
  });
}

/** Discard logs, cards, private hands and decklists immediately, before retaining a source row. */
export function projectLeaderboardReview(review: Json, catalog: ReadonlyMap<string, CardInfo> = new Map()): Json {
  const projected: Json = {};
  for (const key of ['id', 'source', 'localPlayer', 'opponent', 'winner', 'result', 'localRating', 'opponentRating', 'seasonId',
    'playedAt', 'startedAt', 'importedAt', 'recording', 'localRatingConflict', 'opponentRatingConflict',
    'ratingAfter', 'ratingChange', 'ratingAfterConflict', 'ratingChangeConflict']) {
    const value = review[key];
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') projected[key] = value;
  }
  if (record(review.outcome).type === 'draw') projected.result = 'draw';
  if (hasInferredExit(review)) projected.resultReason = 'local-client-closed';
  const history = projectHistoryPreview(review, catalog);
  if (history) projected.history = history;
  return projected;
}

export function buildLeaderboardDataset(inputs: readonly LeaderboardSourceReview[], generatedAt = new Date().toISOString(), audit?: LiveRatingAudit) {
  const players = new Map<string, LeaderboardPlayer>();
  const candidates = new Map<string, LeaderboardMatch[]>();
  const observations = new Map<string, LiveRatingObservation>();
  // Post-game metadata is separate: usable only after that game, never in its prediction.
  const postgame = new Map<string, { matchId: string; playerId: string; at: string; after: Set<number>; changes: Set<number>; conflict: boolean }>();
  const ratingEvidence = new Map<string, { matchId: string; playerId: string; values: Set<number>; sources: Set<string>; sourceConflict: boolean }>();
  const observedIds = new Set<string>();
  const excluded: Record<string, number> = {};
  const sourceRecords: Record<string, number> = {};
  const reject = (reason: string) => { excluded[reason] = (excluded[reason] ?? 0) + 1; };
  let sourceRecordsWithLiveRatings = 0;
  let humanSourceRecords = 0;
  for (const input of inputs) {
    const review = input.review;
    sourceRecords[input.sourceLabel] = (sourceRecords[input.sourceLabel] ?? 0) + 1;
    // Restrict the first local version to captured human matches, excluding demo/imported/self-play data.
    if (review.source !== 'live-network' || /^(demo|ai|selfplay)[-:]/i.test(text(review.id))) { reject('non-live-source'); continue; }
    humanSourceRecords++;
    const id = text(review.id);
    if (id) observedIds.add(id);
    const names = [validName(review.localPlayer), validName(review.opponent)] as [string, string];
    const pregame = audit?.matches[id] ?? audit?.playerMetadata?.[id];
    const verifiedPregame = pregame && Array.isArray(pregame.players) && pregame.players.length === 2
      && names.every(name => name && pregame.players.some(player => text(player.name) === name))
      && Number.isFinite(Date.parse(pregame.observedAt)) ? pregame : undefined;
    const time = verifiedPregame
      ? { value: new Date(verifiedPregame.observedAt).toISOString(), source: 'raw-pregame' as const }
      : timestamp(review, input.importedAtFallback);
    const live = [rating(review.localRating), rating(review.opponentRating)];
    if (live.some(value => value !== undefined)) sourceRecordsWithLiveRatings++;
    for (let index = 0; index < 2; index++) {
      const name = names[index];
      if (!name) continue;
      const playerId = leaderboardPlayerId(name);
      const player = players.get(playerId) ?? { id: playerId, name, traceStatus: 'opponent-only' as const };
      // Own captures prove observed Trace use even when the result is incomplete or excluded.
      // Opponent appearances never prove use, and cannot downgrade an earlier own capture.
      if (index === 0) player.traceStatus = 'trace-user';
      players.set(playerId, player);
      if (id && (live[index] !== undefined || review[index === 0 ? 'localRatingConflict' : 'opponentRatingConflict'] === true)) {
        const key = JSON.stringify([id, playerId]);
        const evidence = ratingEvidence.get(key) ?? { matchId: id, playerId, values: new Set<number>(), sources: new Set<string>(), sourceConflict: false };
        if (live[index] !== undefined) evidence.values.add(live[index]!);
        evidence.sources.add(input.sourceLabel);
        if (review[index === 0 ? 'localRatingConflict' : 'opponentRatingConflict'] === true) evidence.sourceConflict = true;
        ratingEvidence.set(key, evidence);
      }
    }
    if (id && names[0] && names[1] && names[0] !== names[1] && time && live.some(value => value !== undefined)) {
      const playerIds = names.map(leaderboardPlayerId) as [string, string];
      const liveRatings: Record<string, number> = {};
      live.forEach((value, index) => { if (value !== undefined) liveRatings[playerIds[index]] = value; });
      const key = JSON.stringify([id, time.value, Object.entries(liveRatings).sort()]);
      const prior = observations.get(key);
      if (prior) prior.sources = [...new Set([...prior.sources, input.sourceLabel])].sort();
      else observations.set(key, {
        matchId: id, observedAt: time.value, playerIds, liveRatings, sources: [input.sourceLabel],
        ...(text(review.seasonId) ? { seasonId: text(review.seasonId) } : {}),
      });
    }
    if (!id) { reject('missing-match-id'); continue; }
    if (!names[0] || !names[1] || names[0] === names[1]) { reject('missing-or-ambiguous-player'); continue; }
    if (!time) { reject('missing-timestamp'); continue; }
    if (hasInferredExit(review)) { reject('inferred-client-exit'); continue; }
    if (review.recording === true) { reject('recording-incomplete'); continue; }
    const winner = text(review.winner);
    const explicitDraw = review.result === 'draw' || record(review.outcome).type === 'draw';
    if (!explicitDraw && !winner) { reject('unknown-outcome'); continue; }
    if (explicitDraw && winner) { reject('conflicting-outcome'); continue; }
    if (!explicitDraw && !names.includes(winner)) { reject('winner-not-a-player'); continue; }
    const playerIds = names.map(leaderboardPlayerId) as [string, string];
    const liveRatings: Record<string, number> = {};
    live.forEach((value, index) => { if (value !== undefined) liveRatings[playerIds[index]] = value; });
    const match: LeaderboardMatch = {
      id, playedAt: time.value, playerIds, confirmed: true,
      outcome: explicitDraw ? { type: 'draw' } : { type: 'win', winnerId: leaderboardPlayerId(winner) },
      timestampSource: time.source, sources: [input.sourceLabel],
      ...(Object.keys(liveRatings).length ? { liveRatings } : {}),
      ...(text(review.seasonId) ? { seasonId: text(review.seasonId) } : {}),
    };
    const preview = review.history as MatchHistoryPreview | undefined;
    if (preview?.players) match.history = { ...preview, players: Object.fromEntries(names.map((name, i) => [playerIds[i], preview.players[name] ?? {}])) };
    candidates.set(id, [...(candidates.get(id) ?? []), match]);
    const after = rating(review.ratingAfter);
    if (after !== undefined || review.ratingAfterConflict === true || review.ratingChangeConflict === true) {
      const key = JSON.stringify([id, playerIds[0]]);
      const evidence = postgame.get(key) ?? { matchId: id, playerId: playerIds[0], at: time.value,
        after: new Set<number>(), changes: new Set<number>(), conflict: false };
      if (after !== undefined) evidence.after.add(after);
      const change = typeof review.ratingChange === 'number' && Number.isFinite(review.ratingChange) ? review.ratingChange : undefined;
      if (change !== undefined) evidence.changes.add(change);
      evidence.conflict ||= review.ratingAfterConflict === true || review.ratingChangeConflict === true
        || (after !== undefined && live[0] !== undefined && change !== undefined && Math.abs(live[0] + change - after) > 1e-6);
      if (time.value < evidence.at) evidence.at = time.value;
      postgame.set(key, evidence);
    }
  }
  let duplicateRecords = 0;
  const conflictMatchIds: string[] = [];
  const matches: LeaderboardMatch[] = [];
  const conflictingLiveRatings = [...ratingEvidence.values()].filter(evidence => evidence.sourceConflict || evidence.values.size > 1);
  const disputedRatingKeys = new Set(conflictingLiveRatings.map(evidence => JSON.stringify([evidence.matchId, evidence.playerId])));
  const undisputedRatings = (matchId: string, values: Record<string, number>): Record<string, number> =>
    Object.fromEntries(Object.entries(values).filter(([playerId]) => !disputedRatingKeys.has(JSON.stringify([matchId, playerId]))));
  for (const [id, copies] of candidates) {
    duplicateRecords += copies.length - 1;
    const signatures = new Set(copies.map(match => JSON.stringify({
      players: [...match.playerIds].sort(), outcome: match.outcome,
    })));
    if (signatures.size > 1) { conflictMatchIds.push(id); reject('conflicting-duplicate-match'); continue; }
    // Two recorders may start capture at slightly different times. Preserve the earliest timestamp.
    copies.sort((a, b) => a.playedAt.localeCompare(b.playedAt));
    const match = { ...copies[0], sources: [...new Set(copies.flatMap(copy => copy.sources))].sort() };
    match.history = mergeHistoryPreviews(copies.flatMap(copy => copy.history ? [copy.history] : []));
    const mergedRatings: Record<string, number> = {};
    // Every retained value agrees across recorders. Disagreement cannot be resolved by load order.
    for (const copy of copies) Object.assign(mergedRatings, undisputedRatings(id, copy.liveRatings ?? {}));
    delete match.liveRatings;
    if (Object.keys(mergedRatings).length) match.liveRatings = mergedRatings;
    const audited = audit?.matches[id];
    if (audited?.liveRatingEligibility?.timing === 'pre-match' && audited.liveRatingEligibility.valueType === 'elo'
      && audited.liveRatingEligibility.evidence.length > 0 && audited.players.length === 2
      && audited.players.every(player => rating(player.liveRating) !== undefined
        && match.playerIds.includes(leaderboardPlayerId(player.name))
        && mergedRatings[leaderboardPlayerId(player.name)] === player.liveRating)) {
      match.liveRatingEligibility = { ...audited.liveRatingEligibility, evidence: [...audited.liveRatingEligibility.evidence] };
    }
    matches.push(match);
  }
  matches.sort((a, b) => a.playedAt.localeCompare(b.playedAt) || a.id.localeCompare(b.id));
  const cleanObservations = new Map<string, LiveRatingObservation>();
  for (const observation of observations.values()) {
    const liveRatings = undisputedRatings(observation.matchId, observation.liveRatings);
    if (!Object.keys(liveRatings).length) continue;
    const key = JSON.stringify([observation.matchId, observation.observedAt, Object.entries(liveRatings).sort()]);
    const prior = cleanObservations.get(key);
    if (prior) prior.sources = [...new Set([...prior.sources, ...observation.sources])].sort();
    else cleanObservations.set(key, { ...observation, liveRatings });
  }
  const sortedObservations = [...cleanObservations.values()].sort((a, b) => a.observedAt.localeCompare(b.observedAt) || a.matchId.localeCompare(b.matchId));
  const matchesById = new Map(matches.map(match => [match.id, match]));
  for (const observation of sortedObservations) {
    for (const [playerId, value] of Object.entries(observation.liveRatings)) {
      const player = players.get(playerId)!;
      if (!player.liveRatingObservedAt || observation.observedAt > player.liveRatingObservedAt) {
        player.latestLiveRating = value;
        player.liveRatingObservedAt = observation.observedAt;
        player.liveRatingMatchId = observation.matchId;
        player.liveRatingTiming = matchesById.get(observation.matchId)?.liveRatingEligibility ? 'pre-match' : 'match-snapshot';
      }
    }
  }
  for (const evidence of [...postgame.values()].sort((a, b) => a.at.localeCompare(b.at) || a.matchId.localeCompare(b.matchId))) {
    const match = matchesById.get(evidence.matchId);
    if (!match || evidence.conflict || evidence.after.size !== 1 || evidence.changes.size > 1
      || disputedRatingKeys.has(JSON.stringify([evidence.matchId, evidence.playerId]))) continue;
    const after = [...evidence.after][0];
    const before = match.liveRatings?.[evidence.playerId];
    const change = [...evidence.changes][0];
    if (before !== undefined && change !== undefined && Math.abs(before + change - after) > 1e-6) continue;
    if (before !== undefined && change !== undefined) {
      match.liveRatingsAfter = { ...match.liveRatingsAfter, [evidence.playerId]: after };
    }
    const player = players.get(evidence.playerId)!;
    if (player.liveRatingMatchId !== evidence.matchId && player.liveRatingObservedAt && (evidence.at < player.liveRatingObservedAt
      || (evidence.at === player.liveRatingObservedAt && player.liveRatingMatchId !== evidence.matchId))) continue;
    player.latestLiveRating = after;
    player.liveRatingObservedAt = player.liveRatingMatchId === evidence.matchId
      ? player.liveRatingObservedAt ?? evidence.at : evidence.at;
    player.liveRatingTiming = 'post-match';
    player.liveRatingMatchId = evidence.matchId;
    player.liveRatingBefore = before;
    player.liveRatingChange = change;
  }
  const sortedPlayers = [...players.values()].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return {
    schema: 'trace-leaderboard/v1' as const,
    generatedAt,
    sourceLabel: 'Local Trace archive and cached cloud reviews',
    players: sortedPlayers,
    matches,
    liveRatingObservations: sortedObservations,
    diagnostics: {
      inputRecords: inputs.length, humanSourceRecords, uniqueObservedMatchIds: observedIds.size,
      duplicateRecords, conflictMatchIds: conflictMatchIds.sort(), excluded, sourceRecords,
      sourceRecordsWithLiveRatings,
      verifiedPregameRatingMatches: matches.filter(match => match.liveRatingEligibility).length,
      conflictingLiveRatings: conflictingLiveRatings.map(({ matchId, playerId, sources, sourceConflict }) => ({
        matchId, playerId, sources: [...sources].sort(), reason: sourceConflict ? 'summary-review-disagreement' : 'duplicate-source-disagreement',
      })).sort((a, b) => a.matchId.localeCompare(b.matchId) || a.playerId.localeCompare(b.playerId)),
      identityMethod: 'Trimmed Unicode NFC display name, case preserved; no stable account ID is claimed.',
      traceStatusPolicy: 'trace-user means observed as a valid localPlayer in a live-network capture; opponent-only means no own capture in this imported snapshot. This is observed recorder status, not exhaustive account registration proof.',
      timestampPolicy: 'Use audited first raw pregame operation timestamps when available, then explicit playedAt/startedAt; otherwise importedAt is capture/import time, not guaranteed match start.',
      liveRatingPolicy: 'Raw Live ladder values are retained as observations only. Disputed match/player values are removed. They do not initialize internal ratings without a validated season calibration.',
    },
    coverage: {
      players: sortedPlayers.length,
      traceUsers: sortedPlayers.filter(player => player.traceStatus === 'trace-user').length,
      opponentOnlyPlayers: sortedPlayers.filter(player => player.traceStatus === 'opponent-only').length,
      ratedMatches: matches.length,
      playersWithLiveRating: sortedPlayers.filter(player => player.latestLiveRating !== undefined).length,
      matchesWithLiveRating: matches.filter(match => match.liveRatings).length,
      matchesWithSeason: matches.filter(match => match.seasonId).length,
      matchesWithVerifiedPregameElo: matches.filter(match => match.liveRatingEligibility).length,
      matchesWithRawPregameTimestamp: matches.filter(match => match.timestampSource === 'raw-pregame').length,
      liveRatingObservations: sortedObservations.length,
      firstMatchAt: matches[0]?.playedAt ?? null,
      lastMatchAt: matches.at(-1)?.playedAt ?? null,
      completeBrowserPopulation: false,
      limitation: 'This local snapshot covers observed players, not all current browser uploads or the full TCG Live population. Ratings describe recorded matches only.',
    },
  };
}

export function readSqliteReviews(databasePath: string, catalog: Map<string, CardInfo> = new Map()): LeaderboardSourceReview[] {
  const require = createRequire(import.meta.url);
  const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: new (file: string, options: { readOnly: boolean }) => {
    exec(sql: string): void;
    prepare(sql: string): { iterate(): Iterable<{ imported_at: string; summary_json: string | null; review_gzip: Uint8Array | null }> };
    close(): void;
  } };
  const database = new DatabaseSync(path.resolve(databasePath), { readOnly: true });
  try {
    database.exec('PRAGMA query_only = ON');
    database.exec('BEGIN');
    const cardDatabase = database as unknown as { prepare(sql: string): { iterate(): Iterable<{ payload_json: string }> } };
    for (const row of cardDatabase.prepare('SELECT payload_json FROM cards ORDER BY id').iterate()) {
      const card = JSON.parse(row.payload_json) as CardInfo;
      catalog.set(card.id, card); catalog.set(card.id.toLowerCase(), card);
    }
    const result: LeaderboardSourceReview[] = [];
    for (const row of database.prepare('SELECT imported_at, summary_json, review_gzip FROM matches ORDER BY imported_at, id').iterate()) {
      const summary = row.summary_json ? record(JSON.parse(row.summary_json)) : {};
      const review = row.review_gzip ? record(JSON.parse(gunzipSync(row.review_gzip).toString('utf8'))) : undefined;
      const merged = { ...summary, ...review };
      for (const key of ['localRating', 'opponentRating', 'ratingAfter', 'ratingChange'] as const) {
        if (typeof summary[key] === 'number' && Number.isFinite(summary[key]) && review
          && typeof review[key] === 'number' && Number.isFinite(review[key]) && summary[key] !== review[key]) {
          merged[`${key}Conflict`] = true;
        }
      }
      // A cached review is stronger outcome evidence than an independently updated summary.
      if (review && !('winner' in review)) delete merged.winner;
      result.push({ review: projectLeaderboardReview(merged, catalog), sourceLabel: `sqlite:${path.basename(path.dirname(databasePath))}/${path.basename(databasePath)}`, importedAtFallback: row.imported_at });
    }
    return result;
  } finally { database.close(); }
}

export function readCloudSnapshot(directory: string, catalog: ReadonlyMap<string, CardInfo> = new Map()): LeaderboardSourceReview[] {
  const manifest = record(JSON.parse(fs.readFileSync(path.join(directory, 'source-manifest.json'), 'utf8')));
  if (!Array.isArray(manifest.files)) throw new Error('Cloud snapshot manifest has no files inventory.');
  const root = path.resolve(directory);
  return manifest.files.map(value => {
    const entry = record(value);
    const relative = text(entry.path);
    const filename = path.resolve(root, relative);
    if (!relative || !filename.startsWith(root + path.sep)) throw new Error('Cloud snapshot path escapes its root.');
    const bytes = fs.readFileSync(filename);
    if (text(entry.sha256) && createHash('sha256').update(bytes).digest('hex') !== entry.sha256) throw new Error('Cloud review checksum mismatch.');
    return { review: projectLeaderboardReview(record(JSON.parse(gunzipSync(bytes).toString('utf8'))), catalog), sourceLabel: `cloud:${path.basename(root)}` };
  });
}

export function exportTraceLeaderboard(argv: string[]): void {
  let sqlite = 'data/leaderboard/source-snapshot/trace.sqlite3';
  const freshSnapshot = 'data/source/trace-leaderboard-cloud-20260916';
  // The snapshot writer publishes its manifest only after the complete inventory is verified.
  let snapshot: string | undefined = fs.existsSync(path.join(freshSnapshot, 'source-manifest.json'))
    ? freshSnapshot : 'data/source/trace-cloud-20260909T210230Z';
  let output = 'data/leaderboard/events.json';
  let auditPath = 'data/leaderboard/live-rating-eligibility.json';
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === '--no-cloud') { snapshot = undefined; continue; }
    const value = argv[++index];
    if (!value || value.startsWith('--')) throw new Error('Expected a value after export option.');
    switch (argv[index - 1]) {
      case '--sqlite': sqlite = value; break;
      case '--snapshot': snapshot = value; break;
      case '--out': output = value; break;
      case '--rating-audit': auditPath = value; break;
      default: throw new Error(`Unknown option: ${argv[index - 1]}`);
    }
  }
  const catalog = new Map<string, CardInfo>();
  const inputs = readSqliteReviews(sqlite, catalog);
  if (snapshot) inputs.push(...readCloudSnapshot(snapshot, catalog));
  const audit = fs.existsSync(auditPath) ? JSON.parse(fs.readFileSync(auditPath, 'utf8')) as LiveRatingAudit : undefined;
  const dataset = buildLeaderboardDataset(inputs, new Date().toISOString(), audit);
  fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(dataset, null, 2) + '\n');
  console.log(JSON.stringify({ output: path.resolve(output), coverage: dataset.coverage, excluded: dataset.diagnostics.excluded, duplicateRecords: dataset.diagnostics.duplicateRecords }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) exportTraceLeaderboard(process.argv.slice(2));
