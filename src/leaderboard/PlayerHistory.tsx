import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { HistoryMatch, HistorySide } from './history.js';
import type { EloRatingUpdate } from './elo.js';
import { showCardBackOnError } from '../tracker/card-art.js';
import { formatMatchDuration } from '../tracker/archive-summary-model.js';
import { playerProfileHref, LEADERBOARD_BASE, LEADERBOARD_ART_HREF, LEADERBOARD_CARD_BACK_HREF } from './profile-route.js';

const date = (value: string) => new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
const back = LEADERBOARD_CARD_BACK_HREF;
const rating = (value: number) => value.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const ratingChange = (value: number) => `${value > 0 ? '+' : value < 0 ? '−' : ''}${rating(Math.abs(value))}`;

function FeaturedPokemon({ side }: { side?: HistorySide }) {
  const artId = side?.pokemon?.artCardId ?? side?.pokemon?.cardId;
  const name = side?.pokemon?.name?.trim();
  const isAssetId = name === side?.pokemon?.cardId || name === side?.pokemon?.artCardId || /^[a-z0-9]+_\d+(?:_[a-z0-9]+)?$/i.test(name ?? '');
  return <span className="history-pokemon">
    <img loading="lazy" decoding="async" src={artId ? `${LEADERBOARD_ART_HREF}/${encodeURIComponent(artId)}.png` : back}
      alt="" data-card-id={artId} onError={event => {
        if (!LEADERBOARD_BASE) return showCardBackOnError(event);
        const fallback = new URL(back, window.location.origin).href;
        if (event.currentTarget.src !== fallback) event.currentTarget.src = fallback;
      }}/>
    <span>{name && !isAssetId ? name : 'Pokémon not recorded'}</span>
  </span>;
}

type PlayerHistoryProps = {
  player: { playerId: string; name: string };
  matches: readonly HistoryMatch[];
  updates: readonly EloRatingUpdate[];
  names: ReadonlyMap<string, string>;
} & ({ mode: 'page'; onClose?: never } | { mode?: 'dialog'; onClose: () => void });

export default function PlayerHistory({ player, matches, updates, names, onClose, mode = 'dialog' }: PlayerHistoryProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  const [shown, setShown] = useState(new URLSearchParams(window.location.search).get('preview') === 'share' ? 3 : 12);
  const updatesByMatch = useMemo(() => new Map(updates.filter(update => update.playerId === player.playerId)
    .map(update => [update.matchId, update])), [updates, player.playerId]);
  const history = matches.filter(match => match.confirmed && match.playerIds.includes(player.playerId))
    .sort((a, b) => b.playedAt.localeCompare(a.playedAt) || a.id.localeCompare(b.id));
  const wins = history.filter(match => match.outcome.type !== 'draw' && match.outcome.winnerId === player.playerId).length;
  const draws = history.filter(match => match.outcome.type === 'draw').length;
  const losses = history.length - wins - draws;
  useEffect(() => {
    if (mode !== 'dialog') return;
    const el = dialog.current!;
    el.showModal();
    return () => el.close();
  }, [mode]);
  const content = <>
    {mode === 'page'
      ? <div className="history-heading"><h2 id={headingId}>Match history</h2><span className="history-page-count">{history.length} ranked {history.length === 1 ? 'match' : 'matches'}</span></div>
      : <div className="history-heading"><div><span className="eyebrow">Match history</span><h2 id={headingId}>{player.name}</h2><p><span className="history-record" aria-label={`${wins} ${wins === 1 ? 'win' : 'wins'}, ${losses} ${losses === 1 ? 'loss' : 'losses'}${draws ? `, ${draws} ${draws === 1 ? 'draw' : 'draws'}` : ''}`}>{wins}W · {losses}L{draws > 0 && <> · {draws}D</>}</span><span> · {history.length} ranked {history.length === 1 ? 'match' : 'matches'}</span></p></div><button type="button" className="secondary" aria-label="Close match history" onClick={onClose} autoFocus>Close</button></div>}
    <div className="history-scroll"><div className="history-table-wrap" tabIndex={0} role="region" aria-label="Match table, scroll for more columns"><table className="history-table" aria-label={`${player.name} match history`}><thead><tr><th scope="col">Result</th><th scope="col">Trace points</th><th scope="col">Opponent</th><th scope="col">Live rating<small>Opponent</small></th><th scope="col">Pokémon<small>Player vs. opponent</small></th><th scope="col">Prizes taken</th><th scope="col">Played<small>Newest first</small></th></tr></thead><tbody>
      {history.slice(0, shown).map(match => {
        const opponentId = match.playerIds.find(id => id !== player.playerId)!;
        const opponent = names.get(opponentId) ?? 'Unknown player';
        const liveElo = match.liveRatings?.[opponentId];
        const hasLiveElo = typeof liveElo === 'number' && Number.isFinite(liveElo);
        const own = match.history?.players[player.playerId], other = match.history?.players[opponentId];
        const result = match.outcome.type === 'draw' ? 'Draw' : match.outcome.winnerId === player.playerId ? 'Win' : 'Loss';
        const update = updatesByMatch.get(match.id);
        return <tr key={match.id} aria-label={`${result} against ${opponent}`}>
          <td><span className={`history-result ${result.toLowerCase()}`}>{result}</span></td>
          <td className={`history-trace-change${update ? update.adjustment > 0 ? ' is-positive' : update.adjustment < 0 ? ' is-negative' : '' : ''}`}
            title={update ? `${player.name}’s Trace rating: ${rating(update.before.rating)} → ${rating(update.after.rating)}` : 'Trace rating change unavailable'}>
            {update ? ratingChange(update.adjustment) : '—'}
          </td>
          <td className="history-opponent">{opponentId ? <a href={playerProfileHref(names.get(opponentId) ?? opponentId)}>{opponent}</a> : opponent}</td>
          <td className="history-elo" title={!hasLiveElo ? 'Live rating not recorded' : match.liveRatingEligibility?.timing === 'pre-match' ? 'Opponent’s Live rating before this match' : 'Opponent’s recorded Live rating; exact timing unknown'}>{hasLiveElo ? Math.round(liveElo).toLocaleString() : '—'}</td>
          <td><div className="history-matchup"><FeaturedPokemon side={own}/><span className="history-versus">vs.</span><FeaturedPokemon side={other}/></div></td>
          <td className="history-prizes"><b>{own?.prizesTaken ?? '—'} <i>–</i> {other?.prizesTaken ?? '—'}</b></td>
          <td className="history-date"><time dateTime={match.playedAt}>{date(match.playedAt)}</time>{match.history?.durationSeconds !== undefined && <small>{formatMatchDuration(match.history.durationSeconds)}</small>}</td>
        </tr>;
      })}
    </tbody></table></div>{!history.length && <p className="empty">No matches counted toward this rating yet.</p>}
    {shown < history.length && <button type="button" className="secondary history-more" onClick={() => setShown(value => value + 12)}>Show more matches · {history.length - shown} left</button>}
    <p className="history-note">Points, Pokémon and prizes are shown from {player.name}’s side. Their Pokémon and prizes appear first.</p>
    <details className="history-details"><summary>About this history</summary>
      <p>This history shows matches that count toward the Trace rating. Each needs a result and both players’ Live ratings. Points are rounded to one decimal.</p>
      <p>Pokémon are the main ones seen in the recorded deck or match. A dash means that detail wasn’t recorded.</p>
      <p>The Live rating is the opponent’s in-game rating recorded with that match. For some older matches, we do not know exactly when the rating was captured. Some dates show when a match was imported.</p>
    </details></div>
  </>;
  if (mode === 'page') return <section className="history-page" aria-labelledby={headingId}>{content}</section>;
  return <dialog ref={dialog} className="history-dialog" aria-labelledby={headingId} onCancel={onClose}
    onClick={event => { if (event.target === event.currentTarget) { const r = event.currentTarget.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) onClose?.(); } }}>
    {content}
  </dialog>;
}
