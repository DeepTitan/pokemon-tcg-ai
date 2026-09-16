import type { HistoryMatch, HistorySide, MatchHistoryPreview } from '../src/leaderboard/history.js';
import { validateLiveScaleCalibrations, type LiveScaleCalibration } from '../src/leaderboard/live-scale.js';

export interface PublicLeaderboardPlayer {
  id: string;
  name: string;
  traceStatus: 'trace-user' | 'opponent-only';
  latestLiveRating?: number;
  liveRatingObservedAt?: string;
  liveRatingTiming?: 'pre-match' | 'post-match' | 'match-snapshot';
  liveRatingBefore?: number;
  liveRatingChange?: number;
}

export type PublicLeaderboardMatch = Omit<HistoryMatch, 'liveRatingsAfter' | 'liveRatingEligibility'> & {
  liveRatingEligibility?: { timing: 'pre-match' | 'post-match' | 'match-snapshot'; valueType: 'elo' };
};

export interface PublicLeaderboardSnapshot {
  schema: 'trace-leaderboard/v1';
  generatedAt: string;
  sourceLabel: 'Trace matches';
  players: PublicLeaderboardPlayer[];
  matches: PublicLeaderboardMatch[];
  liveScaleCalibrations?: LiveScaleCalibration[];
}

type JsonObject = Record<string, unknown>;
const owns = (value: JsonObject, key: string) => Object.prototype.hasOwnProperty.call(value, key);
function object(value: unknown, field: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`Invalid ${field}: expected an object`);
  return value as JsonObject;
}
function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`Invalid ${field}: expected nonempty text`);
  return value;
}
function number(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`Invalid ${field}: expected a finite number`);
  return value;
}
function array(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`Invalid ${field}: expected an array`);
  return value;
}
function timing(value: unknown): NonNullable<PublicLeaderboardPlayer['liveRatingTiming']> {
  if (value !== 'pre-match' && value !== 'post-match' && value !== 'match-snapshot') throw new TypeError('Invalid Live rating timing');
  return value;
}
function projectPlayer(input: unknown): PublicLeaderboardPlayer {
  const player = object(input, 'player');
  if (player.traceStatus !== 'trace-user' && player.traceStatus !== 'opponent-only') throw new TypeError('Invalid player registration status');
  const result: PublicLeaderboardPlayer = {
    id: text(player.id, 'player ID'), name: text(player.name, 'player name'), traceStatus: player.traceStatus,
  };
  for (const key of ['latestLiveRating', 'liveRatingBefore', 'liveRatingChange'] as const) {
    if (owns(player, key)) result[key] = number(player[key], key);
  }
  if (owns(player, 'liveRatingObservedAt')) result.liveRatingObservedAt = text(player.liveRatingObservedAt, 'Live observation time');
  if (owns(player, 'liveRatingTiming')) result.liveRatingTiming = timing(player.liveRatingTiming);
  return result;
}
function projectHistory(input: unknown, playerIds: readonly string[]): MatchHistoryPreview {
  const history = object(input, 'match history'), players = object(history.players, 'history players');
  const entries: [string, HistorySide][] = [];
  for (const id of playerIds) {
    if (!owns(players, id)) continue;
    const side = object(players[id], 'history side'), projected: HistorySide = {};
    if (owns(side, 'pokemon')) {
      const pokemon = object(side.pokemon, 'featured Pokémon');
      projected.pokemon = { name: text(pokemon.name, 'Pokémon name') };
      for (const key of ['cardId', 'artCardId'] as const) {
        if (owns(pokemon, key)) projected.pokemon[key] = text(pokemon[key], key);
      }
    }
    if (owns(side, 'prizesTaken')) projected.prizesTaken = number(side.prizesTaken, 'prizes taken');
    entries.push([id, projected]);
  }
  const result: MatchHistoryPreview = { players: Object.fromEntries(entries) };
  if (owns(history, 'durationSeconds')) result.durationSeconds = number(history.durationSeconds, 'match duration');
  return result;
}
function projectMatch(input: unknown): PublicLeaderboardMatch {
  const match = object(input, 'match'), ids = array(match.playerIds, 'match players');
  if (ids.length !== 2 || typeof match.confirmed !== 'boolean') throw new TypeError('Invalid match participants or confirmation');
  const playerIds: [string, string] = [text(ids[0], 'player ID'), text(ids[1], 'player ID')];
  const outcome = object(match.outcome, 'match outcome');
  if (outcome.type !== 'win' && outcome.type !== 'draw') throw new TypeError('Invalid match outcome');
  const result: PublicLeaderboardMatch = {
    id: text(match.id, 'match ID'), playedAt: text(match.playedAt, 'match time'), playerIds,
    confirmed: match.confirmed,
    outcome: outcome.type === 'draw' ? { type: 'draw' } : { type: 'win', winnerId: text(outcome.winnerId, 'winner ID') },
  };
  // Season and phase also participate in duplicate detection. Keep them unchanged.
  for (const key of ['seasonId', 'phase'] as const) if (owns(match, key)) result[key] = text(match[key], key);
  if (owns(match, 'liveRatings')) {
    const ratings = object(match.liveRatings, 'match Live ratings');
    result.liveRatings = Object.fromEntries(playerIds.filter(id => owns(ratings, id)).map(id => [id, number(ratings[id], 'Live rating')]));
  }
  if (owns(match, 'liveRatingEligibility')) {
    const eligibility = object(match.liveRatingEligibility, 'Live rating eligibility');
    if (eligibility.valueType !== 'elo') throw new TypeError('Invalid Live rating value type');
    result.liveRatingEligibility = { timing: timing(eligibility.timing), valueType: 'elo' };
  }
  if (owns(match, 'history')) result.history = projectHistory(match.history, playerIds);
  return result;
}

/** Publish only fields needed to render and replay the leaderboard. Never spread an
 * archive object: sources, diagnostic evidence, raw logs and decklists stay private.
 * This is a shape boundary, not a rating filter; rejected and duplicate matches must
 * remain present so replay has the same acceptance decisions as the source archive.
 */
export function projectPublicLeaderboardSnapshot(input: unknown): PublicLeaderboardSnapshot {
  const snapshot = object(input, 'leaderboard snapshot');
  if (snapshot.schema !== 'trace-leaderboard/v1') throw new TypeError('Unsupported leaderboard snapshot schema');
  const result: PublicLeaderboardSnapshot = {
    schema: 'trace-leaderboard/v1', generatedAt: text(snapshot.generatedAt, 'snapshot time'), sourceLabel: 'Trace matches',
    players: array(snapshot.players, 'players').map(projectPlayer), matches: array(snapshot.matches, 'matches').map(projectMatch),
  };
  if (owns(snapshot, 'liveScaleCalibrations')) {
    const calibrations = array(snapshot.liveScaleCalibrations, 'Live scale mappings').map(input => {
      const calibration = object(input, 'Live scale mapping');
      return {
        seasonId: text(calibration.seasonId, 'season ID'), scale: number(calibration.scale, 'Live scale'),
        offset: number(calibration.offset, 'Live offset'), availableAt: text(calibration.availableAt, 'mapping availability'),
        evidence: text(calibration.evidence, 'mapping evidence'),
      };
    });
    validateLiveScaleCalibrations(calibrations);
    result.liveScaleCalibrations = calibrations.map(({ seasonId, scale, offset, availableAt }) => ({
      seasonId, scale, offset, availableAt, evidence: 'Verified season-scale mapping.',
    }));
  }
  return result;
}
