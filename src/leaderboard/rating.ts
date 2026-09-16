/**
 * Persistent, event-sourced Glicko ratings for observed one-on-one matches.
 *
 * Original Glicko: https://www.glicko.net/glicko/glicko.pdf
 * Adaptation: each match is a rating period; uncertainty grows with elapsed
 * days rather than a fixed period count. Both players use pre-match snapshots.
 * Season changes never reset skill. Live scores are deliberately not inputs:
 * a separately validated season/phase calibration may supply a first-game prior.
 * Defaults are prototype parameters, not a fitted Pokémon population model.
 */

export interface GlickoRating {
  rating: number;
  rd: number;
}

export interface GlickoOpponent extends GlickoRating {
  score: 0 | 0.5 | 1;
}

export interface CalibratedRatingPrior extends GlickoRating {
  seasonId: string;
  phase: string;
  calibrationId: string;
}

export interface RatingPlayerSeed {
  id: string;
  name: string;
  /** A pre-match skill estimate from an explicit calibration, never raw Live Elo. */
  calibratedPrior?: CalibratedRatingPrior;
}

export interface RatingMatchEvent {
  id: string;
  /** ISO timestamp with an explicit UTC offset (usually the Z suffix). */
  playedAt: string;
  playerIds: readonly [string, string];
  confirmed: boolean;
  outcome: { type: 'win'; winnerId: string } | { type: 'draw' };
  seasonId?: string;
  phase?: string;
}

export interface RatingOptions {
  initialRating: number;
  initialRd: number;
  minRd: number;
  maxRd: number;
  /** RD variance added per elapsed day. This is variance, not standard deviation. */
  processVariancePerDay: number;
  provisionalGames: number;
  provisionalRd: number;
  /** Optional evaluation time. Later events are excluded. Defaults to last event. */
  asOf?: string;
}

export interface LeaderboardRow extends GlickoRating {
  playerId: string;
  name: string;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  provisional: boolean;
  lastPlayedAt: string | null;
  initialization: 'default' | 'calibrated';
}

/** One player's contribution from one accepted match, before display rounding. */
export interface RatingUpdate {
  matchId: string;
  playedAt: string;
  playerId: string;
  opponentId: string;
  score: 0 | 0.5 | 1;
  /** Includes elapsed-time uncertainty and any applicable first-game prior. */
  before: GlickoRating;
  after: GlickoRating;
  opponentBefore: GlickoRating;
  /** The update expectation uses the opponent's RD, as in original Glicko. */
  expectedScore: number;
  adjustment: number;
  /** adjustment = effectiveK * (score - expectedScore), up to floating-point rounding. */
  effectiveK: number;
}

export interface RatingReplayResult {
  rows: LeaderboardRow[];
  /** Two entries per accepted match; chronological, then player ID within a match. */
  updates: RatingUpdate[];
  ratedMatchCount: number;
  duplicateMatchCount: number;
  rejectedMatches: { id: string; reason: string }[];
}

export const DEFAULT_RATING_OPTIONS: Readonly<RatingOptions> = Object.freeze({
  initialRating: 1500,
  initialRd: 350,
  minRd: 30,
  maxRd: 350,
  processVariancePerDay: 25,
  provisionalGames: 10,
  provisionalRd: 150,
});

const DAY_MS = 86_400_000;
const Q = Math.log(10) / 400;
const compareText = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const validId = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.trim() === value;

function timestamp(value: string): number {
  // Reject timezone-dependent date strings so replay agrees across machines.
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return NaN;
  return Date.parse(value);
}

function resolveOptions(options: Partial<RatingOptions>): RatingOptions {
  const config = { ...DEFAULT_RATING_OPTIONS, ...options };
  if (![config.initialRating, config.initialRd, config.minRd, config.maxRd,
    config.processVariancePerDay, config.provisionalGames, config.provisionalRd].every(Number.isFinite)
    || config.minRd <= 0 || config.maxRd < config.minRd
    || config.initialRd < config.minRd || config.initialRd > config.maxRd
    || config.processVariancePerDay < 0 || config.provisionalGames < 0
    || !Number.isInteger(config.provisionalGames) || config.provisionalRd < 0
    || (config.asOf !== undefined && !Number.isFinite(timestamp(config.asOf)))) {
    throw new RangeError('Invalid rating configuration');
  }
  return config;
}

function validateRating(value: GlickoRating): void {
  if (!Number.isFinite(value.rating) || !Number.isFinite(value.rd) || value.rd <= 0) {
    throw new RangeError('Ratings must have a finite mean and a positive finite RD');
  }
}

function uncertaintyWeight(rd: number): number {
  return 1 / Math.sqrt(1 + 3 * Q * Q * rd * rd / (Math.PI * Math.PI));
}

function opponentEvidence(player: GlickoRating, opponent: GlickoRating) {
  const g = uncertaintyWeight(opponent.rd);
  const expectedScore = 1 / (1 + 10 ** (-g * (player.rating - opponent.rating) / 400));
  const information = Q * Q * g * g * expectedScore * (1 - expectedScore);
  return { g, expectedScore, information };
}

/** Original Glicko batch update, with no elapsed-time inflation inside this function. */
export function updateGlickoRating(
  player: GlickoRating,
  opponents: readonly GlickoOpponent[],
  options: Partial<Pick<RatingOptions, 'minRd' | 'maxRd'>> = {},
): GlickoRating {
  const minRd = options.minRd ?? DEFAULT_RATING_OPTIONS.minRd;
  const maxRd = options.maxRd ?? DEFAULT_RATING_OPTIONS.maxRd;
  if (!Number.isFinite(minRd) || !Number.isFinite(maxRd) || minRd <= 0 || maxRd < minRd) {
    throw new RangeError('Invalid RD bounds');
  }
  validateRating(player);
  let information = 0;
  let residual = 0;
  for (const opponent of opponents) {
    validateRating(opponent);
    if (opponent.score !== 0 && opponent.score !== 0.5 && opponent.score !== 1) {
      throw new RangeError('Glicko outcome must be 0, 0.5, or 1');
    }
    const evidence = opponentEvidence(player, opponent);
    information += evidence.information;
    residual += evidence.g * (opponent.score - evidence.expectedScore);
  }
  const variance = 1 / (1 / (player.rd * player.rd) + information);
  return {
    rating: player.rating + Q * variance * residual,
    rd: Math.max(minRd, Math.min(maxRd, Math.sqrt(variance))),
  };
}

function eventProblem(event: RatingMatchEvent): string | undefined {
  if (!validId(event.id)) return 'Missing or invalid match ID';
  if (!Number.isFinite(timestamp(event.playedAt))) return 'Missing or invalid match timestamp';
  if (!Array.isArray(event.playerIds) || event.playerIds.length !== 2
    || !event.playerIds.every(validId) || event.playerIds[0] === event.playerIds[1]) {
    return 'Match requires two distinct player IDs';
  }
  if (event.confirmed !== true) return 'Outcome is not confirmed';
  if (event.outcome?.type === 'win') {
    if (!event.playerIds.includes(event.outcome.winnerId)) return 'Winner is not a match participant';
  } else if (event.outcome?.type !== 'draw') {
    return 'Missing or invalid match outcome';
  }
  return undefined;
}

function eventSignature(event: RatingMatchEvent): string {
  return JSON.stringify([
    Number.isFinite(timestamp(event.playedAt)) ? timestamp(event.playedAt) : event.playedAt,
    Array.isArray(event.playerIds) ? [...event.playerIds].sort(compareText) : event.playerIds,
    event.confirmed,
    event.outcome?.type,
    event.outcome?.type === 'win' ? event.outcome.winnerId : null,
    event.seasonId ?? null,
    event.phase ?? null,
  ]);
}

/** Shared event acceptance for the Elo preview and Glicko research replay. */
export function prepareRatingEvents(events: readonly RatingMatchEvent[], asOf?: string) {
  if (asOf !== undefined && !Number.isFinite(timestamp(asOf))) throw new RangeError('Invalid evaluation time');
  const grouped = new Map<string, RatingMatchEvent[]>();
  for (const event of events) {
    const group = grouped.get(event.id) ?? [];
    group.push(event);
    grouped.set(event.id, group);
  }
  const rejectedMatches: RatingReplayResult['rejectedMatches'] = [];
  const accepted: RatingMatchEvent[] = [];
  let duplicateMatchCount = 0;
  const asOfTime = asOf === undefined ? undefined : timestamp(asOf);
  for (const [id, copies] of [...grouped].sort(([a], [b]) => compareText(a, b))) {
    if (new Set(copies.map(eventSignature)).size !== 1) {
      rejectedMatches.push({ id, reason: 'Conflicting records share this match ID' });
      continue;
    }
    const event = copies[0];
    const problem = eventProblem(event);
    if (problem) {
      rejectedMatches.push({ id, reason: problem });
    } else if (asOfTime !== undefined && timestamp(event.playedAt) > asOfTime) {
      rejectedMatches.push({ id, reason: 'Match occurs after the evaluation time' });
    } else {
      accepted.push(event);
      duplicateMatchCount += copies.length - 1;
    }
  }
  accepted.sort((a, b) => timestamp(a.playedAt) - timestamp(b.playedAt) || compareText(a.id, b.id));

  return { accepted, duplicateMatchCount, rejectedMatches };
}

/**
 * Replay a full observed match history. Stable IDs, chronological order, and the
 * complete history preserve internal ratings across seasons without a database.
 * Conflicting copies of an ID are all excluded instead of choosing a winner.
 */
export function replayRatings(
  events: readonly RatingMatchEvent[],
  players: readonly RatingPlayerSeed[] = [],
  options: Partial<RatingOptions> = {},
): RatingReplayResult {
  const config = resolveOptions(options);
  const seeds = new Map<string, RatingPlayerSeed>();
  for (const seed of players) {
    if (!validId(seed.id) || typeof seed.name !== 'string' || !seed.name.trim()) {
      throw new TypeError('Player seeds require an ID and display name');
    }
    if (seed.calibratedPrior) {
      validateRating(seed.calibratedPrior);
      if (![seed.calibratedPrior.seasonId, seed.calibratedPrior.phase,
        seed.calibratedPrior.calibrationId].every(validId)
        || seed.calibratedPrior.rd < config.minRd || seed.calibratedPrior.rd > config.maxRd) {
        throw new RangeError('Calibrated priors require season, phase, calibration ID, and RD within bounds');
      }
    }
    const previous = seeds.get(seed.id);
    if (previous && JSON.stringify(previous.calibratedPrior) !== JSON.stringify(seed.calibratedPrior)) {
      throw new Error(`Conflicting initial priors for player ${seed.id}`);
    }
    if (!previous || compareText(seed.name, previous.name) < 0) seeds.set(seed.id, seed);
  }

  const { accepted, duplicateMatchCount, rejectedMatches } = prepareRatingEvents(events, config.asOf);
  const asOfTime = config.asOf === undefined ? undefined : timestamp(config.asOf);

  const states = new Map<string, LeaderboardRow>();
  const updates: RatingUpdate[] = [];
  function stateFor(id: string): LeaderboardRow {
    const existing = states.get(id);
    if (existing) return existing;
    const state: LeaderboardRow = {
      playerId: id,
      name: seeds.get(id)?.name ?? id,
      rating: config.initialRating,
      rd: config.initialRd,
      games: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      provisional: true,
      lastPlayedAt: null,
      initialization: 'default',
    };
    states.set(id, state);
    return state;
  }
  for (const id of seeds.keys()) stateFor(id);

  function priorAt(state: LeaderboardRow, event: RatingMatchEvent): GlickoRating {
    const prior = seeds.get(state.playerId)?.calibratedPrior;
    if (state.games === 0 && prior && prior.seasonId === event.seasonId && prior.phase === event.phase) {
      state.initialization = 'calibrated';
      return { rating: prior.rating, rd: prior.rd };
    }
    return { rating: state.rating, rd: inflatedRd(state, timestamp(event.playedAt)) };
  }
  function inflatedRd(state: LeaderboardRow, at: number): number {
    const days = state.lastPlayedAt === null ? 0 : Math.max(0, at - timestamp(state.lastPlayedAt)) / DAY_MS;
    return Math.min(config.maxRd, Math.sqrt(state.rd * state.rd + config.processVariancePerDay * days));
  }

  for (const event of accepted) {
    const [a, b] = event.playerIds.map(stateFor);
    const priorA = priorAt(a, event);
    const priorB = priorAt(b, event);
    const scoreA = event.outcome.type === 'draw' ? 0.5 : event.outcome.winnerId === a.playerId ? 1 : 0;
    const scoreB = (1 - scoreA) as 0 | 0.5 | 1;
    // Calculate both before mutating either state; no order advantage.
    const nextA = updateGlickoRating(priorA, [{ ...priorB, score: scoreA }], config);
    const nextB = updateGlickoRating(priorB, [{ ...priorA, score: scoreB }], config);
    const playedAt = new Date(timestamp(event.playedAt)).toISOString();
    const matchUpdates = ([
      { playerId: a.playerId, opponentId: b.playerId, before: priorA, opponentBefore: priorB, after: nextA, score: scoreA },
      { playerId: b.playerId, opponentId: a.playerId, before: priorB, opponentBefore: priorA, after: nextB, score: scoreB },
    ] as const).map(({ playerId, opponentId, before, opponentBefore, after, score }): RatingUpdate => {
      const evidence = opponentEvidence(before, opponentBefore);
      // Use the original update variance, before the reported RD is floored/capped.
      const variance = 1 / (1 / (before.rd * before.rd) + evidence.information);
      return {
        matchId: event.id, playedAt, playerId, opponentId, score,
        before: { ...before }, after: { ...after }, opponentBefore: { ...opponentBefore },
        expectedScore: evidence.expectedScore,
        adjustment: after.rating - before.rating,
        effectiveK: Q * variance * evidence.g,
      };
    });
    updates.push(...matchUpdates.sort((left, right) => compareText(left.playerId, right.playerId)));
    for (const [state, next, score] of [[a, nextA, scoreA], [b, nextB, scoreB]] as const) {
      Object.assign(state, next);
      state.games += 1;
      state.wins += Number(score === 1);
      state.losses += Number(score === 0);
      state.draws += Number(score === 0.5);
      state.lastPlayedAt = playedAt;
    }
  }
  const evaluatedAt = asOfTime ?? (accepted.length ? timestamp(accepted[accepted.length - 1].playedAt) : 0);
  const rows = [...states.values()].map(state => {
    const rd = inflatedRd(state, evaluatedAt);
    return { ...state, rd, provisional: state.games < config.provisionalGames || rd > config.provisionalRd };
  });
  rows.sort((a, b) => Number(b.games > 0) - Number(a.games > 0)
    || b.rating - a.rating || compareText(a.playerId, b.playerId));
  return { rows, updates, ratedMatchCount: accepted.length, duplicateMatchCount, rejectedMatches };
}
