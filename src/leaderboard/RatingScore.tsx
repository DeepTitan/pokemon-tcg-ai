import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { LEADERBOARD_HREF } from './profile-route.js';
import { ELO_OPTIONS, type EloLeaderboardRow as LeaderboardRow, type EloRatingUpdate as RatingUpdate } from './elo.js';

interface Props {
  active: boolean;
  onOpen: () => void;
  row: LeaderboardRow;
  updates: readonly RatingUpdate[];
  names: ReadonlyMap<string, string>;
  latestLiveRating?: number;
  liveRatingObservedAt?: string;
  liveRatingTiming?: 'pre-match' | 'post-match' | 'match-snapshot';
  liveRatingBefore?: number;
  liveRatingChange?: number;
}

const decimal = (value: number) => value.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const signed = (value: number) => `${value < 0 ? '−' : '+'}${decimal(Math.abs(value))}`;
const percent = (value: number) => (value * 100).toLocaleString(undefined, { maximumFractionDigits: 2 });
const date = (value: string) => new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

/** One ranking value, with its actual replay evidence available on hover, focus, or tap. */
export default function RatingScore({ active, onOpen, row, updates, names, latestLiveRating, liveRatingObservedAt, liveRatingTiming, liveRatingBefore, liveRatingChange }: Props) {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0, maxHeight: 'calc(100dvh - 24px)' });
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout>>();
  const dismissed = useRef(false);
  const tooltipId = useId();

  function cancelClose() { clearTimeout(closeTimer.current); }
  function show() { cancelClose(); if (!dismissed.current) { onOpen(); setOpen(true); } }
  function dismiss(restoreFocus = false) {
    cancelClose();
    if (restoreFocus) trigger.current?.focus({ preventScroll: true });
    dismissed.current = true;
    setOpen(false);
    setPinned(false);
  }
  function scheduleClose() {
    cancelClose();
    closeTimer.current = setTimeout(() => {
      if (document.activeElement !== trigger.current && !panel.current?.contains(document.activeElement)) {
        setOpen(false);
        setPinned(false);
      }
    }, 140);
  }
  useEffect(() => () => clearTimeout(closeTimer.current), []);
  useEffect(() => {
    if (!active) { clearTimeout(closeTimer.current); setOpen(false); setPinned(false); }
  }, [active]);

  useLayoutEffect(() => {
    if (!open || !trigger.current || !panel.current) return;
    const anchor = trigger.current.getBoundingClientRect();
    const bounds = panel.current.getBoundingClientRect();
    const height = Math.min(panel.current.scrollHeight + 2, window.innerHeight - 24);
    if (window.innerWidth <= 650) {
      setPosition({ left: 12, top: 12, maxHeight: 'calc(100dvh - 24px)' });
      return;
    }
    const rightFits = anchor.right + 12 + bounds.width <= window.innerWidth - 12;
    const leftFits = anchor.left - 12 - bounds.width >= 12;
    if (rightFits || leftFits) {
      setPosition({
        left: rightFits ? anchor.right + 12 : anchor.left - 12 - bounds.width,
        top: Math.max(12, Math.min(anchor.top - 24, window.innerHeight - height - 12)),
        maxHeight: 'calc(100dvh - 24px)',
      });
    } else {
      const below = window.innerHeight - anchor.bottom - 22;
      const above = anchor.top - 22;
      const useBelow = below >= height || (above < height && below >= above);
      const maxHeight = Math.max(1, useBelow ? below : above);
      setPosition({
        left: Math.max(12, Math.min(anchor.left - 24, window.innerWidth - bounds.width - 12)),
        top: useBelow ? anchor.bottom + 10 : anchor.top - 10 - Math.min(height, maxHeight),
        maxHeight: `${maxHeight}px`,
      });
    }
  }, [open, pinned, detailsOpen]);

  useEffect(() => {
    if (open && pinned) panel.current?.focus({ preventScroll: true });
  }, [open, pinned]);

  useEffect(() => {
    if (!open) return;
    const inside = (target: EventTarget | null) => target instanceof Node
      && (trigger.current?.contains(target) || panel.current?.contains(target));
    const dismissOutside = (event: PointerEvent) => { if (!inside(event.target)) dismiss(); };
    const dismissOnScroll = (event: Event) => { if (!panel.current?.contains(event.target as Node)) dismiss(); };
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); dismiss(pinned); }
    };
    const dismissOnResize = () => dismiss();
    document.addEventListener('pointerdown', dismissOutside);
    document.addEventListener('keydown', dismissOnEscape);
    window.addEventListener('scroll', dismissOnScroll, true);
    window.addEventListener('resize', dismissOnResize);
    return () => {
      document.removeEventListener('pointerdown', dismissOutside);
      document.removeEventListener('keydown', dismissOnEscape);
      window.removeEventListener('scroll', dismissOnScroll, true);
      window.removeEventListener('resize', dismissOnResize);
    };
  }, [open, pinned]);

  const starting = ELO_OPTIONS.initialRating;
  const gains = updates.reduce((total, update) => total + Math.max(0, update.adjustment), 0);
  const losses = updates.reduce((total, update) => total + Math.min(0, update.adjustment), 0);
  const latest = updates[updates.length - 1];

  return <>
    <button ref={trigger} className={`rating-trigger${row.games ? '' : ' unrated-score'}`} type="button"
      aria-label={`${row.name}: ${row.games ? `Trace rating ${Math.round(row.rating).toLocaleString()}` : 'No rating yet'}. Show rating breakdown`}
      aria-expanded={open} aria-haspopup="dialog" aria-controls={open ? tooltipId : undefined}
      onMouseEnter={() => { if (window.innerWidth > 650) { dismissed.current = false; show(); } }} onMouseLeave={scheduleClose}
      onFocus={() => { if (window.innerWidth > 650) { dismissed.current = false; show(); } }} onBlur={scheduleClose}
      onClick={() => { dismissed.current = false; setPinned(true); show(); }}>
      {row.games ? Math.round(row.rating).toLocaleString() : '—'}
    </button>
    {open && createPortal(<div ref={panel} id={tooltipId} role="dialog" className="rating-tooltip"
      aria-modal={false} aria-labelledby={`${tooltipId}-heading`} tabIndex={-1}
      style={position} onMouseEnter={cancelClose} onMouseLeave={scheduleClose} onBlur={scheduleClose}>
      <button className="rating-close" aria-label="Close rating breakdown" onClick={() => dismiss(true)}>Close</button>
      <div className="rating-tooltip-heading"><span>Rating breakdown</span><strong id={`${tooltipId}-heading`}>{row.name}</strong></div>
      {row.games > 0 ? <>
        <dl className="rating-ledger">
          <div><dt>Starting rating</dt><dd>{decimal(starting)}</dd></div>
          <div><dt>Points from {row.games} {row.games === 1 ? 'match' : 'matches'}</dt><dd>{signed(gains + losses)}</dd></div>
          <div className="rating-ledger-total"><dt>Trace rating</dt><dd>{decimal(row.rating)}</dd></div>
        </dl>
        {latest && <div className="rating-latest">
          <strong>{latest.score === 1 ? 'Win' : latest.score === 0 ? 'Loss' : 'Draw'} vs. {names.get(latest.opponentId) ?? latest.opponentId}</strong>
          <span>Latest match · {date(latest.playedAt)}</span>
          <p className="rating-equation">{decimal(latest.before.rating)} {signed(latest.adjustment)} ≈ {decimal(latest.after.rating)}</p>
        </div>}
      </> : <p className="rating-confidence">No matches count yet. A finished ranked match needs both players’ Live ratings recorded to count.</p>}
      <div className="rating-live"><div><strong>Latest Live rating</strong><b>{latestLiveRating === undefined ? 'Not recorded' : Math.round(latestLiveRating).toLocaleString()}</b></div>
        {latestLiveRating !== undefined && liveRatingObservedAt && <span>Recorded {date(liveRatingObservedAt)} · {liveRatingTiming === 'post-match' ? 'after the match' : liveRatingTiming === 'pre-match' ? 'before the match' : 'before or after match unknown'}</span>}
        {latestLiveRating !== undefined && liveRatingTiming === 'post-match' && <p>This after-match rating did not set that match’s points.</p>}
      </div>
      {row.games > 0 && <details className="rating-details" onToggle={event => setDetailsOpen(event.currentTarget.open)}><summary>View calculation</summary>
        {latest?.matchEvidence && <div className="rating-calculation">
          <table className="rating-inputs">
            <caption>Numbers used for the latest match</caption>
            <thead><tr><th scope="col">Rating detail</th><th scope="col">Player</th><th scope="col">Opponent</th></tr></thead>
            <tbody>
              <tr><th scope="row">Trace before match</th><td>{decimal(latest.before.rating)}</td><td>{decimal(latest.opponentBefore.rating)}</td></tr>
              <tr><th scope="row">Live rating used</th><td>{decimal(latest.matchEvidence.ownLive)}</td><td>{decimal(latest.matchEvidence.opponentLive)}</td></tr>
              {latest.matchEvidence.model === 'fading-live' && <tr><th scope="row">Earlier matches counted</th><td>{latest.matchEvidence.ownPriorGames}</td><td>{latest.matchEvidence.opponentPriorGames}</td></tr>}
              <tr><th scope="row">Trace share</th><td>{percent(latest.matchEvidence.ownTraceWeight)}%</td><td>{percent(latest.matchEvidence.opponentTraceWeight)}%</td></tr>
              <tr><th scope="row">Live share</th><td>{percent(1 - latest.matchEvidence.ownTraceWeight)}%</td><td>{percent(1 - latest.matchEvidence.opponentTraceWeight)}%</td></tr>
              <tr className="rating-inputs-total"><th scope="row">Combined rating</th><td>{decimal(latest.matchEvidence.ownBlend)}</td><td>{decimal(latest.matchEvidence.opponentBlend)}</td></tr>
            </tbody>
          </table>
          {latest.matchEvidence.liveScale && <>
            <dl className="rating-ledger">
              <div><dt>Recorded Live rating · player / opponent</dt><dd>{decimal(latest.matchEvidence.rawOwnLive)} / {decimal(latest.matchEvidence.rawOpponentLive)}</dd></div>
            </dl>
            <p>Season {latest.matchEvidence.liveScale.seasonId}: Live rating used = recorded Live rating × {latest.matchEvidence.liveScale.scale} {signed(latest.matchEvidence.liveScale.offset)}. Source for this adjustment: {latest.matchEvidence.liveScale.evidence}.</p>
          </>}
          <p>Each combined rating = Trace rating × its share + Live rating × its share.</p>
          {latest.matchEvidence.model === 'fading-live' && <>
            <p className="rating-formula">Player’s Live share = {percent(latest.matchEvidence.initialOwnLiveWeight!)}% × {latest.matchEvidence.liveFadeGames} / ({latest.matchEvidence.liveFadeGames} + {latest.matchEvidence.ownPriorGames}) = {percent(1 - latest.matchEvidence.ownTraceWeight)}%.<br/>
              Opponent’s Live share = 100% × {latest.matchEvidence.liveFadeGames} / ({latest.matchEvidence.liveFadeGames} + {latest.matchEvidence.opponentPriorGames}) = {percent(1 - latest.matchEvidence.opponentTraceWeight)}%.</p>
            <p>Live ratings count less as more ranked matches count toward Trace ratings. Missing matches and time away do not change these shares.</p>
          </>}
          {latest.matchEvidence.model === 'coverage-aware' && <p>Opponent’s Trace share = {percent(1 - latest.matchEvidence.ownTraceWeight)}% × {latest.matchEvidence.opponentPriorGames} / ({latest.matchEvidence.opponentPriorGames} + {latest.matchEvidence.opponentHistoryHalfWeight}) = {percent(latest.matchEvidence.opponentTraceWeight)}%. With no earlier matches counted, the opponent uses only Live.</p>}
          <p className="rating-formula">Points factor = 1 / (1 + 10^(({decimal(latest.matchEvidence.opponentBlend)} − {decimal(latest.matchEvidence.ownBlend)}) / {ELO_OPTIONS.expectedScale})) ≈ {latest.expectedScore.toFixed(3)}.</p>
          <p className="rating-formula">Match points = {latest.effectiveK} × ({latest.score} − {latest.expectedScore.toFixed(3)}) ≈ <strong>{signed(latest.adjustment)}</strong>.</p>
          <p>Win = 1 · Draw = 0.5 · Loss = 0. The points factor sets the change in rating. It is not a measured chance of winning. Each update uses both players’ Trace ratings from before the match, plus the Live ratings recorded with it.</p>
        </div>}
        <p>Across all matches: {signed(gains)} gained, {signed(losses)} lost. Matches count once, oldest first.</p>
        {liveRatingTiming === 'post-match' && liveRatingBefore !== undefined && latestLiveRating !== undefined && <p>Latest Live rating change: {Math.round(liveRatingBefore).toLocaleString()} → {Math.round(latestLiveRating).toLocaleString()}{liveRatingChange !== undefined ? ` (${signed(liveRatingChange)})` : ''}. This after-match change is not used to set Trace points.</p>}
        {row.provisional && <p>Fewer than {ELO_OPTIONS.provisionalGames} matches counted. More matches will give Trace more history to work with.</p>}
        <p>Figures rounded for display.</p>
        <a href={`${LEADERBOARD_HREF}#method`} onClick={() => dismiss()}>How ratings work →</a>
      </details>}
    </div>, document.body)}
  </>;
}
