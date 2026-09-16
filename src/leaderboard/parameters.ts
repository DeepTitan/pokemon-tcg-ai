/** Active settings are shared by the replay and its explanation. */
export const ELO_OPTIONS = Object.freeze({
  initialRating: 1500,
  k: 32,
  expectedScale: 400,
  provisionalGames: 10,
  seasonAnchorPlayers: 5,
  seasonAnchorGames: 10,
});
export const LIVE_PRIOR_WEIGHT = 0.5;
export const ACTIVE_ELO_OPTIONS = Object.freeze({
  model: 'fading-live' as const,
  // Live reliance halves after this many prior eligible games for each player.
  // This remains a transparent trial setting, not calibrated confidence.
  liveFadeGames: 20,
  initialOwnLiveWeight: 0.25,
  // Defaults for the preserved fixed and coverage-aware research baselines.
  liveOpponentWeight: 0.75,
  // Half the opponent Trace ceiling at 20 prior games. A cold-start policy,
  // approximately the local convergence half-life, not fitted confidence.
  opponentHistoryHalfWeight: 20,
  requirePairedLiveRatings: true,
});
export const RATING_MODEL_VERSION = 'fading-live-v1';
export const LIVE_REFRESH_OPTIONS = Object.freeze({ cap: 32, resetDrop: 150 });
