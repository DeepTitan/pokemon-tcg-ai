/** An explicit, evidenced mapping onto a shared Live scale. Never infer one
 * from a single player's movement. No calibration exists for the current archive.
 * availableAt prevents a mapping learned later from leaking into an earlier game.
 */
export interface LiveScaleCalibration {
  seasonId: string;
  scale: number;
  offset: number;
  availableAt: string;
  evidence: string;
}
const isoTime = (value: string) => typeof value === 'string'
  && /(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
export function validateLiveScaleCalibrations(calibrations: readonly LiveScaleCalibration[]) {
  const seasons = new Set<string>();
  for (const calibration of calibrations) {
    if (!calibration || typeof calibration.seasonId !== 'string' || !calibration.seasonId.trim()
      || calibration.seasonId !== calibration.seasonId.trim() || seasons.has(calibration.seasonId)
      || !Number.isFinite(calibration.scale) || calibration.scale <= 0 || !Number.isFinite(calibration.offset)
      || !isoTime(calibration.availableAt) || typeof calibration.evidence !== 'string' || !calibration.evidence.trim()) {
      throw new RangeError('Live scale mappings require one explicit season, positive scale, finite offset, availability time and evidence');
    }
    seasons.add(calibration.seasonId);
  }
}
export function matchLiveScale(seasonId: string | undefined, playedAt: string, calibrations: readonly LiveScaleCalibration[]) {
  return seasonId === undefined ? undefined : calibrations.find(calibration => calibration.seasonId === seasonId
    && Date.parse(calibration.availableAt) <= Date.parse(playedAt));
}
export function normalizeMatchLive(raw: number, calibration?: LiveScaleCalibration) {
  const value = calibration ? raw * calibration.scale + calibration.offset : raw;
  if (!Number.isFinite(value) || value < 0) throw new RangeError('Normalized Live score must be finite and nonnegative');
  return value;
}
