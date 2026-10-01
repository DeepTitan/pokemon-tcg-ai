import React from 'react';
import { LEADERBOARD_HREF, LEADERBOARD_MASCOT_HREF } from './profile-route.js';

export default function TraceHeader() {
  return <header className="trace-site-header"><div className="trace-container trace-site-header-inner">
    <a className="trace-site-brand" href="/trace" aria-label="Trace home"><img src={LEADERBOARD_MASCOT_HREF} alt=""/><strong>Trace</strong></a>
    <nav aria-label="Main">
      <a href={LEADERBOARD_HREF} aria-current="page">Leaderboard</a>
      <a href="/trace/training">Training</a>
      <a href="/trace#plans">Plans</a>
      <a href="/trace/account">My account</a>
    </nav>
  </div></header>;
}
