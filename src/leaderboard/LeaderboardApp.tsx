import React, { useEffect, useMemo, useState } from 'react';
import { Crown, Info, MagnifyingGlass } from '@phosphor-icons/react';
import { ACTIVE_ELO_OPTIONS, prepareRankedEloEvents, replayEloRatings, type EloRatingUpdate as RatingUpdate } from './elo.js';
import RatingScore from './RatingScore.js';
import ModelSettings from './ModelSettings.js';
import PlayerProfile from './PlayerProfile.js';
import { playerProfileHref, LEADERBOARD_BASE, LEADERBOARD_HREF, LEADERBOARD_DATA_HREF, LEADERBOARD_MASCOT_HREF } from './profile-route.js';
import { startSnapshotRefresh, type LeaderboardSnapshot, type SnapshotRefreshStatus } from './snapshot-refresh.js';
import './styles.css';

const number = (value: number) => Math.round(value).toLocaleString();
const date = (value: string) => new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
function profileNameFromPath() {
  const segment = window.location.pathname.slice(LEADERBOARD_BASE.length).match(/^\/players\/([^/]+)\/?$/)?.[1];
  try { return segment ? decodeURIComponent(segment) : null; } catch { return ''; }
}

export default function LeaderboardApp() {
  const sharePreview = new URLSearchParams(window.location.search).get('preview') === 'share';
  const pageSize = sharePreview ? 8 : 25;
  const [snapshot, setSnapshot] = useState<LeaderboardSnapshot | null>(null);
  const [refreshStatus, setRefreshStatus] = useState<SnapshotRefreshStatus>({ checking: false, lastCheckedAt: null, failed: false });
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [showUnregistered, setShowUnregistered] = useState(false);
  const [activeRating, setActiveRating] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [coverageOpen, setCoverageOpen] = useState(false);
  const [showMethod, setShowMethod] = useState(window.location.hash === '#method');
  const profileName = profileNameFromPath();
  useEffect(() => { document.body.classList.toggle('share-preview', sharePreview); return () => document.body.classList.remove('share-preview'); }, [sharePreview]);
  useEffect(() => {
    const sync = () => { setShowMethod(window.location.hash === '#method'); setActiveRating(null); };
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);
  useEffect(() => startSnapshotRefresh({ url: LEADERBOARD_DATA_HREF, onSnapshot: setSnapshot, onStatus: setRefreshStatus }), []);
  const result = useMemo(() => snapshot ? replayEloRatings(snapshot.matches, snapshot.players, { ...ACTIVE_ELO_OPTIONS, liveScaleCalibrations: snapshot.liveScaleCalibrations }) : null, [snapshot]);
  const eligibleHistory = useMemo(() => snapshot ? prepareRankedEloEvents(snapshot.matches).accepted : [], [snapshot]);
  const profiles = useMemo(() => new Map(snapshot?.players.map(player => [player.id, player]) ?? []), [snapshot]);
  const names = useMemo(() => new Map(snapshot?.players.map(player => [player.id, player.name]) ?? []), [snapshot]);
  const ratingUpdates = useMemo(() => {
    const byPlayer = new Map<string, RatingUpdate[]>();
    for (const update of result?.updates ?? []) {
      const history = byPlayer.get(update.playerId) ?? [];
      history.push(update); byPlayer.set(update.playerId, history);
    }
    return byPlayer;
  }, [result]);
  const sorted = useMemo(() => [...(result?.rows ?? [])].sort((a, b) => Number(b.games > 0) - Number(a.games > 0) || b.rating - a.rating || a.name.localeCompare(b.name)), [result]);
  const registered = sorted.filter(row => profiles.get(row.playerId)?.traceStatus === 'trace-user');
  const population = showUnregistered ? sorted : registered;
  const filtered = population.filter(row => row.name.toLowerCase().includes(query.toLowerCase()) && (status === 'all' || (status === 'unrated' ? row.games === 0 : row.games > 0 && (status === 'established' ? !row.provisional : row.provisional))));
  useEffect(() => { setPage(0); setActiveRating(null); }, [query, status, showUnregistered]);
  const selectedRow = profileName === null ? undefined : sorted.find(row => row.name === profileName || row.playerId === profileName);
  const selectedSeed = selectedRow ? profiles.get(selectedRow.playerId) : undefined;
  const selectedRegistered = selectedSeed?.traceStatus === 'trace-user';
  useEffect(() => {
    document.title = showMethod ? 'How ratings work · Trace' : selectedRow ? `${selectedRow.name} · Trace` : profileName !== null && result ? 'Player not found · Trace' : 'Leaderboard · Trace';
  }, [selectedRow, showMethod, result, profileName]);
  const verifiedPreMatchCount = eligibleHistory.filter(match => match.liveRatingEligibility?.timing === 'pre-match').length;
  const checkedAt = refreshStatus.lastCheckedAt === null ? '' : new Date(refreshStatus.lastCheckedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const refreshLabel = refreshStatus.checking ? 'Checking for new matches…' : refreshStatus.failed
    ? snapshot ? 'Couldn’t refresh · showing the last update' : 'Couldn’t load matches · trying again'
    : checkedAt ? `Checked at ${checkedAt}` : 'Waiting to check matches';
  const loading = refreshStatus.failed ? <div className="empty" role="alert"><h2>Couldn’t load the leaderboard.</h2><p>We’ll keep trying. You can also refresh the page.</p><a className="secondary" href={window.location.pathname}>Try again</a></div> : <div className="empty" role="status">Loading matches…</div>;

  return <>
    <header className="site-header">
      <a className="brand" href={LEADERBOARD_HREF} aria-label="Trace leaderboard"><img src={LEADERBOARD_MASCOT_HREF} alt=""/><span>Trace</span></a>
      <nav aria-label="Main navigation"><a className={!showMethod ? 'active' : ''} href={LEADERBOARD_HREF} aria-current={!showMethod && profileName === null ? 'page' : undefined}>Leaderboard</a><a className={showMethod ? 'active' : ''} href={`${LEADERBOARD_HREF}#method`} aria-current={showMethod ? 'page' : undefined}>How ratings work</a></nav>
    </header>
    <main>
      {showMethod ? <div className="method-page"><a className="back-link" href={LEADERBOARD_HREF}>Back to leaderboard</a><ModelSettings/></div> : profileName !== null ? !result ? loading : selectedRow ? <PlayerProfile
        key={selectedRow.playerId} row={selectedRow} registered={selectedRegistered}
        rank={selectedRow.games ? (selectedRegistered ? registered : sorted).indexOf(selectedRow) + 1 : null}
        rankScope={selectedRegistered ? 'registered' : 'all'} matches={eligibleHistory}
        updates={ratingUpdates.get(selectedRow.playerId) ?? []} names={names}
        latestLiveRating={selectedSeed?.latestLiveRating} liveRatingObservedAt={selectedSeed?.liveRatingObservedAt}
        liveRatingTiming={selectedSeed?.liveRatingTiming} liveRatingBefore={selectedSeed?.liveRatingBefore} liveRatingChange={selectedSeed?.liveRatingChange}
      /> : <section className="empty profile-not-found"><h1>Player not found</h1><p>This player isn’t in the current Trace archive.</p><a className="secondary" href={LEADERBOARD_HREF}>Find a player</a></section> : <>
        <section className="intro" aria-labelledby="leaderboard-heading"><div><h1 id="leaderboard-heading">Leaderboard</h1><p>Pokémon TCG Live · All-time</p></div><span className="updated">{snapshot ? `Updated ${date(snapshot.generatedAt)}` : ''}</span></section>
        <section className="board" id="leaderboard" aria-label="Leaderboard">
          <div className="controls">
            <label className="search"><MagnifyingGlass size={21} aria-hidden="true"/><span className="sr-only">Search players</span><input type="search" placeholder="Search players…" value={query} onChange={event => setQuery(event.target.value)}/></label>
            <label className="status-filter"><span className="sr-only">Matches counted</span><select value={status} onChange={event => setStatus(event.target.value)}><option value="all">All players</option><option value="established">10+ matches</option><option value="provisional">1–9 matches</option><option value="unrated">No matches counted</option></select></label>
            <label className="registration-toggle"><input type="checkbox" role="switch" checked={showUnregistered} onChange={event => setShowUnregistered(event.target.checked)}/><span>Show unregistered</span></label>
          </div>
          {!result ? loading : <>
            <div className="table-scroll" tabIndex={0} role="region" aria-label="Rankings table, scroll for more columns"><table className="leaderboard-table" aria-label="Player rankings"><thead><tr><th scope="col">Rank</th><th scope="col">Player</th><th scope="col"><span className="rating-column-title">Trace rating <a href="#method" aria-label="How Trace ratings work"><Info size={17}/></a></span></th><th scope="col">Record</th><th scope="col">Win rate</th></tr></thead>
              <tbody>{filtered.slice(page * pageSize, (page + 1) * pageSize).map(row => {
                const rank = row.games ? population.indexOf(row) + 1 : null;
                const seed = profiles.get(row.playerId);
                const unregistered = seed?.traceStatus !== 'trace-user';
                return <tr key={row.playerId} className={[rank && rank <= 3 ? `place-${rank}` : '', unregistered ? 'unregistered' : ''].filter(Boolean).join(' ')}>
                  <td className="rank"><span>{rank ?? '—'}</span>{rank === 1 && <Crown size={26} weight="regular" aria-label="First place"/>}</td>
                  <td><a className="player-name" href={playerProfileHref(row.name)}>{row.name}</a>{unregistered ? <small className="registration-badge">Not registered</small> : row.games === 0 ? <small>No rating yet</small> : row.provisional ? <small title={`${row.games} ${row.games === 1 ? 'match' : 'matches'} counted · fewer than 10`}>Few matches</small> : null}</td>
                  <td className="rating"><RatingScore active={activeRating === row.playerId} onOpen={() => setActiveRating(row.playerId)} row={row} updates={ratingUpdates.get(row.playerId) ?? []} names={names} latestLiveRating={seed?.latestLiveRating} liveRatingObservedAt={seed?.liveRatingObservedAt} liveRatingTiming={seed?.liveRatingTiming} liveRatingBefore={seed?.liveRatingBefore} liveRatingChange={seed?.liveRatingChange}/></td>
                  <td className="record">{row.games ? <span aria-label={`${row.wins} wins, ${row.losses} losses${row.draws ? `, ${row.draws} draws` : ''}`}>{row.wins}W <span className="record-losses">{row.losses}L</span>{row.draws > 0 && <span> {row.draws}D</span>}</span> : <span className="unrated-record">No matches counted</span>}</td>
                  <td className="win-rate">{row.games ? `${Math.round(row.wins / row.games * 100)}%` : '—'}</td>
                </tr>;
              })}</tbody>
            </table></div>
            {filtered.length === 0 && <div className="empty"><h2>No players found</h2><p>Try a different name or reset the filters.</p><button className="secondary" onClick={() => { setQuery(''); setStatus('all'); }}>Clear filters</button></div>}
            <div className="pagination"><span aria-live="polite">{filtered.length > pageSize ? `${page * pageSize + 1}–${Math.min(filtered.length, (page + 1) * pageSize)} of ${filtered.length} players` : `${filtered.length} ${showUnregistered ? '' : 'Trace '}${filtered.length === 1 ? 'player' : 'players'}`}</span>{filtered.length > pageSize && !sharePreview ? <div><button className="secondary" disabled={page === 0} onClick={() => { setPage(page - 1); setActiveRating(null); }}>Previous</button><button className="secondary" disabled={(page + 1) * pageSize >= filtered.length} onClick={() => { setPage(page + 1); setActiveRating(null); }}>Next</button></div> : <span>Select a player to view match history.</span>}</div>
          </>}
          {showUnregistered && <p className="registration-note">Players marked “Not registered” appear in other players’ matches. They use the same rating rules.</p>}
        </section>
      </>}
      <section className="source-note" id="coverage"><details open={coverageOpen} onToggle={event => setCoverageOpen(event.currentTarget.open)}><summary>{showMethod ? 'About the match data' : 'Which matches count?'}</summary>
        {!showMethod && <p>A ranked match counts when Trace has the result and both players’ Live ratings. A Live rating is the in-game rating in Pokémon TCG Live. Missing ratings, conflicting ratings or an unclear result mean the match is left out.</p>}
        <p>{result ? `${number(result.ratedMatchCount)} matches counted · ${number(result.rejectedMatches.length)} left out of this leaderboard.` : 'Loading match totals…'} Trace can only count recorded matches.{!showMethod && ' “Few matches” means fewer than 10 have counted so far.'}</p>
        <details className="source-data-details"><summary>Notes about this data</summary>
          <p>Players are matched by their exact names. Changing a name can split a player’s match history.</p>
          <p>For {number(verifiedPreMatchCount)} matches, we know the Live ratings were recorded before play. For the rest, the exact timing is unknown. Ratings marked “after the match” are shown for reference only. Some dates show when a match was imported.</p>
          <p>{snapshot?.liveScaleCalibrations?.length ? 'Known season resets can be adjusted for when enough information was available at the time. Other resets can still affect points.' : 'This data has no adjustments for season resets. A Live reset can still affect points in later matches, especially against players with little Trace history.'}</p>
        </details>
      </details></section>
    </main>
    <footer><a className="footer-brand" href={LEADERBOARD_HREF}>Trace</a><span>Every turn, in view.</span><span className="refresh-status" title={`Checks for new matches every 15 seconds while this tab is visible.${checkedAt ? ` Last successful check: ${checkedAt}.` : ''}`}>{refreshLabel}</span>{!LEADERBOARD_BASE && <span className="local-note">Local preview</span>}</footer>
  </>;
}
