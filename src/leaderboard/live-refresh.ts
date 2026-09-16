import { ELO_OPTIONS, LIVE_REFRESH_OPTIONS } from './parameters.js';

/** A causal measurement-gap filter. Live after a recorded match is the next
 * reference, so that match's rating change isn't also treated as missing play. */
export interface LiveRefresh {
  adjustment: number;
  before: number;
  after: number;
  live: number;
  reference?: number;
  unexplainedLiveChange?: number;
  reliability?: number;
  strength: number;
  referenceKind?: 'captured-after' | 'estimated-after';
  status: 'updated' | 'unchanged' | 'reset-held' | 'overlap-unknown';
}
interface Reference { value: number; kind: 'captured-after' | 'estimated-after'; season: string; at: number }
const median = (values: number[]) => { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.floor(sorted.length / 2)]; };
export class LiveRefreshTracker {
  private references = new Map<string, Reference>();
  private held = new Set<string>();
  private kBySeason = new Map<string, number[]>();
  private seasons = new Map<string, string>();
  constructor(private strength: number, private useEstimates: boolean) {}
  refresh(id: string, live: number, rating: number, season: string, phase: string | undefined, at: number, scale: number): LiveRefresh {
    const reference = this.references.get(id);
    const difference = reference ? live - reference.value : undefined;
    // A known season change or a suspicious downward discontinuity is NOT a loss.
    if ((this.seasons.has(id) && this.seasons.get(id) !== season) || (reference && difference! <= -LIVE_REFRESH_OPTIONS.resetDrop)) this.held.add(id);
    // Explicit collection metadata must confirm the new ladder is settled.
    if (phase === 'settled' && this.held.has(id)) {
      this.held.delete(id); this.references.delete(id); this.seasons.set(id, season);
      return { adjustment: 0, before: rating, after: rating, live, strength: this.strength, status: 'overlap-unknown' };
    }
    const base = { before: rating, live, strength: this.strength,
      ...(reference ? { reference: reference.value, referenceKind: reference.kind, unexplainedLiveChange: difference } : {}) };
    if (this.held.has(id)) return { ...base, adjustment: 0, after: rating, status: 'reset-held' };
    if (!reference || reference.season !== season || reference.at >= at) return { ...base, adjustment: 0, after: rating, status: 'overlap-unknown' };
    const reliability = reference.kind === 'captured-after' ? 1 : 0.5;
    const adjustment = Math.max(-LIVE_REFRESH_OPTIONS.cap, Math.min(LIVE_REFRESH_OPTIONS.cap, scale * this.strength * reliability * difference!));
    return { ...base, reliability, adjustment, after: rating + adjustment, status: adjustment ? 'updated' : 'unchanged' };
  }
  complete(id: string, live: number | undefined, opponentLive: number | undefined, after: number | undefined,
    score: number, season: string, at: number) {
    if (this.seasons.has(id) && this.seasons.get(id) !== season) this.held.add(id);
    this.seasons.set(id, season);
    const kSamples = this.kBySeason.get(season) ?? [];
    // Called only after the match prediction AND game update for both players.
    const expected = live !== undefined && opponentLive !== undefined ? 1 / (1 + 10 ** ((opponentLive - live) / ELO_OPTIONS.expectedScale)) : undefined;
    if (after !== undefined) this.references.set(id, { value: after, kind: 'captured-after', season, at });
    else if (this.useEstimates && live !== undefined && expected !== undefined && kSamples.length >= 10) {
      this.references.set(id, { value: live + median(kSamples) * (score - expected), kind: 'estimated-after', season, at });
    } else this.references.delete(id); // Can't subtract unknown recorded-game overlap.
  }
  learn(live: number | undefined, opponentLive: number | undefined, after: number | undefined, score: number, season: string) {
    if (live === undefined || opponentLive === undefined || after === undefined) return;
    const residual = score - 1 / (1 + 10 ** ((opponentLive - live) / ELO_OPTIONS.expectedScale));
    const k = (after - live) / residual;
    if (Math.abs(residual) >= 0.1 && Number.isFinite(k) && k > 0 && k <= 128) {
      const samples = this.kBySeason.get(season) ?? [];
      samples.push(k); if (samples.length > 100) samples.shift();
      this.kBySeason.set(season, samples);
    }
  }
}
