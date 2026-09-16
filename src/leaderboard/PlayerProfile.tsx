import React, { useState } from 'react';
import { ArrowLeft } from '@phosphor-icons/react';
import type { EloLeaderboardRow, EloRatingUpdate } from './elo.js';
import type { HistoryMatch } from './history.js';
import PlayerHistory from './PlayerHistory.js';
import RatingScore from './RatingScore.js';
import { playerProfileShareHref, LEADERBOARD_HREF } from './profile-route.js';
import './player-profile.css';

export interface PlayerProfileProps {
  row: EloLeaderboardRow;
  registered?: boolean;
  rank?: number | null;
  rankScope?: 'registered' | 'all';
  matches: readonly HistoryMatch[];
  updates: readonly EloRatingUpdate[];
  names: ReadonlyMap<string, string>;
  latestLiveRating?: number;
  liveRatingObservedAt?: string;
  liveRatingTiming?: 'pre-match' | 'post-match' | 'match-snapshot';
  liveRatingBefore?: number;
  liveRatingChange?: number;
  generatedAt?: string;
}

export default function PlayerProfile({ row, registered, rank, rankScope = 'registered', matches, updates, names,
  latestLiveRating, liveRatingObservedAt, liveRatingTiming, liveRatingBefore, liveRatingChange, generatedAt }: PlayerProfileProps) {
  const [ratingActive, setRatingActive] = useState(false);
  const [shareMessage, setShareMessage] = useState('');
  const [showShareLink, setShowShareLink] = useState(false);
  const ranked = row.games > 0 && typeof rank === 'number' && Number.isInteger(rank) && rank > 0;
  const winRate = row.games ? Math.round(row.wins / row.games * 100) : undefined;
  const shareLink = new URL(playerProfileShareHref(row.name, generatedAt), window.location.origin).href;

  async function copyProfileLink() {
    try {
      await navigator.clipboard.writeText(shareLink);
      setShareMessage('Profile link copied.');
      setShowShareLink(false);
    } catch {
      setShareMessage('Select and copy this link to share.');
      setShowShareLink(true);
    }
  }

  return <section className="player-profile" aria-labelledby="player-profile-title">
    <div className="profile-navigation">
      <a className="profile-back" href={LEADERBOARD_HREF}><ArrowLeft size={16} aria-hidden="true"/> Leaderboard</a>
      <div className="profile-share"><button type="button" onClick={() => void copyProfileLink()} aria-label="Copy link to profile">Copy link</button><span role="status">{shareMessage}</span>{showShareLink && <input className="share-link-fallback" aria-label="Profile share link" readOnly value={shareLink} onFocus={event => event.currentTarget.select()}/>}</div>
    </div>

    <header className="profile-header">
      <div className="profile-identity">
        <div className="profile-rankline"><span className="profile-rank">{ranked ? `#${rank.toLocaleString()}` : 'Unranked'}</span><span>{rankScope === 'all' ? 'All players' : 'Trace players'}</span></div>
        <h1 id="player-profile-title">{row.name}</h1>
        {registered === false && <p className="profile-registration" title="Appears in other players’ Trace matches."><span>Not registered</span></p>}
      </div>
      <dl className="profile-stats">
        <div><dt>Record</dt><dd className="profile-record" aria-label={`${row.wins} wins, ${row.losses} losses${row.draws ? `, ${row.draws} draws` : ''}`}><span>{row.wins}W</span><i>–</i><span>{row.losses}L</span>{row.draws > 0 && <><i>–</i><span>{row.draws}D</span></>}</dd></div>
        <div><dt>Win rate</dt><dd>{winRate === undefined ? '—' : `${winRate}%`}</dd></div>
        <div><dt>Matches</dt><dd>{row.games.toLocaleString()}</dd></div>
      </dl>
      <div className="profile-rating">
        <span className="profile-label">Trace rating</span>
        <div className="profile-score"><RatingScore key={row.playerId} active={ratingActive} onOpen={() => setRatingActive(true)} row={row} updates={updates} names={names}
          latestLiveRating={latestLiveRating} liveRatingObservedAt={liveRatingObservedAt} liveRatingTiming={liveRatingTiming}
          liveRatingBefore={liveRatingBefore} liveRatingChange={liveRatingChange}/></div>
      </div>
    </header>

    {row.games === 0 && <p className="profile-empty-note">No matches counted yet. A ranked match needs a result and both players’ Live ratings recorded to count.</p>}
    <PlayerHistory key={row.playerId} mode="page" player={row} matches={matches} updates={updates} names={names}/>
  </section>;
}
