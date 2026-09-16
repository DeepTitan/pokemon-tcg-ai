import { createHash } from 'node:crypto';
import { buildLeaderboardDataset, projectLeaderboardReview, type LiveRatingAudit } from '../../scripts/export-trace-leaderboard.js';
import { projectPublicLeaderboardSnapshot, type PublicLeaderboardSnapshot } from '../../scripts/leaderboard-public-snapshot.js';
import { ACTIVE_ELO_OPTIONS, replayEloRatings } from '../../src/leaderboard/elo.js';
import type { CardInfo } from '../../src/tracker/types.js';
import type { MatchHistoryPreview } from '../../src/leaderboard/history.js';

export type ProjectedReview = Record<string, unknown>;
export interface SourceProjection {
  sourceKey: string;
  matchId: string;
  /** Safe compact evidence only. Device identity and raw review never reach the feed. */
  review: ProjectedReview;
  sourceRevision?: string;
  sourceUpdatedAt?: string;
}
export interface HistoricalEnrichment {
  sourceKey: string;
  signature: string;
  fields: {
    durationSeconds?: number;
    ratingAfter?: number;
    ratingChange?: number;
    localRatingConflict?: boolean;
    opponentRatingConflict?: boolean;
    ratingAfterConflict?: boolean;
    ratingChangeConflict?: boolean;
  };
}

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const normalized = (value: unknown) => typeof value === 'string' ? value.trim().normalize('NFC') : '';
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** One current row per recorder and match; retries replace it instead of adding games. */
export function sourceKeyFor(deviceId: string, matchId: string): string {
  if (!deviceId || !matchId) throw new TypeError('A recorder and match ID are required');
  return `source-${hash(JSON.stringify([deviceId, matchId]))}`;
}

/** Do not let old local after-scores or conflict flags survive a corrected match. */
export function reviewSignature(review: ProjectedReview): string {
  return hash(JSON.stringify([
    ...['id', 'source', 'localPlayer', 'opponent', 'winner', 'result', 'resultReason', 'seasonId'].map(key => normalized(review[key])),
    review.recording === true, finite(review.localRating) ? review.localRating : null,
    finite(review.opponentRating) ? review.opponentRating : null,
  ]));
}

/** Run once during migration against paired cloud/local projections, never raw logs.
 * The guard is anchored to the historical cloud state. A changed outcome, identity,
 * season or before-score drops the overlay, so corrections remain authoritative.
 */
export function createHistoricalEnrichment(cloud: ProjectedReview, local: ProjectedReview, sourceKey: string): HistoricalEnrichment {
  // Older cloud payloads can omit scores that the local summary retained. We do
  // not restore those missing rating inputs here; only attach guarded display
  // enrichment. If both sources report a score, they must agree.
  const localIdentity = { ...local, localRating: cloud.localRating, opponentRating: cloud.opponentRating };
  if (reviewSignature(cloud) !== reviewSignature(localIdentity)
    || ['localRating', 'opponentRating'].some(key => finite(cloud[key]) && finite(local[key]) && cloud[key] !== local[key])) {
    throw new Error('Historical enrichment does not describe the same match facts');
  }
  const fields: HistoricalEnrichment['fields'] = {};
  const duration = (local.history as MatchHistoryPreview | undefined)?.durationSeconds;
  if (finite(duration) && duration >= 0) fields.durationSeconds = duration;
  for (const key of ['ratingAfter', 'ratingChange'] as const) if (finite(local[key])) fields[key] = local[key];
  for (const key of ['localRatingConflict', 'opponentRatingConflict', 'ratingAfterConflict', 'ratingChangeConflict'] as const) {
    if (local[key] === true) fields[key] = true;
  }
  return { sourceKey, signature: reviewSignature(cloud), fields };
}

export function applyHistoricalEnrichment(review: ProjectedReview, enrichment?: HistoricalEnrichment): ProjectedReview {
  if (!enrichment || enrichment.signature !== reviewSignature(review)) return review;
  const result = { ...review };
  for (const key of ['ratingAfter', 'ratingChange'] as const) {
    if (result[key] === undefined && finite(enrichment.fields[key])) result[key] = enrichment.fields[key];
  }
  for (const key of ['localRatingConflict', 'opponentRatingConflict', 'ratingAfterConflict', 'ratingChangeConflict'] as const) {
    if (result[key] === undefined && enrichment.fields[key] === true) result[key] = true;
  }
  const history = result.history as MatchHistoryPreview | undefined;
  if (history && history.durationSeconds === undefined && finite(enrichment.fields.durationSeconds) && enrichment.fields.durationSeconds >= 0) {
    result.history = { ...history, durationSeconds: enrichment.fields.durationSeconds };
  }
  return result;
}

export function projectCloudReview(options: {
  sourceKey: string;
  matchId: string;
  review: unknown;
  catalog: ReadonlyMap<string, CardInfo>;
  enrichment?: HistoricalEnrichment;
  sourceRevision?: string;
  sourceUpdatedAt?: string;
}): SourceProjection {
  if (!options.review || typeof options.review !== 'object' || Array.isArray(options.review)
    || (options.review as ProjectedReview).id !== options.matchId) throw new Error('Cloud review identity mismatch');
  const projected = projectLeaderboardReview(options.review as ProjectedReview, options.catalog);
  return {
    sourceKey: options.sourceKey, matchId: options.matchId,
    review: applyHistoricalEnrichment(projected, options.enrichment?.sourceKey === options.sourceKey ? options.enrichment : undefined),
    ...(options.sourceRevision ? { sourceRevision: options.sourceRevision } : {}),
    ...(options.sourceUpdatedAt ? { sourceUpdatedAt: options.sourceUpdatedAt } : {}),
  };
}

/** Deterministic chronological replay, including late arrivals and corrected games.
 * Never seed ratings from the last published scores: replay the current source rows.
 */
export function buildPublicSnapshot(records: readonly SourceProjection[], generatedAt: string, audit?: LiveRatingAudit): PublicLeaderboardSnapshot {
  const unique = new Map<string, SourceProjection>();
  for (const record of records) {
    if (unique.has(record.sourceKey)) throw new Error('Duplicate current source projection');
    unique.set(record.sourceKey, record);
  }
  const inputs = [...unique.values()].sort((a, b) => a.sourceKey.localeCompare(b.sourceKey))
    .map(record => ({ review: record.review, sourceLabel: `cloud:${record.sourceKey}` }));
  // The exporter can assign undefined to optional after-score metadata while a
  // partial backfill has not yet supplied the corresponding before-score. Its
  // normal file transport omits those properties. Apply that same JSON boundary
  // before the strict public allowlist instead of treating undefined as a value.
  const dataset = JSON.parse(JSON.stringify(buildLeaderboardDataset(inputs, generatedAt, audit)));
  const publicSnapshot = projectPublicLeaderboardSnapshot(dataset);
  // Fail before publication if the feed cannot be replayed by the shipped engine.
  replayEloRatings(publicSnapshot.matches, publicSnapshot.players, ACTIVE_ELO_OPTIONS);
  return publicSnapshot;
}
