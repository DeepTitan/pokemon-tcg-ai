import { type LeaderboardRow, type RatingPlayerSeed, type RatingUpdate } from './rating.js';
import { ELO_OPTIONS, ACTIVE_ELO_OPTIONS } from './parameters.js';
import { prepareRankedEloEvents, type LiveEloEvent } from './ranked-events.js';
import { matchLiveScale, normalizeMatchLive, validateLiveScaleCalibrations, type LiveScaleCalibration } from './live-scale.js';
export { prepareRankedEloEvents, type LiveEloEvent } from './ranked-events.js';
export { ELO_OPTIONS, ACTIVE_ELO_OPTIONS } from './parameters.js';

export type EloLeaderboardRow = Omit<LeaderboardRow, 'rd'>;
export interface MatchRatingEvidence {
  model: 'fixed-four-rating' | 'coverage-aware' | 'fading-live';
  ownLive: number;
  opponentLive: number;
  rawOwnLive: number;
  rawOpponentLive: number;
  ownBlend: number;
  opponentBlend: number;
  liveOpponentWeight: number;
  ownTraceWeight: number;
  opponentTraceWeight: number;
  ownPriorGames?: number;
  opponentPriorGames?: number;
  opponentHistoryHalfWeight?: number;
  liveFadeGames?: number;
  initialOwnLiveWeight?: number;
  liveScale?: Pick<LiveScaleCalibration, 'seasonId' | 'scale' | 'offset' | 'evidence'>;
}
export type EloRatingUpdate = Omit<RatingUpdate, 'before' | 'after' | 'opponentBefore'> & {
  before: { rating: number };
  after: { rating: number };
  opponentBefore: { rating: number };
  matchEvidence: MatchRatingEvidence;
  /** Retained field name for the ledger. A scoring benchmark, not win probability. */
  expectedScore: number;
};

export function eloExpectedScore(rating: number, opponentRating: number): number {
  if (!Number.isFinite(rating) || !Number.isFinite(opponentRating)) throw new RangeError('Elo ratings must be finite');
  return 1 / (1 + 10 ** ((opponentRating - rating) / ELO_OPTIONS.expectedScale));
}
function checkWeight(weight: number) {
  if (!Number.isFinite(weight) || weight < 0.5 || weight > 1) throw new RangeError('Opponent Live weight must be in [0.5, 1]');
}

/** One bounded result update using only the four pre-game ratings and outcome.
 * Asymmetric blends let strong Live pools gain rating from an equal win/loss mix.
 * The benchmark is intentionally not complementary across players, or a forecast.
 */
export function fourRatingUpdate(ownTrace: number, opponentTrace: number, ownLive: number, opponentLive: number,
  score: 0 | 0.5 | 1, liveOpponentWeight: number = ACTIVE_ELO_OPTIONS.liveOpponentWeight) {
  checkWeight(liveOpponentWeight);
  if (![ownTrace, opponentTrace, ownLive, opponentLive].every(Number.isFinite) || ownLive < 0 || opponentLive < 0)
    throw new RangeError('Four finite ratings and nonnegative Live scores are required');
  if (![0, 0.5, 1].includes(score)) throw new RangeError('Result must be a win, draw, or loss');
  const ownBlend = liveOpponentWeight * ownTrace + (1 - liveOpponentWeight) * ownLive;
  const opponentBlend = (1 - liveOpponentWeight) * opponentTrace + liveOpponentWeight * opponentLive;
  const benchmark = eloExpectedScore(ownBlend, opponentBlend);
  return { benchmark, adjustment: ELO_OPTIONS.k * (score - benchmark),
    matchEvidence: { model: 'fixed-four-rating' as const, ownLive, opponentLive, rawOwnLive: ownLive, rawOpponentLive: opponentLive,
      ownBlend, opponentBlend, liveOpponentWeight, ownTraceWeight: liveOpponentWeight, opponentTraceWeight: 1 - liveOpponentWeight } };
}

export function opponentTraceWeight(priorGames: number, halfWeight: number = ACTIVE_ELO_OPTIONS.opponentHistoryHalfWeight,
  ownTraceWeight: number = ACTIVE_ELO_OPTIONS.liveOpponentWeight) {
  checkWeight(ownTraceWeight);
  if (!Number.isSafeInteger(priorGames) || priorGames < 0 || !Number.isFinite(halfWeight) || halfWeight <= 0)
    throw new RangeError('Opponent history requires a nonnegative integer count and positive half-weight');
  return (1 - ownTraceWeight) * (priorGames / (priorGames + halfWeight));
}

/** Suppress the arbitrary starting rating in opponent strength. Count is a
 * cold-start proxy, not calibrated statistical confidence. The visible rating
 * still starts at 1500 and only receives bounded recorded-result updates.
 */
export function coverageAwareRatingUpdate(ownTrace: number, opponentTrace: number, ownLive: number, opponentLive: number,
  score: 0 | 0.5 | 1, opponentPriorGames: number,
  options: { liveOpponentWeight?: number; opponentHistoryHalfWeight?: number } = {}) {
  const weight = options.liveOpponentWeight ?? ACTIVE_ELO_OPTIONS.liveOpponentWeight;
  const halfWeight = options.opponentHistoryHalfWeight ?? ACTIVE_ELO_OPTIONS.opponentHistoryHalfWeight;
  // Reuse validation and own-side calculation from the frozen four-rating rule.
  const base = fourRatingUpdate(ownTrace, opponentTrace, ownLive, opponentLive, score, weight);
  const traceWeight = opponentTraceWeight(opponentPriorGames, halfWeight, weight);
  const opponentBlend = traceWeight * opponentTrace + (1 - traceWeight) * opponentLive;
  const benchmark = eloExpectedScore(base.matchEvidence.ownBlend, opponentBlend);
  return { benchmark, adjustment: ELO_OPTIONS.k * (score - benchmark), matchEvidence: {
    ...base.matchEvidence, model: 'coverage-aware' as const, opponentBlend,
    opponentTraceWeight: traceWeight, opponentPriorGames, opponentHistoryHalfWeight: halfWeight,
  } };
}

/** Recorded-count proxy only: no claim that missing games or recency are known. */
export function remainingLiveWeight(priorGames: number, fadeGames: number = ACTIVE_ELO_OPTIONS.liveFadeGames) {
  if (!Number.isSafeInteger(priorGames) || priorGames < 0 || !Number.isFinite(fadeGames) || fadeGames <= 0)
    throw new RangeError('Live fading requires a nonnegative integer game count and positive fade scale');
  return fadeGames / (fadeGames + priorGames);
}

export interface FadingLiveOptions {
  liveFadeGames?: number;
  initialOwnLiveWeight?: number;
}
function fadingSettings(options: FadingLiveOptions) {
  const liveFadeGames = options.liveFadeGames ?? ACTIVE_ELO_OPTIONS.liveFadeGames;
  const initialOwnLiveWeight = options.initialOwnLiveWeight ?? ACTIVE_ELO_OPTIONS.initialOwnLiveWeight;
  remainingLiveWeight(0, liveFadeGames);
  if (!Number.isFinite(initialOwnLiveWeight) || initialOwnLiveWeight < 0 || initialOwnLiveWeight >= 1)
    throw new RangeError('Initial own Live weight must be in [0, 1)');
  return { liveFadeGames, initialOwnLiveWeight };
}

/** Each player's Live contribution tends to zero as their prior recorded count
 * grows. The asymmetric starting weights preserve the early strong-pool bridge.
 * With both histories large, the rule approaches ordinary Trace-vs-Trace Elo.
 * No hard threshold, first-game estimate, or between-game adjustment is applied.
 */
export function fadingLiveRatingUpdate(ownTrace: number, opponentTrace: number, ownLive: number, opponentLive: number,
  score: 0 | 0.5 | 1, ownPriorGames: number, opponentPriorGames: number, options: FadingLiveOptions = {}) {
  const { liveFadeGames, initialOwnLiveWeight } = fadingSettings(options);
  if (![ownTrace, opponentTrace, ownLive, opponentLive].every(Number.isFinite) || ownLive < 0 || opponentLive < 0)
    throw new RangeError('Four finite ratings and nonnegative Live scores are required');
  if (![0, 0.5, 1].includes(score)) throw new RangeError('Result must be a win, draw, or loss');
  const ownLiveWeight = initialOwnLiveWeight * remainingLiveWeight(ownPriorGames, liveFadeGames);
  const opponentLiveWeight = remainingLiveWeight(opponentPriorGames, liveFadeGames);
  const ownTraceWeight = 1 - ownLiveWeight, opponentTraceWeight = 1 - opponentLiveWeight;
  const ownBlend = ownTraceWeight * ownTrace + ownLiveWeight * ownLive;
  const opponentBlend = opponentTraceWeight * opponentTrace + opponentLiveWeight * opponentLive;
  const benchmark = eloExpectedScore(ownBlend, opponentBlend);
  const matchEvidence: MatchRatingEvidence = { model: 'fading-live', ownLive, opponentLive,
    rawOwnLive: ownLive, rawOpponentLive: opponentLive, ownBlend, opponentBlend,
    liveOpponentWeight: opponentLiveWeight, ownTraceWeight, opponentTraceWeight,
    ownPriorGames, opponentPriorGames, liveFadeGames, initialOwnLiveWeight };
  return { benchmark, adjustment: ELO_OPTIONS.k * (score - benchmark), matchEvidence };
}

export interface EloReplayOptions extends FadingLiveOptions {
  asOf?: string;
  liveOpponentWeight?: number;
  requirePairedLiveRatings?: true;
  model?: MatchRatingEvidence['model'];
  opponentHistoryHalfWeight?: number;
  liveScaleCalibrations?: readonly LiveScaleCalibration[];
}

/** Everyone begins at 1500. Only eligible chronological game results change ratings.
 * No priors, elapsed-time updates, post-score references, or season reinitialization.
 * Evidenced season mappings normalize game inputs only. Unknown resets can still
 * bias later games; no reset is guessed from an individual score movement.
 */
export function replayEloRatings(
  events: readonly LiveEloEvent[],
  players: readonly Pick<RatingPlayerSeed, 'id' | 'name'>[] = [],
  options: EloReplayOptions = {},
) {
  const weight = options.liveOpponentWeight ?? ACTIVE_ELO_OPTIONS.liveOpponentWeight;
  checkWeight(weight);
  const model = options.model ?? ACTIVE_ELO_OPTIONS.model;
  if (model !== 'fixed-four-rating' && model !== 'coverage-aware' && model !== 'fading-live') throw new RangeError('Unknown rating model');
  opponentTraceWeight(0, options.opponentHistoryHalfWeight, weight);
  if (model === 'fading-live') fadingSettings(options);
  const calibrations = options.liveScaleCalibrations ?? [];
  validateLiveScaleCalibrations(calibrations);
  const { accepted, duplicateMatchCount, rejectedMatches } = prepareRankedEloEvents(events, options.asOf);
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
    const playedAt = new Date(event.playedAt).toISOString();
    const scoreA = event.outcome.type === 'draw' ? 0.5 : event.outcome.winnerId === a.playerId ? 1 : 0;
    const calibration = matchLiveScale(event.seasonId, playedAt, calibrations);
    // Build both updates BEFORE mutating either state. Gains/losses need not balance.
    const matchUpdates: EloRatingUpdate[] = [a, b].map((row, index) => {
      const opponent = index === 0 ? b : a;
      const score = (index === 0 ? scoreA : 1 - scoreA) as 0 | 0.5 | 1;
      const rawOwnLive = event.liveRatings![row.playerId], rawOpponentLive = event.liveRatings![opponent.playerId];
      const ownLive = normalizeMatchLive(rawOwnLive, calibration), opponentLive = normalizeMatchLive(rawOpponentLive, calibration);
      const change = model === 'fixed-four-rating'
        ? fourRatingUpdate(row.rating, opponent.rating, ownLive, opponentLive, score, weight)
        : model === 'coverage-aware'
          ? coverageAwareRatingUpdate(row.rating, opponent.rating, ownLive, opponentLive, score, opponent.games, options)
          : fadingLiveRatingUpdate(row.rating, opponent.rating, ownLive, opponentLive, score, row.games, opponent.games, options);
      const matchEvidence: MatchRatingEvidence = { ...change.matchEvidence, rawOwnLive, rawOpponentLive,
        ...(calibration ? { liveScale: { seasonId: calibration.seasonId, scale: calibration.scale,
          offset: calibration.offset, evidence: calibration.evidence } } : {}) };
      return { matchId: event.id, playedAt, playerId: row.playerId, opponentId: opponent.playerId, score,
        before: { rating: row.rating }, opponentBefore: { rating: opponent.rating }, after: { rating: row.rating + change.adjustment },
        expectedScore: change.benchmark, adjustment: change.adjustment, effectiveK: ELO_OPTIONS.k, matchEvidence };
    });
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
    updates.push(...matchUpdates.sort((left, right) => left.playerId < right.playerId ? -1 : 1));
  }
  const rows = [...states.values()].sort((a, b) => Number(b.games > 0) - Number(a.games > 0)
    || b.rating - a.rating || (a.playerId < b.playerId ? -1 : a.playerId > b.playerId ? 1 : 0));
  return { rows, updates, ratedMatchCount: accepted.length, duplicateMatchCount, rejectedMatches };
}
