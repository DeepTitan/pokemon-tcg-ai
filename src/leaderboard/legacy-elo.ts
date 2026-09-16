/** Historical first-Live/refresh model. Kept only for reproducing prior experiments. */
import { LiveRefreshTracker, type LiveRefresh } from './live-refresh.js';
import { prepareRatingEvents, type LeaderboardRow, type RatingMatchEvent, type RatingPlayerSeed, type RatingUpdate } from './rating.js';

import { ELO_OPTIONS } from './parameters.js';
export { ELO_OPTIONS, LIVE_PRIOR_WEIGHT } from './parameters.js';
// Archived settings for reproducing the earlier studies; never used by the active UI.
export const ACTIVE_ELO_OPTIONS = Object.freeze({ livePriorWeight: 0.5, liveRefreshStrength: 0.5, estimateLiveAfter: false, requirePairedLiveRatings: true });
import { prepareRankedEloEvents, type LiveEloEvent } from './ranked-events.js';
export { prepareRankedEloEvents, type LiveEloEvent } from './ranked-events.js';
export interface LiveCalibration {
  live: number;
  weight: number;
  offset: number;
  anchorPlayers: number;
  before: number;
  after: number;
  adjustment: number;
  season: string;
}
export type EloLeaderboardRow = Omit<LeaderboardRow, 'rd'> & { livePrior?: LiveCalibration };
export type EloRatingUpdate = Omit<RatingUpdate, 'before' | 'after' | 'opponentBefore'> & {
  calibration?: LiveCalibration;
  liveRefresh?: LiveRefresh;
  before: { rating: number };
  after: { rating: number };
  opponentBefore: { rating: number };
};

export function eloExpectedScore(rating: number, opponentRating: number): number {
  if (!Number.isFinite(rating) || !Number.isFinite(opponentRating)) throw new RangeError('Elo ratings must be finite');
  return 1 / (1 + 10 ** ((opponentRating - rating) / ELO_OPTIONS.expectedScale));
}

/** Fixed-K Elo with optional first-observation Live priors. No post-game/profile Live inputs. */
export function replayEloRatings(
  events: readonly LiveEloEvent[],
  players: readonly Pick<RatingPlayerSeed, 'id' | 'name'>[] = [],
  options: { asOf?: string; livePriorWeight?: number; verifiedLiveOnly?: boolean; liveRefreshStrength?: number; estimateLiveAfter?: boolean; requirePairedLiveRatings?: boolean } = {},
) {
  const { accepted, duplicateMatchCount, rejectedMatches } = options.requirePairedLiveRatings
    ? prepareRankedEloEvents(events, options.asOf) : prepareRatingEvents(events, options.asOf);
  const refreshStrength = options.liveRefreshStrength ?? 0;
  if (!Number.isFinite(refreshStrength) || refreshStrength < 0 || refreshStrength > 1) throw new RangeError('Live refresh strength must be in [0, 1]');
  const refreshTracker = new LiveRefreshTracker(refreshStrength, options.estimateLiveAfter ?? false);
  const weight = options.livePriorWeight ?? 0;
  if (!Number.isFinite(weight) || weight < 0 || weight > 1) throw new RangeError('Live prior weight must be in [0, 1]');
  // Resolve external evidence independently of result deduplication. Conflicting
  // duplicate observations must never let source ordering choose a prior.
  const evidence = new Map<string, Map<string, Set<number>>>();
  const postEvidence = new Map<string, Map<string, Set<number>>>();
  for (const event of events) {
    if (options.verifiedLiveOnly && event.liveRatingEligibility?.timing !== 'pre-match') continue;
    const byPlayer = evidence.get(event.id) ?? new Map<string, Set<number>>();
    const afterByPlayer = postEvidence.get(event.id) ?? new Map<string, Set<number>>();
    for (const id of event.playerIds) {
      const post = event.liveRatingsAfter?.[id];
      if (typeof post === 'number' && Number.isFinite(post) && post >= 0) {
        const values = afterByPlayer.get(id) ?? new Set<number>();
        values.add(post); afterByPlayer.set(id, values);
      }
      const value = event.liveRatings?.[id];
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) continue;
      const values = byPlayer.get(id) ?? new Set<number>();
      values.add(value); byPlayer.set(id, values);
    }
    evidence.set(event.id, byPlayer);
    postEvidence.set(event.id, afterByPlayer);
  }
  const liveFor = (event: RatingMatchEvent, id: string) => {
    const values = evidence.get(event.id)?.get(id);
    return values?.size === 1 ? [...values][0] : undefined;
  };
  const postFor = (event: RatingMatchEvent, id: string) => {
    const values = postEvidence.get(event.id)?.get(id);
    return values?.size === 1 ? [...values][0] : undefined;
  };
  const baseSeason = accepted[0]?.seasonId ?? 'unlabelled';
  const seasonAnchors = new Map<string, Map<string, number>>();
  const states = new Map<string, EloLeaderboardRow>();
  function stateFor(id: string, name = id): EloLeaderboardRow {
    const existing = states.get(id);
    if (existing) return existing;
    const row: EloLeaderboardRow = {
      playerId: id, name, rating: ELO_OPTIONS.initialRating, games: 0, wins: 0, losses: 0, draws: 0,
      provisional: true, lastPlayedAt: null, initialization: 'default',
    };
    states.set(id, row);
    return row;
  }
  for (const player of players) {
    if (typeof player.id !== 'string' || !player.id || player.id.trim() !== player.id
      || typeof player.name !== 'string' || !player.name.trim()) throw new TypeError('Player seeds require an ID and display name');
    const row = stateFor(player.id, player.name);
    if (player.name < row.name) row.name = player.name;
  }
  const updates: EloRatingUpdate[] = [];
  for (const event of accepted) {
    const [a, b] = event.playerIds.map(id => stateFor(id));
    const season = event.seasonId ?? 'unlabelled';
    const anchors = seasonAnchors.get(season) ?? new Map<string, number>();
    seasonAnchors.set(season, anchors);
    // Only established, already anchored players bridge seasons. First sighting
    // per player prevents a prolific recorder dominating the reset correction.
    if (weight > 0 && season !== baseSeason) for (const row of [a, b]) {
      const live = liveFor(event, row.playerId);
      if (live !== undefined && row.livePrior && row.games >= ELO_OPTIONS.seasonAnchorGames && !anchors.has(row.playerId)) {
        anchors.set(row.playerId, row.rating - (ELO_OPTIONS.initialRating + weight * (live - ELO_OPTIONS.initialRating)));
      }
    }
    const offsets = [...anchors.values()].sort((x, y) => x - y);
    const median = offsets.length ? (offsets[Math.floor((offsets.length - 1) / 2)] + offsets[Math.floor(offsets.length / 2)]) / 2 : 0;
    const offset = season === baseSeason ? 0 : anchors.size >= ELO_OPTIONS.seasonAnchorPlayers ? median : undefined;
    const calibrations = new Map<string, LiveCalibration>();
    if (weight > 0 && offset !== undefined) for (const row of [a, b]) {
      const live = liveFor(event, row.playerId);
      if (live === undefined || row.livePrior) continue;
      const after = ELO_OPTIONS.initialRating + weight * (live - ELO_OPTIONS.initialRating) + offset;
      const calibration: LiveCalibration = { live, weight, offset, anchorPlayers: season === baseSeason ? 0 : anchors.size,
        before: row.rating, after, adjustment: after - row.rating, season };
      // A first Live observation replaces an unanchored provisional estimate.
      // It is separate from the bounded game update and never repeats at resets.
      row.rating = after; row.initialization = 'calibrated'; row.livePrior = calibration;
      calibrations.set(row.playerId, calibration);
    }
    const refreshes = new Map<string, LiveRefresh>();
    if (weight > 0 && refreshStrength > 0) for (const row of [a, b]) {
      const live = liveFor(event, row.playerId);
      if (live === undefined || !row.livePrior || calibrations.has(row.playerId)) continue;
      const refresh = refreshTracker.refresh(row.playerId, live, row.rating, season, event.phase, Date.parse(event.playedAt), weight);
      row.rating = refresh.after; refreshes.set(row.playerId, refresh);
    }
    const expectedA = eloExpectedScore(a.rating, b.rating);
    const scoreA = event.outcome.type === 'draw' ? 0.5 : event.outcome.winnerId === a.playerId ? 1 : 0;
    const change = ELO_OPTIONS.k * (scoreA - expectedA);
    const playedAt = new Date(event.playedAt).toISOString();
    const matchUpdates: EloRatingUpdate[] = [
      { matchId: event.id, playedAt, playerId: a.playerId, opponentId: b.playerId, score: scoreA,
        before: { rating: a.rating }, opponentBefore: { rating: b.rating }, after: { rating: a.rating + change },
        expectedScore: expectedA, adjustment: change, effectiveK: ELO_OPTIONS.k },
      { matchId: event.id, playedAt, playerId: b.playerId, opponentId: a.playerId, score: (1 - scoreA) as 0 | 0.5 | 1,
        before: { rating: b.rating }, opponentBefore: { rating: a.rating }, after: { rating: b.rating - change },
        expectedScore: 1 - expectedA, adjustment: -change, effectiveK: ELO_OPTIONS.k },
    ];
    for (const update of matchUpdates) {
      const calibration = calibrations.get(update.playerId);
      if (calibration) update.calibration = calibration;
      const refresh = refreshes.get(update.playerId);
      if (refresh) update.liveRefresh = refresh;
    }
    // Both sides use the same pre-game ratings; every gain has an equal loss.
    for (const update of matchUpdates) {
      const row = states.get(update.playerId)!;
      row.rating = update.after.rating;
      row.games++;
      row.wins += Number(update.score === 1);
      row.losses += Number(update.score === 0);
      row.draws += Number(update.score === 0.5);
      row.lastPlayedAt = playedAt;
      row.provisional = row.games < ELO_OPTIONS.provisionalGames;
    }
    if (refreshStrength > 0) {
      for (const update of matchUpdates) refreshTracker.complete(update.playerId, liveFor(event, update.playerId), liveFor(event, update.opponentId),
        postFor(event, update.playerId), update.score, season, Date.parse(event.playedAt));
      for (const update of matchUpdates) refreshTracker.learn(liveFor(event, update.playerId), liveFor(event, update.opponentId), postFor(event, update.playerId), update.score, season);
    }
    updates.push(...matchUpdates.sort((left, right) => left.playerId < right.playerId ? -1 : 1));
  }
  const rows = [...states.values()].sort((a, b) => Number(b.games > 0) - Number(a.games > 0)
    || b.rating - a.rating || (a.playerId < b.playerId ? -1 : a.playerId > b.playerId ? 1 : 0));
  return { rows, updates, ratedMatchCount: accepted.length, duplicateMatchCount, rejectedMatches };
}
