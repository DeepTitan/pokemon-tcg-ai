import { prepareRatingEvents, type RatingMatchEvent } from './rating.js';

export type LiveEloEvent = RatingMatchEvent & {
  liveRatings?: Record<string, number>;
  liveRatingsAfter?: Record<string, number>;
  liveRatingEligibility?: { timing: string };
};
/** Ranking eligibility is match-local: profile and after-scores cannot qualify a game.
 * Merge duplicate captures before checking both sides; conflicting values exclude it.
 * Keep this independent of verifiedLiveOnly, which restricts priors in sensitivity studies.
 */
export function prepareRankedEloEvents(events: readonly LiveEloEvent[], asOf?: string) {
  const prepared = prepareRatingEvents(events, asOf);
  const evidence = new Map<string, Map<string, Set<number>>>();
  for (const event of events) {
    const byPlayer = evidence.get(event.id) ?? new Map<string, Set<number>>();
    for (const id of event.playerIds) {
      const value = event.liveRatings?.[id];
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) continue;
      const values = byPlayer.get(id) ?? new Set<number>();
      values.add(value); byPlayer.set(id, values);
    }
    evidence.set(event.id, byPlayer);
  }
  const accepted: LiveEloEvent[] = [];
  const rejectedMatches = [...prepared.rejectedMatches];
  for (const event of prepared.accepted) {
    const values = event.playerIds.map(id => evidence.get(event.id)?.get(id));
    if (values.some(value => value?.size !== 1)) {
      rejectedMatches.push({ id: event.id, reason: 'Ranking requires unambiguous captured Live Elo for both players in this match' });
      continue;
    }
    accepted.push({ ...event, liveRatings: Object.fromEntries(event.playerIds.map((id, i) => [id, [...values[i]!][0]])) });
  }
  return { ...prepared, accepted, rejectedMatches };
}
