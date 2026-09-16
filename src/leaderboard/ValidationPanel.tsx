import { ACTIVE_ELO_OPTIONS } from './legacy-elo.js';
interface Metrics { matches: number; logLoss: number; brier: number }
interface Candidate { weight: number; validation: Metrics; test: Metrics; verifiedTest: Metrics }
export interface ModelReport {
  model: string;
  dataset: { matches: number; verifiedLivePairs: number; explicitSeasonMatches: number };
  selectedWeight: number;
  candidates: Candidate[];
  limitations: string[];
}
export interface RefreshReport {
  model: string;
  selectedOnValidation: string;
  runs: { id: string; strength: number; estimate: boolean; validation: Metrics; test: Metrics; updates: number }[];
  limitations: string[];
}
export default function ValidationPanel({ report, refreshReport }: { report: ModelReport; refreshReport: RefreshReport | null }) {
  if (!Array.isArray(report.candidates)) return null;
  const initial = report.candidates.find(c => c.weight === ACTIVE_ELO_OPTIONS.livePriorWeight);
  if (!initial) return null;
  return <details className="model-details study-details">
    <summary>Study results behind these choices</summary>
    <p>{report.dataset.matches} eligible games, split chronologically: first 60% to build ratings, next 20% for validation, final 20% for comparison. Lower log loss means better match predictions. Choose settings on validation; the final segment is not used to select them.</p>
    <h3>Initial Live weight · recurring adjustments off</h3>
    <div className="table-scroll"><table className="settings-table"><thead><tr><th>Weight α</th><th>Validation error</th><th>Final-segment error</th></tr></thead><tbody>{report.candidates.map(c => <tr key={c.weight}><th scope="row">{c.weight}{c.weight === report.selectedWeight ? ' · validation winner' : ''}{c.weight === ACTIVE_ELO_OPTIONS.livePriorWeight ? ' · current weight' : ''}</th><td>{c.validation.logLoss.toFixed(5)}</td><td>{c.test.logLoss.toFixed(5)}</td></tr>)}</tbody></table></div>
    {refreshReport && <><h3>Live-gap strength · initial weight fixed at 0.5</h3>
      <div className="table-scroll"><table className="settings-table"><thead><tr><th>Strength β</th><th>Validation error</th><th>Final-segment error</th></tr></thead><tbody>{refreshReport.runs.filter(c => !c.estimate).map(c => <tr key={c.id}><th scope="row">{c.strength === 0 ? 'Off' : c.strength}{c.id === refreshReport.selectedOnValidation ? ' · validation winner' : ''}{c.strength === ACTIVE_ELO_OPTIONS.liveRefreshStrength ? ' · current' : ''}</th><td>{c.validation.logLoss.toFixed(5)}</td><td>{c.test.logLoss.toFixed(5)}</td></tr>)}</tbody></table></div></>}
    <p>These comparisons are exploratory: the archive has been inspected repeatedly, so the final segment is not a fresh holdout. Match prediction error does not establish a fair global ranking. Only {report.dataset.verifiedLivePairs} games have independently verified pre-game Elo timing, all from one recorder, and {report.dataset.explicitSeasonMatches} have explicit season labels. The 17-game verified final subset favored initial weight 0.5 over 1.0; evidence is not uniform.</p>
  </details>;
}
